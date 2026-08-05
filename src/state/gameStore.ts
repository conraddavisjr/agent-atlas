import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { INITIAL_PROGRESS } from './lessons'
import type { ProgressState } from './types'

/**
 * Persisted schema version.
 *
 * This exists from the first commit on purpose. Once real players have saves,
 * every schema change without a migration path becomes a data-loss decision, and
 * adding versioning retroactively means the first generation of saves has no
 * version to migrate from.
 */
const SCHEMA_VERSION = 1
const STORAGE_KEY = 'agent-atlas-progress'
/** The key used before the project was renamed to Agent Atlas. */
const LEGACY_STORAGE_KEY = 'ai-academy-progress'

/**
 * Carry saves across the rename.
 *
 * This has to run before `create()`, not inside `migrate()`. zustand looks up
 * STORAGE_KEY, finds nothing, and never calls migrate at all, so a bare rename
 * silently wipes every existing save rather than upgrading it.
 *
 * The old key is left in place. Deleting it would make rolling back to a build
 * from before the rename a data-loss event, and an orphaned key costs nothing.
 */
function adoptLegacySave() {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy !== null) localStorage.setItem(STORAGE_KEY, legacy)
  } catch {
    // Private browsing and blocked-storage modes throw on access. Losing the
    // carry-over is survivable; failing to boot the game is not.
  }
}

adoptLegacySave()

type GameStore = ProgressState & {
  /** Runtime-only. Deliberately excluded from persistence via partialize below. */
  activeTotemId: string | null
  isTransitioning: boolean

  completeLesson: (id: string, evidence?: unknown) => void
  setActiveTotem: (id: string | null) => void
  setTransitioning: (value: boolean) => void
  travelTo: (sceneId: string, spawnId: string) => void
  resetProgress: () => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      ...INITIAL_PROGRESS,
      activeTotemId: null,
      isTransitioning: false,

      completeLesson: (id, evidence) =>
        set((state) => ({
          completedLessons: state.completedLessons.includes(id)
            ? state.completedLessons
            : [...state.completedLessons, id],
          lessonData:
            evidence === undefined ? state.lessonData : { ...state.lessonData, [id]: evidence },
        })),

      setActiveTotem: (id) => set({ activeTotemId: id }),
      setTransitioning: (value) => set({ isTransitioning: value }),

      travelTo: (sceneId, spawnId) => set({ currentSceneId: sceneId, currentSpawnId: spawnId }),

      resetProgress: () => set({ ...INITIAL_PROGRESS }),
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),

      /**
       * Only progress is persisted. Transition and proximity state are per-session,
       * and persisting them would restore the player mid-transition on reload.
       */
      partialize: (state): ProgressState => ({
        completedLessons: state.completedLessons,
        currentSceneId: state.currentSceneId,
        currentSpawnId: state.currentSpawnId,
        lessonData: state.lessonData,
      }),

      /**
       * Migrations run oldest to newest. There is nothing to migrate yet, but the
       * shape is here so the first real change is a two-line addition rather than
       * a decision about whether to wipe existing saves.
       */
      migrate: (persisted, version) => {
        let state = persisted as Partial<ProgressState>

        if (version < 1) {
          // Pre-versioning saves, if any ever existed, get merged onto defaults.
          state = { ...INITIAL_PROGRESS, ...state }
        }

        // Defensive merge: a save written by a newer build, or hand-edited local
        // storage, must never leave a required field undefined.
        return { ...INITIAL_PROGRESS, ...state } as ProgressState
      },
    },
  ),
)

/**
 * Progress as plain data, for the pure functions in progression.ts.
 *
 * Wrapped in useShallow rather than used as a bare selector. zustand v5 calls
 * useSyncExternalStore with no equality function, so a selector that builds a new
 * object every call makes React see an endlessly changing snapshot and throw an
 * infinite-loop error. The shallow comparison is what makes a derived-object
 * selector legal.
 */
export function useProgress(): ProgressState {
  return useGameStore(
    useShallow((state) => ({
      completedLessons: state.completedLessons,
      currentSceneId: state.currentSceneId,
      currentSpawnId: state.currentSpawnId,
      lessonData: state.lessonData,
    })),
  )
}
