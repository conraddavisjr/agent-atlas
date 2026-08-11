import { describe, it, expect } from 'vitest'
import {
  ANIM_EVENT_CAPACITY,
  createAnimEventRing,
  drainEvents,
  EV,
  pushEvent,
  type AnimEventKind,
  type AnimEventRing,
} from './robotAnim'

/** Collects the kinds delivered by one drain, in order. */
function drainKinds(r: AnimEventRing, cursor: number): { kinds: number[]; cursor: number } {
  const kinds: number[] = []
  const next = drainEvents(r, cursor, (ring, slot, out: number[]) => void out.push(ring.kind[slot]), kinds)
  return { kinds, cursor: next }
}

function push(r: AnimEventRing, kind: AnimEventKind, a = 0) {
  pushEvent(r, kind, a, 0, 0, 0, 0, 1, 0, a, 0)
}

describe('the event ring', () => {
  it('delivers every event exactly once, in order, across many wraps', () => {
    const r = createAnimEventRing()
    let cursor = 0
    const seen: number[] = []
    for (let i = 0; i < 1000; i++) {
      pushEvent(r, EV.Footstep, i, 0, 0, 0, 0, 1, 0, i, 0)
      cursor = drainEvents(r, cursor, (ring, slot, out: number[]) => void out.push(ring.a[slot]), seen)
    }
    expect(seen).toHaveLength(1000)
    for (let i = 0; i < 1000; i++) expect(seen[i]).toBe(i)
    expect(r.dropped).toBe(0)
  })

  /*
    The point of the design: several consumers, each holding its own cursor,
    with no coordination between them. `head` is never wrapped, so falling
    behind is a subtraction rather than a modular comparison.
  */
  it('serves two independent consumers without either affecting the other', () => {
    const r = createAnimEventRing()
    let a = 0
    let b = 0
    for (let i = 0; i < 10; i++) push(r, EV.Jump, i)

    const first = drainKinds(r, a)
    a = first.cursor
    expect(first.kinds).toHaveLength(10)

    // The second consumer has not drained yet and must still see all ten.
    const second = drainKinds(r, b)
    b = second.cursor
    expect(second.kinds).toHaveLength(10)

    // And neither sees anything on a second drain with nothing new pushed.
    expect(drainKinds(r, a).kinds).toHaveLength(0)
    expect(drainKinds(r, b).kinds).toHaveLength(0)
  })

  /*
    Dropping is the correct trade for a cosmetic channel: a lost dust puff is
    nothing, and a system that blocks the producer to avoid one is a bug. At
    60 Hz a consumer has to stall for sixteen frames to overflow, which only
    happens when a tab is backgrounded, where dropping is exactly right.
  */
  it('fast-forwards and counts the loss when a consumer falls behind', () => {
    const r = createAnimEventRing()
    for (let i = 0; i < 100; i++) push(r, EV.Footstep, i)
    const { kinds, cursor } = drainKinds(r, 0)
    expect(kinds).toHaveLength(ANIM_EVENT_CAPACITY)
    expect(r.dropped).toBe(100 - ANIM_EVENT_CAPACITY)
    expect(cursor).toBe(100)
  })

  it('delivers the newest events, not the oldest, after a fast-forward', () => {
    const r = createAnimEventRing()
    for (let i = 0; i < 100; i++) pushEvent(r, EV.Footstep, i, 0, 0, 0, 0, 1, 0, i, 0)
    const seen: number[] = []
    drainEvents(r, 0, (ring, slot, out: number[]) => void out.push(ring.a[slot]), seen)
    expect(seen[0]).toBe(100 - ANIM_EVENT_CAPACITY)
    expect(seen[seen.length - 1]).toBe(99)
  })

  /*
    `head` is read once at the top of a drain, so an event pushed from inside
    the callback lands on the next one. Without that a consumer that emits in
    response to an event could drive an unbounded loop.
  */
  it('defers an event pushed from inside a drain to the next drain', () => {
    const r = createAnimEventRing()
    push(r, EV.Land)
    let cursor = 0
    let count = 0
    cursor = drainEvents(
      r,
      cursor,
      (ring) => {
        count++
        if (count === 1) push(ring, EV.Footstep)
      },
      null,
    )
    expect(count).toBe(1)
    expect(drainKinds(r, cursor).kinds).toEqual([EV.Footstep])
  })

  it('round-trips every payload field for every kind', () => {
    const r = createAnimEventRing()
    const kinds = Object.values(EV) as AnimEventKind[]
    for (let i = 0; i < kinds.length; i++) {
      pushEvent(r, kinds[i], i * 0.5, i, i + 1, i + 2, 0, 1, 0, i * 0.1, i)
    }
    const seen: Array<Record<string, number>> = []
    drainEvents(
      r,
      0,
      (ring, slot, out: Array<Record<string, number>>) => {
        out.push({
          kind: ring.kind[slot], t: ring.t[slot],
          x: ring.x[slot], y: ring.y[slot], z: ring.z[slot],
          nx: ring.nx[slot], ny: ring.ny[slot], nz: ring.nz[slot],
          a: ring.a[slot], b: ring.b[slot],
        })
      },
      seen,
    )
    expect(seen).toHaveLength(kinds.length)
    for (let i = 0; i < kinds.length; i++) {
      expect(seen[i].kind).toBe(kinds[i])
      expect(seen[i].t).toBeCloseTo(i * 0.5, 5)
      expect(seen[i].x).toBe(i)
      expect(seen[i].y).toBe(i + 1)
      expect(seen[i].z).toBe(i + 2)
      expect(seen[i].a).toBeCloseTo(i * 0.1, 5)
      expect(seen[i].b).toBe(i)
    }
  })

  it('never allocates', () => {
    const r = createAnimEventRing()
    const arrays = [r.kind, r.x, r.y, r.z, r.nx, r.ny, r.nz, r.a, r.b, r.t]
    for (let i = 0; i < 10_000; i++) push(r, EV.Footstep, i)
    expect([r.kind, r.x, r.y, r.z, r.nx, r.ny, r.nz, r.a, r.b, r.t]).toEqual(arrays)
    expect(r.kind.length).toBe(ANIM_EVENT_CAPACITY)
  })

  it('uses a power-of-two capacity, so the slot is a mask', () => {
    expect(ANIM_EVENT_CAPACITY & (ANIM_EVENT_CAPACITY - 1)).toBe(0)
  })
})
