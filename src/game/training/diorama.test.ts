import { describe, expect, it } from 'vitest'
import { GLOW } from '@/art/materials'
import {
  headlineLift,
  headlineVisible,
  loop,
  stationGlow,
  stationLift,
} from './diorama'
import {
  CAPTION_LIMIT,
  CARD_0_STATIONS,
  CARD_1_STATIONS,
  CARD_STATIONS,
  LABEL_LIMIT,
} from './dioramaCopy'
import { FORM_COUNT } from './specimen'
import { cameraPose } from './cameraDirector'
import {
  HEADLINE_AT,
  HEADLINE_AWAY_Y,
  HEADLINE_SIZE,
  SPECIMEN_AT,
  WORD_PITCH,
  dioramaSafeWidth,
  stationX,
} from './stage'
import { initialTrainingState, type Phase, type TrainingState } from './trainingMachine'

const at = (phase: Phase, elapsed = 0): TrainingState => ({
  ...initialTrainingState(),
  phase,
  elapsed,
})

describe('the glow ladder and the lit word', () => {
  it('stays off the bloom tier at both ends', () => {
    /*
      `00-art-bible.md` reserves tier A for ally blue and reward gold - "nothing in
      the environment is allowed in" - and an illustration is environment however
      much it would like to be feedback. The specimen got eight times larger in
      this change, which makes it the object most able to flood the frame if this
      ever slips.
    */
    for (const lit of [0, 0.5, 1]) {
      expect(stationGlow(lit)).toBeGreaterThanOrEqual(GLOW.hold)
      expect(stationGlow(lit)).toBeLessThanOrEqual(GLOW.source)
    }
    expect(GLOW.source).toBeLessThan(GLOW.bloom)
  })

  it('lifts the lit key word clear of its two neighbours', () => {
    expect(stationLift(0)).toBe(0)
    expect(stationLift(1)).toBeGreaterThan(0)
    expect(stationLift(0.5)).toBeGreaterThan(stationLift(0))
  })
})

describe('the loop helper', () => {
  it('stays inside 0 and 1 for any input, including negative time', () => {
    /*
      `%` on a negative left operand returns a negative in JavaScript, and a book
      at -0.3 along a belt is a book behind the camera. A seeked round can hand
      this a negative.
    */
    for (const t of [-9.3, -0.1, 0, 0.4, 7, 1e6]) {
      const v = loop(t, 2.5, 0.3)
      expect(v, `t ${t}`).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('staggers a set into a queue rather than a pulse', () => {
    const count = 5
    const at = Array.from({ length: count }, (_, i) => loop(0, 3, i / count))
    expect(new Set(at).size, 'the set moved together').toBe(count)
  })

  it('refuses a period that would divide by zero', () => {
    expect(() => loop(1, 0)).toThrow(/positive period/)
  })
})

describe('the nameplate fits the frame it is shown in', () => {
  const pose = cameraPose('reading')
  const safeHalf = dioramaSafeWidth(pose.position[2]) / 2

  it('keeps the whole word row inside a SQUARE window', () => {
    /*
      The row is the one thing left on this stage whose constraint is horizontal.
      Measured at aspect 1.0 because that is the narrowest a player can present,
      and a row sized against a wide window is a row whose outer two words are
      cropped on a laptop in a split screen - which looks correct on the machine
      it was built on, every time.

      The longest word either card can put here is `CORRECTED`, nine characters,
      about 1.25 m at the row's own size.
    */
    const LONGEST_HALF_WIDTH = 1.25 / 2
    for (let index = 0; index < FORM_COUNT; index++) {
      const outer = Math.abs(stationX(index, WORD_PITCH)) + LONGEST_HALF_WIDTH
      expect(outer, `word ${index} is cropped`).toBeLessThan(safeHalf)
    }
  })

  it('leaves a real gutter between neighbouring words', () => {
    // Two words that touch read as one long word with a kerning fault.
    const LONGEST = 1.25
    expect(WORD_PITCH - LONGEST).toBeGreaterThan(0.25)
  })

  it('puts word ONE on the left of the SCREEN', () => {
    /*
      `+X` is screen left here, because the camera sits at negative Z looking
      toward positive Z. That inversion has caught this feature out five times -
      the headline rendered mirrored, the cube opened on the quiz face, all three
      plank verdicts showed before a shot, the hat's tip flopped out of sight, and
      the moustache curled the wrong way. The word row inherits the same function
      and therefore the same test.
    */
    expect(pose.position[2]).toBeLessThan(SPECIMEN_AT[2])
    expect(stationX(0, WORD_PITCH)).toBeGreaterThan(stationX(1, WORD_PITCH))
    expect(stationX(1, WORD_PITCH)).toBeGreaterThan(stationX(2, WORD_PITCH))
    expect(stationX(1, WORD_PITCH)).toBeCloseTo(0, 9)
  })
})

describe('the headline leaves when its job is done', () => {
  it('stands low for the arrival, when it is the point of the frame', () => {
    for (const phase of ['arriving', 'instructorIn', 'speech1', 'speech2'] as Phase[]) {
      expect(headlineLift(at(phase)), phase).toBeCloseTo(HEADLINE_AT[1], 9)
      expect(headlineVisible(at(phase)), phase).toBe(true)
    }
  })

  it('climbs away as the instructor leaves, and only then', () => {
    expect(headlineLift(at('instructorOut', 0))).toBeCloseTo(HEADLINE_AT[1], 6)
    expect(headlineLift(at('instructorOut', 0.5))).toBeGreaterThan(HEADLINE_AT[1])
    expect(headlineLift(at('instructorOut', 1))).toBeCloseTo(HEADLINE_AWAY_Y, 6)
  })

  it('is gone from the first reading card onward', () => {
    /*
      Its whole job is to tell a player dropped into a room they did not build why
      they are standing there. From the first card on, the HUD's scene card says
      the same words in DOM - in the band the specimen now needs.
    */
    for (const phase of ['dioramaIn', 'reading', 'swapping', 'question', 'aiming'] as Phase[]) {
      expect(headlineVisible(at(phase)), phase).toBe(false)
    }
  })

  it('clears the top of the frame it is actually visible in', () => {
    /*
      **The frame that binds is `instructorOut`'s, not the reading pose's**, and
      getting that backwards produces a number that looks careful and is wrong.
      The sign is hidden from `dioramaIn` on, so the reading frame never sees it;
      deriving against the reading frame gives 10.8, which is 2.4 m of travel the
      sign makes after it has already left the shot.
    */
    const pose = cameraPose('instructorOut')
    const range = HEADLINE_AT[2] - pose.position[2]
    const aimDrop = pose.position[1] - pose.lookAt[1]
    const aimRange = Math.hypot(pose.lookAt[0] - pose.position[0], pose.lookAt[2] - pose.position[2])
    const pitch = Math.atan2(aimDrop, aimRange)
    const topOfFrame =
      pose.position[1] + range * Math.tan((pose.fov / 2) * (Math.PI / 180) - pitch)
    // troika anchors this line at its middle, so the lowest visible cap sits
    // about a third of an em below the anchor.
    const lowestCap = HEADLINE_AWAY_Y - HEADLINE_SIZE * 0.34
    expect(lowestCap, 'the sign is still in shot when it stops moving').toBeGreaterThan(topOfFrame)
  })
})

describe('the labels fit their plates', () => {
  it('holds both cards inside the limits', () => {
    for (const card of [CARD_0_STATIONS, CARD_1_STATIONS]) {
      for (const station of card) {
        expect(station.label.length, station.label).toBeLessThanOrEqual(LABEL_LIMIT)
        expect(station.caption.length, station.caption).toBeLessThanOrEqual(CAPTION_LIMIT)
        expect(station.label).toBe(station.label.toUpperCase())
      }
    }
  })

  it('gives each card exactly as many stations as the specimen has forms', () => {
    expect(CARD_0_STATIONS).toHaveLength(FORM_COUNT)
    expect(CARD_1_STATIONS).toHaveLength(FORM_COUNT)
  })

  it('indexes both cards from one total mapping', () => {
    /*
      `TeachingStage` used to map over `CARD_0_STATIONS` unconditionally and never
      read the card index, so card 1's words came from card 0 along with its
      illustration. Two loose exports a caller has to remember to switch between
      is how that happens.
    */
    expect(CARD_STATIONS).toHaveLength(2)
    expect(CARD_STATIONS[0]).toBe(CARD_0_STATIONS)
    expect(CARD_STATIONS[1]).toBe(CARD_1_STATIONS)
  })
})
