import type { ThreeElements } from '@react-three/fiber'
import { Vector2, type Texture } from 'three'

/** R3F v9 derives element props from three itself rather than exporting them by name. */
type MeshPhysicalMaterialProps = ThreeElements['meshPhysicalMaterial']

/** The map set produced by `usePbrTextures`. */
type PbrMaps = {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
  aoMap: Texture
}

/**
 * Material presets that produce the toy look.
 *
 * The single most important property here is `clearcoat`. It adds a thin
 * reflective layer over the base colour, which is exactly what separates
 * injection-moulded plastic from flat matte shading. Without it, everything
 * reads as untextured programmer art no matter how good the palette is.
 *
 * These are prop objects rather than shared material instances on purpose.
 * Spreading them into JSX keeps scenes declarative, and three.js already shares
 * compiled shader programs between materials with identical configuration, so
 * the cost is a little memory rather than a shader recompile per mesh.
 */

/** Glossy moulded plastic. The default for almost everything in the world. */
export function plastic(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.25,
    ...overrides,
  }
}

/** Softer, chalkier plastic for large surfaces that would otherwise be too shiny. */
export function mattePlastic(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.75,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.6,
    ...overrides,
  }
}

/** Rubbery, grippy surfaces such as feet and bumpers. No clearcoat at all. */
export function rubber(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.95,
    metalness: 0,
    clearcoat: 0,
    ...overrides,
  }
}

/** Brushed metal for joints and hardware. Kept low-key so it never steals focus. */
export function metal(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.4,
    metalness: 0.9,
    clearcoat: 0.3,
    ...overrides,
  }
}

/**
 * Anything that should look powered: the visor, circuit traces, crystals.
 * `intensity` above 1 is what pushes it past the bloom threshold in PostFX,
 * so this is the only way anything in the game is allowed to glow.
 */
export function emissive(
  color: string,
  intensity = 2,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    ...overrides,
  }
}

/**
 * Textured stone, for the portal platform, ramp, arch and totem plinths.
 *
 * The albedo is tinted by `color` rather than used raw. That is the decision
 * that keeps this in the same world as everything else: a photographic grey
 * rock dropped next to flat-shaded plastic reads as an asset from a different
 * game, whereas the same photograph multiplied by `palette.rock` reads as
 * detail added to a surface that was already there.
 *
 * Clearcoat is kept far below the plastic presets but not removed. Stone is not
 * glossy, but a trace of it keeps the material sitting in the same lighting
 * response as its neighbours instead of going conspicuously dead.
 *
 * Pass maps from `usePbrTextures('stone', ...)`, which owns the tiling density.
 */
export function stone(
  color: string,
  maps: PbrMaps,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    ...maps,
    // Overridden by roughnessMap per texel; this is the multiplier against it.
    roughness: 1,
    metalness: 0,
    normalScale: new Vector2(1, 1),
    /*
      Occlusion from the map is pushed past 1. Baked AO in a tiling texture is
      averaged over every direction a surface could face, so at its authored
      strength it reads as a faint smudge once real lighting is on top of it.
      Overdriving it is what makes the crevices read as depth rather than as
      dirt, and it costs nothing.
    */
    aoMapIntensity: 1.35,
    clearcoat: 0.15,
    clearcoatRoughness: 0.8,
    ...overrides,
  }
}

/**
 * Terrain: the island's grass and the dirt at its rim.
 *
 * Separate from `stone` because ground is read almost entirely at a grazing
 * angle, and that changes what matters. No clearcoat at all, since a specular
 * sheen across a whole field reads as wet plastic. Stronger normals, because
 * relief is the only thing giving a flat plane any form once the camera is
 * low. And occlusion pushed harder still, since it is doing the work of the
 * shadowing between blades that the geometry cannot afford to model.
 */
export function ground(
  color: string,
  maps: PbrMaps,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps {
  return {
    color,
    ...maps,
    roughness: 1,
    metalness: 0,
    normalScale: new Vector2(1.4, 1.4),
    aoMapIntensity: 1.5,
    clearcoat: 0,
    ...overrides,
  }
}

/**
 * Translucent plastic, for token crystals and portal fills.
 * `transmission` is expensive, so this is used sparingly and never on the hub floor.
 */
export function gel(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transmission: 0.6,
    thickness: 0.5,
    transparent: true,
    opacity: 0.85,
    ...overrides,
  }
}
