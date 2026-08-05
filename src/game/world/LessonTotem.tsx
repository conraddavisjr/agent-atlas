import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { RoundedBox, Text } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import { palette } from '@/art/palette'
import { emissive, gel, mattePlastic, plastic } from '@/art/materials'
import { useProximity } from '../interaction/useProximity'
import type { Lesson } from '@/state/types'

/**
 * A lesson totem: an object you walk up to in order to take a lesson.
 *
 * There is no lesson content behind this yet, by design. What it proves is the
 * approach-highlight-prompt loop and that firing completion updates progression,
 * cosmetics, and portal locks all the way through.
 *
 * The floating node above each totem is the AI motif standing in for the concept
 * it teaches, which is our equivalent of Astro's hub being built out of the
 * hardware it celebrates.
 */
export function LessonTotem({
  lesson,
  completed,
  player,
  onFocus,
  onBlur,
}: {
  lesson: Lesson
  completed: boolean
  player: React.RefObject<Group | null>
  /** Focus is reported upward; the interact key is handled centrally in App. */
  onFocus: () => void
  onBlur: () => void
}) {
  const anchor = useRef<Group>(null)
  const node = useRef<Mesh>(null)
  const [near, setNear] = useState(false)

  useProximity(
    anchor,
    player,
    () => {
      setNear(true)
      onFocus()
    },
    () => {
      setNear(false)
      onBlur()
    },
  )

  useFrame((state) => {
    if (!node.current) return
    const t = state.clock.elapsedTime
    // Bob and spin. Objects that react are a core part of the toy feel, and a
    // totally static prop reads as scenery rather than as something to approach.
    node.current.position.y = 2.1 + Math.sin(t * 1.6 + lesson.position[0]) * 0.12
    node.current.rotation.y = t * 0.6
    node.current.scale.setScalar(near ? 1.18 : 1)
  })

  const glow = completed ? palette.unlocked : palette.node

  return (
    <group position={lesson.position}>
      <group ref={anchor} position={[0, 1, 0]} />

      {/* Plinth */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.75, 0.9, 0.5, 20]} />
          <meshPhysicalMaterial {...mattePlastic(palette.rock)} />
        </mesh>
        <mesh position={[0, 0.72, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.6, 0.45, 16]} />
          <meshPhysicalMaterial {...plastic(palette.shell)} />
        </mesh>
        <CylinderCollider args={[0.5, 0.9]} position={[0, 0.5, 0]} />
      </RigidBody>

      {/* Accent ring, which brightens on approach so the highlight is unmissable. */}
      <mesh position={[0, 0.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.44, 0.05, 8, 28]} />
        <meshPhysicalMaterial {...emissive(glow, near ? 3.2 : 1.4)} />
      </mesh>

      {/* The concept node itself. Translucent so it reads as a held idea rather
          than a solid object. */}
      <mesh ref={node} position={[0, 2.1, 0]} castShadow>
        <icosahedronGeometry args={[0.38, 1]} />
        <meshPhysicalMaterial {...gel(glow)} emissive={glow} emissiveIntensity={near ? 1.6 : 0.7} />
      </mesh>

      {/* Completion tick, which is how progress reads at a glance from a distance. */}
      {completed && (
        <RoundedBox args={[0.34, 0.34, 0.08]} radius={0.06} smoothness={3} position={[0, 1.35, 0.45]}>
          <meshPhysicalMaterial {...emissive(palette.unlocked, 2.2)} />
        </RoundedBox>
      )}

      {near && (
        <>
          <Text
            position={[0, 3.0, 0]}
            fontSize={0.3}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.018}
            outlineColor="#0b1020"
          >
            {lesson.title}
          </Text>
          <Text
            position={[0, 2.68, 0]}
            fontSize={0.16}
            color="#cfe4ff"
            anchorX="center"
            anchorY="middle"
            maxWidth={4}
            textAlign="center"
            outlineWidth={0.012}
            outlineColor="#0b1020"
          >
            {completed ? 'Completed' : lesson.blurb}
          </Text>
        </>
      )}

    </group>
  )
}
