export { createCapeRibbon, skinCapeRibbon, type CapeBend, type CapeRibbon } from '@/game/player/robotGeometry'
export { CAPE } from '@/game/player/animTuning'

/**
 * A one-line re-export, and it is here to make a claim rather than to save typing.
 *
 * The wizard hat's flowing tip is the player's cape. Not "like" it - the same
 * `createCapeRibbon` builder, the same `skinCapeRibbon` per-frame transform, the
 * same four bend angles. `robotGeometry.ts` describes the cape as "a closed ribbon
 * of 24 facets down its length, skinned from the SAME four spring angles", built
 * on the CPU so it keeps its clearcoat and its shadow casting, and every word of
 * that is what a hat tip needs.
 *
 * The alias exists because importing `createCapeRibbon` into a file about a hat
 * reads like a mistake, and the next person to open `Instructor.tsx` should see
 * that the reuse was deliberate before they wonder whether it was. It also marks
 * the boundary: if the hat ever needs a section the cape does not have, this file
 * is where the fork happens, and the diff will say so.
 *
 * Nothing else in `src/game/training` may import from `src/game/player` directly.
 * The round borrows the character's geometry kit; it does not depend on the
 * character's rig.
 */
