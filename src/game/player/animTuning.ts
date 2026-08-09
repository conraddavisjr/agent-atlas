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
