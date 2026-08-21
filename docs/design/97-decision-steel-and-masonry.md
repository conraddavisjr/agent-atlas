# Decision: the water becomes steel, the platform and the pylons become masonry

Round 4, first pass. Written by the integrator, against art direction from the user and from `90-astro-design-system.md`.

Nothing here is settled until `91-design-critique.md` has been through it.
This file is the record of what was changed, what was measured, and which of the round's own predictions the measurements falsified.

---

## The brief, verbatim in substance

1. Remove the water texture and the particle effect from the water around the platform, and replace it with a steel material that is highly reflective.
2. Give the platform a brick texture with high levels of detail, no reflectivity, highly matte, stone-like in its light response. Apply the same treatment to the pillars.
3. Narrow the feet, particularly the top portion, by about 30%, because the current diameter reads as an oaf rather than as the bottom of a foot.
4. Move the character off high-contrast blue-and-orange, which is not Astro's language, and onto blues, silvers, greys and black.

Items 1 to 3 are in this pass. Item 4 is deliberately held - see "What is not in this pass".

---

## 1. The water is deleted rather than disabled

`waterMaterial.ts`, `WaterTrace.tsx`, `splash.ts` and `PoolSplash.tsx` are gone, with their tests.
That is a wave field, a Blinn glint, a meniscus band, a Fresnel sky mix and a pooled splash effect.

**The geometry is unchanged and that is deliberate.**
The section is a flat-topped profile with a shallow crown, a shoulder and a rim that tucks under the deck plane, swept along five paths and lathed into two discs.
Every one of those decisions survives the reclassification: an inlaid metal strip wants the same slightly domed top, because that is what sweeps the Fresnel across the width and stops the strip reading as a painted line, and it wants the same buried rim so the inlay meets its recess without a visible edge.

Three constants the geometry's own tests are written against moved from `waterMaterial.ts` into `hubLayout.ts` as `INLAY_PROFILE`.
Two of them still describe live properties. `edgeBand` does not, and that is stated in its doc rather than hidden: the `aShore` attribute is still written by both builders, still asserted, and nothing samples it any more.

**What was lost, and it is a real loss.**
The water carried the hub's second progression read, as a body sky-mix running from display 0.212 empty to 0.358 complete.
Steel has no equivalent lever that is not an emissive, and an emissive metal is a contradiction.
The totems and the Core node still carry progress, so this is one reading lost rather than the only one.
If it is wanted back, the place for it is a thin emissive reveal beside the metal, not the metal.

## 2. The steel did not work at `metalness: 1`, and the fix is knowingly unphysical

**Predicted:** an up-facing polished sheet would render at display 0.78 head-on, comfortably above the deck's measured 0.687, and clear the 1.45 bloom threshold with the highlight strip's own 1.33x margin.

**Measured, `hub-establishing`, high, buffer 1512x767, junction pool:**

| | display luma | rgb | band |
| --- | --- | --- | --- |
| `metalness: 1` | **0.423** | 83, 112, 137 | none - the 0.38 to 0.56 gap |
| deck, same frame | 0.615 | 163, 157, 140 | gameplay |

So the inlay was 0.19 DARKER than the surface it is set into, the opposite of the brief, and it was sitting in the band gap that is meant to be empty.

**The table was right and the reflection geometry was not.**
A metal has no diffuse term, so its value is entirely what it reflects, and what an up-facing sheet reflects toward a camera at this depression angle is the environment at roughly the same elevation on the opposite bearing.
This rig's environment there is the ambient floor card at `#243a52` and the negative fill at `#0b0f1a`.
The bright cards are overhead, which is where a mirror sends a camera looking from LOW, and this camera looks from high up.
A `Lightformer` environment contains only its cards, so there is no sky in it to reflect.

This is `anodised()`'s finding restated for a horizontal surface instead of a vertical one, and its conclusion carries over unchanged: **making a pure metal read here is a light-rig change, not a material one.**

**What shipped instead:** `STEEL_METALNESS = 0.68`, so the material regains a diffuse lobe lit by the key.

**Measured after:** **0.583**, `rgb(133, 152, 165)`, warmth -31, inside the gameplay band and out of the gap.

A mixed metalness is not physical - a surface is a conductor or it is not.
What makes it defensible rather than merely convenient is the bible's own rule about where stylisation is allowed to live: the stylisation lives in the INPUTS, never in the BRDF, and `metalness` is an input to an unmodified GGX.
The honest cost is that the mirror streak is 32% weaker than true steel's and the surface picks up a key gradient a mirror would not have.

**The physical fix is named and not taken.** `90-astro-design-system.md` item 2 proposes one or two `Lightformer` cards at elevation 20 to 25 degrees in `atm.horizon` `#BDC9D4`, after which `metalness` goes back to 1.0.
It is not in this pass because it raises ambient on every surface in the hub and it lands inside the one file round 4 is holding still so that handoff item 3's de-axialising change can be attributed.
Its falsification test is already written: sample the inlay before and after with `metalness` pinned at 1.0 in both. If the card is doing the work, the value rises without the material changing.

## 3. The masonry

A procedural generator, `brickTexture.ts`, evaluated per texel rather than drawn - so the whole thing runs under node and every claim about the bond, the joint width and the tone budget is a unit test rather than a screenshot.

**The scale argument is the one that decides whether any of it reads.**
A lit deck covers about 470 px for 12 m at `hub-establishing`, so one screen pixel is 25.5 mm.
A domestic brick at 215 x 65 mm with a 10 mm joint puts that joint at 0.39 px, which is the same Nyquist failure this project has now made in three separate places.
The brick ships at **720 x 330 mm with a 60 mm joint**: 28 x 13 px with a 2.4 px joint, a cast block rather than a brick, which is also the right answer for a world where everything is a manufactured object.

The tile is square by construction, because `boxProjectUV` uses one scale for both axes: `3 x 0.78 == 6 x 0.39 == 2.34 m`, and the running bond's half-brick offset is one whole course pitch, so it tiles on both axes with no seam.

**The albedo is not decoration, it is the channel that lands.**
The deck's own measurement is on record: switching the generated normal and roughness maps on moved a lit deck's p5-p95 from 0.0387 to 0.039.
So the bond carries a printed tone ladder solved through `panelTintBytes`, and the whole four-term drop budget is written out in `BRICK_TONE_DROPS` including the p100 that lands 0.007 under the band floor on well under one per cent of the tile.

**The pylons get a compressed ladder, and the reason is a written decision rather than taste.**
`97-decision-shadow-end.md` closes the 0.20 to 0.38 midground band's floor to repeated verticals.
The deck has 0.127 of headroom from 0.687 to the gameplay floor; the frame has 0.10 from 0.30 to the midground floor.
`FRAME_DROP_SCALE = 0.70` sizes the ladder against headroom rather than against value, and the p100 pylon texel lands at 0.206.

**Measured after, `hub-establishing`, high:** deck 0.615 gameplay, pylon shaft 0.269 midground.
Both in band.

**And the deck is still WARM**, at `warmth` +24, `rgb(163, 157, 140)`, so the bond reads as tan sandstone rather than as the cool stone the direction asks for.
That is the most obviously off-language thing left in the frame after the character.
It is not fixed here because the fix is coupled: `90-astro-design-system.md` item 8 moves the world's warmth out of the albedo and into the rig in one commit, and doing the albedo half alone would delete a temperature axis that round 3 deliberately built.

### The falsification that came back negative, and it is the opposite of what was predicted

`90-astro-design-system.md` item 5 predicts that relief belongs on walls and print belongs on decks, because foreshortening puts a 0.06 m joint at 8.7 px on a wall and 2.3 px on a deck.
It proposes the test: render at `normalScale` 1.8 and at 0.4 and measure the spread, and if the difference is under 0.005 the normal map is not earning its texture.

Run, at `hub-character`, high, buffer 1512x823, with the live `normalScale` read back off the material in the same call that took each measurement:

| box, buffer pixels | 0.4 | 1.8 | delta |
| --- | --- | --- | --- |
| deck, near clean patch, 1010,610,240,90 | p5-p95 **0.0952** | **0.1059** | **+0.0107** |
| deck, mid patch, 880,640,120,60 | p5-p95 **0.0557** | **0.0585** | **+0.0028** |
| pylon shaft, 707,75,38,160 | p25-p75 **0.1152** | **0.1152** | **0.0000** |

**The vertical surface does not respond at all and the horizontal one does.**
That is backwards from the prediction and from the intuition behind it, and the likeliest mechanism is not foreshortening: the pylons are lit predominantly by the broad ambient floor card, and a uniform radiance filling the sphere delivers the same irradiance to every surface direction, so perturbing the normal there changes nothing by construction.
`00-references.md` already contains that arithmetic, applied to a different question.

Two consequences if the mechanism holds.
`normalStrength: 2.6` and `normalScale: 1.8` are being spent on the pylons for nothing, and the pylons' brick is currently carried entirely by the ORM pack's occlusion and by the printed albedo.
And the near deck clears the 0.005 threshold while the mid deck does not, which is a distance-dependent result rather than a facing-dependent one.

**Caveats, both of which have to be closed before this is acted on.** The pylon box is 38 px wide and its p5-p95 is contaminated by sky, which is why it is quoted as an interquartile range while the deck boxes are quoted as p5-p95 - two different statistics in one table, stated rather than smoothed. And a single box on a single pylon at a single vantage is not the pylon ring.

## 4. The boot

`FOOT.topRadius` 0.088 to **0.0616**, a 30% cut on the lathe radius, so the plan footprint narrows 30% on both axes.

The alternative reading - narrow across, keep the length - was considered and rejected: it needs `depthScale` at 1.857 to hold z, which makes a plank, and it puts the boot narrower than the shin across while staying wider fore and aft.

**Two things had to move with it and neither was optional.**

`FOOT.fillet` 0.016 to **0.0112**, scaled by the same 0.7. Held at 0.016 it goes from 18.2% of the top radius to 26.0%, and eats 0.0184 off the top face - taking the flat to 0.0432 against a shin of 0.0482, so the leg would overhang its own boot by 5 mm per side. That is the defect the box this cone replaced was condemned for, one order of magnitude smaller.

`SOLE_LIGHT.radius` 0.033 to **0.023**, sized against the new sole flat of 0.0334 and holding the same 68.9% of it the previous pass shipped.

**One invariant could not survive and was rewritten rather than relaxed.**
The previous pass asserted that the shin emerges through the boot's top FLAT with 0.015 of margin.
At a top radius of 0.0616 against a shin of 0.048218, the most margin the geometry can offer is **0.0134, with a fillet of zero**. The assertion is unreachable at a 30% narrower boot by arithmetic, and keeping it would have been asserting that the narrowing did not happen.
What ships is 0.0005 of flat margin, and the invariant the old assertion was really about is now asserted directly: no part of the leg is outside the boot's solid where they meet, by 0.011.

**And a consequence recorded rather than asserted away.** `SHIN_RADIUS`, the leg's widest at the knee, is 0.085 against a boot half-width of 0.0598.
The boot is now narrower than the widest part of the leg above it, where before it almost exactly matched it.
The leg tapers to 0.0482 where the two actually meet, so this is not a defect on its own, but it is the thing to look at in a frame if the legs start reading as spindly.

**The stance was deliberately not moved.** `footMaxHalfWidth().x` fell from 0.0844 to 0.0599, so the gap between the boots widened from 0.1212 to **0.1702** with nothing moving - now 1.42 times the boot's own width where it used to be 0.72 of it.
Pulling `REST.legL.x` in to compensate would be a pose edit arriving inside a geometry commit with nothing attributing it.
The gap test now has a ceiling at 0.18 so a further narrowing has to be argued with the stance rather than absorbed.

---

## What is not in this pass, and why

**The character's colour scheme.** Still cream with a saturated orange chest plate, orange ear pod, orange cape and blue-and-orange shoulder stripes.
`90-astro-design-system.md` section 2 has the replacement worked out - the chroma ceiling, `hero.blue` `#2F7AD2` at debt 2.24 capped at 1.79% of frame as a trim colour, amber deleted across thirteen call sites - and it says to do it in one commit because a half-migrated palette is a world with two schemes in it.
Direction was asked for from the critique before it is done, not after.

**The deck's warmth.** Coupled to a light-rig change. See section 3.

**The horizon card that would let the steel go back to `metalness: 1`.** See section 2.

---

## Verification

1031 tests green, `tsc -b --noEmit` clean, `eslint .` clean.
39 new tests on `brickTexture.ts`, all on the pure half, plus new preset tests on `steel()` and `masonry()`.
Both the high and the low tier were loaded and captured; low returns null map sets and renders the same flat deck it rendered before, which is parity rather than a regression.

Draw calls go from 114 to 115 at high: the pylon masts had to leave `dressBatch` because masonry needs a different projection scale, 2.34 m against 1.6 m, and a material with no clearcoat, and a merged batch has exactly one of each.
The struts, the collar, the catenary arcs and the pylon caps deliberately stay machined - a cable made of brick is a category error, and a cast stone shaft with a machined disc on top of it is the world rule this project has had since its first pass.
