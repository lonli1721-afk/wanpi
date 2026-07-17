from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

import httpx


MULERUN_IMAGE_PROVIDER = "mulerun_image"
MULERUN_GPT_IMAGE_2_MODEL_ID = "mulerun-gpt-image-2"
MULERUN_NANO_BANANA_2_MODEL_ID = "mulerun-nano-banana-2"
MULERUN_IMAGE_MODEL_ID = MULERUN_GPT_IMAGE_2_MODEL_ID
MULERUN_CLI_MODEL_ID = "gpt-image-2"
MULERUN_GPT_IMAGE_2_API_MODEL_ID = "gpt-image-2"
MULERUN_NANO_BANANA_2_API_MODEL_ID = "nano-banana-2"
MULERUN_API_GENERATIONS_PATH = "/images/generations"
MULERUN_API_EDITS_PATH = "/images/edits"
MULERUN_GPT_IMAGE_2_ENDPOINT = "openai/gpt-image-2/generation"
MULERUN_GPT_IMAGE_2_EDIT_ENDPOINT = "openai/gpt-image-2/edit"
MULERUN_NANO_BANANA_2_ENDPOINT = "google/nano-banana-2/generation"
MULERUN_NANO_BANANA_2_EDIT_ENDPOINT = "google/nano-banana-2/edit"
MULERUN_IMAGE_CLI_QUALITY = "low"
MULERUN_GPT_IMAGE_2_QUALITIES = ["1K", "2K"]
MULERUN_NANO_BANANA_2_QUALITIES = ["1K"]
MULERUN_NANO_BANANA_2_ASPECT_RATIOS = {
    "1:1",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
    "2:3",
    "3:2",
    "9:21",
    "21:9",
    "1:2",
    "2:1",
    "4:5",
    "5:4",
    "5:8",
}

MULERUN_IMAGE_MODELS = [
    {
        "id": MULERUN_GPT_IMAGE_2_MODEL_ID,
        "name": "GPT Image 2（MuleRun）",
        "provider": MULERUN_IMAGE_PROVIDER,
        "supports_ref_images": True,
        "max_ref_images": 4,
        "supports_edit": True,
        "supports_batch": True,
        "max_batch_count": 4,
        "supported_counts": [1, 2, 3, 4],
        "default_count": 1,
        "supported_qualities": MULERUN_GPT_IMAGE_2_QUALITIES,
        "default_quality": "2K",
        "supports_output_format": True,
        "output_formats": ["png", "jpeg", "webp"],
        "default_output_format": "png",
    },
    {
        "id": MULERUN_NANO_BANANA_2_MODEL_ID,
        "name": "Nano Banana 2（MuleRun）",
        "provider": MULERUN_IMAGE_PROVIDER,
        "supports_ref_images": True,
        "max_ref_images": 14,
        "supports_edit": True,
        "supports_batch": True,
        "max_batch_count": 4,
        "supported_counts": [1, 2, 3, 4],
        "default_count": 1,
        "supported_qualities": MULERUN_NANO_BANANA_2_QUALITIES,
        "default_quality": "1K",
        "supports_web_search": True,
    },
]

_GPT_IMAGE_2_SIZE_BY_QUALITY = {
    "1K": {
        "1:1": "1024x1024",
        "16:9": "1536x1024",
        "9:16": "1024x1536",
        "4:3": "1536x1024",
        "3:4": "1024x1536",
    },
    "2K": {
        "1:1": "2048x2048",
        "16:9": "2048x1152",
        "9:16": "2160x3840",
        "4:3": "1536x1024",
        "3:4": "1024x1536",
    },

}

_ALLOWED_SIZES = {"auto"} | {
    size
    for sizes in _GPT_IMAGE_2_SIZE_BY_QUALITY.values()
    for size in sizes.values()
}


class MuleRunImageError(RuntimeError):
    pass


def _default_cli_name() -> str:
    return "mulerun.cmd" if os.name == "nt" else "mulerun"


def resolve_mulerun_cli(cli: str = "") -> str:
    command = (cli or os.environ.get("MULERUN_CLI") or _default_cli_name()).strip().strip('"')
    resolved = shutil.which(command)
    if resolved:
        return resolved
    return command


def resolve_mulerun_invocation(cli: str = "") -> list[str]:
    resolved = resolve_mulerun_cli(cli)
    if os.name != "nt" or not resolved.lower().endswith((".cmd", ".bat", ".ps1")):
        return [resolved]

    basedir = os.path.dirname(resolved)
    cjs_entry = os.path.join(basedir, "node_modules", "@mulerunai", "cli", "dist", "mulerun.cjs")
    if not os.path.isfile(cjs_entry):
        return [resolved]

    bundled_node = os.path.join(basedir, "node.exe")
    node = bundled_node if os.path.isfile(bundled_node) else (shutil.which("node.exe") or shutil.which("node") or "node")
    return [node, cjs_entry]


def mulerun_image_available(cli: str = "") -> bool:
    command = (cli or os.environ.get("MULERUN_CLI") or _default_cli_name()).strip().strip('"')
    if shutil.which(command):
        return True
    return bool(os.path.isfile(command))


def mulerun_api_configured(api_base_url: str = "", api_key: str = "") -> bool:
    return bool((api_base_url or "").strip() or (api_key or "").strip())


def _join_api_url(base_url: str, path: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise MuleRunImageError("MuleRun API Base URL is required for API mode.")
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{base}{suffix}"


def _infer_aspect_ratio(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return "1:1"
    ratio = width / height
    if abs(ratio - 1) < 0.02:
        return "1:1"
    if abs(ratio - (16 / 9)) < 0.08:
        return "16:9"
    if abs(ratio - (9 / 16)) < 0.08:
        return "9:16"
    if abs(ratio - (4 / 3)) < 0.08:
        return "4:3"
    if abs(ratio - (3 / 4)) < 0.08:
        return "3:4"
    return "16:9" if width > height else "9:16"


def image_size_for_request(width: int, height: int, aspect_ratio: str = "", image_quality: str = "") -> str:
    ratio = (aspect_ratio or "").strip() or _infer_aspect_ratio(int(width or 0), int(height or 0))
    quality = (image_quality or "1K").strip().upper()
    quality_sizes = _GPT_IMAGE_2_SIZE_BY_QUALITY.get(quality) or _GPT_IMAGE_2_SIZE_BY_QUALITY["1K"]
    if ratio in quality_sizes:
        return quality_sizes[ratio]

    explicit = f"{int(width or 0)}x{int(height or 0)}"
    if explicit in _ALLOWED_SIZES:
        return explicit
    return quality_sizes["1:1"]


def _quality_for_cli(image_quality: str) -> str:
    return MULERUN_IMAGE_CLI_QUALITY


def _nano_banana_2_resolution_for_cli(image_quality: str) -> str:
    quality = (image_quality or "").strip().upper()
    return quality if quality in MULERUN_NANO_BANANA_2_QUALITIES else "1K"


def _nano_banana_2_aspect_ratio_for_cli(width: int, height: int, aspect_ratio: str = "") -> str:
    ratio = (aspect_ratio or "").strip()
    if ratio in MULERUN_NANO_BANANA_2_ASPECT_RATIOS:
        return ratio
    inferred = _infer_aspect_ratio(int(width or 0), int(height or 0))
    return inferred if inferred in MULERUN_NANO_BANANA_2_ASPECT_RATIOS else "1:1"


def _format_for_cli(output_format: str) -> str:
    fmt = (output_format or "").strip().lower()
    if fmt in {"png", "jpeg", "webp"}:
        return fmt
    return "png"


def _format_for_api(output_format: str) -> str:
    return _format_for_cli(output_format)


def _api_model_for_app_model(model_id: str) -> str:
    selected = (model_id or MULERUN_IMAGE_MODEL_ID).strip()
    if selected == MULERUN_NANO_BANANA_2_MODEL_ID:
        return MULERUN_NANO_BANANA_2_API_MODEL_ID
    return MULERUN_GPT_IMAGE_2_API_MODEL_ID


def _path_to_data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    try:
        with open(path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
    except OSError as exc:
        raise MuleRunImageError(f"Failed to read reference image for MuleRun API: {path}") from exc
    return f"data:{mime};base64,{encoded}"


def _reference_for_api(ref: str) -> str:
    value = str(ref or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://", "data:")):
        return value
    if os.path.isfile(value):
        return _path_to_data_url(value)
    return value


def _references_for_api(refs: list[str]) -> list[str]:
    return [value for value in (_reference_for_api(ref) for ref in refs) if value]


def _command_debug_summary(command: list[str]) -> str:
    program = " ".join(os.path.basename(part) for part in command[:2]) if len(command) > 1 else (command[0] if command else "")
    images_arg = ""
    try:
        images_index = command.index("--images")
        images_arg = command[images_index + 1]
    except Exception:
        for part in command:
            if isinstance(part, str) and part.startswith("images="):
                images_arg = part.split("=", 1)[1]
                break

    try:
        parsed_images = json.loads(images_arg)
        images_shape = f"json_array:{len(parsed_images)}" if isinstance(parsed_images, list) else type(parsed_images).__name__
    except Exception:
        images_shape = "missing_or_invalid"
    return f"invocation={program}; images={images_shape}"


def extract_json_object(text: str) -> dict[str, Any]:
    content = (text or "").strip()
    if not content:
        raise MuleRunImageError("MuleRun CLI did not return any output.")

    for index in range(len(content) - 1, -1, -1):
        if content[index] != "{":
            continue
        candidate = content[index:].strip()
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise MuleRunImageError("MuleRun CLI did not return valid JSON output.")


def _error_message(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("message") or value.get("error") or value)
    return str(value or "")


def _image_url_from_items(items: Any) -> str:
    if isinstance(items, str):
        return items
    if isinstance(items, dict):
        for key in ("url", "image_url", "b64_json"):
            value = items.get(key)
            if isinstance(value, str) and value:
                if key == "b64_json" and not value.startswith("data:"):
                    return f"data:image/png;base64,{value}"
                return value
    if isinstance(items, list):
        for item in items:
            value = _image_url_from_items(item)
            if value:
                return value
    return ""


def _image_urls_from_items(items: Any) -> list[str]:
    if isinstance(items, str):
        return [items] if items else []
    if isinstance(items, dict):
        for key in ("url", "image_url", "b64_json"):
            value = items.get(key)
            if isinstance(value, str) and value:
                if key == "b64_json" and not value.startswith("data:"):
                    return [f"data:image/png;base64,{value}"]
                return [value]
        urls: list[str] = []
        for key in ("results", "images", "image", "output", "data"):
            urls.extend(_image_urls_from_items(items.get(key)))
        return urls
    if isinstance(items, list):
        urls: list[str] = []
        for item in items:
            urls.extend(_image_urls_from_items(item))
        return urls
    return []


def parse_mulerun_image_result(payload: dict[str, Any], model: str = MULERUN_IMAGE_MODEL_ID) -> dict[str, Any]:
    payload_data = payload.get("data")
    data = payload_data if isinstance(payload_data, dict) else {}
    error = payload.get("error") or data.get("error")
    status = str(payload.get("status") or data.get("status") or "").lower()
    if error or status in {"failed", "error", "cancelled", "canceled"}:
        raise MuleRunImageError(_error_message(error) or "MuleRun image generation failed.")

    image_urls: list[str] = []
    for items in (
        data.get("results"),
        payload.get("results"),
        data.get("images"),
        payload.get("images"),
        data.get("image"),
        payload.get("image"),
        data.get("image_url"),
        payload.get("image_url"),
        payload_data if isinstance(payload_data, list) else None,
    ):
        image_urls.extend(_image_urls_from_items(items))
    image_urls = list(dict.fromkeys(url for url in image_urls if url))
    image_url = image_urls[0] if image_urls else ""
    if not image_url:
        raise MuleRunImageError("MuleRun image generation finished without an image URL.")

    return {
        "provider": MULERUN_IMAGE_PROVIDER,
        "model": model or MULERUN_IMAGE_MODEL_ID,
        "task_id": str(payload.get("task_id") or data.get("task_id") or ""),
        "status": status or "completed",
        "image_url": image_url,
        "images": [{"url": url} for url in image_urls],
        "raw": payload,
    }


@dataclass
class MuleRunImageService:
    cli: str = ""
    api_base_url: str = ""
    api_key: str = ""
    timeout_seconds: int = 1800

    def _uses_api(self) -> bool:
        return mulerun_api_configured(self.api_base_url, self.api_key)

    async def generate_image(
        self,
        *,
        prompt: str,
        model: str = MULERUN_IMAGE_MODEL_ID,
        width: int = 1024,
        height: int = 1024,
        aspect_ratio: str = "",
        image_quality: str = "1K",
        image_count: int = 1,
        output_format: str = "png",
        reference_images: list[str] | None = None,
        enable_web_search: bool = False,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._generate_image_sync,
            prompt=prompt,
            model=model,
            width=width,
            height=height,
            aspect_ratio=aspect_ratio,
            image_quality=image_quality,
            image_count=image_count,
            output_format=output_format,
            reference_images=reference_images,
            enable_web_search=enable_web_search,
        )

    def _generate_image_sync(
        self,
        *,
        prompt: str,
        model: str,
        width: int,
        height: int,
        aspect_ratio: str,
        image_quality: str,
        image_count: int,
        output_format: str,
        reference_images: list[str] | None,
        enable_web_search: bool = False,
    ) -> dict[str, Any]:
        if not prompt.strip():
            raise MuleRunImageError("Prompt is required.")
        if self._uses_api():
            return self._generate_image_api_sync(
                prompt=prompt,
                model=model,
                width=width,
                height=height,
                aspect_ratio=aspect_ratio,
                image_quality=image_quality,
                image_count=image_count,
                output_format=output_format,
                reference_images=reference_images,
                enable_web_search=enable_web_search,
            )
        if not mulerun_image_available(self.cli):
            raise MuleRunImageError("MuleRun CLI is not installed or not on PATH. Set MULERUN_CLI if needed.")

        refs = [str(item).strip() for item in (reference_images or []) if str(item or "").strip()]
        model_id = (model or MULERUN_IMAGE_MODEL_ID).strip()
        if model_id == MULERUN_NANO_BANANA_2_MODEL_ID:
            return self._generate_nano_banana_2_sync(
                prompt=prompt,
                width=width,
                height=height,
                aspect_ratio=aspect_ratio,
                image_quality=image_quality,
                image_count=image_count,
                reference_images=refs,
                enable_web_search=enable_web_search,
            )
        if model_id != MULERUN_GPT_IMAGE_2_MODEL_ID:
            raise MuleRunImageError(f"Unsupported MuleRun image model: {model_id}")

        if len(refs) > 4:
            raise MuleRunImageError("MuleRun GPT Image 2 supports up to 4 reference images.")
        size = image_size_for_request(width, height, aspect_ratio, image_quality)
        fmt = _format_for_cli(output_format)
        count = max(1, min(4, int(image_count or 1)))

        command = [
            *resolve_mulerun_invocation(self.cli),
            "studio",
            "run",
            MULERUN_GPT_IMAGE_2_EDIT_ENDPOINT if refs else MULERUN_GPT_IMAGE_2_ENDPOINT,
            "--prompt",
            prompt,
            "--size",
            size,
            "--n",
            str(count),
            "--format",
            fmt,
        ]
        command.extend(["--quality", _quality_for_cli(image_quality)])
        if refs:
            command.extend(["--extra", f"images={json.dumps(refs, ensure_ascii=False)}"])
        command.append("--json")
        payload = self._run_command(command)
        return parse_mulerun_image_result(payload, model=MULERUN_GPT_IMAGE_2_MODEL_ID)

    def _api_headers(self) -> dict[str, str]:
        key = (self.api_key or "").strip()
        if not key:
            raise MuleRunImageError("MuleRun API Key is required for API mode.")
        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _post_api_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = _join_api_url(self.api_base_url, path)
        try:
            with httpx.Client(timeout=max(60, int(self.timeout_seconds))) as client:
                response = client.post(url, headers=self._api_headers(), json=body)
                response.raise_for_status()
                try:
                    payload = response.json()
                except ValueError as exc:
                    preview = (response.text or "").strip()[:800] or "empty response"
                    raise MuleRunImageError(f"MuleRun API returned non-JSON response: {preview}") from exc
                if isinstance(payload, dict):
                    return payload
                raise MuleRunImageError("MuleRun API returned an unexpected JSON payload.")
        except httpx.HTTPStatusError as exc:
            preview = (exc.response.text or "").strip()[:1200] or "empty response"
            raise MuleRunImageError(f"MuleRun API returned HTTP {exc.response.status_code}: {preview}") from exc
        except httpx.RequestError as exc:
            raise MuleRunImageError(f"MuleRun API request failed: {exc}") from exc

    def _generate_image_api_sync(
        self,
        *,
        prompt: str,
        model: str,
        width: int,
        height: int,
        aspect_ratio: str,
        image_quality: str,
        image_count: int,
        output_format: str,
        reference_images: list[str] | None,
        enable_web_search: bool = False,
    ) -> dict[str, Any]:
        refs = [str(item).strip() for item in (reference_images or []) if str(item or "").strip()]
        model_id = (model or MULERUN_IMAGE_MODEL_ID).strip()
        if model_id == MULERUN_NANO_BANANA_2_MODEL_ID:
            return self._generate_nano_banana_2_api_sync(
                prompt=prompt,
                width=width,
                height=height,
                aspect_ratio=aspect_ratio,
                image_quality=image_quality,
                image_count=image_count,
                reference_images=refs,
                enable_web_search=enable_web_search,
            )
        if model_id != MULERUN_GPT_IMAGE_2_MODEL_ID:
            raise MuleRunImageError(f"Unsupported MuleRun image model: {model_id}")
        if len(refs) > 4:
            raise MuleRunImageError("MuleRun GPT Image 2 supports up to 4 reference images.")

        count = max(1, min(4, int(image_count or 1)))
        body: dict[str, Any] = {
            "model": _api_model_for_app_model(model_id),
            "prompt": prompt,
            "size": image_size_for_request(width, height, aspect_ratio, image_quality),
            "quality": MULERUN_IMAGE_CLI_QUALITY,
            "n": count,
            "format": _format_for_api(output_format),
        }
        if refs:
            body["images"] = _references_for_api(refs)
        payload = self._post_api_json(MULERUN_API_EDITS_PATH if refs else MULERUN_API_GENERATIONS_PATH, body)
        return parse_mulerun_image_result(payload, model=MULERUN_GPT_IMAGE_2_MODEL_ID)

    def _generate_nano_banana_2_api_sync(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        aspect_ratio: str,
        image_quality: str,
        image_count: int,
        reference_images: list[str],
        enable_web_search: bool = False,
    ) -> dict[str, Any]:
        refs = [str(item).strip() for item in (reference_images or []) if str(item or "").strip()]
        if len(refs) > 14:
            raise MuleRunImageError("MuleRun Nano Banana 2 supports up to 14 reference images.")

        count = max(1, min(4, int(image_count or 1)))
        ratio = _nano_banana_2_aspect_ratio_for_cli(width, height, aspect_ratio)
        resolution = _nano_banana_2_resolution_for_cli(image_quality)
        api_refs = _references_for_api(refs)
        results: list[dict[str, Any]] = []

        for _ in range(count):
            body: dict[str, Any] = {
                "model": _api_model_for_app_model(MULERUN_NANO_BANANA_2_MODEL_ID),
                "prompt": prompt,
                "aspect_ratio": ratio,
                "resolution": resolution,
            }
            if api_refs:
                body["images"] = api_refs
            if enable_web_search:
                body["web_search"] = True
            payload = self._post_api_json(MULERUN_API_EDITS_PATH if api_refs else MULERUN_API_GENERATIONS_PATH, body)
            results.append(parse_mulerun_image_result(payload, model=MULERUN_NANO_BANANA_2_MODEL_ID))

        image_urls = []
        raw_payloads = []
        task_ids = []
        for result in results:
            task_id = result.get("task_id")
            if task_id:
                task_ids.append(task_id)
            raw_payloads.append(result.get("raw"))
            for item in result.get("images") or []:
                url = item.get("url") if isinstance(item, dict) else ""
                if url:
                    image_urls.append(url)
        image_urls = list(dict.fromkeys(image_urls))
        if not image_urls:
            raise MuleRunImageError("MuleRun Nano Banana 2 generation finished without an image URL.")
        return {
            "provider": MULERUN_IMAGE_PROVIDER,
            "model": MULERUN_NANO_BANANA_2_MODEL_ID,
            "task_id": ",".join(task_ids),
            "status": "completed",
            "image_url": image_urls[0],
            "images": [{"url": url} for url in image_urls],
            "raw": raw_payloads[0] if len(raw_payloads) == 1 else raw_payloads,
        }

    def _generate_nano_banana_2_sync(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        aspect_ratio: str,
        image_quality: str,
        image_count: int,
        reference_images: list[str],
        enable_web_search: bool = False,
    ) -> dict[str, Any]:
        refs = [str(item).strip() for item in (reference_images or []) if str(item or "").strip()]
        if len(refs) > 14:
            raise MuleRunImageError("MuleRun Nano Banana 2 supports up to 14 reference images.")

        count = max(1, min(4, int(image_count or 1)))
        endpoint = MULERUN_NANO_BANANA_2_EDIT_ENDPOINT if refs else MULERUN_NANO_BANANA_2_ENDPOINT
        ratio = _nano_banana_2_aspect_ratio_for_cli(width, height, aspect_ratio)
        resolution = _nano_banana_2_resolution_for_cli(image_quality)
        results: list[dict[str, Any]] = []

        for _ in range(count):
            command = [
                *resolve_mulerun_invocation(self.cli),
                "studio",
                "run",
                endpoint,
                "--prompt",
                prompt,
                "--aspect-ratio",
                ratio,
                "--resolution",
                resolution,
            ]
            if refs:
                command.extend(["--extra", f"images={json.dumps(refs, ensure_ascii=False)}"])
            if enable_web_search:
                command.append("--web-search")
            command.append("--json")
            payload = self._run_command(command)
            results.append(parse_mulerun_image_result(payload, model=MULERUN_NANO_BANANA_2_MODEL_ID))

        image_urls = []
        raw_payloads = []
        task_ids = []
        for result in results:
            task_id = result.get("task_id")
            if task_id:
                task_ids.append(task_id)
            raw_payloads.append(result.get("raw"))
            for item in result.get("images") or []:
                url = item.get("url") if isinstance(item, dict) else ""
                if url:
                    image_urls.append(url)
        image_urls = list(dict.fromkeys(image_urls))
        if not image_urls:
            raise MuleRunImageError("MuleRun Nano Banana 2 generation finished without an image URL.")
        return {
            "provider": MULERUN_IMAGE_PROVIDER,
            "model": MULERUN_NANO_BANANA_2_MODEL_ID,
            "task_id": ",".join(task_ids),
            "status": "completed",
            "image_url": image_urls[0],
            "images": [{"url": url} for url in image_urls],
            "raw": raw_payloads[0] if len(raw_payloads) == 1 else raw_payloads,
        }

    def _run_command(self, command: list[str]) -> dict[str, Any]:
        env = os.environ.copy()
        env.setdefault("MULERUN_DISABLE_AUTO_UPGRADE", "1")
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=max(60, int(self.timeout_seconds)),
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise MuleRunImageError(f"MuleRun CLI timed out after {self.timeout_seconds} seconds.") from exc
        except OSError as exc:
            raise MuleRunImageError(f"Failed to start MuleRun CLI: {exc}") from exc

        output = "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()
        try:
            payload = extract_json_object(completed.stdout or output)
        except MuleRunImageError:
            if completed.returncode != 0:
                tail = output[-1200:] if output else "no output"
                raise MuleRunImageError(f"MuleRun CLI failed ({_command_debug_summary(command)}): {tail}")
            raise

        if completed.returncode != 0 and not payload.get("status"):
            tail = output[-1200:] if output else "no output"
            raise MuleRunImageError(f"MuleRun CLI failed ({_command_debug_summary(command)}): {tail}")

        return payload
