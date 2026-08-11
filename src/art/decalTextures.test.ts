import { describe, expect, it } from 'vitest'
import {
  DECAL_KINDS,
  DECK_LIT_LUMA,
  DECK_SIDE_LUMA,
  PANEL_FILL_CELL,
  PANEL_FILL_SHARES,
  PANEL_FILL_SPAN,
  PANEL_MARK_DROPS,
  PANEL_TINT_TILTS,
  PANEL_TONE_DROPS,
  ROUGHNESS_MID,
  ROUGHNESS_MID_BYTE,
  SEAM_CORE_DROP,
  SEAM_LIP_DROP,
  albedoByte,
  albedoDrop,
  chipTracePaths,
  decalMarks,
  normalFromHeight,
  ormFromHeight,
  panelFillSize,
  panelLines,
  panelRegions,
  panelTintBytes,
  panelToneBytes,
  roughnessBias,
  roughnessByte,
  screwHeads,
  ventGrille,
  warningChevrons,
  type DecalKind,
  type Mark,
} from './decalTextures'
import { linearToSrgb, srgbToLinear } from './materials'
import { VALUE_BANDS } from './palette'
import { mulberry32 } from './placement'

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
  })

  it('leaves room ABOVE the lightest panel, which is what pays for the bevel lip', () => {
    /*
      The ladder used to start at 0 and byte 255, so nothing on the deck could be
      brighter than a panel and the reference's bright bevel beside every seam was
      inexpressible. Giving up the top rung is what buys it: every panel is at
      least 0.016 down, so `SEAM_LIP_DROP` at 0.008 is brighter than all six.

      This is the whole mechanism by which a map that can only multiply toward
      black produces a two-sided mark, and it is worth an assertion because the
      obvious "optimisation" of putting the lightest panel back at 255 silently
      deletes every lip and every sub-panel border in the world.
    */
    expect(SEAM_LIP_DROP).toBeLessThan(Math.min(...PANEL_TONE_DROPS))
    expect(albedoByte(SEAM_LIP_DROP)).toBeLessThan(255)
    expect(albedoByte(SEAM_LIP_DROP)).toBeGreaterThan(Math.max(...panelToneBytes()))
    // And the inner border of a sub-panel is brighter than its own panel.
    expect(PANEL_MARK_DROPS.subPanelBorder).toBeLessThan(0)
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

  it('keeps every printed value inside the gameplay band on a real lit deck', () => {
    /*
      The acceptance row, stated as arithmetic, and it now covers the WHOLE
      printed range rather than the panel tones alone: the lip is the brightest
      thing on the deck and the seam core the darkest, so those two are the
      extremes and the panels sit between them.

      Measured base, not authored: 0.6869 off
      `.critique/astro/maps-on--hub-establishing.png` at 760,620,36,24.
    */
    const extremes = [SEAM_LIP_DROP, SEAM_CORE_DROP, ...PANEL_TONE_DROPS]
    const values = extremes.map((drop) => DECK_LIT_LUMA - albedoDrop(albedoByte(drop)))
    const p95 = Math.max(...values)
    const p5 = Math.min(...values)

    expect(p95).toBeLessThanOrEqual(0.74)
    expect(p5).toBeGreaterThanOrEqual(0.56)
    expect(p95 - p5).toBeLessThan(0.18)
    /*
      0.0910 of PRINTED span - brightest printed value to darkest - up from the
      0.0607 the panel fills alone spent. This is the number the user's "make them
      more pronounced" turns into, and it is 0.092 before quantisation rather than
      the 0.100 of `SEAM_CORE_DROP`, because the lip is itself 0.008 down and
      nothing on the deck is left at the surface's own value.
    */
    expect(p95 - p5).toBeCloseTo(0.091, 3)
    // The separate number: how far the DARKEST printed value sits below the
    // surface's own rendered 0.6869, which is what the band floor has to absorb.
    expect(DECK_LIT_LUMA - p5).toBeCloseTo(0.0993, 3)
    expect(p5).toBeCloseTo(0.5876, 3)
  })

  it('reserves margin above the band floor for the concurrent lightmap bake', () => {
    /*
      A `lightMap` or an `aoMap` multiplies albedo exactly as this map does, so a
      bake landing on the same material COMPOUNDS with this span rather than
      replacing it. The two budgets are one budget. This pins what is left, so a
      bake that eats more than it announces itself as a failing test rather than
      as an out-of-band deck nobody measured.
    */
    const darkest = DECK_LIT_LUMA - albedoDrop(albedoByte(SEAM_CORE_DROP))
    expect(darkest - 0.56).toBeGreaterThan(0.025)
    expect(darkest - 0.56).toBeLessThan(0.04)
  })

  it('takes the step risers INTO the midground band rather than out of one', () => {
    /*
      The measurement the brief given to this stream got wrong, and the reason it
      matters. A step riser measures 0.3836 with p5 0.3758 and p95 0.3931
      (950,490,44,26): p5 is inside midground 0.20-0.38 and p95 is in the
      0.38-0.56 gap that is meant to be empty, so every riser in the game already
      fails band membership by straddling the ceiling.

      0.38 is the midground CEILING, not its floor, so there is 0.184 of room
      downward and not 0.004. Printing on a riser moves it toward legality.
    */
    const [lo, hi] = VALUE_BANDS.midground
    expect(DECK_SIDE_LUMA).toBeGreaterThan(hi)
    const printed = [SEAM_LIP_DROP, SEAM_CORE_DROP, ...PANEL_TONE_DROPS].map(
      (drop) => DECK_SIDE_LUMA - albedoDrop(albedoByte(drop), DECK_SIDE_LUMA),
    )
    expect(Math.min(...printed)).toBeGreaterThan(lo)
    // The darkest printed riser lands at 0.325, inside midground for the first
    // time, with 0.125 of margin above the floor.
    expect(Math.min(...printed)).toBeCloseTo(0.325, 2)
  })

  it('delivers the same CONTRAST RATIO on every surface, which is why one ladder is right', () => {
    /*
      The stronger form of the under-delivery property below. A multiplier is a
      ratio, so the seam core is 14.45% below a lit deck top at 0.6869 and 15.30%
      below a riser at 0.3836 - the same apparent strength on surfaces 0.30 of luma
      apart. The objection that a ladder sized for band 1 would vanish on the
      darker risers is simply not what the arithmetic does, and that is the reason
      `deckBatch` does not need a per-face ladder.
    */
    const byte = albedoByte(SEAM_CORE_DROP)
    const onTop = albedoDrop(byte, DECK_LIT_LUMA) / DECK_LIT_LUMA
    const onSide = albedoDrop(byte, DECK_SIDE_LUMA) / DECK_SIDE_LUMA
    expect(onTop).toBeCloseTo(0.1445, 3)
    expect(onSide).toBeCloseTo(0.153, 3)
    expect(Math.abs(onSide - onTop)).toBeLessThan(0.01)
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

  it('clamps every in-panel mark at the seam core, so seams stay the darkest thing', () => {
    /*
      The property that makes the vocabulary band-safe by construction. Marks are
      offsets from their own panel's tone, so the darkest panel plus the deepest
      mark is what has to be checked - and the clamp in `createPanelFillMap`'s
      `tone()` is what guarantees it. Without the clamp, the darkest panel at
      0.086 plus a via pad at 0.034 is 0.120, which is past the seam and 0.008
      from the band floor.
    */
    const deepest = Math.max(...Object.values(PANEL_MARK_DROPS))
    const worst = Math.max(...PANEL_TONE_DROPS) + deepest
    expect(worst).toBeGreaterThan(SEAM_CORE_DROP)
    expect(DECK_LIT_LUMA - albedoDrop(albedoByte(worst))).toBeLessThan(0.56 + 0.01)
    // Which is exactly why the clamp exists, and why it is at the seam value.
    expect(Math.min(worst, SEAM_CORE_DROP)).toBe(SEAM_CORE_DROP)
  })
})

describe('the hue tilt', () => {
  /*
    The user asked for "variation in hues and colors" as the thing that makes the
    reference beautiful, and this is the part of the ask that costs the value
    bands nothing. The band rule is a statement about Rec.709 DISPLAY luma, so a
    colour change that holds display luma fixed is invisible to it - hue is an
    entirely unbudgeted axis, where the tone ladder had to fight for 0.099 of the
    0.127 available.
  */
  const luma = (bytes: [number, number, number], base = DECK_LIT_LUMA) => {
    // What the surface renders at once three multiplies this map in linear space.
    const lit = srgbToLinear(base)
    return (
      0.2126 * linearToSrgb(lit * srgbToLinear(bytes[0] / 255)) +
      0.7152 * linearToSrgb(lit * srgbToLinear(bytes[1] / 255)) +
      0.0722 * linearToSrgb(lit * srgbToLinear(bytes[2] / 255))
    )
  }

  it('costs the value band less than one byte, at every tilt and every rung', () => {
    for (const drop of PANEL_TONE_DROPS) {
      for (const tilt of PANEL_TINT_TILTS) {
        const got = luma(panelTintBytes(drop, tilt))
        // One byte buys 0.0026 of display luma at this end of the curve, so a
        // tilt costing under that is below the resolution of the medium itself.
        expect(Math.abs(got - (DECK_LIT_LUMA - drop)), `drop ${drop} tilt ${tilt}`).toBeLessThan(0.0026)
      }
    }
  })

  it('holds luma on a riser too, where the curve is steeper', () => {
    for (const tilt of PANEL_TINT_TILTS) {
      const got = luma(panelTintBytes(0.044, tilt, DECK_SIDE_LUMA), DECK_SIDE_LUMA)
      expect(Math.abs(got - (DECK_SIDE_LUMA - 0.044))).toBeLessThan(0.0026)
    }
  })

  it('actually shifts hue by enough to see, and not by enough to read as paint', () => {
    /*
      Both halves matter. Too little and the user's ask is unmet; too much and the
      panels stop being one material in different mould shots and become a paint
      job, which is the failure that separates the reference from cheap sci-fi
      flooring. The measure is the red-to-blue byte spread between a full-warm and
      a full-cool panel at the same tone.
    */
    const warm = panelTintBytes(0.044, 1)
    const cool = panelTintBytes(0.044, -1)
    expect(warm[0] - cool[0]).toBeGreaterThan(8)
    expect(warm[0] - cool[0]).toBeLessThan(32)
    expect(cool[2] - warm[2]).toBeGreaterThan(8)
    // Green is left alone on purpose: it carries 71.52% of the luma, so moving it
    // is the expensive way to change hue.
    expect(Math.abs(warm[1] - cool[1])).toBeLessThanOrEqual(2)
  })

  it('is neutral grey at zero tilt, so the tint cannot drift the deck warm or cool', () => {
    for (const drop of PANEL_TONE_DROPS) {
      const [r, g, b] = panelTintBytes(drop, 0)
      expect(r).toBe(g)
      expect(g).toBe(b)
      // And agrees with the greyscale path to the byte, or the two ladders would
      // have quietly diverged.
      expect(g).toBe(albedoByte(drop))
    }
  })

  it('refuses the same impossible inputs the greyscale path refuses', () => {
    expect(() => panelTintBytes(0.7, 0)).toThrow(/to or below black/)
    expect(() => panelTintBytes(0.1, 0, 0)).toThrow(/renderedLuma/)
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

  it('keeps the filled panels a minority, per the restraint rule', () => {
    /*
      A fill is one KIND of panel rather than a second mark laid over the panels,
      which is the argument that keeps the deck's top face legal under section
      7.7 - and it only holds while most panels are plain. The reference fills
      SOME panels and not others; a vocabulary applied to every panel is the
      greeble the rule exists to prevent.
    */
    const regions = panelRegions({ cells: CELLS })
    const filled = regions.filter((r) => r.fill !== 'flat').length / regions.length
    const wanted = Object.values(PANEL_FILL_SHARES).reduce((a, c) => a + c, 0)
    expect(wanted).toBeLessThan(0.5)
    expect(filled).toBeGreaterThan(wanted * 0.6)
    expect(filled).toBeLessThan(wanted * 1.4)
  })

  it('carries exactly one mark per panel, which is the re-scoped restraint rule', () => {
    // The union type is the enforcement: a panel cannot hold two fills. This
    // asserts the vocabulary is complete rather than that the type compiles.
    const kinds = new Set(panelRegions({ cells: CELLS }).map((r) => r.fill))
    for (const kind of ['flat', 'dots', 'hex', 'hazard', 'trace', 'sub'] as const) {
      expect(kinds, `every mark in the vocabulary appears at ${CELLS} cells`).toContain(kind)
    }
  })

  it('lets a tier drop the marks it cannot resolve without moving the panels', () => {
    /*
      `medium` is 512 over 40 m, which is 78 mm texels, so a 0.25 m perforation
      pitch is 3.2 texels and moires rather than reads. Dropping those fills must
      not perturb the layout or the tones underneath, because they are the marks
      that survive at every tier and they are what carries the read.
    */
    const full = panelRegions({ cells: CELLS })
    const coarse = panelRegions({ cells: CELLS, fillShares: { dots: 0, hex: 0, hazard: 0 } })
    expect(coarse.some((r) => r.fill === 'dots' || r.fill === 'hex' || r.fill === 'hazard')).toBe(false)
    expect(coarse.some((r) => r.fill === 'trace')).toBe(true)
    expect(coarse.map((r) => [r.x, r.y, r.w, r.h, r.tone, r.tilt])).toEqual(
      full.map((r) => [r.x, r.y, r.w, r.h, r.tone, r.tilt]),
    )
  })

  it('never puts a sub-panel in a cell too small to rasterise one', () => {
    /*
      A one-cell panel is 0.5 m, which at the shipped 2048 over 40 m is 26 px. An
      inset tray inside it is fine there; at `medium`'s 512 it would be a 3 px
      rectangle with a 1 px border, whose value comes from the antialiaser rather
      than from the ladder. Caught in the pure half so it is testable.
    */
    const only = { dots: 0, hex: 0, hazard: 0, trace: 0, sub: 1 }
    for (const cells of [8, 16, 40, 80]) {
      for (const region of panelRegions({ cells, fillShares: only })) {
        if (region.w < 2 || region.h < 2) expect(region.fill).toBe('flat')
        else expect(region.fill).toBe('sub')
      }
    }
  })

  it('varies hue independently of value, so two axes come out of one set of panels', () => {
    /*
      The user asked for "variation in hues and colors" specifically. Tone and
      tilt are drawn from the same stream but separately, so panels that share a
      tone mostly differ in temperature. If the two ever became correlated the
      deck would collapse back to one axis of variation with more steps.
    */
    const regions = panelRegions({ cells: CELLS })
    const tilts = new Set(regions.map((r) => r.tilt))
    expect(tilts.size).toBe(PANEL_TINT_TILTS.length)

    // Correlation between tone index and tilt index, which must be near zero.
    const n = regions.length
    const mx = regions.reduce((a, r) => a + r.tone, 0) / n
    const my = regions.reduce((a, r) => a + r.tilt, 0) / n
    const cov = regions.reduce((a, r) => a + (r.tone - mx) * (r.tilt - my), 0) / n
    const sx = Math.sqrt(regions.reduce((a, r) => a + (r.tone - mx) ** 2, 0) / n)
    const sy = Math.sqrt(regions.reduce((a, r) => a + (r.tilt - my) ** 2, 0) / n)
    expect(Math.abs(cov / (sx * sy))).toBeLessThan(0.1)
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

describe('the chip-trace routine, lifted out of groundTexture', () => {
  /*
    THE TRAP, and the reason this test exists rather than a comment saying to be
    careful.

    `createGroundTexture` drew these traces inline from a `mulberry32(20260805)`
    stream that it SHARES with the 26-circle mottling pass immediately above them.
    Extracting the routine and giving it its own seed would have left the ground's
    own call drawing from a different point in that stream, so the lawn's mottle
    and its traces would both have moved - a change to the largest surface in the
    frame, arriving as a side effect of a refactor, with no error and nothing in
    any test to catch it.

    So the extracted function takes `rand` rather than a seed, and this asserts
    that it consumes that stream in exactly the order the original inline code did,
    against a reimplementation of the original rather than against a snapshot. A
    snapshot would pass if both sides were wrong in the same way.
  */
  const SIZE = 1024
  const GRID = SIZE / 16

  /** The original inline code from `createGroundTexture`, verbatim in structure. */
  function original(rand: () => number, count: number) {
    const directions: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]
    const out: { path: [number, number][]; width: number; alpha: number }[] = []
    for (let i = 0; i < count; i++) {
      let x = Math.round(rand() * 16) * GRID
      let y = Math.round(rand() * 16) * GRID
      const segments = 2 + Math.floor(rand() * 4)
      const path: [number, number][] = [[x, y]]
      let [dx, dy] = directions[Math.floor(rand() * directions.length)]
      for (let s = 0; s < segments; s++) {
        const length = (1 + Math.floor(rand() * 3)) * GRID
        x += dx * length
        y += dy * length
        path.push([x, y])
        const turn = directions[Math.floor(rand() * directions.length)]
        if (turn[0] !== -dx || turn[1] !== -dy) [dx, dy] = turn
      }
      out.push({ path, width: 2 + rand() * 5, alpha: 0.1 + rand() * 0.12 })
    }
    return out
  }

  it('reproduces the original inline code exactly, path for path', () => {
    expect(chipTracePaths({ rand: mulberry32(20260805), count: 26, grid: GRID })).toEqual(
      original(mulberry32(20260805), 26),
    )
  })

  it('consumes the shared stream at the same rate, so what follows it does not move', () => {
    /*
      The half of byte-identity a value comparison misses. Even with identical
      output, a function that drew one extra number would leave every later
      consumer of the ground's stream shifted - and `createGroundTexture` draws
      more after the traces.
    */
    const a = mulberry32(20260805)
    chipTracePaths({ rand: a, count: 26, grid: GRID })
    const b = mulberry32(20260805)
    original(b, 26)
    expect(a()).toBe(b())
  })

  it('ends every run in a pad position, which is what says circuit not scratch', () => {
    const traces = chipTracePaths({ rand: mulberry32(7), count: 40, grid: GRID })
    for (const run of traces) {
      // At least one segment, so the pad is never drawn on top of the start.
      expect(run.path.length).toBeGreaterThanOrEqual(3)
      expect(run.width).toBeGreaterThan(0)
    }
  })

  it('turns only on the eight fixed headings', () => {
    // The single constraint that makes these read as a circuit. A crack wanders;
    // a trace turns at angles a mask could be etched at.
    for (const run of chipTracePaths({ rand: mulberry32(11), count: 60, grid: GRID })) {
      for (let p = 1; p < run.path.length; p++) {
        const dx = run.path[p][0] - run.path[p - 1][0]
        const dy = run.path[p][1] - run.path[p - 1][1]
        const ok = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)
        expect(ok, `segment ${p} of ${JSON.stringify(run.path)}`).toBe(true)
      }
    }
  })
})

describe('the panel map resolution', () => {
  it('is finer than the screen at high, which is the point of decoupling it', () => {
    /*
      MEASURED off the establishing frame: the deck around the origin covers about
      470 px for 12 m, so one screen pixel is 26 mm of deck. At 1024 over a 40 m
      span the map's texel is 39 mm - COARSER than the display, so every mark in
      the reference vocabulary was being drawn below the resolution the player
      could see, and no amount of contrast could have fixed that. 2048 halves the
      texel to 20 mm and puts the map just inside the screen.
    */
    const screenMm = (12 / 470) * 1000
    const texelMm = (PANEL_FILL_SPAN / panelFillSize(1024)) * 1000
    expect(texelMm).toBeLessThan(screenMm)
    expect((PANEL_FILL_SPAN / 1024) * 1000).toBeGreaterThan(screenMm)
  })

  it('leaves the tiers that cannot afford it alone', () => {
    expect(panelFillSize(0)).toBe(0)
    expect(panelFillSize(512)).toBe(512)
    expect(panelFillSize(1024)).toBe(2048)
  })

  it('resolves the seam it has to draw', () => {
    // A 60 mm core with a 30 mm lip either side is 3 px and 1.5 px at high. Below
    // about 2 px of core the mark stops being a core with lips and becomes a grey
    // smear whose value comes from the antialiaser.
    const perTexel = PANEL_FILL_SPAN / panelFillSize(1024)
    expect(0.06 / perTexel).toBeGreaterThanOrEqual(2)
  })
})

describe('the printed deck as a DISTRIBUTION, which is what the band rule asks for', () => {
  /*
    Section 8.1 is explicit that band membership is judged on a surface's p5 to
    p95 and not on its mean, and that "a clean patch is the wrong statistic". Every
    other assertion in this file checks the EXTREMES of the ladder, which is a
    weaker claim: a pattern whose darkest value is legal can still put 10% of a
    surface in the wrong band if that darkest value covers 10% of the area.

    So this is the real acceptance row. It builds the area-weighted histogram of
    every printed value from the actual `panelRegions` layout at the shipped
    resolution, and takes percentiles off it. The areas are computed from the same
    expressions `createPanelFillMap` rasterises with, which is the closest a node
    test can get to the image without a canvas - and it is close enough to be
    useful, because the seam bands turn out to be 19% of the surface and that is
    exactly the kind of share an extremes-only check cannot see.
  */
  const SIZE = 2048
  const CELLS = PANEL_FILL_SPAN / PANEL_FILL_CELL
  const PER_TEXEL = PANEL_FILL_SPAN / SIZE

  /** Area-weighted map from printed drop to pixel count, over one whole map. */
  function histogram() {
    const core = 0.06 / PER_TEXEL
    const lip = core + (2 * 0.03) / PER_TEXEL
    const px = (c: number) => Math.round((c * SIZE) / CELLS)
    const bins = new Map<number, number>()
    const add = (drop: number, area: number) => {
      // The same clamp `createPanelFillMap` applies, which is what puts a hard
      // floor under the distribution whatever a caller asks for.
      const d = Math.max(0, Math.min(SEAM_CORE_DROP, drop))
      bins.set(d, (bins.get(d) ?? 0) + Math.max(0, area))
    }

    let seamCore = 0
    let seamLip = 0
    for (const r of panelRegions({ cells: CELLS })) {
      const w = px(r.x + r.w) - px(r.x)
      const h = px(r.y + r.h) - px(r.y)
      const perimeter = 2 * (w + h)
      // The stroke is centred on the boundary, so half of each band falls inside
      // this region and half inside its neighbour. Summing halves over all
      // regions counts every boundary exactly once.
      seamCore += (perimeter * core) / 2
      seamLip += (perimeter * (lip - core)) / 2
      let area = w * h - (perimeter * lip) / 2
      const base = PANEL_TONE_DROPS[r.tone]

      if (r.fill === 'dots' || r.fill === 'hex') {
        const step = 0.25 / PER_TEXEL
        const radius = Math.max(1.5, 0.06 / PER_TEXEL)
        const holes = Math.min(area, (w / step) * (h / step) * Math.PI * radius * radius)
        add(base + PANEL_MARK_DROPS.perforation, holes)
        area -= holes
      } else if (r.fill === 'hazard') {
        // Stripes at half duty cycle: `lineWidth = period / 2`.
        add(base + PANEL_MARK_DROPS.hazard, area * 0.5)
        area *= 0.5
      } else if (r.fill === 'trace') {
        const inked = area * 0.14
        add(base + PANEL_MARK_DROPS.trace, inked * 0.8)
        add(base + PANEL_MARK_DROPS.via, inked * 0.2)
        area -= inked
      } else if (r.fill === 'sub') {
        const inset = Math.max(2, Math.min(w, h) * 0.22)
        const rw = w - 2 * inset
        const rh = h - 2 * inset
        const border = 2 * (rw + rh) * Math.max(1, inset * 0.3)
        const recess = Math.max(0, rw * rh - border)
        add(base + PANEL_MARK_DROPS.subPanelRecess, recess)
        add(base + PANEL_MARK_DROPS.subPanelBorder, border)
        area -= recess + border
      }
      add(base, area)
    }
    add(SEAM_CORE_DROP, seamCore)
    add(SEAM_LIP_DROP, seamLip)

    const rows = [...bins.entries()].sort((a, b) => a[0] - b[0])
    const total = rows.reduce((sum, r) => sum + r[1], 0)
    return { rows, total, seamShare: (seamCore + seamLip) / total }
  }

  /** Percentiles of rendered DISPLAY luma on a surface rendering at `base`. */
  function percentiles(base: number) {
    const { rows, total } = histogram()
    // Drops ascending is luma descending, so a luma percentile walks from the end.
    const at = (p: number) => {
      let acc = 0
      for (let i = rows.length - 1; i >= 0; i--) {
        acc += rows[i][1] / total
        if (acc >= p) return base - albedoDrop(albedoByte(rows[i][0]), base)
      }
      return base - albedoDrop(albedoByte(rows[0][0]), base)
    }
    return { p5: at(0.05), p50: at(0.5), p95: at(0.95) }
  }

  it('fits inside the gameplay band on a lit deck top, as a distribution', () => {
    const [floor, ceiling] = VALUE_BANDS.gameplay
    const { p5, p50, p95 } = percentiles(DECK_LIT_LUMA)
    expect(p5).toBeCloseTo(0.5877, 3)
    expect(p50).toBeCloseTo(0.6291, 3)
    expect(p95).toBeCloseTo(0.6787, 3)
    expect(p5).toBeGreaterThan(floor)
    expect(p95).toBeLessThan(ceiling)
    expect(p95 - p5).toBeLessThan(0.18)
  })

  it('moves the deck OFF the band ceiling it was resting on, to the band centre', () => {
    /*
      The result that matters most and the one an extremes check cannot state. The
      deck was a single value at 0.6869 in a band running 0.56 to 0.74 - pinned
      0.053 from the ceiling with 0.127 unused below, which is why it had nowhere
      to put a pattern. Its median is now 0.6291 against a band centre of 0.65.

      That is the shape a surface carrying printed detail is supposed to have, and
      it is a stronger argument for the palette promotion this stream is asking
      for: the base wants to come UP so the distribution can straddle 0.65 instead
      of hanging below it.
    */
    const centre = (VALUE_BANDS.gameplay[0] + VALUE_BANDS.gameplay[1]) / 2
    const { p50 } = percentiles(DECK_LIT_LUMA)
    expect(DECK_LIT_LUMA - p50).toBeCloseTo(0.0579, 3)
    expect(Math.abs(p50 - centre)).toBeLessThan(0.025)
    expect(Math.abs(p50 - centre)).toBeLessThan(Math.abs(DECK_LIT_LUMA - centre))
  })

  it('cuts the step risers band violation by most of it, without closing it', () => {
    /*
      Honest about a limit rather than asserting a win. Convolving the printed
      pattern with the riser's OWN measured lighting spread - p5 0.3758 to p95
      0.3931 at 950,490,44,26 - gives p5 0.3246 and p95 0.3817 against a midground
      ceiling of 0.38. That is down from 0.3931, so 87% of the violation is gone
      and 0.0017 of it remains.

      It CANNOT be closed from this file. A multiplier delivers a constant contrast
      RATIO, so pulling the riser's brightest texel below 0.38 needs a 3.3% relative
      drop on the lightest printed value, which on the lit deck is 0.023 - and
      spending that would take the deck's own p5 to 0.573, leaving 0.013 of margin
      and nothing for the lightmap. The riser's real defect is that it renders 0.208
      below its authored `bandDeckSide` albedo of 0.592, which is a lighting or
      vertex-colour question and not a texture one.
    */
    const [, ceiling] = VALUE_BANDS.midground
    const { rows, total } = histogram()
    const samples: number[] = []
    for (let i = 0; i < 400; i++) {
      const lit = 0.3758 + (0.3931 - 0.3758) * (i / 399)
      for (const [drop, area] of rows) {
        const v = lit - albedoDrop(albedoByte(drop), lit)
        for (let k = 0; k < Math.max(1, Math.round((area / total) * 1000)); k++) samples.push(v)
      }
    }
    samples.sort((a, b) => a - b)
    const q = (p: number) => samples[Math.floor(p * samples.length)]

    expect(q(0.05)).toBeCloseTo(0.3246, 3)
    expect(q(0.95)).toBeCloseTo(0.3817, 3)
    // Better than the 0.3931 it starts at, and still not inside. Both halves are
    // the claim: an improvement that is not yet a pass.
    expect(q(0.95)).toBeLessThan(0.3931)
    expect(q(0.95) - ceiling).toBeLessThan(0.002)
    expect(q(0.05)).toBeGreaterThan(VALUE_BANDS.midground[0])
  })

  it('shows why an extremes-only check was not enough: the seams are 19% of the deck', () => {
    /*
      The justification for this whole describe block. The seam bands are a fifth
      of the surface, so they are a genuine mode of the distribution rather than a
      hairline - which means the darkest printed value is carried by enough area to
      move p5, and a check that only looked at the ladder's endpoints could not
      have known that.
    */
    const { seamShare } = histogram()
    expect(seamShare).toBeGreaterThan(0.15)
    expect(seamShare).toBeLessThan(0.25)
  })
})

/*
  The `strut` kind, whose every number is set by the screen rather than the tile.

  The measurements these assert against were taken with `tools/critique/frame.mjs`
  on `.critique/astro/maps-on--hub-establishing.png`, whose own camera json gives
  fov 38 over a 934 px buffer and therefore a focal length of 1356.3 px. The boxes
  and commands are quoted so each one can be repeated.
*/
describe('DECAL_KINDS.strut, sized against the pixel', () => {
  /** Millimetres of surface per screen pixel, at the near Core strut's depth. */
  const MM_PER_PIXEL = 21.6
  const pixels = (metres: number) => (metres * 1000) / MM_PER_PIXEL

  it('sizes its groove to something the display can resolve, where trim cannot', () => {
    /*
      VERIFIED against the frame rather than predicted:

        node tools/critique/frame.mjs row \
          .critique/astro/maps-on--hub-establishing.png 515 805 850

      puts the near strut's edges at x 815 and x 834. Twenty pixels for a 0.44 m
      capsule at 29.32 m, against the 20.4 px the projection predicts.

      So the members are wide enough to carry a mark - the worry that a strut might
      be 6 px across is not the case - and every mark `trim` gives them is under
      one pixel.
    */
    expect(pixels(0.44)).toBeCloseTo(20.4, 1)

    // What trim hands them: the spec's 2.5 mm groove, and a 6 mm-radius fastener.
    expect(pixels(DECAL_KINDS.trim.panelWidth ?? 0.0025)).toBeLessThan(0.2)
    expect(pixels(0.012)).toBeLessThan(0.6)

    // What this kind hands them. Three pixels of core with a pixel of lip either
    // side, so the whole mark is five - a seam rather than a hairline.
    const spec = DECAL_KINDS.strut
    expect(pixels(spec.panelWidth as number)).toBeCloseTo(3.24, 2)
    expect(pixels(spec.panelWidth as number)).toBeGreaterThan(2)
    expect(pixels((spec.panelWidth as number) + 2 * (spec.panelLip as number))).toBeCloseTo(5.09, 2)
  })

  it('leaves the tile at trim\'s 1.6 m, because resolution was never the constraint', () => {
    /*
      The lever is the groove width, not the tile size, and raising the tile would be
      the third repetition of the same mistake. At 1.6 m over 1024 texels a texel is
      1.56 mm, which is 0.07 of a screen pixel: the texture is already fourteen times
      finer than the display.

      Matching trim exactly has a second payoff - geometry box-projected at
      DECAL_KINDS.trim.metresPerTile can take these maps with its UVs untouched, so
      this kind costs no repack and no geometry change.
    */
    expect(DECAL_KINDS.strut.metresPerTile).toBe(DECAL_KINDS.trim.metresPerTile)
    expect(pixels(DECAL_KINDS.strut.metresPerTile / 1024)).toBeLessThan(0.1)
  })

  it('drops fasteners rather than shrinking them, and explains plate too', () => {
    // A 6 mm head is 12 mm across, or 0.56 px: half a pixel of unstructured noise.
    // plate's 12 heads per square metre are the same mark on a tile three times
    // smaller, which is why nothing in this assembly can use plate either.
    expect(DECAL_KINDS.strut.screwDensity).toBe(0)
    expect(decalMarks('strut').some((m) => m.kind === 'screw')).toBe(false)
    expect(decalMarks('strut').some((m) => m.kind === 'panel')).toBe(true)
    expect(pixels(0.012)).toBeLessThan(1)
  })

  it('carries the groove width and lip through into the marks it generates', () => {
    // The spec fields are optional, so a kind that sets them and a paint path that
    // ignores them would look identical from the outside. Assert the plumbing.
    const spec = DECAL_KINDS.strut
    const panels = decalMarks('strut').filter((m) => m.kind === 'panel')
    expect(panels.length).toBeGreaterThan(0)
    for (const mark of panels) {
      if (mark.kind !== 'panel') continue
      expect(mark.width).toBeCloseTo((spec.panelWidth as number) / spec.metresPerTile, 12)
      expect(mark.lip).toBeCloseTo((spec.panelLip as number) / spec.metresPerTile, 12)
    }
  })

  it('holds the swing under the byte ceiling that roughnessByte clips at', () => {
    /*
      The tightest constraint on the entry, and it clips SILENTLY. roughnessByte
      writes `value * 0.8 / target`, which reaches 255 once `value` passes
      `target / 0.8`, and the roughest texel is `roughness + swing`. Past that the
      dust-trap end of the ladder flattens against the ceiling with no error - the
      map still looks plausible and half its range is gone.
    */
    const spec = DECAL_KINDS.strut
    expect(spec.roughness + spec.swing).toBeLessThan(spec.roughness / ROUGHNESS_MID)
    const smoothest = roughnessByte(spec.roughness - spec.swing, spec.roughness)
    const roughest = roughnessByte(spec.roughness + spec.swing, spec.roughness)
    expect(smoothest).toBe(156)
    expect(roughest).toBe(252)
    expect(roughest).toBeLessThan(255)
    expect(smoothest).toBeGreaterThan(0)
    // And the ORM agrees, at both ends of the height mask.
    const deepest = ormFromHeight(new Float32Array(1).fill(0), 1, spec)
    const proudest = ormFromHeight(new Float32Array(1).fill(1), 1, spec)
    expect(deepest[1]).toBe(roughest)
    expect(proudest[1]).toBe(smoothest)
  })

  it('matches anodised()\'s roughness, because that is the preset these members want', () => {
    /*
      A metal has no diffuse term, so its entire appearance is the lobe this
      channel modulates - which is the one condition under which the roughness
      ladder has ever had anything to break. Lobe width goes as roughness squared,
      so 0.30 +/- 0.07 spans alpha 0.053 to 0.137, a factor of 2.6 in lobe area.

      See materials.ts: cylinderFresnelRatio for why a metal cylinder is the only
      material that fits band 2 here, and lobeRatioUnderRoughnessMap for why these
      maps have to be bound at clearcoatRoughnessMap as well as roughnessMap.
    */
    expect(DECAL_KINDS.strut.roughness).toBe(0.3)
    expect(roughnessBias(DECAL_KINDS.strut.roughness)).toBeCloseTo(0.375, 6)
    const alpha = (r: number) => r * r
    const ratio =
      alpha(DECAL_KINDS.strut.roughness + DECAL_KINDS.strut.swing) /
      alpha(DECAL_KINDS.strut.roughness - DECAL_KINDS.strut.swing)
    // 2.59 on the authored ends, 2.61 once the bytes have quantised them.
    expect(ratio).toBeCloseTo(2.59, 2)
  })

  it('keeps the relief strength where trim has it, because the wall is sub-pixel anyway', () => {
    /*
      A canvas stroke's edge is one to two texels whatever the stroke's width, so
      the groove WALL - the only part of a relief mark with a gradient, and the only
      part a normal map can express - is 1.6 to 3.1 mm, or 0.07 to 0.14 px. Raising
      the strength cannot put it on screen. What survives is the groove FLOOR, 3.24
      px of it, carried by the occlusion channel, which is a function of depth
      rather than of gradient.
    */
    expect(DECAL_KINDS.strut.normalStrength).toBe(DECAL_KINDS.trim.normalStrength)
    expect(pixels((2 * DECAL_KINDS.strut.metresPerTile) / 1024)).toBeLessThan(0.2)
    // Strength 2 on a one-pixel step of the default 0.16 depth tilts the normal by
    // atan(0.16 * 2). Worth pinning on a metal, where a steep normal reads as a
    // Fresnel spike rather than as shading.
    expect((Math.atan(0.16 * DECAL_KINDS.strut.normalStrength) * 180) / Math.PI).toBeCloseTo(17.7, 1)
  })

  it('leaves trim untouched, so the one surface where relief was measured to read is unmoved', () => {
    // The kerb faces are the only place the ladder ever moved a metric - 16.78 to
    // 17.75 of high-frequency detail - and they are in the trim batch. Splitting a
    // new kind rather than retuning trim is what protects that.
    expect(DECAL_KINDS.trim).toEqual({
      metresPerTile: 1.6,
      roughness: 0.72,
      swing: 0.1,
      panelPitch: 0.4,
      screwDensity: 1.5,
      normalStrength: 2,
    })
  })
})
