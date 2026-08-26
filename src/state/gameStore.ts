import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { INITIAL_PROGRESS } from './lessons'
import type { AudioPreference, ProgressState } from './types'

/**
 * Persisted schema version.
 *
 * This exists from the first commit on purpose. Once real players have saves,
 * every schema change without a migration path becomes a data-loss decision, and
 * adding versioning retroactively means the first generation of saves has no
 * version to migrate from.
 */
/*
  2 adds `audio`, the first setting this game has had.

  The migration is what this number has existed for since the first commit: a
  save written before the gate existed has no preference, and the merge onto
  `freshProgress()` gives it `'unset'`, which is exactly right - that player has
  not been asked, so they get asked.
*/
const SCHEMA_VERSION = 2
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

/**
 * A fresh, unshared copy of the starting progress.
 *
 * `INITIAL_PROGRESS` is a module constant, so its `completedLessons` array and
 * its `lessonData` object are single instances shared by every reader.
 * `set({ ...INITIAL_PROGRESS })` copies the object but not those two, which
 * means the live store and the module default would be the same array. Nothing
 * mutates them today - `completeLesson` spreads rather than pushes - so this is
 * a latent hazard rather than a live bug, and it is worth closing now precisely
 * because the admin panel turns "reset" from a thing that never happened into a
 * button: one future `state.completedLessons.push(id)` would otherwise poison
 * both the default and every subsequent reset, and `migrate()` below merges onto
 * that same object.
 */
const freshProgress = (): ProgressState => ({
  ...INITIAL_PROGRESS,
  completedLessons: [...INITIAL_PROGRESS.completedLessons],
  lessonData: { ...INITIAL_PROGRESS.lessonData },
})

type GameStore = ProgressState & {
  /** Runtime-only. Deliberately excluded from persistence via partialize below. */
  activeTotemId: string | null
  /**
   * True while a scene has taken the character away from the player.
   *
   * **Renamed from `isTransitioning`, which nothing ever read.** That flag was
   * written by `setTransitioning` and consumed by no one, so it was a slot with a
   * name and no meaning. Keeping the old name for this would have left the app
   * with two unrelated notions of "transitioning" - the iris, which `App` already
   * tracks as `covering`, and this - which is the confusion that ships a bug.
   *
   * `App` folds it into `inputLocked` alongside the iris, so a scripted scene can
   * park the character without reaching into a ref it does not own. It is
   * runtime-only and excluded from persistence: a save file that remembered the
   * player was locked would load them into a game they could not move in.
   */
  playerLocked: boolean

  /**
   * True while a scene is drawing the world from inside the character's head.
   *
   * Separate from `playerLocked`, and it has to be: locked-and-visible is the
   * normal scripted case - the round parks the robot for its whole first half
   * while the player watches it from behind - and hidden-and-unlocked is
   * nonsense. Folding the two would make every locked cutscene invisible.
   *
   * What it guards is small and specific. The training round's quiz is shot from
   * the player's own eye, 0.3 m in front of where their head is; with the model
   * still drawn, the near plane cuts through the skull from the inside and
   * renders as a dark smear across the frame that reads as a broken
   * post-process rather than as a camera in the wrong place.
   *
   * Runtime-only, like `playerLocked` and for the same reason: a save file that
   * remembered the player was invisible would load them into a game with no
   * character in it.
   */
  playerHidden: boolean

  completeLesson: (id: string, evidence?: unknown) => void
  setActiveTotem: (id: string | null) => void
  setPlayerLocked: (value: boolean) => void
  setPlayerHidden: (value: boolean) => void
  travelTo: (sceneId: string, spawnId: string) => void
  setAudio: (audio: AudioPreference) => void

  /**
   * Wipe progression back to the start.
   *
   * Everything the player can see is derived from these four fields rather than
   * cached anywhere - the totems re-bucket their instance batches from the
   * `completed` prop every frame, the Core node's arc geometry is memoised on
   * `[completed, total]`, the water trace writes `uProgress` per frame, the
   * portal's lock plate and its blocking collider are plain conditional JSX, and
   * the cosmetics are recomputed by `earnedCosmetics` - so this one write is
   * enough to undo all of it with no remount and no reload.
   *
   * What it deliberately does NOT do is move the player. It resets
   * `currentSceneId` to the hub, but the mounted scene is owned by
   * `useSceneTravel`, which seeds itself once at mount and has no path from the
   * store back to the world. Calling this from the cave therefore leaves the
   * canvas in the cave while the HUD titles itself from the store, and relocating
   * the player is the caller's job because only the caller holds `travel`. See
   * the reset handler in App.tsx.
   */
  resetProgress: () => void
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      ...freshProgress(),
      activeTotemId: null,
      playerLocked: false,
      playerHidden: false,

      completeLesson: (id, evidence) =>
        set((state) => ({
          completedLessons: state.completedLessons.includes(id)
            ? state.completedLessons
            : [...state.completedLessons, id],
          lessonData:
            evidence === undefined ? state.lessonData : { ...state.lessonData, [id]: evidence },
        })),

      setActiveTotem: (id) => set({ activeTotemId: id }),
      setPlayerLocked: (value) => set({ playerLocked: value }),
      setPlayerHidden: (value) => set({ playerHidden: value }),

      /*
        Arriving somewhere new clears the interact prompt.

        `useProximity` fires `onExit` on a transition out of range, and unmounting
        is not a transition - it just stops running. So a player who walks into a
        portal, or is sent home by the admin reset, while standing at a totem
        carries that totem's id into the next scene, and the HUD goes on offering
        to complete a lesson that is no longer anywhere on screen. Clearing it on
        arrival rather than in `resetProgress` puts the fix where the cause is:
        the scene swap orphans the id, and portal travel orphans it identically.
      */
      travelTo: (sceneId, spawnId) =>
        set({ currentSceneId: sceneId, currentSpawnId: spawnId, activeTotemId: null }),

      setAudio: (audio) => set({ audio }),

      resetProgress: () => set(freshProgress()),
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
        audio: state.audio,
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
          state = { ...freshProgress(), ...state }
        }

        /*
          A save from before the audio gate has no preference, and the defensive
          merge below gives it `'unset'` rather than `'off'`. That is the whole
          decision: a returning player has not declined sound, they were never
          offered it, so they get the card once like everybody else.
        */

        // Defensive merge: a save written by a newer build, or hand-edited local
        // storage, must never leave a required field undefined. Fresh defaults, so
        // a save missing a field does not end up sharing the module constant's
        // array with every future reset.
        return { ...freshProgress(), ...state } as ProgressState
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
      audio: state.audio,
    })),
  )
}
