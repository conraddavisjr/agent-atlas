import { describe, expect, it } from 'vitest'
import {
  LABEL_HALF_HEIGHT,
  LABEL_LIFT,
  burstOrigin,
  PLANK_STAGGER,
  plankLayout,
  plankReveal,
  plankSpin,
  resolveHit,
  screenGapToWorld,
} from './quiz'
import { QUIZ } from './cards'
import { EYE, FIRST_PERSON_FOV, PLANK_AT, PLANK_PITCH, PLANK_RADIUS } from './stage'
import { DURATIONS, PHASES, initialTrainingState, type TrainingState } from './trainingMachine'

const at = (over: Partial<TrainingState>): TrainingState => ({ ...initialTrainingState(), ...over })

describe('turning "about 40 pixels" into a real distance', () => {
  it('agrees with the arithmetic worked by hand', () => {
    /*
      The brief asks for planks "spaced apart just about 40 px" and then says "I'm
      not too sure, in the 3D world, what that means". This is what it means.

      At 8 m with a 40 degree vertical fov over a 900 px viewport, the half height
      is `8 * tan(20 deg)` = 2.912 m, so one pixel is `2 * 2.912 / 900` = 6.47 mm
      and 40 px is 0.259 m.
    */
    expect(screenGapToWorld(40, 900, 8, 40)).toBeCloseTo(0.2589, 3)
  })

  it('scales the way the camera actually behaves', () => {
    // Twice as far is twice as much world per pixel; twice the viewport is half.
    expect(screenGapToWorld(40, 900, 16)).toBeCloseTo(screenGapToWorld(40, 900, 8) * 2, 9)
    expect(screenGapToWorld(40, 1800, 8)).toBeCloseTo(screenGapToWorld(40, 900, 8) / 2, 9)
    expect(screenGapToWorld(80, 900, 8)).toBeCloseTo(screenGapToWorld(40, 900, 8) * 2, 9)
  })

  it('backs the pitch the planks actually ship with, at the camera they ship with', () => {
    /*
      `PLANK_PITCH` is centre to centre and the brief's 40 px is the GAP between
      edges, so the pitch has to be the gap plus one plank.

      **The range and the lens are read from the shipped constants rather than
      written down here**, and that is the whole point of this test now. It used
      to hard-code 8 m and `STAGE_FOV`, which were true of the third-person quiz
      camera; the shooting moved to the player's own eye, and the same 40 px then
      meant a completely different distance. A derivation with the camera baked
      into it agrees with itself forever and stops describing the game.
    */
    const range = PLANK_AT[2] - EYE[2]
    const gap = screenGapToWorld(40, 900, range, FIRST_PERSON_FOV)
    expect(PLANK_PITCH).toBeCloseTo(gap + PLANK_RADIUS * 2, 1)
  })

  it('leaves room for a label between each pair', () => {
    /*
      The labels hang `LABEL_LIFT` above their own plank, which puts them in the
      gap under the plank ABOVE. Tightening the pitch to taste is how that gap
      closes and how a label ends up crossing a disc - so the clearance is a
      test rather than something to notice in a screenshot.
    */
    const labelTop = LABEL_LIFT + LABEL_HALF_HEIGHT
    const plankAboveBottom = PLANK_PITCH - PLANK_RADIUS
    expect(labelTop, 'a label now reaches the plank above it').toBeLessThan(plankAboveBottom)
  })
})

describe('where the planks are', () => {
  it('puts the first answer at the TOP', () => {
    /*
      The brief lists them "one, two, three, top, middle, bottom" and the answers
      are authored in that order, so answer 0 must be the highest plank. Getting
      this backwards would silently reverse the whole quiz - every label would sit
      above the wrong disc and nothing would fail.
    */
    const planks = plankLayout()
    expect(planks).toHaveLength(QUIZ.answers.length)
    for (let i = 1; i < planks.length; i++) {
      expect(planks[i][1], `plank ${i}`).toBeLessThan(planks[i - 1][1])
    }
  })

  it('spaces them evenly and in one column', () => {
    const planks = plankLayout()
    for (let i = 1; i < planks.length; i++) {
      expect(planks[i - 1][1] - planks[i][1]).toBeCloseTo(PLANK_PITCH, 9)
      expect(planks[i][0]).toBeCloseTo(planks[0][0], 9)
      expect(planks[i][2]).toBeCloseTo(planks[0][2], 9)
    }
  })

  it('leaves a real gap between them rather than letting them touch', () => {
    // Touching discs have no gap for a near miss to land in, and the flip of one
    // would clip the next.
    expect(PLANK_PITCH).toBeGreaterThan(PLANK_RADIUS * 2)
  })

  it('lifts each label clear of its own plank and of the one above', () => {
    // On the plank rather than above it would rotate away with the flip, losing
    // the answer's text at the exact moment the player is told whether it was right.
    expect(LABEL_LIFT).toBeGreaterThan(PLANK_RADIUS)
    expect(LABEL_LIFT).toBeLessThan(PLANK_PITCH - PLANK_RADIUS + 0.001)
  })
})

describe('what a shot hit', () => {
  const planks = plankLayout()

  it('registers a dead-centre hit on each plank', () => {
    for (let i = 0; i < planks.length; i++) {
      expect(resolveHit(planks[i]), `plank ${i}`).toBe(i)
    }
  })

  it('registers just inside the rim and misses just outside it', () => {
    /*
      A disc test rather than a box. These are coins, and a square hit area on a
      round target is generous exactly at the corners - which is where a near miss
      most needs to read as a near miss.
    */
    const [x, y, z] = planks[1]
    const inside: [number, number, number] = [x + PLANK_RADIUS * 0.99, y, z]
    const outside: [number, number, number] = [x + PLANK_RADIUS * 1.02, y, z]
    expect(resolveHit(inside)).toBe(1)
    expect(resolveHit(outside)).toBeNull()

    // And the corner of the bounding box is a MISS, which a box test would accept.
    const corner: [number, number, number] = [
      x + PLANK_RADIUS * 0.9,
      y + PLANK_RADIUS * 0.9,
      z,
    ]
    expect(resolveHit(corner)).toBeNull()
  })

  it('misses the gap between two planks', () => {
    const [x, y, z] = planks[0]
    expect(resolveHit([x, y - PLANK_PITCH / 2, z])).toBeNull()
  })

  it('never claims two planks for one point', () => {
    // Overlapping hit areas would make the boundary depend on iteration order.
    for (let i = 0; i < planks.length; i++) {
      for (let j = i + 1; j < planks.length; j++) {
        const dy = Math.abs(planks[i][1] - planks[j][1])
        expect(dy).toBeGreaterThan(PLANK_RADIUS * 2)
      }
    }
  })
})

describe('the staggered arrival', () => {
  it('brings them in one, two, three', () => {
    // Sampled a third of the way through: the top plank is further along than the
    // middle, which is further along than the bottom.
    const duration = DURATIONS.arming ?? 2.2
    const state = at({ phase: 'arming', elapsed: duration * 0.34 })
    const reveals = QUIZ.answers.map((_, i) => plankReveal(state, i))
    for (let i = 1; i < reveals.length; i++) {
      expect(reveals[i], `plank ${i}`).toBeLessThan(reveals[i - 1])
    }
  })

  it('has every plank fully arrived by the end of the phase', () => {
    /*
      The stagger is a FRACTION of the phase rather than a fixed delay, so that
      retuning `DURATIONS.arming` cannot push the last plank's arrival past the end
      of its own window - which would show the player a disc still growing as they
      were being invited to shoot it.
    */
    const duration = DURATIONS.arming ?? 2.2
    const end = at({ phase: 'arming', elapsed: duration })
    for (let i = 0; i < QUIZ.answers.length; i++) {
      expect(plankReveal(end, i), `plank ${i}`).toBe(1)
    }
    expect(PLANK_STAGGER * (QUIZ.answers.length - 1)).toBeLessThan(1)
  })

  it('is absent before the quiz and present for the whole of it', () => {
    const before: TrainingState['phase'][] = [
      'arriving', 'instructorIn', 'speech1', 'speech2', 'instructorOut', 'cubeIn',
      'reading', 'turning',
    ]
    for (const phase of before) expect(plankReveal(at({ phase }), 0), phase).toBe(0)
    for (const phase of ['aiming', 'rejecting', 'accepting', 'celebrating'] as const) {
      expect(plankReveal(at({ phase }), 2), phase).toBe(1)
    }
  })
})

describe('the flip', () => {
  it('leaves every plank alone except the one that was hit', () => {
    const state = at({ phase: 'rejecting', lastHit: 1, elapsed: 0.4 })
    expect(plankSpin(state, 0)).toBe(0)
    expect(plankSpin(state, 2)).toBe(0)
    expect(plankSpin(state, 1)).toBeGreaterThan(0)
  })

  it('shows the no-sign at the midpoint and comes home to EXACTLY square', () => {
    /*
      The return trip is the part that matters. A plank left a few hundredths off
      square shows a sliver of its back face for the rest of the round, and every
      subsequent miss compounds the error.

      One curve out and back - `sin(t*PI)` - rather than two tweens with a hold
      between them, precisely so there is only one place for that error to come
      from and it is zero at both ends by construction.
    */
    const duration = DURATIONS.rejecting ?? 1.1
    expect(plankSpin(at({ phase: 'rejecting', lastHit: 0, elapsed: 0 }), 0)).toBeCloseTo(0, 12)
    expect(
      plankSpin(at({ phase: 'rejecting', lastHit: 0, elapsed: duration / 2 }), 0),
    ).toBeCloseTo(Math.PI, 12)
    expect(
      plankSpin(at({ phase: 'rejecting', lastHit: 0, elapsed: duration }), 0),
    ).toBeCloseTo(0, 12)
  })

  it('turns a correct plank to a half turn and leaves it there', () => {
    const duration = DURATIONS.accepting ?? 0.9
    expect(plankSpin(at({ phase: 'accepting', lastHit: 1, elapsed: 0 }), 1)).toBeCloseTo(0, 12)
    expect(
      plankSpin(at({ phase: 'accepting', lastHit: 1, elapsed: duration }), 1),
    ).toBeCloseTo(Math.PI, 12)
    // And it stays turned through the celebration and the exit.
    for (const phase of ['celebrating', 'exiting'] as const) {
      expect(
        plankSpin(at({ phase, lastHit: 1, won: true }), 1),
        phase,
      ).toBeCloseTo(Math.PI, 12)
    }
  })

  it('never turns past a half turn, in any phase', () => {
    // Past PI the plank would come back round to its front face and the verdict
    // would flash away again.
    for (const phase of PHASES) {
      for (let e = 0; e <= 3; e += 0.02) {
        const spin = plankSpin(at({ phase, lastHit: 1, elapsed: e, won: true }), 1)
        expect(spin, `${phase} at ${e.toFixed(2)}`).toBeGreaterThanOrEqual(-1e-9)
        expect(spin, `${phase} at ${e.toFixed(2)}`).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })
})

describe('the win burst starts where the win is', () => {
  it('fires from the correct plank, not from the middle of the column', () => {
    /*
      They coincide today, because the right answer is the middle one. That is
      exactly why this is pinned: reordering `QUIZ.answers` moves the star, and
      before this the confetti would have stayed behind with nothing failing.
    */
    const [x, y] = burstOrigin()
    const [px, py] = plankLayout()[QUIZ.correct]
    expect(x).toBeCloseTo(px, 12)
    expect(y).toBeCloseTo(py, 12)
  })

  it('starts in front of the plank, on the camera side', () => {
    // Behind it and the whole burst is occluded by the thing it is celebrating.
    expect(burstOrigin()[2]).toBeLessThan(plankLayout()[QUIZ.correct][2])
  })
})
