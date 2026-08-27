import { describe, expect, it } from 'vitest'
import { CHOOSE_AT, CYCLE, FILL_AT, FLY_AT, LANDED_AT, guessCue } from './guessCue'
import { FORM_FRAME, formWindow } from './specimen'

/*
  **These exist because of a units bug that a screenshot could not catch.**

  The four moments below are SECONDS. They were once compared against `loop()`,
  which returns a fraction of its period - so `flight` never left zero, the
  winning word never flew into the blank, and the form spent every appearance
  looking like it was still making up its mind. That is a state it genuinely
  passes through, which is why the still frame looked fine.
*/

describe('the guess reaches every one of its moments', () => {
  it('fills, chooses, flies and lands, in that order', () => {
    expect(FILL_AT).toBeLessThan(CHOOSE_AT)
    expect(CHOOSE_AT).toBeLessThan(FLY_AT)
    expect(FLY_AT).toBeLessThan(LANDED_AT)
    expect(LANDED_AT).toBeLessThan(CYCLE)
  })

  it('actually completes the flight, which is the whole form', () => {
    // The assertion that would have caught the units bug outright.
    expect(guessCue(LANDED_AT).flight).toBeCloseTo(1, 6)
    expect(guessCue(CYCLE - 0.01).flight).toBeCloseTo(1, 6)
  })

  it('has not started flying before it has chosen', () => {
    expect(guessCue(FILL_AT).flight).toBe(0)
    expect(guessCue(CHOOSE_AT).flight).toBe(0)
    expect(guessCue(FLY_AT).flight).toBe(0)
  })

  it('fills the bars before it picks one', () => {
    expect(guessCue(FILL_AT).filling).toBe(0)
    expect(guessCue(CHOOSE_AT).filling).toBeCloseTo(1, 6)
  })

  it('sparks only across the moment of choosing', () => {
    expect(guessCue(CHOOSE_AT - 0.01).chosen).toBe(0)
    expect(guessCue(FLY_AT).chosen).toBeCloseTo(1, 6)
  })

  it('never leaves its own range, at any time, including a seeked negative', () => {
    for (let t = -8; t < 3 * CYCLE; t += 0.017) {
      const cue = guessCue(t)
      for (const [name, v] of Object.entries(cue)) {
        expect(v, `${name} at t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(0)
        expect(v, `${name} at t=${t.toFixed(3)}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lands inside the window the form is readable for', () => {
    /*
      `argueAt` is what `specimen.test.ts` checks against the dwell, and for this
      form the claim IS the landing. The two numbers have to agree or the test
      over there is asserting something this file does not do.
    */
    expect(FORM_FRAME[2].argueAt).toBeCloseTo(LANDED_AT, 6)
    expect(LANDED_AT).toBeLessThanOrEqual(formWindow(0, 2))
  })
})
