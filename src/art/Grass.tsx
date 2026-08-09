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
 * this field is 220,000 instances of a sixteen-triangle blade: putting a
 * clearcoat GGX evaluation behind three and a half million triangles to add a
 * highlight to a three centimetre strip is the worst cost-to-benefit trade
 * available in the project. The compensations are roughness and
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
 * How dark the root of a blade is, as a fraction of its tip.
 *
 * Anything flatter and the field reads as a bright mat; anything darker and it
 * reads as scorched.
 */
const ROOT_SHADE = 0.32

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
        Blades run lighter than the ground they stand in. Matching the ground
        made the field disappear into it: a blade is thin, and at any distance
        it survives by contrasting with what is behind it rather than by its
        own shape.
      */
      scratch.copy(base).lerp(tip, p.density * 0.6).lerp(deep, (1 - p.density) * 0.35)
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
      The root-to-tip ramp, baked into the shared geometry's vertex colours and
      multiplied by the per-instance tint. Doing it here rather than per
      instance keeps it to one small buffer instead of one per blade.

      It is a ramp in hue as well as in value, and that is what stops a dense
      field reading as a flat green top. A greyscale ramp darkens the root and
      leaves it the same green as the tip, so from the camera's angle - which is
      looking down at a field of tips - the whole island averages to one colour.
      Ramping from a deep saturated green at the root to the instance's own tint
      at the tip means the gaps between blades are a different green from the
      blades themselves, and the field gains depth from a buffer of fifteen
      vertices rather than from more geometry.

      Smoothstepped rather than linear, which holds the same average value but
      spends more of the blade at each end: a longer dark base and a longer lit
      cap, with the transition in the middle where the eye reads it as shading.
    */
    const root = new Color(palette.grassDeep)
    // Normalised to its own brightest channel first, so ROOT_SHADE is a value
    // and the hue arrives at full strength rather than being pre-dimmed by
    // however dark grassDeep happens to be.
    const peak = Math.max(root.r, root.g, root.b)
    root.multiplyScalar(ROOT_SHADE / Math.max(peak, 1e-6))

    const vertexCount = m.geometry.getAttribute('position').count
    const shade = new Float32Array(vertexCount * 3)
    const uv = m.geometry.getAttribute('uv')
    for (let i = 0; i < vertexCount; i++) {
      const t = uv.getY(i)
      const s = t * t * (3 - 2 * t)
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
