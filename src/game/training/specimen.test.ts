import { describe, expect, it } from 'vitest'
import {
  FORM_COUNT,
  FORM_CROSS,
  formDwell,
  formStart,
  formWindow,
  FORM_FRAME,
  SPECIMEN_HEIGHT,
  SPECIMEN_WIDTH,
  cycleComplete,
  formCue,
  formOffset,
  formScale,
  litForm,
  specimenRunTime,
  specimenVisible,
  stagePresence,
} from './specimen'
import { VOICE } from '@/audio/voiceManifest'
import { cameraPose } from './cameraDirector'
import { SPECIMEN_AT, dioramaSafeWidth } from './stage'
import { initialTrainingState, type Phase, type TrainingState } from './trainingMachine'

const at = (phase: Phase, elapsed = 0, over: Partial<TrainingState> = {}): TrainingState => ({
  ...initialTrainingState(),
  phase,
  elapsed,
  ...over,
})

/** Every 20 ms over four full passes, which is twelve appearances of each form. */
const SWEEP = Array.from({ length: 4000 }, (_, i) => i * 0.02)
/** Every test below runs against card 0, which is the one with three real forms. */
const CARD = 0

describe('the change-over shows one form at a time', () => {
  it('never draws two forms at once', () => {
    /*
      This is the property that makes the fade cheap AND legible. A true
      cross-dissolve puts two 3.7 m machines through each other at partial alpha,
      which is a muddy frame and a depth-sorting problem in the same moment. The
      outgoing form reaches zero before the incoming one leaves it.
    */
    for (const t of SWEEP) {
      const present = Array.from({ length: FORM_COUNT }, (_, i) => formCue(CARD, i, t).presence).filter(
        (p) => p > 0,
      )
      expect(present.length, `two forms drawn at t=${t.toFixed(2)}`).toBeLessThanOrEqual(1)
    }
  })

  it('opens on a complete first form rather than fading in twice', () => {
    /*
      The stage's own arrival on `dioramaIn` is what fades form 0 in. If its
      window also faded it in, the specimen would arrive, reach full strength and
      immediately dip again - a stutter on the beat that introduces the whole
      teaching act.
    */
    expect(formCue(CARD, 0, 0).presence).toBe(1)
    expect(litForm(CARD, 0)).toBe(0)
  })

  it('fades form 0 in normally on every later pass', () => {
    // By then it is following form 2 rather than following an empty stage.
    const justOpened = specimenRunTime(CARD) + 0.01
    expect(formCue(CARD, 0, justOpened).presence).toBeGreaterThan(0)
    expect(formCue(CARD, 0, justOpened).presence).toBeLessThan(1)
  })

  it('closes the cycle, so the loop has no seam', () => {
    for (const t of [0.4, 1.9, 3.1, 5.2, 7.0]) {
      for (let i = 0; i < FORM_COUNT; i++) {
        const a = formCue(CARD, i, t + specimenRunTime(CARD))
        const b = formCue(CARD, i, t + specimenRunTime(CARD) * 2)
        expect(a.presence, `form ${i} at t=${t}`).toBeCloseTo(b.presence, 9)
        expect(a.local).toBeCloseTo(b.local, 9)
      }
    }
  })
})

describe("each form's own clock restarts every visit", () => {
  it('starts every appearance at the beginning of the animation', () => {
    /*
      **The bug this exists to prevent is subtle and it is exactly this round's
      documented failure shape.**

      A cumulative clock - one that keeps running while a form is off stage - was
      the obvious way to satisfy the old "only ever runs forward" assertion. It
      breaks the retiming silently. `Guessed` holds the stage for 2.5 s and cycles
      in 2.2, so on a cumulative clock its second appearance starts 0.3 s into its
      own cycle, its third 0.6 s in, and before long it arrives ALREADY LOCKED -
      having never shown the fan filling, which is the whole argument of the
      station carrying the paragraph's punchline. Nothing throws. Nothing logs.
    */
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < FORM_COUNT; i++) {
        const opens = pass * specimenRunTime(CARD) + formStart(CARD, i)
        expect(formCue(CARD, i, opens).local, `form ${i}, pass ${pass}`).toBeCloseTo(0, 9)
      }
    }
  })

  it('runs forward for the whole of a visit', () => {
    for (let i = 0; i < FORM_COUNT; i++) {
      let last = -1
      for (let s = 0; s < formDwell(CARD, i); s += 0.01) {
        const cue = formCue(CARD, i, formStart(CARD, i) + s)
        expect(cue.local, `form ${i} went backwards`).toBeGreaterThanOrEqual(last)
        last = cue.local
      }
    }
  })
})

describe('the cadence leaves room to read', () => {
  it('spends most of every beat on a still, readable form', () => {
    for (let i = 0; i < FORM_COUNT; i++) {
      expect(FORM_CROSS, `form ${i}`).toBeLessThan(formDwell(CARD, i) / 4)
    }
  })

  it('finishes a pass inside the time it takes to read the paragraph beside it', () => {
    /*
      The ceiling has moved twice with the pacing - 10 s against three 2.5 s
      frames, 18 against three 5 s ones, and 24 now that each frame lasts as long
      as the clause said over it. What it protects has never changed: a pass that
      outlasts the paragraph beside it leaves the reader waiting on a picture.

      It cannot really do that any more, because the pass IS the paragraph - but
      the assertion stays as a tripwire on the bake. A clause that suddenly takes
      twelve seconds means somebody re-baked at half speed.
    */
    /*
      The ceiling moved with the dwell: it was 10 s against three 2.5 s frames and
      is 18 against three 5 s ones. What it is protecting is unchanged - a pass
      that outlasts the paragraph beside it leaves the reader waiting on a picture
      - and a 300-character card is about 17 s of reading at 200 wpm.
    */
    expect(specimenRunTime(CARD)).toBeLessThan(24)
  })

  it('gives every form time to finish its own argument', () => {
    /*
      **The assertion that would have caught the worst bug in this change.**

      A form is only readable while it is fully present, so the moment that
      carries its claim - the label released, the route completed, the winner
      locked - has to land inside the dwell minus the change-over. `Guessed` used
      to lock at 3.22 s against a 2.05 s window, which meant the fan filled and
      faded away unresolved on every single appearance.
    */
    for (let i = 0; i < FORM_COUNT; i++) {
      expect(FORM_FRAME[i].argueAt, `form ${i} never lands its claim`).toBeLessThanOrEqual(
        formWindow(CARD, i),
      )
    }
  })
})

describe('the forms are drawn at one size, on one base plane, on one centre line', () => {
  it('draws every form inside one box, on both axes', () => {
    /*
      Shown one at a time, three forms at three sizes make the change-over read as
      a zoom rather than as a change - so the scale is derived per form. Equalising
      HEIGHT alone was the first attempt and it traded one size change for another:
      `GUESSED` is short and wide, so matching its height drew it a third wider
      than its neighbours and spilled it across the nameplate. Fitting a box holds
      both axes.
    */
    for (let i = 0; i < FORM_COUNT; i++) {
      const frame = FORM_FRAME[i]
      const scale = formScale(i)
      expect((frame.maxY - frame.minY) * scale, `form ${i} is too tall`).toBeLessThanOrEqual(
        SPECIMEN_HEIGHT + 1e-6,
      )
      expect(frame.width * scale, `form ${i} is too wide`).toBeLessThanOrEqual(
        SPECIMEN_WIDTH + 1e-6,
      )
    }
  })

  it('draws the three at close to one apparent size', () => {
    /*
      Height alone is not the thing an eye reads as size, and neither is width -
      the three have genuinely different proportions, because they were composed
      as three vignettes in a row rather than as one object with three states.
      What has to hold is that none of them reads as a zoom relative to its
      neighbours, so the invariant is the drawn DIAGONAL.

      It currently comes out at 1.20, which is tight. If a future edit pushes it
      past 1.25 the answer is to re-compose the forms rather than to raise this
      number: the spread is a symptom of three drawings that want redrawing.
    */
    const diagonals = FORM_FRAME.map((f, i) =>
      Math.hypot(f.width * formScale(i), (f.maxY - f.minY) * formScale(i)),
    )
    expect(Math.max(...diagonals) / Math.min(...diagonals)).toBeLessThan(1.25)
  })

  it('stands every form on the base plane rather than floating it', () => {
    /*
      **`Guessed` mounts its machine at y 0.36 and nothing it draws starts at
      zero.** Scaling by `maxY` instead of by the extent would have drawn it a
      third shorter than its neighbours with its base hanging most of a metre
      above the nameplate - a size change on every cross-fade, on the form
      carrying the punchline, with nothing failing.
    */
    for (let i = 0; i < FORM_COUNT; i++) {
      const [, offsetY] = formOffset(i)
      const base = FORM_FRAME[i].minY * formScale(i) + offsetY
      expect(base, `form ${i} does not sit on the base plane`).toBeCloseTo(0, 9)
    }
  })

  it('keeps every form on the centre line', () => {
    // Without this the specimen slides 37 cm sideways between forms on a 2.5 s
    // loop, which reads as the model being nudged.
    for (let i = 0; i < FORM_COUNT; i++) {
      const [offsetX] = formOffset(i)
      const centre = FORM_FRAME[i].centreX * formScale(i) + offsetX
      expect(centre, `form ${i} is off centre`).toBeCloseTo(0, 9)
    }
  })

  it('keeps the widest form inside a SQUARE window', () => {
    /*
      The binding constraint on this staging is vertical, not horizontal - fov is
      the VERTICAL field, so a square window and a 21:9 window show the same
      height. This is a ceiling rather than the design driver it used to be, and
      it is checked at aspect 1.0 because that is the narrowest a player presents.
    */
    const pose = cameraPose('reading')
    const safeHalf = dioramaSafeWidth(pose.position[2]) / 2
    const widest = Math.max(...FORM_FRAME.map((f, i) => f.width * formScale(i))) / 2
    expect(widest).toBeLessThan(safeHalf)
  })
})

describe('the stage arrives, swaps and leaves with one gesture', () => {
  it('fades in over the arrival rather than cutting', () => {
    /*
      At the old scale a 3% object appearing on a frame boundary was
      unremarkable. At this one it is a 3.7 m machine popping into the middle of
      a held over-the-shoulder shot - and with the reading camera now at the same
      Z as the speech camera, there is not even a camera move to hide it behind.
    */
    expect(stagePresence(at('dioramaIn', 0))).toBe(0)
    expect(stagePresence(at('dioramaIn', 0.55))).toBeGreaterThan(0)
    expect(stagePresence(at('dioramaIn', 1.1))).toBe(1)
  })

  it('holds the specimen fully present for the whole of the reading', () => {
    expect(stagePresence(at('reading', 0))).toBe(1)
    expect(stagePresence(at('reading', 6))).toBe(1)
  })

  it('fades out from wherever it actually was, not from full', () => {
    /*
      `reading` ends on a keypress and `reading` waits on a person, so the press
      lands anywhere - including inside a change-over with the outgoing form at a
      third of its presence. Fading from a hardcoded 1 would snap the specimen
      back to full and then fade it, on the one beat the player triggered
      themselves, which reads as the button being broken.
    */
    expect(stagePresence(at('swapping', 0), 0.3)).toBeCloseTo(0.3, 9)
    expect(stagePresence(at('cubeIn', 0), 0.3)).toBeCloseTo(0.3, 9)
    expect(stagePresence(at('cubeIn', 0), 1)).toBeCloseTo(1, 9)
  })

  it('comes back up on the far side of a card change', () => {
    const half = FORM_CROSS / 2
    expect(stagePresence(at('swapping', 0.35))).toBe(0)
    expect(stagePresence(at('swapping', 0.35 + half))).toBeCloseTo(1, 6)
  })

  it('puts itself away on cubeIn instead of vanishing on a frame boundary', () => {
    expect(specimenVisible(at('cubeIn', 0))).toBe(true)
    expect(specimenVisible(at('cubeIn', FORM_CROSS))).toBe(false)
    expect(stagePresence(at('cubeIn', FORM_CROSS / 2))).toBe(0)
  })

  it('is off stage for every beat that is not the teaching', () => {
    for (const phase of ['arriving', 'instructorIn', 'speech1', 'question', 'aiming'] as Phase[]) {
      expect(specimenVisible(at(phase)), phase).toBe(false)
    }
  })
})

describe('the camera is aimed at what is actually there', () => {
  it('stands the specimen where the reading pose looks', () => {
    const pose = cameraPose('reading')
    expect(pose.lookAt[0]).toBeCloseTo(SPECIMEN_AT[0], 9)
    expect(pose.lookAt[2]).toBeCloseTo(SPECIMEN_AT[2], 9)
    expect(pose.lookAt[1]).toBeGreaterThan(SPECIMEN_AT[1])
  })

  it('shares one camera Z with the beats either side of it', () => {
    /*
      The whole teaching act is a lift and a re-aim rather than a move, which is
      what makes it calm - and it is also what rules out the headline being left
      behind by a travelling camera, so the sign has to leave under its own power.
    */
    expect(cameraPose('reading').position[2]).toBeCloseTo(cameraPose('speech2').position[2], 9)
    expect(cameraPose('reading').position[2]).toBeCloseTo(cameraPose('dioramaIn').position[2], 9)
  })

  it('keeps the specimen in front of the camera, not behind it', () => {
    expect(cameraPose('reading').position[2]).toBeLessThan(SPECIMEN_AT[2])
  })
})

describe('a card plays once and then asks', () => {
  it('is not finished part way through', () => {
    for (let i = 0; i < FORM_COUNT; i++) {
      expect(cycleComplete(CARD, formStart(CARD, i)), `at the top of form ${i}`).toBe(false)
    }
    expect(cycleComplete(CARD, specimenRunTime(CARD) - 0.01)).toBe(false)
  })

  it('is finished once every form has had its clause said over it', () => {
    /*
      **The loop used to be endless and nobody decided that.** `reading` waits on
      the player, so the exhibit cycled forever with the narration restarting each
      time - a reader who had understood it got no signal they were now watching a
      repeat, and a reader who had missed something had to sit through two more
      forms to get back.
    */
    expect(cycleComplete(CARD, specimenRunTime(CARD))).toBe(true)
    expect(cycleComplete(CARD, specimenRunTime(CARD) + 5)).toBe(true)
  })

  it('ends after the last clause has actually been spoken', () => {
    // Not merely after three dwells: the dwells ARE the clauses, so this is the
    // assertion that the offer cannot appear over a wizard still talking.
    const spoken = VOICE.segments
      .filter((s) => s.card === CARD)
      .reduce((total, s) => total + s.duration, 0)
    expect(specimenRunTime(CARD)).toBeGreaterThan(spoken)
  })

  it('lands the replay back at the very top of the card', () => {
    /*
      Replay writes `elapsed` to zero, and zero has to mean form 0 fully present
      rather than form 0 fading in - otherwise a replay opens with a dip that the
      first play does not have.
    */
    expect(cycleComplete(CARD, 0)).toBe(false)
    expect(formCue(CARD, 0, 0).presence).toBe(1)
    expect(litForm(CARD, 0)).toBe(0)
  })
})
