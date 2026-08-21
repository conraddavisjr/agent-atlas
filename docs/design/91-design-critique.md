# Critique: the design system, and the first pass built against it

Written by a reviewer who built none of this and has no stake in any of it.

Two subjects.
Section A attacks `90-astro-design-system.md`.
Section B reviews the working tree on `astro-overhaul` as art direction, ranked, each finding with a number in it.
Section C is the direction asked for on the character's colour scheme, which is not yet built.

Every claim about a frame below says how it can be checked.
Section D says what I could not check and why.

---

## A. Falsifying the design system

### A.0 The summary

The colour axis is the best work in the file and I could not break its arithmetic.
The source discipline is the weakest thing in it, and it fails in exactly the way this project has been burned before: **at least six [DOC] labels sit on claims no source makes**, and three of them are load-bearing for a whole section.
The animation axis is the thinnest, and it is thin in a specific way - it is the only one of the five that ends in a mood rather than in a measurement.

I fetched every source the file names.
Two independent verification passes ran - one on the Team ASOBI record, one on the vendor and engine references - and the balance is worth stating plainly before the attack begins.
**Most of what the file cites, it cites correctly**, including several things it would have been easy to get wrong: the Lagarde chromium triple to six figures, physicallybased.info's `colorSpace: "srgb-linear"` tag and both hexes derived from it, four verbatim Adobe PBR Guide quotes, three verbatim Filament quotes, and the claim that Filament's own metal table prints silver and aluminium as uncorrected linear values under an sRGB header - which is a real error in a vendor document, correctly caught here, and not something a casual pass would find.
One of my own accusations was wrong and is retracted in A.2.5.
The failures below are concentrated in the places where the file wanted a source and reached for one, rather than in the places where it had one.

### A.1 [DOC] labels that do not survive their sources

I fetched the named sources.
Five quotations came back verbatim and are safe to build on: the CGMagazine contrast ordering, the Geek Culture materials quote, the three "How to draw Astro" instructions, Smith's "we model how children express joy", and Push Square's "Even a kid can draw Astro".
The four documented negatives in section 6 are also independently confirmed - no blue-and-orange source exists, no official hex exists, no numeric proportions exist, no animation timings exist.
That list of confirmed absences is the most valuable single thing in the file and it should be defended.

What does not survive:

**A.1.1 The 90-degree ban has no source, and it is the hardest rule in section 5.1.**
Line 1261: "**[DOC]** The reference's rule verbatim: never a 90 degree hard corner on a plastic object; every edge takes a bevel that catches the key as a bright line."
No source states this, in any language, first- or third-party.
The nearest published language is generic third-party description of "soft, rounded edges".
"Verbatim" is the specific word that has to go: it asserts that somebody wrote those words and nobody did.
Relabel **[REC]**, and note that the ban is still defensible on Doucet's confirmed "followed by adding bevels" - which is a real source and says less.

**A.1.2 The oversize rule is built on a claim the record contradicts in direction.**
Lines 584 and 1366 both carry "**[DOC]** Props are consistently oversized relative to the character, reinforcing 'child among toys'", and line 1367 turns it into an equation: `size = real_size / 1.7 * 1.36 * 1.8`.
No source states it.
The nearest published statement runs the other way - props were "resiz[ed] where needed to give all props a cute finish that would fit Astro's world", which is a fit constraint, not an inflation constant.
The 1.8 factor is invented and should be labelled **[REC]**, which also frees section 5.4's "exception" to stop being an exception: if there is no documented oversize rule, then legibility is not overriding a rule, it *is* the rule.

**A.1.3 Three [DOC] labels in section 3 sit on numbers that exist nowhere.**
Line 1043: "**[DOC]** The 250 ms ceiling on feedback comes from the reference and it is not arbitrary."
Line 1105: "**[DOC]** The reference band is takeoff Y x1.15-1.25 and landing Y x0.7-0.8."
Line 1109: "**[DOC]** Idle is never static: 3-5% breathing on about a 2 s cycle, plus a random look-around or fidget every 4-8 s."
No published figure of any kind exists for Astro's squash amounts, breathing, fidget interval or feedback duration.
The closest published statement is the qualitative "every one-second action feels fun".
All three are **[REC]**, and section 3's own framing sentence - "There are still no published Sony numbers" - already says so, which makes these three labels a self-inflicted contradiction rather than a research gap.

**A.1.4 The "digital DNA" quote is not Brueckner's words.**
Line 163 attributes it to him as speech.
The PS Blog post narrates it in the third person: it introduces "the Art Director, Sebastian" and then says "*We* injected each object with a digital DNA".
The doc also reverses the causality - in the source the "super-tangible feeling" is the outcome of continuous research across characters, enemies and vegetation, and the digital-DNA sentence follows it.
The wording is real; the speaker and the ordering are not.

**A.1.5 The Digital Foundry citation points at a post that could not be found, and the resolutions are restated wrong.**
Section 6 cites an X post by Mackenzie for the SSR and TAA findings.
The substance is correct and published - PSSR replaces TAA in patch 1.012, and DF do report PSSR hurting screen-space reflections through its noise reduction - but the traceable source is the Digital Foundry / Eurogamer article, not a tweet, and the tweet could not be corroborated.
The resolution line is also wrong in kind: 1368p and 1872p are the *new* internal targets replacing 1872p and 2160p, not a target pair.
This matters more than a footnote, because section 1.4's entire "our whole mirror is the probe half" argument - the thing that justifies a dedicated PMREM - rests on the SSR finding being documented.
Cite the article and the claim stands.

**A.1.6 "They won't be able to control themselves" is repurposed.**
Line 1015 makes it "a spring specification, not a mood note" and derives the whole zeta ladder from it.
In the Screen Rant interview the phrase is about children and players being excited, not about how the bots' motion settles.
The zeta ladder may well be right - it is good engineering - but its warrant is **[REC]**, not a director's instruction.

**A.1.7 Four lines attributed to Doucet as speech are the post's narration.**
"We added a PlayStation blue livery and more parts to have him stand out from the environment" is narrated by the article's author, not quoted from Doucet.
The evolution post's byline is a staff writer; Doucet is the interviewee.
The substance holds; the attribution should say "the PS Blog post" rather than "Doucet".

### A.2 Numbers asserted past their derivation

**A.2.1 The most leveraged number in the file is a two-point line fit, and a current frame falsifies it.**

Section 0.5 fits `rendered_R-B = 0.714 x albedo_R-B - 9.9` through exactly two points and calls the intercept "the finding".
Two points through a two-parameter model has zero degrees of freedom: it cannot be wrong and it cannot be tested, which is the same thing as saying it has not been tested.

There is now a third point and it does not lie on the line.
The deck ships at `palette.bandDeckTop` `#bfbbb4`, albedo R-B **+11**, and the current frame measures `rgb(163, 157, 140)` - rendered R-B **+23**.
The line predicts **-2**.
That is a 25-point miss on the axis the fit exists to predict.

Section 2.6 then spends **+16.4** points of rig warmth on the strength of that intercept, and section 7 item 8 makes it a commit with an acceptance window of R-B +6 to +12.
Executed against a deck already at +23 it lands near +39, which is not a warm light on a cool world, it is a sepia frame.

**The fix is to stop and re-measure before touching a Lightformer.**
`__dev.sample()` a lit deck at `hub-character` on the shipped masonry, with and without the LUT, and re-fit against three points instead of two.
Section 2.6's own warning about the LUT applies and is correct.
Hold sections 2.6 and 7.8 until that number exists.

One mechanism I could not rule out and which would explain part of the gap: the -22 / -2 pair was measured on a `mattePlastic` deck carrying `clearcoat: 0.40`.
`masonry()` has no coat and `specularIntensity: 0.25`, so a broadly neutral specular wash that used to sit on top of the diffuse is gone, which should amplify whatever hue the diffuse has.
That is a one-capture A/B and it should be run before anyone concludes the fit was wrong rather than superseded.

**A.2.2 The proportion table reports a number that cannot be reproduced from the built mesh.**

Section 4.1: "Foot span / head width | 0.85 - 1.05 | **0.97**".
`PROPORTIONS.headWidth` is 0.72.
`REST.legR.x - REST.legL.x` is 0.290, and `footMaxHalfWidth().x` was 0.0844 before this round, so the span was 0.459 and the ratio **0.637**.
After the boot narrowed it is 0.410 and **0.569**.
Neither is 0.97.

The only 0.70 m on record is prose, in `robotPose.ts` and again in `ContactBlob.tsx` - "the character's foot span is 0.70 m" - and 0.70 / 0.72 = 0.972, which is where the row came from.
So the table read a number off a comment rather than off the geometry, and the comment was already stale.
This is precisely the failure mode the brief names: a number read off the shape someone had in mind rather than the one built.

Fix: derive every row of that table from the exported geometry functions in a test, the way `footSoleFlat`'s own note argues for.
Then decide whether 0.569 is acceptable, because it is 0.28 below the file's own floor and nothing in the shipped change noticed.

**A.2.3 The joint-legibility pair mixes two bases and its ratio contradicts the argument it supports.**

Section 1.5: "a 0.06 m joint spans about **2.3 px** down-camera on a floor against **8.7 px** on a wall".
8.7 is 60 / 6.92, computed frontally at 10.7 m.
2.3 is 60 / 26, measured at the deck's mean distance in `decalTextures.ts`.
Their ratio is 3.8.
The foreshortening argument requires `1 / sin(21.9 deg) = 2.68`, and line 549 quotes exactly that as "2.7 times the pixels for the same metre".
The table and the sentence that reads it disagree by 40%.
Quote one basis, and if it is the measured one, say so and drop the computed figure.

**A.2.4 The brick dimensions are given to the centimetre and the shipped generator disagrees by 29%.**

Section 1.5 specifies a unit face 0.56 x 0.25 m, a course of 0.31 m and a 1.24 m tile, with the character at 4.4 courses.
`brickTexture.ts` ships 0.72 x 0.33 m, a course of 0.39 m and a 2.34 m tile.
Both are internally consistent; they are not consistent with each other, and the unit length is the dimension every legibility number in both documents is computed from.

The doc also sends the implementer to `createMouldedBrickMaps()` in `groundTexture.ts`.
The module is `createBrickMaps()` in `brickTexture.ts`, which the doc cites by name three paragraphs later.
Section 7 item 5 then says "`masonry()` and `brickTexture.ts` already exist", so the file knows both facts and has published the wrong one.

**A.2.5 A retraction, recorded because a critic who over-claims is worth less than no critic.**

I flagged section 1.6's per-resolution roughness table - 0.076 / 0.054 / 0.038 / 0.027 at 128 / 256 / 512 / 1024 - as invented, on the grounds that the only clamp in the installed tree is the flat `max(roughnessFactor, 0.0525)`.
That was wrong.
The table is genuinely published by three.js, in `docs/api/en/extras/PMREMGenerator.html` under "Note: The minimum MeshStandardMaterial's roughness depends on the size of the provided texture", present from r150 through r180, and all four cited numbers match exactly.

**One amendment the doc should take.** three.js has since migrated its documentation to JSDoc, `docs/api/` is gone on `dev`, and the table did **not** survive into `docs/pages/PMREMGenerator.html.md`.
Cite it as "three.js docs, r150-r180, removed in the JSDoc migration", so that the next person to check it does not conclude what I did.

**A.2.6 The masonry citations point at documents that do not contain the claims.**

Section 6 cites "Brick Industry Association TN10, BS EN 771-1" for three facts.
Two of the three do not hold.

**TN 10 does not discuss joint profiles at all.** The doc attributes "**Recessed mortar 2-5 mm below the face**, 3-7% of course height" to it.
TN 10 is "Dimensioning and Estimating Brick Masonry" and contains no occurrence of rake, recess or tooled.
Joint profiles are in **TN 30, "Bonds and Patterns in Brickwork"**, which describes the raked joint, gives **no depth figure at all**, and actively discourages it - "difficult to make weather-tight and is not recommended where heavy rain, high wind or freezing is likely".
So the 2-5 mm is unsourced.
It is also the number section 1.5 scales up to justify `jointDepth`, which makes it load-bearing rather than decorative.

**BS EN 771-1 does not specify 215 x 102.5 x 65 mm.** It requires a manufacturer to *declare* a work size plus a tolerance category.
215 x 102.5 x 65 is the legacy **BS 3921** UK work size.
The 225 x 112.5 x 75 coordinating module and the nominal 10 mm joint are correct.
Reword to "the customary UK work size, declared under BS EN 771-1", and the argument in section 1.5 - that a real brick is illegible at this camera - is unaffected either way.

**A.2.7 Filament's metal range is "typically found in", and the doc turns it into a prohibition.**

Section 1.6 quotes "**[DOC]** Filament's rule for what a metal base colour may be: '[170..255]...'" and then uses it to delete a token: "**This rules out two tokens in section 2.3** ... `#8FA2B8` has a red channel of 143 ... A metal that dark is not a metal", and "**`steel.dark` is deleted rather than corrected**."

Filament's actual words are "Real-world values are **typically found** in the range [170..255]".
That is a distribution, not a constraint, and it cannot rule anything out.
The *conclusion* is still defensible on the physics the doc gives immediately after - dark anodising is an oxide film over aluminium, so it is a coated dielectric - and that argument does not need Filament at all.
Drop the "rule" framing, keep the physics, and the two token changes survive with a better warrant than they have now.

**A.2.8 Two smaller citation corrections.**

The DONTNOD albedo chart, including bricks at median sRGB 131, is on Lagarde's **2014** post, not the 2011 one the doc cites.
The 2011 post separately gives 50-240 rather than 50-243, which is worth knowing since the doc makes a point of the 243.
The doc's headline correction here is **right** and should be kept: Epic publishes no sRGB albedo range, and the "50 to 243" attribution to Epic is wrong wherever it appears.

`ior: 1.538` for ABS is published, but by an optics vendor rather than a materials handbook, and Cardarelli and the CRC handbook give **1.49** at the same wavelength.
ABS is an opaque two-phase polymer, so its `nD` is a blend average rather than a constant.
The [REC] to set it on every moulded-plastic preset is harmless at either value - the F0 difference between 1.49 and 1.538 is 0.0389 against 0.0449, which is under one byte of albedo - but the label should be [DOC, contested] rather than [DOC].

**A.2.9 One row of the token table is exempted from the file's own chroma law, and it is the row the migration spends most.**

`hero.blueDeep` `#1D4D8F` is listed with a band ("midground") where every other row carries a debt.
Computed: chroma 0.797, display L 0.2806, ceiling `0.62 x (1 - 0.2806) = 0.446`, **debt 1.787**.
That is over the ceiling, so by section 2.2 it is signal, with an area cap of `4% / 1.787 = 2.24%` of frame.
Section 2.7 then hands it to `accentDeep`'s nine call sites, which include the cape and the backpack.
At `hub-character` those are more than 2.24% of frame.
The law is right; the exemption is unexplained and it is where the migration will break it.

### A.3 Internal contradictions

**A.3.1 Section 1.5 forbids and requires the same thing, four hundred words apart.**

Line 575, the albedo channel: "**No joint darkening.** ... The joint is relief and occlusion, never albedo - a printed dark line is a scratch, a lit groove is a joint."
Line 545, the placement rule: "Brick on a deck is legal, and its normal map is the wrong channel. **Print the joint** - which is what `BRICK_MORTAR_DROP` does."
Both are section 1.5's [REC].
An implementer cannot satisfy both, and the shipped code satisfies the second, which is the right choice.
Resolve it by scoping the prohibition to vertical facings, which is what the placement table already implies and what the prose never says.

**A.3.2 The class table's band for `brick()` contradicts the section that derives it.**

Section 1.3 gives `brick()` "**midground only**".
Section 1.5 legalises brick on a deck, and a deck is gameplay by definition.
The shipped deck measures 0.615, in gameplay.
One of the two has to move; the class table is the one that is wrong.

**A.3.3 The derived brick hex reopens the prohibition that `97-decision-shadow-end.md` exists to close.**

Section 1.5: `#5F6871` "renders at 0.300 on a lit vertical face and **0.128** on a shaded one, which puts the shaded side in the anchor band - correct, and the reason a brick wall is a good place to put a cast shadow."

`97-decision-shadow-end.md` line 92 states the decision's actual content: "**No repeated vertical object may be the darkest thing in the frame.**"
Line 210 records that after round 3 the eight pylons are *deeper* into the anchor band than before, a shaded shaft measuring 0.185 then 0.138, and line 219 hands round 4 the question with the arithmetic already done.
Handoff item 11 says the same thing more sharply: the two largest contiguous dark shapes in the frame are both pylon shafts.

The pylons are the repeated vertical object.
Putting `sub.brick` on them lands their shaded faces at 0.128 and undoes the entire round-3 decision.
The shipped masonry measures **0.269**, which is the better answer, and it got there by keeping the band values in `paintByFacing` and letting the texture only darken within reserved headroom.
The doc should adopt that construction and delete the 0.128 sentence, which is the one place in the file where a good rule is applied to the one surface it must not be applied to.

**A.3.4 The mirror is specified for one call site and shipped on the other, and section 7 would make two.**

Section 1.4: "**Two mirrors in a frame is one mirror too many**", with the head plate ranked first and the deck inlay second.
The working tree has the deck inlay and no head plate.
Section 7 item 1 asks for the head plate first, which would produce two.
Either the one-mirror rule needs a sequencing clause - the deck inlay reverts to `anodised()` when the head plate lands - or the rule is really about *curvature classes* rather than counts and should say so.

**A.3.5 The `MeshStandardMaterial` recommendation and the sub-1 metalness cannot both be taken.**

Section 1.4 recommends building `steelMirror()` on `MeshStandardMaterial` because "`specularIntensity` is inert at `metalness: 1`".
I verified that: `material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor )` collapses to 1.0 at metalness 1.
But the same section then accepts, and the shipped `steel()` uses, `metalness: 0.68`, where the same line gives `F90 = 0.68 + 0.32 x specularIntensity` and `specularColorBlended` retains 32% of the dielectric term.
At 0.68 the material is not a metal in the sense the recommendation assumes, and `MeshStandardMaterial` would silently drop a term that is live.
State the dependency: `MeshStandardMaterial` is correct only if the horizon-band fix lands and metalness goes back to 1.0.

### A.4 What it left out

**The thinnest axis is animation, and the thinness is structural rather than a matter of length.**
Section 3 is roughly 150 lines against materials' 460 and colour's 240, it says outright that it does not repeat `05-character-vfx.md`, and - the part that matters - it is the only one of the five axes that contains **no acceptance test and no falsification line**.
Sections 1, 2, 4 and 5 each end in something a capture can refute.
Section 3 ends in a spring table whose three [DOC] anchors are A.1.3 and A.1.6.
Give it one measurable rule and it becomes an axis: for instance, *no beat's root vertical displacement is under 14 mm*, which is section 3.6's own 2 px visibility floor applied to the character rather than to distant props, and which is checkable from a pose dump without rendering anything.

**Four decisions an implementer still has to invent.**

1. **The deck brick's albedo.** Section 1.5 solves the hex backwards from `FACING_RATIO.litVertical` = 0.54 and publishes no horizontal facing ratio, so there is no derivation for the largest surface in the game - the surface the section spends most of its argument on. The implementer invents it.
2. **Which of the character's parts are trim.** Section 2.7 maps amber to `hero.blue` and `sub.trim` and stops. There are seven orange call sites in `robotParts.tsx`; section 2.4's own 2%-of-frame cap forbids all seven being blue. Nothing says which is which. Section C answers this.
3. **How a second character differs from the first.** Section 4.1 is framed as "constraints a second character has to satisfy" and every range is wide enough that the current character is the only point inside it. There is no rule for what makes two bots read as two bots.
4. **The horizon band's radiance, size and azimuth span.** Section 1.4's headline fix is "one or two large cards centred at elevation 20 to 25 degrees ... in `atm.horizon` `#BDC9D4`" - a colour and an elevation, with no intensity, no dimensions and no azimuth extent, in a file that gives every other card all three. Section 7 item 2 makes it the second commit. It is not implementable as written.

**And one editorial defect in the list the orchestrator will actually work from.**
Section 7 is numbered 1, 2, **4**, 5, 6, 7, 8, 9, 10, 11, 12.
There is no item 3.
A ranked list with a hole in it means something was cut and the ranking was not re-checked, which matters here because items 1, 2 and 4 are described as one sequence ("Do it in the same commit as 2 or immediately before it") and the reader cannot tell whether the missing item belonged inside that sequence.
Renumber, or say what item 3 was and why it went.

### A.5 Where it is right, and load-bearing

Briefly, because these should not be re-litigated.

**The chroma ceiling, section 2.2, is the best thing in the file.**
I recomputed every row of both tables from the hexes - display luma, chroma, ceiling, debt, area cap - and every one is arithmetically correct.
It is the first rule this project has had that separates the cyan visor from the amber chest plate without appealing to taste, and "the lawn fails by a factor of 48" is the first explanation of why three rounds of value work never moved it.
The corollary at line 762 - that orange and yellow-green do not exist at chroma 0.20, so a blue substrate is a mechanical consequence rather than a preference - is the argument that should be quoted at anyone who wants the amber back.

**The three [VERIFIED] three.js findings all hold.**
I read them out of the installed 0.185.1 tree.
`material.roughness = max( roughnessFactor, 0.0525 )` with `geometryRoughness` added on top, and the identical clamp on `clearcoatRoughness` at line 76.
`PMREMGenerator.js:230`, `_lodMax = Math.floor( Math.log2( cubeSize ) )`.
And the `envMapIntensity` override, which is the important one: `WebGLRenderer.js:2693` fires only when `material.envMap === null && scene.environment !== null`, so section 1.4's proposed per-material PMREM does revive the dead lever, on that material and only that material, exactly as claimed.

**The `specularIntensity` mechanism in section 1.5 is verified and it is the right lever.**
`meshphysical.glsl.js` defines `USE_SPECULAR` for every `MeshPhysicalMaterial`, and `lights_physical_fragment.glsl.js` computes F0 as `0.04 x specularIntensity` and F90 as `specularIntensity` at metalness 0.
At 0.28 that is F0 0.0112 and F90 0.28, and the F90 half is what stops a normal-mapped matte surface reading as wet.
It is the only correct way to author "no reflection" in this renderer, `masonry()` reached it independently, and the two agreeing from opposite ends is real evidence.

**The curvature roughness floor, section 1.2, is correct and it catches a live defect.**
Both tables invert cleanly and every entry checks.
It is also the rule that finds finding B4 below, which is the strongest argument for keeping it.

**The catch on Filament's own metal table is real, and it is the best piece of research in the file.**
Section 1.6 says Filament's silver and aluminium rows are Lagarde's raw *linear* values printed under a column headed sRGB, while its iron, titanium and platinum rows are correct.
Checked against physicallybased.info: aluminium is the clincher, printed 0.91 / 0.92 / 0.92 against a true linear 0.916 / 0.923 / 0.924 and a correct sRGB encoding of 0.962 / 0.965 / 0.966.
Silver reads the same way, gold reinforces it, and titanium, iron and platinum all encode correctly.
That is a genuine error in a widely-cited vendor document, found here, and it would have shipped a metal roughly 5% too dark to anyone who trusted the table.
The doc should soften "far too dark" to "about 5% too dark", which is real but not dramatic, and otherwise this row should be quoted at anyone who doubts the file's rigour.

**The documented negatives in section 6.**
All four confirmed independently, including the one that matters most for section 2 - no source in any language describes Astro's palette as blue-and-orange complementary.
A list of things that provably do not exist is worth more than most lists of things that do, and the instruction not to let a future research pass rediscover the AI-generated SEO page is the kind of thing that saves a whole round.

**And the "50 to 243 is not Epic's" correction is right.**
Epic's own documentation publishes no sRGB albedo range at all; the figures are Lagarde/DONTNOD's.
Keep it, fix the year to 2014, and note that the 2011 post gives 50-240 rather than 50-243.

---

## B. The live implementation, ranked

Nothing is committed.
Read against `git diff` on `astro-overhaul`.

`97-decision-steel-and-masonry.md` is the orchestrator's own record of this pass and it landed while this was being written.
It is not a target here - it is the other half of the pair, and where it and this file overlap it generally has the better numbers because it ran captures and I did not.
One of its measurements inverts a finding I had drafted; that is recorded in B7 rather than quietly dropped.

### B1. Both printed ladders are solved against base values the shipped material no longer produces, and the pylon half reopens the one item the handoff says is still open

This is one root cause with two consequences, and the second is the severe one.

`brickTexture.ts` solves every tone drop against an assumed rendered luma: `DECK_LIT_LUMA = 0.687` for the deck, `FRAME_LIT_LUMA = 0.30` for the pylons.
Both were measured on the **old** materials - `mattePlastic` with `clearcoat: 0.40`.
`masonry()` has no coat and `specularIntensity: 0.25`, and both surfaces came down: the deck to **0.615** and the pylons to **0.269**.
Every drop in both ladders is therefore sized against a base that is 0.072 and 0.031 too bright respectively.

Working the shipped bytes back through the transfer curve at the real bases:

| Surface | authored against | lands at, in the frame | band |
| --- | --- | --- | --- |
| Deck mortar joint | 0.587 on a 0.687 base | **0.525** on a 0.615 base | the empty 0.38-0.56 gap |
| Deck worst brick face | 0.553 | **0.494** | the empty gap |
| **Pylon darkest texel** | 0.2062 on a 0.30 base | **0.183** on a 0.269 base | **anchor** |

**The pylon row is the one that matters.**
`brickTexture.test.ts` contains a test named *"keeps every pylon texel out of the anchor band"*, whose comment quotes `97-decision-shadow-end.md` directly - "No repeated vertical object may be the darkest thing in the frame" - and says in as many words that "eight pylons wearing a deck-sized tone ladder would break it by texture, which is a cheap way to reintroduce the cage handoff item 11 is still open on."
It asserts p100 rather than p95, deliberately, because the decision is phrased about what the darkest thing in the frame *is*.
It passes, on an assumed base of 0.30 with 0.006 of margin.
On the measured base of 0.269 the darkest texel is **0.183**, inside the anchor band, and the pass has reintroduced the cage by texture in the same commit as the test that forbids it.

The deck rows are the same failure with a lower ceiling: the mortar is a grid across the largest surface in the game and it lands 0.035 below the gameplay floor.
`brickTexture.test.ts:441` already pins the worst face at 0.553, which is 0.007 under the floor at the *assumed* base; at the real base it is 0.066 under.

**Fix, with the numbers.**

- Deck: `renderedLuma: 0.615`, `dropScale: 0.40`. Headroom is `0.615 - 0.56 = 0.055`, worst-case authored drop is `0.082 + 0.036 + 0.016 = 0.134`, `0.055 / 0.134 = 0.410`. Worst face lands at 0.561, mortar at 0.575.
- Pylons: `renderedLuma: 0.269`, and `FRAME_DROP_SCALE` from 0.70 to **0.50**. Headroom is `0.269 - 0.20 = 0.069`, `0.069 / 0.134 = 0.515`. Darkest texel lands at 0.202.
- And in both cases the assumption itself should go: take `renderedLuma` from a measurement of the shipped material rather than a constant, or at minimum re-measure both constants in the same commit that changes the material. A constant named `DECK_LIT_LUMA` that outlived the deck it was measured on is the same class of defect as the stale foot docblock in B8, one layer down.

**Check it.** `node tools/critique/frame.mjs spread <png> 760 620 36 24` on the deck, inside one lighting condition, requiring **p5 at or above 0.56**.
And the same on a **shaded** pylon face requiring p5 at or above **0.20**.
The bible's trap note applies: a box straddling a cast shadow reports the shadow as the surface's spread.

**One reconciliation, and it is the reason this has to be measured rather than argued.**
`97-decision-steel-and-masonry.md` reports the near deck at p5-p95 **0.1059** with `normalScale` at 1.8.
If the deck's mean were 0.615, p5 would land near **0.562** - technically inside the gameplay band, with 0.002 of margin where the design assumed 0.127.
But that spread was measured at `hub-character` on a 1512x823 buffer and the 0.615 came from `hub-establishing` on 1512x767, so **the two numbers cannot be combined** and I am not combining them.
Take both from one capture at one vantage.
That pairing also decides whether the deck is genuinely in violation or merely out of margin, which are different problems with different fixes - and it does not soften the pylon row, because that one is judged at p100 by an explicit decision rather than at p5.

The deeper question, worth asking in the same commit: the deck lost 0.072 of value when the coat came off.
Cutting the ladder to 0.40 keeps it legal but spends most of the pattern the masonry was built for.
Restoring the base is the other lever and it is worth pricing, because a 0.615 deck has only 0.055 of headroom and every future mark on it hits the same wall.

### B2. Every measurement quoted for this pass is one axis, and the bible says one axis is the wrong statistic

`00-art-bible.md` 8.1: "A surface belongs to a band when its **p5 to p95 range fits inside that band**, not when some patch of it does."
`99-handoff.md` item 11: "When a tool returns two axes, quote both or neither."

The five figures on record for this pass - steel 0.583, deck brick 0.615, pylon 0.269, lawn 0.579, sky 0.803 - are all single numbers.
Three rounds failed on the lawn because the mean was never the thing, and this pass has re-adopted the mean.

The pylon is the one that matters most, because `97-decision-shadow-end.md` and handoff item 11 are open on exactly that surface and a shaded shaft measured **0.138** last round.
A mean of 0.269 is entirely compatible with a shaft whose shaded half still runs into the anchor band, and if it does, this pass has not closed item 11 - it has moved the mean.
B1 makes this concrete: the printed ladder alone takes the darkest texel on a **lit** pylon face to 0.183, before the shaded facing is considered at all.
Whichever of the two numbers 0.269 is - a lit face or a mean over the shaft - neither is the statistic the decision is phrased in.

**Fix.** Re-run all five as `frame.mjs spread`, two boxes per surface where the surface has two lighting conditions, and record p5 and p95 for each.
Specifically: a **lit** pylon face and a **shaded** pylon face, and require the shaded p5 at or above **0.20**.
Then `frame.mjs where` at 0.20 and quote the row thirds and the column thirds, both.

### B3. The deck's tan is one hex, and it is not in the brick

The brick map is not the source.
`BRICK_TINT_TILTS` runs `[-1, -0.7, -0.4, -0.1, 0.25]` - four cool steps to one barely warm - and its own note says the ladder is deliberately biased cool.

The warmth is `palette.bandDeckTop = '#bfbbb4'`, R-B **+11**, painted into the vertex colour by `paintByFacing` and multiplied by a near-white map.

**Fix.** `#BABCBD`.
Display luma 0.7347 to 0.7359, a move of **0.0012**, so every band assertion in `palette.test.ts` and `materials.test.ts` survives untouched, and R-B goes from +11 to **-3**.
This is section 2.3's `sub.deckTop` and it is the cheapest correct change on this list.

**Do not predict the result from section 0.5's line** - see A.2.1.
Capture the same box before and after and report **both** R-B and display luma.

**Sequencing, and this is the direction rather than the fix.**
Do this **before** the character colour pass.
The deck is the largest warm area in the frame at every vantage.
Neutralise the character first and you will be judging a cool character against a tan world, the frame will read cold and wrong, and the temptation will be to put warmth back into the character - which is the mistake that produced the orange in the first place.

### B4. The steel channels carry a sub-two-pixel highlight, which is the exact defect the design system's own rule exists to catch

`INLAY_SECTION` domes 0.038 m over a 0.11 m half-width on the trunk.
Fitting the crown gives a radius of curvature of about **0.245 m**.
At `hub-establishing`'s 767-row buffer, `px_per_radian = 767 / 0.6981 = 1099`, so at `roughness: 0.15`:

```
highlight_px = 2 x 0.15^2 x (0.245 / 12) x 1099 = 1.0 px
```

A one-pixel bright line on a metal at F0 0.60 with no temporal AA is a firefly, and "the steel channels read as bright silver lines" is what that looks like from the outside.

**The four spurs are worse than the trunk**, because the section holds its proportions at a smaller size - which `hubLayout.ts` correctly calls out as a virtue and which here is a liability.
At a 0.075 m half-width the crown radius is 0.167 m, the highlight is **0.69 px**, and the roughness floor is 0.256.
The junction pool and the threshold pad are near-flat discs and the rule does not bind on them.

**Fix.** `roughness` per run, from the section's own half-width:

| Run | crown radius | at 0.15 | floor for 2 px | set to |
| --- | --- | --- | --- | --- |
| Trunk, half-width 0.11 | 0.245 m | 1.0 px | 0.211 | **0.22** |
| Spur, half-width 0.075 | 0.167 m | 0.69 px | 0.256 | **0.26** |
| Pool and threshold pad | near-flat | full lobe | - | **0.15**, unchanged |

The floors are the design doc's own inverse, `sqrt(w_px x fov_rad x d / (2 x r x H_px))` at `w_px = 2`, `fov_rad = 0.6981`, `d = 12`, `H_px = 767`.
That means `steel()` has to take a radius, which is exactly what section 1.4 specifies and what the shipped preset does not do.

**Check it.** `frame.mjs where` on a channel's bounding box at threshold 0.85, and require the bright pixels to be **contiguous and elongated** rather than scattered - section 1.4's acceptance test, which is the right one and which nothing has run yet.

### B5. `steel()`'s central justification is contradicted by the geometry it is bound to, and a green test asserts the opposite of the frame

Two halves.

**The normals.** The docblock exempts the inlay from `anodised()`'s "a metal cannot hold a value band" finding on the grounds that "the whole batch presents one narrow run of normals" and every piece is "an essentially UP-FACING sheet".
`INLAY_PROFILE.visibleTop` is **-0.15**: the visible surface spans normal Y from -0.15 to 1.0.
`hubLayout.ts` says why, in as many words - the vertical riser runs have "crowns point away from the riser face rather than up".
There is steel on vertical riser faces, which is precisely the case the anodised finding rules out, and there are twelve risers.

**The test.** `materials.test.ts` ships green with `it('is brighter than the deck it is inlaid into, and that is on the record')`, asserting `linearToSrgb(headOn) > DECK_LIT_LUMA`.
The frame says **0.583 against 0.615**: the inlay is 0.032 *darker* than the deck.
The test is arithmetic about a hypothetical head-on reflection of a card; the frame is the thing.
This is the same shape as round 1's finding that `palette.test.ts` was green while the lawn rendered at 0.315.

Note also that the docblock's "0.264 DARKER than the deck" and the current pair do not close: 0.615 - 0.423 = 0.192.
The 0.264 was measured against the old 0.687 deck.
Two numbers from two different frames are being quoted as one comparison.

**Fix.** Re-derive that assertion from a measured pair or delete it - a test that pins a comment is fine, a test that pins a comment the frame contradicts is worse than nothing.
And either split the riser runs out of the steel batch or drop the "one narrow run of normals" argument and justify the material on something the geometry supports.

### B6. The inlay takes no baked occlusion while the deck it is set into does

`walkable.deck` binds `aoMap: lightmap` on UV set 1 with `assertLightmapBound` guarding it.
`<mesh geometry={traceBatch}>` binds `{...steel()}` and nothing else - no lightmap, no vertex colours.

A metal strip running through the Core's baked shadow will not darken with the deck around it.
The channels will read as lit where everything they cross is not, which on a mirror is worse than on a diffuse surface because the eye reads a mirror's value as information about the environment.
This was invisible while the surface was a custom shader doing its own lighting; it is visible now that it is an ordinary PBR material sitting in a lightmapped deck.

**Fix.** Put `traceBatch` through `applyLightmapUV` and the atlas - it is already a merged `PropPart` batch, so this is one call plus one `assertLightmapBound` - or decide against it and write the reason into the block.
**Check it** by capturing `hub-establishing` and looking at where a spur crosses the Core's cast shadow.

### B7. The relief is controlled from two files at once, and the surface it is wasted on is the opposite of the one everybody predicted

I drafted this finding as "the strongest relief in the project is spent on the deck, where the project has already measured relief to be worthless".
`97-decision-steel-and-masonry.md` section 3 ran the falsification while this was being written and the result is **backwards from that**, so the finding is rewritten rather than deleted, and the part that survives is the part that was never about which surface.

The measured result, at `hub-character`, high, buffer 1512x823, `normalScale` read back off the live material:

| box | 0.4 | 1.8 | delta |
| --- | --- | --- | --- |
| deck, near patch | p5-p95 0.0952 | 0.1059 | **+0.0107** |
| deck, mid patch | 0.0557 | 0.0585 | +0.0028 |
| pylon shaft | p25-p75 0.1152 | 0.1152 | **0.0000** |

The horizontal surface responds and the vertical one does not.
The proposed mechanism - the pylons are lit predominantly by a broad ambient floor card, and a uniform radiance filling the sphere delivers the same irradiance to every surface direction, so perturbing the normal changes nothing by construction - is sound and is the right diagnosis.
It also means the normal map is currently doing nothing on the pylons and something real on the near deck, which is the reverse of both the design doc's item 5 and my draft.

**Three things follow, and the caveats in that section are the right ones.**

1. **The pylon row is not yet trustworthy and should not be acted on.** A 38 px box whose p5-p95 is contaminated by sky, quoted as an interquartile range while the deck boxes are quoted as p5-p95, on one pylon at one vantage. That is two statistics in one table and the section says so, which is the discipline handoff item 11 asks for. Re-run it on a box wholly inside the shaft, at `hub-establishing` where more of the ring is in frame, before removing anything.
2. **If it holds, the conclusion is that the pylons' bond is carried entirely by the ORM occlusion and the printed albedo**, and `normalStrength: 2.6` is buying nothing there. That is a real saving and it is also a warning about the ambient: a surface that cannot respond to a normal map is a surface with no directional light on it at all, which is handoff item 3's de-axialising problem showing up in a second place.
3. **The near-deck result reads as distance-dependent rather than facing-dependent** - +0.0107 near, +0.0028 mid - which is what you would expect from a mip chain rather than from a facing. That is worth stating as the rule, because it predicts the next surface: relief pays where the texel-to-pixel ratio is near 1 and stops paying a few metres later, regardless of which way the surface points.

**What survives from the original finding, unchanged and independent of any of that.**

`BRICK.normalStrength` is 2.6, "the strongest in the project, against `deck`'s 2 and `plate`'s 1.5", and `masonry()` multiplies it again by `normalScale: 1.8`.

**Multiplying them is itself a spec violation, and it is the one that will cost the next person time.**
`02-materials.md` section 4.5, lines 521-522: "`normalScale` on the material stays at `(1, 1)` for every surface-map kind. Amplitude is controlled by `strength` at generation time rather than by `normalScale` at render time, **so there is one number to tune** and it lives next to the height mask that produced it."
The brick now has two, in two files, and neither docblock mentions the other's existence.
`stone()` already breaks the same rule at 1.4 and `02-materials.md` line 633 has an open item to bring it to 1.1, so this is the second offence rather than the first, and 1.8 is the largest.
Whatever is decided about binding the map at all, the amplitude belongs in `BRICK.normalStrength` alone and `masonry()` should ship `normalScale: (1, 1)`.
(`masonry()`'s `aoMapIntensity: 1.35` is fine against `02-materials.md` line 152, though the design system's own `brick()` spec asks for 1.15 - a small disagreement worth resolving in the same edit.)

Both `brickTexture.ts` and `HubIsland.tsx` quote the measurement that says it does nothing here: a lit deck's p5-p95 moved **0.0387 to 0.039** when the generated maps were switched on.
Three ten-thousandths.
The same maps genuinely earn their cost on the pylons, where the bond is lit across the grain, and the pylon block says so correctly.

**Fix.** `masonry()` ships `normalScale: (1, 1)` and the amplitude lives in `BRICK.normalStrength` alone.
If 1.8 x 2.6 is the amplitude that is wanted, the number is 4.68 and it belongs in one place.
Then decide the per-surface question on the re-run of the pylon box, not on this one.

### B8. The boot's own docblock contradicts the boot that shipped

`FOOT.topRadius`'s note tabulates the change and concludes from it that the shin no longer emerges through the top flat:

```
top FLAT, after the fillet    0.0684    0.0432
sole FLAT                     0.0485    0.0292
```

Those are the flats you get with the fillet **held at 0.016**.
The shipped fillet is 0.0112, and `coneFillet(0.04312, 0.0616, 0.13, 0.0112)` gives `flatTop` **0.0487** and `flatBot` **0.0334**.
0.0487 clears the shin's 0.0482 - which is exactly what the `fillet` docblock twenty lines below says, drawing the opposite conclusion.
`SOLE_LIGHT`'s note uses 0.0334 and is right.
So two of three blocks agree and the one the reader hits first is stale.

`FOOT`'s "Built dimensions, measured on the mesh" block is stale too: it still reads `topRadius 0.088`, bounding box 0.1685 x 0.1300 x 0.2190, top flat 0.1369, sole flat 0.0971.

This is low-severity as geometry and high-severity as process: the file's own rule, stated in `footSoleFlat`'s note, is that the component and the test must read the exported function rather than copy numbers between blocks, and the prose broke that rule in the same commit that restates it.

**Fix.** Delete the table from the `topRadius` block and reference `footTopFlat()` / `footSoleFlat()`.
Re-run the "Built dimensions" block against `bootBounds()`.

### B9. The boot narrowed and nothing re-checked the proportion it sits in

The gap between the boots went 0.1212 to **0.1702** with nothing moving, against a boot now **0.1196** wide.
The gap is 1.42 times the boot's own width where the test's own note says it used to be 0.72 of it.
Two narrow boots far apart under two wide legs is a different silhouette, and the commit says so honestly and then declines to act, which is the right instinct about attribution and leaves round 5 a stance question with no measurement attached.

Beyond that, the design system's own rig constraint moved out of range and nobody noticed - see A.2.2. Foot span / head width is now **0.569** against a stated floor of 0.85.

**Fix, if the frame says the straddle reads:** `REST.legL/R.x` from ±0.145 to **±0.125** closes 0.040 and takes the gap to 0.1302, near where it was before the boot moved, at the cost of the waist note that put the legs at 0.145.
**Check it first:** render the 32 px black silhouette and run the eight checks in section 4.4 of the design doc, including the new check 8 - the widest scanline must be in the top 40%.
Do not move the stance on an opinion about a still.

### B10. The water's prose survived the water

`WATER_SECTION` became `INLAY_SECTION` and the blocks around it still describe liquid: "shared by every piece of water in the level", "The water is a brim-full inlay", "A sheet of water hung on the nominal face plane", and `TRACE.standoff`'s "a future scene with water running over a grating".
`INLAY_PROFILE.edgeBand` and the `aShore` attribute both have no consumer and both say so.

Cheap, and worth doing in the commit that decides `aShore`'s fate rather than leaving two dead things and a misleading vocabulary for the next reader.

### B11. The hub lost a progression read and gained nothing in its place

The water carried the second reading of progress as a body sky-mix from display 0.212 to 0.358 across the progression, and the replacement block says the right thing: the place to put it back is "the inlay's own emissive REVEAL - a thin strip beside the metal rather than the metal itself".

That is unbuilt, and it is also the cheapest available answer to handoff item 2, which says nothing in six frames emits light.
A thin emissive reveal beside a polished steel channel is the one place in this frame where an emissive has something that can reflect it, which is most of what makes a bloom read as a light rather than as a bright patch.

**Suggested shape:** a 0.04 m strip at `GLOW.source`, inset in the deck alongside the trunk only, ramping `sig.ally` `#4DE2FF` from `GLOW.hold` to `GLOW.source` with progression.
0.04 m is 1.5 px down-camera on the deck and 5.8 px across it, so run it **cross-camera** - section 5.3's anisotropy rule, which is the one place in this frame it obviously applies.

---

## C. Direction on the character's colour scheme

This is the part I was asked for before the work rather than after it, so it is written as instructions.

### C.1 The frame to fix first

Do **B3** before any of this.
The deck at warmth +24 is the largest warm area in the frame.
Judge a neutralised character against a tan world and it will read cold, and the correction you will reach for is the one that put the orange there.

### C.2 The thing the direction actually says, restated so it can be executed

"Blues, silvers, greys and black" is four families and **three of them are near-neutral**.
The trap in the swap that is about to happen is treating it as "orange becomes blue", because that keeps the character's structure - a white body with a saturated accent - and only changes the hue.
The reference's structure is different: a white body, a large amount of *neutral hardware*, one dark, and blue spent once.

The design system's own law forbids the straight swap and gives the number.
`hero.blue` `#2F7AD2` has debt 2.24, so its area cap is **1.79% of frame**, and the character occupies 3 to 6% of frame at these vantages.
There are **seven** orange call sites in `robotParts.tsx`.
All seven cannot be blue.

### C.3 The assignment, site by site

The values below are placed on a value ladder rather than picked.
Calibrating off the design doc's own solved point - `#5F6871`, albedo display L 0.403, renders **0.300** on a lit vertical face - the transfer on a near-vertical character surface is roughly `rendered = 0.74 x albedo_L`.
That is one point and a slope read off it, so treat the rendered column as an estimate to be measured, not as a specification.

| Site in `robotParts.tsx` | Now | Becomes | Albedo L | Est. rendered | Why |
| --- | --- | --- | --- | --- | --- |
| `ChestPanel` L533 | `plastic(accent)` `#ff9a3c` | **`mattePlastic('#4B5568')`** | 0.330 | ~0.24 | The largest coloured area on the character becomes the character's own **dark**, not a second bright. A ~0.70 value drop straight from the 0.94 shell is the strongest edge on the character and it does not currently exist anywhere on the body. This is Doucet's confirmed "contrast is our top priority" applied to the thing the camera is pointed at. If 0.24 does not read dark enough on a frame, `#3C465A` at ~0.19 is the next rung, and it is the last one - below that the plate is at the midground floor and the character starts growing an anchor, which is a membership `97-decision-shadow-end.md` closes. |
| `Backpack` L577, L592 | `plastic(accentDeep)` x2 | **`mattePlastic('#5F6871')`** body, **`anodised('#AEB9C6')`** on the two visible fasteners | 0.403 / 0.720 | ~0.30 / hardware | One rung brighter than the chest, deliberately, so the character's two darks separate in greyscale instead of merging into one mass behind the torso. Section 4.3 clause 3 requires the two parts at a detachable interface to be in **different material classes**: a moulded shell against plated hardware. Two greys at two values in two classes reads as detachable. Two oranges never did. |
| `EarPod` L458 | `plastic(accentDeep)` | **`anodised('#AEB9C6')`** | 0.720 | - | One of the four detachable interfaces in section 4.3, and it should read as plated hardware - a **material** difference from the shell, not a hue difference. `#AEB9C6` clears Filament's 170 floor on every channel; the `#8FA2B8` in the doc's first draft does not. The pod is a puck, so it satisfies `anodised()`'s cylinders-only rule. |
| `HeadCap` L383 | `plastic(accentDeep)` | **`anodised('#AEB9C6')`** | 0.720 | - | Same argument, and it is a lathe rather than a flat face, so the same rule holds. This is also where a shallow `steelMirror` plate eventually goes - the documented silver head plating, section 7 item 1 - so hardware grey there now is the cheap version of the same decision and does not have to be undone later. |
| `UpperArm` L662 cuff | `plastic(accentDeep)` | **`plastic('#2F7AD2')`** | 0.441 | - | This is where blue is spent. A cuff is small, it is on a limb, and section 2.4's trim allowance is exactly this shape. |
| `HeadShell` L352 | `shell('#2f6fc4')` | **`shell('#2F7AD2')`** | 0.441 | - | Already blue. Move it onto the token so there is one blue in the world rather than two near-identical ones. 0.035 brighter and 0.016 more saturated. The note explaining its old 0.406 placement is a separation argument against `accentDeep`, which is being deleted, so the constraint that produced 0.406 goes with it. |
| `AntennaUpper` L500 | `emissive(accent, GLOW.bloom)` | **`emissive('#4DE2FF', GLOW.bloom)`** | - | - | The only colour semantic in the entire documented record is blue LED = friendly, red LED = enemy. A character whose own light is orange is signalling neither. Keep the bible's pale-core rule on it. |
| `CapeSurface` L907 | `vinyl(accentDeep)` | **hold** | - | - | See C.5. |

That leaves the character with: a near-white body, one dark chest plate, three pieces of hardware grey, one blue helmet, one blue cuff, one cyan emissive.
Blue's share of frame lands well under the 1.79% cap.
**No warm colour remains on the character at all**, which is the correct end state - the design system's own conclusion is that the world keeps exactly two warm elements, reward gold and hazard red, both semantic, and the character carries neither.

### C.4 The shell, which is the prerequisite and the cheapest move on the list

`palette.shell` `#f4f1ea` is R-B **+10**, display L 0.9456.
Move it to **`#EEF0F4`**: R-B **-6**, display L 0.9406.
That is a value move of **0.005**, so every silhouette, band and bloom assertion holds.

The reason is mechanical rather than aesthetic and it is section 0.5 seen on the character: a warm shell under a warm key reads warm on its lit side **and** on its shadow side, and the shadow side is where the reference's white plastic takes the level's hue.
A neutral shell reads warm where the key hits it and cool in shade, which is the split-tone the whole rig is built for and which the cream currently defeats.

If it reads clinical on screen, the fallback is `#F1F1EF`, true neutral at chroma 0.008 - not back to cream.

### C.5 Two things not to do in this pass

**Do not recolour the cape.**
It is `vinyl(accentDeep)` and it is also round 1's F4, still open after three rounds: a zero-thickness plane with square corners casting no shadow.
Recolour it now and it gets recoloured twice, and the second time nobody will remember why the first hue was chosen.
Give it thickness and colour in one commit.
When that commit happens, the cape is **not** `hero.blueDeep` - see A.2.6, that token is over the chroma ceiling at debt 1.79 with a 2.24% area cap, and a cape at `hub-character` is bigger than that.
It is `sub.trim` `#4B5568` or it is the shell colour with a darker facing.

**Do not migrate the world's amber in the same commit as the character's.**
Section 2.7 counts thirteen call sites and says "do it in one commit, because a half-migrated palette is a world with two schemes in it".
That is right about the *world*.
The character is a separable object with its own value exemption, and mixing the two makes the frame unattributable - which is the discipline this project has held for four rounds and should hold here.
Character first, because it is the thing the user is looking at; world amber second.

### C.6 How to know it worked

The falsification available today, in order:

1. **Value must not move.** `__dev.sample()` the shell before and after: display luma must move by less than **0.01** while R-B goes from +10 to below 0. If value moved, the swap moved something it was not supposed to.
2. **The silhouette must not change.** Render the 32 px black silhouette and run the eight checks. A hue swap that changes a silhouette check has changed geometry or material, not colour.
3. **The greyscale test must improve, not merely hold.** The chest plate going from 0.662 to 0.272 is a new value edge on the character. Greyscale `hub-character` with `-grayscale Rec709Luma` - not `-colorspace Gray`, which linearises, handoff item 10 - and confirm the chest reads as a distinct region from the shell.
4. **The frame-weighted chroma debt.** This is the right measurement and the tool does not exist. Section 7 item 12 is about forty lines. Build it before the world amber migration, not before this one - the character is small enough to judge by the three checks above, and the world is not.

---

## D. What I could not check, and why

- **Anything about the frame that was not given to me.** I did not run the capture harness. Every luma in section B is either the orchestrator's measurement, a number read out of the source, or arithmetic done here from the transfer curve - and B1's re-solved figures in particular are computed, not measured. They are exactly the kind of number this document criticises elsewhere, and the fix line says how to measure them instead.
- **Whether the pylons' shaded faces are still in the anchor band.** This is B2 and it is the single most important open question in the pass, because `97-decision-shadow-end.md` and handoff item 11 both turn on it. One `frame.mjs spread` on a shaded shaft answers it.
- **Whether `#D3D8DA` or `#C4C5C4` is the better chromium.** Both lineages verify exactly as printed, and both are correctly labelled linear in their sources, so the doc's arithmetic on either is sound. Which one is *right* is a question about whose spectral data to trust and I cannot settle it from a desk. The doc's answer - take the brighter one because this is a toy - is a taste argument honestly labelled as one, and it is fine.
- **The Marmoset roughness numbers.** The chart publishes swatches, not numbers. The doc says "pixel-sampled rather than printed", which is the honest framing, and the sampled rank order does match the claimed sequence. The magnitudes only reconcile if you sRGB-decode the swatch first, so the row should say "derived from" rather than imply Marmoset publishes them.
- **Whether `#BABCBD` actually neutralises the rendered deck.** A.2.1 is the reason: the only model available for predicting it is falsified by the current frame. It is one capture.
- **Anything at the low and medium tiers.** Every number quoted is high tier at 1512x767. The design doc's own caveat applies to all of it - millimetre figures scale by `1080 / H`, and at 767 rows every mark floor is 1.41 times what the doc's tables say. B4's roughness figure already uses 767; the doc's tables do not.
