/**
 * A bounding-volume hierarchy over a triangle soup, for occlusion rays only.
 *
 * The lightmap baker asks exactly one question of the scene, millions of times:
 * "is anything at all between this texel and that point on the sky". It never
 * needs the nearest hit, never needs barycentrics, never needs a material. That
 * single restriction is what makes this cheap - traversal can return the moment
 * any triangle is hit, in whatever order nodes happen to come off the stack, so
 * there is no need to sort children by ray direction, no need to keep a running
 * closest `t`, and no need to descend the far child of a node once the near one
 * has answered yes.
 *
 * Everything here is flat typed arrays and an explicit stack. See the comments
 * on `Bvh` and `occluded` for why that is not premature.
 */

/** Flat triangle soup: 9 floats per triangle, ax ay az bx by bz cx cy cz. */
export type TriangleSoup = Float32Array

/**
 * `t` below this is treated as no hit.
 *
 * This has to be far larger than it looks like it should be, because of where
 * bake rays start. A texel's ray origin is a point *on* the surface being
 * shaded, reconstructed from interpolated UVs into float32, and the triangle it
 * sits on is in the BVH like every other one. In exact arithmetic the ray leaves
 * that triangle at t = 0 and never comes back. In float32 the reconstructed
 * origin lands a hair off the plane and Möller-Trumbore reports a real hit at a
 * tiny positive t - the surface shadowing itself.
 *
 * The symptom does not look like an epsilon problem. Roughly half of all texels
 * report themselves fully occluded (half, because whether the rounding puts the
 * origin in front of or behind the plane is a coin flip), the lightmap bakes
 * mottled black, and it reads as "the light was never placed".
 *
 * Measured, on 4000 triangles in general position with origins reconstructed by
 * float32 barycentric interpolation and rays fired along the geometric normal,
 * 40000 samples per row. "self-hits" counts rays wrongly blocked by their own
 * triangle; ~20000 is the ceiling (the other half round the safe way).
 *
 *   mesh centred at   self-t median   self-t max    eps 1e-6   1e-5     1e-4
 *   origin                  1.0e-7      6.2e-7             0      0        0
 *   (100, 0, 100)           1.3e-6      5.4e-6         11694      0        0
 *   (1000, 0, 1000)         1.0e-5      4.1e-5         18844  10151        0
 *
 * That is the whole argument. The error scales with the *absolute* magnitude of
 * the coordinates, because float32 spacing does, so an epsilon tuned on a mesh
 * at the origin breaks as soon as the same mesh is placed 1 km out. 1e-6 is
 * enough only for geometry sitting on the origin; 1e-5 still lets half the
 * self-hits through at a 1 km offset; 1e-4 clears every case measured with
 * three orders of magnitude of headroom.
 *
 * The cost of 1e-4 is that a genuine occluder within 0.1 mm of a surface (1 unit
 * = 1 metre here) is missed. Nothing in this scene is built that tight. If the
 * world ever grows past a few km from the origin, this number has to grow too -
 * or origins have to be offset along the normal before the ray is cast, which is
 * the other standard fix and the one to reach for at that point.
 */
const T_EPSILON = 1e-4

/**
 * Determinant below this in magnitude means the ray is parallel to the triangle
 * plane. Much smaller than T_EPSILON because it is not a distance - it is a
 * scaled volume, and rejecting too eagerly here punches holes in geometry seen
 * at a grazing angle, which is most of a hemisphere's worth of bake rays.
 */
const DET_EPSILON = 1e-9

/** A node holding this many triangles or fewer becomes a leaf. */
const LEAF_SIZE = 4

/** Hard recursion cap, so coincident centroids cannot run the split forever. */
const MAX_DEPTH = 32

/**
 * The hierarchy, as parallel typed arrays rather than an object graph.
 *
 * Both layouts were built and benchmarked against each other on a 34,992
 * triangle stacked-deck scene (20,831 nodes either way, same split algorithm),
 * with 200,000 hemisphere rays. The object-graph rival was written properly, not
 * as a straw man: array-based traversal stack, no recursion, cached min/max
 * arrays per node.
 *
 *   build            flat 37 ms   object 86 ms      2.3x
 *   200k rays        flat 363 ms  object 412 ms     1.13x
 *   node heap        flat 0.64 MB object 4.6 MB     7.2x
 *
 * The honest summary is that the traversal win is modest - 13%, not the order of
 * magnitude this kind of comment usually claims - because V8 handles a
 * monomorphic object graph better than the folklore suggests. The build and the
 * memory are where it actually pays: 41,662 short-lived three-element arrays for
 * the bounds alone, plus a sorted copy per interior node, versus two typed
 * arrays sized once.
 *
 * 13% still matters at bake scale (a 400M-ray bake is ~12 minutes here, so the
 * 13% is over a minute), and none of it is why the flat layout is worth keeping
 * anyway: the reason is that it lets `occluded` allocate nothing at all, which
 * is what keeps the GC out of a loop that runs hundreds of millions of times.
 */
export type Bvh = {
  /**
   * The soup, permuted so that every leaf's triangles are contiguous. 9 floats
   * per triangle. This is a copy - the caller's array is never mutated.
   */
  triangles: Float32Array
  /** 6 floats per node: minX minY minZ maxX maxY maxZ. */
  bounds: Float32Array
  /**
   * 2 ints per node.
   *
   * Leaf (`meta[i * 2 + 1] > 0`): [first triangle index, triangle count].
   * Interior (`meta[i * 2 + 1] === 0`): [left child index, 0], and the right
   * child is always `left + 1`. Storing children as an adjacent pair halves the
   * index traffic and means an interior node needs one int, not two.
   */
  meta: Int32Array
  nodeCount: number
  maxDepth: number
  /**
   * Traversal scratch, preallocated at build so `occluded` allocates nothing.
   * Sized from the depth actually reached, not from MAX_DEPTH.
   */
  stack: Int32Array
}

/**
 * Reorder `indices[lo, hi)` so that the element that would sit at position `k`
 * in centroid-axis order is at `k`, everything before it is <=, everything
 * after is >=. Quickselect with a median-of-three pivot.
 *
 * Median-of-three is not decoration. Prop centroids in this project arrive in
 * generation order, which for anything laid out on a grid or extruded along a
 * path is already sorted on one axis, and first-element pivoting on sorted
 * input is the textbook O(n^2) case for quickselect.
 */
function selectByCentroid(
  indices: Int32Array,
  centroids: Float32Array,
  axis: number,
  lo: number,
  hi: number,
  k: number,
): void {
  let left = lo
  let right = hi - 1
  while (left < right) {
    const mid = (left + right) >> 1
    if (centroids[indices[mid] * 3 + axis] < centroids[indices[left] * 3 + axis]) {
      const t = indices[mid]
      indices[mid] = indices[left]
      indices[left] = t
    }
    if (centroids[indices[right] * 3 + axis] < centroids[indices[left] * 3 + axis]) {
      const t = indices[right]
      indices[right] = indices[left]
      indices[left] = t
    }
    if (centroids[indices[right] * 3 + axis] < centroids[indices[mid] * 3 + axis]) {
      const t = indices[right]
      indices[right] = indices[mid]
      indices[mid] = t
    }
    const pivot = centroids[indices[mid] * 3 + axis]

    let i = left
    let j = right
    while (i <= j) {
      while (centroids[indices[i] * 3 + axis] < pivot) i += 1
      while (centroids[indices[j] * 3 + axis] > pivot) j -= 1
      if (i <= j) {
        const t = indices[i]
        indices[i] = indices[j]
        indices[j] = t
        i += 1
        j -= 1
      }
    }
    // With every key equal the two inner loops stall, but the unconditional
    // swap-and-step above still moves i past j, so this terminates.
    if (k <= j) right = j
    else if (k >= i) left = i
    else return
  }
}

/**
 * Build a BVH over `triangles`.
 *
 * Splitting is a median split on the longest axis of the centroid bounds.
 *
 * A full SAH build - bucketed surface-area-heuristic, the thing a production
 * ray tracer does - was deliberately not written, and saying so is better than
 * leaving a future reader to assume this is the best available. SAH typically
 * buys 10-30% on traversal for scenes with wildly varying triangle sizes. This
 * scene is architectural: decks, walls, railings, ground, all tessellated to
 * roughly uniform size, which is the case where median split is already close
 * to optimal. The bake is minutes, not milliseconds, and it runs offline. If
 * the bake ever becomes the bottleneck, bucketed SAH on the split axis is the
 * first thing to reach for and it drops in here without touching traversal.
 */
export function buildBvh(triangles: TriangleSoup): Bvh {
  if (triangles.length === 0 || triangles.length % 9 !== 0) {
    throw new Error(
      `bvh: buildBvh needs a positive multiple of 9 floats (9 per triangle), ` +
        `got ${triangles.length}`,
    )
  }

  const triangleCount = triangles.length / 9
  const centroids = new Float32Array(triangleCount * 3)
  for (let t = 0; t < triangleCount; t += 1) {
    const s = t * 9
    centroids[t * 3] = (triangles[s] + triangles[s + 3] + triangles[s + 6]) / 3
    centroids[t * 3 + 1] = (triangles[s + 1] + triangles[s + 4] + triangles[s + 7]) / 3
    centroids[t * 3 + 2] = (triangles[s + 2] + triangles[s + 5] + triangles[s + 8]) / 3
  }

  const indices = new Int32Array(triangleCount)
  for (let t = 0; t < triangleCount; t += 1) indices[t] = t

  /*
    Every leaf holds at least one triangle and every interior node has exactly
    two children, so a tree over n triangles has at most n leaves and therefore
    at most 2n - 1 nodes. Allocating that bound up front avoids a growth path in
    the middle of the build; the arrays are sliced down to the real size at the
    end, which copies once.
  */
  const maxNodes = 2 * triangleCount
  const bounds = new Float32Array(maxNodes * 6)
  const meta = new Int32Array(maxNodes * 2)
  // Node 0 is the root and is claimed up front, because `fill` writes into a
  // slot that has already been reserved rather than allocating its own.
  let nodeCount = 1
  let deepest = 0

  /*
    Fill the already-reserved node at `node` from `indices[lo, hi)`.

    The reserve-then-fill shape is load bearing, not a style choice. Traversal
    reads an interior node's right child as `left + 1`, so the two children have
    to be *adjacent* slots. The obvious recursion - let each call allocate its
    own index, then recurse left and right - does not give you that: the left
    call allocates the entire left subtree before the right child gets an index,
    so `left + 1` lands on the left child's own left child instead. Written that
    way this builds a tree that looks completely healthy - the right node count,
    a sane depth, correct leaf sizes, no throw - and then silently loses every
    triangle in roughly half the scene, because whole subtrees are unreachable
    while other subtrees get visited twice. It was caught only by the
    brute-force agreement test in bvh.test.ts, which is the entire argument for
    that test existing.
  */
  const fill = (node: number, lo: number, hi: number, depth: number): void => {
    if (depth > deepest) deepest = depth

    // Node bounds are the union of the triangle AABBs in the range, which is
    // not the same as the centroid bounds used to pick the split axis.
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = lo; i < hi; i += 1) {
      const s = indices[i] * 9
      for (let v = 0; v < 9; v += 3) {
        const x = triangles[s + v]
        const y = triangles[s + v + 1]
        const z = triangles[s + v + 2]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      }
    }
    const b = node * 6
    bounds[b] = minX
    bounds[b + 1] = minY
    bounds[b + 2] = minZ
    bounds[b + 3] = maxX
    bounds[b + 4] = maxY
    bounds[b + 5] = maxZ

    const count = hi - lo
    if (count <= LEAF_SIZE || depth >= MAX_DEPTH) {
      meta[node * 2] = lo
      meta[node * 2 + 1] = count
      return
    }

    let cMinX = Infinity
    let cMinY = Infinity
    let cMinZ = Infinity
    let cMaxX = -Infinity
    let cMaxY = -Infinity
    let cMaxZ = -Infinity
    for (let i = lo; i < hi; i += 1) {
      const c = indices[i] * 3
      const x = centroids[c]
      const y = centroids[c + 1]
      const z = centroids[c + 2]
      if (x < cMinX) cMinX = x
      if (y < cMinY) cMinY = y
      if (z < cMinZ) cMinZ = z
      if (x > cMaxX) cMaxX = x
      if (y > cMaxY) cMaxY = y
      if (z > cMaxZ) cMaxZ = z
    }
    const ex = cMaxX - cMinX
    const ey = cMaxY - cMinY
    const ez = cMaxZ - cMinZ
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2

    /*
      Split by count, not by position. If every centroid in the range is
      identical - coincident triangles, or a fan whose centroids collapse - the
      extent on the chosen axis is zero and a spatial split would put everything
      on one side and recurse forever. A median split still halves the count, so
      the tree is bounded by log2(count) levels regardless of the geometry, and
      MAX_DEPTH is a belt-and-braces stop rather than the thing doing the work.
    */
    const mid = (lo + hi) >> 1
    selectByCentroid(indices, centroids, axis, lo, hi, mid)

    const left = nodeCount
    nodeCount += 2
    meta[node * 2] = left
    meta[node * 2 + 1] = 0
    fill(left, lo, mid, depth + 1)
    fill(left + 1, mid, hi, depth + 1)
  }

  fill(0, 0, triangleCount, 0)

  // Permute the soup into leaf order. Leaf triangles are then contiguous in
  // memory, so the inner intersection loop walks forward through one cache line
  // after another instead of jumping around the original soup.
  const reordered = new Float32Array(triangles.length)
  for (let i = 0; i < triangleCount; i += 1) {
    reordered.set(triangles.subarray(indices[i] * 9, indices[i] * 9 + 9), i * 9)
  }

  /*
    Stack depth. A node pops, and if it is interior it pushes two children, so
    the stack grows by one per level descended plus one for the pair. `deepest`
    is the depth of the deepest node, so deepest + 2 is a sufficient bound; the
    extra slack costs 64 bytes and removes the need to be clever about it.
  */
  return {
    triangles: reordered,
    bounds: bounds.slice(0, nodeCount * 6),
    meta: meta.slice(0, nodeCount * 2),
    nodeCount,
    maxDepth: deepest,
    stack: new Int32Array(deepest + 16),
  }
}

/**
 * Möller-Trumbore, two-sided.
 *
 * Backface culling is deliberately absent, and this is not a performance
 * oversight - it is a correctness requirement for lightmapping. A ray leaving
 * the top of a lower deck and heading for the sky meets the deck above it from
 * *below*, hitting its underside: a back face. Cull back faces and every
 * overhang in the scene stops casting shadow, silently. The bake still
 * completes, the texture still looks plausible, and the only tell is that
 * nothing is ever in shade under anything. Two-sided costs one comparison
 * (magnitude of the determinant instead of its sign) and nothing else.
 */
function hitsTriangle(
  tris: Float32Array,
  s: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): boolean {
  const ax = tris[s]
  const ay = tris[s + 1]
  const az = tris[s + 2]
  const e1x = tris[s + 3] - ax
  const e1y = tris[s + 4] - ay
  const e1z = tris[s + 5] - az
  const e2x = tris[s + 6] - ax
  const e2y = tris[s + 7] - ay
  const e2z = tris[s + 8] - az

  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x

  const det = e1x * px + e1y * py + e1z * pz
  if (det > -DET_EPSILON && det < DET_EPSILON) return false
  const inv = 1 / det

  const tx = ox - ax
  const ty = oy - ay
  const tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return false

  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return false

  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t > T_EPSILON && t < maxDistance
}

/**
 * True if any triangle blocks the segment from `origin` along `dir` for
 * `maxDistance`.
 *
 * `t` is measured in multiples of `dir`, so `maxDistance` is only a world
 * distance if `dir` is unit length. The baker always passes a normalised
 * direction; nothing here normalises for you, because doing so would hide the
 * cost of a caller that forgot.
 *
 * Allocates nothing. The traversal stack lives on the `Bvh`, which makes
 * `occluded` non-reentrant across concurrent rays on the same `Bvh` - fine for
 * a single-threaded bake, and worth knowing before anyone reaches for workers
 * (give each worker its own `buildBvh` result, or its own stack).
 */
export function occluded(
  bvh: Bvh,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): boolean {
  if (maxDistance <= T_EPSILON) return false

  const { bounds, meta, triangles, stack } = bvh

  /*
    Precomputed reciprocals turn the slab test into two multiplies per axis, and
    they are also where the classic bug lives.

    For a direction component of exactly 0 the reciprocal is +-Infinity. NaN
    appears exactly when the numerator is also exactly 0 - that is, when the ray
    origin lies precisely on one of that slab's two boundary planes - because
    0 * Infinity is NaN. Every comparison against NaN is false, so what a NaN
    slab does to the test depends entirely on the order the comparisons are
    written in, and all three plausible orderings behave differently.

    Exact equality sounds like a measure-zero curiosity. On this geometry it is
    routine rather than rare: the scene is axis-aligned architecture, node bounds
    are therefore exact copies of vertex coordinates, and bake rays are fired
    straight up from texel centres on those same surfaces. Whole rows of texels
    sit exactly on a slab plane at once, so if this goes wrong it goes wrong in
    stripes, not in isolated pixels.

    Handled rather than avoided. The comparisons below are written so a NaN
    interval contributes no constraint at all: `t0 > t1` is false so no swap
    happens, `t0 > tMin` is false so tMin stands, `t1 < tMax` is false so tMax
    stands, and `tMin > tMax` is false so the node is not rejected. That is the
    geometrically right reading - a ray lying in a slab's boundary plane is
    inside that closed slab for every t - and it errs towards visiting a node
    that could have been skipped, never towards skipping one that could occlude.

    For honesty about the stakes: because NaN requires the origin to be at a
    slab extreme, any hit inside such a node is also at that extreme, hence on
    the boundary of a triangle - so the two wrong orderings do not punch holes in
    solid walls, they disagree on knife-edge grazes and, in one case, cost speed.
    The two rejected alternatives:

      `if (!(tMin <= tMax)) continue` rejects on NaN, so every node the origin
      touches is skipped - grazing hits are lost, silently.

      `tMin = Math.max(tMin, t0)` propagates NaN into tMin, which then poisons
      the remaining two axes and makes the node unrejectable for the rest of the
      ray. Correct answers, but it disables culling for exactly the axis-aligned
      rays that dominate a bake.

    The infinite-but-not-NaN cases need no special handling. With dx == 0 and the
    origin outside the X extent, t0 and t1 are the same infinity, so tMin or tMax
    is pinned there and the node is correctly rejected; with the origin inside,
    they are -Infinity and +Infinity and correctly constrain nothing.
  */
  const invX = 1 / dx
  const invY = 1 / dy
  const invZ = 1 / dz

  let sp = 0
  stack[sp] = 0
  sp += 1

  while (sp > 0) {
    sp -= 1
    const node = stack[sp]
    const b = node * 6

    let tMin = 0
    let tMax = maxDistance

    let t0 = (bounds[b] - ox) * invX
    let t1 = (bounds[b + 3] - ox) * invX
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1

    t0 = (bounds[b + 1] - oy) * invY
    t1 = (bounds[b + 4] - oy) * invY
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1

    t0 = (bounds[b + 2] - oz) * invZ
    t1 = (bounds[b + 5] - oz) * invZ
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1

    if (tMin > tMax) continue

    const count = meta[node * 2 + 1]
    if (count > 0) {
      const first = meta[node * 2]
      const end = (first + count) * 9
      for (let s = first * 9; s < end; s += 9) {
        // Any hit answers the question, so return immediately. This is the
        // whole reason an occlusion BVH is cheaper than a closest-hit one.
        if (hitsTriangle(triangles, s, ox, oy, oz, dx, dy, dz, maxDistance)) return true
      }
    } else {
      // No near/far ordering: without a closest-hit to shrink, visiting the
      // near child first buys nothing here.
      const left = meta[node * 2]
      stack[sp] = left
      sp += 1
      stack[sp] = left + 1
      sp += 1
    }
  }

  return false
}

/**
 * Diagnostics, so a bake can print what it actually built.
 *
 * This exists because the failure mode of a bad BVH is a bake that is merely
 * slow or merely wrong, never one that throws. A line of stats in the bake log
 * is how you find out that a degenerate soup collapsed the tree, rather than
 * wondering why the bake took an hour. Healthy output for the 34,992-triangle
 * deck scene, for comparison: 20,831 nodes, maxDepth 14, 10,416 leaves, mean
 * leaf 3.36. A maxDepth pinned at 32 or a mean leaf size well above LEAF_SIZE
 * both mean the split stopped separating anything.
 */
export function bvhStats(bvh: Bvh): {
  triangles: number
  nodes: number
  maxDepth: number
  leaves: number
  meanLeafSize: number
} {
  let leaves = 0
  let inLeaves = 0
  for (let node = 0; node < bvh.nodeCount; node += 1) {
    const count = bvh.meta[node * 2 + 1]
    if (count > 0) {
      leaves += 1
      inLeaves += count
    }
  }
  return {
    triangles: bvh.triangles.length / 9,
    nodes: bvh.nodeCount,
    maxDepth: bvh.maxDepth,
    leaves,
    meanLeafSize: leaves === 0 ? 0 : inLeaves / leaves,
  }
}
