import { CanvasTexture, Color, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import { palette } from './palette'
import { mulberry32 } from './placement'

/**
 * Generated surfacing: the island's ground, and the world's stone.
 *
 * A real grass photograph was tried first and was the wrong tool. Its normal
 * map gives every square metre of the island the relief of gravel, and once a
 * specular highlight crosses it the ground reads as wet rock rather than as a
 * lawn. The detail is also in the wrong place: a photograph puts it in the
 * surface, where this world wants it in the geometry standing on top.
 *
 * So the ground goes flat and light, and the blades, flowers and scatter carry
 * the detail. What the surface contributes instead is the circuit motif the
 * rest of the island is built from: pale green with darker traces worn into it,
 * the same idea as the glowing paths between the totems but quiet, and part of
 * the ground rather than sitting on it.
 *
 * The stone below it is generated for a different reason, and it is the
 * reference brief's deepest rule rather than a technical one: everything in
 * this world is a manufactured object, grass is moulded rubber, and stone is a
 * moulded stone-shaped object. A photograph of real granite is precisely what
 * that excludes. The evidence that the photograph was already fighting the
 * project is in `textures.ts`, which runs a whole load-time levelling pass that
 * exists only because the rock photograph averages RGB(79, 76, 69) and renders
 * near-black whatever colour it is given. A photograph carries its own value
 * histogram, and the greyscale readability test needs a histogram we authored.
 *
 * All of it is generated at load, so it costs canvases and no download.
 */

const SIZE = 1024
/** How many metres one repeat of the ground texture covers. Sizes the pattern. */
const METRES_PER_TILE = 8

/**
 * Resolution of the generated stone, and a deliberate step down from the 1024
 * the materials spec asks for.
 *
 * The spec's own counter-argument is the reason: a WebP decodes off the main
 * thread while a generated tile costs tens of milliseconds of main-thread
 * JavaScript at load, and the tier most likely to notice is the tier that can
 * least afford it. Stone tiles at 1.2 m, so 512 is 427 texels per metre, which
 * is already finer than the photographic set resolved on a 0.6 m boulder. Three
 * masks plus a Sobel pass at 1024 is four megapixels of ImageData arithmetic
 * for detail nothing in the frame is close enough to resolve.
 */
const STONE_SIZE = 512

/**
 * Run a drawing operation nine times, offset by one tile in each direction.
 *
 * This is what makes the result tile seamlessly. Anything crossing an edge is
 * also drawn entering the opposite edge, so a trace that runs off the top
 * continues from the bottom instead of being cut. Far simpler than authoring
 * the pattern to avoid the edges, and it cannot be got subtly wrong.
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

function canvas2d(size: number): CanvasRenderingContext2D {
  const element = document.createElement('canvas')
  element.width = size
  element.height = size
  return element.getContext('2d', { willReadFrequently: true })!
}

/**
 * Wrapped value noise, bilinearly upsampled from a small grid.
 *
 * Returns values in -1 to 1. The grid is indexed with `(i + n) % n` on both
 * axes, so the field is seamless by construction and does not need
 * `drawWrapped` at all.
 *
 * Interpolation is smoothstepped rather than linear. Plain bilinear leaves a
 * visible crease along every grid line, because the derivative is discontinuous
 * there, and on a low-frequency octave stretched over a whole island those
 * creases read as a faint grid pressed into the ground.
 */
function valueNoise(size: number, grid: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const cells = new Float32Array(grid * grid)
  for (let i = 0; i < cells.length; i++) cells[i] = rand() * 2 - 1

  const wrapIndex = (i: number) => ((i % grid) + grid) % grid
  const at = (gx: number, gy: number) => cells[wrapIndex(gy) * grid + wrapIndex(gx)]

  const out = new Float32Array(size * size)
  const scale = grid / size

  for (let y = 0; y < size; y++) {
    const fy = y * scale
    const y0 = Math.floor(fy)
    const ty = fy - y0
    const sy = ty * ty * (3 - 2 * ty)
    for (let x = 0; x < size; x++) {
      const fx = x * scale
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const sx = tx * tx * (3 - 2 * tx)

      const a = at(x0, y0)
      const b = at(x0 + 1, y0)
      const c = at(x0, y0 + 1)
      const d = at(x0 + 1, y0 + 1)

      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
    }
  }

  return out
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/* ---------------------------------------------------------------------------
   The island's walkable surface.
   --------------------------------------------------------------------------- */

let cachedGround: CanvasTexture | null = null

export function createGroundTexture(): CanvasTexture {
  if (cachedGround) return cachedGround

  const ctx = canvas2d(SIZE)

  /*
    Base.

    Lifted toward white from the palette's grass, because this is a backdrop for
    the blades rather than the grass itself and it has to stay lighter than they
    are or the field disappears into it. That reasoning is right and the old
    value of 0.34 overcorrected it: at a Rec.709 luma near 0.83 the ground was
    brighter than the deck stone standing on it, so a desaturated frame could
    not tell the raised platform from the lawn, which is the exact failure the
    acceptance test exists to catch.

    At 0.12 the ground lands near 0.71. Still comfortably above the field
    average of roughly 0.52, and now below the 0.735 the deck tops are moving
    to, so the three surfaces read as three values in the right order.
  */
  const base = new Color(palette.grass).lerp(new Color('#ffffff'), 0.12)
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, SIZE, SIZE)

  const rand = mulberry32(20260805)

  /*
    Broad mottling under everything else. Very low contrast: enough that the
    ground is not a single flat colour across sixteen metres, not enough to
    read as texture in its own right.
  */
  const mottle = new Color(palette.grassDeep)
  for (let i = 0; i < 26; i++) {
    const r = (0.1 + rand() * 0.28) * SIZE
    ctx.globalAlpha = 0.035 + rand() * 0.03
    ctx.fillStyle = `#${mottle.getHexString()}`
    ctx.beginPath()
    ctx.arc(rand() * SIZE, rand() * SIZE, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  /*
    Circuit traces. Axis-aligned and diagonal runs on a fixed grid, which is
    what makes them read as a circuit rather than as cracks: a crack wanders,
    a trace turns at set angles and stops at a pad.

    Drawn in `grassDeep`, so when the palette's greens come down in value the
    traces come down with them and keep reading as traces rather than as
    scratches.
  */
  const trace = new Color(palette.grassDeep)
  const grid = SIZE / 16
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

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = 0; i < 26; i++) {
    let x = Math.round(rand() * 16) * grid
    let y = Math.round(rand() * 16) * grid
    const segments = 2 + Math.floor(rand() * 4)

    const path: [number, number][] = [[x, y]]
    let [dx, dy] = directions[Math.floor(rand() * directions.length)]

    for (let s = 0; s < segments; s++) {
      const length = (1 + Math.floor(rand() * 3)) * grid
      x += dx * length
      y += dy * length
      path.push([x, y])
      // Turn rather than continue, so a trace is a route and not a line.
      const turn = directions[Math.floor(rand() * directions.length)]
      if (turn[0] !== -dx || turn[1] !== -dy) [dx, dy] = turn
    }

    const width = 2 + rand() * 5
    const alpha = 0.1 + rand() * 0.12

    drawWrapped(ctx, SIZE, () => {
      ctx.strokeStyle = `#${trace.getHexString()}`
      ctx.globalAlpha = alpha
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(path[0][0], path[0][1])
      for (let p = 1; p < path.length; p++) ctx.lineTo(path[p][0], path[p][1])
      ctx.stroke()

      // A pad where the run ends, which is the detail that says "circuit"
      // rather than "scratch".
      const [ex, ey] = path[path.length - 1]
      ctx.fillStyle = `#${trace.getHexString()}`
      ctx.globalAlpha = alpha * 1.5
      ctx.beginPath()
      ctx.arc(ex, ey, width * 1.5, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  ctx.globalAlpha = 1

  const texture = new CanvasTexture(ctx.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  cachedGround = texture
  return texture
}

/**
 * Roughness for the plateau, and nothing else.
 *
 * The walkable surface keeps its decision to take no normal map, because a
 * specular highlight crossing relief is what makes a lawn read as wet rock.
 * Roughness is a different question: the brief's rule is that perfectly uniform
 * roughness kills the read instantly, and a single roughness value across a
 * thirty-two metre disc means the grazing-angle sheen sweeps across the whole
 * island as one clean band as the camera turns.
 *
 * three computes `roughnessFactor *= texelRoughness.g`, so a map can only ever
 * make a surface smoother than the material's own value. The offset therefore
 * has to be signed by biasing the material: the mid green is 0.80 and the
 * caller sets `roughness = target / 0.80`, which is what `GROUND_ROUGHNESS_BIAS`
 * below is for. Getting that division wrong is the one fiddly part of the whole
 * scheme, so it lives here next to the map that requires it rather than at the
 * call site.
 *
 * Red is left at full so the same texture is harmless if it is ever also
 * assigned as an `aoMap`, which reads red and would otherwise darken the entire
 * island to a third of its value.
 */
export const GROUND_ROUGHNESS_MID = 0.8
export const GROUND_ROUGHNESS_BIAS = 1 / GROUND_ROUGHNESS_MID

let cachedGroundRoughness: CanvasTexture | null = null

export function createGroundRoughnessTexture(): CanvasTexture {
  if (cachedGroundRoughness) return cachedGroundRoughness

  const size = 256
  const ctx = canvas2d(size)
  const image = ctx.createImageData(size, size)
  const data = image.data

  /*
    Two octaves and no more. The brief specifies LOW-frequency noise, and the
    failure mode of doing this with high frequency is a surface that looks dirty
    rather than moulded. At 8 m per tile the coarse octave is a 2 m feature and
    the fine one is 0.65 m, which is the scale of a patch of ground rather than
    the scale of grit.
  */
  const coarse = valueNoise(size, 4, 90210)
  const fine = valueNoise(size, 12, 90211)

  const mid = GROUND_ROUGHNESS_MID * 255
  // Plus or minus 0.08 of roughness against a target of 0.90, expressed in the
  // map's own units: 0.08 / 0.90 of the mid green.
  const swing = mid * (0.08 / 0.9)

  for (let i = 0; i < size * size; i++) {
    const n = coarse[i] * 0.7 + fine[i] * 0.3
    const p = i * 4
    data[p] = 255
    data[p + 1] = clamp255(Math.round(mid + n * swing))
    data[p + 2] = 0
    data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)

  const texture = new CanvasTexture(ctx.canvas)
  // Roughness is data, not colour. An sRGB decode curve on gloss values makes
  // the whole surface read shinier than authored.
  texture.colorSpace = LinearSRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  cachedGroundRoughness = texture
  return texture
}

/* ---------------------------------------------------------------------------
   Moulded stone.
   --------------------------------------------------------------------------- */

/**
 * The mask set a generated surface is built from.
 *
 * Three masks rather than one image, drawn from the same vector work with
 * different weights, which is what makes a facet join simultaneously a groove
 * in the normal, a dust trap in the roughness and a dark line in the occlusion.
 * A crevice that is only dark is a smudge; a crevice that is all three is depth.
 */
type StoneStyle = {
  /** Base fill, as a 0-1 value. */
  base: number
  /** How much of the value noise reaches this mask, in 0-1 value units. */
  noise: number
  /** Value inside a facet crevice. */
  crevice: number
  /** Value on the raised lip beside a crevice. */
  lip: number
  /** Value inside a chip. */
  chip: number
  /** Value in the crescent shadow on the far side of a chip. */
  chipShadow: number
  /** Value along the parting line groove, and on its lip. */
  parting: number
  partingLip: number
  /** Alpha the crevice, chip and parting strokes are drawn at. */
  strokeAlpha: number
}

/** Twelve headings on 30-degree steps, precomputed. */
const FACET_HEADINGS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6)

/**
 * Draw the stone's vector layers into one mask.
 *
 * The generator is re-seeded identically for every mask, so all three masks
 * describe the *same* rock. Drawing them from independent random streams would
 * put the roughness grooves somewhere other than the normal-map grooves, and
 * the surface would read as two different rocks superimposed.
 */
function drawStoneLayers(
  ctx: CanvasRenderingContext2D,
  size: number,
  style: StoneStyle,
  noise: Float32Array,
) {
  const grey = (v: number) => {
    const b = clamp255(Math.round(v * 255))
    return `rgb(${b},${b},${b})`
  }

  ctx.fillStyle = grey(style.base)
  ctx.fillRect(0, 0, size, size)

  // Value noise, applied as pixels rather than as draws. Three octaves summing
  // to the amplitude the caller asked for, weighted two thirds toward the
  // coarsest because low-frequency mould flow is the thing being modelled.
  if (style.noise > 0) {
    const image = ctx.getImageData(0, 0, size, size)
    const data = image.data
    for (let i = 0; i < size * size; i++) {
      const n = noise[i] * style.noise * 255
      const p = i * 4
      data[p] = clamp255(data[p] + n)
      data[p + 1] = clamp255(data[p + 1] + n)
      data[p + 2] = clamp255(data[p + 2] + n)
    }
    ctx.putImageData(image, 0, 0)
  }

  const rand = mulberry32(770311)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  /*
    Facet crevices.

    Every segment runs along one of twelve 30-degree headings, and that single
    constraint is what makes these read as the joins between moulded facets
    rather than as organic cracks. A crack wanders; a facet join turns at an
    angle a mould could actually release from. Drawn with a raised lip offset by
    one pixel, because a groove with no lip is a dark line and a groove with a
    lip that catches the key is depth.
  */
  for (let i = 0; i < 34; i++) {
    const path: [number, number][] = [[rand() * size, rand() * size]]
    let heading = FACET_HEADINGS[Math.floor(rand() * FACET_HEADINGS.length)]
    const segments = 3 + Math.floor(rand() * 4)

    for (let s = 0; s < segments; s++) {
      const length = (0.04 + rand() * 0.12) * size
      const [px, py] = path[path.length - 1]
      path.push([px + Math.cos(heading) * length, py + Math.sin(heading) * length])
      // Turn by one or two steps of 30 degrees, either way. Turning by more
      // reads as a scribble and turning by less reads as a straight line.
      const step = (1 + Math.floor(rand() * 2)) * (rand() < 0.5 ? 1 : -1)
      heading += (step * Math.PI) / 6
    }

    const width = (1 + rand() * 1.5) * (size / 512)

    const stroke = (offset: number, value: number, w: number, alpha: number) => {
      ctx.globalAlpha = alpha
      ctx.strokeStyle = grey(value)
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(path[0][0] + offset, path[0][1] - offset)
      for (let p = 1; p < path.length; p++) ctx.lineTo(path[p][0] + offset, path[p][1] - offset)
      ctx.stroke()
    }

    drawWrapped(ctx, size, () => {
      stroke(0, style.crevice, width, style.strokeAlpha)
      stroke(1, style.lip, 1, style.strokeAlpha * 0.62)
    })
  }

  /*
    Chips.

    Small polished pits with a crescent of shadow on the side away from the
    tile's notional key direction. The key direction is fixed rather than random
    because every chip on a moulded part was made by the same tool travelling
    the same way, and a field of chips lit from random directions reads as noise.
  */
  const KEY_X = 0.6
  const KEY_Y = -0.8
  for (let i = 0; i < 120; i++) {
    const cx = rand() * size
    const cy = rand() * size
    const r = (2 + rand() * 4) * (size / 512)
    // Drawn before the wrap, not inside it. A chip that straddles a tile edge
    // has to be the same chip on both sides, and drawing nine copies each with
    // a freshly sampled rotation would put a different ellipse on each one.
    const tilt = rand() * Math.PI

    drawWrapped(ctx, size, () => {
      ctx.globalAlpha = style.strokeAlpha * 0.56
      ctx.fillStyle = grey(style.chip)
      ctx.beginPath()
      ctx.ellipse(cx, cy, r, r * 0.78, tilt, 0, Math.PI * 2)
      ctx.fill()

      ctx.globalAlpha = style.strokeAlpha * 0.44
      ctx.fillStyle = grey(style.chipShadow)
      ctx.beginPath()
      ctx.ellipse(cx - KEY_X * r * 0.5, cy - KEY_Y * r * 0.5, r * 0.7, r * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  /*
    Parting line.

    One per tile, which at 1.2 m per tile is one every 1.2 m of world: the right
    frequency for something moulded in a kit of parts, and the single detail
    that says "this came out of a two-part mould" rather than "this is a rock".
  */
  drawWrapped(ctx, size, () => {
    ctx.globalAlpha = style.strokeAlpha * 0.5
    ctx.strokeStyle = grey(style.parting)
    ctx.lineWidth = 2 * (size / 512)
    ctx.beginPath()
    ctx.moveTo(-size, size * 0.5)
    ctx.lineTo(size * 2, size * 0.5)
    ctx.stroke()

    ctx.globalAlpha = style.strokeAlpha * 0.68
    ctx.strokeStyle = grey(style.partingLip)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(-size, size * 0.5 - 1.5)
    ctx.lineTo(size * 2, size * 0.5 - 1.5)
    ctx.stroke()
  })

  ctx.globalAlpha = 1
}

/**
 * Tangent-space normal map from a height mask.
 *
 * `strength` is in height-units per pixel. The Sobel kernels sum to 4 on their
 * positive lobe, so dividing by 4 makes `strength` mean "a slope of 1.0 in
 * height over one pixel produces a 45 degree normal", which is a scale a human
 * can reason about when tuning.
 *
 * Indexing wraps, so a height mask that is seamless produces a normal map that
 * is seamless. Clamping instead puts a visible ridge on every tile boundary,
 * which is the classic way this goes wrong and it is invisible until the
 * texture is tiled across something large.
 */
function normalFromHeight(height: Float32Array, size: number, strength: number): ImageData {
  const out = new ImageData(size, size)
  const px = out.data
  const at = (x: number, y: number) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]

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

      // Both gradients are negated: a surface that rises toward +X must tilt
      // its normal toward -X. Getting this sign wrong inverts every groove into
      // a ridge, and it looks plausible enough to ship by mistake.
      const nx = -gx * strength * 0.25
      const ny = -gy * strength * 0.25
      const inv = 1 / Math.hypot(nx, ny, 1)

      const i = (y * size + x) * 4
      px[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      px[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      px[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      px[i + 3] = 255
    }
  }
  return out
}

/** Separable box blur over one channel of a mask, with wraparound. */
function blurMask(source: Float32Array, size: number, radius: number): Float32Array {
  const wide = new Float32Array(size * size)
  const out = new Float32Array(size * size)
  const span = radius * 2 + 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += source[y * size + (((x + k) % size) + size) % size]
      }
      wide[y * size + x] = sum / span
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += wide[((((y + k) % size) + size) % size) * size + x]
      }
      out[y * size + x] = sum / span
    }
  }
  return out
}

function readValues(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const data = ctx.getImageData(0, 0, size, size).data
  const out = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) out[i] = data[i * 4] / 255
  return out
}

export type GeneratedMaps = {
  map: CanvasTexture
  normalMap: CanvasTexture
  /** ORM pack. three reads roughness from its green channel. */
  roughnessMap: CanvasTexture
  /** The same ORM pack. three reads occlusion from its red channel. */
  aoMap: CanvasTexture
}

let cachedStone: GeneratedMaps | null = null

/**
 * Moulded stone, replacing the photographic granite set.
 *
 * The albedo is near-white and carries only value structure, which is the whole
 * point: the palette drives hue, so `stone(palette.rock, ...)` tints a surface
 * rather than dimming a photograph that already had its own idea about colour.
 * The base of `#dedede` is deliberately close to the 188-of-255 the levelling
 * pass in `textures.ts` currently targets, so swapping a call site over is a
 * material change and not also a lighting change.
 *
 * Packed as ORM with occlusion in red and roughness in green, matching the
 * existing convention exactly, so `stone()`'s signature does not change and the
 * swap at a call site is one import.
 */
export function createMouldedStoneMaps(): GeneratedMaps {
  if (cachedStone) return cachedStone

  const size = STONE_SIZE

  // One noise field, shared by every mask so the mottle, the height and the
  // roughness all agree about where the mould flowed.
  const octaves = [
    { grid: 8, weight: 0.66, seed: 10001 },
    { grid: 20, weight: 0.24, seed: 10002 },
    { grid: 54, weight: 0.1, seed: 10003 },
  ]
  const noise = new Float32Array(size * size)
  for (const o of octaves) {
    const field = valueNoise(size, o.grid, o.seed)
    for (let i = 0; i < noise.length; i++) noise[i] += field[i] * o.weight
  }

  // Albedo. Near-white, low contrast, no hue of its own.
  const albedoCtx = canvas2d(size)
  drawStoneLayers(albedoCtx, size, {
    base: 0.87,
    noise: 0.078,
    crevice: 0,
    lip: 1,
    chip: 1,
    chipShadow: 0,
    parting: 0,
    partingLip: 1,
    strokeAlpha: 0.16,
  }, noise)

  // Height, and the normal derived from it.
  const heightCtx = canvas2d(size)
  drawStoneLayers(heightCtx, size, {
    base: 0.6,
    noise: 0.1,
    crevice: 0.24,
    lip: 0.7,
    chip: 0.72,
    chipShadow: 0.6,
    parting: 0.42,
    partingLip: 0.66,
    strokeAlpha: 1,
  }, noise)
  const height = readValues(heightCtx, size)

  /*
    Roughness. Dust settles in a groove, so a crevice is rougher than the
    surface around it; a pit left by a mould is polished, so a chip is smoother.
    Written around the 0.80 mid, exactly as the plateau map above, and the
    material's roughness is divided by that mid at the call site.
  */
  const roughCtx = canvas2d(size)
  drawStoneLayers(roughCtx, size, {
    base: GROUND_ROUGHNESS_MID,
    noise: 0.17 * GROUND_ROUGHNESS_MID,
    crevice: GROUND_ROUGHNESS_MID + 0.16,
    lip: GROUND_ROUGHNESS_MID - 0.04,
    chip: GROUND_ROUGHNESS_MID - 0.08,
    chipShadow: GROUND_ROUGHNESS_MID,
    parting: GROUND_ROUGHNESS_MID + 0.06,
    partingLip: GROUND_ROUGHNESS_MID - 0.04,
    strokeAlpha: 1,
  }, noise)
  const rough = readValues(roughCtx, size)

  /*
    Occlusion. Only the structural layers write into it - noise is not
    occlusion, and treating it as though it were is what produces the "ambient
    occlusion looks like dirt" failure the reference brief warns about. Blurred,
    because occlusion is light that did not arrive rather than a line, and then
    floored at 0.55 so no texel can turn a lit surface black.
  */
  const aoCtx = canvas2d(size)
  drawStoneLayers(aoCtx, size, {
    base: 1,
    noise: 0,
    crevice: 0.62,
    lip: 1,
    chip: 0.86,
    chipShadow: 0.9,
    parting: 0.8,
    partingLip: 1,
    strokeAlpha: 1,
  }, noise)
  const ao = blurMask(readValues(aoCtx, size), size, 3)

  const ormCtx = canvas2d(size)
  const orm = ormCtx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const p = i * 4
    orm.data[p] = clamp255(Math.round(Math.max(0.55, ao[i]) * 255))
    orm.data[p + 1] = clamp255(Math.round(rough[i] * 255))
    orm.data[p + 2] = 0
    orm.data[p + 3] = 255
  }
  ormCtx.putImageData(orm, 0, 0)

  const normalCtx = canvas2d(size)
  normalCtx.putImageData(normalFromHeight(height, size, 3), 0, 0)

  const wrap = (ctx: CanvasRenderingContext2D, srgb: boolean) => {
    const texture = new CanvasTexture(ctx.canvas)
    texture.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    return texture
  }

  const packed = wrap(ormCtx, false)
  cachedStone = {
    map: wrap(albedoCtx, true),
    normalMap: wrap(normalCtx, false),
    roughnessMap: packed,
    aoMap: packed,
  }
  return cachedStone
}

export { METRES_PER_TILE as GROUND_METRES_PER_TILE }
