import { CAMERA, JUMP, MOVEMENT } from './tuning'

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
  return { vy: 0, coyote: 0, buffer: 0 }
}

/**
 * Advances vertical movement by one fixed step.
 *
 * Order matters here and is not arbitrary:
 *   timers -> jump -> variable-height cut -> gravity -> clamp
 * Applying gravity before the jump would eat part of the launch velocity on the
 * frame the jump fires, making jump height depend on where in the step it landed.
 */
export function stepVertical(
  state: VerticalState,
  input: VerticalInput,
): VerticalState & { jumped: boolean } {
  const { grounded, jumpPressed, jumpHeld, dt } = input

  // Coyote time: refreshed while grounded, counted down once airborne, so a jump
  // pressed just after walking off a ledge still works.
  const coyote = grounded ? JUMP.coyoteTime : Math.max(0, state.coyote - dt)

  // Jump buffering: a press is remembered briefly so one arriving just before
  // landing fires on contact rather than being dropped.
  const buffer = jumpPressed ? JUMP.bufferTime : Math.max(0, state.buffer - dt)

  let vy = state.vy
  let nextCoyote = coyote
  let nextBuffer = buffer
  let jumped = false

  if (buffer > 0 && coyote > 0) {
    vy = JUMP.velocity
    jumped = true
    // Both windows are consumed so a single press cannot produce two jumps.
    nextBuffer = 0
    nextCoyote = 0
  }

  const rising = vy > 0

  // Variable jump height: releasing early cuts the climb short, turning one jump
  // into a range of heights.
  if (rising && !jumpHeld && !jumped) {
    vy *= JUMP.cutMultiplier
  }

  // Falling is heavier than rising. True projectile motion feels sluggish in
  // games; the asymmetry is what reads as snappy.
  const gravity = vy > 0 ? JUMP.gravity : JUMP.gravity * JUMP.fallGravityMultiplier
  vy += gravity * dt
  vy = Math.max(vy, JUMP.maxFallSpeed)

  // A small downward bias while grounded keeps the capsule pressed into the
  // surface so Rapier's snap-to-ground has something to work with on slopes.
  if (grounded && vy < 0 && !jumped) {
    vy = -1
  }

  return { vy, coyote: nextCoyote, buffer: nextBuffer, jumped }
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
  /** The direction the character is travelling, as written by the controller. */
  facing: number
  /** Horizontal speed in metres per second. */
  speed: number
  /** True on any frame the player moved the mouse or the right stick. */
  lookingManually: boolean
  dt: number
}

/**
 * One step of the camera swinging back behind the player.
 *
 * Pure and separate from FollowCamera for the same reason the jump rules are:
 * "does dragging the mouse still win while walking" is a question with an exact
 * answer, and answering it by playing the game is slower and less reliable than
 * answering it in a test.
 *
 * Three conditions have to hold before the camera is allowed to move itself.
 * Manual look always wins, because a player who is actively aiming the camera is
 * making a decision the game should not overrule. Below a walking pace the
 * heading is mostly noise, since facing is derived from velocity. And inside the
 * deadzone there is nothing worth correcting, which is what stops the camera
 * wobbling behind someone walking in a straight line.
 */
export function stepCameraYaw(input: RealignInput): number {
  const { yaw, facing, speed, lookingManually, dt } = input

  if (lookingManually) return yaw
  if (speed < CAMERA.realignMinSpeed) return yaw

  /*
    The camera sits behind the player, so the target is the heading turned
    around. The offset in FollowCamera is built from sin(yaw)/cos(yaw), which
    points from the player toward the camera, whereas facing points the way the
    player is going. Half a turn apart.
  */
  const target = facing + Math.PI

  if (Math.abs(wrapAngle(target - yaw)) < CAMERA.realignDeadzone) return yaw

  return approachAngle(yaw, target, CAMERA.realignSpeed * dt)
}
