import { describe, expect, it } from 'vitest'
import {
  DROOP,
  FALL_DISTANCE,
  PLANK_FACE_OFFSET,
  arrowPosition,
  flightProgress,
  makeShot,
  nockPoint,
  stuckPlunger,
} from './arrowFlight'
import { RELOAD_IDLE, bowArrival, bowVisible, drawAmount } from './bowDraw'
import { plankLayout } from './quiz'
import { EYE, MISS_RANGE, PLANK_AT, PLANK_RADIUS } from './stage'
import { DURATIONS, PHASES, initialTrainingState, type TrainingState } from './trainingMachine'

const at = (over: Partial<TrainingState>): TrainingState => ({ ...initialTrainingState(), ...over })

/** The centre of a plank, as an aim point. */
const centreOf = (index: number): [number, number, number] => {
  const [x, y, z] = plankLayout()[index]
  return [x, y, z]
}

describe('the shot goes where the aim said it would', () => {
  it('lands a hit on the plank the pointer resolved, not near it', () => {
    /*
      The single most important property in this file. The hit is scored by
      `resolveHit` against the pointer's ray at the moment of the click, and the
      flight is animated afterwards - so if the flight took its own view of where
      the plank was, the player would watch a plunger sail past a disc the round
      had already counted as a hit.
    */
    const aim: [number, number, number] = [PLANK_AT[0] + 0.12, plankLayout()[1][1] - 0.08, PLANK_AT[2]]
    const shot = makeShot(aim, 1)
    expect(shot.to[0]).toBeCloseTo(aim[0], 12)
    expect(shot.to[1]).toBeCloseTo(aim[1], 12)
  })

  it('stops on the FACE of the plank rather than inside it', () => {
    /*
      The aim plane passes through the discs' middles and they are 0.09 thick, so
      an arrow flown to the raw hit point buries the cup in the wood. The brief
      asks to see the plunger hit the coin, and a suction cup that has vanished
      into a board is not that.
    */
    const shot = makeShot(centreOf(1), 1)
    expect(shot.to[2]).toBeLessThan(PLANK_AT[2])
    expect(PLANK_AT[2] - shot.to[2]).toBeCloseTo(PLANK_FACE_OFFSET, 12)
    // On the surface, not floating in front of it: half the disc is 0.045.
    expect(PLANK_FACE_OFFSET).toBeGreaterThan(0.045)
    expect(PLANK_FACE_OFFSET).toBeLessThan(0.06)
  })

  it('carries a MISS on past the column instead of stopping at the plane', () => {
    /*
      The aim plane is an invisible sheet hung across the targets. An arrow that
      stopped there would halt in mid-air at exactly the depth of the planks on
      every miss, which is a stranger thing to watch than a miss.
    */
    const wide: [number, number, number] = [PLANK_AT[0] + 3.4, PLANK_AT[1], PLANK_AT[2]]
    const shot = makeShot(wide, null)
    expect(shot.plank).toBeNull()
    expect(shot.to[2]).toBeGreaterThan(PLANK_AT[2])

    const from = nockPoint()
    const travelled = Math.hypot(
      shot.to[0] - from[0],
      shot.to[1] - from[1],
      shot.to[2] - from[2],
    )
    expect(travelled).toBeCloseTo(MISS_RANGE, 9)
  })

  it('keeps a miss on the line the player aimed down', () => {
    // Extended, not deflected: the arrow has to leave through the gap the player
    // actually pointed at, or a near miss looks like the game moved it.
    const wide: [number, number, number] = [PLANK_AT[0] + 1.2, PLANK_AT[1] + 0.4, PLANK_AT[2]]
    const shot = makeShot(wide, null)
    const from = nockPoint()
    const aimDir = [wide[0] - from[0], wide[1] - from[1], wide[2] - from[2]]
    const flyDir = [shot.to[0] - from[0], shot.to[1] - from[1], shot.to[2] - from[2]]
    const cross = Math.hypot(
      aimDir[1] * flyDir[2] - aimDir[2] * flyDir[1],
      aimDir[2] * flyDir[0] - aimDir[0] * flyDir[2],
      aimDir[0] * flyDir[1] - aimDir[1] * flyDir[0],
    )
    expect(cross).toBeCloseTo(0, 9)
  })

  it('starts at the bow, in front of and below the eye', () => {
    const from = nockPoint()
    expect(from[1]).toBeLessThan(EYE[1])
    expect(from[2]).toBeGreaterThan(EYE[2])
    // And in front of the camera by enough to clear a sane near plane.
    expect(from[2] - EYE[2]).toBeGreaterThan(0.2)
  })
})

describe('the flight', () => {
  it('arrives EXACTLY on the hit point, droop and all', () => {
    /*
      The sag is parabolic in the flight parameter rather than in time, so it is
      zero at both ends by construction. A droop that was still non-zero at t=1
      would put the plunger a centimetre below the plank it was scored against,
      and the fix would be to shrink the droop until nobody noticed.
    */
    const shot = makeShot(centreOf(0), 0)
    const end = arrowPosition(shot, 1)
    expect(end[0]).toBeCloseTo(shot.to[0], 12)
    expect(end[1]).toBeCloseTo(shot.to[1], 12)
    expect(end[2]).toBeCloseTo(shot.to[2], 12)
    expect(DROOP).toBeGreaterThan(0)
  })

  it('sags in the middle, so the arrow has weight', () => {
    const shot = makeShot(centreOf(1), 1)
    const from = nockPoint()
    const mid = arrowPosition(shot, 0.5)
    const straight = (from[1] + shot.to[1]) / 2
    expect(mid[1]).toBeLessThan(straight)
    // Small enough that it never costs the shot the reticle promised.
    expect(straight - mid[1]).toBeLessThan(PLANK_RADIUS * 0.25)
  })

  it('only moves during the flight', () => {
    const shot = makeShot(centreOf(1), 1)
    expect(flightProgress(at({ phase: 'aiming' }))).toBe(0)
    expect(flightProgress(at({ phase: 'firing', elapsed: DURATIONS.firing ?? 0.34 }))).toBeCloseTo(1, 9)
    for (const phase of ['rejecting', 'reloading', 'accepting', 'celebrating'] as const) {
      expect(flightProgress(at({ phase })), phase).toBe(1)
    }
    // And past the end it stays put rather than flying on through the plank.
    expect(arrowPosition(shot, 3)).toEqual(arrowPosition(shot, 1))
  })

  it('covers most of the distance early, so the launch is legible', () => {
    // A linear flight over a third of a second is a smear nobody sees leave the
    // bow. Front-loaded travel means the loose reads and the impact reads.
    const half = flightProgress(at({ phase: 'firing', elapsed: (DURATIONS.firing ?? 0.34) / 2 }))
    expect(half).toBeGreaterThan(0.6)
  })

  it('never runs backwards', () => {
    let previous = -1
    for (let i = 0; i <= 40; i++) {
      const t = flightProgress(at({ phase: 'firing', elapsed: ((DURATIONS.firing ?? 0.34) * i) / 40 }))
      expect(t).toBeGreaterThanOrEqual(previous)
      previous = t
    }
  })
})

describe('the plunger that landed', () => {
  it('holds in the plank for the whole verdict', () => {
    const duration = DURATIONS.rejecting ?? 0.9
    for (const t of [0, 0.25, 0.5, 0.99]) {
      const stuck = stuckPlunger(at({ phase: 'rejecting', lastHit: 0, elapsed: duration * t }))
      expect(stuck, `t ${t}`).toEqual({ mode: 'stuck', fall: 0, fade: 1 })
    }
  })

  it('only lets go once the plank is square again', () => {
    /*
      **The bug this ordering exists to prevent.** The fall used to happen inside
      `rejecting`, and at the moment it began the plank was 167 degrees through
      its turn - so the local -Y the fall was written against pointed very nearly
      straight up, and the plunger rose off the board and left toward the ceiling.

      Falling belongs to `reloading`, which is the beat after the plank has come
      home, and there it is in WORLD space rather than in the plank's.
    */
    const falling = stuckPlunger(at({ phase: 'reloading', lastHit: 0, elapsed: 0.3 }))
    expect(falling?.mode).toBe('falling')
    expect(falling!.fall).toBeGreaterThan(0)
  })

  it('is gone by the time the bow is ready again', () => {
    // An arrow still lying in mid-air when the next shot is legal is litter.
    const end = stuckPlunger(at({ phase: 'reloading', lastHit: 0, elapsed: DURATIONS.reloading ?? 0.66 }))
    expect(end?.fade).toBeCloseTo(0, 9)
    expect(end?.fall).toBeCloseTo(FALL_DISTANCE, 9)
  })

  it('never falls off a winning shot', () => {
    // It is the evidence. Nothing about a win asks for it to drop on the floor.
    for (const phase of ['accepting', 'celebrating'] as const) {
      expect(stuckPlunger(at({ phase, lastHit: 1 })), phase).toEqual({
        mode: 'stuck',
        fall: 0,
        fade: 1,
      })
    }
  })

  it('does not exist when nothing was hit', () => {
    expect(stuckPlunger(at({ phase: 'reloading', lastHit: null }))).toBeNull()
    expect(stuckPlunger(at({ phase: 'aiming', lastHit: null }))).toBeNull()
  })
})

describe('the draw cycle, which is the rate limit', () => {
  it('is fully drawn for the whole of the only phase that can shoot', () => {
    // Drawn and unshootable, or shootable and slack, are both worse than either
    // failure sounds - the player learns the wrong tell for when they can fire.
    expect(drawAmount(at({ phase: 'aiming' }))).toBe(1)
    expect(drawAmount(at({ phase: 'aiming', elapsed: 30 }))).toBe(1)
  })

  it('snaps to nothing on the loose', () => {
    /*
      The release is not eased. A string still travelling forward when the arrow
      arrives at the plank is a string that did not shoot it.
    */
    expect(drawAmount(at({ phase: 'firing', elapsed: 0 }))).toBe(0)
    expect(drawAmount(at({ phase: 'rejecting' }))).toBe(0)
  })

  it('waits a beat before the archer reaches for the string', () => {
    /*
      The brief: the release, the arrow going out, and only "after one second"
      the archer reaching back. Nocking instantly loses the whole gesture.
    */
    const duration = DURATIONS.reloading ?? 0.66
    expect(drawAmount(at({ phase: 'reloading', elapsed: duration * RELOAD_IDLE * 0.5 }))).toBe(0)
    expect(drawAmount(at({ phase: 'reloading', elapsed: duration }))).toBeCloseTo(1, 9)
    expect(RELOAD_IDLE).toBeGreaterThan(0)
    expect(RELOAD_IDLE).toBeLessThan(0.6)
  })

  it('hands the bow back fully drawn, so aiming never starts slack', () => {
    // `reloading` ends and `aiming` begins on the same frame. A reload that
    // finished at 0.98 would put a visible snap on the first frame of every aim.
    const duration = DURATIONS.reloading ?? 0.66
    expect(drawAmount(at({ phase: 'reloading', elapsed: duration }))).toBeCloseTo(
      drawAmount(at({ phase: 'aiming' })),
      9,
    )
  })

  it('never leaves the unit interval, in any phase, at any time', () => {
    for (const phase of PHASES) {
      for (const elapsed of [0, 0.1, 0.5, 1, 5, 100]) {
        const draw = drawAmount(at({ phase, elapsed }))
        expect(draw, `${phase} @ ${elapsed}`).toBeGreaterThanOrEqual(0)
        expect(draw).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the bow arriving', () => {
  it('comes AFTER the planks, which is the order the brief gives', () => {
    const duration = DURATIONS.arming ?? 2.2
    expect(bowArrival(at({ phase: 'arming', elapsed: 0 }))).toBe(0)
    expect(bowArrival(at({ phase: 'arming', elapsed: duration * 0.5 }))).toBe(0)
    expect(bowArrival(at({ phase: 'arming', elapsed: duration }))).toBeCloseTo(1, 9)
  })

  it('is on screen for exactly the beats a bow makes sense in', () => {
    /*
      Not `celebrating`: the confetti is the moment, and a drawn bow in the middle
      of it says the round is still asking for something. Not the reading either -
      a bow lying around while the cards are up is a promise the round has not
      made yet.
    */
    for (const phase of PHASES) {
      const expected =
        phase === 'arming' ||
        phase === 'aiming' ||
        phase === 'firing' ||
        phase === 'rejecting' ||
        phase === 'reloading' ||
        phase === 'accepting'
      expect(bowVisible(at({ phase })), phase).toBe(expected)
    }
  })
})
