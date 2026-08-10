# Decision: what the darkest thing in this world is, and whether ambient occlusion stays

Handoff items 1 and 9, settled together as one composition call, because they are one question.
Written before any of the implementation, so that the implementation can be judged against it rather than described by it.

Read `00-art-bible.md` section 8 first. This file extends it, and where it and a numbered spec disagree, the bible still wins.

---

## Why the loop stalled here

Two reviewers reached opposite verdicts about the same pixels and both were right.

Round 1 measured the eight near-black pylons at 0.085 display luma against a 0.867 sky, called them the highest contrast in the frame, and had them lifted into the midground band.
That was correct: the eye went to them and stayed, and the portal the whole hub points at was about 1% of frame.

Round 2 then measured what the lift cost and called it blocking: only 6.5% of `hub-establishing` below 0.30 against 16.6% in the pre-round baseline, and everything else downstream of it.
That is also correct.
Bloom cannot read with nothing dark for light to sit against, a rim cannot read against a shadow side already at 0.55, and three semantic classes cannot be told apart in greyscale when they share one value.

Both reviewers were describing the same 6% of the frame from opposite sides.
Neither could resolve it, because the question is not how dark the darks should be.
It is **which objects are allowed to be dark**, and no measurement answers that.

---

## The pre-round-3 baseline, measured

Fresh captures at high, 1660x934 drawing buffer, `pinDpr(1)`, all six vantages verified `drew` with triangles inside 0.3% of the settled scene.
Display-space Rec.709 luma throughout, the `__dev.sample()` convention.

These numbers supersede round 2's, because `3f951f2` brought the sky's horizon down from 0.9114 to 0.7913 after round 2 was written.

| | `establishing` | `portal` | `character` | `grazing` | `totem` | `backlit` |
| --- | --- | --- | --- | --- | --- | --- |
| below 0.10 | **0.00%** | 0.16% | 0.71% | 0.42% | 0.64% | 0.62% |
| below 0.20 (anchor) | **1.59%** | 5.52% | 3.93% | 2.70% | 2.94% | 3.82% |
| 0.20-0.38 midground | 8.10% | 9.51% | 9.78% | 8.56% | 7.11% | 10.12% |
| 0.38-0.56 no man's land | **21.76%** | 10.33% | 27.51% | 29.82% | 25.59% | 22.84% |
| 0.56-0.74 gameplay | 20.84% | 26.27% | 31.01% | 12.50% | 33.71% | 7.75% |
| 0.76-0.86 background | 42.48% | 39.41% | 21.48% | 43.60% | 24.02% | 54.32% |
| above 0.80 | 22.86% | 19.88% | 11.70% | 35.62% | 15.36% | 46.64% |

The sky fix worked and it did not touch the problem.
`hub-establishing` went from 46.2% of the frame above 0.80 to 22.86%, and the shadow end did not move: 1.59% below 0.20, and **nothing at all below 0.10.**
The floor of this world is 0.15.

Two numbers in that table are the whole finding.
**21.76% of `hub-establishing` sits between 0.38 and 0.56**, which is the gap the band system exists to keep empty, and it is the lawn: measured 0.5015 at one clean patch and 0.5635 at another, against a gameplay floor of 0.56.
And the largest walkable surface being one band below where it belongs is *not* what makes the image flat, because pulling it up would only put more of the frame into the same mid mass.

## Where the darks are, which is the part no one had measured

Thresholding `hub-establishing` at 0.20 and asking where those pixels are, rather than how many:

| | share of the sub-0.20 pixels |
| --- | --- |
| top third of frame | 4.4% |
| middle third | 50.2% |
| bottom third | 45.4% |
| left third | 15.9% |
| centre third | 19.0% |
| **right third** | **65.1%** |

Rendered as a mask, that 1.59% is: the shaded sides of the right-hand pylons, the catenary arcs, a few navy kerb faces on the terraces, and a hairline of island rim.
Nothing else in the picture is darker than 0.20.

**The darks in this frame are in the shape of a cage.**
Eight verticals ringing the perimeter, four of them cropped by the top edge, weighted two thirds to one side, with the subject in the middle of the ring.
This is why lifting them was right and why lifting them hurt: they were the only darks, and they were in the worst possible place for a dark to be.

---

## The decision

> **The darkest thing in this world is the ground, seen from underneath.**

A fourth value band, and a closed list of what may occupy it.

**Anchor: 0.06 to 0.18.**
Membership, in order of how much of the band each is expected to carry:

1. **The island's underside.** The mass below the lawn, visible below the overhanging lip, darkest at the bottom of the silhouette. It is contiguous, bottom-weighted, and outside the playable world, so a near-black there costs the readability test nothing.
2. **Recessed apertures**: kerb faces, riser faces, panel gaps, vents. Small, linear, and they draw the world's own edges. Measured after implementation, an unlit `+Z` kerb face lands at 0.063 and a deck side face at 0.177, so this clause carries more of the band than it looks like it should.
3. **Cast shadow, on decks and on lawn** - **which does not reach this band, and cannot.** This entry was written as a third member and that was an error. Landing a stone deck's cast shadow inside 0.06 to 0.18 needs its irradiance cut to about 30% of what it receives, which is the "darken the ambient globally" option this same document rejects two sections below. The reachable target is the acceptance row: at least 0.18 *below* the lit deck beside it, which puts it near 0.38, in the midground band. Cast shadow is still the dark that matters most for bloom and the rim, because it is the dark that sits *adjacent* to a lit surface. It is simply a midground dark, not an anchor one.

The correction in item 3 came from the stream that was told to deliver it, which priced the ambient cut and reported that the instruction and the acceptance row differed by two whole bands.
That is the loop working as intended and the entry is left in place, corrected, rather than quietly rewritten.

And the clause that is the actual content of the decision:

> **No repeated vertical object may be the darkest thing in the frame.**
> Pylons, struts, catenary arcs and backdrop monoliths are the frame, and the frame stays in the midground band, 0.20 to 0.38.

That is what reconciles the two rounds.
A dark value's job depends on where it sits.
Contiguous along the bottom of the frame it is gravity: it says the island is a solid object with weight, floating in air, lit from above.
Distributed around the perimeter on eight verticals, the identical value is a fence, and it competes with the subject for the eye instead of holding the subject up.
Round 1 was right to lift the pylons and round 2 is right that the darks must come back.
They are not the same darks.

### Why the underside, specifically

It is the one place in this picture where a near-black can be large without costing anything else.

Nothing gameplay-relevant is down there, so the greyscale test is not put at risk by it: a player never has to decide whether they can stand on the island's keel.
No emissive needs to read against it, so it does not interact with the bloom budget.
It is below the horizon line of every vantage in the game, so it can never become the frame's strongest edge against the sky the way the pylons did.
And it is already half built: the lip exists and it is a real gain, but the profile turns in immediately below it, so what the eye actually sees is a flat 0.20 to 0.23 band with sky under it.
Measured down the island's bottom-right edge at x=1550, the lawn ends at 0.58 and the rim runs 0.230, 0.227, 0.223 ... 0.202 for ninety pixels to the bottom of the frame with no gradient at all.
The island has a trim, not a thickness.

### Why not the alternatives

**Put the pylons back.** Rejected. It is the round-1 finding re-broken, and the mask above shows exactly why: the shape of the result is a cage.

**Cast shadows alone.** Not sufficient by itself, and not because of the shadow map. Under the current rig a shadowed surface still receives 1.00 of directional (fill 0.25, rim 0.55, bounce 0.20) plus hemisphere 0.55 plus environment 0.85 against a key of 1.55, so occluding the key removes well under half the light reaching a surface. That is a real target for this round, and it is item 2 of the band above rather than the whole answer.

**A dark negative-fill card in the environment.** Already there. `#0b0f1a` at peak radiance 0.009, and its occlusion of the cards behind it is the mechanism rather than its colour. It is not producing an anchor and a second one will not either.

**Darken the ambient globally.** That flattens rather than structures. It moves the whole histogram down and keeps the frame one mass, and it makes the portal door and every locked surface unreadable, which the palette's own `locked` comment already warns about.

---

## Item 9: ambient occlusion comes out, at every tier

**Decided: `ambientOcclusion: false` at low, medium and high.**

The case for keeping it was item 1, and item 1 has now been decided against it.

1. **It cannot be the shadow end, and this is measured rather than argued.** A clean A/B at high, same origin, same progression, same procedure, `?nogfx=ao` against the default:

| `hub-establishing`, high | AO on | AO off | what the pass is worth |
| --- | --- | --- | --- |
| mean | 0.6473 | 0.6627 | -0.0154 |
| below 0.10 | 0.00% | 0.00% | **nothing** |
| below 0.20 | 1.60% | 1.44% | 0.16 points |
| below 0.30 | 5.53% | 4.92% | 0.61 points |
| 0.38-0.56 | 21.76% | 15.83% | 5.9 points |

Across the other four vantages the pass is worth 0.4 to 1.0 points of the share below 0.30 and, in every one, **nothing at all below 0.10.**

That is the whole case. The target for this round is to move the share below 0.20 from 1.6% to 8-14%, and the pass in question supplies 0.16 of those points. Its floor is arithmetic and explains why: `mix(scene, color * scene, 1 - ao)` with `color = #8fa4cc` puts a fully occluded pixel at 37% of its own value, so on a 0.65 deck it can reach 0.47 and no further. It can make a smudge in the 0.4s; it has no access to 0.10.

Note the fourth row, which is a gain and not a cost. The pass was holding the lawn 0.046 below where it should be, which is 5.9 points of the frame stuck in the gap between the midground and gameplay bands. **Turning it off delivers a large part of the "lawn inside its own band" row on its own**, so anything else aimed at the lawn has to be sized after this lands rather than before, or the two lifts compound past 0.74 and re-break round 1's finding from the other side.

It is also screen-space, with no notion of which object a sample belongs to, so with the radius anywhere near blade height it projects the grass field's depth pattern onto whatever is standing in the grass, hero included.
2. **It costs about half the frame rate at high, and this was re-measured after the round rather than inherited.**

Two alternating pairs, `?quality=high` against `?quality=high&gfx=ao`, three 10-second runs per load, on the frozen camera-pinned `hub-establishing`, with the buffer, progression, settle and triangle count gated on every load:

| | mean fps | p95 fps |
| --- | --- | --- |
| AO off (A1 / A2) | 92.3 / 85.1 / 85.6 and 92.8 / 85.4 / 85.6 | 67.1 / 63.7 / 79.4 and 69.4 / 71.9 / 79.4 |
| AO on (B1 / B2) | 50.1 / 44.3 / 43.9 and 48.9 / 43.7 / 43.8 | 23.9 / 23.6 / 41.5 and 23.9 / 23.6 / 42.6 |

Median ratios **1.93 and 1.95** on mean, **2.81 and 3.01** on p95.
The arms do not overlap anywhere: the slowest AO-off run is 85.1 and the fastest AO-on run is 50.1.
And the ratio spread is 1.01 against a raw spread of 1.09 within one arm, so the pairing is doing its job rather than the machine being quiet.
The absolute numbers are much higher than the ones on record from the previous session, which is exactly the warning in the handoff and exactly why only the ratio is quoted as the finding.

Two pairs were run rather than three. The conclusion did not need a third and the round had other work; that is a shortcut and it is recorded as one.
3. **One of the two jobs it was kept for is served better elsewhere, and the other was never being done for the reason anyone thought.** Blade-to-ground contact is baked into the grass's own vertex colour and does not depend on the pass: round 2 measured the near sward ramping 0.516 at the tips to 0.377 at the roots, which is 0.139 of display luma produced by a vertex attribute.

Object-base contact is the interesting half. Round 2's F14 records the pylon meeting the lawn with no treatment at all, and that was written with the pass running, so the obvious reading is that the pass cannot reach a 0.28 m contact. That reading is wrong and the real reason is worse. **A pylon is `pill(0.34, h - 0.68)`, a capsule translated so the bottom of its lower hemisphere sits exactly on a flat lawn at y = 0, which is a sphere tangent to a plane touching at a single point.** The surfaces separate quadratically - 0.004 m of gap at 5 cm out - so it is the contact shape that produces the least occlusion of any, and no occlusion pass and no shadow map will ever draw a contact there. That is a geometry defect, it is item 2 of the anchor band's membership to fix, and it would have survived any amount of work on the pass.

Where the pass genuinely was earning its cost is flat-on-flat stone: the totem plinth on its spur lobe, deck pucks on the lawn, the portal jambs on T3, all with fillets of 0.05 to 0.12. At a corner like that visibility approaches 0.5 and the pass was putting a real 0.28 m band down, taking a 0.65 deck to roughly 0.47. **That band is a real loss and it is measured, not waved away** - see the acceptance table. Item 3 of the anchor band's membership is what replaces it, and the two are not interchangeable: a cast shadow darkens only the sun-opposite side where occlusion darkened all the way round.
4. **On at medium and high and off at low is the tier ladder changing the art rather than the fidelity**, which section 7 of the bible and round 1's F5 both prohibit. Off at all three makes the three tiers the same picture.
5. **It has been a net negative twice in two rounds.** The crackle, which was its own sampling pattern amplified by an exponent of 3.0, and then the interaction that made every high-tier surface read as scuffed plastic.

The pass stays wired in `PostFX.tsx` with its tuned props and their reasoning intact, and the lever inverts: `?gfx=ao` turns it back on so the A/B stays reproducible without a rebuild.
Nothing else depends on the pass existing.

---

## Acceptance, on the frame

The claims above are measurable and this is how they will be checked. `hub-establishing` at high is the acceptance shot for the band, `hub-backlit` and `hub-totem` for contact.

| | before | required after | outcome |
| --- | --- | --- | --- |
| `establishing` below 0.10 | 0.00% | at least 1.5% | **0.14%. Target withdrawn as unreachable, see below.** |
| `establishing` below 0.20 | 1.59% | 8% to 14% | **3.12%. Target withdrawn as unreachable, see below.** |
| `establishing` 0.38-0.56 | 21.76% | below 15% | 16.55%. Close, and most of it came from removing the occlusion pass. |
| sub-0.20 in the bottom third | 45.4% | at least 60% | 47.8% at 0.20, **56.5% at 0.15.** Partly met, and the threshold matters. |
| sub-0.20 on pylons, struts, arcs | most of them | under 25% | **Not met, and it moved the wrong way. See below.** |
| island edge profile, `col` at x=1550 | flat 0.230 to 0.202 over 90 px | a gradient reaching 0.18 or below | **Met.** 0.232 monotone to 0.116, 44 px at or under 0.18. |
| lawn, clean patch | 0.5015 / 0.5635 | inside 0.56-0.74 | 0.5343. Not met; the fill cut took back most of what the occlusion removal gave. |
| cast shadow on stone deck | not measured | 0.18 or more below the lit deck | Met by prediction at 0.207, to be confirmed by the reviewer. |
| shell shadow side, `backlit` | 0.55-0.60 at saturation 0.084 | 0.40-0.48 at higher saturation | Met by prediction at 0.469, saturation 3.3x. Reviewer to confirm. |
| a visible object-to-deck junction | 0.28 m occlusion band, lost with the pass | recovered by authored contact, at least as deep | Reviewer to confirm. |
| ground beside a pylon shaft | tangent capsule, no corner to occlude | a corner exists, and reads | Geometry fixed. Reviewer to confirm it reads. |

### Two rows of this table were unreachable when it was written, and the reason is worth more than the rows were

The first two asked the island's underside to carry 8 to 14% of the frame below 0.20, and 1.5% below 0.10.
Two streams, working from opposite ends and unaware of each other, independently proved that impossible with arithmetic.

For a solid of revolution seen from outside and above, **the profile stop of maximum radius IS the lower silhouette**: everything below it is behind it or back-facing.
So the island's visible underside is bounded by the overhang, and in `hub-establishing` it is 20,420 pixels, **1.16% of the frame.**
Reaching 8% needs 124,000. Even painted pure black it caps the frame at about 2.9%.
And it appears in **one of the six vantages**: from a camera standing on the plateau a ray reaches the skirt only if height over distance-to-the-lawn-edge exceeds the slope of the first stop below the lawn, which it does at `hub-establishing` and, marginally, at `hub-portal` (486 px), and at none of the other four.

Those two rows were an integrator's guess at a frame share, made without projecting the geometry, and they are withdrawn.
The rows that survive are the ones stated as **profiles and locations** rather than as frame shares: the gradient down the silhouette, and where in the frame the darks sit.
A frame-share target for a feature whose area is fixed by geometry is not an acceptance criterion, it is a wish.

### The prohibition is not met, and the reason is structural

"No repeated vertical object may be the darkest thing in the frame" is the actual content of this decision, and after implementation the eight pylons are **deeper into the anchor band than they were**: a shaded shaft measured 0.185 before and **0.138** after.

The cause is not carelessness, it is the shape of the problem.
A cast shadow only reads if the ambient fill is low enough that losing the key matters, and lowering the ambient darkens **every** surface that faces away from the key - including eight verticals.
Albedo cannot separate them, because the pylons' lit and shaded sides are 0.365 and 0.138 apart under a 2.6:1 key ratio, and no single hex puts both inside a band 0.18 wide.

So the two halves of this decision are in tension, and this round bought the cast shadow at the cost of the prohibition.
What survives is the weaker, and honestly the original, claim: at the deepest end, **56.5% of everything below 0.15 is now in the bottom third of the frame**, and the largest single contiguous dark shape is the island's underside rather than a ring of pickets. The darks have changed shape. They have not stopped including the cage.

Round 4 inherits this as a specific question with the arithmetic already done: either the pylons get fewer, or they get a lit-side treatment that is not albedo, or the prohibition is restated as being about the shape the darks make at squint rather than about every pixel. **It should not be settled by putting the ambient back.**

Round 2's F3 measured a high-frequency noise metric on three patches and read 3.32 / 2.62 / 3.33 at high against 0.24 / 0.63 / 0.74 at low.
**That row is deliberately not in this table, and the reason is worth writing down.**
F3 explicitly exonerated ambient occlusion at the time - the pass runs at medium and medium was clean - blamed grass casting into the shadow map, and `24022db` fixed it before this round started.
Ambient occlusion is configured identically at medium and high, same sample counts, same radius, intensity, colour and half-resolution, so its contribution to noise at high equals its contribution at medium, which was measured as clean.
Predicted consequence: removing the pass will move those three patches barely at all.
Putting the row in this round's acceptance table would credit an already-fixed regression to this change, and then read a correct null result as a failure.
The patches are still worth capturing, in all three states, and `?gfx=ao` is what makes the pre-state recoverable at all.

The band-occupancy and location numbers are computed on the captured PNG with the same Rec.709-on-gamma-encoded-bytes convention `__dev.sample()` uses, and that measurement was verified against the in-page one before any of it was believed: mean 0.6474, below-0.30 5.53%, above-0.80 22.86% from both, to four decimal places.
That check matters more than it looks.
ImageMagick's own `-fx` and `%[fx:mean]` disagree with the eyedropper convention by about 0.18 of luma on these frames, which is more than a whole band wide, and a threshold expression built on it reported 50% of every frame above 0.86.

**And one more thing had to be pinned before any of this was believable, which is the seventh silent failure in this screenshot path.**
A vantage pins the camera, the player, the clock, the field of view and the drawing buffer. It did not pin progression, and progression changes the frame: four lesson totems switch between `locked` at 0.383 and `unlocked` at 0.804, and the Core node gains its completion rings, which are among the brightest elements in `hub-establishing`.
The save lives in `localStorage`, which is keyed by origin, so two dev servers on two ports are two different save files.
Two capture sets of the same commit at the same tier, one from each, disagreed by 0.0106 of whole-frame mean luma and 0.9 points of the share below 0.20 - larger than the ambient-occlusion effect they were being compared to measure - while all five local probes agreed to within 0.004, because the difference is confined to two objects near the centre of frame.
Nothing about the numbers looked wrong. A coarse 10x6 luma map is what localised it.
`__dev.setProgress()` now pins it, `capture()` reports the state it was taken at, and **every number in this document is at five of five lessons complete**, which is what rounds 1 and 2 were captured at.

---

## What this decision does not cover

Deliberately out of scope, so that the next round has a clean brief rather than a diffuse one.

Handoff items 2 (nothing emits light), 3 (the rim at `hub-backlit`), 4 (the cape is still a flat quad), 5 (decoration out-values the ground), 6 (the node glass shell), 7 (the backdrop arc), 8 (low tier's floating cable), and 10 (depth of field, and the particle system) are all unchanged and all still open.

Items 2 and 3 are the two that were blocked on this decision and are now unblocked.
