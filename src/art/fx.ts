import { QUALITY, type QualitySettings, type QualityTier } from './quality'

/**
 * URL overrides for the rendering, and the reason they exist.
 *
 * Almost every number in this art pass is a reasoned estimate rather than a
 * measurement: the bloom threshold, the AO exponent, the rim intensity. The
 * whole discipline the design specs are written under is that a reasoned
 * estimate gets bisected against real frames rather than defended in a comment,
 * and that is only possible if changing one costs a reload rather than a
 * rebuild.
 *
 * These are also the rollback levers. With no accounts and no telemetry,
 * asking a player to reload with one query parameter is the only remote
 * diagnostic this project has, and `?nofx` has already earned its keep.
 *
 * Parsing is a pure function of the search string so it can be tested, and it
 * is read exactly once per session.
 */

/**
 * The systems `?nogfx` can switch off individually.
 *
 * Each one is a thing that can plausibly be blamed for a bad frame or a bad
 * image, and each is expensive enough or new enough to be worth isolating.
 * Deliberately not one flag per quality field: this is a bisection tool, and a
 * list of thirty names is not one.
 *
 * `ao` was missing from this list and earned its place the hard way. Tracking a
 * crackle that had appeared on the character meant reaching for the only two
 * levers that existed - `?nofx`, which turns off the entire chain and so only
 * says "post", and switching to `low`, which changes twenty other things on the
 * way past. Ambient occlusion is the one pass in the chain that generates a
 * sampling pattern of its own, which makes it the first suspect for any
 * speckle, and it was the one thing that could not be isolated.
 */
export const GFX_SYSTEMS = ['rim', 'dof', 'lut', 'vfx', 'blob', 'face', 'ao'] as const
export type GfxSystem = (typeof GFX_SYSTEMS)[number]

export type FxOverrides = {
  /** `?nofx` - the whole post chain off. Existing behaviour, moved here. */
  disabled: boolean
  /** `?threshold=<n>` - Bloom's luminanceThreshold. Null means use the shipped value. */
  bloomThreshold: number | null
  /** `?bloomdebug` - intensity 6, smoothing 0, so the threshold becomes a hard mask. */
  bloomDebug: boolean
  /** `?nogfx=rim,dof,...` - individual systems forced off, whatever the tier says. */
  disabledSystems: readonly GfxSystem[]
}

const NONE: readonly GfxSystem[] = []

export const NO_FX_OVERRIDES: FxOverrides = {
  disabled: false,
  bloomThreshold: null,
  bloomDebug: false,
  disabledSystems: NONE,
}

/**
 * A finite number, or null.
 *
 * Null rather than NaN, and never a silent fallback to the shipped value,
 * because the three cases have to stay distinguishable: absent means "use the
 * tier", a number means "use this", and unparseable means the person typing it
 * made a mistake and should see the default rather than a black screen. NaN
 * propagates through every comparison as false, which is the failure mode this
 * exists to avoid.
 */
function number(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function isGfxSystem(value: string): value is GfxSystem {
  return (GFX_SYSTEMS as readonly string[]).includes(value)
}

export function parseFxOverrides(search: string): FxOverrides {
  const params = new URLSearchParams(search)

  const nogfx = params.get('nogfx')
  const disabledSystems = nogfx === null
    ? NONE
    : nogfx
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(isGfxSystem)

  return {
    disabled: params.has('nofx'),
    bloomThreshold: number(params.get('threshold')),
    bloomDebug: params.has('bloomdebug'),
    disabledSystems,
  }
}

let cached: FxOverrides | null = null

/**
 * The overrides for this session, parsed once.
 *
 * Guarded on `window` so importing anything downstream of this stays safe under
 * vitest's node environment. The pure parser above is what the tests exercise.
 */
export function fxOverrides(): FxOverrides {
  if (cached === null) {
    cached = typeof window === 'undefined'
      ? NO_FX_OVERRIDES
      : parseFxOverrides(window.location.search)
  }
  return cached
}

/**
 * Force individual systems off in a tier's settings.
 *
 * Applied to the settings rather than plumbed through props on purpose. Every
 * one of these systems already reads its gate from the quality object, so
 * turning it off at the source means `?nogfx=rim` works for anything that
 * respects the tier, including systems that do not exist yet, with no wiring at
 * the call site and nothing to keep in sync.
 *
 * Returns the settings unchanged, by identity, when nothing is disabled. That
 * matters: the result is handed to a zustand selector, and a fresh object on
 * every call would compare unequal every render.
 */
export function applyGfxOverrides(
  settings: QualitySettings,
  disabled: readonly GfxSystem[],
): QualitySettings {
  if (disabled.length === 0) return settings

  const off = new Set(disabled)
  return {
    ...settings,
    ...(off.has('rim') ? { rimLight: false } : {}),
    ...(off.has('dof') ? { depthOfField: false } : {}),
    ...(off.has('lut') ? { colourGrade: false } : {}),
    ...(off.has('vfx') ? { particleBudget: 0, vfxDetail: 'off' as const } : {}),
    ...(off.has('blob') ? { contactShadow: false } : {}),
    ...(off.has('face') ? { faceAnimation: false } : {}),
    ...(off.has('ao') ? { ambientOcclusion: false } : {}),
  }
}

/**
 * The quality table this session actually uses.
 *
 * Built once at module scope so each tier keeps a stable object identity, which
 * is what lets `useQuality` select it directly.
 */
export function overriddenQuality(
  overrides: FxOverrides = fxOverrides(),
): Record<QualityTier, QualitySettings> {
  return {
    low: applyGfxOverrides(QUALITY.low, overrides.disabledSystems),
    medium: applyGfxOverrides(QUALITY.medium, overrides.disabledSystems),
    high: applyGfxOverrides(QUALITY.high, overrides.disabledSystems),
  }
}
