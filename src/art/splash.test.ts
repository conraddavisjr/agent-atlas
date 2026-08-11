import { describe, expect, it } from 'vitest'
import {
  SPLASH,
  inPool,
  splashCost,
  splashFragmentShader,
  splashGeometry,
  splashPeakLuminance,
  splashStrength,
  splashUniforms,
  splashVertexShader,
  type PoolBounds,
} from './splash'
import { BLOOM_THRESHOLD } from './materials'
import { POOL, STEP } from '@/game/world/hubLayout'
import { BODY } from '@/game/player/tuning'

const SOURCE = `${splashVertexShader}\n${splashFragmentShader}`

function declaredUniforms(source: string): string[] {
  return [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]).sort()
}

function referencedUniforms(source: string): string[] {
  return [...new Set([...source.matchAll(/\bu[A-Z]\w*\b/g)].map((m) => m[0]))].sort()
}

/** The bounds `HubIsland.tsx` builds, reproduced so the trigger is tested at its real numbers. */
const HUB_POOL: PoolBounds = {
  centreX: 0,
  centreZ: 0,
  radius: POOL.radius,
  standingY:
    3 * STEP - POOL.depth / 2 + BODY.capsuleHalfHeight + BODY.capsuleRadius + BODY.colliderOffset,
}

/** Where the capsule's centre sits standing on a surface, including the skin width. */
const centreOn = (surfaceY: number) =>
  surfaceY + BODY.capsuleHalfHeight + BODY.capsuleRadius + BODY.colliderOffset

describe('the splash shaders', () => {
  /*
    Section 4 of the art bible: `onBeforeCompile` hands over shaders with their
    `#include` directives still unresolved, and this codebase has been cut by shader
    patching three times. A from-scratch shader cannot fall into that trap, and this
    asserts it stays that way rather than trusting a later edit not to reach for a
    chunk.
  */
  it('contains no #include, so the unresolved-directive trap cannot apply', () => {
    expect(SOURCE).not.toContain('#include')
  })

  /*
    The canonical silent failure. A misspelled uniform means three uploads nothing and
    GLSL leaves it at zero - and here that is not a subtle wrongness: `uLife` at zero
    divides the age by nothing. Checked in both directions so the typo is caught
    whichever side it is on.
  */
  it('declares exactly the uniforms it references, in both directions', () => {
    expect(declaredUniforms(SOURCE)).toEqual(referencedUniforms(SOURCE))
  })

  it('supplies a value for every uniform it declares, and no extras', () => {
    expect(Object.keys(splashUniforms()).sort()).toEqual(declaredUniforms(SOURCE))
  })

  it('starts already finished, so nothing shows until something triggers it', () => {
    const uniforms = splashUniforms()
    expect(uniforms.uAge.value).toBeGreaterThan(
      Math.max(uniforms.uLife.value, uniforms.uRingLife.value),
    )
  })

  /*
    The droplets are billboarded and the ring is not, which is why the offset happens
    in VIEW space and is masked by `(1.0 - aKind)`. Offsetting the ring too would tilt
    it to face the camera, turning the one part of the effect that reads at this
    framing into a second spray.
  */
  it('billboards the droplets in view space and leaves the ring flat', () => {
    expect(splashVertexShader).toContain('modelViewMatrix')
    expect(splashVertexShader).toContain('view.xy += aCorner * size * (1.0 - aKind)')
  })
})

describe('the splash bloom budget', () => {
  /*
    Section 1 of the art bible: "dust and debris use NormalBlending with alpha. Only
    energy effects use AdditiveBlending, and only those may carry colours above 1.0. A
    dense cluster of individually dim additive dust will otherwise cross the threshold
    and produce a white blob." Water thrown off a boot is debris.

    That choice is what makes this a one-line proof rather than a cluster-density
    argument: NormalBlending composites toward the colour and never past it, so there
    is no accumulation term for overlapping droplets to sum into.
  */
  it('cannot reach the bloom threshold, whatever overlaps whatever', () => {
    const peak = splashPeakLuminance()
    expect(peak).toBeLessThan(BLOOM_THRESHOLD)
    expect(peak).toBeCloseTo(0.694, 2)
    expect(BLOOM_THRESHOLD / peak).toBeGreaterThan(2)
  })

  it('writes a colour under 1.0 in every channel, which the additive cap would need', () => {
    const colour = splashUniforms().uColor.value
    for (const channel of [colour.r, colour.g, colour.b]) {
      expect(channel).toBeGreaterThan(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })

  /*
    Ungated on quality, so the cost is asserted instead of assumed. Gating on
    `particleBudget` or `vfxDetail` would ship an effect that never draws, since both
    are zero and 'off' at all three tiers; this is the number that argument rests on,
    and it is the number to re-argue against if a real particle tier ever lands.
  */
  it('costs one draw call and a trivial triangle count', () => {
    expect(splashCost()).toEqual({ triangles: 30, drawCalls: 1 })
    const geometry = splashGeometry()
    expect(geometry.getIndex()!.count / 3).toBe(splashCost().triangles)
  })
})

describe('splashGeometry', () => {
  const geometry = splashGeometry()

  it('carries every attribute the vertex shader declares', () => {
    for (const name of ['position', 'aCorner', 'aSeed', 'aKind']) {
      expect(geometry.getAttribute(name), name).toBeTruthy()
    }
    const count = geometry.getAttribute('position').count
    expect(count).toBe((SPLASH.droplets + 1) * 4)
    for (const name of ['aCorner', 'aSeed', 'aKind']) {
      expect(geometry.getAttribute(name).count, name).toBe(count)
    }
  })

  it('marks exactly one quad as the ring and the rest as droplets', () => {
    const kind = geometry.getAttribute('aKind')
    let ring = 0
    for (let i = 0; i < kind.count; i++) {
      expect([0, 1]).toContain(kind.getX(i))
      ring += kind.getX(i)
    }
    // Four vertices, one quad.
    expect(ring).toBe(4)
  })

  it('gives every droplet a unit outward direction in the ground plane', () => {
    const position = geometry.getAttribute('position')
    const kind = geometry.getAttribute('aKind')
    for (let i = 0; i < position.count; i++) {
      if (kind.getX(i) === 1) continue
      expect(position.getY(i)).toBe(0)
      // Float32, so five places rather than nine.
      expect(Math.hypot(position.getX(i), position.getZ(i))).toBeCloseTo(1, 5)
    }
  })

  /*
    The seed has to be finite and in range on every vertex, because it multiplies both
    the reach and the rise. A NaN here is one droplet at an undefined position, which
    on most drivers is a full-screen triangle for one frame - a white flash the player
    sees and nobody can reproduce.
  */
  it('seeds every vertex finitely, inside 0 to 1', () => {
    const seed = geometry.getAttribute('aSeed')
    for (let i = 0; i < seed.count; i++) {
      expect(Number.isFinite(seed.getX(i))).toBe(true)
      expect(seed.getX(i)).toBeGreaterThanOrEqual(0)
      expect(seed.getX(i)).toBeLessThanOrEqual(1)
    }
  })

  it('spaces the droplets off an even ring, so the burst is not a cog', () => {
    /*
      The gaps have to be measured between angular NEIGHBOURS, not between
      consecutive indices - the first version of this test compared index n to index
      n + 1 and found every gap identical, which is true and proves nothing: a golden
      angle is a constant increment. What makes it useful is that the increment is
      irrational in a turn, so the points do not fall into spokes, and that only shows
      up once they are sorted by angle.
    */
    const position = geometry.getAttribute('position')
    const azimuths: number[] = []
    for (let q = 0; q < SPLASH.droplets; q++) {
      azimuths.push(Math.atan2(position.getZ(q * 4), position.getX(q * 4)))
    }
    azimuths.sort((a, b) => a - b)
    const gaps = azimuths.map((a, i) =>
      i === 0 ? a - azimuths[azimuths.length - 1] + Math.PI * 2 : a - azimuths[i - 1],
    )
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBeGreaterThan(1)
    // Still a ring, though: no gap may be wide enough to read as a missing droplet.
    expect(Math.max(...gaps)).toBeLessThan((3 * Math.PI * 2) / SPLASH.droplets)
  })
})

describe('inPool', () => {
  /*
    The whole effect lives or dies on the bracketing of this test, and both failures
    look identical in a frame: a splash that never fires and one that fires every
    frame are each "the splash is broken" with nothing to point at.
  */
  const deck = 3 * STEP
  const floor = deck - POOL.depth

  it('fires for a capsule standing on the pool floor at the centre', () => {
    expect(inPool({ x: 0, y: centreOn(floor), z: 0 }, HUB_POOL, false)).toBe(true)
  })

  it('does not fire for a capsule standing on the deck beside the pool', () => {
    expect(inPool({ x: 0, y: centreOn(deck), z: 0 }, HUB_POOL, false)).toBe(false)
    // Nor out on the flat, at the same height.
    expect(inPool({ x: 1.8, y: centreOn(deck), z: 0 }, HUB_POOL, false)).toBe(false)
  })

  it('does not fire for a capsule passing overhead', () => {
    /*
      The height test is a CEILING rather than a window, which is what lets a jump into
      the pool fire on the way down. The consequence to check is the other direction:
      the jump apex from Puck C puts the feet 1.4 m up and must not count as standing
      in it.
    */
    expect(inPool({ x: 0, y: centreOn(deck) + 1.4, z: 0 }, HUB_POOL, false)).toBe(false)
  })

  it('does not fire outside the rim even at floor height', () => {
    const beyond = POOL.radius + SPLASH.hysteresis + 0.01
    expect(inPool({ x: beyond, y: centreOn(floor), z: 0 }, HUB_POOL, false)).toBe(false)
  })

  /*
    Hysteresis, and it is not a nicety. The controller runs a fixed 1/60 s step with a
    downward bias of -1 pressed into the ground, so a capsule walking the rim sits
    within a millimetre or two of the boundary for several consecutive frames. Without
    the widened exit boundary that is one splash per frame.
  */
  it('holds its state for a capsule resting exactly on the plan boundary', () => {
    const onTheRim = { x: POOL.radius, y: centreOn(floor), z: 0 }
    expect(inPool(onTheRim, HUB_POOL, true)).toBe(true)
    expect(inPool(onTheRim, HUB_POOL, false)).toBe(false)
  })

  /*
    **The hysteresis must NOT reach the height test, and this is the assertion that
    caught it doing so.** Slackening both bounds looks symmetric and is fatal: the
    height threshold sits midway between standing on the deck and standing on the
    floor, `POOL.depth` apart, so a slack of 0.06 on a 0.05 m recess demands the
    capsule be lower than the pool is deep. The splash could never fire from any
    direction at any speed, and the frame would have looked completely normal.
  */
  it('cannot have its height bound slackened past the depth of the pool', () => {
    expect(SPLASH.hysteresis).toBeGreaterThan(POOL.depth / 2)
    // Which is exactly why entry at the floor has to work with no height slack at all.
    expect(inPool({ x: 0, y: centreOn(floor), z: 0 }, HUB_POOL, false)).toBe(true)
    expect(inPool({ x: 0, y: centreOn(floor), z: 0 }, HUB_POOL, true)).toBe(true)
  })

  it('cannot let its hysteresis swallow a real entry', () => {
    /*
      The capsule has to travel `sqrt(r^2 - (r - depth)^2)` inside the rim before its
      sole touches the floor at all - 0.18 m for a 0.35 m capsule in a 0.05 m recess -
      so the hysteresis has to be comfortably under that or the trigger could arm only
      after the step-down had already finished.
    */
    const reach = Math.sqrt(
      BODY.capsuleRadius ** 2 - (BODY.capsuleRadius - POOL.depth) ** 2,
    )
    expect(reach).toBeCloseTo(0.18, 2)
    expect(SPLASH.hysteresis).toBeLessThan(reach / 2)
  })
})

describe('splashStrength', () => {
  it('never returns nothing, so a slow entry still splashes', () => {
    expect(splashStrength(0)).toBe(SPLASH.minStrength)
    expect(splashStrength(0)).toBeGreaterThan(0.3)
  })

  it('reaches full strength at a run and stays there', () => {
    expect(splashStrength(SPLASH.fullSpeed)).toBeCloseTo(1, 9)
    expect(splashStrength(SPLASH.fullSpeed * 4)).toBeCloseTo(1, 9)
  })

  it('is monotone and finite across everything a frame can hand it', () => {
    let last = -1
    for (const speed of [0, 0.01, 0.5, 1, 2, 4.5, 20, 1e6]) {
      const strength = splashStrength(speed)
      expect(Number.isFinite(strength)).toBe(true)
      expect(strength).toBeGreaterThanOrEqual(last)
      last = strength
    }
    // A resumed browser tab can produce a nonsense speed; it must clamp, not explode.
    expect(splashStrength(Number.POSITIVE_INFINITY)).toBeCloseTo(1, 9)
    expect(splashStrength(-5)).toBe(SPLASH.minStrength)
  })
})

describe('the splash against the pool it fires in', () => {
  it('stays lower than the capsule radius, so no droplet crosses the character', () => {
    expect(SPLASH.rise).toBeLessThan(BODY.capsuleRadius)
  })

  it('throws water wider than the pool is deep and narrower than the pool is wide', () => {
    // A splash confined inside the recess would be hidden by its own bank.
    expect(SPLASH.ringRadius).toBeGreaterThan(POOL.depth * 4)
    // And one wider than the pool would throw water onto dry deck.
    expect(SPLASH.ringRadius).toBeLessThan(POOL.radius)
    expect(SPLASH.spread).toBeLessThan(POOL.radius)
  })

  it('lifts the ring clear of the surface it is drawn on', () => {
    // Coplanar with the water is a z-fight; deeper than the water is invisible.
    expect(SPLASH.ringLift).toBeGreaterThan(0)
    expect(SPLASH.ringLift).toBeLessThan(POOL.depth)
  })

  it('outlives the spray with the ring, which is the part that reads from above', () => {
    expect(SPLASH.ringLife).toBeGreaterThan(SPLASH.life)
  })
})
