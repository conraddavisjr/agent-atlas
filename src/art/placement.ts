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

export type Exclusion = {
  /** Centre on the ground plane. */
  x: number
  z: number
  /** Nothing is placed within this distance of the centre. */
  radius: number
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
    if (dx * dx + dz * dz < e.radius * e.radius) return true
  }
  return false
}

export type ClusterOptions = {
  /** How many to place, at most. Exclusion can only ever reduce this. */
  count: number
  /** Outer radius of the plantable area. */
  radius: number
  /** How many patches to spread them across. */
  clusters: number
  /** Radius of a single patch. */
  clusterRadius: number
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
  clusters,
  clusterRadius,
  exclusions = [],
  seed,
  minScale = 0.7,
  maxScale = 1.3,
  minRadius = 0,
}: ClusterOptions): Placement[] {
  const rand = mulberry32(seed)
  const out: Placement[] = []

  // Patch centres. Sampled on sqrt so the patches themselves are spread evenly
  // per unit area rather than crowding into the middle of the island.
  const centres: [number, number][] = []
  for (let i = 0; i < clusters; i++) {
    const r = Math.sqrt(rand()) * radius
    const a = rand() * Math.PI * 2
    centres.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  if (centres.length === 0) return out

  const perCluster = Math.ceil(count / centres.length)

  for (const [cx, cz] of centres) {
    for (let i = 0; i < perCluster && out.length < count; i++) {
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
