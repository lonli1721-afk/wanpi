from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import provider_queue  # noqa: E402


class ProviderQueueTests(unittest.TestCase):
    def setUp(self):
        provider_queue._limiters.clear()
        self.original_env = {
            "GAME_PROVIDER_DEFAULT_CONCURRENCY": os.environ.get("GAME_PROVIDER_DEFAULT_CONCURRENCY"),
            "GAME_PROVIDER_ARK_CONCURRENCY": os.environ.get("GAME_PROVIDER_ARK_CONCURRENCY"),
        }

    def tearDown(self):
        provider_queue._limiters.clear()
        for key, value in self.original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_aliases_share_canonical_provider_limiter(self):
        async def scenario():
            jimeng = provider_queue.get_provider_limiter("jimeng")
            seedance = provider_queue.get_provider_limiter("seedance")
            happyhorse = provider_queue.get_provider_limiter("happyhorse")
            wan = provider_queue.get_provider_limiter("wan")
            gemini_image = provider_queue.get_provider_limiter("gemini_image")
            mulerun_image = provider_queue.get_provider_limiter("mulerun_image")
            return jimeng, seedance, happyhorse, wan, gemini_image, mulerun_image

        jimeng, seedance, happyhorse, wan, gemini_image, mulerun_image = asyncio.run(scenario())

        self.assertIs(jimeng, seedance)
        self.assertEqual(jimeng.provider_key, "ark")
        self.assertIs(happyhorse, wan)
        self.assertEqual(happyhorse.provider_key, "dashscope")
        self.assertEqual(gemini_image.provider_key, "gemini")
        self.assertEqual(mulerun_image.provider_key, "openai")

    def test_env_limit_is_applied_and_clamped(self):
        os.environ["GAME_PROVIDER_DEFAULT_CONCURRENCY"] = "0"
        os.environ["GAME_PROVIDER_ARK_CONCURRENCY"] = "2"

        async def scenario():
            ark = provider_queue.get_provider_limiter("jimeng")
            default = provider_queue.get_provider_limiter("custom")
            return ark, default

        ark, default = asyncio.run(scenario())

        self.assertEqual(ark.limit, 2)
        self.assertEqual(default.limit, 1)

    def test_concurrency_limit_waits_and_releases(self):
        async def scenario():
            os.environ["GAME_PROVIDER_DEFAULT_CONCURRENCY"] = "1"
            started = asyncio.Event()
            release = asyncio.Event()

            async def first():
                started.set()
                await release.wait()
                return "first"

            async def second():
                return "second"

            task_one = asyncio.create_task(provider_queue.run_provider_call("openai", "hold", first))
            await started.wait()
            task_two = asyncio.create_task(provider_queue.run_provider_call("openai", "next", second))
            await asyncio.sleep(0.05)

            snapshot_waiting = provider_queue.provider_queue_snapshot()["providers"]["openai"]
            release.set()
            result_one, result_two = await asyncio.gather(task_one, task_two)
            snapshot_done = provider_queue.provider_queue_snapshot()["providers"]["openai"]
            return result_one, result_two, snapshot_waiting, snapshot_done

        result_one, result_two, snapshot_waiting, snapshot_done = asyncio.run(scenario())

        self.assertEqual((result_one, result_two), ("first", "second"))
        self.assertEqual(snapshot_waiting["active"], 1)
        self.assertEqual(snapshot_waiting["waiting"], 1)
        self.assertEqual(snapshot_done["active"], 0)
        self.assertEqual(snapshot_done["total_completed"], 2)

    def test_timeout_and_exception_paths_release_capacity(self):
        original_timeout = provider_queue._queue_timeout_seconds
        provider_queue._queue_timeout_seconds = lambda: 0.01
        try:
            async def timeout_scenario():
                os.environ["GAME_PROVIDER_DEFAULT_CONCURRENCY"] = "1"
                started = asyncio.Event()
                release = asyncio.Event()

                async def first():
                    started.set()
                    await release.wait()

                task_one = asyncio.create_task(provider_queue.run_provider_call("vidu", "hold", first))
                await started.wait()
                with self.assertRaises(provider_queue.ProviderBusyError):
                    await provider_queue.run_provider_call("vidu", "timeout", lambda: asyncio.sleep(0))
                release.set()
                await task_one
                return provider_queue.provider_queue_snapshot()["providers"]["vidu"]

            snapshot = asyncio.run(timeout_scenario())
        finally:
            provider_queue._queue_timeout_seconds = original_timeout

        self.assertEqual(snapshot["active"], 0)
        self.assertEqual(snapshot["waiting"], 0)
        self.assertEqual(snapshot["total_timeouts"], 1)

        async def exception_scenario():
            async def boom():
                raise RuntimeError("boom")

            with self.assertRaises(RuntimeError):
                await provider_queue.run_provider_call("openai", "boom", boom)
            return provider_queue.provider_queue_snapshot()["providers"]["openai"]

        snapshot = asyncio.run(exception_scenario())
        self.assertEqual(snapshot["active"], 0)
        self.assertEqual(snapshot["total_completed"], 1)


if __name__ == "__main__":
    unittest.main()
