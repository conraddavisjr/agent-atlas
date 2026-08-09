import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { overriddenQuality } from './fx'
import {
  resolveInitialTier,
  saveTier,
  type QualitySettings,
  type QualityTier,
} from './quality'

/**
 * The tier table for this session, with any `?nogfx` systems forced off.
 *
 * Built once at module scope rather than per render, for two reasons. The URL
 * cannot change without a reload, so there is nothing to react to. And each
 * tier has to keep a stable object identity, because `useQuality` hands it
 * straight out of a zustand selector and a fresh object every call would
 * compare unequal on every render.
 */
const SETTINGS = overriddenQuality()

/**
 * The active quality tier.
 *
 * Its own store rather than a slice of gameStore, which persists player
 * progress under a versioned schema. A rendering preference has nothing to do
 * with progression, and folding it in would mean a graphics setting rides along
 * in the save format forever.
 */
type QualityStore = {
  tier: QualityTier
  setTier: (tier: QualityTier) => void
}

export const useQualityStore = create<QualityStore>()((set) => ({
  tier: resolveInitialTier(),
  setTier: (tier) => {
    saveTier(tier)
    set({ tier })
  },
}))

/** The settings for the active tier. */
export function useQuality(): QualitySettings {
  return useQualityStore((s) => SETTINGS[s.tier])
}

/** The tier itself plus its setter, for the selector in the HUD. */
export function useQualityTier() {
  return useQualityStore(useShallow((s) => ({ tier: s.tier, setTier: s.setTier })))
}
