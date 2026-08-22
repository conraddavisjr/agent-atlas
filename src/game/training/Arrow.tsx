import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group } from 'three'
import { ArrowBody } from './ArrowBody'
import { arrowPosition, flightProgress, type Shot } from './arrowFlight'
import type { TrainingState } from './trainingMachine'

/**
 * The arrow between leaving the bow and landing.
 *
 * ## One arrow, not a pool
 *
 * There can only ever be one in the air: `aiming` is the only phase that accepts
 * a shot, and it is not reachable again until `reloading` has finished. So this is
 * a single mounted object that is shown and hidden rather than a spawner, which
 * means no allocation, no pool, and no possibility of two arrows disagreeing
 * about which one the plank was hit by.
 *
 * ## It flies to a decided outcome
 *
 * The hit was scored the instant the pointer went down, against the same ray the
 * reticle uses. This only animates the journey to a conclusion that already
 * exists - see `arrow.ts`. An arrow that re-derived its own collision would be a
 * second opinion, and the visible failure of a second opinion is a plunger
 * passing through a plank the game has already counted.
 *
 * ## Facing
 *
 * `lookAt` down the flight direction, which for a plain object points its +Z at
 * the target - the axis `ArrowBody` is built along. Aiming it at the destination
 * rather than at the velocity is deliberate: with `DROOP` the two differ by about
 * a degree, and the destination is the one that makes the arrow appear to enter
 * the plank straight instead of nose-up.
 */
export function Arrow({
  run,
  shot,
}: {
  run: RefObject<TrainingState>
  /** The shot in flight, or null when nothing is in the air. */
  shot: RefObject<Shot | null>
}) {
  const group = useRef<Group>(null)
  const target = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const state = run.current
    const g = group.current
    const s = shot.current
    if (!state || !g) return

    if (!s || state.phase !== 'firing') {
      g.visible = false
      return
    }

    const [x, y, z] = arrowPosition(s, flightProgress(state))
    g.position.set(x, y, z)
    target.set(s.to[0], s.to[1], s.to[2])
    /*
      Guarded, because `lookAt` on a point you are already standing on produces a
      zero-length direction and three quietly leaves the rotation as it was - which
      on the very last frame of a flight would be a visible flick.
    */
    if (g.position.distanceToSquared(target) > 1e-6) g.lookAt(target)
    g.visible = true
  })

  return (
    <group ref={group} visible={false}>
      <ArrowBody />
    </group>
  )
}
