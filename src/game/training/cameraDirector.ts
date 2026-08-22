import {
  CAMERA_BACK,
  CAMERA_UP,
  CUBE_AT,
  EYE,
  FIRST_PERSON_FOV,
  INSTRUCTOR_HOME,
  PLANK_AT,
  PLAYER_AT,
  STAGE_FOV,
} from './stage'
import type { Phase } from './trainingMachine'

/**
 * Where the camera stands for each beat of the round.
 *
 * ## Target poses only. The easing is not in here, and that is the design.
 *
 * `cameraFrame.override` is a STATIC pose with no interpolation of its own, so
 * somebody has to smooth. The obvious move is to make this function return an
 * already-blended pose by knowing which phase preceded this one - and that is
 * exactly the design that goes wrong, because the predecessor is not always the
 * previous entry in the phase list. `rejecting` goes back to `aiming`, and a
 * blend that assumed list order would swing the camera through the celebration
 * pose on every miss.
 *
 * So this returns the TARGET for a phase and nothing else, and the component
 * exponentially smooths its own running pose toward it with
 * `1 - exp(-k * dt)` - which is `FollowCamera`'s own frame-rate-independent
 * smoothing rather than a second way of doing the same thing. The result needs no
 * knowledge of history, survives a phase that is re-entered, and is a pure
 * function of one enum.
 *
 * ## Why four poses and not fourteen
 *
 * The round has fourteen phases and four things worth looking at: the stage, the
 * instructor, the cube, and the planks. Giving every phase its own pose would mean
 * fourteen numbers to keep consistent and thirteen chances for one of them to
 * drift a few centimetres off its neighbour, which reads as a camera that twitches
 * between beats for no reason.
 */
export type CameraPose = {
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
}

/** Straight behind the player, seeing the back of the head. The default. */
function overShoulder(lookAt: [number, number, number], lift = 0, back = 0): CameraPose {
  return {
    /*
      MINUS `back`, because the stage is at +Z and behind is therefore -Z. See
      `stage.ts`: `headingVector(0)` is `(0, 0, 1)` and `PlayerController` seeds
      facing to zero, so the robot faces +Z on arrival and the camera has to sit
      on the other side of it.
    */
    position: [PLAYER_AT[0], PLAYER_AT[1] + CAMERA_UP + lift, PLAYER_AT[2] - CAMERA_BACK - back],
    lookAt,
    fov: STAGE_FOV,
  }
}

/**
 * The pose for a phase.
 *
 * Every phase is named explicitly rather than falling through a default, so
 * adding a beat is a typecheck failure rather than a camera that silently stays
 * where it was.
 */
export function cameraPose(phase: Phase): CameraPose {
  switch (phase) {
    /*
      Arrival looks at nothing in particular - a point at the player's own head
      height, out on the stage. The instructor has not arrived and the cube has
      not dropped, so aiming at either would be aiming at empty air and would
      make the first camera move look like a correction.
    */
    case 'arriving':
      return overShoulder([0, 2.3, 6])

    case 'instructorIn':
    case 'speech1':
    case 'speech2':
    case 'instructorOut':
      return overShoulder([INSTRUCTOR_HOME[0] * 0.55, INSTRUCTOR_HOME[1], INSTRUCTOR_HOME[2]])

    case 'cubeIn':
    case 'reading':
    case 'turning':
      /*
        Slightly lifted and pulled back for the cube, which is 2.1 m across and
        needs the room. The lift also keeps the player's head below the cube's
        bottom edge rather than overlapping it, so the two read as separate
        objects at separate depths.
      */
      return overShoulder(CUBE_AT, 0.55, 0.5)

    case 'arming':
    case 'aiming':
    case 'firing':
    case 'rejecting':
    case 'reloading':
    case 'accepting':
    case 'celebrating':
      /*
        FIRST PERSON, from `arming` all the way through the celebration.

        Over the shoulder this was a bow floating beside a robot's hand with the
        plunger tip four pixels of red somewhere below the targets, and the thing
        the player had to do - line a point up with a circle - was the one thing
        the framing did not show. Aiming wants the archer's sight line.

        `overShoulder` is not used here and could not be: it is defined as an
        offset BEHIND `PLAYER_AT`, and this is the opposite of behind. The camera
        sits at the eye and looks level at the middle plank, which is why
        `PLANK_AT[1]` is `EYE[1]` - a column centred above the eye would make the
        easy, level shot the wrong one.

        The whole quiz shares this pose, celebration included. A cut back to third
        person for the confetti was the alternative, and it loses the one thing
        first person bought: the burst comes at YOU.
      */
      return {
        position: EYE,
        lookAt: [PLANK_AT[0], PLANK_AT[1], PLANK_AT[2]],
        fov: FIRST_PERSON_FOV,
      }

    case 'exiting':
      // Hold whatever we were looking at. The iris is closing over this.
      return overShoulder(CUBE_AT, 0.55, 0.5)
  }
}

/** Smoothing weight for one frame. `FollowCamera`'s formula, not a second one. */
export function cameraBlend(damping: number, dt: number): number {
  return 1 - Math.exp(-damping * dt)
}

/**
 * Whether this beat is drawn from inside the character's head.
 *
 * The same phase set `cameraPose` gives the eye pose to, stated once so the two
 * cannot drift. They must agree exactly: a phase that gets the first-person pose
 * without the character being hidden puts the near plane inside a skull, and one
 * that hides the character without the pose deletes the hero from a third-person
 * shot. Both failures look like a rendering bug rather than like a missing case.
 */
export function firstPerson(phase: Phase): boolean {
  switch (phase) {
    case 'arming':
    case 'aiming':
    case 'firing':
    case 'rejecting':
    case 'reloading':
    case 'accepting':
    case 'celebrating':
      return true
    case 'arriving':
    case 'instructorIn':
    case 'speech1':
    case 'speech2':
    case 'instructorOut':
    case 'cubeIn':
    case 'reading':
    case 'turning':
    case 'exiting':
      return false
  }
}
