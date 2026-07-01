import {
  AlertCircle,
  AtSign,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Loader2,
  Mountain,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import { AI_MODELS, VIDEO_RESOLUTION_OPTIONS } from '../gameVideoConstants'
import { formatProviderVideoCacheError, isProviderVideoCacheError, mediaUrl } from '../gameVideoPageHelpers'
import {
  getModelResolutionIds,
  getVideoMaxReferenceVideos,
  getVideoModeBlockReason,
  getVideoReferenceDurationIssue,
  isVideoModeSupported,
  normalizeVideoModeForModel,
  normalizeVideoResolutionForModel,
  VIDEO_GENERATION_MODE_OPTIONS,
} from '../gameVideoModelUtils'

export default function SceneVideoCard({
  scene,
  scenesCount,
  models,
  saveStatus,
  saveError,
  elapsed,
  estimateCost,
  formatDurationSeconds,
  getModelLimitHint,
  getReferenceVideoDurationHintText,
  getSceneGenerationBlockReason,
  normalizeDurationSeconds,
  preventFocusLoss,
  onUpdateScene,
  onRemoveScene,
  onOpenImage,
  onOpenGenModal,
  onUploadImage,
  onRemoveImage,
  onAddHistoryImage,
  onRemoveHistoryImage,
  onUploadReferenceVideo,
  onUploadAdvancedVideos,
  onRemoveAdvancedVideo,
  onGeneratePrompt,
  onAnalyze,
  onRefresh,
  onInsertRefTag,
  onGenerateVideo,
  onRetryResultCache,
  onSelectHistoryVideo,
  onRemoveHistoryVideo,
}) {
  const isReplace = false
  const selectedModel = models.find(model => model.id === scene.model)
  const modelLimitHint = getModelLimitHint(selectedModel)
  const isReferenceVideoMode = scene.videoMode === 'reference_video'
  const isAdvancedVideoMode = scene.videoMode === 'advanced_video'
  const supportsReferenceVideo = isVideoModeSupported(selectedModel, 'reference_video')
  const supportsAdvancedVideo = isVideoModeSupported(selectedModel, 'advanced_video')
  const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.filter(option => getModelResolutionIds(selectedModel).includes(option.id))
  const activeVideoResolution = normalizeVideoResolutionForModel(scene.videoResolution, selectedModel)
  const resolutionHint = activeVideoResolution === '1080p' && selectedModel?.price_resolution_multiplier_1080p
    ? `1080P 费用约为 720P 的 ${selectedModel.price_resolution_multiplier_1080p} 倍`
    : selectedModel?.price_note || ''
  const referenceVideoDurationHint = getReferenceVideoDurationHintText(
    scene.refVideoDurationSeconds,
    { model: selectedModel, label: '参考视频' },
  )
  const referenceVideoDuration = normalizeDurationSeconds(scene.refVideoDurationSeconds)
  const referenceVideoDurationInvalid = referenceVideoDuration != null
    && !!getVideoReferenceDurationIssue(referenceVideoDuration, selectedModel, {
      formatDurationSeconds,
      normalizeDurationSeconds,
    })
  const sceneBlockReason = getSceneGenerationBlockReason(scene)
  const runSceneVideo = () => onGenerateVideo(scene.id)
  const sceneActionDisabled = !!sceneBlockReason
  const sceneActionTitle = sceneBlockReason || ''
  const sceneCost = estimateCost(scene)
  const canRetryResultCache = !!scene.taskId && isProviderVideoCacheError(scene.error) && typeof onRetryResultCache === 'function'
  const retryingResultCache = canRetryResultCache && scene.retryingResultCache
  const displayError = formatProviderVideoCacheError(scene.error)
  const renderRetryResultCacheButton = () => (
    <button
      type="button"
      onClick={() => onRetryResultCache(scene.id)}
      disabled={retryingResultCache}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)', cursor: retryingResultCache ? 'default' : 'pointer' }}
    >
      {retryingResultCache ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />}
      重新拉取结果
    </button>
  )

  return (
    <div key={scene.id} className="game-scene-readable" style={{
      background: 'var(--bg-secondary)', borderRadius: 14, border: '1px solid var(--border)',
      borderLeftWidth: 3,
      borderLeftColor: scene.status === 'completed' ? '#10b981' : scene.status === 'failed' ? '#ef4444' : (scene.status === 'processing' || scene.status === 'generating') ? 'var(--accent)' : 'var(--border)',
    }}>
      <style>{`
        .game-scene-readable span,
        .game-scene-readable label,
        .game-scene-readable button,
        .game-scene-readable select,
        .game-scene-readable input {
          font-size: 12px !important;
        }
        .game-scene-readable textarea {
          font-size: 15px !important;
          line-height: 1.8 !important;
        }
        .game-scene-readable label,
        .game-scene-readable span {
          line-height: 1.45;
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: scene.collapsed ? 'none' : '1px solid var(--border)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => onUpdateScene(scene.id, { collapsed: !scene.collapsed })}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>场景 {scene.idx}</span>
        {scene.prompt && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{scene.prompt.slice(0, 50)}</span>}
        <div style={{ flex: 1 }} />
        {saveStatus === 'saving' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', marginRight: 10 }}>
            <Loader2 size={12} className="spin" /> 自动保存中
          </span>
        )}
        {saveStatus === 'saved' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981', marginRight: 10 }}>
            <CheckCircle size={12} /> 已保存
          </span>
        )}
        {saveStatus === 'error' && (
          <span title={saveError} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#ef4444', marginRight: 10, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <AlertCircle size={12} /> 自动保存失败
          </span>
        )}
        {(scene.status === 'processing' || scene.status === 'generating') && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}><Loader2 size={13} className="spin" /> 生成中 ({elapsed(scene.startTime)}s)</span>}
        {scene.status === 'completed' && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981', fontWeight: 600, marginRight: 8 }}><CheckCircle size={13} /> 已完成</span>}
        {scene.status === 'failed' && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#ef4444', fontWeight: 600, marginRight: 8 }}><AlertCircle size={13} /> 失败</span>}
        {scenesCount > 1 && <button onClick={event => { event.stopPropagation(); onRemoveScene(scene.id) }} style={{ background: 'none', color: 'var(--text-muted)', padding: 4 }}><Trash2 size={13} /></button>}
        {scene.collapsed ? <ChevronDown size={16} color="var(--text-muted)" style={{ marginLeft: 4 }} /> : <ChevronUp size={16} color="var(--text-muted)" style={{ marginLeft: 4 }} />}
      </div>

      {!scene.collapsed && (
        <div style={{ padding: 18 }}>
          {isReplace && !scene.refVideoUrl && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 10,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
              fontSize: 11, color: '#ef4444', lineHeight: 1.6, fontWeight: 500,
            }}>
              请先上传参考视频（要替换内容的原视频），系统将自动保持原视频的运镜和动作，仅替换角色或场景。
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <User size={11} color="var(--text-muted)" /><span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>{isReplace ? '替换角色图' : '角色参考图'}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                  <button onClick={() => onOpenGenModal(scene.id, 'character')} title="AI 生成" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><Sparkles size={11} /></button>
                  <button onClick={() => onUploadImage(scene.id, 'character', true)} title="上传文件夹" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><FolderOpen size={11} /></button>
                  <button onClick={() => onUploadImage(scene.id, 'character')} title="上传图片" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><Plus size={12} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 36 }}>
                {scene.charImages.map((img, index) => (
                  <div
                    key={index}
                    role="button"
                    tabIndex={0}
                    title="点击查看大图"
                    onClick={() => onOpenImage(img.url)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenImage(img.url) } }}
                    style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }} />
                    <button type="button" onClick={event => { event.stopPropagation(); onRemoveImage(scene.id, 'character', index) }} style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '0 0 0 3px', padding: 1, lineHeight: 0, zIndex: 1 }}><X size={7} /></button>
                  </div>
                ))}
                {scene.charImages.length === 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0' }}>+ 上传</span>}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <Mountain size={11} color="var(--text-muted)" /><span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>场景参考图</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                  <button onClick={() => onOpenGenModal(scene.id, 'scene')} title="AI 生成" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><Sparkles size={11} /></button>
                  <button onClick={() => onUploadImage(scene.id, 'scene', true)} title="上传文件夹" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><FolderOpen size={11} /></button>
                  <button onClick={() => onUploadImage(scene.id, 'scene')} title="上传图片" style={{ background: 'none', color: 'var(--accent)', padding: 2 }}><Plus size={12} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 36 }}>
                {scene.sceneImages.map((img, index) => (
                  <div
                    key={index}
                    role="button"
                    tabIndex={0}
                    title="点击查看大图"
                    onClick={() => onOpenImage(img.url)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenImage(img.url) } }}
                    style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }} />
                    <button type="button" onClick={event => { event.stopPropagation(); onRemoveImage(scene.id, 'scene', index) }} style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '0 0 0 3px', padding: 1, lineHeight: 0, zIndex: 1 }}><X size={7} /></button>
                  </div>
                ))}
                {scene.sceneImages.length === 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0' }}>+ 上传</span>}
              </div>
            </div>

            {(scene.imageGenHistory || []).length > 0 && (
              <div style={{ width: '100%', flexBasis: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <Sparkles size={10} color="var(--accent)" />
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>AI 生图历史 ({scene.imageGenHistory.length})</span>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {scene.imageGenHistory.map((img, index) => {
                    const usedInChar = scene.charImages.some(item => item.url === img.url)
                    const usedInScene = scene.sceneImages.some(item => item.url === img.url)
                    const isUsed = usedInChar || usedInScene
                    return (
                      <div key={index} style={{ width: 52, position: 'relative', borderRadius: 6, overflow: 'hidden', border: isUsed ? '2px solid var(--accent)' : '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                        <div
                          role="button"
                          tabIndex={0}
                          title="点击查看大图"
                          onClick={() => onOpenImage(img.url)}
                          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenImage(img.url) } }}
                          style={{ cursor: 'pointer', lineHeight: 0 }}
                        >
                          <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: 52, objectFit: 'cover', display: 'block', pointerEvents: 'none', userSelect: 'none' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 1, padding: 1, background: 'var(--bg-tertiary)' }}>
                          <button type="button" onClick={() => onAddHistoryImage(scene.id, img, 'character')} title="添加为角色参考" disabled={usedInChar}
                            style={{ flex: 1, fontSize: 8, padding: '1px 0', background: usedInChar ? 'rgba(139,92,246,0.15)' : 'none', color: usedInChar ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 2, fontWeight: 600, border: 'none', cursor: usedInChar ? 'default' : 'pointer' }}>
                            <User size={8} />
                          </button>
                          <button type="button" onClick={() => onAddHistoryImage(scene.id, img, 'scene')} title="添加为场景参考" disabled={usedInScene}
                            style={{ flex: 1, fontSize: 8, padding: '1px 0', background: usedInScene ? 'rgba(139,92,246,0.15)' : 'none', color: usedInScene ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 2, fontWeight: 600, border: 'none', cursor: usedInScene ? 'default' : 'pointer' }}>
                            <Mountain size={8} />
                          </button>
                        </div>
                        <button type="button" onClick={event => { event.stopPropagation(); onRemoveHistoryImage(scene.id, index) }}
                          style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '0 0 0 4px', padding: 1, lineHeight: 0, zIndex: 2 }}><X size={7} /></button>
                        {isUsed && <span style={{ position: 'absolute', top: 1, left: 1, fontSize: 7, background: 'var(--accent)', color: '#fff', padding: '0 3px', borderRadius: 2, fontWeight: 700 }}>已用</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>模式</label>
                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                  {VIDEO_GENERATION_MODE_OPTIONS.map(mode => {
                    const modeBlockReason = getVideoModeBlockReason(selectedModel, mode.id)
                    const disabled = !!modeBlockReason
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        disabled={disabled}
                        title={modeBlockReason || mode.label}
                        onClick={() => {
                          if (!disabled) onUpdateScene(scene.id, { videoMode: mode.id })
                        }}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 9,
                          fontWeight: 700,
                          background: scene.videoMode === mode.id ? 'rgba(139,92,246,0.12)' : 'var(--bg-primary)',
                          color: disabled ? 'var(--text-muted)' : scene.videoMode === mode.id ? 'var(--accent)' : 'var(--text-muted)',
                          border: scene.videoMode === mode.id ? '1px solid rgba(139,92,246,0.3)' : '1px solid var(--border)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.45 : 1,
                        }}
                      >
                        {mode.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {isReferenceVideoMode ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <Video size={11} color={scene.refVideoUrl ? '#10b981' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: scene.refVideoUrl ? 'var(--text-secondary)' : 'var(--text-muted)' }}>参考视频（必填）</span>
                  </div>
                  {scene.refVideoUrl ? (
                    <>
                      <div style={{ position: 'relative' }}>
                        <video src={mediaUrl(scene.refVideoUrl)} controls preload="none" style={{ width: '100%', maxHeight: 100, borderRadius: 6, background: '#000' }} />
                        <button onClick={() => onUpdateScene(scene.id, { refVideoUrl: '', refVideoDurationSeconds: null })} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 4, padding: 2, lineHeight: 0 }}><X size={10} /></button>
                      </div>
                      {referenceVideoDurationHint && (
                        <div style={{
                          marginTop: 5, fontSize: 9, lineHeight: 1.5,
                          color: referenceVideoDurationInvalid ? '#ef4444' : '#10b981',
                        }}>
                          {referenceVideoDurationHint}
                        </div>
                      )}
                    </>
                  ) : (
                    <button onClick={() => onUploadReferenceVideo(scene.id)} style={{ width: '100%', padding: '14px 0', borderRadius: 6, background: 'var(--bg-primary)', border: '2px dashed var(--border)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                      <Upload size={16} style={{ margin: '0 auto', display: 'block', marginBottom: 3 }} /> 上传参考视频
                    </button>
                  )}
                  <div style={{ marginTop: 5, fontSize: 9, lineHeight: 1.5, color: supportsReferenceVideo ? 'var(--text-muted)' : '#ef4444' }}>
                    {supportsReferenceVideo ? '只上传参考视频并配合提示词即可改写生成，适合保留原动作和镜头。' : '当前模型不支持参考视频生成，请切换支持参考视频的模型。'}
                  </div>
                </>
              ) : isAdvancedVideoMode ? (
                <>
                  {(() => {
                    const advancedVideoCount = (scene.advancedRefVideos || []).length
                    const advancedVideoLimit = getVideoMaxReferenceVideos(selectedModel) || 1
                    const advancedVideoSlotsLeft = Math.max(0, advancedVideoLimit - advancedVideoCount)
                    const advancedUploadLabel = advancedVideoCount > 0
                      ? `追加参考视频（还可 ${advancedVideoSlotsLeft} 个）`
                      : `选择参考视频（最多 ${advancedVideoLimit} 个）`
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                          <Video size={11} color={(scene.advancedRefVideos || []).length ? '#10b981' : 'var(--text-muted)'} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: (scene.advancedRefVideos || []).length ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                            高级参考视频（最多 {advancedVideoLimit} 个）
                          </span>
                        </div>
                        {(scene.advancedRefVideos || []).length > 0 && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                            {(scene.advancedRefVideos || []).map((video, index) => (
                              <div key={`${video.url}-${index}`} style={{ position: 'relative' }}>
                                <video src={mediaUrl(video.url)} controls preload="none" style={{ width: '100%', maxHeight: 82, borderRadius: 6, background: '#000' }} />
                                <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 8, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.62)', borderRadius: 4, padding: '1px 4px' }}>视频{index + 1}</span>
                                <button onClick={() => onRemoveAdvancedVideo(scene.id, index)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 4, padding: 2, lineHeight: 0 }}><X size={10} /></button>
                                {formatDurationSeconds(video.durationSeconds) && (
                                  <div style={{
                                    marginTop: 3, fontSize: 8, lineHeight: 1.4,
                                    color: (() => {
                                      const duration = normalizeDurationSeconds(video.durationSeconds)
                                      if (duration == null) return '#10b981'
                                      return getVideoReferenceDurationIssue(duration, selectedModel, {
                                        formatDurationSeconds,
                                        normalizeDurationSeconds,
                                      }) ? '#ef4444' : '#10b981'
                                    })(),
                                  }}>
                                    {formatDurationSeconds(video.durationSeconds)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(scene.advancedRefVideos || []).length < advancedVideoLimit && (
                          <button onClick={() => onUploadAdvancedVideos(scene.id)} style={{ width: '100%', marginTop: 6, padding: '10px 0', borderRadius: 6, background: 'var(--bg-primary)', border: '2px dashed var(--border)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                            <Upload size={14} style={{ margin: '0 auto', display: 'block', marginBottom: 2 }} /> {advancedUploadLabel}
                          </button>
                        )}
                        <div style={{ marginTop: 5, fontSize: 9, lineHeight: 1.5, color: supportsAdvancedVideo ? 'var(--text-muted)' : '#ef4444' }}>
                          {supportsAdvancedVideo ? `最多 ${advancedVideoLimit} 个参考视频，可叠加最多 ${selectedModel?.max_ref_images || 0} 张角色/场景参考图。视频按上传顺序编号。` : '当前模型不支持高级视频编辑，请切换支持参考视频的模型。'}
                        </div>
                      </>
                    )
                  })()}
                </>
              ) : (
                <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--bg-primary)', border: '1px dashed var(--border)', fontSize: 10, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                  当前为标准生成模式。若想基于一个已有视频改写内容，可切换到“参考视频生成”。
                </div>
              )}
            </div>

            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>模型</label>
                <select value={scene.model} onChange={event => {
                  const model = models.find(item => item.id === event.target.value)
                  onUpdateScene(scene.id, {
                    model: event.target.value,
                    provider: model?.provider || scene.provider,
                    videoMode: normalizeVideoModeForModel(scene.videoMode, model),
                    videoResolution: normalizeVideoResolutionForModel(scene.videoResolution, model),
                  })
                }}
                  style={{ width: '100%', padding: '4px 6px', borderRadius: 5, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10 }}>
                  {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                {modelLimitHint && (
                  <div title={modelLimitHint} style={{ marginTop: 3, fontSize: 9, lineHeight: 1.35, color: 'var(--text-muted)' }}>
                    {modelLimitHint}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 5 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>清晰度</label>
                <select value={activeVideoResolution} onChange={event => onUpdateScene(scene.id, { videoResolution: event.target.value })}
                  style={{ width: '100%', padding: '3px 5px', borderRadius: 5, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10 }}>
                  {resolutionOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                {resolutionHint && (
                  <div title={resolutionHint} style={{ marginTop: 3, fontSize: 9, lineHeight: 1.35, color: 'var(--text-muted)' }}>
                    {resolutionHint}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>时长</label>
                  <input type="number" min={selectedModel?.min_duration || 4} max={selectedModel?.max_duration || 16} value={scene.duration} onChange={event => onUpdateScene(scene.id, { duration: Number(event.target.value) })}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: 5, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>比例</label>
                  <select value={scene.aspectRatio} onChange={event => onUpdateScene(scene.id, { aspectRatio: event.target.value })}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: 5, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10 }}>
                    <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>文本描述</span>
              <select value={scene.aiModel || 'doubao-seed-2-0-pro-260215'} onChange={event => onUpdateScene(scene.id, { aiModel: event.target.value })}
                style={{ marginLeft: 'auto', padding: '1px 4px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 10 }}>
                {AI_MODELS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              <button onClick={() => onGeneratePrompt(scene.id)} disabled={scene._generatingPrompt || !scene.description?.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: scene._generatingPrompt ? 'var(--bg-tertiary)' : 'var(--accent-gradient)', color: '#fff', opacity: !scene.description?.trim() ? 0.4 : 1 }}>
                {scene._generatingPrompt ? <Loader2 size={10} className="spin" /> : <Sparkles size={10} />} 生成提示词
              </button>
            </div>
            <textarea
              id={`game-description-${scene.id}`}
              value={scene.description || ''}
              onChange={event => onUpdateScene(scene.id, { description: event.target.value })}
              placeholder="输入文本描述，AI 将根据描述和参考图生成中文视频提示词..."
              style={{ width: '100%', minHeight: 88, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.75, resize: 'vertical' }} />
            {(scene.charImages.length > 0 || scene.sceneImages.length > 0 || (isReferenceVideoMode && scene.refVideoUrl) || (isAdvancedVideoMode && (scene.advancedRefVideos || []).length > 0)) && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: '20px' }}>插入引用：</span>
                {scene.charImages.map((_, index) => (
                  <button key={`dc${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'character', index, 'description')}
                    style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                    <AtSign size={8} style={{ verticalAlign: -1 }} /> 图片{index + 1}
                  </button>
                ))}
                {scene.sceneImages.map((_, index) => (
                  <button key={`ds${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'scene', index, 'description')}
                    style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                    <AtSign size={8} style={{ verticalAlign: -1 }} /> 场景图{index + 1}
                  </button>
                ))}
                {isReferenceVideoMode && scene.refVideoUrl && (
                  <button type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'video', 0, 'description')}
                    style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                    <AtSign size={8} style={{ verticalAlign: -1 }} /> 视频1
                  </button>
                )}
                {isAdvancedVideoMode && (scene.advancedRefVideos || []).map((_, index) => (
                  <button key={`dv${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'video', index, 'description')}
                    style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                    <AtSign size={8} style={{ verticalAlign: -1 }} /> 视频{index + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>{isReplace ? '补充描述（可选）' : '提示词'}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button onClick={() => onAnalyze(scene.id)} disabled={scene._analyzing} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, fontSize: 10, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)' }}>
                    {scene._analyzing ? <Loader2 size={10} className="spin" /> : <Sparkles size={10} />} AI分析
                  </button>
                  <button onClick={() => onRefresh(scene.id)} disabled={scene._refreshing || !scene.prompt.trim()} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, fontSize: 10, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', opacity: !scene.prompt.trim() ? 0.4 : 1 }}>
                    {scene._refreshing ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />} 刷新
                  </button>
                </div>
              </div>
              <textarea
                id={`game-prompt-${scene.id}`}
                value={scene.prompt}
                onChange={event => onUpdateScene(scene.id, { prompt: event.target.value })}
                placeholder={isReplace
                  ? `可选：补充描述替换细节（留空则自动根据上传素材生成替换指令）\n例：将角色替换为上传的人物，保持原视频的场景和动作`
                  : isAdvancedVideoMode
                    ? `描述你希望如何融合/迁移多个参考视频...\n视频按上传顺序编号，第一个是视频1，第二个是视频2，第三个是视频3。\n例：参考视频1的动作节奏，参考视频2的镜头运动，把主角改成赛博机甲风格`
                    : isReferenceVideoMode
                    ? `描述你希望如何在保留原视频动作/镜头基础上修改内容...\n例：把视频里的 ipad 屏幕替换成箭头游戏画面，可用"视频1"引用参考视频`
                    : `场景 ${scene.idx} 的视频描述...\n可用"图片1""场景图1"引用上方参考图`}
                style={{ width: '100%', minHeight: 150, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.75, resize: 'vertical' }} />
              {(scene.charImages.length > 0 || scene.sceneImages.length > 0 || (isReferenceVideoMode && scene.refVideoUrl) || (isAdvancedVideoMode && (scene.advancedRefVideos || []).length > 0)) && (
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: '20px' }}>插入引用：</span>
                  {scene.charImages.map((_, index) => (
                    <button key={`c${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'character', index)}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                      <AtSign size={8} style={{ verticalAlign: -1 }} /> 图片{index + 1}
                    </button>
                  ))}
                  {scene.sceneImages.map((_, index) => (
                    <button key={`s${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'scene', index)}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                      <AtSign size={8} style={{ verticalAlign: -1 }} /> 场景图{index + 1}
                    </button>
                  ))}
                  {isReferenceVideoMode && scene.refVideoUrl && (
                    <button type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'video', 0)}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                      <AtSign size={8} style={{ verticalAlign: -1 }} /> 视频1
                    </button>
                  )}
                  {isAdvancedVideoMode && (scene.advancedRefVideos || []).map((_, index) => (
                    <button key={`v${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag(scene.id, 'video', index)}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                      <AtSign size={8} style={{ verticalAlign: -1 }} /> 视频{index + 1}
                    </button>
                  ))}
                </div>
              )}
              {displayError && (
                <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{displayError}</span>
                  {canRetryResultCache && renderRetryResultCacheButton()}
                </div>
              )}
            </div>
            <div style={{ width: 220, flexShrink: 0 }}>
              {scene.videoUrl ? (
                <div>
                  <div style={{ position: 'relative' }}>
                    <video src={mediaUrl(scene.videoUrl)} controls preload="none" style={{ width: '100%', borderRadius: 8, background: '#000', display: 'block' }} />
                    <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(16,185,129,0.85)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>当前</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                    <a href={mediaUrl(scene.videoUrl)} download={`场景${scene.idx}.mp4`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: '#10b981', textDecoration: 'none', border: '1px solid rgba(16,185,129,0.2)' }}><Download size={10} /> 下载</a>
                    <button onClick={runSceneVideo} title={sceneActionTitle} disabled={sceneActionDisabled} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 0', borderRadius: 5, fontSize: 10, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', opacity: sceneActionDisabled ? 0.45 : 1 }}><RefreshCw size={10} /> {isAdvancedVideoMode ? '按高级参考重生成' : isReferenceVideoMode ? '按参考视频重生成' : '重新生成'}{sceneCost != null && <span style={{ opacity: 0.6 }}> ≈{sceneCost}元</span>}</button>
                  </div>
                </div>
              ) : (
                <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 8, background: 'var(--bg-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  {scene.status === 'processing' || scene.status === 'generating' ? (
                    <><Loader2 size={18} color="var(--accent)" className="spin" /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>生成中 ({elapsed(scene.startTime)}s)</span></>
                  ) : canRetryResultCache ? (
                    renderRetryResultCacheButton()
                  ) : (
                    <>
                      {(() => {
                        const canRun = !sceneActionDisabled
                        const buttonBg = canRun ? 'var(--accent-gradient)' : 'rgba(124,58,237,0.14)'
                        const buttonColor = canRun ? '#fff' : 'rgba(124,58,237,0.95)'
                        const buttonBorder = canRun ? 'none' : '1px solid rgba(124,58,237,0.25)'
                        const buttonShadow = canRun ? '0 6px 18px rgba(59,130,246,0.22)' : 'none'
                        return (
                          <button onClick={runSceneVideo} title={sceneActionTitle} disabled={!canRun} style={{
                            width: '82%', maxWidth: 260,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            padding: '10px 0', borderRadius: 10, fontSize: 12, fontWeight: 700,
                            background: buttonBg, color: buttonColor, border: buttonBorder, boxShadow: buttonShadow,
                            cursor: canRun ? 'pointer' : 'not-allowed',
                          }}>
                            <Video size={13} />
                            {isAdvancedVideoMode ? '高级视频编辑' : isReferenceVideoMode ? '参考视频生成' : '生成视频'}
                            {sceneCost != null && <span style={{ fontWeight: 600, opacity: canRun ? 0.85 : 0.9 }}>≈{sceneCost}元</span>}
                          </button>
                        )
                      })()}
                    </>
                  )}
                </div>
              )}
              {(scene.videoHistory || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>历史版本 ({scene.videoHistory.length})</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {scene.videoHistory.map((video, index) => (
                      <div key={index} style={{ width: 64, position: 'relative', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border)', cursor: 'pointer', background: '#000' }}
                        onClick={() => onSelectHistoryVideo(scene.id, index)}>
                        <video src={mediaUrl(video.url)} preload="none" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', opacity: 0.85 }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
                          <CheckCircle size={12} color="#fff" style={{ opacity: 0.8 }} />
                        </div>
                        <button onClick={event => { event.stopPropagation(); onRemoveHistoryVideo(scene.id, index) }}
                          style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: '0 0 0 4px', padding: 1, lineHeight: 0, zIndex: 2 }}><X size={7} /></button>
                        <span style={{ position: 'absolute', bottom: 1, left: 2, fontSize: 8, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>v{index + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
