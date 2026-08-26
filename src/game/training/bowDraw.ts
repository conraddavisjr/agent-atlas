import { DURATIONS, type TrainingState } from './trainingMachine'
import { easeOutCubic } from './quiz'

/**
 * How far the bowstring is pulled, 0 to 1, for a phase.
 *
 * ## One number, four consumers
 *
 * The string, the drawing hand, the nocked arrow and the bow's own limbs all read
 * this. That is the whole reason it exists as a function rather than as four
 * tweens inside `Bow.tsx`: an archer whose hand arrives at the string a frame
 * before the string moves, or whose arrow is nocked while the string is still
 * forward, reads as miming rather than as shooting, and there is no single frame
 * in which that is visible enough to catch by looking.
 *
 * ## It is also the rate limit, and that is not a coincidence
 *
 * The brief asks for the hand to release, the arrow to go, and the archer to
 * reach back for the string about a second later - so roughly one shot a second.
 * That cadence is not enforced with a cooldown timer anywhere. `aiming` is the
 * only phase that accepts a shot, and the only route back to it runs through
 * `firing` and `reloading`, which is exactly the span this function spends at 0.
 * The animation and the rule are the same thing, so the bow cannot be drawn and
 * unshootable, or shootable and slack.
 */
export function drawAmount(state: TrainingState): number {
  if (state.phase === 'arming' || state.phase === 'aiming') return 1

  /*
    RELEASED, and it snaps rather than easing.

    A string that eased forward over the flight would still be travelling when the
    arrow arrived. The whole of the loose happens in the first frames of `firing`,
    which is what makes the shot feel like it left rather than like it was placed.
  */
  if (state.phase === 'firing' || state.phase === 'rejecting') return 0

  if (state.phase === 'reloading') {
    /*
      The reach and the pull. It starts LATE in the phase rather than at the top,
      so there is a beat of empty bow first - the brief describes the release,
      then the arrow going out, and only "after one second" the archer reaching
      for the string again. Nocking instantly would lose the whole gesture.
    */
    const duration = DURATIONS.reloading ?? 0.66
    const t = Math.min(1, Math.max(0, state.elapsed / duration))
    return easeOutCubic(Math.max(0, (t - RELOAD_IDLE) / (1 - RELOAD_IDLE)))
  }

  return 0
}

/** How much of the reload passes before the archer reaches for the string. */
export const RELOAD_IDLE = 0.35

/**
 * How far through its arrival the bow is, 0 to 1.
 *
 * The back half of `arming`, after the planks. The brief's order is planks first,
 * then the bow appears with a spark - so this deliberately does not start until
 * the last plank has finished staggering in.
 */
export function bowArrival(state: TrainingState): number {
  if (state.phase !== 'arming') return 1
  const duration = DURATIONS.arming ?? 2.2
  return easeOutCubic(
    Math.max(0, (state.elapsed - duration * BOW_ARRIVES_AT) / (duration * (1 - BOW_ARRIVES_AT))),
  )
}

/** How much of `arming` passes before the bow starts to appear. */
export const BOW_ARRIVES_AT = 0.55

/** Whether the bow should be on screen at all in this phase. */
export function bowVisible(state: TrainingState): boolean {
  return (
    state.phase === 'arming' ||
    state.phase === 'aiming' ||
    state.phase === 'firing' ||
    state.phase === 'rejecting' ||
    state.phase === 'reloading' ||
    state.phase === 'accepting'
  )
}
