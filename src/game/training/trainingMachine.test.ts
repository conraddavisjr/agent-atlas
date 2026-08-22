import { describe, expect, it } from 'vitest'
import {
  CARD_COUNT,
  DURATIONS,
  PHASES,
  canAdvance,
  initialTrainingState,
  isAiming,
  readingProgress,
  stepTraining,
  type Phase,
  type TrainingInput,
  type TrainingState,
} from './trainingMachine'

const DT = 1 / 60
const NOTHING: TrainingInput = { advance: false, bail: false, hit: null, correct: 1 }

/** Run frames with constant input until the phase changes or we give up. */
function until(state: TrainingState, input: Partial<TrainingInput> = {}, maxFrames = 1200) {
  let s = state
  for (let i = 0; i < maxFrames; i++) {
    const next = stepTraining(s, { ...NOTHING, ...input }, DT)
    if (next.phase !== s.phase) return next
    s = next
  }
  return s
}

/**
 * Drive the round forward to a named phase, pressing advance whenever it helps.
 *
 * The shot it fires is chosen by the TARGET rather than passed in, because the
 * two quiz outcomes are reached by opposite inputs and a caller sweeping every
 * phase should not have to know that. `rejecting` needs a miss; everything past
 * it needs a hit.
 */
function reach(phase: Phase, input: Partial<TrainingInput> = {}): TrainingState {
  const shot = phase === 'rejecting' ? { hit: 0, correct: 1 } : { hit: 1, correct: 1 }
  let s = initialTrainingState()
  for (let i = 0; i < 6000; i++) {
    if (s.phase === phase) return s
    s = stepTraining(s, { ...NOTHING, ...shot, ...input, advance: canAdvance(s) }, DT)
  }
  throw new Error(`never reached ${phase}, stuck in ${s.phase}`)
}

describe('the round runs all the way through on its own', () => {
  it('reaches every phase from a standing start', () => {
    /*
      The whole point of a machine over a pile of timers: that the sequence is
      reachable end to end is a question with an exact answer.

      `rejecting` is excluded because it needs a wrong answer, and `exiting` is
      reached by the celebration - both are covered below.
    */
    for (const phase of PHASES) {
      if (phase === 'rejecting') continue
      expect(() => reach(phase), phase).not.toThrow()
    }
  })

  it('outlasts the iris before the instructor moves', () => {
    /*
      `TRANSITION.irisOpenMs` is 420 ms. A wizard that flies in behind a closed
      iris has flown in for nobody, and the failure is invisible in a still frame
      because by the time anyone screenshots it the iris is open and the wizard is
      already in place.
    */
    expect(DURATIONS.arriving).toBeGreaterThan(0.42)
  })

  it('never leaves a timed phase without a rule to leave it by', () => {
    // A phase with no duration and no input rule hangs the round forever, and the
    // symptom is a player standing in a scene where nothing happens.
    const waits: Phase[] = ['reading', 'aiming', 'exiting']
    for (const phase of PHASES) {
      if (waits.includes(phase)) continue
      expect(DURATIONS[phase], `${phase} has no duration`).toBeGreaterThan(0)
    }
  })
})

describe('escape', () => {
  it('leaves from every single phase', () => {
    /*
      From EVERY phase, including ones the player is unlikely to press it in.
      "Unlikely" is how a soft lock ships: the one phase nobody tested is the one
      where a stray keypress traps someone in a scene with no exit.
    */
    for (const phase of PHASES) {
      const s = reach(phase)
      const out = stepTraining(s, { ...NOTHING, bail: true }, DT)
      expect(out.phase, `bail from ${phase}`).toBe('exiting')
    }
  })

  it('keeps a win that was already earned', () => {
    /*
      `won` latches when the arrow lands, not when the confetti finishes. A player
      who hits the answer and immediately mashes Escape has answered correctly and
      should keep it - the celebration is the reward, not the condition.
    */
    let s = reach('aiming')
    s = stepTraining(s, { ...NOTHING, hit: 1, correct: 1 }, DT)
    expect(s.won).toBe(true)
    const out = stepTraining(s, { ...NOTHING, bail: true }, DT)
    expect(out.phase).toBe('exiting')
    expect(out.won).toBe(true)
  })

  it('does not invent a win that was not earned', () => {
    const s = reach('reading')
    const out = stepTraining(s, { ...NOTHING, bail: true }, DT)
    expect(out.won).toBe(false)
  })
})

describe('exiting is a trap state, which is the reentrancy guard', () => {
  it('cannot be left by time, by input, or by a hit', () => {
    /*
      `useSceneTravel.travel()` refuses a second request SILENTLY - `if
      (inFlight.current) return`, no promise, no callback - so a round that asked
      to leave twice would have one request vanish with nothing reporting it.

      Winning and pressing Escape within a frame of each other is not a
      hypothetical: the win is what the player was reaching for and Escape is what
      they mash. The guard lives in the machine so that no caller can forget it.
    */
    const s = reach('exiting')
    expect(s.phase).toBe('exiting')

    const inputs: Partial<TrainingInput>[] = [
      {},
      { advance: true },
      { bail: true },
      { hit: 1, correct: 1 },
      { hit: 0, correct: 1 },
      { advance: true, bail: true, hit: 2, correct: 1 },
    ]
    for (const input of inputs) {
      let after = s
      for (let i = 0; i < 600; i++) after = stepTraining(after, { ...NOTHING, ...input }, DT)
      expect(after.phase, JSON.stringify(input)).toBe('exiting')
    }
  })

  it('is reached exactly once by a clean win', () => {
    // Counting entries rather than checking the end state, because the bug this
    // guards against is a SECOND entry, not a missing one.
    let s = reach('celebrating')
    let entries = 0
    for (let i = 0; i < 600; i++) {
      const next = stepTraining(s, NOTHING, DT)
      if (next.phase === 'exiting' && s.phase !== 'exiting') entries += 1
      s = next
    }
    expect(entries).toBe(1)
  })
})

describe('the reading', () => {
  it('shows every card, in order, and only advances on a press', () => {
    let s = reach('reading')
    expect(s.card).toBe(0)

    // Time alone does nothing. Reading is not on a clock.
    let waited = s
    for (let i = 0; i < 600; i++) waited = stepTraining(waited, NOTHING, DT)
    expect(waited.phase).toBe('reading')
    expect(waited.card).toBe(0)

    for (let card = 1; card < CARD_COUNT; card++) {
      s = stepTraining(s, { ...NOTHING, advance: true }, DT)
      expect(s.phase).toBe('turning')
      s = until(s)
      expect(s.phase).toBe('reading')
      expect(s.card).toBe(card)
    }
  })

  it('increments the card on the TURN, not on the press', () => {
    /*
      The cube's rotation is driven from `card`, so incrementing it on the press
      would snap the face over before the animation that is supposed to reveal it
      had run - the turn would be showing the face it had already turned to.
    */
    const s = reach('reading')
    const pressed = stepTraining(s, { ...NOTHING, advance: true }, DT)
    expect(pressed.phase).toBe('turning')
    expect(pressed.card).toBe(s.card)
  })

  it('goes to the quiz after the last card rather than off the end', () => {
    let s = reach('reading')
    for (let i = 0; i < CARD_COUNT; i++) {
      s = stepTraining(s, { ...NOTHING, advance: true }, DT)
      s = until(s)
    }
    expect(s.phase).toBe('arming')
    expect(s.card).toBe(CARD_COUNT)
  })

  it('fills the progress bar at the quiz, not at the last card', () => {
    // A full bar on the last card says the round is over when it is not.
    const first = reach('reading')
    expect(readingProgress(first)).toBe(0)
    expect(readingProgress(reach('arming'))).toBe(1)
  })
})

describe('the quiz', () => {
  it('sends a wrong answer back to aiming and costs only a shot', () => {
    const s = reach('aiming')
    const wrong = stepTraining(s, { ...NOTHING, hit: 0, correct: 1 }, DT)
    expect(wrong.phase).toBe('rejecting')
    expect(wrong.shots).toBe(1)
    expect(wrong.won).toBe(false)

    const back = until(wrong)
    expect(back.phase).toBe('aiming')
    expect(back.lastHit).toBeNull()
  })

  it('gives unlimited tries, which is the point of the round', () => {
    /*
      A quiz that can be failed by someone who understood the material but cannot
      aim a bow is testing the wrong thing. Twenty misses, still aiming.
    */
    let s = reach('aiming')
    for (let i = 0; i < 20; i++) {
      s = stepTraining(s, { ...NOTHING, hit: 2, correct: 1 }, DT)
      expect(s.phase).toBe('rejecting')
      s = until(s)
      expect(s.phase).toBe('aiming')
    }
    expect(s.shots).toBe(20)
    expect(s.won).toBe(false)
  })

  it('takes only one shot per frame and only while aiming', () => {
    // The pointer hook can fire more than once between frames; the machine is what
    // makes that harmless.
    const s = reach('arming')
    const during = stepTraining(s, { ...NOTHING, hit: 1, correct: 1 }, DT)
    expect(during.shots).toBe(0)
    expect(during.won).toBe(false)
  })

  it('accepts the right plank once and latches the win', () => {
    let s = reach('aiming')
    s = stepTraining(s, { ...NOTHING, hit: 1, correct: 1 }, DT)
    expect(s.phase).toBe('accepting')
    expect(s.won).toBe(true)
    expect(s.lastHit).toBe(1)

    // Another hit during the flip changes nothing.
    const again = stepTraining(s, { ...NOTHING, hit: 0, correct: 1 }, DT)
    expect(again.shots).toBe(s.shots)
    expect(again.won).toBe(true)
  })

  it('only reports aiming during the one phase that takes a shot', () => {
    for (const phase of PHASES) {
      const s = reach(phase)
      expect(isAiming(s), phase).toBe(phase === 'aiming')
    }
  })
})

describe('elapsed', () => {
  it('resets on every transition, so no phase inherits the last one\'s clock', () => {
    // The camera director reads `elapsed` to ease between poses. A phase that
    // started with a non-zero clock would begin its move part-way through.
    let s = initialTrainingState()
    for (let i = 0; i < 4000; i++) {
      const next = stepTraining(s, { ...NOTHING, advance: canAdvance(s), hit: 1, correct: 1 }, DT)
      if (next.phase !== s.phase) expect(next.elapsed, `entering ${next.phase}`).toBe(0)
      s = next
    }
  })
})
