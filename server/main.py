"""游戏视频素材工具 — 独立服务端入口"""
from __future__ import annotations

import argparse
import os
import sys
import json
import uuid
import asyncio
import logging
import time
import warnings
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

# FastAPI's OpenAPI builder validates operation_id once per (path, method)
# pair, but each APIRoute only computes a single unique_id (no method
# distinction), so any endpoint declared with @app.api_route(methods=[GET,
# HEAD]) trips a "Duplicate Operation ID" UserWarning at startup. The id
# clash is internal-only — we still serve every method correctly — and
# generate_unique_id_function below ensures real cross-router duplicates
# (e.g. two `upload_file` functions on different paths) are caught.
warnings.filterwarnings(
    "ignore",
    message=r"Duplicate Operation ID .* for function",
    category=UserWarning,
    module=r"fastapi\.openapi\.utils",
)

logger = logging.getLogger("game-video-tool")

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
import httpx

from ai_service import AIService, split_api_keys
from openai_service import OpenAIService
from jimeng_service import JimengService
from vidu_service import ViduService
from settings import SettingsManager
from cloud_sync import CloudSyncManager
from observability import is_local_observability_request
from performance_observability import format_perf_log, should_log_performance
from provider_queue import provider_queue_snapshot
from task_status_query import status_query_snapshot
import database as db
import auth
import deps

APP_VERSION = "1.0.7"
APP_BUILD_DATE = "2026-04-25"

settings_manager = SettingsManager()
ai_service: Optional[AIService] = None
openai_service: Optional[OpenAIService] = None
jimeng_service: Optional[JimengService] = None
vidu_service: Optional[ViduService] = None

_cloud_sync = CloudSyncManager(settings_manager, db)
deps.cloud_sync = _cloud_sync


def _get_proxy_url() -> str:
    return (os.environ.get("HK_PROXY_URL", "") or settings_manager.get("api_proxy_url", "")).rstrip("/")


def _get_setting_key_pool(*names: str) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for name in names:
        for key in split_api_keys(settings_manager.get(name, "")):
            if key not in seen:
                seen.add(key)
                keys.append(key)
        for key in split_api_keys(os.environ.get(name.upper(), "")):
            if key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


def _init_services():
    global ai_service, openai_service, jimeng_service, vidu_service
    hk_proxy = _get_proxy_url()
    ai_service = None
    openai_service = None
    jimeng_service = None
    vidu_service = None
    deps.game_ai_service = None
    deps.game_jimeng_service = None
    deps.game_vidu_service = None

    gemini_keys = _get_setting_key_pool("gemini_api_keys", "gemini_api_key")
    if gemini_keys:
        gemini_proxy = f"{hk_proxy}/gemini" if hk_proxy else ""
        ai_service = AIService(api_key=gemini_keys[0], api_keys=gemini_keys, proxy_base_url=gemini_proxy)

    ok = settings_manager.get("openai_api_key", "")
    ob = settings_manager.get("openai_base_url", "")
    if ok:
        if hk_proxy:
            ob = f"{hk_proxy}/openai/v1"
        elif not ob:
            ob = "https://open-api.mincode.cn/v1"
        openai_service = OpenAIService(api_key=ok, base_url=ob)

    k = settings_manager.get("ark_api_key", "") or settings_manager.get("jimeng_api_key", "")
    if k:
        jimeng_service = JimengService(api_key=k)

    k = settings_manager.get("vidu_api_key", "")
    if k:
        vidu_service = ViduService(api_key=k)

    deps.ai_service = ai_service
    deps.openai_service = openai_service
    deps.jimeng_service = jimeng_service
    deps.vidu_service = vidu_service
    deps.settings_manager = settings_manager

    # 游戏专用服务
    from game_video_service import GameJimengService
    game_gemini_keys = _get_setting_key_pool("game_gemini_api_keys", "game_gemini_api_key")
    if game_gemini_keys:
        gemini_proxy = f"{hk_proxy}/gemini" if hk_proxy else ""
        deps.game_ai_service = AIService(api_key=game_gemini_keys[0], api_keys=game_gemini_keys, proxy_base_url=gemini_proxy)
    gk = settings_manager.get("game_ark_api_key", "")
    if gk:
        deps.game_jimeng_service = GameJimengService(api_key=gk)
    gk = settings_manager.get("game_vidu_api_key", "")
    if gk:
        deps.game_vidu_service = ViduService(api_key=gk)


AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "true").lower() in ("true", "1", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_services()
    if AUTH_ENABLED:
        auth.init_auth_db()
    db.init_db()
    from image_tools_service import recover_interrupted_image_tool_tasks
    recover_interrupted_image_tool_tasks()
    await deps.init_http_client()
    await _cloud_sync.start()
    yield
    await _cloud_sync.stop()
    await deps.close_http_client()


_expose_api_docs = os.environ.get("EXPOSE_API_DOCS", "false").lower() in ("true", "1", "yes")


def _unique_operation_id(route) -> str:
    # FastAPI default operation_id is `{function_name}_{path}_{method}`
    # but it picks just one method when api_route() declares multiple,
    # so a single GET+HEAD endpoint gets reported twice with the same
    # id. We fold sorted methods plus the full path into the id so
    # every (function, path, methods) tuple stays unique even when two
    # routers happen to use the same function name (e.g. multiple
    # `upload_file` handlers on different paths).
    methods = "-".join(sorted(route.methods or [])) or "any"
    path = (route.path or "").replace("/", "_").replace("{", "").replace("}", "").strip("_")
    return f"{route.name}_{path}_{methods}"


app = FastAPI(
    title="游戏视频素材工具 API",
    lifespan=lifespan,
    docs_url="/docs" if _expose_api_docs else None,
    redoc_url="/redoc" if _expose_api_docs else None,
    openapi_url="/openapi.json" if _expose_api_docs else None,
    generate_unique_id_function=_unique_operation_id,
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

_cors_origins = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if os.environ.get("LOCAL_DEV_CORS", "1") == "1":
    _cors_origins.extend([
        "http://127.0.0.1:6180",
        "http://localhost:6180",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ])
    _cors_origins = list(dict.fromkeys(_cors_origins))
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/status", "/api/version", "/api/local-config", "/api/client-errors"}
PUBLIC_PREFIXES = ("/api/files/",)


def _apply_user_context(request: Request, payload: dict) -> None:
    request.state.user = payload
    deps.set_current_user(payload)
    user_id = payload.get("sub", "")
    if user_id:
        user_db_path = auth.get_user_db_path(user_id)
        db.set_db_path(user_db_path)
        user_files_dir = auth.get_user_files_dir(user_id)
        deps.set_files_dir(user_files_dir)
        request.state.user_db_path = user_db_path
        request.state.user_files_dir = user_files_dir


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        deps.set_current_user(None)
        if request.method == "OPTIONS":
            return await call_next(request)
        if not AUTH_ENABLED:
            request.state.user = None
            return await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in PUBLIC_PREFIXES):
            token = request.headers.get("Authorization", "").replace("Bearer ", "")
            if not token:
                token = request.query_params.get("token", "")
            if token:
                payload = auth.decode_token(token)
                if payload:
                    _apply_user_context(request, payload)
            return await call_next(request)
        if path in PUBLIC_PATHS:
            return await call_next(request)
        if not path.startswith("/api/"):
            return await call_next(request)
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if not token:
            token = request.query_params.get("token", "")
        if not token:
            return JSONResponse(status_code=401, content={"detail": "未登录，请先登录"})
        payload = auth.decode_token(token)
        if not payload:
            return JSONResponse(status_code=401, content={"detail": "登录已过期，请重新登录"})
        _apply_user_context(request, payload)
        return await call_next(request)


app.add_middleware(AuthMiddleware)


class _AutoSyncMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method in ("POST", "PUT", "DELETE"):
            path = request.url.path
            if path.startswith("/api/") and not path.startswith(("/api/sync/", "/api/auth/", "/api/settings", "/api/files/", "/health")):
                if 200 <= response.status_code < 300:
                    _cloud_sync.mark_db_dirty()
        return response

app.add_middleware(_AutoSyncMiddleware)


class PerformanceLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        started = time.perf_counter()
        response = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            status_code = getattr(response, "status_code", 500) if response is not None else 500
            threshold_ms = int(os.environ.get("SLOW_REQUEST_LOG_THRESHOLD_MS", "1200") or "1200")
            if request.url.path.startswith(("/api/", "/public-files/", "/health")) and should_log_performance(
                duration_ms,
                status_code,
                threshold_ms,
            ):
                logger.info(
                    format_perf_log(
                        request.method,
                        request.url.path,
                        status_code,
                        duration_ms,
                        threshold_ms,
                    )
                )


app.add_middleware(PerformanceLogMiddleware)

# ═══════════════════ 路由注册 ═══════════════════

from routers.auth_routes import router as auth_router
app.include_router(auth_router)

from routers.game_routes import router as game_router
app.include_router(game_router, prefix="/api/game", tags=["game"])

from routers.viral_routes import router as viral_router
app.include_router(viral_router, prefix="/api/viral", tags=["viral"])

from routers.image_tools_routes import router as image_tools_router
app.include_router(image_tools_router, prefix="/api/image-tools", tags=["image-tools"])

# ═══════════════════ 健康检查 & 设置 ═══════════════════

@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok"}


def _gemini_key_pool_snapshots() -> dict:
    pools: dict[str, dict] = {}
    seen: set[int] = set()

    def add(scope: str, svc) -> None:
        if not svc or id(svc) in seen or not hasattr(svc, "key_pool_snapshot"):
            return
        seen.add(id(svc))
        try:
            pools[scope] = svc.key_pool_snapshot(scope=scope)
        except Exception as exc:  # noqa: BLE001 - observability must not break health probes.
            pools[scope] = {"provider": "gemini", "scope": scope, "error": str(exc)}

    add("global", deps.ai_service)
    add("game_global", deps.game_ai_service)

    try:
        from routers import game_routes
        with game_routes._ai_service_cache_lock:
            for index, svc in enumerate(game_routes._ai_service_cache.values()):
                add(f"game_user_cache_{index}", svc)
    except Exception:
        logger.debug("Failed to collect game Gemini cache snapshot", exc_info=True)

    try:
        from routers import viral_routes
        with viral_routes._ai_service_cache_lock:
            for index, svc in enumerate(viral_routes._ai_service_cache.values()):
                add(f"viral_user_cache_{index}", svc)
    except Exception:
        logger.debug("Failed to collect viral Gemini cache snapshot", exc_info=True)

    return pools


@app.get("/ops/provider-queue")
async def get_provider_queue_snapshot(request: Request):
    if not is_local_observability_request(request):
        raise HTTPException(status_code=403, detail="local access only")
    snapshot = provider_queue_snapshot()
    snapshot["key_pools"] = _gemini_key_pool_snapshots()
    snapshot["status_queries"] = status_query_snapshot()
    return {
        "ok": True,
        "snapshot": snapshot,
    }


class SettingsUpdate(BaseModel):
    key: str
    value: str | int | float | bool | None


class ClientErrorReport(BaseModel):
    message: str = ""
    stack: str = ""
    component_stack: str = ""
    url: str = ""
    user_agent: str = ""
    username: str = ""
    user_id: str = ""


@app.post("/api/client-errors")
async def report_client_error(body: ClientErrorReport, request: Request):
    user = getattr(request.state, "user", None) or {}
    username = user.get("username", "") or body.username or user.get("sub", "") or body.user_id
    error_text = "\n".join(
        part for part in [
            f"message: {body.message[:1000]}",
            f"url: {body.url[:500]}",
            f"username: {body.username[:120]}",
            f"user_id: {body.user_id[:120]}",
            f"user_agent: {body.user_agent[:500]}",
            f"stack: {body.stack[:3000]}",
            f"component_stack: {body.component_stack[:3000]}",
        ] if part.strip()
    )
    logger.error("Client render error user=%s url=%s message=%s", username, body.url, body.message)
    try:
        await asyncio.to_thread(
            db.create_game_operation_event,
            project_id="",
            operation="frontend_render_error",
            provider="react",
            model="",
            status="failed",
            error=error_text,
        )
    except Exception:
        logger.exception("Failed to persist client render error")
    return {"ok": True}


async def content_chat_message(body: ContentChatRequest, request: Request):
    user = getattr(request.state, "user", None) or {}
    username = user.get("username", "") or user.get("sub", "")
    key = deps.get_group_api_key("openai_api_key")
    if not key:
        raise deps.missing_group_api_key_http("OpenAI API Key")
    proxy = deps.get_proxy_url()
    base_url = deps.get_group_api_key("openai_base_url")
    if proxy:
        base_url = f"{proxy}/openai/v1"
    elif not base_url:
        base_url = "https://open-api.mincode.cn/v1"
    svc = OpenAIService(api_key=key, base_url=base_url)
    system_prompt = (
        "你是游戏素材生产助手。请像原生对话窗口一样和用户连续协作，"
        "不要强制把需求固定成单一出图或视频任务。优先帮助用户完成游戏素材的多图方案、"
        "视频脚本、镜头拆解、投放文案、风格统一和迭代修改。输出要具体、可执行，"
        "如果用户上传参考图，要结合参考图给出修改建议或生成方案。"
    )
    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    for item in body.messages[-20:]:
        role = item.role if item.role in {"system", "user", "assistant"} else "user"
        content = (item.content or "").strip()
        if content:
            messages.append({"role": role, "content": content[:12000]})

    user_text = (body.message or "").strip()
    images = [img for img in (body.images or []) if isinstance(img, str) and img.startswith("data:image/")]
    if images:
        content_parts: list[dict] = []
        if user_text:
            content_parts.append({"type": "text", "text": user_text})
        else:
            content_parts.append({"type": "text", "text": "请分析这些参考图，并继续完成素材内容生成。"})
        for image_url in images[:8]:
            content_parts.append({"type": "image_url", "image_url": {"url": image_url, "detail": "high"}})
        messages.append({"role": "user", "content": content_parts})
    elif user_text:
        messages.append({"role": "user", "content": user_text})
    else:
        raise HTTPException(status_code=400, detail="请输入对话内容或上传参考图。")

    try:
        content = await svc.chat_messages(
            messages,
            model=body.model or "gpt-5.5",
            max_tokens=max(1024, min(int(body.max_tokens or 8192), 24000)),
            temperature=max(0.0, min(float(body.temperature or 0.7), 1.5)),
        )
        try:
            await asyncio.to_thread(
                db.create_game_operation_event,
                project_id="",
                operation="content_chat_message",
                provider="openai",
                model=body.model or "gpt-5.5",
                status="completed",
                error=f"user={username}" if username else "",
            )
        except Exception:
            logger.debug("Failed to persist content chat event", exc_info=True)
        return {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": content,
            "model": body.model or "gpt-5.5",
            "created_at": int(time.time()),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def content_chat_options():
    return {"ok": True}


@app.get("/api/settings")
async def get_settings(request: Request):
    deps.require_admin(request)
    return settings_manager.get_all()


@app.post("/api/settings")
async def update_setting(body: SettingsUpdate, request: Request):
    deps.require_admin(request)
    settings_manager.set(body.key, body.value)
    global ai_service, openai_service, jimeng_service, vidu_service
    v = str(body.value) if body.value else ""
    hk_proxy = _get_proxy_url()
    if body.key == "api_proxy_url":
        _init_services()
        return {"success": True}
    if body.key.startswith("group_api_"):
        _init_services()
        return {"success": True}
    if body.key in ("gemini_api_key", "gemini_api_keys", "game_gemini_api_key", "game_gemini_api_keys"):
        _init_services()
    elif body.key in ("openai_api_key", "openai_base_url"):
        ok = settings_manager.get("openai_api_key", "")
        ob = settings_manager.get("openai_base_url", "")
        if ok:
            if hk_proxy:
                ob = f"{hk_proxy}/openai/v1"
            elif not ob:
                ob = "https://open-api.mincode.cn/v1"
            openai_service = OpenAIService(api_key=ok, base_url=ob)
            deps.openai_service = openai_service
    elif body.key in ("ark_api_key", "jimeng_api_key") and v:
        jimeng_service = JimengService(api_key=v)
        deps.jimeng_service = jimeng_service
    elif body.key == "vidu_api_key" and v:
        vidu_service = ViduService(api_key=v)
        deps.vidu_service = vidu_service
    return {"success": True}


@app.api_route("/api/version", methods=["GET", "HEAD"])
async def get_version():
    return {"version": APP_VERSION, "build_date": APP_BUILD_DATE}


@app.get("/api/local-config")
async def get_local_config():
    cloud = settings_manager.get("cloud_url", "") or ""
    return {"version": APP_VERSION, "build_date": APP_BUILD_DATE, "cloud_url": cloud}


# ═══════════════════ 云端同步 ═══════════════════

@app.get("/api/sync/status")
async def sync_status():
    return _cloud_sync.status()


@app.post("/api/sync/force")
async def force_sync():
    return await _cloud_sync.force_sync_now()


class CloudLoginRequest(BaseModel):
    cloud_url: str
    username: str
    password: str


class SyncConfigureRequest(BaseModel):
    cloud_url: Optional[str] = None
    cloud_token: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    auto_sync_interval: Optional[int] = None


def _normalize_cloud_base(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    if not u:
        return ""
    if not (u.startswith("http://") or u.startswith("https://")):
        u = "http://" + u
    return u.rstrip("/")


@app.post("/api/sync/cloud-login")
async def cloud_login(body: CloudLoginRequest, request: Request):
    deps.require_admin(request)
    base = _normalize_cloud_base(body.cloud_url)
    if not base:
        return {"ok": False, "error": "请填写云服务器地址"}
    if not body.username or not body.password:
        return {"ok": False, "error": "请填写云端账号与密码"}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(
                f"{base}/api/auth/login",
                json={"username": body.username, "password": body.password},
                headers={"Content-Type": "application/json"},
            )
        if resp.status_code != 200:
            detail = ""
            try:
                j = resp.json() if resp.content else {}
                detail = j.get("detail", "") if isinstance(j, dict) else ""
            except Exception:
                detail = resp.text
            return {"ok": False, "error": f"云端登录失败（HTTP {resp.status_code}）{('：' + str(detail)) if detail else ''}"}
        data = resp.json() if resp.content else {}
        token = (data.get("token", "") if isinstance(data, dict) else "") or ""
        user = (data.get("user", {}) if isinstance(data, dict) else {}) or {}
        if not token:
            return {"ok": False, "error": "云端登录未返回 token"}
        return {"ok": True, "token": token, "user": user}
    except Exception as e:
        return {"ok": False, "error": f"云端登录请求失败：{str(e)[:200]}"}


@app.post("/api/sync/configure")
async def sync_configure(body: SyncConfigureRequest, request: Request):
    deps.require_admin(request)
    updates = body.dict(exclude_unset=True)
    # allow explicit empty string to clear config
    if "cloud_url" in updates:
        settings_manager.set("cloud_url", _normalize_cloud_base(updates.get("cloud_url") or ""))
    if "cloud_token" in updates:
        settings_manager.set("cloud_token", updates.get("cloud_token") or "")
    if "auto_sync_enabled" in updates:
        settings_manager.set("auto_sync_enabled", bool(updates.get("auto_sync_enabled")))
    if "auto_sync_interval" in updates:
        settings_manager.set("auto_sync_interval", int(updates.get("auto_sync_interval") or 3))
    _cloud_sync.mark_db_dirty()

    cloud_user = None
    cloud_url = (settings_manager.get("cloud_url", "") or "").rstrip("/")
    cloud_token = settings_manager.get("cloud_token", "") or ""
    if cloud_url and cloud_token:
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                me = await client.get(
                    f"{cloud_url}/api/auth/me",
                    headers={"Authorization": f"Bearer {cloud_token}"},
                )
            if me.status_code == 200:
                jd = me.json() if me.content else {}
                if isinstance(jd, dict):
                    cloud_user = jd.get("user")
        except Exception:
            cloud_user = None

    return {"ok": True, "user": cloud_user}


@app.post("/api/sync/push-file")
async def sync_push_file(request: Request, file: UploadFile = File(...)):
    """Cloud receiver: accept a generated media file and store it locally.

    Intended to be deployed on a separate \"cloud\" instance of this app.
    """
    deps.require_admin(request)
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    # keep original name when possible; avoid overwrite by suffixing
    target = FILES_DIR / Path(file.filename).name
    if target.exists():
        target = FILES_DIR / f"{target.stem}_{uuid.uuid4().hex[:6]}{target.suffix}"
    size = await deps.write_upload_to_path(file, target)
    return {"ok": True, "filename": target.name, "size": size}


@app.post("/api/sync/push-db")
async def sync_push_db(request: Request, file: UploadFile = File(...)):
    """Cloud receiver: accept a SQLite db snapshot and store it under USER_DATA_DIR/cloud-dbs/."""
    deps.require_admin(request)
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    db_dir = USER_DATA_DIR / "cloud-dbs"
    db_dir.mkdir(parents=True, exist_ok=True)
    name = Path(file.filename).name
    target = db_dir / name
    if target.exists():
        target = db_dir / f"{target.stem}_{uuid.uuid4().hex[:6]}{target.suffix}"
    size = await deps.write_upload_to_path(file, target)
    return {"ok": True, "filename": target.name, "size": size}


# ═══════════════════ 文件上传 & 服务 ═══════════════════

USER_DATA_DIR = Path(os.environ.get("USER_DATA_DIR", Path.home() / ".game-video-tool"))
FILES_DIR = USER_DATA_DIR / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/files/upload")
async def upload_file(file: UploadFile = File(...), category: str = Form("files")):
    ext = Path(file.filename).suffix if file.filename else ""
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = deps.get_files_dir() / filename
    size = await deps.write_upload_to_path(file, filepath)
    deps.notify_media_file_saved(filepath)
    url = f"/api/files/{filename}"
    return {"filename": filename, "url": url, "path": str(filepath), "size": size}


@app.api_route("/api/files/{filename}", methods=["GET", "HEAD"])
async def serve_file(filename: str):
    filename = Path(filename).name
    filepath = deps.find_local_file_path(filename)
    if not filepath or not filepath.exists():
        raise HTTPException(404, "文件不存在")
    media_types = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg",
        ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
    }
    ext = filepath.suffix.lower()
    return FileResponse(
        filepath,
        media_type=media_types.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*"},
    )


@app.api_route("/public-files/{filename}", methods=["GET", "HEAD"])
async def serve_public_file(filename: str, request: Request):
    filename = Path(filename).name
    expires = request.query_params.get("expires", "")
    sig = request.query_params.get("sig", "")
    if not deps.verify_signed_public_file(filename, expires, sig):
        raise HTTPException(401, "公开文件签名无效或已过期")

    filepath = deps.find_local_file_path(filename, include_all_user_dirs=True)
    if not filepath or not filepath.exists():
        raise HTTPException(404, "文件不存在")

    media_types = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg",
        ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
        ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    }
    ext = filepath.suffix.lower()
    return FileResponse(
        filepath,
        media_type=media_types.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*"},
    )


# ═══════════════════ 静态文件服务 ═══════════════════

def mount_static():
    ui_dist = os.environ.get("UI_DIST_DIR", "")
    if not ui_dist:
        candidates = [
            Path(__file__).parent / "static",
            Path(__file__).parent.parent / "react-ui" / "dist",
        ]
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            candidates.insert(0, Path(meipass) / "static")
        for c in candidates:
            if c.exists() and (c / "index.html").exists():
                ui_dist = str(c)
                break
    if ui_dist and Path(ui_dist).exists():
        from starlette.responses import FileResponse as _FR

        class StaticCacheMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                raw_path = request.scope.get("raw_path") or b""
                path = request.url.path
                if raw_path.startswith(b"/%23") or path.startswith("/%23") or path.startswith("/#"):
                    raw_text = raw_path.decode("latin-1", errors="ignore") if raw_path else path
                    suffix = raw_text[4:] if raw_text.startswith("/%23") else path[2:]
                    target = f"/#{suffix or '/'}"
                    return RedirectResponse(url=target, status_code=307)

                response = await call_next(request)
                if path == "/" or path.endswith(".html"):
                    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                elif path.startswith("/assets/") or path in ("/favicon.svg", "/icons.svg"):
                    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                return response

        app.add_middleware(StaticCacheMiddleware)

        @app.get("/")
        async def serve_index():
            idx = Path(ui_dist) / "index.html"
            return _FR(idx, media_type="text/html", headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
            })

        app.mount("/", StaticFiles(directory=ui_dist, html=True), name="static")
    else:
        @app.get("/")
        async def root():
            return {"message": "游戏视频素材工具 API 运行中，前端未构建。"}

mount_static()


def _kill_existing_on_port(port: int):
    import subprocess, signal as _sig
    try:
        if os.name == "nt":
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True, stderr=subprocess.DEVNULL)
            for line in out.strip().split("\n"):
                parts = line.split()
                if parts and parts[-1].isdigit():
                    pid = int(parts[-1])
                    if pid != os.getpid():
                        os.kill(pid, _sig.SIGTERM)
        else:
            out = subprocess.check_output(["lsof", "-ti", f":{port}"], text=True, stderr=subprocess.DEVNULL).strip()
            for pid_str in out.split("\n"):
                if pid_str.isdigit() and int(pid_str) != os.getpid():
                    os.kill(int(pid_str), _sig.SIGTERM)
    except Exception:
        pass


def _start_server(host: str, port: int):
    uvicorn.run(app, host=host, port=port, log_level="info")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=57991)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--desktop", action="store_true")
    parser.add_argument("--sidecar", action="store_true")
    args = parser.parse_args()

    if args.sidecar:
        import threading, time
        _kill_existing_on_port(args.port)
        server_thread = threading.Thread(target=_start_server, args=(args.host, args.port), daemon=True)
        server_thread.start()
        url = f"http://{args.host}:{args.port}"
        for _ in range(120):
            try:
                import urllib.request
                urllib.request.urlopen(url + "/health", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        print("READY", flush=True)
        server_thread.join()
    elif args.desktop:
        import threading, time
        server_thread = threading.Thread(target=_start_server, args=(args.host, args.port), daemon=True)
        server_thread.start()
        url = f"http://{args.host}:{args.port}"
        for _ in range(60):
            try:
                import urllib.request
                urllib.request.urlopen(url + "/health", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        try:
            import webview
            webview.create_window("游戏视频素材工具", url, width=1280, height=860, min_size=(900, 600), text_select=True)
            webview.start()
        except Exception:
            import webbrowser
            webbrowser.open(url)
            server_thread.join()
    else:
        print(f"游戏视频素材工具启动: {args.host}:{args.port}")
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
