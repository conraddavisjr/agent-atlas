/**
 * The two horizontal angles the game needs to keep apart, and why keeping them
 * apart is the whole point.
 *
 * Movement is camera-relative, so "back" means "toward the camera". That makes
 * the character's heading exactly half a turn from the camera whenever the
 * player holds back. If the camera then rotates to get behind them, and the
 * input direction is read off that same rotating camera, the input direction
 * turns by exactly as much as the camera did and the error stays at half a turn
 * forever. The camera chases its own tail and never arrives.
 *
 * Splitting the two breaks the loop:
 *
 *   yaw       where the camera actually is.
 *   inputYaw  the frame movement input is resolved against.
 *
 * Manual drag moves both, because aiming the camera should re-aim movement.
 * Auto-realignment moves only `yaw`, so a correction can never feed back into
 * the direction being corrected. That single asymmetry is what makes the camera
 * converge instead of trail.
 *
 * A mutable module singleton rather than React state or context: these are read
 * and written inside the physics step and the render loop, and routing them
 * through React would re-render the scene tree at 60Hz. Same reasoning as
 * irisHandle.ts.
 *
 * Exactly one owner per field, which is what keeps this honest:
 *   yaw, inputYaw   written by FollowCamera
 *   hasMoveInput    written by PlayerController
 */
export const cameraFrame = {
  /** Camera orbit angle, including both manual drag and auto-realignment. */
  yaw: 0,
  /** Orbit angle that movement input is interpreted against. */
  inputYaw: 0,
  /** Whether the player is currently holding a movement direction. */
  hasMoveInput: false,
}

/**
 * Reset both angles to a known value.
 *
 * Called when a scene is entered, so the frame does not carry the previous
 * scene's orientation into the new one's opening shot.
 */
export function resetCameraFrame(yaw = 0) {
  cameraFrame.yaw = yaw
  cameraFrame.inputYaw = yaw
  cameraFrame.hasMoveInput = false
}
