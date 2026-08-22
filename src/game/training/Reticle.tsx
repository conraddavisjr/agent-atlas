import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { palette } from '@/art/palette'
import { PLANK_RADIUS } from './stage'
import { resolveHit } from './quiz'
import type { TrainingState } from './trainingMachine'

/**
 * The crosshair, sitting on the target plane where the pointer is.
 *
 * ## In the world rather than on the DOM
 *
 * A crosshair drawn over the canvas at the cursor's pixel is the obvious build
 * and it is subtly wrong here: the aim point is a world position on a plane six
 * metres away, and a DOM overlay would have to re-project it every frame to stay
 * on the same spot. Drawing it in the scene means the reticle IS the aim point,
 * so it cannot drift from the thing the arrow will fly at.
 *
 * ## It answers "which one am I pointing at", which the brief asked for
 *
 * Four ticks and a dot when it is over nothing; the ticks spread and the whole
 * thing turns ally blue when it is over a plank. That state change is the
 * indicator - the brief asks for crosshairs "that guide and indicate which one
 * you're pointing at", and a reticle that never changes indicates nothing.
 *
 * `resolveHit` decides, which is the SAME function the shot uses. A reticle that
 * lit on its own radius would eventually tell the player they were on target for
 * a shot that missed, which is the worst possible lie for a crosshair to tell.
 *
 * ## Never occluded
 *
 * `depthTest: false` and a high `renderOrder`, because the reticle is the one
 * thing here that is not part of the world - it is the player's own aim. Without
 * it the crosshair disappears behind the plank it is on, which is exactly when it
 * matters most.
 */
export function Reticle({
  run,
  aim,
}: {
  run: RefObject<TrainingState>
  aim: RefObject<[number, number, number]>
}) {
  const group = useRef<Group>(null)
  const ticks = useRef<(Group | null)[]>([])
  const dot = useRef<Mesh>(null)
  /** The live tick spread, smoothed. Held in a ref so it survives frames. */
  const spread = useRef(SPREAD_OFF)

  useFrame((_, delta) => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    // Only while a shot can actually be taken. A crosshair during the reload
    // promises an arrow that is not there.
    if (state.phase !== 'aiming') {
      g.visible = false
      return
    }
    g.visible = true

    const point = aim.current
    g.position.set(point[0], point[1], point[2])

    const onTarget = resolveHit(point) !== null
    /*
      Smoothed with `1 - exp(-k * dt)`, this project's frame-rate-independent
      formula rather than a second way of doing the same thing. Snapping the
      spread would make the reticle flicker as the pointer crosses a plank's rim,
      which is where a player naturally holds it.
    */
    const t = 1 - Math.exp(-SNAP * delta)
    spread.current += ((onTarget ? SPREAD_ON : SPREAD_OFF) - spread.current) * t

    for (let i = 0; i < ticks.current.length; i++) {
      const tick = ticks.current[i]
      if (!tick) continue
      const angle = (i * Math.PI) / 2
      tick.position.set(Math.cos(angle) * spread.current, Math.sin(angle) * spread.current, 0)
      tick.rotation.z = angle
      const material = (tick.children[0] as Mesh | undefined)?.material as MeshBasicMaterial | undefined
      if (material) material.color.set(onTarget ? palette.visor : IDLE)
    }
    if (dot.current) {
      const material = dot.current.material as MeshBasicMaterial
      material.color.set(onTarget ? palette.visor : IDLE)
      // The dot shrinks as the ticks spread, so the two read as one gesture.
      dot.current.scale.setScalar(onTarget ? 0.7 : 1)
    }
  })

  return (
    <group ref={group} visible={false}>
      {/*
        Turned to face the camera. The stage is authored at +Z and viewed from
        -Z, so anything meant to be looked at has to be turned to meet the
        viewer - the same half turn the headline, the cube faces and the plank
        verdicts all need. A quad left unrotated here is edge-on and invisible,
        which is a much quieter failure than a mirrored word.
      */}
      <group rotation={[0, Math.PI, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <group
            key={i}
            ref={(node) => {
              ticks.current[i] = node
            }}
          >
            <mesh renderOrder={RENDER_ORDER}>
              <planeGeometry args={[TICK_LENGTH, TICK_WIDTH]} />
              <meshBasicMaterial color={IDLE} depthTest={false} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        ))}
        <mesh ref={dot} renderOrder={RENDER_ORDER}>
          <circleGeometry args={[0.012, 12]} />
          <meshBasicMaterial color={IDLE} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/** How far the ticks sit from the centre, off target and on. */
const SPREAD_OFF = 0.055
/**
 * On target the ticks open to frame the plank rather than mark a point.
 *
 * Just inside the disc's own radius, so the crosshair reads as brackets around
 * the coin. Outside it and the reticle would appear to be selecting the gap
 * between two answers.
 */
const SPREAD_ON = PLANK_RADIUS * 0.72
/** How fast the spread settles, per second. */
const SNAP = 22

const TICK_LENGTH = 0.05
const TICK_WIDTH = 0.008
const IDLE = '#9fb6d8'
/** Above everything. Paired with `depthTest: false`; see the header. */
const RENDER_ORDER = 900
