from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

import database as db
import auth
import deps
from video_model_registry import get_video_model_spec

logger = logging.getLogger("wanpi")

router = APIRouter()

AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "true").lower() in ("true", "1", "yes")
USAGE_CACHE_TTL_SECONDS = int(os.environ.get("USAGE_CACHE_TTL_SECONDS", "30") or "30")
_usage_cache: dict[tuple, tuple[float, dict]] = {}


def _get_usage_cache(key: tuple, refresh: bool = False) -> dict | None:
    if refresh or USAGE_CACHE_TTL_SECONDS <= 0:
        return None
    cached = _usage_cache.get(key)
    if not cached:
        return None
    expires_at, payload = cached
    if time.monotonic() >= expires_at:
        _usage_cache.pop(key, None)
        return None
    return payload


def _set_usage_cache(key: tuple, payload: dict) -> dict:
    if USAGE_CACHE_TTL_SECONDS > 0:
        _usage_cache[key] = (time.monotonic() + USAGE_CACHE_TTL_SECONDS, payload)
    return payload

def _is_same_server(cloud_url: str, request: Request) -> bool:
    """Best-effort: avoid calling /api/auth/login on ourselves (infinite loop + CPU burn)."""
    cloud_url = (cloud_url or "").rstrip("/")
    if not cloud_url:
        return False

    try:
        cu = urlparse(cloud_url)
        cloud_host = (cu.hostname or "").lower()
        cloud_port = cu.port
    except Exception:
        return False

    # Prefer forwarded host if behind nginx.
    host_hdr = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip()
    # host header may include port
    if host_hdr:
        try:
            hu = urlparse(f"//{host_hdr}", scheme="http")
            req_host = (hu.hostname or "").lower()
            req_port = hu.port
        except Exception:
            req_host, req_port = host_hdr.lower(), None
    else:
        req_host = (request.url.hostname or "").lower()
        req_port = request.url.port

    if not req_host or not cloud_host:
        return False

    same_host = cloud_host == req_host or (cloud_host in ("127.0.0.1", "localhost") and req_host in ("127.0.0.1", "localhost"))
    if not same_host:
        return False

    # If either side doesn't specify port, treat as same (nginx/default ports).
    if cloud_port is None or req_port is None:
        return True
    return int(cloud_port) == int(req_port)


def _resolve_cloud_api_url(cloud_url: str, request: Request) -> str:
    """Return the URL to call for cloud API, or empty string if it would call ourselves."""
    cloud_url = (cloud_url or "").rstrip("/")
    if not cloud_url:
        return ""
    if _is_same_server(cloud_url, request):
        return ""
    pub_base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if pub_base and cloud_url == pub_base:
        # Legacy behavior: when cloud == public base and we're on the same machine, use local port.
        # But only if it wouldn't loop back to ourselves.
        local = "http://127.0.0.1:57991"
        if not _is_same_server(local, request):
            return local
        return ""
    return cloud_url


# ── Pydantic models ──────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "user"
    team: str = ""
    allowed_ips: str = ""

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    confirm_password: str

class UpdateUserRequest(BaseModel):
    display_name: str = None
    role: str = None
    is_active: int = None
    team: str = None
    allowed_ips: str = None


# ── Cloud sync helpers (self-contained to avoid circular imports) ─────

SYNC_SETTING_KEYS = [
    "gemini_api_key", "qwen_api_key", "openai_api_key", "openai_base_url",
    "fal_api_key", "ark_api_key", "jimeng_api_key", "dashscope_api_key", "game_dashscope_api_key", "hunyuan_secret_id",
    "hunyuan_secret_key", "vidu_api_key", "hailuo_api_key",
    "volcengine_tts_key", "fish_audio_api_key", "cosyvoice_base_url",
    "indextts_base_url", "nanobanana_api_key", "nanobanana_base_url", "api_proxy_url",
    "comfyui_base_url",
]
GROUP_SYNC_SETTING_SUFFIXES = [
    "ark_api_key", "jimeng_api_key",
    "gemini_api_key", "gemini_api_keys",
    "api_proxy_url",
    "openai_api_key", "openai_base_url",
    "qwen_api_key",
    "dashscope_api_key", "game_dashscope_api_key",
    "nanobanana_api_key", "nanobanana_pro_api_key", "nanobanana_base_url",
    "vidu_api_key", "hailuo_api_key", "fal_api_key",
    "hunyuan_secret_id", "hunyuan_secret_key",
    "fish_audio_api_key", "volcengine_tts_key",
    "cosyvoice_base_url", "indextts_base_url",
]
for _group in (
    "fa1", "fa1_hunbian", "fa1_project1", "fa1_project2", "fa1_project3", "fa1_creative", "fa1_baoliang",
    "fa2", "fa2_zhitou", "fa2_wechat", "fa2_tt", "fa2_research", "fa2_unassigned",
    "fa3", "fa3_baoliang", "market", "market_tt", "hr_admin_ssc", "unassigned_zhitou", "unassigned",
):
    for _suffix in GROUP_SYNC_SETTING_SUFFIXES:
        SYNC_SETTING_KEYS.append(f"group_api_{_group}_{_suffix}")


async def _sync_settings_from_cloud(cloud_api_url: str, cloud_token: str, cloud_url: str):
    """Pull API keys and settings from the cloud server into local settings."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                f"{cloud_api_url}/api/settings",
                headers={"Authorization": f"Bearer {cloud_token}"},
            )
            if resp.status_code != 200:
                return
            remote = resp.json()
        changed = False
        for key in SYNC_SETTING_KEYS:
            remote_val = remote.get(key)
            if remote_val and not deps.settings_manager.get(key):
                deps.settings_manager.set(key, remote_val)
                changed = True
        if not deps.settings_manager.get("cloud_url"):
            deps.settings_manager.set("cloud_url", cloud_url)
            deps.settings_manager.set("cloud_token", cloud_token)
            deps.settings_manager.set("auto_sync_enabled", True)
            deps.settings_manager.set("auto_sync_interval", 3)
            changed = True
        if changed:
            deps.init_services()
            logger.info("Synced settings from cloud: %s", cloud_url)
        await _pull_data_from_cloud(cloud_api_url, cloud_token)
    except Exception as e:
        logger.warning("Failed to sync settings from cloud: %s", e)


async def _pull_data_from_cloud(cloud_api_url: str, cloud_token: str):
    """Pull voices, series, episodes, storyboards, assets from cloud and merge locally."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(
                f"{cloud_api_url}/api/sync/export-data",
                headers={"Authorization": f"Bearer {cloud_token}"},
            )
            if resp.status_code != 200:
                logger.warning("Pull data: HTTP %s", resp.status_code)
                return
            remote = resp.json()

        conn = db.get_db()
        try:
            merged = 0
            for table in ["voices", "series", "series_assets", "episodes", "storyboards"]:
                remote_rows = remote.get(table, [])
                if not remote_rows:
                    continue
                existing_ids = {r[0] for r in conn.execute(f"SELECT id FROM {table}").fetchall()}
                for row in remote_rows:
                    rid = row.get("id")
                    if not rid or rid in existing_ids:
                        continue
                    cols = [k for k in row.keys() if k != "order"]
                    if "order" in row:
                        cols.append('"order"')
                    vals = [row[k] for k in row.keys() if k != "order"]
                    if "order" in row:
                        vals.append(row["order"])
                    placeholders = ",".join("?" * len(cols))
                    col_names = ",".join(c if c.startswith('"') else c for c in cols)
                    try:
                        conn.execute(f"INSERT OR IGNORE INTO {table} ({col_names}) VALUES ({placeholders})", vals)
                        merged += 1
                    except Exception as e:
                        logger.debug("Pull merge skip %s/%s: %s", table, rid, e)
            conn.commit()
            logger.info("Pulled %d records from cloud", merged)
        finally:
            conn.close()
    except Exception as e:
        logger.warning("Failed to pull data from cloud: %s", e)


async def _post_cloud_login(cloud_api_url: str, username: str, password: str):
    import httpx

    payload = {"username": username, "password": password}
    client = deps.http_client
    if client is None:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as tmp:
            return await tmp.post(f"{cloud_api_url}/api/auth/login", json=payload)
    return await client.post(f"{cloud_api_url}/api/auth/login", json=payload, timeout=10)


# ═══════════════════ Auth ═══════════════════

@router.post("/api/auth/login")
async def login(req: LoginRequest, request: Request):
    # bcrypt/sqlite auth is CPU+IO heavy; run it off the event loop
    user = await asyncio.to_thread(auth.authenticate, req.username, req.password)
    if user:
        token = auth.create_token(user)
        cloud_url = getattr(deps, "local_cloud_url", "") or (deps.settings_manager.get("cloud_url", "") or "").rstrip("/")
        cloud_api_url = _resolve_cloud_api_url(cloud_url, request)
        if cloud_api_url:
            try:
                resp = await _post_cloud_login(cloud_api_url, req.username, req.password)
                if resp.status_code == 200:
                    cloud_token = resp.json().get("token", "")
                    asyncio.create_task(_sync_settings_from_cloud(cloud_api_url, cloud_token, cloud_url))
            except Exception:
                pass
        return {"token": token, "user": user}

    cloud_url = getattr(deps, "local_cloud_url", "") or (deps.settings_manager.get("cloud_url", "") or "").rstrip("/")
    cloud_api_url = _resolve_cloud_api_url(cloud_url, request)
    if cloud_api_url:
        try:
            resp = await _post_cloud_login(cloud_api_url, req.username, req.password)
            if resp.status_code == 200:
                cloud_data = resp.json()
                cloud_user = cloud_data.get("user", {})
                cloud_token = cloud_data.get("token", "")
                # Cloud merge touches sqlite/bcrypt; keep it off the event loop as well.
                local_user = await asyncio.to_thread(auth.create_or_update_from_cloud, cloud_user, req.password)
                token = auth.create_token(local_user)
                asyncio.create_task(_sync_settings_from_cloud(cloud_api_url, cloud_token, cloud_url))
                return {"token": token, "user": local_user}
        except Exception as e:
            logger.warning("Cloud auth fallback failed: %s", e)

    raise HTTPException(401, "用户名或密码错误")


@router.api_route("/api/auth/status", methods=["GET", "HEAD"])
async def auth_status():
    return {"auth_enabled": AUTH_ENABLED}


@router.get("/api/auth/me")
async def get_me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "未登录")
    full = await asyncio.to_thread(auth.get_user_full, user.get("sub", "")) or {}
    return {"user": {
        "id": user.get("sub"),
        "username": user.get("username"),
        "role": user.get("role"),
        "display_name": full.get("display_name", ""),
        "team": full.get("team", ""),
        "allowed_ips": full.get("allowed_ips", ""),
        "must_change_password": int(full.get("must_change_password") or 0),
    }}


@router.get("/api/auth/users")
async def get_users(request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return await asyncio.to_thread(auth.list_users)


@router.post("/api/auth/users")
async def create_user_endpoint(req: CreateUserRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    try:
        new_user = await asyncio.to_thread(
            auth.create_user,
            req.username,
            req.password,
            req.display_name,
            req.role,
            req.team,
            req.allowed_ips,
        )
        return new_user
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/auth/change-password")
async def change_password_endpoint(req: ChangePasswordRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "未登录")
    if not req.old_password or not req.new_password or not req.confirm_password:
        raise HTTPException(400, "请完整填写原密码、新密码和确认密码")
    if req.new_password != req.confirm_password:
        raise HTTPException(400, "两次输入的新密码不一致")
    valid = await asyncio.to_thread(auth.verify_password, user["sub"], req.old_password)
    if not valid:
        raise HTTPException(400, "原密码不正确")
    await asyncio.to_thread(auth.change_password, user["sub"], req.new_password)
    return {"success": True}


@router.put("/api/auth/users/{user_id}")
async def update_user_endpoint(user_id: str, req: UpdateUserRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    result = await asyncio.to_thread(
        auth.update_user,
        user_id,
        req.display_name,
        req.role,
        req.is_active,
        req.team,
        req.allowed_ips,
    )
    if not result:
        raise HTTPException(404, "用户不存在")
    return result


@router.post("/api/auth/users/{user_id}/delete")
async def delete_user_endpoint(user_id: str, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    if user_id == user.get("sub"):
        raise HTTPException(400, "不能删除自己")
    deleted = await asyncio.to_thread(auth.delete_user, user_id)
    if not deleted:
        raise HTTPException(400, "无法删除该用户（admin 不可删除）")
    return {"success": True}


# ═══════════════════ Admin: Cross-User Asset Viewing ═══════════════════

@router.get("/api/admin/users")
async def admin_list_users(request: Request):
    deps.require_admin(request)
    return await asyncio.to_thread(auth.list_all_user_ids)


def _date_keys(days: int) -> list[str]:
    days = max(1, min(int(days or 7), 365))
    today = datetime.utcnow().date()
    start = today - timedelta(days=days - 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]


def _empty_daily_from_keys(keys: list[str]) -> dict[str, dict]:
    return {
        d: {
            "date": d,
            "project_count": 0,
            "task_count": 0,
            "completed_task_count": 0,
            "failed_task_count": 0,
            "image_file_count": 0,
            "video_file_count": 0,
            "storage_bytes": 0,
            "video_generation_count": 0,
            "billable_video_seconds": 0.0,
            "estimated_video_cost_cny": 0.0,
            "unpriced_video_task_count": 0,
        }
        for d in keys
    }


def _empty_daily(days: int) -> dict[str, dict]:
    return _empty_daily_from_keys(_date_keys(days))


def _resolve_usage_date_keys(days: int, start_date: Optional[str] = None, end_date: Optional[str] = None) -> list[str]:
    if not start_date and not end_date:
        return _date_keys(days)
    if not start_date or not end_date:
        raise HTTPException(400, "start_date 和 end_date 需要同时提供")
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "日期格式错误，需为 YYYY-MM-DD")
    if end < start:
        raise HTTPException(400, "end_date 不能早于 start_date")
    span = (end - start).days + 1
    if span < 1 or span > 365:
        raise HTTPException(400, "日期范围需在 1 到 365 天之间")
    return [(start + timedelta(days=i)).isoformat() for i in range(span)]


def _date_from_text(value: str) -> str:
    return (value or "")[:10]


def _filename_from_file_url(url: str) -> str:
    if not url or "/api/files/" not in url:
        return ""
    path = urlparse(url).path if url.startswith(("http://", "https://")) else url
    if "/api/files/" not in path:
        return ""
    filename = path.split("/api/files/", 1)[1].split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if not filename or filename in (".", "..") or "/" in filename or "\\" in filename:
        return ""
    return filename


def _find_usage_video_path(video_url: str, files_root) -> Path | None:
    filename = _filename_from_file_url(video_url)
    if not filename:
        return None
    candidates = []
    if files_root:
        candidates.append(Path(files_root) / filename)
    candidates.append(auth.USER_DATA_DIR / "files" / filename)
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _read_mp4_duration_seconds(path: Path) -> float | None:
    def read_box_header(handle):
        header = handle.read(8)
        if len(header) < 8:
            return None
        size = int.from_bytes(header[:4], "big")
        box_type = header[4:8]
        header_size = 8
        if size == 1:
            extended = handle.read(8)
            if len(extended) < 8:
                return None
            size = int.from_bytes(extended, "big")
            header_size = 16
        elif size == 0:
            size = path.stat().st_size - handle.tell() + header_size
        if size < header_size:
            return None
        return size, box_type, header_size

    def scan_boxes(handle, end_pos: int) -> float | None:
        while handle.tell() + 8 <= end_pos:
            box_start = handle.tell()
            header = read_box_header(handle)
            if not header:
                return None
            size, box_type, header_size = header
            box_end = min(box_start + size, end_pos)
            payload_size = box_end - handle.tell()
            if payload_size < 0:
                return None
            if box_type == b"mvhd":
                payload = handle.read(min(payload_size, 32))
                if len(payload) < 20:
                    return None
                version = payload[0]
                if version == 1:
                    if len(payload) < 32:
                        return None
                    timescale = int.from_bytes(payload[20:24], "big")
                    duration = int.from_bytes(payload[24:32], "big")
                else:
                    timescale = int.from_bytes(payload[12:16], "big")
                    duration = int.from_bytes(payload[16:20], "big")
                if timescale > 0 and duration > 0:
                    return duration / timescale
                return None
            if box_type == b"moov":
                duration = scan_boxes(handle, box_end)
                if duration:
                    return duration
            handle.seek(box_end)
        return None

    try:
        with path.open("rb") as handle:
            return scan_boxes(handle, path.stat().st_size)
    except OSError:
        return None


def _probe_video_duration_seconds(path: Path) -> float | None:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return _read_mp4_duration_seconds(path)
    try:
        duration = float((completed.stdout or "").strip())
    except ValueError:
        return _read_mp4_duration_seconds(path)
    return duration if duration > 0 else _read_mp4_duration_seconds(path)


def _video_model_spec(model: str) -> dict:
    return get_video_model_spec(model)


def _video_price_per_second_cny(model: str) -> float | None:
    item = _video_model_spec(model)
    if item:
        if (item.get("price_unit") or "CNY").upper() != "CNY":
            return None
        try:
            price = float(item.get("price_per_second") or 0)
        except (TypeError, ValueError):
            return None
        return price if price > 0 else None
    return None


def _task_video_cost(model: str, video_url: str, files_root, ref_video_path: str = "") -> tuple[float, float, bool]:
    price = _video_price_per_second_cny(model or "")
    if not price or not video_url:
        return 0.0, 0.0, False
    path = _find_usage_video_path(video_url, files_root)
    if not path:
        return 0.0, 0.0, False
    duration = _probe_video_duration_seconds(path)
    if duration is None:
        return 0.0, 0.0, False

    billable_duration = duration
    if _video_model_spec(model or "").get("price_billing") == "input_output" and ref_video_path:
        refs: list[str] = []
        try:
            parsed = json.loads(ref_video_path)
            refs = [url for url in parsed if isinstance(url, str)]
        except Exception:
            refs = [ref_video_path]
        if refs:
            input_path = _find_usage_video_path(refs[0], files_root)
            if input_path:
                input_duration = _probe_video_duration_seconds(input_path)
                if input_duration:
                    billable_duration += input_duration

    return billable_duration, round(billable_duration * price, 2), True


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _count_files(root, days: int = 7, date_keys: Optional[list[str]] = None):
    total_count = 0
    total_bytes = 0
    image_count = 0
    video_count = 0
    keys = date_keys or _date_keys(days)
    daily = _empty_daily_from_keys(keys)
    if not root.exists():
        return {
            "file_count": 0,
            "storage_bytes": 0,
            "image_file_count": 0,
            "video_file_count": 0,
            "daily": list(daily.values()),
        }
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".mov", ".webm", ".mkv"}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
            size = stat.st_size
            mtime = stat.st_mtime
        except OSError:
            size = 0
            mtime = 0
        ext = path.suffix.lower()
        day = datetime.utcfromtimestamp(mtime).date().isoformat()
        if day not in daily:
            continue
        total_count += 1
        total_bytes += size
        daily[day]["storage_bytes"] += size
        if ext in image_exts:
            image_count += 1
            daily[day]["image_file_count"] += 1
        elif ext in video_exts:
            video_count += 1
            daily[day]["video_file_count"] += 1
    return {
        "file_count": total_count,
        "storage_bytes": total_bytes,
        "image_file_count": image_count,
        "video_file_count": video_count,
        "daily": list(daily.values()),
    }


def _count_user_db(db_path, days: int = 7, files_root=None, date_keys: Optional[list[str]] = None):
    stats = {
        "project_count": 0,
        "asset_count": 0,
        "task_count": 0,
        "completed_task_count": 0,
        "failed_task_count": 0,
        "video_task_count": 0,
        "replace_task_count": 0,
        "video_generation_count": 0,
        "billable_video_seconds": 0.0,
        "estimated_video_cost_cny": 0.0,
        "unpriced_video_task_count": 0,
        "last_activity_at": "",
        "daily": list(_empty_daily_from_keys(date_keys or _date_keys(days)).values()),
    }
    if not db_path.exists():
        return stats
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.execute("PRAGMA busy_timeout=10000")
    try:
        keys = date_keys or _date_keys(days)
        daily = _empty_daily_from_keys(keys)
        row = conn.execute(
            """
            SELECT MAX(ts) FROM (
                SELECT MAX(updated_at) AS ts FROM game_projects
                UNION ALL
                SELECT MAX(updated_at) AS ts FROM game_tasks
            )
            """
        ).fetchone()
        stats["last_activity_at"] = row[0] or ""
        for created_at, count in conn.execute("SELECT created_at, COUNT(*) FROM game_projects GROUP BY substr(created_at, 1, 10)").fetchall():
            day = _date_from_text(created_at)
            if day in daily:
                daily[day]["project_count"] += count
        for created_at, status, count in conn.execute("SELECT created_at, status, COUNT(*) FROM game_tasks GROUP BY substr(created_at, 1, 10), status").fetchall():
            day = _date_from_text(created_at)
            if day in daily:
                daily[day]["task_count"] += count
                if status == "completed":
                    daily[day]["completed_task_count"] += count
                elif status == "failed":
                    daily[day]["failed_task_count"] += count
        for created_at, task_type, count in conn.execute("SELECT created_at, type, COUNT(*) FROM game_tasks GROUP BY substr(created_at, 1, 10), type").fetchall():
            day = _date_from_text(created_at)
            if day not in daily:
                continue
            if task_type == "generate":
                stats["video_task_count"] += count
            elif task_type == "replace":
                stats["replace_task_count"] += count
        columns = _table_columns(conn, "game_tasks")
        has_billing_snapshot = {"billable_video_seconds", "estimated_cost_cny", "billing_status"}.issubset(columns)
        if has_billing_snapshot:
            billing_rows = conn.execute(
                """
                SELECT created_at, model, video_url, ref_video_path,
                       billable_video_seconds, estimated_cost_cny, billing_status
                FROM game_tasks
                WHERE type='generate' AND status='completed'
                """
            ).fetchall()
        else:
            billing_rows = [
                (*row, 0, 0, "")
                for row in conn.execute(
                    """
                    SELECT created_at, model, video_url, ref_video_path
                    FROM game_tasks
                    WHERE type='generate' AND status='completed'
                    """
                ).fetchall()
            ]

        for created_at, model, video_url, ref_video_path, snap_seconds, snap_cost, billing_status in billing_rows:
            day = _date_from_text(created_at)
            if day not in daily:
                continue
            if billing_status == "snapshot" and (snap_seconds or snap_cost):
                duration, cost, priced = float(snap_seconds or 0), float(snap_cost or 0), True
            else:
                duration, cost, priced = _task_video_cost(model, video_url, files_root, ref_video_path or "")
            stats["video_generation_count"] += 1
            daily[day]["video_generation_count"] += 1
            if priced:
                stats["billable_video_seconds"] += duration
                stats["estimated_video_cost_cny"] += cost
                daily[day]["billable_video_seconds"] += duration
                daily[day]["estimated_video_cost_cny"] += cost
            else:
                stats["unpriced_video_task_count"] += 1
                daily[day]["unpriced_video_task_count"] += 1
        stats["project_count"] = sum(day["project_count"] for day in daily.values())
        stats["task_count"] = sum(day["task_count"] for day in daily.values())
        stats["completed_task_count"] = sum(day["completed_task_count"] for day in daily.values())
        stats["failed_task_count"] = sum(day["failed_task_count"] for day in daily.values())
        stats["billable_video_seconds"] = round(stats["billable_video_seconds"], 2)
        stats["estimated_video_cost_cny"] = round(stats["estimated_video_cost_cny"], 2)
        for day in daily.values():
            day["billable_video_seconds"] = round(day["billable_video_seconds"], 2)
            day["estimated_video_cost_cny"] = round(day["estimated_video_cost_cny"], 2)
        stats["daily"] = list(daily.values())
    finally:
        conn.close()
    return stats


def _merge_daily(db_daily: list[dict], file_daily: list[dict]) -> list[dict]:
    merged = {row["date"]: dict(row) for row in db_daily}
    for row in file_daily:
        target = merged.setdefault(row["date"], dict(row))
        for key in ("image_file_count", "video_file_count", "storage_bytes"):
            target[key] = (target.get(key, 0) or 0) + (row.get(key, 0) or 0)
    return [merged[d] for d in sorted(merged)]


def _usage_for_user(user: dict, days: int = 7, date_keys: Optional[list[str]] = None) -> dict:
    uid = user["id"]
    files_root = auth.get_user_files_dir(uid)
    db_stats = _count_user_db(auth.get_user_db_path(uid), days=days, files_root=files_root, date_keys=date_keys)
    file_stats = _count_files(files_root, days=days, date_keys=date_keys)
    public_user = {k: user.get(k, "") for k in ("id", "username", "display_name", "role", "team", "allowed_ips", "must_change_password")}
    row = {**public_user, **db_stats, **{k: v for k, v in file_stats.items() if k != "daily"}}
    department, team_group = _usage_org_for_user(public_user)
    row["department"] = department
    row["team_group"] = team_group
    row["daily"] = _merge_daily(db_stats.get("daily", []), file_stats.get("daily", []))
    return row


_KNOWN_DEPARTMENTS = (
    "总经办",
    "人力资源部",
    "财务部",
    "智能加速中心",
    "大数据部",
    "市场发展部",
    "研发中心",
    "发行事业一部",
    "发行事业二部",
    "发行事业三部",
)


def _usage_org_for_user(user: dict) -> tuple[str, str]:
    team_value = (user.get("team") or "").strip()
    return _usage_department_and_team(team_value)


def _users_in_usage_department(users: list[dict], department: str) -> list[dict]:
    target_department = (department or "").strip()
    if not target_department:
        return []
    return [
        user for user in users
        if _usage_org_for_user(user)[0] == target_department
    ]


def _users_in_exact_usage_team(users: list[dict], team: str) -> list[dict]:
    target_team = (team or "").strip()
    return [
        user for user in users
        if (user.get("team") or "").strip() == target_team
    ]


def _usage_department_and_team(team: str) -> tuple[str, str]:
    value = (team or "").strip()
    if not value:
        return "未分部门", "未分团队"
    for separator in ("-", "－", "—"):
        if separator in value:
            department, group = value.split(separator, 1)
            department = department.strip()
            group = group.strip()
            if department and group:
                return department, group
    for department in _KNOWN_DEPARTMENTS:
        if value == department:
            return department, "未分团队"
        prefix = f"{department}-"
        if value.startswith(prefix):
            group = value[len(prefix):].strip("-") or "未分团队"
            return department, group
    return "未分部门", value


def _empty_usage_totals(user_count: int = 0) -> dict:
    return {
        "user_count": user_count,
        "project_count": 0,
        "asset_count": 0,
        "task_count": 0,
        "file_count": 0,
        "storage_bytes": 0,
        "image_file_count": 0,
        "video_file_count": 0,
        "video_generation_count": 0,
        "billable_video_seconds": 0.0,
        "estimated_video_cost_cny": 0.0,
        "unpriced_video_task_count": 0,
    }


_USAGE_SUM_KEYS = (
    "project_count", "asset_count", "task_count", "completed_task_count",
    "failed_task_count", "file_count", "storage_bytes", "image_file_count",
    "video_file_count", "video_generation_count", "billable_video_seconds",
    "estimated_video_cost_cny", "unpriced_video_task_count",
)


def _add_usage_totals(target: dict, row: dict) -> None:
    target["user_count"] = (target.get("user_count", 0) or 0) + 1
    for key in _USAGE_SUM_KEYS:
        target[key] = (target.get(key, 0) or 0) + (row.get(key, 0) or 0)


def _finalize_usage_totals(target: dict) -> dict:
    target["billable_video_seconds"] = round(target.get("billable_video_seconds", 0) or 0, 2)
    target["estimated_video_cost_cny"] = round(target.get("estimated_video_cost_cny", 0) or 0, 2)
    return target


def _usage_hierarchy(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    departments: dict[str, dict] = {}
    groups: dict[tuple[str, str], dict] = {}
    for row in rows:
        department = row.get("department") or "未分部门"
        team_group = row.get("team_group") or row.get("team") or "未分团队"
        dept_row = departments.setdefault(department, {"department": department, **_empty_usage_totals()})
        group_row = groups.setdefault(
            (department, team_group),
            {"department": department, "team": team_group, **_empty_usage_totals()},
        )
        _add_usage_totals(dept_row, row)
        _add_usage_totals(group_row, row)
    department_rows = [_finalize_usage_totals(row) for row in departments.values()]
    group_rows = [_finalize_usage_totals(row) for row in groups.values()]
    department_rows.sort(key=lambda item: item.get("estimated_video_cost_cny", 0), reverse=True)
    group_rows.sort(key=lambda item: (item.get("department", ""), -item.get("estimated_video_cost_cny", 0)))
    return department_rows, group_rows


async def _usage_response_for_users(users: list[dict], days: int) -> dict:
    date_keys = _date_keys(days)
    return await _usage_response_for_users_filtered(users, days, date_keys=date_keys)


def _filter_usage_rows(rows: list[dict], department: str = "", team_group: str = "") -> list[dict]:
    dep = (department or "").strip()
    grp = (team_group or "").strip()
    if not dep and not grp:
        return rows
    result = []
    for row in rows:
        row_dep = row.get("department") or "未分部门"
        row_grp = row.get("team_group") or row.get("team") or "未分团队"
        if dep and row_dep != dep:
            continue
        if grp and row_grp != grp:
            continue
        result.append(row)
    return result


async def _usage_response_for_users_filtered(
    users: list[dict],
    days: int,
    date_keys: list[str],
    department: str = "",
    team_group: str = "",
) -> dict:
    rows = []
    totals = _empty_usage_totals(0)
    daily_totals = _empty_daily_from_keys(date_keys)
    usage_tasks = [asyncio.to_thread(_usage_for_user, user, days, date_keys) for user in users]
    for row in await asyncio.gather(*usage_tasks):
        rows.append(row)
    rows = _filter_usage_rows(rows, department=department, team_group=team_group)
    totals["user_count"] = len(rows)
    for row in rows:
        for key in totals:
            if key == "user_count":
                continue
            totals[key] += row.get(key, 0) or 0
        for day in row.get("daily", []):
            target = daily_totals.get(day["date"])
            if not target:
                continue
            for key in (
                "project_count", "task_count", "completed_task_count", "failed_task_count",
                "image_file_count", "video_file_count", "storage_bytes", "video_generation_count",
                "billable_video_seconds", "estimated_video_cost_cny", "unpriced_video_task_count",
            ):
                target[key] += day.get(key, 0) or 0
    totals["billable_video_seconds"] = round(totals["billable_video_seconds"], 2)
    totals["estimated_video_cost_cny"] = round(totals["estimated_video_cost_cny"], 2)
    for day in daily_totals.values():
        day["billable_video_seconds"] = round(day["billable_video_seconds"], 2)
        day["estimated_video_cost_cny"] = round(day["estimated_video_cost_cny"], 2)
    rows.sort(key=lambda item: (item.get("estimated_video_cost_cny", 0), item.get("task_count", 0)), reverse=True)
    departments, groups = _usage_hierarchy(rows)
    return {
        "totals": totals,
        "departments": departments,
        "groups": groups,
        "users": rows,
        "daily": list(daily_totals.values()),
    }


@router.get("/api/account/usage")
async def account_usage(request: Request, days: int = 7, refresh: bool = False):
    user = getattr(request.state, "user", None)
    if not user:
        if not AUTH_ENABLED:
            cache_key = ("account", "local", int(days or 7))
            cached = _get_usage_cache(cache_key, refresh)
            if cached is not None:
                return cached
            db_stats = await asyncio.to_thread(_count_user_db, db.get_db_path(), days, deps.get_files_dir())
            file_stats = await asyncio.to_thread(_count_files, deps.get_files_dir(), days)
            local_user = {
                "id": "local",
                "username": "local",
                "display_name": "本地模式",
                "role": "admin",
            }
            usage = {**local_user, **db_stats, **{k: v for k, v in file_stats.items() if k != "daily"}}
            usage["daily"] = _merge_daily(db_stats.get("daily", []), file_stats.get("daily", []))
            return _set_usage_cache(cache_key, {"totals": {k: usage.get(k, 0) for k in (
                "project_count", "asset_count", "task_count", "completed_task_count",
                "failed_task_count", "file_count", "storage_bytes", "image_file_count",
                "video_file_count", "video_generation_count", "billable_video_seconds",
                "estimated_video_cost_cny", "unpriced_video_task_count",
            )}, "user": usage, "daily": usage.get("daily", [])})
        raise HTTPException(401, "Not logged in")
    cache_key = ("account", user.get("sub", ""), int(days or 7))
    cached = _get_usage_cache(cache_key, refresh)
    if cached is not None:
        return cached
    full = await asyncio.to_thread(auth.get_user_full, user.get("sub", ""))
    if not full:
        full = {
            "id": user.get("sub", ""),
            "username": user.get("username", ""),
            "role": user.get("role", "user"),
        }
    usage = await asyncio.to_thread(_usage_for_user, full, days)
    return _set_usage_cache(cache_key, {"totals": {k: usage.get(k, 0) for k in (
        "project_count", "asset_count", "task_count", "completed_task_count",
        "failed_task_count", "file_count", "storage_bytes", "image_file_count",
        "video_file_count", "video_generation_count", "billable_video_seconds",
        "estimated_video_cost_cny", "unpriced_video_task_count",
    )}, "user": usage, "daily": usage.get("daily", [])})


@router.get("/api/admin/usage")
async def admin_usage(
    request: Request,
    days: int = 7,
    refresh: bool = False,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department: str = "",
    team_group: str = "",
):
    deps.require_admin(request)
    date_keys = _resolve_usage_date_keys(days, start_date=start_date, end_date=end_date)
    cache_key = ("admin", tuple(date_keys), (department or "").strip(), (team_group or "").strip())
    cached = _get_usage_cache(cache_key, refresh)
    if cached is not None:
        return cached
    users = await asyncio.to_thread(auth.list_all_user_ids)
    return _set_usage_cache(
        cache_key,
        await _usage_response_for_users_filtered(
            users,
            days,
            date_keys=date_keys,
            department=department,
            team_group=team_group,
        ),
    )


@router.get("/api/account/team-usage")
async def team_usage(
    request: Request,
    days: int = 7,
    refresh: bool = False,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    department: str = "",
    team_group: str = "",
):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Not logged in")
    full = await asyncio.to_thread(auth.get_user_full, user.get("sub", ""))
    if not full:
        raise HTTPException(401, "用户不存在")
    current_team = (full.get("team") or "").strip()
    current_department, current_team_group = _usage_org_for_user(full)
    date_keys = _resolve_usage_date_keys(days, start_date=start_date, end_date=end_date)
    cache_key = ("team", current_team, tuple(date_keys))
    cached = _get_usage_cache(cache_key, refresh)
    if cached is not None:
        return cached
    all_users = await asyncio.to_thread(auth.list_all_user_ids)
    users = _users_in_exact_usage_team(all_users, current_team) or [full]
    payload = await _usage_response_for_users_filtered(
        users,
        days,
        date_keys=date_keys,
        department=current_department,
        team_group=current_team_group,
    )
    payload["department"] = current_department
    payload["team"] = current_team_group
    payload["scope"] = {"team": current_team, "department": current_department, "team_group": current_team_group}
    return _set_usage_cache(cache_key, payload)


@router.get("/api/admin/all-series")
async def admin_all_series(request: Request):
    deps.require_admin(request)
    raise HTTPException(410, "旧版剧集管理接口已下线，请使用游戏项目接口")


@router.get("/api/admin/user/{user_id}/series")
async def admin_user_series(user_id: str, request: Request):
    deps.require_admin(request)
    raise HTTPException(410, "旧版剧集管理接口已下线，请使用游戏项目接口")
