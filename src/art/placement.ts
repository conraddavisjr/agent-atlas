/**
 * Scattering things across the ground.
 *
 * The important function here is the clustered one. Evenly spreading ground
 * cover is the obvious approach and it is wrong: a uniform distribution reads
 * as a texture, because the eye finds no structure in it and gives up. Real
 * ground cover grows in patches, and patches are what make a field look like
 * somewhere rather than like a surface.
 *
 * Shared by the grass, the flowers and the scatter so all three agree about
 * where the bare ground is. Three independently random layers would fill every
 * gap the others left and average back out to uniform, which is exactly the
 * look this exists to avoid.
 */

/**
 * An area nothing is planted in.
 *
 * Two shapes, because the level has both. A circle is the right description of
 * a puck, a plinth or a pylon foot. A rectangle is the right description of a
 * deck, and describing one with a circle is not merely imprecise: clearing the
 * 12 x 4 approach deck with a circle needs radius 7.0 and therefore also strips
 * three metres of lawn at each corner that nothing was ever going to grow
 * through. Four bare corners on the biggest deck in the scene is visible.
 *
 * Discriminated by the presence of `radius` rather than by a tag field, so
 * every existing circle literal in the codebase keeps type-checking unchanged.
 */
export type Exclusion = CircleExclusion | RectExclusion

export type CircleExclusion = {
  /** Centre on the ground plane. */
  x: number
  z: number
  /** Nothing is placed within this distance of the centre. */
  radius: number
}

export type RectExclusion = {
  /** Centre on the ground plane. */
  x: number
  z: number
  /** Half-extent along the rectangle's own X axis. */
  halfX: number
  /** Half-extent along the rectangle's own Z axis. */
  halfZ: number
  /** Yaw of the rectangle about the vertical axis, in radians. */
  rotation?: number
}

export type Placement = {
  x: number
  z: number
  /** Rotation about the vertical axis. */
  yaw: number
  /** Multiplier on whatever base size the caller uses. */
  scale: number
  /**
   * How close to the middle of its patch this one landed, from 0 at the edge
   * to 1 at the centre.
   *
   * Callers use it to make patches denser and taller in the middle, which is
   * what stops a cluster reading as a disc of evenly spaced objects.
   */
  density: number
}

/**
 * Deterministic pseudo-random.
 *
 * Placement must not reshuffle between reloads or between the visual and any
 * later pass that has to agree with it. Math.random gives a world that
 * rearranges itself every time a scene remounts, which is visible as the ground
 * changing behind a portal transition.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isBlocked(x: number, z: number, exclusions: Exclusion[]) {
  for (const e of exclusions) {
    const dx = x - e.x
    const dz = z - e.z
    if ('radius' in e) {
      if (dx * dx + dz * dz < e.radius * e.radius) return true
      continue
    }
    // Rotate the point into the rectangle's own frame rather than rotating the
    // rectangle. One sin and one cos against four corner transforms, and the
    // inside test is then two comparisons.
    let lx = dx
    let lz = dz
    if (e.rotation) {
      const s = Math.sin(-e.rotation)
      const c = Math.cos(-e.rotation)
      lx = dx * c - dz * s
      lz = dx * s + dz * c
    }
    if (Math.abs(lx) < e.halfX && Math.abs(lz) < e.halfZ) return true
  }
  return false
}

export type CentreOptions = {
  /** How many patches to spread items across. */
  clusters: number
  /** Outer radius of the plantable area, and the default outer centre bound. */
  radius: number
  /** Innermost radius a patch centre may land on. */
  centreMinRadius?: number
  /** Outermost radius a patch centre may land on. Defaults to `radius`. */
  centreMaxRadius?: number
  seed: number
}

/**
 * Where the patches are, on their own.
 *
 * Exported so two layers can share one set of centres, which is the difference
 * between pebbles that pool around the boulders and pebbles sprinkled over the
 * whole island. Two independently sampled layers average back out to uniform,
 * which is the failure this whole module exists to avoid, and it is a failure
 * that reads as clutter rather than as an obvious bug.
 *
 * Sampled in an annulus rather than over the whole disc. The naive form,
 * `sqrt(rand()) * radius`, is uniform per unit area over a full disc and has no
 * way to express "patches belong at the rim". Asking for boulder clumps between
 * radius 10 and 13.5 with that form puts most centres in the middle of the
 * island, every member of those clumps then fails the `minRadius` test one at a
 * time, and the caller silently gets a third of what it asked for with a count
 * that moves whenever the seed does.
 *
 * The annulus form below is the same uniform-per-unit-area property restricted
 * to the ring: the CDF of radius on an annulus is (r^2 - a^2) / (b^2 - a^2), so
 * inverting it is exactly the square root of a linear interpolation between the
 * two squared radii.
 */
export function clusterCentres({
  clusters,
  radius,
  centreMinRadius = 0,
  centreMaxRadius,
  seed,
}: CentreOptions): [number, number][] {
  const rand = mulberry32(seed)
  const rMin = Math.max(0, centreMinRadius)
  const rMax = Math.max(rMin, centreMaxRadius ?? radius)

  const centres: [number, number][] = []
  for (let i = 0; i < clusters; i++) {
    const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin))
    const a = rand() * Math.PI * 2
    centres.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return centres
}

export type ClusterOptions = {
  /** How many to place, at most. Exclusion can only ever reduce this. */
  count: number
  /** Outer radius of the plantable area. */
  radius: number
  /**
   * How many patches to spread them across.
   *
   * Ignored when `centres` is supplied, which is the only case where it may be
   * left out.
   */
  clusters?: number
  /** Radius of a single patch. */
  clusterRadius: number
  /**
   * Reuse centres from another layer instead of sampling new ones.
   *
   * The point is not to save the sampling. It is that two layers sharing
   * centres read as one event - a boulder that broke and left its debris - and
   * two layers with their own centres read as two unrelated sprinklings.
   */
  centres?: [number, number][]
  /** Innermost radius a patch centre may land on. See `clusterCentres`. */
  centreMinRadius?: number
  /** Outermost radius a patch centre may land on. Defaults to `radius`. */
  centreMaxRadius?: number
  exclusions?: Exclusion[]
  seed: number
  /** Scale range, before per-instance variation. */
  minScale?: number
  maxScale?: number
  /** Keep the middle of the island clear, for paths and set pieces. */
  minRadius?: number
}

/**
 * Place items in patches rather than evenly.
 *
 * Cluster centres are scattered first, then members are placed around them with
 * a bias toward the middle. The bias matters as much as the clustering: without
 * it a patch is a uniformly filled disc with a hard edge, which reads as
 * artificial in a different way. Taking the smaller of two random radii is a
 * cheap way to get a soft falloff, and it costs one extra call to the generator
 * rather than a distribution function.
 */
export function clusteredPlacements({
  count,
  radius,
  clusters = 0,
  clusterRadius,
  centres: sharedCentres,
  centreMinRadius,
  centreMaxRadius,
  exclusions = [],
  seed,
  minScale = 0.7,
  maxScale = 1.3,
  minRadius = 0,
}: ClusterOptions): Placement[] {
  const out: Placement[] = []

  const centres =
    sharedCentres ??
    clusterCentres({ clusters, radius, centreMinRadius, centreMaxRadius, seed })
  if (centres.length === 0) return out

  /*
    Decorrelated from the centre stream on purpose. `clusterCentres` runs its
    own generator from the same seed, so drawing members from `mulberry32(seed)`
    would make the nth member's radius the same number as the nth centre's
    radius, and a layer whose members mirror the shape of its own centres has a
    structure nobody asked for. The constant is the golden-ratio hash three and
    most of the noise literature use for exactly this.
  */
  const rand = mulberry32(seed ^ 0x9e3779b9)

  const perCluster = Math.ceil(count / centres.length)

  for (const [cx, cz] of centres) {
    /*
      Bounded retries rather than one attempt per member.

      Without this a member rejected for straying past the island edge or into a
      deck is simply lost, so a patch that overlaps anything comes back thinner
      than its neighbours and the caller's count becomes a suggestion. Four
      attempts is enough to fill a patch that is half blocked and is still a
      hard bound, so a fully blocked area comes back empty rather than hanging.
    */
    let placed = 0
    for (let attempt = 0; attempt < perCluster * 4 && placed < perCluster; attempt++) {
      if (out.length >= count) return out

      // The smaller of two samples, which concentrates members toward the
      // centre and leaves the edge of a patch thinning out rather than stopping.
      const t = Math.min(rand(), rand())
      const r = t * clusterRadius
      const a = rand() * Math.PI * 2
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r

      const distance = Math.hypot(x, z)
      if (distance > radius || distance < minRadius) continue
      if (isBlocked(x, z, exclusions)) continue

      placed++
      out.push({
        x,
        z,
        yaw: rand() * Math.PI * 2,
        scale: minScale + rand() * (maxScale - minScale),
        // Inverted, so 1 is the middle of the patch.
        density: 1 - t,
      })
    }
  }

  return out
}

export type ScatterOptions = {
  count: number
  radius: number
  exclusions?: Exclusion[]
  seed: number
  minScale?: number
  maxScale?: number
  minRadius?: number
}

/**
 * Place items evenly across the area.
 *
 * Still the right tool for things that are genuinely sparse and unrelated to
 * each other, such as boulders. Patches only help where a thing grows in
 * patches.
 */
export function evenPlacements({
  count,
  radius,
  exclusions = [],
  seed,
  minScale = 0.6,
  maxScale = 1.4,
  minRadius = 0,
}: ScatterOptions): Placement[] {
  const rand = mulberry32(seed)
  const out: Placement[] = []

  // Bounded rather than "until we have enough", so heavy exclusion can only
  // thin the result, never hang the load.
  for (let attempt = 0; attempt < count * 6 && out.length < count; attempt++) {
    // sqrt keeps the distribution even per unit area. Sampling the radius
    // uniformly instead crowds everything into the middle.
    const r = Math.sqrt(rand()) * radius
    if (r < minRadius) continue
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (isBlocked(x, z, exclusions)) continue

    out.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      scale: minScale + rand() * (maxScale - minScale),
      density: 1,
    })
  }

  return out
}
