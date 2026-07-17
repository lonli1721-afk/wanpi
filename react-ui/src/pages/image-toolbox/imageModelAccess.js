const OPENAI_IMAGE2_MODEL_IDS = new Set(['gpt-image-2'])
const MULERUN_IMAGE_MODEL_IDS = new Set(['mulerun-gpt-image-2'])
const MULERUN_IMAGE_ALLOWED_GROUPS = new Set(['fa2_zhitou', 'fa2_wechat'])

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

function normalizeTeamText(value) {
  return String(value || '').trim().replace(/\s+/g, '')
}

export function canUseMuleRunImage() {
  const user = readCurrentUser()
  const role = String(user.role || '').trim().toLowerCase()
  if (role === 'admin') return true

  const groupId = String(user.api_usage_group || user.usage_group || user.group_id || '').trim()
  if (MULERUN_IMAGE_ALLOWED_GROUPS.has(groupId)) return true

  const team = normalizeTeamText(user.team)
  const department = normalizeTeamText(user.department)
  const teamGroup = normalizeTeamText(user.team_group)
  const isFa2 = department === '发行事业二部' || team.startsWith('发行事业二部')
  const groupText = teamGroup || team.replace(/^发行事业二部[-/／|]?/, '')
  return isFa2 && (groupText.includes('微信') || groupText.includes('直投'))
}

export function isMuleRunImageModel(modelOrId) {
  const id = typeof modelOrId === 'string' ? modelOrId : modelOrId?.id
  const provider = typeof modelOrId === 'string' ? '' : modelOrId?.provider
  return MULERUN_IMAGE_MODEL_IDS.has(id) || provider === 'mulerun_image'
}

export function filterImageModelsForCurrentUser(models) {
  if (!Array.isArray(models)) return []
  return models.filter(model => !isMuleRunImageModel(model) || canUseMuleRunImage())
}
