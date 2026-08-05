/**
 * Every constant that affects how the game FEELS lives in this one file.
 *
 * This is not organisational tidiness. Tuning a platformer is an iterative,
 * play-adjust-play loop, and the difference between "student project" and
 * "professional" is almost entirely the numbers below rather than the rendering.
 * Having them scattered across components makes that loop slow enough that it
 * quietly stops happening.
 *
 * Units are metres and seconds throughout.
 */

export const MOVEMENT = {
  /** Top ground speed. Astro-like characters feel best brisk rather than floaty. */
  maxSpeed: 6.0,
  /** How hard we accelerate toward the target velocity. Higher is snappier. */
  acceleration: 60,
  /**
   * Deceleration is separate from acceleration and deliberately higher.
   * Equal values feel mushy, because the character keeps drifting after you
   * release the stick. This asymmetry is most of what makes stopping feel crisp.
   */
  deceleration: 90,
  /**
   * How much control you keep mid-air, as a fraction of ground control.
   * Zero feels punishing and one feels weightless. Around a third is the range
   * where players feel in control without the jump losing its commitment.
   */
  airControl: 0.35,
  /** How fast the robot rotates to face travel direction. */
  turnSpeed: 14,
} as const

export const JUMP = {
  /** Initial upward velocity. Tuned against gravity below for a ~0.85s arc. */
  velocity: 8.2,
  gravity: -24,
  /** Terminal velocity, so long falls stay readable instead of accelerating forever. */
  maxFallSpeed: -28,

  /**
   * Coyote time: you can still jump for this long after walking off a ledge.
   * Players routinely press jump a frame or two after leaving the ground and
   * genuinely believe the game dropped their input. This is the fix.
   */
  coyoteTime: 0.1,

  /**
   * Jump buffering: a jump pressed this long before landing still fires on landing.
   * The mirror image of coyote time, covering players who press slightly early.
   */
  bufferTime: 0.12,

  /**
   * Variable height: releasing the button early cuts upward velocity by this factor.
   * This is what turns one jump into a whole expressive range, and it is the
   * cheapest possible upgrade to how a platformer feels.
   */
  cutMultiplier: 0.45,

  /**
   * Extra gravity while falling. Real projectile motion feels sluggish in games;
   * a heavier fall than rise is the standard correction and reads as "snappy".
   */
  fallGravityMultiplier: 1.5,
} as const

export const BODY = {
  /** Capsule half-height excluding the caps. */
  capsuleHalfHeight: 0.35,
  capsuleRadius: 0.35,
  /** Small skin width so the capsule never rests exactly on a surface. */
  colliderOffset: 0.02,
  /** Steps up to this height are climbed automatically instead of blocking. */
  autostepHeight: 0.5,
  autostepMinWidth: 0.2,
  /** How far below the feet we snap to ground, which keeps slopes from launching you. */
  snapToGroundDistance: 0.5,
  maxSlopeClimbAngle: (50 * Math.PI) / 180,
  minSlopeSlideAngle: (35 * Math.PI) / 180,
} as const

export const SQUASH = {
  /**
   * Squash and stretch does more for the toy feel than any shader.
   * The body stretches on takeoff and squashes on landing, then springs back.
   */
  takeoffStretch: 1.18,
  landSquash: 0.78,
  /** How fast the deformation recovers toward neutral. */
  recovery: 9,
  /** Landing impact below this speed does not squash, so small steps stay calm. */
  minLandSpeed: 4,
} as const

export const WADDLE = {
  /**
   * Team ASOBI describe Astro as waddling "like a toddler". With procedural
   * primitives and no skeleton, that charm has to come from whole-body motion:
   * a bob, a side-to-side roll, and counter-swinging limbs.
   */
  bobAmplitude: 0.055,
  bobFrequency: 9,
  rollAmplitude: 0.14,
  limbSwing: 0.7,
  /** Lean into the direction of travel, which sells momentum. */
  leanAmount: 0.12,
} as const

export const CAMERA = {
  /** Resting offset behind and above the player, before orbit is applied. */
  distance: 7.5,
  height: 3.0,
  /** Look target sits above the feet so the robot is not centred in frame. */
  lookHeight: 1.0,
  /**
   * Spring damping. Lower is looser and more cinematic, higher is tighter and
   * more responsive. This is a taste dial and worth playing with.
   */
  positionDamping: 6,
  targetDamping: 10,
  /** Orbit sensitivity for mouse drag and gamepad right stick. */
  mouseSensitivity: 0.0032,
  stickSensitivity: 2.6,
  /** Pitch clamp, so you can never flip under the world or stare at the sky. */
  minPitch: -0.5,
  maxPitch: 1.1,
  /**
   * Collision pull-in. The camera raycasts toward the player and sits in front of
   * anything it hits. Matters from day one because portal scenes are interiors.
   */
  collisionPadding: 0.4,
  minDistance: 1.6,
  /** Pull in instantly to avoid clipping, but ease back out so it is not jarring. */
  pullOutSpeed: 4,
} as const

export const INTERACTION = {
  /** How close the player must be for a totem to highlight and prompt. */
  radius: 2.6,
  /** Hysteresis so a prompt on the boundary does not flicker. */
  exitRadius: 3.1,
} as const

export const TRANSITION = {
  /**
   * Minimum time the screen stays covered during a portal transition.
   * Without a floor, a fast local load produces a jarring one-frame flash that
   * reads as a bug. The wipe is a feel element, not a loading indicator.
   */
  minDurationMs: 650,
  fadeOutMs: 320,
  fadeInMs: 380,
} as const
