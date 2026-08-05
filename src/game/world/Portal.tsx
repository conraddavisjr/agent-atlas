import { useRef, useState } from 'react'
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { Billboard, RoundedBox, Text } from '@react-three/drei'
import type { Group } from 'three'
import { palette } from '@/art/palette'
import { emissive, mattePlastic, plastic, stone } from '@/art/materials'
import { useStoneTextures } from '@/art/textures'
import { PortalShimmer } from '@/art/PortalShimmer'
import { useProximity } from '../interaction/useProximity'

/**
 * A portal: a cave mouth or doorway that moves the player to another scene.
 *
 * The locked state is designed to be self-explanatory without a label. A grayed
 * out bridge needs text to tell you what it means; a sealed door with a lock
 * plate over it does not. Locked portals are desaturated AND physically blocked
 * AND missing their glow, so the read holds even for a colourblind player who
 * cannot rely on the desaturation alone.
 */
export function Portal({
  position,
  rotation = 0,
  locked,
  label,
  player,
  onEnter,
}: {
  position: [number, number, number]
  rotation?: number
  locked: boolean
  label: string
  player: React.RefObject<Group | null>
  onEnter: () => void
}) {
  const anchor = useRef<Group>(null)
  const [near, setNear] = useState(false)
  const triggered = useRef(false)

  /*
    Tiled tightly. The arch pieces are under a metre across, so a low repeat
    would stretch a single stone over the whole leg and read as a photograph
    pasted on rather than as masonry.
  */
  const archStone = useStoneTextures([1.4, 3])

  useProximity(
    anchor,
    player,
    () => {
      setNear(true)
      // Unlocked portals fire on contact rather than on a keypress, so travel
      // feels like walking through a door rather than operating a machine.
      if (!locked && !triggered.current) {
        triggered.current = true
        onEnter()
      }
    },
    () => {
      setNear(false)
      triggered.current = false
    },
  )

  const frameColor = locked ? palette.locked : palette.accent
  /*
    The locked arch uses the mid grey, not the deep one. When frame and door were
    both the deep shade the whole portal collapsed into a single black rectangle
    that read as a hole in the world rather than as a sealed door. The frame has
    to stay lighter than the slab it holds for the shape to be legible at all.
  */
  const stoneColor = locked ? palette.locked : palette.rock

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <group ref={anchor} />

      {/* Surrounding arch */}
      <RigidBody type="fixed" colliders={false}>
        {[-1, 1].map((side) => (
          <RoundedBox
            key={side}
            args={[0.5, 3.4, 0.7]}
            radius={0.12}
            smoothness={3}
            position={[side * 1.5, 1.7, 0]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial {...stone(stoneColor, archStone)} />
          </RoundedBox>
        ))}
        <RoundedBox args={[3.5, 0.5, 0.7]} radius={0.12} smoothness={3} position={[0, 3.55, 0]} castShadow>
          <meshPhysicalMaterial {...stone(stoneColor, archStone)} />
        </RoundedBox>

        <CuboidCollider args={[0.25, 1.7, 0.35]} position={[-1.5, 1.7, 0]} />
        <CuboidCollider args={[0.25, 1.7, 0.35]} position={[1.5, 1.7, 0]} />
        <CuboidCollider args={[1.75, 0.25, 0.35]} position={[0, 3.55, 0]} />

        {/* A locked portal is physically sealed. Blocking passage is what actually
            communicates the gate; the visuals only explain why. */}
        {locked && <CuboidCollider args={[1.3, 1.7, 0.3]} position={[0, 1.7, 0]} />}
      </RigidBody>

      {/* Trim, which carries the accent colour when open. */}
      <RoundedBox args={[3.1, 0.16, 0.16]} radius={0.05} smoothness={3} position={[0, 3.3, 0.35]}>
        <meshPhysicalMaterial {...(locked ? mattePlastic(frameColor) : emissive(frameColor, 1.6))} />
      </RoundedBox>

      {/* The opening itself. */}
      {locked ? (
        <>
          {/* Sealed slab. Kept flat-shaded rather than stone: the arch around it
              is the masonry, and texturing the door too collapses the contrast
              that makes the sealed panel read as a separate thing filling a gap. */}
          <RoundedBox args={[2.6, 3.4, 0.24]} radius={0.08} smoothness={3} position={[0, 1.7, 0]} castShadow>
            <meshPhysicalMaterial {...mattePlastic(palette.lockedDeep)} />
          </RoundedBox>

          {/* Horizontal banding. Breaks up the flat slab so it reads as a
              constructed door rather than a void, and gives the lock plate
              something to sit against. */}
          {[0.62, 2.78].map((y) => (
            <RoundedBox
              key={y}
              args={[2.5, 0.16, 0.3]}
              radius={0.05}
              smoothness={3}
              position={[0, y, 0]}
            >
              <meshPhysicalMaterial {...mattePlastic(palette.locked)} />
            </RoundedBox>
          ))}

          {/* Lock plate. The literal, unambiguous read, and the reason this needs
              no text label to explain itself. */}
          <LockPlate position={[0, 1.75, 0.2]} />
        </>
      ) : (
        <PortalShimmer width={2.6} height={3.3} position={[0, 1.7, 0]} />
      )}

      {/* Label appears on approach rather than always, so the world stays
          uncluttered. Billboarded so it stays readable while the player circles
          the portal or swings the camera around it. */}
      {near && (
        <Billboard position={[0, 4.2, 0]}>
          <Text
            fontSize={0.34}
            color={locked ? '#c3c9d4' : '#ffffff'}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#0b1020"
          >
            {locked ? `${label} - Locked` : label}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

/**
 * Sized generously and rendered in a light warm grey against the dark slab.
 * A small, low-contrast padlock is invisible from playing distance, which
 * defeats the whole point of the lock explaining itself without a label.
 */
function LockPlate({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Shackle */}
      <mesh position={[0, 0.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.07, 10, 24, Math.PI]} />
        <meshPhysicalMaterial {...plastic('#aab3c2')} />
      </mesh>
      {/* Body */}
      <RoundedBox args={[0.78, 0.64, 0.22]} radius={0.09} smoothness={4} castShadow>
        <meshPhysicalMaterial {...plastic('#c3cad6')} />
      </RoundedBox>
      {/* Keyhole */}
      <mesh position={[0, 0.04, 0.12]}>
        <circleGeometry args={[0.11, 16]} />
        <meshBasicMaterial color={palette.lockedDeep} />
      </mesh>
      <mesh position={[0, -0.12, 0.12]}>
        <boxGeometry args={[0.09, 0.18, 0.01]} />
        <meshBasicMaterial color={palette.lockedDeep} />
      </mesh>
    </group>
  )
}
