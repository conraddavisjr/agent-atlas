import { memo, useMemo, useRef } from 'react'
import { Cloud, Clouds, Environment, Lightformer } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { MeshBasicMaterial, Object3D, Vector3, type Camera, type DirectionalLight } from 'three'
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

/**
 * The hub's analytic rig, as data, so the budget below can be checked by a test
 * rather than by re-reading the comment.
 *
 * Exported for `Lighting.test.ts`, which sums the intensities against the art
 * bible's standing caps and integrates the whole rig onto a horizontal deck to
 * prove the light arriving there is warm. Every one of these numbers was
 * previously a literal in the JSX, where nothing could see them together, which
 * is how a rig that added thirteen points of blue to every lit surface stayed
 * invisible through a temperature commit that changed the albedo instead.
 */
export const HUB_RIG = {
  /**
   * The key.
   *
   * `#fff0d8` (255,240,216) was only 39 points of red over blue, and against a
   * hemisphere at 113 points the other way it lost. `#ffe7bc` (255,231,188) is
   * 67 points warm, which is a late-afternoon key rather than a warm white, and
   * it is what puts the temperature axis the reference brief asks for onto the
   * surfaces the player stands on.
   *
   * Up 1.50 to 1.55, which is where the sky fill's 0.05 went. The directional
   * sum is unchanged at 2.55, and the key's total LUMINANCE actually falls 2.6%
   * because the warmer hex carries less green and blue, so this does not spend
   * any of the greyscale budget.
   *
   * The key's DIRECTION is shared with `SkyDome`'s sun and must not move. Its
   * COLOUR is not shared, and `SkyDome` is owned by another stream: if the sun
   * disc and the key ever visibly disagree in temperature, this is the number
   * that moved and the sky is the thing to check against.
   */
  key: { color: '#ffe7bc', intensity: 1.55 },
  /**
   * The sky fill, lowered rather than merely dimmed.
   *
   * Its job, per its own comment below, is to give shadowed regions form. At
   * (-11, 4.5, -7) it was 19 degrees up, so a horizontal deck top caught it at
   * `N.L` 0.328 - almost as much as a vertical face in shadow caught, which is
   * how the level's largest cool term ended up on the surfaces meant to be warm.
   * At y 2.4 it is 10.4 degrees up: `N.L` on a deck top falls to 0.181 while
   * `N.L` on a vertical facing it RISES from 0.950 to 0.984. The blue moves off
   * the floor and onto the shadowed walls, which is the whole point of it.
   */
  skyFill: { color: '#9ec9f0', intensity: 0.25, position: [-11, 2.4, -7] as const },
  /** The camera-relative rim. Unchanged; see the block comment on the element. */
  rim: { color: '#bfeaff', intensity: 0.55, elevation: RIM_ELEV },
  /** The camera-relative bounce fill. Unchanged. */
  bounceFill: { color: '#ffe9cf', intensity: 0.2, elevation: FILL_ELEV },
  /**
   * The hemisphere, and the single largest cool term on any horizontal surface.
   *
   * For a deck top the hemisphere weight is 1.0, so the sky colour arrives
   * undiluted. `#7fbdf0` (127,189,240) is 113 points of blue over red - three
   * times the chroma of the sky dome it claims to be the average of. The
   * measured sky in `hub-totem` and `hub-backlit` is (215,221,220) and
   * (222,226,222): the dome the deck actually sees is a very pale blue-white,
   * and the ambient was inventing a saturation the sky does not have.
   *
   * `#bcd6ee` (188,214,238) is 50 points blue: still clearly chromatic, per the
   * brief's rule that ambient is saturated and never grey, but now in the same
   * family as the dome instead of three times its chroma. This is the change
   * that moves a lit deck from warmth 0 to warmth +15.
   */
  hemisphere: { sky: '#bcd6ee', ground: '#6fbe3d' },
} as const

/**
 * The two environment cards whose bloom margin depends on `BLOOM_THRESHOLD`.
 *
 * A prefiltered cubemap lookup cannot exceed its own brightest texel, so the
 * peak radiance a card writes - `max(linear(colour)) * intensity *
 * environmentIntensity` - is a hard ceiling on any specular reflection of it.
 * Both of these were sized to sit a fixed margin under a threshold of 1.75.
 * That threshold has since been measured at 1.45 and neither was re-derived,
 * which is what put a white shell over the line at a grazing angle.
 *
 * Exported so `Lighting.test.ts` can assert the margin against the measured
 * constant, which is the only version of this rule that survives the threshold
 * moving again.
 */
export const HUB_ENV = {
  /** Peak radiance 0.952. 1.52x under the threshold, the margin it had at 1.75. */
  keySoftbox: 1.12,
  /** Peak radiance 1.088. 1.33x under, the margin it had at 1.75. Hottest card. */
  highlightStrip: 1.28,
  /** `scene.environmentIntensity`, which multiplies every card. */
  intensity: 0.85,
} as const

/** Shortest signed angle, so a wrap never produces a spin. */
function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Scratch for `cameraAzimuth`, module scope so the per-frame call allocates nothing. */
const CAM_FORWARD = /*@__PURE__*/ new Vector3()

/**
 * The azimuth of the camera AS SEEN FROM THE SUBJECT, read off the camera.
 *
 * This used to be `cameraFrame.yaw`, which `01-lighting.md` section 2.2 names as
 * the quantity to use because "`FollowCamera` already publishes it". It does -
 * except on the one code path that every acceptance shot in this project runs
 * through. `FollowCamera` short-circuits on `cameraFrame.override` and returns
 * BEFORE the line that writes `cameraFrame.yaw`, so while the screenshot harness
 * has the camera pinned, the published yaw is frozen at whatever it was, which
 * after `resetCameraFrame` on mount is zero. Every vantage was therefore
 * captured with the rim aimed at world azimuth 159 degrees regardless of where
 * the camera actually was; at `hub-backlit` the correct bearing is 61 degrees,
 * so the rim was 98 degrees off - a side light, which is exactly the terminator
 * the critique measured instead of a rim. The bounce fill was off by the same
 * amount, which put the "camera-relative" fill back at the world-fixed +Z it was
 * introduced to stop being.
 *
 * Reading the camera removes the dependency entirely: it is correct whether the
 * yaw is being published or not, and it is what the viewer actually sees rather
 * than what the follow spring is aiming at. The convention matches
 * `FollowCamera`'s, where the camera sits at `lookAt + (sin yaw, ., cos yaw) * d`,
 * so the camera's forward axis points along `yaw + PI` and the yaw is recovered
 * by negating it.
 *
 * The quaternion is used rather than `getWorldDirection`, which reads
 * `matrixWorld` and is therefore one frame stale inside `useFrame`. r3f's default
 * camera has no parent, so its quaternion is already its world quaternion.
 *
 * Returns the previous azimuth when the camera is within about half a degree of
 * straight up or down, where the horizontal component vanishes and `atan2`
 * collapses to zero. That is a real bearing, so letting it through would swing
 * the rig across the world in one frame.
 */
function cameraAzimuth(camera: Camera, previous: number): number {
  CAM_FORWARD.set(0, 0, -1).applyQuaternion(camera.quaternion)
  const horizontal = Math.hypot(CAM_FORWARD.x, CAM_FORWARD.z)
  if (horizontal < 1e-2) return previous
  return Math.atan2(-CAM_FORWARD.x, -CAM_FORWARD.z)
}

/**
 * The camera-relative rim, the bounce fill, and the player-following shadow
 * frustum: one `useFrame`, about twelve scalar operations and six trig calls.
 *
 * All three live together because they all read the camera's azimuth and the
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

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const camAz = cameraAzimuth(state.camera, rimAz.current - Math.PI)

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
        intensity={HUB_RIG.key.intensity}
        color={HUB_RIG.key.color}
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

        Lowered from y 4.5 to y 2.4 and trimmed 0.30 to 0.25. See `HUB_RIG` for
        the derivation: at 19 degrees of elevation this light was depositing
        almost as much blue on deck tops as on the shadowed verticals it exists
        for, and it was the second largest cool term in the rig after the
        hemisphere.
      */}
      <directionalLight
        position={HUB_RIG.skyFill.position}
        intensity={HUB_RIG.skyFill.intensity}
        color={HUB_RIG.skyFill.color}
      />

      {/*
        The camera-relative rim, and the most recognisable missing element in
        the image before this.

        Its two jobs are split across two mechanisms with different bloom
        characteristics, which is the whole design. The diffuse wrap is this
        light, provably bounded at 0.119 luminance against a threshold of 1.45,
        and that is the part that actually separates the figure from the
        background. The hot specular streak is the environment's strip card,
        which is bounded by construction because a prefiltered cubemap lookup
        cannot exceed its own brightest texel.

        A KNOWN ASYMMETRY, stated because it decides what the strip can do. The
        wrap is camera-relative and the strip is world-fixed, so they only agree
        from some bearings. At `hub-backlit` the wrap sits at azimuth 61 degrees
        and the strip at -45, which is 106 degrees apart: from that camera the
        strip is a high front-left card and contributes nothing to the
        silhouette. The strip cannot follow the camera - `frames={1}` is the
        whole reason the environment is affordable, and rebuilding the cubemap
        per frame is exactly what it exists to prevent - so the streak at any
        given vantage comes from this light's own GGX lobe rather than from the
        card. That is why the wrap being aimed correctly is load-bearing for the
        specular half as well as the diffuse half.

        The colour is deliberately NOT `palette.visor`. The emissive cyan has to
        keep meaning "this is powered", and spraying it across every silhouette
        in the hub destroys that. `#bfeaff` is a cool near-white with enough
        blue to separate against the yellow-green grass it is most often read
        against, and it separates from the sky on value rather than on hue,
        which is why it is bright rather than saturated.
      */}
      {quality.rimLight && (
        <directionalLight
          ref={rimRef}
          intensity={HUB_RIG.rim.intensity}
          color={HUB_RIG.rim.color}
        />
      )}

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
      {quality.bounceFill && (
        <directionalLight
          ref={fillRef}
          intensity={HUB_RIG.bounceFill.intensity}
          color={HUB_RIG.bounceFill.color}
        />
      )}

      {/*
        The ambient, and there is no `ambientLight` here on purpose.

        `ambientLight` has no normal dependence at all, so it lifts every
        surface of an object identically and removes exactly the shading that
        describes its shape. A `hemisphereLight` costs the same and varies with
        world up, so it lifts shadows without flattening them.

        Neither colour is a palette entry and that is deliberate.
        `palette.skyTop` is the colour of the ZENITH, while what a surface
        actually receives is the whole dome, which averages toward the horizon;
        `#bcd6ee` is that average, saturated enough to satisfy the brief's rule
        that ambient is never grey and no more. It replaces `#7fbdf0`, which was
        three times the chroma of the dome the frames actually render - see
        `HUB_RIG.hemisphere`. And `palette.grassDeep` is the
        colour of grass IN SHADOW, whereas light bouncing off a sunlit lawn is
        brighter and more saturated than that, because the grass has already
        darkened it once on the way out. `#6fbe3d` is what puts a green kick on
        the robot's chin, the undersides of the blocks and the lip of the
        plateau, which is the only bounce in this scene worth modelling and it
        costs one mix and one dot.
      */}
      <hemisphereLight
        args={[HUB_RIG.hemisphere.sky, HUB_RIG.hemisphere.ground, quality.hemisphereIntensity]}
      />
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
    <Environment frames={1} resolution={resolution} environmentIntensity={HUB_ENV.intensity}>
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
          can name it.

          1.35 to 1.12, for the reason given on the highlight strip below: both
          cards were sized against a threshold of 1.75 that has since been
          measured at 1.45, and neither was re-derived when it moved. */}
      <Lightformer
        intensity={HUB_ENV.keySoftbox}
        position={[7, 7.5, 4]}
        scale={[10, 10, 1]}
        color="#fff3e2"
      />

      {/*
        The highlight strip. The card the brief names explicitly, and the single
        one that most makes the world read as photographed rather than rendered.

        Long, thin, high, and deliberately NOT at the key's bearing, so the
        elongated streak reads as its own event rather than as part of the key's
        highlight. 16 m by 0.55 m at 10 m out subtends exactly the narrow band a
        real strip softbox draws across a moulded curve.

        THE NUMBER THAT WENT STALE. 1.55 was chosen to sit just under the bloom
        threshold after `environmentIntensity`: peak radiance 1.32 against 1.75,
        a margin of 1.33x. The threshold was then MEASURED at 1.45 and this card
        was never re-derived, so its margin quietly fell to 1.10x. A clearcoat at
        a grazing angle reflects very nearly the whole of it, which is how a
        white dome came to clip to (255,252,243) and spill into the sky in
        `hub-backlit` - the one shot whose stated criterion is whether anything
        other than an emissive has crossed the threshold.

        1.28 restores the margin the design chose: peak radiance
        `1.0 * 1.28 * 0.85 = 1.088`, which is 1.33x under 1.45. It is still the
        hottest card in the rig and still the brightest thing a shell can
        reflect. Fixing this here rather than by dimming the emissives is
        deliberate: the emissives are the things that are meant to bloom.
      */}
      <Lightformer
        intensity={HUB_ENV.highlightStrip}
        position={[-4, 9, 4]}
        scale={[16, 0.55, 1]}
        color="#ffffff"
      />

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
    key            #ffe7bc  dir (9, 9.5, 5)         1.55          1.55
    sky fill       #9ec9f0  world (-11, 2.4, -7)    0.25          1.80
    rim / kicker   #bfeaff  camera-relative         0.55          2.35
    bounce fill    #ffe9cf  camera-relative         0.20          2.55
                                                   -------------------
                                        CAP 2.60   TOTAL 2.55   SPARE 0.05

  HEMISPHERE       sky #bcd6ee / ground #6fbe3d     0.55   CAP 0.60
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

                                       intensity   peak radiance   margin
    ambient floor  #243a52  background      -          0.074        19.6x
    key softbox    #fff3e2  [7, 7.5, 4]     1.12       0.952         1.52x
    highlight strip #ffffff [-4, 9, 4]      1.28       1.088         1.33x  <- hottest
    cool sky wrap  #8ec8f0  [-8, 3, -6]     0.60       0.444         3.26x
    ground bounce  #9ecf6a  [1, -4.5, -1]   0.30       0.159         9.11x
    negative fill  #0b0f1a  [3, -0.5, 7]    1.00       0.009       165x     <- darkest
    rim card       #cfeeff  [-2, 5, -9]     0.80       0.680         2.13x
                                       -------------------------------------
                          CAP 1.60 each   MAX 1.28   PEAK 1.088 vs 1.45

    The margin column is against BLOOM_THRESHOLD, and it is a column rather
    than a sentence because the threshold moved once already, from a guessed
    1.75 to a measured 1.45, and these two cards were not re-derived when it
    did. Their margins silently fell to 1.10x and 1.26x, which is how a white
    dome came to clip and spill at a grazing angle in `hub-backlit`.
    `Lighting.test.ts` now recomputes this column from BLOOM_THRESHOLD.

  TEMPERATURE, on a horizontal deck (albedo #bfbbb4, display warmth +11)

    Total irradiance R-B, by term, N = +Y:

      key            +0.339      hemisphere     -0.114
      key softbox    +0.041      rim            -0.115
      bounce fill    +0.011      background     -0.038
                                 cool wrap      -0.032
                                 sky fill       -0.026
                                 rim card       -0.008
                                       ------------------
                                       TOTAL    +0.058 (was -0.229)

    Rendered, through ACES and the grade: a lit deck lands near (174,170,159),
    display luma 0.667, warmth +15. It was (169,171,169), luma 0.668, warmth 0 -
    an eleven-point warm albedo cancelled exactly by a thirteen-point cool rig.
    A deck with the key occluded lands near warmth -18 and a shadowed vertical
    facing the fill near -31, so the axis now runs +15 to -31 instead of 0 to
    -45. Cool shadows against warm highlights, which is the thing the reference
    brief asks for and the thing this rig had only half of.

    The rim's -0.115 is unavoidable and is not a defect: a camera-relative rim
    at 26 degrees deposits `sin(26) * 0.55` of cool light on every horizontal
    surface in the level. It is the price of the rim and it is paid knowingly.

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
