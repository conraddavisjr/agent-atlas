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
 *
 * WIDER THAN 12 WAS ALSO ASKED FOR, TO CATCH THE LIP'S SHADOW ON THE KEEL, AND
 * THE ANSWER IS NO. The arithmetic, because it is short and it settles a
 * recurring question.
 *
 * The shadow camera is orthographic and looks along -KEY_DIR, so its frustum is
 * a square prism ALIGNED WITH THE SUN. Depth is not the constraint and never
 * was: `near 10 / far 52` with the light parked 30 m up the key direction admits
 * any caster with `-22 <= dot(X - C, KEY_DIR) <= 20`, and the keel apex at
 * y = -7.2 sits at -5.22. The constraint is lateral, and it MOVES WITH DEPTH,
 * because a prism aligned with the sun has a footprint that slides
 * anti-sunward by `1 / tan(elevation)` = 1.084 m for every metre of drop.
 *
 * `islandSkirtProfile` puts the overhanging lip at radius 16.78 and the keel
 * apex at y = -7.2. With the frustum centre at the island origin, the sunward
 * reach of the box is:
 *
 *     y  0      p <= 17.15    the lip, at 16.78:  inside
 *     y -0.34   p <= 16.79                        inside, by 1 cm
 *     y -0.52   p <= 16.59                        outside by 0.19 m
 *     y -1.9    p <= 15.09                        outside by 1.69 m
 *     y -3.6    p <= 13.25                        outside by 3.53 m
 *     y -7.2    p <=  9.35                        outside by 7.43 m
 *
 * So the lip is (barely) inside the box as a CASTER, and the cliff surface
 * immediately below it that would RECEIVE its shadow is already outside. The
 * shadow has nowhere to land. `CENTRE_CLAMP` buys 6 m when the player happens to
 * be standing on the correct side, which covers down to about y = -5.4 and still
 * misses the apex by 1.43 m. And `|u| <= 12` against an amplitude of 16.78
 * means only +-45.7 degrees of the rim's azimuth is ever in the box at any depth.
 *
 * Including the whole rim at every depth needs HALF_EXTENT >= 17.04, which is
 * essentially the 18 this was tightened FROM. The price: texel density falls 28%
 * at every tier (high 170.7 -> 122.1 texels/m) and the VSM penumbra widens 40%
 * (47 mm -> 66 mm at medium, radius 4). That is the entire gain this constant
 * was introduced to buy, handed back, for one contact edge.
 *
 * THE CHEAP WAY TO GET THAT CONTACT IS NOT A SHADOW MAP. The lip-on-keel
 * darkening is static, axially symmetric, and fixed relative to the geometry: the
 * island does not move and neither does the sun. It is a vertex-colour ramp on
 * the skirt lathe, which `paintByFacing` already drives, at zero texels, zero
 * draw calls and zero CPU. That is precedented here rather than novel - decision
 * 97 records that blade-to-ground contact was moved into the grass's own vertex
 * colour for the same reason and does not depend on the pass at all.
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
   * 1.55 to 1.83, and this is the change that makes a cast shadow possible.
   *
   * The key is the ONLY term in the rig that raises a lit surface without
   * raising a shadowed one, because a shadow removes it and nothing else.
   * Integrated onto a deck top (`N = +Y`, `N.L` 0.6781) it delivers 0.5565 of
   * irradiance luminance per unit of intensity, and onto a shadowed deck it
   * delivers zero. So moving intensity out of the fills and into the key widens
   * the lit-to-shadowed ratio from both ends at once, where lowering the fills
   * alone only narrows the picture.
   *
   * Measured effect, modelled against the round-2 baseline: a lit deck holds at
   * 0.589 display (it was 0.600) while its cast shadow falls from 0.442 to
   * 0.382, so the contrast across a shadow edge goes 0.158 to 0.207. That also
   * moves the shell's key-to-open-shadow ratio from 1.83:1 to 2.60:1, which is
   * INTO the 2:1-3:1 window the budget block below claims for it and had
   * actually fallen out of.
   *
   * THE RISK, stated because it is the one this number carries. The directional
   * sum is now exactly at the 2.60 cap with no spare, and the key's own GGX lobe
   * on the shell's clearcoat rises 18% with it. `hub-backlit` is the shot whose
   * stated criterion is whether anything other than an emissive has crossed the
   * bloom threshold at a grazing angle, so that is where this shows up first.
   * If it does, the escape ladder at the bottom of this file applies unchanged.
   *
   * The key's DIRECTION is shared with `SkyDome`'s sun and must not move. Its
   * COLOUR is not shared, and `SkyDome` is owned by another stream: if the sun
   * disc and the key ever visibly disagree in temperature, this is the number
   * that moved and the sky is the thing to check against.
   */
  key: { color: '#ffe7bc', intensity: 1.83 },
  /**
   * The sky fill, 0.25 to 0.12.
   *
   * Its stated job is to give shadowed regions FORM rather than merely a lifted
   * floor, and the measurement that justifies cutting it is that at the two
   * vantages where that job matters it is not doing it.
   *
   * Form on a shadowed object means a difference between two of its faces. A
   * light whose azimuth lies on the camera axis lights both visible faces of a
   * box equally and produces none, whatever its intensity. This light sits at
   * azimuth 237.5 degrees; the camera at `hub-backlit` sits at 241.0 and at
   * `hub-grazing` at 240.9, so it is **3.4 degrees off the camera axis** in both
   * shots. On the hero's head there it reaches the front face at `N.L` 0.680 and
   * the side face at 0.711 - a 4% difference across a 90-degree corner.
   *
   * So at the two shots that need it, this light can only raise the level, and
   * the level is what round 2's F2 measured as too high. Its remaining 0.12 is
   * kept rather than zeroed because at `hub-establishing` and `hub-portal` it IS
   * 33-38 degrees off the camera axis and does real work.
   *
   * ITS AZIMUTH IS THE REAL FIX AND IS DELIBERATELY NOT DONE HERE. Moving it 40
   * to 60 degrees off the key's opposite would restore face-to-face contrast at
   * both backlit vantages for free. It is left alone because handoff item 3 is
   * about to move the rim for the same reason, and doing both in one round makes
   * neither attributable. They are one change and belong in one commit.
   *
   * The position's ELEVATION is unchanged and still load-bearing: at
   * (-11, 4.5, -7) it was 19 degrees up and a deck top caught it at `N.L` 0.328,
   * almost as much as a shadowed vertical caught. At y 2.4 it is 10.4 degrees
   * up, `N.L` on a deck top is 0.181 and `N.L` on a vertical facing it is 0.984.
   */
  skyFill: { color: '#9ec9f0', intensity: 0.12, position: [-11, 2.4, -7] as const },
  /**
   * The camera-relative rim. INTENSITY DELIBERATELY UNCHANGED at 0.55.
   *
   * Recorded here because it is the second largest single obstacle to a readable
   * cast shadow and the next round will want the number. Integrated onto a deck
   * top the rim deposits `sin(RIM_ELEV) * 0.55` of cool light, which is 0.1845
   * of irradiance luminance - 15.3% of everything a shadowed deck received
   * before this change and 19.1% of what it receives after. It is the largest
   * ANALYTIC term on a surface the key cannot reach.
   *
   * And on the hero's shadow side at `hub-backlit` it delivers exactly ZERO,
   * because at that vantage its azimuth has collapsed onto the key's (60.98
   * against 60.95 degrees, round 2's F3) and the camera-facing surfaces have
   * `N.L` -0.90. So trading rim intensity for key intensity would buy
   * cast-shadow contrast at no cost at all to the shot the rim exists for. That
   * trade is not taken here: handoff item 3 owns the rim, and arriving at it
   * with the intensity already moved would confound its result.
   *
   * `RIM_ELEV` is the cheaper half of the same trade and is also left alone:
   * 0.45 to 0.30 rad would cut the floor spill 32% (0.1845 to 0.1253) while
   * RAISING `cos(elevation)` on a vertical from 0.900 to 0.955. Round 4 should
   * price it alongside the azimuth.
   */
  rim: { color: '#bfeaff', intensity: 0.55, elevation: RIM_ELEV },
  /**
   * The camera-relative bounce fill, 0.20 to 0.10.
   *
   * This is the cheapest cut in the rig and the arithmetic is a one-liner: it is
   * aimed at `camAz` by construction, so its azimuth is **0 degrees off the
   * camera axis at every vantage, always**. It therefore cannot produce
   * face-to-face contrast on anything, ever. It can only raise the level of
   * whatever faces the camera - which at `hub-backlit` is the hero's shadow
   * side, where it was the third largest term at 0.1664 of irradiance luminance,
   * 16.7% of the total, against 0.0235 on a deck top.
   *
   * A 7:1 preference for camera-facing verticals over floors is exactly the
   * shape of the cut this round needs, which is why this one goes furthest.
   * It is halved rather than removed because at `low` it is the term that is
   * already absent, and taking it to zero would make `low` and `high` differ by
   * nothing at all in a place the tier ladder is meant to be invisible anyway.
   */
  bounceFill: { color: '#ffe9cf', intensity: 0.1, elevation: FILL_ELEV },
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
   *
   * BOTH COLOURS ARE UNCHANGED, and the ground colour is unchanged on purpose
   * against a suggestion that it was doing nothing. three computes
   * `mix(ground, sky, 0.5 * dot(N, up) + 0.5)`, so on a VERTICAL face the weight
   * is exactly 0.5 and the ground colour arrives at half strength - not "almost
   * nothing". Integrated, `#6fbe3d` puts (0.162, 0.515, 0.045) of linear green
   * into every vertical surface in the level, and the hemisphere term on the
   * hero's shadow side is (0.182, 0.327, 0.248): the greenest thing reaching it.
   * The hero's shadow side is not grey because the ambient is grey. See the
   * emissive note in the budget block at the bottom of this file for what it
   * actually is.
   *
   * `scale` is here because `quality.hemisphereIntensity` lives in
   * `quality.ts`, which is owned elsewhere, and the hub needs 0.34 where the
   * tier ladder offers 0.55. It is a MULTIPLIER rather than a clamp so that the
   * ladder survives: 0.60/0.55/0.55 becomes 0.372/0.341/0.341, low still above
   * medium, every tier still inside the bible's 0.60 cap with room to spare.
   *
   * Why the hemisphere is the right thing to cut this hard. Its only variation
   * is with world up, so between two VERTICAL faces of the same object it is
   * perfectly uniform - on a box in shadow it is an `ambientLight` wearing a
   * different name, and section 5 of the budget block bans `ambientLight` for
   * precisely that reason. It was the largest single term on the hero's shadow
   * side at 0.2901, 29.2%, and it contributed nothing to describing the shape.
   */
  hemisphere: { sky: '#bcd6ee', ground: '#6fbe3d', scale: 0.62 },
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
  /**
   * Peak radiance 0.952, EXACTLY as before: `1.36 * 0.70 == 1.12 * 0.85`.
   * 1.52x under the threshold, the margin it had at 1.75.
   */
  keySoftbox: 1.36,
  /**
   * Peak radiance 1.088, EXACTLY as before: `1.5543 * 0.70 == 1.28 * 0.85`.
   * 1.33x under, the margin it had at 1.75. Still the hottest card.
   */
  highlightStrip: 1.5543,
  /**
   * `scene.environmentIntensity`, 0.85 to 0.70, and the reason the two numbers
   * above moved with it.
   *
   * The environment does two unrelated jobs through one scalar. Its DIFFUSE
   * contribution to a surface is `radiance * solid angle`, integrated - that is
   * ambient fill, and it was the largest single term on every shadowed surface
   * measured this round: 40.5% of the hero's shadow side at `hub-backlit` and
   * 51.0% of a shadowed deck top. Its SPECULAR contribution is bounded by peak
   * RADIANCE alone, because a prefiltered cubemap lookup cannot exceed its own
   * brightest texel, and that is what makes the clearcoat read as moulded
   * plastic and what the bloom margins are computed against.
   *
   * Lowering `environmentIntensity` alone would cut both. So the two cards whose
   * job is specular are scaled by the reciprocal, `0.85 / 0.70`, which holds
   * their peak radiance bit-for-bit and therefore holds every bloom margin and
   * every assertion in `Lighting.test.ts` about them. What falls by 17.6% is the
   * ambient fill from the broad dim cards and the background, which is the only
   * part this round wanted.
   *
   * THIS IS A HARD FLOOR AT 0.68. The highlight strip has to rise as this falls,
   * and `1.28 * 0.85 / 0.68 = 1.60` is exactly the bible's single-Lightformer
   * cap. Below 0.68 the strip breaches it and the peak can no longer be held, so
   * anything further has to come from card SIZES instead - halving a card's area
   * halves its diffuse contribution and leaves its peak radiance untouched.
   *
   * AND A MECHANISM WORTH KNOWING, verified in three 0.185.1 rather than assumed.
   * `WebGLRenderer` sets `envMapIntensity` from `scene.environmentIntensity` for
   * any Standard/Physical material whose own `envMap` is null
   * (`WebGLRenderer.js:2693`), and `refreshMaterialUniforms` only writes
   * `material.envMapIntensity` back when `material.envMap` is set
   * (`WebGLMaterials.js:404`). Nothing in this project sets a per-material
   * `envMap`, so this ONE number is the environment's contribution to every
   * material in the hub, and every per-material `envMapIntensity` in
   * `materials.ts` is dead: the shell's 1.15, the grass blades' 0.6, the island
   * skirt's 0.4 and `flock()`'s 0.3 are all silently replaced by this value.
   * That is why there is no way to dim the environment on the hero without also
   * dimming it on the grass, and why the grass's "compensate with
   * `envMapIntensity`" comment does not describe what runs.
   */
  intensity: 0.7,
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
        args={[
          HUB_RIG.hemisphere.sky,
          HUB_RIG.hemisphere.ground,
          quality.hemisphereIntensity * HUB_RIG.hemisphere.scale,
        ]}
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
        The ambient floor, `#243a52` to `#1d2a3c`, and the card that turned out
        to be the `ambientLight` this rig bans.

        The virtual scene drei renders these into has NO background, so every
        gap between cards clears to black and the clearcoat reflects a void,
        which is one of the two reasons gloss currently reads as generic shine
        rather than as moulded plastic. That job is real and is why this card
        stays rather than going away.

        But read the mechanism honestly. A uniform radiance filling the whole
        sphere delivers `PI * L * environmentIntensity` of irradiance to EVERY
        normal identically, with no dependence on the normal at all - which is
        the exact definition of the `ambientLight` that section 5 of the budget
        block below bans, in the same terms, for removing the shading it is meant
        to lift. At `#243a52` and 0.85 that came to 0.109 of irradiance
        luminance before the other cards occluded part of the sphere, which is a
        fifth of the whole hemisphere light. Measured through the occlusion it
        was delivering 0.0780 to a shadowed deck top (6.5% of everything it
        received) and 0.0589 to the hero's shadow side (5.9%), all of it
        structureless.
        `#1d2a3c` cuts that by 56% and keeps a dark blue in the darkest
        reflection, which is the part that was earning its place.
      */}
      <color attach="background" args={['#1d2a3c']} />

      {/*
        Key softbox, at the key directional's own bearing. It has to be at the
        same bearing or the reflections in the clearcoat disagree with where the
        shadows fall, which reads as wrong immediately even though nobody can
        name it.

        1.12 to 1.36 is NOT a brightness change. `environmentIntensity` went
        0.85 to 0.70 and this rises by the reciprocal, so its peak radiance is
        still exactly 0.952 and its bloom margin is still exactly 1.52x. See
        `HUB_ENV.intensity`.

        THE MEASUREMENT THIS CARD SHOULD BE JUDGED ON, and the reason the next
        round may want to shrink it. It sits at azimuth 60.3 degrees, which is
        the key's own 60.95, so a deck top sees it almost head on - and it
        delivered 0.3797 of irradiance luminance there, which was **31.5% of
        everything a SHADOWED deck received** and is 39.4% after this round's
        cuts. It is now the largest single term on any surface the key cannot
        reach.

        That is a copy of the key light that no shadow map can occlude, sitting
        at the key's own bearing, and it is the single biggest reason a cast
        shadow does not read on this island. It is left at 10 x 10 m here
        because its diffuse contribution scales with AREA while its specular peak
        does not, so the cut is free of bloom consequences but not free of value
        consequences: it lifts the LIT deck by the same 0.3797, and the lit deck
        is already only 0.03 clear of the 0.56 gameplay floor with the lawn
        already below it. Shrinking this card to 6.5 m would take a shadowed deck
        down another 0.219 of irradiance and buy roughly 0.03 more of shadow
        contrast, at the cost of pushing the lit deck to 0.56. That is the right
        trade to make in the round that raises the lawn, and the wrong one to
        make before it.
      */}
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

        1.28 restored the margin the design chose: peak radiance
        `1.0 * 1.28 * 0.85 = 1.088`, which is 1.33x under 1.45. It is still the
        hottest card in the rig and still the brightest thing a shell can
        reflect. Fixing this here rather than by dimming the emissives is
        deliberate: the emissives are the things that are meant to bloom.

        1.28 to 1.5543 holds that peak EXACTLY while `environmentIntensity` falls
        to 0.70: `1.0 * 1.5543 * 0.70 = 1.088`. Nothing about this card's
        appearance or its bloom margin changes.

        It is also what puts the floor under `environmentIntensity`. At 0.68 this
        number would be 1.60, which is the bible's cap on a single Lightformer,
        so 0.68 is as low as the ambient fill can be taken by this route.
      */}
      <Lightformer
        intensity={HUB_ENV.highlightStrip}
        position={[-4, 9, 4]}
        scale={[16, 0.55, 1]}
        color="#ffffff"
      />

      {/*
        Cool sky wrap: large, low, opposite the key. This is the environment half
        of the coloured-shadow story - a surface turned away from the key sees
        mostly this card, so its reflections stay blue instead of being
        neutralised by the softbox.

        0.60 to 0.36, and the reason is that the "coloured" half of that story
        was pointing at the wrong colour. Measured, this card was the single
        largest ENVIRONMENT term on the hero's shadow side at `hub-backlit`:
        0.1988 of irradiance luminance, 20.0% of everything that surface
        received, more than the two analytic fills put together. It is at azimuth
        233 degrees and the camera at that shot is at 241, so it sits almost
        exactly behind the lens and lands squarely on the visible shadow side.

        The reference brief's rule is that the shadow side of white plastic takes
        the LEVEL'S dominant hue. This level's dominant hue is a saturated green
        lawn. This card was making it blue, on top of a hemisphere whose sky half
        is also blue and a background card that is also blue. Cutting it is the
        largest single chroma correction available, and the green is left to the
        ground bounce card below, which has real directional structure where a
        uniform blue wash has none.

        Not cut further because on a deck top it only delivers 0.0574, so it is
        nearly free there, and it is the only thing keeping the anti-sunward
        reflections in the clearcoat from going neutral.
      */}
      <Lightformer intensity={0.36} position={[-8, 3, -6]} scale={[14, 9, 1]} color="#8ec8f0" />

      {/*
        Ground bounce: the grass, seen from below, filling undersides.

        Deliberately UNCHANGED at 0.30, having been raised to 0.66 and reverted,
        and the failed experiment is recorded because it is the trap in this part
        of the rig.

        16 x 16 m at 4.72 m out subtends most of the lower hemisphere, so it is
        the only term that reaches a downward-facing normal in any quantity, and
        it is the greenest thing in the environment. Raising it looked like the
        obvious way to serve two things at once: put the level's green onto the
        hero's shadow side, and put light on the island underside that decision
        97 makes the darkest thing in the world.

        It does neither cleanly, because the environment is a distant IBL with no
        positional falloff, so the same card lights the island's keel and the
        robot's chin by exactly the same amount. At 0.66 the chin went from 0.461
        to 0.504 display while the front of the head went to 0.430: the chin ends
        up BRIGHTER than the face above it, which reads as uplighting and is a
        worse defect than the one it was fixing. The green on the shadow side has
        to come from the hemisphere's ground half instead, where the same 50%
        vertical weight applies but the chin is not singled out.

        What this card DOES control is whether the island's underside can occupy
        the 0.06-0.18 anchor band at all, and after this round's cuts it is
        marginal: a downward-facing surface at `palette.soil` `#6b4d31` lands at
        0.048 display, BELOW the band's floor, and at the skirt's brighter cliff
        albedo `#8a6440` it lands at 0.072, inside it. That is a fact the stream
        building the keel needs and cannot see from here.
      */}
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

        UNCHANGED, and now measured, because "its occlusion is the mechanism" was
        an assertion nobody had put a number on. Sweeping the whole sphere of
        normals and integrating the environment with and without this card: the
        most irradiance it removes from ANY normal is **0.0341 of luminance**, at
        azimuth 30 degrees on the horizon, where it covers 29.8% of the
        cosine-weighted hemisphere. For scale, the hemisphere light delivers
        0.19-0.36 and the key softbox card 0.38. So the mechanism is real but the
        magnitude is a rounding error: it is worth about a tenth of the
        hemisphere, and on the two surfaces this round is about it is worth
        nothing at all - on a deck top it contributes 0.0003 and occludes
        essentially nothing, and on the hero's shadow side at `hub-backlit` its
        direction is 142 degrees away from the normal, so it is not in that
        hemisphere at any point.

        Decision 97 already says a second one will not produce an anchor. This
        confirms it and gives the reason: at 7.6 m from the cube camera on the
        low +Z side, it is nowhere near the surfaces that need darkening, and
        moving it somewhere useful would put it in front of the key softbox,
        which is the one card whose specular the whole clearcoat read depends on.
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
    key            #ffe7bc  dir (9, 9.5, 5)         1.83          1.83
    sky fill       #9ec9f0  world (-11, 2.4, -7)    0.12          1.95
    rim / kicker   #bfeaff  camera-relative         0.55          2.50
    bounce fill    #ffe9cf  camera-relative         0.10          2.60
                                                   -------------------
                                        CAP 2.60   TOTAL 2.60   SPARE 0.00

    THE SPARE IS GONE and that is deliberate. The caps in the bible are maxima,
    not targets, and this round's whole finding is that the budget was being
    spent on the wrong terms rather than that there was too little of it. 0.38
    moved out of the two fills and into the key, which is the only term a shadow
    can remove. If a later round needs headroom back, the rim's 0.55 is the
    cheapest 0.15 in the table: see `HUB_RIG.rim`.

  HEMISPHERE       sky #bcd6ee / ground #6fbe3d
                   quality tier 0.60 / 0.55 / 0.55
                   x HUB_RIG.hemisphere.scale 0.62
                   = 0.372 / 0.341 / 0.341        CAP 0.60
                   (the low tier is the high one, which drops the bounce fill)

  RIM SUB-CAP                                      0.55   CAP 0.60

  AMBIENT LIGHT    none, and there must not be one. ambientLight has no normal
                   dependence, so it removes the shading it is meant to lift.
                   The hemisphere does the same job and keeps the form.

  ENVIRONMENT      radiance = linear(color) * Lightformer.intensity
                                            * scene.environmentIntensity (0.70)
                   Peak radiance is the ceiling on ANY specular reflection,
                   because a prefiltered cubemap lookup cannot exceed its own
                   brightest texel. This is why the env is provably bloom-safe
                   and an analytic light is not.

                                       intensity   peak radiance   margin
    ambient floor  #1d2a3c  background      -          0.032        45.9x
    key softbox    #fff3e2  [7, 7.5, 4]     1.36       0.952         1.52x
    highlight strip #ffffff [-4, 9, 4]      1.5543     1.088         1.33x  <- hottest
    cool sky wrap  #8ec8f0  [-8, 3, -6]     0.36       0.220         6.60x
    ground bounce  #9ecf6a  [1, -4.5, -1]   0.30       0.131        11.07x
    negative fill  #0b0f1a  [3, -0.5, 7]    1.00       0.007       201x     <- darkest
    rim card       #cfeeff  [-2, 5, -9]     0.80       0.560         2.59x
                                       -------------------------------------
                        CAP 1.60 each   MAX 1.5543   PEAK 1.088 vs 1.45

    The two peaks that matter did not move at all. `environmentIntensity` fell
    0.85 to 0.70 and the softbox and the strip rose by the reciprocal, so
    `1.36 * 0.70` and `1.5543 * 0.70` are the same 0.952 and 1.088 they were at
    `1.12 * 0.85` and `1.28 * 0.85`. What fell is the DIFFUSE fill from the four
    broad dim entries, which is `radiance * solid angle` rather than radiance and
    is therefore not what the bloom column measures. The strip is now 0.046 under
    the single-card cap, which is what fixes `environmentIntensity`'s floor at
    0.68.

    The margin column is against BLOOM_THRESHOLD, and it is a column rather
    than a sentence because the threshold moved once already, from a guessed
    1.75 to a measured 1.45, and these two cards were not re-derived when it
    did. Their margins silently fell to 1.10x and 1.26x, which is how a white
    dome came to clip and spill at a grazing angle in `hub-backlit`.
    `Lighting.test.ts` now recomputes this column from BLOOM_THRESHOLD.

  TEMPERATURE, on a horizontal deck (albedo #bfbbb4, display warmth +11)

    Total irradiance R-B, by term, N = +Y, at hub-establishing:

      key            +0.617      rim            -0.115
      key softbox    +0.100      hemisphere     -0.120
      bounce fill    +0.005      background     -0.053
                                 cool wrap      -0.032
                                 rim card       -0.017
                                 sky fill       -0.012
                                       ------------------
                                       TOTAL    +0.374 (was +0.058)

    METHOD NOTE, so the two columns are not naively diffed. The environment rows
    above are now a ray-traced cosine-weighted integral of the six cards and the
    background from the cube camera's own position at the origin, WITH card-on-card
    occlusion, rather than the solid-angle estimate the previous column used. The
    directional and hemisphere rows are unchanged in method. The env rows moved by
    more than their intensities did, and that is the method rather than the rig.

    A shadowed deck sits at R-B -0.243, so the temperature axis now runs +0.374
    to -0.243 where it ran +0.058 to about -0.16. Cool shadows against warm
    highlights, wider than before, which is what the reference brief asks for.

    The rim's -0.115 is unavoidable and is not a defect: a camera-relative rim
    at 26 degrees deposits `sin(26) * 0.55` of cool light on every horizontal
    surface in the level. It is the price of the rim and it is paid knowingly -
    but see `HUB_RIG.rim`, because in LUMINANCE rather than temperature that same
    spill is 0.1845, the largest analytic term on any shadowed floor in the level.

  WHAT A SHADOW ACTUALLY REMOVES, which is the finding this round exists for

    Decision 97 states that "a shadowed surface still receives 1.00 of
    directional plus hemisphere 0.55 plus environment 0.85 against a key of 1.55,
    so occluding the key removes well under half the light". The conclusion is
    right and the reasoning does not survive being computed, because intensity is
    not delivered radiance. Integrated onto a deck top before this round:

      key softbox CARD      0.3797   31.5%   <- unshadowable, at the key's bearing
      hemisphere            0.3573   29.7%
      rim directional       0.1845   15.3%
      background card       0.0780    6.5%
      cool sky wrap card    0.0574    4.8%
      highlight strip card  0.0536    4.5%
      rim card              0.0443    3.7%
      sky fill directional  0.0250    2.1%
      bounce fill direction 0.0235    2.0%
      negative fill card    0.0003    0.0%
                          --------
                            1.2036 of irradiance luminance, against 2.0660 lit,
                            so a shadow removed 41.7% of the light and not "well
                            under half" - close to half, and still not enough.

    The two fills decision 97 names are the ninth and tenth entries on that list
    and are worth 4.0% of it between them. The three largest entries are a
    Lightformer at the key's own bearing that no shadow map can occlude, a
    hemisphere light, and the rim's spill. That is why this round moved intensity
    INTO the key rather than only out of the fills.

    On the hero's shadow side at hub-backlit the ranking is completely different -
    hemisphere 29.2%, cool wrap card 20.0%, bounce fill 16.7%, sky fill 13.6% -
    and there the two fills ARE worth 30.4%. The two acceptance surfaces this
    round is judged on do not share a dominant term, and treating them as one
    problem is what made the previous two rounds disagree.

  THE RIG IS AXIAL AT THE TWO BACKLIT VANTAGES, WHICH IS WHY THE HERO HAS NO FORM

    Round 2's F2 reports the hero's head at hub-backlit running 0.562 to 0.604
    over 170 px of "a curved surface" and calls it a lighting failure. It is not
    one, and no intensity in this file can fix it. Two independent reasons, both
    arithmetic.

    FIRST, every analytic light is on the camera axis there. A light whose
    azimuth lies on the camera axis reaches both visible faces of a box equally
    and contributes NO face-to-face contrast, whatever its intensity. Degrees off
    the camera axis, per vantage:

                       establ. portal charac. grazing totem backlit
      key                41.7    37.2    16.5     0.1   18.4    0.0
      rim                16.0    14.5     6.8     0.0    7.6    0.0
      sky fill           38.3    33.8    13.1     3.3   14.9    3.4
      bounce fill         0.0     0.0     0.0     0.0    0.0    0.0
      cool wrap card     33.9    29.4     8.7     7.7   10.5    7.8
      rim card            6.7    11.2    31.9    48.3   30.1   48.4

    At hub-backlit and hub-grazing every analytic light is within 3.4 degrees of
    the camera axis. The bounce fill is at 0.0 everywhere BY CONSTRUCTION, since
    it is aimed at `camAz`. The hemisphere has no azimuthal dependence at all. So
    at those two shots the only term with any azimuthal structure left is the rim
    CARD, at 48 degrees off-axis and 5.3% of the light. On the head, the sky fill
    reaches the front face at N.L 0.680 and the side face at 0.711 - 4% across a
    90-degree corner. Measured through the whole pipeline, the front-to-side step
    is 0.027 display before this round and 0.030 after it. The level moved 0.114
    and the form did not move at all, exactly as this table predicts.

    SECOND, the surface is not curved. `HEAD_SHELL` is a 0.72 x 0.54 x 0.62
    rounded box with corner radius 0.11, so 0.32 m of its 0.54 m height - 59%, and
    79 px of the 133 px it occupies at hub-backlit - is a single FLAT face with one
    normal, which no light can put a gradient across. `playerFacing` -1.33 puts the
    front face 42.8 degrees off the camera bearing and the side face 47.2, so the
    vertical corner fillet sits within 4.3 degrees of facing the lens, i.e. at the
    head's centre column near x = 830. The critique's probe column is x = 820. It
    runs DOWN the corner fillet rather than across the form. And the camera is
    3.5 degrees above the head centre at 6.21 m, so the only surfaces the key
    reaches - the up-facing ones - are within 3.5 degrees of edge-on and the
    terminator has almost no pixels to occupy. The crown-to-shadow-side step is
    0.163 before and 0.266 after, and it lives in a two-pixel sliver.

    THE FIX IS AN AZIMUTH, NOT AN INTENSITY, and it is handoff item 3 plus the
    sky fill's azimuth, which are the same change and should land together.

  AND THE HERO'S SHADOW SIDE IS NOT GREY BECAUSE THE AMBIENT IS GREY

    F2's other half is that the shadow side measures rgb (141,154,152),
    saturation 0.084, in a saturated green level. The rig is not the cause. The
    irradiance arriving on that surface is (0.696, 1.070, 1.134) in linear rgb -
    a ratio of 0.61 : 0.94 : 1.00, strongly chromatic, and its greenest single
    term is the hemisphere's ground colour at (0.182, 0.327, 0.248).

    What neutralises it is `shell()` in materials.ts, which carries
    `emissive: '#ffb489'` at `emissiveIntensity: 0.08`. That is a CONSTANT
    (0.0800, 0.0365, 0.0200) of warm radiance added to every pixel of the hero
    regardless of lighting - 0.0446 of luminance, 23.5% of the shadow side's
    total, in a hue almost exactly opposite the one the rig delivers. Setting it
    to zero and changing nothing else takes that surface from 0.583 at saturation
    0.053 to 0.498 at saturation 0.267, a 5x chroma change from one constant.

    It also gets WORSE as the fill comes down, because a fixed term is a larger
    share of a smaller total. After this round the shadow side reads 0.469 at
    saturation 0.173 and warmth +22: the saturation target is met, and it is met
    in orange rather than in the level's green. materials.ts is not owned by this
    file, so this is recorded rather than fixed. Anyone chasing "the shadow side
    should take the level's hue" needs that 0.08 at or below 0.02 first.

  MEASURED / DERIVED HEADROOM
    peak lit diffuse on the shell   ~0.54 luminance
    open shadow side                ~0.19 luminance   ratio 2.8:1 (target 2:1-3:1)
                                    NOTE: those two are analytic-only. Including
                                    the environment integral the same ratio was
                                    1.83:1 before this round, i.e. OUTSIDE the
                                    2:1-3:1 window the line claims, and is 2.60:1
                                    after it. The environment was 30-51% of the
                                    light and was never in this figure.
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
