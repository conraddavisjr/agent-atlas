import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import type { Group } from 'three'
import { palette } from '@/art/palette'
import { emissive, mattePlastic, metal, plastic, rubber } from '@/art/materials'
import { WADDLE } from './tuning'
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
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const phase = useRef(0)

  useFrame((_, delta) => {
    const a = anim.current
    if (!root.current || !body.current) return

    // Clamp delta so a background tab that resumes after a long pause does not
    // advance the walk cycle by a huge step and snap the limbs.
    const dt = Math.min(delta, 0.05)

    // The walk cycle advances with actual speed, so the waddle stays in step with
    // movement instead of drifting out of sync at different speeds.
    phase.current += dt * WADDLE.bobFrequency * a.speedNorm

    const walking = a.grounded ? a.speedNorm : 0
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

    // Side-to-side roll is the actual waddle. This single term does more for the
    // toy-like charm than any other line in the file.
    body.current.rotation.z = Math.sin(p) * WADDLE.rollAmplitude * walking

    // Lean into travel, which sells momentum and weight.
    body.current.rotation.x = WADDLE.leanAmount * walking

    // Limbs counter-swing. In the air they tuck instead, so a jump does not look
    // like a mid-stride freeze.
    const swing = Math.sin(p) * WADDLE.limbSwing * walking
    const airborne = a.grounded ? 0 : 1
    const tuck = airborne * 0.5

    if (legL.current) legL.current.rotation.x = swing - tuck
    if (legR.current) legR.current.rotation.x = -swing - tuck
    if (armL.current) armL.current.rotation.x = -swing * 0.7 - tuck * 1.4
    if (armR.current) armR.current.rotation.x = swing * 0.7 - tuck * 1.4
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
        <group position={[0, 1.12, 0]}>
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
