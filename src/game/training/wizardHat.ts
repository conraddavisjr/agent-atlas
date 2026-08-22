import type { CapeBend } from '@/game/player/robotGeometry'

/**
 * The instructor's hat: a cone, and a floppy tip that flows as it flies.
 *
 * ## The tip reuses the cape, and that is the whole reason this file is short
 *
 * A flowing hat tip is a strip of cloth hanging from a point, bending under its
 * own inertia. `robotGeometry.ts` already has exactly that: `createCapeRibbon`
 * builds a closed ribbon of 24 facets skinned from four bend angles, and
 * `skinCapeRibbon` transforms it per frame with 25 frame composes and no
 * trigonometry per vertex. It was written for the robot's cape and it is
 * shape-agnostic.
 *
 * So this file owns no geometry for the tip at all. It owns the ANGLES - how a
 * hat tip should lag a head that is moving - and hands them to the existing
 * skinner. That is the difference between reusing a system and copying one.
 *
 * The cone itself is a plain `coneGeometry` in the component. A cone is the one
 * primitive in this project allowed to keep a sharp apex, because a wizard hat
 * with a rounded tip is a garden gnome.
 */

/** How the hat is proportioned, in metres, against a head about 0.5 across. */
export const WIZARD_HAT = {
  /** Base radius. Wider than the head, so it reads as a hat rather than a nose. */
  radius: 0.42,
  /** Cone height, not counting the floppy tip. */
  height: 0.78,
  /** Where the brim sits above the head's centre. */
  lift: 0.3,
  /**
   * The permanent lean, radians.
   *
   * A hat standing exactly upright reads as a traffic cone balanced on a ball.
   * Every drawn wizard hat leans, and 0.22 is about 13 degrees - enough to be
   * deliberate, not so much that it looks knocked.
   */
  lean: 0.22,

  /**
   * How hard the tip lags the head's motion, in radians per metre per second.
   *
   * The tip does not simulate. It is driven directly from the head's velocity,
   * which is a far cheaper way to get the same read: a tip that trails when you
   * accelerate and swings past when you stop. A real spring would need its own
   * state and its own tuning, and `springs.test.ts` asserts the `SPRINGS` key set
   * EXACTLY, so adding one there would break an unrelated test.
   */
  lagPerSpeed: 0.34,
  /** Ceiling on that lag, so a fast fly-in cannot fold the tip through the cone. */
  maxLag: 0.9,
  /**
   * A slow idle sway, so the hat is alive even when the head is still.
   *
   * Radians of amplitude and radians per second. Slow on purpose - `PortalShimmer`
   * settled on 1.15 rad/s for the same reason, that ambience on something the
   * player looks at for a while must not read as a progress indicator.
   */
  swayAmplitude: 0.11,
  swayRate: 1.35,
  /**
   * How much more the far end of the tip bends than the near end.
   *
   * The four bends are applied in series down the ribbon, so equal angles give a
   * circular arc, which reads as a hoop rather than as cloth. Weighting the far
   * segments harder is what makes it whip.
   */
  taper: [0.55, 0.85, 1.15, 1.45] as const,
} as const

/**
 * The four bend angles for the hat's tip.
 *
 * Pure, so the flow is testable without a browser - which matters more than usual
 * here, because the failure mode is not an error but a hat that reads as a rigid
 * cone, and no still frame distinguishes a subtle sway from none at all.
 *
 * `velocityX` and `velocityZ` are the HEAD's world velocity. The tip lags
 * opposite to travel, which is what inertia looks like.
 */
export function hatBends(
  velocityX: number,
  velocityZ: number,
  time: number,
  spec = WIZARD_HAT,
): CapeBend[] {
  const speed = Math.hypot(velocityX, velocityZ)
  /*
    Clamped on the SPEED rather than on the resulting angle, so the direction of
    the lag survives the clamp. Clamping the angles per axis instead would bend a
    fast diagonal flight toward the nearer axis, and the hat would trail in a
    direction the head is not travelling.
  */
  const scale = speed > 0 ? Math.min(spec.maxLag, speed * spec.lagPerSpeed) / speed : 0

  const sway = Math.sin(time * spec.swayRate) * spec.swayAmplitude
  const crossSway = Math.cos(time * spec.swayRate * 0.77) * spec.swayAmplitude * 0.6

  return spec.taper.map((weight) => ({
    // Travelling along +Z tips the hat back around X, so the sign is negative.
    rx: (-velocityZ * scale + crossSway) * weight,
    rz: (velocityX * scale + sway) * weight,
  }))
}
