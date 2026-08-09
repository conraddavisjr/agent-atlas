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

## 7. The visor

### The identity problem, and the shape language that solves it

The reference brief describes two rounded-rect LED panels, one eye-width apart, at 55-60% down the face plate.
That is exactly the mark this project has committed in writing to avoiding, at `palette.ts:9` and `RobotModel.tsx:14-18`.

The resolution is not to make the eyes worse.
It is to carry the same expressive range on a different form.

**The visor is one continuous horizontal cyan slot, always present, spanning 77% of the face plate width.**
Expression lives in the intensity profile along that slot, not in two separate glyphs.
Two hotter cores sit inside the bar at `+-0.20` of plate width, and those cores change shape, but the bar between and around them never goes dark.
Close the character's eyes and you still see a cyan line, which is the identity.
Astro's eyes disappear on a blink; this character's do not, and that difference is the whole point.

This gives more range than two panels, not less, because the bar itself is a channel: its thickness, its arc and the brightness gradient along it are all expressive, and none of that is available to a design made of two isolated shapes.

### Why a raw `ShaderMaterial` and not `onBeforeCompile`

The project has three documented cases of `onBeforeCompile` failing silently, most recently `vColor *= iColor` in `Grass.tsx` taking down the whole grass field while reporting full instance counts and `visible: true`.

Every shader in this document is a standalone `ShaderMaterial` with hand-written vertex and fragment stages.
None of them patches a three built-in.
`PortalShimmer.tsx` is the precedent and it has never broken.

The cost is that these materials do not receive three's lights, fog or shadows.
For the visor glyph, particles and the contact shadow that is not a cost at all: none of them wants to be lit.
The face plate underneath, which does want to be lit and does want the environment reflection, stays a `meshPhysicalMaterial` with no patching.

### The two-layer construction

**Layer A, the plate.** The extruded squircle from section 2, `visorPlate()` material, near-black `#0d1218` at roughness 0.09 and clearcoat 1.
This is the surface that takes the clean environment highlight from the Lightformers and it is what makes the face read as glass over a display rather than as a painted decal.
It is fully opaque and never blooms: at albedo 0.0056 linear, no lighting in the project can push it past 0.02.

**Layer B, the glyph.** A `PlaneGeometry(0.56, 0.38)` at `z = 0.325`, which is 0.020 m in front of the plate's front face.
`ShaderMaterial`, `transparent: true`, `depthWrite: false`, `depthTest: true`, `blending: NormalBlending`, `side: FrontSide`, `toneMapped: false`.

**`NormalBlending`, not additive, and this is load-bearing.**
Additive on a single quad would be fine on its own, but the character's face is the one emissive surface that the player looks at for hours, and the moment anyone adds a second overlay (a damage flash, a status icon) additive starts stacking.
Normal blending with `src.rgb` at HDR values and `src.a` as the coverage mask gives `out = rgb * a + dst * (1 - a)`, which is bounded by `rgb` no matter how many layers are composited.
The bar cannot blow out by accident.

The 0.020 m separation is enough that the depth test never fights at any camera angle inside `CAMERA.minDistance = 1.6` m, and small enough that the parallax between plate and glyph is under a pixel.
Do not use `polygonOffset` here; a real offset in Z is more predictable and costs nothing.

### Bloom arithmetic

Bloom threshold is 1.75 on raw HDR luminance, pre-tone-map.
Luminance is `0.2126 R + 0.7152 G + 0.0722 B` on linear values.

`palette.visor` `#4de2ff` in linear is `(0.0743, 0.7605, 1.0000)`, luminance `0.6299`.

| Multiplier | Linear RGB | Luminance | Blooms? |
| --- | --- | --- | --- |
| 2.4 (current) | (0.178, 1.825, 2.400) | 1.516 | No. This is finding 3 in section 0. |
| 2.8 | (0.208, 2.129, 2.800) | 1.764 | Marginal, right on the line |
| **3.4 (core)** | (0.253, 2.586, 3.400) | **2.142** | **Yes, cleanly** |
| 1.6 (bar body) | (0.119, 1.217, 1.600) | 1.008 | No, by design |
| 4.2 (excited peak) | (0.312, 3.194, 4.200) | 2.646 | Yes, strongly |

So: the bar body sits at 1.6, deliberately under the threshold, and only the two eye cores at 3.4 cross it.
That produces a cyan line with two glowing nodes rather than a uniformly hazing bar, which is a much better read and is exactly what the high threshold exists to enable.

`palette.accent` `#ff9a3c` in linear is `(1.0000, 0.3232, 0.0452)`, luminance `0.4477`.
The antenna bulb at the current intensity 2.0 has luminance 0.895 and does not bloom.
Set it to **4.0**, giving luminance 1.791, which just clears.
Section 1's part table already lists 4.0.

The `backVent` at `emissive(palette.visor, 2.6)` gives luminance 1.638, deliberately just under.
The vent should glow softly without haloing, since it is behind the character and a bloom there would rim-light the back of the head.

**Verify before building**: `@react-three/postprocessing`'s `EffectComposer` must be using a half-float frame buffer for any of this to work, because an 8-bit buffer clamps at 1.0 and nothing could ever cross 1.75.
Emissives visibly bloom in the game today, so it almost certainly is, but confirm `frameBufferType` rather than assuming.
If it is not half-float, every number in this table is wrong and the whole bloom strategy needs rethinking.

### The SDF

Fragment stage, in plate space.
`p = (vUv - 0.5) * vec2(uAspect, 1.0)` with `uAspect = 0.56 / 0.38 = 1.4737`, so `p.x` runs `-0.737..0.737` and `p.y` runs `-0.5..0.5`.

The visor's vertical centre is at 57% down the plate, which is `p.y = 0.5 - 0.57 = -0.07`.

```glsl
// Signed distance to a rounded box. The standard iq form.
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

// One eye core, with arch and gaze applied.
// `arch` bends the core into a smile or a frown by displacing y as a function
// of the horizontal distance from the core's own centre. The (1 - t*t) profile
// is a parabola, which is what an arc of an eye actually looks like; a linear
// shear reads as a tilt instead.
float eyeCore(vec2 p, float cx, float open, float arch, float width, vec2 gaze) {
  vec2 q = p - vec2(cx + gaze.x * 0.055, VISOR_Y + gaze.y * 0.018);
  float halfW = 0.075 * width;
  float halfH = 0.055 * open;
  float t = clamp(q.x / halfW, -1.0, 1.0);
  q.y -= arch * (1.0 - t * t) * 0.048;
  float r = min(halfH, halfW) * 0.92;
  return sdRoundBox(q, vec2(halfW, halfH), r);
}
```

The body of the bar is a stadium spanning the full width:

```glsl
float bar = sdRoundBox(p - vec2(0.0, VISOR_Y), vec2(0.215, 0.0), 0.030);
```

Half-extent `(0.215, 0.0)` with corner radius 0.030 gives a stadium 0.490 wide and 0.060 tall in plate space, which at 0.56 m plate width is 0.274 m wide and 0.034 m tall in world units.
That is 77% of the plate width, matching the current bar's 0.42 against 0.56.

Composition:

```glsl
float barMask  = 1.0 - smoothstep(-0.004, 0.004, bar);
float coreL    = eyeCore(p, -0.20, uOpenL, uArchL, uWidthL, gaze);
float coreR    = eyeCore(p,  0.20, uOpenR, uArchR, uWidthR, gaze);
float coreMask = (1.0 - smoothstep(-0.004, 0.004, coreL))
               + (1.0 - smoothstep(-0.004, 0.004, coreR));
coreMask = clamp(coreMask, 0.0, 1.0);

// The cores are clipped to the bar, so a wide `surprised` core can never spill
// outside the slot. A glyph escaping its housing destroys the read of a
// recessed display instantly.
coreMask *= barMask;

float energy = barMask * 1.6 + coreMask * (uBright - 1.6);
vec3 col = mix(uCoolColor, uColor, clamp(barMask * 0.35 + coreMask, 0.0, 1.0)) * energy;
float alpha = clamp(barMask * 0.94 + coreMask * 0.06, 0.0, 1.0);
gl_FragColor = vec4(col * scanline * sweep, alpha);
```

`smoothstep(-0.004, 0.004, d)` is a fixed-width antialias in plate space, which at 0.56 m across and a typical on-screen face height of 90 px works out to roughly 1.3 px.
Using `fwidth(d)` would be more correct at extreme distances and it is not worth the derivative instructions here; the character is never far from the camera.

### Uniforms

| Uniform | Type | Range | Written by | Meaning |
| --- | --- | --- | --- | --- |
| `uTime` | float | - | `RobotModel` from `gameClock.elapsed` | Scaled clock, so hit-stop freezes the scanlines too. |
| `uOpenL`, `uOpenR` | float | 0.06 - 1.6 | `faceSolver` | Vertical extent of each core. Never 0. |
| `uArchL`, `uArchR` | float | -1 - +1 | `faceSolver` | Negative frowns, positive smiles. |
| `uWidthL`, `uWidthR` | float | 0.5 - 1.4 | `faceSolver` | Horizontal extent of each core. |
| `uGaze` | vec2 | -1 - +1 | `faceSolver` | Core offset within the bar. |
| `uBright` | float | 1.6 - 4.2 | `faceSolver` | HDR multiplier on the cores. Section's bloom table. |
| `uColor` | vec3 | - | constant | `palette.visor` as linear. |
| `uCoolColor` | vec3 | - | constant | `palette.visorDim` as linear, the bar body away from the cores. |
| `uScan` | float | 0 - 1 | `faceSolver` | Scanline strength. 0.55 default, 0.9 when focused. |
| `uPixel` | float | - | constant, 48.0 | LED cells across the bar. |
| `uGlitch` | float | 0 - 1 | `faceSolver` | Horizontal tear amount. |
| `uAspect` | float | - | constant, 1.4737 | Plate aspect. |

All twelve are set in one `writeVisorUniforms(face, uniforms)` call, which is the only place `RobotModel` touches the material.

### The LED scanline treatment

Three components, multiplied, capped so they can never raise brightness above the budgeted value.

```glsl
// 1. Horizontal scanlines. The bar is 0.060 tall in plate space and uPixel is
//    48, so this puts roughly 3 lines across the bar's height. More than that
//    and it turns into a moire pattern at playing distance.
float rows = 0.86 + 0.14 * step(0.5, fract(p.y * uPixel * 1.5 + uTime * 0.35));

// 2. Vertical cell grid, at the same pitch, so it reads as a matrix rather
//    than as CRT lines. Much weaker than the rows.
float cols = 0.94 + 0.06 * step(0.28, fract(p.x * uPixel * 0.5));

// 3. A slow bright sweep travelling left to right, which is the "this thing is
//    powered and thinking" cue. Period 8.3 s, so it is barely noticed and
//    definitely felt.
float sx    = fract(uTime * 0.12) * 2.2 - 1.1;
float sweep = 1.0 + smoothstep(0.09, 0.0, abs(p.x - sx)) * 0.18 * uScan;

float scanline = mix(1.0, rows * cols, uScan) * sweep;
```

Worst case `scanline` is `1.0 * 1.0 * 1.18 = 1.18`, so the core peak at `uBright = 3.4` can reach `4.012`, luminance 2.527.
That is intentional and stays well inside the deliberate-bloom budget in section 10.

Glitch, used on damage and portal entry:

```glsl
// A few horizontal bands displaced sideways. Cheap, and reads as a display
// losing sync rather than as the character being sad, which matters: this is a
// hardware cue, not an emotional one.
float band = floor((p.y - VISOR_Y) * 42.0);
float jitter = (fract(sin(band * 91.7 + floor(uTime * 30.0) * 3.3) * 4371.0) - 0.5);
p.x += jitter * uGlitch * 0.09;
```

Applied to `p` before the SDF evaluation, and only when `uGlitch > 0`, which the shader cannot branch on cheaply so it just always runs; the multiply by zero is free.

### The shape library

Six named expressions, each a tuple of continuous parameters.
`faceSolver` blends between the current expression and the target over 0.14 s with a smoothstep, so nothing pops.

| Expression | openL/R | archL/R | widthL/R | uBright | uScan | Trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `neutral` | 1.00 | 0.00 | 1.00 | 3.4 | 0.55 | Default. |
| `happy` | 0.72 | +1.00 | 1.15 | 3.8 | 0.45 | Lesson complete, cosmetic earned, landing after a long fall survived. Holds 1.6 s. |
| `surprised` | 1.50 | 0.00 | 0.60 | 4.0 | 0.35 | Revival, first frame of a fall exceeding 1.2 s of air time, `Bonk`. Holds 0.5 s. |
| `squint` | 0.35 | +0.35 | 1.25 | 3.0 | 0.70 | `stretchUp` fidget, bright light, mid-sprint. Holds while the condition lasts. |
| `blink` | 0.06 | inherited | inherited | 3.4 | inherited | The cadence below. Overrides only `open`. |
| `focused` | 0.80 | -0.25 | 0.80 | 3.6 | 0.90 | `interactFocus === 1`. Holds while focused. The high `uScan` is the tell: the display is working harder. |

`blink` deliberately inherits arch and width from whatever expression is underneath, so a happy blink keeps its arc.
Overriding all three would make every blink identical and the face would lose its mood for 110 ms at a time.

Asymmetry is available and should be used sparingly.
The `lookAround` fidget sets `uOpenL` and `uOpenR` 0.12 apart in the direction of the look, which is a tiny cue that costs nothing and reads as attention.

### Blink cadence

Per the reference: random 2-5 s interval, 90-120 ms duration, fast close and slower open.

```
nextBlinkAt = t + uniform(2.0, 5.0)

Blink envelope, total 110 ms:
   0 -  35 ms   open 1.00 -> 0.06,  ease-in    (fast close)
  35 -  50 ms   held at 0.06                    (the hold is what makes it read as a blink)
  50 - 110 ms   open 0.06 -> 1.00,  ease-out   (slower open)
```

Close uses `t^2`, open uses `1 - (1-t)^2`.
Linear in both directions reads as a shutter.

15% of blinks are doubles: a second blink 180 ms after the first ends, scheduled by setting `doubleRemaining = 1`.

Suppression rules, all of them necessary:

- No blink while `!grounded && verticalVelocity > 0`, because blinking mid-launch reads as the character being bored by its own jump.
- No blink during `surprised`, for 0.5 s after it starts.
- No blink within 0.25 s of a `Land` with `a > 0.5`, because a landing already has a face beat.
- Blinks are never suppressed during `focused`, because a totally unblinking stare while reading a prompt is unsettling.

The 2-5 s interval is measured on the scaled clock, so hit-stop does not advance it.

### What the eyes track

`faceSolver` picks a gaze target from a priority list, converts it to the head's local frame, and projects it onto the face plate.

1. **A focused interactable.**
   When `interactFocus === 1`, look at `(focusX, focusY, focusZ)`.
   This is the totem or portal the player is standing at, published by the existing `useProximity` callbacks in `LessonTotem.tsx` and `Portal.tsx`.
2. **The direction of travel**, when `speedNorm > 0.25`.
   Look 2.0 m ahead along `facing`, which combined with the existing `headLead` means the head turns into a corner and the eyes lead the head.
3. **A camera glance**, when idle for more than 2.5 s.
   Once every `uniform(6, 14)` s of idle, look directly at the camera for 0.6 s.
   This is the single most valuable 20 lines in the face system.
   A character that occasionally notices you is the difference between a puppet and a personality, and the reference brief's "cuteness with mischievous undertones" is exactly this.
4. **Neutral.**
   `gaze` decays to `(0, 0)`.

Conversion:

```
// Direction to the target in head-local space.
local = headWorldInverse * targetWorld
gazeXRaw = clamp(atan2(local.x, local.z) / 0.9, -1, 1)
gazeYRaw = clamp(atan2(local.y, local.z) / 0.6, -1, 1)
```

Then smoothed with exponential damping at `lambda = 10`, which is a 100 ms time constant.
Instant gaze reads as a machine; anything slower than about 200 ms reads as sedated.

The gaze offset applied in the shader is `+-0.055` in plate space on X and `+-0.018` on Y, which is 0.031 m and 0.007 m in world units.
Deliberately small.
The cores must stay inside the bar at full gaze, and `0.20 + 0.055 + 0.075 * 1.4 = 0.360` against the bar's half-extent plus radius of `0.215 + 0.030 = 0.245`.
That overflows, which is exactly why `coreMask *= barMask` clips it: a core at full gaze and full width flattens against the end of the slot rather than escaping it, which reads correctly as an eye pressed against the corner of its socket.

### Tier gating

| Tier | `visorSdf` | What runs |
| --- | --- | --- |
| `low` | `'simple'` | Bar and cores, no scanlines, no sweep, no glitch. `uScan` forced to 0. Roughly 18 fewer ALU ops per fragment on a quad that covers about 900 px. Genuinely negligible either way; this exists so `low` has no shader branches at all. |
| `medium` | `'full'` | Everything. |
| `high` | `'full'` | Everything. |

Implement as two compiled variants selected by a `#define`, not by a uniform branch, so `low` does not pay for code it never runs.
Since it is a `ShaderMaterial` this is a string concatenation at material construction and there is no program-cache hazard.

---

## 8. The contact shadow

### Why this is item one

There is no contact shadow today, and the single directional light in `Lighting.tsx` covers a 36 m square with a 2048 map on `medium`, which is 57 texels per metre.
The character's foot span is 0.70 m, so its entire shadow is about 40 texels wide and its contact edge is a single texel.
That is why it reads as hovering, and no shadow map resolution the tier system can afford will fix it.

The reference brief lists a contact shadow with a coloured, not black, shadow colour as Tier 1, item 5.
This is a 2-triangle mesh and one raycast, and it is the highest value-per-cost item in this entire document.

### The raycast

One ray per frame, on every tier including `low`.

```ts
// In PlayerController's useFrame, after the physics transform is read.
const t = bodyRef.current.translation()

// Origin: 0.10 m above the sole plane. The sole is capsuleHalfHeight +
// capsuleRadius below the body centre, which is 0.70 m.
ray.origin.x = t.x
ray.origin.y = t.y - 0.60
ray.origin.z = t.z
ray.dir.x = 0; ray.dir.y = -1; ray.dir.z = 0

const hit = world.castRayAndGetNormal(
  ray,
  SHADOW.maxCastDistance,   // 4.0 m
  true,                     // solid
  undefined,                // QueryFilterFlags
  undefined,                // filterGroups
  playerColliderRef.current, // filterExcludeCollider -- REQUIRED
)
```

`filterExcludeCollider` is mandatory.
Without it the ray starts 0.60 m below the capsule's centre, which is inside the capsule, and with `solid = true` it reports an immediate hit on the player itself at distance 0.
The shadow then pins to the character's own feet and never moves, which looks almost right and is completely wrong.

`castRayAndGetNormal` rather than `castRay`, because the normal is needed for orientation and a second ray to get it would be wasteful.

Store the result into a `GroundSample` ref, which is the same object handed to `stepAnim` in section 4.
**One ray, three consumers**: the contact shadow's position, the foot IK's reference plane, and the VFX emitter's ground point and normal for dust and impact rings.
That is the reason `GroundSample` exists as a named type rather than the shadow just doing its own cast.

Distance from sole to ground is `hit.timeOfImpact - 0.10`, clamped at 0.

### Geometry

```ts
// Module-level, created once, shared. A plane, not a circle: the falloff lives
// in the shader, so 2 triangles do the job a 24-segment disc would do with 24.
const SHADOW_GEOMETRY = new PlaneGeometry(1, 1)
SHADOW_GEOMETRY.rotateX(-Math.PI / 2)
```

Rotating the geometry rather than the mesh means the mesh's own rotation is free for the ground-normal alignment, which is one fewer quaternion composition per frame.

The mesh is a direct child of the scene, never of the character.
Section 3 explains why: parented under `root` it would inherit the squash scale, and a shadow that squashes with the body is the classic tell of a fake contact shadow.

### Material

```ts
const SHADOW_MATERIAL = new ShaderMaterial({
  uniforms: {
    uColor:   { value: new Color('#3d4a6b') },   // per-scene, see below
    uOpacity: { value: 0.0 },
    uCore:    { value: 0.35 },
    uStretch: { value: 1.0 },
  },
  vertexShader: /* trivial, passes uv */,
  fragmentShader: SHADOW_FRAG,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: MultiplyBlending,
  side: FrontSide,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
})
```

**`MultiplyBlending` with a white no-op, which is the trick that makes this work.**

```glsl
uniform vec3  uColor;
uniform float uOpacity;
uniform float uCore;
uniform float uStretch;
varying vec2  vUv;

void main() {
  vec2 q = (vUv - 0.5) * vec2(1.0 / uStretch, 1.0);
  float d = clamp(length(q) * 2.0, 0.0, 1.0);

  // A soft falloff for the body of the shadow, plus a tighter darker core.
  // The core is what actually glues the toy to the floor; the soft part alone
  // reads as a smudge under the character rather than as contact.
  float soft = pow(1.0 - d, 1.6);
  float core = smoothstep(0.55, 0.0, d) * uCore;
  float a = clamp((soft + core) * uOpacity, 0.0, 1.0);

  // Multiply blending needs white where there is no shadow, because white is
  // the identity for multiplication. Mixing toward the shadow colour by `a`
  // gives a correct darkening with a working fade and no premultiplied-alpha
  // bookkeeping. Writing alpha here would be wrong; multiply ignores it.
  gl_FragColor = vec4(mix(vec3(1.0), uColor, a), 1.0);
}
```

Multiply is the correct operator for a shadow: it darkens what is under it proportionally, so the grass texture and the stone grain survive underneath.
Normal-blending a coloured quad would flatten them into a solid patch, which is the single most common way a blob shadow looks wrong.

`toneMapped: false` matters.
The multiply happens in the HDR buffer before tone mapping, and letting three tone-map the shadow quad's own output would apply the ACES curve to a value that is a multiplier, not a colour.

`renderOrder = 1`.
The shadow must draw after the opaque ground and before the particles, which sit at `renderOrder = 2`.
Without an explicit order, three sorts transparents back to front by distance and the shadow can end up after a dust puff that should be lying on top of it.

Lift the quad 0.012 m along the ground normal on top of the polygon offset.
Belt and braces: polygon offset handles coplanar z-fighting against the ground mesh, and the physical lift handles the case where the visual ground and the collision ground are not exactly the same surface, which is true on the hub island where the terrain mesh is displaced and the collider is not.

### Shadow colour

Per the reference: coloured, never black, typically the ambient hue at 35-55%.

| Scene | `uColor` | Derivation |
| --- | --- | --- |
| `hub` | `#3d4a6b` | `palette.skyTop` `#5aa8e8` driven to 42% value. The shadow takes the sky's hue because the sky is the fill. |
| `cave` | `#2e2a4d` | `palette.caveCrystal` `#8b7bff` at 35% value. |

Passed as a prop from the scene, defaulting to the hub value.
Add it to `Lighting.tsx`'s variant switch so the shadow colour and the hemisphere light can never disagree, which they will if they live in two places.

### Sizing and fading

```ts
export const SHADOW = {
  /** Radius directly under a standing character, in metres. */
  baseRadius: 0.42,
  /** Above this height the shadow is gone entirely. */
  maxHeight: 3.0,
  /** How far the ray looks before giving up. */
  maxCastDistance: 4.0,
  /** Opacity at zero height. */
  maxOpacity: 0.55,
  /** How much the radius grows at maxHeight, as a fraction. */
  spread: 0.55,
  /** Falloff exponent on opacity. Above 1 makes the shadow vanish faster than it grows. */
  fadePower: 1.5,
  /** Elongation at full speed. */
  maxStretch: 1.30,
  /** Ground-normal tilt clamp, radians. */
  maxTilt: 0.61,
} as const
```

```
h        = clamp(ground.distance / SHADOW.maxHeight, 0, 1)
radius   = SHADOW.baseRadius * (1 + SHADOW.spread * h)
opacity  = SHADOW.maxOpacity * pow(1 - h, SHADOW.fadePower)
stretch  = 1 + (SHADOW.maxStretch - 1) * speedNorm
yaw      = facing
```

At `h = 0`: radius 0.42, opacity 0.55.
At `h = 1` (3 m up): radius 0.65, opacity 0.
At `h = 0.33` (1 m up): radius 0.50, opacity 0.30.

The shadow grows and fades together, which is the physical behaviour of a penumbra from a finite-size source, and it is what makes jump height readable.
A player judging a landing reads the shadow, not the character.

`radius` goes through `springs.shadowRadius` (`omega 20, zeta 0.75`) so the landing spike in section 6 has something to overshoot.
`opacity` is written directly with no smoothing; smoothing it makes the shadow lag the character when it steps off a ledge, which is very visible.

If `ground.hit` is false, set `opacity = 0` and leave the mesh in place.
Do not toggle `visible`, which causes a material state change; a zero-opacity multiply quad writes `vec3(1.0)` and is a genuine no-op.

### Orientation

```ts
// Align +Y to the ground normal, then clamp the tilt.
const n = clampTilt(ground.nx, ground.ny, ground.nz, SHADOW.maxTilt)
shadowQuat.setFromUnitVectors(UP, n)
// Then apply the travel-direction yaw for the stretch, in the tilted frame.
shadowMesh.quaternion.copy(shadowQuat).multiply(yawQuat.setFromAxisAngle(UP, yaw))
```

`clampTilt` is a pure function in `shadow.ts` and is testable: given a normal 60 degrees off vertical and a clamp of 35 degrees, it must return a normal exactly 35 degrees off vertical in the same azimuth.

Both `UP`, `shadowQuat` and `yawQuat` are module-level scratch objects, allocated once.

### Per-foot shadows, `high` only

On `high`, add two smaller quads at the IK foot positions, `baseRadius 0.17`, `maxOpacity 0.42`, and drop the body shadow's `maxOpacity` to 0.34 so the three do not stack into a black patch.
Multiply blending composites correctly here: `0.34 * 0.42 = 0.143` at the overlap, which is a natural deepening under the foot.

Two more draw calls and two more raycasts, both of which `high` already pays for via foot IK.
On `medium` and `low` the single body shadow does all the work.

### `low` tier feedback

`low` runs zero particles (section 13), so the contact shadow carries the landing feedback on its own.

On `Land`, the shadow's radius target spikes to `baseRadius * (1 + 0.9 * a)` and its opacity to `maxOpacity * (1 + 0.5 * a)` for one frame, then returns on the `shadowRadius` spring.
A dark ring snapping outward and settling in 200 ms is a genuinely good impact cue, and it costs one uniform write.

This runs on every tier, not just `low`.
On `medium` and `high` it sits underneath the dust and the impact ring and makes them land better.

---

## 9. VFX architecture

There are zero particles in this project today.
This section specifies the whole system; section 10 specifies what it emits.

### The core idea

**The CPU writes a particle's initial state exactly once, on emit.
The vertex shader evaluates the full ballistic arc from a single `uTime` uniform.
There is no per-frame buffer upload.**

The alternative, which is what most three.js particle systems do, is to integrate positions on the CPU and re-upload a position buffer every frame.
At 2048 particles that is a 24 KB upload per frame plus 2048 iterations of JavaScript, every frame, whether anything is happening or not.
The analytic approach costs one uniform write per frame and nothing else, and on an idle frame with no emissions the system does literally zero CPU work beyond `uTime`.

That property is what makes it affordable on `medium`, and it is the reason the design is worth the extra care in the shader.

### Module layout

```
src/art/vfx/
  particlePool.ts     Pool, createPool(), allocate(), the ring allocator      pure, tested
  vfxTuning.ts        The effect catalogue as data                            data, tested
  emitters.ts         emit(pool, effectId, params) -> writes particles        pure, tested
  vfxBus.ts           Module singleton handle, like cameraFrame               pure
  bloomBudget.ts      assertBloomBudget(), used by a test                     pure, tested
  ParticleField.tsx   The InstancedMesh, the materials, the uTime write       not tested
  VfxSystem.tsx       Drains the event ring, calls emit                       not tested
  billboardShader.ts  The billboard vertex and fragment source                data
  chunkShader.ts      The mesh-family vertex and fragment source              data
```

`emitters.ts` being pure and testable is the point of the split.
"Does `landingChunks` at strength 0.3 emit 6 particles with velocities inside the specified cone" is a question with an exact answer.

### Instanced attributes

Per particle, per family.
Both families share the same attribute layout so the pool code does not branch.

| Attribute | Type | Bytes | Meaning |
| --- | --- | --- | --- |
| `aSeedTime` | float | 4 | Emission time on `gameClock.elapsed`. Set from the event's timestamp, not from the current frame. |
| `aLifetime` | float | 4 | Seconds. |
| `aOrigin` | vec3 | 12 | World-space emission point. |
| `aVelocity` | vec3 | 12 | Initial velocity, m/s. |
| `aAccel` | vec3 | 12 | Constant acceleration, m/s^2. Usually `(0, -g, 0)` but wind and rising motes use the other components. |
| `aDrag` | float | 4 | Exponential drag coefficient, 1/s. |
| `aSize` | vec2 | 8 | Size in metres at `life = 0` and at `life = 1`. |
| `aColor` | vec3 | 12 | Linear HDR base colour, pre-multiplied by the effect's peak. |
| `aSpin` | vec2 | 8 | Spin rate rad/s, initial phase rad. |
| `aShape` | vec4 | 16 | `x` fade power, `y` orbit radius, `z` orbit rate, `w` packed flag bits as a float. |
| `aGround` | vec2 | 8 | `x` ground Y for the bounce, `y` restitution. |
| **Total** | | **100 B** | |

At the `high` budget of 2048 particles that is 205 KB of GPU buffer, allocated once at mount and never resized.

Flag bits in `aShape.w`, read with `mod(floor(w / 2^k), 2.0)`:

| Bit | Flag | Effect |
| --- | --- | --- |
| 0 | `GROUND_ALIGNED` | The quad lies in the ground plane instead of facing the camera. Rings and decals. |
| 1 | `VELOCITY_STRETCHED` | The quad stretches along its screen-space velocity. Speed lines and sparks. |
| 2 | `BOUNCE` | One analytic ground bounce. Requires `aDrag == 0`. |
| 3 | `ORBIT` | A helical offset around the origin, using `aShape.yz`. Totem and portal motes. |
| 4 | `FLICKER` | Brightness modulated by a hash of the instance id and time. |

### The analytic arc

With constant acceleration `a` and exponential drag coefficient `k`, the closed form is exact:

```glsl
// t is seconds since emission.
// Degenerate at k = 0, so k is floored at 1e-3. At that value the error against
// true drag-free motion over a 2.5 s lifetime is under 0.13%, which is far
// below a pixel at any size these particles are drawn at.
float k  = max(aDrag, 1e-3);
float ek = exp(-k * t);
vec3 pos = aOrigin
         + aVelocity * (1.0 - ek) / k
         + aAccel * (t - (1.0 - ek) / k) / k;
```

This is 3 multiply-adds and one `exp` per vertex.
It is cheaper than the naive per-frame CPU integration by roughly four orders of magnitude in total work, and it is exact rather than an Euler approximation, so a particle's arc does not change if the frame rate does.

**That last property is worth stating on its own: particles are frame-rate independent by construction, not by careful integration.**
A dust puff on a 144 Hz monitor traces exactly the same curve as on a 30 Hz one.

The single analytic bounce, when `BOUNCE` is set and `aDrag == 0`:

```glsl
// Solve for the time the parabola first crosses aGround.x.
// Only valid without drag, which the flag's contract requires.
float g  = aAccel.y;            // negative
float y0 = aOrigin.y - aGround.x;
float vy = aVelocity.y;
float disc = vy * vy - 2.0 * g * y0;
float tHit = disc > 0.0 ? (-vy - sqrt(disc)) / g : 1e9;
if (t > tHit) {
  float td = t - tHit;
  float vyb = -(vy + g * tHit) * aGround.y;             // restitution
  pos.y  = aGround.x + vyb * td + 0.5 * g * td * td;
  pos.xz = aOrigin.xz + aVelocity.xz * (tHit + td * aGround.y);   // friction on the horizontal
  pos.y  = max(pos.y, aGround.x);                        // clamp after the second arc
}
```

Two branches, no loop, roughly 15 extra ALU ops on the particles that ask for it.

**If this turns out fiddly in practice, the fallback is `pos.y = max(pos.y, aGround.x)` alone**, which slides a chunk to a stop on the floor.
That reads acceptably and is 2 ops.
Take the fallback rather than shipping a bounce that is subtly wrong; a chunk that tunnels through the floor is worse than one that does not bounce.
I am guessing at the cost-benefit here and have not measured it.

### Life and culling

```glsl
float t = uTime - aSeedTime;
float life = t / aLifetime;
if (life < 0.0 || life > 1.0) {
  // Behind the far plane, so the primitive is clipped and rasterises nothing.
  // Cheaper than a zero scale, which still generates and clips a degenerate
  // triangle, and far cheaper than a discard, which defeats early-Z.
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  return;
}
```

A dead particle costs four vertex-shader invocations that exit on the second instruction, and zero fragments.
At 2048 particles all dead that is 8192 trivial vertex invocations, which is nothing.

**This is what removes the need for per-frame uploads.**
Dead particles cull themselves from data that was written when they were born.

### Size and fade

```glsl
float size  = mix(aSize.x, aSize.y, life);
float fade  = pow(1.0 - life, aShape.x);
// Fade in over the first 12% of life, so nothing pops into existence at full
// brightness. Cheap and it is the difference between a spawn and an appearance.
fade *= smoothstep(0.0, 0.12, life);
```

`aShape.x` (fade power) per effect: 1.0 for a linear fade, 3.0 for a flash that is gone almost immediately, 0.6 for something that holds and then drops.

### The two material families

The families exist because they have opposite requirements and merging them would compromise both.

**Family A: billboard.**

- Geometry: one `PlaneGeometry(1, 1)`, 4 vertices, 2 triangles, instanced.
- Facing: extracted from `modelViewMatrix` in the vertex shader, so no CPU work and no `Object3D` per particle.
  ```glsl
  vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
  vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
  vec3 offset   = (camRight * position.x + camUp * position.y) * size;
  ```
  With `GROUND_ALIGNED` the basis is replaced by world X and Z, and with `VELOCITY_STRETCHED` `camRight` is replaced by the normalised screen-space velocity and `size.x` scaled by the effect's stretch factor.
- Fragment: a radial falloff, no texture.
  ```glsl
  float d = length(vUv - 0.5) * 2.0;
  // Power 2.5 rather than a linear or gaussian falloff. This is the single
  // most important number for the stacking problem in the next subsection:
  // it concentrates the energy in the middle 40% of the quad and makes the
  // outer 60% contribute almost nothing, so overlapping quads overlap mostly
  // in their near-zero regions.
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.5);
  gl_FragColor = vec4(vColor * a * vFade, a * vFade);
  ```
  For `GROUND_ALIGNED` rings, replace the radial falloff with an annulus: `a = smoothstep(0.34, 0.5, d) * smoothstep(0.5, 0.46, d)`.
- Blending: `AdditiveBlending` or `NormalBlending`, per the policy below.
- `depthWrite: false`, `depthTest: true`, `toneMapped: false`.
- No sorting needed: additive is commutative, and normal-blended billboards in this catalogue never overlap each other.

**Family B: mesh chunks.**

- Geometry: a bevelled tetrahedron, 12 triangles.
  Generated once by `chunkGeometry()`: a `TetrahedronGeometry(0.5, 0)` with each face inset 12% and the resulting gaps filled, which gives four visible facets and four chamfer strips.
  The reference brief is explicit that impact particles are discrete solid objects, never smoke puffs, so these need to catch light and read as objects.
- Lighting: hand-written, two terms, no three lighting integration.
  ```glsl
  // A fixed key matching Lighting.tsx's directional at (8, 14, 6), plus a
  // hemisphere term. Not physically joined to the scene's lights, and it does
  // not need to be: these live for under a second and nobody compares them to
  // the shading on a wall.
  float ndl = max(dot(vNormal, uKeyDir), 0.0);
  float hemi = vNormal.y * 0.5 + 0.5;
  vec3 col = vColor * (uAmbient * mix(uGroundCol, uSkyCol, hemi) + ndl * uKeyCol);
  ```
  `uKeyDir` normalised `(8, 14, 6)`, `uKeyCol` `#fff2dd` at 1.3 to match the scene key, `uAmbient` 0.5.
- Spin: a rotation matrix built from `aSpin` about an axis hashed from the instance id, applied to both position and normal.
- Blending: `NormalBlending`, `depthWrite: true`, `depthTest: true`.
  These are solid objects and they occlude each other correctly.
- **Peak output capped at 1.35 linear luminance.** Mesh chunks must never bloom; a glowing gravel chunk reads as a bug.
- `toneMapped: false` is wrong here and must not be set: chunks are lit surfaces and should be tone-mapped with everything else.
  This is the one material in this document that keeps three's default tone mapping.

### The blending policy

This is the constraint that shapes the whole catalogue.

**Additive quads stack.
A cluster of individually-dim additive dust can cross the 1.75 threshold and produce a white blob.**

The policy is three classes, and every effect in section 10 declares which one it is.

**Class 1: solid.**
`NormalBlending`, `depthWrite: true`, peak linear luminance `<= 1.35`.
Cannot bloom, cannot stack, occludes correctly.
This carries the majority of the particle count in every effect that has one.

**Class 2: sub-threshold additive.**
`AdditiveBlending`, `depthWrite: false`, per-particle peak linear luminance `<= 0.24`.
The budget is `peak * maxOverlap <= 1.60`, with `maxOverlap` estimated per effect from the emission geometry.
At peak 0.24 that allows 6 fully-coincident particles before the threshold is at risk, and every Class 2 effect in section 10 emits on a ring or a spread with a minimum separation that makes 6-way coincidence geometrically impossible.

Three mechanisms enforce it:

1. **Peak cap.** 0.24 linear luminance, which is 38% of `palette.visor`'s unit luminance. Dim.
2. **Falloff power 2.5.** Two quads whose centres are 0.5 radii apart overlap in a region where both are already at `(1 - 0.5)^2.5 = 0.177` of peak. The effective stacked value is 0.085, not 0.48. The falloff does more work here than the cap does.
3. **Minimum emission separation.** Every Class 2 emitter places particles on a ring or an arc with an explicit angular step, never by uniform random sampling of a disc. Uniform random sampling is what produces coincident particles, and it is banned for Class 2.

**Class 3: deliberate bloom.**
`AdditiveBlending`, `depthWrite: false`, peak linear luminance up to 4.2, and a **hard cap on the number alive**.
Section 10 gives each Class 3 effect a `maxAlive` and the pool enforces it by refusing to emit beyond it.
Class 3 effects are additionally required to be spatially separated by construction: the landing ring is a single quad, collectible sparks are emitted on a sphere with a 22 degree minimum angular step, and portal sparkles are spread across an 8.6 m^2 face with at most 24 alive.

`bloomBudget.ts` exports the check and section 12's test runs it over the whole catalogue, so the policy is enforced by CI and not by discipline.

```ts
export type BloomClass = 1 | 2 | 3

/** Returns null if the effect is within budget, or a description of the violation. */
export function checkBloomBudget(e: EffectDef): string | null {
  const lum = luminance(e.color) * e.peak
  if (e.blendClass === 1 && lum > 1.35) return `class 1 peak ${lum} exceeds 1.35`
  if (e.blendClass === 2 && lum > 0.24) return `class 2 peak ${lum} exceeds 0.24`
  if (e.blendClass === 2 && lum * e.maxOverlap > 1.60) return `class 2 stack ${lum * e.maxOverlap} exceeds 1.60`
  if (e.blendClass === 3 && e.maxAlive > 32) return `class 3 maxAlive ${e.maxAlive} exceeds 32`
  if (e.blendClass === 3 && lum > 4.2) return `class 3 peak ${lum} exceeds 4.2`
  return null
}
```

### Draw calls

Three `InstancedMesh` instances total, regardless of how many effects are running.

| Mesh | Family | Blending | Pool |
| --- | --- | --- | --- |
| `billboardAdd` | A | Additive | short + long, classes 2 and 3 |
| `billboardNorm` | A | Normal | short, ground-aligned decals |
| `chunks` | B | Normal, depth write | short, class 1 |

Effects that need more than one class emit into more than one mesh, which is why `emit()` takes the pool set rather than a single pool.
`renderOrder`: `chunks` 0 (they are effectively opaque), `billboardNorm` 2, `billboardAdd` 3.
All after the contact shadow's 1.

### The pool and the ring allocator

```ts
export type Pool = {
  capacity: number
  /** All the instanced attribute arrays, one Float32Array each. */
  seedTime: Float32Array
  lifetime: Float32Array
  origin: Float32Array      // capacity * 3
  // ... one per attribute in the table above ...

  /** Absolute expiry time per slot, so liveness is a comparison not a countdown. */
  expireAt: Float32Array

  /** Monotonic write cursor. Slot is `cursor % capacity`. */
  cursor: number
  /** Emits refused because the pool was saturated. Exposed in dev. */
  dropped: number
  /** Per-effect alive counters, for Class 3 maxAlive enforcement. */
  aliveByEffect: Uint16Array
  /** Which effect owns each slot, so a recycle can decrement the right counter. */
  effectOf: Uint8Array

  /** Dirty ranges for this frame. Fixed length 4, so a wrapped emit fits. */
  ranges: Int32Array        // [start0, count0, start1, count1, ...]
  rangeCount: number
}
```

**Allocation is a ring with an expiry check, not a free list.**

```ts
/**
 * Claims `n` contiguous-ish slots, returning the first index or -1.
 *
 * A ring rather than a free list because a free list needs a sweep to refill,
 * and a sweep is O(capacity) work on a frame that may not be emitting anything.
 * The ring is O(n) on emit and O(0) otherwise, which matches how the system is
 * actually used: long stretches of nothing punctuated by bursts.
 *
 * The one hazard a ring has is a long-lived particle parking in front of the
 * cursor and blocking short-lived ones behind it. That is solved by
 * partitioning: two pools, one for lifetimes up to 0.6 s and one for up to
 * 2.5 s, each with its own cursor. Nothing long ever blocks anything short.
 */
export function allocate(p: Pool, n: number, now: number, effect: number, maxAlive: number): number
```

The rules:

1. If `maxAlive > 0 && p.aliveByEffect[effect] + n > maxAlive`, refuse and increment `dropped`.
   This is the Class 3 cap.
2. Walk `n` slots from `cursor`. If any has `expireAt[slot] > now`, the pool is saturated at that point.
   Refuse the whole emit rather than a partial one, and increment `dropped` by `n`.
   Partial bursts look worse than absent ones.
3. Otherwise, for each slot, decrement `aliveByEffect[effectOf[slot]]` if it was live, write the new data, set `effectOf[slot] = effect`, and increment `aliveByEffect[effect]`.
4. Record the dirty range or ranges. A run that crosses `capacity` produces two, which is why `ranges` is length 4.

`expireAt[slot] = seedTime + lifetime`.
Liveness is `expireAt[slot] > now`, a single comparison, with no per-frame countdown loop.
That is the second thing that makes idle frames free.

### Upload

```ts
// In ParticleField's useFrame, after the drain.
if (pool.rangeCount > 0) {
  for (let i = 0; i < pool.rangeCount; i++) {
    const start = pool.ranges[i * 2]
    const count = pool.ranges[i * 2 + 1]
    for (const attr of attributes) {
      attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize)
      attr.needsUpdate = true
    }
  }
  pool.rangeCount = 0
}
uniforms.uTime.value = gameClock.elapsed
```

`addUpdateRange` and `clearUpdateRanges` are the three r159+ API; `updateRange` as a single mutable object was deprecated and behaves differently.
Three 0.185 has the newer form.

**On a frame with no emissions, `needsUpdate` is never set and nothing is uploaded.**
The only per-frame GPU communication is one float.
That is the whole design, in one sentence.

`clearUpdateRanges()` must be called on each attribute after the frame, or the ranges accumulate and three eventually uploads the whole buffer anyway.
Three does this itself in `WebGLAttributes.update`, so it is handled, but a build agent adding a manual upload path needs to know.

### The emitter API

```ts
// src/art/vfx/vfxBus.ts
//
// A module singleton, following the same pattern and for the same reason as
// cameraFrame.ts and irisHandle.ts: this is called from inside physics steps
// and frame loops, and routing it through React would re-render the scene tree
// at 60 Hz for data that only ever fills buffers.

export const vfx = {
  /** Set by ParticleField on mount, cleared on unmount. Null means no VFX tier. */
  pools: null as PoolSet | null,

  /**
   * Fire an effect.
   *
   * Safe to call when `pools` is null, which is what makes the `low` tier work:
   * gameplay code calls vfx.emit() unconditionally and on `low` it is a
   * two-instruction no-op. No caller anywhere checks the quality tier.
   */
  emit(effect: EffectId, t: number, x: number, y: number, z: number,
       nx: number, ny: number, nz: number, strength: number, hue: number): void,

  /** Continuous emitters register once and are ticked by VfxSystem. */
  addAmbient(id: number, def: AmbientDef): void,
  removeAmbient(id: number): void,
}
```

`emit` taking eleven scalars rather than an options object is deliberate: an options object is an allocation, and this is called from inside the physics step.

The `pools === null` no-op is the mechanism that makes `low` genuinely zero cost.
`ParticleField` does not mount at all on `low`, `vfx.pools` stays null, and every `emit` call in the game returns immediately.
There is no branch on the quality tier anywhere in gameplay code, which is what stops the tier system leaking into places that should not know about it.

### Ambient emitters

Portal sparkles and totem motes are continuous, not event-driven.
They register an `AmbientDef` and `VfxSystem` ticks them:

```ts
export type AmbientDef = {
  effect: EffectId
  /** Particles per second. */
  rate: number
  /** World position. */
  x: number; y: number; z: number
  /** Emitter extent, interpretation is per-effect. */
  radius: number
  /** Below this distance from the player, the emitter runs. Above it, it does not. */
  activeRadius: number
  /** Fractional accumulator, so a rate below the frame rate still works. */
  accum: number
}
```

`accum += rate * dt`, emit `floor(accum)` particles, `accum -= floor(accum)`.
The `activeRadius` cull is what keeps a hub with four portals and six totems from running ten ambient emitters at once.
`activeRadius` is 8 m for portals and `INTERACTION.radius * 2.2 = 5.72` m for totems.

Ambient emitters must never emit more than `ceil(rate * 0.05)` in one frame, so a tab that regains focus after a long pause does not dump 400 sparkles in one frame.
Clamp it, do not accumulate.

### Recycling rules, stated plainly

1. A slot is live if and only if `expireAt[slot] > now`. There is no death list, no callback, no removal.
2. Slots are reused in cursor order, so the oldest expired slot is always reused first.
3. An emit that cannot be satisfied is refused whole and counted, never truncated.
4. Class 3 effects additionally cap by `maxAlive`, checked before the ring check.
5. Nothing is ever allocated after `createPool`.
6. The pool never shrinks or grows. Changing the quality tier remounts `ParticleField`, which creates a new pool at the new capacity and discards the old one.

Rule 6 means a tier change mid-play drops every live particle.
That is correct: a tier change already remounts most of the scene.

---

## 10. The effect catalogue

Nine effects.
Seven were asked for; `reviveMotes` and `portalEntryBurst` are added because the revival and the portal are the two beats the game already has and neither has any feedback at all.

Colour rule, from the reference brief: **reward feedback comes from the reward palette (gold, white, cyan) and never from the world palette**, so juice reads as feedback independently of where the player is standing.
Physical feedback (dust, chunks) comes from the world palette, because a dust puff that is not the colour of the ground is a bug.

### Summary table

| # | Effect | Trigger | Count | Lifetime | Class | Pool | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `jumpDust` | `Jump` | 10 / 14 | 0.42 s | 2 | short | med+ |
| 2 | `landingRing` | `Land`, a > 0.25 | 1 | 0.18 s | 3 | short | med+ |
| 3 | `landingChunks` | `Land`, a > 0.50 | 6 / 14 | 0.75 s | 1 | short | med+ |
| 4 | `footstepMotes` | `Footstep`, speedNorm > 0.55 | 3 | 0.30 s | 2 | short | high |
| 5 | `portalSparkles` | ambient, unlocked portal within 8 m | 14 / 26 per s | 1.6-2.4 s | 3 | long | med+ |
| 6 | `collectiblePop` | `Collect` | 18 + 10 + 1 | 0.9 / 0.35 / 0.20 s | 1 + 3 + 3 | short | med+ |
| 7 | `totemMotes` | ambient, within 5.72 m | 6 per s | 1.8 s | 3 | long | med+ |
| 8 | `speedLines` | speedNorm > 0.85 for 0.4 s | 12 per s, 6 alive | 0.22 s | 2 | short | high |
| 9 | `reviveMotes` | `Revive` | 16 | 0.9 s | 3 | short | med+ |
| 10 | `portalEntryBurst` | `PortalEnter` | 24 | 0.55 s | 3 | short | med+ |

Counts written `a / b` are `medium / high`.

---

### 1. `jumpDust`

The ground kicking away from the feet on takeoff.

| Property | Value |
| --- | --- |
| Trigger | `EV.Jump`, unconditional |
| Count | 10 (medium), 14 (high) |
| Origin | `event.xyz + normal * 0.02`, on a ring of radius `0.16 + uniform(-0.04, 0.04)` |
| Angular placement | `i * 2PI / count + uniform(-0.18, 0.18)` rad. **Stepped, not random**, per the Class 2 rule. |
| Velocity | Radial in the ground plane at `1.4 + uniform(0, 0.8)` m/s, plus `0.5 + uniform(0, 0.5)` m/s along the normal |
| Accel | `(0, -5.5, 0)` |
| Drag | 3.2 |
| Lifetime | `0.42 + uniform(-0.08, 0.08)` s |
| Size | 0.09 -> 0.20 m |
| Fade power | 1.4 |
| Colour | `mix(palette.soil, palette.grass, 0.4)` at 0.55 value, linear luminance 0.21 |
| Peak | 1.0, so effective peak luminance 0.21, inside the Class 2 cap of 0.24 |
| `maxOverlap` | 3, from the stepped ring at radius 0.16 with a 0.20 m final size |
| Blending | Class 2, additive |
| Flags | none |
| Tier | `low` none, `medium` 10, `high` 14 |

At 3-way overlap the worst-case stacked luminance is `0.21 * 3 = 0.63`, comfortably under 1.60.
The dust never blooms and it is not supposed to: dust is not a light source.

Scaled by `event.a`, which is the launch speed fraction.
A jump cut short by releasing the button still emits, at 45% of the count, because `JUMP.cutMultiplier` applies after the launch and the dust is already gone by then.

---

### 2. `landingRing`

The single-frame readability layer that says "an impact happened here".

| Property | Value |
| --- | --- |
| Trigger | `EV.Land` with `a > 0.25` |
| Count | 1 |
| Origin | `event.xyz + normal * 0.015` |
| Velocity | zero |
| Accel | zero |
| Drag | 0 |
| Lifetime | 0.18 s |
| Size | `0.18` -> `0.30 + 0.80 * a` m |
| Fade power | 3.0, so it is effectively gone by 90 ms |
| Colour | `#ffffff`, linear `(1, 1, 1)`, luminance 1.0 |
| Peak | `2.4 + 0.6 * a`, so 2.4 to 3.0 |
| `maxAlive` | 2 |
| Blending | Class 3, additive |
| Flags | `GROUND_ALIGNED` |
| Tier | `low` none, `medium` and `high` yes |

Ground-aligned so it lies flat on the surface and expands outward, which is the standard shockwave read.
The annulus fragment path rather than the radial one: a filled disc reads as a flash on the floor, a ring reads as a wave.

Peak luminance 3.0 against a threshold of 1.75 means it blooms hard for two frames and then is gone.
That is the "impact flash 1-2 frames" the reference brief specifies, delivered in world space rather than as a screen effect, which is better: it is located at the impact rather than washing the whole frame.

Lifetime 0.18 s is inside the 250 ms ceiling.

---

### 3. `landingChunks`

The tactility layer. Solid objects, real gravity, they pile up.

| Property | Value |
| --- | --- |
| Trigger | `EV.Land` with `a > 0.50` |
| Count | `round(lerp(4, 6, a))` medium, `round(lerp(6, 14, a))` high |
| Origin | `event.xyz` on a ring of radius `0.20 + uniform(0, 0.06)`, stepped |
| Velocity | Cone 55 degrees from the ground normal, speed `1.8 + uniform(0, 1.6) * a` m/s |
| Accel | `(0, -18, 0)` |
| Drag | 0, required by the `BOUNCE` flag |
| Spin | rate `uniform(6, 14)` rad/s, phase `uniform(0, 2PI)` |
| Lifetime | 0.75 s |
| Size | `0.05` -> `0.03` m, so they shrink slightly as they settle |
| Fade power | 0.6, holding then dropping |
| Colour | Ground tint, `mix(palette.soil, palette.grassDeep, 0.5)`, at value 0.62 |
| Peak | 1.0, effective luminance 0.29 before lighting, under 1.35 after the key term |
| `aGround` | `(event.y, 0.35)` |
| Blending | Class 1, normal, depth write |
| Flags | `BOUNCE` |
| Tier | `low` none, `medium` 4-6, `high` 6-14 |

The reference brief's impact recipe is "a single-frame bright ring plus 8-20 solid chunks with gravity and bounce plus 2-4 frames of screen shake".
Effects 2 and 3 plus section 11's shake are exactly that recipe.

14 chunks on `high` rather than 20 because our impacts are more frequent than Astro's and 20 per landing on a jump-heavy traversal saturates the pool.

At `a = 1` and 3.4 m/s launch at 55 degrees, a chunk peaks 0.18 m up at 0.22 s, lands at 0.44 s, bounces to 0.02 m, and settles.
Lifetime 0.75 s gives it 0.3 s lying on the ground before fading, which is what makes it read as debris rather than as a sparkle.

---

### 4. `footstepMotes`

Ambient disturbance from running. Very small.

| Property | Value |
| --- | --- |
| Trigger | `EV.Footstep` with `a > 0.55` (which is `speedNorm` at plant) |
| Count | 3 |
| Origin | The planted foot's IK position, jittered `+-0.03` m laterally |
| Angular placement | Stepped at 120 degrees, jittered `+-25` degrees |
| Velocity | `0.5 + uniform(0, 0.4)` m/s, directed backward relative to `facing` and 30 degrees up |
| Accel | `(0, -2.0, 0)` |
| Drag | 4.0 |
| Lifetime | 0.30 s |
| Size | 0.05 -> 0.11 m |
| Fade power | 1.8 |
| Colour | Ground tint at value 0.50 |
| Peak | 0.75, effective luminance 0.16 |
| `maxOverlap` | 2 |
| Blending | Class 2, additive |
| Tier | `high` only |

`high` only because at 9 steps per second of running this is the highest-frequency emitter in the game, and it contributes the least.
It is the first thing to cut and the last thing to add.

The `a > 0.55` gate means walking produces nothing and running produces a trail, which is a speed cue that costs nothing to read.

---

### 5. `portalSparkles`

Ambient, the portal breathing.

| Property | Value |
| --- | --- |
| Trigger | Ambient, registered by `Portal.tsx` when `!locked`. Active within 8 m of the player. |
| Rate | 14 per s (medium), 26 per s (high) |
| Origin | A point on the 2.6 x 3.3 opening, sampled with radius biased toward the rim: `r = sqrt(uniform(0.45, 1.0))`, angle stepped by the golden angle 2.3999 rad per emission |
| Velocity | `(0.15 + uniform(0, 0.35))` m/s, directed inward-and-up: 60% toward the opening's centre, 40% along world up |
| Accel | `(0, +0.4, 0)`, so they rise |
| Drag | 1.2 |
| Lifetime | `1.6 + uniform(0, 0.8)` s |
| Size | 0.035 -> 0.0 m |
| Fade power | 1.0 |
| Colour | `palette.visor` `#4de2ff`, linear luminance 0.63 |
| Peak | 3.2, effective luminance 2.02 |
| `maxAlive` | 24 |
| Blending | Class 3, additive |
| Flags | `ORBIT` with radius 0.06 m and rate 2.2 rad/s, `FLICKER` |
| Tier | `low` none, `medium` 14/s, `high` 26/s plus 8 mesh chips |

The golden-angle stepping is what guarantees separation: consecutive emissions land 137.5 degrees apart, so no two sparkles born near each other in time are near each other in space.
This is the Class 2 minimum-separation rule applied to a Class 3 effect, and it is why 24 alive at peak 2.02 is safe across an 8.6 m^2 face.

Blooms deliberately.
The portal is supposed to be the brightest thing in the hub and `PortalShimmer` already runs at `uIntensity 1.9` with its arm crests crossing the threshold.
These sparkles are the same material family conceptually and should read as the same phenomenon.

On `high`, add 8 mesh-family "chips": 0.03 m tetrahedra in `palette.rock` drifting on the same paths at 0.3x the speed with 4 s lifetimes.
Solid objects among the light is the reference's manufactured-world rule applied to a magic effect, and it is what stops the portal reading as generic fantasy sparkle.

---

### 6. `collectiblePop`

Lesson completion, cosmetic earned. The biggest single reward beat in the game.

Three sub-emissions fired together from one event.

**6a, chunks.**

| Property | Value |
| --- | --- |
| Count | 18 |
| Origin | The collected object, on a sphere of radius 0.10 m, stepped by the golden spiral |
| Velocity | Cone 70 degrees from world up, speed `2.6 + uniform(0, 1.6)` m/s |
| Accel | `(0, -20, 0)` |
| Drag | 0 |
| Spin | `uniform(10, 20)` rad/s |
| Lifetime | 0.90 s |
| Size | 0.05 -> 0.04 m |
| Colour | `palette.unlocked` `#ffd45e` for hue 0, `palette.visor` for 1, `palette.token` for 2 |
| Peak | 1.0 |
| `aGround` | `(groundY, 0.45)` |
| Blending | Class 1, normal, depth write |
| Flags | `BOUNCE` |

Cube shards rather than tetrahedra would be marginally better here (coin discs, per the reference), and the shared `chunkGeometry` is not worth a second geometry for one effect.
Use the tetrahedron.

**6b, sparks.**

| Property | Value |
| --- | --- |
| Count | 10 |
| Origin | Same point, no offset |
| Velocity | Radial on a sphere, stepped at a minimum 22 degrees apart, speed `3.4 + uniform(0, 1.2)` m/s |
| Accel | `(0, -6, 0)` |
| Drag | 5.5, so they decelerate hard and read as sparks rather than as projectiles |
| Lifetime | 0.35 s |
| Size | 0.06 -> 0.0 m |
| Fade power | 2.2 |
| Colour | `#fff4d6`, linear luminance 0.90 |
| Peak | 3.6, effective luminance 3.24 |
| `maxAlive` | 12 |
| Blending | Class 3, additive |
| Flags | `VELOCITY_STRETCHED`, stretch factor 2.4 |

The 22 degree minimum separation is what makes 12 alive at peak 3.24 safe.
At 0.35 s and drag 5.5 they travel about 0.55 m before stopping, so by the time they are at their brightest they are already 0.2 m apart.

**6c, ring.**

Same as `landingRing` but gold, expanding to 1.4 m over 0.20 s, peak 3.0, `GROUND_ALIGNED` at the collected object's height rather than the ground.

Total for one collect: 29 particles, one shake, one hit-stop, one `happy` expression hold, one impact flash.
That is the loudest thing in the game and it should be.

Tier: `low` none, `medium` 18 + 10 + 1, `high` the same.
This is not scaled by tier because it fires at most a handful of times per session and it is the payoff for finishing a lesson.

---

### 7. `totemMotes`

Ambient, the lesson node thinking.

| Property | Value |
| --- | --- |
| Trigger | Ambient, registered by `LessonTotem.tsx`. Active within `INTERACTION.radius * 2.2 = 5.72` m. |
| Rate | 6 per s, both tiers |
| Origin | The accent ring at `y = 0.98`, radius 0.44, stepped by the golden angle |
| Velocity | `(0, 0.25 + uniform(0, 0.20), 0)` |
| Accel | `(0, 0.15, 0)`, a gentle rise |
| Drag | 0.8 |
| Lifetime | 1.8 s |
| Size | 0.030 -> 0.0 m |
| Fade power | 1.2 |
| Colour | `palette.node` `#7c6bff` when incomplete, `palette.unlocked` `#ffd45e` when complete |
| Peak | 2.6. `palette.node` linear luminance is 0.24, so effective 0.62; `palette.unlocked` is 0.66, so effective 1.72 |
| `maxAlive` | 16 |
| Blending | Class 3, additive |
| Flags | `ORBIT` radius 0.05 m, rate 1.4 rad/s |
| Tier | `low` none, `medium` and `high` 6/s |

Note the asymmetry: the incomplete purple motes sit under the bloom threshold and the completed gold ones sit just over it.
That is deliberate and it is free progression feedback.
A completed totem visibly glows harder from across the island, with no extra code.

They rise 0.45 m over their lifetime, from the ring at 0.98 to about 1.43, which is short of the node at 2.1.
Do not extend them to reach it; motes that terminate at the node read as being consumed by it, which is a different and less interesting idea than "the plinth is emitting thought".

---

### 8. `speedLines`

The reference brief's substitute for motion blur.

| Property | Value |
| --- | --- |
| Trigger | `speedNorm > 0.85` sustained for 0.4 s. Stops immediately when it drops below 0.75. |
| Rate | 12 per s, 6 alive at steady state |
| Origin | On a cylinder around the player: radius `0.9 + uniform(0, 0.7)` m, angle stepped by the golden angle, height `uniform(0.2, 1.4)` m, offset `+0.6` m forward along `facing` so they stream past |
| Velocity | `-velocity * 0.35`, so they move backward relative to the player at 35% of travel speed |
| Accel | zero |
| Drag | 0 |
| Lifetime | 0.22 s |
| Size | 0.020 wide, `0.35` -> `0.60` m long via the stretch flag |
| Fade power | 1.0, with a fade-in over the first 25% |
| Colour | `#ffffff`, luminance 1.0 |
| Peak | 0.22, effective luminance 0.22 |
| `maxOverlap` | 2 |
| Blending | Class 2, additive |
| Flags | `VELOCITY_STRETCHED`, stretch factor 18 |
| Tier | `high` only |

**Peak 0.22 is deliberately under the Class 2 cap and nowhere near the bloom threshold.**
Speed lines that bloom look like a rendering bug, not like speed.
They work by being numerous and moving, not by being bright.

`MOVEMENT.maxSpeed` is 6.0 m/s, so `speedNorm > 0.85` is 5.1 m/s, which is reachable only at a sustained full-forward press.
The 0.4 s delay before they start means they never fire during ordinary movement, only during a genuine run.

The 0.6 m forward offset is what makes them read: lines spawning behind the character are invisible because the camera is behind the character.

---

### 9. `reviveMotes`

The arrival beat. The game already has a revival drop and an iris, and neither has any particle feedback.

| Property | Value |
| --- | --- |
| Trigger | `EV.Revive`, at the moment the body is placed, not at the landing |
| Count | 16 |
| Origin | A vertical cylinder around the spawn: radius 0.5 m, angle stepped by 22.5 degrees, height `uniform(0, 2.0)` m |
| Velocity | Inward toward the spawn axis at `0.9 + uniform(0, 0.5)` m/s, plus `-0.6` m/s vertically |
| Accel | zero |
| Drag | 2.4 |
| Lifetime | 0.90 s |
| Size | 0.045 -> 0.0 m |
| Fade power | 0.8 |
| Colour | `palette.visor` |
| Peak | 3.0, effective luminance 1.89 |
| `maxAlive` | 16 |
| Blending | Class 3, additive |
| Flags | `FLICKER` |
| Tier | `low` none, `medium` and `high` 16 |

They converge on the spawn point as the character falls into it, arriving roughly when the character does.
`REVIVAL.dropHeight` is 1.6 m at `JUMP.gravity * fallGravityMultiplier = -36`, so the fall takes `sqrt(2 * 1.6 / 36) = 0.298` s.
At 0.9 s lifetime the motes are still arriving when the landing squash fires, and `TRANSITION.irisOpenMs` is 420 ms, so the whole beat overlaps: iris opening, motes converging, character landing, squash rebounding.
That is one motion rather than four, which is exactly the reasoning already written into `TRANSITION.irisOpenMs`'s comment.

---

### 10. `portalEntryBurst`

| Property | Value |
| --- | --- |
| Trigger | `EV.PortalEnter`, on the frame `onEnter()` fires |
| Count | 24 |
| Origin | The portal opening's plane, on a stepped ellipse |
| Velocity | Inward toward the opening's centre at `2.2 + uniform(0, 1.0)` m/s, plus `+1.0` m/s along the portal's forward |
| Accel | zero |
| Drag | 3.0 |
| Lifetime | 0.55 s |
| Size | 0.05 -> 0.0 m |
| Fade power | 1.6 |
| Colour | `palette.visor` |
| Peak | 3.4, effective luminance 2.14 |
| `maxAlive` | 24 |
| Blending | Class 3, additive |
| Tier | `low` none, `medium` and `high` 24 |

Fires under the closing iris, so most of it is seen for about 200 ms.
That is correct; the burst is what makes the iris close feel caused rather than scheduled.

---

### Colour derivation

`jumpDust`, `landingChunks` and `footstepMotes` take the ground colour, and the ground colour differs per scene.
Rather than each emitter knowing about scenes, add one field to the VFX bus:

```ts
/**
 * The colour physical debris takes in the current scene.
 *
 * Set once per scene by the scene component. Dust the colour of the hub's soil
 * kicked up inside a cave is the specific bug this exists to prevent, and it is
 * the kind that survives review because nobody plays both scenes back to back.
 */
vfx.groundTint: [number, number, number]   // linear RGB
```

Hub: `mix(palette.soil, palette.grass, 0.4)` at 0.55 value.
Cave: `mix(palette.caveRock, palette.caveRockDeep, 0.5)` at 0.55 value.

Reward colours never read this and are always literal palette entries.

---

## 11. Juice timing

The reference brief's rule is a hard ceiling: **every feedback effect is 250 ms or less**.
Astro's feedback never lingers, and a 400 ms shake is the difference between "impact" and "the camera is broken".

Everything in this section obeys it, and section 12 has a test that proves it.

### The scaled clock

Hit-stop needs a clock that can pause, and several systems need to agree on it.

```ts
// src/game/gameClock.ts
//
// One clock, two readings. Everything visual and animated reads `elapsed`, so
// hit-stop freezes the character, the particles and the visor scanlines
// together. UI, transitions and the loader read `real`, so a hit-stop cannot
// stall a scene transition or freeze the HUD.

export const gameClock = {
  /** Advances at `scale` times real time. What animation and VFX read. */
  elapsed: 0,
  /** Advances at real time, always. What UI and the transition machine read. */
  real: 0,
  /** 0 during hit-stop, 1 otherwise. No values in between are currently used. */
  scale: 1,
  /** `real` time at which the current hit-stop ends. */
  stopUntil: 0,
}

/** Called once per frame, first, by a component mounted above everything else. */
export function stepGameClock(delta: number): void {
  const dt = Math.min(delta, 0.05)
  gameClock.real += dt
  gameClock.scale = gameClock.real < gameClock.stopUntil ? 0 : 1
  gameClock.elapsed += dt * gameClock.scale
}
```

`Math.min(delta, 0.05)` for the same reason it is clamped everywhere else in this project.

### Hit-stop

30-60 ms per the reference.
Two triggers only.

| Trigger | Duration |
| --- | --- |
| `Collect` | 55 ms |
| `Land` with `a > 0.80` | 40 ms |

Nothing else.
Hit-stop on every landing would make ordinary traversal feel like the game is stuttering, which is the exact failure this effect is famous for.
`a > 0.80` is a fall of at least 22.4 m/s, which given `JUMP.velocity = 8.2` is only reachable from a genuine drop, not from a normal jump.

Implementation:

```ts
// In PlayerController.useBeforePhysicsStep, at the very top.
if (gameClock.scale === 0) {
  endInputFrame()   // still drain input so a press is not lost across the stop
  return
}
```

The body is kinematic, so a skipped step means it simply does not move, and Rapier's own step still runs harmlessly.
`RobotModel` gets `dt * gameClock.scale`, so `stepAnim` receives 0 and every spring holds.
`ParticleField` writes `gameClock.elapsed`, so every particle freezes mid-arc.

**`endInputFrame()` must still be called**, or a jump pressed during the 55 ms stop is consumed by the next frame's `jumpPressed` edge detection and silently dropped.
That is a real bug and it is easy to write.

Two limitations, stated because a build agent will hit them.

Dynamic rigid bodies elsewhere in the world keep stepping during a hit-stop, because we are not pausing `<Physics>`.
There are none of consequence today.
If that changes, the fix is `<Physics paused={...}>`, which costs a React re-render on each transition and is acceptable at two per session.

The camera keeps updating during a hit-stop, because `FollowCamera` uses its own `delta`.
That is correct and deliberate: the shake needs to keep running through the stop, and the shake is most of what makes the stop read as an impact rather than as a dropped frame.

### Screen shake

**How it reaches `FollowCamera`**, which is the part that needs specifying precisely.

A module singleton, following the pattern `cameraFrame.ts` already establishes, plus a pure integrator.

```ts
// src/game/camera/shake.ts

export type ShakeState = {
  /** Accumulated trauma, 0..1. Amplitude is proportional to trauma squared. */
  trauma: number
  /** Seconds since the last trauma was added. Drives the noise phase. */
  t: number
  /** Output, world-space metres. Read by FollowCamera, written here. */
  ox: number; oy: number; oz: number
  /** Output, radians of camera roll. */
  roll: number
}

export const shake: ShakeState = { trauma: 0, t: 0, ox: 0, oy: 0, oz: 0, roll: 0 }

/**
 * Adds trauma. Additive and clamped, so two impacts in the same frame combine
 * rather than the second replacing the first.
 */
export function addTrauma(s: ShakeState, amount: number): void {
  s.trauma = Math.min(1, s.trauma + amount)
}

/**
 * Advances the shake and writes its offsets.
 *
 * Trauma squared rather than linear, which is the standard trick: it makes
 * small impacts almost imperceptible and large ones dramatic, so the same
 * curve serves a footstep and a death without a separate scale for each.
 *
 * The noise is three summed sines per axis with irrational frequency ratios,
 * rather than a real Perlin field. Deterministic, allocation-free, testable as
 * a pure function of (trauma, t), and at these amplitudes and durations
 * genuinely indistinguishable from noise.
 */
export function stepShake(s: ShakeState, dt: number): void {
  s.trauma = Math.max(0, s.trauma - SHAKE.decay * dt)
  s.t += dt
  const a = s.trauma * s.trauma
  if (a <= 0) { s.ox = 0; s.oy = 0; s.oz = 0; s.roll = 0; return }
  const t = s.t
  s.ox = a * SHAKE.amplitude * (Math.sin(t * 31.4) * 0.6 + Math.sin(t * 57.1 + 1.7) * 0.4)
  s.oy = a * SHAKE.amplitude * (Math.sin(t * 27.3 + 2.9) * 0.6 + Math.sin(t * 63.7 + 0.4) * 0.4)
  s.oz = a * SHAKE.amplitude * 0.4 * Math.sin(t * 41.9 + 5.1)
  s.roll = a * SHAKE.rollAmplitude * Math.sin(t * 23.7 + 3.3)
}
```

The early return when `trauma` is zero is not an optimisation.
It guarantees that when nothing is happening the camera position is bit-identical to what it would be without the shake system, which is what makes the feature safe to have on at every tier.

```ts
export const SHAKE = {
  /** Trauma per second of decay. 6.7 means full trauma is gone in 150 ms. */
  decay: 6.7,
  /** Peak positional offset at trauma 1, in metres. */
  amplitude: 0.075,
  /** Peak roll at trauma 1, in radians. 0.6 degrees. */
  rollAmplitude: 0.011,
} as const
```

With `decay = 6.7` and amplitude proportional to `trauma^2`, the amplitude envelope falls as `(1 - 6.7t)^2`.
At `t = 0.075` s the amplitude is 25% of peak; at `t = 0.149` s it is zero.
**Total duration 149 ms, inside the 250 ms ceiling and inside the reference's 80-150 ms band.**

A trauma of 0.5 decays in 75 ms, which handles the small impacts.

Trauma per trigger:

| Trigger | Trauma | Duration | Peak offset |
| --- | --- | --- | --- |
| `Land`, `a < 0.3` | 0 | - | none |
| `Land`, `a >= 0.3` | `0.25 + 0.55 * a` | 60-119 ms | 0.005 - 0.048 m |
| `Collect` | 0.55 | 82 ms | 0.023 m |
| `Bonk` | `0.30 * a` | up to 45 ms | up to 0.007 m |
| `Death` | 0.85 | 127 ms | 0.054 m |
| `PortalEnter` | 0.35 | 52 ms | 0.009 m |

At `CAMERA.distance = 7.5` m and a 55 degree FOV on a 1080-tall viewport, one world metre at the player subtends about 139 px.
So the maximum shake of 0.054 m is roughly 7.5 px.
That is a lot for a single frame and almost nothing sustained, which is what a good shake is.

**Application in `FollowCamera`.**

The classic bug here is feeding the shaken position back into the spring, so the camera drifts away and never returns.
Avoid it by keeping the unshaken position as the spring's state and adding the shake only at the end.

```ts
// A persistent Vector3 in a ref, alongside smoothLook. This is what the spring
// actually operates on. camera.position is a derived value that the shake is
// added into and that nothing ever reads back.
const unshaken = useRef(new Vector3())

// ... inside useFrame, replacing the existing lerp block ...
if (!initialised.current) {
  unshaken.current.copy(scratch.desired)
  smoothLook.current.copy(scratch.lookAt)
  initialised.current = true
} else {
  unshaken.current.lerp(scratch.desired, posT)
  smoothLook.current.lerp(scratch.lookAt, lookT)
}

camera.position.copy(unshaken.current)
camera.lookAt(smoothLook.current)

// Shake last, after lookAt, so the rotation is not recomputed from a shaken
// position and the shake reads as a camera wobble rather than as the world
// sliding around.
stepShake(shakeState, dt)
camera.position.x += shakeState.ox
camera.position.y += shakeState.oy
camera.position.z += shakeState.oz
if (shakeState.roll !== 0) camera.rotateZ(shakeState.roll)
```

`camera.rotateZ` after `lookAt` is a local-space roll, which is what a handheld camera does.
Rolling before `lookAt` would be silently discarded, since `lookAt` overwrites the whole quaternion.

`FollowCamera` calls `addTrauma` by draining the event ring with its own cursor, which is the third consumer of the section 5 channel.
It does not need `RobotModel` or `VfxSystem` to have run first, for the reasons in section 5.

Shake uses `delta`, not `gameClock.elapsed`, so it keeps running through hit-stop.
This is the one deliberate exception to the scaled clock and it is why the two clocks exist.

### Impact flash

A full-screen white flash, 1-2 frames.

Implemented as a `<div>` in `HUD.tsx`, not as a post-processing pass.

```tsx
// Fixed, full-screen, pointer-events none, mix-blend-mode screen.
// Opacity driven by a rAF-free CSS transition triggered from the juice bus.
<div className="impact-flash" style={{ opacity: flashOpacity }} />
```

Reasons for the DOM over a shader:

- It costs nothing in the 3D pipeline and cannot interact with the bloom threshold.
- It composites after tone mapping, which is where a screen flash belongs.
- There is no shader to fail silently.
- It works on `low` at zero cost, so the cheapest tier gets the loudest single piece of feedback for free.

| Trigger | Opacity | Duration | Colour |
| --- | --- | --- | --- |
| `Collect` | 0.14 | 33 ms up, 100 ms down | `#fff4d6` |
| `Death` | 0.30 | 16 ms up, 180 ms down | `#ffffff` |
| `Land` | none | - | - |
| `PortalEnter` | none, the iris already does this | - | - |

Total 133 ms and 196 ms, both inside the ceiling.

No flash on landing.
A flash on every landing is the single most obnoxious thing a platformer can do, and the landing already has a ring, chunks, a shake, a squash and a shadow spike.

The flash is driven by a small `useState` in `HUD` fed by a `useEffect` subscription to the juice bus, which is fine because it fires at most a handful of times per session.
This is the one place in this document where React state is acceptable in a feedback path.

### The complete timing table

Every feedback effect, with its duration, against the 250 ms ceiling.

| Effect | Onset | Duration | Under 250 ms |
| --- | --- | --- | --- |
| Landing ring | frame 0 | 180 ms | yes |
| Landing chunks | frame 0 | 750 ms | no, and correctly so |
| Landing squash to rebound | frame 0 | 245 ms to peak, 313 ms to settle | the beat is 245 ms |
| Shadow radius spike | frame 0 | 200 ms | yes |
| Screen shake, hard landing | frame 0 | 119 ms | yes |
| Hit-stop, hard landing | frame 0 | 40 ms | yes |
| Head nod on landing | frame 0 | 251 ms to peak | yes, marginally |
| Antenna whip on landing | frame 0 | 1412 ms | no, and correctly so |
| Jump dust | frame 0 | 420 ms | no, and correctly so |
| Takeoff stretch | frame 0-1 | 364 ms to settle | the beat is 33 ms |
| Impact flash, collect | frame 0 | 133 ms | yes |
| Screen shake, collect | frame 0 | 82 ms | yes |
| Hit-stop, collect | frame 0 | 55 ms | yes |
| Collect ring | frame 0 | 200 ms | yes |
| Collect sparks | frame 0 | 350 ms | no, and correctly so |
| Blink | - | 110 ms | yes |
| Expression transition | - | 140 ms | yes |

The ceiling applies to **feedback**, meaning things that tell the player an event happened.
It does not apply to **consequence**, meaning debris settling, dust dispersing and a spring antenna ringing out.
Chunks falling for 750 ms are not feedback that is lingering, they are objects obeying gravity, and cutting them at 250 ms would look wrong.

The distinction matters and a build agent should apply it: if it is telling you something, it is under 250 ms; if it is a thing behaving like a thing, it lasts as long as physics says.

### Squash timing, summarised

Repeated here because it is the item the reference brief is most specific about.

| Beat | Reference target | This spec |
| --- | --- | --- |
| Takeoff stretch | Y x1.15-1.25, XZ x0.85, over 2-3 frames | Y x1.18, XZ x0.921 x 1.10 lateral, over 2 frames |
| Landing squash | Y x0.7-0.8, XZ x1.15-1.25, for 3 frames | Y x0.62 at full impact, XZ x1.270 x 1.10, held 2 frames by the spring |
| Overshoot | to x1.05 | to x1.095 at 245 ms |
| Volume | preserved | preserved exactly, `sx * sy * sz = 1` |
| Anticipation | 3-5 frames | 3 frames, on buffered jumps and scripted beats only |

`Y x0.62` is deeper than the reference's 0.7-0.8 band, and only at maximum impact speed.
At the reference's implied typical landing, which here is `a` around 0.35, the squash is `1 - 0.38 * 0.35 = 0.867`, slightly shallower than the band.
The full range from 0.867 to 0.62 across impact speeds is more expressive than a fixed value in the band, and the existing code already scales by strength so this is not a new idea.

---

## 12. Unit tests for the pure modules

Every test file is `.ts`, never `.tsx`, because `vitest.config.ts` globs `src/**/*.test.ts` and a `.test.tsx` is silently skipped.
That silence is worth repeating: a `.tsx` test does not fail, it does not warn, it simply never runs.

Precedents to follow: `src/game/player/movement.test.ts`, `src/art/quality.test.ts`, `src/art/placement.test.ts`, `src/art/flowerGeometry.test.ts`.

### `src/game/player/proportions.test.ts`

The guard that stops a future edit un-toying the character.

- `PROPORTIONS.totalHeight / PROPORTIONS.headHeight` is within `[2.45, 2.85]`.
- `PROPORTIONS.headHeight / PROPORTIONS.totalHeight` is within `[0.37, 0.48]`.
- `PROPORTIONS.headWidth > PROPORTIONS.torsoWidthMax`, with the ratio at least 1.10.
- `PROPORTIONS.totalHeight` is within `[1.30, 1.42]`, so the model cannot drift out of the frozen capsule.
- `REST.legL.x === -REST.legR.x` and the same for the shoulders, so the rig cannot go asymmetric by a typo.
- Every `REST` y value increases monotonically up the chain when accumulated: sole 0, hips 0.520, chest 0.740, neck 0.890, head 1.090.

This file is short and it is the highest-leverage test in the list, because the proportion change is the whole point of the character work and it is exactly the kind of thing a later "make the head smaller, it looks weird" commit undoes.

### `src/game/player/springs.test.ts`

- **Convergence**: from `x = 1, v = 0, target = 0` at `omega 12, zeta 0.6`, stepping at `dt = 1/60` for 2 s, `abs(x) < 0.01`.
- **Overshoot magnitude**: at `zeta = 0.58`, the first extremum past the target is within `[0.095, 0.120]` of the step size, matching the analytic `exp(-pi * zeta / sqrt(1 - zeta^2)) = 0.107` to within integration error.
- **Overshoot count**: at `zeta = 0.58`, count sign changes of `x - target` over 2 s and assert exactly 3 (so one overshoot, one undershoot, one final approach) with the later ones under 2% of the step.
- **Zero overshoot at critical damping**: at `zeta = 1.0`, `x` never exceeds `target` by more than 1e-9 at any step.
  **This is the regression test for the bug in section 0**, and it must be written before the `SQUASH` constants change, so it documents what the old behaviour actually was.
- **Frame-rate independence**: 1 s of simulation at `dt = 1/60` versus `dt = 1/240` gives final `x` within 2%, and at `dt = 1/30` within 6%.
- **Stability under a large step**: `omega = 400, zeta = 0.5, dt = 0.05` for 100 steps, `abs(x)` stays below 10 and is finite.
  This is what proves the integrator is semi-implicit; explicit Euler diverges to infinity here and the test catches a regression to the wrong form.
- **Every spring in the `SPRINGS` table**: for each entry, assert its analytic overshoot and 5% settle time match the values in the section 6 table to within 5%.
  This turns the table into an executable specification rather than documentation that rots.

### `src/game/player/poseSolver.test.ts`

- **Determinism**: two `AnimRuntime`s created with the same seed, fed the same 600-frame script of `(RobotAnimState, GroundSample, dt)`, produce `Pose` structs that compare equal on every one of the roughly 250 numeric fields.
  Write a `flattenPose(pose): number[]` helper and compare arrays.
- **Reset correctness**: after a fidget completes, every joint the fidget touched has returned to a value within 1e-6 of the value the same script produces with fidgets disabled.
  This catches the "solver stops writing a field and it sticks" failure that `resetPose` exists to prevent.
- **Idempotence at `dt = 0`**: `stepAnim` with `dt = 0` twice in a row leaves every pose field unchanged.
  This is what makes hit-stop provably a freeze rather than a slow drift.
- **Finiteness under abuse**: `dt = 10`, `speedNorm = 1e9`, `turnNorm = NaN` guarded to 0 at the boundary, `ground.hit = false`.
  Every pose field is finite and every scale field is within `[0.3, 2.0]`.
- **No allocation**: wrap the `Pose` in a `Proxy` whose `set` trap records the key, run 10,000 frames, and assert the recorded key set is exactly the known field set and that `Object.keys(pose)` has not grown.
  A true GC assertion is not reliable in vitest and this is the honest substitute; it catches the realistic failure (a solver assigning a fresh object to `pose.head`) rather than the theoretical one.
- **Volume preservation**: for `squash` swept over `[0.40, 1.45]` in 0.01 steps, `abs(root.sx * root.sy * root.sz - 1) < 1e-6`.
- **Waddle symmetry**: over exactly one step cycle at constant `speedNorm = 1`, the integral of `hips.rz` is within 1e-3 of zero and the integral of `hips.px` is within 1e-3 of zero.
  A waddle with a net bias is a limp.
- **Turn-in-place preserved**: with `speedNorm = 0` and `turnNorm = 1`, `rt.phase` advances at exactly `WADDLE.bobFrequency * TURN_ANIM.stepScale` rad/s.
  This is the behaviour that was just added and it must not be lost in the refactor.
- **Head leads, torso lags**: with `turnNorm` stepped from 0 to 1, `sign(pose.head.ry)` is opposite to `sign(pose.chest.ry)` at every frame after the first 3.
- **Airborne tuck**: with `grounded = false`, both `legL.rx` and `legR.rx` are negative and both `shoulderL.rx` and `shoulderR.rx` are more negative still, matching the current `tuck` behaviour.
- **Landing envelope**: fire a `Land` event with `a = 1` and assert `root.sy` reaches its minimum within 1 frame, exceeds 1.0 by between 8% and 13% at some point, and is within 1% of 1.0 by 350 ms.

### `src/game/player/faceSolver.test.ts`

- **Blink interval bounds**: over 10,000 s of simulated idle, every measured interval between blink onsets is within `[2.0, 5.0]` s, except for the second blink of a double which is at `0.18 +- 0.01` s.
- **Blink duration**: every blink's `open` returns to its pre-blink value within `[100, 120]` ms of onset.
- **The bar never disappears**: `openL` and `openR` are never below 0.06 at any frame of any expression or blink.
  This is the identity constraint from section 7 and it is the one thing about the face that must not regress.
- **Gaze clamping**: with a focus target 40 m off to the side, `gazeX` is exactly `+-1.0` and never beyond.
- **Gaze smoothing**: a step change in the focus target produces a `gazeX` that reaches 90% of its target in `[200, 260]` ms, matching `lambda = 10`.
- **Blink suppression**: over 60 s of a scripted jump loop, no blink onset occurs while `verticalVelocity > 0 && !grounded`.
- **Expression blend never overshoots**: during a `neutral` to `surprised` transition, `openL` is monotonically non-decreasing and never exceeds 1.50.
- **Determinism**: same seed, same script, same blink schedule.

### `src/game/player/animEvents.test.ts`

- **Wrap without corruption**: push 1000 events into a 64-slot ring, draining after each, and assert every event is delivered exactly once in order.
- **Two independent consumers**: two cursors both drain the full sequence, and neither affects the other.
- **Fast-forward on falling behind**: a consumer that does not drain for 100 pushes sees `ANIM_EVENT_CAPACITY` events on its next drain and `dropped` has increased by exactly `100 - 64`.
- **No allocation**: array identities are stable across 10,000 pushes; `ring.kind === ring.kind` before and after.
- **Push during drain**: pushing from inside the drain callback does not deliver the new event in the same drain and does deliver it in the next.
- **Payload round-trip**: every field written by `pushEvent` reads back identically through `drainEvents`, for each of the 10 kinds.

### `src/art/vfx/particlePool.test.ts`

- **Budget**: emitting 10x capacity in one frame never writes an index outside `[0, capacity)`.
  Assert by pre-filling every array with a sentinel and checking the arrays' lengths are unchanged.
- **Refusal is whole**: an emit of 20 into a pool with 12 free slots writes 0 particles and increments `dropped` by 20.
- **Recycling**: fill the pool, advance `now` past every `expireAt`, and assert the next emit of `capacity` particles succeeds.
- **Ring wrap produces two ranges**: an emit of 10 starting at `capacity - 4` produces `rangeCount === 2` with ranges `[capacity - 4, 4]` and `[0, 6]`, covering exactly 10 slots with no overlap.
- **`maxAlive` enforcement**: a Class 3 effect with `maxAlive = 12` refuses the 13th concurrent particle and accepts one again after the first expires.
- **`aliveByEffect` accounting**: after a full cycle of fill, expire and refill, every counter in `aliveByEffect` is exactly the number of slots whose `effectOf` matches and whose `expireAt > now`.
  This is the invariant that `maxAlive` depends on and it is the one most likely to drift.
- **Short and long partition**: filling the long pool with 2.5 s particles does not reduce the short pool's available capacity at all.
- **No allocation**: all typed array identities stable across 10,000 emits.
- **Determinism**: same seed, same emit sequence, byte-identical attribute arrays.

### `src/art/vfx/bloomBudget.test.ts`

Iterates the whole catalogue from `vfxTuning.ts`.

- Every effect returns `null` from `checkBloomBudget`.
- Every Class 1 effect has peak linear luminance at or below 1.35.
- Every Class 2 effect has peak at or below 0.24 and `peak * maxOverlap` at or below 1.60.
- Every Class 3 effect has `maxAlive` at or below 32 and peak at or below 4.2.
- Every Class 2 and Class 3 effect declares a stepped or golden-angle emission pattern rather than uniform disc sampling, checked by a required `separation` field being non-zero.
- Sum of `maxAlive` across all Class 3 effects does not exceed the `high` tier's short-pool capacity.

This is the test that makes the section 9 blending policy real rather than aspirational.

### `src/game/camera/shake.test.ts`

- **Decay within budget**: for every trauma value in the section 11 table, `abs(ox)` reaches zero within 250 ms and within 160 ms for all but `Death`.
- **Zero is exactly zero**: with `trauma = 0`, all four outputs are exactly `0`, not `1e-17`.
  This is what guarantees the camera is bit-identical when nothing is happening.
- **Trauma clamps**: five `addTrauma(0.5)` calls in one frame leave `trauma` at exactly 1.
- **Additive**: `addTrauma(0.3)` then `addTrauma(0.3)` gives 0.6, not 0.3.
- **Amplitude bound**: over 10,000 random `(trauma, t)` samples, `abs(ox)` never exceeds `SHAKE.amplitude` and `abs(roll)` never exceeds `SHAKE.rollAmplitude`.
- **Deterministic in `t`**: `stepShake` from the same state with the same `dt` sequence produces identical output.
- **Frame-rate independence of the envelope**: total shake duration at `dt = 1/60` and `dt = 1/144` agree within 2 ms.

### `src/game/player/footIk.test.ts`

- **Clamping**: a ground sample 2 m below the foot produces an offset of exactly `-FOOT_IK.maxDrop`, not 2 m.
- **Tilt clamp**: `clampTilt` on a normal 60 degrees off vertical returns a normal exactly `maxTilt` off vertical, with the azimuth preserved to within 1e-6.
- **Blend engages and disengages**: stepping over a synthetic staircase, the blend is 1 while grounded and reaches 0 within 140 ms of going airborne.
- **Pelvis follows the lower foot**: with the left foot 0.08 m below the right, `hips.py` is `-0.08 * FOOT_IK.pelvisFollow`.
- **No feedback loop**: running 600 frames on flat ground, the foot offset stays within 1e-6 of zero and does not accumulate.
  This is the specific bug that comes from casting from the animated position instead of the rest position.

### `src/art/geometry/*.test.ts`

Following `flowerGeometry.test.ts`.

- `superellipsePoints` with `n = 2` produces points satisfying `x^2/a^2 + y^2/b^2 = 1` to within 1e-9.
- `superellipsePoints` with `n = 4` produces points satisfying the `n = 4` Lame equation, and the point at `theta = PI/4` is measurably outside the corresponding ellipse, which is what makes it a squircle.
- `superellipsoidGeometry` produces a position attribute with no NaN, a normal attribute with every normal unit length to within 1e-5, and a bounding box matching the requested half-extents to within 1e-6 at the base.
- The taper is applied: the maximum `abs(x)` in the top 10% of the geometry's height is within 1e-6 of `a * taperTop`.
- `roundedDiscProfile` returns a closed profile whose points are all within the requested radius and half-thickness, with no point at a distance from the axis exceeding `radius`.

### What is deliberately not tested

`applyPose` gets one test, that every joint in `RigRefs` receives a non-default transform when the corresponding `Pose` field is non-default, driven by a table of `(rigKey, poseKey)` pairs.
Beyond that it is mechanical.

Nothing in `.tsx` is tested.
The existing convention in `vitest.config.ts` says rendering and feel are verified in a real browser, and this document does not change that.

---

## 13. Tier gating and budgets

### New fields on `QualitySettings`

Added to `src/art/quality.ts`, which the README already establishes as the one place anything expensive decides its cost.

```ts
export type QualitySettings = {
  // ... existing fields unchanged ...

  /** Particles with lifetimes up to 0.6 s. 0 disables the whole VFX system. */
  particleBudgetShort: number
  /** Particles with lifetimes up to 2.5 s. Its own ring, so nothing long blocks anything short. */
  particleBudgetLong: number
  /** Whether the two per-foot ground rays run. The body ray always runs. */
  footIk: boolean
  /** Two extra shadow quads under the feet. */
  contactShadowPerFoot: boolean
  /** 'simple' drops scanlines, the sweep and the glitch from the visor shader. */
  visorDetail: 'simple' | 'full'
  /** Cape segments simulated. 0 means the static single quad. */
  capeSegments: number
  /** Mesh-family chunk particles. Separate from the budget because they are the only lit particle family. */
  chunkParticles: boolean
  /** The high-frequency running emitter. */
  footstepMotes: boolean
  /** Speed lines above 85% of max speed. */
  speedLines: boolean
}
```

### The table

| Setting | `low` | `medium` | `high` |
| --- | --- | --- | --- |
| `particleBudgetShort` | **0** | 512 | 1536 |
| `particleBudgetLong` | **0** | 128 | 512 |
| `footIk` | false | true | true |
| `contactShadowPerFoot` | false | false | true |
| `visorDetail` | `'simple'` | `'full'` | `'full'` |
| `capeSegments` | 0 | 3 | 4 |
| `chunkParticles` | false | true | true |
| `footstepMotes` | false | false | true |
| `speedLines` | false | false | true |

Always on, every tier, deliberately not gated:

| Feature | Why it is not gated |
| --- | --- |
| Contact shadow, body | 2 triangles and 1 raycast. It is the single largest visual improvement in this document and it is essentially free. Gating it would be gating the thing that makes the character look like it is standing on the ground. |
| Shadow radius spike on landing | One uniform write. It is `low`'s entire landing feedback. |
| Screen shake | Pure arithmetic on 4 floats, and exactly zero when trauma is zero. |
| Hit-stop | An early return. |
| Impact flash | A DOM div. |
| All 16 springs | Roughly 200 flops per frame. |
| The visor SDF | One 900-pixel quad. `low` gets a cheaper variant, not no variant. |
| Idle breathing and fidgets | Pure arithmetic. `low` players deserve a character that is alive. |
| The full proportion and geometry spec | 9,570 triangles and 20 draw calls, against a `low` tier that still draws 15,000 grass blades. |

### `low` is genuinely zero-cost for VFX

`particleBudgetShort: 0` is the switch, and it works like this:

1. `ParticleField` returns `null` when both budgets are 0, so no `InstancedMesh`, no `ShaderMaterial`, no buffers, no shader compilation.
2. `VfxSystem` returns `null` for the same reason, so no drain loop runs.
3. `vfx.pools` stays `null`, so `vfx.emit()` is a null check and a return.
4. No gameplay code anywhere branches on the tier.
   `Portal.tsx`, `LessonTotem.tsx` and `PlayerController.tsx` all call `vfx.emit` or `vfx.addAmbient` unconditionally.

That is the property worth protecting.
The moment a call site reads `useQuality()` to decide whether to emit, the tier system has leaked into gameplay and every future effect has to remember to do the same check.

The one cost `low` still pays is the `vfx.emit` call itself, which is a property read and a branch, roughly ten instructions, a handful of times per second.

### Particle budget derivation

The reference brief gives Havok at 7,500 particles at 60 fps on a PS5.
We are in a browser, on WebGL2, sharing a frame with a 220,000-instance grass field, N8AO, SMAA, bloom and a full post chain.

**1,536 short plus 512 long on `high`, 2,048 total, is 27% of the PS5 figure.**
That is a deliberate fraction rather than a measured limit, and I am guessing.
The measurement to take before trusting it: on the `high` tier on a mid-range integrated GPU, fill both pools completely and check the frame time delta against an empty pool.
The vertex cost is 2,048 x 4 = 8,192 vertices, which is nothing; the real cost is fill rate on the additive quads with `depthWrite: false`, and that depends entirely on how large they are on screen.

The mitigation if it turns out too expensive: cut `particleBudgetShort` on `high` to 1,024 and reduce `jumpDust` and `landingChunks` counts.
The catalogue is data in `vfxTuning.ts` precisely so this is a one-file change.

### Worst-case concurrent load

The realistic worst frame is a player running at full speed, landing hard, next to a portal, having just completed a lesson.

| Effect | Alive |
| --- | --- |
| `speedLines` | 6 |
| `footstepMotes`, 3 emissions in flight | 9 |
| `jumpDust` from the previous jump | 14 |
| `landingChunks` | 14 |
| `landingRing` | 1 |
| `collectiblePop` chunks | 18 |
| `collectiblePop` sparks | 10 |
| `collectiblePop` ring | 1 |
| `portalEntryBurst` | 0, mutually exclusive with the above |
| **Short pool total** | **73** |
| `portalSparkles` | 24 |
| `totemMotes`, two totems in range | 32 |
| **Long pool total** | **56** |

73 of 1,536 and 56 of 512.
The pools are sized roughly 20x the realistic worst case, which is the right margin for a system whose failure mode is dropping effects: headroom is cheap here because dead slots cost four trivial vertex invocations.

On `medium`, 73 of 512 and 56 of 128.
The long pool is the tighter one, and if `medium` ever gains a third ambient emitter it should go to 192.

### Per-tier draw call and triangle delta

Against the current build.

| Tier | New draw calls | New triangles, static | Note |
| --- | --- | --- | --- |
| `low` | +9 | +5,900 | 8 character meshes, 1 contact shadow. Character triangles net of the current 3,600. |
| `medium` | +12 | +5,900 | Plus 3 particle meshes. |
| `high` | +14 | +5,900 | Plus 2 per-foot shadows. |

Particle triangles are dynamic and bounded by `2 * (short + long)` for billboards plus `12 * chunks`, worst case about 5,000 on `high`.

### Ordering of implementation

If this is built in stages, this is the order that gets the most look soonest, following the reference brief's own priority structure.

1. **The contact shadow**, section 8.
   Standalone, one raycast, and it fixes the single most damaging current problem.
2. **The proportions and geometry**, sections 1 and 2.
   Also standalone. The existing inline animation keeps working against the new node names with minimal edits.
3. **The architecture split**, sections 4 and 5.
   Pure refactor with no visual change, and it is the prerequisite for everything after.
4. **The animation features**, section 6.
   This is where the character comes alive, and it is safe to do in pieces because each feature is a separate pure module.
5. **The visor**, section 7.
   Independent of everything else.
6. **Juice**, section 11.
   Shake, hit-stop and flash need no particles and land most of the feel.
7. **The particle system and catalogue**, sections 9 and 10.
   The largest single piece and the last one needed.

Steps 1, 2, 5 and 6 are each shippable on their own.
Step 3 must land before step 4, and step 7 is much easier after step 3 because the event ring is already there.

---

## Appendix: things I am guessing at

Flagged so a build agent knows where to measure rather than trust.

- **The particle budget of 2,048 on `high`.** A fraction of a published PS5 figure, not a measurement on our stack. Section 13 says what to measure.
- **The analytic bounce being worth its complexity.** Roughly 15 vertex-shader ops on chunk particles. The `max(pos.y, groundY)` fallback is specified and is fine.
- **`rollAmplitude` 0.14 surviving the proportion change.** It was tuned against a smaller head. It may need to drop to 0.115.
- **Head roughness 0.42 against a canvas map centred on 0.80.** The resulting 0.26-0.40 range is derived from the reference's 0.28-0.38 band, but the map's actual mean depends on the noise implementation and should be checked by sampling it.
- **`ANTENNA.inertia = 0.022`.** Derived from wanting a 0.5 rad deflection at a 25 m/s^2 deceleration, and 25 m/s^2 is itself an estimate of the landing deceleration.
- **The camera-glance fidget interval of 6-14 s.** Pure taste, and the number most likely to want adjusting after five minutes of play.
- **The half-float frame buffer assumption** in section 7. Emissives visibly bloom today so it is almost certainly right, but every bloom number in this document depends on it and it takes thirty seconds to confirm.
- **N8AO interacting with the multiply-blended contact shadow.** AO runs first in the post chain and the shadow is a transparent forward-rendered quad, so they should compose additively in the wrong way if the shadow is too strong. `SHADOW.maxOpacity = 0.55` may need to come down on the tiers where AO is on.
