import { FOOT, SOLE_LIGHT } from './robotGeometry'
import { AIR_JUMP } from './tuning'

/**
 * The thruster beam's shape and envelope: everything about it that is a number
 * rather than a component.
 *
 * Split out for the house rule a `.tsx` in this project follows - one component
 * per file and nothing else, which is what keeps fast refresh working - and the
 * same split `splash.ts` / `PoolSplash.tsx` and `waterMaterial.ts` /
 * `WaterTrace.tsx` were built on before they were deleted.
 *
 * It earns the split on its own terms too: `thrusterEnvelope` is the claim that
 * the beam is at full width exactly when the lift is at full strength, and that
 * is a question with an exact answer, which belongs in a test rather than in a
 * screenshot.
 *
 * Every value below comes from `docs/design/92-double-jump.md`, which is labelled
 * throughout with what is documented, what is inferred from footage and what is
 * an engineering recommendation. Almost all of this is the third: the research
 * found that **no frame data for Astro's hover exists anywhere** - not on
 * speedrun.com, not in the CEDEC or GDC talks, not in Digital Foundry's coverage
 * - so anything here presented as a Sony figure would be invented.
 */

/**
 * The beam's shape, in metres, and the two things it has to fit between.
 *
 * `nozzle` is 0.026 against a sole flat of 0.0334, so the wide end sits inside
 * the flat part of the sole rather than overhanging the boot's fillet - the same
 * constraint `SOLE_LIGHT` is sized by. `SOLE_LIGHT.radius` is 0.023, so the beam
 * is a hair wider than the mark it comes out of, which reads as the mark being
 * the source rather than as two concentric circles.
 *
 * `length` 0.19 is about 1.5 boot heights and a fifth of the character. Long
 * enough to read at the establishing framing, short enough that it never reaches
 * the ground on a jump that clears its own height - a beam that touches the floor
 * reads as a support rather than as thrust.
 */
export const THRUSTER = {
  nozzle: 0.026,
  tip: 0.005,
  length: 0.19,
  /**
   * 12, which puts the pair at 96 triangles.
   *
   * Two cones per foot - a pale core inside a coloured halo, see `FootThruster` -
   * at `2 * 12` triangles each with the caps dropped, so `4 * 24 = 96` for the
   * character. That is a fifth of one pylon.
   */
  radialSegments: 12,
  /** How much wider the halo is than the core, and how much longer. */
  haloScale: 1.9,
  haloLength: 1.12,

  /**
   * Ignition, in seconds. `easeOutBack`, so it overshoots and settles.
   *
   * 45 ms is under three frames at 60. Ignition is the beat: if the beam takes
   * longer than this the lift it is supposed to be causing arrives first, and the
   * effect reads as a reaction to the jump rather than as its cause.
   *
   * The overshoot is what makes it read as ignition rather than as a fade-in - a
   * thruster lights with a pop, and `easeOutBack` peaks at about 1.0999 before
   * settling, which is a tenth of the beam's own width and lasts two frames.
   */
  ignition: 0.045,
  /**
   * The decay tail, in seconds, and **it deliberately outlives the physics.**
   *
   * This is the one piece of the timing that is not obvious and it is the reason
   * the envelope is driven by `thrustAge` rather than by `thrust`. The burn is
   * `AIR_JUMP.thrustTime` and the gravity cut ends exactly there; a beam that
   * ended there too would cut out in one frame, which reads as a dropped frame
   * rather than as a thruster shutting down.
   *
   * So the flame outlasts the force by 110 ms. Gating the VFX on `thrust > 0`
   * makes that impossible to express, which is why nothing here reads that field.
   */
  decay: 0.11,
  /**
   * Peak-to-peak length flicker while sustaining, as a fraction.
   *
   * Applied to LENGTH only. Flickering the width as well makes the nozzle appear
   * to breathe, and a nozzle is a hole in a solid object.
   */
  flicker: 0.16,
  /**
   * Flicker rate in Hz. 22, and the ceiling is Nyquist rather than taste.
   *
   * At 60 fps anything above 30 Hz aliases into a slow beat that reads as a bug,
   * and the practical ceiling is lower because the eye needs two or three samples
   * per cycle to see a cycle at all. 22 Hz is 2.7 frames per cycle: fast enough to
   * shimmer, slow enough to be a shimmer rather than noise.
   */
  flickerHz: 22,

  /**
   * The ground-distance gate, in metres, over which the beam fades in.
   *
   * Below `gateNear` the beam is off entirely. The character's own contact shadow
   * and the sole light both live in that gap, and an additive beam a few
   * centimetres above the floor blooms into them and produces a bright smear
   * under the feet at exactly the moment - landing - when the eye is looking for
   * a clean contact.
   *
   * It also means the beam is invisible while grounded without needing to know
   * anything about the jump state, which is the correct behaviour falling out of
   * the correct rule rather than being special-cased.
   */
  gateNear: 0.25,
  gateFar: 0.6,
} as const

/** The total life of one beam, which is the burn plus the tail that outlives it. */
export function thrusterLife(duration: number = AIR_JUMP.thrustTime): number {
  return duration + THRUSTER.decay
}

/**
 * `easeOutBack`, the standard curve, with the standard constant.
 *
 * Written out rather than imported so the overshoot is visible at the call site:
 * it is the difference between a thruster that lights and one that fades up, and
 * a future reader retuning the ignition needs to see that the curve leaves the
 * unit interval on purpose.
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const u = t - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

/**
 * The beam's envelope as a function of AGE, not of the burn remaining.
 *
 * Age counts up from the press and keeps counting past the end of the burn, which
 * is what lets the flame outlive the force. See `THRUSTER.decay`.
 *
 * Three phases: an ignition that overshoots, a sustain at full, and a tail that
 * holds near full and then drops away - `1 - t^3`, so the beam looks like it is
 * still burning until it very obviously is not, rather than dimming linearly
 * through a long grey middle.
 */
export function thrusterEnvelope(age: number, duration: number = AIR_JUMP.thrustTime): number {
  if (age <= 0 || duration <= 0) return 0
  if (age >= thrusterLife(duration)) return 0

  if (age < THRUSTER.ignition) return Math.max(0, easeOutBack(age / THRUSTER.ignition))
  if (age < duration) return 1

  const t = (age - duration) / THRUSTER.decay
  return Math.max(0, 1 - t * t * t)
}

/**
 * How far the beam is allowed to show, given the sole's height above the ground.
 *
 * A smoothstep rather than a cutoff, because a beam that switches on at a fixed
 * height pops on during a rise the player is watching.
 */
export function groundGate(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - THRUSTER.gateNear) / (THRUSTER.gateFar - THRUSTER.gateNear)))
  return t * t * (3 - 2 * t)
}

/**
 * A pinned envelope for `?thrust=<0..1>`, or null when the flag is absent.
 *
 * ## Why this exists, and it is not debug scaffolding
 *
 * The beam only appears during a burn that requires the physics to be running,
 * and the capture harness cannot run the physics: `__dev.capture()` renders
 * correctly with `__player.steps` stuck at 0, because the driven path advances
 * the render loop and Rapier's stepping does not follow it. So every frame this
 * project can capture shows the character in its rest pose, standing, and a
 * grounded character's beams are correctly hidden by `groundGate`.
 *
 * That is exactly the condition under which this project has shipped an invisible
 * effect before - the sole light, twice - and the standing rule from
 * `99-handoff.md` is to prove the thing actually draws. This flag is how: it pins
 * the envelope AND bypasses the ground gate, so a still frame can show the beam
 * at a known point in its burn.
 *
 * The same shape as `?gfx=ao` and `?nobrickmap`: a lever that keeps a comparison
 * repeatable without a rebuild, for one `URLSearchParams` read at mount.
 */
export function pinnedEnvelope(search: string): number | null {
  const raw = new URLSearchParams(search).get('thrust')
  if (raw === null) return null
  const value = Number(raw)
  // An unparseable or out-of-range value pins to full rather than to nothing, so
  // a typo shows the beam instead of silently showing no beam - which would look
  // exactly like the bug the flag exists to rule out.
  if (!Number.isFinite(value) || value <= 0 || value > 1) return 1
  return value
}

/**
 * The pale core's colour.
 *
 * Near white with a cyan cast rather than pure white: the bible's construction asks
 * for a "near-white emissive core sized to read at distance", and a core at exactly
 * `#ffffff` reads as a lens flare rather than as the hot middle of a blue flame.
 */
export const THRUSTER_CORE = '#e8fbff'

/**
 * The halo's glow, in threshold multiples.
 *
 * 0.90, deliberately UNDER 1.0 and therefore under the bloom threshold. The halo's
 * job is to be the colour that survives, and anything that blooms loses its colour
 * to white - which is the defect the two-element construction exists to fix. Tier B
 * in `GLOW`'s language is 0.66 and this sits above it, because the halo has to hold
 * its own against a core blooming next to it.
 */
export const HALO_GLOW = 0.9

/**
 * Where each cone's CENTRE sits, in foot-local metres.
 *
 * The nozzle is on the sole plane at `-FOOT.height / 2`, offset outward by
 * `SOLE_LIGHT.proud` so the beam's wide end is buried in the pad rather than
 * hovering under it - the light then appears to come out of the mark rather than
 * from a cone floating below it.
 *
 * A cylinder is centred on its own middle, so the centre is half a length further
 * down, and the halo's is further still because it is longer.
 */
export function coreOrigin(): number {
  return -FOOT.height / 2 - THRUSTER.length / 2 + SOLE_LIGHT.proud
}

export function haloOrigin(): number {
  return -FOOT.height / 2 - (THRUSTER.length * THRUSTER.haloLength) / 2 + SOLE_LIGHT.proud
}
