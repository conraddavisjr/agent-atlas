import { describe, expect, it } from 'vitest'

import { buildBvh, bvhStats, occluded } from './bvh'
import type { Bvh, TriangleSoup } from './bvh'

/**
 * mulberry32, seeded, written out here rather than pulled from Math.random.
 *
 * A spatial data structure test that samples random rays is only useful if a
 * failure can be reproduced and re-run against a fix. With Math.random a
 * disagreement between the BVH and the brute-force scan shows up once, in CI,
 * on a ray nobody can recover - which is strictly worse than having no test,
 * because it trains everyone to re-run the suite until it passes.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The reference implementation: Möller-Trumbore against every triangle, no
 * acceleration, no early structure. Deliberately a separate transcription
 * rather than an import, so a sign error in bvh.ts cannot be mirrored here.
 */
function occludedByScan(
  soup: TriangleSoup,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): boolean {
  for (let s = 0; s < soup.length; s += 9) {
    const ax = soup[s]
    const ay = soup[s + 1]
    const az = soup[s + 2]
    const e1x = soup[s + 3] - ax
    const e1y = soup[s + 4] - ay
    const e1z = soup[s + 5] - az
    const e2x = soup[s + 6] - ax
    const e2y = soup[s + 7] - ay
    const e2z = soup[s + 8] - az
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (det > -1e-9 && det < 1e-9) continue
    const inv = 1 / det
    const tx = ox - ax
    const ty = oy - ay
    const tz = oz - az
    const u = (tx * px + ty * py + tz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = ty * e1z - tz * e1y
    const qy = tz * e1x - tx * e1z
    const qz = tx * e1y - ty * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < 0 || u + v > 1) continue
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (t > 1e-4 && t < maxDistance) return true
  }
  return false
}

/** A triangle in the plane z = 2, facing back towards the origin, spanning x,y in [-1, 1]. */
const FACING_TRIANGLE: TriangleSoup = new Float32Array([-1, -1, 2, 1, -1, 2, 0, 1.5, 2])

describe('a single triangle', () => {
  const bvh = buildBvh(FACING_TRIANGLE)

  it('blocks a ray aimed straight at it', () => {
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 10)).toBe(true)
  })

  it('does not block a ray that passes beside it', () => {
    // Same plane crossing, well outside the triangle in x.
    expect(occluded(bvh, 5, 0, 0, 0, 0, 1, 10)).toBe(false)
    // Same plane crossing, outside in y.
    expect(occluded(bvh, 0, 5, 0, 0, 0, 1, 10)).toBe(false)
  })

  it('does not block a ray pointing away from it', () => {
    // This is the test that a missing `t > 0` check fails: the infinite line
    // through the origin does cross the triangle, just at a negative t.
    expect(occluded(bvh, 0, 0, 0, 0, 0, -1, 10)).toBe(false)
  })

  it('does not block a ray parallel to its plane', () => {
    expect(occluded(bvh, 0, 0, 2, 1, 0, 0, 10)).toBe(false)
  })

  it('blocks a ray arriving from behind, because there is no backface cull', () => {
    /*
      From z = 5 heading towards -z, this triangle presents its back face. A
      culled implementation returns false here, and that failure in a bake is
      completely silent: every overhang stops shadowing what is beneath it, the
      texture still looks like a plausible lightmap, and the only symptom is that
      nothing in the scene is ever in shade.
    */
    expect(occluded(bvh, 0, 0, 5, 0, 0, -1, 10)).toBe(true)
  })

  it('respects maxDistance', () => {
    // The triangle is 2 units away along a unit direction, so t is 2.
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 10)).toBe(true)
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 0.5)).toBe(false)
    // And the boundary is exclusive on both sides of the comparison.
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 2.0001)).toBe(true)
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 1.9999)).toBe(false)
  })

  it('treats maxDistance at or below the t epsilon as no ray at all', () => {
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, 0)).toBe(false)
    expect(occluded(bvh, 0, 0, 0, 0, 0, 1, -1)).toBe(false)
  })
})

describe('self-intersection', () => {
  /*
    The case that ruins a bake. Every ray in a lightmap starts on the surface
    being shaded, and that surface is in the BVH. If the t epsilon is too small,
    the triangle blocks its own rays, roughly half the time (whichever side the
    float rounding puts the origin on), and the whole chart bakes black.

    Origins here are built as float32 barycentric interpolations, which is how a
    real UV rasteriser produces them - not as exact vertex positions, because
    exact positions on an axis-aligned triangle give t of exactly 0 and hide the
    problem entirely.
  */
  const soup: TriangleSoup = new Float32Array([
    // A tilted triangle in general position, so interpolation actually rounds.
    0.37, 1.11, -0.53, 2.71, 1.83, 0.29, 1.02, 2.47, 1.61,
  ])
  const bvh = buildBvh(soup)

  function surfacePoint(u: number, v: number): Float32Array {
    const p = new Float32Array(3)
    for (let c = 0; c < 3; c += 1) {
      p[c] = soup[c] + u * (soup[3 + c] - soup[c]) + v * (soup[6 + c] - soup[c])
    }
    return p
  }

  // The triangle's unit normal, so "pointing away" is unambiguous.
  const e1 = [soup[3] - soup[0], soup[4] - soup[1], soup[5] - soup[2]]
  const e2 = [soup[6] - soup[0], soup[7] - soup[1], soup[8] - soup[2]]
  const nRaw = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ]
  const nLen = Math.hypot(nRaw[0], nRaw[1], nRaw[2])
  const n = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen]

  it('does not let a triangle occlude a ray that starts on it and points away', () => {
    const rng = mulberry32(0xbeef)
    for (let i = 0; i < 500; i += 1) {
      let u = rng()
      let v = rng()
      if (u + v > 1) {
        u = 1 - u
        v = 1 - v
      }
      const p = surfacePoint(u, v)
      // Both normal directions: whichever way the ray leaves, its own triangle
      // must not be in the way.
      expect(occluded(bvh, p[0], p[1], p[2], n[0], n[1], n[2], 50)).toBe(false)
      expect(occluded(bvh, p[0], p[1], p[2], -n[0], -n[1], -n[2], 50)).toBe(false)
    }
  })

  it('still blocks a ray from that surface point when something else is in the way', () => {
    // The epsilon must not be so large that it eats real occluders. A second
    // triangle one unit along the normal is still found.
    const withBlocker = new Float32Array(18)
    withBlocker.set(soup, 0)
    for (let v = 0; v < 3; v += 1) {
      for (let c = 0; c < 3; c += 1) {
        withBlocker[9 + v * 3 + c] = soup[v * 3 + c] + n[c] * 1 + (c === 0 ? -0.5 : 0)
      }
    }
    // Widen the blocker so a point anywhere on the source triangle sees it.
    const blocked = buildBvh(withBlocker)
    const p = surfacePoint(0.3, 0.3)
    expect(occluded(blocked, p[0], p[1], p[2], n[0], n[1], n[2], 50)).toBe(true)
  })
})

describe('axis-aligned rays, where 0 * Infinity produces NaN', () => {
  /*
    A direction component of exactly 0 makes its reciprocal Infinity, and if the
    origin also sits exactly on a slab boundary the slab test computes
    0 * Infinity = NaN. Every comparison against NaN is false, so the algorithm's
    answer depends on the order the comparisons happen to be written in.

    Axis-aligned rays are not a corner case for a lightmap - a sky-visibility
    ray fired straight up from a flat deck is exactly this - so all six
    directions get a test, each with the target triangle placed squarely in the
    path and each with the ray origin aligned with the target's own extent so the
    degenerate-slab arithmetic is actually reached.
  */
  const cases: {
    name: string
    dir: [number, number, number]
    soup: number[]
  }[] = [
    { name: '+X', dir: [1, 0, 0], soup: [3, -1, -1, 3, 1, -1, 3, 0, 1.5] },
    { name: '-X', dir: [-1, 0, 0], soup: [-3, -1, -1, -3, 1, -1, -3, 0, 1.5] },
    { name: '+Y', dir: [0, 1, 0], soup: [-1, 3, -1, 1, 3, -1, 0, 3, 1.5] },
    { name: '-Y', dir: [0, -1, 0], soup: [-1, -3, -1, 1, -3, -1, 0, -3, 1.5] },
    { name: '+Z', dir: [0, 0, 1], soup: [-1, -1, 3, 1, -1, 3, 0, 1.5, 3] },
    { name: '-Z', dir: [0, 0, -1], soup: [-1, -1, -3, 1, -1, -3, 0, 1.5, -3] },
  ]

  for (const { name, dir, soup } of cases) {
    it(`finds a triangle along ${name}`, () => {
      const bvh = buildBvh(new Float32Array(soup))
      expect(occluded(bvh, 0, 0, 0, dir[0], dir[1], dir[2], 10)).toBe(true)
      // And the opposite direction from the same origin finds nothing, so the
      // test above cannot be passing because the slab test degenerated into
      // "always visit, always hit".
      expect(occluded(bvh, 0, 0, 0, -dir[0], -dir[1], -dir[2], 10)).toBe(false)
    })
  }

  it('handles a -0 direction component the same as +0', () => {
    // 1 / -0 is -Infinity, which flips the sign of both slab intersections and
    // relies on the swap to put them back in order.
    const bvh = buildBvh(new Float32Array([-1, -1, 3, 1, -1, 3, 0, 1.5, 3]))
    expect(occluded(bvh, 0, 0, 0, -0, -0, 1, 10)).toBe(true)
  })

  it('does not crash and returns a boolean for a ray grazing a box boundary', () => {
    /*
      The triangle's AABB has minY exactly 0, so a ray at y = 0 travelling in +X
      has origin exactly on the slab plane with a zero Y direction: the exact
      0 * Infinity case. Whether this particular ray is occluded is a genuine
      knife-edge that depends on float rounding in the triangle test, so the
      assertion is on the *type* - the point is that nothing throws and nothing
      returns NaN-as-truthy.
    */
    const bvh = buildBvh(new Float32Array([5, 0, -1, 5, 0, 1, 5, 2, 0]))
    for (const y of [0, -0, 1e-9, -1e-9]) {
      const result = occluded(bvh, 0, y, 0, 1, 0, 0, 10)
      expect(typeof result).toBe('boolean')
    }
    // The unambiguous versions either side of the edge must still be right.
    expect(occluded(bvh, 0, 1, 0, 1, 0, 0, 10)).toBe(true)
    expect(occluded(bvh, 0, -1, 0, 1, 0, 0, 10)).toBe(false)
  })
})

/**
 * Random triangles in general position, filling a 12-unit cube, each up to 5
 * units across.
 *
 * The density here was tuned, not guessed. The first version - 1-unit triangles
 * in a 20-unit cube - was so sparse that only 4.8% of rays hit anything, which
 * means an agreement test that is 95% two implementations agreeing on "no".
 * Measured occlusion rates while tuning, 2000 uniform-sphere rays:
 *
 *   cube 20, triangle 2:   4.8%
 *   cube 14, triangle 4:  24.3%
 *   cube 12, triangle 5:  35.3%   <- used here
 *   cube 10, triangle 6:  39.9%
 *
 * Overlapping triangles are wanted, not a flaw: they are what makes traversal
 * visit several leaves per ray and what makes the early-out matter.
 */
function randomSoup(count: number, rng: () => number): TriangleSoup {
  const soup = new Float32Array(count * 9)
  for (let i = 0; i < count; i += 1) {
    const cx = (rng() - 0.5) * 12
    const cy = (rng() - 0.5) * 12
    const cz = (rng() - 0.5) * 12
    for (let v = 0; v < 3; v += 1) {
      soup[i * 9 + v * 3] = cx + (rng() - 0.5) * 5
      soup[i * 9 + v * 3 + 1] = cy + (rng() - 0.5) * 5
      soup[i * 9 + v * 3 + 2] = cz + (rng() - 0.5) * 5
    }
  }
  return soup
}

describe('brute-force agreement', () => {
  /*
    The only test that really proves a BVH.

    Everything above checks a property that a broken tree can still satisfy. A
    tree can have the right node count, a sane depth, correct leaf sizes and
    pass every hand-built case above while whole subtrees sit unreachable - that
    is exactly the bug that shipped in the first version of buildBvh, where the
    recursion allocated the left subtree before the right child, so traversal's
    `left + 1` walked into the left child's own left child. It lost roughly half
    the scene and threw nothing. This test caught it; nothing else did.

    Measured on this seed: 706 of 2000 uniform-sphere rays (35.3%) and 1212 of
    2400 axis-aligned rays (50.5%) are occluded, so what is being asserted is a
    real mix of yes and no, not two implementations agreeing on "nothing hit".
  */
  const rng = mulberry32(0x5eed)
  const soup = randomSoup(400, rng)
  const bvh = buildBvh(soup)

  it('agrees with a linear scan on 2000 random rays', () => {
    const rayRng = mulberry32(0xc0ffee)
    let occludedCount = 0
    const disagreements: string[] = []
    for (let i = 0; i < 2000; i += 1) {
      // Origins from outside and inside the cloud, so both the deep-traversal
      // and the immediate-hit paths get exercised.
      const ox = (rayRng() - 0.5) * 20
      const oy = (rayRng() - 0.5) * 20
      const oz = (rayRng() - 0.5) * 20
      // Uniform on the sphere, so no direction family is under-sampled and the
      // near-axis-aligned cases turn up on their own.
      const z = rayRng() * 2 - 1
      const phi = rayRng() * Math.PI * 2
      const r = Math.sqrt(Math.max(0, 1 - z * z))
      const dx = r * Math.cos(phi)
      const dy = r * Math.sin(phi)
      const dz = z
      const maxDistance = 2 + rayRng() * 60

      const fast = occluded(bvh, ox, oy, oz, dx, dy, dz, maxDistance)
      const slow = occludedByScan(soup, ox, oy, oz, dx, dy, dz, maxDistance)
      if (fast !== slow) {
        disagreements.push(
          `ray ${i}: o=(${ox},${oy},${oz}) d=(${dx},${dy},${dz}) max=${maxDistance} ` +
            `bvh=${fast} scan=${slow}`,
        )
      }
      if (slow) occludedCount += 1
    }
    // Report the actual rays, not just a count: a seeded PRNG means a failure
    // here is reproducible, and printing the ray is what makes that useful.
    expect(disagreements).toEqual([])
    // 706 on this seed. If this ever drifts towards 0 or 2000 the soup or the
    // ray distribution has changed and the test has stopped discriminating.
    expect(occludedCount).toBeGreaterThan(500)
    expect(occludedCount).toBeLessThan(1500)
  })

  it('agrees with a linear scan on axis-aligned rays through the same soup', () => {
    // Axis-aligned directions never come out of a uniform sphere sample, and
    // they are the ones with the degenerate slab arithmetic, so sweep them
    // separately against the reference.
    const gridRng = mulberry32(0xd15ea5e)
    const dirs: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]
    let checked = 0
    let occludedCount = 0
    for (let i = 0; i < 400; i += 1) {
      const ox = (gridRng() - 0.5) * 16
      const oy = (gridRng() - 0.5) * 16
      const oz = (gridRng() - 0.5) * 16
      for (const [dx, dy, dz] of dirs) {
        const slow = occludedByScan(soup, ox, oy, oz, dx, dy, dz, 80)
        expect(occluded(bvh, ox, oy, oz, dx, dy, dz, 80)).toBe(slow)
        checked += 1
        if (slow) occludedCount += 1
      }
    }
    expect(checked).toBe(2400)
    // Measured on this seed: 1212 of 2400 axis-aligned rays (50.5%) occluded.
    expect(occludedCount).toBeGreaterThan(600)
    expect(occludedCount).toBeLessThan(1800)
  })

  it('reports plausible stats for the 400-triangle soup', () => {
    const stats = bvhStats(bvh)
    expect(stats.triangles).toBe(400)
    expect(stats.maxDepth).toBeLessThan(32)
    // 400 triangles at a leaf size of 4 is ~7 levels of a balanced median split.
    expect(stats.maxDepth).toBeGreaterThan(4)
    expect(stats.leaves).toBeGreaterThan(0)
    expect(stats.nodes).toBe(stats.leaves * 2 - 1)
    expect(stats.leaves * stats.meanLeafSize).toBeCloseTo(400, 6)
    expect(stats.meanLeafSize).toBeLessThanOrEqual(4)
  })

  it('does not mutate the caller soup', () => {
    // buildBvh permutes triangles into leaf order, and doing that in place would
    // silently reorder a Float32Array the caller may still be rendering from.
    const original = randomSoup(40, mulberry32(11))
    const copy = original.slice()
    buildBvh(original)
    expect(Array.from(original)).toEqual(Array.from(copy))
  })

  it('allocates nothing per ray', () => {
    /*
      Not a timing test - a structural one. `occluded` reuses the stack stored on
      the Bvh, so casting a million rays must not grow the heap. Timing would be
      flaky in CI; heap delta after an explicit GC is not available without
      --expose-gc, so this asserts the observable contract instead: the stack
      array identity is unchanged and its length is untouched after heavy use.
    */
    const stack = bvh.stack
    const rayRng = mulberry32(3)
    for (let i = 0; i < 20000; i += 1) {
      occluded(
        bvh,
        (rayRng() - 0.5) * 30,
        (rayRng() - 0.5) * 30,
        (rayRng() - 0.5) * 30,
        rayRng() - 0.5,
        rayRng() - 0.5,
        rayRng() - 0.5,
        40,
      )
    }
    expect(bvh.stack).toBe(stack)
    expect(bvh.stack.length).toBe(stack.length)
  })
})

describe('degenerate input', () => {
  it('throws on a length that is not a multiple of 9', () => {
    expect(() => buildBvh(new Float32Array(10))).toThrow(/positive multiple of 9/)
    expect(() => buildBvh(new Float32Array(8))).toThrow(/positive multiple of 9/)
    expect(() => buildBvh(new Float32Array(17))).toThrow(/got 17/)
  })

  it('throws on an empty soup', () => {
    // An empty BVH would be a legal-looking object that answers "nothing is ever
    // occluded", which is indistinguishable from a bake where the geometry
    // failed to load.
    expect(() => buildBvh(new Float32Array(0))).toThrow(/positive multiple of 9/)
  })

  it('handles many triangles with identical centroids without exceeding the depth cap', () => {
    /*
      A median split on a range whose centroid extent is zero on every axis
      cannot separate anything spatially. Splitting by count rather than by
      position is what keeps this terminating; if it split by position it would
      recurse until MAX_DEPTH on every level and leave one enormous leaf.
    */
    const count = 500
    const soup = new Float32Array(count * 9)
    for (let i = 0; i < count; i += 1) {
      // Same centroid every time, different vertex ordering and size.
      const scale = 1 + (i % 7) * 0.1
      soup.set([-scale, -scale, 0, scale, -scale, 0, 0, 2 * scale, 0], i * 9)
    }
    const bvh: Bvh = buildBvh(soup)
    const stats = bvhStats(bvh)
    expect(stats.triangles).toBe(count)
    expect(stats.maxDepth).toBeLessThan(32)
    expect(stats.meanLeafSize).toBeLessThanOrEqual(4)
    // And it still answers correctly.
    expect(occluded(bvh, 0, 0, -5, 0, 0, 1, 10)).toBe(true)
    expect(occluded(bvh, 0, 0, -5, 0, 0, -1, 10)).toBe(false)
  })

  it('handles a soup of degenerate zero-area triangles', () => {
    // Collinear vertices give a determinant of zero for every ray, so nothing
    // should ever be reported occluded, and nothing should divide by zero.
    const soup = new Float32Array(9 * 6)
    for (let i = 0; i < 6; i += 1) {
      soup.set([0, 0, i, 1, 1, i, 2, 2, i], i * 9)
    }
    const bvh = buildBvh(soup)
    expect(occluded(bvh, 0.5, 0.4, -1, 0, 0, 1, 20)).toBe(false)
    expect(occluded(bvh, 0, 0, 0, 1, 1, 1, 20)).toBe(false)
  })
})
