import { describe, it, expect } from 'vitest'
import {
  CONFIRM_MIN_MS,
  CONFIRM_TIMEOUT_MS,
  IDLE,
  isArmed,
  press,
  type ConfirmState,
} from './confirmGate'

/** Long enough to be a decision, short enough to be inside the window. */
const DELIBERATE = CONFIRM_MIN_MS + 100

const armedAt = (t: number, id = 'reset-progress'): ConfirmState => ({ armed: id, armedAt: t })

describe('confirm gate', () => {
  it('never fires on a single press', () => {
    const first = press(IDLE, 'reset-progress', 1000)
    expect(first.fire).toBe(false)
    expect(first.next).toEqual({ armed: 'reset-progress', armedAt: 1000 })
  })

  it('fires on a deliberate second press', () => {
    const armed = press(IDLE, 'reset-progress', 1000).next
    const second = press(armed, 'reset-progress', 1000 + DELIBERATE)
    expect(second.fire).toBe(true)
    // Disarmed afterwards, so a third press starts the gate over rather than
    // firing again.
    expect(second.next).toEqual(IDLE)
    expect(press(second.next, 'reset-progress', 2000).fire).toBe(false)
  })

  it('ignores the second half of a double click', () => {
    // The whole reason a two-press gate is not automatically safe: one gesture,
    // two clicks, tens of milliseconds apart.
    const armed = armedAt(1000)
    const doubleClick = press(armed, 'reset-progress', 1040)
    expect(doubleClick.fire).toBe(false)
    // Still armed, and the clock is NOT restarted by the swallowed press, so the
    // deliberate press that follows is measured from the original arm.
    expect(doubleClick.next).toBe(armed)
    expect(press(doubleClick.next, 'reset-progress', 1000 + DELIBERATE).fire).toBe(true)
  })

  it('re-arms rather than firing once the window has passed', () => {
    const armed = armedAt(1000)
    const late = press(armed, 'reset-progress', 1000 + CONFIRM_TIMEOUT_MS + 1)
    expect(late.fire).toBe(false)
    expect(late.next.armedAt).toBe(1000 + CONFIRM_TIMEOUT_MS + 1)
  })

  it('fires on the last millisecond of the window', () => {
    expect(press(armedAt(1000), 'reset-progress', 1000 + CONFIRM_TIMEOUT_MS).fire).toBe(true)
  })

  it('will not let one action confirm another', () => {
    const armed = armedAt(1000, 'reset-progress')
    const other = press(armed, 'wipe-cosmetics', 1000 + DELIBERATE)
    expect(other.fire).toBe(false)
    expect(other.next).toEqual({ armed: 'wipe-cosmetics', armedAt: 1000 + DELIBERATE })
  })

  it('reports which action is showing its confirm label', () => {
    expect(isArmed(IDLE, 'reset-progress')).toBe(false)
    expect(isArmed(armedAt(1000), 'reset-progress')).toBe(true)
    expect(isArmed(armedAt(1000), 'something-else')).toBe(false)
  })

  it('can show a stale label but can never fire on one', () => {
    // The label is state-only so that render stays pure, which means a throttled
    // background tab can leave "Confirm" on screen past the window. Pressing it
    // must re-arm rather than fire, or the timeout would be decorative.
    const expired = armedAt(1000)
    expect(isArmed(expired, 'reset-progress')).toBe(true)
    expect(press(expired, 'reset-progress', 1000 + CONFIRM_TIMEOUT_MS + 1).fire).toBe(false)
  })
})
