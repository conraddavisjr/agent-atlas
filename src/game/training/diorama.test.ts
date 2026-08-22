import { describe, expect, it } from 'vitest'
import { GLOW } from '@/art/materials'
import {
  DIM_FLOOR,
  DIORAMA_MODE,
  STATION_BOX,
  STATION_COUNT,
  STATION_FADE,
  STATION_SCALE,
  STATION_STAGGER,
  dioramaRunTime,
  loop,
  stationAt,
  stationCue,
  stationGlow,
  stationLift,
} from './diorama'
import { CAPTION_LIMIT, CARD_0_STATIONS, CARD_1_STATIONS, LABEL_LIMIT } from './dioramaCopy'
import { cameraPose } from './cameraDirector'
import { DIORAMA_AT, STATION_PITCH, dioramaSafeWidth, stationX } from './stage'

describe('the pacing seam', () => {
  /*
    These hold for BOTH modes, and that is the point of them. The whole reason
    `stationCue` exists as one function is that the choice between sequence and
    chorus is a question about an audience rather than about code - so the tests
    have to be about what any pacing must do, or switching modes means rewriting
    them and the switch stops being cheap.
  */

  it('gives every station a clock that only ever runs forward', () => {
    // A local clock that jumped back would restart a loop mid-gesture, which
    // reads as a stutter rather than as a repeat.
    for (let index = 0; index < STATION_COUNT; index++) {
      let previous = -1
      for (let t = 0; t < 30; t += 0.05) {
        const { local } = stationCue(index, t)
        expect(local, `station ${index} at ${t}`).toBeGreaterThanOrEqual(previous)
        previous = local
      }
    }
  })

  it('starts every station on the first frame of its own animation', () => {
    /*
      Not on the card's clock. A station handed the shared elapsed time lights
      part-way through its own gesture, which reads as having missed something -
      and it is the third station, the one carrying the paragraph's punchline,
      that would miss the most of it.
    */
    for (let index = 0; index < STATION_COUNT; index++) {
      expect(stationCue(index, 0).local).toBe(0)
    }
  })

  it('lights every station by the time the card is done', () => {
    const end = dioramaRunTime()
    for (let index = 0; index < STATION_COUNT; index++) {
      expect(stationCue(index, end).lit, `station ${index}`).toBeCloseTo(1, 9)
    }
  })

  it('never leaves a cue outside its own range', () => {
    for (let index = 0; index < STATION_COUNT; index++) {
      for (const t of [-5, 0, 0.1, 3, 10, 600]) {
        const { lit, local } = stationCue(index, t)
        expect(lit, `lit at ${t}`).toBeGreaterThanOrEqual(0)
        expect(lit).toBeLessThanOrEqual(1)
        expect(local, `local at ${t}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('lights them in ORDER when the mode says so', () => {
    // The one property that IS mode-specific, guarded on the mode rather than
    // asserted blindly, so flipping the token does not fail a test that was only
    // ever describing one of the two answers.
    if (DIORAMA_MODE !== 'sequence') return
    for (let index = 1; index < STATION_COUNT; index++) {
      const t = index * STATION_STAGGER - 0.01
      expect(stationCue(index, t).lit, `station ${index} lit early`).toBe(0)
      expect(stationCue(index - 1, t).lit, `station ${index - 1} lit late`).toBe(1)
    }
  })

  it('finishes inside the time it takes to read the paragraph beside it', () => {
    // The picture and the words should land together. Much past ten seconds and
    // the reader has finished and is waiting on a diagram.
    expect(dioramaRunTime()).toBeLessThan(10)
    expect(STATION_FADE).toBeGreaterThan(0)
  })
})

describe('lit and dim are shown by moving and brightening, never by fading', () => {
  it('keeps an unlit station visible', () => {
    /*
      A station that goes fully dark reads as missing rather than as waiting, and
      the player then meets a third of the stage as a surprise instead of as an
      order.
    */
    expect(DIM_FLOOR).toBeGreaterThan(0.15)
    expect(DIM_FLOOR).toBeLessThan(0.5)
  })

  it('stays off the bloom tier at both ends', () => {
    /*
      `00-art-bible.md` reserves tier A for ally blue and reward gold - "nothing in
      the environment is allowed in" - and a diorama is environment however much
      it would like to be feedback.
    */
    for (const lit of [0, 0.5, 1]) {
      expect(stationGlow(lit)).toBeGreaterThanOrEqual(GLOW.hold)
      expect(stationGlow(lit)).toBeLessThanOrEqual(GLOW.source)
    }
    expect(GLOW.source).toBeLessThan(GLOW.bloom)
  })

  it('rises when it lights, which is what stands in for a fade', () => {
    // troika's opacity needs a `sync()` per frame to animate; a group's position
    // is a matrix write. See `stationLift`.
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

describe('the stage fits the frame it is shown in', () => {
  /*
    **The layout assertion this whole staging turns on.**

    At `STAGE_FOV` the visible width is `2 * d * tan(fov/2) * aspect`, so a 16:9
    window shows 40% more of this stage than a square one. Sizing against a wide
    window is how a diorama ends up with its first and last stations cropped on a
    laptop in a split screen - and it would look correct on the machine it was
    built on, every time.

    So the safe width is measured at aspect 1.0, and everything that must be READ
    is checked against it.
  */
  const pose = cameraPose('reading')
  const safeHalf = dioramaSafeWidth(pose.position[2]) / 2

  it('keeps every station inside a SQUARE window', () => {
    for (let index = 0; index < STATION_COUNT; index++) {
      const outer = Math.abs(stationX(index)) + STATION_BOX.halfWidth
      expect(outer, `station ${index} is cropped`).toBeLessThan(safeHalf)
    }
  })

  it('leaves a gutter between neighbours', () => {
    // Two stations that touch read as one wide picture with a seam in it.
    expect(STATION_BOX.halfWidth * 2).toBeLessThan(STATION_PITCH)
  })

  it('shrinks the contents enough that three do not merge', () => {
    /*
      Each station is modelled at roughly its own slot's width, which is the
      natural way to build one and the wrong way to show three. At full size the
      belt of station one runs into the shelf of station two and the eye reads a
      single cluttered machine shop rather than three separate claims.

      `AUTHORED_HALF_WIDTH` is what the stations are actually built to - a metre
      either side of their own centre - so the product is what has to fit.
    */
    const AUTHORED_HALF_WIDTH = 1.05
    expect(AUTHORED_HALF_WIDTH * STATION_SCALE).toBeLessThanOrEqual(STATION_BOX.halfWidth)
    // And not so small that the stage is three toys on a shelf.
    expect(STATION_SCALE).toBeGreaterThan(0.6)
  })

  it('puts station ONE on the left of the SCREEN', () => {
    /*
      `+X` is screen left here, because the camera sits at negative Z looking
      toward positive Z. That inversion has caught this feature out five times -
      the headline rendered mirrored, the cube opened on the quiz face, all three
      plank verdicts showed before a shot, the hat's tip flopped out of sight, and
      the moustache curled the wrong way. It is a test now.
    */
    expect(pose.position[2]).toBeLessThan(DIORAMA_AT[2])
    expect(stationX(0)).toBeGreaterThan(stationX(1))
    expect(stationX(1)).toBeGreaterThan(stationX(2))
    expect(stationX(1)).toBeCloseTo(0, 9)
  })

  it('stands the stage where the camera is actually aimed', () => {
    // A pose aimed somewhere else would frame empty floor and nobody would notice
    // until they saw it.
    expect(pose.lookAt[0]).toBeCloseTo(DIORAMA_AT[0], 9)
    expect(pose.lookAt[2]).toBeCloseTo(DIORAMA_AT[2], 9)
    expect(pose.lookAt[1]).toBeGreaterThan(DIORAMA_AT[1])
  })

  it('places all three stations at one depth and one height', () => {
    // A station out of line reads as a modelling error rather than as depth.
    for (let index = 0; index < STATION_COUNT; index++) {
      const [, y, z] = stationAt(index)
      expect(y).toBeCloseTo(DIORAMA_AT[1], 9)
      expect(z).toBeCloseTo(DIORAMA_AT[2], 9)
    }
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

  it('gives each card exactly as many stations as the stage has', () => {
    expect(CARD_0_STATIONS).toHaveLength(STATION_COUNT)
    expect(CARD_1_STATIONS).toHaveLength(STATION_COUNT)
  })
})
