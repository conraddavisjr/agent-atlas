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
 * clause is the longest of the three - about 9 s with the tail - so there is room
 * for the guess to be deliberate rather than brisk.
 *
 * **It grew from 4.2 when the arrow learned to walk.** The arrow visits seven
 * stops between `FILL_AT` and `CHOOSE_AT`, which needs 2.06 s; the old window was
 * 1.25 s, so it would have arrived at the blank while still three words down the
 * list. `guessCue.test.ts` asserts the walk fits rather than trusting the
 * arithmetic, because an arrow that runs out of runway still produces a perfectly
 * plausible still frame.
 */
export const CYCLE = 6

/** The candidates start arriving. */
export const FILL_AT = 0.4
/** They have all arrived, and one of them is picked. */
export const CHOOSE_AT = 2.6
/** The winner leaves the list. */
export const FLY_AT = 3
/** It is in the blank, and the sentence reads. */
export const LANDED_AT = 4

export type GuessCue = {
  /** 0 to 1. How far the weight bars have grown. */
  filling: number
  /** 0 to 1 and back, over the moment of choosing. Drives the spark. */
  chosen: number
  /** 0 to 1. How far the winning word has travelled to the blank. */
  flight: number
  /**
   * Which candidate the arrow is pointing at, as a rank, or -1 before it starts.
   *
   * A rank rather than a height, so the caller looks the position up from the
   * same `candidateY` the words use and the arrow cannot drift off the row it is
   * indicating.
   */
  pointingAt: number
  /**
   * Which STOP of the walk it is on, as an index into `ARROW_PATH`.
   *
   * Reported alongside the rank because the path doubles back, so a rank does not
   * identify a position on it: `MAJESTY` is rank 0 and appears twice, and asking
   * "what comes after rank 0" has two answers. The first attempt at this used
   * `lastIndexOf` on the rank and silently lost the hesitation - the arrow reached
   * the winner and stayed, which is exactly the single slide the doubling back
   * exists to replace.
   */
  stop: number
  /** How far between this stop and the next, 0 to 1. */
  travel: number
}

/**
 * The order the arrow visits the candidates in.
 *
 * ## It is not simply bottom to top, and the doubling back is the point
 *
 * A pointer that slides once from the least likely word to the most likely
 * describes a ranking, which the list already does by being sorted. What the
 * paragraph claims is harder: that the machine picks *uncannily well* - and
 * picking well means considering, rejecting, and coming back.
 *
 * So the arrow climbs, reaches the winner, drops back to the real rival, and
 * returns. `HIGHNESS` is at a quarter of `MAJESTY`'s weight precisely so there is
 * something to come back to - `dioramaCopy.ts` argues that "a fan whose right
 * answer is the only sensible entry teaches that guessing is easy, which is the
 * opposite of what the paragraph says". The hesitation is that argument in
 * motion.
 *
 * Ranks, from the bottom of the list: SANDWICH is 4 and MAJESTY is 0.
 */
export const ARROW_PATH: readonly number[] = [4, 3, 2, 1, 0, 1, 0]

/** How long the arrow rests on a word before moving on, in seconds. */
export const ARROW_DWELL = 0.2
/** How long it takes to travel between two words. */
export const ARROW_STEP = 0.11

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

  /*
    The arrow walks `ARROW_PATH` between `FILL_AT` and `CHOOSE_AT`, so it arrives
    on the winner exactly as the choice is made and the spark fires. A stop plus a
    step is one beat; the last entry has no step after it, which is what leaves it
    resting on `MAJESTY` rather than sliding off the end.
  */
  const beat = ARROW_DWELL + ARROW_STEP
  const walkFor = Math.max(0, t - FILL_AT)
  const step = Math.min(ARROW_PATH.length - 1, Math.floor(walkFor / beat))
  const within = walkFor - step * beat
  const walking = t >= FILL_AT && step < ARROW_PATH.length - 1

  return {
    filling: clamp01((t - FILL_AT) / (CHOOSE_AT - FILL_AT)),
    chosen: clamp01((t - CHOOSE_AT) / (FLY_AT - CHOOSE_AT)),
    /* Eased, so the word accelerates out of the list and settles into the slot. */
    flight: raw * raw * (3 - 2 * raw),
    pointingAt: t >= FILL_AT ? ARROW_PATH[step] : -1,
    stop: t >= FILL_AT ? step : -1,
    /*
      Zero while it rests, then eased across the gap. Held at zero on the final
      stop so the arrow does not creep past the word it has settled on.
    */
    travel: walking ? ease(clamp01((within - ARROW_DWELL) / ARROW_STEP)) : 0,
  }
}

const ease = (t: number) => t * t * (3 - 2 * t)
