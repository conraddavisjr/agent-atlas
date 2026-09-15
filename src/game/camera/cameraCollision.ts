import { Ball, QueryFilterFlags, type World } from '@dimforge/rapier3d-compat'
import type { Vector3 } from 'three'
import { CAMERA } from '../player/tuning'

const ROTATION = { x: 0, y: 0, z: 0, w: 1 }
const CAMERA_VOLUME = new Ball(CAMERA.collisionRadius)
const FILTER = QueryFilterFlags.EXCLUDE_SENSORS | QueryFilterFlags.EXCLUDE_KINEMATIC

/** Sweep a volume so near-plane corners cannot peek through a wall. */
export function cameraClearance(world: World, origin: Vector3, direction: Vector3, distance: number): number {
  if (distance <= 0) return 0
  const hit = world.castShape(origin, ROTATION, direction, CAMERA_VOLUME, 0, distance, true, FILTER)
  // A minimum boom length must never override a nearby wall.
  return hit ? Math.max(0, hit.time_of_impact - CAMERA.collisionSkin) : distance
}
