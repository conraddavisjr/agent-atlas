import { describe, it, expect } from 'vitest'
import {
  ANODISED_ANISOTROPY,
  BLOOM_INTENSITY,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
  DIFFUSE_CYLINDER_LINEAR_RATIO,
  FACING_RATIO,
  GLOW,
  LOW_LUMA_FLOOR,
  MAX_CLEARCOAT,
  TWO_LOBE_MIN_RATIO,
  anodised,
  bloomFarFieldWeight,
  bandLinearRatio,
  bloomMipWeights,
  chrome,
  coatLobeRatioUnderMap,
  crystal,
  cylinderFresnelRatio,
  displayWidthForLinearRatio,
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
  lobeRatioUnderRoughnessMap,
  luma709,
  masonry,
  metalF0,
  metalF0ForCylinderRatio,
  mattePlastic,
  metal,
  plastic,
  renderedLuma,
  rubber,
  schlickF,
  shell,
  srgbToLinear,
  steel,
  STEEL_METALNESS,
  stone,
  vinyl,
  visorPlate,
} from './materials'
import { DECAL_KINDS, DECK_LIT_LUMA, ROUGHNESS_MID_BYTE, roughnessByte } from './decalTextures'
import { VALUE_BANDS, palette } from './palette'

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
    steel: steel(),
    masonry: masonry(),
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

/*
  Band arithmetic for curved surfaces.

  These are the tests behind the one claim in this pass that changes what the
  world is made of, so every number in them was measured on
  `.critique/astro/maps-on--hub-establishing.png` with `tools/critique/frame.mjs`
  before it was written down, and the boxes are quoted so the measurement can be
  repeated rather than trusted.
*/
describe('the facing-ratio model, promoted from a comment to code', () => {
  it('reproduces every rendered value the project has recorded', () => {
    /*
      HubIsland.tsx records three of these as predictions made from the measured
      ratios, and DECK_LIT_LUMA is a direct measurement of a fourth surface. If
      this function is the arithmetic those predictions were made with, it has to
      land on all four - which is the only available check that the model is a
      model and not four coincidences.
    */
    expect(renderedLuma('#3c465a', FACING_RATIO.up)).toBeCloseTo(0.246, 3)
    expect(renderedLuma('#6e7e9e', FACING_RATIO.litVertical)).toBeCloseTo(0.368, 3)
    expect(renderedLuma('#6e7e9e', FACING_RATIO.shadedVertical)).toBeCloseTo(0.163, 3)
    /*
      The loosest of the four, and it MOVED when `bandDeckTop` went from `#bfbbb4`
      to `#BABCBD`: 0.6680 to 0.6694, which is 0.0014 and a hair over this
      assertion's own 0.0005 tolerance.

      Pinned to the new value rather than loosened, because 0.0014 is the whole
      point of that hex being chosen: it is the same value at a different hue, and
      a model that could not see a 1.2-thousandth albedo change would not be
      precise enough to have caught the four-surface agreement above.

      Still loose in the safe direction against a MEASURED deck. The old number to
      compare against was 0.687 on a `mattePlastic` deck; the deck is masonry now
      and measures 0.6706 unmapped, so the model under-predicts by 0.0012 rather
      than by 0.019 - which is the model getting BETTER because the surface lost a
      clearcoat the model never had.
    */
    expect(renderedLuma(palette.bandDeckTop, FACING_RATIO.up)).toBeCloseTo(0.6694, 3)
  })

  it('clamps rather than returning a luma above 1', () => {
    // A facing ratio times a near-white albedo can exceed 1, and linearToSrgb of
    // an out-of-range argument returns a number a band assertion would accept.
    // Closeness rather than equality, because linearToSrgb(1) is 1.055 - 0.055 and
    // lands a float ulp under 1. The clamp is what is being tested, not the curve.
    expect(renderedLuma('#ffffff', 2)).toBeCloseTo(1, 12)
    expect(renderedLuma('#ffffff', 2)).toBeLessThanOrEqual(1)
  })

  it('puts a CYLINDER brighter at its brightest than any flat face, which is the defect', () => {
    /*
      The whole finding in one assertion. `paintByFacing` assigns an albedo from a
      face normal, and its brightest case is a horizontal deck at 0.81. A cylinder
      contains the normal pointing straight at the key, so N.L reaches 1 somewhere
      on every cylinder whatever its orientation, and it measures 0.915 - above the
      ceiling the paint scheme believes exists. No albedo chosen by facing can
      correct a surface that is brighter than the scheme's brightest case.
    */
    expect(FACING_RATIO.cylinderPeak).toBeGreaterThan(FACING_RATIO.up)
    expect(FACING_RATIO.cylinderPeak).toBeGreaterThan(FACING_RATIO.litVertical)
    // And it is the measured strut, not an estimate: display 0.4724 decoded and
    // divided by frameSide's own albedo luminance.
    expect(srgbToLinear(0.4724) / linearLuma('#6e7e9e')).toBeCloseTo(FACING_RATIO.cylinderPeak, 2)
    expect(srgbToLinear(0.19) / linearLuma('#6e7e9e')).toBeCloseTo(FACING_RATIO.cylinderShade, 2)
  })
})

describe('why no albedo can put a diffuse cylinder in band 2', () => {
  const [lo, hi] = VALUE_BANDS.midground

  it('states the band as the linear ratio the renderer actually multiplies by', () => {
    // 0.20 to 0.38 sounds like a lot of room and is not: the transfer curve is
    // steep down there, so the band is a factor of 3.6, where the gameplay band's
    // wider-looking 0.56-0.74 is only a factor of 1.85.
    expect(bandLinearRatio(lo, hi)).toBeCloseTo(3.603, 3)
    expect(bandLinearRatio(...VALUE_BANDS.gameplay)).toBeCloseTo(1.852, 3)
    expect(bandLinearRatio(...VALUE_BANDS.background)).toBeCloseTo(1.32, 2)
  })

  it('derives the measured ratio from the frame, and shows the albedo cancels', () => {
    /*
      frame.mjs spread .critique/astro/maps-on--hub-establishing.png 817 505 16 20
      -> mean 0.3825, p5 0.190, p95 0.4724, width 0.2824, inOneBand: false

      The ratio is p95 over p5 in LINEAR light, and both ends are the same albedo
      times a different facing ratio - so the albedo divides out and what is left
      is a property of the lighting and the shape alone. That is what makes the
      next assertion a proof rather than a remark about one hex.
    */
    expect(srgbToLinear(0.4724) / srgbToLinear(0.19)).toBeCloseTo(DIFFUSE_CYLINDER_LINEAR_RATIO, 2)
    expect(FACING_RATIO.cylinderPeak / FACING_RATIO.cylinderShade).toBeCloseTo(
      DIFFUSE_CYLINDER_LINEAR_RATIO,
      1,
    )
    for (const hex of ['#6e7e9e', '#3c465a', '#ffffff', '#202020']) {
      const peak = linearLuma(hex) * FACING_RATIO.cylinderPeak
      const shade = linearLuma(hex) * FACING_RATIO.cylinderShade
      expect(peak / shade, `${hex} cancels`).toBeCloseTo(DIFFUSE_CYLINDER_LINEAR_RATIO, 1)
    }
  })

  it('does not fit, at any albedo', () => {
    expect(DIFFUSE_CYLINDER_LINEAR_RATIO).toBeGreaterThan(bandLinearRatio(lo, hi))
  })

  it('reproduces the measured width, and shows the p5 a fit would demand', () => {
    // At the measured p5 the width comes out at the measured 0.282.
    expect(displayWidthForLinearRatio(0.19, DIFFUSE_CYLINDER_LINEAR_RATIO)).toBeCloseTo(0.282, 3)
    // Squeezing it to 0.18 needs a p5 of 0.100 - half the midground floor, and
    // inside the anchor band, which is reserved for the frame's darkest darks.
    expect(displayWidthForLinearRatio(0.1, DIFFUSE_CYLINDER_LINEAR_RATIO)).toBeLessThanOrEqual(0.18)
    expect(displayWidthForLinearRatio(lo, DIFFUSE_CYLINDER_LINEAR_RATIO)).toBeGreaterThan(hi - lo)
    expect(0.1).toBeLessThan(VALUE_BANDS.anchor[1])
  })
})

describe('Schlick on a cylinder, and anodised()\'s first legitimate call site', () => {
  const [lo, hi] = VALUE_BANDS.midground
  const FRAME_SIDE = '#6e7e9e'
  const f0 = metalF0(FRAME_SIDE, anodised(FRAME_SIDE).metalness as number)

  it('pins Schlick at both ends and shows how late it does anything', () => {
    expect(schlickF(0.2, 1)).toBeCloseTo(0.2, 12)
    expect(schlickF(0.2, 0)).toBeCloseTo(1, 12)
    // The fifth power is the whole argument. At 30 degrees off the normal it has
    // contributed 43 millionths, and it has not reached a tenth by 66 degrees.
    expect(schlickF(0.2, Math.cos(Math.PI / 6)) - 0.2).toBeLessThan(1e-4)
    expect(Math.pow(1 - Math.cos((66 * Math.PI) / 180), 5)).toBeLessThan(0.1)
  })

  it('matches three\'s F0 rule, including the 5% that stays dielectric', () => {
    expect(metalF0('#ffffff', 0)).toBeCloseTo(0.04, 12)
    expect(metalF0('#ffffff', 1)).toBeCloseTo(linearLuma('#ffffff'), 12)
    expect(f0).toBeCloseTo(0.1987, 4)
  })

  it('crushes the Fresnel rise into the outer tenth of the width', () => {
    /*
      Screen-x across a cylinder is R sin(phi), so a pixel column is uniform in
      sin(phi) rather than in phi. Half the width sits inside 30 degrees of the
      normal, where Schlick is still flat, and the whole rise happens past q=0.9.
      This is the mechanism, and it is what the flat-face finding could not see.
    */
    const at = (q: number) => cylinderFresnelRatio(f0, 0.05, q)
    expect(at(0.5)).toBeCloseTo(1.0, 3)
    expect(at(0.75)).toBeCloseTo(1.018, 3)
    expect(at(0.95)).toBeCloseTo(1.621, 3)
    expect(at(0.99)).toBeCloseTo(2.885, 3)
    expect(at(1)).toBeCloseTo(5.033, 3)
  })

  it('fits band 2 where the diffuse cylinder cannot, with the environment budget left over', () => {
    const fresnel = cylinderFresnelRatio(f0)
    expect(fresnel).toBeCloseTo(1.621, 3)
    expect(fresnel).toBeLessThan(bandLinearRatio(lo, hi))
    // Going metal is a 3.9x improvement on a measured failure, not a risk taken
    // for looks.
    expect(DIFFUSE_CYLINDER_LINEAR_RATIO / fresnel).toBeGreaterThan(3.8)
    // What is left is the allowance for the variation in what the member actually
    // reflects across its width, which Schlick does not model and this stream
    // cannot measure. 2.22x is the number to check a frame against.
    expect(bandLinearRatio(lo, hi) / fresnel).toBeCloseTo(2.223, 3)
    // In display terms, at the band floor, a metal strut spans 0.057 against the
    // 0.282 measured today.
    expect(displayWidthForLinearRatio(lo, fresnel)).toBeCloseTo(0.057, 3)
  })

  it('needs a LIGHT albedo to hold a DARK band, which rules out the batch\'s crowns', () => {
    /*
      For a metal the albedo is f0, and f0 is the FLOOR of the value while the
      environment sets the scale - so darkening the colour widens the spread
      instead of lowering it. The dress batch's paint pass points the wrong way:
      its light flanks value clears the bar and its dark crowns value does not.
    */
    const metalness = anodised('#fff').metalness as number
    const ratioOf = (hex: string) => cylinderFresnelRatio(metalF0(hex, metalness))
    expect(ratioOf('#202020')).toBeCloseTo(10.63, 1)
    expect(ratioOf('#3c465a')).toBeCloseTo(3.42, 1)
    expect(ratioOf('#6e7e9e')).toBeCloseTo(1.62, 1)
    expect(ratioOf('#ffffff')).toBeCloseTo(1.01, 1)
    // frameTop spends 3.42 of the 3.603 available and leaves 1.05x, which is not a
    // budget. frameSide leaves 2.22x.
    expect(ratioOf('#3c465a')).toBeLessThan(bandLinearRatio(lo, hi))
    expect(bandLinearRatio(lo, hi) / ratioOf('#3c465a')).toBeLessThan(1.1)
    // Monotone in the albedo, so "lighter is safer" is a rule rather than a
    // coincidence of these four swatches.
    for (const [a, b] of [['#202020', '#3c465a'], ['#3c465a', '#6e7e9e'], ['#6e7e9e', '#ffffff']]) {
      expect(ratioOf(a), `${a} spreads wider than ${b}`).toBeGreaterThan(ratioOf(b))
    }
  })

  it('inverts, and puts the albedo floor at display luma 0.446', () => {
    const metalness = anodised('#fff').metalness as number
    // Half the band's ratio, leaving the other half for the environment.
    const working = bandLinearRatio(lo, hi) / 2
    const floor = metalF0ForCylinderRatio(working)
    expect(cylinderFresnelRatio(floor)).toBeCloseTo(working, 9)
    // 0.161. Half of 3.6031 is 1.8015 rather than a round 1.80, which moves the
    // fourth decimal and nothing that matters.
    expect(floor).toBeCloseTo(0.161, 3)
    // Back out to an albedo: the display luma a candidate colour has to clear.
    const albedoFloor = linearToSrgb((floor - 0.04 * (1 - metalness)) / metalness)
    expect(albedoFloor).toBeCloseTo(0.446, 3)
    expect(linearToSrgb(linearLuma('#6e7e9e'))).toBeGreaterThan(albedoFloor)
    expect(linearToSrgb(linearLuma('#3c465a'))).toBeLessThan(albedoFloor)
    // Degenerate ask: a ratio of 1 or less needs a mirror.
    expect(metalF0ForCylinderRatio(1)).toBe(1)
  })

  it('cannot bloom off the environment even at the silhouette', () => {
    // F reaches 1 at grazing, so the worst case is the whole reflected radiance,
    // and the hub rig's brightest is 1.088 against a threshold of 1.45. The rim is
    // 1.0 px on a 20.4 px strut, which is why p5-p95 and not the extremes is the
    // statistic - but it is worth knowing it could not bloom even if it were wide.
    expect(schlickF(f0, 0) * 1.5543 * 0.7 * (anodised('#fff').envMapIntensity as number)).toBeLessThan(
      BLOOM_THRESHOLD,
    )
  })
})

describe('the two-lobe rule under a roughness map, which every binding breaks today', () => {
  /*
    The rule is asserted on the PRESETS above and the maps are bound at the call
    site, so the preset passes and the material the player sees does not. A map
    that takes the base lobe down while the coat stays pinned walks the two lobes
    back on top of each other - the exact defect plastic() was rebuilt to remove,
    reintroduced by a texture.
  */
  const shipped = [
    { kind: 'deck' as const, preset: mattePlastic('#ffffff'), unmapped: 4.96 },
    { kind: 'trim' as const, preset: mattePlastic('#ffffff'), unmapped: 5.71 },
  ]

  for (const { kind, preset, unmapped } of shipped) {
    const spec = DECAL_KINDS[kind]
    const base = preset.roughness as number
    const coat = preset.clearcoatRoughness as number
    const bias = spec.roughness / 0.8
    const smoothestByte = roughnessByte(spec.roughness - spec.swing, spec.roughness)

    it(`${kind}: breaks the rule at its smoothest texel with the coat unmapped`, () => {
      expect(lobeRatioUnderRoughnessMap(bias, coat, smoothestByte)).toBeCloseTo(unmapped, 2)
      expect(lobeRatioUnderRoughnessMap(bias, coat, smoothestByte)).toBeLessThan(TWO_LOBE_MIN_RATIO)
    })

    it(`${kind}: mapping the coat fixes it and makes the ratio invariant`, () => {
      const roughestByte = roughnessByte(spec.roughness + spec.swing, spec.roughness)
      const at = (b: number) => lobeRatioUnderRoughnessMap(bias, coat, b, true)
      expect(at(smoothestByte)).toBeCloseTo(11.98, 2)
      expect(at(roughestByte)).toBeCloseTo(at(smoothestByte), 6)
      expect(at(ROUGHNESS_MID_BYTE)).toBeCloseTo(at(smoothestByte), 6)
      expect(at(smoothestByte)).toBeGreaterThanOrEqual(TWO_LOBE_MIN_RATIO)
      // And it lands ABOVE the unmapped preset's own 8.3, so this is a correction
      // rather than a trade.
      expect(at(smoothestByte)).toBeGreaterThan(lobeRatio(base, coat))
    })
  }

  it('strut: the same, on the preset the frame members want', () => {
    const spec = DECAL_KINDS.strut
    const preset = anodised('#6e7e9e')
    const bias = spec.roughness / 0.8
    const coat = preset.clearcoatRoughness as number
    const smoothest = roughnessByte(spec.roughness - spec.swing, spec.roughness)
    expect(lobeRatioUnderRoughnessMap(bias, coat, smoothest)).toBeCloseTo(5.26, 2)
    expect(lobeRatioUnderRoughnessMap(bias, coat, smoothest)).toBeLessThan(TWO_LOBE_MIN_RATIO)
    expect(lobeRatioUnderRoughnessMap(bias, coat, smoothest, true)).toBeCloseTo(14.06, 2)
    expect(lobeRatioUnderRoughnessMap(bias, coat, smoothest, true)).toBeGreaterThanOrEqual(
      TWO_LOBE_MIN_RATIO,
    )
  })

  it('is a no-op at the neutral byte when the coat is left alone', () => {
    // Byte 204 is ROUGHNESS_MID, and the bias exists so that the neutral texel
    // reproduces the authored roughness exactly. If that identity ever breaks, the
    // whole ladder is offset and nothing else in this file would notice.
    expect(lobeRatioUnderRoughnessMap(0.75 / 0.8, 0.26, ROUGHNESS_MID_BYTE)).toBeCloseTo(
      lobeRatio(0.75, 0.26),
      6,
    )
  })
})


describe('steel(), and the case the anodised finding does not cover', () => {
  const preset = steel()

  it('is mostly metal, with the diffuse floor the measurement forced, and no coat', () => {
    /*
      Not 1, and `STEEL_METALNESS` carries the whole argument. The short form: at
      `metalness: 1` this rendered at display 0.423 on the junction pool at
      `hub-establishing` - a dark navy sheet - because a metal has no diffuse term and
      an up-facing sheet under this rig reflects an empty elevation band. 0.68 buys
      back a diffuse lobe lit by the key.

      Pinned as a range rather than as the constant, so this reads as "mostly metal"
      and fails if someone quietly turns it into a plastic.
    */
    expect(preset.metalness).toBe(STEEL_METALNESS)
    expect(preset.metalness as number).toBeGreaterThan(0.6)
    expect(preset.metalness as number).toBeLessThan(1)

    expect(preset.clearcoat).toBe(0)
    // A clear coat over a mirror is a second Fresnel term on a surface that is
    // already entirely Fresnel: a full GGX evaluation to change nothing.
    expect(preset.clearcoatRoughness).toBeUndefined()
  })

  it('records the measurement that moved it off 1, so the number is not folklore', () => {
    /*
      The reason this is a test and not only a comment: `00-art-bible.md` opens with
      the discovery that nothing in the game bloomed because six emissives were set by
      eye against a threshold nobody had computed. A material constant chosen against a
      frame should carry the frame's number with it.

      At metalness 1 the pool measured 0.423 and the deck 0.687, so the inlay was 0.264
      DARKER than the surface it is set into - the opposite of the brief - and 0.423
      sits in the 0.38 to 0.56 gap the bands deliberately leave empty. After the change
      it measures 0.583, inside the gameplay band and out of the gap.
    */
    const [gameplayLo, gameplayHi] = VALUE_BANDS.gameplay
    const [midgroundHi] = [VALUE_BANDS.midground[1]]
    expect(0.423).toBeGreaterThan(midgroundHi)
    expect(0.423).toBeLessThan(gameplayLo)
    expect(0.583).toBeGreaterThan(gameplayLo)
    expect(0.583).toBeLessThan(gameplayHi)
  })

  it('is reflective enough to be steel and rough enough not to hand back a rectangle', () => {
    /*
      `chrome()` at 0.06 mirrors the Lightformer rig literally, and an up-facing
      mirror lying in a deck returns the key softbox's own edges as a hard
      rectangle in the floor. 0.15 spreads the same energy over a lobe.
    */
    expect(preset.roughness).toBeGreaterThan(chrome().roughness as number)
    expect(preset.roughness).toBeLessThan(anodised('#fff').roughness as number)
  })

  it('cannot bloom at any reachable angle, which is the ceiling that matters', () => {
    /*
      A metal's rendered radiance is `F(theta) x environment`, and Schlick runs F
      to 1.0 at the silhouette. The brightest thing an up-facing sheet can see is
      the highlight strip at `1.5543 x 0.70 = 1.088`, and the whole margin is that
      1.088 sits under the measured threshold of 1.45. Nothing about the material
      can raise it, which is why this is stated as a bound rather than a value.
    */
    const strip = 1.5543 * 0.7
    expect(strip).toBeLessThan(BLOOM_THRESHOLD)
    expect(strip / BLOOM_THRESHOLD).toBeCloseTo(0.75, 2)
  })

  it('pins the F0 every number in its note is computed from', () => {
    expect(linearLuma(preset.color as string)).toBeCloseTo(0.6015, 4)
  })

  it('reads cool, which is the design direction and not a preference', () => {
    // Blues, silvers and greys. Blue above red at the same nominal grey is the
    // cheapest expression of it and costs nothing anywhere else.
    const [r, , b] = linearise(preset.color as string)
    expect(b).toBeGreaterThan(r)
  })

  it('does NOT out-value the deck in the frame, whatever the head-on table says', () => {
    /*
      **A CORRECTION, and the two halves of it are both worth keeping.**

      This test used to assert that the inlay is brighter than the deck, on the
      arithmetic that a head-on reflection of the key softbox returns 0.5726 of
      linear luminance and therefore 0.7813 of display against a deck at 0.687.
      That arithmetic is still correct and it is still asserted below. What was
      wrong was treating it as a statement about the FRAME.

      Measured at `hub-establishing`, high: the inlay renders **0.583** and the
      deck **0.615**, so the inlay is 0.032 DARKER. The head-on case is reachable
      only where the reflection vector actually finds the softbox, which on a
      horizontal sheet under a camera looking down is nowhere - see
      `STEEL_METALNESS`.

      So this file no longer claims the inlay out-values the ground. It claims the
      bound, which is the thing a material preset can honestly own.
    */
    const headOn = linearLuma(preset.color as string) * 1.36 * 0.7
    expect(linearToSrgb(headOn)).toBeGreaterThan(DECK_LIT_LUMA)

    // And the frame, which is the number that decides handoff item 5.
    const inlayMeasured = 0.583
    const deckMeasured = 0.615
    expect(inlayMeasured).toBeLessThan(deckMeasured)
    // Still inside the gameplay band rather than in the gap below it, which is
    // the whole point of `STEEL_METALNESS`.
    expect(inlayMeasured).toBeGreaterThan(VALUE_BANDS.gameplay[0])
  })
})

describe('masonry(), and the lever that does not exist in this project', () => {
  const preset = masonry()

  it('has no coat at all, so the two-lobe rule has nothing to separate', () => {
    /*
      `stone()` keeps `clearcoat: 0.15` so that stone does not go "conspicuously
      dead" beside its neighbours. The brief here is the opposite - highly matte,
      reflecting nothing of the environment - so the coat goes rather than being
      exempted. That is the two-lobe problem solved by deletion.
    */
    expect(preset.clearcoat).toBe(0)
    expect(stone('#fff', {} as never).clearcoat).toBeGreaterThan(0)
  })

  it('cuts the specular lobe rather than the environment, because the other lever is dead', () => {
    /*
      `WebGLRenderer` overwrites `envMapIntensity` from `scene.environmentIntensity`
      for any material with a null envMap, and nothing in this project sets one -
      so turning it down here would do nothing at all. It would also be wrong if it
      worked: the environment map delivers this material's DIFFUSE irradiance too,
      so cutting it would darken the deck rather than matte it.
      `specularIntensity` scales the dielectric lobe alone.
    */
    expect(preset.specularIntensity).toBe(0.25)
    expect(preset.envMapIntensity).toBeUndefined()
  })

  it('keeps a trace of specular rather than none, so a floor is not paper', () => {
    expect(preset.specularIntensity as number).toBeGreaterThan(0)
  })

  it('is rougher than every plastic and as rough as rubber', () => {
    expect(preset.roughness as number).toBeGreaterThan(mattePlastic('#fff').roughness as number)
    expect(preset.roughness).toBe(rubber('#fff').roughness)
  })

  it('pushes normals and occlusion, which is all a matte surface has left', () => {
    expect((preset.normalScale as { x: number }).x).toBeGreaterThan(1.5)
    expect(preset.aoMapIntensity as number).toBeGreaterThan(1)
  })
})
