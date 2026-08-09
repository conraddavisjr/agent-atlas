/**
 * The other half of the pose boundary: writing a `Pose` onto `Object3D`s.
 *
 * This module imports `three` but not React, and `Object3D` is pure matrix
 * maths with no WebGL context behind it, so it runs fine under vitest's `node`
 * environment. That matters more than it looks: "does the head node actually
 * receive the head pose" is a real bug class, it is invisible in a screenshot
 * because a wrong joint still animates, and it is cheap to cover.
 *
 * Nothing here decides anything. Every decision was made in `stepAnim`; if this
 * file is doing arithmetic beyond adding a rest offset, something belongs on
 * the other side of the boundary.
 */

import type { IUniform, Object3D } from 'three'
import {
  JOINT_KEYS,
  REST,
  REST_ROTATION,
  type FaceParams,
  type JointKey,
  type JointPose,
  type Pose,
  type Vec3,
} from './robotPose'
import { CAPE } from './animTuning'

/**
 * One `Object3D` per animated node, by the same names the `Pose` uses.
 *
 * A mapped type rather than a hand-written list, so a joint added to the pose
 * cannot be silently forgotten here. Every field is nullable because refs are
 * null until the first commit, and because a tier that does not build the cape
 * legitimately has none.
 */
export type RigRefs = { [K in JointKey]: Object3D | null } & {
  cape: [Object3D | null, Object3D | null, Object3D | null, Object3D | null]
}

/** An empty rig, for the `useRef` in `RobotModel` and for tests. */
export function createRigRefs(): RigRefs {
  const rig = { cape: [null, null, null, null] } as RigRefs
  for (const key of JOINT_KEYS) rig[key] = null
  return rig
}

/**
 * Cape segment rest offsets.
 *
 * The first segment sits at its socket and every one after it hangs a segment
 * length below its parent, so the chain builds itself out of one number.
 */
const CAPE_REST_HEAD: Vec3 = { x: 0, y: 0, z: 0 }
const CAPE_REST_LINK: Vec3 = { x: 0, y: -CAPE.segmentLength, z: 0 }

function writeJoint(o: Object3D | null, j: JointPose, rest: Vec3, restRot: Vec3 | undefined): void {
  if (!o) return
  o.position.set(rest.x + j.px, rest.y + j.py, rest.z + j.pz)
  if (restRot) o.rotation.set(restRot.x + j.rx, restRot.y + j.ry, restRot.z + j.rz)
  else o.rotation.set(j.rx, j.ry, j.rz)
  o.scale.set(j.sx, j.sy, j.sz)
}

/**
 * Writes a `Pose` onto the rig.
 *
 * Rotation order stays three's default `XYZ` on every joint. Changing it per
 * joint is a real temptation for the head, where yaw-then-pitch avoids a small
 * gimbal artefact at extreme angles, and it is not worth it: the head never
 * exceeds 0.5 rad on any axis and the artefact is not visible below about 1.2.
 */
export function applyPose(p: Pose, rig: RigRefs): void {
  for (const key of JOINT_KEYS) {
    writeJoint(rig[key], p[key], REST[key], REST_ROTATION[key])
  }
  for (let i = 0; i < 4; i++) {
    writeJoint(rig.cape[i], p.cape[i], i === 0 ? CAPE_REST_HEAD : CAPE_REST_LINK, undefined)
  }
}

/**
 * Pushes the face parameters into the visor shader's uniforms.
 *
 * The only place `RobotModel` touches that material. Kept here rather than in
 * the component for the same reason `applyPose` is: it is a write of computed
 * values onto a graphics object, and it is testable in node because a uniform
 * is a plain `{ value }` box with no GL behind it.
 *
 * Every uniform is guarded on existing, so a tier that compiles the cheap
 * variant without the scanline uniforms degrades to a static bar rather than
 * throwing sixty times a second.
 */
export function writeVisorUniforms(
  face: Readonly<FaceParams>,
  uniforms: Record<string, IUniform>,
): void {
  set(uniforms, 'uTime', face.scanPhase)
  set(uniforms, 'uOpenL', face.openL)
  set(uniforms, 'uOpenR', face.openR)
  set(uniforms, 'uArchL', face.archL)
  set(uniforms, 'uArchR', face.archR)
  set(uniforms, 'uWidthL', face.widthL)
  set(uniforms, 'uWidthR', face.widthR)
  set(uniforms, 'uBright', face.brightness)
  set(uniforms, 'uScan', face.scan)
  set(uniforms, 'uGlitch', face.glitch)

  const gaze = uniforms.uGaze
  // A Vector2, mutated rather than replaced: assigning a new one every frame is
  // an allocation in the render loop and three does not need it to notice.
  if (gaze && gaze.value && typeof gaze.value === 'object' && 'x' in gaze.value) {
    const v = gaze.value as { x: number; y: number }
    v.x = face.gazeX
    v.y = face.gazeY
  }
}

function set(uniforms: Record<string, IUniform>, name: string, value: number): void {
  const u = uniforms[name]
  if (u) u.value = value
}
