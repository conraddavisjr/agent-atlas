import { describe, it, expect } from 'vitest'
import { Object3D, Vector2 } from 'three'
import { applyPose, createCape, createRigRefs, writeVisorUniforms, type RigRefs } from './rig'
import { createPose, JOINT_KEYS, REST, REST_ROTATION, type JointKey } from './robotPose'
import { CAPE } from './animTuning'
import { CAPE_RIBBON } from './robotGeometry'

/** A rig with a real Object3D behind every node, and a real cape surface. */
function fullRig(): RigRefs {
  const rig = createRigRefs()
  for (const key of JOINT_KEYS) rig[key] = new Object3D()
  rig.cape = createCape()
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
      expect(o.rotation.x, key).toBe(REST_ROTATION[key]?.x ?? 0)
      expect(o.rotation.y, key).toBe(REST_ROTATION[key]?.y ?? 0)
      expect(o.rotation.z, key).toBe(REST_ROTATION[key]?.z ?? 0)
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
        // Against the rest transform rather than against zero, because several
        // joints are deliberately not level at rest.
        const restRy = REST_ROTATION[other]?.y ?? 0
        const moved =
          Math.abs(o.position.x - rest.x) > 1e-9 ||
          Math.abs(o.rotation.y - restRy) > 1e-9 ||
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

  /*
    The cape is one deforming surface rather than four nested nodes now, so what
    `applyPose` does with `Pose.cape` is skin it rather than write four transforms.
    The four springs and the fixed length of four are unchanged; see
    `CAPE_RIBBON` in `robotGeometry.ts`.

    Asserted through the hem rather than through a node position, because there
    are no cape nodes left to have a position. The hem has to hang the full chain
    length below the socket at rest, which is the same invariant the four
    `-CAPE.segmentLength` offsets used to express.
  */
  it('hangs the cape its full chain length below the socket at rest', () => {
    const rig = fullRig()
    applyPose(createPose(), rig)
    const p = rig.cape!.geometry.getAttribute('position')
    // To 6 places and not 12: a position attribute is a Float32Array, so -0.72
    // comes back as -0.7200000286. Every other assertion in this file is on an
    // Object3D, where the numbers are doubles.
    expect(p.getY(rig.cape!.capBottomFirst)).toBeCloseTo(
      -CAPE.segmentLength * CAPE_RIBBON.segments,
      6,
    )
    expect(p.getY(rig.cape!.capTopFirst)).toBeCloseTo(0, 6)
  })

  it('drives the cape surface from the pose rather than leaving it at rest', () => {
    const rig = fullRig()
    const pose = createPose()
    applyPose(pose, rig)
    const restZ = rig.cape!.geometry.getAttribute('position').getZ(rig.cape!.capBottomFirst)

    for (const seg of pose.cape) seg.rx = 0.214
    applyPose(pose, rig)
    const bentZ = rig.cape!.geometry.getAttribute('position').getZ(rig.cape!.capBottomFirst)
    // Behind, because a positive rx trails a hanging segment toward -Z.
    expect(bentZ).toBeLessThan(restZ)
  })

  it('skips a missing cape without throwing, since the springs run regardless', () => {
    const rig = createRigRefs()
    expect(rig.cape).toBeNull()
    const pose = createPose()
    for (const seg of pose.cape) seg.rx = 0.5
    expect(() => applyPose(pose, rig)).not.toThrow()
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
