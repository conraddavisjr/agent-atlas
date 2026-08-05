import { EffectComposer, Bloom, Vignette, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

/**
 * Post-processing stays deliberately cheap. The target is a stable 60fps on
 * integrated graphics, and the toy look comes from materials and lighting rather
 * than from effects.
 *
 * The bloom threshold is set high on purpose. Only surfaces using the `emissive`
 * material preset push past it, so glow stays reserved for things that are meant
 * to read as powered. A low threshold would make the whole world hazy, which is
 * the single most common way this art style gets ruined.
 *
 * No SSAO. It is the obvious thing to reach for to ground objects, but it costs a
 * meaningful slice of the frame budget on integrated GPUs and the tight shadow
 * camera in Lighting already provides contact shadows that read correctly.
 */
export function PostFX() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {/*
        The threshold sits above the brightest lit diffuse surface, not at 1.0.
        Bloom runs before tone mapping and therefore sees raw HDR values, so a
        threshold of 1.0 catches ordinary lit geometry and hazes the entire
        world. Only the `emissive` material preset is meant to cross this line.
      */}
      <Bloom
        intensity={0.5}
        luminanceThreshold={1.5}
        luminanceSmoothing={0.25}
        mipmapBlur
        radius={0.5}
      />
      <Vignette offset={0.28} darkness={0.45} />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
