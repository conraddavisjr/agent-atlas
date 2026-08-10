import { describe, it, expect } from 'vitest'
import {
  clusterCentres,
  clusteredPlacements,
  evenPlacements,
  mulberry32,
  type Placement,
} from './placement'

const base = { count: 600, radius: 16, seed: 7 }

/** Mean distance from each item to its nearest neighbour. */
function meanNearestNeighbour(items: Placement[]): number {
  let total = 0
  for (let i = 0; i < items.length; i++) {
    let best = Infinity
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      const d = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z)
      if (d < best) best = d
    }
    total += best
  }
  return total / items.length
}

describe('deterministic placement', () => {
  it('produces the same layout for the same seed', () => {
    // The world must not rearrange itself behind a portal transition, which is
    // what Math.random would do on every scene remount.
    const a = clusteredPlacements({ ...base, clusters: 12, clusterRadius: 3 })
    const b = clusteredPlacements({ ...base, clusters: 12, clusterRadius: 3 })
    expect(a).toEqual(b)
  })

  it('produces a different layout for a different seed', () => {
    const a = clusteredPlacements({ ...base, clusters: 12, clusterRadius: 3 })
    const b = clusteredPlacements({ ...base, clusters: 12, clusterRadius: 3, seed: 8 })
    expect(a).not.toEqual(b)
  })

  it('mulberry32 stays inside the unit interval', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 5000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('clustering', () => {
  it('packs items closer together than an even scatter does', () => {
    /*
      The whole reason this function exists. Same count over the same area, so
      any difference in nearest-neighbour distance is clumping and nothing else.
      A uniform field reads as a texture; patches read as ground cover.
    */
    const clustered = clusteredPlacements({ ...base, clusters: 10, clusterRadius: 2.5 })
    const even = evenPlacements({ ...base })
    expect(meanNearestNeighbour(clustered)).toBeLessThan(meanNearestNeighbour(even) * 0.75)
  })

  it('leaves bare ground between patches', () => {
    // Measured as the fraction of the island with nothing near it. A uniform
    // scatter covers almost everything; patches must not.
    const clustered = clusteredPlacements({ ...base, clusters: 8, clusterRadius: 2 })
    let empty = 0
    let sampled = 0
    for (let x = -14; x <= 14; x += 2) {
      for (let z = -14; z <= 14; z += 2) {
        if (Math.hypot(x, z) > 14) continue
        sampled++
        const near = clustered.some((p) => Math.hypot(p.x - x, p.z - z) < 1.5)
        if (!near) empty++
      }
    }
    expect(empty / sampled).toBeGreaterThan(0.3)
  })

  it('reports density that peaks at the middle of a patch', () => {
    // Callers scale height and size by this, so it has to run the way its name
    // says: 1 in the middle, toward 0 at the edge.
    const items = clusteredPlacements({ ...base, clusters: 6, clusterRadius: 3 })
    for (const p of items) {
      expect(p.density).toBeGreaterThanOrEqual(0)
      expect(p.density).toBeLessThanOrEqual(1)
    }
    const mean = items.reduce((a, p) => a + p.density, 0) / items.length
    // The falloff biases toward the centre, so the average must sit above half.
    expect(mean).toBeGreaterThan(0.5)
  })
})

describe('bounds and exclusion', () => {
  const cases = [
    ['clustered', () => clusteredPlacements({ ...base, clusters: 14, clusterRadius: 3 })],
    ['even', () => evenPlacements({ ...base })],
  ] as const

  for (const [name, make] of cases) {
    it(`keeps ${name} placements inside the island`, () => {
      // Clustering places patch centres first and members around them, so
      // members can overhang the edge unless it is checked afterwards.
      for (const p of make()) {
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(base.radius + 1e-9)
      }
    })

    it(`keeps ${name} placements out of exclusion zones`, () => {
      const exclusions = [
        { x: 9, z: -5, radius: 4.6 },
        { x: -4, z: -3, radius: 1.5 },
      ]
      const items =
        name === 'clustered'
          ? clusteredPlacements({ ...base, clusters: 14, clusterRadius: 3, exclusions })
          : evenPlacements({ ...base, exclusions })

      for (const p of items) {
        for (const e of exclusions) {
          expect(Math.hypot(p.x - e.x, p.z - e.z)).toBeGreaterThanOrEqual(e.radius)
        }
      }
    })

    it(`never returns more than asked for from ${name}`, () => {
      expect(make().length).toBeLessThanOrEqual(base.count)
    })
  }

  it('respects a clear middle', () => {
    const items = evenPlacements({ ...base, minRadius: 6 })
    for (const p of items) expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(6)
  })

  it('terminates when everything is excluded', () => {
    // The bound on attempts is what stops a heavily blocked area hanging the
    // load rather than simply coming back thin.
    const items = evenPlacements({ ...base, exclusions: [{ x: 0, z: 0, radius: 100 }] })
    expect(items).toHaveLength(0)
  })

  it('terminates when everything is excluded from a clustered layer too', () => {
    const items = clusteredPlacements({
      ...base,
      clusters: 8,
      clusterRadius: 3,
      exclusions: [{ x: 0, z: 0, radius: 100 }],
    })
    expect(items).toHaveLength(0)
  })

  it('keeps clustered placements out of a rectangular exclusion', () => {
    // A deck is a rectangle. Clearing one with a circle also strips the lawn at
    // its corners, which is visible on the 12 x 4 approach deck.
    const exclusion = { x: 0, z: -8.6, halfX: 6, halfZ: 2 }
    const items = clusteredPlacements({
      ...base,
      count: 2000,
      clusters: 14,
      clusterRadius: 3,
      exclusions: [exclusion],
    })
    for (const p of items) {
      const inside = Math.abs(p.x - exclusion.x) < exclusion.halfX &&
        Math.abs(p.z - exclusion.z) < exclusion.halfZ
      expect(inside).toBe(false)
    }
    // And it must clear less than the circle that would have to contain it,
    // which is the entire reason the variant exists.
    const circle = { x: 0, z: -8.6, radius: Math.hypot(6, 2) }
    const spared = items.filter(
      (p) => Math.hypot(p.x - circle.x, p.z - circle.z) < circle.radius,
    )
    expect(spared.length).toBeGreaterThan(0)
  })

  it('honours a rotated rectangular exclusion', () => {
    const exclusion = { x: 3, z: 2, halfX: 4, halfZ: 1, rotation: Math.PI / 4 }
    const items = clusteredPlacements({
      ...base,
      count: 2000,
      clusters: 14,
      clusterRadius: 3,
      exclusions: [exclusion],
    })
    for (const p of items) {
      const dx = p.x - exclusion.x
      const dz = p.z - exclusion.z
      const s = Math.sin(-exclusion.rotation)
      const c = Math.cos(-exclusion.rotation)
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      expect(Math.abs(lx) >= exclusion.halfX || Math.abs(lz) >= exclusion.halfZ).toBe(true)
    }
  })
})

describe('cluster centres', () => {
  it('samples centres inside the annulus it is given', () => {
    const centres = clusterCentres({
      clusters: 200,
      radius: 14.5,
      centreMinRadius: 10,
      centreMaxRadius: 13.5,
      seed: 5,
    })
    expect(centres).toHaveLength(200)
    for (const [x, z] of centres) {
      const r = Math.hypot(x, z)
      expect(r).toBeGreaterThanOrEqual(10 - 1e-9)
      expect(r).toBeLessThanOrEqual(13.5 + 1e-9)
    }
  })

  it('spreads centres evenly per unit area across the annulus', () => {
    /*
      Uniform per unit area means the median radius splits the ring's AREA in
      half, not its width. For 10 to 13.5 that is sqrt((100 + 182.25) / 2) =
      11.88, which is above the midpoint of 11.75. Sampling the radius uniformly
      instead would land the median on 11.75 and crowd the inner edge.
    */
    const centres = clusterCentres({
      clusters: 4000,
      radius: 14.5,
      centreMinRadius: 10,
      centreMaxRadius: 13.5,
      seed: 11,
    })
    const radii = centres.map(([x, z]) => Math.hypot(x, z)).sort((a, b) => a - b)
    const median = radii[Math.floor(radii.length / 2)]
    expect(median).toBeCloseTo(Math.sqrt((100 + 13.5 * 13.5) / 2), 1)
  })

  it('lets two layers share one set of patches', () => {
    /*
      Pebbles pool around boulders. Sampling the two layers independently would
      fill each other's gaps and average back out to uniform, which is the exact
      look the clustering exists to avoid.
    */
    const centres = clusterCentres({
      clusters: 6,
      radius: 14.5,
      centreMinRadius: 10,
      centreMaxRadius: 13.5,
      seed: 5,
    })
    const boulders = clusteredPlacements({
      count: 30, radius: 14.5, minRadius: 9, centres, clusterRadius: 1.6, seed: 5,
    })
    const pebbles = clusteredPlacements({
      count: 90, radius: 15, minRadius: 8.5, centres, clusterRadius: 2.6, seed: 17,
    })

    // Every pebble is within a debris halo of some boulder clump.
    for (const p of pebbles) {
      const nearest = Math.min(...centres.map(([cx, cz]) => Math.hypot(p.x - cx, p.z - cz)))
      expect(nearest).toBeLessThanOrEqual(2.6 + 1e-9)
    }
    expect(boulders.length).toBeGreaterThan(0)
  })
})

describe('the clear-middle thinning regression', () => {
  /*
    The bug: cluster centres were sampled over the whole disc while only
    individual MEMBERS were tested against minRadius. Ask for clumps between
    radius 9 and 14.5 on an island of radius 16 and most centres land in the
    middle, every one of their members is rejected one at a time, and the caller
    gets back a fraction of what it asked for with a count that changes with the
    seed. Nothing throws and nothing logs; the boulders are simply missing.
  */
  const spec = {
    count: 300,
    radius: 14.5,
    clusterRadius: 1.6,
    minRadius: 9.0,
    seed: 5,
  }

  it('fills the requested count when the middle is kept clear', () => {
    const items = clusteredPlacements({
      ...spec,
      clusters: 60,
      centreMinRadius: 10.0,
      centreMaxRadius: 13.5,
    })
    expect(items.length).toBeGreaterThanOrEqual(spec.count * 0.95)
  })

  it('is stable across seeds rather than varying with them', () => {
    const counts = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (seed) =>
        clusteredPlacements({
          ...spec,
          seed,
          clusters: 60,
          centreMinRadius: 10.0,
          centreMaxRadius: 13.5,
        }).length,
    )
    for (const n of counts) expect(n).toBeGreaterThanOrEqual(spec.count * 0.95)
  })

  it('demonstrates the thinning that whole-disc centres produce', () => {
    // The same request without the annulus bounds, which is what the old code
    // could express. Kept as a test so the fix cannot be quietly reverted.
    const naive = clusteredPlacements({ ...spec, clusters: 60 })
    const fixed = clusteredPlacements({
      ...spec,
      clusters: 60,
      centreMinRadius: 10.0,
      centreMaxRadius: 13.5,
    })
    expect(naive.length).toBeLessThan(fixed.length * 0.8)
  })
})

describe('minimum separation', () => {
  /*
    The critique's F6: the token crystal shards "visibly interpenetrate one
    another". Every cluster sampler does that to solid objects unless it is told
    how wide they are, because the sampler places points and a point has no
    width. One option fixes it for every layer that wants it.
  */
  const spec = {
    count: 120,
    radius: 15,
    clusters: 6,
    clusterRadius: 2.4,
    seed: 41,
  } as const

  const closestPair = (placements: { x: number; z: number }[]) => {
    let best = Infinity
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const dx = placements[i].x - placements[j].x
        const dz = placements[i].z - placements[j].z
        best = Math.min(best, Math.hypot(dx, dz))
      }
    }
    return best
  }

  it('never places two items closer than the separation asked for', () => {
    const placements = clusteredPlacements({ ...spec, minSeparation: 0.5 })
    expect(placements.length).toBeGreaterThan(20)
    expect(closestPair(placements)).toBeGreaterThanOrEqual(0.5)
  })

  it('is doing real work, because the same request without it overlaps', () => {
    // Without this the test above would pass on a layer that never happened to
    // collide, which is the way a separation test quietly stops separating.
    const placements = clusteredPlacements(spec)
    expect(closestPair(placements)).toBeLessThan(0.5)
  })

  it('leaves the layout untouched when no separation is asked for', () => {
    // Zero must be free as well as inert: the grass field runs 220,000
    // placements through this function and allocates no grid at all.
    const without = clusteredPlacements(spec)
    const zero = clusteredPlacements({ ...spec, minSeparation: 0 })
    expect(zero).toEqual(without)
  })

  it('thins the count rather than compromising, when a patch cannot hold them', () => {
    /*
      Same guarantee `exclusions` already gives. A caller that asks for more
      than fits gets fewer, never a pair on top of each other, and the bounded
      retry budget means it terminates rather than hunting for a gap that is not
      there.
    */
    const crowded = clusteredPlacements({ ...spec, minSeparation: 2.0 })
    expect(crowded.length).toBeLessThan(spec.count)
    expect(crowded.length).toBeGreaterThan(0)
    expect(closestPair(crowded)).toBeGreaterThanOrEqual(2.0)
  })

  it('separates across patch boundaries, not only inside one patch', () => {
    /*
      The grid is keyed on world position rather than reset per cluster, so two
      overlapping patches cannot each place an item in the same spot. Two
      centres deliberately close enough to overlap.
    */
    const placements = clusteredPlacements({
      count: 200,
      radius: 15,
      centres: [
        [0, 0],
        [1.5, 0],
      ],
      clusterRadius: 2.4,
      seed: 7,
      minSeparation: 0.4,
    })
    expect(placements.length).toBeGreaterThan(30)
    expect(closestPair(placements)).toBeGreaterThanOrEqual(0.4)
  })
})
