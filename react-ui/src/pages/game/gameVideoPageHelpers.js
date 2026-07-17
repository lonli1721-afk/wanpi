const BASE = import.meta.env?.VITE_API_URL || ''

const uid = () => Math.random().toString(36).slice(2, 10)

function appendAuthToken(url) {
  if (!url || /^(data:|blob:)/i.test(url)) return url
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : ''
  if (!token) return url
  if (!/\/api\/files\//.test(url)) return url
  if (/[?&]token=/.test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

export function mediaUrl(path) {
  if (typeof path !== 'string' || !path) return ''
  if (/^(data:|blob:)/i.test(path)) return path
  if (/^https?:/i.test(path)) return appendAuthToken(path)
  return appendAuthToken(`${BASE}${path}`)
}

export const PROVIDER_VIDEO_CACHE_ERROR_PREFIX = '视频任务已完成，但结果视频保存到本地失败'
export const PROVIDER_VIDEO_CACHE_RETRY_HINT = '可先点击“重新拉取结果”。'

export function isProviderVideoCacheError(error) {
  return typeof error === 'string' && error.includes(PROVIDER_VIDEO_CACHE_ERROR_PREFIX)
}

export function formatProviderVideoCacheError(error) {
  if (!isProviderVideoCacheError(error)) return typeof error === 'string' ? error : ''
  let text = error.replace(/请重新生成。?/g, '').trim()
  if (text.includes(PROVIDER_VIDEO_CACHE_RETRY_HINT)) return text
  if (!/[。！？）]$/.test(text)) text += '。'
  return `${text}${PROVIDER_VIDEO_CACHE_RETRY_HINT}`
}

export function absoluteMediaUrl(path) {
  if (typeof path !== 'string' || !path) return ''
  if (/^(data:|blob:)/i.test(path)) return path
  const sanitized = path.replace(/([?&])token=[^&]*/g, '$1').replace(/[?&]$/, '')
  if (/^https?:/i.test(sanitized)) return sanitized
  const relative = `${BASE}${sanitized}`
  if (!relative) return ''
  return `${window.location.origin}${relative.startsWith('/') ? relative : `/${relative}`}`
}

export async function copyTextToClipboard(text) {
  const value = typeof text === 'string' ? text : String(text || '')
  if (!value) return false
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch (error) {
      void error
    }
  }
  if (typeof document === 'undefined' || !document.body) return false
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)
  try {
    return document.execCommand('copy')
  } catch (error) {
    void error
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

export function normalizeMediaItem(item) {
  if (typeof item === 'string') return item ? { url: item, name: '' } : null
  if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url) return null
  return {
    ...item,
    name: typeof item.name === 'string' ? item.name : '',
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
  }
}

export function normalizeMediaList(list) {
  return Array.isArray(list) ? list.map(normalizeMediaItem).filter(Boolean) : []
}

function normalizeDurationSeconds(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

function normalizeStartTime(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

function normalizeImageAspectRatio(value) {
  return ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(value) ? value : '1:1'
}

export function normalizeImageQuality(value) {
  return ['1K', '2K', '4K'].includes(value) ? value : '2K'
}

function normalizeVideoResolution(value) {
  return ['720p', '1080p'].includes(value) ? value : '720p'
}

function normalizeVideoMode(scene) {
  if (scene.videoMode === 'advanced_video') return 'advanced_video'
  if (scene.videoMode === 'reference_video') return 'reference_video'
  if (scene.refVideoUrl) return 'reference_video'
  if (Array.isArray(scene.advancedRefVideos) && scene.advancedRefVideos.length > 0) return 'advanced_video'
  return 'generate'
}

export function getErrorMessage(error, fallback = '操作失败') {
  const raw = error instanceof Error && error.message ? error.message : String(error || fallback)
  let text = raw || fallback
  try {
    const parsed = JSON.parse(raw)
    text = parsed?.detail || parsed?._error || parsed?.message || raw
  } catch (e) {
    void e
  }
  if (/429|RESOURCE_EXHAUSTED|Too Many Requests/i.test(text)) {
    return '模型当前触发限流或配额不足，请稍后重试。'
  }
  if (/503|UNAVAILABLE|high demand|temporar/i.test(text)) {
    return '模型服务当前繁忙，请稍后重试。'
  }
  if (/504|DEADLINE_EXCEEDED|deadline expired|timeout/i.test(text)) {
    return '模型响应超时，请稍后重试。'
  }
  if (/401/.test(text)) {
    return '模型 API Key 无效或已过期，请检查设置。'
  }
  if (/403|PERMISSION_DENIED/i.test(text)) {
    return '模型 API Key 权限不足，请检查账号、模型权限或重新配置。'
  }
  return text || fallback
}

export function logGamePageError(action, error) {
  console.warn(`[GameVideoPage] ${action} failed`, error)
}

export function makeScene(idx, models) {
  return {
    id: uid(), idx, prompt: '', description: '',
    aiModel: 'doubao-seed-2-0-pro-260215',
    videoMode: 'generate',
    charImages: [], sceneImages: [],
    imageGenHistory: [],
    model: models?.[0]?.id || 'seedance-2.0',
    provider: models?.[0]?.provider || 'jimeng',
    duration: 5, aspectRatio: '9:16', videoResolution: '720p',
    status: 'idle', taskId: '', videoUrl: '', error: '',
    videoHistory: [],
    startTime: null, collapsed: false,
    refVideoUrl: '',
    refVideoDurationSeconds: null,
    advancedRefVideos: [],
  }
}

export function cloneScene(scene, overrides = {}) {
  return {
    ...scene,
    charImages: normalizeMediaList(scene?.charImages),
    sceneImages: normalizeMediaList(scene?.sceneImages),
    imageGenHistory: normalizeMediaList(scene?.imageGenHistory),
    videoHistory: normalizeMediaList(scene?.videoHistory),
    advancedRefVideos: normalizeMediaList(scene?.advancedRefVideos).map(item => ({
      ...item,
      durationSeconds: normalizeDurationSeconds(item.durationSeconds),
    })),
    ...overrides,
    videoResolution: normalizeVideoResolution(overrides.videoResolution ?? scene?.videoResolution),
  }
}

export function normalizeScene(raw, idx, models) {
  const rawIdx = Number(raw?.idx)
  const sceneIdx = Number.isFinite(rawIdx) && rawIdx > 0 ? rawIdx : idx
  const scene = { ...makeScene(sceneIdx, models), ...(raw && typeof raw === 'object' ? raw : {}), idx: sceneIdx }
  const normalizedModel = typeof scene.model === 'string' && scene.model
    ? scene.model
    : (models?.[0]?.id || 'seedance-2.0')
  const normalizedProvider = models?.find(model => model.id === normalizedModel)?.provider
    || (typeof scene.provider === 'string' && scene.provider)
    || (models?.[0]?.provider || 'jimeng')
  return {
    ...scene,
    id: typeof scene.id === 'string' && scene.id ? scene.id : uid(),
    prompt: typeof scene.prompt === 'string' ? scene.prompt : '',
    description: typeof scene.description === 'string' ? scene.description : '',
    videoMode: normalizeVideoMode(scene),
    charImages: normalizeMediaList(scene.charImages),
    sceneImages: normalizeMediaList(scene.sceneImages),
    imageGenHistory: normalizeMediaList(scene.imageGenHistory),
    model: normalizedModel,
    provider: normalizedProvider,
    videoResolution: normalizeVideoResolution(scene.videoResolution),
    taskId: typeof scene.taskId === 'string' ? scene.taskId : '',
    startTime: normalizeStartTime(scene.startTime),
    videoHistory: normalizeMediaList(scene.videoHistory),
    videoUrl: typeof scene.videoUrl === 'string' ? scene.videoUrl : '',
    refVideoUrl: typeof scene.refVideoUrl === 'string' ? scene.refVideoUrl : '',
    refVideoDurationSeconds: normalizeDurationSeconds(scene.refVideoDurationSeconds),
    advancedRefVideos: normalizeMediaList(scene.advancedRefVideos).map(item => ({
      ...item,
      durationSeconds: normalizeDurationSeconds(item.durationSeconds),
    })),
    status: typeof scene.status === 'string' ? scene.status : 'idle',
    error: typeof scene.error === 'string' ? scene.error : '',
  }
}

export function parseTabState(tab, imageModels = []) {
  const rv = tab?.replaceVideo || {}
  const si = tab?.standaloneImage || {}
  const vr = tab?.videoReverse || {}

  const ids = imageModels.map(model => model.id)
  const savedModel = typeof si.imgGenModel === 'string' ? si.imgGenModel : ''
  const pickedImageModel = savedModel && ids.includes(savedModel) ? savedModel : (imageModels[0]?.id || '')
  const providerFromList = imageModels.find(model => model.id === pickedImageModel)?.provider || ''

  return {
    replaceVideo: {
      replHistory: normalizeMediaList(rv.replHistory),
      replCharImage: normalizeMediaItem(rv.replCharImage),
      replRefVideo: typeof rv.replRefVideo === 'string' ? rv.replRefVideo : '',
      replRefVideoDurationSeconds: normalizeDurationSeconds(rv.replRefVideoDurationSeconds),
      replPrompt: typeof rv.replPrompt === 'string' ? rv.replPrompt : '',
      replProvider: rv.replProvider === 'jimeng' ? 'jimeng' : 'wan',
      replWanMode: rv.replWanMode === 'wan-pro' ? 'wan-pro' : 'wan-std',
      replWanCheckImage: Boolean(rv.replWanCheckImage),
      replVideoResolution: normalizeVideoResolution(rv.replVideoResolution),
      replTaskId: typeof rv.replTaskId === 'string' ? rv.replTaskId : '',
      replStatus: typeof rv.replStatus === 'string' ? rv.replStatus : 'idle',
      replError: typeof rv.replError === 'string' ? rv.replError : '',
      replStartTime: normalizeStartTime(rv.replStartTime),
      replVideoUrl: typeof rv.replVideoUrl === 'string' ? rv.replVideoUrl : '',
    },
    standaloneImage: {
      imgGenHistory: normalizeMediaList(si.imgGenHistory),
      imgGenPrompt: typeof si.imgGenPrompt === 'string' ? si.imgGenPrompt : '',
      imgGenPromptModel: typeof si.imgGenPromptModel === 'string' ? si.imgGenPromptModel : 'gemini-2.5-flash',
      imgGenModel: pickedImageModel,
      imgGenProvider: typeof si.imgGenProvider === 'string' ? si.imgGenProvider : providerFromList,
      imgGenRefImages: normalizeMediaList(si.imgGenRefImages),
      imgGenEditMode: Boolean(si.imgGenEditMode),
      imgGenAspectRatio: normalizeImageAspectRatio(si.imgGenAspectRatio),
      imgGenQuality: normalizeImageQuality(si.imgGenQuality),
    },
    videoReverse: {
      reverseHistory: Array.isArray(vr.reverseHistory) ? vr.reverseHistory.filter(item => item && typeof item === 'object') : [],
      reverseVideoUrl: typeof vr.reverseVideoUrl === 'string' ? vr.reverseVideoUrl : '',
      reverseVideoDurationSeconds: normalizeDurationSeconds(vr.reverseVideoDurationSeconds),
      reverseModel: typeof vr.reverseModel === 'string' ? vr.reverseModel : 'gemini-3.1-pro-preview',
      reverseResult: typeof vr.reverseResult === 'string' ? vr.reverseResult : '',
    },
  }
}

export function serializeScenes(list) {
  return list.map(scene => {
    const normalizedModel = typeof scene.model === 'string' && scene.model ? scene.model : 'seedance-2.0'
    const normalizedProvider = typeof scene.provider === 'string' && scene.provider ? scene.provider : 'jimeng'
    return {
      id: scene.id,
      idx: scene.idx,
      prompt: scene.prompt,
      description: scene.description || '',
      aiModel: scene.aiModel || 'doubao-seed-2-0-pro-260215',
      videoMode: scene.videoMode === 'advanced_video' ? 'advanced_video' : scene.videoMode === 'reference_video' ? 'reference_video' : 'generate',
      charImages: normalizeMediaList(scene.charImages),
      sceneImages: normalizeMediaList(scene.sceneImages),
      imageGenHistory: normalizeMediaList(scene.imageGenHistory),
      model: normalizedModel,
      provider: normalizedProvider,
      taskId: scene.taskId || '',
      duration: scene.duration,
      aspectRatio: scene.aspectRatio,
      videoResolution: normalizeVideoResolution(scene.videoResolution),
      status: scene.status || 'idle',
      error: scene.error || '',
      startTime: normalizeStartTime(scene.startTime),
      videoUrl: scene.videoUrl || '',
      refVideoUrl: scene.refVideoUrl || '',
      refVideoDurationSeconds: normalizeDurationSeconds(scene.refVideoDurationSeconds),
      advancedRefVideos: normalizeMediaList(scene.advancedRefVideos).map(item => ({
        ...item,
        durationSeconds: normalizeDurationSeconds(item.durationSeconds),
      })),
      videoHistory: normalizeMediaList(scene.videoHistory),
      collapsed: scene.collapsed,
    }
  })
}
