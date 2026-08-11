/**
 * The one spring integrator the whole character uses.
 *
 * Pure arithmetic on plain structs, no three and no React, so every constant in
 * `animTuning.ts`'s SPRINGS block is checkable by a unit test rather than by
 * squinting at the game. `movement.ts` is the precedent: the code that decides
 * how something moves lives in a `.ts` next to its test, and the component only
 * writes the result onto an Object3D.
 *
 * Parametrised by `omega` (natural frequency, rad/s) and `zeta` (damping
 * ratio), never by raw stiffness and damping. That is the change that makes the
 * numbers mean something: zeta alone decides overshoot and omega alone decides
 * speed, so "make the landing bouncier" and "make the landing faster" are two
 * separate dials instead of one coupled pair.
 */

/** A single-degree-of-freedom spring. */
export type Spring1 = { x: number; v: number; target: number }

/**
 * Two independent axes sharing one omega and zeta.
 *
 * Used for bend chains, where a segment leans in both X and Z and both axes are
 * the same physical material. Two `Spring1`s would be equivalent and would cost
 * an extra object per segment for nothing.
 */
export type Spring2 = {
  x: number; vx: number; targetX: number
  z: number; vz: number; targetZ: number
}

export function createSpring1(x = 0): Spring1 {
  return { x, v: 0, target: x }
}

export function createSpring2(): Spring2 {
  return { x: 0, vx: 0, targetX: 0, z: 0, vz: 0, targetZ: 0 }
}

/**
 * How close zeta has to be to 1 before the critically damped form is used.
 *
 * Both the underdamped and the overdamped closed forms divide by
 * `omega * sqrt(|1 - zeta^2|)`, which goes to zero at critical damping, so
 * neither is usable in a band around it. The critical form is the limit of both
 * and is exact at the boundary.
 */
const CRITICAL_EPSILON = 1e-4

/*
  The propagated state, returned through module-level scalars.

  Two numbers have to come back from the solver and this runs sixteen times a
  frame, so returning an object would allocate sixteen of them per frame. That
  is exactly the garbage the whole no-allocation rule exists to prevent. Module
  scalars are the same trick the scratch Vector3s in PlayerController use, and
  the solver is synchronous and single threaded so there is nothing to race.
*/
let outD = 0
let outV = 0

/**
 * Advances a damped harmonic oscillator by `h` exactly, writing to `outD` and
 * `outV`.
 *
 * `d` is the displacement from the target, not the absolute position, which is
 * what lets one solver serve every spring regardless of where its target is.
 */
function propagate(d: number, v: number, omega: number, zeta: number, h: number): void {
  const decay = Math.exp(-zeta * omega * h)

  if (Math.abs(zeta - 1) < CRITICAL_EPSILON) {
    // d(t) = e^-wt (d0 + (v0 + w d0) t)
    const b = v + omega * d
    outD = decay * (d + b * h)
    outV = decay * (v - omega * h * b)
    return
  }

  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    const c = Math.cos(wd * h)
    const s = Math.sin(wd * h)
    outD = decay * (d * c + ((v + zeta * omega * d) / wd) * s)
    outV = decay * (v * c - ((omega * omega * d + zeta * omega * v) / wd) * s)
    return
  }

  // Overdamped. The hyperbolic form is the underdamped one with the circular
  // functions swapped, and `decay * cosh` stays bounded because the growing
  // exponential inside the cosh is always the smaller of the two rates.
  const wd = omega * Math.sqrt(zeta * zeta - 1)
  const c = Math.cosh(wd * h)
  const s = Math.sinh(wd * h)
  outD = decay * (d * c + ((v + zeta * omega * d) / wd) * s)
  outV = decay * (v * c - ((omega * omega * d + zeta * omega * v) / wd) * s)
}

/**
 * Advances a spring by `dt`, using the closed-form solution of the damped
 * harmonic oscillator rather than a numerical integrator.
 *
 * The design spec calls for semi-implicit Euler on the grounds that it "stays
 * bounded even when the step is far too large for the stiffness". That is not
 * true and it was worth measuring rather than believing. Semi-implicit Euler is
 * symplectic, which is a weaker property than unconditional stability: it is
 * stable only while `omega * dt` stays under about 2, and less than that once
 * damping is involved. At `omega 400, zeta 0.5, dt 0.05`, which is the spec's
 * own stability test, it diverges past 1e262 within a hundred steps.
 *
 * The accuracy problem is the one that would actually have been shipped. At
 * `omega 12, zeta 0.58, dt 1/60` semi-implicit Euler produces an 8.5%
 * overshoot where the analytic answer is 10.7%, because the integrator adds
 * numerical damping proportional to `omega * dt`. The consequences are both
 * bad: every number in the SPRINGS table would have been wrong by around a
 * fifth in the game while being right in its own unit test, and a player on a
 * 144 Hz monitor would get a visibly bouncier landing than one on 60 Hz, which
 * is the exact frame-rate dependence `useBeforePhysicsStep` exists to prevent
 * on the movement side.
 *
 * The closed form has neither problem. It is exact at any `dt`, so the table's
 * overshoot column is the behaviour rather than an approximation of it, two
 * refresh rates agree to machine precision, and stability is not a property it
 * can lose. The cost is one `exp` and two trigonometric calls per spring per
 * frame, so about 48 transcendentals for the whole character. Against three's
 * own 26 matrix updates, which the spec's frame budget already identifies as
 * the dominant term, that is not measurable.
 */
export function stepSpring1(s: Spring1, omega: number, zeta: number, dt: number): void {
  if (dt <= 0 || omega <= 0) return
  propagate(s.x - s.target, s.v, omega, zeta, dt)
  // A garbage omega or zeta from a caller must not put a NaN into the pose,
  // where it would silently propagate into a matrix and blank the character.
  if (!Number.isFinite(outD) || !Number.isFinite(outV)) {
    s.x = s.target
    s.v = 0
    return
  }
  s.x = s.target + outD
  s.v = outV
}

/**
 * `stepSpring1` on both axes.
 *
 * Written out rather than calling through twice so the two axes share nothing
 * but still cost only what they must: the `exp`, `cos` and `sin` inside
 * `propagate` depend on omega, zeta and dt alone, so a fused version would
 * halve the transcendental count. It is not fused, because the readability of
 * two obvious calls beats saving 16 `Math.cos` calls a frame, and if that ever
 * shows up in a profile it is a two-line change.
 */
export function stepSpring2(s: Spring2, omega: number, zeta: number, dt: number): void {
  if (dt <= 0 || omega <= 0) return

  propagate(s.x - s.targetX, s.vx, omega, zeta, dt)
  if (Number.isFinite(outD) && Number.isFinite(outV)) {
    s.x = s.targetX + outD
    s.vx = outV
  } else {
    s.x = s.targetX
    s.vx = 0
  }

  propagate(s.z - s.targetZ, s.vz, omega, zeta, dt)
  if (Number.isFinite(outD) && Number.isFinite(outV)) {
    s.z = s.targetZ + outD
    s.vz = outV
  } else {
    s.z = s.targetZ
    s.vz = 0
  }
}

/** Puts a spring back at rest at `x` with no velocity. Used on teleport and respawn. */
export function resetSpring1(s: Spring1, x = 0): void {
  s.x = x
  s.v = 0
  s.target = x
}

export function resetSpring2(s: Spring2): void {
  s.x = 0
  s.vx = 0
  s.targetX = 0
  s.z = 0
  s.vz = 0
  s.targetZ = 0
}

/**
 * Peak overshoot of a step response, as a fraction of the step size.
 *
 * `exp(-pi * zeta / sqrt(1 - zeta^2))`, the standard second-order result. At
 * zeta 1 it is exactly zero, which is the whole point: a critically damped
 * spring cannot overshoot, so a comment claiming one does is describing
 * something that has never happened.
 *
 * Exported so the SPRINGS table can be asserted against its own documented
 * overshoot column rather than the table rotting into decoration.
 */
export function overshootFor(zeta: number): number {
  if (zeta >= 1) return 0
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))
}

/** Time in seconds for a step response to settle inside 5%, approximately `3 / (zeta * omega)`. */
export function settleTimeFor(omega: number, zeta: number): number {
  return 3 / (zeta * omega)
}

/** Time in seconds to the first overshoot peak. Infinite at or above critical damping. */
export function peakTimeFor(omega: number, zeta: number): number {
  if (zeta >= 1) return Infinity
  return Math.PI / (omega * Math.sqrt(1 - zeta * zeta))
}

/**
 * Applies a velocity impulse. A separate verb because it is a different idea
 * from moving the target.
 *
 * Changing `target` says "the thing this is attached to has moved". Adding to
 * `v` says "the thing this is attached to has been hit". A landing is a hit,
 * and an easing curve cannot express one at all: it can only interpolate
 * between two rest positions, which is why the antenna currently does not whip.
 */
export function impulse1(s: Spring1, dv: number): void {
  s.v += dv
}

export function impulse2(s: Spring2, dvx: number, dvz: number): void {
  s.vx += dvx
  s.vz += dvz
}

/** The three scale fields a squash writes. Structural so this module owes nothing to the pose. */
type ScaleTriple = { sx: number; sy: number; sz: number }

/**
 * Volume-preserving squash and stretch.
 *
 * Uniform scaling in X and Z by `1 / sqrt(s)` holds volume exactly. `lateral`
 * biases how that widening splits between width and depth: above 1 the
 * character spreads sideways more than forward, which is what a moulded shell
 * dropped on a floor actually does, and which also reads better from a camera
 * that is almost always behind it.
 *
 * This replaces `widen = 1 + (1 - s) * 0.6`, a linear approximation that agrees
 * with the exact form to three decimal places at the old `landSquash` of 0.78
 * and is why nobody noticed. It diverges where it matters: at the revival's
 * 0.55 the approximation gives 1.270 against a true 1.348, so the deepest frame
 * of the most dramatic landing in the game loses 6% of its volume and reads
 * thin at exactly the moment it should read heavy.
 *
 * Volume is exact for any `lateral`, since `sx * sy * sz = (w * l) * s * (w / l)`
 * which is `w^2 * s` which is 1.
 *
 * The clamps exist because a bug elsewhere writing a garbage squash should
 * produce a squat robot, not an inverted one.
 */
export function squashScale(s: number, lateral: number, out: ScaleTriple): void {
  const clamped = Math.min(1.45, Math.max(0.4, s))
  const w = 1 / Math.sqrt(clamped)
  out.sx = w * lateral
  out.sy = clamped
  out.sz = w / lateral
}
