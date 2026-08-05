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
  grounded: boolean
  verticalVelocity: number
  /** 1 is neutral, below 1 is squashed, above 1 is stretched. */
  squash: number
}

export function createRobotAnimState(): RobotAnimState {
  return { speedNorm: 0, grounded: true, verticalVelocity: 0, squash: 1 }
}
