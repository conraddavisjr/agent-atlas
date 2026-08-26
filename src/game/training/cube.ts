import { CUBE_AT, CUBE_DROP_FROM, CUBE_QUIZ_AT, CUBE_SIZE } from './stage'
import { DURATIONS, type Phase, type TrainingState } from './trainingMachine'

/**
 * The question board's arithmetic, kept out of the component so it can be checked.
 *
 * ## It used to be the whole lesson, and now it asks one question
 *
 * The cube began as the round's teaching surface: four faces, two reading cards
 * and a quiz, turning ninety degrees per advance. The reading moved to the
 * diorama - which acts the paragraphs out rather than printing them - and what
 * the cube was left holding was the question.
 *
 * So it turns no more. `faceForCard`, `faceYaw`, `cubeYaw`, `facePlacement` and
 * `FACE_COUNT` are gone with the beat they served, and what is left is a board
 * that drops in when the reading ends and withdraws when the shooting begins.
 * The "there is more of this, and it is over there" gesture the quarter turn
 * provided moved to the diorama's own change-over, which is the object that now
 * has more to say.
 *
 * Every property left here is a number that could be wrong and that no still
 * frame would show: where it is on the way down, and whether it is clear of the
 * shot. Both are here and both are tested.
 */

/** Cubic ease-in-out, matching `irisHandle.ts`'s curve rather than inventing one. */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/**
 * The phases in which the cube has already arrived and not yet withdrawn.
 *
 * A set rather than a comparison against the phase list's order, because the quiz
 * loop runs `aiming -> firing -> rejecting -> reloading -> aiming` and any rule
 * that assumed list order would have the board arrive again on every miss.
 */
const PRESENT: ReadonlySet<Phase> = new Set<Phase>([
  'question',
  'arming',
  'aiming',
  'firing',
  'rejecting',
  'reloading',
  'accepting',
  'celebrating',
  'exiting',
])

/**
 * How far the cube has descended, 0 at the drop height and 1 at rest.
 *
 * It arrives LATE now - `cubeIn` sits after the reading rather than before it -
 * so every teaching phase returns 0 and the board is simply not in the room while
 * the diorama has the floor. Held at the top rather than unmounted, because the
 * question's text resolves its font asynchronously and mounting it late would put
 * that fetch in the middle of the beat the board is supposed to be arriving on.
 */
export function cubeDescent(state: TrainingState): number {
  if (state.phase === 'cubeIn') {
    return easeInOutCubic(state.elapsed / (DURATIONS.cubeIn ?? 1))
  }
  return PRESENT.has(state.phase) ? 1 : 0
}

/**
 * How far the cube has withdrawn from its question pose, 0 to 1.
 *
 * The board's job ends when the question has been read. It leaves during
 * `arming` - the same window the camera moves to the player's eye, the planks
 * stagger in and the bow arrives - so the whole change of mode is one gesture.
 *
 * ## It has to be GONE before the camera arrives, not merely leaving
 *
 * `WITHDRAW_FRACTION` is what makes that true. The camera travels from five
 * metres behind the player to the player's own eye across the full length of
 * `arming`, and the cube stands at z 3.6 - directly between the two by the end of
 * that trip. A cube still rising when the camera lands is a cube sliding up
 * through the middle of the shot. Finishing in the first 45% puts it out of frame
 * with the camera still most of the way back.
 */
export function cubeRise(state: TrainingState): number {
  const quiz: Record<string, true> = {
    aiming: true,
    firing: true,
    rejecting: true,
    reloading: true,
    accepting: true,
    celebrating: true,
  }
  if (state.phase in quiz) return 1
  if (state.phase !== 'arming') return 0
  const window = (DURATIONS.arming ?? 2.2) * WITHDRAW_FRACTION
  return easeInOutCubic(state.elapsed / window)
}

/** How much of `arming` the cube's exit takes. See `cubeRise`. */
export const WITHDRAW_FRACTION = 0.45

/** The cube's world position for a descent fraction and a withdrawal fraction. */
export function cubePosition(descent: number, rise = 0): [number, number, number] {
  const t = easeInOutCubic(descent)
  const r = easeInOutCubic(rise)
  const rest = [
    CUBE_AT[0] + (CUBE_QUIZ_AT[0] - CUBE_AT[0]) * r,
    CUBE_AT[1] + (CUBE_QUIZ_AT[1] - CUBE_AT[1]) * r,
    CUBE_AT[2] + (CUBE_QUIZ_AT[2] - CUBE_AT[2]) * r,
  ]
  return [
    CUBE_DROP_FROM[0] + (rest[0] - CUBE_DROP_FROM[0]) * t,
    CUBE_DROP_FROM[1] + (rest[1] - CUBE_DROP_FROM[1]) * t,
    CUBE_DROP_FROM[2] + (rest[2] - CUBE_DROP_FROM[2]) * t,
  ]
}

/**
 * How far the question's text sits from the cube's centre, and on which side.
 *
 * A hair proud of the surface. Text drawn exactly ON a face z-fights with it, and
 * the failure is not subtle: the glyphs flicker between drawn and not, which
 * reads as a rendering fault rather than as a near miss.
 *
 * NEGATIVE, because that is the side the camera can see: this stage is authored
 * at positive Z and viewed from negative Z. The same inversion the headline, the
 * cube's old faces, the plank verdicts and the hat's tip each got wrong once
 * before it stopped being a surprise, which is why it is a named constant with
 * its sign in the name rather than a literal at the mount.
 */
export const FACE_INSET = -(CUBE_SIZE / 2 + 0.012)
