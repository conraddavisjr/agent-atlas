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

/**
 * Every vantage below is sited against the Foundry layout in
 * `docs/design/03-environment.md` section 1, and the numbers that matter are
 * repeated here rather than left implicit, because a vantage that silently
 * drifts off its subject is worse than no vantage at all: it still produces a
 * screenshot, and the screenshot still looks like evidence.
 *
 * The layout facts these are derived from:
 *
 *   Lawn        y 0.00, plateau radius 16
 *   Core        Puck A radius 6.00 top 0.40, B 4.00 top 0.80, C 2.20 top 1.20
 *   Struts      radius 2.10 on Puck C, at 45 / 135 / 225 / 315 degrees
 *   Core node   (0, 6.00, 0), radius 1.15, completion ring major radius 2.20
 *   Spur lobes  radius 1.50 at (+/-5, 0, +/-5), top 0.40, one totem on each
 *   Bridge      radius 2.20 at (0, 0, -4.40), top 1.60
 *   T1          x [-6, 6]  z [-6.60, -10.60]  top 2.00
 *   T2          x [-4, 4]  z [-10.60, -12.40] top 2.40
 *   T3          x [-4, 4]  z [-12.40, -15.00] top 2.80
 *   Portal      (0, 2.80, -14.5)
 *   Pylons      radius 14.6 at 0 / 30 / 150 / 180 / 210 / 240 / 300 / 330 deg,
 *               so the 60-to-120 arc is an open window in the SOUTH (+Z) and
 *               270 is open in the NORTH, which is the portal's sightline out
 *
 * `playerAt` is a teleport target, not a resting position, so its y is the
 * surface it stands on plus 1.2. The capsule falls the remainder during the
 * settle frames `capture` runs before it freezes, which is also what lets the
 * landing squash relax.
 *
 * Two of these deliberately sit at the same key azimuth. `atan2(9, 5)` is
 * 1.0637 rad, or 60.9 degrees measured from +Z toward +X, which is where the
 * key light and the SkyDome's sun both are. `hub-grazing` and `hub-backlit`
 * point within a few degrees of it on purpose: one to catch the vegetation
 * translucent from behind, the other to put every silhouette edge at the
 * grazing angle where clearcoat Fresnel peaks.
 */
export const VANTAGES: Record<string, Vantage> = {
  /**
   * The wide shot. If the composition is wrong, it is wrong here first.
   *
   * From the south-east and high, looking down the island's axis so the whole
   * ziggurat reads at once: lawn, then the four-lobed Core, then the stepped
   * deck stack, then the portal at the far rim. The camera sits above the
   * pylons rather than between them, so the ring reads as the near frame it is
   * meant to be instead of as a fence in the way.
   */
  'hub-establishing': {
    position: [10.5, 12, 27.5],
    lookAt: [-0.5, 2.4, -4],
    fov: 38,
    playerAt: [2.2, 1.2, 8.6],
    playerFacing: Math.PI,
    time: 0,
    judges: 'Overall composition, the three value bands, sky and fog agreement, island silhouette against the backdrop.',
  },

  /**
   * The money shot: the portal is the destination the whole hub points at.
   *
   * The camera sits over the bridge mouth at the south end of T1 and looks
   * north up the deck stack, so the three risers between it and the arch are
   * all in frame edge-on. That is the shot that has to prove the stack reads as
   * steps rather than as one slab, and it is the only place the trunk trace is
   * visible climbing all three of them.
   */
  'hub-portal': {
    position: [3.9, 5.1, -5.4],
    lookAt: [0.2, 3.5, -13.8],
    fov: 45,
    playerAt: [1.5, 3.6, -11.6],
    playerFacing: Math.PI,
    time: 0,
    judges: 'Stonework material, the portal shimmer and ring emissives against the bloom threshold, depth separation between platform and field.',
  },

  /**
   * Close on the character, which is where amateur reads as amateur.
   *
   * He stands on Puck A's outer ring, which is the widest clean stone the
   * layout has and the only place the contact blob can be judged against a flat
   * band-1 surface rather than against grass. The camera is north-east of him
   * looking back south-west, so the background is open lawn, the south rim and
   * sky rather than the rest of the Core: a silhouette judged against more
   * stone of the same value is not being judged at all.
   */
  'hub-character': {
    position: [2.55, 1.75, 7.6],
    lookAt: [0, 1.05, 5.05],
    fov: 32,
    playerAt: [0, 1.6, 5.0],
    playerFacing: 2.35,
    time: 0,
    judges: 'Character proportions and silhouette, shell material and its two specular lobes, visor, and above all whether the contact shadow makes it sit on the ground rather than hover.',
  },

  /**
   * Ground level, looking into the key. Vegetation lives or dies here.
   *
   * Camera 0.32 m off the lawn on the south-west, pointed along the key's own
   * azimuth so the blades are lit from behind. The sightline runs out through
   * the open southern pylon window and off the plateau, which is what puts sky
   * rather than stonework behind the field.
   */
  'hub-grazing': {
    position: [-6.5, 0.75, 6.6],
    lookAt: [3.1, 0.5, 11.95],
    fov: 45,
    playerAt: [-1.5, 1.2, 9.2],
    playerFacing: -1.35,
    time: 7.3,
    judges: 'Grass density and colour ramp at a grazing angle, ambient occlusion at the blade-to-ground contact, ground texture aliasing, specular across the field.',
  },

  /**
   * Emissives at close range, where a bloom budget error shows up first.
   *
   * The south-west spur, which carries `what-is-ai`, the first totem a player
   * walking in from the spawn meets. The player stands on the same lobe so a
   * white shell is in frame as the control: the acceptance is not "the totem
   * glows", it is "the totem glows and the shell beside it does not".
   */
  'hub-totem': {
    position: [-2.6, 1.7, 7.9],
    lookAt: [-5.2, 1.05, 5.0],
    fov: 38,
    playerAt: [-6.3, 1.6, 4.3],
    playerFacing: 1.08,
    time: 0,
    judges: 'Totem emissive intensity against the bloom threshold. Nothing except the emissive itself may glow.',
  },

  /**
   * The rim-light acceptance shot, and the one that fails first if the light
   * budget is wrong. Camera into the key means every silhouette edge is at a
   * grazing angle, which is exactly where clearcoat Fresnel peaks.
   *
   * Sited on the open south-east lawn rather than on a deck, and the reason is
   * the kerbs. Every raised deck in this layout is outlined in band-2 trim
   * 0.60 m proud of its surface, so a camera low enough to look INTO the key
   * from below is also low enough for that trim to cut the subject off at the
   * chest. Out on the lawn the only thing behind him is the island rim and
   * then sky, and a rim light is only assessable against something it can
   * separate from.
   *
   * The camera bearing is `atan2(9, 5)` to three decimal places, which is the
   * key's own azimuth, so the subject sits exactly between the lens and the
   * sun.
   */
  'hub-backlit': {
    position: [3.83, 1.35, 5.46],
    lookAt: [7.5, 1.05, 7.5],
    fov: 34,
    playerAt: [7.5, 1.2, 7.5],
    playerFacing: -1.33,
    time: 0,
    judges: 'Whether the rim reads at all, and whether anything other than an emissive has crossed the bloom threshold at a grazing angle.',
  },
}

export type VantageName = keyof typeof VANTAGES
