import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  DepthOfField,
  HueSaturation,
  N8AO,
  Vignette,
  SMAA,
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { fxOverrides } from './fx'
import { BLOOM_THRESHOLD } from './materials'
import { useQuality } from './useQuality'

/** Read once per session, as the tier table is. See `fx.ts`. */
const FX = fxOverrides()

/**
 * Post-processing.
 *
 * Ambient occlusion is the headline change here, and it reverses a decision
 * this file used to state outright. The original comment rejected SSAO because
 * it costs a real slice of the frame budget on integrated graphics and the
 * tight shadow camera was providing enough contact shadowing on its own. That
 * was true of a world made of a dozen large primitives. It stopped being true
 * the moment the ground filled with grass, rocks and scatter: without occlusion
 * every one of those objects reads as pasted onto the ground rather than
 * sitting in it, and no amount of shadow map resolution fixes that, because the
 * contact is smaller than a texel.
 *
 * The reversal is tier-gated rather than unconditional, which is the part that
 * makes it affordable. The bottom tier still gets the old behaviour.
 *
 * Order matters and is not alphabetical. Occlusion goes first, because it is a
 * property of the scene rather than of the image and must be applied while the
 * frame still is the scene. Bloom then sees the world as it will actually be
 * lit. Tone mapping is the boundary: everything above it is light, everything
 * below it is a picture, which is why antialiasing is the last thing in the
 * chain rather than an early one.
 *
 * Two structural notes on cost, because they decide what may be added later.
 * r3f's composer merges consecutive non-convolution effects into one pass, so
 * adding another one of those costs a function call in a fragment shader that
 * already runs. A convolution effect gets a pass of its own and costs a
 * full-screen read and write. SMAA and chromatic aberration are convolutions;
 * bloom, the vignette, tone mapping and a LUT are not.
 */
export function PostFX() {
  const quality = useQuality()

  return (
    /*
      No normal pass.

      It used to be enabled wherever AO was, on the stated reasoning that N8AO
      needs scene normals. It does not. r3f's <N8AO> constructs
      `new N8AOPostPass(scene, camera)` and never reads `normalPass` or
      `downSamplingPass` off the composer context; N8AOPostPass derives normals
      from its own depth pre-pass. The composer's NormalPass is consumed by
      <SSAO> alone, which errors when it is null, and we do not use it.

      So the prop was rendering every object in the scene a second time, every
      frame, on medium and high, into a buffer nothing sampled. Verified in
      node_modules/@react-three/postprocessing/dist/index.js: the composer
      creates the NormalPass only when `enableNormalPass` is set and enables it
      in the same layout effect that builds the passes, and the only consumer of
      the context's `normalPass` in the whole file is the SSAO component.
    */
    <EffectComposer multisampling={0}>
      {quality.ambientOcclusion ? (
        <N8AO
          // In world units. Roughly the height of the grass, which is the scale
          // the occlusion is actually meant to describe: blades against ground,
          // pebbles against blades. Much larger and it turns into a grey wash
          // under every object instead of a contact shadow.
          aoRadius={0.5}
          /*
            An exponent, not a multiplier: N8AO applies `pow(ao, intensity)`.
            Raised from 2.2 because the colour below is now a far lighter
            multiplier, which weakens the effect substantially, and this is what
            restores the reach it had.
          */
          intensity={3.0}
          distanceFalloff={0.6}
          /*
            The preset, straight from the tier, rather than derived from a
            sample count. `<N8AO>` applies `aoSamples` in one layout effect and
            calls `setQualityMode` in a later one, so passing both means the
            preset silently overwrites the count and the number in the source is
            not the number in the build. Pass one or the other, never both.
          */
          quality={quality.aoQuality}
          /*
            This is a MULTIPLIER, not a shadow colour, and the comment it
            replaces had the mechanism backwards.

            N8AO composites as `mix(scene, color * scene, 1 - ao)` with
            `colorMultiply` true by default, so `color` multiplies the surface's
            own colour per channel. The previous #2a3550 linearises to about
            (0.024, 0.037, 0.087), which put a fully occluded pixel at 2.4% of
            its own red and 8.7% of its own blue. That is not a tinted shadow,
            it is very nearly black, and it is exactly the "ambient occlusion
            looks like dirt" failure the reference brief warns about.

            #8fa4cc linearises to (0.275, 0.371, 0.604): a fully occluded
            contact lands at 37% of the surface's own value with a blue-to-red
            ratio of 2.2 to 1, so it is clearly chromatic, clearly cool, and
            stays inside the reference's "rarely below 28 to 35% luminance"
            diagnostic. The hue is the shadow end of the hub palette, between
            skyTop and rockDeep.

            Do not set colorMultiply false. That replaces the occluded surface
            with a flat colour regardless of its albedo, which turns every
            contact into the same colour and destroys the material read exactly
            where materials meet.
          */
          color="#8fa4cc"
        />
      ) : (
        <></>
      )}

      {/*
        Depth of field slot.

        Off at every tier, and the field it reads is off at every tier, so this
        renders nothing today. It is wired rather than absent so that turning it
        on is a one-line change in quality.ts by whoever also produces the A/B
        pair it has to pass.

        Two things about it are already decided and belong here rather than in a
        commit message. It sits before bloom, so that a defocused highlight
        blooms as the wide dim smear it physically is rather than as the sharp
        spike it was. And the near field has to be deleted rather than reduced:
        with a camera three metres above the player looking slightly down, the
        ground at the bottom of the frame is routinely a third of the focus
        distance away, so a naive setup blurs exactly the ledge the player is
        lining a jump up on. That is a gameplay regression, not an aesthetic
        one, and no value of focusRange fixes it because the near circle of
        confusion is only zero behind the focus plane.

        The values below are the spec's, and the focus distance is a placeholder
        until the frame-by-frame driver exists.
      */}
      {quality.depthOfField ? (
        <DepthOfField focusDistance={7.7} focusRange={26.3} bokehScale={1.2} resolutionScale={0.5} />
      ) : (
        <></>
      )}

      {/*
        The threshold sits above the brightest lit diffuse surface, not at 1.0.
        Bloom runs before tone mapping and therefore sees raw HDR values, so a
        threshold of 1.0 catches ordinary lit geometry and hazes the entire
        world. Only the `emissive` material preset is meant to cross this line.

        The number itself now comes from materials.ts, which is the file that has
        to divide by it. Both files needed the same constant and both were
        writing it down separately, which is how this file came to be masking at
        1.75 while materials.ts documented that an intensity above 1 was enough
        to cross it. It is measured with ?threshold and ?bloomdebug rather than
        argued about.

        `levels` is the cheapest dial in the chain. Each level halves both
        dimensions, so the marginal cost of one is a quarter of the one before
        it, and dropping levels gives a tighter, less wide glow rather than a
        different exposure.

        ?bloomdebug turns the threshold into a hard binary mask: smoothing to
        zero so nothing ramps, and intensity to 6 so whatever crosses is
        unmistakable. It stays because it is the fastest way to re-check the
        measurement after any change to the light rig.

        The threshold has now been MEASURED and is 1.45, inside the 1.2 to 1.6
        prediction on record. The full distribution and the reasoning live in
        materials.ts, which owns the constant. `luminanceSmoothing` comes down
        0.30 to 0.25 with it: the wider ramp existed to hide the mismatch
        between a guessed threshold and the values actually in the frame, and
        with the threshold measured there is no mismatch left to hide. A
        tighter ramp keeps what does cross compact rather than hazy.
      */}
      <Bloom
        intensity={FX.bloomDebug ? 6 : 0.55}
        luminanceThreshold={FX.bloomThreshold ?? BLOOM_THRESHOLD}
        luminanceSmoothing={FX.bloomDebug ? 0 : 0.25}
        mipmapBlur
        radius={0.6}
        levels={quality.bloomLevels}
      />

      {/*
        Grading. Small numbers doing a lot of work: a touch of saturation to
        keep the palette from going muddy once occlusion is darkening it, and a
        little contrast to put some snap back after tone mapping rolls the
        highlights off.
      */}
      <HueSaturation hue={0} saturation={0.08} />
      <BrightnessContrast brightness={0.01} contrast={0.06} />

      <Vignette offset={0.3} darkness={0.42} />

      {/*
        The boundary. Everything above this line is light, everything below it
        is a picture.
      */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />

      {/*
        LUT slot. PLACEHOLDER: renders nothing, deliberately.

        The grade goes here, after tone mapping, and that position is not
        negotiable. LUT3DEffect clamps its input to [0, 1] before sampling, so
        placed before tone mapping every pixel above 1.0 would sample the same
        corner of the cube and the clearcoat highlights, the sun glow and every
        emissive in the game would map to one identical colour. It also declares
        `inputColorSpace = SRGBColorSpace`, which makes the effect merger insert
        the sRGB round trip around it automatically, so what the grade sees is a
        display-encoded triple in [0, 1], which is the domain a grade is
        authored in.

        Nothing is placed after it inside this merged pass, for the same reason:
        the round trip closes at the end of the pass, so anything following the
        LUT would silently be handed sRGB-encoded values. The two effects after
        it are in passes of their own.

        The grade itself lives in src/art/lut.ts, which builds the cube from a
        pure function and currently ships as an identity. Wiring it is a
        separate commit and a deliberate one, because its acceptance test is a
        screenshot diff whose expected result is not zero: an 8-bit 32-entry
        identity LUT quantises each grid value and reconstructs between them by
        hardware trilinear interpolation, so the criterion is at most 2/255
        maximum error, 0.5/255 mean, and no structure at all in the amplified
        difference. That last clause is the one that catches real bugs, because
        a transposed channel index produces a small mean error and a completely
        structured difference image.

        When it lands, this becomes <LUT> with the texture built once at module
        scope, and HueSaturation and BrightnessContrast are deleted in the same
        commit, because the LUT subsumes both in a single fetch and is therefore
        cheaper than what it replaces.
      */}
      {quality.colourGrade ? <></> : <></>}

      {/*
        Last, and this is a correction rather than a preference.

        SMAA used to sit before tone mapping, where its colour edge detection ran
        on unbounded HDR values. A specular hit at 6.0 next to lit plastic at 0.8
        is a colour difference of 5.2 against a detection threshold of 0.1, so
        effectively every such boundary was flagged and blended, while genuine
        geometric edges down in the shadows fell below the threshold and were
        missed entirely. Antialiasing is an operation on the displayed image, so
        it belongs after the image exists.
      */}
      <SMAA />
    </EffectComposer>
  )
}
