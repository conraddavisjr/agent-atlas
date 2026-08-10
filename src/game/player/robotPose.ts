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
  impulse1,
  impulse2,
  resetSpring1,
  resetSpring2,
  squashScale,
  stepSpring1,
  stepSpring2,
  type Spring1,
  type Spring2,
} from './springs'
import { MOVEMENT, WADDLE } from './tuning'
import {
  ANTICIPATION,
  ANTENNA,
  CAPE,
  EAR_POD,
  GAIT,
  HEAD,
  IDLE,
  LANDING,
  SHADOW,
  SPRINGS,
  SQUASH_ANIM,
  TURN_ANIM,
} from './animTuning'
import { drainEvents, EV, pushEvent, type AnimEventRing, type RobotAnimState, type SquashMode } from './robotAnim'

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
  /** The half-period index of the last footstep, so one fires per half cycle. */
  lastFoot2: number
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

  /** The depth and strength of the landing currently decaying, so the limb offsets share its spring. */
  landDepth: number
  landStrength: number

  /** Finite-difference memory for the inertial drives. */
  prev: {
    velX: number; velY: number; velZ: number
    /** A second copy, one frame further back, for the antenna's acceleration. */
    velXPrev: number; velZPrev: number
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
    lastFoot2: Number.NaN,
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

    landDepth: 0,
    landStrength: 0,

    prev: {
      velX: 0, velY: 0, velZ: 0,
      velXPrev: 0, velZPrev: 0,
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
 * The four cape segments' constants, indexed rather than looked up by name.
 *
 * Each segment is slower and looser than the one above it, which is what makes
 * the chain read as a hanging sheet rather than as four hinges of equal weight.
 */
const CAPE_SPRINGS = [SPRINGS.cape0, SPRINGS.cape1, SPRINGS.cape2, SPRINGS.cape3] as const

/**
 * Turns a drained event into velocity impulses on the secondary chains.
 *
 * A module-level function taking the runtime as an explicit argument, rather
 * than a closure capturing it. A closure here would allocate one function per
 * frame, which is exactly the garbage the no-allocation rule exists to prevent
 * and is doubly wrong in a drain that only runs when something is happening.
 */
function applyEventImpulses(r: AnimEventRing, slot: number, rt: AnimRuntime): void {
  const kind = r.kind[slot]
  const a = r.a[slot]
  if (kind === EV.Land) {
    impulse1(rt.springs.headPitch, HEAD.landImpulse * a)
    impulse2(rt.springs.antenna[0], ANTENNA.landImpulse * a, 0)
    impulse1(rt.springs.earPod[0], EAR_POD.landImpulse * a)
    impulse1(rt.springs.earPod[1], -EAR_POD.landImpulse * a)
    for (const seg of rt.springs.cape) impulse2(seg, CAPE.landImpulse * a, 0)
    // A hard landing is a beat the face should acknowledge.
    if (a > 0.5) {
      rt.face.expression = EXPRESSION.Surprised
      rt.face.expressionHold = 0.5
    }
  } else if (kind === EV.Jump) {
    impulse2(rt.springs.antenna[0], -ANTENNA.eventImpulse * a, 0)
    impulse1(rt.springs.headPitch, -HEAD.landImpulse * 0.35 * a)
  } else if (kind === EV.Bonk) {
    impulse2(rt.springs.antenna[0], ANTENNA.eventImpulse * 1.4 * a, 0)
    rt.face.expression = EXPRESSION.Surprised
    rt.face.expressionHold = 0.5
  } else if (kind === EV.Revive) {
    rt.face.expression = EXPRESSION.Surprised
    rt.face.expressionHold = 0.6
  }
}

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
    /*
      Remember how deep this impulse went, so every limb offset a landing moves
      can be normalised against the same spring and they all recover together.
      A takeoff stretch drives no limb pose, so it seeds a strength of zero.
    */
    rt.landDepth = rt.springs.squashMode === 'takeoff' ? 0 : finite(s.squash, 1)
    rt.landStrength =
      rt.springs.squashMode === 'takeoff'
        ? 0
        : Math.min(1, Math.max(0, (1 - finite(s.squash, 1)) / 0.45))
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

  /*
    Vertical bob, at double the step frequency because both feet contribute,
    and lagged behind the roll.

    Without the lag the bob peaks exactly when the body is at maximum roll and
    the two motions fuse into one, which is the single cheapest thing that was
    wrong with the existing waddle. 0.55 rad puts the peak roughly a third of a
    step past the roll extreme.
  */
  out.hips.py = Math.sin(p * 2 + GAIT.bobPhaseLag) * WADDLE.bobAmplitude * walking
  /* The weight shifting onto the planted foot. */
  out.hips.px = Math.sin(p) * GAIT.hipShiftAmplitude * walking

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
    Hip yaw, deliberately opposing the roll.

    This is what separates a waddle from a metronome: the hip that rises also
    rotates back, which is how a toddler's pelvis actually moves and why the
    gait reads as one continuous motion rather than as a roll plus a bounce
    happening at the same time.
  */
  out.hips.ry = -Math.sin(p) * GAIT.hipYawAmplitude * walking

  /*
    Hips lead the turn and the torso lags behind it, with the head leading
    further still, looking where it is about to go. This is what stops a
    rotation reading as a turntable.

    The lag now sits on the CHEST rather than on the hips. When this lived in
    the component there was one body node, so the legs inherited the lag too and
    the feet swung behind the direction the character was actually facing. The
    rig split makes it possible to lag the torso alone and leave the stance
    tracking the true facing, which is the behaviour a turn should have.

    Both yaws go through springs rather than being written straight from the
    eased input. The exponential ease stays as the input filter; the springs sit
    downstream and give the lag an overshoot it did not have. The visible
    difference is that releasing a turn key now lets the torso swing slightly
    past centre and come back, which is the difference between a lag and a rig.
  */
  rt.springs.chestYaw.target = t * TURN_ANIM.torsoLag
  rt.springs.headYaw.target = -t * TURN_ANIM.headLead
  stepSpring1(rt.springs.chestYaw, SPRINGS.chestYaw.omega, SPRINGS.chestYaw.zeta, step)
  stepSpring1(rt.springs.headYaw, SPRINGS.headYaw.omega, SPRINGS.headYaw.zeta, step)

  /*
    Turn snap.

    Crossing most of the turn rate within one step, having been near zero, is a
    deliberate stab at the stick rather than a gradual lean, and it gets an
    impulse into the springs instead of a change of target. That is precisely
    what a spring integrator is good at and what an easing curve cannot express
    at all: a target change says the body has moved, an impulse says it has been
    hit.
  */
  const turnMag = Math.abs(finite(s.turnRate)) / MOVEMENT.turnRate
  const lastMag = Math.abs(rt.lastTurnEased)
  if (turnMag > GAIT.turnSnapHigh && lastMag < GAIT.turnSnapLow) {
    const dir = Math.sign(finite(s.turnRate)) || 1
    impulse1(rt.springs.chestYaw, GAIT.turnSnapChest * dir)
    impulse1(rt.springs.headYaw, GAIT.turnSnapHead * dir)
    pushEvent(
      s.events, EV.TurnSnap, rt.t,
      finite(s.worldX), finite(s.worldY), finite(s.worldZ),
      0, 1, 0,
      Math.min(1, turnMag), dir,
    )
  }
  rt.lastTurnEased = turnMag

  out.chest.ry = rt.springs.chestYaw.x
  out.head.ry = rt.springs.headYaw.x

  // Limbs counter-swing. In the air they tuck instead, so a jump does not look
  // like a mid-stride freeze.
  const swing = Math.sin(p) * WADDLE.limbSwing * walking
  const tuck = grounded ? 0 : 0.5

  out.legL.rx = swing - tuck
  out.legR.rx = -swing - tuck
  out.shoulderL.rx = -swing * 0.7 - tuck * 1.4
  out.shoulderR.rx = swing * 0.7 - tuck * 1.4

  // The outside arm lifts away from the body through a turn. This is the
  // reference's "feet trail on direction change" applied to the arms, where a
  // character with no visible knees shows it far more clearly.
  out.shoulderL.rz = -t * GAIT.armTrail
  out.shoulderR.rz = -t * GAIT.armTrail

  /*
    A footstep fires each time the step cycle crosses a half period while the
    character is actually moving on the ground.

    Tracked on the phase rather than on a timer, so it stays locked to the gait
    at any speed: the same crossing that puts a foot at the bottom of its swing
    is the one that emits, which is what will make a dust puff land under a foot
    rather than near one.
  */
  if (grounded && walking > 0.05) {
    const half = Math.floor(p / Math.PI)
    if (half !== rt.lastFoot2) {
      rt.lastFoot2 = half
      rt.lastFoot = rt.lastFoot === 0 ? 1 : 0
      rt.sinceStep = 0
      pushEvent(
        s.events, EV.Footstep, rt.t,
        finite(s.worldX), finite(ground.y), finite(s.worldZ),
        finite(ground.nx), finite(ground.ny, 1), finite(ground.nz),
        speedNorm, rt.lastFoot,
      )
    }
  } else {
    // Reset the marker while airborne, so the first step after landing is not
    // swallowed by a stale half-period index.
    rt.lastFoot2 = Number.NaN
  }
  rt.sinceStep += step

  // Feet splay through a pivot so the stance opens into the turn rather than
  // the legs scissoring straight through each other.
  const splay = t * TURN_ANIM.footPivot * (grounded ? 1 : 0)
  out.legL.ry = splay
  out.legR.ry = -splay

  /*
    Drain the event ring.

    An impulse into a spring produces a much crisper snap than driving its
    target, and events are the only place the solver learns that something
    discrete happened. This is also the demonstration that the channel works:
    the same ring the VFX system will read is what makes the antenna whip.
  */
  rt.eventCursor = drainEvents(s.events, rt.eventCursor, applyEventImpulses, rt)

  /*
    Landing impact, and the reason it is one spring rather than eleven.

    Every limb offset below decays on the SAME landing spring as the squash, by
    normalising the spring's distance from neutral against the depth it started
    at. That is what makes a landing read as a single event rather than as
    eleven things happening near each other, and it is why the squash spring had
    to move into the solver: a spring inside the controller's frame loop could
    only ever drive the scale.
  */
  const landDepth = 1 - Math.min(1, Math.max(0, rt.landDepth))
  const landDecay =
    landDepth > 1e-4
      ? Math.min(1, Math.max(0, (1 - rt.springs.squash.x) / landDepth))
      : 0
  const impact = landDecay * rt.landStrength

  out.kneeL.rx += LANDING.knee * impact
  out.kneeR.rx += LANDING.knee * impact
  out.legL.ry += -LANDING.legSplay * impact
  out.legR.ry += LANDING.legSplay * impact
  out.footL.rx += LANDING.footPitch * impact
  out.footR.rx += LANDING.footPitch * impact
  out.shoulderL.rx += LANDING.shoulderPitch * impact
  out.shoulderR.rx += LANDING.shoulderPitch * impact
  out.shoulderL.rz += -LANDING.shoulderRoll * impact
  out.shoulderR.rz += LANDING.shoulderRoll * impact

  /*
    Anticipation on an unbuffered jump, and an honest note about it.

    A game cannot anticipate an action the player has not taken without adding
    input latency, which is never acceptable. So the root is already rising on
    frame 0 while the knees are still folding and the feet trail below their
    rest. The body going up while the legs go down is what anticipation looks
    like from the outside and it costs nothing. A future reader who finds
    ANTICIPATION.frames and cannot see a crouch on an ordinary jump has not
    found a bug.
  */
  const rising = !grounded && finite(s.verticalVelocity) > 0
  if (rising) {
    const fold = Math.min(1, finite(s.airTime) / (ANTICIPATION.frames / 60))
    const fade = 1 - fold
    out.kneeL.rx += ANTICIPATION.kneeCompress * fade
    out.kneeR.rx += ANTICIPATION.kneeCompress * fade
    out.footL.py -= ANTICIPATION.footTrail * fade
    out.footR.py -= ANTICIPATION.footTrail * fade
  }

  /*
    Head nod, driven by vertical acceleration rather than by an event.

    The head snapping down on landing and lifting on takeoff is most of what
    sells weight on a character with no neck to sell it with, and taking it from
    acceleration means it happens on every change of vertical motion rather than
    only on the ones something remembered to fire an event for.
  */
  const vy = finite(s.velY)
  const verticalAccel = step > 1e-6 ? (vy - rt.prev.velY) / step : 0
  rt.prev.velX = finite(s.velX)
  rt.prev.velY = vy
  rt.prev.velZ = finite(s.velZ)
  rt.springs.headPitch.target = Math.max(
    -HEAD.nodClamp,
    Math.min(HEAD.nodClamp, -verticalAccel * HEAD.nodGain),
  )
  rt.springs.headRoll.target = -out.hips.rz * 0.35
  stepSpring1(rt.springs.headPitch, SPRINGS.headPitch.omega, SPRINGS.headPitch.zeta, step)
  stepSpring1(rt.springs.headRoll, SPRINGS.headRoll.omega, SPRINGS.headRoll.zeta, step)
  out.head.rx += rt.springs.headPitch.x
  out.head.rz += rt.springs.headRoll.x

  /*
    Antenna, two segments, driven inertially rather than positionally.

    A trailing mass leans OPPOSITE to acceleration, so the drive is the
    finite-differenced acceleration of its root and not any position. At a hard
    landing the root decelerates at roughly 25 m/s^2, which asks for 0.55 rad
    and clamps to 0.5, so the antenna whips to nearly 30 degrees and rings for
    about 1.4 seconds. That is the most visible piece of secondary motion on the
    character and it costs four floats.
  */
  const accelZ = step > 1e-6 ? (finite(s.velZ) - rt.prev.velZPrev) / step : 0
  const accelX = step > 1e-6 ? (finite(s.velX) - rt.prev.velXPrev) / step : 0
  rt.prev.velXPrev = finite(s.velX)
  rt.prev.velZPrev = finite(s.velZ)
  const clampA = (v: number) => Math.max(-ANTENNA.clamp, Math.min(ANTENNA.clamp, v))
  rt.springs.antenna[0].targetX = clampA(-accelZ * ANTENNA.inertia)
  rt.springs.antenna[0].targetZ = clampA(accelX * ANTENNA.inertia)
  // The tip trails the base, which is what makes the pair read as one whipping
  // rod rather than as two independent hinges.
  rt.springs.antenna[1].targetX = -rt.springs.antenna[0].x * ANTENNA.tipTrail
  rt.springs.antenna[1].targetZ = -rt.springs.antenna[0].z * ANTENNA.tipTrail
  stepSpring2(rt.springs.antenna[0], SPRINGS.antennaBase.omega, SPRINGS.antennaBase.zeta, step)
  stepSpring2(rt.springs.antenna[1], SPRINGS.antennaMid.omega, SPRINGS.antennaMid.zeta, step)
  out.antennaBase.rx = rt.springs.antenna[0].x
  out.antennaBase.rz = rt.springs.antenna[0].z
  out.antennaMid.rx = rt.springs.antenna[1].x
  out.antennaMid.rz = rt.springs.antenna[1].z

  /*
    Ear pods counter-swing against the body roll, about X so they flap forward
    and back rather than up and down. Fast enough to settle inside 300 ms, which
    is what makes them read as firm rubber rather than as loose.
  */
  rt.springs.earPod[0].target = -out.hips.rz * EAR_POD.counterRoll
  rt.springs.earPod[1].target = -out.hips.rz * EAR_POD.counterRoll
  stepSpring1(rt.springs.earPod[0], SPRINGS.earPod.omega, SPRINGS.earPod.zeta, step)
  stepSpring1(rt.springs.earPod[1], SPRINGS.earPod.omega, SPRINGS.earPod.zeta, step)
  out.earPodL.rx = rt.springs.earPod[0].x
  out.earPodR.rx = rt.springs.earPod[1].x

  /*
    Cape, four segments, each dragged by however far its parent is from ITS own
    target.

    Gravity drapes it and the body's own motion in its local frame blows it back.
    At full speed every segment settles at 0.214 rad, accumulating to 0.856 at
    the tip, so it streams back at 49.0 degrees. The full derivation, the fold
    this replaces and why a bare sign flip overshoots to 131 degrees are all in
    `CAPE`'s doc comment in `animTuning.ts`.

    Two sign facts, because this line was wrong for both of them and the second
    one is what makes the first look wrong:

      - Forward at `rotation.y = 0` is +Z, and a positive `rx` carries a
        downward-hanging segment toward -Z. So trailing behind forward motion is
        `+ localVelZ`, and the `-` that shipped swung the cape into the legs.
      - `targetZ` keeps its minus and that is correct, not inconsistent. A
        positive `rz` carries the same segment toward +X, the opposite handedness
        to the X case, so the two terms need opposite signs to express the same
        "trail behind the motion".

    `base` is computed once outside the loop rather than per segment, which is
    what makes the inherit term a pure error feedback: subtracting `base` from the
    parent's state leaves only its deviation, so the term vanishes at steady state
    and the chain settles into a constant-curvature arc instead of compounding.
  */
  const cosF = Math.cos(-finite(s.facing))
  const sinF = Math.sin(-finite(s.facing))
  const localVelZ = finite(s.velX) * -sinF + finite(s.velZ) * cosF
  const localVelX = finite(s.velX) * cosF + finite(s.velZ) * sinF
  const capeBaseX = CAPE.hang + localVelZ * CAPE.drag
  const capeBaseZ = -localVelX * CAPE.drag * 0.6
  for (let i = 0; i < 4; i++) {
    const seg = rt.springs.cape[i]
    const inherit = i === 0 ? 0 : (rt.springs.cape[i - 1].x - capeBaseX) * CAPE.inherit
    seg.targetX = capeBaseX + inherit
    seg.targetZ = capeBaseZ
    const k = CAPE_SPRINGS[i]
    stepSpring2(seg, k.omega, k.zeta, step)
    out.cape[i].rx = seg.x
    out.cape[i].rz = seg.z
  }

  /*
    Idle breathing.

    3.5% on Y, with the X and Z counter-scales at half that, which holds volume
    to within 0.1% over the cycle to first order. The 0.9 rad lag on the head
    and shoulders is what stops the whole body pulsing as one unit, which reads
    as a lighting flicker rather than as breath.
  */
  const idle =
    speedNorm < IDLE.speedThreshold && grounded && finite(s.groundTime) > IDLE.groundDelay
  if (idle) {
    rt.idleTime += step
    rt.breathBlend = Math.min(1, rt.breathBlend + step / IDLE.blendIn)
  } else {
    rt.idleTime = 0
    rt.breathBlend = Math.max(0, rt.breathBlend - step / IDLE.blendOut)
  }
  if (rt.breathBlend > 0) {
    rt.breathPhase += step * ((2 * Math.PI) / IDLE.breathPeriod) * rt.breathBlend
    const b = Math.sin(rt.breathPhase) * IDLE.breathScale * rt.breathBlend
    out.root.sy *= 1 + b
    out.root.sx *= 1 - b * 0.5
    out.root.sz *= 1 - b * 0.5
    const lag = Math.sin(rt.breathPhase - IDLE.breathLag) * rt.breathBlend
    out.head.py += lag * 0.008
    out.shoulderL.rz += lag * 0.03
    out.shoulderR.rz -= lag * 0.03
  }

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

  solveFace(rt, s, step, grounded, speedNorm, out)
  out.face.scanPhase = rt.t
}

/**
 * The six named expressions, as the parameters the visor shader consumes.
 *
 * `blink` is not in the table: it overrides `open` alone and inherits arch and
 * width from whatever is underneath, so a happy blink keeps its arc. Overriding
 * all three would make every blink identical and the face would lose its mood
 * for 110 ms at a time.
 */
const EXPRESSIONS = [
  /* Neutral   */ { open: 1.0, arch: 0.0, width: 1.0, bright: 1.0, scan: 0.55 },
  /* Happy     */ { open: 0.72, arch: 1.0, width: 1.15, bright: 1.12, scan: 0.45 },
  /* Surprised */ { open: 1.5, arch: 0.0, width: 0.6, bright: 1.18, scan: 0.35 },
  /* Squint    */ { open: 0.35, arch: 0.35, width: 1.25, bright: 0.88, scan: 0.7 },
  /* Focused   */ { open: 0.8, arch: -0.25, width: 0.8, bright: 1.06, scan: 0.9 },
] as const

/** The floor on `open`. The slot never closes, which is the character's identity. */
const OPEN_FLOOR = 0.06

/** Blink envelope, in seconds: fast close, a hold, then a slower open. */
const BLINK_CLOSE = 0.035
const BLINK_HOLD = 0.05
const BLINK_TOTAL = 0.11

function solveFace(
  rt: AnimRuntime,
  s: Readonly<RobotAnimState>,
  step: number,
  grounded: boolean,
  speedNorm: number,
  out: Pose,
): void {
  const f = rt.face

  if (f.expressionHold > 0) {
    f.expressionHold -= step
    if (f.expressionHold <= 0) f.expression = EXPRESSION.Neutral
  }

  const e = EXPRESSIONS[f.expression] ?? EXPRESSIONS[0]

  /*
    Blink cadence.

    Random 2 to 5 seconds, measured on the scaled clock so hit-stop does not
    advance it. The close is quadratic and the open is its inverse: linear in
    both directions reads as a shutter rather than as an eyelid, and the 15 ms
    hold in between is what makes it read as a blink at all.
  */
  if (f.blinkAt === 0) f.blinkAt = rt.t + randomRange(rt.rng, 2, 5)

  /*
    Suppression, and every rule here is load-bearing.

    Blinking mid-launch reads as the character being bored by its own jump, and
    a landing already has a face beat of its own so a blink on top of it muddles
    both. Blinks are deliberately NOT suppressed while focused: a totally
    unblinking stare while the player reads a prompt is unsettling.
  */
  const launching = !grounded && finite(s.verticalVelocity) > 0
  const suppressed = launching || f.expression === EXPRESSION.Surprised

  if (f.blinkT < 0 && rt.t >= f.blinkAt && !suppressed) {
    f.blinkT = 0
  }

  let blinkOpen = 1
  if (f.blinkT >= 0) {
    f.blinkT += step
    const b = f.blinkT
    if (b < BLINK_CLOSE) {
      const u = b / BLINK_CLOSE
      blinkOpen = 1 - u * u * (1 - OPEN_FLOOR)
    } else if (b < BLINK_CLOSE + BLINK_HOLD) {
      blinkOpen = OPEN_FLOOR
    } else if (b < BLINK_TOTAL) {
      const u = (b - BLINK_CLOSE - BLINK_HOLD) / (BLINK_TOTAL - BLINK_CLOSE - BLINK_HOLD)
      const eased = 1 - (1 - u) * (1 - u)
      blinkOpen = OPEN_FLOOR + eased * (1 - OPEN_FLOOR)
    } else {
      f.blinkT = -1
      blinkOpen = 1
      if (f.doubleRemaining === 1) {
        // 15% of blinks are doubles, and the second follows 180 ms after the
        // first ends.
        f.doubleRemaining = 0
        f.blinkAt = rt.t + 0.18
      } else {
        f.doubleRemaining = nextRandom(rt.rng) < 0.15 ? 1 : 0
        f.blinkAt = rt.t + randomRange(rt.rng, 2, 5)
      }
    }
  }

  /*
    Gaze.

    The head already leads a turn, so pointing the eyes further along the
    direction of travel means the eyes lead the head, which is the order a real
    look happens in. Smoothed at lambda 10, a 100 ms time constant: instant gaze
    reads as a machine and anything past about 200 ms reads as sedated.
  */
  const gazeTargetX = speedNorm > 0.25 ? Math.max(-1, Math.min(1, -rt.turnEased * 1.6)) : 0
  const lerp = 1 - Math.exp(-10 * step)
  f.gazeX += (gazeTargetX - f.gazeX) * lerp
  f.gazeY += ((grounded ? 0 : Math.max(-1, Math.min(1, finite(s.velY) / 10))) - f.gazeY) * lerp

  const open = Math.max(OPEN_FLOOR, e.open * blinkOpen)
  out.face.openL = open
  out.face.openR = open
  out.face.archL = e.arch
  out.face.archR = e.arch
  out.face.widthL = e.width
  out.face.widthR = e.width
  out.face.brightness = e.bright
  out.face.scan = e.scan
  out.face.gazeX = f.gazeX
  out.face.gazeY = f.gazeY
  out.face.glitch = 0
}
