import { describe, it, expect, beforeEach, vi } from 'vitest'
import { COSMETICS, INITIAL_PROGRESS, LESSONS, ZONES } from './lessons'
import { earnedCosmetics, isSceneAccessible, zoneProgress } from './progression'
import type { ProgressState } from './types'

/**
 * The store, tested through a stubbed `localStorage`.
 *
 * The suite runs in `environment: 'node'`, where there is no `localStorage` at
 * all - `createJSONStorage` catches the reference error and hands `persist` no
 * storage, which works but silently skips persistence and would leave the most
 * important half of "the reset is complete" unasserted. A save that survives the
 * reset is a reset that undoes itself on the next reload.
 *
 * The stub has to be installed before the module is evaluated, hence the dynamic
 * import: `persist` hydrates once at module scope, which is the same fact that
 * makes writing `localStorage` by hand on a loaded page useless. See the note on
 * `setProgress` in DevHooks.tsx.
 */
function stubStorage() {
  const store = new Map<string, string>()
  const storage = {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return store
}

const STORAGE_KEY = 'agent-atlas-progress'

let saved: Map<string, string>

async function freshStore() {
  saved = stubStorage()
  vi.resetModules()
  const { useGameStore } = await import('./gameStore')
  return useGameStore
}

/** What `persist` has actually written, which is what a reload would restore. */
function persisted(): Partial<ProgressState> {
  const raw = saved.get(STORAGE_KEY)
  expect(raw, 'nothing was persisted at all').toBeTruthy()
  return JSON.parse(raw!).state as Partial<ProgressState>
}

describe('resetProgress', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns every persisted field to its initial value', async () => {
    const useGameStore = await freshStore()

    for (const lesson of LESSONS) useGameStore.getState().completeLesson(lesson.id, 'evidence')
    useGameStore.getState().travelTo('cave', 'entrance')

    const dirty = useGameStore.getState()
    expect(dirty.completedLessons).toHaveLength(LESSONS.length)
    expect(dirty.currentSceneId).toBe('cave')
    expect(Object.keys(dirty.lessonData)).toHaveLength(LESSONS.length)

    useGameStore.getState().resetProgress()

    const after = useGameStore.getState()
    expect(after.completedLessons).toEqual(INITIAL_PROGRESS.completedLessons)
    expect(after.currentSceneId).toBe(INITIAL_PROGRESS.currentSceneId)
    expect(after.currentSpawnId).toBe(INITIAL_PROGRESS.currentSpawnId)
    expect(after.lessonData).toEqual(INITIAL_PROGRESS.lessonData)
  })

  it('clears the save as well as the live state', async () => {
    // Otherwise the reset lasts exactly until the next reload, which is the
    // failure mode that looks like it worked.
    const useGameStore = await freshStore()

    useGameStore.getState().completeLesson('what-is-ai')
    useGameStore.getState().travelTo('cave', 'entrance')
    expect(persisted().completedLessons).toEqual(['what-is-ai'])

    useGameStore.getState().resetProgress()

    expect(persisted().completedLessons).toEqual([])
    expect(persisted().currentSceneId).toBe('hub')
    expect(persisted().lessonData).toEqual({})
  })

  it('does not hand out the module constant, so a reset cannot be poisoned', async () => {
    const useGameStore = await freshStore()

    useGameStore.getState().resetProgress()
    const first = useGameStore.getState().completedLessons
    useGameStore.getState().resetProgress()
    const second = useGameStore.getState().completedLessons

    expect(first).not.toBe(INITIAL_PROGRESS.completedLessons)
    expect(first).not.toBe(second)
    expect(useGameStore.getState().lessonData).not.toBe(INITIAL_PROGRESS.lessonData)
  })

  it('takes the derived world state back with it', async () => {
    // The store write is the only thing the reset does, so what actually has to
    // be true is that everything derived from it reverts: the totems' completion,
    // the portal's lock, the Core node's ring count, and the worn cosmetics.
    const useGameStore = await freshStore()

    for (const lesson of LESSONS) useGameStore.getState().completeLesson(lesson.id)
    const done = useGameStore.getState()
    expect(earnedCosmetics(COSMETICS, LESSONS, done)).toEqual({ head: 'helmet', back: 'cape' })
    expect(isSceneAccessible('cave', ZONES, LESSONS, done)).toBe(true)
    expect(zoneProgress('basics', LESSONS, done)).toEqual({ done: 4, total: 4 })

    useGameStore.getState().resetProgress()

    const clean = useGameStore.getState()
    expect(earnedCosmetics(COSMETICS, LESSONS, clean)).toEqual({})
    expect(isSceneAccessible('cave', ZONES, LESSONS, clean)).toBe(false)
    expect(zoneProgress('basics', LESSONS, clean)).toEqual({ done: 0, total: 4 })
    for (const lesson of LESSONS) expect(lesson.isComplete(clean)).toBe(false)
  })

  it('leaves the runtime-only transition flag alone', async () => {
    // Progress is persisted; whether an iris is closing is not, and clobbering it
    // from a reset would desync the travel machine mid-transition.
    const useGameStore = await freshStore()

    useGameStore.getState().setTransitioning(true)
    useGameStore.getState().resetProgress()

    expect(useGameStore.getState().isTransitioning).toBe(true)
  })
})

describe('travelTo', () => {
  it('clears the interact prompt on arrival', async () => {
    // `useProximity` fires no exit event on unmount, so a totem focused in the
    // scene being left would otherwise keep offering its lesson in the next one.
    const useGameStore = await freshStore()

    useGameStore.getState().setActiveTotem('first-prompt')
    useGameStore.getState().travelTo('hub', 'start')

    expect(useGameStore.getState().activeTotemId).toBe(null)
  })
})
