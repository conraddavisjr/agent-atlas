# Post-processing and colour grade

This is a design spec, not an implementation.
Build agents implement from it directly, so every number below is a value to type in rather than a range to interpret.

It answers eleven questions posed by the art direction pass, and it corrects three things the current chain gets wrong.
Two of those three are free performance, and one of them is the reason nothing in the game currently glows.

---

## 0. What was verified against `node_modules`, and what it changes

Nothing in this document is recalled from memory.
The installed versions are `postprocessing@6.39.4`, `@react-three/postprocessing@3.0.4` and `n8ao@1.9.x` (a transitive dependency of the latter).

| Claim | Where it was verified | Consequence |
| --- | --- | --- |
| `LookupTexture extends Data3DTexture` with a public `constructor(data: ArrayBufferView, size: number)` | `build/index.js` line 7663 | A procedural LUT is viable with zero new assets |
| `LookupTexture.createNeutral(size)` indexes data as `(r + g*size + b*size*size) * 4` | `build/index.js` line 7921 | This is the exact write order our builder must use |
| The constructor sets `type = FloatType`, `format = RGBAFormat`, `colorSpace = LinearSRGBColorSpace`, `wrap* = ClampToEdgeWrapping`, `min/magFilter = LinearFilter`, `unpackAlignment = 1` | `build/index.js` lines 7670-7684 | We do not need to set any of these ourselves |
| `convertToUint8()` maps `uint8 = float * 255 + 0.5` and flips `type` to `UnsignedByteType` | `build/index.js` line 7775 | Quantisation error is bounded at 0.5/255 |
| `convertLinearToSRGB()` mutates the data through `Color.convertLinearToSRGB` and sets `colorSpace = SRGBColorSpace` | `build/index.js` line 7824 | We must **not** call it. See section 3.4 |
| `LUT3DEffect`'s `inputColorSpace` defaults to `SRGBColorSpace` | `build/index.js` line 8009 | Confirmed. This is what makes grading-after-tone-mapping correct |
| `LUT3DEffect` reads `lut.image`, `lut.type` and `lut.domainMin/Max` but never `lut.colorSpace` | `build/index.js` lines 8035-8062 | The texture's own colour space is inert for our purposes |
| `EffectPass.updateMaterial` inserts `sRGBTransferOETF` before any effect whose `inputColorSpace` differs from the running one, and appends `sRGBToLinear` at the end of the pass if it finished in sRGB | `build/index.js` lines 15444-15451 and 15583 | Colour-space handling around the LUT is fully automatic |
| `VignetteEffect` takes only `technique`, `offset` and `darkness`. There is no colour option; technique 0 multiplies toward black and technique 1 mixes toward `vec3(1.0 - darkness)`, a grey | `build/index.js` lines 13660-13697 | A tinted vignette needs a different mechanism. See section 7 |
| `ChromaticAberrationEffect` carries `EffectAttribute.CONVOLUTION` | `build/index.js` line 4592 | It can never merge with another pass. It always costs a full extra pass |
| `SMAAEffect` carries `CONVOLUTION \| DEPTH` | `build/index.js` line 10968 | Same. Its own pass, always |
| `DepthOfFieldEffect` carries `EffectAttribute.DEPTH` only | `build/index.js` line 5463 | It merges with the grading effects, and sorts to the front of that pass |
| `BloomEffect` carries no attributes | `build/index.js` line 4108 | It merges freely |
| The Bloom threshold is `smoothstep(threshold, threshold + smoothing, luminance(rgb))` with Rec.709 luminance | `build/index.js` luminance shader, line ~13000 region, and `LuminanceMaterial` | The threshold is compared against **luminance**, not peak channel. See section 5 |
| `EffectPass` sorts its effects with `effects.sort((a, b) => b.attributes - a.attributes)` | `build/index.js` line 15545 | Declaration order is preserved among equal-attribute effects because `Array.prototype.sort` is stable, but a DEPTH effect jumps to the front of its pass |
| r3f's `<EffectComposer>` groups consecutive non-convolution `Effect` children into one `EffectPass` and gives every convolution effect its own | `@react-three/postprocessing/dist/index.js`, the `useLayoutEffect` in the composer | Pass count is a direct function of child order |
| r3f's `<N8AO>` constructs `new N8AOPostPass(scene, camera)` and never reads `normalPass` or `downSamplingPass` from the composer context | `@react-three/postprocessing/dist/index.js`, component `ao` | **`enableNormalPass` is doing nothing for us.** See section 0.1 |
| N8AO's `intensity` is applied as `finalAo = pow(ao, intensity)` | `n8ao/dist/N8AO.js`, effect compositor fragment | It is an exponent, not a multiplier |
| N8AO composites as `mix(scene, color * scene, 1 - finalAo)` when `colorMultiply` is true, which is the default | `n8ao/dist/N8AO.js`, same shader | `color` is a **multiplier**, not a shadow colour. See section 6 |
| N8AO's `color` is `convertSRGBToLinear()`d before upload | `n8ao/dist/N8AO.js`, uniform update | The prop is authored as an sRGB hex string |
| N8AO's `gammaCorrection` uniform resolves to `autosetGamma ? renderToScreen : configuration.gammaCorrection` | `n8ao/dist/N8AO.js`, uniform update | Correct by default because the AO pass is never last. Never pass `gammaCorrection` explicitly |
| `<N8AO>`'s `quality` prop calls `setQualityMode` in a **later** layout effect than the one that applies `aoSamples` | `@react-three/postprocessing/dist/index.js`, two `useLayoutEffect` calls | If both are passed, `quality` silently wins. Pass one or the other, never both |
| `EffectMaterial` includes `<dithering_fragment>` after the colour-space conversion, and `EffectPass` exposes a public `dithering` setter | `build/index.js` lines 14652-14657 and 15529 | Free 8-bit dithering is one boolean. See section 9 |
| `EffectComposerContext` is exported from `@react-three/postprocessing` | `dist/index.d.ts` and the export map | A child component can reach the composer and its passes |
| The composer's `frameBufferType` defaults to `HalfFloatType` | `@react-three/postprocessing/dist/index.js`, composer constructor | All intermediate buffers are 16-bit float. Banding is an output-stage problem only |

### 0.1 Three corrections to land before anything new is added

These are not part of the art pass.
They are defects, and they should land as their own commits, before any new effect, so that the baseline the new work is judged against is a correct one.

**Correction A - `enableNormalPass` is a full wasted scene render.**
`PostFX.tsx` sets `enableNormalPass={quality.ambientOcclusion}`, on the stated reasoning that N8AO needs scene normals.
It does not.
`N8AOPostPass` derives normals from its own depth pre-pass internally, and the r3f wrapper never passes the composer's `NormalPass` to it.
Nothing else in the chain reads normals.
Delete the prop.
That removes one complete additional render of every object in the scene, on every frame, on medium and high.
This is the single largest free win in this document, and it should be measured and recorded before and after, because it recalibrates the frame budget every other decision here is spending against.

**Correction B - SMAA is running in the wrong place.**
SMAA currently sits before `ToneMapping`, so its colour edge detection runs on unbounded HDR values.
A specular hit at 6.0 next to lit plastic at 0.8 is a colour difference of 5.2 against a detection threshold of 0.1, so effectively every such boundary is flagged and blended, while genuine geometric edges in the shadows fall below threshold and are missed.
Antialiasing is an operation on the displayed image.
Move SMAA to the end of the chain, after tone mapping and after the grade.

**Correction C - nothing in the game currently blooms.**
This is the important one, and it is arithmetic rather than opinion.
The Bloom threshold is compared against Rec.709 luminance, not against the peak channel.
The `emissive()` preset defaults to `emissiveIntensity: 2`.
The brightest emissive in the palette is `visor` / `circuit` at `#4de2ff`, whose linear value is `(0.0742, 0.7605, 1.0)` and whose Rec.709 luminance is therefore `0.632`.
At intensity 2 that is a luminance of **1.264**, against a threshold of 1.75 with 0.3 of smoothing.
`smoothstep(1.75, 2.05, 1.264)` is exactly zero.
The visor does not glow.
Neither does anything else: `token` at `#ff6bd6` reaches luminance 0.737 at intensity 2, and `caveCrystal` at `#8b7bff` reaches 0.533.
The bloom pass is running every frame and contributing nothing at all.
Section 5 says what to do about it, and the answer is not to guess a new number.

---

## 1. The revised chain

### 1.1 Order, with every value

Given in JSX child order, which is the order the composer builds passes in.
`(pass)` marks something that occupies a render pass of its own.

| # | Effect | Pass | Parameters | Why it sits here |
| --- | --- | --- | --- | --- |
| 1 | `N8AO` | own (pass) | see section 6 | Occlusion is a property of the scene, not of the image, so it must be applied while the frame still is the scene and before anything samples brightness |
| 2 | `FarFieldDoF` | merged A | see section 4 | Defocus must happen before bloom, so that a defocused highlight blooms as the wide dim smear it physically is rather than as the sharp spike it was |
| 3 | `Bloom` | merged A | `intensity 0.55`, `luminanceThreshold` per section 5, `luminanceSmoothing 0.25`, `mipmapBlur`, `radius 0.6`, `levels` per tier | Before tone mapping, so it sees raw HDR and can be thresholded above the diffuse peak. This is deliberate and is why the threshold is not ~0.9 |
| 4 | `Vignette` | merged A | `offset 0.35`, `darkness 0.32` | Before tone mapping, because a vignette is an exposure falloff and multiplying linear radiance is what that means. It also lands the corners in the grade's shadow range, which is how they get tinted for free |
| 5 | `ToneMapping` | merged A | `mode: ToneMappingMode.ACES_FILMIC` | The boundary between scene-referred and display-referred. Everything above it is light, everything below it is a picture |
| 6 | `LUT` | merged A | `lut: gradeLut`, `tetrahedralInterpolation false` | The entire grade, in one texture fetch. **After** tone mapping. Section 2 explains why that is not negotiable |
| 7 | `ChromaticAberration` | own (pass) | `offset [0.00035, 0.00035]`, `radialModulation`, `modulationOffset 0.4` | A lens artifact, so it goes after the grade rather than being graded. High tier only, default off. See section 8 |
| 8 | `SMAA` or `FXAA` | own (pass) | preset per tier | Last, because antialiasing is an operation on the final displayed image, and because it must resolve the fringe the previous effect just introduced |

Renderer settings are unchanged and remain correct: `antialias: false`, `toneMapping: NoToneMapping`, `multisampling={0}`.
`enableNormalPass` is deleted per correction A.

`HueSaturation` and `BrightnessContrast` are **removed**.
Both are subsumed by the LUT, which does everything they did and more in a single fetch.
This is a net reduction in work, not an addition, and it is why the LUT can be enabled on the bottom tier.

### 1.2 What that costs in passes

With everything on at high: four passes.
AO, one merged grading-and-optics pass, chromatic aberration, antialiasing.
With chromatic aberration off, which is the default: three.
At low: two, since AO and DOF are off and everything else merges.

The merged pass is worth understanding, because it is where most of the chain lives and it is free to add to.
`DepthOfField` carries `EffectAttribute.DEPTH` and so sorts to the head of that pass, which is where we want it.
The remaining four carry no attributes and so keep their declaration order under a stable sort.
Adding a sixth non-convolution effect to that group costs one more function call in one fragment shader and no additional bandwidth.
Adding a convolution effect costs a full-screen read and write.
That asymmetry should drive every future decision about what to add.

---

## 2. Colour space, and why the grade sits after tone mapping

Three independent reasons, in decreasing order of how badly it goes wrong.

**A LUT cannot see an HDR value.**
`LUT3DEffect`'s fragment shader clamps its input to `[0, 1]` before sampling in every code path except the hardware-filtered 3D one, and in that path the texture's `ClampToEdgeWrapping` does the same job at the sampler.
Placed before tone mapping, every pixel above 1.0 samples the same corner of the cube.
The clearcoat Fresnel highlight, the sun glow on the sky dome and every emissive in the game would all be mapped to one identical output colour, and the highlight rolloff that ACES exists to produce would be destroyed before ACES ever ran.

**A grade is authored in the space a person can see.**
Lifted blacks, a split tone and an S-curve are all statements about the *picture*.
"Lift the blacks by 3%" means 3% of the displayed range.
In scene-referred linear radiance those words do not have a stable meaning, because the mapping from radiance to displayed value has not been chosen yet.

**The library agrees, and does the work for us.**
`LUT3DEffect` declares `inputColorSpace = SRGBColorSpace`.
The effect merger therefore emits `color0 = sRGBTransferOETF(color0)` immediately before the LUT's `mainImage`, and `color0 = sRGBToLinear(color0)` at the end of the pass, and it does this automatically because the LUT is the only effect in the pass that declares a non-linear input.
So the value handed to the LUT is a display-encoded sRGB triple in `[0, 1]`, and the value the LUT returns is interpreted the same way.
That is exactly the domain the grade is authored in, and it arrives without a line of our code.

The practical consequence for the LUT builder is section 3.4, and it is the one thing most likely to be got wrong: our function maps sRGB-encoded to sRGB-encoded, so **`convertLinearToSRGB()` must not be called**.

One ordering note that follows from the same mechanism.
Because the sRGB round trip is inserted at the LUT's position and closed at the end of the pass, anything placed after the LUT inside the same merged pass would be handed sRGB-encoded values and would silently behave differently.
Nothing is placed after it.
The two effects that follow are in passes of their own.

---

## 3. The procedural LUT

### 3.1 Where the code lives

Three files, and the split matters.

| File | Contents | Imports three? | Tested |
| --- | --- | --- | --- |
| `src/art/grade.ts` | `GradeConfig`, `GRADE`, `IDENTITY_GRADE`, `gradeColour`, `buildLutData` | **No** | Yes, `src/art/grade.test.ts` |
| `src/art/lut.ts` | `createGradeLut()`, which wraps the data in a `LookupTexture` | Yes | No |
| `src/art/PostFX.tsx` | Consumes `createGradeLut()` once at module scope | Yes | No |

`grade.ts` must import nothing.
It is pure arithmetic on numbers, it runs in vitest's `node` environment with no DOM and no WebGL, and it is a `.ts` file so the `src/**/*.test.ts` glob actually picks its test up.
A `.test.tsx` is silently skipped by this repo's vitest config, so nothing that needs testing may live in a `.tsx` file.

### 3.2 The pure function

```ts
export type GradeConfig = {
  /** Filmic S-curve strength. 0 is a straight line, 1 is a full smoothstep. */
  contrast: number
  /** Per-channel black floor, applied after the curve so lifted blacks survive it. */
  lift: [number, number, number]
  /** Per-channel white ceiling. */
  gain: [number, number, number]
  /** Per-channel midtone gamma. Applied as x ** (1 / gamma), so above 1 brightens. */
  gamma: [number, number, number]
  /** Added to shadows, weighted by (1 - luma) ** toneWeightExponent. */
  shadowTint: [number, number, number]
  /** Added to highlights, weighted by luma ** toneWeightExponent. */
  highlightTint: [number, number, number]
  toneWeightExponent: number
  /** Peak saturation multiplier, reached at luma 0.5 and falling to 1.0 at both ends. */
  midSaturation: number
}
```

The shipping constants:

```ts
export const GRADE: GradeConfig = {
  contrast: 0.14,
  lift:          [0.034,  0.034,  0.040],
  gain:          [1.000,  0.996,  0.984],
  gamma:         [1.000,  1.010,  1.030],
  shadowTint:    [-0.030, -0.012,  0.018],
  highlightTint: [ 0.000, -0.006, -0.030],
  toneWeightExponent: 2,
  midSaturation: 1.18,
}

export const IDENTITY_GRADE: GradeConfig = {
  contrast: 0,
  lift: [0, 0, 0],
  gain: [1, 1, 1],
  gamma: [1, 1, 1],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  toneWeightExponent: 2,
  midSaturation: 1,
}

const LUMA = [0.2126, 0.7152, 0.0722] as const
```

The chain, in this order:

```ts
export function gradeColour(
  r: number, g: number, b: number, cfg: GradeConfig = GRADE,
): [number, number, number] {
  const c: [number, number, number] = [clamp01(r), clamp01(g), clamp01(b)]

  // 1. Filmic S-curve, per channel.
  //    x + k * (smoothstep(0,1,x) - x). Fixed points at 0, 0.5 and 1, and
  //    provably monotone for k in [0,1] since d/dx = 1 + k*(6x(1-x) - 1) >= 1-k.
  if (cfg.contrast !== 0) {
    for (let i = 0; i < 3; i++) {
      const x = c[i]
      c[i] = x + cfg.contrast * (x * x * (3 - 2 * x) - x)
    }
  }

  // 2. Lift and gain, then gamma. Lift last in luminance terms, so the black
  //    floor the grade promises is the floor that survives to the output.
  for (let i = 0; i < 3; i++) {
    c[i] = clamp01(cfg.lift[i] + c[i] * (cfg.gain[i] - cfg.lift[i]))
    if (cfg.gamma[i] !== 1) c[i] = Math.pow(c[i], 1 / cfg.gamma[i])
  }

  // 3. Mid-chroma saturation. The weight 4L(1-L) peaks at luma 0.5 and is zero
  //    at both ends, which is what "boosted mid-chroma" means and is also what
  //    stops the boost pushing near-white or near-black out of gamut.
  if (cfg.midSaturation !== 1) {
    const l = clamp01(LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2])
    const s = 1 + (cfg.midSaturation - 1) * 4 * l * (1 - l)
    for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * s
  }

  // 4. Split tone. Cool shadows, warm highlights, weighted by luma.
  //    Applied after saturation so the tint constants mean exactly what they say
  //    rather than being scaled by a saturation boost downstream.
  const l = clamp01(LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2])
  const sw = Math.pow(1 - l, cfg.toneWeightExponent)
  const hw = Math.pow(l, cfg.toneWeightExponent)
  for (let i = 0; i < 3; i++) c[i] += cfg.shadowTint[i] * sw + cfg.highlightTint[i] * hw

  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
}
```

The two `!== 0` / `!== 1` guards are not micro-optimisation.
They are what makes `IDENTITY_GRADE` produce a bit-exact identity, because `l + (c - l) * 1` is not guaranteed to return `c` exactly in binary floating point.
Without the guards the identity test needs a tolerance, and a tolerance in an identity test is how a real error hides.

### 3.3 What those constants actually do, with worked values

These are the numbers a reviewer should check the implementation against.

| Input | Output | Reading |
| --- | --- | --- |
| `(0, 0, 0)` | `(0.0061, 0.0240, 0.0609)`, 8-bit `#020610` | Black is lifted off zero and is distinctly cool. Blue is ten times red |
| `(0.5, 0.5, 0.5)` | `(0.5098, 0.5140, 0.5189)` | Mid grey stays grey within 2.3/255, leaning very slightly cool |
| `(1, 1, 1)` | `(1.0000, 0.9901, 0.9547)`, 8-bit `#fffcf3` | White is warm. Red is untouched, blue is pulled down 4.5% |

A note on the black value, because it will look wrong to anyone reading the reference brief alongside this.
The brief's diagnostic is that the darkest pixel of a *white shell* in an Astro frame is rarely below 28-35% luminance.
That is a statement about the lighting rig, specifically about the ambient fill ratio, and it belongs to `Lighting.tsx`.
It is not a statement about the grade.
A LUT that mapped absolute black to 30% would fog the entire image into grey mud, which is precisely the over-processed look section 10 exists to prevent.
The grade's job is to keep black from being *neutral* and from being a hard floor, and 6/255 of blue at absolute black does exactly that.

`contrast: 0.14` is deliberately smaller than it looks.
ACES has already applied a filmic curve.
This is a second, gentle S on top of it, replacing the `BrightnessContrast contrast: 0.06` it removes, and it is applied per channel rather than on luminance, which is what gives it a small amount of the chroma crossover a real film curve has.

`midSaturation: 1.18` replaces `HueSaturation saturation: 0.08`.
It is larger because it is weighted, so its average effect across the frame is smaller.
Its shape is the point: it does nothing at all to the shadow floor or to a blown highlight, so it cannot produce the clipped, electric-edged saturation that a flat multiplier produces on a scene with this much chroma in it.

### 3.4 Building the texture

```ts
// src/art/grade.ts
export function buildLutData(size: number, cfg: GradeConfig = GRADE): Float32Array {
  const data = new Float32Array(size ** 3 * 4)
  const sizeSq = size ** 2
  const s = 1 / (size - 1)
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or_, og, ob] = gradeColour(r * s, g * s, b * s, cfg)
        const i4 = (r + g * size + b * sizeSq) * 4
        data[i4 + 0] = or_
        data[i4 + 1] = og
        data[i4 + 2] = ob
        data[i4 + 3] = 1
      }
    }
  }
  return data
}
```

The index expression `(r + g * size + b * size * size) * 4` is copied from `LookupTexture.createNeutral`.
Getting it wrong produces an image that looks plausibly graded and has its channels transposed, which is the single hardest bug in this document to spot by eye, so `buildLutData` has a dedicated unit test for it.

```ts
// src/art/lut.ts
import { LookupTexture } from 'postprocessing'
import { buildLutData, GRADE, IDENTITY_GRADE, type GradeConfig } from './grade'

export const LUT_SIZE = 32

export function createGradeLut(cfg: GradeConfig = GRADE): LookupTexture {
  const lut = new LookupTexture(buildLutData(LUT_SIZE, cfg), LUT_SIZE)
  lut.name = 'agent-atlas-grade'
  // Lossy, and deliberately the last thing done. Two reasons, and the second is
  // the load-bearing one:
  //   - it is a quarter of the memory, 128 KB rather than 512 KB;
  //   - hardware linear filtering of a FLOAT 3D texture requires
  //     OES_texture_float_linear, which is not universally available. An 8-bit
  //     LUT filters correctly everywhere with no extension and no fallback.
  lut.convertToUint8()
  // NOT convertLinearToSRGB(). LUT3DEffect's inputColorSpace defaults to
  // SRGBColorSpace, so the merged pass hands us sRGB-encoded values and reads
  // our output back as sRGB-encoded. gradeColour already works in that domain.
  // Converting here would encode a second time and wash the whole image out.
  return lut
}
```

Everything else the texture needs is set by `LookupTexture`'s own constructor and must not be touched: `format`, `type`, `minFilter`, `magFilter`, all three wrap modes, `unpackAlignment`, `needsUpdate`, `domainMin`, `domainMax` and `colorSpace`.
In particular `colorSpace` must be left at its constructor default of `LinearSRGBColorSpace`.
`LUT3DEffect` never reads it, but three does: setting it to `SRGBColorSpace` would make three request an `SRGB8_ALPHA8` internal format and apply a hardware sRGB decode on every fetch, which is a second unwanted decode on top of the one the shader already performs.

**Size: 32.**
`32 ** 3 * 4 * 4` bytes is 512 KB of transient `Float32Array` during the build and 128 KB uploaded after `convertToUint8()`.
The build is roughly 33,000 iterations of about forty floating-point operations and completes in single-digit milliseconds, so it runs at module scope with no loading state, no `Suspense` and no asset.
16 would be visibly steppy on the smooth gradients this grade produces in the sky.
64 is 1 MB of texture for a difference nobody can see.

**`tetrahedralInterpolation: false`.**
Setting it true forces `NearestFilter` on the texture and performs a four-tap manual interpolation in the shader.
It exists for LUTs with sharp discontinuities, typically ones imported from a colourist's `.cube` file.
Ours is a smooth analytic function sampled on a regular grid, which is the case hardware trilinear reconstructs almost exactly, and doing it in the shader would cost three extra texture fetches per pixel for no visible gain.

**`LookupTexture.scaleUp(size)` is not used.**
It exists, it is asynchronous, and it spawns a worker.
We author at the final size, so there is nothing to scale.

**Build the texture exactly once.**
`createGradeLut()` is called at module scope in `PostFX.tsx`, not inside the component.
This matters more than it looks: r3f's `<LUT>` component memoises its effect on `[lut, restProps]`, and `restProps` is a fresh object identity on every render, so the `LUT3DEffect` is reconstructed whenever `PostFX` re-renders.
A stable `lut` reference means that reconstruction is cheap and does not rebuild the 3D texture.
`PostFX` should continue to re-render only when the quality tier changes.

### 3.5 Rollout: identity first

The LUT lands in two commits, and the first one is deliberately a no-op.

**Commit 1 - the plumbing, with `IDENTITY_GRADE`.**
Add `grade.ts`, `grade.test.ts`, `lut.ts`, wire `<LUT>` into the chain after `ToneMapping`, and remove `HueSaturation` and `BrightnessContrast` in the same commit so the comparison is against the final structure.
Ship it configured with `IDENTITY_GRADE`.

**The acceptance test for commit 1 is a screenshot diff against the previous build.**
It is stated here precisely because the naive expectation of an exact zero diff is wrong and would produce a false failure.

An 8-bit 32-entry-per-axis identity LUT is not bit-exact.
Each grid value is quantised to `round(x * 255) / 255`, and values between grid points are reconstructed by hardware trilinear interpolation of those quantised neighbours.
The error is bounded by the quantisation step.
So the acceptance criterion is:

- **maximum per-channel absolute difference across the whole frame: at most 2/255**;
- **mean per-channel absolute difference: at most 0.5/255**;
- **no structured difference**: the difference image, amplified 32 times, must show noise and must not show edges, bands, hue shifts or any recognisable feature of the scene.

That last clause is the one that catches real bugs.
A transposed channel index, a wrong colour-space conversion or an off-by-one in the grid mapping all produce a *structured* difference image, and all of them can produce a small mean error that would otherwise pass.

Only once that passes does **commit 2** switch `createGradeLut()` from `IDENTITY_GRADE` to `GRADE`, changing exactly one identifier.
If the graded build looks wrong, the bug is in the constants, because the transport was proved correct by a commit that changed nothing.

`?lut=off|identity|on` exists throughout, so all three states are comparable in a single session without a rebuild.

---

## 4. Depth of field

The reference brief is right that this is the only post effect any technical source names for Astro Bot, and the prompt is right that it is the change most likely to make this game worse.
Both things are handled by making it far-field only, by anchoring the focus so the camera cannot pump it, and by shipping it behind a flag until it has earned its default.

### 4.1 Effect and parameters

`DepthOfFieldEffect`, subclassed. High tier only.

| Parameter | Value | Reason |
| --- | --- | --- |
| `focusDistance` | driven per frame, see 4.3 | |
| `focusRange` | driven per frame, see 4.3 | |
| `bokehScale` | `1.2` | The strength dial. The library default of 1.0 is nearly invisible at this resolution scale; above about 2.0 the far side of the island stops being readable |
| `resolutionScale` | `0.5` | The bokeh gather runs at half resolution. This is the library default and it is the right call: a blurred image does not need full-resolution sampling, and it is the difference between DOF being affordable and not |
| `blendFunction` | default (`SRC`) | |

### 4.2 Suppressing the near field, exactly

This is not a tuning problem, it is a structural one, and it needs a structural answer.

The circle-of-confusion shader writes `magnitude * vec2(step(signedDistance, 0.0), step(0.0, signedDistance))`, so red is near CoC and green is far CoC, and they are mutually exclusive per pixel.
The composite is `mix(inputColor*(1-cocFar) + colorFar, colorNear, cocNear)`.
There is no parameter that turns the near half off.
Making `focusRange` large enough to swallow the near field is not a fix, because the near CoC magnitude is `smoothstep(0, focusRange, focusDistance - d)`, which is only zero when `d >= focusDistance`.
With a camera three metres above the player looking slightly down, the ground at the bottom of the frame is routinely a third of the focus distance away, so a naive setup blurs exactly the ledge the player is lining a jump up on.
That is a gameplay regression, not an aesthetic one.

The answer is to make the near CoC identically zero and then skip the work that produced it.

```ts
// src/art/FarFieldDoF.ts
import { DepthOfFieldEffect } from 'postprocessing'
import { DataTexture, NearestFilter, RedFormat, UnsignedByteType } from 'three'
import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'

/** A 1x1 black texture. Sampled as the near circle-of-confusion buffer, it makes
 *  the composite's near-field mix weight exactly zero at every pixel. */
const ZERO_COC = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType)
ZERO_COC.minFilter = NearestFilter
ZERO_COC.magFilter = NearestFilter
ZERO_COC.needsUpdate = true

/**
 * Depth of field with the near field removed.
 *
 * Near blur is not reduced here, it is deleted. Blurring geometry between the
 * camera and the player means blurring the ledge the player is about to jump
 * onto, and no amount of dialling makes that acceptable.
 *
 * Two changes to the stock effect, and both are needed. Pointing the near CoC
 * buffer at a black texture is what makes the near field sharp; overriding
 * update() to drop the passes that fed it is what makes it free. The override is
 * a copy of the base update() with three render calls removed, and it is the one
 * thing in this file that will need re-checking on a postprocessing upgrade.
 */
export class FarFieldDepthOfFieldEffect extends DepthOfFieldEffect {
  constructor(camera: Camera, options?: ConstructorParameters<typeof DepthOfFieldEffect>[1]) {
    super(camera, options)
    this.uniforms.get('nearCoCBuffer')!.value = ZERO_COC
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget) {
    // Deliberately does not call super.update(). Dropped from it:
    //   blurPass       - only ever produced the near CoC buffer
    //   bokehNearBase  - produces a buffer the composite now weights at zero
    //   bokehNearFill  - likewise
    // Also dropped: the base class's `if (this.target !== null)` focus tracking,
    // because focus is driven externally. See section 4.3.
    this.cocPass.render(renderer, null, this.renderTargetCoC)
    this.maskPass.render(renderer, inputBuffer, this.renderTargetMasked)
    this.bokehFarBasePass.render(renderer, this.renderTargetMasked, this.renderTarget)
    this.bokehFarFillPass.render(renderer, this.renderTarget, this.renderTargetFar)
  }
}
```

That removes three of the seven render calls the effect would otherwise make, which is most of why DOF is affordable at all here.

A smaller-diff fallback exists if a build agent would rather not subclass: keep r3f's stock `<DepthOfField>`, take a ref to the effect, and set `effect.uniforms.get('nearCoCBuffer').value = ZERO_COC` in an effect hook.
That is correct, and it is one line.
It is not recommended, because it leaves three passes running every frame to fill buffers nothing reads, and because `enabled = false` on those passes does nothing: `update()` calls `render()` on them directly without consulting it.

### 4.3 Driving the focus so the collision pull-in cannot pump it

Do **not** use the effect's `target` property, and do not use r3f's `<Autofocus>`.
`target` resolves to `calculateFocusDistance()`, which is literally `camera.getWorldPosition().distanceTo(target)`.
`FollowCamera` moves that number from 7.5 to as little as 1.6 whenever the collision raycast hits a wall, and it eases back out at 4 m/s afterwards, so the focus plane would sweep 6 metres of world every time the player brushes a cave wall.

Two mechanisms remove the pump, and both are needed.

**Clamp the focus distance.**
Because near blur does not exist, the focus plane does not have to be at the player.
It only has to be at or behind them.
So the driven distance is clamped to a floor, and the collision pull-in simply runs underneath it with no consequence at all.
This is the payoff of far-field-only, and it is the reason those two decisions belong in the same spec section.

**Anchor the far end in world space.**
The far blur reaches full strength at `focusDistance + focusRange`.
Hold that sum constant by making `focusRange` absorb whatever `focusDistance` does.

```ts
export const FOCUS = {
  /** Focus never comes closer than this, so the camera's collision pull-in
   *  cannot drag the focus plane forward. Safe because near blur is deleted. */
  minDistance: 4.0,
  /** Nor further than this, so an unusual camera rig cannot push it into the sky. */
  maxDistance: 12.0,
  /** Where far blur reaches full strength, in metres from the camera. Held
   *  constant, which is what stops the background pumping when focusDistance moves. */
  farOnset: 34,
  /** Floor and ceiling on the derived range, so the ramp is never a knife edge
   *  and never so long it stops reading. */
  minRange: 12,
  maxRange: 30,
  /** Exponential damping rate for the measured distance, per second. */
  damping: 8,
} as const
```

Per frame, in a component that renders `null` and lives as a sibling of `<EffectComposer>` inside the Canvas:

```ts
const dt = Math.min(delta, 0.05)
tmp.copy(player.current.position)
tmp.y += CAMERA.lookHeight
const measured = camera.getWorldPosition(camPos).distanceTo(tmp)

smoothed.current += (measured - smoothed.current) * (1 - Math.exp(-FOCUS.damping * dt))

const focusDistance = clamp(smoothed.current, FOCUS.minDistance, FOCUS.maxDistance)
const focusRange = clamp(FOCUS.farOnset - focusDistance, FOCUS.minRange, FOCUS.maxRange)

dof.cocMaterial.focusDistance = focusDistance
dof.cocMaterial.focusRange = focusRange
```

The exponential form is the same frame-rate-independent smoothing `FollowCamera` already uses, and for the same reason.

Worked behaviour, using `CAMERA.distance` 7.5 and `CAMERA.lookHeight` 1.0:

| Situation | measured | focusDistance | focusRange | full blur at |
| --- | --- | --- | --- | --- |
| Open ground, resting camera | ~7.7 | 7.7 | 26.3 | 34 m |
| Camera pitched fully down | ~7.7 | 7.7 | 26.3 | 34 m |
| Pressed against a cave wall | 1.6 | **4.0** (clamped) | 30 | 34 m |
| Easing back out | 1.6 to 7.7 | 4.0 to 7.7 | 30 to 26.3 | 34 m |

The full-blur plane never moves.
The onset moves between 4 and 7.7 metres from the camera, and because the ramp is a `smoothstep` over 26 metres, a fixed world point at 20 m from the camera sees its CoC change from 0.29 to 0.40 across that entire swing.
That is a slow change of a tenth of a unit of blur on an already-defocused background, which is below the threshold of noticing, and it is the difference between a focus that breathes and one that pumps.

Note also that `PostFX` needs the player transform, and it currently renders outside `GameContext.Provider` in `App.tsx`.
Pass the ref explicitly: `<PostFX player={player} />`.
Do not move `<PostFX>` inside the provider; it has no other reason to be there and the boundary is currently clean.

### 4.4 Tier and default

**High tier only.** Never at medium: four extra render targets and three extra passes is not a trade a machine on the medium tier should be asked to make for an effect that is, by the reference's own account, structural rather than essential.

**Default off on landing, behind `?dof`.**
`QUALITY.high.depthOfField` ships as `false`, and `?dof=1` forces it on.
It is flipped to `true` in a separate commit, and only after every one of these has been demonstrated:

1. The portal arch, which is the hub's primary navigational target, is legible from every point on the island. Not sharp - legible.
2. Standing at the near rim looking across the island, the far rim is defocused and the mid-ground is not, so the effect reads as depth rather than as a blurry screen.
3. From the highest platform, the ground directly below the player at the bottom of the frame is **pixel-identical** to a `?dof=0` capture. This is the near-field test and it is pass/fail, not a judgement.
4. Walking a straight line into a cave wall until the camera fully collides and back out again, captured as a video, shows no visible change in background sharpness.
5. Frame time at high on the reference machine increases by less than 1.5 ms.

If (1) or (5) fails, lower `bokehScale` and retest.
If (2) fails at any `bokehScale`, the effect does not suit this world's scale and it is deleted rather than kept at a strength too low to see.
Shipping an effect nobody can see, while paying for it, is the worst of the available outcomes.

`?bokeh=<n>` overrides `bokehScale` so (1) and (2) can be bisected in one session.

---

## 5. Bloom

### 5.1 Keep 1.75, until it is measured. Then almost certainly lower it

The threshold is not wrong in principle.
Bloom runs before tone mapping and therefore sees raw HDR, so a threshold near 1.0 would catch ordinary lit geometry and haze the world, and the reference brief's suggestion of ~0.9 is describing a chain where the grade runs first.
Those are different setups and not a disagreement.

But 1.75 is empirically wrong in this scene, and correction C above is the proof: the game's only emissive preset at its default intensity produces a Rec.709 luminance of 1.264, which the threshold masks to exactly zero.
The bloom pass currently costs a mip chain per frame and outputs black.

The instinct at this point is to pick a smaller number.
That instinct is how 1.5 became 1.75 and how the README came to claim a diffuse ceiling of "~1.4" that nobody has measured.
The prompt is right that the real risk is specular rather than diffuse, and that clearcoat Fresnel at grazing incidence approaches 1.0 reflectance: with `clearcoat: 1` on the plastic preset, an `Environment` built from `Lightformer`s at intensity up to 1.1, and `envMapIntensity` at its default of 1, the peak specular value in this scene is genuinely unknown and is the number the threshold must clear.
So: measure first, and put the tools in the build to make measuring cheap.

### 5.2 `?threshold=<n>` and the rest of the override surface

All overrides parse in one pure function so they can be tested.

```ts
// src/art/fx.ts
export type FxOverrides = {
  /** ?nofx - the whole chain off. Existing behaviour, moved here. */
  disabled: boolean
  /** ?threshold=<n> - Bloom luminanceThreshold. */
  bloomThreshold: number | null
  /** ?bloomdebug - intensity 6.0 and smoothing 0.0, so the mask is unmistakable. */
  bloomDebug: boolean
  /** ?ao=<n> - N8AO intensity exponent. */
  aoIntensity: number | null
  /** ?dof=0|1 - force depth of field off or on, overriding the tier. */
  dof: boolean | null
  /** ?bokeh=<n> - DOF bokehScale. */
  bokehScale: number | null
  /** ?ca=<n> - chromatic aberration offset in UV units. 0 disables. */
  chromaticAberration: number | null
  /** ?lut=off|identity|on */
  lut: 'off' | 'identity' | 'on'
  /** ?probe - the luminance probe of section 5.3. */
  probe: boolean
}

export function parseFxOverrides(search: string): FxOverrides
```

Read once at module scope, as `DISABLE_POSTFX` already is.
Every numeric parse rejects `NaN` and falls back to `null`.
Tested in `src/art/fx.test.ts`.

The existing `?nofx` and `?quality=low|medium|high` keep working unchanged, and all of the above are additive.
Document them in the README's diagnostics section alongside `?nofx`.

### 5.3 The measurement procedure

Two parts.
The first gives a number, the second confirms it is the right number.

**Part one: the exact probe, `?probe`.**
A dev-only component that, once per second, renders the scene into a small offscreen `HalfFloatType` render target using the live camera, reads it back, and logs the maxima.

```
target:   160 x 90, HalfFloatType, RGBAFormat
renderer: renderer.setRenderTarget(target); renderer.render(scene, camera)
readback: renderer.readRenderTargetPixels(target, 0, 0, 160, 90, buf)  // Uint16Array of halfs
decode:   half-to-float in JS, ~10 lines, no dependency
log:      max R, max G, max B, max Rec.709 luminance, and the 99.5th percentile luminance
```

The renderer's `toneMapping` is already `NoToneMapping`, so the values read back are the same raw HDR values Bloom's luminance pass sees.
The 99.5th percentile matters as much as the maximum, because a single stray texel from a specular pinpoint should not set the threshold for the whole game.
Cost is one extra scene render per second and only under the flag.

**Part two: the bisection, `?threshold=<n>&bloomdebug`.**
`bloomdebug` sets `intensity` to 6.0 and `luminanceSmoothing` to 0.0, which turns the threshold into a hard binary mask: anything above it glows violently and anything below it does not glow at all.
Sweep `threshold` over `{0.7, 0.9, 1.1, 1.3, 1.5, 1.8, 2.2, 2.8}` at five fixed vantage points, and at each one record the lowest value at which no non-emissive surface glows.

The five vantages, chosen to cover the cases that actually produce peaks:

1. Hub, midday, sun in frame above the horizon, grass filling the lower two thirds. The diffuse peak.
2. Hub, camera low and close, the robot's white shell at a **grazing angle** against the sky. The clearcoat Fresnel peak, which is the one this is really for.
3. Hub, close on the portal arch stonework, which carries a photographic albedo and the widest value range of any surface in the game.
4. Hub, the robot's visor filling a quarter of the frame. This must glow at the shipped threshold.
5. Cave, crystals in frame with no daylight. The dark-scene case, which is where a threshold set from a bright scene fails.

**Then set the shipped values:**

```
luminanceThreshold = max(measured 99.5th-percentile luminance across vantages 1, 2, 3, 5) * 1.15
luminanceSmoothing = 0.25
```

The 15% is headroom against scenes that do not exist yet.
The smoothing drops from 0.3 to 0.25 because with a correctly measured threshold the transition no longer needs to hide a mismatch.

**The prediction, recorded so it can be checked:** vantage 2 will dominate, the number will land between 1.2 and 1.6, and the shipped threshold will therefore be lower than 1.75 but well above 1.0.
If the measurement instead comes back above 1.75, then the emissives are the thing that has to move, not the threshold.

### 5.4 The consequence for emissives, handed off

Whatever threshold is measured, it is only half the system.
The other half belongs to `src/art/materials.ts`, and this spec asserts the requirement rather than the implementation.

`emissive()` currently takes a flat `intensity` defaulting to 2, which means an emissive's ability to bloom depends entirely on how bright its *hue* happens to be.
Cyan clears luminance 0.63 per unit and magenta clears 0.37, so the same intensity produces a 70% difference in whether the thing glows at all.
The preset must normalise:

```
emissiveIntensity = BLOOM_TARGET_LUMA / luminance(linearise(color))
```

with `BLOOM_TARGET_LUMA = luminanceThreshold * 1.6`, so every emissive in the game sits the same distance above the line regardless of hue, and the `intensity` argument becomes a relative multiplier around 1.0 rather than an absolute one.
This is a cross-file dependency: the threshold and the emissive normalisation must land in the same commit, or one of them will be tuned against the other's broken state.

### 5.5 Remaining bloom parameters

`intensity: 0.55`, `mipmapBlur`, `radius: 0.6` are all kept.
`levels` is added and tiered: 8 at high, 6 at medium, 4 at low.
Each level is a halving in both dimensions, so dropping from 8 to 4 removes the four largest-radius, lowest-resolution passes, which cost almost nothing individually but do cost four render target binds.
The visible effect of fewer levels is a tighter, less wide glow, which on the bottom tier is a reasonable trade and is arguably the more Astro-like result anyway.

---

## 6. Ambient occlusion

### 6.1 The colour is a multiplier, and this is the thing to get right

`color: '#2a3550'` reads like a shadow tint.
It is not.
N8AO composites as `mix(scene, color * scene, 1 - finalAo)` with `colorMultiply` defaulting to true, so `color` is a **per-channel multiplier applied to the surface's own colour**.

`#2a3550` linearises to `(0.024, 0.037, 0.087)`.
A fully occluded pixel is therefore the surface at **2.4% of its red, 3.7% of its green and 8.7% of its blue**.
That is not a saturated dark tint of the palette.
That is very nearly black with a blue bias, which is precisely the "AO looks like dirt" failure the reference brief names, and it is what a build agent would produce by reading the brief's instruction and reaching for a dark hex value.

To get the brief's result, the multiplier has to be a *light* colour with a strong chromatic bias.

```
color: '#8fa4cc'
```

which linearises to `(0.275, 0.371, 0.604)`, a Rec.709 luminance of **0.368** and a blue-to-red ratio of 2.2:1.
So a fully occluded contact lands at 37% of the surface's own value, clearly chromatic and clearly cool, and it stays inside the reference's "rarely below 28-35% luminance, and always chromatic" diagnostic.
The hue is the shadow end of the hub palette, sitting between `skyTop` and `rockDeep`.
It is authored in sRGB and N8AO linearises it, so the hex value is what a colour picker would show.

Do not set `colorMultiply: false`.
That would replace the occluded surface with the flat AO colour regardless of its albedo, which turns every contact into the same colour and destroys the material read exactly where materials meet.

### 6.2 Revised parameters

| Parameter | Was | Now | Reason |
| --- | --- | --- | --- |
| `color` | `#2a3550` | `#8fa4cc` | Section 6.1. This is the headline change |
| `aoRadius` | 0.5 | **0.45** | Contact definition, not atmospheric darkening. Slightly tighter now the occlusion is no longer nearly black, so it reads as a contact rather than a soft pool |
| `intensity` | 2.2 | **3.0** | It is an exponent, `pow(ao, intensity)`, so higher means more occlusion. The much lighter multiplier weakens the effect substantially, and this restores the reach it had |
| `distanceFalloff` | 0.6 | **0.5** | Matched to the tighter radius |
| `quality` | derived from `aoSamples` | `'low'` at medium, `'medium'` at high | See below |
| `halfRes` | not set | **`true`** at medium, `false` at high | Halves the AO resolve cost, and `depthAwareUpsampling` covers the edges |
| `depthAwareUpsampling` | not set | `true` (the default, stated explicitly since `halfRes` now depends on it) | Without it, half-resolution AO bleeds across depth discontinuities and haloes every silhouette |
| `screenSpaceRadius` | not set | `false` | We want the radius in world units, so occlusion does not change scale as the camera dollies |
| `gammaCorrection` | not set | **never set it** | It auto-resolves to `renderToScreen`, which is correct because the AO pass is never last. Setting it explicitly permanently disables that auto-detection |

Do not pass `aoSamples`, `denoiseSamples` or `denoiseRadius` alongside `quality`.
The wrapper applies them in one layout effect and then calls `setQualityMode` in a second, which overwrites all three.
Passing both is how a value that appears in the source turns out not to be the value in the build.
`quality` alone, and the presets it selects are: `'low'` gives 16 AO samples / 4 denoise / radius 12, and `'medium'` gives 16 / 8 / 12.

`quality.aoSamples` in `quality.ts` becomes the source for that string rather than a sample count passed through, or is replaced outright by an `aoQuality: 'low' | 'medium'` field. The latter is clearer and is preferred.

`?ao=<n>` overrides `intensity`, because 3.0 is a reasoned estimate of an exponent and not a measurement, and the whole point of the override surface is that reasoned estimates get bisected rather than defended.

**Acceptance:** at `renderMode` 1 (AO only, available via the prop for a one-off check), the occlusion must appear where grass meets ground, where rocks meet ground and under the robot's feet, and must be substantially absent on open flat ground and on the sky.
In the composited frame, the darkest AO'd pixel on a lit white surface must not fall below 30% of the same surface's unoccluded value, checked with a colour picker on a screenshot.

---

## 7. Vignette

**`offset: 0.35`, `darkness: 0.32`.**
Down from `0.30 / 0.42`.

The current values put the frame corners at 53% of centre luminance in linear light, which is a full stop of falloff and heavy enough to read as an effect.
The new values put them at 69%, about half a stop.
The arithmetic, from the shader `color *= smoothstep(0.8, offset*0.799, d*(darkness+offset))`, at the corner where `d = 0.707`:

```
0.707 * (0.32 + 0.35) = 0.474
t = (0.474 - 0.8) / (0.2797 - 0.8) = 0.627
smoothstep = 0.627^2 * (3 - 2*0.627) = 0.686
```

The larger `offset` also widens the clear centre, so the falloff begins further out and the vignette reads as framing rather than as a dark ring.

### 7.1 Tinting it, without a new effect

The installed `VignetteEffect` has no colour option, verified above.
Technique 0 multiplies toward black and technique 1 mixes toward `vec3(1.0 - darkness)`, a neutral grey.
Neither is a tint.

**The tint comes from the ordering, at no cost.**
The vignette runs *before* tone mapping and therefore before the LUT.
Its job is to reduce exposure at the frame edges, which moves those pixels down the tonal range and into the region the grade's split tone treats as shadow.
`shadowTint` is `(-0.030, -0.012, +0.018)`, weighted by `(1 - luma)^2`.
So the darkened corners are automatically pulled cool, by an amount proportional to how much the vignette darkened them, using the same shadow hue as every other shadow in the frame.
That is a better result than a fixed vignette colour would give, because it stays consistent with the grade when the grade is retuned, and it costs nothing because the LUT fetch already happens.

Worked: a corner pixel whose ungraded value is 0.45 arrives at the LUT at roughly 0.31 after the vignette, where `sw = 0.48`, so it receives `(-0.014, -0.006, +0.009)` of tint against the `(-0.007, -0.003, +0.004)` it would have received undarkened.
The corners are measurably cooler than the centre, and the difference tracks the vignette exactly.

**Two alternatives, both rejected.**
`RampEffect` is exported by `@react-three/postprocessing` and supports `RampType.Radial` with `startColor` and `endColor` and a `MULTIPLY` blend, which would give a directly authored coloured vignette.
It is rejected because it is a second full-screen effect, in the same merged pass but still a second shader body and a second blend, to produce something the grade already produces.
A custom `Effect` subclass with a colour uniform is rejected for the same reason plus the cost of owning a shader.

If a future scene needs a vignette in a hue the grade's shadow tint cannot supply, `RampEffect` is the thing to reach for, and it should be added per-scene rather than globally.

**Acceptance:** the vignette must be invisible as a *shape*.
Screenshot the hub with `?nofx` and with the full chain, sample a horizontal line of pixels across the middle of the frame in both, and the falloff must be monotone with no visible knee.
Then desaturate both: the vignette must not change which regions read as playable.

---

## 8. Chromatic aberration

**Include it, gate it to high, ship it off by default, and let it earn its default the way DOF does.**

The reference brief puts it at position 20 of 20, in the tier explicitly labelled "expensive, last", and describes it as "very subtle, frame edges only".
Verified above, it carries `EffectAttribute.CONVOLUTION`, so it can never merge and always costs a complete extra full-screen pass.
That is a real price for an effect whose own specification is that it should be almost impossible to see, and that combination is exactly the profile of an effect that gets added, is invisible, and is never removed.

If it is added:

| Parameter | Value | Reason |
| --- | --- | --- |
| `offset` | `[0.00035, 0.00035]` | UV units. The vertex shader computes `shift = offset * vec2(1.0, aspect)` and samples red at `uv + shift`, blue at `uv - shift`. At 1920 wide this is a red-to-blue separation of about 1.3 px, growing at the corners |
| `radialModulation` | `true` | Non-negotiable. Without it the shift is uniform across the frame, including on the character |
| `modulationOffset` | `0.4` | The shader computes `d = max(distance(uv, center)*2 - modulationOffset, 0)` and lerps the sample position by `d`. At 0.4 the effect is identically zero inside a UV radius of 0.2 of frame centre, and reaches roughly 1.0 at the corners |
| tier | high only | |
| default | **off**, `?ca=<n>` to enable and dial, `?ca=0` to disable | |

**The acceptance test, and it is pass/fail:**

Capture the hub at 1920x1080 with the robot centred and filling roughly a fifth of the frame height, once with `?ca=0` and once with `?ca=0.00035`, from an identical camera state.
Diff them.

1. Inside the robot's bounding box, **every pixel of the difference must be exactly zero**. Not small. Zero. `modulationOffset` guarantees this analytically for anything inside a UV radius of 0.2 of centre, so a non-zero result means the modulation is misconfigured.
2. Along the outer 10% of the frame, the maximum per-channel difference must be at most 12/255.
3. At 100% zoom, a reviewer looking at the character must not be able to say whether the effect is on.

If (3) fails at any offset small enough to pass (1), the effect is deleted.
It has no third setting between invisible and wrong.

Frame cost must be under 0.4 ms at high on the reference machine, or it is deleted regardless of how it looks.

---

## 9. Film grain and dithering

### 9.1 Grain: refuted, and not close

The reference is right and there is nothing to add to it.
No `NoiseEffect`, no grain, at any tier.

The world rule is that everything is a manufactured object with a moulded surface under a clearcoat.
Grain is a property of a photographic *recording* of a scene, not of the scene, and applying it asserts that we are looking at film of a toy rather than at a toy.
It also fights the clean plastic read on exactly the surfaces the entire art direction is built around, and it is the cheapest available way to make a real-time render look like an amateur imitation of a film render.

### 9.2 Banding: confirmed as a real risk, with a free fix

The composer's intermediate buffers are `HalfFloatType`, so nothing bands inside the chain.
Banding is entirely an output-stage problem: the final pass writes 8 bits per channel, and a smooth gradient spanning a small range quantises into visible steps.

`SkyDome` is the strongest candidate in the game, and by some distance.
It is a single `mix(uHorizon, uTop, h)` across the whole upper hemisphere, from `#d6ecfb` to `#5aa8e8`.
Those two colours differ by about 124 units of blue-channel value across roughly half the screen height, which is a step every four or five rows of pixels at 1080p.
On a large display, at rest, that will be visible as horizontal banding, and the grade makes it slightly worse rather than better because the mid-chroma saturation boost stretches exactly the mid-range where the sky lives.
The fog, which shares the sky's horizon colour and ramps from 40 to 150 metres, is the second candidate for the same reason.

**The fix is one boolean, and it is free.**
`EffectMaterial`'s fragment shader ends with `#include <dithering_fragment>`, placed *after* the sRGB output conversion, which is exactly where a dither belongs.
`EffectPass` exposes a public `dithering` setter that forwards to `fullscreenMaterial.dithering`.
three's dithering chunk adds sub-LSB triangular noise, which converts a hard step into a stochastic boundary the eye integrates away.
Enabled on **every tier**, since a `#define` in a shader that already runs is not a cost.

Implementation: a component rendering `null`, reading `EffectComposerContext`, that sets `dithering = true` on every `EffectPass` in `composer.passes`.
It cannot do this in a layout effect, because React runs a child's layout effect *before* its parent's, and the parent `<EffectComposer>` builds `composer.passes` in a layout effect.
Use `useEffect`, which runs after, and guard it with a ref so it applies once per composer identity.
Belt and braces: re-apply on the first `useFrame` after mount, since a future r3f-pp version could move pass construction.

Only the pass that renders to screen matters for correctness, but setting it on all of them is simpler and costs nothing measurable.

If dithering alone proves insufficient on the sky specifically, the next step is a per-pixel hash dither of amplitude `1/255` inside `SkyDome`'s own fragment shader, added to `col` before output.
That belongs to the sky's owning spec, not this one, and it should not be reached for until composer dithering has been tried and photographed.

---

## 10. Tier gating

### 10.1 New fields in `QualitySettings`

```ts
/** Depth of field. High tier only, and see section 4.4 on its default. */
depthOfField: boolean
/** Chromatic aberration. High tier only, off by default, see section 8. */
chromaticAberration: boolean
/** Bloom mip levels. Each level is one more render target bind. */
bloomLevels: number
/** N8AO quality preset. Drives setQualityMode; do not also pass aoSamples. */
aoQuality: 'low' | 'medium'
/** Resolve AO at half resolution and upsample. */
aoHalfRes: boolean
/** Antialiasing. FXAA is one pass, SMAA is three. */
antialias: 'fxaa' | 'smaa-medium' | 'smaa-high'
```

`aoSamples` is removed and replaced by `aoQuality`, because the number was never reaching the pass.
Extend `quality.test.ts` to assert the new fields exist on all three tiers and that `low` has both `depthOfField` and `chromaticAberration` false and `ambientOcclusion` false.

### 10.2 The table

| | low | medium | high | Frame-cost reasoning |
| --- | --- | --- | --- | --- |
| **N8AO** | off | on, `halfRes`, `aoQuality: 'low'` | on, full res, `aoQuality: 'medium'` | A depth pre-pass plus 16 AO taps plus a denoise. The most expensive item in the chain by a wide margin, and the existing decision to have it off at low is correct and is preserved |
| **Normal pass** | off | **off** | **off** | Was on wherever AO was on, and was never used by anything. Correction A. This is the largest single saving in this document |
| **DOF** | off | off | on, gated per 4.4 | Four extra render targets and four render calls after the near-field passes are removed. Never affordable below high |
| **Bloom** | on, `levels: 4` | on, `levels: 6` | on, `levels: 8` | A downsample chain, so the marginal cost of each level is a quarter of the one before it. Levels are the cheapest available dial and the only one that changes the look rather than the correctness |
| **Vignette** | on | on | on | Two instructions in a shader that already runs. Free |
| **ToneMapping** | on | on | on | Mandatory. Not an effect, a colour-pipeline stage |
| **LUT grade** | **on** | on | on | One 3D texture fetch, merged into an existing pass, replacing `HueSaturation` and `BrightnessContrast`. **Cheaper than what it replaces.** It must be on at low, because the low tier is where the palette needs the most help |
| **Dithering** | on | on | on | A `#define`. Free |
| **Chromatic aberration** | off | off | available, default off | A full extra pass that cannot merge. Section 8 |
| **Antialiasing** | FXAA | SMAA medium | SMAA high | SMAA is three passes: edges, weights, blend. FXAA is one, with about five taps. On a machine already at `maxDpr: 1`, aliasing is at its worst and something must be done about it, so the answer at low is the cheap antialiasing rather than none |

Note what "`low` is genuinely zero-cost" means here.
It does not mean the chain is empty.
It means every item at low is either free (a define, a merged shader body, a texture fetch) or is strictly cheaper than the thing it replaced.
The two genuinely expensive items, AO and DOF, are off, and the third, SMAA, is downgraded to a single pass.
Net, the low tier after this spec is **cheaper** than the low tier before it, because it loses two grading effects, gains one, and swaps three antialiasing passes for one.

---

## 11. The over-processing risk

Bloom, DOF, chromatic aberration, vignette, LUT and AO all applied at once produce a hazy, low-contrast, over-graded image.
The prompt's framing is exact: this is the modern amateur signature in the same way flat untextured shading is the old one, and both are recognisable at a glance.
It is worth naming the mechanism, because it explains the discipline.

Every effect here is individually plausible and individually reduces local contrast.
Bloom bleeds light across edges.
DOF removes high-frequency detail.
Chromatic aberration softens edges by definition.
The vignette compresses the corners.
The grade's lifted blacks reduce the dynamic range.
AO adds a dark wash if its radius creeps up.
Each one is a small subtraction from the thing that makes the image read, and they compound multiplicatively rather than additively, which is why the frame can pass six individual reviews and fail the seventh.

### 11.1 Rollout order

Ten commits.
One effect per commit, and each one lands with its acceptance evidence attached.
The order is chosen so the cheap corrections come first and every subsequent judgement is made against a correct baseline.

| # | Commit | Gate |
| --- | --- | --- |
| 1 | Remove `enableNormalPass`. Nothing else | Frame time measured before and after at medium and high. Zero visual difference; if there is any visual difference, the premise was wrong and this is reverted |
| 2 | Move SMAA to the end of the chain. Nothing else | Edge quality on the portal arch silhouette against the sky is equal or better. Frame time unchanged |
| 3 | Add `fx.ts`, `fx.test.ts` and all URL overrides. No behaviour change | Every flag round-trips. `?nofx` still works. Zero screenshot diff with no flags set |
| 4 | Add `grade.ts`, `grade.test.ts`, `lut.ts`; wire in `<LUT>` with `IDENTITY_GRADE`; remove `HueSaturation` and `BrightnessContrast` | The identity diff of section 3.5. Max 2/255, mean 0.5/255, no structure in the amplified difference |
| 5 | Switch to `GRADE` | Section 11.2, all criteria |
| 6 | AO colour and parameters | Section 6.2 |
| 7 | Bloom: run the measurement, set the threshold, land it with the emissive normalisation | Section 5.3. The visor must glow and the white shell must not |
| 8 | Vignette values | Section 7 |
| 9 | Composer dithering | Sky banding gone at 1080p and at 1440p, verified on a photograph of a real display and not only on a screenshot |
| 10 | DOF, default off | Section 4.4, all five criteria, before the default flips |

Chromatic aberration is not in this list.
It is a candidate for an eleventh commit only after all ten have shipped and the result has been looked at for a week.

### 11.2 The one-at-a-time discipline

Three rules, and the third is the one that does the work.

**Never enable two effects in one commit.**
If a commit changes two effects, and the result is worse, the information about which one caused it is gone.

**Every commit carries the same five screenshots.**
A fixed capture set, at 1920x1080, at high, from five saved camera states: hub wide, hub close on the robot, hub close on the portal arch, cave wide, cave close on a crystal.
Same time of day, same player position, same camera angle, every time.
Kept in the PR, not in the repo.

**After every commit, run the greyscale test.**
This is the reference brief's own acceptance test and it is not a metaphor: desaturate the frame and you must still instantly read where you can stand.
It is the single best detector of over-processing available, because every one of the six effects works by reducing local contrast, and greyscale is where local contrast is all that is left.
A frame that fails it has lost its value structure, and the effect that took it away is the one that just landed.

**And the escalation rule.**
If two effects each pass individually and the combination fails the greyscale test, **the later one is reverted**, not softened.
Softening both to make the pair work is how a chain arrives at six effects each dialled down to the point of invisibility while still costing full price.
That is the worst outcome available and it is the specific failure this rule exists to prevent.

### 11.3 Per-effect acceptance criteria, collected

| Effect | Criterion |
| --- | --- |
| AO | Present at contacts, absent on open ground. Darkest AO'd pixel on a lit white surface at or above 30% of the same surface unoccluded. Reads as cool, not as grey and not as dirt |
| Bloom | The visor glows. The white shell does not, including at grazing incidence. No haze on the horizon or on sunlit grass |
| Vignette | Invisible as a shape. Monotone falloff with no knee. Does not change which regions read as playable in greyscale |
| LUT | Identity diff passes before the grade is enabled. Mid grey stays within 4/255 of neutral. Absolute black is lifted and cool but the frame does not read as fogged. Greyscale test passes |
| DOF | Near field pixel-identical to DOF off. Portal arch legible from anywhere. No focus change during a full camera collision cycle |
| CA | Zero difference inside the character's bounding box. Invisible on the character at 100% |
| Dithering | Sky banding gone, photographed on a real display |
| Whole chain | Greyscale readability test passes. Total post-process cost under 3.0 ms at high on the reference machine |

---

## 12. Unit tests for the pure grade

All in `src/art/grade.test.ts`.
It must be `.ts`, because vitest's include glob is `src/**/*.test.ts` and a `.test.tsx` is silently skipped.
It must import nothing but `./grade`, so it runs in the `node` environment with no three, no DOM and no WebGL.

**Properties of `gradeColour`:**

1. **Identity round-trip, exact.** With `IDENTITY_GRADE`, for all `r`, `g`, `b` in a 17-step sweep of `[0, 1]` (4,913 combinations), the output equals the input with **strict equality**, not a tolerance. The guards in the implementation are what make this achievable, and a tolerance here would let a real error hide.
2. **Output range.** With `GRADE`, over the same sweep plus the eight corners, every output channel is in `[0, 1]` and no output is `NaN`.
3. **Domain guard.** Inputs outside the domain (`-0.5`, `-1e-9`, `1.0001`, `2`, `1e6`) produce finite outputs equal to the clamped input's output. `Math.pow` of a negative base is the specific failure this catches.
4. **Neutral grey stays neutral.** For `x` in `{0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8}`, `max(out) - min(out) <= 0.015` (about 4/255). At `x = 0.5` specifically, `<= 0.010`. The tolerance is not slack: a split tone means shadows and highlights are deliberately not neutral, and mid grey is where the two cross, so exact neutrality is not achievable and asserting it would be wrong.
5. **Black is lifted and cool.** `gradeColour(0,0,0)` gives `b > g > r`, `r > 0`, and Rec.709 luma below `0.06`. Absolute black must not stay absolute, and it must not stay neutral.
6. **White is warm and unclipped downward.** `gradeColour(1,1,1)` gives `r >= g >= b`, `r >= 0.999`, `b <= 0.98`, and no channel above 1.
7. **Monotonicity, per channel.** For each channel `c`, and for each of 27 fixed combinations of the other two channels from `{0, 0.25, 0.5, 0.75, 1}`, sweeping `c` over 256 steps produces a **non-decreasing** output in that channel. Assert non-decreasing rather than strictly increasing, because the final clamp legitimately produces plateaus at the ends.
8. **Luma monotonicity on the grey ramp.** `luma(gradeColour(x,x,x))` is strictly increasing over 256 steps of `x`. This is the property that guarantees the grade cannot invert tonal order, which is the failure that would make the greyscale readability test fail for a reason invisible in colour.
9. **Saturation is inert at the extremes.** With two configs differing only in `midSaturation` (1.0 and 1.5), `gradeColour(0,0,0)` and `gradeColour(1,1,1)` are equal between them to within `1e-12`. This is the property that guarantees the chroma boost cannot push near-white or near-black out of gamut.
10. **The S-curve's fixed points.** With a config that is `IDENTITY_GRADE` except `contrast: 0.5`, the outputs at `0`, `0.5` and `1` are `0`, `0.5` and `1` to within `1e-12`, and the output at `0.25` is strictly less than `0.25`, and at `0.75` strictly greater than `0.75`.
11. **Purity.** Two calls with the same arguments return equal but non-identical arrays. Calling with a config object does not mutate it: deep-compare `GRADE` against a snapshot taken before a thousand calls.

**Properties of `buildLutData`:**

12. **Shape.** `buildLutData(8)` returns a `Float32Array` of length `8**3 * 4`, and every fourth element is exactly `1`.
13. **Index ordering.** For a handful of explicit cells, the value at `(r + g*size + b*size*size) * 4` equals `gradeColour(r/(size-1), g/(size-1), b/(size-1))`. Include at least `(0,0,0)`, `(size-1,size-1,size-1)`, `(size-1,0,0)`, `(0,size-1,0)` and `(0,0,size-1)`. The last three are the ones that catch a transposition, which is the highest-consequence and lowest-visibility bug available in this file.
14. **Identity LUT is the grid.** `buildLutData(8, IDENTITY_GRADE)` reproduces `LookupTexture.createNeutral`'s data exactly. Do not import `postprocessing` to check this; reimplement the four-line reference loop inside the test, which keeps the test dependency-free and is also an independent statement of the layout rather than a circular one.

**Properties of `parseFxOverrides`, in `src/art/fx.test.ts`:**

15. Empty search yields all-null / all-false / `lut: 'on'`.
16. `?nofx` sets `disabled`. `?threshold=1.2` parses to `1.2`. `?threshold=abc` and `?threshold=` yield `null`, not `NaN`.
17. `?dof=0` yields `false`, `?dof=1` and bare `?dof` yield `true`, absent yields `null`, and the three are distinguishable because `null` means "defer to the tier".
18. `?lut` accepts only `off`, `identity` and `on`, and anything else falls back to `on`.
19. Unknown parameters are ignored, and `?quality=low` continues to be handled by `quality.ts` and is not consumed here.

---

## 13. Files touched

| File | Change |
| --- | --- |
| `src/art/grade.ts` | New. Pure. `GradeConfig`, `GRADE`, `IDENTITY_GRADE`, `gradeColour`, `buildLutData` |
| `src/art/grade.test.ts` | New. Properties 1-14 |
| `src/art/lut.ts` | New. `createGradeLut()` |
| `src/art/fx.ts` | New. Pure. `parseFxOverrides` |
| `src/art/fx.test.ts` | New. Properties 15-19 |
| `src/art/FarFieldDoF.ts` | New. `FarFieldDepthOfFieldEffect` |
| `src/art/PostFX.tsx` | Rewritten. Accepts a `player` prop. Hosts the focus driver and the dither setter |
| `src/art/quality.ts` | New fields per 10.1. `aoSamples` removed |
| `src/art/quality.test.ts` | Extended for the new fields |
| `src/App.tsx` | `<PostFX player={player} />`. `?nofx` moves to `fx.ts` |
| `README.md` | Document `?threshold`, `?ao`, `?dof`, `?bokeh`, `?ca`, `?lut`, `?probe`, `?bloomdebug` alongside `?nofx`. Delete the "~1.4" claim in the lighting note, which was never measured |

---

## 14. Handed off to other specs

Three requirements that this chain depends on and does not own.

**To materials.**
`emissive()` must normalise intensity by the luminance of its own colour, per section 5.4.
Without it, the bloom threshold is a lottery decided by hue, and it must land in the same commit as the measured threshold.

**To lighting.**
The reference's "darkest pixel of a white shell rarely below 28-35% luminance" is a property of the fill ratio, not of the grade.
Section 3.3 explains why this spec deliberately does not try to deliver it, and the AO change in section 6 raises the floor at contacts but not on shadowed faces.
If shadowed white plastic is still crushing after this chain lands, the ambient fill is the thing to raise.

**To the sky.**
If composer dithering does not fully clear the sky banding described in section 9.2, `SkyDome`'s fragment shader needs a `1/255` hash dither added before output.
Do not do this pre-emptively.
Try the free fix, photograph a real display, and only then reach for the shader.
