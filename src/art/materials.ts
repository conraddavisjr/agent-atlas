import type { ThreeElements } from '@react-three/fiber'
import { AdditiveBlending, Color, Vector2, type Texture } from 'three'

/** R3F v9 derives element props from three itself rather than exporting them by name. */
type MeshPhysicalMaterialProps = ThreeElements['meshPhysicalMaterial']
type MeshBasicMaterialProps = ThreeElements['meshBasicMaterial']

/**
 * The bloom threshold, owned here and imported by `PostFX.tsx`.
 *
 * It lives in the material layer rather than in the post layer because it is
 * the material layer that has to divide by it. Both files need the same number
 * and the two have already drifted apart once: this file's doc comment used to
 * claim that an `emissiveIntensity` above 1 "pushes it past the bloom threshold
 * in PostFX", which was never true for any colour in the palette at any
 * intensity the game shipped.
 *
 * MEASURED, at 1.45. The prediction on record was 1.2 to 1.6 and it lands
 * inside it. It was measured rather than bisected by eye: the scene is rendered
 * into a HalfFloatType target with every emissive object hidden, the half
 * floats are decoded, and the luminance distribution of what remains is what
 * this number has to clear. The renderer is `NoToneMapping`, so those values
 * are exactly the ones Bloom's luminance pass sees.
 *
 * Non-emissive luminance across the six hub vantages:
 *
 *   vantage             max      p99.99   p99.9
 *   hub-establishing    0.953    0.816    0.815
 *   hub-portal          1.001    0.816    0.815
 *   hub-totem           1.296    0.978    0.815
 *   hub-character       1.503    1.247    0.815
 *   hub-grazing         1.559    1.214    0.954
 *   hub-backlit         5.233    2.150    0.959
 *
 * Two populations, and the threshold sits between them. Every broad surface in
 * the game - the sky, sunlit grass, lit white plastic, the deck - tops out at
 * 0.959, which is the sky. The numbers above that are clearcoat Fresnel at
 * grazing incidence on a few hundredths of one per cent of the frame, and
 * `hub-backlit` dominates them exactly as the lighting spec predicted, because
 * a camera pointed into the key puts every silhouette edge at the angle where
 * that lobe peaks.
 *
 * 1.45 clears the broad ceiling by 1.51x and the highest ordinary-angle shell
 * specular, `hub-character`'s 1.247, by 1.16x. What it deliberately does NOT
 * clear is `hub-backlit`'s top 0.01 per cent at 2.15 and above, which blooms as
 * a compact jewel glint on the silhouette. That is the intent rather than a
 * tolerance: the reference brief says only emissives and specular hits bloom,
 * and white plastic does not.
 *
 * Lowering this does not make the emissives dimmer relative to the line.
 * `emissiveIntensityFor` divides by it, so every emissive in the game moves
 * with it and keeps its exact multiple of the threshold. It does make them
 * dimmer in absolute terms, which is the point: they now sit 17 per cent closer
 * to the surfaces around them and read as lights rather than as holes.
 */
export const BLOOM_THRESHOLD = 1.45

/**
 * How wide the glow is, and the dial that was doing the opposite of its name.
 *
 * `radius` on a mipmap bloom is NOT a kernel size. `MipmapBlurPass` downsamples
 * `levels` times and then walks back up, and each upsampling step is
 *
 *     gl_FragColor = mix(supportBuffer, tentBlur(inputBuffer), radius)
 *
 * where `supportBuffer` is that level's own downsample and `inputBuffer` is
 * everything coarser. So `radius` is the WEIGHT handed to the coarser mips at
 * every rung of the ladder, and the final texture is a normalised blend whose
 * per-level weights are `(1 - radius) * radius^k`, with `radius^(levels-1)` left
 * over on the coarsest. It always sums to one, so raising it does not brighten
 * the bloom - it moves the bloom's energy outward.
 *
 * That matters because the wide mips are the entire visible halo. At the 0.6
 * this shipped with, mips 0 and 1 - the ones within a few pixels of the source -
 * took 64% of the weight and mips 4 through 7 took 12.8%. Multiply by an
 * intensity of 0.55 and the halo was carrying 0.071 of the source: an emissive
 * correctly pushed past a correctly measured threshold, rendered as a
 * two-pixel-wide bright edge with nothing around it. Which is paint.
 *
 * At 0.85, postprocessing's own default, mips 4 through 7 take 52.2%.
 *
 *   radius  intensity   near field (mips 0-1)   far field (mips 4-7)
 *   0.60    0.55        0.352                   0.071
 *   0.85    0.85        0.236                   0.444
 *
 * The pairing is the point and it is why the intensity moves at the same time.
 * The far field goes up 6.2x, which is the fix for "nothing glows". The near
 * field goes DOWN by a third, which is the opposite of what raising a bloom
 * intensity normally does and is what stops this making `hub-backlit`'s clipped
 * dome specular spill any harder than it already does. The two failures pull in
 * opposite directions and this is the pair of numbers that serves both.
 *
 * 0.85 rather than higher because at 1.0 the mix discards `supportBuffer`
 * entirely at every rung and the sharp core of the glow disappears with it.
 */
export const BLOOM_RADIUS = 0.85

/** See `BLOOM_RADIUS`. Chosen with it; neither is meaningful alone. */
export const BLOOM_INTENSITY = 0.85

/**
 * The per-mip weights `MipmapBlurPass` produces, as a pure function.
 *
 * Written out here rather than trusted because the whole finding above depends
 * on `radius` being a blend weight rather than a kernel width, and that is the
 * kind of claim this project has been wrong about before. `materials.test.ts`
 * asserts the distribution sums to one and that the far field clears the
 * fraction below.
 */
export function bloomMipWeights(radius: number, levels: number): number[] {
  const weights: number[] = []
  for (let k = 0; k < levels - 1; k++) weights.push((1 - radius) * Math.pow(radius, k))
  weights.push(Math.pow(radius, levels - 1))
  return weights
}

/**
 * The share of the bloom that lands in mips 4 and coarser, times the intensity.
 *
 * This is the number that decides whether an emissive reads as a light or as a
 * bright surface, because mips 0 to 3 all fall off inside about sixteen pixels
 * and are indistinguishable from the object's own edge. Below about 0.25 there
 * is no halo; the shipped rig was at 0.071.
 */
export function bloomFarFieldWeight(
  radius: number = BLOOM_RADIUS,
  intensity: number = BLOOM_INTENSITY,
  levels = 8,
): number {
  return bloomMipWeights(radius, levels).slice(4).reduce((a, b) => a + b, 0) * intensity
}

/**
 * The two-lobe rule, from the art bible's section 5.
 *
 * Moulded plastic is a slightly diffuse body under a smooth surface skin and the
 * eye reads that as two separate specular lobes. GGX lobe width goes as
 * roughness squared, so what has to separate is `baseRoughness^2 /
 * clearcoatRoughness^2`, and below 8 the two resolve as one slightly odd
 * highlight rather than as two.
 */
export const TWO_LOBE_MIN_RATIO = 8

/**
 * The bloom-safety rule, also from section 5.
 *
 * At `clearcoat: 1` the coat's Fresnel term owns the surface completely at
 * grazing angles. That erases the body lobe at exactly the silhouette where form
 * is read, and it drives raw HDR toward the environment's peak radiance along
 * every edge in frame - which, with bloom running before tone mapping, is the
 * likeliest place for unwanted bloom to appear and is precisely where
 * `hub-backlit` found a white dome clipped to (255,252,243).
 */
export const MAX_CLEARCOAT = 0.85

/** `baseRoughness^2 / clearcoatRoughness^2`, the quantity the two-lobe rule bounds. */
export function lobeRatio(baseRoughness: number, clearcoatRoughness: number): number {
  if (clearcoatRoughness <= 0) return Infinity
  return (baseRoughness * baseRoughness) / (clearcoatRoughness * clearcoatRoughness)
}

/**
 * Whether a `clearcoatRoughnessMap` is safe on a preset, and WHY the deck's
 * roughness map never did anything.
 *
 * ## The mechanism, which the null measurement was blamed on the wrong thing
 *
 * `decalTextures.ts` records that the deck's normal and ORM maps changed a deck
 * patch's p5-p95 by 0.0003, and attributes it to the key's elevation - perturbing
 * a normal that already points at the light barely moves `N.L`. That is true of
 * the NORMAL half. It does not explain the ROUGHNESS half, and the roughness half
 * has a separate and completely sufficient explanation that nothing had written
 * down:
 *
 * **`roughnessMap` cannot touch the only tight lobe `mattePlastic` has.** The
 * preset is `roughness: 0.75` with `clearcoat: 0.4` at `clearcoatRoughness: 0.26`.
 * In three, `roughnessMap` multiplies `roughness` and nothing else -
 * `clearcoatRoughness` has its OWN map slot and is untouched. So the deck's
 * roughness ladder was modulating a lobe at roughness 0.75, which is
 * near-Lambertian and has essentially no specular shape to break, while the one
 * lobe on the surface narrow enough to produce a visible highlight sat at a
 * uniform 0.26 across all 113 square metres. A `+/- 0.14` swing on the diffuse
 * lobe of a matte surface under a soft key is not a subtle effect, it is
 * arithmetically almost nothing.
 *
 * That matters because it predicts the brief's own falsification: a ROUGHNESS
 * contrast between panels can read where a normal map cannot, but only if it is
 * applied to the coat. The same ORM image already carries the right signal in its
 * green channel - a dust trap is rougher in both lobes - and three reads
 * `clearcoatRoughnessMap` from green too, so the experiment costs one extra
 * material property and no new texture, no new canvas and no new sampler.
 *
 * ## What this function guards
 *
 * The map is a MULTIPLIER, so a green channel spanning 161 to 247 takes
 * `clearcoatRoughness` from 0.26 down to 0.164 at the smoothest texel. Smoother
 * means a TIGHTER highlight, which is the direction that risks both the two-lobe
 * rule and bloom, so the floor is what has to be checked rather than the ceiling.
 * Returns the resulting lobe ratio at the map's smoothest texel; the caller
 * asserts it is at or above `TWO_LOBE_MIN_RATIO`.
 *
 * **NOT MEASURED.** This stream is forbidden from driving the browser, so the
 * prediction above is arithmetic and not a frame. It is offered as a one-line A/B
 * for the integrator with the numbers attached, and the binding is deliberately
 * separate from the rest of the deck material in the diff so it can be reverted on
 * its own.
 */
export function coatLobeRatioUnderMap(
  baseRoughness: number,
  clearcoatRoughness: number,
  minGreenByte: number,
): number {
  return lobeRatio(baseRoughness, clearcoatRoughness * (minGreenByte / 255))
}

/**
 * The lobe ratio a `roughnessMap` actually produces, and a defect it is hiding.
 *
 * **Every shipped binding of these maps breaks the two-lobe rule at its smoothest
 * texel, and nothing checks it**, because the rule is asserted on the PRESETS in
 * `materials.test.ts` while the maps are bound at the call site in `HubIsland.tsx`.
 * The preset passes; the material the player sees does not.
 *
 * The mechanism is that `roughnessMap` multiplies `roughness` and `clearcoatRoughness`
 * has a separate slot, as `coatLobeRatioUnderMap` above already establishes. What
 * that note treats as an OPPORTUNITY - the coat is unmodulated, so binding the
 * green channel to it would break up a highlight - is simultaneously a RULE
 * VIOLATION, and that half was missed. A map that takes the base lobe from 0.72
 * down to 0.579 while the coat stays pinned at 0.26 does not just fail to break
 * the coat's highlight, it walks the two lobes back on top of each other:
 *
 *   binding                            effective base   coat    lobe ratio
 *   deck, roughnessMap only            0.579 to 0.861   0.26    4.96 to 10.97
 *   deck, plus clearcoatRoughnessMap   0.579 to 0.861   mapped  11.98, constant
 *   trim, roughnessMap only            0.621 to 0.819   0.26    5.71 to 9.92
 *   trim, plus clearcoatRoughnessMap   0.621 to 0.819   mapped  11.98, constant
 *
 * 4.96 and 5.71 are both under `TWO_LOBE_MIN_RATIO`, so on the smooth half of
 * every panel the deck and the kerbs currently resolve as one specular wash - the
 * exact defect `plastic()` was rebuilt to remove, reintroduced by a texture.
 *
 * **Binding `clearcoatRoughnessMap` fixes it rather than merely experimenting.**
 * Both roughnesses then scale by the same texel, the ratio becomes invariant, and
 * it lands at 11.98 - ABOVE the 8.3 the unmapped preset has. `createDecalMaps`
 * has returned the image for this slot since it was written and no call site uses
 * it. That upgrades the offer in `DecalMaps.clearcoatRoughnessMap` from a free A/B
 * to a correction.
 *
 * Pass `coatMapped` true to model both slots taking the same green byte.
 */
export function lobeRatioUnderRoughnessMap(
  baseRoughness: number,
  clearcoatRoughness: number,
  greenByte: number,
  coatMapped = false,
): number {
  const scale = greenByte / 255
  return lobeRatio(baseRoughness * scale, coatMapped ? clearcoatRoughness * scale : clearcoatRoughness)
}

/**
 * Below this linear luminance, an emissive colour must not be normalised.
 *
 * See `emissive()` for what that means and why. The number is the art bible's,
 * and it is a statement about hue rather than about taste: violet at `#7c6bff`
 * has a linear luminance of 0.220, so reaching the threshold takes an
 * `emissiveIntensity` near 8, and a surface emitting eight times the brightest
 * lit thing in the scene renders as white with a coloured fringe. The colour is
 * gone, which is the opposite of what a coloured light is for.
 */
export const LOW_LUMA_FLOOR = 0.35

/**
 * The sRGB electro-optical transfer function, one channel, 0..1 in and out.
 *
 * three applies exactly this to any colour assigned to `emissive`, `color` or
 * `sheenColor`, because `Color` decodes from sRGB into the linear working
 * space. So this is not an approximation of what the renderer does with our hex
 * strings, it is the same function, and that is what makes the arithmetic below
 * predictive rather than indicative.
 */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/**
 * The inverse: linear 0..1 to a gamma-encoded sRGB 0..1. The DISPLAY space.
 *
 * This is the space the whole value-band system is measured in and the space it
 * was missing a function for. `00-art-bible.md` section 8 states it outright:
 * the band test is run on gamma-encoded bytes, the same numbers an eyedropper
 * on a screenshot returns, while the bloom budget above is linear because that
 * is what the threshold compares. The same hex sits at two very different
 * numbers in the two spaces and checking one against the other "produces
 * confident nonsense in both directions".
 *
 * Anything that reasons about a band therefore needs BOTH directions, and until
 * now only the decode existed - so every piece of band arithmetic in the project
 * has been done by hand in a comment. `albedoByte` in `decalTextures.ts` is the
 * first caller: it has to convert a wanted DISPLAY-luma drop into a linear
 * albedo multiplier and then back into a texture byte, which is three trips
 * across this boundary in one expression.
 */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055
}

/** Rec.709 relative luminance of a LINEAR rgb triple. */
export function luma709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * `#rrggbb` or `#rgb` to a linear rgb triple.
 *
 * Throws rather than returning black on a malformed string. Every caller of
 * this is deciding how bright to make a light, and silently treating an
 * unparseable colour as luminance zero produces a division by zero downstream,
 * which is a far worse failure than a loud one at startup.
 */
export function linearise(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`materials: cannot read "${hex}" as a hex colour`)
  }
  const byte = (i: number) => srgbToLinear(parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255)
  return [byte(0), byte(1), byte(2)]
}

/** Rec.709 luminance of a hex colour, in linear light. The number bloom masks on. */
export function linearLuma(hex: string): number {
  const [r, g, b] = linearise(hex)
  return luma709(r, g, b)
}

// ---------------------------------------------------------------------------
// Band arithmetic for CURVED surfaces
//
// **The band rule has been applied to the wrong kind of object, and every
// cylinder in the hub fails it today.** MEASURED on
// `.critique/astro/maps-on--hub-establishing.png`, which is the frame the
// existing band notes were written against:
//
//   surface                  box              mean    p5     p95    width  band?
//   Core strut, near         817,505,16,20    0.383   0.190  0.472  0.282  NO
//   pylon 300 deg shaft      1168,355,22,40   0.294   0.134  0.411  0.278  NO
//   pylon 0 deg shaft        1491,500,34,40   0.241   0.120  0.394  0.274  NO
//   pylon 180 deg shaft      255,400,24,40    0.360   0.224  0.411  0.187  NO
//
// `frame.mjs spread` reports `inOneBand: false` on all four, in a midground band
// 0.18 wide. Two of them dip into the anchor band. This is not a tuning miss of a
// few hundredths, it is a surface class that the value system has no mechanism
// for, and it includes the four Core struts, all eight pylon masts and every
// overhead arc - the entire dress batch, which is the level's primary framing
// device and the frame of its focal point.
//
// **`paintByFacing` cannot fix it, and that is the finding.** That pass gives a
// mesh one albedo for up-facing triangles and another for side-facing ones, to
// compensate for the fact that an overhead key delivers 0.81 of an albedo's
// linear luminance to a horizontal face and 0.54 to a vertical one. It is defined
// on the face normal, and it works: the pylons' MEAN moved to the predicted 0.27,
// measured 0.294. But a cylinder presents every normal in a hemisphere within one
// part, simultaneously, in every frame. Its spread is not a function of its paint,
// and section 8.1 of the art bible - amended after round 3 - judges band
// membership on the spread.
//
// So round 3's fix was measured on the statistic round 3's amendment then
// retired.
// ---------------------------------------------------------------------------

/**
 * How much of an albedo's LINEAR luminance a surface actually renders, by facing.
 *
 * MEASURED off the establishing frame and previously recorded only as prose in
 * `HubIsland.tsx`. Promoted to code because every band argument in the project has
 * been doing this multiplication by hand in a comment, and because `renderedLuma`
 * below reproduces four independently recorded numbers from it to within 0.006 -
 * which makes it a model rather than a note.
 *
 * `up`, `litVertical` and `shadedVertical` are the three the dress batch's paint
 * pass was built on. The two cylinder entries are new and are the reason this
 * block exists.
 */
export const FACING_RATIO = {
  /** A horizontal face under the key, which is 42.7 degrees up. Decks, caps. */
  up: 0.81,
  /** A vertical face turned toward the key. */
  litVertical: 0.54,
  /** A vertical face turned away from it, lit by ambient alone. */
  shadedVertical: 0.11,
  /**
   * The p95 of a CYLINDER, and the number that breaks the scheme.
   *
   * 0.915, which is HIGHER than a horizontal deck's 0.81, and it has to be: a
   * cylinder's surface contains the normal that points exactly at the key, so
   * `N.L` reaches 1 somewhere on every cylinder whatever its orientation, where a
   * flat deck under a key 42.7 degrees up is capped at `sin(42.7) = 0.678`. A
   * cylinder is therefore brighter at its brightest than any flat face can be,
   * regardless of which way it is turned, and no albedo assigned by facing can
   * know that.
   *
   * Derived from the measured strut: p95 display 0.4724 decodes to linear 0.18938
   * against `#6e7e9e`'s albedo luminance of 0.20705.
   */
  cylinderPeak: 0.915,
  /** The p5 of the same cylinder: display 0.190, linear 0.03007, over 0.20705. */
  cylinderShade: 0.145,
} as const

/**
 * What a diffuse surface of colour `hex` renders at in DISPLAY luma, at a facing.
 *
 * Checked against every rendered value the project has recorded:
 *
 *   call                                    this   recorded
 *   renderedLuma('#3c465a', up)             0.246  0.24   (frameTop, HubIsland)
 *   renderedLuma('#6e7e9e', litVertical)    0.368  0.37   (frameSide, HubIsland)
 *   renderedLuma('#6e7e9e', shadedVertical) 0.163  0.16   (frameSide, HubIsland)
 *   renderedLuma('#bfbbb4', up)             0.668  0.687  (DECK_LIT_LUMA, measured)
 *
 * The deck is the loosest at 0.019, and it is loose in the safe direction. The
 * three that were themselves predicted from these ratios land within 0.006, which
 * is the point: this is the arithmetic those predictions were made with, now
 * executable instead of retyped.
 */
export function renderedLuma(hex: string, facing: number): number {
  return linearToSrgb(Math.min(1, linearLuma(hex) * facing))
}

/**
 * The p95-to-p5 LINEAR ratio a diffuse cylinder shows under this key.
 *
 * 6.297, straight off the frame: `srgbToLinear(0.4724) / srgbToLinear(0.190)`.
 *
 * **The albedo cancels.** Both ends are the same albedo times a different facing
 * ratio, so the ratio is a property of the LIGHTING and the SHAPE and nothing
 * else. That is what makes the impossibility proof below a proof rather than an
 * observation about one hex.
 */
export const DIFFUSE_CYLINDER_LINEAR_RATIO = 6.297

/**
 * The LINEAR ratio a display-space band permits between its floor and ceiling.
 *
 * This is the number the band rule really is, once it is written in the space the
 * renderer multiplies in. Midground 0.20-0.38 permits 3.603; gameplay 0.56-0.74
 * permits only 1.852, because the transfer curve is far flatter up there.
 *
 * And it settles the dress batch immediately. A diffuse cylinder's own ratio is
 * `DIFFUSE_CYLINDER_LINEAR_RATIO`, 6.297, against midground's 3.603. **6.297 does
 * not fit in 3.603 at any albedo**, because the albedo cancels out of both. The
 * struts and pylons are not mispainted; a diffuse cylinder cannot be in band 2
 * under this key, and repainting them is the one fix guaranteed not to work.
 *
 * For completeness, the same statement from the other end: to bring the width to
 * 0.18 at a ratio of 6.297 the p5 has to fall to 0.100, which is half the
 * midground floor and inside the anchor band.
 */
export function bandLinearRatio(lo: number, hi: number): number {
  return srgbToLinear(hi) / srgbToLinear(lo)
}

/** The DISPLAY width a linear ratio produces above a given p5. */
export function displayWidthForLinearRatio(p5: number, ratio: number): number {
  return linearToSrgb(Math.min(1, srgbToLinear(p5) * ratio)) - p5
}

/**
 * Schlick's Fresnel term. `f0` is the reflectance at normal incidence.
 *
 * Written out because the whole argument for putting metal on the frame turns on
 * the fifth power, and specifically on how LATE it does anything: at 30 degrees
 * off the normal `(1 - cos)^5` is 0.000043, and it does not reach a tenth until
 * 66 degrees. A quantity that flat for two thirds of its domain behaves very
 * differently on a curved surface than the linear intuition suggests, which is
 * exactly where `anodised()`'s own finding went wrong.
 */
export function schlickF(f0: number, cosTheta: number): number {
  return f0 + (1 - f0) * Math.pow(1 - cosTheta, 5)
}

/**
 * Normal-incidence reflectance of a hex albedo at a given metalness.
 *
 * three's rule, verbatim: `F0 = mix(vec3(0.04), diffuseColor.rgb, metalness)`, so
 * a metal's albedo IS its specular colour and a dielectric's is 4% regardless.
 * Taken on the luminance rather than per channel, which is the same approximation
 * `albedoByte` makes and is what keeps this comparable to a band number.
 *
 * Worth having as a function because the 0.95 in `anodised()` is not 1: five per
 * cent of the surface stays dielectric, which lifts `f0` off the albedo by 0.002
 * and is the difference between an inverse that round-trips and one that is nearly
 * right.
 */
export function metalF0(hex: string, metalness: number): number {
  return 0.04 * (1 - metalness) + metalness * linearLuma(hex)
}

/**
 * The p95-to-p5 LINEAR ratio a METAL cylinder shows, from Schlick alone.
 *
 * **This is the correction to `anodised()`'s finding, and it inverts its
 * conclusion for one whole class of surface.** That note computes the Fresnel
 * sweep of a FLAT kerb face - 0.20 head-on to 0.68 at 85 degrees, a spread near
 * 0.5 in a band 0.18 wide - and concludes that no broad surface can be metal. The
 * arithmetic is right and the conclusion is right for a flat face, where the view
 * angle is one number that the camera moves.
 *
 * A cylinder is the opposite case in two ways at once, and both help.
 *
 * **The sweep is fixed to the object rather than to the camera.** Every view angle
 * from 0 to 90 degrees is present across a cylinder's width in every frame, so
 * turning the camera does not move the distribution. A flat metal face's value is
 * a function of camera yaw; a metal cylinder's is not.
 *
 * **And the distribution is crushed against the low end.** Screen-x across a
 * cylinder of radius R is `R sin(phi)`, so a pixel column is uniform in
 * `sin(phi)`, not in `phi`. The screen-space quantile `q` therefore sits at
 * `phi = asin(q)`, and combining that with the fifth power puts the entire Fresnel
 * rise in the outer tenth of the width:
 *
 *   q      phi      F        F/F0
 *   0.05   2.9deg   0.1987   1.000
 *   0.50   30deg    0.1987   1.000
 *   0.75   48.6deg  0.2023   1.018
 *   0.95   71.8deg  0.3220   1.621
 *   0.99   81.9deg  0.5733   2.885
 *   1.00   90deg    1.0000   5.033
 *
 * So p5 to p95 is a ratio of **1.621**, against the 6.297 the same cylinder shows
 * as a diffuse surface and the 3.603 midground allows. Going metal does not merely
 * survive the band rule on a cylinder - it is the only mechanism available that
 * FIXES a measured failure, because it deletes the diffuse term and with it the
 * 6.297.
 *
 * What is left over is the budget for everything Schlick does not model:
 * `3.603 / 1.621 = 2.22x` for the variation in what the cylinder actually
 * reflects across its width. At roughness 0.30 the lobe is broad and three samples
 * a prefiltered mip, and a near-vertical member's reflection sweeps the horizon
 * azimuthally rather than from sky to ground, so 2.22x is the right shape of
 * budget - but it is NOT MEASURED, and it is the one number that decides this.
 *
 * The 5% above p95 runs to `F = 1` and lands out of band. It is a rim: at
 * `q > 0.95` on a strut 20.4 px wide it is 1.0 px, so it antialiases into the
 * silhouette rather than reading as a surface, which is precisely why section 8.1
 * tests p5-p95 and not the extremes. It cannot bloom either - the brightest
 * radiance this material can see is `1.5543 x 0.7 x 1.0 = 1.088` against a
 * threshold of 1.45.
 */
export function cylinderFresnelRatio(f0: number, qLo = 0.05, qHi = 0.95): number {
  const at = (q: number) => schlickF(f0, Math.cos(Math.asin(Math.min(1, q))))
  return at(qHi) / at(qLo)
}

/**
 * The smallest `f0` whose cylinder Fresnel ratio is at or under `ratio`.
 *
 * **A metal cylinder needs a LIGHT albedo to hold a DARK band, which reads as a
 * contradiction and is the most useful thing in this block.** For a metal the
 * albedo IS `f0`, and `f0` is the FLOOR of the rendered value while the
 * environment sets the scale. Dividing through, the ratio is
 * `1 + (1/f0 - 1) * (1 - cos(asin(qHi)))^5`, which grows without bound as the
 * colour darkens:
 *
 *   albedo          display luma   f0       cylinder ratio
 *   #202020         0.126          0.0119   10.63
 *   #3c465a         0.272          0.0597   3.42
 *   #6e7e9e         0.490          0.1987   1.62
 *   #ffffff         1.000          0.9520   1.01
 *
 * So the dress batch's own paint pass points the wrong way for a metal. Its
 * `frameSide` at `#6e7e9e` leaves 2.22x for the environment; its `frameTop` at
 * `#3c465a` spends 3.42 of the 3.603 available and leaves 1.05x, which is nothing.
 * Going metal therefore means abandoning the light-flanks-dark-crowns ramp, not
 * keeping it: the ramp exists to compensate for a diffuse facing response that a
 * metal does not have, and the darker of its two values is the one that breaks
 * the band.
 *
 * At the working threshold of 1.80 - half of midground's 3.603, leaving the other
 * half for the environment - the floor is `f0 = 0.161`, which is an albedo of
 * display luma 0.446. `#6e7e9e` at 0.490 clears it; nothing darker does.
 */
export function metalF0ForCylinderRatio(ratio: number, qHi = 0.95): number {
  const k = Math.pow(1 - Math.cos(Math.asin(Math.min(1, qHi))), 5)
  if (ratio <= 1) return 1
  return k / (ratio - 1 + k)
}

/**
 * Emissive brightness as a multiple of the bloom threshold.
 *
 * This is the single most useful thing in this file, and it exists because
 * `emissiveIntensity` is not a meaningful unit. three adds emission to outgoing
 * radiance as `emissive * emissiveIntensity`, and bloom masks on
 * `smoothstep(threshold, threshold + smoothing, luminance(rgb))` with Rec.709
 * luminance rather than on the peak channel. So the raw value bloom sees is
 *
 *     luma709(linear(colour)) * emissiveIntensity
 *
 * and "intensity 2" therefore means something completely different for cyan
 * (0.632 per unit) than for violet (0.220 per unit). That is why the palette
 * arrived at six emissives at six intensities of which none crossed the line.
 *
 * Inverting it gives a unit an artist can actually hold:
 *
 *     emissiveIntensity = glow * BLOOM_THRESHOLD / luma709(linear(colour))
 *
 * `glow: 1.0` sits exactly on the threshold for every hue. Above 1 blooms,
 * below 1 reads as a light source without blooming, and the number means the
 * same thing whatever colour it is applied to.
 *
 * The floor is mandatory rather than defensive. Normalising a dark hue asks it
 * to emit many times the brightest lit surface in the scene, and the tone
 * mapper renders that as white. A colour below `LOW_LUMA_FLOOR` needs a pale
 * near-white core sized to read at distance with a dimmer saturated shell
 * around it that does not itself bloom, which is how the reference builds its
 * LEDs and why they read as light sources rather than as bright plastic. That
 * is geometry, so this function cannot do it, and the honest failure is to
 * refuse rather than to quietly produce the blown-out white surface.
 */
export function emissiveIntensityFor(color: string, glow: number): number {
  const luma = linearLuma(color)
  if (luma < LOW_LUMA_FLOOR) {
    throw new Error(
      `materials: ${color} has linear luminance ${luma.toFixed(4)}, below the ${LOW_LUMA_FLOOR} ` +
        `floor, so normalising it would need emissiveIntensity ` +
        `${(BLOOM_THRESHOLD / luma).toFixed(1)} to reach the bloom threshold and would render as ` +
        `blown-out white. Use a pale near-white core with a dimmer saturated halo around it, ` +
        `with emissiveRaw() for the halo. See docs/design/00-art-bible.md section 1.`,
    )
  }
  return (glow * BLOOM_THRESHOLD) / luma
}

/**
 * The three brightness tiers, from the materials spec's section 8.2.
 *
 * Call sites should reach for one of these rather than inventing a number, so
 * that "this is feedback" and "this is scenery that happens to be lit" stay
 * distinguishable across the whole world.
 */
export const GLOW = {
  /**
   * Tier A, must bloom. 1.25x the threshold, and the headroom is the point:
   * `luminanceSmoothing` means the contribution ramps rather than switching, so
   * a value sitting exactly on the line contributes almost nothing.
   *
   * The tier A set is deliberately tiny. Blue means ally and gold means reward,
   * and nothing in the environment is allowed in, which is what keeps bloom
   * reading as feedback rather than as weather.
   */
  bloom: 1.25,
  /**
   * Tier B, must read as a light source but must not bloom. 66% of threshold.
   * This is where most of the world's glow lives.
   */
  source: 0.66,
  /**
   * Tier C, colour hold. Emissive used only so a surface does not go dead in
   * shadow, never as light. 0.09 puts the raw luminance at 0.157, inside the
   * spec's 0.10 to 0.25 band and an order of magnitude under the threshold.
   */
  hold: 0.09,
} as const

/** The map set produced by `usePbrTextures`. */
type PbrMaps = {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
  aoMap: Texture
}

/**
 * Material presets that produce the toy look.
 *
 * The single most important property here is `clearcoat`. It adds a thin
 * reflective layer over the base colour, which is exactly what separates
 * injection-moulded plastic from flat matte shading. Without it, everything
 * reads as untextured programmer art no matter how good the palette is.
 *
 * These are prop objects rather than shared material instances on purpose.
 * Spreading them into JSX keeps scenes declarative, and three.js already shares
 * compiled shader programs between materials with identical configuration, so
 * the cost is a little memory rather than a shader recompile per mesh.
 */

/**
 * Glossy moulded plastic. The default for almost everything in the world.
 *
 * Rebuilt to the two rules in the art bible's section 5, both of which this
 * preset was breaking and which the bible names it for.
 *
 * `0.35 / 0.25` is a lobe ratio of 1.96 where 8 is needed, so the body lobe and
 * the coat lobe sat almost on top of each other and resolved as one broad
 * specular wash. That is the "one specular wash and no second lobe" the critique
 * measured on the hero, and it is why every manufactured surface reads as the
 * same material regardless of what colour it is. `0.45 / 0.15` is a ratio of
 * 9.0: a soft, wide body highlight with a tight bright coat highlight sitting
 * inside it, which is what moulded ABS actually looks like.
 *
 * The base roughness rises rather than the coat roughness falling further,
 * because 0.15 is where the lighting budget's own headroom arithmetic already
 * assumed this preset was - "GGX D peaks near 629 at clearcoatRoughness 0.15" is
 * written into `Lighting.tsx` and was computed against a value this file did not
 * have. Now it does.
 *
 * And `clearcoat: 1` goes to 0.85, the bible's ceiling. A coat at 1.0 owns the
 * surface completely at grazing angles, which both erases the body lobe at the
 * silhouette and pushes raw HDR toward the environment's peak radiance along
 * every edge. That is one of the two mechanisms behind the clipped, spilling
 * dome highlight in `hub-backlit`; the other is the highlight strip's stale
 * intensity, fixed in `Lighting.tsx`.
 */
export function plastic(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.45,
    metalness: 0,
    clearcoat: MAX_CLEARCOAT,
    // 0.45^2 / 0.15^2 = 9.0, past the ratio of 8.
    clearcoatRoughness: 0.15,
    ...overrides,
  }
}

/**
 * Softer, chalkier plastic for large surfaces that would otherwise be too shiny.
 *
 * Same rule, same fix: `0.75 / 0.60` is a ratio of 1.56. The coat comes down to
 * 0.26 for a ratio of 8.3. The clearcoat weight is unchanged at 0.4, which is
 * what keeps this reading as matte - a chalky body with a faint crisp skin is a
 * different material from a chalky body with a faint chalky skin, and only the
 * first one is moulded.
 */
export function mattePlastic(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.75,
    metalness: 0,
    clearcoat: 0.4,
    // 0.75^2 / 0.26^2 = 8.3.
    clearcoatRoughness: 0.26,
    ...overrides,
  }
}

/** Rubbery, grippy surfaces such as feet and bumpers. No clearcoat at all. */
export function rubber(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.95,
    metalness: 0,
    clearcoat: 0,
    ...overrides,
  }
}

/**
 * Brushed metal for joints and hardware. Kept low-key so it never steals focus.
 *
 * **One correction, and it is a bug rather than a tuning change.** This preset
 * set `clearcoat: 0.3` and never set `clearcoatRoughness`, so it inherited
 * three's default of ZERO: a perfect mirror coat over brushed metal, on the
 * robot's shoulder and hip joints, which are curved. The bible's section 8.4
 * floors clearcoat roughness at 0.10 on curved surfaces for a stated reason -
 * "the highlight has to spread across several pixels so it reads as a highlight
 * rather than as a firefly" - and a delta light on a mirror coat produces
 * exactly the sub-pixel pinpoint that floor exists to prevent, which pops in and
 * out between frames as the character walks.
 *
 * It survived the two-lobe sweep in `materials.test.ts` because that test read
 * a missing `clearcoatRoughness` as 0 and `lobeRatio(0.4, 0)` is Infinity, so
 * the rule passed vacuously on the one preset that was breaking it. The test now
 * requires any preset with a coat to declare the coat's roughness.
 *
 * 0.10 rather than `anodised()`'s full rebuild, because this preset's four call
 * sites are in `Portal.tsx` and `robotParts.tsx` and belong to other hands this
 * pass. Removing a firefly is a correction in one direction only; changing the
 * body roughness and metalness with it would be a look change made on their
 * behalf. See `anodised()` for the preset the spec wants these call sites moved
 * to.
 */
export function metal(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.4,
    metalness: 0.9,
    clearcoat: 0.3,
    clearcoatRoughness: 0.1,
    ...overrides,
  }
}

/**
 * Anything that should look powered: the visor, circuit traces, crystals.
 *
 * `glow` is a multiple of the bloom threshold, not an `emissiveIntensity`.
 * 1.0 sits exactly on the line, `GLOW.bloom` is over it, `GLOW.source` reads as
 * a light source without blooming. See `emissiveIntensityFor` for the
 * derivation and for why the old flat `intensity` argument could not work.
 *
 * The second argument changed meaning rather than changing name, which is a
 * decision worth defending. A rename would have left both units in the codebase
 * during the transition, and the two are indistinguishable at a call site: both
 * are a bare number somewhere between 0.5 and 4. Changing the meaning breaks
 * every caller at once, which is the only way to be sure none of them was
 * missed, and every one of them was reviewed as it moved.
 *
 * Colours below `LOW_LUMA_FLOOR` throw here. They need `emissiveRaw` plus a
 * pale core, and the throw is what stops that decision being deferred by
 * accident.
 */
export function emissive(
  color: string,
  glow: number = GLOW.source,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    emissive: color,
    emissiveIntensity: emissiveIntensityFor(color, glow),
    roughness: 0.3,
    metalness: 0,
    // 0.85 rather than 1, per the bible's ceiling. The ratio was already 9.0.
    clearcoat: MAX_CLEARCOAT,
    clearcoatRoughness: 0.1,
    ...overrides,
  }
}

/**
 * The same preset with an absolute `emissiveIntensity` and no normalisation.
 *
 * Two legitimate uses, and they are the same case seen from both ends.
 *
 * The coloured halo around a pale core. A violet or magenta element that must
 * read as a light source is built as a near-white core that blooms and a
 * saturated shell that deliberately does not, and the shell's brightness is
 * chosen against the core rather than against the threshold. Normalising it
 * would be exactly wrong: it is meant to stay under the line.
 *
 * And the transitional case, which is what most of its call sites are today. A
 * colour below `LOW_LUMA_FLOOR` cannot be normalised and its pale core does not
 * exist yet, because adding one is a geometry change. Holding the current
 * absolute intensity keeps those objects looking exactly as they do now instead
 * of guessing at a number that will be replaced anyway.
 */
export function emissiveRaw(
  color: string,
  intensity: number,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0,
    clearcoat: MAX_CLEARCOAT,
    clearcoatRoughness: 0.1,
    ...overrides,
  }
}

/**
 * Textured stone, for the portal platform, ramp, arch and totem plinths.
 *
 * The albedo is tinted by `color` rather than used raw. That is the decision
 * that keeps this in the same world as everything else: a photographic grey
 * rock dropped next to flat-shaded plastic reads as an asset from a different
 * game, whereas the same photograph multiplied by `palette.rock` reads as
 * detail added to a surface that was already there.
 *
 * Clearcoat is kept far below the plastic presets but not removed. Stone is not
 * glossy, but a trace of it keeps the material sitting in the same lighting
 * response as its neighbours instead of going conspicuously dead.
 *
 * Pass maps from `usePbrTextures('stone', ...)`, which owns the tiling density.
 */
export function stone(
  color: string,
  maps: PbrMaps,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    ...maps,
    // Overridden by roughnessMap per texel; this is the multiplier against it.
    roughness: 1,
    metalness: 0,
    normalScale: new Vector2(1, 1),
    /*
      Occlusion from the map is pushed past 1. Baked AO in a tiling texture is
      averaged over every direction a surface could face, so at its authored
      strength it reads as a faint smudge once real lighting is on top of it.
      Overdriving it is what makes the crevices read as depth rather than as
      dirt, and it costs nothing.
    */
    aoMapIntensity: 1.35,
    clearcoat: 0.15,
    clearcoatRoughness: 0.8,
    ...overrides,
  }
}

/**
 * Terrain: the island's grass and the dirt at its rim.
 *
 * Separate from `stone` because ground is read almost entirely at a grazing
 * angle, and that changes what matters. No clearcoat at all, since a specular
 * sheen across a whole field reads as wet plastic. Stronger normals, because
 * relief is the only thing giving a flat plane any form once the camera is
 * low. And occlusion pushed harder still, since it is doing the work of the
 * shadowing between blades that the geometry cannot afford to model.
 */
export function ground(
  color: string,
  maps: PbrMaps,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    ...maps,
    roughness: 1,
    metalness: 0,
    normalScale: new Vector2(1.4, 1.4),
    aoMapIntensity: 1.5,
    clearcoat: 0,
    ...overrides,
  }
}

/**
 * Translucent plastic, for token crystals and portal fills.
 * `transmission` is expensive, so this is used sparingly and never on the hub floor.
 */
export function gel(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.1,
    metalness: 0,
    // The bible's ceiling applies here too, even though this preset is on its
    // way out: a rule with a carve-out for a transmissive surface at a grazing
    // angle has a carve-out for the exact case it exists to prevent.
    clearcoat: MAX_CLEARCOAT,
    clearcoatRoughness: 0.1,
    transmission: 0.6,
    thickness: 0.5,
    transparent: true,
    opacity: 0.85,
    ...overrides,
  }
}

/* ---------------------------------------------------------------------------
   The presets the materials spec adds, appended rather than substituted.

   None of these has a call site yet, deliberately. Swapping the world over to
   them is a look change per object and belongs with the geometry work that goes
   with it: a `visorPlate()` behind a visor bar that is not there yet is not a
   material decision, it is a modelling one. Landing the presets first means the
   stream that does that work is choosing where they go rather than also
   arguing about what they are.

   Two rules from the spec run through the whole set and are worth stating once
   rather than repeating on every entry.

   The two-lobe rule. Moulded plastic is a slightly diffuse body under a smooth
   surface skin, and the eye reads that as two separate specular lobes: a broad
   soft one from the body and a tight bright one from the coat. GGX lobe width
   goes as roughness squared, so the separation that matters is
   `baseRoughness^2 / clearcoatRoughness^2`, and it must be at least 8 for the
   two to resolve as two highlights rather than as one slightly odd one. A
   factor of two, which is what `plastic()` currently has, resolves as one.

   The bloom-safety rule. `clearcoat` never exceeds 0.85. At 1.0 the coat's
   Fresnel term owns the surface completely at grazing angles, which erases the
   body lobe at exactly the silhouette where form is read and drives raw HDR
   toward the environment's radiance along every edge in frame. Bloom runs
   before tone mapping, so silhouette edges are the likeliest place for unwanted
   bloom to appear.
   --------------------------------------------------------------------------- */

/** White, mixed toward each preset's base colour to derive a sheen tint. */
const WHITE = /*@__PURE__*/ new Color('#ffffff')

/**
 * Sheen colour as the base colour lifted toward white.
 *
 * The reference's rule is that a sheen tint is always lighter than the base it
 * sits on, which is what makes it read as light scattering out of the surface
 * rather than as a second coloured highlight. Note that three's `sheenColor`
 * defaults to black, so setting `sheen` without also setting `sheenColor` does
 * precisely nothing, which is the quiet way this feature fails.
 */
function sheenTint(color: string, toWhite: number): Color {
  return new Color(color).lerp(WHITE, toWhite)
}

/**
 * The hero shell. The robot's torso, head and hand props, and nothing else.
 *
 * Keeping this to one caller is what protects the value-band separation the
 * whole art direction rests on: the character is a value anomaly, the brightest
 * and least saturated thing in frame, and that separation is destroyed the
 * moment anything in the world is given the same white.
 *
 * It is the only preset with a non-zero emissive floor. `#ffb489` has a linear
 * luminance of 0.5571, so at 0.08 this adds 0.0446 of luminance uniformly and
 * warm-tinted. That is a floor rather than a glow: it is 2.5% of the bloom
 * threshold, and it is what guarantees the shadow side of white plastic stays
 * chromatic and never crushes, independently of whether the lighting rig is
 * dialled in. The reference's diagnostic is that the darkest pixel on a white
 * shell is rarely below 28 to 35% luminance and is never neutral.
 *
 * The sheen is a deliberate cheat. three's Charlie distribution is a
 * retro-reflective lobe peaking at grazing angles, which is geometrically where
 * subsurface scattering shows up on a thin plastic edge, so a warm sheen at a
 * low amount reads convincingly as light coming through the rim of the shell
 * without any of transmission's cost. Callers on a tier with `sheenHero` false
 * must override `sheen: 0` at construction time rather than mutating it
 * afterwards, because `MeshPhysicalMaterial` bumps its version when sheen
 * crosses zero and that forces a recompile.
 */
export function shell(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.8,
    // 0.32^2 / 0.10^2 = 10.2, comfortably past the ratio of 8.
    clearcoatRoughness: 0.1,
    sheen: 0.3,
    sheenRoughness: 0.55,
    sheenColor: '#ffb489',
    // The one surface that should read the Lightformer rig more strongly than
    // its neighbours, because ambient arriving through an environment map is
    // chromatic by construction where a hemisphere light is chromatic in only
    // two directions.
    envMapIntensity: 1.15,
    emissive: '#ffb489',
    emissiveIntensity: 0.08,
    ...overrides,
  }
}

/**
 * Soft PVC, and this project's answer to fabric.
 *
 * The reference's deepest rule is that when Team ASOBI needed hair or cloth
 * they replaced it with vinyl, because a real cloth simulation in a world of
 * moulded parts reads as an asset from a different game. The cape is the only
 * soft good here and it is currently a zero-thickness plane in chalky ABS,
 * which is the exact thing that rule exists to prevent.
 */
export function vinyl(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.55,
    // 0.50^2 / 0.16^2 = 9.8.
    clearcoatRoughness: 0.16,
    sheen: 0.25,
    sheenRoughness: 0.65,
    sheenColor: sheenTint(color, 0.25),
    envMapIntensity: 0.8,
    ...overrides,
  }
}

/**
 * Flocked felt: moulded moss, clover, and anything meant to read as fuzzy.
 *
 * This is the sheen showpiece and the preset that stops ground cover reading as
 * green plastic. No clearcoat at all, because flock has no skin; the entire
 * material read is the retro-reflective sheen lobe at grazing angles, which is
 * exactly what fuzz does to light.
 */
export function flock(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.9,
    metalness: 0,
    clearcoat: 0,
    sheen: 1,
    sheenRoughness: 0.85,
    sheenColor: sheenTint(color, 0.35),
    envMapIntensity: 0.3,
    ...overrides,
  }
}

/**
 * Polished chrome. Takes no colour, because chrome is white by definition.
 *
 * The reference calls chrome the reflection showpiece and says to give it the
 * best environment map available. There is nothing chrome in the world yet and
 * there should be: one small element on the robot, a collar ring or a visor
 * bezel, is the cheapest possible demonstration that the environment map
 * exists. It is also the fastest way to spot a broken `Lightformer` rig,
 * because chrome shows the rig literally rather than as a hint.
 *
 * No clearcoat. A clear coat over a mirror is a second Fresnel term over a
 * surface that is already entirely Fresnel, which costs a full GGX evaluation
 * to change nothing anyone can see.
 */
export function chrome(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color: '#ffffff',
    roughness: 0.06,
    metalness: 1,
    clearcoat: 0,
    envMapIntensity: 1,
    ...overrides,
  }
}

/**
 * Anodised aluminium hardware, and the missing half of the metal vocabulary.
 *
 * Specified in `02-materials.md` section 1.2 at `0.30 / metal 0.95 / cc 0.15 /
 * ccR 0.10`, ratio 9.0, and it did not exist. `metal()` above is the preset it
 * is meant to REPLACE - section 2 says "renamed from `metal()`, with `metal`
 * kept as a deprecated alias for one release" - and the rename is deliberately
 * not done here, because `metal()`'s four call sites are in `Portal.tsx` and
 * `robotParts.tsx`, both owned by other hands this pass. Changing `0.4 / 0.9 /
 * cc 0.3` into `0.30 / 0.95 / cc 0.15` under them would be a look change to the
 * robot's joints arriving in a commit about deck surfacing.
 *
 * The coat is the interesting part and it is physical rather than stylistic.
 * `metal()`'s `clearcoat: 0.3` over `roughness: 0.4` is a lobe ratio of 1.8:
 * two broad highlights on top of each other, which is the same defect
 * `plastic()` was rebuilt to fix. Anodising is an oxide film grown on the metal
 * and usually lacquered over, so the correct read is a thin hard skin over a
 * satin body - a 0.15 coat at 0.10 roughness, ratio 9.0.
 *
 * **THE FINDING, and it is why this preset ships with no call site.**
 *
 * A metal cannot carry a value band, so no broad surface in this world can be
 * metal, and that is arithmetic rather than taste.
 *
 * A metal has no diffuse term. Its rendered value is `F(theta) x environment`,
 * and Schlick's Fresnel runs `F = F0 + (1 - F0)(1 - cos theta)^5` with `F0` the
 * albedo. So one flat metal face sweeps its own value as the camera turns, from
 * `F0 x env` at normal incidence to `env` at the silhouette. Worked for a kerb
 * at `palette.bandTrim`, whose linear luminance is 0.089:
 *
 *   view angle from the face normal   F        rendered display luma
 *   0 degrees                         0.089    ~0.20
 *   65 degrees, the camera's usual    0.149    ~0.30
 *   80 degrees                        0.44     ~0.55
 *   85 degrees                        0.66     ~0.68
 *
 * That is a p5-to-p95 near 0.5 on one object in one lighting condition, in a
 * band 0.18 wide, and `00-art-bible.md` section 8.1 rules it out in as many
 * words: band membership is judged on the spread, and a surface whose spread
 * crosses bands is illegible. Turning `metalness` up on the kerbs - the only
 * broad surface this stream owns the material binding for - would have taken
 * the single strongest readability device in the level, the dark line that
 * outlines every platform, and made its value a function of camera yaw.
 *
 * So `chrome()` having zero call sites after two rounds is not an oversight,
 * it is a consequence, and the same consequence applies here. The correct call
 * sites are elements too small to be measured as a surface at all, where a
 * sweeping glint is the entire point and no band claim is being made: a collar
 * ring or a visor bezel on the robot, a pylon cap disc, or a narrow reveal
 * inset into a deck edge. All of those are geometry in another stream's files.
 *
 * ## AMENDED: the finding holds for a FLAT face and inverts for a CURVED one
 *
 * Everything above is correct about a flat kerb and wrong as a general rule, and
 * the error is in the last paragraph rather than in the arithmetic. It concludes
 * that the legitimate call sites are elements "too small to be measured as a
 * surface at all" - a size argument, offered on taste. The size is not what
 * matters. `cylinderFresnelRatio` works out what does:
 *
 *   surface                      p95/p5 linear ratio   midground allows 3.603
 *   metal FLAT face, as above     12.7                 no
 *   DIFFUSE cylinder, measured     6.297               no
 *   METAL cylinder, Schlick        1.621               yes, 2.22x to spare
 *
 * The 12.7 is this note's own table read in linear light: display 0.20 head-on to
 * 0.68 at 85 degrees is a factor of 12.7, which is what "a spread near 0.5" means
 * once it is stated in the space the renderer multiplies in.
 *
 * A metal cylinder is more band-compliant than a diffuse one, by a factor of
 * 3.9. Screen-x across a cylinder is uniform in `sin(phi)` while Schlick is flat
 * until 66 degrees, so the whole Fresnel rise is squeezed into the outer tenth of
 * the width; and deleting the diffuse term deletes the 6.297, which no albedo can
 * reduce because the albedo cancels.
 *
 * **So the first legitimate call site is the hub's dress batch**, whose members
 * are four Core struts, eight pylon masts and the overhead arcs - every one a
 * capsule or a tube, not one broad flat face among them, all four measured at
 * `inOneBand: false` today. That is not a small surface. It is the largest
 * cylindrical surface in the game, and it is the case this preset was written for
 * without knowing it.
 *
 * Two conditions come with it, both computed and neither optional. The albedo must
 * have display luma at or above 0.446 or `f0` is too dark to hold the ratio - see
 * `metalF0ForCylinderRatio`, and note this means abandoning the batch's
 * dark-crowns ramp rather than keeping it. And the up-facing pucks in the batch,
 * the pylon caps and the Core collar top, ARE flat faces and keep the original
 * finding: they are the residual risk, they are roughly 12 px deep at the
 * establishing framing, and if they read wrong the fix is to paint them LIGHTER,
 * which is the opposite of what the batch does now.
 *
 * `anisotropy` is off by default and gated, per section 10: it adds
 * `USE_ANISOTROPY` and a real block of fragment work for an effect only visible
 * on parts smaller than the robot's antenna, and `quality.anisotropy` is false
 * at every tier today. Pass `{ anisotropy: ANODISED_ANISOTROPY }` at a high
 * tier. It must be passed at CONSTRUCTION, never assigned afterwards: three
 * bumps the material version when `anisotropy` crosses zero and that forces a
 * recompile mid-frame.
 *
 * `envMapIntensity` 1.00 passes the specular budget with room. The brightest
 * `Lightformer` in the hub rig is the highlight strip at 1.5543 and
 * `HUB_ENV.intensity` scales the whole map by 0.7, so the radiance this material
 * can actually see is `1.5543 x 0.7 x 1.00 = 1.088`, against a budget of 1.60
 * and a bloom threshold of 1.45. Note that the budget as written in the bible
 * omits `environmentIntensity`, which makes every figure computed from it 30 per
 * cent pessimistic.
 */
export const ANODISED_ANISOTROPY = 0.45

export function anodised(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.3,
    metalness: 0.95,
    clearcoat: 0.15,
    // 0.30^2 / 0.10^2 = 9.0, past the ratio of 8.
    clearcoatRoughness: 0.1,
    envMapIntensity: 1,
    ...overrides,
  }
}

/**
 * Cast acrylic, and the replacement for every current use of `gel()` except
 * real glass.
 *
 * `transmission` costs an extra render target pass, and the reference warns in
 * as many words that it makes a white character look like a gummy bear. There
 * are thirteen token crystal cones plus a concept node per lesson totem
 * currently paying for it in order to look like coloured plastic. This gets the
 * same read from clearcoat, a tier-B emissive and plain alpha.
 *
 * `glow` is in threshold multiples, exactly as in `emissive()`, and defaults to
 * zero so the preset is usable as plain acrylic.
 */
export function crystal(
  color: string,
  glow = 0,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.85,
    // A deliberate exception to the ratio rule at 5.4: the base lobe is not
    // meant to be visible at all here, so there is effectively one lobe by
    // design and the surface reads as a solid transparent body rather than as a
    // coated opaque one.
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.2,
    transparent: true,
    opacity: 0.92,
    ...(glow > 0
      ? { emissive: color, emissiveIntensity: emissiveIntensityFor(color, glow) }
      : {}),
    ...overrides,
  }
}

/**
 * The near-black glossy plate a visor sits inside.
 *
 * The reference describes the eye treatment as emissive geometry behind a
 * glossy dark visor at roughness around 0.1, and calls it the thing carrying
 * more identity than anything else on the character. The robot currently has
 * the emissive bar and no plate behind it, so the visor is a glowing rectangle
 * floating on white rather than a lit element inside a dark window.
 *
 * A face plate is flat, which is the one case where a clearcoat roughness below
 * 0.10 is allowed: on a flat surface the highlight is a shaped reflection of
 * the environment rather than the sub-pixel pinpoint a delta light produces on
 * a curved one. The ratio here is 31, the highest in the file, and that is the
 * intent rather than an accident.
 */
export function visorPlate(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color: '#12161c',
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.05,
    // The highest in the file, because this is the surface that shows off the
    // environment rig, and because a dark plate has nothing else to show.
    envMapIntensity: 1.3,
    ...overrides,
  }
}

/**
 * A flat glowing line lying on a surface. Not a physical material at all.
 *
 * The ground circuit traces currently pay for a full `meshPhysicalMaterial`
 * with clearcoat in order to draw a translucent glowing line on the floor,
 * where every lit term is either invisible or actively unwanted: the traces are
 * flat to the ground, so there is no form to shade and no silhouette to catch a
 * highlight.
 *
 * Because bloom runs before tone mapping, a basic material whose colour is
 * above the threshold blooms exactly like an emissive one. So the colour is
 * pre-multiplied here, in linear space, by the same normalisation `emissive()`
 * uses, and `glow` means the same thing it means everywhere else in this file.
 *
 * `AdditiveBlending` with `depthWrite: false` is correct for an energy effect
 * and is also the reason the art bible bans additive dust: a dense cluster of
 * individually dim additive quads sums past the threshold and produces a white
 * blob. One flat line does not stack with itself.
 */
export function glowStrip(color: string, glow: number = GLOW.source): MeshBasicMaterialProps {
  return {
    // multiplyScalar runs on the linear components, after three's colour
    // management has decoded the hex, which is the space the threshold is
    // compared in.
    color: new Color(color).multiplyScalar(emissiveIntensityFor(color, glow)),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }
}

/**
 * The inlay's metalness, and the one number in this file that is knowingly not
 * physical.
 *
 * ## What was measured, and why metalness 1 did not deliver the brief
 *
 * The brief is a highly reflective steel. Shipped at `metalness: 1` it rendered
 * at display **0.423**, `rgb(83, 112, 137)`, on the junction pool at
 * `hub-establishing` - a dark navy sheet, and 0.264 DARKER than the deck it is
 * set into rather than brighter as the table below predicts.
 *
 * The table is not wrong, the geometry of the reflection is. A metal has no
 * diffuse term, so its value is entirely what it reflects, and what an UP-FACING
 * sheet reflects toward a camera at this depression angle is the environment at
 * roughly the same elevation on the opposite bearing. This rig's environment
 * there is the ambient floor card at `#243a52` and the negative fill at
 * `#0b0f1a`. The bright cards - the key softbox and the highlight strip - are
 * overhead, which is where a mirror sends a camera looking from LOW down, and
 * this camera looks from high up.
 *
 * A roughness sweep does not fix it: raising roughness widens the lobe toward
 * the environment's average, and this environment's average is dark. It is the
 * same finding `anodised()` records from the other side, restated for a
 * horizontal surface instead of a vertical one, and its conclusion applies
 * unchanged: **making a pure metal read here is a light-rig change and not a
 * material one.**
 *
 * ## Why the light rig is not what moved
 *
 * The physical fix is one more Lightformer, at the elevation band a horizontal
 * surface reflects toward this camera, bright enough to put the inlay above the
 * deck. That is the right fix and it is not this commit's to make. It would
 * raise ambient on every surface in the hub, it lands in the middle of the
 * de-axialising change round 4 is explicitly holding `Lighting.tsx` still for
 * (handoff item 3), and it would arrive inside a change about materials where
 * nobody would attribute it. It is written down here so the next round can make
 * it deliberately.
 *
 * ## What moved instead, stated plainly
 *
 * 0.68 rather than 1. Below 1 the material regains a diffuse lobe from its own
 * albedo, lit by the key rather than by the reflection, and that term is what
 * puts the value where the brief wants it while the remaining 68% of metal keeps
 * the sharp mirror streak that makes it read as polished rather than painted.
 *
 * A mixed metalness is not physical: a surface is a conductor or it is not. What
 * makes it defensible here rather than merely convenient is `00-art-bible.md`'s
 * own rule about where stylisation is allowed to live - "the stylisation lives
 * entirely in the INPUTS, never in the BRDF". `metalness` is an input to an
 * unmodified GGX; nothing about the shading model changes. It is the same class
 * of decision as an albedo chosen for a value band rather than for a real
 * material, which this project makes everywhere.
 *
 * The honest cost, so it is not discovered later: at 0.68 the inlay's reflection
 * of a bright card is 32% weaker than a mirror's, so the streak is dimmer than
 * true steel, and the surface picks up a shading gradient from the key that a
 * real mirror would not have. Both are visible on close inspection and neither
 * is visible at the distance this surface is played at.
 */
export const STEEL_METALNESS = 0.68

/**
 * Polished steel, for the inlay that replaced the water.
 *
 * ## Why a metal here is legal when `anodised()`'s finding rules it out elsewhere
 *
 * The finding above is that a metal cannot carry a value band, because a metal
 * has no diffuse term and its rendered value is `F(theta) x environment`, which
 * sweeps as the camera turns. That argument is about a surface whose normal
 * varies across the frame or across the camera's orbit - a flat kerb face, a
 * vertical cylinder.
 *
 * The inlay is neither. Every piece of it - four spur channels, the trunk, the
 * junction pool, the threshold pad - is an essentially UP-FACING sheet lying in
 * a recess in the deck, so what it reflects is the overhead half of the rig and
 * almost nothing else, at a view angle set by the fixed camera pitch rather than
 * by yaw. The whole batch presents one narrow run of normals. That is the case
 * the anodised finding does not cover, and it is the reason chrome and steel
 * have always been permitted on "elements too small to be measured as a surface"
 * and on reveals inset into a deck edge, which is what this is.
 *
 * ## The numbers, and the two ceilings they clear
 *
 * `envMapIntensity` is written here for documentation only and DOES NOT RUN in
 * the hub. `WebGLRenderer` overwrites it from `scene.environmentIntensity` for
 * any material with a null `envMap`, and nothing in this project sets one - see
 * `HUB_ENV.intensity` in `Lighting.tsx`, which is 0.70. So the environment this
 * steel sees is the hub's Lightformer rig scaled by 0.70, and the two cards it
 * can actually see from an up-facing sheet are the key softbox at a radiance of
 * `1.36 x 0.70 = 0.952` and the highlight strip at `1.5543 x 0.70 = 1.088`.
 *
 *   what it reflects             F       linear luminance   display luma
 *   key softbox, head on         0.6015  0.5726             0.7813
 *   key softbox, grazing         1.0000  0.9520             0.9786
 *   highlight strip, head on     0.6015  0.6544             0.8292
 *   highlight strip, grazing     1.0000  1.0880             1.0000, clipped
 *
 * So the bloom ceiling is clear with room: 1.088 against a measured threshold of
 * 1.45, the same 1.33x margin the strip itself carries, and no reachable
 * configuration blooms. What it does NOT clear is the deck, which renders at
 * 0.687 - the inlay is brighter than the surface it is set into, everywhere.
 * That is deliberate here and it is the point of the brief, but it is the exact
 * shape of handoff item 5 ("decoration still out-values the ground") and it has
 * to be judged on a frame rather than argued in a comment.
 *
 * `roughness` 0.15 rather than `chrome()`'s 0.06, and it is the one lever that
 * changes the above. A mirror hands back the Lightformer's own edges as a hard
 * rectangle lying in the floor; 0.15 spreads the same energy over a lobe wide
 * enough to read as a sheet of metal with a highlight on it. Raise it toward
 * 0.25 if the inlay reads as a cut-out of the sky, lower it toward 0.10 if it
 * reads as grey paint.
 *
 * No clearcoat, for `chrome()`'s reason: a clear coat over a mirror is a second
 * Fresnel term over a surface that is already entirely Fresnel.
 */
export function steel(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    /*
      A cool steel rather than a neutral one. `#c6ccd8` linearises to a luminance
      of 0.6015, which is the `F0` the reflectance table above is computed from,
      and its slight blue puts it inside the blues-silvers-greys the design
      direction asks for instead of on the warm side of neutral. At `metalness`
      below 1 it is also the DIFFUSE albedo, which is the term that carries the
      value - see `STEEL_METALNESS`.
    */
    color: '#c6ccd8',
    roughness: 0.15,
    metalness: STEEL_METALNESS,
    clearcoat: 0,
    envMapIntensity: 1,
    ...overrides,
  }
}

/**
 * Moulded masonry: the brick the deck and the pylons are made of.
 *
 * Distinct from `stone()`, which it is intended to replace at every hub call
 * site, on three counts and each of them was asked for by name.
 *
 * **No clearcoat at all.** `stone()` keeps 0.15 so that stone "sits in the same
 * lighting response as its neighbours instead of going conspicuously dead", and
 * that is the opposite of the brief here: the platform is to be highly matte and
 * to reflect nothing of the environment. A coat is a mirror lobe, and 15% of a
 * mirror lobe on a twelve-metre floor is precisely the sheet of shine being
 * removed. Dropping it also takes this preset out of the two-lobe rule entirely,
 * which is why it is not on the exemption list: it has no second lobe to
 * separate.
 *
 * **`specularIntensity` rather than `envMapIntensity`, and that distinction is
 * the whole reason this preset can do what was asked.** The obvious way to stop
 * a surface reflecting its environment is to turn `envMapIntensity` down, and in
 * this project that lever DOES NOT EXIST - the renderer overwrites it from
 * `scene.environmentIntensity`, see `steel()` above. It would also be the wrong
 * lever if it worked, because the environment map delivers this material's
 * diffuse irradiance as well as its specular reflection, and cutting both would
 * simply make the deck darker rather than matte. `specularIntensity` scales the
 * dielectric specular lobe ONLY, leaving diffuse untouched: the deck keeps its
 * measured 0.687 and loses the sheen. 0.25 rather than 0 because a stone with
 * literally no specular response reads as printed paper, and because grazing
 * Fresnel is what tells the eye a floor is a solid rather than a hole.
 *
 * **Roughness 0.95 and normals at 1.8.** Relief is the only channel a stone has
 * once its gloss is gone, and the measurement on record says relief does almost
 * nothing on an up-facing surface under a key 42.7 degrees overhead - a deck's
 * p5-p95 moved 0.0387 to 0.039 when the generated maps were switched on. That is
 * why `brickTexture.ts` carries an ALBEDO map as well, and why this preset is
 * only half of the answer. Bind both.
 */
export function masonry(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    roughness: 0.95,
    metalness: 0,
    clearcoat: 0,
    specularIntensity: 0.25,
    normalScale: new Vector2(1.8, 1.8),
    aoMapIntensity: 1.35,
    ...overrides,
  }
}
