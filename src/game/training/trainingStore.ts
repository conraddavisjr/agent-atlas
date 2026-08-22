import { create } from 'zustand'
import type { Phase } from './trainingMachine'

/**
 * The bridge between the round and its DOM chrome.
 *
 * ## Why a store at all
 *
 * `GameContext` is provided INSIDE the Canvas (`App.tsx`), and the round's Next
 * button, progress bar and Escape hint are DOM, outside it - the codebase's stated
 * position is that text in WebGL is expensive, hard to make crisp and invisible to
 * screen readers, and `HUD.tsx` says so in as many words. So the two halves of the
 * round cannot see each other through React, and something has to sit between
 * them. `activeTotemId` already solves the identical problem for the totem prompt,
 * so this is the established shape rather than a new one.
 *
 * Not persisted, and deliberately a separate store from `gameStore` rather than a
 * slice of it: everything here is dead the moment the round ends, and `gameStore`
 * has a `partialize` and a `SCHEMA_VERSION` precisely because what goes in it is
 * meant to outlive the session.
 *
 * ## Sequence numbers rather than booleans, and this is the part worth reading
 *
 * A button press is an EDGE. The obvious encoding is a boolean the producer sets
 * and the consumer clears, and it has a race that shows up exactly when the round
 * is busiest: if the player presses Next twice inside one frame, the second press
 * is lost, and if the consumer clears a flag the producer set later in the same
 * frame, the first one is.
 *
 * A monotonically increasing counter has neither problem. The scene remembers the
 * last value it acted on and compares; a double press advances the counter twice
 * and is handled on two frames rather than one. It is the same reasoning
 * `robotAnim.ts` gives for its event ring's non-wrapping head, and for the same
 * reason: several consumers can each hold their own cursor without coordinating.
 */
export type TrainingStore = {
  /** Mirrored from the machine, written only when it CHANGES. See `publish`. */
  phase: Phase
  /** Which reading card is up, 0-based. */
  card: number
  /** Bumped by the Next button and by Right Arrow. */
  advanceSeq: number
  /** Bumped by Escape and by the exit button. */
  bailSeq: number

  /**
   * Push the machine's phase out to the DOM.
   *
   * Guarded against a no-op write. The scene steps the machine every frame at 60
   * Hz, and zustand notifies on every `set` whether or not anything changed, so an
   * unguarded publish would wake every subscriber sixty times a second to tell
   * them nothing had happened.
   */
  publish: (phase: Phase, card: number) => void
  requestAdvance: () => void
  requestBail: () => void
  /** Back to the start, for a replay. Called when the round mounts. */
  reset: () => void
}

const START = { phase: 'arriving' as Phase, card: 0, advanceSeq: 0, bailSeq: 0 }

export const useTrainingStore = create<TrainingStore>()((set) => ({
  ...START,

  publish: (phase, card) =>
    set((s) => (s.phase === phase && s.card === card ? s : { phase, card })),

  requestAdvance: () => set((s) => ({ advanceSeq: s.advanceSeq + 1 })),
  requestBail: () => set((s) => ({ bailSeq: s.bailSeq + 1 })),

  /*
    The counters reset too, and the scene reads them back on mount rather than
    assuming zero. A replay that started with stale sequence numbers would see the
    previous round's last press as an edge and skip its own first card.
  */
  reset: () => set({ ...START }),
}))
