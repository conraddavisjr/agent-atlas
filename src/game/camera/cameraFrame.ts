/**
 * The small amount of camera state the controller and the camera both need.
 *
 * This used to carry a second angle, the frame movement input was resolved
 * against, which existed to stop auto-alignment feeding back into the direction
 * of travel. Under tank controls that loop cannot form: forward means along the
 * robot's own facing, and facing comes straight from input, so the camera has
 * no way to influence where the player is going. The second angle went with it.
 *
 * A mutable module singleton rather than React state, because these are read
 * and written inside the physics step and the render loop, and routing them
 * through React would re-render the scene tree at 60Hz.
 *
 * One owner per field:
 *   yaw        written by FollowCamera
 *   following  written by PlayerController
 */
export const cameraFrame = {
  /** Camera orbit angle, from both manual drag and auto-realignment. */
  yaw: 0,
  /**
   * Whether the player is actively driving, by moving or by turning.
   *
   * The camera realigns only while this is true. Turning counts, which is what
   * lets the camera come round behind a robot rotating on the spot; without
   * that, tank controls leave you staring at the character's side. Standing
   * still does not, so the view stays where it was left after a drag.
   */
  following: false,
}

/**
 * Reset to a known angle.
 *
 * Called when a scene is entered, so the frame does not carry the previous
 * scene's orientation into the new one's opening shot.
 */
export function resetCameraFrame(yaw = 0) {
  cameraFrame.yaw = yaw
  cameraFrame.following = false
}
