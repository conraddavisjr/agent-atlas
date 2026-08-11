import { describe, expect, it } from 'vitest'
import {
  SHARD_ALBEDO_CEILING,
  SHARD_GLASS,
  SHARD_WAS,
  chromaSpread,
  glassShard,
  holdLuminanceCost,
  shardEmissiveWasLinearRed,
} from './glassShard'
import { BLOOM_THRESHOLD, MAX_CLEARCOAT, crystal, linearLuma } from './materials'
import { displayLuma, palette } from './palette'

describe('chromaSpread', () => {
  it('is zero for a neutral and one for a primary', () => {
    expect(chromaSpread('#808080')) .toBe(0)
    expect(chromaSpread('#ff0000')).toBe(1)
  })

  it('expands three-digit hex', () => {
    expect(chromaSpread('#f00')).toBe(chromaSpread('#ff0000'))
  })

  it('throws on a malformed colour rather than reporting a plausible zero', () => {
    expect(() => chromaSpread('#nope')).toThrow(/cannot read/)
  })
})

describe('what was wrong with the pink shards', () => {
  /*
    The two independent mechanisms, both measured rather than described. Kept as
    tests rather than as comments so that a later change which walks either one
    back fails here instead of passing review.
  */
  it('was clipping the red channel from the emissive term alone', () => {
    // Above 1.0 in linear light is a channel nothing downstream can recover.
    expect(shardEmissiveWasLinearRed()).toBeGreaterThan(1)
    expect(shardEmissiveWasLinearRed()).toBeCloseTo(1.346, 3)
  })

  it('was the most saturated thing in frame, by a factor of fifteen over the hero', () => {
    expect(chromaSpread(SHARD_WAS.color)).toBeCloseTo(0.58, 2)
    expect(chromaSpread(palette.shell)).toBeLessThan(0.05)
    expect(chromaSpread(SHARD_WAS.color) / chromaSpread(palette.shell)).toBeGreaterThan(14)
  })

  it('measured brighter than the deck it was meant to sit under', () => {
    expect(SHARD_WAS.measured[0]).toBeGreaterThan(SHARD_WAS.deck[0])
    expect(SHARD_WAS.measured[1]).toBeGreaterThan(SHARD_WAS.deck[1])
  })
})

describe('the glass that replaces it', () => {
  it('drops the chroma by more than five times', () => {
    expect(chromaSpread(SHARD_GLASS.color)).toBeCloseTo(0.11, 2)
    expect(chromaSpread(SHARD_WAS.color) / chromaSpread(SHARD_GLASS.color)).toBeGreaterThan(5)
  })

  /*
    The one-line statement of the whole fix: decoration's albedo is not brighter
    than the floor's. It is a claim about albedo rather than about the frame, so
    it is necessary and not sufficient - the rendered check is the integrator's -
    but it is the half that can be held here.
  */
  it('is no brighter as an albedo than the deck it stands beside', () => {
    expect(displayLuma(SHARD_GLASS.color)).toBeLessThanOrEqual(SHARD_ALBEDO_CEILING)
    expect(displayLuma(SHARD_GLASS.color)).toBeCloseTo(0.7307, 4)
    // The margin under the deck is thin on purpose: any paler and the shard's
    // albedo starts claiming the background band it is standing in front of.
    expect(SHARD_ALBEDO_CEILING - displayLuma(SHARD_GLASS.color)).toBeLessThan(0.01)
  })

  it('lands within half a per cent of the deck in linear light too', () => {
    const ratio = linearLuma(SHARD_GLASS.color) / linearLuma(palette.rock)
    expect(ratio).toBeGreaterThan(0.99)
    expect(ratio).toBeLessThan(1.01)
  })

  it('is genuinely more transparent than the preset it is built on', () => {
    expect(SHARD_GLASS.opacity).toBeLessThan(crystal('#ffffff').opacity as number)
    expect(glassShard().opacity).toBe(0.45)
  })
})

describe('glassShard', () => {
  /*
    The art bible's section 6 and `02-materials.md` line 157 both ban
    transmission here by name, and the cost is an extra full-resolution opaque
    scene render per frame with a forced 4x MSAA resolve and a mip chain, on a
    scene whose opaque set includes a 1.43M-triangle grass field. Asserted rather
    than left to a comment because `gel()` is still exported and still one
    autocomplete away.
  */
  it('carries no transmission and no thickness', () => {
    const m = glassShard()
    expect('transmission' in m).toBe(false)
    expect('thickness' in m).toBe(false)
  })

  /*
    `GLOW.hold` normalises, so it adds a fixed 0.1305 of linear luminance at any
    hue. Against a shard facet near 0.198 that is a 66% lift rather than a floor,
    and after the alpha blend it moves the shard from display 0.507 to 0.556 -
    back over the lawn. A 45%-opaque object cannot go dead in shadow anyway,
    because what shows through it is whatever is behind it.
  */
  it('carries no emissive at all', () => {
    const m = glassShard()
    expect('emissive' in m).toBe(false)
    expect('emissiveIntensity' in m).toBe(false)
    expect(SHARD_GLASS.glow).toBe(0)
  })

  it('records what GLOW.hold would have cost, so the refusal stays checkable', () => {
    expect(holdLuminanceCost()).toBeCloseTo(0.1305, 4)
    // Bigger than half the lit facet it was offered as a floor under.
    expect(holdLuminanceCost() / 0.198).toBeGreaterThan(0.6)
  })

  /*
    The facets are the point. `geometry.ts` calls faceting the one sanctioned
    exception to the no-hard-edges rule, so nothing here may soften the surface
    that shows them: the roughness, the coat and the coat's roughness all pass
    through `crystal()` untouched.
  */
  it('keeps every facet-defining property of crystal() unchanged', () => {
    const m = glassShard()
    const base = crystal(SHARD_GLASS.color)
    expect(m.roughness).toBe(base.roughness)
    expect(m.clearcoat).toBe(base.clearcoat)
    expect(m.clearcoatRoughness).toBe(base.clearcoatRoughness)
    expect(m.envMapIntensity).toBe(base.envMapIntensity)
    expect(m.transparent).toBe(true)
  })

  it('respects the bible clearcoat ceiling', () => {
    expect(glassShard().clearcoat as number).toBeLessThanOrEqual(MAX_CLEARCOAT)
  })

  /*
    Depth writing left at crystal()'s default of true, deliberately. Depth testing
    is LESS, so occlusion between shards inside one merged grove comes out right
    whatever the batch's arbitrary internal draw order is; `depthWrite: false`
    would swap that correct result for an order-dependent one.
  */
  it('does not disable depth writing', () => {
    expect('depthWrite' in glassShard()).toBe(false)
  })

  /*
    The opacity is what buys the bloom headroom that lets `envMapIntensity` stay
    at crystal()'s 1.2. The rig's brightest Lightformer is 1.40 and the bible caps
    it at 1.60; a grazing facet at clearcoat 0.85 reaches 1.428, which is 0.985 of
    the threshold. The alpha blend is not premultiplied, so the same facet reaches
    0.45 x 1.428 = 0.643 plus the backdrop's share in the framebuffer.
  */
  it('keeps a grazing envmap facet clear of the bloom threshold after the blend', () => {
    const grazing = 1.4 * (glassShard().envMapIntensity as number) * (glassShard().clearcoat as number)
    // Without the opacity this is a coin toss against the threshold.
    expect(grazing / BLOOM_THRESHOLD).toBeGreaterThan(0.95)
    // With it, there is real margin. 0.245 is the lawn's linear luminance.
    const blended = SHARD_GLASS.opacity * grazing + (1 - SHARD_GLASS.opacity) * 0.245
    expect(BLOOM_THRESHOLD / blended).toBeGreaterThan(1.8)
  })

  it('lets a caller override without losing the preset underneath', () => {
    const m = glassShard({ opacity: 0.6 })
    expect(m.opacity).toBe(0.6)
    expect(m.color).toBe(SHARD_GLASS.color)
  })
})
