import { describe, it, expect } from 'vitest'
import { GFX_SYSTEMS, applyGfxOverrides, overriddenQuality, parseFxOverrides } from './fx'
import { QUALITY } from './quality'

/*
  These are the measurement and rollback levers, so a flag that silently does
  not work is worse than no flag: it produces a session of bisecting against a
  parameter that was never read, and the conclusion drawn from it is wrong in a
  way nothing reports.
*/

describe('parseFxOverrides', () => {
  it('reads an empty search as "change nothing"', () => {
    expect(parseFxOverrides('')).toEqual({
      disabled: false,
      bloomThreshold: null,
      bloomDebug: false,
      disabledSystems: [],
    })
  })

  it('still handles ?nofx, with or without the leading question mark', () => {
    expect(parseFxOverrides('?nofx').disabled).toBe(true)
    expect(parseFxOverrides('nofx').disabled).toBe(true)
    expect(parseFxOverrides('?quality=low').disabled).toBe(false)
  })

  it('parses ?threshold as a number and refuses to produce NaN', () => {
    expect(parseFxOverrides('?threshold=1.2').bloomThreshold).toBe(1.2)
    expect(parseFxOverrides('?threshold=0').bloomThreshold).toBe(0)
    // The three cases have to stay distinguishable. NaN would compare false
    // against everything and mask as "no bloom at all" rather than as an error.
    expect(parseFxOverrides('?threshold=abc').bloomThreshold).toBeNull()
    expect(parseFxOverrides('?threshold=').bloomThreshold).toBeNull()
    expect(parseFxOverrides('').bloomThreshold).toBeNull()
  })

  it('treats ?bloomdebug as a bare flag', () => {
    expect(parseFxOverrides('?bloomdebug').bloomDebug).toBe(true)
    expect(parseFxOverrides('?bloomdebug=1').bloomDebug).toBe(true)
    expect(parseFxOverrides('?threshold=1.4&bloomdebug').bloomDebug).toBe(true)
    expect(parseFxOverrides('?threshold=1.4').bloomDebug).toBe(false)
  })

  it('reads ?nogfx as a comma list and ignores names it does not know', () => {
    expect(parseFxOverrides('?nogfx=rim').disabledSystems).toEqual(['rim'])
    expect(parseFxOverrides('?nogfx=rim,dof,lut').disabledSystems).toEqual(['rim', 'dof', 'lut'])
    // Whitespace and case, because this gets typed by hand into an address bar.
    expect(parseFxOverrides('?nogfx=RIM, Dof ').disabledSystems).toEqual(['rim', 'dof'])
    // A typo drops that entry rather than the whole flag, so the rest still works.
    expect(parseFxOverrides('?nogfx=rim,bogus').disabledSystems).toEqual(['rim'])
    expect(parseFxOverrides('?nogfx=').disabledSystems).toEqual([])
  })

  it('accepts every system it advertises', () => {
    expect(parseFxOverrides(`?nogfx=${GFX_SYSTEMS.join(',')}`).disabledSystems).toEqual([
      ...GFX_SYSTEMS,
    ])
  })

  it('ignores parameters that belong to someone else', () => {
    const parsed = parseFxOverrides('?quality=high&nofx&debug=1')
    expect(parsed.disabled).toBe(true)
    expect(parsed.bloomThreshold).toBeNull()
    expect(parsed.disabledSystems).toEqual([])
  })
})

describe('applyGfxOverrides', () => {
  it('returns the same object when nothing is disabled', () => {
    // Identity, not equality. The result is handed to a zustand selector, and a
    // fresh object every call compares unequal on every render.
    expect(applyGfxOverrides(QUALITY.high, [])).toBe(QUALITY.high)
  })

  it('forces each system off without touching anything else', () => {
    const base = { ...QUALITY.high, rimLight: true, contactShadow: true, colourGrade: true }

    expect(applyGfxOverrides(base, ['rim']).rimLight).toBe(false)
    expect(applyGfxOverrides(base, ['rim']).contactShadow).toBe(true)
    expect(applyGfxOverrides(base, ['blob']).contactShadow).toBe(false)
    expect(applyGfxOverrides(base, ['lut']).colourGrade).toBe(false)
    expect(applyGfxOverrides(base, ['dof']).depthOfField).toBe(false)
    expect(applyGfxOverrides(base, ['face']).faceAnimation).toBe(false)
  })

  it('takes both halves of the VFX gate together', () => {
    // Two fields, one system. Leaving the budget non-zero while the detail
    // level is off would allocate a pool nothing draws from.
    const base = { ...QUALITY.high, particleBudget: 400, vfxDetail: 'full' as const }
    const off = applyGfxOverrides(base, ['vfx'])
    expect(off.particleBudget).toBe(0)
    expect(off.vfxDetail).toBe('off')
  })

  it('never enables anything', () => {
    // A disable flag that could turn something on would be a way to get a
    // configuration no tier describes, which is the opposite of a bisection tool.
    for (const system of GFX_SYSTEMS) {
      const off = applyGfxOverrides(QUALITY.low, [system])
      for (const [key, value] of Object.entries(off)) {
        const before = QUALITY.low[key as keyof typeof QUALITY.low]
        if (typeof value === 'boolean') expect(value && !before).toBe(false)
        if (typeof value === 'number') expect(value).toBeLessThanOrEqual(before as number)
      }
    }
  })

  it('leaves every tier intact and distinct', () => {
    const table = overriddenQuality({
      disabled: false,
      bloomThreshold: null,
      bloomDebug: false,
      disabledSystems: ['rim', 'vfx'],
    })
    expect(table.low.grassBlades).toBe(QUALITY.low.grassBlades)
    expect(table.high.grassBlades).toBe(QUALITY.high.grassBlades)
    expect(table.high.rimLight).toBe(false)
    expect(table.high.particleBudget).toBe(0)
  })
})
