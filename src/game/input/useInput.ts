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

/**
 * Wheel pixels to look pixels.
 *
 * A trackpad scroll delivers far more pixels per gesture than a drag of the same
 * physical distance, so the two need different scales to feel like the same
 * control. Below 1 so that one comfortable two-finger sweep is roughly a quarter
 * turn rather than three full ones.
 */
const WHEEL_LOOK_SCALE = 0.55

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
  const lookScratch = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && (e.target.closest('input, select, textarea, [contenteditable=true]') || ((e.code === 'Space' || e.code === 'Enter') && e.target.closest('button')))) return
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
      if (e.target instanceof Element && e.target.closest('[data-hud]')) return
      // Only orbit while dragging or pointer-locked, so casual mouse movement
      // across the page does not spin the camera.
      if (!pointerLocked.current && e.buttons === 0) return
      intent.current.lookX += e.movementX
      intent.current.lookY += e.movementY
    }

    /**
     * Two-finger scroll orbits, with no button held.
     *
     * This is the trackpad affordance, and it is here instead of pointer lock.
     * A drag is bounded by the size of the pad, so at any sensitivity that does
     * not make a mouse unusable there is a hard limit on how far one gesture can
     * turn the camera - which is the "restricted in movement" half of the
     * complaint. Pointer lock removes that limit but takes the cursor hostage,
     * needs an escape affordance and some UI to explain itself, and would fire on
     * a click that was aimed at the HUD. A wheel gesture has no such limit,
     * because the pad reports deltas rather than positions and a scroll can be
     * repeated indefinitely.
     *
     * `deltaMode` matters: a trackpad reports pixels (mode 0) while a notched
     * mouse wheel reports lines (mode 1) at roughly a 16:1 ratio, so the two are
     * normalised to pixels here rather than in the camera, which should not have
     * to know what kind of device it is reading.
     *
     * `passive: false` and `preventDefault` are both required, or the page
     * scrolls under the canvas while the camera turns.
     */
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-hud]')) return
      e.preventDefault()
      const toPixels = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      intent.current.lookX += e.deltaX * toPixels * WHEEL_LOOK_SCALE
      intent.current.lookY += e.deltaY * toPixels * WHEEL_LOOK_SCALE
    }

    /**
     * A right-drag is a perfectly good orbit gesture and `e.buttons` already
     * accepts it, but without this the native context menu opens on release and
     * eats the rest of the drag.
     */
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    const onPointerLockChange = () => {
      pointerLocked.current = document.pointerLockElement !== null
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('contextmenu', onContextMenu)
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

  /**
   * Clears the one-frame edge flags. Called after the frame has consumed them.
   *
   * **`lookX` and `lookY` are deliberately NOT cleared here, and that is a bug
   * fix rather than an omission.**
   *
   * This runs from `endInputFrame()` at the end of `useBeforePhysicsStep`, which
   * Rapier calls from its own `useFrame` at priority 0 - and `FrameStepper` is
   * rendered as the first child of the physics provider, so it is subscribed
   * before `FollowCamera` and runs before it. The look accumulator's only
   * consumer is `FollowCamera`, which reads it in a later `useFrame`. So every
   * frame in which the physics accumulator took a step, the mouse delta was
   * zeroed before the camera ever saw it.
   *
   * At `timeStep 1/60` on a 60 Hz display that is most frames, which is why
   * dragging felt throttled rather than broken, and why the symptom was
   * refresh-rate dependent: at 120 Hz roughly half the frames survived. The
   * gamepad right stick was worse than throttled and completely dead, because
   * `sample()` adds to it at the START of the same physics step that cleared it,
   * so its contribution never survived a single frame.
   *
   * The look accumulator is now owned by its consumer: `FollowCamera` zeroes it
   * on every frame it runs, including the frames where it declines to use it.
   * That ordering is the one that cannot go wrong, because a value cleared by
   * the thing that reads it cannot be cleared before the read.
   */
  const endFrame = () => {
    intent.current.jumpPressed = false
    intent.current.interactPressed = false
  }

  /**
   * Take the accumulated orbit delta and reset it, returning a reused object.
   *
   * **The look accumulator is owned by its consumer, and that is the fix for a
   * real bug.** It used to be cleared by `endFrame`, which runs at the end of
   * `useBeforePhysicsStep`; Rapier's stepper is subscribed before `FollowCamera`,
   * so on every frame the physics accumulator took a step the delta was zeroed
   * before the camera read it. At 60 Hz that is most frames, which is why
   * dragging felt throttled rather than broken and why the symptom was
   * refresh-rate dependent. The gamepad right stick was not throttled but dead,
   * because `sample()` adds to it inside the same step that cleared it.
   *
   * A value cleared by the thing that reads it cannot be cleared before the read.
   * It lives here rather than in the camera because this hook owns the ref, and
   * mutating a hook argument from a component is both a lint error and the wrong
   * place for it.
   *
   * The returned object is reused, which is safe because the caller reads it
   * immediately and never stores it, and a fresh pair of numbers every frame is
   * garbage at 60 Hz.
   */
  const consumeLook = () => {
    const out = lookScratch.current
    out.x = intent.current.lookX
    out.y = intent.current.lookY
    intent.current.lookX = 0
    intent.current.lookY = 0
    return out
  }

  return { intent, sample, endFrame, consumeLook }
}
