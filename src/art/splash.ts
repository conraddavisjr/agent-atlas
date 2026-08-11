import { BufferAttribute, BufferGeometry, Color } from 'three'
import { linearLuma } from './materials'

/**
 * The splash the character makes stepping into the junction pool.
 *
 * ## Why this is NOT the pooled particle system, which is the scope decision
 *
 * `docs/design/05-character-vfx.md` sections 9 to 11 specify a general pooled
 * particle system. It was designed and never built, and it is **deliberately left
 * unclaimed by this file** rather than half-built. Three things decided that, and
 * only the third is about effort.
 *
 * **It has no budget to run in, and the budget is not mine to write.**
 * `quality.particleBudget` is 0 at low, medium AND high, and `vfxDetail` is
 * `'off'` at all three - so a general system would need its per-tier numbers
 * invented, and `src/art/quality.ts` belongs to another hand this pass. A pooled
 * emitter gated on a budget of zero is worse than no emitter: it renders nothing,
 * reports nothing, and looks finished. That is the exact silent-failure shape
 * `MEMORY.md` records this codebase breaking by, and it is why this effect is
 * gated on nothing at all instead. See `splashCost` for what that costs.
 *
 * **The case is unusually constrained, and a general system's generality is
 * therefore all cost.** A pooled system exists to serve emitters whose count,
 * lifetime, spawn volume and blend mode are not known until runtime. Every one of
 * those is known here at authoring time: fourteen droplets, 0.62 s, from a known
 * surface height, triggered by one capsule crossing one circle. What is left of a
 * pooling argument when the pool has one client and a fixed size is a fixed-size
 * buffer, which is what this is.
 *
 * **And a general system would inherit the harder half of the art bible's
 * section 1**, which this does not. That section's rule is that "dust and debris
 * use NormalBlending with alpha. Only energy effects use AdditiveBlending, and
 * only those may carry colours above 1.0. A dense cluster of individually dim
 * additive dust will otherwise cross the threshold and produce a white blob." A
 * general system has to enforce that against callers it cannot see. Water thrown
 * off a boot is debris, so this file takes NormalBlending and a colour under 1.0
 * and **cannot cross the bloom threshold by construction rather than by
 * discipline** - `splashPeakLuminance` proves it and `splash.test.ts` asserts it.
 *
 * The honest cost of choosing the targeted effect: when the second and third
 * splash-shaped things arrive - the character landing on the lawn, the cave's
 * drips - this file is a template rather than a system, and somebody will have to
 * generalise it or copy it. Copying it twice would be the wrong answer and this
 * note is where that gets caught.
 *
 * ## What it is made of
 *
 * One mesh, one draw call, thirty triangles. Fourteen billboarded droplet
 * quads on ballistic arcs, plus one flat quad on the water surface carrying an
 * expanding ring - and the ring is the part that actually reads, because at 33.8
 * degrees of camera depression the water surface is nearly face-on and a droplet
 * 0.17 m up is 15 px of travel. A splash seen from above is a ring first and a
 * spray second.
 */

/**
 * The pale of thrown water, and it is `WATER_FOAM`'s hex rather than a new one.
 *
 * Held to the meniscus colour on purpose: the droplets are the same entrained air
 * and surface curvature that make the bank line pale, so a second value here would
 * be two answers to one question. Display luma 0.8495, which is bright - and
 * allowed to be, because the area is a few dozen pixels and because
 * NormalBlending with a colour under 1.0 has no route to the bloom tier whatever
 * its value.
 */
const SPLASH_COLOUR = '#c2dee6'

export const SPLASH = {
  /**
   * Droplets in the ring.
   *
   * Fourteen is where the ring stops reading as countable. Below about ten the eye
   * resolves individual quads and the effect reads as a mechanism; above twenty the
   * extra ones land inside their neighbours and cost triangles for nothing, because
   * they all share one origin and one lifetime.
   */
  droplets: 14,
  /** Seconds from trigger to nothing left. Short: this is a step, not an event. */
  life: 0.62,
  /** How far the droplet ring travels outward, in metres, before it dies. */
  spread: 0.52,
  /** Peak droplet height. Deliberately under the capsule's radius so nothing
      appears to pass through the character's shins. */
  rise: 0.17,
  /** Droplet quad half size at birth. */
  size: 0.055,
  /** How far the flat surface ring expands. Wider than the spray, as a real one is. */
  ringRadius: 0.68,
  /** The ring's own share of the lifetime. It outlives the spray slightly. */
  ringLife: 0.78,
  /** Lifted off the water surface so the ring cannot z-fight the pool it sits on. */
  ringLift: 0.008,
  /**
   * Metres of hysteresis on the pool's PLAN boundary. Not on its height - see below.
   *
   * Without it the trigger chatters. The character controller runs a fixed 1/60 s
   * step with a `vy` of -1 pressed into the ground while grounded, so a capsule
   * walking the rim sits within a millimetre or two of the plan boundary for several
   * consecutive frames and a bare inside/outside test fires a splash on each one.
   * 0.06 m is comfortably more than any per-frame jitter and comfortably less than
   * the 0.18 m the capsule has to travel inside the rim before it touches the floor
   * at all, so it cannot swallow a real entry.
   *
   * **It is deliberately NOT applied to the height test, and applying it there was a
   * real bug rather than a hypothetical one.** The first version slackened both, and
   * the arithmetic makes that unconditionally fatal: the height threshold sits midway
   * between standing on the deck and standing on the floor, which are `POOL.depth`
   * apart - 0.05 m - so a slack of 0.06 demands the capsule be lower than the pool is
   * deep. The splash could never fire, at any speed, from any direction. It was
   * caught by a unit test asserting the plainest possible case, which is the reason
   * `inPool` is a pure function rather than four lines inside a `useFrame`.
   *
   * The height test needs no hysteresis of its own because the midpoint placement IS
   * its hysteresis: it sits 0.025 m from both stable states, which is two orders of
   * magnitude more than the sub-millimetre jitter a fixed step with snap-to-ground
   * produces. There is no third height for the capsule to rest at.
   */
  hysteresis: 0.06,
  /**
   * Speed, in m/s, at which an entry makes a full-strength splash.
   *
   * `MOVE.runSpeed` territory rather than a walk, so strolling in produces a small
   * one. Floored rather than scaled from zero: a character that steps in at a
   * crawl still displaces water, and a splash that fades to nothing at low speed
   * reads as the effect failing to fire.
   */
  fullSpeed: 4.5,
  /** Strength floor, so a slow entry still splashes. */
  minStrength: 0.42,
} as const

/**
 * The pool boundary the trigger tests against, in world units.
 *
 * Expressed as a COLLIDER-CENTRE height rather than as a sole height, because that
 * is what the player's transform actually carries and converting it here would mean
 * this file knowing `BODY.capsuleHalfHeight`. `HubIsland.tsx` owns that conversion,
 * which keeps `src/art` free of any import from `src/game/player`.
 */
export type PoolBounds = {
  centreX: number
  centreZ: number
  /** Plan radius of the water. */
  radius: number
  /**
   * The collider-centre height at or below which the capsule is standing in the
   * recess rather than on the deck around it.
   *
   * A CEILING rather than a window, which is what makes a jump into the pool fire
   * as well as a walk: the capsule descends through this height on its way down and
   * there is nothing below the floor for it to fall past.
   */
  standingY: number
}

/**
 * Is the capsule standing in the pool?
 *
 * Pure, and separated from the component for one reason: the sign and the
 * bracketing of this test are the whole effect. A splash that never fires and a
 * splash that fires every frame both look like "the splash is broken" in a frame,
 * with nothing to point at, so this is asserted rather than watched. `wasInside`
 * carries the hysteresis - the boundary tightens to enter and loosens to leave -
 * so a capsule resting exactly on the rim stays in whichever state it reached.
 */
export function inPool(
  position: { x: number; y: number; z: number },
  bounds: PoolBounds,
  wasInside: boolean,
): boolean {
  const slack = wasInside ? SPLASH.hysteresis : -SPLASH.hysteresis
  const planar = Math.hypot(position.x - bounds.centreX, position.z - bounds.centreZ)
  // The slack applies to the plan boundary ONLY. See `SPLASH.hysteresis`.
  return planar <= bounds.radius + slack && position.y <= bounds.standingY
}

/** How hard an entry at this speed splashes, from `minStrength` to 1. */
export function splashStrength(speed: number): number {
  const t = Math.min(1, Math.max(0, speed / SPLASH.fullSpeed))
  return SPLASH.minStrength + (1 - SPLASH.minStrength) * t
}

/**
 * The worst linear luminance a splash pixel can reach.
 *
 * Written out for the same reason `waterPeakLuminance` is: section 1 of the art
 * bible opens with the discovery that NOTHING in this game bloomed because six
 * emissives were set by eye against a threshold nobody had computed, and "a splash
 * is too small to matter" is exactly the reasoning that produced that.
 *
 * The bound is trivial and that is the point of choosing NormalBlending. The
 * fragment writes `colour` at an alpha between 0 and 1 over whatever is behind it,
 * so the most luminous result is the colour itself - there is no accumulation term
 * for a dense cluster to sum into, which is the failure mode the bible's additive
 * cap exists to prevent. Overlapping droplets composite toward this value and never
 * past it.
 */
export function splashPeakLuminance(): number {
  return linearLuma(SPLASH_COLOUR)
}

/** Triangles and draw calls, so the cost of not gating this is on the record. */
export function splashCost(): { triangles: number; drawCalls: number } {
  return { triangles: SPLASH.droplets * 2 + 2, drawCalls: 1 }
}

/**
 * The splash, as one static geometry animated entirely by uniforms.
 *
 * Nothing here is rebuilt, re-uploaded or re-sorted when a splash fires: the
 * trajectories are functions of `aSeed`, `aOutward` and one `uAge`, so triggering
 * is a single float write. That is the whole reason a fixed buffer is enough and a
 * pool is not needed - there is no allocation to pool.
 *
 * `aCorner` carries the quad corner in -1 to 1 rather than baking it into
 * `position`, because the droplets are billboarded in VIEW space and the ring is
 * not. `position` holds each droplet's outward unit direction and each ring
 * corner's unit offset, which also gives three a bounding sphere of about the right
 * size even though the mesh sets `frustumCulled` false.
 */
export function splashGeometry(): BufferGeometry {
  const quads = SPLASH.droplets + 1
  const position = new Float32Array(quads * 4 * 3)
  const corner = new Float32Array(quads * 4 * 2)
  const seed = new Float32Array(quads * 4)
  const kind = new Float32Array(quads * 4)
  const index: number[] = []

  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]

  /*
    A golden-angle spiral rather than an even ring. Fourteen droplets at exactly
    2*PI/14 apart is a cog, and the eye finds the repeat instantly on an effect it
    sees hundreds of times; the golden angle is the standard fix and costs one
    multiply. The per-droplet `seed` then scatters speed, height and size on top, so
    no two droplets in one splash share a trajectory.
  */
  const golden = Math.PI * (3 - Math.sqrt(5))

  for (let q = 0; q < quads; q++) {
    const isRing = q === SPLASH.droplets
    const azimuth = q * golden
    const dropletSeed = SPLASH.droplets > 1 ? q / (SPLASH.droplets - 1) : 0
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c
      if (isRing) {
        // The flat ring: unit corners in the XZ plane, scaled by the shader.
        position[v * 3] = corners[c][0]
        position[v * 3 + 1] = 0
        position[v * 3 + 2] = corners[c][1]
      } else {
        position[v * 3] = Math.cos(azimuth)
        position[v * 3 + 1] = 0
        position[v * 3 + 2] = Math.sin(azimuth)
      }
      corner[v * 2] = corners[c][0]
      corner[v * 2 + 1] = corners[c][1]
      /*
        Hashed rather than sequential. `q / droplets` would make speed, height and
        size all rise together round the ring, which reads as a comb sweeping
        outward instead of as a burst.
      */
      seed[v] = (Math.sin(dropletSeed * 78.233 + 12.9898) * 43758.5453) % 1
      seed[v] = seed[v] < 0 ? seed[v] + 1 : seed[v]
      kind[v] = isRing ? 1 : 0
    }
    const base = q * 4
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aCorner', new BufferAttribute(corner, 2))
  geometry.setAttribute('aSeed', new BufferAttribute(seed, 1))
  geometry.setAttribute('aKind', new BufferAttribute(kind, 1))
  geometry.setIndex(index)
  return geometry
}

export const splashVertexShader = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aSeed;
  attribute float aKind;

  uniform float uAge;
  uniform float uLife;
  uniform float uRingLife;
  uniform float uSpread;
  uniform float uRise;
  uniform float uSize;
  uniform float uRingRadius;
  uniform float uRingLift;
  uniform float uStrength;

  varying vec2 vCorner;
  varying float vKind;
  varying float vFade;

  void main() {
    vCorner = aCorner;
    vKind = aKind;

    float life = mix(uLife, uRingLife, aKind);
    float age = clamp(uAge / life, 0.0, 1.0);

    /*
      The droplet's path. Outward travel decelerates - 1 - (1 - age)^2.2 - because
      thrown water is slowed by drag from the moment it leaves, and the rise is a
      parabola through 4 * age * (1 - age), which is exactly 1 at the halfway
      point and 0 at both ends without needing a gravity constant that would have to
      agree with JUMP.gravity for no reason.

      Scaled by strength on both axes so a slow entry makes a small splash in the
      same shape rather than a slower one.
    */
    float reach = uSpread * (1.0 - pow(1.0 - age, 2.2)) * (0.55 + 0.9 * aSeed) * uStrength;
    float lift = uRise * (0.6 + 0.8 * aSeed) * 4.0 * age * (1.0 - age) * uStrength;

    /*
      The ring instead expands as sqrt(age) - fast at the moment of impact and
      slowing - and sits flat, lifted clear of the water it is drawn on.
    */
    float grow = uRingRadius * sqrt(age) * uStrength;

    vec3 local = mix(
      position * reach + vec3(0.0, lift, 0.0),
      position * grow + vec3(0.0, uRingLift, 0.0),
      aKind
    );

    /*
      Droplets are billboarded and the ring is not, which is why this happens in
      VIEW space. Offsetting view.xy turns the quad to face the camera whatever it
      is doing; the ring takes a zero offset and keeps the flat orientation its
      position already has.

      modelViewMatrix is safe to offset in like this only because the mesh carries
      no rotation and no scale - it is placed at the pool's water surface and left
      alone. A scale on it would shear the billboard, so the component does not
      take one.
    */
    vec4 view = modelViewMatrix * vec4(local, 1.0);
    float size = uSize * (1.0 - 0.55 * age) * uStrength;
    view.xy += aCorner * size * (1.0 - aKind);

    /*
      The alpha envelope. A fast attack over the first eighth of the life so the
      splash appears to be caused by the footfall rather than to grow out of it,
      then a squared decay, which reads as water falling out of the air rather than
      as an object being faded.
    */
    vFade = smoothstep(0.0, 0.12, age) * pow(1.0 - age, 2.0);

    gl_Position = projectionMatrix * view;
  }
`

export const splashFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  varying vec2 vCorner;
  varying float vKind;
  varying float vFade;

  void main() {
    float radius = length(vCorner);

    // A soft round droplet.
    float droplet = 1.0 - smoothstep(0.45, 1.0, radius);

    /*
      And a band for the ring, at 0.8 of the quad's half width so the quad's corners
      are always outside it and the circle is never clipped square. Brighter on its
      inner edge, which is where a real expanding ring carries its crest.
    */
    float ring = smoothstep(0.6, 0.8, radius) * (1.0 - smoothstep(0.8, 0.99, radius));

    float alpha = mix(droplet, ring, vKind) * vFade * uOpacity;

    /*
      Discarding fully transparent fragments rather than writing them. The material
      does not write depth, so this is not about occlusion - it is that fifteen
      quads with a round mask in them are mostly empty, and a discard is cheaper
      than a blend on every one of those pixels.
    */
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(uColor, alpha);
  }
`

/**
 * The uniform block, as a factory so each material instance owns its own.
 *
 * Exported for the tests, which check in both directions that every uniform the
 * shaders reference is declared and supplied. A misspelled uniform is the canonical
 * silent shader failure here: three uploads nothing, GLSL initialises it to zero,
 * and `uLife` at zero divides the age by nothing and renders one frame of garbage.
 */
export function splashUniforms() {
  return {
    uAge: { value: SPLASH.life * 2 },
    uLife: { value: SPLASH.life },
    uRingLife: { value: SPLASH.ringLife },
    uSpread: { value: SPLASH.spread },
    uRise: { value: SPLASH.rise },
    uSize: { value: SPLASH.size },
    uRingRadius: { value: SPLASH.ringRadius },
    uRingLift: { value: SPLASH.ringLift },
    uStrength: { value: 1 },
    uColor: { value: new Color(SPLASH_COLOUR) },
    uOpacity: { value: 0.85 },
  }
}
