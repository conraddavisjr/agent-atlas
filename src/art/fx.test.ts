import { describe, it, expect } from 'vitest'
import {
  GFX_ENABLEABLE,
  GFX_SYSTEMS,
  applyGfxEnables,
  applyGfxOverrides,
  overriddenQuality,
  parseFxOverrides,
  type GfxEnableable,
  type GfxSystem,
} from './fx'
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
      enabledSystems: [],
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
    expect(parsed.enabledSystems).toEqual([])
  })

  it('reads ?gfx by exactly the same rules as ?nogfx', () => {
    /*
      The point of sharing the parser is that these two can never become a
      strict one and a lax one. Every case asserted for `?nogfx` above is
      asserted here in the same shape, because "unknown tokens are dropped and
      the rest of the list still works" has to be one rule rather than two
      implementations that happen to agree today.
    */
    expect(parseFxOverrides('?gfx=ao').enabledSystems).toEqual(['ao'])
    expect(parseFxOverrides('?gfx=ao,rim,lut').enabledSystems).toEqual(['ao', 'rim', 'lut'])
    expect(parseFxOverrides('?gfx=AO, Rim ').enabledSystems).toEqual(['ao', 'rim'])
    expect(parseFxOverrides('?gfx=ao,bogus').enabledSystems).toEqual(['ao'])
    expect(parseFxOverrides('?gfx=').enabledSystems).toEqual([])
    expect(parseFxOverrides('?gfx').enabledSystems).toEqual([])
  })

  it('does not confuse ?gfx with ?nogfx in either direction', () => {
    // Two parameters whose names are a prefix of one another, typed by hand into
    // an address bar. A substring match anywhere in this path would make
    // `?nogfx=ao` read as an enable, which is the worst available bug here.
    expect(parseFxOverrides('?nogfx=ao').enabledSystems).toEqual([])
    expect(parseFxOverrides('?nogfx=ao').disabledSystems).toEqual(['ao'])
    expect(parseFxOverrides('?gfx=ao').disabledSystems).toEqual([])
    expect(parseFxOverrides('?gfx=ao').enabledSystems).toEqual(['ao'])
  })

  it('drops the two tokens that cannot honestly be turned on', () => {
    /*
      `vfx` has no `particleBudget` to restore - it is 0 at all three tiers - and
      `face` gates a system that was never written. Dropping them at the parse
      boundary rather than accepting them and doing nothing is the deliberate
      choice: a flag that parses and then changes no pixels is this codebase's
      signature defect, and the inert `<N8AO quality>` preset cost a round to
      find.
    */
    expect(parseFxOverrides('?gfx=vfx').enabledSystems).toEqual([])
    expect(parseFxOverrides('?gfx=face').enabledSystems).toEqual([])
    expect(parseFxOverrides('?gfx=vfx,ao,face').enabledSystems).toEqual(['ao'])
    // And they are still switchable OFF, which is the asymmetry, not an omission.
    expect(parseFxOverrides('?nogfx=vfx,face').disabledSystems).toEqual(['vfx', 'face'])
  })

  it('accepts every system ?gfx advertises, and nothing it does not', () => {
    expect(parseFxOverrides(`?gfx=${GFX_ENABLEABLE.join(',')}`).enabledSystems).toEqual([
      ...GFX_ENABLEABLE,
    ])
    // The enableable set must stay a subset of the systems that exist at all,
    // or `?gfx` would advertise a name `?nogfx` has never heard of.
    for (const system of GFX_ENABLEABLE) {
      expect(GFX_SYSTEMS).toContain(system)
    }
  })
})

describe('applyGfxEnables', () => {
  it('returns the same object when nothing is enabled', () => {
    expect(applyGfxEnables(QUALITY.high, [])).toBe(QUALITY.high)
  })

  it('turns ambient occlusion back on at every tier, which is the whole point', () => {
    /*
      AO is false at all three tiers as of the shadow-end decision, so `?nogfx=ao`
      subtracts nothing and the A/B that justified removing it is not repeatable
      without this. Asserted at all three tiers because the measurement that
      matters was taken at `high` and the tier-parity argument was about `low`.
    */
    for (const tier of ['low', 'medium', 'high'] as const) {
      expect(QUALITY[tier].ambientOcclusion, tier).toBe(false)
      expect(applyGfxEnables(QUALITY[tier], ['ao']).ambientOcclusion, tier).toBe(true)
    }
  })

  it('enables each system without touching anything else', () => {
    const base = { ...QUALITY.low, rimLight: false, contactShadow: false, colourGrade: false }

    expect(applyGfxEnables(base, ['rim']).rimLight).toBe(true)
    expect(applyGfxEnables(base, ['rim']).contactShadow).toBe(false)
    expect(applyGfxEnables(base, ['blob']).contactShadow).toBe(true)
    expect(applyGfxEnables(base, ['lut']).colourGrade).toBe(true)
    expect(applyGfxEnables(base, ['dof']).depthOfField).toBe(true)
    // Nothing that costs frame time may move as a side effect of one token.
    expect(applyGfxEnables(base, ['ao']).grassBlades).toBe(QUALITY.low.grassBlades)
    expect(applyGfxEnables(base, ['ao']).aoHalfRes).toBe(QUALITY.low.aoHalfRes)
  })

  it('never disables anything', () => {
    // The mirror of `applyGfxOverrides`' "never enables anything". An enable
    // flag that could switch something off would be a configuration no tier
    // describes, reachable from a URL, which is how a bisection tool becomes a
    // source of bugs instead of a way of finding them.
    for (const system of GFX_ENABLEABLE) {
      const on = applyGfxEnables(QUALITY.high, [system])
      for (const [key, value] of Object.entries(on)) {
        const before = QUALITY.high[key as keyof typeof QUALITY.high]
        if (typeof value === 'boolean') expect(!value && before, `${system}/${key}`).toBe(false)
        if (typeof value === 'number') {
          expect(value, `${system}/${key}`).toBeGreaterThanOrEqual(before as number)
        }
      }
    }
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
      enabledSystems: [],
    })
    expect(table.low.grassBlades).toBe(QUALITY.low.grassBlades)
    expect(table.high.grassBlades).toBe(QUALITY.high.grassBlades)
    expect(table.high.rimLight).toBe(false)
    expect(table.high.particleBudget).toBe(0)
  })
})

describe('overriddenQuality, with both levers pulled at once', () => {
  const table = (
    disabledSystems: readonly GfxSystem[],
    enabledSystems: readonly GfxEnableable[],
  ) =>
    overriddenQuality({
      disabled: false,
      bloomThreshold: null,
      bloomDebug: false,
      disabledSystems,
      enabledSystems,
    })

  it('gives ?nogfx the win when both name the same system', () => {
    /*
      `?gfx=ao&nogfx=ao` is AO off, and the ordering that produces that is
      deliberate rather than incidental.

      `?nogfx` is the rollback lever, and the sentence at the other end of it is
      "reload with this and tell me if it stops". That instruction has to hold
      whatever else is already in the address bar, including a `?gfx` copied out
      of a bug report. It also keeps one invariant true of the composition rather
      than of each half: the result can never enable something `?nogfx` named.
      Asserted in BOTH parameter orders, because URLSearchParams preserves the
      order they were typed in and the resolution must not depend on it.
    */
    expect(table(['ao'], ['ao']).high.ambientOcclusion).toBe(false)
    expect(table(['ao'], ['ao']).low.ambientOcclusion).toBe(false)
    expect(parseFxOverrides('?gfx=ao&nogfx=ao')).toEqual(
      parseFxOverrides('?nogfx=ao&gfx=ao'),
    )
  })

  it('applies the two to different systems independently', () => {
    // The common real case: turn one thing on to look at it, turn a suspected
    // interaction off at the same time.
    const t = table(['lut'], ['ao']).high
    expect(t.ambientOcclusion).toBe(true)
    expect(t.colourGrade).toBe(false)
    expect(t.rimLight).toBe(QUALITY.high.rimLight)
  })

  it('keeps object identity when neither lever is pulled', () => {
    // Same zustand-selector reason as the two halves: a fresh object per call
    // compares unequal on every render.
    const t = table([], [])
    expect(t.low).toBe(QUALITY.low)
    expect(t.medium).toBe(QUALITY.medium)
    expect(t.high).toBe(QUALITY.high)
  })

  it('honours the exact URLs the AO measurement is run from', () => {
    /*
      The contract as a person types it, parser and applier composed, because
      that is the thing that has to work and neither half proves it alone. These
      four strings are the ones written into the round-3 measurement script; a
      change that breaks one of them silently invalidates the only repeatable
      evidence for taking the AO pass out.
    */
    const table = (search: string) => overriddenQuality(parseFxOverrides(search))

    expect(table('?quality=high').high.ambientOcclusion).toBe(false)
    expect(table('?quality=high&gfx=ao').high.ambientOcclusion).toBe(true)
    expect(table('?quality=high&gfx=ao&nogfx=ao').high.ambientOcclusion).toBe(false)

    // And the pass it turns on is configured the way the measured one was.
    const on = table('?quality=high&gfx=ao').high
    expect(on.aoHalfRes).toBe(true)
    expect(on.aoSamples).toBe(16)
    expect(on.aoDenoiseSamples).toBe(8)
  })

  it('turns AO on at all three tiers together, so the A/B is not also a tier change', () => {
    /*
      The measurement this lever exists to repeat is AO on against AO off at ONE
      tier. If `?gfx=ao` reached only `high`, comparing at medium would silently
      be comparing tiers instead, which is the mistake the whole ladder-parity
      argument in `quality.ts` is about.
    */
    const t = table([], ['ao'])
    expect(t.low.ambientOcclusion).toBe(true)
    expect(t.medium.ambientOcclusion).toBe(true)
    expect(t.high.ambientOcclusion).toBe(true)
    // And it changes nothing else about what separates the tiers.
    expect(t.low.grassBlades).toBe(QUALITY.low.grassBlades)
    expect(t.high.grassBlades).toBe(QUALITY.high.grassBlades)
    expect(t.low.aoDenoiseSamples).toBe(QUALITY.low.aoDenoiseSamples)
    expect(t.high.aoDenoiseSamples).toBe(QUALITY.high.aoDenoiseSamples)
  })
})
