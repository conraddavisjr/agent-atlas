import { RoundedBox } from '@react-three/drei'
import { palette } from '@/art/palette'
import {
  GLOW,
  emissive,
  mattePlastic,
  metal,
  plastic,
  rubber,
  shell,
  vinyl,
  visorPlate,
} from '@/art/materials'
import { latheProfile } from '@/art/geometry'
import type { QualitySettings } from '@/art/quality'
import {
  ARM_BAND,
  ARM_BEVEL,
  BACKPACK_BLOCK,
  DIAPER,
  EAR_POD_SHAPE,
  FACE_PLATE,
  FINGER,
  fingerCentreY,
  FOOT,
  HAND,
  HEAD_CAP,
  HEAD_SHELL,
  SOLE_LIGHT,
  roundedDiscProfile,
  superellipsePoints,
  superellipsoidPatch,
  taperedSuperellipsoid,
  TORSO,
  type CapeRibbon,
} from './robotGeometry'

/**
 * What the robot is made of, part by part.
 *
 * Split from `RobotModel.tsx` so that file is only the rig: which node parents
 * which, and which ref goes where. Nothing in here holds a rig reference or
 * knows anything about animation, and nothing in `RobotModel` knows what a part
 * is made of. Changing the head's material and changing what the head hangs off
 * are different jobs and they now live in different files.
 *
 * Proportions come from `PROPORTIONS` and `REST` in `robotPose.ts`, which is
 * where the numbers are asserted. The sizes below are the parts themselves,
 * measured in their own parent's frame.
 */

// ---------------------------------------------------------------------------
// Proposed palette values.
//
// `src/art/palette.ts` is frozen for this pass and owned by the integrator, so
// these are declared here and listed in the stream's report for promotion. They
// are NOT meant to stay local: a colour that lives at its call site is a colour
// no other file can read and no test can assert a band on, which is the exact
// failure `soilDeep` was promoted out of one round ago.
//
// Only ONE new hue is needed, which is worth stating because a livery change
// sounds like it should need a family. The copper on the head and the copper on
// the arm are `palette.accentDeep`, already the character's hardware colour on
// the ear pods and the backpack, and the blue on the limbs is the same blue as
// the helmet.
// ---------------------------------------------------------------------------

/**
 * PROPOSED `palette.helmet`. The reference's dome blue.
 *
 * Display luma 0.406, which is inside the empty 0.38 to 0.56 gap between the
 * midground and gameplay bands - deliberately, and it is the reason this hex
 * rather than a lighter or a more obvious one. The bands exist so the player can
 * read where they can stand; the hero is a value anomaly and is meant to belong
 * to neither. A blue at 0.49 sits 0.01 from `accentDeep`'s 0.4775, so the dome
 * and the copper cap on it would be the same value and would merge in greyscale.
 * At 0.406 there is 0.072 of separation between them, plus the largest hue
 * distance available.
 *
 * `palette.ts`'s header comment becomes wrong when this lands. It currently reads
 * "Deliberately distinct from Astro: the robot is warm amber on off-white with a
 * horizontal cyan visor, not blue-and-white with two round eyes and a chrome
 * dome." Every clause of that is now false on purpose, and the integrator owns
 * rewriting it.
 */


// ---------------------------------------------------------------------------
// Geometry, built once at module load.
//
// Three shapes need generating and none of them ever changes, so they are
// module constants rather than useMemos. A BufferGeometry rebuilt per frame is
// a fresh GPU upload, and a BufferGeometry rebuilt per mount leaks one per
// scene transition.
// ---------------------------------------------------------------------------

/**
 * The torso: an ovoid, wider at the base, and square-ish enough to read as a
 * moulded block rather than as an egg.
 */
const TORSO_GEOMETRY = taperedSuperellipsoid(TORSO)

/**
 * The head: an oblong helmet, and the largest single mass on the character.
 *
 * A superellipsoid rather than the `RoundedBox` it was, because 59% of the box's
 * height was one flat normal and the user reads the result as "shaped like a
 * rounded rectangle". `HEAD_SHELL` carries the exponent table it was chosen
 * against and the reason its extents did not move.
 */
const HEAD_GEOMETRY = taperedSuperellipsoid(HEAD_SHELL)

/**
 * The diaper: a tapered cushion widest at the hip line.
 *
 * A `taperedSuperellipsoid` rather than the `RoundedBox` it was, because a corner
 * radius 93% of the box's half-height left 7% of flat top and made the front
 * outline a 2.21 : 1 stadium, which is the "odd and bubbly" the user is reading.
 * `DIAPER` carries the width ladder and the reason the radius was NOT being
 * clamped, which is what the brief for this pass suspected.
 */
const DIAPER_GEOMETRY = taperedSuperellipsoid(DIAPER)

/**
 * The face plate: a squircle patch lying on the helmet's own surface.
 *
 * It was a `beveledExtrude` of the same outline, mounted on the head's flat front
 * face. There is no flat front face now, and a flat plate on a superellipsoid head
 * stands 0.141 m off it at the rim against a plate 0.032 m deep.
 * `superellipsoidPatch` carries that measurement and the three alternatives that
 * were rejected; `FACE_PLATE` carries the reason not one number in `VISOR` had to
 * move, which is that the patch emits the UVs the quad emitted.
 *
 * `beveledExtrude` is still the right tool for a flat plate and is still used for
 * nothing else on this character, so its import is gone from this file.
 */
const FACE_PLATE_GEOMETRY = superellipsoidPatch({
  host: HEAD_SHELL,
  outline: superellipsePoints(FACE_PLATE.a, FACE_PLATE.b, FACE_PLATE.n, FACE_PLATE.segments),
  halfW: FACE_PLATE.a,
  halfH: FACE_PLATE.b,
  centreY: FACE_PLATE.y,
  facing: 1,
  inset: FACE_PLATE.inset,
  rise: FACE_PLATE.rise,
  chamfer: FACE_PLATE.chamfer,
  chamferFrac: FACE_PLATE.chamferFrac,
  rings: FACE_PLATE.rings,
  solid: true,
})

/**
 * The copper cap: the same generator, the same host, the other side of the head.
 *
 * A patch and not a `RoundedBox`, because the box drew "reads as a panel stuck on
 * rather than an integrated shape" and because on an oval head it also gapped - it
 * would have stood 0.047 clear of the crown at its own centre depth with daylight
 * under its rim. A shell whose inner surface IS the helmet's surface cannot do
 * either. `HEAD_CAP` carries the footprint the generator refused to build and the
 * one it accepted.
 */
const HEAD_CAP_GEOMETRY = superellipsoidPatch({
  host: HEAD_SHELL,
  outline: superellipsePoints(HEAD_CAP.halfW, HEAD_CAP.halfH, HEAD_CAP.n, HEAD_CAP.segments),
  halfW: HEAD_CAP.halfW,
  halfH: HEAD_CAP.halfH,
  centreY: HEAD_CAP.y,
  facing: -1,
  inset: HEAD_CAP.inset,
  rise: HEAD_CAP.rise,
  chamfer: HEAD_CAP.chamfer,
  chamferFrac: HEAD_CAP.chamferFrac,
  rings: HEAD_CAP.rings,
  solid: true,
})

/**
 * An ear pod: a filleted can with both rims rounded.
 *
 * Lathed about Y and then turned so its axis lies along X, which is what makes
 * the pods flap forward and back rather than up and down when the head moves.
 *
 * The `rotateZ` is load-bearing and invisible if it goes: without it the pods
 * are two cans lying on their sides through the top of the head, which still
 * renders, still animates and still reports every triangle present.
 */
const EAR_POD_GEOMETRY = latheProfile({
  points: roundedDiscProfile(
    EAR_POD_SHAPE.radius,
    EAR_POD_SHAPE.halfThickness,
    EAR_POD_SHAPE.fillet,
    EAR_POD_SHAPE.filletSteps,
  ),
  radialSegments: EAR_POD_SHAPE.radialSegments,
})
EAR_POD_GEOMETRY.rotateZ(Math.PI / 2)
/*
  Then squash Z, which is what turns the disc into the narrow fin.

  Order matters and is silent if it is wrong: before the `rotateZ` the lathe's
  radial plane is X-Z, so scaling Z here would thin the pod on a diameter and then
  the rotate would carry that thinning into the pod's HEIGHT. After the rotate, Z is
  the fore-aft axis and this is the fin's depth. `EAR_POD_SHAPE.depthScale` carries
  which axis is which and why it is Z rather than Y - the short version is that
  `pose.earPodL.rx` sweeps the Y-Z plane, so a pod round in Y-Z had an invisible
  flap.

  `BufferGeometry.scale` routes through `applyMatrix4`, which puts the normals
  through the inverse transpose and renormalises them, so the shading is correct
  under the non-uniform scale.
*/
EAR_POD_GEOMETRY.scale(1, 1, EAR_POD_SHAPE.depthScale)

/** The mitten's oblong body. See `HAND` for why it is a superellipsoid at `taperTop` 1. */
const HAND_GEOMETRY = taperedSuperellipsoid(HAND)

/**
 * One finger, and where along Y it sits.
 *
 * `FINGER_CENTRE_Y` is DERIVED rather than authored, and that is the whole defence
 * against the failure mode this part is shaped like. The hand's lower surface is not
 * flat: at the finger's own centreline `|x| = 0.052` it sits at y -0.1508, while the
 * hand's bottom pole is at -0.1600. Authoring the finger against the pole - which is
 * the number you get by reading `HAND.b` - would place it 0.009 too low and leave a
 * gap under the palm on both sides. So the root is solved on the surface at the
 * finger's own x with `superellipsoidY`, and `FINGER.embed` is how far above that
 * surface the box's top goes.
 *
 * The sign: `superellipsoidY` returns the positive `|y|`, and the fingers hang off
 * the -Y end, so the surface is at its negation.
 */
const FINGER_GEOMETRY = taperedSuperellipsoid(FINGER)
const FINGER_CENTRE_Y = fingerCentreY()

/**
 * The two rings on the upper arm, lathed from the same profile as the ear pods.
 *
 * NOT rotated, unlike the pods. The lathe revolves about Y and the arm capsule's
 * axis is already Y, so a band round the arm wants the profile exactly as it
 * comes out. The pods need the `rotateZ` because their axis points sideways; if
 * these were given one too they would be two discs standing edge-on through the
 * arm, which would render, animate and report every triangle present.
 */
const ARM_BAND_GEOMETRY = latheProfile({
  points: roundedDiscProfile(
    ARM_BAND.radius,
    ARM_BAND.halfThickness,
    ARM_BAND.fillet,
    ARM_BAND.filletSteps,
  ),
  radialSegments: ARM_BAND.radialSegments,
})

const ARM_BEVEL_GEOMETRY = latheProfile({
  points: roundedDiscProfile(
    ARM_BEVEL.radius,
    ARM_BEVEL.halfThickness,
    ARM_BEVEL.fillet,
    ARM_BEVEL.filletSteps,
  ),
  radialSegments: ARM_BEVEL.radialSegments,
})

/**
 * The shell material, with the sheen decided at construction.
 *
 * `MeshPhysicalMaterial` bumps its version when sheen crosses zero, which
 * forces a shader recompile, so a tier without `sheenHero` has to be given
 * `sheen: 0` here rather than have it turned off afterwards.
 */
function heroShell(quality: QualitySettings) {
  return shell(palette.shell, quality.sheenHero ? {} : { sheen: 0 })
}

type Q = { quality: QualitySettings }

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

/**
 * The head shell. 0.72 x 0.54 x 0.62, and deliberately the widest mass on the
 * character.
 *
 * A superellipsoid at exponents 0.75, not a `RoundedBox`. The extents are the same
 * to the millimetre and the form is the whole change; `HEAD_SHELL` has the normal
 * table it was chosen against, and `superellipsoidPatch` has what it cost the face
 * plate.
 *
 * The head being wider than the torso at every height is what makes a shape
 * read as an infant rather than as a short adult, and it matters more than the
 * head-height ratio does. The previous model had a 0.56 head on a 0.62 torso,
 * which is the same relationship the wrong way round, and it is why the
 * character read as a small robot instead of as a toy.
 *
 * Sized from `HEAD_SHELL` rather than from literals, because the ear pods are
 * placed against its flat side and the arithmetic that keeps them proud of it
 * has to be reachable from a test.
 *
 * ## The head is now the helmet
 *
 * It is `palette.helmet` blue rather than `palette.shell` off-white, and that is
 * the largest single change in the livery. The reference's head is entirely a
 * blue helmet with a dark faceplate on the front and a copper cap on the back;
 * there is no white on it. The torso, the diaper and the hand keep the off-white
 * `shell`, which is the other half of the reference: a blue head on a white body.
 *
 * Still `shell()` and not `plastic()`, so the head keeps the hero preset's
 * clearcoat, its `envMapIntensity` of 1.15 and its warm sheen. That is a
 * deliberate reading of the preset's own doc, which warns against giving anything
 * in the WORLD the hero white - it says nothing against using the hero material
 * with another colour on the hero itself, and the head is the surface with the
 * best claim to the environment rig on the whole model now that the dome is gone.
 * The preset's warm `#ffb489` emissive floor at 0.08 does more work here than it
 * did on white: a cool albedo with a warm floor is the split-tone the reference
 * asks for, on the part that carries most of the silhouette.
 */
export function HeadShell({ quality }: Q) {
  return (
    <mesh geometry={HEAD_GEOMETRY} castShadow receiveShadow>
      <meshPhysicalMaterial {...shell(palette.helmet, quality.sheenHero ? {} : { sheen: 0 })} />
    </mesh>
  )
}

/**
 * The copper cap on the back of the head.
 *
 * The reference's head is a blue dome with a copper or gold cap over its rear
 * crown, and it is the second most recognisable thing about it after the eyes.
 * Its own shape rather than a painted region, because the reference's is
 * physically a separate moulded part with a visible step where it meets the dome,
 * and because a painted band on a `RoundedBox` would need a UV layout this head
 * does not have.
 *
 * `palette.accentDeep` rather than `palette.gold`. Gold is `#e8b84b` at display
 * luma 0.731, which sits inside the gameplay band of 0.56 to 0.74 and within
 * 0.004 of `palette.rock`'s 0.735 - so in greyscale a cap on the character's head
 * would read at exactly the value of the deck he walks on, which is the same
 * defect that took the magenta cape out of `.critique/round1-findings.md` F6.
 * `accentDeep` is 0.4775, in the empty gap, and it is already the character's own
 * hardware family: the ear pods, the backpack, and the two rings on each arm.
 * Nothing new is borrowed and nothing means "reward" that should not.
 *
 * All the clearance arithmetic - 0.020 proud at the back, 0.0075 over the rear
 * crown, 0.054 at the upper corners, and no intersection with either the antenna
 * or the ear pods - is in `HEAD_CAP` where a test can reach it.
 */
export function HeadCap() {
  return (
    <mesh geometry={HEAD_CAP_GEOMETRY} castShadow receiveShadow>
      <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
    </mesh>
  )
}

/**
 * The near-black glossy plate the visor sits inside.
 *
 * Layer A of the two-layer face. It is what makes the visor read as a lit
 * element behind glass rather than as a glowing rectangle painted on white, and
 * it is the surface in the whole scene that shows off the environment rig most
 * directly, because a dark plate at roughness 0.28 has nothing else to show.
 *
 * Fully opaque and it never blooms: at an albedo of 0.0056 linear, no lighting
 * in this project can push it past 0.02.
 */
export function FacePlate() {
  return (
    <mesh geometry={FACE_PLATE_GEOMETRY} castShadow>
      <meshPhysicalMaterial {...visorPlate()} />
    </mesh>
  )
}

/**
 * An ear pod, at its own node's origin. The pair are the widest thing on the head.
 *
 * ## It was rendering inside out, on every angle, since it was built
 *
 * The user's note is that the ears disappear in profile. The cause is not in this
 * component and not in the material: `roundedDiscProfile` descended, so
 * `LatheGeometry` gave the pod inward normals and inverted winding, and with the
 * default `FrontSide` the only thing drawn was the interior of its far wall. The
 * signed volumes, the reason the defect is worst in profile specifically, and the
 * two arm rings it also affected are all on `EAR_POD_SHAPE` and
 * `roundedDiscProfile`.
 *
 * The claim in this comment's own history that the pods "break the head's boxy
 * corners" is retired: the head has no boxy corners any more, and the pods cannot
 * break its profile outline at all - they clear it by 0.165 in y and 0.185 in z. In
 * profile they read by shading, which is why the fillet went 0.030 to 0.055.
 *
 * One material and not two. This used to pick `chrome()` on a tier with
 * `sheenHero` and `plastic(palette.accentDeep)` otherwise, and describe itself
 * as "the one chrome element on the character".
 *
 * **The claim that justified deleting the chrome branch has gone stale and is
 * corrected here rather than repeated.** It read "No tier sets `sheenHero`: it is
 * `false` on low, medium AND high in `quality.ts`". That was true when it was
 * written and is not true now: `quality.ts` sets `sheenHero` false on low but
 * **true on medium and high**, applied in the same commit that fixed the whole
 * sheen ladder, whose own comment says `shell()`'s "warm grazing-angle lobe...
 * has never rendered on any tier". So on two tiers out of three the chrome branch
 * WOULD have rendered, and the reasoning for removing it was retired by a change
 * in another file two rounds after it was made.
 *
 * The branch still stays deleted, on the merits rather than on the stale claim: a
 * material that differs between tiers is the tier ladder changing the art rather
 * than the fidelity, which the art bible's section 7 and round 1's F5 both forbid,
 * and it is a worse offence than the sheen ladder because chrome and orange
 * plastic are not the same picture at two costs.
 *
 * That leaves the reference brief's "reflective chrome dome plate, used explicitly
 * to show off environment reflections" unbuilt again, since `Helmet` has been
 * deleted. It is deliberately left unbuilt: the dome was the biggest mass on the
 * silhouette and the thing the user asked to be rid of first, and re-siting the
 * reflection showpiece is a decision rather than a repair. The head shell now
 * carries the highest `envMapIntensity` on the character at 1.15.
 *
 * `accentDeep` rather than `accent`, per the spec's part table, so the pods
 * group with the backpack, the head cap and the arm bevels as hardware.
 */
export function EarPod() {
  return (
    <mesh geometry={EAR_POD_GEOMETRY} castShadow receiveShadow>
      <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
    </mesh>
  )
}

/** The lower antenna segment, at the antennaBase node's origin. */
export function AntennaLower() {
  return (
    <mesh position={[0, 0.045, 0]} castShadow>
      <cylinderGeometry args={[0.015, 0.015, 0.09, 8]} />
      <meshPhysicalMaterial {...metal(palette.rock)} />
    </mesh>
  )
}

/** The upper antenna segment and its bulb, at the antennaMid node's origin. */
export function AntennaUpper() {
  return (
    <>
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.013, 0.013, 0.08, 8]} />
        <meshPhysicalMaterial {...metal(palette.rock)} />
      </mesh>
      {/*
        The bulb. GLOW.bloom is 1.25x the threshold, which for amber's linear
        luminance of 0.4470 is an emissiveIntensity of 4.06. At the raw 2.0 it
        used to carry, its luminance was 0.894, so the one warm light on the
        character had never glowed.

        The 4.89 this comment used to give was computed against a threshold of
        1.75 and is stale: BLOOM_THRESHOLD has since been MEASURED at 1.45, so
        the true value is 1.25 * 1.45 / 0.4470 = 4.06. Nothing was wrong in the
        code, which derives it - only in the number written beside it, which is
        the argument for deriving it.

        And it is visible again. The bulb's top reaches head-local y 0.520 and
        the deleted `Helmet` dome's inner surface above it was at 0.667, so this
        emissive - normalised twice to clear a threshold that was itself measured
        twice - had been rendering into the inside of an opaque metal hemisphere.
      */}
      <mesh position={[0, 0.075, 0]}>
        <sphereGeometry args={[0.05, 14, 12]} />
        <meshPhysicalMaterial {...emissive(palette.accent, GLOW.bloom)} />
      </mesh>
    </>
  )
}

// ---------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------

/** The torso, at the chest node's origin. */
export function Torso({ quality }: Q) {
  return (
    <mesh geometry={TORSO_GEOMETRY} castShadow receiveShadow>
      <meshPhysicalMaterial {...heroShell(quality)} />
    </mesh>
  )
}

/**
 * The amber chest panel. The single accent, kept to one place so it stays a
 * focal point instead of decoration.
 *
 * Corner radius 0.020 rather than the 0.045 the spec's chamfer table asks for.
 * That table computes the radius as a percentage of the panel's height, but the
 * binding constraint is its thickness: the panel is 0.05 deep, so anything at
 * or above 0.025 is a pill rather than a chamfered plate. `RoundedBoxGeometry`
 * silently clamps to half the smallest dimension, so the specified value would
 * not have errored, it would just have quietly produced a different shape.
 */
export function ChestPanel() {
  return (
    <RoundedBox args={[0.3, 0.2, 0.05]} radius={0.02} smoothness={3} position={[0, 0.02, 0.245]} castShadow>
      <meshPhysicalMaterial {...plastic(palette.accent)} />
    </RoundedBox>
  )
}

/**
 * The diaper, at the hips node's origin.
 *
 * It flares back out to the full 0.62 below a torso that narrows to 0.52, which
 * is the second inversion in the silhouette and the one that gives the
 * character a waist without giving it a waistline.
 *
 * That flare survives; the pill it was does not. `DIAPER` carries the two
 * measurements behind "his hips look odd and bubbly", the finding that
 * `RoundedBoxGeometry` was NOT clamping the radius, and why reducing the radius
 * would have moved the complaint rather than answering it.
 */
export function Diaper({ quality }: Q) {
  return (
    <mesh geometry={DIAPER_GEOMETRY} position={[0, 0, DIAPER.z]} castShadow receiveShadow>
      <meshPhysicalMaterial {...heroShell(quality)} />
    </mesh>
  )
}

/**
 * The backpack, and the circular port that says the thing is powered.
 *
 * The port replaces a 0.22 x 0.04 rectangular vent, and the reason it replaces
 * rather than joins it is arithmetic: the pack's rear face is flat only over
 * 0.250 by 0.150, and a circle large enough to read leaves no room for a bar
 * underneath it without straddling a corner round. `BACKPACK_BLOCK` has the
 * numbers.
 *
 * Three rings, one draw each. Cylinders with their axis turned onto Z rather than
 * lathed discs, because these are flat-faced machined rings seen face-on and
 * nothing here is read at a grazing angle where a fillet would earn its
 * triangles.
 */
export function Backpack() {
  const { width, height, depth, radius, port } = BACKPACK_BLOCK
  return (
    <>
      <RoundedBox args={[width, height, depth]} radius={radius} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </RoundedBox>

      {/*
        Copper bezel, the LEAST proud of the three.

        The three stack outward, each smaller than and slightly in front of the one
        behind it, so what stays visible of each is the annulus its successor does
        not cover. Nesting them inward - which is what "a lit pip in a recess"
        sounds like it wants - hides both inner rings completely, because
        `cylinderGeometry` builds a solid disc and not a ring. `BACKPACK_BLOCK.port`
        has the z ladder and the reason the total protrusion is capped at 0.013.
      */}
      <mesh position={[0, 0, port.bezelZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[port.bezelRadius, port.bezelRadius, port.bezelDepth, port.segments]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>

      {/*
        The dark surround. `visorPlate()` and not a dark plastic, because this is
        the same material problem as the face: a lit element reads as a light
        source against a glossy near-black ground, and as a bright sticker against
        a matte one.
      */}
      <mesh position={[0, 0, port.wellZ]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[port.wellRadius, port.wellRadius, port.wellDepth, port.segments]} />
        <meshPhysicalMaterial {...visorPlate()} />
      </mesh>

      {/*
        The lit pip, and the one place the deleted vent's reasoning is inherited
        verbatim. Deliberately UNDER the bloom threshold at GLOW.source, which is
        66% of it: this faces away from the camera almost always, and a bloom here
        would rim-light the back of the head from behind.
      */}
      <mesh position={[0, 0, port.coreZ]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[port.coreRadius, port.coreRadius, port.coreDepth, port.segments]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
    </>
  )
}

// ---------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------

/**
 * The upper arm, at the shoulder node's origin: a white limb with a blue band
 * and a copper cuff bevel.
 *
 * ## What changed and why the arm is no longer amber
 *
 * It was one bare `plastic(palette.accent)` capsule, and the reference's arm is
 * white with a blue band. Three of the reference's marks were missing from one
 * part: white limbs, a blue accent band, and a bevel.
 *
 * `heroShell` rather than `plastic(palette.shell)`, so the arm shades as the same
 * moulded material as the torso it hangs off rather than as a separate white
 * object. That does cost the character its only amber limb, and the amber is not
 * lost: `ChestPanel` is unchanged and is still the single accent panel, which was
 * always where the spec's part table put the focal point.
 *
 * Both rings sit inside y -0.175 to -0.085, which is the only band where the
 * capsule is at its full 0.075 radius. See `ARM_BAND`: outside it the capsule is
 * already curving in, so a fixed-radius ring stands proud by a growing amount and
 * reads as a collar floating off the arm. At the shoulder end of the capsule the
 * radius has fallen to 0.063, where this band would stand 0.019 proud instead of
 * 0.007.
 */
export function UpperArm({ quality }: Q) {
  return (
    <group position={[0, -0.13, 0]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.075, 0.09, 4, 12]} />
        <meshPhysicalMaterial {...heroShell(quality)} />
      </mesh>
      {/* The blue band. Same hue as the helmet, which is what makes the livery
          read as one design rather than as a blue head on a striped arm. */}
      <mesh geometry={ARM_BAND_GEOMETRY} position={[0, ARM_BAND.y + 0.13, 0]} castShadow>
        <meshPhysicalMaterial {...plastic(palette.helmet)} />
      </mesh>
      {/* The cuff bevel, in the hardware copper. Narrower and less proud, so it
          reads as a moulded step rather than as a second band. */}
      <mesh geometry={ARM_BEVEL_GEOMETRY} position={[0, ARM_BEVEL.y + 0.13, 0]} castShadow>
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

/**
 * A mitten hand with two fingers, at the hand socket's origin.
 *
 * The oblong body is 0.23 x 0.32 x 0.20 where it was a 0.28 sphere, and the two
 * fingers stand 0.090 clear of its palm end. `HAND` and `FINGER` in
 * `robotGeometry.ts` carry the sizing, the reason the hand narrowed rather than
 * widened, and the measurement of the sphere hand's interpenetration with the hips
 * that paid for it.
 *
 * Hidden when a prop is socketed, so a held object replaces the mitten rather than
 * growing out of it.
 *
 * `shellShadow` rather than `shell`, so the hand is a different colour from the
 * arm, which is one of the reference marks. It was already different when the arm
 * was amber and stopped being so the moment the arm went white, so this is a
 * consequence of that change rather than an independent one. 0.825 display luma
 * against the shell's 0.946 is a clear step without leaving the off-white family:
 * a glove moulded in a second shot of the same plastic, which is what the
 * reference's hands look like. Still `shell()` and not `mattePlastic`, so it keeps
 * the hero clearcoat and sheen.
 *
 * One material across body and fingers, deliberately. A finger in a second colour
 * would read as a glove over a hand, and the whole part is one moulding.
 */
export function Hand({ quality }: Q) {
  const material = shell(palette.shellShadow, quality.sheenHero ? {} : { sheen: 0 })
  return (
    <>
      <mesh geometry={HAND_GEOMETRY} castShadow receiveShadow>
        <meshPhysicalMaterial {...material} />
      </mesh>
      {/*
        Two fingers, mirrored. Both use the same geometry instance, which is safe
        because neither is ever mutated - the mirror is a position, not a scale.
      */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={FINGER_GEOMETRY}
          position={[side * FINGER.x, FINGER_CENTRE_Y, 0]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial {...material} />
        </mesh>
      ))}
    </>
  )
}

/** The shin, at the knee node's origin. */
export function Shin() {
  return (
    <mesh castShadow>
      <capsuleGeometry args={[0.085, 0.1, 4, 12]} />
      <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
    </mesh>
  )
}

/**
 * A boot, at the foot node's origin.
 *
 * 0.14 x 0.13 x 0.20 where it was 0.32 x 0.17 x 0.44. `FOOT` carries the sizing and
 * the two measurements that say a literal 80% linear reduction detaches the boot from
 * the leg; the short version is that the shin's bottom tip is at world y 0.115, so the
 * boot's top has to reach past it, and that is what fixes the height at 0.13.
 *
 * ## The stance survives the shrink, which is the thing worth protecting
 *
 * "A wide planted stance under a heavy head is what says low centre of gravity,
 * stable, controllable" was written about the 0.70 span of the old pair, and the pair
 * now span 0.52 against a 0.72 head. What carries that read is the leg SEPARATION,
 * `REST.legL/R.x` at +-0.19, and it has not moved. The old feet were so long that they
 * nearly touched - the gap between them was 0.060, exactly at the floor
 * `robotPose.test.ts` asserts - so most of that 0.70 was foot rather than stance. The
 * gap is now 0.240.
 *
 * The boot is also CENTRED on the leg now. `REST.footL.z` was 0.06, which put the box
 * 0.06 forward of the shin's axis, and because `REST_ROTATION.legL.ry` splays the leg
 * by -0.1 rad that forward offset also threw the boot 0.0060 sideways off the axis.
 * Both go with the z.
 */
export function Foot() {
  return (
    <>
      <RoundedBox
        args={[FOOT.width, FOOT.height, FOOT.depth]}
        radius={FOOT.radius}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
      </RoundedBox>
      {/*
        The blue oval on the sole.

        It PROTRUDES below the sole plane rather than sitting flush with it or
        recessed above it, and that is not a preference. The foot is a solid
        `RoundedBox` spanning y -FOOT.height/2 to +FOOT.height/2, so the first version
        of this pad - placed a millimetre "above the sole plane" to avoid z-fighting
        with the ground - sat entirely inside opaque rubber and could not be seen at
        any time from any angle. See `SOLE_LIGHT`.

        The y below is derived from `FOOT.height` and not the literal -0.085 it was.
        That literal was half the old height, so shrinking the boot without touching
        this line would have left the pad floating 0.020 under the sole: the same
        defect as the original, arrived at from the opposite direction.

        GLOW.source and not GLOW.bloom, and this is the one place on the character
        where the choice is genuinely arguable. The reference's sole lights do
        glow. But the art bible keeps the must-bloom tier "deliberately tiny", the
        eyes are already in it, and a bloom on a downward-facing surface a few
        millimetres off the ground would halo onto the floor and fight the contact
        blob, which is the single highest value-per-cost item on the character. So
        the soles read as lit and do not halo, and this is the dial to turn if a
        render says otherwise.

        Scaled on z rather than built as an ellipse, because a cylinder scaled
        non-uniformly is still exactly an elliptical cylinder and its normals stay
        correct: the scale is on the mesh, so three renormalises through the normal
        matrix.
      */}
      <mesh
        position={[0, -FOOT.height / 2 - SOLE_LIGHT.proud + SOLE_LIGHT.thickness / 2, 0]}
        scale={[1, 1, SOLE_LIGHT.stretchZ]}
      >
        <cylinderGeometry
          args={[SOLE_LIGHT.radius, SOLE_LIGHT.radius, SOLE_LIGHT.thickness, SOLE_LIGHT.segments]}
        />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
    </>
  )
}

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

/**
 * The head cosmetic socket is deliberately empty.
 *
 * ## What was here, and the three measurements that removed it
 *
 * `Helmet()`: a gold `metal(palette.unlocked)` open hemisphere of radius 0.42 at
 * `side: DoubleSide`, plus a 0.07 x 0.20 x 0.44 accentDeep crest, mounted at
 * head-local (0, 0.30, 0) whenever `cosmetics.head === 'helmet'`. It had no rig
 * ref, no quality gate and no test asserting a single thing about it, and it was
 * the largest single mass on the character's silhouette.
 *
 * The arithmetic that condemned it is recorded in full on `HEAD_CAP` in
 * `robotGeometry.ts`, because that is where a test can reach the numbers. The
 * short form is three defects, each independently sufficient:
 *
 *   1. It overhung the head by 0.06 per side in width and **0.11 per side in
 *      depth**, so it stood proudest in the axis the camera lives behind.
 *   2. Its rim sat 0.03 above the crown with `DoubleSide`, so the lit gold
 *      INTERIOR of the hemisphere was visible through an open slot all the way
 *      round.
 *   3. It sealed the antenna inside itself. The emissive bulb's top reaches
 *      head-local y 0.520 against an inner dome surface at 0.667, so the one warm
 *      light on the character was rendering into the inside of a hat.
 *
 * ## Why nothing replaces it in the socket
 *
 * The head has been rebuilt to the reference - blue dome, copper rear cap, two
 * round lenses - and everything the dome was trying to be is now part of the head
 * itself rather than a cosmetic on top of it. A second dome over that would be
 * the same defect twice.
 *
 * The socket group stays, unconditionally, and `cosmetics.head === 'helmet'` is
 * still reachable from `lessons.ts`, so a player who earns the helmet now sees
 * nothing change. That is the intended state until there is a decision about what
 * belongs on the crown; the alternative was to leave a shiny orb in the frame
 * while the decision was pending.
 */

/**
 * The cape, as one continuous ribbon.
 *
 * ## What this replaces
 *
 * Four nested `RoundedBox` slabs of 0.34 x 0.18 x 0.03, each a child of the one
 * above and each rotated by its own spring: a staircase of rigid plates with a
 * 0.030 lip at every hinge, opening and closing as the character ran.
 *
 * The panel version was itself a fix, for `.critique/round1-findings.md` F4 -
 * "a flat unlit magenta quad is attached to the character in every shot" - and
 * that fix is deliberately not undone here. F4 is about a zero-thickness quad
 * having one normal over its whole area, no edge to catch a bevel highlight and a
 * collapse to a coloured line when seen near edge on. So the ribbon still has the
 * full 0.030 of thickness and hard-edged 0.010 chamfers down both long edges; it
 * is a continuous moulded vinyl SHEET, not a subdivided plane. `CAPE_RIBBON` in
 * `robotGeometry.ts` carries the construction and the reason it is skinned on the
 * CPU rather than in a vertex shader.
 *
 * ## Why it is still `accentDeep`
 *
 * `palette.token` is a semantic hue and it is spoken for. `Flowers.tsx` uses it
 * for the pink dome flowers and `HubIsland.tsx` for the token crystal, so it means
 * "collectible" everywhere else in the world, and the bible's rule is that
 * semantic hues are globally constant. It is also the same hue as the pink cones
 * F6 is about, at a display luma of about 0.57, which puts the hero's cape squarely
 * inside the walkable gameplay band.
 *
 * `accentDeep` at 0.4775 is the character's own hardware family - the pods, the
 * head cap, the arm bevels, and the backpack the cape literally hangs off - and it
 * sits in the empty gap between bands where the hero belongs.
 *
 * `vinyl()` unpatched, which is the whole payoff of skinning on the CPU: the cape
 * keeps its clearcoat, its sheen, its shadow casting and its shadow receiving,
 * none of which a from-scratch `ShaderMaterial` would have had.
 *
 * ## The geometry is owned by the rig, not by this part
 *
 * `ribbon.geometry` is mutated every frame by `skinCapeRibbon`, so it is one
 * instance per mounted character rather than a module constant. It is created in
 * `RobotModel` and handed down. Nothing about animation is visible from here,
 * which is the boundary this file is split along: the ribbon arrives as a
 * geometry, exactly as `TORSO_GEOMETRY` does.
 */
export function CapeSurface({ ribbon }: { ribbon: CapeRibbon }) {
  return (
    <mesh geometry={ribbon.geometry} castShadow receiveShadow>
      <meshPhysicalMaterial {...vinyl(palette.accentDeep)} />
    </mesh>
  )
}

export function HandProp() {
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.13, 14, 12]} />
      <meshPhysicalMaterial {...plastic(palette.unlocked)} />
    </mesh>
  )
}
