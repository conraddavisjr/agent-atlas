import {
  CAMERA_BACK,
  CAMERA_UP,
  CUBE_AT,
  INSTRUCTOR_HOME,
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
    case 'rejecting':
    case 'accepting':
      /*
        BACK for the quiz, not in.

        The instinct is to push in - the planks are the smallest thing the round
        asks anyone to look at. The frame says otherwise: the player's own robot
        stands between the camera and the targets, and moving closer makes it
        bigger faster than it makes the planks bigger, because it is half the
        distance away. Closing in filled a third of the frame with the back of a
        head.

        Further back and lifted instead, so the three planks and the bow are all in
        shot with the robot low and small underneath them.

        The lookAt is NOT `PLANK_AT` any more, and that is the whole reason this
        pose was re-derived. Once the cube rises to `CUBE_QUIZ_AT` the beat is a
        tall one - question at 6.35, bottom plank at 1.1 - and centring on the
        planks alone pushed the question off the top of the frame. Aiming at 3.35
        splits the difference: from 7 m back that puts the cube's top edge 15
        degrees up and the bottom plank 13 down, inside a 20-degree half-fov, with
        the robot's head at 17.5 and therefore just barely in shot.
      */
      return overShoulder([0, QUIZ_EYELINE, 3.0], 0.7, 2.0)

    case 'celebrating':
      /*
        Pull back for the confetti. A burst that leaves the frame immediately is
        a burst nobody sees, and this is the round's one moment of spectacle.

        Same eyeline as the aim, so the win is a pull-back from the shot rather
        than a cut to somewhere else.
      */
      return overShoulder([0, QUIZ_EYELINE, 3.0], 1.0, 3.0)

    case 'exiting':
      // Hold whatever we were looking at. The iris is closing over this.
      return overShoulder(CUBE_AT, 0.55, 0.5)
  }
}

/**
 * What the camera centres on during the quiz.
 *
 * Between the risen cube and the plank column rather than on either, so both fit
 * a 40-degree frame. Named rather than inlined because the aim and the
 * celebration have to share it exactly - a celebration that re-centred would tilt
 * the camera at the moment the confetti fires.
 */
const QUIZ_EYELINE = 3.35

/** Smoothing weight for one frame. `FollowCamera`'s formula, not a second one. */
export function cameraBlend(damping: number, dt: number): number {
  return 1 - Math.exp(-damping * dt)
}
