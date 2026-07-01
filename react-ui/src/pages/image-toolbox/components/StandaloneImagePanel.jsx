import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Loader2, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { api } from '../../../services/api'
import ImageGenerationPanel from '../../game/components/ImageGenerationPanel'
import { DEFAULT_IMAGE_ASPECT_RATIO, IMAGE_ASPECT_OPTIONS, IMAGE_QUALITY_OPTIONS } from '../../game/gameVideoConstants'
import { absoluteMediaUrl, logGamePageError, mediaUrl } from '../../game/gameVideoPageHelpers'
import { cleanImageModelLabel, getImageAspectOption, getImageQualityIds, getImageRefBlockReason, normalizeImageQualityForModel } from '../../game/gameVideoModelUtils'
import { useStandaloneImageGenerationActions } from '../../game/useStandaloneImageGenerationActions'
import { FALLBACK_IMAGE_MODELS } from '../imageModelFallbacks'
import { uploadGameImage } from '../imageToolboxApi'

const STORAGE_KEY = 'image-toolbox-standalone-image-v1'

function createExtraScene(index, base = {}) {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    idx: index,
    prompt: '',
    promptModel: base.promptModel || 'doubao-seed-2-0-pro-260215',
    model: base.model || '',
    provider: base.provider || '',
    refImages: [],
    editMode: false,
    batchCount: Number(base.batchCount || 1),
    aspectRatio: base.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO,
    quality: base.quality || '2K',
    history: [],
    loading: false,
  }
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredState(patch) {
  const current = readStoredState()
  const next = { ...current, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return Promise.resolve(next)
}

function friendlyImageError(error) {
  const raw = error?.message || String(error || '')
  let text = raw
  try {
    const parsed = JSON.parse(raw)
    text = parsed?.detail || parsed?._error || parsed?.message || raw
  } catch {
    // Keep the original provider message when it is not JSON.
  }
  if (/503|UNAVAILABLE|high demand|temporar/i.test(text)) return '模型服务当前繁忙，请稍后重试。'
  if (/504|DEADLINE_EXCEEDED|deadline expired/i.test(text)) return '模型响应超时，请稍后重试。'
  if (/OversizeImage|exceeds the limit|10 MiB|图片.*过大|参考图超过/i.test(text)) {
    return '参考图超过即梦 10 MiB 输入限制。系统会自动压缩本地上传图；如果仍失败，请先把参考图压缩到 10 MiB 以下后重试。'
  }
  return text
}

export function StandaloneImagePanel({ imageModels: rawImageModels, modelsLoaded, onOpenImage }) {
  const stored = useMemo(() => readStoredState(), [])
  const imageModels = useMemo(() => (
    Array.isArray(rawImageModels) && rawImageModels.length ? rawImageModels : FALLBACK_IMAGE_MODELS
  ), [rawImageModels])
  const [imgGenHistory, setImgGenHistory] = useState(() => Array.isArray(stored.imgGenHistory) ? stored.imgGenHistory : [])
  const [imgGenPrompt, setImgGenPrompt] = useState(() => stored.imgGenPrompt || '')
  const [imgGenPromptModel, setImgGenPromptModel] = useState(() => stored.imgGenPromptModel || 'doubao-seed-2-0-pro-260215')
  const [imgGenModel, setImgGenModel] = useState(() => stored.imgGenModel || '')
  const [imgGenProvider, setImgGenProvider] = useState(() => stored.imgGenProvider || '')
  const [imgGenRefImages, setImgGenRefImages] = useState(() => Array.isArray(stored.imgGenRefImages) ? stored.imgGenRefImages : [])
  const [imgGenEditMode, setImgGenEditMode] = useState(() => !!stored.imgGenEditMode)
  const [imgGenBatchCount, setImgGenBatchCount] = useState(() => Math.max(1, Math.min(4, Number(stored.imgGenBatchCount || 1))))
  const [imgGenAspectRatio, setImgGenAspectRatio] = useState(() => stored.imgGenAspectRatio || DEFAULT_IMAGE_ASPECT_RATIO)
  const [imgGenQuality, setImgGenQuality] = useState(() => stored.imgGenQuality || '2K')
  const [extraScenes, setExtraScenes] = useState(() => Array.isArray(stored.extraScenes) ? stored.extraScenes : [])
  const [imgGenLoading, setImgGenLoading] = useState(false)
  const [imgGenRefreshing, setImgGenRefreshing] = useState(false)

  useEffect(() => {
    if (!imageModels.length) return
    const currentModel = imageModels.find(model => model.id === imgGenModel)
    if (currentModel) {
      const nextQuality = normalizeImageQualityForModel(imgGenQuality, currentModel)
      if (nextQuality !== imgGenQuality) {
        setImgGenQuality(nextQuality)
        writeStoredState({ imgGenQuality: nextQuality })
      }
      return
    }
    const firstModel = imageModels[0]
    const nextQuality = normalizeImageQualityForModel(imgGenQuality, firstModel)
    setImgGenModel(firstModel.id)
    setImgGenProvider(firstModel.provider)
    setImgGenQuality(nextQuality)
    writeStoredState({ imgGenModel: firstModel.id, imgGenProvider: firstModel.provider, imgGenQuality: nextQuality })
  }, [imageModels, imgGenModel, imgGenQuality, modelsLoaded])

  useEffect(() => {
    if (!imageModels.length) return
    const allowedModelIds = new Set(imageModels.map(model => model.id))
    if (!extraScenes.some(scene => !scene.model || !allowedModelIds.has(scene.model))) return
    const firstModel = imageModels[0]
    const nextScenes = extraScenes.map(scene => {
      if (scene.model && allowedModelIds.has(scene.model)) return scene
      const nextQuality = normalizeImageQualityForModel(scene.quality || imgGenQuality, firstModel)
      return {
        ...scene,
        model: firstModel.id,
        provider: firstModel.provider,
        quality: nextQuality,
      }
    })
    setExtraScenes(nextScenes)
    writeStoredState({ extraScenes: nextScenes })
  }, [extraScenes, imageModels, imgGenQuality, modelsLoaded])

  const uploadFilesWithFeedback = useCallback(async (files, { failureLabel }) => {
    const uploaded = []
    let failedCount = 0
    for (const file of files) {
      try {
        const result = await uploadGameImage(file)
        uploaded.push({ url: result.url, name: file.name.replace(/\.[^.]+$/, '') })
      } catch (error) {
        failedCount += 1
        logGamePageError(`${failureLabel}:${file.name}`, error)
      }
    }
    if (failedCount > 0) {
      alert(`${failureLabel}：成功 ${uploaded.length} 个，失败 ${failedCount} 个，请重试失败文件。`)
    }
    return uploaded
  }, [])

  const postImageGeneration = useCallback((body) => api.post('/api/game/generate_image', body), [])

  const postPromptRefresh = useCallback((prompt, model, target = 'image') => (
    api.post('/api/game/refresh_prompt', {
      project_id: '',
      prompt,
      model,
      target,
      scene_refs: target === 'image' ? imgGenRefImages.map(item => item.url) : [],
    })
  ), [imgGenRefImages])

  const persistStandaloneImageState = useCallback((patch) => writeStoredState(patch), [])

  const persistExtraScenes = useCallback((updater) => {
    setExtraScenes(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      writeStoredState({ extraScenes: next })
      return next
    })
  }, [])

  const selectedModel = imageModels.find(model => model.id === imgGenModel)
  const qualityIds = getImageQualityIds(selectedModel)
  const safeQuality = normalizeImageQualityForModel(imgGenQuality, selectedModel)

  const addExtraScene = useCallback(() => {
    persistExtraScenes(prev => [
      ...prev,
      createExtraScene(prev.length + 2, {
        promptModel: imgGenPromptModel,
        model: imgGenModel,
        provider: imgGenProvider,
        aspectRatio: imgGenAspectRatio,
        batchCount: imgGenBatchCount,
        quality: safeQuality,
      }),
    ].map((scene, index) => ({ ...scene, idx: index + 2 })))
  }, [imgGenAspectRatio, imgGenBatchCount, imgGenModel, imgGenPromptModel, imgGenProvider, persistExtraScenes, safeQuality])

  const updateExtraScene = useCallback((id, patch) => {
    persistExtraScenes(prev => prev.map(scene => (scene.id === id ? { ...scene, ...patch } : scene)))
  }, [persistExtraScenes])

  const removeExtraScene = useCallback((id) => {
    persistExtraScenes(prev => prev.filter(scene => scene.id !== id).map((scene, index) => ({ ...scene, idx: index + 2 })))
  }, [persistExtraScenes])

  const uploadExtraSceneImages = useCallback((sceneId) => {
    const scene = extraScenes.find(item => item.id === sceneId)
    const sceneModel = imageModels.find(item => item.id === scene?.model)
    const currentRefs = Array.isArray(scene?.refImages) ? scene.refImages : []
    const maxRefs = Number(sceneModel?.max_ref_images || 0)
    if (maxRefs > 0 && currentRefs.length >= maxRefs) {
      alert(`${sceneModel?.name || '当前模型'} 最多支持 ${maxRefs} 张参考图。`)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = async (event) => {
      const files = Array.from(event.target.files || [])
      const allowedFiles = maxRefs > 0 ? files.slice(0, Math.max(0, maxRefs - currentRefs.length)) : files
      const uploaded = await uploadFilesWithFeedback(allowedFiles, { failureLabel: '参考图上传失败' })
      const uploadedRefs = uploaded.map(item => ({ ...item, source: 'upload' }))
      if (!uploadedRefs.length) return
      persistExtraScenes(prev => prev.map(scene => (
        scene.id === sceneId ? { ...scene, refImages: [...(scene.refImages || []), ...uploadedRefs], editMode: false } : scene
      )))
    }
    input.click()
  }, [extraScenes, imageModels, persistExtraScenes, uploadFilesWithFeedback])

  const removeExtraSceneImage = useCallback((sceneId, index) => {
    persistExtraScenes(prev => prev.map(scene => (
      scene.id === sceneId
        ? { ...scene, refImages: (scene.refImages || []).filter((_, imgIndex) => imgIndex !== index) }
        : scene
    )))
  }, [persistExtraScenes])

  const editGeneratedImageInSceneOne = useCallback((image) => {
    if (!image?.url) return
    const ref = { url: image.url, name: '生成图再编辑', source: 'generated' }
    setImgGenRefImages([ref])
    setImgGenEditMode(true)
    setImgGenPrompt('')
    writeStoredState({ imgGenRefImages: [ref], imgGenEditMode: true, imgGenPrompt: '' })
    window.setTimeout(() => document.getElementById('game-imggen-prompt')?.focus(), 60)
  }, [])

  const editGeneratedImageInExtraScene = useCallback((sceneId, image) => {
    if (!sceneId || !image?.url) return
    const ref = { url: image.url, name: '生成图再编辑', source: 'generated' }
    persistExtraScenes(prev => prev.map(scene => (
      scene.id === sceneId
        ? { ...scene, refImages: [ref], editMode: true, prompt: '' }
        : scene
    )))
  }, [persistExtraScenes])

  const {
    handleRefreshStandaloneImagePrompt,
    removeStandaloneHistoryImage,
    handleStandaloneImageModelChange,
    handleStandaloneImageAspectRatioChange,
    handleStandaloneImageQualityChange,
    handleStandaloneImagePromptModelChange,
    handleStandaloneImageEditModeChange,
    handleStandaloneImageBatchCountChange,
    handleStandaloneReferenceImageUpload,
    handleRemoveStandaloneReferenceImage,
    handleCopyStandaloneImageLink,
    handleStandaloneGenImage,
  } = useStandaloneImageGenerationActions({
    currentProjectId: '',
    imageModels,
    imgGenPrompt,
    imgGenPromptModel,
    imgGenModel,
    imgGenProvider,
    imgGenRefImages,
    imgGenEditMode,
    imgGenBatchCount,
    imgGenAspectRatio,
    imgGenQuality,
    imgGenHistory,
    setImgGenPrompt,
    setImgGenPromptModel,
    setImgGenModel,
    setImgGenProvider,
    setImgGenRefImages,
    setImgGenEditMode,
    setImgGenBatchCount,
    setImgGenAspectRatio,
    setImgGenQuality,
    setImgGenLoading,
    setImgGenRefreshing,
    setImgGenHistory,
    uploadFilesWithFeedback,
    postImageGeneration,
    postPromptRefresh,
    getFriendlyImageError: friendlyImageError,
    persistStandaloneImageState,
    deleteServerFilesAfterSave: () => {},
  })

  const generateExtraScene = useCallback(async (targetScene) => {
    const scene = typeof targetScene === 'string'
      ? extraScenes.find(item => item.id === targetScene)
      : targetScene
    if (!scene || !scene.prompt?.trim()) return
    const selectedSceneModel = imageModels.find(item => item.id === scene.model)
    const refImages = Array.isArray(scene.refImages) ? scene.refImages : []
    const isGeneratedEdit = scene.editMode && refImages.some(item => item?.source === 'generated')
    const blockReason = getImageRefBlockReason(selectedSceneModel, refImages.length, isGeneratedEdit)
    if (blockReason) {
      alert(`场景${scene.idx}：${blockReason}`)
      return
    }
    persistExtraScenes(prev => prev.map(item => (item.id === scene.id ? { ...item, loading: true } : item)))
    try {
      const imageSize = getImageAspectOption(scene.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO)
      const imageQuality = normalizeImageQualityForModel(scene.quality || '2K', selectedSceneModel)
      const d = await postImageGeneration({
        project_id: '',
        prompt: scene.prompt,
        provider: scene.provider,
        model: scene.model,
        width: imageSize.width,
        height: imageSize.height,
        aspect_ratio: imageSize.id,
        asset_type: 'standalone',
        reference_urls: refImages.map(item => item.url),
        edit_mode: isGeneratedEdit,
        batch_count: Math.max(1, Math.min(4, Number(scene.batchCount || 1))),
        image_quality: imageQuality,
        prompt_optimize_mode: 'standard',
      })
      const resultImages = Array.isArray(d.images) && d.images.length
        ? d.images.map(item => item?.url).filter(Boolean)
        : [d.image_url].filter(Boolean)
      if (resultImages.length) {
        const items = resultImages.map((url, index) => ({
          url,
          prompt: scene.prompt,
          model: scene.model,
          provider: scene.provider,
          aspectRatio: imageSize.id,
          width: imageSize.width,
          height: imageSize.height,
          quality: imageQuality,
          sceneIdx: scene.idx,
          batchIndex: index + 1,
          batchCount: resultImages.length,
          ts: Date.now(),
        }))
        persistExtraScenes(prev => prev.map(prevScene => (
          prevScene.id === scene.id
            ? { ...prevScene, loading: false, batchCount: Math.max(1, Math.min(4, Number(scene.batchCount || 1))), history: [...items, ...(prevScene.history || [])] }
            : prevScene
        )))
        setImgGenHistory(prev => {
          const nextHistory = [...items, ...prev]
          writeStoredState({ imgGenHistory: nextHistory })
          return nextHistory
        })
      }
    } catch (error) {
      alert(`场景${scene.idx}生成失败：${friendlyImageError(error)}`)
      persistExtraScenes(prev => prev.map(item => (item.id === scene.id ? { ...item, loading: false } : item)))
    } finally {
      persistExtraScenes(prev => prev.map(item => (item.id === scene.id ? { ...item, loading: false } : item)))
    }
  }, [extraScenes, imageModels, persistExtraScenes, postImageGeneration, setImgGenHistory])

  const generateAllExtraScenes = useCallback(async () => {
    const runnableScenes = [...extraScenes].reverse().filter(scene => scene.prompt?.trim() && !scene.loading)
    const canRunScene1 = !!imgGenPrompt.trim() && !imgGenLoading
    if (!runnableScenes.length && !canRunScene1) {
      alert('请先填写至少一个新增场景的提示词。')
      return
    }
    for (const scene of runnableScenes) {
      await generateExtraScene(scene)
    }
    if (canRunScene1) {
      await handleStandaloneGenImage()
    }
  }, [extraScenes, generateExtraScene, handleStandaloneGenImage, imgGenLoading, imgGenPrompt])

  const displayedExtraScenes = useMemo(() => [...extraScenes].reverse(), [extraScenes])
  const imageRecords = useMemo(() => imgGenHistory.map((item, index) => ({ ...item, sceneIdx: item.sceneIdx || 1, historyIndex: index })), [imgGenHistory])
  const sceneOneRecords = useMemo(() => imageRecords.filter(item => item.sceneIdx === 1), [imageRecords])
  const processingRecords = useMemo(() => {
    const records = []
    for (const scene of displayedExtraScenes) {
      if (scene.loading) records.push({ id: scene.id, sceneIdx: scene.idx, status: 'processing' })
    }
    if (imgGenLoading) records.push({ id: 'scene-1-processing', sceneIdx: 1, status: 'processing' })
    return records
  }, [displayedExtraScenes, imgGenLoading])

  return (
    <div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {imageRecords.length > 0 && (
          <div style={{ order: 0, maxWidth: 900, margin: '0 auto 12px', width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 15 }}>所有场景生成结果</strong>
              <span style={{ fontSize: 12, color: '#10b981', fontWeight: 800 }}>{imageRecords.length} 张</span>
            </div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }}>
              {imageRecords.map((img) => (
                <div key={`top-${img.url}-${img.historyIndex}`} style={{ flex: '0 0 184px', position: 'relative', borderRadius: 11, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                  <button
                    type="button"
                    title="从记录中移除"
                    onClick={() => removeStandaloneHistoryImage(img.historyIndex)}
                    style={{ position: 'absolute', top: 7, right: 7, background: 'rgba(0,0,0,0.68)', color: '#fff', borderRadius: 7, padding: 4, lineHeight: 0, zIndex: 2 }}
                  >
                    <X size={12} />
                  </button>
                  <img
                    src={mediaUrl(img.url)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onClick={() => onOpenImage?.(mediaUrl(img.url))}
                    style={{ width: '100%', height: 138, objectFit: 'cover', display: 'block', cursor: 'pointer', background: '#000' }}
                  />
                  <div style={{ padding: 7, background: 'var(--bg-tertiary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 800 }}>场景 {img.sceneIdx} · 已完成</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cleanImageModelLabel(img.model || img.provider || '图片')}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5 }}>{img.prompt || '图片生成结果'}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a href={mediaUrl(img.url)} download target="_blank" rel="noreferrer" style={{ flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', textAlign: 'center', textDecoration: 'none' }}>下载</a>
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(absoluteMediaUrl(img.url)); handleCopyStandaloneImageLink(img.url) }} style={{ flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>复制</button>
                    </div>
                    <button type="button" onClick={() => editGeneratedImageInSceneOne(img)} style={{ width: '100%', marginTop: 6, padding: '5px 0', borderRadius: 6, fontSize: 10, fontWeight: 800, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.22)' }}>编辑这张图</button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(img.prompt || '')} style={{ width: '100%', marginTop: 6, padding: '5px 0', borderRadius: 6, fontSize: 10, fontWeight: 800, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.22)' }}>复制提示词</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ order: 99 }}>
          <div style={{ maxWidth: 900, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="var(--accent)" />
            <strong style={{ fontSize: 15 }}>场景 1</strong>
          </div>
      <ImageGenerationPanel
        active
        imageModels={imageModels}
        model={imgGenModel}
        aspectRatio={imgGenAspectRatio}
        quality={safeQuality}
        qualityIds={qualityIds}
        promptModel={imgGenPromptModel}
        prompt={imgGenPrompt}
        refreshing={imgGenRefreshing}
        loading={imgGenLoading}
        refImages={imgGenRefImages}
        editMode={imgGenEditMode}
        batchCount={imgGenBatchCount}
        history={sceneOneRecords}
        cleanImageModelName={cleanImageModelLabel}
        onModelChange={handleStandaloneImageModelChange}
        onAspectRatioChange={handleStandaloneImageAspectRatioChange}
        onQualityChange={handleStandaloneImageQualityChange}
        onPromptModelChange={handleStandaloneImagePromptModelChange}
        onPromptChange={(value) => {
          setImgGenPrompt(value)
          persistStandaloneImageState({ imgGenPrompt: value })
        }}
        onRefreshPrompt={handleRefreshStandaloneImagePrompt}
        onUploadReferenceImages={handleStandaloneReferenceImageUpload}
        onEditModeChange={handleStandaloneImageEditModeChange}
        onBatchCountChange={handleStandaloneImageBatchCountChange}
        onOpenImage={(url) => onOpenImage?.(mediaUrl(url))}
        onRemoveReferenceImage={handleRemoveStandaloneReferenceImage}
        onGenerate={handleStandaloneGenImage}
        onRemoveHistoryImage={removeStandaloneHistoryImage}
        onCopyImageLink={(url) => {
          void navigator.clipboard.writeText(absoluteMediaUrl(url))
          handleCopyStandaloneImageLink(url)
        }}
        onEditHistoryImage={editGeneratedImageInSceneOne}
        maxWidth={900}
        historyCardWidth={168}
        historyImageHeight={126}
        showPromptCopyButton
      />
        </div>

      <div style={{ maxWidth: 900, margin: '0 auto 14px', order: 1, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 10 }}>
          {extraScenes.length > 0 && (
            <button
              type="button"
              onClick={generateAllExtraScenes}
              disabled={extraScenes.some(scene => scene.loading) || imgGenLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 10,
                background: 'var(--accent-gradient)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 800,
                opacity: (extraScenes.some(scene => scene.loading) || imgGenLoading) ? 0.65 : 1,
              }}
            >
              <Sparkles size={14} /> 全部生成
            </button>
          )}
          <button
            type="button"
            onClick={addExtraScene}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(139,92,246,0.10)',
              color: 'var(--accent)',
              border: '1px solid rgba(139,92,246,0.24)',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <Plus size={14} /> 添加图片场景
          </button>
        </div>

        {displayedExtraScenes.map((scene) => {
          const sceneModel = imageModels.find(item => item.id === scene.model)
          const sceneQualityIds = getImageQualityIds(sceneModel)
          const sceneQuality = normalizeImageQualityForModel(scene.quality || '2K', sceneModel)
          const refs = Array.isArray(scene.refImages) ? scene.refImages : []
          const sceneHistory = Array.isArray(scene.history) ? scene.history : []
          return (
            <div
              key={scene.id}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 14,
                border: '1px solid var(--border)',
                padding: 16,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Sparkles size={16} color="var(--accent)" />
                <strong style={{ fontSize: 15 }}>场景 {scene.idx}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>独立提示词、参考图、模型、比例和清晰度</span>
                <button
                  type="button"
                  onClick={() => removeExtraScene(scene.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </div>

              <select
                value={scene.model}
                onChange={(event) => {
                  const model = imageModels.find(item => item.id === event.target.value)
                  updateExtraScene(scene.id, {
                    model: event.target.value,
                    provider: model?.provider || '',
                    quality: normalizeImageQualityForModel(sceneQuality, model),
                  })
                }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, marginBottom: 10, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13 }}
              >
                {imageModels.map(item => <option key={item.id} value={item.id}>{cleanImageModelLabel(item.name)}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <select
                  value={scene.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO}
                  onChange={event => updateExtraScene(scene.id, { aspectRatio: event.target.value })}
                  style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
                >
                  {IMAGE_ASPECT_OPTIONS.map(option => <option key={option.id} value={option.id}>比例 {option.label}</option>)}
                </select>
                <select
                  value={sceneQuality}
                  onChange={event => updateExtraScene(scene.id, { quality: normalizeImageQualityForModel(event.target.value, sceneModel) })}
                  style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
                >
                  {IMAGE_QUALITY_OPTIONS
                    .filter(option => sceneQualityIds.includes(option.id))
                    .map(option => <option key={option.id} value={option.id}>清晰度 {option.label}</option>)}
                </select>
                <select
                  value={Math.max(1, Math.min(4, Number(scene.batchCount || 1)))}
                  onChange={event => updateExtraScene(scene.id, { batchCount: Number(event.target.value) })}
                  style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}
                >
                  {[1, 2, 3, 4].map(count => <option key={count} value={count}>数量 {count} 张</option>)}
                </select>
              </div>

              <textarea
                value={scene.prompt || ''}
                onChange={event => updateExtraScene(scene.id, { prompt: event.target.value })}
                placeholder={`填写场景${scene.idx}想生成的图片内容...`}
                style={{ width: '100%', minHeight: 78, padding: 10, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
              />

              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => uploadExtraSceneImages(scene.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: 'rgba(139,92,246,0.10)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.22)', fontSize: 12, fontWeight: 700 }}
                >
                  <Upload size={13} /> 上传参考图
                </button>
              </div>

              {refs.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {refs.map((img, index) => (
                    <div key={`${img.url}-${index}`} style={{ width: 58, height: 58, borderRadius: 8, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}>
                      <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" onClick={() => onOpenImage?.(mediaUrl(img.url))} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                      <button type="button" onClick={() => removeExtraSceneImage(scene.id, index)} style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.65)', color: '#fff', borderRadius: '0 0 0 5px', padding: 2, lineHeight: 0 }}>
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => generateExtraScene(scene)}
                disabled={scene.loading || !scene.prompt?.trim()}
                style={{
                  width: '100%',
                  padding: '11px 0',
                  borderRadius: 9,
                  marginTop: 12,
                  fontSize: 13,
                  fontWeight: 800,
                  background: scene.loading ? 'var(--bg-tertiary)' : 'var(--accent-gradient)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: !scene.prompt?.trim() ? 0.5 : 1,
                }}
              >
                {scene.loading ? <><Loader2 size={14} className="spin" /> 场景{scene.idx}生成中...</> : <><Sparkles size={14} /> 生成场景{scene.idx}</>}
              </button>

              {sceneHistory.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>场景 {scene.idx} 已生成 ({sceneHistory.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {sceneHistory.slice(0, 6).map((img, index) => (
                    <div key={`${img.url}-${index}`} style={{ flex: '0 0 168px', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                      <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" onClick={() => onOpenImage?.(mediaUrl(img.url))} style={{ width: '100%', height: 126, objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
                      <div style={{ padding: 8, background: 'var(--bg-tertiary)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>{img.prompt || `场景 ${scene.idx} 生成结果`}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a href={mediaUrl(img.url)} download target="_blank" rel="noreferrer" style={{ flex: 1, padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 800, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', textAlign: 'center', textDecoration: 'none' }}>下载</a>
                          <button type="button" onClick={() => { void navigator.clipboard.writeText(absoluteMediaUrl(img.url)); handleCopyStandaloneImageLink(img.url) }} style={{ flex: 1, padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 800, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>复制链接</button>
                        </div>
                        <button type="button" onClick={() => editGeneratedImageInExtraScene(scene.id, img)} style={{ width: '100%', marginTop: 6, padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 800, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.22)' }}>编辑这张图</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(img.prompt || '')} style={{ width: '100%', marginTop: 6, padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 800, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.22)' }}>复制提示词</button>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>

    </div>
  )
}
