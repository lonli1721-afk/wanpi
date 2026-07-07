from __future__ import annotations

"""
即梦 (Jimeng / Doubao) - 火山引擎 Ark API 图片 + 视频生成服务。
使用 OpenAI 兼容接口。

图片模型: doubao-seedream-4-5, doubao-seedream-5-0
视频模型: doubao-seedance-1-5-pro, doubao-seedance-2-0
"""

import asyncio
import json
import logging
import httpx
from openai import OpenAI
from typing import Optional


def _seedance_error_message(status_code: int, body: str) -> str:
    """Parse Ark Seedance error JSON into a short Chinese hint for the UI."""
    code = ""
    msg = ""
    try:
        data = json.loads(body)
        err = data.get("error") or {}
        if isinstance(err, dict):
            code = str(err.get("code", "") or "")
            msg = str(err.get("message", "") or err.get("msg", "") or "")
    except (json.JSONDecodeError, TypeError):
        pass

    hints = {
        "InputImageSensitiveContentDetected": (
            "输入的分镜参考图被平台判定为敏感内容，无法生成视频。"
            "可尝试：重新生成分镜图、换一版画面、微调人物/场景后重试，或改用 VIDU 等其他视频模型。"
        ),
        "InputTextSensitiveContentDetected": (
            "视频提示词被平台判定为敏感内容。请修改提示词或对白描述后重试。"
        ),
        "SensitiveContentDetected": (
            "内容被平台安全策略拦截，请调整画面或文案后重试。"
        ),
    }
    if code in hints:
        return f"Seedance API 返回 {status_code}（{code}）：{hints[code]}"
    if code:
        detail = f"{code}" + (f"：{msg}" if msg else "")
        return f"Seedance API 返回 {status_code}：{detail}"
    return f"Seedance API 返回 {status_code}: {body[:400]}"


def _seedream_error_message(status_code: int, body: str, label: str = "即梦 API") -> str:
    code = ""
    msg = ""
    try:
        data = json.loads(body)
        err = data.get("error") or {}
        if isinstance(err, dict):
            code = str(err.get("code", "") or "")
            msg = str(err.get("message", "") or err.get("msg", "") or "")
    except (json.JSONDecodeError, TypeError):
        pass

    if code == "InvalidParameter.OversizeImage":
        return (
            f"{label} 返回 {status_code}（{code}）：参考图超过即梦 10 MiB 输入限制。"
            "系统会自动压缩本地上传图片；如果仍出现此提示，说明该参考图来自外部链接或压缩失败，"
            "请先把图片压到 10 MiB 以下后重试。"
        )
    if code:
        detail = f"{code}" + (f"：{msg}" if msg else "")
        return f"{label} 返回 {status_code}：{detail}"
    return f"{label} 返回 {status_code}: {body[:400]}"


BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

IMAGE_MODEL_SPECS = [
    {
        "id": "seedream-5.0",
        "name": "Seedream 5.0 Lite（最新）",
        "provider": "jimeng",
        "model_id": "doubao-seedream-5-0-260128",
        "supports_ref_images": True,
        "max_ref_images": 10,
        "supports_edit": True,
        "supported_qualities": ["2K", "4K"],
        "default_quality": "2K",
        "supports_prompt_optimization": True,
        "prompt_optimization_modes": ["standard"],
        "default_prompt_optimization": "standard",
        "supports_web_search": True,
        "supports_output_format": True,
        "output_formats": ["png"],
        "default_output_format": "png",
    },
    {
        "id": "seedream-4.5",
        "name": "Seedream 4.5",
        "provider": "jimeng",
        "model_id": "doubao-seedream-4-5-251128",
        "supports_ref_images": True,
        "max_ref_images": 14,
        "supports_edit": True,
        "supported_qualities": ["2K", "4K"],
        "default_quality": "2K",
        "supports_prompt_optimization": True,
        "prompt_optimization_modes": ["standard"],
        "default_prompt_optimization": "standard",
        "supports_web_search": False,
        "supports_output_format": False,
    },
    {
        "id": "seedream-5.0-lite",
        "name": "Seedream 5.0 Lite（兼容）",
        "provider": "jimeng",
        "model_id": "doubao-seedream-5-0-260128",
        "supports_ref_images": True,
        "max_ref_images": 10,
        "supports_edit": True,
        "supported_qualities": ["2K", "4K"],
        "default_quality": "2K",
        "supports_prompt_optimization": True,
        "prompt_optimization_modes": ["standard"],
        "default_prompt_optimization": "standard",
        "supports_web_search": True,
        "supports_output_format": True,
        "output_formats": ["png"],
        "default_output_format": "png",
    },
    {
        "id": "seedream-3.0",
        "name": "Seedream 3.0",
        "provider": "jimeng",
        "model_id": "doubao-seedream-3-0-t2i-250415",
        "supports_ref_images": False,
        "max_ref_images": 0,
        "supports_edit": False,
        "supported_qualities": ["1K"],
        "default_quality": "1K",
        "supports_prompt_optimization": False,
        "supports_web_search": False,
        "supports_output_format": False,
    },
]

IMAGE_MODELS = {spec["id"]: spec["model_id"] for spec in IMAGE_MODEL_SPECS}
IMAGE_SPECS_BY_ID = {spec["id"]: spec for spec in IMAGE_MODEL_SPECS}

VIDEO_MODELS = {
    "seedance-1.5-pro":  "doubao-seedance-1-5-pro-251215",
    "seedance-2.0":      "doubao-seedance-2-0-260128",
    "seedance-2.0-fast": "doubao-seedance-2-0-fast-260128",
    "seedance-1.0-pro-fast": "doubao-seedance-1-0-pro-fast-251015",
    "seedance-fast":     "doubao-seedance-1-0-pro-fast-251015",
}

SIZE_MAP_2K = {
    "1024x1024": "2048x2048",
    "512x512":   "2048x2048",
    "768x768":   "2048x2048",
    "1280x720":  "2560x1440",
    "720x1280":  "1440x2560",
    "1152x864":  "2304x1728",
    "864x1152":  "1728x2304",
    "1920x1080": "2560x1440",
    "1080x1920": "1440x2560",
}

SIZE_MAP_4K = {
    "1024x1024": "4096x4096",
    "512x512":   "4096x4096",
    "768x768":   "4096x4096",
    "1280x720":  "3840x2160",
    "720x1280":  "2160x3840",
    "1152x864":  "4096x3072",
    "864x1152":  "3072x4096",
    "1920x1080": "3840x2160",
    "1080x1920": "2160x3840",
}

SEEDREAM3_SIZES = {
    "512x512", "768x768", "1024x1024",
    "1280x720", "720x1280", "1920x1080", "1080x1920",
    "864x1152", "1152x864",
}


def get_image_model_specs() -> list[dict]:
    return [
        {key: value for key, value in spec.items() if key != "model_id"}
        for spec in IMAGE_MODEL_SPECS
    ]


def _image_spec_for_model(model: str) -> dict:
    return IMAGE_SPECS_BY_ID.get(model, IMAGE_SPECS_BY_ID["seedream-4.5"])


def _is_seedream3(model_id: str) -> bool:
    return "seedream-3-0" in model_id or "3-0-t2i" in model_id


def _is_seedream5(model_id: str) -> bool:
    return "seedream-5-0" in model_id


def _normalize_image_quality(value: Optional[str], model_id: str) -> str:
    if _is_seedream3(model_id):
        return "1K"
    normalized = (value or "2K").upper()
    return normalized if normalized in {"2K", "4K"} else "2K"


def _seedream_size(size: str, model_id: str, image_quality: Optional[str]) -> str:
    if _is_seedream3(model_id):
        return size if size in SEEDREAM3_SIZES else "1024x1024"
    quality = _normalize_image_quality(image_quality, model_id)
    size_map = SIZE_MAP_4K if quality == "4K" else SIZE_MAP_2K
    if size in {"2K", "4K"}:
        return size
    return size_map.get(size, "4096x4096" if quality == "4K" else "2048x2048")


def _prompt_optimization_mode(mode: Optional[str], model_id: str) -> Optional[str]:
    if _is_seedream3(model_id):
        return None
    normalized = (mode or "standard").strip().lower()
    if normalized in {"", "off", "none", "disabled", "false"}:
        return None
    return "standard"


class JimengService:
    def __init__(self, api_key: str):
        self._api_key = api_key
        self._client = OpenAI(api_key=api_key, base_url=BASE_URL)
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def update_key(self, api_key: str):
        self._api_key = api_key
        self._client = OpenAI(api_key=api_key, base_url=BASE_URL)
        self._headers["Authorization"] = f"Bearer {api_key}"

    # ── Image Generation (OpenAI compatible) ──

    async def generate_image(
        self,
        prompt: str,
        model: str = "seedream-4.5",
        size: str = "1024x1024",
        n: int = 1,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        max_retries: int = 3,
        reference_urls: Optional[list[str]] = None,
        edit_mode: bool = False,
        image_quality: str = "2K",
        prompt_optimize_mode: Optional[str] = "standard",
        output_format: Optional[str] = None,
        enable_web_search: bool = False,
        sequential_image_generation: str = "disabled",
        sequential_max_images: Optional[int] = None,
    ) -> dict:
        spec = _image_spec_for_model(model)
        model_id = spec["model_id"]
        refs = reference_urls or []
        is_v3 = _is_seedream3(model_id)

        if is_v3 and refs:
            raise Exception("Seedream 3.0 仅支持文生图，请切换 Seedream 4.5/5.0 后再使用参考图。")

        actual_size = _seedream_size(size, model_id, image_quality)
        return await self._with_retry(
            lambda: self._generate_image_rest(
                prompt=prompt,
                model_id=model_id,
                size=actual_size,
                guidance_scale=guidance_scale,
                seed=seed,
                reference_urls=refs,
                edit_mode=edit_mode,
                max_ref_images=int(spec.get("max_ref_images") or 0),
                prompt_optimize_mode=prompt_optimize_mode,
                output_format=output_format,
                enable_web_search=enable_web_search,
                sequential_image_generation=sequential_image_generation,
                sequential_max_images=sequential_max_images,
            ), max_retries,
        )

    @staticmethod
    async def _with_retry(fn, max_retries: int = 3):
        """Retry with exponential backoff on rate-limit / lock errors."""
        last_err = None
        for attempt in range(max_retries + 1):
            try:
                result = fn()
                if asyncio.iscoroutine(result) or asyncio.isfuture(result):
                    result = await result
                return result
            except Exception as e:
                last_err = e
                err_msg = str(e).lower()
                retryable = any(kw in err_msg for kw in [
                    "locked", "exhausted", "rate", "limit", "throttl",
                    "too many", "429", "503", "overloaded",
                ])
                if not retryable or attempt >= max_retries:
                    raise
                wait = (2 ** attempt) * 2 + 1
                import logging
                logging.getLogger("jimeng").warning(
                    "Retry %d/%d after %ds: %s", attempt + 1, max_retries, wait, str(e)[:100]
                )
                await asyncio.sleep(wait)
        raise last_err

    async def _generate_image_rest(
        self,
        prompt: str,
        model_id: str,
        size: str = "1024x1024",
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        reference_urls: Optional[list[str]] = None,
        edit_mode: bool = False,
        max_ref_images: int = 0,
        prompt_optimize_mode: Optional[str] = None,
        output_format: Optional[str] = None,
        enable_web_search: bool = False,
        sequential_image_generation: str = "disabled",
        sequential_max_images: Optional[int] = None,
    ) -> dict:
        """REST image call with official Seedream generation/edit parameters."""
        payload = self._build_image_payload(
            prompt=prompt,
            model_id=model_id,
            size=size,
            guidance_scale=guidance_scale,
            seed=seed,
            reference_urls=reference_urls,
            edit_mode=edit_mode,
            max_ref_images=max_ref_images,
            prompt_optimize_mode=prompt_optimize_mode,
            output_format=output_format,
            enable_web_search=enable_web_search,
            sequential_image_generation=sequential_image_generation,
            sequential_max_images=sequential_max_images,
        )
        data = await self._post_image_generation(payload, "即梦 API")

        images = data.get("data", [])
        urls = [img.get("url", "") for img in images if img.get("url")]

        return {
            "images": [{"url": u} for u in urls],
            "image_url": urls[0] if urls else "",
            "model": model_id,
            "prompt": prompt,
        }

    def _build_image_payload(
        self,
        prompt: str,
        model_id: str,
        size: str = "2048x2048",
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        reference_urls: Optional[list[str]] = None,
        edit_mode: bool = False,
        max_ref_images: int = 0,
        prompt_optimize_mode: Optional[str] = None,
        output_format: Optional[str] = None,
        enable_web_search: bool = False,
        sequential_image_generation: str = "disabled",
        sequential_max_images: Optional[int] = None,
    ) -> dict:
        payload: dict = {
            "model": model_id,
            "prompt": prompt,
            "size": size,
            "response_format": "url",
            "watermark": False,
            "stream": False,
            "sequential_image_generation": "disabled",
        }

        if _is_seedream3(model_id):
            payload.pop("stream", None)
            payload.pop("sequential_image_generation", None)
            if guidance_scale is not None:
                payload["guidance_scale"] = guidance_scale
            if seed is not None:
                payload["seed"] = seed
            return payload

        if reference_urls:
            limit = max(1, max_ref_images)
            refs = reference_urls[:limit]
            payload["image"] = refs[0] if len(refs) == 1 else refs

        prompt_mode = _prompt_optimization_mode(prompt_optimize_mode, model_id)
        if prompt_mode:
            payload["optimize_prompt_options"] = {"mode": prompt_mode}

        if _is_seedream5(model_id):
            fmt = (output_format or "png").strip().lower()
            if fmt in {"png", "jpeg"}:
                payload["output_format"] = fmt
            if enable_web_search:
                payload["tools"] = [{"type": "web_search"}]

        if sequential_image_generation == "auto":
            payload["sequential_image_generation"] = "auto"
            if sequential_max_images is not None:
                payload["sequential_image_generation_options"] = {
                    "max_images": max(1, min(int(sequential_max_images), 15))
                }
        return payload

    async def _post_image_generation(self, payload: dict, label: str) -> dict:
        payloads = [payload]
        optional_keys = {
            "optimize_prompt_options",
            "output_format",
            "tools",
            "sequential_image_generation_options",
        }
        if any(key in payload for key in optional_keys):
            fallback_payload = {key: value for key, value in payload.items() if key not in optional_keys}
            if fallback_payload != payload:
                payloads.append(fallback_payload)

        last_body = ""
        async with httpx.AsyncClient(timeout=90) as client:
            for idx, attempt_payload in enumerate(payloads):
                resp = await client.post(
                    f"{BASE_URL}/images/generations",
                    headers=self._headers,
                    json=attempt_payload,
                )
                if resp.status_code == 200:
                    return resp.json()
                last_body = resp.text[:500]
                can_retry_without_optional = (
                    idx == 0
                    and len(payloads) > 1
                    and resp.status_code == 400
                    and any(token in last_body.lower() for token in [
                        "optimize_prompt",
                        "output_format",
                        "tools",
                        "sequential_image_generation_options",
                        "unknown",
                        "invalid",
                    ])
                )
                if can_retry_without_optional:
                    logging.getLogger("jimeng").warning(
                        "Retry Seedream image without optional parameters after 400: %s",
                        last_body[:200],
                    )
                    continue
                raise Exception(_seedream_error_message(resp.status_code, last_body, label))

        raise Exception(f"{label} 返回失败: {last_body}")

    async def _generate_image_rest_with_refs(
        self,
        prompt: str,
        model_id: str,
        size: str = "2048x2048",
        reference_urls: Optional[list[str]] = None,
        edit_mode: bool = False,
    ) -> dict:
        data = await self._post_image_generation(
            self._build_image_payload(
                prompt=prompt,
                model_id=model_id,
                size=size,
                reference_urls=reference_urls,
                edit_mode=edit_mode,
                max_ref_images=10 if _is_seedream5(model_id) else 14,
                prompt_optimize_mode="standard",
            ),
            "即梦 API",
        )

        images = data.get("data", [])
        urls = [img.get("url", "") for img in images if img.get("url")]

        return {
            "images": [{"url": u} for u in urls],
            "image_url": urls[0] if urls else "",
            "model": model_id,
            "prompt": prompt,
        }

    # ── Video Generation (REST) ──
    # Create: POST /api/v3/contents/generations/tasks
    # Query:  GET  /api/v3/contents/generations/tasks/{task_id}

    # Seedance duration limits per model family
    _DURATION_LIMITS = {
        "seedance-2.0": (4, 15),
        "seedance-2.0-fast": (4, 10),
        "seedance-1.5-pro": (4, 10),
        "seedance-1.0-pro-fast": (4, 10),
        "seedance-fast": (4, 10),
    }

    async def generate_video(
        self,
        prompt: str,
        model: str = "seedance-1.5-pro",
        resolution: str = "720p",
        ratio: str = "9:16",
        duration: int = 5,
        image_url: str = "",
        character_refs: list[str] | None = None,
    ) -> dict:
        """漫剧专用视频生成。游戏视频生成请使用 game_video_service.py。"""
        model_id = VIDEO_MODELS.get(model, VIDEO_MODELS["seedance-1.5-pro"])

        min_dur, max_dur = self._DURATION_LIMITS.get(model, (4, 10))
        clamped_dur = max(min_dur, min(duration, max_dur))

        content = [{"type": "text", "text": prompt}]
        if image_url:
            content.insert(0, {"type": "image_url", "image_url": {"url": image_url}})

        payload = {
            "model": model_id,
            "content": content,
            "duration": clamped_dur,
            "ratio": ratio,
        }
        if character_refs:
            payload["subject_reference"] = [
                {"type": "image_url", "image_url": {"url": u}} for u in character_refs[:2]
            ]

        url = f"{BASE_URL}/contents/generations/tasks"

        import logging, json as _json
        logger = logging.getLogger("jimeng")
        logger.info("Seedance request payload: %s", _json.dumps(payload, ensure_ascii=False, default=str)[:2000])

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=self._headers, json=payload)
            if resp.status_code != 200:
                body = resp.text[:2000]
                logger.error("Seedance API error %d: %s", resp.status_code, body[:500])
                raise Exception(_seedance_error_message(resp.status_code, body))
            data = resp.json()

        task_id = data.get("task_id", data.get("id", ""))
        if not task_id:
            raise Exception(f"Seedance 未返回 task_id: {data}")

        return {"task_id": task_id, "status": "processing", "provider": "jimeng", "duration": clamped_dur}

    async def query_video_task(self, task_id: str) -> dict:
        url = f"{BASE_URL}/contents/generations/tasks/{task_id}"

        raw = None
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, headers=self._headers)
                resp.raise_for_status()
                raw = resp.json()
        except Exception:
            pass

        if not raw:
            return {"task_id": task_id, "status": "processing", "video_url": "", "provider": "jimeng", "raw_status": "unknown"}

        data = raw.get("data", raw)
        inner = data.get("data", data)
        status_raw = inner.get("status", data.get("status", "processing"))

        video_url = ""
        content = inner.get("content", {})
        if isinstance(content, dict):
            video_url = content.get("video_url", "")

        status_map = {
            "succeeded": "completed", "SUCCESS": "completed",
            "failed": "failed", "FAILED": "failed",
        }
        mapped = status_map.get(status_raw, "processing")

        return {
            "task_id": task_id,
            "status": mapped,
            "video_url": video_url,
            "provider": "jimeng",
            "raw_status": status_raw,
        }

    async def wait_for_video(self, task_id: str, timeout: int = 300, interval: int = 8) -> dict:
        elapsed = 0
        while elapsed < timeout:
            result = await self.query_video_task(task_id)
            if result["status"] in ("completed", "failed"):
                return result
            await asyncio.sleep(interval)
            elapsed += interval
        return {"task_id": task_id, "status": "timeout", "video_url": "", "provider": "jimeng"}
