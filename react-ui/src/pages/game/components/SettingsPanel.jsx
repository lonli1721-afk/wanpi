import { ChevronLeft, Eye, EyeOff, Key, Loader2, Save, Settings } from 'lucide-react'

const SETTINGS_FIELDS = [
  { key: 'game_gemini_api_keys', label: 'Gemini API Key 池（AI文本分析/生图）', desc: '多个 Key 用英文逗号分隔；遇到 429 会自动切换到下一个 Key，建议使用不同 Google Project 的 Key', color: '#10b981', multiline: true },
  { key: 'game_gemini_api_key', label: 'Gemini API Key（AI文本分析/生图）', desc: '用于游戏工具的AI提示词分析和Gemini图像生成', color: '#10b981' },
  { key: 'game_ark_api_key', label: 'ARK API Key（即梦Seedance/Seedream）', desc: '用于游戏工具的Seedance视频生成和Seedream图片生成', color: '#f59e0b' },
  { key: 'game_vidu_api_key', label: 'VIDU API Key（VIDU视频生成）', desc: '用于游戏工具的VIDU Q3视频生成', color: '#8b5cf6' },
  { key: 'game_dashscope_api_key', label: 'DashScope API Key（万相 / HappyHorse）', desc: '用于阿里云万相视频换人，以及 HappyHorse 视频生成与编辑', color: '#3b82f6' },
]

export default function SettingsPanel({
  gameSettings,
  settingInputs,
  savingKey,
  showKeys,
  onBack,
  onInputChange,
  onToggleShowKey,
  onSave,
}) {
  const apiGroups = Array.isArray(gameSettings.api_usage_groups) ? gameSettings.api_usage_groups : []
  const selectedApiGroup = settingInputs.game_api_usage_group ?? gameSettings.game_api_usage_group ?? ''
  const resolvedApiGroup = gameSettings.resolved_api_usage_group || ''
  const resolvedApiGroupLabel = apiGroups.find(group => group.id === resolvedApiGroup)?.label || (resolvedApiGroup ? resolvedApiGroup : '全局默认')

  return (
    <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: 'none', color: 'var(--text-muted)', padding: 4 }}><ChevronLeft size={20} /></button>
        <Settings size={22} color="var(--accent)" />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>游戏工具 API 设置</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        配置游戏素材工具专用的 API Key，与主应用独立。如未配置则自动使用主应用的 Key。
      </p>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: 20, border: '1px solid var(--border)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Key size={14} color="#f97316" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>当前计费 / API 分组</span>
          <span style={{ fontSize: 10, color: '#f97316', fontWeight: 700, background: 'rgba(249,115,22,0.12)', padding: '2px 6px', borderRadius: 4 }}>当前使用：{resolvedApiGroupLabel}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
          默认会根据账号所属部门/团队自动选择分组；如果管理员共用一个账号，可以在这里手动切换发一混变组、发一项目一部、发一项目二部、发二直投组、发二微信组、发二TT组、发二研发组。
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={selectedApiGroup}
            onChange={event => onInputChange('game_api_usage_group', event.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }}
          >
            <option value="">自动识别 / 全局默认</option>
            {apiGroups.map(group => (
              <option key={group.id} value={group.id}>{group.label} - {group.description || group.department || ''}</option>
            ))}
          </select>
          <button onClick={() => onSave('game_api_usage_group')} disabled={savingKey === 'game_api_usage_group'} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: savingKey === 'game_api_usage_group' ? 'var(--bg-tertiary)' : 'var(--accent-gradient)', color: '#fff',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {savingKey === 'game_api_usage_group' ? <Loader2 size={13} className="spin" /> : <Save size={13} />} 保存
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {SETTINGS_FIELDS.map(({ key, label, desc, color, multiline }) => (
          <div key={key} style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: 20, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Key size={14} color={color} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              {gameSettings[key] && <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600, background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: 4 }}>已配置</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{desc}</p>
            {gameSettings[key] && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>当前: {gameSettings[key]}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                {multiline ? (
                  <textarea
                    id={`game-setting-input-${key}`}
                    value={settingInputs[key] || ''}
                    onChange={event => onInputChange(key, event.target.value)}
                    placeholder="输入多个 API Key，用英文逗号分隔..."
                    rows={3}
                    style={{ width: '100%', minHeight: 72, resize: 'vertical', padding: '8px 36px 8px 12px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.5 }}
                  />
                ) : (
                  <input
                    id={`game-setting-input-${key}`}
                    type={showKeys[key] ? 'text' : 'password'}
                    value={settingInputs[key] || ''}
                    onChange={event => onInputChange(key, event.target.value)}
                    placeholder="输入新的 API Key..."
                    style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }}
                  />
                )}
                <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => onToggleShowKey(key)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text-muted)', padding: 2 }}>
                  {showKeys[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button onClick={() => onSave(key)} disabled={savingKey === key || !settingInputs[key]?.trim()} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: savingKey === key ? 'var(--bg-tertiary)' : 'var(--accent-gradient)', color: '#fff',
                display: 'flex', alignItems: 'center', gap: 4, opacity: !settingInputs[key]?.trim() ? 0.4 : 1,
              }}>
                {savingKey === key ? <Loader2 size={13} className="spin" /> : <Save size={13} />} 保存
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
