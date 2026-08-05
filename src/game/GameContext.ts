import { createContext, useContext, type RefObject } from 'react'
import type { Group } from 'three'

/**
 * Shared handles that scene content needs.
 *
 * Context rather than props because scenes are lazily imported and rendered by
 * the registry with no props of their own. Threading the player ref and travel
 * function through that boundary would mean every scene has to declare and
 * forward them, which is exactly the kind of friction that discourages adding
 * new zones later.
 *
 * Deliberately a .ts file exporting the context object rather than a wrapped
 * Provider component. Re-exporting `Context.Provider` under a capitalised name
 * makes this look like a component module, which breaks fast refresh for every
 * consumer.
 */
export type GameContextValue = {
  /** Follow target tracking the player's interpolated physics transform. */
  player: RefObject<Group | null>
  /** Begin a portal transition. Ignored if one is already in flight. */
  travel: (sceneId: string, spawnId: string, label?: string) => void
}

export const GameContext = createContext<GameContextValue | null>(null)

export function useGame(): GameContextValue {
  const value = useContext(GameContext)
  if (!value) {
    throw new Error('useGame must be used inside a GameContext provider')
  }
  return value
}
