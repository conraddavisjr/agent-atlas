import { RoundedBox } from '@react-three/drei'
import { palette } from '@/art/palette'
import {
  GLOW,
  chrome,
  emissive,
  mattePlastic,
  metal,
  plastic,
  rubber,
  shell,
  vinyl,
  visorPlate,
} from '@/art/materials'
import { beveledExtrude, latheProfile } from '@/art/geometry'
import type { QualitySettings } from '@/art/quality'
import {
  EAR_POD_SHAPE,
  FACE_PLATE,
  roundedDiscProfile,
  superellipsePoints,
  taperedSuperellipsoid,
  TORSO,
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
 * The face plate: an extruded squircle.
 *
 * `beveledExtrude` rather than a raw `ExtrudeGeometry`, because three's own
 * bevel option insets the contour near the caps and leaves the side edges
 * exactly as sharp as the polygon that produced them. On the single most
 * looked-at surface on the character, a sharp edge is the whole difference
 * between a moulded window and a decal.
 */
const FACE_PLATE_GEOMETRY = beveledExtrude({
  outline: superellipsePoints(FACE_PLATE.a, FACE_PLATE.b, FACE_PLATE.n, FACE_PLATE.segments),
  depth: FACE_PLATE.depth,
  bevel: FACE_PLATE.bevel,
  bevelSegments: 3,
})

/**
 * An ear pod: a disc on its side with both rims filleted.
 *
 * Lathed about Y and then turned so its axis lies along X, which is what makes
 * the pods flap forward and back rather than up and down when the head moves.
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
 * The head being wider than the torso at every height is what makes a shape
 * read as an infant rather than as a short adult, and it matters more than the
 * head-height ratio does. The previous model had a 0.56 head on a 0.62 torso,
 * which is the same relationship the wrong way round, and it is why the
 * character read as a small robot instead of as a toy.
 *
 * Corner radius 0.110 at smoothness 4, which is six segments per corner arc and
 * a 1.9 degree facet. Going to 5 costs geometry for nothing visible at this
 * size; going below 4 puts steps on the terminator.
 */
export function HeadShell({ quality }: Q) {
  return (
    <RoundedBox args={[0.72, 0.54, 0.62]} radius={0.11} smoothness={4} castShadow receiveShadow>
      <meshPhysicalMaterial {...heroShell(quality)} />
    </RoundedBox>
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
 * An ear pod. The one chrome element on the character.
 *
 * The reference calls chrome the reflection showpiece, and there is nothing
 * chrome in this world yet. One small part on the character is the cheapest
 * possible demonstration that the environment map exists, and it is also the
 * fastest way to notice when the Lightformer rig breaks, because chrome shows
 * the rig literally rather than as a hint. Kept to the pods rather than the
 * head, because a chrome dome is the one silhouette this character is not
 * allowed to have.
 */
export function EarPod({ quality }: Q) {
  return (
    <mesh geometry={EAR_POD_GEOMETRY} castShadow receiveShadow>
      {quality.sheenHero ? (
        <meshPhysicalMaterial {...chrome({ envMapIntensity: 1.2 })} />
      ) : (
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      )}
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
        The bulb. GLOW.bloom is 1.25x the threshold, which for amber is an
        emissiveIntensity of 4.89. At the raw 2.0 it used to carry, its
        luminance was 0.895 against a threshold of 1.75, so the one warm light
        on the character had never glowed.
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
 */
export function Diaper({ quality }: Q) {
  return (
    <RoundedBox args={[0.62, 0.28, 0.52]} radius={0.13} smoothness={4} position={[0, 0, -0.03]} castShadow receiveShadow>
      <meshPhysicalMaterial {...heroShell(quality)} />
    </RoundedBox>
  )
}

/** The backpack, and the vent that says the thing is powered. */
export function Backpack() {
  return (
    <>
      <RoundedBox args={[0.36, 0.26, 0.14]} radius={0.055} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </RoundedBox>
      {/*
        Deliberately under the bloom threshold at GLOW.source, which is 66% of
        it. The vent should read as powered without haloing: it faces away from
        the camera almost always, and a bloom there would rim-light the back of
        the head from behind.

        Radius 0.008 rather than the table's 0.018, for the same reason as the
        chest panel: the vent is 0.02 deep, so 0.018 is four times what fits.
      */}
      <RoundedBox args={[0.22, 0.04, 0.02]} radius={0.008} smoothness={2} position={[0, 0.03, -0.075]}>
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </RoundedBox>
    </>
  )
}

// ---------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------

/** The upper arm, at the shoulder node's origin. */
export function UpperArm() {
  return (
    <mesh position={[0, -0.13, 0]} castShadow>
      <capsuleGeometry args={[0.075, 0.09, 4, 12]} />
      <meshPhysicalMaterial {...plastic(palette.accent)} />
    </mesh>
  )
}

/**
 * A mitten hand, at the hand socket's origin.
 *
 * 0.28 across against a 0.72 head is 0.39 head-widths, inside the reference's
 * 0.35 to 0.45. Hidden when a prop is socketed, so a held object replaces the
 * mitten rather than growing out of it.
 */
export function Hand({ quality }: Q) {
  return (
    <mesh castShadow receiveShadow>
      <sphereGeometry args={[0.14, 16, 12]} />
      <meshPhysicalMaterial {...heroShell(quality)} />
    </mesh>
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
 * A foot, at the foot node's origin.
 *
 * 0.44 long against a 1.36 body is 32% of body height, and the pair span 0.70
 * against a 0.72 head. A wide planted stance under a heavy head is what says
 * "low centre of gravity, stable, controllable", and it is the half of the read
 * that the previous model already had right.
 */
export function Foot() {
  return (
    <RoundedBox args={[0.32, 0.17, 0.44]} radius={0.065} smoothness={3} castShadow receiveShadow>
      <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
    </RoundedBox>
  )
}

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

/** Earned after the first zone. Scaled to sit on the wider head. */
export function Helmet() {
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial {...plastic(palette.unlocked)} side={2} />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.07, 0.2, 0.44]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

/**
 * One cape segment.
 *
 * `vinyl` rather than `mattePlastic`, because the reference's deepest world
 * rule is that when the team needed hair or cloth they replaced it with vinyl.
 * A chalky ABS plane is the exact thing that rule exists to prevent. Four rigid
 * segments with visible joins is the correct read for this world; a smooth
 * drape is not.
 */
export function CapeSegment({ length }: { length: number }) {
  return (
    /*
      Pushed 0.08 behind its node.

      The back socket is deliberately coincident with the backpack block, which
      is what the cape hangs off, but the backpack is 0.14 deep and spans
      z -0.22 to -0.36 around that point. A quad at the socket itself therefore
      starts INSIDE the pack and appears to grow out of the middle of it. This
      clears its back face by 0.01 without moving the socket, whose position is
      a contract the cosmetic system depends on.
    */
    <mesh position={[0, -length / 2, -0.08]} castShadow>
      <planeGeometry args={[0.34, length]} />
      <meshPhysicalMaterial {...vinyl(palette.token)} side={2} />
    </mesh>
  )
}

/** The single static quad the cheapest tier gets instead of a simulated chain. */
export function StaticCape() {
  return (
    <mesh position={[0, -0.32, -0.04]} rotation={[0.18, 0, 0]} castShadow>
      <planeGeometry args={[0.34, 0.66]} />
      <meshPhysicalMaterial {...vinyl(palette.token)} side={2} />
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
