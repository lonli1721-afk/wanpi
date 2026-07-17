from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

logger = logging.getLogger("game.provider_queue")


class ProviderBusyError(Exception):
    """Raised when a provider queue is saturated for too long."""


PROVIDER_ALIASES = {
    "jimeng": "ark",
    "seedance": "ark",
    "happyhorse": "dashscope",
    "wan": "dashscope",
    "gemini_image": "gemini",
    "mulerun_image": "openai",
}

PROVIDER_LABELS = {
    "ark": "Seedance/即梦",
    "dashscope": "阿里视频",
    "vidu": "VIDU",
    "openai": "OpenAI",
    "gemini": "Gemini",
}


def normalize_provider_key(provider: str) -> str:
    key = (provider or "default").strip().lower()
    return PROVIDER_ALIASES.get(key, key or "default")


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "")
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _provider_limit(provider_key: str) -> int:
    defaults = {
        "ark": 3,
        "dashscope": 2,
        "vidu": 2,
        "openai": 3,
        "gemini": 3,
        "default": 3,
    }
    specific_name = f"GAME_PROVIDER_{provider_key.upper()}_CONCURRENCY"
    default_limit = _env_int("GAME_PROVIDER_DEFAULT_CONCURRENCY", defaults.get(provider_key, 3))
    return max(1, _env_int(specific_name, default_limit))


def _queue_timeout_seconds() -> float:
    value = os.environ.get("GAME_PROVIDER_QUEUE_TIMEOUT_SECONDS", "45")
    try:
        return max(1.0, float(value))
    except (TypeError, ValueError):
        return 45.0


class ProviderLimiter:
    def __init__(self, provider_key: str):
        self.provider_key = provider_key
        self.limit = _provider_limit(provider_key)
        self.semaphore = asyncio.Semaphore(self.limit)
        self.active = 0
        self.waiting = 0
        self.total_started = 0
        self.total_completed = 0
        self.total_timeouts = 0
        self.created_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    async def run(self, operation: str, fn: Callable[[], Awaitable]):
        timeout = _queue_timeout_seconds()
        self.waiting += 1
        try:
            await asyncio.wait_for(self.semaphore.acquire(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            self.total_timeouts += 1
            label = PROVIDER_LABELS.get(self.provider_key, self.provider_key)
            raise ProviderBusyError(f"{label}当前请求较多，排队超过 {int(timeout)} 秒，请稍后重试。") from exc
        finally:
            self.waiting = max(0, self.waiting - 1)

        self.active += 1
        self.total_started += 1
        try:
            logger.debug(
                "provider_call_start provider=%s operation=%s active=%s limit=%s",
                self.provider_key,
                operation,
                self.active,
                self.limit,
            )
            return await fn()
        finally:
            self.active = max(0, self.active - 1)
            self.total_completed += 1
            self.semaphore.release()
            logger.debug(
                "provider_call_done provider=%s operation=%s active=%s limit=%s",
                self.provider_key,
                operation,
                self.active,
                self.limit,
            )


_limiters: dict[str, ProviderLimiter] = {}


def get_provider_limiter(provider: str) -> ProviderLimiter:
    provider_key = normalize_provider_key(provider)
    limiter = _limiters.get(provider_key)
    if limiter is None:
        limiter = ProviderLimiter(provider_key)
        _limiters[provider_key] = limiter
    return limiter


async def run_provider_call(provider: str, operation: str, fn: Callable[[], Awaitable]):
    return await get_provider_limiter(provider).run(operation, fn)


async def run_limited_map(items: list, limit: int, worker: Callable[[object], Awaitable]):
    semaphore = asyncio.Semaphore(max(1, int(limit or 1)))

    async def _run_one(item):
        async with semaphore:
            return await worker(item)

    return await asyncio.gather(*[_run_one(item) for item in items], return_exceptions=True)


def provider_queue_snapshot() -> dict:
    providers = {}
    for key, limiter in sorted(_limiters.items()):
        providers[key] = {
            "label": PROVIDER_LABELS.get(key, key),
            "active": limiter.active,
            "waiting": limiter.waiting,
            "limit": limiter.limit,
            "available": max(0, limiter.limit - limiter.active),
            "saturated": limiter.active >= limiter.limit,
            "total_started": limiter.total_started,
            "total_completed": limiter.total_completed,
            "total_timeouts": limiter.total_timeouts,
            "created_at": limiter.created_at,
        }
    return {
        "queue_timeout_seconds": _queue_timeout_seconds(),
        "providers": providers,
    }
