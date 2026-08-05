import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { RoundedBox } from '@react-three/drei'
import { palette } from '@/art/palette'
import { emissive, mattePlastic } from '@/art/materials'
import { useGame } from '../GameContext'
import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS } from '@/state/lessons'
import { isLessonComplete } from '@/state/progression'
import { Portal } from './Portal'
import { LessonTotem } from './LessonTotem'

/**
 * The cave.
 *
 * This scene is deliberately disposable. Its job is to prove the portal round
 * trip works end to end: that spawn points land you correctly in both directions,
 * that the previous scene is released rather than leaked, and that a reload
 * restores you here rather than dumping you back at the hub.
 *
 * It is also the reason the portal architecture was the right call. Nothing here
 * shares a single lighting or material decision with the hub, and it costs
 * nothing to be this different because the two are never loaded together.
 *
 * The enclosed geometry doubles as the test case for camera collision, since the
 * walls are close enough that a camera without pull-in would clip constantly.
 */
export function CaveScene() {
  const { player, travel } = useGame()
  const progress = useProgress()
  const setActiveTotem = useGameStore((s) => s.setActiveTotem)

  const caveLessons = LESSONS.filter((l) => l.zoneId === 'prompting')

  return (
    <group>
      {caveLessons.map((lesson) => (
        <LessonTotem
          key={lesson.id}
          lesson={lesson}
          completed={isLessonComplete(lesson, progress)}
          player={player}
          onFocus={() => setActiveTotem(lesson.id)}
          onBlur={() => setActiveTotem(null)}
        />
      ))}

      {/* Return portal. Never locked: trapping a player in a scene with no way
          back and no account to recover would be unrecoverable. It targets the
          hub's 'from-cave' spawn so you step out of the door you came in by,
          rather than being teleported across the island. */}
      <Portal
        position={[0, 0, 10.5]}
        rotation={Math.PI}
        locked={false}
        label="Back to The Foundry"
        player={player}
        onEnter={() => travel('hub', 'from-cave', 'The Foundry')}
      />
      {/* Floor */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[0, -0.5, 0]} receiveShadow>
          <boxGeometry args={[24, 1, 24]} />
          <meshPhysicalMaterial {...mattePlastic(palette.caveRockDeep)} />
        </mesh>
        <CuboidCollider args={[12, 0.5, 12]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Enclosing walls. Kept tight on purpose so the camera has to deal with them. */}
      {[
        { pos: [0, 3, -12] as [number, number, number], size: [24, 8, 1] as [number, number, number] },
        { pos: [0, 3, 12] as [number, number, number], size: [24, 8, 1] as [number, number, number] },
        { pos: [-12, 3, 0] as [number, number, number], size: [1, 8, 24] as [number, number, number] },
        { pos: [12, 3, 0] as [number, number, number], size: [1, 8, 24] as [number, number, number] },
      ].map((wall, i) => (
        <RigidBody key={i} type="fixed" colliders={false}>
          <mesh position={wall.pos} receiveShadow castShadow>
            <boxGeometry args={wall.size} />
            <meshPhysicalMaterial {...mattePlastic(palette.caveRock)} />
          </mesh>
          <CuboidCollider
            args={[wall.size[0] / 2, wall.size[1] / 2, wall.size[2] / 2]}
            position={wall.pos}
          />
        </RigidBody>
      ))}

      {/* Ceiling, which is what makes it read as a cave rather than a walled yard. */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[0, 7, 0]} receiveShadow>
          <boxGeometry args={[24, 1, 24]} />
          <meshPhysicalMaterial {...mattePlastic(palette.caveRockDeep)} />
        </mesh>
        <CuboidCollider args={[12, 0.5, 12]} position={[0, 7, 0]} />
      </RigidBody>

      {/* Interior pillars, giving the camera something to actually collide with
          in the middle of the room rather than only at the edges. */}
      {[
        [-5, 0, -4],
        [5.5, 0, -5],
        [-6, 0, 4],
      ].map((p, i) => (
        <RigidBody key={i} type="fixed" colliders={false}>
          <mesh position={[p[0], 3.25, p[2]]} castShadow receiveShadow>
            <cylinderGeometry args={[0.8, 1.1, 6.5, 12]} />
            <meshPhysicalMaterial {...mattePlastic(palette.caveRock)} />
          </mesh>
          <CuboidCollider args={[0.9, 3.25, 0.9]} position={[p[0], 3.25, p[2]]} />
        </RigidBody>
      ))}

      {/* Ledge to jump onto, so movement is still testable in here. */}
      <RigidBody type="fixed" colliders={false}>
        <RoundedBox args={[4, 1.2, 3]} radius={0.15} smoothness={3} position={[6, 0.6, 4]} castShadow receiveShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.caveRock)} />
        </RoundedBox>
        <CuboidCollider args={[2, 0.6, 1.5]} position={[6, 0.6, 4]} />
      </RigidBody>

      {/* Crystals. These are the actual light of the scene, which is why the
          directional in CaveLighting is kept so weak. */}
      {[
        [-8, 0, -8],
        [8, 0, -9],
        [-9, 0, 7],
        [3, 0, 8],
        [0, 0, -6],
        [9, 1.2, 4],
      ].map((p, i) => (
        <CaveCrystal key={i} position={p as [number, number, number]} seed={i} />
      ))}

      {/* Ceiling crystals, which fill the upper volume so the room does not read
          as empty overhead. */}
      {[
        [-4, 6.4, -2],
        [5, 6.4, 2],
        [-2, 6.4, 6],
      ].map((p, i) => (
        <mesh key={`c${i}`} position={p as [number, number, number]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[0.3, 1.4, 6]} />
          <meshPhysicalMaterial {...emissive(palette.caveCrystal, 1.3)} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function CaveCrystal({ position, seed }: { position: [number, number, number]; seed: number }) {
  const height = 1.4 + (seed % 4) * 0.45
  return (
    <group position={position} rotation={[0, seed * 0.9, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <coneGeometry args={[0.34, height, 6]} />
        <meshPhysicalMaterial {...emissive(palette.caveCrystal, 1.6)} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0.3, height * 0.3, 0.18]} rotation={[0, 0, 0.45]} castShadow>
        <coneGeometry args={[0.18, height * 0.55, 6]} />
        <meshPhysicalMaterial {...emissive(palette.caveCrystal, 1.2)} transparent opacity={0.92} />
      </mesh>
      {/* A real point light per crystal would be far too many lights; one dim
          emissive plus the hemisphere fill reads the same for a fraction of the cost. */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.1, 16]} />
        <meshBasicMaterial color={palette.caveCrystal} transparent opacity={0.14} />
      </mesh>
    </group>
  )
}
