from __future__ import annotations


SEEDANCE_20_MODEL_ALIASES = {
    "seedance-2.0-first-frame",
    "seedance-2.0-fast",
    "seedance-2.0-mini",
}


def normalize_video_model_id(model: str) -> str:
    model_id = str(model or "").strip()
    return "seedance-2.0" if model_id in SEEDANCE_20_MODEL_ALIASES else model_id


def get_all_video_model_specs() -> list[dict]:
    """Return the full known model catalog, independent of configured API keys."""
    return [
        {"id": "seedance-2.0", "name": "Seedance 2.0", "provider": "jimeng",
         "supports_ref_video": True, "supports_ref_images": True, "min_duration": 4, "max_duration": 15,
         "max_ref_images": 9, "max_ref_videos": 3, "ref_video_duration_limit": 15.2,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "生成时长 4-15 秒；支持 720P/1080P；参考视频/高级视频编辑参考视频需 15.2 秒以内",
         "supported_modes": ["generate", "reference_video", "advanced_video", "motion_transfer"],
         "price_per_second": 1.0, "price_unit": "CNY", "price_resolution_multiplier_1080p": 2.25,
         "price_note": "官方按输出视频像素、帧率、时长折算 token 计费；1080P 约为 720P 的 2.25 倍"},
        {"id": "seedance-1.5-pro", "name": "Seedance 1.5 Pro", "provider": "jimeng",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 4, "max_duration": 12,
         "max_ref_images": 2,
         "supported_resolutions": ["720p"], "default_resolution": "720p",
         "limit_note": "生成时长 4-12 秒；支持 1 张首帧图或 2 张首尾帧图；不支持参考视频/普通多参考图；当前仅开放 720P",
         "supported_modes": ["generate"],
         "price_per_second": 0.3, "price_unit": "CNY"},
        {"id": "seedance-1.0-pro-fast", "name": "seedance-1.0-pro-fast", "provider": "jimeng",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 4, "max_duration": 10,
         "max_ref_images": 1,
         "supported_resolutions": ["720p"], "default_resolution": "720p",
         "limit_note": "seedance-1.0-pro-fast: 4-10s, 720P, supports one first-frame image.",
         "supported_modes": ["generate"],
         "price_per_second": 0.4, "price_unit": "CNY"},
        {"id": "viduq3-pro", "name": "VIDU Q3 Pro", "provider": "vidu",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 1, "max_duration": 16,
         "max_ref_images": 1,
         "supported_resolutions": ["720p"], "default_resolution": "720p",
         "supported_modes": ["generate"],
         "price_per_second": 0.95, "price_unit": "CNY"},
        {"id": "viduq3-turbo", "name": "VIDU Q3 Turbo", "provider": "vidu",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 1, "max_duration": 16,
         "max_ref_images": 1,
         "supported_resolutions": ["720p"], "default_resolution": "720p",
         "supported_modes": ["generate"],
         "price_per_second": 0.45, "price_unit": "CNY"},
        {"id": "happyhorse-1.0-t2v", "name": "HappyHorse 1.0 文生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": False, "min_duration": 3, "max_duration": 15,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "生成时长 3-15 秒；不需要参考图/参考视频",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "官方价格：720P 0.9元/秒，1080P 1.6元/秒"},
        {"id": "happyhorse-1.1-t2v", "name": "HappyHorse 1.1 文生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": False, "min_duration": 3, "max_duration": 15,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "HappyHorse 1.1: text-to-video, 3-15s, 720P/1080P.",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "Pricing currently follows HappyHorse 1.0 estimate until official 1.1 billing is configured."},
        {"id": "happyhorse-1.0-i2v", "name": "HappyHorse 1.0 首帧图生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 3, "max_duration": 15,
         "min_ref_images": 1, "max_ref_images": 1,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "生成时长 3-15 秒；必须且只能使用 1 张首帧参考图；不支持参考视频",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "官方价格：720P 0.9元/秒，1080P 1.6元/秒"},
        {"id": "happyhorse-1.1-i2v", "name": "HappyHorse 1.1 首帧图生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 3, "max_duration": 15,
         "min_ref_images": 1, "max_ref_images": 1,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "HappyHorse 1.1: first-frame image-to-video, requires exactly one image, 3-15s.",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "Pricing currently follows HappyHorse 1.0 estimate until official 1.1 billing is configured."},
        {"id": "happyhorse-1.0-r2v", "name": "HappyHorse 1.0 参考图生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 3, "max_duration": 15,
         "min_ref_images": 1, "max_ref_images": 9,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "生成时长 3-15 秒；支持 1-9 张角色/场景参考图；不支持参考视频",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "官方价格：720P 0.9元/秒，1080P 1.6元/秒"},
        {"id": "happyhorse-1.1-r2v", "name": "HappyHorse 1.1 参考图生视频", "provider": "happyhorse",
         "supports_ref_video": False, "supports_ref_images": True, "min_duration": 3, "max_duration": 15,
         "min_ref_images": 1, "max_ref_images": 9,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "HappyHorse 1.1: reference-image-to-video, supports 1-9 reference images, 3-15s.",
         "supported_modes": ["generate"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_note": "Pricing currently follows HappyHorse 1.0 estimate until official 1.1 billing is configured."},
        {"id": "happyhorse-1.0-video-edit", "name": "HappyHorse 1.0 视频编辑", "provider": "happyhorse",
         "supports_ref_video": True, "supports_ref_images": True, "min_duration": 3, "max_duration": 15,
         "max_ref_images": 5, "max_ref_videos": 1, "ref_video_duration_min": 3, "ref_video_duration_limit": 60,
         "supported_resolutions": ["720p", "1080p"], "default_resolution": "720p",
         "limit_note": "输出视频最长 15 秒；输入参考视频需 3-60 秒；最多 1 个参考视频，可叠加 0-5 张参考图",
         "supported_modes": ["reference_video", "advanced_video"],
         "price_per_second": 0.9, "price_unit": "CNY",
         "price_per_second_1080p": 1.6, "price_billing": "input_output",
         "price_note": "官方价格：720P 0.9元/秒，1080P 1.6元/秒；视频编辑按输入视频与输出视频分别计费"},
    ]


def get_video_model_spec(model: str) -> dict:
    model_id = normalize_video_model_id(model)
    return next((item for item in get_all_video_model_specs() if item.get("id") == model_id), {})


def get_video_model_specs(provider_filter=None) -> list[dict]:
    """Return catalog specs, optionally filtered to configured providers."""
    hidden_ids = SEEDANCE_20_MODEL_ALIASES
    if provider_filter is None:
        return [item for item in get_all_video_model_specs() if item.get("id") not in hidden_ids]
    providers = {provider for provider in provider_filter if provider}
    return [
        item for item in get_all_video_model_specs()
        if item.get("provider") in providers and item.get("id") not in hidden_ids
    ]
