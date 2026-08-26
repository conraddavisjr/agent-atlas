import {
  CanvasTexture,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type ColorSpace,
  type Texture,
} from 'three'
import { normalFromHeight, ormFromHeight, roughnessBias } from './decalTextures'
import { valueNoise } from './brickTexture'

/**
 * Sawn timber, generated, for the quiz planks.
 *
 * ## Board grain, not end grain, and that is the whole look
 *
 * The obvious way to texture a wooden disc is concentric rings - it is a circle,
 * and a log's cross section is rings. It is also wrong for this object and it
 * looks it: rings say "this was cut ACROSS a log", which makes the disc a slice
 * of trunk with a pith at its middle and reads as a bullseye target the moment
 * three of them are stacked up in a quiz.
 *
 * The brief said planks. A disc cut out of a plank keeps the plank's grain:
 * near-parallel lines running one way, bending into the long arcs a sawyer calls
 * cathedral figure where the blade crossed a growth ring at a shallow angle. That
 * is what this generates, and it is why the field is built in `x` with a wobble
 * driven by `y` rather than radially about a centre.
 *
 * ## It is a MULTIPLIER, not a colour
 *
 * Every byte here is a ratio applied to the material's own `color`, the same
 * contract `brickAlbedoBytes` documents at length - a photographic wood sample
 * dropped next to flat-shaded plastic reads as an asset from a different game,
 * whereas the same figure multiplied by a colour the palette already owns reads
 * as detail on a surface that was already there.
 *
 * It differs from the brick in one deliberate way: the brick's ladder is authored
 * against a MEASURED rendered luma, because the deck and the pylons are load
 * bearing in the world's value bands and a mark that lands in the wrong band
 * breaks `97-decision-shadow-end.md`'s rule about repeated verticals. These are
 * three props 6 m from the camera in a mini-game that has no value bands, so this
 * is an honest ratio field around 1.0 rather than a ladder pretending to a
 * measurement nobody took.
 */

export type WoodSpec = {
  /** Grain lines across the tile. 9 puts a line every 7 cm on a 0.62 m disc. */
  lines: number
  /**
   * How far the grain wanders across the tile, in tile widths.
   *
   * This is the cathedral figure. At 0 the boards are quartersawn and the grain
   * is dead straight, which reads as corduroy rather than as wood; past about
   * 0.5 the lines fold back on themselves and the surface reads as marble.
   */
  wander: number
  /** Cells of the low-frequency noise that does the wandering. */
  wanderCells: number
  /** Cells of the high-frequency noise that breaks the lines into fibres. */
  fibreCells: number
  /** How dark a latewood line goes, as a fraction below the mean. */
  lineDepth: number
  /** How much the fibre noise mottles the earlywood between lines. */
  fibreDepth: number
  /**
   * Sharpness of a growth line.
   *
   * Real latewood is abrupt on one side and gradual on the other, so a symmetric
   * sine reads as a painted stripe. The exponent is what makes the dark part thin
   * relative to the light part - at 1 this is a sine and the board looks striped.
   */
  lineSharpness: number
  /** Relief of the grain in the height field, 0 to 1 of the height range. */
  reliefStrength: number
  /**
   * Normal-map strength, which is a SEPARATE knob from `reliefStrength`.
   *
   * The height field decides how much of the grain the occlusion map shades;
   * this decides how hard the normal map tilts. Lower than the brick's 2.6,
   * because grain is a figure in the timber rather than a mortar joint between
   * two solids - wood that self-shadows like masonry reads as corrugated iron.
   */
  normalStrength: number
  /** Base roughness. Sealed timber, not raw: the planks are props, not scenery. */
  roughness: number
}

export const WOOD: WoodSpec = {
  lines: 9,
  wander: 0.28,
  wanderCells: 3,
  fibreCells: 26,
  lineDepth: 0.34,
  fibreDepth: 0.1,
  lineSharpness: 4,
  reliefStrength: 0.9,
  normalStrength: 1.1,
  roughness: 0.72,
}

/**
 * The grain field: 0 at the centre of a latewood line, 1 in clear earlywood.
 *
 * Pure and exported so the tests can assert on the FIELD rather than on the
 * bytes. The three things that can be wrong with generated grain - that it tiles
 * with a visible seam, that it never gets dark enough to read, and that it is
 * secretly a sine wave - are all questions about this function, and none of them
 * is visible in a 64 px thumbnail of the result.
 */
export function woodGrain(
  u: number,
  v: number,
  wander: (u: number, v: number) => number,
  fibre: (u: number, v: number) => number,
  spec: WoodSpec = WOOD,
): number {
  /*
    The wander is applied to the LINE COORDINATE, not to `u`, which is the
    difference between grain that bends and a texture that is merely warped.
    Adding it here means every line bends by the same amount at the same `v`, so
    they stay parallel to each other the way a board's grain does; warping `u`
    first would make neighbouring lines drift apart and cross.
  */
  const line = u * spec.lines + (wander(u, v) - 0.5) * 2 * spec.wander * spec.lines

  // Triangle wave rather than `fract`, so the field is continuous where the
  // sawtooth would jump - a discontinuity reads as a scratch, not as a ring.
  const saw = line - Math.floor(line)
  const triangle = 1 - Math.abs(saw * 2 - 1)

  /*
    The asymmetry, and the first version had it inverted.

    `triangle` is symmetric; raising it to a power squeezes the region near its
    PEAK, so the peak is where the latewood has to be - thin dark band, broad
    light one, which is the proportion of latewood to earlywood in a softwood
    board. Written the other way round, with the exponent on the light term, the
    exponent widens the dark instead and 85% of the tile comes out dark: a black
    disc with pale scratches, which is what the first pass shipped and what the
    area test now refuses.
  */
  const latewood = Math.pow(triangle, spec.lineSharpness)

  /*
    Fibre: mottling that runs WITH the grain, so it lengthens the lines rather
    than speckling them. `fibre` is sampled with v compressed for that reason.

    It only ever DARKENS. A symmetric mottle would push the clear earlywood above
    1, where the multiplier brightens the plank past its own colour and has to be
    clamped - and a field that spends half its light area pinned at exactly 1 has
    thrown away the variation it was added to provide.
  */
  const value = 1 - spec.lineDepth * latewood - spec.fibreDepth * (1 - fibre(u, v))
  return Math.min(1, Math.max(0, value))
}

/** The two noise fields the grain needs, seeded together so a tile is reproducible. */
export function woodNoise(spec: WoodSpec = WOOD, seed = 20260821) {
  const wanderNoise = valueNoise(spec.wanderCells, seed)
  const fibreNoise = valueNoise(spec.fibreCells, seed ^ 0x9e3779b9)
  return {
    wander: (u: number, v: number) => wanderNoise(u, v),
    /*
      `v * 0.22` compresses the noise along the grain direction, which is what
      turns round blobs into streaks. Sampling it square gives the board a case
      of the measles.
    */
    fibre: (u: number, v: number) => fibreNoise(u, v * 0.22),
  }
}

/**
 * The grain as a height field, for the normal map.
 *
 * Latewood is harder than earlywood and stands PROUD on a weathered board, but
 * on a sawn and sealed one it is very slightly sunk, because the softer
 * earlywood swells more. This follows the grain field directly - dark is low -
 * which gives the sunk version, and at this relief strength the difference is
 * academic. It is here at all so the planks catch the key light along their
 * grain rather than as one flat disc.
 */
export function woodHeight(size: number, spec: WoodSpec = WOOD, seed = 20260821): Float32Array {
  const { wander, fibre } = woodNoise(spec, seed)
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = woodGrain(x / size, y / size, wander, fibre, spec)
      // Centred on 0.5, because `normalFromHeight` and `ormFromHeight` both read
      // this as a signed relief about that base.
      out[y * size + x] = 0.5 + (g - 1) * spec.reliefStrength * 0.5
    }
  }
  return out
}

/**
 * The albedo, as RGBA multiplier bytes.
 *
 * A slight warm tilt into the dark lines: latewood is not merely a darker version
 * of earlywood, it is browner, and a grain drawn in pure grey multiplier reads as
 * a photocopy of wood. The tilt is small - 4% between the red and blue channels
 * at full depth - for the same reason `PANEL_TINT_CHROMA` is 0.09: past a certain
 * point the surface stops looking like one material and starts looking painted.
 */
export function woodAlbedoBytes(size: number, spec: WoodSpec = WOOD, seed = 20260821): Uint8ClampedArray {
  const { wander, fibre } = woodNoise(spec, seed)
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = woodGrain(x / size, y / size, wander, fibre, spec)
      const dark = 1 - g
      const i = (y * size + x) * 4
      out[i] = Math.round(255 * Math.min(1, g * (1 + WOOD_WARMTH * dark)))
      out[i + 1] = Math.round(255 * g)
      out[i + 2] = Math.round(255 * Math.max(0, g * (1 - WOOD_WARMTH * dark)))
      out[i + 3] = 255
    }
  }
  return out
}

/** How far the red and blue multipliers part in the latewood. */
export const WOOD_WARMTH = 0.04

export type WoodMaps = {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
  aoMap: Texture
  roughness: number
}

/**
 * Build the wood maps, or null where there is no canvas.
 *
 * Null rather than a stub, on `createBrickMaps`'s argument: a caller that gets
 * null spreads nothing and compiles the program it would have compiled anyway.
 * Cached by key, because all three planks and both faces want the same tile and
 * generating it four times is four uploads of identical bytes.
 */
export function createWoodMaps(size: 256 | 512 = 512, spec: WoodSpec = WOOD, seed = 20260821): WoodMaps | null {
  if (typeof document === 'undefined') return null

  const key = `${size}:${seed}:${spec.lines}:${spec.wander}:${spec.lineDepth}:${spec.lineSharpness}`
  const cached = cache.get(key)
  if (cached) return cached

  const height = woodHeight(size, spec, seed)
  /*
    ONE orm texture, bound to both slots. It packs occlusion, roughness and
    metalness into the three channels of a single image, so building it twice
    would be two identical uploads and two samplers to say the same thing -
    `createBrickMaps` binds its `relief.orm` to both for the same reason.
  */
  const orm = wrapBytes(
    ormFromHeight(height, size, { roughness: spec.roughness, swing: 0.1 }),
    size,
    LinearSRGBColorSpace,
  )
  const maps: WoodMaps = {
    map: wrapBytes(woodAlbedoBytes(size, spec, seed), size, SRGBColorSpace),
    normalMap: wrapBytes(
      normalFromHeight(height, size, spec.normalStrength),
      size,
      LinearSRGBColorSpace,
    ),
    roughnessMap: orm,
    aoMap: orm,
    roughness: roughnessBias(spec.roughness),
  }
  cache.set(key, maps)
  return maps
}

const cache = new Map<string, WoodMaps>()

/** Raw RGBA bytes as a tiling texture. `brickTexture.ts`'s wrapper, same reasons. */
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
  texture.anisotropy = 16
  texture.needsUpdate = true
  return texture
}
