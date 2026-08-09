/**
 * The three shapes the character needs that no primitive provides.
 *
 * Pure functions over `BufferGeometry` and `Vector2`, with no React and no
 * scene dependency, so they are unit testable under the existing vitest glob.
 * `src/art/flowerGeometry.ts` is the precedent.
 *
 * Deliberately local to the player for now. `src/art/geometry.ts` is the shared
 * kit and already owns the two operations these feed into - `beveledExtrude`
 * for the face plate and `latheProfile` for the ear pods - so the outline and
 * profile generators here should be consolidated into it once the character has
 * settled. They are not there today only because that file is being written by
 * another pass at the same time as this one.
 *
 * Nothing here is called per frame. Every geometry is built once at module load
 * or in a `useMemo`, because a `BufferGeometry` rebuilt each frame is a fresh
 * GPU upload and the single most expensive mistake available in this area.
 */

import { BufferGeometry, Float32BufferAttribute, Vector2 } from 'three'

// ---------------------------------------------------------------------------
// Shape parameters, kept beside the generators rather than in the component.
//
// They are geometry, so they belong where the geometry is testable. The part
// table in docs/design/05-character-vfx.md section 1 is their source and the
// numbers below are its `w x h x d` column halved where the generator wants a
// half-extent.
// ---------------------------------------------------------------------------

/** The squircle face plate. 0.56 x 0.38 with a 0.012 bevel on a 0.012 extrusion. */
export const FACE_PLATE = {
  a: 0.28,
  b: 0.19,
  /** n = 4 is the classic squircle, and the reference brief's "neither square nor round". */
  n: 4,
  segments: 64,
  depth: 0.012,
  bevel: 0.01,
} as const

/** The ear pods, whose axis lies along X so they flap forward and back rather than up and down. */
export const EAR_POD_SHAPE = {
  radius: 0.105,
  halfThickness: 0.04,
  fillet: 0.022,
  filletSteps: 4,
  radialSegments: 20,
} as const

/**
 * The torso. 0.62 x 0.36 x 0.52 at its half-extents, tapering to 0.84 of its
 * width at the crown.
 */
export const TORSO = {
  a: 0.31,
  b: 0.18,
  c: 0.26,
  e1: 0.6,
  e2: 0.7,
  taperTop: 0.84,
  latSegments: 20,
  lonSegments: 28,
} as const

/**
 * A Lame superellipse: `|x/a|^n + |y/b|^n = 1`.
 *
 * `n = 2` is an ellipse and `n` to infinity is a rectangle. `n = 4` is the
 * classic squircle, and it is what the reference brief means when it describes
 * the face as "neither square nor round, but somewhere in between". A plain
 * ellipse reads as a porthole and a rounded rectangle reads as a screen; only
 * the curve between them reads as a moulded window.
 *
 * Uniform sampling in theta clusters vertices unevenly for `n > 2`, putting
 * more of them along the flats than at the corners where they would do more
 * good. At 64 segments the corner error is under 0.4 mm at the face plate's
 * size, which is invisible. Resampling by arc length would be more correct and
 * is not worth doing until something needs a much coarser outline.
 */
export function superellipsePoints(a: number, b: number, n: number, segments: number): Vector2[] {
  if (!(a > 0) || !(b > 0)) {
    throw new Error(`robotGeometry: superellipse needs positive half-extents, got a=${a} b=${b}`)
  }
  if (!(n >= 2)) {
    throw new Error(`robotGeometry: superellipse exponent must be at least 2 to stay convex, got ${n}`)
  }
  if (!Number.isInteger(segments) || segments < 8) {
    throw new Error(`robotGeometry: superellipse needs at least 8 segments, got ${segments}`)
  }

  const out: Vector2[] = []
  const e = 2 / n
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2
    const c = Math.cos(th)
    const s = Math.sin(th)
    out.push(
      new Vector2(
        a * Math.sign(c) * Math.pow(Math.abs(c), e),
        b * Math.sign(s) * Math.pow(Math.abs(s), e),
      ),
    )
  }
  return out
}

/**
 * A disc lying on its side, with both rims filleted, as a lathe profile.
 *
 * A bare `CylinderGeometry` has two 90 degree rims and the reference brief is
 * explicit that a moulded plastic object never has a 90 degree corner anywhere.
 * On a part this small the fillet is most of what the eye reads, because it is
 * the only surface that catches the key light as a bright line.
 *
 * Points are `(radius, height)` for `latheProfile`, which revolves about Y. The
 * caller rotates the result so the disc's axis lies along X.
 *
 * The profile runs from the axis outward across the top face, around the top
 * fillet, down the rim, around the bottom fillet, and back to the axis.
 */
export function roundedDiscProfile(
  radius: number,
  halfThickness: number,
  fillet: number,
  filletSteps: number,
): Vector2[] {
  if (!(fillet > 0) || fillet >= radius || fillet >= halfThickness) {
    throw new Error(
      `robotGeometry: a disc fillet of ${fillet} does not fit inside radius ${radius} and ` +
        `half-thickness ${halfThickness}; the profile would fold through itself`,
    )
  }

  const points: Vector2[] = []
  const inner = radius - fillet
  const flat = halfThickness - fillet

  points.push(new Vector2(0, halfThickness))
  points.push(new Vector2(inner, halfThickness))
  // Top fillet, sweeping from straight up round to straight out.
  for (let i = 1; i <= filletSteps; i++) {
    const a = (i / filletSteps) * (Math.PI / 2)
    points.push(new Vector2(inner + fillet * Math.sin(a), flat + fillet * Math.cos(a)))
  }
  /*
    Bottom fillet, the mirror, sweeping from straight out back round to straight
    down. It runs to `filletSteps - 1` and the flat point is pushed separately,
    because the arc's own last sample lands exactly on it and `latheProfile`
    rejects coincident points: three derives each profile point's normal from
    its neighbours, so a duplicate gives a zero-length normal ring which renders
    without erroring and shades wrong along one band.
  */
  for (let i = 0; i < filletSteps; i++) {
    const a = (Math.PI / 2) * (1 - i / filletSteps)
    points.push(new Vector2(inner + fillet * Math.sin(a), -flat - fillet * Math.cos(a)))
  }
  points.push(new Vector2(inner, -halfThickness))
  points.push(new Vector2(0, -halfThickness))
  return points
}

export type SuperellipsoidOptions = {
  /** Half-extents on x, y and z before the taper. */
  a: number
  b: number
  c: number
  /** Vertical squareness. 1 is an ellipsoid, near 0 is a box. */
  e1: number
  /** Horizontal squareness. */
  e2: number
  /** Width multiplier at the crown. Below 1 makes the shape wider at the base. */
  taperTop: number
  latSegments: number
  lonSegments: number
}

/** `sign(t) * |t|^e`, the superquadric power that keeps the sign through a fractional exponent. */
function sp(t: number, e: number): number {
  return Math.sign(t) * Math.pow(Math.abs(t), e)
}

/**
 * A superellipsoid with a per-latitude taper, for the torso.
 *
 * The reference calls the torso "ovoid, wider at the base". A `RoundedBox`
 * cannot taper and a `SphereGeometry` cannot be square-ish, so it needs
 * generating. `e1` and `e2` at 0.60 and 0.70 give the soft rounded block that
 * reads as a moulded torso rather than as an egg.
 *
 * Normals come from `computeVertexNormals` rather than from the analytic form.
 * The analytic normal of a superellipsoid has a removable singularity at the
 * poles and at each of the four seams where a `cos` or `sin` term crosses zero,
 * and evaluating it by hand produces NaN normals along exactly those lines.
 * Averaged face normals do not, and at this smoothness the difference is not
 * visible.
 *
 * A note for anyone measuring the result: the taper is applied at every
 * latitude including the equator, where it is already at its midpoint. So the
 * widest point of the solid is `a * mix(1, taperTop, 0.5)` rather than `a`. The
 * design spec's claim that these parameters give "0.62 wide at the base" is
 * therefore not what they produce - the true maximum width is 0.57 - and that
 * is fine and arguably better, because the diaper below it is the 0.62 band and
 * a torso narrower than the hips is the waist the silhouette wants.
 */
export function taperedSuperellipsoid(opts: SuperellipsoidOptions): BufferGeometry {
  const { a, b, c, e1, e2, taperTop, latSegments, lonSegments } = opts
  if (latSegments < 3 || lonSegments < 3) {
    throw new Error(
      `robotGeometry: superellipsoid needs at least 3 segments on each axis, ` +
        `got ${latSegments} x ${lonSegments}`,
    )
  }

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  /*
    One extra longitude column, duplicating the first.

    The duplicate carries u = 1 where the original carries u = 0, so the UV seam
    is a clean edge rather than a band where the whole texture reverses across
    one triangle. It costs `latSegments + 1` vertices and it is the standard fix.
  */
  for (let iv = 0; iv <= latSegments; iv++) {
    const fv = iv / latSegments
    const v = -Math.PI / 2 + fv * Math.PI
    const sinV = Math.sin(v)
    const cosV = Math.cos(v)

    // 0 at the base, 1 at the crown, smoothstepped so the taper has no crease.
    const t = (sinV + 1) / 2
    const smooth = t * t * (3 - 2 * t)
    const taper = 1 + (taperTop - 1) * smooth

    const py = b * sp(sinV, e1)
    const rim = sp(cosV, e1)

    for (let iu = 0; iu <= lonSegments; iu++) {
      const fu = iu / lonSegments
      const u = -Math.PI + fu * Math.PI * 2
      positions.push(
        a * taper * rim * sp(Math.cos(u), e2),
        py,
        c * taper * rim * sp(Math.sin(u), e2),
      )
      uvs.push(fu, fv)
    }
  }

  const stride = lonSegments + 1
  for (let iv = 0; iv < latSegments; iv++) {
    for (let iu = 0; iu < lonSegments; iu++) {
      const p0 = iv * stride + iu
      const p1 = p0 + 1
      const p2 = p0 + stride
      const p3 = p2 + 1
      // Both pole rings collapse to a single point, so one triangle of each
      // quad there is degenerate. Emitting it would put zero-area faces into
      // `computeVertexNormals`, which contributes a zero-length normal to the
      // pole vertex and shades the crown flat.
      if (iv !== 0) indices.push(p0, p2, p1)
      if (iv !== latSegments - 1) indices.push(p1, p2, p3)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  /*
    Both pole rings are a fan around a single point, so the `lonSegments + 1`
    vertices there are coincident and one of them is referenced by no triangle
    at all. `computeVertexNormals` leaves an unreferenced vertex at (0, 0, 0),
    which `Vector3.normalize` keeps as (0, 0, 0) rather than turning into a NaN
    anything would report. It is never rasterised so it is harmless today, and
    it is exactly the shape of defect this codebase keeps being cut by, so it
    gets the correct answer instead: the pole normal of a superellipsoid is the
    axis. Writing it for the whole ring also smooths the crown, which otherwise
    shades as a visible fan.
  */
  const normals = geometry.getAttribute('normal')
  const lastRow = latSegments * stride
  for (let i = 0; i < stride; i++) {
    normals.setXYZ(i, 0, -1, 0)
    normals.setXYZ(lastRow + i, 0, 1, 0)
  }
  normals.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
