import { describe, expect, it } from 'vitest'
import { clampStick, foldKeyAxes } from './inputAxes'

const NONE = { left: false, right: false, forward: false, back: false }

describe('foldKeyAxes', () => {
  it('is zero with nothing held', () => {
    expect(foldKeyAxes(NONE)).toEqual({ x: 0, y: 0 })
  })

  it('maps forward to negative y, matching screen convention', () => {
    expect(foldKeyAxes({ ...NONE, forward: true })).toEqual({ x: 0, y: -1 })
    expect(foldKeyAxes({ ...NONE, back: true })).toEqual({ x: 0, y: 1 })
  })

  it('maps left to negative x and right to positive', () => {
    expect(foldKeyAxes({ ...NONE, left: true })).toEqual({ x: -1, y: 0 })
    expect(foldKeyAxes({ ...NONE, right: true })).toEqual({ x: 1, y: 0 })
  })

  it('cancels opposing keys on the same axis', () => {
    expect(foldKeyAxes({ ...NONE, left: true, right: true })).toEqual({ x: 0, y: 0 })
    expect(foldKeyAxes({ ...NONE, forward: true, back: true })).toEqual({ x: 0, y: 0 })
  })

  /*
    The regression test for the bug this file was extracted to fix.

    Turning while driving must not slow the drive down, and driving while turning
    must not slow the turn down. A circular clamp across the pair gave 0.707 on
    each, so pressing a second key made the first key do less.
  */
  it('keeps full throttle and full turn when both are held', () => {
    const both = foldKeyAxes({ ...NONE, forward: true, right: true })
    const forwardOnly = foldKeyAxes({ ...NONE, forward: true })
    const rightOnly = foldKeyAxes({ ...NONE, right: true })

    expect(both.y).toBe(forwardOnly.y)
    expect(both.x).toBe(rightOnly.x)
    expect(both).toEqual({ x: 1, y: -1 })
  })

  it('holds full magnitude on every diagonal, not just the forward one', () => {
    for (const forward of [true, false]) {
      for (const left of [true, false]) {
        const axes = foldKeyAxes({ ...NONE, forward, back: !forward, left, right: !left })
        expect(Math.abs(axes.x)).toBe(1)
        expect(Math.abs(axes.y)).toBe(1)
      }
    }
  })
})

describe('clampStick', () => {
  it('leaves partial deflection untouched, so a light push stays light', () => {
    expect(clampStick(0.3, -0.4)).toEqual({ x: 0.3, y: -0.4 })
  })

  it('leaves a stick already on the unit circle alone', () => {
    const { x, y } = clampStick(1, 0)
    expect(x).toBe(1)
    expect(y).toBe(0)
  })

  /*
    A physical stick can read past 1 on a diagonal, and unlike the keyboard it
    genuinely is a vector, so its magnitude has to be capped.
  */
  it('clamps an over-deflected diagonal back onto the unit circle', () => {
    const { x, y } = clampStick(1, 1)
    expect(Math.hypot(x, y)).toBeCloseTo(1, 10)
    expect(x).toBeCloseTo(Math.SQRT1_2, 10)
    expect(y).toBeCloseTo(Math.SQRT1_2, 10)
  })

  it('preserves direction while clamping', () => {
    const { x, y } = clampStick(3, 4)
    expect(x).toBeCloseTo(0.6, 10)
    expect(y).toBeCloseTo(0.8, 10)
  })

  it('handles a resting stick without dividing by zero', () => {
    expect(clampStick(0, 0)).toEqual({ x: 0, y: 0 })
  })
})
