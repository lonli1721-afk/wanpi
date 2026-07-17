import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../../services/api'
import {
  cloneScene,
  formatProviderVideoCacheError,
  getErrorMessage,
  isProviderVideoCacheError,
  logGamePageError,
  makeScene,
  mediaUrl,
  normalizeScene,
} from './gameVideoPageHelpers'
import {
  AI_MODELS,
  DEFAULT_IMAGE_ASPECT_RATIO,
  REFERENCE_VIDEO_DURATION_LIMIT_SECONDS,
  REVERSE_MODELS,
  TASK_POLL_HIDDEN_INTERVAL_MS,
  TASK_POLL_INTERVAL_MS,
  TASK_POLL_JITTER_MS,
  TASK_POLL_LIMIT,
  VIDEO_RESOLUTION_OPTIONS,
} from './gameVideoConstants'
import { FALLBACK_IMAGE_MODELS } from '../image-toolbox/imageModelFallbacks'
import { filterImageModelsForCurrentUser } from '../image-toolbox/imageModelAccess'
import {
  cleanImageModelLabel,
  getImageQualityIds,
  getReplaceProviderSpec,
  getReplaceReferenceDurationLimits,
  getReplaceVideoBlockReason,
  getReplaceReferenceDurationHint,
  getVideoPricePerSecond,
  getVideoGenerationBlockReasonForModel,
  getVideoReferenceDurationHint,
  normalizeImageQualityForModel,
  VIDEO_GENERATION_MODE_OPTIONS,
  VIDEO_REPLACE_PROVIDER_SPECS,
} from './gameVideoModelUtils'
import { readWorkbenchCache, writeWorkbenchCache } from './workbenchCache'
import { useGameTaskPolling } from './useGameTaskPolling'
import { useFileUploadActions } from './useFileUploadActions'
import { useMediaResourceActions } from './useMediaResourceActions'
import { useProjectActions } from './useProjectActions'
import { useProjectLoader } from './useProjectLoader'
import { useReplaceVideoActions } from './useReplaceVideoActions'
import { useReplaceVideoPanelActions } from './useReplaceVideoPanelActions'
import { useReverseVideoActions } from './useReverseVideoActions'
import { useSceneImageGenerationActions } from './useSceneImageGenerationActions'
import { useSceneMediaActions } from './useSceneMediaActions'
import { useScenePromptActions } from './useScenePromptActions'
import { useSceneVideoHistoryActions } from './useSceneVideoHistoryActions'
import { useSceneVideoGenerationActions } from './useSceneVideoGenerationActions'
import { useStandaloneImageGenerationActions } from './useStandaloneImageGenerationActions'
import { useSceneAutosave } from './useSceneAutosave'
import { useTextInsertionActions } from './useTextInsertionActions'
import { useWorkbenchBootstrap } from './useWorkbenchBootstrap'
import { useWorkbenchTabPersistence } from './useWorkbenchTabPersistence'
import { useWorkbenchTabState } from './useWorkbenchTabState'
import ImageLightbox from './components/ImageLightbox'
import ProjectListPanel from './components/ProjectListPanel'
import GenerateVideoPanel, { GenerateVideoActions } from './components/GenerateVideoPanel'
import GenerationRecordPanel from './components/GenerationRecordPanel'
import ImageGenerationModal from './components/ImageGenerationModal'
import ReplaceVideoPanel from './components/ReplaceVideoPanel'
import ReverseVideoPanel from './components/ReverseVideoPanel'
import SceneVideoCard from './components/SceneVideoCard'
import SettingsPanel from './components/SettingsPanel'
import WorkbenchTabs from './components/WorkbenchTabs'
import {
  ChevronLeft,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'

export default function GameVideoPage() {
  const cachedBootstrapRef = useRef(null)
  if (cachedBootstrapRef.current === null) {
    cachedBootstrapRef.current = readWorkbenchCache() || {}
  }
  const cachedBootstrap = cachedBootstrapRef.current

  const [projects, setProjects] = useState(() => (
    Array.isArray(cachedBootstrap.projects) ? cachedBootstrap.projects : []
  ))
  const [currentProject, setCurrentProject] = useState(null)
  const [models, setModels] = useState([])
  const [imageModels, setImageModels] = useState(() => (
    Array.isArray(cachedBootstrap.imageModels) && cachedBootstrap.imageModels.length
      ? filterImageModelsForCurrentUser(cachedBootstrap.imageModels)
      : filterImageModelsForCurrentUser(FALLBACK_IMAGE_MODELS)
  ))

  const [genScenes, setGenScenes] = useState([])
  const [replScenes, setReplScenes] = useState([])
  const [replaceBatchItems, setReplaceBatchItems] = useState([])
  const [activeTab, setActiveTab] = useState('generate')
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  const [genModal, setGenModal] = useState(null)
  const [genPrompt, setGenPrompt] = useState('')
  const [genImgModel, setGenImgModel] = useState('')
  const [genImgProvider, setGenImgProvider] = useState('')
  const [generatingImg, setGeneratingImg] = useState(false)
  const [genRefImages, setGenRefImages] = useState([])
  const [genImageEditMode, setGenImageEditMode] = useState(false)
  const [genImageAspectRatio, setGenImageAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO)
  const [genImageQuality, setGenImageQuality] = useState('2K')

  const [showSettings, setShowSettings] = useState(false)
  const [gameSettings, setGameSettings] = useState(() => (
    cachedBootstrap.gameSettings && typeof cachedBootstrap.gameSettings === 'object'
      ? cachedBootstrap.gameSettings
      : {}
  ))
  const [settingInputs, setSettingInputs] = useState({})
  const [savingKey, setSavingKey] = useState('')
  const [showKeys, setShowKeys] = useState({})

  const [imgGenLoading, setImgGenLoading] = useState(false)
  const [imgGenRefreshing, setImgGenRefreshing] = useState(false)
  const [reverseLoading, setReverseLoading] = useState(false)
  const [retryingResultCacheTaskIds, setRetryingResultCacheTaskIds] = useState(() => new Set())
  const retryingResultCacheTaskIdsRef = useRef(new Set())

  const [renamingProjectId, setRenamingProjectId] = useState(null)
  const [renamingProjectName, setRenamingProjectName] = useState('')
  const [imageLightboxUrl, setImageLightboxUrl] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const scenes = genScenes

  const imageModelsRef = useRef(imageModels)
  useEffect(() => { imageModelsRef.current = imageModels }, [imageModels])

  const {
    tabState,
    tabStateRef,
    applyTabState,
    replaceVideo,
    standaloneImage,
    videoReverse,
    replaceVideoSetters,
    standaloneImageSetters,
    videoReverseSetters,
  } = useWorkbenchTabState({
    imageModelsRef,
  })
  const {
    replHistory, replCharImage, replRefVideo, replRefVideoDurationSeconds, replPrompt, replProvider, replWanMode, replWanCheckImage, replVideoResolution, replVideoUrl, replTaskId, replStatus, replError, replStartTime,
  } = replaceVideo
  const {
    setReplHistory, setReplCharImage, setReplRefVideo, setReplRefVideoDurationSeconds, setReplPrompt, setReplProvider, setReplWanMode, setReplWanCheckImage, setReplVideoResolution, setReplVideoUrl, setReplTaskId, setReplStatus, setReplError, setReplStartTime,
  } = replaceVideoSetters
  const {
    imgGenHistory, imgGenPrompt, imgGenPromptModel, imgGenModel, imgGenProvider, imgGenRefImages, imgGenEditMode, imgGenAspectRatio, imgGenQuality,
  } = standaloneImage
  const {
    setImgGenHistory, setImgGenPrompt, setImgGenPromptModel, setImgGenModel, setImgGenProvider, setImgGenRefImages, setImgGenEditMode, setImgGenAspectRatio, setImgGenQuality,
  } = standaloneImageSetters
  const {
    reverseHistory, reverseVideoUrl, reverseVideoDurationSeconds, reverseModel, reverseResult,
  } = videoReverse
  const {
    setReverseHistory, setReverseVideoUrl, setReverseVideoDurationSeconds, setReverseModel, setReverseResult,
  } = videoReverseSetters

  // Initial bootstrap should run once on first mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProjects(); loadModels(); loadImageModels(); loadGameSettings() }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setImageLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const hasRunningSceneTask = genScenes.some(scene => scene.status === 'processing' || scene.status === 'generating')
    const hasRunningReplaceTask = replStatus === 'processing'
    if (!hasRunningSceneTask && !hasRunningReplaceTask) return undefined

    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [genScenes, replStatus])

  const openImageLightbox = useCallback((relPath) => {
    if (!relPath) return
    setImageLightboxUrl(mediaUrl(relPath))
  }, [])

  const markResultCacheRetrying = useCallback((taskId) => {
    if (!taskId || retryingResultCacheTaskIdsRef.current.has(taskId)) return false
    const next = new Set(retryingResultCacheTaskIdsRef.current)
    next.add(taskId)
    retryingResultCacheTaskIdsRef.current = next
    setRetryingResultCacheTaskIds(next)
    return true
  }, [])

  const unmarkResultCacheRetrying = useCallback((taskId) => {
    if (!taskId || !retryingResultCacheTaskIdsRef.current.has(taskId)) return
    const next = new Set(retryingResultCacheTaskIdsRef.current)
    next.delete(taskId)
    retryingResultCacheTaskIdsRef.current = next
    setRetryingResultCacheTaskIds(next)
  }, [])

  const imageLightboxOverlay = (
    <ImageLightbox
      imageUrl={imageLightboxUrl}
      onClose={() => setImageLightboxUrl(null)}
    />
  )
  const { registerTaskPolling, clearAllTaskPolling } = useGameTaskPolling({
    intervalMs: TASK_POLL_INTERVAL_MS,
    hiddenIntervalMs: TASK_POLL_HIDDEN_INTERVAL_MS,
    jitterMs: TASK_POLL_JITTER_MS,
    pollLimit: TASK_POLL_LIMIT,
    onPollingError: (error) => {
      logGamePageError('pollActiveTasks', error)
    },
  })
  const {
    normalizeDurationSeconds,
    formatDurationSeconds,
    fetchMissingVideoDuration,
    deleteServerFiles,
    deleteServerFilesAfterSave,
    flushQueuedServerFileDeletes,
  } = useMediaResourceActions({ projectId: currentProject?.id })

  const makeInitialScenePair = useCallback((modelsList) => {
    const firstScene = makeScene(1, modelsList)
    return {
      gen: [firstScene],
      repl: [cloneScene(firstScene)],
    }
  }, [])

  const normalizeScenePair = useCallback((rawGenerate, rawReplace, modelsList) => {
    const nextGen = rawGenerate.length > 0
      ? rawGenerate.map((scene, index) => normalizeScene(scene, index + 1, modelsList))
      : makeInitialScenePair(modelsList).gen
    const nextRepl = nextGen.map((genScene, index) => {
      const replScene = rawReplace[index]
      if (!replScene) return cloneScene(genScene)
      return normalizeScene({ ...replScene, id: genScene.id }, index + 1, modelsList)
    })
    return { gen: nextGen, repl: nextRepl }
  }, [makeInitialScenePair])

  const {
    saveStatus,
    saveError,
    loadedProjectRef,
    beginProjectHydration,
    finishProjectHydration,
    runSceneSave,
    runImmediateSceneSave,
  } = useSceneAutosave({
    currentProject,
    genScenes,
    replScenes,
    tabState,
    tabStateRef,
    onSaveSuccess: flushQueuedServerFileDeletes,
  })
  const {
    loadModels,
    loadImageModels,
    loadGameSettings,
    saveGameSetting,
  } = useWorkbenchBootstrap({
    genScenes,
    loadedProjectRef,
    makeInitialScenePair,
    settingInputs,
    setGameSettings,
    setGenImageQuality,
    setGenImgModel,
    setGenImgProvider,
    setImgGenModel,
    setImgGenProvider,
    setImgGenQuality,
    setImageModels,
    setModels,
    setReplScenes,
    setSavingKey,
    setGenScenes,
    setSettingInputs,
  })

  const modelsRef = useRef(models)
  useEffect(() => { modelsRef.current = models }, [models])
  const projectsRef = useRef(projects)
  useEffect(() => { projectsRef.current = projects }, [projects])
  const genScenesRef = useRef(genScenes)
  useEffect(() => { genScenesRef.current = genScenes }, [genScenes])
  const replScenesRef = useRef(replScenes)
  useEffect(() => { replScenesRef.current = replScenes }, [replScenes])
  const replHistoryRef = useRef(replHistory)
  useEffect(() => { replHistoryRef.current = replHistory }, [replHistory])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeWorkbenchCache({ projects, models, imageModels, gameSettings })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [gameSettings, imageModels, models, projects])

  const {
    uploadGameFile,
    uploadFilesWithFeedback,
    uploadSingleFileWithFeedback,
  } = useFileUploadActions({ normalizeDurationSeconds })
  const { insertTextAtCursor } = useTextInsertionActions()
  const {
    persistStandaloneImageState,
    persistReplaceVideoState,
  } = useWorkbenchTabPersistence({
    currentProjectId: currentProject?.id,
    genScenes,
    replScenes,
    genScenesRef,
    replScenesRef,
    runImmediateSceneSave,
    tabStateRef,
  })
  const {
    handleReverseVideo,
    uploadReverseVideo,
    handleClearReverseVideo,
    handleCopyReverseResult,
    handleSelectReverseHistory,
    handleRemoveReverseHistoryItem,
  } = useReverseVideoActions({
    reverseVideoUrl,
    reverseModel,
    reverseResult,
    uploadGameFile,
    setReverseVideoUrl,
    setReverseVideoDurationSeconds,
    setReverseModel,
    setReverseResult,
    setReverseLoading,
    setReverseHistory,
  })

  const preventFocusLoss = (e) => { e.preventDefault() }

  const updateReplaceBatchItem = useCallback((id, updates) => {
    setReplaceBatchItems(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)))
  }, [])

  const getReplaceBatchItem = useCallback((id) => (
    replaceBatchItems.find(item => item.id === id)
  ), [replaceBatchItems])

  const createReplaceBatchItem = useCallback((overrides = {}) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    provider: replProvider,
    charImage: null,
    refVideo: '',
    durationSeconds: null,
    prompt: '',
    videoResolution: replVideoResolution || '720p',
    wanMode: replWanMode || 'wan-std',
    wanCheckImage: replWanCheckImage,
    status: 'idle',
    taskId: '',
    error: '',
    videoUrl: '',
    startTime: null,
    ...overrides,
  }), [replProvider, replVideoResolution, replWanCheckImage, replWanMode])

  const addReplaceBatchItem = useCallback(() => {
    setReplaceBatchItems(prev => {
      const nextSceneNumber = Math.max(1, ...prev.map(item => Number(item.sceneNumber) || 1)) + 1
      return [createReplaceBatchItem({ sceneNumber: nextSceneNumber }), ...prev]
    })
  }, [createReplaceBatchItem])

  const addReplaceBatchReferenceVideos = useCallback(async (files) => {
    const list = Array.from(files || [])
    if (!list.length) return
    const referenceLimits = getReplaceReferenceDurationLimits(replProvider)
    const accepted = []
    for (const file of list) {
      const uploaded = await uploadSingleFileWithFeedback(file, '参考视频上传失败')
      if (!uploaded) continue
      const checked = await validateReferenceVideoUpload(uploaded, {
        label: '参考视频',
        minSeconds: referenceLimits.minSeconds,
        maxSeconds: referenceLimits.maxSeconds,
        providerLabel: getReplaceProviderSpec(replProvider).providerLabel,
      })
      if (!checked) continue
      accepted.push(createReplaceBatchItem({
        name: checked.name || file.name,
        refVideo: checked.url,
        durationSeconds: checked.durationSeconds,
      }))
    }
    if (accepted.length) {
      setReplaceBatchItems(prev => {
        const startSceneNumber = Math.max(1, ...prev.map(item => Number(item.sceneNumber) || 1)) + 1
        const numbered = accepted.map((item, index) => ({
          ...item,
          sceneNumber: startSceneNumber + index,
        }))
        return [...numbered.reverse(), ...prev]
      })
    }
  }, [
    createReplaceBatchItem,
    replProvider,
    uploadSingleFileWithFeedback,
  ])

  const updateReplaceBatchCharacterImage = useCallback(async (id, file) => {
    if (!file) return
    const uploaded = await uploadSingleFileWithFeedback(file, '角色图片上传失败')
    if (!uploaded) return
    updateReplaceBatchItem(id, {
      charImage: uploaded,
      error: '',
      status: 'idle',
      taskId: '',
      videoUrl: '',
      startTime: null,
    })
  }, [
    updateReplaceBatchItem,
    uploadSingleFileWithFeedback,
  ])

  const updateReplaceBatchReferenceVideo = useCallback(async (id, file) => {
    if (!file) return
    const item = getReplaceBatchItem(id)
    const itemProvider = item?.provider || replProvider
    const referenceLimits = getReplaceReferenceDurationLimits(itemProvider)
    const uploaded = await uploadSingleFileWithFeedback(file, '参考视频上传失败')
    if (!uploaded) return
    const checked = await validateReferenceVideoUpload(uploaded, {
      label: '参考视频',
      minSeconds: referenceLimits.minSeconds,
      maxSeconds: referenceLimits.maxSeconds,
      providerLabel: getReplaceProviderSpec(itemProvider).providerLabel,
    })
    if (!checked) return
    updateReplaceBatchItem(id, {
      name: checked.name || file.name,
      refVideo: checked.url,
      durationSeconds: checked.durationSeconds,
      status: 'idle',
      taskId: '',
      error: '',
      videoUrl: '',
      startTime: null,
    })
  }, [
    getReplaceBatchItem,
    replProvider,
    updateReplaceBatchItem,
    uploadSingleFileWithFeedback,
  ])

  const removeReplaceBatchItem = useCallback((id) => {
    setReplaceBatchItems(prev => prev.filter(item => item.id !== id))
  }, [])

  const clearReplaceBatchItems = useCallback(() => {
    setReplaceBatchItems([])
  }, [])

  const runOneReplaceBatchItem = useCallback(async (item) => {
    if (!item?.charImage || !item?.refVideo) return
    const itemProvider = item.provider || replProvider
    const blockReason = getReplaceVideoBlockReason(itemProvider, {
      charImage: item.charImage,
      refVideo: item.refVideo,
      refVideoDurationSeconds: item.durationSeconds,
    }, {
      formatDurationSeconds,
      normalizeDurationSeconds,
    })
    if (blockReason) {
      updateReplaceBatchItem(item.id, { status: 'failed', error: blockReason, taskId: '', startTime: null })
      return
    }
    const startTime = Date.now()
    updateReplaceBatchItem(item.id, { status: 'processing', error: '', taskId: '', startTime })
    try {
      const result = await api.post('/api/game/replace_video', {
        project_id: currentProject?.id || '',
        ref_video_url: item.refVideo,
        character_ref: item.charImage.url,
        prompt: item.prompt || '',
        provider: itemProvider,
        mode: itemProvider === 'wan' ? (item.wanMode || 'wan-std') : '',
        check_image: itemProvider === 'wan' ? !!item.wanCheckImage : false,
        resolution: itemProvider === 'jimeng' ? (item.videoResolution || '720p') : '720p',
      })
      if (result.task_record_warning) alert(result.task_record_warning)
      if (result.task_id) {
        updateReplaceBatchItem(item.id, { taskId: result.task_id, status: 'processing' })
        registerTaskPolling(result.task_id, (upd) => {
          if (upd.status === 'completed' && upd.videoUrl) {
            updateReplaceBatchItem(item.id, { status: 'completed', videoUrl: upd.videoUrl, error: '', taskId: '', startTime: null })
          } else if (upd.status === 'failed') {
            updateReplaceBatchItem(item.id, { status: 'failed', error: formatProviderVideoCacheError(upd.error || '替换失败'), taskId: result.task_id, startTime: null })
          } else if (upd.status === 'completed' && !upd.videoUrl) {
            updateReplaceBatchItem(item.id, { status: 'failed', error: formatProviderVideoCacheError(upd.error || '任务已完成但未返回视频'), taskId: result.task_id, startTime: null })
          }
        })
      }
    } catch (error) {
      updateReplaceBatchItem(item.id, { status: 'failed', error: getErrorMessage(error, '替换失败'), taskId: '', startTime: null })
    }
  }, [
    currentProject?.id,
    formatDurationSeconds,
    normalizeDurationSeconds,
    registerTaskPolling,
    replProvider,
    updateReplaceBatchItem,
  ])

  const runReplaceBatch = useCallback(async () => {
    const runnable = replaceBatchItems.filter(item => item.charImage && item.refVideo && !['processing', 'completed'].includes(item.status))
    if (!runnable.length) {
      alert('请先给新增场景上传角色图片和参考视频')
      return
    }
    await Promise.all(runnable.map(item => runOneReplaceBatchItem(item)))
  }, [replaceBatchItems, runOneReplaceBatchItem])

  const runReplaceBatchItem = useCallback((id) => {
    const item = replaceBatchItems.find(entry => entry.id === id)
    if (!item) return
    if (!item.charImage || !item.refVideo) {
      updateReplaceBatchItem(id, { status: 'failed', error: '请先上传替换角色图片和参考视频' })
      return
    }
    void runOneReplaceBatchItem(item)
  }, [replaceBatchItems, runOneReplaceBatchItem, updateReplaceBatchItem])

  const resumeReplaceTaskPolling = useCallback((replaceVideo) => {
    if (!replaceVideo?.replTaskId) return
    if (replaceVideo.replStatus !== 'processing') return
    registerTaskPolling(replaceVideo.replTaskId, (upd) => {
      if (upd.status === 'completed' && upd.videoUrl) {
        const nextHistory = [{ url: upd.videoUrl, ts: Date.now() }, ...replHistoryRef.current]
        setReplVideoUrl(upd.videoUrl)
        setReplStatus('completed')
        setReplError('')
        setReplTaskId('')
        setReplHistory(nextHistory)
        persistReplaceVideoState({
          replVideoUrl: upd.videoUrl,
          replHistory: nextHistory,
          replStatus: 'completed',
          replError: '',
          replTaskId: '',
        })
      } else if (upd.status === 'failed') {
        const nextError = formatProviderVideoCacheError(upd.error || '替换失败')
        const nextTaskId = isProviderVideoCacheError(nextError) ? (replaceVideo.replTaskId || '') : ''
        setReplError(nextError)
        setReplStatus('failed')
        setReplTaskId(nextTaskId)
        persistReplaceVideoState({
          replStatus: 'failed',
          replError: nextError,
          replTaskId: nextTaskId,
        })
      } else if (upd.status === 'completed' && !upd.videoUrl) {
        const nextError = formatProviderVideoCacheError(upd.error || '任务已完成但未返回视频')
        const nextTaskId = isProviderVideoCacheError(nextError) ? (replaceVideo.replTaskId || '') : ''
        setReplError(nextError)
        setReplStatus('failed')
        setReplTaskId(nextTaskId)
        persistReplaceVideoState({
          replStatus: 'failed',
          replError: nextError,
          replTaskId: nextTaskId,
        })
      }
    })
  }, [
    persistReplaceVideoState,
    registerTaskPolling,
    setReplError,
    setReplHistory,
    setReplStatus,
    setReplTaskId,
    setReplVideoUrl,
  ])

  useEffect(() => {
    if (!currentProject?.id || loadedProjectRef.current !== currentProject.id) return
    if (!imageModels.length) return
    const ids = imageModels.map(m => m.id)
    if (imgGenModel && ids.includes(imgGenModel)) return
    const first = imageModels[0]
    const timer = window.setTimeout(() => {
      setImgGenModel(first.id)
      setImgGenProvider(first.provider || '')
      setImgGenQuality(prev => normalizeImageQualityForModel(prev, first))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    imageModels,
    currentProject?.id,
    imgGenModel,
    loadedProjectRef,
    setImgGenModel,
    setImgGenProvider,
    setImgGenQuality,
  ])

  const updateScene = useCallback((id, updates, { saveImmediately = false } = {}) => {
    const updateList = (list) => (
      list.some(scene => scene.id === id)
        ? list.map(scene => (scene.id === id ? { ...scene, ...updates } : scene))
        : list
    )
    const nextGen = updateList(genScenesRef.current)
    const nextRepl = updateList(replScenesRef.current)
    genScenesRef.current = nextGen
    replScenesRef.current = nextRepl
    setGenScenes(nextGen)
    setReplScenes(nextRepl)
    if (saveImmediately) {
      return runImmediateSceneSave(nextGen, nextRepl, currentProject?.id)
    }
    return Promise.resolve(false)
  }, [currentProject?.id, runImmediateSceneSave])

  const resumeSceneTaskPolling = useCallback((scene) => {
    if (!scene?.taskId) return
    if (!['generating', 'processing'].includes(scene.status)) return
    registerTaskPolling(scene.taskId, (upd) => updateScene(
      scene.id,
      upd,
      { saveImmediately: upd.status === 'completed' || upd.status === 'failed' },
    ))
  }, [registerTaskPolling, updateScene])

  const retrySceneResultCache = useCallback(async (sceneId) => {
    const scene = [...genScenesRef.current, ...replScenesRef.current].find(item => item.id === sceneId)
    const taskId = scene?.taskId
    if (!markResultCacheRetrying(taskId)) return
    const previousError = formatProviderVideoCacheError(scene?.error || '')
    updateScene(sceneId, { status: 'processing', error: '正在重新拉取结果...', startTime: Date.now() }, { saveImmediately: true })

    try {
      const result = await api.post(`/api/game/tasks/${encodeURIComponent(taskId)}/retry-cache`, {})
      const status = String(result?.status || '').toLowerCase()
      const videoUrl = result?.video_url || ''
      if ((status === 'completed' || status === 'succeeded' || status === 'success') && videoUrl) {
        updateScene(sceneId, { status: 'completed', videoUrl, error: '', taskId: '', startTime: null }, { saveImmediately: true })
      } else {
        const nextError = formatProviderVideoCacheError(result?.error || result?.message || '重新拉取结果失败，请稍后重试')
        updateScene(sceneId, { status: 'failed', error: nextError, taskId, startTime: null }, { saveImmediately: true })
      }
    } catch (error) {
      const nextError = getErrorMessage(error, '重新拉取结果失败')
      const retryableError = isProviderVideoCacheError(previousError) && !/不能重新拉取结果|Task not found|404/.test(nextError)
        ? `${previousError}（${nextError}）`
        : nextError
      updateScene(
        sceneId,
        { status: 'failed', error: retryableError, taskId, startTime: null },
        { saveImmediately: true },
      )
    } finally {
      unmarkResultCacheRetrying(taskId)
    }
  }, [markResultCacheRetrying, unmarkResultCacheRetrying, updateScene])

  const retryReplaceResultCache = useCallback(async () => {
    const taskId = replTaskId
    if (!markResultCacheRetrying(taskId)) return
    const previousError = formatProviderVideoCacheError(replError || '')
    const nextStartTime = Date.now()
    setReplStatus('processing')
    setReplError('正在重新拉取结果...')
    setReplStartTime(nextStartTime)
    persistReplaceVideoState({ replStatus: 'processing', replError: '正在重新拉取结果...', replTaskId: taskId, replStartTime: nextStartTime })

    try {
      const result = await api.post(`/api/game/tasks/${encodeURIComponent(taskId)}/retry-cache`, {})
      const status = String(result?.status || '').toLowerCase()
      const videoUrl = result?.video_url || ''
      if ((status === 'completed' || status === 'succeeded' || status === 'success') && videoUrl) {
        const nextHistory = [{ url: videoUrl, ts: Date.now() }, ...replHistoryRef.current]
        setReplVideoUrl(videoUrl)
        setReplStatus('completed')
        setReplError('')
        setReplTaskId('')
        setReplStartTime(null)
        setReplHistory(nextHistory)
        persistReplaceVideoState({
          replVideoUrl: videoUrl,
          replHistory: nextHistory,
          replStatus: 'completed',
          replError: '',
          replTaskId: '',
          replStartTime: null,
        })
      } else {
        const nextError = formatProviderVideoCacheError(result?.error || result?.message || '重新拉取结果失败，请稍后重试')
        setReplError(nextError)
        setReplStatus('failed')
        setReplTaskId(taskId)
        setReplStartTime(null)
        persistReplaceVideoState({ replStatus: 'failed', replError: nextError, replTaskId: taskId, replStartTime: null })
      }
    } catch (error) {
      const rawError = getErrorMessage(error, '重新拉取结果失败')
      const nextError = isProviderVideoCacheError(previousError) && !/不能重新拉取结果|Task not found|404/.test(rawError)
        ? `${previousError}（${rawError}）`
        : rawError
      setReplError(nextError)
      setReplStatus('failed')
      setReplTaskId(taskId)
      setReplStartTime(null)
      persistReplaceVideoState({ replStatus: 'failed', replError: nextError, replTaskId: taskId, replStartTime: null })
    } finally {
      unmarkResultCacheRetrying(taskId)
    }
  }, [
    markResultCacheRetrying,
    persistReplaceVideoState,
    replError,
    replTaskId,
    setReplError,
    setReplHistory,
    setReplStartTime,
    setReplStatus,
    setReplTaskId,
    setReplVideoUrl,
    unmarkResultCacheRetrying,
  ])

  const { openProject } = useProjectLoader({
    clearAllTaskPolling,
    beginProjectHydration,
    finishProjectHydration,
    setCurrentProject,
    setGenScenes,
    setReplScenes,
    modelsRef,
    makeInitialScenePair,
    normalizeScenePair,
    applyTabState,
    resumeSceneTaskPolling,
    resumeReplaceTaskPolling,
  })
  const {
    loadProjects,
    startNewProject,
    cancelNewProject,
    createProject,
    deleteProject,
    startProjectRename,
    cancelProjectRename,
    saveProjectRename,
  } = useProjectActions({
    currentProject,
    projectsRef,
    newProjectName,
    renamingProjectId,
    renamingProjectName,
    setProjects,
    setCurrentProject,
    setNewProjectName,
    setShowNewProject,
    setRenamingProjectId,
    setRenamingProjectName,
    openProject,
  })

  useEffect(() => {
    if (!currentProject) return
    if (activeTab !== 'generate') return
    genScenes.forEach((scene) => {
      if (scene.videoMode === 'reference_video') {
        if (!scene.refVideoUrl || normalizeDurationSeconds(scene.refVideoDurationSeconds) != null) return
        fetchMissingVideoDuration(scene.refVideoUrl, (durationSeconds) => {
          updateScene(scene.id, { refVideoDurationSeconds: durationSeconds })
        })
        return
      }
      if (scene.videoMode === 'advanced_video') {
        const advancedVideos = scene.advancedRefVideos || []
        advancedVideos.forEach((video, index) => {
          if (!video?.url || normalizeDurationSeconds(video.durationSeconds) != null) return
          fetchMissingVideoDuration(video.url, (durationSeconds) => {
            updateScene(scene.id, {
              advancedRefVideos: advancedVideos.map((item, itemIndex) => (
                itemIndex === index ? { ...item, durationSeconds } : item
              )),
            })
          })
        })
      }
    })
  }, [activeTab, currentProject, fetchMissingVideoDuration, genScenes, normalizeDurationSeconds, updateScene])

  useEffect(() => {
    if (!currentProject) return
    if (activeTab !== 'replace') return
    replScenes.forEach((scene) => {
      if (!scene.refVideoUrl || normalizeDurationSeconds(scene.refVideoDurationSeconds) != null) return
      fetchMissingVideoDuration(scene.refVideoUrl, (durationSeconds) => {
        updateScene(scene.id, { refVideoDurationSeconds: durationSeconds })
      })
    })
  }, [activeTab, currentProject, fetchMissingVideoDuration, normalizeDurationSeconds, replScenes, updateScene])

  useEffect(() => {
    if (!currentProject) return
    if (activeTab === 'replace' && replRefVideo && normalizeDurationSeconds(replRefVideoDurationSeconds) == null) {
      fetchMissingVideoDuration(replRefVideo, setReplRefVideoDurationSeconds)
    }
    if (activeTab === 'reverse' && reverseVideoUrl && normalizeDurationSeconds(reverseVideoDurationSeconds) == null) {
      fetchMissingVideoDuration(reverseVideoUrl, setReverseVideoDurationSeconds)
    }
  }, [
    activeTab,
    currentProject,
    fetchMissingVideoDuration,
    normalizeDurationSeconds,
    replRefVideo,
    replRefVideoDurationSeconds,
    reverseVideoDurationSeconds,
    reverseVideoUrl,
    setReplRefVideoDurationSeconds,
    setReverseVideoDurationSeconds,
  ])

  const addScene = () => {
    if (activeTab === 'replace') {
      setReplScenes(prev => {
        const nextIdx = Math.max(0, ...prev.map(scene => Number(scene.idx) || 0)) + 1
        return [makeScene(nextIdx, modelsRef.current), ...prev]
      })
      return
    }
    setGenScenes(prev => {
      const nextIdx = Math.max(0, ...prev.map(scene => Number(scene.idx) || 0)) + 1
      return [makeScene(nextIdx, modelsRef.current), ...prev]
    })
  }
  const removeScene = (id) => {
    setGenScenes(prev => prev.filter(s => s.id !== id))
    setReplScenes(prev => prev.filter(s => s.id !== id))
  }

  const uploadReplaceReferenceVideoToScene = useCallback((sceneId) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*'
    input.onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      const uploaded = await uploadSingleFileWithFeedback(file, '参考视频上传失败')
      if (!uploaded) return
      const referenceLimits = getReplaceReferenceDurationLimits(replProvider)
      const accepted = await validateReferenceVideoUpload(uploaded, {
        label: '参考视频',
        minSeconds: referenceLimits.minSeconds,
        maxSeconds: referenceLimits.maxSeconds,
        providerLabel: getReplaceProviderSpec(replProvider).providerLabel,
      })
      if (!accepted) return
      updateScene(sceneId, {
        refVideoUrl: accepted.url,
        refVideoDurationSeconds: accepted.durationSeconds,
      }, { saveImmediately: true })
    }
    input.click()
  }, [
    replProvider,
    updateScene,
    uploadSingleFileWithFeedback,
  ])

  const getReplaceSceneBlockReason = useCallback((scene) => (
    getReplaceVideoBlockReason(replProvider, {
      charImage: scene?.charImages?.[0] || null,
      refVideo: scene?.refVideoUrl || '',
      refVideoDurationSeconds: scene?.refVideoDurationSeconds,
    }, {
      formatDurationSeconds,
      normalizeDurationSeconds,
    })
  ), [formatDurationSeconds, normalizeDurationSeconds, replProvider])

  const replaceOneScene = useCallback(async (sceneId) => {
    const scene = replScenesRef.current.find(item => item.id === sceneId)
    if (!scene) return
    const blockReason = getReplaceSceneBlockReason(scene)
    if (blockReason) {
      updateScene(sceneId, { status: 'failed', error: blockReason, taskId: '', startTime: null }, { saveImmediately: true })
      return
    }
    const prevHistory = [...(scene.videoHistory || [])]
    if (scene.videoUrl) {
      prevHistory.push({ url: scene.videoUrl, prompt: scene.prompt, model: replProvider, ts: Date.now() })
    }
    updateScene(sceneId, {
      status: 'processing',
      videoUrl: '',
      error: '',
      taskId: '',
      startTime: Date.now(),
      videoHistory: prevHistory,
    }, { saveImmediately: true })
    try {
      const result = await api.post('/api/game/replace_video', {
        project_id: currentProject?.id || '',
        ref_video_url: scene.refVideoUrl,
        character_ref: scene.charImages[0].url,
        prompt: scene.prompt || replPrompt,
        provider: replProvider,
        mode: replProvider === 'wan' ? replWanMode : '',
        check_image: replProvider === 'wan' ? replWanCheckImage : false,
        resolution: replProvider === 'jimeng' ? replVideoResolution : '720p',
      })
      if (result.task_record_warning) alert(result.task_record_warning)
      if (result.task_id) {
        updateScene(sceneId, { provider: replProvider, taskId: result.task_id, status: 'processing' }, { saveImmediately: true })
        registerTaskPolling(result.task_id, (updates) => updateScene(
          sceneId,
          updates,
          { saveImmediately: updates.status === 'completed' || updates.status === 'failed' },
        ))
      }
    } catch (error) {
      updateScene(sceneId, { status: 'failed', error: getErrorMessage(error, '替换失败'), startTime: null }, { saveImmediately: true })
    }
  }, [
    currentProject?.id,
    getReplaceSceneBlockReason,
    registerTaskPolling,
    replPrompt,
    replProvider,
    replScenesRef,
    replVideoResolution,
    replWanCheckImage,
    replWanMode,
    updateScene,
  ])

  const replaceAllScenes = useCallback(async () => {
    const runnable = replScenesRef.current.filter(scene => (
      scene.status !== 'processing'
      && scene.status !== 'generating'
      && scene.status !== 'completed'
      && !getReplaceSceneBlockReason(scene)
    ))
    const skippedCount = replScenesRef.current.filter(scene => getReplaceSceneBlockReason(scene)).length
    if (!runnable.length) {
      alert(skippedCount ? '没有可换人的场景，请检查每个场景是否已上传角色图和参考视频。' : '没有可换人的场景')
      return
    }
    if (skippedCount > 0) {
      alert(`已跳过 ${skippedCount} 个场景：请检查角色图、参考视频或视频时长限制。`)
    }
    await Promise.all(runnable.map(scene => replaceOneScene(scene.id)))
  }, [getReplaceSceneBlockReason, replaceOneScene, replScenesRef])

  function cleanImageModelName(name) {
    return cleanImageModelLabel(name)
  }

  function getFriendlyImageError(error) {
    const raw = error?.message || String(error || '')
    let text = raw
    try {
      const parsed = JSON.parse(raw)
      text = parsed?.detail || parsed?._error || parsed?.message || raw
    } catch (e) {
      void e
    }
    if (/503|UNAVAILABLE|high demand|temporar/i.test(text)) {
      return '模型服务当前繁忙，请稍后重试。'
    }
    if (/504|DEADLINE_EXCEEDED|deadline expired/i.test(text)) {
      return '模型响应超时，请稍后重试。'
    }
    if (/OversizeImage|exceeds the limit|10 MiB|图片.*过大|参考图超过/i.test(text)) {
      return '参考图超过即梦 10 MiB 输入限制。系统会自动压缩本地上传图；如果仍失败，请先把参考图压缩到 10 MiB 以下后重试。'
    }
    return text
  }

  async function postImageGeneration(body) {
    return await api.post('/api/game/generate_image', body)
  }

  async function postPromptRefresh(prompt, model, target = 'video') {
    const body = { project_id: currentProject?.id || '', prompt, model, target, scene_refs: target === 'image' ? imgGenRefImages.map(item => item.url) : [] }
    return await api.post('/api/game/refresh_prompt', body)
  }

  const {
    openGenModal,
    handleGenImage,
    closeGenModal,
    handleGenModalModelChange,
    uploadGenModalReferenceImages,
    removeGenModalReferenceImage,
    addHistoryImageToScene,
    removeHistoryImage,
    insertGenModalRefTag,
  } = useSceneImageGenerationActions({
    currentProjectId: currentProject?.id,
    genScenes,
    replScenes,
    imageModels,
    genModal,
    genPrompt,
    genImgModel,
    genImgProvider,
    genRefImages,
    genImageEditMode,
    genImageAspectRatio,
    genImageQuality,
    setGenModal,
    setGenPrompt,
    setGenImgModel,
    setGenImgProvider,
    setGeneratingImg,
    setGenRefImages,
    setGenImageEditMode,
    setGenImageAspectRatio,
    setGenImageQuality,
    setGenScenes,
    setReplScenes,
    uploadFilesWithFeedback,
    postImageGeneration,
    getFriendlyImageError,
    runSceneSave,
    deleteServerFilesAfterSave,
    insertTextAtCursor,
  })

  const {
    handleRefreshStandaloneImagePrompt,
    removeStandaloneHistoryImage,
    handleStandaloneImageModelChange,
    handleStandaloneImageAspectRatioChange,
    handleStandaloneImageQualityChange,
    handleStandaloneImagePromptModelChange,
    handleStandaloneImageEditModeChange,
    handleStandaloneReferenceImageUpload,
    handleRemoveStandaloneReferenceImage,
    handleCopyStandaloneImageLink,
    handleStandaloneGenImage,
  } = useStandaloneImageGenerationActions({
    currentProjectId: currentProject?.id,
    imageModels,
    imgGenPrompt,
    imgGenPromptModel,
    imgGenModel,
    imgGenProvider,
    imgGenRefImages,
    imgGenEditMode,
    imgGenAspectRatio,
    imgGenQuality,
    imgGenHistory,
    setImgGenPrompt,
    setImgGenPromptModel,
    setImgGenModel,
    setImgGenProvider,
    setImgGenRefImages,
    setImgGenEditMode,
    setImgGenAspectRatio,
    setImgGenQuality,
    setImgGenLoading,
    setImgGenRefreshing,
    setImgGenHistory,
    uploadFilesWithFeedback,
    postImageGeneration,
    postPromptRefresh,
    getFriendlyImageError,
    persistStandaloneImageState,
    deleteServerFilesAfterSave,
  })

  const {
    handleGeneratePrompt,
    handleAnalyze,
    handleRefresh,
  } = useScenePromptActions({
    currentProjectId: currentProject?.id,
    scenes,
    updateScene,
  })

  const {
    replaceBlockReason,
    handleReplaceVideo,
  } = useReplaceVideoActions({
    currentProjectId: currentProject?.id,
    replCharImage,
    replRefVideo,
    replRefVideoDurationSeconds,
    replPrompt,
    replProvider,
    replWanMode,
    replWanCheckImage,
    replVideoResolution,
    setReplStatus,
    setReplError,
    setReplTaskId,
    setReplStartTime,
    persistReplaceVideoState,
    resumeReplaceTaskPolling,
    formatDurationSeconds,
    normalizeDurationSeconds,
  })

  const getSceneGenerationBlockReason = useCallback((scene) => {
    const selectedModel = models.find(item => item.id === scene?.model)
    return getVideoGenerationBlockReasonForModel(selectedModel, scene, {
      formatDurationSeconds,
      normalizeDurationSeconds,
    })
  }, [formatDurationSeconds, models, normalizeDurationSeconds])

  const getReferenceVideoDurationHintText = useCallback((durationSeconds, {
    enforceSeedanceLimit = true,
    minSeconds = null,
    maxSeconds = null,
    label = '参考视频',
    model = null,
  } = {}) => {
    if (model) {
      return getVideoReferenceDurationHint(durationSeconds, model, {
        formatDurationSeconds,
        label,
        normalizeDurationSeconds,
      })
    }
    const normalized = normalizeDurationSeconds(durationSeconds)
    if (normalized == null) return ''
    if (minSeconds != null && normalized < minSeconds) {
      return `检测到真实时长 ${formatDurationSeconds(normalized)}，低于 ${label} ${minSeconds} 秒下限，请换一段更长的视频。`
    }
    if (maxSeconds != null && normalized > maxSeconds) {
      return `检测到真实时长 ${formatDurationSeconds(normalized)}，已超过 ${label} ${maxSeconds} 秒限制，请先裁剪后再提交。`
    }
    if (enforceSeedanceLimit && normalized > REFERENCE_VIDEO_DURATION_LIMIT_SECONDS) {
      return `检测到真实时长 ${formatDurationSeconds(normalized)}，已超过 Seedance 参考视频限制（${REFERENCE_VIDEO_DURATION_LIMIT_SECONDS} 秒）。建议先裁剪后再提交。`
    }
    return `检测到真实时长 ${formatDurationSeconds(normalized)}。若后续仍提示过长，通常是源文件容器元数据或尾帧导致，建议重新裁剪并重新编码导出。`
  }, [formatDurationSeconds, normalizeDurationSeconds])

  const validateReferenceVideoUpload = useCallback(async (uploaded, { label = '参考视频', deleteOnReject = true, minSeconds = null, maxSeconds = REFERENCE_VIDEO_DURATION_LIMIT_SECONDS, providerLabel = 'Seedance' } = {}) => {
    if (!uploaded?.url) return uploaded
    const duration = normalizeDurationSeconds(uploaded.durationSeconds)
    const tooShort = minSeconds != null && duration != null && duration < minSeconds
    const tooLong = maxSeconds != null && duration != null && duration > maxSeconds
    if (duration == null || (!tooShort && !tooLong)) return uploaded
    if (deleteOnReject) {
      await deleteServerFiles(uploaded.url)
    }
    if (tooShort) {
      alert(`${label}真实时长 ${formatDurationSeconds(duration)}，低于 ${providerLabel} ${minSeconds} 秒下限，请换一段更长的视频。`)
    } else {
      alert(`${label}真实时长 ${formatDurationSeconds(duration)}，已超过 ${providerLabel} ${maxSeconds} 秒限制，请先裁剪后再上传。`)
    }
    return null
  }, [deleteServerFiles, formatDurationSeconds, normalizeDurationSeconds])

  const {
    uploadImageToScene,
    removeImageFromScene,
    uploadRefVideoToScene,
    uploadAdvancedVideosToScene,
    removeAdvancedVideoFromScene,
  } = useSceneMediaActions({
    scenes,
    models,
    updateScene,
    setGenScenes,
    setReplScenes,
    uploadGameFile,
    uploadFilesWithFeedback,
    uploadSingleFileWithFeedback,
    validateReferenceVideoUpload,
    deleteServerFilesAfterSave,
  })

  const {
    handleReplaceProviderChange,
    handleClearReplaceCharacterImage,
    handleReplaceCharacterFileSelected,
    handleClearReplaceReferenceVideo,
    handleReplaceReferenceVideoFileSelected,
    handleReplaceResolutionChange,
    handleResetReplaceResult,
    handleSelectReplaceHistory,
    handleRemoveReplaceHistoryItem,
  } = useReplaceVideoPanelActions({
    replProvider,
    replHistoryRef,
    replVideoUrl,
    setReplProvider,
    setReplError,
    setReplCharImage,
    setReplRefVideo,
    setReplRefVideoDurationSeconds,
    setReplVideoResolution,
    setReplVideoUrl,
    setReplStatus,
    setReplTaskId,
    setReplStartTime,
    setReplHistory,
    uploadSingleFileWithFeedback,
    validateReferenceVideoUpload,
    persistReplaceVideoState,
  })

  const {
    generateOneScene,
    generateAll,
  } = useSceneVideoGenerationActions({
    currentProjectId: currentProject?.id,
    scenes,
    models,
    updateScene,
    registerTaskPolling,
    getSceneGenerationBlockReason,
  })
  const {
    selectHistoryVideo,
    removeHistoryVideo,
    removeCurrentVideo,
  } = useSceneVideoHistoryActions({
    currentProjectId: currentProject?.id,
    genScenes,
    replScenes,
    genScenesRef,
    replScenesRef,
    setGenScenes,
    setReplScenes,
    updateScene,
    runImmediateSceneSave,
    deleteServerFilesAfterSave,
  })

  const insertRefTag = (sceneId, type, idx, field = 'prompt') => {
    const label = type === 'character' ? `图片${idx + 1}` : type === 'scene' ? `场景图${idx + 1}` : `视频${idx + 1}`
    const elId = field === 'description' ? `game-description-${sceneId}` : `game-prompt-${sceneId}`
    insertTextAtCursor(elId, label, (value) => updateScene(sceneId, { [field]: value }))
  }

  const downloadAll = () => {
    const done = scenes.filter(s => s.videoUrl)
    if (!done.length) { alert('没有已完成的视频'); return }
    done.forEach((s, i) => {
      setTimeout(() => { const a = document.createElement('a'); a.href = mediaUrl(s.videoUrl); a.download = `场景${s.idx}.mp4`; a.click() }, i * 500)
    })
  }

  const elapsed = (start) => start ? Math.floor((nowMs - start) / 1000) : 0

  const completedCount = scenes.filter(s => s.status === 'completed').length
  const processingCount = scenes.filter(s => s.status === 'processing' || s.status === 'generating').length
  const replaceCompletedCount = replScenes.filter(s => s.status === 'completed').length
  const replaceProcessingCount = replScenes.filter(s => s.status === 'processing' || s.status === 'generating').length
  const recordSourceScenes = activeTab === 'replace' ? replScenes : scenes
  const recordScenes = recordSourceScenes.filter(s => s.videoUrl || s.status !== 'idle' || (s.videoHistory || []).length > 0)

  const estimateCost = (scene) => {
    const m = models.find(m => m.id === scene.model)
    if (!m?.price_per_second) return null
    const pricePerSecond = getVideoPricePerSecond(m, {
      ...scene,
      apiUsageGroup: gameSettings.resolved_api_usage_group || gameSettings.game_api_usage_group || '',
    })
    const outputSeconds = m.id === 'happyhorse-1.0-video-edit'
      ? Math.min(
        Number(m.max_duration || 15),
        normalizeDurationSeconds(scene.refVideoDurationSeconds)
          || normalizeDurationSeconds(scene.advancedRefVideos?.[0]?.durationSeconds)
          || scene.duration,
      )
      : scene.duration
    const inputSeconds = m.price_billing === 'input_output'
      ? (
        normalizeDurationSeconds(scene.refVideoDurationSeconds)
        || normalizeDurationSeconds(scene.advancedRefVideos?.[0]?.durationSeconds)
        || 0
      )
      : 0
    return +(pricePerSecond * (outputSeconds + inputSeconds)).toFixed(2)
  }
  const estimateTotalCost = () => {
    const pending = scenes.filter(s => s.prompt.trim() && s.status !== 'processing' && s.status !== 'generating')
    let total = 0
    for (const s of pending) {
      const c = estimateCost(s)
      if (c != null) total += c
    }
    return total > 0 ? +total.toFixed(2) : null
  }
  const getModelLimitHint = useCallback((model) => {
    if (!model) return ''
    if (model.limit_note) return model.limit_note
    const parts = []
    if (model.min_duration || model.max_duration) {
      const min = model.min_duration || 1
      const max = model.max_duration || ''
      if (max) parts.push(`生成时长 ${min}-${max} 秒`)
    }
    if (model.ref_video_duration_limit) {
      const min = model.ref_video_duration_min
      parts.push(`参考视频 ${min ? `${min}-` : ''}${model.ref_video_duration_limit} 秒以内`)
    } else if (model.supports_ref_video === false) {
      parts.push('不支持参考视频')
    }
    if (model.min_ref_images) parts.push(`至少 ${model.min_ref_images} 张参考图`)
    if (model.max_ref_images) parts.push(`最多 ${model.max_ref_images} 张参考图`)
    if (model.max_ref_videos) parts.push(`最多 ${model.max_ref_videos} 个参考视频`)
    return parts.join('；')
  }, [])
  const replaceProviderSpec = getReplaceProviderSpec(replProvider)
  const replacementDurationHint = getReplaceReferenceDurationHint(replRefVideoDurationSeconds, replProvider, {
    formatDurationSeconds,
    label: `${replaceProviderSpec.providerLabel}参考视频`,
    normalizeDurationSeconds,
  })
  const shouldKeepReplaceTabMounted = activeTab === 'replace'
    || replStatus === 'processing'
    || !!replRefVideo
    || !!replVideoUrl
    || replHistory.length > 0

  // ── Settings Page ──
  if (showSettings) {
    return (
      <SettingsPanel
        gameSettings={gameSettings}
        settingInputs={settingInputs}
        savingKey={savingKey}
        showKeys={showKeys}
        onBack={() => setShowSettings(false)}
        onInputChange={(key, value) => setSettingInputs(prev => ({ ...prev, [key]: value }))}
        onToggleShowKey={(key) => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))}
        onSave={saveGameSetting}
      />
    )
  }

  // ── Project List ──
  if (!currentProject) {
    return (
      <ProjectListPanel
        projects={projects}
        showNewProject={showNewProject}
        newProjectName={newProjectName}
        renamingProjectId={renamingProjectId}
        renamingProjectName={renamingProjectName}
        imageLightboxOverlay={imageLightboxOverlay}
        onOpenSettings={() => setShowSettings(true)}
        onStartNewProject={startNewProject}
        onNewProjectNameChange={setNewProjectName}
        onCreateProject={createProject}
        onCancelNewProject={cancelNewProject}
        onOpenProject={openProject}
        onDeleteProject={deleteProject}
        onStartRenameProject={startProjectRename}
        onRenameProjectNameChange={setRenamingProjectName}
        onSaveProjectRename={saveProjectRename}
        onCancelProjectRename={cancelProjectRename}
      />
    )
  }

  // ── Scene Card (shared between generate and replace) ──
  const renderSceneCard = (scene) => (
    <SceneVideoCard
      key={scene.id}
      scene={{
        ...scene,
        retryingResultCache: !!scene.taskId && retryingResultCacheTaskIds.has(scene.taskId),
      }}
      scenesCount={scenes.length}
      models={models}
      saveStatus={saveStatus}
      saveError={saveError}
      elapsed={elapsed}
      estimateCost={estimateCost}
      formatDurationSeconds={formatDurationSeconds}
      getModelLimitHint={getModelLimitHint}
      getReferenceVideoDurationHintText={getReferenceVideoDurationHintText}
      getSceneGenerationBlockReason={getSceneGenerationBlockReason}
      normalizeDurationSeconds={normalizeDurationSeconds}
      preventFocusLoss={preventFocusLoss}
      onUpdateScene={updateScene}
      onRemoveScene={removeScene}
      onOpenImage={openImageLightbox}
      onOpenGenModal={openGenModal}
      onUploadImage={uploadImageToScene}
      onRemoveImage={removeImageFromScene}
      onAddHistoryImage={addHistoryImageToScene}
      onRemoveHistoryImage={removeHistoryImage}
      onUploadReferenceVideo={uploadRefVideoToScene}
      onUploadAdvancedVideos={uploadAdvancedVideosToScene}
      onRemoveAdvancedVideo={removeAdvancedVideoFromScene}
      onGeneratePrompt={handleGeneratePrompt}
      onAnalyze={handleAnalyze}
      onRefresh={handleRefresh}
      onInsertRefTag={insertRefTag}
      onGenerateVideo={generateOneScene}
      onRetryResultCache={retrySceneResultCache}
      onSelectHistoryVideo={selectHistoryVideo}
      onRemoveHistoryVideo={removeHistoryVideo}
    />
  )

  const renderReplaceSceneCard = (scene) => {
    const blockReason = getReplaceSceneBlockReason(scene)
    const displayError = formatProviderVideoCacheError(scene.error)
    const canRetryResultCache = !!scene.taskId && isProviderVideoCacheError(scene.error)
    const retryingResultCache = canRetryResultCache && retryingResultCacheTaskIds.has(scene.taskId)
    const durationHint = getReplaceReferenceDurationHint(scene.refVideoDurationSeconds, replProvider, {
      formatDurationSeconds,
      label: `${replaceProviderSpec.providerLabel}参考视频`,
      normalizeDurationSeconds,
    })
    const isBusy = scene.status === 'processing' || scene.status === 'generating'

    return (
      <div key={scene.id} style={{
        background: 'var(--bg-secondary)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${scene.status === 'completed' ? '#10b981' : scene.status === 'failed' ? '#ef4444' : isBusy ? 'var(--accent)' : 'var(--border)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 14, color: 'var(--accent)' }}>场景 {scene.idx}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scene.prompt || scene.charImages?.[0]?.name || scene.refVideoUrl || '待配置换人素材'}
          </span>
          {isBusy && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}><Loader2 size={13} className="spin" />处理中 ({elapsed(scene.startTime)}s)</span>}
          {scene.status === 'completed' && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>已完成</span>}
          {scene.status === 'failed' && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>失败</span>}
          {replScenes.length > 1 && <button type="button" onClick={() => removeScene(scene.id)} style={{ background: 'none', color: 'var(--text-muted)', padding: 4 }}><Trash2 size={13} /></button>}
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <User size={12} color="var(--text-muted)" />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>替换角色图</span>
                <button type="button" onClick={() => uploadImageToScene(scene.id, 'character')} style={{ marginLeft: 'auto', background: 'none', color: 'var(--accent)', padding: 2 }}><Plus size={13} /></button>
              </div>
              {scene.charImages?.[0] ? (
                <div role="button" tabIndex={0} onClick={() => openImageLightbox(scene.charImages[0].url)} style={{ position: 'relative', width: 120, cursor: 'pointer' }}>
                  <img src={mediaUrl(scene.charImages[0].url)} alt="" loading="lazy" decoding="async" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, border: '2px solid var(--accent)' }} />
                  <button type="button" onClick={(event) => { event.stopPropagation(); removeImageFromScene(scene.id, 'character', 0) }} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 6, padding: 3, lineHeight: 0 }}><X size={12} /></button>
                </div>
              ) : (
                <button type="button" onClick={() => uploadImageToScene(scene.id, 'character')} style={{ width: 120, height: 120, borderRadius: 10, background: 'var(--bg-primary)', border: '2px dashed rgba(139,92,246,0.3)', color: 'var(--accent)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <User size={24} style={{ opacity: 0.5 }} />
                  <span style={{ fontSize: 11 }}>上传角色</span>
                </button>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <Video size={12} color={scene.refVideoUrl ? '#10b981' : 'var(--text-muted)'} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>参考视频</span>
                <button type="button" onClick={() => uploadReplaceReferenceVideoToScene(scene.id)} style={{ marginLeft: 'auto', background: 'none', color: 'var(--accent)', padding: 2 }}><Upload size={13} /></button>
              </div>
              {scene.refVideoUrl ? (
                <>
                  <div style={{ position: 'relative' }}>
                    <video src={mediaUrl(scene.refVideoUrl)} controls preload="none" style={{ width: '100%', maxHeight: 180, borderRadius: 10, background: '#000', display: 'block' }} />
                    <button type="button" onClick={() => updateScene(scene.id, { refVideoUrl: '', refVideoDurationSeconds: null }, { saveImmediately: true })} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 6, padding: 3, lineHeight: 0 }}><X size={14} /></button>
                  </div>
                  {durationHint && <div style={{ marginTop: 6, fontSize: 11, color: blockReason ? '#ef4444' : '#10b981', lineHeight: 1.6 }}>{durationHint}</div>}
                </>
              ) : (
                <button type="button" onClick={() => uploadReplaceReferenceVideoToScene(scene.id)} style={{ width: '100%', minHeight: 120, borderRadius: 10, background: 'var(--bg-primary)', border: '2px dashed var(--border)', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Upload size={24} style={{ opacity: 0.4 }} />
                  <span style={{ fontSize: 12 }}>上传要替换的原视频</span>
                </button>
              )}

              <textarea
                value={scene.prompt || ''}
                onChange={event => updateScene(scene.id, { prompt: event.target.value })}
                placeholder="可选：补充换人要求，例如保持原视频动作、镜头和背景不变"
                style={{ width: '100%', marginTop: 10, minHeight: 56, padding: 8, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.5, resize: 'vertical' }}
              />
              {displayError && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: '#ef4444' }}>
                  <span>{displayError}</span>
                  {canRetryResultCache && (
                    <button type="button" onClick={() => retrySceneResultCache(scene.id)} disabled={retryingResultCache} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)' }}>
                      {retryingResultCache ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />} 重新拉取结果
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              {scene.videoUrl ? (
                <>
                  <video src={mediaUrl(scene.videoUrl)} controls preload="none" style={{ width: '100%', borderRadius: 10, background: '#000', display: 'block' }} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <a href={mediaUrl(scene.videoUrl)} download={`场景${scene.idx}.mp4`} style={{ flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 700, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', textAlign: 'center', textDecoration: 'none' }}><Download size={11} /> 下载</a>
                    <button type="button" onClick={() => replaceOneScene(scene.id)} disabled={!!blockReason || isBusy} title={blockReason || ''} style={{ flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 700, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', opacity: blockReason ? 0.45 : 1 }}><RefreshCw size={11} /> 重新换人</button>
                  </div>
                </>
              ) : (
                <div style={{ minHeight: 150, borderRadius: 10, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                  <button type="button" onClick={() => replaceOneScene(scene.id)} disabled={!!blockReason || isBusy} title={blockReason || ''} style={{ width: '88%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 10, fontSize: 12, fontWeight: 800, background: !blockReason && !isBusy ? 'var(--accent-gradient)' : 'rgba(124,58,237,0.14)', color: !blockReason && !isBusy ? '#fff' : 'rgba(124,58,237,0.9)', border: !blockReason && !isBusy ? 'none' : '1px solid rgba(124,58,237,0.22)', cursor: !blockReason && !isBusy ? 'pointer' : 'not-allowed' }}>
                    {isBusy ? <Loader2 size={14} className="spin" /> : <Video size={14} />}
                    {isBusy ? `换人中 ${elapsed(scene.startTime)}s` : '开始换人'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Workspace ──
  const selectedStandaloneImageModel = imageModels.find(m => m.id === imgGenModel)
  const standaloneImageQualityIds = getImageQualityIds(selectedStandaloneImageModel)
  const modalScene = genModal ? [...genScenes, ...replScenes].find(s => s.id === genModal.sceneId) : null
  const modalHistory = genModal ? (modalScene?.imageGenHistory || []).filter(h => h.type === genModal.type) : []
  const selectedModalImageModel = imageModels.find(m => m.id === genImgModel)
  const modalImageQualityIds = getImageQualityIds(selectedModalImageModel)

  return (
    <>
    <style>{`
      .game-video-readable [style*="font-size: 7px"] { font-size: 10px !important; }
      .game-video-readable [style*="font-size: 8px"] { font-size: 11px !important; }
      .game-video-readable [style*="font-size: 9px"] { font-size: 11px !important; }
      .game-video-readable [style*="font-size: 10px"] { font-size: 12px !important; }
      .game-video-readable [style*="font-size: 11px"] { font-size: 13px !important; }
      .game-video-readable [style*="font-size: 12px"] { font-size: 13px !important; }
      .game-video-readable select,
      .game-video-readable input,
      .game-video-readable button,
      .game-video-readable a {
        line-height: 1.45 !important;
      }
      .game-video-readable textarea {
        font-size: 15px !important;
        line-height: 1.8 !important;
      }
    `}</style>
    <div className="game-video-readable" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Bar */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '0 16px', flexShrink: 0 }}>
          <button onClick={() => { void runSceneSave(genScenes, replScenes, currentProject?.id); setCurrentProject(null); loadedProjectRef.current = null }} style={{ background: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '8px 4px', marginRight: 8 }}><ChevronLeft size={18} /></button>
	          <span style={{ fontSize: 14, fontWeight: 600, marginRight: 20 }}>{currentProject.name}</span>
	          <WorkbenchTabs activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === 'generate' && (
            <GenerateVideoActions
              processingCount={processingCount}
              completedCount={completedCount}
              estimateTotalCost={estimateTotalCost()}
              onAddScene={addScene}
              onGenerateAll={generateAll}
              onDownloadAll={downloadAll}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {activeTab === 'replace' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowSettings(true)} title="API 设置" style={{ background: 'none', color: 'var(--text-muted)', padding: '6px 8px' }}><Settings size={16} /></button>
            </div>
          )}
          {activeTab === 'reverse' && (
            <button onClick={() => setShowSettings(true)} title="API 设置" style={{ background: 'none', color: 'var(--text-muted)', padding: '6px 8px' }}><Settings size={16} /></button>
          )}
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <ReplaceVideoPanel
            active={activeTab === 'replace'}
            providerSpecs={VIDEO_REPLACE_PROVIDER_SPECS}
            provider={replProvider}
            providerSpec={replaceProviderSpec}
            blockReason={replaceBlockReason}
            durationHint={replacementDurationHint}
            charImage={replCharImage}
            refVideo={replRefVideo}
            prompt={replPrompt}
            videoResolution={replVideoResolution}
            wanMode={replWanMode}
            wanCheckImage={replWanCheckImage}
            status={replStatus}
            error={replError}
            videoUrl={replVideoUrl}
            taskId={replTaskId}
            retryingResultCache={!!replTaskId && retryingResultCacheTaskIds.has(replTaskId)}
            startTime={replStartTime}
            history={replHistory}
            batchItems={replaceBatchItems}
            elapsed={elapsed}
            onProviderChange={handleReplaceProviderChange}
            onOpenImage={openImageLightbox}
            onClearCharacterImage={handleClearReplaceCharacterImage}
            onCharacterFileSelected={handleReplaceCharacterFileSelected}
            onClearReferenceVideo={handleClearReplaceReferenceVideo}
            onReferenceVideoFileSelected={handleReplaceReferenceVideoFileSelected}
            onAddBatchItem={addReplaceBatchItem}
            onBatchItemChange={updateReplaceBatchItem}
            onBatchCharacterFileSelected={updateReplaceBatchCharacterImage}
            onBatchReferenceVideoFileSelected={updateReplaceBatchReferenceVideo}
            onRemoveBatchItem={removeReplaceBatchItem}
            onClearBatchItems={clearReplaceBatchItems}
            onRunBatchItem={runReplaceBatchItem}
            onRunBatch={runReplaceBatch}
            onPromptChange={setReplPrompt}
            onResolutionChange={handleReplaceResolutionChange}
            onWanModeChange={setReplWanMode}
            onWanCheckImageChange={setReplWanCheckImage}
            onRun={handleReplaceVideo}
            onRetryResultCache={() => retrySceneResultCache(replTaskId)}
            onResetResult={handleResetReplaceResult}
            onSelectHistory={handleSelectReplaceHistory}
            onRemoveHistoryItem={handleRemoveReplaceHistoryItem}
          />
          {false && activeTab === 'replace' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ maxWidth: 980, width: '100%', margin: '0 auto', background: 'var(--bg-secondary)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <RefreshCw size={18} color="var(--accent)" />
                  <span style={{ fontSize: 15, fontWeight: 700 }}>视频换人</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>每个场景可单独上传角色图和参考视频，支持多场景一起提交</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  {VIDEO_REPLACE_PROVIDER_SPECS.map(item => (
                    <button key={item.id} onClick={() => handleReplaceProviderChange(item.id)} style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      textAlign: 'left',
                      background: replProvider === item.id ? 'rgba(139,92,246,0.1)' : 'var(--bg-primary)',
                      border: replProvider === item.id ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      cursor: 'pointer',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: replProvider === item.id ? 'var(--accent)' : 'var(--text-primary)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {replScenes.map(scene => renderReplaceSceneCard(scene))}
              <button onClick={addScene} style={{ padding: 14, borderRadius: 14, background: 'none', border: '2px dashed var(--border)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <Plus size={16} /> 添加换人场景
              </button>
            </div>
          )}
          <ReverseVideoPanel
            active={activeTab === 'reverse'}
            videoUrl={reverseVideoUrl}
            durationSeconds={reverseVideoDurationSeconds}
            model={reverseModel}
            models={REVERSE_MODELS}
            result={reverseResult}
            loading={reverseLoading}
            history={reverseHistory}
            formatDurationSeconds={formatDurationSeconds}
            onUploadVideo={uploadReverseVideo}
            onClearVideo={handleClearReverseVideo}
            onModelChange={setReverseModel}
            onAnalyze={handleReverseVideo}
            onResultChange={setReverseResult}
            onCopyResult={handleCopyReverseResult}
            onSelectHistory={handleSelectReverseHistory}
            onRemoveHistoryItem={handleRemoveReverseHistoryItem}
          />
          <GenerateVideoPanel
            active={activeTab === 'generate'}
            scenes={scenes}
            renderSceneCard={renderSceneCard}
            onAddScene={addScene}
          />
        </div>
      </div>

      <GenerationRecordPanel
        recordScenes={recordScenes}
        models={models}
        completedCount={completedCount}
        processingCount={processingCount}
        elapsed={elapsed}
        retryingResultCacheTaskIds={retryingResultCacheTaskIds}
        onRemoveCurrentVideo={removeCurrentVideo}
        onRetryResultCache={retrySceneResultCache}
        onSelectHistoryVideo={selectHistoryVideo}
      />

      <ImageGenerationModal
        modal={genModal}
        scene={modalScene}
        history={modalHistory}
        imageModels={imageModels}
        selectedModel={selectedModalImageModel}
        qualityIds={modalImageQualityIds}
        model={genImgModel}
        aspectRatio={genImageAspectRatio}
        quality={genImageQuality}
        prompt={genPrompt}
        refImages={genRefImages}
        editMode={genImageEditMode}
        loading={generatingImg}
        cleanImageModelName={cleanImageModelName}
        preventFocusLoss={preventFocusLoss}
        onClose={closeGenModal}
        onModelChange={handleGenModalModelChange}
        onAspectRatioChange={setGenImageAspectRatio}
        onQualityChange={setGenImageQuality}
        onPromptChange={setGenPrompt}
        onInsertRefTag={insertGenModalRefTag}
        onUploadReferenceImages={uploadGenModalReferenceImages}
        onEditModeChange={setGenImageEditMode}
        onOpenImage={openImageLightbox}
        onRemoveReferenceImage={removeGenModalReferenceImage}
        onGenerate={handleGenImage}
        onAddHistoryImage={addHistoryImageToScene}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
    {imageLightboxOverlay}
    </>
  )
}
