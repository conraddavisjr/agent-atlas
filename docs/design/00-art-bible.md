# The art bible

Five design specs sit beside this file, and each is authoritative inside its own area.
This one exists for the decisions no single spec could make alone: the ones where two specs would otherwise each pick a reasonable value and produce a world neither designed.

**If this file and a numbered spec disagree, this file wins.**
Everything else, defer to the spec.

- `00-references.md` - the researched Astro brief, with documented and inferred clearly separated
- `01-lighting.md` · `02-materials.md` · `03-environment.md` · `04-post.md` · `05-character-vfx.md`

---

## 0. Five defects found while designing, all verified

These were not visible from a screenshot and none of them threw an error.
They are listed first because several of the design decisions below only make sense once you know them.

**1. Nothing in the game blooms.** Bloom masks on Rec.709 *luminance*, not peak channel. The brightest emissive in the project is the visor at `#4de2ff`, whose linear luminance is 0.6319; at its `emissiveIntensity` of 2.4 that reaches **1.517** against a threshold of **1.75** plus 0.3 smoothing. Every other emissive is further away: circuit traces 0.758, cave crystals 0.430, token crystals 0.330, node sculptures 0.242. The bloom pass has been running every frame and outputting black. `materials.ts` states in its own doc comment that intensity above 1 "is what pushes it past the bloom threshold in PostFX", and that has never been true for any colour in the palette.

**2. `onBeforeCompile` receives shaders with `#include` directives unresolved.** `material.onBeforeCompile(parameters, _this)` is called at `three.module.js:18210`, and `resolveIncludes` does not run until `WebGLProgram` is built inside the `acquireProgram` call on the following line. So any patch searching for the *body* of a chunk matches nothing and silently does nothing. This is why `Grass.tsx` works: it replaces directives, not bodies.

**3. `enableNormalPass` is a wasted full scene render.** It is consumed only by `SSAO`, which errors when it is null. `N8AO` is a different export that wraps `N8AOPostPass` from the `n8ao` package and derives normals from its own depth pre-pass. Nothing else in our chain reads normals. On medium and high we have been rendering the entire scene one extra time per frame for nothing.

**4. N8AO's `color` is a multiplier, not a shadow colour.** It computes `mix(scene, color * scene, 1 - ao)`. Our `#2a3550` linearises to roughly `(0.024, 0.037, 0.087)`, so fully occluded pixels land at about 3% of their surface value. That is precisely the "ambient occlusion looks like dirt" failure the reference brief warns about, and the comment above it describing the colour as bounced light has the mechanism backwards.

**5. drei's `Lightformer` silently discards `rotation-x`.** It runs `if (!props.rotation) quaternion.identity()` and then `lookAt(target)`. `rotation-x` is a different prop key, so `props.rotation` is undefined and the rotation is thrown away. The overhead card in our current rig has been carrying a `rotation-x={Math.PI / 2}` that never did anything.

---

## 1. The bloom budget, decided centrally

This is the constraint most likely to produce a world that glows uniformly, and it is the one place where two specs proposed different answers to the same question.
`04-post.md` proposes lowering the threshold; `02-materials.md` proposes raising emissive intensities per colour.
Both are right about half of it.

**The root problem is that `emissiveIntensity` is not a meaningful unit.** Asking an artist for "intensity 2" means something different for cyan than for violet, because the threshold compares luminance and violet has a third of cyan's. That is why the current palette has six emissives at six intensities and none of them glow.

**Decision. Emissive brightness is expressed as a multiple of the bloom threshold, and the material layer does the conversion.**

```
emissiveIntensity = glow * BLOOM_THRESHOLD / luma709(linear(colour))
```

so that `glow: 1.0` means "sits exactly on the threshold" and `glow: 1.4` means "clearly over it", for every hue.
`BLOOM_THRESHOLD` becomes a single exported constant that both `materials.ts` and `PostFX.tsx` read, so the two can never drift apart again.
This is the fix that makes the bloom budget checkable rather than folkloric.

**The exception, which is mandatory rather than optional.** Normalisation cannot save a dark hue: violet at `#7c6bff` needs `emissiveIntensity` near 8 to clear the threshold, and a surface that bright renders as blown-out white and loses its colour entirely. So:

> **Any emissive whose linear luminance is below 0.35 must use a pale core with a coloured halo, never a saturated bright surface.** The geometry gets a near-white emissive core sized to read at distance, surrounded by a dimmer saturated shell that does not itself bloom. This is how Astro's LEDs are built and it is why they read as light sources rather than as bright plastic.

By that rule: cyan (0.632), gold (0.585 for `unlocked`) and pink (0.366) may be normalised directly. Violet `node` (0.220), `nodeGlow`, and `caveCrystal` (0.269) take the pale-core treatment.

**The threshold itself stays at 1.75 until it is measured, and is then expected to fall.** Stream 0 ships `?threshold=<n>` and `?bloomdebug` so the value is binary-searched against real frames rather than guessed. The prediction on record is 1.2 to 1.6. The acceptance shot is `hub-backlit`, because a rim light hits grazing angles where clearcoat Fresnel peaks, and that is where diffuse-safe lighting still blows out.

**Standing caps**, to be pasted into `Lighting.tsx` and kept current:

| Term | Cap | Spec value |
| --- | --- | --- |
| Sum of directional intensities | 2.60 | 2.55 |
| Hemisphere | 0.60 | 0.55 |
| Any single Lightformer | 1.60 | 1.40 |
| Rim directional | 0.60 | 0.55 |

**And a hard rule for VFX, because additive quads stack:** dust and debris use `NormalBlending` with alpha. Only energy effects use `AdditiveBlending`, and only those may carry colours above 1.0. A dense cluster of individually dim additive dust will otherwise cross the threshold and produce a white blob.

---

## 2. The rim light, split in two

`01-lighting.md` establishes something worth restating here because it resolves the tension between "we need a rim" and "a rim is the most likely thing to blow out".

A prefiltered environment cubemap **cannot exceed its brightest texel**, so a Lightformer is provably bloom-safe in a way an analytic light is not.
So the rim's two jobs are split: the **diffuse wrap** comes from a camera-relative directional at 0.55 (peak luminance 0.119, a 15× margin), and the **specular streak** comes from a long thin strip card in the environment (peak 1.32 against 1.75).

The rim is driven from `cameraFrame.yaw`, which `FollowCamera` already publishes and which is exactly the azimuth needed, so no camera maths is required.
Elevation is fixed rather than following camera pitch, because following it uplights the character whenever the player looks down.

**No second shadow caster, at any tier.** Layers cannot mask shadow casters per light, because `WebGLShadowMap` tests `object.layers` against the main camera rather than the shadow camera. Instead the existing caster gets a player-following, light-space texel-snapped frustum at half-extent 12, which raises texel density by half at every tier for about twelve CPU operations, and the character gets a multiply-blended contact blob at one draw call.

---

## 3. Camera, and the one exception to the frozen-tuning rule

`03-environment.md` calls for **FOV 40**, down from 55, which is most of the diorama read.
Holding the character the same size in frame requires `D · tan(fov/2)` to stay constant, so `CAMERA.distance` goes 7.5 to 10.7 and `CAMERA.height` 3.0 to 4.3.

**This is the sole sanctioned change to `tuning.ts` in this project.**
`MOVEMENT`, `JUMP`, `BODY` and `SQUASH` stay frozen so that any change in how the game feels remains attributable to animation rather than to handling.
The camera constants are geometrically derived from the FOV rather than chosen by taste, and they must land in the same commit as the FOV or the framing is wrong in between.

**It regresses the cave, and the fix ships with it.** At 10.7 back, the camera from the cave's `entrance` spawn sits outside the room walls at z = ±12, handing the opening shot to the collision raycast. `SceneDefinition` gains a `cameraScale` field, cave set to 0.62.

---

## 4. Shader work: the rules, not suggestions

This codebase has now been cut four times by silent failures, three of them in shader patching.
`SoftShadows` whited out the scene. `Cloud` rendered nothing. `vColor *= iColor` took down the entire 1.43M-triangle grass field while reporting all 178,988 instances and `visible: true`. And `onBeforeCompile` sees unresolved includes, so body-matching patches do nothing.

Any `onBeforeCompile` added by any stream must:

1. **Patch `ShaderChunk` in module scope and substitute the directive**, or replace the directive itself. Never search for chunk body text.
2. **Guard on the token existing** and return unpatched if it does not, so a three upgrade degrades to plain shading rather than to a black screen.
3. **Be a module-level function with stable identity.** An inline closure defeats three's program cache and shows up as first-sight hitching rather than as an error.
4. **Ship with a check that the patch actually applied** - a triangle-delta measurement through `window.__dev.budgets()`, or a unit test against `ShaderChunk` which loads fine under Node.

**Swizzle defensively.** Write `vColor.rgb`, not `vColor`. three declares that varying at different widths depending on build flags and it changed in 0.185.

---

## 5. Cross-cutting corrections every stream applies

| Correction | Owner | Why |
| --- | --- | --- |
| Delete `enableNormalPass` | Post | A whole extra scene render, consumed by nothing |
| Move `SMAA` after `ToneMapping` | Post | It currently detects edges on unbounded HDR, over-blending speculars and missing shadow edges |
| N8AO `color` to `#8fa4cc`, `intensity` to 3.0 | Post | It is a multiplier; the old value crushed occlusion to 3% of surface value. `intensity` is an exponent, so it rises to compensate |
| Vignette tint comes from ordering | Post | `VignetteEffect` has no colour input. Placing it before tone mapping puts corners in the grade's shadow range where the LUT cools them |
| Never set `rotation` on a `Lightformer` | Lighting | It is discarded; orientation comes from `target` |
| `ccRoughness <= baseRoughness - 0.20` | Materials | The two-lobe rule. Current `plastic()` has a ratio of 1.96 where 8 is needed |
| Consolidate the two flower systems | Environment | `Scatter.tsx` runs its own flowers alongside `Flowers.tsx`. They are visually distinct, so consolidate rather than delete - the small pink domes are doing real work |
| Fold `LessonTotem` into the kit | Environment | 10 draw calls each, 40 across four totems, more than the entire proposed built environment |
| Fix `clusteredPlacements` annulus sampling | Environment | It silently thins results when `minRadius` is high |

---

## 6. Facts the specs asked about, now settled

- **The robot's forward axis at `rotation.y = 0` is `+Z`.** `headingVector` returns `(sin f, cos f)`, so at zero facing the heading is `(0, 0, 1)`. Its local `+X` is its own left, and its right is `-X`. Marked as a guess in `03-environment.md`; it is not a guess.
- **Grass and flowers stay on `MeshStandardMaterial`.** Putting clearcoat behind 3.5M triangles of blade to add a highlight to a 3 cm strip is the worst trade available. Compensate with roughness and `envMapIntensity` instead.
- **`transmission` is banned outside a named list of glass hero objects.** It costs an extra render target and makes a white character look like a gummy bear. The `gel()` preset currently spreads it across 13 or more crystals; `crystal()` replaces it.

## 7. Rollout discipline

The failure mode this section exists to prevent is real and it is the *modern* amateur signature: bloom, depth of field, chromatic aberration, vignette, a LUT and ambient occlusion all arriving together produce a hazy, over-graded image that is worse than the flat one it replaced.

- **One effect per commit**, each with the fixed five-shot set, each defensible in isolation at the same vantage.
- **The LUT lands as identity first.** An 8-bit 32³ identity LUT is not bit-exact, so the acceptance tolerance is max 2/255 and mean 0.5/255 with **no structure** in a 32× amplified diff. Expecting zero would produce a false failure.
- **Depth of field is off by default even once built**, and needs an explicit A/B pair at `hub-establishing` and `hub-portal` before it is enabled. Near-field blur is deleted rather than reduced, because blurring ground the player is about to jump onto is a gameplay regression.
- **If two effects each pass alone but fail the greyscale readability test together, the later one is reverted**, not both softened.
- **`low` must get cheaper, not more expensive.** It loses two grading effects, gains one LUT fetch, swaps three SMAA passes for one FXAA pass, and drops environment resolution to 128. It still gets the rim and the contact blob, because those are what most help a weak image.

## 8. The acceptance test that outranks all the others

From the reference brief, and meant literally rather than as a metaphor:

> **Desaturate a frame to greyscale. You must still instantly read where you can stand.**

`03-environment.md` confirms we fail it today and gives the numbers: `palette.rock` at luma 0.850 against a ground texture base near 0.83, so deck and lawn are the same value, and the island rim at 0.568 sits inside the gameplay band, which is why the island reads as having no thickness.

Three bands, with real gaps between them: **gameplay 0.56-0.74, midground 0.20-0.38, background 0.76-0.86.**
