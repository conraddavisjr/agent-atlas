/**
 * The hub's pure layout arithmetic: paths, profiles and gating.
 *
 * Everything here is numbers in and numbers out, with no three.js scene graph
 * and no React, so it can be asserted on in a Node test. That split is not
 * tidiness. This codebase has been cut repeatedly by geometry that silently
 * stopped drawing, a merge that lost its UVs, and a sampler that quietly
 * returned fewer results than it was asked for - all of which produced clean
 * frames. A path generator that drops a corner, or an arc that spans a pylon
 * the tier no longer draws, are exactly that kind of failure, so the parts that
 * can be checked without a GPU live here and are checked.
 *
 * See `docs/design/03-environment.md` and `docs/design/00-art-bible.md`.
 */

import { LatheGeometry, Vector2, type BufferGeometry } from 'three'
import { palette } from '@/art/palette'
import { kerb, puck, slab, type LightmapAtlasOptions, type PropPart } from '@/art/geometry'

export type Point3 = [number, number, number]

/**
 * The walkable plateau's radius, and the number the skirt profile is written
 * against.
 *
 * It lives here rather than in `Terrain.tsx` so that the profile and its test
 * can be checked without pulling a React component - and therefore rapier's
 * wasm - into a Node test run. `Terrain.tsx` re-exports it, so every existing
 * import site is unchanged.
 */
export const PLATEAU_RADIUS = 16

// ---------------------------------------------------------------------------
// Circuit traces
// ---------------------------------------------------------------------------

/**
 * How a trace sits on the world, and why every one of these numbers is small.
 *
 * The traces used to be fat tubes floating 0.12 m clear of the deck on a
 * Catmull-Rom through diagonal waypoints, which read as a glossy rubber hose
 * lying on the floor: 0.28 m across, standing 0.26 m proud, with a wandering
 * organic path, one specular streak down its length, no contact with the
 * surface and a square-cut end.
 *
 * The reference brief names PCB traces as this world's digital DNA, and a PCB
 * trace has three properties this one did not: it is *in* the surface rather
 * than on it, it runs in straight lines that turn at right angles mitred at 45
 * degrees, and it ends in a via pad rather than in mid-air.
 *
 * `standoff` is the tube's CENTRE above the surface, so a tube of radius
 * `trunkRadius` sits with its underside 0.035 m INSIDE the deck and its crown
 * 0.115 m above it. Buried is the point: there is no gap to light through and
 * therefore no missing contact shadow to notice. It also keeps the crown inside
 * the environment spec's absolute rule that a trace segment is either at or
 * below 0.12 m above the surface beneath it or at or above 3.00 m, never
 * between.
 */
export const TRACE = {
  /** Tube centre above a horizontal surface. */
  standoff: 0.04,
  /** Tube centre outside a vertical face, where a run climbs a riser. */
  faceStandoff: 0.06,
  /**
   * The 45-degree mitre taken off each right-angle corner.
   *
   * Sized against the riser it has to climb rather than by eye. Every riser in
   * the level is 0.40, and `chamferCorners` clamps a cut to 45% of the shorter
   * neighbour, so anything at or above 0.18 turns a 0.40 step into two mitres
   * meeting in the middle - a diagonal ramp, which is the wandering read the
   * rewrite is removing. At 0.12 the step keeps 0.16 of true vertical between
   * two visible mitres and reads as a right angle with a cut corner.
   */
  chamfer: 0.12,
  /** Spacing of the polyline handed to the spline, along a straight run. */
  spacing: 0.15,
  /** The north trunk, thicker because it is the main path made visible. */
  trunkRadius: 0.075,
  /** A totem spur, thinner so the player can tell it from the trunk at a glance. */
  spurRadius: 0.05,
  /** The via pad at the Core, where four inputs meet and the trunk leaves. */
  junctionRadius: 1.05,
} as const

/** Squared length of a segment, in three dimensions. */
function distance(a: Point3, b: Point3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function unit(from: Point3, to: Point3): Point3 {
  const d = distance(from, to)
  if (d === 0) return [0, 0, 0]
  return [(to[0] - from[0]) / d, (to[1] - from[1]) / d, (to[2] - from[2]) / d]
}

/**
 * Cut every interior corner of a polyline back into a 45-degree mitre.
 *
 * Each corner point is replaced by two points, one on each adjoining segment,
 * `chamfer` metres back from the corner. The cut is clamped to 45% of the
 * shorter neighbour so two corners closer together than twice the chamfer
 * cannot cross over and turn the path inside out - which is the failure mode
 * that would show up as a trace briefly running backwards through a deck.
 *
 * Collinear points are left alone, so densifying before or after is safe.
 */
export function chamferCorners(points: Point3[], chamfer: number): Point3[] {
  if (points.length < 3) return points.map((p) => [...p] as Point3)

  const out: Point3[] = [[...points[0]] as Point3]

  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]

    const incoming = unit(previous, corner)
    const outgoing = unit(corner, next)
    const turn =
      incoming[0] * outgoing[0] + incoming[1] * outgoing[1] + incoming[2] * outgoing[2]

    // Straight through, to within a thousandth of a radian. Nothing to cut.
    if (turn > 0.999999) {
      out.push([...corner] as Point3)
      continue
    }

    const cut = Math.min(
      chamfer,
      0.45 * distance(previous, corner),
      0.45 * distance(corner, next),
    )
    out.push([
      corner[0] - incoming[0] * cut,
      corner[1] - incoming[1] * cut,
      corner[2] - incoming[2] * cut,
    ])
    out.push([
      corner[0] + outgoing[0] * cut,
      corner[1] + outgoing[1] * cut,
      corner[2] + outgoing[2] * cut,
    ])
  }

  out.push([...points[points.length - 1]] as Point3)
  return out
}

/**
 * Subdivide every segment so no two consecutive points are further apart than
 * `spacing`.
 *
 * This is what keeps a straight run straight. A Catmull-Rom through two distant
 * points and a nearby third bulges away from the line between them; a
 * Catmull-Rom through evenly spaced collinear points is exactly the line. So
 * the mitres stay tight and the runs stay flat, without needing the spline to
 * be replaced by something that would put a zero tangent - and therefore a NaN
 * frame - at every corner.
 */
export function densifyPath(points: Point3[], spacing: number): Point3[] {
  if (spacing <= 0) throw new Error(`hubLayout: densifyPath needs a positive spacing, got ${spacing}`)
  if (points.length < 2) return points.map((p) => [...p] as Point3)

  const out: Point3[] = [[...points[0]] as Point3]
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const steps = Math.max(1, Math.ceil(distance(from, to) / spacing))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      out.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ])
    }
  }
  return out
}

/** A right-angled route, mitred and resampled, ready for `trace()`. */
export function orthoTrace(
  corners: Point3[],
  chamfer = TRACE.chamfer,
  spacing = TRACE.spacing,
): Point3[] {
  return densifyPath(chamferCorners(corners, chamfer), spacing)
}

/** Total length of a polyline, used to pick a tube's segment count. */
export function pathLength(points: Point3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

/**
 * How much a polyline climbs and how much it falls, in metres.
 *
 * This exists because the traces are being reclassified as water, and water has
 * a property a circuit trace does not: it only runs one way.
 *
 * `waterMaterial.ts` advects its wave field toward DECREASING `uv.x`, and `uv.x`
 * runs from the first authored corner to the last. That is only downhill if
 * every route in the network climbs monotonically as it is authored, and today
 * both of them do - a spur climbs from its totem plinth at y 0.44 to the
 * junction at 1.24, and the trunk climbs from the junction at 1.24 to the
 * threshold pad at 2.84. So one sign serves the whole network: the arch is the
 * single high point, the four totems are the outfalls, and the junction pad is a
 * basin mid-slope.
 *
 * That is a property of the layout rather than of the shader, so it is checkable
 * here, and it is worth checking rather than reading. A reroute that put one
 * corner of one spur half a step lower than the corner before it would leave
 * water visibly running uphill along a metre of that spur, with nothing in the
 * shader, the material or the geometry to blame - the kind of defect that gets
 * argued about for an afternoon. `hubLayout.test.ts` asserts `down` is zero for
 * both routes.
 *
 * Returns both totals rather than a boolean so a failure says how much and in
 * which direction instead of only that something is wrong.
 */
export function pathVerticalRuns(points: Point3[]): { up: number; down: number } {
  let up = 0
  let down = 0
  for (let i = 1; i < points.length; i++) {
    const rise = points[i][1] - points[i - 1][1]
    if (rise > 0) up += rise
    else down -= rise
  }
  return { up, down }
}

/**
 * Tubular segments for a path of a given length at a given tier.
 *
 * A fixed count is wrong for two paths that differ by a factor of three in
 * length: the trunk came out with a segment every 0.14 m, which rounds a 0.18 m
 * mitre back into the curve it was put there to remove. Sampling by distance
 * instead keeps the corner crisp on both, and the geometry is cheap enough that
 * the extra rings do not register - the whole trace batch is under six thousand
 * triangles at high.
 */
export function traceSegments(length: number, tierSegments: number): number {
  const step = 3 / Math.max(1, tierSegments)
  return Math.max(16, Math.round(length / step))
}

/**
 * The canonical totem spur trace, written for the NE spur and rotated for the
 * other three.
 *
 * Right angles, in the vertical plane as well as in plan: the run crosses the
 * lobe and Puck A at one height, climbs Puck B's rim, crosses Puck B, climbs
 * Puck C's rim, and terminates inside the junction pad. Both ends are buried -
 * the outer end inside the totem plinth, the inner end inside the pad - so
 * neither shows a cut tube.
 *
 * Radii, measured from the origin along the diagonal:
 *
 *   7.00  inside the totem plinth, which is radius 0.70 at radius 7.071
 *   4.02  Puck B's rim, radius 4.00
 *   2.22  Puck C's rim, radius 2.20
 *   0.95  inside the junction pad, radius 1.05
 */
export function spurTraceCorners(): Point3[] {
  const diagonal = Math.SQRT1_2
  const at = (radius: number, y: number): Point3 => [radius * diagonal, y, -radius * diagonal]
  const s = TRACE.standoff
  return [
    at(7, 0.4 + s),
    at(4 + TRACE.faceStandoff, 0.4 + s),
    at(4 + TRACE.faceStandoff, 0.8 + s),
    at(2.2 + TRACE.faceStandoff, 0.8 + s),
    at(2.2 + TRACE.faceStandoff, 1.2 + s),
    at(0.95, 1.2 + s),
  ]
}

/**
 * The north trunk, from the junction pad to the threshold pad in front of the
 * arch, climbing four risers on the way.
 *
 * It runs down the centreline at x = 0 and every turn is a right angle, so the
 * whole route reads as one straight line stepping up four times rather than as
 * a hose draped over four steps. The z values are the south faces of the pieces
 * it climbs - the bridge at -2.20, T1 at -6.60, T2 at -10.60, T3 at -12.40 -
 * each offset out by `faceStandoff` so the vertical run hugs the riser without
 * intersecting its bevel.
 */
export function trunkTraceCorners(): Point3[] {
  const s = TRACE.standoff
  const f = TRACE.faceStandoff
  const risers: Array<[number, number, number]> = [
    // [face z, lower top y, upper top y]
    [-2.2, 1.2, 1.6],
    [-6.6, 1.6, 2],
    [-10.6, 2, 2.4],
    [-12.4, 2.4, 2.8],
  ]

  const out: Point3[] = [[0, 1.2 + s, -0.95]]
  for (const [faceZ, lower, upper] of risers) {
    out.push([0, lower + s, faceZ + f])
    out.push([0, upper + s, faceZ + f])
  }
  // Terminates inside the threshold pad, which is radius 0.90 at z = -14.10.
  out.push([0, 2.8 + s, -13.7])
  return out
}

// ---------------------------------------------------------------------------
// The island's skirt
// ---------------------------------------------------------------------------

/** One stop on a lathe profile, in the (radius, y) plane. */
export type LatheStop = { radius: number; y: number }

/**
 * One stop on the skirt profile: where it is, and what colour it is there.
 *
 * The value rides on the same row as the geometry on purpose. The two previous
 * versions of this skirt each kept the profile in one place and its colours in
 * another, and the second one shipped a two-colour facing paint against an
 * eight-stop profile, so seven of the eight stops were the same value. Putting
 * them in one table makes that class of mismatch unrepresentable rather than
 * merely tested for, and `paintByHeight` consumes the y values directly, so the
 * ramp cannot drift off the geometry it is painting.
 */
export type SkirtStop = LatheStop & { value: string }

/*
  THE SKIRT'S VALUES.

  Only the top stop exists in `palette.ts`. The four below it are proposed
  palette values, declared here for one round exactly as `Terrain.tsx`'s `CLIFF`
  was last round, and listed in the build report for promotion. None of them may
  ever carry a `band()` assertion: `VALUE_BANDS.anchor` refuses hex assertions on
  purpose, and these are the reason it does.

  The display luma of each hex is in the comment because the rendered value is
  NOT the hex - it is roughly a fifth of it on these facings, and every previous
  round of this project was lost by confusing the two.
*/
/** 0.221 as a hex. The lip shelf's lower edge, where the mid-value band ends. */
const KEEL_SHELF = '#4a3524'
/** 0.108. The widest point, and the deepest thing normally in frame. */
const KEEL_WALL = '#241a13'
/** 0.074. Below the silhouette; visible only if a camera ever goes under. */
const KEEL_UNDER = '#191209'
/** 0.054 / 0.050. The root, which no vantage in the game can reach. */
const KEEL_ROOT_UPPER = '#120d0a'
const KEEL_ROOT = '#100c0a'

/**
 * The island's underside: one lathe profile, with an overhanging flare whose
 * widest point is 1.8 m BELOW the lawn.
 *
 * ## Two previous versions, two different ways of being wrong
 *
 * **Version one** drew a rim cylinder, a soil band and a root cone, all tapering
 * INWARD from the plateau radius. Every camera looks down at the island, so the
 * plateau occluded all three completely. Six draw calls with their shadow
 * passes, not one pixel in any frame.
 *
 * **Version two** - the one this replaces - fixed that with an overhang: the
 * first stop below the lawn stepped outward to `r + 0.78` at y = -0.52, and
 * everything below turned back in. It is visible, and it is the reason the
 * island has an edge at all. But it bought a TRIM rather than a THICKNESS, and
 * the profile arithmetic says why.
 *
 * For a solid of revolution seen from outside and above, the stop of maximum
 * radius IS the lower silhouette. Everything below it is either behind it or
 * back-facing. Version two put that stop 0.52 m below the lawn, so the entire
 * visible band below the lawn was the 0.72 m up-facing shelf between the lawn's
 * edge and the overhang - measured on `hub-establishing` at high, 1660x934, as
 * 95.8% of every skirt pixel in the frame, with the cliff below contributing
 * exactly zero. The band read 0.230 falling to 0.202 over ninety pixels at
 * x = 1550, and **0.028 of that 0.029 fall was the vignette**, not the surface.
 * The cliff's careful `soilDeep` was painting geometry no camera could see.
 *
 * ## What changed, and the one number it turns on
 *
 * The widest point stays at `r + 0.78` - the island's silhouette is unchanged in
 * plan, which matters because three other systems are framed against it - and
 * moves DOWN, from y = -0.52 to y = -1.80. The overhang is preserved; the
 * thickness it overhangs is what is new. The band between the lawn's edge and
 * the silhouette stops being a shelf seen nearly face-on and becomes a wall
 * falling 1.54 m, and it is that wall which carries the anchor band.
 *
 * Predicted on the same frame: the underside goes from 4,785 pixels at or below
 * 0.18 to 10,572, from 5 pixels below 0.10 to 1,806, and the x = 1550 profile
 * from a flat 0.231-0.201 to a monotone 0.231 down to 0.127 with 44 contiguous
 * pixels at or below 0.18.
 *
 * ## The shelf's slope is load-bearing and it is not an aesthetic choice
 *
 * 0.26 over 0.52, a slope of 0.50. From a camera standing ON the plateau, a ray
 * reaches the skirt only if it clears the lawn's edge and then descends faster
 * than the outermost skirt surface - so the underside is invisible from inside
 * the island unless `height / distance-to-edge` exceeds this slope. The worst
 * case among the five vantages sited on the island is `hub-totem` at 0.341, and
 * `hub-grazing` is 0.111. That is why a near-black underside cannot appear as a
 * band at eye level in those shots: not because it is dark enough to get away
 * with, but because it is not in the frame. Lower this slope below about 0.36
 * and that stops being true.
 */
export function islandSkirtProfile(plateauRadius: number): SkirtStop[] {
  const r = plateauRadius
  return [
    // Flush with the lawn's edge, so the lawn-to-soil transition is a hard line.
    { radius: r, y: 0, value: palette.soil },
    /*
      The lip shelf, and it does two opposite jobs depending on which side of the
      island it is on. Worth stating both, because the first draft of this comment
      claimed only the flattering one.

      On the KEY flank it is up-facing surface taking the key at N.L up to 0.999,
      so it is a midground value by arithmetic and no albedo can argue it into the
      anchor band: measured over azimuths 50 to 100 degrees it means 0.196, which
      is the bright line that makes the dark below it read as a thickness rather
      than as a black outline drawn round the lawn. That is the round-2 gain, and
      it is kept.

      On the ANTI-KEY flank the same surface is the DARKEST THING IN THE FRAME, at
      0.073 to 0.088. Up-facing and no key to face. It is also the only part of the
      skirt still in frame out there: the wall below is dead vertical, so its
      normal is radial, and a radial normal goes edge-on to the camera about 70
      degrees either side of the camera's own bearing. Past that the shelf is all
      there is, which is why it reads as 108 px of dark at x = 0 rather than as the
      hairline its 0.52 m width suggests.

      `KEEL_SHELF` is therefore the one constant to move if the left flank crushes.
      It is monotone and it trades directly against the acceptance run at x = 1550:
      0.183 gives a 51 px run and 260 crushed pixels, 0.221 gives 44 px and 97,
      0.265 gives 29 px and none, 0.310 gives 6 px and fails. 0.221 is chosen for
      margin on the criterion rather than on the crush, because the model behind
      those numbers is anchored on a key-lit surface and is least trustworthy
      exactly where the crush would be.

      Narrower than version two's 0.72 for the same reason it is not narrower
      still: every metre of it is midground on one side and anchor on the other.
    */
    { radius: r + 0.52, y: -0.26, value: KEEL_SHELF },
    /*
      The widest point, and the whole change. Down here rather than at -0.52, so
      there is 1.54 m of wall above it inside the island's own silhouette.

      Its normal is (1.000, -0.007): dead vertical. A vertical wall on the
      anti-key flank receives no key at all, and on the key flank receives
      0.735 * cos(azimuth from the key) - about half what the shelf gets. Both
      are in the frame at `hub-establishing`, which is why the underside comes out
      asymmetric: 0.06-0.13 on the left flank, 0.13-0.23 on the right. That is
      the light being correct rather than a defect to flatten.
    */
    { radius: r + 0.78, y: -1.8, value: KEEL_WALL },
    // Below the silhouette. The turn back in has to be here rather than higher,
    // or the widest point moves up and the wall above it is occluded again.
    { radius: r + 0.4, y: -3.05, value: KEEL_UNDER },
    { radius: r - 3.4, y: -4.55, value: KEEL_ROOT_UPPER },
    { radius: r - 9.2, y: -6.0, value: KEEL_ROOT },
    { radius: 0, y: -7.2, value: KEEL_ROOT },
  ]
}

/**
 * The skirt as a lathe, with its profile in the order three needs.
 *
 * **This is where the silent failure lives, so the conversion is here and it is
 * tested.** `LatheGeometry` derives each normal as `(dy, -dx)` from the step to
 * the next profile point, so a profile authored from the top down - which is
 * the order it reads in, and the order `islandSkirtProfile` returns - produces
 * a mesh whose every normal points inward and downward. That renders as a
 * backfacing shell: invisible from outside the island, with a correct triangle
 * count, correct bounds, `visible: true` and no error anywhere. The frame comes
 * out looking exactly like the one this change exists to fix.
 *
 * The keel makes that test sharper rather than redundant. Version two's profile
 * was outward-facing at every stop, so an inward shell would have shown from any
 * angle; this one has a dead-vertical stop at the widest point, whose normal is
 * (1.000, -0.007) and whose sign therefore turns on 0.12 m of radius. That is
 * exactly the size of edit somebody makes while tuning a silhouette.
 */
export function islandSkirtLathe(plateauRadius: number, segments: number): BufferGeometry {
  const points = islandSkirtProfile(plateauRadius)
    .map((stop) => new Vector2(stop.radius, stop.y))
    .reverse()
  return new LatheGeometry(points, segments)
}

/**
 * The skirt's value ramp, in the form `paintByHeight` takes.
 *
 * Derived from the profile rather than written beside it, so the ramp's rungs are
 * the profile's own heights by construction. A rung that does not coincide with a
 * profile stop is not merely untidy: the GPU interpolates vertex colour linearly
 * between the ring vertices it has, so a rung authored halfway down a segment is
 * silently rounded to the nearest ring and the value the comment claims is not
 * the value that renders.
 */
export function islandSkirtValues(plateauRadius: number): Array<{ y: number; colour: string }> {
  return islandSkirtProfile(plateauRadius).map((stop) => ({ y: stop.y, colour: stop.value }))
}

// ---------------------------------------------------------------------------
// The background silhouette layer
// ---------------------------------------------------------------------------

/** One slab in the far monolith arc. */
export type Monolith = {
  x: number
  z: number
  /** Distance from the origin, which is what the fog and the tint key off. */
  distance: number
  width: number
  depth: number
  height: number
  baseY: number
  yaw: number
}

/**
 * The far layer: a broken arc of tall slabs across the northern horizon.
 *
 * The frame had exactly two depth layers, subject and sky, and the top half of
 * the portal shot was empty. The reference brief asks for three or four
 * parallax layers each in its own value band, and the environment spec has
 * specified this one since its first draft without it ever being built.
 *
 * These are the rest of the network: server monoliths, the same die the player
 * is standing on, at a scale that makes the island read as one chip among many.
 * They rise from below the fog rather than standing on anything, which removes
 * the question of what they are standing on: the bottoms dissolve and the tops
 * are what read.
 *
 * Placed on a jittered arc rather than a circle, because a constant radius is a
 * wall and a jittered one has depth - and depth inside the layer is what lets
 * one draw call do the work of two.
 */
export function monolithArc(count: number, random: () => number): Monolith[] {
  const out: Monolith[] = []
  // The northern 180 degrees, plus two strays behind the camera's shoulders so
  // the layer does not stop dead at the edge of frame when the player turns.
  const strays = [20, 160]

  for (let i = 0; i < count; i++) {
    const isStray = i >= count - strays.length
    const degrees = isStray
      ? strays[i - (count - strays.length)] + (random() - 0.5) * 14
      : 182 + ((i + 0.5) / Math.max(1, count - strays.length)) * 176 + (random() - 0.5) * 10

    const distance = 95 + random() * 35
    const radians = (degrees * Math.PI) / 180
    const top = -6 + random() * 24
    const height = 28 + random() * 28

    out.push({
      x: Math.cos(radians) * distance,
      z: Math.sin(radians) * distance,
      distance,
      width: 8 + random() * 12,
      depth: 6 + random() * 8,
      height,
      baseY: top - height,
      // Square-on to the origin, then turned off it so the arc is not a fan.
      yaw: -radians + (random() - 0.5) * 0.7,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Tier gating
// ---------------------------------------------------------------------------

/**
 * Keep only the arcs whose two pylons both survive the tier's pylon count.
 *
 * At low tier the ring drops from eight posts to six, and the arc spanning the
 * 300 and 330 degree slots was still being built - so the frame showed a cable
 * hanging in empty sky with square-cut ends and no pylon at either end. An arc
 * is a thing between two posts; if either post is gone the arc is not shortened,
 * it is meaningless.
 */
export function arcsWithBothEnds<T extends { from: number; to: number }>(
  arcs: readonly T[],
  visibleDegrees: readonly number[],
): T[] {
  const present = new Set(visibleDegrees)
  return arcs.filter((arc) => present.has(arc.from) && present.has(arc.to))
}

/**
 * Assert that a batch actually produced geometry.
 *
 * Every merge in this scene is one draw call standing in for a dozen objects,
 * and the way a merge fails here is by returning an empty geometry that renders
 * a perfectly clean frame with a dozen objects missing from it. Cheap to check,
 * and it has caught this exact class of bug in this codebase before.
 */
export function assertDrawable(geometry: BufferGeometry, what: string): BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) {
    throw new Error(`hubLayout: ${what} merged to an empty geometry, so it will draw nothing`)
  }
  return geometry
}

// ---------------------------------------------------------------------------
// The walkable layout, and the two batch part lists built from it
//
// These tables and the two builders below moved here from `HubIsland.tsx` for one
// reason: the offline lightmap bake in `tools/bake/` has to build the SAME
// geometry the runtime draws, and a lightmap baked against a second copy of the
// layout is worse than no lightmap, because the shadows land somewhere plausible
// and slightly wrong.
//
// `HubIsland.tsx` cannot be imported from Node - it reaches `useQuality`, which
// reads `location.search` at module scope - so the shared code has to live in a
// module with no React, no quality tiers and no browser globals. That is what this
// file already was, and its own header says so.
//
// The colliders still read these same tables from `HubIsland.tsx`, which is the
// property that stops a player standing on thin air beside a deck. That has not
// changed; only where the numbers are declared has.
// ---------------------------------------------------------------------------

/**
 * The vertical grid everything walkable sits on, and why it is 0.40 rather than
 * 0.45.
 *
 * `BODY.autostepHeight` is 0.50, so a 0.40 riser is climbed automatically with
 * 0.10 of margin, which is 20% of the threshold. The main path from the lawn to
 * the portal is seven of these steps and contains no jump and no ramp,
 * deliberately: the most unambiguous route is the one the player walks up
 * without ever being asked to time anything. Expression lives in the optional
 * east jump route and the west toy pile.
 *
 * Descent is covered too. `BODY.snapToGroundDistance` is 0.50, so walking DOWN
 * a 0.40 step is snapped rather than becoming a fall, and the player never gets
 * a spurious airborne frame coming off the Core.
 *
 * It is also the riser the whole lightmap is aimed at. The user's brief for the
 * bake named "the steps in the platform" specifically, and a 0.40 riser against a
 * 4 m tread is the one place in this level where an occlusion term has real work
 * to do: the tread in front of a riser loses a measurable share of its sky.
 */
export const STEP = 0.4

/** The Core: three stacked pucks, walked over on the way to the portal. */
export const CORE_PUCKS = [
  { radius: 6, base: 0 },
  { radius: 4, base: STEP },
  { radius: 2.2, base: 2 * STEP },
] as const

/**
 * The four spur lobes, centred at radius 7.071 on the diagonals.
 *
 * Their inner edge sits at radius 5.571 against Puck A's 6.00, so they fuse
 * into it by 0.43 m and the whole thing reads as one four-lobed dais rather
 * than as five separate objects.
 *
 * That fusion is why the atlas packs charts PER PART rather than per connected
 * component: the union of a spur and Puck A is not convex, but each of them is,
 * and the interpenetrating texels simply bake to near zero visibility because
 * they are genuinely enclosed. Correct, and invisible.
 */
export const SPURS = [
  { id: 'NE', x: 5, z: -5 },
  { id: 'NW', x: -5, z: -5 },
  { id: 'SW', x: -5, z: 5 },
  { id: 'SE', x: 5, z: 5 },
] as const

export const SPUR_RADIUS = 1.5

/**
 * The bridge, whose south edge touches Puck C at z = -2.20 and whose north edge
 * touches T1 at z = -6.60, which is what makes both risers a clean 0.40.
 */
export const BRIDGE = { x: 0, z: -4.4, radius: 2.2, height: 4 * STEP }

/**
 * The three portal decks.
 *
 * Solid from the lawn up rather than floating slabs, which is why each
 * collider's half-height is half the FULL height and its centre is not its top.
 * T3's corners sit at radius 15.52 against a plateau of 16, the tightest fit in
 * the layout and deliberate: the portal deck is meant to feel like it is right
 * at the edge of the world.
 */
export const DECKS = [
  { id: 'T1', x: 0, z: -8.6, width: 12, depth: 4, height: 5 * STEP },
  { id: 'T2', x: 0, z: -11.5, width: 8, depth: 1.8, height: 6 * STEP },
  { id: 'T3', x: 0, z: -13.7, width: 8, depth: 2.6, height: 7 * STEP },
] as const

/**
 * The optional east jump route: lawn to T1, skipping the Core entirely.
 *
 * Every gap is under 60% of what the jump arc allows for its rise, which leaves
 * room for a mistimed takeoff. The route gets easier as it goes, which is the
 * right shape: the first step advertises that this is a jump route, and the
 * last is forgiving so a player who committed is not punished at the end.
 */
export const EAST_PUCKS = [
  { x: 9, z: -2.6, radius: 1.1, height: 2 * STEP, colliderRadius: 1 },
  { x: 9.6, z: -6.4, radius: 1.1, height: 4 * STEP, colliderRadius: 1 },
  { x: 8.4, z: -10, radius: 1.1, height: 5 * STEP, colliderRadius: 1 },
] as const

/**
 * The west toy pile, where the jump, the coyote time and the autostep get
 * tested without leaving the hub.
 *
 * The yaws are small and deliberately not multiples of each other. A stack of
 * blocks at the same angle reads as a staircase; a stack at jostled angles
 * reads as a pile someone dropped. Every level of the world, 0.40 through 2.00,
 * appears in one five-metre clump, and the gaps are all far inside budget. That
 * is correct: it is a playground, not a challenge.
 */
export const WEST_PILE = [
  { kind: 'slab', x: -9.6, z: 2.4, width: 3.2, depth: 3.2, height: 2 * STEP, yaw: 0.122, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -7.6, z: 1.2, width: 0, depth: 0, height: 3 * STEP, yaw: 0, radius: 1.3, colliderRadius: 1.2 },
  { kind: 'slab', x: -10.4, z: 0.4, width: 2.4, depth: 2.4, height: 4 * STEP, yaw: -0.192, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -11.6, z: 2.6, width: 0, depth: 0, height: 5 * STEP, yaw: 0, radius: 0.9, colliderRadius: 0.8 },
  { kind: 'slab', x: -7.8, z: 3.8, width: 2, depth: 2, height: STEP, yaw: 0.332, radius: 0, colliderRadius: 0 },
] as const

export const KERB_HEIGHT = 0.6
export const KERB_DEPTH = 0.36
/** Kerbs are inset half their depth so the outer face is flush with the deck below. */
export const KERB_INSET = KERB_DEPTH / 2

/**
 * Every exposed deck edge that is not part of the route.
 *
 * A kerb is band 2 on a band 1 deck, so a kerb draws the platform's outline as a
 * dark line, and that line is what makes a raised deck read as raised in a
 * greyscale frame where a value change across a flat top does not.
 *
 * Eleven runs, not the ten the spec's summary claims; its own table lists six
 * on T1, two on T2 and three on T3.
 */
export const KERBS = [
  // T1. Open at the bridge mouth in the south and up to T2 in the north.
  { x: -4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  { x: 4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  /*
    These two are T1's NORTH edge, at z = -10.60, and the inset has to run in +z
    to reach the deck. They read `- KERB_INSET` until this pass, which put them at
    z = -10.78: a 0.36 m kerb spanning -10.96 to -10.60, touching T1 along one
    line and hanging entirely off the deck into open air beyond it. Every other
    entry in this table insets toward the deck - `6 - INSET`, `-6 + INSET`,
    `4 - INSET`, `-4 + INSET`, `-15 + INSET` - so the sign was the only thing
    wrong and the fix is consistent with all nine of them.

    Their colliders come from this same table, so nothing was ever functionally
    broken; there was simply an invisible wall in the same wrong place as the mesh.
  */
  { x: -5, z: -10.6 + KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
  { x: 5, z: -10.6 + KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
  { x: 6 - KERB_INSET, z: -8.6, length: 4, yaw: Math.PI / 2, top: 5 * STEP },
  { x: -6 + KERB_INSET, z: -8.6, length: 4, yaw: Math.PI / 2, top: 5 * STEP },
  // T2. Open south from T1 and north to T3.
  { x: 4 - KERB_INSET, z: -11.5, length: 1.8, yaw: Math.PI / 2, top: 6 * STEP },
  { x: -4 + KERB_INSET, z: -11.5, length: 1.8, yaw: Math.PI / 2, top: 6 * STEP },
  // T3. Open south from T2 only.
  { x: 4 - KERB_INSET, z: -13.7, length: 2.6, yaw: Math.PI / 2, top: 7 * STEP },
  { x: -4 + KERB_INSET, z: -13.7, length: 2.6, yaw: Math.PI / 2, top: 7 * STEP },
  { x: 0, z: -15 + KERB_INSET, length: 8, yaw: 0, top: 7 * STEP },
] as const

/**
 * Where each hub lesson's totem stands, keyed by lesson id.
 *
 * The reading order runs anticlockwise from the spawn, so the two you meet
 * first sit on the near side of the Core and the two you meet last face the
 * portal.
 *
 * Held here rather than in `src/state/lessons.ts`, where the spec asks for it,
 * because that file is content and belongs to another stream. A totem falls
 * back to its lesson's own position if it is not listed, so adding a fifth
 * basics lesson degrades to the old behaviour rather than to a crash.
 *
 * **Insertion order is load-bearing** and was nearly lost moving this here.
 * `hubDeckParts` folds the plinths in via `Object.values`, so these four entries
 * are the last four parts of the deck batch in exactly this sequence. Re-sorting
 * the keys alphabetically, or writing them out by compass point, keeps the same
 * four plinths in the same four places and silently permutes their charts.
 */
export const TOTEM_SPURS: Record<string, [number, number, number]> = {
  'what-is-ai': [-5, STEP, 5],
  'what-is-an-llm': [5, STEP, 5],
  'popular-models': [-5, STEP, -5],
  'what-is-a-prompt': [5, STEP, -5],
}

/**
 * Every walkable piece in the level, as a part list ready for `mergeProp`.
 *
 * The ORDER of this list is load-bearing in a way it was not before the lightmap.
 * `packLightmapAtlas` attributes triangles back to parts by their position in the
 * merge, so inserting a puck in the middle of this function moves every later
 * part's charts and invalidates the bake. The manifest hash is what makes that
 * loud instead of silent: it is computed from this list's geometry, so a reordered
 * or resized layout fails the check at load rather than rendering someone else's
 * shadows.
 *
 * `plinth` is a parameter rather than an import because `totemPlinth` lives in
 * `LessonTotem.tsx` and this module is deliberately free of React. Both callers -
 * the component and the bake - pass the same `totemPlinth()` result.
 */
export function hubDeckParts(plinth: BufferGeometry): PropPart[] {
  const parts: PropPart[] = []

  for (const { radius, base } of CORE_PUCKS) {
    parts.push({ geometry: puck(radius, STEP), position: [0, base, 0] })
  }
  for (const spur of SPURS) {
    parts.push({ geometry: puck(SPUR_RADIUS, STEP), position: [spur.x, 0, spur.z] })
  }
  parts.push({ geometry: puck(BRIDGE.radius, BRIDGE.height), position: [BRIDGE.x, 0, BRIDGE.z] })

  for (const deck of DECKS) {
    parts.push({ geometry: slab(deck.width, deck.height, deck.depth), position: [deck.x, 0, deck.z] })
  }
  for (const east of EAST_PUCKS) {
    parts.push({ geometry: puck(east.radius, east.height), position: [east.x, 0, east.z] })
  }
  for (const piece of WEST_PILE) {
    parts.push(
      piece.kind === 'slab'
        ? {
            geometry: slab(piece.width, piece.height, piece.depth),
            position: [piece.x, 0, piece.z],
            rotation: [0, piece.yaw, 0],
          }
        : { geometry: puck(piece.radius, piece.height), position: [piece.x, 0, piece.z] },
    )
  }

  // The totem plinths, folded in from LessonTotem rather than drawn there.
  for (const position of Object.values(TOTEM_SPURS)) parts.push({ geometry: plinth, position })

  return parts
}

/** Every kerb, as a part list ready for `mergeProp`. */
export function hubTrimParts(): PropPart[] {
  return KERBS.map((run) => ({
    geometry: kerb(run.length, KERB_HEIGHT, KERB_DEPTH),
    position: [run.x, run.top, run.z] as [number, number, number],
    rotation: [0, run.yaw, 0] as [number, number, number],
  }))
}

/**
 * The atlas geometry, read by both the bake and the runtime.
 *
 * It lives in this file rather than in `src/art/lightmap.ts` because the bake tool
 * needs it and `lightmap.ts` statically imports the baked PNG, so a bake that read
 * it from there could not run until its own output already existed.
 *
 * **Resolution, argued from measured area rather than chosen.** The two walkable
 * batches are 19,848 and 4,356 triangles carrying **1071.4 m2 of surface** across
 * **204 charts**. That figure is much larger than a look at the level suggests,
 * because it counts both sides of everything: deck undersides sitting on the lawn,
 * and the faces where the four spur lobes fuse 0.43 m into Puck A. Those texels bake
 * to near zero visibility, correctly, and are never seen. Culling them was
 * considered and rejected - "is this face visible" is not answerable before the
 * trace, and a heuristic that guessed wrong would remove occlusion from something
 * on screen.
 *
 * At 2048 and 44 texels per metre the atlas is 60.8% occupied, which is **2.27 cm
 * per texel**. The number that sizes it is not the deck, it is the 0.12 m bevel on
 * every edge in the kit: at 44 texels/m that bevel is 5.3 texels across, and the
 * bevel is where the sharpest real gradient in the whole bake sits.
 *
 * 1024 at 24 texels/m also fits, at 77.6% occupancy and 4.17 cm/texel, and is a
 * one-line downgrade if the memory is ever wanted back. It was baked and read back
 * and it is not obviously worse anywhere except on the bevels, where the band
 * narrows to 2.9 texels - which is also what made a rasteriser bug visible, so the
 * finer grid is buying real headroom rather than just numbers.
 *
 * 4096 was priced and rejected: 68 texels/m only reaches 35.1% occupancy because the
 * shelf packer cannot fill it, so it is four times the memory for 1.5x the texel
 * density. **And the brief's framing of the cost needs correcting in both
 * directions.** This is a single-channel image, so 4096 would be 16 MB of source
 * data rather than the 64 MB quoted - but three uploads an `Image` as RGBA whatever
 * the PNG contains, so VRAM is 4 bytes a texel regardless: 4 MB at 1024, **16 MB at
 * 2048**, 64 MB at 4096, and a third again on top if mipmaps were on. They are not;
 * see `configureLightmap`.
 */
export const HUB_LIGHTMAP_ATLAS: Required<LightmapAtlasOptions> = {
  size: 2048,
  texelsPerMetre: 44,
  gutter: 2,
}
