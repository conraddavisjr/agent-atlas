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
  /** 1 is neutral, below 1 is squashed, above 1 is stretched. */
  squash: number
}

export function createRobotAnimState(): RobotAnimState {
  return {
    speedNorm: 0,
    turnNorm: 0,
    throttle: 0,
    grounded: true,
    verticalVelocity: 0,
    squash: 1,
  }
}
