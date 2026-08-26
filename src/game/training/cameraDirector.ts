import {
  CAMERA_BACK,
  CAMERA_UP,
  CUBE_AT,
  SPECIMEN_AT,
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

    case 'dioramaIn':
    case 'reading':
    case 'swapping':
      /*
        FORWARD for the specimen, and the previous note is why the question keeps
        coming back: this pose is re-derived every time the subject changes shape.
        It was framed for a 2.1 m cube, then pulled back for a 6.75 m band of
        three stations, and the subject is now a single object 3.7 m wide.

        `SPECIMEN_BACK` is 0, so the reading camera stands at the round's own rest
        distance - the same place the wizard's speech pose stands. That is worth
        more than the framing: `speech2`, `instructorOut`, `dioramaIn` and
        `reading` now share one camera Z, so the whole teaching act has no camera
        travel in it at all, only a lift and a re-aim.

        It is also what rules out one of the headline's possible exits. A camera
        that does not travel cannot leave a sign behind, so the sign has to move
        itself - see `headlineLift`.

        Note what pulling in does NOT buy. Apparent size is a fraction of the
        frame, and the constraint that binds the specimen is the band between the
        HUD reading card and the robot's head, which is a fraction and therefore
        invariant under dollying. The specimen is big because it is drawn big; the
        camera is here for the depth separation and the calm.
      */
      return overShoulder(
        [SPECIMEN_AT[0], SPECIMEN_AT[1] + SPECIMEN_AIM_LIFT, SPECIMEN_AT[2]],
        SPECIMEN_UP,
        SPECIMEN_BACK,
      )

    case 'cubeIn':
    case 'question':
      /*
        Back to the cube's own pose for the question. It is a 2.1 m square again,
        so the framing the reading used to have is the framing it wants - and
        re-using it exactly is what stops the camera twitching a few centimetres
        when the board arrives.
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

/**
 * How the specimen's pose differs from the cube's, in metres.
 *
 * ## Derived, and the first attempt was derived from the wrong thing
 *
 * 3.4 back put the camera 12 m from the stage, where a square window shows 8.7 m
 * of width. That satisfies the safe-width test - a 6.75 m stage fits inside 8.7 -
 * and it looks nothing like right, because "fits" is not "fills". The diorama sat
 * in the middle third of the frame with two metres of empty floor either side and
 * read as a model on a shelf rather than as the thing being taught.
 *
 * The number that matters is the distance at which the stage nearly fills a
 * SQUARE window, because that is the narrowest a player can present: 6.75 m of
 * stage wants 9.5 m of range, which is 0.9 back from the camera's own rest pose.
 * A 16:9 window then gives it 70% of the width, which is a diorama taking the
 * stage.
 *
 * `diorama.test.ts` still holds the ceiling - nothing may fall outside a square
 * window - and this comment holds the floor, which is a judgement rather than an
 * assertion.
 */
export const SPECIMEN_BACK = 0
export const SPECIMEN_UP = 0.55
/**
 * How far above the specimen's base the camera aims, in metres.
 *
 * This is the number that sets the PITCH, and the pitch is chosen to put the top
 * of the robot's head at about 81% of the frame - low enough to leave the whole
 * band above it for the specimen and its nameplate, high enough that the head is
 * still in shot, which is the round's one explicit composition note.
 *
 * From `(0, 3.25, -5.0)` the crown at roughly y 1.85 sits `atan(1.40 / 5.00)` =
 * 15.6 degrees below horizontal. Wanting it at 81% of a 40 degree frame is
 * `atan(tan(20 deg) * 31/50)` = 12.8 degrees below the axis, so the axis has to
 * be 2.8 degrees below horizontal, and at the specimen's 8.0 m range that is an
 * aim height of 2.86 - which is `SPECIMEN_AT[1]` plus 0.81.
 *
 * **The crown height is inferred, not measured.** `stage.ts` gives the eye at
 * 1.62 and says the head "sits around 1.6", which is a centre. The composition
 * survives the uncertainty - at 1.75 the crown lands at 84%, at 1.95 at 79%, and
 * the nameplate's lowest line is clear of both - but `__dev.framing()` answers it
 * exactly and should be run before anyone trusts this paragraph.
 */
export const SPECIMEN_AIM_LIFT = 0.81

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
    case 'dioramaIn':
    case 'reading':
    case 'swapping':
    case 'cubeIn':
    case 'question':
    case 'exiting':
      return false
  }
}
