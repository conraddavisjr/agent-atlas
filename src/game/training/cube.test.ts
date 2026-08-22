import { describe, expect, it } from 'vitest'
import {
  FACE_COUNT,
  QUIZ_FACE,
  cubeDescent,
  cubePosition,
  WITHDRAW_FRACTION,
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
import {
  CUBE_AT,
  CUBE_DROP_FROM,
  CUBE_QUIZ_AT,
  CUBE_SIZE,
  EYE,
  FIRST_PERSON_FOV,
  HEADLINE_AT,
  HEADLINE_QUIZ_Y,
  PLANK_RADIUS,
} from './stage'
import { LABEL_HALF_HEIGHT, LABEL_LIFT, plankLayout } from './quiz'
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
  it('is down for the reading and gone for every beat of the quiz', () => {
    for (const phase of ['arriving', 'instructorIn', 'cubeIn', 'reading', 'turning'] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(0)
    }
    for (const phase of ['aiming', 'firing', 'rejecting', 'reloading', 'accepting', 'celebrating'] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(1)
    }
  })

  it('is finished well before the camera reaches the eye', () => {
    /*
      The camera crosses five metres during `arming` and the cube stands at z 3.6,
      directly between where it starts and where it ends. A board still rising
      when the camera lands is a wall passing the lens.
    */
    const duration = DURATIONS.arming ?? 2.2
    expect(cubeRise(at({ phase: 'arming', elapsed: duration * WITHDRAW_FRACTION }))).toBeCloseTo(1, 9)
    expect(WITHDRAW_FRACTION).toBeLessThan(0.6)
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

  it('lands exactly on the withdrawn pose', () => {
    const rest = cubePosition(1, 1)
    expect(rest[0]).toBeCloseTo(CUBE_QUIZ_AT[0], 12)
    expect(rest[1]).toBeCloseTo(CUBE_QUIZ_AT[1], 12)
    expect(rest[2]).toBeCloseTo(CUBE_QUIZ_AT[2], 12)
  })

  it('leaves the frame entirely, rather than merely getting out of the way', () => {
    /*
      **This is the test the withdrawal exists for.**

      An earlier staging kept the cube in shot and lifted it just enough to clear
      the answer labels. That worked from five metres behind the player and cannot
      work from the player's own eye - a 2.1 m board at z 3.6 fills the middle of
      a first-person frame and the plank column is behind it.

      So the bar is not "above the labels", it is "outside the frame": the cube's
      LOWEST corner has to sit past the top of a `FIRST_PERSON_FOV` view from
      `EYE`. Anything less and a corner of the board hangs over the question the
      HUD is now carrying.
    */
    const [, y, z] = cubePosition(1, 1)
    const bottom = y - CUBE_SIZE / 2
    const angle = (Math.atan2(bottom - EYE[1], z - EYE[2]) * 180) / Math.PI
    expect(angle, 'the withdrawn cube is still in shot').toBeGreaterThan(FIRST_PERSON_FOV / 2)
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

  it('holds the whole answer column and its labels inside the frame', () => {
    /*
      Three coins, three labels, from the eye. The label is the part that gets
      forgotten: it hangs above its plank, so the TOP of the frame is set by a
      piece of text rather than by any geometry, and a column that fits by disc
      alone can still crop the answer the player is reading.
    */
    const pose = cameraPose('aiming')
    const half = pose.fov / 2
    const planks = plankLayout()

    const top = degreesAbove(
      pose,
      planks[0][1] + LABEL_LIFT + LABEL_HALF_HEIGHT,
      planks[0][2],
    )
    const bottom = degreesAbove(pose, planks[2][1] - PLANK_RADIUS, planks[2][2])
    expect(top, 'the top label is cropped').toBeLessThan(half)
    expect(bottom, 'the bottom plank is cropped').toBeGreaterThan(-half)
  })

  it('centres on the middle answer, so the level shot is not the easy one', () => {
    /*
      A column whose centre sat above the eye would make shooting level - the
      thing a bow naturally does - land on the bottom answer every time. The
      middle plank is dead ahead instead, and the outer two are symmetric about
      it.
    */
    const pose = cameraPose('aiming')
    const planks = plankLayout()
    expect(degreesAbove(pose, planks[1][1], planks[1][2])).toBeCloseTo(0, 6)
    const up = degreesAbove(pose, planks[0][1], planks[0][2])
    const down = degreesAbove(pose, planks[2][1], planks[2][2])
    expect(up).toBeCloseTo(-down, 6)
  })

  it('keeps the headline clear of the answers', () => {
    /*
      The headline stands 15.7 m behind the column and rides up with the cube's
      withdrawal. It is now the only thing above the coins, so it has to be
      ABOVE them - at its reading height it lands squarely in the top label,
      which is what it did before the rise was re-derived for this camera.
    */
    const pose = cameraPose('aiming')
    const planks = plankLayout()
    const label = degreesAbove(pose, planks[0][1] + LABEL_LIFT + LABEL_HALF_HEIGHT, planks[0][2])
    const headline = degreesAbove(pose, HEADLINE_QUIZ_Y, HEADLINE_AT[2])
    expect(headline, 'the headline is in the answers again').toBeGreaterThan(label)
    expect(headline, 'the headline is off the top of the frame').toBeLessThan(pose.fov / 2)
  })
})
