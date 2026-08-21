import { describe, it, expect } from 'vitest'
import type { BufferGeometry } from 'three'
import { latheProfile } from '@/art/geometry'
import {
  ARM_BAND,
  ARM_BEVEL,
  BACKPACK_BLOCK,
  CAPE_PANEL,
  CAPE_RIBBON,
  createCapeRibbon,
  coneFillet,
  DIAPER,
  EAR_POD_SHAPE,
  FACE_PLATE,
  FINGER,
  fingerCentreY,
  FOOT,
  footBottomRadius,
  footSoleFlat,
  footMaxHalfWidth,
  footTopFlat,
  HAND,
  HEAD_CAP,
  HEAD_SHELL,
  roundedConeProfile,
  roundedDiscProfile,
  skinCapeRibbon,
  SOLE_LIGHT,
  superellipsePoints,
  superellipsoidField,
  superellipsoidOffset,
  superellipsoidPatch,
  superellipsoidX,
  superellipsoidY,
  superellipsoidZ,
  sdRoundBox,
  taperedSuperellipsoid,
  TORSO,
  VISOR,
} from './robotGeometry'
import { CAPE } from './animTuning'
import { PROPORTIONS, REST, REST_ROTATION } from './robotPose'

describe('superellipsePoints', () => {
  it('is an exact ellipse at n = 2', () => {
    const pts = superellipsePoints(0.28, 0.19, 2, 64)
    for (const p of pts) {
      expect((p.x / 0.28) ** 2 + (p.y / 0.19) ** 2).toBeCloseTo(1, 9)
    }
  })

  it('satisfies the Lame equation at n = 4', () => {
    const pts = superellipsePoints(0.28, 0.19, 4, 64)
    for (const p of pts) {
      expect(Math.abs(p.x / 0.28) ** 4 + Math.abs(p.y / 0.19) ** 4).toBeCloseTo(1, 9)
    }
  })

  /*
    The property that makes it a squircle rather than an ellipse, stated as a
    measurement: at 45 degrees the curve bulges outward toward the corner. If
    this ever fails the face plate has quietly become a porthole.
  */
  it('bulges past the corresponding ellipse at 45 degrees', () => {
    const squircle = superellipsePoints(0.28, 0.19, 4, 8)
    const ellipse = superellipsePoints(0.28, 0.19, 2, 8)
    // Index 1 of 8 is theta = 45 degrees.
    expect(squircle[1].length()).toBeGreaterThan(ellipse[1].length() * 1.1)
  })

  it('reaches the half-extents exactly on the axes', () => {
    const pts = superellipsePoints(0.28, 0.19, 4, 64)
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(0.28, 12)
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(0.19, 12)
  })

  it('stays convex, which beveledExtrude requires', () => {
    // Every consecutive cross product has to share a sign, or the inset by
    // angle bisectors that beveledExtrude uses folds the outline through itself.
    const pts = superellipsePoints(0.28, 0.19, 4, 64)
    let sign = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const c = pts[(i + 2) % pts.length]
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if (sign === 0) sign = Math.sign(cross)
      expect(Math.sign(cross) === sign || cross === 0).toBe(true)
    }
  })

  it('refuses parameters that would not be convex or would not close', () => {
    expect(() => superellipsePoints(0.28, 0.19, 1.5, 64)).toThrow(/convex/)
    expect(() => superellipsePoints(0, 0.19, 4, 64)).toThrow(/half-extents/)
    expect(() => superellipsePoints(0.28, 0.19, 4, 4)).toThrow(/segments/)
  })

  it('supplies the face plate outline the part table asks for', () => {
    const pts = superellipsePoints(FACE_PLATE.a, FACE_PLATE.b, FACE_PLATE.n, FACE_PLATE.segments)
    // 0.56 x 0.38 in the part table.
    expect(FACE_PLATE.a * 2).toBeCloseTo(0.56, 9)
    expect(FACE_PLATE.b * 2).toBeCloseTo(0.38, 9)
    expect(pts).toHaveLength(FACE_PLATE.segments)
  })
})

describe('roundedDiscProfile', () => {
  const { radius, halfThickness, fillet, filletSteps } = EAR_POD_SHAPE

  it('never exceeds the requested radius or half-thickness', () => {
    const pts = roundedDiscProfile(radius, halfThickness, fillet, filletSteps)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(radius + 1e-12)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(halfThickness + 1e-12)
    }
  })

  it('starts and ends on the axis so the lathe closes', () => {
    const pts = roundedDiscProfile(radius, halfThickness, fillet, filletSteps)
    expect(pts[0].x).toBe(0)
    expect(pts[pts.length - 1].x).toBe(0)
    // Ascending. It used to descend, and see "the lathed parts are wound outward"
    // for what that cost: the shape was identical and the winding was inverted.
    expect(pts[0].y).toBeCloseTo(-halfThickness, 12)
    expect(pts[pts.length - 1].y).toBeCloseTo(halfThickness, 12)
  })

  it('actually reaches the full radius at the rim', () => {
    const pts = roundedDiscProfile(radius, halfThickness, fillet, filletSteps)
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(radius, 12)
  })

  /*
    `latheProfile` rejects coincident points because three derives each profile
    point's normal from its neighbours, and two identical points give a
    zero-length normal that renders without erroring and shades wrong along one
    ring. Feeding the real profile through the real validator is the cheapest
    way to know this generator never produces one.
  */
  it('passes the shared lathe validator', () => {
    const pts = roundedDiscProfile(radius, halfThickness, fillet, filletSteps)
    expect(() => latheProfile({ points: pts, radialSegments: 20 })).not.toThrow()
  })

  it('refuses a fillet that would fold the profile through itself', () => {
    expect(() => roundedDiscProfile(0.105, 0.04, 0.05, 4)).toThrow(/fold/)
    expect(() => roundedDiscProfile(0.105, 0.04, 0.2, 4)).toThrow(/fold/)
  })
})

describe('roundedConeProfile', () => {
  const rb = footBottomRadius()
  const rt = FOOT.topRadius
  const hh = FOOT.height / 2
  const { fillet, filletSteps } = FOOT
  const pts = () => roundedConeProfile(rb, rt, hh, fillet, filletSteps)

  it('starts and ends on the axis so the lathe closes', () => {
    const p = pts()
    expect(p[0].x).toBe(0)
    expect(p[p.length - 1].x).toBe(0)
    expect(p[0].y).toBeCloseTo(-hh, 12)
    expect(p[p.length - 1].y).toBeCloseTo(hh, 12)
  })

  /*
    ASCENDING, strictly, at every step.

    This is the assertion that would have caught the ear pods three rounds earlier.
    `LatheGeometry` takes winding and normals from the direction of travel, so a profile
    that ever steps downward ships a solid with inward normals, which the default
    `FrontSide` then culls entirely. A bounding box cannot see it and neither can a vertex
    count. `roundedDiscProfile` was symmetric in y, so its inversion was invisible; this
    profile is not symmetric, which makes the property checkable directly.
  */
  it('ascends strictly, which is what makes the lathe wind outward', () => {
    const p = pts()
    for (let i = 1; i < p.length; i++) {
      expect(p[i].y).toBeGreaterThan(p[i - 1].y - 1e-15)
    }
    expect(p.some((q, i) => i > 0 && q.y > p[i - 1].y)).toBe(true)
  })

  it('never goes negative in radius, which latheProfile rejects', () => {
    for (const q of pts()) expect(q.x).toBeGreaterThanOrEqual(0)
  })

  /*
    THE PROPERTY THE CONSTRUCTION EXISTS FOR, rather than a restatement of it.

    Each fillet must be tangent to its flat face AND to the slant. Tangency to the flat
    face is trivial - the centre sits one fillet radius in from it - but tangency to the
    SLANT is where a slanted-rim fillet differs from a vertical-rim one, and it is what a
    naive `fillet` tangent length gets wrong. So: measure the perpendicular distance from
    each fillet's centre to the slant line and require it to equal `fillet`.

    If this fails, the arcs meet the slant at a kink and the boot has a visible crease
    running round it at each rim - which is exactly the artefact the fillets are there to
    prevent, arrived at by trying to prevent it.
  */
  it('puts both fillet centres exactly one fillet radius off the slant', () => {
    const alpha = Math.atan2(rt - rb, 2 * hh)
    // The slant line: through the unfilleted bottom corner, in the slant's direction.
    const cx = rb
    const cy = -hh
    const dx = Math.sin(alpha)
    const dy = Math.cos(alpha)
    const distance = (px: number, py: number) => Math.abs(dx * (py - cy) - dy * (px - cx))

    expect(distance(footSoleFlat().x, -hh + fillet)).toBeCloseTo(fillet, 12)
    expect(distance(footTopFlat().x, hh - fillet)).toBeCloseTo(fillet, 12)
  })

  /*
    And the consequence of that tangency which is easy to get wrong by hand: the two
    fillets eat DIFFERENT amounts off their faces, because the bottom corner turns
    through 90 - alpha and the top through 90 + alpha. A generator using one tangent
    length for both would put both flats in the wrong place, and the two flats are the
    load-bearing surfaces on this part - one carries the sole light, the other is what
    the shin emerges through.
  */
  it('takes more off the blunt top corner than the sharp bottom one', () => {
    const { tBot, tTop } = coneFillet(rb, rt, 2 * hh, fillet)
    expect(tTop).toBeGreaterThan(tBot)
    expect(rb - tBot).toBeCloseTo(footSoleFlat().x, 12)
    expect(rt - tTop).toBeCloseTo(footTopFlat().x, 12)
    // Both are away from the naive `fillet`, in opposite directions.
    expect(tBot).toBeLessThan(fillet)
    expect(tTop).toBeGreaterThan(fillet)
  })

  /*
    The maximum radius of the SOLID is short of the authored `topRadius`, because the
    fillet cuts the corner off. Pinned because it is the trap that made every dimension
    in this pass's first draft of `FOOT`'s docstring wrong by 3.6 mm, and it is the same
    trap `TORSO` carries for the taper: the authored parameter is not the built extent.
  */
  it('never reaches the authored top radius, which the corner would have', () => {
    const maxX = Math.max(...pts().map((q) => q.x))
    expect(maxX).toBeLessThan(rt)
    /*
      Expressed against the FILLET rather than as an absolute, which is what the
      0.003 here used to be. The shortfall is a property of the fillet rounding a
      corner over a slant, so it scales with the fillet - and when the boot was
      narrowed 30% and its fillet scaled with it, an absolute threshold failed on a
      shape that had not changed in any way this test is about. A test whose
      threshold is a leftover measurement fails for the wrong reason.
    */
    expect(rt - maxX).toBeGreaterThan(fillet * 0.1)
    // And pinned, because the exact figure is the trap: it is 1.8 mm, not the
    // fillet's own 11.2, and reading `topRadius` as the built width is 1.8 mm wrong.
    expect(rt - maxX).toBeCloseTo(0.0018, 4)
  })

  /*
    `footMaxHalfWidth()` is the CONTINUOUS silhouette maximum, and the built mesh samples
    the arc, so the built value must be at or inside it - never beyond. That direction
    matters: `robotPose.test.ts` measures the gap between the two boots against this
    number, and a helper that understated the boot would understate the gap in the unsafe
    direction. Pinned here so the docstring's claim is a test rather than a note.
  */
  it('bounds the built silhouette from outside, which is what makes it safe to clear against', () => {
    const builtMax = bootBounds().width / 2
    expect(builtMax).toBeLessThanOrEqual(footMaxHalfWidth().x + 1e-9)
    // And it is not loose: the sampling costs a fifth of a millimetre, not millimetres.
    expect(footMaxHalfWidth().x - builtMax).toBeLessThan(0.0005)
    expect(footMaxHalfWidth().z / footMaxHalfWidth().x).toBeCloseTo(FOOT.depthScale, 12)
  })

  it('passes the shared lathe validator', () => {
    expect(() => latheProfile({ points: pts(), radialSegments: 20 })).not.toThrow()
  })

  it('refuses a fillet that would leave no flat face or eat the whole slant', () => {
    // Bigger than the bottom radius, so the sole would invert.
    expect(() => roundedConeProfile(0.01, 0.09, 0.065, 0.03, 4)).toThrow(/no flat face/)
    // Tall enough fillet on a short cone that the two rims would cross.
    expect(() => roundedConeProfile(0.2, 0.21, 0.01, 0.05, 4)).toThrow(/slant/)
    expect(() => roundedConeProfile(0.06, 0.09, 0.065, 0, 4)).toThrow(/positive/)
  })
})

describe('taperedSuperellipsoid', () => {
  const torso = () => taperedSuperellipsoid(TORSO)

  it('produces finite positions and unit-length normals everywhere', () => {
    const g = torso()
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true)

    const nrm = g.getAttribute('normal')
    for (let i = 0; i < nrm.count; i++) {
      const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('is the requested height', () => {
    const box = torso().boundingBox!
    expect(box.max.y - box.min.y).toBeCloseTo(TORSO.b * 2, 6)
  })

  /*
    The width the parameters actually produce, not the width the design spec
    claims for them.

    The spec says these give "0.62 wide at the base". They do not, and the
    reason is structural rather than a typo: the taper is a function of latitude
    and is already halfway applied at the equator, which is where the solid is
    widest. So the true maximum is `a * mix(1, taperTop, 0.5)`, and the number
    is pinned here so a future edit to `a` or `taperTop` has to look at it.
  */
  it('is wider than its half-extent because the taper reaches the equator', () => {
    const box = torso().boundingBox!
    /*
      The direction of this assertion FLIPPED with the taper.

      With `taperTop` below 1 the widest latitude sat just below the equator and the
      solid came out narrower than `a`. `taperTop` is now 1.25, so the taper
      MULTIPLIES the widest latitude and the solid is wider than `a` instead. The
      bracket is still the same two bounds, just the other way round: strictly
      outside the untapered half-extent, strictly inside the fully tapered one,
      because the widest latitude is above the equator but below the crown where the
      rim term has begun to close.
    */
    expect(box.max.x).toBeGreaterThan(TORSO.a)
    expect(box.max.x).toBeLessThan(TORSO.a * TORSO.taperTop)
    // Pinned, so an edit to `a` or `taperTop` has to come and look at it.
    expect(box.max.x * 2).toBeCloseTo(0.58, 2)
    expect(box.max.z * 2).toBeCloseTo(0.485, 2)
    // And it is the number `PROPORTIONS` publishes, which the diaper used to own.
    expect(box.max.x * 2).toBeCloseTo(PROPORTIONS.torsoWidthMax, 3)
  })

  it('is wider at the shoulders than at the base, which is the reverse of what shipped', () => {
    /*
      The note is "one flowing torso, starting wide at the shoulders and narrowed
      down by the waist", and what shipped was a pear: `taperTop` 0.84 made the torso
      widest at its BASE, and the test here asserted exactly that. Both the shape and
      this assertion are inverted, and the old direction is recorded so nobody
      "restores" it as a regression fix.
    */
    const g = torso()
    const pos = g.getAttribute('position')
    const box = g.boundingBox!
    const height = box.max.y - box.min.y
    let lowerMax = 0
    let upperMax = 0
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const x = Math.abs(pos.getX(i))
      // Skip the poles, where both bands are zero by construction.
      const f = (y - box.min.y) / height
      if (f > 0.2 && f < 0.4) lowerMax = Math.max(lowerMax, x)
      if (f > 0.6 && f < 0.8) upperMax = Math.max(upperMax, x)
    }
    expect(upperMax).toBeGreaterThan(lowerMax)
    // A taper worth having, not a rounding difference.
    expect(upperMax - lowerMax).toBeGreaterThan(0.01)
  })

  it('collapses both poles to a single point', () => {
    const g = torso()
    const pos = g.getAttribute('position')
    const box = g.boundingBox!
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (Math.abs(y - box.max.y) < 1e-9 || Math.abs(y - box.min.y) < 1e-9) {
        expect(Math.abs(pos.getX(i))).toBeLessThan(1e-9)
        expect(Math.abs(pos.getZ(i))).toBeLessThan(1e-9)
      }
    }
  })

  it('emits no degenerate triangles', () => {
    const g = torso()
    const index = g.getIndex()!
    const pos = g.getAttribute('position')
    for (let i = 0; i < index.count; i += 3) {
      const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      const abx = pos.getX(ib) - pos.getX(ia)
      const aby = pos.getY(ib) - pos.getY(ia)
      const abz = pos.getZ(ib) - pos.getZ(ia)
      const acx = pos.getX(ic) - pos.getX(ia)
      const acy = pos.getY(ic) - pos.getY(ia)
      const acz = pos.getZ(ic) - pos.getZ(ia)
      const area = Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      )
      expect(area).toBeGreaterThan(1e-12)
    }
  })

  it('duplicates the seam column so the UVs run 0 to 1', () => {
    const g = torso()
    const uv = g.getAttribute('uv')
    let sawZero = false
    let sawOne = false
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) === 0) sawZero = true
      if (uv.getX(i) === 1) sawOne = true
    }
    expect(sawZero && sawOne).toBe(true)
  })

  it('refuses a segment count too low to close', () => {
    expect(() => taperedSuperellipsoid({ ...TORSO, latSegments: 2 })).toThrow(/segments/)
  })
})

/*
  The face glyph's SDF geometry.

  This exists because the shader is not testable and its failure mode is
  silence. The arithmetic is well-formed for any parameters, so a wrong
  half-extent produces an invisible glyph on a black plate rather than an error,
  and the only two places that shows are a screenshot and here. It shipped
  invisible once already, from the design spec's own numbers.
*/
describe('the eye lenses', () => {
  /** One lens, exactly as the fragment builds it. */
  const lens = (px: number, py: number, cx: number, open = 1, width = 1) => {
    const hw = VISOR.lensHalfW * width
    const hh = VISOR.lensHalfH * open
    return sdRoundBox(px - cx, py - VISOR.y, hw, hh, Math.min(hw, hh))
  }

  /*
    The property the whole shape rests on. With equal half-extents and a corner
    radius equal to them both, the iq form collapses to `length(p) - r`, so the
    lens is a TRUE circle. Get the radius argument wrong and it becomes a rounded
    square, which reads as a screen rather than as a lens and is not visible in
    any counter.
  */
  it('is an exact circle at neutral', () => {
    expect(lens(0, VISOR.y, 0)).toBeCloseTo(-VISOR.lensHalfW, 9)
    for (const th of [0, 0.3, 1.1, 2.4, 4.7]) {
      const r = VISOR.lensHalfW
      expect(lens(r * Math.cos(th), VISOR.y + r * Math.sin(th), 0)).toBeCloseTo(0, 9)
    }
    expect(lens(VISOR.lensHalfW * 1.4, VISOR.y, 0)).toBeGreaterThan(0)
  })

  /*
    The three numbers `00-references.md` section 8 actually measured off official
    renders, which are the only quantitative statement anyone made about this
    shape: "two rounded-rect LED panels, each ~22-28% of face-plate width, one
    eye-width apart, at 55-60% down the face plate."
  */
  it('matches the reference brief`s measured proportions', () => {
    const diameter = VISOR.lensHalfW * 2 * VISOR.metresPerUnit
    expect(diameter).toBeCloseTo(0.1292, 4)
    const ofPlate = diameter / 0.56
    expect(ofPlate).toBeGreaterThan(0.22)
    expect(ofPlate).toBeLessThan(0.28)
    expect(0.5 - VISOR.y).toBeCloseTo(0.57, 9)
  })

  /*
    "One eye-width apart", and exact rather than close because the offset is
    twice the radius. Pinned so a future nudge to either has to come here.
  */
  it('separates the two lenses by exactly one lens width', () => {
    const gap = 2 * (VISOR.lensOffset - VISOR.lensHalfW)
    expect(gap).toBeCloseTo(VISOR.lensHalfW * 2, 12)
    // And the two never overlap, even at the widest expression in the table.
    const innerEdge = VISOR.lensOffset - VISOR.lensHalfW * 1.4
    expect(innerEdge).toBeGreaterThan(0)
  })

  it('fits inside the plate on both axes at the widest expression', () => {
    // Plate space x runs over +-aspect/2 and y over +-0.5. A lens that overran
    // either would be clipped by the quad rather than by the plate.
    expect(VISOR.lensOffset + VISOR.lensHalfW * 1.4).toBeLessThan(VISOR.aspect / 2)
    expect(Math.abs(VISOR.y) + VISOR.lensHalfH * 1.5).toBeLessThan(0.5)
  })

  /*
    The blink, and what it now does. A round lens driven by `open` squashes to a
    stadium of the SAME width with fully rounded ends, which is the reference's
    blink rather than a shrinking dot.
  */
  it('squashes rather than shrinking through a blink', () => {
    for (const open of [1, 0.5, 0.06]) {
      // Still full width at every stage of the close.
      expect(lens(VISOR.lensHalfW, VISOR.y, 0, open)).toBeCloseTo(0, 9)
      // And the height is exactly the scaled one.
      expect(lens(0, VISOR.y + VISOR.lensHalfH * open, 0, open)).toBeCloseTo(0, 9)
      expect(lens(0, VISOR.y + VISOR.lensHalfH * open * 1.6, 0, open)).toBeGreaterThan(0)
    }
  })

  /*
    The identity constraint that has been REVERSED, recorded as a measurement
    rather than deleted.

    The test that used to live here was called "keeps the bar lit through a full
    blink" and its comment read: "The reference`s character loses its eyes on a
    blink; this one keeps a lit line, and that difference is the entire reason the
    visor is a bar rather than two panels." The decision on record is now to clone
    the reference, so that difference is gone on purpose and this is what it costs:
    at the floor of `openL` the lit shape is 7.8 mm tall on a 129 mm lens.

    7.8 and not the 3.9 the first draft of this test asserted, which came from
    halving a half-extent that was already a half-extent. Worth leaving in the
    comment because 3.9 mm is roughly a pixel at playing distance and 7.8 mm is
    plainly a line, and the two support opposite conclusions about whether the
    blink is too severe.

    Kept as an assertion rather than a comment so that if someone later decides
    the blink is too severe, the number they are arguing with is here.
  */
  it('goes very nearly dark at the floor of a blink, which is deliberate', () => {
    const closedHeight = VISOR.lensHalfH * 0.06 * 2 * VISOR.metresPerUnit
    expect(closedHeight).toBeCloseTo(0.0078, 4)
    const closedWidth = VISOR.lensHalfW * 2 * VISOR.metresPerUnit
    expect(closedWidth).toBeCloseTo(0.1292, 4)
    // Still resolvable rather than sub-pixel: the half-height clears the
    // antialias half-width, so it renders as a thin line and not as nothing.
    expect(VISOR.lensHalfH * 0.06).toBeGreaterThan(VISOR.aa)
  })

  /*
    Containment, which used to be a clip and is now structural.

    The bar version genuinely needed `coreMask *= barMask`: a core at full gaze
    and full width reached 0.360 against a slot half-extent of 0.245. The core is
    now measured in units of the lens`s own half-extents, so the lens is the unit
    disc in that space and this arithmetic is width- and open-independent.
  */
  it('cannot let a core escape its lens at any gaze', () => {
    const gazeNormX = VISOR.gazeX / VISOR.lensHalfW
    const gazeNormY = VISOR.gazeY / VISOR.lensHalfH
    expect(VISOR.coreOuter + gazeNormX).toBeCloseTo(0.874, 3)
    expect(VISOR.coreOuter + gazeNormX).toBeLessThan(1)
    expect(VISOR.coreOuter + gazeNormY).toBeLessThan(1)
    // And the core is a ramp, not a step: the flat part is strictly inside the
    // falloff or there is no gradient and it reads as a hard disc.
    expect(VISOR.coreInner).toBeLessThan(VISOR.coreOuter)
  })

  /*
    Kept verbatim from the bar version, because the trap is about `sdRoundBox`
    rather than about the shape.

    The spec`s (0.215, 0.0) fed to the iq body it also ships gives exactly zero
    at the centre of the bar, so `1 - smoothstep(-aa, aa, 0)` is 0.5 at the
    brightest point and the alpha it multiplies collapses. Pinned as an explicit
    negative, so nobody re-derives the "documented" numbers from the spec.
  */
  it('would be a zero-height line at the half-extents the spec gives', () => {
    expect(sdRoundBox(0, 0, 0.215, 0.0, 0.03)).toBe(0)
    expect(sdRoundBox(0, 0.0001, 0.215, 0.0, 0.03)).toBeGreaterThan(0)
  })
})

/*
  Is this part proud of the one under it, for a head that is no longer a box.

  Every "how proud" question on this model used to be one call to `sdRoundBox3`,
  which lived here, and `Helmet` was the worst case it caught: an 0.84 hemisphere
  over a 0.72 head with a 0.03 gap at the rim, none of it visible in a triangle
  count. The head is now a superellipsoid, which has no closed-form signed
  distance, so the same questions are asked against `superellipsoidField` instead:
  1 on the surface, above 1 outside, below 1 inside.

  `sdRoundBox3` went with the box. Nothing else on the character needed it - the
  sole light and the back port do their own arithmetic against their own housings -
  and keeping a helper for a shape that no longer exists is how the stale numbers
  in `HEAD_CAP`'s comment got there.

  The field's MAGNITUDE is meaningless, so nothing below compares two field values
  as if they were metres. Where a test wants a clearance in metres it solves for the
  surface coordinate with `superellipsoidX/Y/Z`.
*/
const headField = (x: number, y: number, z: number) =>
  superellipsoidField(x, y, z, HEAD_SHELL)

/**
 * The signed volume of a closed triangle soup, positive when every face winds
 * outward.
 *
 * The single most useful assertion in this file, and it is here because the ear
 * pods shipped inside out for three rounds while five tests measured their
 * extents and passed. Winding is invisible to a bound, invisible to a vertex
 * count, invisible to a bounding box, and with the default `FrontSide` it is the
 * difference between a part and nothing at all.
 */
function signedVolume(g: BufferGeometry): number {
  const pos = g.getAttribute('position')
  const idx = g.getIndex()!
  let v = 0
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i)
    const b = idx.getX(i + 1)
    const c = idx.getX(i + 2)
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a)
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b)
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c)
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return v
}

/** How many of a geometry's stored normals point radially outward, and how many in. */
function radialNormalSense(g: BufferGeometry): { out: number; in: number } {
  const pos = g.getAttribute('position')
  const nrm = g.getAttribute('normal')
  let outward = 0
  let inward = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r < 1e-6) continue
    const d = (nrm.getX(i) * x + nrm.getZ(i) * z) / r
    if (d > 0.2) outward++
    else if (d < -0.2) inward++
  }
  return { out: outward, in: inward }
}

/**
 * The boot, built exactly as `robotParts.tsx` builds it: lathe the cone profile, then
 * scale Z. Rebuilt here rather than imported because that module is JSX, and there is
 * no duplicated arithmetic in doing so - both go through `roundedConeProfile` and
 * `FOOT`, so the only thing repeated is the call.
 */
const bootGeometry = () => {
  const g = latheProfile({
    points: roundedConeProfile(
      footBottomRadius(),
      FOOT.topRadius,
      FOOT.height / 2,
      FOOT.fillet,
      FOOT.filletSteps,
    ),
    radialSegments: FOOT.radialSegments,
  })
  g.scale(1, 1, FOOT.depthScale)
  return g
}

/** The boot's built bounding box, which is the only honest source for its dimensions. */
function bootBounds() {
  const pos = bootGeometry().getAttribute('position')
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i))
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i))
    minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i))
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
    minY,
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
  }
}

/**
 * The boot's silhouette as `(y, maxHalfWidthX)` per latitude ring of the built mesh,
 * sorted upward. This is what says which end of the cone is narrow, and it cannot be
 * fooled by a cone built upside down the way a ratio of parameters can.
 */
function bootSilhouette(): { y: number; x: number }[] {
  const pos = bootGeometry().getAttribute('position')
  const byY = new Map<number, number>()
  for (let i = 0; i < pos.count; i++) {
    const y = Math.round(pos.getY(i) * 1e7) / 1e7
    byY.set(y, Math.max(byY.get(y) ?? 0, Math.abs(pos.getX(i))))
  }
  return [...byY.entries()].map(([y, x]) => ({ y, x })).sort((a, b) => a.y - b.y)
}

const earPodGeometry = () => {
  const g = latheProfile({
    points: roundedDiscProfile(
      EAR_POD_SHAPE.radius,
      EAR_POD_SHAPE.halfThickness,
      EAR_POD_SHAPE.fillet,
      EAR_POD_SHAPE.filletSteps,
    ),
    radialSegments: EAR_POD_SHAPE.radialSegments,
  })
  g.rotateZ(Math.PI / 2)
  /*
    The depth squash, in the same order `robotParts.tsx` applies it.

    This helper used to stop at the `rotateZ`, which meant every ear pod assertion
    below was measuring a shape the game does not draw. That is the failure mode this
    whole file exists against, so the helper follows the component exactly and the
    ordering note lives on `EAR_POD_SHAPE.depthScale`.
  */
  g.scale(1, 1, EAR_POD_SHAPE.depthScale)
  return g
}

/*
  The bug this whole pass turned on, and the reason it is tested by volume rather
  than by extent.

  `roundedDiscProfile` descended, from `+halfThickness` to `-halfThickness`, and
  `LatheGeometry` takes both its winding and its normals from the profile's
  direction of travel. The point set is symmetric in y, so the shape was identical
  either way and every test that measured a radius, a half-thickness or a bounding
  box passed. What was not identical was which way the faces pointed.
*/
describe('the lathed parts are wound outward, which the ear pods were not', () => {
  it('gives the ear pod a positive volume and outward normals', () => {
    const g = earPodGeometry()
    /*
      The bound is derived from the shape constants rather than from the literals
      0.105 and 0.21 it used to hardcode, because those literals silently stopped
      describing the part when the pod became a thin fin.

      An elliptical can of semi-axes `radius` by `radius * depthScale` and length
      `2 * halfThickness` is `PI * radius^2 * depthScale * 2 * halfThickness` before
      the fillet takes material off the two rims, so the answer sits a little under
      that. The descending profile measured -0.006906 against +0.006906 at the old
      size: same magnitude, opposite sign, which is the whole signature of an inverted
      winding, and the sign is the assertion that matters here.
    */
    const solid =
      Math.PI *
      EAR_POD_SHAPE.radius *
      EAR_POD_SHAPE.radius *
      EAR_POD_SHAPE.depthScale *
      2 *
      EAR_POD_SHAPE.halfThickness
    const v = signedVolume(g)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(solid)
    expect(v).toBeGreaterThan(0.8 * solid)

    const sense = radialNormalSense(g)
    expect(sense.in).toBe(0)
    expect(sense.out).toBeGreaterThan(100)
  })

  /*
    The two rings on each upper arm come off the same generator and were inside out
    too, at a measured -0.000712. Nobody reported them, because a ring drawn with
    only its inner wall still puts a dark band round the arm - which is exactly why
    this is asserted rather than left to a render.
  */
  it('gives both arm rings a positive volume', () => {
    for (const ring of [ARM_BAND, ARM_BEVEL]) {
      const g = latheProfile({
        points: roundedDiscProfile(ring.radius, ring.halfThickness, ring.fillet, ring.filletSteps),
        radialSegments: ring.radialSegments,
      })
      expect(signedVolume(g)).toBeGreaterThan(0)
      expect(radialNormalSense(g).in).toBe(0)
    }
  })

  /*
    And the profile ascends, which is the property the two tests above depend on and
    the one thing a future edit could quietly reverse. `roundedCylinder` in
    `src/art/geometry.ts` ascends for the same reason, which is why nothing else in
    the world was ever affected.
  */
  it('builds its profile from the bottom up', () => {
    const pts = roundedDiscProfile(
      EAR_POD_SHAPE.radius,
      EAR_POD_SHAPE.halfThickness,
      EAR_POD_SHAPE.fillet,
      EAR_POD_SHAPE.filletSteps,
    )
    expect(pts[0].y).toBeCloseTo(-EAR_POD_SHAPE.halfThickness, 12)
    expect(pts[pts.length - 1].y).toBeCloseTo(EAR_POD_SHAPE.halfThickness, 12)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y - 1e-12)
    }
  })
})

/*
  Which authored ear pod number lands on which world axis.

  This is here because it was UN-TESTABLE for three rounds and nobody noticed. The pod
  shipped with `radius` and `halfThickness` both 0.105, so the built bounding box was a
  cube and every assertion about its extents passed identically with the two swapped.
  `robotParts.tsx` and `EAR_POD_SHAPE` between them make three claims about which axis
  is which - the extrusion, the flap plane, and which one the 66% note applies to - and
  a cube can support none of them.

  So the mapping is probed with deliberately DISTINCT values, in the same build order
  the component uses. A future edit that reorders the rotate and the scale, or that
  flips which axis the depth squash lands on, fails here.
*/
describe('the ear pod lathe maps its parameters onto the axes the model assumes', () => {
  it('puts halfThickness on x, radius on y, and the squashed radius on z', () => {
    const probeRadius = 0.1
    const probeHalfThickness = 0.03
    const probeDepthScale = 0.5
    const g = latheProfile({
      points: roundedDiscProfile(probeRadius, probeHalfThickness, 0.01, 4),
      radialSegments: 16,
    })
    g.rotateZ(Math.PI / 2)
    g.scale(1, 1, probeDepthScale)
    g.computeBoundingBox()
    const box = g.boundingBox!
    expect(box.max.x).toBeCloseTo(probeHalfThickness, 6)
    expect(box.max.y).toBeCloseTo(probeRadius, 6)
    expect(box.max.z).toBeCloseTo(probeRadius * probeDepthScale, 6)
  })

  /*
    And the flap has something to move, which it did not before.

    `stepAnim` writes the pods' spring onto `pose.earPodL.rx`, and a rotation about X
    applied to a solid of revolution ABOUT X is invisible. With `radius` on both y and
    z the pod was exactly that, so `EAR_POD.counterRoll` and `EAR_POD.landImpulse` had
    never drawn a frame of motion. The depth squash is what makes rx a real rotation,
    and this is the assertion that keeps it one.
  */
  it('is not a solid of revolution about its own animation axis', () => {
    const g = earPodGeometry()
    g.computeBoundingBox()
    const box = g.boundingBox!
    expect(box.max.y / box.max.z).toBeGreaterThan(2)
  })
})

describe('the head shell is an oblong and not a rounded rectangle', () => {
  const head = () => taperedSuperellipsoid(HEAD_SHELL)

  it('keeps the extents the proportion ladder is built on', () => {
    const box = head().boundingBox!
    expect(box.max.x - box.min.x).toBeCloseTo(HEAD_SHELL.width, 4)
    expect(box.max.y - box.min.y).toBeCloseTo(HEAD_SHELL.height, 4)
    expect(box.max.z - box.min.z).toBeCloseTo(HEAD_SHELL.depth, 4)
    // The crown is what fixes PROPORTIONS.totalHeight at 1.36. REST puts the head
    // node at world 1.090, so the half-height has to be exactly 0.270.
    expect(HEAD_SHELL.b).toBeCloseTo(PROPORTIONS.headHeight / 2, 12)
    expect(HEAD_SHELL.width).toBeCloseTo(PROPORTIONS.headWidth, 12)
  })

  /*
    The defect this replaces, stated as the thing `Lighting.tsx` measured from the
    other end: "0.32 m of its 0.54 m height - 59% ... is a single FLAT face with one
    normal, which no light can put a gradient across."

    So the test is not "is it a superellipsoid", it is "does the normal turn". Walking
    up the front meridian, the surface normal's angle off +Z has to grow
    monotonically and reach a real angle well before the silhouette, which is what
    lets any light at any azimuth put a gradient on the face.
  */
  it('turns its normal continuously up the front, where the box had one flat', () => {
    const m1 = 2 / HEAD_SHELL.e1
    const angleAt = (frac: number) => {
      const y = HEAD_SHELL.b * frac
      const z = superellipsoidZ(0, y, HEAD_SHELL)
      const gy = Math.pow(y / HEAD_SHELL.b, m1 - 1) / HEAD_SHELL.b
      const gz = Math.pow(z / HEAD_SHELL.c, m1 - 1) / HEAD_SHELL.c
      return (Math.atan2(gy, gz) * 180) / Math.PI
    }
    let last = -1
    for (const frac of [0, 0.2, 0.4, 0.6, 0.8]) {
      const a = angleAt(frac)
      expect(a).toBeGreaterThan(last)
      last = a
    }
    // The box was 0 degrees over the whole of |y| <= 0.160, which is 59% of the
    // height. Two fifths of the way up, this has already turned 14.8.
    expect(angleAt(0.4)).toBeGreaterThan(10)
    expect(angleAt(0.6)).toBeGreaterThan(25)
  })

  it('is a closed solid wound outward', () => {
    expect(signedVolume(head())).toBeGreaterThan(0)
  })

  /*
    `superellipsoidField` is the inside/outside test every clearance below leans on,
    so it is checked against the mesh the generator actually produced rather than
    against its own algebra. Both directions matter: a field that said everything
    was outside would pass every proud-ness test in this file.
  */
  it('has a field that agrees with the built surface', () => {
    const pos = head().getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      expect(headField(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(1, 5)
    }
    expect(headField(0, 0, 0)).toBeLessThan(1)
    expect(headField(0.4, 0, 0)).toBeGreaterThan(1)
    expect(headField(0, 0.3, 0)).toBeGreaterThan(1)
    expect(headField(0, 0, 0.34)).toBeGreaterThan(1)
  })

  /*
    `taperTop` 1 is not decoration. The taper is applied at every latitude including
    the equator, so a tapered solid's widest point is not `a` and it has no implicit
    form of the kind `superellipsoidField` needs. Every clearance argument on the
    visor, the cap, the pods and the antenna would stop being checkable.
  */
  it('is untapered, which is what makes the field valid', () => {
    expect(HEAD_SHELL.taperTop).toBe(1)
  })
})

/*
  The three patches on the head: the visor plate, the visor glyph and the copper
  cap. Everything here is one question asked three times - is this panel outside the
  helmet everywhere, or does it have a rim hanging in the air - and it is asked
  against the BUILT geometry rather than against the numbers that produced it.

  That is the lesson from the two invisible parts of the last pass. A sole light was
  authored "recessed 1 mm above the sole plane" and sat entirely inside opaque
  rubber; a three-ring port had its inner rings enclosed because a `cylinderGeometry`
  is a disc and not a ring. Both had a test. Both tests asserted the position the
  part was authored at, which was exactly the wrong thing, so both passed.
*/
describe('the curved panels on the head', () => {
  const plateOutline = () =>
    superellipsePoints(FACE_PLATE.a, FACE_PLATE.b, FACE_PLATE.n, FACE_PLATE.segments)

  const plate = () =>
    superellipsoidPatch({
      host: HEAD_SHELL,
      outline: plateOutline(),
      halfW: FACE_PLATE.a,
      halfH: FACE_PLATE.b,
      centreY: FACE_PLATE.y,
      facing: 1,
      inset: FACE_PLATE.inset,
      rise: FACE_PLATE.rise,
      chamfer: FACE_PLATE.chamfer,
      chamferFrac: FACE_PLATE.chamferFrac,
      rings: FACE_PLATE.rings,
      solid: true,
    })

  const glyph = () =>
    superellipsoidPatch({
      host: HEAD_SHELL,
      outline: plateOutline(),
      halfW: FACE_PLATE.a,
      halfH: FACE_PLATE.b,
      centreY: FACE_PLATE.y,
      facing: 1,
      inset: 0,
      rise: FACE_PLATE.glyphRise,
      chamfer: 0,
      chamferFrac: 0,
      rings: FACE_PLATE.rings,
      solid: false,
    })

  const cap = () =>
    superellipsoidPatch({
      host: HEAD_SHELL,
      outline: superellipsePoints(HEAD_CAP.halfW, HEAD_CAP.halfH, HEAD_CAP.n, HEAD_CAP.segments),
      halfW: HEAD_CAP.halfW,
      halfH: HEAD_CAP.halfH,
      centreY: HEAD_CAP.y,
      facing: -1,
      inset: HEAD_CAP.inset,
      rise: HEAD_CAP.rise,
      chamfer: HEAD_CAP.chamfer,
      chamferFrac: HEAD_CAP.chamferFrac,
      rings: HEAD_CAP.rings,
      solid: true,
    })

  /*
    THE visibility proof, and the reason it is not a position assertion.

    A patch's outer surface rides `host + rise` on every half-extent, and every point
    of a larger superellipsoid is strictly outside the smaller one because each
    `|x|/a` term exceeds its `|x|/(a + rise)` counterpart. So this is provable rather
    than measurable - but "provable" is what the sole light and the back port both
    were, so it is measured anyway, over every vertex the generator emitted, against
    the head's own field.

    A patch with an inner surface has vertices INSIDE the head by construction, which
    is what attaches it. So the claim is about the outer half specifically: the
    outermost `rings * n + 1` vertices are the outer shell, and all of them must clear
    the head.
  */
  it('puts every outer-surface vertex strictly outside the helmet', () => {
    for (const [name, g, outerCount] of [
      ['plate', plate(), FACE_PLATE.rings * FACE_PLATE.segments + 1],
      ['glyph', glyph(), FACE_PLATE.rings * FACE_PLATE.segments + 1],
      ['cap', cap(), HEAD_CAP.rings * HEAD_CAP.segments + 1],
    ] as const) {
      const pos = g.getAttribute('position')
      let worst = Infinity
      for (let i = 0; i < outerCount; i++) {
        worst = Math.min(worst, headField(pos.getX(i), pos.getY(i), pos.getZ(i)))
      }
      expect(worst, `${name} outer surface`).toBeGreaterThan(1)
    }
  })

  /*
    And the other half: a panel that is outside the head everywhere is a floating
    tile. The rim has to be INSIDE, which is what makes the step read as a moulded
    part rather than as a sticker with a shadow under it.
  */
  it('buries the rim of every solid panel inside the helmet', () => {
    for (const [name, g] of [['plate', plate()], ['cap', cap()]] as const) {
      const pos = g.getAttribute('position')
      let deepest = -Infinity
      let inside = 0
      for (let i = 0; i < pos.count; i++) {
        const f = headField(pos.getX(i), pos.getY(i), pos.getZ(i))
        if (f < 1) inside++
        deepest = Math.max(deepest, 1 - f)
      }
      expect(inside, `${name} has vertices inside the head`).toBeGreaterThan(0)
      expect(deepest, `${name} is engaged`).toBeGreaterThan(0)
    }
  })

  /*
    The measurement that made all of this necessary, kept as a test so nobody
    reintroduces a flat plate. Over the plate's own footprint the surface it mounts
    on drops 0.1407 m from centre to rim, against a plate 0.032 m deep. A flat plate
    would stand a hundred and forty millimetres off the head at its edge.
  */
  it('records how far a flat plate would have missed the helmet by', () => {
    const centre = superellipsoidZ(0, FACE_PLATE.y, HEAD_SHELL)
    let rimMin = Infinity
    for (const p of plateOutline()) {
      rimMin = Math.min(rimMin, superellipsoidZ(p.x, FACE_PLATE.y + p.y, HEAD_SHELL))
    }
    expect(centre).toBeCloseTo(0.309, 3)
    expect(rimMin).toBeCloseTo(0.1683, 3)
    expect(centre - rimMin).toBeGreaterThan(0.1)
  })

  it('closes both solid panels, wound outward', () => {
    expect(signedVolume(plate())).toBeGreaterThan(0)
    expect(signedVolume(cap())).toBeGreaterThan(0)
  })

  /*
    The glyph is deliberately NOT closed, and that is the one place on this character
    where an open surface is correct: it is `transparent` with `depthWrite: false`
    and casts no shadow, so it has no inside to leak. Asserted so the exception stays
    an exception - the cape's hem caps exist because an open tube leaks the shadow
    pass, and every other patch here is solid.
  */
  it('leaves the glyph an open shell with no rim', () => {
    expect(glyph().getAttribute('position').count).toBe(
      FACE_PLATE.rings * FACE_PLATE.segments + 1,
    )
  })

  /*
    Plate space is the glyph's UV space, and `VISOR`'s half-extents, the blink, the
    gaze and the six expressions are all expressed in it. The user singled the blink
    out as excellent, so this is the assertion that says bending the surface did not
    touch it: the patch has to emit exactly the UVs `PlaneGeometry(0.56, 0.38)`
    emitted, which means 0 to 1 across the footprint with 0.5 at the centre.
  */
  it('maps the glyph`s UVs exactly as the quad it replaces did', () => {
    const g = glyph()
    const pos = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    expect(uv.getX(0)).toBeCloseTo(0.5, 12)
    expect(uv.getY(0)).toBeCloseTo(0.5, 12)
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
    for (let i = 0; i < uv.count; i++) {
      // The inverse mapping has to land back on the vertex's own footprint x, which
      // is what `PlaneGeometry` guarantees and what the shader's `vUv` assumes.
      expect((uv.getX(i) - 0.5) * 2 * FACE_PLATE.a).toBeCloseTo(pos.getX(i), 6)
      expect((uv.getY(i) - 0.5) * 2 * FACE_PLATE.b).toBeCloseTo(pos.getY(i) - FACE_PLATE.y, 6)
      uMin = Math.min(uMin, uv.getX(i)); uMax = Math.max(uMax, uv.getX(i))
      vMin = Math.min(vMin, uv.getY(i)); vMax = Math.max(vMax, uv.getY(i))
    }
    expect(uMin).toBeCloseTo(0, 6)
    expect(uMax).toBeCloseTo(1, 6)
    expect(vMin).toBeCloseTo(0, 6)
    expect(vMax).toBeCloseTo(1, 6)
  })

  /*
    The glyph rides in front of the PLATE and not just in front of the head, which is
    a different claim: both are patches on the same host, so it reduces to their
    rises, and the difference is the 0.020 the quad used to carry as a local z.
  */
  it('holds the glyph 0.020 clear of the plate`s outer surface', () => {
    expect(FACE_PLATE.glyphRise - FACE_PLATE.rise).toBeCloseTo(0.02, 12)
  })

  /*
    A footprint that runs off the host's silhouette is a panel with its rim in the
    air, and it is how the cap's own footprint was found: at the box cap's 0.56 by
    0.34 the squircle wants x 0.236 at y 0.243, where the head only reaches 0.201.
    The generator has to refuse rather than clamp, because a clamped point renders a
    clean frame with a crescent gap under it.
  */
  it('refuses a footprint that runs off the helmet', () => {
    expect(() =>
      superellipsoidPatch({
        host: HEAD_SHELL,
        outline: superellipsePoints(0.28, 0.17, 4, 48),
        halfW: 0.28,
        halfH: 0.17,
        centreY: 0.1,
        facing: -1,
        inset: 0.01,
        rise: 0.014,
        chamfer: 0.006,
        chamferFrac: 0.05,
        rings: 4,
        solid: true,
      }),
    ).toThrow(/outside the host/)
  })

  /*
    Finite positions and unit normals, which is the check that a generator did not
    quietly produce a mesh that renders as nothing.

    `computeVertexNormals` leaves an unreferenced vertex at (0, 0, 0), and
    `Vector3.normalize` keeps that as (0, 0, 0) rather than turning it into a NaN
    anything would report - the same trap `taperedSuperellipsoid` documents at its
    poles. So the assertion is on the LENGTH and not just on finiteness.
  */
  it('produces finite positions and unit normals on all three panels', () => {
    for (const [name, g] of [['plate', plate()], ['glyph', glyph()], ['cap', cap()]] as const) {
      const pos = g.getAttribute('position')
      const nrm = g.getAttribute('normal')
      expect(pos.count, name).toBeGreaterThan(100)
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${name} position ${i}`).toBe(true)
        const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
        expect(len, `${name} normal ${i}`).toBeCloseTo(1, 5)
      }
    }
  })

  /*
    The glyph faces the camera, which for an open one-sided shell is the whole of
    whether it draws at all. This is the ear-pod defect in a different generator: the
    pods were a closed solid wound inward and showed nothing in profile, and an open
    shell wound inward shows nothing from anywhere.
  */
  it('faces the glyph shell outward, since it has no second side to fall back on', () => {
    const nrm = glyph().getAttribute('normal')
    for (let i = 0; i < nrm.count; i++) expect(nrm.getZ(i)).toBeGreaterThan(0)
  })

  /*
    The glyph never touches the plate, and this is the exact version of it: every
    glyph vertex evaluated against the PLATE's own outer surface as a field, which is
    a different and stronger claim than "its rise is larger". Both ride the same host,
    so it reduces to the same term-by-term argument the visibility test uses, and it
    is measured anyway for the same reason.
  */
  it('never lets the glyph touch the plate', () => {
    const plateOuter = superellipsoidOffset(HEAD_SHELL, FACE_PLATE.rise)
    const pos = glyph().getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      expect(superellipsoidField(pos.getX(i), pos.getY(i), pos.getZ(i), plateOuter))
        .toBeGreaterThan(1)
    }
  })

  /*
    And the parallax between the two layers, measured where it can actually be seen.

    The gap is NOT uniform, because both shells are offsets by scale rather than along
    the normal: over the whole 0.56 by 0.38 footprint the separation in z runs from
    0.020 at the centre out to 0.041 at the rim, where the surface is steep enough that
    a scale offset opens up. That does not matter, and saying why is the point of this
    test rather than a comment: the glyph's alpha is zero everywhere outside the two
    lenses, so the only place the two layers are both visible is the lens footprint.

    The lenses occupy `|x| <= 0.1938` and y from -0.1362 to -0.0070 in head-local
    terms - `VISOR.lensOffset` plus `lensHalfW`, times `VISOR.metresPerUnit`, about
    `FACE_PLATE.y + VISOR.y * metresPerUnit`. Over that region the gap has to stay near
    the 0.020 the quad carried, or the eyes would sit visibly off the plate at their
    outer edges.
  */
  it('holds the glyph near 0.020 off the plate everywhere the eyes are drawn', () => {
    const plateOuter = superellipsoidOffset(HEAD_SHELL, FACE_PLATE.rise)
    const glyphOuter = superellipsoidOffset(HEAD_SHELL, FACE_PLATE.glyphRise)
    const mpu = VISOR.metresPerUnit
    const lensReach = (VISOR.lensOffset + VISOR.lensHalfW) * mpu
    const lensCentreY = FACE_PLATE.y + VISOR.y * mpu
    const lensHalfY = VISOR.lensHalfH * mpu

    expect(lensReach).toBeCloseTo(0.1938, 4)

    /*
      Measured PERPENDICULAR to the plate and not along z, which is the difference
      between a number that means something and one that does not. Along z the gap
      opens from 0.0204 at the plate's centre to 0.0248 at the lens's outer edge and
      to 0.0410 out at the plate's rim, purely because the surface has tilted - 19.9
      degrees at the lens's edge - and a scale offset opens up as it does. The visible
      separation is that times the cosine of the tilt, and the tilt is taken from a
      finite difference of the surface rather than from a hand-derived gradient,
      because the analytic normal of a superellipsoid has the removable singularity
      that made `taperedSuperellipsoid` use `computeVertexNormals` in the first
      place.
    */
    const h = 1e-4
    let gapMin = Infinity
    let gapMax = -Infinity
    for (let i = -8; i <= 8; i++) {
      for (let j = -4; j <= 4; j++) {
        const x = (i / 8) * lensReach
        const y = lensCentreY + (j / 4) * lensHalfY
        const dz = superellipsoidZ(x, y, glyphOuter) - superellipsoidZ(x, y, plateOuter)
        const gx =
          (superellipsoidZ(x + h, y, plateOuter) - superellipsoidZ(x - h, y, plateOuter)) / (2 * h)
        const gy =
          (superellipsoidZ(x, y + h, plateOuter) - superellipsoidZ(x, y - h, plateOuter)) / (2 * h)
        const gap = dz / Math.hypot(gx, gy, 1)
        gapMin = Math.min(gapMin, gap)
        gapMax = Math.max(gapMax, gap)
      }
    }
    /*
      0.020 nominal, measured at 0.02000 to 0.02155 across both eyes. The 0.16 mm of
      variation is what a scale offset costs over a normal offset, and it buys the two
      properties a normal offset could not have: no NaN at the seams the plate's rim
      crosses, and "strictly outside the host" as an algebraic fact rather than a
      measurement.
    */
    expect(gapMin).toBeGreaterThan(0.0199)
    expect(gapMax).toBeLessThan(0.0216)
  })

  /*
    The chamfer has to move OUTWARD in footprint while moving INWARD in offset, and
    those two have to not cross: if the chamfer ring ended up further from the host
    than the outer surface's last ring, the rim would fold back on itself and the panel
    would show its own inside along one edge.

    Measured on the built geometry's own ring boundaries rather than on the parameters,
    because the crossing depends on the host's curvature at the footprint's rim and not
    only on `chamfer` against `rise`.
  */
  it('keeps the chamfer between the outer surface and the rim wall', () => {
    for (const [name, opts] of [
      ['plate', { halfW: FACE_PLATE.a, halfH: FACE_PLATE.b, y: FACE_PLATE.y, n: FACE_PLATE.n, segments: FACE_PLATE.segments, rise: FACE_PLATE.rise, chamfer: FACE_PLATE.chamfer, chamferFrac: FACE_PLATE.chamferFrac, inset: FACE_PLATE.inset, sign: 1 }],
      ['cap', { halfW: HEAD_CAP.halfW, halfH: HEAD_CAP.halfH, y: HEAD_CAP.y, n: HEAD_CAP.n, segments: HEAD_CAP.segments, rise: HEAD_CAP.rise, chamfer: HEAD_CAP.chamfer, chamferFrac: HEAD_CAP.chamferFrac, inset: HEAD_CAP.inset, sign: -1 }],
    ] as const) {
      const outerShape = superellipsoidOffset(HEAD_SHELL, opts.rise)
      const chamferShape = superellipsoidOffset(HEAD_SHELL, opts.rise - opts.chamfer)
      const innerShape = superellipsoidOffset(HEAD_SHELL, -opts.inset)
      for (const p of superellipsePoints(opts.halfW, opts.halfH, opts.n, opts.segments)) {
        const lastOuter = 1 - opts.chamferFrac
        const zOuter = superellipsoidZ(p.x * lastOuter, opts.y + p.y * lastOuter, outerShape)
        const zChamfer = superellipsoidZ(p.x, opts.y + p.y, chamferShape)
        const zInner = superellipsoidZ(p.x, opts.y + p.y, innerShape)
        // Chamfer behind the outer surface, rim wall behind the chamfer, both by a
        // real margin rather than by a rounding error.
        expect(zChamfer, `${name} chamfer`).toBeLessThan(zOuter)
        expect(zChamfer - zInner, `${name} rim wall height`).toBeGreaterThan(0.01)
      }
    }
  })

  it('refuses parameters that would fold the panel through its host', () => {
    const base = {
      host: HEAD_SHELL,
      outline: plateOutline(),
      halfW: FACE_PLATE.a,
      halfH: FACE_PLATE.b,
      centreY: FACE_PLATE.y,
      facing: 1 as const,
      inset: 0.016,
      rise: 0.012,
      chamfer: 0.006,
      chamferFrac: 0.045,
      rings: 6,
      solid: true,
    }
    expect(() => superellipsoidPatch({ ...base, rise: 0 })).toThrow(/positive rise/)
    expect(() => superellipsoidPatch({ ...base, inset: 0 })).toThrow(/positive inset/)
    expect(() => superellipsoidPatch({ ...base, chamfer: 0.012 })).toThrow(/fold back/)
    expect(() => superellipsoidPatch({ ...base, chamferFrac: 0.6 })).toThrow(/chamfer fraction/)
    expect(() => superellipsoidPatch({ ...base, rings: 0 })).toThrow(/at least 1 ring/)
  })
})

describe('the copper cap on the back of the head', () => {
  /*
    The cap is a patch now, so "stands proud" is settled by the generator and proved
    over every vertex in the block above. What is left here is the two neighbours it
    has to stay away from, which are placement questions rather than shape questions.
  */
  const capOutline = () =>
    superellipsePoints(HEAD_CAP.halfW, HEAD_CAP.halfH, HEAD_CAP.n, HEAD_CAP.segments)

  it('stays inside the head`s own width, so the pods remain the widest thing', () => {
    expect(HEAD_CAP.halfW).toBeLessThan(HEAD_SHELL.width / 2)
  })

  /*
    The defect the deleted `Helmet` had and this must never repeat: it sealed the
    antenna inside itself, so the one warm light on the character rendered into the
    inside of a hat. The antenna's root is at head-local (0.200, 0.225, -0.040) and
    the cap is on the -z side, so the test is whether the footprint reaches that
    column at all.
  */
  it('cannot enclose the antenna', () => {
    // The squircle's own height at the antenna's x, which is where the cap's rim
    // sits above it. `REST.antennaBase.z` is -0.040 and the cap's rim at that x is
    // the first thing that could get near it.
    const t = Math.abs(REST.antennaBase.x) / HEAD_CAP.halfW
    expect(t).toBeLessThan(1)
    const capTopAtAntennaX =
      HEAD_CAP.y + HEAD_CAP.halfH * Math.pow(1 - Math.pow(t, HEAD_CAP.n), 1 / HEAD_CAP.n)
    expect(capTopAtAntennaX).toBeLessThan(REST.antennaBase.y)
  })

  /*
    Does not reach the ear pods, tested against the cap's real footprint rather than
    against a bounding extent. The bounding-box version of this question is the one
    that is easy to ask and it gives the wrong answer in both directions: it would
    also have passed `Helmet`, whose sphere overlapped nothing it was not supposed
    to.

    Both parts live on the same host, so a pod point and a cap point can only meet if
    their footprints overlap in the head's own (x, y) projection AND the cap's z
    reaches the pod's. The cap is entirely on the -z side and the pod's rim reaches
    z -0.125, so the honest test is the x one: the cap's footprint must not reach the
    pod's inner face.
  */
  it('narrows away from the pods before it gets near them', () => {
    const podInnerX = Math.abs(REST.earPodL.x) - EAR_POD_SHAPE.halfThickness
    let widest = 0
    for (const p of capOutline()) widest = Math.max(widest, Math.abs(p.x))
    expect(widest).toBeLessThan(podInnerX)
  })

  /*
    And the same claim measured on the surface, which is the version that is actually
    about the two shapes: every point on the pod's rim has to be further out in x
    than the cap's own footprint ever reaches.
  */
  it('does not intersect the ear pods', () => {
    const podZFront = REST.earPodL.z + EAR_POD_SHAPE.radius * EAR_POD_SHAPE.depthScale
    let capZNearest = -Infinity
    for (const p of capOutline()) {
      const z = superellipsoidZ(p.x, HEAD_CAP.y + p.y, superellipsoidOffset(HEAD_SHELL, HEAD_CAP.rise))
      capZNearest = Math.max(capZNearest, -z)
    }
    // The cap's frontmost surface is still well behind the pod's frontmost rim, so
    // even where their x ranges are closest they are separated in z.
    expect(capZNearest).toBeLessThan(podZFront)
  })
})

describe('the blue oval under each sole', () => {
  /*
    The boot is a filleted truncated cone now, so its bottom face is flat only inside
    where the sole fillet begins. A pad wider than that straddles the rim round and
    leaves a crescent gap between itself and the sole, which is the same artefact both
    critique reviewers read as "there is a hole in the character`s face" when the ear
    pods did it.

    These two came off `FOOT` and were `0.32 / 2 - 0.065` and `0.44 / 2 - 0.065` written
    out by hand once, then `FOOT.width / 2 - FOOT.radius`. Neither expression can be
    written for a cone at all: the fillet sits on a SLANTED rim, so it eats
    `fillet * tan(45 - alpha/2)` of radius rather than `fillet`, and the hand-written
    form would have overstated the flat by 3 mm on a clearance of 15. So the region comes
    from `footSoleFlat()`, which the shipped geometry goes through too.

    The whole block is about a light that has been invisible once and within 2.3 mm of it
    twice, so the derivation is checked against the built mesh below rather than trusted.
  */
  const flatX = footSoleFlat().x
  const flatZ = footSoleFlat().z

  /*
    First, that `footSoleFlat()` describes the mesh that actually ships. The helper is
    trigonometry and the mesh is a lathe of a sampled arc; if the two disagree then every
    clearance below is measured against a shape nobody built.
  */
  it('is measured against the sole the mesh really has', () => {
    const pos = bootGeometry().getAttribute('position')
    const bottom = bootBounds().minY
    let maxX = 0
    let maxZ = 0
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - bottom) > 1e-9) continue
      maxX = Math.max(maxX, Math.abs(pos.getX(i)))
      maxZ = Math.max(maxZ, Math.abs(pos.getZ(i)))
    }
    /*
      To 7 places and not 9, and the reason is the buffer rather than the arithmetic.
      `Float32BufferAttribute` stores single precision, so a coordinate around 0.05 comes
      back with about 2e-9 of quantisation. Asserting to 9 places here would be asserting
      that three.js uses doubles, which it does not, and the failure would look like a
      geometry bug. 7 places is 5e-8: tight enough that a real 3 mm fillet error cannot
      hide in it, loose enough to be about the shape rather than the storage.
    */
    expect(maxX).toBeCloseTo(flatX, 7)
    expect(maxZ).toBeCloseTo(flatZ, 7)
  })

  it('lands entirely on the flat part of the sole', () => {
    expect(SOLE_LIGHT.radius).toBeLessThan(flatX)
    expect(SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ).toBeLessThan(flatZ)
    // With real margin rather than by a thousandth.
    expect(flatX - SOLE_LIGHT.radius).toBeGreaterThan(0.005)
    expect(flatZ - SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ).toBeGreaterThan(0.005)
  })

  /*
    THE THING A NARROWER BOOT BREAKS, restated against the boot that now ships.

    This used to assert a counterfactual about a box two shapes ago: that a cone at the
    box's 0.140 of width could not have carried the pad. Both terms have since moved -
    the boot is 30% narrower on art direction and the pad was re-sized with it - so the
    old counterfactual now passes for reasons that have nothing to do with the defect,
    which is the failure mode of pinning a test to history instead of to a rule.

    The live form is the one that guards the actual mistake: narrowing the boot WITHOUT
    re-sizing the pad. The previous pad was 0.033 and the sole flat is now 0.0334 in x,
    so it would have overhung its own sole in x by all but 0.4 mm and in z outright.
  */
  it('would not have fitted the pad the boot used to carry', () => {
    const previousPadRadius = 0.033
    expect(flatX - previousPadRadius).toBeLessThan(0.005)
    expect(flatZ).toBeLessThan(previousPadRadius * SOLE_LIGHT.stretchZ)
    // And the pad as shipped clears it on both axes, which is the point of the change.
    expect(flatZ).toBeGreaterThan(SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ)
  })

  /*
    And the pad still reads as an oval of useful SIZE relative to the sole it is on,
    which is the thing shrinking its radius could quietly have destroyed. It covers
    82% of the flat width and 75% of the flat depth, so it is a sole light rather than
    a dot in the middle of a boot.
  */
  it('still fills the sole it sits on', () => {
    expect(SOLE_LIGHT.radius / flatX).toBeGreaterThan(0.6)
    expect((SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ) / flatZ).toBeGreaterThan(0.6)
  })

  it('is an oval along the foot rather than a circle', () => {
    expect(SOLE_LIGHT.stretchZ).toBeGreaterThan(1.2)
  })

  /*
    THE REGRESSION THIS BLOCK EXISTS FOR, and it is one this stream committed
    itself before catching it.

    The first version of the pad sat 0.001 ABOVE the sole plane, to avoid z-fighting
    with the ground. The foot is a SOLID `RoundedBox` spanning y -0.085 to 0.085, so
    that put the pad from -0.084 to -0.072 - entirely inside opaque rubber, visible
    from nowhere, at no time. The test that shipped with it asserted
    `0 < lift < 0.005`, which is precisely the range that buries it: it pinned the
    defect instead of catching it.

    A recess only reads if something is cut out of the housing, and nothing here
    cuts. So the pad must break the foot's own surface, and that is what is asserted
    now - against the foot's real extent rather than against a tolerance.

    `soleY` reads `FOOT.height` rather than the -0.17/2 it had. The component's own
    position expression had the same 0.085 hardcoded in it, so shrinking the boot to
    0.13 without touching either would have left the pad floating 0.020 clear of the
    sole: the identical defect approached from the opposite side, and this test would
    have passed through it.
  */
  it('protrudes through the sole rather than being buried inside the foot', () => {
    // The BUILT boot's lowest surface, not a computed sole plane. The cone is a lathe now
    // and nothing guarantees its extent equals `-FOOT.height / 2` except measuring it.
    const soleY = bootBounds().minY
    // 7 places, because the position buffer is Float32. See the sole-flat test above.
    expect(soleY).toBeCloseTo(-FOOT.height / 2, 7)
    const padBottom = -FOOT.height / 2 - SOLE_LIGHT.proud
    const padTop = padBottom + SOLE_LIGHT.thickness
    // Below the foot's own surface, so it can be seen at all.
    expect(padBottom).toBeLessThan(soleY)
    expect(SOLE_LIGHT.proud).toBeGreaterThan(0.002)
    // And still buried enough to read as moulded into the foot rather than stuck on.
    expect(padTop).toBeGreaterThan(soleY)
    expect(padTop - soleY).toBeGreaterThan(0.004)
    // Not so proud that it becomes a stilt the character stands on.
    expect(SOLE_LIGHT.proud).toBeLessThan(0.01)
  })

  /*
    And the buried PART of the pad is inside the cone at every height it occupies, which
    is a new question the taper introduces. The box had vertical walls, so a pad that fit
    the sole fit everywhere above it; a cone that narrows downward is at its TIGHTEST at
    the sole, so this direction is safe here - but it is asserted rather than reasoned,
    because the same argument run on a cone the other way up would be false.
  */
  it('stays inside the boot walls over the whole depth it is buried', () => {
    const prof = bootSilhouette()
    const padBottom = -FOOT.height / 2 - SOLE_LIGHT.proud
    const padTop = padBottom + SOLE_LIGHT.thickness
    for (const p of prof) {
      if (p.y < padBottom || p.y > padTop) continue
      expect(p.x).toBeGreaterThan(SOLE_LIGHT.radius)
      expect(p.x * FOOT.depthScale).toBeGreaterThan(SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ)
    }
  })
})

describe('the band and bevel on the upper arm', () => {
  /*
    The capsule has radius 0.075 and a cylindrical section of 0.09 centred at
    shoulder-local y -0.13, so it is at FULL radius only between -0.175 and
    -0.085. A fixed-radius ring outside that band stands proud by a growing amount
    and reads as a collar floating off the arm: at the capsule`s shoulder end the
    radius has fallen to 0.063, where the band would stand 0.019 proud instead of
    0.007.
  */
  const fullRadiusLow = -0.175
  const fullRadiusHigh = -0.085

  it('sits where the capsule is at its full radius', () => {
    for (const ring of [ARM_BAND, ARM_BEVEL]) {
      expect(ring.y).toBeGreaterThanOrEqual(fullRadiusLow)
      expect(ring.y).toBeLessThanOrEqual(fullRadiusHigh)
      // And the ring`s own thickness stays inside it too, or one rim hangs off
      // the curve while the other does not.
      expect(ring.y - ring.halfThickness).toBeGreaterThanOrEqual(fullRadiusLow - 1e-9)
      expect(ring.y + ring.halfThickness).toBeLessThanOrEqual(fullRadiusHigh + 1e-9)
    }
  })

  it('stands proud of the capsule enough to read as a band', () => {
    expect(ARM_BAND.radius - 0.075).toBeGreaterThan(0.004)
    // The bevel is deliberately less proud than the band, so the two read as
    // different parts rather than as two bands.
    expect(ARM_BEVEL.radius).toBeLessThan(ARM_BAND.radius)
    expect(ARM_BEVEL.halfThickness).toBeLessThan(ARM_BAND.halfThickness)
  })

  it('lathes into a non-empty solid', () => {
    for (const ring of [ARM_BAND, ARM_BEVEL]) {
      const g = latheProfile({
        points: roundedDiscProfile(
          ring.radius,
          ring.halfThickness,
          ring.fillet,
          ring.filletSteps,
        ),
        radialSegments: ring.radialSegments,
      })
      g.computeBoundingBox()
      const pos = g.getAttribute('position')
      expect(pos.count).toBeGreaterThan(50)
      for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true)
      expect(g.boundingBox!.max.x).toBeCloseTo(ring.radius, 6)
      expect(g.boundingBox!.max.y).toBeCloseTo(ring.halfThickness, 6)
    }
  })
})

describe('the circular port on the back of the pack', () => {
  const { port } = BACKPACK_BLOCK
  // A RoundedBox is flat only away from its corner rounds.
  const flatX = BACKPACK_BLOCK.width / 2 - BACKPACK_BLOCK.radius
  const flatY = BACKPACK_BLOCK.height / 2 - BACKPACK_BLOCK.radius
  const rearFace = -BACKPACK_BLOCK.depth / 2

  it('fits entirely on the flat part of the rear face', () => {
    expect(port.bezelRadius).toBeLessThan(flatX)
    expect(port.bezelRadius).toBeLessThan(flatY)
    expect(flatY - port.bezelRadius).toBeGreaterThan(0.005)
  })

  it('nests three rings, largest first', () => {
    expect(port.bezelRadius).toBeGreaterThan(port.wellRadius)
    expect(port.wellRadius).toBeGreaterThan(port.coreRadius)
  })

  /*
    THE OTHER REGRESSION THIS STREAM COMMITTED AND THEN CAUGHT.

    The first version put the bezel proudest with the well and core nested 0.002
    behind it, which is what "a lit pip inside a recess" sounds like it wants. But
    `cylinderGeometry` builds a SOLID disc, not a ring, so a 0.050 well and a 0.030
    core both inside the bezel's radius and inside its z span were completely
    enclosed by it: the whole port rendered as one plain copper disc. The test that
    shipped with it asserted `bezelFront < coreFront < wellFront`, which is exactly
    the nesting that hides them - the second test in this diff to pin a defect rather
    than catch it, and the same mistake as the sole pad in a different axis.

    Concentric rings out of solid discs come from stacking OUTWARD. Each disc is
    smaller than the one behind it and stands slightly proud of it, so what stays
    visible of each is the annulus its successor does not cover.
  */
  it('stacks the three discs outward so each leaves an annulus visible', () => {
    const front = (z: number, d: number) => z - d / 2
    const back = (z: number, d: number) => z + d / 2
    const bezelF = front(port.bezelZ, port.bezelDepth)
    const wellF = front(port.wellZ, port.wellDepth)
    const coreF = front(port.coreZ, port.coreDepth)

    // Every ring breaks the pack's surface.
    for (const f of [bezelF, wellF, coreF]) expect(f).toBeLessThan(rearFace)

    // Each is strictly PROUD of the one behind it, or it is invisible.
    expect(wellF).toBeLessThan(bezelF)
    expect(coreF).toBeLessThan(wellF)
    expect(bezelF - wellF).toBeGreaterThan(0.002)
    expect(wellF - coreF).toBeGreaterThan(0.002)

    // And each is still ANCHORED behind its predecessor's front face, so the stack
    // reads as one moulded boss rather than as three floating coins.
    expect(back(port.wellZ, port.wellDepth)).toBeGreaterThan(bezelF)
    expect(back(port.coreZ, port.coreDepth)).toBeGreaterThan(wellF)
    // The bezel itself is anchored in the pack.
    expect(back(port.bezelZ, port.bezelDepth)).toBeGreaterThan(rearFace)
  })

  /*
    The clearance the port MOVED, and the reason `CAPE_PANEL.z` changed with it.

    The cape`s 0.010 of clearance was measured against the pack`s flat rear face at
    -0.070. This port stands 0.012 proud of that face, so at the old
    `CAPE_PANEL.z` of -0.095 the cape`s front face at -0.080 sat 0.002 INSIDE the
    bezel. Two solid parts two millimetres inside each other renders perfectly and
    casts a clean shadow.

    The port is now the binding constraint rather than the pack, so that is what is
    asserted. The pack`s own face is still cleared, by more than it was.
  */
  it('leaves the cape clear of it, since the cape hangs off this face', () => {
    const capeFront = CAPE_PANEL.z + CAPE_PANEL.thickness / 2
    // The CORE is the outermost ring now that the stack runs outward, so it is the
    // one the cape has to clear rather than the bezel.
    const portFront = port.coreZ - port.coreDepth / 2
    expect(capeFront).toBeLessThan(portFront)
    expect(portFront - capeFront).toBeGreaterThan(0.008)
    expect(capeFront).toBeLessThan(rearFace)
  })
})

/*
  The three blocks below cover `.critique/round1-findings.md` F4 and F12.

  Both of those defects are pure arithmetic between two parts, and both of them
  rendered a clean frame with a healthy triangle count while being wrong: an ear
  pod buried in the head still draws its rim, and a cape panel growing out of the
  middle of the backpack still draws a panel. Neither is visible in a counter and
  neither errors, so the relationships get asserted here instead.
*/

describe('the ear pods stand proud of the head', () => {
  const socketX = Math.abs(REST.earPodL.x)
  const outer = socketX + EAR_POD_SHAPE.halfThickness

  /*
    This test used to read "reaches the outer extent the width ladder is built on"
    and pinned `outer` to 0.485 and `outer * 2` to 0.97, quoting
    `05-character-vfx.md`: "the head's total width including pods is 0.97 m. That is
    deliberately the widest thing on the character."

    Both halves of that were wrong. The pods never were the widest thing - the
    mittens reach 0.524 at rest for a span of 1.048, which the block at the bottom of
    this file has been asserting all along, so the file contained the contradiction.
    And a ladder rung nothing else depends on is not a constraint; it is a number
    being kept warm.

    What is a constraint is the pods' clearance off the cheek, which is what the
    "reduce its extrusion by 66%" note is about and what the test below now pins.
  */
  it('stands off the cheek by the reduced extrusion the note asked for', () => {
    const cheekX = superellipsoidX(REST.earPodL.y, REST.earPodL.z, HEAD_SHELL)
    // 0.125 was the shipped clearance; 66% off it is 0.0425.
    expect(outer - cheekX).toBeCloseTo(0.0425, 2)
    // Still positive by a real margin, or the pod is a decal on the cheek.
    expect(outer - cheekX).toBeGreaterThan(0.03)
  })

  /*
    The pod's burial, measured against the curved cheek rather than against a flat
    box side.

    On the `RoundedBox` head this was one subtraction, because the pod sat on a face
    at a constant x 0.360. The helmet now curves away under the pod's rim, so the
    burial varies around it and the question becomes whether the SHALLOWEST point on
    the rim is still inside the shell. If any of it is not, the pod has a crescent
    gap between its rim and the cheek, which is the exact artefact both round 1
    reviewers read as "there is a hole in the character's face".

    Measured: 0.0707 to 0.0819 all the way round, and the socket moving inboard to
    0.340 is what keeps it that deep while the pod itself got thinner. The rim now
    sweeps an ELLIPSE rather than a circle, 0.105 in y by 0.042 in z, so the loop
    below walks the ellipse and not a circle - walking a circle of radius 0.105 would
    sample points in z where the pod has no material and report a burial the part does
    not have.

    ## The condition is against the FILLET, not against zero

    This is the part the burial number alone gets wrong, and the fillet growing from
    0.030 to 0.055 is what exposed it. The pod is only at its full 0.105 radius over
    `|x - socket| <= halfThickness - fillet`, so its widest section starts at
    `innerFace + fillet` and not at `innerFace`. For the rim to cross the cheek
    cleanly all the way round rather than emerging and re-entering, the head's surface
    has to be beyond that: 0.055 against a shallowest 0.0727, so the pod's widest
    circle begins 0.0177 inside the shell. Below that the pod's rounded shoulder,
    rather than its rim, would be what meets the head, and it would leave a crescent
    of the shoulder standing free - which is the same artefact by a third route.
  */
  it('buries its whole rim in the shell, so it cannot float free of the head', () => {
    const innerFace = socketX - EAR_POD_SHAPE.halfThickness
    let shallowest = Infinity
    for (let i = 0; i < 256; i++) {
      const th = (i / 256) * Math.PI * 2
      const y = REST.earPodL.y + EAR_POD_SHAPE.radius * Math.sin(th)
      const z = REST.earPodL.z + EAR_POD_SHAPE.radius * EAR_POD_SHAPE.depthScale * Math.cos(th)
      const surfaceX = superellipsoidX(y, z, HEAD_SHELL)
      expect(Number.isFinite(surfaceX)).toBe(true)
      shallowest = Math.min(shallowest, surfaceX - innerFace)
    }
    expect(shallowest).toBeCloseTo(0.0707, 3)
    // The full-radius section has to START inside the shell, everywhere round the rim.
    expect(shallowest).toBeGreaterThan(EAR_POD_SHAPE.fillet)
    // And the pod must not be so deep that its far face pokes out the other cheek.
    expect(shallowest).toBeLessThan(2 * superellipsoidX(0, REST.earPodL.z, HEAD_SHELL))
  })

  /*
    The regression this file exists to prevent, restated for a pod that is now
    deliberately shallow.

    The original defect was a pod at half-thickness 0.040 whose `outer` was 0.420
    against a cheek at 0.360: five sixths buried, and the only thing on screen a
    0.06 m crescent of its own rim seen almost end on, which two reviewers read as a
    gouge. The old guard was "more than 0.10 of protrusion", and the 66% note has
    deliberately spent that margin down to 0.0421.

    So the guard moves to what actually distinguishes a shallow pod from a gouge,
    which is not how far it stands out but whether its rim is CONTINUOUSLY outside the
    shell all the way round. A crescent appears when part of the rim is proud and part
    of it is not. This walks the rim ellipse and requires every point of it to clear
    the cheek, which the 0.040 pod would have failed and this one passes with the
    protrusion varying only between 0.0421 and 0.0533.
  */
  it('keeps its whole rim proud of the cheek, so no crescent can open', () => {
    let least = Infinity
    let most = -Infinity
    for (let i = 0; i < 256; i++) {
      const th = (i / 256) * Math.PI * 2
      const y = REST.earPodL.y + EAR_POD_SHAPE.radius * Math.sin(th)
      const z = REST.earPodL.z + EAR_POD_SHAPE.radius * EAR_POD_SHAPE.depthScale * Math.cos(th)
      const proud = outer - superellipsoidX(y, z, HEAD_SHELL)
      least = Math.min(least, proud)
      most = Math.max(most, proud)
    }
    expect(least).toBeGreaterThan(0.02)
    expect(least).toBeCloseTo(0.0421, 3)
    expect(most).toBeCloseTo(0.0533, 3)
    // Nearly uniform round the rim, which is what stops it reading as a crescent.
    expect(most - least).toBeLessThan(0.02)
  })

  /*
    Why the pods still will not break the head's outline in profile, which is the
    honest limit on the user's third note.

    Seen from the side the pod's end cap projects to a disc of radius 0.105 about
    head-local (y 0, z -0.02), and the head's profile silhouette is 0.54 by 0.62. The
    disc is inside it by 0.165 in y and 0.185 in z, so no shading and no material can
    make the ears part of the outline from that angle. Recorded as a test rather than
    as a comment because it is the reason the fix is a winding fix plus a fillet
    rather than a placement change, and because the next person to read the note will
    reach for the placement.
  */
  it('cannot break the head`s profile outline, which is why the fix is shading', () => {
    expect(EAR_POD_SHAPE.radius).toBeLessThan(HEAD_SHELL.b)
    expect(Math.abs(REST.earPodL.y) + EAR_POD_SHAPE.radius).toBeLessThan(HEAD_SHELL.b - 0.1)
    // z uses the SQUASHED radius, because that is the pod's real reach fore and aft.
    // The narrowing pulls it a further 0.063 inside the outline, so the note that
    // narrowed the ears also moved them further from ever breaking this silhouette.
    const podZ = EAR_POD_SHAPE.radius * EAR_POD_SHAPE.depthScale
    expect(Math.abs(REST.earPodL.z) + podZ).toBeLessThan(HEAD_SHELL.c - 0.1)
  })

  /*
    The fillet is the pod's only bright line in profile, since its outer face is a
    single normal pointing at the camera and goes dark whenever the key does not. At
    0.030 on a 0.21 object it was barely over a pixel at playing distance.
  */
  it('carries a fillet big enough to read at playing distance', () => {
    expect(EAR_POD_SHAPE.fillet).toBeGreaterThan(0.04)
    expect(EAR_POD_SHAPE.fillet).toBeLessThan(EAR_POD_SHAPE.radius)
    expect(EAR_POD_SHAPE.fillet).toBeLessThan(EAR_POD_SHAPE.halfThickness)
  })

  it('is mirrored, which is half of what the critique said it was missing', () => {
    expect(REST.earPodL.x).toBeCloseTo(-REST.earPodR.x, 12)
    expect(REST.earPodL.y).toBe(REST.earPodR.y)
    expect(REST.earPodL.z).toBe(REST.earPodR.z)
  })

  /*
    Builds the pod exactly as `robotParts.tsx` does and checks it is a solid of the
    right size. A generator that returns an empty buffer is this codebase's signature
    failure: the mesh vanishes, the frame looks clean and the counters stay healthy.

    The winding, which every one of these extent checks was blind to, is asserted in
    "the lathed parts are wound outward".
  */
  it('lathes into a non-empty solid of the right extent', () => {
    const g = earPodGeometry()
    g.computeBoundingBox()
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(100)
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true)

    const box = g.boundingBox!
    expect(box.max.x).toBeCloseTo(EAR_POD_SHAPE.halfThickness, 6)
    expect(box.max.y).toBeCloseTo(EAR_POD_SHAPE.radius, 6)
    expect(box.max.z).toBeCloseTo(EAR_POD_SHAPE.radius * EAR_POD_SHAPE.depthScale, 6)
    // Absolute, so the fin's actual dimensions are on the record and not only its
    // ratios: 0.124 of extrusion, 0.210 of height, 0.084 of depth.
    expect(box.max.x * 2).toBeCloseTo(0.124, 6)
    expect(box.max.y * 2).toBeCloseTo(0.21, 6)
    expect(box.max.z * 2).toBeCloseTo(0.084, 6)
  })
})

/*
  The antenna's ROOT, which nobody had ever measured.

  Every measurement anyone took of the antenna was about the deleted `Helmet`
  swallowing its BULB - `HEAD_CAP`'s comment carries three paragraphs of it, and a
  test above asserts the cap cannot repeat it. Nobody asked whether the other end
  reached the head, and it did not: `REST.antennaBase.y` was 0.310 against a
  `RoundedBox` crown at 0.270, so the character's one asymmetric feature had 0.040 m
  of clear air under it.
*/
describe('the antenna is attached to the head', () => {
  /*
    `AntennaLower` puts a 0.09 m cylinder at the node's `+0.045`, so the cylinder's
    bottom face is exactly at the node's own y. Anything at or above the crown is a
    floating antenna.
  */
  const ANTENNA_RADIUS = 0.015

  it('sinks the lower segment`s base into the shell', () => {
    const crown = superellipsoidY(REST.antennaBase.x, REST.antennaBase.z, HEAD_SHELL)
    expect(Number.isFinite(crown)).toBe(true)
    expect(REST.antennaBase.y).toBeLessThan(crown)
    expect(crown - REST.antennaBase.y).toBeCloseTo(0.0218, 3)
  })

  /*
    And it stays attached through the whip, which is what decides how deep the burial
    has to be. This node ROTATES: `robotPose.ts` clamps the antenna spring so it
    whips to nearly 30 degrees, and the base disc tilts with it, dropping its lowest
    rim point by `radius * sin(theta)`.

    Asserted against the full radius rather than against `sin(30 deg)`, so the margin
    holds for any angle the springs could ever be retuned to reach. That is the
    difference between a test that pins today's tuning and one that pins the
    relationship.
  */
  it('stays attached at any whip angle the springs can reach', () => {
    const crown = superellipsoidY(REST.antennaBase.x, REST.antennaBase.z, HEAD_SHELL)
    expect(crown - REST.antennaBase.y).toBeGreaterThan(ANTENNA_RADIUS)
  })

  /*
    The emissive bulb still has to be in open air, which is the `Helmet` defect from
    the other direction. Its top is at the base plus 0.085 for `antennaMid`, plus
    0.075 for the bulb's own offset, plus its 0.05 radius.
  */
  it('keeps the bulb clear of the shell and of the copper cap', () => {
    const bulbTop = REST.antennaBase.y + REST.antennaMid.y + 0.075 + 0.05
    expect(bulbTop).toBeGreaterThan(HEAD_SHELL.b)
    expect(superellipsoidField(REST.antennaBase.x, bulbTop, REST.antennaBase.z, HEAD_SHELL))
      .toBeGreaterThan(1)
    // World height, which `robotPose.ts` quotes as "reaches 1.53 m".
    expect(1.09 + bulbTop).toBeCloseTo(1.525, 6)
  })
})

/*
  The hips.

  The user's note is "his hips look odd and bubbly", and the brief for this pass
  suspected `RoundedBoxGeometry` was silently clamping the corner radius. It was not.
  The clamp is half the smallest dimension, 0.28 / 2 = 0.14, and the radius was 0.13,
  so it was honoured exactly - which is the problem rather than the reprieve.
*/
describe('the diaper is a cushion and not a pillow', () => {
  const diaper = () => taperedSuperellipsoid(DIAPER)

  /*
    The measurement that says "bubbly". 0.13 against a half-height of 0.14 leaves
    0.020 of flat top, 7.1% of the height, so the box was fully rounded in y and its
    front outline was a 0.62 by 0.28 stadium. Kept as a test so the number is on
    record rather than in a comment: it is the whole diagnosis.
  */
  it('records the flat fraction the box it replaces had', () => {
    const boxHalfHeight = 0.14
    const boxRadius = 0.13
    expect(boxRadius).toBeLessThanOrEqual(boxHalfHeight)
    expect((2 * (boxHalfHeight - boxRadius)) / (2 * boxHalfHeight)).toBeCloseTo(0.0714, 3)
  })

  /*
    The hips no longer OWN `PROPORTIONS.torsoWidthMax` and that is the change.

    This test asserted the diaper's width against `torsoWidthMax` because the diaper
    was the widest band below the neck at 0.62 while the torso measured 0.578. With the
    torso's taper inverted the ordering reverses: the torso is 0.580 and the diaper
    narrows to 0.496. So the assertion becomes the ordering itself, which is the thing
    the "one flowing torso" note is actually about, plus the built dimensions pinned so
    an edit to `a`, `b`, `c` or `taperTop` has to come and look at them.

    Measured on the built geometry, because `a` is 0.240 rather than 0.2478: the taper
    multiplies every latitude including the equator, so the solid's widest half-width is
    `a * max(taper * rim)`, which is a numeric maximum and not a closed form. A comment
    claiming the factor would be exactly the kind of thing this file keeps finding
    wrong.
  */
  it('is narrower than the torso above it, which is what makes it one unit', () => {
    const box = diaper().boundingBox!
    const torsoBox = taperedSuperellipsoid(TORSO).boundingBox!
    expect(box.max.x).toBeLessThan(torsoBox.max.x)
    // The torso is now the widest band below the neck, so it is the one that has to
    // match what `PROPORTIONS` publishes.
    expect(torsoBox.max.x * 2).toBeCloseTo(PROPORTIONS.torsoWidthMax, 3)
    // Built dimensions, pinned.
    expect(box.max.x - box.min.x).toBeCloseTo(0.496, 3)
    expect(box.max.z - box.min.z).toBeCloseTo(0.416, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(0.31, 3)
  })

  /*
    The note is "the current waist unit to become narrowed by 50%", and the literal
    value detaches both legs from the body. This records the measurement so the
    decision is auditable rather than a remembered judgement.

    There is no thigh mesh on this character - `Leg` in `RobotModel.tsx` is a bare node,
    then the knee, and the shin capsule is the first geometry - so this garment is the
    entire pelvis and the only thing covering the top of each leg. At `a * 0.5` the
    solid's widest half-width is 0.1549 and at the shin's top it reaches 0.1065,
    against a leg axis at 0.19. The axis would be 0.0835 outside the garment and the
    shin's inner edge would clear it by 0.0015, which is a graze rather than an
    attachment.
  */
  it('records why the literal 50% narrowing was not shipped', () => {
    const half = taperedSuperellipsoid({ ...DIAPER, a: DIAPER.a * 0.5 })
    const pos = half.getAttribute('position')
    // Half-width at the shin's top, which is hips-local y -0.135.
    let atShinTop = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > -0.13) continue
      atShinTop = Math.max(atShinTop, Math.abs(pos.getX(i)))
    }
    const legAxis = Math.abs(REST.legL.x)
    expect(atShinTop).toBeLessThan(legAxis)
    expect(legAxis - atShinTop).toBeGreaterThan(0.05)
    // And what shipped instead does enclose it. Asserted properly below.
    expect(half.boundingBox!.max.x).toBeLessThan(legAxis)
  })

  /*
    The form change, which is the answer to "bubbly": widest at the hip line and
    tucking under toward the legs, so the legs emerge from a tuck rather than from the
    widest band. The box was widest at its exact middle and symmetric about it.
  */
  it('is widest above its own middle and tucks under below it', () => {
    /*
      Measured per latitude RING rather than by bucketing on a height, because
      `taperedSuperellipsoid` samples v uniformly and a low `e1` then clusters the rows
      toward the poles: there is no row within 6 mm of the widest band to bucket. The
      rings are what the generator actually emits, so they are what gets measured.
    */
    const pos = diaper().getAttribute('position')
    const rings = new Map<string, number>()
    for (let i = 0; i < pos.count; i++) {
      const key = pos.getY(i).toFixed(6)
      rings.set(key, Math.max(rings.get(key) ?? 0, Math.abs(pos.getX(i))))
    }
    const rows = [...rings.entries()]
      .map(([y, w]) => ({ y: Number(y), w }))
      .sort((p, q) => p.y - q.y)

    const widest = rows.reduce((m, r) => (r.w > m.w ? r : m), rows[0])
    // The box was widest at its exact middle and symmetric about it. This is widest
    // at the hip line, which is where the torso meets it.
    expect(widest.y).toBeGreaterThan(0.03)
    expect(widest.y).toBeLessThan(0.1)

    const at = (y: number) => rows.reduce((m, r) => (Math.abs(r.y - y) < Math.abs(m.y - y) ? r : m), rows[0])
    expect(at(0).w).toBeLessThan(widest.w)
    /*
      The tuck is now shallower than the 0.804 this asserted, and deliberately.

      `e1` went 0.50 to 0.35 because a squarer vertical section holds width nearer the
      poles, and that is exactly what lets `a` come down for the waist while the pelvis
      still reaches the legs. A hard tuck and a narrow waist are the same parameter
      pulling in opposite directions, and the legs win: the test below is the one with
      a defect behind it. So this checks there is still a real tuck rather than pinning
      how deep it is.
    */
    expect(at(-0.12).w / widest.w).toBeLessThan(0.96)
    expect(at(-0.145).w / widest.w).toBeLessThan(0.85)
  })

  /*
    THE LEG ATTACHMENT, and this test was passing over a real gap.

    It asserted that the garment reaches the shin's INNER edge at `|x| 0.105`. That is
    much too weak: 0.105 passes comfortably while the thing that matters, whether the
    garment encloses the leg's AXIS at 0.19, was failing. Measured on the shipped
    build, the diaper reached 0.1718 at the shin's top against an axis at 0.19, and
    covered the axis only down to world 0.3916 while the shin's top is at 0.3850 - so
    the top 6.6 mm of each shin was outside the garment with daylight between the
    underside of the hip and the top of the leg. There is no thigh mesh to hide it.
    `DIAPER.b` went 0.14 to 0.155 to fix it, and the assertion is now the strong one.

    `DIAPER.z` is not in this arithmetic because both parts are near z 0 at their
    closest and the overlap that matters is lateral.
  */
  it('encloses the leg axis at the top of the shin, so no leg floats free', () => {
    const pos = diaper().getAttribute('position')
    let w = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > -0.13) continue
      w = Math.max(w, Math.abs(pos.getX(i)))
    }
    const legAxis = Math.abs(REST.legL.x)
    expect(w).toBeGreaterThan(legAxis)
    // With margin, so the leg emerges from the garment rather than tangent to it.
    expect(w - legAxis).toBeGreaterThan(0.015)
    // The old, too-weak condition, kept so it is clear it was never the binding one.
    expect(w).toBeGreaterThan(legAxis - 0.085)
  })

  it('is a closed solid wound outward', () => {
    expect(signedVolume(diaper())).toBeGreaterThan(0)
  })
})

/*
  THE BOTTOM OF THE WAIST, TAKEN IN BY ANOTHER 25%, AND THE LEGS THAT MOVED WITH IT.

  "Bottom portion of his waist a bit more, by another 25%, and make sure his legs come in
  more to his narrowed waist."

  Two halves, and the second is what makes the first possible - which is exactly the trade
  the previous pass wrote down when it refused a literal 50% and recorded that going
  further "needs `REST.legL/R.x` to come inboard with it".

  These assertions are measured differently from the block above, and deliberately. The
  garment's coverage of the leg is not a half-width at one ring: it is the LOWEST height
  at which the surface still reaches the leg's axis, interpolated along the built mesh's
  own edges, at the world z the leg actually sits on. The previous defect - the top 6.6 mm
  of each shin outside the garment - survived because the test on record measured the
  shin's inner edge instead of its axis. A ring-quantised version of the right measurement
  is the same mistake one step smaller: the rings near the pole are 5.5 mm apart, which is
  the same order as the margin being defended.
*/
describe('the bottom of the waist, and the legs that came in with it', () => {
  const HIPS_Y = REST.hips.y
  const SHIN_RADIUS = 0.085
  const KNEE_Y = REST.hips.y + REST.legL.y + REST.kneeL.y
  const SHIN_TOP = KNEE_Y + SHIN_RADIUS + 0.05

  /** Half-width on +x at the world z the leg axis occupies, per built latitude ring. */
  const profileAtLegZ = (taperBot: number): { y: number; x: number }[] => {
    const geo = taperedSuperellipsoid({ ...DIAPER, taperBot })
    const pos = geo.getAttribute('position')
    const stride = DIAPER.lonSegments + 1
    // The mesh is mounted at `DIAPER.z`, so world z 0 is mesh-local -DIAPER.z.
    const localZ = -DIAPER.z
    const out: { y: number; x: number }[] = []
    for (let iv = 0; iv <= DIAPER.latSegments; iv++) {
      let best = -Infinity
      let y = 0
      for (let iu = 0; iu < stride - 1; iu++) {
        const i = iv * stride + iu
        const z0 = pos.getZ(i)
        const z1 = pos.getZ(i + 1)
        y = pos.getY(i)
        if (z0 === z1) continue
        const t = (localZ - z0) / (z1 - z0)
        if (t < 0 || t > 1) continue
        const x = pos.getX(i) + t * (pos.getX(i + 1) - pos.getX(i))
        if (x > best) best = x
      }
      if (best > -Infinity) out.push({ y: y + HIPS_Y, x: best })
    }
    return out.sort((a, b) => a.y - b.y)
  }

  /** How deep the shin's top is buried in the garment, in metres. Negative means a gap. */
  const burial = (taperBot: number, legX: number): number => {
    const prof = profileAtLegZ(taperBot)
    for (let i = 1; i < prof.length; i++) {
      if (prof[i].x >= legX && prof[i - 1].x < legX) {
        const t = (legX - prof[i - 1].x) / (prof[i].x - prof[i - 1].x)
        return SHIN_TOP - (prof[i - 1].y + t * (prof[i].y - prof[i - 1].y))
      }
    }
    return Number.NaN
  }

  /*
    THE POINT OF A SEPARATE DIAL, asserted rather than argued.

    `taperBot` must not move the equator, because two separately won numbers live there:
    the widest band of the whole silhouette, and the 0.0000 crossover with the torso that
    stops the waist reading as a detached unit. The alternative available with the
    existing parameters - `a * 0.75` with `taperTop / 0.75` - reproduces both poles and
    narrows the equator by 12% on the way through, which would have moved both.
  */
  it('narrows the bottom without moving the widest band at all', () => {
    /** The widest half-width of a build, and the mesh-local height it happens at. */
    const widest = (opts: Parameters<typeof taperedSuperellipsoid>[0]) => {
      const pos = taperedSuperellipsoid(opts).getAttribute('position')
      let x = 0
      let y = 0
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getX(i)) > x) {
          x = Math.abs(pos.getX(i))
          y = pos.getY(i)
        }
      }
      return { x, y }
    }
    /** Half-width at the equator specifically, which is where the torso crossover lives. */
    const atEquator = (opts: Parameters<typeof taperedSuperellipsoid>[0]) => {
      const pos = taperedSuperellipsoid(opts).getAttribute('position')
      let best = Infinity
      let x = 0
      for (let i = 0; i < pos.count; i++) {
        const d = Math.abs(pos.getY(i))
        if (d < best - 1e-9) { best = d; x = Math.abs(pos.getX(i)) }
        else if (Math.abs(d - best) < 1e-9) x = Math.max(x, Math.abs(pos.getX(i)))
      }
      return x
    }

    const base = { ...DIAPER, taperBot: 1 }
    expect(widest(DIAPER).x).toBeCloseTo(widest(base).x, 9)
    expect(widest(DIAPER).y).toBeCloseTo(widest(base).y, 9)
    expect(atEquator(DIAPER)).toBeCloseTo(atEquator(base), 9)

    /*
      And the route available without this dial really would have moved both, so the
      three assertions above are a property of `taperBot` rather than of the shape being
      insensitive to anything.

      `a * 0.75` with `taperTop / 0.75` reproduces the two POLES exactly and distorts
      everything between them: the equator comes in 12.1%, and because the steeper taper
      partly compensates as the rim falls, the widest band migrates UPWARD and its own
      value only drops 6.7%. So the profile is reshaped rather than narrowed, which is
      the opposite of what a note about the bottom of the waist asked for.
    */
    const viaA = { ...DIAPER, taperBot: 1, a: DIAPER.a * 0.75, taperTop: DIAPER.taperTop / 0.75 }
    expect(1 - atEquator(viaA) / atEquator(base)).toBeGreaterThan(0.1)
    expect(widest(viaA).y).toBeGreaterThan(widest(base).y + 0.005)
    expect(1 - widest(viaA).x / widest(base).x).toBeLessThan(0.1)
  })

  it('takes 25% off the bottom pole and nothing off the equator', () => {
    const base = profileAtLegZ(1)
    const cut = profileAtLegZ(DIAPER.taperBot)
    // The pole itself: the full 25%, within the ring sampling.
    expect(1 - cut[0].x / base[0].x).toBeGreaterThan(0.24)
    expect(1 - cut[0].x / base[0].x).toBeLessThan(0.26)
    // The equator, which is where world y equals the hips node: untouched.
    const eqIndex = base.reduce(
      (best, p, i) => (Math.abs(p.y - HIPS_Y) < Math.abs(base[best].y - HIPS_Y) ? i : best),
      0,
    )
    expect(cut[eqIndex].x).toBeCloseTo(base[eqIndex].x, 9)
    // And the narrowing is monotone in between rather than bulging back out.
    for (let i = 1; i <= eqIndex; i++) {
      expect(1 - cut[i].x / base[i].x).toBeLessThanOrEqual(1 - cut[i - 1].x / base[i - 1].x + 1e-9)
    }
  })

  /*
    THE ATTACHMENT, at the shipped leg position.

    The standard is the burial the previous pass shipped, 0.0115, and not mere
    non-negativity. The defect it replaced was -0.0066 and passed its test, so a bound of
    "greater than zero" here would be a bound that the known defect nearly satisfies.
  */
  it('still buries the top of each shin as deeply as the last pass did', () => {
    const depth = burial(DIAPER.taperBot, Math.abs(REST.legL.x))
    expect(depth).toBeGreaterThan(0.011)
    // Not so deep that the legs have been buried instead of narrowed - the garment's
    // bottom pole must stay above the shin's top or the crotch has swallowed the knee.
    expect(depth).toBeLessThan(0.03)
  })

  /*
    AND THE MEASUREMENT CAN FAIL, which is the part four shipped defects on this
    character did not have. If the legs had been left where they were, this pass would
    have reintroduced the exact gap the previous one fixed - slightly worse.
  */
  it('would have detached both legs if they had been left at +-0.19', () => {
    expect(burial(DIAPER.taperBot, 0.19)).toBeLessThan(0)
    // The previous defect measured -0.0066. This one would have been -0.0076.
    expect(burial(DIAPER.taperBot, 0.19)).toBeLessThan(-0.007)
    // A grazing contact is not good enough either, and 0.175 is where that happens.
    expect(burial(DIAPER.taperBot, 0.175)).toBeLessThan(0.001)
    // The old garment at the old legs is the baseline this matches.
    expect(burial(1, 0.19)).toBeCloseTo(0.0115, 3)
  })

  /*
    The legs came in, and the two floors that were checked rather than assumed. Neither
    binds, and saying which ones do not is how the next pass knows where the room is.
  */
  it('keeps the two shins clear of each other after coming inboard', () => {
    expect(Math.abs(REST.legL.x)).toBeLessThan(0.19)
    expect(Math.abs(REST.legL.x)).toBeGreaterThan(0.12)
    // Inner faces of the two shin capsules.
    const innerGap = 2 * (Math.abs(REST.legL.x) - SHIN_RADIUS)
    expect(innerGap).toBeGreaterThan(0.1)
  })
})

/*
  THE TORSO AND THE HIPS AS ONE FLOWING UNIT.

  The note is "the waist should look like it's part of the same unit as the chest... one
  flowing torso, starting wide at the shoulders and narrowed down by the waist", and it
  is a relationship between two meshes on two different rig nodes rather than a property
  of either one. So it is asserted here, on the visible SILHOUETTE, which is
  `max(torsoHalfWidth, diaperHalfWidth)` at each world height.

  The two meshes cannot be merged into one. `chest` and `hips` carry genuinely different
  motion - the gait's bob, shift, roll, lean and yaw are on `hips`, and
  `SPRINGS.chestYaw` is the torso's lag against them, a real waist twist - and one mesh
  on `chest` would twist the pelvis while the legs, which hang off `hips`, stayed put. So
  the unity has to be built in the profiles, and these are the three properties that
  make two solids read as one form.

  What shipped failed all three: the silhouette widened monotonically DOWNWARD from the
  shoulders, the diaper overtook the torso while rising as the torso fell, and the
  resulting crease at the waist is what "looks like a separate unit" was.
*/
describe('the torso and the hips read as one flowing unit', () => {
  /*
    Half-width per latitude ring, in WORLD y, off the built meshes. Rings rather than
    height buckets for the same reason the diaper block gives: the generator samples v
    uniformly and a low `e1` clusters rows toward the poles.
  */
  const ladder = (
    opts: Parameters<typeof taperedSuperellipsoid>[0],
    worldY: number,
  ): { y: number; hx: number }[] => {
    const pos = taperedSuperellipsoid(opts).getAttribute('position')
    const rings = new Map<string, number>()
    for (let i = 0; i < pos.count; i++) {
      const key = pos.getY(i).toFixed(6)
      rings.set(key, Math.max(rings.get(key) ?? 0, Math.abs(pos.getX(i))))
    }
    return [...rings.entries()]
      .map(([y, hx]) => ({ y: worldY + Number(y), hx }))
      .sort((a, b) => b.y - a.y)
  }
  // The spine, from `REST`, so a change to it comes through here.
  const chestY = REST.hips.y + REST.chest.y
  const hipsY = REST.hips.y
  const torsoLadder = () => ladder(TORSO, chestY)
  const diaperLadder = () => ladder(DIAPER, hipsY)
  /** Linear interpolation between rings, and 0 outside the solid's own span. */
  const at = (rows: { y: number; hx: number }[], y: number): number => {
    if (y > rows[0].y || y < rows[rows.length - 1].y) return 0
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].y >= y && y >= rows[i + 1].y) {
        const t = (y - rows[i + 1].y) / (rows[i].y - rows[i + 1].y || 1)
        return rows[i + 1].hx + t * (rows[i].hx - rows[i + 1].hx)
      }
    }
    return 0
  }

  it('is widest at the shoulders and not at the hips', () => {
    const T = torsoLadder()
    const D = diaperLadder()
    const widest = [...T, ...D].reduce((m, r) => (r.hx > m.hx ? r : m), T[0])
    // The widest band belongs to the torso, and sits above the chest's own centre.
    expect(widest.y).toBeGreaterThan(chestY)
    // Near the shoulder joint rather than up at the neck.
    expect(widest.y).toBeLessThan(REST.hips.y + REST.chest.y + REST.shoulderL.y + 0.02)
    // And it is the torso's, not the garment's.
    expect(at(T, widest.y)).toBeGreaterThan(at(D, widest.y))
  })

  /*
    The property that makes it "one flowing torso" rather than two stacked solids: from
    the widest band down to the pelvis the visible outline never grows again. A
    re-widening is a bulge, and a bulge below a narrowing is exactly what reads as a
    separate unit bolted on.

    The tolerance is 4 mm over a 5 mm step. What shipped re-widened by 0.0211 across the
    waist; this holds to 0.0011, which is one millimetre spread over 8 cm.
  */
  it('never re-widens below the shoulders, so there is no bulge at the waist', () => {
    const T = torsoLadder()
    const D = diaperLadder()
    const widest = [...T, ...D].reduce((m, r) => (r.hx > m.hx ? r : m), T[0])
    let prev = Infinity
    let worstRise = 0
    for (let y = widest.y; y >= hipsY - DIAPER.b + 0.015; y -= 0.005) {
      const visible = Math.max(at(T, y), at(D, y))
      // Skip the collapsing pole rings, which are not silhouette.
      if (visible < 0.05) continue
      worstRise = Math.max(worstRise, visible - prev)
      prev = visible
    }
    expect(worstRise).toBeLessThan(0.004)
  })

  /*
    And the two surfaces cross rather than step. Where the garment overtakes the torso
    their widths have to match, or the garment's edge stands proud as a lip and the
    junction reads as a seam between two parts.

    What shipped crossed with the diaper 0.0085 wider AND rising while the torso fell.
  */
  it('hands over from torso to garment with no step in width', () => {
    const T = torsoLadder()
    const D = diaperLadder()
    let crossover = 0
    for (let y = chestY; y >= hipsY; y -= 0.001) {
      if (at(D, y) > at(T, y) && at(T, y) > 0.05) {
        crossover = y
        break
      }
    }
    expect(crossover).toBeGreaterThan(0)
    expect(Math.abs(at(T, crossover) - at(D, crossover))).toBeLessThan(0.002)
    // The crossover happens at the waist, below the chest and above the leg line.
    expect(crossover).toBeLessThan(chestY)
    expect(crossover).toBeGreaterThan(hipsY)
  })

  /*
    The waist is narrower than the shoulders, which is the note's own description of the
    shape and the one thing the shipped build had backwards: it measured 2.9% WIDER at
    the waist than at the shoulders.
  */
  it('narrows from the shoulders to the waist', () => {
    const T = torsoLadder()
    const D = diaperLadder()
    const widest = [...T, ...D].reduce((m, r) => (r.hx > m.hx ? r : m), T[0]).hx
    const waist = Math.max(at(T, 0.62), at(D, 0.62))
    expect(waist).toBeLessThan(widest)
    // A taper you can see, not a rounding difference.
    expect(1 - waist / widest).toBeGreaterThan(0.1)
  })

  /*
    Both solids still share a material and a rear profile close enough to read as one
    moulding. The garment stands further back than the torso - the reference's puffy
    diaper rear, and deliberate - but the ledge that step creates at the junction was
    0.0477 and is now 0.0226.
  */
  it('keeps the puffy rear without a ledge across the junction', () => {
    /*
      Measured at the JUNCTION HEIGHT and not on the bounding boxes, which is a trap
      this test fell into on the first attempt. The two solids reach their deepest z at
      different heights - the torso near its widest band up at world 0.83, the garment
      down near the hips - so comparing `boundingBox.min.z` compares two rings that are
      nowhere near each other and reports the torso as the deeper part. What the eye
      sees at the seam is the two rings that meet there.
    */
    const rearAt = (
      opts: Parameters<typeof taperedSuperellipsoid>[0],
      worldY: number,
      zOffset: number,
      target: number,
    ): number => {
      const pos = taperedSuperellipsoid(opts).getAttribute('position')
      const rings = new Map<string, number>()
      for (let i = 0; i < pos.count; i++) {
        const key = pos.getY(i).toFixed(6)
        rings.set(key, Math.min(rings.get(key) ?? Infinity, pos.getZ(i) + zOffset))
      }
      let best = Infinity
      let bestDy = Infinity
      for (const [y, z] of rings) {
        const dy = Math.abs(worldY + Number(y) - target)
        if (dy < bestDy) {
          bestDy = dy
          best = z
        }
      }
      return best
    }
    // The waist, where the two parts hand over.
    const junction = 0.626
    const torsoRear = rearAt(TORSO, chestY, 0, junction)
    const diaperRear = rearAt(DIAPER, hipsY, DIAPER.z, junction)
    // Still a puffy rear: the garment stands further back than the torso at the seam.
    expect(diaperRear).toBeLessThan(torsoRear)
    // But not a shelf. It was 0.0477 and is now 0.0226.
    expect(torsoRear - diaperRear).toBeLessThan(0.03)
    expect(torsoRear - diaperRear).toBeGreaterThan(0.01)
  })
})

/*
  THE MITTEN AND ITS TWO FINGERS.

  The note is "generate two fingers that should be rectangles extruding from the hand,
  and update the hand from a sphere to an oblong shape". The fingers are the reason this
  block is long: a stub extruding from the blob it grows out of is the exact shape of
  part this project has shipped fully enclosed twice - a sole light authored "recessed
  1 mm above the sole plane" that sat inside opaque rubber, and a three-ring port whose
  inner rings were inside a solid disc - and in both cases a test existed and pinned the
  defect rather than catching it.

  So the exposure is measured on the BUILT geometry of both parts against each other,
  not on the authoring numbers. `HAND.taperTop` is 1 specifically so that
  `superellipsoidField` is a valid inside/outside test on the hand, which is what makes
  that possible at all.
*/
describe('the mitten hand and its fingers', () => {
  const hand = () => taperedSuperellipsoid(HAND)
  const finger = () => taperedSuperellipsoid(FINGER)

  it('is an oblong along the arm rather than a sphere', () => {
    const box = hand().boundingBox!
    // Longest on y, which is the axis the arm hangs down and the fingers point.
    expect(box.max.y).toBeGreaterThan(box.max.x)
    expect(box.max.y).toBeGreaterThan(box.max.z)
    // Oblong by a margin that reads, not by a rounding difference. A sphere is 1.0.
    expect(box.max.y / box.max.x).toBeGreaterThan(1.25)
    // Built dimensions pinned: 0.23 x 0.32 x 0.20, where the sphere was 0.28 across.
    expect(box.max.x * 2).toBeCloseTo(0.23, 3)
    expect(box.max.y * 2).toBeCloseTo(0.32, 3)
    expect(box.max.z * 2).toBeCloseTo(0.198, 3)
  })

  it('keeps the mitten inside the reference band on its longest axis', () => {
    const box = hand().boundingBox!
    // 00-references.md gives hands at 0.35 to 0.45 head-widths. The band is quoted for
    // a round mitten, so for an oblong it is the long axis that carries the mass.
    const longest = (box.max.y * 2) / PROPORTIONS.headWidth
    expect(longest).toBeGreaterThan(0.35)
    expect(longest).toBeLessThan(0.45)
  })

  it('builds two fingers with a real gap between them', () => {
    // Two, mirrored about the hand's centreline, so neither sits on it.
    expect(FINGER.x).toBeGreaterThan(FINGER.a)
    const gap = 2 * (FINGER.x - FINGER.a)
    expect(gap).toBeGreaterThan(0.02)
    // And they are not so wide that the pair leaves no palm around them.
    expect(FINGER.x + FINGER.a).toBeLessThan(HAND.a)
  })

  it('reads as a rectangle rather than as a capsule', () => {
    /*
      `e1` 0.25 is what makes it a block. Measured on the built mesh: it has to still be
      near its full width well up toward its own tip, which a capsule is not. At 80% of
      the half-height a capsule of this aspect holds about 60% of its width; this holds
      over 90%.
    */
    const pos = finger().getAttribute('position')
    let full = 0
    let high = 0
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i))
      full = Math.max(full, x)
      if (pos.getY(i) > 0.8 * FINGER.b) high = Math.max(high, x)
    }
    expect(high / full).toBeGreaterThan(0.85)
  })

  /*
    THE VISIBILITY PROOF, and the reason this block exists.

    Every vertex of the built finger is tested against the built hand's own field. A
    finger that is swallowed fails here; so does a finger that has floated off the palm,
    because the root has to stay inside.
  */
  it('extrudes from the hand rather than being swallowed by it', () => {
    const pos = finger().getAttribute('position')
    const centreY = fingerCentreY()
    let outside = 0
    let inside = 0
    for (let i = 0; i < pos.count; i++) {
      const field = superellipsoidField(
        pos.getX(i) + FINGER.x,
        pos.getY(i) + centreY,
        pos.getZ(i),
        HAND,
      )
      expect(Number.isFinite(field)).toBe(true)
      if (field > 1) outside++
      else inside++
    }
    // Most of the finger is out in the open, so it is a finger and not a bump.
    expect(outside).toBeGreaterThan(pos.count * 0.4)
    // And some of it is still in, so it is attached with no stalk to model.
    expect(inside).toBeGreaterThan(0)
  })

  it('stands clear of the hand at every point across its own footprint', () => {
    const centreY = fingerCentreY()
    const tip = centreY - FINGER.b
    /*
      The hand's surface is deepest nearest x 0, so the finger's INNER edge is the worst
      corner and the one that decides whether the exposure is real all the way across.
      Checked at the inner edge, the centreline and the outer edge.
    */
    for (const x of [FINGER.x - FINGER.a, FINGER.x, FINGER.x + FINGER.a]) {
      const surface = -superellipsoidY(x, 0, HAND)
      expect(Number.isFinite(surface)).toBe(true)
      expect(surface - tip).toBeGreaterThan(0.04)
    }
    // The worst corner is the inner one, which is the claim the loop above rests on.
    const innerClear = -superellipsoidY(FINGER.x - FINGER.a, 0, HAND) - tip
    const outerClear = -superellipsoidY(FINGER.x + FINGER.a, 0, HAND) - tip
    expect(innerClear).toBeLessThan(outerClear)
  })

  it('extends the hand silhouette past the hand own lowest point', () => {
    const tip = fingerCentreY() - FINGER.b
    // Below the hand's bottom pole, so the pair change the outline rather than
    // decorating a surface. This is the assertion a swallowed finger fails hardest.
    expect(tip).toBeLessThan(-HAND.b)
    expect(-HAND.b - tip).toBeGreaterThan(0.03)
  })

  it('keeps its root buried, so it cannot float off the palm', () => {
    const centreY = fingerCentreY()
    const root = centreY + FINGER.b
    // The block's top face is inside the hand solid at the finger's own x.
    expect(superellipsoidField(FINGER.x, root, 0, HAND)).toBeLessThan(1)
    // By the amount `FINGER.embed` claims, measured off the surface rather than assumed.
    expect(root - -superellipsoidY(FINGER.x, 0, HAND)).toBeCloseTo(FINGER.embed, 9)
  })

  it('is a closed solid wound outward', () => {
    expect(signedVolume(hand())).toBeGreaterThan(0)
    expect(signedVolume(finger())).toBeGreaterThan(0)
  })
})

/*
  THE BOOT AND THE LEG IT HANGS FROM.

  Two notes deep now. The boot was shrunk from 0.32 x 0.17 x 0.44 to a `RoundedBox`
  0.140 x 0.130 x 0.200 by "reduce the overall size of the feet by 80% and ensure it's
  centered on the legs", and is now a filleted truncated cone with the narrow end DOWN
  by "make his feet shaped like a cone... 30% narrower than the top part of that cone".

  Everything below is measured on the BUILT lathe rather than on `FOOT`'s parameters,
  and that is not a formality on this shape. The authored `topRadius` is the corner of
  the unfilleted cone, which the fillet cuts off, so the solid never reaches it - the
  same trap `TORSO` records for the taper. Reading the parameters instead of the mesh
  overstates the boot's width by 3.6 mm.

  The shin is a `capsuleGeometry(0.085, 0.1)` on the knee node, so it spans knee-local
  y +-0.135 and is at full radius between +-0.05. In world terms, with the knee at
  y 0.25: the bottom tip is at 0.115 and the capsule is at its full 0.085 down to 0.20.
*/
describe('the boot and the leg it hangs from', () => {
  const SHIN_RADIUS = 0.085
  const SHIN_HALF_LENGTH = 0.05
  const kneeY = REST.hips.y + REST.legL.y + REST.kneeL.y
  const shinTip = kneeY - SHIN_HALF_LENGTH - SHIN_RADIUS
  const shinFullTo = kneeY - SHIN_HALF_LENGTH
  /** The capsule's radius at a world height, on the lower hemisphere. */
  const shinRadiusAt = (y: number): number => {
    if (y >= shinFullTo) return SHIN_RADIUS
    if (y <= shinTip) return 0
    return Math.sqrt(SHIN_RADIUS ** 2 - (shinFullTo - y) ** 2)
  }

  /*
    The literal value, recorded rather than shipped.

    At 20% of every axis the boot is 0.064 x 0.034 x 0.088. Its top would be at world
    0.034 with the sole on the ground, so the shin's tip at 0.115 would float 0.081 above
    it with nothing joining them, and 0.064 of width against a leg 0.170 across leaves
    the leg overhanging its own boot by 0.053 per side. That is not "narrow", it is two
    disconnected parts.
  */
  it('records why a literal 80% linear reduction was not shipped', () => {
    const literal = { width: 0.32 * 0.2, height: 0.17 * 0.2, depth: 0.44 * 0.2 }
    expect(literal.height).toBeLessThan(shinTip)
    expect(shinTip - literal.height).toBeGreaterThan(0.05)
    expect(literal.width / 2).toBeLessThan(SHIN_RADIUS)
  })

  /*
    The 80% note from three passes ago, re-measured after this pass NARROWED the boot.

    It missed the round number when the boot was widened for the sole light - the box
    measured -84.8% and the cone -79.96% - and the 30% narrowing has taken it back past
    it: bounding volume is now **-89.9%** and plan footprint **-88.4%**.

    Asserted as a floor of 0.88 and a ceiling of 0.91. The ceiling is the half that
    earns its place: it is what fails if someone narrows the boot again without
    re-deriving the sole flat, the pad and the shin clearance underneath it, all three
    of which this change had to move together.
  */
  it('clears the old 80% note on both readings, having missed it for two passes', () => {
    const b = bootBounds()
    const newVolume = b.width * b.height * b.depth
    const volumeCut = 1 - newVolume / (0.32 * 0.17 * 0.44)
    expect(volumeCut).toBeGreaterThan(0.88)
    expect(volumeCut).toBeLessThan(0.91)

    // The cone's plan is an ellipse, not a rectangle, so the areas are not comparable
    // without saying so.
    const plan = Math.PI * (b.width / 2) * (b.depth / 2)
    const oldPlan = 0.32 * 0.44 - (4 - Math.PI) * 0.065 ** 2
    expect(1 - plan / oldPlan).toBeGreaterThan(0.88)
  })

  /*
    The width, bounded by the two things that actually constrain it rather than by a
    box two shapes ago.

    This asserted `width > 0.14` - the old box - because that pass had WIDENED the boot
    to fit the sole light and wanted the widening pinned. The art direction has since
    narrowed it 30%, so the boot is now 0.1196 and NARROWER than that box, and the
    assertion had become a record of a decision that was reversed.

    What genuinely bounds it now, in both directions:

    - it must stay wider than the leg it hangs from, or the leg overhangs its own boot,
      which is the defect the box was condemned for at 0.053 per side;
    - it must stay well under the boot the user asked to have shrunk, twice over now.
  */
  it('stays wider than its leg and far under the boot two directions ago', () => {
    const b = bootBounds()
    const shinThere = shinRadiusAt(PROPORTIONS.soleY + FOOT.height)
    expect(b.width / 2).toBeGreaterThan(shinThere)
    expect(b.width / 2 - shinThere).toBeGreaterThan(0.008)
    expect(b.width).toBeLessThan(0.32 * 0.6)

    /*
      **AND A CONSEQUENCE THAT IS RECORDED RATHER THAN ASSERTED AWAY.** The leg is a
      capsule, and `SHIN_RADIUS` - its widest, up at the knee - is 0.085 against a boot
      half-width of 0.0598. So the boot is now narrower than the WIDEST part of the leg
      above it, where before the narrowing it was 0.0844 and almost exactly matched it.

      That is not a defect on its own: the leg tapers to 0.0482 where the two actually
      meet, which the assertions above cover, and a boot narrower than a calf is what a
      boot is. It is written down because it is the thing to look at in a frame if the
      legs start reading as spindly, and because whoever looks will otherwise measure
      `SHIN_RADIUS` and conclude the boot is broken.
    */
    expect(b.width / 2).toBeLessThan(SHIN_RADIUS)
    // And it did narrow, by the 30% the direction asked for, on the authored radius.
    expect(FOOT.topRadius).toBeCloseTo(0.088 * 0.7, 12)
    // The height is the one axis that must not move at all: `PROPORTIONS.soleY` is 0 and
    // `totalHeight` is measured from it, so a taller or shorter boot lifts or sinks the
    // whole character with no other test failing.
    expect(b.height).toBeCloseTo(FOOT.height, 7)
  })

  /*
    THE SHAPE NOTE ITSELF: the narrow end is DOWN.

    Measured as the boot's own silhouette half-width at a ladder of heights, so it
    catches a cone built upside down - which would satisfy every ratio assertion in this
    block while putting the wide face on the floor.
  */
  it('tapers downward, monotonically, with the narrow end on the ground', () => {
    const prof = bootSilhouette()
    // From the sole up to the widest band, the half-width never decreases.
    const widestAt = prof.reduce((best, p, i) => (p.x > prof[best].x ? i : best), 0)
    for (let i = 1; i <= widestAt; i++) {
      expect(prof[i].x).toBeGreaterThanOrEqual(prof[i - 1].x - 1e-9)
    }
    // And the widest band is in the boot's TOP half, which is what "pointy side down" is.
    expect(prof[widestAt].y).toBeGreaterThan(0)
    // The sole is strictly narrower than the top face.
    expect(prof[0].x).toBeLessThan(prof[prof.length - 1].x)
  })

  /*
    The taper's 30%, on all three readings of it, because a filleted cone has two
    candidate widths at each end and the fillets at the two ends are different sizes.

    Not to be confused with the OTHER 30% this part now carries: `narrow` is the sole's
    30% narrowing relative to the top face, and `FOOT.topRadius` separately took a 30%
    cut on art direction. The two are independent and both are 0.7, which is a
    coincidence and exactly the kind that gets a constant edited in the wrong place.

    `narrow` is authored at exactly 0.7 and the FACE reading lands at 31.4%. It moved
    from 29.1% when the fillet was scaled with the boot: a fillet is a tangent LENGTH,
    so it does not scale out of a ratio of flats the way a radius does. The rim-to-rim
    reading is 25.6%.
  */
  it('is 30% narrower at the bottom on the reading taken, and records the other two', () => {
    expect(footBottomRadius() / FOOT.topRadius).toBeCloseTo(0.7, 12)

    const faceRatio = footSoleFlat().x / footTopFlat().x
    expect(faceRatio).toBeGreaterThan(0.68)
    expect(faceRatio).toBeLessThan(0.70)

    const prof = bootSilhouette()
    const rimTop = Math.max(...prof.map((p) => p.x))
    // The lower rim's widest point: the highest sample still below the boot's mid height.
    const rimBot = Math.max(...prof.filter((p) => p.y < 0).map((p) => p.x))
    const rimRatio = rimBot / rimTop
    expect(rimRatio).toBeGreaterThan(0.73)
    expect(rimRatio).toBeLessThan(0.755)
  })

  /*
    The constraint that fixes the height. The boot has to swallow the end of the shin,
    or the leg stops in mid air above it.
  */
  it('swallows the end of the shin', () => {
    const bootTop = PROPORTIONS.soleY + FOOT.height
    expect(shinTip).toBeLessThan(bootTop)
    expect(shinTip).toBeGreaterThan(PROPORTIONS.soleY)
    // With real margin rather than tangentially.
    expect(bootTop - shinTip).toBeGreaterThan(0.01)
  })

  /*
    And is wider than the leg where the two meet - against the boot's FLAT TOP FACE and
    not against its bounding half-width, which is the correction this pass makes.

    The note this replaces claimed the box's "half-width of 0.070 contains it with 0.0218
    to spare". A `RoundedBox` is not at full width at its top plane: it is inset by the
    corner radius, so the flat was 0.040 and the shin's 0.04822 was 0.0082 OUTSIDE it.
    Harmless in the end, because the shin continues upward and the two solids
    interpenetrate rather than gapping, but the 0.0218 of margin never existed. Same
    error class as the test that checked the shin's inner edge instead of its axis: a
    number read off the shape someone had in mind rather than the one built.
  */
  it('lets the shin emerge through the FLAT of its top face, which the box did not', () => {
    const bootTop = PROPORTIONS.soleY + FOOT.height
    const shinThere = shinRadiusAt(bootTop)
    expect(footTopFlat().x).toBeGreaterThan(shinThere)
    expect(footTopFlat().z).toBeGreaterThan(shinThere)

    /*
      **The 0.015 of margin this used to require is gone, and it is unreachable rather
      than relaxed.** At a `topRadius` of 0.0616 the widest the top flat could possibly
      be is 0.0616, with a fillet of ZERO, against a shin of 0.0482 - so the most margin
      the geometry can offer is 0.0134, and the previous pass's 0.015 cannot be met at
      any fillet. Asserting it after a 30% narrowing would have been asserting that the
      narrowing did not happen.

      What ships is 0.0005, which clears but does not clear comfortably, and the honest
      reading of that is below.
    */
    expect(footTopFlat().x - shinThere).toBeGreaterThan(0)
    expect(footTopFlat().x - shinThere).toBeLessThan(0.002)

    /*
      So the invariant the old assertion was REALLY about is asserted directly instead:
      no part of the leg may be outside the boot's solid where the two meet. That is
      the failure the box was condemned for - "a leg overhanging its own boot by 0.053
      per side" - and it is a statement about the boot's widest half-extent, not about
      its top flat. The flat only ever mattered because it was the conservative proxy.
    */
    expect(footMaxHalfWidth().x - shinThere).toBeGreaterThan(0.008)

    // The defect this replaces, kept as an executable statement so the claim is checkable.
    const oldBoxFlatAtTopPlane = 0.14 / 2 - 0.03
    expect(oldBoxFlatAtTopPlane).toBeLessThan(shinThere)
  })

  it('is still narrower than it is long, so it reads as a boot rather than a peg', () => {
    const b = bootBounds()
    expect(b.width).toBeLessThan(b.depth)
    expect(b.depth / b.width).toBeCloseTo(FOOT.depthScale, 6)
  })

  /*
    Centred on its own leg, on both axes, which it was not two passes ago: `REST.footL.z`
    was 0.06, and `REST_ROTATION.legL.ry` then carried that forward offset into x as
    well. Measured on the mesh, because a lathe is only centred if nothing translated it.
  */
  it('is centred on the leg axis', () => {
    const b = bootBounds()
    expect(b.centreX).toBeCloseTo(0, 7)
    expect(b.centreZ).toBeCloseTo(0, 7)
    expect(REST.footL.z).toBe(0)
    expect(REST.footR.z).toBe(0)
  })

  /*
    The bevel discipline, which the shape change could have dropped silently. A bare
    `coneGeometry` has two 90 degree rims and the world rule is that no moulded plastic
    object has one anywhere. Asserted as the existence of a fillet band on both rims
    rather than as `FOOT.fillet > 0`, which would only restate the constant.
  */
  it('has a filleted rim at both ends rather than a hard corner', () => {
    const prof = bootSilhouette()
    // Distinct heights between the sole and the widest band means the rim turns through
    // intermediate samples rather than in one step.
    const lower = prof.filter((p) => p.y < 0)
    expect(lower.length).toBeGreaterThan(FOOT.filletSteps)
    const upper = prof.filter((p) => p.y > 0)
    expect(upper.length).toBeGreaterThan(FOOT.filletSteps)
    // Neither face runs to the widest band, so both rims are rounded off.
    expect(footSoleFlat().x).toBeLessThan(Math.max(...prof.map((p) => p.x)))
    expect(footTopFlat().x).toBeLessThan(Math.max(...prof.map((p) => p.x)))
  })

  it('winds outward, so the boot is drawn at all', () => {
    // The ear pods and both arm rings shipped inside out for three rounds behind five
    // passing extent tests. Every new lathe on this character gets this assertion.
    expect(signedVolume(bootGeometry())).toBeGreaterThan(0)
    const sense = radialNormalSense(bootGeometry())
    expect(sense.out).toBeGreaterThan(0)
    expect(sense.in).toBe(0)
  })
})

/*
  Three vantages were re-sited around the character's measured bounds, so a part
  that widens the extreme x extent invalidates them silently: `__dev.framing()`
  would report a different `heightFraction` and nothing would say why. The pods
  moved outward, and this is the check that they did not become the widest thing
  on the model while doing it.
*/
describe('the widest point of the character', () => {
  // `HAND.a` rather than the `HAND.radius` this read, because the mitten is an oblong
  // now. `a` is its half-width on x, which is the axis this block is about.
  const handX =
    Math.abs(REST.shoulderL.x) +
    Math.abs(REST.handSocketL.y) * Math.sin(Math.abs(REST_ROTATION.shoulderL!.z)) +
    HAND.a

  it('is still the mittens and not the ear pods', () => {
    const podX = Math.abs(REST.earPodL.x) + EAR_POD_SHAPE.halfThickness
    expect(handX).toBeGreaterThan(podX)
    /*
      The margin GREW, from 0.039 to 0.100, and it is worth saying because the two
      notes in this pass pulled it in opposite directions: the hand narrowed by 0.025
      per side, which shrinks this, and the pods came in 0.040 and lost 0.043 of
      thickness, which grows it by more. The block's comment above says "the pods moved
      outward, and this is the check that they did not become the widest thing" - they
      have now moved back in, so this is no longer a close call.
    */
    expect(handX - podX).toBeGreaterThan(0.05)
  })

  /*
    And the FINGERS do not change the answer, which is the new part that could have.
    They hang off the palm end, so they extend the character downward rather than
    outward, and their outer edge stays inside the hand's own outline in x.
  */
  it('is not the fingers, which stay inside the hand outline', () => {
    expect(FINGER.x + FINGER.a).toBeLessThan(HAND.a)
  })
})

describe('the cape cross-section', () => {
  it('is a solid slab and not the zero-thickness quad the critique found', () => {
    expect(CAPE_PANEL.thickness).toBeGreaterThan(0.02)
  })

  it('leaves a flat face between the two chamfers rather than being all chamfer', () => {
    expect(CAPE_PANEL.thickness - 2 * CAPE_PANEL.bevel).toBeGreaterThan(0)
    expect(CAPE_PANEL.bevel).toBeLessThan(CAPE_PANEL.width / 2)
  })

  it('hangs off a socket coincident with the pack, which is why clearance matters', () => {
    expect(REST.capeRoot).toEqual(REST.backpack)
  })

  /*
    Clears the rear face of the pack, by 0.023 rather than the 0.010 this used to
    pin.

    The 0.010 was correct while the pack's rear face was flat. It no longer is: the
    circular port stands 0.012 proud of it, so `CAPE_PANEL.z` moved back to -0.108
    to clear the port by 0.011 and the pack's own face is cleared by 0.023 as a
    consequence. The port is the binding constraint now and it is asserted in its
    own block; this one is kept as the weaker guarantee, because "the cape does not
    start inside the pack" is the invariant that has to survive whatever else lands
    on that face.
  */
  it('clears the rear face of the pack on its front face', () => {
    const packRear = -BACKPACK_BLOCK.depth / 2
    const panelFront = CAPE_PANEL.z + CAPE_PANEL.thickness / 2
    expect(panelFront).toBeLessThan(packRear)
    expect(packRear - panelFront).toBeCloseTo(0.023, 12)
  })
})

/*
  The cape ribbon.

  Four rigid slabs became one continuous surface skinned from the same four
  spring angles, and every property worth having about it is arithmetic that a
  clean frame would not reveal. A ribbon that welds itself shut in the wrong
  direction, or whose hem swings the wrong way, or whose normals point inward,
  renders and animates and reports every triangle present.
*/
describe('the cape ribbon', () => {
  const flat = (rx: number, rz = 0) => [
    { rx, rz },
    { rx, rz },
    { rx, rz },
    { rx, rz },
  ]
  const build = () => createCapeRibbon(CAPE.segmentLength)

  const pos = (r: ReturnType<typeof build>) => r.geometry.getAttribute('position')
  const nrm = (r: ReturnType<typeof build>) => r.geometry.getAttribute('normal')

  it('builds a non-empty solid with finite vertices and unit normals', () => {
    const r = build()
    const p = pos(r)
    const n = nrm(r)
    expect(p.count).toBeGreaterThan(300)
    expect(r.geometry.getIndex()!.count % 3).toBe(0)
    for (let i = 0; i < p.count * 3; i++) expect(Number.isFinite(p.array[i])).toBe(true)
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 6)
    }
  })

  it('subdivides finely enough that the crease it replaces is invisible', () => {
    // The whole point of the change. At the 0.856 rad of steady-state sweep the
    // per-facet angle has to land under the 1.9 degrees the head shell`s own
    // smoothness was chosen for, or the staircase is only half fixed.
    const facet = (0.856 / (CAPE_RIBBON.segments * CAPE_RIBBON.stepsPerSegment)) * (180 / Math.PI)
    expect(facet).toBeLessThan(2.1)
    expect(r_arcLength(build())).toBeCloseTo(CAPE.segmentLength * CAPE_RIBBON.segments, 9)
  })

  /** Total arc length of the centreline, straight down at rest. */
  function r_arcLength(r: ReturnType<typeof build>) {
    return r.stepLength * r.steps
  }

  /*
    The hard edges. Adjacent runs share a POSITION but not an index, which is
    what gives the chamfer a crisp lit line instead of shading it into a round.
    That only works if the duplicates are actually co-located: a mismatch opens a
    gap along the whole length of the cape and is invisible until something is
    seen through it.
  */
  it('welds every hard edge, so the duplicated ring vertices coincide', () => {
    const r = build()
    const p = pos(r)
    const runs = 8
    for (let row = 0; row < r.rowCount; row++) {
      for (let k = 0; k < runs; k++) {
        const endOfRun = (row * runs + k) * 2 + 1
        const startOfNext = (row * runs + ((k + 1) % runs)) * 2
        expect(p.getX(endOfRun)).toBeCloseTo(p.getX(startOfNext), 9)
        expect(p.getY(endOfRun)).toBeCloseTo(p.getY(startOfNext), 9)
        expect(p.getZ(endOfRun)).toBeCloseTo(p.getZ(startOfNext), 9)
      }
    }
  })

  /*
    Winding and closure in one number.

    The signed volume of a closed triangle soup is positive when every face winds
    outward. It catches an inverted run, an inverted cap, and a cap fan built in
    the wrong order - all three of which render as a black facet or as a hole you
    can see the inside of, and none of which changes a triangle count. It is also
    the check that the caps exist at all, since an open tube has no volume worth
    the name.
  */
  it('is closed and wound outward, measured as a positive signed volume', () => {
    const r = build()
    const p = pos(r)
    const idx = r.geometry.getIndex()!
    let v = 0
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i)
      const b = idx.getX(i + 1)
      const c = idx.getX(i + 2)
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a)
      const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b)
      const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c)
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    }
    v /= 6
    expect(v).toBeGreaterThan(0)
    // Cross-section area 0.0100 m^2 over 0.72 m of length with the flare, so
    // about 0.0076 m^3. Pinned so a change to the section has to look at it.
    expect(v).toBeGreaterThan(0.006)
    expect(v).toBeLessThan(0.009)
  })

  it('faces the outer surface away from the body at rest', () => {
    const r = build()
    const n = nrm(r)
    // Run 0 is the outer face, and at rest the frame is the identity, so its
    // normal is exactly -Z. If this inverts, the cape is lit from inside.
    expect(n.getZ(0)).toBeCloseTo(-1, 9)
    expect(n.getX(0)).toBeCloseTo(0, 9)
  })

  /*
    THE SIGN TEST, and the reason this block exists.

    A positive `rx` has to carry the hem BEHIND the character, because forward at
    `rotation.y = 0` is +Z. The solver got this backwards for the whole life of
    the cape and the result was a 0.72 m sheet hanging through the legs and out in
    front of the feet at full speed. Asserted on the geometry rather than on the
    solver, so it holds however the targets are computed.
  */
  it('swings the hem behind the character for a positive rx', () => {
    const r = build()
    skinCapeRibbon(r, flat(0.214))
    const p = pos(r)
    // The hem cap`s first vertex, which is on the centreline`s row.
    const hemZ = p.getZ(r.capBottomFirst)
    const hemY = p.getY(r.capBottomFirst)

    const rest = build()
    skinCapeRibbon(rest, flat(0))
    const restZ = rest.geometry.getAttribute('position').getZ(rest.capBottomFirst)
    const restY = rest.geometry.getAttribute('position').getY(rest.capBottomFirst)

    expect(hemZ).toBeLessThan(restZ)
    // And it rises as it swings back, because the chain has a fixed length.
    expect(hemY).toBeGreaterThan(restY)
  })

  it('puts the hem where a constant-curvature arc of the total sweep would', () => {
    /*
      Four equal bends of 0.214 give a total sweep of 0.856 rad over 0.72 m of
      arc, so radius R = L / theta and the hem lands at
      (-R(1 - cos theta), -R sin theta) relative to the socket.

      Held to a millimetre, which is what the trapezoid frame advance buys. The
      first-order version - rotate the whole step, then translate - landed 11.6 mm
      short, and short SYSTEMATICALLY rather than randomly, because every chord
      leaned the same way. See `skinCapeRibbon`.
    */
    const r = build()
    skinCapeRibbon(r, flat(0.214))
    const p = pos(r)
    const L = CAPE.segmentLength * CAPE_RIBBON.segments
    const theta = 0.214 * 4
    const R = L / theta

    /*
      The CENTRELINE endpoint, plus the cross-section offset carried into the hem's
      own frame - and that second term is the part the first draft of this test got
      wrong, which is worth recording because it is the same mistake in the same
      place as the fold itself.

      The offset is `CAPE_PANEL.z`, along the ribbon's local -Z, and the hem's local
      frame has rotated by the full sweep. So it contributes `off * cos(theta)` to z
      and `-off * sin(theta)` to y rather than simply adding to z. Adding it
      unrotated puts the expectation 27 mm out and reads as a broken skin.
    */
    const off = CAPE_PANEL.z - CAPE_PANEL.thickness / 2
    const expectZ = -R * (1 - Math.cos(theta)) + off * Math.cos(theta)
    const expectY = -R * Math.sin(theta) - off * Math.sin(theta)
    expect(p.getZ(r.capBottomFirst)).toBeCloseTo(expectZ, 3)
    expect(p.getY(r.capBottomFirst)).toBeCloseTo(expectY, 3)
    // And the hem is a full flare wider than the socket, which is what stops the
    // cape reading as an attached board.
    const hemHalfWidth = -p.getX(r.capBottomFirst)
    expect(hemHalfWidth).toBeCloseTo(
      (CAPE_PANEL.width / 2) * CAPE_RIBBON.flare - CAPE_PANEL.bevel,
      5,
    )
  })

  /*
    The accumulation, asserted exactly rather than inferred from a position.

    The hem cap's normal is the frame's own -Y at the end of the walk, so it is a
    direct readout of the TOTAL rotation the skin accumulated. That total has to
    equal the sum of the four spring angles to full precision, and it is the one
    property the trapezoid frame advance could plausibly have broken: splitting
    each step's rotation either side of the translation only preserves the total
    because the two halves still sum to the step's own angle.

    Deliberately driven with four DIFFERENT angles. Four equal ones would pass even
    if the code read `bends[0]` for every segment, which is exactly the sort of
    indexing slip that produces a cape bending by a quarter of what it should and
    no error anywhere.
  */
  it('accumulates exactly the sum of the four spring angles', () => {
    const r = build()
    const bends = [
      { rx: 0.11, rz: 0 },
      { rx: 0.19, rz: 0 },
      { rx: 0.27, rz: 0 },
      { rx: 0.33, rz: 0 },
    ]
    skinCapeRibbon(r, bends)
    const theta = bends.reduce((a, b) => a + b.rx, 0)
    const n = nrm(r)
    // Rx(theta) applied to (0, -1, 0) is (0, -cos, -sin).
    expect(n.getX(r.capBottomFirst)).toBeCloseTo(0, 6)
    expect(n.getY(r.capBottomFirst)).toBeCloseTo(-Math.cos(theta), 5)
    expect(n.getZ(r.capBottomFirst)).toBeCloseTo(-Math.sin(theta), 5)
    // And the socket end is still unrotated, so the cape leaves the pack straight.
    expect(nrm(r).getY(r.capTopFirst)).toBeCloseTo(1, 6)
  })

  it('rolls toward -X for a negative rz, which is how the lateral trail reads', () => {
    const r = build()
    skinCapeRibbon(r, flat(0, -0.068))
    const x = r.geometry.getAttribute('position').getX(r.capBottomFirst)
    const rest = build()
    skinCapeRibbon(rest, flat(0, 0))
    expect(x).toBeLessThan(rest.geometry.getAttribute('position').getX(rest.capBottomFirst))
  })

  it('is idempotent, so a repeated skin cannot accumulate', () => {
    const r = build()
    skinCapeRibbon(r, flat(0.3, 0.05))
    const once = Float32Array.from(pos(r).array as Float32Array)
    skinCapeRibbon(r, flat(0.3, 0.05))
    const twice = pos(r).array as Float32Array
    for (let i = 0; i < once.length; i++) expect(twice[i]).toBeCloseTo(once[i], 9)
  })

  /*
    The culling trap. three tests `boundingSphere` against the camera AND against
    the shadow frustum, so a deforming mesh whose sphere came from its rest pose
    silently stops casting the moment it swings outside it. The sphere is
    therefore set by hand and never recomputed, and it has to actually contain
    every reachable pose.
  */
  it('carries a fixed bounding sphere that contains every reachable pose', () => {
    const r = build()
    expect(r.geometry.boundingSphere).not.toBeNull()
    expect(r.geometry.boundingSphere!.radius).toBe(CAPE_RIBBON.cullRadius)
    const p = pos(r)
    for (const bend of [flat(0), flat(0.856), flat(-1.3), flat(0.6, 0.4), flat(2.3)]) {
      skinCapeRibbon(r, bend)
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i), p.getY(i), p.getZ(i))
        expect(d).toBeLessThanOrEqual(CAPE_RIBBON.cullRadius)
      }
      // And it is never recomputed behind our back.
      expect(r.geometry.boundingSphere!.radius).toBe(CAPE_RIBBON.cullRadius)
    }
  })

  it('refuses a segment length that would collapse it', () => {
    expect(() => createCapeRibbon(0)).toThrow(/positive length/)
    expect(() => createCapeRibbon(-1)).toThrow(/positive length/)
  })
})
