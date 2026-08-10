import { describe, it, expect, beforeAll, vi } from 'vitest'
import { BLOOM_THRESHOLD, linearise, luma709 } from './materials'

/*
  The hub light rig, as arithmetic.

  Two claims are tested here and both were previously only checkable by taking a
  screenshot and holding an eyedropper to it.

  The first is the art bible's standing caps, which section 1 says are "to be
  pasted into Lighting.tsx and kept current". A comment cannot be kept current;
  a test can.

  The second is the temperature axis, which is the finding this file exists for.
  The palette's stone albedo was moved from seventeen points blue to eleven
  points warm at identical luma, and a lit deck in the resulting frame measured
  warmth -2. The albedo was not the problem: the RIG was adding about thirteen
  points of blue to every lit surface, and nothing in the codebase could see
  that, because the rig's colours were nine string literals scattered through
  JSX and nobody had ever summed them.

  IMPORT NOTE. `Lighting.tsx` reaches `window.location.search` at module scope
  through `useQuality` -> `quality.ts`, so it cannot be imported under vitest's
  node environment without a stub. jsdom is not a dependency and adding one to
  test four constants is the wrong trade, so the globals are stubbed and the
  import is dynamic. If this ever starts failing at import rather than at an
  assertion, that is what changed.
*/

let HUB_RIG: typeof import('./Lighting').HUB_RIG
let HUB_ENV: typeof import('./Lighting').HUB_ENV

beforeAll(async () => {
  const nav = { userAgent: 'node', hardwareConcurrency: 8, platform: 'node' }
  vi.stubGlobal('window', {
    location: { search: '' },
    devicePixelRatio: 1,
    // `detect-gpu`, reached through drei, reads `window.navigator.userAgent` at
    // module scope. It is not enough to stub the bare global.
    navigator: nav,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  })
  vi.stubGlobal('navigator', nav)
  const mod = await import('./Lighting')
  HUB_RIG = mod.HUB_RIG
  HUB_ENV = mod.HUB_ENV
})

/** The art bible's section 1 table, transcribed. Caps, not targets. */
const CAPS = {
  directionalSum: 2.6,
  hemisphere: 0.6,
  singleLightformer: 1.6,
  rim: 0.6,
} as const

const UP = [0, 1, 0] as const

type Vec3 = readonly [number, number, number]

function normalise(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  return [v[0] / m, v[1] / m, v[2] / m]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Lambert irradiance from the whole analytic rig onto one normal, in linear rgb.
 *
 * three computes `irradiance = dot(N, L) * colour * intensity` for a directional
 * light and `mix(ground, sky, 0.5 * dot(N, up) + 0.5) * intensity` for a
 * hemisphere, with both colours decoded from sRGB. The common `1 / PI` from
 * `BRDF_Lambert` is left out because every claim below is about the RATIO
 * between channels, and a scalar cannot change one.
 *
 * The environment map is deliberately not modelled. Its diffuse contribution
 * needs a cosine-weighted integral over six cards of finite solid angle, which
 * is an estimate rather than a computation, and an estimate does not belong in
 * an assertion.
 *
 * Its omission is not free and is stated rather than glossed: a solid-angle
 * estimate puts the environment's own contribution to a deck top at about -0.04
 * of red minus blue - the warm key softbox is outweighed by the cool wrap, the
 * `#243a52` ambient floor and the rim card together. So the analytic figure
 * below OVERSTATES the total by roughly that much. The whole-rig estimate is
 * +0.16 against the analytic +0.20, and the assertions carry the allowance.
 */
const ENVIRONMENT_ALLOWANCE = 0.05
function analyticIrradiance(normal: Vec3, hemisphereIntensity: number): Vec3 {
  const terms: { colour: string; intensity: number; direction: Vec3 }[] = [
    // The key. `KEY_DIRECTION` is (9, 9.5, 5) and is shared with the SkyDome.
    { colour: HUB_RIG.key.color, intensity: HUB_RIG.key.intensity, direction: normalise([9, 9.5, 5]) },
    {
      colour: HUB_RIG.skyFill.color,
      intensity: HUB_RIG.skyFill.intensity,
      direction: normalise(HUB_RIG.skyFill.position as unknown as Vec3),
    },
    // The rim and bounce fill are camera-relative in azimuth and fixed in
    // elevation, and only the elevation reaches a horizontal surface: their
    // `dot(N, L)` against +Y is `sin(elevation)` from every bearing.
    {
      colour: HUB_RIG.rim.color,
      intensity: HUB_RIG.rim.intensity,
      direction: [0, Math.sin(HUB_RIG.rim.elevation), Math.cos(HUB_RIG.rim.elevation)],
    },
    {
      colour: HUB_RIG.bounceFill.color,
      intensity: HUB_RIG.bounceFill.intensity,
      direction: [0, Math.sin(HUB_RIG.bounceFill.elevation), Math.cos(HUB_RIG.bounceFill.elevation)],
    },
  ]

  const total: [number, number, number] = [0, 0, 0]
  for (const term of terms) {
    const ndl = Math.max(0, dot(normal, term.direction))
    const colour = linearise(term.colour)
    for (let i = 0; i < 3; i++) total[i] += colour[i] * term.intensity * ndl
  }

  const weight = 0.5 * dot(normal, UP) + 0.5
  const sky = linearise(HUB_RIG.hemisphere.sky)
  const groundHalf = linearise(HUB_RIG.hemisphere.ground)
  for (let i = 0; i < 3; i++) {
    total[i] += (groundHalf[i] + (sky[i] - groundHalf[i]) * weight) * hemisphereIntensity
  }

  return total
}

describe('the standing caps from the art bible', () => {
  it('keeps the directional sum inside 2.60', () => {
    const sum =
      HUB_RIG.key.intensity +
      HUB_RIG.skyFill.intensity +
      HUB_RIG.rim.intensity +
      HUB_RIG.bounceFill.intensity
    expect(sum).toBeCloseTo(2.55, 10)
    expect(sum).toBeLessThanOrEqual(CAPS.directionalSum)
  })

  it('keeps the rim inside its own sub-cap', () => {
    expect(HUB_RIG.rim.intensity).toBeLessThanOrEqual(CAPS.rim)
  })

  it('keeps every Lightformer inside 1.60', () => {
    expect(HUB_ENV.keySoftbox).toBeLessThanOrEqual(CAPS.singleLightformer)
    expect(HUB_ENV.highlightStrip).toBeLessThanOrEqual(CAPS.singleLightformer)
  })

  it('holds the hemisphere ladder inside 0.60 at every tier', async () => {
    const { QUALITY } = await import('./quality')
    for (const tier of Object.values(QUALITY)) {
      expect(tier.hemisphereIntensity).toBeLessThanOrEqual(CAPS.hemisphere)
    }
  })
})

describe('the environment cards against the measured bloom threshold', () => {
  /*
    A prefiltered cubemap lookup cannot exceed its own brightest texel, so a
    card's peak radiance is a hard ceiling on any specular reflection of it.
    That is the property that makes the environment provably bloom-safe where an
    analytic light is not - and it only holds if the margin is recomputed when
    the threshold moves. It moved from a guessed 1.75 to a measured 1.45 and
    these two cards were not re-derived, which dropped the hottest one's margin
    to 1.10x and is one of the two mechanisms behind the clipped, spilling dome
    specular in `hub-backlit`.
  */
  const peak = (colour: string, intensity: number) =>
    Math.max(...linearise(colour)) * intensity * HUB_ENV.intensity

  it('leaves the hottest card a third under the threshold', () => {
    const strip = peak('#ffffff', HUB_ENV.highlightStrip)
    expect(strip).toBeCloseTo(1.088, 3)
    expect(BLOOM_THRESHOLD / strip).toBeGreaterThan(1.3)
  })

  it('leaves the key softbox half again under it', () => {
    const softbox = peak('#fff3e2', HUB_ENV.keySoftbox)
    expect(softbox).toBeCloseTo(0.952, 3)
    expect(BLOOM_THRESHOLD / softbox).toBeGreaterThan(1.5)
  })

  it('records what the stale values were, so the regression is named', () => {
    // The margins these two carried before the threshold was measured, against
    // the threshold they were chosen for.
    expect(1.75 / peak('#ffffff', 1.55)).toBeCloseTo(1.33, 2)
    // And against the one that was actually shipped.
    expect(BLOOM_THRESHOLD / peak('#ffffff', 1.55)).toBeCloseTo(1.1, 2)
  })
})

describe('the temperature axis', () => {
  const HEMISPHERE = 0.55 // the high and medium tiers

  it('puts warm light on a surface the player stands on', () => {
    /*
      The finding. A horizontal deck receives the hemisphere's sky colour
      undiluted plus the key at `dot(N, L)` 0.679, and before this the sum of
      those and the two fills was 0.229 of red BELOW blue in linear light. The
      albedo above it is eleven points warm in display space, so the two
      cancelled and the deck rendered dead neutral.
    */
    const deck = analyticIrradiance(UP, HEMISPHERE)
    expect(deck[0] - deck[2]).toBeCloseTo(0.201, 2)
    // Clearly positive, and still clearly positive once the environment's own
    // net contribution is paid for. It was -0.229 before this change.
    expect(deck[0] - deck[2] - ENVIRONMENT_ALLOWANCE).toBeGreaterThan(0.1)
  })

  it('leaves a shadowed deck cool, which is the other half of the split', () => {
    // The key occluded. If this ever goes warm the rig has stopped having a
    // temperature axis and has simply become warm everywhere, which is the same
    // failure as before with the sign flipped.
    const shadowed = analyticIrradiance(UP, HEMISPHERE)
    const key = linearise(HUB_RIG.key.color)
    const ndl = Math.max(0, dot(UP, normalise([9, 9.5, 5])))
    const withoutKey = shadowed.map((c, i) => c - key[i] * HUB_RIG.key.intensity * ndl)
    expect(withoutKey[0] - withoutKey[2]).toBeLessThan(-0.15)
  })

  it('keeps the blue on the vertical faces the sky fill exists for', () => {
    /*
      The sky fill was lowered from 19 degrees of elevation to 10.4 rather than
      merely dimmed, and this is the assertion that says why. Its `dot(N, L)` on
      a deck top nearly halves while its `dot(N, L)` on a vertical facing it
      rises, so the same light does less to the floor and more to the shadowed
      wall it was introduced to describe.
    */
    const fill = normalise(HUB_RIG.skyFill.position as unknown as Vec3)
    const wall = normalise([-11, 0, -7])
    expect(dot(UP, fill)).toBeCloseTo(0.181, 3)
    expect(dot(wall, fill)).toBeGreaterThan(0.98)
    // What it was, for the record.
    const wasFill = normalise([-11, 4.5, -7])
    expect(dot(UP, wasFill)).toBeCloseTo(0.326, 3)
    expect(dot(wall, wasFill)).toBeCloseTo(0.95, 2)
  })

  it('does not move the deck out of the gameplay value band', () => {
    /*
      The constraint on the whole change. The greyscale test outranks the
      temperature one, so the rig may not buy warmth with luminance. Total
      irradiance luminance is held to within 3% of what it was.
      Before: key #fff0d8 at 1.50, sky fill #9ec9f0 at 0.30 from (-11, 4.5, -7),
      hemisphere #7fbdf0 at 0.55.
    */
    const before =
      luma709(...linearise('#fff0d8')) * 1.5 * dot(UP, normalise([9, 9.5, 5])) +
      luma709(...linearise('#9ec9f0')) * 0.3 * dot(UP, normalise([-11, 4.5, -7])) +
      luma709(...linearise('#bfeaff')) * 0.55 * Math.sin(0.45) +
      luma709(...linearise('#ffe9cf')) * 0.2 * Math.sin(0.14) +
      luma709(...linearise('#7fbdf0')) * HEMISPHERE

    const after = luma709(...analyticIrradiance(UP, HEMISPHERE))
    expect(Math.abs(after / before - 1)).toBeLessThan(0.03)
  })
})
