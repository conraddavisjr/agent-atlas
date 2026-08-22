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
 *
 * **Two consumers now, and the hue is deliberately shared between them.**
 * `ContactBlob.tsx` tints the character's blob and `contactDecal.ts` tints every
 * static object base in the world. They must agree, because a hero whose shadow
 * is a different colour from the shadow of the plinth he is standing beside is
 * the single clearest way to make an authored contact read as a decal. What
 * differs between the two is depth, not hue: the blob drives `uOpacity` from the
 * pose solver, and the decal batch carries a per-family peak in
 * `CONTACT_STRENGTH`, both multiplying toward the value below.
 *
 * The hub's `#3d4a6b` linearises to (0.0468, 0.0684, 0.1499) for a linear Rec.709
 * luma of 0.0697, which is the number every strength in `CONTACT_STRENGTH` is
 * solved against. Changing this hex changes all of them, and
 * `contactDecal.test.ts` fails until they are re-derived.
 */
export const CONTACT_TINT: Record<LightingVariant, string> = {
  /** Cool blue against the warm key and the green bounce. */
  hub: '#3d4a6b',
  /** Violet, matching the crystal hue that lights the room. */
  cave: '#2b2450',
  /*
    Steel blue, and darker than either. The training stage is a near-black floor
    lit from above by one cool key, so a contact that carried any warmth at all
    would be the only warm thing in the round - the design system's rule is that
    the world's hue belongs in the light, and this room's light has none.
  */
  digital: '#232c3f',
}

