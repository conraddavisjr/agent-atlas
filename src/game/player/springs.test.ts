import { describe, it, expect } from 'vitest'
import {
  createSpring1,
  createSpring2,
  impulse1,
  overshootFor,
  peakTimeFor,
  settleTimeFor,
  squashScale,
  stepSpring1,
  stepSpring2,
  squashScale as squash,
} from './springs'
import { SPRINGS, SQUASH_ANIM } from './animTuning'
import { SQUASH } from './tuning'

const DT = 1 / 60

/** Steps a fresh unit step response and returns the sampled trajectory. */
function stepResponse(omega: number, zeta: number, dt: number, seconds: number): number[] {
  const s = createSpring1(1)
  s.target = 0
  const out: number[] = []
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    stepSpring1(s, omega, zeta, dt)
    out.push(s.x)
  }
  return out
}

describe('the spring integrator', () => {
  it('converges from a unit step', () => {
    const trace = stepResponse(12, 0.6, DT, 2)
    expect(Math.abs(trace[trace.length - 1])).toBeLessThan(0.01)
  })

  it('overshoots by the analytic amount at zeta 0.58', () => {
    const trace = stepResponse(12, 0.58, DT, 2)
    // Target is 0 and the step starts at 1, so the overshoot is how far past
    // zero the trajectory goes, as a fraction of the step size of 1.
    const past = -Math.min(...trace)
    expect(past).toBeGreaterThan(0.095)
    expect(past).toBeLessThan(0.12)
    // And it matches the closed form to within integration error.
    expect(past).toBeCloseTo(overshootFor(0.58), 2)
  })

  /*
    The design spec asks for "exactly 3" sign changes over 2 s here and that is
    arithmetically impossible. The ringing period at omega 12, zeta 0.58 is
    2*pi / (omega * sqrt(1 - zeta^2)) = 0.643 s, so 2 s of simulation contains
    just over three full cycles and therefore six crossings no matter how the
    integrator is written. Counting crossings is the wrong measurement.

    What the spec is actually asking for is that the bounce is a single visible
    beat rather than a wobble, and the honest way to state that is on the size
    of each successive excursion: each one is the previous one times the
    overshoot ratio, so the second is already under 2% and the third is
    invisible.
  */
  it('rings down to one visible bounce at zeta 0.58', () => {
    const trace = stepResponse(12, 0.58, DT, 2)
    const excursions: number[] = []
    // Collect the peak magnitude of each run on one side of the target.
    let sign = Math.sign(trace[0])
    let peak = 0
    for (const x of trace) {
      if (Math.sign(x) !== sign && x !== 0) {
        excursions.push(peak)
        sign = Math.sign(x)
        peak = 0
      }
      peak = Math.max(peak, Math.abs(x))
    }
    // The initial approach from 1 down to the target, then the bounce.
    expect(excursions.length).toBeGreaterThanOrEqual(4)
    expect(excursions[1]).toBeGreaterThan(0.095)
    expect(excursions[1]).toBeLessThan(0.12)
    expect(excursions[2]).toBeLessThan(0.02)
    expect(excursions[3]).toBeLessThan(0.005)
  })

  /*
    The regression test for the bug in the spec's section 0.

    `PlayerController` computed `-displacement * recovery^2` against
    `-velocity * 2 * recovery`, which is exactly zeta 1.0, while its own comment
    promised the result "overshoots very slightly and reads as springy plastic".
    A critically damped spring has zero overshoot by definition, so the bounce
    that comment describes has never happened once, and `REVIVAL.landSquash`'s
    comment claiming the rebound comes for free from that overshoot was resting
    on the same mistake.

    This asserts what the old form actually did, so that a future edit which
    quietly returns the squash to critical damping fails here rather than being
    noticed months later as "the landing feels flat".
  */
  it('cannot overshoot at all when critically damped', () => {
    const trace = stepResponse(SQUASH.recovery, 1, DT, 3)
    for (const x of trace) expect(x).toBeGreaterThan(-1e-9)
  })

  /*
    The spec budgets 2% at 1/60 against 1/240 and 6% at 1/30, which are the
    tolerances a numerical integrator needs. The closed form does not need them:
    it is exact at every step size, so three refresh rates agree to machine
    precision and a 144 Hz player gets the same bounce as a 60 Hz one.

    This is the test that would fail if anyone swapped the solver back to Euler,
    and it is a much sharper detector of that than the stability test is.
  */
  it('is frame-rate independent to machine precision', () => {
    const at60 = stepResponse(12, 0.6, 1 / 60, 1)
    const at240 = stepResponse(12, 0.6, 1 / 240, 1)
    const at30 = stepResponse(12, 0.6, 1 / 30, 1)
    const ref = at240[at240.length - 1]
    expect(Math.abs(at60[at60.length - 1] - ref)).toBeLessThan(1e-12)
    expect(Math.abs(at30[at30.length - 1] - ref)).toBeLessThan(1e-12)
  })

  /*
    The stiffness is deliberately absurd. Nothing on the character runs at omega
    400, but a tab that regains focus really does hand us a 50 ms step, and a
    single semi-implicit step at omega*dt = 20 diverges past 1e262 within a
    hundred iterations. Measured, and the reason `stepSpring1` substeps and then
    snaps rather than trusting the symplectic property to save it.
  */
  it('stays bounded under a step far too large for the stiffness', () => {
    const s = createSpring1(1)
    s.target = 0
    for (let i = 0; i < 100; i++) stepSpring1(s, 400, 0.5, 0.05)
    expect(Number.isFinite(s.x)).toBe(true)
    expect(Math.abs(s.x)).toBeLessThan(10)
  })

  it('agrees at the stiffest omega the character uses across a 50x step ratio', () => {
    // omega 22 at the caller's 50 ms clamp is omega*dt = 1.1, which is where a
    // semi-implicit integrator is still stable but has already lost most of its
    // accuracy. One second of simulation, taken in twenty steps or in a
    // thousand, has to land in the same place.
    const coarse = createSpring1(1)
    coarse.target = 0
    for (let i = 0; i < 20; i++) stepSpring1(coarse, 22, 0.5, 0.05)
    const fine = createSpring1(1)
    fine.target = 0
    for (let i = 0; i < 1000; i++) stepSpring1(fine, 22, 0.5, 0.001)
    expect(Math.abs(coarse.x - fine.x)).toBeLessThan(1e-12)
  })

  it('handles overdamped and exactly critical zeta without dividing by zero', () => {
    for (const zeta of [1, 1 - 1e-9, 1 + 1e-9, 1.4, 3]) {
      const s = createSpring1(1)
      s.target = 0
      let min = 1
      for (let i = 0; i < 240; i++) {
        stepSpring1(s, 14, zeta, DT)
        min = Math.min(min, s.x)
      }
      expect(Number.isFinite(s.x), `zeta ${zeta}`).toBe(true)
      // At or above critical damping nothing may cross the target at all.
      expect(min, `zeta ${zeta}`).toBeGreaterThan(-1e-9)
    }
  })

  it('does nothing at dt zero', () => {
    const s = createSpring1(0.5)
    s.target = 1
    s.v = 3
    stepSpring1(s, 12, 0.6, 0)
    expect(s.x).toBe(0.5)
    expect(s.v).toBe(3)
  })

  it('takes a velocity impulse without moving the target', () => {
    const s = createSpring1(0)
    impulse1(s, 4)
    expect(s.target).toBe(0)
    let peak = 0
    for (let i = 0; i < 120; i++) {
      stepSpring1(s, 12, 0.5, DT)
      peak = Math.max(peak, s.x)
    }
    expect(peak).toBeGreaterThan(0.1)
    expect(Math.abs(s.x)).toBeLessThan(0.02)
  })

  it('drives both axes of a Spring2 independently', () => {
    const s = createSpring2()
    s.targetX = 1
    s.targetZ = -0.5
    for (let i = 0; i < 240; i++) stepSpring2(s, 14, 0.8, DT)
    expect(s.x).toBeCloseTo(1, 2)
    expect(s.z).toBeCloseTo(-0.5, 2)
  })
})

describe('the SPRINGS table', () => {
  /*
    Turns the table in animTuning.ts into an executable specification.

    Every row claims an overshoot and a settle time. If a future tuning pass
    edits a zeta and leaves the comment, or edits the comment and leaves the
    zeta, this is what notices.
  */
  const expected: Record<string, { overshoot: number; settle: number }> = {
    squashLand: { overshoot: 0.095, settle: 0.313 },
    squashTakeoff: { overshoot: 0.08, settle: 0.44 },
    squashRevival: { overshoot: 0.126, settle: 0.606 },
    chestYaw: { overshoot: 0.064, settle: 0.355 },
    headYaw: { overshoot: 0.051, settle: 0.245 },
    headPitch: { overshoot: 0.126, settle: 0.364 },
    headRoll: { overshoot: 0.046, settle: 0.286 },
    antennaBase: { overshoot: 0.564, settle: 1.412 },
    antennaMid: { overshoot: 0.605, settle: 1.293 },
    earPod: { overshoot: 0.163, settle: 0.286 },
    cape0: { overshoot: 0.37, settle: 1.053 },
    cape1: { overshoot: 0.37, settle: 1.176 },
    cape2: { overshoot: 0.344, settle: 1.234 },
    cape3: { overshoot: 0.32, settle: 1.298 },
    footIk: { overshoot: 0, settle: 0.136 },
    shadowRadius: { overshoot: 0.031, settle: 0.2 },
  }

  it('covers every spring', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(SPRINGS).sort())
  })

  for (const [name, target] of Object.entries(expected)) {
    it(`${name} matches its documented overshoot and settle time`, () => {
      const { omega, zeta } = SPRINGS[name as keyof typeof SPRINGS]
      expect(overshootFor(zeta)).toBeCloseTo(target.overshoot, 2)
      // 5% of the value, which is the tolerance the spec asks for.
      expect(Math.abs(settleTimeFor(omega, zeta) - target.settle)).toBeLessThan(target.settle * 0.05)
    })
  }

  it('gives the foot IK spring no overshoot at all', () => {
    // A foot that overshoots its ground contact is a foot inside the floor, so
    // this is the one spring where critical damping is the right answer.
    expect(overshootFor(SPRINGS.footIk.zeta)).toBe(0)
    expect(peakTimeFor(SPRINGS.footIk.omega, SPRINGS.footIk.zeta)).toBe(Infinity)
  })
})

describe('volume-preserving squash', () => {
  it('holds volume exactly across the whole usable range', () => {
    const out = { sx: 1, sy: 1, sz: 1 }
    for (let s = 0.4; s <= 1.45; s += 0.01) {
      squashScale(s, SQUASH_ANIM.lateral, out)
      expect(Math.abs(out.sx * out.sy * out.sz - 1)).toBeLessThan(1e-6)
    }
  })

  it('holds volume for any lateral bias', () => {
    const out = { sx: 1, sy: 1, sz: 1 }
    for (const lateral of [0.8, 1, 1.1, 1.4]) {
      squash(0.62, lateral, out)
      expect(out.sx * out.sy * out.sz).toBeCloseTo(1, 10)
      expect(out.sx / out.sz).toBeCloseTo(lateral * lateral, 10)
    }
  })

  it('clamps rather than inverting on a garbage input', () => {
    const out = { sx: 1, sy: 1, sz: 1 }
    squashScale(-3, 1.1, out)
    expect(out.sy).toBe(0.4)
    squashScale(1e6, 1.1, out)
    expect(out.sy).toBe(1.45)
  })

  /*
    The measured error in the approximation this replaces. Kept as a test rather
    than as a comment, because the reason for the change is a number and the
    number is the argument.
  */
  it('differs from the old linear approximation exactly where it mattered', () => {
    const approx = (s: number) => 1 + (1 - s) * 0.6
    const exact = (s: number) => 1 / Math.sqrt(s)
    // At the old landSquash the two agree to three decimals, which is why this
    // was never noticed.
    expect(Math.abs(approx(0.78) - exact(0.78))).toBeLessThan(0.001)
    // At the revival's depth the approximation loses 6% of the volume.
    expect(approx(0.55)).toBeCloseTo(1.27, 2)
    expect(exact(0.55)).toBeCloseTo(1.348, 3)
  })
})
