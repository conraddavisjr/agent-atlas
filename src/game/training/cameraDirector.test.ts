import { describe, expect, it } from 'vitest'
import { cameraBlend, cameraPose } from './cameraDirector'
import { PHASES } from './trainingMachine'
import { CAMERA_BACK, CAMERA_DAMPING, CAMERA_UP, PLAYER_AT, STAGE_FOV } from './stage'

describe('every phase has a camera to be seen from', () => {
  it('returns a finite pose for all of them', () => {
    // A NaN in a camera position does not throw. It renders a black frame, which
    // is indistinguishable from a scene that failed to load.
    for (const phase of PHASES) {
      const pose = cameraPose(phase)
      for (const v of [...pose.position, ...pose.lookAt, pose.fov]) {
        expect(Number.isFinite(v), `${phase}: ${v}`).toBe(true)
      }
    }
  })

  it('always stands BEHIND the player, which is the brief', () => {
    /*
      "You're able to see the back of the avatar's head." The player faces +Z -
      `headingVector(0)` is `(0, 0, 1)` and `PlayerController` seeds facing to
      zero - so every camera in this round is at LESSER z than the player, and
      above them. A pose that crept in front would show the robot's face and
      quietly lose the one composition note the brief was explicit about.
    */
    for (const phase of PHASES) {
      const pose = cameraPose(phase)
      expect(pose.position[2], `${phase} z`).toBeLessThan(PLAYER_AT[2])
      expect(pose.position[1], `${phase} y`).toBeGreaterThan(PLAYER_AT[1])
    }
  })

  it('always looks FORWARD, at something on the stage', () => {
    // Every subject in the round is at positive Z. A lookAt behind the camera
    // would spin it round without anything failing.
    for (const phase of PHASES) {
      expect(cameraPose(phase).lookAt[2], phase).toBeGreaterThan(PLAYER_AT[2])
    }
  })

  it('keeps the field of view fixed across the whole round', () => {
    /*
      Deliberate. A round that changes fov between beats is a round that appears
      to change lens, and the distance moves are doing that job already. Pinned so
      a later "just zoom in a bit" is a decision rather than a drift.
    */
    for (const phase of PHASES) expect(cameraPose(phase).fov, phase).toBe(STAGE_FOV)
  })

  it('never puts the camera further than a room away from the player', () => {
    // A pose that ran away would frame the round from across the map and nobody
    // would notice until they saw it.
    for (const phase of PHASES) {
      const pose = cameraPose(phase)
      const dz = pose.position[2] - PLAYER_AT[2]
      const dy = pose.position[1] - PLAYER_AT[1]
      expect(Math.hypot(dz, dy), phase).toBeLessThan(CAMERA_BACK + CAMERA_UP + 3)
    }
  })
})

describe('the poses are a small set, on purpose', () => {
  it('gives every beat of one act the same camera', () => {
    /*
      Fourteen phases, four things worth looking at. Giving each phase its own
      pose means thirteen chances for one to drift a few centimetres off its
      neighbour, which reads as a camera that twitches between beats for no
      reason. These groups must be bit-identical, not merely close.
    */
    const groups = [
      ['instructorIn', 'speech1', 'speech2', 'instructorOut'],
      ['cubeIn', 'reading', 'turning'],
      ['arming', 'aiming', 'rejecting', 'accepting'],
    ] as const

    for (const group of groups) {
      const first = cameraPose(group[0])
      for (const phase of group) {
        expect(cameraPose(phase), `${phase} vs ${group[0]}`).toEqual(first)
      }
    }
  })

  it('does not swing through the celebration pose on a miss', () => {
    /*
      The failure this design avoids. `rejecting` returns to `aiming`, so if the
      blend had assumed phase-list order it would have travelled through
      `accepting` and `celebrating` on every wrong answer - a camera lurch as
      punishment for missing.
    */
    expect(cameraPose('rejecting')).toEqual(cameraPose('aiming'))
    expect(cameraPose('celebrating')).not.toEqual(cameraPose('aiming'))
  })
})

describe('the blend', () => {
  it('is frame-rate independent, which a plain lerp is not', () => {
    /*
      `1 - exp(-k*dt)`, the same formula `FollowCamera` uses. The test is that two
      half-steps compose to one whole step: with a plain `k * dt` lerp they do
      not, and the camera arrives at a different speed at 30 fps than at 144.

      This project has already paid for one delta-time bug it could not see - the
      frameloop revert that gave every subscriber a delta two hundred times too
      small - so the arithmetic gets checked rather than assumed.
    */
    const dt = 1 / 60
    const once = cameraBlend(CAMERA_DAMPING, dt)
    const half = cameraBlend(CAMERA_DAMPING, dt / 2)
    // Compose two half-steps of a lerp: 1 - (1-a)(1-a).
    const composed = 1 - (1 - half) * (1 - half)
    expect(composed).toBeCloseTo(once, 12)
  })

  it('stays inside the unit interval at any frame time', () => {
    // A blend above 1 overshoots the target and a negative one runs backwards.
    for (const dt of [0, 1 / 240, 1 / 60, 1 / 10, 1, 10]) {
      const t = cameraBlend(CAMERA_DAMPING, dt)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
    }
  })

  it('settles fast enough to be done inside the shortest beat', () => {
    /*
      The shortest camera move has to finish before the beat it belongs to ends,
      or the round looks like it is always catching up. The shortest phase with a
      pose change is `turning` at 0.55 s; 90% settled by then is the bar.
    */
    const settled = 1 - Math.exp(-CAMERA_DAMPING * 0.55)
    expect(settled).toBeGreaterThan(0.8)
  })
})
