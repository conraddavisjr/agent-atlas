# Lighting design spec: the hub

Status: design only.
Nothing in this document has been implemented.
A build agent should be able to work from it without re-deriving anything.

It is written against `docs/design/00-references.md`, which is the art direction this is subordinate to.
Where this spec and the reference brief disagree, the brief wins and this document is wrong.

## How claims are marked

The reference brief marks its claims and this one does the same, because the failure mode here is a build agent treating an aesthetic guess as a measured constant.

- **[SRC]** verified by reading the installed library source in `node_modules`, at the versions in `package.json`. Facts.
- **[CALC]** computed from three's shading maths (`lights_fragment_begin`, `BRDF_Lambert`, `getHemisphereLightIrradiance`) and sRGB/linear conversion. Arithmetic, so checkable, but the inputs are estimates where noted.
- **[GUESS]** an aesthetic pick. Defensible, not derived. These are the numbers to move first when something looks wrong.

---

## 0. The diagnosis in one paragraph

The hub is lit from one hemisphere by three lights that all point roughly the same way, plus an environment map with no dark values.
The result is competent and completely flat: nothing has an edge, nothing separates from the ground, and the clearcoat reflects a uniform bright field so gloss reads as generic shine rather than as moulded plastic.
The three changes that carry almost all of the fix are a camera-relative rim, a shadow frustum that follows the player, and an environment rebuilt around a bright strip and a dark card.
Everything else in this document is secondary to those three.

---

## 1. The revised hub light rig

### 1.1 The lights

Colours are literal hex in `Lighting.tsx`, not palette entries, matching the existing convention in that file (`#fff2dd`, `#bfe4ff`).
The palette is the source of truth for what objects *are*; the lighting is the source of truth for what falls on them.
The one exception is the hemisphere ground colour, discussed below.

| # | Role | Type | Direction / placement | Intensity | Colour | Shadow |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Key | `directionalLight` | direction `(9, 9.5, 5)` normalised; light placed at `snappedCentre + dir * 30`, target at `snappedCentre` | **1.50** | `#fff0d8` | yes, see 1.3 |
| 2 | Sky fill | `directionalLight` | fixed world position `(-11, 4.5, -7)`, target origin | **0.30** | `#9ec9f0` | no |
| 3 | Rim / kicker | `directionalLight` | camera-relative, see section 2 | **0.55** | `#bfeaff` | no |
| 4 | Bounce fill | `directionalLight` | camera-relative, low, see 2.4 | **0.20** | `#ffe9cf` | no |
| 5 | Ambient | `hemisphereLight` | n/a | **0.55** | sky `#7fbdf0`, ground `#6fbe3d` | n/a |

**Running directional total: 1.50 + 0.30 + 0.55 + 0.20 = 2.55, against a cap of 2.60.**
Spare: 0.05.

**Hemisphere: 0.55, against a cap of 0.60.**
Spare: 0.05.

There is no `ambientLight` in the hub and there must not be one.
Section 4.4 explains why.

### 1.2 What each light is for, and why the numbers are those numbers

**Key at 1.50.**
Raised from 1.30 because the shadow floor is being lifted substantially by the rebuilt environment and the stronger hemisphere, and if the key does not rise with it the whole frame flattens further rather than less.
The number is set by the key-to-shadow ratio, not by an absolute target: see 4.5, where the rig lands at about 2.8:1, inside the brief's stated 2:1 to 3:1 band.

The direction moves from `(8, 14, 6)` to `(9, 9.5, 5)`.
That drops the elevation from 54.5 degrees to 42.7 degrees. **[CALC]**
Two reasons.
A 54.5-degree sun gives a 0.95m robot a 0.68m shadow, which is barely longer than his own footprint and is a real part of why he reads as hovering; at 42.7 degrees it is 1.02m and the shadow becomes a shape rather than a smudge. **[CALC]**
And a lower key wraps further round curved shells before the terminator, which is what the brief means by a large apparent source.
The azimuth barely changes, deliberately: azimuth is a composition choice, and moving it would mean re-checking every prop's read.

`SkyDome` must be updated in the same change: `<SkyDome sunDirection={[9, 9.5, 5]} />`.
A sky whose glow disagrees with where the shadows fall is the single most legible lighting bug there is, and the existing comment in `Lighting.tsx` already says so.
The dome radius of 200 stays as it is, inside the 250 far plane.

**Sky fill at 0.30, world-fixed, no shadow.**
This is the light that gives shadowed regions *form* rather than merely a lifted floor.
Because it casts no shadow, it reaches into every region the key is occluded from, and because it is directional it varies with the surface normal there.
A hemisphere light alone cannot do this: its variation is with world up, not with the fill's bearing, so it lifts a shadowed sphere uniformly instead of describing it.
It sits opposite the key in azimuth and low (elevation about 20 degrees) so it grazes vertical faces rather than piling onto the same up-facing surfaces the key already owns.

**Rim at 0.55.**
Section 2 in full.

**Bounce fill at 0.20, camera-relative.**
This replaces the existing front fill at `(2, 3, 12)` intensity 0.45.
The existing one is a bug rather than a choice: the camera orbits freely, so once the player has turned 180 degrees the "front fill" is lighting the robot's back.
Made camera-relative it costs the same and is correct from every angle, and it can be much weaker because it is now always pointed at the surfaces it exists to rescue.
Dropping 0.45 to 0.20 is most of what pays for the rim inside the budget.

**Hemisphere at 0.55, sky `#7fbdf0`, ground `#6fbe3d`.**
The sky colour is not `palette.skyTop`.
`palette.skyTop` is the colour of the *zenith*, and what a surface actually receives is the whole dome, which averages toward the horizon.
The physically honest average of `skyTop` and `skyHorizon` weighted 60/40 in linear space is `#9cc7f0`. **[CALC]**
`#7fbdf0` is deliberately more saturated than that, per the brief's rule that the ambient is saturated and never grey. **[GUESS]**

The ground colour is not `palette.grassDeep` either, and this is the more important of the two.
`grassDeep` (`#4f9b2e`) is the colour of grass *in shadow*; the light bouncing off a sunlit lawn is brighter and more saturated than that, because the grass has already darkened it once on the way out.
`#6fbe3d` gives the robot's chin, the undersides of the stone blocks and the lip of the plateau a visible green kick, which is the only bounce in this scene worth modelling and it costs nothing. **[GUESS]**

If a future change wants these in `palette.ts`, name them `bounceSky` and `bounceGround` and keep them separate from `skyTop`/`grassDeep`.
Reusing the object colours for the light is exactly the shortcut that produced the flat result.

### 1.3 The shadow configuration

One caster, with a frustum that follows the player and is texel-snapped.
The full argument for one rather than two is section 3.

```
castShadow
shadow-mapSize        [quality.shadowMapSize, quality.shadowMapSize]   // 1024 / 2048 / 4096
shadow-bias           -0.0004
shadow-normalBias     0.06                                            // unchanged, see below
shadow-radius         quality.shadowRadius                            // 0 / 4 / 6
shadow-blurSamples    quality.shadowBlurSamples                       // 0 / 8 / 16
shadow-camera-left    -12
shadow-camera-right    12
shadow-camera-top      12
shadow-camera-bottom  -12
shadow-camera-near     10
shadow-camera-far      52
```

`shadow-bias` goes from `-0.0005` to `-0.0004` because the frustum is 1.5x tighter, so a texel covers 1.5x less world and the same bias over-offsets.
`shadow-normalBias` stays at 0.06: the grass blades that forced it up have not changed shape.

`near`/`far` tighten from `0.5`/`60` to `10`/`52`.
With the light parked 30m along the key direction from the frustum centre, the nearest caster is the top of the portal arch at about 4m above the centre plane, so 26m from the light, and the furthest is the bottom of the soil cone about 7m below, so 37m. **[CALC]**
`10`/`52` clears both with wide margin and roughly halves the depth range VSM has to encode, which directly reduces light bleeding.

**Frustum extent: half-extent 12, not 18.**

| Tier | Map | Old (fixed +/-18) | New (following +/-12) | Robot at 0.6m wide |
| --- | --- | --- | --- | --- |
| low | 1024 | 28.4 texels/m | 42.7 texels/m | 17 -> 26 texels |
| medium | 2048 | 56.9 texels/m | 85.3 texels/m | 34 -> 51 texels |
| high | 4096 | 113.8 texels/m | 170.7 texels/m | 68 -> 102 texels |

**[CALC]**, and note this is *raw* texel density before the VSM blur.
The blur is what actually destroys the read today: at `shadow-radius` 4 on a 2048 map over 36m, the penumbra is about 8 texels, which is 0.14m, which is 23 per cent of the robot's width smeared on each edge.
Tightening the frustum shrinks that penumbra in world units by the same 1.5x factor for free.

Going tighter than 12 was considered and rejected.
At half-extent 9 the medium tier reaches 114 texels/m, but the shadowed box is only 18m across on a 32m island and the boundary where shadows stop becomes visible as a line in normal play.
12 is the point where the density gain is still large and the coverage loss lands on the island's back rim, which the camera is looking away from.

The coverage loss is not merely tolerable, it is endorsed by the brief: *"Background layers frequently cast no shadows at all, only AO, which flattens them and pushes them back."* (00-references.md, line 67.)

### 1.4 The following frustum, precisely

This runs in one `useFrame` inside `Lighting.tsx`, alongside the rim update from section 2.
Total per-frame cost: about 12 scalar operations, 4 trig calls, and no allocation.

```ts
// Module scope. KEY_DIR must match the SkyDome sunDirection.
const KEY_DIR = new Vector3(9, 9.5, 5).normalize()
const WORLD_UP = new Vector3(0, 1, 0)
const LIGHT_RIGHT = new Vector3().crossVectors(WORLD_UP, KEY_DIR).normalize()
const LIGHT_UP = new Vector3().crossVectors(KEY_DIR, LIGHT_RIGHT).normalize()

const HALF_EXTENT = 12
const LOOK_AHEAD = 5      // metres, along the camera's horizontal bearing
const CENTRE_CLAMP = 6    // metres from the island origin
const GROUND_Y = 0.5      // the plateau top, NOT the player's y
const LIGHT_DISTANCE = 30
```

Per frame:

```ts
// 1. Desired centre: the player, pushed forward along the way the camera looks.
const camAz = cameraFrame.yaw            // already published by FollowCamera
raw.set(
  player.current.position.x + Math.sin(camAz + Math.PI) * LOOK_AHEAD,
  GROUND_Y,
  player.current.position.z + Math.cos(camAz + Math.PI) * LOOK_AHEAD,
)

// 2. Clamp to the island core so standing on the rim does not swing the box
//    off into empty air and drop every shadow on the island at once.
const d = Math.hypot(raw.x, raw.z)
if (d > CENTRE_CLAMP) { raw.x *= CENTRE_CLAMP / d; raw.z *= CENTRE_CLAMP / d }

// 3. Snap in LIGHT space, not world space. Snapping in world space is the
//    common mistake and it does not remove the crawl, because the ortho axes
//    are rotated relative to world.
const texel = (2 * HALF_EXTENT) / quality.shadowMapSize
const u = Math.round(raw.dot(LIGHT_RIGHT) / texel) * texel
const v = Math.round(raw.dot(LIGHT_UP) / texel) * texel
const w = raw.dot(KEY_DIR)               // depth axis, deliberately not snapped
snapped.copy(LIGHT_RIGHT).multiplyScalar(u)
       .addScaledVector(LIGHT_UP, v)
       .addScaledVector(KEY_DIR, w)

// 4. Place the light and its target.
keyTarget.position.copy(snapped)
keyTarget.updateMatrixWorld()            // see the trap below
keyLight.position.copy(snapped).addScaledVector(KEY_DIR, LIGHT_DISTANCE)
```

**GROUND_Y is a constant, not `player.position.y`.**
If the frustum centre follows the player vertically, the shadow map slides every time the player jumps and every static shadow in the scene crawls for the duration of the jump.

**The target trap.**
`DirectionalLight.target` defaults to a fresh `Object3D` that is **not in the scene graph**, so `scene.updateMatrixWorld()` never touches it.
`LightShadow.updateMatrices` reads `light.target.matrixWorld` to aim the shadow camera. **[SRC]**
Move the target's `position` without calling `updateMatrixWorld()` on it and the shadow camera keeps looking at the world origin, which skews the frustum increasingly as the player walks away from the centre.
This fails silently and looks like a bias problem.
Either call `keyTarget.updateMatrixWorld()` every frame as above, or mount the target with `<primitive object={keyTarget} />`.
The explicit call is preferred because it does not depend on where in the tree the light ends up.

The rim and bounce fill do **not** need this, because their targets stay at the origin and an untouched `Object3D` already has an identity `matrixWorld`.

---

## 2. The rim / kicker

This is the most recognisable missing element and it is the first thing to build.

### 2.1 Why it must be camera-relative

A world-space rim is correct from exactly one bearing.
This camera orbits freely on both mouse drag and auto-realignment, so a fixed rim spends most of the session either invisible (when the camera is behind it) or acting as a second key (when the camera is in front of it).
Making it camera-relative is not a shortcut; it is what a gaffer physically does on a turntable shoot, which is the reference the whole art direction is built on.

### 2.2 The transform

`FollowCamera` already publishes `cameraFrame.yaw`, which is the azimuth of the camera *as seen from the subject*, in three's convention where yaw 0 is `+Z` (it is used as `offset.x = sin(yaw) * h`, `offset.z = cos(yaw) * h`).
That is exactly the quantity needed, so no camera position maths is required and there is nothing to keep in sync.

```ts
const KEY_AZ = Math.atan2(9, 5)   // 1.0637 rad, the key light's world azimuth
const RIM_SWING = 0.42            // rad, max off-axis swing (24 degrees)
const RIM_ELEV = 0.45             // rad, fixed elevation (26 degrees)
const RIM_RADIUS = 12             // placement only; direction is what matters
const RIM_SMOOTH = 8              // 1/s

// per frame
const camAz = cameraFrame.yaw
const rel = wrapPi(KEY_AZ - camAz)                 // where the key sits, seen by the viewer
const targetAz = camAz + Math.PI - RIM_SWING * Math.sin(rel)
rimAz.current += wrapPi(targetAz - rimAz.current) * (1 - Math.exp(-RIM_SMOOTH * dt))

const c = Math.cos(RIM_ELEV) * RIM_RADIUS
rimLight.position.set(
  Math.sin(rimAz.current) * c,
  Math.sin(RIM_ELEV) * RIM_RADIUS,
  Math.cos(rimAz.current) * c,
)

// wrapPi(a) => Math.atan2(Math.sin(a), Math.cos(a))
```

Three things about this are load-bearing.

**`camAz + PI` puts the light directly behind the subject as the camera sees it**, so it shines back toward the lens.
That is the definition of a rim.

**The `- RIM_SWING * sin(rel)` term keeps the kicker on the side away from the key.**
A perfectly symmetric 180-degree backlight puts an even halo on both edges of the silhouette, which reads as a rendering artefact rather than as a light.
`sin(rel)` is used rather than a sign test because it is continuous: when the camera crosses the key's bearing the swing passes smoothly through zero instead of popping from one side to the other.
Maximum swing is 24 degrees, reached when the key is at 90 degrees to the viewer.

**The elevation is fixed at 26 degrees and does not follow camera pitch.**
Camera pitch runs from -0.5 to 1.1 rad, so following it would put the rim underneath the robot when the player looks down at him, which is a horror-film uplight.
26 degrees puts the kicker on the top-back edge of the silhouette, which is where the brief says it belongs.

The exponential smoother with a 0.125s time constant does two jobs: it stops the highlight shimmering during a fast mouse drag, and the slight lag reads as the light being a physical object in the world rather than glued to the lens.

Because the target stays at the origin, the *direction* this produces is correct for a subject anywhere in the world, not just at the origin.
Directional lights are parallel, so translating the light along the direction it points changes nothing.
This is why `RIM_RADIUS` can be an arbitrary 12.

### 2.3 Intensity and colour

**Intensity 0.55**, against a cap of 0.60.
**Colour `#bfeaff`.**

The colour is the complement of the warm key, per the brief.
It is deliberately *not* `palette.visor` (`#4de2ff`): the brief's rule that semantic hues stay globally constant means the emissive cyan must keep meaning "this is powered", and spraying it across every silhouette in the hub destroys that.
`#bfeaff` is a cool near-white with enough blue to separate cleanly against the yellow-green grass, which is the background it is most often read against.
Against the `#d6ecfb` sky at the island's edge it separates on value rather than hue, which is why it is bright rather than saturated. **[GUESS]**

Diffuse contribution at peak: `0.55 x linear(#bfeaff) x albedo(shell) / PI`, luminance **0.119**. **[CALC]**
The diffuse term therefore cannot bloom under any circumstances, at any angle, with 15x of margin against the 1.75 threshold.

### 2.4 The bounce fill, same mechanism

Same `useFrame`, three more trig calls.

```ts
const FILL_ELEV = 0.14   // rad, 8 degrees; low, so it grazes verticals
const c2 = Math.cos(FILL_ELEV) * RIM_RADIUS
fillLight.position.set(
  Math.sin(camAz) * c2,
  Math.sin(FILL_ELEV) * RIM_RADIUS,
  Math.cos(camAz) * c2,
)
```

No swing, no smoothing.
It is weak and diffuse enough that camera shimmer is not detectable, and it should be opposed to the rim so the two form a wrap.

### 2.5 Bloom containment, which is the real problem

The threshold in `PostFX.tsx` is 1.75, bloom runs before tone mapping, and a rim light by definition hits grazing angles where clearcoat Fresnel approaches 1.0.
The diffuse budget is not the binding constraint here and never was.

**The architectural answer is to split the rim's two jobs across two mechanisms with different bloom characteristics.**

A rim does two things: it wraps a soft cool light around the shadow edge (diffuse), and it draws a hot specular line along the top edge (specular).

- **The diffuse wrap is the directional light.** Provably bounded at 0.119 luminance, as computed above. This is what actually separates the figure from the background, and it is the part that must not be compromised.
- **The hot specular line is the environment strip card, not the directional light.** An analytic light's specular is unbounded, because the GGX `D` term goes as `1 / (PI * alpha^2)` and reaches about 629 at `clearcoatRoughness` 0.15. **[CALC]** An environment map's specular is *bounded by construction*: it is a prefiltered cubemap lookup, so the brightest value any roughness lobe can ever return is the brightest texel in the map. Section 5 sets that ceiling at 1.32, which is below 1.75 with a documented margin.

That is the design.
The strip gives the product-photography streak, provably without blooming; the directional gives the separation, provably without blooming.

**What remains is the directional light's own specular lobe, and I am going to be honest that this is a [GUESS].**

At 26 degrees elevation behind the subject, the half-vector between view and light lands on normals about 77 degrees off the view axis, so the visible specular band is a narrow crescent hugging the silhouette. **[CALC]**
On a 0.6m robot at 7.5m under a 55-degree FOV that crescent is a few pixels wide.
My prediction is that it exceeds 1.75 and blooms as a small jewel glint, and that this is *the look* rather than a defect: the brief says explicitly that "only emissives and specular hits bloom" (00-references.md, line 115).
I have not measured it, and the pixel width estimate assumes the bevel radii on `RoundedBox` behave as I expect.

Two changes to `PostFX.tsx` make the failure graceful rather than binary:

- `luminanceSmoothing` **0.30 -> 0.45**. This widens the ramp into bloom, so a 1.9 peak produces a whisper rather than a pop. Zero cost.
- `Bloom radius` stays at 0.6 and `intensity` at 0.55, so whatever does cross stays compact.

**The escape ladder, in order, if it does blow out.**
Take one rung at a time and re-check.

1. Drop `rimIntensity` 0.55 -> 0.45. Costs the least; the wrap is still readable.
2. Split the rim into two lights at 0.28 each, 16 degrees apart in azimuth, sharing `rimAz`. This halves the peak and roughly doubles the streak width, and a wider streak is closer to the brief's "very large apparent source size" anyway. Budget: 0.56, still inside the 0.60 rim cap. Cost: one extra directional in the shader loop, gate it to `high` if it is only needed there.
3. Raise `plastic()`'s `clearcoatRoughness` from 0.10 (the value the materials pass is heading for) to 0.16. Still a clear two-lobe separation from base roughness 0.35, still inside the brief's 0.10-0.20 band for saturated ABS.
4. Raise the bloom threshold 1.75 -> 2.0. **Last resort**, because it also stops the LED visor blooming, and the visor blooming while the white shell does not is the entire reason the threshold is high.

**The two places to look first when checking.**
`gel()` is `roughness 0.1 / clearcoat 1 / clearcoatRoughness 0.1 / transmission 0.6`, which is very close to a mirror, and the hub's token crystals use it.
A 0.55 rim on those will produce a genuinely hot pinpoint.
My recommendation is to accept it: sparkling collectibles are correct, and the reward palette is meant to read as feedback.
If it is too much, raise `gel()`'s `roughness` and `clearcoatRoughness` to 0.14 rather than touching the rim.

`emissive()` is already above threshold by design and needs no attention.

**One place it will help unexpectedly.**
`Grass.tsx` and `Flowers.tsx` are `MeshStandardMaterial` at roughness 0.85 and 0.72 with no clearcoat. **[SRC]**
A rim grazing 220,000 blades at roughness 0.85 produces a broad soft backlit sheen with no spike risk at all, and backlit grass is one of the strongest reads available in this scene.
Expect this to be the single most visible effect of the change on `high`.

### 2.6 Where the code lives

The rim, the bounce fill and the following frustum are one `useFrame` in `Lighting.tsx`, reading `cameraFrame` and the player group.
`Lighting` currently has no access to the player.
It is mounted inside `GameContext.Provider` in `App.tsx`, so `useContext(GameContext).player` is available without any plumbing change.
Guard on `player.current` being non-null, because the lighting mounts before the controller does.

---

## 3. Should there be a second shadow caster?

**No. Not at any tier.**
The right fix is the following frustum in section 1.3, plus a contact blob.

### 3.1 Why a second caster does not work here

**A second directional caster double-darkens.**
Each `castShadow` light in three computes its own shadow mask and multiplies only its own contribution.
Where a wide caster says "shadowed" and a tight caster says "lit", you get a partial shadow at the strength of the tight light rather than a full one.
That produces a visible half-darkened fringe at the tight frustum's boundary.
Solving it properly is cascaded shadow maps, which means a new dependency and a rewrite of the shadow path, not a light.

**Layers cannot exclude grass from a second caster's map.**
This is worth stating explicitly because it is the obvious thing to reach for and it does not work.
`WebGLShadowMap.render(lights, scene, camera)` tests `object.layers.test(camera.layers)` against the **main camera**, not against `light.shadow.camera`. **[SRC]**
The test is therefore identical for every light, so there is no per-light caster masking in three's standard renderer.

**The frame cost lands in exactly the wrong place.**
A second caster costs a full depth-only re-render of every casting object in its frustum, plus, under VSM, an extra pair of separable blur passes over the map, plus a second shadow texture lookup in every fragment of the main pass whether or not it is in frustum.
At `high`, `grassCastShadow` is `true` and there are 220,000 grass instances, and `quality.ts` says in its own comment that this is "the most expensive single setting in the game".
So `high` is the worst possible tier to add a second depth pass to.
And `low`, where the shadow is genuinely worst at a 1024 map, is the tier that can least afford one.
There is no tier where the trade is good.

### 3.2 What to do instead

**(a) The following, texel-snapped frustum from 1.3.**
It buys a 50 per cent texel density increase at every tier for zero GPU cost and about 12 CPU operations per frame.
That is a strictly better trade than a second map at any tier.

**(b) A contact shadow blob under the player.**
The brief calls for this separately from the cast shadow: *"Contact shadow is a separate, tighter, darker darkening directly under the character; it is what glues the toy to the floor."* (00-references.md, line 67.)
It is not a shadow map and does not cost like one.

Specification:

- One `<mesh>` under the player, `circleGeometry(0.42, 24)`, `rotation-x={-Math.PI / 2}`, sitting at the ground contact point.
- A `shaderMaterial` of about ten lines: `smoothstep` on `length(vUv - 0.5)`, output `mix(TINT, vec3(1.0), edge)`.
- `blending: MultiplyBlending`, `depthWrite: false`, `transparent: false`. Multiply blending resolves to `dst * src`, so the disc must output pure white at its rim to be a no-op there.
- `TINT` at the centre: `vec3(0.55, 0.60, 0.72)`. That is a 40 per cent darkening biased cool, so the contact reads as shadow and not as dirt. It is deliberately not neutral, per section 4.
- Scale and strength from height above ground: one short downward Rapier ray from the player each frame gives `h`; then `t = clamp(1 - h / 1.6, 0, 1)`, `strength = t`, `scale = 1.0 + 0.55 * (1 - t)`. Higher means bigger and fainter, which is what a real penumbra does.

Cost: one draw call, roughly 600 fragments, one Rapier ray.
This is small enough to run at `low`, and `low` is precisely where the 1024 shadow map cannot glue the robot to the floor on its own.

It belongs in the player, not in `Lighting.tsx`, and should be a separate build task from the light rig.

---

## 4. Coloured shadows

### 4.1 The mechanism, stated exactly

There is no shadow colour parameter in three and there does not need to be one.
In `lights_fragment_begin`, the shadow term multiplies **only the contribution of the light that cast it**.
Everything else reaching that pixel is untouched: the hemisphere, the environment IBL, the other three directionals, and the AO pass.

So the colour of a shadow is entirely determined by what else is lighting it.
Steering shadow chroma means steering the *unshadowed* half of the rig, and there is nothing else to it.

The corollary matters for tuning: raising the key deepens shadows (it raises the numerator without touching the denominator), and raising the hemisphere or the environment lifts them.
The number to steer is the ratio, not either term.

### 4.2 The four levers, in order of effect

**1. The hemisphere sky colour, at 0.55 with `#7fbdf0`.**
Normal-dependent, so it describes form rather than flooding.
For a shadowed up-facing shell surface this gives diffuse `(0.016, 0.060, 0.116)` linear, a red-to-blue ratio of about 1:7. **[CALC]**
That is the dominant source of shadow chroma and it costs one `mix` and one `dot` per fragment.

**2. The environment cube's ambient floor and cool wrap card, section 5.**
This is the lever the current rig is missing entirely.
The virtual scene drei renders the Lightformers into has **no background**, so every gap between the three existing cards clears to black. **[SRC]**
Adding `<color attach="background" args={['#243a52']} />` as a child of `<Environment>` fills the cube with a chromatic floor for essentially nothing: a uniform radiance `L` over the full sphere contributes `L * albedo` to diffuse, so `#243a52` adds about `(0.015, 0.037, 0.071)` linear to every surface in the scene, biased strongly blue. **[CALC]**
Combined with the cool wrap card being large and on the shadow side, this is what stops the environment neutralising the hemisphere's blue.

**3. The sky fill directional at 0.30.**
Covered in 1.2. It gives shadowed regions a bearing.

**4. `N8AO`'s `color`, currently `#2a3550`.**
Change to **`#2c3f74`**.
The current value is a dark desaturated navy, which reads as "less blue" rather than as blue.
`#2c3f74` has visibly more chroma at a similar value and pushes the crevices violet, which separates them from the broad shadow rather than merging with it. **[GUESS]**
`n8ao`'s `colorMultiply` defaults to `true`, so the colour multiplies the scene rather than being a flat additive tint; that is the behaviour we want, and it is not exposed on the R3F wrapper's prop type anyway. **[SRC]**

Also drop `N8AO intensity` **2.2 -> 1.9**.
The shadow floor is being lifted by everything above, and 2.2 was tuned against a darker one.

### 4.3 What is not available

The brief suggests tinting the vignette toward the shadow hue.
`postprocessing`'s `VignetteEffect` exposes `technique`, `offset` and `darkness` and has **no colour input**. **[SRC]**
There is no way to tint it without a custom `Effect` subclass, which is a Tier-3 item and out of scope here.

In the meantime, drop `Vignette darkness` **0.42 -> 0.34**.
A black vignette at 0.42 is now fighting the "deep shadow is deliberately refused" rule harder than it was, because everything inside the frame is more chromatic than it used to be.

And raise `HueSaturation saturation` **0.08 -> 0.12**, since ACES desaturates and there is now more shadow chroma to lose to it.

### 4.4 Do not add an `ambientLight`

The hub has none and must keep none.
`ambientLight` has no normal dependence at all, so it lifts every surface of an object identically and removes exactly the shading that describes its shape.
A `hemisphereLight` costs the same and varies with world up, so it lifts shadows without flattening them.
There is no case in this project where `ambientLight` is the right tool.

The cave currently has `<ambientLight intensity={0.35} color={palette.caveCrystal} />` and it is most of why the cave reads flat.
Section 9.

### 4.5 The target ratio, and what the rig lands on

The brief's diagnostic is that the darkest pixel of a white shell is rarely below 28-35 per cent luminance and is always chromatic, and that key-to-fill runs a low 2:1 to 3:1.

Working the shell (`#f4f1ea`, linear albedo `(0.906, 0.878, 0.823)`) through the proposed rig: **[CALC]**

| Surface | Contributions | Linear luminance |
| --- | --- | --- |
| Facing the key, lit | key 0.373 + hemisphere 0.054 + env ~0.115 | **~0.54** |
| Up-facing, key occluded | hemisphere 0.054 + env ~0.115 + sky fill 0.020 | **~0.19** |

Ratio **2.8:1**, inside the brief's band.

The `~0.115` for the environment's diffuse irradiance is the weakest number in this document.
It is estimated from the top card's solid angle and I have not measured it.
If the measured ratio comes out above 3:1, raise the environment's `environmentIntensity` before touching any light; if below 2:1, lower it.

The open shadow side lands around 45-57 per cent in sRGB after ACES, which is *above* the brief's 28-35 per cent.
That is not a contradiction: the brief's figure is for the *darkest* pixel, which here is a downward-facing surface in a crease, getting the green ground term of the hemisphere plus AO on top.
Those should land near 30 per cent.
Verify both, not just one.

---

## 5. The environment / IBL rebuild

### 5.1 Two facts about drei's `Lightformer` that change how this is written

**Fact one: `intensity` multiplies the material colour.**
`applyProps(material, { color })` then `material.color.multiplyScalar(intensity)`, on a `meshBasicMaterial` with `toneMapped={false}`, into a `HalfFloatType` cube target. **[SRC]**

So the radiance a card writes into the cube is exactly:

```
radiance = linear(color) * Lightformer.intensity * scene.environmentIntensity
```

This is the whole reason the environment is safe: **the brightest specular value any material can ever reflect is the brightest texel in the map**, because a prefiltered cubemap lookup cannot exceed its own maximum.
Setting that ceiling below 1.75 makes the environment provably incapable of blooming, which is not a property any analytic light has.

**Fact two: passing `rotation-x` does nothing.**
The component does `if (!props.rotation) { quaternion.identity(); lookAt(target) }` in a layout effect, and the key it tests is literally `props.rotation`. **[SRC]**
`rotation-x={...}` is a separate prop key, so `props.rotation` is `undefined`, the quaternion is reset, and `lookAt([0,0,0])` wins.

The existing `rotation-x={Math.PI / 2}` on the top card in `Lighting.tsx` is therefore already being discarded.
It happens to be harmless because the card is at `[0, 6, 0]` and `lookAt(origin)` points it straight down anyway, which is what the rotation was trying to achieve.

**Consequence for this spec: do not set rotation on any card.**
Let every card `lookAt` the origin, which is the documented behaviour and removes all convention ambiguity.
`lookAt` resolves roll against the default up of `+Y`, so a card's local `+X` axis always ends up horizontal.
That means `scale={[16, 0.55, 1]}` reliably produces a long **horizontal** strip, which is the orientation the product-photography streak needs.

### 5.2 The card list

```tsx
<Environment frames={1} resolution={quality.envResolution} environmentIntensity={0.85}>
  <color attach="background" args={['#243a52']} />
  ... six Lightformers ...
</Environment>
```

`environmentIntensity` is a real prop on `Environment`: it is forwarded to `applyProps(scene, { environmentIntensity })`, which sets `scene.environmentIntensity` in three r155+. **[SRC]**
This is a single global dial on the whole IBL contribution and is strictly preferable to editing `envMapIntensity` on six material presets.

| # | Name | `form` | `position` | `scale` | `color` | `intensity` | Peak radiance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Ambient floor | (scene background) | n/a | n/a | `#243a52` | n/a | 0.074 |
| 1 | Key softbox | `rect` | `[7, 7.5, 4]` | `[10, 10, 1]` | `#fff3e2` | 1.35 | 1.15 |
| 2 | Highlight strip | `rect` | `[-4, 9, 4]` | `[16, 0.55, 1]` | `#ffffff` | **1.55** | **1.32** |
| 3 | Cool sky wrap | `rect` | `[-8, 3, -6]` | `[14, 9, 1]` | `#8ec8f0` | 0.60 | 0.43 |
| 4 | Ground bounce | `rect` | `[1, -4.5, -1]` | `[16, 16, 1]` | `#9ecf6a` | 0.30 | 0.20 |
| 5 | Negative fill | `rect` | `[3, -0.5, 7]` | `[12, 7, 1]` | `#0b0f1a` | 1.00 | 0.009 |
| 6 | Rim card | `rect` | `[-2, 5, -9]` | `[9, 2.5, 1]` | `#cfeeff` | 0.80 | 0.68 |

Peak radiance is `max(linear(color)) * intensity * 0.85`. **[CALC]**

**Highest value anywhere in the map: 1.32, from the strip.**
Threshold is 1.75.
Margin 0.43.
No cap in the budget is exceeded: the largest single `intensity` is 1.55, against a cap of 1.6.

### 5.3 What each card is for

**0. Ambient floor, `#243a52`.**
Without it the cube's gaps are black and the clearcoat reflects a void, which is one of the two reasons gloss currently reads as generic shine.
It also supplies a chromatic ambient to every surface in the scene for free, which is lever 2 in section 4.
It must not be much brighter than this or it becomes a fifth light and eats the value structure.

**1. Key softbox.**
The environment's counterpart to the key directional, placed at the same bearing (`normalize(9, 9.5, 5) * 11`, rounded).
It has to be at the same bearing or the reflections in the clearcoat disagree with where the shadows fall, and that reads as wrong immediately even though nobody can name it.
Large and soft: this is the broad body highlight on curved plastic.

**2. Highlight strip. The one the brief names explicitly.**
Long and thin, high, and deliberately *not* at the key's bearing, so the elongated streak reads as its own event rather than as part of the key's highlight.
16m by 0.55m at 10m out subtends a long narrow band, which is exactly the shape a real strip softbox draws across a moulded curve.
This is the single card that most makes the world read as photographed rather than rendered.

Its intensity of 1.55 is chosen to sit just under the 1.75 threshold after `environmentIntensity`, so it is as hot as it can be without ever blooming.
That is deliberate: it should be the brightest thing on a shell without being a bloom source, because bloom is reserved for emissives.

**3. Cool sky wrap.**
Large, low, on the opposite side from the key.
This is the environment half of the coloured-shadow story: a surface turned away from the key sees mostly this card, so its reflections stay blue instead of being neutralised by the softbox.

**4. Ground bounce.**
The grass, seen from below, filling undersides.
Offset from dead-centre so `lookAt` has a well-defined roll, though three's `Matrix4.lookAt` handles the degenerate parallel case anyway. **[SRC]**

**5. Negative fill. The other thing the brief names explicitly.**
Near-black, positioned on the camera-front-low side, between the cube centre and the lower part of the frame.
Lightformers are opaque `meshBasicMaterial` meshes with `side: DoubleSide`, so they genuinely occlude cards behind them. **[SRC]**
That is the actual mechanism of negative fill, and it is why the card is placed rather than merely dark.

Its job is to give the clearcoat a dark value to reflect below the highlight, so the highlight reads as a *highlight* rather than as "the material is bright".
It is `#0b0f1a` rather than `#000000` because the brief refuses pure black anywhere, and because a faint blue in the darkest reflection is what keeps a white shell chromatic.

**6. Rim card.**
Small, cool, behind.
The environment's counterpart to the rim directional, so a chrome or near-mirror surface catches an edge reflection from behind even when the analytic rim's lobe misses.
It is world-fixed and the analytic rim is camera-relative, which is a genuine inconsistency; it is accepted because rebuilding the cube per frame is exactly what `frames={1}` exists to prevent, and because the card's contribution is diffuse enough that the disagreement does not read.

### 5.4 Cost

`frames={1}` renders the cube once, in a `useLayoutEffect` keyed on `[children, virtualScene, fbo.texture, ...]`. **[SRC]**
`children` changes identity on every React render of `Lighting`, so the cube re-renders whenever `Lighting` re-renders.
That is currently only on a quality change, which is fine, but it means **nothing inside the `<Environment>` subtree may re-render per frame**.
Do not put the camera-relative lights, or anything reading `useFrame` state, inside it.

The number of cards is free at runtime.
Six cards and three cards produce identically expensive IBL sampling, because the result is one prefiltered cubemap either way.
Only `resolution` costs anything, and only once.

---

## 6. Per-zone light probes

**Not for the hub. Revisit for the cave.**

### 6.1 Runtime cost is not the problem

A `LightProbe` is nine RGB spherical-harmonic coefficients evaluated per fragment.
That is roughly 30 multiply-adds, which is *cheaper* than a directional light and much cheaper than a shadowed one.
Lerping between baked probes as the camera moves means writing 27 floats on the CPU each frame and uploading one uniform block, which is nothing.

### 6.2 The problems that are real

**Authoring.**
There are no baked probes and no bake step.
Generating them at load with `LightProbeGenerator.fromCubeRenderTarget()` means rendering a cube camera at each probe location, so six faces per probe, before the first frame.
Four to six probes at 64px is maybe 15-40ms of load time, which is affordable but is a new pipeline stage with its own failure modes on a project that currently has none.

**Double-counting.**
Three sums `LightProbe` irradiance with `scene.environment`'s diffuse irradiance.
Adding probes on top of the rebuilt environment without dropping `environmentIntensity` to compensate produces a scene that is uniformly too bright, and the compensation is a hand-tuned constant that silently rots the moment either side changes.

**The hub has nothing for a probe to capture.**
Probes earn their cost when bounce lighting varies spatially: walking from a red corridor into a blue cavern, or under an overhang that occludes half the sky.
The hub is a single open-air island under one sky with no enclosures.
Every probe on it would hold approximately the same nine coefficients, and the lerp between them would be a no-op.

The one real bounce in the hub is grass into undersides, and the hemisphere ground colour already models it (section 1.2) for one `mix` per fragment and zero authoring.

**Verdict: no.**
Revisit when a zone exists that actually has interior volumes with different colours, which is the cave, and then only after the cave's analytic rig has been exhausted.

---

## 7. Tier gating

| Element | low | medium | high | Frame-cost reasoning |
| --- | --- | --- | --- | --- |
| Key directional + shadow | yes, 1024 | yes, 2048 | yes, 4096 | Existing dial, unchanged. |
| Following texel-snapped frustum | yes | yes | yes | About 12 scalar ops, 4 trig calls, 3 dot products per frame on the CPU. Zero GPU cost. It buys 50 per cent texel density at every tier and there is no reason to withhold it. |
| VSM soft shadows | no (PCF) | `radius 4, blurSamples 8` | `radius 6, blurSamples 16` | Existing. `blurSamples` drops 12 -> 8 at medium because the tighter frustum already shrank the world-space penumbra by 1.5x, so fewer samples reach the same softness. `radius` rises to 6 at high to keep the soft look on a 4096 map where a texel is a quarter of the world it used to be. |
| Hemisphere | 0.60 | 0.55 | 0.55 | One `mix`, one `dot`. Raised at low to absorb the bounce fill, see below. Still inside the 0.60 cap. |
| Sky fill directional | yes | yes | yes | About 20 ALU per fragment. |
| **Camera-relative rim** | **yes** | **yes** | **yes** | About 20 ALU per fragment plus 4 trig calls per frame. This is the defining element of the look and `low` already gives up AO, soft shadows and clouds; taking the rim as well would leave `low` looking like a different game rather than a cheaper one. |
| Camera-relative bounce fill | **no** | yes | yes | This is the one cut at `low`. Removing it takes `low` from four directionals back to three, which is the same count it has today, so `low`'s GPU cost lands within noise of current. Legibility is preserved by raising the hemisphere 0.55 -> 0.60, which is cheaper than a directional and lifts player-facing verticals uniformly. The loss is some form on those verticals, which is the correct thing to trade at the bottom tier. |
| Contact shadow blob | yes | yes | yes | One draw call, ~600 fragments, one Rapier ray. `low` is the tier that needs it most, because a 1024 map cannot glue the robot to the floor on its own. |
| Environment card count | 6 | 6 | 6 | `frames={1}`, so the cards cost nothing at runtime. Varying them per tier would only make the tiers look different for no saving. |
| `Environment resolution` | 128 | 256 | 512 | One cube render plus one PMREM pass, once. Runtime IBL sampling cost is identical at all three; only memory and the sharpness of the low-roughness mips differ. 512 at `high` is what keeps the strip's streak crisp on `clearcoatRoughness 0.10`. |
| `environmentIntensity` | 0.85 | 0.85 | 0.85 | Free. Must not vary by tier or the value structure changes between tiers, which is the one thing that has to stay constant. |
| `N8AO` | off | on, `quality 'low'`, `aoSamples 8`, `halfRes` | on, `quality 'medium'`, `aoSamples 16`, full res | Existing, plus `halfRes` at medium. `halfRes` roughly quarters the AO pass's fragment count and the `depthAwareUpsampling` default keeps the edges. **[SRC]** on the prop existing; the quality gain estimate is **[GUESS]**. |
| Split rim (escape ladder rung 2) | no | no | opt-in | Only if the single rim blows out. One extra directional. |
| Clouds | 0 | 3 | 5 | Existing, unchanged. |

**Is `low` genuinely zero-cost?**
Compared against `low` as it stands today, not against `medium`:

- Directional light count: 3 today (key, cool fill, front fill), 3 proposed (key, sky fill, rim). Unchanged.
- Hemisphere: 1 today, 1 proposed. Unchanged.
- Environment resolution: 256 today, 128 proposed. **Cheaper.**
- Frustum follow: CPU only, no GPU cost.
- Contact blob: +1 draw call, +1 ray. The only addition.

So `low` gets the rim, the following frustum and the rebuilt environment for a net GPU cost within measurement noise of today's, and its one-off environment build gets cheaper.
That satisfies "genuinely zero-cost" rather than "merely cheap".

**New `quality.ts` fields required:**

```ts
shadowRadius: number        // 0 / 4 / 6
shadowBlurSamples: number   // 0 / 8 / 16
envResolution: number       // 128 / 256 / 512
bounceFill: boolean         // false / true / true
hemisphereIntensity: number // 0.60 / 0.55 / 0.55
```

`softShadows` stays, because `App.tsx` uses it to pick `VSMShadowMap`, and `shadowRadius === 0` is not the same signal.

---

## 8. The light budget block

Paste this verbatim as a block comment above `HubLighting()` in `src/art/Lighting.tsx`.
Its purpose is that a future change can be checked against it without re-deriving anything.

```
/*
  HUB LIGHT BUDGET  -  see docs/design/01-lighting.md

  Bloom runs BEFORE tone mapping (renderer is NoToneMapping, ACES is applied
  last in the composer), so bloom sees raw HDR. The threshold in PostFX.tsx is
  1.75. Every number below is budgeted against that. Change one and re-check
  the whole block, because the caps are on sums, not on individuals.

  DIRECTIONAL                                    intensity   running total
    key            #fff0d8  dir (9, 9.5, 5)         1.50          1.50
    sky fill       #9ec9f0  world (-11, 4.5, -7)    0.30          1.80
    rim / kicker   #bfeaff  camera-relative         0.55          2.35
    bounce fill    #ffe9cf  camera-relative         0.20          2.55
                                                   -------------------
                                        CAP 2.60   TOTAL 2.55   SPARE 0.05

  HEMISPHERE       sky #7fbdf0 / ground #6fbe3d     0.55   CAP 0.60
                   (0.60 at the low tier, which drops the bounce fill)

  RIM SUB-CAP                                      0.55   CAP 0.60

  AMBIENT LIGHT    none, and there must not be one. ambientLight has no normal
                   dependence, so it removes the shading it is meant to lift.
                   The hemisphere does the same job and keeps the form.

  ENVIRONMENT      radiance = linear(color) * Lightformer.intensity
                                            * scene.environmentIntensity (0.85)
                   Peak radiance is the ceiling on ANY specular reflection,
                   because a prefiltered cubemap lookup cannot exceed its own
                   brightest texel. This is why the env is provably bloom-safe
                   and an analytic light is not.

                                       intensity      peak radiance
    ambient floor  #243a52  background      -             0.074
    key softbox    #fff3e2  [7, 7.5, 4]     1.35          1.15
    highlight strip #ffffff [-4, 9, 4]      1.55          1.32   <- hottest
    cool sky wrap  #8ec8f0  [-8, 3, -6]     0.60          0.43
    ground bounce  #9ecf6a  [1, -4.5, -1]   0.30          0.20
    negative fill  #0b0f1a  [3, -0.5, 7]    1.00          0.009  <- darkest
    rim card       #cfeeff  [-2, 5, -9]     0.80          0.68
                                       ----------------------------
                          CAP 1.60 each   MAX 1.55    PEAK 1.32 vs 1.75

  MEASURED / DERIVED HEADROOM
    peak lit diffuse on the shell   ~0.54 luminance   threshold 1.75
    open shadow side                ~0.19 luminance   ratio 2.8:1 (target 2:1-3:1)
    rim diffuse at its peak          0.119 luminance  cannot bloom, 15x margin
    SkyDome peak (sun glow)         ~0.97 luminance   do NOT raise the 0.55 /
                                                     0.12 glow coefficients in
                                                     SkyDome.tsx without
                                                     re-checking; at 0.9 / 0.2
                                                     the sky itself blooms.

  THE ONLY UNBOUNDED TERM is analytic specular. GGX D peaks near 629 at
  clearcoatRoughness 0.15, so the rim's specular lobe is the one thing here
  that can cross 1.75. That is intended: the brief wants specular hits to
  bloom and white plastic not to. If it goes wrong, the escape ladder is, in
  order: rim 0.55 -> 0.45; split the rim into two at 0.28; plastic()
  clearcoatRoughness -> 0.16; and only as a last resort raise the bloom
  threshold, which also stops the LED visor glowing.

  KEY DIRECTION IS SHARED. (9, 9.5, 5) appears here, in the SkyDome
  sunDirection prop, and in KEY_AZ for the rim's swing. Change one and change
  all three, or the sun glow, the shadows and the kicker stop agreeing.
*/
```

---

## 9. How the cave should follow

The hub is the priority and this is a sketch, not a spec.
Numbers here are all **[GUESS]**.

The cave's problem is different from the hub's.
The hub is flat because everything is lit from one hemisphere; the cave is flat because `<ambientLight intensity={0.35} />` is doing a third of the lighting and ambient light has no normal dependence at all.

Order of work, once the hub rig is in and proven:

1. **Delete the `ambientLight`.** Fold its lift into the hemisphere, which already exists at 0.8. Take the hemisphere to 0.55 and let the environment carry the rest, matching the hub's structure. This alone should be most of the improvement.
2. **Reuse the camera-relative rim component unchanged, with cave constants.** Colour `#b9a8ff` (the crystal hue, complement of the cool mouth key), intensity **0.45**, `RIM_ELEV` 0.50. The rim-to-key ratio should be *higher* than the hub's 0.37, around 0.6, because separation matters more when the background is dark and there is no sky to read a silhouette against.
3. **The mouth key drops to about 0.75** and keeps its shadow, with the same following texel-snapped frustum at half-extent 10. The cave room is smaller than the island, so the density win is larger for the same cost.
4. **The front fill at `(0, 3, 10)` becomes the camera-relative bounce fill**, same component, intensity 0.20, colour `#a9b6e8`. The existing world-fixed one has the same orbit bug the hub's does.
5. **Two or three non-shadowed point lights at the crystal clusters**, gated to medium and high, intensity around 1.2 with `distance` 6 and `decay` 2. This is the cave's real payoff and the thing that makes the crystals read as the light source the code comment already claims they are. Point lights are cheap when they do not cast shadows; they must not cast shadows.
6. **The environment cube becomes mostly negative fill**, which is what a cave physically is: a large dark card occupying most of the sphere, one violet dome card overhead, one small warm card at the mouth. The ambient floor drops from `#243a52` to something like `#141a2a`.
7. **Revisit light probes here, not in the hub.** A cave has interior volumes with genuinely different bounce colour, which is the case probes exist for. Still only after the analytic rig above has been exhausted.

Directional budget for the cave: key 0.75 + rim 0.45 + bounce fill 0.20 = **1.40**, well inside 2.60.
The point lights are a separate budget line and need their own headroom check, because a `distance`-limited point light at close range on a crystal with `emissive()` material is a plausible bloom source.

---

## 10. Acceptance tests

These are what "done" means.
Run them at `?quality=medium` unless stated.

1. **The rim exists from every angle.** Orbit a full 360 degrees around the robot standing on the stone platform. The cool edge is present on the top-back of his silhouette at every bearing, and it is never symmetric on both edges at once.
2. **No pop.** During that orbit, the kicker slides continuously. If it jumps as the camera crosses the key's bearing, the `sin(rel)` swing has been implemented as a sign test.
3. **Nothing broad blooms.** Same orbit. Any bloom is a compact glint no larger than about one sixth of the robot's on-screen height, plus the visor. If a whole edge hazes, take the escape ladder in 2.5.
4. **The shadow does not crawl.** Walk the full width of the island. Static shadows, particularly the portal arch's, hold still. Any shimmer means the texel snap is being done in world space rather than light space.
5. **The shadow does not skew.** Walk to the island rim and look back. The arch's shadow stays parallel to what it was at the centre. Skew means `keyTarget.updateMatrixWorld()` is missing.
6. **The shadow is a shape.** Screenshot the robot's cast shadow at `low` and at `high`. Both read as a robot, not as a blob. `low` will be soft; it must not be shapeless.
7. **Shadows are chromatic.** Colour-pick the open shadow side of the white shell. It must be visibly blue, not grey. Red-to-blue ratio around 1:3 or stronger in sRGB.
8. **The greyscale test.** Desaturate a frame. The three value bands, background sky, midground island, gameplay platform, must still be separable, and it must still be instantly obvious where the player can stand. This is the brief's stated acceptance test and it is not a metaphor.
9. **The key:shadow ratio.** Sample the lit and shadowed sides of the shell. Between 2:1 and 3:1. Outside that band, move `environmentIntensity` first, hemisphere second, key last.
10. **The sun agrees.** The SkyDome's glow and the direction the shadows fall must point the same way. Three places share `(9, 9.5, 5)`.
11. **`low` has not regressed.** Frame time at `?quality=low` is within noise of the current build. If it is not, the rim's shader permutation is the first suspect.

---

## 11. Scope

**Files this design expects to change.**

- `src/art/Lighting.tsx`, substantially: the rig, the `useFrame`, the environment, the budget comment.
- `src/art/quality.ts`, five new fields listed in section 7.
- `src/art/SkyDome.tsx`, nothing internal; only the `sunDirection` prop passed from `Lighting.tsx`.
- `src/art/PostFX.tsx`, four constants: `luminanceSmoothing` 0.30 -> 0.45, `N8AO color` -> `#2c3f74`, `N8AO intensity` 2.2 -> 1.9, `Vignette darkness` 0.42 -> 0.34, `HueSaturation saturation` 0.08 -> 0.12. Plus `halfRes` on the medium tier.
- The contact blob, which belongs in the player and should be a separate task.

**Explicitly out of scope here.**

- The hub sky/fog mismatch at `registry.ts:57`. Being fixed separately; this document assumes it is done and that both come from the palette.
- Material changes. `plastic()`'s clearcoat roughness separation is a materials task, and it interacts with the rim's specular (section 2.5) but does not block it.
- A tinted vignette, which needs a custom `Effect` subclass.
- The cave, beyond the sketch in section 9.

**The three numbers I am least sure of, in order.**

1. The environment's diffuse irradiance contribution, estimated at 0.115 luminance. Everything in the key:shadow ratio rests on it and it is a solid-angle estimate, not a measurement.
2. Whether the rim's analytic specular crosses 1.75, and whether it looks like a jewel or like a mistake when it does. Section 2.5 has the ladder for both outcomes.
3. Whether half-extent 12 is the right coverage/density trade. It is a judgement about how often the player can see the island's back rim, and one session of play will settle it better than any arithmetic here.
