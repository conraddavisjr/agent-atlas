import {
  EffectComposer,
  Bloom,
  DepthOfField,
  LUT,
  N8AO,
  Vignette,
  SMAA,
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { fxOverrides } from './fx'
import { createGradeLut } from './lut'
import { BLOOM_INTENSITY, BLOOM_RADIUS, BLOOM_THRESHOLD } from './materials'
import { useQuality } from './useQuality'

/** Read once per session, as the tier table is. See `fx.ts`. */
const FX = fxOverrides()

/**
 * The grade cube, built exactly once.
 *
 * At module scope, not in the component, and that is not a style preference.
 * r3f's `<LUT>` memoises its effect on `[lut, ...restProps]` and `restProps` is
 * a fresh object identity on every render, so the `LUT3DEffect` is
 * reconstructed whenever `PostFX` re-renders. A stable `lut` reference makes
 * that reconstruction cheap instead of a 33,000-iteration rebuild plus a
 * texture upload every time the quality tier changes.
 *
 * It reads `?lut=off|identity|on` itself and returns null for `off`, so there
 * is no second copy of that parsing here to drift out of step.
 */
const GRADE_LUT = createGradeLut()

/**
 * Post-processing.
 *
 * **Ambient occlusion is off at all three tiers, and the pass below is wired,
 * tuned and unreachable by default.** That is the decision in
 * `docs/design/97-decision-shadow-end.md` item 9, and this comment records it
 * because the file used to argue the opposite at length and a file that argues
 * against its own configuration is worse than one with no comment at all.
 *
 * The case the old text made was that a world of grass, rocks and scatter needs
 * occlusion or every object reads as pasted onto the ground, and that no shadow
 * map fixes it because the contact is smaller than a texel. That is still the
 * right diagnosis. What was wrong was the choice of instrument. Three things
 * killed it, in the order they were established:
 *
 * 1. **It cannot be the frame's shadow end, arithmetically.** n8ao composites
 *    `mix(scene, color * scene, 1 - pow(visibility, intensity))`, so `color`
 *    sets a floor: `#8fa4cc` at linear luma 0.3675 puts a FULLY occluded pixel
 *    at 37% of its own value and no lower. On a lawn at 0.50 display luma the
 *    hardest contact this pass can draw is 0.35. Round 3 is about getting
 *    something to 0.10, and there is no setting of this pass that reaches it.
 * 2. **It costs about half the frame rate at high**, and half resolution was
 *    not enough to change that. The numbers, and the reason only the alternated
 *    ratio is evidence, are on `aoHalfRes` in `quality.ts`.
 * 3. **It cannot be composed.** Being screen-space it has no notion of which
 *    object a sample belongs to, so with the radius anywhere near blade height
 *    it projects the grass field's depth pattern onto whatever stands in the
 *    grass, hero included. See `aoRadius` below for that measurement.
 *
 * And it never delivered the two contacts it was kept for. Blade-to-ground is
 * baked into the grass's own vertex colours now (`Grass.tsx`, `CONTACT`: root at
 * 0.24 of the blade's own tint ramping to full over the bottom 34% of its
 * height, measured on a real frame at 0.377 at the roots against 0.516 at the
 * tips). Object bases it never reached, and the reason is geometry rather than
 * radius: a pylon is `pill(0.34, h - 0.68)`, a CAPSULE whose lower hemisphere is
 * tangent to a flat lawn at a single point, so there is no concave corner at a
 * pylon base for any occlusion pass to find - and the shallow pool it does draw
 * around the tangency sits inside a 0.75 m planting exclusion ring that is
 * itself hidden behind 0.16 to 0.45 m of lawn at every playing-height camera
 * angle. Round 2's F14 recorded the base as untreated while the pass was
 * running, and that is why.
 *
 * Where the pass WAS earning its cost, stated plainly because removing it is a
 * real loss and pretending otherwise is how a decision stops being checkable:
 * flat-on-flat stone junctions. Totem plinths on spur lobes, deck pucks on the
 * lawn, portal jambs flush on T3 - fillets of 0.05 to 0.12 m against a 0.28 m
 * radius, which is the one contact shape this pass is good at and the one the
 * grass ramp does not cover. That loss has never been measured. Item 3 of the
 * new anchor band - recessed apertures, kerb faces, riser faces - is what is
 * meant to replace it, and if it does not, this is the thing to re-measure
 * before blaming anything else.
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
      {/*
        False at every tier. `?gfx=ao` is the only thing that gets past this
        gate, and it reaches all three tiers together so that an A/B is not also
        a tier change. `?nogfx=ao` still wins if both are present.
      */}
      {quality.ambientOcclusion ? (
        <N8AO
          /*
            In world units, and deliberately just UNDER the height of the grass
            rather than equal to it.

            The scale the occlusion is meant to describe is blades against
            ground and pebbles against blades. Setting the radius AT blade
            height, which is what it was, means a character standing in the
            lawn is inside the occlusion radius of a few hundred blades, and
            n8ao is a screen-space pass with no notion of which object a sample
            belongs to - so the field's depth pattern is projected onto whatever
            is standing in it. Measured on a flat patch of the character's cheek
            in `hub-backlit`, where he stands in the lawn: 2.25 standard
            deviation with the pass off, 6.79 with it on at radius 0.5, 5.26 at
            0.28. On `hub-character`, where he stands on stone, the pass adds
            nothing at either radius. It is the grass.

            0.15 was measured too and reached 4.93, which is not worth what it
            costs: the radius also has to stay large enough to darken the
            blade-to-ground contact, which is a defect in its own right.
          */
          aoRadius={0.28}
          /*
            An exponent, not a multiplier, and it applies to VISIBILITY rather
            than to occlusion, which reverses the sign of everything one would
            assume about it. Verified in n8ao's own compositor:

              float finalAo = pow(texel.r, intensity);
              ...
              mix(sceneTexel.rgb, color * sceneTexel.rgb, 1.0 - finalAo)

            `texel.r` is 1 where nothing is occluded, so the darkening weight is
            `1 - pow(visibility, intensity)` and **raising the exponent darkens
            MORE, not less.** At visibility 0.8 an exponent of 2.0 gives a weight
            of 0.360 and 3.0 gives 0.488. It was raised to 3.0 to compensate for
            the lighter colour multiplier below, and that direction is right; the
            side effect is that it also stretches every small variation in the AO
            buffer, which is the other half of the crackle described under
            `aoRadius`.

            **The prose that stood here said "2.0 keeps most of the reach and
            measurably halves the artefact", and the prop said 3.0.** Both cannot
            be true and the code is what ran, so every standard deviation quoted
            in this block - 5.26 at radius 0.28, 4.93 at 0.15, 4.98 at half
            resolution - was measured at 3.0. Left at 3.0 deliberately, now that
            the pass is off by default: `?gfx=ao` exists to repeat a measurement,
            and it has to hand back the configuration that was measured rather
            than the one a comment recommended and nobody applied. If the pass is
            ever re-enabled for real, 2.0 is an untested hypothesis, not a
            finding.
          */
          intensity={3.0}
          distanceFalloff={0.6}
          /*
            Sample counts, named, because the preset this used to pass was a
            dead prop.

            The comment that stood here said `<N8AO>` calls `setQualityMode` in
            a layout effect and that passing a preset alongside `aoSamples`
            means the preset wins. That is not true of the version installed
            here: `@react-three/postprocessing`'s wrapper destructures
            `aoSamples`, `denoiseSamples`, `denoiseRadius`, `aoRadius`,
            `intensity`, `distanceFalloff` and `color`, hands them to
            `applyProps(pass.configuration, ...)`, and never calls
            `setQualityMode` at all - the string is not even one of the
            capitalised names n8ao's own `setQualityMode` matches on. So
            `quality={...}` set an inert key on the configuration object and the
            tier's AO setting had no effect at any tier, in either direction.

            What was actually running was the WRAPPER's defaults: 16 ambient
            samples denoised with 4. n8ao does not accumulate temporally unless
            asked (`accumulate` defaults false), so its jitter is a fixed
            pattern that never averages out - and 4 denoise samples do not clear
            it. That is the fine diagonal crackle that appeared on the character
            the moment anything on him started occluding: it was always in the
            AO buffer, and it only became visible when the ear pods stopped
            being buried inside the head and gave the pass something to occlude.
            Measured on a flat patch of cheek: 2.25 standard deviation with AO
            off against 6.79 with it on.
          */
          aoSamples={quality.aoSamples}
          denoiseSamples={quality.aoDenoiseSamples}
          /*
            Half resolution at medium AND high now. `depthAwareUpsampling` - on
            by default, stated here because half resolution is what makes it
            load-bearing - is what stops the upsample bleeding across depth
            discontinuities and haloing every silhouette. `low` has AO off
            entirely so the flag never reaches a pass.

            High used to pay full price "for the edge quality", and measurement
            does not support the trade. This pass is the single most expensive
            thing in the frame: at 1660x934, `hub-establishing`, high tier,
            73.4 fps mean and 50.5 p95 with AO off against 46.3 and 17.9 with it
            on full-resolution. Two thirds of the p95 frame time, for one
            effect, against targets of 55 and 45.

            Half resolution measures 48.5 and 31.4, and it is not a quality
            sacrifice here: the crackle on the character's shell reads 4.98
            standard deviation half-res against 5.26 full-res, because the
            depth-aware upsample softens the very sampling pattern that is the
            artefact. Cheaper and slightly better, so there is nothing to
            weigh.

            It still does not reach the targets, and the decision that sentence
            deferred has now been taken: **the thing that changed is that the
            pass came out.** Off at all three tiers, so `halfRes` never reaches a
            pass at all today.

            Re-measured after the grass-shadow fix, three alternating runs each
            at 1660x934 on `hub-establishing` at high: 35.9 / 21.0 / 31.3 mean
            fps with AO on against 74.2 / 61.7 / 59.9 with it off, p95 11.5 /
            9.5 / 10.0 against 21.9 / 22.4 / 15.6. No overlap in either column,
            and about half the frame rate. Absolute fps from that machine is not
            trustworthy - one configuration read 65.5 mean in one session and 21
            to 36 twenty minutes later with nothing changed - so the alternated
            ratio is the only part of that which is evidence, and it is enough.

            Every number in this block is kept rather than deleted because they
            are the four findings that would otherwise be rediscovered one
            expensive session at a time, and because `?gfx=ao` has to hand the
            pass back the configuration that was measured. Half resolution is
            part of that configuration: it is cheaper AND slightly better here,
            which is a conclusion no future reader would guess.
          */
          halfRes={quality.aoHalfRes}
          depthAwareUpsampling
          /*
            World units, not screen space, so occlusion does not change scale as
            the camera dollies. Stated explicitly because the default is the one
            we want and a future reader should not have to check.
          */
          screenSpaceRadius={false}
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

        THE THRESHOLD WAS NEVER THE WHOLE STORY. With it measured and every
        emissive normalised against it, `hub-totem`'s completion ring renders a
        genuine (246,235,178) - it is over the line - and the deck two pixels
        behind it is unchanged. There was no halo to see, because `radius` and
        `intensity` had been dialled down from their defaults and `radius` on a
        mipmap bloom is a blend weight rather than a kernel width. At 0.6 the
        wide mips that make a halo were carrying 12.8% of the bloom; at 0.85 they
        carry 52.2%. Both numbers, and the arithmetic behind the pairing with
        `intensity`, are in materials.ts beside the threshold, because they are
        one budget and had already drifted apart once.

        `levels` is left to the tier. It is the cheapest dial in the chain -
        each level halves both dimensions, so one more costs a quarter of the one
        before - and with `radius` at 0.85 the coarsest level carries
        `0.85^(levels-1)` on its own, so a tier with fewer levels still gets a
        wide glow rather than no glow.
      */}
      <Bloom
        intensity={FX.bloomDebug ? 6 : BLOOM_INTENSITY}
        luminanceThreshold={FX.bloomThreshold ?? BLOOM_THRESHOLD}
        luminanceSmoothing={FX.bloomDebug ? 0 : 0.25}
        mipmapBlur
        radius={BLOOM_RADIUS}
        levels={quality.bloomLevels}
      />

      <Vignette offset={0.25} darkness={0.28} />

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

        It shipped as an IDENTITY first, which was the whole rollout discipline
        in one decision: the transport was proved correct by a commit that
        changed nothing, so if the graded build looks wrong the bug is provably
        in the constants rather than in the cube layout or the colour space.
        `?lut=off|identity|on` still makes all three comparable in one session
        without a rebuild.

        `HueSaturation` and `BrightnessContrast` are gone, deleted in the same
        commit that switched this to the real grade. The LUT does everything
        they did and more - a per-channel S-curve rather than a linear pivot, a
        chroma boost weighted to the midtones rather than a flat multiplier, and
        a split tone neither of them could express - in ONE texture fetch inside
        a shader that already runs, against their two merged function calls. It
        is cheaper than what it replaces, which is exactly why it can be on at
        the bottom tier where the palette needs the most help.
      */}
      {quality.colourGrade && GRADE_LUT ? (
        <LUT
          lut={GRADE_LUT}
          /*
            False, and this is the cheaper of the two. Tetrahedral forces
            NearestFilter on the texture and does a four-tap manual
            interpolation in the shader. It exists for LUTs with sharp
            discontinuities, typically imported from a colourist's .cube file.
            Ours is a smooth analytic function sampled on a regular grid, which
            is exactly the case hardware trilinear reconstructs almost exactly,
            so this would cost three extra texture fetches per pixel for no
            visible gain.
          */
          tetrahedralInterpolation={false}
        />
      ) : (
        <></>
      )}

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
