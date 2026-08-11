import { describe, it, expect } from 'vitest'
import { linearToSrgb, srgbToLinear } from './materials'
import { GROUND_BASE_LIFT, GROUND_TRACE_ALPHA_MAX, groundBaseColor } from './groundTexture'
import { VALUE_BANDS, displayLuma, palette } from './palette'

/**
 * The ground the whole lawn is read against.
 *
 * This is the surface the blades stand in and the one the critique's F1 uses as
 * its proof that the target is reachable: at the low tier, where the field is
 * barely there, this colour renders at 0.609-0.620 while the same lawn at high
 * measures 0.206-0.273. Whatever the blades end up doing, this number is the
 * floor under them and it must not move.
 *
 * The lift has been wrong before, at 0.34, which put the lawn brighter than the
 * deck stone standing on it and failed the greyscale test outright - so it gets
 * a test rather than a comment. Everything else about the ground texture needs
 * a canvas and belongs in a browser capture.
 */
describe('the ground and blade base colour', () => {
  it('sits inside the gameplay band', () => {
    const [lo, hi] = VALUE_BANDS.gameplay
    const luma = displayLuma(`#${groundBaseColor().getHexString()}`)
    expect(luma).toBeGreaterThanOrEqual(lo)
    expect(luma).toBeLessThanOrEqual(hi)
  })

  it('sits near the top of the band, but under the deck tops at 0.735', () => {
    /*
      The order matters more than either value: lawn under deck under sky is
      what makes a desaturated frame legible, and the failure this replaced was
      the lawn at 0.83 against a deck at 0.85.
    */
    const luma = displayLuma(`#${groundBaseColor().getHexString()}`)
    expect(luma).toBeGreaterThan(0.68)
    expect(luma).toBeLessThan(0.735)
  })

  it('keeps the lift at the value the art bible section 8 table records', () => {
    expect(GROUND_BASE_LIFT).toBeCloseTo(0.12, 5)
  })
})

describe('the plateau circuit marks', () => {
  /*
    The brief for this pass said the traces are faint because their alpha is too
    low at 0.10 to 0.22, and asked for more. This is the arithmetic that says
    otherwise, pinned so the conclusion survives the next person who reads the
    alphas and reaches for a bigger number.

    A canvas composites in BYTE space, so a mark at alpha `a` over the base lands
    at `base * (1 - a) + grassDeep * a` per channel. That albedo is then lit, and
    the plateau MEASURED renders at 0.650 against its 0.7261 albedo - the
    bald-ring finding recorded at `HubIsland.tsx:705-712`, 0.650 against 0.512 two
    hundred pixels away. The lighting factor implied by that pair is what turns an
    albedo into the number the band test actually judges.
  */
  const RENDERED_BASE = 0.65
  const channels = (hex: string) => {
    const raw = hex.replace('#', '')
    return [0, 1, 2].map((i) => parseInt(raw.slice(i * 2, i * 2 + 2), 16) / 255)
  }
  const lumaOf = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

  const base = channels(`#${groundBaseColor().getHexString()}`)
  const deep = channels(palette.grassDeep)
  // The linear factor that takes this albedo to the value it was measured at.
  const light = srgbToLinear(RENDERED_BASE) / srgbToLinear(lumaOf(base))

  /** What a mark at `alpha` renders at, in display luma. */
  const rendered = (alpha: number) => {
    const mixed = [0, 1, 2].map((i) => base[i] * (1 - alpha) + deep[i] * alpha)
    return mixed.reduce(
      (sum, channel, i) =>
        sum + [0.2126, 0.7152, 0.0722][i] * linearToSrgb(Math.min(1, srgbToLinear(channel) * light)),
      0,
    )
  }

  it('keeps the hardest mark inside the gameplay band', () => {
    const [floor] = VALUE_BANDS.gameplay
    expect(rendered(GROUND_TRACE_ALPHA_MAX)).toBeGreaterThan(floor)
    // With margin left for the lightmap bake arriving on this surface, which
    // multiplies albedo exactly as this compositing does.
    expect(rendered(GROUND_TRACE_ALPHA_MAX) - floor).toBeGreaterThan(0.015)
    expect(rendered(GROUND_TRACE_ALPHA_MAX)).toBeCloseTo(0.5805, 3)
  })

  it('shows the old end-pad alpha was already out of band', () => {
    /*
      The defect this replaced, as a number. The traces were drawn at up to alpha
      0.22 and their end pads at `alpha * 1.5`, so the pads reached 0.33 - which
      renders at 0.5545, below the gameplay floor of 0.56, on the largest surface
      in the frame. It survived because the alpha was written as a drawing
      parameter and never converted into the space the band rule is stated in.
    */
    const [floor] = VALUE_BANDS.gameplay
    expect(rendered(0.22 * 1.5)).toBeLessThan(floor)
    expect(rendered(0.22 * 1.5)).toBeCloseTo(0.5545, 3)
    // And the capped pad is legal, which is the fix.
    expect(rendered(Math.min(GROUND_TRACE_ALPHA_MAX, 0.24 * 1.4))).toBeGreaterThan(floor)
  })

  it('proves alpha was never the lever, so the width had to be', () => {
    /*
      The whole argument in one assertion. Going from the old ceiling to the
      largest legal alpha buys 0.006 of rendered luma - a fifth of what one 8-bit
      step of the texture is worth. The mark was invisible because at 128 texels
      per metre a 2 to 7 pixel stroke is 16 to 55 mm of world against roughly 26 to
      40 mm per screen pixel, which is sub-pixel at the thin end. Contrast cannot
      rescue a mark below the sampling limit, in any channel, at any alpha.
    */
    expect(rendered(0.22) - rendered(GROUND_TRACE_ALPHA_MAX)).toBeLessThan(0.01)
    const oldThinMm = (2 / (1024 / 8)) * 1000
    const newThinMm = (6 / (1024 / 8)) * 1000
    expect(oldThinMm).toBeLessThan(26)
    expect(newThinMm).toBeGreaterThan(40)
  })
})
