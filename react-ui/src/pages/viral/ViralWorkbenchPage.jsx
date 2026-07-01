import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Clock, Copy, FileVideo2, Filter, History, Loader2, Plus, RefreshCw, Save, Search, Sparkles, Star, Trash2, Upload, Video } from 'lucide-react'
import { api, runConcurrent } from '../../services/api'
import { FALLBACK_VIDEO_MODELS } from '../game/gameVideoConstants'
import { useGameTaskPolling } from '../game/useGameTaskPolling'
import AnalysisBriefStrip from './components/AnalysisBriefStrip'
import ViralWorkbenchHeader from './components/ViralWorkbenchHeader'

const categoryLabels = {
  hook: '开头钩子',
  visual: '视觉刺激',
  gameplay: '玩法呈现',
  pacing: '节奏',
  emotion: '情绪',
  conversion: '转化',
  audience: '人群',
}

const platformOptions = ['TikTok', '抖音', '快手', 'Meta', 'YouTube Shorts', '微信视频号', '其他']
const videoFilterOptions = [
  { value: 'all', label: '全部素材' },
  { value: 'selected', label: '已选分析' },
  { value: 'analyzed', label: '已分析' },
  { value: 'pending', label: '未分析' },
]
const videoSortOptions = [
  { value: 'recent', label: '最近上传' },
  { value: 'hook_strength', label: '钩子强度' },
  { value: 'duration', label: '时长从长到短' },
  { value: 'name', label: '文件名' },
  { value: 'analyzed', label: '已分析优先' },
]
const tagCategoryOptions = [
  { value: 'all', label: '全部爆点' },
  ...Object.entries(categoryLabels).map(([value, label]) => ({ value, label })),
]
const planCountOptions = [3, 4, 5]
const scriptStyleOptions = ['玩家吐槽', '失败反转', '收益前置', '强悬念', '轻广告感']
const durationOptions = ['5s', '10s', '15s', '20s', '30s']
const ctaOptions = ['弱行动引导', '中行动引导', '强行动引导']
const sceneDurationOptions = [3, 5, 10, 15]
const sceneAspectOptions = ['9:16', '16:9', '1:1', '4:3', '3:4']
const VIRAL_SCENE_APPLY_PREFS_KEY = 'viral:scene-apply-preferences:v1'
const rewriteTargetOptions = [
  { value: 'change_points', label: '改动点' },
  { value: 'script_outline', label: '脚本大纲' },
  { value: 'storyboard_rhythm', label: '分镜节奏' },
  { value: 'video_prompt', label: '视频提示词' },
]
const MAX_ANALYSIS_VIDEO_COUNT = 6
const hideTemporarilyUnavailablePromptModels = (models = []) => models.filter(model => model?.provider !== 'openai')
const FALLBACK_MODELS = [
  { id: 'doubao-seed-2-0-pro-260215', name: '火山 Doubao Seed 2.0 Pro', provider: 'ark' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash（实验）', provider: 'gemini' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'gemini' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' },
]
const VIRAL_WORKBENCH_READABLE_STYLE = `
  .viral-readable {
    font-size: 14px;
  }
  .viral-readable .viral-button,
  .viral-readable input,
  .viral-readable select,
  .viral-readable textarea,
  .viral-readable label,
  .viral-readable .viral-field,
  .viral-readable .viral-empty,
  .viral-readable .viral-alert,
  .viral-readable .viral-material-row-copy,
  .viral-readable .viral-history-copy,
  .viral-readable .viral-tag-details,
  .viral-readable .viral-script-card,
  .viral-readable .viral-rec-list,
  .viral-readable .viral-mini-metric,
  .viral-readable .viral-scene-apply,
  .viral-readable .viral-scene-action-help,
  .viral-readable .viral-condition-help {
    font-size: 13px !important;
    line-height: 1.55 !important;
  }
  .viral-readable textarea {
    font-size: 14px !important;
    line-height: 1.75 !important;
  }
  .viral-readable .viral-panel-heading p,
  .viral-readable .viral-creative-section-head p,
  .viral-readable .viral-material-diagnosis,
  .viral-readable .viral-tag-meta,
  .viral-readable .viral-script-card-badges,
  .viral-readable .viral-upload-job,
  .viral-readable .viral-muted,
  .viral-readable small {
    font-size: 12px !important;
    line-height: 1.5 !important;
  }
`

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(value) {
  if (!value) return '未知时长'
  return `${Number(value).toFixed(1)}s`
}

function displayError(error) {
  const raw = error?.message || String(error || '')
  try {
    const parsed = JSON.parse(raw)
    return parsed?.detail || raw
  } catch {
    return raw
  }
}

function apiAssetUrl(url) {
  if (!url || !url.startsWith('/')) return url || ''
  const base = import.meta.env.VITE_API_URL || ''
  if (!url.startsWith('/api/files/')) return `${base}${url}`
  const token = localStorage.getItem('token')
  if (!token) return `${base}${url}`
  const sep = url.includes('?') ? '&' : '?'
  return `${base}${url}${sep}token=${encodeURIComponent(token)}`
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function mergeAnalysisList(list, next) {
  if (!next?.id) return list
  const rest = list.filter(item => item.id !== next.id)
  return [next, ...rest]
}

function historyStatusText(item) {
  if (item.status === 'failed') return '分析失败'
  if (item.status === 'processing') return '分析中'
  return `${item.tags?.length || 0} 个标签 · ${item.plans?.length || 0} 个方案`
}

function historyStatusClass(item) {
  if (item.status === 'failed') return 'is-danger'
  if (item.status === 'processing') return 'is-warning'
  return ''
}

function statusLabel(analysis) {
  if (!analysis) return '待分析'
  if (analysis.status === 'processing') return '分析中'
  if (analysis.status === 'failed') return '失败'
  if (analysis.error) return '备用分析'
  return '已完成'
}

function displaySummaryText(analysis, summaryTag) {
  if (analysis?.error) {
    return '模型调用未成功，已用备用分析补齐标签和方案；可先选爆点看方案，正式投放前建议切换可用模型重跑。'
  }
  return summaryTag?.evidence || ''
}

function displayObjectiveText(analysis, text) {
  const value = text || ''
  if (!analysis?.error || !value.includes('AI 方案兜底')) return localizeMarketingTerms(value)
  return localizeMarketingTerms(value.split('AI 方案兜底')[0].trim() || '验证该爆点组合是否能提升关键转化指标。')
}

function localizeMarketingTerms(value) {
  return String(value || '').replaceAll('CTA', '行动引导')
}

function listToText(items) {
  return localizeMarketingTerms((items || []).join('\n'))
}

function textToList(value, limit = 10) {
  return String(value || '')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function planToDraft(plan) {
  if (!plan) return null
  return {
    id: plan.id || `manual-${Date.now()}`,
    source: plan.source || 'ai',
    selected_tag_ids: plan.selected_tag_ids || [],
    title: localizeMarketingTerms(plan.title || ''),
    change_points_text: listToText(plan.change_points),
    test_objective: localizeMarketingTerms(plan.test_objective || ''),
    script_outline_text: listToText(plan.script_outline),
    storyboard_rhythm_text: listToText(plan.storyboard_rhythm),
    video_prompt: localizeMarketingTerms(plan.video_prompt || ''),
    user_revision_note: localizeMarketingTerms(plan.user_revision_note || ''),
  }
}

function draftToComparable(draft) {
  if (!draft) return null
  return {
    selected_tag_ids: draft.selected_tag_ids || [],
    title: String(draft.title || '').trim(),
    change_points: textToList(draft.change_points_text, 8),
    test_objective: String(draft.test_objective || '').trim(),
    script_outline: textToList(draft.script_outline_text, 10),
    storyboard_rhythm: textToList(draft.storyboard_rhythm_text, 10),
    video_prompt: String(draft.video_prompt || '').trim(),
    user_revision_note: String(draft.user_revision_note || '').trim(),
  }
}

function planToComparable(plan) {
  return draftToComparable(planToDraft(plan))
}

function isDraftDifferentFromPlan(draft, plan) {
  if (!draft) return false
  if (!plan) return true
  return JSON.stringify(draftToComparable(draft)) !== JSON.stringify(planToComparable(plan))
}

function isTextToVideoModel(model) {
  if (!model) return false
  const supportedModes = Array.isArray(model.supported_modes) ? model.supported_modes : ['generate']
  const id = String(model.id || '').toLowerCase()
  const note = String(model.limit_note || '').toLowerCase()
  if (!supportedModes.includes('generate')) return false
  if (id.includes('video-edit') || id.includes('i2v') || id.includes('r2v')) return false
  if (note.includes('必须') || note.includes('must')) return false
  return true
}

function getTextToVideoFallbackModels() {
  return FALLBACK_VIDEO_MODELS.filter(isTextToVideoModel)
}

function resolveVideoModelOptions(remoteModels) {
  const source = Array.isArray(remoteModels) && remoteModels.length
    ? remoteModels
    : FALLBACK_VIDEO_MODELS
  const textModels = source.filter(isTextToVideoModel)
  return textModels.length ? textModels : getTextToVideoFallbackModels()
}

function getFallbackTextToVideoModel() {
  return getTextToVideoFallbackModels()[0] || FALLBACK_VIDEO_MODELS[0]
}

function getSceneDurationOptions(model) {
  const minDuration = Number(model?.min_duration || 0)
  const maxDuration = Number(model?.max_duration || 0)
  const filtered = sceneDurationOptions.filter(item => (
    (!minDuration || item >= minDuration) && (!maxDuration || item <= maxDuration)
  ))
  return filtered.length ? filtered : sceneDurationOptions
}

function normalizeSceneDurationForModel(value, model) {
  const current = Number(value)
  const options = getSceneDurationOptions(model)
  if (options.includes(current)) return current
  return options[0] || sceneDurationOptions[0]
}

function sanitizeSceneApplyPreferences(value) {
  if (!value || typeof value !== 'object') return {}
  const duration = Number(value.duration)
  const aspectRatio = String(value.aspect_ratio || '')
  const next = {}
  if (typeof value.model === 'string' && value.model.trim()) next.model = value.model.trim()
  if (typeof value.provider === 'string' && value.provider.trim()) next.provider = value.provider.trim()
  if (sceneDurationOptions.includes(duration)) next.duration = duration
  if (sceneAspectOptions.includes(aspectRatio)) next.aspect_ratio = aspectRatio
  return next
}

function loadSceneApplyPreferences() {
  try {
    return sanitizeSceneApplyPreferences(JSON.parse(window.localStorage.getItem(VIRAL_SCENE_APPLY_PREFS_KEY) || '{}'))
  } catch {
    return {}
  }
}

function saveSceneApplyPreferences(value) {
  try {
    window.localStorage.setItem(VIRAL_SCENE_APPLY_PREFS_KEY, JSON.stringify(sanitizeSceneApplyPreferences(value)))
  } catch {
    // Local storage may be unavailable in private mode; scene generation still works.
  }
}

function normalizeScenePayload(saved) {
  return Array.isArray(saved)
    ? { generate: saved, replace: [], tabState: null }
    : {
        generate: Array.isArray(saved?.generate) ? saved.generate : [],
        replace: Array.isArray(saved?.replace) ? saved.replace : [],
        tabState: saved?.tabState || null,
      }
}

function makeManualPlanDraft(selectedTagIds) {
  return {
    id: `manual-${Date.now()}`,
    source: 'manual',
    selected_tag_ids: selectedTagIds.filter(id => id && id !== 'summary'),
    title: '手写改版方案',
    change_points_text: '',
    test_objective: '',
    script_outline_text: '',
    storyboard_rhythm_text: '',
    video_prompt: '',
    user_revision_note: '',
  }
}

function Field({ label, children }) {
  return (
    <label className="viral-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function PanelTitle({ icon: Icon, title, meta, action }) {
  return (
    <div className="viral-panel-title">
      <div className="viral-panel-heading">
        {Icon && <Icon size={17} />}
        <div>
          <div>{title}</div>
          {meta && <p>{meta}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

function VideoPreview({ src, compact = false }) {
  return (
    <div className={`viral-video-frame ${compact ? 'is-compact' : ''}`}>
      {src ? (
        <video src={apiAssetUrl(src)} controls={!compact} muted playsInline preload="none" />
      ) : (
        <FileVideo2 size={30} />
      )}
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="viral-mini-metric">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  )
}

function BulkManageBar({ label, selectedCount, totalCount, onSelectAll, onClear, onDelete }) {
  const allSelected = totalCount > 0 && selectedCount === totalCount
  return (
    <div className={`viral-bulk-bar ${selectedCount ? 'has-selection' : ''}`}>
      <span>{label} · 已选 {selectedCount}/{totalCount}</span>
      <button type="button" onClick={onSelectAll} disabled={!totalCount}>{allSelected ? '取消全选' : '全选'}</button>
      <button type="button" onClick={onClear} disabled={!selectedCount}>清空</button>
      <button type="button" className="danger" onClick={onDelete} disabled={!selectedCount}>批量删除</button>
    </div>
  )
}

function ScriptConfigControls({ compact = false, scriptConfig, updateScriptConfig, primaryTag }) {
  return (
    <div className={`viral-script-config-strip ${compact ? 'is-compact' : ''}`}>
      <div className="viral-config-group">
        <span>生成数量</span>
        <div className="viral-segmented">
          {planCountOptions.map(count => (
            <button
              type="button"
              key={count}
              className={scriptConfig.plan_count === count ? 'is-active' : ''}
              onClick={() => updateScriptConfig('plan_count', count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
      <label className="viral-config-group">
        <span>脚本风格</span>
        <select value={scriptConfig.style} onChange={event => updateScriptConfig('style', event.target.value)}>
          {scriptStyleOptions.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="viral-config-group">
        <span><Clock size={13} />目标时长</span>
        <select value={scriptConfig.target_duration} onChange={event => updateScriptConfig('target_duration', event.target.value)}>
          {durationOptions.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="viral-config-group">
        <span>行动引导强度</span>
        <select value={scriptConfig.cta_strength} onChange={event => updateScriptConfig('cta_strength', event.target.value)}>
          {ctaOptions.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="viral-config-toggle">
        <input
          type="checkbox"
          checked={scriptConfig.keep_original_hook}
          onChange={event => updateScriptConfig('keep_original_hook', event.target.checked)}
        />
        保留原钩子
      </label>
      <div className="viral-config-primary">
        <Video size={14} />
        <span>主爆点</span>
        <strong>{primaryTag?.label || '未设置'}</strong>
      </div>
    </div>
  )
}

export default function ViralWorkbenchPage() {
  const [videos, setVideos] = useState([])
  const [analyses, setAnalyses] = useState([])
  const [activeAnalysis, setActiveAnalysis] = useState(null)
  const [models, setModels] = useState(FALLBACK_MODELS)
  const [videoModels, setVideoModels] = useState(getTextToVideoFallbackModels)
  const [gameProjects, setGameProjects] = useState([])
  const [projectScenes, setProjectScenes] = useState({ generate: [], replace: [], tabState: null })
  const [selectedVideoIds, setSelectedVideoIds] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [form, setForm] = useState({
    game_type: '',
    target_user: '',
    platform: 'TikTok',
    optimization_goal: '',
    model: 'gemini-2.5-flash',
  })
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [videoManageMode, setVideoManageMode] = useState(false)
  const [analysisManageMode, setAnalysisManageMode] = useState(false)
  const [selectedVideoDeleteIds, setSelectedVideoDeleteIds] = useState([])
  const [selectedAnalysisDeleteIds, setSelectedAnalysisDeleteIds] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [selectedBatchPlanIds, setSelectedBatchPlanIds] = useState([])
  const [planDraft, setPlanDraft] = useState(null)
  const [savingPlan, setSavingPlan] = useState(false)
  const [rewritingPlan, setRewritingPlan] = useState(false)
  const [rewriteTargets, setRewriteTargets] = useState(['script_outline', 'storyboard_rhythm', 'video_prompt'])
  const [rewriteModel, setRewriteModel] = useState('gemini-2.5-flash')
  const [sceneApplyConfig, setSceneApplyConfig] = useState(() => {
    const savedSceneApplyPreferences = loadSceneApplyPreferences()
    return {
      project_id: '',
      mode: 'append',
      scene_id: '',
      model: savedSceneApplyPreferences.model || 'seedance-2.0',
      provider: savedSceneApplyPreferences.provider || 'jimeng',
      duration: savedSceneApplyPreferences.duration || 5,
      aspect_ratio: savedSceneApplyPreferences.aspect_ratio || '9:16',
    }
  })
  const [applyingScene, setApplyingScene] = useState(false)
  const [sceneApplyMessage, setSceneApplyMessage] = useState('')
  const [sceneApplyError, setSceneApplyError] = useState('')
  const activeAnalysisIdRef = useRef('')
  const analyzeRequestRef = useRef(0)
  const planRequestRef = useRef(0)
  const rewriteRequestRef = useRef(0)
  const { registerTaskPolling } = useGameTaskPolling({
    intervalMs: 5000,
    pollLimit: 240,
    onPollingError: error => setSceneApplyError(displayError(error)),
  })
  const [latestGeneratedPlanIds, setLatestGeneratedPlanIds] = useState([])
  const [briefExpanded, setBriefExpanded] = useState(false)
  const [videoQuery, setVideoQuery] = useState('')
  const [videoFilter, setVideoFilter] = useState('all')
  const [videoSort, setVideoSort] = useState('recent')
  const [activeVideoId, setActiveVideoId] = useState('')
  const [expandedMaterialInsightIds, setExpandedMaterialInsightIds] = useState([])
  const [uploadJobs, setUploadJobs] = useState([])
  const [lastUploadBatch, setLastUploadBatch] = useState(null)
  const [autoAnalyzeUploads, setAutoAnalyzeUploads] = useState(true)
  const [tagCategory, setTagCategory] = useState('all')
  const [primaryTagId, setPrimaryTagId] = useState('')
  const [expandedTagIds, setExpandedTagIds] = useState([])
  const [scriptConfig, setScriptConfig] = useState({
    plan_count: 4,
    style: '玩家吐槽',
    target_duration: '20s',
    keep_original_hook: true,
    cta_strength: '弱行动引导',
  })

  useEffect(() => {
    activeAnalysisIdRef.current = activeAnalysis?.id || ''
  }, [activeAnalysis?.id])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [videoData, analysisData] = await Promise.all([
          api.get('/api/viral/videos'),
          api.get('/api/viral/analyses'),
        ])
        if (cancelled) return
        const nextVideos = videoData.videos || []
        const nextAnalyses = analysisData.analyses || []
        setVideos(nextVideos)
        setAnalyses(nextAnalyses)
        if (nextAnalyses[0]) activateAnalysis(nextAnalyses[0])
      } catch (err) {
        if (!cancelled) setError(displayError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.get('/api/viral/models')
      .then(data => {
        const visibleModels = hideTemporarilyUnavailablePromptModels(data.models || [])
        if (!cancelled && visibleModels.length) setModels(visibleModels)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/api/game/projects').catch(() => []),
      api.get('/api/game/video_models').catch(() => ({ models: [] })),
    ]).then(([projectsData, videoModelData]) => {
      if (cancelled) return
      const projects = Array.isArray(projectsData) ? projectsData : []
      const usableVideoModels = resolveVideoModelOptions(videoModelData?.models)
      setGameProjects(projects)
      setVideoModels(usableVideoModels)
      setSceneApplyConfig(prev => {
        const nextProjectId = prev.project_id || projects[0]?.id || ''
        const nextModel = usableVideoModels.some(item => item.id === prev.model) ? prev.model : usableVideoModels[0]?.id || 'seedance-2.0'
        const modelRow = usableVideoModels.find(item => item.id === nextModel) || usableVideoModels[0]
        return {
          ...prev,
          project_id: nextProjectId,
          model: nextModel,
          provider: modelRow?.provider || prev.provider || 'jimeng',
          duration: normalizeSceneDurationForModel(prev.duration, modelRow),
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sceneApplyConfig.project_id) {
      return undefined
    }
    let cancelled = false
    api.get(`/api/game/projects/${sceneApplyConfig.project_id}/scenes`)
      .then(data => {
        if (cancelled) return
        const normalized = normalizeScenePayload(data)
        setProjectScenes(normalized)
        setSceneApplyConfig(prev => ({
          ...prev,
          scene_id: normalized.generate.some(scene => scene.id === prev.scene_id)
            ? prev.scene_id
            : (
                normalized.generate.find(scene => scene.videoUrl || scene.taskId || ['processing', 'generating', 'completed'].includes(String(scene.status || '').toLowerCase()))?.id
                || normalized.generate[normalized.generate.length - 1]?.id
                || normalized.generate[0]?.id
                || ''
              ),
        }))
      })
      .catch(() => {
        if (!cancelled) setProjectScenes({ generate: [], replace: [], tabState: null })
      })
    return () => {
      cancelled = true
    }
  }, [sceneApplyConfig.project_id])

  useEffect(() => {
    saveSceneApplyPreferences({
      model: sceneApplyConfig.model,
      provider: sceneApplyConfig.provider,
      duration: sceneApplyConfig.duration,
      aspect_ratio: sceneApplyConfig.aspect_ratio,
    })
  }, [
    sceneApplyConfig.model,
    sceneApplyConfig.provider,
    sceneApplyConfig.duration,
    sceneApplyConfig.aspect_ratio,
  ])

  const activeTags = activeAnalysis?.tags || []
  const summaryTag = activeTags.find(tag => tag.id === 'summary')
  const selectableTags = activeTags.filter(tag => tag.id !== 'summary')
  const selectedTagCount = selectedTagIds.filter(id => id !== 'summary').length
  const selectedTags = selectedTagIds
    .map(id => selectableTags.find(tag => tag.id === id))
    .filter(Boolean)
  const selectedTagPreview = selectedTags.map(tag => tag.label).join(' · ')
  const selectedVideos = useMemo(
    () => videos.filter(video => selectedVideoIds.includes(video.id)),
    [videos, selectedVideoIds],
  )
  const activeModel = models.find(model => model.id === form.model) || models[0]
  const activeVideoInsights = useMemo(() => activeAnalysis?.video_insights || [], [activeAnalysis])
  const plans = useMemo(() => activeAnalysis?.plans || [], [activeAnalysis])
  const selectedBatchPlans = useMemo(
    () => selectedBatchPlanIds.map(id => plans.find(plan => plan.id === id)).filter(Boolean),
    [plans, selectedBatchPlanIds],
  )
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId) || null
  const effectiveSelectedPlan = selectedPlan || (planDraft?.source === 'manual' && planDraft?.id === selectedPlanId ? null : plans[0] || null)
  const effectivePlanDraft = planDraft || planToDraft(effectiveSelectedPlan)
  const effectiveSelectedPlanId = effectiveSelectedPlan?.id || planDraft?.id || ''
  const isManualDraft = Boolean(planDraft?.id && !plans.some(plan => plan.id === planDraft.id))
  const currentPlanHasUnsavedChanges = Boolean(planDraft?.id && isDraftDifferentFromPlan(planDraft, plans.find(plan => plan.id === planDraft.id)))
  const selectedBatchHasUnsavedDraft = Boolean(planDraft?.id && selectedBatchPlanIds.includes(planDraft.id) && currentPlanHasUnsavedChanges)
  const targetProject = gameProjects.find(project => project.id === sceneApplyConfig.project_id) || null
  const targetScene = projectScenes.generate.find(scene => scene.id === sceneApplyConfig.scene_id) || null
  const activeSceneVideoModel = videoModels.find(item => item.id === sceneApplyConfig.model) || videoModels[0] || getFallbackTextToVideoModel()
  const sceneDurationChoices = getSceneDurationOptions(activeSceneVideoModel)
  const lastBatchIds = useMemo(() => lastUploadBatch?.video_ids || [], [lastUploadBatch])
  const lastBatchSelectedCount = lastBatchIds.filter(id => selectedVideoIds.includes(id)).length
  const lastBatchVideos = useMemo(
    () => lastBatchIds.map(id => videos.find(video => video.id === id)).filter(Boolean),
    [lastBatchIds, videos],
  )

  const updateAppliedSceneTask = useCallback((projectId, sceneId, updates, { saveImmediately = false } = {}) => {
    if (!projectId || !sceneId) return
    if (updates?.status === 'completed' && updates?.videoUrl) {
      setSceneApplyMessage('视频已生成完成，已写回项目场景。')
      setSceneApplyError('')
    }
    if (updates?.status === 'failed') {
      setSceneApplyError(`视频生成失败：${updates.error || '请稍后重试'}`)
    }
    const applyPatch = prev => {
      const updateList = list => (
        Array.isArray(list)
          ? list.map(scene => (scene.id === sceneId ? { ...scene, ...updates } : scene))
          : []
      )
      const next = {
        generate: updateList(prev.generate),
        replace: updateList(prev.replace),
        tabState: prev.tabState || null,
      }
      return next
    }
    if (projectId === sceneApplyConfig.project_id) {
      setProjectScenes(applyPatch)
    }
    if (saveImmediately) {
      void api.patch(`/api/game/projects/${projectId}/scenes/${sceneId}`, { scene: updates })
        .then(result => {
          if (projectId === sceneApplyConfig.project_id && result?.scenes) {
            setProjectScenes(normalizeScenePayload(result.scenes))
          }
        })
        .catch(error => setSceneApplyError(displayError(error)))
    }
  }, [sceneApplyConfig.project_id])

  useEffect(() => {
    if (!sceneApplyConfig.project_id) return
    const registeredTaskIds = new Set()
    ;[...(projectScenes.generate || []), ...(projectScenes.replace || [])].forEach(scene => {
      if (!scene?.taskId || registeredTaskIds.has(scene.taskId)) return
      if (!['generating', 'processing'].includes(String(scene.status || '').toLowerCase())) return
      registeredTaskIds.add(scene.taskId)
      const pollingProjectId = sceneApplyConfig.project_id
      registerTaskPolling(scene.taskId, updates => updateAppliedSceneTask(pollingProjectId, scene.id, updates, {
        saveImmediately: updates.status === 'completed' || updates.status === 'failed',
      }))
    })
  }, [projectScenes.generate, projectScenes.replace, registerTaskPolling, sceneApplyConfig.project_id, updateAppliedSceneTask])
  const videoCount = selectedVideos.length || activeAnalysis?.video_urls?.length || selectedVideoIds.length || 0
  const planCount = plans.length
  const summaryText = displaySummaryText(activeAnalysis, summaryTag)
  const mainSummary = summaryText || form.optimization_goal || '选择爆款视频后提炼可复用爆点，再生成改版方案。'
  const videoLimitExceeded = selectedVideoIds.length > MAX_ANALYSIS_VIDEO_COUNT
  const primaryText = videoLimitExceeded ? `最多分析 ${MAX_ANALYSIS_VIDEO_COUNT} 个视频` : (selectedVideoIds.length ? `分析 ${selectedVideoIds.length} 个视频` : '先选择爆款视频')
  const primaryDisabled = analyzing || uploading || selectedVideoIds.length === 0 || videoLimitExceeded
  const recentAnalyses = analyses.slice(0, 1)
  const visibleTags = selectableTags.filter(tag => tagCategory === 'all' || tag.category === tagCategory)
  const primaryTag = selectedTags.find(tag => tag.id === primaryTagId) || selectedTags[0] || null
  const shouldShowBriefForm = briefExpanded
  const overviewStats = [
    { label: '视频', value: videoCount },
    { label: '爆点', value: selectableTags.length },
    { label: '已选', value: selectedTagCount, tone: selectedTagCount ? 'is-hot' : '' },
    { label: '方案', value: planCount },
  ]
  const nextStep = (() => {
    if (videoLimitExceeded) return { title: '本次素材太多', hint: `单次最多分析 ${MAX_ANALYSIS_VIDEO_COUNT} 个视频，先清掉多余素材。`, label: '清空选择', disabled: false }
    if (!selectedVideoIds.length) return { title: '先选择本次要拆解的爆款素材', hint: `点击素材行即可加入本次分析，单次最多 ${MAX_ANALYSIS_VIDEO_COUNT} 个。`, label: '选择素材', disabled: !videos.length }
    if (!activeAnalysis?.id || !selectableTags.length) return { title: '下一步：分析爆点标签', hint: 'AI 会逐条看素材，输出可复用爆点和画面证据。', label: primaryText, disabled: primaryDisabled }
    if (!selectedTagCount) return { title: '下一步：勾选要测试的爆点', hint: '优先选 1 个主爆点，再搭配 1-2 个辅助爆点。', label: '选择爆点', disabled: false }
    if (!plans.length) return { title: '下一步：生成改版脚本', hint: `${scriptConfig.plan_count} 个方案 · ${scriptConfig.style} · ${scriptConfig.target_duration} · ${scriptConfig.cta_strength}`, label: '生成脚本', disabled: planning }
    return { title: '脚本已可交付', hint: '继续编辑方案，或应用到项目场景后直接生成视频。', label: '查看脚本', disabled: false }
  })()
  const shouldShowNextAction = nextStep.title !== '脚本已可交付'
  const retryAnalysisIds = activeAnalysis?.video_ids?.length ? activeAnalysis.video_ids : selectedVideoIds
  const workflowSteps = [
    {
      id: 'material',
      title: '素材',
      detail: videoCount ? `${videoCount} 个素材` : '待选择',
      done: Boolean(selectedVideoIds.length || activeAnalysis?.video_ids?.length),
      active: !selectedVideoIds.length && !activeAnalysis?.video_ids?.length,
    },
    {
      id: 'analysis',
      title: '分析',
      detail: activeAnalysis?.error ? '备用分析' : (selectableTags.length ? `${selectableTags.length} 个爆点` : '待分析'),
      done: Boolean(activeAnalysis?.id && selectableTags.length),
      active: Boolean(selectedVideoIds.length && (!activeAnalysis?.id || !selectableTags.length || analyzing)),
      warning: Boolean(activeAnalysis?.error),
    },
    {
      id: 'hotspots',
      title: '爆点',
      detail: selectedTagCount ? `已选 ${selectedTagCount}` : '待勾选',
      done: selectedTagCount > 0,
      active: Boolean(selectableTags.length && !selectedTagCount),
    },
    {
      id: 'script',
      title: '脚本',
      detail: planCount ? `${planCount} 个方案` : '待生成',
      done: planCount > 0,
      active: Boolean(selectedTagCount && !planCount),
    },
    {
      id: 'scene',
      title: '场景生成',
      detail: targetScene?.videoUrl ? '已回填视频' : (targetScene?.taskId ? '生成中' : '待应用'),
      done: Boolean(targetScene?.videoUrl),
      active: Boolean(planCount && !targetScene?.videoUrl),
      warning: Boolean(targetScene?.status === 'failed'),
    },
  ]

  const getInsightForVideo = useCallback((video) => {
    if (!video) return null
    const analysisIndex = (activeAnalysis?.video_ids || []).indexOf(video.id)
    return activeVideoInsights.find(item => (
      item.video_url === video.file_url || (analysisIndex >= 0 && item.video_index === analysisIndex + 1)
    )) || null
  }, [activeAnalysis?.video_ids, activeVideoInsights])

  const filteredVideos = useMemo(() => {
    const query = videoQuery.trim().toLowerCase()
    const rows = videos.filter(video => {
      const name = String(video.source_name || video.file_url || '').toLowerCase()
      const insight = getInsightForVideo(video)
      const searchable = [
        name,
        insight?.summary,
        insight?.hook_type,
        insight?.pacing_type,
        insight?.gameplay,
        ...(insight?.recommendations || []),
      ].join(' ').toLowerCase()
      if (query && !searchable.includes(query)) return false
      if (videoFilter === 'selected') return selectedVideoIds.includes(video.id)
      if (videoFilter === 'analyzed') return Boolean(insight)
      if (videoFilter === 'pending') return !insight
      return true
    })
    return [...rows].sort((a, b) => {
      if (videoSort === 'hook_strength') return Number(getInsightForVideo(b)?.hook_strength || 0) - Number(getInsightForVideo(a)?.hook_strength || 0)
      if (videoSort === 'duration') return Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0)
      if (videoSort === 'name') return String(a.source_name || a.file_url || '').localeCompare(String(b.source_name || b.file_url || ''), 'zh-CN')
      if (videoSort === 'analyzed') return Number(Boolean(getInsightForVideo(b))) - Number(Boolean(getInsightForVideo(a)))
      return 0
    })
  }, [videos, videoQuery, videoFilter, videoSort, selectedVideoIds, getInsightForVideo])
  const activeVideo = videos.find(video => video.id === activeVideoId)
    || selectedVideos[0]
    || filteredVideos[0]
    || videos[0]
    || null
  const activeVideoInsight = getInsightForVideo(activeVideo)
  const materialInsightExpanded = Boolean(activeVideo && expandedMaterialInsightIds.includes(activeVideo.id))

  function updateForm(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function activateAnalysis(analysis) {
    setActiveAnalysis(analysis)
    setForm(prev => ({
      ...prev,
      game_type: analysis.game_type || '',
      target_user: analysis.target_user || '',
      platform: analysis.platform || 'TikTok',
      optimization_goal: analysis.optimization_goal || '',
      model: analysis.model || prev.model || 'gemini-2.5-flash',
    }))
    setSelectedVideoIds(analysis.video_ids || [])
    const planTagIds = analysis.plans?.[0]?.selected_tag_ids || []
    setSelectedTagIds(planTagIds)
    setSelectedBatchPlanIds([])
    setPrimaryTagId(planTagIds[0] || '')
    const firstPlan = analysis.plans?.[0] || null
    setSelectedPlanId(firstPlan?.id || '')
    setPlanDraft(planToDraft(firstPlan))
    setLatestGeneratedPlanIds([])
    setActiveVideoId(analysis.video_ids?.[0] || '')
    setBriefExpanded(false)
    setNotice('')
  }

  async function refreshData() {
    setLoading(true)
    setError('')
    try {
      const [videoData, analysisData] = await Promise.all([
        api.get('/api/viral/videos'),
        api.get('/api/viral/analyses'),
      ])
      setVideos(videoData.videos || [])
      setAnalyses(analysisData.analyses || [])
      if (activeAnalysis?.id) {
        const nextActive = (analysisData.analyses || []).find(item => item.id === activeAnalysis.id)
        if (nextActive) {
          setActiveAnalysis(nextActive)
          if (!selectedPlanId && nextActive.plans?.[0]) {
            setSelectedPlanId(nextActive.plans[0].id)
            setPlanDraft(planToDraft(nextActive.plans[0]))
          }
        } else {
          const fallback = (analysisData.analyses || [])[0]
          if (fallback) activateAnalysis(fallback)
          else clearActiveAnalysis()
        }
      } else if ((analysisData.analyses || [])[0]) {
        activateAnalysis((analysisData.analyses || [])[0])
      }
    } catch (err) {
      setError(displayError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const jobs = files.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      status: 'pending',
      error: '',
    }))
    setUploadJobs(jobs)
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const failures = []
      let autoAnalyzeOk = false
      const results = await runConcurrent(files, async (file, index) => {
        const jobId = jobs[index].id
        setUploadJobs(prev => prev.map(job => (job.id === jobId ? { ...job, status: 'uploading' } : job)))
        try {
          const video = await api.upload('/api/viral/upload', file)
          setUploadJobs(prev => prev.map(job => (job.id === jobId ? { ...job, status: 'done' } : job)))
          return { ok: true, video }
        } catch (err) {
          const message = displayError(err)
          failures.push(`${file.name}：${message}`)
          setUploadJobs(prev => prev.map(job => (job.id === jobId ? { ...job, status: 'failed', error: message } : job)))
          return { ok: false, error: message }
        }
      }, 3)
      const uploaded = results.map(item => item?.video).filter(Boolean)
      if (uploaded.length) {
        const uploadedIds = uploaded.map(item => item.id)
        const nextSelectedIds = uploadedIds.slice(0, MAX_ANALYSIS_VIDEO_COUNT)
        setLastUploadBatch({
          id: `batch-${Date.now()}`,
          video_ids: uploadedIds,
          names: uploaded.map(item => item.source_name || item.file_url),
          created_at: new Date().toISOString(),
        })
        setVideos(prev => [...uploaded, ...prev])
        setSelectedVideoIds(nextSelectedIds)
        setActiveVideoId(uploaded[0].id)
        if (autoAnalyzeUploads) {
          autoAnalyzeOk = await handleAnalyze(nextSelectedIds)
        }
      }
      if (failures.length) {
        setError(`已上传 ${uploaded.length} 个，失败 ${failures.length} 个：${failures.slice(0, 2).join('；')}`)
      } else if (uploaded.length && autoAnalyzeUploads && autoAnalyzeOk) {
        setNotice(uploaded.length > MAX_ANALYSIS_VIDEO_COUNT
          ? `已上传 ${uploaded.length} 个视频，并自动分析前 ${MAX_ANALYSIS_VIDEO_COUNT} 个`
          : `已上传 ${uploaded.length} 个视频，并自动完成爆点分析`)
      } else if (uploaded.length && autoAnalyzeUploads && !autoAnalyzeOk) {
        setNotice(`已上传 ${uploaded.length} 个视频，自动分析未完成，可调整条件后手动分析`)
      } else {
        setNotice(`已上传 ${uploaded.length} 个视频`)
      }
    } finally {
      setUploading(false)
    }
  }

  async function handleAnalyze(videoIdsOverride = null) {
    const targetVideoIds = Array.isArray(videoIdsOverride) ? videoIdsOverride : selectedVideoIds
    if (!targetVideoIds.length) {
      setError('请先选择至少 1 个爆款视频。')
      return false
    }
    if (targetVideoIds.length > MAX_ANALYSIS_VIDEO_COUNT) {
      setError(`单次最多分析 ${MAX_ANALYSIS_VIDEO_COUNT} 个爆款视频，请先减少选择。`)
      return false
    }
    setAnalyzing(true)
    setError('')
    setNotice('')
    const requestId = ++analyzeRequestRef.current
    try {
      const result = await api.post('/api/viral/analyze', {
        ...form,
        video_ids: targetVideoIds,
      }, { timeout: 900_000 })
      if (requestId !== analyzeRequestRef.current) return false
      setActiveAnalysis(result)
      setAnalyses(prev => mergeAnalysisList(prev, result))
      setSelectedTagIds([])
      setSelectedPlanId('')
      setSelectedBatchPlanIds([])
      setPlanDraft(null)
      setLatestGeneratedPlanIds([])
      setNotice('爆点标签已生成并保存')
      return true
    } catch (err) {
      setError(displayError(err))
      return false
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleGeneratePlans() {
    if (!activeAnalysis?.id) return
    const targetAnalysisId = activeAnalysis.id
    const tagIds = selectedTagIds.filter(id => id !== 'summary')
    if (!tagIds.length) {
      setError('请先勾选至少 1 个爆点标签。')
      return
    }
    setPlanning(true)
    setError('')
    setNotice('')
    const requestId = ++planRequestRef.current
    try {
      const beforePlanIds = new Set(plans.map(plan => plan.id))
      const result = await api.post(`/api/viral/analyses/${targetAnalysisId}/plans`, {
        tag_ids: tagIds,
        model: form.model,
        ...scriptConfig,
        primary_tag_id: primaryTagId || tagIds[0] || '',
      }, { timeout: 900_000 })
      setAnalyses(prev => mergeAnalysisList(prev, result))
      if (requestId !== planRequestRef.current || activeAnalysisIdRef.current !== targetAnalysisId) return
      const nextPlans = result.plans || []
      const newPlans = nextPlans.filter(plan => !beforePlanIds.has(plan.id))
      const targetPlan = newPlans[0] || nextPlans[0] || null
      setActiveAnalysis(result)
      setLatestGeneratedPlanIds(newPlans.map(plan => plan.id))
      setSelectedBatchPlanIds(newPlans.map(plan => plan.id))
      setSelectedPlanId(targetPlan?.id || '')
      setPlanDraft(planToDraft(targetPlan))
      setNotice(`已基于 ${tagIds.length} 个爆点生成 ${newPlans.length || nextPlans.length} 个新脚本`)
      focusScriptWorkbench()
    } catch (err) {
      setError(displayError(err))
    } finally {
      setPlanning(false)
    }
  }

  function clearActiveAnalysis() {
    setActiveAnalysis(null)
    setSelectedTagIds([])
    setSelectedBatchPlanIds([])
    setSelectedPlanId('')
    setPlanDraft(null)
    setLatestGeneratedPlanIds([])
  }

  async function handleDeleteAnalysis(analysis, event) {
    event?.stopPropagation()
    if (!analysis?.id) return
    const name = analysis.game_type || '未命名分析'
    if (!window.confirm(`删除「${name}」这条分析记录？\n\n会删除爆点标签和改版方案记录，不会删除素材池视频。`)) return
    setError('')
    setNotice('')
    try {
      await api.delete(`/api/viral/analyses/${analysis.id}`)
      const nextAnalyses = analyses.filter(item => item.id !== analysis.id)
      setAnalyses(nextAnalyses)
      if (activeAnalysis?.id === analysis.id) {
        const nextActive = nextAnalyses[0]
        if (nextActive) activateAnalysis(nextActive)
        else clearActiveAnalysis()
      }
      setNotice('分析记录已删除')
    } catch (err) {
      setError(displayError(err))
    }
  }

  async function handleDeleteVideo(video, event) {
    event?.stopPropagation()
    if (!video?.id) return
    if (!window.confirm(`删除素材「${video.source_name || video.file_url}」？\n\n会从素材池移除；如果没有历史分析引用它，本地文件也会清理。`)) return
    setError('')
    setNotice('')
    try {
      await api.delete(`/api/viral/videos/${video.id}`)
      setVideos(prev => prev.filter(item => item.id !== video.id))
      setSelectedVideoIds(prev => prev.filter(id => id !== video.id))
      setSelectedVideoDeleteIds(prev => prev.filter(id => id !== video.id))
      if (activeVideoId === video.id) setActiveVideoId('')
      setNotice('素材已删除')
    } catch (err) {
      setError(displayError(err))
    }
  }

  function toggleVideoDeleteSelection(videoId) {
    setSelectedVideoDeleteIds(prev => (
      prev.includes(videoId) ? prev.filter(id => id !== videoId) : [...prev, videoId]
    ))
  }

  function toggleAnalysisDeleteSelection(analysisId) {
    setSelectedAnalysisDeleteIds(prev => (
      prev.includes(analysisId) ? prev.filter(id => id !== analysisId) : [...prev, analysisId]
    ))
  }

  function toggleVideoManageMode() {
    const next = !videoManageMode
    setVideoManageMode(next)
    setSelectedVideoDeleteIds([])
    if (next) {
      setAnalysisManageMode(false)
      setSelectedAnalysisDeleteIds([])
    }
  }

  function toggleAnalysisManageMode() {
    const next = !analysisManageMode
    setAnalysisManageMode(next)
    setSelectedAnalysisDeleteIds([])
    if (next) {
      setVideoManageMode(false)
      setSelectedVideoDeleteIds([])
    }
  }

  function toggleAllAnalysisDeleteSelection() {
    if (analyses.length > 0 && selectedAnalysisDeleteIds.length === analyses.length) {
      setSelectedAnalysisDeleteIds([])
      return
    }
    setSelectedAnalysisDeleteIds(analyses.map(item => item.id))
  }

  async function handleDeleteSelectedVideos() {
    if (!selectedVideoDeleteIds.length) return
    if (!window.confirm(`删除选中的 ${selectedVideoDeleteIds.length} 个素材？\n\n会从素材池移除；没有历史分析引用的本地文件也会清理。`)) return
    setError('')
    setNotice('')
    try {
      const result = await api.post('/api/viral/videos/delete', { ids: selectedVideoDeleteIds })
      const deletedIds = result.deleted_ids || []
      setVideos(prev => prev.filter(item => !deletedIds.includes(item.id)))
      setSelectedVideoIds(prev => prev.filter(id => !deletedIds.includes(id)))
      if (activeVideoId && deletedIds.includes(activeVideoId)) setActiveVideoId('')
      setSelectedVideoDeleteIds([])
      setVideoManageMode(false)
      setNotice(`已删除 ${deletedIds.length} 个素材`)
    } catch (err) {
      setError(displayError(err))
    }
  }

  async function handleDeleteSelectedAnalyses() {
    if (!selectedAnalysisDeleteIds.length) return
    if (!window.confirm(`删除选中的 ${selectedAnalysisDeleteIds.length} 条分析记录？\n\n会删除对应爆点标签和改版方案记录，不会删除素材池视频。`)) return
    setError('')
    setNotice('')
    try {
      const result = await api.post('/api/viral/analyses/delete', { ids: selectedAnalysisDeleteIds })
      const deletedIds = result.deleted_ids || []
      const nextAnalyses = analyses.filter(item => !deletedIds.includes(item.id))
      setAnalyses(nextAnalyses)
      setSelectedAnalysisDeleteIds([])
      setAnalysisManageMode(false)
      if (activeAnalysis?.id && deletedIds.includes(activeAnalysis.id)) {
        const nextActive = nextAnalyses[0]
        if (nextActive) activateAnalysis(nextActive)
        else clearActiveAnalysis()
      }
      setNotice(`已删除 ${deletedIds.length} 条分析记录`)
    } catch (err) {
      setError(displayError(err))
    }
  }

  function handlePrimaryAction() {
    void handleAnalyze()
  }

  function toggleVideo(videoId) {
    setSelectedVideoIds(prev => {
      if (prev.includes(videoId)) return prev.filter(id => id !== videoId)
      if (prev.length >= MAX_ANALYSIS_VIDEO_COUNT) {
        setError(`单次最多分析 ${MAX_ANALYSIS_VIDEO_COUNT} 个爆款视频。`)
        return prev
      }
      setError('')
      return [...prev, videoId]
    })
  }

  function selectVideoForAnalysis(videoId) {
    setActiveVideoId(videoId)
    if (videoManageMode) {
      toggleVideoDeleteSelection(videoId)
      return
    }
    setSelectedVideoIds(prev => {
      if (prev.includes(videoId)) return prev
      if (prev.length >= MAX_ANALYSIS_VIDEO_COUNT) {
        setError(`单次最多分析 ${MAX_ANALYSIS_VIDEO_COUNT} 个爆款视频。`)
        return prev
      }
      setError('')
      return [...prev, videoId]
    })
  }

  function toggleTag(tagId) {
    const exists = selectedTagIds.includes(tagId)
    const next = exists ? selectedTagIds.filter(id => id !== tagId) : [...selectedTagIds, tagId].slice(0, 12)
    setSelectedTagIds(next)
    if (exists && primaryTagId === tagId) setPrimaryTagId(next[0] || '')
    if (!exists && !primaryTagId) setPrimaryTagId(tagId)
  }

  function moveSelectedTag(tagId, direction) {
    const index = selectedTagIds.indexOf(tagId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedTagIds.length) return
    const next = [...selectedTagIds]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    setSelectedTagIds(next)
  }

  function toggleTagDetails(tagId) {
    setExpandedTagIds(prev => (
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    ))
  }

  function toggleMaterialInsight(videoId) {
    setExpandedMaterialInsightIds(prev => (
      prev.includes(videoId) ? prev.filter(id => id !== videoId) : [...prev, videoId]
    ))
  }

  function updateScriptConfig(key, value) {
    setScriptConfig(prev => ({ ...prev, [key]: value }))
  }

  function updateSceneApplyConfig(key, value) {
    setSceneApplyConfig(prev => {
      if (key === 'model') {
        const modelRow = videoModels.find(item => item.id === value)
        return {
          ...prev,
          model: value,
          provider: modelRow?.provider || prev.provider || 'jimeng',
          duration: normalizeSceneDurationForModel(prev.duration, modelRow),
        }
      }
      return { ...prev, [key]: value }
    })
  }

  function selectFilteredVideos() {
    const next = filteredVideos.slice(0, MAX_ANALYSIS_VIDEO_COUNT).map(video => video.id)
    setSelectedVideoIds(next)
    if (filteredVideos[0]) setActiveVideoId(filteredVideos[0].id)
    if (filteredVideos.length > MAX_ANALYSIS_VIDEO_COUNT) setNotice(`已选择前 ${MAX_ANALYSIS_VIDEO_COUNT} 个素材，单次分析上限为 ${MAX_ANALYSIS_VIDEO_COUNT} 个。`)
  }

  function previewNextMaterial() {
    if (filteredVideos.length <= 1) return
    const currentIndex = filteredVideos.findIndex(video => video.id === activeVideoId)
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % filteredVideos.length : 0
    setActiveVideoId(filteredVideos[nextIndex].id)
  }

  function handleNextAction() {
    if (videoLimitExceeded) {
      clearVideoSelection()
      return
    }
    if (!selectedVideoIds.length) {
      document.querySelector('.viral-material-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!activeAnalysis?.id || !selectableTags.length) {
      void handleAnalyze()
      return
    }
    if (!selectedTagCount) {
      document.querySelector('.viral-hypothesis-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!plans.length) {
      void handleGeneratePlans()
      return
    }
    focusScriptWorkbench()
  }

  function clearVideoSelection() {
    setSelectedVideoIds([])
  }

  function selectLastUploadBatch() {
    const ids = lastBatchIds.slice(0, MAX_ANALYSIS_VIDEO_COUNT)
    setSelectedVideoIds(ids)
    if (ids[0]) setActiveVideoId(ids[0])
    setError('')
    if (lastBatchIds.length > MAX_ANALYSIS_VIDEO_COUNT) {
      setNotice(`已选择本批前 ${MAX_ANALYSIS_VIDEO_COUNT} 个素材，单次分析上限为 ${MAX_ANALYSIS_VIDEO_COUNT} 个。`)
    } else {
      setNotice(`已选择本批 ${ids.length} 个素材`)
    }
  }

  async function analyzeLastUploadBatch() {
    const ids = lastBatchIds.slice(0, MAX_ANALYSIS_VIDEO_COUNT)
    if (!ids.length) return
    setSelectedVideoIds(ids)
    if (ids[0]) setActiveVideoId(ids[0])
    await handleAnalyze(ids)
  }

  async function copyText(value, message) {
    const text = String(value || '').trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
      setError('')
    } catch (err) {
      setError(displayError(err))
    }
  }

  function focusScriptWorkbench() {
    window.setTimeout(() => {
      document.getElementById('viral-script-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  function buildCurrentPlanText() {
    if (!effectivePlanDraft) return ''
    const blocks = [
      `方案：${effectivePlanDraft.title || '未命名方案'}`,
      `主爆点：${primaryTag?.label || '未设置'}`,
      `投放上下文：${form.game_type || '未填'} / ${form.platform || '平台未填'} / ${form.target_user || '目标用户未填'}`,
      `生成策略：${scriptConfig.plan_count} 个方案 / ${scriptConfig.style} / ${scriptConfig.target_duration} / ${scriptConfig.cta_strength}`,
      `测试目的：${effectivePlanDraft.test_objective || '待补充'}`,
      `改动点：\n${effectivePlanDraft.change_points_text || '待补充'}`,
      `脚本大纲：\n${effectivePlanDraft.script_outline_text || '待补充'}`,
      `分镜节奏：\n${effectivePlanDraft.storyboard_rhythm_text || '待补充'}`,
      `视频提示词：\n${effectivePlanDraft.video_prompt || '待补充'}`,
    ]
    return blocks.join('\n\n')
  }

  function buildSceneFromPlan(existingScene = null, sceneId = '', planInput = null) {
    const draft = planInput || effectivePlanDraft
    const prompt = (draft?.video_prompt || '').trim()
    const modelRow = videoModels.find(item => item.id === sceneApplyConfig.model) || videoModels[0] || getFallbackTextToVideoModel()
    const baseScene = existingScene && typeof existingScene === 'object' ? existingScene : {}
    const previousVideoHistory = Array.isArray(baseScene.videoHistory) ? baseScene.videoHistory : []
    const archivedVideoHistory = baseScene.videoUrl
      ? [{ url: baseScene.videoUrl, archivedAt: new Date().toISOString(), prompt: baseScene.prompt || '' }, ...previousVideoHistory]
      : previousVideoHistory
    return {
      id: sceneId || baseScene.id || uid(),
      idx: Number(baseScene.idx) || 1,
      prompt,
      description: draft?.test_objective || draft?.title || '爆款工作台改版方案',
      aiModel: form.model || baseScene.aiModel || 'gemini-2.5-flash',
      videoMode: 'generate',
      charImages: Array.isArray(baseScene.charImages) ? baseScene.charImages : [],
      sceneImages: Array.isArray(baseScene.sceneImages) ? baseScene.sceneImages : [],
      imageGenHistory: Array.isArray(baseScene.imageGenHistory) ? baseScene.imageGenHistory : [],
      model: sceneApplyConfig.model || modelRow?.id || 'seedance-2.0',
      provider: modelRow?.provider || sceneApplyConfig.provider || 'jimeng',
      duration: Number(sceneApplyConfig.duration) || 5,
      aspectRatio: sceneApplyConfig.aspect_ratio || '9:16',
      status: 'idle',
      taskId: '',
      videoUrl: '',
      error: '',
      videoHistory: archivedVideoHistory,
      startTime: null,
      collapsed: false,
      refVideoUrl: '',
      refVideoDurationSeconds: null,
      advancedRefVideos: [],
      viralPlan: {
        analysis_id: activeAnalysis?.id || '',
        plan_id: draft?.id || effectiveSelectedPlanId || '',
        title: draft?.title || '',
        selected_tag_ids: draft?.selected_tag_ids || selectedTagIds.filter(id => id !== 'summary'),
      },
    }
  }

  function toggleBatchPlan(planId) {
    setSelectedBatchPlanIds(prev => (
      prev.includes(planId) ? prev.filter(id => id !== planId) : [...prev, planId]
    ))
  }

  function selectAllPlansForBatch() {
    const selectableIds = plans.filter(plan => String(plan.video_prompt || '').trim()).map(plan => plan.id)
    setSelectedBatchPlanIds(prev => (
      selectableIds.length > 0 && selectableIds.every(id => prev.includes(id)) ? [] : selectableIds
    ))
  }

  async function applyBatchPlansToProject({ generateNow = false } = {}) {
    setSceneApplyMessage('')
    setSceneApplyError('')
    if (!sceneApplyConfig.project_id) {
      setSceneApplyError('请先选择一个游戏项目。')
      return
    }
    if (!targetProject?.id) {
      setSceneApplyError('目标项目不存在，请刷新项目列表后重试。')
      return
    }
    if (selectedBatchHasUnsavedDraft) {
      setSceneApplyError('当前勾选的脚本有未保存修改。请先点“保存脚本”，再批量应用，避免用旧提示词生成。')
      return
    }
    const runnablePlans = selectedBatchPlans.filter(plan => String(plan.video_prompt || '').trim())
    if (!runnablePlans.length) {
      setSceneApplyError('请先勾选至少 1 个有视频提示词的脚本方案。')
      return
    }
    const modelRow = videoModels.find(item => item.id === sceneApplyConfig.model) || videoModels[0] || getFallbackTextToVideoModel()
    if (!isTextToVideoModel(modelRow)) {
      setSceneApplyError('当前视频模型需要参考图/参考视频，不适合从爆款脚本直接批量生成。请换成文生视频模型。')
      return
    }
    const projectName = targetProject?.name || '选中项目'
    const modelName = modelRow?.name || sceneApplyConfig.model
    const actionText = generateNow ? `新增 ${runnablePlans.length} 个场景并立即发起 ${runnablePlans.length} 个视频生成任务` : `新增 ${runnablePlans.length} 个项目场景`
    const costText = generateNow ? '\n\n这会消耗对应的视频生成额度。' : ''
    const ok = window.confirm(`确认要把已勾选脚本批量写入「${projectName}」吗？\n\n操作：${actionText}\n模型：${modelName}\n比例：${sceneApplyConfig.aspect_ratio}\n时长：${sceneApplyConfig.duration}s${costText}\n\n批量操作只会新增场景，不会覆盖已有场景。`)
    if (!ok) return
    setApplyingScene(true)
    try {
      const preparedScenes = runnablePlans.map(plan => ({
        ...buildSceneFromPlan(null, uid(), planToDraft(plan)),
      }))
      const appendedResult = await api.post(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/append`, {
        scenes: preparedScenes,
      })
      const newScenes = Array.isArray(appendedResult?.appended) ? appendedResult.appended : preparedScenes
      let nextScenesPayload = normalizeScenePayload(appendedResult?.scenes)
      const failures = []
      let taskCount = 0
      if (generateNow) {
        const generatedScenes = []
        for (const scene of newScenes) {
          try {
            const result = await api.post('/api/game/generate_video', {
              project_id: sceneApplyConfig.project_id,
              prompt: scene.prompt,
              provider: modelRow?.provider || scene.provider || 'jimeng',
              model: scene.model,
              duration: scene.duration,
              aspect_ratio: scene.aspectRatio,
              character_refs: [],
              scene_refs: [],
              reference_video_url: '',
              advanced_reference_videos: [],
            })
            if (!result?.task_id) throw new Error('生成接口没有返回任务号')
            taskCount += 1
            const submittedScene = { ...scene, provider: modelRow?.provider || scene.provider, taskId: result.task_id, status: 'processing', startTime: Date.now(), error: '', videoUrl: '' }
            generatedScenes.push(submittedScene)
            try {
              const patchResult = await api.patch(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/${scene.id}`, {
                scene: submittedScene,
              })
              nextScenesPayload = normalizeScenePayload(patchResult?.scenes)
            } catch (saveErr) {
              failures.push(`${scene.viralPlan?.title || scene.description || '未命名方案'}：任务已发起，但写回项目失败：${displayError(saveErr)}`)
            }
          } catch (err) {
            failures.push(`${scene.viralPlan?.title || scene.description || '未命名方案'}：${displayError(err)}`)
            const failedScene = { ...scene, status: 'failed', error: displayError(err), videoUrl: '' }
            generatedScenes.push(failedScene)
            try {
              const patchResult = await api.patch(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/${scene.id}`, {
                scene: failedScene,
              })
              nextScenesPayload = normalizeScenePayload(patchResult?.scenes)
            } catch (saveErr) {
              failures.push(`${scene.viralPlan?.title || scene.description || '未命名方案'}：失败状态写回项目失败：${displayError(saveErr)}`)
            }
          }
        }
        const byId = new Map(generatedScenes.map(scene => [scene.id, scene]))
        nextScenesPayload = {
          ...nextScenesPayload,
          generate: nextScenesPayload.generate.map(scene => byId.get(scene.id) || scene),
        }
      }
      setProjectScenes(nextScenesPayload)
      setSceneApplyConfig(prev => ({ ...prev, mode: 'append', scene_id: newScenes[0]?.id || prev.scene_id }))
      setSelectedBatchPlanIds([])
      setSceneApplyMessage(generateNow
        ? `已新增 ${newScenes.length} 个场景，发起 ${taskCount} 个生成任务${failures.length ? `，失败 ${failures.length} 个：${failures.slice(0, 2).join('；')}` : ''}`
        : `已将 ${newScenes.length} 个脚本方案新增到「${projectName}」`)
      if (failures.length) setSceneApplyError(failures.slice(0, 3).join('；'))
    } catch (err) {
      setSceneApplyError(displayError(err))
    } finally {
      setApplyingScene(false)
    }
  }

  async function applyPlanToProjectScene({ generateNow = false } = {}) {
    setSceneApplyMessage('')
    setSceneApplyError('')
    if (!effectivePlanDraft?.video_prompt?.trim()) {
      setSceneApplyError('请先填写视频提示词，再应用到项目场景。')
      return
    }
    if (!sceneApplyConfig.project_id) {
      setSceneApplyError('请先选择一个游戏项目。')
      return
    }
    if (!targetProject?.id) {
      setSceneApplyError('目标项目不存在，请刷新项目列表后重试。')
      return
    }
    const modelRowForApply = videoModels.find(item => item.id === sceneApplyConfig.model) || videoModels[0] || getFallbackTextToVideoModel()
    if (!isTextToVideoModel(modelRowForApply)) {
      setSceneApplyError('当前视频模型需要参考图/参考视频，不适合从爆款脚本直接生成。请换成文生视频模型。')
      return
    }
    if (sceneApplyConfig.mode === 'overwrite' && !sceneApplyConfig.scene_id) {
      setSceneApplyError('请选择要覆盖的项目场景。')
      return
    }
    if (sceneApplyConfig.mode === 'overwrite') {
      const status = String(targetScene?.status || '').toLowerCase()
      if (targetScene?.taskId && ['processing', 'generating'].includes(status)) {
        setSceneApplyError('选中的场景正在生成中，不能覆盖。请等任务完成或改为新增场景。')
        return
      }
      if (targetScene?.videoUrl) {
        const ok = window.confirm('覆盖这个场景会清空当前展示的视频结果，并把旧视频放入历史记录。确认覆盖？')
        if (!ok) return
      }
    }
    setApplyingScene(true)
    try {
      let nextScene = null
      let nextScenesPayload = normalizeScenePayload(projectScenes)
      if (sceneApplyConfig.mode === 'overwrite') {
        nextScene = buildSceneFromPlan(targetScene, sceneApplyConfig.scene_id)
        const patchResult = await api.patch(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/${sceneApplyConfig.scene_id}`, {
          scene: nextScene,
        })
        nextScenesPayload = normalizeScenePayload(patchResult?.scenes)
        nextScene = patchResult?.scene || nextScene
      } else {
        nextScene = buildSceneFromPlan(null, uid())
        const appendResult = await api.post(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/append`, {
          scenes: [nextScene],
        })
        nextScenesPayload = normalizeScenePayload(appendResult?.scenes)
        nextScene = Array.isArray(appendResult?.appended) && appendResult.appended[0] ? appendResult.appended[0] : nextScene
      }
      if (!nextScene) throw new Error('没有找到可应用的场景')
      let message = sceneApplyConfig.mode === 'overwrite'
        ? `已覆盖「${targetScene?.description || targetScene?.prompt?.slice(0, 16) || '选中场景'}」的提示词和参数`
        : `已新增到「${targetProject?.name || '选中项目'}」的场景列表`
      if (generateNow) {
        const modelRow = videoModels.find(item => item.id === nextScene.model) || videoModels[0] || getFallbackTextToVideoModel()
        const result = await api.post('/api/game/generate_video', {
          project_id: sceneApplyConfig.project_id,
          prompt: nextScene.prompt,
          provider: modelRow?.provider || nextScene.provider || 'jimeng',
          model: nextScene.model,
          duration: nextScene.duration,
          aspect_ratio: nextScene.aspectRatio,
          character_refs: [],
          scene_refs: [],
          reference_video_url: '',
          advanced_reference_videos: [],
        })
        if (result?.task_id) {
          const patchResult = await api.patch(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/${nextScene.id}`, {
            scene: { provider: modelRow?.provider || nextScene.provider, taskId: result.task_id, status: 'processing', startTime: Date.now(), error: '', videoUrl: '' },
          })
          nextScenesPayload = normalizeScenePayload(patchResult?.scenes)
          message = `${message}，已开始生成视频`
        } else {
          throw new Error('生成接口没有返回任务号')
        }
      }
      setProjectScenes(nextScenesPayload)
      setSceneApplyConfig(prev => ({ ...prev, scene_id: nextScene.id }))
      setSceneApplyMessage(message)
    } catch (err) {
      setSceneApplyError(displayError(err))
    } finally {
      setApplyingScene(false)
    }
  }

  async function regenerateTargetScene() {
    setSceneApplyMessage('')
    setSceneApplyError('')
    if (!targetScene?.id) {
      setSceneApplyError('请先选择一个已应用的项目场景。')
      return
    }
    if (!sceneApplyConfig.project_id) {
      setSceneApplyError('请先选择目标项目。')
      return
    }
    const prompt = targetScene.prompt || effectivePlanDraft?.video_prompt || ''
    if (!prompt.trim()) {
      setSceneApplyError('当前场景没有可生成的视频提示词。')
      return
    }
    setApplyingScene(true)
    try {
      const modelRow = videoModels.find(item => item.id === (targetScene.model || sceneApplyConfig.model)) || videoModels[0] || getFallbackTextToVideoModel()
      if (!isTextToVideoModel(modelRow)) {
        throw new Error('当前视频模型需要参考图/参考视频，不适合从爆款脚本直接重新生成。请换成文生视频模型。')
      }
      const result = await api.post('/api/game/generate_video', {
        project_id: sceneApplyConfig.project_id,
        prompt,
        provider: modelRow?.provider || targetScene.provider || sceneApplyConfig.provider || 'jimeng',
        model: targetScene.model || sceneApplyConfig.model,
        duration: Number(targetScene.duration || sceneApplyConfig.duration) || 5,
        aspect_ratio: targetScene.aspectRatio || sceneApplyConfig.aspect_ratio || '9:16',
        character_refs: [],
        scene_refs: [],
        reference_video_url: '',
        advanced_reference_videos: [],
      })
      if (!result?.task_id) throw new Error('生成接口没有返回任务号')
      const patchResult = await api.patch(`/api/game/projects/${sceneApplyConfig.project_id}/scenes/${targetScene.id}`, {
        scene: { taskId: result.task_id, status: 'processing', startTime: Date.now(), error: '', videoUrl: '' },
      })
      setProjectScenes(normalizeScenePayload(patchResult?.scenes))
      setSceneApplyMessage(`已重新发起生成任务：${result.task_id}`)
    } catch (err) {
      setSceneApplyError(displayError(err))
    } finally {
      setApplyingScene(false)
    }
  }

  function selectPlan(plan) {
    if (currentPlanHasUnsavedChanges && planDraft?.id !== plan.id) {
      const ok = window.confirm('当前脚本有未保存修改。切换方案会放弃这些修改，确认切换？')
      if (!ok) return
    }
    setSelectedPlanId(plan.id)
    setPlanDraft(planToDraft(plan))
    setNotice('')
  }

  function startManualPlan() {
    if (!activeAnalysis?.id) {
      setError('请先完成一次爆款视频分析，再添加手写方案。')
      return
    }
    const draft = makeManualPlanDraft(selectedTagIds)
    setSelectedPlanId(draft.id)
    setPlanDraft(draft)
    setError('')
    setNotice('已创建手写方案草稿，保存后会进入当前分析记录')
    focusScriptWorkbench()
  }

  function updatePlanDraft(key, value) {
    setPlanDraft(prev => ({ ...(prev || effectivePlanDraft || makeManualPlanDraft(selectedTagIds)), [key]: value }))
  }

  function toggleRewriteTarget(target) {
    setRewriteTargets(prev => (
      prev.includes(target)
        ? prev.filter(item => item !== target)
        : [...prev, target]
    ))
  }

  function buildPlanPayload(draft, sourceOverride = '') {
    return {
      id: draft.id,
      source: sourceOverride || draft.source || 'edited',
      selected_tag_ids: draft.selected_tag_ids || selectedTagIds.filter(id => id && id !== 'summary'),
      title: draft.title.trim(),
      change_points: textToList(draft.change_points_text, 8),
      test_objective: draft.test_objective.trim(),
      script_outline: textToList(draft.script_outline_text, 10),
      storyboard_rhythm: textToList(draft.storyboard_rhythm_text, 10),
      video_prompt: draft.video_prompt.trim(),
      user_revision_note: draft.user_revision_note.trim(),
    }
  }

  async function handleRewritePlanFields() {
    const note = effectivePlanDraft?.user_revision_note?.trim()
    if (!note) return
    if (!activeAnalysis?.id || !effectivePlanDraft) return
    const targetAnalysisId = activeAnalysis.id
    const targetPlanId = effectivePlanDraft.id
    if (!rewriteTargets.length) {
      setError('请至少选择一个要 AI 改写的内容。')
      return
    }
    setRewritingPlan(true)
    setError('')
    setNotice('')
    const requestId = ++rewriteRequestRef.current
    try {
      const result = await api.post(`/api/viral/analyses/${targetAnalysisId}/plans/rewrite`, {
        plan: buildPlanPayload(effectivePlanDraft, effectivePlanDraft.source || 'edited'),
        instruction: note,
        targets: rewriteTargets,
        model: rewriteModel || form.model,
      }, { timeout: 900_000 })
      if (requestId !== rewriteRequestRef.current || activeAnalysisIdRef.current !== targetAnalysisId || effectiveSelectedPlanId !== targetPlanId) return
      const rewritten = result.rewritten || {}
      setPlanDraft(prev => ({
        ...(prev || effectivePlanDraft),
        change_points_text: rewritten.change_points ? listToText(rewritten.change_points) : (prev || effectivePlanDraft).change_points_text,
        script_outline_text: rewritten.script_outline ? listToText(rewritten.script_outline) : (prev || effectivePlanDraft).script_outline_text,
        storyboard_rhythm_text: rewritten.storyboard_rhythm ? listToText(rewritten.storyboard_rhythm) : (prev || effectivePlanDraft).storyboard_rhythm_text,
        video_prompt: rewritten.video_prompt ? localizeMarketingTerms(rewritten.video_prompt) : (prev || effectivePlanDraft).video_prompt,
      }))
      const labels = rewriteTargetOptions.filter(item => rewriteTargets.includes(item.value)).map(item => item.label).join('、')
      setNotice(`AI 已按修改要求重写：${labels}`)
    } catch (err) {
      setError(displayError(err))
    } finally {
      setRewritingPlan(false)
    }
  }

  async function handleSavePlanDraft() {
    const draft = effectivePlanDraft
    if (!activeAnalysis?.id || !draft) return
    if (!draft.title.trim()) {
      setError('请先填写方案标题。')
      return
    }
    const payload = buildPlanPayload(draft, draft.source === 'manual' || isManualDraft ? 'manual' : 'edited')
    setSavingPlan(true)
    setError('')
    setNotice('')
    try {
      const result = await api.post(`/api/viral/analyses/${activeAnalysis.id}/plans/save`, { plan: payload })
      setActiveAnalysis(result)
      setAnalyses(prev => mergeAnalysisList(prev, result))
      setSelectedPlanId(payload.id)
      setPlanDraft(planToDraft((result.plans || []).find(plan => plan.id === payload.id) || payload))
      setLatestGeneratedPlanIds(prev => prev.filter(id => id !== payload.id))
      setNotice('方案脚本已保存')
    } catch (err) {
      setError(displayError(err))
    } finally {
      setSavingPlan(false)
    }
  }

  function startNewAnalysis() {
    setActiveAnalysis(null)
    setSelectedTagIds([])
    setPrimaryTagId('')
    setSelectedPlanId('')
    setPlanDraft(null)
    setLatestGeneratedPlanIds([])
    setBriefExpanded(true)
    setNotice('已切换到新分析，可沿用当前条件重新生成爆点标签')
    setError('')
  }

  return (
    <>
    <style>{VIRAL_WORKBENCH_READABLE_STYLE}</style>
    <div className="viral-page viral-creative-page viral-readable">
      <div className="viral-shell viral-creative-shell">
        <ViralWorkbenchHeader
          mainSummary={mainSummary}
          loading={loading}
          statusText={statusLabel(activeAnalysis)}
          statusWarning={Boolean(activeAnalysis?.error)}
          overviewTitle={`${form.game_type || '未命名游戏'} · ${form.platform || '投放平台'}`}
          overviewGoal={form.optimization_goal || '上传爆款素材，提取爆点并生成可编辑改版脚本'}
          stats={overviewStats}
          recentAnalyses={recentAnalyses}
          activeAnalysisId={activeAnalysis?.id || ''}
          analysisManageMode={analysisManageMode}
          workflowSteps={workflowSteps}
          onStartNewAnalysis={startNewAnalysis}
          onRefresh={refreshData}
          onToggleAnalysisManageMode={toggleAnalysisManageMode}
          onActivateAnalysis={activateAnalysis}
          formatAnalysisDate={formatDate}
          getHistoryStatusText={historyStatusText}
        />

        {activeAnalysis?.error && (
          <section className="viral-model-retry">
            <div>
              <strong>当前是备用分析结果</strong>
              <span>模型调用未成功，已用本地兜底补齐爆点和方案；正式投放前建议切换可用模型重跑一次。</span>
            </div>
            <button
              type="button"
              className="viral-button primary compact"
              onClick={() => void handleAnalyze(retryAnalysisIds)}
              disabled={analyzing || !retryAnalysisIds.length}
            >
              {analyzing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              用当前模型重跑
            </button>
          </section>
        )}

        {analysisManageMode && (
          <section className="viral-panel viral-history-manage-panel">
            <PanelTitle icon={History} title="全部历史记录" meta="可批量删除；点击记录可继续编辑" />
            <BulkManageBar
              label="历史管理"
              selectedCount={selectedAnalysisDeleteIds.length}
              totalCount={analyses.length}
              onSelectAll={toggleAllAnalysisDeleteSelection}
              onClear={() => setSelectedAnalysisDeleteIds([])}
              onDelete={handleDeleteSelectedAnalyses}
            />
            <div className="viral-creative-history-list">
              {analyses.length === 0 && <div className="viral-empty">暂无记录</div>}
              {analyses.map(item => {
                const deleteSelected = selectedAnalysisDeleteIds.includes(item.id)
                return (
                  <div key={item.id} className={`viral-history-item ${activeAnalysis?.id === item.id ? 'is-active' : ''} ${deleteSelected ? 'is-bulk-selected' : ''}`}>
                    <button type="button" className="viral-history-open with-check" onClick={() => toggleAnalysisDeleteSelection(item.id)}>
                      <span className="viral-check">{deleteSelected && <Check size={13} />}</span>
                      <span className="viral-history-copy">
                        <strong>{item.game_type || '未命名分析'}</strong>
                        <span>{item.platform || '平台未填'} · {formatDate(item.updated_at)}</span>
                        <em className={historyStatusClass(item)}>{historyStatusText(item)}</em>
                      </span>
                    </button>
                    <div className="viral-history-actions">
                      <button type="button" className="viral-button muted compact" onClick={() => activateAnalysis(item)}>
                        继续
                      </button>
                      <button type="button" className="viral-icon-button danger subtle" title="删除分析记录" onClick={event => handleDeleteAnalysis(item, event)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {(error || notice) && (
          <div className={`viral-alert ${error ? 'is-error' : 'is-success'}`}>
            {error ? <AlertCircle size={16} /> : <Check size={16} />}
            {error || notice}
          </div>
        )}

        <main className="viral-creative-main">
          {shouldShowNextAction && (
            <section className="viral-next-action">
              <div>
                <strong>{nextStep.title}</strong>
                <span>{nextStep.hint}</span>
              </div>
              <button type="button" className="viral-button primary compact" onClick={handleNextAction} disabled={nextStep.disabled}>
                <Sparkles size={15} />
                {nextStep.label}
              </button>
            </section>
          )}

          <div className="viral-production-grid">
            <section className="viral-panel viral-creative-panel viral-material-panel">
              <div className="viral-creative-section-head">
                <div>
                  <strong>素材池</strong>
                  <span>{videos.length} 个已上传，当前选中 {selectedVideoIds.length}/{MAX_ANALYSIS_VIDEO_COUNT} 个；点击素材行加入本次分析。</span>
                </div>
                <div className="viral-creative-actions">
                  <label className="viral-auto-toggle">
                    <input
                      type="checkbox"
                      checked={autoAnalyzeUploads}
                      onChange={event => setAutoAnalyzeUploads(event.target.checked)}
                      disabled={uploading || analyzing}
                    />
                    上传后自动分析
                  </label>
                  <label className={`viral-button muted compact ${uploading ? 'is-disabled' : ''}`}>
                    {uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                    上传
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v" multiple onChange={handleUpload} disabled={uploading} />
                  </label>
                  <button type="button" className="viral-button primary compact" onClick={handlePrimaryAction} disabled={primaryDisabled}>
                    {analyzing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                    {primaryText}
                  </button>
                </div>
              </div>

              <AnalysisBriefStrip
                expanded={shouldShowBriefForm}
                form={form}
                models={models}
                activeModel={activeModel}
                platformOptions={platformOptions}
                onToggleExpanded={() => setBriefExpanded(prev => !prev)}
                onFormChange={updateForm}
              />

              {uploadJobs.length > 0 && (
                <div className="viral-upload-jobs">
                  {uploadJobs.map(job => (
                    <div key={job.id} className={`viral-upload-job is-${job.status}`}>
                      <span>{job.name}</span>
                      <em>{job.status === 'done' ? '完成' : job.status === 'failed' ? job.error || '失败' : job.status === 'uploading' ? '上传中' : '等待'}</em>
                    </div>
                  ))}
                </div>
              )}

              {lastUploadBatch && (
                <div className="viral-upload-batch">
                  <div>
                    <strong>本次上传批次</strong>
                    <span>{lastBatchVideos.length || lastBatchIds.length} 个素材 · 已选 {lastBatchSelectedCount} 个 · {formatDate(lastUploadBatch.created_at)}</span>
                    <em>{(lastUploadBatch.names || []).slice(0, 3).join('、')}{(lastUploadBatch.names || []).length > 3 ? ' 等' : ''}</em>
                  </div>
                  <div className="viral-upload-batch-actions">
                    <button type="button" className="viral-button muted compact" onClick={selectLastUploadBatch} disabled={!lastBatchIds.length || uploading || analyzing}>
                      选择本批
                    </button>
                    <button type="button" className="viral-button primary compact" onClick={() => void analyzeLastUploadBatch()} disabled={!lastBatchIds.length || uploading || analyzing}>
                      {analyzing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      分析本批
                    </button>
                    <button type="button" className="viral-button muted compact" onClick={() => setLastUploadBatch(null)}>
                      清除批次
                    </button>
                  </div>
                </div>
              )}

              <div className="viral-material-tools">
                <label className="viral-tool-input">
                  <Search size={14} />
                  <input value={videoQuery} onChange={event => setVideoQuery(event.target.value)} placeholder="搜索文件名/诊断" />
                </label>
                <label className="viral-tool-select">
                  <Filter size={14} />
                  <select value={videoFilter} onChange={event => setVideoFilter(event.target.value)}>
                    {videoFilterOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <select value={videoSort} onChange={event => setVideoSort(event.target.value)}>
                  {videoSortOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <button type="button" className="viral-button muted compact" onClick={selectFilteredVideos} disabled={!filteredVideos.length}>全选当前</button>
                <button type="button" className="viral-button muted compact" onClick={clearVideoSelection} disabled={!selectedVideoIds.length}>清空</button>
                <button type="button" className={`viral-button muted compact ${videoManageMode ? 'is-active' : ''}`} onClick={toggleVideoManageMode}>
                  {videoManageMode ? '完成' : '管理'}
                </button>
              </div>

              {videoManageMode && (
                <BulkManageBar
                  label="素材管理"
                  selectedCount={selectedVideoDeleteIds.length}
                  totalCount={filteredVideos.length}
                  onSelectAll={() => setSelectedVideoDeleteIds(prev => {
                    const filteredIds = filteredVideos.map(item => item.id)
                    const allSelected = filteredIds.length > 0 && filteredIds.every(id => prev.includes(id))
                    return allSelected
                      ? prev.filter(id => !filteredIds.includes(id))
                      : Array.from(new Set([...prev, ...filteredIds]))
                  })}
                  onClear={() => setSelectedVideoDeleteIds([])}
                  onDelete={handleDeleteSelectedVideos}
                />
              )}

              <div className="viral-material-workspace">
                <div className="viral-material-list-compact">
                  <div className="viral-material-selector-head">
                    <div>
                      <strong>选择素材</strong>
                      <span>{filteredVideos.length} 个素材 · 当前选中 {selectedVideoIds.length} 个</span>
                    </div>
                    {videoManageMode ? (
                      <em>删除模式</em>
                    ) : filteredVideos.length > 1 ? (
                      <button type="button" className="viral-material-preview-next" onClick={previewNextMaterial}>
                        下一个预览
                      </button>
                    ) : null}
                  </div>
                  {!filteredVideos.length && <div className="viral-empty">没有匹配的素材</div>}
                  {filteredVideos.map(video => {
                    const selected = selectedVideoIds.includes(video.id)
                    const deleteSelected = selectedVideoDeleteIds.includes(video.id)
                    const insight = getInsightForVideo(video)
                    return (
                      <button
                        type="button"
                        key={video.id}
                        className={`viral-material-row ${activeVideo?.id === video.id ? 'is-active' : ''} ${selected ? 'is-selected' : ''} ${deleteSelected ? 'is-bulk-selected' : ''}`}
                        onClick={() => selectVideoForAnalysis(video.id)}
                      >
                        <span className="viral-check" onClick={event => {
                          event.stopPropagation()
                          videoManageMode ? toggleVideoDeleteSelection(video.id) : toggleVideo(video.id)
                        }}>{(videoManageMode ? deleteSelected : selected) && <Check size={13} />}</span>
                        <VideoPreview src={video.file_url} compact />
                        <span className="viral-material-row-copy">
                          <strong>{video.source_name || video.file_url}</strong>
                          <span>{formatDuration(video.duration_seconds)} · {insight ? `${insight.hook_type || '已分析'} · 强度 ${insight.hook_strength || 0}/10` : '未分析'}</span>
                          {insight?.pacing_type && <em>{insight.pacing_type}</em>}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <aside className={`viral-material-preview ${materialInsightExpanded ? 'is-expanded' : ''}`}>
                  {activeVideo ? (
                    <>
                      <div className="viral-material-preview-head">
                        <div>
                          <span>素材解析</span>
                          <strong>{activeVideo.source_name || activeVideo.file_url}</strong>
                          <em>{formatDuration(activeVideo.duration_seconds)}</em>
                        </div>
                        <button type="button" className="viral-icon-button danger subtle" title="删除当前素材" onClick={event => handleDeleteVideo(activeVideo, event)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {activeVideoInsight ? (
                        <div className="viral-material-diagnosis">
                          <p>{activeVideoInsight.summary}</p>
                          <button
                            type="button"
                            className="viral-material-expand"
                            onClick={() => toggleMaterialInsight(activeVideo.id)}
                          >
                            {materialInsightExpanded ? '收起完整解析' : '展开完整解析'}
                          </button>
                          <div className="viral-mini-grid viral-material-metrics">
                            <MiniMetric label="钩子" value={activeVideoInsight.hook_type} />
                            <MiniMetric label="强度" value={`${activeVideoInsight.hook_strength || 0}/10`} />
                            <MiniMetric label="节奏" value={activeVideoInsight.pacing_type} />
                            <MiniMetric label="玩法" value={activeVideoInsight.gameplay} />
                          </div>
                          <div className="viral-rec-list">
                            {(activeVideoInsight.recommendations || []).slice(0, 3).map((item, itemIndex) => (
                              <span key={`${activeVideo.id}-rec-${itemIndex}`}>{item}</span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="viral-creative-waiting">选中素材后点击分析，逐条诊断会出现在这里。</div>
                      )}
                      <VideoPreview src={activeVideo.file_url} />
                    </>
                  ) : (
                    <div className="viral-empty large">上传或选择素材后显示预览。</div>
                  )}
                </aside>
              </div>
            </section>

            <section className="viral-panel viral-creative-panel viral-hypothesis-panel">
              <div className="viral-creative-section-head">
                <div>
                  <strong>爆点池</strong>
                  <span>{selectedTagCount ? `已选 ${selectedTagCount}/12 个爆点` : '勾选可测试爆点，生成脚本前可设置主爆点。'}</span>
                </div>
                <select value={tagCategory} onChange={event => setTagCategory(event.target.value)}>
                  {tagCategoryOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>

              <div className={`viral-hypothesis-workspace ${selectedTagCount ? 'has-selection' : ''}`}>
                <aside className="viral-selected-rail">
                  <div className="viral-selected-rail-head">
                    <strong>{selectedTagCount ? `已选 ${selectedTagCount} / 12` : '未选择爆点'}</strong>
                    <span>{primaryTag ? `主爆点：${primaryTag.label}` : '选择后可设主爆点、调整顺序。'}</span>
                  </div>
                  <div className="viral-selected-list">
                    {selectedTags.length ? selectedTags.map((tag, index) => (
                      <div key={tag.id} className={`viral-selected-item ${primaryTagId === tag.id ? 'is-primary' : ''}`}>
                        <div>
                          <strong>{tag.label}</strong>
                          <span>{categoryLabels[tag.category] || tag.category || '标签'} · 第 {index + 1} 个</span>
                        </div>
                        <div className="viral-selected-item-actions">
                          <button type="button" onClick={() => setPrimaryTagId(tag.id)} title="设为主爆点">
                            {primaryTagId === tag.id ? <Star size={12} /> : '主'}
                          </button>
                          <button type="button" onClick={() => moveSelectedTag(tag.id, -1)} disabled={index === 0}>上</button>
                          <button type="button" onClick={() => moveSelectedTag(tag.id, 1)} disabled={index === selectedTags.length - 1}>下</button>
                          <button type="button" onClick={() => toggleTag(tag.id)}>移除</button>
                        </div>
                      </div>
                    )) : <div className="viral-empty compact">从右侧爆点卡片中选择。</div>}
                  </div>
                </aside>

                <div className="viral-hypothesis-main">
                  <div className={`viral-hypothesis-basket ${selectedTagCount ? 'has-selection' : ''}`}>
                    <div className="viral-basket-summary">
                      <strong>{selectedTagCount ? '脚本生成设置' : '先选择爆点'}</strong>
                      <span>{primaryTag ? `会围绕「${primaryTag.label}」展开改版脚本。` : '建议先选 1 个主爆点，再搭配 1-2 个辅助爆点。'}</span>
                    </div>
                    <ScriptConfigControls
                      compact
                      scriptConfig={scriptConfig}
                      updateScriptConfig={updateScriptConfig}
                      primaryTag={primaryTag}
                    />
                    <button type="button" className="viral-button primary compact" onClick={handleGeneratePlans} disabled={selectedTagCount === 0 || planning}>
                      {planning ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      生成脚本
                    </button>
                  </div>

                  {summaryTag && (
                    <div className="viral-summary-card">
                      <strong>整体判断</strong>
                      <p>{summaryText}</p>
                    </div>
                  )}
                  {!activeAnalysis && <div className="viral-empty large">先在左侧选择视频并生成爆点标签。</div>}
                  {activeAnalysis?.status === 'failed' && <div className="viral-empty danger">{activeAnalysis.error || '分析失败'}</div>}
                  {activeAnalysis?.status === 'processing' && <div className="viral-empty warning">分析处理中，稍后刷新查看爆点标签。</div>}
                  <div className="viral-creative-module-grid">
                    {visibleTags.map(tag => {
                      const selected = selectedTagIds.includes(tag.id)
                      const expanded = expandedTagIds.includes(tag.id)
                      const blocked = !selected && selectedTagCount >= 12
                      const sourceLabel = tag.source_moments?.[0]
                        || (Array.isArray(tag.source_video_indices) && tag.source_video_indices.length ? `视频 ${tag.source_video_indices.join('、')}` : '')
                        || '证据见下方'
                      const score = Math.round(Number(tag.confidence || 0.78) * 100)
                      return (
                        <div
                          key={tag.id}
                          className={`viral-tag-card viral-creative-module-card viral-hypothesis-card ${selected ? 'is-selected' : ''} ${expanded ? 'is-expanded' : ''} ${blocked ? 'is-disabled' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => !blocked && toggleTag(tag.id)}
                          onKeyDown={event => {
                            if ((event.key === 'Enter' || event.key === ' ') && !blocked) {
                              event.preventDefault()
                              toggleTag(tag.id)
                            }
                          }}
                        >
                          <span className="viral-tag-head">
                            <strong>{tag.label}</strong>
                            <span className="viral-tag-meta">
                              <em>{categoryLabels[tag.category] || tag.category || '标签'}</em>
                              <span className={`viral-tag-checkmark ${selected ? 'is-on' : ''}`}>{selected && <Check size={12} />}</span>
                            </span>
                          </span>
                          <span className="viral-tag-score-row">
                            <em>证据来源：{sourceLabel}</em>
                            <strong>权重 {score}</strong>
                          </span>
                          <span>{tag.evidence}</span>
                          <small>{tag.why_it_works}</small>
                          {expanded && (
                            <div className="viral-tag-details">
                              <p><strong>证据</strong>{tag.evidence || '模型未返回具体证据。'}</p>
                              <p><strong>为什么有效</strong>{tag.why_it_works || '待补充。'}</p>
                              <p><strong>改版用法</strong>{tag.application_note || '待补充。'}</p>
                            </div>
                          )}
                          <div className="viral-tag-card-actions">
                            <button type="button" onClick={event => {
                              event.stopPropagation()
                              if (!blocked) toggleTag(tag.id)
                            }} disabled={blocked}>{selected ? '取消' : '选择'}</button>
                            <button type="button" onClick={event => {
                              event.stopPropagation()
                              toggleTagDetails(tag.id)
                            }}>{expanded ? '收起证据' : '展开证据'}</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section id="viral-script-workbench" className="viral-panel viral-creative-panel viral-script-workbench-panel">
            <div className="viral-creative-section-head">
              <div>
                <div className="viral-script-headline">
                  <strong>脚本工作台</strong>
                  {plans.length > 0 && <em>脚本已可交付</em>}
                </div>
                <span>先对比方案，再编辑脚本、提示词和生产包，适合日常素材迭代。</span>
              </div>
              <div className="viral-creative-actions">
                <button type="button" className="viral-button ghost" onClick={startManualPlan} disabled={!activeAnalysis?.id}>
                  <Plus size={16} />
                  手写方案
                </button>
                <button type="button" className="viral-button primary" onClick={handleGeneratePlans} disabled={selectedTagCount === 0 || planning}>
                  {planning ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  再生成一批
                </button>
              </div>
            </div>

            {activeAnalysis && (
              <div className={`viral-script-toolbar ${latestGeneratedPlanIds.length ? 'has-new' : ''}`}>
                <div>
                  <strong>{latestGeneratedPlanIds.length ? `本次新生成 ${latestGeneratedPlanIds.length} 个脚本` : `当前 ${plans.length} 个方案`}</strong>
                  <span>{selectedTagPreview || '未选爆点'} · {scriptConfig.style} · {scriptConfig.target_duration}</span>
                </div>
              </div>
            )}

            {!plans.length && !effectivePlanDraft ? (
              <div className="viral-empty large">勾选爆点生成方案，或直接添加手写方案。</div>
            ) : (
              <div className="viral-creative-script-workbench">
                {plans.length > 0 && (
                  <div className="viral-script-batch-bar">
                    <div>
                      <strong>批量场景生成</strong>
                      <span>
                        已选 {selectedBatchPlans.length}/{plans.length} 个脚本；会新增到「{targetProject?.name || '未选项目'}」，
                        {activeSceneVideoModel?.name || sceneApplyConfig.model} · {sceneApplyConfig.aspect_ratio} · {sceneApplyConfig.duration}s。
                      </span>
                      {selectedBatchHasUnsavedDraft && <em>当前勾选脚本有未保存修改，请先保存脚本再批量应用。</em>}
                    </div>
                    <div className="viral-script-batch-actions">
                      <button type="button" className="viral-button muted compact" onClick={selectAllPlansForBatch} disabled={!plans.some(plan => String(plan.video_prompt || '').trim()) || applyingScene}>
                        {selectedBatchPlans.length > 0 && selectedBatchPlans.length === plans.filter(plan => String(plan.video_prompt || '').trim()).length ? '取消全选' : '全选脚本'}
                      </button>
                      <button type="button" className="viral-button muted compact" onClick={() => applyBatchPlansToProject({ generateNow: false })} disabled={!selectedBatchPlans.length || !sceneApplyConfig.project_id || applyingScene || planning || rewritingPlan || savingPlan}>
                        {applyingScene ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                        批量应用
                      </button>
                      <button type="button" className="viral-button primary compact" onClick={() => applyBatchPlansToProject({ generateNow: true })} disabled={!selectedBatchPlans.length || !sceneApplyConfig.project_id || applyingScene || planning || rewritingPlan || savingPlan}>
                        {applyingScene ? <Loader2 size={15} className="spin" /> : <Video size={15} />}
                        批量应用并生成
                      </button>
                    </div>
                  </div>
                )}
                <div className="viral-creative-script-list" aria-label="脚本方案列表">
                  {plans.map((plan, index) => {
                    const isLatest = latestGeneratedPlanIds.includes(plan.id)
                    const checked = selectedBatchPlanIds.includes(plan.id)
                    const batchDisabled = !String(plan.video_prompt || '').trim()
                    return (
                      <div
                        key={plan.id}
                        role="button"
                        tabIndex={0}
                        className={`viral-script-card ${effectiveSelectedPlanId === plan.id ? 'is-active' : ''} ${isLatest ? 'is-new' : ''} ${checked ? 'is-batch-selected' : ''}`}
                        onClick={() => selectPlan(plan)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            selectPlan(plan)
                          }
                        }}
                      >
                        <span className="viral-script-card-head">
                          <strong>{String(index + 1).padStart(2, '0')} · {localizeMarketingTerms(plan.title)}</strong>
                          <span className="viral-script-card-badges">
                            <button
                              type="button"
                              className={`viral-script-card-check ${checked ? 'is-checked' : ''}`}
                              title={batchDisabled ? '这个方案没有视频提示词，不能批量生成' : '加入批量生成'}
                              aria-label={batchDisabled ? '这个方案没有视频提示词，不能批量生成' : '加入批量生成'}
                              aria-checked={checked}
                              role="checkbox"
                              disabled={batchDisabled || applyingScene}
                              onClick={event => {
                                event.stopPropagation()
                                toggleBatchPlan(plan.id)
                              }}
                            >
                              <Check size={12} />
                            </button>
                            <em>{isLatest ? '新生成' : (plan.source === 'manual' ? '手写' : (plan.source === 'edited' ? '已改' : 'AI'))}</em>
                          </span>
                        </span>
                        <span>{displayObjectiveText(activeAnalysis, plan.test_objective) || '待补充测试目的'}</span>
                        <small>{plan.batch_label ? `${plan.batch_label} · ` : ''}{localizeMarketingTerms((plan.script_outline || []).slice(0, 2).join(' / ') || '待补充脚本大纲')}</small>
                      </div>
                    )
                  })}
                  {isManualDraft && (
                    <div className="viral-script-card is-active">
                      <span className="viral-script-card-head">
                        <strong>草稿 · {effectivePlanDraft.title || '手写改版方案'}</strong>
                        <em>未保存</em>
                      </span>
                      <span>{effectivePlanDraft.test_objective || '保存后进入当前分析记录'}</span>
                      <small>{effectivePlanDraft.script_outline_text || '可直接输入脚本大纲'}</small>
                    </div>
                  )}
                </div>

                <div className="viral-creative-script-variant">
                  <div className="viral-creative-script-column">
                    <Field label="方案标题">
                      <input value={effectivePlanDraft?.title || ''} onChange={event => updatePlanDraft('title', event.target.value)} placeholder="例：失败反转版 / 收益前置版" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <Field label="测试目的">
                      <textarea value={effectivePlanDraft?.test_objective || ''} onChange={event => updatePlanDraft('test_objective', event.target.value)} rows={3} placeholder="这条脚本主要验证什么指标或假设" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <Field label="改动点（一行一个）">
                      <textarea value={effectivePlanDraft?.change_points_text || ''} onChange={event => updatePlanDraft('change_points_text', event.target.value)} rows={5} placeholder="把失败画面前置&#10;口播换成玩家吐槽&#10;结尾弱行动引导" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <Field label="我的修改语言">
                      <div className="viral-script-note">
                        <textarea value={effectivePlanDraft?.user_revision_note || ''} onChange={event => updatePlanDraft('user_revision_note', event.target.value)} rows={3} placeholder="例：语气更像真实玩家吐槽；不要太像广告；加一句“这谁顶得住”" disabled={!effectivePlanDraft || rewritingPlan} />
                        <div className="viral-rewrite-panel">
                          <span>AI 改写到</span>
                          <div className="viral-rewrite-targets">
                            {rewriteTargetOptions.map(item => (
                              <label key={item.value} className="viral-rewrite-target">
                                <input
                                  type="checkbox"
                                  checked={rewriteTargets.includes(item.value)}
                                  onChange={() => toggleRewriteTarget(item.value)}
                                  disabled={!effectivePlanDraft || rewritingPlan}
                                />
                                {item.label}
                              </label>
                            ))}
                          </div>
                          <label className="viral-rewrite-model">
                            <span>改写模型</span>
                            <select value={rewriteModel} onChange={event => setRewriteModel(event.target.value)} disabled={rewritingPlan}>
                              {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                          <button type="button" className="viral-button primary compact" onClick={handleRewritePlanFields} disabled={!effectivePlanDraft?.user_revision_note?.trim() || !rewriteTargets.length || rewritingPlan}>
                            {rewritingPlan ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                            AI重写所选
                          </button>
                        </div>
                      </div>
                    </Field>
                  </div>

                  <div className="viral-creative-script-column">
                    <Field label="脚本大纲（一行一个）">
                      <textarea value={effectivePlanDraft?.script_outline_text || ''} onChange={event => updatePlanDraft('script_outline_text', event.target.value)} rows={6} placeholder="0-3s：抛出冲突&#10;3-8s：展示关键操作&#10;8-15s：给出结果反馈" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <Field label="分镜节奏（一行一个）">
                      <textarea value={effectivePlanDraft?.storyboard_rhythm_text || ''} onChange={event => updatePlanDraft('storyboard_rhythm_text', event.target.value)} rows={6} placeholder="0-1s：大字钩子 + 游戏画面&#10;1-3s：失败/反问/悬念&#10;3-8s：快切证明" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <Field label="视频提示词">
                      <textarea value={effectivePlanDraft?.video_prompt || ''} onChange={event => updatePlanDraft('video_prompt', event.target.value)} rows={6} placeholder="可直接给后续视频生成使用的完整提示词" disabled={!effectivePlanDraft || rewritingPlan} />
                    </Field>
                    <div className="viral-scene-apply">
                      <div>
                        <strong>应用到项目场景</strong>
                        <span>把当前视频提示词和参数写入游戏项目场景，可新增场景或覆盖现有场景，调整好模型、比例和时长后直接生成。</span>
                      </div>
                      <div className="viral-scene-apply-grid">
                        <label>
                          <span>目标项目</span>
                          <select value={sceneApplyConfig.project_id} onChange={event => updateSceneApplyConfig('project_id', event.target.value)} disabled={applyingScene || !gameProjects.length}>
                            {!gameProjects.length && <option value="">暂无项目</option>}
                            {gameProjects.map(project => <option key={project.id} value={project.id}>{project.name || project.id}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>应用方式</span>
                          <select value={sceneApplyConfig.mode} onChange={event => updateSceneApplyConfig('mode', event.target.value)} disabled={applyingScene}>
                            <option value="append">新增场景</option>
                            <option value="overwrite">覆盖场景</option>
                          </select>
                        </label>
                        {sceneApplyConfig.mode === 'overwrite' && (
                          <label>
                            <span>覆盖到</span>
                            <select value={sceneApplyConfig.scene_id} onChange={event => updateSceneApplyConfig('scene_id', event.target.value)} disabled={applyingScene || !projectScenes.generate.length}>
                              {!projectScenes.generate.length && <option value="">暂无场景</option>}
                              {projectScenes.generate.map((scene, index) => (
                                <option key={scene.id || index} value={scene.id}>{`场景 ${index + 1} · ${(scene.description || scene.prompt || '未命名').slice(0, 24)}`}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          <span>视频模型</span>
                          <select value={sceneApplyConfig.model} onChange={event => updateSceneApplyConfig('model', event.target.value)} disabled={applyingScene}>
                            {videoModels.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
                          </select>
                          {activeSceneVideoModel?.limit_note && <small className="viral-scene-model-note">{activeSceneVideoModel.limit_note}</small>}
                        </label>
                        <label>
                          <span>画面比例</span>
                          <select value={sceneApplyConfig.aspect_ratio} onChange={event => updateSceneApplyConfig('aspect_ratio', event.target.value)} disabled={applyingScene}>
                            {sceneAspectOptions.map(item => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>时长</span>
                          <select value={sceneApplyConfig.duration} onChange={event => updateSceneApplyConfig('duration', Number(event.target.value))} disabled={applyingScene}>
                            {sceneDurationChoices.map(item => <option key={item} value={item}>{item}s</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="viral-scene-action-help">
                        <strong>场景生成</strong>
                        <span>“应用到场景”只写入项目；“应用并生成”会写入后立即发起视频生成任务。</span>
                      </div>
                      <div className="viral-scene-primary-actions">
                        <button type="button" className="viral-button muted compact" onClick={() => applyPlanToProjectScene({ generateNow: false })} disabled={!effectivePlanDraft?.video_prompt?.trim() || !sceneApplyConfig.project_id || applyingScene}>
                          {applyingScene ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                          应用到场景
                        </button>
                        <button type="button" className="viral-button primary compact" onClick={() => applyPlanToProjectScene({ generateNow: true })} disabled={!effectivePlanDraft?.video_prompt?.trim() || !sceneApplyConfig.project_id || applyingScene}>
                          {applyingScene ? <Loader2 size={15} className="spin" /> : <Video size={15} />}
                          应用并生成
                        </button>
                      </div>
                      {(targetScene?.taskId || targetScene?.videoUrl || targetScene?.status === 'failed') && (
                        <div className={`viral-scene-status-card is-${targetScene.videoUrl ? 'completed' : targetScene.status || 'idle'}`}>
                          {targetScene.videoUrl ? (
                            <video src={apiAssetUrl(targetScene.videoUrl)} controls playsInline preload="none" />
                          ) : (
                            <span className="viral-scene-status-icon">
                              {targetScene.status === 'failed' ? <AlertCircle size={17} /> : <Loader2 size={17} className="spin" />}
                            </span>
                          )}
                          <div>
                            <strong>{targetScene.videoUrl ? '生成视频已返回' : targetScene.status === 'failed' ? '视频生成失败' : '视频生成中'}</strong>
                            <span>
                              {targetScene.videoUrl
                                ? '已写回当前项目场景，可继续保存脚本或去视频工作台查看。'
                                : targetScene.status === 'failed'
                                  ? targetScene.error || '任务失败，可调整参数后重新生成。'
                                  : `任务号：${targetScene.taskId}`}
                            </span>
                          </div>
                          <button type="button" className="viral-button muted compact" onClick={() => void regenerateTargetScene()} disabled={applyingScene || !targetScene?.id}>
                            {applyingScene ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                            重新生成
                          </button>
                        </div>
                      )}
                      {(sceneApplyMessage || sceneApplyError) && (
                        <div className={`viral-scene-local-alert ${sceneApplyError ? 'is-error' : 'is-success'}`}>
                          {sceneApplyError || sceneApplyMessage}
                        </div>
                      )}
                    </div>
                    <div className="viral-script-delivery-bar">
                      <span>方案操作</span>
                      <div className="viral-script-secondary-actions">
                        <button type="button" className="viral-button muted compact" onClick={() => copyText(effectivePlanDraft?.script_outline_text, '脚本大纲已复制')} disabled={!effectivePlanDraft?.script_outline_text?.trim()}>
                          <Copy size={15} />
                          复制大纲
                        </button>
                        <button type="button" className="viral-button muted compact" onClick={() => copyText(effectivePlanDraft?.video_prompt, '视频提示词已复制')} disabled={!effectivePlanDraft?.video_prompt?.trim()}>
                          <Copy size={15} />
                          复制提示词
                        </button>
                        <button type="button" className="viral-button muted compact" onClick={() => copyText(buildCurrentPlanText(), '完整方案已复制')} disabled={!effectivePlanDraft}>
                          <Copy size={15} />
                          复制完整方案
                        </button>
                        <button type="button" className="viral-button primary compact" onClick={handleSavePlanDraft} disabled={!effectivePlanDraft || savingPlan || rewritingPlan}>
                          {savingPlan ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                          保存脚本
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
    </>
  )
}
