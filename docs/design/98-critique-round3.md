# Critique round 3

Judged on `.critique/round3/` at high unless stated.
Every number is display-space Rec.709 luma in 0-1, measured on the rendered PNG with `tools/critique/frame.mjs`, which is the `__dev.sample()` convention.

I built none of this.
The three jobs I was given were to work the acceptance table in `97-decision-shadow-end.md` row by row, to say whether the composition decision itself is right, and to price what removing ambient occlusion cost.

**Measurement path verified before anything was believed.**
`frame.mjs bands` agrees with the in-page histogram in the capture reports to four decimal places on all four frames I checked: `after-high--hub-establishing` mean 0.6518 / below-0.20 3.12% / above-0.80 22.82%, plus `hub-totem`, `hub-backlit` and `hub-portal`, every figure identical.
All 54 captures report `ok: true`, `drew: true`, buffer `[1660, 934]`, and pinned progression, 5 of 5 everywhere except `hub-totem` at 4 of 5 which is the vantage's own deliberate setting.
I did not measure a frame rate and I did not drive the browser.

Two things in the supplied set are not usable as evidence and are written up under Harness below: the `grey/` directory, and the low-tier triangle tolerance.

---

## 1. The acceptance table, row by row

| row | required | outcome |
| --- | --- | --- |
| `establishing` below 0.10 | at least 1.5% | **Withdrawn, correctly.** Measured 0.14% against 0.00%. |
| `establishing` below 0.20 | 8% to 14% | **Withdrawn, correctly.** Measured 3.12% against 1.60%. |
| `establishing` 0.38-0.56 | below 15% | **Missed.** 16.55% against 21.76%. And see F2: the AO removal alone reached 15.98%, so the round's own lighting work moved this row 0.57 points backwards. |
| sub-0.20 in the bottom third | at least 60% | **Wrong question.** 47.8% at 0.20 and 56.5% at 0.15, as claimed. But the same tool call reports the column thirds, and those were not quoted. See F1. |
| sub-0.20 on pylons, struts, arcs | under 25% | **Missed, and by more than the document says.** See F1. |
| island edge profile, `col` at x=1550 | a gradient reaching 0.18 or below | **Met.** 0.232 monotone to 0.116, 48 px at or under 0.18 by my count against the claimed 44. |
| lawn, clean patch | inside 0.56-0.74 | **Missed.** Five clean patches mean 0.5467, of which two clear 0.56. |
| cast shadow on stone deck | 0.18 or more below the lit deck | **Met, confirmed.** 0.197. The prediction of 0.207 is about 0.01 optimistic. |
| shell shadow side, `backlit` | 0.40-0.48 at higher saturation | **Refuted on both halves.** 0.5509 at saturation 0.0704 on round 2's own patch. See F6. |
| a visible object-to-deck junction | recovered by authored contact, at least as deep | **Split.** Met and bettered at static hub object bases, missed under the character, and absent at architecture-to-architecture corners. See F4 and F5. |
| ground beside a pylon shaft | a corner exists, and reads | **Met, confirmed, and it is the best single thing in the round.** Contact contrast 0.140 to 0.248. |

**The two withdrawals are sound and I checked the arithmetic rather than taking it.**
Classifying every warm dark pixel in `hub-establishing` puts an upper bound of 2.84% of frame on all warm-and-dark content combined, and that figure still includes the portal arch and the soil lip, so the skirt alone is well under 2.5%.
A feature that cannot exceed about 2.9% of frame even painted black cannot deliver 8%.
The document is right that a frame-share target for a feature whose area is fixed by geometry is a wish rather than a criterion, and it is right to have left the rows in place with the arithmetic attached.

**The cast shadow row is the round's real win and it is worth stating with its numbers.**
On the Core puck at `hub-establishing`, lit stone 0.6789 against strut shadow 0.4819, a contrast of 0.197, where the entry state was 0.6887 against 0.5464 for 0.142.
Three separate scanlines gave 0.191, 0.196 and 0.198, so the figure is stable.
The hue swing across the shadow boundary also widened, lit warmth +9 to +22 and shadow warmth -24 to -15, so the boundary carries 37 points of warmth difference against 33 before.

---

## Blocking

### F1. The round put three and a half times more new near-black onto the verticals than onto the ground. `hub-establishing`.

**Required.** The decision's own operative clause: *"No repeated vertical object may be the darkest thing in the frame. Pylons, struts, catenary arcs and backdrop monoliths are the frame, and the frame stays in the midground band, 0.20 to 0.38."*
The document concedes this is "not met" and that a shaded shaft went 0.185 to 0.138.
It then claims what survives is that "the largest single contiguous dark shape is the island's underside rather than a ring of pickets."

**Measured.** Classifying every sub-threshold pixel as warm, meaning skirt and soil, or cool, meaning pylons, kerbs, struts and cast shadow:

| | below 0.20 | | below 0.15 | |
| --- | --- | --- | --- | --- |
| | base | after | base | after |
| warm, the ground's mass | 3,710 | 11,497 | 1,236 | 6,327 |
| cool, verticals and shadow | 21,030 | 36,943 | 1,189 | 18,784 |
| warm share of all darks | 15% | 23.7% | 51% | **25.2%** |

Below 0.15 the round added 5,091 warm pixels and **17,595 cool ones**, a ratio of 3.46 to 1.
The warm share of the deepest darks did not rise, it **fell from 51% to 25.2%**.

Connected-component analysis at 0.15, which is the threshold the document chose to quote its surviving claim at:

| rank | pixels | share | bounding box | warm |
| --- | --- | --- | --- | --- |
| 1 | 6,289 | 25.0% | 78 x 374 at (1368,522) | 0% |
| 2 | 4,864 | 19.4% | 67 x 375 at (1462,336) | 0% |
| 3 | 3,779 | 15.0% | 77 x 129 at (1525,805) | 91% |
| 4 | 2,874 | 11.4% | 70 x 88 at (0,846) | 87% |

The two largest contiguous dark shapes in the frame are a pylon shaft and another pylon shaft, and the largest is 1.66 times the largest skirt fragment.
At 0.20 the claim is true by 0.7%, 8,311 skirt against 8,250 pylon, and at 0.15 it is false.
Narrow shaded-shaft probes confirm the mechanism: 0.203 to 0.158 on the darkest shaft, with ambient occlusion contributing nothing at all to it, 0.158 against 0.156.

**Why it reads wrong.** At 12% squint, with the frame correctly desaturated, the before and after are indistinguishable in composition, and both read as eight dark pickets standing around a grey disc.
The one thing the decision existed to prevent is the one thing it strengthened.
The document's line that "the darks have changed shape" is true only at 0.20 and only by 0.7%; at the deep end the cage got both darker and larger while the ground gained less than a third as much.

**Smallest fix.** Do not put the ambient back, and the document is right about that.
The prohibition cannot be met by value, because the round already proved a 2.6 to 1 key ratio puts a pylon's lit and shaded sides 0.365 and 0.138 apart and no single albedo fits both inside a band 0.18 wide.
It can be met by count and placement, which is the variable nobody has touched: eight verticals at radius 14.6 with four cropped by the top edge is what makes the shape a fence.
Take the ring to four or five, keep the two that frame the portal sightline, and re-measure the column distribution rather than the luma.

---

### F2. The lawn occupies three value bands at once, so section 8 still cannot be answered. Whole image.

**Required.** Art bible section 8, the acceptance test that outranks all others: *"Desaturate a frame to greyscale. You must still instantly read where you can stand."*
Three bands with real gaps: gameplay 0.56-0.74, midground 0.20-0.38, background 0.76-0.86.
The midground band is where the unwalkable cliff lives and the 0.38-0.56 gap is meant to be empty.

**Measured.** Classifying every pixel inside the forbidden 0.38-0.56 band by surface:

| | base | after | AO removal alone |
| --- | --- | --- | --- |
| band occupancy | 21.76% | 16.55% | 15.98% |
| grass share of it | 65.9% | 60.8% | 57.2% |
| grass as % of whole frame | 14.33% | **10.06%** | 9.14% |

And the lawn is not a value, it is a distribution.
Two clean lawn regions and two clean deck regions in `after`:

| region | mean | sd | p5 | p25 | p50 | p75 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lawn, near (200,760,340,150) | 0.561 | 0.097 | 0.363 | 0.524 | 0.577 | 0.615 | 0.731 |
| lawn, right (1120,700,220,120) | 0.530 | 0.130 | 0.309 | 0.437 | 0.553 | 0.620 | 0.731 |
| deck, Puck A (600,600,300,60) | 0.613 | 0.139 | 0.299 | 0.535 | 0.683 | 0.687 | 0.721 |

The lawn's 5th to 95th percentile spans **0.363 to 0.731, a width of 0.368**.
That single surface therefore occupies the top of the midground band where "you cannot go there" is defined, the whole of the gap that is supposed to be empty, and the whole of the gameplay band.
The mean is not the problem: at 0.561 it is now technically inside gameplay, and the acceptance row that asks for a "clean patch" inside 0.56-0.74 is measuring the wrong statistic.

**Why it reads wrong.** In the correctly desaturated frame the island is one grey mass, and the reason is that walkable stone and walkable grass share a distribution rather than sitting 0.067 apart the way the palette table intends.
Worse, the lawn's darkest quarter reads as the same value as the cliff you cannot climb.
A player squinting at this frame cannot tell the deck from the lawn, and cannot tell the darkest lawn from unwalkable ground, which is the section 8 failure stated exactly.
This is not the failure round 1 found, a lawn in the wrong band, nor the one round 2 found, no shadow end at all.
It is the third one, and it is the one still standing.

**Smallest fix.** Compress the lawn's spread from the bottom rather than shifting its mean.
The tip-to-root ramp that round 2's F14 introduced runs the roots down to about 0.38, which is below the gameplay floor, so the ramp itself is what puts walkable ground into the unwalkable band.
Re-target it to roughly 0.72 at the tips and 0.60 at the roots, which keeps the contact read that F14 was right to want while raising p5 above 0.56 and holding p95 under 0.74.
Then leave the deck at the 0.735 the bible already specifies and the two classes separate without either leaving the gameplay band.

---

## Major

### F3. The island's new mass landed in the two bottom corners, not along the bottom, and appears in one and a half of six vantages.

**Required.** The decision rests on one mechanism, stated twice: *"Contiguous along the bottom of the frame it is gravity ... Distributed around the perimeter on eight verticals, the identical value is a fence."*

**Measured.** The profile was delivered: at x=1550 the skirt runs 0.232 monotone to 0.116 with 48 px at or under 0.18, against a flat 0.230 to 0.202 before.
Where it landed was not.

| | base | after |
| --- | --- | --- |
| sub-0.15 darks in the right third | 29.3% | **79.2%** |
| sub-0.15 darks in the centre third | 27.0% | **5.4%** |
| sub-0.20 darks in the right third | 65.0% | 68.0% |
| bottom 120 rows, columns containing any dark pixel | 33.7% | 34.3% |

Binned into twentieths of frame width, the warm skirt darks sit in bucket 0, the leftmost 5%, and buckets 18 and 19, the rightmost 10%.
**Across the middle 80% of the frame's width there is not one skirt pixel below 0.20.**
The reason is geometric and was in the vantage the whole time: at `hub-establishing` the lawn runs off the bottom edge of frame, so the underside is not below the subject, it is beside it, in the two lower corners.
The document's own arithmetic already established the rest: 20,420 px at `hub-establishing`, 486 px at `hub-portal`, and zero in the other four vantages.

**Why it reads wrong.** Two dark wedges in the lower corners with bright lawn between them is the shape of a vignette, and a vignette reads as framing, not as weight.
The decision's own instrument reports this, because `where` returns row thirds and column thirds from the same call, and only the row thirds were quoted.
A dark that is 79% on one side and almost absent from the centre has not become a floor.

**Smallest fix.** Nothing about the skirt itself; it is well built and the profile is right.
The fix is to stop asking it to be the frame's floor, because it cannot be in five of six shots.
See the Verdict for what should carry that job instead.

---

### F4. The character's contact got 40% shallower and gained a hard polygonal edge, in the vantage whose criterion is exactly that. `hub-character`.

**Required.** The vantage's own `judges` string: *"and above all whether the contact shadow makes it sit on the ground rather than hover."*
The acceptance row asks for the lost occlusion band to be *"recovered by authored contact, at least as deep."*

**Measured.** A profile down through the boot sole into the deck at x=790:

| | boot sole | deck immediately below | recovery | deck asymptote | contact contrast |
| --- | --- | --- | --- | --- | --- |
| base | 0.095 | 0.411 | smooth ramp over ~36 px | 0.717 | **0.306** |
| after | 0.079 | 0.509 | 0.520, 0.566, **0.689** then dead flat | 0.693 | **0.184** |

The contact under the boots is 0.122 shallower than it was, a loss of 40%.
And it terminates in a **0.123 step across a single pixel** eight pixels from the sole, after which the deck is flat at 0.693 for the next thirty pixels with no gradient at all.
Levelled to 0.42-0.74 the boundary is plainly a polygon: straight segments and a visible corner, in a distinctly blue tone, rgb(121,139,147) against a warm tan deck.

**Why it reads wrong.** At 100% the boots read as sitting on a blue plastic shape that has been stuck to the stone, rather than in shade.
The bible's whole world rule is that everything is a manufactured object, and a hard-edged decal is a manufactured object of the wrong kind: it reads as a decal, which round 2 already flagged in a different place as the node shell's failure.
This is the one junction in the game the vantage set exists to judge, and it is the one that went backwards.

**Smallest fix.** Give the character's contact blob a falloff that reaches zero at its own boundary instead of terminating at roughly 0.12 of its depth, and widen it so the ramp is 30 px rather than 8.
The static `contactDecal` work already got this right at object bases, so the fix is to bring the character's pre-existing blob up to the same authored falloff rather than to invent anything.

---

### F5. The architecture's own inside corners lost their contact and nothing replaced it. `hub-portal`.

**Required.** Same acceptance row, and the decision's item 2 of the anchor band membership: *"Recessed apertures: kerb faces, riser faces, panel gaps, vents. Small, linear, and they draw the world's own edges."*

**Measured.** At a kerb-to-tread inside corner, x=250, sampling the tread three pixels out from the corner against that tread's own asymptote:

| | tread 3 px out | asymptote | depth |
| --- | --- | --- | --- |
| base, AO on | 0.649 | 0.755 | **0.106** |
| afterAo, round-3 art with AO on | 0.595 | 0.700 | **0.105** |
| after, round-3 art, AO off | 0.666 | 0.700 | **0.034** |

Two thirds of the corner's contact is gone and nothing put it back.
There is a two-pixel dark line at the corner itself, 0.463 then 0.578, but that is the geometry edge and antialiasing rather than authored contact, and it is 0.038 darker in `after` only because the fill came down.
The difference image between the two AO arms at `hub-portal` shows this directly: the pass traced the base of every navy kerb and every riser-to-tread corner across the whole deck stack.

**Why it reads wrong.** `contactDecal` is documented as covering "every static base in the hub", and it does that well, but a kerb meeting its own tread has no base to put a decal under.
It is one continuous piece of architecture meeting itself, and that class of junction now has no treatment at any tier.
It is the difference between a deck kit that reads as assembled parts and one that reads as a single extrusion.

**Smallest fix.** Extend the same authored approach to concave architectural corners rather than reinstating a screen-space pass for them.
The deck kit is generated code, so the cheapest version is a per-vertex darkening baked along the inside seam where a kerb or riser meets a tread, sized to the 0.10 the pass was producing and about 25 px wide at this camera distance.

---

### F6. The shell's shadow side missed its acceptance band and its saturation moved the wrong way. `hub-backlit`.

**Required.** The acceptance row asks for the shell's shadow side to go from 0.55-0.60 at saturation 0.084 to **0.40-0.48 at higher saturation**, and records it as met by prediction at 0.469 with saturation up 3.3 times.
Behind it is round 2's F2 and the brief's biggest single tell, that *"the shadow side of white plastic always takes the level's dominant hue"*.

**Measured.** Round 2's patch is recoverable exactly: its quoted rgb(141,154,152) at saturation 0.084 is my box at (786,592,30,18), which reads rgb(141,155,154) at 0.5964 and saturation 0.0903 in the entry state.
Like for like on that same patch:

| patch | base | after | required |
| --- | --- | --- | --- |
| round 2's torso patch (786,592) | 0.5964, sat 0.0903 | **0.5509, sat 0.0704** | 0.40-0.48, higher sat |
| face plate (750,448,60,44) | 0.6601, sat 0.0643 | 0.5440, sat 0.0922 | |
| lower torso (845,585,40,25) | 0.5210, sat 0.1556 | 0.4786, sat 0.1532 | |
| plateau down x=820 | 0.645 | 0.517 | |

The shadow side landed at 0.5509, which is 0.071 above the top of the required band, having moved 0.046 of the 0.12 to 0.20 it needed.
Saturation on that patch **fell 22%**, from 0.0903 to 0.0704.
The only patch inside 0.40-0.48 is the lower torso at 0.4786, and its saturation was already 0.1556 and did not move.
The 3.3x saturation figure is not reproducible on any patch I could find on the shell.

**Why it reads wrong.** What actually changed is hue rather than chroma: the shadow side went from a cool neutral, rgb(141,155,154), to a warm neutral, rgb(139,142,132), warmth -12 to +6.
Both are grey.
The hero is still standing in a saturated green lawn under a blue sky with an achromatic shadow side, which is round 2's F2 verbatim.

**Smallest fix.** As round 2 said, and it is still the smallest one: give the hemisphere's ground colour the lawn's hue.
The value half of this row is now much closer than the table suggests, because the silhouette contrast against the sky went from 0.205 to 0.333, so the remaining work is chroma only.

---

### F7. The portal moved by at most 0.013, and the only thing that moved went the wrong way. `hub-portal`, `hub-establishing`.

**Required.** `hub-portal`'s job is *"the money shot: the portal is the destination the whole hub points at"*, and its criterion names the shimmer and ring emissives against the bloom threshold.
Round 2's F10 measured the arch at 0.427-0.477 and the shimmer at 0.922 and only 0.07-0.12 above the sky.

**Measured.**

| | base | after |
| --- | --- | --- |
| arch jamb, `establishing` | 0.547 | 0.523 |
| arch interior / shimmer, `establishing` | 0.865 | 0.865 |
| sky beside the arch | 0.861 | 0.861 |
| arch jamb, `portal` | 0.545 | 0.532 |
| shimmer centre, `portal` | 0.880 | 0.880 |
| sky beside it | 0.808 | 0.810 |
| lintel emissive bar | 0.852 | 0.857 |
| Core node ring, `establishing` | 0.889 at warmth +34 | 0.887 at warmth +37 |

The shimmer sits 0.004 above the sky at `establishing` and 0.070 above it at `portal`, unchanged.
The lintel bar peaks at 0.944 and steps into its stone in a single pixel, 0.688 to 0.944, with the sky above it dead flat at 0.822, so nothing blooms.
The only element that moved is the jamb, 0.024 darker, which takes it from 0.547 to 0.523 and therefore **deeper into the 0.38-0.56 band that is supposed to be empty**.
The Core node ring remains brighter and warmer than anything on the portal.

**Why it reads wrong.** At 12% squint the eye goes to the pylon ring first and the Core node's bright ring second, and the portal is a faint pale rectangle that reads as a picture hanging on a wall.
The round was explicitly not aimed at this, and I am not grading it as a failure of the round.
I am recording that the answer to "is the portal any more the destination than it was" is measurably no, to within 0.013 of luma.

**Smallest fix.** Unchanged from round 2's F10: give the shimmer the level's hue instead of white and take it 0.15 clear of the sky.

---

## Minor

### F8. Low tier's meadow and floating cable are unchanged. `after-low--hub-grazing`, `after-low--hub-establishing`.

Round 2's F12, and round 1's F5 item 3 before that.
In `after-low--hub-grazing`, the vantage whose criterion is *"grass density and colour ramp at a grazing angle"*, the meadow exists only in a strip across roughly the left fifth of frame and the rest is a bald plane with visible triangulation creases running across it.
The catenary arc still terminates square-cut in mid-air at both ends, now with a gap of roughly 8 to 13 px rather than round 2's 40, against pylon tops whose caps are culled so it connects to nothing.
Handoff item 8 and out of scope, so this is a status note.
It is worth saying that at low the shot cannot answer its own criterion at all, which makes this the one Minor I would promote if it survives round 4.

### F9. The tier-agreement claim is real but much smaller than stated.

The commit says the three tiers "now agree to 0.12 of a point on the share of the frame below 0.20, where they used to spread".
Measured, the share below 0.20 at `hub-establishing` was 1.45 / 1.56 / 1.60 across low, medium and high, a spread of 0.15, and is now 3.00 / 3.04 / 3.12, a spread of 0.12.
They already agreed to 0.15, because the pass was only ever worth 0.16 points.
The claim that stands up is on whole-frame mean, which went from 0.6729 / 0.6563 / 0.6473, a spread of 0.0256, to 0.6644 / 0.6548 / 0.6518, a spread of 0.0126.
The ladder did get better by half, on the right statistic.

### F10. `vantages.ts` documents a framing coverage for `hub-totem` that its own new progression pin invalidates.

The comment block lists `hub-totem` at 0.61 of frame height.
It now reports 0.541, with `worldHeight` 1.637 against 1.837 to 1.840 at every other vantage.
The 0.20 m is the chrome dome, which is earned after the whole basics zone and is therefore absent at the four-of-five progression this vantage now pins deliberately.
The other five vantages match their documented figures to 0.006.
Nothing is broken; the table is stale for exactly the one shot the round changed, and the header's own instruction is to re-run `framing()` after anything that changes the character's size.
Update the comment to 0.54 and note why it differs.

---

## 2. Is the decision right

The part no measurement answers, and the part I was asked for most directly.

**The principle is right and I would keep it.**
"A dark value's job depends on where it sits" is the correct reframing of a question two rounds could not settle, and it is the reason this round was able to move at all.
The reasoning for the island's keel specifically is also right on its own terms: nothing gameplay-relevant is down there, so a near-black costs the readability test nothing, no emissive needs to read against it, and it can never become the frame's strongest edge against the sky.
Those three claims are true and they are worth keeping.

**The premise about the frame is wrong, and that is why the picture did not change.**
The decision assumed the resulting dark would be "contiguous along the bottom of the frame".
It is not, and F3 has the numbers: the skirt darks live in the leftmost 5% and the rightmost 10% of frame width with nothing across the middle 80%, and the share of columns in the bottom 120 rows containing any dark pixel went from 33.7% to 34.3%.
The island's lawn runs off the bottom edge at `hub-establishing`, so the underside is beside the subject rather than beneath it.
Two dark wedges in the lower corners is a vignette, and a vignette frames rather than supports.

**And the feature is absent from most of the game.**
The document itself measured 20,420 px at `hub-establishing`, 486 px at `hub-portal`, and nothing at the other four vantages, and then treated that as an argument about a frame-share target.
It is a much bigger finding than that.
A value band that appears in one and a half of six shots is not a value structure, it is a detail on one shot, and it cannot be the thing that gives this world a floor.

**Did giving the island mass improve the picture.**
Yes, locally and genuinely: the island reads as a chunk with a wall instead of a green disc with a chocolate trim, and round 2's F11 is properly answered.
No, compositionally: at 12% squint, correctly desaturated, the entry and result frames are indistinguishable, and both read as eight dark pickets around a grey disc with one bright ring at the centre.
The round bought a real improvement to one edge of one shot and paid for it by making the cage darker in every shot, which is the trade F1 measures.

**Is the portal any more the destination.** No, by 0.013 of luma. See F7.

**Does the greyscale test pass.** No, and F2 says precisely what stops it, which is not what either previous round thought.

### If the decision is wrong, what should the darkest thing have been instead

The decision picked a defensible object for a reason that does not generalise, and its own evidence points at the better answer, which it explicitly demoted.

**It should have been cast shadow on the ground plane.**
Cast shadow is the only dark in this world that exists in all six vantages, that sits adjacent to a lit surface, which is the only geometry in which a dark does anything for bloom or for a rim, and that is contiguous and bottom-weighted by construction because it is attached to the bottom of every object.
It is also already this round's largest measured win, 0.142 to 0.197 of contrast on a stone deck, and the step shadows at `hub-portal` are the single most improved thing in the whole capture set.

The document rejected it as an anchor on correct arithmetic and then drew the conclusion the wrong way round.
It found that landing a deck's cast shadow inside 0.06-0.18 needs the irradiance cut to about 30%, which the same document rightly rejects.
The conclusion it drew was "cast shadow is a midground dark, not an anchor one".
The conclusion available was **"then the anchor band's lower bound is wrong for this world"**.
Nothing in this frame needs 0.06-0.18 content: there is no emissive that needs it, the bloom threshold has been re-measured at 1.45, and the greyscale test asks for three separable classes rather than for a black point.
What the frame needs is a single connected shadow mass in the 0.30-0.40 range under and around the ziggurat, which is where the eye reads ground contact, and which the current band table dismisses as "midground" scenery.

Concretely, for round 4: the shadows at `hub-establishing` are presently four small disconnected ellipses under the Core struts plus a few puck shadows, all of them islands.
Merge them into one mass by raising the key's elevation slightly and letting the Core, the puck stack and the deck stack cast into each other and onto the lawn, and the picture gets a floor in six vantages instead of one and a half.
That also fixes F1 for free, because a contiguous ground shadow is the one dark that a pylon cannot compete with on shape, whatever its luma.

---

## 3. What removing ambient occlusion cost

The A/B is `after-high` against `afterAo-high`, the round's own art in both arms, and both arms verify clean.
The claim on record is that the pass was worth 0.16 points of the frame below 0.20 and nothing below 0.10, and that its real value was at flat-on-flat stone junctions: the totem plinth on its spur lobe, deck pucks on the lawn, and the portal jambs on T3.

**The frame-share claim holds and the "where it earned its cost" claim does not.**

Classifying every pixel the pass changes by more than 0.03:

| vantage | frame changed | grass share | stone share | luma-points of frame, grass | luma-points, stone |
| --- | --- | --- | --- | --- | --- |
| `hub-establishing` | 21.30% | **90.2%** | 2.9% | 1.147 | 0.026 |
| `hub-grazing` | 30.90% | **94.4%** | 2.0% | 1.758 | 0.039 |
| `hub-totem` | 24.87% | 74.2% | 17.2% | 1.404 | 0.271 |
| `hub-portal`, no grass in frame | 5.13% | 0.4% | **76.7%** | 0.001 | 0.192 |

On the three vantages containing lawn, **74% to 94% of everything the pass does is a broadly uniform 0.06 darkening of the grass field**, which is the screen-space depth-pattern smear the decision document itself condemns, and which was holding the largest walkable surface a band below where it belongs.
The stone-junction work the pass is credited with is third by area everywhere except the one vantage with no grass in it.

**And its single strongest effect in this world is on the hero, not on stone.**
Locating the largest non-grass differences:

| vantage | at | AO off | AO on | delta |
| --- | --- | --- | --- | --- |
| `hub-totem` | 658,386 | 0.724 | **0.198** | 0.526 |
| `hub-totem` | 594,396 | 0.679 | **0.179** | 0.500 |
| `hub-totem` | 580,450 | 0.549 | **0.092** | 0.457 |
| `hub-portal` | 798,542 | 0.787 | 0.469 | 0.318 |
| `hub-portal` | 950,560 | 0.680 | 0.395 | 0.285 |

Every one of those is on the character, in the crevices between the head, the shoulder pads, the arm bulges and the torso.
The pass was taking a white plastic shell to **0.092 to 0.198** in its own creases.
That is the bible's defect 4 exactly, "ambient occlusion looks like dirt", and it is what round 2 was describing when it said high-tier surfaces read as scuffed plastic.

**At the junctions the pass genuinely served, here is the trade, measured.**

| junction | base, AO on, min | after, AO off, min | AO's incremental band in the round-3 art |
| --- | --- | --- | --- |
| totem plinth on spur lobe, x=900 | 0.190 | **0.119** | up to 0.163, extending ~35 px |
| portal left jamb on T3, x=690 | 0.236 | **0.132** | up to 0.059, ~15 px |
| portal right jamb on T3, x=1005 | 0.232 | **0.129** | up to 0.074, ~18 px |
| kerb-to-tread inside corner, x=250 | 0.106 of depth | **0.034** | 0.105, ~25 px, unreplaced |

At all three object bases the authored contact is **deeper** than the band it replaced, by 0.07 to 0.10, so the acceptance row is met on its own wording.
It is roughly ten times narrower: at the plinth the pass laid a 35 px soft gradient and the decal lays a 3 px hard line, and the plinth's own vertical wall lost its gradient too, from 0.475 falling to 0.423 down to a dead-flat 0.501.
"At least as deep" was the wrong question, because what a corner reads from is the width and softness of the gradient rather than its floor.
The one uncompensated loss is the fourth row, and F5 covers it.

**Verdict on job 3: the trade is clearly good and the pass should stay off.**
It returned 1.1 to 1.8 luma-points of wrongly darkened lawn per vantage and removed a 0.3 to 0.5 crevice crush from the hero's shell, against a real loss of 0.19 luma-points of stone-corner shading at `hub-portal` and 0.27 at `hub-totem`, with the object-base half of that recovered deeper.
It also delivered most of the band improvement on its own: `0.38-0.56` occupancy went 21.76% to 15.98% from the removal alone, and the round's other work then took it back to 16.55%.
For half the frame rate that is not close.
The residual loss is the kerb and riser inside corners, and it should be fixed with authored geometry rather than by putting a screen-space pass back to serve 3% of what it touches.

**One prediction confirmed rather than refuted.**
The document predicted that removing the pass would move round 2's three high-frequency-noise patches barely at all, on the grounds that F3 was grass in the shadow map and `24022db` had already fixed it.

| patch, HF in /255 | round 2 at high | base-high | after-high | afterAo-high |
| --- | --- | --- | --- | --- |
| `hub-totem` deck (680,760) | 3.32 | 0.15 | 0.19 | 0.20 |
| `hub-character` belly (770,515) | 2.62 | 0.97 | 0.62 | n/a |
| `hub-character` hand (700,505) | 3.33 | 1.02 | 0.90 | n/a |

The pass is worth **0.01** on the totem deck.
The prediction is correct, the reasoning for leaving the row out of the acceptance table was correct, and F3 was already fixed before this round started.

---

## Round 2's findings, checked against the new image

**Visibly improved**

- **F11, the island has no thickness.** Fixed. 0.230-to-0.202 flat trim replaced by 0.232 monotone to 0.116 over 90 px, 48 px of it at or under 0.18. The best-executed piece of work in the round.
- **F3, blade-shaped noise at high only.** Fixed, and before this round. 3.32 / 2.62 / 3.33 is now 0.15 / 0.97 / 1.02 at high in the entry state itself.
- **F14, object bases have no contact.** Substantially fixed for static hub objects. The pylon that round 2 measured meeting the lawn "with no treatment at all" now has a contact contrast of 0.248 against 0.140, and the tangent-capsule geometry defect behind it is genuinely gone: the shaft is a straight cylinder entering the ground rather than a sphere touching a plane. This is the round's most convincing single image.
- **F9, three risers read as one slab.** Withdrawn by the builders as false, and I agree with the withdrawal. The step stack at `hub-portal` reads clearly as steps, and it now reads better still because the cast shadows articulate the treads.

**Unchanged**

- **F1, nothing emits light.** Unchanged. The lintel bar peaks at 0.944 and steps into its own stone in one pixel with the sky above it flat at 0.822. Handoff item 2, out of scope, and now unblocked.
- **F2, the rim does not read.** Unchanged as a rim, improved as headroom. Stepping inward from the silhouette at 1, 2, 3, 4, 6, 9, 14, 22 and 34 px, `after` reads 0.500 0.519 0.530 0.538 0.538 0.538 0.542 0.542 0.546 on the left edge and 0.439 0.457 0.473 0.484 0.497 0.509 0.509 0.509 0.513 on the right: both edges still brighten inward at every row, and there is no 3-8 px band. What did change is that the shadow side fell from 0.645 to 0.517 against a 0.850 sky, so silhouette contrast went 0.205 to 0.333 and the rim has better ground to stand on than it did. Handoff item 3, out of scope, now unblocked with better arithmetic than before.
- **F4, decoration out-values the ground.** Unchanged. Handoff item 5.
- **F5, the node shell darkens the sky.** Unchanged. Handoff item 6.
- **F7, no midground layer.** Unchanged. Handoff item 7.
- **F8, the flat quad on the hero.** Unchanged, and in `after-high--hub-portal` it is the highest-chroma element in frame. Handoff item 4.
- **F10, the portal is not the destination.** Unchanged to within 0.013, and its jamb went 0.024 deeper into the forbidden band. See F7 above.
- **F12, low tier ships broken geometry.** Unchanged. See F8 above.
- **F13, the trunk trace is a rubber hose.** Unchanged.

**Superseded**

- **F6, the three-band system is a two-band system.** Superseded by F2. The claim itself has moved: the frame is no longer bimodal, with the gap-lo band down from 21.76% to 16.55% and the gameplay band up from 20.84% to 25.62%. But the greyscale test still fails, and for a third reason that is neither round 1's nor round 2's.

---

## Out-of-scope handoff items: what changed

Items 2, 3, 4, 5, 6, 7, 8 and 10 were explicitly out of scope, and I confirm all eight are still open.
Four of them changed in ways round 4 should know about.

- **Item 2, nothing emits light.** Unblocked. The sky is unchanged at 0.861 beside the arch, so the "give light something dark to sit against" half of round 2's fix has not happened, and the frame's darks arrived in the corners and on the pylons rather than adjacent to any emissive. The one place an emissive now has a dark neighbour is the deck cast shadow at 0.48, which is the best available test site.
- **Item 3, the rim.** Unblocked, and materially easier than it was: silhouette contrast at `hub-backlit` went from 0.205 to 0.333. The chroma half is untouched and the shadow side is still grey, warmth -12 to +6.
- **Item 5, decoration out-values the ground.** The comparison moved slightly against the decoration, because the lawn rose from 0.5141 to 0.5467 while the shards did not move. Still inverted.
- **Item 9, ambient occlusion.** Closed by this round, and I concur. See section 3.
- **Item 10, depth of field.** Still not built. Note for whoever enables it that the frame now has a hard-edged contact decal on flat stone at close range, F4, which near-field blur would smear into something worse.

---

## Harness

Two new items, both of the established pattern: a valid file containing the wrong thing.

**Ninth silent failure: the `grey/` directory cannot be measured.**
Those frames are **1000x563**, downscaled from 1660x934, and converted with ImageMagick's `-colorspace Gray`, which linearises.
They carry `Colorspace: Gray` and `gamma=0.454545`.
So they fail twice: every coordinate from every previous round lands on a different part of the picture, and the values disagree with the band system's convention, which is the exact trap `tools/critique/README.md` warns about in its "do not ask ImageMagick for the number" paragraph.
A box that reads 0.5389 on the colour frame reads nothing comparable on the grey one, and a sky pixel at 0.9267 in the correct convention reads 0.7804 there.
They are fine to squint at and must never be quoted.
Every greyscale figure in this report is computed from the colour PNG with Rec.709 weights applied to the gamma-encoded bytes, at full resolution.
`frame.mjs` should grow a `grey <png> <out.png>` subcommand so the next round cannot reintroduce this.

**The stated triangle tolerance does not hold at low.**
The brief says every frame was verified with the triangle count inside 0.3% of the settled scene.
That is true at high and medium, where the worst is -0.277%.
At low the deltas reach **+1.82% at `hub-portal` and -1.91% at `hub-backlit`**, in both the base and after arms and to within 0.001 of each other, so it is systematic rather than a capture flake and the frames are not suspect.
It does mean the low-tier reference count is being taken from a vantage whose instancing differs, and a future `ok` gate tightened to 0.3% would start failing low for a reason that is not a bug.

**One doc drift, F10 above.** `vantages.ts` lists `hub-totem` at 0.61 of frame height and it is now 0.541, because the progression pin the round introduced removes the chrome dome at that vantage. Five of six coverage figures still match to 0.006.

Nothing else looked like the harness lying.
The two arms of every A/B differ only in the one variable they should, progression is pinned everywhere, the offline and in-page histograms agree exactly on four frames, and two captures of the same page load remain bit-identical.

---

## Verdict

The single thing most holding this image back is that **the lawn is not a value, it is a 0.37-wide distribution, and it is the only surface in the game that reads simultaneously as walkable stone, as the empty gap, and as unclimbable cliff.**

Its 5th to 95th percentile spans 0.363 to 0.731.
Ten per cent of the whole frame is grass sitting inside the 0.38-0.56 band that the entire band system depends on being empty, and grass is 60.8% of everything in that band.
Its lower quartile reaches down to where the soil rim lives, which is the value that means "you cannot go there", and its upper quartile overlaps the deck's own distribution across the middle, lawn p75 at 0.615 against deck p25 at 0.535.
That is why the correctly desaturated frame is one grey mass, why "you must instantly read where you can stand" still cannot be answered, and why at 12% squint the only things with any structure are the eight dark pylons and the pale sky.

This is a different diagnosis from both previous rounds and that is the point of it.
Round 1 said the lawn was in the wrong band and was right.
Round 2 said there were no darks and was right.
Round 3 has now added darks and moved the lawn's mean to 0.561, technically inside its band, and the test still fails, because the mean was never the thing.
Every acceptance row that has been written about the lawn for three rounds has asked for a "clean patch" to land inside 0.56-0.74, and a clean patch is the wrong statistic for a surface made of two hundred thousand blades whose own tip-to-root ramp is wider than the band it is supposed to occupy.

Round 4 should compress the lawn's spread from the bottom, not shift its mean.
The tip-to-root ramp round 2 correctly asked for currently runs the roots to about 0.38, so the fix that gave grass its ground contact is the same one putting walkable ground into the unwalkable band; re-target it to roughly 0.72 at the tips and 0.60 at the roots.
Then merge the ziggurat's four disconnected strut shadows into one contiguous ground shadow, which is the dark this world actually needed and which the decision document demoted on arithmetic that was right about the number and wrong about the conclusion.
Those two changes together would put the frame's floor under the subject in all six vantages instead of in two corners of one, and they would settle F1 without touching the ambient, which is the constraint the previous round correctly insisted on.

Do not reinstate ambient occlusion. Section 3 is unambiguous: three quarters to nineteen twentieths of what it did was dim the lawn and crush the hero's crevices to 0.09, and the object-base contact that replaced it is deeper than what it removed.
Fix the kerb and riser inside corners with authored geometry, and fix the character's contact blob so it stops terminating in a visible polygon on flat stone.
