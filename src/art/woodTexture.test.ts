import { describe, expect, it } from 'vitest'
import {
  WOOD,
  WOOD_WARMTH,
  woodAlbedoBytes,
  woodGrain,
  woodHeight,
  woodNoise,
} from './woodTexture'

const field = (spec = WOOD) => {
  const { wander, fibre } = woodNoise(spec)
  return (u: number, v: number) => woodGrain(u, v, wander, fibre, spec)
}

describe('the grain is grain', () => {
  it('stays inside the unit interval everywhere', () => {
    /*
      It is a MULTIPLIER. Above 1 it would brighten the plank past its own
      colour, which on a prop that is meant to be the one warm thing in a cool
      round is how a coin ends up looking lit from inside.
    */
    const g = field()
    for (let y = 0; y <= 40; y++) {
      for (let x = 0; x <= 40; x++) {
        const value = g(x / 40, y / 40)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('actually gets dark enough to read as a line', () => {
    // A field that never leaves the top decile is a beige disc with a rumour of
    // grain on it, which is what the first pass at every procedural wood is.
    const g = field()
    let min = 1
    for (let y = 0; y <= 60; y++) for (let x = 0; x <= 60; x++) min = Math.min(min, g(x / 60, y / 60))
    expect(min).toBeLessThan(0.75)
  })

  it('spends most of its area LIGHT, which is what makes it wood and not stripes', () => {
    /*
      Earlywood is the broad pale band and latewood the thin dark one. A
      symmetric field - which is what `lineSharpness` 1 would give - divides the
      board half and half and reads as a painted barcode. This pins the
      proportion rather than the exponent, so the exponent can be retuned.
    */
    const g = field()
    let light = 0
    let total = 0
    for (let y = 0; y <= 60; y++) {
      for (let x = 0; x <= 60; x++) {
        if (g(x / 60, y / 60) > 0.85) light++
        total++
      }
    }
    expect(light / total).toBeGreaterThan(0.55)
  })

  it('bends, so the board is not corduroy', () => {
    /*
      The cathedral figure. If the wander were dropped or the noise were flat,
      every column of the tile would be identical and the grain would be a set of
      perfectly straight lines - which is the tell of generated wood.
    */
    const g = field()
    // Where the darkest line sits on each row.
    const darkest: number[] = []
    for (let y = 0; y <= 20; y++) {
      let best = 1
      let bestX = 0
      for (let x = 0; x <= 200; x++) {
        const value = g(x / 200, y / 20)
        if (value < best) {
          best = value
          bestX = x / 200
        }
      }
      darkest.push(bestX)
    }
    const moved = darkest.filter((x, i) => i > 0 && Math.abs(x - darkest[i - 1]) > 0.004).length
    expect(moved).toBeGreaterThan(10)
  })
})

describe('it tiles around the rim', () => {
  it('meets itself at u 0 and u 1', () => {
    /*
      The disc is a cylinder and its SIDE wraps in u. A field that did not close
      would put a hard vertical line down the rim of every coin - and on a prop
      the player is aiming at, a stripe down the edge reads as a seam in the
      model rather than as a texture bug.

      It closes because `lines` is a whole number and `valueNoise` is periodic;
      this is what stops somebody making `lines` 9.5 to taste.
    */
    expect(Number.isInteger(WOOD.lines)).toBe(true)
    const g = field()
    for (let y = 0; y <= 20; y++) {
      const v = y / 20
      expect(g(0, v), `row ${v}`).toBeCloseTo(g(1, v), 10)
    }
  })
})

describe('the maps', () => {
  it('writes a full opaque tile of the size asked for', () => {
    const bytes = woodAlbedoBytes(16)
    expect(bytes.length).toBe(16 * 16 * 4)
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255)
  })

  it('tilts warm into the dark and stays neutral in the light', () => {
    /*
      Latewood is browner, not merely darker. The tilt has to be a function of
      HOW dark, or clear earlywood picks up a tint it should not have and the
      whole board goes orange.
    */
    const { wander, fibre } = woodNoise()
    const size = 64
    const bytes = woodAlbedoBytes(size)
    let checkedDark = false
    let checkedLight = false
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const g = woodGrain(x / size, y / size, wander, fibre)
        const i = (y * size + x) * 4
        if (g < 0.7 && !checkedDark) {
          expect(bytes[i]).toBeGreaterThan(bytes[i + 2])
          checkedDark = true
        }
        if (g > 0.995 && !checkedLight) {
          expect(Math.abs(bytes[i] - bytes[i + 2])).toBeLessThanOrEqual(1)
          checkedLight = true
        }
      }
    }
    expect(checkedDark && checkedLight, 'the tile had no dark or no light pixel').toBe(true)
    expect(WOOD_WARMTH).toBeLessThan(0.1)
  })

  it('centres the height field on 0.5, which both consumers assume', () => {
    /*
      `normalFromHeight` and `ormFromHeight` read this as a SIGNED relief about
      0.5 - `ormFromHeight` literally computes `height[i] - 0.5`. A field
      centred anywhere else biases every pixel to one side and the occlusion map
      comes out uniformly dark or uniformly blown.
    */
    const height = woodHeight(48)
    let max = 0
    for (const value of height) max = Math.max(max, value)
    expect(max).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(max).toBeGreaterThan(0.47)
  })

  it('is reproducible from its seed', () => {
    expect(Array.from(woodAlbedoBytes(16, WOOD, 7))).toEqual(Array.from(woodAlbedoBytes(16, WOOD, 7)))
    expect(Array.from(woodAlbedoBytes(16, WOOD, 7))).not.toEqual(Array.from(woodAlbedoBytes(16, WOOD, 8)))
  })
})
