import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from 'three'
import { palette } from './palette'

/**
 * The island's ground surface, generated rather than photographed.
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
 * Generated at load, so it costs one canvas and no download.
 */

const SIZE = 1024
/** How many metres one repeat of this texture covers. Used to size the pattern. */
const METRES_PER_TILE = 8

/** Deterministic, so the ground does not rearrange itself between loads. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Run a drawing operation nine times, offset by one tile in each direction.
 *
 * This is what makes the result tile seamlessly. Anything crossing an edge is
 * also drawn entering the opposite edge, so a trace that runs off the top
 * continues from the bottom instead of being cut. Far simpler than authoring
 * the pattern to avoid the edges, and it cannot be got subtly wrong.
 */
function drawWrapped(ctx: CanvasRenderingContext2D, draw: () => void) {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      ctx.save()
      ctx.translate(dx, dy)
      draw()
      ctx.restore()
    }
  }
}

let cached: CanvasTexture | null = null

export function createGroundTexture(): CanvasTexture {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!

  /*
    Base. Lifted well toward white from the palette's grass, because this is
    now a backdrop for the blades rather than the grass itself, and it has to
    stay lighter than they are or the field disappears into it.
  */
  const base = new Color(palette.grass).lerp(new Color('#ffffff'), 0.34)
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

    drawWrapped(ctx, () => {
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

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  cached = texture
  return texture
}

export { METRES_PER_TILE as GROUND_METRES_PER_TILE }
