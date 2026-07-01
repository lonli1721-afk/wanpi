import { useCallback } from 'react'
import { api } from '../../services/api'
import { FALLBACK_VIDEO_MODELS } from './gameVideoConstants'
import { normalizeImageQualityForModel } from './gameVideoModelUtils'
import { filterImageModelsForCurrentUser } from '../image-toolbox/imageModelAccess'
import { FALLBACK_IMAGE_MODELS, mergeImageModelsWithFallback } from '../image-toolbox/imageModelFallbacks'
import {
  getErrorMessage,
  logGamePageError,
} from './gameVideoPageHelpers'

function mergeVideoModels(remoteModels) {
  const fallbackById = new Map(FALLBACK_VIDEO_MODELS.map(model => [model.id, model]))
  const merged = []
  const seen = new Set()

  ;(Array.isArray(remoteModels) ? remoteModels : []).forEach((model) => {
    if (!model?.id) return
    const fallback = fallbackById.get(model.id)
    merged.push(fallback ? { ...model, ...fallback } : model)
    seen.add(model.id)
  })

  FALLBACK_VIDEO_MODELS.forEach((model) => {
    if (!seen.has(model.id)) {
      merged.push(model)
    }
  })

  return merged
}

export function useWorkbenchBootstrap({
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
}) {
  const loadModels = useCallback(async () => {
    try {
      const data = await api.get('/api/game/video_models')
      const remoteModels = Array.isArray(data?.models) ? data.models : []
      const list = mergeVideoModels(remoteModels)
      setModels(list)
      if (genScenes.length === 0) {
        const initial = makeInitialScenePair(list)
        setGenScenes(initial.gen)
        setReplScenes(initial.repl)
      }
    } catch (e) {
      logGamePageError('loadModels', e)
      setModels(FALLBACK_VIDEO_MODELS)
      if (genScenes.length === 0) {
        const initial = makeInitialScenePair(FALLBACK_VIDEO_MODELS)
        setGenScenes(initial.gen)
        setReplScenes(initial.repl)
      }
    }
  }, [genScenes.length, makeInitialScenePair, setGenScenes, setModels, setReplScenes])

  const loadImageModels = useCallback(async () => {
    try {
      const data = await api.get('/api/game/image_models')
      const list = filterImageModelsForCurrentUser(mergeImageModelsWithFallback(data?.models || []))
      setImageModels(list)
      if (!list.length) return
      const pick = (prev) => {
        const id = prev && list.some(model => model.id === prev) ? prev : list[0].id
        const row = list.find(model => model.id === id)
        return { id, provider: row?.provider || '' }
      }

      setGenImgModel((prev) => {
        const { id, provider } = pick(prev)
        const row = list.find(model => model.id === id)
        setGenImgProvider(provider)
        setGenImageQuality(prevQuality => normalizeImageQualityForModel(prevQuality, row))
        return id
      })

      if (!loadedProjectRef.current) {
        setImgGenModel((prev) => {
          const { id, provider } = pick(prev)
          const row = list.find(model => model.id === id)
          setImgGenProvider(provider)
          setImgGenQuality(prevQuality => normalizeImageQualityForModel(prevQuality, row))
          return id
        })
      } else {
        setImgGenModel((prev) => {
          if (prev && list.some(model => model.id === prev)) {
            const row = list.find(model => model.id === prev)
            setImgGenProvider(row?.provider || '')
            setImgGenQuality(prevQuality => normalizeImageQualityForModel(prevQuality, row))
            return prev
          }
          const { id, provider } = pick('')
          const row = list.find(model => model.id === id)
          setImgGenProvider(provider)
          setImgGenQuality(prevQuality => normalizeImageQualityForModel(prevQuality, row))
          return id
        })
      }
    } catch (e) {
      logGamePageError('loadImageModels', e)
      setImageModels(FALLBACK_IMAGE_MODELS)
    }
  }, [
    loadedProjectRef,
    setGenImageQuality,
    setGenImgModel,
    setGenImgProvider,
    setImageModels,
    setImgGenModel,
    setImgGenProvider,
    setImgGenQuality,
  ])

  const loadGameSettings = useCallback(async () => {
    try {
      const data = await api.get('/api/game/settings')
      setGameSettings(data)
    } catch (e) {
      logGamePageError('loadGameSettings', e)
    }
  }, [setGameSettings])

  const saveGameSetting = useCallback(async (key) => {
    const value = settingInputs[key] || ''
    setSavingKey(key)
    try {
      await api.post('/api/game/settings', { key, value })
      await loadGameSettings()
      setSettingInputs(prev => ({ ...prev, [key]: '' }))
      loadModels()
      loadImageModels()
    } catch (e) {
      alert('保存失败: ' + getErrorMessage(e, '保存失败'))
    } finally {
      setSavingKey('')
    }
  }, [
    loadGameSettings,
    loadImageModels,
    loadModels,
    setSavingKey,
    setSettingInputs,
    settingInputs,
  ])

  return {
    loadModels,
    loadImageModels,
    loadGameSettings,
    saveGameSetting,
  }
}
