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
 * The player's eye, for the first-person quiz.
 *
 * ## Why the shooting is first person at all
 *
 * Over the shoulder, the bow was a prop floating beside a robot's hand and the
 * plunger tip was four pixels of red somewhere below the targets. Aiming needs
 * the sight line, and the sight line is the character's, not a camera's standing
 * five metres behind them.
 *
 * ## The numbers
 *
 * 1.62 is the robot's eye height, near enough - the head sits around 1.6 with the
 * pose solver at rest. The 0.30 forward is what puts the camera OUTSIDE its own
 * head: at the head's centre the near plane clips through the skull from the
 * inside, which renders as a dark smear across the bottom of frame that looks
 * like a broken post-process rather than like a camera in the wrong place.
 *
 * The robot itself is hidden from `arming` onward, so what the player sees of
 * themselves is the viewmodel in `Bow.tsx`: two hands and a drawn bow.
 */
export const EYE: [number, number, number] = [
  PLAYER_AT[0],
  PLAYER_AT[1] + 1.62,
  PLAYER_AT[2] + 0.3,
]

/**
 * Field of view for the first-person beats.
 *
 * Wider than `STAGE_FOV`. A shooting view wants more peripheral than a
 * conversation does - the plank column subtends 16 degrees and the bow has to sit
 * beside it without either being cropped - and the widening doubles as the push-in
 * transition's punctuation: the camera travels five metres forward AND opens up,
 * so the arrival at the eye reads as a change of viewpoint rather than a dolly.
 *
 * 48 is as wide as this goes before the barrel distortion at the corners starts
 * bending the plank column, which on three stacked circles is very visible.
 */
export const FIRST_PERSON_FOV = 48

/**
 * Where the bow sits relative to the eye, in WORLD axes.
 *
 * ## World-relative rather than camera-local, and the sign is why
 *
 * A viewmodel is normally authored camera-local, and this one was. It is wrong
 * here and it is wrong in a way that is easy to miss: three's cameras look down
 * their own -Z, so camera-local +Z is BEHIND the lens, and camera +X is world -X
 * for a camera facing +Z. Adding a camera-local triple to a world position
 * component-wise - which is what the first version did - puts the bow behind the
 * player and on the wrong side.
 *
 * The camera is parked at `EYE` for the whole quiz and never moves, so there is
 * no reason to work in its frame at all. These are plain world offsets: +X is the
 * player's left (they face +Z, so their right is -X), -Y is below the eye, +Z is
 * downrange.
 *
 * ## The values
 *
 * Left of centre and low, so the grip and the drawing hand frame the lower left
 * of the view and leave the middle of it clear - a bow centred on the view covers
 * the middle plank with its own riser at exactly the moment the player is trying
 * to hit it. World +X reads as screen LEFT here, because the camera faces +Z.
 *
 * ## The forward distance is the number that was wrong, and badly
 *
 * It was 0.62, which is roughly where a real archer's bow hand is. That is the
 * right answer for a real bow and the wrong one for a rendered one: the limbs are
 * 0.6 m tip to tip, so at 0.62 m they subtend fifty degrees and the riser sweeps
 * diagonally across the whole frame, through the answers the player is trying to
 * read. Worse, the drawing hand sits at 0.62 minus the draw - under 0.4 m - where
 * a hand the size of the character's own fills the corner of the screen.
 *
 * A metre out with the rig scaled down is the usual answer and it is the one
 * every first-person game reaches for: the viewmodel is not built at the scale
 * the world is, it is built at the scale that composes. See `BOW_SCALE`.
 */
export const BOW_OFFSET: [number, number, number] = [0.44, -0.26, 0.95]

/** How far the string and the nocked arrow pull back, in metres. */
export const BOW_DRAW = 0.2

/**
 * How large the bow rig is drawn, relative to a real one.
 *
 * A viewmodel is not built at world scale, it is built at the scale that
 * composes - the same licence every first-person game takes with the weapon in
 * its own hands. At 1 the limbs cross the plank column no matter how far out the
 * rig is pushed, because pushing it out is exactly what makes the arrow tip
 * shrink away from the reticle it is supposed to be pointing at.
 *
 * 0.58 puts the riser and both hands in the lower left, the arrow running up
 * toward the middle of frame, and nothing over the answers.
 *
 * The offset does as much work as the scale, and for a reason worth knowing:
 * aiming from the eye at something straight ahead points the arrow almost
 * directly away from the camera, so it foreshortens to nothing and the whole rig
 * piles up into one lump. Moving the anchor out to the side opens the angle
 * between the view and the shaft, which is why every first-person bow is held
 * further from the archer's centreline than a real one.
 */
export const BOW_SCALE = 0.58

/**
 * How far a missed arrow flies before it is taken off the board.
 *
 * The brief: it "should travel a projected distance and then disappear". Far
 * enough past the plank column that the arrow is a dot by the time it goes -
 * the column is at `PLANK_AT[2]`, so this is roughly twice that from the eye.
 */
export const MISS_RANGE = 13

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
 * Where the cube goes when the quiz starts: up and out of the shot.
 *
 * ## It used to stay, and the reason it cannot is the first-person camera
 *
 * The previous staging kept the cube in frame with the question on its face and
 * lifted it to 5.3 so the plank labels could clear it. That worked from five
 * metres behind the player. It cannot work from the player's own eye: at 1.62 up
 * and 0.30 forward, a 2.1 m cube standing at z 3.6 fills the middle of the view
 * and the plank column is BEHIND it. There is no height that fixes that - raise
 * the cube enough to clear the labels and its own top leaves the frame.
 *
 * So the cube's job ends when the question has been read. The quiz face now gets
 * a `reading` beat of its own with a Begin button, exactly like the two cards
 * before it, and then the board withdraws straight up while the camera moves in.
 * `TrainingHUD` carries the question through the shooting, which is where a
 * question belongs once your hands are full.
 *
 * 8.2 is out of a 48-degree frame from the eye by a wide margin, and it goes
 * there fast - see `cubeRise`, which is done in the first part of `arming`.
 */
export const CUBE_QUIZ_AT: [number, number, number] = [0, 8.2, 3.6]

/**
 * The three planks, top to bottom.
 *
 * The brief asks for roughly 40 screen pixels of separation, which is a SCREEN
 * quantity, so it has to be re-derived whenever the camera moves - the same
 * conversion `REVIVAL.dropHeight` documents for its own brief.
 *
 * From the first-person eye the column stands 5.9 m away, and at fov 48 over a
 * 900 px viewport one screen pixel is `2 * 5.9 * tan(24 deg) / 900`, or 5.8 mm.
 * So 40 px is **0.23 m** of gap, and on a 0.62 m disc that is 0.85 centre to
 * centre. 0.88 is the number below: a little wider than the brief's minimum,
 * because the gap has a job the brief did not know about - each answer's label
 * hangs in it, and `quiz.test.ts` fails if a label reaches the plank above.
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
  MOVED BACK for the first-person camera, which is the change that matters most.

  At z 2.5 the column stood 2.2 m from the player's eye. A stack 1.9 m tall at
  2.2 m subtends 46 degrees - wider than the whole frame - so the top and bottom
  answers were off screen and the middle one filled it. Six metres is where three
  coins and their labels sit comfortably inside a 48-degree view, and it is far
  enough that an arrow crossing it reads as a flight rather than as a jump cut.

  Centred on `EYE[1]` rather than above it, so the middle plank is dead ahead and
  the outer two are symmetric about it: the natural thing to do with a bow is
  shoot level, and a column whose centre is above the eye makes the easy shot the
  wrong one.
*/
export const PLANK_AT: [number, number, number] = [0, EYE[1], 6.2]

/**
 * The diorama: a wide, shallow stage of three stations that acts out a card.
 *
 * ## The anchor
 *
 * Where the cube used to stand, at the same depth, because that is the distance
 * the reading camera was already framed for. It sits LOWER than the cube did -
 * the cube was a 2.1 m square whose middle had to clear the player's head, and
 * this is a 2.5 m band whose bottom does.
 */
export const DIORAMA_AT: [number, number, number] = [0, 2.05, 3.6]

/**
 * How far apart the three stations stand, centre to centre.
 *
 * ## Sized by the NARROW window, not the wide one
 *
 * At `STAGE_FOV` the visible width is `2 * d * tan(fov/2) * aspect`, so a 16:9
 * window shows 40% more of this stage than a square one at the same distance.
 * Sizing against a wide window is how a diorama ends up with its first and last
 * stations cropped on a laptop in a split screen.
 *
 * `dioramaSafeWidth()` computes the width that survives an aspect of 1.0, and the
 * pitch is a third of it. Everything that must be READ lives inside that box;
 * only decoration is allowed outside it, and `diorama.test.ts` holds the line.
 */
export const STATION_PITCH = 2.15

/** How tall a station's own content may be, centred on `DIORAMA_AT`. */
export const STATION_HEIGHT = 2.5

/**
 * The width of the reading frame at the diorama's depth, on a SQUARE window.
 *
 * The worst case a player can present, short of a phone held upright - and the
 * one number that decides whether this stage fits. Derived rather than measured
 * so that moving the camera moves the box with it.
 */
export function dioramaSafeWidth(cameraZ: number, fovDegrees = STAGE_FOV): number {
  const distance = DIORAMA_AT[2] - cameraZ
  return 2 * distance * Math.tan((fovDegrees * Math.PI) / 360)
}

/**
 * Which way along X a station index sits.
 *
 * **`+X` is screen LEFT on this stage**, because the camera sits at negative Z
 * looking toward positive Z. Station 0 must READ first, so it takes the positive
 * side. That inversion has now caught this feature out five times - the headline
 * rendered mirrored, the cube opened on the quiz face, all three plank verdicts
 * showed before a shot, the hat's tip flopped out of sight, and the moustache
 * curled the wrong way - so this is a function with a test rather than a sign
 * typed at a mount point.
 */
export function stationX(index: number): number {
  return (1 - index) * STATION_PITCH
}

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
 * Re-derived for the first-person camera. From the eye at 1.62 the headline
 * stands 15.7 in front; the top plank's label reaches 13.5 degrees up, so the
 * headline has to sit above `1.62 + 15.7 * tan(13.5 deg)` = 5.39 or it lands in
 * the answers again. 6.3 puts it at 16.6 degrees - clear of the labels, and still
 * well inside the 24-degree half-frame.
 *
 * It is now the only thing above the coins, the cube having left, which is what
 * makes it worth keeping in shot at all.
 */
export const HEADLINE_QUIZ_Y = 7.1
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
