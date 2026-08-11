import { useEffect } from 'react'

/**
 * Reports that a scene is genuinely on screen.
 *
 * Rendered as a sibling of the scene component inside the same Suspense
 * boundary, which is the whole trick: React does not commit any child of a
 * boundary until every child has resolved, so this cannot mount until the
 * scene's lazy chunk has downloaded, its textures have decoded, and Rapier's
 * WASM is live. Mounting is therefore a reliable signal, where a timer is only
 * ever a guess that happens to be right on a warm cache.
 */
export function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady])

  return null
}
