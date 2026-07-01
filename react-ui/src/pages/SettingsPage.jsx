import { useState, useEffect, useCallback } from 'react'
import {
  Key, Save, CheckCircle, AlertCircle, Eye, EyeOff,
  Image, Video, Sparkles, Cpu, Plus, Trash2, ChevronDown, ChevronUp,
  Cloud, Upload, Download, RefreshCw, Clock, HardDrive, RotateCcw,
  Palette, Monitor, Sun, Moon, ArrowUpCircle, Info, Apple, Laptop, Lock
} from 'lucide-react'
import { api } from '../services/api'
import SettingsLayout from './settings/components/SettingsLayout'

const NAV_ITEMS = [
  { id: 'apikeys', label: 'ApiKey 设置', icon: Key },
  { id: 'security', label: '账号安全', icon: Lock },
  { id: 'usage', label: '用量统计', icon: HardDrive },
  { id: 'providers', label: '模型配置', icon: Cpu },
  { id: 'theme', label: '主题与外观', icon: Palette },
  { id: 'update', label: '版本升级', icon: ArrowUpCircle },
  { id: 'sync', label: '云端同步', icon: Cloud },
  { id: 'about', label: '关于', icon: Info },
]

function ApiKeyCard({ icon, title, description, linkText, linkUrl, keyName, value, onChange, onSave, saved, error, accent, disabled, badge }) {
  const [show, setShow] = useState(false)
  const color = accent || 'var(--accent)'
  const CardIcon = icon
  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
      padding: 20, marginBottom: 12, border: '1px solid var(--border)',
      opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <CardIcon size={17} style={{ color }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {value && !disabled && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>已配置</span>}
        {badge && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.15)', color: '#d97706' }}>{badge}</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6 }}>
        {description}{' '}
        <a href="#" onClick={e => { e.preventDefault(); window.electronAPI ? window.electronAPI.openBrowserUrl(linkUrl) : window.open(linkUrl) }}>{linkText}</a>
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type={show ? 'text' : 'password'} value={value} disabled={disabled}
            onChange={e => onChange(e.target.value)}
            placeholder={disabled ? '即将推出...' : `输入 ${title}...`}
            style={{ width: '100%', paddingRight: 36, fontSize: 13 }}
          />
          <button onClick={() => setShow(p => !p)} style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', color: 'var(--text-muted)',
          }}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button onClick={onSave} disabled={disabled} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 16px', borderRadius: 7,
          background: disabled ? 'var(--bg-tertiary)' : color, color: disabled ? 'var(--text-muted)' : '#fff',
          fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
        }}>
          <Save size={13} /> 保存
        </button>
      </div>
      {saved === keyName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#10b981', fontSize: 12, marginTop: 8 }}>
          <CheckCircle size={13} /> 已保存
        </div>
      )}
      {error === keyName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#ef4444', fontSize: 12, marginTop: 8 }}>
          <AlertCircle size={13} /> 保存失败
        </div>
      )}
    </div>
  )
}

const API_KEYS = [
  {
    section: 'ApiKey 设置',
    icon: Key,
    items: [
      { key: 'ark_api_key', title: 'ARK_API_KEY（火山引擎：Seedream 生图 + Seedance 生视频）', desc: '用于即梦 Seedream 图片生成和 Seedance 视频生成。前往', link: '火山引擎控制台', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', accent: '#ff6b35' },
      { key: 'vidu_api_key', title: 'VIDU_API_KEY（Vidu 生视频）', desc: '用于 VIDU 视频生成（文生视频/图生视频）。前往', link: 'VIDU 开放平台', url: 'https://platform.vidu.cn/usage', accent: '#8b5cf6' },
      { key: 'hailuo_api_key', title: 'HAILUO_API_KEY（海螺 TTS + 视频）', desc: '用于海螺 TTS 配音和视频生成（支持1080P）。前往', link: 'MiniMax 开放平台', url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', accent: '#06b6d4' },
      { key: 'kling_api_key', title: 'KLING_API_KEY（可灵）', desc: '可灵视频生成（即将推出）。', link: '可灵开放平台', url: 'https://klingai.com/', accent: '#a855f7', disabled: true, badge: '即将推出' },
      { key: 'nanobanana_pro_api_key', title: 'NanoBanana Pro API Key', desc: 'NanoBanana Pro 图像生成。前往', link: 'NanoBanana', url: 'https://grsai.dakka.com.cn', accent: '#f59e0b' },
      { key: 'nanobanana_base_url', title: 'NanoBanana API 根地址（可选）', desc: '留空时优先连接 grsai.dakka.com.cn，失败则自动切换 grsaiapi.com。若需固定节点可填写完整根地址（无末尾斜杠）。', link: '说明', url: 'https://grsai.dakka.com.cn', accent: '#f59e0b', isUrl: true },
    ],
  },
  {
    section: 'AI 对话模型',
    icon: Sparkles,
    items: [
      { key: 'api_proxy_url', title: 'API 代理服务器地址', desc: '国内访问 OpenAI/Gemini 等海外API的代理地址（如 http://47.91.31.32）。设置后自动路由海外API请求。', link: '配置说明', url: '#', accent: '#f43f5e', isUrl: true },
      { key: 'openai_api_key', title: 'OpenAI API Key（GPT Image 2 测试）', desc: '当前本地版本仅用于图片工作台的 GPT Image 2 图片生成测试，其他 GPT 文本模型暂不开放。', link: '配置说明', url: 'https://platform.openai.com/api-keys', accent: '#10a37f' },
      { key: 'openai_base_url', title: 'OpenAI Base URL（自定义地址）', desc: '自定义 OpenAI API 地址。已配置代理服务器时无需填写。', link: '默认地址', url: '#', accent: '#10a37f', isUrl: true },
      { key: 'gemini_api_key', title: 'Google Gemini API Key', desc: '用于 AI 对话、剧本分析。前往', link: 'Google AI Studio', url: 'https://aistudio.google.com/apikey', accent: '#4285f4' },
      { key: 'qwen_api_key', title: '千问 API Key (阿里云百炼)', desc: '用于千问3-32B/235B等模型，国内直连无需代理。前往', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key', accent: '#ff6a00' },
      { key: 'dashscope_api_key', title: 'DashScope API Key（万相视频换人）', desc: '用于阿里云万相 wan2.2-animate-mix 视频换人。前往', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key', accent: '#3b82f6' },
    ],
  },
  {
    section: '图像生成（扩展）',
    icon: Image,
    items: [
      { key: 'fal_api_key', title: 'FAL API Key (Flux)', desc: '用于 Flux 模型图像生成。前往', link: 'fal.ai Dashboard', url: 'https://fal.ai/dashboard/keys', accent: '#667eea' },
      { key: 'hunyuan_secret_id', title: '混元生图 SecretId (腾讯云)', desc: '用于混元生图3.0，原生支持中文提示词。前往', link: '腾讯云 CAM 控制台', url: 'https://console.cloud.tencent.com/cam/capi', accent: '#00a4ff' },
      { key: 'hunyuan_secret_key', title: '混元生图 SecretKey (腾讯云)', desc: '与 SecretId 配对使用。前往', link: '腾讯云 CAM 控制台', url: 'https://console.cloud.tencent.com/cam/capi', accent: '#00a4ff' },
    ],
  },
]

/* ───────── ApiKeys Panel ───────── */
const API_USAGE_GROUPS = [
  { id: 'fa1_hunbian', label: '发一混变组', desc: '发行事业一部 / 混变项目组' },
  { id: 'fa1_project1', label: '发一项目一部', desc: '发行事业一部 / 项目一部' },
  { id: 'fa1_project2', label: '发一项目二部', desc: '发行事业一部 / 项目二部' },
  { id: 'fa1_project3', label: '发一项目三部', desc: '发行事业一部 / 项目三部' },
  { id: 'fa1_creative', label: '发一创意部', desc: '发行事业一部 / 创意部' },
  { id: 'fa1_baoliang', label: '发一爆量组', desc: '发行事业一部 / 爆量组' },
  { id: 'fa2_zhitou', label: '发二直投组', desc: '发行事业二部 / 直投组' },
  { id: 'fa2_wechat', label: '发二微信组', desc: '发行事业二部 / 微信组' },
  { id: 'fa2_tt', label: '发二TT组', desc: '发行事业二部 / TT组' },
  { id: 'fa2_research', label: '发二研发组', desc: '发行事业二部 / 研发组' },
  { id: 'fa3_baoliang', label: '发三爆量组', desc: '发行事业三部 / 发三爆量组' },
  { id: 'market_tt', label: '市场TT组', desc: '市场发展部 / TT组' },
  { id: 'hr_admin_ssc', label: '行政SSC组', desc: '人力资源部 / 行政SSC组' },
]

API_USAGE_GROUPS.push({ id: 'admin_test', label: 'Admin Test', desc: 'Admin / Test' })

const LEGACY_GROUP_API_FIELDS = [
  { suffix: 'ark_api_key', label: '火山 ARK Key', placeholder: 'Seedance / Seedream / Doubao 使用' },
  { suffix: 'gemini_api_key', label: 'Gemini Key 池', placeholder: '支持多个 Key，换行/逗号分隔' },
  { suffix: 'openai_api_key', label: 'OpenAI Key', placeholder: 'GPT / Image2 使用' },
  { suffix: 'openai_base_url', label: 'OpenAI Base URL', placeholder: '可选，如部门有独立代理地址再填写' },
  { suffix: 'qwen_api_key', label: '千问 Key', placeholder: '千问 / 通义相关模型使用' },
  { suffix: 'dashscope_api_key', label: 'DashScope / 万相 Key', placeholder: '欢乐马 / 万相 / 阿里通道使用' },
  { suffix: 'nanobanana_pro_api_key', label: 'NanoBanana Pro Key', placeholder: 'NanoBanana Pro / 高质量通道' },
  { suffix: 'nanobanana_base_url', label: 'NanoBanana Base URL', placeholder: '可选，如部门有独立代理地址再填写' },
  { suffix: 'vidu_api_key', label: 'VIDU Key', placeholder: 'VIDU 视频模型使用' },
  { suffix: 'hailuo_api_key', label: '海螺 Key', placeholder: '海螺视频模型使用' },
  { suffix: 'fal_api_key', label: 'FAL Key', placeholder: 'FAL 图片/视频模型使用' },
  { suffix: 'hunyuan_secret_id', label: '腾讯混元 SecretId', placeholder: '腾讯混元 SecretId' },
  { suffix: 'hunyuan_secret_key', label: '腾讯混元 SecretKey', placeholder: '腾讯混元 SecretKey' },
]

const GROUP_API_FIELDS = [
  { suffix: 'api_proxy_url', label: '部门 API 代理服务器地址', placeholder: '例如：http://43.167.187.203', desc: '部门公用的海外 API 代理地址，Gemini / OpenAI 等通道优先使用。', link: '配置说明', url: '#', isUrl: true },
  { suffix: 'openai_base_url', label: 'OpenAI Base URL', placeholder: '可选，例如：https://api.openai.com/v1', desc: '部门公用的 OpenAI 兼容模型地址；如已填写部门代理，可不填。', link: 'OpenAI 文档', url: 'https://platform.openai.com/docs', isUrl: true },
  { suffix: 'nanobanana_base_url', label: 'NanoBanana Base URL', placeholder: '可选，部门独立 NanoBanana 地址', desc: '部门公用的 NanoBanana 模型地址，留空则由后端默认策略处理。', link: 'NanoBanana', url: 'https://grsai.dakka.com.cn', isUrl: true },
  { suffix: 'ark_api_key', label: '火山引擎 ARK Key', placeholder: 'Seedream 图片生成 / Seedance 视频生成 / Doubao 使用', desc: '用于即梦 Seedream 图片生成和 Seedance 视频生成。', link: '火山引擎控制台', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { suffix: 'gemini_api_key', label: 'Gemini Key 池', placeholder: '支持多个 Key，换行/逗号分隔', desc: '用于 Gemini 分析、反推、提示词生成等。', link: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  { suffix: 'openai_api_key', label: 'OpenAI Key', placeholder: 'GPT / Image2 使用', desc: '用于 OpenAI 相关模型和 Image2 内测能力。', link: 'OpenAI API Keys', url: 'https://platform.openai.com/api-keys' },
  { suffix: 'dashscope_api_key', label: '阿里云 DashScope Key', placeholder: '阿里云百炼 / 万相 / 欢乐马通道使用', desc: '用于阿里云百炼、万相视频换人和欢乐马相关能力。', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
  { suffix: 'qwen_api_key', label: '阿里云千问 Key', placeholder: '千问 / 通义相关模型使用', desc: '如千问通道与 DashScope 独立计费，可单独填写。', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
  { suffix: 'nanobanana_pro_api_key', label: 'NanoBanana Pro Key', placeholder: 'NanoBanana Pro / 高质量通道 Key', desc: '用于 NanoBanana Pro 或高质量图像生成通道。', link: 'NanoBanana', url: 'https://grsai.dakka.com.cn' },
]

const DEPARTMENT_API_FIELDS = [
  { suffix: 'api_proxy_url', label: 'API 代理服务器地址', placeholder: '输入 API 代理服务器地址 ...', desc: '国内访问 OpenAI/Gemini 等海外API的代理地址（如 http://47.91.31.32）。设置后自动路由海外API请求。', link: '配置说明', url: '#', isUrl: true },
  { suffix: 'openai_base_url', label: 'OpenAI Base URL（自定义地址）', placeholder: '输入 OpenAI Base URL（自定义地址） ...', desc: '自定义 OpenAI API 地址。已配置代理服务器时无需填写。', link: '默认地址', url: '#', isUrl: true },
  { suffix: 'nanobanana_base_url', label: 'NanoBanana API 根地址（可选）', placeholder: '输入 NanoBanana API 根地址（可选） ...', desc: '留空时优先连接 grsai.dakka.com.cn，失败则自动切换 grsaiapi.com。若需固定节点可填写完整根地址（无末尾斜杠）。', link: '说明', url: 'https://grsai.dakka.com.cn', isUrl: true },
  { suffix: 'ark_api_key', label: 'ARK_API_KEY（火山引擎：Seedream 生图 + Seedance 生视频）', placeholder: '输入 ARK_API_KEY ...', desc: '用于即梦 Seedream 图片生成和 Seedance 视频生成。前往', link: '火山引擎控制台', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { suffix: 'gemini_api_key', label: 'Google Gemini API Key', placeholder: '输入 Google Gemini API Key ...', desc: '用于 AI 对话、剧本分析。前往', link: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  { suffix: 'openai_api_key', label: 'OpenAI API Key（GPT Image 2 测试）', placeholder: '输入 OpenAI API Key ...', desc: '当前本地版本仅用于图片工作台的 GPT Image 2 图片生成测试，其他 GPT 文本模型暂不开放。', link: '配置说明', url: 'https://platform.openai.com/api-keys' },
  { suffix: 'qwen_api_key', label: '千问 API Key (阿里云百炼)', placeholder: '输入千问 API Key ...', desc: '用于千问3-32B/235B等模型，国内直连无需代理。前往', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
  { suffix: 'dashscope_api_key', label: 'DashScope API Key（万相视频换人）', placeholder: '输入 DashScope API Key ...', desc: '用于阿里云万相 wan2.2-animate-mix 视频换人。前往', link: '阿里云百炼控制台', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
  { suffix: 'nanobanana_pro_api_key', label: 'NanoBanana Pro API Key', placeholder: '输入 NanoBanana Pro API Key ...', desc: 'NanoBanana Pro 图像生成。前往', link: 'NanoBanana', url: 'https://grsai.dakka.com.cn' },
]

const MULERUN_STUDIO_FIELDS = [
  { suffix: 'mulerun_studio_enabled', label: 'MuleRun Studio Enabled', placeholder: 'true / false', desc: 'Enable local MuleRun Studio for GPT Image 2. Each group must configure its own MuleRun Token below.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio', isUrl: true, plainText: true },
  { suffix: 'mulerun_cli_path', label: 'MuleRun CLI Path', placeholder: 'mulerun', desc: 'Optional. Use mulerun from PATH by default, or fill a full mulerun.cmd path on Windows.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio', isUrl: true, plainText: true },
  { suffix: 'mulerun_gpt_image_endpoint', label: 'MuleRun GPT Image Endpoint', placeholder: 'openai/gpt-image-2/generation', desc: 'Studio endpoint for GPT Image 2 text-to-image generation.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio', isUrl: true, plainText: true },
  { suffix: 'mulerun_gpt_image_edit_endpoint', label: 'MuleRun GPT Image Edit Endpoint', placeholder: 'openai/gpt-image-2/edit', desc: 'Studio endpoint for GPT Image 2 reference-image editing.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio', isUrl: true, plainText: true },
  { suffix: 'mulerun_max_wait_seconds', label: 'MuleRun Max Wait Seconds', placeholder: '900', desc: 'Maximum Studio wait time for one image task.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio', isUrl: true, plainText: true },
]

const COMMON_API_ADDRESS_FIELDS = [
  ...DEPARTMENT_API_FIELDS.filter(field => field.isUrl),
  ...MULERUN_STUDIO_FIELDS,
]
const DEPARTMENT_KEY_FIELDS = [
  ...DEPARTMENT_API_FIELDS.filter(field => !field.isUrl),
  { suffix: 'mulerun_token', label: 'MuleRun Token', placeholder: 'Current group MuleRun token', desc: 'Used by GPT Image 2 through MuleRun Studio. This token is isolated per group and will not fall back to local mulerun login.', link: 'MuleRun Studio', url: 'https://mulerun.com/docs/cli/commands/studio' },
]

function groupApiTheme(groupId) {
  return {
    fa1_hunbian: { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.22)', mark: 'HB' },
    fa1_project2: { color: '#2563eb', bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.22)', mark: 'P2' },
    fa1_project1: { color: '#4f46e5', bg: 'rgba(79,70,229,0.08)', border: 'rgba(79,70,229,0.22)', mark: 'P1' },
    fa1_project3: { color: '#0f766e', bg: 'rgba(15,118,110,0.08)', border: 'rgba(15,118,110,0.22)', mark: 'P3' },
    fa1_creative: { color: '#d946ef', bg: 'rgba(217,70,239,0.08)', border: 'rgba(217,70,239,0.22)', mark: 'CY' },
    fa1_baoliang: { color: '#dc2626', bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.22)', mark: 'BL' },
    fa2_zhitou: { color: '#0891b2', bg: 'rgba(8,145,178,0.08)', border: 'rgba(8,145,178,0.22)', mark: 'ZT' },
    fa2_wechat: { color: '#059669', bg: 'rgba(5,150,105,0.08)', border: 'rgba(5,150,105,0.22)', mark: 'WX' },
    fa2_tt: { color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.22)', mark: 'TT' },
    fa2_research: { color: '#db2777', bg: 'rgba(219,39,119,0.08)', border: 'rgba(219,39,119,0.22)', mark: 'RD' },
    fa3_baoliang: { color: '#b45309', bg: 'rgba(180,83,9,0.08)', border: 'rgba(180,83,9,0.22)', mark: 'F3' },
    market_tt: { color: '#16a34a', bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.22)', mark: 'MK' },
    hr_admin_ssc: { color: '#9333ea', bg: 'rgba(147,51,234,0.08)', border: 'rgba(147,51,234,0.22)', mark: 'HR' },
  }[groupId] || { color: 'var(--accent)', bg: 'var(--accent-light)', border: 'var(--border-accent)', mark: 'API' }
}

function groupFieldMeta(suffix) {
  if (suffix.includes('proxy') || suffix.includes('base_url')) {
    return { icon: Cloud, color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)', border: 'rgba(14,165,233,0.18)', tag: '地址' }
  }
  if (suffix.includes('ark')) {
    return { icon: Cpu, color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.18)', tag: '火山' }
  }
  if (suffix.includes('gemini')) {
    return { icon: Sparkles, color: '#4285f4', bg: 'rgba(66,133,244,0.08)', border: 'rgba(66,133,244,0.18)', tag: 'Gemini' }
  }
  if (suffix.includes('openai')) {
    return { icon: Sparkles, color: '#10a37f', bg: 'rgba(16,163,127,0.08)', border: 'rgba(16,163,127,0.18)', tag: 'OpenAI' }
  }
  if (suffix.includes('dashscope') || suffix.includes('qwen')) {
    return { icon: Cpu, color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.18)', tag: '阿里云' }
  }
  if (suffix.includes('nanobanana')) {
    return { icon: Key, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', tag: 'Nano' }
  }
  return { icon: Key, color: 'var(--accent)', bg: 'var(--accent-light)', border: 'var(--border-accent)', tag: 'Key' }
}

function maskKey(value) {
  if (!value) return ''
  if (value.length <= 8) return '***'
  return `${'*'.repeat(8)}${value.slice(-4)}`
}

function GroupApiKeysPanel({ keys, saved, error, onUpdateKey, onSaveKey }) {
  const [showMap, setShowMap] = useState({})
  const toggleShow = key => setShowMap(prev => ({ ...prev, [key]: !prev[key] }))
  const openFieldLink = (url) => {
    if (!url || url === '#') return
    if (window.electronAPI) window.electronAPI.openBrowserUrl(url)
    else window.open(url)
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Key size={15} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>分组 API Key</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 14 }}>
        按发一混变组、发一项目一部、发一项目二部、发二直投组、发二微信组、发二TT组、发二研发组分别配置各模型通道 Key。成员发起任务时只使用所属部门/组的 Key；未配置时不会回退全局 Key，需要先补齐对应分组配置。
      </p>
      <div style={{ borderRadius: 18, marginBottom: 18, border: '1px solid rgba(14,165,233,0.24)', background: 'linear-gradient(135deg, rgba(14,165,233,0.09), rgba(255,255,255,0.96) 46%)', boxShadow: '0 12px 28px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid rgba(14,165,233,0.18)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7', background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.24)' }}>
            <Cloud size={19} />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>公共模型地址</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>所有部门共用的代理地址 / Base URL，只需要在这里填写一次。</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 13, padding: 18 }}>
          {COMMON_API_ADDRESS_FIELDS.map(field => {
            const key = field.suffix
            const value = keys[key] || ''
            const visible = showMap[key]
            const meta = groupFieldMeta(field.suffix)
            const FieldIcon = meta.icon
            return (
              <div key={key} style={{ border: `1px solid ${meta.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 13, padding: 16, background: `linear-gradient(90deg, ${meta.bg}, var(--bg-primary) 30%)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                    <FieldIcon size={16} />
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{field.label}</span>
                  {value && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700, background: 'rgba(16,185,129,0.1)', padding: '2px 7px', borderRadius: 7 }}>已配置</span>}
                </div>
                {field.desc && (
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
                    {field.desc}{' '}
                    {field.url && field.url !== '#' && (
                      <a href="#" onClick={event => { event.preventDefault(); openFieldLink(field.url) }}>{field.link || '前往控制台'}</a>
                    )}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type={visible ? 'text' : 'password'}
                      value={value}
                      onChange={event => onUpdateKey(key, event.target.value)}
                      placeholder={field.placeholder}
                      style={{ width: '100%', paddingRight: 38, fontSize: 14 }}
                    />
                    <button type="button" onClick={() => toggleShow(key)} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text-muted)' }}>
                      {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button type="button" onClick={() => onSaveKey(key, value)} style={{ padding: '7px 15px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                    保存
                  </button>
                </div>
                {value && !visible && <div style={{ marginTop: 7, fontSize: 12, color: 'var(--text-muted)' }}>当前：{maskKey(value)}</div>}
                {saved === key && <div style={{ marginTop: 7, color: '#10b981', fontSize: 12 }}>已保存</div>}
                {error === key && <div style={{ marginTop: 7, color: '#ef4444', fontSize: 12 }}>保存失败</div>}
              </div>
            )
          })}
        </div>
      </div>
      {API_USAGE_GROUPS.map(group => (
        <div key={group.id} style={{ background: `linear-gradient(135deg, ${groupApiTheme(group.id).bg}, var(--bg-secondary) 42%)`, borderRadius: 16, padding: 0, marginBottom: 16, border: `1px solid ${groupApiTheme(group.id).border}`, boxShadow: '0 10px 24px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: `1px solid ${groupApiTheme(group.id).border}`, background: `linear-gradient(90deg, ${groupApiTheme(group.id).bg}, transparent)` }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800, background: groupApiTheme(group.id).color, boxShadow: `0 8px 18px ${groupApiTheme(group.id).border}` }}>
              {groupApiTheme(group.id).mark}
            </div>
            <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{group.label}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{group.desc}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: 16 }}>
            {DEPARTMENT_KEY_FIELDS.map(field => {
              const key = `group_api_${group.id}_${field.suffix}`
              const value = keys[key] || ''
              const visible = showMap[key]
              const meta = groupFieldMeta(field.suffix)
              const FieldIcon = meta.icon
              return (
                <div key={key} style={{ border: `1px solid ${meta.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 12, padding: 14, background: `linear-gradient(90deg, ${meta.bg}, var(--bg-primary) 28%)` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                      <FieldIcon size={15} />
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{field.label}</span>
                    {value && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700, background: 'rgba(16,185,129,0.1)', padding: '2px 7px', borderRadius: 7 }}>已配置</span>}
                  </div>
                  {field.desc && (
                    <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
                      {field.desc}{' '}
                      {field.url && field.url !== '#' && (
                        <a href="#" onClick={event => { event.preventDefault(); openFieldLink(field.url) }}>{field.link || '前往控制台'}</a>
                      )}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type={field.isUrl || visible ? 'text' : 'password'}
                        value={value}
                        onChange={event => onUpdateKey(key, event.target.value)}
                        placeholder={field.placeholder}
                        style={{ width: '100%', paddingRight: field.isUrl ? 12 : 34, fontSize: 14 }}
                      />
                      <button type="button" onClick={() => toggleShow(key)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text-muted)' }}>
                        {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <button type="button" onClick={() => onSaveKey(key, value)} style={{ padding: '7px 15px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                      保存
                    </button>
                  </div>
                  {value && !visible && <div style={{ marginTop: 7, fontSize: 12, color: 'var(--text-muted)' }}>当前：{maskKey(value)}</div>}
                  {saved === key && <div style={{ marginTop: 7, color: '#10b981', fontSize: 12 }}>已保存</div>}
                  {error === key && <div style={{ marginTop: 7, color: '#ef4444', fontSize: 12 }}>保存失败</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function ApiKeysPanel({ keys, saved, error, onUpdateKey, onSaveKey }) {
  return (
    <GroupApiKeysPanel keys={keys} saved={saved} error={error} onUpdateKey={onUpdateKey} onSaveKey={onSaveKey} />
  )

  return (
    <div>
      {API_KEYS.map(section => (
        <div key={section.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 8 }}>
            <section.icon size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>{section.section}</span>
          </div>
          {section.items.map(item => (
            <ApiKeyCard
              key={item.key} icon={section.icon} title={item.title} keyName={item.key}
              description={item.desc} linkText={item.link} linkUrl={item.url} accent={item.accent}
              value={keys[item.key] || ''} onChange={v => onUpdateKey(item.key, v)}
              onSave={() => onSaveKey(item.key, keys[item.key] || '')}
              saved={saved} error={error} disabled={item.disabled} badge={item.badge}
            />
          ))}
        </div>
      ))}
      <GroupApiKeysPanel keys={keys} saved={saved} error={error} onUpdateKey={onUpdateKey} onSaveKey={onSaveKey} />
    </div>
  )
}

/* ───────── Provider Panel ───────── */
function ProvidersPanel({ providers, onUpdate, onAdd, onDelete, onSave, saved }) {
  const [expanded, setExpanded] = useState(null)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Cpu size={15} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>模型配置 (Provider)</span>
        <button onClick={onAdd} style={{
          marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, fontSize: 11,
          background: 'var(--accent)', color: '#fff', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4,
        }}><Plus size={11} /> 添加 Provider</button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
        配置自定义 AI 模型提供商。每个 Provider 可设置独立的 API URL、API Key 和模型参数。支持 OpenAI 兼容格式。
      </p>
      {providers.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', borderRadius: 'var(--radius)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}>
          暂无自定义 Provider 配置。点击上方「添加」按钮创建。
        </div>
      )}
      {providers.map((p, i) => (
        <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 10, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setExpanded(expanded === i ? null : i)}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{p.name || `Provider #${i + 1}`}</span>
            {p.apiKey && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: 'var(--accent)' }}>已配置</span>}
            <button onClick={(e) => { e.stopPropagation(); onDelete(i) }} style={{ padding: '3px 6px', borderRadius: 4, background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)' }}><Trash2 size={12} /></button>
            {expanded === i ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
          </div>
          {expanded === i && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: '名称', field: 'name', ph: '如：DeepSeek, GPT-4o, 通义千问...' },
                { label: 'API URL', field: 'apiUrl', ph: 'https://api.openai.com/v1 或兼容接口...' },
                { label: 'API Key', field: 'apiKey', ph: 'sk-...', type: 'password' },
                { label: '模型名称', field: 'model', ph: 'gpt-4o, deepseek-chat, qwen-max...' },
              ].map(f => (
                <div key={f.field}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{f.label}</label>
                  <input type={f.type || 'text'} value={p[f.field] || ''} onChange={e => onUpdate(i, f.field, e.target.value)} placeholder={f.ph} style={{ width: '100%', fontSize: 12 }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Max Tokens</label>
                <input type="number" value={p.maxTokens || 8192} onChange={e => onUpdate(i, 'maxTokens', Number(e.target.value))} style={{ width: 120, fontSize: 12 }} />
              </div>
            </div>
          )}
        </div>
      ))}
      {providers.length > 0 && (
        <button onClick={onSave} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 8, marginTop: 8,
          background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13,
        }}><Save size={14} /> 保存 Provider 配置</button>
      )}
      {saved === 'providers' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#10b981', fontSize: 12, marginTop: 8 }}>
          <CheckCircle size={13} /> Provider 配置已保存
        </div>
      )}
    </div>
  )
}

/* ───────── Theme Panel ───────── */
const THEME_MODES = [
  { id: 'system', label: '跟随系统', desc: '自动跟随操作系统外观设置', icon: Monitor },
  { id: 'light', label: '浅色', desc: '适合明亮环境', icon: Sun },
  { id: 'dark', label: '深色', desc: '在低光环境下降低眩光', icon: Moon },
]

const COLOR_PRESETS = [
  { id: '', label: '经典紫罗兰', desc: '默认主题色，优雅现代', colors: ['#8b5cf6', '#6366f1', '#a78bfa'] },
  { id: 'ocean', label: '海洋蓝', desc: '灵感来自 IDE 界面的冷静蓝色', colors: ['#2563eb', '#3b82f6', '#60a5fa'] },
  { id: 'emerald', label: '森林绿', desc: '专业工具常见的舒适绿色', colors: ['#059669', '#10b981', '#34d399'] },
  { id: 'rose', label: '经典粉色', desc: '经典粉灰工作流风格', colors: ['#e11d48', '#f43f5e', '#fb7185'] },
  { id: 'amber', label: '日落琥珀', desc: '暖色高对比，适合快速聚焦', colors: ['#d97706', '#f59e0b', '#fbbf24'] },
  { id: 'slate', label: '石墨灰', desc: '低饱和中性色，适合长时间工作', colors: ['#334155', '#64748b', '#94a3b8'] },
]

const VALID_THEME_MODES = new Set(THEME_MODES.map(t => t.id))

const getSystemTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const getStoredThemeMode = () => {
  const savedTheme = localStorage.getItem('wanpi_theme')
  return VALID_THEME_MODES.has(savedTheme) ? savedTheme : 'system'
}

function ThemePanel() {
  const [mode, setMode] = useState(getStoredThemeMode)
  const [systemMode, setSystemMode] = useState(getSystemTheme)
  const [color, setColor] = useState(() => localStorage.getItem('wanpi_color') || '')

  const applyTheme = (m) => {
    setMode(m)
    localStorage.setItem('wanpi_theme', m)
    const resolved = m === 'system' ? getSystemTheme() : m
    document.documentElement.setAttribute('data-theme', resolved)
  }

  const applyColor = (c) => {
    setColor(c)
    localStorage.setItem('wanpi_color', c)
    if (c) document.documentElement.setAttribute('data-color', c)
    else document.documentElement.removeAttribute('data-color')
  }

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const resolved = getSystemTheme()
      setSystemMode(resolved)
      if (getStoredThemeMode() === 'system') {
        document.documentElement.setAttribute('data-theme', resolved)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedMode = mode === 'system' ? systemMode : mode

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>主题与外观</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>选择应用外观模式和主题配色</p>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>外观模式</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {THEME_MODES.map(t => {
            const active = mode === t.id
            return (
              <div key={t.id} onClick={() => applyTheme(t.id)} style={{
                padding: '14px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                background: active ? 'var(--accent-light)' : 'var(--bg-secondary)',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <t.icon size={16} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{t.label}</span>
                  {active && <CheckCircle size={14} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.desc}</div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>当前实际模式：{resolvedMode}</div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>配色主题预设</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {COLOR_PRESETS.map(c => {
            const active = color === c.id
            return (
              <div key={c.id} onClick={() => applyColor(c.id)} style={{
                padding: '14px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                background: active ? 'var(--accent-light)' : 'var(--bg-secondary)',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{c.label}</span>
                  {active && <CheckCircle size={14} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{c.desc}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {c.colors.map((clr, i) => (
                    <div key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: clr }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ───────── Update Panel ───────── */
function UpdatePanel() {
  const [checking, setChecking] = useState(false)
  const [localVersion, setLocalVersion] = useState(() => {
    const stored = localStorage.getItem('wanpi_local_version')
    if (!stored) return null
    try {
      return JSON.parse(stored)
    } catch (e) {
      console.warn('Invalid local version cache', e)
      return null
    }
  })
  const [remoteVersion, setRemoteVersion] = useState(null)
  const [changelog, setChangelog] = useState([])
  const [downloading, setDownloading] = useState(false)
  const [lastCheck, setLastCheck] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('check')
  const [platform, setPlatform] = useState(() => {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('mac')) return 'macos'
    if (ua.includes('linux')) return 'linux'
    return 'windows'
  })

  useEffect(() => {
    const fetchLocal = async () => {
      try {
        const base = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${base}/api/local-config`)
        if (res.ok) {
          const d = await res.json()
          const lv = { version: d.version, build_date: d.build_date }
          setLocalVersion(lv)
          localStorage.setItem('wanpi_local_version', JSON.stringify(lv))
        }
      } catch (e) {
        console.warn('Failed to load local version', e)
      }
    }
    fetchLocal()
  }, [])

  const isNewer = (remote, local) => {
    if (!remote || !local) return false
    const rv = remote.split('.').map(Number)
    const lv = local.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if ((rv[i] || 0) > (lv[i] || 0)) return true
      if ((rv[i] || 0) < (lv[i] || 0)) return false
    }
    return false
  }

  const checkUpdate = async () => {
    setChecking(true)
    setError('')
    try {
      const cloudUrl = localStorage.getItem('wanpi_cloud_url')
      if (!cloudUrl) {
        setError('请先在「云端同步」中配置并连接云服务器地址')
        return
      }
      const res = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/version`)
      if (!res.ok) throw new Error(`服务器响应失败 (${res.status})`)
      const data = await res.json()
      setRemoteVersion(data)
      setChangelog(data.changelog || [])
      setLastCheck(new Date().toLocaleString())
    } catch (e) {
      setError(`检查失败: ${e.message}`)
    } finally {
      setChecking(false)
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setError('')
    try {
      const cloudUrl = localStorage.getItem('wanpi_cloud_url')
      if (!cloudUrl) throw new Error('未连接云服务器')

      const base = cloudUrl.replace(/\/+$/, '')
      const res = await fetch(`${base}/api/download/installer?platform=${platform}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || localStorage.getItem('wanpi_cloud_token') || ''}`,
        },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `下载失败 (${res.status})`)
      }

      const blob = await res.blob()
      const ext = platform === 'macos' ? '.dmg' : platform === 'linux' ? '.AppImage' : '.exe'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `WanpiAI_${remoteVersion?.version || 'latest'}${ext}`
      a.click()
      URL.revokeObjectURL(url)

      if (remoteVersion) {
        localStorage.setItem('wanpi_local_version', JSON.stringify({
          version: remoteVersion.version,
          build_date: remoteVersion.build_date,
        }))
        setLocalVersion({ version: remoteVersion.version, build_date: remoteVersion.build_date })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const directDownloadUrl = (() => {
    const cloudUrl = (localStorage.getItem('wanpi_cloud_url') || '').replace(/\/+$/, '')
    if (!cloudUrl) return null
    const fname = platform === 'macos' ? 'WanpiAI.dmg' : platform === 'linux' ? 'WanpiAI.AppImage' : 'WanpiAI.exe'
    return `${cloudUrl}/download/${fname}`
  })()

  const hasUpdate = remoteVersion && localVersion && isNewer(remoteVersion.version, localVersion.version)

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>版本升级</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>自动检查版本并管理历史更新记录，支持 Windows 和 macOS 桌面平台。</p>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 4, border: '1px solid var(--border)' }}>
        {[{ id: 'check', label: '版本检查' }, { id: 'history', label: '版本历史' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
            background: tab === t.id ? 'var(--accent)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.2s',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'check' && (
        <div>
          {/* Platform selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { id: 'windows', label: 'Windows', icon: Laptop },
              { id: 'macos', label: 'macOS', icon: Apple },
            ].map(p => (
              <button key={p.id} onClick={() => setPlatform(p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                background: platform === p.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                border: `1px solid ${platform === p.id ? 'var(--accent)' : 'var(--border)'}`,
                color: platform === p.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 500, transition: 'all 0.2s',
              }}>
                <p.icon size={15} /> {p.label}
              </button>
            ))}
          </div>

          {hasUpdate && (
            <div style={{
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 'var(--radius)', padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <AlertCircle size={16} style={{ color: '#f59e0b' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>
                  检测到新的桌面版本：{remoteVersion.version}
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                为保证最佳体验，建议尽快完成下载安装。
              </p>
            </div>
          )}

          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
            padding: 18, border: '1px solid var(--border)', marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                当前版本：<strong style={{ color: 'var(--text-primary)' }}>{localVersion?.version || '未知'}</strong>
                &nbsp;&middot;&nbsp;平台：<strong style={{ color: 'var(--text-primary)' }}>{platform}</strong>
              </span>
              <button onClick={checkUpdate} disabled={checking} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px',
                borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff',
                fontWeight: 600, fontSize: 13,
              }}>
                {checking ? <><RefreshCw size={14} className="spin" /> 检查中...</> : '检查新版本'}
              </button>
            </div>
            {lastCheck && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>最近一次检查：{lastCheck}</div>}
          </div>

          {hasUpdate && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
              padding: 18, border: '1px solid var(--border)', marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>最新版本：{remoteVersion.version}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>发布日期：{remoteVersion.build_date}</div>
              {changelog.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>本次更新</div>
                  {changelog[0]?.changes?.map((c, i) => (
                    <div key={i}>&bull; {c}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleDownload} disabled={downloading} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px',
                  borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
                  background: downloading ? 'var(--bg-tertiary)' : 'var(--accent)', color: '#fff',
                }}>
                  {downloading
                    ? <><RefreshCw size={14} className="spin" /> 下载中...</>
                    : <><Download size={14} /> 下载 {platform === 'macos' ? '.dmg' : '.exe'} 安装包</>}
                </button>
                {directDownloadUrl && (
                  <a href={directDownloadUrl} download style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
                    borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border)', textDecoration: 'none',
                  }}>
                    直接下载链接
                  </a>
                )}
              </div>
              {platform === 'macos' && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  <strong style={{ color: '#f59e0b' }}>macOS 安装提示：</strong>首次安装若提示「已损坏」，请打开终端执行：
                  <code style={{ display: 'block', marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-tertiary)', fontSize: 12, color: 'var(--accent)', fontFamily: 'monospace' }}>sudo xattr -cr /Applications/玩皮\ AI.app</code>
                </div>
              )}
            </div>
          )}

          {remoteVersion && !hasUpdate && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: 16,
              background: 'rgba(34,197,94,0.06)', borderRadius: 'var(--radius)',
              border: '1px solid rgba(34,197,94,0.15)',
            }}>
              <CheckCircle size={16} style={{ color: '#22c55e' }} />
              <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 500 }}>当前已是最新版本</span>
            </div>
          )}

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: 12, marginTop: 12,
              background: 'rgba(239,68,68,0.06)', borderRadius: 'var(--radius)',
              border: '1px solid rgba(239,68,68,0.15)',
              fontSize: 12, color: '#ef4444',
            }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {changelog.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              请先点击「检查新版本」获取版本历史
            </div>
          )}
          {changelog.map((entry, i) => (
            <div key={i} style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
              padding: 16, marginBottom: 10, border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>v{entry.version}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.date}</span>
                {localVersion && entry.version === localVersion.version && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>当前版本</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {entry.changes?.map((c, j) => <div key={j}>&bull; {c}</div>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────── Cloud Sync Panel ───────── */
function CloudSyncPanel({ isAdmin }) {
  const [cloudUrl, setCloudUrl] = useState('')
  const [connected, setConnected] = useState(false)
  const [cloudUser, setCloudUser] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [showLogin, setShowLogin] = useState(false)
  const [autoSync, setAutoSync] = useState(false)
  const [syncInterval, setSyncInterval] = useState(3)
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')

  const loadConfig = useCallback(async () => {
    try {
      const st = await api.get('/api/sync/status')
      setSyncStatus(st)
      setCloudUrl(st.cloud_url || '')
      setConnected(!!st.connected)
      setAutoSync(!!st.enabled)
    } catch (e) {
      console.warn('Failed to load sync status', e)
    }

    if (isAdmin) {
      try {
        const data = await api.get('/api/settings')
        setSyncInterval(parseInt(data.auto_sync_interval) || 3)
      } catch (e) {
        console.warn('Failed to load sync settings', e)
      }
    }
  }, [isAdmin])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConfig()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadConfig])

  useEffect(() => {
    if (!connected) return
    const id = setInterval(async () => {
      try { setSyncStatus(await api.get('/api/sync/status')) } catch (e) { console.warn('Failed to refresh sync status', e) }
    }, 10000)
    return () => clearInterval(id)
  }, [connected])

  const handleLogin = async () => {
    if (!cloudUrl || !loginForm.username || !loginForm.password) return
    setConnecting(true); setMsg('')
    try {
      const loginResult = await api.post('/api/sync/cloud-login', {
        cloud_url: cloudUrl, username: loginForm.username, password: loginForm.password,
      })
      if (!loginResult.ok) throw new Error(loginResult.error || '登录失败')
      const token = loginResult.token
      const result = await api.post('/api/sync/configure', {
        cloud_url: cloudUrl, cloud_token: token,
        auto_sync_enabled: autoSync, auto_sync_interval: syncInterval,
      })
      if (!result.ok) throw new Error(result.error || '配置失败')
      setCloudUser(result.user || loginResult.user)
      setConnected(true); setShowLogin(false)
      setMsg('已配置云端同步（自同步校验）')
      setTimeout(() => setMsg(''), 3000)
    } catch (e) { setMsg(e.message) }
    finally { setConnecting(false) }
  }

  const handleDisconnect = async () => {
    await api.post('/api/sync/configure', { cloud_url: '', cloud_token: '', auto_sync_enabled: false, auto_sync_interval: 3 }).catch(() => {})
    setConnected(false); setCloudUser(null); setSyncStatus(null)
  }

  const toggleAutoSync = async (val) => {
    setAutoSync(val)
    try {
      await api.post('/api/sync/configure', {
        auto_sync_enabled: val, auto_sync_interval: syncInterval,
      })
    } catch (e) {
      setMsg(`配置失败: ${e.message}`)
    }
  }

  const changeInterval = async (val) => {
    const v = Math.max(1, parseInt(val) || 3)
    setSyncInterval(v)
    try {
      await api.post('/api/sync/configure', {
        auto_sync_enabled: autoSync, auto_sync_interval: v,
      })
    } catch (e) {
      setMsg(`配置失败: ${e.message}`)
    }
  }

  const handleForceSync = async () => {
    setSyncing(true); setMsg('')
    try {
      const result = await api.post('/api/sync/force', {})
      setMsg(result.error || '同步完成')
      setTimeout(() => setMsg(''), 3000)
      setSyncStatus(await api.get('/api/sync/status'))
    } catch (e) { setMsg(`同步失败: ${e.message}`) }
    finally { setSyncing(false) }
  }

  const cardStyle = {
    background: 'var(--bg-secondary)',
    borderRadius: 12,
    padding: 18,
    marginBottom: 14,
    border: '1px solid var(--border)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  }

  const displayStatus = syncStatus || {
    synced_file_count: 0, synced_db_count: 0, queue_size: 0, error_count: 0, last_error: '',
    last_success_at: '', last_success_kind: '',
    last_uploaded_file: '', last_uploaded_file_at: '',
    last_pushed_db: '', last_pushed_db_at: '',
    last_error_at: '', last_error_item: '',
    last_local_backup_at: '',
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)', letterSpacing: 0.2 }}>实时云端同步</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.75 }}>
        当前为「自同步校验」模式：用于验证实时上传链路与自动备份是否工作（同机同站点不具备跨机器容灾）。
      </p>

      <div style={cardStyle}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 10 }}>云服务器地址</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <input
            value={cloudUrl}
            onChange={e => setCloudUrl(e.target.value)}
            placeholder="http://106.53.49.23"
            disabled={!isAdmin || connected}
            style={{ flex: 1, fontSize: 13, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          {isAdmin && (
            connected ? (
              <button type="button" onClick={handleDisconnect} style={{ padding: '0 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'rgba(239,68,68,0.12)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.25)', whiteSpace: 'nowrap' }}>断开</button>
            ) : (
              <button type="button" onClick={() => setShowLogin(true)} disabled={!cloudUrl?.trim()} style={{ padding: '0 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: cloudUrl?.trim() ? '#3b82f6' : 'var(--bg-tertiary)', color: cloudUrl?.trim() ? '#fff' : 'var(--text-muted)', border: 'none', whiteSpace: 'nowrap' }}>连接</button>
            )
          )}
        </div>
        {!!connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>已配置（系统级）{cloudUser ? ` · ${cloudUser.display_name || cloudUser.username}` : ''}</span>
          </div>
        )}
        {isAdmin && showLogin && !connected && (
          <div style={{ marginTop: 14, padding: 16, borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>使用与云端网站相同的账号密码登录（登录成功后用于上传鉴权）。</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={loginForm.username} onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))} placeholder="云端账号" style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8 }} />
              <input type="password" value={loginForm.password} onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))} placeholder="密码" style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8 }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              <button type="button" onClick={handleLogin} disabled={connecting} style={{ padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#3b82f6', color: '#fff', border: 'none' }}>{connecting ? '连接中...' : '登录并开启同步'}</button>
            </div>
          </div>
        )}
      </div>

      {!!connected && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>自动同步设置</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <button
              type="button"
              aria-pressed={autoSync}
              onClick={() => isAdmin && toggleAutoSync(!autoSync)}
              style={{
                width: 44, height: 26, borderRadius: 13, padding: 3, flexShrink: 0, border: 'none', cursor: 'pointer',
                background: autoSync ? '#22c55e' : 'var(--bg-tertiary)',
                boxShadow: autoSync ? 'inset 0 0 0 1px #16a34a' : 'inset 0 0 0 1px var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: autoSync ? 'flex-end' : 'flex-start',
                opacity: isAdmin ? 1 : 0.55,
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
            </button>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>实时自动同步</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>生成资产时自动上传文件，数据库定时推送 + 本机自动备份</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>数据库同步间隔</span>
            <select
              value={syncInterval}
              onChange={e => isAdmin && changeInterval(e.target.value)}
              disabled={!isAdmin}
              style={{
                padding: '6px 10px', borderRadius: 8, fontSize: 12, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                opacity: isAdmin ? 1 : 0.55,
              }}
            >
              {[1, 2, 3, 5, 10].map(v => <option key={v} value={v}>{v} 分钟</option>)}
            </select>
          </div>
          <button type="button" onClick={handleForceSync} disabled={syncing} style={{
            width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: syncing ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
            color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: syncing ? 'none' : '0 4px 14px rgba(139,92,246,0.35)',
            cursor: syncing ? 'default' : 'pointer',
          }}>
            {syncing ? <><RefreshCw size={15} className="spin" /> 正在同步...</> : <><Upload size={15} /> 立即同步（校验）</>}
          </button>
          {displayStatus.last_local_backup_at && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>最近一次本机数据库备份：{displayStatus.last_local_backup_at}</div>
          )}
        </div>
      )}

      {!!connected && (
        <div style={cardStyle}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 12 }}>同步状态</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#7c3aed', lineHeight: 1.2 }}>{displayStatus.synced_file_count}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>已上传文件</div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: displayStatus.queue_size > 0 ? '#d97706' : '#16a34a', lineHeight: 1.2 }}>{displayStatus.queue_size}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>等待上传</div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>已推送数据库：{displayStatus.synced_db_count || 0}</div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {displayStatus.last_success_at && (
              <div>最近一次成功：{displayStatus.last_success_at}（{displayStatus.last_success_kind || '-'}）</div>
            )}
            {displayStatus.last_uploaded_file_at && (
              <div>最近上传文件：{displayStatus.last_uploaded_file_at} · {displayStatus.last_uploaded_file || '-'}</div>
            )}
            {displayStatus.last_pushed_db_at && (
              <div>最近推送数据库：{displayStatus.last_pushed_db_at} · {displayStatus.last_pushed_db || '-'}</div>
            )}
          </div>
          {displayStatus.error_count > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#ea580c', lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, background: 'rgba(234,88,12,0.08)' }}>
              {displayStatus.error_count} 次错误 · {displayStatus.last_error}
              {(displayStatus.last_error_at || displayStatus.last_error_item) && (
                <span>（{displayStatus.last_error_at || '-'} · {displayStatus.last_error_item || '-'}）</span>
              )}
              {(String(displayStatus.last_error || '').includes('401') || String(displayStatus.last_error || '').includes('403')) && (
                <span> · 请点「断开」后重新登录云端账号。</span>
              )}
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 12, marginTop: 4,
          background: msg.includes('失败') || msg.includes('错误') ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
          color: msg.includes('失败') || msg.includes('错误') ? '#ef4444' : '#15803d',
        }}>{msg}</div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  )
}

/* ───────── About Panel ───────── */
function AboutPanel({ version }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 20, border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 10 }}>关于</span>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 2 }}>
        <div>应用名称：玩皮AI</div>
        <div>版本：{version || '1.0.0'}</div>
        <div>技术栈：Tauri + React + FastAPI + Gemini + FAL + 即梦(ARK) + VIDU + 海螺</div>
        <div>功能：AI 剧制作、图像生成、视频生成、AutoAgent 自动出片</div>
      </div>
    </div>
  )
}

function PasswordField({ label, value, onChange, show, onToggle, placeholder, autoComplete }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block', fontWeight: 600 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{ width: '100%', paddingRight: 38, fontSize: 13 }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? '隐藏密码' : '显示密码'}
          style={{
            position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
            background: 'none', color: 'var(--text-muted)', padding: 4,
          }}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  )
}

function AccountSecurityPanel() {
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm_password: '' })
  const [show, setShow] = useState({ old_password: false, new_password: false, confirm_password: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const toggleShow = (key) => setShow(prev => ({ ...prev, [key]: !prev[key] }))

  const readErrorMessage = async (res) => {
    const text = await res.text()
    if (!text) return `请求失败：HTTP ${res.status}`
    try {
      const data = JSON.parse(text)
      if (typeof data.detail === 'string') return data.detail
      if (Array.isArray(data.detail)) return data.detail.map(item => item.msg || item).join('；')
      return data.message || text
    } catch {
      return text
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!form.old_password || !form.new_password || !form.confirm_password) {
      setError('请完整填写原密码、新密码和确认密码')
      return
    }
    if (form.new_password !== form.confirm_password) {
      setError('两次输入的新密码不一致')
      return
    }
    setSubmitting(true)
    try {
      const base = import.meta.env.VITE_API_URL || ''
      const token = localStorage.getItem('token')
      const res = await fetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await readErrorMessage(res))
      setForm({ old_password: '', new_password: '', confirm_password: '' })
      setMessage('密码修改成功，请重新登录')
      setTimeout(() => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.dispatchEvent(new Event('auth-expired'))
      }, 900)
    } catch (err) {
      setError(err.message || '密码修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: 20, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Lock size={16} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>修改密码</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
        修改成功后会清除当前登录状态，需要使用新密码重新登录。
      </p>
      <form onSubmit={handleSubmit}>
        <PasswordField
          label="原密码"
          value={form.old_password}
          onChange={value => updateField('old_password', value)}
          show={show.old_password}
          onToggle={() => toggleShow('old_password')}
          placeholder="请输入当前密码"
          autoComplete="current-password"
        />
        <PasswordField
          label="新密码"
          value={form.new_password}
          onChange={value => updateField('new_password', value)}
          show={show.new_password}
          onToggle={() => toggleShow('new_password')}
          placeholder="请输入新密码"
          autoComplete="new-password"
        />
        <PasswordField
          label="确认新密码"
          value={form.confirm_password}
          onChange={value => updateField('confirm_password', value)}
          show={show.confirm_password}
          onToggle={() => toggleShow('confirm_password')}
          placeholder="请再次输入新密码"
          autoComplete="new-password"
        />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}
        {message && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: 12, marginBottom: 12 }}>
            <CheckCircle size={13} /> {message}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 8,
            background: submitting ? 'var(--bg-tertiary)' : 'var(--accent)',
            color: submitting ? 'var(--text-muted)' : '#fff',
            fontWeight: 600, fontSize: 13,
          }}
        >
          {submitting ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
          {submitting ? '提交中...' : '修改密码'}
        </button>
      </form>
    </div>
  )
}

function UsagePanel({ isAdmin }) {
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const toISODate = (date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const today = new Date()
  const defaultEndDate = toISODate(today)
  const defaultStartDate = toISODate(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000))
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')

  const loadUsage = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('start_date', startDate)
      params.set('end_date', endDate)
      if (selectedDepartment) params.set('department', selectedDepartment)
      if (selectedGroup) params.set('team_group', selectedGroup)
      if (forceRefresh) params.set('refresh', '1')
      const endpoint = isAdmin ? '/api/admin/usage' : '/api/account/team-usage'
      setUsage(await api.get(`${endpoint}?${params.toString()}`))
    } catch (e) {
      setError(e.message || '读取用量统计失败')
    } finally {
      setLoading(false)
    }
  }, [isAdmin, startDate, endDate, selectedDepartment, selectedGroup])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsage()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadUsage])

  const formatBytes = (value) => {
    const n = Number(value || 0)
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  const formatCurrency = (value) => `¥${Number(value || 0).toFixed(2)}`
  const formatDateTime = (value) => value ? String(value).replace('T', ' ').replace('Z', '').slice(0, 19) : '-'
  const operationLabel = (value) => ({
    generate_image: '图片生成',
    generate_video: '视频生成',
    replace_video: '视频替换',
  }[value] || value || '-')
  const categoryLabel = (value) => ({
    video_duration_limit: '视频时长超限',
    upstream_timeout: '上游超时',
    upstream_busy: '上游繁忙',
    configuration: '配置缺失',
    validation: '参数校验',
    unknown: '未知原因',
    other: '其他',
  }[value] || value || '-')

  const totals = usage?.totals || {}
  const users = usage?.users || (usage?.user ? [usage.user] : [])
  const departments = usage?.departments || []
  const groups = usage?.groups || []
  const groupOptions = groups
  const chartGroups = groups
    .map((item) => ({
      label: item.team || '未分团队',
      amount: Number(item.estimated_video_cost_cny || 0),
    }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const chartTotal = chartGroups.reduce((sum, item) => sum + item.amount, 0) || 1
  const chartPalette = ['#2563eb', '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316']
  let cursor = 0
  const chartSlices = chartGroups.map((item, idx) => {
    const pct = (item.amount / chartTotal) * 100
    const start = cursor
    const end = cursor + pct
    cursor = end
    return { ...item, pct, color: chartPalette[idx % chartPalette.length], start, end }
  })
  const donutBackground = chartSlices.length
    ? `conic-gradient(${chartSlices.map((slice) => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`).join(', ')})`
    : '#dbeafe'
  const userTotals = users.reduce((acc, user) => {
    for (const key of [
      'project_count', 'task_count', 'completed_task_count', 'failed_task_count',
      'image_file_count', 'video_file_count', 'video_generation_count',
      'estimated_video_cost_cny', 'storage_bytes',
    ]) {
      acc[key] += Number(user[key] || 0)
    }
    return acc
  }, {
    project_count: 0,
    task_count: 0,
    completed_task_count: 0,
    failed_task_count: 0,
    image_file_count: 0,
    video_file_count: 0,
    video_generation_count: 0,
    estimated_video_cost_cny: 0,
    storage_bytes: 0,
  })
  const dailyRows = Array.isArray(usage?.daily) ? usage.daily : []
  const dailyGridColumns = '1.25fr repeat(7, 0.75fr) 1fr 1fr'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <HardDrive size={16} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{isAdmin ? '管理员用量统计' : `${usage?.team || '个人'}团队用量统计`}</span>
        <button type="button" onClick={() => loadUsage(true)} disabled={loading} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />刷新
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 1.5fr) minmax(190px, 1.5fr) minmax(170px, 1.15fr) minmax(180px, 1.2fr) minmax(120px, 0.8fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>开始日期</div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: '100%', minWidth: 0, fontSize: 12, paddingLeft: 8, paddingRight: 4 }} />
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>结束日期</div>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: '100%', minWidth: 0, fontSize: 12, paddingLeft: 8, paddingRight: 4 }} />
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>部门</div>
          <select value={selectedDepartment} onChange={(e) => { setSelectedDepartment(e.target.value); setSelectedGroup('') }} style={{ width: '100%', minWidth: 0, fontSize: 12 }}>
            <option value="">全部部门</option>
            {departments.map((item) => (
              <option key={item.department} value={item.department}>{item.department || '未分部门'}</option>
            ))}
          </select>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>团队/组</div>
          <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} style={{ width: '100%', minWidth: 0, fontSize: 12 }}>
            <option value="">全部团队</option>
            {groupOptions
              .filter((item) => !selectedDepartment || item.department === selectedDepartment)
              .map((item) => (
                <option key={`${item.department}-${item.team}`} value={item.team}>{item.team || '未分团队'}</option>
              ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedDepartment('')
            setSelectedGroup('')
            setStartDate(defaultStartDate)
            setEndDate(defaultEndDate)
          }}
          style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 12 }}
        >
          重置筛选
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          ['用户', totals.user_count || 0],
          ['项目', totals.project_count || 0],
          ['任务', totals.task_count || 0],
          ['失败画像', totals.failed_operation_count || 0],
          ['视频费用', formatCurrency(totals.estimated_video_cost_cny)],
          ['存储', formatBytes(totals.storage_bytes)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 12px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>每日用量明细</div>
            <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              先展示所选日期范围内每天的数据，最后一行为该时间段汇总。
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {startDate} 至 {endDate}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: dailyGridColumns, gap: 8, padding: '9px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
          <span>日期</span><span>项目</span><span>任务</span><span>完成</span><span>失败</span><span>图片</span><span>视频</span><span>生成视频</span><span>费用</span><span>存储</span>
        </div>
        {loading ? (
          <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)' }}>正在读取每日数据...</div>
        ) : dailyRows.length === 0 ? (
          <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)' }}>暂无每日数据</div>
        ) : (
          <>
            {dailyRows.map((day) => (
              <div key={day.date} style={{ display: 'grid', gridTemplateColumns: dailyGridColumns, gap: 8, padding: '10px 12px', fontSize: 12, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{day.date}</span>
                <span>{day.project_count || 0}</span>
                <span>{day.task_count || 0}</span>
                <span>{day.completed_task_count || 0}</span>
                <span>{day.failed_task_count || 0}</span>
                <span>{day.image_file_count || 0}</span>
                <span>{day.video_file_count || 0}</span>
                <span>{day.video_generation_count || 0}</span>
                <span>{formatCurrency(day.estimated_video_cost_cny)}</span>
                <span>{formatBytes(day.storage_bytes)}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: dailyGridColumns, gap: 8, padding: '11px 12px', fontSize: 12, borderTop: '1px solid var(--border)', alignItems: 'center', fontWeight: 800, background: 'linear-gradient(90deg, rgba(124,58,237,0.1), rgba(14,165,233,0.08))' }}>
              <span>区间汇总</span>
              <span>{totals.project_count || 0}</span>
              <span>{totals.task_count || 0}</span>
              <span>{totals.completed_task_count || 0}</span>
              <span>{totals.failed_task_count || 0}</span>
              <span>{totals.image_file_count || 0}</span>
              <span>{totals.video_file_count || 0}</span>
              <span>{totals.video_generation_count || 0}</span>
              <span>{formatCurrency(totals.estimated_video_cost_cny)}</span>
              <span>{formatBytes(totals.storage_bytes)}</span>
            </div>
          </>
        )}
      </div>

      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>团队费用占比</div>
        {chartSlices.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无可视化数据</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 220, height: 220, borderRadius: '50%', background: donutBackground, margin: '0 auto', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 38, borderRadius: '50%', background: 'var(--bg-primary)', border: '1px solid var(--border)' }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', zIndex: 2 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>总费用</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1e3a8a' }}>{formatCurrency(chartTotal)}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {chartSlices.map((slice) => (
                <div key={slice.label} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto auto', gap: 8, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: slice.color }} />
                  <span title={slice.label} style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{slice.label}</span>
                  <span style={{ fontWeight: 600, color: '#1d4ed8' }}>{slice.pct.toFixed(1)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{formatCurrency(slice.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1.45fr repeat(8, 0.58fr) 0.78fr', gap: 8, padding: '9px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
          <span>用户</span><span>部门</span><span>团队/组</span><span>项目</span><span>任务</span><span>完成</span><span>失败</span><span>图片</span><span>视频</span><span>生成视频</span><span>费用</span><span>存储</span>
        </div>
        {loading ? (
          <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)' }}>正在读取...</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)' }}>暂无数据</div>
        ) : users.map(user => (
          <div key={user.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1.45fr repeat(8, 0.58fr) 0.78fr', gap: 8, padding: '10px 12px', fontSize: 12, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
            <div style={{ minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>
              <div>
                {user.display_name || user.username}
              </div>
              {user.username && user.display_name && user.display_name !== user.username && (
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                  {user.username}
                </div>
              )}
            </div>
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{user.department || '未分部门'}</span>
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{user.team_group || user.team || '未分团队'}</span>
            <span>{user.project_count || 0}</span>
            <span>{user.task_count || 0}</span>
            <span>{user.completed_task_count || 0}</span>
            <span>{user.failed_task_count || 0}</span>
            <span>{user.image_file_count || 0}</span>
            <span>{user.video_file_count || 0}</span>
            <span>{user.video_generation_count || 0}</span>
            <span>{formatCurrency(user.estimated_video_cost_cny)}</span>
            <span>{formatBytes(user.storage_bytes)}</span>
          </div>
        ))}
        {!loading && users.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1.45fr repeat(8, 0.58fr) 0.78fr', gap: 8, padding: '10px 12px', fontSize: 12, borderTop: '1px solid var(--border)', alignItems: 'center', fontWeight: 700, background: 'var(--bg-primary)' }}>
            <span>总计（{users.length} 人）</span>
            <span>-</span>
            <span>-</span>
            <span>{userTotals.project_count}</span>
            <span>{userTotals.task_count}</span>
            <span>{userTotals.completed_task_count}</span>
            <span>{userTotals.failed_task_count}</span>
            <span>{userTotals.image_file_count}</span>
            <span>{userTotals.video_file_count}</span>
            <span>{userTotals.video_generation_count}</span>
            <span>{formatCurrency(userTotals.estimated_video_cost_cny)}</span>
            <span>{formatBytes(userTotals.storage_bytes)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────── Main Settings Page ───────── */
export default function SettingsPage() {
  const storedUser = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} }
  })()
  const isAdmin = storedUser.role === 'admin'
  const navItems = NAV_ITEMS.filter(item => isAdmin || !['apikeys', 'providers'].includes(item.id))
  const [activeNav, setActiveNav] = useState(isAdmin ? 'apikeys' : 'usage')
  const [keys, setKeys] = useState({})
  const [providers, setProviders] = useState([])
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (isAdmin) {
      api.get('/api/settings').then(data => {
        setKeys(data)
        if (data.providers) {
          try { setProviders(JSON.parse(data.providers)) } catch { setProviders([]) }
        }
      }).catch(() => {})
    }

    const fetchVer = async () => {
      try {
        const base = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${base}/api/local-config`)
        if (res.ok) {
          const d = await res.json()
          setVersion(d.version || '1.0.0')
        }
      } catch (e) {
        console.warn('Failed to load app version', e)
      }
    }
    fetchVer()
  }, [isAdmin])

  const saveApiKey = async (key, value) => {
    setError(''); setSaved('')
    try {
      await api.post('/api/settings', { key, value })
      setSaved(key)
      setTimeout(() => setSaved(''), 3000)
    } catch { setError(key) }
  }

  const updateKey = (key, value) => setKeys(prev => ({ ...prev, [key]: value }))

  const saveProviders = async () => {
    try {
      await api.post('/api/settings', { key: 'providers', value: JSON.stringify(providers) })
      setSaved('providers')
      setTimeout(() => setSaved(''), 3000)
    } catch { setError('providers') }
  }

  const hasUpdateDot = (() => {
    const stored = localStorage.getItem('wanpi_local_version')
    if (!stored) return false
    return false
  })()

  return (
    <SettingsLayout
      navItems={navItems}
      activeNav={activeNav}
      onNavChange={setActiveNav}
      hasUpdateDot={hasUpdateDot}
    >
      {!!storedUser.must_change_password && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.25)', fontSize: 12 }}>
          <AlertCircle size={14} /> 当前账号使用临时密码，请尽快在账号安全中修改。
        </div>
      )}
      {activeNav === 'apikeys' && (
        <ApiKeysPanel keys={keys} saved={saved} error={error} onUpdateKey={updateKey} onSaveKey={saveApiKey} />
      )}
      {activeNav === 'security' && <AccountSecurityPanel />}
      {activeNav === 'usage' && <UsagePanel isAdmin={isAdmin} />}
      {activeNav === 'providers' && (
        <ProvidersPanel
          providers={providers}
          onUpdate={(idx, field, value) => setProviders(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))}
          onAdd={() => setProviders(prev => [...prev, { name: '', apiUrl: '', apiKey: '', model: '', maxTokens: 8192 }])}
          onDelete={(idx) => setProviders(prev => prev.filter((_, i) => i !== idx))}
          onSave={saveProviders}
          saved={saved}
        />
      )}
      {activeNav === 'theme' && <ThemePanel />}
      {activeNav === 'update' && <UpdatePanel />}
      {activeNav === 'sync' && <CloudSyncPanel isAdmin={isAdmin} />}
      {activeNav === 'about' && <AboutPanel version={version} />}
    </SettingsLayout>
  )
}
