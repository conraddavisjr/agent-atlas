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
  /**
   * Lesson completion to pin before the shot, because for two of these the
   * subject named in `judges` only exists in one progression state.
   *
   * `'all'` is the default and is right for five of the six. See the note on
   * `hub-totem`, which is the exception and the reason this field exists.
   */
  progress?: 'all' | 'none' | readonly string[]
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
 * landing squash relax. It comes to rest with its centre 0.72 m above the
 * surface, so a settled shot reads `playerAt[1] - 0.48` and a shot that still
 * reads `playerAt[1]` was frozen before physics ran.
 *
 * **Three of these were re-sited after `__dev.framing()` was built**, which
 * projects the character's bounds into the frame and reports what fraction of
 * the height it spans. The header above is not being rhetorical: two of the six
 * had genuinely stopped framing what their `judges` line claims, and both had
 * been producing screenshots that looked like evidence the whole time. Current
 * coverage, which is worth re-running after anything that changes the
 * character's size:
 *
 *   hub-establishing  0.14   the character is a figure for scale, not a subject
 *   hub-portal        0.38
 *   hub-grazing       0.45
 *   hub-backlit       0.55
 *   hub-totem         0.61
 *   hub-character     0.61
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
   *
   * **Re-sited, because it had stopped being able to answer its own question.**
   * At the original 3.67 m the character filled 1.125 of the frame height with
   * his head cropped off the top, and `playerFacing` of 2.35 turned him away
   * from the lens, so the visor - one of the four things this shot exists to
   * judge - was not in the picture at all. Neither number was ever wrong: the
   * character was re-proportioned to 2.52 head-heights partway through the art
   * pass and grew past a frame that had been sized for the old one. That is the
   * silent drift the header warns about, and `__dev.framing()` now measures it.
   * 4.81 m and a facing 34 degrees off the camera axis put the whole figure in
   * shot at 0.61 of frame height, three-quarter front, with both feet and the
   * contact blob clear of the bottom edge.
   */
  'hub-character': {
    position: [4.13, 1.72, 9.21],
    lookAt: [0, 1.15, 5.0],
    fov: 32,
    playerAt: [0, 1.6, 5.0],
    playerFacing: 1.375,
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
   *
   * **The control has to be visible for the comparison to mean anything, and it
   * was not.** The old `playerAt` sat directly behind the totem on the
   * camera's sightline, so the totem occluded the character from the chest
   * down and the white shell - the entire point of standing him here - was
   * hidden behind the object it was meant to be compared against. He now
   * stands 1.35 m to the side, square-on to the lens, with the ring and the
   * shell side by side at the same distance and the same light. The camera is
   * also 0.65 m higher, because at the old height the totem's ring sat exactly
   * across his waist.
   */
  'hub-totem': {
    position: [-1.9, 2.35, 8.9],
    lookAt: [-5.3, 1.15, 5.2],
    fov: 38,
    playerAt: [-6.0, 1.6, 5.9],
    playerFacing: 1.54,
    time: 0,
    /*
      Four of five, and the one left out is the one this camera is pointed at.

      `lookAt` is the `what-is-ai` totem at (-5, STEP, 5), and **a completed
      totem has no ring.** The ring is the progress indicator, so at five of five
      this vantage frames a bare plinth and judges an emissive that is not in the
      frame. Captured side by side in one page load, the ring is a large pale
      torus standing proud of the plinth at zero lessons and simply absent at
      five, and the shot's whole acceptance criterion is that ring's intensity
      against the bloom threshold.

      Round 2 reported "Totem ring, hub-totem x=930, peak 0.921" alongside
      "Portal lintel bar, hub-portal, peak 0.948" - and the portal is a sealed
      slab with a lock plate until every basics lesson is done, so those two
      numbers cannot have come from the same save. Progression was never pinned,
      so each round was measuring whatever state the profile happened to be in.
      That is what this field closes.

      The cost is that the chrome dome is a cosmetic earned after the whole
      basics zone, so holding one lesson back removes it from this shot. That is
      the right trade: the dome is judged at `hub-character` and `hub-backlit`,
      and the second half of this criterion - nothing other than an emissive may
      cross the threshold - is `hub-backlit`'s job by its own wording.
    */
    progress: ['what-is-an-llm', 'popular-models', 'what-is-a-prompt', 'first-prompt'],
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
   * sun. Moving the pair further out along that same bearing preserves it
   * exactly, which is why the re-siting below is a slide rather than a
   * re-aiming.
   *
   * **Moved 2.4 m further out, for room.** At the old 4.2 m the character
   * filled 0.85 of the frame height, and a rim is judged on the silhouette
   * EDGE against what is behind it - so a subject that nearly fills the frame
   * leaves almost nothing to be separated from, which is the same objection
   * the kerb note above makes about decks. Pulling the camera straight back
   * along the bearing put it inside Puck A and filled a third of the frame
   * with Core stone, so the whole vantage slid outward instead: the subject
   * now stands at radius 13.3, still inside the 30-to-150 degree pylon window,
   * with the horizon across his knees and open sky above the head.
   */
  'hub-backlit': {
    position: [3.78, 1.49, 6.59],
    lookAt: [9.2, 1.15, 9.6],
    fov: 34,
    playerAt: [9.2, 1.2, 9.6],
    playerFacing: -1.33,
    time: 0,
    judges: 'Whether the rim reads at all, and whether anything other than an emissive has crossed the bloom threshold at a grazing angle.',
  },
}

export type VantageName = keyof typeof VANTAGES
