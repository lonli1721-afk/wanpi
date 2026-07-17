from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_USER_DATA_DIR = os.environ.get("USER_DATA_DIR")
ORIGINAL_PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL")
TEMP_USER_DATA_DIR = tempfile.mkdtemp(prefix="mulerun-ref-route-")
os.environ["USER_DATA_DIR"] = TEMP_USER_DATA_DIR
sys.path.insert(0, str(ROOT / "server"))

import deps  # noqa: E402
from routers import game_routes  # noqa: E402


class MuleRunImageReferenceRouteTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEMP_USER_DATA_DIR, ignore_errors=True)
        if ORIGINAL_USER_DATA_DIR is None:
            os.environ.pop("USER_DATA_DIR", None)
        else:
            os.environ["USER_DATA_DIR"] = ORIGINAL_USER_DATA_DIR
        if ORIGINAL_PUBLIC_BASE_URL is None:
            os.environ.pop("PUBLIC_BASE_URL", None)
        else:
            os.environ["PUBLIC_BASE_URL"] = ORIGINAL_PUBLIC_BASE_URL

    async def test_mulerun_reference_uses_local_file_path_for_signed_local_file(self):
        files_dir = deps.get_files_dir()
        files_dir.mkdir(parents=True, exist_ok=True)
        image_path = files_dir / "ref.png"
        image_bytes = b"\x89PNG\r\n\x1a\nfake-png"
        image_path.write_bytes(image_bytes)
        os.environ["PUBLIC_BASE_URL"] = "http://106.53.49.23/local-test"

        resolved = await game_routes._resolve_mulerun_image_reference(
            "http://106.53.49.23/local-test/public-files/ref.png?expires=1&sig=abc"
        )

        self.assertEqual(Path(resolved), image_path.resolve())

    async def test_mulerun_reference_uses_local_file_path_without_public_base(self):
        os.environ.pop("PUBLIC_BASE_URL", None)
        files_dir = deps.get_files_dir()
        files_dir.mkdir(parents=True, exist_ok=True)
        image_path = files_dir / "ref-inline.png"
        image_bytes = b"\x89PNG\r\n\x1a\nfake-png"
        image_path.write_bytes(image_bytes)

        resolved = await game_routes._resolve_mulerun_image_reference("/api/files/ref-inline.png")

        self.assertEqual(Path(resolved), image_path.resolve())

    async def test_mulerun_image_access_allows_admin(self):
        deps.set_current_user({"id": "admin-user", "role": "admin", "team": ""})
        with patch.object(game_routes.auth, "get_user_full", return_value={}):
            self.assertTrue(game_routes._can_use_mulerun_image())

    async def test_mulerun_image_access_allows_fa2_wechat_and_zhitou(self):
        allowed_teams = ["发行事业二部-微信组", "发行事业二部-直投组"]
        with patch.object(game_routes.auth, "get_user_full", return_value={}):
            for index, team in enumerate(allowed_teams, start=1):
                deps.set_current_user({"id": f"user-{index}", "role": "user", "team": team})
                self.assertTrue(game_routes._can_use_mulerun_image())

    async def test_mulerun_image_access_rejects_other_groups(self):
        deps.set_current_user({"id": "other-user", "role": "user", "team": "发行事业二部-TT组"})
        with patch.object(game_routes.auth, "get_user_full", return_value={}):
            self.assertFalse(game_routes._can_use_mulerun_image())


if __name__ == "__main__":
    unittest.main()
