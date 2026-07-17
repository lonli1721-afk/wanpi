import { ImageIcon, Loader2, Pencil, RefreshCw, Sparkles, Upload, X } from 'lucide-react'
import { AI_MODELS, IMAGE_ASPECT_OPTIONS, IMAGE_QUALITY_OPTIONS } from '../gameVideoConstants'
import { copyTextToClipboard, mediaUrl } from '../gameVideoPageHelpers'
import { imageAspectStyleValue } from '../gameVideoModelUtils'

export default function ImageGenerationPanel({
  active,
  imageModels,
  model,
  aspectRatio,
  quality,
  qualityIds,
  promptModel,
  prompt,
  refreshing,
  loading,
  refImages,
  editMode: rawEditMode,
  batchCount = 1,
  history,
  cleanImageModelName,
  onModelChange,
  onAspectRatioChange,
  onQualityChange,
  onPromptModelChange,
  onPromptChange,
  onRefreshPrompt,
  onUploadReferenceImages,
  onEditModeChange,
  onBatchCountChange,
  onOpenImage,
  onRemoveReferenceImage,
  onGenerate,
  onRemoveHistoryImage,
  onCopyImageLink,
  onEditHistoryImage,
  maxWidth = 700,
  historyCardWidth,
  historyImageHeight,
  showPromptCopyButton = false,
}) {
  if (!active) return null

  const copyPrompt = async (text) => {
    const value = String(text || prompt || '').trim()
    if (!value) {
      alert('这张图没有记录提示词。')
      return
    }
    const copied = await copyTextToClipboard(value)
    if (!copied) alert('复制失败，请手动选中提示词复制。')
  }

  const editPresets = [
    { id: 'partial', label: '局部重绘', text: '只重绘我描述的局部区域，其它主体、构图、光影、材质和画幅保持不变。' },
    { id: 'outpaint', label: '扩图', text: '在保持主体不变的前提下自然扩展画面边缘，补全环境与背景，保持原图风格和透视。' },
    { id: 'erase', label: '消除笔', text: '移除我指定的物体或文字，并用周围背景自然填充，不留下明显修补痕迹。' },
    { id: 'upscale', label: '超清修复', text: '提升清晰度、细节和质感，修复模糊与噪点，不改变主体造型、构图和颜色风格。' },
    { id: 'text', label: '编辑文字', text: '只替换或修正我指定的文字，尽量保持原文字的位置、字号、字体风格、颜色和材质。' },
  ]

  const hasGeneratedEditReference = refImages.some(img => img?.source === 'generated')
  const editMode = rawEditMode && hasGeneratedEditReference
  const generatedEditMode = editMode
  const showQualityControl = !(Array.isArray(qualityIds) && qualityIds.length === 1 && qualityIds[0] === 'low')

  const applyEditPreset = (text) => {
    if (!hasGeneratedEditReference) return
    const source = prompt.trim()
    onPromptChange(source ? `${source}\n${text}` : text)
    if (!editMode) onEditModeChange(true)
  }

  return (
    <div>
      <div style={{ maxWidth, margin: '0 auto' }}>
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, border: '1px solid var(--border)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ImageIcon size={18} color="var(--accent)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>AI 图片生成</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>文生图 / 参考图引导生成，适合风格与构图迁移</span>
          </div>

          <select
            value={model}
            onChange={event => onModelChange(event.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, marginBottom: 10, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            {imageModels.map(item => <option key={item.id} value={item.id}>{cleanImageModelName(item.name)}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>比例</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {IMAGE_ASPECT_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onAspectRatioChange(option.id)}
                  style={{
                    minWidth: 46,
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
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

          <div style={{ display: showQualityControl ? 'flex' : 'none', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>清晰度</span>
            <select
              value={quality}
              onChange={event => onQualityChange(event.target.value)}
              style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}
            >
              {IMAGE_QUALITY_OPTIONS
                .filter(option => qualityIds.includes(option.id))
                .map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {quality === '4K' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>更慢</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>数量</span>
            <select
              value={batchCount}
              onChange={event => onBatchCountChange?.(Number(event.target.value))}
              style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}
            >
              {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count} 张</option>)}
            </select>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>GPT Image 2 支持一次批量输出</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>提示词</span>
            <select
              value={promptModel}
              onChange={event => onPromptModelChange(event.target.value)}
              style={{ marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 10 }}
            >
              {AI_MODELS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button
              type="button"
              onClick={onRefreshPrompt}
              disabled={refreshing || !prompt.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', opacity: !prompt.trim() ? 0.45 : 1 }}
            >
              {refreshing ? <Loader2 size={10} className="spin" /> : <RefreshCw size={10} />} 润色提示词
            </button>
          </div>
          <textarea
            id="game-imggen-prompt"
            value={prompt}
            onChange={event => onPromptChange(event.target.value)}
            placeholder="描述你想生成的图片内容..."
            style={{ width: '100%', minHeight: 80, padding: 10, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
          />

          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>参考图（图生图）</span>
              <button onClick={onUploadReferenceImages} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)', cursor: 'pointer', fontWeight: 600 }}>
                <Upload size={9} style={{ verticalAlign: -1, marginRight: 2 }} />上传
              </button>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6 }}>可选，上传参考图实现风格/构图迁移</span>
            </div>
            {generatedEditMode && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, padding: '7px 9px', borderRadius: 6, background: editMode ? 'rgba(59,130,246,0.10)' : 'var(--bg-primary)', border: editMode ? '1px solid rgba(59,130,246,0.24)' : '1px solid var(--border)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editMode}
                  onChange={event => onEditModeChange(event.target.checked)}
                />
                <Pencil size={12} color={editMode ? '#3b82f6' : 'var(--text-muted)'} />
                <span style={{ fontSize: 11, fontWeight: 600, color: editMode ? '#3b82f6' : 'var(--text-secondary)' }}>生成图编辑模式</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>可用多张参考图，适合改字、局部修复、扩图、超清和细节修复</span>
              </label>
            )}
            {generatedEditMode && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {editPresets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyEditPreset(preset.text)}
                    style={{ padding: '4px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,0.08)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.18)' }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
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
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpenImage(img.url)
                      }
                    }}
                    style={{ width: 56, height: 56, borderRadius: 6, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }} />
                    <button type="button" onClick={event => { event.stopPropagation(); onRemoveReferenceImage(index) }} style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '0 0 0 4px', padding: 2, lineHeight: 0, zIndex: 1 }}><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            {generatedEditMode && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)', fontSize: 10, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                当前模式会把已上传参考图作为编辑依据，尽量保留主体、构图和材质风格。做角色改色或改字时，提示词里最好明确写明哪些区域可变、哪些区域必须不变。
              </div>
            )}
          </div>

          <button
            onClick={onGenerate}
            disabled={loading || !prompt.trim()}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 8,
              marginTop: 14,
              fontSize: 14,
              fontWeight: 600,
              background: loading ? 'var(--bg-tertiary)' : 'var(--accent-gradient)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {loading ? <><Loader2 size={14} className="spin" /> 生成中...</> : <><Sparkles size={14} /> {generatedEditMode ? '编辑生成图' : refImages.length > 0 ? '参考图生成' : '生成图片'}</>}
          </button>

          {history.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>已生成 ({history.length})</div>
              <div style={historyCardWidth ? { display: 'flex', flexWrap: 'wrap', gap: 10 } : { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {history.map((img, index) => (
                  <div key={index} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: '#000', ...(historyCardWidth ? { flex: `0 0 ${historyCardWidth}px` } : {}) }}>
                    <div
                      role="button"
                      tabIndex={0}
                      title="点击查看大图"
                      onClick={() => onOpenImage(img.url)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onOpenImage(img.url)
                        }
                      }}
                      style={{ cursor: 'pointer', lineHeight: 0 }}
                    >
                      <img src={mediaUrl(img.url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', ...(historyImageHeight ? { height: historyImageHeight } : { aspectRatio: imageAspectStyleValue(img.aspectRatio) }), objectFit: 'cover', display: 'block', pointerEvents: 'none', userSelect: 'none' }} />
                    </div>
                    <button type="button" title="从历史中移除" onClick={() => onRemoveHistoryImage(img.historyIndex ?? index)} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 6, padding: 3, lineHeight: 0, zIndex: 2 }}><X size={12} /></button>
                    <div style={{ padding: '6px 8px', background: 'var(--bg-tertiary)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{img.prompt}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.85, marginBottom: 4 }}>{img.ts ? new Date(img.ts).toLocaleString() : ''}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <a href={mediaUrl(img.url)} download target="_blank" rel="noreferrer" style={{ flex: 1, padding: '3px 0', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', textAlign: 'center', textDecoration: 'none' }}>下载</a>
                        <button type="button" title="复制不带登录凭证的站内链接，访问时仍需登录" onClick={() => onCopyImageLink(img.url)} style={{ flex: 1, padding: '3px 0', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>复制链接</button>
                      </div>
                      {onEditHistoryImage && (
                        <button type="button" onClick={() => onEditHistoryImage(img)} style={{ width: '100%', marginTop: 5, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.22)' }}>编辑这张图</button>
                      )}
                      {showPromptCopyButton && (
                        <button type="button" onClick={() => copyPrompt(img.prompt)} style={{ width: '100%', marginTop: 5, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.22)' }}>复制提示词</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
