import { describe, it, expect } from 'vitest'
import { latheProfile } from '@/art/geometry'
import {
  ARM_BAND,
  ARM_BEVEL,
  BACKPACK_BLOCK,
  CAPE_PANEL,
  CAPE_RIBBON,
  createCapeRibbon,
  EAR_POD_SHAPE,
  FACE_PLATE,
  HAND,
  HEAD_CAP,
  HEAD_SHELL,
  roundedDiscProfile,
  skinCapeRibbon,
  SOLE_LIGHT,
  superellipsePoints,
  sdRoundBox,
  taperedSuperellipsoid,
  TORSO,
  VISOR,
} from './robotGeometry'
import { CAPE } from './animTuning'
import { REST, REST_ROTATION } from './robotPose'

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
    expect(pts[0].y).toBeCloseTo(halfThickness, 12)
    expect(pts[pts.length - 1].y).toBeCloseTo(-halfThickness, 12)
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
  Signed distance to a rounded box in 3D, the standard iq form.

  Here because every "is this part proud of the one under it" question on this
  model is that one function, and every one of them has been answered by eye at
  least once. `Helmet` was the worst case: an 0.84 hemisphere over a 0.72 head
  with a 0.03 gap at the rim, none of it visible in a triangle count.
*/
function sdRoundBox3(
  px: number,
  py: number,
  pz: number,
  hx: number,
  hy: number,
  hz: number,
  r: number,
): number {
  const qx = Math.abs(px) - (hx - r)
  const qy = Math.abs(py) - (hy - r)
  const qz = Math.abs(pz) - (hz - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  return outside + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r
}

/** The head shell`s own surface, as a signed distance in head-local space. */
const headSd = (x: number, y: number, z: number) =>
  sdRoundBox3(
    x,
    y,
    z,
    HEAD_SHELL.width / 2,
    HEAD_SHELL.height / 2,
    HEAD_SHELL.depth / 2,
    HEAD_SHELL.radius,
  )

describe('the copper cap on the back of the head', () => {
  const back = HEAD_CAP.z - HEAD_CAP.depth / 2
  const top = HEAD_CAP.y + HEAD_CAP.height / 2
  const front = HEAD_CAP.z + HEAD_CAP.depth / 2
  const side = HEAD_CAP.width / 2

  it('stands proud of the head at the back and over the rear crown', () => {
    // Proud means a positive signed distance from the head`s own surface. A cap
    // that is not proud anywhere is a paint stripe, and this is the arithmetic
    // that decides which one it is.
    expect(headSd(0, HEAD_CAP.y, back)).toBeGreaterThan(0.015)
    expect(headSd(0, top, HEAD_CAP.z)).toBeGreaterThan(0)
    expect(headSd(side, top, back)).toBeGreaterThan(0.04)
  })

  it('stays inside the head`s own width, so the pods remain the widest thing', () => {
    expect(side).toBeLessThan(HEAD_SHELL.width / 2)
  })

  /*
    The defect the deleted `Helmet` had and this must never repeat. The antenna
    root is at head-local z -0.040 and its bulb reaches y 0.520; a cap whose front
    face passed that z, or whose top passed that y, would swallow the one warm
    light on the character exactly as the dome did.
  */
  it('cannot enclose the antenna', () => {
    expect(front).toBeLessThan(-0.04)
    expect(top).toBeLessThan(0.31)
  })

  /*
    Does not intersect the ear pods, tested against the cap`s real SURFACE rather
    than against its bounding extents.

    The first version of this test compared the cap`s front z (-0.090) with the
    pod`s rear z (-0.125) and failed, which looked like a collision and is not one.
    The bounding boxes genuinely do overlap - x 0.275 to 0.280, z -0.125 to -0.090 -
    but a `RoundedBox` at radius 0.090 is only its full 0.280 wide away from its own
    corner rounds: at the front face the cross-section has shrunk to the inner box
    at 0.190, and the cap does not reach x 0.275 until z -0.150, which is 0.025
    behind where the pod begins.

    Recorded because the bounding-box version of this question is the one that is
    easy to ask and it gives the wrong answer in both directions - it would also
    have passed `Helmet`, whose sphere overlapped nothing it was not supposed to.
    Sampling the pod`s own surface against the cap`s signed distance is the version
    that is actually about the two shapes.
  */
  it('does not intersect the ear pods', () => {
    const axisX = Math.abs(REST.earPodL.x)
    const inner = axisX - EAR_POD_SHAPE.halfThickness
    let closest = Infinity
    // The pod is a can whose axis lies along X. Walk its rim and its two faces.
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2
      const y = REST.earPodL.y + EAR_POD_SHAPE.radius * Math.sin(th)
      const z = REST.earPodL.z + EAR_POD_SHAPE.radius * Math.cos(th)
      for (let j = 0; j <= 8; j++) {
        const x = inner + (j / 8) * EAR_POD_SHAPE.halfThickness * 2
        closest = Math.min(
          closest,
          sdRoundBox3(
            x,
            y - HEAD_CAP.y,
            z - HEAD_CAP.z,
            HEAD_CAP.width / 2,
            HEAD_CAP.height / 2,
            HEAD_CAP.depth / 2,
            HEAD_CAP.radius,
          ),
        )
      }
    }
    // Every sampled pod point is strictly outside the cap.
    expect(closest).toBeGreaterThan(0)
  })

  /*
    And the cap cannot reach the pod`s own inner face at any z the pod occupies,
    which is the closed-form version of the same claim.
  */
  it('narrows away from the pods before it gets near them', () => {
    const capHalfWidthAtFront = HEAD_CAP.width / 2 - HEAD_CAP.radius
    const podInnerX = Math.abs(REST.earPodL.x) - EAR_POD_SHAPE.halfThickness
    expect(capHalfWidthAtFront).toBeLessThan(podInnerX)
  })

  it('bevels within what RoundedBoxGeometry will actually honour', () => {
    // It clamps to half the smallest dimension without complaining, so an
    // over-large radius quietly produces a pill rather than erroring.
    const smallest = Math.min(HEAD_CAP.width, HEAD_CAP.height, HEAD_CAP.depth)
    expect(HEAD_CAP.radius).toBeLessThanOrEqual(smallest / 2)
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
    The sole plane is y = 0 in world space by construction - `REST.footL.y` is
    chosen so it lands there - so a pad flush with the sole is coplanar with the
    ground and z-fights. A millimetre of recess is the only version with no
    failure mode.
  */
  it('sits clear of the ground plane rather than flush with it', () => {
    expect(SOLE_LIGHT.lift).toBeGreaterThan(0)
    expect(SOLE_LIGHT.lift).toBeLessThan(0.005)
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
    The ordering that decides whether this reads as a lit pip in a recess or as a
    dark disc over a light. Every one of the three has to stand proud of the pack,
    and the bezel has to be proudest with the core inside it and the well behind
    the core - all three of which are a clean frame either way.
  */
  it('stacks bezel in front of core in front of well, all proud of the pack', () => {
    const bezelFront = port.bezelZ - port.bezelDepth / 2
    const coreFront = port.coreZ - port.coreDepth / 2
    const wellFront = port.wellZ - port.wellDepth / 2
    expect(bezelFront).toBeLessThan(rearFace)
    expect(coreFront).toBeLessThan(rearFace)
    expect(wellFront).toBeLessThan(rearFace)
    expect(bezelFront).toBeLessThan(coreFront)
    expect(coreFront).toBeLessThan(wellFront)
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
    const portFront = port.bezelZ - port.bezelDepth / 2
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
  const headSide = HEAD_SHELL.width / 2
  const outer = socketX + EAR_POD_SHAPE.halfThickness

  it('reaches the outer extent the width ladder is built on', () => {
    // docs/design/05-character-vfx.md: "Ear pod outer extent is 0.380 + 0.105 =
    // 0.485, so the head's total width including pods is 0.97 m. That is
    // deliberately the widest thing on the character."
    expect(outer).toBeCloseTo(0.485, 12)
    expect(outer * 2).toBeCloseTo(0.97, 12)
  })

  /*
    The regression this file exists to prevent. At the half-thickness this
    shipped with, `outer` was 0.420 against a head side of 0.360, so the pod
    stood 0.06 proud, was seen nearly end on, and read as a crescent-shaped hole
    in the cheek rather than as a pod. Anything under about 0.10 puts it back
    there.
  */
  it('protrudes far enough to read as a pod rather than as a hole in the cheek', () => {
    expect(outer - headSide).toBeGreaterThan(0.1)
  })

  it('stays buried in the shell, so it cannot float free of the head', () => {
    const inner = socketX - EAR_POD_SHAPE.halfThickness
    expect(inner).toBeLessThan(headSide)
    expect(headSide - inner).toBeGreaterThan(0.05)
  })

  /*
    A RoundedBox is only flat away from its corner rounds. A pod straddling one
    would leave a crescent gap between its own rim and the shell, which is the
    same artefact by a different route.
  */
  it('lands entirely on the flat part of the shell side', () => {
    expect(Math.abs(REST.earPodL.y) + EAR_POD_SHAPE.radius).toBeLessThanOrEqual(
      HEAD_SHELL.height / 2 - HEAD_SHELL.radius,
    )
    expect(Math.abs(REST.earPodL.z) + EAR_POD_SHAPE.radius).toBeLessThanOrEqual(
      HEAD_SHELL.depth / 2 - HEAD_SHELL.radius,
    )
  })

  it('is mirrored, which is half of what the critique said it was missing', () => {
    expect(REST.earPodL.x).toBeCloseTo(-REST.earPodR.x, 12)
    expect(REST.earPodL.y).toBe(REST.earPodR.y)
    expect(REST.earPodL.z).toBe(REST.earPodR.z)
  })

  /*
    Builds the pod exactly as `robotParts.tsx` does and checks it is a solid of
    the right size. A generator that returns an empty buffer is this codebase's
    signature failure: the mesh vanishes, the frame looks clean and the counters
    stay healthy.
  */
  it('lathes into a non-empty solid of the right extent', () => {
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
