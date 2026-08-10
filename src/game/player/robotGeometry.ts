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

/**
 * The head shell, as a block rather than as four literals in the component.
 *
 * Here because the ear pods have to be sized against it: a pod that does not
 * clear the shell's side reads as a dent in the cheek rather than as a pod, and
 * a pod that clears it by too much floats free of the head. Both of those are
 * decided by arithmetic between this block and `EAR_POD_SHAPE`, and neither is
 * visible in a screenshot until someone stares at the face.
 *
 * Corner radius 0.110 at smoothness 4 is six segments per corner arc and a 1.9
 * degree facet. Going to 5 costs geometry for nothing visible at this size;
 * below 4 puts steps on the terminator.
 */
export const HEAD_SHELL = {
  width: 0.72,
  height: 0.54,
  depth: 0.62,
  radius: 0.11,
  smoothness: 4,
} as const

/**
 * The ear pods, whose axis lies along X so they flap forward and back rather
 * than up and down.
 *
 * `halfThickness` is 0.105 and not the 0.040 this shipped with, and the change
 * is the fix for "there is a hole in the character's face" in
 * `.critique/round1-findings.md`. At 0.040 the pod spans x 0.340 to 0.420
 * against a head whose flat side is at 0.360, so five sixths of it is buried
 * and the only part on screen is a 0.06 m crescent of its own rim, seen almost
 * exactly edge on because the axis points at the camera's left. A dark crescent
 * hugging the inside of the cheek's silhouette is a gouge, and both critique
 * reviewers read it as one.
 *
 * The design spec disagrees with itself about which number is right. Its part
 * table gives the pod as `0.08 x 0.21 x 0.21`, which is halfThickness 0.040.
 * Two paragraphs later the same section computes the outer extent as
 * `0.380 + 0.105 = 0.485` and builds the width ladder on it - "head including
 * ear pods, 0.970, deliberately the widest thing on the character" - and its
 * silhouette test draws the pods breaking the head's boxy top corners. That
 * second number is the one three separate claims depend on, so it is the one
 * taken: it uses the RADIUS as the extent along the pod's own axis, which is
 * only true when the half-thickness equals the radius.
 *
 * So the pod becomes a filleted can 0.21 long and 0.21 across. It buries 0.085
 * in the shell, which is what keeps it attached with no stalk to model, and
 * stands 0.125 proud, which is what puts it outside the head's outline where it
 * cannot be read as a hole in it.
 *
 * The fillet goes 0.022 to 0.030 with a step more of resolution for the same
 * reason: at the old size it was the whole of what the eye read, and at this one
 * a 0.022 chamfer on a 0.21 object is barely over a pixel at playing distance.
 */
export const EAR_POD_SHAPE = {
  radius: 0.105,
  halfThickness: 0.105,
  fillet: 0.03,
  filletSteps: 5,
  radialSegments: 20,
} as const

/** The mitten hand. Here only because it is what fixes the character's width. */
export const HAND = { radius: 0.14 } as const

/**
 * The backpack block, and the vent that says the thing is powered.
 *
 * Here because the cape's clearance is measured against its rear face, and that
 * clearance is a number rather than a judgement: the back socket is deliberately
 * coincident with this block, so a cape panel placed at the socket starts inside
 * the pack and appears to grow out of the middle of it.
 *
 * The vent's corner radius is 0.008 and not the spec's 0.018 for the same reason
 * the chest panel's is 0.020 and not 0.045: the vent is 0.02 deep, so 0.018 is
 * over four times what fits. `RoundedBoxGeometry` silently clamps to half the
 * smallest dimension, so the specified value would not have errored, it would
 * have quietly produced a different shape.
 */
export const BACKPACK_BLOCK = {
  width: 0.36,
  height: 0.26,
  depth: 0.14,
  radius: 0.055,
  vent: {
    width: 0.22,
    height: 0.04,
    depth: 0.02,
    radius: 0.008,
    y: 0.03,
    z: -0.075,
  },
} as const

/**
 * One cape panel.
 *
 * A solid slab and not the `PlaneGeometry` this shipped with, which is the fix
 * for "a flat unlit magenta quad is attached to the character in every shot" in
 * `.critique/round1-findings.md`. A zero-thickness double-sided quad has one
 * normal over its whole area, so it takes exactly one lighting value however it
 * is lit and reads as unlit paint however good the rig is; it has no edge to
 * catch a bevel highlight; and seen anywhere near edge on it collapses to a
 * coloured line, which is what put "a purple line on the floor" into
 * `hub-character`.
 *
 * 0.030 thick with a 0.010 round leaves a 0.010 flat face between two bevels, so
 * the panel is a moulded vinyl plate with a highlight down each long edge rather
 * than a sheet of paper. The reference's world rule is that fabric is replaced
 * with vinyl and that visible joins between rigid panels are the point; a panel
 * with no thickness cannot have a join.
 *
 * `z` places the panel's FRONT face 0.010 clear of the pack's rear face, which
 * is the invariant the plane version held at its own zero thickness and which
 * `robotGeometry.test.ts` now checks rather than trusts.
 */
export const CAPE_PANEL = {
  width: 0.34,
  thickness: 0.03,
  bevel: 0.01,
  bevelSmoothness: 2,
  z: -0.095,
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
 * The visor glyph's shape, in face-plate space.
 *
 * Plate space runs `x` over `+-aspect/2` and `y` over `+-0.5`, where aspect is
 * the plate's own 0.56 by 0.38. These live here rather than inline in the
 * shader string so `robotGeometry.test.ts` can assert on them: the SDF is
 * perfectly well-formed arithmetic for any parameters, so a wrong half-extent
 * produces an invisible bar rather than an error, and the only two places that
 * shows are a screenshot and a test.
 */
export const VISOR = {
  /** Plate aspect, 0.56 wide over 0.38 tall. */
  aspect: 0.56 / 0.38,
  /**
   * Metres per unit of plate space.
   *
   * The fragment builds `p = (vUv - 0.5) * vec2(aspect, 1.0)`, so x runs over
   * `+-aspect/2` and y over `+-0.5`, and BOTH axes end up at the same scale:
   * one unit is 0.56 / aspect = 0.38 m. That is the entire point of the aspect
   * multiply and it is what the design spec's own numbers overlook. The spec
   * reads a half-extent of 0.215 as "0.274 m across a 0.56 m plate", which
   * would only hold if x ran over +-0.5, and separately calls the same bar 77%
   * of the plate width, which 0.274 over 0.56 is not either. Three figures,
   * none of which agree.
   */
  metresPerUnit: 0.38,
  /**
   * The slot's vertical centre: 57% down the plate rather than at its middle,
   * which is the infantile placement. Eyes at the vertical centre read as an
   * adult on any head shape.
   */
  y: -0.07,
  /**
   * Bar half-extents and corner radius, in the iq convention where the extent
   * IS `b` and `r` rounds the corners inward.
   *
   * Sized against the read rather than reverse-engineered from the spec: 0.430
   * by 0.048 m, which is 77% of the 0.56 m plate's width and matches the
   * proportion the previous character's 0.42 bar had against its 0.56 head. The
   * radius equals the half-height, so the ends are true semicircles and the
   * shape is a stadium.
   */
  barHalfW: 0.566,
  barHalfH: 0.063,
  barRadius: 0.063,
  /**
   * Eye core half-extents at neutral, and how far each sits from the centre.
   *
   * The cores sit at 74% of the way out along the bar, so they read as two
   * distinct nodes near its ends rather than as a bright patch in the middle,
   * and each is 0.057 by 0.042 m against a bar 0.048 m tall.
   */
  coreOffset: 0.42,
  coreHalfW: 0.075,
  coreHalfH: 0.055,
  /** Gaze travel, deliberately small so the cores stay inside their housing. */
  gazeX: 0.055,
  gazeY: 0.018,
  /** Antialias half-width in plate space, roughly 1.3 px at playing distance. */
  aa: 0.004,
} as const

/**
 * Signed distance to a rounded box, the standard iq form.
 *
 * `b` is the shape's full half-extent and `r` rounds its corners inward, so the
 * outer extent is `b` and not `b + r`. Duplicated from the visor's fragment
 * stage on purpose: the point of the test that uses it is to pin the geometry
 * the shader draws, and sharing an implementation would only prove the shader
 * equals itself.
 */
export function sdRoundBox(px: number, py: number, bx: number, by: number, r: number): number {
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  return (
    Math.min(Math.max(dx, dy), 0) +
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) -
    r
  )
}

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
 * "Disc" is the shape it was written for rather than a constraint: with
 * `halfThickness` equal to `radius` the same profile produces a filleted can,
 * which is what the ear pods are now.
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
