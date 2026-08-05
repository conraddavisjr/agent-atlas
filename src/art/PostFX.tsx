import {
  EffectComposer,
  Bloom,
  BrightnessContrast,
  HueSaturation,
  N8AO,
  Vignette,
  SMAA,
  ToneMapping,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useQuality } from './useQuality'

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
 * Order matters and is not alphabetical. Occlusion goes first so it darkens
 * geometry before anything samples brightness. Bloom then sees the world as it
 * will actually be lit. Grading sits after bloom so it shapes the final image
 * rather than feeding the threshold. Tone mapping is last, as it always was.
 */
export function PostFX() {
  const quality = useQuality()

  return (
    <EffectComposer
      multisampling={0}
      // N8AO needs scene normals. Enabling the pass unconditionally would cost
      // a full extra render of the scene on the tier that has AO turned off.
      enableNormalPass={quality.ambientOcclusion}
    >
      {quality.ambientOcclusion ? (
        <N8AO
          // In world units. Roughly the height of the grass, which is the scale
          // the occlusion is actually meant to describe: blades against ground,
          // pebbles against blades. Much larger and it turns into a grey wash
          // under every object instead of a contact shadow.
          aoRadius={0.5}
          intensity={2.2}
          distanceFalloff={0.6}
          quality={quality.aoSamples >= 16 ? 'medium' : 'low'}
          // Colour bounced back into occluded areas. Pure black occlusion is
          // what makes AO look like dirt; tinting it toward the sky keeps
          // shadowed contact reading as shadow.
          color="#2a3550"
        />
      ) : (
        <></>
      )}

      {/*
        The threshold sits above the brightest lit diffuse surface, not at 1.0.
        Bloom runs before tone mapping and therefore sees raw HDR values, so a
        threshold of 1.0 catches ordinary lit geometry and hazes the entire
        world. Only the `emissive` material preset is meant to cross this line.

        Raised from 1.5 along with this pass. A real sky and a lit grass field
        both push average scene luminance up, and at the old threshold the
        brightest grass and the sky near the sun were starting to bloom, which
        is precisely the "whole world glows" failure this number exists to
        prevent.
      */}
      <Bloom intensity={0.55} luminanceThreshold={1.75} luminanceSmoothing={0.3} mipmapBlur radius={0.6} />

      {/*
        Grading. Small numbers doing a lot of work: a touch of saturation to
        keep the palette from going muddy once occlusion is darkening it, and a
        little contrast to put some snap back after tone mapping rolls the
        highlights off.
      */}
      <HueSaturation hue={0} saturation={0.08} />
      <BrightnessContrast brightness={0.01} contrast={0.06} />

      <Vignette offset={0.3} darkness={0.42} />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
