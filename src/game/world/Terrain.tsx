import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { DoubleSide } from 'three'
import { palette } from '@/art/palette'
import { ground, mattePlastic } from '@/art/materials'
import { usePbrTextures } from '@/art/textures'
import { createGroundTexture, GROUND_METRES_PER_TILE } from '@/art/groundTexture'

/**
 * The island's ground.
 *
 * **The walkable surface is deliberately flat, in both senses.**
 *
 * Geometrically flat, because the collider is a flat cylinder and Rapier will
 * not follow a displaced mesh: every bump would be somewhere the robot hovers
 * and every dip somewhere it sinks to the shins.
 *
 * And flat in its shading, because that is what lets the things standing on it
 * read. The plateau carries a generated pale surface with circuit traces worn
 * into it and no normal map at all, so nothing on it catches a specular
 * highlight. The grass, the flowers and the scatter supply the relief, as
 * actual geometry.
 *
 * The rim below keeps its photographic material. It is a cliff face rather than
 * a lawn, it is never walked on, and it is the one place where real rock detail
 * is doing the right job.
 */

export const PLATEAU_RADIUS = 16

/** Enough that the rim reads as a circle rather than a polygon at this scale. */
const RIM_SEGMENTS = 128

export function Terrain() {
  const gl = useThree((s) => s.gl)

  const surface = useMemo(() => {
    const texture = createGroundTexture()
    const repeat = (PLATEAU_RADIUS * 2) / GROUND_METRES_PER_TILE
    texture.repeat.set(repeat, repeat)
    // The plateau is seen at a grazing angle almost all the time, which is
    // exactly the condition that turns a tiled surface into aliased mush.
    texture.anisotropy = gl.capabilities.getMaxAnisotropy()
    texture.needsUpdate = true
    return texture
  }, [gl])

  const dirt = usePbrTextures('dirt', [10, 10])

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[PLATEAU_RADIUS, RIM_SEGMENTS]} />
          {/*
            No normal map, no clearcoat, and roughness near the top of its
            range. Every one of those is deliberate: this surface is meant to
            take light evenly and never produce a highlight that suggests a
            material it is not.
          */}
          <meshPhysicalMaterial
            map={surface}
            roughness={0.95}
            metalness={0}
            clearcoat={0}
          />
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
