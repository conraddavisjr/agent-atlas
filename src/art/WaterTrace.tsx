import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { BufferGeometry, ShaderMaterial } from 'three'
import { waterFragmentShader, waterUniforms, waterVertexShader } from './waterMaterial'

/**
 * The trace batch, drawn as water.
 *
 * All of the reasoning, every tunable and every measured number lives in
 * `waterMaterial.ts`. This file is only the component, because the house pattern
 * is that a `.tsx` in `src/art` exports one component and nothing else -
 * `Grass.tsx` exports `Grass` alone and its shader tests import from elsewhere -
 * and because that is what keeps fast refresh working.
 *
 * Renders its own mesh rather than taking children, so that swapping the trace
 * over in `HubIsland.tsx` replaces a 34-line conditional material block with one
 * element and the integrator's diff cannot half-apply.
 *
 * `completed` and `total` rather than a normalised progress, so the caller hands
 * over the numbers it already has and this file owns the mapping.
 *
 * No explicit dispose, and that is checked rather than assumed. `contactDecal`'s
 * material is disposed by hand in `HubIsland.tsx` because it is built
 * imperatively with `new ShaderMaterial` inside a `useMemo`, and three does not
 * collect a compiled program that nothing told it to release. This material is
 * declared as JSX, so react-three-fiber constructed it and disposes it when the
 * element unmounts - the same arrangement `PortalShimmer.tsx` relies on. Adding
 * a second dispose here would be harmless and its comment would be false, which
 * is worse than nothing.
 */
export function WaterTrace({
  geometry,
  completed,
  total,
  keyDirection,
}: {
  geometry: BufferGeometry
  /** Hub lessons finished. Drives the wave amplitude, the glint and the body lift. */
  completed: number
  /** Hub lessons in total. Guarded against zero so an empty zone cannot divide by it. */
  total: number
  /** See `KEY_DIRECTION` in `waterMaterial.ts`. Supply it once `Lighting.tsx` exports its own. */
  keyDirection?: [number, number, number]
}) {
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => waterUniforms(keyDirection), [keyDirection])

  const progress = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0

  /*
    Progress is written here rather than in an effect so it cannot be missed. A
    uniform write is a few nanoseconds and this frame's value is always the one
    the frame is drawn with, where an effect that failed to fire would leave the
    water permanently reading an empty hub - which is precisely the class of
    silent failure this project keeps paying for.
  */
  useFrame((state) => {
    const current = material.current
    if (!current) return
    current.uniforms.uTime.value = state.clock.elapsedTime
    current.uniforms.uProgress.value = progress
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={waterVertexShader}
        fragmentShader={waterFragmentShader}
        /*
          Transparent for the shoreline ramp only. The body is at opacity 0.95,
          so this is not a see-through surface - the alpha exists to soften the
          last centimetre where the tube turns under into the deck.

          Depth writing is left at its default of ON, which is the opposite of
          `PortalShimmer` and of the node shells, and the difference is what kind
          of thing this is. Those are additive light in air, and additive
          transparency that writes depth occludes everything drawn after it. This
          is a surface: opaque across almost all of its area, and it needs to
          occlude the run of channel behind it when the camera looks along a
          straight.
        */
        transparent
      />
    </mesh>
  )
}
