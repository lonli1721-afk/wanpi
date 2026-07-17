from __future__ import annotations

import os
import threading

import database as db
import deps


class ImageToolProviderRegistry:
    """Stable provider lookup boundary for image toolbox services."""

    def __init__(self):
        self._ai_service_cache: dict[tuple[str, tuple[str, ...]], object] = {}
        self._ai_service_cache_lock = threading.RLock()

    def _env_key(self, name: str) -> str:
        if name == "ark_api_key":
            candidates = ["GAME_ARK_API_KEY", "ARK_API_KEY", "GAME_JIMENG_API_KEY", "JIMENG_API_KEY"]
        elif name == "gemini_api_key":
            candidates = ["GAME_GEMINI_API_KEY", "GEMINI_API_KEY"]
        else:
            candidates = [f"GAME_{name.upper()}", name.upper()]

        for env_name in candidates:
            value = (os.environ.get(env_name, "") or "").strip()
            if value:
                return value
        return ""

    def _env_key_pool(self, name: str) -> list[str]:
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

    def _user_key(self, name: str) -> str:
        return deps.get_group_api_key(name)

    def _user_key_pool(self, name: str) -> list[str]:
        return deps.get_group_api_key_pool(name)

    def jimeng(self):
        key = self._user_key("ark_api_key")
        if key:
            from jimeng_service import JimengService

            return JimengService(api_key=key)
        raise RuntimeError(deps.missing_group_api_key_message("火山 ARK Key"))

    def gemini(self):
        keys = self._user_key_pool("gemini_api_key")
        if keys:
            from ai_service import AIService

            proxy = deps.get_proxy_url()
            gemini_proxy = f"{proxy}/gemini" if proxy else ""
            cache_key = (gemini_proxy, tuple(keys))
            with self._ai_service_cache_lock:
                svc = self._ai_service_cache.get(cache_key)
                if svc is None:
                    svc = AIService(api_key=keys[0], api_keys=keys, proxy_base_url=gemini_proxy)
                    self._ai_service_cache[cache_key] = svc
                return svc
        raise RuntimeError(deps.missing_group_api_key_message("Gemini Key"))

    def openai(self):
        key = self._user_key("openai_api_key") or (deps.settings_manager.get("openai_api_key", "") or "").strip()
        if not key:
            raise RuntimeError(deps.missing_group_api_key_message("OpenAI Key"))

        from openai_service import OpenAIService

        proxy = deps.get_proxy_url()
        base_url = self._user_key("openai_base_url") or (deps.settings_manager.get("openai_base_url", "") or "").strip()
        if proxy:
            base_url = f"{proxy}/openai/v1"
        elif not base_url:
            base_url = "https://open-api.mincode.cn/v1"
        return OpenAIService(api_key=key, base_url=base_url)


_default_registry = ImageToolProviderRegistry()


def get_image_tool_provider_registry() -> ImageToolProviderRegistry:
    return _default_registry
