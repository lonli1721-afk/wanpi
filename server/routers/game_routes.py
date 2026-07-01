from __future__ import annotations

import asyncio
import base64
import io
import logging
import uuid
import json
import os
import re
import threading
import time

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request, Depends
from pydantic import BaseModel, Field
from typing import Optional

import database as db
import deps
import auth
from game_media_service import (
    collect_file_urls as _collect_file_urls,
    delete_local_files as _delete_local_files,
    media_info as get_game_media_info,
    project_file_urls as _project_file_urls,
    save_game_upload,
)
from provider_queue import ProviderBusyError, run_provider_call
from task_status_query import StatusQueryBusyError, status_query_busy_result
from task_status_policy import (
    is_failed_task_status,
    is_success_task_status,
)
from task_record_service import (
    build_generate_task_record_payload,
    build_replace_task_record_payload,
    ensure_game_task_record as ensure_game_task_record_service,
)
from task_status_service import query_game_task_status
from task_status_http_service import batch_query_game_task_statuses, retry_game_task_result_cache
from video_generation_validation import VideoGenerationValidationError, validate_generate_video_request
from video_model_registry import get_video_model_spec, get_video_model_specs as _catalog_video_model_specs, normalize_video_model_id

logger = logging.getLogger("game")


def _bind_request_context(request: Request) -> None:
    user = getattr(request.state, "user", None)
    if not isinstance(user, dict):
        return
    user = dict(user)
    lookup = user.get("sub") or user.get("id") or user.get("username") or ""
    full = auth.get_user_full(lookup) if lookup else None
    if not full and user.get("username"):
        full = auth.get_user_full(user.get("username"))
    if full:
        for key, value in full.items():
            if value is not None:
                user[key] = value
        if full.get("id"):
            user["sub"] = full["id"]
    request.state.user = user
    deps.set_current_user(user)
    user_id = user.get("id") or user.get("sub") or ""
    if not user_id:
        return
    user_db_path = getattr(request.state, "user_db_path", None) or auth.get_user_db_path(user_id)
    user_files_dir = getattr(request.state, "user_files_dir", None) or auth.get_user_files_dir(user_id)
    db.set_db_path(user_db_path)
    deps.set_files_dir(user_files_dir)


router = APIRouter(dependencies=[Depends(_bind_request_context)])

FRAME_EXTRACTION_CONCURRENCY = max(1, int(os.environ.get("FRAME_EXTRACTION_CONCURRENCY", "2") or "2"))
FRAME_EXTRACTION_TIMEOUT_SECONDS = max(5, int(os.environ.get("FRAME_EXTRACTION_TIMEOUT_SECONDS", "45") or "45"))
ARK_MULTIMODAL_MODEL_ID = "doubao-seed-2-0-pro-260215"
DEFAULT_FRAME_EXTRACTION_COUNT = max(8, int(os.environ.get("FRAME_EXTRACTION_COUNT", "10") or "10"))
SEEDANCE_REFERENCE_VIDEO_LIMIT_SECONDS = 15.2
TASK_STATUS_QUERY_CONCURRENCY = max(1, int(os.environ.get("GAME_TASK_STATUS_QUERY_CONCURRENCY", "4") or "4"))
TASK_STATUS_BATCH_LIMIT = max(1, int(os.environ.get("GAME_TASK_STATUS_BATCH_LIMIT", "50") or "50"))
FAILED_RESULT_RECOVERY_RETRY_SECONDS = max(
    30,
    int(os.environ.get("GAME_FAILED_RESULT_RECOVERY_RETRY_SECONDS", "300") or "300"),
)
PROMPT_REFERENCE_IMAGE_MAX_BYTES = max(
    1024 * 1024,
    int(os.environ.get("PROMPT_REFERENCE_IMAGE_MAX_BYTES", str(6 * 1024 * 1024)) or str(6 * 1024 * 1024)),
)
_frame_extraction_semaphore = asyncio.Semaphore(FRAME_EXTRACTION_CONCURRENCY)
_ai_service_cache: dict[tuple[str, tuple[str, ...]], object] = {}
_ai_service_cache_lock = threading.RLock()
OPENAI_IMAGE2_BETA_USERNAMES = {
    "huangye",
    "caipailing",
    "caipeiling",
    "zhouyanqing",
    "huanglin",
    "huanghuiyuan",
    "liuxiaoxiao",
    "liqingling",
    "zhanghongzhi",
}
OPENAI_IMAGE2_BETA_DISPLAY_NAMES = {
    "黄也",
    "蔡沛玲",
    "周延青",
    "黄琳",
    "黄慧缘",
    "黄慧媛",
    "刘潇潇",
    "黎庆玲",
    "张宏智",
}

PROMPT_CHINESE_OUTPUT_RULES = """
语言硬性规则：
- 必须直接使用简体中文生成最终提示词；不要先写英文再翻译成中文。
- 不要输出英文句子、英文镜头提示词、英文标题或英文解释。
- 如果参考图或视频里有英文字幕、英文 UI，只能用中文描述其含义，不要照抄英文。
- 可保留 3D、UI、IP、A/B、16:9、9:16、720p、1080p 这类行业符号或规格；除此之外的用户可见内容必须是中文。
- 只返回可直接使用的提示词正文，不要返回标题、说明、Markdown 或 JSON。
""".strip()


class GameChineseOutputError(ValueError):
    """Raised when a game prompt endpoint returns English user-visible text."""


def _looks_like_english_prompt_text(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    sanitized = re.sub(r"\b(?:3D|2D|UI|IP|A/B|VR|AR|CG|NPC|PVP|PVE|FPS|RPG|MOBA|HUD)\b", "", text, flags=re.I)
    sanitized = re.sub(r"\b\d{1,4}p\b|\b\d+:\d+\b", "", sanitized, flags=re.I)
    if not re.search(r"[A-Za-z]{3,}", sanitized):
        return False
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", sanitized))
    alpha_count = len(re.findall(r"[A-Za-z]", sanitized))
    if cjk_count == 0:
        return True
    return alpha_count >= 18 and alpha_count > cjk_count


def _ensure_chinese_prompt_output(value: str, context: str) -> None:
    if _looks_like_english_prompt_text(value):
        raise GameChineseOutputError(f"{context}包含英文内容，已按规则拦截。")


def _chinese_prompt_request(*parts: str) -> str:
    body = "\n\n".join(str(part or "").strip() for part in parts if str(part or "").strip())
    return f"{PROMPT_CHINESE_OUTPUT_RULES}\n\n{body}".strip()


def _env_key(name: str) -> str:
    """Read provider keys from common environment variable names."""
    candidates: list[str]
    if name == "ark_api_key":
        candidates = ["GAME_ARK_API_KEY", "ARK_API_KEY", "GAME_JIMENG_API_KEY", "JIMENG_API_KEY"]
    elif name == "dashscope_api_key":
        candidates = ["GAME_DASHSCOPE_API_KEY", "DASHSCOPE_API_KEY"]
    elif name == "vidu_api_key":
        candidates = ["GAME_VIDU_API_KEY", "VIDU_API_KEY"]
    elif name == "gemini_api_key":
        candidates = ["GAME_GEMINI_API_KEY", "GEMINI_API_KEY"]
    else:
        candidates = [f"GAME_{name.upper()}", name.upper()]

    for env_name in candidates:
        value = (os.environ.get(env_name, "") or "").strip()
        if value:
            return value
    return ""


def _current_request_user(request: Request | None = None) -> dict:
    user = {}
    if request is not None:
        state_user = getattr(request.state, "user", None)
        if isinstance(state_user, dict):
            user.update(state_user)
    if not user and hasattr(deps, "get_current_user"):
        try:
            user.update(deps.get_current_user() or {})
        except Exception:
            pass
    user_id = user.get("sub") or user.get("id") or ""
    if user_id and hasattr(auth, "get_user_full"):
        try:
            full = auth.get_user_full(user_id) or {}
            user.update({k: v for k, v in full.items() if v not in (None, "")})
        except Exception:
            pass
    return user


def _can_use_openai_image2_beta(request: Request | None = None) -> bool:
    user = _current_request_user(request)
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    username = str(user.get("username") or "").strip().lower()
    display_name = str(user.get("display_name") or "").strip()
    return username in OPENAI_IMAGE2_BETA_USERNAMES or display_name in OPENAI_IMAGE2_BETA_DISPLAY_NAMES


def _ensure_openai_image2_beta_access(request: Request | None = None) -> None:
    if not _can_use_openai_image2_beta(request):
        raise HTTPException(status_code=403, detail="GPT Image 2 当前处于成本内测，仅管理员和内测名单用户可使用。")


def _env_key_pool(name: str) -> list[str]:
    if name == "gemini_api_key":
        candidates = ["GAME_GEMINI_API_KEYS", "GEMINI_API_KEYS", "GAME_GEMINI_API_KEY", "GEMINI_API_KEY"]
    else:
        candidates = [f"GAME_{name.upper()}S", f"{name.upper()}S", f"GAME_{name.upper()}", name.upper()]

    from ai_service import split_api_keys
    keys: list[str] = []
    seen: set[str] = set()
    for env_name in candidates:
        for key in split_api_keys(os.environ.get(env_name, "")):
            if key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


def _user_key(name: str) -> str:
    """Read a game API key from the current user's department group only."""
    return deps.get_group_api_key(name)


def _user_key_pool(name: str) -> list[str]:
    return deps.get_group_api_key_pool(name)


def _missing_group_api_key(name: str) -> HTTPException:
    helper = getattr(deps, "missing_group_api_key_http", None)
    if callable(helper):
        return helper(name)

    message_helper = getattr(deps, "missing_group_api_key_message", None)
    if callable(message_helper):
        return HTTPException(status_code=400, detail=message_helper(name))

    return HTTPException(status_code=400, detail=f"{name} API Key 未配置，请先到设置里配置。")


async def _resolve_seedance_video_reference(svc, url: str) -> str:
    """Resolve a local/reference video into something Seedance can actually fetch."""
    local_path = deps._extract_local_file_path(url)
    if not local_path:
        return url

    public_url = deps.build_signed_public_file_url(url)
    if public_url != url:
        return public_url

    raise HTTPException(
        400,
        "视频动作修复需要模型方可访问的公网视频地址。请检查 PUBLIC_BASE_URL 是否已配置，并确认该视频文件仍存在；如果仍失败，请重新上传视频后再试。",
    )


async def _validate_seedance_reference_video_duration(url: str, label: str = "参考视频") -> float | None:
    duration = await _db_call(deps.get_local_video_duration_seconds, url)
    if duration is None and deps._extract_local_file_path(url):
        raise HTTPException(
            400,
            f"无法检测{label}真实时长。Seedance 参考视频必须先完成时长检测，请重新上传视频后再试。",
        )
    if duration and duration > SEEDANCE_REFERENCE_VIDEO_LIMIT_SECONDS:
        raise HTTPException(
            400,
            (
                f"{label}时长过长（{duration:.1f} 秒）。Seedance 当前仅支持 "
                f"{SEEDANCE_REFERENCE_VIDEO_LIMIT_SECONDS} 秒以内的视频，请先裁剪后重试。"
            ),
        )
    return duration


async def _validate_seedance_reference_video_total_duration(urls: list[str], label: str = "高级参考视频") -> float:
    total = 0.0
    for index, url in enumerate(urls, start=1):
        duration = await _validate_seedance_reference_video_duration(url, f"{label}{index}")
        if duration:
            total += float(duration)
    if total > SEEDANCE_REFERENCE_VIDEO_LIMIT_SECONDS:
        raise HTTPException(
            400,
            (
                f"{label}总时长过长（{total:.1f} 秒）。Seedance 当前要求参考视频总时长 "
                f"{SEEDANCE_REFERENCE_VIDEO_LIMIT_SECONDS} 秒以内，请裁剪或减少参考视频后重试。"
            ),
        )
    return total


def _ensure_seedance_first_frame_not_mixed(
    *,
    first_frame_url: str,
    reference_image_count: int,
    reference_video_count: int,
) -> None:
    if first_frame_url and (reference_image_count > 0 or reference_video_count > 0):
        raise HTTPException(
            400,
            "Seedance 首帧/尾帧不能和参考图或参考视频混用，请只保留一种参考素材后重试。",
        )


def _jimeng():
    """Per-user jimeng service for image generation."""
    k = _user_key("ark_api_key")
    if k:
        from jimeng_service import JimengService
        return JimengService(api_key=k)
    raise _missing_group_api_key("火山 ARK Key")


def _game_video_svc():
    """Per-user game video service (GameJimengService) 鈥?fully isolated from manga."""
    k = _user_key("ark_api_key")
    if k:
        from game_video_service import GameJimengService
        return GameJimengService(api_key=k)
    raise _missing_group_api_key("火山 ARK Key")


def _vidu():
    """Per-user vidu service."""
    k = _user_key("vidu_api_key")
    if k:
        from vidu_service import ViduService
        return ViduService(api_key=k)
    raise _missing_group_api_key("VIDU Key")


def _happyhorse():
    """Per-user HappyHorse service."""
    k = _user_key("dashscope_api_key")
    if k:
        from happyhorse_service import HappyHorseService
        return HappyHorseService(api_key=k)
    raise _missing_group_api_key("DashScope Key")


def _ai():
    """Per-user AI service (with proxy for China servers)."""
    keys = _user_key_pool("gemini_api_key")
    if keys:
        from ai_service import AIService
        proxy = deps.get_proxy_url()
        gemini_proxy = f"{proxy}/gemini" if proxy else ""
        cache_key = (gemini_proxy, tuple(keys))
        with _ai_service_cache_lock:
            svc = _ai_service_cache.get(cache_key)
            if svc is None:
                svc = AIService(api_key=keys[0], api_keys=keys, proxy_base_url=gemini_proxy)
                _ai_service_cache[cache_key] = svc
            return svc
    raise _missing_group_api_key("Gemini Key")


def _openai():
    """Per-user OpenAI-compatible service with the same proxy/base-url rules as the global service."""
    k = _user_key("openai_api_key")
    if not k:
        raise _missing_group_api_key("OpenAI Key")

    from openai_service import OpenAIService

    proxy = deps.get_proxy_url()
    base_url = _user_key("openai_base_url")
    if proxy:
        base_url = f"{proxy}/openai/v1"
    elif not base_url:
        base_url = "https://open-api.mincode.cn/v1"
    return OpenAIService(api_key=k, base_url=base_url)


def _is_ark_multimodal_model(model: str) -> bool:
    return (model or "").strip() == ARK_MULTIMODAL_MODEL_ID


def _ensure_prompt_model_available(model: str) -> None:
    selected = (model or "gemini-2.5-flash").strip()
    if _is_ark_multimodal_model(selected):
        if not _ark_api_key():
            raise _missing_group_api_key("火山 ARK Key")
        return
    if deps.is_openai_model(selected):
        _openai()
        return
    _ai()


def _ark_api_key() -> str:
    for name in ("ark_api_key", "jimeng_api_key"):
        value = (_user_key(name) or "").strip()
        if value:
            return value
    return ""


async def _ark_chat_completion(
    *,
    content: list[dict] | str,
    operation: str,
    max_completion_tokens: int = 2048,
) -> str:
    api_key = _ark_api_key()
    if not api_key:
        raise Exception("ARK API Key 未配置，请在设置页面配置火山引擎 ARK Key。")
    payload = {
        "model": ARK_MULTIMODAL_MODEL_ID,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": max_completion_tokens,
    }

    async def _call():
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    msg = err.get("error", {}).get("message") or err.get("message") or resp.text
                except Exception:
                    msg = resp.text
                raise Exception(f"火山模型请求失败：{msg[:300]}")
            return resp.json()

    data = await _provider_call("ark", operation, _call)
    return str((data.get("choices") or [{}])[0].get("message", {}).get("content") or "")


async def _llm_chat(prompt: str, model: str, conversation_id: str = "", max_tokens: int = 8192) -> str:
    if _is_ark_multimodal_model(model):
        return await _ark_chat_completion(content=prompt, operation="llm_chat", max_completion_tokens=min(max_tokens, 4096))
    if deps.is_openai_model(model):
        svc = _openai()
        if not svc:
            raise Exception("OpenAI API key is not configured")
        return await _provider_call("openai", "llm_chat", lambda: svc.chat(prompt, model=model, max_tokens=max_tokens))
    svc = _ai()
    if not svc:
        raise Exception("Gemini API key is not configured")
    cid = conversation_id or f"chat_{uuid.uuid4().hex[:6]}"
    result = await _provider_call("gemini", "llm_chat", lambda: svc.chat(prompt, cid, model))
    return result.get("response", "")


async def _prompt_llm_chat(prompt: str, model: str, conversation_id: str = "", timeout: int = 90) -> str:
    """Prompt optimization should stay quick and use the selected model directly."""
    primary_model = model or "gemini-2.5-flash"
    return await asyncio.wait_for(_llm_chat(prompt, primary_model, conversation_id, max_tokens=1600), timeout=timeout)


async def _read_reference_media(url: str, expected: str = "image") -> tuple[bytes, str, str]:
    local_path = deps.get_local_file_path_from_url(url)
    if local_path:
        media_bytes = await asyncio.to_thread(local_path.read_bytes)
        ext = local_path.suffix.lower().lstrip(".")
    else:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            media_bytes = resp.content
        ext = url.split("?", 1)[0].rsplit(".", 1)[-1].lower() if "." in url.split("?", 1)[0] else ""

    if expected == "video":
        mime = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "m4v": "video/mp4"}.get(ext, "video/mp4")
        return media_bytes, mime, ext or "mp4"

    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/png")
    return media_bytes, mime, ext or "png"


def _shrink_prompt_reference_image(image_bytes: bytes, mime: str) -> tuple[bytes, str]:
    if len(image_bytes) <= PROMPT_REFERENCE_IMAGE_MAX_BYTES:
        return image_bytes, mime
    try:
        from PIL import Image, ImageOps
    except Exception:
        logger.warning("Pillow is unavailable; cannot shrink prompt reference image (%d bytes)", len(image_bytes))
        return image_bytes, mime

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            elif image.mode == "L":
                image = image.convert("RGB")

            max_side = max(image.size)
            quality = 88
            while True:
                candidate = image.copy()
                if max_side > 2048:
                    candidate.thumbnail((2048, 2048), Image.Resampling.LANCZOS)

                while quality >= 62:
                    buf = io.BytesIO()
                    candidate.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
                    data = buf.getvalue()
                    if len(data) <= PROMPT_REFERENCE_IMAGE_MAX_BYTES:
                        logger.info(
                            "Shrank prompt reference image from %.2f MiB to %.2f MiB",
                            len(image_bytes) / 1024 / 1024,
                            len(data) / 1024 / 1024,
                        )
                        return data, "image/jpeg"
                    quality -= 8

                if max(candidate.size) <= 960:
                    return data, "image/jpeg"
                max_side = max(960, int(max(candidate.size) * 0.78))
                image = candidate
                image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                quality = 82
    except Exception as exc:
        logger.warning("Failed to shrink prompt reference image: %s", exc)
        return image_bytes, mime


async def _collect_prompt_reference_media(
    character_refs: list[str],
    scene_refs: list[str],
    reference_video_url: str = "",
    advanced_reference_videos: list[str] | None = None,
) -> tuple[list[tuple[bytes, str]], list[tuple[bytes, str, str]]]:
    image_refs: list[tuple[bytes, str]] = []
    for url in [*(character_refs or []), *(scene_refs or [])][:6]:
        if not url:
            continue
        image_bytes, mime, _ = await _read_reference_media(url, "image")
        image_bytes, mime = await asyncio.to_thread(_shrink_prompt_reference_image, image_bytes, mime)
        image_refs.append((image_bytes, mime))

    video_refs: list[tuple[bytes, str, str]] = []
    for url in ([reference_video_url] if reference_video_url else []) + list(advanced_reference_videos or [])[:3]:
        if not url:
            continue
        video_refs.append(await _read_reference_media(url, "video"))
    return image_refs, video_refs


async def _prompt_multimodal_chat(
    text_prompt: str,
    model: str,
    image_refs: list[tuple[bytes, str]],
    video_refs: list[tuple[bytes, str, str]],
    timeout: int = 120,
) -> str:
    primary_model = model or "gemini-2.5-flash"
    if _is_ark_multimodal_model(primary_model):
        content: list[dict] = []
        for image_bytes, mime in image_refs:
            b64 = base64.b64encode(image_bytes).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
        for video_bytes, mime, _ext in video_refs:
            b64 = base64.b64encode(video_bytes).decode()
            content.append({"type": "video_url", "video_url": {"url": f"data:{mime};base64,{b64}"}})
        content.append({"type": "text", "text": text_prompt})
        return await asyncio.wait_for(
            _ark_chat_completion(content=content, operation="prompt_multimodal_chat", max_completion_tokens=2048),
            timeout=timeout,
        )

    async def _call_gemini(gemini_model: str) -> str:
        if not svc:
            raise Exception("Gemini API key is not configured")
        from google.genai import types
        parts = []
        for image_bytes, mime in image_refs:
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime))
        for video_bytes, mime, _ext in video_refs:
            parts.append(types.Part.from_bytes(data=video_bytes, mime_type=mime))
        parts.append(types.Part.from_text(text=text_prompt))
        response = await svc.generate_content(
            model=gemini_model,
            contents=types.Content(role="user", parts=parts),
        )
        return (response.text or "").strip()

    if deps.is_openai_model(primary_model):
        async def _call_openai_vision() -> str:
            openai_svc = _openai()
            if not openai_svc:
                raise Exception("OpenAI API key is not configured")
            vision_images = list(image_refs)
            for video_bytes, _mime, ext in video_refs:
                vision_images.extend(await _extract_video_frames(video_bytes, ext=ext, max_frames=8))
            return await asyncio.wait_for(
                openai_svc.chat_vision(text_prompt=text_prompt, image_data_list=vision_images, model=primary_model),
                timeout=timeout,
            )

        return await _provider_call(
            "openai",
            "prompt_multimodal_chat",
            _call_openai_vision,
        )

    svc = _ai()
    if not svc:
        svc = None

    if not svc:
        raise Exception("Gemini API key is not configured")

    return await asyncio.wait_for(
        _provider_call("gemini", "prompt_multimodal_chat", lambda: _call_gemini(primary_model)),
        timeout=timeout,
    )


async def _db_call(fn, *args, **kwargs):
    """Run sqlite/file-system helpers away from the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


async def _provider_call(provider: str, operation: str, fn):
    try:
        return await run_provider_call(provider, operation, fn)
    except ProviderBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


async def _ensure_game_task_record(task_id: str, payload: dict) -> str:
    return await ensure_game_task_record_service(
        task_id,
        payload,
        db_call=_db_call,
        video_tasks=deps._video_tasks,
        logger=logger,
    )


def _operation_error_text(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail or exc.status_code)
    return str(exc)


def _friendly_ai_error(exc: Exception) -> str:
    if isinstance(exc, GameChineseOutputError):
        return "模型返回了英文提示词，系统已按规则拦截。请重新生成中文结果。"
    msg = _operation_error_text(exc).strip()
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "Too Many Requests" in msg:
        return "模型当前触发限流或配额不足，请稍后重试。"
    if "503" in msg or "UNAVAILABLE" in msg or "high demand" in msg:
        return "模型服务当前繁忙，请稍后重试。"
    if "504" in msg or "DEADLINE_EXCEEDED" in msg or "timeout" in msg.lower():
        return "模型响应超时，请稍后重试；如果连续失败，建议减少素材数量或缩短提示词。"
    if "401" in msg:
        return "模型 API Key 无效或已过期，请检查设置。"
    if "403" in msg or "PERMISSION_DENIED" in msg:
        return "模型 API Key 权限不足，请检查账号、模型权限或重新配置。"
    if "400" in msg or "INVALID_ARGUMENT" in msg:
        return f"模型请求参数错误：{msg[:200]}"
    return msg[:500] or "模型请求失败，请稍后重试。"


def _prompt_provider(model: str) -> str:
    if _is_ark_multimodal_model(model or ""):
        return "ark"
    return "openai" if deps.is_openai_model(model or "") else "gemini"


async def _record_operation_failure(
    operation: str,
    project_id: str = "",
    provider: str = "",
    model: str = "",
    task_id: str = "",
    error: str = "",
) -> None:
    try:
        await _db_call(
            db.create_game_operation_event,
            project_id=project_id,
            operation=operation,
            provider=provider,
            model=model,
            status="failed",
            task_id=task_id,
            error=error,
        )
    except Exception:
        logger.exception("Failed to record %s failure event", operation)


async def _record_operation_success(
    operation: str,
    project_id: str = "",
    provider: str = "",
    model: str = "",
    task_id: str = "",
) -> None:
    try:
        await _db_call(
            db.create_game_operation_event,
            project_id=project_id,
            operation=operation,
            provider=provider,
            model=model,
            status="success",
            task_id=task_id,
        )
    except Exception:
        logger.exception("Failed to record %s success event", operation)


def _is_failed_task_status(status: str) -> bool:
    return is_failed_task_status(status)


def _is_success_task_status(status: str) -> bool:
    return is_success_task_status(status)


# Pydantic models

class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


class OperationEventRequest(BaseModel):
    operation: str
    project_id: str = ""
    provider: str = ""
    model: str = ""
    task_id: str = ""
    status: str = "success"
    error: str = ""

class UpdateProjectRequest(BaseModel):
    name: str = ""
    description: str = ""

class CreateAssetRequest(BaseModel):
    project_id: str
    type: str = "character"
    name: str = ""
    description: str = ""
    image_url: str = ""

class AnalyzePromptRequest(BaseModel):
    project_id: str = ""
    description: str = ""
    character_refs: list[str] = Field(default_factory=list)
    scene_refs: list[str] = Field(default_factory=list)
    reference_video_url: str = ""
    advanced_reference_videos: list[str] = Field(default_factory=list)
    model: str = "gemini-2.5-flash"
    language: str = "Chinese"

class RefreshPromptRequest(BaseModel):
    project_id: str = ""
    prompt: str
    character_refs: list[str] = Field(default_factory=list)
    scene_refs: list[str] = Field(default_factory=list)
    reference_video_url: str = ""
    advanced_reference_videos: list[str] = Field(default_factory=list)
    model: str = "gemini-2.5-flash"
    target: str = "video"


def _prompt_model_failure_message(model: str, action: str, error_text: str) -> str:
    selected = (model or "").strip() or "当前模型"
    detail = (error_text or "模型请求失败").strip()
    return (
        f"{action}失败：当前选择的模型 {selected} 暂时不可用。\n"
        f"具体原因：{detail}\n"
        "请稍后重试，或切换到其他提示词模型后再试。"
    )


class GenerateVideoRequest(BaseModel):
    project_id: str = ""
    prompt: str
    provider: str = "jimeng"
    model: str = "seedance-2.0"
    duration: int = 5
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    image_url: str = ""
    character_refs: list[str] = Field(default_factory=list)
    scene_refs: list[str] = Field(default_factory=list)
    reference_video_url: str = ""
    advanced_reference_videos: list[str] = Field(default_factory=list)

class ReplaceVideoRequest(BaseModel):
    project_id: str = ""
    ref_video_url: str = ""
    character_ref: str = ""
    prompt: str = ""
    provider: str = "jimeng"   # "jimeng" (Seedance 2.0) or "wan" (Wanxiang)
    mode: str = "wan-std"
    check_image: bool = False
    resolution: str = "720p"

class AnalyzeVideoRequest(BaseModel):
    video_url: str
    model: str = "gemini-3.1-pro-preview"
    language: str = "Chinese"


class BatchTaskStatusRequest(BaseModel):
    task_ids: list[str] = Field(default_factory=list)


# Projects
class DeleteFilesRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)
    project_id: str = ""


class MediaInfoRequest(BaseModel):
    url: str = ""


@router.get("/projects")
async def list_projects(limit: int = 50):
    return await _db_call(db.list_game_projects, limit=limit)

@router.post("/projects")
async def create_project(req: CreateProjectRequest):
    return await _db_call(db.create_game_project, name=req.name, description=req.description)


@router.post("/operation-event")
async def operation_event(req: OperationEventRequest):
    operation = (req.operation or "").strip()
    if not operation:
        raise HTTPException(400, "operation is required")
    status = (req.status or "success").strip().lower()
    if status not in {"success", "failed"}:
        status = "success"
    await _db_call(
        db.create_game_operation_event,
        project_id=req.project_id,
        operation=operation[:120],
        provider=(req.provider or "")[:80],
        model=(req.model or "")[:120],
        task_id=(req.task_id or "")[:120],
        status=status,
        error=req.error or "",
    )
    return {"ok": True}


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    p = await _db_call(db.get_game_project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p

@router.put("/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProjectRequest):
    p = await _db_call(db.get_game_project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    updates = {k: v for k, v in req.dict().items() if v}
    if updates:
        await _db_call(db.update_game_project, project_id, **updates)
    return await _db_call(db.get_game_project, project_id)

@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    p = await _db_call(db.get_game_project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    tasks = await _db_call(db.list_game_tasks, project_id=project_id, limit=10000)
    for task in tasks:
        if (
            task.get("type") == "generate"
            and task.get("status") == "completed"
            and task.get("billing_status") != "snapshot"
            and task.get("video_url")
        ):
            await _snapshot_completed_task_billing(task, {"video_url": task.get("video_url", ""), "status": "completed"})
    file_urls = await _db_call(_project_file_urls, project_id)
    await _db_call(db.delete_game_project, project_id)
    cleanup = await _db_call(_delete_local_files, file_urls, exclude_project_id=project_id)
    return {"ok": True, "cleanup": cleanup}


# Scene persistence
class SaveScenesRequest(BaseModel):
    scenes: dict | list = Field(default_factory=dict)


class AppendScenesRequest(BaseModel):
    scenes: list[dict] = Field(default_factory=list)


class PatchSceneRequest(BaseModel):
    scene: dict = Field(default_factory=dict)


@router.get("/projects/{project_id}/scenes")
async def get_scenes(project_id: str):
    p = await _db_call(db.get_game_project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    import json as _json
    try:
        data = _json.loads(p.get("scenes_json") or "{}")
        if isinstance(data, list):
            return {"generate": data, "replace": []}
        return data
    except Exception:
        return {"generate": [], "replace": []}

@router.put("/projects/{project_id}/scenes")
async def save_scenes(project_id: str, req: SaveScenesRequest):
    import json as _json
    p = await _db_call(db.get_game_project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    await _db_call(db.update_game_project, project_id, scenes_json=_json.dumps(req.scenes, ensure_ascii=False))
    return {"ok": True}


@router.post("/projects/{project_id}/scenes/append")
async def append_scenes(project_id: str, req: AppendScenesRequest):
    if not req.scenes:
        raise HTTPException(400, "No scenes to append")
    result = await _db_call(db.append_game_project_scenes, project_id, req.scenes)
    if not result:
        raise HTTPException(404, "Project not found")
    return result


@router.patch("/projects/{project_id}/scenes/{scene_id}")
async def patch_scene(project_id: str, scene_id: str, req: PatchSceneRequest):
    if not scene_id:
        raise HTTPException(400, "Scene id is required")
    result = await _db_call(db.patch_game_project_scene, project_id, scene_id, req.scene)
    if not result:
        raise HTTPException(404, "Project not found")
    if not result.get("scene"):
        raise HTTPException(404, "Scene not found")
    return result


# Assets
@router.get("/projects/{project_id}/assets")
async def list_assets(project_id: str, type: str = ""):
    return await _db_call(db.list_game_assets, project_id, type_=type)

@router.post("/projects/{project_id}/assets")
async def create_asset(project_id: str, req: CreateAssetRequest):
    return await _db_call(
        db.create_game_asset,
        project_id=project_id, type_=req.type,
        name=req.name, description=req.description,
        image_url=req.image_url,
    )

@router.put("/assets/{asset_id}")
async def update_asset(asset_id: str, req: CreateAssetRequest):
    updates = {}
    if req.name:
        updates["name"] = req.name
    if req.description:
        updates["description"] = req.description
    if req.image_url:
        updates["image_url"] = req.image_url
    if req.type:
        updates["type"] = req.type
    if updates:
        await _db_call(db.update_game_asset, asset_id, **updates)
    return {"ok": True}

@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str):
    asset = await _db_call(db.get_game_asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    await _db_call(db.delete_game_asset, asset_id)
    cleanup = await _db_call(_delete_local_files, _collect_file_urls(asset), exclude_project_id=asset.get("project_id", ""))
    return {"ok": True, "cleanup": cleanup}


@router.post("/files/delete")
async def delete_files(req: DeleteFilesRequest):
    cleanup = await _db_call(_delete_local_files, set(req.urls or []), exclude_project_id=req.project_id)
    return {"ok": True, "cleanup": cleanup}


# Uploads
@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    return await save_game_upload(
        file,
        duration_lookup=lambda url: _db_call(deps.get_local_video_duration_seconds, url),
    )


@router.post("/media_info")
async def media_info(req: MediaInfoRequest):
    return await get_game_media_info(
        req.url,
        duration_lookup=lambda url: _db_call(deps.get_local_video_duration_seconds, url),
    )


# AI image generation
class GenerateAssetImageRequest(BaseModel):
    project_id: str = ""
    prompt: str
    provider: str = "jimeng"
    model: str = "seedream-5.0"
    width: int = 1024
    height: int = 1024
    aspect_ratio: str = ""
    asset_type: str = "character"
    reference_urls: list[str] = Field(default_factory=list)
    edit_mode: bool = False
    image_quality: str = "2K"
    prompt_optimize_mode: str = "standard"
    output_format: str = ""
    enable_web_search: bool = False


IMAGE_ASPECT_RATIO_SIZES: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "16:9": (1280, 720),
    "9:16": (720, 1280),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}


def _image_request_size(req: GenerateAssetImageRequest) -> tuple[int, int, str]:
    ratio = (req.aspect_ratio or "").strip()
    if ratio in IMAGE_ASPECT_RATIO_SIZES:
        width, height = IMAGE_ASPECT_RATIO_SIZES[ratio]
        return width, height, ratio
    width = req.width if 256 <= req.width <= 4096 else 1024
    height = req.height if 256 <= req.height <= 4096 else 1024
    return width, height, f"{width}:{height}"


def _seedream_edit_prompt(prompt: str, reference_count: int) -> str:
    source = "Figure 1 输入参考图" if reference_count <= 1 else "Figure 1 输入参考图"
    return (
        f"图片编辑任务：以{source}作为唯一原图，只执行用户指定的编辑。"
        "输出必须保持与原图相同的主体、构图、镜头、透视、画幅比例、背景、光照、色彩、材质和边框。"
        "不要新增人物、动物、建筑、黑边、留白、水印、装饰图形或任何未被要求的新元素。"
        "如果用户要求修改某个角色、物体或局部元素的颜色、材质或文字，除被明确要求修改的属性外，其它属性都必须保持不变。"
        "特别是角色编辑时，必须保持角色的身份、头身比例、轮廓、朝向、站姿、动作、手脚位置、五官布局、眼睛大小和表情不变，只修改用户指定的颜色或材质。"
        "不要把角色重新画成另一个造型，不要改变角色姿势，不要改变角色所在位置，不要把小角色放大或缩小。"
        "如果用户要求替换文字，只替换对应文字内容，尽量保持原文字的位置、大小、颜色、字体风格、立体感和招牌材质；不要把整张图重新设计成另一张图。"
        f"用户编辑要求：{prompt}"
    )


async def _resolve_jimeng_image_reference(url: str) -> str:
    return await deps.resolve_image_for_external(
        url,
        max_image_bytes=deps.JIMENG_INPUT_IMAGE_MAX_BYTES,
        auto_compress=True,
        target_image_bytes=deps.JIMENG_INPUT_IMAGE_TARGET_BYTES,
        limit_label="即梦参考图",
        cache_prefix="jimeng_ref",
    )


async def _resolve_happyhorse_image_reference(url: str) -> str:
    return await deps.resolve_image_for_external(
        url,
        max_image_bytes=deps.HAPPYHORSE_INPUT_IMAGE_MAX_BYTES,
        auto_compress=True,
        target_image_bytes=deps.HAPPYHORSE_INPUT_IMAGE_TARGET_BYTES,
        limit_label="HappyHorse 参考图",
        cache_prefix="happyhorse_ref",
    )


async def _resolve_provider_image_reference(url: str, provider: str) -> str:
    if provider == "jimeng":
        return await _resolve_jimeng_image_reference(url)
    if provider == "happyhorse":
        return await _resolve_happyhorse_image_reference(url)
    return await deps.resolve_image_for_external(url)


@router.post("/generate_image")
async def generate_asset_image(req: GenerateAssetImageRequest, request: Request):
    """Generate a character/scene reference image from prompt."""

    async def _do():
        image_width, image_height, _ratio = _image_request_size(req)
        reference_count = len(req.reference_urls or [])
        if req.edit_mode and reference_count > 1:
            raise HTTPException(400, "参考图编辑模式当前仅支持 1 张参考图，请只保留原图后重试。")
        prompt = _seedream_edit_prompt(req.prompt, reference_count) if req.edit_mode and reference_count else req.prompt

        if req.provider == "jimeng":
            svc = _jimeng()
            if not svc:
                raise Exception("Jimeng API key is not configured")
            ref_urls = []
            for url in req.reference_urls:
                ref_urls.append(await _resolve_jimeng_image_reference(url))
            size = f"{image_width}x{image_height}"
            result = await _provider_call(
                "jimeng",
                "generate_image",
                lambda: svc.generate_image(
                    prompt=prompt, model=req.model, size=size,
                    reference_urls=ref_urls if ref_urls else None,
                    edit_mode=req.edit_mode,
                    image_quality=req.image_quality,
                    prompt_optimize_mode=req.prompt_optimize_mode,
                    output_format="png",
                    enable_web_search=req.enable_web_search,
                ),
            )
        elif req.provider == "gemini_image":
            svc = _ai()
            if not svc:
                raise Exception("Gemini API key is not configured")
            ref_bytes_list = []
            for url in req.reference_urls:
                b64_url = await deps.resolve_image_for_external(url)
                if b64_url.startswith("data:"):
                    import base64 as b64mod
                    _, payload = b64_url.split(",", 1)
                    ref_bytes_list.append(b64mod.b64decode(payload))
                else:
                    import httpx as _hx
                    async with _hx.AsyncClient(timeout=30) as c:
                        r = await c.get(b64_url); r.raise_for_status()
                        ref_bytes_list.append(r.content)
            result = await _provider_call(
                "gemini_image",
                "generate_image",
                lambda: svc.generate_image(
                    prompt=prompt, model=normalize_video_model_id(req.model),
                    width=image_width, height=image_height,
                    reference_images=ref_bytes_list if ref_bytes_list else None,
                ),
            )
            result = await asyncio.to_thread(deps.save_gemini_image_result, result)
        elif req.provider == "openai_image":
            _ensure_openai_image2_beta_access(request)
            svc = _openai()
            if not svc:
                raise Exception("OpenAI API key is not configured")
            ref_images = []
            for index, url in enumerate((req.reference_urls or [])[:4], start=1):
                image_bytes, mime, ext = await _read_reference_media(url, "image")
                ref_images.append((image_bytes, mime, f"reference_{index}.{ext or 'png'}"))
            # Keep the legacy text-only guard from firing; refs are passed to the service below.
            req.reference_urls = []
            if req.reference_urls:
                raise HTTPException(400, "OpenAI 图片生成当前先只支持文字生图，请先移除参考图后再试。")
            size = f"{image_width}x{image_height}"
            result = await _provider_call(
                "openai_image",
                "generate_image",
                lambda: svc.generate_image(
                    prompt=prompt,
                    model=normalize_video_model_id(req.model),
                    size=size,
                    reference_images=ref_images if ref_images else None,
                ),
            )
            if any(img.get("data") for img in result.get("images", [])):
                result = await asyncio.to_thread(deps.save_gemini_image_result, result)
        else:
            raise Exception(f"不支持的图片服务商: {req.provider}")

        result = await deps.cache_remote_file_result(result)
        return result

    async def _do_with_event():
        try:
            return await _do()
        except Exception as exc:
            await _record_operation_failure(
                "generate_image",
                project_id=req.project_id,
                provider=req.provider,
                model=req.model,
                error=_operation_error_text(exc),
            )
            raise

    return deps.keepalive_response(_do_with_event)


@router.get("/image_models")
async def list_image_models(request: Request):
    """Return all supported image generation models for the UI."""
    from jimeng_service import get_image_model_specs
    from ai_service import GEMINI_IMAGE_MODELS
    from openai_service import OPENAI_IMAGE_MODELS

    models = []
    models.extend(get_image_model_specs())
    models.extend(GEMINI_IMAGE_MODELS)
    models.extend(OPENAI_IMAGE_MODELS)
    return {"models": models}


# AI prompt analysis
@router.post("/analyze_prompt")
async def analyze_prompt(req: AnalyzePromptRequest):
    """Use LLM to generate a video generation prompt from a text description and reference images."""
    _ensure_prompt_model_available(req.model)

    system = (
        "你是专业的视频生成提示词编写师。请根据用户描述和参考素材，直接写出一段详细的中文视频生成提示词。"
        "必须检查每个已附加的参考图片和参考视频，写清可见主体、角色动作、镜头运动、光线、氛围、风格和视频节奏。"
        "如果提供了参考素材，必须基于实际可见内容组织提示词，不要编造看不到的信息。"
        "只返回提示词正文，不要标题或解释。"
    )

    ref_desc = ""
    if req.character_refs:
        ref_desc += f"\n角色参考图数量：{len(req.character_refs)}"
    if req.scene_refs:
        ref_desc += f"\n场景参考图数量：{len(req.scene_refs)}"
    video_refs = [url for url in [req.reference_video_url, *(req.advanced_reference_videos or [])] if url]
    if video_refs:
        ref_desc += f"\n参考视频数量：{len(video_refs)}"

    user_msg = f"用户描述：{req.description}{ref_desc}"

    async def _do():
        try:
            image_refs, video_refs = await _collect_prompt_reference_media(
                req.character_refs,
                req.scene_refs,
                req.reference_video_url,
                req.advanced_reference_videos,
            )
            prompt_text = _chinese_prompt_request(system, user_msg)
            if image_refs or video_refs:
                result = await _prompt_multimodal_chat(prompt_text, req.model, image_refs, video_refs)
            else:
                result = await _prompt_llm_chat(prompt_text, model=req.model)
            prompt = (result or "").strip()
            if not prompt:
                raise Exception("模型没有返回提示词，请稍后重试。")
            _ensure_chinese_prompt_output(prompt, "生成提示词")
            await _record_operation_success(
                "analyze_prompt",
                project_id=req.project_id,
                provider=_prompt_provider(req.model),
                model=req.model,
            )
            return {"prompt": prompt}
        except Exception as exc:
            error_text = _friendly_ai_error(exc)
            await _record_operation_failure(
                "analyze_prompt",
                project_id=req.project_id,
                provider=_prompt_provider(req.model),
                model=req.model,
                error=error_text,
            )
            logger.warning("analyze_prompt model failed for %s: %s", req.model, error_text)
            raise Exception(_prompt_model_failure_message(req.model, "生成提示词", error_text)) from exc

    return deps.keepalive_response(_do)


@router.post("/refresh_prompt")
async def refresh_prompt(req: RefreshPromptRequest):
    """Rewrite / enrich an existing prompt using LLM."""
    _ensure_prompt_model_available(req.model)

    target = (req.target or "video").strip().lower()
    if target == "image":
        system = (
            "你是专业的图片生成提示词优化师。请直接用简体中文润色并丰富用户的图片提示词。"
            "必须保留原始主体和意图。"
            "这是图片提示词，不要加入镜头运动、转场、时间线或视频导演语言。"
            "只返回一段连贯提示词，不要解释。"
        )
    else:
        system = (
            "你是专业的视频生成提示词优化师。请直接用简体中文润色并丰富用户的视频提示词。"
            "必须保留原始意图，并补充画面细节、镜头运动、光线和节奏。"
            "如果附加了参考图片或视频，必须检查素材并基于可见细节润色提示词。"
            "只返回润色后的提示词正文，不要解释。"
        )

    async def _do():
        try:
            image_refs, video_refs = await _collect_prompt_reference_media(
                req.character_refs,
                req.scene_refs,
                req.reference_video_url,
                req.advanced_reference_videos,
            )
            prompt_text = _chinese_prompt_request(system, f"原始提示词：{req.prompt}")
            if image_refs or video_refs:
                result = await _prompt_multimodal_chat(prompt_text, req.model, image_refs, video_refs)
            else:
                result = await _prompt_llm_chat(prompt_text, model=req.model)
            prompt = (result or "").strip()
            if not prompt:
                raise Exception("模型没有返回润色结果，请稍后重试。")
            _ensure_chinese_prompt_output(prompt, "润色提示词")
            await _record_operation_success(
                "refresh_prompt",
                project_id=req.project_id,
                provider=_prompt_provider(req.model),
                model=req.model,
            )
            return {"prompt": prompt}
        except Exception as exc:
            error_text = _friendly_ai_error(exc)
            await _record_operation_failure(
                "refresh_prompt",
                project_id=req.project_id,
                provider=_prompt_provider(req.model),
                model=req.model,
                error=error_text,
            )
            logger.warning("refresh_prompt model failed for %s: %s", req.model, error_text)
            raise Exception(_prompt_model_failure_message(req.model, "润色提示词", error_text)) from exc

    return deps.keepalive_response(_do)


# AI video analysis
@router.post("/analyze_video")
async def analyze_video(req: AnalyzeVideoRequest):
    """Reverse-engineer a video generation prompt using Gemini or GPT vision."""
    is_openai = deps.is_openai_model(req.model)
    is_ark = _is_ark_multimodal_model(req.model)

    if is_ark:
        if not _ark_api_key():
            raise HTTPException(400, "ARK API Key 未配置，请在设置页面配置火山引擎 ARK Key。")
    elif is_openai:
        _openai()
    else:
        if not _ai():
            raise HTTPException(400, "Gemini API key is not configured")

    async def _do():
        try:
            local_path = deps._extract_local_file_path(req.video_url)
            if local_path:
                filename = local_path.rsplit("/", 1)[-1]
                filepath = deps.get_files_dir() / filename
                if not filepath.exists():
                    raise Exception(f"视频文件不存在: {local_path}")
                video_bytes = await asyncio.to_thread(filepath.read_bytes)
                ext = filepath.suffix.lower().lstrip(".")
                mime = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime"}.get(ext, "video/mp4")
            else:
                import httpx as _httpx
                async with _httpx.AsyncClient(timeout=60) as client:
                    resp = await client.get(req.video_url)
                    resp.raise_for_status()
                    video_bytes = resp.content
                ext = "mp4"
                mime = "video/mp4"

            system_prompt = (
                "你是专业的视频提示词反推专家。请仔细观看视频，直接用简体中文写出一段可复刻类似效果的详细视频生成提示词。"
                "必须包含构图、镜头运动、主体、动作、环境、光线、风格、节奏和速度。"
                "如果视频画面中出现英文字幕或英文界面，只能用中文描述其含义，不要照抄英文。"
                "只返回提示词正文，不要标题或解释。"
            )
            system_prompt = _chinese_prompt_request(system_prompt)

            if is_ark:
                b64 = base64.b64encode(video_bytes).decode()
                prompt = await _ark_chat_completion(
                    operation="analyze_video",
                    max_completion_tokens=2048,
                    content=[
                        {"type": "video_url", "video_url": {"url": f"data:{mime};base64,{b64}"}},
                        {"type": "text", "text": system_prompt},
                    ],
                )
                prompt = prompt.strip()
            elif is_openai:
                frames = await _extract_video_frames(video_bytes, ext)
                openai_svc = _openai()
                result = await _provider_call(
                    "openai",
                    "analyze_video",
                    lambda: openai_svc.chat_vision(
                        text_prompt=system_prompt,
                        image_data_list=frames,
                        model=req.model,
                    ),
                )
                prompt = result.strip()
            else:
                from google.genai import types
                svc = _ai()
                parts = [
                    types.Part.from_bytes(data=video_bytes, mime_type=mime),
                    types.Part.from_text(text=system_prompt),
                ]
                response = await _provider_call(
                    "gemini",
                    "analyze_video",
                    lambda: svc.generate_content(
                        model=req.model,
                        contents=types.Content(role="user", parts=parts),
                    ),
                )
                prompt = (response.text or "").strip()
            if not prompt:
                raise Exception("模型没有返回反推提示词，请稍后重试。")
            _ensure_chinese_prompt_output(prompt, "反推提示词")
            await _record_operation_success(
                "analyze_video",
                provider=_prompt_provider(req.model),
                model=req.model,
            )
            return {"prompt": prompt}
        except Exception as exc:
            error_text = _friendly_ai_error(exc)
            await _record_operation_failure(
                "analyze_video",
                provider=_prompt_provider(req.model),
                model=req.model,
                error=error_text,
            )
            raise Exception(error_text) from exc

    return deps.keepalive_response(_do)


async def _extract_video_frames(
    video_bytes: bytes, ext: str = "mp4", max_frames: int | None = None
) -> list[tuple[bytes, str]]:
    """Extract evenly-spaced frames from video bytes using ffmpeg.
    Returns list of (jpeg_bytes, 'image/jpeg') tuples for vision API."""
    import tempfile
    import shutil

    ffmpeg_exe = shutil.which("ffmpeg")
    if not ffmpeg_exe:
        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg_exe = None
    if not ffmpeg_exe:
        raise Exception("服务器缺少视频抽帧组件，GPT 暂时无法分析参考视频；请稍后继续使用 GPT 重试。")

    safe_ext = (ext or "mp4").lower().lstrip(".")
    if safe_ext not in {"mp4", "mov", "webm", "m4v"}:
        safe_ext = "mp4"
    frame_count = max(8, int(max_frames or DEFAULT_FRAME_EXTRACTION_COUNT))

    with tempfile.NamedTemporaryFile(suffix=f".{safe_ext}", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    out_dir = tempfile.mkdtemp(prefix="game-video-frames-")
    try:
        async with _frame_extraction_semaphore:
            duration_seconds = None
            try:
                ffprobe_exe = shutil.which("ffprobe")
                if not ffprobe_exe:
                    raise FileNotFoundError("ffprobe")
                probe = await asyncio.create_subprocess_exec(
                    ffprobe_exe,
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    tmp_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await asyncio.wait_for(probe.communicate(), timeout=10)
                raw_duration = (stdout or b"").decode("utf-8", errors="ignore").strip()
                duration_seconds = float(raw_duration) if raw_duration else None
            except Exception:
                duration_seconds = None

            if duration_seconds and duration_seconds > 0:
                fps_value = max(0.05, frame_count / duration_seconds)
                frame_filter = f"fps={fps_value:.4f}"
                frame_limit = frame_count * 2
            else:
                frame_filter = "fps=1"
                frame_limit = frame_count * 3

            proc = await asyncio.create_subprocess_exec(
                ffmpeg_exe,
                "-i", tmp_path,
                "-vf", frame_filter,
                "-q:v", "2",
                "-frames:v", str(frame_limit),
                f"{out_dir}/frame_%04d.jpg",
                "-y",
                "-loglevel", "error",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=FRAME_EXTRACTION_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                raise Exception("ffmpeg 抽帧超时，请缩短视频或稍后重试")
            if proc.returncode != 0:
                detail = (stderr or b"").decode("utf-8", errors="ignore").strip()
                raise Exception(f"ffmpeg 抽帧失败：{detail[:180]}" if detail else "ffmpeg 抽帧失败")

        frame_files = sorted(
            f for f in os.listdir(out_dir) if f.endswith(".jpg")
        )
        if not frame_files:
            raise Exception("ffmpeg 未抽取到关键帧")

        step = max(1, len(frame_files) // frame_count)
        selected = frame_files[::step][:frame_count]

        frames = []
        for fname in selected:
            with open(os.path.join(out_dir, fname), "rb") as f:
                frames.append((f.read(), "image/jpeg"))
        return frames
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        shutil.rmtree(out_dir, ignore_errors=True)


# AI video generation
@router.post("/generate_video")
async def generate_video(req: GenerateVideoRequest):
    """Generate video from prompt + optional reference images."""
    try:
        validation = validate_generate_video_request(
            provider=req.provider,
            model=req.model,
            duration=req.duration,
            resolution=req.resolution,
            image_url=req.image_url,
            character_refs=req.character_refs,
            scene_refs=req.scene_refs,
            reference_video_url=req.reference_video_url,
            advanced_reference_videos=req.advanced_reference_videos,
        )
    except VideoGenerationValidationError as exc:
        raise HTTPException(400, str(exc))

    async def _do():
        if req.project_id:
            project = await _db_call(db.get_game_project, req.project_id)
            if not project:
                raise HTTPException(404, "Project not found")

        provider = req.provider
        svc = _game_video_svc() if provider == "jimeng" else None
        advanced_reference_videos = [url for url in (req.advanced_reference_videos or []) if url]
        if len(advanced_reference_videos) > 3:
            raise HTTPException(400, "高级视频编辑最多支持 3 个参考视频。")

        resolved_image = ""
        if req.image_url:
            resolved_image = await _resolve_provider_image_reference(req.image_url, provider)

        resolved_char_refs = []
        for url in req.character_refs:
            resolved_char_refs.append(await _resolve_provider_image_reference(url, provider))

        resolved_scene_refs = []
        for url in req.scene_refs:
            resolved_scene_refs.append(await _resolve_provider_image_reference(url, provider))

        all_ref_images = resolved_char_refs + resolved_scene_refs
        resolved_reference_video = ""
        if req.reference_video_url and provider != "jimeng":
            resolved_reference_video = await deps.resolve_video_as_public_url(req.reference_video_url)

        if provider == "jimeng":
            if not svc:
                raise Exception("Jimeng API key is not configured")
            model = validation.model_spec["id"]
            if req.reference_video_url and advanced_reference_videos:
                raise HTTPException(400, "高级视频编辑不能同时使用单参考视频，请保留高级参考视频即可。")
            if req.reference_video_url:
                if model not in ("seedance-2.0", "seedance-2.0-fast"):
                    raise HTTPException(400, "参考视频生成当前仅支持 Seedance 2.0。")
                await _validate_seedance_reference_video_duration(req.reference_video_url)
                resolved_reference_video = await _resolve_seedance_video_reference(svc, req.reference_video_url)
            if advanced_reference_videos:
                if model not in ("seedance-2.0", "seedance-2.0-fast"):
                    raise HTTPException(400, "高级视频编辑当前仅支持 Seedance 2.0。")
                resolved_advanced_video_urls: list[str] = []
                await _validate_seedance_reference_video_total_duration(advanced_reference_videos)
                for video_url in advanced_reference_videos:
                    resolved_advanced_video_urls.append(await _resolve_seedance_video_reference(svc, video_url))
                result = await _provider_call(
                    "jimeng",
                    "edit_video",
                    lambda: svc.edit_video(
                        prompt=req.prompt,
                        model=model,
                        ratio=req.aspect_ratio,
                        duration=req.duration,
                        resolution=req.resolution,
                        image_b64_urls=all_ref_images if all_ref_images else None,
                        video_urls=resolved_advanced_video_urls,
                    ),
                )
            else:
                seedance_first_frame = resolved_image
                seedance_ref_images = all_ref_images
                if model == "seedance-1.5-pro":
                    seedance_15_images = [url for url in [resolved_image, *all_ref_images] if url]
                    if resolved_reference_video:
                        raise HTTPException(400, "Seedance 1.5 Pro 支持首帧/首尾帧图片，不支持参考视频，请移除参考视频后重试。")
                    if len(seedance_15_images) > 2:
                        raise HTTPException(400, "Seedance 1.5 Pro 最多支持 2 张图片：第 1 张作为首帧，第 2 张作为尾帧；请减少图片后重试。")
                    seedance_first_frame = seedance_15_images[0] if seedance_15_images else ""
                    seedance_ref_images = seedance_15_images[1:2]
                else:
                    _ensure_seedance_first_frame_not_mixed(
                        first_frame_url=seedance_first_frame,
                        reference_image_count=len(seedance_ref_images or []),
                        reference_video_count=1 if resolved_reference_video else 0,
                    )
                result = await _provider_call(
                    "jimeng",
                    "generate_video",
                    lambda: svc.generate_video(
                        prompt=req.prompt, model=model,
                        ratio=req.aspect_ratio,
                        duration=req.duration, resolution=req.resolution, image_url=seedance_first_frame,
                        reference_images=seedance_ref_images if seedance_ref_images else None,
                        reference_video=resolved_reference_video,
                    ),
                )
            deps._video_tasks[result["task_id"]] = {**result, "provider": "jimeng"}
            task_record_payload = build_generate_task_record_payload(
                project_id=req.project_id,
                prompt=req.prompt,
                model=model,
                provider="jimeng",
                character_refs=req.character_refs,
                scene_refs=req.scene_refs,
                reference_video_url=req.reference_video_url,
                advanced_reference_videos=advanced_reference_videos,
            )
            task_record_warning = await _ensure_game_task_record(result["task_id"], task_record_payload)
            if task_record_warning:
                result["task_record_warning"] = task_record_warning
            return result

        elif provider == "vidu":
            if resolved_reference_video or advanced_reference_videos:
                raise Exception("VIDU 暂不支持参考视频/高级视频编辑，请切换到 Seedance 2.0")
            svc = _vidu()
            if not svc:
                raise Exception("VIDU API key is not configured")
            model = validation.model_spec["id"]
            first_ref = resolved_image or (all_ref_images[0] if all_ref_images else "")
            if first_ref:
                result = await _provider_call(
                    "vidu",
                    "image_to_video",
                    lambda: svc.image_to_video(
                        image_url=first_ref, prompt=req.prompt,
                        model=model,
                        duration=req.duration, resolution=req.resolution,
                    ),
                )
            else:
                result = await _provider_call(
                    "vidu",
                    "text_to_video",
                    lambda: svc.text_to_video(
                        prompt=req.prompt, model=model,
                        duration=req.duration, resolution=req.resolution,
                        aspect_ratio=req.aspect_ratio,
                    ),
                )
            deps._video_tasks[result["task_id"]] = {**result, "provider": "vidu"}
            task_record_payload = build_generate_task_record_payload(
                project_id=req.project_id,
                prompt=req.prompt,
                model=model,
                provider="vidu",
                character_refs=req.character_refs,
                scene_refs=req.scene_refs,
            )
            task_record_warning = await _ensure_game_task_record(result["task_id"], task_record_payload)
            if task_record_warning:
                result["task_record_warning"] = task_record_warning
            return result

        elif provider == "happyhorse":
            svc = _happyhorse()
            if not svc:
                raise Exception("DashScope API key is not configured")
            model = validation.model_spec["id"]
            first_ref = resolved_image or (all_ref_images[0] if all_ref_images else "")
            if model == "happyhorse-1.0-video-edit":
                video_refs = [url for url in [resolved_reference_video, *advanced_reference_videos] if url]
                if len(video_refs) != 1:
                    raise HTTPException(400, "HappyHorse 视频编辑需要且仅支持 1 个参考视频。")
                edit_video_url = resolved_reference_video or await deps.resolve_video_as_public_url(video_refs[0])
                result = await _provider_call(
                    "happyhorse",
                    "edit_video",
                    lambda: svc.edit_video(
                        video_url=edit_video_url,
                        prompt=req.prompt,
                        reference_images=all_ref_images[:5],
                        model=model,
                        resolution=req.resolution,
                    ),
                )
            elif model == "happyhorse-1.0-r2v":
                if resolved_reference_video or advanced_reference_videos:
                    raise Exception("HappyHorse 参考图生视频不支持参考视频，请使用角色/场景参考图。")
                if not all_ref_images:
                    raise HTTPException(400, "HappyHorse 参考图生视频需要至少 1 张参考图。")
                result = await _provider_call(
                    "happyhorse",
                    "reference_to_video",
                    lambda: svc.reference_to_video(
                        reference_images=all_ref_images[:9],
                        prompt=req.prompt,
                        model=model,
                        duration=req.duration,
                        resolution=req.resolution,
                        aspect_ratio=req.aspect_ratio,
                    ),
                )
            elif model == "happyhorse-1.0-i2v":
                if resolved_reference_video or advanced_reference_videos:
                    raise Exception("HappyHorse 首帧图生视频不支持参考视频，请使用 1 张首帧参考图。")
                if not first_ref:
                    raise HTTPException(400, "HappyHorse 首帧图生视频需要至少 1 张参考图。")
                if len(all_ref_images) > 1:
                    raise HTTPException(400, "HappyHorse 首帧图生视频当前只支持 1 张首帧图。")
                result = await _provider_call(
                    "happyhorse",
                    "image_to_video",
                    lambda: svc.image_to_video(
                        image_url=first_ref,
                        prompt=req.prompt,
                        model=model,
                        duration=req.duration,
                        resolution=req.resolution,
                    ),
                )
            else:
                result = await _provider_call(
                    "happyhorse",
                    "text_to_video",
                    lambda: svc.text_to_video(
                        prompt=req.prompt,
                        model=model,
                        duration=req.duration,
                        resolution=req.resolution,
                        aspect_ratio=req.aspect_ratio,
                    ),
                )
            deps._video_tasks[result["task_id"]] = {**result, "provider": "happyhorse"}
            task_record_payload = build_generate_task_record_payload(
                project_id=req.project_id,
                prompt=req.prompt,
                model=model,
                provider="happyhorse",
                character_refs=req.character_refs,
                scene_refs=req.scene_refs,
                reference_video_url=req.reference_video_url,
                advanced_reference_videos=advanced_reference_videos,
            )
            task_record_warning = await _ensure_game_task_record(result["task_id"], task_record_payload)
            if task_record_warning:
                result["task_record_warning"] = task_record_warning
            return result

        raise Exception(f"不支持的视频服务商: {provider}")

    async def _do_generate_video_with_event():
        try:
            return await _do()
        except Exception as exc:
            await _record_operation_failure(
                "generate_video",
                project_id=req.project_id,
                provider=req.provider,
                model=req.model,
                error=_operation_error_text(exc),
            )
            raise

    return deps.keepalive_response(_do_generate_video_with_event)


# AI video replacement
def _wan():
    k = _user_key("dashscope_api_key")
    if k:
        from wan_service import WanService
        return WanService(api_key=k)
    raise _missing_group_api_key("DashScope Key")

@router.post("/replace_video")
async def replace_video(req: ReplaceVideoRequest):
    """Replace a video character using Seedance or Wan."""

    async def _do():
        if not req.ref_video_url:
            raise Exception("Reference video is required")
        if not req.character_ref:
            raise Exception("Character image is required")

        provider = req.provider or "jimeng"

        if provider == "wan":
            svc = _wan()
            if not svc:
                raise Exception("DashScope API key is not configured")

            image_url = await deps.resolve_image_as_public_url(req.character_ref)
            video_url = await _resolve_seedance_video_reference(svc, req.ref_video_url)

            result = await _provider_call(
                "wan",
                "replace_character",
                lambda: svc.replace_character(
                    image_url=image_url,
                    video_url=video_url,
                    mode=req.mode if req.mode in ("wan-std", "wan-pro") else "wan-std",
                    check_image=req.check_image,
                ),
            )
            deps._video_tasks[result["task_id"]] = {**result, "provider": "wan"}
            task_record_payload = build_replace_task_record_payload(
                project_id=req.project_id,
                prompt=req.prompt or "万相换人",
                model="wan2.2-animate-mix",
                provider="wan",
                character_ref=req.character_ref,
                ref_video_url=req.ref_video_url,
            )
            task_record_warning = await _ensure_game_task_record(result["task_id"], task_record_payload)
            if task_record_warning:
                result["task_record_warning"] = task_record_warning
            return result

        else:
            svc = _game_video_svc()
            if not svc:
                raise Exception("Jimeng API key is not configured")

            await _validate_seedance_reference_video_duration(req.ref_video_url)
            image_url = await _resolve_jimeng_image_reference(req.character_ref)
            video_url = await _resolve_seedance_video_reference(svc, req.ref_video_url)

            result = await _provider_call(
                "jimeng",
                "motion_transfer",
                lambda: svc.motion_transfer(
                    image_url=image_url,
                    video_url=video_url,
                    prompt=req.prompt,
                    resolution=req.resolution,
                ),
            )
            deps._video_tasks[result["task_id"]] = {**result, "provider": "jimeng"}
            task_record_payload = build_replace_task_record_payload(
                project_id=req.project_id,
                prompt=req.prompt or "Seedance 动作模仿",
                model="seedance-2.0",
                provider="jimeng",
                character_ref=req.character_ref,
                ref_video_url=req.ref_video_url,
            )
            task_record_warning = await _ensure_game_task_record(result["task_id"], task_record_payload)
            if task_record_warning:
                result["task_record_warning"] = task_record_warning
            return result

    async def _do_replace_video_with_event():
        try:
            return await _do()
        except Exception as exc:
            await _record_operation_failure(
                "replace_video",
                project_id=req.project_id,
                provider=req.provider,
                model=req.mode if req.provider == "wan" else "seedance-2.0",
                error=_operation_error_text(exc),
            )
            raise

    return deps.keepalive_response(_do_replace_video_with_event)


# Task status
async def _query_provider_task_status(task_id: str, provider: str) -> dict:
    game_svc = _game_video_svc() or _jimeng()
    if provider == "jimeng" and game_svc:
        return await game_svc.query_video_task(task_id)
    if provider == "vidu" and _vidu():
        return await _vidu().query_task(task_id)
    if provider == "happyhorse" and _happyhorse():
        return await _happyhorse().query_task(task_id)
    if provider == "wan" and _wan():
        return await _wan().query_task(task_id)
    raise HTTPException(404, "Task not found or provider is not configured")


async def _query_task_status(task_id: str, *, force_failed_cache_retry: bool = False) -> dict:
    return await query_game_task_status(
        task_id,
        db_call=_db_call,
        query_provider_task_status=_query_provider_task_status,
        ensure_game_task_record=_ensure_game_task_record,
        snapshot_completed_task_billing=_snapshot_completed_task_billing,
        record_operation_failure=_record_operation_failure,
        failed_result_recovery_retry_seconds=FAILED_RESULT_RECOVERY_RETRY_SECONDS,
        force_failed_cache_retry=force_failed_cache_retry,
    )


@router.get("/tasks/{task_id}")
async def game_task_status(task_id: str):
    """Query video generation task status (reuses main video_tasks registry)."""
    try:
        return await _query_task_status(task_id)
    except StatusQueryBusyError:
        return status_query_busy_result(task_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)[:500])


@router.post("/tasks/{task_id}/retry-cache")
async def game_task_retry_result_cache(task_id: str):
    """Retry saving a provider-completed video result without creating a new generation task."""
    try:
        return await retry_game_task_result_cache(
            task_id,
            db_call=_db_call,
            query_task_status=_query_task_status,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)[:500])


@router.post("/tasks/status/batch")
async def game_task_status_batch(req: BatchTaskStatusRequest):
    """Query multiple task statuses in one request to reduce polling overhead."""
    return await batch_query_game_task_statuses(
        req.task_ids,
        query_task_status=_query_task_status,
        concurrency=TASK_STATUS_QUERY_CONCURRENCY,
        batch_limit=TASK_STATUS_BATCH_LIMIT,
    )


def get_video_model_specs() -> list[dict]:
    """Return all supported video model specs for the UI."""
    return _catalog_video_model_specs()


async def _snapshot_completed_task_billing(gt: dict, result: dict):
    """Persist billing at completion time so deleted projects/files do not erase usage cost."""
    model = gt.get("model", "")
    spec = get_video_model_spec(model)
    try:
        price = float(spec.get("price_per_second") or 0)
    except (TypeError, ValueError):
        price = 0.0
    if price <= 0:
        await _db_call(db.update_game_task, gt["id"], billing_status="unpriced")
        return

    output_seconds = await _db_call(deps.get_local_video_duration_seconds, result.get("video_url", ""))
    if not output_seconds:
        await _db_call(db.update_game_task, gt["id"], billing_status="duration_missing")
        return

    input_seconds = 0.0
    if spec.get("price_billing") == "input_output":
        ref_value = gt.get("ref_video_path", "") or ""
        refs: list[str] = []
        if ref_value:
            try:
                parsed = json.loads(ref_value)
                refs = [url for url in parsed if isinstance(url, str)]
            except Exception:
                refs = [ref_value]
        if refs:
            input_seconds = await _db_call(deps.get_local_video_duration_seconds, refs[0]) or 0.0

    billable_seconds = round(output_seconds + input_seconds, 2)
    await _db_call(
        db.update_game_task,
        gt["id"],
        billable_video_seconds=billable_seconds,
        estimated_cost_cny=round(billable_seconds * price, 2),
        billing_status="snapshot",
    )


# Video models
@router.get("/video_models")
async def list_video_models():
    """Return available video models for the game tool."""
    models = get_video_model_specs()
    return {"models": models}


# Task history
@router.get("/projects/{project_id}/tasks")
async def list_project_tasks(project_id: str, limit: int = 50):
    return await _db_call(db.list_game_tasks, project_id=project_id, limit=limit)


# Game-specific settings
GAME_SETTING_KEYS = [
    "game_gemini_api_key", "game_gemini_api_keys", "game_ark_api_key", "game_vidu_api_key",
    "game_dashscope_api_key",
]

class GameSettingRequest(BaseModel):
    key: str
    value: str = ""

@router.get("/settings")
async def get_game_settings():
    result = {}
    for k in GAME_SETTING_KEYS:
        base_key = k.removeprefix("game_")
        v = _user_key(base_key)
        result[k] = ("*" * 8 + v[-4:]) if v and len(v) > 4 else ("***" if v else "")
    result["api_usage_groups"] = deps.get_api_usage_groups()
    result["resolved_api_usage_group"] = deps.current_api_usage_group()
    return result

@router.post("/settings")
async def set_game_setting(req: GameSettingRequest):
    if req.key not in GAME_SETTING_KEYS:
        raise HTTPException(400, f"不支持的设置项: {req.key}")
    raise HTTPException(400, "API Key 已改为按部门/团队统一配置，请到系统设置的 ApiKey 设置中配置对应团队 Key。")
