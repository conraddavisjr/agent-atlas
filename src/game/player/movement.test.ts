import { describe, it, expect } from 'vitest'
import {
  approach,
  approachAngle,
  initialVerticalState,
  stepCameraYaw,
  stepHorizontal,
  stepInputYaw,
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
  /** A player walking due north at full tilt, with the camera off to one side. */
  const walking = {
    yaw: 0,
    facing: Math.PI / 2,
    speed: MOVEMENT.maxSpeed,
    lookingManually: false,
    dt: DT,
  }

  it('swings toward the position behind the player', () => {
    const next = stepCameraYaw(walking)
    // The target is facing + pi. Starting at 0 and needing to reach 3pi/2, the
    // short way around is downward through negative yaw.
    expect(next).toBeLessThan(walking.yaw)
  })

  it('corrects proportionally, so a big error moves further than a small one', () => {
    // The property a fixed radians-per-second could not have. It is what lets
    // one number serve both a half-turn recovery and an imperceptible nudge.
    const far = stepCameraYaw({ ...walking, yaw: 0 })
    const near = stepCameraYaw({ ...walking, yaw: walking.facing + Math.PI - 0.4 })
    expect(Math.abs(far - 0)).toBeGreaterThan(
      Math.abs(near - (walking.facing + Math.PI - 0.4)),
    )
  })

  it('leaves the camera alone while the player is aiming it', () => {
    expect(stepCameraYaw({ ...walking, lookingManually: true })).toBe(walking.yaw)
  })

  it('resumes the moment manual look stops, with no cooldown', () => {
    // The frame after a drag ends is an ordinary frame. This is the whole of
    // "as soon as they move again the camera follows".
    const during = stepCameraYaw({ ...walking, lookingManually: true })
    const after = stepCameraYaw({ ...walking, yaw: during, lookingManually: false })
    expect(after).not.toBe(during)
  })

  it('ignores heading below a walking pace', () => {
    // Facing is derived from velocity, so at a standstill it is noise.
    const crawling = { ...walking, speed: CAMERA.realignMinSpeed - 0.01 }
    expect(stepCameraYaw(crawling)).toBe(walking.yaw)
  })

  it('holds still inside the deadzone', () => {
    const aligned = { ...walking, yaw: walking.facing + Math.PI - 0.02 }
    expect(stepCameraYaw(aligned)).toBe(aligned.yaw)
  })

  it('converges rather than oscillating around the target', () => {
    let yaw = 0
    for (let i = 0; i < 600; i++) {
      yaw = stepCameraYaw({ ...walking, yaw })
    }
    // Ends up behind the player and stays there.
    expect(Math.abs(wrapAngle(yaw - (walking.facing + Math.PI)))).toBeLessThan(
      CAMERA.realignDeadzone,
    )
  })

  it('recovers from a half turn in well under a second', () => {
    // The case the whole redesign exists for: the player turns to walk toward
    // the camera. A fixed rate slow enough to be invisible at small angles took
    // roughly two seconds to do this, which is what read as the camera trailing.
    let yaw = 0
    const target = walking.facing + Math.PI
    let steps = 0
    while (Math.abs(wrapAngle(yaw - target)) > CAMERA.realignDeadzone && steps < 600) {
      yaw = stepCameraYaw({ ...walking, yaw })
      steps++
    }
    expect(steps * DT).toBeLessThan(1)
  })

  it('never turns the long way around the circle', () => {
    // Camera just past the wrap point from its target. The short path crosses
    // pi; taking the long path would be a visible whip-pan through the front.
    const yaw = -Math.PI + 0.05
    const next = stepCameraYaw({ ...walking, facing: Math.PI / 2, yaw })
    // A step of at most half the remaining error, taken the short way, can never
    // exceed the error itself.
    expect(Math.abs(wrapAngle(next - yaw))).toBeLessThan(Math.PI)
  })
})

describe('movement input frame', () => {
  const held = {
    inputYaw: 1,
    cameraYaw: 2,
    hasMoveInput: true,
    manualLookDelta: 0,
  }

  it('re-syncs to the camera when no direction is held', () => {
    expect(stepInputYaw({ ...held, hasMoveInput: false })).toBe(held.cameraYaw)
  })

  it('ignores where the camera has moved to while a direction is held', () => {
    // The heart of the fix. The camera realigning must not turn the direction
    // the player is walking, or the correction moves its own target and the
    // error never closes.
    expect(stepInputYaw({ ...held, cameraYaw: 99 })).toBe(held.inputYaw)
  })

  it('follows a manual drag even while a direction is held', () => {
    // Aiming the camera is also choosing which way forward points, so this one
    // does have to feed through.
    expect(stepInputYaw({ ...held, manualLookDelta: 0.25 })).toBeCloseTo(1.25, 6)
  })

  it('lets the camera converge on a player walking toward it', () => {
    /*
      The regression test for the bug this replaced. Holding back means the
      heading sits exactly half a turn from the camera. Resolving input against
      the live camera made that a fixed point the correction could never escape,
      because every degree the camera gained it immediately gave back.
    */
    let cameraYaw = 0
    let inputYaw = 0

    for (let i = 0; i < 600; i++) {
      // "Back" is the input frame's forward, reversed: the player walks toward
      // where the camera was when they pressed the key.
      const facing = wrapAngle(inputYaw)
      cameraYaw = stepCameraYaw({
        yaw: cameraYaw,
        facing,
        speed: MOVEMENT.maxSpeed,
        lookingManually: false,
        dt: DT,
      })
      inputYaw = stepInputYaw({
        inputYaw,
        cameraYaw,
        hasMoveInput: true,
        manualLookDelta: 0,
      })
    }

    // The camera ends up behind the player rather than stuck opposite them.
    expect(Math.abs(wrapAngle(cameraYaw - Math.PI))).toBeLessThan(CAMERA.realignDeadzone)
    // And the direction of travel never moved while the key was held.
    expect(inputYaw).toBe(0)
  })
})
