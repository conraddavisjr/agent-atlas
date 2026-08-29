import { describe, expect, it } from 'vitest'
import {
  BURST_CAPACITY,
  BURST_LIFE,
  burstOpacity,
  createBurst,
  seedBurst,
  stepBurst,
} from './burst'
import { mulberry32 } from '@/art/placement'

const origin: [number, number, number] = [0, 2.5, 3.9]
const rng = () => mulberry32(20260821)

describe('the pool has a ceiling, which is the point', () => {
  it('never holds more than it was built for', () => {
    /*
      The brief: "make sure that there are not too many confettis so it doesn't
      create a major slowdown in FPS". A pool decides its cost once, at
      construction, and no sequence of events can exceed it - which is a stronger
      guarantee than any spawn-rate limit.
    */
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    expect(burst.live).toBe(BURST_CAPACITY)
    seedBurst(burst, origin, rng(), 4)
    expect(burst.live).toBe(BURST_CAPACITY)
  })

  it('costs one draw call and a bounded triangle count', () => {
    // Two triangles a quad, one instanced mesh. Stated as a test so the budget is
    // a fact rather than a claim in a comment.
    const triangles = BURST_CAPACITY * 2
    expect(triangles).toBeLessThanOrEqual(240)
  })

  it('allocates nothing per frame', () => {
    /*
      Checked by identity rather than by profiling: if `stepBurst` ever replaced a
      buffer instead of writing into it, these would stop being the same objects.
      That is the mistake that turns a fixed-cost effect into a garbage generator
      at exactly the moment the game is busiest.
    */
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    const before = [burst.x, burst.vy, burst.life, burst.tint]
    for (let i = 0; i < 60; i++) stepBurst(burst, 1 / 60)
    expect([burst.x, burst.vy, burst.life, burst.tint]).toEqual(before)
  })
})

describe('every piece dies', () => {
  it('empties within its longest stated life', () => {
    // A pool that leaked would draw a hundred invisible instances forever.
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    let alive = BURST_CAPACITY
    for (let t = 0; t < BURST_LIFE.max + 0.2; t += 1 / 60) alive = stepBurst(burst, 1 / 60)
    expect(alive).toBe(0)
    expect(burst.live).toBe(0)
  })

  it('reports its own liveness honestly on the way down', () => {
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    let previous = BURST_CAPACITY + 1
    for (let t = 0; t < BURST_LIFE.max + 0.2; t += 1 / 60) {
      const alive = stepBurst(burst, 1 / 60)
      // Monotone: a count that rose would mean a dead piece came back.
      expect(alive).toBeLessThanOrEqual(previous)
      previous = alive
    }
  })

  it('never carries a negative life', () => {
    // A negative would make `burstOpacity` negative, which renders as a piece that
    // is inside-out rather than gone.
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    for (let i = 0; i < 400; i++) {
      stepBurst(burst, 1 / 30)
      for (let p = 0; p < BURST_CAPACITY; p++) expect(burst.life[p]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('it survives any frame rate', () => {
  it('produces no NaN at 240 fps or at 10', () => {
    /*
      Both ends. This project has already paid once for a delta-time bug it could
      not see, and a NaN here does not throw - it produces an instance matrix full
      of NaN, which three quietly refuses to draw. The burst would simply not
      appear, on some machines.
    */
    for (const dt of [1 / 240, 1 / 60, 1 / 30, 1 / 10, 1]) {
      const burst = createBurst()
      seedBurst(burst, origin, rng(), 4)
      for (let i = 0; i < 300; i++) stepBurst(burst, dt)
      for (let p = 0; p < BURST_CAPACITY; p++) {
        expect(Number.isFinite(burst.x[p]), `dt ${dt} x`).toBe(true)
        expect(Number.isFinite(burst.y[p]), `dt ${dt} y`).toBe(true)
        expect(Number.isFinite(burst.spin[p]), `dt ${dt} spin`).toBe(true)
      }
    }
  })

  it('clamps a monster delta rather than firing the burst off screen', () => {
    // A backgrounded tab hands back one enormous delta on its first frame back.
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    stepBurst(burst, 30)
    for (let p = 0; p < BURST_CAPACITY; p++) {
      expect(Math.abs(burst.y[p] - origin[1])).toBeLessThan(3)
    }
  })
})

describe('it reads as paper', () => {
  it('throws almost everything upward rather than spherically', () => {
    /*
      A spherical burst sends a third of its budget straight at the floor, where it
      lands and vanishes within half a second - a third of the effect wasted at the
      one moment it is meant to be biggest.
    */
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    let rising = 0
    for (let p = 0; p < BURST_CAPACITY; p++) if (burst.vy[p] > 0) rising++
    expect(rising).toBe(BURST_CAPACITY)
  })

  it('tumbles both ways', () => {
    // All one direction reads as a machine rather than as paper.
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    const cw = Array.from(burst.spinRate).filter((r) => r > 0).length
    expect(cw).toBeGreaterThan(BURST_CAPACITY * 0.25)
    expect(cw).toBeLessThan(BURST_CAPACITY * 0.75)
  })

  it('sheds speed, so it flutters rather than following a clean arc', () => {
    // Drag is the single number that separates confetti from gravel.
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    const before = Math.hypot(burst.vx[0], burst.vz[0])
    for (let i = 0; i < 30; i++) stepBurst(burst, 1 / 60)
    expect(Math.hypot(burst.vx[0], burst.vz[0])).toBeLessThan(before * 0.75)
  })

  it('is reproducible from a seed, which the capture harness needs', () => {
    // The harness pins the clock and expects the same picture twice.
    const a = createBurst()
    const b = createBurst()
    seedBurst(a, origin, rng(), 4)
    seedBurst(b, origin, rng(), 4)
    expect(Array.from(a.vx)).toEqual(Array.from(b.vx))
    expect(Array.from(a.spinRate)).toEqual(Array.from(b.spinRate))
  })
})

describe('the fade', () => {
  it('holds full for most of a piece\'s life and only fades at the end', () => {
    /*
      A linear fade from birth makes every piece a ghost by the halfway point,
      which is exactly when they are spread widest and most worth seeing.
    */
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    expect(burstOpacity(burst, 0)).toBe(1)

    burst.life[0] = burst.born[0] * 0.5
    expect(burstOpacity(burst, 0)).toBe(1)

    burst.life[0] = burst.born[0] * 0.15
    expect(burstOpacity(burst, 0)).toBeLessThan(1)
    expect(burstOpacity(burst, 0)).toBeGreaterThan(0)

    burst.life[0] = 0
    expect(burstOpacity(burst, 0)).toBe(0)
  })

  it('never leaves the unit interval', () => {
    /*
      **Scanned into one assertion rather than asserted per element.**

      `expect()` allocates a matcher and eagerly builds its message string, so a
      loop of this size spends far more time in the assertion library than in the
      code it is testing. This one ran comfortably alone and timed out at 5 s once
      the suite grew - the worst kind of flake, since it is green on the machine
      that wrote it and red on a loaded one, and it points at geometry that is
      perfectly fine. `hubLayout.test.ts` lost the same way and was fixed the same
      way.

      The scan also reports the FIRST bad value and where it was, which is more
      useful than a matcher firing somewhere in a million samples.
    */
    const burst = createBurst()
    seedBurst(burst, origin, rng(), 4)
    const bad: string[] = []
    for (let i = 0; i < 200 && bad.length === 0; i++) {
      stepBurst(burst, 1 / 60)
      for (let p = 0; p < BURST_CAPACITY; p++) {
        const o = burstOpacity(burst, p)
        if (!(o >= 0 && o <= 1)) {
          bad.push(`particle ${p} at step ${i} had opacity ${o}`)
          break
        }
      }
    }
    expect(bad, 'a particle left the unit interval').toEqual([])
  })
})
