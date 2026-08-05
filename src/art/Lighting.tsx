import { Cloud, Clouds, Environment, Lightformer } from '@react-three/drei'
import { MeshBasicMaterial } from 'three'
import { palette } from './palette'
import { SkyDome } from './SkyDome'
import { useQuality } from './useQuality'

/**
 * Lighting is per-scene rather than global, which is one of the main payoffs of
 * the portal architecture: a dark cave and a sunny island share no setup at all.
 *
 * The environment map is built from Lightformers rather than an HDRI preset.
 * drei's presets fetch from a CDN, which would make the game fail offline and add
 * a network dependency we do not want. Lightformers are local, cheap, and give
 * direct control over the reflections that sell the clearcoat plastic look.
 *
 * `frames={1}` matters: our lighting is static, so the cubemap is rendered once
 * instead of every frame. Leaving it out silently costs a large slice of the
 * frame budget for no visual gain.
 */

export type LightingVariant = 'hub' | 'cave'

export function Lighting({ variant }: { variant: LightingVariant }) {
  return variant === 'hub' ? <HubLighting /> : <CaveLighting />
}

function HubLighting() {
  const quality = useQuality()

  return (
    <>
      {/*
        The sky, which is also the backdrop the whole island is read against.

        Turbidity and the Rayleigh coefficient are pulled well away from their
        physical defaults on purpose. Left alone, the Preetham model produces a
        convincing but resolutely realistic blue that fights the saturated
        palette everything else in the world is built from. Lifting turbidity
        and dropping Rayleigh softens it toward the pastel horizon the island
        was designed to sit inside.

        The sun is placed to agree with the key light below. A sky whose sun is
        somewhere other than where the shadows say it is reads as wrong long
        before anyone can say why.
      */}
      {/*
        `distance` has to stay inside the camera's far plane, which is 250. The
        usual value for this component is in the thousands, matching three's own
        example where the far plane is in the millions; at that scale here the
        sky sphere sits entirely beyond far, and what renders instead is a
        white-out with the world nowhere in it.
      */}
      <SkyDome sunDirection={[8, 14, 6]} />

      {/*
        Clouds have to be inside <Clouds>, which provides the context that
        batches them into a single instanced draw. A bare <Cloud> finds no
        parent and does not simply render on its own.
      */}
      {quality.cloudCount > 0 && (
        <Clouds material={MeshBasicMaterial} limit={200} range={quality.cloudCount * 40}>
          {Array.from({ length: quality.cloudCount }, (_, i) => (
            <Cloud
              key={i}
              seed={i + 1}
              segments={16}
              bounds={[12, 2, 8]}
              volume={7}
              // Well above the play space and spread around it, so clouds read
              // as distance rather than as something the player might jump to.
              position={[Math.cos(i * 2.3) * 34, 30 + (i % 3) * 6, Math.sin(i * 2.3) * 34]}
              opacity={0.28}
              speed={0.08}
              color="#ffffff"
            />
          ))}
        </Clouds>
      )}

      {/* Warm key. The only shadow caster, kept tight so the shadow map stays sharp. */}
      <directionalLight
        castShadow
        position={[8, 14, 6]}
        /*
          Intensities are budgeted against the bloom threshold in PostFX. Bloom
          runs before tone mapping, so it sees raw HDR: if a lit diffuse surface
          exceeds the threshold, the entire world glows instead of just the
          emissives. Diffuse surfaces need to land below roughly 1.4 here.
        */
        intensity={1.3}
        color="#fff2dd"
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-bias={-0.0005}
        /*
          Raised from 0.02 now that grass is in the scene. Normal bias offsets
          the shadow lookup along the surface normal, and a blade is a thin
          double-sided strip whose normal barely relates to the direction the
          light arrives from, which is the exact case that produces shadow acne.
          Too high and contact shadows detach from what casts them, so this is a
          balance rather than a number to maximise.
        */
        shadow-normalBias={0.06}
        /*
          Blur radius, in shadow-map texels. Only has any effect under variance
          shadow maps, which App selects for the tiers that ask for softness.
          Under the percentage-closer default it is silently ignored.
        */
        shadow-radius={quality.softShadows ? 4 : 0}
        shadow-blurSamples={quality.softShadows ? 12 : 0}
        /*
          Fitted to the island rather than to a round number. The plateau is
          radius 16 and nothing casts a shadow beyond it, so the previous +/-30
          frustum spent more than half its texels on empty space. Tightening to
          +/-18 leaves a margin for the portal arch and the tallest sculpture
          while nearly doubling the shadow density everywhere it matters, at no
          cost: it is the same 2048 map covering a smaller area.
        */
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
      />

      {/* Sky-to-ground bounce. This is what makes the island read as a lit diorama
          rather than an object floating in a void. */}
      <hemisphereLight args={[palette.skyTop, palette.grassDeep, 0.5]} />

      {/* A cool fill opposite the key so shadowed sides stay readable and tinted
          rather than going flat black. */}
      <directionalLight position={[-6, 5, -8]} intensity={0.25} color="#bfe4ff" />

      {/*
        Front fill, roughly from behind the camera and low.

        Without it, surfaces facing the player are lit almost entirely by the
        steep key and read far darker than their albedo suggests. Doors, plinths
        and the robot's chest are all vertical and player-facing, so this is the
        light that decides whether they are legible. Kept low so it lifts the
        shadow side without flattening the form.
      */}
      <directionalLight position={[2, 3, 12]} intensity={0.45} color="#fff6e8" />

      <Environment frames={1} resolution={256}>
        <Lightformer intensity={1.1} position={[0, 6, 0]} scale={[12, 12, 1]} rotation-x={Math.PI / 2} color="#ffffff" />
        <Lightformer intensity={0.55} position={[6, 2, 4]} scale={[6, 6, 1]} color={palette.skyTop} />
        <Lightformer intensity={0.4} position={[-6, 1, -4]} scale={[6, 6, 1]} color={palette.skyHorizon} />
      </Environment>
    </>
  )
}

function CaveLighting() {
  return (
    <>
      {/* Dim, cool key from the cave mouth. Deliberately weak: the crystals are
          meant to be the real light source and the emissives carry the scene. */}
      <directionalLight
        castShadow
        position={[4, 10, 8]}
        intensity={0.9}
        color="#9fc6ff"
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      <hemisphereLight args={[palette.caveCrystal, palette.caveRockDeep, 0.8]} />
      <ambientLight intensity={0.35} color={palette.caveCrystal} />

      {/* Front fill, same reasoning as the hub: cave walls and the robot are all
          vertical surfaces facing the player, and the steep key barely touches
          them. Without this the interior reads as a black void. */}
      <directionalLight position={[0, 3, 10]} intensity={0.5} color="#c9d9ff" />

      <Environment frames={1} resolution={128}>
        <Lightformer intensity={1.2} position={[0, 4, 0]} scale={[8, 8, 1]} rotation-x={Math.PI / 2} color={palette.caveCrystal} />
        <Lightformer intensity={0.6} position={[0, 1, 6]} scale={[5, 5, 1]} color="#9fc6ff" />
      </Environment>
    </>
  )
}
