import type { BufferGeometry } from 'three'
import {
  CHART_FACE_NAMES,
  applyLightmapUV,
  chartLocal,
  chartLocalToTexel,
  mergeProp,
  packLightmapAtlas,
  lightmapAtlasHash,
  propPartVertexCounts,
  texelToChartLocal,
  type LightmapAtlas,
  type LightmapChart,
  type LightmapManifest,
  type LightmapMesh,
} from '@/art/geometry'
import {
  HUB_LIGHTMAP_ATLAS,
  PLATEAU_RADIUS,
  hubDeckParts,
  hubTrimParts,
} from '@/game/world/hubLayout'
import { totemPlinth } from '@/game/world/LessonTotem'
import { buildBvh, bvhStats, occluded, type TriangleSoup } from './bvh.ts'
import { encodeGrayPng } from './png.ts'

/**
 * The offline sky-occlusion bake for the hub's walkable batches.
 *
 * Read `src/art/lightmap.ts` first. It carries the decision - what is baked, what
 * is deliberately not, and why the slot is `aoMap` on UV set 1 - and this file is
 * only the machinery that produces the image.
 *
 * ## What it computes
 *
 * For every atlas texel that lands on a surface: the cosine-weighted fraction of
 * the hemisphere above that surface which is not blocked by the level's own
 * geometry. That is the classical ambient-occlusion integral and it is exactly what
 * `aomap_fragment.glsl.js` wants, because that chunk scales indirect diffuse, and
 * indirect diffuse in this rig is a hemisphere light plus a prefiltered environment
 * - both of which are, to the surface, light arriving from all directions at once.
 *
 * There is no sun term and no light colour anywhere in this file. That is the
 * design, not an omission: see the block comment in `lightmap.ts`.
 *
 * ## Occluders
 *
 * The deck batch, the trim batch, and a flat disc standing in for the lawn.
 *
 * The DRESS batch is deliberately excluded, as an occluder as well as a receiver.
 * It is tier-gated - `quality.pylonCount` is 6 at low and 8 at high - so including
 * it would bake shadows from pylons that the low tier does not draw, and the map is
 * one file shared by all three tiers. Eight thin verticals standing in the lawn
 * occlude almost none of a deck's sky anyway; the arcs are 8 m overhead and subtend
 * a fraction of a per cent.
 *
 * The lawn disc matters more than it looks. It is what darkens the BOTTOM of every
 * vertical face: a kerb's outer face has a cosine hemisphere that includes
 * downward directions, and the ground is what fills them. Without it the kerbs come
 * out uniformly lit down their whole height, which is the tell-tale of an occlusion
 * bake that forgot the floor.
 */

/** How the bake was asked to run. Everything here ends up in the manifest. */
export type BakeOptions = {
  /** Cosine-weighted hemisphere rays per texel. */
  rays: number
  /** Metres beyond which an occluder is ignored. */
  maxDistance: number
  /** Skip the trace and report only the atlas, for sizing the resolution. */
  dryRun: boolean
  /**
   * Atlas override, for sizing only.
   *
   * The driver refuses this unless `dryRun` is set. An atlas written at a size that
   * `HUB_LIGHTMAP_ATLAS` does not name would fail the runtime staleness check on
   * the first load, which is the check working, but it is a confusing way to find
   * out and it wastes a bake.
   */
  atlas?: { size: number; texelsPerMetre: number; gutter: number }
  /** Called with progress, 0..1. */
  onProgress?: (fraction: number, note: string) => void
}

export type BakeResult = {
  atlas: LightmapAtlas
  manifest: LightmapManifest
  /** The encoded PNG, or null on a dry run. */
  png: Uint8Array | null
  /** Human-readable lines for the terminal, in the order they should print. */
  report: string[]
  /** The raw visibility bytes, so a probe can be read without decoding the PNG. */
  gray: Uint8Array
  /** 0 untouched, 1 traced, 2 filled by dilation. */
  written: Uint8Array
  /** The meshes the atlas was packed from, so a probe can read their positions. */
  meshes: LightmapMesh[]
}

/**
 * Read one chart back out of a finished bake, as an ASCII map.
 *
 * **This exists because a lightmap is the hardest kind of change to verify.** The
 * PNG is valid whatever is in it, the frame is clean whether the map is right or
 * upside down, and this stream is not allowed to drive the browser. So the bake has
 * to be able to show its own work: a chart printed as characters is enough to see
 * whether the occlusion band is along the riser edge, whether it is on the correct
 * side of it, and whether the chart is flipped.
 *
 * `MEMORY.md` for this project puts it plainly - this codebase breaks quietly, so
 * prove a change actually draws. This is the strongest available proof short of a
 * capture, and it costs nothing to keep.
 *
 * The map runs top-down in ATLAS rows, which after `applyLightmapUV`'s V inversion
 * is bottom-up in UV. For a `+Y` chart, atlas rows increase with world +Z, so the
 * top line of the printout is the chart's -Z (north) edge.
 */
export function probeChart(
  result: BakeResult,
  mesh: number,
  part: number,
  face: number,
  columns = 72,
): string[] {
  const chart = result.atlas.charts.find((c) => c.mesh === mesh && c.part === part && c.face === face)
  if (!chart) {
    const available = result.atlas.charts
      .filter((c) => c.mesh === mesh && c.part === part)
      .map((c) => CHART_FACE_NAMES[c.face])
      .join(' ')
    return [`no chart for mesh ${mesh} part ${part} face ${CHART_FACE_NAMES[face]}. Has: ${available || 'none'}`]
  }

  // Ten buckets, darkest first, so a gradient reads as a ramp and the darkest
  // texels are the most visually prominent characters on the line.
  // World bounds of the chart's own triangles, in all three axes. A chart whose
  // bbox is not where the layout says the part is means the triangle-to-part
  // attribution is wrong, which is the one failure in this pipeline that produces a
  // beautiful image of the wrong geometry.
  const position = result.atlas.charts === undefined ? null : null
  void position
  const bounds = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
  const attr = result.meshes[mesh].geometry.getAttribute('position')
  for (const t of chart.triangles) {
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k
      const xyz = [attr.getX(i), attr.getY(i), attr.getZ(i)]
      for (let a = 0; a < 3; a++) {
        if (xyz[a] < bounds[a * 2]) bounds[a * 2] = xyz[a]
        if (xyz[a] > bounds[a * 2 + 1]) bounds[a * 2 + 1] = xyz[a]
      }
    }
  }

  const ramp = '@%#*+=-:. '
  const stepX = Math.max(1, Math.ceil(chart.w / columns))
  const lines: string[] = [
    `mesh ${mesh} part ${part} face ${CHART_FACE_NAMES[face]}: ` +
      `${chart.w}x${chart.h} texels, ${chart.spanU.toFixed(2)}x${chart.spanV.toFixed(2)} m, ` +
      `at atlas (${chart.x}, ${chart.y}), 1 char = ${stepX} texels`,
    `  world x ${bounds[0].toFixed(2)}..${bounds[1].toFixed(2)}  ` +
      `y ${bounds[2].toFixed(2)}..${bounds[3].toFixed(2)}  ` +
      `z ${bounds[4].toFixed(2)}..${bounds[5].toFixed(2)}  (${chart.triangles.length} tris)`,
  ]
  for (let row = chart.y; row < chart.y + chart.h; row += stepX) {
    const v = texelToChartLocal(result.atlas, chart, chart.x, row).v
    let line = ''
    for (let col = chart.x; col < chart.x + chart.w; col += stepX) {
      // Nearest sample rather than a box average: an average blurs exactly the
      // sharp contact line the probe is here to look for.
      const i = row * result.atlas.size + col
      line += result.written[i] === 0 ? ' ' : ramp[Math.min(9, Math.floor((result.gray[i] / 255) * 10))]
    }
    lines.push(`${v.toFixed(2).padStart(7)} ${line}`)
  }

  /*
    A ruler in world metres along the chart's U axis, because the first read of this
    printout was wrong without one: a dark run was eyeballed as spanning 4 m when it
    spanned 2, and a 2 m error is the difference between "the kerb occludes its own
    footprint" and "something is projecting into the wrong place".
  */
  let ruler = ''
  let ticks = ''
  for (let col = chart.x; col < chart.x + chart.w; col += stepX) {
    const u = texelToChartLocal(result.atlas, chart, col, chart.y).u
    const whole = Math.round(u)
    const onTick = Math.abs(u - whole) <= (stepX / result.atlas.texelsPerMetre) / 2
    ticks += onTick ? '|' : ' '
    ruler += onTick ? String(Math.abs(whole) % 10) : ' '
  }
  lines.push(`${'u |'.padStart(8)}${ticks}`)
  lines.push(`${'  '.padStart(8)}${ruler}`)
  return lines
}

/**
 * 128 rays, and the number is arithmetic rather than taste.
 *
 * A binary visibility test sampled N times has a standard error of
 * sqrt(v(1-v)/N), worst at v = 0.5: **0.044 at 128 rays**. Through the display
 * response derived in `src/art/lightmap.ts` - roughly linear^0.43 acting on a 32%
 * indirect share - that is about 0.006 of display luma, against the 0.104 of depth
 * this map is able to produce at all. So the noise floor is about a sixtieth of the
 * signal.
 *
 * 64 rays would put it at 0.062 and 0.008 of luma; 256 at 0.031 and 0.004. The bake
 * is linear in this number, measured: at 2048 and 44 texels/m, 8 rays took 30.1 s and
 * 16 took 64.9 s, and 128 took **463 s**. That linearity is why 128 was chosen over
 * 256 - there is nothing to buy above it, and a quarter of an hour is a different kind
 * of tool from eight minutes.
 *
 * What has NOT been checked is where the visible threshold actually is, because that
 * needs a capture and this stream is not permitted to take one. The arithmetic says
 * 0.006 of luma cannot read on a gradient; that is a prediction, not a measurement.
 */
export const DEFAULT_RAYS = 128

/**
 * 8 metres.
 *
 * Bounded rather than unbounded, and the bound is taken from the layout: the tallest
 * thing that can shade a walkable surface here is T3's 2.8 m mass, and the widest span
 * between two walkable pieces that face each other is the 4.4 m bridge gap. Nothing in
 * this level overhangs anything - there is no roof, no arch over a deck, and the
 * catenary arcs are 8 m up and excluded as occluders anyway - so a longer ray has
 * nothing to find and only costs traversal.
 *
 * An unbounded bake was NOT run as a control. It should be, if this number is ever
 * doubted; `--distance=1000` is the flag and the thing to compare is the minimum
 * traced visibility in the report.
 */
export const DEFAULT_MAX_DISTANCE = 8

/** Segments in the lawn stand-in disc. */
const LAWN_SEGMENTS = 96

/**
 * Texels of tolerance when deciding a texel belongs to a triangle.
 *
 * A texel centre just outside a triangle still gets sampled, because bilinear
 * filtering at a surface's silhouette reaches half a texel beyond the last covered
 * centre. So coverage is conservative, and samples that fall outside are moved to
 * the nearest point on the triangle rather than extrapolated: extrapolating puts the
 * sample out in the air beside the surface, which reads as a bright fringe along
 * every edge in the level.
 *
 * **0.7 rather than the 1.5 this started at, and the difference is measured.** The
 * top bevel of a chamfered deck is two triangles 11.9 m long and 0.12 m wide, and
 * on a sliver like that the nearest-boundary point for a texel below the hypotenuse
 * drifts along the strip as it moves across it. Reading the atlas back at known
 * world points on T1's top face at z = -10.48, the first two texel rows came out
 * 0.36 at x = -3.75 rising monotonically to 0.57 at x = +2.25 - a 0.21 tilt across
 * perfectly symmetrical geometry. At 0.7 the same row reads 0.47 0.59 0.65 0.62 0.56
 * 0.62 ... 0.62 0.56 0.47, symmetric to the ray noise.
 *
 * 0.7 still covers the half texel bilinear needs, and anything it leaves uncovered
 * is picked up by `dilate`, so the smaller number costs nothing.
 */
const EDGE_TOLERANCE_TEXELS = 0.7

/** Value written where no surface was found. Bright, so a gap never reads as dirt. */
const UNCOVERED = 255

export type HubGeometry = {
  deck: BufferGeometry
  trim: BufferGeometry
  meshes: LightmapMesh[]
  /** Total triangle area, in square metres, across both batches. */
  surfaceArea: number
}

/**
 * Build the two walkable batches exactly as `HubIsland.tsx` builds them.
 *
 * "Exactly" is the entire point and it is enforced structurally rather than by
 * comment: both callers go through `hubDeckParts` and `hubTrimParts` in
 * `hubLayout.ts`, and the manifest hash covers the atlas that results. There is no
 * second copy of the layout for the bake to drift from.
 */
export function buildHubGeometry(): HubGeometry {
  const plinth = totemPlinth()
  const deckParts = hubDeckParts(plinth)
  const trimParts = hubTrimParts()

  const deck = mergeProp(deckParts)
  const trim = mergeProp(trimParts)
  const meshes: LightmapMesh[] = [
    { geometry: deck, partVertexCounts: propPartVertexCounts(deckParts) },
    { geometry: trim, partVertexCounts: propPartVertexCounts(trimParts) },
  ]
  plinth.dispose()

  return { deck, trim, meshes, surfaceArea: triangleArea(deck) + triangleArea(trim) }
}

/** Summed area of every triangle, for the texels-per-metre report. */
function triangleArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  let total = 0
  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i)
    const ay = position.getY(i)
    const az = position.getZ(i)
    const bx = position.getX(i + 1) - ax
    const by = position.getY(i + 1) - ay
    const bz = position.getZ(i + 1) - az
    const cx = position.getX(i + 2) - ax
    const cy = position.getY(i + 2) - ay
    const cz = position.getZ(i + 2) - az
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    total += 0.5 * Math.hypot(nx, ny, nz)
  }
  return total
}

/** Every occluder in the bake, as a flat triangle soup. */
export function buildOccluders(geometry: HubGeometry): TriangleSoup {
  const pieces: Float32Array[] = [
    positionsOf(geometry.deck),
    positionsOf(geometry.trim),
    lawnDisc(PLATEAU_RADIUS, LAWN_SEGMENTS),
  ]
  let total = 0
  for (const piece of pieces) total += piece.length
  const soup = new Float32Array(total)
  let offset = 0
  for (const piece of pieces) {
    soup.set(piece, offset)
    offset += piece.length
  }
  return soup
}

function positionsOf(geometry: BufferGeometry): Float32Array {
  const position = geometry.getAttribute('position')
  const out = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    out[i * 3] = position.getX(i)
    out[i * 3 + 1] = position.getY(i)
    out[i * 3 + 2] = position.getZ(i)
  }
  return out
}

/**
 * A flat triangle fan at y = 0, standing in for the plateau.
 *
 * `Terrain.tsx` makes the lawn geometrically flat - `97-decision-shadow-end.md`
 * relies on that when it explains why a pylon capsule tangent to it produced no
 * contact - so a disc is not an approximation of the lawn, it IS the lawn, to
 * within the grass that grows on it. Grass is not an occluder here on purpose:
 * `24022db` removed it from the shadow map for the same reason, and 178,988
 * instances of blade would turn a 90-second bake into an afternoon to produce a
 * high-frequency mottle that the removed occlusion pass was criticised for.
 */
function lawnDisc(radius: number, segments: number): Float32Array {
  const soup = new Float32Array(segments * 9)
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const b = ((i + 1) / segments) * Math.PI * 2
    const o = i * 9
    soup[o] = 0
    soup[o + 1] = 0
    soup[o + 2] = 0
    soup[o + 3] = Math.cos(a) * radius
    soup[o + 4] = 0
    soup[o + 5] = Math.sin(a) * radius
    soup[o + 6] = Math.cos(b) * radius
    soup[o + 7] = 0
    soup[o + 8] = Math.sin(b) * radius
  }
  return soup
}

/**
 * A 32-bit integer hash, used to give every texel its own sample rotation.
 *
 * Without it every texel samples the same 128 directions and the result is a
 * visible tiling of identical error - a plaid, at exactly texel frequency, which is
 * the most objectionable possible artefact and which more rays do not remove
 * because it is bias rather than noise. Rotating the sequence per texel converts it
 * into per-texel noise, which the smoothness of the underlying signal then hides.
 */
function texelHash(col: number, row: number): number {
  let h = (col * 73856093) ^ (row * 19349663)
  h = (h ^ (h >>> 13)) >>> 0
  h = (h * 1274126177) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * Trace one texel's hemisphere.
 *
 * Cosine-weighted sampling, so the plain mean of the binary visibility IS the
 * cosine-weighted visibility integral and no per-sample weight is needed. The
 * radial term is stratified over the sample count and the azimuth advances by the
 * golden angle, which is a two-line stand-in for a proper low-discrepancy sequence.
 * Stratifying the radius is the half that matters: it removes the clumping that makes
 * independent uniform pairs noisier than their count suggests. This was not A/B'd
 * against plain random pairs, and it would not be hard to - the sampler is the only
 * thing `rotation` and the `i / rays` term touch.
 */
export function traceTexel(
  bvh: ReturnType<typeof buildBvh>,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  rays: number,
  maxDistance: number,
  rotation: number,
): number {
  // An orthonormal tangent frame. Branching on the dominant axis avoids the
  // degenerate cross product that a fixed up-vector produces on a horizontal deck,
  // which is most of this level.
  let tx: number
  let ty: number
  let tz: number
  if (Math.abs(nx) < 0.9) {
    tx = 0
    ty = -nz
    tz = ny
  } else {
    tx = -nz
    ty = 0
    tz = nx
  }
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl
  ty /= tl
  tz /= tl
  const bx = ny * tz - nz * ty
  const by = nz * tx - nx * tz
  const bz = nx * ty - ny * tx

  /*
    The ray origin is lifted off the surface. The BVH's own t epsilon is 1e-4 and
    would be enough for a ray leaving a triangle it is not on, but a texel's
    barycentric position on a fillet can sit a hair BEHIND the neighbouring
    triangle's plane, and then the ray leaves from inside the solid and reports
    black. 1 mm is well under the 22.7 mm texel at the shipped resolution, so it cannot
    move a sample off the surface it belongs to, and it is far above the float32
    spacing at this world scale - see the self-hit table in `bvh.ts`, which measured
    6.2e-7 for a mesh at the origin.
  */
  const ox = px + nx * 1e-3
  const oy = py + ny * 1e-3
  const oz = pz + nz * 1e-3

  const golden = Math.PI * (3 - Math.sqrt(5))
  let open = 0
  for (let i = 0; i < rays; i++) {
    const r = Math.sqrt((i + 0.5) / rays)
    const phi = rotation + i * golden
    const cu = Math.cos(phi) * r
    const cv = Math.sin(phi) * r
    const cw = Math.sqrt(Math.max(0, 1 - r * r))
    const dx = tx * cu + bx * cv + nx * cw
    const dy = ty * cu + by * cv + ny * cw
    const dz = tz * cu + bz * cv + nz * cw
    if (!occluded(bvh, ox, oy, oz, dx, dy, dz, maxDistance)) open++
  }
  return open / rays
}

/**
 * Barycentric coordinates of the point on a 2D triangle's boundary closest to
 * `(cx, cy)`.
 *
 * **This function exists because the obvious alternative is wrong in a way that
 * only shows up on slivers, and it cost an afternoon to find.** The first version
 * clamped the negative barycentrics to zero and renormalised. That is not a
 * nearest-point projection: it moves the sample along a line through the opposite
 * vertex, so how far it travels scales with how elongated the triangle is rather
 * than with how far outside the point was. On a deck's top bevel - two triangles
 * 11.9 m long and 0.12 m wide - a sample 1.5 texels outside an edge was being
 * relocated by up to 2.3 METRES along the strip. The symptom was that the first
 * three texel rows of every deck's occlusion were displaced sideways, so
 * symmetrical geometry baked asymmetric, and nothing threw, and the PNG was
 * beautiful.
 *
 * The nearest point on a triangle boundary is the closest of the three nearest
 * points on its edges. A point on edge (i, j) at parameter t has barycentric 1-t at
 * i, t at j and 0 at k, so the result needs no renormalisation and is always inside
 * the triangle. Returns `[l0, l1, l2]` into a caller-owned array to keep the
 * rasteriser's inner loop free of allocation.
 */
export function nearestBarycentric(
  sx: readonly number[],
  sy: readonly number[],
  cx: number,
  cy: number,
  out: number[] = [0, 0, 0],
): number[] {
  let best = Infinity
  for (let e = 0; e < 3; e++) {
    const i0 = e
    const i1 = (e + 1) % 3
    const ex = sx[i1] - sx[i0]
    const ey = sy[i1] - sy[i0]
    const len2 = ex * ex + ey * ey
    const t =
      len2 > 0 ? Math.min(1, Math.max(0, ((cx - sx[i0]) * ex + (cy - sy[i0]) * ey) / len2)) : 0
    const qx = sx[i0] + ex * t - cx
    const qy = sy[i0] + ey * t - cy
    const d = qx * qx + qy * qy
    if (d < best) {
      best = d
      out[0] = 0
      out[1] = 0
      out[2] = 0
      out[i0] = 1 - t
      out[i1] += t
    }
  }
  return out
}

/**
 * Rasterise one chart's triangles into the atlas, tracing each covered texel.
 *
 * Returns the number of texels written.
 */
function bakeChart(
  atlas: LightmapAtlas,
  chart: LightmapChart,
  mesh: LightmapMesh,
  bvh: ReturnType<typeof buildBvh>,
  gray: Uint8Array,
  written: Uint8Array,
  options: BakeOptions,
): number {
  const position = mesh.geometry.getAttribute('position')
  const normal = mesh.geometry.getAttribute('normal')
  let count = 0

  // Reused across triangles so the inner loop allocates nothing.
  const sx = [0, 0, 0]
  const sy = [0, 0, 0]

  for (const t of chart.triangles) {
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k
      // Both the projection and the texel mapping come from `geometry.ts`, so the
      // baker and the UV writer cannot disagree about an axis pair, the gutter or
      // the origin. A local copy of the axis table was written first and deleted;
      // it is the obvious way for a bake to end up 90 degrees out on one face.
      const local = chartLocal(position, i, chart.face)
      const { col, row } = chartLocalToTexel(atlas, chart, local.u, local.v)
      sx[k] = col
      sy[k] = row
    }

    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    /*
      A degenerate projected triangle is not an error and must not be skipped
      silently either. It happens where a fillet's last ring is almost parallel to
      its chart's plane; the dominant-axis rule bounds that at 45 degrees so the
      area cannot vanish for geometric reasons, but it CAN vanish for a triangle
      whose three vertices are within a thousandth of a texel of each other, which
      several of the 3-degree draft rings are. Those texels are picked up by their
      neighbours' conservative coverage, so dropping them loses nothing.
    */
    if (Math.abs(area) < 1e-9) continue
    const inv = 1 / area

    const minCol = Math.max(chart.x, Math.floor(Math.min(sx[0], sx[1], sx[2]) - EDGE_TOLERANCE_TEXELS))
    const maxCol = Math.min(chart.x + chart.w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2]) + EDGE_TOLERANCE_TEXELS))
    const minRow = Math.max(chart.y, Math.floor(Math.min(sy[0], sy[1], sy[2]) - EDGE_TOLERANCE_TEXELS))
    const maxRow = Math.min(chart.y + chart.h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2]) + EDGE_TOLERANCE_TEXELS))

    // Edge lengths, so an edge function can be read as a distance in texels.
    const e0 = Math.hypot(sx[2] - sx[1], sy[2] - sy[1]) || 1
    const e1 = Math.hypot(sx[0] - sx[2], sy[0] - sy[2]) || 1
    const e2 = Math.hypot(sx[1] - sx[0], sy[1] - sy[0]) || 1
    const sign = area < 0 ? -1 : 1

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (written[row * atlas.size + col]) continue
        const cx = col + 0.5
        const cy = row + 0.5

        const w0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) * sign
        const w1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) * sign
        const w2 = ((sx[0] - cx) * (sy[1] - cy) - (sx[1] - cx) * (sy[0] - cy)) * sign

        // Each edge function over its edge length is the perpendicular distance
        // from the point to that edge, signed inward.
        if (
          w0 / e0 < -EDGE_TOLERANCE_TEXELS ||
          w1 / e1 < -EDGE_TOLERANCE_TEXELS ||
          w2 / e2 < -EDGE_TOLERANCE_TEXELS
        ) {
          continue
        }

        let l0 = w0 * inv * sign
        let l1 = w1 * inv * sign
        let l2 = w2 * inv * sign
        if (l0 < 0 || l1 < 0 || l2 < 0) {
          const near = nearestBarycentric(sx, sy, cx, cy)
          l0 = near[0]
          l1 = near[1]
          l2 = near[2]
        }

        const a = t * 3
        const px = position.getX(a) * l0 + position.getX(a + 1) * l1 + position.getX(a + 2) * l2
        const py = position.getY(a) * l0 + position.getY(a + 1) * l1 + position.getY(a + 2) * l2
        const pz = position.getZ(a) * l0 + position.getZ(a + 1) * l1 + position.getZ(a + 2) * l2
        let nx = normal.getX(a) * l0 + normal.getX(a + 1) * l1 + normal.getX(a + 2) * l2
        let ny = normal.getY(a) * l0 + normal.getY(a + 1) * l1 + normal.getY(a + 2) * l2
        let nz = normal.getZ(a) * l0 + normal.getZ(a + 1) * l1 + normal.getZ(a + 2) * l2
        const nl = Math.hypot(nx, ny, nz) || 1
        nx /= nl
        ny /= nl
        nz /= nl

        const visibility = options.dryRun
          ? 1
          : traceTexel(
              bvh,
              px,
              py,
              pz,
              nx,
              ny,
              nz,
              options.rays,
              options.maxDistance,
              (texelHash(col, row) / 0xffffffff) * Math.PI * 2,
            )

        gray[row * atlas.size + col] = Math.round(Math.min(1, Math.max(0, visibility)) * 255)
        written[row * atlas.size + col] = 1
        count++
      }
    }
  }
  return count
}

/**
 * Grow written texels outward, so a bilinear sample at a chart's edge reads
 * occlusion instead of the uncovered value.
 *
 * Two passes, which covers the 2-texel gutter exactly. A wider dilation would
 * start bleeding one chart into its neighbour, which is the failure the gutter
 * exists to prevent, so the two numbers are deliberately the same and changing one
 * means changing the other.
 */
function dilate(gray: Uint8Array, written: Uint8Array, size: number, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const grown: number[] = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const i = row * size + col
        if (written[i]) continue
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const r = row + dy
            const c = col + dx
            if (r < 0 || c < 0 || r >= size || c >= size) continue
            const j = r * size + c
            if (written[j] !== 1) continue
            sum += gray[j]
            n++
          }
        }
        if (n > 0) grown.push(i, Math.round(sum / n))
      }
    }
    // Applied after the whole sweep, so a dilated texel is never a source within
    // the same pass. Otherwise the fill runs further in +x than in -x and the
    // gutter is lopsided, which shows up as a one-sided fringe.
    for (let k = 0; k < grown.length; k += 2) {
      gray[grown[k]] = grown[k + 1]
      written[grown[k]] = 2
    }
  }
}

/** Run the whole bake. */
export function bakeHubLightmap(options: BakeOptions): BakeResult {
  const started = Date.now()
  const report: string[] = []

  const geometry = buildHubGeometry()
  const atlas = packLightmapAtlas(geometry.meshes, options.atlas ?? HUB_LIGHTMAP_ATLAS)

  const deckTris = geometry.deck.getAttribute('position').count / 3
  const trimTris = geometry.trim.getAttribute('position').count / 3
  const triangles = deckTris + trimTris

  report.push(
    `geometry   deck ${deckTris} tris, trim ${trimTris} tris, ` +
      `${geometry.surfaceArea.toFixed(1)} m2 of surface`,
  )
  report.push(
    `atlas      ${atlas.size}px, ${atlas.texelsPerMetre} texels/m ` +
      `(${(100 / atlas.texelsPerMetre).toFixed(2)} cm/texel), ` +
      `${atlas.charts.length} charts, ${(atlas.occupancy * 100).toFixed(1)}% occupancy`,
  )

  // Applying the UVs here is not needed for the image, and it is done anyway
  // because it is the only cheap way to prove the atlas describes this geometry
  // before spending minutes tracing it. It throws if any vertex is unclaimed.
  applyLightmapUV(geometry.meshes, atlas)

  const occluders = buildOccluders(geometry)
  const bvh = buildBvh(occluders)
  const stats = bvhStats(bvh)
  report.push(
    `bvh        ${stats.triangles} occluder tris, ${stats.nodes} nodes, ` +
      `depth ${stats.maxDepth}, ${stats.meanLeafSize.toFixed(1)} tris/leaf`,
  )

  const gray = new Uint8Array(atlas.size * atlas.size).fill(UNCOVERED)
  const written = new Uint8Array(atlas.size * atlas.size)

  let covered = 0
  atlas.charts.forEach((chart, i) => {
    covered += bakeChart(atlas, chart, geometry.meshes[chart.mesh], bvh, gray, written, options)
    options.onProgress?.((i + 1) / atlas.charts.length, CHART_FACE_NAMES[chart.face])
  })

  dilate(gray, written, atlas.size, atlas.gutter)

  const coverage = covered / (atlas.size * atlas.size)
  let min = 255
  let sum = 0
  for (let i = 0; i < gray.length; i++) {
    if (written[i] === 1) {
      if (gray[i] < min) min = gray[i]
      sum += gray[i]
    }
  }
  report.push(
    `traced     ${covered} texels (${(coverage * 100).toFixed(1)}% of the atlas), ` +
      `min visibility ${(min / 255).toFixed(3)}, mean ${(sum / covered / 255).toFixed(3)}`,
  )

  const png = options.dryRun ? null : encodeGrayPng(atlas.size, atlas.size, gray)
  const seconds = (Date.now() - started) / 1000
  if (png) {
    report.push(
      `png        ${(png.length / 1024).toFixed(0)} KB on disk, ` +
        `${((atlas.size * atlas.size * 4) / 1024 / 1024).toFixed(1)} MB in VRAM as RGBA`,
    )
  }
  report.push(`time       ${seconds.toFixed(1)} s`)

  const manifest: LightmapManifest = {
    hash: lightmapAtlasHash(atlas),
    size: atlas.size,
    texelsPerMetre: atlas.texelsPerMetre,
    gutter: atlas.gutter,
    charts: atlas.charts.length,
    occupancy: Number(atlas.occupancy.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    rays: options.rays,
    maxDistance: options.maxDistance,
    surfaceAreaSquareMetres: Number(geometry.surfaceArea.toFixed(2)),
    triangles,
    seconds: Number(seconds.toFixed(1)),
    generated: new Date().toISOString(),
  }

  return { atlas, manifest, png, report, gray, written, meshes: geometry.meshes }
}
