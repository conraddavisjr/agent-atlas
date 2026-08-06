import { describe, it, expect } from 'vitest'
import { clusteredPlacements, evenPlacements, mulberry32, type Placement } from './placement'

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
})
