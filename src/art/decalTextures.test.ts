import { describe, expect, it } from 'vitest'
import {
  DECAL_KINDS,
  ROUGHNESS_MID,
  ROUGHNESS_MID_BYTE,
  decalMarks,
  normalFromHeight,
  ormFromHeight,
  panelLines,
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
