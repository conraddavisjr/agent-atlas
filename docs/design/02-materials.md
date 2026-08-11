# Materials and shading

This is the surfacing spec for Agent Atlas.
It is written to be implemented directly: every number here is a value to type into a file, not a range to interpret.
Read `docs/design/00-references.md` first, because every justification below traces back to it.

Labels follow the reference brief's convention.

- **[DOC]** something verified in this repository's own source, in `node_modules/three@0.185.1`, or in the reference brief's cited sources.
- **[CALC]** derived arithmetically from something verified, with the calculation shown.
- **[GUESS]** an art or performance judgement I cannot verify without running the game, flagged so it gets measured rather than trusted.

---

## 0. Two verified corrections before anything else

These are the two things most likely to make an implementation of this document silently fail.

### 0.1 `onBeforeCompile` sees the shader with `#include` directives still unresolved

**[DOC]** In three 0.185.1, `WebGLRenderer.js:2216` calls `material.onBeforeCompile( parameters, _this )`, and `parameters.fragmentShader` is `ShaderLib.physical.fragmentShader` verbatim.
`resolveIncludes()` does not run until `WebGLProgram.js:794`, which is after that call.

The consequence is absolute.
At `onBeforeCompile` time the fragment shader string contains the line `#include <lights_physical_pars_fragment>` and does **not** contain any of that chunk's body.
Searching for a line of chunk body and calling `.replace()` on it is a no-op that throws nothing, logs nothing, and leaves you with stock shading while you believe you have patched it.

This is why `Grass.tsx` works: it replaces `#include <common>`, `#include <begin_vertex>`, `#include <beginnormal_vertex>` and `#include <color_vertex>`, which are all directives present in the raw source.
The `vColor` incident was a different failure, a GLSL type error at compile time, and it produced the same outward symptom of a mesh that reports everything and draws nothing.

**Rule for this codebase.**
An `onBeforeCompile` patch may only ever replace an `#include <name>` directive.
To modify a chunk's body, import `ShaderChunk` from three, patch the chunk string in module scope, and substitute the patched copy for the directive.
`resolveIncludes()` is recursive and scans the whole assembled string afterwards, so any nested includes inside an inlined chunk still resolve correctly.
**[DOC]** `lights_physical_pars_fragment` contains no nested includes, so this is a single flat substitution.

### 0.2 three's default shader cache key is `onBeforeCompile.toString()`

**[DOC]** `Material.js:543` defines `customProgramCacheKey() { return this.onBeforeCompile.toString(); }`, and `WebGLPrograms.js:432` pushes that string into the program cache key.

Two failure modes follow, and they pull in opposite directions.

A patch that bakes per-material numbers into a template literal inside a factory produces closures whose **source text is identical** regardless of what they captured.
Two shells with different wrap constants would then share one compiled program, and one of them would silently render with the other's constants.

A patch whose source text varies per instance, because it interpolates a number, produces a distinct cache key and therefore a distinct shader compile per instance.
That is the first-sight hitch.

**Rule for this codebase.**
Any `onBeforeCompile` in this project is a module-level `function` declaration with hard-coded constants, assigned by reference.
Every material that uses it also sets an explicit `customProgramCacheKey` returning a versioned literal string.
No factories, no closures, no interpolated numbers.

---

## 1. The revised preset table

### 1.1 The rule the table is built on

The reference brief's section 3(a) is the whole thesis.
Moulded plastic is a slightly diffuse body under a smooth surface skin, and the eye reads that as two separate specular lobes: a broad soft one from the body, and a tight bright one from the coat.
One lobe reads as a matte 3D model no matter how good the colour is.

**[DOC]** The current `plastic()` preset is `roughness 0.35 / clearcoatRoughness 0.25`.
GGX lobe width goes as roughness squared, so those two lobes have widths in the ratio `0.35² : 0.25²`, which is `1 : 0.51`.
A factor of two in width between two overlapping highlights of similar brightness does not resolve as two highlights, it resolves as one slightly odd highlight.

**The separation rule, and it is a hard constraint on every preset below.**

> `clearcoatRoughness <= baseRoughness - 0.20`, and the ratio `baseRoughness² / clearcoatRoughness²` must be **at least 8**.

At `0.38 / 0.10` the ratio is 14.4, which resolves cleanly.
At the current `0.35 / 0.25` it is 1.96, which does not.

**The second rule, which is new and is a bloom-safety rule.**

> `clearcoat` amount never exceeds **0.85**, and is 0.70 by default.

Clearcoat at 1.0 means the coat's Fresnel term owns the surface completely at grazing angles, which both erases the body lobe at exactly the silhouette where form is read, and drives raw HDR toward 1.0 times the environment radiance along every edge in frame.
Bloom runs before tone mapping at threshold 1.75, so silhouette edges are the single most likely place for unwanted bloom to appear.
Every preset currently using `clearcoat: 1` is therefore changed.

**The third rule, which comes from the lighting rig rather than from the material.**

> On a **curved** surface lit by a punctual light, `clearcoatRoughness` never goes below **0.10**.
> Below 0.10 is permitted only on **flat** surfaces.

The reference brief asks for a soft terminator and no hard specular pinpoints on curved plastic, because the key is meant to read as a large softbox.
A `directionalLight` is a delta light, and against a GGX lobe at roughness 0.05 it produces a sub-pixel pinpoint rather than an elongated softbox streak.
The visor face plate is flat and takes 0.05, because on a flat surface the highlight is a shaped reflection of the environment rather than a dot.

### 1.2 The table

`metalness` is 0 on every preset except `anodised` and `chrome`.
`envMapIntensity` defaults to 1 in three and is now specified explicitly everywhere, because it is the cheapest lever in the whole document: it costs literally nothing and it is what decides whether the `Lightformer` rig or the analytic lights own each surface.

| Preset | Impersonating | rough | metal | clearcoat | ccRough | ratio | sheen | sheenRough | sheenColor | envMapInt | emissive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shell()` | ABS toy shell, white, hero | **0.32** | 0 | **0.80** | **0.10** | 10.2 | **0.30** | 0.55 | `#ffb489` | **1.15** | `#ffb489` @ **0.08** |
| `plastic()` | saturated injection-moulded ABS | **0.38** | 0 | **0.70** | **0.10** | 14.4 | 0 | - | - | **1.00** | none |
| `mattePlastic()` | textured-mould ABS, satin skin | **0.72** | 0 | **0.30** | **0.30** | 5.8 * | 0 | - | - | **0.70** | none |
| `vinyl()` | soft PVC, the fabric replacement | **0.50** | 0 | **0.55** | **0.16** | 9.8 | **0.25** | 0.65 | base +25% white | **0.80** | none |
| `rubber()` | moulded TPE, grippy | **0.78** | 0 | **0** | - | - | **0.25** | 0.80 | base +30% white | **0.45** | none |
| `flock()` | flocked felt, moulded moss | **0.90** | 0 | **0** | - | - | **1.00** | 0.85 | base +35% white | **0.30** | none |
| `anodised()` | anodised aluminium hardware | **0.30** | **0.95** | **0.15** | **0.10** | 9.0 | 0 | - | - | **1.00** | none |
| `chrome()` | polished chrome, the showpiece | **0.06** | **1.00** | **0** | - | - | 0 | - | - | **1.00** | none |
| `stone()` | moulded stone-shaped object | **1.0** (map) | 0 | **0.20** | **0.45** | see note | 0 | - | - | **0.85** | none |
| `ground()` | moulded earth, background band | **1.0** (map) | 0 | **0** | - | - | 0 | - | - | **0.55** | none |
| `plateau()` | the walkable lid, flat by decree | **0.88** | 0 | **0** | - | - | 0 | - | - | **0.50** | none |
| `crystal()` | cast acrylic, no transmission | **0.14** | 0 | **0.85** | **0.06** | 5.4 * | 0 | - | - | **1.20** | tier B, see 8 |
| `gel()` | actual glass, hero only | **0.08** | 0 | **0.85** | **0.05** | 2.6 * | 0 | - | - | **1.20** | none |
| `led()` | powered emissive element | **0.25** | 0 | **0.60** | **0.10** | 6.3 * | 0 | - | - | **0.60** | see section 8 |
| `visorPlate()` | near-black glossy face plate | **0.28** | 0 | **0.85** | **0.05** | 31.4 | 0 | - | - | **1.30** | none |

Entries marked `*` are deliberate exceptions to the ratio rule, and each has a reason.

- `mattePlastic` at 5.8 is a textured mould, where the point is a broad body and a **soft** satin skin, not a mirror skin.
  Giving a chalky surface a 0.10 coat is what makes plastic read as wet, and this preset exists precisely for the large surfaces that must not read as wet.
- `crystal`, `gel` and `led` are all surfaces where the base lobe is not meant to be visible at all.
  There is effectively one lobe by design, and the material reads as a solid transparent body rather than as a coated opaque one.
- `stone` takes its base roughness per texel from the ORM pack's green channel, so its ratio depends on the map.
  Section 4.4 specifies that map's range as 0.55 to 0.92, which puts the ratio between 1.5 and 4.2 against a 0.45 coat.
  That is intentionally the weakest lobe separation in the table: stone is not meant to look moulded to the same degree that a toy block is, only moulded enough that it does not fall out of the world.

### 1.3 What changed and why, preset by preset

**`plastic()`**, from `0.35 / cc 1.0 / ccR 0.25` to `0.38 / cc 0.70 / ccR 0.10`.
Base roughness rises slightly to widen the body lobe and to sit in the brief's 0.30 to 0.45 band for saturated ABS.
Coat roughness drops to 0.10, which is the floor for curved surfaces, taking the width ratio from 1.96 to 14.4.
Coat amount drops to 0.70 for silhouette bloom safety, and because at 1.0 the amber accent parts were losing their own colour to a white edge.

**`mattePlastic()`**, from `0.75 / cc 0.4 / ccR 0.6` to `0.72 / cc 0.30 / ccR 0.30`.
The old numbers had a 0.15 gap between two broad lobes, which is the single worst configuration in the whole file: it costs a full extra GGX evaluation and produces something visually indistinguishable from no clearcoat at all.
Halving the coat roughness while dropping the coat amount buys an actual satin skin for less fragment work than before.

**`rubber()`**, from `0.95 / cc 0` to `0.78 / cc 0 / sheen 0.25`.
0.95 is past the point where GGX has any directionality left, so the material reads as a flat-shaded polygon and dies in shadow.
0.78 sits at the top of the brief's 0.65 to 0.80 band, and a low sheen adds the dusty grazing-angle rim that is how moulded TPE actually reads.
`envMapIntensity` drops to 0.45 so rubber stays the darkest, deadest thing on the robot, which is what makes it read as a different material from the shell rather than as a darker shell.

**`metal()` becomes `anodised()`**, from `0.4 / metal 0.9 / cc 0.3` to `0.30 / metal 0.95 / cc 0.15 / ccR 0.10`.
Clearcoat at 0.3 over metal at roughness 0.4 was two broad lobes again.
The coat is kept but reduced to a thin lacquer, which is physically what anodising plus a clear top coat is.
`anisotropy: 0.45` with `anisotropyRotation: 0` is specified as a **high-tier only** addition (section 10), because it adds `USE_ANISOTROPY` and a meaningful block of fragment work for an effect that is only visible on parts smaller than the robot's antenna.

**`emissive()` becomes `led()`**, from `0.3 / cc 1.0 / ccR 0.1` to `0.25 / cc 0.60 / ccR 0.10`, and its intensity argument is recomputed in section 8.
Clearcoat at 1.0 on a surface that is already emitting above the bloom threshold is the most direct way to produce a white blob, because the coat's Fresnel adds environment radiance on top of emission at exactly the silhouette.

**`stone()`**, `clearcoat` from 0.15 to 0.20 and `clearcoatRoughness` from 0.80 to 0.45.
0.80 is not a coat, it is a slightly brighter diffuse term.
0.45 gives the stone a genuine, if soft, second lobe, which is what puts it in the same manufactured family as its neighbours.
`aoMapIntensity` stays at 1.35 and `normalScale` stays at (1, 1).

**`ground()`** is unchanged in its roughness and normal handling and gains only `envMapIntensity: 0.55`.
It is now explicitly a background-band material, per section 5.

**`gel()`** keeps `transmission` but is restricted to hero glass only, and stops being used for the token crystals and the lesson totem's concept node.
Those move to `crystal()`, which is section 2.

---

## 2. New presets

Seven presets do not exist and should.

**`shell(color, overrides)`** - the hero.
Only the robot's torso, head and hand props use it.
It is the only preset in the file carrying the subsurface approximation from section 3, and it is the only preset with a non-zero emissive floor.
Keeping it to one caller is what protects the reference brief's value-band rule: Astro is a **value anomaly**, the brightest and least saturated thing in frame, and that separation is destroyed the moment anything else in the world is given the same white.

**`vinyl(color, overrides)`** - the fabric replacement.
**[DOC]** The reference brief's deepest rule is that when Team ASOBI needed hair or fabric they replaced it with vinyl.
This project has exactly one soft good, the cape, and it is currently a `planeGeometry` with `mattePlastic`, which is a zero-thickness sheet of chalky ABS.
`vinyl()` is also the right preset for the robot's upper legs and for the flower heads in `Scatter.tsx`.

**`flock(color, overrides)`** - flocked felt.
This is the sheen showpiece, and it is the preset that makes the ground cover stop reading as green plastic.
`sheenColor` is computed as the base colour lerped 35% toward white, per the brief's rule that sheen tint is lighter than base.
Used on clover, on any moss, and on the underside of the island if that ever gets art.

**`anodised(color, overrides)`** - renamed from `metal()`, with `metal` kept as a deprecated alias for one release so nothing breaks mid-refactor.

**`chrome(overrides)`** - takes no colour, because chrome is white by definition.
**[DOC]** The brief calls chrome the reflection showpiece and says to give it the best environment map.
There is currently nothing chrome in the world, and there should be: one small chrome element on the robot, most naturally a collar ring at the neck or a bezel around the visor, is the cheapest possible demonstration that the environment map exists.
It is also the fastest way to spot a broken `Lightformer` rig, because chrome shows the rig literally.

**`crystal(color, overrides)`** - cast acrylic, and the replacement for every current use of `gel()` except real glass.
`transmission` costs an extra render target pass, and **[DOC]** the reference brief explicitly warns it makes a white character look like a gummy bear.
There are currently thirteen token crystal cones plus one concept node per lesson totem using `gel()`, which is thirteen-plus objects paying for transmission to look like coloured plastic.
`crystal()` gets the read with clearcoat, a tier-B emissive, and `opacity: 0.92` alpha rather than refraction.

**`visorPlate(overrides)`** - a near-black glossy plate at `color: '#12161c'`.
**[DOC]** The brief's section 8 describes the eye treatment as emissive geometry behind a glossy dark visor at roughness around 0.1, and calls it the thing carrying more identity than anything else.
The robot currently has the emissive bar and no plate behind it, so the visor is a glowing rectangle floating on white rather than a lit element inside a dark window.
Adding the plate is a two-line geometry change and is the single highest-value item in this document for the character.

**`glowStrip(color, intensity)`** - not a physical material at all.
Returns `meshBasicMaterial` props with the colour pre-multiplied by intensity, `transparent: true`, `blending: AdditiveBlending`, `depthWrite: false`.
The three ground circuit traces in `HubIsland.tsx` currently pay for a full `meshPhysicalMaterial` with clearcoat to draw a flat translucent glowing line lying on the floor, where every lit term is either invisible or actively unwanted.
Bloom runs before the `ToneMapping` effect, so a basic material at a raw value above 1.75 blooms exactly like an emissive one.

---

## 3. Subsurface approximation on the white shell

### 3.1 Why the shell needs it at all

**[DOC]** The reference brief's diagnostic is that the darkest pixel on a white shell in an Astro frame is rarely below 28 to 35% luminance and is always chromatic.
Deep shadow on white plastic is deliberately refused, and thin plastic parts glow faintly at their edges because light passes through them.

Neither is currently true here.
The shell is `#f4f1ea` with nothing lifting its shadow side except a hemisphere light at 0.5 and two fill directionals at 0.25 and 0.45.

### 3.2 Phase 1: native features only, no shader patching

Phase 1 uses three levers that already exist on `MeshPhysicalMaterial` and cost nothing but a slightly larger shader.

**Lever 1, the emissive floor.**
`emissive: '#ffb489'`, `emissiveIntensity: 0.08`.
**[CALC]** Linear value of `#ffb489` is `vec3(1.000, 0.456, 0.250)` with Rec.709 luminance 0.5571, so at 0.08 this adds 0.0446 of luminance uniformly, warm-tinted.
That is a floor, not a glow: it is 2.5% of the bloom threshold, and it is applied only to `shell()`.
This is what guarantees the shadow side is chromatic and never crushes, independently of whether the lighting rig is dialled in.

**Lever 2, sheen as a fake Fresnel translucency.**
`sheen: 0.30`, `sheenRoughness: 0.55`, `sheenColor: '#ffb489'`.
**[DOC]** three's `RE_Direct_Physical` adds `sheenSpecularDirect += irradiance * BRDF_Sheen(...)` using the Charlie distribution, which is a retro-reflective lobe peaking at grazing angles.
That is geometrically the same place real subsurface scattering shows up on a thin plastic edge, so a warm sheen at low amount reads convincingly as light coming through the rim of the shell.
It is not physically subsurface, and it does not respond to thickness, but at 0.30 that is not detectable.

Note that three's `sheenColor` defaults to **black**, so setting `sheen` without also setting `sheenColor` does exactly nothing.
Note also **[DOC]** `MeshPhysicalMaterial.js:478` bumps the material version only when `sheen` crosses zero, which means the quality tier must be known **before** the material is constructed.
Toggling sheen on an existing material at runtime is fine, but toggling it from zero forces a recompile, so tier changes should rebuild materials rather than mutate them.

**Lever 3, environment weighting.**
`envMapIntensity: 1.15` on `shell()` against 1.00 on `plastic()`.
The shell is the one surface that should be reading the `Lightformer` rig more strongly than its neighbours, because a coloured ambient fill arriving through the environment map is chromatic by construction, where a hemisphere light is only chromatic in two directions.

**Acceptance test for Phase 1, and this is the gate on whether Phase 2 happens at all.**
Take a screenshot with the robot standing so the key light is behind and to one side, at the standard hub camera.
Sample the darkest pixel on the torso.
If its Rec.709 luminance after tone mapping is at or above **0.28** and its saturation is at or above **0.05**, Phase 1 is sufficient and **Phase 2 is not attempted**.

I expect Phase 1 to pass that test. **[GUESS]**
What Phase 1 cannot do is make the terminator itself soft and warm, because sheen affects the grazing rim and not the `NdotL` falloff.
If review specifically calls out a hard, cold terminator line across the head or torso, that is the one symptom Phase 1 structurally cannot fix, and it is the only reason to proceed.

### 3.3 Phase 2: wrapped diffuse via `onBeforeCompile`

Only attempted if Phase 1 passes the luminance test but fails on terminator quality.

The target is three 0.185.1's `lights_physical_pars_fragment`, `RE_Direct_Physical`, line 558.
**[DOC]** Verified by `grep` to be the only occurrence of this exact string across every chunk in the build:

```
reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
```

Note `material.diffuseContribution`, not `material.diffuseColor`.
three 0.185 renamed it, and a patch written against any online example older than that release will fail the guard.

Per section 0.1, this line cannot be replaced directly.
The chunk is patched in module scope and substituted for its `#include` directive.

```ts
// src/art/wrapDiffuse.ts
import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'

/** Bumped whenever the GLSL below changes. Part of the program cache key. */
export const WRAP_DIFFUSE_VERSION = 'agent-atlas/wrapDiffuse@1'

const CHUNK = 'lights_physical_pars_fragment'
const DIRECTIVE = `#include <${CHUNK}>`

/**
 * The exact statement in three 0.185.1 that this patch replaces.
 * Verified unique across every shader chunk in the build.
 * `src/art/wrapDiffuse.test.ts` asserts it still exists, so a three upgrade
 * that moves it fails `npm test` rather than silently disabling the effect.
 */
export const TOKEN =
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );'

/*
  Wrap width 0.35 and a warm tint of #ffd9c0, both straight from the reference
  brief. The tint is written in LINEAR space because it is multiplied into a
  linear radiance term, not assigned to a colour uniform that three would decode.
  linear(#ffd9c0) = vec3(1.000, 0.694, 0.527).

  The wrap is normalised by (1 + w), so at dotNL = 1 it evaluates to exactly 1.0
  and the fully lit value is bit-identical to stock. That is the property that
  makes this patch bloom-safe: it cannot raise peak diffuse, so it cannot push
  any surface newly across the 1.75 threshold. It only lifts the terminator.
*/
const REPLACEMENT = /* glsl */ `
	{
		float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.35 ) / 1.35 );
		vec3 wrapIrradiance = wrapNL * directLight.color;
		#ifdef USE_SHEEN
			wrapIrradiance *= sheenEnergyComp;
		#endif
		vec3 wrapTint = mix( vec3( 1.0, 0.694, 0.527 ), vec3( 1.0 ), smoothstep( 0.0, 0.30, dotNL ) );
		reflectedLight.directDiffuse += wrapIrradiance * wrapTint * BRDF_Lambert( material.diffuseContribution );
	}
`

/** Patched once at module load, or null when three no longer matches. */
const PATCHED_CHUNK: string | null = ShaderChunk[CHUNK].includes(TOKEN)
  ? ShaderChunk[CHUNK].replace(TOKEN, () => REPLACEMENT)
  : null

/**
 * Module-level and stable by construction. Assigned by reference, never wrapped
 * in a closure, because three keys its shader program cache on
 * `onBeforeCompile.toString()`.
 */
export function applyWrapDiffuse(shader: WebGLProgramParametersWithUniforms) {
  // Guard 1: three's chunk no longer contains the statement we patch.
  if (PATCHED_CHUNK === null) return
  // Guard 2: this shader is not the physical shader, so the directive is absent.
  if (!shader.fragmentShader.includes(DIRECTIVE)) return
  shader.fragmentShader = shader.fragmentShader.replace(DIRECTIVE, () => PATCHED_CHUNK)
}
```

Four things in that snippet are load-bearing and must not be simplified away.

`ShaderChunk[CHUNK].replace(TOKEN, () => REPLACEMENT)` passes a **function** as the replacement, not the string.
`String.prototype.replace` interprets `$&`, `$'` and `` $` `` in a string replacement, and GLSL containing any of those would be silently corrupted.
The same applies to the second `replace`.

Both guards **degrade to unpatched, not to garbage**.
If three moves the statement, the shell renders with stock physical shading, which is exactly Phase 1, which is a look we have already accepted.
There is no path here that produces a broken shader.

`dotNL` and `sheenEnergyComp` are both already in scope at the injection point.
**[DOC]** `dotNL` is declared at line 529 of the chunk and `sheenEnergyComp` at line 550 inside the `#ifdef USE_SHEEN` preprocessor block, which is function scope rather than brace scope.
The braces around the replacement create a new scope so `wrapNL`, `wrapIrradiance` and `wrapTint` cannot collide with anything three adds later.

`saturate( dot(...) )` is deliberately **not** used for `wrapNL`.
The chunk's own `dotNL` is already saturated, which throws away the entire back-facing half of the range that wrapping exists to recover.

The material that uses it:

```ts
const m = new MeshPhysicalMaterial({ ...shell(palette.shell) })
m.onBeforeCompile = applyWrapDiffuse
m.customProgramCacheKey = () => WRAP_DIFFUSE_VERSION
```

And the regression test, which is what makes this maintainable:

```ts
// src/art/wrapDiffuse.test.ts
import { ShaderChunk } from 'three'
import { TOKEN } from './wrapDiffuse'

it('three still contains the statement wrapDiffuse patches', () => {
  expect(ShaderChunk.lights_physical_pars_fragment).toContain(TOKEN)
})
```

**[DOC]** `ShaderChunk` is exported from three's main entry and loads under Node, verified against this repo's `node_modules`.
That test costs nothing and turns a class of silent runtime failure into a red `npm test` at upgrade time.
The same test should be written for `Grass.tsx` and `Flowers.tsx`, asserting that `#include <begin_vertex>`, `#include <beginnormal_vertex>` and `#include <color_vertex>` still appear in `ShaderLib.standard.vertexShader`.

### 3.4 What Phase 2 costs

Three extra ALU ops plus a `mix` and a `smoothstep`, per light, per fragment, on one material.
The robot is a few thousand pixels of screen.
The cost is not the arithmetic, it is the extra shader program: the shell no longer shares a compiled program with any other physical material in the scene, which is one more compile at first sight of the robot.
Mitigation is to warm it by rendering the robot once during the loading iris, which the scene host already has a natural place for.

**Phase 2 is high tier only.** See section 10.

---

## 4. Roughness variation without authored assets

**[DOC]** The reference brief's section 3(b) says perfectly uniform roughness kills the read instantly, and that low-frequency noise driving roughness by plus or minus 0.08 transforms it.
Roughness in this project is currently uniform on every single surface except the two photographic sets.

The pattern to extend is `groundTexture.ts`: a canvas drawn at load, memoized at module scope, seamless by construction through `drawWrapped`, costing one canvas and no download.

### 4.1 The new module

`src/art/surfaceTexture.ts`, exporting:

```ts
export type SurfaceKind = 'shell' | 'abs' | 'moulded' | 'grip'
export type SurfaceMaps = {
  /** ORM pack: AO in red, roughness in green. Matches the existing convention. */
  roughnessMap: Texture
  aoMap: Texture
  normalMap: Texture
}
/** Null at the low tier, which does no canvas work at all. */
export function createSurfaceMaps(kind: SurfaceKind, size: 512 | 1024): SurfaceMaps | null
export function useSurfaceMaps(kind: SurfaceKind, repeat: [number, number]): SurfaceMaps | null
```

The ORM packing is not a saving, it is the existing convention: **[DOC]** three reads occlusion from a texture's red channel and roughness from its green, so one image fills two material slots.
Occlusion must be pinned to `channel = 0`, for exactly the reason `textures.ts` already documents.

Both maps are `LinearSRGBColorSpace`.
Tagging a roughness or normal map as sRGB applies a decode curve to gloss values and vectors, and the result is a world that reads shinier than authored with normals bent toward the surface.

### 4.2 Getting a signed roughness offset out of an unsigned multiplier

three computes `roughnessFactor *= texelRoughness.g`, so a map value of 1.0 is neutral and there is no way to go above the material's own roughness.

The fix is to bias the material.
Pick a mid green of **0.80** and set `material.roughness = target / 0.80`.

**[CALC]** For `plastic()` at target 0.38 with a plus or minus 0.08 swing:

- `material.roughness = 0.38 / 0.80 = 0.475`
- green byte for the mid = `round(0.80 * 255) = 204`
- green byte for 0.30 = `round(0.30 / 0.475 * 255) = 161`
- green byte for 0.46 = `round(0.46 / 0.475 * 255) = 247`

So the green channel is written into the byte range **161 to 247, centred on 204**, and every preset that takes surface maps has its `roughness` constant divided by 0.80 when maps are present.
This is the only fiddly part of the whole system and it must be done in one place: `createSurfaceMaps` returns the divisor alongside the maps, and the preset applies it.

### 4.3 The layer stack

Every layer is drawn through `drawWrapped` so the result tiles.
`mulberry32` is already exported from `src/art/placement.ts` and is the seeded RNG to use, so a given kind produces the same tile every load.

Three independent masks are generated per kind: **height**, **roughness**, **occlusion**.
The layers below write into all three with different weights, which is what makes a panel line simultaneously a groove in the normal, a dust trap in the roughness, and a dark line in the AO.

| Layer | Height | Roughness | Occlusion | Feature size |
| --- | --- | --- | --- | --- |
| L0 base | 0.50 | mid (0.80 green) | 1.00 | - |
| L1 low-frequency mould flow | +/- 0.06 | +/- 0.055 | none | 2.0 m |
| L2 mid noise | +/- 0.025 | +/- 0.020 | none | 0.8 m |
| L3 fine noise | +/- 0.010 | +/- 0.008 | none | 0.30 m |
| L4 micro speckle | +/- 0.004 | +/- 0.012 | none | 2 px, box-blurred once |
| L5 panel lines | -0.16 groove | +0.055 | 0.72 in groove | see 7.1 |
| L6 panel line lip | +0.05, 1 px offset | -0.030 | 1.00 | 1 px |
| L7 parting line | +0.03 ridge | -0.020 | 1.00 | 1 px |
| L8 ejector circles | -0.03 dimple | +0.045 | 0.90 | 4 to 9 mm |
| L9 vent slots | -0.20 | +0.030 | 0.60 | see 7.4 |

The three noise octaves sum to plus or minus 0.083 of roughness, which lands exactly on the brief's plus or minus 0.08.
L1 carries two thirds of it, because **[DOC]** the brief specifies *low-frequency* noise, and the failure mode of doing this with high-frequency noise is a surface that looks dirty rather than moulded.

Value noise is generated by filling a small grid with `mulberry32` values and bilinearly upsampling.
For a 1024 tile, L1 uses a 8x8 grid, L2 a 20x20 grid, L3 a 54x54 grid.
Grid sizes are chosen so the grid wraps: index with `(i + n) % n` on both axes and the upsample is seamless without needing `drawWrapped` at all.
**[CALC]** Bilinear upsample of three octaves over 1024 squared is roughly 3.1 million multiply-adds, which is single-digit milliseconds. **[GUESS]**

### 4.4 Per-kind parameters

| Kind | Used by | Base rough | Swing | Panel pitch | Parting | Ejector | Vents | Normal strength |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shell` | robot torso, head, hands | 0.32 | +/- 0.055 | 0.12 m | yes | no | no | 1.2 |
| `abs` | stepping blocks, plinth cap, portal door, arms | 0.38 | +/- 0.080 | 0.40 m | yes | yes | optional | 1.5 |
| `moulded` | generated stone, section 5 | 0.72 | +/- 0.170 | none | yes, faint | no | no | 3.0 |
| `grip` | feet, bumpers | 0.78 | +/- 0.060 | none | no | no | no | 2.2, pebble pattern |

`shell` gets the smallest roughness swing of any kind.
The brief's rule is that the character is a **value anomaly** and the least saturated, most uniform thing in frame, so breaking it up as hard as a world prop would work against the separation mechanism that makes the character readable.

The occlusion mask is only written by L5, L8 and L9, and is clamped to `[0.55, 1.0]`.
The `aoMapIntensity` for surface maps is **1.0**, not the 1.35 that `stone()` uses, because unlike a photographic bake this occlusion is authored for exactly this geometry and does not need overdriving to survive.

### 4.5 Deriving the normal map from the height mask with Sobel

The height mask is a `Float32Array` of length `size * size` in the range 0 to 1.
Sobel with wraparound indexing so the normal map tiles like the height it came from.

```ts
/**
 * Tangent-space normal map from a height mask.
 *
 * `strength` is in height-units per pixel. The Sobel kernels sum to 4 on their
 * positive lobe, so dividing by 4 makes `strength` mean "slope of 1.0 in height
 * over 1 pixel produces a 45 degree normal", which is a scale a human can reason
 * about when tuning.
 *
 * Indexing wraps, so a tile whose height mask is seamless produces a normal map
 * that is seamless. Clamping instead would put a visible ridge on every tile
 * boundary, which is the classic way this goes wrong.
 */
function normalFromHeight(height: Float32Array, size: number, strength: number): ImageData {
  const out = new ImageData(size, size)
  const px = out.data
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1)
      const l  = at(x - 1, y),                       r  = at(x + 1, y)
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1)

      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr)

      // Both gradients are negated: a surface that rises to the +X side must
      // tilt its normal toward -X. Getting this sign wrong inverts every
      // groove into a ridge, and it looks plausible enough to ship by mistake.
      const nx = -gx * strength * 0.25
      const ny = -gy * strength * 0.25
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)

      const i = (y * size + x) * 4
      px[i]     = Math.round((nx * inv * 0.5 + 0.5) * 255)
      px[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      px[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255)
      px[i + 3] = 255
    }
  }
  return out
}
```

`normalScale` on the material stays at `(1, 1)` for every surface-map kind.
Amplitude is controlled by `strength` at generation time rather than by `normalScale` at render time, so there is one number to tune and it lives next to the height mask that produced it.

**[DOC]** The brief asks for a very low-amplitude normal map at 0.15 to 0.30 for moulding texture.
The `strength` values in section 4.4 are calibrated so the noise layers land in that band, with the panel-line and vent layers deliberately above it because those are structural features rather than surface texture.

A sanity check worth writing as a unit test: for a flat height mask, every output pixel must be exactly `(128, 128, 255)`.
That single assertion catches sign errors, normalisation errors and off-by-one wraparound errors in one line.

### 4.6 Tiling scales in metres

`repeat` is in tiles across a mesh's UV space, and UV space is not metres.
`RoundedBox`, `CylinderGeometry` and `CapsuleGeometry` all have their own UV conventions and none of them is area-uniform, which is why `usePbrTextures` already takes an explicit repeat per caller and `HubIsland.tsx` already documents solving for a consistent physical stone size.

The same discipline applies here.
**The authoring target is metres per tile; the value typed into the call is the repeat that produces it for that specific mesh.**

| Surface class | Metres per tile | Example, and the repeat it implies |
| --- | --- | --- |
| Hero character parts | **0.25 m** | robot torso, 0.62 x 0.60 x 0.44, repeat `[2.5, 2.4]` |
| Small hero props | **0.35 m** | lock plate 0.78 x 0.64, repeat `[2.2, 1.8]` |
| Character-scale props | **0.60 m** | plinth cap, 1.2 m around, repeat `[2, 1]` |
| World plastic | **1.00 m** | stepping block 2 x 1 x 2, repeat `[2, 1]` |
| Moulded stone | **1.20 m** | unchanged from the existing convention |
| Rubber grip | **0.12 m** | foot 0.22 x 0.30, repeat `[1.8, 2.5]` |
| Plateau ground | **8.00 m** | unchanged, `groundTexture.ts` owns it |

The 1.20 m figure for stone is deliberately kept from `HubIsland.tsx`, which already solves platform, ramp, ring, arch and plinth repeats against it.
**[DOC]** That file's comment about matching repeat count instead of physical scale being what makes tiled stone read as wallpaper is correct and should survive this change unaltered.

A helper belongs next to the presets:

```ts
/** Repeat count that puts one tile every `metresPerTile` across a UV span of `spanMetres`. */
export function tiles(spanMetres: number, metresPerTile: number): number {
  return spanMetres / metresPerTile
}
```

### 4.7 Cost and caching

One canvas and one `ImageData` pass per kind, memoized at module scope keyed on `kind:size`, exactly like `groundTexture.ts`'s `cached` and `textures.ts`'s `leveledCache`.
Callers get cloned textures with their own `repeat`, `wrapS`, `wrapT` and `anisotropy`, and must set `needsUpdate = true` after cloning, because **[DOC]** `textures.ts` already documents that `clone()` copies the descriptor and leaves `needsUpdate` false, so the GPU never receives the new wrap and repeat settings.

**[GUESS]** Generation cost, to be measured rather than trusted: 6 to 12 ms per kind at 512, 25 to 45 ms per kind at 1024.
**[CALC]** VRAM per kind is `size² * 4 bytes * 2 maps * 1.33 for mipmaps`, which is 5.6 MB at 1024 and 1.4 MB at 512.
Four kinds is 22 MB at high and 5.6 MB at medium.

The generation must not run during the first frame.
It belongs in the same load window as the texture preloads, behind the existing Suspense boundary.

---

## 5. The photographic stone and dirt

### 5.1 The case for replacing them

**[DOC]** The reference brief's section 1 is unambiguous: everything in the world is a manufactured object, grass is moulded rubber, and stone is a moulded stone-shaped object.
A photograph of real granite is precisely the thing that rule excludes, and the brief says so in as many words.

The evidence that it is already fighting the project is in the codebase.
**[DOC]** `textures.ts` runs a whole load-time levelling pass that exists only because the raw rock averages RGB(79, 76, 69) and rendered near-black regardless of tint, and `README.md` has a paragraph warning that the level is easy to get wrong and that too high a level clips the rock's bright half.
That is a bug workaround for a fundamental mismatch: the palette wants to drive colour, and the photograph insists on driving it instead.

The brief's value-band discipline compounds it.
Each level runs three value bands, none overlapping, and the acceptance test is that a greyscale frame must still read as where you can stand.
A photograph carries its own value histogram, and you cannot constrain a histogram you did not author.

There is also a tiling argument.
Photographic tiling betrays itself through repeated recognisable features, and the mitigation is anisotropy plus hoping.
`drawWrapped` produces a tile that is seamless by construction, and the features in it are ones we chose to be unrecognisable.

And a specular argument, which is the one that matters most for this document.
A photographic roughness map breaks the specular up the way real rock breaks it up, which is high frequency and irregular.
A moulded object breaks it up the way a mould breaks it up, which is low frequency and structured, with parting lines and draft.
The double-lobe read from section 1 is much harder to see through granite noise.

Finally, replacing stone deletes three WebP files from `public/textures/`, removes a levelling pass, removes a README paragraph, and removes half the attribution obligation in `LICENSE.txt`.

### 5.2 The case for keeping them

Authored photographic detail is genuinely dense and genuinely hard to reproduce.
A generated stone tile has whatever features I thought to draw, and nothing else.
The generated ground in `groundTexture.ts` works because it is deliberately near-featureless, and that is a much easier brief than "convincing rock".

Cost falls in the wrong place.
A WebP decodes off the main thread and uploads once.
A generated tile costs tens of milliseconds of main-thread JavaScript at load, and the tier most likely to notice is the tier that can least afford it.

The current look works.
`HubIsland.tsx` solves per-surface tiling against a 1.2 m physical stone size, `stone()` overdrives `aoMapIntensity` to 1.35 with a reasoned comment, and the levelling detail value of 0.8 is tuned against a specific clipping failure.
That is a lot of dialled-in surface, and replacing it is a real regression risk on something that currently reads correctly.

And there is a direct textual defence for the dirt.
**[DOC]** `Terrain.tsx` already argues that photographs earn their place on the cliff face and the stonework and nowhere else, and the rim genuinely is meant to read as earth rather than as a tint of something else.
**[DOC]** The brief's own layering rule says background layers get progressively less material detail and no cast shadows, and the island's rim, soil band and root cone are exactly that band.

### 5.3 Recommendation

**Replace stone. Keep dirt, and demote it.**

The split is not a compromise, it follows from where each set is applied.

`stone` is on the portal platform, the ramp, the portal ring's two bands, the arch legs and lintel, every lesson totem plinth, every boulder and every pebble.
Every one of those is a foreground or gameplay-band object that the player walks up to, stands on, and sees at close range.
That is where the manufactured-world rule bites hardest and where the palette most needs to drive colour.

`dirt` is on the rim cylinder, the soil band and, indirectly, the root cone.
Those are the island's underside.
They are never approached, never walked on, never a gameplay surface, and they sit in the background value band where the brief explicitly permits less material discipline.
The rim is also the one place in the world where the fiction is "this island was cut out of the ground", so a photograph is doing the right job.

Demoting dirt means three changes: `normalScale` from (1.4, 1.4) to (1.1, 1.1), `envMapIntensity` to 0.55, and `aoMapIntensity` from 1.5 to 1.2.
The rim should recede, not compete.

If purity is later wanted, generating dirt is the same algorithm below with different parameters, so it is a follow-up rather than a rewrite.

### 5.4 The moulded stone generation algorithm

New function in `surfaceTexture.ts`, kind `moulded`, at 1024 squared, memoized at module scope, seamless through `drawWrapped` and wrapped grid indexing.

**Albedo.**
The whole point is that the palette drives hue, so the albedo is near-white and carries only value structure.

1. Fill with `#dedede`, which is 0.87.
   That is close to the 188 of 255 the levelling pass currently targets, so existing `palette.rock` tints land at roughly the value they land at today and the change is not also a lighting change.
2. Three octaves of wrapped value noise at 8x8, 20x20 and 54x54 grids, amplitudes plus or minus 0.045, 0.022 and 0.011 in value.
   This is the block mottle.
3. **Facet crevices.** 34 wrapped polylines, each 3 to 6 segments.
   Each segment has a length of 40 to 160 px and a direction chosen from the twelve 30-degree headings.
   Constraining turns to 30-degree increments is the single decision that makes these read as moulded facet joins rather than as organic cracks: a crack wanders, a facet join turns at an angle the mould could actually release from.
   Stroke `rgba(0,0,0,0.16)` at `lineWidth` 2 to 5, `lineCap` and `lineJoin` round.
4. **Crevice lips.** The same polyline redrawn offset by (+1, -1) px at `rgba(255,255,255,0.10)`, `lineWidth` 1.
   This is the raised edge that catches the key, and it is why a crevice reads as depth rather than as a dark line.
5. **Chips.** 120 wrapped ellipses, radius 2 to 6 px, `rgba(255,255,255,0.09)`, each with a `rgba(0,0,0,0.07)` crescent on the side away from the tile's notional key direction of (0.6, -0.8).
6. **Parting line.** One wrapped horizontal at `y = 0.5 * size`, `lineWidth` 2 at `rgba(0,0,0,0.08)`, with a 1 px `rgba(255,255,255,0.11)` line directly above it.
   One line per tile means one every 1.2 m of world, which is the right frequency for something moulded in a kit of parts.

**Height mask** uses the same draws with different weights: base 0.60, noise plus or minus 0.10 summed, crevices to 0.24, lips to 0.70, chips to 0.72, parting ridge to 0.66.
Normal map from `normalFromHeight` at `strength = 3.0`.

**Roughness mask**: base green 204, noise plus or minus 0.17 of the 161-to-247 range, crevices `+0.20` of the range because dust settles in a groove, chips `-0.10` because a pit in a mould is polished.

**Occlusion mask**: 1.0 everywhere, `0.62` inside a crevice, `0.86` inside a chip, then a 3 px box blur, then clamped to `[0.55, 1.0]`.

Packed as ORM with occlusion in red and roughness in green, matching the existing convention exactly, so `stone()`'s signature and the `PbrMaps` type do not change and the swap is one import per call site.

**What this deletes.**
`SETS.stone` and the entire `levelAlbedo` function in `textures.ts`, once no caller asks for stone.
`levelAlbedo` and the `leveledCache` stay only as long as any set still needs levelling, and dirt does not, so both go.
The three `stone-*.webp` files leave `public/textures/`.
The README paragraph beginning "Stone has its albedo levelled at load" is replaced by a paragraph about generated surface maps.

---

## 6. Bevel and edge policy

**[DOC]** The reference brief: never a 90 degree hard corner on a plastic object, every edge takes a bevel that catches the key as a bright line.

### 6.1 The rule

> **Fillet radius `r = k * d_min`**, where `d_min` is the object's smallest bounding dimension.
> `k = 0.08` for hero objects, `k = 0.05` for world geometry.
> Hard floor of **8 mm** on anything, and **15 mm** on anything normally read from more than 5 m.
> Hard ceiling of `0.25 * d_min` on world geometry, uncapped on the character.

The floors are a screen-space argument, not an aesthetic one.
**[CALC]** At the current 55-degree vertical FOV and 1080 px, one pixel subtends 7.1 mm at 8 m, 2.7 mm at 3 m and 17.8 mm at 20 m.
A bevel that is not at least two pixels wide cannot produce a bright line, it produces one aliased pixel of intermediate colour, and **[DOC]** the brief says aliasing destroys the moulded-object illusion faster than anything else.
So 8 mm is the floor for things read at arm's length and 15 mm for things read across the island.

**[GUESS]** If the FOV narrows to the 35 to 45 degrees the brief recommends, one pixel subtends less and these floors could come down by roughly a third.
Do not act on that until the camera actually changes.

### 6.2 Where the current world stands

| Object | `d_min` | radius | ratio | verdict |
| --- | --- | --- | --- | --- |
| Robot torso | 0.44 | 0.16 | 0.36 | fine, hero is uncapped |
| Robot head | 0.44 | 0.14 | 0.32 | fine |
| Chest panel | 0.06 | 0.05 | 0.83 | fine, effectively a lozenge |
| Portal platform | 0.80 | 0.20 | 0.25 | at the ceiling, keep |
| Stepping blocks | 1.00 | 0.12 | 0.12 | good |
| Portal arch legs | 0.50 | 0.12 | 0.24 | good |
| Portal door slab | 0.24 | 0.08 | 0.33 | fine |
| **Ramp** | 0.30 | **0** | **0** | **violation**, plain `boxGeometry` |
| **Helmet crest** | 0.06 | **0** | **0** | **violation**, plain `boxGeometry` |
| **Cape** | 0 | **0** | - | **violation**, zero-thickness `planeGeometry` |
| **Plateau rim lip** | - | **0** | **0** | **violation**, `circleGeometry` meets `cylinderGeometry` at 90 degrees |
| **Totem plinth, both tiers** | - | **0** | **0** | **violation**, `cylinderGeometry` caps |
| **Totem accent ring** | - | - | - | acceptable, a torus is all fillet |
| **Token crystals** | - | **0** | **0** | **violation**, `coneGeometry` base and apex |
| **Node sculpture pillar** | - | **0** | **0** | **violation**, `cylinderGeometry` caps |
| **Antenna rod** | 0.036 | **0** | **0** | violation, but below the 8 mm floor so exempt |
| **Ear pods** | 0.06 | **0** | **0** | violation, `cylinderGeometry` rim, 60 mm so not exempt |
| **Robot arms and upper legs** | - | - | - | fine, `capsuleGeometry` is all fillet |
| **Lock plate keyhole slot** | 0.01 | **0** | **0** | exempt, below floor |

### 6.3 Fixes

`RoundedBox` handles every box case and three of the violations are one-line swaps: the ramp gets `radius 0.06`, the helmet crest `radius 0.02`, and the cape becomes a `RoundedBox` at `[0.6, 0.7, 0.03]` with `radius 0.014` in `vinyl()`.
That last one also discharges the fabric-to-vinyl rule from section 2.

Cylinders and cones have no equivalent, and three ships no chamfered-cylinder primitive.
A `BeveledCylinder` helper is needed, built from `LatheGeometry` over a profile whose corners are three-point arcs:

```ts
/**
 * A cylinder whose top and bottom rims are filleted.
 *
 * Points run bottom-inner to top-inner up the outside, and LatheGeometry
 * revolves them. `corner` segments per fillet: 3 is enough for a rim under
 * 40 mm, 5 for anything larger.
 */
function beveledProfile(rBottom: number, rTop: number, height: number, fillet: number, corner = 3): Vector2[]
```

Applied to the plinth base at `fillet 0.04`, the plinth cap at `fillet 0.035`, the node pillar at `fillet 0.03`, the ear pods at `fillet 0.012`, and the token crystal cones at `fillet 0.03` on the base with the apex truncated to a 20 mm flat.
A cone with a mathematically sharp point is not something a mould can produce, and truncating it is both more correct and better looking.

The plateau rim needs a torus, not a lathe: a `torusGeometry` of tube radius 0.12 at `y = 0`, radius `PLATEAU_RADIUS - 0.12`, rotated flat.
**[DOC]** `Terrain.tsx` requires the walkable surface to stay geometrically flat because the collider is a flat cylinder, and a separate rim torus does not touch the collider at all.

`smoothness` policy on `RoundedBox`: **4** on anything within 3 m of the camera in normal play, **3** for world geometry, **2** for instanced scatter, dropping one step at the low tier.

---

## 7. Surface-detail vocabulary

**[DOC]** The brief names four marks that injection moulding leaves: parting lines, ejector-pin circles, draft angles and bevels.
**[DOC]** It separately names printed-circuit-board patterns and LED faceplates as the props' "digital DNA".

This world should have exactly six marks and no more.
A vocabulary that is too large stops reading as a manufacturing process and starts reading as noise.

### 7.1 Panel lines

Grooves separating moulded parts.
Drawn into the height, roughness and occlusion masks as layers L5 and L6 of section 4.3.

Width **2.5 mm**, depth **1.0 mm**, always paired with a 1 px lip on the key side.
Pitch is **0.12 m** on `shell` and **0.40 m** on `abs`.
Lines run on a grid with 30% of intersections suppressed at random, so the result reads as parts rather than as tiling.
Lines never cross a bevel: any line within one fillet radius of a mesh edge is culled at generation time by masking the tile's border region.

### 7.2 Parting lines

The mould split, and the most characteristic mark of the whole set.
**One per part, never more.**
1.0 mm wide, expressed as a 1 px normal ridge and a roughness dip of 0.02, never as an albedo change.

On the character it runs horizontally around the widest silhouette of each part, because a toy of this shape splits into a front half and a back half.
On world props it runs at the tile's vertical midpoint, which puts one every 0.4 m on `abs` and every 1.2 m on `moulded`.

### 7.3 Ejector-pin circles

Discs of **4 to 9 mm** where the pins pushed the part out of the mould.
Roughness `+0.045`, height `-0.03`, occlusion 0.90, no albedo change.

Density is one per **0.05 square metres**, and they appear **only on `abs`**, never on `shell`.
Real ejector marks are on the hidden face of a part, and the robot has no hidden faces at this camera.
Putting them on the character would be technically accurate and would read as damage.

### 7.4 Vents and grilles

Slotted rectangles, and the one mark that is allowed to be placed by hand rather than tiled, because a vent means something.
Slot pitch **6 mm**, slot width **2.5 mm**, depth **2 mm**, groups of 5 to 9 slots inside a rounded rectangle.

Three placements are earned by the fiction and no others:
the robot's back, below the cape socket, because that is where a machine puts its exhaust;
the lesson totem plinth's collar, because the plinth is holding something powered;
and the portal arch's inner face, because the arch is the machine that does the travelling.

### 7.5 Decals

**[DOC]** This is where the digital-DNA doctrine goes.
A library of four screen-printed marks drawn to a 256 square transparent canvas each:

1. A PCB trace fragment, reusing `groundTexture.ts`'s existing trace-and-pad routine at a smaller scale.
2. A 5x5 module block, QR-like without being a real QR code.
3. A part code, rendered text in the form `AA-000`, seeded per instance.
4. A chevron, used only on things that move or that mark a direction.

Applied as **decal meshes**, a small plane offset 1 mm along the surface normal with `polygonOffset: true` and `polygonOffsetFactor: -1`, not as a second texture channel.
That is deliberate: a decal you can place by hand at an exact spot is worth far more than a decal that lands wherever the tiling puts it, and one small plane is cheaper than a second UV set.

### 7.6 Draft angle

Not a texture, a geometry rule.
No moulded prop has perfectly parallel vertical sides.
**Minimum taper 1.5 degrees**, which is a top radius of `0.974 x` the bottom radius over 1 m of height.

The totem plinth already tapers 0.9 to 0.75 over 0.5 m, which is 17 degrees, and the node pillar 0.22 to 0.18 over 2.8 m, which is 0.8 degrees.
The first is a design choice and is fine, since the rule is a minimum.
The second is below the minimum and should go to 0.22 to 0.155.

### 7.7 The restraint rule

> At most **three** of the six marks on any one object, and never more than **one mark type per face**.

Without this rule the surface system produces objects that are simultaneously panel-lined, vented, ejector-marked, decalled and parted, and the result reads as a greeble rather than as a toy.
**[DOC]** The brief's own composition rules point the same way: give playable and decorative geometry different shape languages, and use decoration to fill unused space rather than to fill every surface.

#### The unit is a PANEL, not a face

Amended, because "one mark type per face" was written for a 0.3 m moulded part where a face is one mould facet, and it does not survive being applied to a surface a hundred times that size.

The hub's largest walkable face is about 113 square metres.
Read literally, the rule grants that face exactly one mark, which is not restraint - it is round 1's finding that the decks carried "literally zero surface detail", restated as a rule.
Three of the four generated kinds already broke it, carrying panel lines and ejector circles on the same face.

So the unit is re-scoped one level down:

> A face carries the seams that divide it into panels, plus **at most one mark inside each panel**.

The intent is preserved exactly - nothing is simultaneously perforated and hazarded and traced - and only the granularity changes.
A deck under this scoping carries two of the six: seams, and one fill per panel.

**And a mark below the pixel is not restraint either, it is absence.** The reason this needed amending at all is that the first attempt at deck detail was invisible, and the dominant cause was scale rather than channel: at the game's framing one screen pixel is about 26 mm of deck, so the 2.5 mm groove this section specifies is a tenth of a pixel, erased by the mip chain whether it is printed or cut and at any contrast. The reference's inter-panel insets are visibly centimetres wide. A mark's width has to be specified against the resolution it will be seen at, and 2.5 mm is a specification for an object held in the hand.

---

## 8. Emissive policy

### 8.1 How the threshold actually works, with numbers

**[DOC]** `PostFX.tsx` runs `Bloom` at `luminanceThreshold={1.75}` with `luminanceSmoothing={0.3}`, before `ToneMapping`, so it sees raw HDR.
`postprocessing`'s luminance function is `dot(color, vec3(0.2125, 0.7154, 0.0721))`.
three adds emission as `emissive * emissiveIntensity` directly into the fragment's outgoing radiance, and `emissive` is a colour, so it is decoded from sRGB to linear on assignment.

Therefore, for an emissive surface facing away from all lights:

> **raw luminance = luma(linear(emissiveColor)) x emissiveIntensity**

**[CALC]** Computed for every emissive colour in the palette:

| Palette colour | Hex | linear luma | intensity to reach 1.75 | to reach 2.19 (bloom with headroom) | to reach 1.15 (bright, no bloom) |
| --- | --- | --- | --- | --- | --- |
| `visor` / `circuit` | `#4de2ff` | 0.6319 | 2.77 | **3.47** | 1.82 |
| `unlocked` | `#ffd45e` | 0.6916 | 2.53 | **3.17** | 1.66 |
| `accent` | `#ff9a3c` | 0.4469 | 3.92 | **4.90** | 2.57 |
| `nodeGlow` | `#a99bff` | 0.3909 | 4.48 | **5.60** | 2.94 |
| `token` | `#ff6bd6` | 0.3662 | 4.78 | **5.98** | 3.14 |
| `caveCrystal` | `#8b7bff` | 0.2687 | 6.51 | **8.15** | 4.28 |
| `accentDeep` | `#e0651a` | 0.2522 | 6.94 | **8.68** | 4.56 |
| `node` | `#7c6bff` | 0.2201 | 7.95 | **9.95** | 5.22 |

**This table contains the single most important finding in this document.**

The robot's visor is currently `emissive(palette.visor, 2.4)`.
**[CALC]** That is a raw luminance of `0.6319 x 2.4 = 1.52`, which is **below the 1.75 threshold**.
The one thing on the character that is supposed to glow does not glow, and **[DOC]** the brief says the entire reason to run a high bloom threshold is so the emissive clears it while the white plastic does not.

Every other emissive in the world is below threshold too.
The highest is the completion tick at `0.6916 x 2.2 = 1.52`, and the totem ring on approach at `0.6916 x 3.2 = 2.21` is the only thing in the game that currently blooms at all.

The second finding is about hue.
Violet has almost no luminance.
`palette.node` at `#7c6bff` needs `emissiveIntensity` around **8** to bloom, at which point it is being asked to output eight times the brightest lit surface in the scene, and the tone mapper will render it as flat white with a violet fringe.
**Violet and magenta emissives should not be asked to bloom at all.**
Where a violet element must read as a light source, add a small pale core mesh, exactly the trick `PortalShimmer.tsx` already uses with `uCoreColor: '#dffaff'`.
**[CALC]** `#dffaff` has linear luma 0.9128 and needs only 2.40 to bloom with headroom.

### 8.2 The three tiers

**Tier A, must bloom.** Target raw luminance **2.19**, which is 1.25 times threshold.
The headroom matters because `luminanceSmoothing: 0.3` means the bloom contribution ramps rather than switching, so a value sitting exactly at 1.75 contributes almost nothing.

**Tier B, must read as a light source but must not bloom.** Target **1.15**, which is 66% of threshold.
This is the largest group and it is where most of the world's glow lives.

**Tier C, colour hold only.** Target **0.10 to 0.25**.
Emissive used purely so a surface does not go dead in shadow, never as light.

### 8.3 The assignments

| Object | Colour | Tier | New `emissiveIntensity` | Currently | Raw luma now |
| --- | --- | --- | --- | --- | --- |
| Robot visor bar | `visor` | **A** | **3.5** | 2.4 | 1.52, does not bloom |
| Robot antenna tip | `accent` | **A** | **4.9** | 2.0 | 0.89 |
| Portal trim, open | `accent` | **A** | **4.9** | 1.6 | 0.71 |
| Totem completion tick | `unlocked` | **A** | **3.2** | 2.2 | 1.52 |
| Totem accent ring, near, complete | `unlocked` | **A** | **3.2** | 3.2 | 2.21, correct already |
| Totem accent ring, near, incomplete | `nodeGlow` | **B** | **2.9** | 3.2 of `node` | 0.70 |
| Totem accent ring, at rest | `unlocked` / `nodeGlow` | **B** | **1.7** / **2.9** | 1.4 | 0.97 / 0.31 |
| Portal ring powered inlay, open | `visor` | **B** | **1.8** | 1.15 | 0.73 |
| Ground circuit traces | `circuit` | **B** | **1.3** | 1.2 | 0.76 |
| Token crystals, main | `token` | **B** | **3.1** | 0.9 | 0.33 |
| Token crystals, secondary | `token` | **B** | **2.5** | 0.7 | 0.26 |
| Node sculpture core | `node` | **B** | **5.2** | 1.1 | 0.24 |
| Node sculpture satellites | `nodeGlow` | **B** | **2.9** | 1.4 | 0.55 |
| Totem concept node | `node` / `unlocked` | **B** | **5.2** / **1.7** | 0.7 to 1.6 | below 0.3 |
| Scatter flower heads | `token` | **C** | **0.55** | 0.35 | 0.13 |
| Robot shell emissive floor | `#ffb489` | **C** | **0.08** | none | 0.045 |

The Tier A set is deliberately tiny: the visor, the antenna tip, the open portal's trim, and completion.
**[DOC]** The brief's rule is that blue LED means ally and gold means reward, globally and without exception, and everything in Tier A is one of those two semantics.
Nothing in the environment is Tier A, which is what keeps bloom reading as feedback rather than as weather.

The `node` violet entries at 5.2 sit at 66% of threshold and read as saturated violet rather than as light, which is the correct outcome per section 8.1.
If the node sculptures need to feel powered from across the island, the fix is a small `#dfd8ff` core sphere inside the icosahedron at intensity 2.4, not a higher violet.

### 8.4 Keeping lit diffuse below the line

**[DOC]** `Lighting.tsx` states that diffuse surfaces need to land below roughly 1.4, which leaves only 0.35 of headroom under the 1.75 threshold.
That is thin, and this document adds clearcoat and environment weighting to surfaces that did not have them.

Two budgets protect it.

**Specular budget.** For any surface not intended to bloom:

> `max Lightformer radiance x envMapIntensity <= 1.60`

At grazing angles the clearcoat Fresnel term approaches 1.0, so the reflected environment arrives essentially undimmed.
The brightest `Lightformer` in the hub rig is currently 1.1, and the highest `envMapIntensity` in section 1.2 is 1.30 on `visorPlate`, giving `1.43`, which passes.
Adding the brief's recommended long thin strip light is where this budget will actually bite: a strip at intensity 1.5 against `shell()`'s 1.15 gives 1.73, which is inside the budget but only just.
**If a strip light above intensity 1.5 is wanted, the bloom threshold moves to 2.0 first**, and every Tier A intensity in section 8.3 scales by `2.0 / 1.75 = 1.143`.

**Punctual specular is not budgetable and is accepted.**
A `directionalLight` is a delta light, so on a clearcoat at roughness 0.10 it produces a peak GGX response far above 1.75 over a very small number of pixels.
That pinpoint will bloom.
**[DOC]** The brief permits this, saying only emissives and specular hits should bloom.
It is why section 1.1 sets a 0.10 floor on curved surfaces: the highlight has to spread across several pixels so it reads as a highlight rather than as a firefly, and the smoothing value of 0.3 then softens its onset.
The failure to watch for is a pinpoint that pops in and out between frames as the robot walks, which is a temporal aliasing symptom and would mean the floor needs to be 0.12 or 0.14.

---

## 9. Object to preset map

Every mesh currently in the hub.

### `RobotModel.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Torso | `plastic(shell)` | **`shell(palette.shell)`**, surface maps `shell`, repeat `[2.5, 2.4]` |
| Head | `plastic(shell)` | **`shell(palette.shell)`**, surface maps `shell`, repeat `[2.2, 1.8]` |
| Chest panel | `plastic(accent)` | **`plastic(palette.accent)`** |
| Visor bar | `emissive(visor, 2.4)` | **`led(palette.visor, 3.5)`** |
| Visor plate, new | - | **`visorPlate()`**, a 0.46 x 0.14 x 0.02 `RoundedBox` behind the bar |
| Neck ring, new | - | **`chrome()`**, a 0.02 tube torus at the head-torso join |
| Antenna rod | `metal(rock)` | **`anodised(palette.rock)`** |
| Antenna tip | `emissive(accent, 2.0)` | **`led(palette.accent, 4.9)`** |
| Ear pods | `plastic(accentDeep)` | **`plastic(palette.accentDeep)`**, beveled cylinder, `fillet 0.012` |
| Arms | `plastic(accent)` | **`plastic(palette.accent)`** |
| Hand props | `plastic(shell)` | **`shell(palette.shell)`** |
| Upper legs | `mattePlastic(shellShadow)` | **`vinyl(palette.shellShadow)`** |
| Feet | `rubber(lockedDeep)` | **`rubber(palette.lockedDeep)`**, surface maps `grip`, repeat `[1.8, 2.5]` |
| Helmet dome | `plastic(unlocked)` | **`plastic(palette.unlocked)`** |
| Helmet crest | `plastic(accentDeep)` | **`plastic(palette.accentDeep)`**, `RoundedBox` `radius 0.02` |
| Cape | `mattePlastic(token)` | **`vinyl(palette.token)`**, `RoundedBox` `[0.6, 0.7, 0.03]` `radius 0.014` |

### `Terrain.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Plateau circle | inline `roughness 0.95` | **`plateau()`**, keeping `createGroundTexture()` as `map`, adding a green-channel-only roughness map at 8 m per tile, still no normal map |
| Plateau rim fillet, new | - | **`plateau()`**, torus tube 0.12 |
| Rim cylinder | `ground(soil, dirt)` | **`ground(palette.soil, dirt)`** demoted: `normalScale (1.1, 1.1)`, `aoMapIntensity 1.2`, `envMapIntensity 0.55` |
| Soil band | `ground(soil, dirt)` | same demotion |
| Root cone | `mattePlastic(soilDeep)` | **`mattePlastic(palette.soilDeep, { envMapIntensity: 0.35 })`** |

`plateau()` deliberately keeps `Terrain.tsx`'s existing decision that the walkable surface takes no normal map, because a specular highlight crossing it makes a lawn read as wet rock.
The roughness map is the one addition, and it exists so the grazing-angle sheen breaks up rather than sweeping across the island as one uniform band.

### `HubIsland.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Portal platform | `stone(rock, [6,4])` | **`stone(palette.rock, moulded, [6,4])`** |
| Ramp | `stone(rock, [3,3])` | **`stone(palette.rock, moulded, [3,3])`**, `RoundedBox` `radius 0.06` |
| Portal ring, outer band | `stone(#6c7684)` | **`stone('#6c7684', moulded)`** |
| Portal ring, inner band | `stone(#e8edf2)` | **`stone('#e8edf2', moulded)`** |
| Portal ring inlay, open | `emissive(visor, 1.15)` | **`led(palette.visor, 1.8)`** |
| Portal ring inlay, locked | `mattePlastic(#2c3240)` | **`rubber('#2c3240')`** |
| Stepping blocks | `plastic(accent)` | **`plastic(palette.accent)`**, surface maps `abs`, repeat `[2, 1]` |
| Ground circuit traces | `emissive(circuit, 1.2)` + transparent | **`glowStrip(palette.circuit, 1.3)`** |
| Token crystals, main | `emissive(token, 0.9)` + transparent | **`crystal(palette.token, 3.1)`**, truncated apex, `fillet 0.03` |
| Token crystals, secondary | `emissive(token, 0.7)` | **`crystal(palette.token, 2.5)`** |
| Node sculpture pillar | `mattePlastic(rock)` | **`mattePlastic(palette.rock)`**, beveled cylinder `fillet 0.03`, taper to 1.5 degrees, one vent group |
| Node sculpture core | `emissive(node, 1.1)` | **`led(palette.node, 5.2)`** plus a `#dfd8ff` core at 2.4 |
| Node sculpture satellites | `emissive(nodeGlow, 1.4)` | **`led(palette.nodeGlow, 2.9)`** |

### `Portal.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Arch legs, lintel | `stone(stoneColor, [1.4,3])` | **`stone(stoneColor, moulded, [1.4,3])`**, one vent group on the inner face |
| Trim, open | `emissive(accent, 1.6)` | **`led(palette.accent, 4.9)`** |
| Trim, locked | `mattePlastic(locked)` | **`mattePlastic(palette.locked)`** |
| Sealed slab | `mattePlastic(lockedDeep)` | **`mattePlastic(palette.lockedDeep)`**, surface maps `abs` repeat `[3, 4]`, panel lines on |
| Banding | `mattePlastic(locked)` | **`plastic(palette.locked)`**, so the band steps up in gloss as well as value |
| Lock plate shackle | `plastic('#aab3c2')` | **`anodised('#aab3c2')`** |
| Lock plate body | `plastic('#c3cad6')` | **`plastic('#c3cad6')`**, surface maps `abs` repeat `[2.2, 1.8]` |
| Keyhole disc and slot | `meshBasicMaterial` | **`rubber(palette.lockedDeep)`** |
| Portal shimmer | custom shader | unchanged |

The two `meshBasicMaterial` keyhole pieces are the only unlit surfaces on an otherwise lit object, which means they do not darken in shadow and read as holes cut through to a flat colour.
`rubber()` at `envMapIntensity 0.45` gives the same near-black read while responding to light.

### `LessonTotem.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Plinth base | `stone(rock, [4,1])` | **`stone(palette.rock, moulded, [4,1])`**, beveled cylinder `fillet 0.04` |
| Plinth cap | `plastic(shell)` | **`plastic(palette.shellShadow)`**, beveled cylinder `fillet 0.035`, one vent group on the collar |
| Accent ring | `emissive(glow, 1.4/3.2)` | **`led(...)`** per section 8.3 |
| Concept node | `gel(glow)` | **`crystal(glow)`** per section 8.3 |
| Completion tick | `emissive(unlocked, 2.2)` | **`led(palette.unlocked, 3.2)`** |

The plinth cap moving from `palette.shell` to `palette.shellShadow` is a value-band decision, not a material one.
**[DOC]** The brief's separation mechanism is that the character is the brightest, least saturated thing in frame, and a white cap on every totem at exactly the robot's shell value competes directly with it.

### `Scatter.tsx`

| Mesh | Now | New |
| --- | --- | --- |
| Boulders | `stone(rock, [2,2])` | **`stone(palette.rock, moulded, [2,2])`** |
| Pebbles | `stone(rock, [2,2])` | **`plastic(palette.rockDeep)`** at low and medium, `stone(..., moulded)` at high |
| Clover | `plastic(grassDeep)` overridden | **`flock(palette.grassDeep)`** |
| Flower stems | `plastic(grassDeep)` overridden | **`rubber(palette.grassDeep)`** |
| Flower heads | `plastic(token)` + emissive 0.35 | **`vinyl(palette.token)`** + emissive 0.55 |

Pebbles are 9 cm across and never occupy more than a few pixels, so a 1024 square surface map on them is pure waste below the top tier.

### `Grass.tsx` and `Flowers.tsx`, the deliberate exception

Both stay on `MeshStandardMaterial`.

`MeshPhysicalMaterial` extends `MeshStandardMaterial` and the vertex chunks both files patch exist identically in the physical shader, so switching is technically available.
It should not be taken.
**[DOC]** At the high tier the grass field is 220,000 instances of a 16-triangle blade, which is 3.5 million triangles, and putting a clearcoat GGX evaluation plus a sheen lobe behind every one of those fragments to add a highlight to a 3 cm blade is the worst cost-to-benefit trade available in this project.

The compensations, which cost nothing:

- Grass `roughness` from **0.85 to 0.62**, so blades have some directionality and read as moulded rubber rather than as flat green.
- Grass `envMapIntensity` **0.60**, so the field picks up the sky from the `Lightformer` rig.
- Flowers `roughness` from **0.72 to 0.58** and `envMapIntensity` **0.70**, since petals are the shinier of the two.
- Both keep `vertexColors` and both keep every existing shader patch untouched.

Both files also need the `ShaderChunk` regression test from section 3.3.

---

## 10. Tier gating

`low` must be genuinely zero-cost, which here means it does no canvas work, allocates no extra textures, and compiles no extra shader variants.

### 10.1 New `QualitySettings` fields

```ts
/** Generated surface map resolution. 0 means no maps are generated at all. */
surfaceMapSize: 0 | 512 | 1024
/** Whether presets that specify sheen actually set it. Adds USE_SHEEN. */
sheen: boolean
/** Anisotropy on `anodised()`. Adds USE_ANISOTROPY. */
anisotropy: boolean
/** `gel()` at all. False makes every gel call fall back to `crystal()`. */
transmission: boolean
/** `RoundedBox` smoothness for world geometry. Hero is always 4. */
bevelSmoothness: 2 | 3 | 4
/** Decal meshes from section 7.5. */
decals: boolean
/** Phase 2 wrap-diffuse on the shell. */
wrapDiffuse: boolean
```

### 10.2 The values

| Setting | `low` | `medium` | `high` |
| --- | --- | --- | --- |
| `surfaceMapSize` | **0** | 512 | 1024 |
| `sheen` | **false** | hero only | true |
| `anisotropy` | **false** | false | true |
| `transmission` | **false** | true | true |
| `bevelSmoothness` | **2** | 3 | 4 |
| `decals` | **false** | false | true |
| `wrapDiffuse` | **false** | false | true |

`sheen: 'hero only'` is expressed as a boolean the presets read, with `flock()` and `rubber()` checking it and `shell()` checking a separate flag, rather than three states.
Simplest implementation is two booleans, `sheenHero` and `sheenWorld`.

### 10.3 What survives at `low`, and why

**Clearcoat survives at every tier, including low.**
It is not negotiable.
**[DOC]** `materials.ts`'s own header says it outright: without clearcoat, everything reads as untextured programmer art no matter how good the palette is.
The two-lobe separation from section 1 is the entire look, and it is the cheapest part of this document: it is one extra GGX evaluation and one extra Fresnel term, where sheen is a Charlie distribution plus two `IBLSheenBRDF` calls plus an energy compensation term.

**`envMapIntensity` survives at every tier.**
It is a uniform multiply and costs nothing.

**All roughness, metalness and colour constants survive at every tier.**
The revised numbers in section 1.2 are free.
The low tier gets the corrected two-lobe plastic, just uniformly across each surface.

**What `low` gives up:** roughness and normal variation, sheen, anisotropy, transmission, decals, wrap diffuse, and one step of bevel smoothness.
Nothing on that list requires a canvas, a texture upload, or a shader variant, so switching to `low` is a genuine reduction rather than a differently-shaped cost.

**What `medium` gives up:** anisotropy, decals, wrap diffuse, world sheen, and half the surface map resolution.

### 10.4 The material construction consequence

**[DOC]** `MeshPhysicalMaterial.js` bumps the material version when `sheen`, `clearcoat`, `anisotropy`, `iridescence` or `transmission` crosses zero, which forces a shader recompile.

Materials therefore must be **constructed** with the tier's values, not mutated into them.
A tier change from the HUD selector must remount the scene, or at minimum rebuild every material, rather than assigning new property values to live materials.
Doing it the other way produces a visible freeze at the moment the player changes quality, which is the worst possible moment for one.

---

## 11. Acceptance tests

Six checks, in the order they should be run.

1. **The greyscale test.** **[DOC]** From the brief, and not a metaphor: desaturate a hub screenshot and you must still instantly read where you can stand.
2. **The shadow-luminance test.** Sample the darkest pixel of the robot's torso with the key behind it. Rec.709 luminance at or above 0.28, saturation at or above 0.05. This is the gate on Phase 2 in section 3.2.
3. **The no-white-plastic-bloom test.** Screenshot with and without `?nofx`. Difference the two. Any pixel that gained more than 0.02 of luminance and is not one of the Tier A objects from section 8.3, or a specular pinpoint, is a failure.
4. **The two-lobe test.** Orbit the camera slowly around a stepping block. Two distinct highlights must be visible on the top face, a broad soft one and a tight bright one, and they must travel at different rates. If they read as one highlight, the ratio rule in section 1.1 has been violated somewhere.
5. **The tiling test.** Stand at the island edge and look across it at a grazing angle. No repeated recognisable feature in the stone at 1.2 m spacing.
6. **The chunk-token test.** `npm test` must fail if three moves any patched shader chunk statement. Sections 3.3 and 9.

---

## 12. Implementation order

Ordered by look-per-hour, following the brief's own priority list.

1. Section 1.2's revised constants in `materials.ts`. One file, no new dependencies, and it is the single largest change in the document.
2. Section 8.3's emissive intensities. The visor not clearing the bloom threshold is a live bug.
3. Section 2's `shell()`, `visorPlate()`, `crystal()`, `glowStrip()`, `vinyl()`, `flock()`, `anodised()`, `chrome()`, plus section 9's call-site swaps.
4. Section 3.2, Phase 1 subsurface. Three property values on one preset.
5. Section 6's bevel fixes, starting with the four one-line ones.
6. Section 4's `surfaceTexture.ts`, and section 10's tier fields.
7. Section 5.4's moulded stone, replacing the photographic set.
8. Section 7's panel lines, parting lines, ejector marks and vents, which fall out of section 4 nearly free once it exists.
9. Section 7.5's decals, high tier only.
10. Section 3.3, Phase 2, only if test 2 in section 11 says so.
