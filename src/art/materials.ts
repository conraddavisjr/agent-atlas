import type { ThreeElements } from '@react-three/fiber'

/** R3F v9 derives element props from three itself rather than exporting them by name. */
type MeshPhysicalMaterialProps = ThreeElements['meshPhysicalMaterial']

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
