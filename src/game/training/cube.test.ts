import { describe, expect, it } from 'vitest'
import {
  FACE_COUNT,
  QUIZ_FACE,
  cubeDescent,
  cubePosition,
  cubeRise,
  cubeYaw,
  easeInOutCubic,
  facePlacement,
  faceYaw,
} from './cube'
import {
  CARD_COUNT,
  DURATIONS,
  PHASES,
  initialTrainingState,
  type TrainingState,
} from './trainingMachine'
import { CUBE_AT, CUBE_DROP_FROM, CUBE_QUIZ_AT, CUBE_SIZE, PLANK_RADIUS } from './stage'
import { LABEL_LIFT, plankLayout } from './quiz'
import { cameraPose } from './cameraDirector'

const at = (over: Partial<TrainingState>): TrainingState => ({ ...initialTrainingState(), ...over })

describe('the faces', () => {
  it('turns exactly 90 degrees per card, in the reading direction', () => {
    /*
      Exactly. A cube stopped four degrees short of square looks square in a still
      frame and wrong the moment it moves, which is the class of defect no
      screenshot catches.

      Decreasing with the face index, because the cube turns to bring the next face
      round to the front - increasing would spin it the way a book un-turns its
      pages.
    */
    for (let face = 1; face < FACE_COUNT; face++) {
      expect(faceYaw(face) - faceYaw(face - 1)).toBeCloseTo(-Math.PI / 2, 12)
    }
  })

  it('puts the requested face toward the CAMERA, not away from it', () => {
    /*
      The bug this test exists for, and it shipped: without the half turn in
      `faceYaw`, the cube sat unrotated at card 0 and presented its -Z side - which
      with two reading cards is face 2, the quiz. The round opened by showing the
      player the question before either card that answers it.

      The camera looks along +Z, so the face it can see is the one pointing at -Z.
      Face `f` starts at `(sin(f*90), 0, cos(f*90))` and ends up at `f*90 + yaw`.
    */
    for (let face = 0; face < FACE_COUNT; face++) {
      const angle = (face * Math.PI) / 2 + faceYaw(face)
      expect(Math.sin(angle), `face ${face} x`).toBeCloseTo(0, 9)
      expect(Math.cos(angle), `face ${face} z`).toBeCloseTo(-1, 9)
    }
  })

  it('comes back to square after a full circuit', () => {
    // Four faces, four quarter turns, one revolution. If this drifted, a round
    // replayed twice would sit at an angle. Measured as displacement from the
    // start rather than as an absolute, since the start is no longer zero.
    expect(faceYaw(FACE_COUNT) - faceYaw(0)).toBeCloseTo(-Math.PI * 2, 12)
  })

  it('leaves the reading on its own faces and the quiz on the next one', () => {
    expect(QUIZ_FACE).toBe(CARD_COUNT)
    expect(QUIZ_FACE).toBeLessThan(FACE_COUNT)
    // And a face spare, which is what the success state will use.
    expect(FACE_COUNT - QUIZ_FACE - 1).toBeGreaterThanOrEqual(1)
  })

  it('places every face outside the cube and pointing away from its centre', () => {
    /*
      Text drawn exactly ON a face z-fights with it, and the failure is loud: the
      glyphs flicker between drawn and not as the cube turns, which reads as a
      rendering fault rather than as a near miss.
    */
    for (let face = 0; face < FACE_COUNT; face++) {
      const { position, rotation } = facePlacement(face)
      const radius = Math.hypot(position[0], position[2])
      expect(radius, `face ${face}`).toBeGreaterThan(1.05)
      // The face's own yaw matches the direction it sits in, so its text reads
      // right way round rather than mirrored.
      expect(Math.sin(rotation[1])).toBeCloseTo(position[0] / radius, 9)
      expect(Math.cos(rotation[1])).toBeCloseTo(position[2] / radius, 9)
    }
  })
})

describe('the turn', () => {
  it('rests square whenever it is not turning', () => {
    for (const phase of ['reading', 'arming', 'aiming'] as const) {
      for (let card = 0; card <= CARD_COUNT; card++) {
        expect(cubeYaw(at({ phase, card })), `${phase} ${card}`).toBeCloseTo(faceYaw(card), 12)
      }
    }
  })

  it('starts and ends a turn exactly on its two faces', () => {
    /*
      The two ends are what matter. A turn that overshoots or undershoots leaves
      the cube permanently off square, and every subsequent turn inherits the
      error - so the fourth card would be visibly skewed while the first looked
      fine.
    */
    const duration = DURATIONS.turning ?? 0.55
    expect(cubeYaw(at({ phase: 'turning', card: 0, elapsed: 0 }))).toBeCloseTo(faceYaw(0), 12)
    expect(cubeYaw(at({ phase: 'turning', card: 0, elapsed: duration }))).toBeCloseTo(faceYaw(1), 12)
  })

  it('moves monotonically, so it never rocks back mid-turn', () => {
    const duration = DURATIONS.turning ?? 0.55
    let previous = cubeYaw(at({ phase: 'turning', card: 0, elapsed: 0 }))
    for (let i = 1; i <= 120; i++) {
      const yaw = cubeYaw(at({ phase: 'turning', card: 0, elapsed: (duration * i) / 120 }))
      expect(yaw).toBeLessThanOrEqual(previous + 1e-12)
      previous = yaw
    }
  })

  it('eases rather than moving linearly', () => {
    // A linear quarter-turn reads as a machine part. The midpoint is the cheapest
    // place to prove there is a curve at all.
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })

  it('clamps outside its own window rather than running past', () => {
    // `elapsed` can exceed the duration by a frame before the machine transitions.
    const duration = DURATIONS.turning ?? 0.55
    expect(cubeYaw(at({ phase: 'turning', card: 0, elapsed: duration * 3 }))).toBeCloseTo(faceYaw(1), 12)
  })
})

describe('the descent', () => {
  it('is held up while the instructor is still on stage', () => {
    for (const phase of ['arriving', 'instructorIn', 'speech1', 'speech2', 'instructorOut'] as const) {
      expect(cubeDescent(at({ phase })), phase).toBe(0)
    }
  })

  it('arrives across cubeIn and stays down afterwards', () => {
    const duration = DURATIONS.cubeIn ?? 1
    expect(cubeDescent(at({ phase: 'cubeIn', elapsed: 0 }))).toBe(0)
    expect(cubeDescent(at({ phase: 'cubeIn', elapsed: duration }))).toBeCloseTo(1, 12)
    for (const phase of ['reading', 'turning', 'arming', 'aiming', 'celebrating'] as const) {
      expect(cubeDescent(at({ phase })), phase).toBe(1)
    }
  })

  it('lands exactly on its resting place, not near it', () => {
    const rest = cubePosition(1)
    expect(rest[0]).toBeCloseTo(CUBE_AT[0], 12)
    expect(rest[1]).toBeCloseTo(CUBE_AT[1], 12)
    expect(rest[2]).toBeCloseTo(CUBE_AT[2], 12)

    const start = cubePosition(0)
    expect(start[1]).toBeCloseTo(CUBE_DROP_FROM[1], 12)
  })

  it('only ever comes down', () => {
    // A descent that rose partway would read as the cube bouncing on nothing.
    let previous = cubePosition(0)[1]
    for (let i = 1; i <= 100; i++) {
      const y = cubePosition(i / 100)[1]
      expect(y).toBeLessThanOrEqual(previous + 1e-12)
      previous = y
    }
  })
})

describe('the rise, which is the quiz layout', () => {
  it('is down for the reading and up for every beat of the quiz', () => {
    for (const phase of ['arriving', 'instructorIn', 'cubeIn', 'reading', 'turning'] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(0)
    }
    for (const phase of ['aiming', 'rejecting', 'accepting', 'celebrating'] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(1)
    }
  })

  it('never rises while it is still coming down', () => {
    /*
      The two motions share one position, so an overlap would be the cube
      travelling diagonally out of the sky - and the drop is authored as a drop.
      Stated as an invariant over every phase rather than checked on the two that
      happen to matter today.
    */
    for (const phase of PHASES) {
      const state = at({ phase, elapsed: 0.3 })
      if (cubeDescent(state) < 1) expect(cubeRise(state), phase).toBe(0)
    }
  })

  it('turns the quiz face before it starts to climb, not during', () => {
    // Rotating and rising at once reads as the cube being knocked upward.
    const duration = DURATIONS.turning ?? 0.55
    for (let i = 0; i <= 10; i++) {
      expect(cubeRise(at({ phase: 'turning', elapsed: (duration * i) / 10 }))).toBe(0)
    }
  })

  it('lands exactly on the quiz pose', () => {
    const rest = cubePosition(1, 1)
    expect(rest[0]).toBeCloseTo(CUBE_QUIZ_AT[0], 12)
    expect(rest[1]).toBeCloseTo(CUBE_QUIZ_AT[1], 12)
    expect(rest[2]).toBeCloseTo(CUBE_QUIZ_AT[2], 12)
  })

  it('clears the top answer label once it is up', () => {
    /*
      **This is the test the whole quiz pose exists for.**

      Before it, the cube rested at 2.8 and the plank column at 2.5, so the
      question ran straight through the answers and neither could be read. The
      numbers that fixed it are three constants in three files, and nothing but
      this assertion connects them - move any one and the frame silently goes
      back to being illegible.
    */
    const topPlank = plankLayout()[0][1]
    const labelTop = topPlank + LABEL_LIFT + 0.12
    const cubeBottom = cubePosition(1, 1)[1] - CUBE_SIZE / 2
    expect(cubeBottom).toBeGreaterThan(labelTop)
  })
})

describe('the quiz camera frames the whole beat', () => {
  /*
    The pose is derived from the layout in a comment, and a comment cannot fail.
    This walks the actual arithmetic: everything the player has to see has to fall
    inside half the vertical field of view, measured from the camera's own axis.
  */
  const degreesAbove = (pose: ReturnType<typeof cameraPose>, y: number, z: number) => {
    const axis = Math.atan2(pose.lookAt[1] - pose.position[1], pose.lookAt[2] - pose.position[2])
    return ((Math.atan2(y - pose.position[1], z - pose.position[2]) - axis) * 180) / Math.PI
  }

  it('holds the risen question and the bottom plank inside the frame', () => {
    const pose = cameraPose('aiming')
    const half = pose.fov / 2
    const [, cubeY, cubeZ] = cubePosition(1, 1)
    const planks = plankLayout()

    const top = degreesAbove(pose, cubeY + CUBE_SIZE / 2, cubeZ)
    const bottom = degreesAbove(pose, planks[2][1] - PLANK_RADIUS, planks[2][2])
    expect(top, 'question off the top').toBeLessThan(half)
    expect(bottom, 'bottom plank off the bottom').toBeGreaterThan(-half)
  })

  it('does not re-centre for the celebration', () => {
    // A confetti burst that arrives with a camera tilt reads as a camera fault.
    const aim = cameraPose('aiming')
    const win = cameraPose('celebrating')
    expect(win.lookAt).toEqual(aim.lookAt)
    // Further back, though - the burst needs the room.
    expect(win.position[2]).toBeLessThan(aim.position[2])
  })
})
