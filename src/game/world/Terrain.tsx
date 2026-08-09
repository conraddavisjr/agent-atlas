import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { DoubleSide, Vector2 } from 'three'
import { ground, mattePlastic } from '@/art/materials'
import { usePbrTextures } from '@/art/textures'
import {
  createGroundRoughnessTexture,
  createGroundTexture,
  GROUND_METRES_PER_TILE,
  GROUND_ROUGHNESS_BIAS,
} from '@/art/groundTexture'

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
 *
 * **What changed in the art pass is value, and it is the single most
 * consequential change in this file.** The acceptance test that outranks every
 * other is that a frame desaturated to greyscale must still read as where you
 * can stand, and this island failed it on its own rim: `palette.soil` at
 * `#b98a5e` has a Rec.709 luma of 0.568, which sits inside the 0.56 to 0.74
 * gameplay band, the same band as the lawn on top of it. So the island had a
 * full metre of rim geometry and no visible thickness at all, because the cliff
 * and the field it holds up were the same value. The rim and the underside move
 * down into the 0.20 to 0.38 midground band, which is what gives the island an
 * edge.
 */

export const PLATEAU_RADIUS = 16

/** Enough that the rim reads as a circle rather than a polygon at this scale. */
const RIM_SEGMENTS = 128

/**
 * Band 2, the midground. The island's cliff face and the cone under it.
 *
 * Local constants rather than palette entries, only because the palette is
 * being re-valued by another hand in this same pass and two edits to the same
 * twelve lines is a conflict rather than a decision. These are the values from
 * the environment spec's table and they belong in `palette.ts` as `soil` and
 * `soilDeep`: `#6b4d31` at luma 0.319 and `#452f1c` at 0.197, replacing
 * `#b98a5e` at 0.568 and `#7d5738` at 0.364.
 */
const RIM_COLOR = '#6b4d31'
const UNDERSIDE_COLOR = '#452f1c'

/**
 * The rim's photograph, demoted.
 *
 * It is background now rather than a feature. The brief's layering rule is that
 * background layers get progressively less material detail, and a cliff face
 * competing with the lawn for detail is what makes an island read as a model of
 * an island. Weaker normals, weaker occlusion, and a much smaller share of the
 * environment map, so the rim recedes instead of catching the sky.
 */
const RIM_DEMOTION = {
  normalScale: new Vector2(1.1, 1.1),
  aoMapIntensity: 1.2,
  envMapIntensity: 0.55,
}

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

  /*
    Roughness for the walkable surface, and the only map it takes.

    Uniform roughness across a thirty-two metre disc means the grazing-angle
    sheen sweeps over the entire island as one clean band whenever the camera
    turns, which is the tell that the ground is a single polygon. Because three
    computes `roughnessFactor *= texelRoughness.g`, a map can only make a
    surface smoother, so the material's own roughness is biased upward by the
    map's mid value and the map swings either side of it. The two numbers have
    to agree, which is why both come from `groundTexture.ts` rather than being
    typed here.
  */
  const roughness = useMemo(() => {
    const texture = createGroundRoughnessTexture()
    const repeat = (PLATEAU_RADIUS * 2) / GROUND_METRES_PER_TILE
    texture.repeat.set(repeat, repeat)
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
            No normal map and no clearcoat. Both are deliberate: this surface is
            meant to take light evenly and never produce a highlight that
            suggests a material it is not, and relief on a lawn is what makes it
            read as wet rock. The target roughness is 0.90, reached as
            0.90 * (1 / 0.80) against a map whose mid green is 0.80.
          */}
          <meshPhysicalMaterial
            map={surface}
            roughnessMap={roughness}
            roughness={0.9 * GROUND_ROUGHNESS_BIAS}
            metalness={0}
            clearcoat={0}
          />
        </mesh>
        <CylinderCollider args={[0.5, PLATEAU_RADIUS]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* The rim's vertical face, which is what gives the island thickness from
          a low angle. Dirt rather than grass, so the plateau reads as a lid,
          and two full bands darker than the lawn so the lid reads as a lid in a
          desaturated frame as well as a coloured one. */}
      <mesh position={[0, -0.5, 0]} receiveShadow castShadow>
        <cylinderGeometry
          args={[PLATEAU_RADIUS, PLATEAU_RADIUS * 0.97, 1, RIM_SEGMENTS, 1, true]}
        />
        <meshPhysicalMaterial {...ground(RIM_COLOR, dirt, RIM_DEMOTION)} side={DoubleSide} />
      </mesh>

      {/* Soil band and root cone beneath. Never walked on, so these are free to
          be as irregular as they like. */}
      <mesh position={[0, -1.8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[PLATEAU_RADIUS * 0.97, 9, 2, RIM_SEGMENTS]} />
        <meshPhysicalMaterial {...ground(RIM_COLOR, dirt, RIM_DEMOTION)} />
      </mesh>
      <mesh position={[0, -4.2, 0]} castShadow>
        <coneGeometry args={[9, 4, 48]} />
        {/* The deepest thing on the island and the furthest from the key, so it
            takes the least environment of anything in the scene. */}
        <meshPhysicalMaterial
          {...mattePlastic(UNDERSIDE_COLOR, { envMapIntensity: 0.35 })}
        />
      </mesh>
    </>
  )
}
