import { describe, it, expect } from 'vitest'
import { Object3D, Vector2 } from 'three'
import { applyPose, createRigRefs, writeVisorUniforms, type RigRefs } from './rig'
import { createPose, JOINT_KEYS, REST, type JointKey } from './robotPose'
import { CAPE } from './animTuning'

/** A rig with a real Object3D behind every node. */
function fullRig(): RigRefs {
  const rig = createRigRefs()
  for (const key of JOINT_KEYS) rig[key] = new Object3D()
  rig.cape = [new Object3D(), new Object3D(), new Object3D(), new Object3D()]
  return rig
}

describe('applyPose', () => {
  it('puts every joint at its rest transform for an identity pose', () => {
    const rig = fullRig()
    applyPose(createPose(), rig)
    for (const key of JOINT_KEYS) {
      const o = rig[key]!
      const rest = REST[key]
      expect(o.position.x, key).toBeCloseTo(rest.x, 12)
      expect(o.position.y, key).toBeCloseTo(rest.y, 12)
      expect(o.position.z, key).toBeCloseTo(rest.z, 12)
      expect(o.rotation.x, key).toBe(0)
      expect(o.scale.x, key).toBe(1)
    }
  })

  /*
    The bug class this exists for: a joint wired to the wrong node still
    animates, so it is invisible in a screenshot and only shows up as "the head
    moves when it turns, which is odd". Driving one joint at a time and checking
    that exactly that node moved is the only cheap way to catch it.
  */
  it('routes each pose field to its own node and to no other', () => {
    for (const key of JOINT_KEYS) {
      const rig = fullRig()
      const pose = createPose()
      pose[key].px = 0.11
      pose[key].ry = 0.22
      pose[key].sy = 1.33
      applyPose(pose, rig)

      for (const other of JOINT_KEYS) {
        const o = rig[other]!
        const rest = REST[other]
        const moved =
          Math.abs(o.position.x - rest.x) > 1e-9 ||
          Math.abs(o.rotation.y) > 1e-9 ||
          Math.abs(o.scale.y - 1) > 1e-9
        expect(moved, `${key} drove ${other}`).toBe(other === key)
      }
    }
  })

  it('adds the pose to the rest position rather than replacing it', () => {
    const rig = fullRig()
    const pose = createPose()
    pose.head.py = 0.05
    pose.shoulderL.px = -0.02
    applyPose(pose, rig)
    expect(rig.head!.position.y).toBeCloseTo(REST.head.y + 0.05, 12)
    expect(rig.shoulderL!.position.x).toBeCloseTo(REST.shoulderL.x - 0.02, 12)
  })

  it('hangs each cape segment a segment length below its parent', () => {
    const rig = fullRig()
    applyPose(createPose(), rig)
    expect(rig.cape[0]!.position.y).toBe(0)
    for (let i = 1; i < 4; i++) {
      expect(rig.cape[i]!.position.y).toBeCloseTo(-CAPE.segmentLength, 12)
    }
  })

  it('skips null nodes without throwing', () => {
    const rig = createRigRefs()
    rig.head = new Object3D()
    const pose = createPose()
    pose.head.rz = 0.4
    expect(() => applyPose(pose, rig)).not.toThrow()
    expect(rig.head.rotation.z).toBeCloseTo(0.4, 12)
  })

  it('is idempotent, so a repeated call cannot accumulate', () => {
    const rig = fullRig()
    const pose = createPose()
    pose.hips.py = 0.03
    applyPose(pose, rig)
    const once = rig.hips!.position.y
    applyPose(pose, rig)
    expect(rig.hips!.position.y).toBe(once)
  })

  it('covers every joint the pose declares', () => {
    // If a joint is added to the Pose and forgotten in RigRefs this stops
    // compiling, but the reverse - a rig node with no pose field - would only
    // show up as a limb that never moves.
    const rig = fullRig()
    const keys = Object.keys(rig).filter((k) => k !== 'cape') as JointKey[]
    expect(keys.sort()).toEqual([...JOINT_KEYS].sort())
  })
})

describe('writeVisorUniforms', () => {
  function uniforms() {
    return {
      uTime: { value: 0 },
      uOpenL: { value: 0 },
      uOpenR: { value: 0 },
      uArchL: { value: 0 },
      uArchR: { value: 0 },
      uWidthL: { value: 0 },
      uWidthR: { value: 0 },
      uBright: { value: 0 },
      uScan: { value: 0 },
      uGlitch: { value: 0 },
      uGaze: { value: new Vector2() },
    }
  }

  it('pushes every face parameter through', () => {
    const u = uniforms()
    const pose = createPose()
    pose.face.openL = 0.4
    pose.face.openR = 1.5
    pose.face.archL = -0.25
    pose.face.widthR = 1.2
    pose.face.brightness = 4.2
    pose.face.scan = 0.9
    pose.face.scanPhase = 12.5
    pose.face.glitch = 0.3
    pose.face.gazeX = -0.7
    pose.face.gazeY = 0.2
    writeVisorUniforms(pose.face, u)
    expect(u.uOpenL.value).toBe(0.4)
    expect(u.uOpenR.value).toBe(1.5)
    expect(u.uArchL.value).toBe(-0.25)
    expect(u.uWidthR.value).toBe(1.2)
    expect(u.uBright.value).toBe(4.2)
    expect(u.uScan.value).toBe(0.9)
    expect(u.uTime.value).toBe(12.5)
    expect(u.uGlitch.value).toBe(0.3)
    expect(u.uGaze.value.x).toBe(-0.7)
    expect(u.uGaze.value.y).toBe(0.2)
  })

  it('mutates the gaze vector rather than replacing it', () => {
    // Replacing it every frame would allocate a Vector2 sixty times a second in
    // the render loop, and three does not need a new object to notice a change.
    const u = uniforms()
    const before = u.uGaze.value
    writeVisorUniforms(createPose().face, u)
    expect(u.uGaze.value).toBe(before)
  })

  it('degrades rather than throwing when a tier compiles a smaller uniform set', () => {
    const partial = { uOpenL: { value: 0 } }
    expect(() => writeVisorUniforms(createPose().face, partial)).not.toThrow()
    expect(partial.uOpenL.value).toBe(1)
  })
})
