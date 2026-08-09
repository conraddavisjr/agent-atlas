/**
 * The palette is the single source of colour truth for the whole game.
 *
 * Direction comes from the toy-plastic look researched from Team ASOBI's public
 * material: saturated but never neon, a warm key against cool shadows, and
 * surfaces that read as injection-moulded plastic rather than real materials.
 *
 * Deliberately distinct from Astro: the robot is warm amber on off-white with a
 * horizontal cyan visor, not blue-and-white with two round eyes and a chrome dome.
 */

export const palette = {
  /** Robot shell. Slightly warm off-white so it never reads as clinical grey. */
  shell: '#f4f1ea',
  shellShadow: '#d8d2c6',
  /** The robot's single accent. Warm amber, chosen to sit clear of PlayStation blue. */
  accent: '#ff9a3c',
  accentDeep: '#e0651a',
  /** Emissive cyan for the visor bar and every "this is powered" cue in the world. */
  visor: '#4de2ff',
  visorDim: '#1b7f96',

  /**
   * Hub island. Bright yellow-green rather than the previous blue-leaning
   * green, which is most of what separates a lawn from a field.
   *
   * Darkened into the gameplay value band. The greyscale test is the one that
   * outranks the others: desaturate a frame and you must still read instantly
   * where you can stand. The lawn and the stone deck used to sit at almost
   * exactly the same luminance, 0.83 against 0.85, so a desaturated frame was
   * one flat shape and the deck simply vanished into the field.
   */
  grass: '#7dc244',
  grassDeep: '#3f7a26',
  /** Blade tips, lighter again, so a dense field has depth rather than a flat top. */
  grassTip: '#86c04e',
  /**
   * Soil, moved down into the midground band.
   *
   * At its old value the island's rim sat inside the gameplay band, which is
   * why the island read as having no thickness: the cliff face was the same
   * value as the lawn on top of it, so the eye had nothing to separate them.
   */
  soil: '#6b4d31',
  soilDeep: '#452f1c',

  /**
   * Stonework. A cool light grey with lilac and gold, which is the chip-block
   * scheme: grey substrate, coloured components, gold contacts.
   */
  /*
    Stone, darkened out of the lawn's value band.

    This is the other half of the same fix as the grass above, and the half
    that actually closes it: at #d5d9e0 the deck measured 0.850 against a
    ground texture at 0.830, so the two were indistinguishable in greyscale no
    matter what the ground did on its own.
  */
  rock: '#b6bcc7',
  rockDeep: '#a7aebb',
  rockAccent: '#c3a8dd',
  gold: '#e8b84b',

  /** Ground cover. Cornflower petals with a warm centre. */
  flower: '#5aa9f5',
  flowerPale: '#b9dcff',
  flowerCentre: '#ffd24a',

  /**
   * Sky gradient, top to horizon, and the cloud sea the island floats above.
   *
   * Cool the whole way through now. The warm cream horizon it replaced made the
   * island read as sitting in haze rather than in air, and it fought every
   * green in the world.
   */
  skyTop: '#5aa8e8',
  skyHorizon: '#d6ecfb',
  cloud: '#ffffff',
  cloudShadow: '#c2d8ea',

  /** AI motif props. These stand in for the concepts each lesson will teach. */
  node: '#7c6bff',
  nodeGlow: '#a99bff',
  token: '#ff6bd6',
  circuit: '#4de2ff',

  /**
   * Cave scene. Cool and dark so the transition reads as a real change of place.
   *
   * Lightened from the first pass. Dark albedo plus dim lighting compounds: the
   * two together produced a room that read as solid black rather than moody, and
   * a player cannot navigate what they cannot see. Atmosphere comes from the
   * colour temperature and the crystal glow, not from underexposure.
   */
  caveRock: '#5b6478',
  caveRockDeep: '#3a4154',
  caveCrystal: '#8b7bff',

  /**
   * Progression states. Locked things are desaturated, never merely dimmed.
   *
   * These sit lighter than they look like they should on paper. The key light is
   * steeply overhead, so a vertical surface facing the player receives only about
   * a third of it; mid-greys chosen against a swatch render as near-black on a
   * portal door and destroy the read.
   */
  locked: '#8a93a3',
  lockedDeep: '#4a5160',
  unlocked: '#ffd45e',
} as const

export type PaletteColor = keyof typeof palette
