import { describe, expect, it } from 'vitest'
import {
  NOM_COUNT,
  NOM_EVERY,
  NOM_HOLD,
  NOM_OFFSETS,
  NOM_OVERSHOOT,
  NOM_POP,
  NOM_STAGGER,
  chatterCue,
} from './chatterCue'
import { MACHINE_CHATTER } from './dioramaCopy'

/** The belt's own bite period, which the caller supplies. */
const BITE = 4.2 / 5
const ASIDES = MACHINE_CHATTER.asides.length

describe('the machine speaks in a rhythm', () => {
  it('has one offset and one word for each nom', () => {
    expect(MACHINE_CHATTER.bite).toHaveLength(NOM_COUNT)
    expect(NOM_OFFSETS).toHaveLength(NOM_COUNT)
  })

  it('lands the three words one after another, not together', () => {
    /*
      The stagger IS the joke. Three words appearing on the same frame is a
      caption; three arriving in turn is a mouth working.
    */
    const at = (t: number) => chatterCue(t, BITE, ASIDES).scale
    expect(at(0.01)[0]).toBeGreaterThan(0)
    expect(at(0.01)[1]).toBe(0)
    expect(at(0.01)[2]).toBe(0)

    expect(at(NOM_STAGGER + 0.01)[1]).toBeGreaterThan(0)
    expect(at(NOM_STAGGER + 0.01)[2]).toBe(0)

    expect(at(2 * NOM_STAGGER + 0.01)[2]).toBeGreaterThan(0)
  })

  it('overshoots and settles back, rather than growing into place', () => {
    /*
      A word that grows smoothly to size reads as a fade. The overshoot is what
      makes it read as something being said - and it has to come BACK, or the
      three words end up at three different sizes depending on when you look.
    */
    let peak = 0
    for (let t = 0; t < NOM_POP; t += 0.005) peak = Math.max(peak, chatterCue(t, BITE, ASIDES).scale[0])
    expect(peak).toBeGreaterThan(1 + NOM_OVERSHOOT * 0.6)
    expect(peak).toBeLessThanOrEqual(1 + NOM_OVERSHOOT + 1e-9)
    expect(chatterCue(NOM_POP, BITE, ASIDES).scale[0]).toBeCloseTo(1, 6)
    expect(chatterCue(NOM_POP + 0.5, BITE, ASIDES).scale[0]).toBeCloseTo(1, 6)
  })

  it('never draws a word smaller on the way in than it ends up', () => {
    // A dip would read as the word being sucked back rather than landing.
    let last = 0
    for (let t = 0; t <= NOM_POP; t += 0.004) {
      const v = chatterCue(t, BITE, ASIDES).scale[0]
      expect(v, `t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(last - 1e-9)
      if (v > 1 + NOM_OVERSHOOT * 0.5) break
      last = v
    }
  })

  it('holds the burst for about two seconds and then stops', () => {
    const lastLands = (NOM_COUNT - 1) * NOM_STAGGER + NOM_POP
    expect(chatterCue(lastLands + NOM_HOLD - 0.05, BITE, ASIDES).scale[0]).toBeGreaterThan(0)
    expect(chatterCue(lastLands + NOM_HOLD + 0.05, BITE, ASIDES).scale[0]).toBe(0)
  })

  it('does not start a burst before the last one has finished', () => {
    /*
      **The inequality, not the number.** A burst runs `2 * NOM_STAGGER + NOM_POP`
      to land its three words plus `NOM_HOLD` on screen, and the next one starts
      `NOM_EVERY` swallows later. At every third swallow those are 2.66 s and
      2.52 s - so the second burst begins while the first is still up, and the
      machine talks continuously. Asserting the relationship means raising the
      hold fails here rather than quietly re-introducing it.
    */
    const burst = (NOM_COUNT - 1) * NOM_STAGGER + NOM_POP + NOM_HOLD
    expect(burst, 'bursts overlap; raise NOM_EVERY or shorten NOM_HOLD').toBeLessThan(
      NOM_EVERY * BITE,
    )
  })

  it('never shows an aside while the machine has its mouth full', () => {
    for (let t = 0; t < 30; t += 0.02) {
      const cue = chatterCue(t, BITE, ASIDES)
      const speaking = cue.scale.some((v) => v > 0)
      if (speaking) expect(cue.aside, `t=${t.toFixed(2)}`).toBe(-1)
      expect(cue.aside).toBeLessThan(ASIDES)
    }
  })

  it('survives a seeked negative clock', () => {
    // `local` is clamped at zero everywhere else; this is the one that would
    // produce a negative swallow index and a burst that never ends.
    for (const t of [-9, -0.4, 0]) {
      const cue = chatterCue(t, BITE, ASIDES)
      for (const v of cue.scale) expect(v).toBeGreaterThanOrEqual(0)
      expect(cue.aside).toBeGreaterThanOrEqual(-1)
    }
  })

  it('refuses a bite period that would divide by zero', () => {
    expect(() => chatterCue(1, 0, ASIDES)).toThrow(/positive period/)
  })
})
