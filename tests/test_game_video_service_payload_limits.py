from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from game_video_service import GameJimengService  # noqa: E402


class _FakeResponse:
    status_code = 200
    text = "{}"

    def json(self):
        return {"task_id": "fake-task"}


class _FakeAsyncClient:
    payloads: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        self.payloads.append(json or {})
        return _FakeResponse()


class GameVideoServicePayloadLimitTests(unittest.TestCase):
    def setUp(self):
        _FakeAsyncClient.payloads.clear()

    def test_seedance_standard_generation_sends_registry_ref_image_limit(self):
        refs = [f"data:image/png;base64,ref{idx}" for idx in range(9)]
        with patch("game_video_service.httpx.AsyncClient", _FakeAsyncClient):
            result = asyncio.run(
                GameJimengService("test-key").generate_video(
                    prompt="tiny smoke",
                    model="seedance-2.0",
                    duration=5,
                    resolution="720p",
                    reference_images=refs,
                )
            )

        self.assertEqual(result["task_id"], "fake-task")
        content = _FakeAsyncClient.payloads[0]["content"]
        ref_image_count = sum(1 for item in content if item.get("role") == "reference_image")
        self.assertEqual(ref_image_count, 9)

    def test_seedance_10_pro_fast_sends_ten_second_duration(self):
        with patch("game_video_service.httpx.AsyncClient", _FakeAsyncClient):
            result = asyncio.run(
                GameJimengService("test-key").generate_video(
                    prompt="tiny smoke",
                    model="seedance-1.0-pro-fast",
                    ratio="9:16",
                    duration=10,
                    resolution="720p",
                )
            )

        self.assertEqual(result["task_id"], "fake-task")
        payload = _FakeAsyncClient.payloads[0]
        self.assertEqual(payload["model"], "doubao-seedance-1-0-pro-fast-251015")
        self.assertEqual(payload["duration"], 10)
        self.assertEqual(payload["resolution"], "720p")
        self.assertEqual(result["duration"], 10)


if __name__ == "__main__":
    unittest.main()
