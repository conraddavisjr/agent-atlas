import { useEffect, useRef } from 'react'

/**
 * One normalised intent object, whatever the source.
 *
 * Nothing downstream should ever know whether movement came from WASD, the arrow
 * keys, or a gamepad. That separation is what lets touch controls drop in later
 * without touching the character controller.
 */
export type InputIntent = {
  /** Raw stick/key direction in screen space, magnitude clamped to 1. */
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

    let x = (held(MOVE_KEYS.right) ? 1 : 0) - (held(MOVE_KEYS.left) ? 1 : 0)
    let y = (held(MOVE_KEYS.back) ? 1 : 0) - (held(MOVE_KEYS.forward) ? 1 : 0)

    let jumpHeld = held(JUMP_KEYS)

    const pads = navigator.getGamepads?.() ?? []
    const pad = pads.find((p) => p !== null)
    if (pad) {
      const gx = applyDeadzone(pad.axes[0] ?? 0)
      const gy = applyDeadzone(pad.axes[1] ?? 0)
      // The stick wins only when actually deflected, so a connected-but-idle pad
      // never suppresses the keyboard.
      if (gx !== 0 || gy !== 0) {
        x = gx
        y = gy
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

    // Normalise so diagonal movement is not faster than cardinal movement.
    const mag = Math.hypot(x, y)
    if (mag > 1) {
      x /= mag
      y /= mag
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
