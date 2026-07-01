import { useCallback } from 'react'
import { api } from '../../services/api'
import { getErrorMessage } from './gameVideoPageHelpers'

export function useScenePromptActions({
  currentProjectId,
  scenes,
  updateScene,
}) {
  const handleGeneratePrompt = useCallback(async (sceneId) => {
    const scene = scenes.find(item => item.id === sceneId)
    if (!scene) return
    if (!scene.description?.trim()) {
      alert('请先输入文本描述')
      return
    }
    updateScene(sceneId, { _generatingPrompt: true })
    try {
      const result = await api.post('/api/game/analyze_prompt', {
        project_id: currentProjectId || '',
        description: scene.description,
        character_refs: scene.charImages.map(image => image.url),
        scene_refs: scene.sceneImages.map(image => image.url),
        reference_video_url: scene.videoMode === 'reference_video' ? scene.refVideoUrl : '',
        advanced_reference_videos: scene.videoMode === 'advanced_video' ? (scene.advancedRefVideos || []).map(video => video.url) : [],
        model: scene.aiModel || 'doubao-seed-2-0-pro-260215',
        language: '中文',
      })
      const prompt = (result.prompt || '').trim()
      if (!prompt) throw new Error('模型没有返回提示词，请稍后重试。')
      updateScene(sceneId, { prompt, _generatingPrompt: false })
    } catch (e) {
      alert('生成失败: ' + getErrorMessage(e, '生成失败'))
      updateScene(sceneId, { _generatingPrompt: false })
    }
  }, [currentProjectId, scenes, updateScene])

  const handleAnalyze = useCallback(async (sceneId) => {
    const scene = scenes.find(item => item.id === sceneId)
    if (!scene) return
    updateScene(sceneId, { _analyzing: true })
    try {
      const result = await api.post('/api/game/analyze_prompt', {
        project_id: currentProjectId || '',
        description: scene.prompt || '根据参考图生成一段游戏宣传视频',
        character_refs: scene.charImages.map(image => image.url),
        scene_refs: scene.sceneImages.map(image => image.url),
        reference_video_url: scene.videoMode === 'reference_video' ? scene.refVideoUrl : '',
        advanced_reference_videos: scene.videoMode === 'advanced_video' ? (scene.advancedRefVideos || []).map(video => video.url) : [],
        model: scene.aiModel || 'doubao-seed-2-0-pro-260215',
        language: '中文',
      })
      const prompt = (result.prompt || '').trim()
      if (!prompt) throw new Error('模型没有返回提示词，请稍后重试。')
      updateScene(sceneId, { prompt, _analyzing: false })
    } catch (e) {
      alert('分析失败: ' + getErrorMessage(e, '分析失败'))
      updateScene(sceneId, { _analyzing: false })
    }
  }, [currentProjectId, scenes, updateScene])

  const handleRefresh = useCallback(async (sceneId) => {
    const scene = scenes.find(item => item.id === sceneId)
    if (!scene?.prompt.trim()) return
    updateScene(sceneId, { _refreshing: true })
    try {
      const result = await api.post('/api/game/refresh_prompt', {
        project_id: currentProjectId || '',
        prompt: scene.prompt,
        character_refs: scene.charImages.map(image => image.url),
        scene_refs: scene.sceneImages.map(image => image.url),
        reference_video_url: scene.videoMode === 'reference_video' ? scene.refVideoUrl : '',
        advanced_reference_videos: scene.videoMode === 'advanced_video' ? (scene.advancedRefVideos || []).map(video => video.url) : [],
        model: scene.aiModel || 'doubao-seed-2-0-pro-260215',
      })
      const prompt = (result.prompt || '').trim()
      if (!prompt) throw new Error('模型没有返回润色结果，请稍后重试。')
      updateScene(sceneId, { prompt, _refreshing: false })
    } catch (e) {
      alert('刷新失败: ' + getErrorMessage(e, '刷新失败'))
      updateScene(sceneId, { _refreshing: false })
    }
  }, [currentProjectId, scenes, updateScene])

  return {
    handleGeneratePrompt,
    handleAnalyze,
    handleRefresh,
  }
}
