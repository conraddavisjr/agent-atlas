# Character and VFX design spec

Art direction for the player character and for the juice system that does not exist yet.
Build agents implement directly from this document; where a number is a guess rather than derived, it says so inline.

Read `docs/design/00-references.md` first.
This document assumes it.

## What this changes and what it does not

Frozen, do not touch:

- `BODY.capsuleHalfHeight` and `BODY.capsuleRadius` in `src/game/player/tuning.ts`.
  Movement feel is settled and the visual model is offset inside the capsule, so the model can be resized freely without touching either.
- The tank-control scheme, `movement.ts`, and everything in `MOVEMENT` and `JUMP`.
- The identity rules in `palette.ts:8-9` and `RobotModel.tsx:14-18`.
  No chrome dome, no two round blue eyes, no blue-and-white livery.
  The character stays warm amber on an off-white shell with a single horizontal cyan visor bar.

Kept and built on, not discarded:

- `WADDLE` in `tuning.ts` is the starting point for the gait, not a thing to re-derive.
- `TURN_ANIM` in `animTuning.ts` and the hips-lead/torso-lag/head-leads/feet-splay behaviour that was just added.
  Every constant in it survives; the spec moves where it is evaluated, not what it evaluates to.
- The four cosmetic sockets in `SocketName`.
  Section 1 gives each of them a new position and nothing else about them changes.

Replaced:

- The character's proportions, which are the single largest reason it does not read as a toy.
- The location of the animation logic, which is currently inline in a `.tsx` `useFrame` and therefore untestable.

Added:

- A contact shadow.
- A particle system.
- Screen shake, hit-stop, impact flash.
- An SDF visor shader.

---

## 0. Three findings from reading the current code

These are corrections, not opinions, and they change numbers elsewhere in this document.

**The squash spring is critically damped and cannot overshoot.**
`PlayerController.tsx:352-354` computes `springForce = -displacement * recovery^2` and `damping = -velocity * 2 * recovery`.
That is `omega_n = recovery` and `c = 2 * omega_n`, so the damping ratio is exactly 1.0.
A critically damped spring has zero overshoot by definition.
The comment on line 350 says it "overshoots very slightly", and `REVIVAL.landSquash`'s comment at `tuning.ts:119-127` says the rebound comes for free from that overshoot.
Neither is true as written.
The revival bounce that exists today is only the return to neutral, not a bounce.
Section 6 specifies an explicit damping ratio and a spring integrator that actually delivers the 8-15% overshoot the reference brief calls for.

**The visor almost certainly does not bloom.**
Bloom's threshold is 1.75 on raw HDR luminance.
`palette.visor` is `#4de2ff`, which is linear `(0.0743, 0.7605, 1.0000)`.
At `emissive(palette.visor, 2.4)` the emissive contribution is `(0.178, 1.825, 2.400)`, luminance `0.2126*0.178 + 0.7152*1.825 + 0.0722*2.400 = 1.516`.
That is below 1.75, so the one thing on the character that is supposed to glow is sitting under the threshold and only picking up whatever the `luminanceSmoothing` knee lets through.
The antenna bulb is worse: `palette.accent` at intensity 2.0 is linear `(2.000, 0.646, 0.090)`, luminance `0.894`, barely half the threshold.
Section 7 sets the visor core to 3.4 and section 1 sets the antenna bulb to 4.0, with the arithmetic shown.

**The visual model is roughly 1.34 m tall against a 1.40 m capsule.**
Feet bottom out at `y = 0.32 - 0.22 - 0.05 = 0.05` and the head crowns at `y = 1.12 + 0.22 = 1.34`.
The new proportions in section 1 keep the silhouette at 1.36 m so the capsule stays the right size for it, and the sole is moved to `y = 0.00` so the model's origin is genuinely the ground contact.
That last change is what lets the contact shadow and the foot IK share one coordinate convention.

---

## 1. Proportions

### The target and the tension in it

The reference brief gives two measurements from official renders and they do not agree with each other.

- Total height 2.5-2.8 head-heights.
- Head is 40-48% of silhouette height.

A character that is exactly 2.5 head-heights has a head that is 40.0% of its height, and one that is 2.8 head-heights has a head that is 35.7%.
The 40-48% band and the 2.5-2.8 band only overlap at a single point.
The brief marks both `[OBS]` at plus or minus 10%, so this is measurement scatter rather than a contradiction to resolve.

I take the head-height ratio as primary, because it is the number that actually governs the silhouette read, and I sit at the bottom of its range so the head fraction lands as close to 40% as possible.

**Chosen: total silhouette 1.36 m, head shell 0.54 m, ratio 2.52, head fraction 39.7%.**

Against the current character at roughly 4.5 head-heights with the head narrower than the torso, this is the whole change.

### Vertical decomposition

The brief's own decomposition is legs 0.7 head-heights, torso 1.0, head 1.0, total 2.7.
With a 0.54 m head that is 0.378 + 0.540 + 0.540 = 1.458 m, which is taller than the capsule.
The 0.10 m the head sinks into the torso is what reconciles it, and that overlap is correct anyway: this character has no neck.

| Band | From (m) | To (m) | Height (m) | Head-heights |
| --- | --- | --- | --- | --- |
| Legs and feet | 0.000 | 0.380 | 0.380 | 0.70 |
| Torso, hips through shoulders | 0.380 | 0.920 | 0.540 | 1.00 |
| Head shell | 0.820 | 1.360 | 0.540 | 1.00 |
| Overlap, head into torso | 0.820 | 0.920 | -0.100 | -0.19 |
| **Silhouette total** | 0.000 | 1.360 | **1.360** | **2.52** |

Antenna extends to 1.53 m but does not count toward the silhouette height, because a thin protrusion does not read as mass.
This matters: including it would give 2.83 head-heights and the character would look correct on paper and wrong on screen.

### Part-by-part table

All positions are the part's centre in the model's local space, where `y = 0` is the sole plane and `+z` is forward.
`w x h x d` is the bounding size in metres.

| Part | Parent | Size w x h x d | Centre (x, y, z) | Geometry | Material |
| --- | --- | --- | --- | --- | --- |
| footL / footR | kneeL / kneeR | 0.32 x 0.17 x 0.44 | (-+0.19, 0.085, 0.060) | RoundedBox r 0.065 | `rubber(palette.lockedDeep)` |
| shinL / shinR | legL / legR | 0.17 x 0.22 x 0.17 | (-+0.19, 0.250, 0.000) | Capsule r 0.085, len 0.10 | `mattePlastic(palette.shellShadow)` |
| diaper | hips | 0.62 x 0.28 x 0.52 | (0.000, 0.520, -0.030) | RoundedBox r 0.130 | `heroShell(palette.shell)` |
| torso | chest | 0.62 -> 0.52 x 0.36 x 0.52 -> 0.44 | (0.000, 0.740, 0.000) | Superellipsoid, tapered | `heroShell(palette.shell)` |
| chestPanel | chest | 0.30 x 0.20 x 0.05 | (0.000, 0.760, 0.245) | RoundedBox r 0.045 | `plastic(palette.accent)` |
| head | neck | 0.72 x 0.54 x 0.62 | (0.000, 1.090, 0.000) | RoundedBox r 0.110 | `heroShell(palette.shell)` |
| facePlate | head | 0.56 x 0.38 x 0.035 | (0.000, 1.045, 0.305) | Squircle extrusion, n = 4 | `visorPlate()` |
| visorQuad | facePlate | 0.56 x 0.38 | (0.000, 1.045, 0.325) | PlaneGeometry | `VisorMaterial` (section 7) |
| earPodL / earPodR | head | 0.08 x 0.21 x 0.21 | (-+0.380, 1.090, -0.020) | Rounded lathe disc | `plastic(palette.accentDeep)` |
| antennaBase | head | 0.030 dia x 0.09 | (0.200, 1.400, -0.040) | Cylinder r 0.015 | `metal(palette.rock)` |
| antennaMid | antennaBase | 0.026 dia x 0.08 | (0.000, 0.085, 0.000) | Cylinder r 0.013 | `metal(palette.rock)` |
| antennaTip | antennaMid | 0.10 dia | (0.000, 0.075, 0.000) | Sphere r 0.050 | `emissive(palette.accent, 4.0)` |
| shoulderL / shoulderR | chest | pivot only | (-+0.310, 0.870, 0.000) | none | none |
| upperArmL / R | shoulderL / R | 0.15 x 0.20 x 0.15 | (0.000, -0.130, 0.000) | Capsule r 0.075, len 0.09 | `plastic(palette.accent)` |
| handL / handR | shoulderL / R | 0.28 dia | (0.000, -0.340, 0.000) | Sphere r 0.140 | `heroShell(palette.shell)` |
| backpack | chest | 0.36 x 0.26 x 0.14 | (0.000, 0.800, -0.290) | RoundedBox r 0.055 | `plastic(palette.accentDeep)` |
| backVent | backpack | 0.22 x 0.04 x 0.02 | (0.000, 0.030, -0.075) | RoundedBox r 0.018 | `emissive(palette.visor, 2.6)` |

Ear pod outer extent is `0.380 + 0.105 = 0.485`, so the head's total width including pods is 0.97 m.
That is deliberately the widest thing on the character.

### The width ladder

Widest to narrowest, measured as the extreme x extent of each band:

| Band | Total width (m) | Ratio to head shell |
| --- | --- | --- |
| Head including ear pods | 0.970 | 1.35 |
| Head shell alone | 0.720 | 1.00 |
| Foot span, outer to outer | 0.700 | 0.97 |
| Hips and diaper | 0.620 | 0.86 |
| Shoulders | 0.620 | 0.86 |
| Torso at the shoulders | 0.520 | 0.72 |

**The head shell is wider than the torso at every height.**
That inversion, more than the head-height ratio, is what makes a character read as an infant rather than as a short adult.
The current model has a 0.56 m head on a 0.62 m torso, which is the exact opposite, and it is why the character currently reads as a small robot rather than as a toy.

The foot span being nearly as wide as the head is the second half of the read.
A wide planted stance under a heavy head is what says "low centre of gravity, stable, controllable", which is a platformer-design decision the current model already gets right and this spec preserves.

### The silhouette as a flat black shape

Filled to black at 32 px tall, the shape has to survive.
The test is that these five features are legible with no internal detail at all.

```
        _____________
      /               \          head band, 0.82 -> 1.36
     |    O       O    |         ear pods break the boxy top corners
     |                 |         39.7% of total height, widest mass in frame
      \_______________/
   O      /       \      O       hand mittens float clear of the torso
          |       |              shoulders 0.62 wide, torso narrows to 0.52
         /         \             torso band, 0.38 -> 0.92
        |           |
        \___________/            diaper flares back out to 0.62
         |         |
        _|_       _|_            leg stubs, barely visible
      /_____\   /_____\          feet, 0.70 span, 32% of body height in length
    ============================ ground, y = 0
```

Five checks a build agent can actually run, by rendering with `MeshBasicMaterial({ color: 0x000000 })` against white:

1. **Head mass**: the topmost connected black region, measured to the point where the outline first narrows below 0.60 m wide, is at least 38% of total height.
2. **Head-over-torso inversion**: the widest scanline in the top 40% of the silhouette is wider than the widest scanline in the middle 40%.
3. **Negative space at the arms**: with the arms at rest (`shoulder.rotation.z = -+0.22 rad`, angling the arms outward), there is a fully-enclosed white wedge of at least 0.010 m^2 between each arm and the torso.
   This is the single most fragile part of the read.
   Arms pinned to the sides merge into the torso and the character becomes one blob.
4. **Foot separation**: a white gap of at least 0.06 m between the two feet at rest.
   Feet that touch read as a pedestal, not as legs.
5. **Antenna asymmetry**: the antenna is off-centre at `x = 0.200`, which is what stops the silhouette being mirror-symmetric.
   A perfectly symmetric toy reads as a product shot; one asymmetric feature reads as a character.

### Head fraction sanity, against the reference

| Measure | Reference target | This spec | Current model |
| --- | --- | --- | --- |
| Total head-heights | 2.5 - 2.8 | 2.52 | ~4.5 |
| Head as % of silhouette | 40 - 48% | 39.7% | ~33% |
| Head wider than torso | yes | yes, 1.16x | no, 0.90x |
| Torso, head-heights | ~1.0 | 1.00 | ~1.36 |
| Legs, head-heights | ~0.7 | 0.70 | ~0.73 |
| Hand diameter, head-widths | 0.35 - 0.45 | 0.39 | 0.36 |
| Visor centre, % down face plate | 55 - 60% | 57% | ~45% |

Hand diameter 0.28 against head width 0.72 gives 0.389.
The current model's 0.20 m hand prop against a 0.56 m head gives 0.357, which is inside the band, so the hands were already close to right and only needed scaling with everything else.

The visor sits low on the face plate at 57% down, which is the infantile placement.
Face plate spans `y` 0.855 to 1.235, so 57% down from the top is `1.235 - 0.57 * 0.38 = 1.0184`.
That is 0.027 m below the plate's centre at 1.045, and the visor bar is centred there.

### Cosmetic sockets

All four sockets in `SocketName` keep working.
They move, they do not change contract.

| Socket | Parent node | Local position | World rest position | Note |
| --- | --- | --- | --- | --- |
| `head` | `head` | (0.000, 0.300, 0.000) | (0.000, 1.390, 0.000) | Crown plus 0.03 m clearance. The helmet in `RobotModel.tsx:231` is a hemisphere of radius 0.32; scale it to 0.42 to sit on the wider head. |
| `back` | `chest` | (0.000, 0.060, -0.290) | (0.000, 0.800, -0.290) | Coincident with the backpack block, which the cape hangs off. |
| `hand_l` | `shoulderL` | (0.000, -0.340, 0.000) | (-0.310, 0.530, 0.000) | The mitten's own centre. A held prop replaces the mitten rather than sitting beside it. |
| `hand_r` | `shoulderR` | (0.000, -0.340, 0.000) | (0.310, 0.530, 0.000) | Mirror. |

The socket groups must be created unconditionally and always present in the hierarchy, even when empty.
Creating them conditionally on `cosmetics[socket]` means the pose solver's node indices shift when a cosmetic is earned, and `applyPose` writes into the wrong nodes.

### Where the model sits in the capsule

Silhouette height 1.36 m against a capsule of `2 * (0.35 + 0.35) = 1.40 m`.
`PlayerController.tsx:419` already offsets the visual group by `-(capsuleHalfHeight + capsuleRadius) = -0.70 m`, which puts model `y = 0` exactly at the capsule's bottom pole.
Since the new model's sole plane is `y = 0`, the feet now sit on the capsule's contact point rather than 0.05 m above it, and nothing in `PlayerController` changes.

The 0.04 m of headroom between the crown and the capsule top is intentional slack, so the head never visually intersects a ceiling the capsule has already stopped against.

### Material presets the character needs

The reference brief is explicit that `plastic()`'s `roughness 0.35 / clearcoatRoughness 0.25` are too close together to resolve as two specular lobes.
Do not change the shared `plastic()` preset in this pass; other scenes are tuned against it.
Add one preset in `src/art/materials.ts`:

```ts
/**
 * The character's shell, and only the character's shell.
 *
 * Separated from plastic() because the whole world is tuned against that preset
 * and the character needs the two specular lobes to resolve at close range in a
 * way that a background prop at 12 metres does not.
 */
export function heroShell(color: string, overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color,
    roughness: 0.42,            // multiplied down by the roughness canvas map
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.10,   // 4.2x apart from base, so two lobes resolve
    envMapIntensity: 1.15,
    ...overrides,
  }
}

/** The near-black glossy plate the visor glyph is drawn on top of. */
export function visorPlate(overrides: MeshPhysicalMaterialProps = {}): MeshPhysicalMaterialProps {
  return {
    color: '#0d1218',
    roughness: 0.09,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,       // this is the surface that shows off the Lightformers
    ...overrides,
  }
}
```

Effective base roughness is `0.42 * roughnessMap.g`, and section 2 specifies a canvas map centred on 0.80, giving `0.34 +- 0.07`.
That lands inside the reference's 0.28-0.38 band for a hero white shell, with the variation the brief says is non-negotiable.

---

## 2. Geometry vocabulary

No GLB, no binary assets.
Everything is a three primitive, a drei `RoundedBox`, a generated `BufferGeometry`, or a canvas texture.

### The five shape families

| Family | Used for | Source |
| --- | --- | --- |
| Rounded box | head, diaper, feet, chest panel, backpack | drei `RoundedBox` |
| Tapered superellipsoid | torso | new, `src/art/geometry/superellipsoid.ts` |
| Extruded squircle | face plate | new, `src/art/geometry/squircle.ts` |
| Rounded lathe disc | ear pods | new, `src/art/geometry/roundedDisc.ts` |
| Capsule and sphere | shins, upper arms, hands, antenna bulb | three built-ins |

All four new geometry modules are pure `.ts` with no React and no three-scene dependency beyond `BufferGeometry`, so they are unit-testable under the existing vitest glob.
`src/art/flowerGeometry.ts` and its test are the precedent to copy.

### The squircle

The reference brief says the face is "neither square nor round, but somewhere in between", which is a Lame curve.

```ts
/**
 * A Lame superellipse: |x/a|^n + |y/b|^n = 1.
 *
 * n = 2 is an ellipse and n -> infinity is a rectangle.
 * n = 4 is the classic squircle and is what the reference brief describes.
 */
export function superellipsePoints(a: number, b: number, n: number, segments: number): Float32Array {
  const out = new Float32Array(segments * 2)
  const e = 2 / n
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2
    const c = Math.cos(th)
    const s = Math.sin(th)
    out[i * 2] = a * Math.sign(c) * Math.pow(Math.abs(c), e)
    out[i * 2 + 1] = b * Math.sign(s) * Math.pow(Math.abs(s), e)
  }
  return out
}
```

Parameters for the face plate: `a = 0.28`, `b = 0.19`, `n = 4`, `segments = 64`.

Build the solid by feeding those points into a `THREE.Shape` and extruding:

```ts
const shape = new Shape()
// moveTo the first point, lineTo the rest, closePath
const geometry = new ExtrudeGeometry(shape, {
  depth: 0.012,
  bevelEnabled: true,
  bevelThickness: 0.010,
  bevelSize: 0.012,
  bevelOffset: 0,
  bevelSegments: 3,
  curveSegments: 1,   // the outline is already polygonal
})
geometry.translate(0, 0, -0.006)   // centre the extrusion on its own origin
```

Total plate depth is `0.012 + 2 * 0.010 = 0.032`, which matches the 0.035 in the part table with 0.003 of clearance against the head shell.

Uniform sampling in theta clusters vertices unevenly for `n > 2`, putting more of them along the flats than at the corners.
At 64 segments the corner error is under 0.4 mm and invisible.
If a later pass wants a cleaner outline, resample by arc length; do not do it now.

### The tapered superellipsoid

The reference says the torso is "ovoid, wider at the base".
A `RoundedBox` cannot taper and a `SphereGeometry` cannot be square-ish, so this needs generating.

```ts
/**
 * A superellipsoid with a per-latitude taper.
 *
 * e1 controls vertical squareness and e2 horizontal squareness. Both at 1.0
 * gives an ellipsoid; both near 0 gives a box. 0.6 and 0.7 give the soft
 * rounded block that reads as a moulded torso rather than as an egg.
 *
 * taperTop is the width multiplier at the crown. Below 1 makes the shape wider
 * at the base, which is the reference brief's "wider at the base".
 */
export function superellipsoidGeometry(opts: {
  a: number; b: number; c: number       // half-extents, x / y / z
  e1: number; e2: number
  taperTop: number
  latSegments: number; lonSegments: number
}): BufferGeometry
```

The parametrisation, with `v` in `[-PI/2, PI/2]` and `u` in `[-PI, PI]`, and `p(t, e) = sign(t) * |t|^e`:

```
t     = (sin(v) + 1) / 2                                 // 0 at the base, 1 at the crown
taper = mix(1.0, taperTop, t * t * (3 - 2 * t))          // smoothstep
x = a * taper * p(cos v, e1) * p(cos u, e2)
y = b *         p(sin v, e1)
z = c * taper * p(cos v, e1) * p(sin u, e2)
```

Torso parameters: `a = 0.31`, `b = 0.18`, `c = 0.26`, `e1 = 0.60`, `e2 = 0.70`, `taperTop = 0.84`, `latSegments = 20`, `lonSegments = 28`.
That gives 0.62 wide and 0.52 deep at the base, narrowing to 0.52 and 0.44 at the shoulders, and 0.36 tall.

Call `geometry.computeVertexNormals()` after building.
The analytic normal of a superellipsoid has a removable singularity at the poles and at the four seams where a `cos` or `sin` term crosses zero, and computing it by hand produces NaN normals there.
Averaged face normals do not, and the shape is smooth enough that the difference is not visible.

Seam handling: generate `lonSegments + 1` columns with the last duplicating the first so the UV seam is clean, and collapse both pole rings to a single vertex.

### The rounded lathe disc, for ear pods

A bare `CylinderGeometry` has two 90 degree rims, and the reference brief is explicit that a plastic object never has a 90 degree corner.

```ts
/**
 * A disc lying on its side, with both rims filleted.
 *
 * Returns a lathe profile in the XY plane suitable for LatheGeometry, which is
 * then rotated so the disc's axis is +X.
 */
export function roundedDiscProfile(radius: number, halfThickness: number, fillet: number, filletSteps: number): Vector2[]
```

Profile, from the axis outward and back:

1. `(0, halfThickness)`
2. `(radius - fillet, halfThickness)`
3. `filletSteps` points on a quarter arc of radius `fillet` centred at `(radius - fillet, halfThickness - fillet)`, sweeping from 90 degrees to 0
4. `(radius, -(halfThickness - fillet))`
5. the mirror quarter arc
6. `(radius - fillet, -halfThickness)`
7. `(0, -halfThickness)`

Ear pod parameters: `radius = 0.105`, `halfThickness = 0.040`, `fillet = 0.022`, `filletSteps = 4`, `LatheGeometry` segments 20.
Then `geometry.rotateZ(Math.PI / 2)` so the axis lies along X.

### Chamfer and bevel table

The reference brief's rule is that every plastic edge takes a bevel that catches the key light as a bright line.
Nothing on this character has a sharp edge.

| Part | Method | Radius or fillet (m) | Radius as % of smallest dimension |
| --- | --- | --- | --- |
| head | RoundedBox `radius` | 0.110 | 20.4% of 0.54 |
| diaper | RoundedBox `radius` | 0.130 | 25.0% of 0.52 |
| foot | RoundedBox `radius` | 0.065 | 38.2% of 0.17 |
| chestPanel | RoundedBox `radius` | 0.045 | 22.5% of 0.20 |
| backpack | RoundedBox `radius` | 0.055 | 39.3% of 0.14 |
| backVent | RoundedBox `radius` | 0.018 | 45.0% of 0.04 |
| facePlate | Extrude bevel | 0.012 size / 0.010 thickness | - |
| earPod | Lathe fillet | 0.022 | 27.5% of 0.08 |
| torso | Superellipsoid `e1/e2` | implicit | - |
| shin, upperArm | Capsule | implicit | - |

`RoundedBox` `smoothness` is 4 for the head and diaper and 3 for everything else.
Smoothness 4 on a rounded box is 6 segments per corner arc, which at 0.11 m radius gives a 1.9 degree facet, well under the point at which the terminator shows steps.
Going to 5 costs geometry for no visible gain at this size.

### Procedural canvas textures

Two, both generated once at module load, both shared by every part of the character.
Neither is a binary asset.

**`characterRoughness`, 256 x 256, RGBA.**
Written to a `<canvas>` and wrapped in a `CanvasTexture`.
Three reads roughness from the green channel and occlusion from the red, which is the glTF ORM convention the README already documents at line 88.

- Red: constant 255. No baked AO on the character; N8AO handles contact.
- Green: three octaves of value noise at 8 / 24 / 64 cells, amplitudes 0.055 / 0.030 / 0.015, summed around a base of 0.80, clamped to `[0.62, 0.96]`.
  Multiplied against `heroShell`'s `roughness: 0.42`, that gives an effective `0.26` to `0.40`, centred on `0.336`.
- A 2 px horizontal line at `v = 0.5` with green pushed to 0.55, which is the injection-moulding parting line.
- Two 5 px filled circles at `(0.22, 0.72)` and `(0.78, 0.72)` with green at 0.62, which are ejector-pin marks.
  Placed in the upper half so they land on the back of the head and torso rather than on the face.
- Blue: unused, write 0.

Set `texture.colorSpace = NoColorSpace`, `wrapS = wrapT = RepeatWrapping`, `repeat = (1, 1)`, `anisotropy = 4`.
The roughness map must not be sRGB-decoded; leaving `colorSpace` at the default `SRGBColorSpace` shifts the whole surface toward smooth and the parting line disappears.

**`characterNormal`, 256 x 256, RGBA.**
Sobel of the same green channel, encoded as a tangent-space normal map.
`normalScale = new Vector2(0.22, 0.22)`.
The reference brief calls for 0.15-0.3 amplitude for moulding texture, and above 0.3 the shell starts reading as orange peel.

Both textures apply only to `heroShell` surfaces.
The accent, metal, rubber and visor plate materials use neither, which is deliberate: a parting line on the visor plate would read as a scratch.

### Cost

| Part | Triangles |
| --- | --- |
| head RoundedBox, smoothness 4 | 1,152 |
| torso superellipsoid, 20 x 28 | 1,120 |
| diaper RoundedBox, smoothness 4 | 1,152 |
| 2 feet RoundedBox, smoothness 3 | 1,024 |
| face plate extrusion, 64 segments, 3 bevel | 896 |
| 2 ear pods, lathe 20 x 14 | 1,120 |
| 2 hands, sphere 16 x 12 | 704 |
| 2 shins, 2 upper arms, capsules | 768 |
| antenna, 2 cylinders and a sphere | 288 |
| backpack, vent, chest panel | 1,344 |
| visor quad | 2 |
| **Total** | **~9,570** |

Draw calls: 19 opaque plus 1 transparent for the visor quad.
The current model is 12 draw calls, so this is 8 more, which is inside the noise next to a 220,000 instance grass field.

Do not merge geometries to reduce the count.
Every node in the list is animated independently by the rig in section 3, and merging would require re-uploading vertex buffers every frame, which is strictly worse than 8 extra draw calls.

---

## 3. The rig

### The argument: no SkinnedMesh

**Recommendation: a nested `Group` hierarchy, not a `SkinnedMesh`.**
This is not a compromise forced by the no-GLB constraint, it is the correct choice on the merits.

Four reasons.

**The world rule is that everything is a manufactured object.**
`00-references.md` section 1 says the team replaced hair and fabric with vinyl specifically to preserve the manufactured read.
A manufactured object has rigid parts joined at revolute joints.
Skinning exists to make a surface deform continuously across a joint, which is what flesh does and what moulded ABS does not.
A skinned shoulder on this character would be a bug, not a feature.

**Skinning without authored clips buys nothing.**
The payoff of a real bone rig is three things: smooth deformation, blend shapes, and the ability to play authored `AnimationClip` data through an `AnimationMixer`.
We want none of the first, have no use for the second, and cannot have the third without a GLB.
Every pose here is computed procedurally per frame, and a procedural solver writing bone matrices is exactly as much work as one writing `Group` transforms, with an extra skinning pass on the GPU for free.

**Squash and stretch works better on rigid parts.**
Volume-preserving squash is a non-uniform scale, and non-uniform scale on a `SkinnedMesh` is well known to be wrong: the bind-pose inverse matrices do not commute with anisotropic scale, and shoulders collapse.
The current implementation scales the root `Group`, which is correct and free, and section 6 keeps it.

**The one thing that genuinely wants deformation is the cape, and a chain solves it better.**
A skinned cape needs weights, which need authoring, which needs a GLB.
A four-segment chain of quads on `Group` nodes, each driven by a spring, gives more controllable secondary motion for less work, and is testable because the spring chain is pure.

The honest counter-argument: if this project ever wants an authored animation library, motion-captured or hand-keyed, the rig has to become skinned and this decision has to be revisited.
Nothing in this spec makes that harder than it is today, because the `Pose` struct in section 4 is a joint-transform list, which is exactly what a bone rig consumes.
Swapping `Group` nodes for `Bone` nodes is a change to `applyPose` and nothing else.

### The full joint hierarchy

26 nodes.
Node names are exact and are the keys in the `RigRefs` type in section 4.

```
playerVisual                       (owned by PlayerController, carries `facing`)
|
+-- root                           squash/stretch scale, whole-body Y offset
|   |
|   +-- hips                       waddle roll (z), lean (x), turn lag (y), bob (y)
|       |
|       +-- diaper                 [mesh]
|       |
|       +-- chest                  spring-lagged counter-rotation against hips
|       |   |
|       |   +-- torso              [mesh]
|       |   +-- chestPanel         [mesh]
|       |   +-- backpack           [mesh]
|       |   |   +-- backVent       [mesh]
|       |   +-- backSocket         cosmetics.back
|       |   |   +-- capeSeg0       spring chain, 4 segments
|       |   |       +-- capeSeg1
|       |   |           +-- capeSeg2
|       |   |               +-- capeSeg3
|       |   |
|       |   +-- shoulderL          arm swing (x), rest splay (z)
|       |   |   +-- upperArmL      [mesh]
|       |   |   +-- handSocketL    cosmetics.hand_l
|       |   |       +-- handL      [mesh], hidden when a prop is socketed
|       |   +-- shoulderR          mirror
|       |   |   +-- upperArmR      [mesh]
|       |   |   +-- handSocketR
|       |   |       +-- handR      [mesh]
|       |   |
|       |   +-- neck               zero-length, the head's spring pivot
|       |       +-- head           head lead/lag (y), nod (x), tilt (z)
|       |           +-- headMesh   [mesh]
|       |           +-- facePlate  [mesh]
|       |           |   +-- visorQuad  [mesh, transparent]
|       |           +-- earPodL    [mesh], jiggle (x rotation)
|       |           +-- earPodR    [mesh], jiggle
|       |           +-- antennaBase    spring chain, 2 segments
|       |           |   +-- antennaMid
|       |           |       +-- antennaTip [mesh, emissive]
|       |           +-- headSocket cosmetics.head
|       |
|       +-- legL                   swing (x), splay (y)
|       |   +-- kneeL              bend (x), IK vertical offset (y)
|       |       +-- shinL          [mesh]
|       |       +-- footL          [mesh], ground-normal alignment (x, z)
|       +-- legR                   mirror
|           +-- kneeR
|               +-- shinR
|               +-- footR
```

Plus one node that is deliberately **not** a child of anything above:

```
contactShadow                      parented to the scene, not to root
```

The shadow must not inherit the root's squash scale.
A shadow that squashes with the body is the specific bug that makes a contact shadow look like a decal stuck to the character's feet rather than like a shadow on the floor.
It is positioned in world space every frame from the raycast in section 8.

### Rest transforms

`applyPose` writes `rest + poseOffset`, never absolute values, so the rest pose lives in one place and the solver never needs to know the geometry.

```ts
// src/game/player/proportions.ts  -- pure, exported, unit tested
export const PROPORTIONS = {
  totalHeight: 1.36,
  headHeight: 0.54,
  headWidth: 0.72,
  torsoWidthMax: 0.62,
  soleY: 0.0,
} as const

export const REST = {
  root:       { x: 0,      y: 0,     z: 0     },
  hips:       { x: 0,      y: 0.520, z: 0     },
  chest:      { x: 0,      y: 0.220, z: 0     },   // local to hips -> world 0.740
  neck:       { x: 0,      y: 0.150, z: 0     },   // local to chest -> world 0.890
  head:       { x: 0,      y: 0.200, z: 0     },   // local to neck  -> world 1.090
  shoulderL:  { x: -0.310, y: 0.130, z: 0     },
  shoulderR:  { x:  0.310, y: 0.130, z: 0     },
  legL:       { x: -0.190, y: -0.140, z: 0    },   // local to hips -> world 0.380
  legR:       { x:  0.190, y: -0.140, z: 0    },
  knee:       { x: 0,      y: -0.130, z: 0    },
  foot:       { x: 0,      y: -0.165, z: 0.060 },
  antennaBase:{ x: 0.200,  y: 0.310, z: -0.040 },
  capeRoot:   { x: 0,      y: 0.060, z: -0.290 },
} as const

export const REST_ROTATION = {
  /** Arms angle outward at rest, which is what keeps the negative-space wedge open. */
  shoulderL: { x: 0, y: 0, z:  0.22 },
  shoulderR: { x: 0, y: 0, z: -0.22 },
  /** Feet toe out slightly. A perfectly parallel stance reads as a mannequin. */
  legL: { x: 0, y: -0.10, z: 0 },
  legR: { x: 0, y:  0.10, z: 0 },
} as const
```

`PROPORTIONS` exists as a module so section 12's proportion test can assert on it, which is what stops a future edit quietly un-toying the character.

### What `RobotModel.tsx` keeps

Only the JSX tree, the refs, and one `useFrame` that calls two functions.
No arithmetic in the component at all.
That is the subject of section 4.

---

## 4. The architecture that matters: pose out of the component

### The problem

Every line of animation in this project today lives inside `RobotModel.tsx`'s `useFrame`, lines 42 to 133.
`vitest.config.ts` globs `src/**/*.test.ts` and nothing else, so a `.test.tsx` is silently skipped, and even if it were not, testing a `useFrame` means mounting a renderer.
The result is that the most tuning-sensitive code in the game has zero test coverage while the movement code next to it, which was extracted into `movement.ts` for exactly this reason, has good coverage.

`movement.ts` is the precedent and this section applies it to animation.

### The split

The rule is one sentence.

**A module may compute what pose the robot is in, or it may write transforms onto `Object3D`s, and never both.**

Everything on the first side is a `.ts` file with no React import, no `useFrame`, and no allocation after construction.
Everything on the second side is one function and one component.

### Module layout

```
src/game/player/
  proportions.ts     PROPORTIONS, REST, REST_ROTATION                  pure, tested
  pose.ts            Pose, JointPose, FaceParams, createPose()         pure, tested
  springs.ts         Spring1, Spring3, stepSpring, chain solvers       pure, tested
  rng.ts             mulberry32, a seedable deterministic RNG          pure, tested
  gait.ts            step cycle, waddle, turn lag, limb swing          pure, tested
  idle.ts            breathing and the fidget state machine            pure, tested
  impact.ts          squash envelopes, anticipation, landing           pure, tested
  faceSolver.ts      FaceParams from state and time                    pure, tested
  footIk.ts          foot placement from ground samples                pure, tested
  animRuntime.ts     AnimRuntime, createAnimRuntime(), stepAnim()      pure, tested
  robotAnim.ts       RobotAnimState + the event ring (existing file)   pure, tested
  animTuning.ts      constants (existing file, extended)               data
  rig.ts             RigRefs, applyPose(pose, rig)                     three-only, tested
  RobotModel.tsx     JSX, refs, one useFrame of five lines             not tested
```

`rig.ts` imports `three` but not React, and `Object3D` works fine in vitest's `node` environment because it is pure matrix maths with no WebGL context.
So `applyPose` is testable too, which matters: "does the head node actually receive the head pose" is a real bug class and it is cheap to cover.

### The call graph, exactly

```
PlayerController.useBeforePhysicsStep   (60 Hz fixed)
  writes RobotAnimState fields
  pushes AnimEvents onto the ring

RobotModel.useFrame                     (render rate)
  stepAnim(runtime, animState, ground, dt, pose)     <- pure, all the maths
  applyPose(pose, rig)                               <- writes Object3Ds
  writeVisorUniforms(pose.face, visorMaterial)       <- writes uniforms

VfxSystem.useFrame                      (render rate)
  drainEvents(ring, vfxCursor, emitFn)               <- reads the same ring
  particleField.uTime = gameClock.elapsed

FollowCamera.useFrame                   (render rate)
  ... existing ...
  applyShake(camera, shakeState, dt)                 <- section 11
```

`stepAnim` is the single entry point and its signature is:

```ts
export function stepAnim(
  rt: AnimRuntime,
  s: Readonly<RobotAnimState>,
  ground: Readonly<GroundSample>,
  dt: number,
  out: Pose,
): void
```

It returns `void` and writes into `out`.
It allocates nothing.
It reads nothing global except the frozen constant objects in `tuning.ts` and `animTuning.ts`.

Everything that has to persist between frames lives in `rt`, which is created once by `createAnimRuntime(seed)` and owned by a `useRef` in `RobotModel`.
That is what makes the whole thing deterministic and testable: give a test the same `rt` seed and the same script of `(state, dt)` pairs and it must produce identical numbers.

### The `Pose` struct

```ts
// src/game/player/pose.ts

/**
 * One joint's offset from its rest transform.
 *
 * Offsets rather than absolutes, so the solver never has to know where anything
 * is. REST in proportions.ts owns the geometry and this owns the motion, and
 * changing a limb's rest position cannot break the animation that drives it.
 *
 * Scale is a multiplier, so 1 is neutral and the identity pose is all zeros
 * except for the three scale fields.
 */
export type JointPose = {
  px: number; py: number; pz: number
  rx: number; ry: number; rz: number
  sx: number; sy: number; sz: number
}

export type FaceParams = {
  /** 0 fully closed, 1 neutral, up to 1.6 for surprise. Never reaches 0. */
  openL: number
  openR: number
  /** -1 downturned, 0 flat, +1 upturned arc. */
  archL: number
  archR: number
  /** Horizontal squash of each eye core. 0.5 narrow to 1.4 wide. */
  widthL: number
  widthR: number
  /** Gaze offset in face-plate space, -1..1, applied to the eye cores only. */
  gazeX: number
  gazeY: number
  /** HDR multiplier on the emissive core. Section 7 budgets this against bloom. */
  brightness: number
  /** Scanline scroll, radians. Advances on the scaled clock so hit-stop freezes it. */
  scanPhase: number
  /** 0..1, a brief horizontal tear used on damage and portal entry. */
  glitch: number
}

export type ShadowPose = {
  /** World-space position of the shadow quad. */
  x: number; y: number; z: number
  /** Ground normal at the contact point. */
  nx: number; ny: number; nz: number
  radius: number
  opacity: number
  /** Elongation along the direction of travel, 1 is circular. */
  stretch: number
  /** Facing of the elongation, radians, world Y. */
  yaw: number
}

/**
 * The complete answer to "what pose is the robot in", as plain numbers.
 *
 * A struct of objects rather than a Float32Array. The write count is 24 joints
 * times 9 fields plus the face and shadow, which is under 250 numbers a frame
 * and not remotely a bottleneck, and named fields make the solver and its tests
 * readable in a way that POSE[JOINT_HEAD * 9 + 4] does not.
 *
 * Created once by createPose() and mutated in place forever after. Nothing in
 * the animation path may allocate, because a per-frame allocation at 60 Hz is
 * garbage the collector eventually stops for, and it stops for it during the
 * exact moments the game is working hardest.
 */
export type Pose = {
  root: JointPose
  hips: JointPose
  chest: JointPose
  neck: JointPose
  head: JointPose
  shoulderL: JointPose; shoulderR: JointPose
  handSocketL: JointPose; handSocketR: JointPose
  legL: JointPose; legR: JointPose
  kneeL: JointPose; kneeR: JointPose
  footL: JointPose; footR: JointPose
  earPodL: JointPose; earPodR: JointPose
  antennaBase: JointPose; antennaMid: JointPose
  backpack: JointPose
  /** Fixed length 4. Segments beyond quality.capeSegments are left at identity. */
  cape: [JointPose, JointPose, JointPose, JointPose]
  face: FaceParams
  shadow: ShadowPose
}

export function createJointPose(): JointPose {
  return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
}

export function createPose(): Pose { /* one createJointPose() per field */ }

/** Resets every joint to identity. Called at the top of stepAnim. */
export function resetPose(p: Pose): void
```

`resetPose` at the top of `stepAnim` is not optional.
Without it, a solver branch that stops writing a field (a fidget that ends, a foot IK that disengages) leaves the previous frame's value in place, and the character freezes in a half-pose.
That failure mode is subtle enough to survive a code review, so the reset is unconditional and the cost is 250 stores.

### `AnimRuntime`

```ts
export type AnimRuntime = {
  /** Step-cycle phase in radians. The existing `phase` ref, promoted. */
  phase: number
  /** Eased turn input. The existing `turn` ref, promoted. */
  turnEased: number
  /** Seconds since the last footstep event, so the gait can fire at most one per half cycle. */
  sinceStep: number
  /** Which foot planted last, 0 left 1 right. */
  lastFoot: 0 | 1

  /** Breathing phase in radians, advanced only while idle. */
  breathPhase: number
  /** Seconds spent below the idle speed threshold. */
  idleTime: number

  fidget: {
    kind: FidgetKind        // 0 = none
    t: number               // elapsed within the current fidget
    duration: number
    nextAt: number          // idleTime at which the next fidget fires
    lastKind: FidgetKind    // so the same fidget never repeats back to back
  }

  face: {
    blinkAt: number         // absolute scaled-clock time of the next blink
    blinkT: number          // -1 when not blinking, else elapsed within the blink
    doubleRemaining: 0 | 1
    gazeX: number           // smoothed
    gazeY: number
    expression: Expression  // the current base shape
    expressionHold: number  // seconds remaining before it decays to neutral
  }

  springs: {
    squash: Spring1         // vertical scale, driven by RobotAnimState.squash targets
    chestYaw: Spring1       // torso lag against the hips
    headYaw: Spring1        // head lead
    headPitch: Spring1      // nod, driven by vertical acceleration
    headRoll: Spring1
    antenna: [Spring2, Spring2]     // 2 segments, each 2-DOF (x and z bend)
    earPod: [Spring1, Spring1]
    cape: [Spring2, Spring2, Spring2, Spring2]
    footIkL: Spring1        // IK blend weight and height, smoothed
    footIkR: Spring1
    shadowRadius: Spring1
  }

  /** Seeded, so fidget and blink schedules are reproducible in tests. */
  rng: { s: number }

  /** Absolute scaled-clock time, advanced by dt each call. Never read from outside. */
  t: number

  /** The consumer cursor into the event ring. Owned by stepAnim. */
  eventCursor: number
}
```

Every field is a number, a small fixed struct, or a fixed-length array of them.
Nothing here is a `Map`, a `Set`, or a growable array, which is what keeps the no-allocation property enforceable by inspection.

### `GroundSample`

The one piece of world state the solver needs and cannot derive.

```ts
/**
 * The result of the single downward raycast in section 8.
 *
 * Sampled once per frame by the component and handed to the solver, rather than
 * the solver reaching into Rapier. That is what keeps stepAnim pure, and it is
 * also what lets a test drive the foot IK over a synthetic staircase without a
 * physics world.
 */
export type GroundSample = {
  hit: boolean
  /** World Y of the contact point under the body centre. */
  y: number
  /** Distance from the sole plane down to the contact. 0 when standing. */
  distance: number
  nx: number; ny: number; nz: number
  /** Per-foot samples. Populated only when quality.footIk is true. */
  footHitL: boolean; footYL: number
  footHitR: boolean; footYR: number
}
```

### `rig.ts`

```ts
export type RigRefs = {
  root: Object3D | null
  hips: Object3D | null
  // ... one field per node in the section 3 hierarchy, same names
  cape: [Object3D | null, Object3D | null, Object3D | null, Object3D | null]
}

/**
 * Writes a Pose onto the rig.
 *
 * Deliberately mechanical and deliberately branch-free apart from the null
 * guards. Every decision was made in stepAnim; if this function is doing
 * arithmetic beyond adding a rest offset, something belongs on the other side
 * of the boundary.
 */
export function applyPose(p: Pose, rig: RigRefs): void {
  writeJoint(rig.root, p.root, REST.root, null)
  writeJoint(rig.hips, p.hips, REST.hips, null)
  writeJoint(rig.shoulderL, p.shoulderL, REST.shoulderL, REST_ROTATION.shoulderL)
  // ...
}

function writeJoint(o: Object3D | null, j: JointPose, rest: Vec3, restRot: Vec3 | null): void {
  if (!o) return
  o.position.set(rest.x + j.px, rest.y + j.py, rest.z + j.pz)
  if (restRot) o.rotation.set(restRot.x + j.rx, restRot.y + j.ry, restRot.z + j.rz)
  else o.rotation.set(j.rx, j.ry, j.rz)
  o.scale.set(j.sx, j.sy, j.sz)
}
```

Rotation order stays three's default `XYZ` everywhere.
Changing it per joint is a real temptation for the head, where a yaw-then-pitch order avoids a small gimbal artefact at extreme angles, and it is not worth it: the head never exceeds 0.5 rad on any axis and the artefact is not visible below about 1.2 rad.

### What `RobotModel.tsx` becomes

```tsx
export function RobotModel({ anim, cosmetics, ground }: Props) {
  const rig = useRigRefs()                       // one useRef per node, typed as RigRefs
  const rt = useRef<AnimRuntime | null>(null)
  if (rt.current === null) rt.current = createAnimRuntime(0xA71A5)
  const pose = useRef<Pose | null>(null)
  if (pose.current === null) pose.current = createPose()
  const visor = useRef<ShaderMaterial>(null)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    stepAnim(rt.current!, anim.current, ground.current, dt, pose.current!)
    applyPose(pose.current!, rig)
    if (visor.current) writeVisorUniforms(pose.current!.face, visor.current.uniforms)
  })

  return (/* JSX only */)
}
```

The `rt.current === null` pattern rather than `useMemo` is the same one `PlayerController.tsx:99` already uses, for the same reason stated there: these are explicitly mutable per-frame buffers and `useMemo` values may not be mutated after render.

The `dt` clamp stays at `Math.min(delta, 0.05)` for the same reason as today.
Do not move it inside `stepAnim`; a test that wants to prove the solver survives a 10 second step needs to be able to pass one.

### Why not a state machine or a behaviour tree

Both were considered and both are wrong here.
The character has no discrete states worth naming beyond grounded and airborne, and the interesting behaviour is all continuous blending: the waddle does not switch on, it fades in with `speedNorm`.
A state machine over continuous blends produces exactly the pops that the springs exist to remove.

---

## 5. `RobotAnimState`, extended

### The full field list

Existing fields keep their names, types and meanings.
New fields are marked.

| Field | Type | Written by | Read by | Meaning |
| --- | --- | --- | --- | --- |
| `speedNorm` | number | PlayerController, physics step | gait, idle, faceSolver, VFX | Horizontal speed over `MOVEMENT.maxSpeed`, 0..1. |
| `turnNorm` | number | PlayerController, physics step | gait | Turn input, -1..1. From input, not velocity. |
| `throttle` | number | PlayerController, physics step | gait | Signed drive input, -1..1. |
| `grounded` | boolean | PlayerController, physics step | gait, impact, footIk, VFX | Rapier's `computedGrounded()`. |
| `verticalVelocity` | number | PlayerController, physics step | impact, faceSolver | m/s, signed. |
| `squash` | number | PlayerController and impact.ts | rig via pose | 1 neutral. Kept for compatibility; see the note below. |
| `airTime` | number | **new**, PlayerController | impact, faceSolver, VFX | Seconds since leaving the ground, 0 while grounded. |
| `groundTime` | number | **new**, PlayerController | idle, gait | Seconds since landing, 0 while airborne. |
| `facing` | number | **new**, PlayerController | shadow, VFX, speedLines | The authoritative heading, already tracked in a ref at `PlayerController.tsx:72`. Publishing it removes the need for VFX to read it off the follow target. |
| `turnRate` | number | **new**, PlayerController | gait, impact | Actual d(facing)/dt in rad/s, so a turn snap can be detected without differentiating in the solver. |
| `worldX/Y/Z` | number | **new**, PlayerController | VFX, shadow | The body translation, copied once per step so no consumer calls into Rapier. |
| `velX/Y/Z` | number | **new**, PlayerController | VFX, speedLines, cape drag | World velocity, copied. |
| `interactFocus` | 0 \| 1 | **new**, App via a setter | faceSolver | Whether a totem is focused. Drives the gaze target and the `focused` expression. |
| `focusX/Y/Z` | number | **new**, App via a setter | faceSolver | World position of the focused object, for eye tracking. |
| `reviving` | boolean | **new**, PlayerController | impact, faceSolver | Already exists as a ref at `PlayerController.tsx:81`. Publishing it lets the face play `surprised` on arrival. |
| `events` | AnimEventRing | **new**, see below | stepAnim, VfxSystem | The one-shot channel. |

`squash` stays a field on `RobotAnimState` rather than moving wholly into `AnimRuntime` because `PlayerController` writes it directly on jump and land today, and `window.__player` reads it in dev.
Section 6 changes who integrates it: the spring moves out of `PlayerController.useFrame` and into `impact.ts`, and `PlayerController` writes only the target impulse.

### The event ring

A fixed-capacity, never-allocating, single-producer multiple-consumer ring.

```ts
// src/game/player/robotAnim.ts

export const ANIM_EVENT_CAPACITY = 64   // power of two, so the index is a mask

export const EV = {
  None: 0,
  Jump: 1,
  Land: 2,
  Footstep: 3,
  Revive: 4,
  Death: 5,
  Collect: 6,
  PortalEnter: 7,
  TotemFocus: 8,
  Bonk: 9,
  TurnSnap: 10,
} as const
export type AnimEventKind = (typeof EV)[keyof typeof EV]

/**
 * One-shot events, as parallel typed arrays rather than objects.
 *
 * Typed arrays because the alternative is either allocating an event object per
 * push, which is garbage at exactly the moments the game is busiest, or a pool
 * of pre-allocated objects, which is the same thing with more bookkeeping.
 *
 * `head` is a monotonically increasing counter that is never wrapped; the slot
 * is `head & (CAPACITY - 1)`. That is what lets several consumers each hold
 * their own cursor without coordinating, and it makes "has this consumer fallen
 * behind" a subtraction rather than a modular comparison.
 */
export type AnimEventRing = {
  kind: Uint8Array          // ANIM_EVENT_CAPACITY
  /** Emission point, world space. */
  x: Float32Array; y: Float32Array; z: Float32Array
  /** Surface normal, or a direction, depending on kind. Unit length. */
  nx: Float32Array; ny: Float32Array; nz: Float32Array
  /** Primary magnitude, normalised 0..1 unless a kind says otherwise. */
  a: Float32Array
  /** Secondary scalar. Kind-specific: foot index, reward hue index, and so on. */
  b: Float32Array
  /** Scaled-clock timestamp of the emission. */
  t: Float32Array
  /** Total pushes ever. Slot index is `head & (CAPACITY - 1)`. */
  head: number
  /** Incremented when a consumer had to fast-forward past unread events. */
  dropped: number
}

export function createAnimEventRing(): AnimEventRing

/** Never fails, never allocates. Overwrites the oldest slot when full. */
export function pushEvent(
  r: AnimEventRing, kind: AnimEventKind, t: number,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  a: number, b: number,
): void {
  const i = r.head & (ANIM_EVENT_CAPACITY - 1)
  r.kind[i] = kind
  // ... nine more stores ...
  r.head++
}

/**
 * Advances `cursor` to `head`, calling `fn` for each event in order.
 *
 * Returns the new cursor. A consumer more than CAPACITY behind has had events
 * overwritten under it, so it fast-forwards to the oldest slot still valid and
 * counts the loss. That is the correct trade for a cosmetic channel: a dropped
 * dust puff is nothing, and a system that blocks the producer to avoid one is
 * a bug.
 */
export function drainEvents(
  r: AnimEventRing, cursor: number,
  fn: (r: AnimEventRing, slot: number) => void,
): number
```

### Per-kind payload

| Kind | `a` | `b` | position | normal | Written by |
| --- | --- | --- | --- | --- | --- |
| `Jump` | launch speed over `JUMP.velocity`, 0..1 | 1 if the jump was buffered, else 0 | sole plane centre | ground normal | PlayerController, on `vertical.jumped` |
| `Land` | `min(1, abs(vy) / abs(JUMP.maxFallSpeed))` | 1 if this was the revival landing | ground contact | ground normal | PlayerController, at the existing landing branch |
| `Footstep` | `speedNorm` at plant | 0 left, 1 right | the planted foot's IK position | ground normal | `gait.ts` inside `stepAnim` |
| `Revive` | 1 | 0 | spawn point | up | PlayerController |
| `Death` | 1 | 0 | body centre at the kill plane | up | PlayerController |
| `Collect` | 1 | reward hue index, 0 gold 1 cyan 2 magenta | the collected object | up | App, on lesson completion |
| `PortalEnter` | 1 | 0 | the portal centre | portal forward | `Portal.tsx` |
| `TotemFocus` | 1 enter, 0 leave | 0 | the totem node | up | `LessonTotem.tsx` |
| `Bonk` | impact over `JUMP.velocity` | 0 | crown | down | PlayerController, at the ceiling branch on line 303 |
| `TurnSnap` | `abs(turnRate) / MOVEMENT.turnRate` | `sign(turnRate)` | body centre | up | `gait.ts` |

### The same channel feeds VFX

This is the point of the design and it is worth stating flatly.

`stepAnim` holds `rt.eventCursor` and `VfxSystem` holds its own `vfxCursor`, and both drain the same ring.
There is no second event system, no callback registry, and no `useEffect` bridging gameplay to particles.
When a landing needs a deeper squash and a dust ring and a screen shake, that is one `pushEvent` and three consumers.

Two consequences a build agent must not get wrong.

**Every event carries its own timestamp, so consumer order does not matter.**
The VFX emitter sets each particle's `aSeedTime` to `ring.t[slot]`, not to the current frame time.
So if `VfxSystem`'s `useFrame` happens to run before `RobotModel`'s on some frame, the particles are still seeded at the correct instant and the arc is identical.

**Do not use R3F's `useFrame` priority to order them.**
In react-three-fiber, passing a non-zero `renderPriority` to any `useFrame` disables automatic rendering for the whole canvas and makes the caller responsible for `gl.render()`.
Reaching for priority to fix an ordering problem that the timestamps have already solved would black-screen the game.
The timestamped ring exists precisely so that ordering is a non-issue.

**Screen shake is the one consumer with an ordering requirement**, and it is satisfied by construction rather than by priority: `FollowCamera` applies shake at the very end of its own `useFrame`, after `camera.lookAt`, reading a shake state that was advanced in the same call.
See section 11.

### Capacity

64 slots.
The worst realistic frame is a landing that also completes a lesson: `Land`, `Footstep`, `Collect`, `TurnSnap`, so 4.
At 60 Hz a consumer would have to stall for 16 frames to overflow, which only happens if a tab is backgrounded, in which case dropping is exactly right.
`dropped` is exposed on `window.__player` in dev so a stall is visible rather than silent.

---

## 6. Animation features, with numbers

### The spring integrator

Everything that settles uses one integrator.

```ts
// src/game/player/springs.ts

export type Spring1 = { x: number; v: number; target: number }

/**
 * Semi-implicit Euler, not explicit Euler.
 *
 * The distinction is the single line `s.x += s.v * dt` coming AFTER the
 * velocity update rather than before. Explicit Euler adds energy every step and
 * a stiff spring at a 50 ms step diverges; semi-implicit is symplectic and
 * stays bounded even when the step is far too large for the stiffness. Since dt
 * here is whatever the browser hands us after a tab regains focus, that is not
 * a theoretical concern.
 */
export function stepSpring1(s: Spring1, omega: number, zeta: number, dt: number): void {
  const k = omega * omega
  const c = 2 * zeta * omega
  s.v += (-(s.x - s.target) * k - s.v * c) * dt
  s.x += s.v * dt
}
```

`Spring2` is the same with an `x`/`z` pair sharing one omega and zeta, for the two-axis bend chains.
`Spring3` adds `y`, for the cape.

Parametrised by `omega` (natural frequency, rad/s) and `zeta` (damping ratio), not by raw stiffness and damping.
That is the change that makes the numbers meaningful: `zeta` alone determines overshoot, and `omega` alone determines speed.

Overshoot for a step response is `exp(-pi * zeta / sqrt(1 - zeta^2))`.

| zeta | Overshoot | Reads as |
| --- | --- | --- |
| 1.00 | 0% | dead. This is what the current squash spring does. |
| 0.70 | 4.6% | firm |
| 0.62 | 8.0% | the bottom of the reference's 8-15% band |
| 0.58 | 10.7% | **the default for body settles** |
| 0.52 | 15.0% | the top of the band |
| 0.35 | 30.6% | a wobbler, for the ear pods |
| 0.18 | 56.4% | a spring antenna |

Time to first overshoot peak is `pi / (omega * sqrt(1 - zeta^2))`.
Time to settle within 5% is approximately `3 / (zeta * omega)`.

### Spring table

Every spring in `AnimRuntime.springs`, with its constants.

| Spring | omega | zeta | Overshoot | Peak at (ms) | 5% settle (ms) | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `squash`, landing | 16.0 | 0.60 | 9.5% | 245 | 313 | Snappy. New `SQUASH.landOmega`. |
| `squash`, takeoff | 11.0 | 0.62 | 8.0% | 364 | 440 | Softer, so the stretch reads through the rise. |
| `squash`, revival | 9.0 | 0.55 | 12.6% | 418 | 606 | Keeps `SQUASH.recovery = 9`'s pace and gives it the bounce its comment already promises. |
| `chestYaw` | 13.0 | 0.65 | 6.4% | 318 | 355 | Torso lag against the hips. |
| `headYaw` | 18.0 | 0.68 | 5.1% | 238 | 245 | Head arrives before the torso. |
| `headPitch` | 15.0 | 0.55 | 12.6% | 251 | 364 | Nod on vertical acceleration. |
| `headRoll` | 15.0 | 0.70 | 4.6% | 293 | 286 | |
| `antenna[0]` | 11.8 | 0.18 | 56.4% | 271 | 1412 | ~3.4 visible oscillations. |
| `antenna[1]` | 14.5 | 0.16 | 60.5% | 220 | 1293 | Tip is faster than the base, which is what makes it read as a whip. |
| `earPod[0..1]` | 21.0 | 0.50 | 16.3% | 173 | 286 | |
| `cape[0]` | 9.5 | 0.30 | 37.0% | 347 | 1053 | |
| `cape[1]` | 8.5 | 0.30 | 37.0% | 388 | 1176 | |
| `cape[2]` | 7.6 | 0.32 | 34.4% | 436 | 1234 | |
| `cape[3]` | 6.8 | 0.34 | 32.0% | 490 | 1298 | |
| `footIkL/R` | 22.0 | 1.00 | 0% | - | 136 | Critically damped on purpose. A foot that overshoots its ground contact is a foot inside the floor. |
| `shadowRadius` | 20.0 | 0.75 | 3.1% | 237 | 200 | |

These go in `animTuning.ts` as a `SPRINGS` block, not scattered.

### Squash and stretch, volume preserving

The current `RobotModel.tsx:81` uses `widen = 1 + (1 - s) * 0.6`, which is a linear approximation of `1 / sqrt(s)`.
At `s = 0.78` the two agree to three decimal places, which is why it looks right today.
At `s = 0.55`, which is `REVIVAL.landSquash`, the approximation gives 1.270 against a true 1.348, so the revival landing loses 6% of its volume and reads slightly thin at its deepest frame.

Replace with the exact form, plus an anisotropy knob:

```ts
/**
 * Volume-preserving squash.
 *
 * Uniform scaling in X and Z by 1/sqrt(s) holds volume exactly. `lateral`
 * biases how that widening is split between width and depth: above 1 the
 * character spreads sideways more than forward, which is what a moulded shell
 * dropped on a floor actually does and which also reads better from a camera
 * that is almost always behind.
 */
export function squashScale(s: number, lateral: number, out: JointPose): void {
  const clamped = Math.min(1.45, Math.max(0.40, s))
  const w = 1 / Math.sqrt(clamped)
  out.sx = w * lateral
  out.sy = clamped
  out.sz = w / lateral
}
```

`SQUASH.lateral = 1.10`.
Volume is exactly preserved for any `lateral`, since `sx * sy * sz = (w * l) * s * (w / l) = w^2 * s = 1`.

Clamps at 0.40 and 1.45 exist because a bug elsewhere writing a garbage `squash` should produce a squat robot, not an inverted one.

### The squash envelope, frame by frame at 60 Hz

| Beat | Frame | ms | `squash` | What is happening |
| --- | --- | --- | --- | --- |
| Anticipation, buffered jumps only | 0-2 | 0-50 | 1.00 -> 0.93 | Knees bend, root drops 0.02 m, arms drop 0.04 m. |
| Takeoff | 0-1 | 0-33 | 1.00 -> 1.18 | Ramped over 2 frames, not snapped. `SQUASH.takeoffStretch` unchanged. |
| Rise | 2-30 | 33-500 | 1.18 -> 1.00 | Takeoff spring, omega 11, zeta 0.62. Undershoots to 0.965 at 364 ms then settles. |
| Apex | - | - | ~1.00 | Legs tuck, `tuck = 0.5` as today. |
| Fall | - | - | 1.00 -> 1.06 | Stretch proportional to `min(1, abs(vy) / 18)`, applied directly not through the spring, so it tracks the fall. |
| Contact | 0 | 0 | -> `lerp(1.00, 0.62, strength)` | Instant. `strength = min(1, abs(vy) / 28)`. |
| Compression hold | 0-2 | 0-50 | held | The spring's target is 1.0 but `v` starts at 0, so it holds by itself for ~2 frames. No explicit hold needed. |
| Rebound | 3-15 | 50-250 | rising | Landing spring, omega 16, zeta 0.60. |
| Overshoot peak | ~15 | 245 | 1.095 at full strength | The bounce. |
| Settle | ~19 | 313 | 1.00 | Done. |

`SQUASH.landSquash` moves from 0.78 to 0.62 **as the value at full impact speed**, not as a fixed value.
The existing code at `PlayerController.tsx:282` already scales it by strength, so a gentle landing still barely squashes, and the `minLandSpeed: 4` gate is unchanged.

### Anticipation, honestly

Anticipation is 3-5 frames of counter-motion before a big action, and a game cannot anticipate an action the player has not yet taken without adding input latency, which is never acceptable.

Three cases, and only two of them get real anticipation.

**Buffered jumps get it for free.**
`JUMP.bufferTime` is 0.12 s, so a jump pressed before landing is known up to 7 frames in advance.
When `Jump` fires with `b = 1` (buffered), play the 3-frame crouch listed above before the launch, at the cost of nothing.
This is the common case for a player chaining jumps and it is where anticipation is most visible.

**Scripted beats get it.**
Revival, portal entry and lesson completion are all initiated by the game, so all three can anticipate.
Revival: 4 frames of `squash 0.95` and arms drawn in before the drop begins.

**Unbuffered jumps do not get it, and get a substitute.**
On frame 0 the root is already rising, but the knees compress to `kneeX = -0.32 rad` and the feet trail 0.03 m below their rest.
The body is going up while the legs are still folding, which is what anticipation looks like from the outside, and it costs zero latency.
Ramping the stretch over 2 frames rather than snapping it is the other half.

Be explicit about this in code comments.
A future reader who finds `ANTICIPATION.frames = 3` and cannot see it on an ordinary jump will assume it is broken.

### The waddle, starting from `WADDLE`

Every existing constant survives.
Three are added.

```ts
export const WADDLE = {
  bobAmplitude: 0.055,     // unchanged
  bobFrequency: 9,         // unchanged
  rollAmplitude: 0.14,     // unchanged
  limbSwing: 0.7,          // unchanged
  leanAmount: 0.12,        // unchanged

  /** NEW. Hip yaw sway, out of phase with the roll. What separates a waddle from a metronome. */
  hipYawAmplitude: 0.07,
  /** NEW. Phase lag of the vertical bob behind the roll, in radians. */
  bobPhaseLag: 0.55,
  /** NEW. Lateral hip translation, metres. The weight shifting onto the planted foot. */
  hipShiftAmplitude: 0.022,
} as const
```

The reference brief specifies "torso counter-rotation 4-7 degrees per step" and "Y bob about 4% of body height, phase-offset so the bob peaks mid-step".

- `rollAmplitude` 0.14 rad is 8.0 degrees, slightly above the brief's band, and it is staying.
  It was tuned by eye against the current proportions and reads well.
  With the head now 1.3x larger the roll carries more mass, so if it reads as too much after the proportion change, drop to 0.115 rad (6.6 degrees) rather than re-deriving.
- `bobAmplitude` 0.055 against the new 1.36 m height is 4.0%.
  Exactly the brief's figure, which is a good sign the existing tuning was right.
- `bobPhaseLag` 0.55 rad puts the bob peak at 31 degrees past the roll extreme, which is roughly mid-step.
  The current code has no lag, so the bob peaks exactly when the body is at maximum roll, and the two motions fuse into one.
  This is the cheapest single improvement to the existing waddle.

Gait maths in `gait.ts`, preserving the existing structure:

```
stride = max(speedNorm, abs(turnEased) * TURN_ANIM.stepScale)     // unchanged
phase += dt * WADDLE.bobFrequency * stride                        // unchanged
walking = grounded ? stride : 0                                   // unchanged

hips.py  = sin(2 * phase + WADDLE.bobPhaseLag) * WADDLE.bobAmplitude * walking
hips.rz  = sin(phase) * WADDLE.rollAmplitude * walking + turnEased * TURN_ANIM.bankAmount
hips.px  = sin(phase) * WADDLE.hipShiftAmplitude * walking
hips.ry  = -sin(phase) * WADDLE.hipYawAmplitude * walking          // opposes the roll
hips.rx  = WADDLE.leanAmount * walking * sign(throttle)
```

`hips.ry` opposing `hips.rz` is what makes it a waddle: the hip that rises also rotates back, which is how a toddler's pelvis actually moves and why the gait reads as one continuous motion rather than as a roll plus a bounce.

### Turn-in-place, preserved and extended

`TURN_ANIM` is unchanged.
The behaviour moves from the component to `gait.ts` verbatim, then gets three additions.

Preserved exactly:

```
turnEased += (turnNorm - turnEased) * (1 - exp(-TURN_ANIM.damping * dt))
chest.ry  = turnEased * TURN_ANIM.torsoLag
head.ry   = -turnEased * (TURN_ANIM.torsoLag + TURN_ANIM.headLead)
legL.ry   = turnEased * TURN_ANIM.footPivot * (grounded ? 1 : 0)
legR.ry   = -turnEased * TURN_ANIM.footPivot * (grounded ? 1 : 0)
```

Added:

1. **`chestYaw` and `headYaw` go through springs rather than being written directly.**
   The exponential ease on `turnEased` stays as the input filter; the springs sit downstream and give the lag an overshoot it does not currently have.
   `chestYaw.target = turnEased * TURN_ANIM.torsoLag`, and the spring's `x` is what is written to the pose.
   The visible difference: releasing a turn key now lets the torso swing slightly past centre and come back, which is the difference between a lag and a rig.

2. **Turn snap.**
   When `abs(turnRate)` crosses `MOVEMENT.turnRate * 0.85` within one step having been below `* 0.3`, push `2.5 rad/s` into `chestYaw.v` and `-1.8 rad/s` into `headYaw.v`, and fire a `TurnSnap` event.
   That is an impulse into the spring rather than a change of target, which is exactly what a spring integrator is good at and an easing curve cannot express at all.

3. **Arm trail on direction change.**
   `shoulderL.rz` and `shoulderR.rz` take `-turnEased * 0.14`, so the outside arm lifts away from the body through a turn.
   This is the reference's "feet trail on direction change" applied to the arms, where it is more visible.

### Secondary motion: the chains

**Antenna, 2 segments.**
Each segment is a `Spring2` on `(rx, rz)` with the constants from the spring table.
The drive is inertial, not positional:

```
// Acceleration of the antenna's root in the head's local frame, finite-differenced.
accel = (rootVelThisFrame - rootVelLastFrame) / dt
// A trailing mass leans opposite to acceleration.
antenna[0].targetX = -clamp(accel.z * ANTENNA.inertia, -0.5, 0.5)
antenna[0].targetZ =  clamp(accel.x * ANTENNA.inertia, -0.5, 0.5)
antenna[1].targetX = -antenna[0].x * 0.45        // the tip trails the base
antenna[1].targetZ = -antenna[0].z * 0.45
```

`ANTENNA.inertia = 0.022 s^2/m`.
At a hard landing the root decelerates at roughly 25 m/s^2, giving a 0.55 rad target that clamps to 0.5, so the antenna whips to nearly 30 degrees and oscillates for about 1.4 s.
That is the most visible piece of secondary motion on the character and it costs 4 floats.

Additionally, jump and land events push a direct velocity impulse of `+-3.5 rad/s` into `antenna[0].v`, seeded with the event's `a` magnitude.
An impulse produces a much crisper snap than driving the target.

**Ear pods, 1 axis each.**
`earPod.target = -hips.rz * 0.30`, so they counter-swing against the body roll.
`omega 21, zeta 0.50` makes them settle in under 300 ms, which is fast enough that they read as firm rubber rather than as loose.
Rotation is about X, so they flap forward and back rather than up and down.

**Cape, 4 segments.**
The cape is currently one `PlaneGeometry(0.6, 0.7)` at `RobotModel.tsx:248`.
Replace with four stacked quads of 0.18 m each, parented in a chain off `backSocket`, each a `Spring2` on `(rx, rz)`.

Drive per segment `i`:

```
// Gravity pulls the chain toward hanging, expressed as a positive rx.
gravityTarget = CAPE.hang                                  // 0.10 rad, so it drapes rather than hanging flat
// Drag from the body's own motion, in the chest's local frame.
dragTarget    = -localVel.z * CAPE.drag                    // blows back when moving forward
// Each segment inherits some of its parent's deflection.
inherit       = i === 0 ? 0 : cape[i - 1].x * CAPE.inherit

cape[i].targetX = gravityTarget + dragTarget + inherit
cape[i].targetZ = -localVel.x * CAPE.drag * 0.6
```

`CAPE.hang = 0.10`, `CAPE.drag = 0.055 s/m`, `CAPE.inherit = 0.35`.
At full speed (6 m/s) the drag target is 0.33 rad on the first segment, accumulating to about 0.85 rad at the tip, so the cape streams back at roughly 49 degrees.
On `medium` only 3 segments are simulated and the fourth is left at identity, which shortens the cape rather than stiffening it.
On `low` the cape is a single static quad with the current geometry.

The cape material stays `mattePlastic(palette.token)` with `side: 2`.
The reference's world rule says fabric is replaced with vinyl, so it must not look like cloth; four rigid segments with visible joins is the correct read, not a smooth drape.

**Head lag.**
`headYaw`, `headPitch` and `headRoll` all sit on springs, and the lag is what the spring's rise time provides.
`headYaw` at `omega 18` has a phase lag of roughly 2.4 frames against a step input, which is the reference's "head lags the torso by 2-3 frames" without a delay line.

Nod drive: `headPitch.target = clamp(-verticalAccel * HEAD.nodGain, -0.22, 0.22)` with `HEAD.nodGain = 0.010 s^2/m`.
So the head snaps down on landing and lifts on takeoff, which is most of what sells weight.

### Landing impact, the full pose

On `Land` with strength `s = a`:

| Joint | Effect | At `s = 1` |
| --- | --- | --- |
| `root` | squash target `lerp(1, 0.62, s)`, spring omega 16 zeta 0.60 | 0.62 |
| `kneeL/R.rx` | `-0.55 * s`, decaying with the squash spring | -0.55 rad |
| `legL/R.ry` | `+-0.16 * s`, feet splay out | 9.2 deg |
| `footL/R.rx` | `+0.12 * s`, toes lift as the heel takes the load | 6.9 deg |
| `shoulderL/R.rx` | `-0.9 * s`, arms fly up | -51.6 deg |
| `shoulderL/R.rz` | `+-0.35 * s`, arms fly out | 20 deg |
| `headPitch` | impulse `-6.0 * s rad/s` into `v` | |
| `antenna[0]` | impulse `+4.5 * s rad/s` into `v` | |
| `earPod` | impulse `+-5.0 * s rad/s` into `v` | |
| `cape[0..3]` | impulse `-3.0 * s rad/s` into `v` on each, staggered by 1 frame per segment | |
| `shadowRadius` | target spikes to `baseRadius * (1 + 0.9 * s)` for 1 frame, then back | |

The limb offsets all decay on the same landing spring as the squash, by multiplying them by `(1 - squashSpring.x) / (1 - landTarget)` clamped to `[0, 1]`.
One spring driving the whole pose is what makes the landing read as a single event rather than as eleven things happening near each other.

The `shadowRadius` spike is what gives the `low` tier its impact feedback with zero particles.
See sections 8 and 13.

### Idle breathing

Active when `speedNorm < 0.02 && grounded && groundTime > 0.35`.

```
breathPhase += dt * (2 * PI / IDLE.breathPeriod) * breathBlend
```

`IDLE.breathPeriod = 2.2` s, which is 0.455 Hz.
`breathBlend` ramps 0 to 1 over 0.5 s once idle and back to 0 over 0.2 s on movement, so breathing never fights the waddle.

```
root.sy *= 1 + sin(breathPhase) * 0.035
root.sx *= 1 - sin(breathPhase) * 0.0176
root.sz *= 1 - sin(breathPhase) * 0.0176
head.py += sin(breathPhase - 0.9) * 0.008
shoulderL.rz += sin(breathPhase - 0.9) * 0.030
shoulderR.rz -= sin(breathPhase - 0.9) * 0.030
```

3.5% on Y is the reference's "3-5% breathing scale".
The X and Z counter-scales are `1 - 0.5 * 0.035` to first order, which holds volume to within 0.1% over the cycle.

The 0.9 rad lag on the head and shoulders is what stops the whole body pulsing as one unit, which reads as a lighting flicker rather than as breath.

### Idle fidgets

Fire when `idleTime > fidget.nextAt`.
Schedule the next at `idleTime + uniform(4.0, 8.0)` s, per the reference brief.
The first fidget after going idle is scheduled at `uniform(2.0, 4.0)` so a player who stops moving does not wait a full interval to see the character is alive.

Six fidgets, chosen by weight with `mulberry32(rt.rng)`, never repeating `lastKind`.

| # | Kind | Weight | Duration | Pose |
| --- | --- | --- | --- | --- |
| 1 | `lookAround` | 3.0 | 1.10 s | `headYaw.target` to `+-0.45 rad` over 0.30 s, hold 0.35 s, return over 0.45 s. Gaze follows to `+-0.9`. Direction alternates. |
| 2 | `antennaFlick` | 2.0 | 0.50 s | Impulse `6.0 rad/s` into `antenna[0].v` on X. Nothing else moves. |
| 3 | `toeTap` | 2.0 | 0.90 s | Right foot taps 3 times at 3.3 Hz. `legR.rx` to `-0.20`, `footR.py` to `+0.035`, `kneeR.rx` to `-0.28`. Hips shift 0.012 m onto the left foot. |
| 4 | `doubleBlink` | 2.5 | 0.42 s | Two blinks 0.18 s apart. Face only. |
| 5 | `shrug` | 1.5 | 0.80 s | Both `shoulder.py` to `+0.030`, `neck.py` to `-0.015`, `root` squash to 0.97, over 0.25 s, hold 0.15 s, release over 0.40 s. |
| 6 | `stretchUp` | 0.5 | 1.40 s | `root.sy` to 1.06 with volume preservation, both `shoulder.rx` to `-1.6 rad`, `headPitch` to `-0.20`. The rare one. Face plays `squint`. |

Weights sum to 11.5, so `stretchUp` appears roughly once in 23 fidgets, or about once every four minutes of standing still.
That is deliberately rare: the reference brief says the mischief lives in the fidgets, and a mischievous gesture stops being mischievous when it is on a timer.

Every fidget applies its pose through an eased envelope, `e(t) = smoothstep(0, in, t) * (1 - smoothstep(dur - out, dur, t))`, so a fidget interrupted by the player moving blends out over its own `out` rather than snapping.
Set `fidget.kind = 0` and let the envelope finish; do not zero the pose on interrupt.

### Foot IK

Two extra raycasts per frame, gated to `medium` and above.

Sample points: each foot's rest world position, raised 0.30 m, cast straight down, `maxToi = 0.55` m.
Use `world.castRayAndGetNormal` with `filterExcludeCollider` set to the player's own collider.
Casting from the rest position rather than the animated position is important: the animated position moves with the IK result, and feeding that back produces a foot that walks itself into the floor over a few frames.

```
for each foot f:
  if (!ground.footHit[f] || !grounded) { blend[f].target = 0 }
  else {
    desiredY  = ground.footY[f] - REST_WORLD_Y_OF_SOLE          // 0.0, so just ground.footY[f]
    liftLimit = FOOT_IK.maxLift                                  // 0.14 m
    dropLimit = FOOT_IK.maxDrop                                  // 0.10 m
    offset    = clamp(desiredY - swingY[f], -dropLimit, liftLimit)
    blend[f].target = 1
  }
  spring blend[f] with omega 22 zeta 1.0
  knee[f].py = offset * blend[f].x
  knee[f].rx += -abs(offset) * FOOT_IK.kneeGain                  // 2.2 rad/m, the knee bends as the leg shortens
```

`swingY[f]` is the foot's height from the walk cycle before IK, so the IK adds to the animation rather than replacing it.

Ground normal alignment: build the foot's tilt from the sampled normal, clamped so the foot never tilts more than `FOOT_IK.maxTilt = 0.31 rad` (17.8 degrees) from level.
`BODY.maxSlopeClimbAngle` is 50 degrees, so on the steepest walkable slope the foot is deliberately not flush.
A foot pinned to a 50 degree face reads as a magnet; a partial tilt reads as a toy standing on a hill.

```
tiltX = clamp(atan2(-nz, ny), -maxTilt, maxTilt) * blend[f].x
tiltZ = clamp(atan2( nx, ny), -maxTilt, maxTilt) * blend[f].x
```

Both are in the foot's parent frame, which is the leg, which is already yawed by the splay, so the tilt is applied after the splay and reads correctly through a pivot.

**Pelvis drop.**
If the lower foot needs a `dropLimit`-sized offset, the hips come down to meet it, otherwise the leg visibly stretches.

```
worstDrop = min(0, offsetL, offsetR)
hips.py += worstDrop * FOOT_IK.pelvisFollow                      // 0.6
```

Applied after the waddle bob, and it is the reason `hips.py` is accumulated rather than assigned.

**Tier gating.**
`low` runs no foot rays at all and the feet stay on the walk cycle.
On flat ground the difference is invisible; on the hub island's slopes it is a 0.04 m float that nobody will notice at `low`'s other settings.

The one ray that runs on every tier is the body-centre ray in section 8, because the contact shadow depends on it and the contact shadow is not optional.

### Frame budget

Per frame, per character:

| Work | Cost |
| --- | --- |
| `resetPose` | ~250 stores |
| Gait, turn, idle, impact | ~120 flops |
| 16 spring integrations | ~200 flops |
| Foot IK | ~60 flops plus 2 raycasts |
| `applyPose`, 24 joints | 24 `position.set` + 24 `rotation.set` + 24 `scale.set` |
| Matrix updates, three's own | 26 `updateMatrix` |

The matrix updates dominate and they already happen today.
This is not a measurable change from the current implementation and it is far below anything worth optimising.

---
