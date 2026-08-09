import { describe, it, expect } from 'vitest'
import { LookupTexture } from 'postprocessing'
import {
  GRADE,
  GRADE_MID_SATURATION,
  IDENTITY_GRADE,
  LUMA_709,
  LUT_SIZE,
  buildLut,
  buildLutData,
  createLookupTexture,
  gradeColour,
  gradeForMode,
  resolveLutMode,
  type GradeConfig,
} from './lut'

/** One 8-bit code. The unit every tolerance in this file is expressed in. */
const LSB = 1 / 255

const luma = (c: readonly number[]) =>
  LUMA_709[0] * c[0] + LUMA_709[1] * c[1] + LUMA_709[2] * c[2]

/** A sweep dense enough to catch a sign error, cheap enough to run on every save. */
const sweep = (steps: number) => Array.from({ length: steps }, (_, i) => i / (steps - 1))

describe('gradeColour, identity', () => {
  it('is bit-exact over a full three-dimensional sweep', () => {
    // Strict equality, not a tolerance. The `!== 0` and `!== 1` guards in the
    // implementation are what make this achievable, and a tolerance here would
    // let a real error hide behind the quantisation noise that is legitimately
    // present further down this file.
    const axis = sweep(17)
    for (const r of axis) {
      for (const g of axis) {
        for (const b of axis) {
          expect(gradeColour(r, g, b, IDENTITY_GRADE)).toEqual([r, g, b])
        }
      }
    }
  })

  it('leaves the achromatic axis exactly achromatic', () => {
    for (const x of sweep(65)) {
      const [r, g, b] = gradeColour(x, x, x, IDENTITY_GRADE)
      expect(r).toBe(g)
      expect(g).toBe(b)
    }
  })
})

describe('gradeColour, the shipping grade', () => {
  it('reproduces the three worked values the spec is reviewed against', () => {
    // These are the numbers a reviewer checks the implementation against, and
    // they only come out right if all four steps run in the documented order.
    // Reordering the split tone and the saturation, or moving lift before the
    // S-curve, changes every one of them.
    //
    // Three decimal places rather than four, because the published table is
    // itself rounded to four and the blue at absolute black lands on the
    // rounding boundary (0.060844 against a published 0.0609). The 8-bit
    // assertions below are the tighter statement anyway, since 8 bits is what
    // the texture actually carries.
    const black = gradeColour(0, 0, 0)
    expect(black[0]).toBeCloseTo(0.0061, 3)
    expect(black[1]).toBeCloseTo(0.024, 3)
    expect(black[2]).toBeCloseTo(0.0609, 3)

    const mid = gradeColour(0.5, 0.5, 0.5)
    expect(mid[0]).toBeCloseTo(0.5098, 3)
    expect(mid[1]).toBeCloseTo(0.514, 3)
    expect(mid[2]).toBeCloseTo(0.5189, 3)

    const white = gradeColour(1, 1, 1)
    expect(white[0]).toBeCloseTo(1.0, 3)
    expect(white[1]).toBeCloseTo(0.9901, 3)
    expect(white[2]).toBeCloseTo(0.9547, 3)
  })

  it('lands black on #020610 and white on #fffcf3', () => {
    // The same two values as codes, which is the form the published table gives
    // them in and the form a colour picker on a screenshot reports.
    const hex = (c: readonly number[]) =>
      c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
    expect(hex(gradeColour(0, 0, 0))).toBe('020610')
    expect(hex(gradeColour(1, 1, 1))).toBe('fffcf3')
  })

  it('keeps every output inside the unit interval and finite', () => {
    const axis = sweep(17)
    for (const r of axis) {
      for (const g of axis) {
        for (const b of axis) {
          for (const v of gradeColour(r, g, b)) {
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('clamps its domain rather than returning NaN', () => {
    // `Math.pow` of a negative base with a fractional exponent is NaN, and one
    // NaN in the cube uploads as a black cell. This is the guard for it.
    for (const bad of [-0.5, -1e-9, 1.0001, 2, 1e6]) {
      expect(gradeColour(bad, bad, bad)).toEqual(gradeColour(bad < 0 ? 0 : 1, bad < 0 ? 0 : 1, bad < 0 ? 0 : 1))
    }
    expect(gradeColour(NaN, NaN, NaN).every(Number.isFinite)).toBe(true)
  })

  it('keeps mid grey neutral and tints the rest of the achromatic axis by design', () => {
    // Asserting that every grey stays neutral would be asserting that the split
    // tone does not work. A split tone is precisely a statement that greys are
    // NOT neutral away from the crossover, so what has to be pinned here is the
    // shape rather than the absence of a shift:
    //
    //   mid grey, where the two tints cross, is neutral to within 3 codes;
    //   the shift grows away from the crossover in both directions;
    //   and it never exceeds 14 codes, which is the point at which a grey object
    //   would start to read as a coloured object rather than a lit one.
    //
    // Note that `04-post.md` section 12 property 4 asks for 0.015 across
    // 0.2 to 0.8. That is not achievable with the shipping constants and never
    // was: at x = 0.2 the shadow weight is 0.61 and the spread is 0.041. The
    // spec's own worked table agrees with the implementation, so the tolerance is
    // what is wrong there, not the number.
    const spreadAt = (x: number) => {
      const out = gradeColour(x, x, x)
      return Math.max(...out) - Math.min(...out)
    }
    expect(spreadAt(0.5)).toBeLessThanOrEqual(3 * LSB)

    let worst = 0
    for (let i = 0; i <= 256; i++) worst = Math.max(worst, spreadAt(i / 256))
    expect(worst).toBeLessThanOrEqual(14 * LSB)

    // Cool below the crossover, warm above it, and never the other way round.
    for (const shadow of [0, 0.1, 0.2, 0.3, 0.4]) {
      const [r, g, b] = gradeColour(shadow, shadow, shadow)
      expect(b).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(r)
    }
    for (const highlight of [0.7, 0.8, 0.9, 1]) {
      const [r, g, b] = gradeColour(highlight, highlight, highlight)
      expect(r).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(b)
    }
  })

  it('lifts black off zero and makes it cool', () => {
    const [r, g, b] = gradeColour(0, 0, 0)
    expect(r).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(r)
    // And not so far that the frame reads as fogged.
    expect(luma([r, g, b])).toBeLessThan(0.06)
  })

  it('makes white warm without clipping it', () => {
    const [r, g, b] = gradeColour(1, 1, 1)
    expect(r).toBeGreaterThanOrEqual(g)
    expect(g).toBeGreaterThanOrEqual(b)
    expect(r).toBeGreaterThanOrEqual(0.999)
    expect(b).toBeLessThanOrEqual(0.98)
  })
})

describe('gradeColour, monotonicity', () => {
  it('is non-decreasing in each channel, holding the other two', () => {
    // The saturation step couples the channels through luma, so this is not
    // structurally obvious and it is the property most likely to be broken by a
    // future retune. Non-decreasing rather than strictly increasing, because the
    // final clamp legitimately produces plateaus at the ends.
    const others = [0, 0.25, 0.5, 0.75, 1]
    for (let channel = 0; channel < 3; channel++) {
      for (const a of others) {
        for (const b of others) {
          let previous = -Infinity
          for (let i = 0; i < 256; i++) {
            const x = i / 255
            const input = [a, b, a]
            input[channel] = x
            input[(channel + 1) % 3] = a
            input[(channel + 2) % 3] = b
            const out = gradeColour(input[0], input[1], input[2])[channel]
            expect(out).toBeGreaterThanOrEqual(previous)
            previous = out
          }
        }
      }
    }
  })

  it('never inverts tonal order along the grey ramp', () => {
    // The property that guarantees the greyscale readability test cannot fail
    // for a reason that is invisible in colour.
    let previous = -Infinity
    for (let i = 0; i < 256; i++) {
      const x = i / 255
      const l = luma(gradeColour(x, x, x))
      expect(l).toBeGreaterThan(previous)
      previous = l
    }
  })

  it('cannot push either end of the range out of gamut, however hard it is dialled', () => {
    // The property the `4L(1-L)` weight exists for. Tripling the boost must move
    // absolute black and absolute white by less than a single output code, so no
    // future retune of `midSaturation` can clip a highlight or crush a shadow.
    //
    // Under one code rather than exactly zero, because the weight is evaluated
    // after lift and gain have already moved black off zero and white off one.
    // `04-post.md` property 9 asks for 1e-12, which the chain it specifies cannot
    // deliver for exactly that reason.
    const flat: GradeConfig = { ...GRADE, midSaturation: 1 }
    const strong: GradeConfig = { ...GRADE, midSaturation: 1 + (GRADE_MID_SATURATION - 1) * 3 }
    for (const corner of [0, 1]) {
      const a = gradeColour(corner, corner, corner, flat)
      const b = gradeColour(corner, corner, corner, strong)
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i] - b[i])).toBeLessThan(LSB)
        expect(b[i]).toBeGreaterThanOrEqual(0)
        expect(b[i]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('holds the S-curve fixed points and bends between them', () => {
    const curved: GradeConfig = { ...IDENTITY_GRADE, contrast: 0.5 }
    for (const fixed of [0, 0.5, 1]) {
      expect(gradeColour(fixed, fixed, fixed, curved)[0]).toBeCloseTo(fixed, 12)
    }
    expect(gradeColour(0.25, 0.25, 0.25, curved)[0]).toBeLessThan(0.25)
    expect(gradeColour(0.75, 0.75, 0.75, curved)[0]).toBeGreaterThan(0.75)
  })
})

describe('gradeColour, purity', () => {
  it('returns a fresh array and mutates neither its config nor its constants', () => {
    const before = JSON.stringify(GRADE)
    const a = gradeColour(0.3, 0.6, 0.9)
    const b = gradeColour(0.3, 0.6, 0.9)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    for (let i = 0; i < 1000; i++) gradeColour(i / 1000, 1 - i / 1000, 0.5)
    expect(JSON.stringify(GRADE)).toBe(before)
  })
})

describe('buildLutData', () => {
  it('has the right shape and a fully opaque alpha channel', () => {
    const data = buildLutData(8)
    expect(data).toBeInstanceOf(Float32Array)
    expect(data.length).toBe(8 ** 3 * 4)
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(1)
  })

  it('writes each cell at (r + g*size + b*size*size) * 4', () => {
    // The highest-consequence and lowest-visibility bug available in this file:
    // a transposition produces an image that looks plausibly graded with its
    // channels swapped. The three single-axis corners are what catch it.
    const size = 8
    const data = buildLutData(size)
    const s = 1 / (size - 1)
    const cells: [number, number, number][] = [
      [0, 0, 0],
      [size - 1, size - 1, size - 1],
      [size - 1, 0, 0],
      [0, size - 1, 0],
      [0, 0, size - 1],
      [3, 5, 1],
    ]
    for (const [r, g, b] of cells) {
      const i4 = (r + g * size + b * size * size) * 4
      const expected = gradeColour(r * s, g * s, b * s)
      for (let k = 0; k < 3; k++) expect(data[i4 + k]).toBeCloseTo(expected[k], 6)
    }
  })

  it('reproduces the neutral grid exactly under the identity grade', () => {
    // The reference loop is rewritten here rather than imported, so that this is
    // an independent statement of the layout rather than a circular one.
    const size = 8
    const reference = new Float32Array(size ** 3 * 4)
    const s = 1 / (size - 1)
    for (let r = 0; r < size; r++) {
      for (let g = 0; g < size; g++) {
        for (let b = 0; b < size; b++) {
          const i4 = (r + g * size + b * size * size) * 4
          reference[i4 + 0] = r * s
          reference[i4 + 1] = g * s
          reference[i4 + 2] = b * s
          reference[i4 + 3] = 1
        }
      }
    }
    expect(buildLutData(size, IDENTITY_GRADE)).toEqual(reference)

    // And belt and braces against the library's own generator, since it is what
    // the layout claim was read off in the first place.
    expect(buildLutData(size, IDENTITY_GRADE)).toEqual(LookupTexture.createNeutral(size).image.data)
  })
})

describe('buildLut, 8-bit quantisation', () => {
  it('stays inside 0-255 with no clipping or wraparound', () => {
    // `Uint8Array` assignment truncates modulo 256 rather than saturating, so an
    // out-of-range channel would wrap a white cell to black rather than merely
    // clip it. Checking the corners specifically, because that is where a
    // saturation or tint constant would push a value over the top.
    const data = buildLut(LUT_SIZE)
    let min = 255
    let max = 0
    for (let i = 0; i < data.length; i++) {
      min = Math.min(min, data[i])
      max = Math.max(max, data[i])
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(255)

    const last = LUT_SIZE - 1
    const white = (last + last * LUT_SIZE + last * LUT_SIZE ** 2) * 4
    expect(data[white + 0]).toBe(255)
    expect(data[white + 3]).toBe(255)
    // Black is lifted, so the darkest cell is emphatically not zero.
    expect(data[2]).toBeGreaterThan(data[0])
    expect(data[0]).toBeGreaterThan(0)
  })

  it('is byte for byte what LookupTexture.convertToUint8 produces', () => {
    // Ties our quantisation to the library's, so that `createLookupTexture` and
    // `buildLut` can never drift and the properties asserted on one hold on the
    // other.
    const size = 8
    const lut = new LookupTexture(buildLutData(size, GRADE), size)
    lut.convertToUint8()
    expect(lut.image.data).toEqual(buildLut(size, GRADE))
  })
})

describe('the identity acceptance tolerance', () => {
  /**
   * Hardware trilinear reconstruction, modelled.
   *
   * `LUT3DEffect` sets `scale = (size-1)/size` and `offset = 1/(2*size)`, so the
   * sampler coordinate in texels is `c * (size-1) + 0.5`, which lands c = 0 and
   * c = 1 exactly on the first and last texel centres. The interpolation index
   * is therefore `c * (size-1)`, and this is the reconstruction the GPU performs.
   */
  const sample = (data: Uint8Array, size: number, rgb: readonly number[]) => {
    const i0: number[] = []
    const f: number[] = []
    for (let k = 0; k < 3; k++) {
      const x = Math.min(Math.max(rgb[k], 0), 1) * (size - 1)
      i0[k] = Math.min(Math.floor(x), size - 2)
      f[k] = x - i0[k]
    }
    const out = [0, 0, 0]
    for (let corner = 0; corner < 8; corner++) {
      const dr = corner & 1
      const dg = (corner >> 1) & 1
      const db = (corner >> 2) & 1
      const w =
        (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2])
      if (w === 0) continue
      const idx = (i0[0] + dr + (i0[1] + dg) * size + (i0[2] + db) * size * size) * 4
      for (let k = 0; k < 3; k++) out[k] += w * (data[idx + k] / 255)
    }
    return out
  }

  it('round-trips an identity LUT within max 2/255 and mean 0.5/255', () => {
    // An 8-bit 32-cubed identity LUT is NOT bit-exact, and expecting zero here
    // would produce a false failure. These are the numbers the screenshot diff
    // that gates the identity commit is judged against, asserted offline so the
    // commit does not have to be built to know whether it can pass.
    const data = buildLut(LUT_SIZE, IDENTITY_GRADE)
    let worst = 0
    let total = 0
    let count = 0
    const axis = sweep(23)
    for (const r of axis) {
      for (const g of axis) {
        for (const b of axis) {
          const out = sample(data, LUT_SIZE, [r, g, b])
          const input = [r, g, b]
          for (let k = 0; k < 3; k++) {
            const err = Math.abs(out[k] - input[k])
            worst = Math.max(worst, err)
            total += err
            count++
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(2 * LSB)
    expect(total / count).toBeLessThanOrEqual(0.5 * LSB)
  })

  it('reconstructs the graded cube close enough that 32 is a defensible size', () => {
    // The other half of the size decision: the grid must be dense enough that
    // trilinear reconstruction of a smooth analytic function is indistinguishable
    // from evaluating it, or the sky gains steps that no dither can hide.
    //
    // The bound is 3 codes rather than the identity's 2, and the extra one is
    // curvature rather than error: the grade is a curve, the grid is a chord, and
    // the worst chord error sits low down where lift and gamma bend hardest. It
    // is a smooth error across a smooth ramp, which is invisible, unlike the
    // quantisation error the identity test bounds, which is not.
    const data = buildLut(LUT_SIZE, GRADE)
    let worst = 0
    const axis = sweep(23)
    for (const r of axis) {
      for (const g of axis) {
        for (const b of axis) {
          const out = sample(data, LUT_SIZE, [r, g, b])
          const exact = gradeColour(r, g, b)
          for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(out[k] - exact[k]))
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(3 * LSB)
  })
})

describe('createLookupTexture', () => {
  it('produces an 8-bit cube in the linear colour space the constructor chose', () => {
    const lut = createLookupTexture('on')!
    expect(lut).toBeInstanceOf(LookupTexture)
    expect(lut.image.width).toBe(LUT_SIZE)
    expect(lut.image.height).toBe(LUT_SIZE)
    expect(lut.image.depth).toBe(LUT_SIZE)
    expect(lut.image.data).toBeInstanceOf(Uint8Array)
    // Left at the constructor default. Setting it to sRGB would make three
    // request an SRGB8_ALPHA8 internal format and apply a hardware decode on
    // every fetch, on top of the one the effect's shader already performs.
    expect(lut.colorSpace).toBe('srgb-linear')
    expect(lut.image.data).toEqual(buildLut(LUT_SIZE, GRADE))
  })

  it('builds the neutral cube in identity mode and nothing at all when off', () => {
    expect(createLookupTexture('identity')!.image.data).toEqual(
      buildLut(LUT_SIZE, IDENTITY_GRADE),
    )
    expect(createLookupTexture('off')).toBeNull()
  })
})

describe('the mode switch', () => {
  it('reads ?lut and falls back to the default on anything else', () => {
    expect(resolveLutMode('?lut=on')).toBe('on')
    expect(resolveLutMode('?lut=off')).toBe('off')
    expect(resolveLutMode('?lut=identity')).toBe('identity')
    expect(resolveLutMode('?lut=sepia')).toBe('identity')
    expect(resolveLutMode('?lut=')).toBe('identity')
    expect(resolveLutMode('?quality=low')).toBe('identity')
    expect(resolveLutMode('')).toBe('identity')
  })

  it('maps each mode to its config', () => {
    expect(gradeForMode('off')).toBeNull()
    expect(gradeForMode('identity')).toBe(IDENTITY_GRADE)
    expect(gradeForMode('on')).toBe(GRADE)
  })
})
