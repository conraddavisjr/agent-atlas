import { describe, it, expect } from 'vitest'
import {
  ANODISED_ANISOTROPY,
  BLOOM_INTENSITY,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
  GLOW,
  LOW_LUMA_FLOOR,
  MAX_CLEARCOAT,
  TWO_LOBE_MIN_RATIO,
  anodised,
  bloomFarFieldWeight,
  bloomMipWeights,
  chrome,
  coatLobeRatioUnderMap,
  crystal,
  emissive,
  emissiveIntensityFor,
  emissiveRaw,
  flock,
  gel,
  ground,
  linearLuma,
  linearToSrgb,
  linearise,
  lobeRatio,
  luma709,
  mattePlastic,
  metal,
  plastic,
  rubber,
  shell,
  srgbToLinear,
  stone,
  vinyl,
  visorPlate,
} from './materials'
import { DECAL_KINDS, ROUGHNESS_MID_BYTE, roughnessByte } from './decalTextures'
import { palette } from './palette'

/*
  The arithmetic behind every emissive in the game.

  This is worth testing to four decimal places rather than by eye because the
  failure it protects against is invisible: an emissive that is 20% below the
  bloom threshold looks exactly like one that is 20% above it in a still frame
  with no reference, and the entire palette was shipped that way. The numbers
  below were computed independently and cross-checked against the materials
  spec's table, which is why they are written out rather than derived from the
  implementation.
*/

describe('srgbToLinear', () => {
  it('pins the ends exactly', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 12)
  })

  it('uses the linear segment below the knee', () => {
    // Below 0.04045 the transfer function is a straight line at 1/12.92, not
    // the power curve. Getting this wrong is invisible everywhere except in
    // near-black, which is exactly where a coloured shadow lives.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12)
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12)
  })

  it('darkens the midpoint, which is the whole reason the curve exists', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4)
  })

  it('is monotone', () => {
    let previous = -1
    for (let i = 0; i <= 255; i++) {
      const value = srgbToLinear(i / 255)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })
})

describe('luma709', () => {
  it('maps neutral to itself', () => {
    // The coefficients sum to 1, so grey in is the same grey out. If this fails
    // the weights have been mistyped, which is the only likely error here.
    expect(luma709(0, 0, 0)).toBe(0)
    expect(luma709(1, 1, 1)).toBeCloseTo(1, 12)
    expect(luma709(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('weights green about ten times blue', () => {
    expect(luma709(0, 1, 0) / luma709(0, 0, 1)).toBeGreaterThan(9)
  })
})

describe('linearise', () => {
  it('reads both hex forms and ignores the hash', () => {
    expect(linearise('#ffffff')).toEqual([1, 1, 1])
    expect(linearise('000000')).toEqual([0, 0, 0])
    expect(linearise('#fff')).toEqual(linearise('#ffffff'))
  })

  it('throws on anything it cannot read', () => {
    // Silently returning black would divide by zero downstream and produce an
    // Infinity emissiveIntensity, which renders as a white screen.
    expect(() => linearise('rebeccapurple')).toThrow(/hex colour/)
    expect(() => linearise('#12345')).toThrow(/hex colour/)
  })
})

describe('linearLuma against the palette', () => {
  /*
    The table this whole system was designed from. Every one of these was
    computed by hand before the code existed; if the implementation drifts, this
    is where it shows up rather than in a screenshot six commits later.
  */
  const cases: [string, string, number][] = [
    ['visor / circuit', palette.visor, 0.6319],
    ['unlocked', palette.unlocked, 0.6916],
    ['accent', palette.accent, 0.4470],
    ['nodeGlow', palette.nodeGlow, 0.3910],
    ['token', palette.token, 0.3663],
    ['caveCrystal', palette.caveCrystal, 0.2687],
    ['accentDeep', palette.accentDeep, 0.2523],
    ['node', palette.node, 0.2202],
  ]

  for (const [name, hex, expected] of cases) {
    it(`${name} is ${expected}`, () => {
      expect(linearLuma(hex)).toBeCloseTo(expected, 4)
    })
  }

  it('spans a factor of nearly three across the palette, which is the problem', () => {
    // Cyan carries 2.9 times the luminance of violet at the same
    // emissiveIntensity. That ratio is why a flat intensity argument could
    // never mean the same thing twice, and it is the reason this file
    // normalises at all.
    expect(linearLuma(palette.visor) / linearLuma(palette.node)).toBeCloseTo(2.87, 2)
  })
})

describe('emissiveIntensityFor', () => {
  it('lands glow 1.0 exactly on the threshold, for every hue it accepts', () => {
    /*
      The defining property. For each colour, the raw luminance three hands to
      the bloom pass is `luma709(linear(colour)) * emissiveIntensity`, so
      multiplying the returned intensity back by the colour's luminance must
      reproduce the threshold and nothing else. That it holds for cyan, gold,
      amber and pink alike is the entire claim being made by the unit change.
    */
    for (const hex of [palette.visor, palette.unlocked, palette.accent, palette.token, '#ffffff']) {
      const raw = linearLuma(hex) * emissiveIntensityFor(hex, 1)
      expect(raw).toBeCloseTo(BLOOM_THRESHOLD, 10)
    }
  })

  it('is linear in glow', () => {
    const at1 = emissiveIntensityFor(palette.visor, 1)
    expect(emissiveIntensityFor(palette.visor, 2)).toBeCloseTo(at1 * 2, 10)
    expect(emissiveIntensityFor(palette.visor, 0.5)).toBeCloseTo(at1 / 2, 10)
  })

  it('reproduces the spec table at the measured threshold', () => {
    /*
      These were the spec's own numbers at a threshold of 1.75. The threshold
      has since been measured at 1.45, and every one of them scales by exactly
      1.45 / 1.75 = 0.82857, because the whole point of the normalisation is
      that an emissive's distance above the line does not depend on the line.
      The next assertion is what actually holds that invariant; these are here
      so the absolute values are pinned and a silent drift in either direction
      has to be typed out on purpose.
    */
    expect(emissiveIntensityFor(palette.visor, GLOW.bloom)).toBeCloseTo(2.87, 2)
    expect(emissiveIntensityFor(palette.accent, GLOW.bloom)).toBeCloseTo(4.06, 2)
    expect(emissiveIntensityFor(palette.unlocked, GLOW.bloom)).toBeCloseTo(2.62, 2)
    expect(emissiveIntensityFor(palette.visor, GLOW.source)).toBeCloseTo(1.51, 2)
    expect(emissiveIntensityFor(palette.token, GLOW.source)).toBeCloseTo(2.61, 2)
  })

  it('keeps every emissive at the same multiple of the threshold, whatever it is', () => {
    /*
      The invariant that makes the threshold safe to move. Lowering it must move
      every emissive with it, or measuring the threshold would silently change
      which things glow - which is the failure the normalisation was introduced
      to end.
    */
    for (const hex of [palette.visor, palette.unlocked, palette.accent, palette.token]) {
      const raw = linearLuma(hex) * emissiveIntensityFor(hex, GLOW.bloom)
      expect(raw / BLOOM_THRESHOLD).toBeCloseTo(GLOW.bloom, 10)
    }
  })

  it('puts tier A above the threshold and tier B below it, whatever the hue', () => {
    // The property the tiers exist for: "must bloom" and "must not bloom" are
    // now statements about the object rather than about its colour.
    for (const hex of [palette.visor, palette.unlocked, palette.accent, palette.token]) {
      const luma = linearLuma(hex)
      expect(luma * emissiveIntensityFor(hex, GLOW.bloom)).toBeGreaterThan(BLOOM_THRESHOLD)
      expect(luma * emissiveIntensityFor(hex, GLOW.source)).toBeLessThan(BLOOM_THRESHOLD)
    }
  })

  it('refuses to normalise a colour below the low-luma floor', () => {
    /*
      The mandatory exception. Violet at 0.2202 would need an intensity near 8
      to reach the threshold, and a surface emitting eight times the brightest
      lit thing in the scene renders as white with a violet fringe. Refusing is
      the correct behaviour: the fix is geometry, a pale core with a saturated
      halo, and no arithmetic in this file can produce it.
    */
    for (const hex of [palette.node, palette.caveCrystal, palette.accentDeep]) {
      expect(linearLuma(hex)).toBeLessThan(LOW_LUMA_FLOOR)
      expect(() => emissiveIntensityFor(hex, GLOW.source)).toThrow(/pale near-white core/)
    }
  })

  it('accepts everything at or above the floor', () => {
    for (const hex of [palette.token, palette.nodeGlow, palette.accent, palette.visor]) {
      expect(linearLuma(hex)).toBeGreaterThanOrEqual(LOW_LUMA_FLOOR)
      expect(() => emissiveIntensityFor(hex, GLOW.source)).not.toThrow()
    }
  })

  it('names the technique in the error, because the error is the documentation', () => {
    expect(() => emissiveIntensityFor(palette.node, 1)).toThrow(/halo/)
    expect(() => emissiveIntensityFor(palette.node, 1)).toThrow(/art-bible/)
  })
})

describe('GLOW tiers', () => {
  it('orders the three tiers around the threshold', () => {
    expect(GLOW.bloom).toBeGreaterThan(1)
    expect(GLOW.source).toBeLessThan(1)
    expect(GLOW.hold).toBeLessThan(GLOW.source)
  })

  it('leaves the colour-hold tier far below anything that could bloom', () => {
    // Tier C exists so a surface does not go dead in shadow. If it ever creeps
    // up toward the threshold it has stopped being a floor and become a light.
    expect(GLOW.hold * BLOOM_THRESHOLD).toBeLessThan(0.25)
  })
})

/*
  The bloom budget's other two numbers.

  The threshold above decides WHAT glows. These decide whether the thing that
  glows has a halo, and they are tested here for the same reason the threshold
  is: the failure is invisible in a still frame. A correctly normalised emissive
  with the wide mips turned down renders as a bright two-pixel edge, which looks
  exactly like a correctly normalised emissive that simply is not very bright.
*/
describe('bloomMipWeights', () => {
  it('is a normalised blend, not a sum', () => {
    // The upsampling step is mix(support, blur(coarser), radius) at every rung,
    // so the level weights are a partition of one. Raising the radius moves the
    // bloom outward; it does not brighten it. Getting this backwards is the
    // whole reason the dial was set to 0.6.
    for (const radius of [0, 0.25, 0.6, 0.85, 1]) {
      for (const levels of [4, 6, 8]) {
        const weights = bloomMipWeights(radius, levels)
        expect(weights).toHaveLength(levels)
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
      }
    }
  })

  it('reproduces the shipped and previous distributions exactly', () => {
    expect(bloomMipWeights(0.6, 8).map((w) => Number(w.toFixed(4)))).toEqual([
      0.4, 0.24, 0.144, 0.0864, 0.0518, 0.0311, 0.0187, 0.028,
    ])
    expect(bloomMipWeights(0.85, 8).map((w) => Number(w.toFixed(4)))).toEqual([
      0.15, 0.1275, 0.1084, 0.0921, 0.0783, 0.0666, 0.0566, 0.3206,
    ])
  })

  it('hands everything to the sharpest mip at radius zero and the coarsest at one', () => {
    expect(bloomMipWeights(0, 8)[0]).toBe(1)
    expect(bloomMipWeights(1, 8)[7]).toBe(1)
  })
})

describe('the shipped bloom dials', () => {
  it('puts enough of the glow in the wide mips to be a halo at all', () => {
    /*
      The acceptance number for "nothing glows". Mips 0 to 3 all fall off inside
      about sixteen pixels and are indistinguishable from the object's own edge,
      so the halo is entirely mips 4 and coarser. The shipped rig had 0.071 there
      and produced a two-pixel transition with no halo on an emissive that was
      genuinely over the threshold.
    */
    expect(bloomFarFieldWeight(0.6, 0.55)).toBeCloseTo(0.0713, 4)
    expect(bloomFarFieldWeight()).toBeGreaterThan(0.25)
    expect(bloomFarFieldWeight()).toBeCloseTo(0.4437, 4)
  })

  it('does not add near-field bloom while doing it', () => {
    /*
      The constraint that stops this fix breaking the other one. `hub-backlit`
      already has a clipped white specular spilling into the sky, so the pair of
      numbers has to raise the far field WITHOUT raising what lands within a few
      pixels of a bright source. Because the radius redistributes rather than
      scales, it does: the near field falls by a third even as the intensity
      rises.
    */
    const near = (r: number, i: number) =>
      bloomMipWeights(r, 8).slice(0, 2).reduce((a, b) => a + b, 0) * i
    expect(near(0.6, 0.55)).toBeCloseTo(0.352, 3)
    expect(near(BLOOM_RADIUS, BLOOM_INTENSITY)).toBeCloseTo(0.2359, 4)
    expect(near(BLOOM_RADIUS, BLOOM_INTENSITY)).toBeLessThan(near(0.6, 0.55))
  })

  it('keeps a sharp core, which radius 1 would discard', () => {
    // At 1.0 the mix drops supportBuffer entirely at every rung and the glow
    // loses its centre.
    expect(BLOOM_RADIUS).toBeLessThan(1)
    expect(bloomMipWeights(BLOOM_RADIUS, 8)[0]).toBeGreaterThan(0.1)
  })
})

/*
  The two rules the art bible's section 5 puts on every material preset.

  Both are pure arithmetic on numbers that are otherwise only visible as a
  slightly-wrong highlight, which is to say invisible. `plastic()` shipped at a
  lobe ratio of 1.96 and a clearcoat of 1.0 for the whole project, and the
  clearcoat is one of the two mechanisms behind the clipped dome specular in
  `hub-backlit`.
*/
describe('the two-lobe and clearcoat rules, across every preset', () => {
  const maps = {
    map: null,
    normalMap: null,
    roughnessMap: null,
    aoMap: null,
  } as unknown as Parameters<typeof stone>[1]

  const presets = {
    plastic: plastic('#ffffff'),
    mattePlastic: mattePlastic('#ffffff'),
    rubber: rubber('#ffffff'),
    metal: metal('#ffffff'),
    anodised: anodised('#ffffff'),
    emissive: emissive(palette.visor),
    emissiveRaw: emissiveRaw(palette.visor, 2),
    stone: stone('#ffffff', maps),
    ground: ground('#ffffff', maps),
    gel: gel('#ffffff'),
    shell: shell('#ffffff'),
    vinyl: vinyl('#ffffff'),
    flock: flock('#ffffff'),
    chrome: chrome(),
    crystal: crystal('#ffffff'),
    visorPlate: visorPlate(),
  }

  /*
    Named exemptions, with the reason, rather than a rule that quietly does not
    apply everywhere. Anything not on this list has to pass.
  */
  const exemptFromTwoLobe: Record<string, string> = {
    // The base lobe is not meant to be visible: a solid transparent body, not a
    // coated opaque one. The bible grants this one by name.
    crystal: 'one lobe by design',
    // Clearcoat 0.15 - the second lobe carries 15% of the surface and the rule
    // is about two lobes that both read. Owned by the environment stream, and
    // the photographic albedo it wraps is being replaced anyway.
    stone: 'clearcoat 0.15, and the preset is being retired',
    // Being replaced wholesale by crystal(); changing it now would move thirteen
    // objects that are about to move again.
    gel: 'superseded by crystal()',
  }

  for (const [name, preset] of Object.entries(presets)) {
    const base = preset.roughness as number
    const coat = preset.clearcoat as number | undefined
    const coatRoughness = (preset.clearcoatRoughness as number | undefined) ?? 0

    it(`${name}: clearcoat never exceeds ${MAX_CLEARCOAT}`, () => {
      expect(coat ?? 0).toBeLessThanOrEqual(MAX_CLEARCOAT)
    })

    it(`${name}: declares its coat roughness if it has a coat`, () => {
      /*
        The hole this sweep had, and it hid a real defect for two rounds.

        `?? 0` above reads a missing `clearcoatRoughness` as zero, and
        `lobeRatio(base, 0)` is Infinity, so the two-lobe rule passed VACUOUSLY on
        any preset that forgot to set one - which `metal()` did, giving the robot's
        curved joints a perfect mirror coat and the sub-pixel pinpoint the bible's
        0.10 floor exists to prevent. A test whose only failure mode is
        unreachable is worse than no test.
      */
      if (!coat) return
      expect(preset.clearcoatRoughness, `${name} sets clearcoat ${coat}`).toBeTypeOf('number')
      expect(preset.clearcoatRoughness as number).toBeGreaterThan(0)
    })

    it(`${name}: resolves as two lobes${exemptFromTwoLobe[name] ? ' (exempt)' : ''}`, () => {
      if (!coat) return // no coat, no second lobe to separate
      if (exemptFromTwoLobe[name]) {
        expect(exemptFromTwoLobe[name].length).toBeGreaterThan(0)
        return
      }
      expect(lobeRatio(base, coatRoughness)).toBeGreaterThanOrEqual(TWO_LOBE_MIN_RATIO)
    })
  }

  it('pins the two presets the critique named', () => {
    // plastic() was 0.35 / 0.25, a ratio of 1.96 where 8 is needed, and is what
    // the character's dome and most of the world is made of.
    expect(lobeRatio(0.35, 0.25)).toBeCloseTo(1.96, 2)
    expect(lobeRatio(plastic('#fff').roughness as number, plastic('#fff').clearcoatRoughness as number))
      .toBeCloseTo(9.0, 2)
    expect(lobeRatio(0.75, 0.6)).toBeCloseTo(1.5625, 4)
    expect(
      lobeRatio(
        mattePlastic('#fff').roughness as number,
        mattePlastic('#fff').clearcoatRoughness as number,
      ),
    ).toBeGreaterThanOrEqual(TWO_LOBE_MIN_RATIO)
  })

  it('treats a mirror coat as infinitely separated rather than dividing by zero', () => {
    expect(lobeRatio(0.4, 0)).toBe(Infinity)
  })
})

describe('linearToSrgb, the display space the band rule is measured in', () => {
  it('round trips against srgbToLinear', () => {
    /*
      The band system has been doing this conversion by hand in comments for three
      rounds, in both directions, and the art bible warns in as many words that
      checking a display number against a linear one "produces confident nonsense
      in both directions". A round trip over every byte is the cheapest possible
      guard against a transposed constant.
    */
    for (let i = 0; i <= 255; i++) {
      const display = i / 255
      expect(linearToSrgb(srgbToLinear(display))).toBeCloseTo(display, 10)
    }
  })

  it('pins the ends and the knee', () => {
    expect(linearToSrgb(0)).toBe(0)
    expect(linearToSrgb(1)).toBeCloseTo(1, 12)
    // Below 0.0031308 the encode is the straight 12.92 segment, which is the
    // mirror of the decode's knee and the only part easy to get wrong.
    expect(linearToSrgb(0.003)).toBeCloseTo(0.003 * 12.92, 12)
  })

  it('brightens the midpoint, which is why a linear 0.2140 reads as 0.5', () => {
    expect(linearToSrgb(0.2140)).toBeCloseTo(0.5, 3)
  })
})

describe('anodised', () => {
  it('matches the materials spec table exactly', () => {
    // docs/design/02-materials.md section 1.2: 0.30 / metal 0.95 / cc 0.15 /
    // ccR 0.10 / envMapIntensity 1.00. The preset was specified and never built.
    const preset = anodised('#ffffff')
    expect(preset.roughness).toBe(0.3)
    expect(preset.metalness).toBe(0.95)
    expect(preset.clearcoat).toBe(0.15)
    expect(preset.clearcoatRoughness).toBe(0.1)
    expect(preset.envMapIntensity).toBe(1)
    expect(lobeRatio(0.3, 0.1)).toBeCloseTo(9, 6)
  })

  it('separates its lobes where metal() only just does', () => {
    /*
      The reason for the rename in the spec. metal()'s coat now declares a 0.10
      roughness rather than inheriting three's mirror default, which puts it at a
      ratio of 16 - so it passes the rule, but on a 0.4 body where the spec wants
      0.30, because anodising is an oxide film usually lacquered over and the read
      is a thin hard skin over a SATIN body rather than over a brushed one.
    */
    expect(lobeRatio(anodised('#fff').roughness as number, anodised('#fff').clearcoatRoughness as number))
      .toBeCloseTo(9, 6)
    expect(anodised('#fff').roughness as number).toBeLessThan(metal('#fff').roughness as number)
    expect(anodised('#fff').metalness as number).toBeGreaterThan(metal('#fff').metalness as number)
  })

  it('leaves metal()\'s body alone, because its call sites belong to other streams', () => {
    // The spec asks for metal() to become a deprecated alias. Four call sites in
    // Portal.tsx and robotParts.tsx would change look, so the rename is a
    // cross-stream refactor rather than part of this change. The only thing that
    // moved is the missing coat roughness, which removes a firefly and cannot
    // make anything brighter.
    expect(metal('#fff').roughness).toBe(0.4)
    expect(metal('#fff').metalness).toBe(0.9)
    expect(metal('#fff').clearcoatRoughness).toBe(0.1)
  })

  it('ships anisotropy off, because no tier enables it', () => {
    /*
      section 10 gates anisotropy to high and quality.anisotropy is false at every
      tier today. It also has to be passed at CONSTRUCTION rather than assigned:
      three bumps the material version when anisotropy crosses zero and that
      forces a shader recompile, which as a response to a quality-selector click
      is a visible freeze at the worst possible moment.
    */
    expect(anodised('#fff').anisotropy).toBeUndefined()
    expect(anodised('#fff', { anisotropy: ANODISED_ANISOTROPY }).anisotropy).toBe(0.45)
  })

  it('stays inside the specular budget on the hub rig', () => {
    /*
      The brightest Lightformer in the hub is the highlight strip at 1.5543 and
      HUB_ENV.intensity scales the whole map by 0.7, so the radiance this material
      can see is 1.5543 * 0.7 * envMapIntensity. Against the bible's 1.60 budget
      and the measured 1.45 bloom threshold, 1.088 clears both - so an anodised
      surface cannot bloom off the environment, only off a punctual highlight,
      which the bible permits by name.
    */
    const radiance = 1.5543 * 0.7 * (anodised('#fff').envMapIntensity as number)
    expect(radiance).toBeCloseTo(1.088, 3)
    expect(radiance).toBeLessThan(BLOOM_THRESHOLD)
    expect(radiance).toBeLessThanOrEqual(1.6)
  })
})

describe('the coat roughness map, and why the deck ladder read as nothing', () => {
  /*
    The brief for this pass asked this stream to attack its own central claim: if
    printed value is the whole fix because relief cannot read, is that actually
    true, or does the deck simply have no specular to modulate?

    It has one, and the roughness map could never reach it. `mattePlastic` is
    roughness 0.75 with a coat at clearcoatRoughness 0.26, and in three
    `roughnessMap` multiplies `roughness` alone - `clearcoatRoughness` has its own
    slot. So the ORM ladder was breaking up a lobe at roughness 0.75, which is
    near-Lambertian, while the only lobe narrow enough to make a highlight stayed
    uniform across all 113 square metres of deck. That is a second, sufficient
    explanation for the 0.0003 null result, independent of the `N.L` argument the
    file records, and it points at a fix the file had not considered.
  */
  const DECK = mattePlastic('#ffffff')

  it('shows the base lobe the ladder modulated is too broad to make a highlight', () => {
    // GGX lobe width goes as roughness squared, so the ratio between what the map
    // could reach and what it could not is the square of the roughness ratio.
    const base = DECK.roughness as number
    const coat = DECK.clearcoatRoughness as number
    expect(base).toBe(0.75)
    expect(coat).toBe(0.26)
    expect((base * base) / (coat * coat)).toBeGreaterThan(TWO_LOBE_MIN_RATIO)
  })

  it('keeps the two-lobe rule at the smoothest texel the deck ORM can write', () => {
    /*
      The guard on the proposed experiment. The map multiplies, and the deck's
      green channel bottoms out at `roughnessByte(0.72 - 0.14, 0.72)` - so the
      coat would reach 0.26 * that fraction. Smoother is a TIGHTER highlight, which
      is the direction that threatens both the two-lobe rule and bloom, so the
      floor is what has to be checked.
    */
    const floorByte = roughnessByte(0.72 - DECAL_KINDS.deck.swing, 0.72)
    const ratio = coatLobeRatioUnderMap(0.75, 0.26, floorByte)
    expect(floorByte).toBeLessThan(ROUGHNESS_MID_BYTE)
    expect(ratio).toBeGreaterThanOrEqual(TWO_LOBE_MIN_RATIO)
    // And it stays under the clearcoat ceiling question entirely, because this
    // changes the coat's ROUGHNESS and never its weight.
    expect(DECK.clearcoat as number).toBeLessThanOrEqual(MAX_CLEARCOAT)
  })

  it('refuses to pretend a mirror coat is safe', () => {
    // The failure this guard exists for: a map that reaches byte 0 would take
    // clearcoatRoughness to zero, which is the sub-pixel firefly the bible's
    // section 8.4 floor exists to prevent. Infinity is not a pass.
    expect(coatLobeRatioUnderMap(0.75, 0.26, 0)).toBe(Infinity)
    expect(coatLobeRatioUnderMap(0.75, 0.26, 255)).toBeCloseTo(lobeRatio(0.75, 0.26), 6)
  })
})
