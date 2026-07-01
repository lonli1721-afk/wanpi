from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, File, Request, UploadFile

import database as db
import deps
from image_tools_service import (
    DeriveRequest,
    GenerateRolesRequest,
    GenerateNineRequest,
    ImageToolTaskRequest,
    MultimodalAnalysisRequest,
    PromptPolishRequest,
    ReversePromptsRequest,
    ReverseStylePromptRequest,
    RoleSuggestionRequest,
    SplitGridRequest,
    WatermarkRequest,
    apply_watermark_batch,
    cancel_image_tool_task,
    create_image_tool_task,
    delete_image_tool_task,
    derive_image_batch,
    generate_nine_images,
    generate_role_images,
    get_image_tool_task,
    list_image_tool_tasks,
    list_multimodal_analysis_models,
    list_watermark_fonts,
    multimodal_analysis,
    polish_generation_prompt,
    prepare_derive_request,
    prepare_generate_nine_request,
    prepare_generate_roles_request,
    prepare_reverse_request,
    prepare_split_grid_request,
    prepare_watermark_request,
    reverse_prompt_batch,
    reverse_style_prompt,
    suggest_role_items,
    save_watermark_font_upload,
    split_grid_batch,
)
from image_tools_service import _read_image_bytes  # re-exported for focused safety tests

logger = logging.getLogger("image-tools")


router = APIRouter()


@router.get("/permissions")
async def image_tool_permissions(request: Request):
    user = getattr(request.state, "user", None) or deps.get_current_user()
    role = (user or {}).get("role", "")
    username = (user or {}).get("username", "")
    return {
        "enabled": True,
        "can_use": True,
        "is_admin": role == "admin",
        "role": role,
        "username": username,
    }


async def _record_image_tool_event(
    operation: str,
    *,
    provider: str = "",
    model: str = "",
    task_id: str = "",
    status: str = "success",
    error: str = "",
) -> None:
    try:
        await asyncio.to_thread(
            db.create_game_operation_event,
            operation=operation,
            provider=provider,
            model=model,
            task_id=task_id,
            status=status,
            error=error,
        )
    except Exception:
        logger.exception("Failed to record image toolbox event: %s", operation)


async def _with_image_tool_event(operation: str, provider: str, model: str, func):
    try:
        result = await func()
        await _record_image_tool_event(operation, provider=provider, model=model)
        return result
    except Exception as exc:
        await _record_image_tool_event(
            operation,
            provider=provider,
            model=model,
            status="failed",
            error=str(exc),
        )
        raise


@router.post("/watermark")
async def watermark(req: WatermarkRequest):
    prepared = prepare_watermark_request(req)

    async def _do():
        return await _with_image_tool_event(
            "image_output_watermark",
            "local",
            "watermark",
            lambda: apply_watermark_batch(prepared),
        )

    return deps.keepalive_response(_do)


@router.post("/split-grid")
async def split_grid(req: SplitGridRequest):
    prepared = prepare_split_grid_request(req)

    async def _do():
        return await split_grid_batch(prepared)

    return deps.keepalive_response(_do)


@router.post("/fonts/upload")
async def upload_font(file: UploadFile = File(...)):
    return await save_watermark_font_upload(file)


@router.get("/fonts")
async def list_fonts(preview_text: str = "火锅消除小游戏"):
    return await asyncio.to_thread(list_watermark_fonts, preview_text)


@router.post("/generate-nine")
async def generate_nine(req: GenerateNineRequest):
    prepared = prepare_generate_nine_request(req)

    async def _do():
        return await _with_image_tool_event(
            "image_generate_nine",
            prepared.provider,
            prepared.model,
            lambda: generate_nine_images(prepared),
        )

    return deps.keepalive_response(_do)


@router.post("/generate-roles")
async def generate_roles(req: GenerateRolesRequest):
    prepared = prepare_generate_roles_request(req)

    async def _do():
        return await _with_image_tool_event(
            "image_generate_roles",
            prepared.provider,
            prepared.model,
            lambda: generate_role_images(prepared),
        )

    return deps.keepalive_response(_do)


@router.post("/tasks")
async def create_task(req: ImageToolTaskRequest):
    task = await create_image_tool_task(req)
    operation = "image_tool_task_submit"
    if task.get("type") == "watermark":
        operation = "image_output_submit"
    elif task.get("type") == "reverse_prompts":
        operation = "image_reverse_submit"
    elif task.get("type") == "generate_roles":
        operation = "image_generate_roles_submit"
    elif task.get("type") == "generate_nine":
        operation = "image_generate_nine_submit"
    elif task.get("type") == "derive":
        operation = "image_derive_submit"
    await _record_image_tool_event(
        operation,
        provider=task.get("provider", ""),
        model=task.get("model", ""),
        task_id=task.get("id", ""),
    )
    return task


@router.get("/tasks")
async def list_tasks(limit: int = 50, status: str = ""):
    return await list_image_tool_tasks(limit=limit, status=status)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    return await get_image_tool_task(task_id)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    return await cancel_image_tool_task(task_id)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    return await delete_image_tool_task(task_id)


@router.post("/reverse-style")
async def reverse_style(req: ReverseStylePromptRequest):
    async def _do():
        return await _with_image_tool_event(
            "image_reverse_style_prompt",
            "gemini",
            req.model,
            lambda: reverse_style_prompt(req),
        )

    return deps.keepalive_response(_do)


@router.post("/prompt-polish")
async def prompt_polish(req: PromptPolishRequest):
    async def _do():
        return await _with_image_tool_event(
            "image_prompt_polish",
            "gemini",
            req.model,
            lambda: polish_generation_prompt(req),
        )

    return deps.keepalive_response(_do)


@router.post("/role-suggestions")
async def role_suggestions(req: RoleSuggestionRequest):
    async def _do():
        return await _with_image_tool_event(
            "image_role_suggestions",
            "gemini",
            req.model,
            lambda: suggest_role_items(req),
        )

    return deps.keepalive_response(_do)


@router.post("/derive")
async def derive(req: DeriveRequest):
    prepared = prepare_derive_request(req)

    async def _do():
        return await _with_image_tool_event(
            "image_derive",
            prepared.provider,
            prepared.model,
            lambda: derive_image_batch(prepared),
        )

    return deps.keepalive_response(_do)


@router.post("/reverse-prompts")
async def reverse_prompts(req: ReversePromptsRequest):
    prepared = prepare_reverse_request(req)
    provider = "openai" if deps.is_openai_model(prepared.model) else "gemini"

    async def _do():
        return await _with_image_tool_event(
            "image_reverse_prompts",
            provider,
            prepared.model,
            lambda: reverse_prompt_batch(prepared),
        )

    return deps.keepalive_response(_do)


@router.get("/multimodal-analysis/models")
async def multimodal_analysis_models():
    return list_multimodal_analysis_models()


@router.post("/multimodal-analysis")
async def analyze_multimodal(req: MultimodalAnalysisRequest):
    async def _do():
        return await _with_image_tool_event(
            "multimodal_analysis",
            "ark",
            req.model,
            lambda: multimodal_analysis(req),
        )

    return deps.keepalive_response(_do)
