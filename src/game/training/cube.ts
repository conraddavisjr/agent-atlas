import { CUBE_AT, CUBE_DROP_FROM, CUBE_QUIZ_AT, CUBE_SIZE } from './stage'
import { CARD_COUNT, DURATIONS, type TrainingState } from './trainingMachine'

/**
 * The card cube's arithmetic, kept out of the component so it can be checked.
 *
 * The cube is the round's one piece of UI that is a 3D object, and every property
 * of it that could be wrong is a number: which face is toward the camera, how far
 * through a turn it is, and where it is on the way down. None of those are
 * visible in a still frame - a cube stopped 4 degrees short of square looks
 * square - so they are all here and all tested.
 */

/**
 * Which face index a given card is on.
 *
 * Identity, and it is a function rather than a bare use of `card` because the two
 * are conceptually different and only coincidentally equal: `card` counts reading
 * material, `face` counts sides of a solid. They diverge the moment the quiz face
 * exists, which it does - the quiz lives on face `CARD_COUNT`.
 */
export function faceForCard(card: number): number {
  return card
}

/** Total faces the round uses. Two cards, the quiz, and one spare. */
export const FACE_COUNT = 4

/**
 * The cube's Y rotation that brings a face to the FRONT, in radians.
 *
 * ## The `Math.PI` is the whole of it, and leaving it out was a real bug
 *
 * Face `f` sits at local direction `(sin(f*90), 0, cos(f*90))`, so face 0 is on
 * the cube's +Z side. The camera in this round sits at negative Z looking toward
 * positive Z, which means the side it can SEE is the cube's -Z side.
 *
 * Without the half turn, `faceYaw(0)` was 0, the cube sat unrotated, and the face
 * presented to the player was the one at -Z - which with two reading cards is
 * face 2, the quiz. The round opened by showing the player the question before
 * either card that answers it.
 *
 * Solved rather than nudged: after rotating by `theta`, face `f` points along
 * `f*90 + theta`, and it faces the camera when that is 180 degrees. So
 * `theta = 180 - f*90`.
 *
 * The term still DECREASES with `f`, which is what keeps the cube turning in the
 * reading direction - the same instinct that makes a book's pages turn leftward.
 */
export function faceYaw(face: number): number {
  return Math.PI - face * (Math.PI / 2)
}

/** Cubic ease-in-out, matching `irisHandle.ts`'s curve rather than inventing one. */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/**
 * The cube's live Y rotation, given the round's state.
 *
 * During `turning` it eases from the current face to the next; everywhere else it
 * rests square on the face for the current card. Expressed as a single function of
 * state rather than as an animation the component drives, so that a round which is
 * seeked - by the dev hook, or by a future save-and-resume - is never caught
 * mid-turn with no way to finish.
 */
export function cubeYaw(state: TrainingState): number {
  const from = faceYaw(faceForCard(state.card))
  if (state.phase !== 'turning') return from

  const duration = DURATIONS.turning ?? 0.55
  const to = faceYaw(faceForCard(state.card + 1))
  return from + (to - from) * easeInOutCubic(state.elapsed / duration)
}

/**
 * How far the cube has descended, 0 at the drop height and 1 at rest.
 *
 * The cube arrives during `cubeIn` and stays put afterwards. Before that - while
 * the instructor is still on stage - it is held at the top, out of frame, rather
 * than unmounted: the faces carry text whose font resolves asynchronously, and
 * mounting them late would put that fetch in the middle of the beat the cube is
 * supposed to be arriving on.
 */
export function cubeDescent(state: TrainingState): number {
  const order: Record<string, number> = {
    arriving: 0,
    instructorIn: 0,
    speech1: 0,
    speech2: 0,
    instructorOut: 0,
  }
  if (state.phase in order) return 0
  if (state.phase !== 'cubeIn') return 1
  return easeInOutCubic(state.elapsed / (DURATIONS.cubeIn ?? 1))
}

/**
 * How far the cube has moved from its reading pose to its quiz pose, 0 to 1.
 *
 * The move happens during `arming` - the same window the planks stagger in on -
 * so the cube withdrawing and the answers arriving are one gesture rather than
 * two. Everything from `aiming` onward is fully risen, and `turning` is still
 * fully down, which means the quarter turn that brings the quiz face round
 * finishes before the cube starts to climb. Turning and rising at once reads as
 * the cube being knocked upward.
 */
export function cubeRise(state: TrainingState): number {
  const quiz: Record<string, true> = {
    aiming: true,
    rejecting: true,
    accepting: true,
    celebrating: true,
  }
  if (state.phase in quiz) return 1
  if (state.phase !== 'arming') return 0
  return easeInOutCubic(state.elapsed / (DURATIONS.arming ?? 2.2))
}

/**
 * The cube's world position, given how far it has descended and how far it has
 * risen into the quiz pose.
 *
 * `rise` defaults to 0 so the descent can still be reasoned about on its own -
 * the two motions are independent and never overlap, because `cubeRise` is zero
 * for every phase in which `cubeDescent` is not already 1.
 */
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
 * How far a face's text sits from the cube's centre.
 *
 * A hair proud of the surface. Text drawn exactly ON a face z-fights with it, and
 * the failure is not subtle: the glyphs flicker between drawn and not as the cube
 * turns, which reads as a rendering fault rather than as a near miss.
 */
export const FACE_INSET = CUBE_SIZE / 2 + 0.012

/** Where each face's content sits, and how it is turned, in cube-local space. */
export function facePlacement(face: number): {
  position: [number, number, number]
  rotation: [number, number, number]
} {
  const yaw = (face * Math.PI) / 2
  return {
    position: [Math.sin(yaw) * FACE_INSET, 0, Math.cos(yaw) * FACE_INSET],
    rotation: [0, yaw, 0],
  }
}

/** Which face carries the quiz. The one after the last reading card. */
export const QUIZ_FACE = CARD_COUNT
