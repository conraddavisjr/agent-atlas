/**
 * Constants that affect how the robot LOOKS while it moves, as opposed to how
 * it feels to drive.
 *
 * Deliberately separate from `tuning.ts`. That file owns movement feel and is
 * the thing to open when the handling is wrong; this one owns pose and is the
 * thing to open when the handling is right but the robot looks wrong. Keeping
 * them apart means an animation change can never be mistaken for a feel
 * regression, which matters most while both are being worked on at once.
 */

export const TURN_ANIM = {
  /**
   * How much of a full-rate turn counts as "walking" for the purposes of
   * advancing the step cycle.
   *
   * A pivot on the spot covers real ground at the feet even though the body's
   * centre does not move, so the legs have to step through it. Below one, so a
   * turn steps more slowly than a run.
   */
  stepScale: 0.55,

  /**
   * Torso counter-rotation into the turn, in radians at full turn rate.
   *
   * A character whose whole body rotates as one rigid board is the clearest
   * single tell of unanimated rotation. Letting the hips lead and the torso lag
   * behind is most of the fix, and it costs one lerp.
   */
  torsoLag: 0.17,

  /** Head leads the turn, looking where it is about to go. Opposes torsoLag. */
  headLead: 0.13,

  /**
   * Outward lean into the turn, like a cornering motorcycle.
   *
   * Small. The robot has a deliberately low centre of gravity and leaning it far
   * fights that read.
   */
  bankAmount: 0.09,

  /**
   * How fast the pose catches up to a change in turn input, as an exponential
   * damping rate.
   *
   * Frame-rate independent, matching the convention used for the camera in
   * `movement.ts`. Low enough that stabbing the key produces a sway rather than
   * a snap.
   */
  damping: 9,

  /** Foot splay during a pivot, so the stance widens rather than scissoring. */
  footPivot: 0.22,
} as const

/**
 * Every spring on the character, as (omega, zeta) pairs.
 *
 * In one block rather than scattered through the solver, because the useful
 * question is almost never "what is the head's damping" on its own. It is "is
 * the head firmer than the ear pods", and that is only answerable if the two
 * numbers are next to each other.
 *
 * `omega` is the natural frequency in rad/s and decides how fast the spring
 * arrives. `zeta` is the damping ratio and decides how far it goes past. The
 * overshoot column is `exp(-pi * zeta / sqrt(1 - zeta^2))` and is not a comment:
 * `springs.test.ts` asserts every row against it, so the table is executable and
 * cannot rot into documentation that used to be true.
 *
 *   zeta 1.00 -> 0%     dead, and what the squash spring used to do
 *   zeta 0.70 -> 4.6%   firm
 *   zeta 0.58 -> 10.7%  the middle of the reference brief's 8-15% band
 *   zeta 0.35 -> 30.6%  a wobbler
 *   zeta 0.18 -> 56.4%  a spring antenna
 */
export const SPRINGS = {
  /** Landing. Snappy: 9.5% overshoot, peak at 245 ms, settled by 313 ms. */
  squashLand: { omega: 16, zeta: 0.6 },
  /** Takeoff. Softer, so the stretch reads through the rise rather than snapping out of it. */
  squashTakeoff: { omega: 11, zeta: 0.62 },
  /**
   * Revival. Keeps `SQUASH.recovery`'s pace of 9 and finally gives the landing
   * the bounce `REVIVAL.landSquash`'s comment has always claimed it had.
   */
  squashRevival: { omega: 9, zeta: 0.55 },

  /** Torso lag against the hips. */
  chestYaw: { omega: 13, zeta: 0.65 },
  /** Head arrives before the torso, which is what makes it read as looking ahead. */
  headYaw: { omega: 18, zeta: 0.68 },
  /** Nod, driven by vertical acceleration. */
  headPitch: { omega: 15, zeta: 0.55 },
  headRoll: { omega: 15, zeta: 0.7 },

  /**
   * Antenna, two segments. The tip is faster and looser than the base, which is
   * what makes the pair read as one whipping rod rather than as two hinges.
   */
  antennaBase: { omega: 11.8, zeta: 0.18 },
  antennaMid: { omega: 14.5, zeta: 0.16 },

  /** Ear pods. Settled in under 300 ms, so they read as firm rubber, not as loose. */
  earPod: { omega: 21, zeta: 0.5 },

  /** Cape, four segments, each slower and looser than the one above it. */
  cape0: { omega: 9.5, zeta: 0.3 },
  cape1: { omega: 8.5, zeta: 0.3 },
  cape2: { omega: 7.6, zeta: 0.32 },
  cape3: { omega: 6.8, zeta: 0.34 },

  /**
   * Foot IK blend. Critically damped on purpose, and the one place in the file
   * where zero overshoot is the correct answer: a foot that overshoots its
   * ground contact is a foot inside the floor.
   */
  footIk: { omega: 22, zeta: 1 },

  /** Contact shadow radius, so the landing spike has something to overshoot. */
  shadowRadius: { omega: 20, zeta: 0.75 },
} as const

export type SpringName = keyof typeof SPRINGS

/**
 * Gait constants that extend `WADDLE` in `tuning.ts` without touching it.
 *
 * They live here rather than beside `WADDLE` because `tuning.ts` is frozen for
 * the whole art overhaul: the art bible's section 3 keeps `MOVEMENT`, `JUMP`,
 * `BODY` and `SQUASH` fixed so that any change in how the game feels stays
 * attributable to animation rather than to handling. These three are pose, not
 * feel, so this is where they belong anyway.
 */
export const GAIT = {
  /**
   * Hip yaw sway, deliberately opposing the roll.
   *
   * This is what separates a waddle from a metronome. The hip that rises also
   * rotates back, which is how a toddler's pelvis actually moves, and it is why
   * the gait reads as one continuous motion rather than as a roll plus a
   * separate bounce happening at the same time.
   */
  hipYawAmplitude: 0.07,
  /**
   * Phase lag of the vertical bob behind the roll, in radians.
   *
   * 0.55 rad puts the bob peak roughly a third of a step past the roll extreme.
   * With no lag at all the two motions peak together and fuse into one, which
   * is the single cheapest thing wrong with the existing waddle.
   */
  bobPhaseLag: 0.55,
  /** Lateral hip translation, metres. The weight shifting onto the planted foot. */
  hipShiftAmplitude: 0.022,
  /**
   * Outside arm lifting away from the body through a turn.
   *
   * The reference's "feet trail on direction change", applied to the arms where
   * it is far more visible on a character with no visible knees.
   */
  armTrail: 0.14,
  /** Velocity impulses fired into the yaw springs when a turn snaps on. */
  turnSnapChest: 2.5,
  turnSnapHead: -1.8,
  /** Fraction of the max turn rate that counts as a snap, and the floor it must have come from. */
  turnSnapHigh: 0.85,
  turnSnapLow: 0.3,
} as const

/**
 * Squash and stretch shaping. The depths themselves stay in the frozen `SQUASH`.
 */
export const SQUASH_ANIM = {
  /**
   * How the volume-preserving widening splits between width and depth.
   *
   * Above 1 the character spreads sideways more than forward. A moulded shell
   * dropped on a floor really does do that, and it also reads better from a
   * camera which is almost always behind the character, where lateral spread is
   * visible and depth spread is not.
   */
  lateral: 1.1,
  /** Stretch while falling, scaled by fall speed against this. Applied outside the spring. */
  fallStretch: 0.06,
  fallStretchSpeed: 18,
} as const

/** Head lag and nod. */
export const HEAD = {
  /**
   * Nod gain against vertical acceleration, in s^2/m.
   *
   * The head snaps down on landing and lifts on takeoff, which is most of what
   * sells weight on a character with no neck to sell it with.
   */
  nodGain: 0.01,
  nodClamp: 0.22,
  /** Landing impulse into the pitch spring, rad/s at full strength. */
  landImpulse: -6,
} as const

/** The two-segment antenna, which is the most visible secondary motion on the character. */
export const ANTENNA = {
  /**
   * Inertial gain, s^2/m. A trailing mass leans opposite to acceleration, so
   * the drive is the finite-differenced acceleration of the antenna's root
   * rather than any position.
   *
   * At a hard landing the root decelerates at roughly 25 m/s^2, which asks for
   * 0.55 rad and clamps to 0.5, so the antenna whips to nearly 30 degrees and
   * rings for about 1.4 s. That costs four floats.
   */
  inertia: 0.022,
  clamp: 0.5,
  /** How much of the base's deflection the tip trails by. */
  tipTrail: 0.45,
  /** Impulse into the base on jump and land, rad/s at full event strength. */
  eventImpulse: 3.5,
  landImpulse: 4.5,
  /** The `antennaFlick` fidget. */
  flickImpulse: 6,
} as const

/** Ear pods, which counter-swing against the body roll. */
export const EAR_POD = {
  /** Fraction of the hip roll they oppose. */
  counterRoll: 0.3,
  landImpulse: 5,
} as const

/**
 * The four-segment cape chain.
 *
 * ## The fold, and the arithmetic that found it
 *
 * `robotPose.ts` used to compute `targetX = hang - localVelZ * drag + inherit`,
 * and the minus sign was backwards. The forward axis at `rotation.y = 0` is +Z -
 * `headingVector` returns `(sin f, cos f)`, the art bible's section 6 states it,
 * and `05-character-vfx.md` line 108 states it again - and a positive `rx`
 * carries a downward-hanging segment toward -Z, which is BEHIND. So subtracting
 * a forward velocity swung the cape FORWARD, into the character's own legs.
 *
 * At `MOVEMENT.maxSpeed` of 6.0 the old chain settled at local angles
 * -0.230 / -0.311 / -0.339 / -0.349 rad, a total sweep of **-1.228 rad, 70.3
 * degrees in front of straight down**. Integrating that as a polyline of four
 * 0.18 links puts the hem at chest-local (0, -0.505, +0.442), which after the
 * socket's own offset is world (0, 0.295, +0.057): directly above the feet and
 * in front of the body's centreline. The cape was not brushing the legs, it was
 * hanging through the diaper and out the front.
 *
 * Three independent things say this was a bug rather than a choice. The roll term
 * on the very next line uses the OPPOSITE convention and is correct, because a
 * rotation about Z carries the same segment toward +X while a rotation about X
 * carries it toward -Z - both are "trail behind the motion" and the signs
 * therefore differ. The doc comment above the loop describes the intended first
 * segment as **positive** 0.33. And the design spec ships the same defect twice
 * over: its pseudocode comments its own `gravityTarget` as "expressed as a
 * positive rx" and then writes `dragTarget = -localVel.z * CAPE.drag` under the
 * comment "blows back when moving forward", which cannot both be true.
 *
 * ## Why a bare sign flip is not the fix
 *
 * Flipping the sign and changing nothing else gives 0.430 / 0.581 / 0.633 / 0.652
 * for a total of **2.296 rad, 131.6 degrees** - past horizontal, over the
 * character's own head. The old `drag` was never sized against a correct sign.
 *
 * Both halves are fixed. `inherit` stops compounding (see below), so the four
 * local angles become equal and the total is `4 * (hang + v * drag)`. Solving for
 * the 0.85 rad the doc comment has always asked for:
 *
 *     4 * (0.10 + 6.0 * drag) = 0.85  ->  drag = 0.01875
 *
 * `0.019` is taken rather than `0.01875`, giving a total of **0.856 rad, 49.0
 * degrees**, which is the "roughly 49 degrees" that has been written down since
 * the spec and never once produced.
 *
 * Steady-state local angles, at rest and at full speed:
 *
 *     rest   0.100 each, accumulating 0.100 / 0.200 / 0.300 / 0.400  (22.9 deg)
 *     6 m/s  0.214 each, accumulating 0.214 / 0.428 / 0.642 / 0.856  (49.0 deg)
 *
 * so the speed-driven travel is 0.456 rad, 26.1 degrees. That is the steady state
 * only: `zeta` is 0.30 to 0.34, so a step of that size overshoots by about a
 * third, and `landImpulse` injects 3 rad/s on top.
 */
export const CAPE = {
  /** Rest droop per segment, so it drapes rather than hanging flat against the back. */
  hang: 0.1,
  /**
   * Drag against the body's own motion, s/m.
   *
   * 0.019 and not the 0.055 that shipped. See the block comment: 0.055 was
   * chosen against a sign that swung the cape forwards, so it had never been
   * sized against the angle it was supposed to produce.
   */
  drag: 0.019,
  /**
   * How much of its parent's ERROR each segment inherits.
   *
   * The distinction is the second half of the fold fix. This used to be
   * `parent.x * inherit` added on top of a full base target, which inherits the
   * parent's deflection TWICE: once for free, because each segment is a child of
   * the one above it and the transform hierarchy already carries the parent's
   * rotation, and once again numerically. The steady state compounded to
   * `base * (1 + k + k^2 + k^3)` per segment and `5.338 * base` in total, which
   * is what made a correct sign overshoot to 131 degrees.
   *
   * It is now `(parent.x - base) * inherit`, the parent's deviation from where it
   * is heading. At steady state that term is exactly zero, so the four local
   * angles are equal and the cape settles into a constant-curvature arc - which
   * is what a cape streaming behind a runner actually is, and what the old
   * compounding form could not produce: increasing local angles down the chain
   * curl it into a scroll.
   *
   * During a transient it is not zero, and that is the whole reason to keep it:
   * each segment is dragged by however far its parent currently is from its own
   * target, so a gust or a landing propagates down the chain as a wave instead of
   * arriving at all four segments at once. The value is unchanged because what it
   * means in a transient is unchanged.
   */
  inherit: 0.35,
  /** Length of one segment, metres. */
  segmentLength: 0.18,
  /**
   * Landing kick, rad/s into each segment's velocity.
   *
   * Negative, and it stays negative now that the drag sign is fixed, which is
   * worth stating because the two now point opposite ways on purpose. Drag pushes
   * the cape back; this pulls it toward flat and past. On impact the body stops
   * and the cape's own downward momentum carries it on down, so it slaps in
   * toward the legs and springs back out. At omega 9.5 that peaks near 0.32 rad
   * of local swing, taking the first segment from 0.100 to about -0.2, so the hem
   * moves 0.14 m forward and stops 0.157 clear of the back of the shin.
   */
  landImpulse: -3,
} as const

/** Idle breathing and the fidget schedule. */
export const IDLE = {
  /** Seconds per breath. 0.455 Hz, which is a resting rate rather than an anxious one. */
  breathPeriod: 2.2,
  /** Below this speed the character counts as standing still. */
  speedThreshold: 0.02,
  /** Seconds on the ground before breathing may start, so a landing is not a breath. */
  groundDelay: 0.35,
  /** Blend in and out times, so breathing never fights the waddle. */
  blendIn: 0.5,
  blendOut: 0.2,
  /** Vertical breathing amplitude. The reference asks for 3-5%. */
  breathScale: 0.035,
  /**
   * Lag on the head and shoulders, radians of the breath cycle.
   *
   * Without it the whole body pulses as one unit, which reads as a lighting
   * flicker rather than as breath.
   */
  breathLag: 0.9,

  /** First fidget after going idle, so a player who stops sees life quickly. */
  firstFidgetMin: 2,
  firstFidgetMax: 4,
  /** Every fidget after that. */
  fidgetMin: 4,
  fidgetMax: 8,
} as const

/** Foot placement from ground rays. */
export const FOOT_IK = {
  maxLift: 0.14,
  maxDrop: 0.1,
  /** The knee bends as the leg shortens, rad/m. */
  kneeGain: 2.2,
  /**
   * Tilt clamp, radians. 17.8 degrees, against a `BODY.maxSlopeClimbAngle` of
   * 50, so on the steepest walkable slope the foot is deliberately not flush.
   * A foot pinned flat to a 50 degree face reads as a magnet; a partial tilt
   * reads as a toy standing on a hill.
   */
  maxTilt: 0.31,
  /** How much the hips come down to meet the lower foot, so the leg does not visibly stretch. */
  pelvisFollow: 0.6,
  /** Ray origin height above the foot's rest position, and how far it looks. */
  castHeight: 0.3,
  castDistance: 0.55,
} as const

/** The contact shadow. See docs/design/05-character-vfx.md section 8. */
export const SHADOW = {
  /** Radius directly under a standing character, in metres. */
  baseRadius: 0.42,
  /** Above this height the shadow is gone entirely. */
  maxHeight: 3,
  /** How far the ray looks before giving up. */
  maxCastDistance: 4,
  /** Opacity at zero height. */
  maxOpacity: 0.55,
  /** How much the radius grows at maxHeight, as a fraction. */
  spread: 0.55,
  /** Falloff exponent on opacity. Above 1 makes the shadow vanish faster than it grows. */
  fadePower: 1.5,
  /** Elongation along the direction of travel at full speed. */
  maxStretch: 1.3,
  /** Ground-normal tilt clamp, radians. */
  maxTilt: 0.61,
  /** Lift along the ground normal, on top of the polygon offset. */
  lift: 0.012,
  /** Landing spike, as a fraction of the base radius and of the max opacity. */
  landRadiusSpike: 0.9,
  landOpacitySpike: 0.5,
} as const

/**
 * Anticipation, and an honest note about it.
 *
 * A game cannot anticipate an action the player has not taken yet without
 * adding input latency, which is never acceptable. So there are three cases and
 * only two of them get real anticipation:
 *
 *   - A BUFFERED jump is known up to `JUMP.bufferTime` in advance, so it gets
 *     the full crouch for free. This is the common case when chaining jumps and
 *     it is where anticipation is most visible.
 *   - Scripted beats (revival, portal entry) are initiated by the game, so they
 *     can anticipate too.
 *   - An UNBUFFERED jump does not, and gets a substitute: the knees compress
 *     and the feet trail below their rest while the root is already rising, so
 *     the body goes up while the legs are still folding. That is what
 *     anticipation looks like from the outside and it costs zero latency.
 *
 * A future reader who finds `frames: 3` here and cannot see it on an ordinary
 * jump will assume it is broken. It is not.
 */
export const ANTICIPATION = {
  frames: 3,
  /** Squash depth during the crouch. */
  crouch: 0.93,
  /** Root drop and arm drop during the crouch, metres. */
  rootDrop: 0.02,
  armDrop: 0.04,
  /** The unbuffered substitute. */
  kneeCompress: -0.32,
  footTrail: 0.03,
} as const

/** The landing pose, as multipliers on the event's strength. See spec section 6. */
export const LANDING = {
  knee: -0.55,
  legSplay: 0.16,
  footPitch: 0.12,
  shoulderPitch: -0.9,
  shoulderRoll: 0.35,
} as const
