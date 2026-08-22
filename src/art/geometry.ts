import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
} from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The geometry kit: parameterised generators for every shape in the built world.
 *
 * **Why generators rather than scaled instances**, since this is the decision
 * somebody will eventually try to "optimise" away.
 *
 * A rounded box scaled non-uniformly gets an elliptical fillet. The portal
 * stack's T1 deck is 12 x 2.0 x 4.0, and reaching that from a 4 x 0.4 x 4 base
 * would need a scale of (3, 5, 1), which turns a uniform 0.12 fillet into a
 * 0.36 x 0.60 x 0.12 one. That is plainly visible, and "never a 90-degree hard
 * corner, every edge takes a bevel that catches the key as a bright line" is a
 * world rule here rather than a preference, so a wrong bevel is not cosmetic.
 *
 * The architecture is static, so the answer is not instancing but merging: call
 * a generator once per placement at mount, then fold every result sharing a
 * material into one `BufferGeometry` with `mergeProp`. Correct bevels
 * everywhere, one draw call per material for the entire built environment.
 * Instancing stays the right tool for the numerous, identical, uniformly scaled
 * small stuff - pylons, crystal shards, pads, fins.
 *
 * **Every function here is pure and needs no GL context.** `BufferGeometry` is
 * plain typed arrays until a renderer uploads it, which is what makes the whole
 * file unit-testable headlessly, and that is deliberate: a bevel that comes out
 * elliptical or a lathe that emits NaN normals is exactly the class of bug that
 * survives visual review and then makes the lighting look inexplicably wrong.
 *
 * **Origin convention.** Anything that stands on a surface returns geometry
 * whose origin is the centre of its footprint on its base plane, so a piece
 * placed at (x, y, z) has its bottom at y. The two exceptions are `nodeCore` and
 * `nodeShell`, which are centred on their own centres because they hang in the
 * air and are positioned by their middles, and `beveledExtrude`, which is a raw
 * primitive that preserves the cross-section coordinates it was handed.
 *
 * See `docs/design/03-environment.md` section 4 and `docs/design/02-materials.md`
 * section 6.
 */

/** Radial segments on anything revolved, unless a caller says otherwise. */
const DEFAULT_RADIAL_SEGMENTS = 32

/**
 * Smallest arc-length step allowed between two samples of a fillet, in metres.
 *
 * This is a hard constraint imported from `toCreasedNormals`, not a taste
 * value. That function hashes vertices with `~~(position * 1e2)`, which
 * quantises to one centimetre, so any two samples closer together than that get
 * treated as the same vertex and have their face normals averaged together.
 * On a fillet that silently flattens the very bevel the fillet exists to
 * create. Rather than let a caller trip over it, `beveledExtrude` reduces its
 * own segment count until the spacing clears this.
 */
const MIN_CREASE_SPACING = 0.015

/**
 * Default crease angle for bevelled extrusions, in radians. About 29 degrees.
 *
 * Every generator here bevels its edges, which means two flat faces are never
 * actually adjacent: they are separated by a run of bevel steps. So a crease
 * angle above the bevel step size smooths the whole fillet into a continuous
 * rounded edge, which is the read the art direction wants, while still creasing
 * anything genuinely sharp such as a crystal facet.
 */
const DEFAULT_CREASE_ANGLE = 0.5

/**
 * Radius of the degenerate corner arcs inserted before bevelling, in metres.
 *
 * See `roundedOutline` for what this is for. It has to be small enough to be
 * invisible and large enough that the triangulator does not collapse the
 * corner, and 10 microns satisfies both by a wide margin at world scale.
 */
const CORNER_EPSILON = 1e-5

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type LatheProfileOptions = {
  /** Profile points as (radius, height). Radius must never be negative. */
  points: Vector2[]
  radialSegments?: number
}

/**
 * A surface of revolution from an explicit profile.
 *
 * Thin over `LatheGeometry`, and the value it adds is the validation. three
 * derives each profile point's normal from its neighbours, so two consecutive
 * identical points produce a zero-length normal, which `Vector3.normalize`
 * turns into `(0, 0, 0)` rather than into NaN. That is worse than a crash: the
 * geometry renders, the shading goes subtly wrong along one ring, and nothing
 * anywhere reports a problem. So duplicates are rejected at the door.
 */
export function latheProfile({ points, radialSegments = DEFAULT_RADIAL_SEGMENTS }: LatheProfileOptions): BufferGeometry {
  if (points.length < 2) {
    throw new Error(`geometry: a lathe profile needs at least 2 points, got ${points.length}`)
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error(`geometry: lathe profile point ${i} is not finite: (${p.x}, ${p.y})`)
    }
    if (p.x < 0) {
      throw new Error(`geometry: lathe profile point ${i} has negative radius ${p.x}`)
    }
    if (i > 0 && points[i - 1].distanceToSquared(p) < 1e-14) {
      throw new Error(
        `geometry: lathe profile points ${i - 1} and ${i} are coincident at (${p.x}, ${p.y}), ` +
          `which produces a zero-length normal ring that renders without erroring`,
      )
    }
  }

  const geometry = new LatheGeometry(points, radialSegments)

  /*
    three leaves the LAST profile point's normal un-normalised, and the length
    it comes out at is the length of the final profile segment.

    `LatheGeometry` copies `prevNormal` before calling `normalize()` in its
    first-point case, and its last-point case pushes that raw `prevNormal`
    straight into the buffer. So a 6 m puck, whose closing segment runs 5.9 m
    from the rim to the axis, ships a normal of length 5.9 on its entire top
    centre ring. Nothing renders wrong today because three normalises again in
    the vertex shader, but the attribute is a lie the moment anything reads it
    directly - which `mergeProp` and `paintByFacing` both do, and which
    `toCreasedNormals` would too. Fixing it here costs one pass over the buffer
    at mount and makes every downstream assumption about this file true.
  */
  geometry.normalizeNormals()
  return geometry
}

export type RoundedCylinderOptions = {
  /** Radius at the base, which is the widest point once draft is applied. */
  radius: number
  height: number
  /** Fillet radius on the top rim. */
  topFillet?: number
  /** Fillet radius on the bottom rim. Small by default: it sits against a floor. */
  bottomFillet?: number
  /**
   * Mould draft, in degrees. The side leans in as it rises, which is what a
   * part has to do to come out of a tool. 1.5 degrees is the documented
   * minimum; 3 is the house value for a puck.
   */
  draftDegrees?: number
  radialSegments?: number
  /** Samples per fillet quarter-arc. 3 under 40 mm, 5 for anything larger. */
  filletSegments?: number
}

/**
 * A cylinder whose rims are filleted rather than cut off square.
 *
 * **The single most useful generator in this file.** This world is pucks,
 * buttons and pills, and every one of them was previously faked with a
 * `cylinderGeometry`, whose caps meet its side at exactly 90 degrees. A hard
 * rim is the most conspicuous possible violation of the moulded-object rule,
 * because the rim is the silhouette: it is the edge the key light is supposed
 * to catch as a bright line, and on a square rim it catches nothing at all.
 *
 * Built as a lathe rather than as a scaled `RoundedBox` for the reason in the
 * file header - the fillet has to stay circular independently of the piece's
 * proportions, and only a generator can promise that.
 *
 * The draft is applied by tapering the finished profile rather than by building
 * the fillet arcs against a sloped side. At three degrees the difference is a
 * fillet squashed by `cos(3 deg)`, which is 0.9986, and paying for the exact
 * construction to recover 0.14% of a 100 mm rim would be silly.
 */
export function roundedCylinder({
  radius,
  height,
  topFillet = 0.1,
  bottomFillet = 0.05,
  draftDegrees = 0,
  radialSegments = DEFAULT_RADIAL_SEGMENTS,
  filletSegments = 4,
}: RoundedCylinderOptions): BufferGeometry {
  if (!(radius > 0) || !(height > 0)) {
    throw new Error(`geometry: roundedCylinder needs positive radius and height, got ${radius} x ${height}`)
  }

  /*
    Fillets are clamped rather than rejected. A caller asking for a 0.10 rim on
    a 0.10 puck is asking for a lens, which is a legitimate shape, and the two
    fillets meeting in the middle is the correct degenerate case rather than an
    error. What is not legitimate is a fillet wider than the piece, which would
    fold the profile back through the axis and turn the object inside out.
  */
  const half = height / 2
  const top = Math.max(0, Math.min(topFillet, half, radius * 0.98))
  const bottom = Math.max(0, Math.min(bottomFillet, half, radius * 0.98))

  const points: Vector2[] = []
  /*
    Skips a point coincident with the one before it. That case is not
    hypothetical: a fillet of exactly half the height makes the two arcs meet at
    the widest point, which is a lens and a perfectly reasonable shape to ask
    for, but it puts the same point in the profile twice and a duplicate profile
    point is precisely what `latheProfile` refuses.
  */
  const push = (x: number, y: number) => {
    const last = points[points.length - 1]
    if (last && Math.abs(last.x - x) < 1e-7 && Math.abs(last.y - y) < 1e-7) return
    points.push(new Vector2(x, y))
  }

  push(0, 0)

  if (bottom > 0) {
    for (let i = 0; i <= filletSegments; i++) {
      const angle = -Math.PI / 2 + (i / filletSegments) * (Math.PI / 2)
      push(radius - bottom + Math.cos(angle) * bottom, bottom + Math.sin(angle) * bottom)
    }
  } else {
    push(radius, 0)
  }

  if (top > 0) {
    for (let i = 0; i <= filletSegments; i++) {
      const angle = (i / filletSegments) * (Math.PI / 2)
      push(radius - top + Math.cos(angle) * top, height - top + Math.sin(angle) * top)
    }
  } else {
    push(radius, height)
  }

  push(0, height)

  if (draftDegrees > 0) {
    const shrink = 1 - Math.min(0.9, (height * Math.tan((draftDegrees * Math.PI) / 180)) / radius)
    for (const p of points) {
      p.x *= 1 + (shrink - 1) * (p.y / height)
    }
  }

  return latheProfile({ points, radialSegments })
}

export type BeveledExtrudeOptions = {
  /**
   * The cross-section, in the XY plane, as a CONVEX polygon. Winding does not
   * matter; it is normalised internally.
   */
  outline: Vector2[]
  /** Extrusion distance along Z. The result is centred on Z = 0. */
  depth: number
  bevel?: number
  bevelSegments?: number
  creaseAngle?: number
}

/**
 * A convex prism with every one of its edges filleted, including the vertical
 * ones.
 *
 * The mechanism is worth explaining because it is not obvious and it is the
 * whole reason this produces a genuinely bevelled solid rather than a chamfered
 * slab with sharp vertical corners.
 *
 * `ExtrudeGeometry`'s bevel option does not round a polygon's corners. It insets
 * the contour near each cap and leaves the vertical edges exactly as sharp as
 * the polygon that produced them. The trick, which drei's `RoundedBox` also
 * uses, is to inset the outline by the bevel radius first and replace each of
 * its corners with a degenerate arc a few microns across. Those arc samples are
 * separate contour points, so the bevel pass offsets each one outward along its
 * own bisector, and a run of samples on a micron-scale corner offset by `bevel`
 * traces a quarter circle of radius `bevel`. The corner is round, the caps are
 * filleted, and one `ExtrudeGeometry` call did all of it.
 *
 * Convexity is required because the inset uses angle bisectors, which is only
 * valid where the polygon does not fold back on itself. Every cross-section
 * this world needs - rectangles, trapezoids, wedges - is convex.
 *
 * **Two consequences for anyone measuring the result.** The fillet is a
 * polygonal approximation, so an extreme of the outline is reproduced exactly
 * only where a corner sample happens to land on that face's normal, which for a
 * right angle at the default segment count it does. Elsewhere the surface lands
 * within one chord of the true arc, a few millimetres at world bevels. And an
 * ACUTE corner is genuinely cut back: a 68-degree apex filleted at 0.06 loses
 * about 0.047 along its bisector, because that is where a circle of that radius
 * fits. Both are correct - a mould cannot produce a sharp apex either - but a
 * caller sizing a ramp against a deck edge needs to know the tip is not where
 * the outline says it is.
 */
export function beveledExtrude({
  outline,
  depth,
  bevel = 0.12,
  bevelSegments = 4,
  creaseAngle = DEFAULT_CREASE_ANGLE,
}: BeveledExtrudeOptions): BufferGeometry {
  if (outline.length < 3) {
    throw new Error(`geometry: beveledExtrude needs at least 3 outline points, got ${outline.length}`)
  }
  if (!(depth > 0)) {
    throw new Error(`geometry: beveledExtrude needs positive depth, got ${depth}`)
  }

  const ccw = counterClockwise(outline)
  const inradius = minimumEdgeDistance(ccw)

  /*
    Two independent ceilings on the bevel, and both are degeneracy guards rather
    than aesthetics. Half the depth is the point at which the two cap fillets
    meet and the straight section vanishes; 0.49 of the inradius is the point at
    which the inset polygon collapses through itself. Past either, three emits a
    geometry full of NaN and no error.
  */
  const radius = Math.max(0, Math.min(bevel, depth / 2, inradius * 0.49))

  let segments = Math.max(1, Math.round(bevelSegments))
  if (radius > 0) {
    // See MIN_CREASE_SPACING. The arc is a quarter circle, so its length is
    // radius * PI / 2 and the spacing is that divided by the segment count.
    segments = Math.max(1, Math.min(segments, Math.floor((radius * Math.PI) / 2 / MIN_CREASE_SPACING)))
  }

  const contour = radius > 0 ? roundedOutline(insetConvex(ccw, radius), segments) : ccw

  const shape = new Shape()
  shape.moveTo(contour[0].x, contour[0].y)
  for (let i = 1; i < contour.length; i++) shape.lineTo(contour[i].x, contour[i].y)
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - 2 * radius,
    steps: 1,
    bevelEnabled: radius > 0,
    bevelSize: radius,
    bevelThickness: radius,
    bevelOffset: 0,
    bevelSegments: segments,
    curveSegments: 1,
  })

  /*
    `ExtrudeGeometry` spans Z from -bevelThickness to depth-parameter +
    bevelThickness, which is -radius to depth - radius once the parameter is
    substituted. Recentring makes the result symmetric about Z = 0 with the
    exact requested depth, which is what lets a caller position by centre and
    trust the number they typed.
  */
  geometry.translate(0, 0, radius - depth / 2)

  return toCreasedNormals(geometry, creaseAngle)
}

export type ChamferedBoxOptions = {
  width: number
  height: number
  depth: number
  bevel?: number
  bevelSegments?: number
  creaseAngle?: number
}

/**
 * A box with a uniform fillet on all twelve edges, sitting on its base plane.
 *
 * The fillet policy from the materials spec is `r = k * d_min` with `k = 0.05`
 * for world geometry, floored at 8 mm and at 15 mm for anything read from more
 * than five metres, and capped at `0.25 * d_min`. This function enforces only
 * the cap, because the floors are a screen-space argument about the camera
 * rather than a property of the shape, and baking a camera assumption into a
 * geometry generator is how a kit stops being reusable.
 */
export function chamferedBox({
  width,
  height,
  depth,
  bevel = 0.12,
  bevelSegments = 4,
  creaseAngle = DEFAULT_CREASE_ANGLE,
}: ChamferedBoxOptions): BufferGeometry {
  if (!(width > 0) || !(height > 0) || !(depth > 0)) {
    throw new Error(`geometry: chamferedBox needs positive dimensions, got ${width} x ${height} x ${depth}`)
  }
  const capped = Math.min(bevel, 0.25 * Math.min(width, height, depth))
  const geometry = beveledExtrude({
    outline: [
      new Vector2(-width / 2, -height / 2),
      new Vector2(width / 2, -height / 2),
      new Vector2(width / 2, height / 2),
      new Vector2(-width / 2, height / 2),
    ],
    depth,
    bevel: capped,
    bevelSegments,
    creaseAngle,
  })
  geometry.translate(0, height / 2, 0)
  return geometry
}

export type TubeFromCurveOptions = {
  /** At least two points. Passed to a `CatmullRomCurve3`. */
  points: Array<Vector3 | [number, number, number]>
  radius?: number
  radialSegments?: number
  tubularSegments?: number
  closed?: boolean
  /** Catmull-Rom tension. 0.5 is the centripetal-ish default three ships. */
  tension?: number
}

/**
 * A tube swept along a smooth curve through a polyline.
 *
 * This is what a circuit trace is made of. The flat `planeGeometry` strips it
 * replaces were decals: a decal on the ground contributes no silhouette,
 * catches no light, and vanishes entirely at a grazing angle, which is the
 * angle the ground is seen at almost all the time. A tube has a cross-section,
 * so it reads as a wire lying on a surface, and where the route climbs a step
 * the spline rounds the transition into a short vertical arc - a wire that
 * climbs a step rather than a line painted onto one.
 */
export function tubeFromCurve({
  points,
  radius = 0.09,
  radialSegments = 6,
  tubularSegments = 48,
  closed = false,
  tension = 0.5,
}: TubeFromCurveOptions): BufferGeometry {
  if (points.length < 2) {
    throw new Error(`geometry: tubeFromCurve needs at least 2 points, got ${points.length}`)
  }
  const vectors = points.map((p, i) => {
    const v = Array.isArray(p) ? new Vector3(p[0], p[1], p[2]) : p
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      throw new Error(`geometry: tube point ${i} is not finite`)
    }
    return v
  })
  const curve = new CatmullRomCurve3(vectors, closed, 'catmullrom', tension)
  return new TubeGeometry(curve, tubularSegments, radius, radialSegments, closed)
}

export type PropPart = {
  geometry: BufferGeometry
  position?: [number, number, number]
  /** Euler XYZ, in radians. */
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}

/**
 * Bake a list of placed geometries into one.
 *
 * This is the function that turns a spec's worth of built environment into a
 * couple of draw calls, and it exists as a wrapper rather than as a bare
 * `mergeGeometries` call because that function has two failure modes that are
 * both silent.
 *
 * First, it returns `null` rather than throwing when the inputs disagree, and a
 * null geometry assigned to a mesh renders nothing while reporting nothing. So
 * this throws, loudly, naming the count.
 *
 * Second, "disagree" includes indexed versus non-indexed and any difference in
 * the attribute set. That matters here specifically because the generators in
 * this file mix sources: lathes, tubes and cylinders come back indexed, while
 * anything through `beveledExtrude` has been de-indexed by `toCreasedNormals`.
 * Normalising both up front is a few milliseconds at mount and removes an
 * entire category of "why is my deck invisible".
 *
 * Inputs are not consumed. Callers frequently merge the same generated shape
 * into several batches, so this clones before transforming and disposes only
 * its own clones.
 */
export function mergeProp(parts: PropPart[]): BufferGeometry {
  if (parts.length === 0) {
    throw new Error('geometry: mergeProp needs at least one part')
  }

  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const euler = new Euler()
  const position = new Vector3()
  const scale = new Vector3()

  const placed = parts.map(({ geometry, position: p, rotation: r, scale: s }) => {
    const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    position.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0)
    euler.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0)
    quaternion.setFromEuler(euler)
    if (typeof s === 'number') scale.setScalar(s)
    else scale.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1)
    matrix.compose(position, quaternion, scale)
    // `applyMatrix4` runs normals through the inverse transpose and renormalises
    // them, so a non-uniform scale here is safe rather than quietly wrong.
    clone.applyMatrix4(matrix)
    return clone
  })

  /*
    Reduce to the attributes every part has. A single geometry carrying a
    tangent or a colour that its neighbours lack is enough to make the merge
    return null, and dropping the odd one out is always what the caller wanted:
    the alternative is a batch that fails to draw because one prop was
    generated slightly differently.
  */
  const shared = placed.reduce<Set<string>>((keep, geometry, i) => {
    const names = new Set(Object.keys(geometry.attributes))
    return i === 0 ? names : new Set([...keep].filter((n) => names.has(n)))
  }, new Set<string>())

  for (const geometry of placed) {
    for (const name of Object.keys(geometry.attributes)) {
      if (!shared.has(name)) geometry.deleteAttribute(name)
    }
  }

  const merged = mergeGeometries(placed, false)
  for (const geometry of placed) geometry.dispose()

  if (!merged) {
    throw new Error(
      `geometry: mergeProp could not merge ${parts.length} parts. ` +
        `mergeGeometries returns null on any attribute mismatch, and the shared set was ` +
        `[${[...shared].join(', ')}]`,
    )
  }
  return merged
}

export type PaintByFacingOptions = {
  /** Colour applied where the surface faces up. */
  up: string
  /** Colour applied everywhere else. */
  side: string
  /**
   * Where the blend is centred, as a normal Y component. 0.55 puts the
   * changeover on the fillet rather than on either flat face.
   */
  threshold?: number
  /** Width of the blend in normal-Y units. Zero gives a hard line. */
  softness?: number
}

/**
 * Give a geometry a vertex colour that depends on which way each vertex faces.
 *
 * This is how the deck batch keeps its two authored values while staying one
 * draw call. The environment spec puts deck and puck tops at luma 0.735 and
 * their side faces at 0.589, a separation of 0.15 which is most of what makes a
 * raised platform read as raised in a desaturated frame. Two colours normally
 * mean two materials, and two materials mean two draw calls per batch on top of
 * the shadow pass, which is most of the budget for the whole built environment.
 *
 * Vertex colours are written in the LINEAR working space, which is what three
 * expects from a colour attribute and is why the values go through `Color`
 * rather than being parsed by hand: `Color.setStyle` decodes sRGB on assignment,
 * so the numbers that land in the buffer are already the ones the shader wants.
 * Tagging them as sRGB instead is the classic way this comes out washed.
 *
 * The material must set `vertexColors: true` and keep its own `color` at white,
 * since three multiplies the two.
 */
export function paintByFacing(
  geometry: BufferGeometry,
  { up, side, threshold = 0.55, softness = 0.25 }: PaintByFacingOptions,
): BufferGeometry {
  const normals = geometry.getAttribute('normal')
  if (!normals) {
    throw new Error('geometry: paintByFacing needs a normal attribute')
  }

  const upColor = new Color(up)
  const sideColor = new Color(side)
  const colors = new Float32Array(normals.count * 3)

  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i)
    const t =
      softness <= 0
        ? ny >= threshold
          ? 1
          : 0
        : Math.min(1, Math.max(0, (ny - (threshold - softness)) / (2 * softness)))
    // smoothstep, so the transition across a fillet has no visible band.
    const k = t * t * (3 - 2 * t)
    colors[i * 3] = sideColor.r + (upColor.r - sideColor.r) * k
    colors[i * 3 + 1] = sideColor.g + (upColor.g - sideColor.g) * k
    colors[i * 3 + 2] = sideColor.b + (upColor.b - sideColor.b) * k
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** One rung of a `paintByHeight` ramp: a local Y and the albedo at that height. */
export type HeightStop = { y: number; colour: string }

/**
 * Give a geometry a vertex colour that depends on how HIGH each vertex is.
 *
 * The companion to `paintByFacing`, and it exists because facing cannot express
 * a gradient down a cone. A lathe segment is one conical band with one normal,
 * so `paintByFacing` paints the whole band a single value however many stops the
 * profile has - which is exactly the defect measured on the island's skirt: a
 * flat 0.230 falling to 0.202 over ninety pixels, and the 0.028 of that fall was
 * the VIGNETTE rather than the surface. The island read as having a trim rather
 * than a thickness, and no amount of tuning the two facing colours could have
 * fixed it, because there was only ever one facing in frame.
 *
 * Height also happens to be the axis the art direction is stated on:
 * `docs/design/97-decision-shadow-end.md` asks for the underside to be
 * "darkest at the bottom of the silhouette", which is a statement about Y.
 *
 * Reads `position` rather than any assumption about vertex ORDER. `LatheGeometry`
 * emits its vertices azimuth-major, and a painter that indexed on that would be
 * one three release away from painting the island in stripes with a correct
 * triangle count and no error - the failure mode this codebase keeps paying for.
 *
 * Stops must run from the top down and must be strictly descending. A ramp
 * handed over in the wrong order silently collapses to its first colour, which
 * looks exactly like a painter that did not run, so it throws.
 *
 * Linear working space and a white material `color`, for the same reasons as
 * `paintByFacing`; see that comment.
 */
export function paintByHeight(geometry: BufferGeometry, stops: readonly HeightStop[]): BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position) {
    throw new Error('geometry: paintByHeight needs a position attribute')
  }
  if (stops.length < 2) {
    throw new Error(`geometry: paintByHeight needs at least two stops, got ${stops.length}`)
  }
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].y >= stops[i - 1].y) {
      throw new Error(
        `geometry: paintByHeight stops must descend, but stop ${i} at y ${stops[i].y} is not ` +
          `below stop ${i - 1} at y ${stops[i - 1].y}`,
      )
    }
  }

  const colours = stops.map((stop) => new Color(stop.colour))
  const colors = new Float32Array(position.count * 3)

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    let lower = 1
    while (lower < stops.length - 1 && y < stops[lower].y) lower++
    const upper = lower - 1
    const span = stops[upper].y - stops[lower].y
    // Clamped rather than extrapolated at both ends, so a vertex outside the
    // ramp takes the nearest authored value instead of an invented one.
    const t = span === 0 ? 1 : Math.min(1, Math.max(0, (y - stops[lower].y) / span))
    const a = colours[lower]
    const b = colours[upper]
    colors[i * 3] = a.r + (b.r - a.r) * t
    colors[i * 3 + 1] = a.g + (b.g - a.g) * t
    colors[i * 3 + 2] = a.b + (b.b - a.b) * t
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/**
 * Rewrite a geometry's UVs as a world-scale box projection.
 *
 * Merging is what buys the built environment its draw-call budget, and it is
 * also what destroys UVs. A batch holding a 12 m deck, a 6 m puck and a 0.7 m
 * plinth carries three unrelated UV conventions, none of them area-uniform, so
 * a single tiled material applied to the merged result puts the same stone at
 * three different sizes on three adjacent pieces of one structure. That is the
 * exact failure `HubIsland.tsx` already documents for the photographic stone,
 * arrived at from the other direction.
 *
 * The fix is to stop carrying the sources' UVs at all and derive them from
 * position instead, picking the axis pair each triangle most faces. Physical
 * scale then comes out identical everywhere by construction, and the authoring
 * unit becomes metres per tile, which is what the materials spec asks callers to
 * think in anyway.
 *
 * Applied AFTER the merge and after any transform, because it reads position in
 * whatever space the geometry is currently in. The classic seam of a box
 * projection - a visible break where the dominant axis flips - lands on the
 * fillets here rather than on a flat face, which is where it is least visible.
 */
export function boxProjectUV(geometry: BufferGeometry, metresPerTile: number): BufferGeometry {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  if (!normals) {
    throw new Error('geometry: boxProjectUV needs a normal attribute')
  }

  const scale = 1 / metresPerTile
  const uv = new Float32Array(positions.count * 2)

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const nx = Math.abs(normals.getX(i))
    const ny = Math.abs(normals.getY(i))
    const nz = Math.abs(normals.getZ(i))

    let u: number
    let v: number
    if (ny >= nx && ny >= nz) {
      u = x
      v = z
    } else if (nx >= nz) {
      u = z
      v = y
    } else {
      u = x
      v = y
    }

    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }

  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  return geometry
}

// ---------------------------------------------------------------------------
// The lightmap atlas
//
// `boxProjectUV` above derives a TILING, world-scale parameterisation and that is
// deliberate: every detail map in the project depends on the same stone being the
// same physical size on a 12 m deck and on a 0.7 m plinth. A lightmap wants the
// exact opposite - one texel per place, no repeats, nothing overlapping anything
// else - so it cannot share that UV set and needs a second one.
//
// **The second UV set is called `uv1`, and this is worth stating with the source
// citation because getting it wrong is silent.** In three 0.185.1 the set a map
// reads is chosen only by `texture.channel`: `WebGLPrograms.js` `getChannel()`
// returns `'uv'` for 0 and `` `uv${n}` `` for anything else, that string becomes
// `#define AOMAP_UV uv1` in `WebGLProgram.js`, and `uv_vertex.glsl.js` reads it
// into `vAoMapUv`. `uv2` is the THIRD set, not the second, which is the trap the
// old `aoMap`-defaults-to-UV2 folklore leaves behind. `textures.ts` already pins
// `channel = 0` on its ORM pack for the mirror image of this reason.
//
// A geometry missing the attribute a map's channel names does NOT error. WebGL
// hands the shader a zero attribute, every fragment samples texel (0, 0), and the
// result is a uniform multiply that looks like a slightly darker material. That is
// this project's signature failure and `assertLightmapUV` in `src/art/lightmap.ts`
// exists to catch exactly it.
//
// ## Why per part, per face, rather than a real unwrap
//
// The batches are one merged geometry each, so "unwrap the mesh" would mean
// unwrapping a 30-piece union with interpenetrating parts. Two things make that
// unnecessary here.
//
// First, every part in the walkable batches is CONVEX (pucks, slabs, kerbs) or a
// stack of convex pieces along Y (the totem plinth). For a convex part, the
// triangles whose normal is dominated by one axis-and-sign form a surface that is
// single-valued over that axis' projection plane - so an orthographic projection
// of that group is injective, which is the whole property an atlas needs.
//
// Second, dominant-axis classification bounds the distortion. A triangle assigned
// to a chart is within 45 degrees of that chart's plane by construction, so its
// projected area is never worse than cos(45) = 0.707 of its true area. Texel
// density therefore varies by at most sqrt(2) across the whole atlas, which is why
// a single texels-per-metre figure is meaningful.
//
// ## The one thing that had to change from `boxProjectUV`'s approach
//
// `boxProjectUV` classifies PER VERTEX. That is fine for a tiling map, where a
// triangle straddling an axis flip just repeats the texture oddly on a fillet. In
// an atlas it is fatal: one vertex in chart A and two in chart B stretches a
// triangle across unrelated parts of the image and drags their occlusion with it.
// So charts are assigned PER TRIANGLE, from the face normal.
//
// That only works because `mergeProp` de-indexes everything it merges (it calls
// `toNonIndexed()` on any indexed input), so every triangle in a merged batch
// already owns its three vertices and no vertex is shared between two triangles.
// A merged batch is therefore free to have per-triangle UVs. An indexed geometry
// is not, and this function rejects one rather than silently painting stripes.
// ---------------------------------------------------------------------------

/**
 * The six chart directions, in the order this module numbers them.
 *
 * The axis PAIRS match `boxProjectUV`'s, so a reader moving between the two
 * functions is not also translating between two conventions.
 */
const CHART_AXES: ReadonlyArray<{ readonly u: 0 | 1 | 2; readonly v: 0 | 1 | 2 }> = [
  { u: 2, v: 1 }, // 0 +X: (z, y)
  { u: 2, v: 1 }, // 1 -X
  { u: 0, v: 2 }, // 2 +Y: (x, z)
  { u: 0, v: 2 }, // 3 -Y
  { u: 0, v: 1 }, // 4 +Z: (x, y)
  { u: 0, v: 1 }, // 5 -Z
]

/** Human-readable chart names, for bake reports and test failures. */
export const CHART_FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const

/** One part's worth of one face direction: a rectangle of texels and what fills it. */
export type LightmapChart = {
  /** Index into the `LightmapMesh[]` the atlas was packed from. */
  mesh: number
  /** Index of the source `PropPart` within that mesh. */
  part: number
  /** 0..5, indexing `CHART_FACE_NAMES`. */
  face: number
  /** Triangle indices within the mesh's geometry. */
  triangles: readonly number[]
  /** Projected extent in WORLD METRES, on this chart's axis pair. */
  minU: number
  minV: number
  spanU: number
  spanV: number
  /** Placement in the atlas, in texels, gutter included. */
  x: number
  y: number
  w: number
  h: number
}

export type LightmapMesh = {
  geometry: BufferGeometry
  /**
   * Post-merge vertex count of each source part, in merge order. Get it from
   * `propPartVertexCounts`, never by hand: `mergeProp` de-indexes, so a part's
   * contribution is its INDEX count when it had one and its position count when it
   * did not, and using the wrong one silently shifts every later part's charts.
   */
  partVertexCounts: readonly number[]
}

export type LightmapAtlas = {
  size: number
  texelsPerMetre: number
  gutter: number
  charts: readonly LightmapChart[]
  /** Fraction of the atlas' texels that fall inside a chart rectangle. */
  occupancy: number
}

export type LightmapAtlasOptions = {
  /** Square atlas edge, in texels. */
  size: number
  texelsPerMetre: number
  /**
   * Texels of padding around every chart.
   *
   * Two is the minimum that survives bilinear filtering, because a sample at a
   * chart's outer edge reaches half a texel beyond it and the baker's dilation
   * pass then needs somewhere valid to write. It is NOT enough for mipmapping,
   * which is why `src/art/lightmap.ts` turns mipmaps off rather than paying for a
   * gutter wide enough to survive them.
   */
  gutter?: number
}

/**
 * What each part will occupy in a merged geometry, in vertices.
 *
 * Exists because the atlas has to attribute a triangle in the merged result back
 * to the part it came from, and `mergeProp` does not report that. Replaying its
 * de-index rule here is exact rather than approximate: `toNonIndexed()` emits one
 * vertex per index, `clone()` keeps the count as-is, and nothing else in
 * `mergeProp` changes counts.
 */
export function propPartVertexCounts(parts: readonly PropPart[]): number[] {
  return parts.map(({ geometry }, i) => {
    const index = geometry.getIndex()
    if (index) return index.count
    const position = geometry.getAttribute('position')
    if (!position) {
      throw new Error(`geometry: propPartVertexCounts part ${i} has no position attribute`)
    }
    return position.count
  })
}

/**
 * Assign every triangle of every mesh to a chart, and pack the charts into one
 * square atlas.
 *
 * Both meshes of the hub share ONE atlas and therefore one texture, one sampler
 * and one manifest. There is no cost to it: a chart's placement is independent of
 * which mesh it came from, so packing them together only improves occupancy.
 *
 * Packing is shelf / next-fit-decreasing-height. It is not optimal and a
 * guillotine or skyline packer would fit maybe ten per cent more, which is worth
 * naming as a dead end tried rather than leaving as an open question: at the sizes
 * here the atlas is chosen from the measured occupancy anyway, so ten per cent of
 * area is one step on the power-of-two ladder and the ladder is what actually
 * decides the file size.
 *
 * **Determinism is a correctness requirement, not a nicety.** The bake and the
 * runtime both call this function and must agree texel for texel, so charts are
 * sorted by (height, width, mesh, part, face) with every tie broken explicitly.
 * `Array.prototype.sort` is stable in every engine this runs on, but relying on
 * that instead of on a total order is how a bake ends up correct on the machine
 * that made it and rotated by one chart everywhere else.
 */
export function packLightmapAtlas(
  meshes: readonly LightmapMesh[],
  options: LightmapAtlasOptions,
): LightmapAtlas {
  const { size, texelsPerMetre } = options
  const gutter = options.gutter ?? 2

  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`geometry: packLightmapAtlas needs an integer size, got ${size}`)
  }
  if (!(texelsPerMetre > 0)) {
    throw new Error(`geometry: packLightmapAtlas needs a positive texelsPerMetre, got ${texelsPerMetre}`)
  }
  if (meshes.length === 0) {
    throw new Error('geometry: packLightmapAtlas needs at least one mesh')
  }

  const charts: LightmapChart[] = []

  meshes.forEach((mesh, meshIndex) => {
    const { geometry, partVertexCounts } = mesh
    if (geometry.getIndex()) {
      throw new Error(
        `geometry: packLightmapAtlas mesh ${meshIndex} is indexed. Charts are per triangle, ` +
          'so a shared vertex would have to carry two atlas positions at once. Merge through ' +
          '`mergeProp`, which de-indexes, or call `toNonIndexed()` first.',
      )
    }
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    if (!position || !normal) {
      throw new Error(`geometry: packLightmapAtlas mesh ${meshIndex} needs position and normal attributes`)
    }
    const total = partVertexCounts.reduce((sum, n) => sum + n, 0)
    if (total !== position.count) {
      throw new Error(
        `geometry: packLightmapAtlas mesh ${meshIndex} has ${position.count} vertices but its ` +
          `part counts sum to ${total}. Use propPartVertexCounts on the same array that was ` +
          'handed to mergeProp, in the same order.',
      )
    }
    if (position.count % 3 !== 0) {
      throw new Error(
        `geometry: packLightmapAtlas mesh ${meshIndex} has ${position.count} vertices, which is ` +
          'not a whole number of triangles',
      )
    }

    // Vertex index -> part index, as a prefix-sum lookup rather than a search per
    // triangle. Parts number in the low tens and triangles in the tens of
    // thousands, so this is the side of the loop to spend memory on.
    const partOfVertex = new Int32Array(position.count)
    let cursor = 0
    partVertexCounts.forEach((count, part) => {
      partOfVertex.fill(part, cursor, cursor + count)
      cursor += count
    })

    // Grouped by part * 6 + face. A Map keyed on a number keeps insertion order,
    // which the sort below then makes irrelevant, but it also keeps the grouping
    // pass allocation-light.
    const groups = new Map<number, number[]>()
    const triangleCount = position.count / 3

    for (let t = 0; t < triangleCount; t++) {
      const a = t * 3
      /*
        Classified from the summed VERTEX normals rather than from the geometric
        normal of the triangle. `toCreasedNormals` has already decided which edges
        are hard here, and the vertex normals are what the shader actually uses, so
        agreeing with them keeps a chart boundary on the same edge the shading
        break is on. A geometric normal disagrees with them across a smoothed
        fillet, which puts the seam in the middle of a gradient.
      */
      const nx = normal.getX(a) + normal.getX(a + 1) + normal.getX(a + 2)
      const ny = normal.getY(a) + normal.getY(a + 1) + normal.getY(a + 2)
      const nz = normal.getZ(a) + normal.getZ(a + 1) + normal.getZ(a + 2)
      const ax = Math.abs(nx)
      const ay = Math.abs(ny)
      const az = Math.abs(nz)

      let face: number
      if (ay >= ax && ay >= az) face = ny >= 0 ? 2 : 3
      else if (ax >= az) face = nx >= 0 ? 0 : 1
      else face = nz >= 0 ? 4 : 5

      const key = partOfVertex[a] * 6 + face
      const bucket = groups.get(key)
      if (bucket) bucket.push(t)
      else groups.set(key, [t])
    }

    for (const [key, triangles] of groups) {
      const part = Math.floor(key / 6)
      const face = key % 6
      const axes = CHART_AXES[face]
      let minU = Infinity
      let maxU = -Infinity
      let minV = Infinity
      let maxV = -Infinity
      for (const t of triangles) {
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k
          const u = componentAt(position, i, axes.u)
          const v = componentAt(position, i, axes.v)
          if (u < minU) minU = u
          if (u > maxU) maxU = u
          if (v < minV) minV = v
          if (v > maxV) maxV = v
        }
      }
      const spanU = maxU - minU
      const spanV = maxV - minV
      /*
        `ceil` plus one, not `ceil`. A chart spanning exactly 1.0 m at 40 texels
        per metre needs 41 texel CENTRES to cover both edges, and rounding to 40
        loses the far edge of every axis-aligned face in the level - a one-texel
        bright line down the outside of every kerb, which reads as a highlight
        rather than as a bug.
      */
      const w = Math.ceil(spanU * texelsPerMetre) + 1 + gutter * 2
      const h = Math.ceil(spanV * texelsPerMetre) + 1 + gutter * 2
      charts.push({
        mesh: meshIndex,
        part,
        face,
        triangles,
        minU,
        minV,
        spanU,
        spanV,
        x: 0,
        y: 0,
        w,
        h,
      })
    }
  })

  charts.sort(
    (a, b) => b.h - a.h || b.w - a.w || a.mesh - b.mesh || a.part - b.part || a.face - b.face,
  )

  let shelfY = 0
  let shelfHeight = 0
  let penX = 0
  let used = 0

  for (const chart of charts) {
    if (chart.w > size || chart.h > size) {
      throw new Error(
        `geometry: packLightmapAtlas chart ${CHART_FACE_NAMES[chart.face]} of part ${chart.part} ` +
          `needs ${chart.w}x${chart.h} texels, which does not fit a ${size} atlas. Lower ` +
          'texelsPerMetre or raise size.',
      )
    }
    if (penX + chart.w > size) {
      shelfY += shelfHeight
      shelfHeight = 0
      penX = 0
    }
    if (shelfY + chart.h > size) {
      throw new Error(
        `geometry: packLightmapAtlas ran out of room in a ${size} atlas at ` +
          `${texelsPerMetre} texels per metre, ${charts.length} charts. Raise size or lower ` +
          'texelsPerMetre.',
      )
    }
    chart.x = penX
    chart.y = shelfY
    penX += chart.w
    if (chart.h > shelfHeight) shelfHeight = chart.h
    used += chart.w * chart.h
  }

  return { size, texelsPerMetre, gutter, charts, occupancy: used / (size * size) }
}

/** One of the three position components, chosen by axis index. */
function componentAt(attribute: BufferAttribute | InterleavedBufferAttribute, i: number, axis: 0 | 1 | 2): number {
  return axis === 0 ? attribute.getX(i) : axis === 1 ? attribute.getY(i) : attribute.getZ(i)
}

/** What a bake writes beside its image, and what a runtime checks it against. */
export type LightmapManifest = {
  /** `lightmapAtlasHash` of the atlas the bake actually used. */
  hash: string
  size: number
  texelsPerMetre: number
  gutter: number
  charts: number
  /** Fraction of atlas texels inside a chart rectangle. */
  occupancy: number
  /** Fraction of atlas texels that received a traced value. */
  coverage: number
  /** Cosine-weighted hemisphere rays per texel. */
  rays: number
  /** Metres beyond which an occluder was ignored. */
  maxDistance: number
  surfaceAreaSquareMetres: number
  triangles: number
  seconds: number
  generated: string
}

/**
 * A 32-bit FNV-1a over a canonical description of a packed atlas.
 *
 * **This is the staleness detector, and it is the reason a moved deck is a console
 * error rather than shadows in the wrong place.** The layout WILL move again; that
 * was accepted when this approach was chosen. What was not acceptable was the
 * failure mode, because a lightmap whose atlas no longer matches its geometry
 * renders a completely clean frame with the previous layout's occlusion painted on
 * it, and nothing anywhere reports a problem.
 *
 * Hashing the packed ATLAS rather than the layout tables is deliberate and strictly
 * stronger. Every input that could invalidate a bake shows up in it: a moved or
 * resized part changes its charts' spans, a reordered part list changes their part
 * indices, a new part changes the count and shifts every placement, and a change to
 * this packer or to the atlas options changes the rectangles. A hash of the tables
 * would miss the last two, and the last two are the ones a future reader is least
 * likely to suspect.
 *
 * It lives here, beside the packer, rather than in `src/art/lightmap.ts`, because
 * the bake tool must compute it too and `lightmap.ts` statically imports the baked
 * PNG - so a bake that imported it could not run until its own output existed.
 *
 * Numbers are fixed to six decimals before hashing. Free-form `toString` on a float
 * differs between engines at the last digit for some values, and a hash that
 * depends on that fails in CI and passes locally, which is worse than no hash.
 */
export function lightmapAtlasHash(atlas: LightmapAtlas): string {
  const round = (n: number) => n.toFixed(6)
  const parts: string[] = [
    'v1',
    String(atlas.size),
    round(atlas.texelsPerMetre),
    String(atlas.gutter),
    String(atlas.charts.length),
  ]
  for (const c of atlas.charts) {
    parts.push(
      `${c.mesh}/${c.part}/${c.face}/${c.triangles.length}/` +
        `${round(c.minU)}/${round(c.minV)}/${round(c.spanU)}/${round(c.spanV)}/` +
        `${c.x}/${c.y}/${c.w}/${c.h}`,
    )
  }

  let hash = 0x811c9dc5
  const canonical = parts.join('|')
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    /*
      The 32-bit FNV prime applied as shifts rather than as `hash * 16777619`. The
      multiply overflows float64's exact-integer range and rounds, which produces a
      hash that is stable on one engine and not FNV at all - so it would silently
      disagree with any other implementation of the same named algorithm, including
      a future rewrite of this function.
    */
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * A vertex's position in its chart's 2D world-metre space.
 *
 * Exported because the baker needs the identical projection and a second copy of
 * `CHART_AXES` in `tools/bake/` is exactly the kind of duplicate that ends up one
 * axis pair out of date. The first draft of the baker had one, and it is the reason
 * this function exists.
 */
export function chartLocal(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  i: number,
  face: number,
): { u: number; v: number } {
  const axes = CHART_AXES[face]
  if (!axes) throw new Error(`geometry: chartLocal got face ${face}, which is not 0..5`)
  return { u: componentAt(attribute, i, axes.u), v: componentAt(attribute, i, axes.v) }
}

/**
 * The atlas texel a chart-local point lands on, in fractional texel coordinates
 * from the top-left of the IMAGE.
 *
 * The bake rasterises in this space and the runtime writes UVs from it, so it
 * lives here, beside the UV writer, rather than in the bake tool. A lightmap that
 * is offset by a gutter, or flipped, looks entirely plausible and is entirely
 * wrong, and the only defence is that both sides call one function.
 */
export function chartLocalToTexel(
  atlas: LightmapAtlas,
  chart: LightmapChart,
  u: number,
  v: number,
): { col: number; row: number } {
  return {
    col: chart.x + atlas.gutter + (u - chart.minU) * atlas.texelsPerMetre,
    row: chart.y + atlas.gutter + (v - chart.minV) * atlas.texelsPerMetre,
  }
}

/** The inverse of `chartLocalToTexel`, for the baker's per-texel world lookup. */
export function texelToChartLocal(
  atlas: LightmapAtlas,
  chart: LightmapChart,
  col: number,
  row: number,
): { u: number; v: number } {
  return {
    u: chart.minU + (col - chart.x - atlas.gutter) / atlas.texelsPerMetre,
    v: chart.minV + (row - chart.y - atlas.gutter) / atlas.texelsPerMetre,
  }
}

/**
 * Write the `uv1` attribute for every mesh the atlas was packed from.
 *
 * **The V flip is here and it is the whole reason this is a function.** three
 * loads an image with `flipY = true` by default, so image row 0 ends up at v = 1.
 * The atlas is authored top-down, because that is the order a PNG stores its
 * scanlines and the order the baker fills them, so V has to be inverted on the way
 * out. `src/art/lightmap.ts` deliberately leaves `flipY` at its default rather
 * than turning it off, so that the lightmap behaves like every other texture in
 * the project and there is one place - this one - that knows about the flip.
 *
 * A vertically mirrored lightmap is the most convincing wrong result available:
 * the occlusion is still soft, still in the right places on symmetric parts, and
 * only obviously broken on the asymmetric ones. `geometry.test.ts` pins the
 * orientation with an explicit expected UV.
 */
export function applyLightmapUV(meshes: readonly LightmapMesh[], atlas: LightmapAtlas): void {
  const targets = meshes.map(({ geometry }) => {
    const position = geometry.getAttribute('position')
    if (!position) throw new Error('geometry: applyLightmapUV needs a position attribute')
    return { geometry, position, uv: new Float32Array(position.count * 2), written: new Uint8Array(position.count) }
  })

  for (const chart of atlas.charts) {
    const target = targets[chart.mesh]
    if (!target) {
      throw new Error(
        `geometry: applyLightmapUV was handed ${meshes.length} meshes but the atlas references ` +
          `mesh ${chart.mesh}. Pass the same array, in the same order, that packLightmapAtlas got.`,
      )
    }
    for (const t of chart.triangles) {
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k
        const local = chartLocal(target.position, i, chart.face)
        const { col, row } = chartLocalToTexel(atlas, chart, local.u, local.v)
        target.uv[i * 2] = col / atlas.size
        target.uv[i * 2 + 1] = 1 - row / atlas.size
        target.written[i] = 1
      }
    }
  }

  for (const [i, target] of targets.entries()) {
    /*
      Every vertex must have been claimed by exactly one chart. A gap here means a
      triangle was classified into a chart that then failed to place, or that the
      geometry handed in is not the one the atlas was packed from - both of which
      otherwise show up as a patch of level sampling texel (0, 0), which is a
      plausible-looking flat multiply rather than an error.
    */
    let missing = 0
    for (const flag of target.written) if (!flag) missing++
    if (missing > 0) {
      throw new Error(
        `geometry: applyLightmapUV left ${missing} of ${target.written.length} vertices of mesh ` +
          `${i} without a uv1. The atlas does not describe this geometry.`,
      )
    }
    target.geometry.setAttribute('uv1', new BufferAttribute(target.uv, 2))
  }
}

// ---------------------------------------------------------------------------
// The kit
//
// Eleven modules, and everything in the built world is one of them or one of
// them at a different size. A small shape vocabulary is what makes a set of
// props read as a designed world rather than as an asset collection, and it is
// also what makes the merge above worth doing.
//
// Grid: XZ on 2.0 m, Y on 0.40 m. Pucks and anything on the Core sit on a polar
// sub-grid: radius free, angle on 45-degree steps.
// ---------------------------------------------------------------------------

/** K1. A walkable block. */
export function slab(width: number, height: number, depth: number, bevel = 0.12): BufferGeometry {
  return chamferedBox({ width, height, depth, bevel })
}

/**
 * K2. The puck: the shape this world is mostly made of.
 *
 * The three-degree draft is not decoration. Every moulded part has to taper to
 * come out of its tool, and the eye reads the absence of that taper as "computer
 * graphics" long before it can say why. It also does something useful for
 * gameplay: the widest point is the base, so the visible silhouette matches the
 * cylinder collider that sits 0.10 m inside it, and the player never sees their
 * feet stop short of an edge.
 */
export function puck(radius: number, height: number, rim = 0.1, radialSegments = DEFAULT_RADIAL_SEGMENTS): BufferGeometry {
  return roundedCylinder({
    radius,
    height,
    topFillet: rim,
    bottomFillet: Math.min(0.05, rim),
    draftDegrees: 3,
    radialSegments,
    filletSegments: rim > 0.04 ? 5 : 3,
  })
}

/**
 * K3. A kerb, running along its local X.
 *
 * Kerbs are the reason a raised deck reads as raised. They are band 2 against a
 * band 1 deck, so a kerb draws the platform's outline as a dark line, and that
 * line survives desaturation where a value change across a flat top does not.
 *
 * They also never render conditionally at any quality tier. A kerb carries a
 * collider, and a collider with no mesh is an invisible wall, which is strictly
 * worse than no kerb at all.
 */
export function kerb(length: number, height = 0.6, depth = 0.36): BufferGeometry {
  // Four degrees of outward draft, taken off each side over the full height.
  const taper = Math.min(depth * 0.4, height * Math.tan((4 * Math.PI) / 180))
  const geometry = beveledExtrude({
    outline: [
      new Vector2(-depth / 2, 0),
      new Vector2(depth / 2, 0),
      new Vector2(depth / 2 - taper, height),
      new Vector2(-depth / 2 + taper, height),
    ],
    depth: length,
    bevel: 0.05,
  })
  // Built with its length along Z so the cross-section could be authored in the
  // natural plane; rotated here so callers get length along X, which is the axis
  // the collider manifest's half-extents are written against.
  geometry.rotateY(Math.PI / 2)
  return geometry
}

/**
 * K4. A ramp.
 *
 * Unused by the hub, whose route is entirely autostep, and kept anyway: the cave
 * wants one, every future scene will want one, and a generator costs nothing to
 * own. The rise runs up +Y across +X, with the toe at -X.
 */
export function wedge(run: number, rise: number, width: number, bevel = 0.06): BufferGeometry {
  return beveledExtrude({
    outline: [new Vector2(-run / 2, 0), new Vector2(run / 2, 0), new Vector2(run / 2, rise)],
    depth: width,
    bevel,
  })
}

/** K5. A capsule standing on its base. Masts, struts, pylons. */
export function pill(radius: number, length: number, capSegments = 4, radialSegments = 12): BufferGeometry {
  const geometry = new CapsuleGeometry(radius, length, capSegments, radialSegments)
  geometry.translate(0, length / 2 + radius, 0)
  return geometry
}

/** K6. The inner core of a node, centred on its own centre. */
export function nodeCore(radius: number): BufferGeometry {
  return new IcosahedronGeometry(radius, 2)
}

/**
 * K7. The transparent outer shell of a node, centred on its own centre.
 *
 * The shell is what stops a node reading as a ball. One low-subdivision
 * icosahedron, flat shaded at 20% opacity with depth writing off, is the single
 * detail that makes these read as manufactured objects with an inside and an
 * outside, and it costs one instanced draw for every node in the scene.
 */
export function nodeShell(radius: number): BufferGeometry {
  return new IcosahedronGeometry(radius, 1)
}

/** K8. A circuit trace. */
export function trace(
  points: Array<Vector3 | [number, number, number]>,
  radius = 0.09,
  tubularSegments = 48,
): BufferGeometry {
  return tubeFromCurve({ points, radius, radialSegments: 6, tubularSegments })
}

/** K9. A terminating pad, where a trace stops. A very shallow puck. */
export function pad(radius = 0.45): BufferGeometry {
  return roundedCylinder({
    radius,
    height: 0.1,
    topFillet: 0.035,
    bottomFillet: 0.02,
    radialSegments: 24,
    filletSegments: 3,
  })
}

/**
 * K10. A crystal shard, standing on its base.
 *
 * Faceted rather than filleted, which is the one sanctioned exception to the
 * no-hard-edges rule: a crystal that has been rounded off reads as a jelly
 * sweet. What it does take from the moulding rules is the truncated apex - a
 * mathematically sharp point is not something any process can produce - and a
 * chamfer where the base meets the ground, which is where the silhouette
 * actually needs help.
 */
export function shard(height: number, topRadius = 0.05, baseRadius = 0.22): BufferGeometry {
  const chamfer = Math.min(0.035, height * 0.06)
  const cap = height * 0.16
  const body = height - cap - chamfer

  return mergeProp([
    {
      geometry: new CylinderGeometry(baseRadius, baseRadius * 0.82, chamfer, 6, 1),
      position: [0, chamfer / 2, 0],
    },
    {
      geometry: new CylinderGeometry(topRadius, baseRadius, body, 6, 1),
      position: [0, chamfer + body / 2, 0],
    },
    {
      geometry: new CylinderGeometry(topRadius * 0.4, topRadius, cap, 6, 1),
      position: [0, chamfer + body + cap / 2, 0],
    },
  ])
}

/**
 * K11. A buttress fin, standing on its base with its span along Z.
 *
 * Eight degrees of draft on both faces, clamped so a tall thin fin cannot taper
 * itself to nothing. Fins are read at distance and in silhouette, which is why
 * their bevel is the 15 mm floor rather than the 8 mm one.
 */
/**
 * A star polygon, as a `Shape`.
 *
 * Points alternate outer and inner radius starting at the TOP, so the star sits
 * upright on a point rather than balanced on one. `Shape` rather than a geometry
 * because both callers want it flat and one of them extrudes nothing: the quiz
 * plank's reward star is a `shapeGeometry`, and the wizard hat's decals are the
 * same shape at a twentieth of the size.
 *
 * It lives here rather than in either of them because it was in `Planks.tsx`,
 * where the hat could not reach it - and a second hand-rolled star would drift
 * from the first in exactly the way two stars in one scene must not.
 */
export function starShape(points: number, outer: number, inner: number): Shape {
  if (points < 2) throw new Error(`geometry: a star needs at least 2 points, got ${points}`)
  if (!(inner > 0) || !(outer > inner)) {
    throw new Error(`geometry: a star needs 0 < inner < outer, got inner ${inner} outer ${outer}`)
  }
  const shape = new Shape()
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (i * Math.PI) / points + Math.PI / 2
    if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  shape.closePath()
  return shape
}

export function fin(width: number, height: number, depth: number): BufferGeometry {
  const taper = Math.min(depth * 0.4, height * Math.tan((8 * Math.PI) / 180))
  return beveledExtrude({
    outline: [
      new Vector2(-depth / 2, 0),
      new Vector2(depth / 2, 0),
      new Vector2(depth / 2 - taper, height),
      new Vector2(-depth / 2 + taper, height),
    ],
    depth: width,
    bevel: 0.015,
  })
}

// ---------------------------------------------------------------------------
// Polygon helpers, exported for their tests
// ---------------------------------------------------------------------------

/** The shoelace area. Positive when the winding is counter-clockwise. */
export function signedArea(points: Vector2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** The same polygon, wound counter-clockwise. */
export function counterClockwise(points: Vector2[]): Vector2[] {
  const copy = points.map((p) => p.clone())
  return signedArea(copy) < 0 ? copy.reverse() : copy
}

/**
 * Smallest distance from the polygon's centroid to any of its edges.
 *
 * A cheap lower bound on the inradius, used only to work out how far a convex
 * outline can be inset before it collapses. It underestimates for lopsided
 * shapes, which is the safe direction to be wrong in.
 */
export function minimumEdgeDistance(points: Vector2[]): number {
  const centroid = new Vector2()
  for (const p of points) centroid.add(p)
  centroid.divideScalar(points.length)

  let best = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const length = Math.hypot(ex, ey)
    if (length < 1e-12) continue
    // Perpendicular distance from the centroid to the infinite line through a-b.
    const distance = Math.abs(ex * (a.y - centroid.y) - ey * (a.x - centroid.x)) / length
    best = Math.min(best, distance)
  }
  return Number.isFinite(best) ? best : 0
}

/**
 * Move every edge of a convex polygon inward by `amount`.
 *
 * Each vertex slides along its angle bisector by `amount / sin(half the
 * interior angle)`, which is the offset that keeps both adjacent edges exactly
 * `amount` from where they were. Correct only for convex input, which is why
 * `beveledExtrude` documents that constraint rather than trying to handle the
 * general case: a reflex vertex needs the offset polygon to be clipped against
 * itself, and no cross-section in this world has one.
 */
export function insetConvex(points: Vector2[], amount: number): Vector2[] {
  const n = points.length
  const out: Vector2[] = []

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const here = points[i]
    const next = points[(i + 1) % n]

    const inDir = new Vector2().subVectors(here, prev).normalize()
    const outDir = new Vector2().subVectors(next, here).normalize()

    // Inward normals of the two edges, for counter-clockwise winding.
    const inNormal = new Vector2(-inDir.y, inDir.x)
    const outNormal = new Vector2(-outDir.y, outDir.x)

    const bisector = new Vector2().addVectors(inNormal, outNormal)
    const length = bisector.length()
    if (length < 1e-9) {
      // A 180-degree turn, which a convex polygon should not contain. Fall back
      // to a straight offset rather than dividing by zero.
      out.push(here.clone().addScaledVector(inNormal, amount))
      continue
    }
    bisector.divideScalar(length)
    const scale = amount / Math.max(0.05, bisector.dot(inNormal))
    out.push(here.clone().addScaledVector(bisector, scale))
  }

  return out
}

/**
 * Replace every corner of a polygon with a micron-scale arc.
 *
 * See `beveledExtrude` for why this exists. Straight vertices, where the two
 * edges are nearly collinear, are emitted once rather than as a fan of
 * coincident points, because coincident contour points give the triangulator
 * degenerate triangles and those show up as NaN normals downstream.
 */
export function roundedOutline(points: Vector2[], segments: number, epsilon = CORNER_EPSILON): Vector2[] {
  const n = points.length
  const out: Vector2[] = []

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const here = points[i]
    const next = points[(i + 1) % n]

    const inDir = new Vector2().subVectors(here, prev).normalize()
    const outDir = new Vector2().subVectors(next, here).normalize()

    // Outward normals, for counter-clockwise winding.
    const start = Math.atan2(-inDir.x, inDir.y)
    const end = Math.atan2(-outDir.x, outDir.y)

    let sweep = end - start
    while (sweep > Math.PI) sweep -= Math.PI * 2
    while (sweep < -Math.PI) sweep += Math.PI * 2

    if (Math.abs(sweep) < 1e-6) {
      out.push(here.clone())
      continue
    }

    for (let s = 0; s <= segments; s++) {
      const angle = start + (sweep * s) / segments
      out.push(new Vector2(here.x + Math.cos(angle) * epsilon, here.y + Math.sin(angle) * epsilon))
    }
  }

  return out
}
