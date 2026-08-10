import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import {
  PLATEAU_RADIUS,
  TRACE,
  arcsWithBothEnds,
  assertDrawable,
  chamferCorners,
  densifyPath,
  islandSkirtLathe,
  islandSkirtProfile,
  islandSkirtValues,
  monolithArc,
  orthoTrace,
  pathLength,
  pathVerticalRuns,
  spurTraceCorners,
  traceSegments,
  trunkTraceCorners,
  type Point3,
} from './hubLayout'
import { mulberry32 } from '@/art/placement'
import { displayLuma, palette } from '@/art/palette'
import { trace } from '@/art/geometry'

const AXIS_TOLERANCE = 1e-9

describe('chamferCorners', () => {
  it('replaces a right angle with two points and no corner', () => {
    const path: Point3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ]
    const out = chamferCorners(path, 0.2)
    expect(out).toHaveLength(4)
    expect(out[1]).toEqual([0.8, 0, 0])
    expect(out[2]).toEqual([1, 0, 0.2])
  })

  it('leaves collinear points alone, so densifying twice is safe', () => {
    const path: Point3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]
    expect(chamferCorners(path, 0.4)).toEqual(path)
  })

  it('never cuts back past the middle of a short segment', () => {
    /*
      Two corners closer together than twice the chamfer would otherwise emit
      points in the wrong order and turn the run inside out, which renders as a
      trace briefly doubling back through the deck it is lying on.
    */
    const path: Point3[] = [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.3, 0, 0.3],
      [0.6, 0, 0.3],
    ]
    const out = chamferCorners(path, 1)
    for (let i = 1; i < out.length; i++) {
      const previous = out[i - 1]
      const point = out[i]
      const moved = Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2])
      expect(moved).toBeGreaterThanOrEqual(0)
    }
    // Every emitted point stays inside the bounding box of the input.
    for (const [x, , z] of out) {
      expect(x).toBeGreaterThanOrEqual(-AXIS_TOLERANCE)
      expect(x).toBeLessThanOrEqual(0.6 + AXIS_TOLERANCE)
      expect(z).toBeGreaterThanOrEqual(-AXIS_TOLERANCE)
      expect(z).toBeLessThanOrEqual(0.3 + AXIS_TOLERANCE)
    }
  })
})

describe('densifyPath', () => {
  it('never leaves a gap wider than the spacing', () => {
    const out = densifyPath(
      [
        [0, 0, 0],
        [0, 0, -3.7],
      ],
      0.15,
    )
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i][2] - out[i - 1][2])).toBeLessThanOrEqual(0.15 + 1e-9)
    }
    expect(out[out.length - 1]).toEqual([0, 0, -3.7])
  })

  it('keeps the subdivided points exactly on the line', () => {
    const out = densifyPath(
      [
        [0, 1, 0],
        [2, 1, -2],
      ],
      0.3,
    )
    // The run is a 45-degree diagonal at constant height, so x = -z and y = 1
    // must hold at every sample or the spline through them will not be straight.
    for (const [x, y, z] of out) {
      expect(y).toBeCloseTo(1, 12)
      expect(x).toBeCloseTo(-z, 12)
    }
  })
})

describe('the trace routes', () => {
  it('runs the trunk on the centreline, orthogonally, at four heights', () => {
    const corners = trunkTraceCorners()
    for (const [x] of corners) expect(x).toBe(0)

    // Every leg is either a pure run in z or a pure climb in y. A leg that is
    // both is the wandering diagonal the whole rewrite exists to remove.
    for (let i = 1; i < corners.length; i++) {
      const dy = Math.abs(corners[i][1] - corners[i - 1][1])
      const dz = Math.abs(corners[i][2] - corners[i - 1][2])
      expect(Math.min(dy, dz)).toBeLessThan(AXIS_TOLERANCE)
      expect(Math.max(dy, dz)).toBeGreaterThan(0)
    }
  })

  it('holds the trunk within the height rule over every deck it crosses', () => {
    /*
      The absolute rule from the environment spec: a trace segment is at or
      below 0.12 m above the surface beneath it, or at or above 3.00 m. The
      horizontal runs are the ones this applies to, and the crown of the tube -
      standoff plus radius - is what has to clear it.
    */
    const crown = TRACE.standoff + TRACE.trunkRadius
    expect(crown).toBeLessThanOrEqual(0.12)

    const heights = [1.2, 1.6, 2, 2.4, 2.8].map((deck) => deck + TRACE.standoff)
    for (const [, y] of trunkTraceCorners()) {
      expect(heights.some((h) => Math.abs(h - y) < 1e-9), `y = ${y}`).toBe(true)
    }
  })

  it('buries both ends of a spur so neither shows a cut tube', () => {
    const corners = spurTraceCorners()
    const radiusOf = ([x, , z]: Point3) => Math.hypot(x, z)

    // The outer end sits inside the totem plinth: radius 0.70 centred at 7.071.
    expect(Math.abs(radiusOf(corners[0]) - 7.071)).toBeLessThan(0.7)
    // The inner end sits inside the junction pad.
    expect(radiusOf(corners[corners.length - 1])).toBeLessThan(TRACE.junctionRadius)
  })

  it('produces a dense, finite polyline with the mitres intact', () => {
    const path = orthoTrace(trunkTraceCorners())
    expect(path.length).toBeGreaterThan(80)
    for (const p of path) for (const v of p) expect(Number.isFinite(v)).toBe(true)

    // A mitre exists where a step is taken in y and z at once. Four risers, two
    // mitres each, so at least eight diagonal samples must survive densifying.
    const diagonal = path.filter((p, i) => {
      if (i === 0) return false
      const dy = Math.abs(p[1] - path[i - 1][1])
      const dz = Math.abs(p[2] - path[i - 1][2])
      return dy > 1e-6 && dz > 1e-6
    })
    expect(diagonal.length).toBeGreaterThanOrEqual(8)
  })

  it('asks for enough segments to resolve a mitre', () => {
    const trunk = orthoTrace(trunkTraceCorners())
    const segments = traceSegments(pathLength(trunk), 64)
    expect(pathLength(trunk) / segments).toBeLessThan(TRACE.chamfer)
  })

  /*
    The routes are now watercourses, and water only runs one way.

    `waterMaterial.ts` advects its wave field toward decreasing `uv.x`, and `uv.x`
    runs from the first authored corner to the last, so that is downhill only
    while every route climbs monotonically as authored. It does today: a spur
    climbs from its totem plinth at y 0.44 to the junction at 1.24, and the trunk
    climbs from the junction at 1.24 to the threshold pad at 2.84. One sign
    therefore serves the whole network - the arch is the single spring, the four
    totems are the outfalls, and the junction pad is a basin mid-slope.

    A reroute that dropped one corner below the one before it would leave water
    visibly running uphill along part of that route, with nothing in the shader,
    the material or the geometry to blame. Checked here rather than read.
  */
  it('climbs monotonically on both routes, so one flow direction is downhill on all of them', () => {
    const trunk = pathVerticalRuns(trunkTraceCorners())
    expect(trunk.down).toBe(0)
    // Four risers of 0.40 from the junction pad to the threshold pad.
    expect(trunk.up).toBeCloseTo(1.6, 9)

    const spur = pathVerticalRuns(spurTraceCorners())
    expect(spur.down).toBe(0)
    // Two risers of 0.40, from the totem plinth up to the junction.
    expect(spur.up).toBeCloseTo(0.8, 9)
  })

  /*
    And it survives mitring and densifying, which is what the shader actually
    sees. `chamferCorners` cuts each corner back along both neighbours, so a
    vertical leg shorter than twice the chamfer could in principle be cut into a
    descent; the clamp to 45% of the shorter neighbour is what prevents it, and
    this is the assertion that the clamp is doing that job on these two routes.
  */
  it('still climbs monotonically after mitring and densifying', () => {
    expect(pathVerticalRuns(orthoTrace(trunkTraceCorners())).down).toBeLessThan(1e-12)
    expect(pathVerticalRuns(orthoTrace(spurTraceCorners())).down).toBeLessThan(1e-12)
  })
})

describe('pathVerticalRuns', () => {
  it('separates climb from fall rather than reporting net rise', () => {
    const zigzag: Point3[] = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0.25, 0],
      [0, 1.5, 0],
    ]
    expect(pathVerticalRuns(zigzag)).toEqual({ up: 2.25, down: 0.75 })
  })

  it('reports nothing for a flat path or a path of one point', () => {
    expect(pathVerticalRuns([[0, 2, 0], [5, 2, 0]])).toEqual({ up: 0, down: 0 })
    expect(pathVerticalRuns([[0, 2, 0]])).toEqual({ up: 0, down: 0 })
  })
})

describe('the swept trace geometry', () => {
  /*
    The path arithmetic being right is not the same as the tube being right. A
    Catmull-Rom overshoots a corner it is given too little room for, and the
    overshoot on a trunk that runs 0.04 above a deck is the trace sinking
    through the deck for a few centimetres - which renders as a trace that
    flickers on and off as the camera moves, and which no assertion about the
    polyline would catch.
  */
  const trunk = trace(orthoTrace(trunkTraceCorners()), TRACE.trunkRadius, 280)

  it('sweeps a finite tube', () => {
    const position = trunk.getAttribute('position')
    expect(position.count).toBeGreaterThan(1000)
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true)
      expect(Number.isFinite(position.getY(i))).toBe(true)
      expect(Number.isFinite(position.getZ(i))).toBe(true)
    }
  })

  it('stays inlaid: buried at the bottom, never floating, never adrift', () => {
    trunk.computeBoundingBox()
    const box = trunk.boundingBox!
    /*
      The lowest deck on the route is Puck C at 1.20. Nominal underside is
      1.20 - 0.075 + 0.04 = 1.165, and the measured minimum is 1.158: the
      spline overshoots by seven millimetres where a straight run meets a
      mitre, which is a third of a tube radius and buries the tube slightly
      deeper rather than lifting it. The bound is set where it would catch a
      real overshoot - anything that surfaced, or that sank far enough to
      vanish - rather than at the nominal value.
    */
    expect(box.min.y).toBeGreaterThan(1.2 - 0.09)
    expect(box.min.y).toBeLessThan(1.2)
    // Highest is T3 at 2.80 plus the mitre that climbs onto it.
    expect(box.max.y).toBeLessThan(3.1)
    // It never leaves the centreline by more than its own radius.
    expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThanOrEqual(
      TRACE.trunkRadius + 1e-6,
    )
  })

  it('reaches both ends of its route', () => {
    trunk.computeBoundingBox()
    const box = trunk.boundingBox!
    expect(box.max.z).toBeGreaterThan(-1.1)
    expect(box.min.z).toBeLessThan(-13.6)
  })
})

describe('islandSkirtProfile', () => {
  const profile = islandSkirtProfile(PLATEAU_RADIUS)

  it('overhangs the plateau, which is the only reason it is visible at all', () => {
    /*
      Every camera in the game looks down at the island. A skirt that tapers
      inward from the plateau radius is occluded by the plateau at every one of
      them, which is how the previous build shipped three rim meshes and a lawn
      that still ended against sky as a hard curve.
    */
    const widest = Math.max(...profile.map((s) => s.radius))
    expect(widest).toBeGreaterThan(PLATEAU_RADIUS + 0.5)
  })

  it('puts its widest stop well BELOW the lawn, which is what makes a thickness', () => {
    /*
      The version before this one satisfied the overhang test above and still
      gave the island a trim rather than a thickness, so this is the assertion
      that was missing rather than a restatement of it.

      For a solid of revolution seen from outside and above, the stop of maximum
      radius IS the lower silhouette: everything below it is behind it or
      back-facing. Version two put that stop 0.52 m below the lawn, so the only
      thing ever in frame below the lawn was the up-facing shelf between the
      lawn's edge and the overhang - measured as 95.8% of every skirt pixel in
      `hub-establishing` with the cliff below contributing exactly zero. The
      depth of the widest stop is the height of the visible wall, and therefore
      the entire budget the anchor band has to spend.
    */
    const widest = profile.reduce((a, b) => (b.radius > a.radius ? b : a))
    expect(widest.y).toBeLessThan(-1.2)

    // And it must be the UNIQUE maximum, or the silhouette is a band rather
    // than an edge and the wall above it goes back behind its own overhang.
    const ties = profile.filter((s) => s.radius >= widest.radius)
    expect(ties).toHaveLength(1)
  })

  it('keeps the shelf steep enough that no on-island camera can see the keel', () => {
    /*
      This is the number that keeps a near-black band out of `hub-grazing` and
      `hub-backlit`, and it is geometry rather than restraint.

      From a camera standing ON the plateau, a ray reaches the skirt only if it
      clears the lawn's edge and then descends faster than the outermost skirt
      surface does. So the underside is invisible from inside the island unless
      `camera height / horizontal distance to the lawn edge` exceeds the slope of
      the first stop below the lawn. Best case over the five vantages sited on
      the island - each looking at its own nearest rim - is `hub-totem` at 0.341:

        hub-character  1.72 / 5.91 = 0.291
        hub-grazing    0.75 / 6.74 = 0.111
        hub-totem      2.35 / 6.90 = 0.341
        hub-backlit    1.49 / 8.40 = 0.177
        hub-portal     5.10 / 9.34 = 0.546   <- the one that can, and does

      Below about 0.36 this stops being true and the keel starts appearing at eye
      level in shots framed on the character, which is the one place the decision
      document promises it never will.
    */
    const lawn = profile[0]
    const shelf = profile[1]
    const slope = Math.abs(shelf.y - lawn.y) / (shelf.radius - lawn.radius)
    expect(slope).toBeGreaterThan(0.36)
  })

  it('darkens monotonically as it descends, since a cone cannot shade itself', () => {
    /*
      The acceptance criterion for this round, expressed where it can be checked
      without a GPU: "the x = 1550 profile shows a gradient rather than a flat
      plateau". A lathe segment is one conical band with one normal, so the
      lighting contributes almost nothing to a gradient down the skirt - the old
      skirt measured 0.230 falling to 0.202 over ninety pixels and 0.028 of that
      0.029 was the VIGNETTE. The gradient has to be authored into the values, so
      it is asserted on the values.
    */
    const luma = profile.map((s) => displayLuma(s.value))
    for (let i = 1; i < luma.length; i++) {
      expect(luma[i], `stop ${i} at y ${profile[i].y}`).toBeLessThanOrEqual(luma[i - 1])
    }
    // And it has to actually travel, not merely fail to rise.
    expect(luma[0] - luma[luma.length - 1]).toBeGreaterThan(0.2)
  })

  it('starts from palette.soil and never asserts a band on the darks', () => {
    /*
      `palette.band()` refuses the anchor band on purpose - a surface reaches
      0.06 to 0.18 by facing away from the key, not by having a dark hex - so the
      only thing assertable here is the top of the ramp, which is a midground
      value and is a real palette entry.
    */
    expect(profile[0].value).toBe(palette.soil)
    for (const stop of profile) expect(stop.value).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('hands paintByHeight rungs that land exactly on profile stops', () => {
    /*
      The GPU interpolates vertex colour linearly between the ring vertices it
      has, so a ramp rung authored halfway down a segment is silently rounded to
      the nearest ring: the value the comment claims is not the value that
      renders, and nothing reports it. Deriving the rungs from the profile makes
      that unrepresentable, and this pins the derivation.
    */
    const values = islandSkirtValues(PLATEAU_RADIUS)
    expect(values).toHaveLength(profile.length)
    values.forEach((rung, i) => {
      expect(rung.y).toBe(profile[i].y)
      expect(rung.colour).toBe(profile[i].value)
    })
  })

  it('starts flush with the lawn edge and descends monotonically', () => {
    expect(profile[0].radius).toBe(PLATEAU_RADIUS)
    expect(profile[0].y).toBe(0)
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i].y).toBeLessThan(profile[i - 1].y)
    }
    expect(profile[profile.length - 1].radius).toBe(0)
  })

  it('lathes with outward normals, not an invisible backfacing shell', () => {
    /*
      The failure this guards is the house speciality: `LatheGeometry` derives
      normals as (dy, -dx), so a top-down profile produces a mesh facing inward.
      It has the right triangle count, the right bounds, `visible: true`, throws
      nothing, and cannot be seen. Two of the three meshes this skirt replaced
      were invisible for a different reason and nobody noticed for a whole art
      pass, so this is checked rather than assumed.
    */
    const geometry = islandSkirtLathe(PLATEAU_RADIUS, 24)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    expect(position.count).toBeGreaterThan(0)

    let checked = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      // Skip the apex, where there is no outward direction to test against.
      if (radius < 0.5) continue
      const outward =
        (position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i)) / radius
      expect(outward, `vertex ${i} at radius ${radius.toFixed(2)}`).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('gives the lip a strongly up-facing normal, which is what puts it in band', () => {
    /*
      The lip has to land in the midground band as a MEASURED value, and a
      surface's rendered value under a steeply overhead key is mostly a function
      of which way it faces. An up-facing normal takes the key almost in full; a
      vertical one takes about a third of it and would land near black, which is
      the pylons' defect and not one worth repeating on the island's own edge.
    */
    const a = profile[0]
    const b = profile[1]
    const dr = b.radius - a.radius
    const dy = b.y - a.y
    const normalY = dr / Math.hypot(dr, dy)
    expect(normalY).toBeGreaterThan(0.85)
  })
})

describe('monolithArc', () => {
  const slabs = monolithArc(13, mulberry32(20260809))

  it('places every slab beyond the sub-island band and inside the fog', () => {
    expect(slabs).toHaveLength(13)
    for (const slab of slabs) {
      expect(slab.distance).toBeGreaterThanOrEqual(95)
      expect(slab.distance).toBeLessThanOrEqual(130)
      expect(Math.hypot(slab.x, slab.z)).toBeCloseTo(slab.distance, 6)
    }
  })

  it('keeps every top in frame and every base below the cloud line', () => {
    for (const slab of slabs) {
      const top = slab.baseY + slab.height
      expect(top).toBeGreaterThan(-7)
      expect(top).toBeLessThan(20)
      expect(slab.baseY).toBeLessThan(-18)
    }
  })

  it('is deterministic, so a background layer cannot reshuffle between captures', () => {
    expect(monolithArc(13, mulberry32(20260809))).toEqual(slabs)
  })
})

describe('arcsWithBothEnds', () => {
  const arcs = [
    { from: 30, to: 0 },
    { from: 210, to: 240 },
    { from: 300, to: 330 },
  ]

  it('drops the arc whose pylons the tier no longer draws', () => {
    // Low tier keeps the first six slots, so 300 and 330 are gone and the cable
    // between them must go with them rather than hanging in empty sky.
    expect(arcsWithBothEnds(arcs, [0, 30, 150, 180, 210, 240])).toEqual([
      { from: 30, to: 0 },
      { from: 210, to: 240 },
    ])
  })

  it('keeps every arc when every pylon is present', () => {
    expect(arcsWithBothEnds(arcs, [0, 30, 150, 180, 210, 240, 300, 330])).toEqual(arcs)
  })
})

describe('assertDrawable', () => {
  it('throws on an empty merge rather than rendering a clean frame with a hole in it', () => {
    expect(() => assertDrawable(new BufferGeometry(), 'the test batch')).toThrow(/draw nothing/)
  })

  it('passes a geometry that has vertices', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    expect(assertDrawable(geometry, 'the test batch')).toBe(geometry)
  })
})
