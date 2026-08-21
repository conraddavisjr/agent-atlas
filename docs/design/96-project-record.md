# Project record: the numbers, the decisions, and what they cost

A durable record of the Astro-style art overhaul, kept because the interesting parts of this project are not in the diff.
Written to be quotable: every figure here was measured rather than estimated, and where a figure is uncertain it says so.

Companion documents: `00-art-bible.md` is the authority, `97-decision-shadow-end.md` is the one composition decision made in writing, `98-critique-round1/2/3.md` are the reviews, `99-handoff.md` is the resume point.

---

## 1. Scale

| | |
| --- | --- |
| Commits on `astro-overhaul` | 70 |
| Files changed against `main` | 123 |
| Lines added / removed | 54,526 / 1,469 |
| Source lines (`src` + `tools`) | 50,846 |
| Tests | 1,026 across 31 files |
| Test files | 28 in `src`, 3 in `tools` |
| Draw calls, hub at high | 335 to 127 |
| Triangles, hub at high | 4.85M |

### Agent spend

Twenty-one subagents were dispatched across the sessions that produced this branch: explorers that read the codebase, build streams that wrote it, and independent reviewers that judged the result.

| | |
| --- | --- |
| Subagents dispatched | 21 |
| Subagent tokens | **5,061,726** |
| Median agent | 248,518 |
| Largest single agent | 415,697 (the water stream) |

**What that number does and does not include.** It is the sum of the per-agent totals each subagent reported on completion. It excludes the orchestrating conversation's own tokens, which were not instrumented, so the true project total is higher. One agent reported twice with slightly different totals after a resumed run; the larger figure is used. Treat 5.06M as a floor for subagent work, not a project total.

**The shape of the spend is the point.** Nine of the twenty-one agents were explorers or reviewers that wrote no production code. Roughly a third of the token budget went to reading and judging rather than to writing, and that is where most of the findings below came from.

---

## 2. The through-line

> **This codebase's problem was never taste. It was that nothing reported when things stopped working.**

Ten silent failures were found in the code that photographs the game, and **every one produced a valid PNG of the wrong thing.** They are listed in `99-handoff.md`. The ones worth quoting:

- **The rim light was 98 degrees out in every screenshot ever taken of this game.** `cameraFrame.yaw` was never published while the camera was pinned, and the rim aims itself at that value. Two independent reviewers examined those frames and both concluded the game had no rim light. It has one; no shot had ever contained it.
- **Mouse look was being thrown away before it was read.** The look accumulator was cleared at the end of the physics step, and Rapier's stepper is subscribed *before* the camera, so most frames destroyed the input between the write and the read. Gamepad look was 100% dead. Every unit test of every function involved passed, because it is not a wrong value - it is a correct value destroyed by something scheduled in between.
- **An ear pod's lathe was wound inside out** since the day it was built: signed volume -0.006906, 210 radial normals inward, zero outward. With backface culling only the interior of the far wall was ever drawn, which is why it vanished in profile and nowhere else. It silently broke both arm rings too.
- **An ear-flap animation had never rendered a single frame**, because it rotated a solid of revolution about its own axis of revolution.
- **A splash could never have fired**, at any speed from any direction: a 0.06 m hysteresis gating a 0.05 m-deep test.
- **Progression was never pinned by a capture vantage**, so two capture sets of the same commit disagreed by more than the effect they were being compared to measure.

---

## 3. The measurement problem, and how it was solved

A critique loop built on screenshots inherits every bug in the screenshot path, and **two independent reviewers agreeing does not detect that.**

Two measurement tools were themselves found to be lying:

- **ImageMagick's `-fx` and `%[fx:mean]` are not in the eyedropper's colour convention.** They disagree by about 0.18 of luma on these frames, which is wider than a whole value band, and a threshold expression built on them reported 50% of every frame above 0.86 and looked entirely plausible.
- **`magick -colorspace Gray` linearises**, so greyscale conversions used to judge the readability test had the wrong tonality. A squint judgement made on one is a judgement about a different image.

The rig that replaced them lives in `tools/critique/` with a README of its traps. Its rule: **anything that measures the frame must be checked against `__dev.sample()` before it is believed.** The offline measurement agrees with the in-page one to four decimal places.

---

## 4. Ambient occlusion: the decision, in full

The most consequential technical decision on this branch, and the one most worth presenting, because it was decided by measurement against a strong prior.

**Ambient occlusion is off at all three quality tiers.**

### What it cost to run

Two alternating pairs, three 10-second runs per load, on a frozen camera-pinned vantage, with buffer, progression, settle and triangle count gated on every load:

| | mean fps | p95 fps |
| --- | --- | --- |
| AO off | 92.3 / 85.1 / 85.6 and 92.8 / 85.4 / 85.6 | 67.1 / 63.7 / 79.4 and 69.4 / 71.9 / 79.4 |
| AO on | 50.1 / 44.3 / 43.9 and 48.9 / 43.7 / 43.8 | 23.9 / 23.6 / 41.5 and 23.9 / 23.6 / 42.6 |

**Median ratios 1.93 and 1.95 on mean, 2.81 and 3.01 on p95.** The arms do not overlap anywhere: the slowest AO-off run is 85.1 and the fastest AO-on run is 50.1.

Never quote an absolute frame rate from this machine. One configuration read 65.5 mean fps in one session and 21 to 36 twenty minutes later with nothing changed. Only the ratio is evidence.

### What it bought

| `hub-establishing`, high | AO on | AO off | worth |
| --- | --- | --- | --- |
| mean | 0.6473 | 0.6627 | -0.0154 |
| below 0.10 | 0.00% | 0.00% | **nothing** |
| below 0.20 | 1.60% | 1.44% | 0.16 points |
| below 0.30 | 5.53% | 4.92% | 0.61 points |
| 0.38-0.56 | 21.76% | 15.83% | 5.9 points |

The pass was retained on the argument that it was one of the few remaining sources of dark in a frame that had almost none. Measured, it was worth **0.16 percentage points** of the share below 0.20 and **nothing at all below 0.10** in any of the six vantages, against a round whose entire subject was the 0.06 to 0.18 band.

Its floor is arithmetic. `mix(scene, color * scene, 1 - ao)` with `color` at `#8fa4cc` puts a fully occluded pixel at 37% of its own value, so on a 0.65 deck it reaches 0.47 and stops. It can make a smudge in the 0.4s; it has no access to 0.10.

The fourth row is a **gain**, not a cost: the pass was holding the lawn 0.046 below where it belonged, which is 5.9 points of the frame stuck in the gap between bands.

### Two things the removal revealed

- **It was not failing at object bases for the reason everyone assumed.** A pylon is a capsule translated so the bottom of its lower hemisphere sits exactly on a flat lawn - a sphere tangent to a plane, 4 mm of gap at 5 cm out. It is the contact shape that produces the least occlusion of any, and **no occlusion pass and no shadow map would ever have drawn a contact there.** That was a geometry defect wearing a lighting defect's clothes.
- **Where it genuinely earned its cost** was flat-on-flat stone: totem plinths, deck pucks, portal jambs, fillets of 0.05 to 0.12, where visibility approaches 0.5 and it laid down a real 0.28 m band. That loss is real and was replaced by authored contact rather than waved away.

`?gfx=ao` turns it back on, so the comparison stays reproducible without a rebuild.

---

## 5. Lighting: what was found

### The rig was axial, and no intensity could fix it

At two of the six vantages **every analytic light sits within 3.4 degrees of the camera axis**, and the bounce fill is aimed at the camera azimuth so it is on-axis at *every* vantage by construction. A light on the camera axis lights both visible faces of a box equally and contributes zero face-to-face contrast at any intensity. The fix is an azimuth, not a number.

### Intensity is not delivered radiance

Ranked delivered irradiance onto a shadowed deck: key softbox card 31.5%, hemisphere 29.7%, rim 15.3%, background card 6.5%, cool wrap 4.8%, strip 4.5%, rim card 3.7%, sky fill 2.1%, bounce fill 2.0%, negative fill 0.0%. **The two fills a brief ranked first are ninth and tenth, worth 4.0% together.** On the hero's shadow side the same two are worth 30.4%. The two acceptance surfaces share no dominant term, which is why two rounds of reviewers disagreed.

### The hero's grey shadow side was one constant in a material

`shell()` carries `emissive: '#ffb489'` at intensity 0.08 - a fixed warm term on every pixel regardless of lighting, 23.5% of the shadow side, in a hue nearly opposite the rig's. Zeroing it and changing nothing else takes the shadow side from 0.583 at saturation 0.053 to 0.498 at 0.267: **a fivefold chroma change from one constant.** It gets worse as fill comes down, because a fixed term is a larger share of a smaller total.

### `scene.environmentIntensity` silently kills every per-material `envMapIntensity`

three sets the scene value for any Standard or Physical material whose `envMap` is null, and nothing here sets a per-material `envMap`. Shell 1.15, grass blades 0.6, island skirt 0.4 - **none of them do anything.** You cannot dim the environment on the hero without dimming the grass.

### Baked lighting: the mechanism does not exist

The ask was daylight shadows baked into the texture. Neither slot in three can do it:

- **`lightMap` is additive irradiance.** There is no texel value that removes light.
- **`aoMap` multiplies indirect diffuse only.** It never touches the four directional lights, so a baked sun shadow there darkens the ambient inside the shadow and leaves the key at full strength.
- And the sun is already baked every frame by the shadow map, so baking it again multiplies two shadows at two resolutions with two edge positions.

What shipped is a real offline **sky occlusion** bake: 204 charts over 1071 m², 2048² at 44 texels/m, 2.27 cm per texel, 622 KB committed, 463 s at 128 rays, bound at `aoMap` on `uv1`, with a layout hash checked in DEV so a stale bake is a loud error rather than misplaced shadows. A useful consequence of baking only the sky: the integral has no sun direction in it, so it cannot disagree with the rig.

The UV channel folklore was wrong and is now cited from source: **the attribute is `uv1` and `texture.channel = 1` selects it. `uv2` is the third set.** A missing `uv1` does not error - WebGL supplies a zero attribute and every fragment reads texel (0,0), which is a uniform multiply.

---

## 6. The value-band system, and the rule that had to change

The art bible's acceptance test outranks all others: *desaturate a frame to greyscale and you must still instantly read where you can stand.* Three bands with real gaps: gameplay 0.56-0.74, midground 0.20-0.38, background 0.76-0.86.

**Three rounds failed that test for three different reasons.**

1. Round 1: the lawn was in the wrong band. Correct.
2. Round 2: the world had no shadow end. Correct.
3. Round 3 added the darks and moved the lawn's mean to 0.561 - technically inside its band - and the test still failed.

The third diagnosis is the one that stuck: **the lawn is not a value, it is a distribution.** Its 5th to 95th percentile spans **0.363 to 0.731**, so one surface reads simultaneously as walkable stone, as the gap that must be empty, and as the cliff you cannot climb. Ten per cent of the frame was grass sitting inside the forbidden gap.

Every acceptance row written about the lawn for three rounds asked for a "clean patch" to land inside the band. **A clean patch is the wrong statistic** for a surface made of two hundred thousand blades whose own root-to-tip ramp is wider than the band it must occupy. The mean was never the thing.

So the rule gained a second half (bible section 8.1/8.2):

> Band membership is judged on a surface's mean **and its spread**. A surface belongs to a band when its p5 to p95 range fits inside that band.
>
> And therefore: a surface may carry albedo pattern of any kind, provided the pattern's own p5 to p95 stays inside its band.

That second clause unlocked the texture work. The first version of the rule had been read as "keep every surface at one value" and enforced in code: `decalTextures.ts` recorded that marks were *"cut as relief rather than printed as albedo... instead of relying on a value difference that band discipline is separately trying to remove."*

---

## 7. Why the platforms looked blank: three wrong answers, then the right one

A good worked example of measurement beating reasoning.

1. **"Nobody added texture."** Wrong. The maps were built, tested, box-projected with world-scale UVs, and wired - and switched off behind a gate reading *"zero everywhere until `surfaceTexture.ts` exists"*. That module had shipped two rounds earlier under a different name. The condition was satisfied by a file nobody renamed.
2. **"So switch it on."** Did that. **It changed nothing**: deck spread 0.0387 to 0.039, high-frequency detail 1.37 to 1.36, crops indistinguishable.
3. **"Relief is invisible under an overhead key."** True, and insufficient. Perturbing a normal that already points at the light barely changes `N.L` - but that alone does not explain a null result this total.
4. **The actual reason is scale.** At the game's framing **one screen pixel is 26 mm of deck**, so the 2.5 mm groove the spec calls for is **a tenth of a pixel** - erased by the mip chain whether printed or cut, at any contrast. And a 1024 map over the island's 40 m span has 39 mm texels, so the texture was the limit rather than the display.

The fix was to make the mark wider: seams 2.5 mm to 20 mm, panel map to 2048. Measured after: **lit deck p5-p95 from 0.0003 to 0.0373**, mean 0.6869 to 0.6298, off the ceiling it had been resting against.

The same error one level down: the Core struts are 20 px wide on screen at 21.6 mm per pixel, so `trim`'s 2.5 mm groove was **0.12 px** and its fasteners 0.56 px. Widened to 70 mm, high-frequency detail on a strut goes **1.12 to 12.29**.

Section 7.7 of the materials spec was amended from "one mark per face" to "one mark per panel", because one mark on a 113 m² face is not restraint - it is the zero-detail finding restated as a rule. And a mark below the pixel is not restraint either; it is absence.

---

## 8. Where arithmetic beat taste

Four cases where a proposed change was refused with numbers rather than opinion.

**A broad metallic surface cannot hold a value band.** Metal has no diffuse term, so Schlick takes a kerb from 0.20 at normal incidence to 0.68 at grazing - a spread near 0.5 in a band 0.18 wide. `chrome()` having zero call sites after two rounds was a consequence, not an oversight.

**But a metallic *cylinder* can**, and the reason is curvature rather than size. On a cylinder, screen-x is uniform in `sin φ` while `(1-cos φ)^5` stays flat past 60°, so the whole Fresnel rise crushes into the outer tenth of the width: spread **1.621** against 6.297 for the same cylinder diffuse. The original "metal cannot hold a band" note was computed on a flat kerb and **inverts on a cylinder**.

**And it still failed in the frame**, which is the more useful half of the story. Bound to the hub's pylons and struts, the spread narrowed exactly as predicted and **the level collapsed**: a pylon went from a mean near 0.33 to 0.0959. A metal's value is entirely what it reflects, and these members face this rig's dark side - a negative fill at `#0b0f1a` and a background at `#243a52`. Eight pylons at 0.09 sit in the band the shadow-end decision forbids repeated verticals from entering, and the frame's share below 0.20 more than doubled. Reverted. The stream that computed it had named the one term it could not compute and said to check a frame.

**Transmission on the crystal shards was priced and refused.** three's `renderTransmissionPass` re-renders the background *plus every opaque object* at full resolution with forced 4x MSAA and a mip chain, every frame, over a 1.43M-triangle grass field - for sub-pixel refraction on shards 4.5 cm wide. The shards' problem turned out to be value and chroma, not material: `(255,163,227)` at luma 0.7338 with red clipped became `(89,123,83)` at 0.4437 with nothing clipped.

**A carved water channel would never be entered.** A 0.35 m capsule must travel 0.18 m inside a rim before touching bottom, so a 0.22 m groove is bridged and walked over. The channels are a brim-full inlay carrying the inset read by value and meniscus; only the pool is a real recess, because the step-down forces it - a collider cannot follow a value trick.

---

## 9. The composition decision

Rounds 1 and 2 deadlocked: one had the near-black pylons lifted because they carried the frame's highest contrast, the other found that removing them left the world with no shadow end. **Both reviewers were right about the same six per cent of the frame.**

It resolved by changing the question. Not *how many* dark pixels, but **where they are**:

| share of the sub-0.20 pixels | |
| --- | --- |
| top third of frame | 4.4% |
| middle third | 50.2% |
| bottom third | 45.4% |
| left third | 15.9% |
| centre third | 19.0% |
| **right third** | **65.1%** |

Rendered as a mask, that 1.59% was: the shaded sides of the right-hand pylons, the catenary arcs, a few navy kerb faces. **The darks in this world were in the shape of a cage.** They should be in the shape of a floor.

The decision, in `97-decision-shadow-end.md`: the darkest thing is the ground seen from underneath. A fourth band, anchor 0.06-0.18, with a closed membership and a prohibition on any repeated vertical entering it.

**Two rows of its own acceptance table were later withdrawn as unreachable**, and the lesson generalises: they asked a feature whose area is fixed by geometry - the island's visible underside is 1.16% of the frame and appears in one of six vantages - to carry 8 to 14% of it. **A frame-share target for a fixed-area feature is a wish, not a criterion.** State acceptance as profiles and locations instead.

---

## 10. How the work was organised

Independent reviewers who built none of the work, then parallel build streams on disjoint file sets with `palette.ts` frozen and owned by the integrator, then a serial integration pass because balancing systems against each other is taste and taste needs one pair of eyes.

**The single highest-value instruction was to brief each stream to falsify its brief rather than execute it.** Every stream on this project overturned something it was told, and several of the findings in this document exist only because of it - the capsule tangency, the scale-not-channel diagnosis, the impossible lightmap mechanism, the inside-out lathe, the axial rig.

The mechanism that works: name the diagnosis, give the numbers behind it, then say explicitly which claim in it is a reconstruction rather than a measurement. A stream told where its brief is weakest audits that part. A stream told only what to build, builds it.

Two operational rules learned the hard way:

- **Do not let build streams measure the frame.** Four agents measuring four page loads produce four incomparable numbers.
- **Do not infer that a stream has finished from a quiet tree and a green suite.** That inference once shipped two pieces of invisible geometry whose fixes were sitting uncommitted in the stream's working files.
