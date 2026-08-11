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
 * `mix(a, b, t) * k`, as a TUPLE.
 *
 * Spelled out rather than written with `.map` because `Array.prototype.map` on a
 * three-tuple returns `number[]`, and `luma709(...that)` is a type error under
 * `tsc -b`. The three assertions below all spread into `luma709`.
 */
function scale3(a: Vec3, b: Vec3, t: number, k: number): Vec3 {
  return [
    (a[0] + (b[0] - a[0]) * t) * k,
    (a[1] + (b[1] - a[1]) * t) * k,
    (a[2] + (b[2] - a[2]) * t) * k,
  ]
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
 * Its omission is not free and is stated rather than glossed. It has since been
 * computed properly - a ray-traced cosine-weighted integral of the six cards and
 * the background from the cube camera's own position, with card-on-card occlusion
 * - and the answer changed with round 3. Before: about -0.04 of red minus blue on
 * a deck top, the warm key softbox outweighed by the cool wrap, the `#243a52`
 * ambient floor and the rim card together. After: **-0.002**, because the cool
 * wrap went 0.60 to 0.36 and the ambient floor darkened, while the softbox held
 * its radiance. So the allowance below is now an order of magnitude larger than
 * the thing it allows for, and it is kept at 0.05 anyway, because a slack bound
 * that is documented is safer than a tight one that has to be re-derived every
 * time a card moves.
 *
 * What the omission does NOT cover, and what no assertion in this file can: the
 * environment is 30-51% of the total irradiance on a shadowed surface, so any
 * claim here about a shadowed surface's LEVEL rather than its channel ratios is
 * only a third to a half of the story. The full integral lives in the round-3
 * report and the numbers it produced are quoted in the budget block in
 * `Lighting.tsx`.
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
    /*
      The cap is the invariant. The exact total is a SNAPSHOT, and it is kept
      deliberately: a stream that moves one of the four intensities has to come
      here and change this line, which is the only forcing function that makes
      someone look at the sum at all. It was 2.55; round 3 spent the last 0.05.
    */
    expect(sum).toBeCloseTo(2.6, 10)
    expect(sum).toBeLessThanOrEqual(CAPS.directionalSum)
  })

  it('keeps the rim inside its own sub-cap', () => {
    expect(HUB_RIG.rim.intensity).toBeLessThanOrEqual(CAPS.rim)
  })

  it('keeps every Lightformer inside 1.60', () => {
    expect(HUB_ENV.keySoftbox).toBeLessThanOrEqual(CAPS.singleLightformer)
    expect(HUB_ENV.highlightStrip).toBeLessThanOrEqual(CAPS.singleLightformer)
  })

  /*
    This assertion USED to read `tier.hemisphereIntensity` and stop there, and
    that was checking the wrong number. `quality.ts` publishes the tier ladder,
    but the hub multiplies it by `HUB_RIG.hemisphere.scale` before handing it to
    the light, so the value the cap applies to was not the value being asserted.
    The gap was zero when the scale was 1 and is 0.62 now, so the old assertion
    would have passed at any scale whatsoever, including one that took the
    effective hemisphere over the cap from the other direction.
  */
  it('holds the EFFECTIVE hub hemisphere inside 0.60 at every tier', async () => {
    const { QUALITY } = await import('./quality')
    for (const tier of Object.values(QUALITY)) {
      const effective = tier.hemisphereIntensity * HUB_RIG.hemisphere.scale
      expect(effective).toBeLessThanOrEqual(CAPS.hemisphere)
      expect(effective).toBeGreaterThan(0)
    }
    // And the ladder survives being scaled, which is why this is a multiplier
    // rather than the clamp it wanted to be: low still sits above medium.
    expect(QUALITY.low.hemisphereIntensity * HUB_RIG.hemisphere.scale).toBeGreaterThan(
      QUALITY.medium.hemisphereIntensity * HUB_RIG.hemisphere.scale,
    )
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
    /*
      THIS TEST HAD A BUG OF ITS OWN AND IT IS WORTH NAMING, because it is the
      same class of bug it was written to catch.

      It reconstructed a HISTORICAL margin using `peak()`, which reads the CURRENT
      `HUB_ENV.intensity`. That silently assumed `environmentIntensity` would never
      move. It moved, 0.85 to 0.70, and both assertions started failing while
      describing history that had not changed. The historical constant has to be
      written down as a constant, not read out of live configuration.
    */
    const HISTORICAL_ENV_INTENSITY = 0.85
    const stalePeak = Math.max(...linearise('#ffffff')) * 1.55 * HISTORICAL_ENV_INTENSITY
    // The margin it carried against the threshold it was chosen for.
    expect(1.75 / stalePeak).toBeCloseTo(1.33, 2)
    // And against the one that was actually shipped.
    expect(BLOOM_THRESHOLD / stalePeak).toBeCloseTo(1.1, 2)
  })

  /*
    The invariant that round 3 depends on, and the reason it could lower the
    ambient fill without touching a single bloom margin.

    `environmentIntensity` scales the environment's DIFFUSE fill and its SPECULAR
    peak with one number, and those are two unrelated jobs. Round 3 lowered it
    0.85 to 0.70 and raised the two cards whose job is specular by the reciprocal,
    so their peak radiance - which is the only thing bloom sees, because a
    prefiltered cubemap lookup cannot exceed its own brightest texel - is
    unchanged to the last decimal. This asserts that identity directly rather than
    asserting the two literals it happens to produce, so it keeps holding the next
    time `environmentIntensity` moves.
  */
  it('holds the two specular cards at their original peak radiance', () => {
    const ORIGINAL = { envIntensity: 0.85, keySoftbox: 1.12, highlightStrip: 1.28 }
    expect(HUB_ENV.keySoftbox * HUB_ENV.intensity).toBeCloseTo(
      ORIGINAL.keySoftbox * ORIGINAL.envIntensity,
      4,
    )
    expect(HUB_ENV.highlightStrip * HUB_ENV.intensity).toBeCloseTo(
      ORIGINAL.highlightStrip * ORIGINAL.envIntensity,
      4,
    )
  })

  it('cannot take environmentIntensity below 0.68 without breaching the card cap', () => {
    /*
      The derived floor, asserted so it is not rediscovered by tripping over it.
      Holding the strip's peak means its intensity is inversely proportional to
      `environmentIntensity`, and the bible caps a single Lightformer at 1.60:
      `1.28 * 0.85 / 0.68 = 1.60` exactly. Anything below 0.68 has to come out of
      card AREA instead, which halves diffuse fill and leaves peak radiance alone.
    */
    const heldPeak = 1.28 * 0.85
    expect(heldPeak / 0.68).toBeCloseTo(CAPS.singleLightformer, 3)
    expect(heldPeak / HUB_ENV.intensity).toBeLessThanOrEqual(CAPS.singleLightformer)
    expect(HUB_ENV.intensity).toBeGreaterThanOrEqual(0.68)
  })
})

describe('the temperature axis', () => {
  /*
    The high and medium tiers, 0.55, as the hub actually applies it.

    A function rather than a const because `HUB_RIG` is assigned in `beforeAll` -
    the import has to be dynamic, see the header note - so a describe-body
    constant reads `undefined` and the whole suite fails to collect.
  */
  const hemisphere = () => 0.55 * HUB_RIG.hemisphere.scale

  it('puts warm light on a surface the player stands on', () => {
    /*
      The finding. A horizontal deck receives the hemisphere's sky colour
      undiluted plus the key at `dot(N, L)` 0.679, and before this the sum of
      those and the two fills was 0.229 of red BELOW blue in linear light. The
      albedo above it is eleven points warm in display space, so the two
      cancelled and the deck rendered dead neutral.

      0.201 to 0.376 in round 3, and the two causes pull the same way: the key
      rose 1.55 to 1.83 and the key is the warmest term in the rig, while the
      hemisphere - the largest cool term on a horizontal surface - fell to 0.341.
      Nothing here was tuned for temperature; this is what falls out of a change
      made entirely for the value bands, and it is recorded because the next
      round should know the axis got wider rather than assume it held.

      This figure is ANALYTIC ONLY, per the note on `analyticIrradiance`. Ray
      tracing the environment as well puts its net contribution at -0.002 of red
      minus blue and the whole-rig total at +0.374, so for the first time the two
      agree to within a rounding error - see `ENVIRONMENT_ALLOWANCE`.
    */
    const deck = analyticIrradiance(UP, hemisphere())
    expect(deck[0] - deck[2]).toBeCloseTo(0.376, 2)
    // Clearly positive, and still clearly positive once the environment's own
    // net contribution is paid for. It was -0.229 before this change.
    expect(deck[0] - deck[2] - ENVIRONMENT_ALLOWANCE).toBeGreaterThan(0.1)
  })

  /*
    The hemisphere's ground colour, on a VERTICAL face.

    Here because round 3's brief proposed that the ground colour "only reaches
    downward-facing normals, so it may be contributing almost nothing to the
    vertical shadow side", and that is false in a way worth pinning down: three
    computes `mix(groundColor, skyColor, 0.5 * dot(N, up) + 0.5)`, so on any
    vertical face the weight is exactly 0.5 and the ground colour arrives at
    HALF strength, not at none. It is the greenest term reaching the hero's
    shadow side.

    Asserted rather than commented because the temptation to "fix" the grey
    shadow side by changing this hex will recur, and the hex is not the problem.
  */
  it('delivers the hemisphere ground colour to a vertical at exactly half weight', () => {
    const wall = normalise([1, 0, 1])
    expect(0.5 * dot(wall, UP) + 0.5).toBeCloseTo(0.5, 10)

    const ground = linearise(HUB_RIG.hemisphere.ground)
    const sky = linearise(HUB_RIG.hemisphere.sky)
    const h = hemisphere()
    const onWall = scale3(ground, sky, 0.5, h)
    // Green is the largest channel of it, and by a wide margin.
    expect(onWall[1]).toBeGreaterThan(onWall[0] * 1.5)
    expect(onWall[1]).toBeGreaterThan(onWall[2] * 1.2)
    // Half of what a vertical receives from the hemisphere comes from `ground`.
    const groundHalf: Vec3 = [ground[0] * 0.5 * h, ground[1] * 0.5 * h, ground[2] * 0.5 * h]
    expect(luma709(...groundHalf) / luma709(...onWall)).toBeCloseTo(0.385, 2)
  })

  it('leaves a shadowed deck cool, which is the other half of the split', () => {
    // The key occluded. If this ever goes warm the rig has stopped having a
    // temperature axis and has simply become warm everywhere, which is the same
    // failure as before with the sign flipped.
    const shadowed = analyticIrradiance(UP, hemisphere())
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

  /*
    THIS ASSERTION WAS DELETED AND REPLACED, and the reasoning matters more than
    the replacement.

    It read: total irradiance luminance on a deck top is held within 3% of what it
    was, "so the rig may not buy warmth with luminance". That was a true and
    valuable constraint ON THE COMMIT THAT WROTE IT - a temperature change has no
    business moving the value bands - but it was written as a standing invariant,
    and as a standing invariant it forbids every future change to the rig's
    overall level. Round 3 exists to change the level: it lowers the ambient fill
    by 30-40% and raises the key, on purpose, and the old assertion fails by
    11.3% while the change is working exactly as designed.

    So the invariant is re-derived from what the value bands actually require. It
    is not "the level must not move". It is:

      - a LIT horizontal surface must not lose luminance, because the deck sits
        0.03 above the 0.56 gameplay floor and the lawn is already below it, and
      - a SHADOWED horizontal surface must lose a lot of it, because that gap is
        the cast shadow, which is item 2 of decision 97's anchor band.

    Both directions, in one test, which is the thing the old one could not express.
  */
  it('holds a lit deck up while dropping a shadowed one, which is the cast shadow', () => {
    // The rig as it stood before round 3.
    const BEFORE = { key: 1.55, skyFill: 0.25, rim: 0.55, bounce: 0.2, hemi: 0.55 }
    const keyOn = (colour: string, intensity: number) =>
      luma709(...linearise(colour)) * intensity * dot(UP, normalise([9, 9.5, 5]))

    const beforeAmbient =
      luma709(...linearise('#9ec9f0')) * BEFORE.skyFill * dot(UP, normalise([-11, 2.4, -7])) +
      luma709(...linearise('#bfeaff')) * BEFORE.rim * Math.sin(0.45) +
      luma709(...linearise('#ffe9cf')) * BEFORE.bounce * Math.sin(0.14) +
      luma709(...linearise('#bcd6ee')) * BEFORE.hemi
    const beforeLit = beforeAmbient + keyOn('#ffe7bc', BEFORE.key)

    const after = luma709(...analyticIrradiance(UP, hemisphere()))
    const afterAmbient = after - keyOn(HUB_RIG.key.color, HUB_RIG.key.intensity)

    // A lit deck holds its analytic luminance: the key more than repays the fills.
    expect(after / beforeLit).toBeGreaterThan(0.99)
    /*
      A shadowed deck loses 27% of its analytic luminance (0.728 of what it had),
      and it is not more than that for one reason worth writing down: the rim is
      deliberately unchanged at 0.55, and `sin(RIM_ELEV) * 0.55` makes it the
      LARGEST analytic term on a shadowed floor at 0.1845. Take the rim to 0.40
      and this ratio goes to about 0.60 without touching anything else. Handoff
      item 3 owns that decision.

      Including the environment integral the same drop is 1.2036 to 0.9645, only
      20%, because the key softbox card is 39% of what a shadowed deck receives
      and is unshadowable by construction.
    */
    expect(afterAmbient / beforeAmbient).toBeLessThan(0.75)
    // Which is the whole point: the lit-to-shadowed ratio widens materially.
    expect(after / afterAmbient).toBeGreaterThan((beforeLit / beforeAmbient) * 1.35)
  })

  /*
    The key is the only term a shadow can remove, which is why round 3 spent the
    directional budget on it rather than only taking it off the fills.
  */
  it('puts the whole of the key, and nothing else, into what a shadow removes', () => {
    const lit = analyticIrradiance(UP, hemisphere())
    const ndl = dot(UP, normalise([9, 9.5, 5]))
    const key = linearise(HUB_RIG.key.color)
    const removed = HUB_RIG.key.intensity * ndl
    const shadowed: Vec3 = [
      lit[0] - key[0] * removed,
      lit[1] - key[1] * removed,
      lit[2] - key[2] * removed,
    ]
    // Per unit of key intensity, a lit deck gains this much irradiance luminance
    // and a shadowed one gains exactly none. 0.5565 is the number the budget
    // block quotes; it is `luma709(linear('#ffe7bc')) * dot(UP, KEY_DIR)`.
    expect(luma709(...key) * ndl).toBeCloseTo(0.5565, 3)
    expect(luma709(...lit) - luma709(...shadowed)).toBeCloseTo(0.5565 * HUB_RIG.key.intensity, 3)
  })
})
