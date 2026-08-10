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
import { createCapeRibbon, skinCapeRibbon, type CapeRibbon } from './robotGeometry'

/**
 * One `Object3D` per animated node, by the same names the `Pose` uses, plus the
 * cape's deformable surface.
 *
 * A mapped type rather than a hand-written list, so a joint added to the pose
 * cannot be silently forgotten here. Every field is nullable because refs are
 * null until the first commit, and because a tier that does not build the cape
 * legitimately has none.
 *
 * `cape` is a single `CapeRibbon` and not the four `Object3D`s it used to be.
 * The four springs are unchanged and `Pose.cape` is still a fixed-length four;
 * what changed is where their angles land. They used to be written onto four
 * nested `Group`s carrying one rigid slab each, and they are now skinned onto one
 * continuous surface - see `CAPE_RIBBON` in `robotGeometry.ts` for why that is
 * done on the CPU rather than in a vertex shader, which comes down to
 * `onBeforeCompile` not reaching the shadow depth material.
 *
 * It belongs on this side of the pose boundary for the same reason `applyPose`
 * does: it is a write of already-decided numbers onto a graphics object, it makes
 * no decisions, and a `BufferGeometry` is a typed array with no GL context behind
 * it, so it is covered by a node test exactly as the `Object3D` writes are.
 */
export type RigRefs = { [K in JointKey]: Object3D | null } & {
  cape: CapeRibbon | null
}

/** An empty rig, for the `useRef` in `RobotModel` and for tests. */
export function createRigRefs(): RigRefs {
  const rig = { cape: null } as RigRefs
  for (const key of JOINT_KEYS) rig[key] = null
  return rig
}

/**
 * Builds the cape's surface.
 *
 * Here rather than in `robotParts.tsx` so the segment length is read in exactly
 * one place, and so a test can build the real ribbon without React.
 */
export function createCape(): CapeRibbon {
  return createCapeRibbon(CAPE.segmentLength)
}

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
  // Guarded, because a tier or a cosmetic state without a cape legitimately has
  // no ribbon and the four springs keep running regardless.
  if (rig.cape) skinCapeRibbon(rig.cape, p.cape)
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
