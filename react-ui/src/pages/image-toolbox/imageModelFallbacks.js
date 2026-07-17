export const FALLBACK_IMAGE_MODELS = [
  {
    id: 'seedream-5.0',
    name: 'Seedream 5.0 Lite',
    provider: 'jimeng',
    supports_ref_images: true,
    max_ref_images: 10,
    supports_edit: true,
    supported_qualities: ['2K', '4K'],
    default_quality: '2K',
    supports_prompt_optimization: true,
    prompt_optimization_modes: ['standard'],
    default_prompt_optimization: 'standard',
    supports_web_search: true,
    supports_output_format: true,
    output_formats: ['png'],
    default_output_format: 'png',
  },
  {
    id: 'seedream-4.5',
    name: 'Seedream 4.5',
    provider: 'jimeng',
    supports_ref_images: true,
    max_ref_images: 14,
    supports_edit: true,
    supported_qualities: ['2K', '4K'],
    default_quality: '2K',
    supports_prompt_optimization: true,
    prompt_optimization_modes: ['standard'],
    default_prompt_optimization: 'standard',
  },
  {
    id: 'seedream-5.0-lite',
    name: 'Seedream 5.0 Lite (兼容)',
    provider: 'jimeng',
    supports_ref_images: true,
    max_ref_images: 10,
    supports_edit: true,
    supported_qualities: ['2K', '4K'],
    default_quality: '2K',
    supports_prompt_optimization: true,
    prompt_optimization_modes: ['standard'],
    default_prompt_optimization: 'standard',
    supports_web_search: true,
    supports_output_format: true,
    output_formats: ['png'],
    default_output_format: 'png',
  },
  {
    id: 'seedream-3.0',
    name: 'Seedream 3.0',
    provider: 'jimeng',
    supports_ref_images: false,
    max_ref_images: 0,
    supports_edit: false,
    supported_qualities: ['1K'],
    default_quality: '1K',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Nano Banana 2',
    provider: 'gemini_image',
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Nano Banana Pro',
    provider: 'gemini_image',
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Nano Banana',
    provider: 'gemini_image',
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'openai_image',
    supports_ref_images: true,
    supports_edit: true,
    max_ref_images: 16,
    supports_batch: true,
    max_batch_count: 4,
    supported_counts: [1, 2, 3, 4],
    default_count: 1,
    supported_qualities: ['1K'],
    default_quality: '1K',
  },
  {
    id: 'mulerun-gpt-image-2',
    name: 'GPT Image 2（MuleRun）',
    provider: 'mulerun_image',
    supports_ref_images: true,
    supports_edit: true,
    max_ref_images: 4,
    supports_batch: true,
    max_batch_count: 4,
    supported_counts: [1, 2, 3, 4],
    default_count: 1,
    supported_qualities: ['1K', '2K'],
    default_quality: '2K',
    supports_output_format: true,
    output_formats: ['png', 'jpeg', 'webp'],
    default_output_format: 'png',
  },
  {
    id: 'mulerun-nano-banana-2',
    name: 'Nano Banana 2（MuleRun）',
    provider: 'mulerun_image',
    supports_ref_images: true,
    max_ref_images: 14,
    supports_edit: true,
    supports_batch: true,
    max_batch_count: 4,
    supported_counts: [1, 2, 3, 4],
    default_count: 1,
    supported_qualities: ['1K'],
    default_quality: '1K',
    supports_web_search: true,
  },
]

export function mergeImageModelsWithFallback(remoteModels) {
  const fallbackById = new Map(FALLBACK_IMAGE_MODELS.map(model => [model.id, model]))
  const merged = []
  const seen = new Set()

  ;(Array.isArray(remoteModels) ? remoteModels : []).forEach((model) => {
    if (!model?.id) return
    const fallback = fallbackById.get(model.id)
    merged.push(fallback ? { ...fallback, ...model } : model)
    seen.add(model.id)
  })

  FALLBACK_IMAGE_MODELS.forEach((model) => {
    if (!seen.has(model.id)) {
      merged.push(model)
    }
  })

  return merged
}
