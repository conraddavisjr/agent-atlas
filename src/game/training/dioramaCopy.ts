/**
 * Every word the illustrations put on screen.
 *
 * ## Words in a picture are still copy
 *
 * `cards.ts` opens by saying the paragraphs live in a data file because copy is
 * "the part most likely to be edited by somebody who is not editing code, and the
 * part whose defects are invisible to a typechecker". A label on a data stream and
 * a candidate in a word fan are copy by exactly that test, and they carry the same
 * risk the paragraphs did - `93-copy-review.md` cut a sentence from card one that
 * a reader could falsify within a minute of using any assistant.
 *
 * So they are here, they are checkable, and `dioramaCopy.test.ts` holds the
 * properties that would otherwise only be caught by reading the screen: that the
 * word fan has exactly one winner, that its odds are odds, and that no label is
 * longer than the plate it has to sit on.
 *
 * ## What the illustrations are FOR
 *
 * Each station is one clause of the paragraph beside it, made literal. That is
 * the constraint that keeps this honest: an illustration that shows something the
 * text does not claim is a second, unreviewed lesson.
 */

export type Station = {
  /** The one word under the station. Shown large. */
  label: string
  /** A short clause under the label. Shown small. */
  caption: string
}

/** How long a label may be before it stops fitting its plate. */
export const LABEL_LIMIT = 12
/** Same, for the clause under it. */
export const CAPTION_LIMIT = 42

/**
 * Card 0's three stations.
 *
 * They track the paragraph's three sentences in order: what it read, what it can
 * look up, and the one trick underneath. `cards.test.ts` already pins that the
 * paragraph says all three.
 */
/**
 * What is written on the books going into the hopper.
 *
 * These used to be `FED_STREAMS`, riding five glowing traces that have since been
 * deleted - see `Fed.tsx`. They are titles on a conveyor now, which is the same
 * claim drawn with one illustration instead of two.
 *
 * Five, and the number is a composition constraint rather than a taste. Each one
 * needs a length of belt wide enough that its title clears its neighbour's, and
 * the belt's length sets this form's aspect: at six the exhibit came out 2.57
 * wide by 0.72 tall, which fits the frame by being drawn small. Five is what buys
 * back the height.
 *
 * They are deliberately unalike - a science, a formal discipline, a humanity, a
 * craft and a record - because the claim is BREADTH. A list of five neighbouring
 * fields reads as a curriculum; five that have nothing to do with each other
 * reads as "very nearly everything ever written".
 */
export const BOOK_SUBJECTS: readonly string[] = [
  'SCIENCE',
  'MATHEMATICS',
  'PHILOSOPHY',
  'ENGINEERING',
  'HISTORY',
]

export const CARD_0_STATIONS: readonly [Station, Station, Station] = [
  { label: 'FED', caption: 'nearly everything ever written' },
  { label: 'FETCHED', caption: 'at once, or step by step' },
  { label: 'GUESSED', caption: 'what comes next' },
]

/**
 * What the feeding machine says while it eats.
 *
 * ## Why a machine in a lesson about AI is allowed to say "nom nom nom"
 *
 * The round already made one decision of this kind and wrote it down: the
 * instructor is a wizard because "an explanation which admits to being a
 * performance can be blunter than one pretending to be a textbook". This is the
 * same move applied to the illustration. A hopper that eats the written works of
 * humanity is a slightly alarming image if you draw it straight; a hopper that is
 * visibly delighted about it is a joke, and a joke is a much better place to put
 * a beginner than mild unease.
 *
 * It also does real work on the copy. The paragraph's claim is that the machine
 * was fed everything and told what none of it means - the comedy of something
 * enjoying its dinner without understanding it is that sentence, told twice.
 *
 * ## They are timed to the bite, not sprinkled
 *
 * `nom` lands on the swallow and nothing else; the aside appears between books.
 * Speech that fires on a beat reads as caused, where speech that floats reads as
 * decoration - and decoration next to a narrated paragraph is noise.
 */
export const MACHINE_CHATTER = {
  /** On the bite. Short enough to be read in the half second it exists. */
  bite: 'nom nom nom',
  /**
   * Between bites, occasionally. Rotated so the machine does not have one line.
   *
   * All three are the same joke from different angles: something that consumes
   * without comprehending and is thrilled about it.
   */
  asides: ['I love data!', 'more books!', 'delicious!'] as readonly string[],
} as const

/**
 * The prompt the guessing station completes.
 *
 * Two words rather than a sentence, because the point is that a very short run-up
 * is enough. `YOUR ROYAL` is chosen for having one overwhelming continuation and
 * one real rival - see `CANDIDATES`.
 */
export const PROMPT: readonly string[] = ['YOUR', 'ROYAL']

export type Candidate = {
  word: string
  /** Share of the guess, 0 to 1. The set sums to 1. */
  weight: number
}

/**
 * What the machine had to choose between, and how strongly.
 *
 * ## The rival is the whole point of the set
 *
 * A fan whose right answer is the only sensible entry teaches that guessing is
 * easy, which is the opposite of what the paragraph says - and a reader who
 * notices the distractors are nonsense learns to distrust the diagram rather than
 * to trust the machine. `HIGHNESS` is a genuine continuation of `YOUR ROYAL` and
 * takes a quarter of the weight, so the picture shows a real choice being made
 * well rather than a rigged one being made at all.
 *
 * The two absurd entries are there to show the machine is choosing from
 * EVERYTHING, not from a shortlist somebody prepared. They carry almost no weight,
 * which is the honest depiction: they were available and they lost.
 */
export const CANDIDATES: readonly Candidate[] = [
  { word: 'MAJESTY', weight: 0.62 },
  { word: 'HIGHNESS', weight: 0.24 },
  { word: 'FAMILY', weight: 0.08 },
  { word: 'HORSE', weight: 0.04 },
  { word: 'SANDWICH', weight: 0.02 },
]

/** Card 1's three stations: the training loop, and what it leaves behind. */
export const CARD_1_STATIONS: readonly [Station, Station, Station] = [
  { label: 'HIDDEN', caption: 'we covered the next word' },
  { label: 'CORRECTED', caption: 'a trillion times over' },
  { label: 'CONFIDENT', caption: 'which is not the same as right' },
]

/**
 * The sentence card 1 hides the end of.
 *
 * A nursery rhyme on purpose. The station has to show a wrong guess being
 * corrected, and that only lands if the reader already knows the answer - with an
 * unfamiliar sentence the picture shows two arbitrary words and no lesson.
 */
export const HIDDEN_SENTENCE: readonly string[] = ['THE', 'CAT', 'SAT', 'ON', 'THE']
export const HIDDEN_TRUTH = 'MAT'
/** What it offers before it has been corrected enough times. */
export const HIDDEN_GUESS = 'ROOF'

/**
 * The counter on the correction station.
 *
 * Powers of a thousand rather than a smooth climb, because the point is the
 * ORDER of magnitude and a number spinning through six digits reads as a
 * milliseconds display. The last stop is the paragraph's own "a trillion times
 * over".
 */
export const CORRECTION_STOPS: readonly string[] = [
  '1',
  '1,000',
  '1,000,000',
  '1,000,000,000',
  '1,000,000,000,000',
]

/**
 * What the last station says, and why it says so little.
 *
 * ## No falsifiable fact, deliberately
 *
 * The obvious illustration is a famous wrong answer - the letters in a word, a
 * date, an arithmetic slip. Every one of them is a claim about what a machine
 * does TODAY, and `93-copy-review.md` cut a sentence from card one for exactly
 * that: "the only two sentences in the round a reader could personally falsify,
 * and they would - within a minute". Models get fixed; a diagram of a fixed bug
 * teaches distrust of the diagram.
 *
 * So the station shows the SHAPE instead: a confidence meter pinned near the top,
 * a tick, and the tick becoming a cross while the meter does not move. The
 * machine's certainty and the machine's correctness are two different dials, and
 * that is true of every model that will ever exist.
 */
export const CONFIDENCE_READING = '99%'
export const CONFIDENCE_NOTE = 'sure ≠ right'

/**
 * The two cards' station copy, indexed by card.
 *
 * A total mapping rather than two loose constants, because the thing that goes
 * wrong here has already gone wrong once: `TeachingStage` mapped over
 * `CARD_0_STATIONS` unconditionally and never read the card index, so card 1's
 * words as well as its illustration came from card 0. Two exports that a caller
 * has to remember to switch between is how that happens; an array the caller
 * indexes by the card it already has is how it stops.
 *
 * The words are now correct for both cards. **The illustrations are not** - card
 * 1 still shows card 0's three forms - and that gap is deliberate, loud in DEV,
 * and recorded in `TeachingStage.tsx`.
 */
export const CARD_STATIONS: readonly (readonly [Station, Station, Station])[] = [
  CARD_0_STATIONS,
  CARD_1_STATIONS,
]
