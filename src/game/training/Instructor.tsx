import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { ShapeGeometry, TorusGeometry, Vector2, Vector3, type Group } from 'three'
import { GLOW, emissive, mattePlastic, plastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { latheProfile, starShape } from '@/art/geometry'
import { CAPE, createCapeRibbon, skinCapeRibbon, taperedSuperellipsoid } from './capeRibbon'
import {
  HAT_PROFILE,
  HAT_STARS,
  WIZARD_HAT,
  hatBends,
  hatRadiusAt,
  hatSlopeAt,
} from './wizardHat'
import {
  EYE,
  FACE_PLATE,
  INSTRUCTOR_HEAD,
  MOUSTACHE,
  eyeCentre,
  facePlateZ,
  moustacheHalf,
} from './instructorFace'
import { INSTRUCTOR_ENTER, INSTRUCTOR_EXIT, INSTRUCTOR_HOME } from './stage'
import { instructorPose } from './instructorPath'
import type { TrainingState } from './trainingMachine'

/**
 * The instructor: a robot head in a wizard hat, with a large moustache.
 *
 * ## Why it is a head and not a character
 *
 * The brief asks for "a little flying robot head", and that is also the cheapest
 * honest thing to build: the round already has a full character standing in it,
 * and a second complete robot would invite a comparison the instructor would lose.
 * A head that flies is a different KIND of thing, which is what makes it read as
 * an instructor rather than as another player.
 *
 * ## What the second pass fixed, because it was not cosmetic
 *
 * The first version was three defects wearing a hat, and each of them was
 * invisible in the code and obvious on the screen:
 *
 * - **The face was inside the visor.** A 0.245 sphere stood in for a face plate
 *   and both eye lenses sat 0.1665 from its centre with a radius of 0.045 - fully
 *   enclosed, on every frame. The moustache was mostly swallowed too. What
 *   reached the screen was a dark ball with a pale rim.
 * - **The hat was a cone**, in one flat bright blue, which reads as a party hat.
 * - **The floppy tip was a detached card.** A 0.34-wide cape panel hung off a
 *   zero-width apex, with a half turn that pointed it straight UP and no rest
 *   bend at all, so it stood over the cone as a separate blue rectangle.
 *
 * The numbers now live in `instructorFace.ts` and `wizardHat.ts`, solved rather
 * than authored wherever a clearance is at stake, and measured on the built
 * geometry by their tests. That is the only reason the first two were found: they
 * were literals in this file, where no test can reach them.
 *
 * ## What is reused and what is not
 *
 * The head is a `taperedSuperellipsoid` from the character's own geometry kit,
 * built here rather than imported from `robotParts.tsx`. That file's `Head`
 * mounts the visor shader, the ear pods, the antenna and the cosmetic sockets and
 * pulls `quality` for its sheen ladder - all of which belong to the hero. Taking
 * it to throw four fifths away would couple the instructor to every future change
 * to the player's face.
 *
 * The HAT TIP is the reuse that matters: `capeRibbon.ts` re-exports the cape's
 * skinned ribbon and the tip is driven by `hatBends` from the head's own
 * velocity. The cape was already a strip of cloth hanging from a point, bending
 * under inertia, skinned on the CPU from four angles. A hat tip is that object.
 */
export function Instructor({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)
  const hat = useRef<Group>(null)
  const previous = useRef(new Vector3(...INSTRUCTOR_ENTER))
  const clock = useRef(0)

  /*
    The tip's ribbon, built once. `createCapeRibbon` allocates a 416-vertex
    geometry and its rest cross-sections; rebuilding it per frame would be a fresh
    GPU upload, which `robotGeometry.ts` opens by naming as the most expensive
    mistake available in its neighbourhood.
  */
  const ribbon = useMemo(() => createCapeRibbon(CAPE.segmentLength * 0.42), [])

  const head = useMemo(() => taperedSuperellipsoid(INSTRUCTOR_HEAD), [])
  const plate = useMemo(() => taperedSuperellipsoid(FACE_PLATE), [])

  /* The crown, as a surface of revolution over the wizard-hat profile. */
  const crown = useMemo(
    () => latheProfile({ points: HAT_PROFILE.map(([r, y]) => new Vector2(r, y)), radialSegments: 24 }),
    [],
  )

  /*
    One star geometry for all five, scaled per instance. Five `ShapeGeometry`
    builds of the same ten-point outline would be five buffers to upload for one
    silhouette.
  */
  const star = useMemo(() => new ShapeGeometry(starShape(5, 1, 0.44)), [])

  /*
    One half of the moustache. The other is the same buffer mirrored by a scale,
    which is safe because neither is ever mutated.
  */
  const whisker = useMemo(
    () =>
      new TorusGeometry(
        MOUSTACHE.radius,
        MOUSTACHE.tube,
        MOUSTACHE.radialSegments,
        MOUSTACHE.tubularSegments,
        MOUSTACHE.arc,
      ),
    [],
  )

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    // Clamped, because a backgrounded tab returns one enormous delta and an
    // unclamped one would teleport the instructor and snap the hat inside out.
    const dt = Math.min(delta, 1 / 20)
    clock.current += dt

    /*
      The machine's state arrives as a REF rather than as props, and that is a
      correctness fix rather than a style choice.

      `TrainingScene` steps the machine inside `useFrame`, which does not
      re-render; passing `phase` as a prop would read a ref during render, which
      React's own lint rule refuses because the component would not update when it
      changed. `RobotModel` takes `anim` the same way and for the same reason.
    */
    const state = run.current
    if (!state) return
    const pose = instructorPose(state.phase, state.elapsed)
    g.position.set(pose[0], pose[1], pose[2])

    /*
      Velocity by difference rather than by differentiating the path.

      The path is piecewise and its analytic derivative is discontinuous at the
      joins, which would make the hat snap at exactly the two moments the player is
      watching it. A difference over one frame is continuous by construction and
      costs one subtraction.
    */
    const vx = (pose[0] - previous.current.x) / dt
    const vz = (pose[2] - previous.current.z) / dt
    previous.current.set(pose[0], pose[1], pose[2])

    // Face the player, who is back down the -Z axis from the stage.
    g.rotation.y = Math.atan2(-pose[0], -pose[2])

    if (hat.current) skinCapeRibbon(ribbon, hatBends(vx, vz, clock.current))
  })

  return (
    <group ref={group}>
      {/* The head. `shell()` is the hero's own preset, so the instructor is made
          of the same plastic as the player rather than of a different white. */}
      <mesh geometry={head} castShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      {/*
        The face plate: a wide shallow band across the eyes, sunk into the head.

        Not `visorPlate()` and not the face shader - the instructor never blinks
        or emotes, and mounting the hero's face material here would make every
        future expression change touch it.
      */}
      <mesh geometry={plate} position={[0, FACE_PLATE.y, facePlateZ()]} castShadow>
        <meshPhysicalMaterial {...plastic(palette.plate)} />
      </mesh>

      {/*
        The eyes, whose centres are SOLVED against the plate's own front surface
        rather than authored - see `eyeCentre`. Authored, they were inside it.

        `meshPhysicalMaterial`, and the material TYPE here is a bug fix rather
        than a preference. These were `<meshBasicMaterial {...emissive(...)} />`,
        and `emissive()` returns MeshPhysicalMaterial props. Spreading those onto
        a basic material threw inside three's own `refreshUniformsCommon` on every
        single frame, which killed the render partway through: the scene showed
        its floor and its dummies from an earlier good frame and NOTHING drawn
        after the instructor ever appeared again.

        It is worth naming the shape of that failure, because it is the one this
        project keeps meeting: nothing was missing from the scene graph. The
        instructor existed, its parent chain was visible, and its world position
        was exactly right - three separate checks all said it was fine, and the
        canvas was simply a stale picture.
      */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={eyeCentre(side)}>
          <sphereGeometry args={[EYE.radius, 14, 12]} />
          <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
        </mesh>
      ))}

      {/*
        The moustache, which is most of the character in two primitives.

        Below the plate rather than behind it, and standing proud of the head's
        own surface by a solved amount - `moustacheZ`. The arc sweeps past half a
        circle so each half curls back on itself, and the roll turns those curls
        UP: a moustache that droops reads as sad, and the brief asked for playful.

        `wrap` turns each half around the head so its outer end follows the cheek
        rather than hanging off it - see `MOUSTACHE.wrap` for why a planar torus
        on a curved face has no single depth that works without it.
      */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} geometry={whisker} {...moustacheHalf(side)} castShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.hull)} />
        </mesh>
      ))}

      {/* The hat: brim, band, crown, stars, and a tip that flops off the apex. */}
      <group ref={hat} position={[0, WIZARD_HAT.lift, 0]} rotation={[0, 0, WIZARD_HAT.lean]}>
        {/*
          The brim, WIDER than the crown by a clear margin. A rim at the crown's
          own radius - which is what the first version had - reads as a seam where
          the cone meets the head; a brim is the second horizontal that turns a
          cone into a hat.
        */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <torusGeometry args={[WIZARD_HAT.brimRadius, WIZARD_HAT.brimTube, 10, 28]} />
          <meshPhysicalMaterial {...mattePlastic(HAT_CLOTH)} />
        </mesh>
        {/* The brim's cloth, so it is a disc with a rolled edge and not a hoop. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[WIZARD_HAT.brimRadius, 28]} />
          <meshPhysicalMaterial {...mattePlastic(HAT_CLOTH)} side={2} />
        </mesh>

        <mesh geometry={crown} castShadow receiveShadow>
          <meshPhysicalMaterial {...mattePlastic(HAT_CLOTH)} />
        </mesh>

        {/* The band: the one bright note on the cloth, in the world's own silver. */}
        <mesh position={[0, WIZARD_HAT.bandY, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[WIZARD_HAT.bandRadius, WIZARD_HAT.bandTube, 8, 24]} />
          <meshPhysicalMaterial {...plastic(palette.hardware)} />
        </mesh>

        {/*
          The stars, laid ON the cloth: placed at the profile's own radius for
          their height and pitched by its local slope, so each lies flat against
          the surface instead of standing off it like a badge on a pin.

          `HAT_STAR_LIFT` is the one authored number - a hair off the surface,
          because a decal coplanar with the solid it sits on z-fights, and the
          failure is glitter rather than a missing star.
        */}
        {HAT_STARS.map((s, i) => (
          <group key={i} rotation={[0, s.theta, 0]}>
            <mesh
              geometry={star}
              position={[0, s.y, hatRadiusAt(s.y) + HAT_STAR_LIFT]}
              rotation={[hatSlopeAt(s.y), 0, i * 0.7]}
              scale={s.size}
            >
              <meshPhysicalMaterial {...mattePlastic(HAT_STAR)} side={2} />
            </mesh>
          </group>
        ))}

        {/*
          The floppy tip, continuing from the crown's own top radius.

          Narrowed by a scale rather than by forking `createCapeRibbon`, which the
          player's cape also uses. Mounted pointing UP along the crown's axis and
          folded over by `WIZARD_HAT.droop` at rest - the first version had no
          rest bend, so it stood vertically above the hat as a separate card.
        */}
        <group
          position={[0, WIZARD_HAT.height, 0]}
          rotation={[0, 0, Math.PI]}
          scale={[WIZARD_HAT.tipWidth, 1, WIZARD_HAT.tipDepth]}
        >
          <mesh geometry={ribbon.geometry} castShadow>
            <meshPhysicalMaterial {...mattePlastic(HAT_CLOTH)} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/**
 * The cloth.
 *
 * A local constant rather than `palette.helmet`, which is the hero's own
 * `#2F7AD2` - a bright, saturated mid-blue that is right on a robot's helmet and
 * wrong on a wizard. It made the first hat read as moulded plastic, which a hat
 * is not, and it left no room for anything on it to be lighter.
 *
 * This is a deep night-blue instead. It is the same hue family the design
 * direction settled on - blues, silvers, greys - taken to the dark end so the
 * silver band and the stars have somewhere to sit. `palette.ts` carries the
 * world's own vocabulary and every addition to it invites a `band()` claim; this
 * is one prop in one mini-game.
 */
const HAT_CLOTH = '#28356B'
/*
  The moustache's colour is `palette.hull`, and it took two passes to land there.

  First it was `palette.shellShadow`, the hero's own shadow tone at `#d8d2c6` -
  within a few percent of the head's own value, so the moustache read as a moulded
  handle on the same piece of plastic rather than as hair.

  Then it was a navy pulled from the hat's cloth, which fixed the value problem
  and overcorrected on hue: the character came out blue from brim to chin, and the
  moustache read as part of the costume rather than as part of the wizard.

  `palette.hull` is the world's own neutral - a grey with a cool tilt of about
  nine percent saturation, half the head's value and a fifth of the navy's. It
  separates from the face without joining the hat, and being a palette entry
  rather than a local constant is the honest form for a colour that is structural
  rather than a costume choice.
*/
/** The stars: pale silver, well under the bloom threshold. Cloth, not light. */
const HAT_STAR = '#C9D6EC'
/** How far a star floats off the cloth, to keep it out of a z-fight. */
const HAT_STAR_LIFT = 0.006

/** Re-exported so the scene can place a light at the instructor without guessing. */
export { INSTRUCTOR_HOME, INSTRUCTOR_EXIT }
