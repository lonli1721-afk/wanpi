from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

import database as db
import deps
from provider_queue import ProviderBusyError, run_provider_call
from viral_media_service import (
    safe_delete_local_file_if_unreferenced,
    save_viral_upload,
)

logger = logging.getLogger("viral")
router = APIRouter()

MAX_VIRAL_VIDEO_COUNT = max(1, int(os.environ.get("VIRAL_MAX_VIDEO_COUNT", "6") or "6"))
MAX_OPENAI_FRAMES_PER_VIDEO = max(2, int(os.environ.get("VIRAL_OPENAI_FRAMES_PER_VIDEO", "5") or "5"))
ARK_MULTIMODAL_MODEL_ID = "doubao-seed-2-0-pro-260215"
_ai_service_cache: dict[tuple[str, tuple[str, ...]], object] = {}
_ai_service_cache_lock = threading.RLock()

VIRAL_MODELS = [
    {
        "id": "doubao-seed-2-0-pro-260215",
        "name": "火山 Doubao Seed 2.0 Pro",
        "provider": "ark",
    },
    {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro",
        "provider": "gemini",
    },
    {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash（实验）",
        "provider": "gemini",
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro",
        "provider": "gemini",
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider": "gemini",
    },
]

CHINESE_OUTPUT_RULES = """
语言硬性规则：
- 所有用户可见内容必须使用简体中文，包括 summary、video_insights、tags、plans、改写字段里的标题、分析、证据、建议、脚本、分镜和视频提示词。
- 从分析、构思、脚本到视频提示词都必须直接用中文生成；不要先写英文再翻译成中文。
- 不要输出英文句子、英文标题、英文镜头提示词或英文营销术语；不要使用 Hook、CTA、Gameplay、Pacing、Visual、Conversion、Audience 等英文词。
- 视频提示词也必须是中文完整句子；允许保留 16:9、9:16、3D、UI、IP、A/B 这类行业符号或缩写，但不能出现英文描述句。
- JSON 字段名、id、category 枚举值可以按格式要求保留英文；除此之外的字段值必须中文。
- 如果原视频画面里有英文字幕或英文 UI，只能用中文描述其含义，不要照抄英文。
""".strip()

CHINESE_RETRY_RULES = """
上一次输出包含英文用户可见内容，已被系统拦截。请重新生成：
- 必须直接用简体中文输出所有分析、脚本、分镜和视频提示词。
- 不要把英文提示词翻译成中文；请从源头用中文创作。
- 保持内容详细度，不要因为中文约束而缩短分析。
""".strip()

_COMMON_ENGLISH_TERM_TRANSLATIONS = [
    (re.compile(r"\bCTA\b", re.IGNORECASE), "行动引导"),
    (re.compile(r"\bA/B\s*test(?:ing)?\b", re.IGNORECASE), "对照测试"),
    (re.compile(r"\bHook\b", re.IGNORECASE), "钩子"),
    (re.compile(r"\bGameplay\b", re.IGNORECASE), "玩法"),
    (re.compile(r"\bPacing\b", re.IGNORECASE), "节奏"),
    (re.compile(r"\bVisuals?\b", re.IGNORECASE), "画面"),
    (re.compile(r"\bConversion\b", re.IGNORECASE), "转化"),
    (re.compile(r"\bAudience\b", re.IGNORECASE), "受众"),
    (re.compile(r"\bEmotion\b", re.IGNORECASE), "情绪"),
    (re.compile(r"\bRetention\b", re.IGNORECASE), "留存"),
    (re.compile(r"\bClick[-\s]?through\b", re.IGNORECASE), "点击"),
]


def _localize_viral_text(value) -> str:
    text = _clip(value, 2400)
    for pattern, replacement in _COMMON_ENGLISH_TERM_TRANSLATIONS:
        text = pattern.sub(replacement, text)
    return text


class ViralChineseOutputError(ValueError):
    """Raised when model output contains English in user-visible viral fields."""


def _looks_like_english_user_text(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if not re.search(r"[A-Za-z]{3,}", text):
        return False
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    alpha_count = len(re.findall(r"[A-Za-z]", text))
    if cjk_count == 0:
        return True
    return alpha_count >= 18 and alpha_count > cjk_count


def _ensure_chinese_user_texts(values: list[str], context: str) -> None:
    for value in values:
        if _looks_like_english_user_text(value):
            raise ViralChineseOutputError(f"{context}包含英文内容，已拦截。请重新生成中文结果。")


def _friendly_viral_error(exc: Exception) -> str:
    msg = str(exc).strip()
    if "Expecting value" in msg or "JSONDecodeError" in msg or "非 JSON" in msg or "empty response" in msg:
        return "模型通道返回了空响应或非 JSON 内容，通常是代理连接中断、上游返回错误页或模型服务临时异常；请稍后重试，或切换到其他可用模型。"
    if isinstance(exc, ViralChineseOutputError):
        return "模型返回了英文内容，系统已按规则拦截。请重新生成。"
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "Too Many Requests" in msg:
        return "模型当前触发限流或配额不足，请稍后重试。"
    if "500" in msg or "INTERNAL" in msg:
        return "爆款视频分析失败：模型上游返回内部错误。通常是当前模型暂时不稳定、视频素材过大，或新模型权限还未完全开放；请稍后重试，或切换到 Gemini 2.5 Flash / Doubao Seed 2.0 Pro。"
    if "503" in msg or "UNAVAILABLE" in msg or "high demand" in msg:
        return "模型服务当前繁忙，请稍后重试。"
    if "504" in msg or "DEADLINE_EXCEEDED" in msg or "timeout" in msg.lower():
        return "模型响应超时，请稍后重试；如果连续失败，建议减少分析素材数量。"
    if "401" in msg:
        return "模型 API Key 无效或已过期，请检查设置。"
    if "403" in msg or "PERMISSION_DENIED" in msg:
        return "模型 API Key 权限不足，请检查账号、模型权限或重新配置。"
    if "400" in msg or "INVALID_ARGUMENT" in msg:
        return f"模型请求参数错误：{msg[:200]}"
    return msg[:500] or "模型分析失败，请稍后重试。"


def _is_expected_viral_model_error(exc: Exception) -> bool:
    msg = str(exc)
    return isinstance(exc, ViralChineseOutputError) or any(
        token in msg
        for token in (
            "500",
            "INTERNAL",
            "429",
            "RESOURCE_EXHAUSTED",
            "Too Many Requests",
            "503",
            "UNAVAILABLE",
            "high demand",
            "504",
            "DEADLINE_EXCEEDED",
            "timeout",
            "401",
            "403",
            "PERMISSION_DENIED",
            "400",
            "INVALID_ARGUMENT",
        )
    )


class ViralAnalyzeRequest(BaseModel):
    video_ids: list[str] = Field(default_factory=list)
    video_urls: list[str] = Field(default_factory=list)
    game_type: str = ""
    target_user: str = ""
    platform: str = ""
    optimization_goal: str = ""
    model: str = "gemini-2.5-flash"


class ViralPlanRequest(BaseModel):
    tag_ids: list[str] = Field(default_factory=list)
    model: str = ""
    plan_count: int = Field(4, ge=3, le=5)
    style: str = ""
    target_duration: str = ""
    keep_original_hook: bool = True
    cta_strength: str = ""
    primary_tag_id: str = ""


class ViralPlanSaveRequest(BaseModel):
    plan: dict = Field(default_factory=dict)


class ViralPlanRewriteRequest(BaseModel):
    plan: dict = Field(default_factory=dict)
    instruction: str = ""
    targets: list[str] = Field(default_factory=list)
    model: str = ""


class ViralBulkDeleteRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


async def _db_call(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


def _request_user_id(request: Request) -> str:
    user = getattr(request.state, "user", None) or {}
    return user.get("sub", "") or user.get("id", "") or ""


def _env_key(name: str) -> str:
    candidates = {
        "gemini_api_key": ["GAME_GEMINI_API_KEY", "GEMINI_API_KEY"],
        "openai_api_key": ["GAME_OPENAI_API_KEY", "OPENAI_API_KEY"],
        "openai_base_url": ["GAME_OPENAI_BASE_URL", "OPENAI_BASE_URL"],
    }.get(name, [f"GAME_{name.upper()}", name.upper()])
    for env_name in candidates:
        value = (os.environ.get(env_name, "") or "").strip()
        if value:
            return value
    return ""


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
    candidates = [f"game_{name}", name]
    group_value = deps.get_group_api_key(name)
    if group_value:
        return group_value
    for key in candidates:
        val = db.get_user_setting(key, "")
        if val:
            return val
    for key in candidates:
        val = deps.settings_manager.get(key, "")
        if val:
            return val
    return _env_key(name)


def _user_key_pool(name: str) -> list[str]:
    if name == "gemini_api_key":
        candidates = ["game_gemini_api_keys", "game_gemini_api_key", "gemini_api_keys", "gemini_api_key"]
    else:
        candidates = [f"game_{name}s", f"game_{name}", f"{name}s", name]

    from ai_service import split_api_keys
    keys: list[str] = []
    seen: set[str] = set()

    for key in deps.get_group_api_key_pool(name):
        if key not in seen:
            seen.add(key)
            keys.append(key)

    for key_name in candidates:
        for key in split_api_keys(db.get_user_setting(key_name, "")):
            if key not in seen:
                seen.add(key)
                keys.append(key)

    for key_name in candidates:
        for key in split_api_keys(deps.settings_manager.get(key_name, "")):
            if key not in seen:
                seen.add(key)
                keys.append(key)

    for key in _env_key_pool(name):
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def _ai():
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
    return deps.ai_service


def _openai():
    key = _user_key("openai_api_key")
    if not key:
        return deps.openai_service
    from openai_service import OpenAIService
    proxy = deps.get_proxy_url()
    base_url = _user_key("openai_base_url")
    if proxy:
        base_url = f"{proxy}/openai/v1"
    elif not base_url:
        base_url = "https://open-api.mincode.cn/v1"
    return OpenAIService(api_key=key, base_url=base_url)


def _is_ark_multimodal_model(model: str) -> bool:
    return (model or "").strip() == ARK_MULTIMODAL_MODEL_ID


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
    max_completion_tokens: int = 4096,
) -> str:
    api_key = _ark_api_key()
    if not api_key:
        raise HTTPException(400, "ARK API Key 未配置，请在设置页配置火山引擎 ARK Key 后重试。")
    payload = {
        "model": ARK_MULTIMODAL_MODEL_ID,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": max_completion_tokens,
    }

    async def _call():
        async with httpx.AsyncClient(timeout=180) as client:
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
                raise HTTPException(resp.status_code, f"火山模型请求失败：{msg[:300]}")
            try:
                return resp.json()
            except ValueError as exc:
                preview = (resp.text or "").strip()[:300] or "empty response"
                raise HTTPException(502, f"火山模型返回了非 JSON 响应，可能是代理连接中断或上游返回错误页：{preview}") from exc

    data = await _provider_call("ark", operation, _call)
    return str((data.get("choices") or [{}])[0].get("message", {}).get("content") or "")


async def _provider_call(provider: str, operation: str, fn):
    try:
        return await run_provider_call(provider, operation, fn)
    except ProviderBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


def _viral_model_provider(model: str) -> str:
    return "openai" if deps.is_openai_model(model or "") else "gemini"


def _viral_error_category(exc: Exception) -> str:
    msg = str(exc or "")
    if isinstance(exc, ViralChineseOutputError) or "英文内容" in msg:
        return "chinese_policy"
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "Too Many Requests" in msg:
        return "rate_limited_429"
    if "503" in msg or "UNAVAILABLE" in msg or "high demand" in msg or "服务繁忙" in msg:
        return "upstream_503"
    if "504" in msg or "DEADLINE_EXCEEDED" in msg or "timeout" in msg or "超时" in msg:
        return "upstream_504_timeout"
    if "JSON" in msg or "json" in msg or "解析" in msg:
        return "parse_error"
    if isinstance(exc, HTTPException):
        return f"http_{exc.status_code}"
    return "unknown"


def _log_viral_observation(
    operation: str,
    status: str,
    *,
    model: str = "",
    started_at: float,
    analysis_id: str = "",
    video_count: int = 0,
    tag_count: int = 0,
    plan_count: int = 0,
    target_count: int = 0,
    selected_tag_count: int = 0,
    chinese_retry: bool = False,
    error_category: str = "",
) -> None:
    duration_ms = max(0.0, (time.perf_counter() - started_at) * 1000)
    provider = _viral_model_provider(model)
    logger.info(
        "VIRAL_OBS operation=%s status=%s provider=%s model=%s duration_ms=%.1f "
        "analysis_id=%s video_count=%d tag_count=%d plan_count=%d target_count=%d "
        "selected_tag_count=%d chinese_retry=%d error_category=%s",
        operation,
        status,
        provider,
        re.sub(r"[^A-Za-z0-9_.:-]+", "_", model or "unknown")[:80],
        duration_ms,
        re.sub(r"[^A-Za-z0-9_.:-]+", "_", analysis_id or "")[:80],
        int(video_count or 0),
        int(tag_count or 0),
        int(plan_count or 0),
        int(target_count or 0),
        int(selected_tag_count or 0),
        1 if chinese_retry else 0,
        error_category or "",
    )


def _clip(value, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def _slug(value: str, fallback: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fa5-]+", "-", value or "").strip("-").lower()
    return text[:40] or fallback


def _as_list(value, limit: int = 8) -> list[str]:
    if isinstance(value, list):
        return [_clip(item, 260) for item in value if _clip(item, 260)][:limit]
    if value:
        return [_clip(value, 260)]
    return []


def _normalize_tag(raw, index: int) -> dict:
    item = raw if isinstance(raw, dict) else {"label": str(raw or "")}
    label = _localize_viral_text(item.get("label") or item.get("name") or f"爆点 {index + 1}")[:80]
    category = _clip(item.get("category") or "hook", 40)
    try:
        confidence = float(item.get("confidence", 0.75))
    except (TypeError, ValueError):
        confidence = 0.75
    confidence = min(1.0, max(0.0, confidence))
    source_video_indices = item.get("source_video_indices") or item.get("source_videos") or []
    if not isinstance(source_video_indices, list):
        source_video_indices = [source_video_indices] if source_video_indices else []
    normalized_sources: list[int] = []
    for source in source_video_indices[:6]:
        try:
            normalized_sources.append(int(source))
        except (TypeError, ValueError):
            continue
    source_moments = item.get("source_moments") or item.get("moments") or []
    if not isinstance(source_moments, list):
        source_moments = [source_moments] if source_moments else []
    return {
        "id": _slug(str(item.get("id") or label), f"tag-{index + 1}"),
        "label": label,
        "category": category,
        "confidence": confidence,
        "source_video_indices": normalized_sources,
        "source_moments": [_localize_viral_text(moment)[:120] for moment in source_moments if _clip(moment, 120)][:6],
        "evidence": _localize_viral_text(item.get("evidence"))[:360],
        "why_it_works": _localize_viral_text(item.get("why_it_works") or item.get("reason"))[:360],
        "application_note": _localize_viral_text(item.get("application_note") or item.get("how_to_apply"))[:360],
    }


def _normalize_plan(raw, index: int, tag_ids: list[str]) -> dict:
    item = raw if isinstance(raw, dict) else {"title": str(raw or "")}
    return {
        "id": _slug(str(item.get("id") or item.get("title") or ""), f"plan-{uuid.uuid4().hex[:8]}"),
        "title": _localize_viral_text(item.get("title") or f"改版方案 {index + 1}")[:90],
        "selected_tag_ids": tag_ids,
        "source": _clip(item.get("source") or "ai", 40),
        "batch_id": _clip(item.get("batch_id"), 60),
        "batch_label": _localize_viral_text(item.get("batch_label"))[:120],
        "generated_at": _clip(item.get("generated_at"), 60),
        "user_revision_note": _localize_viral_text(item.get("user_revision_note"))[:1000],
        "change_points": [_localize_viral_text(value)[:260] for value in _as_list(item.get("change_points") or item.get("changes"), 8)],
        "test_objective": _localize_viral_text(item.get("test_objective") or item.get("objective"))[:360],
        "script_outline": [_localize_viral_text(value)[:260] for value in _as_list(item.get("script_outline") or item.get("script"), 10)],
        "storyboard_rhythm": [_localize_viral_text(value)[:260] for value in _as_list(item.get("storyboard_rhythm") or item.get("rhythm"), 10)],
        "video_prompt": _localize_viral_text(item.get("video_prompt") or item.get("prompt"))[:1600],
    }


def _normalize_video_insight(raw, index: int) -> dict:
    item = raw if isinstance(raw, dict) else {"summary": str(raw or "")}
    try:
        strength = float(item.get("hook_strength", 7.0))
    except (TypeError, ValueError):
        strength = 7.0
    return {
        "video_index": int(item.get("video_index") or index + 1),
        "video_url": _clip(item.get("video_url"), 300),
        "summary": _localize_viral_text(item.get("summary"))[:500],
        "hook_type": _localize_viral_text(item.get("hook_type"))[:80],
        "hook_strength": min(10.0, max(0.0, strength)),
        "pacing_type": _localize_viral_text(item.get("pacing_type"))[:80],
        "visual_style": _localize_viral_text(item.get("visual_style"))[:160],
        "gameplay": _localize_viral_text(item.get("gameplay"))[:160],
        "issues": [_localize_viral_text(value)[:260] for value in _as_list(item.get("issues"), 5)],
        "recommendations": [_localize_viral_text(value)[:260] for value in _as_list(item.get("recommendations"), 5)],
    }


async def _read_video_bytes(url: str) -> tuple[bytes, str, str]:
    local_path = deps.get_local_file_path_from_url(url)
    if local_path:
        content = await asyncio.to_thread(local_path.read_bytes)
        ext = local_path.suffix.lower().lstrip(".") or "mp4"
    else:
        async with httpx.AsyncClient(timeout=90, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content
        ext = url.split("?", 1)[0].rsplit(".", 1)[-1].lower() if "." in url.split("?", 1)[0] else "mp4"
    mime = {
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "m4v": "video/mp4",
    }.get(ext, "video/mp4")
    return content, mime, ext


async def _call_viral_model(prompt: str, model: str, video_urls: list[str]) -> str:
    selected_model = model or "gemini-2.5-flash"
    if _is_ark_multimodal_model(selected_model):
        content: list[dict] = []
        for url in video_urls:
            video_bytes, mime, _ext = await _read_video_bytes(url)
            b64 = base64.b64encode(video_bytes).decode()
            content.append({"type": "video_url", "video_url": {"url": f"data:{mime};base64,{b64}"}})
        content.append({"type": "text", "text": f"{prompt}\n\n以上媒体按上传顺序排列，请结合视频顺序判断节奏、玩法和爆点。"})
        return await _ark_chat_completion(content=content, operation="viral_video_analysis")
    if deps.is_openai_model(selected_model):
        svc = _openai()
        if not svc:
            raise HTTPException(400, "OpenAI API Key 未配置，请在设置页配置后重试。")
        from routers.game_routes import _extract_video_frames
        frames: list[tuple[bytes, str]] = []
        for url in video_urls:
            video_bytes, _mime, ext = await _read_video_bytes(url)
            frames.extend(await _extract_video_frames(video_bytes, ext=ext, max_frames=MAX_OPENAI_FRAMES_PER_VIDEO))
        return await _provider_call(
            "openai",
            "viral_video_analysis",
            lambda: svc.chat_vision(text_prompt=prompt, image_data_list=frames, model=selected_model),
        )

    svc = _ai()
    if not svc:
        raise HTTPException(400, "Gemini API Key 未配置，请在设置页配置后重试。")
    from google.genai import types
    parts = []
    from routers.game_routes import _extract_video_frames
    for url in video_urls:
        video_bytes, mime, _ext = await _read_video_bytes(url)
        try:
            frames = await _extract_video_frames(video_bytes, ext=_ext, max_frames=MAX_OPENAI_FRAMES_PER_VIDEO)
            for frame_bytes, frame_mime in frames:
                parts.append(types.Part.from_bytes(data=frame_bytes, mime_type=frame_mime))
        except Exception as frame_exc:
            logger.warning("Viral frame extraction failed, sending video directly: %s", frame_exc)
            parts.append(types.Part.from_bytes(data=video_bytes, mime_type=mime))
    parts.append(types.Part.from_text(text=f"{prompt}\n\n以上媒体按上传顺序排列；若是关键帧，请结合画面顺序判断节奏、玩法和爆点。"))
    response = await _provider_call(
        "gemini",
        "viral_video_analysis",
        lambda: svc.generate_content(
            model=selected_model,
            contents=types.Content(role="user", parts=parts),
        ),
    )
    return (response.text or "").strip()


async def _call_text_model(prompt: str, model: str) -> str:
    selected_model = model or "gemini-2.5-flash"
    if _is_ark_multimodal_model(selected_model):
        return await _ark_chat_completion(content=prompt, operation="viral_text", max_completion_tokens=4096)
    if deps.is_openai_model(selected_model):
        svc = _openai()
        if not svc:
            raise HTTPException(400, "OpenAI API Key 未配置，请在设置页配置后重试。")
        return await _provider_call(
            "openai",
            "viral_text",
            lambda: svc.chat(prompt, model=selected_model),
        )
    svc = _ai()
    if not svc:
        raise HTTPException(400, "Gemini API Key 未配置，请在设置页配置后重试。")
    result = await _provider_call(
        "gemini",
        "viral_text",
        lambda: svc.chat(prompt, f"viral_{uuid.uuid4().hex[:8]}", selected_model),
    )
    return result.get("response", "")


async def _retry_viral_model_for_chinese(prompt: str, model: str, video_urls: list[str]) -> str:
    return await _call_viral_model(f"{prompt}\n\n{CHINESE_RETRY_RULES}", model, video_urls)


async def _retry_text_model_for_chinese(prompt: str, model: str) -> str:
    return await _call_text_model(f"{prompt}\n\n{CHINESE_RETRY_RULES}", model)


def _build_analysis_prompt(req: ViralAnalyzeRequest, video_count: int) -> str:
    return f"""
你是资深游戏买量视频创意分析师。请逐个观看用户上传的 {video_count} 个爆款视频，提炼可复用的爆点标签。

上下文：
- 游戏类型：{req.game_type}
- 目标用户：{req.target_user}
- 投放平台：{req.platform}
- 优化目标：{req.optimization_goal}

要求：
- 只输出严格 JSON，不要输出 Markdown。
- {CHINESE_OUTPUT_RULES}
- 先给每个视频一条 video_insights，说明开头钩子、节奏、玩法呈现、画面表现和主要问题；每条 summary 至少 80 个中文字，issues 和 recommendations 各给 2-4 条。
- 给出 6-12 个结构化爆点标签。
- 标签必须来自视频中真实可见或强相关的表现，不要空泛套话。
- evidence、why_it_works、application_note 都要具体，每项至少 40 个中文字，写明来自哪个视频/哪个画面/哪种节奏，以及如何迁移到新广告。
- 尽量给 source_video_indices 和 source_moments，用于前端展示真实证据来源，不要编造不存在的来源。
- category 只能从 hook、visual、gameplay、pacing、emotion、conversion、audience 中选择。

JSON 格式：
{{
  "summary": "整体判断",
  "video_insights": [
    {{
      "video_index": 1,
      "summary": "单条视频分析",
      "hook_type": "开头钩子类型",
      "hook_strength": 8.4,
      "pacing_type": "节奏判断",
      "visual_style": "画面表现",
      "gameplay": "玩法呈现",
      "issues": ["问题 1"],
      "recommendations": ["改进建议 1"]
    }}
  ],
  "tags": [
    {{
      "id": "short_id",
      "label": "爆点标签",
      "category": "hook",
      "confidence": 0.86,
      "source_video_indices": [1],
      "source_moments": ["视频1 0:00-0:03 开头画面"],
      "evidence": "视频证据",
      "why_it_works": "为什么有效",
      "application_note": "如何用于改版"
    }}
  ]
}}
""".strip()


def _build_plan_prompt(analysis: dict, selected_tags: list[dict], req: ViralPlanRequest) -> str:
    tags_text = json.dumps(selected_tags, ensure_ascii=False, indent=2)
    insights_text = json.dumps(analysis.get("video_insights") or [], ensure_ascii=False, indent=2)
    primary_tag = next((tag for tag in selected_tags if tag.get("id") == req.primary_tag_id), None) or selected_tags[0]
    return f"""
你是游戏广告创意导演。基于用户勾选的爆点标签，生成 {req.plan_count} 个可测试的改版方案。

项目上下文：
- 游戏类型：{analysis.get("game_type", "")}
- 目标用户：{analysis.get("target_user", "")}
- 投放平台：{analysis.get("platform", "")}
- 优化目标：{analysis.get("optimization_goal", "")}
- 生成数量：{req.plan_count}
- 主爆点：{primary_tag.get("label", "")}
- 脚本风格：{req.style or "不限定"}
- 目标时长：{req.target_duration or "不限定"}
- 是否保留原钩子：{"是" if req.keep_original_hook else "否，可重构开头钩子"}
- 行动引导强度：{req.cta_strength or "不限定"}

勾选爆点：
{tags_text}

视频洞察：
{insights_text}

要求：
- 只输出严格 JSON，不要输出 Markdown。
- {CHINESE_OUTPUT_RULES}
- 方案之间的核心假设要有差异，便于 A/B 测试。
- 每个方案必须包含改动点、测试目的、脚本大纲、分镜节奏、视频提示词。
- 每个方案都要围绕主爆点展开，同时明确其余勾选爆点如何辅助。
- change_points 至少 3 条，script_outline 至少 5 段，storyboard_rhythm 至少 5 段。
- 视频提示词必须直接用中文写成可用于后续视频生成的完整提示词，至少 180 个中文字，包含画面、动作、镜头、节奏、情绪、字幕/音效建议和结尾行动引导。

JSON 格式：
{{
  "plans": [
    {{
      "id": "short_id",
      "title": "方案名称",
      "change_points": ["改动点 1", "改动点 2"],
      "test_objective": "测试目的",
      "script_outline": ["开头", "中段", "结尾"],
      "storyboard_rhythm": ["0-2s ...", "2-5s ..."],
      "video_prompt": "完整视频生成提示词"
    }}
  ]
}}
""".strip()


REWRITE_TARGETS = {
    "change_points": ("改动点", "change_points", "array"),
    "script_outline": ("脚本大纲", "script_outline", "array"),
    "storyboard_rhythm": ("分镜节奏", "storyboard_rhythm", "array"),
    "video_prompt": ("视频提示词", "video_prompt", "string"),
}


def _build_rewrite_prompt(analysis: dict, plan: dict, targets: list[str], instruction: str) -> str:
    selected = [REWRITE_TARGETS[target] for target in targets if target in REWRITE_TARGETS]
    target_text = "\n".join(f"- {label}：返回字段 `{field}`，类型 {kind}" for label, field, kind in selected)
    plan_text = json.dumps({
        "title": plan.get("title", ""),
        "change_points": plan.get("change_points") or [],
        "test_objective": plan.get("test_objective", ""),
        "script_outline": plan.get("script_outline") or [],
        "storyboard_rhythm": plan.get("storyboard_rhythm") or [],
        "video_prompt": plan.get("video_prompt", ""),
    }, ensure_ascii=False, indent=2)
    tags = [tag for tag in (analysis.get("tags") or []) if tag.get("id") in (plan.get("selected_tag_ids") or [])]
    tags_text = json.dumps(tags, ensure_ascii=False, indent=2)
    insights_text = json.dumps(analysis.get("video_insights") or [], ensure_ascii=False, indent=2)
    return f"""
你是游戏买量短视频脚本改稿导演。请根据用户修改要求，重写指定字段，而不是简单追加文字。

项目上下文：
- 游戏类型：{analysis.get("game_type", "")}
- 目标用户：{analysis.get("target_user", "")}
- 投放平台：{analysis.get("platform", "")}
- 优化目标：{analysis.get("optimization_goal", "")}

用户修改要求：
{instruction}

需要重写的字段：
{target_text}

当前方案：
{plan_text}

已选爆点：
{tags_text}

视频洞察：
{insights_text}

要求：
- 只输出严格 JSON，不要输出 Markdown。
- {CHINESE_OUTPUT_RULES}
- 只返回需要重写的字段，不要返回未选择字段。
- 不是在原文后面追加一句话，而是结合用户要求整体改写对应字段。
- 保留原方案的核心测试目标和已选爆点逻辑，除非用户要求改变。
- `script_outline` 和 `storyboard_rhythm` 必须按一行一个镜头/段落拆分为数组。
- `video_prompt` 必须直接用中文写成一段可用于视频生成的完整提示词，至少 180 个中文字，包含画面、动作、镜头、节奏、情绪、字幕/音效建议和结尾行动引导。

JSON 格式示例：
{{
  "change_points": ["改动点 1"],
  "script_outline": ["0-3s ..."],
  "storyboard_rhythm": ["0-2s ..."],
  "video_prompt": "完整视频提示词"
}}
""".strip()


def _collect_analysis_texts(summary: str, video_insights: list[dict], tags: list[dict]) -> list[str]:
    values = [summary]
    for insight in video_insights:
        values.extend([
            insight.get("summary", ""),
            insight.get("hook_type", ""),
            insight.get("pacing_type", ""),
            insight.get("visual_style", ""),
            insight.get("gameplay", ""),
            *(insight.get("issues") or []),
            *(insight.get("recommendations") or []),
        ])
    for tag in tags:
        values.extend([
            tag.get("label", ""),
            *(tag.get("source_moments") or []),
            tag.get("evidence", ""),
            tag.get("why_it_works", ""),
            tag.get("application_note", ""),
        ])
    return [str(value or "") for value in values if str(value or "").strip()]


def _collect_plan_texts(plans: list[dict]) -> list[str]:
    values: list[str] = []
    for plan in plans:
        values.extend([
            plan.get("title", ""),
            plan.get("batch_label", ""),
            plan.get("user_revision_note", ""),
            plan.get("test_objective", ""),
            plan.get("video_prompt", ""),
            *(plan.get("change_points") or []),
            *(plan.get("script_outline") or []),
            *(plan.get("storyboard_rhythm") or []),
        ])
    return [str(value or "") for value in values if str(value or "").strip()]


def _collect_rewrite_texts(rewritten: dict) -> list[str]:
    values: list[str] = []
    for value in rewritten.values():
        if isinstance(value, list):
            values.extend(value)
        else:
            values.append(value)
    return [str(value or "") for value in values if str(value or "").strip()]


def _parse_rewrite(text: str, targets: list[str]) -> dict:
    data = deps.extract_json(text)
    if not isinstance(data, dict):
        raise Exception("模型没有返回可解析的改写 JSON，请重试。")
    output: dict = {}
    for target in targets:
        if target not in REWRITE_TARGETS:
            continue
        _label, field, kind = REWRITE_TARGETS[target]
        value = data.get(field)
        if kind == "array":
            items = _as_list(value, 12)
            if items:
                output[field] = items
        else:
            text_value = _localize_viral_text(value)
            if text_value:
                output[field] = text_value
    if not output:
        raise Exception("模型没有返回所选字段的改写内容，请重试。")
    _ensure_chinese_user_texts(_collect_rewrite_texts(output), "AI 改写结果")
    return output


def _parse_analysis(text: str, video_urls: list[str]) -> tuple[str, list[dict], list[dict]]:
    data = deps.extract_json(text)
    if not isinstance(data, dict):
        raise Exception("模型没有返回可解析的 JSON，请重试。")
    tags = data.get("tags")
    if not isinstance(tags, list) or not tags:
        raise Exception("模型没有返回爆点标签，请重试。")
    raw_insights = data.get("video_insights") if isinstance(data.get("video_insights"), list) else []
    video_insights = [_normalize_video_insight(item, idx) for idx, item in enumerate(raw_insights[:len(video_urls)])]
    by_index = {item["video_index"]: item for item in video_insights}
    for idx, url in enumerate(video_urls):
        item = by_index.get(idx + 1)
        if item:
            item["video_url"] = item.get("video_url") or url
        else:
            video_insights.append(_normalize_video_insight({"video_index": idx + 1, "video_url": url, "summary": "模型未返回该视频的单独洞察。"}, idx))
    normalized = [_normalize_tag(item, idx) for idx, item in enumerate(tags[:12])]
    seen: set[str] = set()
    for idx, tag in enumerate(normalized):
        base = tag["id"]
        if base in seen:
            tag["id"] = f"{base}-{idx + 1}"
        seen.add(tag["id"])
    summary = _localize_viral_text(data.get("summary"))[:1000]
    _ensure_chinese_user_texts(_collect_analysis_texts(summary, video_insights, normalized), "爆款分析结果")
    return summary, video_insights, normalized


def _parse_plans(text: str, selected_tag_ids: list[str]) -> list[dict]:
    data = deps.extract_json(text)
    if not isinstance(data, dict):
        raise Exception("模型没有返回可解析的 JSON，请重试。")
    raw_plans = data.get("plans")
    if not isinstance(raw_plans, list) or len(raw_plans) < 3:
        raise Exception("模型返回的改版方案不足 3 个，请重试。")
    plans = [_normalize_plan(item, idx, selected_tag_ids) for idx, item in enumerate(raw_plans[:5])]
    seen: set[str] = set()
    for idx, plan in enumerate(plans):
        base = plan["id"]
        if base in seen:
            plan["id"] = f"{base}-{idx + 1}"
        seen.add(plan["id"])
    _ensure_chinese_user_texts(_collect_plan_texts(plans), "爆款脚本方案")
    return plans


def _append_plan_batch(existing_plans: list[dict], generated_plans: list[dict], selected_tag_ids: list[str]) -> list[dict]:
    batch_id = f"batch-{uuid.uuid4().hex[:8]}"
    generated_at = datetime.now(timezone.utc).isoformat()
    existing_ids = {plan.get("id") for plan in existing_plans if plan.get("id")}
    next_batch = []
    for idx, plan in enumerate(generated_plans):
        base_id = _slug(str(plan.get("id") or plan.get("title") or ""), f"plan-{uuid.uuid4().hex[:8]}")
        plan_id = base_id
        if plan_id in existing_ids:
            plan_id = f"{base_id}-{batch_id.replace('batch-', '')}"
        normalized = _normalize_plan({
            **plan,
            "id": plan_id,
            "source": "ai",
            "batch_id": batch_id,
            "batch_label": f"{len(selected_tag_ids)} 个爆点",
            "generated_at": generated_at,
        }, idx, selected_tag_ids)
        if normalized["id"] in existing_ids:
            normalized["id"] = f"{normalized['id']}-{idx + 1}"
        existing_ids.add(normalized["id"])
        next_batch.append(normalized)
    return next_batch + existing_plans


async def _resolve_video_urls(req: ViralAnalyzeRequest, user_id: str) -> tuple[list[str], list[str]]:
    video_ids: list[str] = []
    video_urls: list[str] = []
    if req.video_urls:
        raise HTTPException(400, "爆款工作台只允许分析当前用户已上传的素材，请先上传视频后再分析。")
    if req.video_ids:
        deduped_ids = list(dict.fromkeys(req.video_ids))
        records = await _db_call(db.get_viral_videos_by_ids, deduped_ids, user_id=user_id)
        if len(records) != len(deduped_ids):
            raise HTTPException(404, "选择的视频不存在或不属于当前用户。")
        video_ids = [item["id"] for item in records]
        video_urls.extend([item["file_url"] for item in records])
    if not video_urls:
        raise HTTPException(400, "请至少上传或选择 1 个爆款视频。")
    if len(video_urls) > MAX_VIRAL_VIDEO_COUNT:
        raise HTTPException(400, f"单次最多分析 {MAX_VIRAL_VIDEO_COUNT} 个爆款视频。")
    return video_ids, video_urls


@router.get("/videos")
async def list_videos(request: Request, limit: int = 100):
    user_id = _request_user_id(request)
    limit = min(200, max(1, int(limit or 100)))
    videos = await _db_call(db.list_viral_videos, user_id=user_id, limit=limit)
    return {"videos": videos}


@router.get("/models")
async def list_models():
    return {"models": VIRAL_MODELS}


@router.post("/upload")
async def upload_video(request: Request, file: UploadFile = File(...)):
    user_id = _request_user_id(request)
    return await save_viral_upload(file, user_id=user_id)


@router.delete("/videos/{video_id}")
async def delete_video(request: Request, video_id: str):
    user_id = _request_user_id(request)
    video = await _db_call(db.get_viral_video, video_id, user_id=user_id)
    if not video:
        raise HTTPException(404, "视频不存在或不属于当前用户。")
    await _db_call(db.delete_viral_video, video_id, user_id=user_id)
    cleanup = await _db_call(safe_delete_local_file_if_unreferenced, video.get("file_url", ""), user_id)
    return {"ok": True, "deleted_id": video_id, "cleanup": cleanup}


@router.post("/videos/delete")
async def delete_videos(request: Request, req: ViralBulkDeleteRequest):
    user_id = _request_user_id(request)
    ids = [item for item in dict.fromkeys(req.ids or []) if item]
    if not ids:
        raise HTTPException(400, "请选择要删除的素材。")
    deleted: list[str] = []
    cleanups: list[dict] = []
    for video_id in ids[:100]:
        video = await _db_call(db.get_viral_video, video_id, user_id=user_id)
        if not video:
            continue
        await _db_call(db.delete_viral_video, video_id, user_id=user_id)
        cleanups.append(await _db_call(safe_delete_local_file_if_unreferenced, video.get("file_url", ""), user_id))
        deleted.append(video_id)
    return {"ok": True, "deleted_ids": deleted, "cleanup": cleanups}


@router.get("/analyses")
async def list_analyses(request: Request, limit: int = 50):
    user_id = _request_user_id(request)
    limit = min(100, max(1, int(limit or 50)))
    analyses = await _db_call(db.list_viral_analyses, user_id=user_id, limit=limit)
    return {"analyses": analyses}


@router.get("/analyses/{analysis_id}")
async def get_analysis(request: Request, analysis_id: str):
    user_id = _request_user_id(request)
    analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    return analysis


@router.delete("/analyses/{analysis_id}")
async def delete_analysis(request: Request, analysis_id: str):
    user_id = _request_user_id(request)
    analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    await _db_call(db.delete_viral_analysis, analysis_id, user_id=user_id)
    return {"ok": True, "deleted_id": analysis_id}


@router.post("/analyses/delete")
async def delete_analyses(request: Request, req: ViralBulkDeleteRequest):
    user_id = _request_user_id(request)
    ids = [item for item in dict.fromkeys(req.ids or []) if item]
    if not ids:
        raise HTTPException(400, "请选择要删除的分析记录。")
    deleted: list[str] = []
    for analysis_id in ids[:100]:
        analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
        if not analysis:
            continue
        await _db_call(db.delete_viral_analysis, analysis_id, user_id=user_id)
        deleted.append(analysis_id)
    return {"ok": True, "deleted_ids": deleted}


@router.post("/analyze")
async def analyze_videos(request: Request, req: ViralAnalyzeRequest):
    user_id = _request_user_id(request)
    video_ids, video_urls = await _resolve_video_urls(req, user_id)
    model = req.model or "gemini-2.5-flash"
    analysis = await _db_call(
        db.create_viral_analysis,
        user_id=user_id,
        game_type=req.game_type,
        target_user=req.target_user,
        platform=req.platform,
        optimization_goal=req.optimization_goal,
        model=model,
        video_ids=video_ids,
        video_urls=video_urls,
        status="processing",
    )

    async def _do():
        started_at = time.perf_counter()
        chinese_retry = False
        summary = ""
        video_insights: list[dict] = []
        tags: list[dict] = []
        try:
            prompt = _build_analysis_prompt(req, len(video_urls))
            text = await _call_viral_model(prompt, model, video_urls)
            try:
                summary, video_insights, tags = _parse_analysis(text, video_urls)
            except ViralChineseOutputError:
                logger.warning("Viral analysis returned English, retrying strict Chinese user=%s analysis=%s", user_id, analysis["id"])
                chinese_retry = True
                retry_text = await _retry_viral_model_for_chinese(prompt, model, video_urls)
                summary, video_insights, tags = _parse_analysis(retry_text, video_urls)
        except Exception as exc:
            error_text = _friendly_viral_error(exc)
            _log_viral_observation(
                "analyze",
                "failed",
                model=model,
                started_at=started_at,
                analysis_id=analysis["id"],
                video_count=len(video_urls),
                chinese_retry=chinese_retry,
                error_category=_viral_error_category(exc),
            )
            if _is_expected_viral_model_error(exc):
                logger.warning(
                    "Viral analysis model failed without fallback user=%s analysis=%s reason=%s",
                    user_id,
                    analysis["id"],
                    error_text,
                )
            else:
                logger.exception("Viral analysis AI failed without fallback user=%s analysis=%s", user_id, analysis["id"])
            await _db_call(
                db.update_viral_analysis,
                analysis["id"],
                status="failed",
                error=error_text,
            )
            raise Exception(error_text) from exc

        if summary:
            tags.insert(0, {
                "id": "summary",
                "label": "整体判断",
                "category": "audience",
                "confidence": 1,
                "evidence": summary,
                "why_it_works": "",
                "application_note": "",
            })
        await _db_call(
            db.update_viral_analysis,
            analysis["id"],
            video_insights=video_insights,
            tags=tags,
            status="completed",
            error="",
        )
        _log_viral_observation(
            "analyze",
            "success",
            model=model,
            started_at=started_at,
            analysis_id=analysis["id"],
            video_count=len(video_urls),
            tag_count=len(tags),
            chinese_retry=chinese_retry,
        )
        return await _db_call(db.get_viral_analysis, analysis["id"], user_id=user_id)

    return deps.keepalive_response(_do)


@router.post("/analyses/{analysis_id}/plans")
async def generate_plans(request: Request, analysis_id: str, req: ViralPlanRequest):
    user_id = _request_user_id(request)
    analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    tags = analysis.get("tags") or []
    selected_ids = [tag_id for tag_id in req.tag_ids if tag_id and tag_id != "summary"]
    selected_tags = [tag for tag in tags if tag.get("id") in selected_ids]
    if not selected_tags:
        raise HTTPException(400, "请至少勾选 1 个爆点标签。")
    model = req.model or analysis.get("model") or "gemini-2.5-flash"

    async def _do():
        started_at = time.perf_counter()
        chinese_retry = False
        try:
            prompt = _build_plan_prompt(analysis, selected_tags, req)
            text = await _call_text_model(prompt, model)
            try:
                plans = _parse_plans(text, selected_ids)
            except ViralChineseOutputError:
                logger.warning("Viral plans returned English, retrying strict Chinese user=%s analysis=%s", user_id, analysis_id)
                chinese_retry = True
                retry_text = await _retry_text_model_for_chinese(prompt, model)
                plans = _parse_plans(retry_text, selected_ids)
        except Exception as exc:
            error_text = _friendly_viral_error(exc)
            _log_viral_observation(
                "plans",
                "failed",
                model=model,
                started_at=started_at,
                analysis_id=analysis_id,
                selected_tag_count=len(selected_ids),
                chinese_retry=chinese_retry,
                error_category=_viral_error_category(exc),
            )
            if _is_expected_viral_model_error(exc):
                logger.warning(
                    "Viral plan model failed without fallback user=%s analysis=%s reason=%s",
                    user_id,
                    analysis_id,
                    error_text,
                )
            else:
                logger.exception("Viral plan AI failed without fallback user=%s analysis=%s", user_id, analysis_id)
            await _db_call(db.update_viral_analysis, analysis_id, error=error_text)
            raise Exception(error_text) from exc
        next_batch = _append_plan_batch([], plans, selected_ids)
        updated = await _db_call(
            db.append_viral_analysis_plans,
            analysis_id,
            next_batch,
            user_id=user_id,
            status="completed",
            error="",
        )
        if not updated:
            raise HTTPException(404, "分析记录不存在或不属于当前用户。")
        _log_viral_observation(
            "plans",
            "success",
            model=model,
            started_at=started_at,
            analysis_id=analysis_id,
            selected_tag_count=len(selected_ids),
            plan_count=len(plans),
            chinese_retry=chinese_retry,
        )
        return updated

    return deps.keepalive_response(_do)


@router.post("/analyses/{analysis_id}/plans/save")
async def save_plan(request: Request, analysis_id: str, req: ViralPlanSaveRequest):
    user_id = _request_user_id(request)
    analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    raw_plan = req.plan if isinstance(req.plan, dict) else {}
    if not raw_plan:
        raise HTTPException(400, "请填写要保存的方案内容。")
    plans = analysis.get("plans") or []
    incoming_id = _slug(str(raw_plan.get("id") or raw_plan.get("title") or ""), f"manual-{uuid.uuid4().hex[:8]}")
    existing_plan = next((plan for plan in plans if plan.get("id") == incoming_id), {})
    selected_tag_ids = raw_plan.get("selected_tag_ids") if isinstance(raw_plan.get("selected_tag_ids"), list) else []
    if not selected_tag_ids:
        selected_tag_ids = [tag_id for tag_id in raw_plan.get("tag_ids", []) if isinstance(tag_id, str)] if isinstance(raw_plan.get("tag_ids"), list) else []
    if not selected_tag_ids and existing_plan:
        selected_tag_ids = existing_plan.get("selected_tag_ids") or []
    source = raw_plan.get("source") or ("edited" if existing_plan else "manual")
    normalized = _normalize_plan({**existing_plan, **raw_plan, "id": incoming_id, "source": source}, len(plans), selected_tag_ids)
    updated = await _db_call(
        db.upsert_viral_analysis_plan,
        analysis_id,
        normalized,
        user_id=user_id,
        status="completed",
    )
    if not updated:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    return updated


@router.post("/analyses/{analysis_id}/plans/rewrite")
async def rewrite_plan(request: Request, analysis_id: str, req: ViralPlanRewriteRequest):
    user_id = _request_user_id(request)
    analysis = await _db_call(db.get_viral_analysis, analysis_id, user_id=user_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在或不属于当前用户。")
    instruction = _clip(req.instruction, 1200)
    if not instruction:
        raise HTTPException(400, "请先填写修改要求。")
    targets = [target for target in req.targets if target in REWRITE_TARGETS]
    if not targets:
        raise HTTPException(400, "请至少选择一个要 AI 改写的内容。")
    raw_plan = req.plan if isinstance(req.plan, dict) else {}
    if not raw_plan:
        raise HTTPException(400, "请先选择或填写一个脚本方案。")
    selected_tag_ids = raw_plan.get("selected_tag_ids") if isinstance(raw_plan.get("selected_tag_ids"), list) else []
    normalized = _normalize_plan(raw_plan, 0, [tag_id for tag_id in selected_tag_ids if isinstance(tag_id, str)])
    model = req.model or analysis.get("model") or "gemini-2.5-flash"

    async def _do():
        started_at = time.perf_counter()
        chinese_retry = False
        try:
            prompt = _build_rewrite_prompt(analysis, normalized, targets, instruction)
            text = await _call_text_model(prompt, model)
            try:
                rewritten = _parse_rewrite(text, targets)
            except ViralChineseOutputError:
                logger.warning("Viral rewrite returned English, retrying strict Chinese user=%s analysis=%s", user_id, analysis_id)
                chinese_retry = True
                retry_text = await _retry_text_model_for_chinese(prompt, model)
                rewritten = _parse_rewrite(retry_text, targets)
        except Exception as exc:
            _log_viral_observation(
                "rewrite",
                "failed",
                model=model,
                started_at=started_at,
                analysis_id=analysis_id,
                target_count=len(targets),
                chinese_retry=chinese_retry,
                error_category=_viral_error_category(exc),
            )
            raise
        _log_viral_observation(
            "rewrite",
            "success",
            model=model,
            started_at=started_at,
            analysis_id=analysis_id,
            target_count=len(targets),
            chinese_retry=chinese_retry,
        )
        return {
            "analysis_id": analysis_id,
            "plan_id": normalized.get("id"),
            "rewritten": rewritten,
        }

    return deps.keepalive_response(_do)
