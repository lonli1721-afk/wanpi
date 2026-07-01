import { AtSign, Loader2, Pencil, Sparkles, Upload, X } from 'lucide-react'
import { IMAGE_ASPECT_OPTIONS, IMAGE_QUALITY_OPTIONS } from '../gameVideoConstants'
import { mediaUrl } from '../gameVideoPageHelpers'
import { imageAspectStyleValue, normalizeImageQualityForModel } from '../gameVideoModelUtils'

export default function ImageGenerationModal({
  modal,
  scene,
  history,
  imageModels,
  selectedModel,
  qualityIds,
  model,
  aspectRatio,
  quality,
  prompt,
  refImages,
  editMode: rawEditMode,
  loading,
  cleanImageModelName,
  preventFocusLoss,
  onClose,
  onModelChange,
  onAspectRatioChange,
  onQualityChange,
  onPromptChange,
  onInsertRefTag,
  onUploadReferenceImages,
  onEditModeChange,
  onOpenImage,
  onRemoveReferenceImage,
  onGenerate,
  onAddHistoryImage,
}) {
  if (!modal) return null

  const assetLabel = modal.type === 'character' ? '角色' : '场景'
  const normalizedQuality = normalizeImageQualityForModel(quality, selectedModel)
  const hasGeneratedEditReference = refImages.some(img => img?.source === 'generated')
  const editMode = rawEditMode && hasGeneratedEditReference

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} onClick={() => !loading && onClose()}>
      <div onClick={event => event.stopPropagation()} style={{ width: 480, maxHeight: '80vh', background: 'var(--bg-secondary)', borderRadius: 16, padding: 24, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>AI 生成{assetLabel}参考图</span>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <select value={model} onChange={event => onModelChange(event.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, marginBottom: 10, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, flexShrink: 0 }}>
          {imageModels.map(item => <option key={item.id} value={item.id}>{cleanImageModelName(item.name)}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>比例</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {IMAGE_ASPECT_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => onAspectRatioChange(option.id)}
                style={{
                  minWidth: 46, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: aspectRatio === option.id ? 'rgba(139,92,246,0.14)' : 'var(--bg-primary)',
                  color: aspectRatio === option.id ? 'var(--accent)' : 'var(--text-secondary)',
                  border: aspectRatio === option.id ? '1px solid rgba(139,92,246,0.35)' : '1px solid var(--border)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>清晰度</span>
          <select
            value={normalizedQuality}
            onChange={event => onQualityChange(normalizeImageQualityForModel(event.target.value, selectedModel))}
            style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}
          >
            {IMAGE_QUALITY_OPTIONS
              .filter(option => qualityIds.includes(option.id))
              .map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          {normalizedQuality === '4K' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>更慢</span>}
        </div>

        <textarea
          id="game-gen-prompt"
          value={prompt}
          onChange={event => onPromptChange(event.target.value)}
          placeholder={modal.type === 'character' ? '描述角色外观...' : '描述场景...'}
          style={{ width: '100%', height: 80, padding: 10, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, resize: 'none', flexShrink: 0 }}
        />

        {scene && (scene.charImages.length > 0 || scene.sceneImages.length > 0) && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: '20px' }}>插入引用：</span>
            {scene.charImages.map((_, index) => (
              <button key={`gc${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag('character', index)}
                style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                <AtSign size={8} style={{ verticalAlign: -1 }} /> 图片{index + 1}
              </button>
            ))}
            {scene.sceneImages.map((_, index) => (
              <button key={`gs${index}`} type="button" onMouseDown={preventFocusLoss} onClick={() => onInsertRefTag('scene', index)}
                style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                <AtSign size={8} style={{ verticalAlign: -1 }} /> 场景图{index + 1}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>参考图（图生图）</span>
            <button onClick={onUploadReferenceImages} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
              <Upload size={9} style={{ verticalAlign: -1, marginRight: 2 }} />上传
            </button>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6 }}>可选，上传参考图实现风格/构图迁移</span>
          </div>

          {editMode && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, padding: '7px 9px', borderRadius: 6, background: editMode ? 'rgba(59,130,246,0.10)' : 'var(--bg-primary)', border: editMode ? '1px solid rgba(59,130,246,0.24)' : '1px solid var(--border)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editMode}
                onChange={event => onEditModeChange(event.target.checked)}
              />
              <Pencil size={12} color={editMode ? '#3b82f6' : 'var(--text-muted)'} />
              <span style={{ fontSize: 11, fontWeight: 600, color: editMode ? '#3b82f6' : 'var(--text-secondary)' }}>生成图编辑模式</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>改字 / 局部替换</span>
            </label>
          )}

          {refImages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {refImages.map((img, index) => (
                <div
                  key={index}
                  role="button"
                  tabIndex={0}
                  title="点击查看大图"
                  onClick={() => onOpenImage(img.url)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenImage(img.url) } }}
                  style={{ width: 48, height: 48, borderRadius: 6, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }} />
                  <button type="button" onClick={event => { event.stopPropagation(); onRemoveReferenceImage(index) }} style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '0 0 0 4px', padding: 1, lineHeight: 0, zIndex: 1 }}><X size={8} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onGenerate} disabled={loading || !prompt.trim()} style={{ width: '100%', padding: '10px 0', borderRadius: 8, marginTop: 12, fontSize: 13, fontWeight: 600, background: loading ? 'var(--bg-tertiary)' : 'var(--accent-gradient)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
          {loading ? <><Loader2 size={14} className="spin" /> 生成中...</> : <><Sparkles size={14} /> {editMode ? '编辑生成图' : refImages.length > 0 ? '参考图生成' : '生成图片'}</>}
        </button>

        {history.length > 0 && (
          <div style={{ marginTop: 16, flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>已生成 ({history.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {history.map((img, index) => {
                const usedInType = modal.type === 'character'
                  ? scene?.charImages.some(item => item.url === img.url)
                  : scene?.sceneImages.some(item => item.url === img.url)
                return (
                  <div key={index} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: usedInType ? '2px solid var(--accent)' : '1px solid var(--border)', background: '#000' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      title="点击查看大图"
                      onClick={() => onOpenImage(img.url)}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenImage(img.url) } }}
                      style={{ cursor: 'pointer', lineHeight: 0 }}
                    >
                      <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: imageAspectStyleValue(img.aspectRatio), objectFit: 'cover', display: 'block', pointerEvents: 'none', userSelect: 'none' }} />
                    </div>
                    <div style={{ padding: '4px 6px', background: 'var(--bg-tertiary)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{img.prompt || img.name}</div>
                      <button
                        onClick={() => usedInType ? null : onAddHistoryImage(modal.sceneId, img, modal.type)}
                        disabled={usedInType}
                        style={{
                          width: '100%', padding: '3px 0', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: usedInType ? 'rgba(139,92,246,0.1)' : 'var(--accent-gradient)', color: usedInType ? 'var(--accent)' : '#fff', border: 'none', cursor: usedInType ? 'default' : 'pointer',
                        }}>
                        {usedInType ? '已添加' : '添加为参考图'}
                      </button>
                    </div>
                    {usedInType && <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 9, background: 'var(--accent)', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>已用</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
