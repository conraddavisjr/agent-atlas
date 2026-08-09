import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import type { Group } from 'three'
import { palette } from '@/art/palette'
import { emissive, mattePlastic, metal, plastic, rubber } from '@/art/materials'
import { WADDLE } from './tuning'
import { TURN_ANIM } from './animTuning'
import type { RobotAnimState } from './robotAnim'
import type { SocketName } from '@/state/types'

/**
 * The robot, built entirely from primitives.
 *
 * Design intent, and the reason it does not resemble Astro: a rounded boxy head
 * with a single horizontal LED visor bar, a warm amber accent on an off-white
 * shell, and a stubby antenna. Specifically avoided are the chrome sphere head,
 * the two round blue eyes, and the blue-and-white livery, all of which are the
 * recognisable marks of that character.
 *
 * What we do borrow is the principle rather than the design: a compact frame with
 * a low centre of gravity, and locomotion that reads as a toddler's waddle. With
 * no skeleton, that charm has to come from whole-body motion.
 */
export function RobotModel({
  anim,
  cosmetics,
}: {
  anim: RefObject<RobotAnimState>
  cosmetics: Partial<Record<SocketName, string>>
}) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const phase = useRef(0)
  const turn = useRef(0)

  useFrame((_, delta) => {
    const a = anim.current
    if (!root.current || !body.current) return

    // Clamp delta so a background tab that resumes after a long pause does not
    // advance the walk cycle by a huge step and snap the limbs.
    const dt = Math.min(delta, 0.05)

    /*
      Turn input, eased rather than read raw.

      Exponential damping, so it behaves the same at any refresh rate, matching
      the convention the camera uses. Without the ease, tapping a turn key snaps
      the whole upper body a tenth of a radian in one frame and reads as a
      glitch rather than as a lean.
    */
    turn.current += (a.turnNorm - turn.current) * (1 - Math.exp(-TURN_ANIM.damping * dt))
    const t = turn.current

    /*
      The step cycle runs on whichever is doing more work, travel or rotation.

      A pivot on the spot moves no distance but the feet still cover ground, so
      it has to step. Taking the max rather than the sum means walking and
      turning at once does not double the cadence.
    */
    const stride = Math.max(a.speedNorm, Math.abs(t) * TURN_ANIM.stepScale)

    // The walk cycle advances with actual speed, so the waddle stays in step with
    // movement instead of drifting out of sync at different speeds.
    phase.current += dt * WADDLE.bobFrequency * stride

    const walking = a.grounded ? stride : 0
    const p = phase.current

    // Squash and stretch is applied at the root so the whole robot deforms as one
    // object. Volume is roughly preserved by widening as it flattens, which is
    // what stops it reading as a scaling bug.
    const s = a.squash
    const widen = 1 + (1 - s) * 0.6
    root.current.scale.set(widen, s, widen)

    // Vertical bob, at double the step frequency because both feet contribute.
    const bob = Math.sin(p * 2) * WADDLE.bobAmplitude * walking
    body.current.position.y = bob

    /*
      Side-to-side roll is the actual waddle, plus a bank into the turn.

      Local +X is the robot's left, so a positive rotation about Z tips the top
      toward its right, which is the way you want it falling in a right-hand
      turn. Kept small: the low centre of gravity is a deliberate part of the
      design and a deep lean fights it.
    */
    body.current.rotation.z = Math.sin(p) * WADDLE.rollAmplitude * walking + t * TURN_ANIM.bankAmount

    /*
      Lean into travel, which sells momentum and weight, and signed by throttle
      so reversing leans back. It used to lean forward in both directions, which
      read as the robot being dragged backwards against its will.
    */
    body.current.rotation.x = WADDLE.leanAmount * walking * Math.sign(a.throttle)

    /*
      Hips lead the turn and the torso lags behind it, with the head leading
      further still, looking where it is about to go.

      This is the part that stops a rotation reading as a turntable. The parent
      group already carries the true facing, so these are offsets against it:
      positive is behind the turn, because facing decreases as the robot turns
      right.
    */
    body.current.rotation.y = t * TURN_ANIM.torsoLag
    if (head.current) head.current.rotation.y = -t * (TURN_ANIM.torsoLag + TURN_ANIM.headLead)

    // Limbs counter-swing. In the air they tuck instead, so a jump does not look
    // like a mid-stride freeze.
    const swing = Math.sin(p) * WADDLE.limbSwing * walking
    const airborne = a.grounded ? 0 : 1
    const tuck = airborne * 0.5

    if (legL.current) legL.current.rotation.x = swing - tuck
    if (legR.current) legR.current.rotation.x = -swing - tuck
    if (armL.current) armL.current.rotation.x = -swing * 0.7 - tuck * 1.4
    if (armR.current) armR.current.rotation.x = swing * 0.7 - tuck * 1.4

    // Feet splay through a pivot so the stance opens into the turn rather than
    // the legs scissoring straight through each other.
    const splay = t * TURN_ANIM.footPivot * (a.grounded ? 1 : 0)
    if (legL.current) legL.current.rotation.y = splay
    if (legR.current) legR.current.rotation.y = -splay
  })

  return (
    <group ref={root}>
      <group ref={body}>
        {/* Torso. Rounded box rather than a capsule so the silhouette reads as a
            manufactured object rather than a blob. */}
        <RoundedBox args={[0.62, 0.6, 0.44]} radius={0.16} smoothness={4} position={[0, 0.62, 0]} castShadow>
          <meshPhysicalMaterial {...plastic(palette.shell)} />
        </RoundedBox>

        {/* Amber chest panel. The single accent, kept to one place so it stays a
            focal point instead of decoration. */}
        <RoundedBox args={[0.3, 0.22, 0.06]} radius={0.05} smoothness={3} position={[0, 0.66, 0.22]} castShadow>
          <meshPhysicalMaterial {...plastic(palette.accent)} />
        </RoundedBox>

        {/* Head */}
        <group ref={head} position={[0, 1.12, 0]}>
          <RoundedBox args={[0.56, 0.44, 0.46]} radius={0.14} smoothness={4} castShadow>
            <meshPhysicalMaterial {...plastic(palette.shell)} />
          </RoundedBox>

          {/* The visor bar. Emissive so it pushes past the bloom threshold and is
              the only thing on the character that glows. */}
          <RoundedBox args={[0.42, 0.1, 0.04]} radius={0.03} smoothness={3} position={[0, 0.02, 0.235]}>
            <meshPhysicalMaterial {...emissive(palette.visor, 2.4)} />
          </RoundedBox>

          {/* Antenna */}
          <mesh position={[0.16, 0.28, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, 0.2, 8]} />
            <meshPhysicalMaterial {...metal(palette.rock)} />
          </mesh>
          <mesh position={[0.16, 0.4, 0]}>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshPhysicalMaterial {...emissive(palette.accent, 2.0)} />
          </mesh>

          {/* Ear pods, which break up the boxy head silhouette. */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
              <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
            </mesh>
          ))}

          {/* Head socket, for the helmet earned after the first zone. */}
          <group position={[0, 0.24, 0]}>{cosmetics.head === 'helmet' && <Helmet />}</group>
        </group>

        {/* Back socket, for the cape. */}
        <group position={[0, 0.78, -0.22]}>{cosmetics.back === 'cape' && <Cape />}</group>

        {/* Arms */}
        <group ref={armL} position={[-0.36, 0.78, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow>
            <capsuleGeometry args={[0.09, 0.18, 4, 12]} />
            <meshPhysicalMaterial {...plastic(palette.accent)} />
          </mesh>
          <group position={[0, -0.36, 0]}>{cosmetics.hand_l && <HandProp />}</group>
        </group>

        <group ref={armR} position={[0.36, 0.78, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow>
            <capsuleGeometry args={[0.09, 0.18, 4, 12]} />
            <meshPhysicalMaterial {...plastic(palette.accent)} />
          </mesh>
          <group position={[0, -0.36, 0]}>{cosmetics.hand_r && <HandProp />}</group>
        </group>

        {/* Legs. Short and wide-set, which is what gives the low centre of gravity
            that makes a platformer character read as stable and controllable. */}
        <group ref={legL} position={[-0.17, 0.32, 0]}>
          <mesh position={[0, -0.1, 0]} castShadow>
            <capsuleGeometry args={[0.095, 0.1, 4, 12]} />
            <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
          </mesh>
          <RoundedBox args={[0.22, 0.1, 0.3]} radius={0.04} smoothness={3} position={[0, -0.22, 0.04]} castShadow>
            <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
          </RoundedBox>
        </group>

        <group ref={legR} position={[0.17, 0.32, 0]}>
          <mesh position={[0, -0.1, 0]} castShadow>
            <capsuleGeometry args={[0.095, 0.1, 4, 12]} />
            <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
          </mesh>
          <RoundedBox args={[0.22, 0.1, 0.3]} radius={0.04} smoothness={3} position={[0, -0.22, 0.04]} castShadow>
            <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
          </RoundedBox>
        </group>
      </group>
    </group>
  )
}

/** Earned after the first zone. Deliberately simple; it only has to read clearly. */
function Helmet() {
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial {...plastic(palette.unlocked)} side={2} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.06, 0.16, 0.34]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

function Cape() {
  return (
    <mesh position={[0, -0.18, -0.04]} rotation={[0.18, 0, 0]} castShadow>
      <planeGeometry args={[0.6, 0.7]} />
      <meshPhysicalMaterial {...mattePlastic(palette.token)} side={2} />
    </mesh>
  )
}

function HandProp() {
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.1, 12, 12]} />
      <meshPhysicalMaterial {...plastic(palette.shell)} />
    </mesh>
  )
}
