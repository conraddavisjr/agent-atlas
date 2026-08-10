import { describe, expect, it } from 'vitest'
import { DoubleSide, MultiplyBlending } from 'three'
import {
  CONTACT_STRENGTH,
  contactDecalGeometry,
  createContactDecalMaterial,
  type Contact,
} from './contactDecal'
import { CONTACT_TINT } from './contactTint'

const disc = (over: Partial<Contact> = {}): Contact => ({
  x: 0,
  z: 0,
  y: 0,
  footX: 0.34,
  band: 0.81,
  strength: 0.5,
  ...over,
})

describe('contactDecalGeometry', () => {
  it('returns null for an empty list rather than a draw call that covers nothing', () => {
    expect(contactDecalGeometry([])).toBeNull()
  })

  it('emits four vertices and two triangles per contact', () => {
    const g = contactDecalGeometry([disc(), disc({ x: 4 }), disc({ x: -4 })])!
    expect(g.getAttribute('position').count).toBe(12)
    expect(g.getIndex()!.count).toBe(18)
  })

  it('sizes each quad as the foot plus the band on every side', () => {
    const g = contactDecalGeometry([disc({ footX: 0.34, band: 0.81 })], 0)!
    const p = g.getAttribute('position')
    const xs = Array.from({ length: 4 }, (_, i) => p.getX(i))
    const zs = Array.from({ length: 4 }, (_, i) => p.getZ(i))
    // 0.34 + 0.81 = 1.15 in both axes.
    expect(Math.min(...xs)).toBeCloseTo(-1.15, 6)
    expect(Math.max(...xs)).toBeCloseTo(1.15, 6)
    expect(Math.min(...zs)).toBeCloseTo(-1.15, 6)
    expect(Math.max(...zs)).toBeCloseTo(1.15, 6)
  })

  it('gives a rect foot a band of even width on both axes', () => {
    /*
      The whole reason `rect` exists. A radial patch round a 0.50 x 0.70 jamb
      would put a 0.30 m band on the narrow faces and a 0.42 m band on the deep
      ones; per-axis normalisation makes both 0.30.
    */
    const g = contactDecalGeometry(
      [disc({ footX: 0.25, footZ: 0.35, band: 0.3, shape: 'rect' })],
      0,
    )!
    const p = g.getAttribute('position')
    const foot = g.getAttribute('aFoot')
    expect(Math.max(...Array.from({ length: 4 }, (_, i) => p.getX(i)))).toBeCloseTo(0.55, 6)
    expect(Math.max(...Array.from({ length: 4 }, (_, i) => p.getZ(i)))).toBeCloseTo(0.65, 6)
    // The foot fractions the shader divides by: 0.25/0.55 and 0.35/0.65.
    expect(foot.getX(0)).toBeCloseTo(0.25 / 0.55, 5)
    expect(foot.getY(0)).toBeCloseTo(0.35 / 0.65, 5)
  })

  it('lifts every vertex off the receiving surface by the same amount', () => {
    const g = contactDecalGeometry([disc({ y: 2.4 })], 0.012)!
    const p = g.getAttribute('position')
    for (let i = 0; i < 4; i++) expect(p.getY(i)).toBeCloseTo(2.412, 6)
  })

  it('rotates a yawed patch about its own centre', () => {
    const g = contactDecalGeometry(
      [disc({ x: 5, z: -3, footX: 1, footZ: 0, band: 0, yaw: Math.PI / 2, shape: 'rect' })],
      0,
    )!
    const p = g.getAttribute('position')
    // A 1 x 0 foot yawed 90 degrees runs along Z, not X.
    const xs = Array.from({ length: 4 }, (_, i) => p.getX(i))
    const zs = Array.from({ length: 4 }, (_, i) => p.getZ(i))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0, 5)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 5)
  })

  it('never lets a foot fraction reach 1, which would make the falloff a step', () => {
    /*
      A zero band is authoring nonsense, but it must degrade to "almost no
      gradient" rather than to a hard edge, because a hard edge is the burnt-hole
      failure this whole system exists to avoid.
    */
    const g = contactDecalGeometry([disc({ band: 0 })])!
    const foot = g.getAttribute('aFoot')
    // Strictly under 1 is the property that matters; the clamp is 0.98 and the
    // attribute is a Float32Array, so the stored value is 0.98 plus 2e-8.
    expect(foot.getX(0)).toBeLessThan(1)
    expect(foot.getX(0)).toBeCloseTo(0.98, 6)
  })

  it('tags the shape per vertex so one material serves both metrics', () => {
    const g = contactDecalGeometry([disc(), disc({ shape: 'rect' })])!
    const shape = g.getAttribute('aShape')
    expect(shape.getX(0)).toBe(0)
    expect(shape.getX(4)).toBe(1)
  })

  it('has a bounding sphere, so the batch can be frustum culled', () => {
    const g = contactDecalGeometry([disc({ x: 10 })])!
    expect(g.boundingSphere).not.toBeNull()
    expect(g.boundingSphere!.radius).toBeGreaterThan(0)
  })
})

describe('createContactDecalMaterial', () => {
  const material = createContactDecalMaterial(CONTACT_TINT.hub)

  it('sets premultipliedAlpha, which MultiplyBlending silently requires', () => {
    /*
      Not a preference. `WebGLState.setBlending` has two branches for
      `MultiplyBlending`, and the one taken when `premultipliedAlpha` is false logs
      an error and returns WITHOUT SETTING A BLEND FUNCTION, so the quad
      composites against whatever the previous draw call left bound. This
      assertion is the regression test for a bug that produces a plausible-looking
      frame and several thousand console errors a second.
    */
    expect(material.blending).toBe(MultiplyBlending)
    expect(material.premultipliedAlpha).toBe(true)
  })

  it('keeps the multiply out of the tone mapper', () => {
    // ACES applied to a multiplier is a display curve applied to something that
    // is not a colour.
    expect(material.toneMapped).toBe(false)
  })

  it('wins the depth fight against a coplanar surface without writing depth', () => {
    expect(material.polygonOffset).toBe(true)
    expect(material.polygonOffsetFactor).toBeLessThan(0)
    expect(material.depthWrite).toBe(false)
    expect(material.depthTest).toBe(true)
    expect(material.transparent).toBe(true)
  })

  it('is double sided, so a reversed winding cannot make it render nothing', () => {
    expect(material.side).toBe(DoubleSide)
  })

  it('declares every attribute the geometry supplies', () => {
    /*
      The attributes are matched by name at link time and an unbound one reads as
      zero, silently: `aStrength` at zero is a contact with no contact in it. This
      pins the two lists together.
    */
    for (const name of ['aFoot', 'aStrength', 'aShape']) {
      expect(material.vertexShader).toContain(`attribute`)
      expect(material.vertexShader).toContain(name)
      expect(material.fragmentShader).toContain(name.replace('a', 'v'))
    }
  })
})

/**
 * The strength derivation, locked down.
 *
 * `CONTACT_STRENGTH`'s doc comment solves each peak backwards from a measured
 * receiver value and an acceptance target. That arithmetic is the reason the
 * numbers are what they are, so it is asserted here rather than left in prose: if
 * anyone changes a strength or the tint in `contactTint.ts` without redoing it,
 * this fails.
 */
describe('CONTACT_STRENGTH delivers the drop the acceptance test asks for', () => {
  const srgbToLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const linearToSrgb = (c: number) =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

  /** Linear Rec.709 luma of the multiply tint, which sets the factor's floor. */
  const tintLuma = (() => {
    const hex = CONTACT_TINT.hub.replace('#', '')
    const ch = [0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  })()

  /** Display-space drop produced on a receiver at `display` by peak alpha `a`. */
  const drop = (display: number, a: number) => {
    const factor = 1 - a * (1 - tintLuma)
    return display - linearToSrgb(srgbToLinear(display) * factor)
  }

  it('agrees with the linear luma the strengths were derived against', () => {
    expect(tintLuma).toBeCloseTo(0.0697, 3)
  })

  it('clears 0.12 on the lawn, measured with ambient occlusion OFF', () => {
    /*
      0.5472, not 0.5015. Removing the occlusion pass lifts the lawn, and solving
      against the pre-round-3 value would have made every strength here about 12%
      too strong.
    */
    expect(drop(0.5472, CONTACT_STRENGTH.lawn)).toBeGreaterThan(0.12)
    // And does not overshoot into the burnt-hole range on the frame's largest
    // walkable surface.
    expect(drop(0.5472, CONTACT_STRENGTH.lawn)).toBeLessThan(0.2)
  })

  it('replaces the band the occlusion pass was putting at a flat-on-flat corner', () => {
    // The pass took a 0.65 deck to about 0.47. The target is to match that, not
    // to beat it.
    expect(drop(0.66, CONTACT_STRENGTH.deck)).toBeGreaterThan(0.12)
    expect(drop(0.66, CONTACT_STRENGTH.deck)).toBeCloseTo(0.17, 1)
  })

  it('holds the overlapping families back, because multiply stacks', () => {
    expect(CONTACT_STRENGTH.scatter).toBeLessThan(CONTACT_STRENGTH.lawn)
    // Two overlapping scatter patches must still land inside the anchor band's
    // neighbourhood rather than crushing the lawn to black.
    const factor = (a: number) => 1 - a * (1 - tintLuma)
    const stacked = linearToSrgb(
      srgbToLinear(0.5472) * factor(CONTACT_STRENGTH.scatter) ** 2,
    )
    expect(stacked).toBeGreaterThan(0.25)
  })
})
