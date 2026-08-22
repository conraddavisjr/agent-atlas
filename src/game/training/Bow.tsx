import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Mesh } from 'three'
import { GLOW, emissive, mattePlastic, plastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { DURATIONS, type TrainingState } from './trainingMachine'
import { easeOutCubic } from './quiz'

/**
 * The bow and its plunger arrow.
 *
 * ## It is a prop that aims itself, not something the robot holds
 *
 * The brief describes Astro grabbing the bow and drawing the string. Posing the
 * hero's arms for it would mean editing `robotPose.ts`, which drives eleven joints
 * from a spring solver and carries the heaviest test file in the project - a large
 * change to a load-bearing module for one mini-game.
 *
 * So the bow anchors at the character's right-hand rest position and eases in with
 * a spark, and "Astro grabs it" is the bow arriving AT the hand rather than the
 * hand reaching for it. From behind, at this distance, the read is the same. The
 * honest version wants the `hand_r` cosmetic socket that `SocketName` already has,
 * and that is a separate piece of plumbing rather than something to smuggle in
 * here.
 *
 * ## The aim
 *
 * The bow turns to face wherever the pointer is, using the same world point the
 * shot uses - `AimPlane` reports it once per frame and both the bow and the hit
 * test read it. Two systems each casting their own ray can disagree at the rim,
 * and the player would see the bow pointing at a plank while the arrow missed it.
 */
export function Bow({
  run,
  aim,
}: {
  run: RefObject<TrainingState>
  /** The live aim point in world space, written by `AimPlane`. */
  aim: RefObject<[number, number, number]>
}) {
  const group = useRef<Group>(null)
  const arrow = useRef<Group>(null)
  const string = useRef<Mesh>(null)
  const target = useRef(new Vector3())

  useFrame(() => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    /*
      The bow exists from `arming` onward. Before that there is nothing to aim at,
      and a bow lying around during the reading would be a promise the round has
      not made yet.
    */
    const armed =
      state.phase === 'arming' ||
      state.phase === 'aiming' ||
      state.phase === 'rejecting' ||
      state.phase === 'accepting'

    if (!armed) {
      g.visible = false
      return
    }
    g.visible = true

    /*
      The spark-in. During `arming` the bow scales up from nothing in the back half
      of the phase, after the planks have staggered in - the brief's order is
      planks first, then the bow.
    */
    const appear =
      state.phase === 'arming'
        ? easeOutCubic(
            Math.max(0, (state.elapsed - (DURATIONS.arming ?? 2.2) * 0.55) / ((DURATIONS.arming ?? 2.2) * 0.45)),
          )
        : 1
    g.scale.setScalar(appear)
    if (appear <= 0) return

    // Aim: turn the whole rig to look at the point the cursor is over.
    target.current.set(aim.current[0], aim.current[1], aim.current[2])
    g.lookAt(target.current)

    /*
      The draw. Pulled fully back while aiming and released on the shot, which is
      what `rejecting` and `accepting` both are - the arrow has left, so the string
      snaps forward and the nocked plunger disappears with it.
    */
    const drawn = state.phase === 'aiming' ? 1 : 0
    if (string.current) string.current.position.z = -DRAW * drawn
    if (arrow.current) {
      arrow.current.visible = drawn > 0
      arrow.current.position.z = -DRAW * drawn
    }
  })

  return (
    <group ref={group} position={ANCHOR} visible={false}>
      {/*
        The limbs. Two arcs rather than a torus: a full ring would read as a hoop,
        and a bow is defined by the gap where the archer's hand goes.
      */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.3, 0.022, 8, 20, Math.PI * 1.15]} />
        <meshPhysicalMaterial {...mattePlastic(BOW_WOOD, { clearcoat: 0.1 })} />
      </mesh>
      {/* The grip, so the middle of the bow is a solid rather than a gap. */}
      <mesh castShadow>
        <capsuleGeometry args={[0.032, 0.1, 4, 8]} />
        <meshPhysicalMaterial {...plastic(palette.hardware)} />
      </mesh>

      {/* The string, which moves back with the draw. */}
      <mesh ref={string}>
        <cylinderGeometry args={[0.006, 0.006, 0.58, 5]} />
        <meshBasicMaterial color="#cfe0f5" />
      </mesh>

      {/*
        The plunger arrow: a shaft, a rubber cup at the business end, and flights.
        A plunger rather than a point because the brief says so, and because a
        suction cup is the one arrowhead that can be fired at a face in a children's
        game without anybody flinching.
      */}
      <group ref={arrow} visible={false}>
        <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.014, 0.44, 8]} />
          <meshPhysicalMaterial {...mattePlastic('#e8dcc4')} />
        </mesh>
        {/* The cup, opening forward. A cone with its wide end away from the shaft. */}
        <mesh position={[0, 0, 0.46]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.03, 0.07, 12, 1, true]} />
          <meshPhysicalMaterial {...mattePlastic(PLUNGER_RUBBER, { side: 2 })} />
        </mesh>
        {/*
          Flights, and the one emissive thing on the arrow so it reads in flight.

          `meshPhysicalMaterial`, because `emissive()` returns PHYSICAL material
          props. Spreading them onto a basic material throws inside three's
          `refreshUniformsCommon` on every frame and kills the render partway
          through - the scene keeps showing an older frame and nothing in the
          scene graph looks wrong. That is the second time this exact mistake has
          been made in this feature, which is why `materialPresets.test.ts` now
          fails the build for it rather than leaving it to the console.
        */}
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[0.09, 0.09]} />
          <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} side={2} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Where the bow sits, in world space.
 *
 * At the character's right hand and a little forward, so it is inside the frame
 * rather than behind the camera. The player faces +Z, so their right is -X.
 */
const ANCHOR: [number, number, number] = [-0.42, 1.05, 0.45]

/** How far the string and the nocked arrow pull back, in metres. */
const DRAW = 0.19

const BOW_WOOD = '#8d6440'
const PLUNGER_RUBBER = '#e0483c'
