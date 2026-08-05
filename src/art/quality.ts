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

export type QualitySettings = {
  /** Blades in the instanced grass field. The single most expensive number here. */
  grassBlades: number
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
  aoSamples: number
  /** Scatter density multiplier for rocks, ferns, pebbles and flowers. */
  propDensity: number
  cloudCount: number
  /** Upper bound on device pixel ratio. Retina at full rate is four times the fill. */
  maxDpr: number
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    // Enough to read as ground cover close to the player without carpeting the
    // island. Paired with the smaller radius, this is a ring around the robot
    // rather than a field.
    grassBlades: 15_000,
    grassCastShadow: false,
    grassRadius: 9,
    shadowMapSize: 1024,
    softShadows: false,
    ambientOcclusion: false,
    aoSamples: 0,
    propDensity: 0.35,
    cloudCount: 0,
    maxDpr: 1,
  },
  medium: {
    grassBlades: 70_000,
    grassCastShadow: false,
    grassRadius: 16,
    shadowMapSize: 2048,
    softShadows: true,
    ambientOcclusion: true,
    aoSamples: 8,
    propDensity: 0.7,
    cloudCount: 3,
    maxDpr: 1.5,
  },
  high: {
    grassBlades: 180_000,
    grassCastShadow: true,
    grassRadius: 16,
    shadowMapSize: 4096,
    softShadows: true,
    ambientOcclusion: true,
    aoSamples: 16,
    propDensity: 1,
    cloudCount: 5,
    maxDpr: 1.75,
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
