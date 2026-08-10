import {
  CanvasTexture,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type ColorSpace,
  type Texture,
} from 'three'
import { linearToSrgb, srgbToLinear } from './materials'
import { mulberry32 } from './placement'

/**
 * Procedural surface detail: the marks injection moulding leaves behind.
 *
 * Extends the pattern `groundTexture.ts` already proves - a canvas drawn at
 * load, seeded so it is identical every session, made seamless by drawing every
 * operation nine times through `drawWrapped`, costing one canvas and no
 * download. Read that file first; this one is the same idea applied to the
 * built environment instead of to the lawn.
 *
 * **Why this exists at all.** Roughness in this project is uniform on every
 * surface except the two photographic sets, and perfectly uniform roughness is
 * the single fastest way to make a moulded object read as an untextured
 * polygon. The reference's fix is low-frequency noise driving roughness by plus
 * or minus 0.08, plus a small vocabulary of manufacturing marks: panel lines,
 * screw heads, vent grilles and directional chevrons. Four marks, and
 * deliberately no more, because a vocabulary that grows past a handful stops
 * reading as a process and starts reading as greeble.
 *
 * **The split, which is the point of the file's shape.** Working out WHERE the
 * marks go is a pure function of a seed and a few dimensions, returns plain
 * data, and is unit tested. Turning that data into pixels needs a canvas, so it
 * is not. Everything above `createDecalMaps` runs under vitest's node
 * environment; everything from there down is the thin rasterising shell.
 *
 * See `docs/design/02-materials.md` sections 4 and 7.
 */

// ---------------------------------------------------------------------------
// The roughness bias, which is the one genuinely fiddly thing here
// ---------------------------------------------------------------------------

/**
 * The roughness a mid-grey texel means, and the number every bias divides by.
 *
 * three computes `roughnessFactor *= texelRoughness.g`, so the map is a
 * MULTIPLIER and 1.0 is neutral. There is no way for a map to push roughness
 * above the material's own value, which makes a signed offset impossible to
 * express directly - and a signed offset is exactly what "vary roughness by
 * plus or minus 0.08" asks for.
 *
 * The fix is to bias the material. Pick a mid green of 0.80, set
 * `material.roughness = target / 0.80`, and the map now has headroom in both
 * directions around its own middle. Getting this wrong makes a whole world
 * uniformly shinier or duller than authored with no other symptom, which is why
 * the conversion lives in one place and every caller takes the divisor from
 * `roughnessBias` rather than typing 0.8 again.
 */
export const ROUGHNESS_MID = 0.8

/** The byte the mid roughness is written as. `round(0.80 * 255)`. */
export const ROUGHNESS_MID_BYTE = 204

/**
 * What a material's `roughness` must be set to when it carries one of these
 * maps, so that a mid-grey texel reproduces the roughness that was authored.
 */
export function roughnessBias(target: number): number {
  return target / ROUGHNESS_MID
}

/**
 * The green byte that encodes `value` on a material biased for `target`.
 *
 * Worked example, straight out of the materials spec, for `plastic()` at target
 * 0.38 with a plus or minus 0.08 swing: the material carries
 * `roughness = 0.475`, the mid writes as 204, 0.30 writes as 161 and 0.46 as
 * 247. So the green channel of these maps lives in the byte range 161 to 247,
 * centred on 204.
 */
export function roughnessByte(value: number, target: number): number {
  if (!(target > 0)) {
    throw new Error(`decalTextures: roughness target must be positive, got ${target}`)
  }
  const raw = Math.round(((value * ROUGHNESS_MID) / target) * 255)
  return Math.max(0, Math.min(255, raw))
}

// ---------------------------------------------------------------------------
// Marks: the pure half
// ---------------------------------------------------------------------------

/**
 * One mark, in TILE COORDINATES: 0 to 1 across the tile in both axes,
 * independent of the resolution it is eventually drawn at.
 *
 * Authoring in tile units rather than in pixels is what makes the layout
 * testable at all. An assertion about where a panel line sits is then a
 * statement about the design, not about a rasteriser, and the same pattern
 * comes out identical at 512 and at 1024.
 *
 * `depth` is a signed displacement of the height mask, whose base is 0.5. A
 * groove is negative, a raised lip or a screw head is positive.
 */
export type Mark =
  | { kind: 'panel'; x1: number; y1: number; x2: number; y2: number; width: number; depth: number }
  | { kind: 'screw'; x: number; y: number; radius: number; depth: number }
  | { kind: 'vent'; x: number; y: number; width: number; height: number; angle: number; depth: number }
  | { kind: 'chevron'; x: number; y: number; size: number; angle: number; depth: number }

/**
 * How much of the tile border is kept clear of marks, as a fraction.
 *
 * Panel lines are not allowed to cross a bevel: a groove that runs off the edge
 * of a moulded face and continues around the fillet reads as a crack rather
 * than as a part line. The tile does not know where the mesh's edges are, so
 * the approximation is to keep the outermost band clear, which puts the
 * fillet-crossing risk on the flat middle of a face where there is nothing to
 * cross.
 */
const BORDER = 0.06

export type PanelLineSpec = {
  /** Distance between lines, in metres. */
  pitch: number
  /** How many metres one tile covers. Converts the pitch into tile units. */
  metresPerTile: number
  /** Groove width in metres. 2.5 mm is the house value. */
  width?: number
  /** Height-mask displacement of the groove. Negative. */
  depth?: number
  seed: number
  /** Fraction of grid runs dropped, so the result reads as parts not as tiling. */
  suppress?: number
}

/**
 * Grooves separating moulded parts, on a grid with runs suppressed at random.
 *
 * The suppression is what stops this reading as graph paper. A complete grid is
 * a texture; a grid with three in ten of its runs missing is a set of parts
 * that happen to have been laid out on a grid, which is what a moulded assembly
 * actually looks like.
 */
export function panelLines({
  pitch,
  metresPerTile,
  width = 0.0025,
  depth = -0.16,
  seed,
  suppress = 0.3,
}: PanelLineSpec): Mark[] {
  if (!(pitch > 0) || !(metresPerTile > 0)) return []

  const step = pitch / metresPerTile
  if (step >= 1) return []

  const random = mulberry32(seed)
  const lineWidth = width / metresPerTile
  const marks: Mark[] = []

  for (let t = step; t < 1 - 1e-9; t += step) {
    /*
      Each run is drawn full width rather than clipped to the border, and the
      border is respected by offsetting the run's position instead. A run that
      stopped short would leave a visible stub end in the middle of a face,
      which is a worse artefact than the one this avoids.
    */
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: 0, y1: t, x2: 1, y2: t, width: lineWidth, depth })
    }
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: t, y1: 0, x2: t, y2: 1, width: lineWidth, depth })
    }
  }

  return marks
}

export type ScrewHeadSpec = {
  /** Heads per square metre of surface. */
  density: number
  metresPerTile: number
  /** Head radius in metres. 4 to 9 mm, as the spec's ejector marks. */
  radius?: number
  depth?: number
  seed: number
}

/**
 * Fastener heads, scattered on a jittered grid.
 *
 * A jittered grid rather than uniform random placement, because uniform random
 * clumps: at these densities pure rejection sampling reliably produces two heads
 * touching somewhere in the tile, and two touching screws read as a mistake
 * rather than as hardware. One per cell with the position jittered inside it
 * gives the same apparent randomness with a guaranteed minimum separation.
 */
export function screwHeads({ density, metresPerTile, radius = 0.006, depth = 0.05, seed }: ScrewHeadSpec): Mark[] {
  if (!(density > 0) || !(metresPerTile > 0)) return []

  const area = metresPerTile * metresPerTile
  const wanted = density * area
  const cells = Math.max(1, Math.round(Math.sqrt(wanted)))
  const random = mulberry32(seed)
  const r = radius / metresPerTile
  const marks: Mark[] = []

  const usable = 1 - 2 * BORDER
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      // Jitter is kept to 60% of a cell so neighbours cannot meet.
      const jx = (random() - 0.5) * 0.6
      const jy = (random() - 0.5) * 0.6
      marks.push({
        kind: 'screw',
        x: BORDER + (usable * (ix + 0.5 + jx)) / cells,
        y: BORDER + (usable * (iy + 0.5 + jy)) / cells,
        radius: r,
        depth,
      })
    }
  }

  return marks
}

export type VentGrilleSpec = {
  /** Centre of the group, in tile units. */
  x: number
  y: number
  /** Number of slots. 5 to 9. */
  slots: number
  /** Slot spacing in metres. 6 mm. */
  pitch?: number
  /** Slot width in metres. 2.5 mm. */
  slotWidth?: number
  /** Slot length in metres. */
  slotLength?: number
  metresPerTile: number
  /** Rotation of the whole group, in radians. */
  angle?: number
  depth?: number
}

/**
 * A slotted vent: the one mark placed by hand rather than tiled, because a vent
 * means something.
 *
 * The reference's rule is that only three placements in this world are earned
 * by the fiction - the robot's back below the cape socket, the lesson totem
 * plinth's collar, and the portal arch's inner face - and a vent anywhere else
 * is decoration pretending to be engineering. So this takes an explicit centre
 * rather than a count.
 */
export function ventGrille({
  x,
  y,
  slots,
  pitch = 0.006,
  slotWidth = 0.0025,
  slotLength = 0.05,
  metresPerTile,
  angle = 0,
  depth = -0.2,
}: VentGrilleSpec): Mark[] {
  if (slots < 1 || !(metresPerTile > 0)) return []

  const step = pitch / metresPerTile
  const width = slotWidth / metresPerTile
  const length = slotLength / metresPerTile
  const marks: Mark[] = []

  const first = -((slots - 1) / 2) * step
  for (let i = 0; i < slots; i++) {
    const offset = first + i * step
    marks.push({
      kind: 'vent',
      x: x + Math.cos(angle) * offset,
      y: y + Math.sin(angle) * offset,
      width,
      height: length,
      angle,
      depth,
    })
  }

  return marks
}

export type ChevronSpec = {
  x: number
  y: number
  count: number
  /** Chevron size in metres. */
  size?: number
  metresPerTile: number
  angle?: number
  depth?: number
}

/**
 * MEASURED, AFTER THE LADDER WAS FINALLY SWITCHED ON: relief alone is invisible
 * on a horizontal surface in this world, and that is geometry rather than tuning.
 *
 * With `surfaceMapSize` at 1024 on high, a deck patch measured p5-p95 of 0.039
 * against 0.0387 with the maps off, and high-frequency detail of 1.36 against
 * 1.37. Zero change, and the crops are indistinguishable.
 *
 * The reason is the key's elevation. Perturbing a normal that already points
 * almost straight at the light barely changes `N.L`, so a 2.4-strength normal map
 * on an up-facing deck under a key 42.7 degrees up produces almost no shading.
 * The roughness break has nothing to break, because `mattePlastic` is roughness
 * 0.75 and carries no specular to modulate. And the occlusion channel is floored
 * at 0.55 and multiplies a surface already lit mostly by ambient.
 *
 * The same maps DO read on vertical faces, where the key arrives at a grazing
 * angle: the kerb faces moved from 16.78 to 17.75 on the same metric in the same
 * frame. So the ladder is worth keeping for the frame and the trim, and it is
 * not what makes a platform read.
 *
 * That is the physical reason the reference art prints value instead of cutting
 * it, and it is why an albedo channel is the whole fix rather than a refinement
 * of this one.
 */

/**
 * A run of directional chevrons.
 *
 * Used only on things that move or that mark a direction, which in this world
 * means the threshold in front of a portal and the lip of a deck the route runs
 * over. A chevron on a static prop is a decal that says nothing, and the
 * reference's restraint rule caps any one object at three of the six marks.
 *
 * Cut as relief rather than printed as albedo. An embossed chevron survives the
 * greyscale readability test, because it produces a highlight and a shadow of
 * its own instead of relying on a value difference that band discipline is
 * separately trying to remove.
 */
export function warningChevrons({
  x,
  y,
  count,
  size = 0.09,
  metresPerTile,
  angle = 0,
  depth = 0.06,
}: ChevronSpec): Mark[] {
  if (count < 1 || !(metresPerTile > 0)) return []

  const s = size / metresPerTile
  const marks: Mark[] = []
  const first = -((count - 1) / 2) * s * 0.8

  for (let i = 0; i < count; i++) {
    const offset = first + i * s * 0.8
    marks.push({
      kind: 'chevron',
      x: x + Math.cos(angle) * offset,
      y: y + Math.sin(angle) * offset,
      size: s,
      angle,
      depth,
    })
  }

  return marks
}

/**
 * The four surface kinds, matching the material presets that carry them.
 *
 * `deck` is the walkable band-1 stone of the Core and the portal stack, `trim`
 * the band-2 kerbs and struts, `hull` the moulded plastic of the toy blocks and
 * the portal door, and `plate` the small hero props read at arm's length.
 */
export type DecalKind = 'deck' | 'trim' | 'hull' | 'plate'

export type KindSpec = {
  /** Physical size of one tile, which is the authoring target from section 4.6. */
  metresPerTile: number
  /** The roughness the material is aiming for, before the map biases it. */
  roughness: number
  /** Half the peak-to-peak roughness variation the map applies. */
  swing: number
  /** Panel line pitch in metres. Zero means no panel lines. */
  panelPitch: number
  /** Screw heads per square metre. Zero means none. */
  screwDensity: number
  /** Normal map strength, in height units per pixel. */
  normalStrength: number
}

/**
 * Per-kind parameters.
 *
 * `plate` gets the smallest swing of the four for the same reason the character
 * does: it is read close up, and breaking a small surface up as hard as a
 * twelve-metre deck makes it look damaged rather than moulded. `deck` gets the
 * largest because it is the biggest continuous area in the game and uniform
 * roughness across it sweeps a single specular band from one side of the island
 * to the other as the camera turns.
 */
export const DECAL_KINDS: Record<DecalKind, KindSpec> = {
  deck: {
    metresPerTile: 2,
    roughness: 0.72,
    swing: 0.14,
    /*
      0.5 rather than 0.6, and it is a tiling fix rather than a taste change.

      `panelLines` walks `t = step, 2*step, ...` while `t < 1`, so a pitch that
      does not divide `metresPerTile` leaves a wider gap at every tile boundary
      than it leaves anywhere inside the tile. At 0.6 m on a 2 m tile the lines
      land at world 0.6, 1.2, 1.8 and then the tile repeats, so the sequence is
      0.6, 0.6, 0.6, 0.8, 0.6, 0.6, 0.6, 0.8 - a periodic irregularity every
      2 m, which is the tiling the suppression pass exists to hide, announcing
      itself on the largest surface in the game.

      0.5 divides 2 exactly, so the grid is uniform across the whole deck. It
      also makes the panel lines share a grid with the printed panel fills
      below, which is the point: a tone step that lands on a groove reads as two
      parts butted together, and a tone step in the middle of a flat face reads
      as paint.

      `hull` at 0.4 on 1 m and `plate` at 0.12 on 0.35 m have the same defect,
      2.5 and 2.9 positions per tile respectively, and are left alone because
      neither has a call site in the files this stream owns.
    */
    panelPitch: 0.5,
    screwDensity: 0,
    normalStrength: 2.4,
  },
  trim: {
    /*
      1.6 m rather than the 1.2 that a 0.6 m kerb face suggests. A tile has to
      hold at least three panel positions or the suppression pass has nothing to
      thin, and a grid of one line either appears in full or vanishes entirely
      depending on the seed - which is exactly the failure this value was
      changed to fix.
    */
    metresPerTile: 1.6,
    roughness: 0.72,
    swing: 0.1,
    panelPitch: 0.4,
    screwDensity: 1.5,
    normalStrength: 2,
  },
  hull: {
    metresPerTile: 1,
    roughness: 0.38,
    swing: 0.08,
    panelPitch: 0.4,
    screwDensity: 4,
    normalStrength: 1.5,
  },
  plate: {
    metresPerTile: 0.35,
    roughness: 0.38,
    swing: 0.055,
    panelPitch: 0.12,
    screwDensity: 12,
    normalStrength: 1.2,
  },
}

/** Every mark for a kind, in draw order: lines first, hardware on top. */
export function decalMarks(kind: DecalKind, seed = 20260809): Mark[] {
  const spec = DECAL_KINDS[kind]
  return [
    ...panelLines({
      pitch: spec.panelPitch,
      metresPerTile: spec.metresPerTile,
      seed,
    }),
    ...screwHeads({
      density: spec.screwDensity,
      metresPerTile: spec.metresPerTile,
      seed: seed + 1,
    }),
  ]
}

// ---------------------------------------------------------------------------
// Height to maps: also pure
// ---------------------------------------------------------------------------

/**
 * Tangent-space normal map from a height mask, as raw RGBA bytes.
 *
 * `strength` is in height units per pixel. The Sobel kernels sum to 4 on their
 * positive lobe, so dividing by 4 makes `strength` mean "a slope of 1.0 in
 * height over one pixel produces a 45 degree normal", which is a scale a human
 * can reason about while tuning.
 *
 * Indexing WRAPS. A tile whose height mask is seamless then produces a normal
 * map that is seamless too; clamping instead puts a visible ridge on every tile
 * boundary, which is the classic way this goes wrong and is invisible until
 * something large is textured with it.
 *
 * Returns bytes rather than `ImageData` so the whole function runs under node.
 * `ImageData` is a DOM class, and putting it in the signature would make the
 * one piece of arithmetic here that is genuinely easy to get wrong the one
 * piece that could not be tested.
 */
export function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`decalTextures: height mask is ${height.length} for a ${size} square tile`)
  }

  const out = new Uint8ClampedArray(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1)
      const t = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const l = at(x - 1, y)
      const r = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const b = at(x, y + 1)
      const br = at(x + 1, y + 1)

      const gx = tr + 2 * r + br - (tl + 2 * l + bl)
      const gy = bl + 2 * b + br - (tl + 2 * t + tr)

      /*
        Both gradients are negated: a surface rising toward +X must tilt its
        normal toward -X. Getting this sign wrong inverts every groove into a
        ridge, and the result looks plausible enough to ship by mistake, which
        is why the flat-mask assertion in the tests is worth its two lines.
      */
      const nx = -gx * strength * 0.25
      const ny = -gy * strength * 0.25
      const inv = 1 / Math.hypot(nx, ny, 1)

      const i = (y * size + x) * 4
      out[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      out[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }

  return out
}

export type OrmOptions = {
  /** The material's authored roughness, before the bias. */
  roughness: number
  /** Half the peak-to-peak roughness swing. */
  swing: number
  /** How hard a groove darkens occlusion. Clamped at the 0.55 floor. */
  occlusion?: number
}

/**
 * The ORM pack: occlusion in red, roughness in green.
 *
 * Not a saving, a convention: three reads occlusion from a texture's red
 * channel and roughness from its green, so one image fills two material slots
 * and the same `Texture` object can be handed to both.
 *
 * Roughness is derived from height by INVERSION, which is the physical claim
 * that a recess collects dust and a proud surface gets wiped. A panel line is
 * therefore simultaneously a groove in the normal, a dust trap in the roughness
 * and a dark line in the occlusion, and it is the agreement between those three
 * that makes it read as a real seam rather than as a drawn one.
 *
 * Occlusion is floored at 0.55. Ambient occlusion that reaches zero reads as
 * dirt rather than as depth, which is the exact failure the reference brief
 * warns about and which this project has already made once elsewhere.
 */
export function ormFromHeight(
  height: Float32Array,
  size: number,
  { roughness, swing, occlusion = 0.9 }: OrmOptions,
): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`decalTextures: height mask is ${height.length} for a ${size} square tile`)
  }

  const out = new Uint8ClampedArray(size * size * 4)

  for (let i = 0; i < height.length; i++) {
    // Height runs 0 to 1 about a base of 0.5, so this is the signed relief.
    const relief = height[i] - 0.5

    const value = roughness - swing * relief * 2
    const shade = relief < 0 ? Math.max(0.55, 1 + relief * 2 * occlusion) : 1

    const p = i * 4
    out[p] = Math.round(shade * 255)
    out[p + 1] = roughnessByte(value, roughness)
    out[p + 2] = 0
    out[p + 3] = 255
  }

  return out
}

// ---------------------------------------------------------------------------
// Printed value: the albedo channel
//
// Everything above this line cuts relief, and the measurement note further up
// records that relief does nothing on a floor in this world. This is the other
// half, and per `00-art-bible.md` section 8.2 it is now allowed: "a surface may
// carry albedo pattern of any kind, provided the pattern's own p5 to p95 stays
// inside the surface's band."
//
// Two rules run through all of it.
//
// **The map can only ever DARKEN, and that is correct here rather than a
// limitation.** The deck material is `mattePlastic('#ffffff', { vertexColors:
// true })` and the band values ride on the vertex colour, so an albedo map
// multiplies them. A byte of 255 is neutral and there is nothing above it. That
// looks like a problem until the numbers are checked: `bandDeckTop` renders at
// 0.687 of display luma against a gameplay ceiling of 0.74, so there is 0.053
// of headroom above and 0.127 below. A two-sided swing of plus or minus 0.06
// would push the light panels to 0.747, OUT of the band and into the deliberate
// 0.74-0.76 gap. One-sided darkening is the only direction the band has room
// for, and it moves the deck's mean off the ceiling it is currently sitting on.
//
// **Colour space, which is the trap this file already warns about from the
// other side.** `byteTexture` tags its output `LinearSRGBColorSpace` and is
// right to: a decode curve applied to gloss values or to normal vectors is "a
// one-word mistake with no error and a look that is merely slightly wrong". An
// albedo map is the exact opposite case and needs `SRGBColorSpace`, because its
// bytes ARE colour and three has to decode them before multiplying. Tagging an
// albedo linear makes every printed tone darker than authored by the gamma
// curve - a 233 byte meant as a 0.06 drop lands as 0.15 - so the two are split
// explicitly below and asserted in the tests.
// ---------------------------------------------------------------------------

/**
 * The display luma a lit deck top actually renders at, MEASURED.
 *
 * Not `palette.bandDeckTop`'s 0.735, which is the authored albedo. The band test
 * is a statement about the frame, so the number every drop below is computed
 * against has to come off a frame:
 *
 *   node tools/critique/frame.mjs spread \
 *     .critique/astro/maps-on--hub-establishing.png 760 620 36 24
 *   -> mean 0.6869, p5-p95 width 0.0003
 *
 * Two neighbouring boxes agree, 700,620 at 0.6847 and 880,600 at 0.6911, and all
 * three have essentially zero spread. That last part is the finding restated as
 * a number: a lit deck is not merely flat, it is 0.0003 flat over an 864-pixel
 * patch, in a band 0.18 wide.
 *
 * The gameplay band runs 0.56 to 0.74, so the headroom is 0.053 up and 0.127
 * down.
 */
export const DECK_LIT_LUMA = 0.687

/**
 * The tone ladder, as DISPLAY-luma drops from the surface's own rendered value.
 *
 * The span is 0.06, which is section 8.2's figure exactly, spent entirely
 * downward for the reason in this section's header.
 *
 * SIX rungs rather than the five it started at, and the sixth is not a taste
 * decision - it is what makes `panelRegions`' central property provable. A
 * rectangular subdivision's adjacency graph is planar, planar graphs are
 * 5-degenerate, and a greedy colouring on a degeneracy ordering therefore needs
 * `degeneracy + 1` colours to be GUARANTEED to succeed. At five rungs it merely
 * usually succeeded: a sweep found a panel with five already-coloured
 * neighbours carrying five distinct tones at 16 cells on one seed in four, and
 * the fallback there puts two same-toned panels against each other, which is
 * the one thing this mark exists to avoid.
 *
 * 0.012 per rung is 4 to 5 bytes at this end of the curve, against the 0.0026
 * that one byte buys, so the smallest possible step between two adjacent panels
 * still survives 8-bit quantisation four times over. The colouring prefers a
 * tone two or more rungs away where one is free, so the typical step is 0.024
 * and 0.012 is the floor rather than the norm.
 */
export const PANEL_TONE_DROPS = [0, 0.012, 0.024, 0.036, 0.048, 0.06] as const

/**
 * The albedo byte that drops a surface rendering at `renderedLuma` by `drop` of
 * DISPLAY luma.
 *
 * This is the whole band-safety argument in one function, and it is worth
 * spelling out because there are three space changes in it and getting any of
 * them wrong produces a plausible-looking world in the wrong band.
 *
 * three multiplies albedo in LINEAR space. The band rule is stated in DISPLAY
 * space. So the wanted drop is applied in display, both ends are decoded to
 * linear, their ratio is the multiplier the map has to supply, and that
 * multiplier is re-encoded to sRGB to become the byte - because the texture is
 * tagged `SRGBColorSpace` and three will decode it again on sample.
 *
 * The consequence worth knowing at a call site: the same byte produces a
 * SMALLER display drop on a darker surface, because the curve is steeper down
 * there. Byte 233 is -0.060 on the deck at 0.687 and -0.033 on a kerb at 0.330.
 * That means one ladder is inherently safe across every band in the world, and
 * it means a ladder sized for the deck under-delivers on band 2 rather than
 * over-delivering, which is the direction to be wrong in.
 */
export function albedoByte(drop: number, renderedLuma: number = DECK_LIT_LUMA): number {
  if (!(renderedLuma > 0) || renderedLuma > 1) {
    throw new Error(`decalTextures: renderedLuma must be in (0, 1], got ${renderedLuma}`)
  }
  const target = renderedLuma - drop
  if (target <= 0) {
    throw new Error(`decalTextures: a drop of ${drop} takes ${renderedLuma} to or below black`)
  }
  const multiplier = srgbToLinear(target) / srgbToLinear(renderedLuma)
  return Math.max(0, Math.min(255, Math.round(255 * linearToSrgb(multiplier))))
}

/**
 * The inverse of `albedoByte`: what a byte actually costs a surface, in display
 * luma.
 *
 * Exists so the tests and the acceptance rows can assert on the QUANTISED
 * result rather than on the ideal one. A byte is 8 bits, so a requested drop of
 * 0.060 is not the drop that ships, and the difference is exactly the kind of
 * thing that turns a band assertion from a check into a formality.
 */
export function albedoDrop(byte: number, renderedLuma: number = DECK_LIT_LUMA): number {
  const multiplier = srgbToLinear(byte / 255)
  return renderedLuma - linearToSrgb(srgbToLinear(renderedLuma) * multiplier)
}

/** The tone ladder as bytes, for a surface rendering at `renderedLuma`. */
export function panelToneBytes(renderedLuma: number = DECK_LIT_LUMA): number[] {
  return PANEL_TONE_DROPS.map((drop) => albedoByte(drop, renderedLuma))
}

/**
 * One printed panel, in CELL coordinates: integer cells from the tile's origin.
 *
 * Cells rather than the 0-to-1 tile units the `Mark` primitives use, and the
 * difference is the point. A `Mark` is a thing drawn at a position; a panel is a
 * REGION, and the property that has to be testable is that the regions tile the
 * plane exactly with no overlap and no gap, which is a statement about integers.
 * Asserting it in floats would be asserting it about a rasteriser.
 */
export type PanelRegion = {
  x: number
  y: number
  w: number
  h: number
  /** Index into the tone ladder. */
  tone: number
  /** Whether this panel carries the printed perforation grid. */
  perforated: boolean
}

export type PanelRegionSpec = {
  /** Grid resolution, in cells across the tile. */
  cells: number
  /** Longest edge of a panel, in cells. */
  maxCells?: number
  /** How many rungs of the tone ladder are in play. */
  tones?: number
  /** Fraction of panels carrying the perforation grid. */
  perforatedShare?: number
  seed?: number
}

/**
 * Tile a grid with rectangular panels, no two neighbours sharing a tone.
 *
 * **This is the mark the reference actually uses and the one the vocabulary was
 * missing.** Its platforms are large flat panels separated by seams, each panel
 * a slightly different tone; `panelLines` above has drawn the seams since the
 * first pass and nothing has ever filled the regions between them. A seam with
 * the same value on both sides is half a mark - it says "there is a line here"
 * where the reference says "these are two parts".
 *
 * Greedy rather than a BSP split, because a guillotine subdivision produces
 * panels that all share long edges and reads as a floor plan. Growing a
 * rectangle from each unclaimed cell in scan order gives L-shaped
 * neighbourhoods and a size distribution with small panels wedged between large
 * ones, which is what a moulded assembly looks like.
 *
 * The no-matching-neighbour rule is the load-bearing part, and it is why this
 * runs in two phases rather than assigning a tone as each rectangle is placed. A
 * tone picked freely puts two identical panels side by side about one time in
 * five, and where that happens the seam between them vanishes and two panels
 * read as one large one with a scratch across it - which is the exact state the
 * deck is in today, with panel lines and no fills.
 *
 * Banning the tones to the left and above, which is what the first version did,
 * is NOT enough and a test caught it. Scan order does not mean left and above
 * are the only decided neighbours: a tall panel from an earlier row sits to the
 * RIGHT of a panel placed later in the row below it, and that pair matched about
 * once per twenty-four-cell grid. So the rectangles are laid out first, the
 * adjacency is read off the finished layout across all four sides including the
 * wrap, and only then is each panel coloured against every neighbour already
 * decided. Same cost, and the property is now a property rather than a hope.
 */
export function panelRegions({
  cells,
  maxCells = 6,
  tones = PANEL_TONE_DROPS.length,
  perforatedShare = 0.12,
  seed = 20260810,
}: PanelRegionSpec): PanelRegion[] {
  if (!(cells > 0) || !Number.isInteger(cells)) {
    throw new Error(`decalTextures: panelRegions needs a whole number of cells, got ${cells}`)
  }
  if (tones < 2) {
    throw new Error(`decalTextures: panelRegions needs at least two tones, got ${tones}`)
  }

  const random = mulberry32(seed)
  /*
    -1 is unclaimed. A typed array rather than a Set of coordinates because "is
    this cell free" is asked a few hundred thousand times over the shipped
    6400-cell grid, and Int32 rather than Int16 because these hold a REGION
    index: 80 cells produce about 900 panels, but a caller passing a finer grid
    would wrap past 32767 and start aliasing panels onto each other with no
    error, which is not a bug worth leaving available to save two bytes a cell.
  */
  const owner = new Int32Array(cells * cells).fill(-1)
  const at = (x: number, y: number) => owner[y * cells + x]
  // Wrapped, because the map's span is finite and anything past it repeats. A
  // seam that breaks the no-matching-neighbour rule is the one place the whole
  // pattern could still fall apart.
  const wrapped = (x: number, y: number) =>
    owner[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]

  // Phase one: geometry only.
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (at(x, y) >= 0) continue

      let w = 1
      const wantW = 1 + Math.floor(random() * maxCells)
      while (w < wantW && x + w < cells && at(x + w, y) < 0) w++

      let h = 1
      const wantH = 1 + Math.floor(random() * maxCells)
      while (h < wantH && y + h < cells) {
        let clear = true
        for (let i = 0; i < w; i++) {
          if (at(x + i, y + h) >= 0) {
            clear = false
            break
          }
        }
        if (!clear) break
        h++
      }

      const index = boxes.length
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) owner[(y + j) * cells + (x + i)] = index
      }
      boxes.push({ x, y, w, h })
    }
  }

  // Phase two: the adjacency graph, read off the finished layout.
  const neighbours = boxes.map(() => new Set<number>())
  boxes.forEach((box, index) => {
    const link = (x: number, y: number) => {
      const other = wrapped(x, y)
      if (other === index) return
      neighbours[index].add(other)
      neighbours[other].add(index)
    }
    for (let j = 0; j < box.h; j++) {
      link(box.x - 1, box.y + j)
      link(box.x + box.w, box.y + j)
    }
    for (let i = 0; i < box.w; i++) {
      link(box.x + i, box.y - 1)
      link(box.x + i, box.y + box.h)
    }
  })

  /*
    Phase three: a degeneracy ordering, which is what turns "no two adjacent
    panels share a tone" from a hope into a guarantee.

    Peel the lowest-degree panel off repeatedly and colour in the REVERSE of the
    peeling order. Every panel then has at most `degeneracy` neighbours already
    coloured when its own turn comes, because the rest of its neighbours were
    peeled before it. A rectangular subdivision is planar and planar graphs are
    5-degenerate, so six tones can never run out - which is the whole reason the
    ladder has six rungs.

    A plain scan-order greedy is what this replaced, and it failed at 16 cells on
    one seed in four. The linear min-degree search is O(panels^2) at about two
    thousand panels for the shipped 80-cell grid, which is four million integer
    comparisons once at load, against a bucket queue that would be three times
    the code for a cost nobody can measure.
  */
  const degree = boxes.map((_, i) => neighbours[i].size)
  const peeled = new Uint8Array(boxes.length)
  const order: number[] = []
  for (let step = 0; step < boxes.length; step++) {
    let best = -1
    for (let i = 0; i < boxes.length; i++) {
      if (peeled[i]) continue
      if (best < 0 || degree[i] < degree[best]) best = i
    }
    peeled[best] = 1
    order.push(best)
    for (const other of neighbours[best]) if (!peeled[other]) degree[other]--
  }

  const colour = new Int32Array(boxes.length).fill(-1)
  for (let i = order.length - 1; i >= 0; i--) {
    const index = order[i]
    const taken: number[] = []
    for (const other of neighbours[index]) if (colour[other] >= 0) taken.push(colour[other])

    const free: number[] = []
    for (let t = 0; t < tones; t++) if (!taken.includes(t)) free.push(t)
    /*
      Prefer a tone at least two rungs from every neighbour. Without this the
      guarantee is satisfied by adjacent panels one rung apart, which is 0.012 of
      display luma and close to invisible next to the 0.039 the lighting already
      puts on the deck. With it the typical step is 0.024 or more and one rung is
      the floor rather than the norm.

      Preferred rather than required, and chosen at random within the preferred
      set rather than maximised: always taking the most distant free tone
      alternates the extremes of the ladder and produces a light-dark
      checkerboard, which reads as a pattern imposed on the deck instead of as
      parts that happen to have come from different mould shots.
    */
    const distant = free.filter((t) => taken.every((u) => Math.abs(t - u) >= 2))
    /*
      The final fallback is unreachable at six tones on a planar graph, for the
      reason above. It is written rather than asserted because an `undefined`
      tone index rasterises as a transparent panel - a hole in the deck, with no
      error - which is precisely the class of failure this codebase keeps paying
      for, and because a future ladder of three rungs would make it reachable
      immediately.
    */
    const pool =
      distant.length > 0 ? distant : free.length > 0 ? free : Array.from({ length: tones }, (_, t) => t)
    colour[index] = pool[Math.floor(random() * pool.length)]
  }

  return boxes.map((box, index) => ({
    ...box,
    tone: colour[index],
    perforated: random() < perforatedShare,
  }))
}

/**
 * How many metres one copy of the panel map covers.
 *
 * 40 rather than something tighter. The plateau is radius 16 and T3's corners
 * sit at 15.52, so 32 would cover every walkable surface - but the map is
 * centred on the world origin and anything beyond the span wraps, and a wrap
 * seam running through the portal deck would put two differently-toned panels
 * against each other with no seam between them. 40 clears the furthest walkable
 * corner by 4.5 m on every side.
 *
 * The cost of the span is texel density, and it is the reason this map cannot
 * also carry the fine marks. At 1024 over 40 m it is 25.6 texels per metre,
 * where the tiling maps get 512 texels per metre at the deck's 2 m tile. A
 * 2.5 mm panel groove is 0.06 of a texel here and simply does not exist. The
 * two scales are separate textures because they have to be.
 */
export const PANEL_FILL_SPAN = 40

/** Panel grid cell, in metres. Matches `DECAL_KINDS.deck.panelPitch`. */
export const PANEL_FILL_CELL = 0.5

export type PanelFillSpec = {
  size: 512 | 1024
  /** How many metres one copy covers. Defaults to `PANEL_FILL_SPAN`. */
  metres?: number
  /** Panel grid cell in metres. Must divide `metres` into whole cells. */
  cell?: number
  /** The UV scale the geometry was box-projected at, so `repeat` can be derived. */
  metresPerTile?: number
  /** The display luma this surface renders at under a white albedo. */
  renderedLuma?: number
  seed?: number
  perforatedShare?: number
  /** Perforation pitch and hole radius, in metres. */
  perforationPitch?: number
  perforationRadius?: number
}

/**
 * The deck's printed panel map: island-scale, non-tiling, one copy over the
 * whole world.
 *
 * **Why this is a separate texture from `createDecalMaps` rather than a fifth
 * channel in it, which is the decision the whole change turns on.**
 *
 * A tiling albedo cannot express this mark. The deck's UVs are box-projected at
 * 2 m per tile, so an albedo in that set repeats every 2 metres: at best three
 * panels, then the same three panels again, six times across a twelve-metre
 * deck. That is the wallpaper failure `HubIsland.tsx` has documented since its
 * first pass, and "large flat panels at slightly different tones" is precisely
 * the mark it destroys. Raising `metresPerTile` to fit larger panels is not
 * available either, because it scales the normal and ORM maps with it and a
 * 2.5 mm groove stops resolving somewhere around 4 m per tile.
 *
 * So the panel fills get their own texture with its own `repeat`, which costs
 * nothing extra at the draw call and is the same trick the file already relies
 * on when it hands one ORM image to two material slots. `repeat` is
 * `metresPerTile / metres`, and `offset` is 0.5 because the map is centred on
 * the world origin: `boxProjectUV` writes `uv = world / metresPerTile`, so
 * without the offset world -20 and world +20 both wrap to the same texel and
 * the island comes out mirrored about its own centre.
 *
 * **The alternative that was seriously considered and rejected, and it is the
 * cheaper one.** Per-piece vertex colour on the merged batch: the deck batch is
 * assembled from discrete pucks, slabs and plinths, so every piece IS a panel
 * already, and tinting each one costs no texture, no sampler, no UV set, and
 * cannot alias. It is also two-sided, since a vertex colour is an absolute value
 * rather than a multiplier against white, so it could go 0.03 brighter as well
 * as darker. It is the better mechanism for panel-to-panel variation and it is
 * recommended in the handoff. It is not what shipped here for one reason: it
 * requires rewriting `deckBatch`'s assembly, and this stream owns the material
 * bindings in `HubIsland.tsx` and not its geometry. The two are complementary
 * rather than exclusive - vertex colour gives one tone per PIECE, this map gives
 * several panels within one twelve-metre slab, and the reference has both.
 */
const panelFillCache = new Map<string, Texture>()

export function createPanelFillMap({
  size,
  metres = PANEL_FILL_SPAN,
  cell = PANEL_FILL_CELL,
  metresPerTile = DECAL_KINDS.deck.metresPerTile,
  renderedLuma = DECK_LIT_LUMA,
  seed = 20260810,
  perforatedShare,
  perforationPitch = 0.25,
  perforationRadius = 0.06,
}: PanelFillSpec): Texture | null {
  if (typeof document === 'undefined') return null

  /*
    Memoised at module scope on everything that changes the image, exactly as
    `createDecalMaps` and `groundTexture.ts` already do. It matters more here
    than there: this is a 1024 canvas plus a degeneracy ordering over nine
    hundred panels, so a component remount that regenerated it would be a
    multi-millisecond main-thread stall for a byte-identical result.
  */
  const key = [size, metres, cell, metresPerTile, renderedLuma, seed, perforatedShare].join(':')
  const cached = panelFillCache.get(key)
  if (cached) return cached

  const cells = Math.round(metres / cell)
  const tones = panelToneBytes(renderedLuma)

  /*
    Perforation at 1024 only, and it is an aliasing limit rather than a budget.

    At 512 over 40 m the map is 12.8 texels per metre, so a 0.25 m hole pitch is
    3.2 texels of period - inside the regime the anisotropy note at the bottom of
    this file is about, and the failure mode is a moire that crawls as the camera
    moves rather than a pattern that reads faintly. The panel fills themselves
    are flat regions tens of texels across and are unaffected, so `medium` gets
    the mark that matters and loses only the one it could not have resolved.
  */
  const perforated = perforatedShare ?? (size >= 1024 ? 0.12 : 0)
  const regions = panelRegions({ cells, perforatedShare: perforated, seed })

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const grey = (byte: number) => `rgb(${byte},${byte},${byte})`
  // Rounded on both edges from the same expression, so the right edge of one
  // panel is the left edge of the next to the pixel. Computing a width instead
  // leaves a one-pixel gap or overlap wherever the rounding disagrees, and at a
  // 12.8-pixel cell that gap is 8% of a panel.
  const px = (c: number) => Math.round((c * size) / cells)

  ctx.fillStyle = grey(tones[0])
  ctx.fillRect(0, 0, size, size)

  for (const region of regions) {
    const x0 = px(region.x)
    const y0 = px(region.y)
    const x1 = px(region.x + region.w)
    const y1 = px(region.y + region.h)

    ctx.fillStyle = grey(tones[region.tone])
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)

    if (!region.perforated) continue

    /*
      The perforation grid, drawn INSIDE the panel and one rung darker than it.

      That containment is what keeps this from being a second mark on the face
      under section 7.7's one-mark-per-face rule: it is not a pattern laid over
      the panels, it is one KIND of panel. A perforated panel's own p5-p95 is one
      ladder step, 0.015 of display luma, so it costs the surface's distribution
      almost nothing and the panel still reads as a single tone from any distance
      at which the holes have stopped resolving.
    */
    const step = (perforationPitch * size) / metres
    let radius = (perforationRadius * size) / metres
    // A sub-texel disc rasterises as a faint grey smear whose value depends on
    // the antialiaser rather than on the ladder, so the hole is floored at a
    // size the canvas can actually draw.
    if (radius < 1.5) radius = 1.5

    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.clip()
    ctx.fillStyle = grey(tones[Math.min(tones.length - 1, region.tone + 1)])
    for (let cy = y0 + step / 2; cy < y1; cy += step) {
      for (let cx = x0 + step / 2; cx < x1; cx += step) {
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /*
    No `drawWrapped` here, and that is a considered omission rather than an
    oversight.

    Every panel is snapped to the cell grid and clipped to the tile, so nothing
    drawn in this function can cross the tile edge; calling the wrapper would run
    nine identical no-ops. The seam is instead handled where it actually lives,
    in `panelRegions`, which excludes column and row zero's tones from the last
    column and row so the no-matching-neighbour rule survives the wrap.
  */
  const texture = wrapTexture(canvas, SRGBColorSpace)
  texture.repeat.set(metresPerTile / metres, metresPerTile / metres)
  // Centred on the world origin. Without this, world -20 and +20 wrap to the
  // same texel and the island is mirrored about its own middle.
  texture.offset.set(0.5, 0.5)
  panelFillCache.set(key, texture)
  return texture
}

// ---------------------------------------------------------------------------
// Rasterisation: the untested shell
// ---------------------------------------------------------------------------

export type DecalMaps = {
  normalMap: Texture
  /** The same ORM image, handed to both slots. Occlusion is red, roughness green. */
  roughnessMap: Texture
  aoMap: Texture
  /**
   * What the material's `roughness` must be set to. See `roughnessBias`: the
   * map multiplies, so the material has to be pre-divided or the whole surface
   * comes out at 80% of the roughness that was authored.
   */
  roughness: number
}

/**
 * Run a drawing operation nine times, offset by one tile in each direction.
 *
 * Lifted wholesale from `groundTexture.ts`, and worth keeping identical rather
 * than shared: anything crossing an edge is also drawn entering the opposite
 * edge, so a groove running off the top continues from the bottom instead of
 * being cut. Far simpler than authoring a pattern to avoid its own edges, and
 * it cannot be got subtly wrong.
 */
function drawWrapped(ctx: CanvasRenderingContext2D, size: number, draw: () => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      ctx.save()
      ctx.translate(dx, dy)
      draw()
      ctx.restore()
    }
  }
}

/** Paint one mark into the height canvas, in pixels. */
function paint(ctx: CanvasRenderingContext2D, mark: Mark, size: number) {
  // 0.5 is the base plane, so a depth of d becomes a grey of 0.5 + d.
  const level = Math.max(0, Math.min(1, 0.5 + mark.depth))
  const shade = `rgb(${Math.round(level * 255)},${Math.round(level * 255)},${Math.round(level * 255)})`

  switch (mark.kind) {
    case 'panel': {
      drawWrapped(ctx, size, () => {
        /*
          The lip first, one pixel wider and raised, then the groove over it.
          A panel line without its lip reads as a scratch: real mould flow
          leaves a slight proud edge on the key side of the split, and that
          bright hairline beside the dark one is most of what the eye uses to
          tell a seam from damage.
        */
        ctx.strokeStyle = 'rgb(140,140,140)'
        ctx.lineWidth = mark.width * size + 2
        ctx.beginPath()
        ctx.moveTo(mark.x1 * size, mark.y1 * size)
        ctx.lineTo(mark.x2 * size, mark.y2 * size)
        ctx.stroke()

        ctx.strokeStyle = shade
        ctx.lineWidth = Math.max(1, mark.width * size)
        ctx.beginPath()
        ctx.moveTo(mark.x1 * size, mark.y1 * size)
        ctx.lineTo(mark.x2 * size, mark.y2 * size)
        ctx.stroke()
      })
      break
    }

    case 'screw': {
      drawWrapped(ctx, size, () => {
        const r = mark.radius * size
        ctx.fillStyle = shade
        ctx.beginPath()
        ctx.arc(mark.x * size, mark.y * size, r, 0, Math.PI * 2)
        ctx.fill()
        // The seat the head sits in, which is what gives it a contact shadow.
        ctx.strokeStyle = 'rgb(96,96,96)'
        ctx.lineWidth = Math.max(1, r * 0.35)
        ctx.beginPath()
        ctx.arc(mark.x * size, mark.y * size, r, 0, Math.PI * 2)
        ctx.stroke()
      })
      break
    }

    case 'vent': {
      drawWrapped(ctx, size, () => {
        ctx.save()
        ctx.translate(mark.x * size, mark.y * size)
        ctx.rotate(mark.angle + Math.PI / 2)
        ctx.fillStyle = shade
        const w = Math.max(1, mark.width * size)
        const h = mark.height * size
        ctx.beginPath()
        ctx.roundRect(-w / 2, -h / 2, w, h, w / 2)
        ctx.fill()
        ctx.restore()
      })
      break
    }

    case 'chevron': {
      drawWrapped(ctx, size, () => {
        ctx.save()
        ctx.translate(mark.x * size, mark.y * size)
        ctx.rotate(mark.angle)
        const s = mark.size * size
        ctx.strokeStyle = shade
        ctx.lineWidth = Math.max(1, s * 0.28)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(-s * 0.3, -s * 0.5)
        ctx.lineTo(s * 0.3, 0)
        ctx.lineTo(-s * 0.3, s * 0.5)
        ctx.stroke()
        ctx.restore()
      })
      break
    }
  }
}

/** Read a drawn canvas back as a height mask in the range 0 to 1. */
function heightFromCanvas(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const pixels = ctx.getImageData(0, 0, size, size).data
  const height = new Float32Array(size * size)
  for (let i = 0; i < height.length; i++) {
    // Rec.709 luminance, though the canvas is drawn in greys so any channel
    // would do. Written out anyway so a coloured mark added later still works.
    height[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255
  }
  return height
}

const cache = new Map<string, DecalMaps>()

/**
 * Build the map set for a kind, or return null where there is no canvas.
 *
 * Null rather than a stub, because `low` must be genuinely zero cost: no canvas
 * work, no extra textures, no extra shader variants. A caller that gets null
 * spreads no maps into its material, which compiles the same program it would
 * have compiled anyway. A stub set of neutral textures would cost two uploads
 * and two extra samplers per material to change nothing.
 *
 * Memoised at module scope on kind and size, exactly as `groundTexture.ts` and
 * `textures.ts` already do. Callers that need their own tiling clone the
 * textures and must set `needsUpdate` afterwards - `clone()` copies the
 * descriptor and leaves that flag false, so the GPU otherwise never receives
 * the new wrap and repeat settings.
 */
export function createDecalMaps(kind: DecalKind, size: 512 | 1024, extra: Mark[] = []): DecalMaps | null {
  if (typeof document === 'undefined') return null

  const key = `${kind}:${size}`
  const cached = cache.get(key)
  if (cached && extra.length === 0) return cached

  const spec = DECAL_KINDS[kind]

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // The base plane. Everything is a displacement from this mid grey.
  ctx.fillStyle = 'rgb(128,128,128)'
  ctx.fillRect(0, 0, size, size)

  for (const mark of [...decalMarks(kind), ...extra]) paint(ctx, mark, size)

  const height = heightFromCanvas(ctx, size)

  // One image in two slots. three samples the same texture twice rather than
  // uploading it twice, which is the whole point of the ORM convention.
  const orm = byteTexture(ormFromHeight(height, size, spec), size)

  const maps: DecalMaps = {
    normalMap: byteTexture(normalFromHeight(height, size, spec.normalStrength), size),
    roughnessMap: orm,
    aoMap: orm,
    roughness: roughnessBias(spec.roughness),
  }

  if (extra.length === 0) cache.set(key, maps)
  return maps
}

/** Wrap raw RGBA bytes as a tiling, linear-space DATA texture. */
function byteTexture(bytes: Uint8ClampedArray, size: number): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  image.data.set(bytes)
  ctx.putImageData(image, 0, 0)

  /*
    Linear, never sRGB. Tagging a roughness or a normal map as sRGB applies a
    decode curve to gloss values and to vectors, and the result is a world that
    reads shinier than authored with its normals bent toward the surface. It is
    a one-word mistake with no error and a look that is merely slightly wrong.

    The albedo map above is the same mistake in the opposite direction and takes
    `SRGBColorSpace`, which is why the choice is now a parameter of the shared
    wrapper rather than a constant buried in the only function that had one.
  */
  return wrapTexture(canvas, LinearSRGBColorSpace)
}

/** Everything a generated tile needs to become a usable tiling texture. */
function wrapTexture(canvas: HTMLCanvasElement, colorSpace: ColorSpace): Texture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = colorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  /*
    Anisotropic filtering, which this function was missing while every other
    generated texture in the project set it.

    It matters here more than anywhere else. These maps go onto the deck batch,
    whose largest member is a twelve-metre disc seen at a grazing angle from a
    camera 4.3 m up - which is the exact condition trilinear filtering handles
    worst. A 0.6 m panel pitch at that angle aliases into a moire that crawls as
    the camera moves, and the effect is far more visible than the panel lines it
    is made of.

    16 is the ceiling on every GPU this runs on, and it is clamped to the device
    maximum by three, so it is safe to ask for flatly rather than plumbing the
    renderer's capability object into a pure texture builder. `textures.ts` reads
    `getMaxAnisotropy()` because it already has the renderer to hand; this file
    does not and should not need it.
  */
  texture.anisotropy = 16
  texture.needsUpdate = true
  return texture
}
