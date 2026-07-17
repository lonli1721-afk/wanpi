from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from openai_service import OPENAI_IMAGE_MODELS, OpenAIService  # noqa: E402


class FakeImageResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeAsyncClient:
    def __init__(self, captured, payload):
        self.captured = captured
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        self.captured.setdefault("requests", []).append({"url": url, **kwargs})
        self.captured["url"] = url
        self.captured.update(kwargs)
        payload = self.payload
        if isinstance(payload, list):
            payload = payload.pop(0)
        if isinstance(payload, Exception):
            raise payload
        return FakeImageResponse(payload)


class OpenAIImageServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_image_model_spec_exposes_batch_counts(self):
        spec = OPENAI_IMAGE_MODELS[0]

        self.assertTrue(spec["supports_batch"])
        self.assertEqual(spec["supported_counts"], [1, 2, 3, 4])
        self.assertEqual(spec["max_batch_count"], 4)
        self.assertEqual(spec["supported_qualities"], ["1K", "2K"])

    async def test_generate_image_sends_1k_size(self):
        captured = {}
        payload = {"data": [{"url": "https://example.com/1.png"}]}
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payload)):
            await service.generate_image(
                prompt="product photo",
                model="gpt-image-2",
                size="1280x720",
                image_quality="1K",
                image_count=1,
            )

        self.assertEqual(captured["json"]["size"], "1280x720")

    async def test_generate_image_unsupported_4k_falls_back_to_2k_portrait_size(self):
        captured = {}
        payload = {"data": [{"url": "https://example.com/1.png"}]}
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payload)):
            await service.generate_image(
                prompt="poster",
                model="gpt-image-2",
                size="720x1280",
                image_quality="4K",
                image_count=1,
            )

        self.assertEqual(captured["json"]["size"], "1152x2048")

    async def test_generate_image_sends_2k_size_and_requested_count(self):
        captured = {}
        payload = {"data": [{"url": "https://example.com/1.png"}]}
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payload)):
            result = await service.generate_image(
                prompt="product photo",
                model="gpt-image-2",
                size="1280x720",
                image_quality="2K",
                image_count=3,
            )

        self.assertEqual(captured["url"], "https://proxy.example/v1/images/generations")
        self.assertEqual(captured["json"]["size"], "2048x1152")
        self.assertEqual(captured["json"]["n"], 1)
        self.assertEqual(len(captured["requests"]), 3)
        self.assertEqual(len(result["images"]), 3)

    async def test_generate_image_returns_partial_images_when_later_request_fails(self):
        captured = {}
        request = httpx.Request("POST", "https://proxy.example/v1/images/generations")
        failure = httpx.HTTPStatusError(
            "server error",
            request=request,
            response=httpx.Response(500, request=request, text="busy"),
        )
        payloads = [
            {"data": [{"url": "https://example.com/1.png"}]},
            failure,
        ]
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payloads)):
            result = await service.generate_image(
                prompt="product photo",
                model="gpt-image-2",
                size="1280x720",
                image_quality="2K",
                image_count=2,
            )

        self.assertEqual(len(result["images"]), 1)
        self.assertIn("已生成 1/2 张", result["warning"])

    async def test_edit_image_sends_requested_count_and_portrait_2k_size(self):
        captured = {}
        payload = {"data": [{"url": "https://example.com/1.png"}]}
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payload)):
            result = await service.generate_image(
                prompt="make it cleaner",
                model="gpt-image-2",
                size="720x1280",
                reference_images=[(b"png", "image/png", "ref.png")],
                image_quality="2K",
                image_count=4,
            )

        self.assertEqual(captured["url"], "https://proxy.example/v1/images/edits")
        self.assertEqual(captured["data"]["size"], "1152x2048")
        self.assertEqual(captured["data"]["n"], "1")
        self.assertEqual(len(captured["requests"]), 4)
        self.assertEqual([field for field, _file in captured["files"]], ["image"])
        self.assertEqual(len(result["images"]), 4)

    async def test_edit_image_uses_array_field_for_multiple_reference_images(self):
        captured = {}
        payload = {"data": [{"url": "https://example.com/1.png"}]}
        service = OpenAIService(api_key="test-key", base_url="https://proxy.example/v1")

        with patch("openai_service.httpx.AsyncClient", return_value=FakeAsyncClient(captured, payload)):
            await service.generate_image(
                prompt="make matching icon",
                model="gpt-image-2",
                size="1024x1024",
                reference_images=[
                    (b"png1", "image/png", "ref1.png"),
                    (b"png2", "image/png", "ref2.png"),
                ],
                image_quality="2K",
                image_count=1,
            )

        self.assertEqual(captured["url"], "https://proxy.example/v1/images/edits")
        self.assertEqual([field for field, _file in captured["files"]], ["image[]", "image[]"])


if __name__ == "__main__":
    unittest.main()
