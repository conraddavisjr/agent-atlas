/**
 * What pose the robot is in, as plain numbers.
 *
 * The rule this module exists to enforce is one sentence: a module may compute
 * what pose the robot is in, or it may write transforms onto `Object3D`s, and
 * never both. Everything here is on the first side, so there is no React
 * import, no `useFrame`, and no allocation after construction. `rig.ts` is the
 * whole of the second side.
 *
 * The reason is coverage. Every line of animation in this project used to live
 * inside `RobotModel.tsx`'s `useFrame`, and `vitest.config.ts` globs
 * `src/**\/*.test.ts` and nothing else, so a `.test.tsx` is silently skipped -
 * it does not fail and it does not warn, it simply never runs. The result was
 * that the most tuning-sensitive code in the game had zero tests while the
 * movement code beside it, extracted into `movement.ts` for exactly this
 * reason, had good ones. This is that same extraction applied to animation.
 *
 * Contents, in order:
 *   1. PROPORTIONS, REST and REST_ROTATION - where the geometry is
 *   2. JointPose, FaceParams, ShadowPose, Pose - what the solver produces
 *   3. GroundSample - the one piece of world state the solver cannot derive
 *   4. AnimRuntime - everything that persists between frames
 *   5. stepAnim - the single entry point
 */

import {
  createSpring1,
  createSpring2,
  resetSpring1,
  resetSpring2,
  squashScale,
  stepSpring1,
  type Spring1,
  type Spring2,
} from './springs'
import { WADDLE } from './tuning'
import { SHADOW, SPRINGS, SQUASH_ANIM, TURN_ANIM } from './animTuning'
import type { RobotAnimState, SquashMode } from './robotAnim'

// ---------------------------------------------------------------------------
// 1. Geometry
// ---------------------------------------------------------------------------

/** A local-space offset. Plain numbers so this module owes nothing to three. */
export type Vec3 = { x: number; y: number; z: number }

/**
 * Rest transforms, in each node's parent frame.
 *
 * `applyPose` writes `rest + poseOffset` and never an absolute value, so the
 * rest pose lives in exactly one place and the solver never has to know where
 * anything is. Moving a limb cannot break the animation that drives it, and an
 * animation cannot silently depend on a coordinate it was never told about.
 */
/**
 * The measurements the silhouette depends on.
 *
 * Its own exported block so `robotPose.test.ts` can assert on it, which is what
 * stops a future "make the head smaller, it looks weird" commit quietly
 * un-toying the character. The proportion change is the whole point of the
 * character work and it is exactly the kind of thing that gets undone by
 * someone fixing a different problem.
 *
 * Chosen against the reference brief's two measurements, which do not agree
 * with each other: 2.5-2.8 head-heights, and a head that is 40-48% of the
 * silhouette. Those two bands overlap at a single point, because 2.5
 * head-heights IS a 40% head. Both are marked as observed to plus or minus 10%,
 * so it is measurement scatter rather than a contradiction, and the head-height
 * ratio is taken as primary because it is the number that governs the read.
 */
export const PROPORTIONS = {
  /** Sole to crown, excluding the antenna. */
  totalHeight: 1.36,
  headHeight: 0.54,
  headWidth: 0.72,
  /** The widest band below the neck, which is the diaper rather than the torso. */
  torsoWidthMax: 0.62,
  /** The sole plane sits at the model's own origin. */
  soleY: 0,
} as const

/*
  The antenna reaches 1.53 m and does not count toward the silhouette height,
  because a thin protrusion does not read as mass. That is not a rounding
  convenience: including it would give 2.83 head-heights, and the character
  would be correct on paper and wrong on screen.
*/

export const REST = {
  root: { x: 0, y: 0, z: 0 },
  hips: { x: 0, y: 0.52, z: 0 },
  /** Local to hips, so world 0.740. */
  chest: { x: 0, y: 0.22, z: 0 },
  /** Local to chest, so world 0.890. */
  neck: { x: 0, y: 0.15, z: 0 },
  /** Local to neck, so world 1.090. The head band spans 0.820 to 1.360. */
  head: { x: 0, y: 0.2, z: 0 },
  shoulderL: { x: -0.31, y: 0.13, z: 0 },
  shoulderR: { x: 0.31, y: 0.13, z: 0 },
  handSocketL: { x: 0, y: -0.34, z: 0 },
  handSocketR: { x: 0, y: -0.34, z: 0 },
  /** Local to hips, so world 0.380, which is the top of the leg band. */
  legL: { x: -0.19, y: -0.14, z: 0 },
  legR: { x: 0.19, y: -0.14, z: 0 },
  kneeL: { x: 0, y: -0.13, z: 0 },
  kneeR: { x: 0, y: -0.13, z: 0 },
  /** World 0.085, and the foot is 0.17 tall, so the sole lands exactly on y = 0. */
  footL: { x: 0, y: -0.165, z: 0.06 },
  footR: { x: 0, y: -0.165, z: 0.06 },
  earPodL: { x: -0.38, y: 0, z: -0.02 },
  earPodR: { x: 0.38, y: 0, z: -0.02 },
  /**
   * Off-centre on purpose, and it is the one asymmetric feature on the
   * character. A perfectly mirror-symmetric toy reads as a product shot; one
   * thing out of line reads as a character.
   */
  antennaBase: { x: 0.2, y: 0.31, z: -0.04 },
  antennaMid: { x: 0, y: 0.085, z: 0 },
  backpack: { x: 0, y: 0.06, z: -0.29 },
  capeRoot: { x: 0, y: 0.06, z: -0.29 },
} as const satisfies Record<string, Vec3>

/**
 * Rest rotations, for the joints that are not level at rest.
 *
 * Both entries exist to defend a specific feature of the silhouette.
 *
 * The arms angle OUTWARD, which is what keeps a fully enclosed white wedge open
 * between each arm and the torso. That negative space is the single most
 * fragile part of the read: arms pinned to the sides merge into the body and
 * the whole character becomes one blob at any distance.
 *
 * The sign is not the one the design spec's `REST_ROTATION` block gives, and
 * the spec contradicts itself about it: that block puts +0.22 on the left while
 * its own silhouette checklist writes the pair as -+0.22. The physical answer
 * settles it. `shoulderL` sits at x = -0.310 and its arm hangs down -Y, so a
 * rotation about +Z carries the arm toward +X, which is into the body. Outward
 * for the left shoulder is -0.22.
 */
export const REST_ROTATION: Partial<Record<keyof typeof REST, Vec3>> = {
  shoulderL: { x: 0, y: 0, z: -0.22 },
  shoulderR: { x: 0, y: 0, z: 0.22 },
  /** The feet toe out slightly. A perfectly parallel stance reads as a mannequin. */
  legL: { x: 0, y: -0.1, z: 0 },
  legR: { x: 0, y: 0.1, z: 0 },
}

// ---------------------------------------------------------------------------
// 2. The pose
// ---------------------------------------------------------------------------

/**
 * One joint's offset from its rest transform.
 *
 * Scale is a multiplier, so 1 is neutral and the identity pose is all zeros
 * except for the three scale fields.
 */
export type JointPose = {
  px: number; py: number; pz: number
  rx: number; ry: number; rz: number
  sx: number; sy: number; sz: number
}

export type FaceParams = {
  /** 0 fully closed, 1 neutral, up to 1.6 for surprise. Never reaches 0. */
  openL: number
  openR: number
  /** -1 downturned, 0 flat, +1 upturned arc. */
  archL: number
  archR: number
  /** Horizontal squash of each eye core. 0.5 narrow to 1.4 wide. */
  widthL: number
  widthR: number
  /** Gaze offset in face-plate space, -1..1, applied to the eye cores only. */
  gazeX: number
  gazeY: number
  /**
   * Multiplier on the core's bloom-crossing brightness. 1 is neutral.
   *
   * A multiple rather than the spec's absolute HDR value, so the solver never
   * has to know what the bloom threshold is. `RobotFace` derives the absolute
   * level through `emissiveIntensityFor`, which means the visor tracks
   * BLOOM_THRESHOLD automatically when it is measured and lowered rather than
   * quietly becoming a floodlight.
   *
   * Ranges from about 0.88 for a squint to 1.24 for a surprise.
   */
  brightness: number
  /** Scanline strength. */
  scan: number
  /** Scanline scroll seconds. Advances on the scaled clock so hit-stop freezes it. */
  scanPhase: number
  /** 0..1, a brief horizontal tear used on damage and portal entry. */
  glitch: number
}

export type ShadowPose = {
  /** World-space position of the shadow quad. */
  x: number; y: number; z: number
  /** Ground normal at the contact point. */
  nx: number; ny: number; nz: number
  radius: number
  opacity: number
  /** Elongation along the direction of travel, 1 is circular. */
  stretch: number
  /** Facing of the elongation, radians, world Y. */
  yaw: number
}

/**
 * The complete answer to "what pose is the robot in".
 *
 * A struct of named objects rather than a `Float32Array`. The write count is
 * roughly 20 joints times 9 fields plus the face and the shadow, which is under
 * 250 numbers a frame and nowhere near a bottleneck, and named fields keep the
 * solver and its tests readable in a way that `POSE[JOINT_HEAD * 9 + 4]` does
 * not.
 *
 * Created once by `createPose()` and mutated in place forever after. Nothing in
 * the animation path may allocate: a per-frame allocation at 60 Hz is garbage
 * the collector eventually stops for, and it stops for it during the exact
 * moments the game is working hardest.
 */
export type Pose = {
  root: JointPose
  hips: JointPose
  chest: JointPose
  neck: JointPose
  head: JointPose
  shoulderL: JointPose; shoulderR: JointPose
  handSocketL: JointPose; handSocketR: JointPose
  legL: JointPose; legR: JointPose
  kneeL: JointPose; kneeR: JointPose
  footL: JointPose; footR: JointPose
  earPodL: JointPose; earPodR: JointPose
  antennaBase: JointPose; antennaMid: JointPose
  backpack: JointPose
  /** Fixed length 4. Segments beyond the tier's cape budget stay at identity. */
  cape: [JointPose, JointPose, JointPose, JointPose]
  face: FaceParams
  shadow: ShadowPose
}

/** Every joint field on a Pose, so tests and `resetPose` cannot drift apart. */
export const JOINT_KEYS = [
  'root', 'hips', 'chest', 'neck', 'head',
  'shoulderL', 'shoulderR', 'handSocketL', 'handSocketR',
  'legL', 'legR', 'kneeL', 'kneeR', 'footL', 'footR',
  'earPodL', 'earPodR', 'antennaBase', 'antennaMid', 'backpack',
] as const

export type JointKey = (typeof JOINT_KEYS)[number]

export function createJointPose(): JointPose {
  return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
}

function resetJoint(j: JointPose): void {
  j.px = 0; j.py = 0; j.pz = 0
  j.rx = 0; j.ry = 0; j.rz = 0
  j.sx = 1; j.sy = 1; j.sz = 1
}

export function createFaceParams(): FaceParams {
  return {
    openL: 1, openR: 1,
    archL: 0, archR: 0,
    widthL: 1, widthR: 1,
    gazeX: 0, gazeY: 0,
    brightness: 1,
    scan: 0.55,
    scanPhase: 0,
    glitch: 0,
  }
}

export function createShadowPose(): ShadowPose {
  return {
    x: 0, y: 0, z: 0,
    nx: 0, ny: 1, nz: 0,
    radius: 0,
    opacity: 0,
    stretch: 1,
    yaw: 0,
  }
}

export function createPose(): Pose {
  return {
    root: createJointPose(),
    hips: createJointPose(),
    chest: createJointPose(),
    neck: createJointPose(),
    head: createJointPose(),
    shoulderL: createJointPose(),
    shoulderR: createJointPose(),
    handSocketL: createJointPose(),
    handSocketR: createJointPose(),
    legL: createJointPose(),
    legR: createJointPose(),
    kneeL: createJointPose(),
    kneeR: createJointPose(),
    footL: createJointPose(),
    footR: createJointPose(),
    earPodL: createJointPose(),
    earPodR: createJointPose(),
    antennaBase: createJointPose(),
    antennaMid: createJointPose(),
    backpack: createJointPose(),
    cape: [createJointPose(), createJointPose(), createJointPose(), createJointPose()],
    face: createFaceParams(),
    shadow: createShadowPose(),
  }
}

/**
 * Resets every joint to identity.
 *
 * Called unconditionally at the top of `stepAnim`, and it is not optional.
 * Without it, a solver branch that stops writing a field - a fidget that ends,
 * a foot IK that disengages - leaves the previous frame's value in place and
 * the character freezes in a half-pose. That failure is subtle enough to
 * survive a code review, so the reset is unconditional and the cost is 250
 * stores.
 *
 * The face and the shadow are deliberately not reset. Both are continuous
 * state that every frame overwrites in full, and both carry values whose
 * neutral is not zero.
 */
export function resetPose(p: Pose): void {
  for (const key of JOINT_KEYS) resetJoint(p[key])
  for (const seg of p.cape) resetJoint(seg)
}

// ---------------------------------------------------------------------------
// 3. Ground
// ---------------------------------------------------------------------------

/**
 * The result of the single downward raycast the character does per frame.
 *
 * Sampled by the component and handed to the solver, rather than the solver
 * reaching into Rapier. That is what keeps `stepAnim` pure, and it is also what
 * lets a test drive the foot IK over a synthetic staircase with no physics
 * world at all.
 *
 * One ray, three consumers: the contact shadow's position, the foot IK's
 * reference plane, and the VFX emitter's ground point and normal. That is why
 * this is a named type rather than the shadow quietly doing its own cast.
 */
export type GroundSample = {
  hit: boolean
  /** World Y of the contact point under the body centre. */
  y: number
  /** Distance from the sole plane down to the contact. 0 when standing. */
  distance: number
  nx: number; ny: number; nz: number
  /** Per-foot samples. Populated only when the tier runs foot IK. */
  footHitL: boolean; footYL: number
  footHitR: boolean; footYR: number
}

export function createGroundSample(): GroundSample {
  return {
    hit: false,
    y: 0,
    distance: 0,
    nx: 0, ny: 1, nz: 0,
    footHitL: false, footYL: 0,
    footHitR: false, footYR: 0,
  }
}

// ---------------------------------------------------------------------------
// 4. Runtime
// ---------------------------------------------------------------------------

/** Idle fidget kinds. 0 is "no fidget running". */
export const FIDGET = {
  None: 0,
  LookAround: 1,
  AntennaFlick: 2,
  ToeTap: 3,
  DoubleBlink: 4,
  Shrug: 5,
  StretchUp: 6,
} as const
export type FidgetKind = (typeof FIDGET)[keyof typeof FIDGET]

/** Face expressions. The visor's shape library. */
export const EXPRESSION = {
  Neutral: 0,
  Happy: 1,
  Surprised: 2,
  Squint: 3,
  Focused: 4,
} as const
export type Expression = (typeof EXPRESSION)[keyof typeof EXPRESSION]

/**
 * Everything that has to persist between frames.
 *
 * Created once by `createAnimRuntime(seed)` and owned by a `useRef` in
 * `RobotModel`. That is what makes the whole thing deterministic and testable:
 * give a test the same seed and the same script of `(state, dt)` pairs and it
 * must produce identical numbers.
 *
 * Every field is a number, a small fixed struct, or a fixed-length array of
 * them. Nothing here is a `Map`, a `Set` or a growable array, which is what
 * keeps the no-allocation property checkable by inspection rather than by
 * profiling.
 */
export type AnimRuntime = {
  /** Step-cycle phase in radians. */
  phase: number
  /** Eased turn input. */
  turnEased: number
  /** Seconds since the last footstep, so the gait fires at most one per half cycle. */
  sinceStep: number
  /** Which foot planted last, 0 left 1 right. */
  lastFoot: 0 | 1
  /** Previous frame's turn rate, for detecting a snap. */
  lastTurnEased: number

  /** Breathing phase in radians, advanced only while idle. */
  breathPhase: number
  /** How much of the breathing pose is currently mixed in, 0..1. */
  breathBlend: number
  /** Seconds spent below the idle speed threshold. */
  idleTime: number

  fidget: {
    kind: FidgetKind
    t: number
    duration: number
    /** `idleTime` at which the next fidget fires. */
    nextAt: number
    /** So the same fidget never repeats back to back. */
    lastKind: FidgetKind
    /** Alternates the look direction, and any other per-fidget sign. */
    dir: number
  }

  face: {
    /** Absolute scaled-clock time of the next blink. */
    blinkAt: number
    /** -1 when not blinking, else elapsed within the blink. */
    blinkT: number
    doubleRemaining: 0 | 1
    gazeX: number
    gazeY: number
    expression: Expression
    /** Seconds remaining before the expression decays to neutral. */
    expressionHold: number
    /** 0..1 blend into the current expression, so nothing pops. */
    blend: number
    /** Absolute time of the next idle camera glance. */
    glanceAt: number
    glanceT: number
  }

  springs: {
    /** Vertical scale, driven by the squash impulses on RobotAnimState. */
    squash: Spring1
    /** Which spring profile the squash is currently running. */
    squashMode: SquashMode
    /** The last impulse consumed, so each one re-seeds the spring exactly once. */
    squashSeq: number
    /** Torso lag against the hips. */
    chestYaw: Spring1
    /** Head lead. */
    headYaw: Spring1
    headPitch: Spring1
    headRoll: Spring1
    /** Two segments, each 2-DOF. */
    antenna: [Spring2, Spring2]
    earPod: [Spring1, Spring1]
    cape: [Spring2, Spring2, Spring2, Spring2]
    footIkL: Spring1
    footIkR: Spring1
    shadowRadius: Spring1
  }

  /** Finite-difference memory for the inertial drives. */
  prev: {
    velX: number; velY: number; velZ: number
    /** Vertical acceleration, smoothed, m/s^2. */
    verticalAccel: number
    /** Foot swing heights before IK, so the IK adds to the animation. */
    swingYL: number; swingYR: number
    /** Applied IK offsets, kept so the pelvis can follow the lower foot. */
    ikOffsetL: number; ikOffsetR: number
  }

  /** Seeded, so fidget and blink schedules are reproducible in tests. */
  rng: { s: number }

  /** Absolute scaled-clock time, advanced by dt each call. */
  t: number

  /** The consumer cursor into the event ring. Owned by stepAnim. */
  eventCursor: number
}

export function createAnimRuntime(seed: number): AnimRuntime {
  return {
    phase: 0,
    turnEased: 0,
    sinceStep: 0,
    lastFoot: 0,
    lastTurnEased: 0,

    breathPhase: 0,
    breathBlend: 0,
    idleTime: 0,

    fidget: { kind: FIDGET.None, t: 0, duration: 0, nextAt: 0, lastKind: FIDGET.None, dir: 1 },

    face: {
      blinkAt: 0,
      blinkT: -1,
      doubleRemaining: 0,
      gazeX: 0,
      gazeY: 0,
      expression: EXPRESSION.Neutral,
      expressionHold: 0,
      blend: 1,
      glanceAt: 0,
      glanceT: -1,
    },

    springs: {
      squash: createSpring1(1),
      squashMode: 'land',
      squashSeq: 0,
      chestYaw: createSpring1(0),
      headYaw: createSpring1(0),
      headPitch: createSpring1(0),
      headRoll: createSpring1(0),
      antenna: [createSpring2(), createSpring2()],
      earPod: [createSpring1(0), createSpring1(0)],
      cape: [createSpring2(), createSpring2(), createSpring2(), createSpring2()],
      footIkL: createSpring1(0),
      footIkR: createSpring1(0),
      shadowRadius: createSpring1(SHADOW.baseRadius),
    },

    prev: {
      velX: 0, velY: 0, velZ: 0,
      verticalAccel: 0,
      swingYL: 0, swingYR: 0,
      ikOffsetL: 0, ikOffsetR: 0,
    },

    rng: { s: seed >>> 0 },
    t: 0,
    eventCursor: 0,
  }
}

/**
 * Puts the runtime back to rest without reallocating it.
 *
 * Needed on teleport: the dev harness drops the character somewhere else
 * between frames, and a spring carrying the velocity of wherever it used to be
 * makes the first frame after a teleport lurch.
 */
export function resetAnimRuntime(rt: AnimRuntime): void {
  rt.phase = 0
  rt.turnEased = 0
  rt.lastTurnEased = 0
  rt.breathBlend = 0
  rt.idleTime = 0
  resetSpring1(rt.springs.squash, 1)
  rt.springs.squash.target = 1
  resetSpring1(rt.springs.chestYaw)
  resetSpring1(rt.springs.headYaw)
  resetSpring1(rt.springs.headPitch)
  resetSpring1(rt.springs.headRoll)
  for (const s of rt.springs.antenna) resetSpring2(s)
  for (const s of rt.springs.earPod) resetSpring1(s)
  for (const s of rt.springs.cape) resetSpring2(s)
  resetSpring1(rt.springs.footIkL)
  resetSpring1(rt.springs.footIkR)
  resetSpring1(rt.springs.shadowRadius)
  rt.prev.velX = 0
  rt.prev.velY = 0
  rt.prev.velZ = 0
  rt.prev.verticalAccel = 0
}

/**
 * A seedable deterministic RNG, returning 0..1.
 *
 * mulberry32. `Math.random` would make the fidget schedule unreproducible,
 * which would make the whole solver untestable for the sake of saving four
 * lines.
 */
export function nextRandom(rng: { s: number }): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Uniform in `[lo, hi)`. */
export function randomRange(rng: { s: number }, lo: number, hi: number): number {
  return lo + nextRandom(rng) * (hi - lo)
}

// ---------------------------------------------------------------------------
// 5. The solver
// ---------------------------------------------------------------------------

/** Guards a value that came from outside the solver. NaN in a pose blanks the character. */
function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback
}

/**
 * Tilts a normal back toward vertical without changing which way it leans.
 *
 * A contact shadow lying flush on a steep face reads as a decal painted on the
 * hillside. Clamping the tilt keeps it reading as a shadow cast from above,
 * which is what the light in this scene actually does, while still letting a
 * gentle slope tip it enough to be believable.
 *
 * Pure and separate because it is exactly testable: given a normal 60 degrees
 * off vertical and a clamp of 35, the result must be 35 degrees off vertical in
 * the same azimuth.
 */
export function clampTilt(
  nx: number,
  ny: number,
  nz: number,
  maxTilt: number,
  out: { x: number; y: number; z: number },
): void {
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 1e-9)) {
    out.x = 0
    out.y = 1
    out.z = 0
    return
  }
  const ux = nx / len
  const uy = ny / len
  const uz = nz / len

  const tilt = Math.acos(Math.min(1, Math.max(-1, uy)))
  if (tilt <= maxTilt) {
    out.x = ux
    out.y = uy
    out.z = uz
    return
  }

  const horiz = Math.hypot(ux, uz)
  if (horiz < 1e-9) {
    // Pointing straight down, which only happens on a ceiling. Straight up is
    // the only answer that does not pick an arbitrary azimuth.
    out.x = 0
    out.y = 1
    out.z = 0
    return
  }
  const s = Math.sin(maxTilt)
  out.x = (ux / horiz) * s
  out.y = Math.cos(maxTilt)
  out.z = (uz / horiz) * s
}

/** Scratch for the clamped ground normal. Module level, so the solver allocates nothing. */
const tiltScratch = { x: 0, y: 1, z: 0 }

/**
 * The single entry point. Writes into `out` and returns nothing.
 *
 * Allocates nothing, and reads nothing global except the frozen constant
 * objects in `tuning.ts` and `animTuning.ts`. Everything that has to persist
 * between calls lives in `rt`.
 *
 * The `dt` clamp lives in the caller rather than here on purpose: a test that
 * wants to prove the solver survives a ten second step needs to be able to pass
 * one.
 */
export function stepAnim(
  rt: AnimRuntime,
  s: Readonly<RobotAnimState>,
  ground: Readonly<GroundSample>,
  dt: number,
  out: Pose,
): void {
  resetPose(out)

  const step = Math.max(0, finite(dt))
  rt.t += step

  const speedNorm = Math.min(1, Math.max(0, finite(s.speedNorm)))
  const turnNorm = Math.max(-1, Math.min(1, finite(s.turnNorm)))
  const throttle = Math.max(-1, Math.min(1, finite(s.throttle)))
  const grounded = s.grounded === true

  /*
    Turn input, eased rather than read raw.

    Exponential damping, so it behaves the same at any refresh rate, matching
    the convention the camera uses. Without the ease, tapping a turn key snaps
    the whole upper body a tenth of a radian in one frame and reads as a glitch
    rather than as a lean.
  */
  rt.turnEased += (turnNorm - rt.turnEased) * (1 - Math.exp(-TURN_ANIM.damping * step))
  const t = rt.turnEased

  /*
    The step cycle runs on whichever is doing more work, travel or rotation.

    A pivot on the spot moves no distance but the feet still cover ground, so it
    has to step. Taking the max rather than the sum means walking and turning at
    once does not double the cadence.
  */
  const stride = Math.max(speedNorm, Math.abs(t) * TURN_ANIM.stepScale)

  // The walk cycle advances with actual speed, so the waddle stays in step with
  // movement instead of drifting out of sync at different speeds.
  rt.phase += step * WADDLE.bobFrequency * stride

  const walking = grounded ? stride : 0
  const p = rt.phase

  /*
    Squash and stretch at the root, so the whole robot deforms as one object.

    The controller states a depth and a profile; the recovery happens here. Each
    impulse snaps the spring to its depth with zero velocity and points it back
    at neutral, which is exactly what the controller's own frame loop used to
    do, except that the spring is now underdamped and therefore actually
    bounces. `squashSeq` rather than a value comparison, so two landings of the
    same depth in a row are two events.
  */
  const justImpulsed = s.squashSeq !== rt.springs.squashSeq
  if (justImpulsed) {
    rt.springs.squashSeq = s.squashSeq
    rt.springs.squashMode = s.squashMode ?? 'land'
    rt.springs.squash.x = finite(s.squash, 1)
    rt.springs.squash.v = 0
    rt.springs.squash.target = 1
  }
  const squashSpring = SPRINGS[
    rt.springs.squashMode === 'takeoff'
      ? 'squashTakeoff'
      : rt.springs.squashMode === 'revival'
        ? 'squashRevival'
        : 'squashLand'
  ]
  stepSpring1(rt.springs.squash, squashSpring.omega, squashSpring.zeta, step)
  squashScale(rt.springs.squash.x, SQUASH_ANIM.lateral, out.root)

  // Vertical bob, at double the step frequency because both feet contribute.
  out.hips.py = Math.sin(p * 2) * WADDLE.bobAmplitude * walking

  /*
    Side-to-side roll is the actual waddle, plus a bank into the turn.

    Local +X is the robot's left, so a positive rotation about Z tips the top
    toward its right, which is the way you want it falling in a right-hand turn.
    Kept small: the low centre of gravity is a deliberate part of the design and
    a deep lean fights it.
  */
  out.hips.rz = Math.sin(p) * WADDLE.rollAmplitude * walking + t * TURN_ANIM.bankAmount

  /*
    Lean into travel, which sells momentum and weight, and signed by throttle so
    reversing leans back. It used to lean forward in both directions, which read
    as the robot being dragged backwards against its will.
  */
  out.hips.rx = WADDLE.leanAmount * walking * Math.sign(throttle)

  /*
    Hips lead the turn and the torso lags behind it, with the head leading
    further still, looking where it is about to go.

    This is the part that stops a rotation reading as a turntable. The parent
    group already carries the true facing, so these are offsets against it:
    positive is behind the turn, because facing decreases as the robot turns
    right.

    The lag is on the hips rather than on the chest, which is where it was when
    it lived in the component and where the legs inherit it from. The rig split
    makes it possible to lag the chest alone and leave the feet tracking the
    true facing, which is the better behaviour and is a deliberate change rather
    than a side effect, so it lands with the animation pass and not here.
  */
  out.hips.ry = t * TURN_ANIM.torsoLag
  out.head.ry = -t * (TURN_ANIM.torsoLag + TURN_ANIM.headLead)

  // Limbs counter-swing. In the air they tuck instead, so a jump does not look
  // like a mid-stride freeze.
  const swing = Math.sin(p) * WADDLE.limbSwing * walking
  const tuck = grounded ? 0 : 0.5

  out.legL.rx = swing - tuck
  out.legR.rx = -swing - tuck
  out.shoulderL.rx = -swing * 0.7 - tuck * 1.4
  out.shoulderR.rx = swing * 0.7 - tuck * 1.4

  // Feet splay through a pivot so the stance opens into the turn rather than
  // the legs scissoring straight through each other.
  const splay = t * TURN_ANIM.footPivot * (grounded ? 1 : 0)
  out.legL.ry = splay
  out.legR.ry = -splay

  /*
    The contact shadow.

    The single highest value-per-cost item on the character. At the shadow map's
    density the 0.70 m foot span gets about forty texels and its contact edge
    gets one, which is why the robot reads as hovering, and no resolution the
    tier system can afford would fix it. Two triangles and one raycast do.

    It grows AND fades with height, which is the behaviour of a penumbra from a
    finite-size source and is what makes jump height readable: a player judging
    a landing reads the shadow, not the character.
  */
  const h = Math.min(1, Math.max(0, finite(ground.distance) / SHADOW.maxHeight))
  const hit = ground.hit === true

  /*
    The landing spike, and the one piece of impact feedback that runs on every
    tier including the one with no particles at all. A dark ring snapping
    outward and settling in 200 ms is a genuinely good impact cue and it costs
    one uniform write. On the richer tiers it sits underneath the dust and makes
    it land better.

    Driven off the squash impulse rather than a separate channel, so a landing
    can never spike the shadow without also squashing the body.
  */
  if (justImpulsed && rt.springs.squashMode !== 'takeoff') {
    const strength = Math.min(1, Math.max(0, (1 - finite(s.squash, 1)) / 0.45))
    rt.springs.shadowRadius.x =
      SHADOW.baseRadius * (1 + SHADOW.landRadiusSpike * strength)
  }

  rt.springs.shadowRadius.target = SHADOW.baseRadius * (1 + SHADOW.spread * h)
  stepSpring1(
    rt.springs.shadowRadius,
    SPRINGS.shadowRadius.omega,
    SPRINGS.shadowRadius.zeta,
    step,
  )

  clampTilt(finite(ground.nx), finite(ground.ny, 1), finite(ground.nz), SHADOW.maxTilt, tiltScratch)

  out.shadow.x = finite(s.worldX)
  out.shadow.y = finite(ground.y)
  out.shadow.z = finite(s.worldZ)
  out.shadow.nx = tiltScratch.x
  out.shadow.ny = tiltScratch.y
  out.shadow.nz = tiltScratch.z
  out.shadow.radius = Math.max(0, rt.springs.shadowRadius.x)
  /*
    Opacity is written directly with no smoothing, deliberately. Smoothing it
    makes the shadow lag the character stepping off a ledge, which is one of the
    most visible wrong things a blob shadow can do.
  */
  out.shadow.opacity = hit ? SHADOW.maxOpacity * Math.pow(1 - h, SHADOW.fadePower) : 0
  out.shadow.stretch = 1 + (SHADOW.maxStretch - 1) * speedNorm
  out.shadow.yaw = finite(s.facing)

  out.face.scanPhase = rt.t
}
