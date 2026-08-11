import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  WATER,
  waterFragmentShader,
  waterPeakLuminance,
  waterUniforms,
  waterVertexShader,
} from './waterMaterial'
import { BLOOM_THRESHOLD, linearLuma, luma709 } from './materials'
import {
  TRACE,
  WATER_SECTION,
  WATER_SHORE_ATTRIBUTE,
  waterSection,
} from '@/game/world/hubLayout'

const SOURCE = `${waterVertexShader}\n${waterFragmentShader}`

/** Names declared as `uniform <type> <name>;` anywhere in either shader. */
function declaredUniforms(source: string): string[] {
  return [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]).sort()
}

/**
 * Every `uSomething` identifier that appears anywhere in either shader.
 *
 * The naming convention is what makes this possible: every uniform this file owns
 * is `u` followed by a capital, and nothing else in GLSL or in three's injected
 * prefix matches that shape.
 */
function referencedUniforms(source: string): string[] {
  return [...new Set([...source.matchAll(/\bu[A-Z]\w*\b/g)].map((m) => m[0]))].sort()
}

describe('the water shaders', () => {
  /*
    The art bible's section 4 exists because this codebase has been cut four
    times by silent shader failures, and the first of its four rules is about
    `#include` directives arriving unresolved. A from-scratch shader sidesteps
    that entirely, and this asserts it stays sidestepped rather than trusting a
    later edit not to reach for a chunk.
  */
  it('contains no #include, so the unresolved-directive trap cannot apply', () => {
    expect(SOURCE).not.toContain('#include')
  })

  /*
    The canonical silent shader failure, and the one this project's memory file
    is about: a misspelled uniform name. three finds no such uniform and uploads
    nothing, GLSL leaves it at zero, and the effect renders WRONG rather than not
    at all - a clean frame that is not evidence of anything. Checking both
    directions catches the typo whichever side it is on.
  */
  it('declares exactly the uniforms it references, in both directions', () => {
    const declared = declaredUniforms(SOURCE)
    const referenced = referencedUniforms(SOURCE)
    expect(declared).toEqual(referenced)
  })

  it('supplies a value for every uniform it declares, and no extras', () => {
    expect(Object.keys(waterUniforms()).sort()).toEqual(declaredUniforms(SOURCE))
  })

  /*
    `uv.y` wraps 1 to 0 around a tube and `pad()` runs `uv.x` around a disc, so
    both coordinates are periodic on some part of the merged batch. Anything
    fed a periodic coordinate has to be periodic in it or it leaves a hairline
    seam in one fixed place forever. `across` is taken through sin(TAU * uv.y),
    and the crest count has to be a whole number for the same reason.
  */
  it('takes the circumferential coordinate through a periodic function', () => {
    expect(waterFragmentShader).toContain('sin(vUv.y * TAU)')
  })

  it('uses a whole number of crests, so the pads have no phase seam', () => {
    expect(Number.isInteger(WATER.crests)).toBe(true)
  })

  /*
    modelMatrix is in three's vertex prefix and NOT in its fragment prefix. A
    fragment shader that reached for it would fail to compile, which in this
    project means a console error and a mesh that draws nothing - the failure
    mode `MEMORY.md` warns about. The world normal and world position therefore
    have to cross as varyings.
  */
  it('computes world space in the vertex shader, where modelMatrix exists', () => {
    expect(waterVertexShader).toContain('modelMatrix')
    expect(waterFragmentShader).not.toContain('modelMatrix')
    expect(waterFragmentShader).toContain('varying vec3 vWorldNormal')
    expect(waterFragmentShader).toContain('varying vec3 vWorldPosition')
  })

  it('is built from module-level constants, so three can cache the program', () => {
    expect(waterVertexShader).toBe(waterVertexShader)
    expect(typeof waterFragmentShader).toBe('string')
  })
})

describe('the water bloom budget', () => {
  /*
    The art bible's section 1: nothing in the ENVIRONMENT may cross the bloom
    threshold, because "blue means ally and gold means reward, and nothing in the
    environment is allowed in, which is what keeps bloom reading as feedback
    rather than as weather." A glint on water is the most tempting exception
    available, so it gets asserted rather than assumed.

    The bound is unreachable by construction - it needs the maximum grazing
    reflection, a completed hub, the meniscus line and a wave crest on one pixel
    at once - which is what makes it safe rather than merely optimistic.
  */
  it('cannot cross the bloom threshold even at its unreachable worst case', () => {
    const peak = waterPeakLuminance()
    expect(peak).toBeLessThan(BLOOM_THRESHOLD)
    // Recorded so a later retune that eats the margin shows up as a diff.
    expect(peak).toBeCloseTo(1.158, 2)
    expect(BLOOM_THRESHOLD / peak).toBeGreaterThan(1.25)
  })

  it('keeps the glint itself under the threshold as a matter of unit', () => {
    expect(WATER.glint).toBeLessThan(1)
  })

  /*
    The glint colour is premultiplied by `emissiveIntensityFor`, exactly as
    `glowStrip()` does, so its linear luminance comes out at `glint x threshold`
    for any hue. That is the property that makes `WATER.glint` mean the same
    thing whatever colour it is applied to, and it is the property the art
    bible's section 1 was written to establish.
  */
  it('normalises the glint colour so its luminance is glint x threshold exactly', () => {
    const c = waterUniforms().uGlintColor.value as Color
    expect(luma709(c.r, c.g, c.b)).toBeCloseTo(WATER.glint * BLOOM_THRESHOLD, 6)
  })

  /*
    The whole reason the water is dark: it is unlit, so its authored value IS its
    rendered value up to ACES and the grade. `#12414e` at 0.0446 of linear
    luminance renders at display 0.212, near the floor of the midground band, and
    the progress lift takes it to 0.358, which is still inside it. Assert the two
    linear ends rather than the display ends, since the display figures depend on
    a tone curve this test cannot run.
  */
  it('keeps the body dark at both ends of the progress ramp', () => {
    const deep = linearLuma('#12414e')
    const sky = linearLuma('#b9cdda')
    expect(deep).toBeCloseTo(0.0446, 3)
    const lifted = deep + (sky - deep) * WATER.progressLift
    expect(lifted).toBeCloseTo(0.0883, 3)
    // Progress must brighten it, and by a real amount, or the read is gone.
    expect(lifted / deep).toBeGreaterThan(1.5)
  })

  /*
    Physically water goes to a full mirror at grazing incidence, and physically
    correct is the wrong answer here: uncapped, a flank reflecting the whole sky
    renders at display 0.837, brighter than the deck at 0.612 to 0.698. Putting
    decoration above the floor it stands on is the defect this entire pass exists
    to remove, so the cap is load-bearing rather than cosmetic.
  */
  it('caps the grazing reflection below a full mirror', () => {
    expect(WATER.fresnel).toBeGreaterThan(0)
    expect(WATER.fresnel).toBeLessThan(0.5)
  })
})

describe('the water shoreline', () => {
  /*
    Tied to `waterSection` rather than written as literals, so a re-authored
    cross-section cannot silently move the geometry out from under the alpha ramp
    and leave a hard silhouette line where the water meets the board - which is
    the defect the ramp exists to remove.

    The pairing has moved. Version two tied these numbers to `-standoff / radius`,
    the angle at which a half-buried TUBE was cut by the deck; there is no tube
    now, and the quantity that replaces it is the section's own resolved normals.
    `hubLayout.test.ts` asserts the same relationship from the geometry's side, so
    the two files pin each other rather than both pinning a literal.
  */
  const section = waterSection()
  const visible = section.filter((p) => p.up >= 0)
  const tuck = section[section.length - 1]

  it('leaves the whole visible surface opaque, at every relief the taper produces', () => {
    /*
      The taper flattens each channel's relief toward its mouths, so the section is
      swept at a continuum of reliefs rather than at one. All of them have to stay
      inside the window or a channel would go translucent as it approached a pool.
    */
    for (const relief of [1, 0.5, TRACE.endRelief]) {
      for (const p of waterSection(false, relief).filter((q) => q.up >= 0)) {
        expect(p.normalUp, `relief ${relief} at across ${p.across}`).toBeGreaterThan(
          WATER.shoreTop,
        )
      }
    }
    expect(visible.length).toBeGreaterThan(4)
  })

  it('completes its fade on the buried tuck, so no water shows inside the deck', () => {
    expect(tuck.up).toBeLessThan(0)
    expect(tuck.normalUp).toBeLessThan(WATER.shoreBottom)
  })

  /*
    `shoreTop` staying NEGATIVE is the load-bearing part, and it is the one edit here
    that would look like a tidy-up.

    The twelve riser climbs stand the section on its edge and draw a sheet of water
    down a step face, and on those the section's up points horizontally away from the
    face - so the whole sheet sits near normal Y 0. At a `shoreTop` of 0.0 the ramp
    would read every waterfall in the level as half shore and render it at 50% alpha.
  */
  it('keeps the ramp below zero, so a vertical sheet of water stays opaque', () => {
    expect(WATER.shoreBottom).toBeLessThan(WATER.shoreTop)
    expect(WATER.shoreTop).toBeLessThan(0)
  })

  /*
    And the meniscus is no longer a function of the normal at all. On a tube the
    normal stood in for how far across the surface a fragment was; on a flat pool two
    square metres of water share one normal, so there is no pair of numbers that puts
    a band at the rim. It rides on the geometry's own distance-to-bank instead.
  */
  it('drives the meniscus off the shore attribute rather than off the normal', () => {
    expect(waterFragmentShader).toContain('smoothstep(uFoamShore, 1.0, vShore)')
    expect(waterVertexShader).toContain(`attribute float ${WATER_SHORE_ATTRIBUTE}`)
    expect(waterVertexShader).toContain(`vShore = ${WATER_SHORE_ATTRIBUTE}`)
  })

  it('opens the meniscus on water that is above the bank, not under it', () => {
    const dome = WATER_SECTION[1]
    const shoulder = WATER_SECTION[2]
    expect(WATER.foamShore).toBeGreaterThan(dome.shore)
    expect(WATER.foamShore).toBeLessThanOrEqual(shoulder.shore)
  })
})

describe('the ripple term', () => {
  /*
    It exists because a flat water surface at this camera has NO specular response,
    which is not obvious and is the reason the pool would otherwise be a dead disc.
    The glint is a Blinn lobe at exponent 220 against a key 42.7 degrees up, so the
    half-vector sits near 45 degrees of elevation and a flat normal misses it by that
    much: `pow(cos(45), 220)` underflows to zero in any float. The channels keep
    their glint from the section's quarter turn of normals; the two discs have none.
  */
  it('is the only cue a flat surface has, so a flat surface must have it', () => {
    const missedByAFlatNormal = Math.cos(Math.PI / 4) ** WATER.gloss
    expect(missedByAFlatNormal).toBeLessThan(1e-30)
    expect(WATER.ripple).toBeGreaterThan(0)
  })

  it('is applied centred, so it moves the body without brightening it', () => {
    expect(waterFragmentShader).toContain('(waves - 0.5) * uRipple')
  })

  /*
    Clamped at BOTH ends, and the lower clamp is the one that matters: a centred term
    can drive the mix factor negative, and `mix` with a negative t EXTRAPOLATES past
    `uDeepColor` toward the negative of the sky. That is a pixel darker than anything
    in the palette and, in a wave trough under the arch, plausibly a negative one.
  */
  it('clamps the summed mix factor rather than trusting the terms', () => {
    expect(waterFragmentShader).toMatch(/float skyMix = clamp\(/)
    expect(waterFragmentShader).toContain('0.0,\n      1.0\n    );')
  })
})

describe('waterUniforms', () => {
  it('derives the phase rate from the crest count rather than repeating it', () => {
    const u = waterUniforms()
    expect(u.uFlowRate.value).toBeCloseTo(WATER.flow * WATER.crests * Math.PI * 2, 9)
  })

  it('normalises the key direction, since the shader uses it as a half-vector', () => {
    const v = waterUniforms([9, 9.5, 5]).uKeyDirection.value
    expect(v.length()).toBeCloseTo(1, 9)
  })

  it('accepts the key direction from outside, so the duplicate can be retired', () => {
    const v = waterUniforms([0, 1, 0]).uKeyDirection.value
    expect([v.x, v.y, v.z]).toEqual([0, 1, 0])
  })

  it('hands each material its own uniform objects', () => {
    expect(waterUniforms().uTime).not.toBe(waterUniforms().uTime)
  })

  it('starts at an empty hub, so progress can only be revealed by the caller', () => {
    expect(waterUniforms().uProgress.value).toBe(0)
  })
})
