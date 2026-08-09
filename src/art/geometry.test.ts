import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferGeometry, Vector2, Vector3 } from 'three'
import {
  beveledExtrude,
  chamferedBox,
  counterClockwise,
  fin,
  insetConvex,
  kerb,
  latheProfile,
  mergeProp,
  minimumEdgeDistance,
  nodeCore,
  nodeShell,
  pad,
  paintByFacing,
  pill,
  puck,
  roundedCylinder,
  roundedOutline,
  shard,
  signedArea,
  slab,
  trace,
  tubeFromCurve,
  wedge,
} from './geometry'

/*
  These tests exist because every failure mode in this file is silent.

  A lathe with two coincident profile points renders perfectly and shades
  wrongly. A bevel wider than the shape it is applied to produces a buffer full
  of NaN, which WebGL uploads without complaint and which then draws nothing. A
  merge whose inputs disagree returns null, and a null geometry on a mesh is an
  object that is simply absent from the frame. None of those throw, none of them
  log, and all of them are cheap to catch here.
*/

/** Every finite-value check in the file goes through this. */
function expectFinite(geometry: BufferGeometry, label: string) {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name)
    const array = attribute.array as ArrayLike<number>
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i])) {
        throw new Error(`${label}: attribute "${name}" index ${i} is ${array[i]}`)
      }
    }
  }
}

/**
 * Every normal must be unit length.
 *
 * A zero-length normal is the specific thing `latheProfile` guards against and
 * the specific thing a degenerate triangle produces, and it is invisible in a
 * screenshot until the surface it belongs to ends up in shadow.
 */
function expectUnitNormals(geometry: BufferGeometry, label: string) {
  const normals = geometry.getAttribute('normal')
  expect(normals, `${label}: has normals`).toBeTruthy()
  let worst = 0
  for (let i = 0; i < normals.count; i++) {
    const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))
    worst = Math.max(worst, Math.abs(length - 1))
  }
  expect(worst, `${label}: worst normal length error`).toBeLessThan(1e-3)
}

function bounds(geometry: BufferGeometry) {
  geometry.computeBoundingBox()
  return geometry.boundingBox!
}

describe('latheProfile', () => {
  it('revolves a profile into the counts three documents', () => {
    const points = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 2), new Vector2(0, 2)]
    const geometry = latheProfile({ points, radialSegments: 16 })

    // (segments + 1) rings of one vertex per profile point, and one quad per
    // (segment, profile edge) pair.
    expect(geometry.getAttribute('position').count).toBe(17 * 4)
    expect(geometry.index!.count).toBe(16 * 3 * 6)
    expectFinite(geometry, 'latheProfile')
    expectUnitNormals(geometry, 'latheProfile')
  })

  it('rejects the inputs that would shade wrongly rather than throw', () => {
    expect(() => latheProfile({ points: [new Vector2(1, 0)] })).toThrow(/at least 2 points/)
    expect(() => latheProfile({ points: [new Vector2(-1, 0), new Vector2(1, 1)] })).toThrow(/negative radius/)
    expect(() => latheProfile({ points: [new Vector2(1, 0), new Vector2(1, 0)] })).toThrow(/coincident/)
    expect(() => latheProfile({ points: [new Vector2(NaN, 0), new Vector2(1, 1)] })).toThrow(/not finite/)
  })
})

describe('roundedCylinder', () => {
  it('produces the profile point count the fillets imply', () => {
    const geometry = roundedCylinder({
      radius: 1,
      height: 0.4,
      topFillet: 0.1,
      bottomFillet: 0.05,
      radialSegments: 24,
      filletSegments: 4,
    })

    // Two axis points plus two arcs of (filletSegments + 1) samples.
    const profilePoints = 2 + 2 * 5
    expect(geometry.getAttribute('position').count).toBe(25 * profilePoints)
    expect(geometry.index!.count).toBe(24 * (profilePoints - 1) * 6)
  })

  it('collapses an arc to a single point when its fillet is zero', () => {
    const geometry = roundedCylinder({
      radius: 1,
      height: 1,
      topFillet: 0,
      bottomFillet: 0,
      radialSegments: 8,
      filletSegments: 4,
    })
    expect(geometry.getAttribute('position').count).toBe(9 * 4)
  })

  it('stands on its base plane and never exceeds its stated radius', () => {
    const box = bounds(roundedCylinder({ radius: 2.2, height: 0.4, topFillet: 0.1 }))
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.4, 6)
    // A 32-gon inscribed in the radius, so the corners land marginally inside.
    expect(box.max.x).toBeGreaterThan(2.2 * 0.99)
    // Float32 storage, so the bound is the radius plus a rounding step.
    expect(box.max.x).toBeLessThanOrEqual(2.2 + 1e-5)
  })

  it('leans the side in when asked for draft, and never past the axis', () => {
    const drafted = roundedCylinder({
      radius: 1,
      height: 2,
      topFillet: 0,
      bottomFillet: 0,
      draftDegrees: 3,
      radialSegments: 4,
      filletSegments: 1,
    })
    const positions = drafted.getAttribute('position')

    let topMax = 0
    let bottomMax = 0
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getZ(i))
      if (positions.getY(i) > 1.99) topMax = Math.max(topMax, radius)
      if (positions.getY(i) < 0.01) bottomMax = Math.max(bottomMax, radius)
    }
    expect(bottomMax).toBeCloseTo(1, 6)
    // 2 m of height at 3 degrees removes 2 * tan(3) = 0.1048 of radius.
    expect(topMax).toBeCloseTo(1 - 2 * Math.tan((3 * Math.PI) / 180), 4)

    // An absurd draft must taper rather than invert. The 0.9 clamp is what stops
    // the profile folding through the axis and turning the puck inside out.
    const extreme = roundedCylinder({ radius: 0.2, height: 8, draftDegrees: 45, radialSegments: 4 })
    expect(bounds(extreme).min.x).toBeLessThan(0)
    expectFinite(extreme, 'roundedCylinder extreme draft')
  })

  it('clamps a fillet larger than the piece instead of inverting it', () => {
    const lens = roundedCylinder({ radius: 0.5, height: 0.2, topFillet: 5, bottomFillet: 5 })
    expectFinite(lens, 'roundedCylinder oversized fillet')
    expectUnitNormals(lens, 'roundedCylinder oversized fillet')
    const box = bounds(lens)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(0.2, 6)
  })

  it('refuses non-positive dimensions', () => {
    expect(() => roundedCylinder({ radius: 0, height: 1 })).toThrow(/positive radius and height/)
    expect(() => roundedCylinder({ radius: 1, height: -1 })).toThrow(/positive radius and height/)
  })
})

describe('chamferedBox', () => {
  it('has exactly the outer dimensions it was asked for', () => {
    const geometry = chamferedBox({ width: 12, height: 2, depth: 4, bevel: 0.12 })
    const box = bounds(geometry)

    expect(box.max.x - box.min.x).toBeCloseTo(12, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(2, 3)
    expect(box.max.z - box.min.z).toBeCloseTo(4, 3)
    // Base plane origin: a piece placed at y sits with its bottom at y.
    expect(box.min.y).toBeCloseTo(0, 3)
    expect(box.min.x).toBeCloseTo(-6, 3)
    expect(box.min.z).toBeCloseTo(-2, 3)
  })

  it('rounds all twelve edges, not just the eight around its caps', () => {
    /*
      The assertion that separates a real fillet from what a bare
      ExtrudeGeometry bevel gives you, which is a chamfered slab whose four
      corner edges are still 90 degrees.

      Measured as the furthest any vertex gets from the centre, because that
      number is only reachable through an unrounded corner. A sharp 2 m cube
      reaches sqrt(3) = 1.7321 at all eight corners. Round every edge at 0.2 and
      the corner becomes a sphere octant centred at (0.8, 0.8, 0.8), so the
      furthest point is |(0.8, 0.8, 0.8)| + 0.2 = 1.5856. Anything at or near
      1.73 means an edge was missed.
    */
    const chamfered = chamferedBox({ width: 2, height: 2, depth: 2, bevel: 0.2 })
    const sharp = new BoxGeometry(2, 2, 2)
    sharp.translate(0, 1, 0)

    const furthest = (geometry: BufferGeometry) => {
      const positions = geometry.getAttribute('position')
      let worst = 0
      for (let i = 0; i < positions.count; i++) {
        worst = Math.max(worst, Math.hypot(positions.getX(i), positions.getY(i) - 1, positions.getZ(i)))
      }
      return worst
    }

    expect(furthest(sharp)).toBeCloseTo(Math.sqrt(3), 5)
    expect(furthest(chamfered)).toBeCloseTo(1.5856, 2)
    // And the flat faces still reach their full extent, so the fillet took the
    // corner rather than shrinking the whole block.
    expect(bounds(chamfered).max.x).toBeCloseTo(1, 3)
  })

  it('caps the bevel at a quarter of the smallest dimension', () => {
    // 0.25 * 0.4 = 0.10, so this must behave as if 0.10 had been asked for.
    const capped = chamferedBox({ width: 4, height: 0.4, depth: 4, bevel: 1.5 })
    expectFinite(capped, 'chamferedBox capped bevel')
    expectUnitNormals(capped, 'chamferedBox capped bevel')
    const box = bounds(capped)
    expect(box.max.y - box.min.y).toBeCloseTo(0.4, 3)
    expect(box.max.x - box.min.x).toBeCloseTo(4, 3)
  })

  it('refuses non-positive dimensions', () => {
    expect(() => chamferedBox({ width: 0, height: 1, depth: 1 })).toThrow(/positive dimensions/)
  })
})

describe('beveledExtrude', () => {
  it('centres its extrusion on Z and keeps the exact depth', () => {
    const geometry = beveledExtrude({
      outline: [new Vector2(-1, 0), new Vector2(1, 0), new Vector2(1, 0.8)],
      depth: 3,
      bevel: 0.06,
    })
    const box = bounds(geometry)
    expect(box.min.z).toBeCloseTo(-1.5, 3)
    expect(box.max.z).toBeCloseTo(1.5, 3)
    // The base edge's own normal is sampled exactly, so the floor is exact.
    expect(box.min.y).toBeCloseTo(0, 3)
    /*
      The apex is not, and must not be. This wedge's tip is a 68-degree corner,
      and the largest circle of radius 0.06 that fits inside it sits 0.047 back
      along the bisector, which takes about 27 mm off the height. That is the
      fillet doing its job: a mould cannot produce a sharp apex either. It is
      recorded here because a caller sizing a ramp against a deck edge will
      otherwise expect the tip to be where the outline says.
    */
    expect(box.max.y).toBeLessThan(0.8)
    expect(box.max.y).toBeGreaterThan(0.76)
    expectFinite(geometry, 'beveledExtrude wedge')
    expectUnitNormals(geometry, 'beveledExtrude wedge')
  })

  it('survives a bevel far larger than the shape', () => {
    /*
      The regression this pins down. Asking ExtrudeGeometry for a bevel wider
      than the inradius of its own shape folds the inset contour through itself
      and fills the position buffer with NaN, which uploads to the GPU without a
      single warning and renders as nothing at all.
    */
    const geometry = beveledExtrude({
      outline: [new Vector2(-0.1, 0), new Vector2(0.1, 0), new Vector2(0.1, 0.1), new Vector2(-0.1, 0.1)],
      depth: 0.2,
      bevel: 10,
    })
    expectFinite(geometry, 'beveledExtrude oversized bevel')
    expectUnitNormals(geometry, 'beveledExtrude oversized bevel')
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('is indifferent to the winding it is handed', () => {
    const outline = [new Vector2(-1, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(-1, 1)]
    const forward = bounds(beveledExtrude({ outline, depth: 1 }))
    const reversed = bounds(beveledExtrude({ outline: [...outline].reverse(), depth: 1 }))

    expect(reversed.min.toArray()).toEqual(forward.min.toArray().map((v) => expect.closeTo(v, 6)))
    expect(reversed.max.toArray()).toEqual(forward.max.toArray().map((v) => expect.closeTo(v, 6)))
  })

  it('refuses degenerate input', () => {
    expect(() => beveledExtrude({ outline: [new Vector2(0, 0), new Vector2(1, 0)], depth: 1 })).toThrow(
      /at least 3 outline points/,
    )
    expect(() =>
      beveledExtrude({ outline: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)], depth: 0 }),
    ).toThrow(/positive depth/)
  })
})

describe('tubeFromCurve', () => {
  it('produces the counts three documents', () => {
    const geometry = tubeFromCurve({
      points: [
        [0, 0, 0],
        [1, 0.4, 0],
        [2, 0.4, 1],
      ],
      radius: 0.09,
      radialSegments: 6,
      tubularSegments: 32,
    })
    expect(geometry.getAttribute('position').count).toBe(33 * 7)
    expect(geometry.index!.count).toBe(32 * 6 * 6)
    expectFinite(geometry, 'tubeFromCurve')
    expectUnitNormals(geometry, 'tubeFromCurve')
  })

  it('accepts Vector3 and tuple points interchangeably', () => {
    const tuples = tubeFromCurve({ points: [[0, 0, 0], [1, 0, 0]], tubularSegments: 4 })
    const vectors = tubeFromCurve({
      points: [new Vector3(0, 0, 0), new Vector3(1, 0, 0)],
      tubularSegments: 4,
    })
    expect(vectors.getAttribute('position').array).toEqual(tuples.getAttribute('position').array)
  })

  it('refuses a curve it cannot sweep', () => {
    expect(() => tubeFromCurve({ points: [[0, 0, 0]] })).toThrow(/at least 2 points/)
    expect(() => tubeFromCurve({ points: [[0, 0, 0], [NaN, 0, 0]] })).toThrow(/not finite/)
  })
})

describe('mergeProp', () => {
  it('sums its parts and places each one', () => {
    const merged = mergeProp([
      { geometry: new BoxGeometry(1, 1, 1), position: [-5, 0, 0] },
      { geometry: new BoxGeometry(1, 1, 1), position: [5, 0, 0] },
    ])
    const box = bounds(merged)
    expect(box.min.x).toBeCloseTo(-5.5, 6)
    expect(box.max.x).toBeCloseTo(5.5, 6)
    expect(merged.getAttribute('position').count).toBe(2 * 36)
  })

  it('reconciles indexed and non-indexed sources', () => {
    /*
      The mixed case is the whole reason this wrapper exists. Lathes, tubes and
      cylinders come back indexed; anything through beveledExtrude has been
      de-indexed by toCreasedNormals. mergeGeometries returns null on that
      mismatch, and a null geometry draws nothing while reporting nothing.
    */
    const merged = mergeProp([
      { geometry: puck(1, 0.4) },
      { geometry: slab(1, 0.4, 1), position: [3, 0, 0] },
    ])
    expect(merged.index).toBeNull()
    expectFinite(merged, 'mergeProp mixed')
    expectUnitNormals(merged, 'mergeProp mixed')
  })

  it('drops attributes the whole batch does not share', () => {
    const painted = paintByFacing(slab(1, 1, 1), { up: '#ffffff', side: '#000000' })
    const plain = slab(1, 1, 1)
    const merged = mergeProp([{ geometry: painted }, { geometry: plain, position: [2, 0, 0] }])
    expect(merged.getAttribute('color')).toBeUndefined()
    expect(merged.getAttribute('position')).toBeTruthy()
  })

  it('leaves its inputs untouched', () => {
    const source = new BoxGeometry(1, 1, 1)
    const before = Array.from(source.getAttribute('position').array)
    mergeProp([{ geometry: source, position: [10, 10, 10], scale: 3 }])
    expect(Array.from(source.getAttribute('position').array)).toEqual(before)
  })

  it('renormalises normals through a non-uniform scale', () => {
    const merged = mergeProp([{ geometry: puck(1, 0.4), scale: [3, 1, 1] }])
    expectUnitNormals(merged, 'mergeProp non-uniform scale')
  })

  it('rotates about the axes it is given', () => {
    const merged = mergeProp([{ geometry: new BoxGeometry(4, 1, 1), rotation: [0, Math.PI / 2, 0] }])
    const box = bounds(merged)
    expect(box.max.x - box.min.x).toBeCloseTo(1, 6)
    expect(box.max.z - box.min.z).toBeCloseTo(4, 6)
  })

  it('refuses an empty batch', () => {
    expect(() => mergeProp([])).toThrow(/at least one part/)
  })
})

describe('paintByFacing', () => {
  it('gives up-facing vertices the top colour and the rest the side colour', () => {
    const geometry = paintByFacing(new BoxGeometry(1, 1, 1), {
      up: '#ffffff',
      side: '#000000',
      softness: 0,
    })
    const normals = geometry.getAttribute('normal')
    const colors = geometry.getAttribute('color')
    expect(colors.count).toBe(normals.count)

    for (let i = 0; i < normals.count; i++) {
      const expected = normals.getY(i) >= 0.55 ? 1 : 0
      expect(colors.getX(i)).toBeCloseTo(expected, 5)
    }
  })

  it('writes linear values, not the sRGB bytes from the hex', () => {
    // #808080 is 0.5 in sRGB and 0.2140 in the linear working space three
    // shades in. Writing 0.5 would make every deck top visibly too bright.
    const geometry = paintByFacing(new BoxGeometry(1, 1, 1), {
      up: '#808080',
      side: '#808080',
      softness: 0,
    })
    expect(geometry.getAttribute('color').getX(0)).toBeCloseTo(0.2158, 3)
  })

  it('needs normals', () => {
    const bare = new BufferGeometry()
    expect(() => paintByFacing(bare, { up: '#fff', side: '#000' })).toThrow(/normal attribute/)
  })
})

describe('polygon helpers', () => {
  it('measures signed area with the sign of the winding', () => {
    const square = [new Vector2(0, 0), new Vector2(2, 0), new Vector2(2, 2), new Vector2(0, 2)]
    expect(signedArea(square)).toBeCloseTo(4, 9)
    expect(signedArea([...square].reverse())).toBeCloseTo(-4, 9)
  })

  it('normalises winding without mutating its input', () => {
    const clockwise = [new Vector2(0, 0), new Vector2(0, 2), new Vector2(2, 2), new Vector2(2, 0)]
    const fixed = counterClockwise(clockwise)
    expect(signedArea(fixed)).toBeGreaterThan(0)
    expect(clockwise[1].y).toBe(2)
  })

  it('bounds the inradius from the centroid', () => {
    const rect = [new Vector2(-3, -1), new Vector2(3, -1), new Vector2(3, 1), new Vector2(-3, 1)]
    expect(minimumEdgeDistance(rect)).toBeCloseTo(1, 9)
  })

  it('insets every edge by exactly the amount asked for', () => {
    const rect = [new Vector2(-3, -1), new Vector2(3, -1), new Vector2(3, 1), new Vector2(-3, 1)]
    const inset = insetConvex(counterClockwise(rect), 0.25)
    expect(Math.max(...inset.map((p) => p.x))).toBeCloseTo(2.75, 9)
    expect(Math.max(...inset.map((p) => p.y))).toBeCloseTo(0.75, 9)
    expect(Math.min(...inset.map((p) => p.x))).toBeCloseTo(-2.75, 9)
  })

  it('insets a non-right corner along its bisector', () => {
    const triangle = counterClockwise([new Vector2(0, 0), new Vector2(4, 0), new Vector2(4, 3)])
    const inset = insetConvex(triangle, 0.1)
    // Every inset vertex must be strictly inside the original triangle, which
    // for this one means above y = 0 and left of x = 4.
    for (const p of inset) {
      expect(p.y).toBeGreaterThan(0.09)
      expect(p.x).toBeLessThan(3.91)
    }
  })

  it('fans each corner into an arc and leaves straight vertices alone', () => {
    const square = counterClockwise([
      new Vector2(-1, -1),
      new Vector2(1, -1),
      new Vector2(1, 1),
      new Vector2(-1, 1),
    ])
    expect(roundedOutline(square, 3)).toHaveLength(4 * 4)

    // A collinear midpoint contributes one vertex, not a fan of coincident ones,
    // which is what would hand the triangulator degenerate triangles.
    const withMidpoint = counterClockwise([
      new Vector2(-1, -1),
      new Vector2(0, -1),
      new Vector2(1, -1),
      new Vector2(1, 1),
      new Vector2(-1, 1),
    ])
    expect(roundedOutline(withMidpoint, 3)).toHaveLength(4 * 4 + 1)
  })
})

describe('the kit', () => {
  /*
    One table over every generator. The point is not the individual assertions,
    it is that adding a generator without adding it here is conspicuous, and
    that a NaN anywhere in the kit fails one named test rather than showing up
    as an object that is mysteriously missing from a screenshot.
  */
  const pieces: Array<[string, () => BufferGeometry]> = [
    ['slab', () => slab(12, 2, 4)],
    ['slab, thin', () => slab(2, 0.4, 2)],
    ['puck', () => puck(6, 0.4)],
    ['puck, small', () => puck(0.7, 0.5, 0.06)],
    ['kerb', () => kerb(3.8)],
    ['wedge', () => wedge(3.5, 0.8, 3)],
    ['pill', () => pill(0.34, 7.8)],
    ['nodeCore', () => nodeCore(1.15)],
    ['nodeShell', () => nodeShell(1.55)],
    ['trace', () => trace([[0, 0.52, 0], [1, 0.52, -1], [2, 0.92, -2]], 0.09, 24)],
    ['pad', () => pad(0.45)],
    ['shard', () => shard(2.2)],
    ['shard, short', () => shard(0.5, 0.04, 0.14)],
    ['fin', () => fin(0.6, 1.4, 0.24)],
  ]

  it.each(pieces)('%s emits no NaN and no degenerate normal', (label, build) => {
    const geometry = build()
    expectFinite(geometry, label)
    expectUnitNormals(geometry, label)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('stands every ground-standing piece on its base plane', () => {
    const standing: Array<[string, BufferGeometry]> = [
      ['slab', slab(2, 0.8, 2)],
      ['puck', puck(1.1, 0.8)],
      ['kerb', kerb(3.8)],
      ['wedge', wedge(3.5, 0.8, 3)],
      ['pill', pill(0.34, 5.2)],
      ['pad', pad()],
      ['shard', shard(1.4)],
      ['fin', fin(0.6, 1.4, 0.24)],
    ]
    for (const [label, geometry] of standing) {
      expect(bounds(geometry).min.y, `${label} base`).toBeCloseTo(0, 3)
    }
  })

  it('centres the two pieces that hang in the air', () => {
    for (const [label, geometry, radius] of [
      ['nodeCore', nodeCore(1.15), 1.15],
      ['nodeShell', nodeShell(1.55), 1.55],
    ] as Array<[string, BufferGeometry, number]>) {
      const positions = geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const distance = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i))
        expect(distance, `${label} vertex ${i}`).toBeCloseTo(radius, 5)
      }
    }
  })

  it('gives the kerb its length along X, which is the axis the collider uses', () => {
    const box = bounds(kerb(3.8, 0.6, 0.36))
    expect(box.max.x - box.min.x).toBeCloseTo(3.8, 2)
    expect(box.max.y - box.min.y).toBeCloseTo(0.6, 2)
    /*
      Not exact, and the 7 mm shortfall is the polygonal fillet rather than a
      mistake. The kerb's drafted side leaves an 86-degree corner at the base,
      and with four samples across that sweep none of them lands on the outward
      normal, so the widest sample sits one chord inside the true arc. It stays
      inside the authored footprint, which is the direction that matters: the
      collider manifest gives this run a half-depth of 0.18 and a mesh wider
      than its collider is what catches a capsule.
    */
    const depth = box.max.z - box.min.z
    expect(depth).toBeLessThanOrEqual(0.36)
    expect(depth).toBeGreaterThan(0.35)
  })

  it('builds each Core puck to the radius and height in the layout table', () => {
    // Straight out of docs/design/03-environment.md section 1.5. If these drift
    // the colliders stop matching the geometry and the player stands in the air.
    for (const [radius, height] of [
      [6.0, 0.4],
      [4.0, 0.4],
      [2.2, 0.4],
      [1.5, 0.4],
    ]) {
      const box = bounds(puck(radius, height))
      expect(box.max.y - box.min.y).toBeCloseTo(height, 5)
      expect(box.max.x).toBeGreaterThan(radius * 0.99)
      expect(box.max.x).toBeLessThanOrEqual(radius + 1e-5)
    }
  })

  it('keeps the pill exactly as tall as its length plus both caps', () => {
    const box = bounds(pill(0.34, 7.8))
    expect(box.max.y).toBeCloseTo(7.8 + 0.68, 5)
    expect(box.max.x).toBeCloseTo(0.34, 5)
  })

  it('truncates the shard apex rather than coming to a point', () => {
    const geometry = shard(2.2, 0.05, 0.22)
    const positions = geometry.getAttribute('position')
    let apexRadius = 0
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > 2.19) {
        apexRadius = Math.max(apexRadius, Math.hypot(positions.getX(i), positions.getZ(i)))
      }
    }
    expect(apexRadius).toBeGreaterThan(0)
    expect(bounds(geometry).max.y).toBeCloseTo(2.2, 5)
  })
})
