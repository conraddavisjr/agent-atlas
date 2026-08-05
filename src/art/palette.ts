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

  /** Hub island. Plastic grass, never photoreal green. */
  grass: '#5fd68a',
  grassDeep: '#2f9c5e',
  soil: '#c98a56',
  soilDeep: '#8f5a34',
  rock: '#b8c2cc',

  /** Sky gradient, top to horizon. Soft and warm, the diorama sits inside it. */
  skyTop: '#7fd4f5',
  skyHorizon: '#ffe6c4',

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
