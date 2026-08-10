/**
 * Quality tiers.
 *
 * Built before the art rather than retrofitted onto it, because a tier system
 * added afterwards only ever expresses the settings someone remembered to make
 * configurable. Every expensive decision in the renderer reads from here.
 *
 * It also serves as the pressure valve for this whole art pass: anything that
 * turns out to cost more than it is worth can be demoted to the high tier
 * rather than reverted.
 */

export type QualityTier = 'low' | 'medium' | 'high'

/**
 * How to read the values in this table, and the rule the art overhaul adds to it.
 *
 * Most of the fields below the existing block are gates for systems that do not
 * exist yet: the rim light, the contact blob, the LUT, depth of field, the VFX
 * pool, foot IK, generated surface maps. They are declared here first, all
 * inert, so that every stream builds against one frozen shape rather than each
 * adding its own field and colliding in the same twelve lines.
 *
 * The rule, and it is the art bible's section 7 rollout discipline applied to a
 * settings table:
 *
 *   A gate for a system that does not exist yet is FALSE (or zero) at every
 *   tier, no matter what its spec says, and the spec's ladder is written into
 *   its comment. A dial that existing code already reads keeps the value the
 *   code uses today, so moving the number into this table is provably not a
 *   look change.
 *
 * That means turning a system on is a one-line diff in this file, made by the
 * commit that also lands that system's acceptance shot, which is exactly what
 * "one effect per commit" requires. It also means nothing here can change the
 * image on its own, which is why this table could land before any of the work
 * it configures.
 */
export type QualitySettings = {
  /** Blades in the instanced grass field. */
  grassBlades: number
  /**
   * Daisies in the flower field.
   *
   * Each one is far more geometry than a blade of grass and each one casts a
   * shadow, so this is the most expensive number in the file despite being the
   * smaller of the two counts.
   */
  flowers: number
  /**
   * Whether grass is drawn a second time into the shadow map.
   *
   * Receiving shadows is cheap and is what puts the arch and the robot onto the
   * field. Casting means pushing six figures of instances through the depth
   * pass as well, and it is the most expensive single setting in the game.
   */
  grassCastShadow: boolean
  /** How far out grass is scattered, in metres. The island is radius 16. */
  grassRadius: number
  shadowMapSize: number
  /** Percentage-closer soft shadows. Costs a real amount of fragment work. */
  softShadows: boolean
  ambientOcclusion: boolean
  /**
   * N8AO's quality preset, which is the string handed to `setQualityMode`.
   *
   * Replaces the old `aoSamples` count, which never reached the pass. r3f's
   * `<N8AO>` applies `aoSamples` in one layout effect and calls
   * `setQualityMode(quality)` in a later one, so whenever both are passed the
   * preset silently overwrites the count. Naming the preset directly is the
   * only version of this setting that is not a lie. `'low'` is 16 AO samples
   * with 4 denoise samples, `'medium'` is 16 with 8.
   */
  aoQuality: 'low' | 'medium'
  /** Scatter density multiplier for rocks, ferns, pebbles and flowers. */
  propDensity: number
  cloudCount: number
  /** Upper bound on device pixel ratio. Retina at full rate is four times the fill. */
  maxDpr: number

  // ---------------------------------------------------------------------
  // Lighting. See docs/design/01-lighting.md section 7.
  // ---------------------------------------------------------------------

  /**
   * The camera-relative rim / kicker directional.
   *
   * Spec ladder: on at every tier, because it is the defining element of the
   * look and `low` already gives up AO, soft shadows and clouds. Off here
   * because the light does not exist yet; `Lighting.tsx` renders a slot that
   * returns null.
   */
  rimLight: boolean
  /**
   * The camera-relative bounce fill that opposes the rim.
   *
   * Spec ladder: false / true / true. It is the one light cut at `low`, where
   * the hemisphere rises to 0.60 to absorb it.
   */
  bounceFill: boolean
  /**
   * The character's multiply-blended contact blob.
   *
   * Spec ladder: on at every tier. `low` is the tier that needs it most,
   * because a 1024 shadow map cannot glue the robot to the floor on its own.
   * Deliberately not a second shadow-casting light: `WebGLShadowMap` tests
   * `object.layers` against the main camera rather than the shadow camera, so
   * casters cannot be masked per light at all.
   */
  contactShadow: boolean
  /**
   * Shadow blur radius in shadow-map texels, and the sample count behind it.
   *
   * Only has any effect under variance shadow maps, which `App.tsx` selects
   * whenever `softShadows` is set; under the percentage-closer default three
   * ignores both. Today's values, moved out of the inline conditional in
   * `Lighting.tsx`. Spec ladder: 0 / 4 / 6 and 0 / 8 / 16, which belongs to the
   * commit that also lands the following frustum, because the tighter frustum
   * is what lets medium reach the same softness from fewer samples.
   */
  shadowRadius: number
  shadowBlurSamples: number
  /**
   * Hemisphere light intensity.
   *
   * Today's 0.5 at every tier. Spec ladder: 0.60 / 0.55 / 0.55, where the extra
   * 0.05 at `low` pays for the bounce fill that tier does not get. Retuning any
   * light intensity is out of scope for the stream that introduced this field.
   */
  hemisphereIntensity: number
  /**
   * Cube resolution for the `Lightformer` environment.
   *
   * One cube render plus one PMREM pass, once, because `frames={1}`. Runtime
   * IBL sampling costs the same at any resolution; only memory and the
   * sharpness of the low-roughness mips differ.
   *
   * Today's 256 at every tier. Spec ladder: 128 / 256 / 512, which lands with
   * the environment rebuild, because 512 exists to keep the highlight strip's
   * streak crisp against `clearcoatRoughness 0.10` and there is no strip yet.
   */
  envResolution: number

  // ---------------------------------------------------------------------
  // Post-processing. See docs/design/04-post.md section 10.
  // ---------------------------------------------------------------------

  /**
   * Far-field depth of field.
   *
   * Spec ladder: off / off / available. It stays off even at high until it has
   * passed the five acceptance criteria in the post spec's section 4.4, one of
   * which is that the ground directly below the player is pixel-identical to a
   * capture with the effect off. Blurring the ledge the player is lining a jump
   * up on is a gameplay regression rather than an aesthetic one.
   */
  depthOfField: boolean
  /**
   * Chromatic aberration. Spec ladder: off / off / available, default off.
   * A `CONVOLUTION` effect, so it can never merge and always costs a whole
   * extra full-screen pass, for something whose own specification is that it
   * should be almost impossible to see.
   */
  chromaticAberration: boolean
  /**
   * The LUT colour grade.
   *
   * Spec ladder: on at every tier, including `low`, because it replaces
   * `HueSaturation` and `BrightnessContrast` with a single texture fetch and is
   * therefore cheaper than what it removes. Off here because `lut.ts` does not
   * exist yet, and because the LUT lands as an identity first and is only
   * switched to the real grade once the identity diff has passed.
   */
  colourGrade: boolean
  /**
   * Bloom mip levels. Each level is one more render target bind, and each is a
   * quarter of the cost of the one before it.
   *
   * 8 at every tier, which is `MipmapBlurPass`'s own default and therefore what
   * the current build already does. Spec ladder: 4 / 6 / 8. Fewer levels is a
   * tighter, less wide glow, so it is a look change as well as a saving and it
   * belongs to the bloom commit.
   */
  bloomLevels: number
  /**
   * Resolve AO at half resolution and upsample.
   *
   * Spec ladder: off / on / off, which is not a typo: `halfRes` roughly
   * quarters the AO pass's fragment count at medium, and high pays full price
   * for the edge quality. Off everywhere here, since turning it on at medium
   * softens every contact and is a look change.
   */
  aoHalfRes: boolean

  // ---------------------------------------------------------------------
  // Materials and geometry. See docs/design/02-materials.md section 10.
  // ---------------------------------------------------------------------

  /**
   * Generated surface map resolution. 0 means no maps are generated at all,
   * which is what makes `low` genuinely zero-cost rather than merely cheap: no
   * canvas work, no extra texture uploads, no extra shader variants.
   *
   * Spec ladder: 0 / 512 / 1024. Zero everywhere until `surfaceTexture.ts`
   * exists.
   */
  surfaceMapSize: 0 | 512 | 1024
  /**
   * Whether presets that specify sheen actually set it, split hero from world.
   *
   * Sheen is a Charlie distribution plus two `IBLSheenBRDF` calls plus an
   * energy compensation term, so it is far from free on a surface with many
   * fragments. Spec ladder: hero false / true / true, world false / false /
   * true.
   *
   * `MeshPhysicalMaterial` bumps its version when `sheen` crosses zero, which
   * forces a shader recompile, so the tier has to be known before a material is
   * constructed. A tier change rebuilds materials; it must never mutate them.
   */
  sheenHero: boolean
  sheenWorld: boolean
  /** Anisotropy on `anodised()`. Adds `USE_ANISOTROPY`. Spec ladder: no / no / yes. */
  anisotropy: boolean
  /**
   * Whether `gel()` may use real transmission at all, or falls back to
   * `crystal()`. Transmission costs an extra render target pass.
   *
   * True everywhere, which is what the world does today. Spec ladder: false /
   * true / true, which becomes a real setting once `crystal()` has call sites.
   */
  transmission: boolean
  /** `RoundedBox` smoothness for world geometry; hero parts are always 4. */
  bevelSmoothness: 2 | 3 | 4
  /** Screen-printed decal meshes. Spec ladder: no / no / yes. */
  decals: boolean
  /** Wrapped-diffuse `onBeforeCompile` on the shell. Spec ladder: no / no / yes. */
  wrapDiffuse: boolean

  // ---------------------------------------------------------------------
  // World detail. See docs/design/03-environment.md section 10.1.
  // ---------------------------------------------------------------------

  /**
   * Token crystal groves scattered across the island.
   *
   * These were derived from the tier inline in `HubIsland` with a comment
   * saying they belonged here. They belong here: a field that lives at the call
   * site is a field no other scene can read and no test can assert on, and the
   * whole reason this table exists is that a tier system retrofitted onto the
   * art only ever expresses the settings someone remembered to make
   * configurable.
   */
  crystalGroves: number
  /**
   * Segments per circuit-trace tube and per overhead arc catenary.
   *
   * The single largest triangle dial in the built environment, because the
   * traces are swept tubes and the count multiplies by the ring resolution.
   */
  traceSegments: number
  /** The translucent outer shell on node sculptures. One extra draw per node. */
  nodeShells: boolean
  /** Perimeter pylons in the ring. Their colliders are never gated, only the mesh. */
  pylonCount: number
  /** Caps and collars on the pylons, which is detail rather than silhouette. */
  pylonDetail: boolean

  // ---------------------------------------------------------------------
  // Character and VFX. See docs/design/05-character-vfx.md.
  // ---------------------------------------------------------------------

  /**
   * How much of the visor shader is compiled.
   *
   * `'simple'` compiles out the scanlines and the sweep, which is a `#define`
   * rather than a branch, so the cost is a shorter shader rather than a skipped
   * one. The visor is the one emissive surface a player looks at for hours, so
   * it is cut last and only at the bottom tier.
   */
  visorDetail: 'simple' | 'full'

  /**
   * Foot placement from ground rays.
   *
   * Spec ladder: no / yes / yes. `low` runs no foot rays and the feet stay on
   * the walk cycle, which on flat ground is invisible. The body-centre ray runs
   * at every tier regardless, because the contact blob depends on it.
   */
  footIk: boolean
  /**
   * Maximum live particles across every emitter. Zero means the pool is never
   * allocated, which is the only version of "off" worth having.
   *
   * Additive quads stack, so this is also a bloom setting: dust and debris use
   * `NormalBlending` with alpha and only energy effects are allowed to be
   * additive, or a dense cluster of individually dim particles crosses the
   * threshold together and produces a white blob.
   */
  particleBudget: number
  /**
   * How much of each effect is built: `'off'` runs no emitters, `'low'` runs
   * the gameplay-legible ones (landing dust, jump puff), `'full'` adds the
   * decorative ones.
   */
  vfxDetail: 'off' | 'low' | 'full'
  /**
   * The animated visor face: blinks, gaze, expressions.
   *
   * Its own gate rather than part of `vfxDetail`, because it is the one
   * emissive surface the player looks at for hours and it is the last thing
   * that should be cut for frame time.
   */
  faceAnimation: boolean
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    /*
      Fifteen thousand blades over the WHOLE island rather than a dense ring
      around the robot, and the change is a tier-parity fix rather than a
      tuning preference.

      The radius was 9 against an island of 16, which does not make low a
      cheaper version of the same lawn - it makes it a different level. A
      critique of the three tiers measured the lawn at 0.614 display luma on
      low against 0.329 on high, because outside 9 m there is no grass at all
      and what the camera sees is the bare ground mat. Both reviewers read it as
      the art changing between tiers, which the art bible's section 7 forbids:
      low loses grading effects and resolution, not content.

      Blade count is deliberately unchanged, so the triangle cost is identical
      and only the spacing differs. Low becomes a thin lawn instead of a bald
      island with a rug on it.
    */
    grassBlades: 15_000,
    flowers: 900,
    grassCastShadow: false,
    grassRadius: 16,
    shadowMapSize: 1024,
    softShadows: false,
    ambientOcclusion: false,
    // Unused while ambientOcclusion is false, and deliberately still the
    // cheaper preset rather than a placeholder, so forcing AO on at this tier
    // for a diagnostic does not also hand it the expensive settings.
    aoQuality: 'low',
    propDensity: 0.35,
    cloudCount: 0,
    maxDpr: 1,

    // Lighting.
    rimLight: true,
    bounceFill: false,
    contactShadow: true,
    shadowRadius: 0,
    shadowBlurSamples: 0,
    hemisphereIntensity: 0.6,
    envResolution: 128,

    // Post.
    depthOfField: false,
    chromaticAberration: false,
    colourGrade: true,
    bloomLevels: 4,
    aoHalfRes: false,

    // Materials and geometry.
    surfaceMapSize: 0,
    /*
      The sheen ladder, finally applied. `02-materials.md` specifies hero
      false / true / true and world false / false / true, and all three tiers
      shipped false for both - so `shell()`'s entire sheen block, the warm
      grazing-angle lobe that is the hero's SECOND specular highlight, has never
      rendered on any tier. A critique found the shell showing one broad wash
      and no second lobe; this is half of why.

      Low genuinely stays off. Sheen is a Charlie distribution plus two
      IBLSheenBRDF calls plus energy compensation, and this is the tier that has
      to get cheaper rather than more expensive.
    */
    sheenHero: false,
    sheenWorld: false,
    anisotropy: false,
    transmission: true,
    bevelSmoothness: 2,
    decals: false,
    wrapDiffuse: false,

    // World detail.
    crystalGroves: 3,
    traceSegments: 24,
    nodeShells: false,
    pylonCount: 6,
    pylonDetail: false,

    // Character and VFX.
    visorDetail: 'simple',
    footIk: false,
    particleBudget: 0,
    vfxDetail: 'off',
    faceAnimation: false,
  },
  medium: {
    grassBlades: 70_000,
    flowers: 4_500,
    grassCastShadow: false,
    grassRadius: 16,
    shadowMapSize: 2048,
    softShadows: true,
    ambientOcclusion: true,
    aoQuality: 'low',
    propDensity: 0.7,
    cloudCount: 3,
    maxDpr: 1.5,

    // Lighting.
    rimLight: true,
    bounceFill: true,
    contactShadow: true,
    shadowRadius: 4,
    shadowBlurSamples: 8,
    hemisphereIntensity: 0.55,
    envResolution: 256,

    // Post.
    depthOfField: false,
    chromaticAberration: false,
    colourGrade: true,
    bloomLevels: 6,
    aoHalfRes: true,

    // Materials and geometry.
    surfaceMapSize: 0,
    // Hero only. The world's sheen showpiece is the ground cover, and 70,000
    // blades of Charlie distribution is not a medium-tier cost.
    sheenHero: true,
    sheenWorld: false,
    anisotropy: false,
    transmission: true,
    bevelSmoothness: 3,
    decals: false,
    wrapDiffuse: false,

    // World detail.
    crystalGroves: 5,
    traceSegments: 48,
    nodeShells: true,
    pylonCount: 8,
    pylonDetail: true,

    // Character and VFX.
    visorDetail: 'full',
    footIk: true,
    particleBudget: 0,
    vfxDetail: 'off',
    faceAnimation: false,
  },
  high: {
    grassBlades: 220_000,
    flowers: 14_000,
    grassCastShadow: true,
    grassRadius: 16,
    shadowMapSize: 4096,
    softShadows: true,
    ambientOcclusion: true,
    aoQuality: 'medium',
    propDensity: 1,
    cloudCount: 5,
    maxDpr: 1.75,

    // Lighting.
    rimLight: true,
    bounceFill: true,
    contactShadow: true,
    shadowRadius: 6,
    shadowBlurSamples: 16,
    hemisphereIntensity: 0.55,
    envResolution: 512,

    // Post.
    depthOfField: false,
    chromaticAberration: false,
    colourGrade: true,
    bloomLevels: 8,
    aoHalfRes: false,

    // Materials and geometry.
    surfaceMapSize: 0,
    sheenHero: true,
    sheenWorld: true,
    anisotropy: false,
    transmission: true,
    bevelSmoothness: 4,
    decals: false,
    wrapDiffuse: false,

    // World detail.
    crystalGroves: 6,
    traceSegments: 64,
    nodeShells: true,
    pylonCount: 8,
    pylonDetail: true,

    // Character and VFX.
    visorDetail: 'full',
    footIk: true,
    particleBudget: 0,
    vfxDetail: 'off',
    faceAnimation: false,
  },
}

/**
 * Signals available before a single frame has been drawn.
 *
 * Kept as plain data so the choice below is a pure function. Guessing a tier is
 * exactly the kind of heuristic that rots quietly, and a test is the only way
 * to notice when it does.
 */
export type DeviceProfile = {
  /** Unmasked GPU string from WEBGL_debug_renderer_info, lowercased. */
  renderer: string
  cores: number
  /** navigator.deviceMemory in GB, or 0 when the browser does not report it. */
  memoryGb: number
}

/** GPU families that are integrated and should never be given the top tier. */
const INTEGRATED = [
  'intel',
  'uhd graphics',
  'hd graphics',
  'iris',
  'llvmpipe',
  'swiftshader',
  'software',
  'mali',
  'adreno',
  'powervr',
  'videocore',
]

/** Apple Silicon reports as "Apple M1/M2/...". Integrated, but genuinely fast. */
const APPLE_SILICON = /apple m\d/

/**
 * Pick a starting tier.
 *
 * Deliberately conservative. Being wrong toward "too pretty" means a player on
 * a laptop meets a slideshow and has no idea why; being wrong toward "too
 * plain" costs them some grass until they change it. The selector in the HUD is
 * the escape hatch in both directions, which is most of why it exists.
 */
export function selectTier(profile: DeviceProfile): QualityTier {
  const renderer = profile.renderer.toLowerCase()

  // Software rasterisers cannot run any of this. Nothing else about the machine
  // matters if there is no GPU behind the context.
  if (renderer.includes('llvmpipe') || renderer.includes('swiftshader')) return 'low'

  // Checked before the integrated list, which "apple" would otherwise not hit
  // but which is worth being explicit about: these are integrated parts that
  // comfortably outrun plenty of discrete ones.
  if (APPLE_SILICON.test(renderer)) return 'high'

  if (INTEGRATED.some((g) => renderer.includes(g))) {
    return profile.cores >= 8 ? 'medium' : 'low'
  }

  // An unknown renderer is more likely a privacy-masked desktop browser than a
  // machine too old to name itself, so fall back on the core count instead of
  // assuming the worst.
  if (renderer === '' || renderer === 'unknown') {
    return profile.cores >= 8 ? 'medium' : 'low'
  }

  // Named, not integrated, and reporting little memory is the profile of an
  // older discrete card.
  if (profile.memoryGb > 0 && profile.memoryGb <= 4) return 'medium'
  if (profile.cores <= 4) return 'medium'

  return 'high'
}

export function isQualityTier(value: unknown): value is QualityTier {
  return value === 'low' || value === 'medium' || value === 'high'
}

const STORAGE_KEY = 'agent-atlas-quality'

/** Reads the GPU string the driver reports, or '' when it is masked. */
function readRenderer(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return ''
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
  } catch {
    return ''
  }
}

export function readDeviceProfile(): DeviceProfile {
  return {
    renderer: readRenderer(),
    cores: navigator.hardwareConcurrency ?? 4,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
  }
}

/**
 * The tier to start in: an explicit choice if there is one, otherwise a guess.
 *
 * Precedence is URL, then saved preference, then detection. The query parameter
 * wins so a tier can be forced without disturbing what the player picked, which
 * matters for testing all three on one machine.
 */
export function resolveInitialTier(): QualityTier {
  const fromUrl = new URLSearchParams(window.location.search).get('quality')
  if (isQualityTier(fromUrl)) return fromUrl

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isQualityTier(saved)) return saved
  } catch {
    // Blocked storage. Fall through to detection.
  }

  return selectTier(readDeviceProfile())
}

export function saveTier(tier: QualityTier) {
  try {
    localStorage.setItem(STORAGE_KEY, tier)
  } catch {
    // Preference is a nicety; failing to persist it must not break the game.
  }
}
