import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import { cameraClearance } from './cameraCollision'

beforeAll(async () => { await RAPIER.init() })
const worlds: RAPIER.World[] = []
afterEach(() => { worlds.splice(0).forEach((world) => world.free()) })
function scene() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  worlds.push(world)
  return world
}
const origin = new Vector3(0, 1, 0)
const backward = new Vector3(0, 0, 1)

describe('camera clearance', () => {
  it('keeps the full boom in open space', () => {
    expect(cameraClearance(scene(), origin, backward, 10)).toBe(10)
  })
  it('protects the near plane even when the centre ray misses an edge', () => {
    const world = scene()
    world.createCollider(RAPIER.ColliderDesc.cuboid(.1, 2, .1).setTranslation(.3, 1, 3))
    world.step()
    expect(world.castRay(new RAPIER.Ray(origin, backward), 10, true)).toBeNull()
    expect(cameraClearance(world, origin, backward, 10)).toBeLessThan(3)
  })
  it('does not enforce a minimum distance through a close wall', () => {
    const world = scene()
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, .1).setTranslation(0, 1, .6))
    world.step()
    expect(cameraClearance(world, origin, backward, 10)).toBeCloseTo(.14, 2)
  })
  it('ignores the player capsule and portal triggers', () => {
    const world = scene()
    const player = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0))
    world.createCollider(RAPIER.ColliderDesc.capsule(.35, .35), player)
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, .2).setTranslation(0, 1, 2).setSensor(true))
    world.step()
    expect(cameraClearance(world, origin, backward, 10)).toBe(10)
  })
})
