/**
 * Animation state shared between the character controller and the robot mesh.
 *
 * Kept in its own module rather than alongside the component so that RobotModel
 * exports only components, which is what keeps fast refresh working for it.
 *
 * This is a mutable object rather than props on purpose. The controller writes to
 * it every physics step and the model reads it every frame; routing those values
 * through React would re-render the whole robot sixty times a second for data
 * that only ever drives matrix updates.
 */
export type RobotAnimState = {
  /** Horizontal speed normalised to 0..1 against max speed. */
  speedNorm: number
  /**
   * Turn rate normalised to -1..1, negative left, taken from the input rather
   * than from velocity.
   *
   * This exists because `speedNorm` cannot describe a turn on the spot. It is
   * derived from world velocity, and a robot pivoting in place has none, so
   * under tank controls the entire animation system saw a stationary character
   * and played nothing: the robot rotated with its feet planted, like a turret.
   */
  turnNorm: number
  /**
   * Signed drive input, -1 full reverse to 1 full forward.
   *
   * Separate from `speedNorm`, which is unsigned, so the model can tell reversing
   * from advancing and lean the right way instead of always leaning forward.
   */
  throttle: number
  grounded: boolean
  verticalVelocity: number
  /**
   * The DEPTH of the most recent squash impulse. 1 is neutral, below 1 is
   * squashed, above 1 is stretched.
   *
   * No longer the live value. The controller used to integrate this field back
   * toward neutral in its own frame loop; the spring now lives in the solver,
   * where it can be tested and where it can share one recovery with the eleven
   * other joints a landing moves. So this is the impulse channel: the
   * controller states how deep, in which profile, and the solver owns
   * everything after that.
   */
  squash: number
  /** Which spring profile recovers the impulse. */
  squashMode: SquashMode
  /**
   * Bumped on every impulse.
   *
   * Without it, two landings of identical depth in a row are indistinguishable
   * from one landing still recovering, and the second one would not re-seed the
   * spring. The old code got away with the ambiguity because it zeroed the
   * velocity on the same line it set the depth; making the edge explicit is
   * what lets the solver be a pure function of the state it is handed.
   */
  squashSeq: number

  /**
   * The authoritative heading, in radians.
   *
   * Already tracked in a ref inside PlayerController. Publishing it is what
   * lets the contact shadow orient its elongation and the VFX emitters aim,
   * without either of them reading it back off the follow target.
   */
  facing: number
  /** Actual d(facing)/dt, so a turn snap is detectable without differentiating in the solver. */
  turnRate: number

  /**
   * Thruster burn remaining, in SECONDS, counting down. Zero means not burning.
   *
   * Published rather than recomputed because the beams and the physics have to
   * agree exactly: the burn is what reduces gravity, so a VFX that ran on its own
   * timer would drift out of step with the lift it is supposed to be causing, and
   * the two would disagree by a frame or two in a way that reads as the effect
   * being decorative. There is one clock and this is it.
   *
   * Seconds rather than a normalised 0-to-1 ramp, so a consumer can shape its own
   * curve against `AIR_JUMP.thrustTime` without this field having to guess which
   * curve. `FootThrusters` wants a fast attack and a slow release; the pose solver
   * wants something else.
   */
  thrust: number
  /**
   * Seconds since the burn STARTED, counting up and past its end.
   *
   * The VFX channel, where `thrust` is the physics one, and the two exist
   * separately because the flame deliberately outlives the force: the gravity cut
   * ends at `AIR_JUMP.thrustTime` and the beam holds for a further 110 ms so it
   * shuts down rather than vanishing in a frame. See `THRUSTER.decay`.
   *
   * Gating a beam on `thrust > 0` makes that impossible to express, which is the
   * whole reason this field is here rather than the VFX doing arithmetic on the
   * other one. It is reset by the air jump and left to run afterwards; nothing
   * stops it, because `thrusterEnvelope` returns zero past the total life and an
   * ever-growing float is cheaper than a branch that has to know when to stop.
   */
  thrustAge: number
  /** Seconds since leaving the ground, 0 while grounded. */
  airTime: number
  /** Seconds since landing, 0 while airborne. */
  groundTime: number

  /** The body translation, copied once per step so no consumer calls into Rapier. */
  worldX: number
  worldY: number
  worldZ: number
  /** World velocity, copied. Drives the cape's drag and the antenna's inertia. */
  velX: number
  velY: number
  velZ: number

  /** True through the arrival fall, so the face can play surprised on landing. */
  reviving: boolean

  /** The one-shot channel. See the ring's own doc comment for why it is shaped this way. */
  events: AnimEventRing
}

/**
 * Which spring recovers a squash.
 *
 * Three rather than one because the beats are genuinely different: a landing
 * should snap, a takeoff stretch should read through the whole rise, and the
 * revival wants the slowest and loosest of the three so the arrival lands as a
 * bounce rather than as a correction.
 */
export type SquashMode = 'land' | 'takeoff' | 'revival'

export function createRobotAnimState(): RobotAnimState {
  return {
    speedNorm: 0,
    turnNorm: 0,
    throttle: 0,
    grounded: true,
    verticalVelocity: 0,
    squash: 1,
    squashMode: 'land',
    squashSeq: 0,
    facing: 0,
    turnRate: 0,
    thrust: 0,
    thrustAge: Infinity,
    airTime: 0,
    groundTime: 0,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    velX: 0,
    velY: 0,
    velZ: 0,
    reviving: true,
    events: createAnimEventRing(),
  }
}

/**
 * Fires a squash impulse. The only supported way to write the three fields,
 * because writing `squash` without bumping `squashSeq` is a no-op the type
 * system cannot catch.
 */
export function pushSquash(s: RobotAnimState, depth: number, mode: SquashMode): void {
  s.squash = depth
  s.squashMode = mode
  s.squashSeq++
}

// ---------------------------------------------------------------------------
// The one-shot event channel
// ---------------------------------------------------------------------------

/** Power of two, so the slot index is a mask rather than a modulo. */
export const ANIM_EVENT_CAPACITY = 64

export const EV = {
  None: 0,
  Jump: 1,
  Land: 2,
  Footstep: 3,
  Revive: 4,
  Death: 5,
  Collect: 6,
  PortalEnter: 7,
  TotemFocus: 8,
  Bonk: 9,
  TurnSnap: 10,
  /**
   * The second jump fired. Distinct from `Jump` rather than a flag on it.
   *
   * A consumer that wants both gets both by listening for two kinds, which is one
   * extra case in a switch. A consumer that wants only the boost - the thruster
   * flash, the different launch sound - would otherwise have to read the payload
   * to find out whether the event was for it, and every such consumer would have
   * to agree on which payload slot carried the flag.
   */
  AirJump: 11,
} as const
export type AnimEventKind = (typeof EV)[keyof typeof EV]

/**
 * One-shot events, as parallel typed arrays rather than objects.
 *
 * Typed arrays because the alternative is either allocating an event object per
 * push, which is garbage at exactly the moments the game is busiest, or a pool
 * of pre-allocated objects, which is the same thing with more bookkeeping.
 *
 * `head` is a monotonically increasing counter that is never wrapped; the slot
 * is `head & (CAPACITY - 1)`. That is what lets several consumers each hold
 * their own cursor without coordinating, and it makes "has this consumer fallen
 * behind" a subtraction rather than a modular comparison.
 *
 * The point of the design, stated flatly: when a landing needs a deeper squash,
 * a dust ring and a screen shake, that is ONE push and three consumers. There
 * is no second event system, no callback registry, and no effect bridging
 * gameplay to particles. The animation solver holds one cursor and the VFX
 * system will hold another, and neither knows about the other.
 */
export type AnimEventRing = {
  kind: Uint8Array
  /** Emission point, world space. */
  x: Float32Array; y: Float32Array; z: Float32Array
  /** Surface normal, or a direction, depending on kind. Unit length. */
  nx: Float32Array; ny: Float32Array; nz: Float32Array
  /** Primary magnitude, normalised 0..1 unless a kind says otherwise. */
  a: Float32Array
  /** Secondary scalar. Kind-specific: foot index, reward hue, and so on. */
  b: Float32Array
  /**
   * Scaled-clock timestamp of the emission.
   *
   * Every event carries its own, so consumer ORDER DOES NOT MATTER. A particle
   * emitter seeds from `t[slot]` rather than from the current frame time, so if
   * the VFX system's frame callback happens to run before the character's on
   * some frame, the arc is still identical. That is what makes it safe to leave
   * the two unordered, and it is why nothing here reaches for react-three-fiber's
   * `renderPriority`: passing a non-zero priority to any useFrame disables
   * automatic rendering for the whole canvas and makes the caller responsible
   * for gl.render, so using it to fix an ordering problem the timestamps have
   * already solved would black-screen the game.
   */
  t: Float32Array
  /** Total pushes ever. The slot is `head & (CAPACITY - 1)`. */
  head: number
  /** Incremented when a consumer had to fast-forward past unread events. */
  dropped: number
}

export function createAnimEventRing(): AnimEventRing {
  const n = ANIM_EVENT_CAPACITY
  return {
    kind: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n),
    a: new Float32Array(n),
    b: new Float32Array(n),
    t: new Float32Array(n),
    head: 0,
    dropped: 0,
  }
}

/** Never fails, never allocates. Overwrites the oldest slot when full. */
export function pushEvent(
  r: AnimEventRing,
  kind: AnimEventKind,
  t: number,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  a: number, b: number,
): void {
  const i = r.head & (ANIM_EVENT_CAPACITY - 1)
  r.kind[i] = kind
  r.x[i] = x; r.y[i] = y; r.z[i] = z
  r.nx[i] = nx; r.ny[i] = ny; r.nz[i] = nz
  r.a[i] = a
  r.b[i] = b
  r.t[i] = t
  r.head++
}

/**
 * Advances `cursor` to `head`, calling `fn` for each event in order, and
 * returns the new cursor.
 *
 * A consumer more than CAPACITY behind has had events overwritten under it, so
 * it fast-forwards to the oldest slot still valid and counts the loss. That is
 * the correct trade for a cosmetic channel: a dropped dust puff is nothing, and
 * a system that blocks the producer to avoid one is a bug. At 60 Hz a consumer
 * would have to stall for sixteen frames to overflow sixty-four slots, which
 * only happens when a tab is backgrounded, in which case dropping is exactly
 * right.
 *
 * `head` is read once up front, so an event pushed from inside the callback is
 * delivered on the NEXT drain rather than re-entrantly during this one.
 *
 * The context is passed through rather than captured, so a consumer can use a
 * module-level callback with a stable identity instead of allocating a closure
 * every frame.
 */
export function drainEvents<C>(
  r: AnimEventRing,
  cursor: number,
  fn: (r: AnimEventRing, slot: number, ctx: C) => void,
  ctx: C,
): number {
  const head = r.head
  let from = cursor
  const behind = head - from
  if (behind > ANIM_EVENT_CAPACITY) {
    r.dropped += behind - ANIM_EVENT_CAPACITY
    from = head - ANIM_EVENT_CAPACITY
  }
  for (let i = from; i < head; i++) {
    fn(r, i & (ANIM_EVENT_CAPACITY - 1), ctx)
  }
  return head
}
