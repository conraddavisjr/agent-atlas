import type { LightingVariant } from './Lighting'

/**
 * The contact blob's centre tint, per scene.
 *
 * Its own module rather than a second export from `Lighting.tsx`, because a
 * file that exports both components and constants loses fast refresh for every
 * consumer, which is the same reason `GameContext` is a `.ts` file.
 *
 * A contact shadow is a lighting decision - it is the darkest thing the rig
 * produces and it has to agree with what else is reaching that pixel - so the
 * scene's light rig is the right owner. Defaulting it in `ContactBlob` meant
 * the cave got a hub-tinted shadow, which is the same class of error as the sky
 * disagreeing with the key.
 *
 * Both are deliberately chromatic rather than neutral grey. A neutral contact
 * reads as dirt; a cool one reads as shadow. See `01-lighting.md` section 4.
 */
export const CONTACT_TINT: Record<LightingVariant, string> = {
  /** Cool blue against the warm key and the green bounce. */
  hub: '#3d4a6b',
  /** Violet, matching the crystal hue that lights the room. */
  cave: '#2b2450',
}

