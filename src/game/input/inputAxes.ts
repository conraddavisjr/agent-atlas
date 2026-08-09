/**
 * How the two movement axes are folded, kept pure so it can be tested.
 *
 * This file exists because of a bug that survived precisely because the fold was
 * buried inside a hook's per-frame closure with no way to assert on it.
 *
 * **The two axes are independent, and that is the whole point.**
 *
 * Under camera-relative movement, `moveX` and `moveY` are the two components of
 * one direction vector, and an unclamped diagonal is 41% longer than a cardinal,
 * so the pair has to be normalised onto the unit circle or diagonal movement is
 * faster than straight movement.
 *
 * Under tank controls none of that holds. `moveX` is a *turn rate* and `moveY` is
 * a *throttle*, and they are not components of anything. Normalising them
 * together taxes both: holding forward and right at once yielded 0.707 on each,
 * so the robot drove at 70% of top speed while turning at 70% of turn rate.
 * Pressing a second key made the first key do less, which is not what any tank
 * control scheme has ever done.
 *
 * A gamepad stick is the one case where the old reasoning still applies, because
 * a stick genuinely is a 2D vector whose magnitude carries meaning. So the
 * circular clamp survives, but only there.
 */

/**
 * Folds held keys into turn (`x`) and throttle (`y`) axes.
 *
 * Screen convention, matching the rest of the input layer: forward is negative
 * `y`, left is negative `x`. Each axis is independently in `[-1, 1]`, and holding
 * both keys on an axis cancels to zero rather than favouring either.
 */
export function foldKeyAxes(input: {
  left: boolean
  right: boolean
  forward: boolean
  back: boolean
}): { x: number; y: number } {
  return {
    x: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    y: (input.back ? 1 : 0) - (input.forward ? 1 : 0),
  }
}

/**
 * Clamps a gamepad stick to the unit circle, leaving anything already inside it
 * untouched so partial deflection still means partial input.
 */
export function clampStick(x: number, y: number): { x: number; y: number } {
  const mag = Math.hypot(x, y)
  if (mag <= 1) return { x, y }
  return { x: x / mag, y: y / mag }
}
