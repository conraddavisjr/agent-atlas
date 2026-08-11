# Critique round 2

Judged on `.critique/round2/` at high unless stated. Every number is display-space Rec.709 luma in 0-1, measured on the PNG (verified against `magick -crop 40x40+800+700 -format '%[fx:mean]'` = 0.5372 on the supplied patch).
`HF` = RMS deviation of a pixel from its own 5x5 local mean, in /255 - a high-frequency-noise metric that ignores gradients.

The rim was judged fresh, with no reference to the round-1 conclusion.

---

## Blocking

### F1. Nothing in this world emits light. Whole-image; acceptance shot is `hub-totem`.

**Required.** Art bible section 1 is built entirely around the bloom budget, and `hub-totem`'s own criterion is *"Totem emissive intensity against the bloom threshold. Nothing except the emissive itself may glow."* The brief: *"Emissive bright enough to clear the bloom threshold while the white plastic does not. That is the whole reason to run a high threshold."*

**Measured.** Not one emissive in the six frames produces a halo.

| Emissive | Peak | Transition into its neighbour |
| --- | --- | --- |
| Totem ring, `hub-totem` x=930 | 0.921 | y450 **0.844** to y455 **0.507** - under 5 px, zero bleed |
| Portal lintel bar, `hub-portal` x=830 | 0.948 | y132 **0.364** (lintel) to y136 **0.891** - one step |
| Visor glyph, `hub-character` x=870 | 0.945 | 0.076 to 0.735 to 0.076 across 3 px |
| Core-node ring, `hub-establishing` | 0.957 | the only halo in the set: **+0.013** over 28 px |

The totem plinth *directly under* the ring measures **0.527**, darker than the open deck at **0.698**. A light source that leaves the object it is mounted on darker than the floor.

Meanwhile the chrome dome's specular in `hub-backlit` is clipped at (255,252,241) and **does** halo: the sky above it rises from 0.8737 to 0.8983 twenty pixels out and 0.9484 six pixels out, **+0.021 to +0.070**. The only thing crossing the threshold in the game is a white plastic-and-chrome highlight, which is the budget exactly inverted.

Two causes, and both are visible in the frames. First, most of the world is authored at `GLOW.source = 0.66`, i.e. deliberately at 66% of threshold, so bloom is guaranteed to output black for it - the bible's defect 1 has moved from the threshold to the glow values, it has not gone away. Second, the three objects that *are* at `GLOW.bloom = 1.25` (portal bar, core ring, visor core) still produce nothing, because every one of them is silhouetted against a **0.832-0.886** sky, where an additive linear contribution is compressed to nothing by ACES.

**Why it reads wrong.** The LED is the character's entire identity and the totem ring is the level's reward signal. Both currently read as printed paint on plastic. Nothing in frame gives off light onto anything else.

**Smallest fix.** Give the light sources something dark to glow against before touching any threshold: drop the sky's ceiling from 0.855 to about 0.78 and add the brief's dark negative-fill card to the environment. Then move the three hero emissives (totem ring, portal lintel, visor bar) from `GLOW.source` to `GLOW.bloom`, and build them with the pale-core-plus-halo-shell construction the bible already mandates in section 1 rather than relying on the post pass alone.

---

### F2. The rim still does not read on the shell, in the shot whose only job is the rim. `hub-backlit`.

**Required.** Art bible section 2 splits the rim into a diffuse wrap at 0.55 and a specular strip card. Brief: *"a cool rim/kicker hugging the top-back silhouette... this is what separates figures from backgrounds without outlines."*

**Measured.** One-pixel profiles stepping inward from the silhouette (1,2,3,4,6,9,14,22,34 px):

```
y430  left  0.525 0.536 0.567 0.606 0.575 0.556 0.582 0.537 0.594
y430  right 0.466 0.450 0.446 0.489 0.531 0.534 0.518 0.545 0.558
y440  left  0.568 0.534 0.529 ...            0.470 at 25 px
y440  right 0.616 0.482 0.527 ...            0.548 at 25 px
```

Both edges brighten *inward*. There is no 3-8 px bright band on either side at any row. The rig is producing a rim somewhere - `hub-character` has a genuine tight highlight along the top edge of the head peaking at **0.966** - it contributes nothing at this azimuth, where the camera bearing and the key azimuth coincide.

Worse, the head has no form at all here. Down the vertical at x=820 the shell runs **0.562 to 0.604 from y=420 to y=590** - 0.04 of value across 170 px of a curved surface - at rgb (141,154,152), **saturation 0.084**. Against the brief's biggest single tell (*"a strongly coloured ambient fill, never grey... the shadow side of white plastic always takes the level's dominant hue"*), the shadow side of the hero, standing in a saturated green lawn under a blue sky, is neutral grey.

**Why it reads wrong.** In the one frame built to prove the character separates from its background, he is a flat, uniform, achromatic silhouette against a 0.886 sky with an undifferentiated edge.

**Smallest fix.** Offset the rim's azimuth 35-50 degrees off the camera axis rather than 0/180, so it can never collapse onto the key; and give the hemisphere's ground colour the lawn's hue so the shadow side stops being grey.

---

### F3. At the high tier only, every surface is covered in blade-shaped noise. Whole-image, high tier. **Regression.**

**Required.** Brief section 1: everything is a manufactured object; photographic scuffing is *"exactly what this world rule excludes"*. Brief section 4: *"strong AA - aliasing destroys the moulded-object illusion faster than anything else."*

**Measured.** HF (/255) on identical patches, all three tiers plus the baseline:

| Patch | low | medium | **high** | baseline high |
| --- | --- | --- | --- | --- |
| `hub-totem` plain deck (680,760) | 0.24 | 0.25 | **3.32** | 0.34 |
| `hub-character` belly (770,515) | 0.63 | 0.76 | **2.62** | 0.89 |
| `hub-character` hand (700,505) | 0.74 | 1.05 | **3.33** | 0.90 |

Ten to thirteen times the baseline, and ten to thirteen times low and medium. At 250% the same stone deck is spotless at low, carries a handful of ticks at medium, and at high is covered edge to edge in blue-grey blade-shaped strokes and dither. The hero's white shell carries the same marks.

This is **not** the logged `hub-backlit` AO crackle. AO runs at medium too and medium is clean; the artifact appears on stone decks in `hub-totem` and `hub-character`, and it is worst on the hero close-up. The only thing high adds over medium is grass casting into the shadow map, which matches both the shape of the marks and the tier boundary exactly.

**Why it reads wrong.** The single most important surface in the game reads as scuffed, second-hand plastic, and the stone reads as dirty concrete. It is the first thing the eye finds at 100% in the hero shot, and the baseline did not have it.

**Smallest fix.** Turn off `grassCastShadow` at high, or cast from a decimated proxy, and re-measure those three patches.

---

## Major

### F4. Decoration out-values and out-chromas both the ground and the hero. Whole-image; worst in `hub-grazing` and `hub-establishing`.

The pink shards measure **0.692-0.748** (`hub-grazing`) and **0.730** (`hub-establishing`) at rgb (252,155,228) with **the red channel clipped at 255 across the whole body**, so the cone has no shading in red at all and reads as flat chalk. Against: lawn 0.478-0.592, decks 0.612-0.698, hero shell 0.495-0.717.

Brief section 5 wants mid-ground dressing chroma down ~25% and value pushed *away* from the platform band, with the character as the value anomaly and the brightest thing in frame. Both are inverted: scenery is the brightest object on the island and out-chromas the hero. In the greyscale `hub-grazing` frame the shards, the lawn and the character are one value - decoration, ground and hero are indistinguishable. Round 1 called this at 0.74-0.78; it has moved 0.03.

The inverted contact halo round 1 flagged is also still there: ground under a cluster **0.650** against **0.512** two hundred pixels away in `hub-grazing`, **0.639** against **0.554** in `hub-establishing`. Bright bald ground under the props.

**Smallest fix.** They are `crystal(palette.token, 0.34)` - emissive at a third of the bloom threshold over a clearcoat-0.85 surface. Take the emissive to `GLOW.hold` and the albedo value to ~0.45 so a shard sits under the lawn rather than over it.

---

### F5. The node "glow" shell darkens the sky it is drawn over. Whole-image.

The bible mandates *"a near-white emissive core... surrounded by a dimmer saturated shell"*. What is on screen is a violet plastic sphere at 0.34 alpha, which over a 0.86 pale sky averages to a desaturated blue-grey.

`hub-character`, scanline y=130 across the pylon-top node: sky **0.7926** stepping to shell **0.7248** over 7 px, and on the far side shell **0.7643** to sky **0.8211**. The shell is **0.06-0.07 darker than the background it is meant to halo**, with a hard circular silhouette and its own specular streak. Same at the Core: shell 0.802 against sky 0.862. The pale core inside it measures 0.805-0.849 - the same value as the sky, so it has no read of its own either.

**Why it reads wrong.** Every node in the world wears a dirty acrylic bauble. It is the opposite of a halo, and the hard circle boundary makes it read as a decal.

**Smallest fix.** Make the shell additive rather than alpha-blended, or drive its opacity by Fresnel so it disappears face-on and only rings the silhouette; and take the core above the sky value.

---

### F6. The three-band system is a two-band system, and the lawn is out of its own band. Whole-image.

| Surface | Bible | Measured (high) | Verdict |
| --- | --- | --- | --- |
| Lawn | 0.668 | 0.478-0.592 | below the 0.56 gameplay floor in `hub-grazing` and `hub-backlit` |
| Deck / puck | 0.735 | 0.612-0.698 | in band |
| Soil rim | 0.319 | 0.160-0.230 | at or below the 0.20 midground floor |
| Pink shards | - | 0.692-0.748 | top of gameplay - see F4 |
| Sky | - | 0.832-0.856 | in band |

Nothing else in `hub-establishing` occupies 0.20-0.38 except the eight pylons (0.158-0.296) and a 35-px soil lip. The histogram is bimodal: **45.7% of the frame sits in 0.80-0.90 (sky) and 41.3% between 0.30 and 0.80 (the entire island), with 6.5% below 0.30.** The baseline had 16.6% below 0.30. Squinted to 12%, the island is one undifferentiated grey mass and the only structure in the frame is the ring of dark pylons, which fences the composition and leads nowhere.

The greyscale acceptance test therefore still fails, for a different reason than round 1: not because the lawn is in the wrong band, but because there is no shadow end to the image at all.

**Smallest fix.** Take the sky's ceiling down to ~0.78 (which also unlocks F1) and pull the lawn up to its specified 0.668 by lighting rather than albedo. That opens a real gap at both ends without touching the palette table.

---

### F7. There is no midground layer; depth is fog and nothing else. `hub-portal`, `hub-backlit`, `hub-grazing`.

Brief section 6 asks for 3-4 parallax layers, each its own value band. There are two - gameplay and sky - plus a 13-slab backdrop arc at 95-130 m that fails to read as a third.

Those slabs measure **0.796-0.849 against a sky of 0.847-0.886** (a 0.04-0.05 separation) at sd 0.006-0.011, i.e. one flat tone per slab with no gradient. In `hub-backlit` one stands in the grass 15 m behind the subject as a **blank rounded-rectangle card with no base, no shadow and no interior detail**; in `hub-portal` two hang in the sky with nothing beneath them. They read as glass panes or unfinished placeholders, not as distant mass. Between the island edge and 95 m there is nothing at all, and `hub-portal`'s top half is empty gradient.

**Smallest fix.** Add the vertical gradient and the darker cap band the environment spec already calls for on these slabs, push the near ones to ~0.72 so they clear the sky, and add one silhouette layer at 30-50 m so the eye has a step to land on.

---

### F8. Round-1 F4 is recoloured, not fixed: a flat zero-thickness quad is still bolted to the hero. Whole-image.

In `hub-portal` it is a ~0.35 x 0.6 m plane, now orange instead of magenta, with three horizontal bands, hard square corners and a razor edge, passing through his left hip, occluding his leg, and **casting no shadow on a deck where his body casts a clean one**. In `hub-character` the same plane appears edge-on as an orange triangle between his legs with hard aliased edges and no contact. It is the highest-chroma element on the hero in three of six frames.

**Smallest fix.** Give it thickness and a bevel, and let it cast.

---

### F9. The three risers read as one slab, in the shot that exists to disprove it. `hub-portal`.

The vantage's stated job is *"the shot that has to prove the stack reads as steps rather than as one slab."*

T3 tread **0.612** / riser **0.603**. T2 tread **0.662** / riser **0.676**. T1 riser **0.642**, tread **0.587-0.642**. Every tread and every riser lies inside 0.59-0.68, and tread-to-riser separation is 0.01-0.03. The only thing distinguishing the steps is the navy kerb, which runs along the outside edges and not across the step faces, plus a thin AO line.

**Smallest fix.** Put the band-2 trim colour on the riser faces as well as the outer kerb. 0.10-0.12 of value between tread and riser is enough.

---

### F10. The portal is not the destination in either shot that names it. `hub-portal`, `hub-establishing`.

The arch is unlit sage-tan at **0.427-0.477** with a blotchy low-frequency mottle, no bevel highlight, no trim and no digital-DNA detailing - the one hero object in the level with no hero treatment. The shimmer inside it measures **0.922 at saturation 0.03**: a near-achromatic white swirl only 0.07-0.12 above the sky it sits against, which reads as a smudge on the lens rather than as a gateway.

In `hub-establishing` the arch is about 1% of frame, offset right of centre, and now partly overlapped by the core node's glass bubble. At 12% squint it disappears entirely, while eight pylons, six lamp orbs, four totem rings and ~28 shards read evenly all over the frame. The composition is an inventory, not a route: brief section 6 asks for the important thing to be centred and the main path to be unmistakable.

**Smallest fix.** Give the shimmer the level's hue instead of white and take it 0.15 clear of the sky, so the arch has an interior that reads. The centring is a layout change and can wait.

---

## Minor

### F11. The island still has no thickness. `hub-establishing`.

The soil rim now exists and it is a real gain - it measures **0.160-0.230** against a lawn at 0.52-0.59, so the silhouette finally has an edge. But it is a ~35 px lip on a 1550 px island with sky immediately below it. A diorama island reads as a chunk with mass; this reads as a green disc with a chocolate trim. **Smallest fix:** taper a second, darker skirt band below the existing lip.

### F12. Low tier still ships broken geometry. `low--hub-establishing`, `low--hub-grazing`.

The cable arc still hangs with both ends square-cut in mid-air, roughly 40 px clear of the pylon tops now that the caps are culled - round-1 F5 item 3, unfixed. And in `low--hub-grazing` the meadow exists only in a 200 px strip on the left; the rest of the frame is a bald green plane with visible triangulation creases across it. The tier ladder is still changing the art, not the fidelity, in the vantage whose criterion is grass. **Smallest fix:** cull the cable with its caps; keep a thin grass band at low across the whole lawn rather than only near the deck.

### F13. The trunk trace is a rubber hose. Whole-image.

Still a fat glossy cyan tube at ~0.85 on 0.65 decks, wandering an organic path with square-cut ends and no contact shadow. Brief section 1 names PCB traces as the world's digital DNA: straight runs, right-angle turns, via pads. It is the one element with a genuinely different shape language from everything around it, and it is the wrong one. It does at least lead the eye up the steps in `hub-portal`, which is why this is minor rather than major.

---

## Round-1 items, checked against the image

**Visibly fixed**

- **F11 (second specular lobe).** `hub-character` now shows a broad body highlight at 0.559 *and* a tight clearcoat line peaking at **0.966** on the top edge of the head and **0.973** on the torso. Two lobes, clearly resolved.
- **F12 (hole in the face).** Now an orange side-vent tab that reads as hardware, with a counterpart visible on the far side in `hub-portal`.
- **F13 (dome olive vs gold, should be chrome).** Now a polished mirror dome in all five shots with a clean white specular. The value swing across shots (0.151 in `hub-backlit` to 0.536 in `hub-character`) is what a real mirror does, not a bug.
- **F17 (faceted low-poly hull on the core node).** Gone; the shell is smooth. Replaced by F5 above.
- **F9 (pylons outside all bands).** 0.085 to **0.158-0.296**, mostly inside midground 0.20-0.38. At squint they sit back where they should. They are still the frame's strongest contrast and still a picket fence, but the value complaint is answered.
- **F10 (photographic granite on the arch).** The arch is now a low-frequency mottle at 0.427-0.477 with no visible tiling. Note the surface-detail problem reappeared elsewhere as F3.

**Partly fixed**

- **F1 (lawn in the midground band).** 0.22-0.46 to **0.478-0.592** - a large, real gain. Still under the 0.56 floor in `hub-grazing` and `hub-backlit`. Rolled into F6.
- **F7 (paper-thin island).** Soil rim now present and the grass reaches the edge. No underside. See F11.
- **F8 (no background layer).** A backdrop arc now exists but does not read; chroma now falls with distance in `hub-grazing` (sat 0.67 near to 0.56 far) but still rises with distance in `hub-establishing` (0.53 near, 0.66 far). See F7.
- **F14 (grass with no ground contact).** The near sward now ramps from 0.516 at the tips to 0.377 at the roots. Object bases are unchanged - the pylon in `hub-backlit` still meets the lawn with no treatment at all.
- **F5 (tier ladder).** Cap-and-orb culling is now consistent; no orphan orbs anywhere. The floating cable and the bald low meadow remain, and high has *gained* a tier-only artifact (F3).

**Not fixed**

- **F2 (no rim).** Judged fresh. See F2 above.
- **F3 (nothing glows).** See F1 above.
- **F4 (flat quad on the hero).** Recoloured only. See F8 above.
- **F6 (pink cones brightest thing you can stand near).** 0.03 of movement. See F4 above.
- **F15 (white plastic clips in `hub-backlit`).** Dome specular still (255,252,241), still spilling +0.021 to +0.070 into the sky. The brief does permit specular bloom, so this only matters against the vantage's own wording - but it is the *only* thing in the game that blooms, which makes it F1's evidence.
- **F16 (trunk trace as a rubber hose).** See F13.

---

## Verdict

The single thing most holding this image back is that **the world has no shadow end.** Forty-six per cent of `hub-establishing` is sky at 0.83-0.86, the island lives in one grey mass between 0.30 and 0.80, and only 6.5% of the frame is darker than 0.30 - down from 16.6% in the baseline. Everything else on this list is downstream of it: bloom cannot read because there is nothing dark for light to sit against (F1), the rim cannot read because the shadow side of the shell is already at 0.55 and neutral (F2), the greyscale test cannot pass because three semantic classes share one value (F4, F6), the backdrop cannot read because it is 0.04 from the sky (F7), and the steps cannot read because tread and riser are 0.02 apart (F9). Round 1 correctly diagnosed a lawn that was too dark; the fix has overshot into a world with no darks at all, and the result is a competent, well-modelled, evenly lit product photograph of a diorama in which nothing is the subject.

Run the loop again, but only once more and on a narrow brief. Three changes would move most of this list: drop the sky ceiling and open the shadow end, put the hero emissives above the threshold with authored halos, and turn off grass shadow casting at high. F3 in particular should not survive another round - it is a straight regression against the baseline at the only tier anyone will see.
