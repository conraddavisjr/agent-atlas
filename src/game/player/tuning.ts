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

/**
 * The second jump, and the foot thrusters that sell it.
 *
 * ## Why this is one block and not two
 *
 * A discrete double jump and a timed hover are the same mechanism with one
 * constant moved. Both are "a press in the air sets a vertical velocity and
 * opens a window during which gravity is reduced"; a double jump is that window
 * at zero and a hover is that window at a few hundred milliseconds. Building the
 * general form costs nothing and means the choice between them is a number
 * rather than a rewrite. See `docs/design/92-double-jump.md`.
 *
 * ## PROVISIONAL. Every number here is an engineering placeholder.
 *
 * They are internally consistent and they are not researched. They exist so the
 * mechanism can be built and tested before the reference numbers land, and they
 * are marked so nobody mistakes them for measurements. The one thing they are
 * chosen to satisfy is the ratio the brief actually states - "move up higher and
 * prolong their air time" - so the second jump has to add height AND airtime
 * rather than only re-launching.
 */
export const AIR_JUMP = {
  /**
   * How many jumps are available after leaving the ground. 1 is a double jump.
   *
   * Refilled on landing only, never in the air, which is what stops a held key
   * from becoming flight. See `stepVertical`.
   */
  count: 1,

  /**
   * Upward velocity the second press sets, as a fraction of `JUMP.velocity`.
   *
   * A fraction rather than an absolute, so retuning the first jump carries the
   * second with it. Below 1 on purpose: a second jump that matches the first
   * reads as a bug, because the eye expects the boost to be the smaller,
   * cheaper move.
   *
   * SET rather than added. Adding to the current velocity makes the height
   * depend on when in the arc the press landed, so a press at the apex and a
   * press on the way down give different results from the same button - which
   * is the class of thing players describe as "sometimes it does not work".
   */
  velocityFraction: 0.78,

  /**
   * How long the thrusters burn, in seconds, and therefore how long gravity is
   * reduced.
   *
   * This is THE constant that decides whether the move is a double jump or a
   * hover. At 0 it is a pure second impulse.
   *
   * 0.20, from the research rather than from the placeholder that shipped first.
   * `92-double-jump.md` measured what this and `velocityFraction` produce together
   * against the frozen `JUMP` constants:
   *
   *   apex, single             1.030 body heights
   *   apex, doubled            2.087 body heights, a ratio of 2.03
   *   second press to apex     377 ms
   *   airtime                  0.621 s to 1.115 s, a ratio of 1.80
   *
   * The apex ratio is the number to carry between games, because it is the only
   * one that is free of this project's unit scale.
   */
  thrustTime: 0.2,

  /**
   * Gravity multiplier while the thrusters are burning.
   *
   * Applied to the RISING gravity only. The fall multiplier is untouched, so the
   * descent after the burn is the same heavy, snappy fall the first jump has and
   * the move does not turn the character into a balloon on the way down.
   */
  thrustGravity: 0.45,

  /**
   * The window after leaving the ground during which the second jump is
   * refused, in seconds.
   *
   * Without it a fast double tap spends both jumps inside the first few frames
   * and the character gets one slightly higher jump instead of two, which reads
   * as the input being eaten. It is the mirror of `JUMP.coyoteTime`: that one
   * forgives a press slightly too late, this one forgives a press slightly too
   * early by making it impossible rather than wasteful.
   */
  lockout: 0.12,
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
  fov: 40,
  initialPitch: -0.08,
  collisionRadius: 0.28,
  collisionSkin: 0.08,
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
  /**
   * Orbit sensitivity, in radians per pixel of drag.
   *
   * Was 0.0032, which needed **982 px of drag for a half turn** and 1963 for a
   * full one. On any laptop trackpad that is more than one gesture, so the camera
   * could not be brought round to the front of the character in a single motion
   * however long you were willing to keep dragging. At 0.009 a half turn is
   * 349 px, which fits comfortably inside one sweep.
   */
  mouseSensitivity: 0.009,
  stickSensitivity: 2.6,
  /**
   * How long realignment stays suppressed after the player last moved the camera
   * by hand, in seconds.
   *
   * The suppression used to be frame-instantaneous, tested on whether a look
   * delta arrived this exact frame. Against a realign spring with a 126 ms
   * half-life that meant any pause mid-drag, and any frame that happened to
   * deliver no `mousemove`, immediately started pulling the camera back behind the
   * character. A camera angle the player chose is not un-chosen the moment their
   * hand stops.
   *
   * Long enough to look at something and think about it; short enough that the
   * camera still tidies up after you rather than needing to be put back.
   */
  manualHold: 2.5,
  /**
   * Pitch clamp, so you can never flip under the world or stare at the sky.
   *
   * **`minPitch` is derived, not chosen.** The rest offset adds `height`
   * unconditionally on top of `sin(pitch) * distance`, so the camera drops below
   * its own look target once `sin(pitch) < -height / distance`, which is
   * `-4.3 / 10.7 = -0.402`, i.e. pitch below -0.4135 rad. Past that the collision
   * ray is aimed downward from the target and hits the ground, the pull-in
   * collapses distance to `minDistance` 1.6, and recovery takes about two seconds
   * at `pullOutSpeed`. The symptom was that trying to look at the character's face
   * snapped the camera into it at 1.6 m through a 40 degree lens and then crawled
   * back out.
   *
   * -0.35 keeps the camera 0.56 m above the look target at the limit, so the ray
   * always points up and outward and can never find the floor, while still giving
   * a nearly level view of the face. The old -0.5 put it 0.83 m BELOW the target.
   */
  minPitch: -0.35,
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
