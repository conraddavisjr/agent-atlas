# Reference brief: the ASTRO BOT look

This is the research the art direction is built from.
It exists as a file because the references were lost once already, and rebuilding them cost an afternoon.

**Read the labels.** Team ASOBI has published a great deal about physics and level design and almost nothing about lighting rigs, post-process stacks, or material parameters.
Everything below is marked:

- **[DOC]** documented in a talk, interview, or technical analysis, with a source.
- **[OBS]** inferred from frame analysis of public footage plus standard PS5-era practice. A hypothesis to dial in.
- **[REC]** a concrete three.js starting value. An engineering recommendation, not a Sony figure.

There are no published Sony numbers for bloom thresholds, roughness values, light ratios, or colour temperatures.
Anyone who tells you otherwise has invented them.
The one document that might contain them is the CEDiL slide PDF for session 3198, which is behind CEDEC membership.

---

## The one-line summary

The CEDEC 2025 speaker bio for Tai Yamaguchi, Principal Graphics Programmer at Team ASOBI, states his focus as visual expression that is **"touchable and enjoyable" rather than pure realism**.

That is the entire art direction. Every rendering decision is subordinated to *tactility*, not fidelity.
When a choice is between "more correct" and "more like a thing you could pick up", they pick the second one every time.

## Primary sources

| Source | Contains |
| --- | --- |
| [CEDEC 2025 — the physics and graphics behind ASTRO BOT](https://cedil.cesa.or.jp/cedil_sessions/view/3198) (Yoshida, Yamaguchi) · [CGWorld report](https://cgworld.jp/article/202510-cedec-astrobot.html) | The only real graphics talk. SDF ray-marched fluid, GPU-tessellated water, mesh deformer API, Voronoi destruction, Havok particle budgets, the 60fps rule |
| [CEDEC 2025 — 3D level design](https://game.watch.impress.co.jp/docs/kikaku/2033782.html) (Yamatoku) · [30 tips](https://gamemakers.jp/article/2025_08_22_114068/) | 30 explicit composition and readability rules |
| [GDC 2025 — The Making of ASTRO BOT](https://www.gamedeveloper.com/design/-it-s-okay-to-make-a-small-game-astro-bot-director-nicolas-doucet-says-tiny-ideas-contain-huge-potential) (Doucet) | Process and prototyping. No rendering detail |
| [GDC 2019 — Taming Technologies Behind ASTRO BOT Rescue Mission](https://www.gdcvault.com/play/1026072/Taming-Technologies-Behind-ASTRO-BOT) | Rendering optimisation, VR VFX |
| [Digital Foundry — Astro Bot on PS5](https://www.youtube.com/watch?v=1qhV6Tv1FkM) | DRS 1440p-2160p, locked 60fps, strong AA, high-quality DOF, real PBR, **no ray tracing** |
| [PS Blog — art and animation](https://blog.playstation.com/2019/01/24/astro-bot-rescue-mission-inside-the-art-and-animation-of-japan-studios-ps-vr-hit/) | "Playful and digital"; PCB patterns and LED faceplates as "digital DNA"; modular toy-block kits |
| [PS Blog — evolution of Astro's design](https://blog.playstation.com/2024/08/26/the-evolution-of-astro-bots-adorable-character-design/) | LED eye language, chrome dome, blue = ally / red = enemy, **hair and fabric replaced with vinyl** |
| [PS Blog JP — how to draw Astro](https://blog.ja.playstation.com/2021/11/04/20211104-astro/) | Official proportion rules |
| [Famitsu SGF2024](https://www.famitsu.com/article/202406/7939) | "Big head, round belly, puffy diaper rear"; toy-like impression via detachable-looking hardware |
| [Famitsu 2018](https://www.famitsu.com/news/201812/30166909.html) | The target look verbatim: futuristic glossy cool + Pixar-film warmth |
| [PS Blog — a unified vision for fun](https://blog.playstation.com/2024/09/09/astro-bot-how-team-asobi-created-a-unified-vision-for-fun/) | Animation director Jamie Smith: animate from **how children express joy** |
| [Andrew Lund III, environment artist](https://aclund3.artstation.com/resume) | Blockout to art pipeline; "view compositions and material breakup for gameplay engagement" |

---

## 1. The deepest rule: everything is a manufactured object

**[DOC]** When the team needed hair or fabric on a character, they **replaced it with vinyl** to preserve the robotic, manufactured design intent.
**[DOC]** Props carry printed-circuit-board patterns and LED faceplates as their surface "digital DNA".

This is not a surface treatment, it is a world rule. Grass is moulded rubber. Fur is flocking. Stone is a moulded stone-shaped object.
Water is the single exception, and it is simulated rather than stylised.

**Consequence for us:** the photographic ambientCG rock and dirt in `public/textures/` are the least Astro-like thing in the project. A real photograph of real granite is exactly what this world rule excludes.

**[DOC]** Do not reach for a toon shader. Digital Foundry confirms real, physically-based materials. The stylisation lives entirely in the *inputs* — albedo, roughness, palette, silhouette — never in the BRDF.

## 2. Lighting

**[OBS]** Product photography, not outdoor naturalism. Three signatures:

1. **One dominant, slightly warm key**, high and 30-45° off camera axis, with a **very large apparent source size**. Soft terminator, no hard specular pinpoints on curved plastic. A big softbox.
2. **A strongly coloured ambient fill, never grey.** This is the biggest single tell. The shadow side of white plastic always takes the level's dominant hue. Key:fill is a **low 2:1 to 3:1** — nothing crushes to black.
3. **A cool rim/kicker** hugging the top-back silhouette of the character and every hero prop, usually the complement of the key. This is what separates figures from backgrounds without outlines.

**Diagnostic:** sample the darkest pixel of a white shell in any Astro frame. Rarely below ~28-35% luminance, and always chromatic. Deep shadow is deliberately refused.

**[OBS] Shadows are coloured, not black** — typically the ambient hue at 35-55%. Contact shadow is a separate, tighter, darker darkening directly under the character; it is what glues the toy to the floor. Background layers frequently cast **no** shadows at all, only AO, which flattens them and pushes them back.

**[REC] starting rig** (tune against our own bloom budget, do not paste):

```js
key:  DirectionalLight('#fff2e0', ~3.2 in three's physical units), pos (6, 9, 5), castShadow,
      shadow.radius 6, bias -0.0004, normalBias 0.02, ortho tight to the playable pocket
fill: DirectionalLight(level hue e.g. '#8fd8ff', ~1.2), pos (-7, 3, 4), no shadow
rim:  DirectionalLight(complement e.g. '#a9e8ff', ~2.4), pos (-3, 6, -8)
amb:  HemisphereLight('#bfe9ff', '#4a3b6b', 0.9)   // saturated, never grey
```

**The environment map matters more than the lights.** Hand-placed `Lightformer` rects, never an HDRI photograph: you want controlled studio reflections in the clearcoat, and a photo injects the wrong palette. Include a **long thin strip light** for the elongated highlight streak that reads as product photography, and a **dark negative-fill card** so the clearcoat has something dark to reflect. An environment with no dark values is why gloss reads as generic shine.

**Cheap GI:** per-zone `LightProbe` (SH9) lerped as the camera moves gets most of the read for near-zero cost. Lightmap baking is the expensive correct version.

## 3. Materials

Six materials do effectively everything:

| Material | Base colour | Roughness | Metalness | Extra |
| --- | --- | --- | --- | --- |
| Hero white shell | near-white, near-zero saturation | **0.28-0.38** | 0 | clearcoat 0.6-0.85, ccRoughness **0.08-0.15**, fake SSS |
| Saturated ABS plastic | high chroma, value 0.55-0.80 | **0.30-0.45** | 0 | clearcoat 0.4-0.7, ccRoughness 0.10-0.20 |
| Soft rubber / matte | mid value, desaturated | **0.65-0.80** | 0 | clearcoat 0, subtle pebbling normal |
| Anodised metal | slight blue-grey tint | 0.22-0.40 | **0.85-1.0** | anisotropy 0.3-0.6 |
| Chrome | white | 0.02-0.08 | **1.0** | the reflection showpiece; give it the best env map |
| Felt / flocking | mid, desaturated | 0.85-0.95 | 0 | **sheen 0.8-1.0**, sheenColor *lighter* than base, low envMapIntensity |

**Two things stop it looking like flat matte polygons:**

**(a) Clearcoat roughness must differ sharply from base roughness.** Real moulded plastic is a slightly diffuse body under a smooth surface skin. The **double specular lobe** — broad soft body highlight plus tight bright clearcoat highlight — is what the eye reads as "plastic". One lobe reads as "matte 3D model".

> Our current `plastic()` preset is `roughness 0.35 / clearcoatRoughness 0.25`. Those are too close together to resolve as two lobes.

**(b) A roughness map, even a cheap one.** Perfectly uniform roughness kills it instantly. Low-frequency noise driving roughness ±0.08 transforms the read. Add a very low-amplitude normal map (0.15-0.3) for moulding texture, and **never a 90° hard corner on a plastic object** — every edge takes a bevel that catches the key as a bright line. Injection-moulded objects have parting lines, ejector-pin circles and draft angles.

**Subsurface on white shells**, in cost order:
1. Wrap the diffuse term: `saturate((NdotL + w) / (1 + w))` with w ≈ 0.35, tinting the wrapped region toward `#ffd9c0`. Five lines via `onBeforeCompile`.
2. A translucency term ported from the three.js fast-SSS example: distortion 0.15, power 3.0, scale 0.6, thickness 0.25.
3. **Never `transmission` for this.** It is for glass, costs an extra render target, and makes the character look like a gummy bear. Reserve it for actual glass domes and jelly.

**Matcap vs physical:** physical for anything the camera orbits. Astro's charm depends on the highlight *travelling across* the shell as the camera moves; a matcap locks it to view space and the toy dies. Matcaps are fine for distant background props and particles.

## 4. Post-processing

**[DOC]** High-quality depth of field is confirmed by Digital Foundry, and is the only post effect any technical source names explicitly. **[DOC]** No ray tracing. **[DOC]** Strong AA — aliasing destroys the moulded-object illusion faster than anything else.

- **Bloom** — generous but **threshold-gated high**. Only emissives and specular hits bloom; bright white plastic does **not** halo. *If your white plastic is blooming, the threshold is too low.*
- **Depth of field** — the diorama lever, but **not** a heavy tilt-shift. Near field stays largely sharp because near blur eats gameplay readability; the background is meaningfully defocused. Focus locked to the character. Far-field only.
- **Motion blur** — minimal to absent. At 60fps with a bright readable palette it is counterproductive. They express speed with **trails and ribbons** instead.
- **Chromatic aberration** — very subtle, frame edges only. If it is visible on the character at 100%, it is too much.
- **Vignette** — present and structural, part of the "stage under a spotlight" framing. Consider tinting it toward the level's shadow hue rather than black.
- **Film grain** — essentially none. It fights the clean plastic read. At most a dither to stop sky banding.
- **AO** — tight radius, moderate strength, doing *contact definition* between stacked parts, not atmospheric darkening. **Colour it a saturated dark tint of the palette, never black.** Black AO is what makes occlusion look like dirt.
- **Colour grade** — lifted blacks, mildly compressed highlights, boosted mid-chroma, and a **split-tone: cool shadows, warm highlights**, varying per world. This is where a lot of the magic lives. ACES desaturates, so follow it with a saturation lift. Avoid AgX — it is built for naturalism and will fight this look.

## 5. Palette

**[DOC]** Astro's PlayStation-blue livery exists specifically so he separates from the environment — the character's colour is a **readability decision**. **[DOC]** Blue LED = ally, red LED = enemy, globally and without exception.

**[OBS] Saturation is tiered, not uniform:**
- Character and interactive objects: highest chroma in frame. Astro is a **value anomaly** — the brightest, least saturated thing against a mid-value high-chroma world. That is the separation mechanism.
- Playable geometry: high chroma, mid value (0.45-0.7).
- Mid-ground dressing: chroma down ~25%, value pushed away from the platform band.
- Background layers: chroma down another 30-50%, value converging toward the sky, everything taking an atmospheric tint.

**[OBS] Value structure is the workhorse.** Each level runs a **three-band value system** — background, midground, gameplay — and **no band overlaps another**.

> **The acceptance test, and it is not a metaphor: desaturate a frame to greyscale and you must still instantly read where you can stand.**

**Warm/cool:** warm = light, reward, foreground. Cool = shadow, depth, background. Where a world is warm overall they invert it and light the character cool. The *contrast direction* is preserved, not the absolute temperature.

**Keep hazard red, collectible gold and ally blue constant across every world.** That is what makes the game readable without a tutorial.

## 6. Environment and level design

**[DOC] The 30 rules**, composition subset:

- Make the main path unmistakable; eliminate ambiguity about what is climbable.
- **Use distinct heights** — non-traversable cliffs are made visibly taller so they read as "not for you" at a glance.
- **Give playable and decorative geometry different shape languages.**
- **Communicate depth by repeating identical shapes at identical sizes in a row** — the size falloff of a known repeated form is the player's depth ruler.
- **Place important things at the centre of the area.** Centred objects are hardest to miss.
- **Use decoration to fill unused space**, which is how you define where the play space is.
- **Cluster physics props tightly rather than scattering them.** Dispersed props read as clutter; a tight clump reads as an inviting toy pile. *Clumps, not confetti.*
- **Change the camera angle per location** — high when judging a gap, low for horizontal traversal.
- **Keep the camera close** to preserve emotional connection and sense of speed.
- Give the player **~1 second** of visibility on an obstacle before they must react. One of the few hard numbers published: `leadDistance = playerSpeed × 1.0s`.

**[DOC] Modular toy-block construction.** Designers block out in primitives; artists rebuild platforms as reusable modules that connect at multiple angles "like toy blocks". For a browser game this is also the draw-call strategy: a small kit means aggressive instancing. Target **≤ 12 unique meshes per level**, with variation from per-instance colour and roughness rather than new geometry.

**[OBS] The diorama framing.** Finite floating islands or open-topped boxes in void or sky, with a visible edge of the world. You look slightly *down* into the box. **3-4 parallax depth layers**, each its own value band, each with progressively less material detail and no cast shadows. Props are consistently oversized relative to the character, reinforcing "child among toys".

**[REC] Narrow the FOV to 35-45°**, not 60-75°. A narrower FOV with a slight downward pitch is a large part of the diorama read. Our camera is at 55°.

## 7. VFX

**[DOC]** Havok Particles, **~7,500 particles at 60fps**. Particle-particle collision is approximate and applied only to small objects. **[DOC]** Cloth is a spring-mass explicit solver on a low-poly sim mesh driving a high-poly render mesh. **[DOC]** Destruction uses Poisson-disk sampling, Delaunay triangulation and perpendicular bisectors for Voronoi shatter, with **automatic fragment cleanup after a timeout**. **[DOC]** Dropping below 60fps is treated as a bug.

**[OBS] The particle character:**
- **Everything is a discrete solid object, never a smoke puff** — confetti flakes, coin discs, star sprites, cube shards, bubble spheres. Consistent with the manufactured-world rule. Soft volumetric smoke barely exists.
- **Impact pops** are a single-frame bright ring or starburst (the readability layer) plus 8-20 solid chunks with gravity and bounce (the tactility layer) plus 2-4 frames of screen shake.
- Particles have real physics, pile up, and are punchable.
- **Colour comes from the reward palette** — gold, white, blue — not the world palette, so juice always reads as feedback independent of environment.
- **Trails** are short ribbons, 0.1-0.25s, opaque-white head to transparent tail. This substitutes for motion blur.

**[REC] Juice timing, all ≤ 250 ms:** impact flash 1-2 frames · screen shake 80-150 ms with exponential decay · hit-stop 30-60 ms on significant impacts · squash on the frame of impact, stretch on the frame after. Astro's feedback never lingers.

## 8. The character

**[DOC] Proportion rules, official:**
- "Make the head noticeably large, like a baby's."
- "Enlarge the hands relative to the body."
- Face shape is "neither square nor round, but somewhere in between" — literally a **squircle**.
- Big head, round belly, **puffy diaper-like rear**. The silhouette evokes a toddler.
- Compact frame, low centre of gravity — a stated platformer-design decision.
- **LED eyes that change shape to convey emotion, and no mouth.** The only facial feature.
- A reflective chrome dome plate, used explicitly to show off environment reflections.
- Hair and fabric replaced with vinyl.
- Backpack hardware looks physically detachable, which is what sells "toy".

**[OBS] Measured from official renders (±10%):**
- Total height **2.5-2.8 head-heights**. (Realistic human 7.5-8, Mario ~4.5, Kirby ~1.2.)
- Head is **40-48% of silhouette height and wider than the torso**.
- Torso ≈ 1 head-height, ovoid, wider at the base.
- Legs ≈ 0.7 head-height, stubby, oversized rounded feet.
- Hands ≈ 0.35-0.45 head-width, spherical mittens, **no separated fingers**.
- Eyes are two rounded-rect LED panels, each ~22-28% of face-plate width, one eye-width apart, at **55-60% down the face plate**. Low placement reads as infantile.
- Arms are often "floating", disconnected from shoulders.

**[OBS] The eye treatment, worth building carefully** — it carries more identity than anything else:
- Emissive geometry behind a **glossy dark visor**. A near-black glossy face plate at roughness ~0.1 that takes a clean environment highlight, with a bright emissive glyph inside it.
- The glyph is **swapped or morphed, not moved**. Build a library of states: neutral, happy, surprised, squint, blink, dizzy, sad.
- Emissive bright enough to clear the bloom threshold while the white plastic does not. That is the whole reason to run a high threshold.
- A faint scanline or pixel grid sells "LED matrix" — the digital-DNA doctrine applied to the face.
- Blink cadence: random 2-5s interval, ~90-120ms duration, fast close and slower open.

**[DOC] Animation principle: model how children express joy** — jumping up and down with excitement. Cuteness with mischievous undertones. Bosses invert: intimidating on arrival, vulnerable and a little silly once losing.

**[REC] Concrete animation values:**
- **Squash/stretch:** takeoff stretch Y ×1.15-1.25 / XZ ×0.85 over 2-3 frames. Landing squash Y ×0.7-0.8 / XZ ×1.15-1.25 for 3 frames, overshoot to ×1.05, settle. Preserve volume.
- **Anticipation:** 3-5 frames of counter-motion before any big action. At 60fps that is 50-83ms, short enough not to feel laggy.
- **Overshoot:** every settle overshoots 8-15% and returns on a damped spring. Use a spring integrator (stiffness ~180, damping ~14), not an easing curve — it handles interruption, which matters in a game.
- **Secondary motion:** head lags the torso by 2-3 frames, backpack and antenna by 4-6, feet trail on direction change.
- **Waddle:** torso counter-rotation ±4-7° per step, Y bob ~4% of body height, phase-offset so the bob peaks mid-step.
- **Idle is never static.** 3-5% breathing scale on a ~2s cycle, plus a random look-around or fidget every 4-8 seconds. The mischief lives in the fidgets.

---

## Priority order for a three.js implementation

**Tier 1, most of the look for the least effort**
1. A correct linear colour pipeline. Prerequisite for everything.
2. Narrow FOV with a slight downward pitch.
3. Clearcoat roughness clearly separated from base roughness on all hero surfaces.
4. Three-light rig plus a saturated hemisphere plus hand-placed Lightformers. Never an HDRI photo.
5. A contact shadow with a **coloured**, not black, shadow colour.
6. Three-value-band palette discipline with globally constant semantic hues.
7. Fog in the background tint for aerial perspective.
8. ACES, a saturation lift, and a per-world LUT.

**Tier 2, the polish that sells it**
9. AO with a small radius and coloured occlusion.
10. High-threshold bloom so only LEDs and sparkles glow.
11. Far-field-only DOF locked to the character.
12. The emissive LED eye shader with a shape library and blink logic.
13. Squash/stretch plus spring-driven secondary motion.
14. Analytic GPU particle bursts, short ribbon trails, screen flash and shake.
15. Roughness variation and bevelled edges on every plastic object.

**Tier 3, expensive, last**
16. Baked lightmaps or per-zone light probes.
17. Wrap-diffuse SSS on white shells.
18. `transmission` on a small number of glass hero objects only.
19. Clustered physics props.
20. Subtle chromatic aberration and a tinted vignette.
