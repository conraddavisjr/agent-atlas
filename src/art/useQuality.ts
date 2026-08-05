import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  QUALITY,
  resolveInitialTier,
  saveTier,
  type QualitySettings,
  type QualityTier,
} from './quality'

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
  return useQualityStore((s) => QUALITY[s.tier])
}

/** The tier itself plus its setter, for the selector in the HUD. */
export function useQualityTier() {
  return useQualityStore(useShallow((s) => ({ tier: s.tier, setTier: s.setTier })))
}
