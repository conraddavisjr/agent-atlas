import { GLOW } from '@/art/materials'
import {
  DIORAMA_AT,
  HEADLINE_AT,
  HEADLINE_QUIZ_Y,
  STATION_HEIGHT,
  STATION_PITCH,
  stationX,
} from './stage'
import { DURATIONS, type TrainingState } from './trainingMachine'

/**
 * The diorama's arithmetic: when each station lights, and on what clock it runs.
 *
 * ## The one seam this file exists to protect
 *
 * There are two reasonable ways to pace three illustrated stations. They can play
 * in SEQUENCE, lighting one after another so the stage reads like a sentence
 * being spoken; or they can play in CHORUS, all three animating for the whole
 * card so the player looks wherever they like. Which is better is a question
 * about an audience, not about code, and it is exactly the kind of question that
 * gets answered after somebody has watched it.
 *
 * So the choice lives in ONE function body. `stationCue` is the only thing in the
 * project that knows about the sequence at all: every station component reads a
 * `lit` and a `local` and knows nothing else. Switching modes is editing
 * `DIORAMA_MODE` - no component is touched, no phase is added, and
 * `diorama.test.ts` holds the properties that must be true of both.
 *
 * ## Why the components get a clock rather than a phase
 *
 * A station handed "you are station 2 and we are 4.1 seconds into the card" would
 * have to know the stagger to work out its own progress, and three copies of that
 * arithmetic is three chances to disagree with the fourth in this file. Handed a
 * local clock that starts at zero when it lights, a station animates from t=0 and
 * is correct under either mode, at any stagger, forever.
 */

/** How many stations a card's diorama has. Three, which is the shape of both cards. */
export const STATION_COUNT = 3

/**
 * Which pacing ships.
 *
 * `'sequence'` today. Flip this one token for chorus - see the header, and see
 * `stationCue`, which is the only reader.
 */
export const DIORAMA_MODE: 'sequence' | 'chorus' = 'sequence'

/**
 * How long after the card opens each station lights, in seconds.
 *
 * 2.6 puts the third at 5.2 and fully lit by 5.75, which is inside the time it
 * takes to read the paragraph the diorama is illustrating - the two should land
 * together rather than the picture waiting on the words or the reverse.
 */
export const STATION_STAGGER = 2.6

/** How long a station takes to come up, in seconds. */
export const STATION_FADE = 0.55

/**
 * How dim an unlit station is, as a fraction of a lit one.
 *
 * Not zero. A station that goes fully dark reads as missing rather than as
 * waiting, and the player then discovers a third of the stage arriving late as a
 * surprise instead of as an order. A quarter-lit station is clearly present and
 * clearly not yet the point.
 */
export const DIM_FLOOR = 0.28

export type StationCue = {
  /** 0 dim, 1 lit. Components map this through `stationGlow` and `stationLift`. */
  lit: number
  /** Seconds since this station lit, and 0 before. Its animation's own clock. */
  local: number
}

/**
 * When a station is lit and how far into its own animation it is.
 *
 * `local` is clamped at zero rather than running negative, so a station that has
 * not lit yet sits on the first frame of its loop rather than somewhere in the
 * middle of it. The alternative - letting every station share the card's clock -
 * means the third one lights half way through its own gesture, which reads as
 * having missed something.
 */
export function stationCue(index: number, elapsed: number): StationCue {
  if (DIORAMA_MODE === 'chorus') return { lit: 1, local: Math.max(0, elapsed) }

  const start = index * STATION_STAGGER
  const since = elapsed - start
  if (since <= 0) return { lit: 0, local: 0 }
  return { lit: Math.min(1, since / STATION_FADE), local: since }
}

/** When the last station has finished coming up, in seconds. The card's own beat. */
export function dioramaRunTime(): number {
  if (DIORAMA_MODE === 'chorus') return STATION_FADE
  return (STATION_COUNT - 1) * STATION_STAGGER + STATION_FADE
}

/**
 * A station's emissive strength, from its cue.
 *
 * Between `GLOW.hold` and `GLOW.source` - a colour hold when it is waiting and a
 * light source when it is the point. Tier A is not on this ladder and cannot be:
 * `00-art-bible.md` reserves bloom for ally blue and reward gold, "nothing in the
 * environment is allowed in", and a diorama is environment however much it would
 * like to be feedback.
 */
export function stationGlow(lit: number): number {
  const t = Math.min(1, Math.max(0, lit))
  return GLOW.hold + (GLOW.source - GLOW.hold) * t
}

/**
 * How far a station rises when it lights, in metres.
 *
 * The lift is doing a job that opacity would normally do, and it is doing it
 * because opacity cannot. `Headline.tsx` records why: troika's `fillOpacity`
 * needs a `sync()` to take effect, so fading a label is a text re-sync every
 * frame for the length of the fade, where "moving a `<group>` is a matrix write".
 * The same argument applies to every label on this stage, so nothing here fades -
 * it rises and it brightens.
 */
export function stationLift(lit: number): number {
  return Math.min(1, Math.max(0, lit)) * STATION_RISE
}

/** How far a lit station stands above its resting height. */
export const STATION_RISE = 0.09

/**
 * A looping 0-to-1 ramp, for anything that repeats while its station is lit.
 *
 * `offset` staggers members of a set - the books on a belt, the dots on a stream -
 * so that one call with an index gives a queue rather than a pulse. Fractional
 * rather than modular arithmetic on purpose: `%` on a negative left operand
 * returns a negative in JavaScript, and a book at -0.3 along a belt is a book
 * behind the camera.
 */
export function loop(local: number, period: number, offset = 0): number {
  if (!(period > 0)) throw new Error(`diorama: a loop needs a positive period, got ${period}`)
  const t = local / period + offset
  return t - Math.floor(t)
}

/** Where a station stands, in world space. */
export function stationAt(index: number): [number, number, number] {
  return [stationX(index), DIORAMA_AT[1], DIORAMA_AT[2]]
}

/**
 * How large a station's contents are drawn, relative to how they are authored.
 *
 * ## Authored at a metre, shown at three quarters
 *
 * Each station is modelled at roughly its own slot's width, which is the natural
 * way to build one and the wrong way to show three. Side by side at full size
 * they touch, and touching is worse than crowded: the belt of station one runs
 * into the shelf of station two and the eye reads a single cluttered machine shop
 * instead of three separate claims.
 *
 * A scale rather than smaller authoring, because the numbers inside a station are
 * about each other - a belt against a hopper, a bar against its neighbour - and
 * re-deriving all of them against a gutter would be doing the same arithmetic
 * twice. `diorama.test.ts` checks the product against the box.
 */
export const STATION_SCALE = 0.74

/**
 * The box a station's readable content has to stay inside.
 *
 * Half-extents about the station's own centre. The width is half the pitch minus
 * a gutter, so two neighbours cannot touch; the height is the stage's own.
 */
export const STATION_BOX = {
  halfWidth: STATION_PITCH / 2 - 0.12,
  halfHeight: STATION_HEIGHT / 2,
} as const

/**
 * How far the stage sinks during a change-over, in metres.
 *
 * Down and back up across the beat, so it meets both ends at exactly zero -
 * `sin(t * PI)` is the same out-and-back curve `plankSpin` uses for a plank that
 * has to come home square, and for the same reason: a stage left a few
 * centimetres low sits wrong for the rest of the round and every subsequent swap
 * compounds it.
 */
export function swapDip(elapsed: number, duration = 0.7): number {
  const t = Math.min(1, Math.max(0, elapsed / duration))
  return Math.sin(t * Math.PI) * SWAP_DEPTH
}

/** How deep the change-over goes. Below the plinth, so the swap is not seen. */
export const SWAP_DEPTH = 1.9

/**
 * A stepped walk along a path: move, stop, move, stop.
 *
 * Returns 0-to-1 along the whole path for a 0-to-1 input, but spends
 * `DWELL_FRACTION` of each leg standing still at the waypoint it just reached.
 *
 * That pause is the entire difference between "working step by step" and "going
 * slowly", and a viewer reads it instantly without being told - which is why the
 * fetching station spends no words on either of its two routes.
 */
export function steppedAlong(t: number, legs: number): number {
  if (!(legs >= 1)) throw new Error(`diorama: a stepped walk needs at least one leg, got ${legs}`)
  const perLeg = 1 / legs
  const leg = Math.min(legs - 1, Math.floor(Math.min(1, Math.max(0, t)) / perLeg))
  const within = (Math.min(1, Math.max(0, t)) - leg * perLeg) / perLeg
  const moving = Math.min(1, within / (1 - DWELL_FRACTION))
  return (leg + moving) / legs
}

/** How much of each leg is spent stopped at the waypoint. */
export const DWELL_FRACTION = 0.45

/**
 * A point along a polyline, by segment.
 *
 * Piecewise linear rather than a spline, and the stations depend on that: their
 * paths are short arcs already shaped by their own middle control points, and a
 * Catmull-Rom through three points would overshoot the end - which on the feeding
 * station means a dot arriving inside the machine and coming back out.
 */
export function pointAlong(
  path: readonly (readonly [number, number, number])[],
  t: number,
): [number, number, number] {
  const span = 1 / (path.length - 1)
  const clamped = Math.min(1, Math.max(0, t))
  const index = Math.min(path.length - 2, Math.floor(clamped / span))
  const local = (clamped - index * span) / span
  const a = path[index]
  const b = path[index + 1]
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local]
}

/**
 * Where the headline stands, given the round's state.
 *
 * ## It has three heights now, and it used to have two
 *
 * The sign was tied to the cube's withdrawal: low while the cube did the reading,
 * high once the cube left for the quiz. The cube stopped doing the reading, so
 * that rule left it low for the whole of the teaching - and at the diorama's own
 * camera the words run straight through the stations, which is the same collision
 * the plank labels had before the quiz pose was re-derived.
 *
 * So it is a function of what is on stage rather than of what one object is
 * doing: down for the arrival, when it is the point of the frame; up for the
 * teaching and the question and the shooting, when something else is.
 */
export function headlineLift(state: TrainingState): number {
  if (state.phase === 'arriving' || state.phase === 'instructorIn') return HEADLINE_AT[1]
  if (state.phase === 'speech1' || state.phase === 'speech2' || state.phase === 'instructorOut') {
    return HEADLINE_AT[1]
  }
  // `dioramaIn` eases it up on the same beat the stage arrives, so the sign
  // clears rather than jumps.
  if (state.phase === 'dioramaIn') {
    const t = Math.min(1, state.elapsed / (DURATIONS.dioramaIn ?? 1.1))
    return HEADLINE_AT[1] + (HEADLINE_QUIZ_Y - HEADLINE_AT[1]) * t
  }
  return HEADLINE_QUIZ_Y
}

/** Whether the diorama is on stage at all, for a phase. */
export function dioramaVisible(state: TrainingState): boolean {
  return (
    state.phase === 'dioramaIn' || state.phase === 'reading' || state.phase === 'swapping'
  )
}
