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
  | {
      kind: 'panel'
      x1: number
      y1: number
      x2: number
      y2: number
      width: number
      depth: number
      /**
       * Extra half-width of the raised lip on EACH side of the groove, in tile
       * units. Omit for the legacy behaviour of a one-pixel lip.
       *
       * A one-pixel lip is right for a 2.5 mm groove and wrong for a 20 mm one.
       * `deck` now cuts a groove 8 times the spec width - see `DECAL_KINDS.deck`
       * for why - and a 10-pixel groove with a 1-pixel lip reads as a wide flat
       * trench, which is a gap between parts rather than a moulded seam. The lip
       * has to scale with the groove or the mark changes meaning as it grows.
       *
       * Optional rather than defaulted, so `trim`, `hull` and `plate` keep the
       * exact pixels they were measured with. Their kerb faces are the one
       * surface in the world where the relief ladder was proven to read, moving
       * high-frequency detail from 16.78 to 17.75, and that is not a measurement
       * to spend on a mark nobody asked to change.
       */
      lip?: number
    }
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
  /** Raised-lip half-width on each side of the groove, in metres. */
  lip?: number
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
  lip,
  depth = -0.16,
  seed,
  suppress = 0.3,
}: PanelLineSpec): Mark[] {
  if (!(pitch > 0) || !(metresPerTile > 0)) return []

  const step = pitch / metresPerTile
  if (step >= 1) return []

  const random = mulberry32(seed)
  const lineWidth = width / metresPerTile
  const lipWidth = lip === undefined ? undefined : lip / metresPerTile
  const marks: Mark[] = []

  for (let t = step; t < 1 - 1e-9; t += step) {
    /*
      Each run is drawn full width rather than clipped to the border, and the
      border is respected by offsetting the run's position instead. A run that
      stopped short would leave a visible stub end in the middle of a face,
      which is a worse artefact than the one this avoids.
    */
    // The lip key is spread rather than assigned, so a kind that does not ask
    // for one produces the exact object shape - and therefore the exact pixels -
    // that it produced before this parameter existed.
    const lipKey = lipWidth === undefined ? {} : { lip: lipWidth }
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: 0, y1: t, x2: 1, y2: t, width: lineWidth, depth, ...lipKey })
    }
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: t, y1: 0, x2: t, y2: 1, width: lineWidth, depth, ...lipKey })
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

export type ChipTraceSpec = {
  /**
   * The random source, PASSED IN rather than seeded here, and this is the whole
   * reason the signature looks like this.
   *
   * `groundTexture.ts` drew these traces inline from a `mulberry32(20260805)`
   * stream that it SHARES with the 26-circle mottling pass immediately above
   * them. Lifting the routine and giving it its own seed would have left the
   * ground's own call drawing from a different point in that stream, and the
   * lawn's mottle and traces would both have moved - a change to the largest
   * surface in the frame, arriving as a side effect of a refactor, with no error
   * and nothing in any test to catch it. Taking `rand` keeps the ground's stream
   * position and consumption order byte for byte identical, which
   * `groundTexture.test.ts` now asserts against a reimplementation of the
   * original inline code.
   */
  rand: () => number
  /** How many runs to lay down. */
  count: number
  /** Spacing of the grid the runs turn on, in pixels. */
  grid: number
  /** How many grid steps across the canvas a start position may land on. */
  cells?: number
  /** Segments per run: `min` to `min + span - 1`. */
  segmentsMin?: number
  segmentsSpan?: number
  /** Segment length in grid steps: 1 to `lengthSpan`. */
  lengthSpan?: number
  /** Stroke width in pixels: `min` to `min + span`. */
  widthMin?: number
  widthSpan?: number
  /** Stroke alpha: `min` to `min + span`. */
  alphaMin?: number
  alphaSpan?: number
}

/** One chip-trace run: a path in pixels, plus how to stroke it. */
export type ChipTrace = {
  path: [number, number][]
  width: number
  alpha: number
}

/**
 * Chip-trace runs with a via pad at the end of each: axis-aligned and diagonal
 * segments on a fixed grid.
 *
 * Lifted verbatim out of `createGroundTexture`, where it has been drawing the
 * lawn's circuit motif since the first pass, and made pure so that both callers
 * share it - the lawn at 8 m per tile, and the deck's printed panel map at 40 m
 * across. Section 7.5 of the materials spec already asked for exactly this reuse.
 *
 * What makes these read as a circuit rather than as cracks is the single
 * constraint that every segment runs along one of eight fixed headings and the
 * run terminates in a pad. A crack wanders and ends nowhere; a trace turns at set
 * angles and stops at a pad. The turn is rejected only when it would double back
 * along the segment just drawn, so a run is a route rather than a scribble.
 *
 * Returns data rather than drawing, which is what puts it on the tested side of
 * this file's line and what makes the byte-identity assertion possible at all.
 */
export function chipTracePaths({
  rand,
  count,
  grid,
  cells = 16,
  segmentsMin = 2,
  segmentsSpan = 4,
  lengthSpan = 3,
  widthMin = 2,
  widthSpan = 5,
  alphaMin = 0.1,
  alphaSpan = 0.12,
}: ChipTraceSpec): ChipTrace[] {
  const directions: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]

  const traces: ChipTrace[] = []
  for (let i = 0; i < count; i++) {
    let x = Math.round(rand() * cells) * grid
    let y = Math.round(rand() * cells) * grid
    const segments = segmentsMin + Math.floor(rand() * segmentsSpan)

    const path: [number, number][] = [[x, y]]
    let [dx, dy] = directions[Math.floor(rand() * directions.length)]

    for (let s = 0; s < segments; s++) {
      const length = (1 + Math.floor(rand() * lengthSpan)) * grid
      x += dx * length
      y += dy * length
      path.push([x, y])
      // Turn rather than continue, so a trace is a route and not a line.
      const turn = directions[Math.floor(rand() * directions.length)]
      if (turn[0] !== -dx || turn[1] !== -dy) [dx, dy] = turn
    }

    traces.push({ path, width: widthMin + rand() * widthSpan, alpha: alphaMin + rand() * alphaSpan })
  }

  return traces
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
  /**
   * Groove width in metres. Omit for the spec's 2.5 mm.
   *
   * See `DECAL_KINDS.deck` for the argument that 2.5 mm is a scale error on a
   * twelve-metre platform.
   */
  panelWidth?: number
  /** Raised-lip half-width in metres, each side. Omit for a one-pixel lip. */
  panelLip?: number
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
    /*
      20 mm, against section 7.1's 2.5 mm, and it is the correction of a SCALE
      ERROR rather than a taste change. This is the single biggest lever on the
      user's "make the lines more pronounced".

      2.5 mm is authored in the same paragraph as a 0.12 m pitch on `shell` - a
      handheld toy part, where a 2.5 mm seam is 2% of the pitch. Applying a
      handheld part's seam width to a twelve-metre platform keeps the ratio to
      the tile and throws away the ratio to the eye, and the eye is what the
      user is complaining about.

      MEASURED, and this is the number that decides it: the establishing frame is
      1660 wide and the deck around world origin covers roughly 470 px for 12 m,
      so one screen pixel is about 26 mm of deck. A 2.5 mm groove is ONE TENTH of
      a pixel. It cannot be seen, it cannot survive the mip chain, and it makes no
      difference whether it is cut as relief or printed as value - which is a
      second, simpler explanation for the null result recorded above than the
      `N.L` argument, and one that predicts a different fix. 20 mm is 0.77 of a
      pixel at that distance and 3 px on the near step risers at
      (950, 490), where the deck maps are the channel that actually reads.

      The lip is 6 mm each side, so the whole mark is 32 mm: a dark core with a
      proud edge either side, which is the reference's inset seam rather than a
      scratch.
    */
    panelWidth: 0.02,
    panelLip: 0.006,
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
      width: spec.panelWidth,
      lip: spec.panelLip,
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
 * The display luma a deck SIDE face renders at, MEASURED. The step risers.
 *
 * This surface was missing from the arithmetic entirely, and it is the one the
 * user actually complained about - "the complexity in the shape or the geometry
 * of those steps". The risers are in `deckBatch`, so they carry this same map,
 * and nothing had ever checked what the ladder does to them.
 *
 *   node tools/critique/frame.mjs spread \
 *     .critique/astro/maps-on--hub-establishing.png 950 490 44 26
 *   -> mean 0.3836, p5 0.3758, p95 0.3931, width 0.0173
 *
 * **Three things fall out of that number and all three matter.**
 *
 * It is 0.208 BELOW its authored albedo. `palette.bandDeckSide` is `#9d968d` at
 * a display luma of 0.592 and claims band 1; the face renders at 0.3836. The
 * deck top loses 0.048 the same way, 0.735 authored to 0.687 rendered, so this
 * is not a small consistent offset - a vertical face in this lighting loses four
 * times as much as a horizontal one, and `band()` cannot see it because `band()`
 * asserts on a hex while the test is about the frame.
 *
 * It straddles the midground CEILING. p5 0.3758 is inside midground 0.20-0.38;
 * p95 0.3931 is in the 0.38-0.56 gap that is meant to be empty. Every step riser
 * in the game currently fails band membership by sitting on the boundary, before
 * this file prints anything on it at all.
 *
 * Therefore darkening a riser is a FIX, not a risk, and this is where the brief
 * given to this stream was wrong in the most consequential way. It described
 * this measurement as "a shadowed deck four thousandths above the midground
 * floor" and concluded that "darkening has very little room downward". It is not
 * a shadowed top, it is a side face in ambient; 0.38 is the midground ceiling and
 * not its floor; and the room downward is 0.184, not 0.004. The printed ladder
 * takes the riser to 0.3249 at its darkest, which is cleanly inside midground
 * for the first time.
 */
export const DECK_SIDE_LUMA = 0.3836

/**
 * The tone ladder, as DISPLAY-luma drops from the surface's own rendered value.
 *
 * The panel-to-panel span is 0.070, up from the 0.060 this shipped at, and the
 * ladder no longer starts at zero: it runs 0.016 to 0.086 so that
 * `SEAM_LIP_DROP` has somewhere brighter than every panel to live. The full
 * printed range including the lip and the seam core is 0.0910, and the darkest
 * printed value sits 0.0993 below the surface's own rendered luma.
 *
 * The user asked twice for more, and the honest constraint on how much more is
 * the band ceiling rather than the rule: 8.2 licenses "roughly plus or minus
 * 0.06 in a band 0.18 wide", which is a span of 0.12, and a lit deck rendering
 * at 0.687 in a band that ends at 0.74 can only spend it downward. 0.0993 of the
 * 0.127 available, with the remaining 0.0276 reserved for the concurrent lightmap
 * bake, is the whole of what is available without moving the deck's base value.
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
 * 0.014 per rung is 5 bytes at this end of the curve, against the 0.0026 that one
 * byte buys, so the smallest possible step between two adjacent panels still
 * survives 8-bit quantisation five times over. The colouring prefers a tone two
 * or more rungs away where one is free, so the typical step is 0.028 and 0.014 is
 * the floor rather than the norm.
 */
export const PANEL_TONE_DROPS = [0.016, 0.03, 0.044, 0.058, 0.072, 0.086] as const

/**
 * The bright bevelled lip beside every seam, and the reason the whole ladder
 * moved off zero.
 *
 * **This is the trick that makes a one-sided map produce a two-sided mark.** The
 * reference's seams are not dark lines; they are a dark inset core with a BRIGHT
 * lip either side, and the bright lip is most of what the eye uses to read a
 * seam as a moulded join rather than as a scratch. A map that can only multiply
 * toward black has no brighter-than-white to spend on it - so the panels give up
 * the top of the range instead. Every panel now starts at least 0.016 below the
 * surface's own value, which leaves 0.016 of room ABOVE the lightest panel for
 * the lip to occupy. No new channel, no vertex colour, no second texture.
 *
 * 0.008 rather than 0, and the zero was tempting. A byte of 255 makes the map a
 * no-op on the lip, which keeps the deck's authored value present somewhere in
 * the frame and is easy to reason about. It is rejected for two reasons: the
 * deck's mean is meant to come DOWN off the band ceiling it is sitting on at
 * 0.687 against a 0.74 ceiling, and a genuinely neutral hairline immediately
 * beside the darkest texel on the surface is the shape of a specular blowout
 * rather than of a bevel. 0.008 is three bytes and costs the lip-to-core
 * contrast 0.003 of the 0.0910 it has.
 */
export const SEAM_LIP_DROP = 0.008

/**
 * The seam's own core: the darkest printed value on the deck.
 *
 * 0.100, so the printed span from lip to core is 0.0910 of display luma on a lit
 * deck and the darkest printed value lands 0.0993 below the surface's own, against
 * the 0.0607 the panel fills spent alone and against the 0.000 the relief seams
 * measured. That is the user's "more pronounced" as a number.
 *
 * ## Where the budget went, and what is left
 *
 * MEASURED on `.critique/astro/maps-on--hub-establishing.png`:
 *
 * | surface | box | rendered | with this ladder | band |
 * | --- | --- | --- | --- | --- |
 * | lit deck top | 760,620,36,24 | 0.6869 | 0.5876 to 0.6816 | gameplay 0.56-0.74 |
 * | step riser | 950,490,44,26 | 0.3836 | 0.3249 to 0.3805 | midground 0.20-0.38 |
 *
 * The lit deck keeps 0.0276 of margin above the gameplay floor. That margin is
 * not spare: another stream is baking a lightmap into `lightMap` or `aoMap` on
 * this same material, and a lightmap multiplies albedo exactly as this map does,
 * so the two spans COMPOUND. 0.0276 is what is reserved for it, and a bake that
 * darkens a lit deck by more than that takes the deck's seams out of band. That
 * is a shared budget and somebody has to own the total.
 *
 * ## The ceiling is the real problem, and it is not mine to fix
 *
 * A lit deck renders at 0.6869 in a band that ends at 0.74, so the distribution
 * hangs off the ceiling with 0.053 above it and 0.127 below. The right shape for
 * a surface carrying a printed pattern is to sit at the band's MIDDLE, 0.65, and
 * spend the range in both directions. Every 0.01 the deck's base is raised buys
 * 0.01 more printed span. See the promotion request in the report: this is the
 * highest-value palette change available and it is why the ladder is a function
 * of `renderedLuma` rather than a table of bytes.
 */
export const SEAM_CORE_DROP = 0.1

/**
 * The marks drawn INSIDE a panel, as drops relative to that panel's own tone.
 *
 * Relative rather than absolute, which is the property that keeps the whole
 * vocabulary legal. An absolute value for a perforation hole would be invisible
 * on a dark panel and would punch through the floor of the band on a light one;
 * a relative drop gives every panel the same internal contrast, and because the
 * total is clamped at `SEAM_CORE_DROP` nothing inside a panel can ever be darker
 * than the seams that bound it. The seam stays the darkest thing on the deck,
 * which is what makes the panel layout legible at all.
 *
 * `subPanelBorder` is NEGATIVE: the inner border of a recessed sub-panel is
 * BRIGHTER than the panel around it, for the same reason the seam lip is. It is
 * the second place the re-baselined ladder pays for itself.
 */
export const PANEL_MARK_DROPS = {
  /** Dot and hex perforation holes. */
  perforation: 0.02,
  /** The recessed floor of a sub-panel. */
  subPanelRecess: 0.024,
  /** The proud inner lip around a sub-panel. Negative: brighter. */
  subPanelBorder: -0.012,
  /** The dark half of a hazard stripe fill. */
  hazard: 0.03,
  /** A chip-trace run. */
  trace: 0.022,
  /** A via pad where a trace ends. */
  via: 0.034,
} as const

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
 *
 * **And the stronger version of that, which is why one ladder is not merely safe
 * but correct.** A multiplier delivers a constant CONTRAST RATIO, not a constant
 * luma difference. The seam core at byte 219 is 14.45% below a lit deck top at
 * 0.6869 and 15.30% below a step riser at 0.3836 - the same mark, the same
 * apparent strength, on surfaces 0.30 of luma apart. So the deck batch does not
 * need a per-face ladder, and the objection that a printed mark sized for band 1
 * would vanish on the darker risers is simply not what the arithmetic does.
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
 * How far the warm-cool tilt pushes the red and blue multipliers apart, as a
 * fraction of the linear multiplier.
 *
 * 0.09 puts a full-warm and a full-cool panel at `#f7eee4` and `#e7f0fa` - a
 * 19-byte spread on red and blue - which on the deck's `#bfbbb4` reads as two
 * mould shots from slightly different batches of pigment. Past about 0.14 the
 * panels stop looking like one material and start looking painted, which is the
 * failure mode the reference avoids and cheap sci-fi flooring does not.
 */
export const PANEL_TINT_CHROMA = 0.09

/**
 * The tilts in play, warm positive and cool negative.
 *
 * Five rather than three, and independent of the tone ladder rather than derived
 * from it: two independent axes of variation out of one set of panels is what
 * makes ~900 panels read as a manufactured assembly instead of as a six-value
 * palette applied repeatedly. Two panels that share a tone almost never share a
 * tilt, and two that share a tilt almost never share a tone.
 */
export const PANEL_TINT_TILTS = [-1, -0.5, 0, 0.5, 1] as const

/**
 * The albedo bytes for a panel at `drop` with a warm-cool `tilt` in -1 to 1,
 * chosen so the tilt costs the band NOTHING.
 *
 * **This is the answer to the user's "variation in hues and colors", and the
 * reason it is free rather than expensive.** The value-band rule is a statement
 * about Rec.709 DISPLAY luma, so a colour change that holds display luma fixed is
 * invisible to it. Hue is therefore an entirely unbudgeted axis: the tone ladder
 * has to fight for 0.0993 of the 0.127 available, while the hue variation sitting
 * on top of it costs 0.0007 - a quarter of one byte, and below the 0.0026 that a
 * single byte buys.
 *
 * The arithmetic is a one-dimensional solve rather than a formula, because there
 * is no closed form. The wanted quantity is a linear multiplier triple `m` such
 * that `sum(w_c * linearToSrgb(base * m_c)) == renderedLuma - drop`, where `w` is
 * Rec.709 and `base` is the surface's own rendered value decoded to linear. The
 * transfer function inside the sum is what stops that being invertible, so the
 * chroma direction is fixed and the overall SCALE is bisected. Sixty iterations
 * is far past byte precision and runs once per panel at load.
 *
 * Two approximations, both stated because they are the ones that would make this
 * quietly wrong. The surface is treated as neutral grey at `renderedLuma`, which
 * is the same approximation `albedoByte` already makes and is good to a fraction
 * of a byte on a surface as desaturated as `#bfbbb4`. And a warm tilt is defined
 * as red up, blue down, green fixed - the green channel is left alone on purpose,
 * because green carries 71.52% of the luma and moving it is the expensive way to
 * change hue.
 */
export function panelTintBytes(
  drop: number,
  tilt: number,
  renderedLuma: number = DECK_LIT_LUMA,
  chroma: number = PANEL_TINT_CHROMA,
): [number, number, number] {
  if (!(renderedLuma > 0) || renderedLuma > 1) {
    throw new Error(`decalTextures: renderedLuma must be in (0, 1], got ${renderedLuma}`)
  }
  const target = renderedLuma - drop
  if (target <= 0) {
    throw new Error(`decalTextures: a drop of ${drop} takes ${renderedLuma} to or below black`)
  }

  const base = srgbToLinear(renderedLuma)
  const direction = [1 + tilt * chroma, 1, 1 - tilt * chroma]

  // Bisect the scale. Monotone in `scale`, so this cannot get stuck.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const scale = (lo + hi) / 2
    const luma =
      0.2126 * linearToSrgb(Math.min(1, base * scale * direction[0])) +
      0.7152 * linearToSrgb(Math.min(1, base * scale * direction[1])) +
      0.0722 * linearToSrgb(Math.min(1, base * scale * direction[2]))
    if (luma > target) hi = scale
    else lo = scale
  }

  const scale = (lo + hi) / 2
  const byte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(255 * linearToSrgb(Math.min(1, scale * v)))))
  return [byte(direction[0]), byte(direction[1]), byte(direction[2])]
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
/**
 * What is printed INSIDE one panel. Exactly one of these per panel, never two.
 *
 * **This is the restraint rule re-scoped, and the re-scoping is deliberate.**
 * `02-materials.md` section 7.7 says "at most three of the six marks on any one
 * object, and never more than one mark type per face". Taken literally, the
 * deck's top face is ONE face of 113 square metres and may carry ONE mark - which
 * is the state that produced round 1's finding of "decks with literally zero
 * surface detail" and the user's complaint now. The rule was written for a 0.3 m
 * moulded part, where a face is a single mould facet.
 *
 * So the rule is applied per PANEL instead: a face may carry the seams that
 * define its panels, plus one mark inside each panel, and no panel carries two.
 * That preserves the rule's actual intent - nothing is simultaneously perforated
 * and hazard-striped and trace-printed - at the granularity the surface has. The
 * requested amendment to section 7.7 is in this stream's report; the enum is what
 * enforces it in code either way, because a union type cannot hold two values.
 *
 * `flat` is the majority on purpose. The reference fills SOME panels and not
 * others, and a vocabulary applied to every panel is the greeble the rule exists
 * to prevent.
 */
export type PanelFill = 'flat' | 'dots' | 'hex' | 'hazard' | 'trace' | 'sub'

/**
 * How often each fill appears. Must sum to at most 1; the remainder is `flat`.
 *
 * Sized off the reference: perforation is the commonest mark by a wide margin and
 * appears in two grid forms, chip-trace runs are next, hazard fills are on "a
 * few" panels and are the rarest because they are the loudest, and recessed
 * sub-panels are structural rather than decorative so they stay sparse too.
 */
export const PANEL_FILL_SHARES: Record<Exclude<PanelFill, 'flat'>, number> = {
  dots: 0.14,
  hex: 0.08,
  trace: 0.12,
  sub: 0.08,
  hazard: 0.05,
}

export type PanelRegion = {
  x: number
  y: number
  w: number
  h: number
  /** Index into the tone ladder. */
  tone: number
  /** Index into `PANEL_TINT_TILTS`. The panel's warm-cool bias. */
  tilt: number
  /** The one mark printed inside this panel. */
  fill: PanelFill
}

export type PanelRegionSpec = {
  /** Grid resolution, in cells across the tile. */
  cells: number
  /** Longest edge of a panel, in cells. */
  maxCells?: number
  /** How many rungs of the tone ladder are in play. */
  tones?: number
  /**
   * Overrides for `PANEL_FILL_SHARES`. A share of 0 removes that fill, which is
   * how `medium` drops the two marks it cannot resolve.
   */
  fillShares?: Partial<Record<Exclude<PanelFill, 'flat'>, number>>
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
  fillShares,
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

  /*
    Phase four: the fill and the tilt.

    Drawn from the same stream and after the colouring, so a change to either of
    these cannot move a single panel boundary or tone. That ordering is the reason
    this pass is appended rather than folded into the loop above: the layout and
    the colouring are the two properties with tests asserting real invariants on
    them, and a decorative pass must not be able to perturb them.

    The fill is picked by walking the cumulative shares, which makes an unlisted
    or zeroed fill cost exactly one comparison and lets `medium` remove the two
    marks it cannot resolve without changing the panels underneath.
  */
  const shares = { ...PANEL_FILL_SHARES, ...fillShares }
  const table: [PanelFill, number][] = []
  let cumulative = 0
  for (const kind of ['dots', 'hex', 'trace', 'sub', 'hazard'] as const) {
    cumulative += Math.max(0, shares[kind])
    table.push([kind, cumulative])
  }
  if (cumulative > 1) {
    throw new Error(`decalTextures: panel fill shares sum to ${cumulative.toFixed(3)}, over 1`)
  }

  return boxes.map((box, index) => {
    const roll = random()
    const tilt = Math.floor(random() * PANEL_TINT_TILTS.length)
    let fill: PanelFill = 'flat'
    for (const [kind, limit] of table) {
      if (roll < limit) {
        fill = kind
        break
      }
    }
    /*
      A one-cell panel is 0.5 m and, at the panel map's 25.6 texels per metre,
      13 pixels square. A sub-panel inset inside it would be a 3-pixel rectangle
      with a 1-pixel border, which rasterises as a grey smudge whose value comes
      from the antialiaser rather than from the ladder - the same failure the
      perforation radius floor exists to prevent, and the reason it is caught here
      in the pure half where it can be tested rather than in the canvas.
    */
    if (fill === 'sub' && (box.w < 2 || box.h < 2)) fill = 'flat'
    return { ...box, tone: colour[index], tilt, fill }
  })
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
 * also carry the fine marks. At the shipped 2048 it is 51.2 texels per metre,
 * where the tiling maps get 512 texels per metre at the deck's 2 m tile. A
 * 2.5 mm panel groove is an eighth of a texel here and simply does not exist. The
 * two scales are separate textures because they have to be.
 *
 * The span was NOT reduced to buy density, and that is worth recording since it is
 * the obvious move. 32 would still clear T3's corner at 15.52 - by 0.48 m - and
 * would buy 25% more texels. It is refused because the margin is the whole point:
 * the map wraps at the span, and a wrap seam puts two differently-toned panels
 * against each other with no seam between them. 0.48 m of clearance, on a surface
 * whose bevels are 0.12 m and whose contact decals reach 0.4 m past the geometry,
 * is not a margin but a coincidence. The density came out of the resolution
 * instead. See `panelFillSize`.
 */
export const PANEL_FILL_SPAN = 40

/** Panel grid cell, in metres. Matches `DECAL_KINDS.deck.panelPitch`. */
export const PANEL_FILL_CELL = 0.5

/**
 * The panel map's own resolution, decoupled from `quality.surfaceMapSize`.
 *
 * **This is the one budget increase in the change, and it is the cheapest thing
 * on the list.** MEASURED off the establishing frame: the deck around the origin
 * covers about 470 px for 12 m, so one screen pixel is 26 mm of deck. At 1024
 * over a 40 m span the map has 39 mm texels - COARSER than the screen, so the
 * limit on how much detail this surface can carry is the texture and not the
 * display, and every mark in the reference vocabulary is being drawn below the
 * resolution the player can see. 2048 halves the texel to 20 mm and puts the map
 * just inside the screen.
 *
 * It costs 16 MB of VRAM plus 5 MB of mips, and essentially no CPU: unlike
 * `createDecalMaps`, this function never calls `getImageData` and runs no
 * per-pixel JavaScript at all, so the extra 3 megapixels are canvas fills and one
 * upload rather than four megapixels of array arithmetic. That asymmetry is why
 * the resolution goes up HERE and not on the tiling set.
 *
 * `medium` stays at 512. It is the tier that can least afford both the memory and
 * the upload, and at 78 mm texels it keeps the panel tones - which are tens of
 * texels across - and loses only the marks it could never have resolved.
 */
export function panelFillSize(surfaceMapSize: 0 | 512 | 1024): 0 | 512 | 2048 {
  if (!surfaceMapSize) return 0
  return surfaceMapSize >= 1024 ? 2048 : 512
}

export type PanelFillSpec = {
  size: 512 | 1024 | 2048
  /** How many metres one copy covers. Defaults to `PANEL_FILL_SPAN`. */
  metres?: number
  /** Panel grid cell in metres. Must divide `metres` into whole cells. */
  cell?: number
  /** The UV scale the geometry was box-projected at, so `repeat` can be derived. */
  metresPerTile?: number
  /** The display luma this surface renders at under a white albedo. */
  renderedLuma?: number
  seed?: number
  /** Overrides for `PANEL_FILL_SHARES`. See `panelRegions`. */
  fillShares?: Partial<Record<Exclude<PanelFill, 'flat'>, number>>
  /** Perforation pitch and hole radius, in metres. */
  perforationPitch?: number
  perforationRadius?: number
  /**
   * Seam core width and lip half-width, in metres.
   *
   * 0.06 and 0.03, which at 2048 over 40 m is a 3-pixel core with a 1.5-pixel lip
   * either side. Far wider than the tiling set's 20 mm groove, and they are not
   * the same mark at the same size: this is the INSET between two panels several
   * metres across, where the tiling groove is the part line within one panel. The
   * reference has both, and its inter-panel insets are visibly centimetres wide.
   */
  seamWidth?: number
  seamLip?: number
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
 * **Do these marks belong in a texture at all? Answered properly this time,
 * because the previous pass left it as a recommendation and the answer is split.**
 *
 * Per-piece vertex colour on the merged batch is genuinely better for one of the
 * two things this map does. Every piece of `deckBatch` IS a panel already, tinting
 * each one costs no texture, no sampler and no UV set, it cannot alias, and it is
 * two-sided - a vertex colour is an absolute value rather than a multiplier capped
 * at white, so it can go 0.03 BRIGHTER as well as darker, which is exactly the
 * headroom this file spends three paragraphs working around.
 *
 * So the split is:
 *
 * - **Panel-to-panel TONE should move to vertex colour** when someone owns the
 *   geometry, and this map's ladder should shrink when it does. Two mechanisms
 *   both spending the same 0.127 of band headroom is how a surface ends up out of
 *   band with nobody responsible.
 * - **Every other mark in this file has to be a texture, and it is not close.**
 *   Seams with a bright lip, perforation grids, hazard fills, chip traces and
 *   sub-panel borders are all patterns WITHIN a single piece. A twelve-metre slab
 *   is a handful of vertices; expressing a 60 mm seam on it as vertex colour means
 *   subdividing the slab into roughly forty thousand quads to carry data a 2048
 *   texture carries for 16 MB and no vertex cost. Vertex colour is the right
 *   mechanism for "which part is this" and the wrong one for "what is printed on
 *   it", and the reference clearly has both.
 *
 * The one thing vertex colour would fix that this map cannot: the deck's mean is
 * pinned at its rendered 0.687 ceiling and every printed mark can only go down
 * from there. A vertex colour could raise the base first. That is the palette
 * promotion this stream is asking for.
 */
const panelFillCache = new Map<string, Texture>()

export function createPanelFillMap({
  size,
  metres = PANEL_FILL_SPAN,
  cell = PANEL_FILL_CELL,
  metresPerTile = DECAL_KINDS.deck.metresPerTile,
  renderedLuma = DECK_LIT_LUMA,
  seed = 20260810,
  fillShares,
  perforationPitch = 0.25,
  perforationRadius = 0.06,
  seamWidth = 0.06,
  seamLip = 0.03,
}: PanelFillSpec): Texture | null {
  if (typeof document === 'undefined') return null

  /*
    Memoised at module scope on everything that changes the image, exactly as
    `createDecalMaps` and `groundTexture.ts` already do. It matters more here
    than there: this is a 2048 canvas plus a degeneracy ordering over nine
    hundred panels, so a component remount that regenerated it would be a
    multi-millisecond main-thread stall for a byte-identical result.
  */
  const key = [size, metres, cell, metresPerTile, renderedLuma, seed, JSON.stringify(fillShares ?? null)].join(':')
  const cached = panelFillCache.get(key)
  if (cached) return cached

  const cells = Math.round(metres / cell)
  const perTexel = metres / size

  /*
    Drop the two marks the tier cannot resolve, rather than scaling them down.

    At 512 over 40 m the map is 12.8 texels per metre, so a 0.25 m hole pitch is
    3.2 texels of period - inside the regime the anisotropy note at the bottom of
    this file is about, and the failure mode is a moire that crawls as the camera
    moves rather than a pattern that reads faintly. Hazard stripes at a 0.4 m
    period are the same story at 5 texels. The panel tones, the seams and the
    sub-panels are all tens of texels across and survive, so `medium` keeps the
    marks that carry the read and loses the two that would only shimmer.
  */
  const fine = size >= 1024
  const regions = panelRegions({
    cells,
    seed,
    fillShares: fine ? fillShares : { dots: 0, hex: 0, hazard: 0, ...fillShares },
  })

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const rgb = (b: [number, number, number]) => `rgb(${b[0]},${b[1]},${b[2]})`
  /*
    Every printed value in this function goes through here, and the clamp is what
    makes the whole vocabulary band-safe by construction rather than by review.

    A mark's drop is its panel's tone PLUS the mark's own offset, so contrast
    inside a panel is the same wherever that panel sits on the ladder. The clamp
    at `SEAM_CORE_DROP` is the load-bearing part: no mark inside a panel can ever
    be darker than the seams that bound it, so the seam stays the darkest thing on
    the deck and the panel layout stays the surface's dominant structure. It is
    also what puts a hard floor under the distribution - the darkest byte this
    function can emit is `albedoByte(0.100)`, whatever any caller asks for.
  */
  const tone = (drop: number, tilt: number) =>
    rgb(
      panelTintBytes(
        Math.max(0, Math.min(SEAM_CORE_DROP, drop)),
        PANEL_TINT_TILTS[tilt],
        renderedLuma,
      ),
    )
  // Rounded on both edges from the same expression, so the right edge of one
  // panel is the left edge of the next to the pixel. Computing a width instead
  // leaves a one-pixel gap or overlap wherever the rounding disagrees, and at a
  // 12.8-pixel cell that gap is 8% of a panel.
  const px = (c: number) => Math.round((c * size) / cells)

  ctx.fillStyle = tone(PANEL_TONE_DROPS[0], 2)
  ctx.fillRect(0, 0, size, size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const region of regions) {
    const x0 = px(region.x)
    const y0 = px(region.y)
    const x1 = px(region.x + region.w)
    const y1 = px(region.y + region.h)
    const w = x1 - x0
    const h = y1 - y0
    const base = PANEL_TONE_DROPS[region.tone]
    const ink = (offset: number) => tone(base + offset, region.tilt)

    ctx.fillStyle = ink(0)
    ctx.fillRect(x0, y0, w, h)

    if (region.fill === 'flat') continue

    /*
      Every fill is drawn CLIPPED to its own panel and offset from its own tone.

      The clip is not defensive tidiness, it is what makes a fill "a kind of
      panel" rather than "a pattern laid over the deck". A hazard run that bled
      one pixel past its panel would cross a seam, and a mark that crosses a seam
      says the two parts are one part, which is the exact read the seams exist to
      deny.
    */
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, y0, w, h)
    ctx.clip()

    if (region.fill === 'dots' || region.fill === 'hex') {
      /*
        Perforation, in two grid forms because the reference has both and they do
        not read the same. A square grid reads as a machined vent; a hex grid,
        which is every other row offset by half a pitch, reads as a moulded
        speaker mesh. Alternating them between panels is most of what stops the
        perforated panels reading as one repeated stamp.
      */
      const step = perforationPitch / perTexel
      // A sub-texel disc rasterises as a faint grey smear whose value depends on
      // the antialiaser rather than on the ladder, so the hole is floored at a
      // size the canvas can actually draw.
      const radius = Math.max(1.5, perforationRadius / perTexel)
      ctx.fillStyle = ink(PANEL_MARK_DROPS.perforation)
      let row = 0
      for (let cy = y0 + step / 2; cy < y1 + step; cy += step, row++) {
        const shift = region.fill === 'hex' && row % 2 ? step / 2 : 0
        for (let cx = x0 + step / 2 + shift; cx < x1 + step; cx += step) {
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    } else if (region.fill === 'hazard') {
      /*
        Hazard stripes, and an honest note about what they can and cannot be.

        The reference's hazard fills are yellow against black - a value contrast
        of 0.6 or more, which is three bands wide and flatly illegal here. Inside
        a band 0.18 wide the mark degrades from "warning marking" to "diagonal
        ribbing", and that is what this draws: 0.030 of contrast at 45 degrees on
        a 0.4 m period. It reads as a differently-finished panel rather than as a
        hazard, which is the honest outcome of the band rule and is recorded in
        this stream's report as a request rather than papered over here.
      */
      const period = 0.4 / perTexel
      ctx.strokeStyle = ink(PANEL_MARK_DROPS.hazard)
      ctx.lineWidth = period / 2
      ctx.beginPath()
      // Diagonals every `period` across the panel's own diagonal extent, so the
      // phase is set by the panel and neighbouring hazard panels do not line up.
      for (let d = -h; d < w + h; d += period) {
        ctx.moveTo(x0 + d, y0)
        ctx.lineTo(x0 + d + h, y1)
      }
      ctx.stroke()
    } else if (region.fill === 'trace') {
      /*
        Chip-trace print, from the shared routine `groundTexture.ts` has been
        drawing the lawn with since the first pass. This is the mark the user
        named directly - "those textures look like CPU chips".

        Its own random stream, seeded off the panel's position, so a panel's traces
        are stable across sessions and two trace panels never carry the same run.
        Deliberately NOT the layout stream: this is a decorative pass and must not
        be able to move a panel boundary or a tone.
      */
      const rand = mulberry32(seed + region.x * 73856093 + region.y * 19349663)
      const grid = Math.max(4, 0.25 / perTexel)
      const traces = chipTracePaths({
        rand,
        count: 2 + Math.floor(rand() * 3),
        grid,
        cells: Math.max(1, Math.round(Math.max(w, h) / grid)),
        lengthSpan: 2,
        widthMin: Math.max(1.5, 0.03 / perTexel),
        widthSpan: Math.max(1, 0.03 / perTexel),
        alphaMin: 1,
        alphaSpan: 0,
      })
      for (const run of traces) {
        ctx.strokeStyle = ink(PANEL_MARK_DROPS.trace)
        ctx.lineWidth = run.width
        ctx.beginPath()
        ctx.moveTo(x0 + run.path[0][0], y0 + run.path[0][1])
        for (let p = 1; p < run.path.length; p++) {
          ctx.lineTo(x0 + run.path[p][0], y0 + run.path[p][1])
        }
        ctx.stroke()
        // The via pad where the run ends, which is the detail that says "circuit"
        // rather than "scratch".
        const [ex, ey] = run.path[run.path.length - 1]
        ctx.fillStyle = ink(PANEL_MARK_DROPS.via)
        ctx.beginPath()
        ctx.arc(x0 + ex, y0 + ey, run.width * 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (region.fill === 'sub') {
      /*
        A recessed rectangular sub-panel with its own inner border: a darker
        floor, and a lip around it BRIGHTER than the panel it sits in.

        The bright lip is why the tone ladder gave up its top rung. It is the
        mark that most needs a two-sided swing out of a map that can only darken,
        and it is the reference's most characteristic platform detail after the
        seams themselves - a panel with a shallow tray milled into it.
      */
      const inset = Math.max(2, Math.min(w, h) * 0.22)
      const rx = x0 + inset
      const ry = y0 + inset
      const rw = w - 2 * inset
      const rh = h - 2 * inset
      ctx.fillStyle = ink(PANEL_MARK_DROPS.subPanelRecess)
      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeStyle = ink(PANEL_MARK_DROPS.subPanelBorder)
      ctx.lineWidth = Math.max(1, inset * 0.3)
      ctx.strokeRect(rx, ry, rw, rh)
    }

    ctx.restore()
  }

  /*
    The seams, drawn LAST and over everything, because a seam is the one mark
    that belongs to two panels rather than to one.

    Lip first and wider, core second and narrower on top - the same construction
    `paint` uses for a relief groove, for the same reason. A dark line alone reads
    as a scratch; a dark line with a proud bright edge either side reads as the
    inset between two moulded parts. The lip is the brightest value on the whole
    deck at `SEAM_LIP_DROP`, and the core is the darkest at `SEAM_CORE_DROP`, so
    the seam carries 0.0910 of display luma across about five pixels. It carried
    zero before this: the relief seams in `createDecalMaps` measured p5-p95 0.039
    against 0.0387 with the maps off.

    Every boundary is stroked twice, once from each of the two panels that share
    it, and that is harmless - same colour, same geometry - while being far simpler
    than walking a shared edge list. The stroke is centred on the boundary so the
    inset straddles it evenly.
  */
  const lipBytes = rgb(panelTintBytes(SEAM_LIP_DROP, 0, renderedLuma))
  const coreBytes = rgb(panelTintBytes(SEAM_CORE_DROP, 0, renderedLuma))
  const core = Math.max(1, seamWidth / perTexel)
  const lip = core + (2 * seamLip) / perTexel
  /*
    `drawWrapped` IS needed here, where it was correctly omitted before.

    The old function drew nothing that could cross the tile edge - every panel was
    snapped to the cell grid and clipped to it - and the comment saying so was
    right. A seam stroke centred on a panel's boundary is the first mark in this
    function with width, so half of it hangs outside the rect and the strokes on
    row and column zero now run off the edge. Without the wrap the map loses its
    seams along two of its four edges, which at a 40 m span is a 40 m line across
    the island with no mark on it.
  */
  drawWrapped(ctx, size, () => {
    for (const region of regions) {
      const x0 = px(region.x)
      const y0 = px(region.y)
      const w = px(region.x + region.w) - x0
      const h = px(region.y + region.h) - y0
      ctx.strokeStyle = lipBytes
      ctx.lineWidth = lip
      ctx.strokeRect(x0, y0, w, h)
      ctx.strokeStyle = coreBytes
      ctx.lineWidth = core
      ctx.strokeRect(x0, y0, w, h)
    }
  })

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
  /**
   * The SAME ORM image again, for `clearcoatRoughnessMap`. The A/B this stream
   * could not run, offered as one property.
   *
   * **Why it is worth trying, and it falsifies part of this file's own thesis.**
   * The measurement note above blames the deck's null result on the key's
   * elevation, which explains the NORMAL half. It does not explain the ROUGHNESS
   * half, and that half has its own sufficient explanation: in three,
   * `roughnessMap` multiplies `roughness` and nothing else. `mattePlastic` is
   * roughness 0.75 with a coat at clearcoatRoughness 0.26, so the ORM ladder was
   * breaking up a near-Lambertian lobe with no specular shape to break, while the
   * only lobe on the deck narrow enough to produce a visible highlight stayed at a
   * uniform 0.26 across all 113 square metres. The deck's "single specular band
   * sweeping from one side of the island to the other as the camera turns", which
   * `DECAL_KINDS.deck.swing` was raised to fix, is the COAT's band, and the map
   * raised to fix it cannot see the coat.
   *
   * three reads `clearcoatRoughnessMap` from the green channel, which is where
   * this image already keeps roughness, so the experiment is free: no new canvas,
   * no new texture, no new sampler, one extra material property. The green channel
   * bottoms out at byte 161, taking the coat to 0.164 at its smoothest, and
   * `coatLobeRatioUnderMap` in `materials.ts` confirms the two-lobe rule survives
   * that with a ratio of 20.9 against a minimum of 8.
   *
   * NOT MEASURED - this stream may not drive the browser. Bind it, capture, and
   * revert this one line if the deck's highlight reads worse rather than broken up.
   */
  clearcoatRoughnessMap: Texture
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
        /*
          A one-pixel lip where no lip width was asked for, which is the legacy
          behaviour and is byte-for-byte what `trim`, `hull` and `plate` were
          measured with. Where a width IS given the lip scales with the groove,
          because a 10-pixel trench with a 1-pixel edge is a gap between parts
          rather than a seam in one.
        */
        ctx.lineWidth =
          mark.lip === undefined ? mark.width * size + 2 : (mark.width + 2 * mark.lip) * size
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
    clearcoatRoughnessMap: orm,
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
