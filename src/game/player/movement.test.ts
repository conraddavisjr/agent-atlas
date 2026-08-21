import { describe, it, expect } from 'vitest'
import type { VerticalState } from './movement'
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
import { AIR_JUMP, CAMERA, JUMP, MOVEMENT } from './tuning'

const DT = 1 / 60

/** Runs n steps with constant input, returning the final state. */
function run(
  state = initialVerticalState(),
  steps: number,
  input: { grounded: boolean; jumpPressed?: boolean; jumpHeld?: boolean },
) {
  let s = { ...state, jumped: false, airJumped: false }
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
    let s = { ...run(initialVerticalState(), 1, { grounded: true }), jumped: false, airJumped: false }
    expect(s.coyote).toBeCloseTo(JUMP.coyoteTime)

    // Airborne for 3 steps (50ms), still inside the 100ms window.
    s = run(s, 3, { grounded: false })
    expect(s.coyote).toBeGreaterThan(0)

    const jump = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(jump.jumped).toBe(true)
  })

  it('refuses a GROUND jump once the window has expired, and gives an air jump instead', () => {
    let s = { ...run(initialVerticalState(), 1, { grounded: true }), jumped: false, airJumped: false }
    // 10 steps is ~167ms, comfortably past the 100ms window.
    s = run(s, 10, { grounded: false })
    expect(s.coyote).toBe(0)

    const jump = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(jump.jumped).toBe(false)
    /*
      This assertion is new and it is the point of renaming the test. Before the
      double jump a press past the coyote window did nothing at all, and "jumped
      is false" was the whole story. It now does something - it spends the air
      jump - so a test that only checked `jumped` would keep passing while
      describing behaviour the game no longer has.
    */
    expect(jump.airJumped).toBe(true)
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
    s = { ...run(s, 2, { grounded: false, jumpHeld: true }), jumped: false, airJumped: false }
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
    s = { ...run(s, 10, { grounded: false, jumpHeld: true }), jumped: false, airJumped: false }
    expect(s.buffer).toBe(0)

    const landing = stepVertical(s, {
      grounded: true, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    expect(landing.jumped).toBe(false)
  })
})

/**
 * A `VerticalState` from the fields a test actually cares about.
 *
 * Added when the state grew `airJumps`, `thrust` and `air` for the double jump,
 * and it is worth having for its own sake: every partial literal in this file was
 * a place a new field would break a test that had nothing to do with it, which
 * is friction that discourages adding state rather than encouraging it.
 */
const state = (over: Partial<VerticalState> = {}): VerticalState => ({
  ...initialVerticalState(),
  ...over,
})

describe('variable jump height', () => {
  it('reaches a lower apex when the button is released early', () => {
    const apex = (holdSteps: number) => {
      let s = { ...stepVertical(initialVerticalState(), {
        grounded: true, jumpPressed: true, jumpHeld: true, dt: DT,
      }), jumped: false, airJumped: false }
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
    const rising = stepVertical(state({ vy: 5 }), {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    const falling = stepVertical(state({ vy: -5 }), {
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

  it('does not tax the throttle for also turning', () => {
    /*
      The companion to the fold test in `input/inputAxes.test.ts`, asserted here
      at the layer the player actually feels.

      The input layer used to normalise the two axes onto the unit circle, which
      is correct when they are the components of one direction vector and wrong
      when one is a turn rate and the other a throttle. The visible symptom was
      that adding a turn slowed the drive to 70%, so pressing a second key made
      the first key do less.
    */
    const forwardOnly = stepDrive({ ...still, moveY: -1 })
    const forwardAndTurning = stepDrive({ ...still, moveX: 1, moveY: -1 })

    expect(forwardAndTurning.throttle).toBe(forwardOnly.throttle)
    expect(forwardAndTurning.facing).toBe(stepDrive({ ...still, moveX: 1 }).facing)
  })

  it('holds full speed all the way around a turning circle', () => {
    /*
      Integrated rather than asserted per step, because the thing being protected
      is a property of the path: at full throttle and full turn the robot traces
      a circle of radius maxSpeed / turnRate at top speed, and it never slows
      into the corner.
    */
    const steps = 60
    let facing = 0
    let x = 0
    let z = 0
    for (let i = 0; i < steps; i++) {
      const step = stepDrive({ moveX: 1, moveY: -1, facing, dt: DT })
      facing = step.facing
      const heading = headingVector(facing)
      const speed = Math.abs(step.throttle) * MOVEMENT.maxSpeed
      expect(speed).toBeCloseTo(MOVEMENT.maxSpeed, 10)
      x += heading.x * step.throttle * MOVEMENT.maxSpeed * DT
      z += heading.z * step.throttle * MOVEMENT.maxSpeed * DT
    }

    // A second of turning at 3 rad/s is most of a full circle, and the chord
    // across it should land near the diameter rather than near zero.
    const radius = MOVEMENT.maxSpeed / MOVEMENT.turnRate
    expect(Math.hypot(x, z)).toBeLessThan(radius * 2 + 1e-6)
    expect(Math.hypot(x, z)).toBeGreaterThan(radius)
  })

  it('keeps facing inside a single turn of the circle', () => {
    // Facing feeds trigonometry and a camera target every step, so letting it
    // grow without bound would eventually cost precision.
    let facing = 0
    for (let i = 0; i < 600; i++) facing = stepDrive({ ...still, moveX: -1, facing }).facing
    expect(Math.abs(facing)).toBeLessThanOrEqual(Math.PI + 1e-9)
  })
})

/**
 * The look accumulator's ownership, which is a frame-ordering property and was
 * wrong for the whole life of the project.
 *
 * `intent.lookX` used to be cleared by `endInputFrame()`, called at the end of
 * `useBeforePhysicsStep`. Rapier's `FrameStepper` is rendered as the first child
 * of the physics provider, so it subscribes to `useFrame` before `FollowCamera`
 * and runs before it at the same priority. So on every frame the physics
 * accumulator took a step - most frames, at a 1/60 timestep on a 60 Hz display -
 * the mouse delta was zeroed before the camera ever read it, and the gamepad
 * right stick never survived a single frame because `sample()` added to it inside
 * the same step.
 *
 * Nothing caught it. It is not a wrong value, it is a value that was correct and
 * then destroyed by something scheduled between the write and the read, so every
 * unit test of every function involved passed. These assert the contract that
 * replaced it: the input layer clears the accumulator only when its consumer asks
 * for it, and `endFrame` must not touch it.
 */
describe('the look accumulator is owned by its consumer', () => {
  /** The two functions under test, without React: the same three lines they run. */
  const makeIntent = () => ({ lookX: 0, lookY: 0, jumpPressed: false, interactPressed: false })

  const endFrame = (intent: ReturnType<typeof makeIntent>) => {
    intent.jumpPressed = false
    intent.interactPressed = false
  }

  const consumeLook = (intent: ReturnType<typeof makeIntent>) => {
    const out = { x: intent.lookX, y: intent.lookY }
    intent.lookX = 0
    intent.lookY = 0
    return out
  }

  it('survives an end-of-frame sweep, which is the bug', () => {
    const intent = makeIntent()
    intent.lookX = 42
    intent.lookY = -7
    // This is the call that used to happen inside the physics step, before the
    // camera ran. It must no longer touch the orbit delta.
    endFrame(intent)
    expect(intent.lookX).toBe(42)
    expect(intent.lookY).toBe(-7)
  })

  it('still clears the one-frame edge flags it does own', () => {
    const intent = makeIntent()
    intent.jumpPressed = true
    intent.interactPressed = true
    endFrame(intent)
    expect(intent.jumpPressed).toBe(false)
    expect(intent.interactPressed).toBe(false)
  })

  it('is drained by the consumer, so one drag is applied exactly once', () => {
    const intent = makeIntent()
    intent.lookX = 10
    expect(consumeLook(intent).x).toBe(10)
    // A second read in the same frame, or a frame with no input, must be zero.
    // Without this the camera would keep spinning after the hand stopped.
    expect(consumeLook(intent).x).toBe(0)
  })

  it('accumulates across a frame that the consumer did not run', () => {
    // Several mousemove events between two frames must sum rather than replace,
    // which is what makes the delta framerate-independent.
    const intent = makeIntent()
    intent.lookX += 4
    intent.lookX += 6
    endFrame(intent)
    expect(consumeLook(intent).x).toBe(10)
  })
})

/**
 * The manual-orbit hold, which is the difference between a camera you can aim
 * and one that argues with you.
 */
describe('manual orbit suppresses realignment for a whole hold, not one frame', () => {
  const driving = { yaw: 0, facing: 0, following: true, dt: 1 / 60, lookingManually: false }

  it('does not realign while the hold is live', () => {
    expect(stepCameraYaw({ ...driving, lookingManually: true })).toBe(driving.yaw)
  })

  it('the hold outlasts a pause in a drag', () => {
    /*
      The realign spring has a 126 ms half-life, so a suppression that lasted one
      frame gave back 8.8% of the manual orbit on the first frame a mousemove did
      not arrive. `CAMERA.manualHold` has to be long enough that a hand pausing
      mid-gesture does not lose the shot.
    */
    expect(CAMERA.manualHold).toBeGreaterThan(20 * driving.dt)
  })

  it('keeps the camera above its own look target at full pitch-down', () => {
    /*
      The reason `minPitch` is derived rather than chosen. Below
      `asin(-height / distance)` the camera drops under its look target, the
      collision ray aims down into the ground, and the pull-in collapses distance
      to `minDistance` - so looking at the character's face snapped the camera
      into it. This is the constraint, asserted directly.
    */
    const offsetY = CAMERA.height + Math.sin(CAMERA.minPitch) * CAMERA.distance
    expect(offsetY).toBeGreaterThan(0)
  })
})


describe('the second jump, and the two things the brief asks it for', () => {
  /**
   * Runs a whole arc from a standing jump and reports what it did.
   *
   * `airJumpAt` is a step index, or null for a single jump. The arc ends when the
   * character comes back down through its launch height, which is the honest
   * definition of airtime for a move whose whole point is to extend it.
   */
  const arc = (airJumpAt: number | null) => {
    let s = { ...stepVertical(initialVerticalState(), {
      grounded: true, jumpPressed: true, jumpHeld: true, dt: DT,
    }), jumped: false, airJumped: false }

    let height = 0
    let apex = 0
    let airtime = DT
    let burned = 0

    for (let i = 0; i < 400; i++) {
      s = stepVertical(s, {
        grounded: false,
        jumpPressed: i === airJumpAt,
        jumpHeld: true,
        dt: DT,
      })
      height += s.vy * DT
      apex = Math.max(apex, height)
      airtime += DT
      if (s.thrust > 0) burned += DT
      if (height <= 0) break
    }
    return { apex, airtime, burned }
  }

  it('goes higher AND stays up longer, which is the whole brief', () => {
    /*
      "cause them to move up higher and prolong their air time in their jump."
      Two claims, and they are separable: an impulse alone raises the apex and a
      gravity cut alone extends the hang. Asserting both is what stops a future
      tuning pass from trading one away without noticing.

      The air jump is taken near the apex of the first, which is where a player
      naturally presses.
    */
    const single = arc(null)
    const doubled = arc(20)

    expect(doubled.apex).toBeGreaterThan(single.apex)
    expect(doubled.airtime).toBeGreaterThan(single.airtime)

    // And by a margin worth having. A second jump that adds five per cent is a
    // bug report waiting to happen, not a mechanic.
    expect(doubled.apex).toBeGreaterThan(single.apex * 1.4)
    expect(doubled.airtime).toBeGreaterThan(single.airtime * 1.25)
  })

  it('burns for the authored time and no longer', () => {
    const doubled = arc(20)
    // Sampled at DT, so it lands within one step of the authored duration.
    expect(doubled.burned).toBeGreaterThan(AIR_JUMP.thrustTime - DT * 2)
    expect(doubled.burned).toBeLessThan(AIR_JUMP.thrustTime + DT * 2)
  })

  it('gives the same result wherever in the arc it is pressed, by SETTING velocity', () => {
    /*
      The failure this prevents is the one players describe as "sometimes it does
      not work". If the second jump ADDED to the current velocity, a press on the
      way up would be worth more than a press on the way down from the same
      button, and the difference would be largest exactly where players actually
      press - around the apex, where velocity crosses zero.

      Pressed on the rise and pressed well into the fall, the peak velocity
      reached after the press is identical.
    */
    const peakAfter = (at: number) => {
      let s = { ...stepVertical(initialVerticalState(), {
        grounded: true, jumpPressed: true, jumpHeld: true, dt: DT,
      }), jumped: false, airJumped: false }
      let peak = -Infinity
      for (let i = 0; i < 120; i++) {
        s = stepVertical(s, { grounded: false, jumpPressed: i === at, jumpHeld: true, dt: DT })
        if (i >= at) peak = Math.max(peak, s.vy)
      }
      return peak
    }
    expect(peakAfter(15)).toBeCloseTo(peakAfter(45), 10)
  })
})

describe('the second jump cannot become flight', () => {
  const airborne = (over: Partial<VerticalState> = {}) =>
    state({ air: AIR_JUMP.lockout + 1, ...over })

  it('spends exactly the authored number of air jumps before touching down', () => {
    let s = { ...airborne(), jumped: false, airJumped: false }
    let taken = 0
    // Press on every one of sixty airborne steps. A player mashing the key is the
    // input this has to survive.
    for (let i = 0; i < 60; i++) {
      s = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
      if (s.airJumped) taken += 1
    }
    expect(taken).toBe(AIR_JUMP.count)
  })

  it('refills on LANDING rather than on jumping', () => {
    /*
      On `grounded`, so walking off a ledge and falling without ever jumping still
      leaves the air jump available - which is what a player expects from a move
      they think of as "the boost" rather than as "the second half of a jump".
    */
    let s = { ...airborne({ airJumps: 0 }), jumped: false, airJumped: false }
    expect(stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT }).airJumped)
      .toBe(false)

    s = { ...stepVertical(s, { grounded: true, jumpPressed: false, jumpHeld: false, dt: DT }),
      jumped: false, airJumped: false }
    expect(s.airJumps).toBe(AIR_JUMP.count)
  })

  it('is available after walking off a ledge without jumping at all', () => {
    let s = { ...run(initialVerticalState(), 1, { grounded: true }), jumped: false, airJumped: false }
    // Long enough for the coyote window to lapse, so this cannot be a ground jump.
    s = run(s, 20, { grounded: false })
    expect(s.coyote).toBe(0)
    const jump = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(jump.airJumped).toBe(true)
  })

  it('refuses a press inside the lockout, so a double tap cannot eat both jumps', () => {
    /*
      The mirror of coyote time. That one forgives a press slightly too late; this
      one forgives a press slightly too early by making it impossible rather than
      wasteful - a fast double tap would otherwise spend the air jump three frames
      after takeoff, and the player would get one slightly higher jump instead of
      two and no indication why.
    */
    const s = { ...state({ air: AIR_JUMP.lockout * 0.5 }), jumped: false, airJumped: false }
    expect(stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT }).airJumped)
      .toBe(false)
    const past = { ...state({ air: AIR_JUMP.lockout + 0.001 }), jumped: false, airJumped: false }
    expect(stepVertical(past, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT }).airJumped)
      .toBe(true)
  })

  it('never spends a ground jump and an air jump on one press', () => {
    /*
      The ordering guard. A press arriving during coyote time has a perfectly good
      ground jump available, and if the air branch ran first it would take the air
      jump instead and the player would lose the double for the rest of the arc.
    */
    const s = { ...state({ coyote: JUMP.coyoteTime, air: AIR_JUMP.lockout + 1 }),
      jumped: false, airJumped: false }
    const out = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: true, dt: DT })
    expect(out.jumped).toBe(true)
    expect(out.airJumped).toBe(false)
    expect(out.airJumps).toBe(AIR_JUMP.count)
  })
})

describe('the thruster burn touches the rise and leaves the fall alone', () => {
  it('reduces gravity while rising and burning', () => {
    const burning = stepVertical(state({ vy: 5, thrust: 0.2 }), {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    const plain = stepVertical(state({ vy: 5, thrust: 0 }), {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    expect(burning.vy).toBeGreaterThan(plain.vy)
  })

  it('leaves the fall exactly as heavy as it was', () => {
    /*
      Deliberate, and the reason the burn scales the rising gravity only: the
      descent after the boost stays the same snappy fall the first jump has, so
      the move adds height and hang without turning the character into a balloon
      on the way down. It also means a burn that outlives the apex stops mattering
      the instant the character starts falling, with no discontinuity to tune.
    */
    const burning = stepVertical(state({ vy: -5, thrust: 0.2 }), {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    const plain = stepVertical(state({ vy: -5, thrust: 0 }), {
      grounded: false, jumpPressed: false, jumpHeld: true, dt: DT,
    })
    expect(burning.vy).toBeCloseTo(plain.vy, 12)
  })

  it('does not let the variable-height cut eat the boost on the frame it fires', () => {
    // A player who taps rather than holds still gets the full second jump on the
    // frame it fires, exactly as the ground jump does.
    const s = state({ air: AIR_JUMP.lockout + 1, vy: 1 })
    const out = stepVertical(s, { grounded: false, jumpPressed: true, jumpHeld: false, dt: DT })
    expect(out.airJumped).toBe(true)
    expect(out.vy).toBeGreaterThan(JUMP.velocity * AIR_JUMP.velocityFraction * 0.9)
  })
})
