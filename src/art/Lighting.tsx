import { memo, useMemo, useRef } from 'react'
import { Cloud, Clouds, Environment, Lightformer } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { MeshBasicMaterial, Object3D, Vector3, type DirectionalLight } from 'three'
import { cameraFrame } from '@/game/camera/cameraFrame'
import { useGame } from '@/game/GameContext'
import { palette } from './palette'
import { SkyDome } from './SkyDome'
import { useQuality } from './useQuality'
import type { QualitySettings } from './quality'

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

/*
  KEY DIRECTION IS SHARED. (9, 9.5, 5) appears here, in the SkyDome
  `sunDirection` prop, and in KEY_AZ for the rim's swing. Change one and change
  all three, or the sun glow, the shadows and the kicker stop agreeing, which is
  the most legible lighting bug there is.
*/
const KEY_DIRECTION: [number, number, number] = [9, 9.5, 5]

const KEY_DIR = /*@__PURE__*/ new Vector3(...KEY_DIRECTION).normalize()
const WORLD_UP = /*@__PURE__*/ new Vector3(0, 1, 0)
/** The shadow camera's own right and up axes, which is where snapping happens. */
const LIGHT_RIGHT = /*@__PURE__*/ new Vector3().crossVectors(WORLD_UP, KEY_DIR).normalize()
const LIGHT_UP = /*@__PURE__*/ new Vector3().crossVectors(KEY_DIR, LIGHT_RIGHT).normalize()

/**
 * Half-extent of the shadow frustum, in metres.
 *
 * 12 rather than the previous fixed 18, which raises raw texel density by half
 * at every tier for no GPU cost at all: 42.7 texels/m at low, 85.3 at medium,
 * 170.7 at high. The density is not the whole story though - what actually
 * destroyed the read before was the VSM blur, which at radius 4 on a 2048 map
 * over 36 m smeared a penumbra of about 0.14 m, or 23 per cent of the robot's
 * width, onto each edge. Tightening the box shrinks that penumbra in world
 * units by the same factor for free.
 *
 * Tighter than 12 was considered and rejected. At 9 the medium tier reaches 114
 * texels/m, but the shadowed region is only 18 m across on a 32 m island and
 * the boundary where shadows stop becomes a visible line in ordinary play. At
 * 12 the coverage loss lands on the island's back rim, which the camera is
 * looking away from, and the reference brief endorses it directly: background
 * layers frequently cast no shadows at all, only AO, which flattens them and
 * pushes them back.
 */
const HALF_EXTENT = 12
/** Metres the box is pushed ahead of the player along the camera's bearing. */
const LOOK_AHEAD = 5
/** Metres from the island origin the box centre is allowed to travel. */
const CENTRE_CLAMP = 6
/**
 * The plateau top, and deliberately NOT `player.position.y`.
 *
 * If the frustum centre followed the player vertically, the shadow map would
 * slide every time the player jumped and every static shadow in the scene would
 * crawl for the duration of the jump.
 */
const GROUND_Y = 0.5
const LIGHT_DISTANCE = 30

/** The key's world azimuth, which the rim swings away from. */
const KEY_AZ = /*@__PURE__*/ Math.atan2(KEY_DIRECTION[0], KEY_DIRECTION[2])
/** Radians, max off-axis swing. 24 degrees. */
const RIM_SWING = 0.42
/** Radians, fixed. 26 degrees. */
const RIM_ELEV = 0.45
/** Placement only. Directional lights are parallel, so this is arbitrary. */
const RIM_RADIUS = 12
/** 1/s. A 0.125 s time constant. */
const RIM_SMOOTH = 8
/** Radians, 8 degrees. Low, so it grazes verticals rather than piling onto tops. */
const FILL_ELEV = 0.14

/** Shortest signed angle, so a wrap never produces a spin. */
function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/**
 * The camera-relative rim, the bounce fill, and the player-following shadow
 * frustum: one `useFrame`, about twelve scalar operations and six trig calls.
 *
 * All three live together because they all read `cameraFrame.yaw` and the
 * player group, and because splitting them would mean three subscriptions to
 * the same two values.
 *
 * It is a sibling of `<Environment>` and never a child. drei rebuilds the
 * cubemap in a layout effect keyed on `children`, whose identity changes on
 * every React render of its parent, so anything in that subtree reading frame
 * state would rebuild the cube every frame and undo the whole point of
 * `frames={1}`.
 */
function HubRig({ quality }: { quality: QualitySettings }) {
  const { player } = useGame()

  const keyRef = useRef<DirectionalLight>(null)
  const rimRef = useRef<DirectionalLight>(null)
  const fillRef = useRef<DirectionalLight>(null)

  /**
   * The key's target, and the trap that goes with it.
   *
   * `DirectionalLight.target` defaults to a fresh `Object3D` that is NOT in the
   * scene graph, so `scene.updateMatrixWorld()` never touches it, while
   * `LightShadow.updateMatrices` reads `target.matrixWorld` to aim the shadow
   * camera. Move its position without updating its world matrix and the shadow
   * camera keeps looking at the world origin, which skews the frustum further
   * and further as the player walks away from the centre. It fails silently and
   * it looks exactly like a bias problem.
   *
   * The rim and the bounce fill do not need this: their targets stay at the
   * origin, and an untouched `Object3D` already has an identity `matrixWorld`.
   */
  const keyTarget = useMemo(() => new Object3D(), [])

  const rimAz = useRef(KEY_AZ + Math.PI)

  /*
    Scratch vectors as a ref rather than a memo, matching `FollowCamera`. These
    are explicitly mutable per-frame buffers and a `useMemo` value is not
    allowed to be mutated after render - the compiler's immutability rule says
    so directly. Allocating fresh vectors each frame instead would be garbage at
    60Hz for no benefit.
  */
  const scratchRef = useRef<{ raw: Vector3; snapped: Vector3 } | null>(null)
  if (scratchRef.current === null) {
    scratchRef.current = { raw: new Vector3(), snapped: new Vector3() }
  }
  const scratch = scratchRef.current

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const camAz = cameraFrame.yaw

    // ---- The following, texel-snapped shadow frustum ----------------------
    const key = keyRef.current
    const body = player.current
    if (key && body) {
      const { raw, snapped } = scratch

      // Desired centre: the player, pushed forward along the way the camera
      // looks, so the box spends its texels on what is about to be on screen.
      raw.set(
        body.position.x + Math.sin(camAz + Math.PI) * LOOK_AHEAD,
        GROUND_Y,
        body.position.z + Math.cos(camAz + Math.PI) * LOOK_AHEAD,
      )

      // Clamped to the island core, so standing on the rim does not swing the
      // box off into empty air and drop every shadow on the island at once.
      const d = Math.hypot(raw.x, raw.z)
      if (d > CENTRE_CLAMP) {
        raw.x *= CENTRE_CLAMP / d
        raw.z *= CENTRE_CLAMP / d
      }

      /*
        Snapped in LIGHT space, not world space.

        Snapping in world space is the common mistake and it does not remove the
        crawl, because the ortho camera's axes are rotated relative to world: a
        centre that lands on a whole number of world units still lands
        mid-texel. The depth axis is deliberately not snapped, since sliding
        along it does not move which texel a surface lands in.
      */
      const texel = (2 * HALF_EXTENT) / quality.shadowMapSize
      const u = Math.round(raw.dot(LIGHT_RIGHT) / texel) * texel
      const v = Math.round(raw.dot(LIGHT_UP) / texel) * texel
      const w = raw.dot(KEY_DIR)
      snapped
        .copy(LIGHT_RIGHT)
        .multiplyScalar(u)
        .addScaledVector(LIGHT_UP, v)
        .addScaledVector(KEY_DIR, w)

      keyTarget.position.copy(snapped)
      keyTarget.updateMatrixWorld()
      key.position.copy(snapped).addScaledVector(KEY_DIR, LIGHT_DISTANCE)
    }

    // ---- The rim -----------------------------------------------------------
    const rim = rimRef.current
    if (rim) {
      /*
        `camAz + PI` puts the light directly behind the subject as the camera
        sees it, which is the definition of a rim.

        The `- RIM_SWING * sin(rel)` term keeps the kicker on the side away from
        the key. A perfectly symmetric 180-degree backlight puts an even halo on
        both edges of the silhouette, which reads as a rendering artefact rather
        than as a light. `sin` rather than a sign test because it is continuous:
        as the camera crosses the key's bearing the swing passes smoothly
        through zero instead of popping from one edge to the other.
      */
      const rel = wrapPi(KEY_AZ - camAz)
      const targetAz = camAz + Math.PI - RIM_SWING * Math.sin(rel)
      rimAz.current += wrapPi(targetAz - rimAz.current) * (1 - Math.exp(-RIM_SMOOTH * dt))

      const c = Math.cos(RIM_ELEV) * RIM_RADIUS
      rim.position.set(
        Math.sin(rimAz.current) * c,
        Math.sin(RIM_ELEV) * RIM_RADIUS,
        Math.cos(rimAz.current) * c,
      )
    }

    // ---- The bounce fill ---------------------------------------------------
    const fill = fillRef.current
    if (fill) {
      // No swing and no smoothing: it is weak and broad enough that camera
      // shimmer is not detectable, and it is opposed to the rim so the two
      // form a wrap rather than two separate lights.
      const c2 = Math.cos(FILL_ELEV) * RIM_RADIUS
      fill.position.set(
        Math.sin(camAz) * c2,
        Math.sin(FILL_ELEV) * RIM_RADIUS,
        Math.cos(camAz) * c2,
      )
    }
  })

  return (
    <>
      {/*
        The key. Warm, and the only shadow caster in the scene at any tier.

        A second caster was considered and rejected outright. Each `castShadow`
        light multiplies only its OWN contribution by its own shadow mask, so
        where a wide caster says shadowed and a tight one says lit you get a
        partial shadow and a visible half-darkened fringe at the tight frustum's
        boundary. Layers cannot rescue it either: `WebGLShadowMap` tests
        `object.layers` against the MAIN camera rather than the shadow camera,
        so there is no per-light caster masking in three's standard renderer at
        all. The following frustum above plus the character's contact blob buy
        more than a second map would, for a few CPU operations instead of a
        whole extra depth pass over 220,000 grass instances.
      */}
      <directionalLight
        ref={keyRef}
        castShadow
        target={keyTarget}
        intensity={1.5}
        color="#fff0d8"
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        /*
          -0.0004 rather than -0.0005 because the frustum is 1.5x tighter, so a
          texel covers 1.5x less world and the same bias over-offsets.
        */
        shadow-bias={-0.0004}
        /*
          Unchanged at 0.06. Normal bias offsets the lookup along the surface
          normal, and a grass blade is a thin double-sided strip whose normal
          barely relates to where the light arrives from, which is the exact
          case that produces acne. The blades have not changed shape.
        */
        shadow-normalBias={0.06}
        shadow-radius={quality.shadowRadius}
        shadow-blurSamples={quality.shadowBlurSamples}
        shadow-camera-left={-HALF_EXTENT}
        shadow-camera-right={HALF_EXTENT}
        shadow-camera-top={HALF_EXTENT}
        shadow-camera-bottom={-HALF_EXTENT}
        /*
          Tightened from 0.5/60. With the light parked 30 m along the key
          direction from the frustum centre, the nearest caster is the top of
          the portal arch at about 4 m above the centre plane, so 26 m from the
          light, and the furthest is the bottom of the soil cone about 7 m
          below, so 37 m. 10/52 clears both with margin and roughly halves the
          depth range VSM has to encode, which directly reduces light bleeding.
        */
        shadow-camera-near={10}
        shadow-camera-far={52}
      />

      {/*
        Sky fill: world-fixed, opposite the key in azimuth, low, and casting no
        shadow at all.

        This is the light that gives shadowed regions FORM rather than merely a
        lifted floor. Because it casts no shadow it reaches into every region
        the key is occluded from, and because it is directional it varies with
        the surface normal there. A hemisphere light cannot do this job: its
        variation is with world up, so it lifts a shadowed sphere uniformly
        instead of describing it.
      */}
      <directionalLight position={[-11, 4.5, -7]} intensity={0.3} color="#9ec9f0" />

      {/*
        The camera-relative rim, and the most recognisable missing element in
        the image before this.

        Its two jobs are split across two mechanisms with different bloom
        characteristics, which is the whole design. The diffuse wrap is this
        light, provably bounded at 0.119 luminance against a threshold of 1.75,
        and that is the part that actually separates the figure from the
        background. The hot specular streak is the environment's strip card,
        which is bounded by construction because a prefiltered cubemap lookup
        cannot exceed its own brightest texel.

        The colour is deliberately NOT `palette.visor`. The emissive cyan has to
        keep meaning "this is powered", and spraying it across every silhouette
        in the hub destroys that. `#bfeaff` is a cool near-white with enough
        blue to separate against the yellow-green grass it is most often read
        against, and it separates from the sky on value rather than on hue,
        which is why it is bright rather than saturated.
      */}
      {quality.rimLight && <directionalLight ref={rimRef} intensity={0.55} color="#bfeaff" />}

      {/*
        The bounce fill, replacing the old world-fixed front fill at (2, 3, 12).

        That one was a bug rather than a choice: the camera orbits freely, so
        once the player had turned 180 degrees the "front fill" was lighting the
        robot's back. Made camera-relative it costs the same and is correct from
        every bearing, and it can be far weaker because it is now always pointed
        at the surfaces it exists to rescue. Dropping 0.45 to 0.20 is most of
        what pays for the rim inside the 2.60 budget.

        It is the one light cut at `low`, where the hemisphere rises to 0.60 to
        absorb it. That keeps `low` at three directionals, the same count it has
        today, so its GPU cost lands within noise of current.
      */}
      {quality.bounceFill && <directionalLight ref={fillRef} intensity={0.2} color="#ffe9cf" />}

      {/*
        The ambient, and there is no `ambientLight` here on purpose.

        `ambientLight` has no normal dependence at all, so it lifts every
        surface of an object identically and removes exactly the shading that
        describes its shape. A `hemisphereLight` costs the same and varies with
        world up, so it lifts shadows without flattening them.

        Neither colour is a palette entry and that is deliberate.
        `palette.skyTop` is the colour of the ZENITH, while what a surface
        actually receives is the whole dome, which averages toward the horizon;
        `#7fbdf0` is that average pushed more saturated, per the brief's rule
        that ambient is saturated and never grey. And `palette.grassDeep` is the
        colour of grass IN SHADOW, whereas light bouncing off a sunlit lawn is
        brighter and more saturated than that, because the grass has already
        darkened it once on the way out. `#6fbe3d` is what puts a green kick on
        the robot's chin, the undersides of the blocks and the lip of the
        plateau, which is the only bounce in this scene worth modelling and it
        costs one mix and one dot.
      */}
      <hemisphereLight args={['#7fbdf0', '#6fbe3d', quality.hemisphereIntensity]} />
    </>
  )
}

/**
 * The IBL, rebuilt around a bright strip and a dark card.
 *
 * Memoised on the resolution alone, because drei rebuilds the cubemap in a
 * layout effect keyed on `children` and `children` changes identity on every
 * render of whatever holds it. Before this it rebuilt on any quality change;
 * now it rebuilds only when the thing that actually affects the cube changes.
 *
 * Two facts about `Lightformer` shape everything below and both were verified
 * in `node_modules` rather than assumed.
 *
 * `intensity` multiplies the material colour, on a `meshBasicMaterial` with
 * `toneMapped={false}`, into a `HalfFloatType` cube target. So the radiance a
 * card writes is exactly `linear(color) * intensity * environmentIntensity`,
 * and the brightest specular value ANY material in the scene can reflect is the
 * brightest texel in this map, because a prefiltered cubemap lookup cannot
 * exceed its own maximum. That is what makes the environment provably incapable
 * of blooming, which is not a property any analytic light has.
 *
 * And passing `rotation-x` does nothing. The component runs
 * `if (!props.rotation) { quaternion.identity(); lookAt(target) }`, and
 * `rotation-x` is a different prop key, so `props.rotation` is undefined and
 * the rotation React applied is thrown away. No card here sets a rotation:
 * orientation comes from `target` only. `lookAt` resolves roll against the
 * default up of +Y, so a card's local +X always ends up horizontal, which is
 * what makes `scale={[16, 0.55, 1]}` reliably produce a horizontal strip.
 */
const HubEnvironment = memo(function HubEnvironment({ resolution }: { resolution: number }) {
  return (
    <Environment frames={1} resolution={resolution} environmentIntensity={0.85}>
      {/*
        The ambient floor, and the card that was missing entirely.

        The virtual scene drei renders these into has NO background, so every
        gap between cards clears to black and the clearcoat reflects a void,
        which is one of the two reasons gloss currently reads as generic shine
        rather than as moulded plastic. A uniform radiance over the full sphere
        contributes `L * albedo` to diffuse, so this also supplies a chromatic
        ambient to every surface in the scene for nothing. It must not go much
        brighter than this or it becomes a fifth light and eats the value
        structure.
      */}
      <color attach="background" args={['#243a52']} />

      {/* Key softbox, at the key directional's own bearing. It has to be at the
          same bearing or the reflections in the clearcoat disagree with where
          the shadows fall, which reads as wrong immediately even though nobody
          can name it. */}
      <Lightformer intensity={1.35} position={[7, 7.5, 4]} scale={[10, 10, 1]} color="#fff3e2" />

      {/*
        The highlight strip. The card the brief names explicitly, and the single
        one that most makes the world read as photographed rather than rendered.

        Long, thin, high, and deliberately NOT at the key's bearing, so the
        elongated streak reads as its own event rather than as part of the key's
        highlight. 16 m by 0.55 m at 10 m out subtends exactly the narrow band a
        real strip softbox draws across a moulded curve.

        Its 1.55 is chosen to sit just under the bloom threshold after
        `environmentIntensity`: peak radiance 1.32 against 1.75. That is
        deliberate - it should be the brightest thing on a shell without ever
        being a bloom source, because bloom is reserved for emissives.
      */}
      <Lightformer intensity={1.55} position={[-4, 9, 4]} scale={[16, 0.55, 1]} color="#ffffff" />

      {/* Cool sky wrap: large, low, opposite the key. This is the environment
          half of the coloured-shadow story - a surface turned away from the key
          sees mostly this card, so its reflections stay blue instead of being
          neutralised by the softbox. */}
      <Lightformer intensity={0.6} position={[-8, 3, -6]} scale={[14, 9, 1]} color="#8ec8f0" />

      {/* Ground bounce: the grass, seen from below, filling undersides. */}
      <Lightformer intensity={0.3} position={[1, -4.5, -1]} scale={[16, 16, 1]} color="#9ecf6a" />

      {/*
        Negative fill, the other thing the brief names explicitly, and the
        reason it is PLACED rather than merely dark.

        Lightformers are opaque `meshBasicMaterial` meshes with
        `side: DoubleSide`, so they genuinely occlude cards behind them. That
        occlusion is the actual mechanism of negative fill. Its job is to give
        the clearcoat a dark value to reflect below the highlight, so the
        highlight reads as a HIGHLIGHT rather than as "this material is bright".

        `#0b0f1a` rather than black because the brief refuses pure black
        anywhere, and because a faint blue in the darkest reflection is what
        keeps a white shell chromatic.
      */}
      <Lightformer intensity={1} position={[3, -0.5, 7]} scale={[12, 7, 1]} color="#0b0f1a" />

      {/* Rim card: small, cool, behind, so a near-mirror surface catches an
          edge reflection even when the analytic rim's lobe misses. It is
          world-fixed while the analytic rim is camera-relative, which is a real
          inconsistency; it is accepted because rebuilding the cube per frame is
          exactly what `frames={1}` exists to prevent, and because this card's
          contribution is diffuse enough that the disagreement does not read. */}
      <Lightformer intensity={0.8} position={[-2, 5, -9]} scale={[9, 2.5, 1]} color="#cfeeff" />
    </Environment>
  )
})

/*
  HUB LIGHT BUDGET  -  see docs/design/01-lighting.md

  Bloom runs BEFORE tone mapping (renderer is NoToneMapping, ACES is applied
  last in the composer), so bloom sees raw HDR. The threshold is BLOOM_THRESHOLD
  in materials.ts. Every number below is budgeted against it. Change one and
  re-check the whole block, because the caps are on sums, not on individuals.

  DIRECTIONAL                                    intensity   running total
    key            #fff0d8  dir (9, 9.5, 5)         1.50          1.50
    sky fill       #9ec9f0  world (-11, 4.5, -7)    0.30          1.80
    rim / kicker   #bfeaff  camera-relative         0.55          2.35
    bounce fill    #ffe9cf  camera-relative         0.20          2.55
                                                   -------------------
                                        CAP 2.60   TOTAL 2.55   SPARE 0.05

  HEMISPHERE       sky #7fbdf0 / ground #6fbe3d     0.55   CAP 0.60
                   (0.60 at the low tier, which drops the bounce fill)

  RIM SUB-CAP                                      0.55   CAP 0.60

  AMBIENT LIGHT    none, and there must not be one. ambientLight has no normal
                   dependence, so it removes the shading it is meant to lift.
                   The hemisphere does the same job and keeps the form.

  ENVIRONMENT      radiance = linear(color) * Lightformer.intensity
                                            * scene.environmentIntensity (0.85)
                   Peak radiance is the ceiling on ANY specular reflection,
                   because a prefiltered cubemap lookup cannot exceed its own
                   brightest texel. This is why the env is provably bloom-safe
                   and an analytic light is not.

                                       intensity      peak radiance
    ambient floor  #243a52  background      -             0.074
    key softbox    #fff3e2  [7, 7.5, 4]     1.35          1.15
    highlight strip #ffffff [-4, 9, 4]      1.55          1.32   <- hottest
    cool sky wrap  #8ec8f0  [-8, 3, -6]     0.60          0.43
    ground bounce  #9ecf6a  [1, -4.5, -1]   0.30          0.20
    negative fill  #0b0f1a  [3, -0.5, 7]    1.00          0.009  <- darkest
    rim card       #cfeeff  [-2, 5, -9]     0.80          0.68
                                       ----------------------------
                          CAP 1.60 each   MAX 1.55    PEAK 1.32 vs 1.35

  MEASURED / DERIVED HEADROOM
    peak lit diffuse on the shell   ~0.54 luminance
    open shadow side                ~0.19 luminance   ratio 2.8:1 (target 2:1-3:1)
    rim diffuse at its peak          0.119 luminance  cannot bloom
    SkyDome peak (sun glow)         ~0.97 luminance   do NOT raise the 0.55 /
                                                     0.12 glow coefficients in
                                                     SkyDome.tsx without
                                                     re-checking; at 0.9 / 0.2
                                                     the sky itself blooms.

  THE ONLY UNBOUNDED TERM is analytic specular. GGX D peaks near 629 at
  clearcoatRoughness 0.15, so the rim's specular lobe is the one thing here
  that can cross the threshold. That is intended: the brief wants specular hits
  to bloom and white plastic not to. If it goes wrong, the escape ladder is, in
  order: rim 0.55 -> 0.45; split the rim into two at 0.28 sixteen degrees
  apart; plastic() clearcoatRoughness -> 0.16; and only as a last resort raise
  the threshold, which also stops the LED visor glowing.

  KEY DIRECTION IS SHARED. (9, 9.5, 5) appears in KEY_DIRECTION above, in the
  SkyDome sunDirection prop, and in KEY_AZ for the rim's swing. Change one and
  change all three, or the sun glow, the shadows and the kicker stop agreeing.
*/
function HubLighting() {
  const quality = useQuality()

  return (
    <>
      {/*
        The sky, which is also the backdrop the whole island is read against.

        Turbidity and the Rayleigh coefficient are pulled well away from their
        physical defaults on purpose. Left alone, the Preetham model produces a
        convincing but resolutely realistic blue that fights the saturated
        palette everything else in the world is built from.

        `distance` has to stay inside the camera's far plane of 250. The usual
        value for this component is in the thousands, matching three's own
        example where the far plane is in the millions; at that scale here the
        sky sphere sits entirely beyond far, and what renders instead is a
        white-out with the world nowhere in it.

        The sun direction is KEY_DIRECTION and must stay that way. A sky whose
        sun is somewhere other than where the shadows say it is reads as wrong
        long before anyone can say why.
      */}
      <SkyDome sunDirection={KEY_DIRECTION} />

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

      <HubRig quality={quality} />
      <HubEnvironment resolution={quality.envResolution} />
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
