"""
游戏素材工具 - 独立视频生成服务。

此文件仅供游戏工具使用，修改此文件不会影响漫剧功能。
漫剧视频生成逻辑在 jimeng_service.py，修改 jimeng_service.py 也不会影响此文件。
"""
from __future__ import annotations

import asyncio
import json
import logging
import httpx

from video_model_registry import normalize_video_model_id

logger = logging.getLogger("game_video")

BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

VIDEO_MODELS = {
    "seedance-1.5-pro":  "doubao-seedance-1-5-pro-251215",
    "seedance-2.0":      "doubao-seedance-2-0-260128",
    "seedance-1.0-pro-fast": "doubao-seedance-1-0-pro-fast-251015",
    "seedance-1.0-fast": "doubao-seedance-1-0-pro-fast-251015",
    "seedance-fast":     "doubao-seedance-1-0-pro-fast-251015",
    "dream-actor":       "jimeng_dream_actor_m1_gen_video_cv",
}

_DURATION_LIMITS = {
    "seedance-2.0": (4, 15),
    "seedance-1.5-pro": (4, 10),
    "seedance-1.0-pro-fast": (4, 10),
    "seedance-1.0-fast": (4, 10),
    "seedance-fast": (4, 10),
}

_RESOLUTION_LIMITS = {
    "seedance-2.0": {"720p", "1080p"},
    "seedance-1.5-pro": {"720p"},
    "seedance-1.0-pro-fast": {"720p"},
    "seedance-1.0-fast": {"720p"},
    "seedance-fast": {"720p"},
}


_SEEDANCE_ERROR_ZH: list[tuple[str, str]] = [
    ("Access denied", "访问被拒绝：火山引擎账号已欠费或未开通服务。请前往火山引擎控制台充值或开通即梦 API 服务。"),
    ("overdue", "火山引擎账号已欠费，请前往控制台充值后重试。"),
    ("InsufficientBalance", "账户余额不足，请前往火山引擎控制台充值。"),
    ("InvalidApiKey", "API Key 无效：请检查火山引擎 API Key 是否正确。"),
    ("AuthenticationError", "认证失败：API Key 无效或已过期，请检查后重新配置。"),
    ("RateLimitExceeded", "请求过于频繁，已触发限流。请稍后再试。"),
    ("rate_limit", "请求过于频繁，已触发限流。请稍后再试。"),
    ("PrivacyInformation", "素材可能包含真人隐私信息，平台已拦截。请更换不含真人隐私的参考图或视频后重试。"),
    ("InputTextSensitiveContentDetected", "视频提示词被平台安全策略拦截。请删减敏感词、换一种描述方式后重试。"),
    ("InputImageSensitiveContentDetected", "输入图片被平台安全策略拦截。请更换参考图、重新生成画面，或调整人物/场景后重试。"),
    ("InputVideoSensitiveContentDetected", "输入视频被平台安全策略拦截。请更换参考视频，避免真人隐私、敏感画面或受限内容后重试。"),
    ("SensitiveContentDetected", "内容安全审核未通过。请调整提示词或更换图片/视频素材后重试。"),
    ("InvalidParameter", "请求参数无效：请检查输入的图片/视频格式和尺寸是否符合要求。"),
    ("ContentFilterBlocked", "内容安全审核未通过：请更换素材后再试。"),
    ("content_filter", "内容安全审核未通过：请更换素材后再试。"),
    ("ServerError", "服务端错误：即梦服务暂时不可用，请稍后重试。"),
    ("TimeoutError", "请求超时：视频生成服务响应过慢，请稍后重试。"),
    ("ModelNotFound", "模型不存在或已下线，请切换其他模型重试。"),
    ("QuotaExhausted", "配额已用尽，请前往火山引擎控制台查看用量。"),
]


def _localize_seedance_error(code: str, msg: str) -> str:
    """将 Seedance / 火山引擎英文错误码翻译为中文。"""
    blob = f"{code} {msg}"
    blob_lower = blob.lower()
    if "duration" in blob_lower and "15.2" in blob:
        return "参考视频时长过长。Seedance 当前仅支持 15.2 秒以内的参考视频，请先裁剪后重试。"
    for key, zh in _SEEDANCE_ERROR_ZH:
        if key.lower() in blob_lower:
            return zh
    if msg:
        return f"视频服务错误（{code}）：{msg}" if code else f"视频服务错误：{msg}"
    return f"视频服务错误：{code}" if code else "视频服务返回未知错误，请稍后重试。"


def _parse_error(status_code: int, body: str) -> str:
    code = ""
    msg = ""
    try:
        data = json.loads(body)
        err = data.get("error") or {}
        if isinstance(err, dict):
            code = str(err.get("code", "") or "")
            msg = str(err.get("message", "") or err.get("msg", "") or "")
        elif isinstance(err, str):
            msg = err
        if not msg:
            msg = data.get("message", "") or data.get("msg", "") or ""
    except (json.JSONDecodeError, TypeError):
        msg = body[:400]
    return _localize_seedance_error(code, msg)


def _normalize_resolution(model: str, resolution: str = "720p") -> str:
    value = str(resolution or "720p").strip().lower().replace("P", "p")
    if value in {"720", "720p", "hd"}:
        normalized = "720p"
    elif value in {"1080", "1080p", "fullhd", "fhd"}:
        normalized = "1080p"
    else:
        normalized = "720p"
    supported = _RESOLUTION_LIMITS.get(model, {"720p"})
    return normalized if normalized in supported else "720p"


def _seedance_prompt(
    prompt: str,
    *,
    has_first_frame: bool = False,
    reference_image_count: int = 0,
    reference_video_count: int = 0,
    motion_transfer: bool = False,
) -> str:
    base = (prompt or "").strip()
    if not base:
        base = "生成一段画面稳定、主体清晰、动作自然的视频。"

    guidance = [
        "Seedance 生成要求：保持用户原始创意，不改变主体身份、画面风格和核心动作。",
        "画面需要稳定清晰，主体轮廓完整，动作自然连贯，避免肢体畸变、脸部漂移、闪烁、文字、水印、黑边和无关元素。",
        "请补足合理的镜头运动、光线、景深、节奏和环境细节，让结果接近即梦网页端的高质量成片效果。",
    ]
    if has_first_frame:
        guidance.append("首帧参考图是视频开场画面，请尽量保持首帧的构图、主体位置、服装、色彩、透视和背景连续性。")
    if reference_image_count:
        guidance.append(f"共有 {reference_image_count} 张参考图，用于保持角色身份、场景元素、道具和整体风格一致，不要把参考图中的主体画成新角色。")
    if reference_video_count:
        guidance.append(f"共有 {reference_video_count} 段参考视频，请参考其中的动作、表情、镜头节奏和运动轨迹，同时保持输出画面自然。")
    if motion_transfer:
        guidance.append("动作模仿任务中，参考图提供目标角色，参考视频提供动作和运镜，请把目标角色自然地迁移到参考视频动作中。")

    return f"{base}\n\n" + "\n".join(guidance)


class GameJimengService:
    """游戏专用即梦视频服务，与漫剧的 JimengService 完全独立。"""

    def __init__(self, api_key: str):
        self._api_key = api_key
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._file_cache: dict[str, str] = {}

    def update_key(self, api_key: str):
        self._api_key = api_key
        self._headers["Authorization"] = f"Bearer {api_key}"

    async def upload_file(self, filepath: str) -> str:
        """Upload a local file to Volcengine via Ark Files API and return the file_id.
        Seedance 2.0 cannot access bare IP URLs, so we upload files to Volcengine
        to get a file_id that can be used directly in content arrays."""
        if filepath in self._file_cache:
            return self._file_cache[filepath]

        from pathlib import Path
        p = Path(filepath)
        if not p.exists():
            raise Exception(f"文件不存在: {filepath}")

        content_bytes = p.read_bytes()
        filename = p.name
        ext = p.suffix.lower().lstrip(".")
        mime_map = {
            "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        }
        mime = mime_map.get(ext, "application/octet-stream")

        logger.info("Uploading file to Volcengine: %s (%d bytes, %s)", filename, len(content_bytes), mime)

        upload_headers = {"Authorization": f"Bearer {self._api_key}"}
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{BASE_URL}/files",
                headers=upload_headers,
                files={"file": (filename, content_bytes, mime)},
                data={"purpose": "user_data"},
            )
            if resp.status_code != 200:
                body = resp.text[:500]
                logger.error("Volcengine file upload failed %d: %s", resp.status_code, body)
                raise Exception(f"文件上传到火山引擎失败 ({resp.status_code}): {body}")
            data = resp.json()

        file_id = data.get("id", "")
        if not file_id:
            raise Exception(f"火山引擎未返回 file_id: {data}")

        logger.info("File uploaded to Volcengine: %s -> %s", filename, file_id)
        self._file_cache[filepath] = file_id
        return file_id

    async def upload_bytes(self, filename: str, data: bytes) -> str:
        """Upload raw bytes to Volcengine Files API, return file_id."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
        mime_map = {
            "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        }
        mime = mime_map.get(ext, "application/octet-stream")

        logger.info("Uploading bytes to Volcengine: %s (%d bytes, %s)", filename, len(data), mime)

        upload_headers = {"Authorization": f"Bearer {self._api_key}"}
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{BASE_URL}/files",
                headers=upload_headers,
                files={"file": (filename, data, mime)},
                data={"purpose": "user_data"},
            )
            if resp.status_code != 200:
                body = resp.text[:500]
                logger.error("Volcengine file upload failed %d: %s", resp.status_code, body)
                raise Exception(f"文件上传到火山引擎失败 ({resp.status_code}): {body}")
            result = resp.json()

        file_id = result.get("id", "")
        if not file_id:
            raise Exception(f"火山引擎未返回 file_id: {result}")

        logger.info("Bytes uploaded to Volcengine: %s -> %s", filename, file_id)
        return file_id

    async def motion_transfer(
        self,
        image_url: str,
        video_url: str,
        prompt: str = "",
        model: str = "seedance-2.0",
        duration: int = 5,
        resolution: str = "720p",
    ) -> dict:
        """Seedance 2.0 动作模仿：角色图(reference_image) + 动作视频(reference_video) → 换人视频。
        image_url: base64 data URL 或 HTTP URL
        video_url: base64 data URL 或 HTTP URL
        """
        model = normalize_video_model_id(model)
        model_id = VIDEO_MODELS.get(model, VIDEO_MODELS["seedance-2.0"])
        min_dur, max_dur = _DURATION_LIMITS.get(model, (4, 15))
        clamped_dur = max(min_dur, min(duration, max_dur))
        normalized_resolution = _normalize_resolution(model, resolution)

        content = [{
            "type": "text",
            "text": _seedance_prompt(
                prompt or "将图片中的角色替换到视频中，保持视频中的动作、表情和运镜不变",
                reference_image_count=1,
                reference_video_count=1,
                motion_transfer=True,
            ),
        }]
        content.append({
            "type": "image_url",
            "image_url": {"url": image_url},
            "role": "reference_image",
        })
        content.append({
            "type": "video_url",
            "video_url": {"url": video_url},
            "role": "reference_video",
        })

        payload = {
            "model": model_id,
            "content": content,
            "duration": clamped_dur,
            "resolution": normalized_resolution,
            "watermark": False,
        }

        url = f"{BASE_URL}/contents/generations/tasks"
        logger.info("MotionTransfer payload: %s", json.dumps(payload, ensure_ascii=False, default=str)[:2000])

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=self._headers, json=payload)
            if resp.status_code != 200:
                body = resp.text[:2000]
                logger.error("MotionTransfer API error %d: %s", resp.status_code, body[:500])
                raise Exception(_parse_error(resp.status_code, body))
            data = resp.json()

        task_id = data.get("task_id", data.get("id", ""))
        if not task_id:
            raise Exception(f"Seedance 未返回 task_id: {data}")

        return {"task_id": task_id, "status": "processing", "provider": "jimeng", "duration": clamped_dur}

    async def generate_video(
        self,
        prompt: str,
        model: str = "seedance-2.0",
        ratio: str = "9:16",
        duration: int = 5,
        resolution: str = "720p",
        image_url: str = "",
        reference_images: list[str] | None = None,
        reference_video: str = "",
    ) -> dict:
        model = normalize_video_model_id(model)
        model_id = VIDEO_MODELS.get(model, VIDEO_MODELS["seedance-2.0"])
        is_v2 = "seedance-2" in model

        min_dur, max_dur = _DURATION_LIMITS.get(model, (4, 10))
        clamped_dur = max(min_dur, min(duration, max_dur))
        normalized_resolution = _normalize_resolution(model, resolution)
        ref_image_count = len(reference_images or [])
        ref_video_count = 1 if reference_video else 0

        content = [{
            "type": "text",
            "text": _seedance_prompt(
                prompt,
                has_first_frame=bool(image_url),
                reference_image_count=ref_image_count,
                reference_video_count=ref_video_count,
            ),
        }]

        if is_v2:
            if image_url:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": image_url},
                    "role": "first_frame",
                })
            if reference_images:
                for ref_url in reference_images[:9]:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": ref_url},
                        "role": "reference_image",
                    })
            if reference_video:
                content.append({
                    "type": "video_url",
                    "video_url": {"url": reference_video},
                    "role": "reference_video",
                })
        else:
            first_img = image_url or (reference_images[0] if reference_images else "")
            if first_img:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": first_img},
                    "role": "first_frame",
                })

        payload = {
            "model": model_id,
            "content": content,
            "duration": clamped_dur,
            "ratio": ratio,
            "resolution": normalized_resolution,
            "watermark": False,
        }

        url = f"{BASE_URL}/contents/generations/tasks"
        logger.info("Game Seedance payload: %s", json.dumps(payload, ensure_ascii=False, default=str)[:2000])

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=self._headers, json=payload)
            if resp.status_code != 200:
                body = resp.text[:2000]
                logger.error("Game Seedance API error %d: %s", resp.status_code, body[:500])
                raise Exception(_parse_error(resp.status_code, body))
            data = resp.json()

        task_id = data.get("task_id", data.get("id", ""))
        if not task_id:
            raise Exception(f"Seedance 未返回 task_id: {data}")

        return {"task_id": task_id, "status": "processing", "provider": "jimeng", "duration": clamped_dur}

    async def edit_video(
        self,
        prompt: str,
        model: str = "seedance-2.0",
        ratio: str = "9:16",
        duration: int = 5,
        resolution: str = "720p",
        image_b64_urls: list[str] | None = None,
        video_urls: list[str] | None = None,
    ) -> dict:
        """Seedance 2.0 视频编辑/替换。
        - image_b64_urls: base64 data URL（图片可以用 base64）
        - video_urls: 可公网访问的参考视频 URL
        """
        model = normalize_video_model_id(model)
        model_id = VIDEO_MODELS.get(model, VIDEO_MODELS["seedance-2.0"])

        min_dur, max_dur = _DURATION_LIMITS.get(model, (4, 10))
        clamped_dur = max(min_dur, min(duration, max_dur))
        normalized_resolution = _normalize_resolution(model, resolution)
        ref_image_count = len(image_b64_urls or [])
        ref_video_count = len(video_urls or [])

        content = [{
            "type": "text",
            "text": _seedance_prompt(
                prompt,
                reference_image_count=ref_image_count,
                reference_video_count=ref_video_count,
            ),
        }]

        if image_b64_urls:
            for img_url in image_b64_urls[:9]:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": img_url},
                    "role": "reference_image",
                })
        if video_urls:
            for video_url in video_urls[:3]:
                content.append({
                    "type": "video_url",
                    "video_url": {"url": video_url},
                    "role": "reference_video",
                })

        payload = {
            "model": model_id,
            "content": content,
            "duration": clamped_dur,
            "ratio": ratio,
            "resolution": normalized_resolution,
            "watermark": False,
        }

        url = f"{BASE_URL}/contents/generations/tasks"
        logger.info("Game Seedance edit_video payload: %s", json.dumps(payload, ensure_ascii=False, default=str)[:2000])

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=self._headers, json=payload)
            if resp.status_code != 200:
                body = resp.text[:2000]
                logger.error("Game Seedance edit_video error %d: %s", resp.status_code, body[:500])
                raise Exception(_parse_error(resp.status_code, body))
            data = resp.json()

        task_id = data.get("task_id", data.get("id", ""))
        if not task_id:
            raise Exception(f"Seedance 未返回 task_id: {data}")

        return {"task_id": task_id, "status": "processing", "provider": "jimeng", "duration": clamped_dur}

    @staticmethod
    def _extract_ark_video_url(inner: dict) -> str:
        """Parse video URL from Ark GET /contents/generations/tasks response (shape varies by model)."""
        if not isinstance(inner, dict):
            return ""
        content = inner.get("content")
        if isinstance(content, dict):
            u = content.get("video_url") or content.get("url")
            if isinstance(u, str) and u.startswith("http"):
                return u
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") in ("video_url", "video"):
                    vu = item.get("video_url")
                    if isinstance(vu, dict):
                        u = vu.get("url", "")
                    else:
                        u = vu if isinstance(vu, str) else ""
                    if isinstance(u, str) and u.startswith("http"):
                        return u
        for key in ("output_url", "result_url", "video_url"):
            u = inner.get(key)
            if isinstance(u, str) and u.startswith("http"):
                return u
        return ""

    async def query_video_task(self, task_id: str) -> dict:
        url = f"{BASE_URL}/contents/generations/tasks/{task_id}"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, headers=self._headers)
                raw = resp.json()
                if resp.status_code != 200:
                    body = resp.text[:2000]
                    logger.error("Query Seedance task failed %s %d: %s", task_id, resp.status_code, body[:500])
                    raise Exception(_parse_error(resp.status_code, body))
        except httpx.RequestError as exc:
            logger.warning("Query Seedance task request error %s: %s", task_id, exc)
            raise Exception(f"查询视频任务状态失败：{str(exc)[:200]}")
        except ValueError as exc:
            logger.error("Query Seedance task returned invalid JSON %s: %s", task_id, exc)
            raise Exception("查询视频任务状态失败：视频服务返回了无法解析的数据")

        data = raw.get("data", raw)
        inner = data.get("data", data) if isinstance(data, dict) else data
        if not isinstance(inner, dict):
            inner = raw if isinstance(raw, dict) else {}

        status_raw = (
            inner.get("status")
            or (data.get("status") if isinstance(data, dict) else None)
            or raw.get("status", "processing")
        )
        sr = str(status_raw).strip().lower()

        video_url = self._extract_ark_video_url(inner)

        terminal_ok = {"succeeded", "success", "completed"}
        terminal_fail = {"failed", "expired", "cancelled", "canceled"}
        if sr in terminal_ok:
            mapped = "completed"
        elif sr in terminal_fail:
            mapped = "failed"
        elif sr in ("running", "queued", "pending", "processing", "in_progress"):
            mapped = "processing"
        else:
            mapped = "processing"

        err = ""
        if mapped == "failed":
            err = inner.get("error", "") or inner.get("message", "") or ""
            if not err and isinstance(inner.get("content"), dict):
                err = inner["content"].get("error", "") or inner["content"].get("message", "")
            err_code = inner.get("code", "") or ""
            if err:
                err = _localize_seedance_error(err_code, err)

        if mapped == "completed" and not video_url:
            mapped = "failed"
            err = err or "任务已完成但未返回视频地址，请重试或联系支持"

        return {
            "task_id": task_id,
            "status": mapped,
            "video_url": video_url,
            "error": err,
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
