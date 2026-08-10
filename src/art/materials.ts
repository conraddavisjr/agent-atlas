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

/** Brushed metal for joints and hardware. Kept low-key so it never steals focus. */
export function metal(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.4,
    metalness: 0.9,
    clearcoat: 0.3,
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
