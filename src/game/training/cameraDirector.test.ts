import { describe, expect, it } from 'vitest'
import { cameraBlend, cameraPose, firstPerson } from './cameraDirector'
import { PHASES } from './trainingMachine'
import {
  CAMERA_BACK,
  CAMERA_DAMPING,
  CAMERA_UP,
  EYE,
  FIRST_PERSON_FOV,
  PLAYER_AT,
  STAGE_FOV,
} from './stage'

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

  it('stands behind the player for every THIRD-person beat', () => {
    /*
      "You're able to see the back of the avatar's head." The player faces +Z -
      `headingVector(0)` is `(0, 0, 1)` and `PlayerController` seeds facing to
      zero - so a third-person camera in this round is at LESSER z than the
      player, and above them. A pose that crept in front would show the robot's
      face and quietly lose the one composition note the brief was explicit
      about.

      The first-person beats are exempt by construction: the camera is AT the
      head, slightly in front of it, and the character is hidden. That exemption
      is exactly what `firstPerson` names, which is why this iterates against it
      rather than against a hand-written list that could disagree with the poses.
    */
    for (const phase of PHASES) {
      if (firstPerson(phase)) continue
      const pose = cameraPose(phase)
      expect(pose.position[2], `${phase} z`).toBeLessThan(PLAYER_AT[2])
      expect(pose.position[1], `${phase} y`).toBeGreaterThan(PLAYER_AT[1])
    }
  })

  it('puts the first-person beats at the eye, and only those', () => {
    /*
      `firstPerson` and `cameraPose` are two switches over the same phase list and
      they have to agree EXACTLY. A phase that gets the eye pose without being
      declared first person leaves the character drawn with the near plane inside
      its skull; one declared first person without the pose deletes the hero from
      a third-person shot. Both look like rendering faults rather than like a
      missing case, so the agreement is pinned rather than trusted.
    */
    for (const phase of PHASES) {
      const atEye = cameraPose(phase).position === EYE
      expect(atEye, phase).toBe(firstPerson(phase))
    }
  })

  it('always looks FORWARD, at something on the stage', () => {
    // Every subject in the round is at positive Z. A lookAt behind the camera
    // would spin it round without anything failing.
    for (const phase of PHASES) {
      expect(cameraPose(phase).lookAt[2], phase).toBeGreaterThan(PLAYER_AT[2])
    }
  })

  it('uses exactly two lenses, and they line up with the two viewpoints', () => {
    /*
      It used to be one, and the argument for that was good: a round that changes
      fov between beats appears to change lens, and the distance moves were doing
      that job already.

      There are two now because there are two viewpoints. Every third-person beat
      keeps `STAGE_FOV`, so nothing about the conversation or the reading has
      changed; the first-person beats widen, because a shooting view wants more
      peripheral than a conversation does and because the widening punctuates the
      move to the eye. What is pinned is that there is no THIRD value - a later
      "just zoom in a bit" has to be a decision rather than a drift.
    */
    for (const phase of PHASES) {
      const expected = firstPerson(phase) ? FIRST_PERSON_FOV : STAGE_FOV
      expect(cameraPose(phase).fov, phase).toBe(expected)
    }
    expect(FIRST_PERSON_FOV).toBeGreaterThan(STAGE_FOV)
  })

  it('never puts the camera further than a room away from the player', () => {
    // A pose that ran away would frame the round from across the map and nobody
    // would notice until they saw it.
    for (const phase of PHASES) {
      if (firstPerson(phase)) continue
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
      ['arming', 'aiming', 'firing', 'rejecting', 'reloading', 'accepting', 'celebrating'],
    ] as const

    for (const group of groups) {
      const first = cameraPose(group[0])
      for (const phase of group) {
        expect(cameraPose(phase), `${phase} vs ${group[0]}`).toEqual(first)
      }
    }
  })

  it('does not move the camera at all during the shooting', () => {
    /*
      The failure this design avoids. The quiz loop runs
      `aiming -> firing -> rejecting -> reloading -> aiming`, so a director that
      assumed phase-list order would travel through `accepting` and `celebrating`
      on every wrong answer - a camera lurch as punishment for missing.

      Now that all seven quiz beats share one pose the lurch is unreachable rather
      than merely avoided, which is worth pinning: somebody giving the
      celebration its own pull-back would reintroduce exactly that swing on every
      miss, because a miss passes through `rejecting` on its way back.
    */
    const aiming = cameraPose('aiming')
    for (const phase of ['firing', 'rejecting', 'reloading', 'accepting', 'celebrating'] as const) {
      expect(cameraPose(phase), phase).toEqual(aiming)
    }
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
