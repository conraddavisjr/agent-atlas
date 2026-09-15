import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  RGBADepthPacking,
  Vector3,
  type InstancedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { GameContext } from '@/game/GameContext'
import { palette } from './palette'
import { clusteredPlacements, type Exclusion } from './placement'
import { useQuality } from './useQuality'

/**
 * The grass field.
 *
 * Every blade is real geometry in one InstancedMesh, not a texture on a plane
 * and not a billboard. That matters at this camera height: the player is close
 * enough to the ground that cards give themselves away the moment the view
 * rotates, and the whole point of this pass is that the world stops reading as
 * a prototype.
 *
 * Four things separate convincing grass from a field of green spikes, and none
 * of them is blade count:
 *
 *   Scale, which is the one this field got wrong. See BLADE below.
 *
 *   Darkening toward the root, which stands in for the light the blades block
 *   from each other. Without it a dense field reads as a flat bright mat.
 *
 *   Variation in every axis. Uniform height and uniform colour are what make
 *   instanced geometry look instanced.
 *
 *   Wind that is coherent across space rather than per blade. Random per-blade
 *   phase is a shimmer; a travelling wave is wind.
 *
 * Built on MeshStandardMaterial through onBeforeCompile rather than a bespoke
 * ShaderMaterial, so three's lighting, fog and shadow receiving all keep
 * working. Reimplementing those to get a sway would be a bad trade.
 *
 * It stays on MeshStandardMaterial, and that is a decision rather than an
 * omission. `MeshPhysicalMaterial` would give the blades the clearcoat that
 * makes everything else in this world read as moulded, and at the high tier
 * this field is 204,408 instances of an eight-triangle blade, which measures as
 * 4.9M triangles a frame across the colour, shadow and ambient-occlusion depth
 * passes: putting a clearcoat GGX evaluation behind that to add a highlight to
 * a three centimetre strip is the worst cost-to-benefit trade in the project. The compensations are roughness and
 * `envMapIntensity`, and they cost nothing.
 */

/** Vertices along one edge of a blade. More is smoother bend, and more cost. */
const SEGMENTS = 4

/**
 * The size of a blade, in metres, and the most visible single number in the
 * scene.
 *
 * **The field used to be a jungle.** Height was `(0.3 + density * 0.34) * scale`
 * with `scale` in 0.70 to 1.35, so a blade at the middle of a clump reached
 * 0.86 m. The robot is 1.40 m tall. Grass at 0.86 comes up past its waist,
 * which hides the contact shadow that glues the toy to the floor, hides the
 * ground plane the player is reading to navigate, and averages the whole island
 * into one green texture that destroys the value read the entire art direction
 * rests on.
 *
 * At 0.11 to 0.45 the tallest blade reaches the robot's knee at the thickest
 * part of a clump and its ankle at the edges. A lawn you stand in rather than a
 * meadow you wade through.
 *
 * Width comes down with it. A blade's width-to-height ratio is what decides
 * whether it reads as a blade or as a leaf, and holding the old widths against
 * half the height would have turned the field into ground-cover foliage.
 */
const BLADE = {
  /** Height at the edge of a patch, before the per-instance scale. */
  minHeight: 0.16,
  /** Extra height at the middle of a patch, where a clump is thickest. */
  densityHeight: 0.2,
  minWidth: 0.02,
  densityWidth: 0.016,
  minScale: 0.7,
  maxScale: 1.25,
} as const

/**
 * Contact shading at the blade's root: how dark, how far up, and how coloured.
 *
 * This replaces a ramp that ran the full length of every blade from 0.32 at the
 * root to 1.0 at the tip. That ramp was the second largest cause of the lawn
 * rendering at 0.22-0.46 display luma against a gameplay band of 0.56-0.74:
 * integrated over the blade's own tapering width it averaged **0.5615**, so the
 * field's effective albedo was a little over half its authored one before a
 * single photon was traced.
 *
 * The critique asks for two things that sound contradictory and are not - the
 * field's overall value UP into the band, and *more* darkening where a blade
 * meets the ground. Confining the ramp to the bottom third does both at once.
 * The same buffer now averages **0.8342**, a 1.49x lift on the field's albedo,
 * while the very root goes from 0.32 to 0.24, which is darker than it has ever
 * been. Value is an average and contact is a gradient; spending the darkening
 * where the eye reads it as occlusion instead of spreading it over the whole
 * blade is the entire trick.
 *
 * The blade has five rows of vertices, so at `height` 0.34 the darkening lands
 * on the bottom two and reaches full brightness by the third. On a 0.16 to 0.45
 * m blade that is a 4 to 11 cm band at the base, which is the right physical
 * scale for the light a neighbouring blade blocks.
 *
 * `neutralise` is the third number and it exists because the old root was
 * `grassDeep` normalised to its brightest channel, which put the red channel at
 * 0.084 while green sat at 0.32. Occlusion is light that did not arrive, not a
 * hue; a root that kills red four times harder than green is a green filter,
 * and it showed up in the frame as a lawn whose red channel measured 8/255
 * against a green of 68/255. Pulling the hue 45% back toward neutral keeps the
 * deep-green cast that gives the field depth without the channel skew: across
 * the three changes here the blade's effective albedo gains 1.61x in luma and
 * **2.07x in red**, which is where the frame's colour cast was coming from.
 */
const CONTACT = {
  /** Value at the very root, as a fraction of the blade's own tint. */
  shade: 0.55,
  /** How far up the blade the darkening reaches, as a fraction of its height. */
  height: 0.28,
  /** How far the root's hue is pulled back toward neutral, 0 to 1. */
  neutralise: 0.45,
} as const

/**
 * How far a blade's shading normal is bent toward world up, 0 to 1.
 *
 * **This is the single biggest lever on the lawn's rendered value and the whole
 * of what fixes it.** A blade is authored with a near-horizontal normal -
 * `(-0.35, 0.2, 0.9)` normalised has an up component of 0.20 - and the material
 * is `DoubleSide`, so three flips that normal on every back face. At a grazing
 * camera angle, which is the angle a lawn is seen from almost all of the time,
 * most of what the camera sees is the half of each blade facing away from the
 * key. Those fragments receive *no direct light at all*: their entire
 * illumination is the hemisphere's sky term and the environment, both of which
 * are blue. That is measurable in the baseline frame and it is not subtle - the
 * near lawn in `hub-grazing` reads (8.7, 68.3, 26.9), a blue-lit green, where
 * the ground plane beside it reads (116.6, 173.3, 89.9).
 *
 * Bending the shading normal toward up is the standard answer and it is an art
 * decision rather than a cheat: a lawn is read as a *surface*, so it should
 * shade like the surface it grows out of and take the key at the same angle the
 * ground does. Both faces of a blade then light the same way, and the field
 * gains its shape back from the contact ramp and the silhouette rather than
 * from half of it being unlit.
 *
 * At 0.65 there is still a third of the real normal left, which is what keeps
 * the key running along the blades in the direction of the wind instead of
 * flattening the field into a green sheet. **0.65 is an estimate, not a
 * measurement** - it is the one number in this file that has to be bisected
 * against a captured frame, which is why it travels as a uniform.
 */
const UP_BIAS = 0.65

/**
 * How far the player pushes blades aside, in metres.
 *
 * The capsule radius is 0.35, so this is the capsule plus a 0.35 skirt: wide
 * enough to be felt and narrow enough not to look like a force field.
 */
const PUSH_RADIUS = 0.7

/**
 * Vertical reach of the push, in metres, measured from the player's body centre
 * to the ground a blade grows on.
 *
 * The gate exists so that a player standing on a deck does not flatten the lawn
 * underneath it, which is the one way this effect can look like a bug rather
 * than like grass. The number is 1.20 m of real clearance plus the 0.70 m that
 * separates the capsule's centre from its feet - `capsuleHalfHeight` plus
 * `capsuleRadius` in `tuning.ts` - because the follow target publishes the body
 * transform rather than the feet.
 */
const PUSH_HEIGHT = 1.9

/**
 * One blade, built as a tapered strip standing on the XZ plane.
 *
 * Authored once and shared by every instance. The curve is baked into the
 * geometry rather than applied in the shader because it never changes; only the
 * wind on top of it does.
 */
function createBladeGeometry(): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  /*
    Half a unit, so the strip spans exactly one unit across and the per-instance
    width parameter is then a width in metres rather than a multiplier of an
    arbitrary base. Getting this wrong is not subtle: at half a metre the blades
    came out wider than they were tall and the field read as scattered glass.
  */
  const halfWidth = 0.5

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    // Taper to a point. Squared so the blade keeps its width low down and
    // narrows quickly near the tip, which is how grass actually looks.
    const width = halfWidth * (1 - t * t)
    // A gentle lean, so a blade is never a straight spike.
    const lean = t * t * 0.28

    positions.push(-width, t, lean, width, t, lean)
    // Faceted outward rather than flat, so a blade catches light along its
    // length instead of switching on and off as the camera passes its plane.
    normals.push(-0.35, 0.2, 0.9, 0.35, 0.2, 0.9)
    uvs.push(0, t, 1, t)

    if (i < SEGMENTS) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * The uniforms every blade material shares, at module scope.
 *
 * Module scope rather than a ref, for the same reason `Flowers.tsx` keeps its
 * clock there: time is genuinely global, there is exactly one player, and a
 * module-level object is what lets the shader patch below be a module-level
 * function with stable identity. three's default program cache key is
 * `onBeforeCompile.toString()`, so an inline closure per component still hits
 * the cache, but a stable function is the rule the art bible sets after this
 * codebase was cut four times by silent shader failures, and it is free.
 */
const grassUniforms = {
  uTime: { value: 0 },
  /** The lagged player position, in world space. */
  uPlayerPos: { value: /*@__PURE__*/ new Vector3(0, -1000, 0) },
  /**
   * See `UP_BIAS`.
   *
   * A uniform rather than a compiled-in constant so the value can be bisected
   * against a real frame without a rebuild - it stays reachable through the
   * material's own `uniforms` at runtime. Not exported, because this file
   * exports a component and the fast-refresh rule is right that mixing the two
   * costs a full reload on every edit.
   */
  uUpBias: { value: UP_BIAS },
}

/**
 * The directives this patch replaces.
 *
 * Named rather than inlined because they are also the guard. `onBeforeCompile`
 * receives the shader with its `#include` directives still **unresolved** -
 * three calls it at `WebGLRenderer` line 18210 and `resolveIncludes` does not
 * run until the program is built on the following line - so a patch that
 * searches for the *body* of a chunk matches nothing and silently does nothing.
 * Replacing the directive is the only form that works, and checking that the
 * directive is there is the only way to find out that a three upgrade renamed
 * it before the entire field disappears.
 */
const GRASS_TOKENS = [
  '#include <common>',
  '#include <begin_vertex>',
  '#include <beginnormal_vertex>',
  '#include <color_vertex>',
] as const

/**
 * The one directive the fragment side replaces.
 *
 * Separate from the vertex list because the two shaders are guarded
 * independently: a missing fragment token must leave the field lit the old way
 * rather than skipping the placement patch and stacking every blade on the
 * origin. `normal_fragment_begin` is the right hook because it is the point at
 * which three has already applied `faceDirection` - the `DOUBLE_SIDED` flip -
 * so the up bias lands on the normal that actually shades the fragment rather
 * than on one that is about to be negated on half the field.
 */
const GRASS_FRAGMENT_TOKENS = ['#include <common>', '#include <normal_fragment_begin>'] as const

/** The depth shader has no normals and no colour, so it patches two of the four. */
const GRASS_DEPTH_TOKENS = ['#include <common>', '#include <begin_vertex>'] as const

/**
 * The declarations, shared by the colour pass and the depth pass.
 *
 * Shared rather than written twice because the two passes must agree about
 * where a blade is to the last decimal. A shadow cast from geometry that is
 * even slightly different from the geometry that drew it is peter-panning or
 * acne, and here the difference would not be slight.
 */
const GRASS_COMMON = /* glsl */ `
  #include <common>
  uniform float uTime;
  uniform vec3 uPlayerPos;
  attribute vec3 iOffset;
  attribute vec3 iParams; // yaw, height, width
  attribute vec3 iColor;

  mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }
`

/** Where a blade actually is: instancing, wind, and the player's feet. */
const GRASS_VERTEX = /* glsl */ `
  vec3 transformed = position;

  transformed.x *= iParams.z;
  transformed.y *= iParams.y;

  /*
    Wind, as two waves of different wavelength and speed travelling
    across the field. Sampling by world position rather than by
    instance is what makes it read as a gust crossing the island
    instead of every blade twitching on its own clock.
  */
  float w1 = sin(iOffset.x * 0.35 + iOffset.z * 0.22 + uTime * 1.6);
  float w2 = sin(iOffset.x * 0.9 - iOffset.z * 0.7 + uTime * 2.7) * 0.45;
  float gust = w1 + w2;

  /*
    Weighted by height along the blade, squared. The root is planted
    and the tip travels; bending uniformly would slide the whole blade
    through the ground.
  */
  float bendWeight = position.y * position.y;
  transformed.x += gust * bendWeight * 0.42 * iParams.y;
  transformed.z += gust * bendWeight * 0.16 * iParams.y;

  transformed.xz = rot(iParams.x) * transformed.xz;

  /*
    Player displacement.

    Deliberately AFTER the yaw rotation, which is where the environment
    spec puts it wrongly. The push direction is a world-space vector from
    the player to the blade, and applying it before the rotation would
    spin that direction by each blade's own yaw, so blades would scatter
    in every direction rather than away from the player. The wind above
    can live on the near side of the rotation because bending along the
    blade's local X is bending in the plane of the strip, which is what
    a blade of grass actually does.

    Weighted by the same squared height as the wind, so the root stays
    planted and the tip travels, and scaled by the blade's own height so
    a short blade at the edge of a clump moves less than a tall one in
    the middle.
  */
  vec2 toBlade = iOffset.xz - uPlayerPos.xz;
  float playerDistance = length(toBlade);
  float push = 1.0 - smoothstep(0.0, ${PUSH_RADIUS.toFixed(3)}, playerDistance);
  // Vertical gate, so grass under a deck is not flattened by a player
  // standing on top of it.
  push *= 1.0 - step(${PUSH_HEIGHT.toFixed(3)}, abs(iOffset.y - uPlayerPos.y));
  vec2 away = toBlade / max(playerDistance, 1e-4);
  transformed.xz += away * push * bendWeight * 0.55 * iParams.y;
  transformed.y -= push * bendWeight * 0.25 * iParams.y;

  transformed += iOffset;
`

/**
 * The blade's shading normal, bent toward world up. See `UP_BIAS`.
 *
 * `viewMatrix` is declared in three's own fragment prefix - `WebGLProgram`
 * writes `uniform mat4 viewMatrix;` into every fragment shader it builds - so
 * world up in view space is its second column and needs no varying and no
 * uniform of ours. Doing it here rather than in the vertex shader is the whole
 * point: `normal_fragment_begin` has already multiplied by `faceDirection`, so
 * a back face arrives pointing *down* and a bias applied earlier would have
 * been flipped along with everything else, which is exactly the half of the
 * field that is dark today.
 *
 * `nonPerturbedNormal` is written too, because `lights_physical_fragment`
 * derives its `geometryRoughness` from that vector's screen-space derivative.
 * Leaving it as the raw per-blade normal would keep inflating roughness from
 * geometry the lighting no longer sees, which is the sort of half-applied patch
 * that reads as "the change did nothing" in a frame.
 */
const GRASS_NORMAL_FRAGMENT = /* glsl */ `
  #include <normal_fragment_begin>
  vec3 grassUp = normalize(viewMatrix[1].xyz);
  normal = normalize(mix(normal, grassUp, uUpBias));
  nonPerturbedNormal = normal;
`

/**
 * The fragment side's declarations.
 *
 * A `uniform` cannot be declared inside `main()`, and `normal_fragment_begin`
 * expands inside it, so the bias has to arrive through the fragment's own
 * `<common>` even though nothing else on this side needs patching.
 */
const GRASS_FRAGMENT_COMMON = /* glsl */ `
  #include <common>
  uniform float uUpBias;
`

/**
 * Instancing, wind and player displacement, patched into the standard shader.
 *
 * All or nothing. A partial patch is worse than no patch here: if `<common>`
 * applied and `<begin_vertex>` did not, every blade would collapse onto the
 * origin at unit scale rather than degrading to plain shading, so the guard
 * checks every token before writing any of them.
 */
function patchGrassShader(shader: WebGLProgramParametersWithUniforms) {
  for (const token of GRASS_TOKENS) {
    if (!shader.vertexShader.includes(token)) {
      if (import.meta.env.DEV) {
        console.warn(
          `Grass: "${token}" is not in the standard vertex shader, so the blade ` +
            `patch was skipped entirely. The field will not draw correctly. This ` +
            `means three renamed or restructured a chunk.`,
        )
      }
      return
    }
  }

  shader.uniforms.uTime = grassUniforms.uTime
  shader.uniforms.uPlayerPos = grassUniforms.uPlayerPos

  /*
    The fragment side is guarded and applied on its own, because the two halves
    fail differently. A vertex patch that half-applies puts 220,000 blades on
    the origin; a fragment patch that does not apply leaves the field lit the
    way it is lit today, which is wrong but is not a black screen. So a missing
    fragment token skips the up bias and lets the placement through, rather than
    taking the whole material down with it.
  */
  if (GRASS_FRAGMENT_TOKENS.every((token) => shader.fragmentShader.includes(token))) {
    shader.uniforms.uUpBias = grassUniforms.uUpBias
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', GRASS_FRAGMENT_COMMON)
      .replace('#include <normal_fragment_begin>', GRASS_NORMAL_FRAGMENT)
  } else if (import.meta.env.DEV) {
    console.warn(
      `Grass: the fragment shader is missing one of ${GRASS_FRAGMENT_TOKENS.join(', ')}, ` +
        `so the blades keep their raw near-horizontal normals. The field will render ` +
        `roughly half a stop dark and blue at grazing angles.`,
    )
  }

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', GRASS_COMMON)
    .replace('#include <begin_vertex>', GRASS_VERTEX)
    // Normals have to turn with the blade or every instance is lit as
    // though it faced the same way, which flattens the whole field.
    .replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
        vec3 objectNormal = normal;
        objectNormal.xz = rot(iParams.x) * objectNormal.xz;
      `,
    )
    /*
      Per-blade tint folded into the vertex colour, which already carries
      the root ramp from the shared geometry. Multiplying the two here
      rather than using InstancedMesh.instanceColor keeps it independent of
      when three decides to define USE_INSTANCING_COLOR, which depends on
      the attribute existing before the material first compiles.
    */
    /*
      Written against `.rgb` rather than the whole varying, because three
      does not always declare `vColor` with the same width.

      It is a vec3 normally and a vec4 once anything in the build enables the
      alpha-carrying colour path, and three 0.185 takes the vec4 branch here.
      `vColor *= iColor` then fails to compile with "cannot convert from
      3-component to 4-component", which takes the whole grass material down:
      the mesh stays in the scene, reports its full instance count, and draws
      nothing at all. Swizzling works on both widths and cannot regress the
      same way.
    */
    .replace(
      '#include <color_vertex>',
      /* glsl */ `
        #include <color_vertex>
        vColor.rgb *= iColor;
      `,
    )
}

/**
 * The same placement, patched into the depth material the shadow map uses.
 *
 * **Without this the grass casts the wrong shadow, and it is not a subtle
 * wrong.** `onBeforeCompile` belongs to a material, and the shadow map does not
 * render with the object's material: `WebGLShadowMap` swaps in a shared
 * `MeshDepthMaterial` unless the object supplies a `customDepthMaterial`. Every
 * blade in this field is placed entirely in the vertex shader from `iOffset`
 * and `iParams` - the instance matrices are all identity, and there is a
 * comment above saying exactly that - so an unpatched depth material draws all
 * 204,000 blades stacked on the origin at one metre tall and one metre wide,
 * and stamps a solid disc of shadow into the middle of the island.
 *
 * The colour pass and this one share `GRASS_COMMON` and `GRASS_VERTEX`, so the
 * shadow is cast by the same blade, in the same wind, pushed the same distance
 * by the same player. Anything less than that and the shadow separates from the
 * grass whenever the wind blows.
 *
 * The guard means the worst case is the previous behaviour rather than a black
 * screen: if a three upgrade moves either directive, the depth material stays
 * unpatched, which is where this started.
 */
function patchGrassDepthShader(shader: WebGLProgramParametersWithUniforms) {
  for (const token of GRASS_DEPTH_TOKENS) {
    if (!shader.vertexShader.includes(token)) {
      if (import.meta.env.DEV) {
        console.warn(
          `Grass: "${token}" is not in the depth vertex shader, so the shadow ` +
            `pass was left unpatched and every blade will cast from the origin.`,
        )
      }
      return
    }
  }

  shader.uniforms.uTime = grassUniforms.uTime
  shader.uniforms.uPlayerPos = grassUniforms.uPlayerPos

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', GRASS_COMMON)
    .replace('#include <begin_vertex>', GRASS_VERTEX)
}

export function Grass({
  radius,
  exclusions = [],
  seed = 1337,
}: {
  /** Outer radius of the plantable area. */
  radius: number
  /** Areas to keep clear: platforms, decks, plinths. */
  exclusions?: Exclusion[]
  seed?: number
}) {
  const quality = useQuality()
  const mesh = useRef<InstancedMesh>(null)

  /*
    The follow target, read straight out of context rather than threaded down
    as a prop. The player is not an art concern and the grass has no business
    knowing about the game, but the alternative is a prop drilled through
    HubIsland into three separate vegetation components purely to move one
    Vector3 per frame, and the context is nullable here so the field still
    renders in any scene that has no player at all.
  */
  const game = useContext(GameContext)
  const follower = useRef(new Vector3())
  const following = useRef(false)

  const geometry = useMemo(() => createBladeGeometry(), [])

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      // Lit from both faces. A blade is a single strip, so without this it
      // vanishes whenever the camera is on its far side, and a field of grass
      // flickers as the camera orbits.
      side: DoubleSide,
      /*
        Down from 0.85, which is the compensation for staying off clearcoat.
        At 0.85 a blade takes light almost perfectly diffusely and the field
        reads as flat green paper; at 0.62 there is enough directionality for
        the key to run along the blades in the direction of the wind, which is
        what moulded rubber does and is the most Astro-like thing this field
        can do for free.
      */
      roughness: 0.62,
      metalness: 0,
      // The other half of the compensation. The field picks up the sky from
      // the environment rig instead of only the analytic lights.
      envMapIntensity: 0.6,
      vertexColors: true,
    })

    m.onBeforeCompile = patchGrassShader
    return m
  }, [])

  /*
    The shadow map's own material. See `patchGrassDepthShader`.

    `RGBADepthPacking` is not optional: `WebGLShadowMap` packs depth into RGBA
    for its default material, and a `customDepthMaterial` that packs it any
    other way is read back as garbage depth. `DoubleSide` matches the colour
    pass, or a blade's shadow appears and disappears as the sun crosses its
    plane.
  */
  const depthMaterial = useMemo(() => {
    const m = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
      side: DoubleSide,
    })
    m.onBeforeCompile = patchGrassDepthShader
    return m
  }, [])

  const { count, offsets, params, colors } = useMemo(() => {
    const plantRadius = Math.min(radius, quality.grassRadius)

    /*
      Clumped, through the same sampler the flowers use, and that shared sampler
      matters as much as the clumping. Three layers of ground cover scattered
      independently would each fill the gaps the others left and average back
      out to a uniform mat, which is the look the clumping exists to avoid.
    */
    const placements = clusteredPlacements({
      count: quality.grassBlades,
      radius: plantRadius,
      clusters: Math.max(8, Math.round(quality.grassBlades / 1400)),
      clusterRadius: 2.2,
      exclusions,
      seed,
      minScale: BLADE.minScale,
      maxScale: BLADE.maxScale,
    })

    const n = placements.length
    const offsets = new Float32Array(n * 3)
    const params = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)

    /*
      `palette.grass`, deliberately unchanged.

      The blade albedo at 0.668 display luma is inside the gameplay band and the
      critique this pass answers says so explicitly: "the albedo is already
      correct at 0.668 - the loss is in the render". Every change in this file
      is therefore aimed at what happens to that albedo between here and the
      screen, and none of it is aimed at the number itself. There is a further
      1.15x sitting in the difference between this and `groundBaseColor()` at
      0.726, which is also inside the band, and it is the next lever if the
      measured field still falls short - but reaching for it first would be
      correcting a render fault in the palette, which is exactly the mistake the
      critique's verdict is about.

      The comment that used to sit here claimed blades "run lighter than the
      ground they stand in". They do not and never did: 0.668 against the
      ground's 0.726.
    */
    const base = new Color(palette.grass)
    const tip = new Color(palette.grassTip)
    const deep = new Color(palette.grassDeep)
    const scratch = new Color()

    placements.forEach((p, i) => {
      const i3 = i * 3
      offsets[i3] = p.x
      offsets[i3 + 1] = 0
      offsets[i3 + 2] = p.z

      /*
        Height and width in metres, not multipliers. Taller toward the middle of
        a clump, which gives the field a silhouette instead of a flat top, and
        is the same gradient the flowers use so the two agree about where a
        patch is thickest.
      */
      params[i3] = p.yaw
      params[i3 + 1] = (BLADE.minHeight + p.density * BLADE.densityHeight) * p.scale
      params[i3 + 2] = BLADE.minWidth + p.density * BLADE.densityWidth

      /*
        Hue variation across a patch, at an amplitude that no longer moves the
        field's value.

        The pull toward `grassDeep` at the edge of a clump was 0.35 and is now
        0.14. `grassDeep` is 0.405 display luma against a base of 0.668, so at
        0.35 the thin outer blades - which is most of them, because a clump has
        more edge than middle - were being dragged a third of the way to the
        midground band by the placement sampler. Colour variation is worth
        having and it is worth having as *hue* rather than as value; the value
        variation the field needs comes from the contact ramp below, where it is
        attached to a real cause.
      */
      scratch.copy(base).lerp(tip, p.density * 0.45).lerp(deep, (1 - p.density) * 0.14)
      colors[i3] = scratch.r
      colors[i3 + 1] = scratch.g
      colors[i3 + 2] = scratch.b
    })

    return { count: n, offsets, params, colors }
  }, [quality.grassBlades, quality.grassRadius, radius, exclusions, seed])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return

    m.geometry.setAttribute('iOffset', new InstancedBufferAttribute(offsets, 3))
    m.geometry.setAttribute('iParams', new InstancedBufferAttribute(params, 3))
    m.geometry.setAttribute('iColor', new InstancedBufferAttribute(colors, 3))

    /*
      The contact ramp, baked into the shared geometry's vertex colours and
      multiplied by the per-instance tint. Doing it here rather than per
      instance keeps it to one small buffer instead of one per blade.

      This is the ambient occlusion at the blade-to-ground contact that
      `hub-grazing`'s own acceptance criterion names and that the frame does not
      currently have: measured, ground between blades 0.646 and blade 0.234,
      with no transition of any kind between them, so the field reads as dark
      hair glued to a pale mat. A vertical gradient in the blade's own vertex
      colour is very nearly free - fifteen vertices, shared by every instance -
      and it is the only place a per-blade contact shadow can be had at this
      instance count at all.

      It is a ramp in hue as well as in value, and that is what stops a dense
      field reading as a flat green top: the gaps between blades are a different
      green from the blades themselves, so the field gains depth from a buffer
      rather than from more geometry. The hue is only pulled `CONTACT.neutralise`
      of the way to full strength now - see `CONTACT` for why a fully saturated
      root was quietly acting as a red filter over the biggest surface in the
      level.

      Smoothstepped over `CONTACT.height` rather than over the whole blade,
      which is the change that lets the field be brighter overall and darker at
      the contact at the same time.
    */
    const root = new Color(palette.grassDeep)
    // Normalised to its own brightest channel first, so `CONTACT.shade` is a
    // value and the hue arrives at a known strength rather than being pre-dimmed
    // by however dark grassDeep happens to be.
    const peak = Math.max(root.r, root.g, root.b)
    root.multiplyScalar(1 / Math.max(peak, 1e-6))
    // Written channel by channel rather than through a Color setter, for the
    // same reason the buffer below is: these are already in the renderer's
    // linear working space and every setter has an opinion about that.
    root.r = (root.r + (1 - root.r) * CONTACT.neutralise) * CONTACT.shade
    root.g = (root.g + (1 - root.g) * CONTACT.neutralise) * CONTACT.shade
    root.b = (root.b + (1 - root.b) * CONTACT.neutralise) * CONTACT.shade

    const vertexCount = m.geometry.getAttribute('position').count
    const shade = new Float32Array(vertexCount * 3)
    const uv = m.geometry.getAttribute('uv')
    for (let i = 0; i < vertexCount; i++) {
      const t = uv.getY(i)
      const u = Math.min(t / CONTACT.height, 1)
      const s = u * u * (3 - 2 * u)
      // Written straight into the buffer rather than through a Color, because
      // these are already in the renderer's linear working space and every
      // Color setter has an opinion about which space its arguments are in.
      shade[i * 3] = root.r + (1 - root.r) * s
      shade[i * 3 + 1] = root.g + (1 - root.g) * s
      shade[i * 3 + 2] = root.b + (1 - root.b) * s
    }
    m.geometry.setAttribute('color', new BufferAttribute(shade, 3))

    /*
      One identity matrix for every instance. All placement happens in the
      vertex shader from iOffset and iParams, so the matrices exist only because
      InstancedMesh requires them, and leaving them unset would collapse every
      blade onto a zero-scale transform at the origin.
    */
    const identity = new Object3D()
    identity.updateMatrix()
    for (let i = 0; i < count; i++) m.setMatrixAt(i, identity.matrix)
    m.instanceMatrix.needsUpdate = true

    // The blades are placed by the shader, so three's automatic bounds are
    // wrong and the field would be frustum culled at the edges of the view.
    m.frustumCulled = false
  }, [offsets, params, colors, count])

  useFrame((state, delta) => {
    grassUniforms.uTime.value = state.clock.elapsedTime

    const target = game?.player.current?.position
    if (!target) return

    if (!following.current) {
      // Snap on the first frame. Lerping in from the origin would drag a
      // flattened trail of grass across the island on every scene load.
      follower.current.copy(target)
      following.current = true
    } else {
      /*
        A lagged position rather than the raw one, which is what turns a
        geometric effect into a tactile one: the push has to be immediate and
        the recovery has to be slow, or it reads as a shader trick rather than
        as grass.

        Two rates. While the player is moving the follower chases at 20, which
        at full speed leaves it trailing by 6.0 / 20 = 0.30 m - felt, and still
        well inside the 0.70 m push radius so the grass ahead of the robot is
        pushed before the robot reaches it. When the player stops, that last
        0.30 m closes at 4, which takes about a quarter of a second, and that
        quarter second is the blades standing back up.
      */
      const rate = follower.current.distanceTo(target) > 0.02 ? 20 : 4
      follower.current.lerp(target, 1 - Math.exp(-rate * Math.min(delta, 0.1)))
    }

    grassUniforms.uPlayerPos.value.copy(follower.current)
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, count]}
      customDepthMaterial={depthMaterial}
      /*
        Receiving is what puts the arch, the plinths and the robot onto the
        field, and it is nearly free. Casting means drawing every blade a second
        time into the shadow map, which is the most expensive single thing in
        the renderer, so it is reserved for the top tier.
      */
      receiveShadow
      castShadow={quality.grassCastShadow}
    />
  )
}
