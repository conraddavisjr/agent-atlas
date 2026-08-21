# The ASTRO design system

`00-art-bible.md` outranks this file.
Where this file and a numbered spec disagree, the bible decides; where this file and a numbered spec agree, the spec is the implementation and this is the reason.

This is not a sixth spec.
The five numbered specs each describe one subsystem of *this* game.
This describes the **design language** the game is imitating, factored into five axes a build agent can implement against: materials, colour, animation, the rig, the model.
It exists because the specs were written one subsystem at a time and each one arrived at its own local answer, and because two surface classes are being built right now - a highly reflective steel and a matte moulded brick - that no existing document specifies.

**Labels, kept from `00-references.md` and meant literally.**

- **[DOC]** documented in a talk, interview, dev-blog or vendor reference, with a source.
- **[OBS]** inferred from footage, frame analysis, or standard practice. A hypothesis.
- **[REC]** an engineering recommendation with a concrete number, computed here.
- **[CALC]** arithmetic done in this file, reproducible from the numbers given.
- **[VERIFIED]** read out of the installed source tree at the version named.

There are still no published Sony numbers for roughness, bloom thresholds, light ratios or hex values.
Every number below that looks like a material parameter is [REC] or [CALC] unless it carries a source.
Sources fetched for this document are listed in section 7, along with what a fresh search found **not** to exist.

---

## The one sentence that orders everything below

**[DOC]** Nicolas Doucet, Studio Director, Team ASOBI, to CGMagazine in July 2024:

> "We don't necessarily consider our game the most beautiful, but we strive for a different kind of beauty - simple elegance.
> In a platform game, it's essential to clearly see where you're supposed to go. You need to plan your path and identify surfaces you can jump on.
> **Contrast is our top priority, followed by adding bevels and a bit of detail.** If there's too much detail, the game becomes noisy, and players can't easily discern where to go."

That is the art pipeline stated as an ordered list by the person who runs it, and it is the most implementable thing anyone at Team ASOBI has said in public.

1. **Value contrast**, first and above everything. Section 2.
2. **Bevels**, second, because a bevel is what turns contrast into form. Section 5.2.
3. **A bit of detail**, third and sparingly. Sections 1.5 and 5.3.

Read against this project's history the ordering is uncomfortable, because three critique rounds have been spent on item 1 and the two open threads right now - a mirror and a brick - are both item 3.
That is not an argument against building them. It is the reason both sections below are so insistent that they be measured against the value bands before they are judged on their looks.

**[DOC] And the same person on where over-detailing comes from**, in the same interview:

> "We went through a phase where the game looked too messy because, naturally, given more power, developers add more elements. About a year ago, we started cleaning it up to find that simple elegance again."

**[DOC] One caution from the art director, which this whole document has to be read against.**
Sebastian Brueckner, Art Director, to the Japanese PlayStation Blog: the look of the character design is not a logical design; there is a design that *feels* fun, and that way of thinking is what is valued.
He is explicitly disclaiming a rule-driven system.
Every rule in this file is a **reconstruction** built to be checkable, not a rule Team ASOBI holds.
Where a rule here produces something that looks wrong, the rule is wrong.

---

## 0. Where the existing documents are wrong or under-specified

Stated first because six of the sections below only make sense once these are settled.

**0.1 The bevel and mark floors in `02-materials.md` section 6.1 were computed at the wrong camera, and the error is the "tenth of a pixel" defect.**

That section derives its 8 mm and 15 mm floors from "one pixel subtends 7.1 mm at 8 m" at FOV 55, then says the floors could come down by a third if the FOV narrows and to not act on it until the camera changes.
The camera did change, and it changed in the opposite direction from the one the note anticipated.
`00-art-bible.md` section 3 takes the FOV to 40 **and the camera distance from 7.5 m to 10.7 m**, because holding the character the same size in frame requires `D tan(fov/2)` to be constant.
So the narrower FOV buys finer angular resolution and the longer lens spends most of it again.

**[CALC]** At 1080 px of vertical buffer, `px_per_radian = 1080 / fov_radians`.

| FOV | px/rad | 1 px at 3 m | at 10.7 m | at 20 m | at 60 m |
| --- | --- | --- | --- | --- | --- |
| 55 (old) | 1125 | 2.67 mm | 9.51 mm | 17.8 mm | 53.3 mm |
| 40 (shipping) | 1547 | 1.94 mm | 6.92 mm | 12.9 mm | 38.8 mm |

**Two caveats that must travel with every number derived from this table.**

**The buffer height is a variable, not 1080.** The critique harness pins a drawing buffer, and it has run at 934 and at 1634 rows. Every millimetre figure below scales by `1080 / H`, so at 934 rows the character's mark floor is 16 mm rather than 14. Use 1080 as the authoring reference and re-check against the pinned buffer before calling a mark too small.

**These are FRONTAL figures. A horizontal surface is foreshortened and needs bigger marks.** See 5.3.

**The character is never at 3 m.** The follow camera sits at 10.7 m back and 4.3 m up, so the shortest read distance in normal play is roughly 10.7 m and the "arm's length" case the 8 mm floor was written for does not occur in this game.
Everything on the character is read at 6.92 mm per pixel.

That single row invalidates the whole surface-detail vocabulary as written.
Section 7.1 specifies a panel line 2.5 mm wide, which is 0.36 px.
Section 7.2 specifies a parting line 1.0 mm wide, which is 0.14 px.
Section 7.3 specifies ejector circles of 4 to 9 mm, which are 0.6 to 1.3 px.
`decalTextures.ts` already found this from the other end for the deck and recorded it - one screen pixel is about 26 mm of deck at the establishing framing - and amended the restraint rule, but only for decks.
**The character's marks were never re-derived and they are all below one pixel.**

The rule that replaces all of the per-mark numbers is in section 5.4.

**0.2 `02-materials.md`'s two-lobe law has no clause for a surface with one lobe, and that is exactly the surface being built.**

The law is `clearcoatRoughness <= baseRoughness - 0.20` with a width ratio of at least 8, and it is correct for every dielectric in the file.
A mirror has no body lobe at all: a metal has no diffuse term, so there is nothing for a second lobe to sit on top of, and `chrome()` correctly sets `clearcoat: 0`.
What the law does not say is what governs a **single** lobe, and the answer is not roughness-versus-roughness, it is **roughness versus screen-space curvature**.
Section 1.4 derives it.

**0.3 `chrome()` at `roughness: 0.06` is a hair above three's own floor and is not the material anyone thinks it is.**

**[VERIFIED, three 0.185.1]** `lights_physical_fragment.glsl.js:10` reads

```glsl
material.roughness = max( roughnessFactor, 0.0525 ); // 0.0525 corresponds to the base mip of a 256 cubemap.
material.roughness += geometryRoughness;
```

So 0.06 is 14% above a hard clamp three applies for its own filtering reasons, and normal-derived `geometryRoughness` is then added on top, which means the material's effective roughness varies with how curved the mesh is *at that pixel*.
Anything authored below 0.0525 is a silent no-op.
The comment naming a 256 cubemap is the tell: the clamp exists because the base mip of the prefiltered environment cannot represent a sharper reflection than that, and this project ships `envResolution` of **128** at the low tier, where the clamp is a full stop too coarse.

**0.4 `envMapIntensity` is dead code, and that is not only a lighting problem - it is what makes a matte material impossible.**

The handoff records the mechanism: `scene.environmentIntensity` overwrites `material.envMapIntensity` for any Standard or Physical material whose own `envMap` is null, and nothing in this project sets a per-material `envMap`.
`02-materials.md`'s preset table specifies eleven distinct `envMapIntensity` values from 0.30 to 1.30 and **not one of them runs**.
Every surface in the hub sees the environment at exactly 0.70.

The lighting consequence has been written up. The **material** consequence has not: `envMapIntensity` is the only lever either document offers for "this surface should barely reflect", so as written there is no way to author a non-reflective surface at all.
Section 1.5 gives the lever that does work, and section 1.4 gives the fix that revives the dead one for the two surfaces that need it.

**0.5 `palette.ts` put the world's warmth in the albedo, and the diagnosis was right while the lever was wrong.**

The reasoning recorded on `rock` is sound as far as it goes: measured on a lit deck, red was the lowest channel on every lit surface in every vantage, so the reference's split-tone was half built, and `#b6bcc7` leans 17 points blue so no rig could have fixed it.
The fix taken was to warm the **albedo** to `#bfbbb4`, R-B of +11, which moved the rendered deck from R-B -22 to -2.

**[CALC] That measurement pair is the most useful number in the file, and read as two points on a line it says the lever is somewhere else.**
The albedo's R-B went from -17 to +11, a swing of 28, and the frame's went from -22 to -2, a swing of 20.
Fit the line: `rendered = 0.714 x albedo - 9.9`.
The slope is below 1 because a lit deck is dimmer than its own swatch, so channel differences compress.
The **intercept is the finding**: at a perfectly neutral albedo this rig renders a lit deck at R-B **-9.9**.
The temperature axis is a lighting deficit of a known size and it was paid for out of the palette.
Getting a lit deck to a clearly warm R-B of +8 off a neutral silver needs about **18 points of R-B moved into the rig**, and section 2.6 says where from.

What that costs is the whole of section 2's direction.
A world of warm-grey decks, amber accents and brown soil is a warm world with cool shadows.
A world of neutral-silver decks under a warm key is a *cool* world with a warm light in it, which is what the reference actually is, and it is the only version that survives the palette direction in section 2.1.
The albedo change is reverted in section 2 and the 13 points are recovered in the rig instead.

**0.6 `05-character-vfx.md` specifies a rig without ever stating a rig *rule*.**

It gives an excellent joint hierarchy, a part table and a spring table for one character.
It never says which joints are visible hardware and which are hidden, what makes a part read as detachable, or how any of it generalises to the second character.
Section 4 states those as rules with numbers.

**0.7 Nothing anywhere states the scale of surface detail relative to the character.**

Marks are specified in millimetres, tiles in metres, and the character in metres, and the three were never related.
Section 5.4 relates them in head-widths, which is the unit the reference art is actually authored in.

---

## 1. Materials

### 1.1 The world rule, restated as a taxonomy

**[DOC] The rule has a primary source and it is stronger than the paraphrase this project has been using.**
Nicolas Doucet, on Astro's Playroom:

> "Inside the console, there should be **no organic materials**. We should not find wood, things like stone; however, you can find a carbon fibre. You can find crystals."

And on why the material list is short and fixed:

> "The materials are very important in this game because they **define haptic feedback**. So you know when you are running on plastic, on metal or ice."

**[DOC]** Sebastian Brueckner, Art Director, on Rescue Mission: "We injected each object with a **digital DNA**, such as printed circuits board patterns and LED faceplates", giving a "playful, digital identity", applied to "characters, enemies, vegetation (right down to the rocks)" to produce "a super-tangible feeling".
**[DOC]** Doucet again, on the cameo bots: characters needing "fabrics or furry boots" felt like going against the original intent, "so we substituted more organic materials, like hair, with materials such as **vinyl**".

**[REC] The second Doucet quote is the one to build on and no document here has used it.**
A material in that world is a **semantic class before it is a look**: it is authored once and it drives shading *and* haptics, which means the class list must be short, closed, and mutually exclusive.
This project has no haptics, so the same discipline has to be enforced by the class list itself.

**A note on the phrasing.** "Everything is a manufactured object" and "injection-moulded plastic" are this project's shorthand, not Team ASOBI's language. A fresh search for either phrase against Team ASOBI returns nothing. The *concept* is well documented by the three quotes above; the words are ours, and the doc labels should say so.

That rule is usually read as a ban - no photographic granite, no cloth sim - and the ban half has been enforced.
The **positive** half has not, and it is the more useful half:

> Every surface in this world is the output of a **process**, and the process is legible on it.
> A surface without a visible process is not stylised, it is unfinished.

There are exactly **five processes** in this language, and every material class is one of them.
This is the taxonomy the preset table should be organised by, rather than by what the material is impersonating.

| Process | What it produces | How detail is authored | Presets |
| --- | --- | --- | --- |
| **Moulded** | A part released from a two-part tool | Parting line, draft, ejector marks, fillets everywhere, panel seams | `shell` `plastic` `mattePlastic` `rubber` `vinyl` |
| **Cast and finished** | A part poured, then machined or polished | Facet joins on 30-degree headings, chips, polished pits, no parting line on the finished face | `stone` `brick` `crystal` |
| **Machined and plated** | Metal cut, then coated | Turned rings, chamfers with a visible cut edge, fasteners, no fillets under 2 mm | `steelMirror` `anodised` |
| **Printed** | Ink or a mask laid onto a finished surface | Panel tones, perforation grids, hazard fills, chip trace, part codes. Value only, no relief | `decalTextures.ts` |
| **Flocked or coated** | A fibre or powder applied to a moulded core | No skin at all, retro-reflective sheen, zero clearcoat | `flock` |

**The rule this taxonomy exists to enforce.**

> A surface carries the marks of **one** process, plus **printing**.
> Printing is the only process that may be layered onto another.

That is why the deck works: it is a cast substrate with print on it.
It is also why a photographic rock fails - a photograph carries no process at all, only weather - and why `mattePlastic` with a stone normal map would fail, because it would carry two.

**[DOC] The allowed exceptions are named and there are exactly two: carbon fibre and crystals.** Both are manufactured, both are surfaces with internal structure, and both are what that world uses where a realistic material would otherwise be reached for. `crystal()` already exists here and is correct. Carbon fibre does not and is the cheapest legitimate way to add a second surface reading to hardware without adding a process.

**[REC] Water is the one exception this project adds, and it stays one.** `00-references.md` records that Team ASOBI simulate rather than stylise it, and `waterMaterial.ts` follows.
Do not extend the exception. The moment a second surface is allowed to be a natural phenomenon the world rule stops being a rule.

### 1.2 The lobe law, completed

`02-materials.md` section 1.1 states two-thirds of the law.
Written out in full there are three cases and the existing text covers only the first.

**[DOC] A documented negative first, because it changes the confidence of everything in this subsection.**
A fresh search across first-party talks, blog posts, interviews and third-party analysis returns **no source of any kind stating that Astro Bot uses a clear coat**, or subsurface scattering, or anisotropy, or any roughness, specular, metallic or IOR value.
The two-lobe model is a good reconstruction of what the surfaces look like and it is what makes moulded plastic read in a PBR renderer, but it is **[REC]** and **[OBS]**, not **[DOC]**, and `00-references.md` section 3(a) reads more confidently than the evidence supports.
The documented mechanism for the plastic-toy read is Doucet's ordering - contrast, then **bevels**, then a little detail - which points at tight bevel highlights and printed detail rather than at a layered shader.

Keep the two-lobe law: it is measurably better than one lobe here and the critique loop has confirmed that on the frame.
Do not describe it as what Team ASOBI does.

**Case A - a coated dielectric. Two lobes.**
`clearcoatRoughness <= baseRoughness - 0.20` and `baseRoughness^2 / clearcoatRoughness^2 >= 8`.
Unchanged. `TWO_LOBE_MIN_RATIO` in `materials.ts` already enforces it.

**Case B - an uncoated dielectric. One lobe, and it must be wide.**
`rubber` `flock` `ground` `brick`.
There is no coat, so the base lobe is the only specular, and the failure mode is the opposite of case A: a single narrow lobe on a matte surface reads as *wet*.
**[REC]** Floor of `roughness >= 0.85` on anything claiming to be uncoated and matte, and see 1.5 for the F0 lever that matters more.

**Case C - a metal. One lobe, and its width is set by the geometry, not by taste.**
`steelMirror` `anodised` `chrome`.
This is the case no document covers.

A metal has no diffuse term, so its entire read is `F(theta) x prefiltered_environment` plus the analytic lights' GGX.
Both halves are governed by how many **pixels** the specular lobe covers, and on a curved part that is a function of the part's radius, not of the roughness alone.

**[CALC] The highlight's screen width on a convex part.**
The half-vector moves at half the rate of the surface normal, so a lobe of angular half-width `alpha = roughness^2` maps to a patch of surface subtending `2 alpha`, and at distance `d` on a part of radius `r` that patch subtends `2 alpha r / d` at the camera.

```
highlight_px  =  2 * roughness^2 * (r / d) * px_per_radian
```

At FOV 40 and 1080 px, `px_per_radian = 1547`:

| Part | r / d | roughness 0.06 | 0.12 | 0.20 | 0.32 |
| --- | --- | --- | --- | --- | --- |
| Collar ring, r 0.05 at 10.7 m | 0.0047 | 0.05 px | 0.21 px | 0.58 px | 1.48 px |
| Hand mitten, r 0.14 at 10.7 m | 0.013 | 0.15 px | 0.58 px | 1.62 px | 4.14 px |
| Head shell, r 0.27 at 10.7 m | 0.025 | 0.28 px | 1.12 px | 3.12 px | 8.00 px |
| Deck inlay panel, r 1.0 at 12 m | 0.083 | 0.93 px | 3.71 px | 10.3 px | 26.4 px |
| A flat plate | - | full lobe | full lobe | full lobe | full lobe |

Invert it for the rule.

> **[REC] The curvature roughness floor.**
> `roughness_min = sqrt( w_px * fov_rad * d / (2 * r * H_px) )`, with `w_px = 2`.
> A mirror is a material for **large or flat** surfaces. On small curved hardware it is not a mirror, it is a sparkle.

| Part | roughness for a 2 px highlight |
| --- | --- |
| Collar ring, r 0.05 at 10.7 m | **0.37** |
| Hand mitten, r 0.14 at 10.7 m | **0.22** |
| Head shell, r 0.27 at 10.7 m | **0.16** |
| Deck inlay, r 1.0 at 12 m | **0.088** |
| Wall plate, r 4 at 12 m | **0.044** |

**This overturns `02-materials.md` section 2's recommendation and `materials.ts`'s own note.** Both propose the first chrome call site as "one small chrome element on the robot, a collar ring at the neck or a bezel around the visor", on the argument that it is the cheapest demonstration that the environment map exists.
At `roughness 0.06` on a 0.05 m ring that highlight is **one twentieth of a pixel**, carrying a GGX peak of `1/(pi * 0.06^4) = 24,561`, which is **39 times** the peak of 629 that `Lighting.tsx` computed its own headroom against.
A sub-pixel sample at forty times the tolerated peak is not a reflection. It is a firefly, and it is the exact defect that produced the clipped, spilling dome in `hub-backlit`.

**The correct first chrome call site is the largest and flattest surface available, not the smallest.**

### 1.3 The class table

Superseding `02-materials.md` section 1.2 in four rows and adding two.
`metalness` is 0 except where stated. `envMapIntensity` is listed for completeness and **does not run** unless the material also carries its own `envMap` - see 0.4.

| Class | rough | metal | cc | ccRough | specIntensity | sheen | Process | Band it may claim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shell()` hero | 0.32 | 0 | 0.80 | 0.10 | 1.0 | 0.30 | moulded | none, it is the anomaly |
| `plastic()` | 0.45 | 0 | 0.85 | 0.15 | 1.0 | 0 | moulded | any, on a curved part |
| `mattePlastic()` | 0.75 | 0 | 0.40 | 0.26 | 0.7 | 0 | moulded | any |
| `rubber()` | 0.95 | 0 | 0 | - | 0.5 | 0.25 | moulded | midground, anchor |
| `vinyl()` | 0.50 | 0 | 0.55 | 0.16 | 1.0 | 0.25 | moulded | any |
| `flock()` | 0.90 | 0 | 0 | - | 0.6 | 1.00 | flocked | gameplay, midground |
| `stone()` | map | 0 | 0.15 | 0.80 | 0.55 | 0 | cast | gameplay |
| **`brick()` new** | **map, 0.92 mid** | 0 | **0** | - | **0.28** | 0 | cast | **midground only** |
| `crystal()` | 0.14 | 0 | 0.85 | 0.06 | 1.0 | 0 | cast | none |
| `anodised()` | 0.30 | 0.95 | 0.15 | 0.10 | 1.0 | 0 | plated | midground, on cylinders only |
| **`steelMirror()` new** | **see 1.4** | **1.0** | **0** | - | 1.0 | 0 | plated | **none** |
| `chrome()` | 0.06 | 1.0 | 0 | - | 1.0 | 0 | plated | none. **Deprecate, see 1.4** |
| `visorPlate()` | 0.28 | 0 | 0.85 | 0.05 | 1.0 | 0 | moulded | anchor |

Three changes to existing rows, each with its reason.

**Five presets gain a `specularIntensity` below 1: `mattePlastic` 0.7, `rubber` 0.5, `flock` 0.6, `stone` 0.55, `brick` 0.28.**
This is the lever section 0.4 says is missing, it is a uniform rather than a define, and it is free. The mechanism is verified in 1.5.
Four of them already carry an `envMapIntensity` below 1 in `02-materials.md`'s table for exactly this purpose - `mattePlastic` 0.70, `rubber` 0.45, `flock` 0.30, `stone` 0.85 - and **none of those values has ever executed**.
`rubber()` at `envMapIntensity: 0.45` was meant to be "the darkest, deadest thing on the robot"; `specularIntensity: 0.5` is the instruction that actually runs.
The mapping is roughly `specularIntensity ~ envMapIntensity`, which is not physically the same thing - one scales the reflection's brightness and the other scales its Fresnel weight - but it is the same intent and it is the one that reaches the GPU.

**`stone()`'s `clearcoat` stays at 0.15 and does not go to `02-materials.md`'s proposed 0.20 / ccRough 0.45.**
A cast surface's process is chips and facet joins, not a skin. Giving it a real second lobe moves it from "cast" to "moulded" and puts two processes on one surface, which 1.1 forbids.
The trace of coat it already carries is enough to stop it going conspicuously dead.

**`chrome()` is deprecated in favour of `steelMirror()`,** which takes the part's radius and distance rather than a fixed roughness. See 1.4.

### 1.4 (a) The highly reflective steel

**What a mirror looks like in this language.**

**[DOC] The mirror is documented, it is the single most-discussed surface in the game, and it is a large gently curved plate on the back of the head.**
Doucet, on the PlayStation Blog:

> "From jungles to oceans, all the game's environments are now fully reflected on the back of Astro's **silver head plating** during his travels."
> "It's things like Astro's **reflective head plate** that symbolizes his growth over the years, now unlocked for PS5."

Two things fall out of that and both are numbers this document needs.
It is **silver**, not chrome-white, which is the F0 argument below arriving from the other direction.
And it is the **back** of a head plate - the largest and flattest metal surface on the character, roughly `r = 0.27` here - which is exactly the curvature class the rule below says a mirror belongs to, and the opposite of the collar ring this project's own documents propose.

**[DOC] And it is a screen-space reflection, not a ray-traced one.**
Digital Foundry's coverage of the PS5 Pro patch (1.012, February 2025) reports the Pro build swapping TAA for PSSR and notes that PSSR makes **screen-space reflections** slightly worse through its noise reduction.
That disclosure is doubly useful: it names the reflection technique, and it confirms the base game's anti-aliasing is **TAA**.
There is no documented ray tracing in either game, and a widely repeated claim that Astro's Playroom has "rudimentary raytracing" on the helmet could not be corroborated and sits badly against the SSR finding.

**[OBS] Which means the reference's mirror is a composite, and ours cannot be.** Screen-space reflection alone cannot show a jungle that is behind the camera, so the head plate is almost certainly SSR composited over a cubemap or a local probe.
This project has no SSR and should not add one.
**[REC] Our whole mirror is the probe half, which raises rather than lowers the importance of the environment map's resolution** - it is not a fallback here, it is the entire effect.

**[OBS]** In the reference the mirror surface is never doing the job of "looking like metal".
It is doing one of two jobs, and which one decides everything about how it is authored.

1. **A showpiece that proves the environment exists.** A chrome dome, a polished floor inlay, a curved bumper. Large, gently curved, placed where the camera orbits past it so the highlight *travels*. This is the one worth building.
2. **Hardware that reads as machined.** Fasteners, collar rings, rails, hinge pins. Small. These are **not** mirrors in the reference - they are satin, and they read as metal through their *shape* (turned rings, chamfered cut edges, visible fastener heads), not through their reflectivity.

Conflating the two is what produces a toy studded with fireflies.
Job 2 is `anodised()` and it is already specified. What follows is job 1.

**The spec.**

```ts
/**
 * A mirror, sized to the geometry it is on.
 *
 * `radius` is the part's local radius of curvature in metres, `Infinity` for a
 * flat plate. `distance` is the read distance in metres, which in this game is
 * never below 10.7.
 */
export function steelMirror(
  radius: number,
  distance = 10.7,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps
```

| Field | Value | Why |
| --- | --- | --- |
| `color` | **`#D3D8DA`** chromium, or **`#D6D1CB`** stainless. See 1.6 - the charts disagree by 20%. | **[DOC]** A metal's base colour IS its F0. Filament: a metal's base colour belongs in **[170..255] sRGB**. Never white. |
| `metalness` | **1.0** | **[DOC]** Filament: "This property should be used as a **binary value**, set to either 0 or 1." |
| `roughness` | **`max(pmremFloor(envResolution), curvatureFloor(radius, distance))`** | Two floors, from two unrelated causes. See 1.2 and 1.6. Never the fixed 0.06. |
| `clearcoat` | **0** | A coat over a mirror is a second Fresnel over a surface that is already entirely Fresnel. `materials.ts` has this right. |
| `envMap` | **its own PMREM** | See below. This is the change that matters most. |
| `envMapIntensity` | **1.0** | Only becomes live once `envMap` is set. |
| `dithering` | **true** | A mirror is the surface most likely to band a smooth environment gradient into steps. |

**[REC] Build it on `MeshStandardMaterial`, not `MeshPhysicalMaterial`.**
A metal needs no clearcoat, no sheen, no IOR and no specular tint - `specularIntensity` is inert at `metalness: 1`, because three sets `specularF90 = mix(specularIntensity, 1.0, metalness)` and `specularColor = mix(..., diffuseColor, metalness)`, both of which collapse to the metal case.
It is the one hero material in the file that costs less than the presets around it, and it is currently the only one declared `MeshPhysicalMaterialProps`.

**[REC] `color: '#ffffff'` is wrong and it is wrong in a way that shows.**
`materials.ts` justifies white as "chrome is white by definition".
Chrome is not white. In a metalness workflow a metal's base colour **is** its Fresnel F0, and the published PBR reference charts put chromium in the mid-0.55 linear range and polished stainless a little above it - dark enough that a mirror is visibly dimmer than what it reflects, which is most of what makes a mirror read as metal rather than as a hole in the world.
Using white makes the reflection brighter than the thing it reflects, which is the one thing a mirror physically cannot do.

**[DOC] The published values, and a real disagreement between two lineages. Section 1.6 has the detail.**
Sébastien Lagarde's 2011 table, which Unreal and Unity both republish, gives chromium linear `0.5496, 0.5561, 0.5543`, which is **`#C4C5C4`**.
physicallybased.info, the only source publishing both chrome and steel, gives chromium linear `0.654, 0.685, 0.701`, **`#D3D8DA`**, and stainless steel `0.669, 0.639, 0.598`, **`#D6D1CB`**.
That is a 20% difference in reflectance plus a hue disagreement - neutral against slightly cool.

**[REC] Take `#D3D8DA`.** The Lagarde value reads as gunmetal and physicallybased.info's reads as bright chrome plating, and this is a toy.
It also has 0.680 linear luminance against 0.557, so the head-on reflection of the hottest card lands at `0.680 x 1.088 = 0.740` - still half the 1.45 threshold, and bright enough that the plate is not the darkest thing on a white character.

**[REC] `materials.ts`'s new `steel()` at `#c6ccd8` is a reasonable third answer and is cooler than either chart**, linear luminance 0.6015, R-B **-18**.
It matches this document's palette direction better than either published value does and it is inside the Filament [170..255] band on every channel.
Keep it if the cool cast is wanted on the deck inlay; use `#D3D8DA` on the head plate, where the surface is meant to read as a mirror rather than as a blue thing.
**[CALC]** At `#D3D8DA`, linear luminance 0.6802, the mirror reflects the rig's hottest card - the highlight strip at peak radiance `1.5543 x 0.70 = 1.088` - at `0.680 x 1.088 = 0.740` head-on, rising to the full 1.088 only at grazing incidence.
At the darker `#C4C5C4` it would be 0.606. At `#ffffff` it reflects 1.088 everywhere, which is 75% of the measured bloom threshold of 1.45 across the whole part rather than at its edge.
The correct F0 costs nothing and buys back the Fresnel falloff that is most of what makes a mirror read as curved.

**[REC] The mirror gets its own environment map, and this is the single highest-value item in this section.**

Three problems have one fix.

- `envResolution` is 128 at low and 256 at medium. **[CALC]** A cube face of `n` texels resolves `90/n` degrees. The highlight strip is 0.55 m at about 10 m, which subtends 3.15 degrees, so it lands on **4.5 texels at 128**, 9 at 256 and 18 at 512. At the low tier the showpiece reflection is a four-texel smudge.
- **[VERIFIED, three 0.185.1]** `PMREMGenerator.js:230` sets `_lodMax = Math.floor(Math.log2(cubeSize))`, so the sharpest mip available *is* the source resolution. There is no way to get a sharper reflection out of a coarser environment.
- Every per-material `envMapIntensity` in the project is dead because no material sets `envMap`.

Setting `material.envMap` to a dedicated PMREM at a fixed 512 fixes all three at once: the mirror gets a sharp map at every tier, `envMapIntensity` becomes live on that material and only that material, and the world's environment stays at whatever the tier can afford.
It costs one extra PMREM generation at load and roughly 4 MB.
**[VERIFIED]** `WebGLMaterials.js` writes `material.envMapIntensity` back only when `material.envMap` is set, which is precisely the branch this takes.

**[REC] A HORIZONTAL mirror reflects a part of the environment that this rig does not contain, and that is why `metalness: 0.68` had to be invented.**

`materials.ts`'s new `steel()` ships at `metalness: 0.68` with a note calling it "the one number in this file that is knowingly not physical", and recording that at `metalness: 1` the deck inlay rendered too dark, that a roughness sweep does not fix it, and that "making a pure metal read here is a light-rig change and not a material change."

**[DOC] And the thing `metalness: 0.68` costs, stated by the spec it departs from.** Filament: "This property should be used as a **binary value**, set to either 0 or 1. Intermediate values are only truly useful to create transitions between different types of surfaces when using textures."
`materials.ts`'s note already says as much and says the deviation is deliberate.
It is worth fixing anyway rather than living with, because the cause is a missing card and a card is cheaper than a permanent deviation from the model every other surface in the file obeys.

**That diagnosis is exactly right and the cause is nameable. [CALC]**
A drei `<Environment>` built from `Lightformer` children contains **only those cards**. The sky dome is not in it, and neither is anything else in the scene.
A horizontal mirror seen from a camera 21.9 degrees above the deck plane reflects the **elevation band around +21.9 degrees**, on the far side of the surface from the viewer.
In this rig that band contains the sky-wrap card at `(-8, 3, -6)`, elevation `atan(3 / 10) = 16.7` degrees, and past its edges it contains nothing at all.
So a pure metal on a deck reflects black, `metalness: 0.68` restores a diffuse term to compensate, and the surface stops being a mirror in order to stop being dark.

> **[REC] The fix is a card, not a metalness.**
> The mirror's own PMREM gets a **horizon band** - one or two large cards centred at **elevation 20 to 25 degrees**, spanning the azimuths the camera orbits through, in `atm.horizon` `#BDC9D4`.
> That is the sky the mirror is meant to be showing and the rig has simply never had it, because every other surface in the game gets its sky from the dome rather than from the cube.
> With the band in place `metalness` goes back to **1.0**, the surface reads as steel rather than as painted metal, and the streak stops being 32% weaker than a mirror's.

**[REC] And the same fact predicts where a horizontal mirror must not go.** The band it samples is fixed by the camera pitch, so a horizontal mirror in this game always shows the same slice of sky wherever it is placed. Two of them show the same image. That is the second reason for the one-mirror rule below and it is a stronger one than taste.

**[REC] The rig has to be dressed for it, because a mirror shows the rig literally.**

| Card | Now | Change |
| --- | --- | --- |
| Negative fill, `#0b0f1a` at 1.0, 12 x 7 at (3, -0.5, 7) | correct and essential | keep, and never remove it. An environment with no dark values is why gloss reads as generic shine. |
| Highlight strip, `#ffffff` at 1.5543, 16 x 0.55 | correct | keep. This is the streak the mirror exists to show. |
| Ground bounce, **`#9ecf6a` at 0.3, 16 x 16 below** | **a green card** | **`#AAB6AE` or the deck silver.** A diffuse bounce nobody could see is now a green stripe across the bottom half of every reflection, and section 2 removes green from the palette anyway. |
| Key softbox, `#fff3e2` at 1.36, 10 x 10 | correct | keep. This is the soft white shape the reference's product-photography read depends on. |

**[REC] Tier policy.** Because the mirror carries its own 512 map it survives at every tier, and what it loses instead is `dithering` at low and the second mirror instance.
Do **not** substitute `anodised()` at low - a mirror that turns satin when the quality drops changes what the object *is*, and `quality.ts` ladders are meant to change fidelity rather than art.

**[REC] Where to put it, in priority order. And note that the geometry choice IS the material decision, because the radius is a parameter of the material.**

1. **The back of the character's head, as a shallow plate.** This is what the reference does and the documented quote says so in as many words.
   Build it at **`r >= 0.45`**, which is a shallow shell over a 0.72 m head rather than a hemisphere, giving **roughness 0.124**.
   **This is the chrome dome, brought back correctly, and the reasons it was deleted are both addressed rather than argued with.** `palette.ts` records two: it was "a cosmetic hemisphere that enclosed the antenna entirely", and it "was the only thing in the game crossing the bloom threshold, which is the budget exactly inverted."
   A *plate* on the back of the head does not enclose the antenna, which answers the first.
   And the threshold crossing was `#ffffff` at roughness 0.06 with no dedicated environment map - all three of the defects this section is about - which answers the second: at `#D3D8DA` and roughness 0.124 the head-on reflection of the hottest card is **0.740** against a threshold of 1.45, a margin of 2.0x, and it only reaches the threshold at all in the last few degrees before the silhouette.
2. **A flat or gently curved inlay in the deck**, `r >= 1.0` at 12 m, roughness **0.088**. Horizontal, so it reflects the sky and the character rather than the rig's dark side, and large enough that the reflection is an image rather than a glint.
3. Nothing else. Two mirrors in a frame is one mirror too many, and a collar ring at `r = 0.05` is not a third option - at roughness 0.37 it is `anodised()` wearing a different name.

**[REC] The acceptance test, and it is not a value measurement.**
Capture `hub-character` and `hub-backlit`. On the mirror surface you must be able to **identify the strip card as a strip** - an elongated bright shape with two ends inside the surface - and **find at least one dark region** that is the negative fill.
A mirror showing a bright wash with no identifiable shapes in it has failed, whatever its luma. Measure it with `frame.mjs where` on the surface's bounding box at a threshold of 0.85 and require the bright pixels to be contiguous and anisotropic rather than scattered.

### 1.5 (b) The matte moulded brick

**What a matte brick looks like in this language.**

**[OBS]** In the reference, masonry is never a photograph of masonry and never a red clay brick.
It is a **cast, moulded block wall**: units of visibly identical size laid in a bond, with an inset joint that reads as a moulded groove rather than as mortar, chipped arrises, and a value that is flat within a unit and stepped between units.
The unit is the mark. The surface between units is almost featureless.
This is the same construction as `groundTexture.ts`'s moulded stone, on a grid instead of on twelve facet headings.

The requirement given is precise and worth restating because two of its three clauses fight each other in a PBR renderer: **stone-like light response, zero reflectivity, high surface detail.**
High surface detail means a strong normal map. A strong normal map on a dielectric produces grazing-angle specular on every facet, which is exactly what makes matte stone look like wet plastic.
So the third clause has to be bought back with the second, and `envMapIntensity` cannot buy it.

**[REC] `specularIntensity` is the lever, and it is free.**

**[VERIFIED, three 0.185.1]** `MeshPhysicalMaterial` sets `defines = { STANDARD: '', PHYSICAL: '' }`, and `meshphysical.glsl.js:63-67` reads

```glsl
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
```

so **every** `MeshPhysicalMaterial` compiles the specular branch, whether or not a specular map is attached.
`lights_physical_fragment.glsl.js` then computes

```glsl
material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
material.specularColor = min( pow2( ( ior - 1.0 ) / ( ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
```

At the default `ior` 1.5 that puts F0 at 0.04. `specularIntensity: 0.28` puts it at **0.0112**, and - the half that matters more - takes **F90 from 1.0 to 0.28**, which is the grazing-angle term that turns a normal-mapped matte surface into wet plastic.
This is a uniform, not a define. It costs nothing, it changes no shader permutation, and it is the only correct way to author "zero reflectivity" in this renderer.

`ior` is the alternative lever and it is worse: it changes F0 without touching F90, so the grazing sheen survives.

**The spec.**

```ts
export function brick(
  color: string,
  maps: PbrMaps,
  overrides: MeshPhysicalMaterialProps = {},
): MeshPhysicalMaterialProps
```

| Field | Value | Why |
| --- | --- | --- |
| `color` | see the band arithmetic below | Tints a near-white map, exactly as `stone()` does. |
| `roughness` | **1.0**, multiplying a map centred on **0.92** | Range 0.84 to 0.97: joint rougher, chipped arris smoother. |
| `metalness` | **0** | |
| `clearcoat` | **0** | Cast, not moulded. No skin. |
| `specularIntensity` | **0.28** | F0 0.0112, F90 0.28. This is the "zero reflectivity" clause. |
| `normalScale` | **`(1, 1)`** | Amplitude lives in the generator's `strength`, per `02-materials.md` 4.5. Do not tune it here. |
| `aoMapIntensity` | **1.15** | Below `stone()`'s 1.35 because this occlusion is authored for this geometry rather than averaged over every facing. And see the band arithmetic - the AO floor is the binding constraint. |
| `sheen` | **0** | |
| `envMapIntensity` | 0.55, nominal | Dead. Listed so the intent survives if a per-material `envMap` is ever added. |
| `dithering` | false | |

**[CALC] The band arithmetic decides where brick is allowed to be, and the answer is "not on the floor".**

`materials.ts` gives `bandLinearRatio`, the linear p95:p5 a display band permits: **gameplay 0.56-0.74 permits 1.852**, midground 0.20-0.38 permits **3.603**.
The transfer curve is far flatter at the top, so the gameplay band - the widest in display space - is the **narrowest** in the space the renderer multiplies in.
A surface carrying relief has almost twice as much room in midground as it has on a deck.

**The binding constraint is the joint's own shading, not its albedo and not its occlusion.**

Occlusion is the smaller term and it is worth being precise about why, because it is easy to over-claim.
**[VERIFIED, three 0.185.1]** `aomap_fragment.glsl.js` applies `ambientOcclusion` to `indirectDiffuse`, `clearcoatSpecularIndirect`, `sheenSpecularIndirect` and, through `computeSpecularOcclusion`, `indirectSpecular`.
It never touches direct light.
So `groundTexture.ts`'s occlusion floor of 0.55, at `aoMapIntensity: 1.15`, lands a fully-occluded texel's *indirect* term at `1 + 1.15 x (0.55 - 1) = 0.4825`, and the environment is about 51% of a shadowed deck's total and less on a lit one - so the AO contributes a linear ratio of roughly **1.2 to 1.4**, not 1.8.

**The joint cheeks are what break it.**
**[CALC]** A square-cut joint on a **horizontal** surface presents two cheeks under a key 42.7 degrees up: one turned almost squarely into it and one in full shade, so the direct term runs from near its maximum to zero and the linear ratio between the two exceeds **9**.
That is over gameplay's 1.852 by a factor of five and over midground's 3.603 by a factor of two and a half.
**And the albedo cancels**, exactly as it does in `DIFFUSE_CYLINDER_LINEAR_RATIO`, because both cheeks carry the same hex and differ only by facing. No colour fixes it. This is the same proof that ruled out a diffuse cylinder in band 2.

> **[REC] The relief budget. A relief mark's contribution to a surface's spread is set by its maximum surface SLOPE, not by its depth.**
> Cap a joint cheek at **35 degrees** from the surface plane and **chamfer** it rather than square-cutting it.

**And then the measurement that overturns the conclusion I was about to draw from it.**

The obvious conclusion from a ratio of 9 is "brick cannot be a walkable deck", and it is wrong.
`brickTexture.ts`, built in parallel with this document, records the measurement that settles it: **a lit deck's p5-p95 moved from 0.0387 to 0.039 when the generated surface maps were switched on.**
The relief changed the deck's spread by three ten-thousandths.

**[CALC] The two facts are the same fact, and 5.3 explains it.**
The cheek ratio of 9 is real **at texel scale**. It never reaches the screen, because a horizontal surface is foreshortened by `sin(21.9 deg) = 0.373`, so a 0.06 m joint spans about **2.3 px down-camera on a floor** against **8.7 px on a wall**, and the mip chain averages both cheeks into one value before the eye sees either.

> **The band risk and the legibility benefit are the same quantity, and on a deck both are filtered out.**
> A relief mark that cannot break a band also cannot be seen.

**So the placement rule changes shape and gets more useful.**

| Facing | Joint width in px | What carries the joint | What is wasted |
| --- | --- | --- | --- |
| **Vertical wall**, midground | ~8.7 | **Relief.** Normal map plus bound occlusion | nothing |
| **Horizontal deck**, gameplay | ~2.3 | **Albedo.** A printed mortar drop | the normal map, almost entirely |

**[REC] Brick on a deck is legal, and its normal map is the wrong channel.**
Print the joint - which is what `BRICK_MORTAR_DROP` does - and keep the normal map only for the pylons and walls, where it is bound and where the occlusion is not already owned by the lightmap.
This is the same conclusion `brickTexture.ts` reaches from its own measurements, and it is worth stating as a rule because the next surface will hit it too: **choose the channel from the facing, not from the material.**

**[REC] Brick on a wall is where the material actually pays for itself**, in midground, where the linear budget is nearly double and where the joint gets 2.7 times the pixels for the same metre.

**[CALC] Therefore the albedo, solved for a lit vertical face.**

`FACING_RATIO.litVertical` is 0.54 and `renderedLuma(hex, facing)` is the model. Solving backwards for a midground target:

| Target rendered display luma | Required albedo display luma | Hex, held at R-B -18 | Renders lit / shaded |
| --- | --- | --- | --- |
| 0.20, the midground floor | 0.274 | `#3E4750` | 0.200 / 0.076 |
| **0.30, the middle** | **0.403** | **`#5F6871`** | **0.300 / 0.128** |
| 0.38, the midground ceiling | 0.509 | `#7A838C` | 0.381 / 0.170 |

**[REC] `brick` = `#5F6871`. Display luma 0.4029, linear 0.1353, chroma 0.159, R-B -18.**
It renders at 0.300 on a lit vertical face and 0.128 on a shaded one, which puts the shaded side in the anchor band - correct, and the reason a brick wall is a good place to put a cast shadow.
The per-unit tone ladder in the next paragraph spends **+/- 0.035** of albedo display luma around it, `#68717A` to `#545D66`, which renders 0.327 to 0.266 and stays inside midground at both ends.
Sitting at the middle of midground rather than at either end is deliberate: the per-unit tone ladder in the next paragraph spends outward from it in both directions.

**Do not check this hex against `band()`.** Its display luma of 0.404 is in the 0.38-0.56 gap that section 8 says must be empty, and that is correct rather than a violation, for the same reason `soilDeep` is `#8a6440`: a vertical surface reaches its band by facing away from a steeply overhead key, not by having a dark hex.

**[REC] Detail authoring, channel by channel.**

The generator is `createMouldedBrickMaps()` in `groundTexture.ts`, built on the same shared-noise-field discipline as `createMouldedStoneMaps` - one noise field feeding albedo, height, roughness and occlusion, so the mottle and the relief and the gloss all agree about where the material is.
Re-seeding per mask produces two superimposed walls.

| Channel | Content | Amplitude |
| --- | --- | --- |
| Albedo | Base near-white `#DEDEDE`, per-unit tone ladder, chipped arris highlights. **No joint darkening.** | Unit-to-unit spread **+/- 0.035** of albedo display luma, six rungs. The joint is relief and occlusion, never albedo - a printed dark line is a scratch, a lit groove is a joint. |
| Height | Unit faces at 1.0, joint floor at **0.62**, chipped arrises cut back 0.10, face mottle 0.06 | Joint depth is 38% of the mask's range, which at the tile scale below is a real 12 mm inset. |
| Roughness | 0.92 base, joint **+0.05**, arris chip **-0.06**, face mottle **+/- 0.03** | Dust settles in a groove; a chipped edge is freshly broken and slightly smoother. |
| Occlusion | Written by the joint and the arris only. **Never by the mottle.** Blurred 3 px, floored at 0.55 | Noise is not occlusion. Treating it as occlusion is the "AO looks like dirt" failure. |

**[REC] The bond and the scale, in metres, and this is where a real brick is the wrong answer.**

A real brick is 215 x 102.5 x 65 mm on a 75 mm course with a 10 mm joint.
**[CALC]** At 6.92 mm per pixel at the character's distance, a 10 mm joint is **1.4 px** and a 75 mm course is 10.8 px, so a real brick wall standing next to the character is a grey field with a faint hatch on it - which is exactly the "tenth of a pixel" defect in section 0.1, at 14 times the size and still failing.
It is also anti-toy: **[DOC]** the reference's props are consistently oversized relative to the character, reinforcing "child among toys", and a wall the character is 18 courses tall against is a *building*.

| Dimension | Value | Derivation |
| --- | --- | --- |
| Unit face | **0.56 x 0.25 m** | 2.24:1, close to a real brick's 2.1:1, so the proportion still reads as masonry |
| Joint | **0.06 m** | **8.7 px** at the character's distance. Four times the 2 px floor, because the joint is the only thing making this brick and not a grey wall. |
| Course | **0.31 m** | The character's 1.36 m silhouette is **4.4 courses**. Toy scale. |
| Unit pitch | **0.62 m** | |
| Bond | **running, offset 0.31 m** | Half-unit stagger, which repeats every 2 courses. |
| Tile | **1.24 x 1.24 m** | Exactly 2 units by 4 courses. Square, so texel density is uniform and `tiles(span, 1.24)` is the only call site arithmetic. |
| Map size | **512** at medium, **1024** at high | **[CALC]** 512 over 1.24 m is 2.42 mm per texel; the screen is 6.92 mm per pixel, so the sampled mip is level 1-2 and the 0.06 m joint is still 12 texels there. 1024 is a real improvement only where a wall is approached. |
| Joint inset depth | **0.012 m** | Deep enough to catch the key as a shadow line, shallow enough that a normal map can honestly fake it. Do not use parallax; at this grazing angle range it swims. |

**[REC] Do not tile the bond seamlessly across a whole wall.** A 1.24 m tile repeated 12 times across a 15 m wall reads as wallpaper regardless of the noise in it, which is the failure `textures.ts` already documents for stone.
Break it the way masonry is actually broken: a **course band** every 5 to 7 courses in a different unit length, and a **pier** every 3 to 4 m where the bond restarts.
Both are geometry, both are one extra mesh in the kit, and both are cheaper than a bigger texture.

**[REC] The acceptance test.**
`frame.mjs spread` on a 60 x 60 px box **inside one lighting condition** on a lit wall face: p5 to p95 must fit inside 0.20 to 0.38.
Then the same box on a shaded face: it should land in 0.06 to 0.18, and if it does not the wall is not doing the anchor-band job that justifies putting it in the frame.
Then greyscale the frame and confirm you can still count courses. If you cannot, the joint is under-cut or under-occluded, not under-contrasted - do not fix it in the albedo.

---

### 1.6 Vendor reference values, and where they disagree

Fetched for this document because every number in 1.4 and 1.5 depends on one of them.
None of these is a Sony source and none of them is about Astro Bot.

**[DOC] three.js has a roughness floor per environment resolution, and it is the same constraint as 1.2's curvature floor arriving from the other direction.**

`material.roughness = max(roughnessFactor, 0.0525)` is the global clamp, commented in three's own source as "0.0525 corresponds to the base mip of a 256 cubemap".
The per-resolution minimums three publishes:

| `envResolution` | Minimum meaningful roughness |
| --- | --- |
| 128, our **low** tier | **0.076** |
| 256, our **medium** tier | **0.054** |
| 512, our **high** tier | **0.038** |
| 1024 | 0.027 |

> **[REC] `pmremFloor(envResolution)` is one of `steelMirror()`'s two roughness floors, and it is why the mirror needs its own map.**
> Below the floor the number is discarded, so a mirror on the low tier cannot be sharper than 0.076 no matter what is authored - which is another way of saying the same thing 1.4 says about the highlight strip landing on 4.5 texels.
> A dedicated 512 map moves the floor to 0.038 at every tier.

**[DOC]** Filament explains why a low-resolution map aliases at low roughness in particular: "Roughness contribution for the non-constant part of the IBL is quantized and trilinear filtering is used to interpolate between these levels. This is most visible at low roughness (e.g.: around 0.0625 for a 9 LODs cubemap)."
And: "Because mipmap levels are used to store the pre-integrated environment, they can't be used for texture minification... This can cause aliasing or moire artifacts."

**[DOC] `clearcoatRoughness: 0` is silently 0.0525 in three.js**, clamped the same way.
`visorPlate()`'s 0.05 is therefore really 0.0525 and its stated lobe ratio of 31.4 is really 28.4. Harmless, but stop authoring below the clamp.

**[DOC] Filament's clearcoat cost warning, which this project should act on.**

> "The clear coat layer effectively **doubles the cost of specular computations**. **Do not assign a value, even 0.0, to the clear coat property if you don't need this second layer.**"

**[REC]** `rubber()`, `flock()` and `ground()` all pass `clearcoat: 0` explicitly, and `masonry()` does too. In three that is not the same trap as in Filament - three gates on `material.clearcoat > 0` at program-selection time - but the principle transfers to the presets that carry a *nominal* coat for no visible return. `stone()`'s 0.15 over a mapped base roughness near 0.8 is the candidate: it is a full extra GGX evaluation over the largest surfaces in the game for a lobe the two-lobe rule already calls the weakest in the file. Measure it with the pass on and off before keeping it.

**[DOC] Metal base colours. Two lineages, and they disagree materially.**

| Metal | Lagarde 2011, as sRGB | physicallybased.info, as sRGB |
| --- | --- | --- |
| **Chromium** | **`#C4C5C4`** (linear 0.550) | **`#D3D8DA`** (linear 0.654) |
| **Stainless steel** | not published | **`#D6D1CB`** |
| Iron | `#C4C7C7` | `#C0BEBB` |
| Nickel | `#D4CDC0` | `#D9D1C6` |
| Aluminium | `#F5F6F6` | `#F5F6F6` |
| Silver | `#FCFAF5` | `#FEFDFC` |
| Gold | `#FFE39D` | - |

Lagarde is computed from Filmetrics complex-IOR data and is what Unreal and Unity Shader Graph republish; the Adobe PBR Guide publishes the same lineage in sRGB, adds iron, and omits chromium.
physicallybased.info derives from refractiveindex.info and is the only source with both chrome and steel.
**[REC]** Prefer physicallybased.info here: one lineage, checkable provenance, and it covers what this project needs.
**Note that Filament's own metal table is not usable** - its silver and aluminium rows are Lagarde's raw *linear* values printed in a column labelled sRGB, which renders both far too dark. Its iron, titanium and platinum rows are correct.

**[DOC] Filament's rule for what a metal base colour may be:** "[170..255] if the value is encoded between 0 and 255, or [0.66..1.0] between 0 and 1."
Lagarde states the same rule loosely: "The basic rule for metal is to setup a value above 0.5."

> **This rules out two tokens in section 2.3 and it is the reason `anodised()` has never looked like metal.**
> `#8FA2B8` has a red channel of **143** and `#6E7A8C` has **110**, both well under 170.
> A metal that dark is not a metal, it is a dielectric wearing `metalness: 0.95`, and that is exactly what anodising physically is - an oxide film over aluminium, not a differently-coloured aluminium.

**[DOC] The albedo range rule, and its usual misattribution.**
The Adobe PBR Guide: "For dark values, you should not go under **30-50 sRGB**... For bright colors, you should not have any values that are higher than **240 sRGB**", and "Coal is dark, but it is not 0.0 black."
The "50 to 243" version of this rule is frequently attributed to Epic and is **not Epic's**; it is the Lagarde/DONTNOD chart, where 243 is simply that chart's brightest swatch (snow) and 50 is coal.
Unreal's own documentation states no sRGB range at all.

> **[REC] Two tokens in 2.3 violate the floor and one grazes the ceiling. Section 2.3 fixes all three.**

**[DOC] Published brick albedo exists, and ours is deliberately not it.**
The DONTNOD chart gives bricks a median sRGB luminosity of **131**, old concrete 135, clean cement 181, grey plaster 129.
Filament's artist chart independently gives brick `148, 125, 117`, which is `#947D75` and matches the DONTNOD swatch.
**[REC]** `sub.brick` is `#5F6871`, median channel 104 and cool rather than warm, and both departures are deliberate: 1.5 solves the value backwards from a **lit vertical facing** rather than from a swatch, and section 2 removes the warm family from the substrate.
The number that matters is that its darkest channel is **95**, comfortably clear of the 30-50 floor.

**[DOC] ABS has a published IOR: 1.538 at 589 nm**, which gives `F0 = ((1.538 - 1) / (1.538 + 1))^2 = 0.0449`.
Filament, citing Real-Time Rendering 4th edition, puts plastics and glass at 4 to 5 per cent and IOR 1.5 to 1.58.
**[REC]** Set `ior: 1.538` on the moulded-plastic presets. It is one number, it is free, and `MeshStandardMaterial` does not have it - which is a real reason for those presets to stay `MeshPhysicalMaterial` and a real reason for `steelMirror()` not to be.

**[DOC, negative] No authoritative chart publishes a roughness for moulded ABS, or for polished, brushed or oxidised metal.**
Substance declines explicitly: "Roughness is a highly subjective area. You, the artist, are in full creative control."
Mould finish is published only as surface roughness in micrometres (SPI A-D, VDI 3400; matte ABS Ra 3 to 11 micrometres) and no published Ra-to-PBR mapping exists.
The best available anchor is Marmoset's chart, pixel-sampled rather than printed, under `(1 - gloss)^2`: chrome 0.00, gold 0.02, rough steel 0.09, brushed metal 0.14, **glossy plastic 0.29**, **rough plastic 0.54**, **satin 0.64**, rubber 0.63.
**Our `plastic()` at 0.45 and `mattePlastic()` at 0.75 straddle that band correctly**, and every roughness in this project is and remains **[REC]**.

**[DOC, negative] three.js has no parallax occlusion mapping.** `ParallaxShader.js` has been removed; only the WebGPU example remains.
**[REC]** That closes the question 1.5 raises about the brick joint: the joint is a normal map and an occlusion mask, or it is geometry. There is no third option, and at 0.31 m courses the geometry option is genuinely cheap and matches the manufactured-object rule better.

---

## 2. Colour

### 2.1 The direction, and what it actually is

**The direction is authoritative and it is not "blue and orange".**
Astro's world leans on a **range of blues, silvers, greys and black**.
The complementary blue-and-orange scheme that most stylised platformers reach for is not what is happening in that art, and reading it that way is what put `#ff9a3c` and `#e0651a` into this palette.

**[DOC] The sources back the direction and they contain nothing that backs the alternative.**
Doucet, on the VR-era redesign: "We added a **PlayStation blue livery** and more parts to have him **stand out from the environment**."
The 2021 how-to-draw article names the "iconic blue livery pattern" as the defining Astro mark.
The head plate is described as **silver**.
And the only other hues named anywhere in the first-party record are the two semantics: "the idea of **blue LEDs for friends and red LEDs for enemies** has become something of a trademark we've built on".

**[DOC, negative] A fresh search returns no source of any kind - developer, journalist, or critic - describing Astro Bot's palette as blue-and-orange complementary.**
Red exists, but as a semantic signal rather than as a colour harmony, and those are different mechanisms.
The blues/silvers/greys/black read is the one the record supports; the blue/orange read is not attested anywhere.

**[DOC, negative] No official hex values exist. Not one.**
The `#003791` figure that circulates on brand-colour aggregators is Sony's *corporate* blue, unsourced to any guideline and with no evidence it is the value on Astro's livery.
Every hex in this section is sampled, computed or chosen here, and is labelled accordingly.
Anything presenting a Sony hex is inventing it.

**[OBS] What is actually happening is a one-hue substrate with a warm light on it.**
The world's *albedo* is a narrow blue-to-neutral family: silver, cool grey, steel blue, blue-black.
The world's *illumination* is warm.
Where warmth appears in frame it is a lit surface, not a coloured surface, and that is why the reference reads as photographed rather than painted.
`00-references.md` section 2 has this in it already - a warm key, a strongly coloured cool ambient, a cool rim - and section 5 then contradicts it by describing the palette as though the hues were in the paint.

This is the same finding as 0.5 seen from the palette side.
The two halves are the same decision: **take the hue out of the albedo and put it in the light.**

### 2.2 The law: chroma is a ceiling that falls with value

Every palette rule this project has tried has been about *value*, and value alone cannot say why an amber accent is a problem and a cyan visor is not.
Both are saturated. One is fine and one is not, and the difference is not the hue.

**[REC] The chroma ceiling.**

> `chroma <= 0.62 * (1 - displayLuma)`, where `chroma = (max - min) / max` of the sRGB channels.
>
> A colour at or under the ceiling is **substrate**. It may occupy any share of the frame.
> A colour over the ceiling is **signal**. Its share of the frame is capped at `4% / debt`, where `debt = chroma / ceiling`.

Two things make this the right shape.

It matches what the reference does.
**[OBS]** The bright things in that art are almost colourless and the coloured things are almost all dark, and the exceptions are all tiny and all mean something.
Sampling the shadow side of a white shell returns a *chromatic* value, never a neutral one, which is the same statement: as value falls, chroma is allowed to rise.

And it is the only rule that separates the two saturated things correctly.
**[CALC]**

| Colour | Role | L | chroma | ceiling | debt | area cap | actual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `visor` `#4de2ff` | signal | 0.770 | 0.698 | 0.142 | 4.90 | 0.82% | two eye lenses. **passes** |
| `unlocked` `#ffd45e` | signal | 0.834 | 0.631 | 0.103 | 6.13 | 0.65% | a totem ring. **passes** |
| `accent` `#ff9a3c` | surface | 0.662 | 0.765 | 0.210 | 3.64 | 1.10% | arms, chest, ear pods, backpack. **fails** |
| `token` `#ff6bd6` | surface | 0.573 | 0.580 | 0.265 | 2.19 | 1.82% | thirteen shards. **fails** |
| `grass` `#7dc244` | surface | 0.668 | 0.649 | 0.206 | 3.15 | 1.27% | **60.8% of the frame. fails by a factor of 48.** |
| `gold` `#e8b84b` | surface | 0.731 | 0.677 | 0.167 | 4.05 | 0.99% | fails |
| `rock` `#bfbbb4` | substrate | 0.735 | 0.058 | 0.165 | 0.35 | unlimited | passes |
| `bandFrame` `#3c465a` | substrate | 0.272 | 0.333 | 0.451 | 0.74 | unlimited | passes |

That table is the whole colour problem in one column.
The palette's existing value discipline is intact - `rock` and `bandFrame` both pass - and everything that has ever looked wrong in this world is a surface carrying signal chroma over a surface's area.
The lawn is the extreme case and it fails by a factor of 48, which is why no amount of value tuning across three critique rounds has made it sit down.

**The corollary that decides the whole palette.**
A hue can only be substrate if its chroma fits under the ceiling at its value, and at gameplay-band values the ceiling is only 0.16 to 0.25.
Blue, cyan and violet reach those chromas at low values naturally, which is why a blue-grey world is easy.
Orange, gold and yellow-green do not exist at chroma 0.20 - desaturate them that far and they become beige.
**That is the mechanical reason the reference's substrate is blue, and it is not a taste argument.**

### 2.3 The token system

Six families. The name says the role, not the object, which is the change from the current file.

**Family H - hero.** The character, and nothing else. Highest value in frame, lowest chroma in frame, exempt from the value bands because it is the anomaly they are built around.

| Token | Hex | Display L | Linear L | Chroma | R-B | Band |
| --- | --- | --- | --- | --- | --- | --- |
| `hero.shell` | **`#EEF0F4`** | 0.9406 | 0.8703 | 0.025 | -6 | anomaly |
| `hero.shellShadow` | **`#B5C4D3`** | 0.7604 | 0.5401 | 0.142 | -30 | anomaly |
| `hero.blue` | **`#2F7AD2`** | 0.4408 | 0.1918 | 0.776 | -163 | signal, debt 2.24 |
| `hero.blueDeep` | **`#1D4D8F`** | 0.2806 | 0.0755 | 0.797 | -114 | midground |
| `hero.plate` | `#12161C` | 0.0846 | 0.0079 | 0.357 | -10 | anchor |

`hero.shell` moves from `#f4f1ea` to `#EEF0F4`: display luma 0.9456 to 0.9406, a change of five thousandths, and a hue change of 16 points of R-B.
**[REC] This is the same move `rock` made, in the opposite direction, and for the reason 0.5 gives.** The warm cream was chosen "so it never reads as clinical grey", and it will not: the key is `#fff3e2`, the sheen is `#ffb489`, and a neutral shell under a warm key reads warm on its lit side and takes the level's hue in shadow, which is the diagnostic `00-references.md` gives for the reference's own white plastic.
A warm shell reads warm on *both* sides, which is what kills the shadow-side chroma.
Fallback if it reads cold on screen: `#F1F1EF`, true neutral, chroma 0.008.

`hero.blue` at debt 2.24 caps at 1.79% of frame. The character is 3 to 6% of frame at these vantages, so the blue is a **trim** colour on the character - helmet, limbs, a chest band - never the body. That is also what the reference does.

**Family S - steel.** Metal F0 values. These are not albedos and must not be band-checked.

| Token | Hex | Display L | Linear L | Chroma | min channel | Impersonating |
| --- | --- | --- | --- | --- | --- | --- |
| `steel.chrome` | **`#D3D8DA`** | 0.8435 | 0.6802 | 0.032 | 211 | chromium, physicallybased.info |
| `steel.polished` | **`#D6D1CB`** | 0.8221 | 0.6421 | 0.051 | 203 | stainless steel, same source |
| `steel.cool` | **`#C6CCD8`** | 0.7984 | 0.6015 | 0.083 | 198 | the cool steel `materials.ts` shipped. Not a chart value. |
| `steel.anodised` | **`#AEB9C6`** | 0.7200 | 0.4777 | 0.121 | **174** | blue-anodised aluminium |

**[REC] `steel.anodised` was `#8FA2B8` in the first draft of this table and it is corrected here, because 1.6 rules it out.**
**[DOC]** Filament puts a metal's base colour in **[170..255] sRGB** and `#8FA2B8`'s red channel is 143.
`#AEB9C6` clears 170 on every channel, keeps the blue-steel cast, and at display luma 0.720 clears the **0.446** floor `metalF0ForCylinderRatio` requires for a metal cylinder to hold a band by a wide margin.

**[REC] And `steel.dark` is deleted rather than corrected.** There is no such thing as a dark metal: anything below 170 sRGB is a **dielectric with a coating**, which is physically what dark anodising is - an oxide film over aluminium.
Dark hardware is `mattePlastic(sub.frame)` or `rubber(sub.trim)`, not a metal at 0.95.
That is also why `anodised()` has never quite read as metal in this project: it has been authored as a metal at dielectric values since it was written.

**None of these four may go on a flat face**, per `anodised()`'s own finding: a flat metal sweeps its value with camera yaw and cannot hold a band. Cylinders only.

**Family C - substrate.** The world's body. Every one of these is at or under the chroma ceiling by construction, and the chroma rises monotonically as the value falls, which is the law made visible.

| Token | Hex | Display L | Linear L | Chroma | Ceiling | Debt | Band |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sub.deckTop` | **`#BABCBD`** | 0.7359 | 0.5008 | 0.016 | 0.164 | 0.10 | gameplay |
| `sub.deckSide` | **`#94989B`** | 0.5936 | 0.3112 | 0.045 | 0.252 | 0.18 | gameplay |
| `sub.brick` | **`#5F6871`** | 0.4029 | 0.1353 | 0.159 | 0.370 | 0.43 | gap, by design. See 1.5 |
| `sub.trim` | `#4B5568` | 0.3304 | 0.0899 | 0.279 | 0.415 | 0.67 | midground |
| `sub.frame` | `#3C465A` | 0.2718 | 0.0608 | 0.333 | 0.451 | 0.74 | midground |
| `sub.underside` | **`#5F6871`** | 0.4029 | 0.1353 | 0.159 | 0.370 | 0.43 | **renders** into anchor. See below |

`sub.deckTop` replaces `rock` `#bfbbb4` at display luma 0.7359 against 0.7347 - **one thousandth of a point**, so every measurement in the bible's section 8 table and every band assertion survives unchanged.
Only the hue moves, from R-B +11 to R-B -3, which is a neutral silver rather than a cool grey.
The warmth those 14 points were buying comes back in 2.6, from the rig, where it is worth 18 points instead of 11.

`sub.trim` and `sub.frame` are unchanged. They were already right.

**[REC] There are no anchor-band albedo tokens, and the first draft of this table was wrong to have two.**
It carried `#131D27` and `#0D151D`, whose darkest channels are 19 and 13.
**[DOC]** The Adobe PBR Guide's floor is 30 to 50 sRGB - "Coal is dark, but it is not 0.0 black" - and both are under it, so neither is a physically plausible albedo for anything.

More importantly they were the exact error `palette.ts` already refuses in `band()`: **a surface reaches the anchor band by facing away from a steeply overhead key, not by having a dark hex.**
`soilDeep` is `#8a6440` at display luma 0.414 and renders at 0.20 to 0.25; the `#452f1c` it replaced would have rendered near 0.06.

**[CALC] So the anchor band's albedo is `sub.brick`'s albedo**, and one token does both jobs.
At `FACING_RATIO.shadedVertical` of 0.11, `#5F6871` renders at **0.128** - squarely inside 0.06 to 0.18.
Solving the other way: to render at 0.12 on that facing an albedo needs display luma 0.398, and `sub.brick` is 0.403.

**[REC] `hero.plate` `#12161C` has a darkest channel of 18 and is under the same floor.** It is a shipped value and its read is the clearcoat rather than the albedo, so it is left alone rather than churned - but if the visor plate is ever revisited, **`#1E242E`** is the same colour at a legal 30, and it renders 0.023 rather than 0.011 on a vertical face, which is more room for the emissive glyph to sit against and not less.

**[REC] And the ceiling, which two tokens graze.** `hero.shell` `#EEF0F4` has a blue channel of 244 and `atm.cloud` `#EEF3F8` has 248, against the guide's 240.
The shell is the **value anomaly** the composition is built around, so it is allowed and this is noted rather than fixed. The cloud is not doing that job and should come to **`#EFF1F4`**, min channel 239, which also takes its chroma debt from 0.42 to 0.60 - still legal, and one step more neutral than the shell it sits behind.

**Family A - atmosphere.** Sky, cloud, fog. Not surfaces, so `band()` does not apply, but the ceiling does.

| Token | Hex | Display L | Chroma | Debt |
| --- | --- | --- | --- | --- |
| `atm.zenith` | **`#5A9AD4`** | 0.5670 | 0.575 | 2.14 |
| `atm.horizon` | **`#BDC9D4`** | 0.7813 | 0.108 | 0.80 |
| `atm.cloud` | **`#EFF1F4`** | 0.9443 | 0.020 | 0.59 |
| `atm.cloudShadow` | **`#C2CFDC`** | 0.8046 | 0.118 | 0.63 |

The zenith is the one deliberate over-ceiling substrate in the file and it is allowed because of where it lands: at FOV 40 with a downward pitch the zenith is a few per cent of frame and the horizon is most of it, and the horizon is legal at debt 0.80.
**[REC] Assert this rather than assuming it.** Measure the sky's *rendered* chroma distribution with `frame.mjs`, not the two hexes, and require the frame-weighted debt to come in under 1.0.

**Family G - signal.** Constant across every world, tiny area, always means the same thing.
**[DOC]** `00-references.md` is explicit that blue LED is ally and red LED is enemy, globally and without exception, and that keeping hazard red, collectible gold and ally blue constant is what makes the game readable without a tutorial.

| Token | Hex | Display L | Linear L | Debt | Area cap | Means |
| --- | --- | --- | --- | --- | --- | --- |
| `sig.ally` | `#4DE2FF` | 0.7703 | 0.6319 | 4.90 | 0.82% | powered, friendly, interactive |
| `sig.allyDim` | `#1B7F96` | 0.4212 | 0.1761 | - | - | the same, unpowered |
| `sig.reward` | `#FFD45E` | 0.8338 | 0.6916 | 6.13 | 0.65% | collectible, completed, earned |
| `sig.rewardDeep` | **`#E0A93A`** | 0.6772 | 0.4453 | 4.05 | 0.99% | the reward hue as a solid, never as a field |
| `sig.hazard` | **`#FF4D3D`** | 0.4458 | 0.2690 | 2.21 | 1.81% | danger. Reserved, currently unused |
| `sig.locked` | **`#6B7885`** | 0.4634 | 0.1825 | 0.59 | unlimited | not yet available |
| `sig.lockedDeep` | **`#39404D`** | 0.2488 | 0.0507 | 0.61 | unlimited | |

**The accent role that survives, and only one does.**

> **Gold survives. Amber does not.**

**[DOC]** Gold survives because the reference keeps collectible gold globally constant, so it is not an aesthetic choice available to be spent - it is a semantic, like hazard red.
Amber does not survive because it was never a semantic. It was a decorative hue at debt 3.64 spread over the character's arms, chest panel, ear pods and backpack, and it is the single largest violation of 2.2 on the character.

**[REC] And gold survives only under two conditions.** It never becomes an albedo on a surface with area - no gold plate, no gold trim run, no gold contacts on a deck - and it appears only on things that are *powered or earned*.
`gold` `#e8b84b` as a surface colour is deleted and folded into `sig.rewardDeep`, which is the same hue restricted to emissive and to small solids.
That leaves the world with exactly **two** warm elements: reward gold and hazard red, both semantic, both tiny, both constant across every level. Everything else warm is a light.

**Family V - vegetation.** The one environmental hue, and it survives only by becoming substrate.

| Token | Hex | Display L | Linear L | Chroma | Ceiling | Debt |
| --- | --- | --- | --- | --- | --- | --- |
| `veg.blade` | **`#82A07E`** | 0.5928 | 0.3139 | 0.212 | 0.252 | 0.84 |
| `veg.tip` | **`#8FAB88`** | 0.6373 | 0.3674 | 0.205 | 0.225 | 0.91 |
| `veg.deep` | **`#54704F`** | 0.4065 | 0.1404 | 0.295 | 0.368 | 0.80 |

**[REC] This is the change the lawn has needed for three rounds and no round has proposed, because every round was looking at value.**
Round 1 moved the lawn's value, round 2 gave it a root ramp, round 3 moved its mean into the gameplay band, and the greyscale test failed all three times.
The lawn's chroma is 0.649 at debt 3.15 across 60.8% of the frame. Under 2.2 its cap is 1.27%.
Taking chroma from 0.649 to 0.212 while holding display luma within 0.075 of where round 3 left it makes it legal and makes it read as **moulded flock**, which is what `flock()` was written for and what the world rule requires a lawn in this world to be.

It also settles a second thing for free: the whole tip-to-root ramp gets cheaper to fit inside a band, because desaturating a surface narrows the spread its own shading can produce.

### 2.4 What carries saturation, and what must not

| Class | Chroma policy | Why |
| --- | --- | --- |
| **Emissive cores and LEDs** | unlimited, but see the bible's pale-core rule | This is what bloom is for. A tiny area at maximum chroma is the entire signal budget well spent. |
| **The character's trim** | up to debt 2.3, under 2% of frame | `hero.blue`. Helmet, limbs, a band. Never the body. |
| **The character's body** | debt under 0.5 | It is the value anomaly. Chroma on the body destroys the separation mechanism. |
| **Interactive props** | up to debt 2.2, and count them | Thirteen shards at debt 2.19 is 23% of the signal budget on decoration. |
| **Walkable ground** | debt under 0.5 | Any surface the player stands on. |
| **Walls, frame, background** | debt under 1.0, and falling with distance | Aerial perspective is a *chroma* falloff at least as much as a value one. |
| **Vegetation** | debt under 1.0, no exception | Because of its area. |
| **Sky** | frame-weighted debt under 1.0 | Because of its area. |

**[OBS] The tiering that `00-references.md` section 5 describes as "chroma down 25%, then another 30-50%" is this rule, stated badly.**
Percentages of an unstated base are not checkable. `chroma / (0.62 * (1 - L))` is.

**[DOC] And the same tiering appears in the level-design record as a shape rule as well as a colour one.**
From the CEDEC 2025 level-design session: eliminate ambiguity by making gameplay areas differ from buildings in **shape and colour** together, and make optional paths *deliberately less* visually salient - thinner, differently oriented.
That is the second half of the mechanism and this project only has the first.
Chroma alone cannot say "you may not climb this"; chroma plus a different shape language can, which is why `03-environment.md`'s "give playable and decorative geometry different shape languages" and this section's chroma ceiling have to be applied together or neither reads.

### 2.5 How value separates the classes

Unchanged from the bible's section 8 and repeated here only because the token table has to be read against it.
Bands are **display-space**, measured on the frame, judged on a surface's p5-to-p95 and not on its mean.

```
background   0.76 - 0.86   sky, horizon, distant silhouettes, cloud
             0.74 - 0.76   empty
gameplay     0.56 - 0.74   anything the player stands on
             0.38 - 0.56   empty. sub.brick's ALBEDO lives here; nothing RENDERS here
midground    0.20 - 0.38   walls, kerbs, frame, brick as rendered
             0.18 - 0.20   empty
anchor       0.06 - 0.18   undersides, cast shadow, recessed apertures, brick in shade
```

**[REC] One addition, and it is the piece that makes the whole thing checkable at a glance.**
The four bands and the chroma ceiling are two axes of one system, and they agree: as value falls, chroma rises.
So a correct frame, plotted as chroma against display luma, is a **band of points under a single descending line**, plus a handful of outliers that are all signal.
`tools/critique/frame.mjs` should gain a `chroma <png>` mode that emits exactly that scatter and reports the frame-weighted debt.
One number - total frame-weighted debt - answers "is this world over-coloured", which is a question three critique rounds asked in prose and never once measured.

### 2.6 Where the 18 points of warmth come from

Section 0.5 established that this rig renders a lit deck at R-B -9.9 off a neutral albedo, and that a clearly warm lit surface needs about +8.
Three levers, in the order they should be tried, and none of them touches the palette.

**[CALC] The transfer, so the estimates below are checkable rather than asserted.**
A source's R-B reaches the frame multiplied by its share of the surface's irradiance and again by the 0.714 compression fitted in 0.5.
`Lighting.tsx` records the environment as 51.0% of a shadowed deck; on a *lit* deck the key directional and the key softbox together dominate, and 35% / 40% / 25% for directional / softbox / everything else is the working split until it is measured.

| Lever | Now | Proposed | Card R-B delta | Share | Frame delta | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| **Key softbox card** | `#fff3e2`, R-B +29 | **`#FFEBCF`, R-B +48** | +19 | ~0.40 | **[CALC] +5.4** | none. Luminance barely moves, so peak radiance and every bloom margin hold. |
| **Key directional** | `#ffe7bc`, R-B +67 | **`#FFE3AE`, R-B +81** | +14 | ~0.35 | **[CALC] +3.5** | none |
| **Sky-wrap card, shrink not cool** | `#8ec8f0` at 0.36, 14 x 9 | **10 x 6.5** | removes a -105 source | ~0.10 removed | **[CALC] +7.5** | the ambient falls, which the bible separately wants |

Together that is **+16.4** against the +18 needed, which lands a lit deck at R-B +6.5 - inside the acceptance window below with nothing left over.
**[REC]** If it comes in short, the next lever is the ground bounce card, which 1.4 is already changing from green to silver and which could as easily go to a warm silver.

**[REC] Take them in that order and measure after each,** because the bible's rollout discipline applies: one change per commit, defensible in isolation at the same vantage.
The acceptance number is not a hex, it is `__dev.sample()` on a lit deck at `hub-character` returning **R-B between +6 and +12**, with the shadowed deck staying at **R-B below -18**.
That pair is the split-tone, stated as something a test can assert, which is what neither document has had.

**[REC] And a hard warning, because it is the trap this exact change sets.**
`palette.ts`'s note says the grade was the obvious suspect and is innocent - captured with `?nogfx=lut` the same pixel moved three to five points.
That was true of an *albedo* change and it will not be true of a *light* change, because the LUT's split-tone acts on the grade's shadow and highlight ranges and a warmer key moves pixels between them.
Capture both with and without the LUT for this one.

### 2.7 The migration, with call-site counts

Small. Thirteen call sites carry the amber and eleven carry the violet and magenta.

| Delete | Sites | Becomes |
| --- | --- | --- |
| `accent` `#ff9a3c` | 4 | `hero.blue` on the character; `sig.reward` where it was signalling |
| `accentDeep` `#e0651a` | 9 | `hero.blueDeep` on the character; `sub.trim` on props |
| `token` `#ff6bd6` | 6 | `sig.ally` `#4DE2FF`. Collectibles are ally-coloured or reward-coloured, never a third hue |
| `node` `#7c6bff` | 5 | `hero.blueDeep`, and the pale-core treatment the bible already mandates for it |
| `nodeGlow` `#a99bff` | 7 | `sig.ally` at `GLOW.source` |
| `gold` `#e8b84b` | 1 | `sig.rewardDeep`, emissive and small solids only |
| `rockAccent` `#c3a8dd` | 0 | delete |
| `flowerCentre` `#ffd24a` | 2 | `sig.reward`, or delete the flowers' warm centre entirely |
| `soil` `#6b4d31`, `soilDeep` `#8a6440` | 2 | `sub.brick` family. There is no earth in a manufactured world |
| `caveRock` `#5b6478`, `caveRockDeep` `#3a4154` | - | already in family. Keep, rename into `sub.` |

**[REC] `helmet` `#2f6fc4` becomes `hero.blue` `#2F7AD2`,** which is 0.035 brighter and 0.016 more saturated.
The note on `helmet` explaining its 0.406 placement in the empty gap is a value argument about separating it from `accentDeep`, and `accentDeep` is being deleted, so the constraint that produced 0.406 no longer exists.
The open note under it - that it reads more lavender than cobalt on the head - is the environment's cool wrap plus the shell preset desaturating it, and it gets better once the shell stops being warm and the key gets warmer, both of which are in this document.

---

## 3. Animation

`05-character-vfx.md` section 6 is a good implementation and this section does not repeat it.
What follows is the four rules that *generate* those numbers, so a second character or a new beat can be authored without asking someone which value to copy.

### 3.1 The source rule, made operational

**[DOC]** Jamie Smith, Principal Animation Director, Team ASOBI, on the PlayStation Blog:

> "I pay close attention to 'playfulness.' When creating animations, we **model how children express joy, like jumping up and down with excitement**, to elicit jubilant feelings among players."

**[DOC]** The Japanese version of the same interview is fuller and contains the operative clause:

> "Childlikeness is very important. When we make animation, we put in a child's acting - childlike performance like jumping for joy - and that connects strongly with the fun the player feels.
> **Children have a lot of energy in movement and emotion**, so we want to value that element."

**[DOC]** Smith again, elsewhere, on what the bots do with that energy: they "wear all of their emotions on their sleeves. If they're excited, you'll see them. **They won't be able to control themselves**", and "we imagine them as like children in a sense". His stated style keywords are "fast, frantic, and fun".

**[DOC]** And the other half, from the VR era and worth keeping because it is a constraint rather than a mood: "exaggerated animations, similar to classic cartoons, did not bode well in VR", and timings had to be adjusted.
Plus the boss inversion - a scary, intimidating arrival, then weaknesses appearing that make them "vulnerable and a little bit silly".

That is usually treated as a mood note. It is a **mechanical** instruction and it says where motion originates.

> **A child expressing joy moves their whole body. An adult expressing joy moves their arms.**
> Therefore: every emotional beat starts as a **root** transform. Limbs report it; they never initiate it.

The three channels a beat is allowed to use, in order:

1. **Root vertical displacement.** Jumping up and down on the spot is the actual reference behaviour. Amplitude is the intensity dial.
2. **Repetition.** Joy repeats. A single big gesture reads as an adult; three small ones read as a child. Frequency is the second dial.
3. **Departure from the vertical axis.** Lean, tilt, roll. The third dial, and the one that carries mischief rather than joy.

**[DOC] "They won't be able to control themselves" is a spring specification, not a mood note.**
A character who cannot contain an emotion is one whose motion **overshoots and rings** rather than arriving and stopping.
That is the same statement as 3.4's zeta ladder, made by the animation director, and it is the reason the whip tier is allowed to sit at 30 to 60% overshoot when every animation instinct says to damp it.

**[DOC] And there is one public hint that a good deal of this lives in code rather than in clips.** A Team ASOBI gameplay programmer, in the same Japanese interview: animators express cuteness by setting poses, but since cuteness is the game's point, "there's a lot that can be done in code beyond animation".
That is the only public support for the procedural, spring-driven approach `05-character-vfx.md` takes, and it is worth having, because that architecture is otherwise an inference.

**[REC] Two prohibitions that fall straight out of it.**
No emotional beat is expressed by an arm gesture alone - if the root is not moving, the character is not feeling anything.
And no beat is expressed by the face alone: **[DOC]** the character has LED eyes and **no mouth**, so the face has roughly seven states and cannot carry a performance. The face confirms a beat the body is already playing.

### 3.2 The timing law: three constants and nothing between them

**[REC]** Every timed thing in this game belongs to one of three classes, and the durations between them are empty on purpose.

| Class | Duration | What is in it | Interpolation |
| --- | --- | --- | --- |
| **Snap** | **0 to 33 ms**, 0-2 frames | Anything the player caused. Takeoff stretch onset, contact squash, hit-stop, impact flash, expression swap | None, or a 2-frame ramp. Never a curve. |
| **Beat** | **130 to 250 ms** | The readable event. Landing rebound to its overshoot peak, screen shake, collect ring, blink, head nod | A spring at zeta 0.55-0.70 |
| **Ring** | **300 to 1500 ms** | Consequence. Antenna whip, cape settle, debris, dust dispersal | A spring at zeta 0.15-0.35 |

> **The gap between 250 ms and 300 ms is the whole rule.**
> A feedback event that takes 400 ms reads as **lag**. A consequence that finishes in 400 ms reads as **stiff**.
> Anything landing in the empty band is in the wrong class, and the fix is to move it to a class rather than to retune it.

`05-character-vfx.md`'s timing table already obeys this, and its own annotation of the exceptions - "no, and correctly so" against chunks at 750 ms and the antenna at 1412 ms - is this rule discovered empirically.
Stating it forward means the next effect does not have to rediscover it.

**[DOC] The 250 ms ceiling on feedback comes from the reference and it is not arbitrary.** Astro's feedback never lingers.
The distinction the existing spec draws is the correct one and belongs here: the ceiling applies to things that **tell** you something, not to things **being** things.

### 3.3 Anticipation is an input-latency budget

Anticipation is 3-5 frames of counter-motion before a big action, and a game cannot anticipate an action the player has not taken.

> **[REC] The rule: anticipation is available exactly as far ahead as the action is already known.**

| Action | Known in advance by | Anticipation |
| --- | --- | --- |
| Buffered jump | `JUMP.bufferTime` 0.12 s = 7 frames | **3 frames**, free |
| Scripted beat: revival, portal entry, lesson complete | the game initiated it | **4 frames** |
| Unbuffered jump | 0 frames | **none**, and a substitute |

The substitute is the piece worth generalising.
On frame 0 the root is already rising while the knees are still folding and the feet trail below their rest.
**That is what anticipation looks like from the outside, and it costs zero latency**, because it is the *lower* body lagging rather than the whole body pre-moving.
The general form: **when you cannot anticipate, lag the part furthest from the action instead.**

### 3.4 Overshoot: what is springy and what is snappy

Every settle overshoots and returns on a damped spring, never on an easing curve, because a spring handles interruption and a curve does not.
Overshoot is `exp(-pi zeta / sqrt(1 - zeta^2))` and depends on `zeta` alone; speed depends on `omega` alone.

**[REC] The ladder, and the rule that generates it: `zeta` falls with how loosely a part is attached, not with how important it is.**

| Tier | Members | zeta | Overshoot | Reads as |
| --- | --- | --- | --- | --- |
| **Structural** | root squash, chest, head, feet | **0.55 - 0.70** | 5 - 13% | firm. It is one object. |
| **Appendage** | hands, ear pods, shoulder pads | **0.45 - 0.55** | 16 - 20% | rubber, attached |
| **Whip** | antenna, cape segments, any tail | **0.15 - 0.35** | 30 - 60% | loose, and the mischief lives here |
| **Contact** | foot IK, ground alignment | **1.00** | 0% | never overshoots. A foot that overshoots is a foot inside the floor. |

**[REC] `omega` rises along a whip, and that is what makes it a whip.**
The antenna's base runs at 11.8 and its tip at 14.5, so the tip arrives before the base and the chain reads as a lash rather than as a hinge.
Inverting that - a slow tip on a fast base - reads as a wet noodle. This is the one place in the spring table where the direction of the gradient carries the entire read.

**[REC] What is snappy, stated as a list, because it is shorter than the springy list.**
Contact squash onset, expression swap, hit-stop entry and exit, impact flash, screen-shake onset, foot plant.
Everything else is springy.
A snappy thing that gets a spring becomes mush; a springy thing that gets a snap becomes a robot, which in this game is not a compliment.

### 3.5 The squash budget is a scene budget

The missing rule, and it is the one that stops a character reading as jelly.

> **[REC] One part squashes per beat, and it is the root.**
> Every other part expresses the same beat through **rotation and lag**, never through scale.

Volume is preserved exactly by `sx sy sz = 1`, with `sx = lateral / sqrt(s)` and `sz = 1 / (lateral sqrt(s))`.
`SQUASH.lateral = 1.10` biases the widening sideways, which is what a moulded shell dropped on a floor does and what reads best from a camera that is almost always behind.

| Beat | Y scale | Frames | Class |
| --- | --- | --- | --- |
| Takeoff stretch | **1.18** | 2, ramped | snap |
| Fall stretch | 1.00 to **1.06** | tracks `|vy|` | continuous, not a spring |
| Contact squash | **0.62** at full impact speed, scaled by strength | 0, instant | snap |
| Rebound to overshoot | **1.095** | to 245 ms | beat |
| Settle | 1.000 | 313 ms | beat |
| Idle breath | **1.035 / 0.965** | 2.2 s cycle | ring |

**[DOC]** The reference band is takeoff Y x1.15-1.25 and landing Y x0.7-0.8. 0.62 is deeper than the band and only at maximum impact speed; at a typical landing the value is about 0.867, slightly shallower. A range that straddles the band is more expressive than a fixed value inside it.

### 3.6 Idle, and the thing nobody has specified: the world idles too

**[DOC]** Idle is never static: 3-5% breathing on about a 2 s cycle, plus a random look-around or fidget every 4-8 s, and the mischief lives in the fidgets.
`05-character-vfx.md` builds all of it and there is nothing to add for the character.

**[REC] The rule that has never been stated is that the *world* is subject to the same requirement**, and this world fails it.
Every static prop in frame is a prop the eye finishes reading and then discards.

The constraint is screen-space and it decides which objects can idle at all.
**[CALC]** A motion is visible when its screen amplitude is at least **2 px**:

| Layer | Distance | mm per px | Minimum visible motion | Verdict |
| --- | --- | --- | --- | --- |
| Character and near props | 10.7 m | 6.92 | **14 mm** | idle everything |
| Deck dressing | 12 - 20 m | 7.8 - 12.9 | **16 - 26 mm** | idle the small stuff, cheaply |
| Perimeter frame | 25 - 40 m | 16 - 26 | **32 - 52 mm** | a 5 cm sway is a big move. Prefer a **light** that changes. |
| Backdrop arc | 60 - 130 m | 39 - 84 | **78 - 168 mm** | do not animate position at all |

> **[REC] Beyond about 30 m, idle is expressed as a change in emissive, not as a change in transform.**
> A distant monolith whose panel strip breathes between `GLOW.hold` and `GLOW.source` on a 6 s cycle is alive and costs one uniform. The same monolith swaying 5 cm is invisible and costs a matrix.

Ambient cycle frequencies, so the world does not pulse in unison: **[REC]** every ambient cycle gets a period drawn from `uniform(3.5, 9.0)` seconds and a phase from `uniform(0, 2 pi)`, seeded per instance.
Two objects sharing a period is a lighting flicker, not life.

---

## 4. The rig

### 4.1 Proportion, as a rule rather than a table

**[DOC] The only published proportion sheet is the 2021 "How to draw Astro" post, and it contains three instructions and no numbers.**

> Toshihiko Nakai, Concept Artist: his face "should neither be square nor round, but **something in between**".
> Miho Kinebuchi, 3D Artist: "make the size of his **head and hands** a little bit bigger".
> Mayu Kawaguchi, 3D Artist: "He has a **big head, like a baby**! Make sure his head looks big enough."

**[DOC]** Doucet on the origin, which explains the primitive vocabulary in section 5: at the AR stage "we didn't have any art, so we made prototypes out of **primitive shapes**", and the bots were "just robots made up of **cylinders with little eyes**"; "we gave them a Sony robotics style. But it was also important that they were endearing, so we gave them big cute eyes and **made them waddle like toddlers**."
**[DOC]** And the tangibility clause: "He also had to **feel tangible**... We looked at him as if he was a real-life robotics product."

**[DOC, reported from video rather than quoted]** Team ASOBI have said the head was aimed at looking like an old 1960s TV set, and that the world was then made blocky to match. Treat as reported.

**[DOC, negative] No numeric proportions exist publicly.** No head-to-body ratio, no unit scale, nothing.
**[OBS]** The 2.5-to-2.8 head-heights and 40-to-48% figures in `00-references.md` are measured off official renders at plus or minus 10% and are the best available. They are not Sony figures and must not be quoted as such.

**[DOC]** Big head, round belly, puffy diaper-like rear, compact frame, low centre of gravity.

Written as constraints a second character has to satisfy:

| Constraint | Range | This character |
| --- | --- | --- |
| Silhouette height in head-heights, **antenna excluded** | **2.4 - 2.9** | 2.52 |
| Head as share of silhouette height | **0.38 - 0.48** | 0.397 |
| Head width / torso width at the shoulders | **> 1.10** | 1.38 |
| Head width / max torso width at any height | **> 1.00** | 1.16 |
| Foot span / head width | **0.85 - 1.05** | 0.97 |
| Hand diameter / head width | **0.35 - 0.45** | 0.389 |
| Eye centre, down the face plate | **0.55 - 0.60** | 0.57 |
| Legs in head-heights | **0.6 - 0.8** | 0.70 |

**[REC] The head-over-torso inversion is the load-bearing one.** More than the head-height ratio, a head wider than the torso *at every height* is what makes a shape read as an infant rather than as a short adult.
It is also the one the current model got backwards, and the one that is easiest to lose again the moment a costume or a backpack widens the chest.
Assert it in `proportions.test.ts` as a width comparison across the whole vertical span, not at one height.

**[REC] Excluding the antenna from the silhouette height is a rule, not a convenience.**
A thin protrusion carries no mass and does not read as height. Including it gives 2.83 head-heights - correct on paper, wrong on screen.
The general form: **anything narrower than 0.10 head-widths does not count toward any proportion measurement.**

### 4.2 Limb segmentation

> **[REC] Two segments per limb, maximum, and the joint between them is never visible hardware.**

| Limb | Segments | The joint between them |
| --- | --- | --- |
| Arm | upper capsule + spherical mitten | **Nothing.** The mitten floats; there is no forearm and no elbow. |
| Leg | shin capsule + foot | Absorbed into the capsule's own fillet. There is no knee. |

**[OBS] This is what makes the reference read as a toy rather than as a mech.** Every visible articulation is one more thing that reads as engineering, and engineering reads as adult.
The character has a full joint hierarchy internally - `05-character-vfx.md`'s is correct - and none of it is visible.

### 4.3 Where hardware is visible, and where it is not

Three states, and each part is in exactly one.

**Hidden.** Every joint *inside* a limb or the torso. Absorbed into a fillet. The limb reads as one soft object that bends.

**Floating.** Shoulders and hips. There is no visible connection at all: a gap of clear air, and the **negative space is the joint**.
**[OBS]** `00-references.md` records that arms are often "floating", disconnected from shoulders, and this is the single most fragile part of the silhouette read - arms pinned to the sides merge into the torso and the character becomes one blob.
**[REC]** The gap is a hard minimum: **3 px of clear sky between the mitten and the torso at rest**, which at 10.7 m is **21 mm**, and the existing test's 0.010 m^2 enclosed wedge is the area version of the same requirement. Keep both.

**Visible hardware.** Exactly four interfaces, and they are exactly the four things that must read as **detachable**.

| Interface | What sells it |
| --- | --- |
| Head to torso, the collar | A ring in `steel.anodised`, with a reveal gap all the way round |
| Backpack to back | **[DOC]** the reference names backpack hardware that looks physically detachable as what sells "toy". Two visible fasteners plus a reveal. |
| Ear pod to head | A turned boss and a reveal |
| Antenna to head | A stepped base in `steel.anodised` |

**[REC] The detachability spec, numerically, because "looks detachable" is not implementable.**

> A part reads as detachable when **all four** hold:
> 1. A **reveal gap** at the interface of at least **2 px** at the read distance - **14 mm** at 10.7 m. Not a seam line: actual clear air the light passes into.
> 2. A **proud lip** on the smaller part of at least **1 px**, **7 mm**, so the interface has a bright edge and a dark one.
> 3. The two parts are in **different material classes** - a moulded shell against plated hardware, never shell against shell.
> 4. **One visible fastener or one turned ring** at the interface. Two if it is load-bearing. Never more than two.

The fourth clause is where the restraint rule bites: a part with six fasteners is a greeble, and the reference's props have one or two.

### 4.4 Silhouette rules

**[DOC] The acceptance test comes from the director and it is simpler than any of ours.**
Doucet: "No mouth, no stretchy faces" - the eyes should be "the most expressive thing" - and "you end up with a silhouette that is really, really simple. **Even a kid can draw Astro**."

That is a better statement of the requirement than a pixel count, and it is worth keeping beside the pixel counts as the thing they are approximating.
It also settles the face: with no mouth and no deformation, the eyes are the entire performance surface, which is why `05-character-vfx.md` is right to spend a whole section on them and why section 3.1 forbids a beat carried by the face alone.

The five checks in `05-character-vfx.md` are correct and should stay: head mass at least 38% of height, head-over-torso inversion, an enclosed white wedge at each arm, a 0.06 m gap between the feet, and one asymmetric feature.

**[REC] Three additions, all measurable on the same 32 px black render.**

6. **No two silhouette features closer than 2 px at 32 px tall.** At 32 px against a 1.36 m character, 2 px is **85 mm** of world space. Two features closer than that merge into one lump at gameplay distance and the silhouette loses a read it was paying geometry for.
7. **Exactly one asymmetric feature.** Not zero - a perfectly symmetric toy is a product shot. Not two - two asymmetries read as damage. The antenna at `x = 0.200` is it.
8. **The widest scanline of the whole silhouette is in the top 40%.** Stronger than check 2, which only compares the top 40% against the middle 40%, and it is the one that catches a backpack or a cape widening the mid-body past the head.

**[REC] Run all eight at 32 px, not at full resolution.** The test is about what survives when detail is gone, and a check that passes at 1080 px and fails at 32 px is a check that was never testing the silhouette.

---

## 5. The model

### 5.1 Primitive vocabulary

**[DOC]** The reference's own construction is modular toy blocks: designers block out in primitives and artists rebuild platforms as reusable modules that connect at multiple angles like toy blocks.
**[DOC]** And its geometry, by the project's own reading of the reference art, is "discs and boxes" - almost all of the richness is printed, not modelled.

**[REC] The allowed list. Eight forms, and everything in the world is one of them.**

| Form | Made by | Used for |
| --- | --- | --- |
| Rounded box | `chamferedBox`, drei `RoundedBox` | Decks, blocks, plates, the head |
| Capsule | `pill` | Limbs, masts, struts, rails |
| Sphere | | Hands, tips, bulbs |
| Squircle extrusion | `beveledExtrude`, superellipse `n = 4` | Face plates, panels, anything that must be "neither square nor round" |
| Tapered superellipsoid | | The torso, and only the torso |
| Bevelled lathe | `latheProfile`, `roundedCylinder`, `puck` | Discs, plinths, collars, pucks, the island |
| Torus | | Rims, rings, every place two lathes would meet at 90 degrees |
| Truncated cone | `shard` with a flat apex | Crystals, cones. **A mathematically sharp point is not something a mould can produce.** |

**[REC] The banned list, and it is a hard ban rather than a preference.**

- **A plain `BoxGeometry`.** Every box is a rounded box. `02-materials.md`'s violation table lists the ramp, the helmet crest and the cape as plain boxes and it is still open.
- **A plain `CylinderGeometry` with sharp caps.** Every cylinder is a bevelled lathe or a capsule. The plinths, the node pillar and the ear pods are all still this.
- **A `ConeGeometry` with an apex.** Truncate it.
- **A zero-thickness `PlaneGeometry` with a visible edge.** The cape is still this and it is round 1's F4, still open.
- **Any mesh with a 90 degree edge**, anywhere, for any reason. **[DOC]** The reference's rule verbatim: never a 90 degree hard corner on a plastic object; every edge takes a bevel that catches the key as a bright line.

**[REC] And the geometric fact that catches the most people, already learned here the hard way and worth stating as a modelling rule:** for a lathe seen from outside and above, **the profile stop of maximum radius IS the lower silhouette**, and everything below it is behind it or back-facing.
A lathe segment is one conical band with one normal, so lighting cannot produce a gradient down it however many stops the profile has. A value ramp down a skirt has to be authored per stop.

### 5.2 Bevel policy, re-derived at the shipping camera

Superseding `02-materials.md` section 6.1, whose floors were computed at FOV 55 and 8 m.

> **[REC] Fillet radius `r = k * d_min`**, `k = 0.08` hero, `k = 0.05` world.
> **Floor: 2 px at the read distance.** **Ceiling: `0.25 * d_min` on world geometry, uncapped on the character.**

| Read distance | mm per px at FOV 40 | Bevel floor |
| --- | --- | --- |
| **10.7 m**, the character and anything he touches | 6.92 | **14 mm** |
| 12 m, deck and near dressing | 7.76 | **16 mm** |
| 20 m, midground | 12.9 | **26 mm** |
| 40 m, perimeter | 25.9 | **52 mm** |
| 60 m+, backdrop | 38.8 | **78 mm** |

**[REC] The consequence that is new, and it removes the ambiguity `02-materials.md` had to leave open.**
Combining the floor and the ceiling: a part can only carry a legible bevel if `0.25 * d_min >= floor`, that is if **`d_min >= 4 x floor`**.

> **A part whose smallest dimension is under 4 times the bevel floor cannot be chamfered. It must be an all-fillet form instead - a capsule, a lathe or a sphere.**

At 10.7 m that threshold is **56 mm**.
The antenna rod at `d_min` 36 mm is under it and must be a capsule, not a chamfered cylinder - `02-materials.md` reached the same conclusion by exempting it from the rule, which left it as a sharp-edged cylinder.
The ear pods at 60 mm clear it, just, and get a 14 mm fillet.
The lock plate keyhole slot at 10 mm is under it and must be a rounded slot cut through, or nothing at all.

### 5.3 Panel line, seam and mark policy

**[REC] One rule replaces every per-mark millimetre figure in `02-materials.md` section 7.**

> **A mark is at least 2 px wide at the distance it is read, or it does not exist.**
> Marks may only be authored against a stated read distance, and the distance goes in the call.

| Mark | Old spec | At 10.7 m | At 12 m deck | At 20 m | At 60 m |
| --- | --- | --- | --- | --- | --- |
| Panel line / seam groove | 2.5 mm | **14 mm** | **16 mm** | **26 mm** | **78 mm** |
| Parting line | 1.0 mm | **14 mm** | 16 mm | - | - |
| Ejector circle | 4-9 mm dia | **21 mm** dia, 3 px | 24 mm | omit | omit |
| Vent slot width | 2.5 mm | **14 mm** | 16 mm | omit | omit |
| Vent slot pitch | 6 mm | **35 mm** | 40 mm | omit | omit |
| Reveal gap at a detachable interface | - | **14 mm** | - | - | - |

Every old figure is between five and fourteen times too small, and every one of them was authored, rendered, and invisible.
`decalTextures.ts` found this independently for the deck and its note generalises exactly: *a mark's width has to be specified against the resolution it will be seen at, and 2.5 mm is a specification for an object held in the hand.*

**[REC] Foreshortening, which is why the deck kept losing detail after the character's marks were already fixed.**

The camera sits 10.7 m back and 4.3 m up, so it looks down at `atan(4.3 / 10.7) = 21.9` degrees.
A **vertical** surface is seen nearly frontally and the table above applies directly.
A **horizontal** surface is compressed in the depth axis by `sin(21.9 deg) = 0.373`.

**[CALC] That reconciles the two independent measurements this project has, which look like they disagree by a factor of three and do not.**
`decalTextures.ts` measured a deck at about 26 mm per screen pixel and this document computes 7.76 mm at 12 m.
`7.76 / 0.373 = 20.8`, and the difference between 20.8 and 26 is the difference between the deck's mean distance and the 12 m the note used.
Both numbers are right. One is across the deck and one is down it.

> **[REC] A mark on a horizontal surface must be roughly 2.7 times longer in the depth axis than the same mark on a wall.**
> Marks on the floor are **anisotropic**: a 16 mm groove running left-to-right is legible, and the same groove running away from the camera is 6 px of length rather than 43.
> Seam grids on a deck should therefore favour the cross-camera direction, and a perfectly square panel grid spends half its ink on lines the camera cannot resolve.

This is also the honest reason `PANEL_FILL` had to go to 2048 while the tiling set stayed at 1024, and it generalises: **the deck is the surface with the least screen resolution per metre in the whole game, not the most.**

**[REC] The seam is a three-part mark, not a line, and this is the trick that makes a one-sided albedo map produce a two-sided read.**
`decalTextures.ts` already implements it for the deck and it is the right construction everywhere: a **dark inset core**, a **bright proud lip** on the key side, and a **panel tone** either side that differs by one rung of a six-rung ladder.
The bright lip is most of what the eye uses to read a seam as a moulded join rather than as a scratch.
A map that can only multiply toward black has no brighter-than-white to spend on the lip, so every panel gives up the top of its range instead - the ladder starts at 0.016 below the surface's own value rather than at zero.

**[REC] Restraint, at the corrected granularity.**
A face carries the seams that divide it into panels, plus **at most one mark inside each panel**.
Six marks exist in the whole world - seam, parting line, ejector circle, vent, decal, draft - and no object carries more than three of them.

### 5.4 Thickness, flatness, and the scale of detail

**[REC] Thickness minimum.** Nothing is thinner than **3 px at its read distance**, and nothing is thinner than **twice its own fillet radius**.
At 10.7 m that is **21 mm**. The cape at 30 mm clears it; a zero-thickness plane does not, which is round 1's F4.

**[REC] What is allowed to be a flat plane.** Four cases, closed list.

1. A **decal**, offset 1 mm along the normal with `polygonOffset: true` and `polygonOffsetFactor: -1`.
2. The **walkable collider lid**, which `Terrain.tsx` requires to stay geometrically flat, with its visible rim supplied by a separate torus that the collider never touches.
3. The **visor quad** inside its face plate, because it is a shader surface behind a real bevelled plate rather than a surface in its own right.
4. **Lightformer cards**, which are not in the world.

Everything else has thickness, including grass blades, including the cape, including anything the camera can catch edge-on.

**[REC] The scale of surface detail, in head-widths, which is the unit this art is authored in.**

The head width is **0.72 m** and it is the ruler.

| Feature | In head-widths | In metres |
| --- | --- | --- |
| Smallest legible mark, on the character | **1 / 50** | 14 mm |
| Structural seam pitch on the character | **0.15 - 0.25** | 0.11 - 0.18 m |
| Structural seam pitch on world plastic | **0.4 - 0.9** | 0.29 - 0.65 m |
| Panel, on a deck | **0.5 - 1.0** | 0.36 - 0.72 m. `PANEL_FILL_CELL` is 0.5 m, inside the band |
| Brick unit face | **0.78 x 0.35** | 0.56 x 0.25 m |
| Brick course | **0.43** | 0.31 m. The character is 4.4 courses. |
| A prop the character can pick up | **1 - 2** | 0.7 - 1.4 m |
| A prop that frames a space | **4 - 10** | 3 - 7 m |

**[REC] The oversize rule, and its exception.**
**[DOC]** Props are consistently oversized relative to the character, reinforcing "child among toys".
For a prop with a real-world referent: `size = real_size / 1.7 * 1.36 * 1.8`, the 1.8 being the oversize factor.

**The exception, and it is worth knowing that it exists rather than being surprised by it.** Architecture and repeating surface pattern are sized by **legibility**, not by the oversize rule, and legibility usually wins by a further factor of 2 to 3.
A real brick course of 75 mm through the oversize rule gives 108 mm, which is 15 px tall with a 1.4 px joint and is illegible; the legibility floor forces 0.31 m, which is 2.9 times larger again.
When the two rules disagree, **legibility wins and the object gets bigger**, which is also the direction the world rule prefers.

---

## 6. Sources

Fetched for this document. `00-references.md`'s table is not repeated; these are the ones it did not have, plus the corrections to the ones it did.

### Primary, first-party

| Source | What it establishes here |
| --- | --- |
| [PS Blog - The evolution of Astro Bot's adorable character design](https://blog.playstation.com/2024/08/26/the-evolution-of-astro-bots-adorable-character-design/) (Doucet, Aug 2024) | The blue livery as a **separation** decision. The **silver head plating** reflecting "jungles to oceans". Blue LED friend / red LED enemy as a trademark. Vinyl substituted for hair and fabric. Primitive-shape origins. |
| [PS Blog - Team Asobi presents: How to draw Astro](https://blog.playstation.com/2021/11/04/team-asobi-presents-how-to-draw-astro/) (Nakai, Kinebuchi, Kawaguchi, Nov 2021) | The only published proportion guidance. "Neither square nor round." "Head and hands a little bit bigger." "Big head, like a baby." The "iconic blue livery pattern". |
| [PS Blog - How Team Asobi created a unified vision for fun](https://blog.playstation.com/2024/09/09/astro-bot-how-team-asobi-created-a-unified-vision-for-fun/) (Smith, Sept 2024) | "We model how children express joy, like jumping up and down with excitement." |
| [PS Blog JP - the same interview, fuller](https://blog.ja.playstation.com/2024/09/05/20240905-astrobot/) (Smith, Murakami, Brueckner, Sept 2024) | "Children have a lot of energy in movement and emotion." The programmer's "a lot that can be done in code beyond animation". Brueckner's disclaimer that the design is not logical. |
| [PS Blog - Inside the art and animation of Astro Bot Rescue Mission](https://blog.playstation.com/2019/01/24/astro-bot-rescue-mission-inside-the-art-and-animation-of-japan-studios-ps-vr-hit/) (Brueckner, Smith, Jan 2019) | "Digital DNA... printed circuits board patterns and LED faceplates", applied down to the rocks. Cartoon-exaggerated timing failing in VR. The boss inversion. |
| [CGMagazine - Team Asobi interview](https://www.cgmagonline.com/interviews/team-asobi-nicolas-doucet/) (Doucet, Jul 2024) | **"Contrast is our top priority, followed by adding bevels and a bit of detail."** The messiness phase and the clean-up. 60fps above resolution. |
| [Geek Culture - Astro's Playroom interview](https://geekculture.co/geek-interview-unveiling-the-secrets-of-astros-playroom-playstation-5-with-japan-studios-nicolas-doucet/) (Doucet) | **"Inside the console, there should be no organic materials... however, you can find a carbon fibre. You can find crystals."** Materials define haptic feedback. |
| [Push Square - The Making of Astro Bot](https://www.pushsquare.com/features/interview-the-making-of-astro-bot-the-ps5s-next-great-exclusive) (Doucet) | "No mouth, no stretchy faces." "Even a kid can draw Astro." |
| [Screen Rant - Jamie Smith interview](https://screenrant.com/astro-bot-interview-jamie-smith/) | "Fast, frantic, and fun." "They won't be able to control themselves." "We imagine them as like children." |
| [CEDEC 2025 - physics and graphics behind ASTRO BOT](https://cedec.cesa.or.jp/2025/timetable/detail/s67e2ae6a47782) (Yamaguchi, Yoshida) - report at [CGWorld](https://cgworld.jp/article/202510-cedec-astrobot.html) | SDF ray-marched fluid at half res with normals from the SDF gradient, on an **async** queue for ~2 ms. GPU-tessellated water. Triplanar fluid materials with velocity-driven UV scroll. Voronoi destruction. 7,500 Havok particles. 60fps as a bug bar. |
| [CEDEC 2025 - Astro Bot's level design, 30 principles](https://cedec.cesa.or.jp/2025/timetable/detail/s67e2aff9bb974) (Yatoku) - reports at [4Gamer](https://www.4gamer.net/games/803/G080391/20250724058/) and [GameMakers](https://gamemakers.jp/article/2025_08_22_114068/) | Gameplay areas differ from buildings by **shape and colour**. Depth via identical shapes at identical sizes. Important things centre-frame. Optional paths deliberately less salient. |
| [Digital Foundry, PS5 Pro patch 1.012](https://x.com/digitalfoundry/status/1891907462917214214) (Mackenzie, Feb 2025) | TAA swapped for PSSR, which names the base game's AA as **TAA** and the reflection technique as **screen-space**. Internal targets 1368p / 1872p. |
| [4Gamer - GDC 2025 report](https://www.4gamer.net/games/803/G080391/20250321060/) | The team "struggled with visuals that reconcile readability and beauty". |

### Vendor and engine references, for section 1.6

| Source | What it establishes here |
| --- | --- |
| [Google Filament, Materials](https://google.github.io/filament/Materials.md.html) and [Filament docs](https://google.github.io/filament/Filament.md.html) | Metallic is binary. Metal base colour in [170..255] sRGB. Roughness remap `alpha = perceptualRoughness^2` and the 0.089 half-float clamp. IBL quantisation aliasing at low roughness. **The clear coat cost warning.** Plastics/glass at 4-5% F0, IOR 1.5-1.58. Note: its metal table's silver and aluminium rows are linear values mislabelled sRGB, and its material-chart PDF 404s. |
| [Sebastien Lagarde, Feeding a physically based lighting model](https://seblagarde.wordpress.com/2011/08/17/feeding-a-physical-based-lighting-mode/) (2011) | The metal linear-RGB table Unreal and Unity republish. Chromium `0.5496, 0.5561, 0.5543`. The DONTNOD albedo chart, including bricks at sRGB median 131. |
| [Adobe / Substance PBR Guide](https://substance3d.adobe.com/tutorials/courses/the-pbr-guide-part-1) | The albedo range rule, **30-50 to 240 sRGB**, and "Coal is dark, but it is not 0.0 black." Dielectric F0 0.02-0.05, conductor 0.5-1.0. The sRGB metal chart. "Roughness is a highly subjective area." |
| [physicallybased.info](https://physicallybased.info/) | The only source publishing **both chromium and stainless steel**, tagged `srgb-linear`. Derived from refractiveindex.info. |
| three.js 0.185.1 source, read locally | `roughness = max(roughnessFactor, 0.0525)`, the same clamp on clearcoat roughness, `geometryRoughness` added on top. `PMREMGenerator._lodMax = floor(log2(cubeSize))`. `MeshPhysicalMaterial` always defines `PHYSICAL` and therefore `USE_SPECULAR`. `aomap_fragment` applies AO to indirect terms only. `envMapIntensity` scales diffuse and specular IBL alike. |
| Brick Industry Association TN10, BS EN 771-1 | UK brick 215 x 102.5 x 65 mm on a 225 x 112.5 x 75 mm coordinating module with a 10 mm joint. US modular 3 courses to 8 inches. **Recessed mortar 2-5 mm below the face**, 3-7% of course height. |
| Marmoset material chart, pixel-sampled | The only usable roughness anchors for plastic: glossy 0.29, rough 0.54, satin 0.64, rubber 0.63, rough steel 0.09, chrome 0.00. Captioned "more of a beginning point, not a rigid/absolute reference." |

**Two corrections worth keeping so nobody re-derives them.**
The "50 to 243" albedo range is routinely attributed to Epic and is **not Epic's** - Unreal publishes no sRGB range. It is the Lagarde/DONTNOD chart, where 243 is snow and 50 is coal.
And **three.js has no parallax occlusion mapping**; `ParallaxShader.js` has been removed and only the WebGPU example remains.

### Documented negatives, so nobody re-searches them

- **No source states that Astro Bot uses a clear coat.** None for subsurface, anisotropy, IOR, or any roughness / specular / metallic value either. The two-lobe model in this project is a reconstruction.
- **No official hex values exist**, for the livery or for anything else. The circulating `#003791` is Sony's corporate blue with no link to the character.
- **No source describes the palette as blue-and-orange complementary.** Not one, in any language, first- or third-party.
- **No GI method is documented** for either game. Nobody has said baked, probe or otherwise.
- **No frame capture or GPU study exists**, and cannot: both games are PS5-exclusive with no PC build.
- **Only three Astro sessions exist in the whole of CEDEC history** - 2025 graphics/physics, 2025 level design, and **[CEDEC 2019, the art talk](https://cedec.cesa.or.jp/2019/session/detail/s5c9f93d548456.html)** by Yasuhiro Fujii, which is the only art-track Astro talk ever given, was covered by nobody, and whose slide PDF is behind a CEDiL login. **That is the single best unexploited lead in this whole area and it is worth an account.**
- **No numeric proportions, no animation timings, no spring constants, no squash-and-stretch amounts** appear anywhere. The animation record is philosophy-level only.
- One frequently-ranked page, `readomax.com`'s "Exploring the Art and Design of Astro Bot", claims a "blue, green and yellow" palette with a "golden yellow visor". It is uncited AI-generated SEO content, it contradicts the documented silver plate, and several other results propagate from it. **Do not cite it and do not let a future research pass rediscover it.**

### Two things to verify before anyone quotes them

- The base-PS5 **1440p-2160p dynamic resolution window** is corroborated across three secondary sources but was not read out of Digital Foundry's own words.
- Push Square's October 2020 claim that Astro's Playroom has "rudimentary raytracing... on glossy surfaces, like the metallic detail on Astro Bot's helmet" could not be corroborated and sits badly against the SSR finding. **It is probably wrong. Do not build on it.**

---

## 7. What the orchestrator should change first

Ranked. Each row is one commit, one falsifiable claim, one measurement.

**1. Bring back the head plate as a shallow plate, with its own environment map - not on a collar ring.**
`material.envMap = <dedicated 512 PMREM>` on `steelMirror` only, colour `#D3D8DA` rather than `#ffffff`, roughness `curvatureFloor(r, d)` rather than 0.06, geometry at `r >= 0.45` rather than a hemisphere.
This is first because one change fixes four things: it is the surface the reference actually documents; the showpiece gets a sharp reflection at every tier; `envMapIntensity` becomes live on the one material that needs it; and the "chrome has no call site after two rounds" deadlock breaks.
Both stated reasons for deleting the dome are addressed rather than argued with - a plate does not enclose the antenna, and at `#D3D8DA` / 0.124 the head-on reflection of the hottest card is 0.740 against a threshold of 1.45.
**Falsify by:** capturing `hub-character` and identifying the highlight strip *as a strip* in the reflection, and by `__dev.sample()` on the plate staying under 1.45 at `hub-backlit`. If you cannot see a shape, the map is too coarse or the roughness is too high.

**2. Add a horizon band to the mirror's environment, then take `STEEL_METALNESS` back to 1.0.**
One or two large cards at elevation 20-25 degrees in `atm.horizon` `#BDC9D4`.
A `Lightformer` environment contains only its cards, and a horizontal mirror seen from a camera 21.9 degrees up reflects the elevation band around +21.9 degrees - which in this rig is one card at 16.7 degrees and then nothing.
`metalness: 0.68` is a diffuse term restoring what a missing card took away, and its own note already says the fix is a light-rig change.
**Falsify by:** `__dev.sample()` on the inlay before and after, with `metalness` held at 1.0 in both. If the card is doing the work, the value rises without the material changing.

**4. Change the ground bounce Lightformer from `#9ecf6a` to `#AAB6AE`.**
One line. It is a green card that nobody could see and that the mirror is about to make visible, and section 2 removes green from the substrate anyway.
Do it in the same commit as 2 or immediately before it.

**5. Give the brick a channel per facing, and stop paying for the one that is filtered out.**
`masonry()` and `brickTexture.ts` already exist and already reached `specularIntensity` independently, which is the hard half.
What is left is the placement rule: on a **wall** the joint is relief - normal map plus bound occlusion - and on a **deck** it is print, because foreshortening puts a 0.06 m joint at 8.7 px on the first and 2.3 px on the second.
`brickTexture.ts`'s own measurement is the evidence: a lit deck's p5-p95 moved 0.0387 to 0.039 when the maps were switched on.
`normalStrength: 2.6` with `normalScale: 1.8` is the strongest relief in the project spent on the surface with the least screen resolution in the game.
**Falsify by:** rendering the deck with `normalScale` at 1.8 and at 0.4 and measuring the spread. If the difference is under 0.005 the normal map is not earning its texture.

**6. Desaturate the lawn. `#7dc244` to `#82A07E`.**
This is the fix three critique rounds have missed because all three were measuring value.
Chroma 0.649 to 0.212, display luma within 0.075 of where round 3 left it. Debt 3.15 to 0.84 across 60.8% of the frame.
**Falsify by:** the frame-weighted chroma debt, which needs `frame.mjs chroma` built first - it is about forty lines and it is the measurement this project has never had.

**7. Delete amber. `accent` and `accentDeep`, thirteen call sites.**
`hero.blue` `#2F7AD2` and `hero.blueDeep` `#1D4D8F` on the character; `sub.trim` on props.
Do it in one commit, because a half-migrated palette is a world with two schemes in it.
`gold` folds into `sig.rewardDeep` and survives only as emissive and small solids.

**8. Move the world's warmth from the albedo into the rig.**
`rock` `#bfbbb4` to `sub.deckTop` `#BABCBD`, holding display luma to one thousandth.
Then the key softbox to `#FFEBCF` and the key directional to `#FFE3AE`, and shrink the sky-wrap card from 14 x 9 to 10 x 6.5.
**Acceptance:** `__dev.sample()` on a lit deck at `hub-character` returning R-B between +6 and +12, with the shadowed deck below -18.
**Capture this one with and without the LUT.** A light change moves pixels between the grade's shadow and highlight ranges in a way an albedo change does not.

**9. Re-cut every mark on the character at 14 mm.**
Panel lines, parting lines, vent slots, reveals. Every figure in `02-materials.md` section 7 is between five and fourteen times too small because it was written for an object held in the hand, and the camera is 10.7 m away.
`decalTextures.ts` already fixed this for the deck and the same correction has never reached the character.
**Falsify by:** rendering the character alone at 1080 px from `hub-character` and finding each mark. If you have to zoom, it does not exist.

**10. Close the primitive violations, as one geometry commit.**
The ramp, the helmet crest and the cape are plain boxes or planes; the plinths, node pillar and ear pods are sharp-capped cylinders; the token cones have apexes.
The cape is round 1's F4 and is still open after three rounds.
Add the rule that resolves the case `02-materials.md` had to leave open: a part with `d_min` under **56 mm** cannot carry a legible bevel and must be an all-fillet form instead.

**11. Give the world an idle, expressed as emissive beyond 30 m.**
Every static prop in frame is a prop the eye finishes and discards, and beyond 30 m a 5 cm sway is invisible while a breathing panel strip is not.
Periods from `uniform(3.5, 9.0)` s, phases from `uniform(0, 2 pi)`, seeded per instance. Two objects sharing a period is a flicker, not life.

**12. Build `frame.mjs chroma`.**
It emits chroma against display luma for every pixel and reports one number: frame-weighted debt.
It goes last on this list and it is the tool that would have caught items 6 and 7 three rounds ago, which is the argument for building it now rather than after the next round asks the same question in prose again.
