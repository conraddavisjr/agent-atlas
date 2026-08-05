import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Object3D } from 'three'
import { INTERACTION } from '../player/tuning'

/**
 * Fires when the player comes within range of an object, and again when they leave.
 *
 * Two details here are easy to get wrong and both produce bugs that look like
 * something else entirely.
 *
 * World space, not local. `object.position` is relative to the parent, so an
 * anchor nested inside a portal or totem group reports its offset within that
 * group rather than where it actually is in the level. Comparing that against
 * the player's world position makes every anchor behave as though it sits near
 * the world origin, which shows up as portals triggering in the middle of the
 * island and prompts appearing for the wrong object.
 *
 * Separate enter and exit radii. With a single threshold, a player standing on
 * the boundary flickers the prompt on and off every frame.
 */
export function useProximity(
  self: React.RefObject<Object3D | null>,
  player: React.RefObject<Group | null>,
  onEnter: () => void,
  onExit: () => void,
  enabled = true,
) {
  const inside = useRef(false)

  /**
   * Whether the first frame has been sampled yet.
   *
   * On the first frame the current state is recorded WITHOUT firing onEnter. This
   * is what stops a player who spawns already inside a trigger from activating
   * it: arriving next to a portal would otherwise fire it instantly and bounce
   * them straight back where they came from, forever. They must leave and
   * genuinely re-enter for it to count.
   */
  const primed = useRef(false)

  // Scratch vectors, allocated once rather than per frame.
  const selfWorld = useRef<Vector3 | null>(null)
  const playerWorld = useRef<Vector3 | null>(null)
  if (selfWorld.current === null) selfWorld.current = new Vector3()
  if (playerWorld.current === null) playerWorld.current = new Vector3()

  useFrame(() => {
    if (!enabled) {
      if (inside.current) {
        inside.current = false
        onExit()
      }
      return
    }

    const a = self.current
    const b = player.current
    if (!a || !b) return

    a.getWorldPosition(selfWorld.current!)
    // The follow target is a detached Group holding the physics translation, so
    // its local position is already world space, but resolving it the same way
    // keeps this correct if it is ever parented to something.
    b.getWorldPosition(playerWorld.current!)

    const distance = selfWorld.current!.distanceTo(playerWorld.current!)
    const threshold = inside.current ? INTERACTION.exitRadius : INTERACTION.radius

    if (!primed.current) {
      primed.current = true
      inside.current = distance <= threshold
      return
    }

    if (distance <= threshold && !inside.current) {
      inside.current = true
      onEnter()
    } else if (distance > threshold && inside.current) {
      inside.current = false
      onExit()
    }
  })

  return inside
}
