from __future__ import annotations

"""OpenAI-compatible service for GPT models."""

import base64
import httpx
import asyncio
import random
from typing import Optional, AsyncGenerator

OPENAI_MODELS = [
    {"id": "gpt-5.5", "name": "GPT-5.5"},
    {"id": "gpt-5.4", "name": "GPT-5.4 (旗舰)"},
    {"id": "gpt-5.4-mini", "name": "GPT-5.4 Mini"},
    {"id": "gpt-4.1", "name": "GPT-4.1"},
    {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini"},
    {"id": "gpt-4o", "name": "GPT-4o"},
    {"id": "gpt-4o-mini", "name": "GPT-4o Mini (快速)"},
    {"id": "o4-mini", "name": "o4-mini (推理)"},
    {"id": "o3", "name": "o3 (推理旗舰)"},
    {"id": "o3-mini", "name": "o3-mini"},
]

OPENAI_IMAGE_MODELS = [
    {
        "id": "gpt-image-2",
        "name": "GPT Image 2",
        "provider": "openai_image",
        "supports_ref_images": True,
        "max_ref_images": 4,
        "supported_qualities": ["2K"],
        "default_quality": "2K",
    },
]

_NEW_API_MODELS = frozenset({
    "gpt-5.5", "gpt-5.5-mini", "gpt-5.5-nano",
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro",
    "gpt-5.3", "gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5",
    "gpt-5-mini", "gpt-5-nano", "gpt-5-pro",
    "o3", "o3-mini", "o4-mini", "o1", "o1-pro",
})


def _uses_max_completion_tokens(model: str) -> bool:
    base = model.rsplit("-202", 1)[0]
    return base in _NEW_API_MODELS


class OpenAIService:
    def __init__(self, api_key: str, base_url: str = "https://open-api.mincode.cn/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _build_body(self, model: str, messages: list, max_tokens: int, temperature: float, stream: bool = False) -> dict:
        body = {"model": model, "messages": messages}
        if _uses_max_completion_tokens(model):
            body["max_completion_tokens"] = max_tokens
        else:
            body["max_tokens"] = max_tokens
            body["temperature"] = temperature
        if stream:
            body["stream"] = True
        return body

    def _friendly_error(self, exc: Exception) -> str:
        msg = str(exc)
        if "404" in msg:
            return "OpenAI 通道当前不支持所选模型或接口路径，请切换到 GPT-5.4 / GPT-4o 后重试。"
        if "405" in msg or "Method Not Allowed" in msg:
            return "OpenAI 代理接口路径不匹配，当前模型暂时无法通过这个代理调用，请切换到 GPT-5.4 / GPT-4o 或检查 OpenAI 代理地址。"
        if "400" in msg or "Bad Request" in msg:
            return "OpenAI 图片请求参数不被上游接受，通常是模型名不支持、图片接口未开通或尺寸参数不支持。请让代理方确认 GPT Image 2 的实际 API 模型名和接口路径。"
        if "429" in msg or "Too Many Requests" in msg:
            return "OpenAI 通道当前触发限流，系统已重试多次仍失败，请稍后继续使用 GPT 重试。"
        if "503" in msg or "502" in msg or "504" in msg:
            return "OpenAI 通道当前繁忙，系统已重试多次仍失败，请稍后继续使用 GPT 重试。"
        if "401" in msg:
            return "OpenAI API Key 无效或已过期，请检查配置。"
        if "403" in msg:
            return "OpenAI API Key 权限不足，请检查账号或模型权限。"
        return msg[:300]

    async def _post_json(self, body: dict) -> dict:
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=300) as client:
                    resp = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    resp.raise_for_status()
                    try:
                        return resp.json()
                    except ValueError as exc:
                        preview = (resp.text or "").strip()[:300] or "empty response"
                        raise Exception(f"OpenAI 通道返回了非 JSON 响应，可能是代理连接中断或上游返回错误页：{preview}") from exc
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                if status in (429, 502, 503, 504) and attempt < 3:
                    retry_after = exc.response.headers.get("retry-after", "")
                    try:
                        wait_seconds = float(retry_after)
                    except (TypeError, ValueError):
                        wait_seconds = min(12.0, 2.0 * (2 ** attempt)) + random.uniform(0, 0.8)
                    await asyncio.sleep(max(0.8, min(wait_seconds, 20.0)))
                    continue
                raise Exception(self._friendly_error(exc))
            except Exception as exc:
                last_error = exc
                if attempt < 3:
                    await asyncio.sleep(min(8.0, 1.5 * (2 ** attempt)) + random.uniform(0, 0.5))
                    continue
                raise Exception(self._friendly_error(exc))
        raise Exception(self._friendly_error(last_error or Exception("OpenAI 请求失败")))

    async def chat(
        self,
        prompt: str,
        model: str = "gpt-4o",
        system: str = "",
        max_tokens: int = 8192,
        temperature: float = 0.7,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body = self._build_body(model, messages, max_tokens, temperature)

        data = await self._post_json(body)
        return data["choices"][0]["message"]["content"]

    async def chat_vision(
        self,
        text_prompt: str,
        image_data_list: list[tuple[bytes, str]],
        model: str = "gpt-5.4",
        system: str = "",
        max_tokens: int = 8192,
        temperature: float = 0.5,
    ) -> str:
        """Vision chat: send text + images (bytes, mime_type) to GPT."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})

        content_parts: list[dict] = []
        for img_bytes, mime in image_data_list:
            b64 = base64.b64encode(img_bytes).decode()
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
            })
        content_parts.append({"type": "text", "text": text_prompt})
        messages.append({"role": "user", "content": content_parts})

        body = self._build_body(model, messages, max_tokens, temperature)

        data = await self._post_json(body)
        return data["choices"][0]["message"]["content"]

    async def chat_messages(
        self,
        messages: list[dict],
        model: str = "gpt-5.5",
        max_tokens: int = 8192,
        temperature: float = 0.7,
    ) -> str:
        """Multi-turn chat: accepts prepared OpenAI-compatible messages."""
        body = self._build_body(model, messages, max_tokens, temperature)
        data = await self._post_json(body)
        return data["choices"][0]["message"]["content"]

    @staticmethod
    def _normalize_image_size(size: str) -> str:
        """Map the app's common ratios to OpenAI image sizes."""
        text = str(size or "").lower().strip()
        if text in {"1024x1024", "1536x1024", "1024x1536"}:
            return text
        try:
            width_text, height_text = text.split("x", 1)
            width = int(width_text)
            height = int(height_text)
        except Exception:
            return "1024x1024"
        if width == height:
            return "1024x1024"
        return "1536x1024" if width > height else "1024x1536"

    async def generate_image(
        self,
        prompt: str,
        model: str = "gpt-image-2",
        size: str = "1024x1024",
        reference_images: list[tuple[bytes, str, str]] | None = None,
    ) -> dict:
        """Generate or edit an image through OpenAI-compatible image endpoints."""
        refs = list(reference_images or [])
        if refs:
            return await self.edit_image(
                prompt=prompt,
                model=model,
                size=size,
                reference_images=refs,
            )

        body = {
            "model": model,
            "prompt": prompt,
            "size": self._normalize_image_size(size),
            "n": 1,
        }
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=300) as client:
                    resp = await client.post(
                        f"{self.base_url}/images/generations",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    images = []
                    for item in data.get("data", []) or []:
                        if item.get("b64_json"):
                            images.append({"data": item["b64_json"], "mime_type": "image/png"})
                        elif item.get("url"):
                            images.append({"url": item["url"]})
                    if not images:
                        raise Exception("OpenAI 图片通道没有返回图片，请稍后重试或切换模型。")
                    return {"image_url": images[0].get("url", ""), "images": images}
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                if status in (429, 502, 503, 504) and attempt < 3:
                    await asyncio.sleep(min(12.0, 2.0 * (2 ** attempt)) + random.uniform(0, 0.8))
                    continue
                if status == 400:
                    preview = (exc.response.text or "").strip()[:500] or "empty response"
                    raise Exception(
                        "OpenAI 图片接口返回 400，通常是模型名或参数不被代理支持："
                        f"{preview}"
                    )
                raise Exception(self._friendly_error(exc))
            except Exception as exc:
                last_error = exc
                if attempt < 3:
                    await asyncio.sleep(min(8.0, 1.5 * (2 ** attempt)) + random.uniform(0, 0.5))
                    continue
                raise Exception(self._friendly_error(exc))
        raise Exception(self._friendly_error(last_error or Exception("OpenAI 图片请求失败")))

    async def edit_image(
        self,
        prompt: str,
        model: str = "gpt-image-2",
        size: str = "1024x1024",
        reference_images: list[tuple[bytes, str, str]] | None = None,
    ) -> dict:
        """Edit/generate from reference images through the OpenAI-compatible edits endpoint."""
        refs = list(reference_images or [])
        if not refs:
            return await self.generate_image(prompt=prompt, model=model, size=size)

        data = {
            "model": model,
            "prompt": prompt,
            "size": self._normalize_image_size(size),
            "n": "1",
        }
        files = []
        for index, (image_bytes, mime, filename) in enumerate(refs[:4], start=1):
            safe_name = filename or f"reference_{index}.png"
            if "." not in safe_name:
                safe_name = f"{safe_name}.png"
            files.append(("image", (safe_name, image_bytes, mime or "image/png")))

        last_error: Exception | None = None
        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=300) as client:
                    resp = await client.post(
                        f"{self.base_url}/images/edits",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        data=data,
                        files=files,
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                    images = []
                    for item in payload.get("data", []) or []:
                        if item.get("b64_json"):
                            images.append({"data": item["b64_json"], "mime_type": "image/png"})
                        elif item.get("url"):
                            images.append({"url": item["url"]})
                    if not images:
                        raise Exception("OpenAI 图生图通道没有返回图片，请稍后重试或切换模型。")
                    return {"image_url": images[0].get("url", ""), "images": images}
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                if status in (429, 502, 503, 504) and attempt < 3:
                    await asyncio.sleep(min(12.0, 2.0 * (2 ** attempt)) + random.uniform(0, 0.8))
                    continue
                if status in (400, 404, 405):
                    preview = (exc.response.text or "").strip()[:500] or "empty response"
                    raise Exception(
                        "OpenAI 图生图接口调用失败，通常是代理未开放 /images/edits、模型名不支持编辑接口，"
                        f"或参考图格式不被接受：{preview}"
                    )
                raise Exception(self._friendly_error(exc))
            except Exception as exc:
                last_error = exc
                if attempt < 3:
                    await asyncio.sleep(min(8.0, 1.5 * (2 ** attempt)) + random.uniform(0, 0.5))
                    continue
                raise Exception(self._friendly_error(exc))
        raise Exception(self._friendly_error(last_error or Exception("OpenAI 图生图请求失败")))

    async def chat_stream(
        self,
        prompt: str,
        model: str = "gpt-4o",
        system: str = "",
        max_tokens: int = 8192,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body = self._build_body(model, messages, max_tokens, temperature, stream=True)

        async with httpx.AsyncClient(timeout=300) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            import json
                            chunk = json.loads(payload)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except Exception:
                            continue
            except Exception as exc:
                raise Exception(self._friendly_error(exc))
