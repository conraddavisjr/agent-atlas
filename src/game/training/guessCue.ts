/**
 * The guessing form's clock, as a pure function.
 *
 * ## Why this is not four constants inside the component
 *
 * It was, and they were wrong in a way nothing could see. `loop()` returns a
 * FRACTION of its period, 0 to 1 - the belt uses it to place a book along a belt
 * and the routes use it to place a traveller along a path, and for both of those
 * a fraction is exactly right. The guessing form's four moments were written in
 * SECONDS and compared against it.
 *
 * So `flight` never left zero. The candidates filled, and the winning word sat in
 * the list and never flew into the blank - which is the entire point of the form,
 * and the sentence the paragraph is about never completed. Nothing threw. The
 * still frame looks like a form that is still deciding, which is a state it is
 * genuinely supposed to pass through, so it survived a screenshot review.
 *
 * Pulled out here because the failure is arithmetic, and arithmetic can be
 * asserted: `guessCue.test.ts` walks the whole cycle and checks that every phase
 * is reached, in order, and finishes before the form fades. A browser was never
 * going to be the cheapest way to catch this.
 */

/**
 * How long one guess takes, in seconds.
 *
 * A form holds the stage for as long as the clause said over it, and `GUESSED`'s
 * clause is the longest of the three at about 6.9 s - so the whole argument has
 * to land inside that with time left to read the finished sentence. At 4.2 the
 * word is in the blank at 3.0 s and holds for 1.2 before the loop restarts.
 */
export const CYCLE = 4.2

/** The candidates start arriving. */
export const FILL_AT = 0.35
/** They have all arrived, and one of them is picked. */
export const CHOOSE_AT = 1.6
/** The winner leaves the list. */
export const FLY_AT = 2.0
/** It is in the blank, and the sentence reads. */
export const LANDED_AT = 3.0

export type GuessCue = {
  /** 0 to 1. How far the weight bars have grown. */
  filling: number
  /** 0 to 1 and back, over the moment of choosing. Drives the spark. */
  chosen: number
  /** 0 to 1. How far the winning word has travelled to the blank. */
  flight: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Where in the guess we are, from the form's own clock.
 *
 * `local` is seconds since the form came on stage, and it is taken modulo the
 * cycle here rather than by the caller - which is the other half of the bug this
 * file exists for. A caller that reached for `loop()` got a fraction and compared
 * it against seconds.
 */
export function guessCue(local: number): GuessCue {
  const period = CYCLE
  const t = (((Math.max(0, local) % period) + period) % period)
  const raw = clamp01((t - FLY_AT) / (LANDED_AT - FLY_AT))
  return {
    filling: clamp01((t - FILL_AT) / (CHOOSE_AT - FILL_AT)),
    chosen: clamp01((t - CHOOSE_AT) / (FLY_AT - CHOOSE_AT)),
    /* Eased, so the word accelerates out of the list and settles into the slot. */
    flight: raw * raw * (3 - 2 * raw),
  }
}
