from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from typing import Optional, AsyncGenerator, List, Callable, Any
from google import genai
from google.genai import types

log = logging.getLogger(__name__)

GEMINI_IMAGE_MODELS = [
    {"id": "gemini-3.1-flash-image-preview", "name": "Nano Banana 2 (极速)", "provider": "gemini_image"},
    {"id": "gemini-3-pro-image-preview", "name": "Nano Banana Pro (高质量)", "provider": "gemini_image"},
    {"id": "gemini-2.5-flash-image", "name": "Nano Banana (经济)", "provider": "gemini_image"},
]


_GEMINI_ASPECT_RATIOS = [
    (1, 1), (1, 4), (1, 8), (2, 3), (3, 2), (3, 4),
    (4, 1), (4, 3), (4, 5), (5, 4), (8, 1), (9, 16), (16, 9), (21, 9),
]


def _size_to_gemini_aspect(width: int, height: int) -> str:
    """Convert pixel dimensions to the closest Gemini-supported aspect ratio."""
    target = width / height
    best, best_diff = "1:1", float("inf")
    for w, h in _GEMINI_ASPECT_RATIOS:
        diff = abs(target - w / h)
        if diff < best_diff:
            best_diff = diff
            best = f"{w}:{h}"
    return best


def _friendly_error(e: Exception) -> str:
    msg = str(e)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return "该模型当前触发限流或配额不足，请稍后重试，或检查 Google AI Studio 配额。"
    if "503" in msg or "UNAVAILABLE" in msg:
        return "模型服务当前繁忙，请稍后重试。"
    if "504" in msg or "DEADLINE_EXCEEDED" in msg:
        return "模型响应超时，请稍后重试；如果连续失败，建议缩短提示词与参考素材。"
    if "404" in msg or "NOT_FOUND" in msg:
        return "模型不存在或已下线，请检查当前模型配置。"
    if "403" in msg or "PERMISSION_DENIED" in msg:
        return "API Key 权限不足，请检查 Key 是否正确或重新生成。"
    if "400" in msg or "INVALID_ARGUMENT" in msg:
        return "请求参数错误：" + msg[:200]
    return msg[:300]


def split_api_keys(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        raw_items = value
    else:
        text = str(value).replace("\n", ",").replace(";", ",")
        raw_items = text.split(",")

    keys: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def _is_rate_limit_error(e: Exception) -> bool:
    msg = str(e)
    markers = (
        "429",
        "RESOURCE_EXHAUSTED",
        "quota",
        "rate limit",
        "rate_limit",
        "免费配额已用尽",
        "限流",
        "请求过于频繁",
    )
    return any(marker.lower() in msg.lower() for marker in markers)


class AIService:
    def __init__(
        self,
        api_key: str,
        proxy_base_url: str = "",
        api_keys: Optional[list[str]] = None,
        cooldown_seconds: int | None = None,
        max_concurrency_per_key: int | None = None,
        project_max_concurrency: int | None = None,
        project_min_interval_seconds: float | None = None,
        queue_timeout_seconds: float | None = None,
    ):
        keys = split_api_keys(api_keys or [])
        keys.extend(split_api_keys(api_key))
        deduped: list[str] = []
        seen: set[str] = set()
        for key in keys:
            if key in seen:
                continue
            seen.add(key)
            deduped.append(key)
        if not deduped:
            raise ValueError("Gemini API key is required")

        self._client_opts = {}
        if proxy_base_url:
            self._client_opts["http_options"] = types.HttpOptions(base_url=proxy_base_url, timeout=300_000)
        self._clients = [(key, genai.Client(api_key=key, **self._client_opts)) for key in deduped]
        self.client = self._clients[0][1]
        self.key_count = len(self._clients)
        if cooldown_seconds is None:
            cooldown_seconds = int(os.environ.get("GEMINI_KEY_COOLDOWN_SECONDS", "90") or "90")
        if max_concurrency_per_key is None:
            max_concurrency_per_key = int(os.environ.get("GEMINI_MAX_CONCURRENCY_PER_KEY", "2") or "2")
        if project_max_concurrency is None:
            project_max_concurrency = int(os.environ.get("GEMINI_PROJECT_MAX_CONCURRENCY", "2") or "2")
        if project_min_interval_seconds is None:
            project_min_interval_seconds = float(os.environ.get("GEMINI_PROJECT_MIN_INTERVAL_SECONDS", "6") or "6")
        if queue_timeout_seconds is None:
            queue_timeout_seconds = float(os.environ.get("GEMINI_QUEUE_TIMEOUT_SECONDS", "90") or "90")
        self._cooldown_seconds = max(5, int(cooldown_seconds or 90))
        self._queue_timeout_seconds = max(1.0, float(queue_timeout_seconds or 90))
        self._project_min_interval_seconds = max(0.0, float(project_min_interval_seconds or 0))
        self._project_limit = max(1, int(project_max_concurrency or 1))
        self._key_limit = max(1, int(max_concurrency_per_key or 2))
        self._project_semaphore = asyncio.Semaphore(self._project_limit)
        self._project_pace_lock = asyncio.Lock()
        self._next_project_request_at = 0.0
        self._key_semaphores = {
            key: asyncio.Semaphore(self._key_limit)
            for key, _client in self._clients
        }
        self._key_stats = {
            key: {"total_started": 0, "total_completed": 0, "total_rate_limited": 0, "total_errors": 0}
            for key, _client in self._clients
        }
        self._project_started = 0
        self._project_completed = 0
        self._project_queue_timeouts = 0
        self._rate_limited_until: dict[str, float] = {}
        self._cursor = 0
        self._key_lock = asyncio.Lock()
        self.conversations: dict[str, list[types.Content]] = {}

    @staticmethod
    def _semaphore_snapshot(semaphore: asyncio.Semaphore, limit: int) -> dict:
        available = max(0, int(getattr(semaphore, "_value", 0)))
        waiters_raw = getattr(semaphore, "_waiters", None) or []
        waiting = sum(1 for waiter in waiters_raw if not waiter.done())
        return {
            "limit": limit,
            "active": max(0, limit - available),
            "available": available,
            "waiting": waiting,
            "saturated": available <= 0,
        }

    @staticmethod
    def _redact_key(key: str) -> str:
        if not key:
            return ""
        suffix = key[-4:] if len(key) >= 4 else key
        return f"...{suffix}"

    def key_pool_snapshot(self, scope: str = "") -> dict:
        now = time.monotonic()
        project = self._semaphore_snapshot(self._project_semaphore, self._project_limit)
        project.update({
            "min_interval_seconds": self._project_min_interval_seconds,
            "queue_timeout_seconds": self._queue_timeout_seconds,
            "cooldown_seconds": self._cooldown_seconds,
            "total_started": self._project_started,
            "total_completed": self._project_completed,
            "total_queue_timeouts": self._project_queue_timeouts,
            "next_request_in_seconds": round(max(0.0, self._next_project_request_at - now), 3),
        })

        keys = []
        cooling_down_count = 0
        for index, (key, _client) in enumerate(self._clients):
            cooldown_remaining = max(0.0, self._rate_limited_until.get(key, 0) - now)
            if cooldown_remaining > 0:
                cooling_down_count += 1
            row = self._semaphore_snapshot(self._key_semaphores[key], self._key_limit)
            row.update({
                "index": index,
                "key_hint": self._redact_key(key),
                "cooling_down": cooldown_remaining > 0,
                "cooldown_remaining_seconds": round(cooldown_remaining, 3),
                **self._key_stats.get(key, {}),
            })
            keys.append(row)

        return {
            "provider": "gemini",
            "scope": scope,
            "key_count": self.key_count,
            "cooling_down_count": cooling_down_count,
            "available_key_count": max(0, self.key_count - cooling_down_count),
            "project": project,
            "keys": keys,
        }

    async def _pick_client(self):
        now = time.monotonic()
        queued_candidate = None
        async with self._key_lock:
            for _ in range(len(self._clients)):
                key, client = self._clients[self._cursor % len(self._clients)]
                self._cursor = (self._cursor + 1) % len(self._clients)
                if self._rate_limited_until.get(key, 0) > now:
                    continue
                semaphore = self._key_semaphores[key]
                if not semaphore.locked():
                    return key, client
                if queued_candidate is None:
                    queued_candidate = (key, client)
        if queued_candidate:
            return queued_candidate
        return None, None

    async def _mark_rate_limited(self, key: str):
        async with self._key_lock:
            self._rate_limited_until[key] = time.monotonic() + self._cooldown_seconds

    async def _acquire_project_slot(self):
        try:
            await asyncio.wait_for(self._project_semaphore.acquire(), timeout=self._queue_timeout_seconds)
        except asyncio.TimeoutError:
            self._project_queue_timeouts += 1
            raise Exception("Gemini 当前请求较多，排队超时，请稍后重试。")

    async def _wait_for_project_pacing(self):
        if self._project_min_interval_seconds <= 0:
            return
        async with self._project_pace_lock:
            now = time.monotonic()
            wait_seconds = max(0.0, self._next_project_request_at - now)
            if wait_seconds:
                await asyncio.sleep(wait_seconds)
                now = time.monotonic()
            self._next_project_request_at = max(now, self._next_project_request_at) + self._project_min_interval_seconds

    async def _call_with_key_rotation(self, call: Callable[[Any], Any]):
        await self._acquire_project_slot()
        self._project_started += 1
        try:
            last_error: Exception | None = None
            attempts = max(1, len(self._clients))
            for _ in range(attempts):
                key, client = await self._pick_client()
                if not client:
                    break
                try:
                    async with self._key_semaphores[key]:
                        if self._rate_limited_until.get(key, 0) > time.monotonic():
                            continue
                        self._key_stats[key]["total_started"] += 1
                        await self._wait_for_project_pacing()
                        try:
                            return await asyncio.to_thread(call, client)
                        finally:
                            self._key_stats[key]["total_completed"] += 1
                except Exception as e:
                    if not _is_rate_limit_error(e):
                        self._key_stats[key]["total_errors"] += 1
                        raise
                    last_error = e
                    self._key_stats[key]["total_rate_limited"] += 1
                    await self._mark_rate_limited(key)
                    log.warning("Gemini key hit rate limit; trying next key if available")

            if last_error:
                raise Exception("所有 Gemini API Key 当前都触发限流，请稍后重试或补充其他项目的 Key。")
            raise Exception("所有 Gemini API Key 当前都在冷却中，请稍后重试。")
        finally:
            self._project_completed += 1
            self._project_semaphore.release()

    async def generate_content(self, *, model: str, contents, config=None):
        def _call(client):
            kwargs = {"model": model, "contents": contents}
            if config is not None:
                kwargs["config"] = config
            return client.models.generate_content(**kwargs)

        return await self._call_with_key_rotation(_call)

    async def generate_content_stream(self, *, model: str, contents):
        def _call(client):
            return client.models.generate_content_stream(model=model, contents=contents)

        return await self._call_with_key_rotation(_call)

    def _get_history(self, conversation_id: str) -> list[types.Content]:
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = []
        return self.conversations[conversation_id]

    def clear_conversation(self, conversation_id: str):
        self.conversations.pop(conversation_id, None)

    async def chat(self, message: str, conversation_id: Optional[str] = None, model: str = "gemini-2.5-flash") -> dict:
        cid = conversation_id or "default"
        history = self._get_history(cid)

        history.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

        try:
            response = await self.generate_content(model=model, contents=history)
        except Exception as e:
            history.pop()
            raise Exception(_friendly_error(e))

        assistant_text = response.text or ""
        history.append(types.Content(role="model", parts=[types.Part.from_text(text=assistant_text)]))

        return {
            "response": assistant_text,
            "conversation_id": cid,
            "model": model,
        }

    async def generate_image(
        self,
        prompt: str,
        model: str = "gemini-3.1-flash-image-preview",
        width: int = 1024,
        height: int = 1024,
        reference_images: Optional[List[bytes]] = None,
    ) -> dict:
        """Generate an image using Gemini's native image generation."""
        parts: list = []
        for img_bytes in (reference_images or []):
            parts.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))
        parts.append(types.Part.from_text(text=prompt))

        aspect_ratio = _size_to_gemini_aspect(width, height)

        config = types.GenerateContentConfig(
            response_modalities=["Image", "Text"],
            image_config=types.ImageConfig(
                aspect_ratio=aspect_ratio,
            ),
        )

        try:
            response = await self.generate_content(
                model=model,
                contents=types.Content(role="user", parts=parts),
                config=config,
            )
        except Exception as e:
            raise Exception(_friendly_error(e))

        images = []
        for part in (response.candidates[0].content.parts if response.candidates else []):
            if part.inline_data and part.inline_data.data:
                b64 = base64.b64encode(part.inline_data.data).decode()
                mime = part.inline_data.mime_type or "image/png"
                images.append({"data": b64, "mime_type": mime})

        if not images:
            raise Exception("Gemini 返回结果中不包含图片，请尝试调整提示词或更换模型。")

        return {
            "images": images,
            "image_data": images[0],
        }

    async def chat_stream(self, message: str, conversation_id: Optional[str] = None, model: str = "gemini-2.5-flash") -> AsyncGenerator[str, None]:
        cid = conversation_id or "default"
        history = self._get_history(cid)

        history.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

        full_response = ""

        try:
            def _stream():
                return self.generate_content_stream(model=model, contents=history)

            stream = await _stream()
            for chunk in stream:
                if chunk.text:
                    full_response += chunk.text
                    yield chunk.text
        except Exception as e:
            history.pop()
            raise Exception(_friendly_error(e))

        history.append(types.Content(role="model", parts=[types.Part.from_text(text=full_response)]))
