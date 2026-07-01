const WORKBENCH_CACHE_KEY = 'game_video_workbench_bootstrap_v1'
const WORKBENCH_CACHE_TTL_MS = 10 * 60 * 1000

function shouldBypassWorkbenchCache() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('refresh') === '1' || params.get('forceReload') === '1'
  } catch {
    return false
  }
}

function getWorkbenchCacheUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    return user?.id || user?.username || 'anonymous'
  } catch {
    return 'anonymous'
  }
}

export function readWorkbenchCache() {
  try {
    if (shouldBypassWorkbenchCache()) {
      sessionStorage.removeItem(WORKBENCH_CACHE_KEY)
      return null
    }
    const raw = sessionStorage.getItem(WORKBENCH_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.userId !== getWorkbenchCacheUserId()) return null
    if (Date.now() - Number(data.savedAt || 0) > WORKBENCH_CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

export function writeWorkbenchCache(patch) {
  try {
    sessionStorage.setItem(WORKBENCH_CACHE_KEY, JSON.stringify({
      userId: getWorkbenchCacheUserId(),
      savedAt: Date.now(),
      ...patch,
    }))
  } catch {
    // Cache is opportunistic; private mode/quota failures should not block use.
  }
}
