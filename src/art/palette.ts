/**
 * The palette is the single source of colour truth for the whole game.
 *
 * Direction comes from the toy-plastic look researched from Team ASOBI's public
 * material: saturated but never neon, a warm key against cool shadows, and
 * surfaces that read as injection-moulded plastic rather than real materials.
 *
 * **This file used to say "deliberately distinct from Astro: the robot is warm
 * amber on off-white with a horizontal cyan visor, not blue-and-white with two
 * round eyes and a chrome dome." That goal has been abandoned, on purpose, and
 * every clause of it is now false.**
 *
 * The owner asked for the reference to be copied outright - "quite literally
 * attempt to steal Astro's look, completely one-to-one, even if it's blue, with
 * the antenna override" - and chose that over two options that would have kept
 * some distinctness. So the character is now blue-and-white with two round eyes,
 * and the chrome dome is gone rather than kept: it was a cosmetic hemisphere that
 * enclosed the antenna entirely and was the only thing in the game crossing the
 * bloom threshold, which is the budget exactly inverted.
 *
 * What survives from the old direction is everything that was not about being
 * unlike Astro: saturated but never neon, a warm key against cool shadows, and
 * surfaces that read as injection-moulded plastic rather than as real materials.
 * The antenna is ours and stays.
 */

export const palette = {
  /** Robot shell. Slightly warm off-white so it never reads as clinical grey. */
  shell: '#EEF0F4',
  shellShadow: '#d8d2c6',
  /**
   * **RETIRED FROM THE CHARACTER. One call site remains, in `Portal.tsx`.**
   *
   * The direction is that a high-contrast blue-and-orange scheme is not the
   * reference's language, and `90-astro-design-system.md` section 2.1 records the
   * search that backs it: the first-party record names a "PlayStation blue
   * livery", an "iconic blue livery pattern" and a silver head plate, and names
   * blue LED for ally and red LED for enemy as the only colour semantics. **No
   * source of any kind describes that palette as blue-and-orange complementary.**
   * It is a documented negative rather than a preference.
   *
   * Section 2.2 gives the mechanism, and it is the thing three rounds of value
   * tuning could not see: chroma has a ceiling that falls with value, roughly
   * `0.62 * (1 - displayLuma)`. `accent` is chroma 0.765 at luma 0.662 against a
   * ceiling of 0.210 - a debt of 3.64, which caps it at 1.10% of frame. It was
   * covering the chest panel, both ear pods, the head cap, the backpack port, an
   * arm cuff and the cape. That is the single largest violation of the rule on the
   * character, and it is why every neutral around it read as tinted.
   *
   * The replacements are `hardware`, `plate` and `hull` below - a neutral metal
   * and two darks - plus `helmet` blue spent exactly twice. Nothing warm survives
   * on the character at all.
   *
   * Kept rather than deleted because `Portal.tsx` still colours its unlocked arch
   * with `accent`, and choosing what an open gate is made of is a readability
   * decision about a prop rather than a find-and-replace. Doing it blind inside a
   * character commit is how a world ends up with two schemes in it, which is the
   * failure this migration exists to avoid.
   */
  accent: '#ff9a3c',
  accentDeep: '#e0651a',

  /**
   * The character's hardware family, and the direct replacement for `accentDeep`
   * on every moulded fitting: the head cap, the ear pods, the arm cuff.
   *
   * Blue-anodised aluminium. `90-astro-design-system.md` section 2.3 corrects its
   * own first draft here and the correction is the reason this exact hex: Filament
   * puts a metal's base colour in **[170..255] sRGB**, and the `#8FA2B8` that was
   * proposed first has a red channel of 143. `#AEB9C6` clears 170 on every
   * channel, keeps the blue-steel cast, and at display luma 0.720 clears the 0.446
   * floor `metalF0ForCylinderRatio` requires for a metal cylinder to hold a band.
   *
   * Bound through `anodised()` and only on lathed parts, because `anodised()`'s
   * own finding rules a metal out on a flat face: a flat metal sweeps its value
   * with camera yaw and cannot hold a band. Both call sites are lathes.
   */
  hardware: '#AEB9C6',

  /**
   * The character's DARK, and the thing the body did not have.
   *
   * `91-design-critique.md`'s direction: the trap in this migration is treating it
   * as "orange becomes blue", which keeps the structure and swaps the hue. It
   * cannot work arithmetically - `helmet` at debt 2.24 caps at 1.79% of frame and
   * the character is 3 to 6% of it, so all seven amber sites cannot become blue.
   * The reference's structure is a white body, a lot of neutral hardware, ONE
   * dark, and blue spent once.
   *
   * So the largest coloured area on the character, the chest panel, becomes that
   * one dark. Against a shell at 0.9406 this is a drop of about 0.61 of display
   * luma, which is the strongest value edge anywhere on the body and did not exist
   * before at any hue.
   *
   * Deliberately the same value as `bandTrim`, which draws every raised deck's
   * outline. The character's dark and the world's dark being one value is what
   * stops the hero reading as a separate illustration pasted onto the level.
   */
  plate: '#4B5568',

  /**
   * One rung brighter than `plate`, for the backpack.
   *
   * Two darks on one character have to separate in GREYSCALE or they are one dark
   * with a seam in it, which is the bible's section 8 test applied at part scale.
   * `#5F6871` is display luma 0.4029 against `plate`'s 0.3304 - 0.07 apart, about
   * four times what a single byte buys at this end of the curve.
   */
  hull: '#5F6871',
  /**
   * The helmet blue, promoted from a local const in `robotParts.tsx`.
   *
   * Display luma **0.406**, which puts it in the empty 0.38-0.56 gap between the
   * midground and gameplay bands, and that placement is deliberate rather than
   * lazy. A brighter blue near 0.49 would sit 0.01 from `accentDeep` and the
   * helmet would merge with the copper rear cap in greyscale, which is the F6
   * defect three critique rounds have been fighting. 0.406 buys 0.072 of value
   * separation from the cap plus the maximum available hue distance.
   *
   * The gap is for SURFACES, and a character is not a surface. Section 8's bands
   * are about telling walkable ground from unwalkable ground; the hero is
   * explicitly the value anomaly the composition is built around.
   *
   * Known open note: rendered on the head under the current rig it reads more
   * lavender than cobalt, which is the environment's cool wrap plus the shell
   * preset's clearcoat and sheen desaturating it. The hex is not the problem.
   */
  helmet: '#2F7AD2',
  /** Emissive cyan for the eye lenses and every "this is powered" cue in the world. */
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
  /**
   * The island's cliff face, below the lip.
   *
   * Lighter than it looks like it should be, and that is the whole lesson of
   * the critique rather than an oversight. The band test is a statement about
   * the frame. This surface faces down and outward and receives a small
   * fraction of the steeply overhead key, so an albedo already sitting at the
   * band's value renders far below it: the previous `#452f1c` is 0.197 as a
   * hex and would come out near 0.06 on this facing, which is darker than the
   * pylons the critique named as the worst edge in the picture. 0.414 is what
   * puts the rendered cliff at roughly 0.20 to 0.25.
   *
   * It lived as a local constant in `Terrain.tsx` for one round, with a note
   * asking for exactly this promotion. It carries no `band()` assertion, on
   * purpose: see the note on `VALUE_BANDS.anchor` below.
   */
  soilDeep: '#8a6440',

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
   * **The two gameplay-band surfaces were WARM and are now NEUTRAL, and that
   * reverses a decision this comment used to defend.**
   *
   * What it defended: the reference asks for cool shadows against warm
   * highlights, the build had only the cool half, and putting the warmth on
   * exactly the surfaces the player stands on made the temperature axis and the
   * value axis carry the same message. Every word of that is still right about
   * the GOAL. What was wrong was the mechanism.
   *
   * MEASURED, `hub-character`, high, on a lit deck: `#bfbbb4` is R-B +11 as an
   * albedo and rendered **R-B +23**, so the deck read as tan sandstone. That is
   * not a warm light on a neutral floor, it is a coloured floor, and once the
   * platform became masonry it became the largest single warm area in the frame -
   * with a character wearing saturated orange standing on it.
   *
   * `90-astro-design-system.md` section 2.1 states the rule this violates:
   * **the world's hue belongs in the light, not in the albedo.** Where warmth
   * appears in frame it should be a lit surface rather than a coloured one, and
   * that is why the reference reads as photographed rather than painted.
   *
   * `#BABCBD` is display luma 0.7359 against `#bfbbb4`'s 0.7347 - **1.2
   * thousandths** - so every band assertion and every number in the bible's
   * section 8 table survives untouched and only the hue moves, from R-B +11 to
   * R-B -3. `#94989B` does the same for the side face at 0.5936 against 0.5920.
   *
   * **What is deliberately NOT done in the same change.** The design system pairs
   * this with warming the key softbox and the key directional to put the lost
   * temperature back into the rig. `91-design-critique.md` finding 3 falsifies the
   * two-point fit that number came from - it predicts a neutral-albedo deck at
   * R-B -9.9 and the shipped one measured +23, a 25-point miss - so the rig half
   * waits for a three-point fit. Until then the world is cooler than it was, which
   * is a knowing intermediate state and not the destination.
   *
   * These no longer track `rock`. `rock` still carries the warm neutral, because
   * its other call sites are boulders, portal stone and hardware on the character,
   * and moving those belongs to the palette migration rather than to this change.
   */
  /** Band 1, 0.7359. Deck and puck tops - anything the capsule stands on. */
  bandDeckTop: '#BABCBD',
  /** Band 1, 0.5936. Deck and puck side faces, one step down from their tops. */
  bandDeckSide: '#94989B',
  /** Band 2, 0.330. Kerbs and trim, which draw a raised deck's outline. */
  bandTrim: '#4b5568',
  /** Band 2, 0.272. Pylons, struts and arcs - the frame, never the floor. */
  bandFrame: '#3c465a',
} as const

export type PaletteColor = keyof typeof palette

/**
 * The bands from the art bible's section 8, plus the fourth one that section 8
 * never assigned to anything.
 */
export type ValueBand = 'anchor' | 'gameplay' | 'midground' | 'background'

/**
 * Display-space luma bounds per band, inclusive.
 *
 * Kept beside the colours rather than in a spec document because the only
 * version of this rule that survives is one a test can assert against.
 *
 * ## The anchor band, and why it is measured differently from the other three
 *
 * `docs/design/97-decision-shadow-end.md` is the decision this band comes from
 * and the argument is there rather than here. The short form: the bible named
 * three bands and its darkest floor was 0.20, so nothing in the world was ever
 * asked to be darker than that, and nothing was. Measured on a fresh capture of
 * `hub-establishing` at high, 1.59% of the frame sat below 0.20 and **0.00% of
 * it below 0.10.** What little dark there was turned out to be the shaded sides
 * of the perimeter pylons, two thirds of it in the right-hand third of the
 * frame: the darks were in the shape of a cage rather than of a floor.
 *
 * So the band exists, its membership is a closed list - the island's underside,
 * cast shadow, and recessed apertures - and no repeated vertical object may
 * enter it.
 *
 * ## A band is a range for a DISTRIBUTION, not a target for a value
 *
 * Amended after round 3, and this is the half of the rule that had been missing
 * for three rounds. See `00-art-bible.md` section 8.1.
 *
 * Membership is judged on a surface's mean AND its spread: a surface belongs to
 * a band when its p5 to p95 range fits inside that band, not when some patch of
 * it does. The lawn is why. Round 3 moved its mean to 0.561, technically inside
 * gameplay, and the greyscale test still failed, because its p5 to p95 spans
 * 0.363 to 0.731 - one surface reading as walkable stone, as the gap that is
 * meant to be empty, and as the cliff you cannot climb. Every acceptance row
 * written about the lawn for three rounds asked for a "clean patch", and a clean
 * patch is the wrong statistic for a surface made of two hundred thousand blades
 * whose own root-to-tip ramp is wider than the band it has to occupy.
 *
 * The consequence that matters for these hex values: **a surface may carry
 * albedo pattern of any kind as long as the pattern's own p5 to p95 stays inside
 * the band.** That is roughly plus or minus 0.06 in a band 0.18 wide, which is
 * enough for every mark in the reference vocabulary - panel fills at slightly
 * different tones, perforation grids, chip-trace print, hazard fills.
 *
 * These entries are therefore the CENTRE of a surface's distribution rather than
 * the whole of it, and a generated map is expected to vary around them. Measured
 * on a real frame, a lit deck currently spans 0.039 of luma inside a band 0.18
 * wide, so there is about 0.14 of variation available and unspent.
 *
 * **`band()` refuses this one, and that refusal is the point.** Round 1's
 * verdict was that the value structure had been applied to the palette table
 * rather than to the frame, because `band()` asserts on an albedo hex while the
 * bible's test is about what the eye reads off the screen. That gap is widest
 * exactly here. A surface reaches the anchor band by FACING AWAY from a steeply
 * overhead key, not by having a dark hex: `soilDeep` above is 0.414 as a hex and
 * renders at 0.20 to 0.25, and the 0.197 hex it replaced would have rendered
 * near 0.06. An albedo cannot make this claim, so it is not allowed to. The
 * anchor band is asserted with `__dev.sample()` on a real frame, and the numbers
 * live in the decision document's acceptance table.
 */
export const VALUE_BANDS: Record<ValueBand, readonly [number, number]> = {
  anchor: [0.06, 0.18],
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
export function band(hex: string, of: Exclude<ValueBand, 'anchor'>): string {
  if (!import.meta.env.DEV) return hex
  /*
    Refused rather than checked, and the reason is the whole of round 1's
    verdict. See the note on VALUE_BANDS.anchor: a surface reaches the anchor
    band by facing away from the key, so no hex can claim it and an assertion
    that appeared to check it would be the exact confident nonsense this file
    already warns about in the other direction. The type signature excludes it;
    this catches a caller who has cast around the type.
  */
  if ((of as ValueBand) === 'anchor') {
    throw new Error(
      `palette: band() cannot assert the anchor band. A surface reaches 0.06 to 0.18 by ` +
        `facing away from the key, not by having a dark albedo - soilDeep is 0.414 as a hex ` +
        `and renders at 0.20 to 0.25. Measure it on the frame with __dev.sample(). See ` +
        `docs/design/97-decision-shadow-end.md.`,
    )
  }
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
