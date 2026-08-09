import { describe, it, expect } from 'vitest'
import {
  clampTilt,
  createAnimRuntime,
  createGroundSample,
  createPose,
  JOINT_KEYS,
  nextRandom,
  PROPORTIONS,
  randomRange,
  REST,
  REST_ROTATION,
  resetPose,
  stepAnim,
  type GroundSample,
  type Pose,
} from './robotPose'
import { createRobotAnimState, type RobotAnimState } from './robotAnim'
import { BODY, WADDLE } from './tuning'
import { SHADOW, TURN_ANIM } from './animTuning'

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

/*
  The guard that stops a future edit un-toying the character.

  The proportion change is the whole point of the character work, and it is
  exactly the kind of thing undone six months later by someone fixing an
  unrelated problem and thinking the head looks too big. It does look too big.
  That is the design.
*/
describe('proportions', () => {
  it('is between 2.45 and 2.85 head-heights', () => {
    const ratio = PROPORTIONS.totalHeight / PROPORTIONS.headHeight
    expect(ratio).toBeGreaterThanOrEqual(2.45)
    expect(ratio).toBeLessThanOrEqual(2.85)
  })

  it('gives the head 37 to 48 per cent of the silhouette', () => {
    const fraction = PROPORTIONS.headHeight / PROPORTIONS.totalHeight
    expect(fraction).toBeGreaterThanOrEqual(0.37)
    expect(fraction).toBeLessThanOrEqual(0.48)
  })

  /*
    The single most important assertion in this file.

    A head wider than the body is what makes a shape read as an infant rather
    than as a short adult, and it matters more than the head-height ratio. The
    model this replaced had a 0.56 head on a 0.62 torso, which is the same
    relationship inverted, and that one number is most of why it read as a small
    robot instead of as a toy.
  */
  it('keeps the head wider than the widest band below it', () => {
    expect(PROPORTIONS.headWidth).toBeGreaterThan(PROPORTIONS.torsoWidthMax)
    expect(PROPORTIONS.headWidth / PROPORTIONS.torsoWidthMax).toBeGreaterThanOrEqual(1.1)
  })

  it('fits the frozen capsule with headroom', () => {
    // The capsule is 2 * (halfHeight + radius) tall and PlayerController offsets
    // the visual group so model y = 0 sits at its bottom pole.
    const capsuleHeight = 2 * (BODY.capsuleHalfHeight + BODY.capsuleRadius)
    expect(PROPORTIONS.totalHeight).toBeGreaterThanOrEqual(1.3)
    expect(PROPORTIONS.totalHeight).toBeLessThanOrEqual(1.42)
    expect(PROPORTIONS.totalHeight).toBeLessThan(capsuleHeight)
    // Slack, so the head never visually intersects a ceiling the capsule has
    // already stopped against.
    expect(capsuleHeight - PROPORTIONS.totalHeight).toBeGreaterThan(0.02)
  })

  it('puts the sole plane at the model origin', () => {
    // The contact shadow, the foot IK and the VFX emitters all assume this, and
    // it is the reason they can share one coordinate convention.
    expect(PROPORTIONS.soleY).toBe(0)
    // Foot centre plus half the foot's 0.17 height lands on it.
    const footWorldY = REST.hips.y + REST.legL.y + REST.kneeL.y + REST.footL.y
    expect(footWorldY - 0.085).toBeCloseTo(PROPORTIONS.soleY, 9)
  })

  it('stays symmetric left to right', () => {
    expect(REST.legL.x).toBe(-REST.legR.x)
    expect(REST.shoulderL.x).toBe(-REST.shoulderR.x)
    expect(REST.earPodL.x).toBe(-REST.earPodR.x)
    expect(REST_ROTATION.shoulderL!.z).toBe(-REST_ROTATION.shoulderR!.z)
    expect(REST_ROTATION.legL!.y).toBe(-REST_ROTATION.legR!.y)
  })

  it('accumulates up the spine to the head band', () => {
    const hips = REST.hips.y
    const chest = hips + REST.chest.y
    const neck = chest + REST.neck.y
    const head = neck + REST.head.y
    expect(hips).toBeCloseTo(0.52, 9)
    expect(chest).toBeCloseTo(0.74, 9)
    expect(neck).toBeCloseTo(0.89, 9)
    expect(head).toBeCloseTo(1.09, 9)
    // The head shell is centred on that, so the crown is the silhouette top.
    expect(head + PROPORTIONS.headHeight / 2).toBeCloseTo(PROPORTIONS.totalHeight, 9)
  })

  /*
    The arms must angle away from the body, or the fully enclosed white wedge
    between arm and torso closes and the character becomes one blob at distance.
    Asserted on the resulting hand position rather than on the sign of a
    rotation, because the sign is exactly what the design spec gets wrong in one
    of the two places it states it.
  */
  it('swings the hands outboard of the shoulders at rest', () => {
    // Rotating (0, -0.34) about Z by t gives x' = -sin(t) * (-0.34).
    const handX = (shoulderX: number, restZ: number) =>
      shoulderX - Math.sin(restZ) * REST.handSocketL.y
    const left = handX(REST.shoulderL.x, REST_ROTATION.shoulderL!.z)
    const right = handX(REST.shoulderR.x, REST_ROTATION.shoulderR!.z)
    expect(left).toBeLessThan(REST.shoulderL.x)
    expect(right).toBeGreaterThan(REST.shoulderR.x)
  })

  it('keeps a gap between the feet at rest', () => {
    // Feet are 0.32 wide, so a 0.19 half-separation leaves 0.06 of daylight.
    // Feet that touch read as a pedestal rather than as legs.
    const gap = (REST.legR.x - REST.legL.x) - 0.32
    expect(gap).toBeGreaterThanOrEqual(0.06)
  })

  it('keeps the antenna off centre', () => {
    // One asymmetric feature is what stops the silhouette reading as a product
    // shot, so this is a design assertion rather than a sanity check.
    expect(Math.abs(REST.antennaBase.x)).toBeGreaterThan(0.1)
  })
})

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

  The root scale is the one field deliberately excluded. Its recovery spring and
  its volume preservation both changed on purpose in the same pass that fixed
  the damping ratio, and `the squash spring` below covers the new behaviour.
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
        bodyY, bodyRz, bodyRx, bodyRy, headRy,
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
      })

    const expected = reference(script, 600)
    const rt = createAnimRuntime(0xa71a5)
    const pose = createPose()
    const g = createGroundSample()

    for (let i = 0; i < 600; i++) {
      stepAnim(rt, script(i), g, DT, pose)
      const e = expected[i]
      const actual = [
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

describe('the squash spring', () => {
  /** Runs a squash impulse and returns the root Y scale, frame by frame. */
  function landing(depth: number, mode: 'land' | 'takeoff' | 'revival', frames = 60) {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ grounded: true })
    stepAnim(rt, s, g, DT, pose)
    s.squash = depth
    s.squashMode = mode
    s.squashSeq = 1
    const trace: number[] = []
    for (let i = 0; i < frames; i++) {
      stepAnim(rt, s, g, DT, pose)
      trace.push(pose.root.sy)
    }
    return { trace, pose }
  }

  /*
    The bounce the code has claimed to have since it was written.

    PlayerController's spring was `-x * w^2` against `-v * 2 * w`, damping ratio
    exactly 1.0, and its comment said it "overshoots very slightly". It never
    did. This asserts that it now does, and by how much.
  */
  it('overshoots exactly once on a landing', () => {
    const { trace } = landing(0.62, 'land', 120)
    /*
      Deepest on the first frame, because the impulse is a snap rather than a
      ramp. Not exactly 0.62: the impulse is consumed and then integrated by the
      same step, so the first frame the player sees is already one dt into the
      recovery. With the impulse velocity at zero that is 1.2% of the way back,
      which is also why the spec's "compression hold" needs no explicit hold -
      the spring holds itself for about two frames.
    */
    expect(trace[0]).toBeGreaterThan(0.62)
    expect(trace[0]).toBeLessThan(0.65)
    expect(Math.min(...trace)).toBe(trace[0])

    const peak = Math.max(...trace)
    const overshoot = (peak - 1) / (1 - 0.62)
    expect(overshoot).toBeGreaterThan(0.08)
    expect(overshoot).toBeLessThan(0.13)

    /*
      Exactly one bounce the player can see, so it reads as a beat rather than
      as a wobble. Measured against 2% of the step rather than against zero:
      each successive excursion is the previous one times the overshoot ratio,
      so the second is 0.9% of the step and the third 0.09%, and counting raw
      sign changes would count ringing nobody can perceive.
    */
    const step = 1 - 0.62
    let excursions = 0
    let above = false
    for (const y of trace) {
      const nowAbove = y > 1 + step * 0.02
      if (nowAbove && !above) excursions++
      above = nowAbove
    }
    expect(excursions).toBe(1)
  })

  it('settles back to neutral inside the budgeted time', () => {
    const { trace } = landing(0.62, 'land', 90)
    /*
      Measured against the step size rather than against 1.0. The spec asks for
      "within 1% of 1.0 by 350 ms", which contradicts its own table: the same
      row gives squashLand a 5% settle time of 313 ms, and 5% of a 0.38 step is
      0.019 absolute, so 1% absolute is a strictly tighter claim than the
      constants it is describing can meet. 5% of the step is the self-consistent
      bound and it is the one that matches what the eye calls settled.
    */
    const step = 1 - 0.62
    expect(Math.abs(trace[Math.round(0.313 / DT)] - 1)).toBeLessThan(step * 0.05)
    expect(Math.abs(trace[Math.round(0.5 / DT)] - 1)).toBeLessThan(0.005)
  })

  it('preserves volume exactly at every frame of a landing', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ grounded: true, squash: 0.55, squashMode: 'revival', squashSeq: 1 })
    for (let i = 0; i < 200; i++) {
      stepAnim(rt, s, g, DT, pose)
      expect(Math.abs(pose.root.sx * pose.root.sy * pose.root.sz - 1)).toBeLessThan(1e-9)
    }
  })

  it('spreads sideways more than forward', () => {
    // A moulded shell dropped on a floor spreads laterally, and the camera is
    // almost always behind, where lateral spread is the visible axis.
    const { pose } = landing(0.62, 'land', 1)
    expect(pose.root.sx).toBeGreaterThan(pose.root.sz)
  })

  it('runs each mode on its own profile', () => {
    /*
      Takeoff is softer than landing, so the stretch reads through the whole
      rise instead of snapping out of it. Measured as the time to the overshoot
      extremum, which is `pi / (omega * sqrt(1 - zeta^2))` and therefore a
      direct read of omega. Time to reach a fixed absolute tolerance would be
      the wrong metric, because the two impulses are different sizes.
    */
    const peakFrame = (depth: number, mode: 'land' | 'takeoff' | 'revival') => {
      const { trace } = landing(depth, mode, 200)
      let best = 0
      for (let i = 1; i < trace.length; i++) {
        if (Math.abs(trace[i] - 1) > Math.abs(trace[best] - 1) === false && i > 5) break
      }
      // The extremum past neutral, which is the far side of the first crossing.
      const crossing = trace.findIndex((y) => (depth < 1 ? y > 1 : y < 1))
      best = crossing
      for (let i = crossing; i < trace.length; i++) {
        if (Math.abs(trace[i] - 1) >= Math.abs(trace[best] - 1)) best = i
        else break
      }
      return best
    }
    // 245 ms against 364 ms, so 15 frames against 22 at 60 Hz.
    expect(peakFrame(1.18, 'takeoff')).toBeGreaterThan(peakFrame(0.62, 'land'))
    // Revival is the slowest of the three, so the arrival reads as a bounce.
    expect(peakFrame(0.55, 'revival')).toBeGreaterThan(peakFrame(1.18, 'takeoff'))
  })

  /*
    Two landings of the same depth back to back are two events, and the second
    has to re-seed the spring. Comparing values rather than a sequence number
    would silently swallow it, and the bug would read as "sometimes a landing
    does not squash", which is exactly the kind of thing nobody can reproduce.
  */
  it('re-seeds on a repeated impulse of identical depth', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ grounded: true, squash: 0.7, squashMode: 'land', squashSeq: 1 })
    for (let i = 0; i < 20; i++) stepAnim(rt, s, g, DT, pose)
    expect(pose.root.sy).toBeGreaterThan(0.8)

    s.squashSeq = 2
    stepAnim(rt, s, g, DT, pose)
    // Back to the impulse depth, less the one frame of recovery the same step
    // applies. Nothing else could put it there.
    expect(pose.root.sy).toBeGreaterThan(0.7)
    expect(pose.root.sy).toBeLessThan(0.72)
  })

  it('ignores a repeated state with no new impulse', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ grounded: true, squash: 0.7, squashMode: 'land', squashSeq: 1 })
    for (let i = 0; i < 200; i++) stepAnim(rt, s, g, DT, pose)
    // Recovered and stayed there, rather than re-snapping every frame.
    expect(pose.root.sy).toBeCloseTo(1, 3)
  })
})

describe('clampTilt', () => {
  const out = { x: 0, y: 0, z: 0 }
  const angleFromUp = () => Math.acos(Math.min(1, Math.max(-1, out.y)))

  it('leaves a normal inside the clamp untouched', () => {
    const n = { x: Math.sin(0.2), y: Math.cos(0.2), z: 0 }
    clampTilt(n.x, n.y, n.z, 0.61, out)
    expect(out.x).toBeCloseTo(n.x, 12)
    expect(out.y).toBeCloseTo(n.y, 12)
  })

  /*
    The property the whole function exists for: a steep face is tilted back
    toward vertical without changing which way it leans. A shadow lying flush on
    a hillside reads as a decal painted on it.
  */
  it('clamps a steep normal to exactly the limit, preserving azimuth', () => {
    const steep = (60 * Math.PI) / 180
    const limit = (35 * Math.PI) / 180
    const az = 1.234
    clampTilt(Math.sin(steep) * Math.cos(az), Math.cos(steep), Math.sin(steep) * Math.sin(az), limit, out)
    expect(angleFromUp()).toBeCloseTo(limit, 9)
    expect(Math.atan2(out.z, out.x)).toBeCloseTo(az, 9)
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12)
  })

  it('normalises an input that is not unit length', () => {
    clampTilt(0, 7, 0, 0.61, out)
    expect(out.y).toBeCloseTo(1, 12)
  })

  it('returns straight up for a degenerate or downward normal', () => {
    clampTilt(0, 0, 0, 0.61, out)
    expect([out.x, out.y, out.z]).toEqual([0, 1, 0])
    // Straight down has no azimuth to preserve, so any choice would be arbitrary.
    clampTilt(0, -1, 0, 0.61, out)
    expect([out.x, out.y, out.z]).toEqual([0, 1, 0])
  })
})

describe('the contact shadow', () => {
  function shadowAfter(frames: number, mutate: (g: GroundSample, s: RobotAnimState) => void) {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    const s = state({ grounded: true })
    g.hit = true
    mutate(g, s)
    for (let i = 0; i < frames; i++) stepAnim(rt, s, g, DT, pose)
    return pose.shadow
  }

  it('sits directly under the body at the contact point', () => {
    const sh = shadowAfter(30, (g, s) => {
      s.worldX = 3
      s.worldZ = -4
      g.y = 1.25
    })
    expect(sh.x).toBe(3)
    expect(sh.z).toBe(-4)
    expect(sh.y).toBe(1.25)
  })

  it('is full strength and base size on the ground', () => {
    const sh = shadowAfter(60, (g) => void (g.distance = 0))
    expect(sh.opacity).toBeCloseTo(SHADOW.maxOpacity, 9)
    expect(sh.radius).toBeCloseTo(SHADOW.baseRadius, 3)
  })

  /*
    Growing and fading together is the behaviour of a penumbra from a
    finite-size source, and it is what makes jump height readable: a player
    judging a landing reads the shadow rather than the character.
  */
  it('grows and fades together with height', () => {
    const low = shadowAfter(120, (g) => void (g.distance = 0.3))
    const high = shadowAfter(120, (g) => void (g.distance = 2))
    expect(high.radius).toBeGreaterThan(low.radius)
    expect(high.opacity).toBeLessThan(low.opacity)
  })

  it('vanishes entirely at the maximum height', () => {
    const sh = shadowAfter(120, (g) => void (g.distance = SHADOW.maxHeight))
    expect(sh.opacity).toBeCloseTo(0, 9)
  })

  it('goes to zero opacity when the ray finds nothing at all', () => {
    const sh = shadowAfter(30, (g) => {
      g.hit = false
      g.distance = 0
    })
    expect(sh.opacity).toBe(0)
    // The radius is still written, so nothing has to special-case a hidden quad.
    expect(sh.radius).toBeGreaterThan(0)
  })

  it('elongates along the direction of travel at speed', () => {
    const still = shadowAfter(30, (_g, s) => void (s.speedNorm = 0))
    const fast = shadowAfter(30, (_g, s) => {
      s.speedNorm = 1
      s.facing = 1.1
    })
    expect(still.stretch).toBeCloseTo(1, 9)
    expect(fast.stretch).toBeCloseTo(SHADOW.maxStretch, 9)
    expect(fast.yaw).toBeCloseTo(1.1, 9)
  })

  it('clamps its tilt on a slope steeper than the limit', () => {
    const steep = (70 * Math.PI) / 180
    const sh = shadowAfter(5, (g) => {
      g.nx = Math.sin(steep)
      g.ny = Math.cos(steep)
      g.nz = 0
    })
    expect(Math.acos(sh.ny)).toBeCloseTo(SHADOW.maxTilt, 9)
  })

  /*
    The impact cue that runs on every tier, including the one with no particles
    at all. A dark ring snapping outward and settling in 200 ms is a genuinely
    good landing beat and it costs one uniform write.
  */
  it('spikes outward on a landing and settles back', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    g.hit = true
    const s = state({ grounded: true })
    for (let i = 0; i < 60; i++) stepAnim(rt, s, g, DT, pose)
    const resting = pose.shadow.radius

    s.squash = 0.62
    s.squashMode = 'land'
    s.squashSeq = 1
    stepAnim(rt, s, g, DT, pose)
    expect(pose.shadow.radius).toBeGreaterThan(resting * 1.4)

    for (let i = 0; i < 30; i++) stepAnim(rt, s, g, DT, pose)
    expect(pose.shadow.radius).toBeCloseTo(resting, 2)
  })

  it('does not spike on a takeoff', () => {
    const rt = createAnimRuntime(1)
    const pose = createPose()
    const g = createGroundSample()
    g.hit = true
    const s = state({ grounded: true })
    for (let i = 0; i < 60; i++) stepAnim(rt, s, g, DT, pose)
    const resting = pose.shadow.radius

    s.squash = 1.18
    s.squashMode = 'takeoff'
    s.squashSeq = 1
    stepAnim(rt, s, g, DT, pose)
    expect(pose.shadow.radius).toBeCloseTo(resting, 3)
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
