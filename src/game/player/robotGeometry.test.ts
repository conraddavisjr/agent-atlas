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
  DIAPER,
  EAR_POD_SHAPE,
  FACE_PLATE,
  HAND,
  HEAD_CAP,
  HEAD_SHELL,
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
  it('is narrower than its half-extent because the taper reaches the equator', () => {
    const box = torso().boundingBox!
    // Strictly inside the untapered half-extent, and strictly outside the fully
    // tapered one, because the widest latitude sits just below the equator
    // where the taper has not finished but the rim term is already near its own
    // maximum.
    expect(box.max.x).toBeLessThan(TORSO.a)
    expect(box.max.x).toBeGreaterThan(TORSO.a * TORSO.taperTop)
    // Pinned, so an edit to `a` or `taperTop` has to come and look at it.
    expect(box.max.x * 2).toBeCloseTo(0.578, 2)
    expect(box.max.z * 2).toBeCloseTo(0.484, 2)
  })

  it('is wider at the base than at the crown', () => {
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
    expect(lowerMax).toBeGreaterThan(upperMax)
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
      A can of radius 0.105 and length 0.21 is 0.007274 before the fillet takes
      material off the two rims, so the expected answer is a little under that. The
      descending profile measured -0.006906 for the same shape: same magnitude,
      opposite sign, which is the whole signature of an inverted winding.
    */
    const v = signedVolume(g)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(Math.PI * 0.105 * 0.105 * 0.21)
    expect(v).toBeGreaterThan(0.8 * Math.PI * 0.105 * 0.105 * 0.21)

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
    const pts = roundedDiscProfile(0.105, 0.105, 0.055, 6)
    expect(pts[0].y).toBeCloseTo(-0.105, 12)
    expect(pts[pts.length - 1].y).toBeCloseTo(0.105, 12)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y - 1e-12)
    }
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
    const podZFront = REST.earPodL.z + EAR_POD_SHAPE.radius
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
    The foot is a RoundedBox 0.32 x 0.17 x 0.44 at radius 0.065, so its bottom
    face is flat only over the inner box. A pad wider than that straddles a corner
    round and leaves a crescent gap between itself and the sole, which is the same
    artefact both critique reviewers read as "there is a hole in the character`s
    face" when the ear pods did it.
  */
  const flatX = 0.32 / 2 - 0.065
  const flatZ = 0.44 / 2 - 0.065

  it('lands entirely on the flat part of the sole', () => {
    expect(SOLE_LIGHT.radius).toBeLessThan(flatX)
    expect(SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ).toBeLessThan(flatZ)
    // With real margin rather than by a thousandth.
    expect(flatX - SOLE_LIGHT.radius).toBeGreaterThan(0.005)
    expect(flatZ - SOLE_LIGHT.radius * SOLE_LIGHT.stretchZ).toBeGreaterThan(0.005)
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
  */
  it('protrudes through the sole rather than being buried inside the foot', () => {
    const soleY = -0.17 / 2
    const padBottom = soleY - SOLE_LIGHT.proud
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

  it('reaches the outer extent the width ladder is built on', () => {
    // docs/design/05-character-vfx.md: "Ear pod outer extent is 0.380 + 0.105 =
    // 0.485, so the head's total width including pods is 0.97 m. That is
    // deliberately the widest thing on the character."
    expect(outer).toBeCloseTo(0.485, 12)
    expect(outer * 2).toBeCloseTo(0.97, 12)
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

    Measured: 0.0727 to 0.0809 all the way round, a tighter spread than the flat box
    gave, because the pod's footprint is small enough that the cheek is locally
    almost flat over it.

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
      const z = REST.earPodL.z + EAR_POD_SHAPE.radius * Math.cos(th)
      const surfaceX = superellipsoidX(y, z, HEAD_SHELL)
      expect(Number.isFinite(surfaceX)).toBe(true)
      shallowest = Math.min(shallowest, surfaceX - innerFace)
    }
    expect(shallowest).toBeCloseTo(0.0727, 3)
    // The full-radius section has to START inside the shell, everywhere round the rim.
    expect(shallowest).toBeGreaterThan(EAR_POD_SHAPE.fillet)
    // And the pod must not be so deep that its far face pokes out the other cheek.
    expect(shallowest).toBeLessThan(2 * superellipsoidX(0, REST.earPodL.z, HEAD_SHELL))
  })

  /*
    The regression this file exists to prevent. At the half-thickness the pods
    shipped with, `outer` was 0.420 against a cheek at 0.360, so five sixths of the
    pod was buried and the only thing on screen was a 0.06 m crescent of its own rim,
    seen almost end on. Anything under about 0.10 of protrusion puts it back there.
  */
  it('protrudes far enough to read as a pod rather than as a hole in the cheek', () => {
    const cheekX = superellipsoidX(REST.earPodL.y, REST.earPodL.z, HEAD_SHELL)
    expect(outer - cheekX).toBeGreaterThan(0.1)
    expect(outer - cheekX).toBeCloseTo(0.1251, 3)
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
    expect(Math.abs(REST.earPodL.z) + EAR_POD_SHAPE.radius).toBeLessThan(HEAD_SHELL.c - 0.1)
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
    expect(box.max.z).toBeCloseTo(EAR_POD_SHAPE.radius, 6)
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
    The width and depth are unchanged, and that matters more than it looks:
    `PROPORTIONS.torsoWidthMax` is 0.62, the head-over-torso inversion is the thing
    that makes this character read as an infant rather than as a short adult, and the
    silhouette test in `05-character-vfx.md` compares scanlines against it.

    Measured on the built geometry, because `a` is 0.2871 rather than 0.31: the taper
    multiplies every latitude including the equator, so the solid's widest half-width
    is `a * max(taper * rim)`, which is a numeric maximum and not a closed form. A
    comment claiming the factor would be exactly the kind of thing this file keeps
    finding wrong.
  */
  it('keeps the hip width and depth the proportion ladder is built on', () => {
    const box = diaper().boundingBox!
    expect(box.max.x - box.min.x).toBeCloseTo(PROPORTIONS.torsoWidthMax, 3)
    expect(box.max.z - box.min.z).toBeCloseTo(0.52, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(0.28, 3)
  })

  /*
    The form change, which is the answer to "bubbly": widest at the hip line and
    tucking under toward the legs, so the legs emerge from a tuck rather than from the
    widest band. The box was widest at its exact middle and symmetric about it.
  */
  it('is widest above its own middle and tucks under below it', () => {
    /*
      Measured per latitude RING rather than by bucketing on a height, because
      `taperedSuperellipsoid` samples v uniformly and `e1` 0.50 then clusters the rows
      toward the poles: there is no row within 6 mm of y 0.060 to bucket. The rings
      are what the generator actually emits, so they are what gets measured.
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
    // The box held 80.4% of its width at y -0.12, so this is a real tuck and not a
    // rounding difference.
    expect(at(-0.12).w / widest.w).toBeLessThan(0.804)
  })

  /*
    The shin has to emerge from the garment rather than from beside it. Its top is at
    hips-local y -0.135 spanning |x| 0.105 to 0.275, and the diaper has to still be
    wide enough there to overlap it. `DIAPER.z` is not in this arithmetic because both
    parts are near z 0 at their closest and the overlap that matters is lateral.
  */
  it('still meets the top of the shin, so no leg floats free', () => {
    const pos = diaper().getAttribute('position')
    let w = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > -0.13) continue
      w = Math.max(w, Math.abs(pos.getX(i)))
    }
    const shinInnerX = Math.abs(REST.legL.x) - 0.085
    expect(w).toBeGreaterThan(shinInnerX)
  })

  it('is a closed solid wound outward', () => {
    expect(signedVolume(diaper())).toBeGreaterThan(0)
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
  const handX =
    Math.abs(REST.shoulderL.x) +
    Math.abs(REST.handSocketL.y) * Math.sin(Math.abs(REST_ROTATION.shoulderL!.z)) +
    HAND.radius

  it('is still the mittens and not the ear pods', () => {
    const podX = Math.abs(REST.earPodL.x) + EAR_POD_SHAPE.halfThickness
    expect(handX).toBeGreaterThan(podX)
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
