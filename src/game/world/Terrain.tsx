import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { palette } from '@/art/palette'
import { mattePlastic } from '@/art/materials'
import { paintByFacing } from '@/art/geometry'
import {
  createGroundRoughnessTexture,
  createGroundTexture,
  GROUND_METRES_PER_TILE,
  GROUND_ROUGHNESS_BIAS,
} from '@/art/groundTexture'
import { PLATEAU_RADIUS, islandSkirtLathe } from './hubLayout'

/**
 * The island's ground, and the skirt that gives it thickness.
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
 * ## The island used to have a rim and no thickness, and those are compatible
 *
 * The previous version drew three separate meshes below the lawn - a rim
 * cylinder, a soil band and a root cone - each tapering INWARD from the plateau
 * radius, each with a photographic dirt material, each casting and receiving
 * shadows. Six draw calls with their shadow passes, and not one pixel of any of
 * them ever reached a frame.
 *
 * The reason is the camera. Every vantage in this game looks DOWN at the
 * island. The far rim is behind the lawn, the near rim is behind the camera,
 * and the lateral rims face away, so a skirt that narrows as it descends is
 * occluded by the disc above it from every angle the game is ever seen from.
 * The critique measured the consequence exactly: the lawn ends against sky as a
 * hard curve with nothing below it.
 *
 * So the fix is not more geometry. It is one lathe with an **overhanging lip**:
 * the first stop below the lawn steps outward as well as down, so a band of
 * soil projects past the plateau's silhouette all the way round and the island
 * gains an edge from every elevated angle. The lip is up-facing, so it takes
 * the steeply overhead key almost in full and lands in the midground band as a
 * value measured on the frame rather than as an albedo that happens to be in
 * range. Below it the cliff turns down and in and goes darker, which is correct
 * and free: the lip overhangs it, so the cliff is largely hidden behind its own
 * lip in exactly the shots where a near-black cliff against a pale sky would
 * have been the frame's strongest edge.
 *
 * One mesh, one material, no shadow interaction. Three draw calls saved, and it
 * is the first version of this that is visible at all.
 *
 * ## And the photograph is gone with it
 *
 * The dirt was defended on the grounds that the rim is background and a cliff
 * is the one place a photograph does the right job. That argument was made
 * about geometry nobody could see. Now that the lip is the island's silhouette
 * in every wide shot, a photographic normal map on it would put a
 * high-frequency real-world surface along a 100-pixel edge against a world with
 * no surface detail anywhere else - which is the same defect the portal arch
 * was just corrected for, on a much longer edge.
 */

export { PLATEAU_RADIUS }

/** Enough that the rim reads as a circle rather than a polygon at this scale. */
const RIM_SEGMENTS = 128

/**
 * Band 2, the midground, split by facing rather than by mesh.
 *
 * The lip takes `palette.soil` unchanged: display luma 0.319 on a surface whose
 * normal Y is about 0.90, which takes the steeply overhead key almost in full
 * and should render near 0.29, mid-band.
 *
 * The cliff cannot take `palette.soilDeep`, and the reason is the whole lesson
 * of the critique rather than an oversight. The band test is a statement about
 * the frame. A surface facing down and outward receives a small fraction of
 * that same key, so an albedo already sitting at the band's value renders far
 * below it: `soilDeep` at 0.197 would come out near 0.06, which is darker than
 * the pylons the critique named as the worst edge in the picture. 0.414 is the
 * albedo that puts the rendered cliff at roughly 0.20 to 0.25.
 *
 * It is a local constant only because `palette.ts` belongs to the integrator
 * this pass. It is the proposed new value for `palette.soilDeep`, which has no
 * other call site in the project, and it must not carry a `band()` assertion
 * when it lands there.
 */
const CLIFF = '#8a6440'

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

  /**
   * The skirt: lip, cliff and root, as one lathe.
   *
   * The two values ride on a vertex colour rather than on two materials, the
   * same trick `deckBatch` uses, so the whole underside of the world is one
   * draw. The changeover threshold is high - 0.62 - because the lip's normal Y
   * is 0.90 and the vertical face immediately below it is 0.32, and the line
   * between them is meant to be the hard bottom edge of the lip rather than a
   * gradient across it.
   */
  const skirt = useMemo(
    () =>
      paintByFacing(islandSkirtLathe(PLATEAU_RADIUS, RIM_SEGMENTS), {
        up: palette.soil,
        side: CLIFF,
        threshold: 0.62,
        softness: 0.12,
      }),
    [],
  )

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

      {/*
        No shadow interaction at all, and it is a saving rather than a
        compromise. The skirt hangs below a solid disc under a steeply overhead
        key, so everything it would ever cast onto is already in the plateau's
        own shadow and there is nothing under the island to receive anything.
        Casting would put a second full pass over a 128-segment lathe to change
        no pixel.
      */}
      <mesh geometry={skirt}>
        <meshPhysicalMaterial
          {...mattePlastic('#ffffff', { vertexColors: true, envMapIntensity: 0.4 })}
        />
      </mesh>
    </>
  )
}
