from __future__ import annotations

import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from mulerun_service import (  # noqa: E402
    MULERUN_IMAGE_MODELS,
    MULERUN_NANO_BANANA_2_MODEL_ID,
    MuleRunImageError,
    MuleRunImageService,
    extract_json_object,
    image_size_for_request,
    parse_mulerun_image_result,
    resolve_mulerun_invocation,
)


class MuleRunServiceTests(unittest.TestCase):
    def test_extract_json_object_from_cli_progress_output(self):
        payload = extract_json_object(
            'Creating task...\n[1.0s] queued\n{"task_id":"task-1","status":"completed","data":{"images":[{"url":"https://example.com/a.png"}]}}\n'
        )

        self.assertEqual(payload["task_id"], "task-1")
        self.assertEqual(payload["data"]["images"][0]["url"], "https://example.com/a.png")

    def test_parse_completed_result(self):
        result = parse_mulerun_image_result(
            {
                "task_id": "task-1",
                "status": "completed",
                "results": ["https://example.com/a.png"],
            }
        )

        self.assertEqual(result["provider"], "mulerun_image")
        self.assertEqual(result["model"], "mulerun-gpt-image-2")
        self.assertEqual(result["image_url"], "https://example.com/a.png")
        self.assertEqual(result["images"][0]["url"], "https://example.com/a.png")

    def test_parse_openai_style_data_list(self):
        result = parse_mulerun_image_result(
            {
                "data": [
                    {"url": "https://example.com/a.png"},
                    {"b64_json": "abc123"},
                ]
            }
        )

        self.assertEqual(result["image_url"], "https://example.com/a.png")
        self.assertEqual(result["images"][1]["url"], "data:image/png;base64,abc123")

    def test_parse_failed_result_raises_friendly_error(self):
        with self.assertRaises(MuleRunImageError) as ctx:
            parse_mulerun_image_result(
                {
                    "status": "failed",
                    "data": {"error": {"message": "insufficient balance"}},
                }
            )

        self.assertIn("insufficient balance", str(ctx.exception))

    def test_image_size_mapping_uses_supported_gpt_image_2_sizes(self):
        self.assertEqual(image_size_for_request(1280, 720, "16:9", "1K"), "1536x1024")
        self.assertEqual(image_size_for_request(1280, 720, "16:9", "2K"), "2048x1152")
        self.assertEqual(image_size_for_request(720, 1280, "9:16", "2K"), "2160x3840")
        self.assertEqual(image_size_for_request(720, 1280, "9:16", "4K"), "1024x1536")
        self.assertEqual(image_size_for_request(1024, 1024, "1:1", "2K"), "2048x2048")
        self.assertEqual(image_size_for_request(1024, 1024, "1:1", "4K"), "1024x1024")

    def test_model_spec_supports_reference_images(self):
        spec = MULERUN_IMAGE_MODELS[0]
        self.assertTrue(spec["supports_ref_images"])
        self.assertTrue(spec["supports_edit"])
        self.assertEqual(spec["max_ref_images"], 4)
        self.assertEqual(spec["supported_qualities"], ["1K", "2K"])

    def test_api_text_generation_posts_openai_compatible_body(self):
        captured = {}

        def fake_post(path, body):
            captured["path"] = path
            captured["body"] = body
            return {"data": [{"url": "https://example.com/api.png"}]}

        service = MuleRunImageService(api_base_url="http://127.0.0.1:8080/v1", api_key="muk-test")
        with patch.object(service, "_post_api_json", side_effect=fake_post), \
             patch("mulerun_service.mulerun_image_available", return_value=False):
            result = service._generate_image_sync(
                prompt="white background product photo",
                model="mulerun-gpt-image-2",
                width=1280,
                height=720,
                aspect_ratio="16:9",
                image_quality="2K",
                image_count=3,
                output_format="png",
                reference_images=[],
            )

        self.assertEqual(captured["path"], "/images/generations")
        self.assertEqual(captured["body"]["model"], "gpt-image-2")
        self.assertEqual(captured["body"]["size"], "2048x1152")
        self.assertEqual(captured["body"]["quality"], "low")
        self.assertEqual(captured["body"]["n"], 3)
        self.assertNotIn("images", captured["body"])
        self.assertEqual(result["image_url"], "https://example.com/api.png")

    def test_api_reference_generation_uses_json_images_array(self):
        captured = {}

        def fake_post(path, body):
            captured["path"] = path
            captured["body"] = body
            return {"data": [{"url": "https://example.com/api-edit.png"}]}

        with tempfile.TemporaryDirectory() as temp_dir:
            reference = Path(temp_dir) / "reference.png"
            reference.write_bytes(b"png-bytes")
            service = MuleRunImageService(api_base_url="http://127.0.0.1:8080/v1", api_key="muk-test")
            with patch.object(service, "_post_api_json", side_effect=fake_post):
                result = service._generate_image_sync(
                    prompt="make it cinematic",
                    model="mulerun-gpt-image-2",
                    width=1024,
                    height=1024,
                    aspect_ratio="1:1",
                    image_quality="2K",
                    image_count=1,
                    output_format="webp",
                    reference_images=[str(reference), "https://example.com/ref.png"],
                )

        self.assertEqual(captured["path"], "/images/edits")
        self.assertEqual(captured["body"]["format"], "webp")
        self.assertEqual(len(captured["body"]["images"]), 2)
        self.assertTrue(captured["body"]["images"][0].startswith("data:image/png;base64,"))
        self.assertEqual(captured["body"]["images"][1], "https://example.com/ref.png")
        self.assertEqual(result["image_url"], "https://example.com/api-edit.png")

    def test_nano_banana_2_api_generation_uses_api_model_and_web_search(self):
        calls = []

        def fake_post(path, body):
            calls.append((path, body))
            return {"data": [{"url": f"https://example.com/nano-{len(calls)}.png"}]}

        service = MuleRunImageService(api_base_url="http://127.0.0.1:8080/v1", api_key="muk-test")
        with patch.object(service, "_post_api_json", side_effect=fake_post):
            result = service._generate_image_sync(
                prompt="white background product photo",
                model=MULERUN_NANO_BANANA_2_MODEL_ID,
                width=1280,
                height=720,
                aspect_ratio="16:9",
                image_quality="4K",
                image_count=2,
                output_format="png",
                reference_images=[],
                enable_web_search=True,
            )

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0], "/images/generations")
        self.assertEqual(calls[0][1]["model"], "nano-banana-2")
        self.assertEqual(calls[0][1]["aspect_ratio"], "16:9")
        self.assertEqual(calls[0][1]["resolution"], "1K")
        self.assertTrue(calls[0][1]["web_search"])
        self.assertEqual(len(result["images"]), 2)

    def test_reference_images_use_edit_endpoint(self):
        class Completed:
            returncode = 0
            stdout = '{"status":"completed","results":["https://example.com/edited.png"]}'
            stderr = ""

        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            return Completed()

        service = MuleRunImageService(cli="mulerun.cmd")
        with patch("mulerun_service.mulerun_image_available", return_value=True), \
             patch("mulerun_service.resolve_mulerun_cli", return_value="mulerun.cmd"), \
             patch("mulerun_service.subprocess.run", side_effect=fake_run):
            result = service._generate_image_sync(
                prompt="make it cinematic",
                model="mulerun-gpt-image-2",
                width=1024,
                height=1024,
                aspect_ratio="1:1",
                image_quality="2K",
                image_count=1,
                output_format="png",
                reference_images=["data:image/png;base64,abc"],
            )

        command = captured["command"]
        self.assertIn("openai/gpt-image-2/edit", command)
        self.assertIn("--extra", command)
        self.assertIn("images=", command[command.index("--extra") + 1])
        self.assertEqual(json.loads(command[command.index("--extra") + 1].split("=", 1)[1]), ["data:image/png;base64,abc"])
        self.assertIn("--quality", command)
        self.assertEqual(command[command.index("--quality") + 1], "low")
        self.assertEqual(result["image_url"], "https://example.com/edited.png")

    def test_reference_images_are_passed_as_json_array_argument(self):
        class Completed:
            returncode = 0
            stdout = '{"status":"completed","results":["https://example.com/edited.png"]}'
            stderr = ""

        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            return Completed()

        service = MuleRunImageService(cli="mulerun.cmd")
        with patch("mulerun_service.mulerun_image_available", return_value=True), \
             patch("mulerun_service.resolve_mulerun_invocation", return_value=["node", "mulerun.cjs"]), \
             patch("mulerun_service.subprocess.run", side_effect=fake_run):
            service._generate_image_sync(
                prompt="make it cinematic",
                model="mulerun-gpt-image-2",
                width=1024,
                height=1024,
                aspect_ratio="1:1",
                image_quality="2K",
                image_count=1,
                output_format="png",
                reference_images=["https://example.com/a.png?sig=1", "https://example.com/b.png?sig=2"],
            )

        command = captured["command"]
        self.assertEqual(command.count("--extra"), 1)
        self.assertNotIn("--images", command)
        self.assertEqual(
            json.loads(command[command.index("--extra") + 1].split("=", 1)[1]),
            ["https://example.com/a.png?sig=1", "https://example.com/b.png?sig=2"],
        )

    def test_nano_banana_2_text_generation_uses_google_endpoint(self):
        class Completed:
            returncode = 0
            stdout = '{"status":"completed","results":["https://example.com/nano.png"]}'
            stderr = ""

        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            return Completed()

        service = MuleRunImageService(cli="mulerun.cmd")
        with patch("mulerun_service.mulerun_image_available", return_value=True), \
             patch("mulerun_service.resolve_mulerun_invocation", return_value=["node", "mulerun.cjs"]), \
             patch("mulerun_service.subprocess.run", side_effect=fake_run):
            result = service._generate_image_sync(
                prompt="white background product photo",
                model=MULERUN_NANO_BANANA_2_MODEL_ID,
                width=1280,
                height=720,
                aspect_ratio="16:9",
                image_quality="4K",
                image_count=1,
                output_format="png",
                reference_images=[],
                enable_web_search=True,
            )

        command = captured["command"]
        self.assertIn("google/nano-banana-2/generation", command)
        self.assertNotIn("--size", command)
        self.assertNotIn("--n", command)
        self.assertIn("--aspect-ratio", command)
        self.assertEqual(command[command.index("--aspect-ratio") + 1], "16:9")
        self.assertIn("--resolution", command)
        self.assertEqual(command[command.index("--resolution") + 1], "1K")
        self.assertIn("--web-search", command)
        self.assertEqual(result["model"], MULERUN_NANO_BANANA_2_MODEL_ID)
        self.assertEqual(result["image_url"], "https://example.com/nano.png")

    def test_nano_banana_2_reference_images_use_edit_endpoint(self):
        class Completed:
            returncode = 0
            stdout = '{"status":"completed","results":["https://example.com/nano-edit.png"]}'
            stderr = ""

        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            return Completed()

        service = MuleRunImageService(cli="mulerun.cmd")
        with patch("mulerun_service.mulerun_image_available", return_value=True), \
             patch("mulerun_service.resolve_mulerun_invocation", return_value=["node", "mulerun.cjs"]), \
             patch("mulerun_service.subprocess.run", side_effect=fake_run):
            result = service._generate_image_sync(
                prompt="make it cleaner",
                model=MULERUN_NANO_BANANA_2_MODEL_ID,
                width=1024,
                height=1024,
                aspect_ratio="1:1",
                image_quality="2K",
                image_count=1,
                output_format="png",
                reference_images=["C:/tmp/a.png", "C:/tmp/b.png"],
                enable_web_search=False,
            )

        command = captured["command"]
        self.assertIn("google/nano-banana-2/edit", command)
        self.assertIn("--extra", command)
        self.assertEqual(json.loads(command[command.index("--extra") + 1].split("=", 1)[1]), ["C:/tmp/a.png", "C:/tmp/b.png"])
        self.assertNotIn("--web-search", command)
        self.assertEqual(result["model"], MULERUN_NANO_BANANA_2_MODEL_ID)
        self.assertEqual(result["image_url"], "https://example.com/nano-edit.png")

    def test_windows_cmd_invocation_uses_node_entry(self):
        cli_path = r"C:\Users\Administrator\AppData\Roaming\npm\mulerun.cmd"
        cjs_path = r"C:\Users\Administrator\AppData\Roaming\npm\node_modules\@mulerunai\cli\dist\mulerun.cjs"

        with patch("mulerun_service.os.name", "nt"), \
             patch("mulerun_service.resolve_mulerun_cli", return_value=cli_path), \
             patch("mulerun_service.os.path.isfile", side_effect=lambda path: path == cjs_path), \
             patch("mulerun_service.shutil.which", return_value=r"C:\Program Files\nodejs\node.exe"):
            invocation = resolve_mulerun_invocation("mulerun.cmd")

        self.assertEqual(invocation, [r"C:\Program Files\nodejs\node.exe", cjs_path])


if __name__ == "__main__":
    unittest.main()
