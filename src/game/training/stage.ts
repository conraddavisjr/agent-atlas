/**
 * Where everything in the training round stands.
 *
 * One file, because the round is a STAGE rather than a place: the player does not
 * walk, so every position here is a composition decision, and the camera, the
 * instructor, the cube and the planks all have to agree about where the front of
 * the stage is. Splitting these across the components that use them is how the
 * cube ends up two metres to the left of the camera that is supposed to be
 * looking at it, with nothing failing.
 *
 * ## The convention, and it is not the one you would guess
 *
 * **The player faces +Z, so the whole stage is at POSITIVE Z and the camera sits
 * behind at negative Z.**
 *
 * This is not a preference, it is what the character controller already does.
 * `headingVector(facing)` in `movement.ts` is `(sin f, 0, cos f)`, so a facing of
 * zero is `(0, 0, 1)` - straight down +Z - and `PlayerController` initialises
 * `facing` to exactly that on every spawn. A stage authored at -Z would put the
 * robot's back to everything it is supposed to be watching, and the camera behind
 * it would be looking at its face.
 *
 * The first draft of this file had it mirrored, on the reasonable-sounding
 * assumption that the hub's south spawn at z=11 "faces the Core" and therefore
 * faces -Z. It does not: the spawn sets a position and nothing sets a facing, so
 * the robot arrives pointing at +Z and the player turns it. Writing the stage at
 * +Z means the round needs no facing intervention at all.
 */

/**
 * Where the robot ENDS UP standing, feet on the floor.
 *
 * **Not the spawn**, and conflating the two was a real bug rather than a
 * hypothetical one. The registry's spawn is `(0, 2, 0)` because `PlayerController`
 * drops the character in from `REVIVAL.dropHeight` and needs headroom; the robot
 * comes to rest with its capsule centre at about y 0.72. The first draft of this
 * file used the spawn's y as the camera's base, which put the camera 4.4 m up
 * looking at a point 2.3 m high - and the player, resting nearly four metres
 * below that axis, fell straight off the bottom of the frame.
 *
 * The brief's one explicit composition note is that you see the back of the
 * robot's head, so this is the constant that note depends on.
 */
export const PLAYER_AT: [number, number, number] = [0, 0, 0]

/**
 * Where the registry drops the player in, which is a different question.
 *
 * High enough for the revival fall to read as an arrival rather than as a
 * character appearing. Kept here beside `PLAYER_AT` so the difference between the
 * two is visible at a glance instead of being discovered from a frame.
 */
export const SPAWN_AT: [number, number, number] = [0, 2, 0]

/**
 * The robot's heading, radians. Zero, which is `+Z`, which is the stage.
 *
 * Stated as a constant rather than left implicit precisely because it is a
 * default the round depends on: if `PlayerController` ever seeded facing
 * differently, this is the line that would need to become an intervention.
 */
export const PLAYER_FACING = 0

/**
 * The camera's resting place behind the player.
 *
 * 5.0 back and 2.7 up FROM THE FLOOR - see `PLAYER_AT`, which is the standing
 * position and not the spawn.
 *
 * Closer and lower than the hub's rest pose, and both differences are deliberate:
 * the round has no navigation, so the wide framing the hub needs to show a route
 * is wasted, and a lower camera puts the horizon behind the cube rather than under
 * it, which is what makes a floating object read as floating.
 *
 * **Both numbers grew after the first frame, and the reason is worth keeping.**
 * At 4.2 and 2.4 the camera had to tilt UP to look at the instructor at head
 * height, which pushed the player's own head off the bottom edge - so the one
 * composition note the brief was explicit about, that you see the back of the
 * robot's head, was the first thing the framing lost. Pulling back and lifting
 * puts the head in the lower third with room under it, and the instructor stays
 * near the centre.
 */
export const CAMERA_BACK = 5.0
export const CAMERA_UP = 2.7

/**
 * How fast the camera settles toward its target pose, per second.
 *
 * Used as `1 - exp(-k * dt)`, which is `FollowCamera`'s own frame-rate-independent
 * smoothing rather than a second way of doing the same thing. A plain lerp on
 * `dt` gives a different result at 30 fps and at 144, and this project has already
 * paid once for a delta-time bug it could not see.
 */
export const CAMERA_DAMPING = 3.4

/** Field of view for the round. Matches the app's default so entry does not zoom. */
export const STAGE_FOV = 40

/**
 * The instructor's flight path, in world space.
 *
 * It enters from off to the player's right and high, sweeps across to settle just
 * left of centre at head height, and leaves the way it came. Entering and leaving
 * on the SAME side is deliberate: a character that crosses the frame twice reads
 * as two different arrivals, and the round only has one instructor.
 */
export const INSTRUCTOR_ENTER: [number, number, number] = [-7.5, 4.4, 6]
/*
  Lowered from 2.35 with the camera change above: the higher the instructor hovers,
  the more the camera has to tilt up to hold it, and every degree of that tilt
  comes out of the player's head at the bottom of frame.
*/
export const INSTRUCTOR_HOME: [number, number, number] = [-1.15, 2.1, 3.4]
export const INSTRUCTOR_EXIT: [number, number, number] = [-8.5, 5.2, 7]

/** Where the cube floats once it has descended, and where it drops from. */
/*
  Raised from 2.05 after the first frame with the cube in it.

  At 2.05 the cube spanned y 1.0 to 3.1 and the player's head sits at about 1.6,
  so the head covered the bottom third of the face the player was supposed to be
  reading. The brief wants both in shot - the avatar seen from behind, looking at
  the modal - and that only works if they occupy different bands of the frame.
*/
export const CUBE_AT: [number, number, number] = [0, 2.8, 3.6]
export const CUBE_DROP_FROM: [number, number, number] = [0, 7.2, 3.6]
export const CUBE_SIZE = 2.1

/**
 * Where the cube goes for the quiz, which is NOT where it does the reading.
 *
 * The first version of the quiz beat left it at `CUBE_AT` and hung the planks in
 * front of it, and the result was unreadable: the cube's centre is 2.8 and the
 * plank column's centre was 2.5, so the question ran straight through the answer
 * labels and each was illegible against the other.
 *
 * The fix is layout rather than opacity. A quiz has a shape everybody already
 * knows - question above, answers below - so the cube RISES when the quiz face
 * comes up, and the plank column drops slightly to meet it. The numbers are
 * derived rather than nudged: the top plank sits at `PLANK_AT[1] + PLANK_PITCH`
 * and its label reaches `LABEL_LIFT` plus half a line above that, about 3.8, so
 * the cube's lower edge has to clear 4.1 - which puts its centre at 5.15 at the
 * lowest. 5.3 buys the margin.
 *
 * Slightly further out than `CUBE_AT` as well, so the rise reads as the cube
 * withdrawing to make room rather than as it climbing the frame.
 */
export const CUBE_QUIZ_AT: [number, number, number] = [0, 5.3, 4.0]

/**
 * The three planks, top to bottom.
 *
 * The brief asks for roughly 40 screen pixels of separation. At this camera - 4.2
 * back from a target 3.9 further on, so about 8 m of slant range, at fov 40 over a
 * 900 px viewport - one screen pixel is about `2 * 8 * tan(20 deg) / 900`, or
 * 6.5 mm. So 40 px is **0.26 m** of gap.
 *
 * The planks are 0.62 m across, so a 0.26 m gap edge to edge is 0.88 m centre to
 * centre. That is the number below, and it is derived rather than eyeballed
 * because "40 px" is a screen quantity and this is a world one - the same
 * conversion `REVIVAL.dropHeight` documents for its own brief.
 */
export const PLANK_PITCH = 0.88
export const PLANK_RADIUS = 0.31
/*
  IN FRONT OF THE CUBE, not behind it, and the first version had this backwards.

  At z 3.9 the planks sat further from the camera than the cube at 3.6 - and the
  cube is 2.1 m across, so it occluded all three of them completely. The quiz face
  turned toward the player and revealed nothing, because everything it was
  revealing was hidden behind the object doing the revealing.

  The brief is explicit that the planks "render right in front", so they belong
  between the camera and the cube: the quiz face becomes the backdrop they hang
  against rather than a wall they hide behind.
*/
/*
  Lowered from 2.5 when the cube got its own quiz pose above. The column and the
  question were both centred on roughly the same height, which is the one
  arrangement in which neither can be read.
*/
export const PLANK_AT: [number, number, number] = [0, 2.3, 2.5]

/** The headline, standing large behind everything. */
export const HEADLINE = 'WHAT IS AI?'
export const HEADLINE_AT: [number, number, number] = [0, 4.6, 16]

/**
 * Where the headline goes once the cube rises for the quiz.
 *
 * The sign follows the board rather than staying put, and that is a framing
 * decision rather than an animation. At 4.6 the headline sits behind the READING
 * pose's cube and its outer letters flank it, which is what makes the stage look
 * arranged; the moment the camera tilts up for the quiz, that same headline lands
 * squarely in the plank column and the top answer label became unreadable against
 * the word `IS`.
 *
 * Derived: the risen cube's centre is 1.9 above the quiz camera and 11 in front
 * of it, so 9.8 degrees up. The headline stands at z 16, which is 23 in front, and
 * 23 * tan(9.8 deg) is 3.97 - so 3.4 + 3.97, rounded to the centimetre.
 */
export const HEADLINE_QUIZ_Y = 7.35
export const HEADLINE_SIZE = 1.85

/**
 * The training dummies, as silhouettes at distance.
 *
 * Six, spread wide and set well back so they never compete with the cube. They are
 * scenery: the brief calls the world "intentional, simple", and a dummy the player
 * can inspect is a dummy somebody has to model properly.
 */
export const DUMMIES: readonly [number, number][] = [
  [-9.5, 11],
  [-5.8, 13.5],
  [-2.2, 12],
  [2.6, 12.8],
  [6.4, 11.4],
  [9.8, 13.2],
]

/** The floor grid's extent and spacing. */
export const GRID_HALF = 26
export const GRID_STEP = 1.3
