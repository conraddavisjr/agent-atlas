import { describe, expect, it } from 'vitest'
import {
  HAT_PROFILE,
  HAT_STARS,
  WIZARD_HAT,
  hatBends,
  hatRadiusAt,
  hatSlopeAt,
} from './wizardHat'
import { INSTRUCTOR_HEAD } from './instructorFace'

/** The top of the head the hat is worn on, which is what the brim can lift to. */
const HEAD_TOP = INSTRUCTOR_HEAD.b

describe('the silhouette is a wizard hat and not a cone', () => {
  it('narrows all the way up, without a bulge', () => {
    // A profile that widened anywhere would put a shoulder in the middle of the
    // crown, which reads as a fault in the model rather than as a style.
    for (let i = 1; i < HAT_PROFILE.length; i++) {
      expect(HAT_PROFILE[i][0], `point ${i} radius`).toBeLessThan(HAT_PROFILE[i - 1][0])
      expect(HAT_PROFILE[i][1], `point ${i} height`).toBeGreaterThan(HAT_PROFILE[i - 1][1])
    }
  })

  it('is CONCAVE, which is the whole difference from the cone it replaces', () => {
    /*
      **The shape assertion.**

      A cone loses radius at a constant rate. A wizard hat loses most of it early
      and then runs on in a long slender taper, which is what gives the silhouette
      a shoulder near the brim and a whip near the tip. The version this replaces
      was `coneGeometry` - a constant rate - and it read as a party hat.

      Measured as the rate itself falling: each segment must shed radius per metre
      of height no faster than the one below it.
    */
    const rates = []
    for (let i = 1; i < HAT_PROFILE.length; i++) {
      const dr = HAT_PROFILE[i - 1][0] - HAT_PROFILE[i][0]
      const dy = HAT_PROFILE[i][1] - HAT_PROFILE[i - 1][1]
      rates.push(dr / dy)
    }
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `segment ${i} sheds faster than the one below it`).toBeLessThanOrEqual(
        rates[i - 1] + 1e-9,
      )
    }
    // And the difference is real, not a rounding: the first segment sheds at
    // least twice as fast as the last.
    expect(rates[0]).toBeGreaterThan(rates[rates.length - 1] * 2)
  })

  it('ends at a finite radius, so the floppy tip can continue from it', () => {
    /*
      A lathe closed to zero would put a pinch in the middle of what is meant to
      be one continuous form. The tip carries on from this radius, so it has to be
      small enough to read as a tip and large enough to meet the ribbon.
    */
    const top = HAT_PROFILE[HAT_PROFILE.length - 1][0]
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(HAT_PROFILE[0][0] * 0.15)
  })

  it('agrees with the height the component builds against', () => {
    // `WIZARD_HAT.height` is where the tip is mounted. A profile that stopped
    // somewhere else would hang the tip in mid-air above the crown.
    expect(WIZARD_HAT.height).toBeCloseTo(HAT_PROFILE[HAT_PROFILE.length - 1][1], 9)
    expect(WIZARD_HAT.radius).toBeCloseTo(HAT_PROFILE[0][0], 9)
  })

  it('gives the brim a clear margin over the crown', () => {
    /*
      A brim at the crown's own radius is a rim - it reads as a seam where the
      cone meets the head, which is what the first version had. The brim is the
      second horizontal that turns a cone into a hat.
    */
    expect(WIZARD_HAT.brimRadius).toBeGreaterThan(WIZARD_HAT.radius * 1.25)
  })

  it('leans enough to read, and not so far it falls off', () => {
    /*
      The lean is what stops a wizard hat being a traffic cone, and it has a real
      ceiling rather than a matter of taste: the brim lifts on its high side by
      `brimRadius * sin(lean)`, and once that exceeds the height it is mounted at
      the hat has left the head.

      Checked against `lift` rather than against a number, so raising the lean and
      lowering the seat - which is exactly the trade that was made here - stays
      legal, and doing one without the other does not.
    */
    expect(WIZARD_HAT.lean, 'the hat barely leans').toBeGreaterThan(0.3)
    const lift = WIZARD_HAT.brimRadius * Math.sin(WIZARD_HAT.lean)
    expect(lift, 'the brim has lifted off the head').toBeLessThan(WIZARD_HAT.lift + HEAD_TOP)
  })

  it('puts the band on the cloth, not floating off it', () => {
    // Its own tube has to reach the crown's surface at the height it sits at.
    const surface = hatRadiusAt(WIZARD_HAT.bandY)
    expect(WIZARD_HAT.bandRadius + WIZARD_HAT.bandTube).toBeGreaterThan(surface)
    expect(WIZARD_HAT.bandRadius - WIZARD_HAT.bandTube).toBeLessThan(surface)
  })
})

describe('the stars sit on the cloth', () => {
  it('is placed at the profile\'s own radius for its height', () => {
    /*
      `hatRadiusAt` walks the same points the lathe interpolates between, so a
      star placed by it lands on the surface the player sees rather than on an
      idealised cone the surface only approximates.
    */
    for (const star of HAT_STARS) {
      const r = hatRadiusAt(star.y)
      expect(r).toBeGreaterThan(0)
      expect(r).toBeLessThanOrEqual(HAT_PROFILE[0][0])
    }
  })

  it('stays on the crown rather than sliding off either end', () => {
    for (const star of HAT_STARS) {
      expect(star.y).toBeGreaterThan(0)
      expect(star.y).toBeLessThan(WIZARD_HAT.height)
      // And the star itself has to fit on the cloth at that height.
      expect(star.size).toBeLessThan(hatRadiusAt(star.y) * 1.6)
    }
  })

  it('faces the front, where the player is', () => {
    /*
      The instructor turns to face the player and holds there for its whole eight
      seconds. Stars on the back of the hat are stars nobody sees, so every one is
      within a right angle of front.
    */
    for (const star of HAT_STARS) expect(Math.abs(star.theta)).toBeLessThan(Math.PI / 2)
  })

  it('scatters rather than forming a ring or a line', () => {
    // Five at one height is a party hat again; five at one angle is a stripe.
    const heights = new Set(HAT_STARS.map((s) => s.y))
    const angles = new Set(HAT_STARS.map((s) => s.theta))
    expect(heights.size).toBe(HAT_STARS.length)
    expect(angles.size).toBe(HAT_STARS.length)
  })

  it('gets smaller toward the tip, because the cloth does', () => {
    // A star the same size all the way up would overflow the taper near the top.
    const sorted = [...HAT_STARS].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].size).toBeLessThan(sorted[i - 1].size)
    }
  })

  it('lies flat against the taper rather than standing off it', () => {
    /*
      `hatSlopeAt` is the pitch that lays a decal on the cloth. The crown leans
      inward as it rises, so the slope is negative all the way up - a positive one
      anywhere would tilt a star the wrong way and it would read as peeling off.
    */
    for (const star of HAT_STARS) {
      const slope = hatSlopeAt(star.y)
      expect(slope, `star at ${star.y}`).toBeLessThan(0)
      // And never so steep that the star is edge-on to the viewer.
      expect(Math.abs(slope)).toBeLessThan(Math.PI / 3)
    }
  })
})

describe('the tip flops', () => {
  it('has a rest curl, which is the bug that made it a floating card', () => {
    /*
      **The regression test.**

      The tip used to hang off the apex with no rest bend and a half turn that
      pointed it straight up, so it stood over the cone as a separate vertical
      rectangle. A floppy hat tip flops before any velocity is involved.
    */
    const rest = hatBends(0, 0, 0)
    const total = rest.reduce((sum, bend) => sum + Math.hypot(bend.rx, bend.rz), 0)
    expect(total, 'the tip does not curl at rest').toBeGreaterThan(1)
    // But not so far that it folds back through the crown it hangs from.
    expect(total).toBeLessThan(Math.PI)
  })

  it('flops toward the player rather than behind the hat', () => {
    /*
      **The second regression, and the quieter one.**

      Giving the tip a rest curl on X alone folded it directly away from the face.
      It was there, it was flopping, and it was behind the crown - so the hat
      still read as a clean cone with a point and nothing on screen said anything
      was wrong. A tip nobody can see is the same as no tip.

      The instructor faces the player for its whole eight seconds, so the curl has
      to carry the tip FORWARD, which is negative rx in the hat's own frame, and
      out to the side, where it stays visible as the head turns on its way in.
    */
    const rest = hatBends(0, 0, 0)
    const forward = rest.reduce((sum, bend) => sum + bend.rx, 0)
    const sideways = rest.reduce((sum, bend) => sum + bend.rz, 0)
    expect(forward, 'the tip folds back behind the crown').toBeLessThan(0)
    expect(Math.abs(sideways), 'the tip has no sideways lay').toBeGreaterThan(0.3)
  })

  it('curls evenly at rest and whips only when it moves', () => {
    /*
      Cloth folds most where it leaves its support, so a hanging tip is an arc -
      equal bend per segment. The taper weights the MOTION, which is where whip
      belongs; applied to the rest droop it would curl the far end tightly and
      leave the root straight, which is a whip cracking, not a hat hanging.
    */
    const rest = hatBends(0, 0, 0)
    /*
      Nearly equal, not exactly - the idle sway is live at rest and it IS weighted
      by the taper, which is right: a hat swaying in still air should whip at its
      tip. The first version of this assertion demanded exact equality and failed
      on that sway, which would have been a true statement about a hat with no
      ambience at all.
    */
    const curls = rest.map((b) => Math.hypot(b.rx, b.rz))
    const spread = Math.max(...curls) - Math.min(...curls)
    expect(spread, 'the rest curl is a whip, not an arc').toBeLessThan(WIZARD_HAT.droop * 0.3)

    /*
      Averaged over time as well as over segments, which is what isolates the
      droop from the ambience. At t = 0 the cross-sway is at its own maximum -
      `cos(0)` - so a single sample there reads 0.066 high and an assertion
      against it would either fail or be loosened until it meant nothing.
    */
    let sumX = 0
    let sumZ = 0
    let count = 0
    // Long enough that the two sway periods - 4.65 s and 6.04 s, which share no
    // common multiple with any round window - average down below the tolerance.
    for (let t = 0; t < 400; t += 0.05) {
      for (const bend of hatBends(0, 0, t)) {
        sumX += bend.rx
        sumZ += bend.rz
        count++
      }
    }
    /*
      The two axes SEPARATELY, not the magnitude of the pair. A hypot is always
      positive, so the sway does not average out of it - it leaves a small
      positive bias that has nothing to say about the droop, and an assertion
      against it would have to be loosened until it stopped meaning anything.
      Signed, the ambience cancels and what is left is exactly the split
      `droopHeading` describes.
    */
    expect(sumX / count).toBeCloseTo(-WIZARD_HAT.droop * Math.cos(WIZARD_HAT.droopHeading), 3)
    expect(sumZ / count).toBeCloseTo(WIZARD_HAT.droop * Math.sin(WIZARD_HAT.droopHeading), 3)

    const moving = hatBends(3, 0, 0)
    const magnitudes = moving.map((b) => Math.abs(b.rz))
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i], `segment ${i} does not whip`).toBeGreaterThan(magnitudes[i - 1])
    }
  })

  it('lags opposite to travel, which is what inertia looks like', () => {
    const right = hatBends(4, 0, 0)
    const left = hatBends(-4, 0, 0)
    expect(Math.sign(right[3].rz)).toBe(-Math.sign(left[3].rz))
    expect(right[3].rz).not.toBe(0)
  })

  it('is narrowed rather than shipped at cape width', () => {
    /*
      `createCapeRibbon` builds at `CAPE_PANEL.width`, because it was written for a
      cape. A 0.34 slab off a 0.09 apex is the detached-card read from the other
      direction, so the group scales it - and scaling beats forking a geometry the
      player's own cape also uses.
    */
    expect(WIZARD_HAT.tipWidth).toBeLessThan(0.5)
    expect(WIZARD_HAT.tipWidth).toBeGreaterThan(0)
    expect(WIZARD_HAT.tipDepth).toBeLessThanOrEqual(1)
  })

  it('never folds the tip through the crown, at any speed', () => {
    // The clamp is on SPEED so the direction of the lag survives it. This walks
    // a fly-in far faster than the path can produce and checks the ceiling holds.
    for (const speed of [0, 1, 5, 20, 200]) {
      for (const bend of hatBends(speed, speed * 0.6, 3.1)) {
        expect(Math.abs(bend.rx), `rx at ${speed}`).toBeLessThan(Math.PI / 2)
        expect(Math.abs(bend.rz), `rz at ${speed}`).toBeLessThan(Math.PI / 2)
      }
    }
  })
})
