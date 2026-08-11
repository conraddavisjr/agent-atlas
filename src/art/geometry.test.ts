import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, BufferGeometry, PlaneGeometry, Vector2, Vector3 } from 'three'
import {
  CHART_FACE_NAMES,
  applyLightmapUV,
  beveledExtrude,
  boxProjectUV,
  chartLocal,
  chartLocalToTexel,
  chamferedBox,
  counterClockwise,
  fin,
  insetConvex,
  kerb,
  latheProfile,
  lightmapAtlasHash,
  mergeProp,
  minimumEdgeDistance,
  nodeCore,
  nodeShell,
  pad,
  paintByFacing,
  paintByHeight,
  packLightmapAtlas,
  pill,
  propPartVertexCounts,
  puck,
  roundedCylinder,
  roundedOutline,
  shard,
  signedArea,
  slab,
  trace,
  texelToChartLocal,
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

describe('paintByHeight', () => {
  /** A 2 m tall box centred on the origin, so its vertices sit at y = +/-1. */
  const tall = () => new BoxGeometry(1, 2, 1)

  it('paints each vertex from its own height', () => {
    const geometry = paintByHeight(tall(), [
      { y: 1, colour: '#ffffff' },
      { y: -1, colour: '#000000' },
    ])
    const position = geometry.getAttribute('position')
    const colors = geometry.getAttribute('color')
    expect(colors.count).toBe(position.count)

    for (let i = 0; i < position.count; i++) {
      expect(colors.getX(i)).toBeCloseTo(position.getY(i) > 0 ? 1 : 0, 5)
    }
  })

  it('interpolates between the two rungs a vertex falls between', () => {
    /*
      A unit plane in the XY plane, so its vertices sit at y = +/-0.5. Against a
      ramp from y = 1 to y = 0 the top row is halfway down it, and halfway from
      white to black in the LINEAR working space is 0.5 - not the 0.7354 an sRGB
      midpoint would give. Getting that backwards is how a gradient comes out
      washed at one end, and it is why the interpolation happens on `Color`
      components rather than on the hex strings.
    */
    const geometry = paintByHeight(new PlaneGeometry(1, 1), [
      { y: 1, colour: '#ffffff' },
      { y: 0, colour: '#000000' },
    ])
    const position = geometry.getAttribute('position')
    const colors = geometry.getAttribute('color')
    for (let i = 0; i < position.count; i++) {
      // y = +0.5 is mid-ramp; y = -0.5 is below its bottom rung and clamps.
      expect(colors.getX(i)).toBeCloseTo(position.getY(i) > 0 ? 0.5 : 0, 5)
    }
  })

  it('clamps outside the ramp rather than extrapolating past it', () => {
    /*
      The skirt's ramp stops at the profile's own top and bottom, and the lawn
      disc's edge ring sits exactly on the top rung. An extrapolating ramp would
      hand a vertex a colour nobody authored - and for a dark ramp the
      extrapolation runs negative, which three clamps silently, so the tell
      would be a black ring at one end of the island's skirt and nothing else.
    */
    const geometry = paintByHeight(new BoxGeometry(1, 2, 1), [
      { y: 0.5, colour: '#ffffff' },
      { y: -0.5, colour: '#808080' },
    ])
    const position = geometry.getAttribute('position')
    const colors = geometry.getAttribute('color')
    for (let i = 0; i < position.count; i++) {
      const expected = position.getY(i) > 0 ? 1 : 0.2158
      expect(colors.getX(i)).toBeCloseTo(expected, 3)
    }
  })

  it('refuses a ramp that does not descend', () => {
    /*
      A ramp handed over bottom-up does not throw on its own: every vertex falls
      past the first rung, so the whole mesh comes out one flat colour, which
      looks exactly like a painter that never ran. This is the same class of
      failure as the lathe's inward normals and it is checked for the same
      reason.
    */
    expect(() =>
      paintByHeight(tall(), [
        { y: -1, colour: '#000000' },
        { y: 1, colour: '#ffffff' },
      ]),
    ).toThrow(/must descend/)
    expect(() =>
      paintByHeight(tall(), [
        { y: 0, colour: '#000000' },
        { y: 0, colour: '#ffffff' },
      ]),
    ).toThrow(/must descend/)
  })

  it('needs at least two rungs, and a position attribute', () => {
    expect(() => paintByHeight(tall(), [{ y: 0, colour: '#fff' }])).toThrow(/at least two stops/)
    expect(() =>
      paintByHeight(new BufferGeometry(), [
        { y: 1, colour: '#fff' },
        { y: -1, colour: '#000' },
      ]),
    ).toThrow(/position attribute/)
  })
})

describe('boxProjectUV', () => {
  it('gives every face the same physical tile size regardless of the source UVs', () => {
    /*
      The reason merging needs this at all. A 12 m deck and a 0.7 m plinth
      carry unrelated UV conventions, so one tiled material across the merged
      batch puts the same stone at two sizes on two pieces of one structure.
      Deriving UVs from position makes the physical scale identical by
      construction.
    */
    const merged = mergeProp([
      { geometry: slab(12, 2, 4), position: [0, 0, -8.6] },
      { geometry: puck(0.7, 0.5), position: [5, 0.4, 5] },
    ])
    boxProjectUV(merged, 2)

    const positions = merged.getAttribute('position')
    const normals = merged.getAttribute('normal')
    const uv = merged.getAttribute('uv')
    expect(uv.count).toBe(positions.count)

    // On any up-facing vertex the UV must be world XZ over the tile size.
    for (let i = 0; i < positions.count; i++) {
      if (normals.getY(i) < 0.99) continue
      expect(uv.getX(i)).toBeCloseTo(positions.getX(i) / 2, 5)
      expect(uv.getY(i)).toBeCloseTo(positions.getZ(i) / 2, 5)
    }
  })

  it('projects side faces down their own axis pair', () => {
    const geometry = boxProjectUV(slab(4, 2, 4, 0.1), 1)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')

    for (let i = 0; i < positions.count; i++) {
      // A face pointing along +X takes ZY, so V tracks height rather than depth.
      if (normals.getX(i) < 0.99) continue
      expect(uv.getX(i)).toBeCloseTo(positions.getZ(i), 5)
      expect(uv.getY(i)).toBeCloseTo(positions.getY(i), 5)
    }
  })

  it('needs normals', () => {
    expect(() => boxProjectUV(new BufferGeometry(), 1)).toThrow(/normal attribute/)
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

describe('the lightmap atlas', () => {
  /** Two axis-aligned boxes, merged, plus the part counts the packer needs. */
  function twoBoxes() {
    const parts = [
      { geometry: chamferedBox({ width: 2, height: 1, depth: 2, bevel: 0.1 }), position: [0, 0, 0] as [number, number, number] },
      { geometry: chamferedBox({ width: 1, height: 1, depth: 1, bevel: 0.1 }), position: [5, 0, 0] as [number, number, number] },
    ]
    const counts = propPartVertexCounts(parts)
    const geometry = mergeProp(parts)
    return { parts, counts, meshes: [{ geometry, partVertexCounts: counts }] }
  }

  it('reports each part’s post-merge vertex count, summing to the merge', () => {
    const { counts, meshes } = twoBoxes()
    expect(counts).toHaveLength(2)
    expect(counts[0] + counts[1]).toBe(meshes[0].geometry.getAttribute('position').count)
  })

  it('rejects an indexed geometry rather than painting stripes on it', () => {
    const geometry = new BoxGeometry(1, 1, 1)
    expect(() =>
      packLightmapAtlas([{ geometry, partVertexCounts: [geometry.getIndex()!.count] }], {
        size: 64,
        texelsPerMetre: 8,
      }),
    ).toThrow(/indexed/)
  })

  it('rejects part counts that do not sum to the geometry', () => {
    const { meshes } = twoBoxes()
    expect(() =>
      packLightmapAtlas([{ geometry: meshes[0].geometry, partVertexCounts: [3] }], {
        size: 256,
        texelsPerMetre: 8,
      }),
    ).toThrow(/part counts sum to/)
  })

  /*
    The single most important property of the packer, and the one a bug in it breaks
    silently. Two charts sharing texels means one surface renders with another's
    occlusion, and the image still looks like a plausible lightmap. It was checked by
    hand on the real hub geometry once, at 204 charts, and this is that check kept.
  */
  it('never overlaps two charts', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    expect(atlas.charts.length).toBeGreaterThan(6)
    for (let i = 0; i < atlas.charts.length; i++) {
      for (let j = i + 1; j < atlas.charts.length; j++) {
        const a = atlas.charts[i]
        const b = atlas.charts[j]
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps, `${a.part}/${a.face} overlaps ${b.part}/${b.face}`).toBe(false)
      }
    }
  })

  it('keeps every chart inside the atlas', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    for (const c of atlas.charts) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(atlas.size)
      expect(c.y + c.h).toBeLessThanOrEqual(atlas.size)
    }
  })

  it('gives a box exactly six charts per part, one per face direction', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    for (const part of [0, 1]) {
      const faces = atlas.charts.filter((c) => c.part === part).map((c) => c.face).sort()
      expect(faces).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('assigns every triangle to exactly one chart', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    const seen = new Set<number>()
    let total = 0
    for (const c of atlas.charts) {
      for (const t of c.triangles) {
        expect(seen.has(t), `triangle ${t} is in two charts`).toBe(false)
        seen.add(t)
        total++
      }
    }
    expect(total).toBe(meshes[0].geometry.getAttribute('position').count / 3)
  })

  it('is deterministic, which is what lets the bake and the runtime agree', () => {
    const a = packLightmapAtlas(twoBoxes().meshes, { size: 512, texelsPerMetre: 40 })
    const b = packLightmapAtlas(twoBoxes().meshes, { size: 512, texelsPerMetre: 40 })
    expect(lightmapAtlasHash(a)).toBe(lightmapAtlasHash(b))
    expect(a.charts.map((c) => [c.part, c.face, c.x, c.y])).toEqual(
      b.charts.map((c) => [c.part, c.face, c.x, c.y]),
    )
  })

  it('changes its hash when the geometry moves, which is the staleness detector', () => {
    const base = lightmapAtlasHash(packLightmapAtlas(twoBoxes().meshes, { size: 512, texelsPerMetre: 40 }))

    const moved = twoBoxes()
    moved.parts[1].position = [5.5, 0, 0]
    const shifted = mergeProp(moved.parts)
    const after = lightmapAtlasHash(
      packLightmapAtlas([{ geometry: shifted, partVertexCounts: moved.counts }], {
        size: 512,
        texelsPerMetre: 40,
      }),
    )
    expect(after).not.toBe(base)
  })

  it('changes its hash when the atlas options change', () => {
    const a = lightmapAtlasHash(packLightmapAtlas(twoBoxes().meshes, { size: 512, texelsPerMetre: 40 }))
    const b = lightmapAtlasHash(packLightmapAtlas(twoBoxes().meshes, { size: 512, texelsPerMetre: 41 }))
    expect(a).not.toBe(b)
  })

  it('throws rather than silently dropping charts when the atlas is too small', () => {
    expect(() => packLightmapAtlas(twoBoxes().meshes, { size: 32, texelsPerMetre: 40 })).toThrow(
      /does not fit|ran out of room/,
    )
  })

  it('writes a uv1 attribute for every vertex, in 0..1', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    applyLightmapUV(meshes, atlas)
    const uv = meshes[0].geometry.getAttribute('uv1')
    expect(uv).toBeTruthy()
    expect(uv.count).toBe(meshes[0].geometry.getAttribute('position').count)
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getX(i)).toBeLessThanOrEqual(1)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getY(i)).toBeLessThanOrEqual(1)
    }
  })

  it('leaves uv0 alone, so the tiling detail maps still work', () => {
    const { meshes } = twoBoxes()
    boxProjectUV(meshes[0].geometry, 2)
    const before = Array.from((meshes[0].geometry.getAttribute('uv') as { array: ArrayLike<number> }).array)
    applyLightmapUV(meshes, packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 }))
    const after = Array.from((meshes[0].geometry.getAttribute('uv') as { array: ArrayLike<number> }).array)
    expect(after).toEqual(before)
  })

  /*
    **The V flip, pinned with an explicit expected value.** three loads an image with
    `flipY = true`, so image row 0 lands at v = 1 and `applyLightmapUV` inverts V on
    the way out. A lightmap that is vertically mirrored is the most convincing wrong
    result available - still soft, still in plausible places, and only obviously
    broken on asymmetric parts - so it gets a test that would fail on a sign flip
    rather than a property that a mirror would still satisfy.
  */
  it('puts atlas row 0 at v = 1, matching three’s default flipY', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    applyLightmapUV(meshes, atlas)

    const chart = atlas.charts.find((c) => c.part === 0 && c.face === 2)!
    const position = meshes[0].geometry.getAttribute('position')
    const uv = meshes[0].geometry.getAttribute('uv1')

    // The vertex of this chart with the smallest V in chart space must carry the
    // LARGEST uv1.y, because chart V grows downward through the image.
    let lowest = Infinity
    let lowestUv = 0
    let highest = -Infinity
    let highestUv = 0
    for (const t of chart.triangles) {
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k
        const v = chartLocal(position, i, chart.face).v
        if (v < lowest) {
          lowest = v
          lowestUv = uv.getY(i)
        }
        if (v > highest) {
          highest = v
          highestUv = uv.getY(i)
        }
      }
    }
    expect(highest).toBeGreaterThan(lowest)
    expect(lowestUv).toBeGreaterThan(highestUv)

    // And the exact value, from the mapping, so a gutter change cannot pass.
    const expected = 1 - (chart.y + atlas.gutter) / atlas.size
    expect(lowestUv).toBeCloseTo(expected, 6)
  })

  it('round trips a point through the texel mapping', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    const chart = atlas.charts[0]
    const u = chart.minU + chart.spanU * 0.37
    const v = chart.minV + chart.spanV * 0.61
    const { col, row } = chartLocalToTexel(atlas, chart, u, v)
    const back = texelToChartLocal(atlas, chart, col, row)
    expect(back.u).toBeCloseTo(u, 9)
    expect(back.v).toBeCloseTo(v, 9)
  })

  it('rejects an atlas that does not describe the geometry it is applied to', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    const other = twoBoxes()
    // One extra vertex is enough: the charts cannot claim it, and an unclaimed
    // vertex samples texel (0, 0) forever if it is allowed through.
    const truncated = { ...atlas, charts: atlas.charts.slice(0, 3) }
    expect(() => applyLightmapUV(other.meshes, truncated)).toThrow(/without a uv1/)
  })

  it('rejects a chart naming a mesh that was not passed in', () => {
    const { meshes } = twoBoxes()
    const atlas = packLightmapAtlas(meshes, { size: 512, texelsPerMetre: 40 })
    const wrong = { ...atlas, charts: atlas.charts.map((c) => ({ ...c, mesh: 7 })) }
    expect(() => applyLightmapUV(meshes, wrong)).toThrow(/references mesh 7/)
  })

  it('packs two meshes into one atlas', () => {
    const a = twoBoxes()
    const b = twoBoxes()
    const atlas = packLightmapAtlas([a.meshes[0], b.meshes[0]], { size: 1024, texelsPerMetre: 40 })
    expect(new Set(atlas.charts.map((c) => c.mesh))).toEqual(new Set([0, 1]))
    applyLightmapUV([a.meshes[0], b.meshes[0]], atlas)
    expect(a.meshes[0].geometry.getAttribute('uv1')).toBeTruthy()
    expect(b.meshes[0].geometry.getAttribute('uv1')).toBeTruthy()
  })

  it('names the six chart directions in the order it numbers them', () => {
    expect(CHART_FACE_NAMES).toEqual(['+X', '-X', '+Y', '-Y', '+Z', '-Z'])
    const position = new BufferAttribute(new Float32Array([1, 2, 3]), 3)
    // +Y takes (x, z); +X takes (z, y); +Z takes (x, y).
    expect(chartLocal(position, 0, 2)).toEqual({ u: 1, v: 3 })
    expect(chartLocal(position, 0, 0)).toEqual({ u: 3, v: 2 })
    expect(chartLocal(position, 0, 4)).toEqual({ u: 1, v: 2 })
    expect(() => chartLocal(position, 0, 6)).toThrow(/not 0..5/)
  })
})
