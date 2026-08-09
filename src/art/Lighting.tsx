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

/**
 * The camera-relative rim / kicker. SLOT: renders nothing yet.
 *
 * It is the most recognisable missing element in the current image and it has
 * to be camera-relative, because this camera orbits freely on both mouse drag
 * and auto-realignment, so a world-fixed rim spends most of a session either
 * invisible or acting as a second key. That is not a shortcut; it is what a
 * gaffer physically does on a turntable shoot, which is the reference the whole
 * art direction is built on.
 *
 * Two things about it are already settled and are worth recording here, because
 * they are the reasons it is one component rather than a light added to the rig
 * above. Its azimuth comes from `cameraFrame.yaw`, which `FollowCamera` already
 * publishes and which is exactly the quantity needed, so there is no camera
 * maths to keep in sync. And its elevation is fixed rather than following
 * camera pitch, because pitch runs from -0.5 to 1.1 rad and following it would
 * put the kicker underneath the robot whenever the player looks down.
 *
 * The gate is honoured now so that building the light is a change in one file
 * and one line of quality.ts rather than a change in three. `rimLight` is false
 * at every tier until then, and `?nogfx=rim` forces it off regardless.
 */
function RimLight() {
  const quality = useQuality()
  if (!quality.rimLight) return null
  // TODO(stream 0b): the light itself, per docs/design/01-lighting.md section 2.
  // Intensity 0.55 against a rim sub-cap of 0.60, colour #bfeaff, and
  // deliberately not palette.visor: the emissive cyan has to keep meaning "this
  // is powered", and spraying it across every silhouette destroys that.
  return null
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

      <RimLight />

      {/*
        Resolution comes from the tier now rather than being fixed here. It is a
        one-off cost: `frames={1}` renders the cube once and the runtime IBL
        sampling costs the same whatever the resolution is, so all that changes
        is memory and how sharp the low-roughness mips are.

        Nothing inside this subtree may re-render per frame. The cube is
        rebuilt in a layout effect keyed on `children`, whose identity changes
        on every React render of this component, so a camera-relative light or
        anything reading `useFrame` state placed in here would rebuild the
        cubemap every frame and undo the entire point of `frames={1}`. That is
        why `<RimLight />` is a sibling of the environment rather than a child.
      */}
      <Environment frames={1} resolution={quality.envResolution}>
        {/*
          No `rotation-x`. It was here and it never did anything.

          drei's Lightformer runs `if (!props.rotation) quaternion.identity()`
          and then `lookAt(target)` in a layout effect. `rotation-x` is a
          different prop key, so `props.rotation` is undefined, the rotation
          React applied is reset, and the lookAt wins. It happened to be
          harmless because this card sits at [0, 6, 0] and looking at the origin
          points it straight down anyway, which is what the rotation was trying
          to say.

          The rule that follows is worth keeping: orientation on a Lightformer
          comes from `target` and never from a rotation prop. `lookAt` resolves
          roll against the default up of +Y, so a card's local +X always ends up
          horizontal, which is what makes a long thin scale reliably produce a
          horizontal strip.
        */}
        <Lightformer intensity={1.1} position={[0, 6, 0]} scale={[12, 12, 1]} color="#ffffff" />
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

      {/*
        Deliberately a literal 128 rather than `quality.envResolution`. The cave
        is a dim interior with almost no glossy surface in it, so the sharpness
        of the low-roughness mips buys nothing here at any tier, and the cave rig
        is a separate budget from the hub's. Its `rotation-x` is gone for the
        same reason as the hub's: drei discards it.
      */}
      <Environment frames={1} resolution={128}>
        <Lightformer intensity={1.2} position={[0, 4, 0]} scale={[8, 8, 1]} color={palette.caveCrystal} />
        <Lightformer intensity={0.6} position={[0, 1, 6]} scale={[5, 5, 1]} color="#9fc6ff" />
      </Environment>
    </>
  )
}
