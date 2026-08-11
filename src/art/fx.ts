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

/**
 * The systems `?gfx` can switch back ON, which is a SHORTER list, and the
 * asymmetry is the whole content of this constant.
 *
 * `?nogfx=x` needs nothing from the system it names. Setting a gate false is
 * always meaningful and always safe, so the subtractive lever can afford to
 * accept every token in `GFX_SYSTEMS` uniformly.
 *
 * Turning one back on is not symmetric with that. It is only meaningful if the
 * system behind the gate exists and the gate is the only thing holding it back,
 * and for two of the seven that is not true:
 *
 * - `vfx` is two fields, `particleBudget` and `vfxDetail`, and the budget is 0
 *   at all three tiers. There is no number to restore. Picking one here would
 *   be inventing a tier setting in a URL parser, which is the opposite of what
 *   a bisection lever is for.
 * - `face` gates a system that was never written. `faceAnimation` is false at
 *   every tier because there is no face animation, not because it is switched
 *   off, so `?gfx=face` would advertise a feature rather than reveal one.
 *
 * So those two tokens are not in this list, and they are therefore dropped by
 * the same filter that drops `?gfx=bogus`. That is deliberate and it is the
 * consistent choice rather than the lax one: **the failure mode this codebase
 * keeps getting cut by is a setting that parses and then does nothing.** The
 * inert `<N8AO quality>` preset is the canonical case - it looked configured
 * for as long as anyone cared to look, and every tier silently ran the
 * wrapper's defaults. A `?gfx=vfx` that parsed into a list and then changed no
 * pixels would be the same defect with a new spelling. Both parameters share
 * one rule - an unknown token is dropped, the rest of the list still works -
 * and they differ only in which vocabulary is known, which is checkable here
 * rather than discoverable by experiment.
 *
 * `dof` IS here, and it is the one that needs justifying. Depth of field is
 * unbuilt in the sense that nothing drives its focus distance frame by frame,
 * but the `<DepthOfField>` block in `PostFX.tsx` is wired with the spec's own
 * values and does render, so `?gfx=dof` genuinely turns something on rather
 * than claiming to. It is in fact the only way to produce the A/B pair at
 * `hub-establishing` and `hub-portal` that the art bible's section 7 demands
 * BEFORE the effect may be enabled by default. Note while using it that the
 * near field has not been deleted yet, so it blurs ground the player is about
 * to jump onto - which is why it is a URL lever and not a tier setting.
 */
export const GFX_ENABLEABLE = ['rim', 'dof', 'lut', 'blob', 'ao'] as const
export type GfxEnableable = (typeof GFX_ENABLEABLE)[number]

export type FxOverrides = {
  /** `?nofx` - the whole post chain off. Existing behaviour, moved here. */
  disabled: boolean
  /** `?threshold=<n>` - Bloom's luminanceThreshold. Null means use the shipped value. */
  bloomThreshold: number | null
  /** `?bloomdebug` - intensity 6, smoothing 0, so the threshold becomes a hard mask. */
  bloomDebug: boolean
  /** `?nogfx=rim,dof,...` - individual systems forced off, whatever the tier says. */
  disabledSystems: readonly GfxSystem[]
  /**
   * `?gfx=ao,dof,...` - individual systems forced ON, whatever the tier says.
   *
   * Loses to `disabledSystems` on any token present in both. See
   * `overriddenQuality`.
   */
  enabledSystems: readonly GfxEnableable[]
}

const NONE: readonly GfxSystem[] = []
const NONE_ENABLED: readonly GfxEnableable[] = []

export const NO_FX_OVERRIDES: FxOverrides = {
  disabled: false,
  bloomThreshold: null,
  bloomDebug: false,
  disabledSystems: NONE,
  enabledSystems: NONE_ENABLED,
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

function isGfxEnableable(value: string): value is GfxEnableable {
  return (GFX_ENABLEABLE as readonly string[]).includes(value)
}

/**
 * One comma-list parser for both `?nogfx` and `?gfx`, so the two can never
 * drift into being strict and lax versions of each other.
 *
 * Absent is not the same as empty: `?nogfx` missing entirely means "the tier
 * decides", and `?nogfx=` means "a list, which happens to be empty". Both
 * produce the same settings today, and collapsing them would make an
 * unrecognised-token bug and a missing-parameter bug look identical in a test.
 */
function systemList<T extends string>(
  raw: string | null,
  known: (value: string) => value is T,
  none: readonly T[],
): readonly T[] {
  if (raw === null) return none
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(known)
}

export function parseFxOverrides(search: string): FxOverrides {
  const params = new URLSearchParams(search)

  return {
    disabled: params.has('nofx'),
    bloomThreshold: number(params.get('threshold')),
    bloomDebug: params.has('bloomdebug'),
    disabledSystems: systemList(params.get('nogfx'), isGfxSystem, NONE),
    enabledSystems: systemList(params.get('gfx'), isGfxEnableable, NONE_ENABLED),
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
 * Force individual systems on in a tier's settings. The counterpart to
 * `applyGfxOverrides`, and the reason it exists is that a subtractive lever
 * becomes a no-op the moment the thing it subtracts is off by default.
 *
 * `?nogfx=ao` was the lever that isolated the AO crackle in round 2, and the
 * A/B it made possible is what got the pass measured at about half the frame
 * rate at high and then removed at all three tiers. With
 * `ambientOcclusion: false` everywhere, that same lever now subtracts nothing,
 * and re-running the comparison that justified the decision would mean editing
 * `quality.ts` and rebuilding - which is exactly the state the URL overrides
 * exist to prevent. A decision defended by a measurement nobody can repeat is a
 * decision defended by a comment.
 *
 * Only the gates in `GFX_ENABLEABLE` can appear here, so there is no case in
 * this function for a system that could not honestly be switched on. See that
 * constant for the two that are excluded and why.
 *
 * Returns the settings unchanged, by identity, when nothing is enabled, for the
 * same zustand-selector reason `applyGfxOverrides` does.
 */
export function applyGfxEnables(
  settings: QualitySettings,
  enabled: readonly GfxEnableable[],
): QualitySettings {
  if (enabled.length === 0) return settings

  const on = new Set(enabled)
  return {
    ...settings,
    ...(on.has('rim') ? { rimLight: true } : {}),
    ...(on.has('dof') ? { depthOfField: true } : {}),
    ...(on.has('lut') ? { colourGrade: true } : {}),
    ...(on.has('blob') ? { contactShadow: true } : {}),
    ...(on.has('ao') ? { ambientOcclusion: true } : {}),
  }
}

/**
 * The quality table this session actually uses.
 *
 * Built once at module scope so each tier keeps a stable object identity, which
 * is what lets `useQuality` select it directly.
 *
 * **Enables first, disables second, so `?nogfx` wins a tie.** `?gfx=ao&nogfx=ao`
 * gives AO off. That ordering is not arbitrary and it is not a coin toss:
 *
 * - `?nogfx` is the rollback lever. With no accounts and no telemetry it is the
 *   only remote diagnostic this project has, and the sentence at the other end
 *   of it is "reload with this and tell me if it stops". That instruction has to
 *   hold whatever else is already in the address bar - including a `?gfx` the
 *   player copied out of a bug report or a bookmark - or the lever is not a
 *   lever.
 * - It keeps one invariant true of the pair rather than of each half: the
 *   composed result can never enable something `?nogfx` named. `applyGfxOverrides`
 *   is tested to never turn anything on, and running it last is what extends
 *   that guarantee to the whole pipeline.
 * - The safe direction should win by default. Every disable makes the frame
 *   cheaper and simpler; some enables make it more expensive, and one of them
 *   (`dof`) turns on an effect whose acceptance criteria are not met yet.
 */
export function overriddenQuality(
  overrides: FxOverrides = fxOverrides(),
): Record<QualityTier, QualitySettings> {
  const forTier = (settings: QualitySettings) =>
    applyGfxOverrides(applyGfxEnables(settings, overrides.enabledSystems), overrides.disabledSystems)

  return {
    low: forTier(QUALITY.low),
    medium: forTier(QUALITY.medium),
    high: forTier(QUALITY.high),
  }
}
