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

/**
 * The hat's silhouette, as a lathe profile: (radius, height) from brim to apex.
 *
 * ## A cone is not a wizard hat, and that was the first version's problem
 *
 * `coneGeometry` gives straight sides. Straight sides on a head read as a party
 * hat or a traffic cone - which is what shipped, in a bright blue, with nothing
 * else on it. Every drawn wizard hat is CONCAVE: it loses most of its radius in
 * the first third and then runs on in a long slender taper, so the silhouette has
 * a shoulder near the brim and a whip near the tip.
 *
 * These points do that. Read as the RATE the radius sheds per metre of height,
 * they run 0.48, 0.44, 0.40, 0.34, 0.28, 0.22, 0.20 - falling the whole way, so
 * the curve is concave from the brim to the tip and the first segment sheds well
 * over twice as fast as the last.
 *
 * The first draft was not: it went 0.32 then 0.42, a slight outward flare at the
 * base before the taper began. That is a real shape a hat can have, but it is not
 * the one the silhouette claims, and `wizardHat.test.ts` pins the RATE rather
 * than the numbers so a retune has to stay honest about which shape it is.
 *
 * It stops at a finite 0.045 rather than closing to a point, because the floppy
 * tip continues from there and a lathe closed to zero would put a pinch in the
 * middle of a continuous form.
 */
export const HAT_PROFILE: readonly (readonly [number, number])[] = [
  [0.4, 0.0],
  [0.347, 0.11],
  [0.29, 0.24],
  [0.226, 0.4],
  [0.165, 0.58],
  [0.115, 0.76],
  [0.08, 0.92],
  [0.052, 1.06],
] as const

/** How the hat is proportioned, in metres, against a head about 0.7 across. */
export const WIZARD_HAT = {
  /** Base radius. Wider than the head, so it reads as a hat rather than a nose. */
  radius: 0.4,
  /** Cone height, not counting the floppy tip. */
  height: 1.06,
  /**
   * Where the brim sits above the head's centre.
   *
   * Lowered from 0.26 when the lean went past 20 degrees. A leaning brim lifts on
   * its high side by `brimRadius * sin(lean)`, which at 0.36 is 0.20 - so the hat
   * was riding up off the crown on one side and reading as balanced on the head
   * rather than worn on it. Seating it lower puts that lift back over the dome.
   */
  lift: 0.21,
  /**
   * The brim, which the first version did not really have.
   *
   * It had a torus at the cone's own base radius, which is a rim rather than a
   * brim - it reads as a seam where the cone meets the head. A brim is WIDER than
   * the crown by a clear margin, and it is what turns a cone into a hat: it casts
   * the shadow that separates hat from head, and it gives the silhouette its
   * second horizontal.
   */
  brimRadius: 0.56,
  brimTube: 0.055,
  /** A band above the brim, in hardware silver. The one bright note on the cloth. */
  bandY: 0.115,
  bandRadius: 0.36,
  bandTube: 0.042,
  /**
   * The permanent lean, radians.
   *
   * A hat standing exactly upright reads as a traffic cone balanced on a ball, so
   * this was 0.22 - about 13 degrees, enough to be deliberate and not so much
   * that it looked knocked.
   *
   * It reads as timid at that angle next to a metre-tall crown. 0.36 is 20.6
   * degrees, which is where the tip clearly hangs out past the brim's own
   * footprint and the silhouette stops being symmetrical - the point of leaning a
   * hat at all. It costs the seat: see `lift`, which came down to pay for it.
   *
   * The ceiling is not taste, it is the brim. Past about 30 degrees the low edge
   * swings down level with the eyes and the high edge lifts clear of the crown,
   * and `wizardHat.test.ts` holds that line.
   */
  lean: 0.36,

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

  /**
   * The tip's REST curl, radians per segment, and the second real bug fixed here.
   *
   * The tip used to hang off the apex with no rest bend at all, mounted with a
   * half turn that pointed it straight up. What reached the screen was a flat
   * rectangle standing vertically above the cone with a visible gap between the
   * two - not a floppy tip, a detached blue card.
   *
   * A floppy hat tip flops. It leaves the apex along the cone's own axis and
   * folds over under its own weight, and it does that at rest, before any
   * velocity is involved. Four segments at 0.34 sum to 1.36 radians, about 78
   * degrees, which lays the tip most of the way to horizontal - far enough to
   * read as cloth, short of the doubling-back that would put it back through the
   * cone.
   */
  droop: 0.34,

  /**
   * WHICH WAY the tip flops, radians, and it turned out to matter more than how far.
   *
   * The first fix gave the tip a rest curl and left it bending about X alone,
   * which folds it directly away from the face - straight backwards, behind the
   * crown, where the player never sees it. The hat looked like a clean cone with
   * a point, exactly as it had before, and the tip was there the whole time doing
   * its job out of shot. That is a worse failure than the detached card it
   * replaced, because nothing on screen suggests anything is wrong.
   *
   * The instructor holds its front to the player for its whole eight seconds, so
   * the flop has to land somewhere in that half. 0.95 splits the curl about two
   * parts sideways to one part FORWARD: the tip lays over the brim and off to the
   * leaning side, which is the silhouette every drawn wizard hat has, and it stays
   * visible however the head turns on its way in.
   */
  droopHeading: 0.95,

  /**
   * How narrow the tip is drawn, as a scale on the borrowed cape panel.
   *
   * `createCapeRibbon` builds at `CAPE_PANEL.width`, 0.34, because it was written
   * for a cape. A 0.34 slab off a 0.09 apex is the detached-card read again, from
   * the other direction. Scaling the group is a matrix, where parameterising the
   * builder would fork a geometry the player's cape also uses.
   */
  tipWidth: 0.44,
  tipDepth: 0.62,
} as const

/**
 * The hat's surface radius at a height, by walking `HAT_PROFILE`.
 *
 * Used to place the stars ON the cloth rather than near it. Linear between the
 * profile's own points, which is exactly what the lathe does between them, so a
 * star placed here sits on the surface the player sees and not on an idealised
 * cone that the surface only approximates.
 */
export function hatRadiusAt(y: number): number {
  const p = HAT_PROFILE
  if (y <= p[0][1]) return p[0][0]
  if (y >= p[p.length - 1][1]) return p[p.length - 1][0]
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][1]) {
      const t = (y - p[i - 1][1]) / (p[i][1] - p[i - 1][1])
      return p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t
    }
  }
  return p[p.length - 1][0]
}

/**
 * The cloth's slope at a height, as the angle to tilt a star so it lies flat.
 *
 * A star pasted on without this stands out from the cone like a badge on a pin.
 * The profile's local slope is `dr/dy`; a decal lying on that surface pitches by
 * `atan(dr/dy)` about its own X.
 */
export function hatSlopeAt(y: number): number {
  const step = 0.02
  const dr = hatRadiusAt(y + step) - hatRadiusAt(y - step)
  return Math.atan2(dr, 2 * step)
}

/**
 * Where the stars go: height up the cone, angle around it, and size.
 *
 * ## Why the hat has stars at all
 *
 * The brief asked for "a Disney-style wizard hat", and what separates that from a
 * blue cone is not the shape - it is that the cloth is a night sky. Five is the
 * number that reads as scattered rather than as a pattern; a ring of them at one
 * height is a party hat again.
 *
 * Hand-placed rather than randomised. A seeded scatter would need a rejection
 * pass to stop two landing on top of each other, and five positions are five
 * positions.
 *
 * ## Spread, which took a second pass
 *
 * The first set covered 99 degrees of the cone and the middle 55% of its height,
 * which is a patch on the front rather than a scatter - stars in a huddle read as
 * a decal somebody stuck on, where stars that carry on around the cone read as a
 * night sky the hat is made of. They now cover 145 degrees and the crown from
 * 0.14 to 0.85, and they alternate sides as they climb so no two consecutive ones
 * sit on the same face.
 *
 * They still stop short of the back. The instructor holds its front to the player
 * for the whole of its eight seconds, so a star at 170 degrees is a star nobody
 * sees - but the head DOES turn on its way in, and the sides are seen, which is
 * what buys the extra 45 degrees. `wizardHat.test.ts` pins the spread as well as
 * the limit, so this cannot quietly shrink back to a patch.
 */
export const HAT_STARS: readonly { y: number; theta: number; size: number }[] = [
  { y: 0.14, theta: -1.24, size: 0.092 },
  { y: 0.31, theta: 0.85, size: 0.078 },
  { y: 0.5, theta: -0.28, size: 0.062 },
  { y: 0.68, theta: 1.3, size: 0.048 },
  { y: 0.85, theta: -0.9, size: 0.036 },
]

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
    /*
      The REST DROOP is added flat, not scaled by the taper, and split across both
      axes by `droopHeading`.

      Flat, because cloth folds most where it leaves its support: a constant
      per-segment bend is a circular arc, which is the shape a hanging tip holds.
      Scaled by the taper it would curl tightly at its far end and stay
      near-straight at its root, which is a whip cracking. The taper still weights
      the MOTION, which is where whip belongs.

      Split, because a curl on X alone folds the tip straight back behind the
      crown where nobody can see it. The NEGATIVE cosine is what brings it
      forward over the brim rather than away from the face.

      Travelling along +Z tips the hat back around X, so that sign is negative
      too, and for a different reason - that one is inertia.
    */
    rx: (-velocityZ * scale + crossSway) * weight - spec.droop * Math.cos(spec.droopHeading),
    rz: (velocityX * scale + sway) * weight + spec.droop * Math.sin(spec.droopHeading),
  }))
}
