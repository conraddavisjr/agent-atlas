import { PLANK_AT, PLANK_PITCH, PLANK_RADIUS, STAGE_FOV } from './stage'
import { DURATIONS, type TrainingState } from './trainingMachine'
import { QUIZ } from './cards'

/**
 * The quiz's geometry and arithmetic: where the planks are, what a shot hit, and
 * how a plank turns to answer.
 *
 * All pure, and all of it the kind of thing that is wrong by a small amount rather
 * than broken: a plank that flips to 179 degrees, a hit that registers on the
 * wrong disc near the boundary, a "40 pixels apart" that turns out to be 40 of
 * something else. None of those throw, and none of them are visible in a still
 * frame.
 */

/**
 * Turn a screen-space gap into a world-space one.
 *
 * The brief asks for planks "spaced apart just about 40 px", and immediately adds
 * "I'm not too sure, in the 3D world, what that means". This is what it means, and
 * having it as a function rather than a baked constant is the point: 40 px is a
 * statement about the VIEWER, so it depends on the camera's distance, its field of
 * view and the viewport's height, and a number derived once by hand goes stale the
 * moment any of those move.
 *
 * The same conversion `REVIVAL.dropHeight` documents for its own brief, which asked
 * for "about 50 pixels" and got an arithmetic answer.
 */
export function screenGapToWorld(
  pixels: number,
  viewportHeight: number,
  distance: number,
  fovDegrees: number = STAGE_FOV,
): number {
  const halfHeight = distance * Math.tan((fovDegrees * Math.PI) / 360)
  return (pixels * 2 * halfHeight) / viewportHeight
}

/** Where the three planks sit, top to bottom, in world space. */
export function plankLayout(): [number, number, number][] {
  return QUIZ.answers.map((_, i) => [
    PLANK_AT[0],
    /*
      Index 0 is the TOP one. The brief lists them "one, two, three, top, middle,
      bottom" and the answers are authored in that order, so the first answer must
      be the highest plank - which means subtracting, not adding.
    */
    PLANK_AT[1] - (i - 1) * PLANK_PITCH,
    PLANK_AT[2],
  ])
}

/**
 * Which plank a world-space point landed on, or null.
 *
 * Takes a POINT rather than doing its own raycast, so the reticle and the shot use
 * one ray. Two systems that each cast their own can disagree by a pixel at the rim,
 * and the player would see the crosshair on a plank and the arrow miss it.
 *
 * A disc test rather than a box: these are coins, and a square hit area on a round
 * target is generous exactly at the corners, which is where a near miss should
 * read as a near miss.
 */
export function resolveHit(
  point: readonly [number, number, number],
  radius: number = PLANK_RADIUS,
): number | null {
  const planks = plankLayout()
  for (let i = 0; i < planks.length; i++) {
    const dx = point[0] - planks[i][0]
    const dy = point[1] - planks[i][1]
    if (Math.hypot(dx, dy) <= radius) return i
  }
  return null
}

/**
 * The planks' staggered arrival, as a per-plank progress from 0 to 1.
 *
 * They come in top to bottom over `arming`, each starting a beat after the last -
 * the brief's "one, two, three". The stagger is a fraction of the phase rather
 * than a fixed delay so that retuning `DURATIONS.arming` cannot push the third
 * plank past the end of its own arrival.
 */
export const PLANK_STAGGER = 0.17

export function plankReveal(state: TrainingState, index: number): number {
  if (state.phase === 'arriving' || state.phase === 'instructorIn') return 0
  if (state.phase === 'speech1' || state.phase === 'speech2') return 0
  if (state.phase === 'instructorOut' || state.phase === 'cubeIn') return 0
  if (state.phase === 'reading' || state.phase === 'turning') return 0
  if (state.phase !== 'arming') return 1

  const duration = DURATIONS.arming ?? 2.2
  // Each plank gets the whole window minus everyone else's stagger, so the last
  // one still has a full-length arrival rather than a rushed one.
  const span = duration * (1 - PLANK_STAGGER * (QUIZ.answers.length - 1))
  const start = duration * PLANK_STAGGER * index
  return Math.min(1, Math.max(0, (state.elapsed - start) / span))
}

/**
 * How far a plank has turned, in radians, given the round's state.
 *
 * A plank shows its ANSWER at 0 and its verdict - star or no-sign - at PI. A wrong
 * one goes out and comes back; a right one goes out and stays.
 *
 * The return trip is the part worth being careful about. It has to land exactly on
 * 0, because a plank left a few hundredths off square shows a sliver of its back
 * face for the rest of the round, and every subsequent miss compounds it.
 */
export function plankSpin(state: TrainingState, index: number): number {
  if (state.lastHit !== index) return 0

  if (state.phase === 'rejecting') {
    const duration = DURATIONS.rejecting ?? 1.1
    const t = Math.min(1, Math.max(0, state.elapsed / duration))
    /*
      Out and back on one curve: `sin(t * PI)` is 0 at both ends and 1 in the
      middle, so the plank reaches a half turn at the midpoint and returns to
      EXACTLY zero at the end. Two separate tweens with a hold between them would
      need three timings to agree, and the failure mode is the plank never quite
      coming home.
    */
    return Math.sin(t * Math.PI) * Math.PI
  }

  if (state.phase === 'accepting') {
    const duration = DURATIONS.accepting ?? 0.9
    const t = Math.min(1, Math.max(0, state.elapsed / duration))
    return easeOutCubic(t) * Math.PI
  }

  // Won and still on screen: stay showing the star.
  if (state.phase === 'celebrating' || state.phase === 'exiting') {
    return state.won ? Math.PI : 0
  }

  return 0
}

/** Decelerating ease. The verdict lands rather than arriving at speed. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

/**
 * Where the answer label sits above its plank.
 *
 * Above rather than on, because the plank turns over: a label painted on the face
 * would rotate away with it, and the player would lose the text of the answer at
 * the exact moment they are being told whether it was right.
 */
export const LABEL_LIFT = PLANK_RADIUS + 0.14

/**
 * The answer label's type size and how tall it can get, in metres.
 *
 * Here rather than in `Planks.tsx` because the LAYOUT depends on it: the label
 * hangs in the gap between its own plank and the one above, so how tall it is
 * decides whether the column's pitch is wide enough. Left in the component,
 * that number would have been invisible to the test that checks the clearance -
 * which would have been a test comparing two constants and ignoring the thing
 * that actually collides.
 *
 * Two lines is the worst case at this width; the longest answer wraps to two and
 * `cards.test.ts` caps the length so a third cannot appear.
 */
export const LABEL_FONT_SIZE = 0.085
export const LABEL_LINE_HEIGHT = 1.15
export const LABEL_MAX_LINES = 2
/** Half the tallest a label gets. `anchorY` is middle, so it grows both ways. */
export const LABEL_HALF_HEIGHT = (LABEL_FONT_SIZE * LABEL_LINE_HEIGHT * LABEL_MAX_LINES) / 2

/**
 * Where the win burst fires from.
 *
 * The WINNING plank, not the column's anchor. Those are the same point today
 * because the correct answer happens to be the middle one, and that coincidence
 * is the hazard: reordering `QUIZ.answers` would move the star and leave the
 * confetti behind, with nothing failing to say so. Pinned as a function of
 * `QUIZ.correct` and tested against it.
 *
 * A little toward the camera - the planks are at +Z and the camera at -Z - so the
 * pieces spray out of the face of the plank rather than out of its back.
 */
export function burstOrigin(): [number, number, number] {
  const [x, y, z] = plankLayout()[QUIZ.correct]
  return [x, y, z - 0.4]
}
