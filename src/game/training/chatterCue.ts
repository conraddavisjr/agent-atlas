/**
 * When the feeding machine speaks, and how its words arrive.
 *
 * ## Why this is a pure function and not four lines inside the component
 *
 * The round has already paid once for arithmetic hidden in a `useFrame`:
 * `guessCue.ts` exists because four moments written in seconds were compared
 * against a value in fractions, and the consequence - a winning word that never
 * flew - was invisible in every screenshot, because the frame it produced is a
 * state the form genuinely passes through.
 *
 * This has the same shape. A stagger that is a beat out, or an elastic that never
 * reaches its overshoot, produces a still frame that looks completely correct.
 * So the timing lives here where `chatterCue.test.ts` can walk it.
 */

/** How long the three words take to arrive, one after another. */
export const NOM_STAGGER = 0.2

/**
 * How long one word takes to pop in, in seconds.
 *
 * Short. This is a sound effect rather than a transition: past about a third of a
 * second an elastic stops reading as an impact and starts reading as an object
 * being placed.
 */
export const NOM_POP = 0.26

/** How far past its final size a word overshoots on the way in. */
export const NOM_OVERSHOOT = 0.15

/** How long the whole burst stays on screen once the first word has landed. */
export const NOM_HOLD = 2

/**
 * How often the machine says it, in swallows.
 *
 * Every fourth book rather than every book, and the number is forced rather than
 * chosen. Books arrive about every 0.84 s; a burst is `2 * NOM_STAGGER + NOM_POP`
 * to land all three words plus `NOM_HOLD` on screen, which is 2.66 s. At every
 * third swallow the bursts are 2.52 s apart - shorter than the burst - so a new
 * one starts on top of the old one and the machine never stops talking. Four
 * gives 3.36 s and a real gap for the asides to live in.
 *
 * `chatterCue.test.ts` asserts the inequality rather than the number, so raising
 * the hold fails the test instead of silently re-introducing the overlap.
 */
export const NOM_EVERY = 4

export type ChatterCue = {
  /**
   * Per word: 0 before it arrives, then its scale, settling at 1.
   *
   * A scale rather than a visibility flag, because the elastic IS the joke and a
   * caller that only knew whether to draw the word would have to re-derive it.
   */
  scale: readonly number[]
  /** Which aside is showing, or -1. Never at the same time as a burst. */
  aside: number
}

/**
 * One word's arrival, as a scale: out past its size, then back to it.
 *
 * ## Two explicit phases rather than an easing with a magic constant
 *
 * The obvious way to write this is `easeOutBack`, which is a cubic with a
 * `1.70158` in it. Two problems with that here. Its overshoot is a consequence of
 * the constant rather than something you can ask for - it lands near 10% and
 * getting exactly 15% means solving for a new constant nobody will recognise -
 * and the first attempt at this file did something worse: it added
 * `sin(pi * t) * OVERSHOOT` on top of an eased rise, which peaks at **1.048**
 * because the sine is already falling by the time the rise gets near 1. The
 * elastic was a twentieth of what it was supposed to be, and it looked fine.
 *
 * So: grow to `1 + NOM_OVERSHOOT` over the first `PEAK_AT` of the pop, then
 * settle to 1 over the rest. Both legs are eased, the peak is exactly the number
 * in the constant, and `chatterCue.test.ts` asserts it.
 */
function pop(since: number): number {
  if (since < 0) return 0
  if (since >= NOM_POP) return 1
  const t = since / NOM_POP
  const top = 1 + NOM_OVERSHOOT
  if (t <= PEAK_AT) {
    /* Fast out of the gate: most of the size arrives in the first few frames. */
    const u = t / PEAK_AT
    return top * (1 - (1 - u) * (1 - u))
  }
  const u = (t - PEAK_AT) / (1 - PEAK_AT)
  return top + (1 - top) * (u * u * (3 - 2 * u))
}

/** Where in the pop the word is at its biggest. Early, so the settle reads. */
const PEAK_AT = 0.45

/**
 * What the machine is saying, from the form's own clock.
 *
 * `bitePeriod` is how often a book is swallowed, which the caller knows and this
 * does not - the belt owns that number and duplicating it here is how the mouth
 * ends up chewing between books.
 */
export function chatterCue(local: number, bitePeriod: number, asideCount: number): ChatterCue {
  if (!(bitePeriod > 0)) throw new Error(`chatter: a bite needs a positive period, got ${bitePeriod}`)
  const t = Math.max(0, local)
  const swallow = Math.floor(t / bitePeriod)

  /* The burst runs from the swallow that started it. */
  const burstIndex = Math.floor(swallow / NOM_EVERY) * NOM_EVERY
  const sinceBurst = t - burstIndex * bitePeriod
  const lastLands = (NOM_COUNT - 1) * NOM_STAGGER + NOM_POP
  const speaking = sinceBurst >= 0 && sinceBurst < lastLands + NOM_HOLD

  const scale = Array.from({ length: NOM_COUNT }, (_, i) =>
    speaking ? pop(sinceBurst - i * NOM_STAGGER) : 0,
  )

  /*
    The asides fill the gap between bursts rather than competing with one. Chosen
    by the swallow count rather than at random: a diagram that says something
    different every time you look at it is a diagram nobody trusts, and
    `Math.random` in a frame callback would also make this un-photographable.
  */
  const aside =
    !speaking && asideCount > 0
      ? Math.floor(swallow / NOM_EVERY) % asideCount
      : -1

  return { scale, aside }
}

/** Three, and the count is here so the cue and the copy cannot disagree. */
export const NOM_COUNT = 3

/**
 * Where each `nom` sits, in the form's own units, relative to the first.
 *
 * A rough arc rather than a straight line or an even fan. Speech drawn on a tidy
 * curve reads as a label with a path applied to it; speech that climbs unevenly
 * and tips at the end reads as somebody actually saying it. The third word sits
 * slightly lower than the second on purpose - the arc breaks rather than
 * completing, which is what stops it looking like a decoration.
 */
export const NOM_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.19, 0.14],
  [0.4, 0.09],
]
