/**
 * The two-press confirm gate behind the admin panel's destructive controls.
 *
 * Pure, and deliberately not expressed as component state, for two reasons.
 *
 * It is the only form in which this rule can be tested at all. vitest runs with
 * `environment: 'node'` and the suite has no DOM and no testing library, on the
 * stated principle that only pure logic is unit tested here. A gate that lived
 * as `useState` inside JSX would be verified by nothing.
 *
 * And `window.confirm` is not an option, which is why there is a gate to write
 * in the first place. A native modal dialog blocks the event loop, which stops
 * the render loop, and this project's browser-automation notes call that out as
 * something that wedges the page rather than merely pausing it - the harness
 * drives frames by hand through microtasks, and a blocking dialog starves them
 * with no error anywhere.
 */

/** Which action is waiting for a second press, and when it started waiting. */
export type ConfirmState = {
  /** The id of the action awaiting confirmation, or null when nothing is armed. */
  armed: string | null
  /** `Date.now()` at the moment it was armed. Meaningless when `armed` is null. */
  armedAt: number
}

export const IDLE: ConfirmState = { armed: null, armedAt: 0 }

/**
 * How long an armed control stays armed.
 *
 * An arm that never expires is a trap: the panel gets collapsed with "Confirm"
 * showing, is reopened ten minutes later, and the first press on what now looks
 * like a fresh button wipes the save. Long enough to read the confirm label and
 * decide, short enough that walking away disarms it.
 */
export const CONFIRM_TIMEOUT_MS = 8000

/**
 * How soon after arming a confirmation is allowed to count.
 *
 * This is the whole reason a two-press gate is not automatically safe: a double
 * click is one gesture and delivers two clicks, typically 30-80 ms apart, so
 * without a floor the second half of an accidental double click confirms the
 * first half and the gate protects nothing. 350 ms is well clear of any
 * double-click interval and well under the time it takes to read a new label
 * and aim at it, so a deliberate second press is never the one that gets eaten.
 */
export const CONFIRM_MIN_MS = 350

export type PressResult = {
  /** True when the caller should actually perform the action. */
  fire: boolean
  next: ConfirmState
}

/**
 * What a press on the destructive control `id` should do.
 *
 * Keyed by id rather than a bare boolean so that arming one action can never
 * confirm another: pressing "reset progress" and then a future "wipe cosmetics"
 * re-arms on the second action instead of firing it.
 */
export function press(state: ConfirmState, id: string, now: number): PressResult {
  if (state.armed !== id) return { fire: false, next: { armed: id, armedAt: now } }

  const held = now - state.armedAt

  // Too fast to be a decision. Stay armed rather than re-arming, so the elapsed
  // clock is not restarted by the stray half of a double click.
  if (held < CONFIRM_MIN_MS) return { fire: false, next: state }

  // Expired. Treated as a first press on a stale control rather than as a
  // confirmation, which is the point of the timeout.
  if (held > CONFIRM_TIMEOUT_MS) return { fire: false, next: { armed: id, armedAt: now } }

  return { fire: true, next: IDLE }
}

/**
 * Whether `id` should be rendering its confirm label.
 *
 * Deliberately state-only, with no clock reading. The first version took `now`
 * so that a throttled disarm timer could not leave a stale label on screen, and
 * the React compiler was right to reject it: `Date.now()` during render makes the
 * output depend on when React happened to re-render.
 *
 * So the timeout is enforced in exactly one place, `press`, and it is enforced
 * there against the real clock. The worst a throttled background tab can do is
 * show a confirm label for longer than it should; pressing it re-arms instead of
 * firing. A label that is stale in the safe direction is the right trade for a
 * render that cannot lie about what will happen when it is clicked.
 */
export function isArmed(state: ConfirmState, id: string): boolean {
  return state.armed === id
}
