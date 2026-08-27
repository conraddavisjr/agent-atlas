import type { Cosmetic, Lesson, ProgressState, Zone } from './types'

/**
 * Content is explicitly out of scope for this milestone. These descriptors exist
 * to prove the progression plumbing and to place totems in the world; the blurbs
 * are placeholders for the real course.
 */

/**
 * The default completion rule: the player has explicitly finished the lesson.
 *
 * Every lesson uses this today. When the LLM verification approach is chosen,
 * only the lessons that need it swap to a different predicate.
 */
const completedManually = (id: string) => (state: ProgressState) =>
  state.completedLessons.includes(id)

/**
 * Illustrative alternative predicate, kept here to prove the seam works rather
 * than because anything uses it yet. A lesson could require evidence in
 * lessonData instead of a bare completion flag.
 *
 * @example
 *   isComplete: hasEvidence('first-prompt', (v) => typeof v === 'string' && v.length > 20)
 */
export const hasEvidence =
  (id: string, predicate: (value: unknown) => boolean) => (state: ProgressState) =>
    predicate(state.lessonData[id])

export const ZONES: Zone[] = [
  { id: 'basics', title: 'The Basics', sceneId: 'hub', requires: null },
  { id: 'prompting', title: 'Prompting', sceneId: 'cave', requires: 'basics' },
]

export const LESSONS: Lesson[] = [
  {
    id: 'what-is-ai',
    zoneId: 'basics',
    title: 'What is AI?',
    blurb: 'Start here. The idea behind the machines that seem to think.',
    position: [-4, 0, -3],
    isComplete: completedManually('what-is-ai'),
  },
  {
    id: 'what-is-an-llm',
    zoneId: 'basics',
    title: 'What is an LLM?',
    blurb: 'The kind of AI you will actually talk to.',
    position: [4.5, 0, -2],
    isComplete: completedManually('what-is-an-llm'),
  },
  {
    id: 'popular-models',
    zoneId: 'basics',
    title: 'Meet the Models',
    blurb: 'Claude, ChatGPT, Gemini, and how they differ.',
    position: [0, 0, 5],
    isComplete: completedManually('popular-models'),
  },
  {
    id: 'what-is-a-prompt',
    zoneId: 'basics',
    title: 'What is a Prompt?',
    blurb: 'The one skill everything else is built on.',
    position: [-6, 0, 3],
    isComplete: completedManually('what-is-a-prompt'),
  },
  {
    id: 'first-prompt',
    zoneId: 'prompting',
    title: 'Your First Prompt',
    blurb: 'Write one, send it, see what comes back.',
    position: [0, 0, -4],
    isComplete: completedManually('first-prompt'),
  },
]

export const COSMETICS: Cosmetic[] = [
  { id: 'helmet', socket: 'head', earnedAfterZone: 'basics' },
  { id: 'cape', socket: 'back', earnedAfterZone: 'prompting' },
]

export const INITIAL_PROGRESS: ProgressState = {
  completedLessons: [],
  /* Nobody has been asked yet. See `AudioGate`. */
  audio: 'unset',
  currentSceneId: 'hub',
  currentSpawnId: 'start',
  lessonData: {},
}
