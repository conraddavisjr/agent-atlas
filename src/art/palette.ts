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

    **And turned from cool grey to warm grey, at the same luma, because the
    world had no temperature axis at all.** Measured on a lit deck in
    `hub-character`: (162,174,184). Red was the LOWEST channel on every lit
    surface in every vantage - deck, puck top, spur lobe alike - so the
    reference brief's split-tone was half built. The shadows are correctly
    cool; there was no warm side for them to be cool against, which is why the
    grey read as dead rather than moulded and why depth had to come from fog.

    The grade was the obvious suspect and it is innocent: captured with
    `?nogfx=lut` the same pixel reads (159,169,181), a shift of three to five
    points. The cause was here. `#b6bcc7` is (182,188,199) - the ALBEDO itself
    leans 17 points blue, so no rig could have fixed it.

    `#bfbbb4` is (191,187,180), display luma 0.7347 against the old 0.7357, so
    the band membership and every measurement in the bible's section 8 table
    are unchanged to within a thousandth. Only the hue moves. Kept a warm
    NEUTRAL rather than a sandstone, because the substrate is meant to read as
    moulded grey with coloured components on it, and against shadows this cool
    eleven points is already a legible axis.
  */
  rock: '#bfbbb4',
  rockDeep: '#b0aca4',
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
   *
   * **The horizon came down from `#d6ecfb`, which was out of band and taking
   * the whole image with it.** Its display luma was 0.9114 against a background
   * band that ends at 0.86, and it rendered at 0.92 to 0.93. Nothing caught it
   * because `band()` is only ever applied to surface albedos, and the sky is not
   * a surface anyone stands on - so the largest single area in every frame was
   * the one thing in the palette exempt from the value system.
   *
   * What that costs is not just the sky. A critique of the second round
   * measured 46 per cent of `hub-establishing` sitting at 0.83 to 0.86 and only
   * 6.5 per cent of the frame below 0.30, and concluded that every other
   * failing was downstream: bloom cannot read because there is nothing dark for
   * light to sit against, the rim cannot read because the shell's shadow side
   * is already at 0.55, and the greyscale test cannot pass because three
   * semantic classes share one value. A world with no shadow end is a product
   * photograph.
   *
   * `#b9cdda` is the same hue and chroma scaled to display luma 0.7913 - inside
   * the background band, near its floor. It also doubles the sky's own gradient,
   * since the zenith stays at 0.6119, and the horizon colour is what
   * `registry.ts` hands to the fog, so distance falls off into the same value
   * rather than into a brighter one.
   */
  skyTop: '#5aa8e8',
  skyHorizon: '#b9cdda',
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

  /**
   * The value bands, as albedo, and the reason they are palette entries.
   *
   * The art bible's acceptance test outranks the others and is meant literally:
   * desaturate a frame and you must still instantly read where you can stand.
   * That works when three bands are separated with real gaps between them -
   * gameplay 0.56 to 0.74, midground 0.20 to 0.38, background 0.76 to 0.86 -
   * and it collapses the moment two surfaces drift into the same one, which is
   * exactly what happened when the deck sat at 0.850 against a lawn at 0.830.
   *
   * These are DISPLAY-space luminances, not linear ones, and the difference
   * matters enough to say twice. The band test asks what the eye reads off the
   * screen, so it is measured on gamma-encoded sRGB, the numbers an eyedropper
   * on a screenshot returns. The bloom budget in `materials.ts` is the opposite
   * and is measured in linear light, because that is what the threshold
   * compares. Checking one against the other produces confident nonsense in
   * both directions.
   *
   * `bandDeckTop` is `rock`, repeated by reference rather than by value so the
   * side face cannot drift away from the top it is defined relative to.
   */
  /**
   * The two gameplay-band surfaces are WARM and the two frame surfaces are
   * COOL, and that split is the point rather than a coincidence of picking.
   *
   * The reference brief asks for cool shadows against warm highlights, and the
   * build had only the first half: every lit surface measured red-lowest, so
   * there was nothing for the cool to be cool against. Putting the warmth on
   * exactly the surfaces the player stands on means the temperature axis and
   * the value axis carry the same message - warm and light is floor, cool and
   * dark is frame - instead of the temperature wandering independently.
   *
   * Luma is held to within two thousandths of the values the bible's section 8
   * table records, so the greyscale test is unaffected by this and the two axes
   * stay independently checkable.
   */
  /** Band 1, 0.735. Deck and puck tops - anything the capsule stands on. */
  bandDeckTop: '#bfbbb4',
  /** Band 1, 0.592. Deck and puck side faces, one step down from their tops. */
  bandDeckSide: '#9d968d',
  /** Band 2, 0.330. Kerbs and trim, which draw a raised deck's outline. */
  bandTrim: '#4b5568',
  /** Band 2, 0.272. Pylons, struts and arcs - the frame, never the floor. */
  bandFrame: '#3c465a',
} as const

export type PaletteColor = keyof typeof palette

/** The three value bands from the art bible's section 8. */
export type ValueBand = 'gameplay' | 'midground' | 'background'

/**
 * Display-space luma bounds per band, inclusive.
 *
 * Kept beside the colours rather than in a spec document because the only
 * version of this rule that survives is one a test can assert against.
 */
export const VALUE_BANDS: Record<ValueBand, readonly [number, number]> = {
  gameplay: [0.56, 0.74],
  midground: [0.2, 0.38],
  background: [0.76, 0.86],
}

/**
 * Rec.709 luma of a hex colour in DISPLAY space.
 *
 * Deliberately not linearised. See the note above: the band test is a statement
 * about what the eye reads off a screenshot, so it is computed on the
 * gamma-encoded values an eyedropper returns.
 */
export function displayLuma(hex: string): number {
  const raw = hex.trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`palette: cannot read "${hex}" as a hex colour`)
  }
  const ch = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2)
}

/**
 * Assert that a colour sits in the band it claims, and hand it back.
 *
 * Meant to be used at the point a surface picks its albedo - `band(palette.rock,
 * 'gameplay')` - so that the claim travels with the call site rather than
 * living in a comment that stops being true. It throws rather than warning: a
 * surface in the wrong band is the one defect the whole art direction is
 * organised around, and the honest failure is a loud one at startup.
 *
 * In production it returns the colour without checking, because the check is a
 * statement about the palette rather than about the frame and the palette
 * cannot change at runtime.
 */
export function band(hex: string, of: ValueBand): string {
  if (!import.meta.env.DEV) return hex
  const [lo, hi] = VALUE_BANDS[of]
  const luma = displayLuma(hex)
  if (luma < lo || luma > hi) {
    throw new Error(
      `palette: ${hex} has display luma ${luma.toFixed(3)}, outside the ${of} band ` +
        `of ${lo} to ${hi}. The greyscale readability test is the one that outranks ` +
        `the others: two surfaces in the same band are one shape once the colour is ` +
        `gone. See docs/design/00-art-bible.md section 8.`,
    )
  }
  return hex
}
