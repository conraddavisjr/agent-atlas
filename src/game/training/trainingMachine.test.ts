import { describe, expect, it } from 'vitest'
import {
  CARD_COUNT,
  DURATIONS,
  PHASES,
  SHOT_CADENCE,
  canAdvance,
  initialTrainingState,
  isAiming,
  isQuestionUp,
  readingProgress,
  stepTraining,
  type Phase,
  type TrainingInput,
  type TrainingState,
} from './trainingMachine'

const DT = 1 / 60
const NOTHING: TrainingInput = { advance: false, bail: false, shot: false, hit: null, correct: 1 }

/** A loose at a plank, or into open space when `hit` is null. */
const loose = (hit: number | null): Partial<TrainingInput> => ({ shot: true, hit })

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
 * quiz outcomes are reached by opposite inputs and a caller sweeping every phase
 * should not have to know that. `rejecting` and `reloading` are only reachable
 * from a WRONG answer - a right one goes to `accepting` and never comes back to
 * the bow - and everything past them needs a hit.
 */
function reach(phase: Phase, input: Partial<TrainingInput> = {}): TrainingState {
  const missing = phase === 'rejecting' || phase === 'reloading'
  const shot = { shot: true, hit: missing ? 0 : 1 }
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
      `won` latches when the arrow is LOOSED, not when the confetti finishes. A
      player who hits the answer and immediately mashes Escape has answered
      correctly and should keep it - the celebration is the reward, not the
      condition, and neither is the third of a second the arrow spends in the air.
    */
    let s = reach('aiming')
    s = stepTraining(s, { ...NOTHING, ...loose(1) }, DT)
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

  it('gives the QUESTION a beat of its own before the bow', () => {
    /*
      The quiz face used to go straight from `turning` to `arming`, which meant
      the question had to stay legible for the whole of the shooting. It cannot:
      the shooting is first person, and from the player's own eye there is
      nowhere to put a 2.1 m cube that is not in front of the targets.

      So the last face is a reading card like the two before it, with its own
      press. This walks the whole reading and checks it lands on the question
      rather than on the bow.
    */
    let s = reach('reading')
    for (let i = 0; i < CARD_COUNT; i++) {
      s = stepTraining(s, { ...NOTHING, advance: true }, DT)
      s = until(s)
    }
    expect(s.phase).toBe('reading')
    expect(s.card).toBe(CARD_COUNT)
    expect(isQuestionUp(s.phase, s.card)).toBe(true)

    // And only THEN the bow.
    expect(stepTraining(s, { ...NOTHING, advance: true }, DT).phase).toBe('arming')
  })

  it('does not turn the cube past its last face', () => {
    // A fifth turn would rotate the quiz away and present the blank spare.
    const s = reach('reading', { advance: false })
    let last = s
    for (let i = 0; i < CARD_COUNT + 3; i++) {
      last = stepTraining(last, { ...NOTHING, advance: true }, DT)
      last = until(last)
    }
    expect(last.card).toBeLessThanOrEqual(CARD_COUNT)
  })

  it('fills the progress bar at the quiz, not at the last card', () => {
    // A full bar on the last card says the round is over when it is not.
    const first = reach('reading')
    expect(readingProgress(first)).toBe(0)
    expect(readingProgress(reach('arming'))).toBe(1)
  })
})

describe('the quiz', () => {
  it('flies the arrow before it judges the shot', () => {
    /*
      `firing` between the loose and the verdict is what gives the arrow a
      flight. Without it the plank flipped on the same frame the pointer went
      down, which read as the plank reacting to the CLICK rather than to
      anything hitting it.
    */
    const s = reach('aiming')
    const loosed = stepTraining(s, { ...NOTHING, ...loose(0) }, DT)
    expect(loosed.phase).toBe('firing')
    expect(loosed.shots).toBe(1)
    expect(loosed.lastHit).toBe(0)

    const landed = until(loosed)
    expect(landed.phase).toBe('rejecting')
  })

  it('sends a wrong answer through the reload and back to aiming', () => {
    let s = stepTraining(reach('aiming'), { ...NOTHING, ...loose(0) }, DT)
    s = until(s)
    expect(s.phase).toBe('rejecting')
    expect(s.won).toBe(false)

    s = until(s)
    expect(s.phase).toBe('reloading')
    /*
      `lastHit` survives the flip and is only cleared by the reload, because the
      stuck plunger is drawn from it - clearing it earlier makes the arrow vanish
      while the player is still looking at where it landed.
    */
    expect(s.lastHit).toBe(0)

    s = until(s)
    expect(s.phase).toBe('aiming')
    expect(s.lastHit).toBeNull()
    expect(s.shots).toBe(1)
  })

  it('animates a MISS into open space instead of ignoring it', () => {
    /*
      A miss used to cost nothing and produce nothing - the bow stayed drawn while
      the player clicked - which made a near miss indistinguishable from a click
      the game had not noticed. It is a shot: it flies, and it costs the reload.
    */
    const s = reach('aiming')
    const loosed = stepTraining(s, { ...NOTHING, ...loose(null) }, DT)
    expect(loosed.phase).toBe('firing')
    expect(loosed.shots).toBe(1)
    expect(loosed.lastHit).toBeNull()

    const landed = until(loosed)
    // Nothing to flip, so straight to the reload.
    expect(landed.phase).toBe('reloading')
    expect(until(landed).phase).toBe('aiming')
  })

  it('rate-limits the shooting to the cadence the brief asked for', () => {
    /*
      Roughly one shot a second, and it is enforced by the PHASES rather than by a
      cooldown - `aiming` is the only phase that takes a shot and the only way
      back to it runs through `firing` and `reloading`. This pins the arithmetic
      so a retune has to move `SHOT_CADENCE` rather than drift into it.
    */
    expect(SHOT_CADENCE).toBeCloseTo(1, 6)

    let s = reach('aiming')
    let elapsed = 0
    s = stepTraining(s, { ...NOTHING, ...loose(null) }, DT)
    for (let i = 0; i < 600; i++) {
      if (s.phase === 'aiming') break
      s = stepTraining(s, NOTHING, DT)
      elapsed += DT
    }
    expect(s.phase).toBe('aiming')
    expect(elapsed).toBeGreaterThanOrEqual(SHOT_CADENCE - DT * 2)
    expect(elapsed).toBeLessThan(SHOT_CADENCE + DT * 4)
  })

  it('gives unlimited tries, which is the point of the round', () => {
    /*
      A quiz that can be failed by someone who understood the material but cannot
      aim a bow is testing the wrong thing. Twenty misses, still aiming.
    */
    let s = reach('aiming')
    for (let i = 0; i < 20; i++) {
      s = stepTraining(s, { ...NOTHING, ...loose(2) }, DT)
      expect(s.phase).toBe('firing')
      s = until(s)
      expect(s.phase).toBe('rejecting')
      s = until(s)
      expect(s.phase).toBe('reloading')
      s = until(s)
      expect(s.phase).toBe('aiming')
    }
    expect(s.shots).toBe(20)
    expect(s.won).toBe(false)
  })

  it('takes only one shot per frame and only while aiming', () => {
    // The pointer hook can fire more than once between frames; the machine is what
    // makes that harmless.
    for (const phase of PHASES) {
      if (phase === 'aiming') continue
      const s = reach(phase)
      const during = stepTraining(s, { ...NOTHING, ...loose(1) }, DT)
      expect(during.shots, phase).toBe(s.shots)
    }
  })

  it('latches the win on the LOOSE, not on the landing', () => {
    /*
      The arrow is in the air for a third of a second. A player who hits the
      answer and immediately reaches for Escape - which is what a player who
      thinks they are done does - would lose the completion inside that window if
      the win were recorded on impact.
    */
    let s = reach('aiming')
    s = stepTraining(s, { ...NOTHING, ...loose(1) }, DT)
    expect(s.phase).toBe('firing')
    expect(s.won).toBe(true)
    expect(s.lastHit).toBe(1)

    // Escaping mid-flight keeps it.
    expect(stepTraining(s, { ...NOTHING, bail: true }, DT).won).toBe(true)

    s = until(s)
    expect(s.phase).toBe('accepting')

    // Another hit during the flip changes nothing.
    const again = stepTraining(s, { ...NOTHING, ...loose(0) }, DT)
    expect(again.shots).toBe(s.shots)
    expect(again.won).toBe(true)
  })

  it('never reloads after a win, because there is nothing left to shoot', () => {
    let s = stepTraining(reach('aiming'), { ...NOTHING, ...loose(1) }, DT)
    for (let i = 0; i < 900; i++) {
      s = stepTraining(s, NOTHING, DT)
      expect(s.phase, 'a won round went back to the bow').not.toBe('reloading')
      if (s.phase === 'exiting') break
    }
    expect(s.phase).toBe('exiting')
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
