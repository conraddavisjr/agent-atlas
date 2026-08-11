import type { ThreeElements } from '@react-three/fiber'
import { BLOOM_THRESHOLD, GLOW, crystal } from './materials'
import { displayLuma, palette } from './palette'

type MeshPhysicalMaterialProps = ThreeElements['meshPhysicalMaterial']

/**
 * The token crystal groves, turned from bright pink plastic into pale glass.
 *
 * ## What was wrong, in numbers
 *
 * The groves shipped as `crystal(palette.token, 0.34)`: `#ff6bd6`, an
 * `emissiveIntensity` of 1.346, opacity 0.92, clearcoat 0.85. Measured on real
 * frames they span **display 0.692 to 0.748 with the red channel clipped at
 * 255**, against decks at 0.612 to 0.698 and a lawn at 0.478 to 0.592.
 *
 * Which means decoration was the brightest thing on the island and it
 * out-chromaed the hero. That is item 5 of `99-handoff.md` and it has survived
 * three critique rounds, and it is what the user was describing: "I don't like
 * the bright pink triangles. They feel out of place."
 *
 * Two independent mechanisms put it there and both are fixed here.
 *
 * **The emissive.** `emissiveIntensityFor('#ff6bd6', 0.34)` is 1.346, and
 * `#ff6bd6` has a linear red of exactly 1.0, so the emissive term alone puts
 * 1.346 of linear red on the surface before a single light is counted. Nothing
 * downstream can recover a channel that has already left the range. The grove's
 * own comment in `HubIsland.tsx` records this being wound back from `GLOW.source`
 * to 0.34 once already, for exactly this reason, and 0.34 was still too much.
 *
 * **The chroma.** `#ff6bd6` has a channel spread of 0.580 - the widest in the
 * palette - so it reads as the most saturated object in frame regardless of its
 * value. The hero shell is `#f4f1ea`, a spread of 0.039. Decoration was carrying
 * fifteen times the chroma of the character.
 *
 * ## What replaces it, and what the brief got wrong about it
 *
 * The brief offered three levers - albedo, emissive down to `GLOW.hold`, and
 * `gel()`'s transmission - and asked which were worth it. The answer is: albedo
 * and opacity are worth it, and **the other two are refused.**
 *
 * **Transmission is refused, and the specs already said so about this exact
 * object.** `02-materials.md` line 157 reads: "`gel()` keeps `transmission` but
 * is restricted to hero glass only, and stops being used for the token crystals
 * and the lesson totem's concept node." The art bible's section 6 says the same
 * thing more briefly. So the invitation to price it is really an invitation to
 * reverse a decision the materials spec made about the token crystals by name.
 *
 * The price, since it was asked for and since it is worse than the specs said.
 * `transmission > 0` on any visible material makes `WebGLRenderer` call
 * `renderTransmissionPass` once per camera per frame, which re-renders the
 * background and **every opaque object in the scene** into a separate target.
 * At three 0.185.1 that target is created with `generateMipmaps: true` and
 * `samples: Math.max(4, capabilities.samples)`, and `transmissionResolutionScale`
 * defaults to 1.0 - so it is a full-resolution extra opaque scene render, forced
 * to at least 4x MSAA whether or not the main target is, plus an MSAA resolve,
 * plus a full mip chain, every frame. The opaque set on this island includes the
 * grass field, which is 1.43M triangles and is the most expensive thing in the
 * scene. For scale: the AO pass, which is a single screen-space pass over depth,
 * was measured at roughly half the frame rate at high and was removed at all
 * three tiers. An extra scene render is in the same cost class or worse.
 *
 * And the visual gain here is smaller than a pixel. Transmission buys refraction
 * of the backdrop, and refraction is only legible when the object is thick enough
 * to bend a recognisable feature. These shards are 0.045 to 0.09 m across, seen
 * from 10.7 m at FOV 40; `gel()`'s `thickness` of 0.5 is six times the widest
 * shard, so the ray offset it computes is mostly outside the object. We would be
 * paying a full scene render to displace the background by under a pixel.
 * `quality.transmission` should stay unread, and the doc comment there that says
 * it becomes a real setting "once `crystal()` has call sites" should be amended
 * to say that `crystal()` having call sites is the reason it never will be.
 *
 * **`GLOW.hold` is refused too, and this one the brief simply had backwards.**
 * `emissiveIntensityFor` normalises, so a `glow` of 0.09 adds exactly `0.09 x
 * BLOOM_THRESHOLD` = 0.1305 of linear luminance whatever the hue. A shard facet
 * at the angles these stand at renders around 0.198 of linear luminance, so hold
 * is not a floor under it, it is a **66% lift on top of it**, and after the alpha
 * blend it moves the shard from display 0.507 to 0.556 - back above the lawn and
 * heading for the deck. `GLOW.hold` exists so that a surface "does not go dead in
 * shadow"; a 45%-opaque object cannot go dead in shadow, because what you see
 * through it is whatever is behind it. So the glow is zero.
 *
 * That leaves albedo and opacity, which cost nothing, which is the answer the
 * brief hoped for: **the shards' problem was value and chroma, not material.**
 *
 * ## What is given up
 *
 * The groves stop being the reward palette. `HubIsland.tsx` describes them as
 * sitting "outside the value band system on purpose - they are the reward
 * palette, the way a coin is", and that is now false: they are inert glass.
 *
 * That is the right trade, because it was never true in gameplay terms. The
 * shards carry no collider and no interaction - `Colliders()` names them first in
 * its list of things that deliberately get none - so they are pure scenery, and
 * the art bible does not allow scenery into the bloom tier or above the floor it
 * stands on. If the groves should carry a reward cue, the bible already specifies
 * how and it is not this: a pale near-white emissive core sized to read at
 * distance, with a dimmer saturated shell around it that does not itself bloom.
 * That is a geometry change - a second, smaller mesh inside the shard - and it
 * belongs with the stream that owns `geometry.ts`.
 *
 * ## What is kept
 *
 * The facets. `geometry.ts:876` calls faceting "the one sanctioned exception to
 * the no-hard-edges rule: a crystal that has been rounded off reads as a jelly
 * sweet", so `shard()` is untouched and this preset changes only the surface.
 * `crystal()`'s roughness 0.14, clearcoat 0.85 and clearcoatRoughness 0.06 all
 * pass through unaltered, which is what keeps the six-sided frusta throwing the
 * hard-edged highlights that make a facet read as a facet.
 */

/**
 * The glass, as a pale dusty rose.
 *
 * ## Why this hue rather than an ice blue
 *
 * An ice-blue or aqua glass would read as glass more immediately, and it is
 * wrong, because cyan is already spoken for. `palette.visor` and
 * `palette.circuit` are the same hex and the whole game's vocabulary is built on
 * it: blue means ally, and every "this is powered" cue in the world is that
 * colour. Thirty-eight inert decorative shards in the ally colour would dilute
 * the one signal the player is being taught to read. Violet is `palette.node`,
 * gold is `palette.unlocked`, and both are similarly booked.
 *
 * Pink is the only hue family in the palette not carrying a state or an
 * allegiance, so keeping the groves in it preserves the token motif they are
 * named for while removing everything the user objected to. Pale pink glass is
 * also a real material with a real name - rose quartz, tinted cast acrylic -
 * which matters in a world whose deepest rule is that everything is a
 * manufactured object.
 *
 * ## The numbers
 *
 * `#cfb3c6` is (207, 179, 198). Display luma **0.7308**, which is a hair under
 * `palette.rock` at 0.7347 - so the decoration's albedo is, by construction, no
 * brighter than the albedo of the floor. Channel spread **0.110** against
 * `palette.token`'s 0.580, a 5.3x reduction in chroma, which is the number the
 * user's complaint actually refers to.
 *
 * Linear luma 0.4959, which is within half a per cent of the deck's 0.4992. That
 * coincidence is worth keeping if this colour is ever retuned: it means a shard
 * facet and a deck facet at the same angle render at the same value, so the only
 * thing separating them in greyscale is their angle to the key, which is exactly
 * what should separate two objects made of similar-value material.
 */
export const SHARD_GLASS = {
  color: '#cfb3c6',
  /**
   * Opacity, down from `crystal()`'s 0.92, and this is doing half the work.
   *
   * 0.45 is chosen against three separate constraints and it satisfies all of
   * them, which is why it is not 0.3 or 0.6.
   *
   * **Value.** With a lit facet at 0.198 of linear luminance over a lawn at
   * 0.245, the blend lands at `0.45 x 0.198 + 0.55 x 0.245 = 0.224`, which comes
   * out at **display 0.507**: inside the lawn's own 0.478 to 0.592, below its
   * midpoint, and clear of the deck's 0.612 to 0.698 by a comfortable margin.
   *
   * **Bloom.** three does not premultiply, so the framebuffer blend is
   * `src.rgb x alpha + dst.rgb x (1 - alpha)` and the alpha attenuates the
   * specular along with everything else. `crystal()` keeps `envMapIntensity` at
   * 1.2, and the bible caps a single Lightformer at 1.60 with the rig's brightest
   * at 1.40, so a grazing facet reflecting that card at clearcoat 0.85 reaches
   * `1.40 x 1.2 x 0.85 = 1.428` - which is 0.985 of the 1.45 threshold, close
   * enough to be a coin toss. At 0.45 opacity the same facet reaches 0.778 in
   * the framebuffer, a 1.86x margin, so the shards keep their glints and cannot
   * bloom. This is the reason `envMapIntensity` is NOT reduced: the opacity
   * already bought the headroom, and reducing it would have cost the glassy read
   * for nothing.
   *
   * **Sorting.** See the note below on why depth writing is left alone; 0.45 is
   * as transparent as this can go before the merged batch's undefined internal
   * draw order would start to matter.
   */
  opacity: 0.45,
  /**
   * Zero, and the lever if the shards read dead.
   *
   * Each 0.01 of `glow` adds `0.01 x BLOOM_THRESHOLD` = 0.0145 of linear
   * luminance to the shard before the alpha blend, so 0.45 x 0.0145 = 0.0065
   * after it. Starting from 0.224 linear, which is display 0.507, that is roughly
   * +0.006 of display value per 0.01 of glow. `GLOW.hold` at 0.09 is therefore
   * about +0.05 of display value, which is the whole margin between this and the
   * lawn's midpoint - see the discussion above. If the groves need lifting, 0.02
   * to 0.03 is the range that stays under the lawn.
   */
  glow: 0,
} as const

/**
 * The channel spread of a hex colour: its widest channel minus its narrowest.
 *
 * A crude chroma proxy and deliberately so. The complaint being answered is "the
 * bright pink triangles feel out of place", which is a statement about
 * saturation rather than about hue angle or about perceptual chroma, and the
 * quantity that tracks it is how far apart the channels are. It needs no colour
 * space and it is exact, so a test can hold a real number against it instead of
 * an eyeballed one.
 *
 * Computed in DISPLAY space, matching `displayLuma`, because this is a statement
 * about what the eye reads off a screenshot. Section 8 of the art bible is
 * emphatic that mixing the two spaces produces confident nonsense in both
 * directions.
 */
export function chromaSpread(hex: string): number {
  const raw = hex.trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`glassShard: cannot read "${hex}" as a hex colour`)
  }
  const channels = [0, 1, 2].map((i) => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255)
  return Math.max(...channels) - Math.min(...channels)
}

/**
 * The grove shards' material.
 *
 * Built on `crystal()` rather than replacing it, so the facet-defining
 * properties stay in one place: if the two-lobe exception `crystal()` documents
 * at clearcoatRoughness 0.06 is ever revisited, this follows it.
 *
 * **Depth writing is deliberately not touched**, and the brief asked about it, so
 * here is the answer. `crystal()` sets `transparent: true` and leaves
 * `depthWrite` at its default of true, and that is correct for a merged batch.
 * Depth testing is `LESS`, so a nearer shard passes the test whether or not a
 * farther one has already written depth, and a farther one fails it whether or
 * not a nearer one has - so occlusion between shards inside one grove comes out
 * right regardless of the batch's arbitrary internal draw order. What is given up
 * is seeing one shard through another, which no draw order could have provided
 * anyway. Setting `depthWrite: false` would swap a correct result for an
 * order-dependent one.
 *
 * **And the premise behind the sorting question is false.** The brief asked
 * whether `crystal()`'s transparency is already fighting the grass, "since both
 * are in the transparent list". The grass is not: `Grass.tsx` builds a
 * `MeshStandardMaterial` with `side: DoubleSide`, `vertexColors`, and no
 * `transparent`, `opacity` or `alphaTest` anywhere in the file. It renders in the
 * opaque pass, before every transparent object, so there is no sort between them
 * to get wrong - which also means dropping the shards to 0.45 opacity cannot
 * introduce one.
 */
export function glassShard(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return crystal(SHARD_GLASS.color, SHARD_GLASS.glow, {
    opacity: SHARD_GLASS.opacity,
    ...overrides,
  })
}

/**
 * The recorded state of the thing this replaces, so the tests can assert the
 * change is in the direction claimed rather than merely different.
 *
 * These are not live values - nothing reads them at runtime - and that is the
 * point. `HubIsland.tsx` will stop mentioning `palette.token` the moment the
 * integrator applies the swap, and the measured numbers that justify the swap
 * would go with it. Keeping them here means a later change that quietly walks
 * the chroma or the emissive back fails a test instead of passing review.
 */
export const SHARD_WAS = {
  color: palette.token,
  glow: 0.34,
  opacity: 0.92,
  /** Measured on real frames, display space, red clipped at 255. */
  measured: [0.692, 0.748] as const,
  /** The surfaces it was supposed to sit under. Measured on the same frames. */
  deck: [0.612, 0.698] as const,
  lawn: [0.478, 0.592] as const,
} as const

/**
 * What the emissive term alone put on the surface, in linear light, before any
 * light was counted. Above 1.0 means a clipped channel that nothing downstream
 * can recover.
 *
 * A function rather than a constant so the test computes it from the same
 * `emissiveIntensityFor` the shipped material used, rather than from a number
 * copied out of a comment.
 */
export function shardEmissiveWasLinearRed(): number {
  // #ff6bd6 has linear red exactly 1.0, so the emissive red IS the intensity.
  return (SHARD_WAS.glow * BLOOM_THRESHOLD) / 0.3663
}

/** What `GLOW.hold` would add, in linear luminance, at any hue. See the note above. */
export function holdLuminanceCost(): number {
  return GLOW.hold * BLOOM_THRESHOLD
}

/** The display luma this preset's albedo must not exceed: the floor's own. */
export const SHARD_ALBEDO_CEILING = /*@__PURE__*/ displayLuma(palette.rock)
