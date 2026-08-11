import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh, ShaderMaterial } from 'three'
import {
  SPLASH,
  inPool,
  splashFragmentShader,
  splashGeometry,
  splashStrength,
  splashUniforms,
  splashVertexShader,
  type PoolBounds,
} from './splash'

/**
 * The pool splash: watches one capsule against one circle and fires.
 *
 * All of the reasoning, every tunable, the trigger arithmetic and the bloom bound
 * live in `splash.ts`, because the house pattern is that a `.tsx` in `src/art`
 * exports one component and nothing else - `Grass.tsx` exports `Grass` alone - and
 * because that is what keeps fast refresh working.
 *
 * ## Not gated on a quality tier, and that is deliberate rather than lazy
 *
 * The obvious gate is `quality.particleBudget` or `quality.vfxDetail`, and both are
 * traps: they are 0 and `'off'` at every tier, so gating on either ships an effect
 * that never draws and reports nothing - which is the failure this project's
 * `MEMORY.md` is about. Gating on some unrelated flag that happens to be true
 * everywhere, like `contactShadow`, would be a lie in the code.
 *
 * So it is ungated, and the cost is on the record instead: **one draw call and
 * thirty triangles**, geometry built once at mount, animated by a single float
 * uniform, drawn only while a splash is alive. That is cheaper than one pylon. The
 * moment `quality.ts` grows a real particle tier this should move behind it, and
 * `splashCost()` is what that decision should be argued against.
 *
 * ## Why the mesh is hidden rather than unmounted between splashes
 *
 * `visible` costs one boolean test per frame in the render list. Unmounting would
 * dispose the geometry and the compiled program and rebuild both on the next entry
 * - a shader compile in the middle of a footstep, which is a frame hitch exactly
 * when the player is looking at the thing that caused it.
 */
export function PoolSplash({
  bounds,
  player,
  /** World position of the water surface at the pool's centre. */
  surface,
}: {
  bounds: PoolBounds
  /** The character's transform. Its position is the CAPSULE CENTRE, not the sole. */
  player: React.RefObject<Group | null>
  surface: [number, number, number]
}) {
  const mesh = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)

  const geometry = useMemo(() => splashGeometry(), [])
  const uniforms = useMemo(() => splashUniforms(), [])

  /*
    Trigger state, in refs rather than in state, because a splash is not something
    React needs to know about: re-rendering the tree to start an animation that is
    driven entirely by a uniform would be a full reconciliation per footstep.
  */
  const inside = useRef(false)
  const age = useRef(Number.POSITIVE_INFINITY)
  const previous = useRef<{ x: number; y: number; z: number } | null>(null)

  useFrame((_, delta) => {
    const current = mesh.current
    const shader = material.current
    const body = player.current
    if (!current || !shader) return

    age.current += delta

    if (body) {
      const position = body.position
      const was = inside.current
      const now = inPool(position, bounds, was)

      if (now && !was) {
        /*
          Speed from the frame's own displacement rather than from the controller's
          velocity, which this component cannot see. `delta` can be a large number on
          the frame after a tab regains focus, so the divide is floored - otherwise a
          resumed tab computes a speed of hundreds and clamps to a full-strength
          splash for a step the player never took.
        */
        const last = previous.current
        const travelled = last
          ? Math.hypot(position.x - last.x, position.y - last.y, position.z - last.z)
          : 0
        const speed = travelled / Math.max(delta, 1 / 240)

        age.current = 0
        shader.uniforms.uStrength.value = splashStrength(speed)
      }
      inside.current = now

      if (!previous.current) previous.current = { x: 0, y: 0, z: 0 }
      previous.current.x = position.x
      previous.current.y = position.y
      previous.current.z = position.z
    }

    /*
      The ring outlives the spray, so the mesh has to stay up for the LONGER of the
      two lifetimes. Reading the shorter one here would cut the ring off mid-expand,
      which is the half of the effect that actually reads at this camera.
    */
    const alive = age.current <= Math.max(SPLASH.life, SPLASH.ringLife)
    shader.uniforms.uAge.value = age.current
    if (current.visible !== alive) current.visible = alive
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      position={surface}
      /*
        NO `visible` prop, and that is a fix rather than an omission.

        r3f reapplies every declared prop on each render, so `visible={false}` here
        would snap a live splash off the moment anything re-rendered the parent - and
        `HubIsland` re-renders on progress changes and on `setActiveTotem`, which fires
        whenever the player walks near a totem. The splash would work perfectly except
        when the player was somewhere the tree happened to re-render, which is the worst
        possible shape for a bug: intermittent, input-dependent, and invisible in a
        still.

        Visibility is therefore owned entirely by the frame loop below. Between mount
        and the first frame the mesh is in the render list, and it draws nothing: `uAge`
        starts past both lifetimes, so `vFade` is zero and every fragment is discarded.
      */
      /*
        The bounding sphere is a fraction of a metre at the centre of the island, so
        the frustum test is very nearly free - but it is also very nearly always
        true, and a billboarded quad whose real screen extent the bounding sphere
        does not describe is the classic thing to lose to a false cull at the edge of
        frame. Off, at the cost of one matrix-free test per frame.
      */
      frustumCulled={false}
      /*
        AFTER the water it sits on. The water writes depth and is 0.95 opaque, so a
        splash drawn before it would be occluded by the surface it is coming out of.
      */
      renderOrder={2}
    >
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={splashVertexShader}
        fragmentShader={splashFragmentShader}
        transparent
        /*
          NormalBlending, which is three's default and is stated by being left alone
          rather than by being set. The art bible's section 1: dust and debris use
          NormalBlending with alpha, and only energy effects may go additive or carry
          colours above 1.0. Thrown water is debris. This is also what makes
          `splashPeakLuminance` a one-line proof instead of a cluster-density
          argument - there is no accumulation for overlapping droplets to sum into.
        */
        depthWrite={false}
      />
    </mesh>
  )
}
