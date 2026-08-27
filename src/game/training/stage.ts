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
 * The specimen: one large model that becomes each of a card's three forms.
 *
 * ## The anchor
 *
 * Y is unchanged from the three-station diorama it replaced, and that is the
 * whole reason this change is a Z and a scale rather than a re-layout: the forms
 * are authored upward from their own base plane, so 2.05 stays the base plane
 * and `SPECIMEN_HEIGHT` grows upward from it into the empty band above.
 *
 * Y came DOWN 9 cm after the first frame with the specimen in it, which is about
 * 15 screen pixels at this camera - one metre projects to roughly 174 px on a 934
 * px frame. The exhibit and its nameplate sit closer to the reader chrome that
 * carries the Next button, which leaves more clear air above the specimen and
 * tightens the whole composition toward the bottom of the frame where the reader
 * is already looking.
 *
 * Z came FORWARD, from 3.6 to 3.0, together with `DIORAMA_BACK` going to zero in
 * `cameraDirector.ts`. Between them the range drops from 9.5 m to 8.0 m. That
 * does not by itself make the specimen bigger - see the note in `specimen.ts` on
 * why dollying buys nothing - but it puts the reading camera at the round's own
 * rest distance, which means `speech2`, `instructorOut`, `dioramaIn` and
 * `reading` all share one camera Z and the teaching act has no camera move in it
 * at all beyond a lift and a re-aim.
 */
export const SPECIMEN_AT: [number, number, number] = [0, 1.96, 3.0]

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

/**
 * How far apart the three key words stand under the specimen, centre to centre.
 *
 * The nameplate is the one thing that did NOT collapse into a single object. The
 * model became one; the words stayed three, all present, one lit. A reader who
 * presses Next after two seconds has still seen every claim named, in order,
 * with the one they watched marked - which a single changing word cannot give
 * them, because `reading` waits on the player and has no idea where the loop is.
 *
 * Derived from the longest word either card can put in the row. `CORRECTED` is
 * nine characters, which at fontSize 0.22 with the house `letterSpacing` of 0.06
 * measures about 1.25 m, so a pitch of 1.60 leaves 0.35 m of gutter between
 * neighbours. 1.45 was tried first and buys only 0.20 m minus the kerning, which
 * on two words of nine characters is not a gap anyone reads as a gap.
 *
 * At 1.60 the row spans `1.25 + 2 * 1.60 = 4.45 m` against a safe width of
 * 5.82 m, so it is inside a square window with 24% to spare.
 */
export const WORD_PITCH = 1.6

/** How tall a station's own content may be, centred on `SPECIMEN_AT`. */
export const STATION_HEIGHT = 2.5

/**
 * The width of the reading frame at the specimen's depth, on a SQUARE window.
 *
 * **The constraint this function encodes is no longer the binding one, and that
 * is worth knowing before trusting it.** With three stations side by side the
 * stage was 6.75 m wide and the question was whether the outer two survived a
 * narrow window. With one specimen the binding constraint is VERTICAL: the band
 * between the HUD reading card and the robot's head. And vertical extent is
 * aspect-independent, because `STAGE_FOV` is the vertical field of view - a
 * square window and a 21:9 window show exactly the same amount of height.
 *
 * So the worst case a player can present is now a SHORT window, not a narrow
 * one, and the check that matters is the DOM card's pixel height against
 * `innerHeight` rather than anything this function returns. It stays because the
 * nameplate is still a horizontal object and still has to fit; it is a ceiling,
 * not the design driver it used to be.
 *
 * Derived rather than measured so that moving the camera moves the box with it.
 */
export function dioramaSafeWidth(cameraZ: number, fovDegrees = STAGE_FOV): number {
  const distance = SPECIMEN_AT[2] - cameraZ
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
export function stationX(index: number, pitch: number = STATION_PITCH): number {
  return (1 - index) * pitch
}

/**
 * Where a prompt word sits inside the guessing form, so the sentence reads left
 * to right ON SCREEN.
 *
 * **Descending x, which is the opposite of what anybody writes first.** `+X` is
 * screen left here, so the FIRST word takes the HIGHEST x. Laid out the obvious
 * way, `YOUR ROYAL` renders as `ROYAL YOUR` - which is exactly what shipped, and
 * which is the sixth time this stage's axis inversion has caught the feature out.
 *
 * It lives here beside `stationX` rather than in `Guessed.tsx` for two reasons:
 * it is the same class of decision, and a component file that also exports
 * constants cannot be fast-refreshed. Both of them are functions rather than
 * literals so that the inversion is asserted rather than typed at a mount point,
 * which is the only thing that has ever caught it.
 */
export function promptX(index: number): number {
  return PROMPT_START - index * PROMPT_STEP
}

const PROMPT_START = 0.92
const PROMPT_STEP = 0.34

/**
 * How many words the prompt has, which is what sets where the blank is.
 *
 * A constant rather than `PROMPT.length` because `stage.ts` holds positions and
 * `dioramaCopy.ts` holds words, and a layout file importing copy is the wrong
 * direction. `dioramaCopy.test.ts` asserts the two agree, so adding a third
 * prompt word fails a test rather than quietly putting the blank inside the
 * sentence.
 */
export const PROMPT_WORDS = 2

/** One step past the last prompt word, which is where a guess has to land. */
export const BLANK_X = PROMPT_START - PROMPT_WORDS * PROMPT_STEP

/** The headline, standing large behind everything. */
export const HEADLINE = 'WHAT IS AI?'
export const HEADLINE_AT: [number, number, number] = [0, 4.6, 16]

/**
 * Where the headline goes when its job is done.
 *
 * ## Its job ends at the arrival, and that is a decision rather than a tidy-up
 *
 * The sign exists so a player dropped into a room they did not build can see in
 * one glance why they are standing there. Once the first reading card is up, the
 * HUD's own scene card names the lesson in DOM and the sign is saying it twice -
 * in the exact band the specimen now needs. So it leaves on `instructorOut`,
 * with the wizard, and the introduction packs up in one gesture.
 *
 * It used to park at 7.1 and stay in shot through the quiz, justified as "the
 * only thing above the coins, the cube having left". That justification is void:
 * the thing above the coins is `TrainingHUD`'s question banner, which is already
 * there.
 *
 * ## Why 8.7 and not the 10.8 a reading-frame derivation gives
 *
 * The sign is only ever VISIBLE during `instructorOut`, so that is the frame it
 * has to clear.
 *
 * **The instructor camera is 55 cm LOWER than the reading camera, and forgetting
 * that is how this number went wrong twice.** `SPECIMEN_UP` lifts the reading
 * pose to y 3.25; the instructor pose takes no lift, so it sits at `CAMERA_UP`,
 * which is 2.70. A derivation that used 3.25 for both put the top of the
 * instructor frame at 7.80 and this constant at 8.7 - and at 8.7 the sign stops
 * moving while its lowest letters are still 62 cm inside the shot.
 *
 * Done against the pose that actually exists: the camera is at `(0, 2.70, -5.0)`
 * aiming at `(-0.63, 2.1, 3.4)`, which is 4.07 degrees below horizontal. At the
 * sign's z of 16 the range is 21.0, so the top of a 40 degree frame is
 * `2.70 + 21.0 * tan(20 - 4.07)` = **8.69**. troika anchors this line at its
 * middle, so the lowest visible cap sits about `0.34 * HEADLINE_SIZE` = 0.63
 * below the anchor, and the sign is clear at 9.32. 9.6 adds 28 cm.
 *
 * `diorama.test.ts` derives all of this from `cameraPose('instructorOut')` rather
 * than trusting the paragraph, which is what caught the 8.7.
 *
 * If the sign is ever un-hidden during `dioramaIn`, the reading frame becomes the
 * binding one instead and the number goes up again - which is why the test reads
 * the pose it is checking rather than hardcoding a frame.
 */
export const HEADLINE_AWAY_Y = 9.6
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
