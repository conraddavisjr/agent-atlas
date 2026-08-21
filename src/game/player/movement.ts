import { AIR_JUMP, CAMERA, JUMP, MOVEMENT } from './tuning'

/**
 * The parts of the character controller that decide how movement FEELS,
 * extracted as pure functions.
 *
 * These deserve to be separate from the component for two reasons. They are the
 * highest-value logic in the milestone, since coyote time, jump buffering and
 * variable jump height are most of what separates a platformer that feels
 * professional from one that does not. And they are the only way to verify that
 * behaviour without a browser: rendering can be eyeballed, but "does a jump
 * pressed 80ms after leaving a ledge still fire" is a question with an exact
 * answer that belongs in a test.
 */

export type VerticalState = {
  /** Vertical velocity in metres per second. */
  vy: number
  /** Remaining coyote window in seconds. */
  coyote: number
  /** Remaining jump-buffer window in seconds. */
  buffer: number
  /**
   * Air jumps still available before touching the ground again.
   *
   * Refilled on landing and NEVER in the air, which is the whole of what stops
   * this from being flight.
   */
  airJumps: number
  /**
   * Seconds of thruster burn left, counting down. Zero means not burning.
   *
   * It is a countdown rather than an elapsed time because everything that reads
   * it wants "how much is left" - gravity wants to know whether to be reduced,
   * and the VFX wants a 1-to-0 ramp it can shape without knowing the duration.
   */
  thrust: number
  /** Seconds since leaving the ground, for `AIR_JUMP.lockout`. Zero while grounded. */
  air: number
}

export type VerticalInput = {
  grounded: boolean
  /** True only on the frame the jump was pressed. */
  jumpPressed: boolean
  /** True for as long as jump is held, which drives variable height. */
  jumpHeld: boolean
  dt: number
}

export function initialVerticalState(): VerticalState {
  return { vy: 0, coyote: 0, buffer: 0, airJumps: AIR_JUMP.count, thrust: 0, air: 0 }
}

/**
 * Advances vertical movement by one fixed step.
 *
 * Order matters here and is not arbitrary:
 *   timers -> ground jump -> air jump -> variable-height cut -> gravity -> clamp
 * Applying gravity before the jump would eat part of the launch velocity on the
 * frame the jump fires, making jump height depend on where in the step it landed.
 *
 * ## Where the air jump sits in that order, and why it is after the ground jump
 *
 * The ground jump is tried first and consumes the buffer when it fires, so a
 * single press can never spend both. That ordering is the entire guard: with the
 * air jump first, a press arriving during coyote time would take an air jump
 * while a perfectly good ground jump was available, and the player would lose the
 * double for the rest of the arc without ever seeing why.
 */
export function stepVertical(
  state: VerticalState,
  input: VerticalInput,
): VerticalState & { jumped: boolean; airJumped: boolean } {
  const { grounded, jumpPressed, jumpHeld, dt } = input

  // Coyote time: refreshed while grounded, counted down once airborne, so a jump
  // pressed just after walking off a ledge still works.
  const coyote = grounded ? JUMP.coyoteTime : Math.max(0, state.coyote - dt)

  // Jump buffering: a press is remembered briefly so one arriving just before
  // landing fires on contact rather than being dropped.
  const buffer = jumpPressed ? JUMP.bufferTime : Math.max(0, state.buffer - dt)

  // Time since leaving the ground, which `AIR_JUMP.lockout` is measured against.
  const air = grounded ? 0 : state.air + dt

  let vy = state.vy
  let nextCoyote = coyote
  let nextBuffer = buffer
  let jumped = false
  let airJumped = false

  /*
    Refilled on landing and never in the air.

    On `grounded` rather than on `jumped`, so walking off a ledge and falling
    without ever jumping still leaves the air jump available - which is what a
    player expects from a move they think of as "the boost" rather than as "the
    second half of a jump".
  */
  let airJumps = grounded ? AIR_JUMP.count : state.airJumps

  let thrust = Math.max(0, state.thrust - dt)

  if (buffer > 0 && coyote > 0) {
    vy = JUMP.velocity
    jumped = true
    // Both windows are consumed so a single press cannot produce two jumps.
    nextBuffer = 0
    nextCoyote = 0
    // A ground jump ends any burn still running from the previous arc, which can
    // happen when a very short hop lands mid-thrust.
    thrust = 0
  } else if (jumpPressed && !grounded && airJumps > 0 && air >= AIR_JUMP.lockout) {
    /*
      `jumpPressed` rather than the buffer, and that asymmetry is deliberate.

      Buffering exists so a press slightly BEFORE landing is not dropped, which
      is a problem the ground jump has and the air jump does not - there is no
      surface to arrive at. Reading the buffer here would instead make a press
      fire twice: once as a buffered ground jump on landing and once in the air on
      the way up, from one keystroke.
    */
    vy = JUMP.velocity * AIR_JUMP.velocityFraction
    airJumped = true
    airJumps -= 1
    thrust = AIR_JUMP.thrustTime
    nextBuffer = 0
  }

  const rising = vy > 0

  // Variable jump height: releasing early cuts the climb short, turning one jump
  // into a range of heights.
  if (rising && !jumpHeld && !jumped && !airJumped) {
    vy *= JUMP.cutMultiplier
  }

  /*
    Falling is heavier than rising. True projectile motion feels sluggish in
    games; the asymmetry is what reads as snappy.

    The thruster burn scales the RISING gravity only. Leaving the fall alone is
    what keeps the descent after the burn identical to the first jump's, so the
    move adds height and hang time without turning the character into a balloon
    on the way down - and it means a burn that outlives the apex stops mattering
    the instant the character starts falling, with no discontinuity to tune.
  */
  const gravity =
    vy > 0
      ? JUMP.gravity * (thrust > 0 ? AIR_JUMP.thrustGravity : 1)
      : JUMP.gravity * JUMP.fallGravityMultiplier
  vy += gravity * dt
  vy = Math.max(vy, JUMP.maxFallSpeed)

  // A small downward bias while grounded keeps the capsule pressed into the
  // surface so Rapier's snap-to-ground has something to work with on slopes.
  if (grounded && vy < 0 && !jumped) {
    vy = -1
  }

  return { vy, coyote: nextCoyote, buffer: nextBuffer, airJumps, thrust, air, jumped, airJumped }
}

/**
 * Advances one horizontal axis toward its target speed.
 *
 * Acceleration and deceleration are deliberately different rates. With equal
 * values the character keeps drifting after input stops, which is the single most
 * common reason movement feels mushy.
 */
export function stepHorizontal(
  current: number,
  target: number,
  hasInput: boolean,
  grounded: boolean,
  dt: number,
): number {
  const rate = hasInput ? MOVEMENT.acceleration : MOVEMENT.deceleration
  const control = grounded ? 1 : MOVEMENT.airControl
  return approach(current, target, rate * control * dt)
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current
  if (Math.abs(diff) <= maxDelta) return target
  return current + Math.sign(diff) * maxDelta
}

/** Angle-aware approach that always turns the short way around. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  if (Math.abs(diff) <= maxDelta) return target
  return current + Math.sign(diff) * maxDelta
}

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export type RealignInput = {
  /** Current camera orbit angle. */
  yaw: number
  /** The direction the robot is pointing, which is now driven straight by input. */
  facing: number
  /**
   * Whether the player is actively driving, by moving or by turning.
   *
   * Turning counts, and that is the point. Under tank controls a rotation on
   * the spot has no speed at all, and gating on speed the way this used to
   * would leave the camera parked on the character's side through every turn.
   */
  following: boolean
  /** True on any frame the player moved the mouse or the right stick. */
  lookingManually: boolean
  dt: number
}

/**
 * One step of the camera swinging back behind the player.
 *
 * Pure and separate from FollowCamera for the same reason the jump rules are:
 * "does dragging the mouse still win while turning" is a question with an exact
 * answer, and answering it by playing the game is slower and less reliable than
 * answering it in a test.
 *
 * Manual look always wins, because a player actively aiming the camera is
 * making a decision the game should not overrule. Otherwise the camera follows
 * whenever the player is driving, and holds still when they are not, so a view
 * someone deliberately set does not creep back on its own.
 *
 * The step is exponential rather than a constant rate, which is the same
 * frame-rate independent damping the camera already uses for its position. A
 * fixed radians-per-second cannot be right at both ends of the range: slow
 * enough that a two degree correction is invisible is far too slow to bring the
 * camera round from half a turn, and fast enough to do that whips the view on
 * every small heading change. Damping is proportional to the error, so it is
 * both at once.
 */
export function stepCameraYaw(input: RealignInput): number {
  const { yaw, facing, following, lookingManually, dt } = input

  if (lookingManually) return yaw
  if (!following) return yaw

  /*
    The camera sits behind the player, so the target is the heading turned
    around. The offset in FollowCamera is built from sin(yaw)/cos(yaw), which
    points from the player toward the camera, whereas facing points the way the
    player is going. Half a turn apart.
  */
  const target = facing + Math.PI
  const error = wrapAngle(target - yaw)

  if (Math.abs(error) < CAMERA.realignDeadzone) return yaw

  return yaw + error * (1 - Math.exp(-CAMERA.realignDamping * dt))
}

export type DriveInput = {
  /** Lateral input, -1 for left. Turns the robot and nothing else. */
  moveX: number
  /** Forward input, -1 for forward. Screen convention, as the input layer emits it. */
  moveY: number
  /** The robot's current heading. */
  facing: number
  dt: number
}

export type DriveResult = {
  /** The new heading after this step's rotation. */
  facing: number
  /**
   * How hard to drive along that heading, from -1 to 1.
   *
   * Kept separate from the heading so the caller can scale it by top speed and
   * hand it to the same acceleration curve everything else uses. Turning does
   * not contribute to it at all, which is the whole rule: left and right rotate
   * and never translate.
   */
  throttle: number
}

/**
 * Tank controls: turn in place, drive along your own facing.
 *
 * Left and right rotate the robot and move it nowhere. Forward and back drive
 * it along wherever it is currently pointing. Held together they produce an arc
 * without either being a special case, which is the reason for doing it this
 * way rather than adding a curve to camera-relative movement.
 *
 * Facing is now authoritative state rather than something derived from
 * velocity. That is the substantive change: a heading read back from velocity
 * can only ever describe where the character has already been, so it cannot be
 * turned on the spot, and it is noisy at low speed.
 *
 * It also removes the problem the previous two rounds were spent on. Direction
 * of travel no longer consults the camera, so realigning the camera cannot
 * change where the player is going, and the feedback loop that made
 * auto-alignment chase its own tail has nowhere to form.
 */
export function stepDrive({ moveX, moveY, facing, dt }: DriveInput): DriveResult {
  /*
    Left is negative moveX and has to increase facing. Forward is
    (sin f, 0, cos f), so its derivative with respect to f is (cos f, 0, -sin f),
    which points to the left of forward. A rising facing therefore swings the
    robot left.
  */
  const next = facing - moveX * MOVEMENT.turnRate * dt

  // The input layer uses screen convention, where forward is negative.
  return { facing: wrapAngle(next), throttle: -moveY }
}

/** The unit heading vector for a facing angle, on the ground plane. */
export function headingVector(facing: number): { x: number; z: number } {
  return { x: Math.sin(facing), z: Math.cos(facing) }
}
