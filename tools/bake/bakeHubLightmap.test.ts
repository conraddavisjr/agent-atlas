import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chartLocalToTexel, lightmapAtlasHash, packLightmapAtlas } from '@/art/geometry'
import { LIGHTMAP_MANIFEST } from '@/art/lightmap'
import { HUB_LIGHTMAP_ATLAS } from '@/game/world/hubLayout'
import { buildHubGeometry, buildOccluders, nearestBarycentric, traceTexel } from './bakeHubLightmap.ts'
import { buildBvh } from './bvh.ts'
import { decodeGrayPng } from './png.ts'

/**
 * Tests for the hub occlusion bake.
 *
 * Two of these are worth more than the rest put together, and both exist because a
 * lightmap is the hardest kind of change to verify: the image is valid whatever is in
 * it, the frame is clean whether the map is right or upside down, and the failures are
 * geometric rather than exceptional.
 *
 * The first is `nearestBarycentric` on a sliver, which is a regression test for a real
 * bug that shipped in the first version of this file and displaced the occlusion on
 * every deck edge by up to 2.3 metres without throwing.
 *
 * The second is the staleness test at the bottom, which fails the SUITE when the
 * layout moves without a re-bake. That is the whole re-runnability story: the runtime
 * warns in DEV, and this makes it impossible to land a layout change with a stale map
 * and not know.
 */

describe('nearestBarycentric', () => {
  const flat = [
    [0, 0],
    [10, 0],
    [0, 10],
  ]
  const sx = flat.map((p) => p[0])
  const sy = flat.map((p) => p[1])

  /** Where the returned barycentrics actually put the sample. */
  function at(l: number[]): [number, number] {
    return [
      sx[0] * l[0] + sx[1] * l[1] + sx[2] * l[2],
      sy[0] * l[0] + sy[1] * l[1] + sy[2] * l[2],
    ]
  }

  it('returns a convex combination, always', () => {
    for (const [cx, cy] of [[-5, -5], [20, 0], [3, 3], [5, 5.5], [-1, 5]]) {
      const l = nearestBarycentric(sx, sy, cx, cy)
      expect(l[0] + l[1] + l[2]).toBeCloseTo(1, 9)
      for (const w of l) expect(w).toBeGreaterThanOrEqual(0)
    }
  })

  it('snaps to the nearest vertex outside a corner', () => {
    expect(at(nearestBarycentric(sx, sy, -3, -4))[0]).toBeCloseTo(0, 6)
    expect(at(nearestBarycentric(sx, sy, -3, -4))[1]).toBeCloseTo(0, 6)
    expect(at(nearestBarycentric(sx, sy, 14, -1))).toEqual([expect.closeTo(10, 6), expect.closeTo(0, 6)])
  })

  it('snaps to the nearest point on an edge, not past it', () => {
    const p = at(nearestBarycentric(sx, sy, 4, -2))
    expect(p[0]).toBeCloseTo(4, 6)
    expect(p[1]).toBeCloseTo(0, 6)
  })

  /*
    **The regression test, and the numbers in it are the measured ones.**

    A chamfered deck's top bevel is two triangles 11.9 m long and 0.12 m wide. The
    original implementation clamped the negative barycentrics to zero and
    renormalised, which moves a sample along a line through the OPPOSITE vertex - so
    how far it travels scales with the triangle's elongation, not with how far outside
    the point was. On this sliver, a point one unit past the hypotenuse was relocated
    by metres along the strip.

    The symptom in the atlas was that T1's top face read 0.36 at x = -3.75 rising to
    0.57 at x = +2.25 in its first texel rows, on geometry that is symmetric about
    x = 0, while every row further in was correct. Nothing threw and the PNG looked
    like a good lightmap.
  */
  it('moves a sample off a SLIVER by the distance it was out, not by the sliver’s length', () => {
    // 12 units long, 0.12 wide, which is a deck bevel to scale.
    const lx = [0, 12, 0]
    const ly = [0, 0.12, 0.12]
    const point: [number, number] = [6, -1]

    const l = nearestBarycentric(lx, ly, point[0], point[1])
    const px = lx[0] * l[0] + lx[1] * l[1] + lx[2] * l[2]
    const py = ly[0] * l[0] + ly[1] * l[1] + ly[2] * l[2]
    const moved = Math.hypot(px - point[0], py - point[1])

    // The true nearest point is on the long bottom edge, directly below.
    expect(moved).toBeLessThan(1.2)
    expect(px).toBeCloseTo(6, 1)

    // And this is what the old implementation did, kept as the contrast so the test
    // documents the bug rather than merely forbidding it.
    const area = (lx[1] - lx[0]) * (ly[2] - ly[0]) - (lx[2] - lx[0]) * (ly[1] - ly[0])
    const w0 = ((lx[1] - point[0]) * (ly[2] - point[1]) - (lx[2] - point[0]) * (ly[1] - point[1])) / area
    const w1 = ((lx[2] - point[0]) * (ly[0] - point[1]) - (lx[0] - point[0]) * (ly[2] - point[1])) / area
    const w2 = ((lx[0] - point[0]) * (ly[1] - point[1]) - (lx[1] - point[0]) * (ly[0] - point[1])) / area
    const c = [Math.max(0, w0), Math.max(0, w1), Math.max(0, w2)]
    const sum = c[0] + c[1] + c[2]
    const oldX = (lx[0] * c[0] + lx[1] * c[1] + lx[2] * c[2]) / sum
    expect(Math.abs(oldX - 6)).toBeGreaterThan(2)
  })

  it('writes into a caller-owned array without allocating', () => {
    const out = [9, 9, 9]
    expect(nearestBarycentric(sx, sy, -1, -1, out)).toBe(out)
    expect(out[0]).toBeCloseTo(1, 9)
  })
})

describe('the hub occlusion trace', () => {
  const geometry = buildHubGeometry()
  const bvh = buildBvh(buildOccluders(geometry))
  /** Enough rays that a 0.05 assertion is not a coin flip: standard error 0.022. */
  const RAYS = 512

  /** Cosine-weighted sky visibility of an up-facing point at a world position. */
  const up = (x: number, y: number, z: number) => traceTexel(bvh, x, y, z, 0, 1, 0, RAYS, 8, 0)

  it('builds both walkable batches, non-indexed, with matching part counts', () => {
    expect(geometry.meshes).toHaveLength(2)
    for (const mesh of geometry.meshes) {
      expect(mesh.geometry.getIndex()).toBeNull()
      const sum = mesh.partVertexCounts.reduce((a, b) => a + b, 0)
      expect(sum).toBe(mesh.geometry.getAttribute('position').count)
    }
  })

  it('sees open sky in the middle of T1, which is the sanity floor', () => {
    // T1 is 12 x 4 centred on (0, -8.6) with its top at y = 2.0.
    expect(up(0, 2, -8.6)).toBeGreaterThan(0.95)
  })

  /*
    The physical check this whole bake stands on. A point on a floor hard against a
    tall wall sees half its hemisphere, so cosine-weighted visibility tends to 0.5,
    and it climbs back toward 1 as the point moves away. Getting this wrong by a
    factor is the difference between occlusion and dirt.
  */
  it('approaches 0.5 at the foot of a riser and recovers away from it', () => {
    // T2's south wall stands at z = -10.6 and rises 0.4 m above T1's top.
    const atWall = up(0, 2, -10.58)
    const away = up(0, 2, -9.5)
    expect(atWall).toBeLessThan(0.8)
    expect(atWall).toBeGreaterThan(0.4)
    expect(away).toBeGreaterThan(atWall + 0.15)
  })

  it('is symmetric about x = 0, because the layout is', () => {
    for (const [y, z] of [
      [2, -10.44],
      [2, -8.6],
      [2, -6.75],
      [0.4, 0],
    ]) {
      for (const x of [1, 2.5, 4, 5.5]) {
        const left = up(-x, y, z)
        const right = up(x, y, z)
        expect(Math.abs(left - right), `x = ${x} at z = ${z}: ${left} vs ${right}`).toBeLessThan(0.07)
      }
    }
  })

  it('reads the bridge mouth as open and the kerb runs beside it as occluded', () => {
    // T1's south kerbs cover x -5.99..-2.21 and 2.21..5.99, leaving the mouth open.
    const mouth = up(0, 2, -6.75)
    const underKerb = up(-4, 2, -6.75)
    expect(mouth).toBeGreaterThan(0.85)
    expect(underKerb).toBeLessThan(mouth - 0.2)
  })

  it('finds the lawn below a vertical face, which is what darkens a kerb’s foot', () => {
    /*
      A +Z-facing point 1 cm above the lawn, against the same normal 2 m up. The
      floor fills the lower half of the first one's hemisphere and cosine-weighted
      visibility tends to 0.5; measured 0.50.

      The high one measures 0.74, not the 0.53 an INFINITE floor would give, and the
      difference is worth recording because it is the lawn's edge rather than an
      error: the plateau is a disc of radius 16 and this point stands at z = 12, so
      the floor only reaches 4 m in front of it and most downward rays escape past the
      rim. That is also what the island's overhang looks like to a real surface, so
      the number is right for the right reason.
    */
    const foot = traceTexel(bvh, 0, 0.01, 12, 0, 0, 1, RAYS, 8, 0)
    const high = traceTexel(bvh, 0, 2, 12, 0, 0, 1, RAYS, 8, 0)
    expect(foot).toBeGreaterThan(0.44)
    expect(foot).toBeLessThan(0.58)
    expect(high).toBeGreaterThan(foot + 0.18)
  })

  it('never leaves the 0..1 range', () => {
    for (const [x, y, z] of [[0, 2, -8.6], [0, 0.4, 0], [5, 0.4, -5], [0, 2.8, -13.7]]) {
      const v = up(x, y, z)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('the shipped lightmap', () => {
  /*
    **This is the test that makes the bake re-runnable rather than a one-off.**

    The layout will move again - that was accepted when a real bake was chosen over a
    cheaper approximation. What was not acceptable was the failure mode, because a
    lightmap whose atlas no longer matches its geometry renders the PREVIOUS layout's
    shadows onto the new one, in a completely clean frame, with nothing reporting a
    problem.

    So there are two detectors and they are deliberately different in kind. The
    runtime one in `HubIsland.tsx` warns in DEV, which catches a developer running the
    game. This one fails the suite, which catches the change at the point it is made.
    Either alone leaves a gap.
  */
  it('was baked for the geometry that is in the tree right now', () => {
    const atlas = packLightmapAtlas(buildHubGeometry().meshes, HUB_LIGHTMAP_ATLAS)
    expect(
      lightmapAtlasHash(atlas),
      'The hub walkable layout no longer matches src/art/lightmapHub.png. ' +
        'Run `npm run bake:lightmap` and commit both the PNG and the manifest.',
    ).toBe(LIGHTMAP_MANIFEST.hash)
  })

  it('agrees with the manifest about the atlas it was packed at', () => {
    const atlas = packLightmapAtlas(buildHubGeometry().meshes, HUB_LIGHTMAP_ATLAS)
    expect(atlas.size).toBe(LIGHTMAP_MANIFEST.size)
    expect(atlas.texelsPerMetre).toBe(LIGHTMAP_MANIFEST.texelsPerMetre)
    expect(atlas.gutter).toBe(LIGHTMAP_MANIFEST.gutter)
    expect(atlas.charts.length).toBe(LIGHTMAP_MANIFEST.charts)
  })

  it('records a bake that actually traced most of its charts', () => {
    // Coverage well under occupancy would mean charts placed but never rasterised,
    // which is what a silently-skipped mesh looks like from the outside.
    expect(LIGHTMAP_MANIFEST.coverage).toBeGreaterThan(LIGHTMAP_MANIFEST.occupancy * 0.7)
    expect(LIGHTMAP_MANIFEST.rays).toBeGreaterThanOrEqual(64)
  })
})

/**
 * Read the committed PNG back at named world coordinates.
 *
 * **This is the closest thing to a render this change can be checked by**, and it is
 * worth more than every other test here. Everything above verifies the machinery on
 * geometry built in the test; this verifies the actual image in the actual tree,
 * through the actual atlas mapping, at coordinates whose correct answer is known from
 * the layout rather than from a previous run of this code.
 *
 * It is also the only check that would catch a mistake in the encoder, the V
 * orientation, the gutter or the dilation, because those all sit between the trace and
 * the file and none of them changes the hash.
 */
describe('the committed lightmapHub.png', () => {
  const bytes = readFileSync(new URL('../../src/art/lightmapHub.png', import.meta.url))
  const image = decodeGrayPng(new Uint8Array(bytes))
  const atlas = packLightmapAtlas(buildHubGeometry().meshes, HUB_LIGHTMAP_ATLAS)

  /** Baked visibility at a world point on a named chart, 0..1. */
  function sample(mesh: number, part: number, face: number, u: number, v: number): number {
    const chart = atlas.charts.find((c) => c.mesh === mesh && c.part === part && c.face === face)
    if (!chart) throw new Error(`no chart for mesh ${mesh} part ${part} face ${face}`)
    const { col, row } = chartLocalToTexel(atlas, chart, u, v)
    return image.gray[Math.round(row - 0.5) * image.width + Math.round(col - 0.5)] / 255
  }

  it('is the size the manifest says, and decodes', () => {
    expect(image.width).toBe(LIGHTMAP_MANIFEST.size)
    expect(image.height).toBe(LIGHTMAP_MANIFEST.size)
  })

  it('is not blank, which is the failure a valid PNG hides best', () => {
    let min = 255
    let max = 0
    let sum = 0
    for (const g of image.gray) {
      if (g < min) min = g
      if (g > max) max = g
      sum += g
    }
    expect(min).toBe(0)
    expect(max).toBe(255)
    // A map that is mostly mid-grey would be a bug; a map that is mostly bright with
    // dark creases is what an occlusion bake looks like.
    expect(sum / image.gray.length / 255).toBeGreaterThan(0.5)
  })

  /*
    T1's top face, part 8 of the deck batch, chart +Y, which takes (x, z). The three
    coordinates below are the ones to look at in a render too, and their expected
    values come from the layout:

    - (0, -8.6) is the middle of a 12 x 4 deck with nothing above it: open sky.
    - (0, -10.58) is 2 cm from T2's south wall, which rises 0.4 m above this surface,
      so roughly half the hemisphere is gone.
    - (-4, -6.75) is under a kerb that covers x -5.99..-2.21 along T1's south edge.
    - (0, -6.75) is the bridge mouth, where that kerb run stops: open.
  */
  it('has open sky in the middle of T1', () => {
    expect(sample(0, 8, 2, 0, -8.6)).toBeGreaterThan(0.9)
  })

  /*
    The riser band, which is the feature the whole change was asked for: "the shadows
    on the environment, such as the steps in the platform".

    Read off the committed image down the middle of T1, at x = 0, approaching T2's
    south wall at z = -10.6:

      z      -10.45  -10.40  -10.35  -10.30  -10.20  -10.00  -9.50  -8.60
      value    0.67    0.74    0.76    0.80    0.87    0.91   0.96   0.98

    So the tread loses 0.31 of its sky over the last 1.2 m into the step, monotonically.
    Nothing below z = -10.45 is asserted because the top face's own 0.12 m bevel starts
    there and its texels legitimately belong to a tilted surface.
  */
  it('has a deep band at the foot of the T1 to T2 riser', () => {
    const atRiser = sample(0, 8, 2, 0, -10.45)
    const midway = sample(0, 8, 2, 0, -10.0)
    const open = sample(0, 8, 2, 0, -8.6)
    expect(atRiser).toBeGreaterThan(0.55)
    expect(atRiser).toBeLessThan(0.78)
    expect(open).toBeGreaterThan(0.94)
    expect(open - atRiser).toBeGreaterThan(0.22)
    // Monotone, because a band that is not is a rasterisation artefact rather than
    // an occlusion gradient.
    expect(midway).toBeGreaterThan(atRiser)
    expect(open).toBeGreaterThan(midway)
  })

  /*
    The bridge mouth, which is the check that says the occlusion is following the real
    layout rather than a plausible-looking approximation of it. T1's south kerbs cover
    x -5.99..-2.21 and 2.21..5.99, and the 4.4 m gap between them is where the bridge
    arrives. Measured across the image at z = -6.80:

      x        -5     -4     -2      0      2      4      5
      value   0.57   0.63   0.87   0.99   0.88   0.63   0.58

    A gap in the middle of a run of kerbs is not something a top-down projection or a
    hand-authored decal would get right by accident.
  */
  it('reads the bridge mouth open and the kerb runs beside it occluded', () => {
    const mouth = sample(0, 8, 2, 0, -6.8)
    const underKerb = sample(0, 8, 2, -4, -6.8)
    expect(mouth).toBeGreaterThan(0.9)
    expect(mouth - underKerb).toBeGreaterThan(0.25)
  })

  /*
    Symmetry, read off the image rather than off the tracer. This is the assertion that
    caught the sliver bug: it fails on any mapping error, any V flip on one axis, and
    any rasterisation displacement, none of which change the hash or throw.
  */
  it('is symmetric about x = 0 in the image, as the layout is in the world', () => {
    for (const z of [-10.58, -10.4, -9.5, -8.6, -7.5, -6.75]) {
      for (const x of [1, 2.5, 4, 5.5]) {
        const left = sample(0, 8, 2, -x, z)
        const right = sample(0, 8, 2, x, z)
        expect(Math.abs(left - right), `x = +/-${x} at z = ${z}: ${left} vs ${right}`).toBeLessThan(0.1)
      }
    }
  })

  /*
    A kerb's inward face, which is the check that would fail on a vertically flipped
    map while everything about the image still looked correct.

    The T3 north kerb is trim part 10; its `+Z` chart takes (x, y) and spans y
    2.815..3.387, standing on T3's top at y = 2.8 and facing back across the deck.
    Measured up the middle of that face:

      y       2.84   2.88   2.95   3.05   3.15   3.25   3.35
      value   0.47   0.48   0.51   0.57   0.61   0.63   0.73

    Dark at the foot where the deck fills the lower hemisphere, brightening to the
    crown. A flipped V would reverse this exactly and change nothing else.
  */
  it('darkens a kerb’s outer face toward its foot, not toward its crown', () => {
    const foot = sample(1, 10, 4, 0, 2.84)
    const crown = sample(1, 10, 4, 0, 3.35)
    expect(foot).toBeLessThan(0.6)
    expect(crown - foot).toBeGreaterThan(0.18)
  })

  it('leaves nothing at the uncovered value inside a chart', () => {
    // 255 is what an untraced texel keeps. Inside a chart's interior it would mean a
    // hole the dilation could not fill, which reads as a bright patch.
    const chart = atlas.charts.find((c) => c.mesh === 0 && c.part === 8 && c.face === 2)!
    let bright = 0
    for (let row = chart.y + chart.h / 4; row < chart.y + (chart.h * 3) / 4; row++) {
      for (let col = chart.x + chart.w / 4; col < chart.x + (chart.w * 3) / 4; col++) {
        if (image.gray[Math.floor(row) * image.width + Math.floor(col)] === 255) bright++
      }
    }
    // The middle of T1 genuinely is near-fully open, so a few texels legitimately hit
    // 255. A hole would be a contiguous region, not a scatter.
    expect(bright / ((chart.h / 2) * (chart.w / 2))).toBeLessThan(0.2)
  })
})
