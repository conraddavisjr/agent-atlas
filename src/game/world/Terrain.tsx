import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, CylinderCollider } from '@react-three/rapier'
import { mattePlastic } from '@/art/materials'
import { paintByHeight } from '@/art/geometry'
import {
  createGroundRoughnessTexture,
  createGroundTexture,
  GROUND_METRES_PER_TILE,
  GROUND_ROUGHNESS_BIAS,
} from '@/art/groundTexture'
import { PLATEAU_RADIUS, islandSkirtLathe, islandSkirtValues } from './hubLayout'

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
 * The fix was not more geometry, it was one lathe with an **overhanging lip**,
 * and it worked: the island gained an edge. The version after it - the current
 * one - is about what that edge turned out to be made of. See
 * `hubLayout.islandSkirtProfile`, which carries the arithmetic. The short form:
 * the overhang's widest stop is the island's lower silhouette, so putting it
 * 0.52 m below the lawn made the whole visible band an up-facing shelf, which
 * measured 95.8% of every skirt pixel in `hub-establishing` with the cliff
 * contributing zero. The widest stop is now 1.80 m down, and the band it
 * bounds is a wall rather than a shelf.
 *
 * One mesh, one material, no shadow interaction. Three draw calls saved, and it
 * is the first version of this that is visible at all.
 *
 * ## Why the values ride on height and not on facing
 *
 * A lathe segment is one conical band with one normal, so `paintByFacing` gives
 * it one value however many stops the profile has. That is why the old skirt
 * measured a flat 0.230 to 0.202 down ninety pixels: the surface was one band,
 * and 0.028 of the 0.029 of fall was the vignette rather than the soil.
 * `paintByHeight` puts a rung on every profile stop instead, so the gradient
 * down the silhouette is authored rather than hoped for, and the decision
 * document's "darkest at the bottom of the silhouette" becomes a thing the
 * geometry states.
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

/**
 * Enough that the rim reads as a circle rather than a polygon at this scale.
 *
 * Re-derived rather than re-trusted when the keel moved the island's silhouette
 * edge 1.28 m further down, because the edge got longer and more prominent and
 * this was the obvious thing to have to raise. It does not: at radius 16.78 a
 * 128-gon's facet sagitta is 0.0051 m, and the nearest rim in `hub-establishing`
 * is 17.8 m from the lens at 74.7 px/m, so the facet bulge is 0.38 px. Raising
 * it to 256 changes the predicted underside area by 0.3% and the sagitta to a
 * tenth of a pixel, which is 1,536 triangles bought for nothing.
 */
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
   * The skirt: shelf, keel wall and root, as one lathe.
   *
   * Six values ride on a vertex colour rather than on six materials, the same
   * trick `deckBatch` uses, so the whole underside of the world is one draw.
   */
  const skirt = useMemo(
    () =>
      paintByHeight(
        islandSkirtLathe(PLATEAU_RADIUS, RIM_SEGMENTS),
        islandSkirtValues(PLATEAU_RADIUS),
      ),
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
        Still no shadow interaction, and `receiveShadow` was reconsidered
        properly this round rather than inherited. The keel is now visible and
        the shelf above it overhangs, so "the lip casting onto the keel" is the
        best contact this frame could have had. It cannot happen, and the reason
        is not the shadow frustum.

        THE FRUSTUM IS NOT THE PROBLEM. At `hub-establishing` the caster's box
        centres on the player pushed 5 m along the camera bearing and clamped to
        radius 6, which lands at (0.55, 0.50, 3.88). Over the visible keel that
        puts light-space u in -13.4..17.3 and v in -11.2..9.6 against a half
        extent of 12, and depth from the light in 20.2..41.2 m against near 10
        and far 52. So 75% of the visible keel is INSIDE the frustum already.

        WHAT STOPS IT IS THE SUN'S ELEVATION. The key sits at elevation 42.7
        degrees. The camera's depression angle where it grazes the island's rim
        is 44.7 degrees. Those are within two degrees of each other, so the
        surface that just clears the overhang into view also just clears it into
        the light: sampled every seventh pixel over the whole visible keel, the
        number of key-lit pixels the island occludes from its own key is ZERO,
        for this profile and for the previous one. `receiveShadow` here would
        buy a second full depth pass over a 256-segment lathe and change no
        pixel, which is precisely what the previous comment claimed for the
        wrong reason.

        Two ways it could become possible, both belonging to whoever owns
        `Lighting.tsx` rather than here: drop the key's elevation, or widen the
        overhang past 1.7 m so its shadow clears the wall below it on the
        key-facing azimuth. The first is a composition decision about the whole
        world; the second doubles the up-facing shelf, which is the one surface
        on this mesh that can only ever be a midground value.
      */}
      <mesh geometry={skirt}>
        <meshPhysicalMaterial
          {...mattePlastic('#ffffff', { vertexColors: true, envMapIntensity: 0.4 })}
        />
      </mesh>
    </>
  )
}
