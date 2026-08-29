import { describe, expect, it } from 'vitest'
import {
  ARROW_DWELL,
  ARROW_PATH,
  ARROW_STEP,
  CHOOSE_AT,
  CYCLE,
  FILL_AT,
  FLY_AT,
  LANDED_AT,
  guessCue,
} from './guessCue'
import { CANDIDATES } from './dioramaCopy'
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
    // `toBeCloseTo`, not `toBe`: `t` comes back through a modulo, so the subtraction
    // at the exact boundary lands on 1.5e-16 rather than on zero.
    expect(guessCue(FILL_AT).filling).toBeCloseTo(0, 9)
    expect(guessCue(CHOOSE_AT).filling).toBeCloseTo(1, 6)
  })

  it('sparks only across the moment of choosing', () => {
    expect(guessCue(CHOOSE_AT - 0.01).chosen).toBe(0)
    expect(guessCue(FLY_AT).chosen).toBeCloseTo(1, 6)
  })

  it('never leaves its own range, at any time, including a seeked negative', () => {
    /*
      The 0-to-1 fields only. `pointingAt` and `stop` are indices and have their
      own bounds, asserted below - sweeping them through this loop is how the
      arrow's arrival got a failing test for the wrong reason.

      Scanned into one assertion rather than four per sample: at 0.017 s over
      three cycles this is a thousand iterations, and `expect()` per field builds
      four matcher objects and four template strings each time. The suite has
      already lost tests to exactly that.
    */
    const bad: string[] = []
    for (let t = -8; t < 3 * CYCLE && bad.length === 0; t += 0.017) {
      const cue = guessCue(t)
      for (const name of ['filling', 'chosen', 'flight', 'travel'] as const) {
        const v = cue[name]
        if (!(v >= 0 && v <= 1)) bad.push(`${name} = ${v} at t=${t.toFixed(3)}`)
      }
    }
    expect(bad, 'a cue left the unit interval').toEqual([])
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

  it('walks every candidate, and has the runway to finish', () => {
    /*
      **The assertion that would have caught the retiming, and did.**

      Seven stops at a dwell plus a step each needs 2.06 s. The window between the
      candidates arriving and the choice being made was 1.25 s, so the arrow would
      have been three words down the list when the winner flew - and an arrow that
      runs out of runway still produces a perfectly plausible still frame.
    */
    const needs = (ARROW_PATH.length - 1) * (ARROW_DWELL + ARROW_STEP) + ARROW_DWELL
    expect(needs, 'the arrow cannot reach the winner before the choice').toBeLessThanOrEqual(
      CHOOSE_AT - FILL_AT,
    )
  })

  it('visits every candidate on the way up', () => {
    // A pointer that skipped one would be saying the machine never considered it.
    for (let rank = 0; rank < CANDIDATES.length; rank++) {
      expect(ARROW_PATH, `rank ${rank} is never pointed at`).toContain(rank)
    }
  })

  it('starts at the least likely word and ends on the winner', () => {
    expect(ARROW_PATH[0]).toBe(CANDIDATES.length - 1)
    expect(ARROW_PATH[ARROW_PATH.length - 1]).toBe(0)
  })

  it('doubles back rather than sliding once', () => {
    /*
      The hesitation IS the claim. `dioramaCopy.ts` gives HIGHNESS a quarter of the
      winner's weight so that there is a real rival to come back to - "a fan whose
      right answer is the only sensible entry teaches that guessing is easy, which
      is the opposite of what the paragraph says".
    */
    let descents = 0
    for (let i = 1; i < ARROW_PATH.length; i++) {
      if (ARROW_PATH[i] > ARROW_PATH[i - 1]) descents += 1
    }
    expect(descents, 'the arrow only ever climbs, so it describes a ranking').toBeGreaterThan(0)
  })

  it('is resting on the winner by the time the choice is made', () => {
    const at = guessCue(CHOOSE_AT)
    expect(at.pointingAt).toBe(0)
    expect(at.travel).toBe(0)
  })

  it('reports a stop that identifies a place on the path, not just a rank', () => {
    /*
      The path doubles back, so a rank appears more than once and cannot say where
      on the walk the arrow is. Resolving "what comes next" from the rank instead
      returned the later occurrence and the arrow stopped doubling back at all.
    */
    const beat = ARROW_DWELL + ARROW_STEP
    const seen = new Set<number>()
    for (let i = 0; i < ARROW_PATH.length; i++) {
      const cue = guessCue(FILL_AT + i * beat + 0.01)
      expect(cue.stop, `stop ${i}`).toBe(i)
      expect(cue.pointingAt).toBe(ARROW_PATH[i])
      seen.add(cue.stop)
    }
    expect(seen.size).toBe(ARROW_PATH.length)
  })

  it('never points outside the list', () => {
    for (let t = -3; t < 2 * CYCLE; t += 0.013) {
      const cue = guessCue(t)
      expect(cue.pointingAt).toBeGreaterThanOrEqual(-1)
      expect(cue.pointingAt).toBeLessThan(CANDIDATES.length)
      expect(cue.travel).toBeGreaterThanOrEqual(0)
      expect(cue.travel).toBeLessThanOrEqual(1)
    }
  })
})
