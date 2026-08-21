import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type ColorSpace, type Texture } from 'three'
import {
  normalFromHeight,
  ormFromHeight,
  panelTintBytes,
  roughnessBias,
} from './decalTextures'
import { srgbToLinear } from './materials'
import { mulberry32 } from './placement'

/**
 * Moulded brick, for the hub platform and the perimeter pylons.
 *
 * ## Why this is not a fifth `DecalKind`
 *
 * `decalTextures.ts` authors surface detail as MARKS - a line, a screw head, a
 * vent slot - drawn onto a mid-grey canvas and read back as a height mask. That
 * vocabulary is right for a moulded panel, where the detail is a small number of
 * incisions in a flat face, and it is the wrong shape for masonry, where the
 * face is not flat anywhere: every texel belongs to a specific brick, carries
 * that brick's own tone and its own height offset, and is graded by its distance
 * to that brick's arris. There is no mark that says "this is the seventeenth
 * brick and it sits 4 mm proud of its neighbour".
 *
 * So the height mask here is EVALUATED rather than drawn, which has a second
 * consequence worth having: the whole generator runs under node, and every claim
 * about the bond, the joint width and the tone distribution is a unit test
 * rather than a screenshot. `createDecalMaps` needs a canvas to rasterise its
 * marks and therefore returns null under vitest; `brickHeight` and
 * `brickAlbedoBytes` do not.
 *
 * What IS reused is everything downstream of the mask: `normalFromHeight`,
 * `ormFromHeight` and `roughnessBias` are imported rather than reimplemented, so
 * a brick joint becomes a groove in the normal, a dust trap in the roughness and
 * a dark line in the occlusion by exactly the same arithmetic a panel line does.
 * `panelTintBytes` is reused for the albedo for a stronger reason - see
 * `BRICK_TONE_DROPS`.
 *
 * ## The scale argument, which is the one that decides whether any of this reads
 *
 * MEASURED, and quoted from `createPanelFillMap`'s note: the deck covers about
 * 470 px for 12 m in `hub-establishing`, so one screen pixel is about 25.5 mm of
 * deck. Every dimension below is chosen against that number and not against a
 * real building.
 *
 * A domestic brick is 215 x 65 mm with a 10 mm joint. On this deck that is a
 * brick 8.4 x 2.5 px with a joint 0.4 px wide, which is the Nyquist failure this
 * project has now made three times in three different places - the 2.5 mm panel
 * groove, the 1024 panel map over 40 m, and the pylon marker. A joint under two
 * screen pixels does not read as a joint, it reads as noise, and at distance it
 * aliases into a crawling moire.
 *
 * So the brick is 720 x 330 mm with a 60 mm joint, which is 28 x 13 px with a
 * 2.4 px joint, and it is a block rather than a brick. That is also the correct
 * answer for the world rule rather than merely the legible one: this is a
 * manufactured, toy-scaled world, and a moulded stone-shaped object at half a
 * metre reads as a cast block a machine laid, where a domestic brick at 215 mm
 * reads as a photograph of a garden wall.
 *
 * ## The tile has to be square, and that fixes every other number
 *
 * The maps are applied by `boxProjectUV`, which uses ONE scale for both axes, so
 * a tile that is not square puts the bond at two different sizes depending on
 * which way a face happens to point. With a brick pitch of `length + joint` and
 * a course pitch of `height + joint`, squareness needs
 *
 *   columns * (length + joint) == courses * (height + joint)
 *
 * `0.72 + 0.06 = 0.78` and `0.33 + 0.06 = 0.39` are in exactly 2:1, so three
 * columns and six courses both come to **2.34 m**, and the half-brick offset of a
 * running bond is 0.39 m - which is a whole course pitch and therefore tiles in
 * both axes without a seam. An even course count is required for the same
 * reason: the bond's period is two courses, and an odd count would put two
 * offset-zero courses next to each other at every tile boundary.
 *
 * At 1024 the tile is 2.29 mm per texel, so the 60 mm joint is 26 texels and the
 * 22 mm arris is 10. Nothing in the vocabulary is sub-texel.
 */
export type BrickSpec = {
  /** Tile size in metres. Derived, and asserted square by `assertBrickTiles`. */
  metresPerTile: number
  /** Stretcher face length, metres. */
  length: number
  /** Course face height, metres. */
  height: number
  /** Mortar joint width, metres, the same on bed and head joints. */
  joint: number
  /** Bricks across one tile. */
  columns: number
  /** Courses up one tile. Must be even for a running bond to tile. */
  courses: number
  /** How far the mortar sits below the brick face, in height-mask units. */
  jointDepth: number
  /** Chamfer run at each brick edge, metres. */
  arris: number
  /** Half the peak-to-peak per-brick face offset, in height-mask units. */
  faceSwing: number
  /** Peak-to-peak surface grain on a brick face, in height-mask units. */
  grain: number
  /** Peak-to-peak grain on the mortar, which is coarser and shallower. */
  mortarGrain: number
  /** Weathering pocks per square metre of face. */
  pitDensity: number
  /** Pock radius, metres, before jitter. */
  pitRadius: number
  /** Pock depth, in height-mask units. */
  pitDepth: number
  /** The roughness the material aims for before the map biases it. */
  roughness: number
  /** Half the peak-to-peak roughness variation the map applies. */
  swing: number
  /** Normal map strength, in height units per pixel. */
  normalStrength: number
}

export const BRICK: BrickSpec = {
  metresPerTile: 2.34,
  length: 0.72,
  height: 0.33,
  joint: 0.06,
  columns: 3,
  courses: 6,
  /**
   * 0.30 of the mask's range, which is a deep raked joint rather than a flush
   * one.
   *
   * A flush joint on this floor would be invisible for the reason the deck's own
   * relief measurement records: perturbing a normal that already points at a key
   * 42.7 degrees overhead barely moves `N.L`, and a lit deck's p5-p95 moved
   * 0.0387 to 0.039 when the generated maps were switched on. Depth here is not
   * bought for the normal map, it is bought for the OCCLUSION - `ormFromHeight`
   * darkens by `1 + relief * 2 * occlusion` and floors at 0.55, so a relief of
   * -0.30 reaches 0.46 and clamps to the floor, which is the deepest line the
   * pack can carry. On the pylons that occlusion is bound and does the work. On
   * the deck it is not, because the lightmap owns `aoMap` there, and the joint is
   * carried by the albedo instead. See `BRICK_MORTAR_DROP`.
   */
  jointDepth: 0.3,
  arris: 0.022,
  faceSwing: 0.05,
  grain: 0.06,
  mortarGrain: 0.035,
  pitDensity: 22,
  pitRadius: 0.011,
  pitDepth: 0.26,
  /**
   * 0.95, matching `rubber()` rather than `stone()`'s mapped 1.0.
   *
   * `roughnessBias` maps this to the byte the flat parts of the mask produce, and
   * the swing runs either side of it. A target of 1.0 has no headroom above it,
   * so the whole variation would be one-sided and the map could only ever make
   * the surface smoother - which is the wrong direction for a stone.
   */
  roughness: 0.95,
  swing: 0.06,
  /**
   * 2.6, the strongest in the project, against `deck`'s 2 and `plate`'s 1.5.
   *
   * The brief asks for a surface with no reflectivity at all, and taking the
   * gloss away takes with it the only other channel a floor has. Normals plus
   * printed value are what is left, so both are pushed. `masonry()` then
   * multiplies this again by a `normalScale` of 1.8.
   */
  normalStrength: 2.6,
}

/** Brick pitch: one stretcher plus one head joint. */
export function brickPitch(spec: BrickSpec = BRICK): number {
  return spec.length + spec.joint
}

/** Course pitch: one course face plus one bed joint. */
export function coursePitch(spec: BrickSpec = BRICK): number {
  return spec.height + spec.joint
}

/**
 * The three ways this bond can fail to tile, as one throwing check.
 *
 * A throw rather than a test-only assertion because the failure is silent: a
 * tile that is 2.34 by 2.31 still produces a perfectly good-looking texture, and
 * what goes wrong is a hairline discontinuity every 2.34 m across a
 * twelve-metre floor, which is exactly the class of defect this project keeps
 * paying to rediscover in a screenshot.
 */
export function assertBrickTiles(spec: BrickSpec = BRICK): void {
  const across = spec.columns * brickPitch(spec)
  const up = spec.courses * coursePitch(spec)
  if (Math.abs(across - up) > 1e-9) {
    throw new Error(`brickTexture: tile is ${across} by ${up}, and boxProjectUV needs it square`)
  }
  if (Math.abs(across - spec.metresPerTile) > 1e-9) {
    throw new Error(`brickTexture: metresPerTile is ${spec.metresPerTile} against a bond of ${across}`)
  }
  if (spec.courses % 2 !== 0) {
    throw new Error(`brickTexture: a running bond needs an even course count, got ${spec.courses}`)
  }
}

// ---------------------------------------------------------------------------
// The bond: pure, and the part every assertion is written against
// ---------------------------------------------------------------------------

export type BrickCell = {
  /** Course index up the tile, 0 at v = 0. */
  row: number
  /** Brick index across the course, 0 at the course's own offset origin. */
  col: number
  /** Face rect in TILE UNITS, joints already removed. May run outside 0..1. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Every brick face in one tile, in tile units, with the running-bond offset
 * applied and no wrapping.
 *
 * A course carries `columns + 1` entries on its offset rows rather than
 * `columns`, because a half-brick offset pushes one face off each end and the
 * two halves are the same brick seen through the wrap. Emitting both and letting
 * the rasteriser wrap is what keeps the two halves carrying the same tone, which
 * is the whole point: a bond whose wrapped halves disagree puts a visible tone
 * step down one line of the tile, forever.
 */
export function brickLayout(spec: BrickSpec = BRICK): BrickCell[] {
  assertBrickTiles(spec)

  const tile = spec.metresPerTile
  const bp = brickPitch(spec) / tile
  const cp = coursePitch(spec) / tile
  const j = spec.joint / tile

  const cells: BrickCell[] = []
  for (let row = 0; row < spec.courses; row++) {
    const offset = row % 2 === 0 ? 0 : bp / 2
    const start = row % 2 === 0 ? 0 : -1
    for (let col = start; col < spec.columns; col++) {
      cells.push({
        row,
        col,
        x: col * bp + offset + j / 2,
        y: row * cp + j / 2,
        w: bp - j,
        h: cp - j,
      })
    }
  }
  return cells
}

/**
 * Which brick a tile-space point belongs to, and how far it is from the joint.
 *
 * `distance` is in tile units, measured to the nearest face edge: negative
 * inside the joint, zero on the arris line, positive on the face. This is the
 * one function the rasteriser calls per texel, so it does the wrap itself and
 * allocates nothing.
 *
 * `col` is normalised into 0..columns-1 so that the two halves of a wrapped
 * brick resolve to the same index and therefore to the same tone and the same
 * height offset.
 */
export function brickAt(
  u: number,
  v: number,
  spec: BrickSpec = BRICK,
): { row: number; col: number; distance: number } {
  const tile = spec.metresPerTile
  const bp = brickPitch(spec) / tile
  const cp = coursePitch(spec) / tile
  const half = spec.joint / tile / 2

  const vv = ((v % 1) + 1) % 1
  const row = Math.min(spec.courses - 1, Math.floor(vv / cp))
  const offset = row % 2 === 0 ? 0 : bp / 2

  const uu = (((u - offset) % 1) + 1) % 1
  const rawCol = Math.floor(uu / bp)

  const dy = Math.min(vv - row * cp, (row + 1) * cp - vv) - half
  const dx = Math.min(uu - rawCol * bp, (rawCol + 1) * bp - uu) - half

  return {
    row,
    col: ((rawCol % spec.columns) + spec.columns) % spec.columns,
    distance: Math.min(dx, dy),
  }
}

/** Hermite ramp, matching the `smoothstep` every shader in this project uses. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * A seamless value-noise field on the unit tile, at `cells` lattice points per
 * side.
 *
 * Seamless by construction rather than by mirroring: the lattice indices wrap
 * with a modulo, so the field is exactly periodic on the tile and there is no
 * seam to hide. Mirroring would be cheaper to write and would put a visible axis
 * of symmetry through every tile, which on a floor this size is a repeating
 * Rorschach.
 */
export function valueNoise(cells: number, seed: number): (u: number, v: number) => number {
  const random = mulberry32(seed)
  const lattice = new Float32Array(cells * cells)
  for (let i = 0; i < lattice.length; i++) lattice[i] = random()

  const at = (x: number, y: number) => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]

  return (u, v) => {
    const x = u * cells
    const y = v * cells
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smoothstep(0, 1, x - x0)
    const fy = smoothstep(0, 1, y - y0)
    const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
    const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
    return a * (1 - fy) + b * fy
  }
}

/** Weathering pocks, in tile units, seeded so the two maps agree on them. */
export function brickPits(spec: BrickSpec = BRICK, seed = 20260821): { x: number; y: number; r: number }[] {
  const random = mulberry32(seed)
  const count = Math.round(spec.pitDensity * spec.metresPerTile * spec.metresPerTile)
  const pits: { x: number; y: number; r: number }[] = []
  for (let i = 0; i < count; i++) {
    pits.push({
      x: random(),
      y: random(),
      // 0.6 to 1.4 of the nominal radius, so a pock field is not a dot screen.
      r: ((spec.pitRadius * (0.6 + 0.8 * random())) / spec.metresPerTile),
    })
  }
  return pits
}

/**
 * Per-brick face offset, in height-mask units, deterministic in the brick's own
 * coordinates.
 *
 * Deterministic in `(row, col)` rather than drawn from a sequence, because the
 * rasteriser visits texels in scan order and a sequence would give the same
 * brick a different offset on each of its wrapped halves.
 */
export function faceOffset(row: number, col: number, spec: BrickSpec = BRICK, seed = 20260821): number {
  return (brickHash(row, col, seed) * 2 - 1) * spec.faceSwing
}

/**
 * A stable 0-to-1 hash of one brick's coordinates.
 *
 * `mulberry32` is discarded after two draws rather than one, because its first
 * output is a nearly linear function of the seed - adjacent seeds give adjacent
 * values - and the seeds here are adjacent by construction. Using the first draw
 * puts a smooth gradient of tone across the bond instead of a scatter, which is
 * the failure that looks like a lighting bug.
 */
export function brickHash(row: number, col: number, seed: number): number {
  const random = mulberry32((seed + row * 7919 + col * 104729) >>> 0)
  random()
  return random()
}

// ---------------------------------------------------------------------------
// The height mask
// ---------------------------------------------------------------------------

/**
 * The height mask, 0 to 1 about a base of 0.5, in the same convention
 * `normalFromHeight` and `ormFromHeight` already read.
 *
 * Written top-down in scan order, which matches what `heightFromCanvas` produces
 * from a drawn canvas. That is not a detail: the whole point of reusing
 * `normalFromHeight` is that a brick joint and a panel groove come out with the
 * same sign, and a mask built bottom-up would invert the green channel against
 * every other generated normal map in the project.
 */
export function brickHeight(size: number, spec: BrickSpec = BRICK, seed = 20260821): Float32Array {
  assertBrickTiles(spec)

  const height = new Float32Array(size * size)
  const faceMask = new Float32Array(size * size)
  const arrisN = spec.arris / spec.metresPerTile

  const coarse = valueNoise(24, seed + 11)
  const fine = valueNoise(96, seed + 29)
  const mortarNoise = valueNoise(48, seed + 47)

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const cell = brickAt(u, v, spec)

      const g = (coarse(u, v) - 0.5) * 0.62 + (fine(u, v) - 0.5) * 0.38
      const face = 0.5 + 0.08 + faceOffset(cell.row, cell.col, spec, seed) + g * spec.grain
      const mortar = 0.5 - spec.jointDepth + (mortarNoise(u, v) - 0.5) * spec.mortarGrain

      const t = smoothstep(0, arrisN, cell.distance)
      faceMask[y * size + x] = t
      height[y * size + x] = mortar + (face - mortar) * t
    }
  }

  /*
    Pocks last, and masked to the faces.

    A pock is a chip out of a cast block. Unmasked, a 0.26 pock landing in a
    0.30 joint takes the mask NEGATIVE - 0.5 - 0.30 - 0.0175 - 0.26 is -0.078 -
    and a height mask outside 0 to 1 is not merely out of range: `ormFromHeight`
    reads `height - 0.5` as signed relief and would drive the occlusion byte past
    its floor into the clamp, so a handful of texels in the bedding would pin
    black. Found by the range assertion in the tests rather than in a frame,
    which is the whole argument for evaluating this mask rather than drawing it.
  */
  stampPits(height, size, spec, seed, (v, w) => v - spec.pitDepth * w, faceMask)

  return height
}

/** Splat the pock field into a scalar field, wrapping at the tile edges. */
function stampPits(
  field: Float32Array,
  size: number,
  spec: BrickSpec,
  seed: number,
  apply: (value: number, weight: number) => number,
  /** Per-texel gate in 0 to 1. Pocks land on brick faces and never in a joint. */
  mask?: Float32Array,
): void {
  for (const pit of brickPits(spec, seed)) {
    const cx = pit.x * size
    const cy = pit.y * size
    const r = Math.max(1, pit.r * size)
    const lo = Math.ceil(-r)
    const hi = Math.floor(r)
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        const d = Math.hypot(dx, dy) / r
        if (d >= 1) continue
        const px = (((Math.round(cx) + dx) % size) + size) % size
        const py = (((Math.round(cy) + dy) % size) + size) % size
        const i = py * size + px
        const weight = (1 - smoothstep(0, 1, d)) * (mask ? mask[i] : 1)
        if (weight <= 0) continue
        field[i] = apply(field[i], weight)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The albedo, which on a floor is the channel that actually lands
// ---------------------------------------------------------------------------

/**
 * The tone ladder, in display luma dropped from the surface's own rendered
 * value.
 *
 * Sized against the MEASURED deck exactly as `PANEL_TONE_DROPS` is, and against
 * the same headroom: `MASONRY_DECK_LIT_LUMA` is 0.6706 and the gameplay band's
 * floor is 0.56, so there is 0.111 to spend downward and nothing above.
 *
 * The whole budget, written out, because four terms drop the same pixel and the
 * one that matters is their SUM rather than any of them:
 *
 *   term                       range         worst case on a face
 *   tone ladder                0.012-0.082   0.082
 *   grain, either side         +/- 0.016     0.016
 *   weathering pock            0 or 0.036    0.036
 *   -----------------------------------------------------------
 *   total                                    0.134, landing at 0.537
 *
 * So the p100 face is 0.023 under the band floor, and it is reached only where
 * the darkest tone, a grain trough and a pock coincide - pocks cover under half
 * a per cent of the tile. What the band rule is actually judged on is the p5, and
 * MEASURED on a frame with the map bound the deck runs 0.5691 to 0.6285, inside
 * the band on both ends. See `MASONRY_DECK_LIT_LUMA` for that table. This is stated
 * rather than rounded away because `00-art-bible.md` section 8.2 permits albedo
 * pattern "provided the pattern's own p5 to p95 stays inside the surface's
 * band", and the honest reading of that is that the p100 may leave it.
 *
 * Six rather than three, on `createPanelFillMap`'s finding: a small ladder
 * applied to a large number of pieces reads as a palette rather than as
 * variation. There are 18 bricks per tile and about 105 tiles across the deck.
 */
export const BRICK_TONE_DROPS = [0.012, 0.026, 0.04, 0.054, 0.068, 0.082] as const

/**
 * Hue tilts, biased cool.
 *
 * `PANEL_TINT_TILTS` is symmetric, -1 to 1, because a manufactured panel array
 * has no reason to lean either way. The design direction here does: blues,
 * silvers, greys and black, with warm high-contrast accents explicitly out. So
 * the ladder runs -1 to +0.25 - four cool steps to one barely warm one - which
 * keeps the surface from going flat-neutral without ever putting an orange stone
 * in the floor. It costs the value band nothing, because `panelTintBytes` solves
 * for the tilt at constant display luma.
 */
export const BRICK_TINT_TILTS = [-1, -0.7, -0.4, -0.1, 0.25] as const

/**
 * The mortar's drop, and it is doing two jobs rather than one.
 *
 * 0.100 puts the joint at 0.587, and 0.106 with its own grain at its trough,
 * against the band floor of 0.56 - so the deepest line in the masonry is still
 * inside the gameplay band - which is the rule the
 * pylons broke in round 3 and which handoff item 11 is still open on. A raked
 * joint that went to 0.45 would look better in isolation and would put a grid of
 * sub-band lines across the largest surface in the game.
 *
 * The second job is the one that makes it load-bearing. On the pylons the ORM's
 * occlusion channel is bound and the joint reads as depth. On the DECK it is
 * not - `aoMap` there carries the baked lightmap, and `channel` is a property of
 * the texture rather than of the slot, so there is no way to sample the ORM on
 * UV 0 and the lightmap on UV 1 in one material. The deck's joints are therefore
 * entirely printed, and this number is the only thing drawing them.
 */
export const BRICK_MORTAR_DROP = 0.1

/**
 * Extra drop inside a weathering pock, on top of the face tone it lands on.
 *
 * On the FACE only. A pock is a chip out of a cast block; putting one in the
 * mortar would be a hole in the bedding, and it would also be the term that took
 * the joint out of the band - 0.100 plus 0.036 is 0.136 against 0.127 of
 * headroom.
 */
export const BRICK_PIT_DROP = 0.036

/**
 * Half the peak-to-peak tone variation the grain adds within one brick face.
 *
 * Small on purpose. The ladder separates brick from brick and this separates
 * texel from texel within one; at 0.016 it is a mottle rather than a stain, and
 * the two together keep the face's own p5-p95 well inside the headroom the
 * ladder spends. A larger value starts to read as damage.
 */
export const BRICK_GRAIN_DROP = 0.016

/**
 * The albedo bytes for one tile, RGBA, in the same top-down scan order as
 * `brickHeight`.
 *
 * ## Why the tone is quantised before `panelTintBytes` sees it
 *
 * `panelTintBytes` bisects sixty times per call, which is the right cost per
 * PANEL and a wrong one per texel: a 1024 tile would call it a million times.
 * The total drop is therefore snapped to a 0.002 grid and looked up. 0.002 of
 * display luma is below what a byte can express at this level - `albedoByte`'s
 * own note puts one byte at 0.0026 - so the quantisation is invisible by
 * construction rather than by tolerance, and the LUT is at most a few hundred
 * entries.
 *
 * ## Why an albedo map at all, when the relief is already there
 *
 * Because relief does not land on a floor here and printed value does. The
 * measurement is on record in `HubIsland.tsx`: switching the generated normal
 * and roughness maps on moved a lit deck's p5-p95 from 0.0387 to 0.039,
 * essentially nothing, because perturbing a normal that already points at an
 * overhead key barely moves `N.L`. An albedo multiplier has no such dependence.
 * A brick floor with only a normal map is a flat grey floor.
 */
export type BrickAlbedoOptions = {
  spec?: BrickSpec
  seed?: number
  /**
   * The display luma the surface this map goes on actually renders at.
   *
   * `panelTintBytes` solves each drop against this, so a map generated for the
   * deck and hung on a pylon would be printing deck-sized drops onto a surface
   * with a third of the deck's headroom.
   */
  renderedLuma?: number
  /**
   * Every drop scaled by this before it is solved. See `FRAME_DROP_SCALE`.
   *
   * The band a surface has to stay inside is not proportional to its value: the
   * deck sits at 0.687 with 0.127 of headroom to the gameplay floor, and the
   * frame sits near 0.30 with 0.10 to the midground floor. One ladder cannot
   * serve both, and scaling it is cheaper and more legible than a second ladder
   * whose relationship to the first nobody would maintain.
   */
  dropScale?: number
}

export function brickAlbedoBytes(size: number, options: BrickAlbedoOptions = {}): Uint8ClampedArray {
  const { spec = BRICK, seed = 20260821, renderedLuma = MASONRY_DECK_LIT_LUMA, dropScale = 1 } = options
  assertBrickTiles(spec)

  const out = new Uint8ClampedArray(size * size * 4)
  const arrisN = spec.arris / spec.metresPerTile

  const coarse = valueNoise(24, seed + 11)
  const fine = valueNoise(96, seed + 29)

  const lut = new Map<string, [number, number, number]>()
  const bytesFor = (drop: number, tilt: number): [number, number, number] => {
    const snapped = Math.round(Math.max(0, drop) / 0.002) * 0.002
    const key = `${snapped.toFixed(3)}:${tilt}`
    const hit = lut.get(key)
    if (hit) return hit
    const made = panelTintBytes(snapped, tilt, renderedLuma)
    lut.set(key, made)
    return made
  }

  const faceMask = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      faceMask[y * size + x] = smoothstep(0, arrisN, brickAt((x + 0.5) / size, (y + 0.5) / size, spec).distance)
    }
  }

  /*
    The pock field, gated to the faces by the SAME mask `brickHeight` uses, so a
    pock is a dent and a dark spot in the same place. Two channels that disagree
    on where a mark is do not read as a mark at all - they read as dirt beside a
    dent, which is the failure the ORM pack's own note is about from the other
    side.
  */
  const pitWeight = new Float32Array(size * size)
  stampPits(pitWeight, size, spec, seed, (value, weight) => Math.max(value, weight), faceMask)

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const cell = brickAt(u, v, spec)
      const i = y * size + x

      /*
        Tone and tilt are drawn from the brick's own hash rather than from a
        formula in `row` and `col`, and that is the same finding
        `PANEL_TINT_TILTS` records: two independent axes out of one set of
        pieces is what makes a bond read as an assembly instead of as a palette
        applied on a grid. An arithmetic index puts a diagonal stripe of one
        tone through the bond, which on a three-column tile repeats every
        2.34 m across a twelve-metre floor.
      */
      const index = Math.floor(brickHash(cell.row, cell.col, seed + 3) * BRICK_TONE_DROPS.length)
      const tilt = BRICK_TINT_TILTS[Math.floor(brickHash(cell.row, cell.col, seed + 5) * BRICK_TINT_TILTS.length)]

      const g = (coarse(u, v) - 0.5) * 0.62 + (fine(u, v) - 0.5) * 0.38
      const grain = g * 2 * BRICK_GRAIN_DROP

      /*
        The joint is a hard step in the albedo where the height mask ramps it.
        A printed line that fades over the arris reads as a smudge; the arris
        itself is carried by the normal map, and the two channels disagreeing on
        that one boundary is what makes the edge look like a chamfer with a dark
        line at the bottom of it rather than a soft groove.
      */
      const onFace = cell.distance > arrisN * 0.5
      const drop = onFace
        ? BRICK_TONE_DROPS[index] + grain + pitWeight[i] * BRICK_PIT_DROP
        : BRICK_MORTAR_DROP + grain * 0.4

      const [r, gg, b] = bytesFor(drop * dropScale, tilt)
      const p = i * 4
      out[p] = r
      out[p + 1] = gg
      out[p + 2] = b
      out[p + 3] = 255
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Textures: the untested shell, for the same reason `decalTextures.ts` has one
// ---------------------------------------------------------------------------

export type BrickMaps = {
  normalMap: Texture
  /** The ORM pack. Occlusion in red, roughness in green, one image in two slots. */
  roughnessMap: Texture
  aoMap: Texture
  /** sRGB. Multiplies the vertex colour that carries the value band. */
  map: Texture
  /** The byte the flat parts of the mask produce, for the material's `roughness`. */
  roughness: number
}

/**
 * The relief half of the map set, which is shared between every surface.
 *
 * Keyed WITHOUT `renderedLuma`, and that split is the point of having two
 * caches. The normal map and the ORM pack describe the SHAPE of the bond, which
 * is the same bond on the deck and on the pylons; only the printed value has to
 * know what it is being printed onto. Sharing them saves two 1024 uploads per
 * extra surface, which is 8 MB of VRAM for a byte-identical image.
 */
const reliefCache = new Map<string, { normalMap: Texture; orm: Texture; roughness: number }>()
const albedoCache = new Map<string, Texture>()

/**
 * The deck's own measured display luma under `masonry()`, WITHOUT this map.
 *
 * **Not `DECK_LIT_LUMA`, and shipping against `DECK_LIT_LUMA` was a bug.** That
 * constant is 0.687 and it was measured on a deck wearing `mattePlastic` - a
 * preset with `clearcoat: 0.4` over it. `masonry()` deletes the coat and cuts
 * `specularIntensity` to 0.25, which is the whole point of it, and a surface that
 * has lost its specular renders darker. So every drop on the deck was being
 * solved against a surface 0.016 brighter than the one it lands on, and the
 * ladder came out slightly too deep everywhere.
 *
 * MEASURED with `?nobrickmap`, `hub-character`, high, buffer 1512x823, a clean
 * lit deck patch at 880,640,120,60:
 *
 *   map      mean     p5       p95      p5-p95
 *   off      0.6706   0.6537   0.6850   0.0313
 *   on       0.6000   0.5691   0.6285   0.0594
 *
 * Both axes, because `00-art-bible.md` section 8.1 judges band membership on the
 * spread and handoff item 11 is a standing rebuke about quoting one of two.
 *
 * The second row is the result rather than the input: with the map on, the deck's
 * p5 to p95 is 0.5691 to 0.6285, inside the 0.56 to 0.74 gameplay band, and the
 * spread has gone from 0.0313 to 0.0594 - which is the deck ceasing to be the
 * 0.0003-flat surface three critique rounds complained about.
 */
export const MASONRY_DECK_LIT_LUMA = 0.6706

/**
 * The pylons' measured display luma under `masonry()`, WITHOUT this map.
 *
 * **0.3553, and the 0.30 this shipped with was a bug that a green test did not
 * catch.** 0.30 came from `HubIsland.tsx`'s dress-batch note - three pylon shafts
 * at 0.294, 0.241 and 0.360 measured on a PRE-BRICK frame wearing a different
 * material. `brickTexture.test.ts` then asserted that no pylon texel leaves the
 * midground band, computed against that same 0.30, so the test agreed with the
 * constant and neither agreed with the frame.
 *
 * That is this project's signature failure written one more time: a test that
 * checks its own input.
 *
 * MEASURED with `?nobrickmap`, `hub-character`, high, buffer 1512x823, a clean
 * pylon shaft at 716,110,28,110:
 *
 *   map      mean     p5       p95      p5-p95   min
 *   off      0.3553   0.2710   0.4049   0.1339   0.1424
 *   on       0.2917   0.1959   0.3856   0.1897   0.1004
 *
 * **So the map took the pylon's 5th percentile from 0.2710 to 0.1959, which is
 * 0.004 below the midground floor.** `97-decision-shadow-end.md` closes that floor
 * to repeated verticals in as many words, so the brick reopened handoff item 11 in
 * the same commit as the test that forbids it. Two things follow, and only the
 * first is this file's to fix: the ladder was solved against a base 0.055 too dark
 * and therefore over-darkened, and the pylon's own unmapped minimum is already
 * 0.1424, so the surface was carrying anchor-band pixels before any brick touched
 * it.
 */
export const FRAME_LIT_LUMA = 0.3553

/**
 * How far the deck's ladder is compressed for the frame.
 *
 * **0.55, down from the 0.70 this shipped with, and the 0.70 was derived from
 * headroom while 0.55 is derived from a frame.** That is the difference that
 * matters here, and the first method is what let the defect through.
 *
 * The headroom argument said: the deck has 0.127 between 0.687 and the gameplay
 * floor, the frame has 0.10 between 0.30 and the midground floor of 0.20, so
 * compress by roughly their ratio. Every term in it was either stale or the wrong
 * quantity. The frame does not sit at 0.30, it sits at 0.3553. And a cylinder does
 * not sit at ONE value at all: it presents every facing at once, so what has to
 * clear the floor is its 5th percentile and not its mean.
 *
 * Sized against the measurement instead. Unmapped, the pylon's p5 is 0.2710; at
 * scale 0.70 the map took it to 0.1959, a drop of 0.0751 where 0.0610 is what
 * fits above a 0.21 target. `0.70 * 0.0610 / 0.0751 = 0.568`, and 0.55 is that
 * with a little in hand, because correcting `FRAME_LIT_LUMA` upward weakens the
 * map as well and the two corrections compound in the same direction.
 *
 * Eight pylons in the anchor band is the exact failure handoff item 11 is still
 * open on, and a texture turned out to be a cheap way to reintroduce it.
 */
/**
 * The two percentiles the map has to survive, MEASURED on a frame with the map
 * unbound, and the reason they are exported rather than kept in a comment.
 *
 * `FRAME_LIT_LUMA` and `MASONRY_DECK_LIT_LUMA` are INPUTS to the generator: they
 * are what each drop is solved against. A test written against them is a test
 * that checks its own input, which is precisely how the pylon defect shipped
 * green. These two are OUTPUTS of a different experiment - a capture with
 * `?nobrickmap` - so a test that applies the generated map to these and asserts
 * the result is in band is testing the map against the world.
 *
 * The percentile rather than the mean or the minimum, because that is what
 * `00-art-bible.md` section 8.1 judges band membership on, and because a cylinder
 * presents every facing at once and has no single value to test.
 *
 * Both come from `hub-character`, high, buffer 1512x823: the deck patch at
 * 880,640,120,60 and the pylon shaft at 716,110,28,110. Re-measure both if the
 * light rig moves, and they are stale the moment it does.
 */
export const MEASURED_UNMAPPED_P5 = {
  deck: 0.6537,
  frame: 0.271,
} as const

/**
 * The same two boxes with the map BOUND, so the model can be checked against the
 * frame rather than merely used.
 *
 * `brickTexture.test.ts` predicts each of these by carrying the map's own 5th
 * percentile multiplier onto the unmapped 5th percentile above, and requires the
 * prediction to land within 0.02 of what was measured. That is what makes the
 * band assertions trustworthy: a model nobody has checked against a frame is the
 * same kind of object as the stale constant it replaced.
 */
export const MEASURED_MAPPED_P5 = {
  deck: 0.5691,
  frame: 0.1959,
} as const

/**
 * The map's own Nth-percentile multiplier, as a LINEAR ratio.
 *
 * Linear rather than display, and a percentile rather than a minimum, and both
 * choices are the difference between a usable model and the two wrong ones.
 *
 * An albedo map is a multiplier in linear light, so the absolute display drop it
 * produces depends on the base it lands on - which is exactly why quoting a drop
 * without its base is what let `FRAME_LIT_LUMA` go stale unnoticed. And the
 * minimum convolves the map's darkest texel with the surface's darkest pixel,
 * two independent tails, which predicts a value that does not occur: on the deck
 * it forecasts 0.522 against a measured 0.5691.
 */
export function mapQuantile(bytes: Uint8ClampedArray, t: number): number {
  const ratios: number[] = []
  for (let i = 0; i < bytes.length; i += 4) {
    /*
      The Rec.709 mix of the three channel multipliers, not the minimum of them.

      The minimum was the first draft and it was 0.029 pessimistic on the deck -
      it predicted 0.5404 against a measured 0.5691 - for a reason that is
      `panelTintBytes`'s whole design: the hue tilt deliberately pushes one
      channel down and another up at CONSTANT luma, so the darkest channel of a
      tinted texel says nothing about how dark the texel reads. Taking the minimum
      charges the band for the hue, which is the one axis section 2 of
      `90-astro-design-system.md` establishes is free.

      This treats the surface underneath as neutral grey, which is the same
      approximation `panelTintBytes` makes and states, and is good to a fraction
      of a byte on a substrate this desaturated.
    */
    ratios.push(
      0.2126 * srgbToLinear(bytes[i] / 255) +
        0.7152 * srgbToLinear(bytes[i + 1] / 255) +
        0.0722 * srgbToLinear(bytes[i + 2] / 255),
    )
  }
  ratios.sort((a, b) => a - b)
  return ratios[Math.floor((ratios.length - 1) * t)]
}

/**
 * The deck's ladder, compressed to buy margin against a conservative model.
 *
 * 0.85, and it is worth being clear that the FRAME does not require it: with the
 * ladder at full strength the deck measured p5 0.5691 against a gameplay floor of
 * 0.56, which is inside the band. What requires it is that the model policing that
 * band in `brickTexture.test.ts` predicts 0.5532 for the same configuration - it
 * is 0.016 pessimistic, because it carries the map's 5th percentile onto the
 * lighting's 5th percentile and those two tails do not in fact coincide.
 *
 * So there are two ways to make the test agree with the frame, and only one of
 * them is honest. Correcting the model by its own measured bias would be fitting
 * the ruler to the thing it measures. Leaving 0.007 of margin under a predictor
 * known to be conservative is spending a little of the deck's variation to buy
 * room the next lighting change will need anyway.
 *
 * The cost is real and small: the deck's p5-p95 goes from 0.0594 toward 0.050,
 * against the 0.0003 it measured before there was any brick on it at all.
 */
export const DECK_DROP_SCALE = 0.85

export const FRAME_DROP_SCALE = 0.55

export type BrickMapOptions = {
  spec?: BrickSpec
  seed?: number
  renderedLuma?: number
  dropScale?: number
}

/**
 * Build the brick map set, or return null where there is no canvas.
 *
 * Null rather than a stub, on `createDecalMaps`'s argument: a caller that gets
 * null spreads nothing into its material and compiles the program it would have
 * compiled anyway, where a neutral stub costs three uploads and three samplers
 * to change nothing.
 *
 * The bytes are generated by the pure functions above and only WRAPPED here, so
 * what runs in the browser is the same arithmetic the tests assert on. The
 * canvas round trip exists because `CanvasTexture` uploads flipped and
 * `DataTexture` does not, and every other generated map in this project is a
 * `CanvasTexture` - a normal map that disagreed with them on the green channel's
 * sign would light every brick from the wrong side and look merely slightly off.
 */
export function createBrickMaps(size: 512 | 1024, options: BrickMapOptions = {}): BrickMaps | null {
  if (typeof document === 'undefined') return null

  const { spec = BRICK, seed = 20260821, renderedLuma = MASONRY_DECK_LIT_LUMA, dropScale = 1 } = options

  const reliefKey = `${size}:${seed}:${spec.metresPerTile}:${spec.length}:${spec.height}:${spec.joint}`
  let relief = reliefCache.get(reliefKey)
  if (!relief) {
    const height = brickHeight(size, spec, seed)
    relief = {
      normalMap: wrapBytes(normalFromHeight(height, size, spec.normalStrength), size, LinearSRGBColorSpace),
      orm: wrapBytes(ormFromHeight(height, size, spec), size, LinearSRGBColorSpace),
      roughness: roughnessBias(spec.roughness),
    }
    reliefCache.set(reliefKey, relief)
  }

  const albedoKey = `${reliefKey}:${renderedLuma}:${dropScale}`
  let map = albedoCache.get(albedoKey)
  if (!map) {
    map = wrapBytes(brickAlbedoBytes(size, { spec, seed, renderedLuma, dropScale }), size, SRGBColorSpace)
    albedoCache.set(albedoKey, map)
  }

  return {
    normalMap: relief.normalMap,
    roughnessMap: relief.orm,
    aoMap: relief.orm,
    map,
    roughness: relief.roughness,
  }
}

/** Raw RGBA bytes as a tiling texture, matching `decalTextures.ts`'s wrapper. */
function wrapBytes(bytes: Uint8ClampedArray, size: number, colorSpace: ColorSpace): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  image.data.set(bytes)
  ctx.putImageData(image, 0, 0)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = colorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // 16 is the ceiling everywhere this runs and three clamps it to the device
  // maximum. The deck is the grazing-angle worst case that makes it necessary.
  texture.anisotropy = 16
  texture.needsUpdate = true
  return texture
}
