import { useMemo, useRef, useState } from 'react'
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { Billboard, RoundedBox, Text } from '@react-three/drei'
import type { Group } from 'three'
import { palette } from '@/art/palette'
import { GLOW, emissive, mattePlastic, metal, plastic, rubber, stone } from '@/art/materials'
import { useMouldedStone } from '@/art/textures'
import { createDecalMaps, ventGrille, DECAL_KINDS } from '@/art/decalTextures'
import { useQuality } from '@/art/useQuality'
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
/**
 * The two jambs' footprint, in the portal's own local space.
 *
 * Exported because the jamb-on-T3 junction is one of the three flat-on-flat
 * corners the ambient occlusion pass was genuinely earning its cost at, and with
 * that pass gone the hub's contact-decal batch has to put the band there
 * instead. The batch is built in `HubIsland.tsx` so that every contact in the
 * scene stays one draw call, which means the numbers have to leave this file.
 *
 * They are read by the meshes below as well as exported, so the decal and the
 * geometry cannot drift apart - which is the whole reason this is a constant
 * rather than three literals repeated in two files.
 *
 * An all-caps constant export, which is what keeps fast refresh working for this
 * file: the lint rule permits a constant beside a component and only objects to a
 * shared function. `LessonTotem.tsx` exports `TOTEM` on the same basis, for the
 * same reason - an object's dimensions belong with the object.
 */
export const PORTAL_JAMB = {
  /** Half-extent across the opening. */
  halfX: 0.25,
  /** Half-extent through the wall. Deeper than it is wide, so contact is elliptical. */
  halfZ: 0.35,
  /** Height, and therefore also the height of the lintel's underside. */
  height: 3.4,
  /** Distance from the portal's centreline to each jamb's centre. */
  spacing: 1.5,
} as const

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
    Moulded stone, not a photograph of granite.

    This was the project's last call site for the ambientCG rock, and it was the
    one place it did the most damage. The arch is the only object in the hub
    with any legible surface at all: every deck, puck, kerb, pylon and totem
    beside it is flat-shaded plastic with no texture whatsoever, so a
    high-frequency photographic normal map with visible tiling met untextured
    plastic across a two-pixel edge. Two art styles touching, and the eye goes
    to the one object that is wrong because it is the only one carrying detail.

    `useMouldedStone` is generated in `groundTexture.ts` and has the identical
    shape, so this is a one-import change. The tiling stays at the same density:
    the arch pieces are under a metre across, and a low repeat stretches one
    stone over a whole leg.
  */
  const archStone = useMouldedStone([1.4, 3])

  /*
    Panel lines and a vent group on the sealed slab.

    The vent is one of only three placements the fiction earns anywhere in this
    world - the robot's back, the totem plinth's collar, and this arch, because
    the arch is the machine that does the travelling. It is drawn INTO the
    slab's height mask rather than placed as a decal mesh, which costs nothing
    extra: the mask is being rasterised anyway and the vent is simply another
    set of marks on it.

    Null at every tier today, because `surfaceMapSize` is 0 everywhere until the
    stream that owns the tier table turns it on. A caller that gets null spreads
    no maps, so the material compiles exactly the program it would have compiled
    anyway, which is what "low must be genuinely zero cost" means.
  */
  const quality = useQuality()
  const slabMaps = useMemo(() => {
    if (!quality.surfaceMapSize) return null
    const metresPerTile = DECAL_KINDS.hull.metresPerTile
    return createDecalMaps(
      'hull',
      quality.surfaceMapSize,
      ventGrille({ x: 0.5, y: 0.28, slots: 7, slotLength: 0.09, metresPerTile }),
    )
  }, [quality.surfaceMapSize])

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
            args={[PORTAL_JAMB.halfX * 2, PORTAL_JAMB.height, PORTAL_JAMB.halfZ * 2]}
            radius={0.12}
            smoothness={3}
            position={[side * PORTAL_JAMB.spacing, PORTAL_JAMB.height / 2, 0]}
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
        <meshPhysicalMaterial {...(locked ? mattePlastic(frameColor) : emissive(frameColor, GLOW.bloom))} />
      </RoundedBox>

      {/* The opening itself. */}
      {locked ? (
        <>
          {/* Sealed slab. Kept flat-shaded rather than stone: the arch around it
              is the masonry, and texturing the door too collapses the contrast
              that makes the sealed panel read as a separate thing filling a gap. */}
          <RoundedBox args={[2.6, 3.4, 0.24]} radius={0.08} smoothness={3} position={[0, 1.7, 0]} castShadow>
            <meshPhysicalMaterial
              {...mattePlastic(palette.lockedDeep)}
              {...(slabMaps
                ? {
                    normalMap: slabMaps.normalMap,
                    roughnessMap: slabMaps.roughnessMap,
                    aoMap: slabMaps.aoMap,
                    roughness: slabMaps.roughness,
                  }
                : {})}
            />
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
              {/* Glossy where the slab behind it is chalky, so the band steps up
                  in material as well as in value and reads as a separate part
                  rather than as a lighter stripe painted on one. */}
              <meshPhysicalMaterial {...plastic(palette.locked)} />
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
        <meshPhysicalMaterial {...metal('#aab3c2')} />
      </mesh>
      {/* Body */}
      <RoundedBox args={[0.78, 0.64, 0.22]} radius={0.09} smoothness={4} castShadow>
        <meshPhysicalMaterial {...plastic('#c3cad6')} />
      </RoundedBox>
      {/*
        Keyhole. Lit, not basic.

        These two were the only unlit surfaces on an otherwise lit object, which
        means they did not darken in shadow and read as holes cut through to a
        flat colour rather than as recesses in a plate. `rubber()` gives the same
        near-black at a fraction of the environment response, so the shape stays
        attached to the lighting it sits in.
      */}
      <mesh position={[0, 0.04, 0.12]}>
        <circleGeometry args={[0.11, 16]} />
        <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
      </mesh>
      <mesh position={[0, -0.12, 0.12]}>
        <boxGeometry args={[0.09, 0.18, 0.01]} />
        <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
      </mesh>
    </group>
  )
}
