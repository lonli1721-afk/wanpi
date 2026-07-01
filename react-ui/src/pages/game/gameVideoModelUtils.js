import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} from './gameVideoConstants.js'

export const VIDEO_GENERATION_MODE_OPTIONS = [
  { id: 'generate', label: '标准生成' },
  { id: 'reference_video', label: '参考视频生成' },
  { id: 'advanced_video', label: '高级视频编辑' },
]

const RENDERABLE_VIDEO_MODE_IDS = VIDEO_GENERATION_MODE_OPTIONS.map(item => item.id)

export const VIDEO_REPLACE_PROVIDER_SPECS = [
  {
    id: 'wan',
    label: '万相视频换人',
    desc: '专用换主角，保留场景光照',
    providerLabel: '万相',
    uploadHint: '支持 mp4、mov、avi；万相要求 2-30 秒',
    actionLabel: '开始视频换人',
    infoText: '使用阿里云万相 wan2.2-animate-mix 专用视频换人能力。适合把原视频主角替换为上传角色，并尽量保持原视频的动作、表情、场景、光照和色调。',
    ref_video_duration_min: 2,
    ref_video_duration_limit: 30,
    supports_prompt: false,
    supports_resolution: false,
    supports_check_image: true,
    wan_modes: [
      { id: 'wan-std', label: '标准', desc: '更快' },
      { id: 'wan-pro', label: '专业', desc: '更稳' },
    ],
  },
  {
    id: 'jimeng',
    label: 'Seedance 动作模仿',
    desc: '迁移动作和运镜，支持提示词',
    providerLabel: 'Seedance',
    uploadHint: '支持 mp4、mov；Seedance 建议 15.2 秒以内',
    actionLabel: '开始动作模仿',
    infoText: '使用 Seedance 2.0 动作模仿能力。适合让上传角色参考原视频的动作、表情和运镜，并可用提示词进一步改写风格或内容。',
    ref_video_duration_limit: 15.2,
    supports_prompt: true,
    supports_resolution: true,
    supported_resolutions: ['720p', '1080p'],
    default_resolution: '720p',
  },
]

export function getReplaceProviderSpec(provider) {
  return VIDEO_REPLACE_PROVIDER_SPECS.find(item => item.id === provider) || VIDEO_REPLACE_PROVIDER_SPECS[0]
}

export function getImageAspectOption(aspectRatio) {
  return IMAGE_ASPECT_OPTIONS.find(item => item.id === aspectRatio) || IMAGE_ASPECT_OPTIONS[0]
}

export function normalizeImageAspectRatio(value) {
  return IMAGE_ASPECT_OPTIONS.some(item => item.id === value) ? value : DEFAULT_IMAGE_ASPECT_RATIO
}

export function imageAspectStyleValue(aspectRatio) {
  const option = getImageAspectOption(aspectRatio)
  return `${option.width} / ${option.height}`
}

export function getImageQualityIds(model) {
  const fromSpec = Array.isArray(model?.supported_qualities)
    ? model.supported_qualities.filter(item => IMAGE_QUALITY_OPTIONS.some(option => option.id === item))
    : []
  return fromSpec.length ? fromSpec : ['2K']
}

export function normalizeImageQualityForModel(value, model) {
  const ids = getImageQualityIds(model)
  if (ids.includes(value)) return value
  if (model?.default_quality && ids.includes(model.default_quality)) return model.default_quality
  return ids[0] || '2K'
}

export function cleanImageModelLabel(name) {
  return String(name || '')
    .replace(/楂樿川閲\?/g, '高质量')
    .replace(/楂樿川閲?/g, '高质量')
}

export function getImageRefBlockReason(model, refCount, editMode) {
  if (!refCount) return ''
  if (model?.supports_ref_images === false) return `${cleanImageModelLabel(model.name)} 不支持参考图，请切换 Seedream 4.5/5.0。`
  const maxRefs = Number(model?.max_ref_images || 0)
  if (maxRefs > 0 && refCount > maxRefs) return `${cleanImageModelLabel(model.name)} 最多支持 ${maxRefs} 张参考图，请减少后重试。`
  return ''
}

export function getModelResolutionIds(model) {
  const fromSpec = Array.isArray(model?.supported_resolutions)
    ? model.supported_resolutions.filter(item => VIDEO_RESOLUTION_OPTIONS.some(option => option.id === item))
    : []
  return fromSpec.length ? fromSpec : ['720p']
}

export function normalizeVideoResolutionForModel(value, model) {
  const ids = getModelResolutionIds(model)
  if (ids.includes(value)) return value
  if (model?.default_resolution && ids.includes(model.default_resolution)) return model.default_resolution
  return ids[0] || '720p'
}

export function getVideoPricePerSecond(model, scene) {
  const groupOverride = getVideoPriceOverrideForApiGroup(scene?.apiUsageGroup)
  if (groupOverride) return groupOverride
  const base = Number(model?.price_per_second || 0)
  if (!base) return 0
  if (scene?.videoResolution === '1080p') {
    if (model?.price_per_second_1080p) return Number(model.price_per_second_1080p)
    if (model?.price_resolution_multiplier_1080p) return base * Number(model.price_resolution_multiplier_1080p)
  }
  return base
}

export const VIDEO_PRICE_OVERRIDES_BY_API_GROUP = {
  fa1_project2: 1.65,
}

export function getVideoPriceOverrideForApiGroup(apiGroupId) {
  const price = Number(VIDEO_PRICE_OVERRIDES_BY_API_GROUP[String(apiGroupId || '').trim()] || 0)
  return price > 0 ? price : 0
}

export function getVideoModelName(model) {
  return model?.name || '当前模型'
}

export function getSupportedVideoModeIds(model) {
  const modes = Array.isArray(model?.supported_modes) ? model.supported_modes : []
  const renderable = modes.filter(mode => RENDERABLE_VIDEO_MODE_IDS.includes(mode))
  return renderable.length ? renderable : ['generate']
}

export function isVideoModeSupported(model, mode) {
  return getSupportedVideoModeIds(model).includes(mode)
}

export function normalizeVideoModeForModel(mode, model) {
  if (isVideoModeSupported(model, mode)) return mode
  return getSupportedVideoModeIds(model)[0] || 'generate'
}

export function getVideoModeLabel(mode) {
  return VIDEO_GENERATION_MODE_OPTIONS.find(item => item.id === mode)?.label || mode
}

export function getVideoModeBlockReason(model, mode) {
  if (isVideoModeSupported(model, mode)) return ''
  return `${getVideoModelName(model)} 不支持${getVideoModeLabel(mode)}`
}

export function getVideoMaxReferenceVideos(model) {
  const max = Number(model?.max_ref_videos || 0)
  return max > 0 ? max : 0
}

export function getVideoReferenceDurationLimits(model) {
  const min = Number(model?.ref_video_duration_min || 0)
  const max = Number(model?.ref_video_duration_limit || 0)
  return {
    minSeconds: min > 0 ? min : null,
    maxSeconds: max > 0 ? max : null,
  }
}

export function getVideoReferenceProviderLabel(model) {
  const name = getVideoModelName(model)
  if (name.includes('HappyHorse')) return 'HappyHorse'
  if (name.includes('Seedance')) return 'Seedance'
  if (name.includes('VIDU')) return 'VIDU'
  return name
}

function defaultNormalizeDurationSeconds(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function defaultFormatDurationSeconds(value) {
  const n = defaultNormalizeDurationSeconds(value)
  return n == null ? '' : `${Number.isInteger(n) ? n : Number(n.toFixed(1))} 秒`
}

export function getVideoReferenceDurationIssue(durationSeconds, model, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
} = {}) {
  const duration = normalizeDurationSeconds(durationSeconds)
  const { minSeconds, maxSeconds } = getVideoReferenceDurationLimits(model)
  if (duration == null) {
    if (minSeconds != null || maxSeconds != null) {
      return '参考视频真实时长暂未检测完成，请稍后再试或重新上传视频'
    }
    return ''
  }
  const label = getVideoReferenceProviderLabel(model)
  if (minSeconds != null && duration < minSeconds) {
    return `参考视频真实时长 ${formatDurationSeconds(duration)}，低于 ${label} ${minSeconds} 秒下限，请换一段更长的视频`
  }
  if (maxSeconds != null && duration > maxSeconds) {
    return `参考视频真实时长 ${formatDurationSeconds(duration)}，已超过 ${label} ${maxSeconds} 秒限制，请先裁剪后重试`
  }
  return ''
}

export function getVideoReferenceDurationHint(durationSeconds, model, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
  label = '参考视频',
} = {}) {
  const duration = normalizeDurationSeconds(durationSeconds)
  if (duration == null) return ''
  const issue = getVideoReferenceDurationIssue(duration, model, { normalizeDurationSeconds, formatDurationSeconds })
  if (issue) return issue.replace('参考视频真实时长', `${label}真实时长`)
  return `检测到真实时长 ${formatDurationSeconds(duration)}。若后续仍提示过长，通常是源文件容器元数据或尾帧导致，建议重新裁剪并重新编码导出。`
}

export function getReplaceReferenceDurationLimits(provider) {
  const spec = getReplaceProviderSpec(provider)
  const min = Number(spec.ref_video_duration_min || 0)
  const max = Number(spec.ref_video_duration_limit || 0)
  return {
    minSeconds: min > 0 ? min : null,
    maxSeconds: max > 0 ? max : null,
  }
}

export function getReplaceReferenceDurationIssue(durationSeconds, provider, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
} = {}) {
  const duration = normalizeDurationSeconds(durationSeconds)
  const spec = getReplaceProviderSpec(provider)
  const { minSeconds, maxSeconds } = getReplaceReferenceDurationLimits(provider)
  if (duration == null) {
    if (minSeconds != null || maxSeconds != null) {
      return `${spec.providerLabel}参考视频真实时长暂未检测完成，请稍后再试或重新上传视频`
    }
    return ''
  }
  if (minSeconds != null && duration < minSeconds) {
    return `参考视频真实时长 ${formatDurationSeconds(duration)}，低于 ${spec.providerLabel} ${minSeconds} 秒下限，请换一段更长的视频`
  }
  if (maxSeconds != null && duration > maxSeconds) {
    return `参考视频真实时长 ${formatDurationSeconds(duration)}，已超过 ${spec.providerLabel} ${maxSeconds} 秒限制，请先裁剪后重试`
  }
  return ''
}

export function getReplaceReferenceDurationHint(durationSeconds, provider, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
  label = '参考视频',
} = {}) {
  const duration = normalizeDurationSeconds(durationSeconds)
  if (duration == null) return ''
  const issue = getReplaceReferenceDurationIssue(duration, provider, { normalizeDurationSeconds, formatDurationSeconds })
  if (issue) return issue.replace('参考视频真实时长', `${label}真实时长`)
  return `检测到真实时长 ${formatDurationSeconds(duration)}。若后续仍提示过长，通常是源文件容器元数据或尾帧导致，建议重新裁剪并重新编码导出。`
}

export function getReplaceVideoBlockReason(provider, {
  charImage,
  refVideo,
  refVideoDurationSeconds,
} = {}, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
} = {}) {
  if (!charImage) return '请先上传替换角色图片'
  if (!refVideo) return '请先上传参考视频'
  return getReplaceReferenceDurationIssue(refVideoDurationSeconds, provider, {
    normalizeDurationSeconds,
    formatDurationSeconds,
  })
}

export function getVideoGenerationBlockReasonForModel(model, scene, {
  normalizeDurationSeconds = defaultNormalizeDurationSeconds,
  formatDurationSeconds = defaultFormatDurationSeconds,
} = {}) {
  if (!scene || !String(scene.prompt || '').trim()) return '请输入该场景的提示词'
  if (!model) return '请选择视频模型'

  const mode = scene.videoMode || 'generate'
  const modeReason = getVideoModeBlockReason(model, mode)
  if (modeReason) return `${modeReason}，请切换合适的模型或生成模式`

  const duration = Number(scene.duration)
  if (!Number.isFinite(duration)) return '视频时长必须是数字'
  const minDuration = Number(model.min_duration || 0)
  const maxDuration = Number(model.max_duration || 0)
  if ((minDuration && duration < minDuration) || (maxDuration && duration > maxDuration)) {
    return `${getVideoModelName(model)} 生成时长需为 ${minDuration || 1}-${maxDuration || minDuration} 秒，请调整后重试`
  }

  const resolutionIds = getModelResolutionIds(model)
  if (scene.videoResolution && !resolutionIds.includes(scene.videoResolution)) {
    return `${getVideoModelName(model)} 不支持 ${String(scene.videoResolution).toUpperCase()} 清晰度，请选择 ${resolutionIds.map(item => item.toUpperCase()).join('/')}`
  }

  const refImageCount = (scene.charImages?.length || 0) + (scene.sceneImages?.length || 0)
  if (refImageCount > 0 && model.supports_ref_images === false) {
    return `${getVideoModelName(model)} 不支持参考图，请移除参考图或切换模型`
  }
  const minRefImages = Number(model.min_ref_images || 0)
  if (minRefImages > 0 && refImageCount < minRefImages) {
    return `${getVideoModelName(model)} 需要至少 ${minRefImages} 张参考图`
  }
  const maxRefImages = Number(model.max_ref_images || 0)
  if (maxRefImages > 0 && refImageCount > maxRefImages) {
    return `${getVideoModelName(model)} 最多支持 ${maxRefImages} 张参考图，请减少后重试`
  }

  const refVideoCount = mode === 'reference_video'
    ? (scene.refVideoUrl ? 1 : 0)
    : mode === 'advanced_video'
      ? (scene.advancedRefVideos?.length || 0)
      : 0
  if (refVideoCount > 0 && model.supports_ref_video === false) {
    return `${getVideoModelName(model)} 不支持参考视频，请移除参考视频或切换模型`
  }

  if (mode === 'reference_video') {
    if (!scene.refVideoUrl) return '请先上传参考视频'
    const issue = getVideoReferenceDurationIssue(scene.refVideoDurationSeconds, model, { normalizeDurationSeconds, formatDurationSeconds })
    if (issue) return issue
  }

  if (mode === 'advanced_video') {
    const videos = scene.advancedRefVideos || []
    if (!videos.length) return '请至少上传 1 个参考视频'
    const maxRefVideos = getVideoMaxReferenceVideos(model)
    if (maxRefVideos > 0 && videos.length > maxRefVideos) return `当前模型最多支持 ${maxRefVideos} 个参考视频`
    const invalidVideo = videos.find(video => getVideoReferenceDurationIssue(video.durationSeconds, model, { normalizeDurationSeconds, formatDurationSeconds }))
    if (invalidVideo) {
      return getVideoReferenceDurationIssue(invalidVideo.durationSeconds, model, { normalizeDurationSeconds, formatDurationSeconds })
    }
  }

  return ''
}
