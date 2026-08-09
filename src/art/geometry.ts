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
