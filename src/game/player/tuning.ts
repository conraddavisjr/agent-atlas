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
  /**
   * How fast left and right rotate the robot, in radians per second.
   *
   * Roughly 170 degrees a second, so a full about-turn takes a little under
   * two. This is the main dial for how the game feels to drive: lower is
   * ponderous and hard to line a jump up with, higher starts to spin the camera
   * fast enough to be disorienting, because the camera follows the turn.
   *
   * Replaced turnSpeed, which was how quickly the robot rotated to face the
   * direction it was already travelling. Under tank controls facing is not
   * chasing anything, it is the input.
   */
  turnRate: 3.0,
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

export const REVIVAL = {
  /**
   * How far above the spawn point the robot materialises before dropping in.
   *
   * The brief asked for "about 50 pixels". At the current framing - fov 40,
   * slant range hypot(10.7, 4.3) = 11.53, a 1080-tall viewport - one screen
   * pixel is `2 * 11.53 * tan(20 deg) / 1080` = 0.0078 world units at the
   * player, so 50px works out to 0.39. That reads as a stumble rather than as
   * coming back to life, so the default here is the height that actually sells
   * the beat. Set it to 0.39 for the literal reading.
   *
   * The value itself was chosen on feel and is unaffected by the field of view
   * change; only the arithmetic above moved, and it is corrected rather than
   * left to mislead the next person who reads it.
   */
  dropHeight: 1.6,

  /**
   * Landing squash on revival, deeper than an ordinary landing.
   *
   * There is no separate bounce animation. The critically damped spring in
   * PlayerController's frame loop already overshoots slightly on its way back to
   * neutral, so squashing harder than SQUASH.landSquash is the whole effect: a
   * deeper compression produces a correspondingly bigger rebound for free.
   */
  landSquash: 0.55,
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
  /**
   * Resting offset behind and above the player, before orbit is applied.
   *
   * These two are not taste values and must not be tuned independently. They
   * are derived from the field of view, which `03-environment.md` section 6
   * takes from 55 to 40 to buy the diorama read, and they exist to hold the
   * character the same size in frame while it changes.
   *
   * The apparent height of an object at slant range D is
   * `H / (2 D tan(fov / 2))`, so holding it constant means holding
   * `D tan(fov / 2)` constant. At rest `D = hypot(distance, height)`:
   *
   *   old   hypot(7.5, 3.0)   = 8.0777,  tan(27.5 deg) = 0.520567
   *         product                                      4.2045   <- invariant
   *   new   4.2045 / tan(20 deg) = 11.5518,  so scale k = 1.43004
   *         distance  7.5 * k = 10.725  ->  10.7
   *         height    3.0 * k =  4.290  ->   4.3
   *   check hypot(10.7, 4.3) * tan(20 deg) = 4.1970 vs 4.2045, 0.2% out
   *
   * Both components scale by the same k so the rest pitch is preserved:
   * `atan(4.3 / 10.7)` is 21.90 degrees against the old 21.80. How far down
   * the camera looks is a separate art decision from the focal length, and
   * this change is not making it.
   *
   * What actually changes is compression behind the character. An object 20 m
   * behind it renders at 11.5313 / 31.5313 = 0.366 of its size at the
   * character's depth, against 0.288 before, so the background comes in 27
   * per cent larger relative to the subject. That is the whole point.
   */
  distance: 10.7,
  height: 4.3,
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
  /**
   * Pull in instantly to avoid clipping, but ease back out so it is not jarring.
   *
   * Raised from 4 with the field of view. The recovery now has 11.5 m of slant
   * range to travel rather than 8.1, and at the old rate covering half again
   * the distance at the same speed reads as the camera being slow to forgive.
   */
  pullOutSpeed: 5,

  /**
   * How hard the camera pulls back behind the player, as an exponential
   * damping rate rather than a fixed angular speed.
   *
   * Higher arrives sooner. Because the step is proportional to how far off the
   * camera is, one number covers both ends: turning to walk toward the camera
   * brings it round in well under a second, while the constant small
   * corrections of ordinary walking stay imperceptible.
   *
   * This replaced a fixed radians-per-second, which could not do both. It also
   * no longer has to be kept low to tame a feedback loop: under tank controls
   * the direction of travel never consults the camera, so realigning the camera
   * cannot change where the player is going.
   */
  realignDamping: 5.5,


  /**
   * Angular slack, in radians, before realignment engages at all.
   *
   * Roughly 2 degrees. Exponential damping already tapers to nothing as it
   * converges, so this does not have to hide the tail of the correction; it
   * only stops the camera reacting to the last fraction of a degree once the
   * player has stopped turning.
   */
  realignDeadzone: 0.035,
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

  /** The iris collapsing onto the character. */
  irisCloseMs: 340,

  /**
   * The iris opening back out from the character.
   *
   * Budgeted against the fall, not chosen for its own sake. From
   * REVIVAL.dropHeight of 1.6 at JUMP.gravity scaled by fallGravityMultiplier,
   * the robot is in the air for sqrt(2 * 1.6 / 36) which is about 300ms. Opening
   * over slightly longer than that means the landing bounce happens while the
   * reveal is still finishing, so the two read as one motion rather than as a
   * reveal followed by a separate animation.
   */
  irisOpenMs: 420,
} as const
