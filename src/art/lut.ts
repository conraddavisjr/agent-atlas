import { LookupTexture } from 'postprocessing'

/**
 * The colour grade, as a procedurally generated 3D lookup texture.
 *
 * The whole grade - contrast, lift, gain, gamma, a split tone and a chroma
 * boost - collapses into one texture fetch in a shader that already runs. That
 * is why this replaces `HueSaturation` and `BrightnessContrast` rather than
 * joining them: it does strictly more, for strictly less, which is what lets it
 * stay enabled on the bottom tier where the palette needs the most help.
 *
 * The project ships no external assets and has no `.cube` loader, so the cube is
 * built in code from a pure function. That turns out to be the better trade
 * anyway: a `.cube` file is 33,000 numbers nobody can review, whereas eight
 * named constants and forty lines of arithmetic can be read, argued with and
 * unit tested. Everything above `createLookupTexture` is pure and runs under
 * node with no DOM and no WebGL, which is what `lut.test.ts` exercises.
 *
 * Where it sits in the chain, and why that is not negotiable:
 *
 *   The grade runs AFTER tone mapping. `LUT3DEffect`'s fragment shader can only
 *   see values in [0, 1] - the 3D sampler's ClampToEdgeWrapping enforces it even
 *   in the path that skips the explicit clamp - so placed before ACES, every
 *   clearcoat highlight, every emissive and the sun glow on the sky dome would
 *   all sample the same corner of the cube and the highlight rolloff ACES exists
 *   to produce would be destroyed before ACES ever ran.
 *
 *   And a grade is a set of statements about the picture. "Lift the blacks by
 *   3%" means 3% of the displayed range; in scene-referred radiance those words
 *   have no stable meaning, because the mapping to a displayed value has not
 *   been chosen yet.
 *
 * Verified against postprocessing@6.39.4 in `node_modules`, because every one of
 * these would fail silently rather than loudly:
 *
 *   `LookupTexture extends Data3DTexture` with a public `constructor(data,
 *   size)`, and the constructor sets `type`, `format`, `minFilter`, `magFilter`,
 *   all three wrap modes, `unpackAlignment`, `needsUpdate`, `domainMin/Max` and
 *   `colorSpace` itself. None of them may be touched here. `colorSpace` in
 *   particular must stay at its default of `LinearSRGBColorSpace`: `LUT3DEffect`
 *   never reads it, but three does, and setting it to sRGB would request an
 *   `SRGB8_ALPHA8` internal format and apply a hardware decode on every fetch on
 *   top of the one the shader already performs.
 *
 *   `LookupTexture.createNeutral` indexes its data as `(r + g*size +
 *   b*size*size) * 4`, so red is the fastest-varying axis. Confirmed by probing
 *   a real `createNeutral(4)`: the cell at (3,0,0) reads (1,0,0). Getting this
 *   wrong produces an image that looks plausibly graded with its channels
 *   transposed, which is the hardest bug in this file to see by eye and is why
 *   `lut.test.ts` asserts it against an independently written reference loop.
 *
 *   `LUT3DEffect`'s `inputColorSpace` defaults to `SRGBColorSpace`. The effect
 *   merger therefore emits `sRGBTransferOETF` immediately before the LUT's
 *   `mainImage` and closes with `sRGBToLinear` at the end of the pass, so the
 *   value handed to us is already display-encoded sRGB in [0, 1] and our output
 *   is read back the same way. `gradeColour` maps sRGB to sRGB, and
 *   `convertLinearToSRGB()` must therefore NOT be called - doing so would encode
 *   a second time and wash the entire image out.
 *
 *   `convertToUint8()` maps `uint8 = float * 255 + 0.5` and flips `type` to
 *   `UnsignedByteType`. It is called, and it is called last. Two reasons, and
 *   the second is the load-bearing one: it is a quarter of the memory, 128 KB
 *   rather than 512 KB; and hardware linear filtering of a FLOAT 3D texture
 *   requires `OES_texture_float_linear`, which is not universally available,
 *   whereas an 8-bit LUT filters correctly everywhere with no extension and no
 *   fallback path to get wrong.
 *
 * One consequence of that quantisation is worth stating loudly, because the
 * naive expectation of it is wrong and would produce a false failure: an 8-bit
 * 32-cubed identity LUT is NOT bit-exact. Grid values are quantised to
 * `round(x * 255) / 255` and everything between them is reconstructed by
 * hardware trilinear interpolation of those quantised neighbours. The stated
 * acceptance tolerance is a maximum per-channel difference of 2/255 and a mean
 * of 0.5/255, with no structure in a 32x amplified diff. `lut.test.ts` models
 * that reconstruction and asserts against those numbers, not against zero.
 */

/** A per-channel constant. Readonly so a config can never be mutated in place. */
export type GradeVec3 = readonly [number, number, number]

export type GradeConfig = {
  /** Filmic S-curve strength. 0 is a straight line, 1 is a full smoothstep. */
  contrast: number
  /** Per-channel black floor. */
  lift: GradeVec3
  /** Per-channel white ceiling. */
  gain: GradeVec3
  /** Per-channel midtone gamma. Applied as `x ** (1 / gamma)`, so above 1 brightens. */
  gamma: GradeVec3
  /** Added to shadows, weighted by `(1 - luma) ** toneWeightExponent`. */
  shadowTint: GradeVec3
  /** Added to highlights, weighted by `luma ** toneWeightExponent`. */
  highlightTint: GradeVec3
  /** How sharply the split tone concentrates at the two ends of the range. */
  toneWeightExponent: number
  /** Peak saturation multiplier, reached at luma 0.5 and falling to 1.0 at both ends. */
  midSaturation: number
}

/*
  Every constant below is exported on its own so that a reviewer can find the one
  number responsible for a thing they do not like, and so that a test can name it
  rather than reaching into an object literal.
*/

/**
 * Rec.709 luminance weights, matching the ones Bloom's threshold uses.
 *
 * Shared deliberately. The grade's idea of "this pixel is a shadow" and the
 * bloom mask's idea of "this pixel is bright" have to be the same idea, or the
 * split tone will be cooling pixels the bloom pass considers highlights.
 */
export const LUMA_709: GradeVec3 = [0.2126, 0.7152, 0.0722]

/**
 * The second S-curve, on top of the one ACES already applied.
 *
 * Deliberately small. It is applied per channel rather than on luminance, which
 * is what gives it a little of the chroma crossover a real film curve has: a
 * saturated colour gains a touch of contrast in its dominant channel and less in
 * the others, so it gets richer rather than merely darker. It replaces the
 * `BrightnessContrast contrast: 0.06` this file's LUT removes, and it is larger
 * than that number because a per-channel S is gentler than a linear pivot.
 */
export const GRADE_CONTRAST = 0.14

/**
 * The black floor, per channel.
 *
 * Blue is highest, so absolute black lands at roughly 6/255 of blue against
 * 2/255 of red. This is what stops shadows being a dead neutral hole, and the
 * amount is chosen to be the smallest that reads: a grade that lifted black to
 * the 28-35% the reference brief measures on Astro shells would fog the whole
 * frame into grey mud. That figure is a property of the lighting rig's fill
 * ratio and belongs to `Lighting.tsx`, not here.
 */
export const GRADE_LIFT: GradeVec3 = [0.034, 0.034, 0.04]

/**
 * The white ceiling, per channel.
 *
 * Red is untouched and blue is pulled down 1.6%, which after the split tone puts
 * pure white at `#fffcf3`. Highlights carry the sun's warmth, which is the half
 * of a split tone that people notice least and miss most.
 */
export const GRADE_GAIN: GradeVec3 = [1.0, 0.996, 0.984]

/**
 * Midtone gamma, per channel. Above 1 brightens that channel's midtones.
 *
 * Green and blue are lifted very slightly so the mid-range stays cool while the
 * gain keeps the top end warm. The two ends therefore diverge in hue without the
 * midtones drifting, which is exactly what the split tone below cannot do on its
 * own because its weights vanish at luma 0.5.
 */
export const GRADE_GAMMA: GradeVec3 = [1.0, 1.01, 1.03]

/**
 * Cool into the shadows. Red down, blue up, green barely moved.
 *
 * This is the single most visible constant in the file. It is also what tints
 * the vignette for free: the vignette runs before tone mapping, so the corners
 * it darkens arrive here further down the tonal range, pick up more shadow
 * weight, and come out cooler than frame centre by an amount that tracks the
 * vignette exactly. `VignetteEffect` has no colour input, so this is the
 * mechanism, and it stays consistent with every other shadow in the frame when
 * the grade is retuned.
 */
export const GRADE_SHADOW_TINT: GradeVec3 = [-0.03, -0.012, 0.018]

/**
 * Warm into the highlights. Blue down hard, green a little, red held.
 *
 * Pulling blue down rather than pushing red up is what keeps this from clipping:
 * the highlights it acts on are already near the ceiling, so there is room below
 * and none above.
 */
export const GRADE_HIGHLIGHT_TINT: GradeVec3 = [0.0, -0.006, -0.03]

/**
 * How fast the two tints fall off toward mid grey.
 *
 * At 2 the shadow weight is `(1 - luma)^2`, so mid grey receives a quarter of
 * the tint and the two tints cross without cancelling into a visible band. Lower
 * and the tint spreads into the midtones and reads as a colour cast; higher and
 * it only ever touches the extremes, where nobody looks.
 */
export const GRADE_TONE_WEIGHT_EXPONENT = 2

/**
 * Peak chroma multiplier, at luma 0.5.
 *
 * Replaces `HueSaturation saturation: 0.08`, and is a larger number because it
 * is weighted rather than flat, so its average effect across a frame is smaller.
 * The shape is the whole point: the weight `4L(1-L)` is zero at both ends, so
 * this does nothing at all to the shadow floor or to a blown highlight and
 * therefore cannot produce the clipped, electric-edged saturation a flat
 * multiplier produces on a palette with this much chroma in it.
 */
export const GRADE_MID_SATURATION = 1.18

/** The shipping grade. */
export const GRADE: GradeConfig = {
  contrast: GRADE_CONTRAST,
  lift: GRADE_LIFT,
  gain: GRADE_GAIN,
  gamma: GRADE_GAMMA,
  shadowTint: GRADE_SHADOW_TINT,
  highlightTint: GRADE_HIGHLIGHT_TINT,
  toneWeightExponent: GRADE_TONE_WEIGHT_EXPONENT,
  midSaturation: GRADE_MID_SATURATION,
}

/**
 * A grade that does nothing, exactly.
 *
 * Not a convenience. The rollout discipline requires the LUT to land as an
 * identity and be verified before a single constant is dialled, so that if the
 * graded build then looks wrong the bug is provably in the constants rather than
 * in the transport. The `!== 0` and `!== 1` guards in `gradeColour` are what
 * make this a bit-exact identity in floating point: `l + (c - l) * 1` is not
 * guaranteed to return `c`, and a tolerance in an identity test is how a real
 * error hides.
 */
export const IDENTITY_GRADE: GradeConfig = {
  contrast: 0,
  lift: [0, 0, 0],
  gain: [1, 1, 1],
  gamma: [1, 1, 1],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  toneWeightExponent: GRADE_TONE_WEIGHT_EXPONENT,
  midSaturation: 1,
}

function clamp01(x: number): number {
  // Written as two comparisons rather than min/max so that NaN, which fails both,
  // falls through to 0 rather than propagating into `Math.pow` and poisoning the
  // whole cube from one bad constant.
  return x > 1 ? 1 : x > 0 ? x : 0
}

/**
 * The grade itself. Pure, sRGB-encoded in and sRGB-encoded out, over 0-1.
 *
 * The order of the four steps is load-bearing and each one is where it is for a
 * reason that is not "it looked fine there".
 */
export function gradeColour(
  r: number,
  g: number,
  b: number,
  cfg: GradeConfig = GRADE,
): [number, number, number] {
  // Clamped on the way in as well as on the way out. `Math.pow` of a negative
  // base with a fractional exponent is NaN, and a single NaN in the cube uploads
  // as a black cell that shows up as one flickering pixel value in the sky.
  const c: [number, number, number] = [clamp01(r), clamp01(g), clamp01(b)]

  /*
    1. The filmic S-curve, per channel.

    `x + k * (smoothstep(0,1,x) - x)`. Fixed points at 0, 0.5 and 1, so it cannot
    move black, white or mid grey, and it is provably monotone for k in [0, 1]:
    the derivative is `1 + k*(6x(1-x) - 1)`, whose minimum over the unit interval
    is `1 - k`. Monotonicity is not a nicety here. It is the property that stops
    the grade inverting tonal order, and inverted tonal order is a greyscale
    readability failure that is invisible in colour.
  */
  if (cfg.contrast !== 0) {
    for (let i = 0; i < 3; i++) {
      const x = c[i]
      c[i] = x + cfg.contrast * (x * x * (3 - 2 * x) - x)
    }
  }

  /*
    2. Lift and gain, then gamma.

    After the curve rather than before it, so the black floor the grade promises
    is the floor that actually survives to the output. Run first, the S-curve
    would pull the lifted black back toward zero and the constant would be a lie.
  */
  for (let i = 0; i < 3; i++) {
    c[i] = clamp01(cfg.lift[i] + c[i] * (cfg.gain[i] - cfg.lift[i]))
    if (cfg.gamma[i] !== 1) c[i] = Math.pow(c[i], 1 / cfg.gamma[i])
  }

  /*
    3. Mid-chroma saturation.

    The weight `4L(1-L)` peaks at luma 0.5 and is exactly zero at both ends. That
    is what "boosted mid-chroma" means, and it is also what stops the boost
    pushing a near-white or near-black pixel out of gamut, since a channel can
    only be pushed away from luma by an amount proportional to how far it already
    is, scaled by a factor that vanishes precisely where there is no headroom.
  */
  if (cfg.midSaturation !== 1) {
    const l = clamp01(LUMA_709[0] * c[0] + LUMA_709[1] * c[1] + LUMA_709[2] * c[2])
    const s = 1 + (cfg.midSaturation - 1) * 4 * l * (1 - l)
    for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * s
  }

  /*
    4. The split tone. Cool shadows, warm highlights.

    Last, and after saturation rather than before it, so the tint constants mean
    exactly what they say instead of being silently rescaled by a chroma boost
    downstream. Luma is recomputed here rather than reused from step 3 because
    step 3 has moved the channels, and weighting the tint by a stale luma is how
    a saturated dark blue ends up receiving highlight tint.
  */
  const l = clamp01(LUMA_709[0] * c[0] + LUMA_709[1] * c[1] + LUMA_709[2] * c[2])
  const sw = Math.pow(1 - l, cfg.toneWeightExponent)
  const hw = Math.pow(l, cfg.toneWeightExponent)
  for (let i = 0; i < 3; i++) c[i] += cfg.shadowTint[i] * sw + cfg.highlightTint[i] * hw

  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
}

/**
 * Side length of the cube.
 *
 * 32 is `32**3 * 4 * 4` bytes, so 512 KB of transient `Float32Array` during the
 * build and 128 KB uploaded once quantised. The build is about 33,000 iterations
 * of forty floating-point operations and finishes in single-digit milliseconds,
 * which is why it runs at module scope with no loading state and no Suspense.
 * 16 would be visibly steppy on the smooth gradients this grade produces in the
 * sky, which is the largest smooth area in the game. 64 is 1 MB of texture for a
 * difference nobody can see.
 */
export const LUT_SIZE = 32

/**
 * The cube, as float RGBA in the exact layout `LookupTexture` expects.
 *
 * The index expression is copied from `LookupTexture.createNeutral`. Red is the
 * fastest-varying axis, so the loop nests blue outermost purely to write the
 * array front to back; the index is computed explicitly, so the nesting is a
 * cache courtesy rather than a correctness requirement.
 */
export function buildLutData(size: number = LUT_SIZE, cfg: GradeConfig = GRADE): Float32Array {
  const data = new Float32Array(size ** 3 * 4)
  const sizeSq = size ** 2
  const s = 1 / (size - 1)
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const graded = gradeColour(r * s, g * s, b * s, cfg)
        const i4 = (r + g * size + b * sizeSq) * 4
        data[i4 + 0] = graded[0]
        data[i4 + 1] = graded[1]
        data[i4 + 2] = graded[2]
        data[i4 + 3] = 1
      }
    }
  }
  return data
}

/**
 * The same cube, quantised to 8 bits.
 *
 * Byte for byte what `LookupTexture.convertToUint8()` produces, and `lut.test.ts`
 * asserts that against a real `LookupTexture` rather than trusting the comment.
 * It exists separately because it is the form a test can assert range and
 * wraparound properties on without a GL context, and because it is the form
 * anyone debugging a suspected transposition will want to print.
 *
 * The clamp is the interesting part. `convertToUint8` writes into a `Uint8Array`
 * with no clamping of its own, and `Uint8Array` assignment truncates modulo 256
 * rather than saturating - so a channel of 1.002 would become 256, wrap to 0, and
 * put a black cell at the white corner of the cube. `gradeColour` already clamps
 * to [0, 1] so this can never fire, and it is here anyway because the failure it
 * guards is a wraparound rather than a clip, which is unrecoverable rather than
 * merely wrong.
 */
export function buildLut(size: number = LUT_SIZE, cfg: GradeConfig = GRADE): Uint8Array {
  const float = buildLutData(size, cfg)
  const data = new Uint8Array(float.length)
  for (let i = 0; i < float.length; i++) {
    const q = Math.floor(float[i] * 255 + 0.5)
    data[i] = q < 0 ? 0 : q > 255 ? 255 : q
  }
  return data
}

/**
 * Which grade the build ships with.
 *
 * `off` means no LUT effect at all, `identity` means the full transport with a
 * grade that does nothing, `on` means the shipping grade. All three exist at
 * once so the three states are comparable in a single session without a rebuild,
 * which is the only way the identity acceptance diff is cheap enough to actually
 * run.
 */
export type LutMode = 'off' | 'identity' | 'on'

/**
 * What ships when no override is present.
 *
 * `identity` deliberately. The rollout requires the LUT to land as a no-op and
 * be verified at max 2/255 with no structure in the amplified diff before a
 * single constant is dialled. Flipping this one identifier to `on` is the
 * entirety of the follow-up commit, and if the graded build then looks wrong the
 * transport was already proved correct by a commit that changed nothing.
 */
export const DEFAULT_LUT_MODE: LutMode = 'identity'

/**
 * `?lut=off|identity|on`.
 *
 * Pure, and takes the search string rather than reading `location` itself, so it
 * is testable in the node environment. Anything unrecognised falls back to the
 * default rather than throwing: a diagnostic flag that can break the build by
 * being mistyped is worse than no diagnostic flag.
 */
export function resolveLutMode(search: string): LutMode {
  const value = new URLSearchParams(search).get('lut')
  return value === 'off' || value === 'identity' || value === 'on' ? value : DEFAULT_LUT_MODE
}

/** The mode this session is running, resolved once. */
export const LUT_MODE: LutMode =
  typeof location === 'undefined' ? DEFAULT_LUT_MODE : resolveLutMode(location.search)

/** The config a mode selects, or null when the effect should not be built at all. */
export function gradeForMode(mode: LutMode): GradeConfig | null {
  return mode === 'off' ? null : mode === 'identity' ? IDENTITY_GRADE : GRADE
}

/**
 * The uploadable texture. Null when the mode is `off`.
 *
 * Call this ONCE, at module scope, never inside a component. r3f's `<LUT>`
 * memoises its effect on `[lut, restProps]` and `restProps` is a fresh object
 * identity on every render, so the `LUT3DEffect` is reconstructed whenever the
 * host component re-renders. A stable `lut` reference is what makes that
 * reconstruction cheap instead of a 33,000-iteration rebuild plus a texture
 * upload every time the quality tier changes.
 */
export function createLookupTexture(mode: LutMode = LUT_MODE): LookupTexture | null {
  const cfg = gradeForMode(mode)
  if (cfg === null) return null

  const lut = new LookupTexture(buildLutData(LUT_SIZE, cfg), LUT_SIZE)
  lut.name = `agent-atlas-grade-${mode}`
  // Lossy, and deliberately the last thing done to the data. See the file header
  // for why 8 bits rather than float, and note that this is a no-op unless
  // `type` is still `FloatType`, which is why nothing above may touch `type`.
  lut.convertToUint8()
  // NOT convertLinearToSRGB(). `LUT3DEffect.inputColorSpace` defaults to
  // SRGBColorSpace, so the merged pass hands us sRGB-encoded values and reads our
  // output back as sRGB-encoded. `gradeColour` already works in that domain, and
  // converting here would encode a second time and wash the whole image out.
  return lut
}

/** Spec name for {@link createLookupTexture}, kept so `PostFX.tsx` can use either. */
export const createGradeLut = createLookupTexture
