/**
 * The persisted shape. Everything here survives a reload and lives in local
 * storage, which is the entire backend for this game.
 *
 * Keep this deliberately small and serialisable. Anything derivable (which zones
 * are unlocked, which cosmetics are earned) is computed in progression.ts rather
 * than stored, so there is exactly one source of truth and no way for saved data
 * to disagree with the rules.
 */
/**
 * Whether the player wants the instructor to speak.
 *
 * `'unset'` is a real state and not a synonym for `'off'`: it is what raises the
 * gate, and it is the difference between a player who has not been asked and one
 * who said no.
 */
export type AudioPreference = 'on' | 'off' | 'unset'

export type ProgressState = {
  /** Lesson ids the player has finished. */
  completedLessons: string[]
  /**
   * The game's first SETTING, as opposed to progress.
   *
   * `partialize` persists only progress on the stated grounds that "transition
   * and proximity state are per-session, and persisting them would restore the
   * player mid-transition on reload". A preference is neither of those, and it
   * has to survive a reload or the gate asks every single time.
   */
  audio: AudioPreference
  /** Where the player was when they last closed the tab. */
  currentSceneId: string
  currentSpawnId: string
  /** Free-form record for lesson-specific evidence, e.g. a first prompt's length. */
  lessonData: Record<string, unknown>
}

/**
 * A lesson's completion is a predicate over progress rather than a boolean field.
 *
 * This is the seam that makes the deferred LLM decision cheap. Whatever we
 * eventually choose (honor-system, paste the response back, or a bring-your-own-key
 * sandbox) becomes one predicate implementation here, and nothing else in the
 * codebase changes.
 */
export type Lesson = {
  id: string
  zoneId: string
  title: string
  /** One-line summary shown on approach. Content itself is out of scope for now. */
  blurb: string
  /** Where the totem sits in its scene. */
  position: [number, number, number]
  isComplete: (state: ProgressState) => boolean
}

export type Zone = {
  id: string
  title: string
  sceneId: string
  /** Zone that must be finished first. Null means always open. */
  requires: string | null
}

/** Cosmetics mount onto named sockets on the robot as progress is made. */
export type SocketName = 'head' | 'back' | 'hand_l' | 'hand_r'

export type Cosmetic = {
  id: string
  socket: SocketName
  /** Zone that must be complete for this to be worn. */
  earnedAfterZone: string
}
