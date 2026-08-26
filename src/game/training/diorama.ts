import { GLOW } from '@/art/materials'
import {
  HEADLINE_AT,
  HEADLINE_AWAY_Y,
} from './stage'
import { DURATIONS, type TrainingState } from './trainingMachine'

/**
 * What survives of the diorama: the shared helpers its forms still use.
 *
 * ## What left, and where it went
 *
 * The pacing seam - `stationCue`, `DIORAMA_MODE`, `STATION_STAGGER`,
 * `STATION_FADE`, `dioramaRunTime` - is gone to `specimen.ts`. It existed
 * because "three illustrated stations" has two reasonable pacings, sequence and
 * chorus, and which one is better is a question about an audience rather than
 * about code. One specimen has one pacing, so the seam protects nothing and a
 * seam that protects nothing is a place for two files to disagree.
 *
 * `swapDip` and `SWAP_DEPTH` left with it. They sank the whole stage 1.9 m on a
 * card change, "below the plinth, so the swap is not seen", which worked while
 * there was a plinth to sink behind. There is not, and 1.9 m of sink leaves a
 * 2.46 m object fully in frame and apparently standing on the floor. The card
 * change now uses the same fade every other change-over uses.
 *
 * What is left is the arithmetic the forms themselves call: a glow ramp, a lift,
 * a looping ramp, a stepped walk, and a point along a polyline. Those are used
 * identically by one specimen and by three stations, and none of them knows
 * anything about pacing.
 */

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
 * How far the lit key word stands above its two dim neighbours, in metres.
 *
 * ## It is no longer standing in for a fade, and the difference matters
 *
 * This used to carry a note saying that opacity was unavailable on this stage,
 * because troika's `fillOpacity` needs a `sync()` and a fade would therefore be
 * a text re-layout every frame. **That was never measured and it is false** -
 * see `StationLabel.tsx`, which now carries the evidence. Opacity is a uniform
 * write, the specimen fades, and the labels fade with it.
 *
 * The lift survives on its own merits, which are better than the ones it had.
 * All three key words are on screen at once and exactly one of them is the
 * point; a colour change alone says which, and a colour change plus 9 cm of
 * elevation says it at a glance without either being loud. At the reading
 * camera's 7.4 m that is 0.7 degrees, about 14 px on a 900 px window - readable
 * as a difference, too small to read as a jump.
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
 * Where the headline stands, given the round's state, and whether it is drawn.
 *
 * ## Two implementations used to disagree, and only one of them ran
 *
 * This function has always argued that the sign's height must be "a function of
 * what is on stage rather than of what one object is doing" - and then
 * `Headline.tsx` drove the sign from `cubeRise`, which is what one object is
 * doing, and never called this at all. Two answers to one question, one of them
 * dead, disagreeing across six phases. The dead one had the reasoning attached,
 * so the live one went and this is now the only implementation. `Headline.tsx`
 * calls it.
 *
 * ## Three heights became two, and then a disappearance
 *
 * The sign's job is the arrival: a player dropped into a room they did not build
 * gets one glance that says why they are there. From the first reading card
 * onward the HUD's scene card says the same words in DOM, in a band the specimen
 * now needs, so the sign leaves.
 *
 * It leaves on `instructorOut` rather than on `dioramaIn`, and that is the whole
 * of the design: the sign belongs to the introduction, the wizard belongs to the
 * introduction, and they pack up together in one gesture. `dioramaIn` then keeps
 * its own beat for the specimen's arrival instead of doing two things at once.
 *
 * A rise rather than a fade or a fall. A fall reads as a sign coming off its
 * mounting, and nothing in a world of deliberately manufactured objects falls
 * over. A cut is not available either: `cameraDirector` now holds the same
 * camera Z from `speech2` through `reading`, so there is no camera move to hide
 * a disappearance behind - the frame is continuous across the beat and a 12 m
 * sign blinking out of a held shot is a jump cut.
 */
export function headlineLift(state: TrainingState): number {
  switch (state.phase) {
    case 'arriving':
    case 'instructorIn':
    case 'speech1':
    case 'speech2':
      return HEADLINE_AT[1]
    case 'instructorOut': {
      const t = Math.min(1, state.elapsed / (DURATIONS.instructorOut ?? 1.0))
      // Eased, so it accelerates away rather than sliding at a constant rate.
      const eased = t * t * (3 - 2 * t)
      return HEADLINE_AT[1] + (HEADLINE_AWAY_Y - HEADLINE_AT[1]) * eased
    }
    default:
      return HEADLINE_AWAY_Y
  }
}

/**
 * Whether the headline is drawn at all.
 *
 * Bookkeeping rather than staging: by the time this goes false the sign has
 * already left the frame under its own power, so nobody sees it stop being
 * drawn. It exists so that a 12 m board with a runtime-fetched font is not
 * sitting in the scene graph for the whole of the quiz being culled every frame.
 */
export function headlineVisible(state: TrainingState): boolean {
  switch (state.phase) {
    case 'arriving':
    case 'instructorIn':
    case 'speech1':
    case 'speech2':
    case 'instructorOut':
      return true
    default:
      return false
  }
}
