import { describe, expect, it } from 'vitest'
import {
  DECAL_KINDS,
  DECK_LIT_LUMA,
  PANEL_FILL_CELL,
  PANEL_FILL_SPAN,
  PANEL_TONE_DROPS,
  ROUGHNESS_MID,
  ROUGHNESS_MID_BYTE,
  albedoByte,
  albedoDrop,
  decalMarks,
  normalFromHeight,
  ormFromHeight,
  panelLines,
  panelRegions,
  panelToneBytes,
  roughnessBias,
  roughnessByte,
  screwHeads,
  ventGrille,
  warningChevrons,
  type DecalKind,
  type Mark,
} from './decalTextures'

/*
  Everything tested here is the half of the module that decides WHERE marks go
  and what bytes come out. The canvas half is deliberately not tested, because a
  rasteriser assertion is a claim about the browser rather than about this
  design, and because the two things in the file that are genuinely easy to get
  wrong - the roughness bias arithmetic and the Sobel signs - are both on this
  side of the line.
*/

describe('the roughness bias', () => {
  it('reproduces the materials spec worked example exactly', () => {
    /*
      From docs/design/02-materials.md section 4.2, for plastic() at a target of
      0.38 with a plus or minus 0.08 swing. If these three numbers ever drift,
      every surface carrying one of these maps is uniformly the wrong roughness
      with no other symptom at all, which is why the spec's own arithmetic is
      pinned here rather than paraphrased.
    */
    expect(roughnessBias(0.38)).toBeCloseTo(0.475, 6)
    expect(roughnessByte(0.38, 0.38)).toBe(204)
    expect(roughnessByte(0.3, 0.38)).toBe(161)
    expect(roughnessByte(0.46, 0.38)).toBe(247)
  })

  it('writes the mid byte for any target, which is what makes it a bias', () => {
    for (const target of [0.14, 0.32, 0.38, 0.5, 0.72, 0.9]) {
      expect(roughnessByte(target, target)).toBe(ROUGHNESS_MID_BYTE)
    }
    expect(ROUGHNESS_MID_BYTE).toBe(Math.round(ROUGHNESS_MID * 255))
  })

  it('round trips through the bias the material will carry', () => {
    // The whole scheme is only correct if material.roughness * texel == value.
    const target = 0.72
    const bias = roughnessBias(target)
    for (const value of [0.6, 0.72, 0.84]) {
      const texel = roughnessByte(value, target) / 255
      expect(bias * texel).toBeCloseTo(value, 2)
    }
  })

  it('clamps rather than wrapping when a swing overruns the byte', () => {
    expect(roughnessByte(2, 0.38)).toBe(255)
    expect(roughnessByte(-1, 0.38)).toBe(0)
  })

  it('refuses a target it cannot divide by', () => {
    expect(() => roughnessByte(0.4, 0)).toThrow(/must be positive/)
  })
})

describe('panelLines', () => {
  it('spaces lines at the pitch, converted out of metres', () => {
    // A 0.4 m pitch on a 2 m tile is a line every 0.2 of tile space, so four
    // interior positions, each of which may carry a horizontal and a vertical.
    const marks = panelLines({ pitch: 0.4, metresPerTile: 2, seed: 1, suppress: 0 })
    const horizontals = marks.filter((m) => m.kind === 'panel' && m.y1 === m.y2)
    expect(horizontals).toHaveLength(4)
    expect(horizontals.map((m) => (m as Extract<Mark, { kind: 'panel' }>).y1)).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.4, 6),
      expect.closeTo(0.6000000000000001, 6),
      expect.closeTo(0.8, 6),
    ])
  })

  it('converts the groove width out of metres too', () => {
    const [first] = panelLines({ pitch: 0.4, metresPerTile: 2, width: 0.0025, seed: 1, suppress: 0 })
    expect(first.kind).toBe('panel')
    expect((first as Extract<Mark, { kind: 'panel' }>).width).toBeCloseTo(0.00125, 9)
  })

  it('suppresses runs so the result reads as parts rather than as graph paper', () => {
    const complete = panelLines({ pitch: 0.1, metresPerTile: 1, seed: 7, suppress: 0 })
    const thinned = panelLines({ pitch: 0.1, metresPerTile: 1, seed: 7, suppress: 0.3 })

    expect(thinned.length).toBeLessThan(complete.length)
    // Roughly 30% gone, with enough slack that a seed change is not a failure.
    expect(thinned.length / complete.length).toBeGreaterThan(0.5)
    expect(thinned.length / complete.length).toBeLessThan(0.9)
  })

  it('is deterministic, so the world does not rearrange itself between loads', () => {
    expect(panelLines({ pitch: 0.4, metresPerTile: 2, seed: 42 })).toEqual(
      panelLines({ pitch: 0.4, metresPerTile: 2, seed: 42 }),
    )
    expect(panelLines({ pitch: 0.4, metresPerTile: 2, seed: 42 })).not.toEqual(
      panelLines({ pitch: 0.4, metresPerTile: 2, seed: 43 }),
    )
  })

  it('draws nothing when a pitch would not fit in a tile', () => {
    expect(panelLines({ pitch: 4, metresPerTile: 2, seed: 1 })).toEqual([])
    expect(panelLines({ pitch: 0, metresPerTile: 2, seed: 1 })).toEqual([])
  })

  it('runs every line the full width of the tile', () => {
    /*
      A run that stopped short of the border would leave a stub end in the
      middle of a face, which is a worse artefact than a groove that meets a
      bevel. Wrapping is what keeps the tile seamless, and a run that does not
      reach both edges cannot wrap.
    */
    for (const mark of panelLines({ pitch: 0.4, metresPerTile: 2, seed: 3, suppress: 0 })) {
      const panel = mark as Extract<Mark, { kind: 'panel' }>
      const spansX = panel.x1 === 0 && panel.x2 === 1
      const spansY = panel.y1 === 0 && panel.y2 === 1
      expect(spansX || spansY).toBe(true)
    }
  })
})

describe('screwHeads', () => {
  it('stays inside the border band', () => {
    for (const mark of screwHeads({ density: 8, metresPerTile: 1, seed: 5 })) {
      const screw = mark as Extract<Mark, { kind: 'screw' }>
      expect(screw.x).toBeGreaterThan(0)
      expect(screw.x).toBeLessThan(1)
      expect(screw.y).toBeGreaterThan(0)
      expect(screw.y).toBeLessThan(1)
    }
  })

  it('never lets two heads touch', () => {
    /*
      The reason for the jittered grid. Uniform random placement at these
      densities reliably puts two heads in contact somewhere in the tile, and
      two touching screws read as a mistake rather than as hardware.
    */
    const marks = screwHeads({ density: 16, metresPerTile: 1, radius: 0.006, seed: 11 }) as Array<
      Extract<Mark, { kind: 'screw' }>
    >
    expect(marks.length).toBeGreaterThan(4)

    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        const distance = Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y)
        expect(distance).toBeGreaterThan(marks[i].radius + marks[j].radius)
      }
    }
  })

  it('scales its count with the physical area a tile covers', () => {
    const small = screwHeads({ density: 4, metresPerTile: 1, seed: 2 })
    const large = screwHeads({ density: 4, metresPerTile: 3, seed: 2 })
    expect(large.length).toBeGreaterThan(small.length)
  })

  it('draws nothing at zero density', () => {
    expect(screwHeads({ density: 0, metresPerTile: 1, seed: 1 })).toEqual([])
  })
})

describe('ventGrille', () => {
  it('centres its slots on the point it was given', () => {
    const marks = ventGrille({ x: 0.5, y: 0.4, slots: 7, metresPerTile: 1 }) as Array<
      Extract<Mark, { kind: 'vent' }>
    >
    expect(marks).toHaveLength(7)

    const meanX = marks.reduce((sum, m) => sum + m.x, 0) / marks.length
    const meanY = marks.reduce((sum, m) => sum + m.y, 0) / marks.length
    expect(meanX).toBeCloseTo(0.5, 9)
    expect(meanY).toBeCloseTo(0.4, 9)
  })

  it('spaces slots at the pitch, converted out of metres', () => {
    const marks = ventGrille({ x: 0.5, y: 0.5, slots: 5, pitch: 0.006, metresPerTile: 0.6 }) as Array<
      Extract<Mark, { kind: 'vent' }>
    >
    expect(marks[1].x - marks[0].x).toBeCloseTo(0.01, 9)
  })

  it('rotates the whole group as a unit', () => {
    const marks = ventGrille({
      x: 0.5,
      y: 0.5,
      slots: 3,
      metresPerTile: 1,
      angle: Math.PI / 2,
    }) as Array<Extract<Mark, { kind: 'vent' }>>

    // Turned a quarter turn, the run advances in Y and not in X.
    expect(marks[0].x).toBeCloseTo(0.5, 6)
    expect(marks[2].x).toBeCloseTo(0.5, 6)
    expect(marks[2].y).toBeGreaterThan(marks[0].y)
    for (const mark of marks) expect(mark.angle).toBeCloseTo(Math.PI / 2, 9)
  })

  it('draws nothing without slots', () => {
    expect(ventGrille({ x: 0.5, y: 0.5, slots: 0, metresPerTile: 1 })).toEqual([])
  })
})

describe('warningChevrons', () => {
  it('centres a run on its anchor and points them all the same way', () => {
    const marks = warningChevrons({ x: 0.5, y: 0.2, count: 4, metresPerTile: 1 }) as Array<
      Extract<Mark, { kind: 'chevron' }>
    >
    expect(marks).toHaveLength(4)
    expect(marks.reduce((sum, m) => sum + m.x, 0) / 4).toBeCloseTo(0.5, 9)
    for (const mark of marks) expect(mark.angle).toBe(0)
  })

  it('raises rather than cuts, because a chevron is a relief mark', () => {
    /*
      Embossed rather than printed. An embossed chevron produces a highlight and
      a shadow of its own, so it survives the greyscale readability test; a
      printed one relies on a value difference that band discipline is
      separately trying to take away.
    */
    for (const mark of warningChevrons({ x: 0.5, y: 0.5, count: 3, metresPerTile: 1 })) {
      expect(mark.depth).toBeGreaterThan(0)
    }
  })
})

describe('normalFromHeight', () => {
  const size = 16

  it('turns a flat mask into flat normals, exactly', () => {
    /*
      The single assertion that catches sign errors, normalisation errors and
      off-by-one wraparound errors together. On a flat mask every gradient is
      zero, so every texel must be exactly (128, 128, 255).
    */
    const flat = new Float32Array(size * size).fill(0.5)
    const bytes = normalFromHeight(flat, size, 3)

    for (let i = 0; i < bytes.length; i += 4) {
      expect(bytes[i]).toBe(128)
      expect(bytes[i + 1]).toBe(128)
      expect(bytes[i + 2]).toBe(255)
      expect(bytes[i + 3]).toBe(255)
    }
  })

  it('tilts the normal away from the rise, not toward it', () => {
    // A ramp climbing toward +X must lean its normal toward -X, which is a red
    // channel below 128. The opposite sign inverts every groove into a ridge
    // and looks plausible enough to ship.
    const ramp = new Float32Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[y * size + x] = x / size
    }
    const bytes = normalFromHeight(ramp, size, 2)

    const middle = ((size / 2) * size + size / 2) * 4
    expect(bytes[middle]).toBeLessThan(128)
    expect(bytes[middle + 1]).toBe(128)
  })

  it('wraps rather than clamping at the tile edge', () => {
    /*
      Clamping puts a visible ridge on every tile boundary, and it is invisible
      until something large is textured. A step that exists only at column zero
      must therefore be felt by the last column too.
    */
    const step = new Float32Array(size * size).fill(0.5)
    for (let y = 0; y < size; y++) step[y * size] = 0.1

    const bytes = normalFromHeight(step, size, 3)
    const lastColumn = ((size / 2) * size + (size - 1)) * 4
    expect(bytes[lastColumn]).not.toBe(128)
  })

  it('scales the tilt with strength', () => {
    const ramp = new Float32Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[y * size + x] = x / size
    }
    const middle = ((size / 2) * size + size / 2) * 4
    const gentle = normalFromHeight(ramp, size, 0.5)[middle]
    const steep = normalFromHeight(ramp, size, 4)[middle]
    expect(steep).toBeLessThan(gentle)
  })

  it('produces unit-length normals once decoded', () => {
    const noisy = new Float32Array(size * size)
    for (let i = 0; i < noisy.length; i++) noisy[i] = ((i * 37) % 100) / 100
    const bytes = normalFromHeight(noisy, size, 3)

    for (let i = 0; i < bytes.length; i += 4) {
      const nx = (bytes[i] / 255) * 2 - 1
      const ny = (bytes[i + 1] / 255) * 2 - 1
      const nz = (bytes[i + 2] / 255) * 2 - 1
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 1)
    }
  })

  it('refuses a mask that is not the size it claims', () => {
    expect(() => normalFromHeight(new Float32Array(10), 16, 1)).toThrow(/for a 16 square tile/)
  })
})

describe('ormFromHeight', () => {
  const size = 8

  it('writes the mid roughness and full occlusion on the base plane', () => {
    const flat = new Float32Array(size * size).fill(0.5)
    const bytes = ormFromHeight(flat, size, { roughness: 0.38, swing: 0.08 })

    for (let i = 0; i < bytes.length; i += 4) {
      expect(bytes[i]).toBe(255)
      expect(bytes[i + 1]).toBe(ROUGHNESS_MID_BYTE)
      expect(bytes[i + 3]).toBe(255)
    }
  })

  it('inverts: a groove is rougher, a proud surface is smoother', () => {
    const mask = new Float32Array(size * size).fill(0.5)
    mask[0] = 0.34 // a panel groove, 0.16 down
    mask[1] = 0.55 // a lip, 0.05 up

    const bytes = ormFromHeight(mask, size, { roughness: 0.38, swing: 0.08 })
    expect(bytes[1]).toBeGreaterThan(ROUGHNESS_MID_BYTE)
    expect(bytes[5]).toBeLessThan(ROUGHNESS_MID_BYTE)
  })

  it('darkens occlusion only in recesses, and never past the floor', () => {
    /*
      Occlusion reaching zero reads as dirt rather than as depth, which is the
      exact failure the reference brief names and which this project has already
      made once elsewhere. 0.55 is the floor and it is not negotiable.
    */
    const mask = new Float32Array(size * size).fill(0.5)
    mask[0] = 0 // as deep as the mask can go
    mask[1] = 1 // as proud

    const bytes = ormFromHeight(mask, size, { roughness: 0.38, swing: 0.08 })
    expect(bytes[0]).toBeGreaterThanOrEqual(Math.round(0.55 * 255))
    expect(bytes[0]).toBeLessThan(255)
    expect(bytes[4]).toBe(255)
  })

  it('keeps the whole swing inside the byte range for every shipped kind', () => {
    // The green channel is meant to live in a band around 204, not to clip.
    for (const kind of Object.keys(DECAL_KINDS) as DecalKind[]) {
      const spec = DECAL_KINDS[kind]
      const deepest = ormFromHeight(new Float32Array(1).fill(0), 1, spec)
      const proudest = ormFromHeight(new Float32Array(1).fill(1), 1, spec)
      expect(deepest[1], `${kind} deepest`).toBeLessThan(255)
      expect(proudest[1], `${kind} proudest`).toBeGreaterThan(0)
    }
  })

  it('refuses a mask that is not the size it claims', () => {
    expect(() => ormFromHeight(new Float32Array(3), 8, { roughness: 0.4, swing: 0.1 })).toThrow(
      /for a 8 square tile/,
    )
  })
})

describe('decalMarks', () => {
  it('is deterministic per kind', () => {
    for (const kind of Object.keys(DECAL_KINDS) as DecalKind[]) {
      expect(decalMarks(kind)).toEqual(decalMarks(kind))
    }
  })

  it('gives every kind at least its panel lines', () => {
    for (const kind of Object.keys(DECAL_KINDS) as DecalKind[]) {
      const spec = DECAL_KINDS[kind]
      /*
        Two positions is the floor. A tile holding one grid position offers the
        suppression pass nothing to thin, so the layer either appears in full or
        vanishes entirely depending on the seed, and a kind whose detail is a
        coin flip is worse than a kind with no detail. Two positions is four
        candidate runs, which is enough that the pattern reads as thinned.
      */
      const positions = Math.ceil(spec.metresPerTile / spec.panelPitch) - 1
      expect(positions, `${kind} panel positions`).toBeGreaterThanOrEqual(2)
      expect(decalMarks(kind).some((m) => m.kind === 'panel'), `${kind} has panel lines`).toBe(true)
    }
  })

  it('keeps screw heads off the two stone kinds', () => {
    // Screws on a moulded stone deck would be a mark from the wrong process, and
    // the restraint rule caps any one object at three of the six marks anyway.
    expect(decalMarks('deck').some((m) => m.kind === 'screw')).toBe(false)
    expect(decalMarks('hull').some((m) => m.kind === 'screw')).toBe(true)
  })

  it('gives the smallest tile the finest panel pitch', () => {
    // Authoring is in metres per tile, so a hero-scale plate at 0.35 m must not
    // end up with a deck's 0.8 m grid stretched across it.
    const kinds = Object.keys(DECAL_KINDS) as DecalKind[]
    const sorted = [...kinds].sort((a, b) => DECAL_KINDS[a].metresPerTile - DECAL_KINDS[b].metresPerTile)
    for (let i = 1; i < sorted.length; i++) {
      expect(DECAL_KINDS[sorted[i]].panelPitch).toBeGreaterThanOrEqual(DECAL_KINDS[sorted[i - 1]].panelPitch)
    }
  })
})

/*
  The printed albedo, and this is the block that matters most in the file.

  The relief half of this module has thirty tests and provably no effect on a
  floor. The albedo half has an effect and a hard constraint - the art bible's
  section 8.2 permits pattern only while the pattern's own p5-p95 stays inside
  the surface's value band - so the arithmetic that keeps it there is the thing
  worth pinning. Every number below is computed from the byte values the
  generator will actually write rather than from the drops that were requested,
  because a byte is 8 bits and the difference between the two is exactly where a
  band assertion stops being a check.
*/

describe('the albedo ladder', () => {
  it('is neutral at 255, because the map multiplies a vertex colour', () => {
    /*
      The deck material is mattePlastic('#ffffff', { vertexColors: true }) and the
      band values ride on the vertex colour, so an albedo map multiplies them.
      A map centred on mid grey would halve the albedo of every walkable surface
      in the game. 255 is the only neutral byte there is.
    */
    expect(albedoByte(0)).toBe(255)
    expect(albedoDrop(255)).toBeCloseTo(0, 12)
    expect(panelToneBytes()[0]).toBe(255)
  })

  it('cannot brighten, which is what the gameplay band has room for', () => {
    // A lit deck renders at 0.687 against a band ceiling of 0.74, so there is
    // 0.053 up and 0.127 down. A two-sided plus-or-minus 0.06 swing would put
    // the light panels at 0.747, inside the deliberate 0.74-0.76 gap. The map
    // clamping at 255 is therefore the correct behaviour rather than a limit.
    expect(albedoByte(-0.06)).toBe(255)
    expect(DECK_LIT_LUMA + 0.06).toBeGreaterThan(0.74)
    expect(DECK_LIT_LUMA - 0.06).toBeGreaterThan(0.56)
  })

  it('delivers the drop it was asked for, after quantisation', () => {
    for (const drop of PANEL_TONE_DROPS) {
      const byte = albedoByte(drop)
      // Half a byte at this end of the curve is about 0.0013 of display luma.
      expect(albedoDrop(byte), `drop ${drop} via byte ${byte}`).toBeCloseTo(drop, 2)
    }
  })

  it('keeps the whole ladder inside the gameplay band on a real deck', () => {
    /*
      The acceptance row, stated as arithmetic. p5 to p95 of the printed deck is
      the lightest tone to the darkest tone, since the fills are flat regions
      rather than a distribution with tails.
    */
    const bytes = panelToneBytes()
    const values = bytes.map((byte) => DECK_LIT_LUMA - albedoDrop(byte))
    const p95 = Math.max(...values)
    const p5 = Math.min(...values)

    expect(p95).toBeLessThanOrEqual(0.74)
    expect(p5).toBeGreaterThanOrEqual(0.56)
    // And the spread has to fit with room, because the surface also carries the
    // 0.039 the lighting already puts on it and a cast shadow on top of that.
    expect(p95 - p5).toBeLessThan(0.18)
    expect(p95 - p5).toBeCloseTo(0.06, 2)
  })

  it('under-delivers rather than over-delivers on a darker surface', () => {
    /*
      One ladder is used everywhere, so the safety of that has to be a property
      rather than a coincidence. The sRGB curve is steeper at the bottom, so the
      same multiplier costs a dark surface LESS display luma than a light one -
      which means a ladder sized against the deck can only ever be gentler on
      band 2, never harsher. Byte 233 is -0.060 on the deck and about -0.033 on
      a kerb at palette.bandTrim's 0.330.
    */
    const byte = albedoByte(0.06)
    const onKerb = albedoDrop(byte, 0.33)
    expect(onKerb).toBeLessThan(0.06)
    expect(onKerb).toBeCloseTo(0.033, 2)
    expect(0.33 - onKerb).toBeGreaterThan(0.2)
  })

  it('refuses a drop that would take a surface to black', () => {
    // Silently clamping to byte 0 would put a printed mark in the anchor band
    // with no error, which is the class of failure this project keeps paying for.
    expect(() => albedoByte(0.7)).toThrow(/to or below black/)
    expect(() => albedoByte(0.1, 0)).toThrow(/renderedLuma/)
  })

  it('steps by more than one byte, so the ladder survives quantisation', () => {
    const bytes = panelToneBytes()
    for (let i = 1; i < bytes.length; i++) {
      expect(bytes[i - 1] - bytes[i], `step ${i}`).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('panel fills', () => {
  const CELLS = Math.round(PANEL_FILL_SPAN / PANEL_FILL_CELL)

  it('tiles the grid exactly, with no gap and no overlap', () => {
    /*
      The one property a fill has to have. A gap rasterises as a base-tone hairline
      running through the middle of a deck and an overlap silently reassigns a
      panel's tone, and both look enough like a design decision to survive a
      screenshot. Asserted on integers, which is why panelRegions returns cells
      rather than the 0-to-1 tile units the Mark primitives use.
    */
    const cells = 16
    const seen = new Int32Array(cells * cells)
    for (const region of panelRegions({ cells })) {
      for (let j = 0; j < region.h; j++) {
        for (let i = 0; i < region.w; i++) seen[(region.y + j) * cells + (region.x + i)]++
      }
    }
    expect([...seen].every((n) => n === 1)).toBe(true)
  })

  it('never puts two panels of the same tone side by side', () => {
    /*
      This is the mark, not a refinement of it. Two identical panels sharing an
      edge read as one large panel with a scratch across it, which is exactly the
      state the deck is in today with panel lines and no fills.

      Swept over grid sizes and seeds rather than checked once, because the first
      version of the generator passed a single-grid check and still produced a
      matching pair about once per 24-square grid: it banned the tones to the left
      and above on the assumption that scan order made those the only decided
      neighbours, and a tall panel from an earlier row sits to the RIGHT of a
      panel placed later in the row below. The wrap is included, since the map's
      span is finite and anything past it repeats.
    */
    for (const cells of [8, 16, 24, 40, 80]) {
      for (const seed of [20260810, 1, 99, 424242]) {
        const regions = panelRegions({ cells, seed })
        const tone = new Int32Array(cells * cells).fill(-1)
        const owner = new Int32Array(cells * cells).fill(-1)
        regions.forEach((region, index) => {
          for (let j = 0; j < region.h; j++) {
            for (let i = 0; i < region.w; i++) {
              tone[(region.y + j) * cells + (region.x + i)] = region.tone
              owner[(region.y + j) * cells + (region.x + i)] = index
            }
          }
        })
        const wrap = (v: number) => ((v % cells) + cells) % cells
        const idx = (x: number, y: number) => wrap(y) * cells + wrap(x)

        for (let y = 0; y < cells; y++) {
          for (let x = 0; x < cells; x++) {
            for (const [dx, dy] of [
              [1, 0],
              [0, 1],
            ]) {
              const here = idx(x, y)
              const there = idx(x + dx, y + dy)
              // Two cells of ONE panel share a tone by definition, so only
              // boundaries between different panels are the claim.
              if (owner[here] === owner[there]) continue
              expect(
                tone[here],
                `cells ${cells} seed ${seed}: boundary at ${x},${y} toward ${dx},${dy}`,
              ).not.toBe(tone[there])
            }
          }
        }
      }
    }
  })

  it('is seeded, so the island is the same island every session', () => {
    expect(panelRegions({ cells: 12 })).toEqual(panelRegions({ cells: 12 }))
    expect(panelRegions({ cells: 12, seed: 7 })).not.toEqual(panelRegions({ cells: 12 }))
  })

  it('produces panels at the scale the reference uses, not at tile scale', () => {
    /*
      The whole reason this is a 40 m map rather than a channel in the 2 m tiling
      set. "Large flat panels separated by seams" means metres, and a 2 m tile can
      hold at most three panel positions before it repeats. At 0.5 m cells and up
      to 6 cells a side, panels run 0.5 m to 3.0 m.
    */
    const regions = panelRegions({ cells: CELLS })
    const areas = regions.map((r) => r.w * r.h * PANEL_FILL_CELL * PANEL_FILL_CELL)
    const mean = areas.reduce((a, c) => a + c, 0) / areas.length
    expect(Math.max(...regions.map((r) => Math.max(r.w, r.h))) * PANEL_FILL_CELL).toBeLessThanOrEqual(3)
    // A mean panel over a quarter of a square metre, against a 2 m tile's 4.
    expect(mean).toBeGreaterThan(0.25)
    // And enough panels that a twelve-metre deck is not one flat tone.
    expect(regions.length).toBeGreaterThan(200)
  })

  it('keeps the perforated panels a minority, per the restraint rule', () => {
    // A perforation grid is one KIND of panel rather than a second mark laid over
    // the panels, which is what keeps the deck's top face at one mark type under
    // section 7.7. That argument only holds while most panels are plain.
    const regions = panelRegions({ cells: CELLS })
    const share = regions.filter((r) => r.perforated).length / regions.length
    expect(share).toBeGreaterThan(0.03)
    expect(share).toBeLessThan(0.25)
    expect(panelRegions({ cells: CELLS, perforatedShare: 0 }).some((r) => r.perforated)).toBe(false)
  })

  it('spans the whole walkable island in one copy', () => {
    /*
      The plateau is radius 16 and T3's corners sit at 15.52, so the span has to
      clear 15.52 on every side or a wrap seam runs through the portal deck and
      puts two differently toned panels against each other with no seam between
      them. It also has to divide into whole cells.
    */
    expect(PANEL_FILL_SPAN / 2).toBeGreaterThan(15.52)
    expect(PANEL_FILL_SPAN / PANEL_FILL_CELL).toBe(CELLS)
    // And the cell shares a grid with the deck's panel lines, so a tone step can
    // land on a groove rather than in the middle of a flat face.
    expect(PANEL_FILL_CELL).toBe(DECAL_KINDS.deck.panelPitch)
  })

  it('gives the deck a panel pitch that divides its tile', () => {
    /*
      At 0.6 m on a 2 m tile the lines land at 0.6, 1.2, 1.8 and then the tile
      repeats, so the gap sequence is 0.6, 0.6, 0.6, 0.8 forever: a periodic
      irregularity every 2 m on the largest surface in the game, which is the
      tiling the suppression pass exists to hide announcing itself.
    */
    const spec = DECAL_KINDS.deck
    expect(spec.metresPerTile / spec.panelPitch).toBe(Math.round(spec.metresPerTile / spec.panelPitch))
  })
})
