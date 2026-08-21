import { describe, expect, it } from 'vitest'
import { THRUSTER, easeOutBack, groundGate, thrusterEnvelope, thrusterLife } from './thruster'
import { AIR_JUMP } from './tuning'

/*
  The envelope is the claim that the beam is at full width exactly when the lift
  is at full strength, and that the two end together.

  It is worth testing rather than eyeballing for the reason this project's handoff
  opens with: an effect that is merely slightly out of step with its cause looks
  fine in a still frame and wrong in motion, and there is no screenshot that
  distinguishes them.
*/

describe('the thruster envelope', () => {
  const D = AIR_JUMP.thrustTime
  const LIFE = thrusterLife()

  it('is off before the press and off after the tail', () => {
    expect(thrusterEnvelope(0)).toBe(0)
    expect(thrusterEnvelope(-0.1)).toBe(0)
    expect(thrusterEnvelope(LIFE)).toBe(0)
    expect(thrusterEnvelope(LIFE + 1)).toBe(0)
  })

  it('OUTLIVES the physics, which is the whole reason it runs on age', () => {
    /*
      The gravity cut ends at `AIR_JUMP.thrustTime`. A beam that ended there too
      would cut out in one frame and read as a dropped frame rather than as a
      thruster shutting down, so the flame is still burning when the force stops.

      This is the assertion that fails if someone "simplifies" the VFX back onto
      `thrust`, which counts down to zero at exactly `D` and cannot express it.
    */
    expect(thrusterEnvelope(D)).toBeGreaterThan(0.9)
    expect(thrusterEnvelope(D + THRUSTER.decay * 0.5)).toBeGreaterThan(0)
    expect(LIFE).toBeGreaterThan(D)
  })

  it('lights within three frames, and overshoots on the way', () => {
    /*
      Ignition is the beat. If the beam takes longer than this the lift it is
      supposed to be causing arrives first, and the effect reads as a reaction to
      the jump rather than as its cause.

      The overshoot is what makes it read as ignition rather than as a fade-in: a
      thruster lights with a pop.
    */
    expect(THRUSTER.ignition).toBeLessThan(3 / 60)
    expect(thrusterEnvelope(THRUSTER.ignition)).toBe(1)

    let peak = 0
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, thrusterEnvelope(THRUSTER.ignition * (i / 200)))
    expect(peak).toBeGreaterThan(1.05)
    expect(peak).toBeLessThan(1.15)
  })

  it('holds near full through the tail rather than dimming linearly', () => {
    /*
      `1 - t^3`, so the beam looks like it is still burning until it very obviously
      is not. A linear fade spends most of the tail in a grey middle that reads as
      a translucent cone rather than as a flame.
    */
    const quarter = thrusterEnvelope(D + THRUSTER.decay * 0.25)
    expect(quarter).toBeGreaterThan(0.98)
    const half = thrusterEnvelope(D + THRUSTER.decay * 0.5)
    expect(half).toBeGreaterThan(0.85)
    // And it does reach the floor rather than being cut off mid-value.
    expect(thrusterEnvelope(D + THRUSTER.decay * 0.999)).toBeLessThan(0.01)
  })

  it('never goes negative, at any point in its life', () => {
    // `easeOutBack` leaves the unit interval at the top ON PURPOSE and must not at
    // the bottom: a negative scale mirrors the geometry, which renders without an
    // error and points the beam at the sky.
    for (let i = 0; i <= 400; i++) {
      expect(thrusterEnvelope(LIFE * (i / 400))).toBeGreaterThanOrEqual(0)
    }
  })

  it('scales with the burn rather than assuming its length', () => {
    // The beam follows a retune of `AIR_JUMP.thrustTime` with no edit of its own,
    // which is why `duration` is a parameter at all. The tail is a fixed time and
    // does not scale, so the sustain is what moves.
    expect(thrusterEnvelope(0.3, 0.4)).toBe(1)
    expect(thrusterEnvelope(0.3, 0.2)).toBeLessThan(1)
  })

  it('pins easeOutBack against its own definition', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 12)
    expect(easeOutBack(1)).toBeCloseTo(1, 12)
  })
})

describe('the ground gate', () => {
  it('hides the beam while the character is standing', () => {
    /*
      Which is why nothing here needs to know about the jump state. A grounded
      character has zero sole clearance, so the gate is closed, and the correct
      behaviour falls out of the rule rather than being special-cased.
    */
    expect(groundGate(0)).toBe(0)
    expect(groundGate(THRUSTER.gateNear)).toBe(0)
  })

  it('opens fully once the character is clear of its own contact shadow', () => {
    expect(groundGate(THRUSTER.gateFar)).toBe(1)
    expect(groundGate(10)).toBe(1)
  })

  it('ramps rather than popping on at a fixed height', () => {
    // A beam that switches on at a threshold pops during a rise the player is
    // watching, which is the one moment they are looking straight at it.
    const mid = groundGate((THRUSTER.gateNear + THRUSTER.gateFar) / 2)
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
  })
})

describe('the beam fits the sole it comes out of', () => {
  it('is wider than the sole light and narrower than the sole flat', () => {
    /*
      Both ends matter. Narrower than `SOLE_LIGHT` and the beam would appear to
      come out of the middle of the mark rather than from the mark; wider than the
      flat and its nozzle overhangs the boot's fillet, which reads as a cone
      hovering under the foot rather than as a port in it.

      The numbers are `SOLE_LIGHT.radius` 0.023 and a sole flat of 0.0334, both of
      which `robotGeometry.ts` derives and neither of which is restated here.
    */
    expect(THRUSTER.nozzle).toBeGreaterThan(0.023)
    expect(THRUSTER.nozzle).toBeLessThan(0.0334)
  })

  it('tapers, so it has a direction', () => {
    expect(THRUSTER.tip).toBeLessThan(THRUSTER.nozzle / 3)
  })

  it('is shorter than the character, so it never reads as a support leg', () => {
    // A beam that reaches the floor on a normal jump reads as something holding
    // the character up rather than as thrust coming out of it.
    expect(THRUSTER.length).toBeLessThan(0.25)
  })
})
