from __future__ import annotations

"""
JWT authentication module.
- shared users table in a separate auth.db
- per-user SQLite database isolation
- bcrypt password hashing
- JWT token generation and validation
"""

import os
import json
import sqlite3
import uuid
import hashlib
import threading
import ipaddress
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import jwt as pyjwt

USER_DATA_DIR = Path(os.environ.get("USER_DATA_DIR", Path.home() / ".game-video-tool"))
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

AUTH_DB_PATH = USER_DATA_DIR / "auth.db"
JWT_SECRET = os.environ.get("JWT_SECRET", "game-video-tool-secret-" + hashlib.md5(str(USER_DATA_DIR).encode()).hexdigest()[:16])
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72
_known_user_dirs: set[Path] = set()
_known_user_files_dirs: set[Path] = set()
_user_dir_lock = threading.RLock()


def _get_auth_db():
    conn = sqlite3.connect(str(AUTH_DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_auth_db():
    conn = _get_auth_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT DEFAULT '',
            role TEXT DEFAULT 'user',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            last_login TEXT DEFAULT ''
        );
    """)
    conn.commit()

    for col_def in (
        "team TEXT DEFAULT ''",
        "allowed_ips TEXT DEFAULT ''",
        "must_change_password INTEGER DEFAULT 0",
    ):
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
        except sqlite3.OperationalError:
            pass
    conn.commit()

    user_count = conn.execute("SELECT COUNT(1) AS count FROM users").fetchone()["count"]
    active_admin = conn.execute("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1").fetchone()
    if user_count == 0 and not active_admin:
        admin_id = uuid.uuid4().hex[:12]
        pw_hash = bcrypt.hashpw("123456".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        now = datetime.utcnow().isoformat() + "Z"
        conn.execute(
            "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?,?)",
            (admin_id, "admin", pw_hash, "管理员", "admin", now),
        )
        conn.commit()

    conn.close()


def authenticate(username: str, password: str) -> Optional[dict]:
    conn = _get_auth_db()
    row = conn.execute("SELECT * FROM users WHERE username=? AND is_active=1", (username,)).fetchone()
    conn.close()
    if not row:
        return None
    user = dict(row)
    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return None
    conn = _get_auth_db()
    conn.execute("UPDATE users SET last_login=? WHERE id=?", (datetime.utcnow().isoformat() + "Z", user["id"]))
    conn.commit()
    conn.close()
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
        "team": user.get("team", ""),
        "allowed_ips": user.get("allowed_ips", ""),
        "must_change_password": int(user.get("must_change_password") or 0),
    }


def is_ip_allowed(client_ip: str, allowed_ips: str) -> bool:
    rules = [
        item.strip()
        for item in (allowed_ips or "").replace("，", ",").replace("\n", ",").split(",")
        if item.strip()
    ]
    if not rules:
        return True
    try:
        ip = ipaddress.ip_address((client_ip or "").strip())
    except ValueError:
        return False
    for rule in rules:
        try:
            if "/" in rule:
                if ip in ipaddress.ip_network(rule, strict=False):
                    return True
            elif ip == ipaddress.ip_address(rule):
                return True
        except ValueError:
            continue
    return False


def verify_password(user_id: str, password: str) -> bool:
    conn = _get_auth_db()
    row = conn.execute("SELECT password_hash FROM users WHERE id=? AND is_active=1", (user_id,)).fetchone()
    conn.close()
    if not row:
        return False
    return bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8"))


def create_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "must_change_password": int(user.get("must_change_password") or 0),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.utcnow(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except pyjwt.ExpiredSignatureError:
        return None
    except pyjwt.InvalidTokenError:
        return None


def get_user_data_dir(user_id: str) -> Path:
    user_dir = USER_DATA_DIR / "users" / user_id
    with _user_dir_lock:
        if user_dir not in _known_user_dirs:
            user_dir.mkdir(parents=True, exist_ok=True)
            _known_user_dirs.add(user_dir)
    return user_dir


def get_user_db_path(user_id: str) -> Path:
    return get_user_data_dir(user_id) / "database.db"


def get_user_files_dir(user_id: str) -> Path:
    files_dir = get_user_data_dir(user_id) / "files"
    with _user_dir_lock:
        if files_dir not in _known_user_files_dirs:
            files_dir.mkdir(parents=True, exist_ok=True)
            _known_user_files_dirs.add(files_dir)
    return files_dir


def list_users() -> list:
    conn = _get_auth_db()
    rows = conn.execute("SELECT id, username, display_name, role, is_active, created_at, last_login, team, allowed_ips, must_change_password FROM users ORDER BY created_at").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_user(
    username: str,
    password: str,
    display_name: str = "",
    role: str = "user",
    team: str = "",
    allowed_ips: str = "",
) -> dict:
    conn = _get_auth_db()
    uid = uuid.uuid4().hex[:12]
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = datetime.utcnow().isoformat() + "Z"
    try:
        conn.execute(
            "INSERT INTO users (id, username, password_hash, display_name, role, team, allowed_ips, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, username, pw_hash, display_name or username, role, team or "", allowed_ips or "", now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise ValueError(f"Username '{username}' already exists")
    row = conn.execute("SELECT id, username, display_name, role, is_active, created_at, team, allowed_ips, must_change_password FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return dict(row)


def upsert_imported_user(username: str, password: str, display_name: str, team: str = "", allowed_ips: str = "") -> dict:
    init_auth_db()
    conn = _get_auth_db()
    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE users SET display_name=?, role='user', is_active=1, team=?, allowed_ips=?, must_change_password=1 WHERE username=?",
            (display_name or username, team, allowed_ips, username),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, username, display_name, role, is_active, created_at, team, allowed_ips, must_change_password FROM users WHERE username=?",
            (username,),
        ).fetchone()
        conn.close()
        return dict(row)

    uid = uuid.uuid4().hex[:12]
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = datetime.utcnow().isoformat() + "Z"
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, is_active, created_at, team, allowed_ips, must_change_password) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (uid, username, pw_hash, display_name or username, "user", 1, now, team, allowed_ips, 1),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id, username, display_name, role, is_active, created_at, team, allowed_ips, must_change_password FROM users WHERE id=?",
        (uid,),
    ).fetchone()
    conn.close()
    return dict(row)


def change_password(user_id: str, new_password: str):
    conn = _get_auth_db()
    pw_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    conn.execute("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", (pw_hash, user_id))
    conn.commit()
    conn.close()


def delete_user(user_id: str) -> bool:
    conn = _get_auth_db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
    if not row or row["username"] == "admin":
        conn.close()
        return False
    conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.commit()
    conn.close()
    return True


def update_user(
    user_id: str,
    display_name: str = None,
    role: str = None,
    is_active: int = None,
    team: str = None,
    allowed_ips: str = None,
):
    conn = _get_auth_db()
    updates, params = [], []
    if display_name is not None:
        updates.append("display_name=?"); params.append(display_name)
    if role is not None:
        updates.append("role=?"); params.append(role)
    if is_active is not None:
        updates.append("is_active=?"); params.append(is_active)
    if team is not None:
        updates.append("team=?"); params.append(team)
    if allowed_ips is not None:
        updates.append("allowed_ips=?"); params.append(allowed_ips)
    if updates:
        params.append(user_id)
        conn.execute(f"UPDATE users SET {','.join(updates)} WHERE id=?", params)
        conn.commit()
    row = conn.execute("SELECT id, username, display_name, role, is_active, created_at, last_login, team, allowed_ips, must_change_password FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_all_user_ids() -> list:
    conn = _get_auth_db()
    rows = conn.execute("SELECT id, username, display_name, role, team, allowed_ips, must_change_password FROM users WHERE is_active=1 ORDER BY created_at").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_active_users_by_team(team: str) -> list:
    conn = _get_auth_db()
    rows = conn.execute(
        """
        SELECT id, username, display_name, role, team, allowed_ips, must_change_password
        FROM users
        WHERE is_active=1 AND team=?
        ORDER BY created_at
        """,
        (team or "",),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_user_full(user_id: str) -> Optional[dict]:
    lookup = (user_id or "").strip()
    if not lookup:
        return None
    conn = _get_auth_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (lookup,)).fetchone()
    if not row:
        row = conn.execute("SELECT * FROM users WHERE username=?", (lookup,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_or_update_from_cloud(cloud_user: dict, password: str) -> dict:
    """Create or update a local user from a successful cloud login, then return it."""
    conn = _get_auth_db()
    uid = cloud_user.get("id", uuid.uuid4().hex[:12])
    username = cloud_user["username"]
    display_name = cloud_user.get("display_name", username)
    role = cloud_user.get("role", "user")
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE users SET password_hash=?, display_name=?, role=?, is_active=1 WHERE username=?",
            (pw_hash, display_name, role, username),
        )
        conn.commit()
        row = conn.execute("SELECT id, username, display_name, role FROM users WHERE username=?", (username,)).fetchone()
    else:
        now = datetime.utcnow().isoformat() + "Z"
        conn.execute(
            "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?,?)",
            (uid, username, pw_hash, display_name, role, now),
        )
        conn.commit()
        row = conn.execute("SELECT id, username, display_name, role FROM users WHERE id=?", (uid,)).fetchone()

    conn.close()
    return dict(row)


def import_user_from_config(config_path: Path) -> Optional[dict]:
    """Read user_config.json and ensure the user exists in local auth.db."""
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    username = data.get("username")
    pw_hash = data.get("password_hash")
    if not username or not pw_hash:
        return None

    init_auth_db()
    conn = _get_auth_db()
    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE users SET password_hash=?, display_name=?, role=? WHERE username=?",
            (pw_hash, data.get("display_name", username), data.get("role", "user"), username),
        )
        conn.commit()
        row = conn.execute("SELECT id, username, display_name, role FROM users WHERE username=?", (username,)).fetchone()
        conn.close()
        return dict(row)

    uid = data.get("id") or uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat() + "Z"
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?,?)",
        (uid, username, pw_hash, data.get("display_name", username), data.get("role", "user"), now),
    )
    conn.commit()
    row = conn.execute("SELECT id, username, display_name, role FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return dict(row)


init_auth_db()
