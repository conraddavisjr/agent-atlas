/**
 * Fixed camera vantages for repeatable screenshots.
 *
 * The problem this solves is that "does it look better" was previously
 * unanswerable. The camera springs, orbits and pulls in around obstacles, the
 * grass moves, and the player is wherever they were left, so no two captures
 * were ever comparable and every judgement about the art was an argument about
 * memory.
 *
 * Each vantage pins all of it: where the player stands, which way they face,
 * where the camera sits, what it looks at, its field of view, and the exact
 * clock time the world is frozen at. Two captures of the same vantage differ
 * only by what actually changed in the rendering.
 *
 * Each one also has a job. A vantage that is not judging something specific is
 * a vantage nobody looks at twice, so `judges` is required rather than
 * decorative: it is the acceptance criterion for that shot.
 */

export type Vantage = {
  /** Camera world position. */
  position: [number, number, number]
  /** The point the camera looks at. */
  lookAt: [number, number, number]
  /** Vertical field of view in degrees, independent of the live camera's. */
  fov: number
  /** Where the player is teleported before the shot. */
  playerAt: [number, number, number]
  /** Player facing in radians, so the character presents the same side. */
  playerFacing: number
  /** Clock time to freeze at, in seconds. */
  time: number
  /** What this shot is for. Its acceptance criterion. */
  judges: string
}

/**
 * Two freeze times rather than one, because a single sample cannot catch a
 * problem that depends on wind phase. Zero is the deterministic mount state and
 * 7.3 is an arbitrary point mid-cycle, chosen only for being nowhere near a
 * multiple of any wind frequency in the scene.
 */
export const CAPTURE_TIMES = [0, 7.3] as const

export const VANTAGES: Record<string, Vantage> = {
  /** The wide shot. If the composition is wrong, it is wrong here first. */
  'hub-establishing': {
    position: [22, 14, 24],
    lookAt: [0, 1, 0],
    fov: 40,
    playerAt: [0, 1.2, 4],
    playerFacing: 0,
    time: 0,
    judges: 'Overall composition, the three value bands, sky and fog agreement, island silhouette against the backdrop.',
  },

  /** The money shot: the portal is the destination the whole hub points at. */
  'hub-portal': {
    position: [4.5, 3.2, 3.0],
    lookAt: [9, 2.0, -5.5],
    fov: 50,
    playerAt: [6.0, 1.2, -1.0],
    playerFacing: -0.9,
    time: 0,
    judges: 'Stonework material, the portal shimmer and ring emissives against the bloom threshold, depth separation between platform and field.',
  },

  /** Close on the character, which is where amateur reads as amateur. */
  'hub-character': {
    position: [1.6, 1.3, 2.6],
    lookAt: [0, 0.7, 0],
    fov: 35,
    playerAt: [0, 1.2, 0],
    playerFacing: 0.5,
    time: 0,
    judges: 'Character proportions and silhouette, shell material and its two specular lobes, visor, and above all whether the contact shadow makes it sit on the ground rather than hover.',
  },

  /** Ground level, looking into the key. Vegetation lives or dies here. */
  'hub-grazing': {
    position: [-2.0, 0.35, 6.5],
    lookAt: [6, 1.0, -2],
    fov: 45,
    playerAt: [-1.0, 1.2, 5.0],
    playerFacing: -1.2,
    time: 7.3,
    judges: 'Grass density and colour ramp at a grazing angle, ambient occlusion at the blade-to-ground contact, ground texture aliasing, specular across the field.',
  },

  /** Emissives at close range, where a bloom budget error shows up first. */
  'hub-totem': {
    position: [-4.2, 1.8, -0.5],
    lookAt: [-6.5, 1.2, -2.5],
    fov: 40,
    playerAt: [-5.2, 1.2, -1.2],
    playerFacing: -2.4,
    time: 0,
    judges: 'Totem emissive intensity against the bloom threshold. Nothing except the emissive itself may glow.',
  },

  /**
   * The rim-light acceptance shot, and the one that fails first if the light
   * budget is wrong. Camera into the key means every silhouette edge is at a
   * grazing angle, which is exactly where clearcoat Fresnel peaks.
   */
  'hub-backlit': {
    position: [-6, 2.2, -7],
    lookAt: [2, 1.0, 1],
    fov: 45,
    playerAt: [0, 1.2, 0],
    playerFacing: 2.2,
    time: 0,
    judges: 'Whether the rim reads at all, and whether anything other than an emissive has crossed the bloom threshold at a grazing angle.',
  },
}

export type VantageName = keyof typeof VANTAGES
