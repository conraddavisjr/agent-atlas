import { describe, it, expect } from 'vitest'
import {
  createAnimRuntime,
  createGroundSample,
  createPose,
  JOINT_KEYS,
  nextRandom,
  randomRange,
  resetPose,
  stepAnim,
  type GroundSample,
  type Pose,
} from './robotPose'
import { createRobotAnimState, type RobotAnimState } from './robotAnim'
import { WADDLE } from './tuning'
import { TURN_ANIM } from './animTuning'

const DT = 1 / 60

function state(over: Partial<RobotAnimState> = {}): RobotAnimState {
  return { ...createRobotAnimState(), ...over }
}

/** Flattens a pose to a plain array, for whole-struct comparisons. */
function flattenPose(p: Pose): number[] {
  const out: number[] = []
  const push = (j: { px: number; py: number; pz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number }) => {
    out.push(j.px, j.py, j.pz, j.rx, j.ry, j.rz, j.sx, j.sy, j.sz)
  }
  for (const key of JOINT_KEYS) push(p[key])
  for (const seg of p.cape) push(seg)
  const f = p.face
  out.push(f.openL, f.openR, f.archL, f.archR, f.widthL, f.widthR, f.gazeX, f.gazeY, f.brightness, f.scan, f.scanPhase, f.glitch)
  const s = p.shadow
  out.push(s.x, s.y, s.z, s.nx, s.ny, s.nz, s.radius, s.opacity, s.stretch, s.yaw)
  return out
}

/** Runs a script of `(state, dt)` pairs and returns the final pose, flattened. */
function run(seed: number, frames: number, at: (i: number) => RobotAnimState, ground?: GroundSample): number[] {
  const rt = createAnimRuntime(seed)
  const pose = createPose()
  const g = ground ?? createGroundSample()
  for (let i = 0; i < frames; i++) stepAnim(rt, at(i), g, DT, pose)
  return flattenPose(pose)
}

describe('the pose buffer', () => {
  it('starts at identity with neutral scales', () => {
    const p = createPose()
    for (const key of JOINT_KEYS) {
      expect(p[key].px).toBe(0)
      expect(p[key].rx).toBe(0)
      expect(p[key].sx).toBe(1)
      expect(p[key].sy).toBe(1)
      expect(p[key].sz).toBe(1)
    }
    expect(p.cape).toHaveLength(4)
  })

  it('resets every joint including the cape', () => {
    const p = createPose()
    for (const key of JOINT_KEYS) {
      p[key].px = 3
      p[key].rz = 3
      p[key].sy = 3
    }
    for (const seg of p.cape) seg.rx = 3
    resetPose(p)
    for (const key of JOINT_KEYS) {
      expect(p[key].px).toBe(0)
      expect(p[key].rz).toBe(0)
      expect(p[key].sy).toBe(1)
    }
    for (const seg of p.cape) expect(seg.rx).toBe(0)
  })
})

describe('stepAnim', () => {
  it('is deterministic for the same seed and script', () => {
    const script = (i: number) =>
      state({ speedNorm: Math.sin(i * 0.01) * 0.5 + 0.5, turnNorm: Math.cos(i * 0.02), throttle: 1, grounded: i % 97 !== 0 })
    expect(run(0xa71a5, 600, script)).toEqual(run(0xa71a5, 600, script))
  })

  /*
    `dt = 0` has to be a genuine freeze rather than a slow drift, because hit-stop
    is implemented by handing the solver a zero step and nothing else. A solver
    that advanced a phase by a constant per call rather than per second would
    pass every other test here and fail this one.
  */
  it('changes nothing at dt zero', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ speedNorm: 1, turnNorm: 0.5, throttle: 1 })
    for (let i = 0; i < 30; i++) stepAnim(rt, s, g, DT, pose)
    const before = flattenPose(pose)
    stepAnim(rt, s, g, 0, pose)
    stepAnim(rt, s, g, 0, pose)
    expect(flattenPose(pose)).toEqual(before)
  })

  it('stays finite under abuse', () => {
    const rt = createAnimRuntime(7)
    const pose = createPose()
    const g = createGroundSample()
    g.hit = false
    const nasty = state({
      speedNorm: 1e9,
      turnNorm: NaN,
      throttle: Infinity,
      squash: NaN,
      grounded: false,
      verticalVelocity: -1e12,
    })
    for (let i = 0; i < 20; i++) stepAnim(rt, nasty, g, 10, pose)
    for (const v of flattenPose(pose)) expect(Number.isFinite(v)).toBe(true)
    for (const key of JOINT_KEYS) {
      expect(pose[key].sx).toBeGreaterThan(0.3)
      expect(pose[key].sx).toBeLessThan(2)
      expect(pose[key].sy).toBeGreaterThan(0.3)
      expect(pose[key].sy).toBeLessThan(2)
    }
  })

  it('never grows the pose object', () => {
    const rt = createAnimRuntime(3)
    const pose = createPose()
    const g = createGroundSample()
    const keysBefore = Object.keys(pose).sort()
    const headBefore = pose.head
    const capeBefore = pose.cape
    for (let i = 0; i < 10_000; i++) {
      stepAnim(rt, state({ speedNorm: (i % 100) / 100, turnNorm: Math.sin(i) }), g, DT, pose)
    }
    // The realistic failure is a solver assigning a fresh object to a joint,
    // which a GC assertion could not catch reliably in vitest anyway.
    expect(Object.keys(pose).sort()).toEqual(keysBefore)
    expect(pose.head).toBe(headBefore)
    expect(pose.cape).toBe(capeBefore)
  })
})

describe('the gait, ported from the component', () => {
  /*
    The behaviour that was just added and must not be lost in the refactor.

    A pivot on the spot produces no velocity at all, so the step cycle has to be
    driven by turn input as well as by speed, or the robot rotates with its feet
    planted like a turret. This asserts the exact rate.
  */
  it('advances the step cycle on a turn in place', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ speedNorm: 0, turnNorm: 1, grounded: true })
    // Long enough that the exponential ease on turnEased has converged.
    for (let i = 0; i < 300; i++) stepAnim(rt, s, g, DT, pose)
    const before = rt.phase
    for (let i = 0; i < 60; i++) stepAnim(rt, s, g, DT, pose)
    const rate = (rt.phase - before) / (60 * DT)
    expect(rate).toBeCloseTo(WADDLE.bobFrequency * TURN_ANIM.stepScale, 3)
  })

  it('leads with the head and lags with the body', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ turnNorm: 1, grounded: true })
    for (let i = 0; i < 120; i++) {
      stepAnim(rt, s, g, DT, pose)
      if (i > 3) {
        // The head's own offset opposes the body's lag, so the net head yaw is
        // ahead of the turn while the torso is behind it.
        expect(Math.sign(pose.head.ry)).toBe(-Math.sign(pose.hips.ry))
      }
    }
  })

  it('tucks the limbs in the air rather than freezing mid-stride', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    for (let i = 0; i < 30; i++) stepAnim(rt, state({ speedNorm: 1, grounded: false }), g, DT, pose)
    expect(pose.legL.rx).toBeLessThan(0)
    expect(pose.legR.rx).toBeLessThan(0)
    expect(pose.shoulderL.rx).toBeLessThan(pose.legL.rx)
    expect(pose.shoulderR.rx).toBeLessThan(pose.legR.rx)
  })

  it('does not walk while airborne', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    for (let i = 0; i < 30; i++) stepAnim(rt, state({ speedNorm: 1, grounded: false }), g, DT, pose)
    // Bob and roll are gated on `walking`, which is zero off the ground.
    expect(pose.hips.py).toBe(0)
    expect(pose.hips.rz).toBe(0)
  })

  /*
    A waddle with a net bias is a limp. Integrating the roll over a whole number
    of step cycles has to come back to zero, or the character leans permanently
    to one side while walking and nobody can say why.
  */
  it('has a symmetric waddle over a full step cycle', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ speedNorm: 1, grounded: true, throttle: 1 })
    // One cycle is 2*pi radians of phase at bobFrequency * stride rad/s.
    const cycleSeconds = (2 * Math.PI) / WADDLE.bobFrequency
    const steps = 4000
    const dt = cycleSeconds / steps
    let rollSum = 0
    let bobSum = 0
    for (let i = 0; i < steps; i++) {
      stepAnim(rt, s, g, dt, pose)
      rollSum += pose.hips.rz * dt
      bobSum += pose.hips.py * dt
    }
    expect(Math.abs(rollSum)).toBeLessThan(1e-3)
    expect(Math.abs(bobSum)).toBeLessThan(1e-3)
  })
})

/*
  The regression net for the extraction itself.

  This is a transcription of the arithmetic exactly as it was inline in
  `RobotModel.tsx`'s `useFrame` before it moved. If `stepAnim` and this disagree
  on any frame of a scripted run, the refactor changed the animation, which is
  precisely what it was not allowed to do.

  It is deliberately a duplicate rather than a call into the real thing. A test
  that shares an implementation with the code it checks proves only that the
  code equals itself.
*/
describe('the port preserved the original arithmetic', () => {
  function reference(script: (i: number) => RobotAnimState, frames: number) {
    let phase = 0
    let turn = 0
    const out: number[][] = []
    for (let i = 0; i < frames; i++) {
      const a = script(i)
      const dt = DT
      turn += (a.turnNorm - turn) * (1 - Math.exp(-TURN_ANIM.damping * dt))
      const t = turn
      const stride = Math.max(a.speedNorm, Math.abs(t) * TURN_ANIM.stepScale)
      phase += dt * WADDLE.bobFrequency * stride
      const walking = a.grounded ? stride : 0
      const p = phase
      const s = a.squash
      const widen = 1 + (1 - s) * 0.6

      const rootScale = [widen, s, widen]
      const bodyY = Math.sin(p * 2) * WADDLE.bobAmplitude * walking
      const bodyRz = Math.sin(p) * WADDLE.rollAmplitude * walking + t * TURN_ANIM.bankAmount
      const bodyRx = WADDLE.leanAmount * walking * Math.sign(a.throttle)
      const bodyRy = t * TURN_ANIM.torsoLag
      const headRy = -t * (TURN_ANIM.torsoLag + TURN_ANIM.headLead)
      const swing = Math.sin(p) * WADDLE.limbSwing * walking
      const airborne = a.grounded ? 0 : 1
      const tuck = airborne * 0.5
      const legLRx = swing - tuck
      const legRRx = -swing - tuck
      const armLRx = -swing * 0.7 - tuck * 1.4
      const armRRx = swing * 0.7 - tuck * 1.4
      const splay = t * TURN_ANIM.footPivot * (a.grounded ? 1 : 0)

      out.push([
        ...rootScale, bodyY, bodyRz, bodyRx, bodyRy, headRy,
        legLRx, legRRx, armLRx, armRRx, splay, -splay,
      ])
    }
    return out
  }

  it('matches frame for frame over a varied 600 frame script', () => {
    const script = (i: number): RobotAnimState =>
      state({
        speedNorm: Math.abs(Math.sin(i * 0.013)),
        turnNorm: Math.sin(i * 0.021),
        throttle: i % 200 < 100 ? 1 : -1,
        grounded: i % 150 < 120,
        squash: 1 + Math.sin(i * 0.05) * 0.2,
      })

    const expected = reference(script, 600)
    const rt = createAnimRuntime(0xa71a5)
    const pose = createPose()
    const g = createGroundSample()

    for (let i = 0; i < 600; i++) {
      stepAnim(rt, script(i), g, DT, pose)
      const e = expected[i]
      const actual = [
        pose.root.sx, pose.root.sy, pose.root.sz,
        pose.hips.py, pose.hips.rz, pose.hips.rx, pose.hips.ry,
        pose.head.ry,
        pose.legL.rx, pose.legR.rx,
        pose.shoulderL.rx, pose.shoulderR.rx,
        pose.legL.ry, pose.legR.ry,
      ]
      for (let k = 0; k < e.length; k++) {
        expect(actual[k], `frame ${i} field ${k}`).toBeCloseTo(e[k], 12)
      }
    }
  })
})

describe('the seeded rng', () => {
  it('returns the unit interval and repeats for a given seed', () => {
    const a = { s: 12345 }
    const b = { s: 12345 }
    for (let i = 0; i < 1000; i++) {
      const v = nextRandom(a)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(v).toBe(nextRandom(b))
    }
  })

  it('spans a requested range without leaving it', () => {
    const rng = { s: 99 }
    for (let i = 0; i < 5000; i++) {
      const v = randomRange(rng, 4, 8)
      expect(v).toBeGreaterThanOrEqual(4)
      expect(v).toBeLessThan(8)
    }
  })
})
