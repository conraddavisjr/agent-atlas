import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { DoubleSide } from 'three'
import { palette } from '@/art/palette'
import { ground, mattePlastic } from '@/art/materials'
import { usePbrTextures } from '@/art/textures'

/**
 * The island's ground.
 *
 * Replaces the flat 48-segment cylinder the layout was blocked out on: the
 * plateau now carries a real PBR grass set with a dirt rim, and the grass field
 * is planted on top of it.
 *
 * **The walkable surface is deliberately flat.**
 *
 * Rolling ground is the obvious next thing to reach for and it is a trap here.
 * The collider is a flat cylinder, and Rapier will not follow a displaced mesh,
 * so every bump would be somewhere the robot hovers and every dip somewhere it
 * sinks to the shins. Relief on the plateau comes from the normal map instead,
 * which costs nothing and cannot disagree with physics. Same call as leaving
 * the ramp a smooth slope rather than stepping it.
 */

export const PLATEAU_RADIUS = 16

/** Enough that the rim reads as a circle rather than a polygon at this scale. */
const RIM_SEGMENTS = 128

export function Terrain() {
  /*
    Tiled so one repeat covers roughly two and a half metres. Ground is seen at
    a grazing angle almost all the time, which is the condition that makes
    tiling obvious, so the repeat is kept tight enough that no single feature of
    the photograph is large enough to recognise twice across the island.
  */
  const grass = usePbrTextures('grass', [13, 13])
  const dirt = usePbrTextures('dirt', [10, 10])

  return (
    <>
      {/*
        Plateau. A flat disc, lit per fragment from the normal map, with the
        collider matching it exactly.
      */}
      <RigidBody type="fixed" colliders={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[PLATEAU_RADIUS, RIM_SEGMENTS]} />
          <meshPhysicalMaterial {...ground(palette.grass, grass)} />
        </mesh>
        <CylinderCollider args={[0.5, PLATEAU_RADIUS]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* The rim's vertical face, which is what gives the island thickness from
          a low angle. Dirt rather than grass, so the plateau reads as a lid. */}
      <mesh position={[0, -0.5, 0]} receiveShadow castShadow>
        <cylinderGeometry
          args={[PLATEAU_RADIUS, PLATEAU_RADIUS * 0.97, 1, RIM_SEGMENTS, 1, true]}
        />
        <meshPhysicalMaterial {...ground(palette.soil, dirt)} side={DoubleSide} />
      </mesh>

      {/* Soil band and root cone beneath. Never walked on, so these are free to
          be as irregular as they like. */}
      <mesh position={[0, -1.8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[PLATEAU_RADIUS * 0.97, 9, 2, RIM_SEGMENTS]} />
        <meshPhysicalMaterial {...ground(palette.soil, dirt)} />
      </mesh>
      <mesh position={[0, -4.2, 0]} castShadow>
        <coneGeometry args={[9, 4, 48]} />
        <meshPhysicalMaterial {...mattePlastic(palette.soilDeep)} />
      </mesh>
    </>
  )
}
