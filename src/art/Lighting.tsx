import { Environment, Lightformer } from '@react-three/drei'
import { palette } from './palette'

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
  return (
    <>
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
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
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
