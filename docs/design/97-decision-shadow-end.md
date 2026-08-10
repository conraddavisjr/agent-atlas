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

1. **The island's underside.** The mass below the lawn, visible below the overhanging lip, darkest at the bottom of the silhouette. It is the largest single dark area in every wide shot, it is contiguous, it is bottom-weighted, and it is outside the playable world, so a near-black there costs the readability test nothing.
2. **Cast shadow, on decks and on lawn.** Darks that are attached to the objects that make them. This is where bloom and the rim get the neighbour they need, and where round 2's F14 uncontacted object bases get their contact.
3. **Recessed apertures**: kerb faces, riser faces, panel gaps, vents. Small, linear, and they draw the world's own edges.

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

1. **It cannot be the shadow end, because it cannot be composed.** It is screen-space and has no notion of which object a sample belongs to, so with the radius anywhere near blade height it projects the grass field's depth pattern onto whatever is standing in the grass, hero included. And its floor is arithmetic: `mix(scene, color * scene, 1 - ao)` with `color = #8fa4cc` puts a fully occluded pixel at 37% of its own value. It can make a smudge in the 0.4s. It has no access to 0.10, which is the number this round is about.
2. **It costs about half the frame rate at high.** Three alternating runs each: 35.9 / 21.0 / 31.3 mean fps with it on against 74.2 / 61.7 / 59.9 with it off, p95 11.5 / 9.5 / 10.0 against 21.9 / 22.4 / 15.6. No overlap in either column.
3. **Both jobs it was kept for are served better elsewhere.** Blade-to-ground contact is baked into the grass's own vertex colour now and does not depend on the pass. Object-base contact is what item 1's second clause owns, and round 2's F14 records that the pass was not delivering it anyway.
4. **On at medium and high and off at low is the tier ladder changing the art rather than the fidelity**, which section 7 of the bible and round 1's F5 both prohibit. Off at all three makes the three tiers the same picture.
5. **It has been a net negative twice in two rounds.** The crackle, which was its own sampling pattern amplified by an exponent of 3.0, and then the interaction that made every high-tier surface read as scuffed plastic.

The pass stays wired in `PostFX.tsx` with its tuned props and their reasoning intact, and the lever inverts: `?gfx=ao` turns it back on so the A/B stays reproducible without a rebuild.
Nothing else depends on the pass existing.

---

## Acceptance, on the frame

The claims above are measurable and this is how they will be checked. `hub-establishing` at high is the acceptance shot for the band, `hub-backlit` and `hub-totem` for contact.

| | before | required after |
| --- | --- | --- |
| `establishing` below 0.10 | 0.00% | at least 1.5% |
| `establishing` below 0.20 | 1.59% | 8% to 14% |
| `establishing` 0.38-0.56 | 21.76% | below 15% |
| sub-0.20 pixels in the bottom third | 45.4% | at least 60% |
| sub-0.20 pixels on pylons, struts and arcs | most of them | under 25% |
| island edge profile, `col` at x=1550 | flat 0.230 to 0.202 over 90 px | a gradient reaching 0.18 or below |
| lawn, clean patch | 0.5015 / 0.5635 | inside 0.56-0.74 |
| cast shadow on stone deck | not measured | 0.18 or more below the lit deck |
| shell shadow side, `backlit` | 0.55-0.60 at saturation 0.084 | 0.40-0.48 at higher saturation |
| ground within 0.3 m of a pylon base | no treatment at all | 0.12 or more below ground 2 m away |
| HF noise, round 2's three F3 patches | 3.32 / 2.62 / 3.33 | at or below the low tier's 0.24 / 0.63 / 0.74 |

The band-occupancy and location numbers are computed on the captured PNG with the same Rec.709-on-gamma-encoded-bytes convention `__dev.sample()` uses, and that measurement was verified against the in-page one before any of it was believed: mean 0.6474, below-0.30 5.53%, above-0.80 22.86% from both, to four decimal places.
That check matters more than it looks.
ImageMagick's own `-fx` and `%[fx:mean]` disagree with the eyedropper convention by about 0.18 of luma on these frames, which is more than a whole band wide, and a threshold expression built on it reported 50% of every frame above 0.86.

---

## What this decision does not cover

Deliberately out of scope, so that the next round has a clean brief rather than a diffuse one.

Handoff items 2 (nothing emits light), 3 (the rim at `hub-backlit`), 4 (the cape is still a flat quad), 5 (decoration out-values the ground), 6 (the node glass shell), 7 (the backdrop arc), 8 (low tier's floating cable), and 10 (depth of field, and the particle system) are all unchanged and all still open.

Items 2 and 3 are the two that were blocked on this decision and are now unblocked.
