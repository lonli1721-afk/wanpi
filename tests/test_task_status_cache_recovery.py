from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[1]
_ORIGINAL_USER_DATA_DIR = os.environ.get("USER_DATA_DIR")
_MODULE_USER_DATA_DIR = tempfile.mkdtemp(prefix="game-video-task-cache-recovery-module-")
os.environ["USER_DATA_DIR"] = _MODULE_USER_DATA_DIR
sys.path.insert(0, str(ROOT / "server"))

import database as db  # noqa: E402
import deps  # noqa: E402
import task_status_query  # noqa: E402
import task_status_service  # noqa: E402
from routers import game_routes  # noqa: E402
from task_status_policy import provider_video_cache_error  # noqa: E402


class TaskStatusServiceBoundaryTests(unittest.TestCase):
    def test_service_does_not_import_large_game_router(self):
        service_source = Path(task_status_service.__file__).read_text(encoding="utf-8")

        self.assertNotIn("routers.game_routes", service_source)
        self.assertNotIn("from routers import game_routes", service_source)
        self.assertNotIn("import game_routes", service_source)

    def test_router_query_status_is_thin_service_wrapper(self):
        async def fake_service(task_id: str, **kwargs) -> dict:
            self.assertEqual(task_id, "task-1")
            self.assertIs(kwargs["db_call"], game_routes._db_call)
            self.assertIs(kwargs["query_provider_task_status"], game_routes._query_provider_task_status)
            self.assertIs(kwargs["ensure_game_task_record"], game_routes._ensure_game_task_record)
            self.assertIs(kwargs["snapshot_completed_task_billing"], game_routes._snapshot_completed_task_billing)
            self.assertIs(kwargs["record_operation_failure"], game_routes._record_operation_failure)
            self.assertEqual(kwargs["failed_result_recovery_retry_seconds"], game_routes.FAILED_RESULT_RECOVERY_RETRY_SECONDS)
            self.assertTrue(kwargs["force_failed_cache_retry"])
            return {"task_id": task_id, "status": "processing"}

        with patch.object(game_routes, "query_game_task_status", fake_service):
            result = asyncio.run(game_routes._query_task_status("task-1", force_failed_cache_retry=True))

        self.assertEqual(result, {"task_id": "task-1", "status": "processing"})


class TaskStatusCacheRecoveryTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MODULE_USER_DATA_DIR, ignore_errors=True)
        if _ORIGINAL_USER_DATA_DIR is None:
            os.environ.pop("USER_DATA_DIR", None)
        else:
            os.environ["USER_DATA_DIR"] = _ORIGINAL_USER_DATA_DIR

    def setUp(self):
        self._old_db_path = db.get_db_path()
        self._old_files_dir = deps.get_files_dir()
        self.temp_dir = Path(tempfile.mkdtemp(prefix="game-video-task-cache-recovery-"))
        db.set_db_path(self.temp_dir / "game_video.db")
        deps.set_files_dir(self.temp_dir / "files")
        deps._video_tasks.clear()
        task_status_query.reset_status_query_state_for_tests()

    def tearDown(self):
        db.set_db_path(self._old_db_path)
        deps.set_files_dir(self._old_files_dir)
        deps._video_tasks.clear()
        task_status_query.reset_status_query_state_for_tests()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _failed_task(self, *, error: str) -> dict:
        project = db.create_game_project("Demo")
        task = db.create_game_task(
            project["id"],
            "generate",
            "prompt",
            model="seedance-2.0",
            provider="jimeng",
            external_task_id="external-1",
        )
        db.update_game_task(task["id"], status="failed", video_url="", error=error)
        return db.get_game_task(task["id"])

    def _processing_task(self) -> dict:
        project = db.create_game_project("Demo")
        return db.create_game_task(
            project["id"],
            "generate",
            "prompt",
            model="seedance-2.0",
            provider="jimeng",
            external_task_id="external-1",
        )

    def test_recoverable_cache_failure_rechecks_provider_and_restores_completed_task(self):
        task = self._failed_task(error=provider_video_cache_error(RuntimeError("HTTP 403")))
        snapshots: list[tuple[dict, dict]] = []

        async def query_provider(task_id: str, provider: str) -> dict:
            self.assertEqual(task_id, "external-1")
            self.assertEqual(provider, "jimeng")
            return {"task_id": task_id, "status": "completed", "video_url": "https://example.com/video.mp4"}

        async def cache_remote_file(url: str, ext: str, **_kwargs) -> str:
            self.assertEqual(url, "https://example.com/video.mp4")
            self.assertEqual(ext, ".mp4")
            return "/api/files/recovered.mp4"

        async def snapshot_billing(gt: dict, result: dict) -> None:
            snapshots.append((gt, result))

        with patch.object(game_routes, "_query_provider_task_status", query_provider), \
                patch.object(game_routes.deps, "cache_remote_file", cache_remote_file), \
                patch.object(game_routes, "_snapshot_completed_task_billing", snapshot_billing):
            result = asyncio.run(game_routes._query_task_status("external-1"))

        stored = db.get_game_task(task["id"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["video_url"], "/api/files/recovered.mp4")
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(stored["video_url"], "/api/files/recovered.mp4")
        self.assertEqual(stored["error"], "")
        self.assertEqual(len(snapshots), 1)

    def test_local_task_id_query_uses_external_id_and_closes_completed_task(self):
        task = self._processing_task()
        snapshots: list[tuple[dict, dict]] = []

        async def query_provider(task_id: str, provider: str) -> dict:
            self.assertEqual(task_id, "external-1")
            self.assertEqual(provider, "jimeng")
            return {"task_id": task_id, "status": "completed", "video_url": "https://example.com/video.mp4"}

        async def cache_remote_file(url: str, ext: str, **_kwargs) -> str:
            self.assertEqual(url, "https://example.com/video.mp4")
            self.assertEqual(ext, ".mp4")
            return "/api/files/completed-from-local-id.mp4"

        async def snapshot_billing(gt: dict, result: dict) -> None:
            snapshots.append((gt, result))

        with patch.object(game_routes, "_query_provider_task_status", query_provider), \
                patch.object(game_routes.deps, "cache_remote_file", cache_remote_file), \
                patch.object(game_routes, "_snapshot_completed_task_billing", snapshot_billing):
            result = asyncio.run(game_routes._query_task_status(task["id"]))

        stored = db.get_game_task(task["id"])
        self.assertEqual(result["task_id"], task["id"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["video_url"], "/api/files/completed-from-local-id.mp4")
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(stored["video_url"], "/api/files/completed-from-local-id.mp4")
        self.assertEqual(stored["error"], "")
        self.assertEqual(len(snapshots), 1)

    def test_non_cache_failure_remains_terminal_without_provider_query(self):
        self._failed_task(error="上游生成失败：InvalidParameter")

        async def query_provider(_task_id: str, _provider: str) -> dict:
            raise AssertionError("non-cache failures must not query provider again")

        with patch.object(game_routes, "_query_provider_task_status", query_provider):
            result = asyncio.run(game_routes._query_task_status("external-1"))

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], "上游生成失败：InvalidParameter")

    def test_failed_cache_recovery_is_throttled_after_cache_failure(self):
        task = self._failed_task(error=provider_video_cache_error(RuntimeError("HTTP 403")))
        calls = {"provider": 0}

        async def query_provider(task_id: str, _provider: str) -> dict:
            calls["provider"] += 1
            return {"task_id": task_id, "status": "completed", "video_url": "https://example.com/video.mp4"}

        async def cache_remote_file(_url: str, _ext: str, **_kwargs) -> str:
            raise RuntimeError("temporary download failure")

        with patch.object(game_routes, "_query_provider_task_status", query_provider), \
                patch.object(game_routes.deps, "cache_remote_file", cache_remote_file):
            first = asyncio.run(game_routes._query_task_status("external-1"))
            second = asyncio.run(game_routes._query_task_status("external-1"))

        stored = db.get_game_task(task["id"])
        self.assertEqual(calls["provider"], 1)
        self.assertEqual(first["status"], "failed")
        self.assertIn("结果视频保存到本地失败", first["error"])
        self.assertEqual(second["status"], "failed")
        self.assertEqual(second["error"], stored["error"])

    def test_explicit_retry_bypasses_recent_failed_cache_throttle(self):
        task = self._failed_task(error=provider_video_cache_error(RuntimeError("ConnectTimeout")))
        deps._video_tasks["external-1"] = {
            "provider": "jimeng",
            "failed_result_recovery_attempt_at": game_routes.time.monotonic(),
        }
        calls = {"provider": 0}

        async def query_provider(task_id: str, provider: str) -> dict:
            calls["provider"] += 1
            self.assertEqual(task_id, "external-1")
            self.assertEqual(provider, "jimeng")
            return {"task_id": task_id, "status": "completed", "video_url": "https://example.com/video.mp4"}

        async def cache_remote_file(_url: str, _ext: str, **_kwargs) -> str:
            return "/api/files/manual-retry.mp4"

        async def snapshot_billing(_gt: dict, _result: dict) -> None:
            return None

        with patch.object(game_routes, "_query_provider_task_status", query_provider), \
                patch.object(game_routes.deps, "cache_remote_file", cache_remote_file), \
                patch.object(game_routes, "_snapshot_completed_task_billing", snapshot_billing):
            result = asyncio.run(game_routes._query_task_status("external-1", force_failed_cache_retry=True))

        stored = db.get_game_task(task["id"])
        self.assertEqual(calls["provider"], 1)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["video_url"], "/api/files/manual-retry.mp4")
        self.assertEqual(stored["status"], "completed")

    def test_retry_cache_endpoint_rejects_non_cache_failures(self):
        self._failed_task(error="上游生成失败：InvalidParameter")

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(game_routes.game_task_retry_result_cache("external-1"))

        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("不能重新拉取结果", str(caught.exception.detail))

    def test_retry_cache_endpoint_keeps_retryable_error_when_status_query_busy(self):
        self._failed_task(error=provider_video_cache_error(RuntimeError("ConnectTimeout")))

        async def query_status(_task_id: str, *, force_failed_cache_retry: bool = False) -> dict:
            self.assertTrue(force_failed_cache_retry)
            raise game_routes.StatusQueryBusyError("状态查询排队中")

        with patch.object(game_routes, "_query_task_status", query_status):
            result = asyncio.run(game_routes.game_task_retry_result_cache("external-1"))

        self.assertEqual(result["status"], "failed")
        self.assertIn("结果视频保存到本地失败", result["error"])
        self.assertIn("状态查询排队中", result["error"])

    def test_retry_cache_endpoint_returns_completed_local_result_without_provider_query(self):
        task = self._processing_task()
        db.update_game_task(task["id"], status="completed", video_url="/api/files/already-cached.mp4", error="")

        async def query_provider(_task_id: str, _provider: str) -> dict:
            raise AssertionError("completed local tasks must not query provider again")

        with patch.object(game_routes, "_query_provider_task_status", query_provider):
            result = asyncio.run(game_routes.game_task_retry_result_cache(task["id"]))

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["video_url"], "/api/files/already-cached.mp4")


if __name__ == "__main__":
    unittest.main()
