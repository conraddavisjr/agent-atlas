/**
 * The confetti burst: a fixed pool, simulated on the CPU, drawn as one instanced
 * mesh.
 *
 * ## The brief's own constraint is the design
 *
 * "Make sure that there are not too many confettis so it doesn't create a major
 * slowdown in FPS." A pool with a hard ceiling is the direct answer: the cost is
 * decided once, at construction, and no combination of events can exceed it. A
 * spawner that allocated per burst would have its cost decided by how many times
 * the player wins, which is not a number anyone controls.
 *
 * ## Typed arrays, and no allocation per frame
 *
 * Parallel `Float32Array`s rather than an array of objects, for the reason
 * `robotAnim.ts` gives about its event ring: the alternative is either allocating
 * an object per particle - garbage at exactly the moment the game is busiest - or
 * a pool of objects, which is the same thing with more bookkeeping.
 *
 * ## NOT additive, and that is a rule rather than a preference
 *
 * `00-art-bible.md` permits additive blending only for energy effects and bans it
 * for dust, because "a dense cluster of individually dim additive quads sums past
 * the threshold and produces a white blob". A hundred overlapping pieces of
 * confetti is the exact case that ban was written for. This is debris: normal
 * blending, opaque, no glow.
 */

/** How many pieces exist, ever. */
export const BURST_CAPACITY = 120

export type Burst = {
  x: Float32Array
  y: Float32Array
  z: Float32Array
  vx: Float32Array
  vy: Float32Array
  vz: Float32Array
  /** Current spin, radians, about the piece's own tumbling axis. */
  spin: Float32Array
  spinRate: Float32Array
  /** Seconds remaining. Zero means the slot is free. */
  life: Float32Array
  /** Seconds this piece started with, so a fade can be normalised. */
  born: Float32Array
  /** Index into the palette, so colour is one byte rather than three floats. */
  tint: Uint8Array
  /** Highest slot ever used, so the renderer can skip the tail. */
  live: number
}

export function createBurst(capacity: number = BURST_CAPACITY): Burst {
  const f = () => new Float32Array(capacity)
  return {
    x: f(), y: f(), z: f(),
    vx: f(), vy: f(), vz: f(),
    spin: f(), spinRate: f(),
    life: f(), born: f(),
    tint: new Uint8Array(capacity),
    live: 0,
  }
}

/** Gravity on a piece of confetti. Gentler than the player's, because paper. */
export const BURST_GRAVITY = -5.4

/**
 * Air drag, per second.
 *
 * The single most important number for making this read as paper rather than as
 * gravel. Without it every piece follows a clean parabola and the burst looks like
 * a shrapnel diagram; with it they shed their speed fast and then flutter down,
 * which is what confetti does.
 */
export const BURST_DRAG = 1.9

export const BURST_LIFE = { min: 1.5, max: 2.6 } as const
export const BURST_SPEED = { min: 2.2, max: 5.4 } as const

/**
 * Fill the pool from one point.
 *
 * `random` is passed in rather than taken from `Math.random`, so a burst is
 * reproducible - which the capture harness needs, since it pins the clock and
 * expects the same picture twice. `mulberry32` from `art/placement.ts` is the
 * project's seeded generator.
 *
 * Overwrites the whole pool rather than finding free slots. There is exactly one
 * burst in this round and it happens once; a free-list would be machinery for a
 * case that does not exist.
 */
export function seedBurst(
  burst: Burst,
  origin: readonly [number, number, number],
  random: () => number,
  palette: number,
): void {
  const n = burst.life.length
  for (let i = 0; i < n; i++) {
    /*
      Direction: biased UPWARD and outward rather than spherical. A burst that
      threw a third of its pieces straight at the floor would have a third of its
      budget land and vanish in half a second.
    */
    const theta = random() * Math.PI * 2
    const lift = 0.35 + random() * 0.65
    const flat = Math.sqrt(Math.max(0, 1 - lift * lift))
    const speed = BURST_SPEED.min + random() * (BURST_SPEED.max - BURST_SPEED.min)

    burst.x[i] = origin[0]
    burst.y[i] = origin[1]
    burst.z[i] = origin[2]
    burst.vx[i] = Math.cos(theta) * flat * speed
    burst.vy[i] = lift * speed
    burst.vz[i] = Math.sin(theta) * flat * speed

    burst.spin[i] = random() * Math.PI * 2
    // Signed, so pieces tumble both ways. All one way reads as a machine.
    burst.spinRate[i] = (random() * 2 - 1) * 9
    const life = BURST_LIFE.min + random() * (BURST_LIFE.max - BURST_LIFE.min)
    burst.life[i] = life
    burst.born[i] = life
    burst.tint[i] = Math.floor(random() * palette) % palette
  }
  burst.live = n
}

/**
 * Advance every live piece by one frame.
 *
 * Returns the number still alive, so the renderer can stop drawing when the burst
 * is over rather than pushing a hundred zero-scaled instances forever.
 */
export function stepBurst(burst: Burst, dt: number): number {
  if (burst.live === 0) return 0
  // Clamped for the same reason every other integrator here is: a backgrounded
  // tab hands back one enormous delta, and an unclamped step would fire the whole
  // burst off the top of the screen between two frames.
  const step = Math.min(dt, 1 / 20)
  const drag = Math.max(0, 1 - BURST_DRAG * step)

  let alive = 0
  for (let i = 0; i < burst.live; i++) {
    if (burst.life[i] <= 0) continue

    burst.vx[i] *= drag
    burst.vy[i] = burst.vy[i] * drag + BURST_GRAVITY * step
    burst.vz[i] *= drag

    burst.x[i] += burst.vx[i] * step
    burst.y[i] += burst.vy[i] * step
    burst.z[i] += burst.vz[i] * step
    burst.spin[i] += burst.spinRate[i] * step

    burst.life[i] -= step
    if (burst.life[i] > 0) alive++
    else burst.life[i] = 0
  }

  if (alive === 0) burst.live = 0
  return alive
}

/**
 * How opaque a piece is, from its remaining life.
 *
 * Held at full for most of its life and faded only at the end, so the burst reads
 * as confetti that lands rather than as confetti that dissolves. A linear fade from
 * birth makes every piece a ghost by the halfway point, which is when they are
 * spread widest and most worth seeing.
 */
export function burstOpacity(burst: Burst, i: number): number {
  if (burst.born[i] <= 0) return 0
  const remaining = burst.life[i] / burst.born[i]
  return Math.min(1, remaining / 0.3)
}
