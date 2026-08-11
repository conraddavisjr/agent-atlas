import { LinearSRGBColorSpace, LinearFilter, Texture, TextureLoader, type BufferGeometry } from 'three'
import { useEffect, useState } from 'react'
import { lightmapAtlasHash, type LightmapAtlas, type LightmapManifest } from './geometry'
import manifest from './lightmapHub.manifest.json'
import lightmapUrl from './lightmapHub.png'

/**
 * The runtime half of the baked occlusion map for the hub's walkable batches.
 *
 * The bake itself lives in `tools/bake/` and the UV atlas in `geometry.ts`; this
 * file is the three-side wiring, the staleness check, and the arithmetic that
 * says how deep the result is allowed to go.
 *
 * ---------------------------------------------------------------------------
 * ## What is baked, and the three things the original brief got wrong
 *
 * The brief for this work asked for "sun visibility and sky occlusion as a
 * multiplier", delivered through `lightMap` or `aoMap`, so that the daylight
 * shadows on the platform steps would "literally be part of the texture". What
 * ships is **sky occlusion only**, in `aoMap`, on UV set 1. The three reasons are
 * all in three's own shader source and all of them are load-bearing.
 *
 * **1. `lightMap` cannot darken anything.** `lights_fragment_maps.glsl.js` reads
 * `irradiance += lightMapTexel.rgb * lightMapIntensity`. It is additive. A texel
 * of 0.3 does not scale the surface to 30%, it adds 30% of a unit of extra light.
 * There is no value that removes light, so a "lightmap that darkens" does not
 * exist in this material model. `lightMapIntensity` accepts a negative number and
 * that was tried on paper: it subtracts a FIXED amount rather than a fraction, so
 * it goes negative wherever the local ambient is lower than the subtraction, and
 * it does not track `quality.hemisphereIntensity` - meaning the tier ladder would
 * change the art, which the art bible section 7 prohibits outright.
 *
 * **2. `aoMap` cannot touch the sun.** `aomap_fragment.glsl.js` multiplies
 * `reflectedLight.indirectDiffuse` and the indirect specular. The four
 * directional lights in `HUB_RIG` are DIRECT and are not multiplied by it at all.
 * So a baked sun-shadow placed in this slot would darken the ambient in the
 * shadow - which is not what a sun shadow is - and would leave the key at full
 * strength inside it.
 *
 * **3. The sun shadow is already baked, by the shadow map, every frame.** All
 * three hub batches carry `castShadow receiveShadow`, so deck-onto-deck and
 * kerb-onto-deck sun shadows are already being drawn, they already agree with the
 * character's own shadow, and they already move if the key moves. Baking them as
 * well would multiply two shadows together at two different resolutions and two
 * different edge positions. The honest version of "make the shadows part of the
 * texture" is therefore: bake the term the runtime has NO mechanism for, which
 * since `97-decision-shadow-end.md` turned the occlusion pass off at every tier
 * is ambient occlusion, and leave the term the runtime already does well alone.
 *
 * A pleasant consequence: an occlusion integral that only scales indirect diffuse
 * has **no sun direction in it**, so the bake cannot disagree with `KEY_DIRECTION`
 * because it never reads it. The brief's "your bake must agree with the runtime
 * rig or the baked shadows will point the wrong way" describes a failure mode this
 * design does not have, and the bake survives any future change to the rig.
 *
 * ---------------------------------------------------------------------------
 * ## Why this can go in `aoMap` at all, when the decks already have one
 *
 * They cannot coexist and the reason is sharper than "a material has one slot".
 * `decalTextures.ts` returns `roughnessMap: orm, aoMap: orm` - the SAME `Texture`
 * object in two slots, which is the point of an ORM pack. `channel` is a property
 * of the texture, not of the slot, so there is no assignment of channels that puts
 * the ORM's occlusion on UV 0 and a lightmap on UV 1 in one material. Cloning the
 * ORM to give it a second channel would double the texture memory to gain a
 * channel that, by the project's own measurement, does nothing.
 *
 * So the generated ORM's occlusion channel is dropped on the deck and trim
 * batches, and this map takes the slot. **The cost is measured rather than
 * assumed**: `HubIsland.tsx` records that switching the generated maps on moved a
 * lit deck's p5-p95 from 0.0387 to 0.039, because "relief does nothing on an
 * up-facing surface under a key 42.7 degrees overhead". The occlusion channel of
 * that pack is micro-occlusion in the same relief. Its roughness and metalness
 * channels are untouched and still bound, because they are the same texture in the
 * `roughnessMap` slot at channel 0.
 *
 * The dress batch keeps its ORM occlusion. It is tier-gated - six pylons at low,
 * eight at high - so its part list and therefore its atlas would change with the
 * quality tier, and a per-tier lightmap is the tier ladder changing the art again.
 *
 * ---------------------------------------------------------------------------
 * ## How deep this is allowed to go, and why it cannot break the bands
 *
 * `97-decision-shadow-end.md` requires darks to stay out of the empty 0.38-0.56
 * gap, and the arithmetic here is unusually reassuring.
 *
 * Directional irradiance on a deck top, Rec.709 luma of the linearised colour
 * times intensity times N.L, from `HUB_RIG`:
 *
 * | term | colour | intensity | N.L | irradiance |
 * | --- | --- | --- | --- | --- |
 * | key | `#ffe7bc` 0.820 | 1.83 | 0.678 | 1.018 |
 * | rim | `#bfeaff` 0.771 | 0.55 | 0.438 | 0.186 |
 * | bounce fill | `#ffe9cf` 0.841 | 0.10 | ~0.2 | 0.017 |
 * | sky fill | `#9ec9f0` 0.553 | 0.12 | 0.181 | 0.012 |
 * | | | | **direct** | **1.233** |
 *
 * Indirect is the hemisphere, `#bcd6ee` at luma 0.650 times 0.55 times the 0.62
 * scale = 0.221, plus the environment's cosine-weighted integral, which is the one
 * term this file cannot compute from constants. Bracketing it at 0.35 (+/- 0.15)
 * from the card radiances in `Lighting.tsx`'s budget block gives a total near
 * 1.80 and an indirect share of **0.32**.
 *
 * `aoMap` scales only that share, so a texel of 0 removes 32% of a deck top's
 * radiance and nothing can make it remove more. Converting through the measured
 * local response of the ACES-plus-LUT chain - `97-decision-shadow-end.md` records
 * a lit deck at 0.687 display and its cast shadow, which removes the key's 56% of
 * radiance, at 0.480, so display goes as roughly linear^0.43 in this range - the
 * whole range this map can reach is bounded, and the bound is the finding.
 *
 * Read off the committed atlas rather than assumed, at the places a player looks:
 *
 * | where | baked visibility | display luma |
 * | --- | --- | --- |
 * | middle of T1, open sky | 0.98 | 0.685 |
 * | T1's tread, 0.15 m into the T2 riser | **0.67** | **0.655** |
 * | T1's tread under the north kerb's edge | 0.28 | 0.614 |
 * | the arithmetic floor, a fully enclosed texel | 0.00 | **0.583** |
 *
 * **So a lit deck's shadowed region spans 0.583 to 0.655, and the gap this has to
 * stay out of is 0.38 to 0.56.** The floor clears the top of the gap by 0.023 and it
 * is a floor rather than a target: `aoMap` scales only the indirect share, so a texel
 * of 0 removes 32% of a deck top's radiance and nothing can make it remove more.
 * Every value is inside the 0.56-0.74 gameplay band. The map also cannot reach the
 * 0.06-0.18 anchor band, which is the same conclusion `97-decision-shadow-end.md`
 * reached about cast shadow, for a different reason.
 *
 * On the kerbs it goes deeper, correctly: the T3 north kerb's inward face measures
 * 0.47 at its foot rising to 0.73 at its crown, and a vertical face gets most of its
 * light indirectly, so on a band-2 surface rendering near 0.33 that foot lands around
 * 0.265 - inside the 0.20-0.38 midground band where a kerb belongs.
 *
 * The flip side, stated because it is the honest limit of this change: the
 * screen-space pass that was removed multiplied the FINAL colour, direct included,
 * and doc 97 measured it taking a 0.65 deck to roughly 0.47, a band of 0.18. This
 * map can only produce 0.104 at the same place, and in practice 0.030 where a real
 * riser meets a real tread. It recovers part of that
 * loss, at zero runtime cost and without the pass's crackle, its grass-into-hero
 * projection or its 1.93x frame-rate bill - but it does NOT recover all of it, and
 * pretending otherwise would be the wrong handover. The rest belongs to
 * `contactDecal.ts`, which multiplies final colour and already exists, and that is
 * where a reviewer who wants a deeper junction should be pointed.
 *
 * On vertical faces the same map has far more authority, because a face turned
 * away from a 42.7-degree key receives almost all of its light indirectly. That is
 * where the depth actually is, and it is the membership clause the anchor band
 * already grants: "recessed apertures: kerb faces, riser faces, panel gaps".
 */

/**
 * `aoMapIntensity` for the walkable batches.
 *
 * Left at full strength, which is the unusual answer for an occlusion map and is
 * justified by the band arithmetic above rather than by taste: the deepest value
 * this map can produce on a walkable surface is 0.583 display against a gameplay
 * floor of 0.56, so there is no headroom being spent and nothing to protect. It
 * stays a named constant because it is the one lever that softens the whole effect
 * without a re-bake, which is what a reviewer will want first.
 */
export const HUB_LIGHTMAP_INTENSITY = 1

export const LIGHTMAP_MANIFEST = manifest as LightmapManifest

/**
 * Compare a freshly packed atlas against the manifest the PNG was baked with.
 *
 * Returns the problem as a string, or null when they agree, so the caller decides
 * whether that is a DEV warning or a test failure. Both use it.
 */
export function lightmapStaleness(atlas: LightmapAtlas): string | null {
  const expected = LIGHTMAP_MANIFEST
  if (atlas.size !== expected.size || atlas.texelsPerMetre !== expected.texelsPerMetre || atlas.gutter !== expected.gutter) {
    return (
      `lightmap: the atlas is ${atlas.size}px at ${atlas.texelsPerMetre} texels/m gutter ` +
      `${atlas.gutter} but ${lightmapUrl} was baked at ${expected.size}px / ` +
      `${expected.texelsPerMetre} / ${expected.gutter}. Re-run \`npm run bake:lightmap\`.`
    )
  }
  const actual = lightmapAtlasHash(atlas)
  if (actual !== expected.hash) {
    return (
      `lightmap: STALE. The hub's walkable geometry hashes to ${actual} but the baked ` +
      `occlusion map was made for ${expected.hash} (baked ${expected.generated}). Every ` +
      'shadow on the decks and kerbs is now in the place the OLD layout put it. Re-run ' +
      '`npm run bake:lightmap`.'
    )
  }
  return null
}

/**
 * Assert that a map is actually going to be sampled with the UVs it was baked for.
 *
 * This is the single most valuable check in the file, because the failure it
 * catches is invisible. A material whose `aoMap.channel` is 1 compiles to
 * `#define AOMAP_UV uv1`; a geometry with no `uv1` attribute does not error,
 * WebGL supplies a zero attribute, every fragment reads texel (0, 0), and the
 * whole surface gets one uniform multiply. The frame is clean, the triangle count
 * is right, and the deck is very slightly the wrong colour. `textures.ts` already
 * carries the mirror-image note about this, for the ORM pack.
 *
 * Called from `HubIsland.tsx` in an effect rather than during render, so it runs
 * once per mount and cannot be tree-shaken out of the dev build.
 */
export function assertLightmapBound(geometry: BufferGeometry, texture: Texture | null, what: string): void {
  if (!texture) return
  if (texture.channel !== 1) {
    throw new Error(
      `lightmap: ${what} was handed a map on channel ${texture.channel}. The atlas writes ` +
        'uv1, which three reaches only at channel 1.',
    )
  }
  if (!geometry.getAttribute('uv1')) {
    throw new Error(
      `lightmap: ${what} has no uv1 attribute, so its aoMap will sample texel (0, 0) for ` +
        'every fragment and silently flat-multiply the whole surface.',
    )
  }
}

/**
 * Configure a loaded lightmap texture. Separated from the hook so a test can
 * assert the settings without a loader.
 *
 * Every line of this is a silent failure if it is wrong.
 *
 * `channel = 1` is the whole binding; see the block in `geometry.ts` for the
 * source citation. `LinearSRGBColorSpace` because a visibility scalar is data: an
 * sRGB decode would bend a linear 0.5 to 0.21 and roughly double the apparent
 * strength of every soft gradient in the bake.
 *
 * **Mipmaps off, and this is the one that is not obvious.** The atlas gutter is 2
 * texels, which is what bilinear needs. Mip level 3 averages 8x8 blocks, which
 * reaches across the gutter into a neighbouring chart, so a distant deck would
 * bleed the occlusion of an unrelated kerb into itself. The alternatives are a
 * gutter wide enough for the whole chain, which costs about a third of the atlas,
 * or per-level dilation, which the encoder cannot express. Turning them off costs
 * some minification aliasing on a signal that has no high frequencies in it, which
 * is the cheapest of the three. `generateMipmaps = false` must be set BEFORE the
 * first upload, hence here rather than at a call site.
 *
 * `flipY` is deliberately left at its default. `applyLightmapUV` inverts V when it
 * writes the attribute, so exactly one place in the project knows about the flip.
 */
export function configureLightmap(texture: Texture): Texture {
  texture.channel = 1
  texture.colorSpace = LinearSRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Load the hub's baked occlusion map.
 *
 * Deliberately NOT `useLoader`/`useTexture`, which suspend. The hub mounts inside
 * a scene with its own progression and camera pinning, and adding a new suspense
 * boundary to it for one 200 KB image would change what "settled" means for the
 * capture harness that every measurement in `docs/design/` is taken through.
 *
 * So it returns null until the image arrives and the material renders without an
 * `aoMap` for those few frames. That is a real degradation and it is logged rather
 * than swallowed: a lightmap that quietly never loads is exactly the class of bug
 * `docs/design/00-art-bible.md` section 0 is a list of.
 */
export function useHubLightmap(): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null)

  useEffect(() => {
    let live = true
    const loader = new TextureLoader()
    loader.load(
      lightmapUrl,
      (loaded) => {
        if (!live) {
          loaded.dispose()
          return
        }
        setTexture(configureLightmap(loaded))
      },
      undefined,
      () => {
        console.error(
          `lightmap: failed to load ${lightmapUrl}. The decks will render with no baked ` +
            'occlusion at all, which looks like a slightly flat deck rather than like an error.',
        )
      },
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => () => texture?.dispose(), [texture])

  return texture
}
