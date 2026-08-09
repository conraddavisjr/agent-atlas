import { useEffect, useRef } from 'react'
import { clampStick, foldKeyAxes } from './inputAxes'

/**
 * One normalised intent object, whatever the source.
 *
 * Nothing downstream should ever know whether movement came from WASD, the arrow
 * keys, or a gamepad. That separation is what lets touch controls drop in later
 * without touching the character controller.
 */
export type InputIntent = {
  /**
   * Tank axes in screen convention, each independently in [-1, 1].
   *
   * `moveX` is a turn rate, positive to the right; `moveY` is a throttle,
   * negative forward. They are deliberately not normalised against each other.
   * See `inputAxes.ts` for why.
   */
  moveX: number
  moveY: number
  /** True on the frame jump was pressed. Consumed by the controller. */
  jumpPressed: boolean
  /** True while jump is held, which drives variable jump height. */
  jumpHeld: boolean
  /** True on the frame interact was pressed. */
  interactPressed: boolean
  /** Camera orbit delta for this frame, already sensitivity-scaled at the source. */
  lookX: number
  lookY: number
}

const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const

const JUMP_KEYS = ['Space']
const INTERACT_KEYS = ['KeyE', 'Enter']

/** Gamepad sticks never rest at exactly zero, so anything under this is noise. */
const STICK_DEADZONE = 0.18

function applyDeadzone(value: number) {
  if (Math.abs(value) < STICK_DEADZONE) return 0
  // Rescale so movement starts smoothly from the edge of the deadzone rather than
  // snapping to a jump in speed the instant the threshold is crossed.
  const sign = Math.sign(value)
  return sign * ((Math.abs(value) - STICK_DEADZONE) / (1 - STICK_DEADZONE))
}

/**
 * Returns a stable ref holding the current intent.
 *
 * A ref rather than state on purpose: input changes every frame, and putting it
 * in React state would re-render the entire scene tree sixty times a second.
 */
export function useInput() {
  const intent = useRef<InputIntent>({
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    interactPressed: false,
    lookX: 0,
    lookY: 0,
  })

  const keys = useRef(new Set<string>())
  const pointerLocked = useRef(false)
  const prevGamepad = useRef({ jump: false, interact: false })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Space scrolls the page by default, which would fight the jump.
      if (JUMP_KEYS.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault()
      if (keys.current.has(e.code)) return // ignore auto-repeat
      keys.current.add(e.code)
      if (JUMP_KEYS.includes(e.code)) intent.current.jumpPressed = true
      if (INTERACT_KEYS.includes(e.code)) intent.current.interactPressed = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
    }

    /**
     * Releasing focus must clear held keys. Otherwise alt-tabbing while walking
     * leaves the robot running forever, which is a classic and very visible bug.
     */
    const onBlur = () => {
      keys.current.clear()
      intent.current.moveX = 0
      intent.current.moveY = 0
      intent.current.jumpHeld = false
    }

    const onMouseMove = (e: MouseEvent) => {
      // Only orbit while dragging or pointer-locked, so casual mouse movement
      // across the page does not spin the camera.
      if (!pointerLocked.current && e.buttons === 0) return
      intent.current.lookX += e.movementX
      intent.current.lookY += e.movementY
    }

    const onPointerLockChange = () => {
      pointerLocked.current = document.pointerLockElement !== null
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
    }
  }, [])

  /**
   * Folds keyboard and gamepad into the intent. Called once per frame by the
   * controller, before the intent is read.
   */
  const sample = () => {
    const k = keys.current
    const held = (codes: readonly string[]) => codes.some((c) => k.has(c))

    const keyAxes = foldKeyAxes({
      left: held(MOVE_KEYS.left),
      right: held(MOVE_KEYS.right),
      forward: held(MOVE_KEYS.forward),
      back: held(MOVE_KEYS.back),
    })
    let x = keyAxes.x
    let y = keyAxes.y

    let jumpHeld = held(JUMP_KEYS)

    const pads = navigator.getGamepads?.() ?? []
    const pad = pads.find((p) => p !== null)
    if (pad) {
      // A stick, unlike the keys, really is a 2D vector, so it is the one input
      // whose magnitude has to be clamped to the unit circle.
      const stick = clampStick(
        applyDeadzone(pad.axes[0] ?? 0),
        applyDeadzone(pad.axes[1] ?? 0),
      )
      // The stick wins only when actually deflected, so a connected-but-idle pad
      // never suppresses the keyboard.
      if (stick.x !== 0 || stick.y !== 0) {
        x = stick.x
        y = stick.y
      }

      const padJump = pad.buttons[0]?.pressed ?? false
      if (padJump && !prevGamepad.current.jump) intent.current.jumpPressed = true
      prevGamepad.current.jump = padJump
      jumpHeld = jumpHeld || padJump

      const padInteract = pad.buttons[2]?.pressed ?? false
      if (padInteract && !prevGamepad.current.interact) intent.current.interactPressed = true
      prevGamepad.current.interact = padInteract

      intent.current.lookX += applyDeadzone(pad.axes[2] ?? 0) * 12
      intent.current.lookY += applyDeadzone(pad.axes[3] ?? 0) * 12
    }

    intent.current.moveX = x
    intent.current.moveY = y
    intent.current.jumpHeld = jumpHeld
  }

  /** Clears the one-frame edge flags. Called after the frame has consumed them. */
  const endFrame = () => {
    intent.current.jumpPressed = false
    intent.current.interactPressed = false
    intent.current.lookX = 0
    intent.current.lookY = 0
  }

  return { intent, sample, endFrame }
}
