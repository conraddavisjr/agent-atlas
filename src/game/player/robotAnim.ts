/**
 * Animation state shared between the character controller and the robot mesh.
 *
 * Kept in its own module rather than alongside the component so that RobotModel
 * exports only components, which is what keeps fast refresh working for it.
 *
 * This is a mutable object rather than props on purpose. The controller writes to
 * it every physics step and the model reads it every frame; routing those values
 * through React would re-render the whole robot sixty times a second for data
 * that only ever drives matrix updates.
 */
export type RobotAnimState = {
  /** Horizontal speed normalised to 0..1 against max speed. */
  speedNorm: number
  /**
   * Turn rate normalised to -1..1, negative left, taken from the input rather
   * than from velocity.
   *
   * This exists because `speedNorm` cannot describe a turn on the spot. It is
   * derived from world velocity, and a robot pivoting in place has none, so
   * under tank controls the entire animation system saw a stationary character
   * and played nothing: the robot rotated with its feet planted, like a turret.
   */
  turnNorm: number
  /**
   * Signed drive input, -1 full reverse to 1 full forward.
   *
   * Separate from `speedNorm`, which is unsigned, so the model can tell reversing
   * from advancing and lean the right way instead of always leaning forward.
   */
  throttle: number
  grounded: boolean
  verticalVelocity: number
  /**
   * The DEPTH of the most recent squash impulse. 1 is neutral, below 1 is
   * squashed, above 1 is stretched.
   *
   * No longer the live value. The controller used to integrate this field back
   * toward neutral in its own frame loop; the spring now lives in the solver,
   * where it can be tested and where it can share one recovery with the eleven
   * other joints a landing moves. So this is the impulse channel: the
   * controller states how deep, in which profile, and the solver owns
   * everything after that.
   */
  squash: number
  /** Which spring profile recovers the impulse. */
  squashMode: SquashMode
  /**
   * Bumped on every impulse.
   *
   * Without it, two landings of identical depth in a row are indistinguishable
   * from one landing still recovering, and the second one would not re-seed the
   * spring. The old code got away with the ambiguity because it zeroed the
   * velocity on the same line it set the depth; making the edge explicit is
   * what lets the solver be a pure function of the state it is handed.
   */
  squashSeq: number
}

/**
 * Which spring recovers a squash.
 *
 * Three rather than one because the beats are genuinely different: a landing
 * should snap, a takeoff stretch should read through the whole rise, and the
 * revival wants the slowest and loosest of the three so the arrival lands as a
 * bounce rather than as a correction.
 */
export type SquashMode = 'land' | 'takeoff' | 'revival'

export function createRobotAnimState(): RobotAnimState {
  return {
    speedNorm: 0,
    turnNorm: 0,
    throttle: 0,
    grounded: true,
    verticalVelocity: 0,
    squash: 1,
    squashMode: 'land',
    squashSeq: 0,
  }
}

/**
 * Fires a squash impulse. The only supported way to write the three fields,
 * because writing `squash` without bumping `squashSeq` is a no-op the type
 * system cannot catch.
 */
export function pushSquash(s: RobotAnimState, depth: number, mode: SquashMode): void {
  s.squash = depth
  s.squashMode = mode
  s.squashSeq++
}
