/**
 * The shared state behind the iris transition.
 *
 * A mutable module singleton rather than React state, because two things need
 * to agree at 60Hz: where the character is on screen, which only the render
 * loop inside the Canvas knows, and how far open the iris is, which only the
 * scene phase machine outside the Canvas knows. Routing either through React
 * would re-render the entire scene tree every frame of every transition.
 *
 * Only IrisTracker writes the transform to the DOM. Everything else here is
 * bookkeeping so that it can.
 */

export type IrisHandle = {
  /** The overlay element, registered by Transition on mount. */
  el: HTMLElement | null
  /** Last known character position in CSS pixels. */
  x: number
  y: number

  /** Tween endpoints, where 0 is fully covered and 1 is fully open. */
  from: number
  to: number
  startedAt: number
  durationMs: number

  /** Current eased openness, published so the phase machine can read it back. */
  openness: number
}

export const iris: IrisHandle = {
  el: null,
  // Centre of the viewport is the only sensible position before the first
  // projection lands. It is used for at most one frame, and only on a cold load
  // where the character does not exist yet.
  x: typeof window === 'undefined' ? 0 : window.innerWidth / 2,
  y: typeof window === 'undefined' ? 0 : window.innerHeight / 2,

  from: 0,
  to: 0,
  startedAt: 0,
  durationMs: 0,

  openness: 0,
}

/**
 * Start a tween toward `to`.
 *
 * Starts from the current eased value rather than from `from`, so a transition
 * interrupted midway continues from where it actually is instead of snapping.
 */
export function tweenIris(to: number, durationMs: number) {
  iris.from = iris.openness
  iris.to = to
  iris.durationMs = durationMs
  iris.startedAt = performance.now()
}

/** Jump straight to a value with no tween. Used to seed the initial state. */
export function setIris(value: number) {
  iris.from = value
  iris.to = value
  iris.openness = value
  iris.durationMs = 0
  iris.startedAt = performance.now()
}

/** Smooth at both ends, so neither the collapse nor the reveal starts abruptly. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Advance the tween and return the current openness.
 *
 * Driven by wall clock rather than by accumulated frame deltas so that a stall
 * during a scene load cannot leave the iris permanently behind.
 */
export function advanceIris(now: number): number {
  if (iris.durationMs <= 0) {
    iris.openness = iris.to
    return iris.openness
  }
  const t = Math.min(1, (now - iris.startedAt) / iris.durationMs)
  iris.openness = iris.from + (iris.to - iris.from) * easeInOutCubic(t)
  return iris.openness
}

/**
 * The radius, in pixels, that covers the whole viewport from a given point.
 *
 * Measured to the furthest corner rather than to the screen diagonal, because
 * the iris is centred on the character, who is rarely centred on the screen.
 * Using half the diagonal leaves an uncovered wedge whenever they are not.
 */
export function radiusToCover(x: number, y: number): number {
  const w = window.innerWidth
  const h = window.innerHeight
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(w - x, y),
    Math.hypot(x, h - y),
    Math.hypot(w - x, h - y),
  )
}
