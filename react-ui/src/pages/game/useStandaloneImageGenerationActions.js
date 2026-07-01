import { useCallback } from 'react'
import { absoluteMediaUrl } from './gameVideoPageHelpers'
import {
  getImageAspectOption,
  getImageRefBlockReason,
  normalizeImageQualityForModel,
} from './gameVideoModelUtils'

export function useStandaloneImageGenerationActions({
  currentProjectId,
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
  getFriendlyImageError,
  persistStandaloneImageState,
  deleteServerFilesAfterSave,
}) {
  const handleRefreshStandaloneImagePrompt = useCallback(async () => {
    if (!imgGenPrompt.trim()) return
    setImgGenRefreshing(true)
    try {
      const d = await postPromptRefresh(imgGenPrompt, imgGenPromptModel, 'image')
      const prompt = (d.prompt || '').trim()
      if (!prompt) throw new Error('模型没有返回润色结果，请稍后重试。')
      setImgGenPrompt(prompt)
      persistStandaloneImageState({ imgGenPrompt: prompt })
    } catch (e) {
      alert('刷新失败: ' + getFriendlyImageError(e))
    } finally {
      setImgGenRefreshing(false)
    }
  }, [
    getFriendlyImageError,
    imgGenPrompt,
    imgGenPromptModel,
    persistStandaloneImageState,
    postPromptRefresh,
    setImgGenPrompt,
    setImgGenRefreshing,
  ])

  const removeStandaloneHistoryImage = useCallback((idx) => {
    const removed = imgGenHistory[idx]?.url
    const nextHistory = imgGenHistory.filter((_, i) => i !== idx)
    setImgGenHistory(nextHistory)
    deleteServerFilesAfterSave(removed, persistStandaloneImageState({ imgGenHistory: nextHistory }))
  }, [deleteServerFilesAfterSave, imgGenHistory, persistStandaloneImageState, setImgGenHistory])

  const handleStandaloneImageModelChange = useCallback((modelId) => {
    setImgGenModel(modelId)
    const model = imageModels.find(item => item.id === modelId)
    if (!model) return
    const nextQuality = normalizeImageQualityForModel(imgGenQuality, model)
    setImgGenProvider(model.provider)
    setImgGenQuality(nextQuality)
    persistStandaloneImageState({ imgGenModel: modelId, imgGenProvider: model.provider, imgGenQuality: nextQuality })
  }, [
    imageModels,
    imgGenQuality,
    persistStandaloneImageState,
    setImgGenModel,
    setImgGenProvider,
    setImgGenQuality,
  ])

  const handleStandaloneImageAspectRatioChange = useCallback((aspectRatio) => {
    setImgGenAspectRatio(aspectRatio)
    persistStandaloneImageState({ imgGenAspectRatio: aspectRatio })
  }, [persistStandaloneImageState, setImgGenAspectRatio])

  const handleStandaloneImageQualityChange = useCallback((quality) => {
    const selectedModel = imageModels.find(item => item.id === imgGenModel)
    const nextQuality = normalizeImageQualityForModel(quality, selectedModel)
    setImgGenQuality(nextQuality)
    persistStandaloneImageState({ imgGenQuality: nextQuality })
  }, [imageModels, imgGenModel, persistStandaloneImageState, setImgGenQuality])

  const handleStandaloneImagePromptModelChange = useCallback((modelId) => {
    setImgGenPromptModel(modelId)
    persistStandaloneImageState({ imgGenPromptModel: modelId })
  }, [persistStandaloneImageState, setImgGenPromptModel])

  const handleStandaloneImageEditModeChange = useCallback((editMode) => {
    setImgGenEditMode(editMode)
    persistStandaloneImageState({ imgGenEditMode: editMode })
  }, [persistStandaloneImageState, setImgGenEditMode])

  const handleStandaloneImageBatchCountChange = useCallback((count) => {
    const nextCount = Math.max(1, Math.min(4, Number(count) || 1))
    setImgGenBatchCount(nextCount)
    persistStandaloneImageState({ imgGenBatchCount: nextCount })
  }, [persistStandaloneImageState, setImgGenBatchCount])

  const handleStandaloneReferenceImageUpload = useCallback(() => {
    const selectedModel = imageModels.find(item => item.id === imgGenModel)
    const maxRefs = Number(selectedModel?.max_ref_images || 0)
    if (maxRefs > 0 && imgGenRefImages.length >= maxRefs) {
      alert(`${selectedModel?.name || '当前模型'} 最多支持 ${maxRefs} 张参考图。`)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = async (event) => {
      const files = Array.from(event.target.files || [])
      const allowedFiles = maxRefs > 0 ? files.slice(0, Math.max(0, maxRefs - imgGenRefImages.length)) : files
      const uploaded = await uploadFilesWithFeedback(allowedFiles, { failureLabel: '参考图上传失败' })
      const uploadedRefs = uploaded.map(item => ({ ...item, source: 'upload' }))
      if (!uploadedRefs.length) return
      const next = [...imgGenRefImages, ...uploadedRefs]
      setImgGenRefImages(next)
      setImgGenEditMode(false)
      persistStandaloneImageState({ imgGenRefImages: next, imgGenEditMode: false })
    }
    input.click()
  }, [imageModels, imgGenModel, imgGenRefImages, persistStandaloneImageState, setImgGenRefImages, uploadFilesWithFeedback])

  const handleRemoveStandaloneReferenceImage = useCallback((idx) => {
    const next = imgGenRefImages.filter((_, i) => i !== idx)
    setImgGenRefImages(next)
    persistStandaloneImageState({ imgGenRefImages: next })
  }, [imgGenRefImages, persistStandaloneImageState, setImgGenRefImages])

  const handleCopyStandaloneImageLink = useCallback((url) => {
    void navigator.clipboard.writeText(absoluteMediaUrl(url))
  }, [])

  const handleStandaloneGenImage = useCallback(async () => {
    if (!imgGenPrompt.trim()) return
    const selectedModel = imageModels.find(m => m.id === imgGenModel)
    const isGeneratedEdit = imgGenEditMode && imgGenRefImages.some(item => item?.source === 'generated')
    const blockReason = getImageRefBlockReason(selectedModel, imgGenRefImages.length, isGeneratedEdit)
    if (blockReason) {
      alert(blockReason)
      return
    }
    setImgGenLoading(true)
    try {
      const imageSize = getImageAspectOption(imgGenAspectRatio)
      const imageQuality = normalizeImageQualityForModel(imgGenQuality, selectedModel)
      const d = await postImageGeneration({
        project_id: currentProjectId || '',
        prompt: imgGenPrompt,
        provider: imgGenProvider,
        model: imgGenModel,
        width: imageSize.width,
        height: imageSize.height,
        aspect_ratio: imageSize.id,
        asset_type: 'standalone',
        reference_urls: imgGenRefImages.map(i => i.url),
        edit_mode: isGeneratedEdit,
        batch_count: Math.max(1, Math.min(4, Number(imgGenBatchCount) || 1)),
        image_quality: imageQuality,
        prompt_optimize_mode: 'standard',
      })
      const resultImages = Array.isArray(d.images) && d.images.length
        ? d.images.map(item => item?.url).filter(Boolean)
        : [d.image_url].filter(Boolean)
      if (resultImages.length) {
        const items = resultImages.map((url, index) => ({
          url,
          prompt: imgGenPrompt,
          model: imgGenModel,
          provider: imgGenProvider,
          aspectRatio: imageSize.id,
          width: imageSize.width,
          height: imageSize.height,
          quality: imageQuality,
          batchIndex: index + 1,
          batchCount: resultImages.length,
          ts: Date.now(),
        }))
        const nextHistory = [...items, ...imgGenHistory]
        setImgGenHistory(nextHistory)
        persistStandaloneImageState({ imgGenHistory: nextHistory, imgGenPrompt, imgGenBatchCount: Math.max(1, Math.min(4, Number(imgGenBatchCount) || 1)) })
      }
    } catch (e) {
      alert('生成失败: ' + getFriendlyImageError(e))
    } finally {
      setImgGenLoading(false)
    }
  }, [
    currentProjectId,
    getFriendlyImageError,
    imageModels,
    imgGenAspectRatio,
    imgGenEditMode,
    imgGenBatchCount,
    imgGenHistory,
    imgGenModel,
    imgGenPrompt,
    imgGenProvider,
    imgGenQuality,
    imgGenRefImages,
    persistStandaloneImageState,
    postImageGeneration,
    setImgGenHistory,
    setImgGenLoading,
  ])

  return {
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
  }
}
