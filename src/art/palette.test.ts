import { describe, it, expect } from 'vitest'
import { band, displayLuma, palette, VALUE_BANDS } from './palette'

/**
 * The greyscale readability test, as arithmetic.
 *
 * The art bible's section 8 is meant literally: desaturate a frame and you must
 * still instantly read where you can stand. That property is not something a
 * screenshot review reliably catches, because a reviewer looking at a colour
 * image is being told the answer by the hue. It IS something a test catches,
 * because the whole rule reduces to "these hex values land in these ranges".
 *
 * The original values were not merely close together, they were inverted: the
 * walkable deck sat at 0.850, up in the background band where the sky lives,
 * and the unclimbable cliff at 0.568, down in the gameplay band. A deck that
 * read as sky and a cliff that read as floor is the entire "I cannot tell where
 * I am allowed to go" failure, in two hex values, and this file exists so it
 * cannot come back silently.
 */
describe('display luma', () => {
  it('measures in gamma-encoded sRGB, not linear light', () => {
    /*
      The distinction this asserts is the one most likely to be got wrong, and
      getting it wrong produces confident nonsense: mid grey is 0.5 in display
      space and 0.214 in linear. The band test asks what the eye reads off a
      screen, so display space is the correct one here, while the bloom budget
      in materials.ts is measured in linear because that is what the threshold
      compares.
    */
    expect(displayLuma('#808080')).toBeCloseTo(0.502, 3)
    expect(displayLuma('#ffffff')).toBeCloseTo(1, 6)
    expect(displayLuma('#000000')).toBeCloseTo(0, 6)
  })

  it('accepts the short hex form and rejects anything else', () => {
    expect(displayLuma('#fff')).toBeCloseTo(1, 6)
    expect(() => displayLuma('#gggggg')).toThrow()
    expect(() => displayLuma('rebeccapurple')).toThrow()
  })
})

describe('the value bands', () => {
  it('leaves a real gap between every pair', () => {
    // The gaps are the whole mechanism. Bands that touch are one band.
    expect(VALUE_BANDS.anchor[1]).toBeLessThan(VALUE_BANDS.midground[0])
    expect(VALUE_BANDS.midground[1]).toBeLessThan(VALUE_BANDS.gameplay[0])
    expect(VALUE_BANDS.gameplay[1]).toBeLessThan(VALUE_BANDS.background[0])
  })

  it('gives the anchor band a floor below anything the world had reached', () => {
    /*
      The band exists because nothing was ever asked to be darker than the
      bible's 0.20 midground floor, and nothing was: a fresh capture of
      `hub-establishing` at high measured 1.59% of the frame below 0.20 and
      exactly nothing below 0.10. A fourth band whose ceiling sat at, say, 0.24
      would be the midground with a new name and would change no pixel.
    */
    expect(VALUE_BANDS.anchor[0]).toBeLessThan(0.1)
    expect(VALUE_BANDS.anchor[1]).toBeLessThanOrEqual(0.18)
  })

  it('puts every walkable surface in the gameplay band', () => {
    for (const hex of [palette.rock, palette.grass, palette.bandDeckTop, palette.bandDeckSide]) {
      const luma = displayLuma(hex)
      expect(luma, hex).toBeGreaterThanOrEqual(VALUE_BANDS.gameplay[0])
      expect(luma, hex).toBeLessThanOrEqual(VALUE_BANDS.gameplay[1])
    }
  })

  it('puts every unwalkable surface in the midground band', () => {
    // `soil` is the island's cliff face. It sat at 0.568 - inside the gameplay
    // band - which is why the island used to read as having no thickness.
    for (const hex of [palette.soil, palette.bandTrim, palette.bandFrame]) {
      const luma = displayLuma(hex)
      expect(luma, hex).toBeGreaterThanOrEqual(VALUE_BANDS.midground[0])
      expect(luma, hex).toBeLessThanOrEqual(VALUE_BANDS.midground[1])
    }
  })

  it('separates a deck top from its own side face', () => {
    /*
      Both are band 1, and they have to be, because both are things the eye
      reads as the same material. What makes a raised deck read as raised is the
      step between them, and 0.146 is enough to see without either leaving the
      band.
    */
    const step = displayLuma(palette.bandDeckTop) - displayLuma(palette.bandDeckSide)
    expect(step).toBeGreaterThan(0.1)
    expect(step).toBeLessThan(0.2)
  })

  it('keeps the character above every surface it stands on', () => {
    /*
      Not a band of its own, and deliberately not constrained to one. The shell
      is the brightest thing in the frame by design, which is what lets a small
      character hold a wide shot. The requirement is only that it clears the
      deck it is most often seen against by enough to survive desaturation.
    */
    expect(displayLuma(palette.shell) - displayLuma(palette.rock)).toBeGreaterThan(0.15)
  })
})

describe('band()', () => {
  it('returns the colour when the claim is true', () => {
    expect(band(palette.rock, 'gameplay')).toBe(palette.rock)
    expect(band(palette.soil, 'midground')).toBe(palette.soil)
  })

  it('throws when the claim is false, and names the number', () => {
    /*
      Loud rather than warning, because a surface in the wrong band is the one
      defect the whole art direction is organised around, and a console warning
      in a scene that still renders is a warning nobody reads.
    */
    expect(() => band(palette.soil, 'gameplay')).toThrow(/0\.319/)
    expect(() => band(palette.rock, 'midground')).toThrow(/gameplay|midground/)
  })

  it('refuses the anchor band outright, rather than checking it', () => {
    /*
      The one band no albedo can claim, and refusing it is the point rather than
      a limitation. Round 1's verdict was that the value structure had been
      applied to the palette table instead of to the frame; the anchor band is
      where that gap is widest, because a surface gets there by facing away from
      a steeply overhead key. `soilDeep` is 0.414 as a hex and renders at 0.20 to
      0.25, and the 0.197 hex it replaced would have rendered near 0.06 - so the
      hex predicts the rendered value neither in magnitude nor in direction.

      The type signature already excludes it. This catches a caller who has cast
      around the type, which is exactly what someone reaching for it would do.
    */
    // @ts-expect-error - excluded from band()'s parameter type on purpose.
    expect(() => band('#2a1f14', 'anchor')).toThrow(/__dev\.sample/)
  })
})
