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
import { beveledExtrude, latheProfile } from '@/art/geometry'
import type { QualitySettings } from '@/art/quality'
import {
  BACKPACK_BLOCK,
  CAPE_PANEL,
  EAR_POD_SHAPE,
  FACE_PLATE,
  HAND,
  HEAD_SHELL,
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
 * Sized from `HEAD_SHELL` rather than from literals, because the ear pods are
 * placed against its flat side and the arithmetic that keeps them proud of it
 * has to be reachable from a test.
 */
export function HeadShell({ quality }: Q) {
  return (
    <RoundedBox
      args={[HEAD_SHELL.width, HEAD_SHELL.height, HEAD_SHELL.depth]}
      radius={HEAD_SHELL.radius}
      smoothness={HEAD_SHELL.smoothness}
      castShadow
      receiveShadow
    >
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
 * An ear pod, at its own node's origin. The pair are the widest thing on the
 * head and the only feature that breaks its boxy corners.
 *
 * One material and not two. This used to pick `chrome()` on a tier with
 * `sheenHero` and `plastic(palette.accentDeep)` otherwise, and describe itself
 * as "the one chrome element on the character". No tier sets `sheenHero`: it is
 * `false` on low, medium AND high in `quality.ts`, so the chrome branch had
 * never once rendered and the claim in the comment was never true of any build.
 * Deleted rather than repaired, because the reference brief puts its reflection
 * showpiece on the dome plate and `Helmet` below now carries it.
 *
 * `accentDeep` rather than `accent`, per the spec's part table, so the pods
 * group with the backpack as hardware and leave the head reading as mostly
 * shell.
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
  const { width, height, depth, radius, vent } = BACKPACK_BLOCK
  return (
    <>
      <RoundedBox args={[width, height, depth]} radius={radius} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </RoundedBox>
      {/*
        Deliberately under the bloom threshold at GLOW.source, which is 66% of
        it. The vent should read as powered without haloing: it faces away from
        the camera almost always, and a bloom there would rim-light the back of
        the head from behind.
      */}
      <RoundedBox
        args={[vent.width, vent.height, vent.depth]}
        radius={vent.radius}
        smoothness={2}
        position={[0, vent.y, vent.z]}
      >
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
      <sphereGeometry args={[HAND.radius, 16, 12]} />
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

/**
 * Earned after the first zone, and scaled to sit on the wider head.
 *
 * ## The dome is metal, and that is the fix for a measured defect
 *
 * `.critique/round1-findings.md` F13: the same dome, the same rig and the same
 * tier measure (0.895, 0.813, 0.510) pale gold in `hub-totem` and
 * (0.522, 0.581, 0.244) olive in `hub-backlit`, a hue swing of about 22 degrees
 * with GREEN above RED in the second. It is the largest single mass on the
 * character's silhouette and it changes hue family between shots.
 *
 * The critique guesses at a green ambient picking up the lawn. It is not the
 * lawn, and the arithmetic is worth writing down because the obvious fix would
 * have chased the wrong light. `palette.unlocked` is #ffd45e, which is
 * (1.000, 0.658, 0.112) in linear light - a green channel two thirds of red and
 * a blue channel of almost nothing. `Lighting.tsx` runs
 * `hemisphereLight('#7fbdf0', '#6fbe3d')`, and the SKY half of that, which is
 * what an upward-facing dome sees most of, is (0.212, 0.509, 0.872) linear:
 * green is 2.4 times red. Multiply the two and the diffuse term is
 * (0.212, 0.335, 0.098) - green above red, olive, exactly what was measured.
 * The grass ground colour and the green bounce card contribute; the cyan sky
 * does most of it. Any illuminant on the cool side of the wheel does this to an
 * albedo whose blue channel is 0.112, so the dome was always going to be
 * unstable while it was painted.
 *
 * `metalness: 1` deletes the diffuse term outright, which is what makes the
 * instability go rather than shrink. three's `hemisphereLight` contributes to
 * irradiance and irradiance only, so a full metal receives nothing from it at
 * all. What is left is the environment and the analytic speculars, tinted by
 * gold's own F0 - and because the tint multiplies rather than mixes, a green
 * reflection comes back through a 0.112 blue and a 0.658 green as gold.
 *
 * That also pays the debt in the reference brief's section 8, which asks for
 * "a reflective chrome dome plate, used explicitly to show off environment
 * reflections", and which nothing in this build has ever delivered:
 * `EarPod` claimed the job behind a `sheenHero` flag that is false on every
 * tier. Gold-tinted rather than white chrome, because the character is not
 * allowed the white-and-blue livery and because the dome should stay the same
 * colour it has always been in the shots where it already read correctly.
 *
 * Roughness 0.22 against a clearcoat at 0.02 is the bible's two-lobe rule met
 * exactly (`ccRoughness <= baseRoughness - 0.20`), and the clearcoat is the
 * second, uncoloured lobe - a metal with one lobe reads as a prop, and the
 * white highlight from a lacquer coat is what says "moulded" rather than
 * "machined". A tighter base lobe than the 0.35 the paint had should also
 * shrink the clipped patch F15 measured at (255, 252, 243) on this surface,
 * though it will make what is left hotter; that is a thing to measure, not a
 * thing to claim.
 */
export function Helmet() {
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          {...metal(palette.unlocked, {
            metalness: 1,
            roughness: 0.22,
            clearcoat: 0.35,
            clearcoatRoughness: 0.02,
            envMapIntensity: 1.5,
          })}
          side={2}
        />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.07, 0.2, 0.44]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

/**
 * One cape panel.
 *
 * ## Why this is a solid slab and not a quad
 *
 * `.critique/round1-findings.md` F4, which both reviewers led with and which
 * one of them called the single thing that makes the set read as a hobby
 * project. Four `PlaneGeometry` panels at `side: 2`, in `palette.token`
 * magenta. A zero-thickness quad has one normal over its whole area, so it
 * takes one lighting value however good the rig is and reads as unlit paint; it
 * has no edge for a bevel highlight, which is the reference's stated tell for
 * moulded plastic; and near edge on it collapses to a coloured line, which is
 * literally what `hub-character` caught it doing on the floor beside his foot.
 *
 * `CAPE_PANEL` makes each one a 0.030 slab with a 0.010 round, so there is a
 * flat face between two bevels and a lit edge down each side. That serves the
 * world rule rather than fighting it: fabric is replaced with vinyl here, and
 * four RIGID panels with visible joins is the correct read. A panel with no
 * thickness cannot have a join to see.
 *
 * ## Why it is no longer magenta
 *
 * `palette.token` is a semantic hue and it is spoken for. `Flowers.tsx` uses it
 * for the pink dome flowers and `HubIsland.tsx` for the token crystal, so it
 * means "collectible" everywhere else in the world, and the bible's rule is
 * that semantic hues are globally constant. It is also the same hue as the pink
 * cones F6 is about, at a display luma of about 0.57, which puts the hero's
 * cape squarely inside the walkable gameplay band.
 *
 * `accentDeep` is the character's own family: the pods, the backpack the cape
 * literally hangs off, and this. It keeps the highest chroma in frame on the
 * hero, which is the reference's separation mechanism, without borrowing a
 * meaning from the props.
 */
export function CapeSegment({ length }: { length: number }) {
  return (
    /*
      Pushed back behind its node by `CAPE_PANEL.z`.

      The back socket is deliberately coincident with the backpack block, which
      is what the cape hangs off, but the pack is 0.14 deep and spans z -0.22 to
      -0.36 around that point. A panel at the socket itself therefore starts
      INSIDE the pack and appears to grow out of the middle of it. The offset
      clears its rear face by 0.010 without moving the socket, whose position is
      a contract the cosmetic system depends on - and now that the panel has a
      thickness the clearance is measured from its FRONT face, which is the part
      `robotGeometry.test.ts` exists to keep true.
    */
    <RoundedBox
      args={[CAPE_PANEL.width, length, CAPE_PANEL.thickness]}
      radius={CAPE_PANEL.bevel}
      smoothness={CAPE_PANEL.bevelSmoothness}
      position={[0, -length / 2, CAPE_PANEL.z]}
      castShadow
      receiveShadow
    >
      <meshPhysicalMaterial {...vinyl(palette.accentDeep)} />
    </RoundedBox>
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
