import { describe, it, expect } from 'vitest'
import {
  BLOOM_THRESHOLD,
  GLOW,
  LOW_LUMA_FLOOR,
  emissiveIntensityFor,
  linearLuma,
  linearise,
  luma709,
  srgbToLinear,
} from './materials'
import { palette } from './palette'

/*
  The arithmetic behind every emissive in the game.

  This is worth testing to four decimal places rather than by eye because the
  failure it protects against is invisible: an emissive that is 20% below the
  bloom threshold looks exactly like one that is 20% above it in a still frame
  with no reference, and the entire palette was shipped that way. The numbers
  below were computed independently and cross-checked against the materials
  spec's table, which is why they are written out rather than derived from the
  implementation.
*/

describe('srgbToLinear', () => {
  it('pins the ends exactly', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 12)
  })

  it('uses the linear segment below the knee', () => {
    // Below 0.04045 the transfer function is a straight line at 1/12.92, not
    // the power curve. Getting this wrong is invisible everywhere except in
    // near-black, which is exactly where a coloured shadow lives.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12)
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12)
  })

  it('darkens the midpoint, which is the whole reason the curve exists', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4)
  })

  it('is monotone', () => {
    let previous = -1
    for (let i = 0; i <= 255; i++) {
      const value = srgbToLinear(i / 255)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })
})

describe('luma709', () => {
  it('maps neutral to itself', () => {
    // The coefficients sum to 1, so grey in is the same grey out. If this fails
    // the weights have been mistyped, which is the only likely error here.
    expect(luma709(0, 0, 0)).toBe(0)
    expect(luma709(1, 1, 1)).toBeCloseTo(1, 12)
    expect(luma709(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('weights green about ten times blue', () => {
    expect(luma709(0, 1, 0) / luma709(0, 0, 1)).toBeGreaterThan(9)
  })
})

describe('linearise', () => {
  it('reads both hex forms and ignores the hash', () => {
    expect(linearise('#ffffff')).toEqual([1, 1, 1])
    expect(linearise('000000')).toEqual([0, 0, 0])
    expect(linearise('#fff')).toEqual(linearise('#ffffff'))
  })

  it('throws on anything it cannot read', () => {
    // Silently returning black would divide by zero downstream and produce an
    // Infinity emissiveIntensity, which renders as a white screen.
    expect(() => linearise('rebeccapurple')).toThrow(/hex colour/)
    expect(() => linearise('#12345')).toThrow(/hex colour/)
  })
})

describe('linearLuma against the palette', () => {
  /*
    The table this whole system was designed from. Every one of these was
    computed by hand before the code existed; if the implementation drifts, this
    is where it shows up rather than in a screenshot six commits later.
  */
  const cases: [string, string, number][] = [
    ['visor / circuit', palette.visor, 0.6319],
    ['unlocked', palette.unlocked, 0.6916],
    ['accent', palette.accent, 0.4470],
    ['nodeGlow', palette.nodeGlow, 0.3910],
    ['token', palette.token, 0.3663],
    ['caveCrystal', palette.caveCrystal, 0.2687],
    ['accentDeep', palette.accentDeep, 0.2523],
    ['node', palette.node, 0.2202],
  ]

  for (const [name, hex, expected] of cases) {
    it(`${name} is ${expected}`, () => {
      expect(linearLuma(hex)).toBeCloseTo(expected, 4)
    })
  }

  it('spans a factor of nearly three across the palette, which is the problem', () => {
    // Cyan carries 2.9 times the luminance of violet at the same
    // emissiveIntensity. That ratio is why a flat intensity argument could
    // never mean the same thing twice, and it is the reason this file
    // normalises at all.
    expect(linearLuma(palette.visor) / linearLuma(palette.node)).toBeCloseTo(2.87, 2)
  })
})

describe('emissiveIntensityFor', () => {
  it('lands glow 1.0 exactly on the threshold, for every hue it accepts', () => {
    /*
      The defining property. For each colour, the raw luminance three hands to
      the bloom pass is `luma709(linear(colour)) * emissiveIntensity`, so
      multiplying the returned intensity back by the colour's luminance must
      reproduce the threshold and nothing else. That it holds for cyan, gold,
      amber and pink alike is the entire claim being made by the unit change.
    */
    for (const hex of [palette.visor, palette.unlocked, palette.accent, palette.token, '#ffffff']) {
      const raw = linearLuma(hex) * emissiveIntensityFor(hex, 1)
      expect(raw).toBeCloseTo(BLOOM_THRESHOLD, 10)
    }
  })

  it('is linear in glow', () => {
    const at1 = emissiveIntensityFor(palette.visor, 1)
    expect(emissiveIntensityFor(palette.visor, 2)).toBeCloseTo(at1 * 2, 10)
    expect(emissiveIntensityFor(palette.visor, 0.5)).toBeCloseTo(at1 / 2, 10)
  })

  it('reproduces the spec table', () => {
    expect(emissiveIntensityFor(palette.visor, GLOW.bloom)).toBeCloseTo(3.46, 2)
    expect(emissiveIntensityFor(palette.accent, GLOW.bloom)).toBeCloseTo(4.89, 2)
    expect(emissiveIntensityFor(palette.unlocked, GLOW.bloom)).toBeCloseTo(3.16, 2)
    expect(emissiveIntensityFor(palette.visor, GLOW.source)).toBeCloseTo(1.83, 2)
    expect(emissiveIntensityFor(palette.token, GLOW.source)).toBeCloseTo(3.15, 2)
  })

  it('puts tier A above the threshold and tier B below it, whatever the hue', () => {
    // The property the tiers exist for: "must bloom" and "must not bloom" are
    // now statements about the object rather than about its colour.
    for (const hex of [palette.visor, palette.unlocked, palette.accent, palette.token]) {
      const luma = linearLuma(hex)
      expect(luma * emissiveIntensityFor(hex, GLOW.bloom)).toBeGreaterThan(BLOOM_THRESHOLD)
      expect(luma * emissiveIntensityFor(hex, GLOW.source)).toBeLessThan(BLOOM_THRESHOLD)
    }
  })

  it('refuses to normalise a colour below the low-luma floor', () => {
    /*
      The mandatory exception. Violet at 0.2202 would need an intensity near 8
      to reach the threshold, and a surface emitting eight times the brightest
      lit thing in the scene renders as white with a violet fringe. Refusing is
      the correct behaviour: the fix is geometry, a pale core with a saturated
      halo, and no arithmetic in this file can produce it.
    */
    for (const hex of [palette.node, palette.caveCrystal, palette.accentDeep]) {
      expect(linearLuma(hex)).toBeLessThan(LOW_LUMA_FLOOR)
      expect(() => emissiveIntensityFor(hex, GLOW.source)).toThrow(/pale near-white core/)
    }
  })

  it('accepts everything at or above the floor', () => {
    for (const hex of [palette.token, palette.nodeGlow, palette.accent, palette.visor]) {
      expect(linearLuma(hex)).toBeGreaterThanOrEqual(LOW_LUMA_FLOOR)
      expect(() => emissiveIntensityFor(hex, GLOW.source)).not.toThrow()
    }
  })

  it('names the technique in the error, because the error is the documentation', () => {
    expect(() => emissiveIntensityFor(palette.node, 1)).toThrow(/halo/)
    expect(() => emissiveIntensityFor(palette.node, 1)).toThrow(/art-bible/)
  })
})

describe('GLOW tiers', () => {
  it('orders the three tiers around the threshold', () => {
    expect(GLOW.bloom).toBeGreaterThan(1)
    expect(GLOW.source).toBeLessThan(1)
    expect(GLOW.hold).toBeLessThan(GLOW.source)
  })

  it('leaves the colour-hold tier far below anything that could bloom', () => {
    // Tier C exists so a surface does not go dead in shadow. If it ever creeps
    // up toward the threshold it has stopped being a floor and become a light.
    expect(GLOW.hold * BLOOM_THRESHOLD).toBeLessThan(0.25)
  })
})
