import { useEffect, useState } from 'react'
import { listImageModels } from './imageToolboxApi'
import { filterImageModelsForCurrentUser } from './imageModelAccess'
import { FALLBACK_IMAGE_MODELS, mergeImageModelsWithFallback } from './imageModelFallbacks'

export function useImageToolboxModels() {
  const [imageModels, setImageModels] = useState(FALLBACK_IMAGE_MODELS)
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    listImageModels().then(data => {
      setImageModels(filterImageModelsForCurrentUser(mergeImageModelsWithFallback(data.models || [])))
    }).catch(() => {
      setImageModels(FALLBACK_IMAGE_MODELS)
    }).finally(() => {
      setModelsLoaded(true)
    })
  }, [])

  return { imageModels, modelsLoaded }
}
