import { describe, it, expect } from 'vitest'
import { approach, approachAngle, initialVerticalState, stepHorizontal, stepVertical } from './movement'
import { JUMP, MOVEMENT } from './tuning'

const DT = 1 / 60

/** Runs n steps with constant input, returning the final state. */
function run(
  state = initialVerticalState(),
  steps: number,
  input: { grounded: boolean; jumpPressed?: boolean; jumpHeld?: boolean },
) {
  let s = { ...state, jumped: false }
  for (let i = 0; i < steps; i++) {
    s = stepVertical(s, {
      grounded: input.grounded,
      // A press is an edge, so it only applies on the first step.
      jumpPressed: i === 0 ? (input.jumpPressed ?? false) : false,
      jumpHeld: input.jumpHeld ?? false,
      dt: DT,
    })
  }
  return s
}

describe('jumping', () => {
  it('jumps when grounded and jump is pressed', () => {
    const s = stepVertical(initialVerticalState(), {
      grounded: true,
      jumpPressed: true,
      jumpHeld: true,
      dt: DT,
    })
    expect(s.jumped).toBe(true)
    expect(s.vy).toBeGreaterThan(0)
  })

  it('does not double jump from a single press', () => {
    let s = stepVertical(initialVerticalState(), {
      grounded: true, jumpPressed: true, jumpHeld: true, dt: DT,
    })
    expect(s.jumped).toBe(true)
    // Still holding, now airborne. Must not fire again off the same press.
    s = stepVertical(s, { grounded: false, jumpPressed: false, jumpHeld: true, dt: DT })
    expect(s.jumped).toBe(false)
  })
})

describe('coyote time', () => {
  it('allows a jump shortly after walking off a ledge', () => {
    // Grounded first so the coyote window is charged.
    let s = { ...run(initialVerticalState(), 1, { grounded: true }), jumped: false }
    expect(s.coyote).toBeCloseTo(JUMP.coyoteTime)

    // Airborne for 3 steps (50ms), still inside the 100ms window.
    s = run(s, 3, { grounded: false })
    expect(s.coyote).toBeGreaterThan(0)

    const jump = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(jump.jumped).toBe(true)
  })

  it('refuses a jump once the window has expired', () => {
    let s = { ...run(initialVerticalState(), 1, { grounded: true }), jumped: false }
    // 10 steps is ~167ms, comfortably past the 100ms window.
    s = run(s, 10, { grounded: false })
    expect(s.coyote).toBe(0)

    const jump = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(jump.jumped).toBe(false)
  })

  it('does not grant coyote time to a character that was never grounded', () => {
    const s = stepVertical(initialVerticalState(), {
      grounded: false, jumpPressed: true, jumpHeld: true, dt: DT,
    })
    expect(s.jumped).toBe(false)
  })
})

describe('jump buffering', () => {
  it('fires a jump pressed just before landing', () => {
    // Press while airborne. Nothing happens yet.
    let s = stepVertical(initialVerticalState(), {
      grounded: false, jumpPressed: true, jumpHeld: true, dt: DT,
    })
    expect(s.jumped).toBe(false)
    expect(s.buffer).toBeGreaterThan(0)

    // Two more airborne steps, then touch down inside the buffer window.
    s = { ...run(s, 2, { grounded: false, jumpHeld: true }), jumped: false }
    const landing = stepVertical(s, {
      grounded: true, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    expect(landing.jumped).toBe(true)
  })

  it('drops a press that arrived too early', () => {
    let s = stepVertical(initialVerticalState(), {
      grounded: false, jumpPressed: true, jumpHeld: true, dt: DT,
    })
    // 10 steps is ~167ms, past the 120ms buffer.
    s = { ...run(s, 10, { grounded: false, jumpHeld: true }), jumped: false }
    expect(s.buffer).toBe(0)

    const landing = stepVertical(s, {
      grounded: true, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    expect(landing.jumped).toBe(false)
  })
})

describe('variable jump height', () => {
  it('reaches a lower apex when the button is released early', () => {
    const apex = (holdSteps: number) => {
      let s = { ...stepVertical(initialVerticalState(), {
        grounded: true, jumpPressed: true, jumpHeld: true, dt: DT,
      }), jumped: false }
      let height = 0
      for (let i = 0; i < 120; i++) {
        s = stepVertical(s, {
          grounded: false, jumpPressed: false, jumpHeld: i < holdSteps, dt: DT,
        })
        if (s.vy <= 0) break
        height += s.vy * DT
      }
      return height
    }

    const tapped = apex(1)
    const held = apex(120)
    expect(tapped).toBeLessThan(held)
    // A tap should be meaningfully shorter, not marginally so, or the mechanic
    // is not expressive enough to be worth having.
    expect(tapped).toBeLessThan(held * 0.6)
  })
})

describe('gravity', () => {
  it('falls faster than it rises', () => {
    const rising = stepVertical({ vy: 5, coyote: 0, buffer: 0 }, {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    const falling = stepVertical({ vy: -5, coyote: 0, buffer: 0 }, {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    const risingDelta = Math.abs(rising.vy - 5)
    const fallingDelta = Math.abs(falling.vy - -5)
    expect(fallingDelta).toBeGreaterThan(risingDelta)
  })

  it('clamps to terminal velocity on a long fall', () => {
    let s = { ...initialVerticalState(), jumped: false }
    for (let i = 0; i < 600; i++) {
      s = stepVertical(s, { grounded: false, jumpPressed: false, jumpHeld: false, dt: DT })
    }
    expect(s.vy).toBe(JUMP.maxFallSpeed)
  })
})

describe('horizontal movement', () => {
  it('decelerates faster than it accelerates, so stopping feels crisp', () => {
    const accelerated = stepHorizontal(0, MOVEMENT.maxSpeed, true, true, DT)
    const decelerated = MOVEMENT.maxSpeed - stepHorizontal(MOVEMENT.maxSpeed, 0, false, true, DT)
    expect(decelerated).toBeGreaterThan(accelerated)
  })

  it('reduces control while airborne', () => {
    const ground = stepHorizontal(0, MOVEMENT.maxSpeed, true, true, DT)
    const air = stepHorizontal(0, MOVEMENT.maxSpeed, true, false, DT)
    expect(air).toBeLessThan(ground)
    expect(air).toBeCloseTo(ground * MOVEMENT.airControl, 5)
  })

  it('never overshoots the target speed', () => {
    expect(stepHorizontal(0, 0.001, true, true, DT)).toBe(0.001)
  })
})

describe('helpers', () => {
  it('approach lands exactly on target', () => {
    expect(approach(0, 1, 5)).toBe(1)
    expect(approach(0, 10, 1)).toBe(1)
    expect(approach(10, 0, 1)).toBe(9)
  })

  it('approachAngle turns the short way across the wrap point', () => {
    // From just below +pi to just above -pi is a short hop, not a full lap.
    const result = approachAngle(3.0, -3.0, 0.2)
    expect(result).toBeGreaterThan(3.0)
  })
})
