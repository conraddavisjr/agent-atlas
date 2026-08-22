export {
  createCapeRibbon,
  skinCapeRibbon,
  taperedSuperellipsoid,
  type CapeBend,
  type CapeRibbon,
} from '@/game/player/robotGeometry'
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
 * ## The boundary this marks, stated accurately
 *
 * The rule is about the RIG, not about geometry. The round borrows the
 * character's geometry kit freely - `Bow.tsx` builds its viewmodel out of `Fist`
 * and mounts it by `fistGrip`, and the instructor's head is a
 * `taperedSuperellipsoid` - because those are shapes, and a mini-game that
 * modelled its own robot hand would be modelling a second character.
 *
 * What it must not touch is `robotPose`, `springs` or `rig`. Those carry the
 * hero's animation state, they are the heaviest tested modules in the project,
 * and `springs.test.ts` asserts the `SPRINGS` key set EXACTLY - so a round that
 * reached into them would be one refactor away from breaking the character it is
 * a lesson about.
 *
 * An earlier version of this comment claimed nothing in `src/game/training` may
 * import from `src/game/player` at all. That was never what the code did and it
 * is not what the boundary is for.
 */
