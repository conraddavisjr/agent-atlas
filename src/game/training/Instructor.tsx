import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { ConeGeometry, TorusGeometry, Vector3, type Group } from 'three'
import { GLOW, emissive, mattePlastic, plastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { CAPE, createCapeRibbon, skinCapeRibbon } from './capeRibbon'
import { WIZARD_HAT, hatBends } from './wizardHat'
import { INSTRUCTOR_ENTER, INSTRUCTOR_EXIT, INSTRUCTOR_HOME } from './stage'
import { instructorPose } from './instructorPath'
import type { TrainingState } from './trainingMachine'

/**
 * The instructor: a robot head in a wizard hat, with a moustache.
 *
 * ## Why it is a head and not a character
 *
 * The brief asks for "a little flying robot head", and that is also the cheapest
 * honest thing to build: the round already has a full character standing in it,
 * and a second complete robot would invite a comparison the instructor would lose.
 * A head that flies is a different KIND of thing, which is what makes it read as
 * an instructor rather than as another player.
 *
 * ## What is reused and what is not
 *
 * The head shell is a `superellipsoid`-style dome from the same vocabulary the
 * player's head uses, but it is built here rather than imported from
 * `robotParts.tsx`. That file's `Head` mounts the visor shader, the ear pods, the
 * antenna and the cosmetic sockets, and pulls `quality` for its sheen ladder -
 * all of which belong to the hero and none of which this needs. Importing it to
 * throw four fifths away would couple the instructor to every future change to
 * the player's face.
 *
 * The HAT is the reuse that matters, and it is real: `capeRibbon.ts` re-exports
 * the cape's skinned ribbon, and the tip is driven by `hatBends` from the head's
 * own velocity. The cape was already a strip of cloth hanging from a point,
 * bending under inertia, skinned on the CPU from four angles. A hat tip is the
 * same object.
 */
export function Instructor({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)
  const hatTip = useRef<Group>(null)
  const previous = useRef(new Vector3(...INSTRUCTOR_ENTER))
  const clock = useRef(0)

  /*
    The tip's ribbon, built once. `createCapeRibbon` allocates a 416-vertex
    geometry and its rest cross-sections; rebuilding it per frame would be a fresh
    GPU upload, which `robotGeometry.ts` opens by naming as the most expensive
    mistake available in its neighbourhood.
  */
  const ribbon = useMemo(() => createCapeRibbon(CAPE.segmentLength * 0.42), [])

  const cone = useMemo(
    () =>
      /*
        Radial 20, height 1. A cone keeps its sharp apex, which is the one place
        in this project a 90-degree corner is allowed: the world rule is about
        moulded plastic, and a wizard hat with a rounded tip is a garden gnome.
      */
      new ConeGeometry(WIZARD_HAT.radius, WIZARD_HAT.height, 20, 1, true),
    [],
  )

  /* The moustache: two half-tori, which is a moustache in one primitive each. */
  const whisker = useMemo(() => new TorusGeometry(0.15, 0.042, 8, 16, Math.PI * 0.85), [])

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

    if (hatTip.current) {
      skinCapeRibbon(ribbon, hatBends(vx, vz, clock.current))
      hatTip.current.rotation.z = WIZARD_HAT.lean
    }
  })

  return (
    <group ref={group}>
      {/* The head. `shell()` is the hero's own preset, so the instructor is made
          of the same plastic as the player rather than of a different white. */}
      <mesh castShadow>
        <sphereGeometry args={[0.34, 24, 18]} />
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      {/* The visor, as a plain dark plate. Not `visorPlate()` and not the face
          shader: the instructor never blinks or emotes, and mounting the hero's
          face material here would make every future expression change touch it. */}
      <mesh position={[0, 0.02, 0.3]} castShadow>
        <sphereGeometry args={[0.245, 20, 14]} />
        <meshPhysicalMaterial {...plastic(palette.plate)} />
      </mesh>
      {/*
        `meshPhysicalMaterial`, and the material TYPE here is a bug fix rather
        than a preference.

        These two were `<meshBasicMaterial {...emissive(...)} />`, and
        `emissive()` returns MeshPhysicalMaterial props - `emissive`,
        `emissiveIntensity`, `roughness`, `metalness`. Spreading those onto a
        basic material threw inside three's own `refreshUniformsCommon` on every
        single frame, which killed the render partway through: the scene showed
        its floor and its dummies from an earlier good frame and NOTHING drawn
        after the instructor ever appeared again.

        It is worth naming the shape of that failure, because it is the one this
        project keeps meeting: nothing was missing from the scene graph. The
        instructor existed, its parent chain was visible, and its world position
        was exactly right - three separate checks all said it was fine, and the
        canvas was simply a stale picture. The console was the only place the
        truth was written down.

        `glowStrip()` is the preset that DOES return basic-material props, and it
        is the right choice for a flat additive line. An eye lens is a lit
        surface, so it takes the physical one.
      */}
      <mesh position={[-0.085, 0.05, 0.44]}>
        <sphereGeometry args={[0.045, 12, 10]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
      <mesh position={[0.085, 0.05, 0.44]}>
        <sphereGeometry args={[0.045, 12, 10]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>

      {/*
        The moustache, which is most of the character in two primitives.

        Set below the visor and turned so the ends sweep upward, because a
        moustache that droops reads as sad and the brief asked for playful.
      */}
      <group position={[0, -0.16, 0.3]}>
        <mesh geometry={whisker} rotation={[0, 0, Math.PI * 0.62]} position={[-0.1, 0, 0]} castShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
        </mesh>
        <mesh geometry={whisker} rotation={[0, Math.PI, Math.PI * 0.62]} position={[0.1, 0, 0]} castShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
        </mesh>
      </group>

      {/* The hat: a leaning cone with a flowing tip hanging off its apex. */}
      <group ref={hatTip} position={[0, WIZARD_HAT.lift, 0]}>
        <mesh geometry={cone} position={[0, WIZARD_HAT.height / 2, 0]} castShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.helmet)} />
        </mesh>
        {/* The brim, so the cone sits ON the head rather than through it. */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[WIZARD_HAT.radius * 0.94, 0.05, 8, 20]} />
          <meshPhysicalMaterial {...mattePlastic(palette.helmet)} />
        </mesh>
        <group position={[0, WIZARD_HAT.height, 0]} rotation={[0, 0, Math.PI]}>
          <mesh geometry={ribbon.geometry} castShadow>
            <meshPhysicalMaterial {...mattePlastic(palette.helmet)} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** Re-exported so the scene can place a light at the instructor without guessing. */
export { INSTRUCTOR_HOME, INSTRUCTOR_EXIT }
