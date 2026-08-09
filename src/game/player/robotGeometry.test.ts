import { describe, it, expect } from 'vitest'
import { latheProfile } from '@/art/geometry'
import {
  EAR_POD_SHAPE,
  FACE_PLATE,
  roundedDiscProfile,
  superellipsePoints,
  sdRoundBox,
  taperedSuperellipsoid,
  TORSO,
  VISOR,
} from './robotGeometry'

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
  The visor's SDF geometry.

  This exists because the shader is not testable and its failure mode is
  silence. The arithmetic is well-formed for any parameters, so a wrong
  half-extent produces an invisible bar on a black plate rather than an error,
  and the only two places that shows are a screenshot and here. It shipped
  invisible once already, from the design spec's own numbers.
*/
describe('the visor SDF', () => {
  const bar = (px: number, py: number) =>
    sdRoundBox(px, py - VISOR.y, VISOR.barHalfW, VISOR.barHalfH, VISOR.barRadius)

  it('is solid at the centre of the slot', () => {
    // Negative is inside. Zero would mean the bar sits exactly on its own
    // boundary everywhere, which is the degenerate case that shipped.
    expect(bar(0, VISOR.y)).toBeCloseTo(-VISOR.barRadius, 9)
  })

  it('is a stadium 0.490 by 0.060 in plate space', () => {
    expect(bar(0, VISOR.y + VISOR.barHalfH)).toBeCloseTo(0, 9)
    expect(bar(0, VISOR.y - VISOR.barHalfH)).toBeCloseTo(0, 9)
    expect(bar(VISOR.barHalfW, VISOR.y)).toBeCloseTo(0, 9)
    expect(bar(-VISOR.barHalfW, VISOR.y)).toBeCloseTo(0, 9)
    expect(bar(0, VISOR.y + VISOR.barHalfH * 2)).toBeGreaterThan(0)
    expect(bar(VISOR.barHalfW * 1.5, VISOR.y)).toBeGreaterThan(0)
  })

  it('spans 77 per cent of the plate width, in world metres', () => {
    // Both plate-space axes are at the same scale, which is the whole point of
    // the aspect multiply and the thing the spec's three conflicting figures
    // for this bar all miss.
    const worldWidth = VISOR.barHalfW * 2 * VISOR.metresPerUnit
    const worldHeight = VISOR.barHalfH * 2 * VISOR.metresPerUnit
    expect(worldWidth).toBeCloseTo(0.43, 2)
    expect(worldHeight).toBeCloseTo(0.048, 3)
    expect(worldWidth / 0.56).toBeCloseTo(0.77, 2)
  })

  it('fits inside the plate on both axes', () => {
    // Plate space x runs over +-aspect/2 and y over +-0.5. A bar that overran
    // either would be clipped by the quad rather than by the housing.
    expect(VISOR.barHalfW).toBeLessThan(VISOR.aspect / 2)
    expect(Math.abs(VISOR.y) + VISOR.barHalfH).toBeLessThan(0.5)
  })

  it('makes the ends true semicircles', () => {
    expect(VISOR.barRadius).toBeCloseTo(VISOR.barHalfH, 9)
  })

  it('puts the two cores near the ends of the slot rather than in the middle', () => {
    expect(VISOR.coreOffset / VISOR.barHalfW).toBeGreaterThan(0.6)
    expect(VISOR.coreOffset / VISOR.barHalfW).toBeLessThan(0.85)
  })

  /*
    The regression this file exists for.

    The spec's (0.215, 0.0) fed to the iq body it also ships gives exactly zero
    at the centre of the bar, so `1 - smoothstep(-aa, aa, 0)` is 0.5 at the
    brightest point and the alpha it multiplies collapses. Pinned as an explicit
    negative, so nobody re-derives the "documented" numbers from the spec.
  */
  it('would be a zero-height line at the half-extents the spec gives', () => {
    expect(sdRoundBox(0, 0, 0.215, 0.0, 0.03)).toBe(0)
    expect(sdRoundBox(0, 0.0001, 0.215, 0.0, 0.03)).toBeGreaterThan(0)
  })

  /*
    The identity constraint, and the one thing about this face that must not
    regress. The reference's character loses its eyes on a blink; this one keeps
    a lit line, and that difference is the entire reason the visor is a bar
    rather than two panels.
  */
  it('keeps the bar lit through a full blink', () => {
    // openL and openR bottom out at 0.06, never zero, and the bar is a separate
    // shape from the cores, so the slot cannot go dark whatever they do.
    for (const open of [1, 0.5, 0.06]) {
      const core = sdRoundBox(
        0 - VISOR.coreOffset,
        0,
        VISOR.coreHalfW,
        VISOR.coreHalfH * open,
        Math.min(VISOR.coreHalfH * open, VISOR.coreHalfW) * 0.92,
      )
      expect(Number.isFinite(core)).toBe(true)
      // Whatever the cores do, the bar under them is still solid.
      expect(bar(-VISOR.coreOffset, VISOR.y)).toBeLessThan(0)
    }
  })

  /*
    Why `coreMask *= barMask` is load-bearing rather than defensive: at full
    gaze and full width a core genuinely does reach outside the slot, so without
    the clip a surprised glance puts a glowing blob outside its housing.
  */
  it('lets a core overrun the slot, which is why it is clipped to it', () => {
    const reach = VISOR.coreOffset + VISOR.gazeX + VISOR.coreHalfW * 1.4
    expect(reach).toBeGreaterThan(VISOR.barHalfW)
  })

  it('puts the slot low on the plate, which is the infantile placement', () => {
    // 57% down from the top of a plate spanning +-0.5.
    expect(0.5 - VISOR.y).toBeCloseTo(0.57, 9)
  })
})
