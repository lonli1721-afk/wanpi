const OPENAI_IMAGE2_MODEL_IDS = new Set(['gpt-image-2'])

const OPENAI_IMAGE2_BETA_USERNAMES = new Set([
  'huangye',
  'caipailing',
  'caipeiling',
  'zhouyanqing',
  'huanglin',
  'huanghuiyuan',
  'liuxiaoxiao',
  'liqingling',
  'zhanghongzhi',
])

const OPENAI_IMAGE2_BETA_DISPLAY_NAMES = new Set([
  '黄也',
  '蔡沛玲',
  '周延青',
  '黄琳',
  '黄慧缘',
  '黄慧媛',
  '刘潇潇',
  '黎庆玲',
  '张宏智',
])

function readCurrentUser() {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem('user') || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function canUseOpenAIImage2() {
  const user = readCurrentUser()
  const role = String(user.role || '').trim().toLowerCase()
  if (role === 'admin') return true
  const username = String(user.username || '').trim().toLowerCase()
  const displayName = String(user.display_name || '').trim()
  return OPENAI_IMAGE2_BETA_USERNAMES.has(username) || OPENAI_IMAGE2_BETA_DISPLAY_NAMES.has(displayName)
}

export function isOpenAIImage2Model(modelOrId) {
  const id = typeof modelOrId === 'string' ? modelOrId : modelOrId?.id
  return OPENAI_IMAGE2_MODEL_IDS.has(id)
}

export function filterImageModelsForCurrentUser(models) {
  return Array.isArray(models) ? models : []
}
