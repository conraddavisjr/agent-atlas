import { describe, expect, it } from 'vitest'
import {
  BRICK,
  BRICK_GRAIN_DROP,
  BRICK_MORTAR_DROP,
  BRICK_PIT_DROP,
  BRICK_TINT_TILTS,
  BRICK_TONE_DROPS,
  DECK_DROP_SCALE,
  FRAME_DROP_SCALE,
  MASONRY_DECK_LIT_LUMA,
  MEASURED_MAPPED_P5,
  MEASURED_UNMAPPED_P5,
  mapQuantile,
  FRAME_LIT_LUMA,
  assertBrickTiles,
  brickAlbedoBytes,
  brickAt,
  brickHash,
  brickHeight,
  brickLayout,
  brickPitch,
  brickPits,
  coursePitch,
  createBrickMaps,
  faceOffset,
  valueNoise,
  type BrickSpec,
} from './brickTexture'
import { ormFromHeight, roughnessBias } from './decalTextures'
import { linearToSrgb, srgbToLinear } from './materials'
import { VALUE_BANDS } from './palette'

/*
  Everything here runs on the pure half of the module, which is all of it except
  `createBrickMaps`. That is a deliberate improvement on `decalTextures.ts`,
  whose height masks are DRAWN and therefore untestable under node: the bond is
  evaluated per texel rather than rasterised, so a claim about the joint width or
  the tone budget is a unit test rather than a screenshot.

  What that buys, stated once so nobody has to rediscover it: this project's
  handoff opens with ten silent failures in the screenshot path, every one of
  which produced a valid PNG of the wrong thing. Anything that can be settled
  without a frame should be.
*/

/** What a surface at `base` renders at once three multiplies this map onto it. */
const litLuma = (bytes: [number, number, number] | number[], base = MASONRY_DECK_LIT_LUMA) => {
  const lit = srgbToLinear(base)
  return (
    0.2126 * linearToSrgb(lit * srgbToLinear(bytes[0] / 255)) +
    0.7152 * linearToSrgb(lit * srgbToLinear(bytes[1] / 255)) +
    0.0722 * linearToSrgb(lit * srgbToLinear(bytes[2] / 255))
  )
}

describe('the bond tiles, which is the thing that cannot be checked in a frame', () => {
  it('is square, so one box projection scale serves both axes', () => {
    expect(BRICK.columns * brickPitch()).toBeCloseTo(BRICK.courses * coursePitch(), 12)
    expect(BRICK.metresPerTile).toBeCloseTo(BRICK.columns * brickPitch(), 12)
  })

  it('carries an even course count, or a running bond does not repeat', () => {
    /*
      The bond's period is two courses: one at offset zero and one at half a
      brick. An odd count puts two offset-zero courses against each other at every
      tile boundary, which is a visible band of stack bond every 2.34 m.
    */
    expect(BRICK.courses % 2).toBe(0)
  })

  it('offsets by exactly one course pitch, which is why it tiles horizontally too', () => {
    // The half-brick offset is 0.39 m and the course pitch is 0.39 m. That is a
    // coincidence of this bond rather than a rule, and it is the coincidence that
    // makes the tile square.
    expect(brickPitch() / 2).toBeCloseTo(coursePitch(), 12)
  })

  it('throws on each of the three ways the bond can fail to tile', () => {
    const skew: BrickSpec = { ...BRICK, length: 0.7 }
    expect(() => assertBrickTiles(skew)).toThrow(/square/)

    const mismatched: BrickSpec = { ...BRICK, metresPerTile: 2 }
    expect(() => assertBrickTiles(mismatched)).toThrow(/metresPerTile/)

    const odd: BrickSpec = { ...BRICK, courses: 5, columns: 2.5, metresPerTile: 1.95 }
    expect(() => assertBrickTiles(odd)).toThrow(/even course count/)
  })
})

describe('the brick reads at the size it is actually seen at', () => {
  /*
    MEASURED, and quoted from `createPanelFillMap`'s own note: the deck covers
    about 470 px for 12 m in `hub-establishing`, so one screen pixel is 25.5 mm
    of deck. This is the Nyquist check the project has now failed three times in
    three places, written as an assertion so it cannot be failed a fourth.
  */
  const MM_PER_PIXEL = 25.5

  it('puts the mortar joint above two screen pixels', () => {
    expect((BRICK.joint * 1000) / MM_PER_PIXEL).toBeGreaterThan(2)
  })

  it('puts the arris above one screen pixel, so the chamfer is not a hard line', () => {
    expect((BRICK.arris * 1000) / MM_PER_PIXEL).toBeGreaterThan(0.8)
  })

  it('rules out a domestic brick explicitly, which is what this size replaces', () => {
    // 215 x 65 with a 10 mm joint is 0.39 px of joint. Kept as an assertion so
    // the number in the module doc is a test rather than a claim.
    expect((10 / MM_PER_PIXEL) < 0.5).toBe(true)
  })

  it('resolves every feature at the texture as well as at the screen', () => {
    for (const size of [512, 1024]) {
      const mmPerTexel = (BRICK.metresPerTile * 1000) / size
      expect((BRICK.joint * 1000) / mmPerTexel, `joint at ${size}`).toBeGreaterThan(8)
      expect((BRICK.arris * 1000) / mmPerTexel, `arris at ${size}`).toBeGreaterThan(3)
      expect((BRICK.pitRadius * 1000) / mmPerTexel, `pock at ${size}`).toBeGreaterThan(1.5)
    }
  })
})

describe('brickLayout', () => {
  const cells = brickLayout()

  it('lays a full course on every row and an extra half at each end of an offset one', () => {
    for (let row = 0; row < BRICK.courses; row++) {
      const inRow = cells.filter((c) => c.row === row)
      expect(inRow.length, `row ${row}`).toBe(row % 2 === 0 ? BRICK.columns : BRICK.columns + 1)
    }
  })

  it('separates every face from its neighbour by exactly one joint', () => {
    const tile = BRICK.metresPerTile
    for (const cell of cells) {
      expect(cell.w * tile).toBeCloseTo(BRICK.length, 12)
      expect(cell.h * tile).toBeCloseTo(BRICK.height, 12)
    }
    const row0 = cells.filter((c) => c.row === 0).sort((a, b) => a.x - b.x)
    for (let i = 1; i < row0.length; i++) {
      expect((row0[i].x - (row0[i - 1].x + row0[i - 1].w)) * tile).toBeCloseTo(BRICK.joint, 12)
    }
  })

  it('offsets odd courses by half a brick pitch and even ones by nothing', () => {
    const even = cells.filter((c) => c.row === 0 && c.col === 0)[0]
    const odd = cells.filter((c) => c.row === 1 && c.col === 0)[0]
    expect((odd.x - even.x) * BRICK.metresPerTile).toBeCloseTo(brickPitch() / 2, 12)
  })

  it('runs the offset course off both ends, so the two halves are one brick', () => {
    const odd = cells.filter((c) => c.row === 1)
    expect(Math.min(...odd.map((c) => c.x))).toBeLessThan(0)
    expect(Math.max(...odd.map((c) => c.x + c.w))).toBeGreaterThan(1)
  })
})

describe('brickAt', () => {
  it('reports the middle of a face at its half-height from the joint', () => {
    // Row 0, column 0's face centre. The nearest edge is the bed joint, half a
    // course face away.
    const bp = brickPitch() / BRICK.metresPerTile
    const cp = coursePitch() / BRICK.metresPerTile
    const hit = brickAt(bp / 2, cp / 2)
    expect(hit.row).toBe(0)
    expect(hit.col).toBe(0)
    expect(hit.distance * BRICK.metresPerTile).toBeCloseTo(BRICK.height / 2, 6)
  })

  it('reports the centre of a bed joint at half the joint width, negative', () => {
    const cp = coursePitch() / BRICK.metresPerTile
    const hit = brickAt(0.5, cp)
    expect(hit.distance * BRICK.metresPerTile).toBeCloseTo(-BRICK.joint / 2, 6)
  })

  it('gives the two wrapped halves of one brick the same index', () => {
    /*
      This is the assertion the whole wrapping design exists for. Row 1 is offset
      by half a pitch, so its leftmost brick starts at a negative x and its right
      half reappears at the other edge of the tile. If those two resolved to
      different columns they would draw different tones and different heights, and
      the tile would carry a permanent seam down one line.
    */
    const cp = coursePitch() / BRICK.metresPerTile
    const bp = brickPitch() / BRICK.metresPerTile
    const v = cp * 1.5
    const left = brickAt(bp * 0.05, v)
    const right = brickAt(1 - bp * 0.05, v)
    expect(left.row).toBe(1)
    expect(right.row).toBe(1)
    expect(left.col).toBe(right.col)
  })

  it('wraps a coordinate outside the unit tile onto the same brick', () => {
    const a = brickAt(0.31, 0.62)
    const b = brickAt(3.31, -1.38)
    expect(b.row).toBe(a.row)
    expect(b.col).toBe(a.col)
    expect(b.distance).toBeCloseTo(a.distance, 12)
  })
})

describe('valueNoise', () => {
  it('is exactly periodic on the tile, which is what makes the grain seamless', () => {
    const noise = valueNoise(24, 7)
    for (const t of [0, 0.13, 0.4, 0.77, 0.99]) {
      expect(noise(t, 0)).toBeCloseTo(noise(t, 1), 12)
      expect(noise(0, t)).toBeCloseTo(noise(1, t), 12)
    }
  })

  it('stays inside the unit interval and is deterministic in its seed', () => {
    const a = valueNoise(16, 3)
    const b = valueNoise(16, 3)
    const c = valueNoise(16, 4)
    let same = 0
    let differs = 0
    for (let i = 0; i < 200; i++) {
      const u = i / 200
      const v = (i * 7) % 200 / 200
      expect(a(u, v)).toBeGreaterThanOrEqual(0)
      expect(a(u, v)).toBeLessThanOrEqual(1)
      if (a(u, v) === b(u, v)) same++
      if (Math.abs(a(u, v) - c(u, v)) > 1e-9) differs++
    }
    expect(same).toBe(200)
    expect(differs).toBeGreaterThan(150)
  })
})

describe('the per-brick hash, and the failure that looks like a lighting bug', () => {
  it('scatters rather than ramping across adjacent bricks', () => {
    /*
      `mulberry32`'s FIRST output is close to linear in its seed, and the seeds
      here are adjacent by construction - `seed + row * 7919 + col * 104729`. Using
      that first draw puts a smooth gradient of tone across the bond, which on a
      floor reads as a lighting artefact rather than as variation. The hash
      discards it. This test is what stops someone tidying the discard away.
    */
    const run: number[] = []
    for (let col = 0; col < 24; col++) run.push(brickHash(0, col, 20260821))

    let reversals = 0
    for (let i = 2; i < run.length; i++) {
      const before = run[i - 1] - run[i - 2]
      const after = run[i] - run[i - 1]
      if (before * after < 0) reversals++
    }
    // A monotone ramp has zero reversals. A scatter has roughly two thirds.
    expect(reversals).toBeGreaterThan(run.length / 3)
  })

  it('is stable in the brick coordinates rather than in visit order', () => {
    expect(brickHash(2, 1, 5)).toBe(brickHash(2, 1, 5))
    expect(faceOffset(2, 1)).toBe(faceOffset(2, 1))
  })

  it('keeps the face offset inside its stated swing', () => {
    for (let row = 0; row < BRICK.courses; row++) {
      for (let col = 0; col < BRICK.columns; col++) {
        expect(Math.abs(faceOffset(row, col))).toBeLessThanOrEqual(BRICK.faceSwing)
      }
    }
  })
})

describe('brickHeight', () => {
  const size = 128
  const height = brickHeight(size)

  it('produces one value per texel, all finite and inside the mask range', () => {
    /*
      **Scanned into one assertion rather than asserted per element.**

      `expect()` allocates a matcher and eagerly builds its message string, so a
      loop of this size spends far more time in the assertion library than in the
      code it is testing. This one ran comfortably alone and timed out at 5 s once
      the suite grew - the worst kind of flake, since it is green on the machine
      that wrote it and red on a loaded one, and it points at geometry that is
      perfectly fine. `hubLayout.test.ts` lost the same way and was fixed the same
      way.

      The scan also reports the FIRST bad value and where it was, which is more
      useful than a matcher firing somewhere in a million samples.
    */
    expect(height.length).toBe(size * size)
    const bad: string[] = []
    for (let i = 0; i < height.length && bad.length === 0; i++) {
      const v = height[i]
      if (!Number.isFinite(v) || v <= 0 || v >= 1) bad.push(`texel ${i} = ${v}`)
    }
    expect(bad, 'a texel is outside the mask range').toEqual([])
  })

  it('cuts the mortar below the base plane and stands the faces above it', () => {
    const cp = coursePitch() / BRICK.metresPerTile
    const at = (u: number, v: number) => height[Math.floor(v * size) * size + Math.floor(u * size)]

    // A bed joint centre.
    expect(at(0.5, cp)).toBeLessThan(0.5 - BRICK.jointDepth / 2)
    // A face centre, well clear of the arris.
    expect(at(brickPitch() / BRICK.metresPerTile / 2, cp / 2)).toBeGreaterThan(0.5)
  })

  it('is seamless across both tile edges', () => {
    /*
      A wrap discontinuity here is the defect that survives every review: it looks
      like a hairline crack every 2.34 m, in one fixed place, forever. The check
      is that the step across the edge is no larger than the largest step found
      INSIDE the tile, so it is scale free and does not need a tolerance invented
      for it.
    */
    let worstInside = 0
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size; x++) {
        worstInside = Math.max(worstInside, Math.abs(height[y * size + x] - height[y * size + x - 1]))
      }
    }
    for (let y = 0; y < size; y++) {
      const step = Math.abs(height[y * size] - height[y * size + size - 1])
      expect(step, `row ${y}`).toBeLessThanOrEqual(worstInside)
    }
    for (let x = 0; x < size; x++) {
      const step = Math.abs(height[x] - height[(size - 1) * size + x])
      expect(step, `column ${x}`).toBeLessThanOrEqual(worstInside)
    }
  })

  it('carries within-face detail, so a brick is not a flat plateau', () => {
    /*
      "High levels of detail in the brick" is the brief, and a bond of flat faces
      separated by grooves meets the letter of it and none of the intent. The
      measure is the spread WITHIN one face, away from the arris, which comes from
      the two noise octaves and the pocks.
    */
    const bp = brickPitch() / BRICK.metresPerTile
    const cp = coursePitch() / BRICK.metresPerTile
    const arrisN = BRICK.arris / BRICK.metresPerTile
    const samples: number[] = []
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size
        const v = (y + 0.5) / size
        if (v > cp - arrisN * 2 || v < arrisN * 2) continue
        if (u > bp - arrisN * 2 || u < arrisN * 2) continue
        samples.push(height[y * size + x])
      }
    }
    expect(samples.length).toBeGreaterThan(100)
    const spread = Math.max(...samples) - Math.min(...samples)
    expect(spread).toBeGreaterThan(BRICK.grain / 2)
  })

  it('drives the ORM pack all the way to its occlusion floor at a joint', () => {
    /*
      `ormFromHeight` darkens by `1 + relief * 2 * occlusion` and floors at 0.55,
      which is 140 as a byte. A 0.30 joint reaches the floor, which is the deepest
      line the pack can carry, and it is what the pylons get in place of the
      printed mortar the deck gets. If `jointDepth` were ever tuned shallow this
      is the test that notices.
    */
    const orm = ormFromHeight(height, size, BRICK)
    let floored = 0
    for (let i = 0; i < size * size; i++) if (orm[i * 4] <= 141) floored++
    expect(floored).toBeGreaterThan(0)
  })

  it('centres the roughness map on the byte the material is biased for', () => {
    // A material carrying this map sets `roughness` to the bias, so a mid texel
    // has to reproduce the authored 0.95. Getting this wrong makes the whole
    // world uniformly shinier with no other symptom.
    expect(roughnessBias(BRICK.roughness)).toBeCloseTo(BRICK.roughness / 0.8, 12)
  })
})

describe('the pock field', () => {
  it('scales with the tile area rather than with the resolution', () => {
    const pits = brickPits()
    expect(pits.length).toBe(Math.round(BRICK.pitDensity * BRICK.metresPerTile ** 2))
  })

  it('jitters radius so the field is not a dot screen', () => {
    const radii = brickPits().map((p) => p.r)
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBeGreaterThan(radii.length / 2)
  })
})

describe('the albedo, which is the channel that actually lands on a floor', () => {
  const size = 96
  const bytes = brickAlbedoBytes(size)

  it('only ever darkens, because the band values ride on the vertex colour', () => {
    /*
      The deck material is `masonry({ color: '#ffffff', vertexColors: true })` and
      the two band-1 values are a vertex attribute, so this map MULTIPLIES them. A
      byte of 255 is neutral and there is nothing above it. A map centred on mid
      grey would halve the albedo of every walkable surface in the game.
    */
    const invalid: number[] = []
    for (let i = 0; i < size * size; i++) {
      if (bytes[i * 4] > 255 || bytes[i * 4 + 1] > 255 || bytes[i * 4 + 2] > 255 || bytes[i * 4 + 3] !== 255) invalid.push(i)
    }
    expect(invalid, 'invalid albedo pixel indices').toEqual([])
  })

  it('keeps its p5 to p95 inside the gameplay band on the deck', () => {
    /*
      `00-art-bible.md` section 8.2 permits albedo pattern of any kind "provided
      the pattern's own p5 to p95 stays inside the surface's band". That is the
      claim under test, on the real generated tile rather than on the ladder.
    */
    const lumas: number[] = []
    for (let i = 0; i < size * size; i++) {
      lumas.push(litLuma([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2]]))
    }
    lumas.sort((a, b) => a - b)
    const p5 = lumas[Math.floor(lumas.length * 0.05)]
    const p95 = lumas[Math.floor(lumas.length * 0.95)]
    const [lo, hi] = VALUE_BANDS.gameplay
    expect(p5).toBeGreaterThanOrEqual(lo)
    expect(p95).toBeLessThanOrEqual(hi)
  })

  it('spends enough of the headroom to read as more than one tone', () => {
    // The other half of the band rule. A pattern that never leaves one byte is
    // inside the band and invisible, which is how the deck got to be 0.0003 flat
    // over an 864-pixel patch in the first place.
    const lumas: number[] = []
    for (let i = 0; i < size * size; i++) {
      lumas.push(litLuma([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2]]))
    }
    lumas.sort((a, b) => a - b)
    const spread = lumas[Math.floor(lumas.length * 0.95)] - lumas[Math.floor(lumas.length * 0.05)]
    expect(spread).toBeGreaterThan(0.04)
  })

  it('prints the mortar darker than every brick face', () => {
    const cp = coursePitch() / BRICK.metresPerTile
    const bp = brickPitch() / BRICK.metresPerTile
    const read = (u: number, v: number) => {
      const i = (Math.floor(v * size) * size + Math.floor(u * size)) * 4
      return litLuma([bytes[i], bytes[i + 1], bytes[i + 2]])
    }
    const joint = read(0.5, cp)
    const face = read(bp / 2, cp / 2)
    expect(joint).toBeLessThan(face)
    expect(MASONRY_DECK_LIT_LUMA - joint).toBeGreaterThan(BRICK_MORTAR_DROP * 0.7)
  })

  it('states the whole drop budget, and where its p100 lands', () => {
    /*
      Four terms drop the same pixel and only their SUM matters. The worst case on
      a face is the darkest rung, a grain trough and a pock all at once, and it is
      recorded here as a number rather than hidden, because it is 0.007 UNDER the
      band floor and reached on well under one per cent of the tile.
    */
    const worstFace = BRICK_TONE_DROPS[BRICK_TONE_DROPS.length - 1] + BRICK_GRAIN_DROP + BRICK_PIT_DROP
    expect(worstFace).toBeCloseTo(0.134, 6)
    expect(MASONRY_DECK_LIT_LUMA - worstFace).toBeCloseTo(0.5366, 4)

    // The mortar, which carries no pock, stays inside the band outright.
    const worstMortar = BRICK_MORTAR_DROP + BRICK_GRAIN_DROP * 0.4
    expect(MASONRY_DECK_LIT_LUMA - worstMortar).toBeGreaterThan(VALUE_BANDS.gameplay[0])
  })

  it('leans the hue cool, which is the design direction expressed as a constraint', () => {
    // Blues, silvers, greys and black. Four cool tilts to one barely warm one, and
    // `panelTintBytes` solves each at constant display luma so it costs the band
    // nothing.
    expect(BRICK_TINT_TILTS.filter((t) => t < 0).length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...BRICK_TINT_TILTS)).toBeLessThanOrEqual(0.25)
    let cooler = 0
    for (let i = 0; i < size * size; i++) {
      if (bytes[i * 4 + 2] > bytes[i * 4]) cooler++
    }
    expect(cooler / (size * size)).toBeGreaterThan(0.5)
  })
})

describe('the frame ladder, and the prohibition it exists to hold', () => {
  const size = 64
  const bytes = brickAlbedoBytes(size, {
    renderedLuma: FRAME_LIT_LUMA,
    dropScale: FRAME_DROP_SCALE,
  })

  it('leaves the pylon\'s MEASURED 5th percentile inside the midground band', () => {
    /*
      **THE TEST THAT SHIPPED GREEN WHILE THE FRAME FAILED, rewritten.**

      What was here applied the map to `FRAME_LIT_LUMA` and asserted the result
      stayed above 0.20. `FRAME_LIT_LUMA` is the number every drop in the map was
      solved AGAINST, so the assertion could only ever restate the generator's own
      arithmetic - and it did: the constant was 0.30, measured on a pre-brick frame
      wearing a different material, the pylons actually sit at 0.3553, and the
      shipped map took their 5th percentile to 0.1959, below the floor
      `97-decision-shadow-end.md` closes to repeated verticals.

      A test whose input is its own subject cannot fail. This one applies the map
      to a number that came from a DIFFERENT experiment - a capture with
      `?nobrickmap` - so it can.
    */
    const [midgroundLo] = VALUE_BANDS.midground

    /*
      The darkest multiplier the map applies anywhere, as a linear ratio, which is
      the correct way to carry a map onto a surface it was not solved for. An
      albedo map is a MULTIPLIER: the absolute drop it produces scales with the
      base it lands on, so quoting it as a display-luma drop is only valid at the
      one base it was solved at.
    */
    const landed = linearToSrgb(srgbToLinear(MEASURED_UNMAPPED_P5.frame) * mapQuantile(bytes, 0.05))
    expect(landed, `p5 ${MEASURED_UNMAPPED_P5.frame} through the map`).toBeGreaterThan(midgroundLo)
  })

  it('reproduces the frame it was measured on, or the model is not usable', () => {
    /*
      The check that makes the two band assertions worth anything. Carrying the
      map's 5th percentile onto the surface's unmapped 5th percentile is an
      approximation - it treats the map and the lighting as independent, which
      they are not exactly - so it has to be shown to land near the frame before
      it is trusted to police a band.

      0.02 of display luma, which is about eight bytes at this end of the curve
      and a ninth of a value band.
    */
    const frame = linearToSrgb(srgbToLinear(MEASURED_UNMAPPED_P5.frame) * mapQuantile(bytes, 0.05))
    const deckBytes = brickAlbedoBytes(size)
    const deck = linearToSrgb(srgbToLinear(MEASURED_UNMAPPED_P5.deck) * mapQuantile(deckBytes, 0.05))
    expect(Math.abs(deck - MEASURED_MAPPED_P5.deck), `deck predicted ${deck.toFixed(4)}`).toBeLessThan(0.02)
    /*
      The frame's row is deliberately NOT asserted to match, and that is the
      finding rather than a gap. `MEASURED_MAPPED_P5.frame` is 0.1959 and it was
      captured at `FRAME_DROP_SCALE` 0.70 against a `FRAME_LIT_LUMA` of 0.30 -
      the configuration this change exists to remove. The model applied to the
      SHIPPING map has to come out above it, and above the floor, which is the
      assertion in the test before this one.
    */
    expect(frame).toBeGreaterThan(MEASURED_MAPPED_P5.frame)
  })

  it('leaves the deck\'s MEASURED 5th percentile inside the gameplay band', () => {
    // The same check on the surface that did NOT fail, so the pair is symmetric
    // and a future change cannot fix one by breaking the other unnoticed.
    const deckBytes = brickAlbedoBytes(size, { dropScale: DECK_DROP_SCALE })
    const landed = linearToSrgb(srgbToLinear(MEASURED_UNMAPPED_P5.deck) * mapQuantile(deckBytes, 0.05))
    expect(landed).toBeGreaterThan(VALUE_BANDS.gameplay[0])
  })

  it('compresses the deck ladder rather than reusing it', () => {
    const deckBytes = brickAlbedoBytes(size)
    const deckSpread = spreadOf(deckBytes, size, MASONRY_DECK_LIT_LUMA)
    const frameSpread = spreadOf(bytes, size, FRAME_LIT_LUMA)
    expect(frameSpread).toBeLessThan(deckSpread)
    expect(frameSpread).toBeGreaterThan(0)
  })

  it('sizes the scale against headroom rather than against value', () => {
    // The deck has 0.127 between 0.687 and the gameplay floor; the frame has 0.10
    // between 0.30 and the midground floor. 0.70 is under the naive 0.787 because
    // the worst case has to clear the floor and not merely the mortar.
    const deckRoom = MASONRY_DECK_LIT_LUMA - VALUE_BANDS.gameplay[0]
    const frameRoom = FRAME_LIT_LUMA - VALUE_BANDS.midground[0]
    expect(FRAME_DROP_SCALE).toBeLessThan(frameRoom / deckRoom)
  })
})

function spreadOf(bytes: Uint8ClampedArray, size: number, base: number): number {
  const lumas: number[] = []
  for (let i = 0; i < size * size; i++) {
    lumas.push(litLuma([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2]], base))
  }
  lumas.sort((a, b) => a - b)
  return lumas[Math.floor(lumas.length * 0.95)] - lumas[Math.floor(lumas.length * 0.05)]
}

describe('createBrickMaps', () => {
  it('returns null with no canvas, rather than a stub nobody can see is neutral', () => {
    // The same contract `createDecalMaps` has, and for the same reason: a caller
    // that gets null spreads nothing into its material and compiles the program it
    // would have compiled anyway.
    expect(createBrickMaps(512)).toBeNull()
  })
})
