from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
import urllib.error
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_task_state_repair_module():
    spec = importlib.util.spec_from_file_location("task_state_repair", ROOT / "deploy" / "task-state-repair.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def create_user_db(
    data_dir: Path,
    *,
    updated_at: str = "2026-05-01T00:00:00Z",
    provider: str = "jimeng",
    model: str = "seedance-2.0",
    type_: str = "generate",
    status: str = "processing",
    error: str = "",
) -> Path:
    db_path = data_dir / "users" / "user-a" / "database.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE game_projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            scenes_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT ''
        );
        CREATE TABLE game_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT '',
            type TEXT NOT NULL DEFAULT 'generate',
            prompt TEXT DEFAULT '',
            character_refs TEXT DEFAULT '[]',
            scene_refs TEXT DEFAULT '[]',
            ref_video_path TEXT DEFAULT '',
            model TEXT DEFAULT '',
            provider TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            video_url TEXT DEFAULT '',
            error TEXT DEFAULT '',
            external_task_id TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            billable_video_seconds REAL DEFAULT 0,
            estimated_cost_cny REAL DEFAULT 0,
            billing_status TEXT DEFAULT ''
        );
        """
    )
    scenes = {
        "generate": [],
        "replace": [],
        "tabState": None,
    }
    scene = {"id": "scene-1", "taskId": "external-1", "status": "processing", "videoUrl": ""}
    if type_ == "replace":
        scenes["replace"].append(scene)
    else:
        scenes["generate"].append(scene)
    conn.execute(
        "INSERT INTO game_projects (id, name, scenes_json, updated_at) VALUES (?,?,?,?)",
        ("project-1", "Demo", json.dumps(scenes), updated_at),
    )
    conn.execute(
        """
        INSERT INTO game_tasks
        (id, project_id, type, prompt, provider, model, status, video_url, error,
         external_task_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            "task-1",
            "project-1",
            type_,
            "prompt",
            provider,
            model,
            status,
            "",
            error,
            "external-1",
            "2026-05-01T00:00:00Z",
            updated_at,
        ),
    )
    conn.commit()
    conn.close()
    return db_path


def write_settings(data_dir: Path) -> None:
    (data_dir / "settings.json").write_text(
        json.dumps({"game_ark_api_key": "test-key", "game_dashscope_api_key": "dashscope-key"}),
        encoding="utf-8",
    )


def write_probe_report(
    path: Path,
    *,
    updated_at: str = "2026-05-01T00:00:00Z",
    provider: str = "jimeng",
    model: str = "seedance-2.0",
    local_status: str = "processing",
) -> None:
    payload = {
        "action": "task_state_probe",
        "readonly": True,
        "dry_run": True,
        "mutates_database": False,
        "probes": [{
            "db": "/unused/users/user-a/database.db",
            "task_id": "task-1",
            "external_task_id": "external-1",
            "user_id": "user-a",
            "username": "alice",
            "display_name": "Alice",
            "project_id": "project-1",
            "project_name": "Demo",
            "provider": provider,
            "model": model,
            "local_status": local_status,
            "local_updated_at": updated_at,
            "provider_status": "completed",
            "raw_status": "succeeded",
            "has_provider_video_url": True,
            "provider_video_url": "https://example.com/video.mp4",
        }],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def status_of(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM game_tasks WHERE id='task-1'").fetchone()
    conn.close()
    return dict(row)


def make_args(module, data_dir: Path, report: Path, *extra: str):
    return module.build_parser().parse_args([
        "--data-dir", str(data_dir),
        "--backup-dir", str(data_dir / "backups"),
        "--probe-report", str(report),
        *extra,
    ])


def fake_download(_url, files_dir, _task_id, _max_bytes, _timeout):
    files_dir.mkdir(parents=True, exist_ok=True)
    path = files_dir / "fixed.mp4"
    path.write_bytes(b"not-a-real-video")
    return {"filename": "fixed.mp4", "path": str(path), "size_bytes": 16, "local_url": "/api/files/fixed.mp4"}


class TaskStateRepairTests(unittest.TestCase):
    def test_dry_run_does_not_write_database_or_download(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(
                make_args(repair, data_dir, report, "--task-id", "task-1"),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
            )

            self.assertEqual(payload["would_repair_count"], 1)
            self.assertEqual(payload["downloaded_files"], [])
            self.assertEqual(status_of(db_path)["status"], "processing")

    def test_execute_requires_allowlist_and_expected_count(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(make_args(repair, data_dir, report, "--execute"))

            self.assertIn("execute_requires_task_id_allowlist", payload["preflight_errors"])
            self.assertIn("execute_requires_expected_count", payload["preflight_errors"])
            self.assertEqual(payload["repaired_count"], 0)

    def test_execute_repairs_task_after_backup_and_download(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                download_func=fake_download,
            )

            task = status_of(db_path)
            self.assertEqual(payload["repaired_count"], 1)
            self.assertEqual(task["status"], "completed")
            self.assertEqual(task["video_url"], "/api/files/fixed.mp4")
            self.assertEqual(task["error"], "")
            self.assertEqual(task["billing_status"], "duration_missing")
            self.assertTrue(Path(payload["db_backups"]["user-a"]).exists())
            self.assertIn("before_task", payload["rows"][0])
            self.assertIn("after_task", payload["rows"][0])

    def test_execute_skips_when_updated_at_changed(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir, updated_at="2026-05-01T01:00:00Z")
            report = data_dir / "probe.json"
            write_probe_report(report, updated_at="2026-05-01T00:00:00Z")

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                download_func=lambda *_args: self.fail("download should not run after updated_at changed"),
            )

            self.assertEqual(payload["repaired_count"], 0)
            self.assertEqual(payload["rows"][0]["reason"], "updated_at_changed")
            self.assertEqual(status_of(db_path)["status"], "processing")

    def test_repair_scenes_is_opt_in(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                    "--repair-scenes",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                download_func=fake_download,
            )

            conn = sqlite3.connect(db_path)
            raw = conn.execute("SELECT scenes_json FROM game_projects WHERE id='project-1'").fetchone()[0]
            conn.close()
            scene = json.loads(raw)["generate"][0]
            self.assertEqual(payload["repaired_count"], 1)
            self.assertEqual(scene["status"], "completed")
            self.assertEqual(scene["videoUrl"], "/api/files/fixed.mp4")

    def test_execute_repairs_wan_replace_task_and_scene(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir, provider="wan", model="wan2.2-animate-mix", type_="replace")
            report = data_dir / "probe.json"
            write_probe_report(report, provider="wan", model="wan2.2-animate-mix")

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                    "--repair-scenes",
                ),
                query_func=lambda _api_key, _task_id, _provider: {
                    "status": "completed",
                    "video_url": "https://example.com/wan.mp4",
                    "error": "",
                    "raw_status": "SUCCEEDED",
                },
                download_func=fake_download,
            )

            task = status_of(db_path)
            self.assertEqual(payload["repaired_count"], 1)
            self.assertEqual(task["status"], "completed")
            self.assertEqual(task["video_url"], "/api/files/fixed.mp4")
            self.assertEqual(task["billing_status"], "unpriced")
            conn = sqlite3.connect(db_path)
            raw = conn.execute("SELECT scenes_json FROM game_projects WHERE id='project-1'").fetchone()[0]
            conn.close()
            scene = json.loads(raw)["replace"][0]
            self.assertEqual(scene["status"], "completed")
            self.assertEqual(scene["videoUrl"], "/api/files/fixed.mp4")

    def test_execute_repairs_happyhorse_generate_task_and_scene(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir, provider="happyhorse", model="happyhorse-1.0-r2v")
            report = data_dir / "probe.json"
            write_probe_report(report, provider="happyhorse", model="happyhorse-1.0-r2v")

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                    "--repair-scenes",
                ),
                query_func=lambda _api_key, _task_id, _provider: {
                    "status": "completed",
                    "video_url": "https://example.com/happyhorse.mp4",
                    "error": "",
                    "raw_status": "SUCCEEDED",
                },
                download_func=fake_download,
            )

            task = status_of(db_path)
            self.assertEqual(payload["repaired_count"], 1)
            self.assertEqual(task["provider"], "happyhorse")
            self.assertEqual(task["status"], "completed")
            self.assertEqual(task["video_url"], "/api/files/fixed.mp4")
            self.assertEqual(task["billing_status"], "duration_missing")
            conn = sqlite3.connect(db_path)
            raw = conn.execute("SELECT scenes_json FROM game_projects WHERE id='project-1'").fetchone()[0]
            conn.close()
            scene = json.loads(raw)["generate"][0]
            self.assertEqual(scene["status"], "completed")
            self.assertEqual(scene["videoUrl"], "/api/files/fixed.mp4")

    def test_dry_run_can_detect_inaccessible_provider_url(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--task-id", "task-1",
                    "--validate-download-urls",
                    "--mark-failed-when-download-inaccessible",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                access_check_func=lambda _url, _timeout: {
                    "accessible": False,
                    "status_code": 403,
                    "content_length": "",
                    "error": "HTTP 403",
                },
            )

            self.assertEqual(payload["would_mark_failed_count"], 1)
            self.assertEqual(payload["rows"][0]["status"], "would_mark_failed")

    def test_url_access_falls_back_to_range_get_when_head_is_forbidden(self):
        repair = load_task_state_repair_module()
        calls = []

        class FakeResponse:
            status = 206
            headers = {"content-length": "1"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        def fake_urlopen(req, timeout=0):
            calls.append((req.get_method(), req.headers.get("Range"), timeout))
            if req.get_method() == "HEAD":
                raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, None)
            return FakeResponse()

        original = repair.urllib.request.urlopen
        repair.urllib.request.urlopen = fake_urlopen
        try:
            result = repair.check_provider_url_access("https://example.com/video.mp4", 5)
        finally:
            repair.urllib.request.urlopen = original

        self.assertTrue(result["accessible"])
        self.assertEqual(result["method"], "GET_RANGE")
        self.assertEqual(result["head_status_code"], 403)
        self.assertEqual(calls[0][0], "HEAD")
        self.assertEqual(calls[1][0], "GET")
        self.assertEqual(calls[1][1], "bytes=0-0")

    def test_execute_marks_failed_when_download_is_inaccessible(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir)
            report = data_dir / "probe.json"
            write_probe_report(report)

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                    "--mark-failed-when-download-inaccessible",
                    "--repair-scenes",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                download_func=lambda *_args: (_ for _ in ()).throw(RuntimeError("HTTP 403")),
            )

            task = status_of(db_path)
            self.assertEqual(payload["failed_marked_count"], 1)
            self.assertEqual(task["status"], "failed")
            self.assertIn("链接已过期", task["error"])
            conn = sqlite3.connect(db_path)
            raw = conn.execute("SELECT scenes_json FROM game_projects WHERE id='project-1'").fetchone()[0]
            conn.close()
            scene = json.loads(raw)["generate"][0]
            self.assertEqual(scene["status"], "failed")
            self.assertIn("链接已过期", scene["error"])

    def test_failed_local_status_requires_explicit_opt_in(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir, status="failed", error="result cache failed")
            report = data_dir / "probe.json"
            write_probe_report(report, local_status="failed")

            payload = repair.repair_tasks(
                make_args(repair, data_dir, report, "--task-id", "task-1"),
                query_func=lambda *_args: self.fail("failed local status should not be selected without opt-in"),
            )

            self.assertEqual(payload["candidate_count"], 0)
            self.assertEqual(status_of(db_path)["status"], "failed")

    def test_execute_recovers_failed_task_with_explicit_opt_in(self):
        repair = load_task_state_repair_module()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            write_settings(data_dir)
            db_path = create_user_db(data_dir, status="failed", error="result cache failed")
            report = data_dir / "probe.json"
            write_probe_report(report, local_status="failed")

            payload = repair.repair_tasks(
                make_args(
                    repair,
                    data_dir,
                    report,
                    "--execute",
                    "--expected-count", "1",
                    "--task-id", "task-1",
                    "--allow-failed-local-status",
                    "--repair-scenes",
                ),
                query_func=lambda _api_key, _task_id: {
                    "status": "completed",
                    "video_url": "https://example.com/video.mp4",
                    "error": "",
                    "raw_status": "succeeded",
                },
                download_func=fake_download,
            )

            task = status_of(db_path)
            self.assertEqual(payload["repaired_count"], 1)
            self.assertEqual(task["status"], "completed")
            self.assertEqual(task["video_url"], "/api/files/fixed.mp4")
            self.assertEqual(task["error"], "")
            self.assertTrue(Path(payload["db_backups"]["user-a"]).exists())
            conn = sqlite3.connect(db_path)
            raw = conn.execute("SELECT scenes_json FROM game_projects WHERE id='project-1'").fetchone()[0]
            conn.close()
            scene = json.loads(raw)["generate"][0]
            self.assertEqual(scene["status"], "completed")
            self.assertEqual(scene["videoUrl"], "/api/files/fixed.mp4")


if __name__ == "__main__":
    unittest.main()
