import { describe, it, expect } from 'vitest'
import {
  approach,
  approachAngle,
  initialVerticalState,
  headingVector,
  stepCameraYaw,
  stepDrive,
  stepHorizontal,
  stepVertical,
  wrapAngle,
} from './movement'
import { CAMERA, JUMP, MOVEMENT } from './tuning'

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

  it('wrapAngle brings any angle into [-pi, pi]', () => {
    expect(wrapAngle(0)).toBe(0)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5)
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 5)
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('camera realignment', () => {
  /** A robot pointing due east, with the camera off to one side. */
  const driving = {
    yaw: 0,
    facing: Math.PI / 2,
    following: true,
    lookingManually: false,
    dt: DT,
  }

  it('swings toward the position behind the robot', () => {
    // The target is facing plus half a turn. Starting at zero and needing to
    // reach three quarters of a turn, the short way is downward through
    // negative yaw.
    expect(stepCameraYaw(driving)).toBeLessThan(driving.yaw)
  })

  it('corrects proportionally, so a big error moves further than a small one', () => {
    // The property a fixed radians-per-second could not have. It is what lets
    // one number serve both a half-turn recovery and an imperceptible nudge.
    const far = stepCameraYaw({ ...driving, yaw: 0 })
    const near = stepCameraYaw({ ...driving, yaw: driving.facing + Math.PI - 0.4 })
    expect(Math.abs(far - 0)).toBeGreaterThan(
      Math.abs(near - (driving.facing + Math.PI - 0.4)),
    )
  })

  it('leaves the camera alone while the player is aiming it', () => {
    expect(stepCameraYaw({ ...driving, lookingManually: true })).toBe(driving.yaw)
  })

  it('holds a view the player set once they stop driving', () => {
    // Otherwise a camera someone deliberately pointed somewhere creeps back on
    // its own the moment they let go, which reads as the game arguing.
    expect(stepCameraYaw({ ...driving, following: false })).toBe(driving.yaw)
  })

  it('follows a rotation on the spot', () => {
    /*
      The reason the gate is "driving" rather than "moving fast enough".
      Turning in place has no speed at all, and the previous speed gate would
      leave the camera parked on the robot's side through every turn, which is
      most of what would make tank controls feel broken.
    */
    expect(stepCameraYaw({ ...driving, following: true })).not.toBe(driving.yaw)
  })

  it('holds still inside the deadzone', () => {
    const aligned = { ...driving, yaw: driving.facing + Math.PI - 0.02 }
    expect(stepCameraYaw(aligned)).toBe(aligned.yaw)
  })

  it('converges rather than oscillating around the target', () => {
    let yaw = 0
    for (let i = 0; i < 600; i++) yaw = stepCameraYaw({ ...driving, yaw })
    expect(Math.abs(wrapAngle(yaw - (driving.facing + Math.PI)))).toBeLessThan(
      CAMERA.realignDeadzone,
    )
  })

  it('recovers from a half turn in well under a second', () => {
    let yaw = 0
    const target = driving.facing + Math.PI
    let steps = 0
    while (Math.abs(wrapAngle(yaw - target)) > CAMERA.realignDeadzone && steps < 600) {
      yaw = stepCameraYaw({ ...driving, yaw })
      steps++
    }
    expect(steps * DT).toBeLessThan(1)
  })

  it('never turns the long way around the circle', () => {
    // Just past the wrap point from its target. Taking the long path would be a
    // visible whip-pan through the front.
    const yaw = -Math.PI + 0.05
    const next = stepCameraYaw({ ...driving, yaw })
    expect(Math.abs(wrapAngle(next - yaw))).toBeLessThan(Math.PI)
  })
})

describe('tank controls', () => {
  const still = { moveX: 0, moveY: 0, facing: 0, dt: DT }

  it('rotates in place without moving', () => {
    // The rule the whole scheme rests on: left and right turn, and never translate.
    const turning = stepDrive({ ...still, moveX: -1 })
    expect(turning.facing).not.toBe(0)
    // Negated input, so an idle axis arrives as negative zero. Numerically zero,
    // but not zero to Object.is, which is what toBe uses.
    expect(turning.throttle).toBeCloseTo(0, 10)
  })

  it('turns left on left input and right on right', () => {
    // Forward is (sin f, cos f), whose derivative points to its left, so a
    // rising facing is a left turn.
    expect(stepDrive({ ...still, moveX: -1 }).facing).toBeGreaterThan(0)
    expect(stepDrive({ ...still, moveX: 1 }).facing).toBeLessThan(0)
  })

  it('drives along its own facing rather than the camera', () => {
    // A quarter turn from north should point due east.
    const heading = headingVector(Math.PI / 2)
    expect(heading.x).toBeCloseTo(1, 6)
    expect(heading.z).toBeCloseTo(0, 6)
  })

  it('moves forward without turning when only forward is held', () => {
    const forward = stepDrive({ ...still, moveY: -1 })
    expect(forward.facing).toBe(0)
    expect(forward.throttle).toBe(1)
  })

  it('reverses on back input', () => {
    expect(stepDrive({ ...still, moveY: 1 }).throttle).toBe(-1)
  })

  it('combines into an arc when turning and driving together', () => {
    /*
      Neither input is a special case: the heading rotates, the throttle drives
      along it, and a curve is what falls out. Integrated here the way the
      controller does it, so this would catch the two being applied in an order
      that straightens the path back out.
    */
    /*
      Half a second, which is a turn of about 86 degrees. Deliberately not
      longer: run it far enough and the arc doubles back on itself, so the net
      displacement along the starting axis shrinks toward nothing and an
      assertion about it would fail on a perfectly good curve.
    */
    const steps = 30
    let facing = 0
    let x = 0
    let z = 0
    for (let i = 0; i < steps; i++) {
      const step = stepDrive({ moveX: -1, moveY: -1, facing, dt: DT })
      facing = step.facing
      const heading = headingVector(facing)
      x += heading.x * step.throttle * MOVEMENT.maxSpeed * DT
      z += heading.z * step.throttle * MOVEMENT.maxSpeed * DT
    }

    expect(facing).toBeCloseTo(MOVEMENT.turnRate * DT * steps, 5)
    // Travelled a real distance, and along both axes rather than down one,
    // which is what distinguishes an arc from a straight line.
    expect(Math.hypot(x, z)).toBeGreaterThan(2)
    expect(Math.abs(x)).toBeGreaterThan(0.8)
    expect(Math.abs(z)).toBeGreaterThan(0.8)
  })

  it('keeps facing inside a single turn of the circle', () => {
    // Facing feeds trigonometry and a camera target every step, so letting it
    // grow without bound would eventually cost precision.
    let facing = 0
    for (let i = 0; i < 600; i++) facing = stepDrive({ ...still, moveX: -1, facing }).facing
    expect(Math.abs(facing)).toBeLessThanOrEqual(Math.PI + 1e-9)
  })
})
