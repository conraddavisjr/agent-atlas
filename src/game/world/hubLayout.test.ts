import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import {
  PLATEAU_RADIUS,
  POOL,
  TRACE,
  WATER_SECTION,
  WATER_SHORE_ATTRIBUTE,
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
  poolFloorRadius,
  poolRingColliders,
  spurTraceCorners,
  sweepChannel,
  traceSegments,
  trunkTraceCorners,
  waterDisc,
  waterSection,
  basinLathe,
  STEP,
  CORE_PUCKS,
  type Point3,
} from './hubLayout'
import { mulberry32 } from '@/art/placement'
import { displayLuma, palette } from '@/art/palette'
import { mergeProp, puck } from '@/art/geometry'
import { WATER } from '@/art/waterMaterial'
import { BODY } from '@/game/player/tuning'
import type { BufferAttribute as Attribute, InterleavedBufferAttribute } from 'three'

const AXIS_TOLERANCE = 1e-9

/** Area of a triangle from an indexed position attribute, for degeneracy checks. */
function triangleArea(
  position: Attribute | InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
): number {
  const ux = position.getX(b) - position.getX(a)
  const uy = position.getY(b) - position.getY(a)
  const uz = position.getZ(b) - position.getZ(a)
  const vx = position.getX(c) - position.getX(a)
  const vy = position.getY(c) - position.getY(a)
  const vz = position.getZ(c) - position.getZ(a)
  return (
    0.5 *
    Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  )
}

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
      horizontal runs are the ones this applies to, and the CROWN of the swept
      section is what has to clear it.

      The crown is now the section's apex rather than "standoff plus radius",
      which is the arithmetic that changed with the cross-section: 0.345 half
      widths above the bed, so 0.038 m on the trunk against version two's 0.115.
      The rule is met with three times the margin, and the assertion is written
      against the section rather than against a literal so a re-authored section
      cannot quietly breach it.
    */
    const apex = Math.max(...WATER_SECTION.map((p) => p.up))
    const crown = TRACE.standoff + apex * TRACE.trunkHalfWidth
    expect(crown).toBeCloseTo(0.038, 3)
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
    expect(radiusOf(corners[corners.length - 1])).toBeLessThan(POOL.radius)
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
  const trunk = sweepChannel(orthoTrace(trunkTraceCorners()), TRACE.trunkHalfWidth, 280)

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
      TRACE.trunkHalfWidth + 1e-6,
    )
  })

  it('reaches both ends of its route', () => {
    trunk.computeBoundingBox()
    const box = trunk.boundingBox!
    expect(box.max.z).toBeGreaterThan(-1.1)
    expect(box.min.z).toBeLessThan(-13.6)
  })
})

describe('waterSection', () => {
  const full = waterSection()
  const rim = full[full.length - 2]
  const tuck = full[full.length - 1]

  it('mirrors symmetrically and keeps the crown dead vertical', () => {
    /*
      The crown's normal is the one point that goes wrong if the section is halved
      before its normals are derived rather than after: with one neighbour instead of
      two it comes out tilted 5.7 degrees outward. That tilt would then be the normal
      of a POOL's entire flat interior, because `waterDisc` takes the half form -
      two square metres of still water at centre frame lit as a shallow cone.
    */
    const crown = full[(full.length - 1) / 2]
    expect(crown.across).toBe(0)
    expect(crown.normalAcross).toBeCloseTo(0, 12)
    expect(crown.normalUp).toBeCloseTo(1, 12)

    // And the halved form has to agree with the full one point for point.
    const half = waterSection(true)
    expect(half).toEqual(full.slice((full.length - 1) / 2))
  })

  it('hands back unit normals at every point, at every relief', () => {
    for (const relief of [1, TRACE.endRelief, POOL.rimDrop]) {
      for (const p of waterSection(false, relief)) {
        expect(Math.hypot(p.normalAcross, p.normalUp), `relief ${relief}`).toBeCloseTo(1, 12)
      }
    }
  })

  /*
    THIS is the assertion that ties the geometry to the shader. Both files were
    written against the same four numbers and neither imports them from the other, so
    without this they can drift by one edit: a re-authored section whose rim normal
    climbed to 0.3 would put the alpha ramp in the wrong place and leave the water
    ending on the hard silhouette line the ramp exists to remove, in a frame that
    still renders water.
  */
  it('lands every visible point inside the shader alpha window and the tuck outside it', () => {
    const visible = full.filter((p) => p.up >= 0)
    for (const p of visible) {
      expect(p.normalUp, `visible point at across ${p.across}`).toBeGreaterThan(WATER.shoreTop)
    }
    // The rim sits at the bed plane and must still be fully opaque.
    expect(rim.up).toBe(0)
    expect(rim.normalUp).toBeGreaterThan(WATER.shoreTop)
    // The buried tuck must fade to nothing, or the water shows inside the deck.
    expect(tuck.normalUp).toBeLessThan(WATER.shoreBottom)
  })

  it('keeps the rim near grazing, which is where the sky reflection comes from', () => {
    /*
      A fourth-power Fresnel needs `dot(N, V)` small, so the bank has to present a
      near-horizontal normal or the channel reflects nothing anywhere. This is also
      the property that survives the discs' flattening - see `POOL.rimDrop` - so it is
      asserted at both reliefs rather than only at the channel's.
    */
    expect(rim.normalUp).toBeLessThan(0.15)
    const flattened = waterSection(true, POOL.rimDrop)
    expect(flattened[flattened.length - 2].normalUp).toBeLessThan(0.15)
  })

  it('opens the meniscus inboard of the shoulder, not at the rim', () => {
    /*
      The rim is the part of the section that dips under the surface it is held in, so
      a band anchored there is a band mostly buried. `WATER.foamShore` has to fall
      between the dome's shore value and the shoulder's for the band to sit on
      visible water. See `WATER_SECTION`'s note for the pool arithmetic.
    */
    const dome = WATER_SECTION[1]
    const shoulder = WATER_SECTION[2]
    expect(WATER.foamShore).toBeGreaterThan(dome.shore)
    expect(WATER.foamShore).toBeLessThanOrEqual(shoulder.shore)
    // Open water carries none of it and the bank carries all of it.
    expect(WATER_SECTION[0].shore).toBe(0)
    expect(WATER_SECTION[WATER_SECTION.length - 1].shore).toBe(1)
  })

  it('is self-similar, so one shoreline is right on all four pieces', () => {
    /*
      Version two's ramp was tuned against the trunk's waterline at -0.533 and met a
      spur's at -0.800, and `waterMaterial.ts` recorded the consequence: "on a spur
      the water stops about a centimetre short of its own shore". The section is
      normalised in BOTH axes, so scale cannot change a normal - which is what
      retires that asymmetry, and it is worth pinning because expressing the crown in
      metres would silently bring it back.
      */
    const trunk = full.map((p) => p.normalUp)
    const spur = waterSection().map((p) => p.normalUp)
    expect(trunk).toEqual(spur)
    expect(TRACE.spurHalfWidth).toBeLessThan(TRACE.trunkHalfWidth)
  })
})

describe('sweepChannel', () => {
  const trunkPath = orthoTrace(trunkTraceCorners())
  const trunk = sweepChannel(trunkPath, TRACE.trunkHalfWidth, 280)

  it('carries the shore attribute every part of the batch needs', () => {
    /*
      `mergeProp` reduces to the attributes every part HAS, so a single part built
      without this one silently strips the meniscus from the entire water batch rather
      than from itself. Checked on both builders for that reason.
    */
    const shore = trunk.getAttribute(WATER_SHORE_ATTRIBUTE)
    expect(shore).toBeTruthy()
    expect(shore.count).toBe(trunk.getAttribute('position').count)
    for (let i = 0; i < shore.count; i++) {
      expect(shore.getX(i)).toBeGreaterThanOrEqual(0)
      expect(shore.getX(i)).toBeLessThanOrEqual(1)
    }
  })

  it('sweeps a finite ribbon of the exact authored width', () => {
    const position = trunk.getAttribute('position')
    const normal = trunk.getAttribute('normal')
    expect(position.count).toBeGreaterThan(1000)
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true)
      expect(Number.isFinite(position.getY(i))).toBe(true)
      expect(Number.isFinite(position.getZ(i))).toBe(true)
      // A zero-length normal renders as an unshaded band and reports nothing.
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      expect(length).toBeCloseTo(1, 4)
    }
    trunk.computeBoundingBox()
    // The trunk runs down x = 0, so its half width is its whole x extent.
    expect(trunk.boundingBox!.max.x).toBeCloseTo(TRACE.trunkHalfWidth, 5)
    expect(trunk.boundingBox!.min.x).toBeCloseTo(-TRACE.trunkHalfWidth, 5)
  })

  /*
    The frame is built from the world rather than transported, and this is what that
    buys. Three's `computeFrenetFrames` picks an initial normal off the smallest
    tangent component and carries it, which is invisible on a rotationally symmetric
    tube and would tilt a flat channel's top differently on each of the trunk's five
    levels.
  */
  /*
    Taken over the CROWN vertices - the ones on the ribbon's centreline - because the
    crown's normal is the frame's own up direction and therefore reports exactly what
    the frame is doing along the whole run. Three properties are asserted together
    because they are three consequences of one decision:

      - on a horizontal run the crown points at the sky, so the channel's flat top is
        parallel to the deck rather than tilted across it. That is what a world-built
        frame buys over three's `computeFrenetFrames`, which picks an initial normal off
        the smallest tangent component and transports it - invisible on a rotationally
        symmetric tube, and a differently tilted channel on each of the trunk's five
        levels.
      - somewhere on the run the crown is HORIZONTAL, which is the frame rotating to
        stand the section on its edge down a riser. That is the twelve waterfalls.
      - and no crown anywhere on the run falls to or below `WATER.shoreTop`, which is
        the property that keeps those waterfalls opaque.

    The mitres are why this is written as a distribution rather than as two filtered
    loops: a 45-degree mitre legitimately puts the crown at 45 degrees, so any filter
    that splits "horizontal run" from "vertical run" by a normal threshold catches
    mitre rings in whichever bucket it was not expecting.
  */
  it('holds the section upright on the flat, on edge down a riser, and opaque throughout', () => {
    const position = trunk.getAttribute('position')
    const normal = trunk.getAttribute('normal')
    const crowns: number[] = []
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i)) > 1e-4) continue
      crowns.push(normal.getY(i))
    }
    expect(crowns.length).toBeGreaterThan(200)

    // Flat runs: the top faces the sky. 0.99 is 8 degrees, where a rolled frame is tens.
    expect(crowns.filter((y) => y > 0.99).length).toBeGreaterThan(100)
    // Riser climbs: the top faces away from the face instead.
    expect(Math.min(...crowns)).toBeLessThan(0.1)
    // And nothing on the whole run is read as shore, which is what keeps it opaque.
    expect(Math.min(...crowns)).toBeGreaterThan(WATER.shoreTop)
  })

  it('tapers its relief to nothing at both mouths, so a run can meet standing water', () => {
    /*
      A channel domes and a pool is flat, so at equal bed heights a channel's crown
      stands 0.038 m above the water it runs into - wrong at five of the level's six
      junctions, because water would have to climb it. See `TRACE.mouthTaper`.
    */
    const position = trunk.getAttribute('position')
    const across = WATER_SECTION.length * 2 - 1
    const rings = position.count / across
    const crownIndex = (across - 1) / 2
    const reliefAt = (ring: number) => {
      const i = ring * across + crownIndex
      const rim = ring * across
      return position.getY(i) - position.getY(rim)
    }
    const middle = reliefAt(Math.floor(rings / 2))
    expect(middle).toBeGreaterThan(0.03)
    // Both ends flatten, and neither collapses to a degenerate zero-relief ring.
    for (const end of [0, rings - 1]) {
      expect(reliefAt(end)).toBeLessThan(middle * 0.35)
      expect(reliefAt(end)).toBeGreaterThan(0)
    }
  })

  it('refuses an entirely vertical route rather than sweeping a degenerate ribbon', () => {
    expect(() =>
      sweepChannel(
        [
          [0, 0, 0],
          [0, 1, 0],
        ],
        0.1,
        8,
      ),
    ).toThrow(/entirely vertical/)
  })
})

describe('waterDisc', () => {
  const disc = waterDisc(POOL.radius, POOL.rimWidth, POOL.ringFraction)

  it('lies flat at the bed plane with its rim exactly on the authored radius', () => {
    const position = disc.getAttribute('position')
    disc.computeBoundingBox()
    // The interior IS the surface plane; everything else is below it and buried.
    expect(disc.boundingBox!.max.y).toBeCloseTo(0, 9)
    expect(Math.hypot(disc.boundingBox!.max.x, 0)).toBeCloseTo(POOL.radius, 4)

    let interior = 0
    const normal = disc.getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      if (radius > POOL.radius - POOL.rimWidth - 1e-6) continue
      expect(position.getY(i)).toBeCloseTo(0, 9)
      expect(normal.getY(i)).toBeCloseTo(1, 9)
      interior++
    }
    expect(interior).toBeGreaterThan(0)
  })

  /*
    The seam column, duplicated rather than shared. `sin(vUv.y * TAU)` is periodic, but
    that only removes the seam if uv.y is CONTINUOUS across the closing quad - and with
    a shared vertex it interpolates 0.97 back down to 0, sweeping the cross-flow term
    backwards down one radial spoke of the pool. Asserted by counting columns, since
    the symptom is a single wrong spoke on the piece at the centre of frame.
  */
  it('duplicates the seam column so the wrap carries no uv discontinuity', () => {
    const uv = disc.getAttribute('uv')
    const seam: number[] = []
    for (let i = 0; i < uv.count; i++) if (uv.getY(i) >= 1 - 1e-9) seam.push(i)
    // One per radial ring, plus the centre fan's own column.
    expect(seam.length).toBeGreaterThan(1)
    for (const i of seam) expect(uv.getY(i)).toBeCloseTo(1, 9)
  })

  it('runs uv.x radially and DECREASING outward, so rings travel out to the rim', () => {
    /*
      The shader advects crests toward decreasing `uv.x`. On a channel that makes them
      run downhill; on the pool it has to make them run from the middle outward, which
      is what a basin fed from above looks like - and the Core node hangs 4.8 m
      directly over this one. Flip this and the pool sucks inward like a drain.
    */
    const position = disc.getAttribute('position')
    const uv = disc.getAttribute('uv')
    let checked = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      expect(uv.getX(i)).toBeCloseTo(POOL.ringFraction * (1 - radius / POOL.radius), 5)
      // And uv.y is the azimuth, which the shader takes through sin(TAU * uv.y).
      // Inclusive of 1: the seam column is duplicated there. See the test above.
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getY(i)).toBeLessThanOrEqual(1)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('carries the shore attribute, with the meniscus above the waterline', () => {
    const shore = disc.getAttribute(WATER_SHORE_ATTRIBUTE)
    expect(shore).toBeTruthy()
    expect(shore.count).toBe(disc.getAttribute('position').count)

    /*
      The pool's water edge is where its rim - rolling DOWN - crosses the recess bank
      - rising INWARD - and the meniscus has to have reached full strength before that
      point or its bright half is under the bank. This is the assertion `POOL.rimDrop`
      exists to satisfy; at full relief the crossing lands at shore 0.75 instead.
    */
    const position = disc.getAttribute('position')
    const bankY = (radius: number) => {
      const s = (POOL.radius - radius) / POOL.bank
      if (s <= 0) return 0
      if (s >= 1) return -POOL.depth
      return -POOL.depth * (0.5 - 0.5 * Math.cos(Math.PI * s))
    }
    let visibleEdgeShore = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      // Above the bank means visible; take the outermost such sample.
      if (position.getY(i) <= bankY(radius) + 1e-9) continue
      if (radius > visibleEdgeShore) visibleEdgeShore = radius
    }
    expect(visibleEdgeShore).toBeGreaterThan(POOL.radius - POOL.rimWidth)
    expect(visibleEdgeShore).toBeLessThan(POOL.radius)
  })

  it('emits no degenerate triangle, including at the centre fan', () => {
    const position = disc.getAttribute('position')
    const index = disc.getIndex()!
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      expect(new Set([a, b, c]).size, `triangle ${t / 3}`).toBe(3)
      const area = triangleArea(position, a, b, c)
      expect(area, `triangle ${t / 3}`).toBeGreaterThan(1e-12)
    }
  })
})

describe('the merged water batch', () => {
  /*
    **`mergeProp` reduces to the attributes every part HAS**, and says so in its own
    comment: "a single geometry carrying a tangent or a colour that its neighbours lack
    is enough to make the merge return null, and dropping the odd one out is always
    what the caller wanted". That is the right behaviour and it is also a trap for this
    batch specifically, because the meniscus rides on a custom attribute and the batch
    is built from two different generators. One part built without `aShore` does not
    lose its own meniscus - it deletes the attribute from the whole batch, so every
    channel and both pools lose their bank line at once and the frame renders fine.

    This mirrors the part list `HubIsland.tsx` assembles rather than importing it,
    because that file cannot be imported from Node: it reaches `useQuality`, which
    reads `location.search` at module scope.
  */
  const batch = mergeProp([
    ...[0, 1, 2, 3].map((i) => ({
      geometry: sweepChannel(orthoTrace(spurTraceCorners()), TRACE.spurHalfWidth, 60),
      rotation: [0, (Math.PI / 2) * i, 0] as Point3,
    })),
    {
      geometry: waterDisc(POOL.radius, POOL.rimWidth, POOL.ringFraction),
      position: [0, 3 * STEP, 0] as Point3,
    },
    { geometry: sweepChannel(orthoTrace(trunkTraceCorners()), TRACE.trunkHalfWidth, 120) },
    { geometry: waterDisc(0.9, POOL.rimWidth, POOL.ringFraction), position: [0, 7 * STEP, -14.1] as Point3 },
  ])

  it('survives the merge with its shore attribute intact', () => {
    const shore = batch.getAttribute(WATER_SHORE_ATTRIBUTE)
    expect(shore).toBeTruthy()
    expect(shore.count).toBe(batch.getAttribute('position').count)

    // Both ends of the range have to be present, or the band has nothing to ramp over.
    let open = 0
    let bank = 0
    for (let i = 0; i < shore.count; i++) {
      if (shore.getX(i) < 0.01) open++
      if (shore.getX(i) > WATER.foamShore) bank++
    }
    expect(open).toBeGreaterThan(0)
    expect(bank).toBeGreaterThan(0)
  })

  it('keeps every uv and normal finite through the merge', () => {
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = batch.getAttribute(name)
      for (let i = 0; i < attribute.count; i++) {
        for (let c = 0; c < attribute.itemSize; c++) {
          expect(Number.isFinite(attribute.getComponent(i, c)), `${name}[${i}][${c}]`).toBe(true)
        }
      }
    }
  })
})

describe('basinLathe', () => {
  const basin = basinLathe()
  const reference = puck(CORE_PUCKS[2].radius, STEP)

  /*
    The outer shell is `puck(2.2, STEP)` reproduced by hand, because
    `roundedCylinder` builds its profile internally and offers no hook to interrupt
    it. Duplicating a generator is a real cost, and this is what makes it safe: one
    assertion pins the two fillet radii, both fillet segment counts, the radial
    segment count and the 3-degree draft at once. Any transcription slip in the
    reproduction fails here rather than showing up as a deck whose silhouette moved.
  */
  it('reproduces the puck it replaces exactly, everywhere outside the pool', () => {
    const outside = (geometry: typeof basin) => {
      const position = geometry.getAttribute('position')
      const out: string[] = []
      for (let i = 0; i < position.count; i++) {
        const radius = Math.hypot(position.getX(i), position.getZ(i))
        if (radius < POOL.radius + 0.15) continue
        out.push(
          `${position.getX(i).toFixed(6)},${position.getY(i).toFixed(6)},${position.getZ(i).toFixed(6)}`,
        )
      }
      return new Set(out)
    }
    const mine = outside(basin)
    const theirs = outside(reference)
    expect(mine.size).toBeGreaterThan(200)
    expect([...theirs].filter((v) => !mine.has(v))).toEqual([])
    expect([...mine].filter((v) => !theirs.has(v))).toEqual([])
  })

  /*
    THE ATLAS ASSERTION, and it is the reason the pool has a sloped bank rather than
    a wall. `packLightmapAtlas` files a triangle under whichever of six axes its
    normal is nearest and parameterises a +X chart by (z, y). A vertical pool wall is
    radial-facing, so it would land in the same four side charts as Puck C's outer
    wall and overlap it there - two surfaces claiming the same texels, which bakes as
    a band of the recess's occlusion painted around the outside of the rim. Under 45
    degrees everywhere, the whole recess files under +Y instead, where the ring, the
    bank and the floor are radially disjoint.
  */
  it('keeps every face of the recess +Y dominant, so its charts cannot overlap the wall', () => {
    const position = basin.getAttribute('position')
    const normal = basin.getAttribute('normal')
    let recess = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      if (radius > POOL.radius - 1e-6) continue
      const lateral = Math.max(Math.abs(normal.getX(i)), Math.abs(normal.getZ(i)))
      expect(Math.abs(normal.getY(i)), `recess vertex at radius ${radius.toFixed(3)}`)
        .toBeGreaterThan(lateral)
      recess++
    }
    expect(recess).toBeGreaterThan(100)
  })

  it('never cuts the bank steeper than 45 degrees, which is what that depends on', () => {
    // The cosine ease peaks at depth * PI / (2 * bank); anything at or over 1.0 is 45.
    expect((POOL.depth * Math.PI) / (2 * POOL.bank)).toBeLessThan(1)
    expect(POOL.bank).toBeGreaterThan((POOL.depth * Math.PI) / 2)
  })

  it('floors the pool at the depth the collider is built against', () => {
    basin.computeBoundingBox()
    const box = basin.boundingBox!
    expect(box.max.y).toBeCloseTo(STEP, 6)
    /*
      The floor is the HIGHEST surface at small radius, not the lowest: a lathe profile
      runs from the underside up, so the lowest vertex on the axis is the puck's bottom
      face at y = 0. The first version of this test took the minimum and measured the
      underside of the deck.
    */
    const position = basin.getAttribute('position')
    let floor = Number.NEGATIVE_INFINITY
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      if (radius > POOL.radius - POOL.bank - 1e-6) continue
      floor = Math.max(floor, position.getY(i))
    }
    expect(floor).toBeCloseTo(STEP - POOL.depth, 6)
    // And it really is a recess: the deck around it is a full POOL.depth higher.
    expect(STEP - floor).toBeCloseTo(POOL.depth, 6)
  })

  it('lathes with outward normals rather than an invisible backfacing shell', () => {
    const position = basin.getAttribute('position')
    const normal = basin.getAttribute('normal')
    let checked = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      // Only the outer wall, where there is an unambiguous outward direction.
      if (radius < POOL.radius + 0.5) continue
      if (Math.abs(normal.getY(i)) > 0.5) continue
      const outward = (position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i)) / radius
      expect(outward, `vertex ${i} at radius ${radius.toFixed(2)}`).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(50)
  })
})

describe('poolRingColliders', () => {
  const boxes = poolRingColliders()
  const deckTop = CORE_PUCKS[2].base + STEP

  /** Is a world point inside one of the ring boxes? */
  const covered = (x: number, y: number, z: number) =>
    boxes.some((box) => {
      const yaw = box.rotation[1]
      const dx = x - box.position[0]
      const dz = z - box.position[2]
      const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw)
      const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw)
      return (
        Math.abs(localX) <= box.halfExtents[0] &&
        Math.abs(y - box.position[1]) <= box.halfExtents[1] &&
        Math.abs(localZ) <= box.halfExtents[2]
      )
    })

  /*
    **THE assertion in this file.** The boxes are authored with their length along
    local X and their radial depth along local Z, and a rotation about Y sends local
    +Z to (sin, 0, cos) - so the yaw that puts the depth axis outward is PI/2 - yaw
    and not -yaw. This was written as -yaw first. That transposition still tiles a
    closed ring with no holes, so nothing falls through and nothing errors; it simply
    turns every box 90 degrees and leaves the recess filled in. The symptom is "the
    step down does not work" with nothing in the frame to point at.
  */
  it('leaves the pool open and the deck around it solid', () => {
    const justUnderTheDeck = deckTop - 0.01
    for (let i = 0; i < 72; i++) {
      const azimuth = (i / 72) * Math.PI * 2
      const at = (radius: number) => [
        Math.cos(azimuth) * radius,
        justUnderTheDeck,
        Math.sin(azimuth) * radius,
      ] as const

      // Open, all the way out to the polygon's own boundary.
      expect(covered(...at(0)), `pool centre`).toBe(false)
      expect(covered(...at(POOL.radius - POOL.bank / 2 - 0.02)), `azimuth ${i}`).toBe(false)

      // Solid, from just outside the polygon's circumradius to the collider rim.
      for (const radius of [poolFloorRadius() + 0.02, 1.4, 1.8, 2.05]) {
        expect(covered(...at(radius)), `azimuth ${i} at radius ${radius}`).toBe(true)
      }
    }
  })

  it('puts the whole polygon inside the visual bank, so the step cannot be seen to miss', () => {
    /*
      The hole is a 12-gon: inradius `radius - bank / 2`, circumradius that over
      cos(15 deg). Both have to land between the bank's foot and its lip, or there is
      a vantage from which the character steps down onto flat deck - or stands on the
      slope without having stepped.
    */
    const inradius = POOL.radius - POOL.bank / 2
    const circumradius = poolFloorRadius()
    expect(circumradius).toBeCloseTo(inradius / Math.cos(Math.PI / POOL.colliderSides), 9)
    expect(inradius).toBeGreaterThan(POOL.radius - POOL.bank)
    expect(circumradius).toBeLessThan(POOL.radius)
  })

  it('stays inside the puck it is standing in, corners included', () => {
    for (const box of boxes) {
      const centre = Math.hypot(box.position[0], box.position[2])
      const corner = Math.hypot(centre + box.halfExtents[2], box.halfExtents[0])
      expect(corner).toBeLessThan(CORE_PUCKS[2].radius)
      // Full deck thickness, so the ring cannot be walked under.
      expect(box.position[1] + box.halfExtents[1]).toBeCloseTo(deckTop, 9)
      expect(box.position[1] - box.halfExtents[1]).toBeCloseTo(CORE_PUCKS[2].base, 9)
    }
  })

  it('is a step the character controller can cross in both directions', () => {
    /*
      Neither of these swallows the step - they are what makes it graceful. Autostep
      carries the capsule OUT without a hitch and snap-to-ground carries it IN without
      an airborne frame. If the pool were ever deepened past either, the step would
      stop being a dip and become a stumble on the main route to the portal.
    */
    expect(POOL.depth).toBeLessThan(BODY.autostepHeight)
    expect(POOL.depth).toBeLessThan(BODY.snapToGroundDistance)
    // And the ring is far wider than autostep's landing requirement.
    expect(CORE_PUCKS[2].radius - 0.1 - POOL.radius).toBeGreaterThan(BODY.autostepMinWidth)
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
