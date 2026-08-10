import { describe, it, expect } from 'vitest'
import { GROUND_BASE_LIFT, groundBaseColor } from './groundTexture'
import { VALUE_BANDS, displayLuma } from './palette'

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
