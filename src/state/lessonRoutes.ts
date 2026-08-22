import type { Lesson } from './types'

/**
 * What pressing E at a totem should do.
 *
 * ## Why this is a pure function in its own file
 *
 * The handler in `App.tsx` is four lines, it has no branches, and every lesson in
 * the game goes through it:
 *
 * ```
 * const id = useGameStore.getState().activeTotemId
 * if (id) completeLesson(id)
 * ```
 *
 * Adding the first lesson with actual content means that handler grows a branch,
 * and a branch there is the single highest-leverage place in this codebase to
 * break something: get it wrong and four working lessons stop completing, in a way
 * that only shows up by walking to each totem in turn.
 *
 * So the decision moves here, where it is a pure function of two arguments and can
 * be swept over every lesson id in a test. `App.tsx` keeps the side effects and
 * loses the judgement. That is the same split `movement.ts` describes for the
 * jump: "rendering can be eyeballed, but does a jump pressed 80ms after leaving a
 * ledge still fire is a question with an exact answer".
 */

/**
 * Lessons that are played rather than declared.
 *
 * A map rather than a field on `Lesson`, because four of the five lessons would
 * carry an empty one and every future lesson would have to decide about a field it
 * does not use. This way a lesson is a mini-game by being listed here, and the
 * absence of an entry is a meaningful default rather than a `null` somebody has to
 * remember to write.
 */
export const MINIGAMES: Record<string, { sceneId: string; spawnId: string; label: string }> = {
  'what-is-ai': { sceneId: 'training-ai', spawnId: 'stage', label: 'AI Training' },
}

export type TotemAction =
  /** Nobody is standing at a totem. */
  | { kind: 'none' }
  /** Play the round. Carries where to go. */
  | { kind: 'travel'; sceneId: string; spawnId: string; label: string }
  /** The old behaviour: mark it done on the spot. */
  | { kind: 'complete'; lessonId: string }

/**
 * Resolve the interact key against whatever totem the player is standing at.
 *
 * `lessons` is passed in rather than imported so the test can sweep a table it
 * controls, and so this cannot quietly start depending on module load order.
 *
 * **A mini-game routes to itself whether or not it is already complete.** That is
 * the replay the user asked for, and it is why completion is not consulted here at
 * all: the round writes its own completion on a win, and re-entering a finished
 * round cannot un-write it because `completeLesson` is idempotent on the id.
 */
export function totemAction(activeTotemId: string | null, lessons: Lesson[]): TotemAction {
  if (!activeTotemId) return { kind: 'none' }

  /*
    An id with no lesson behind it is `none`, not `complete`.

    It should be unreachable - `activeTotemId` is only ever set from a rendered
    totem - but the store persists across reloads and a lesson id removed from
    `LESSONS` in a later release would leave one in a save file. Completing a
    lesson that no longer exists writes a dead id into `completedLessons`, where
    it is invisible and permanent.
  */
  const lesson = lessons.find((l) => l.id === activeTotemId)
  if (!lesson) return { kind: 'none' }

  const game = MINIGAMES[lesson.id]
  if (game) return { kind: 'travel', ...game }

  return { kind: 'complete', lessonId: lesson.id }
}

/** Where a round sends the player when it is over. */
export const RETURN_ROUTE = { sceneId: 'hub', spawnId: 'from-training', label: 'The Foundry' }
