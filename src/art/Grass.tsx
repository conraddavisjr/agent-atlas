import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'
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
 * Three things separate convincing grass from a field of green spikes, and none
 * of them is blade count:
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
 */

/** Vertices along one edge of a blade. More is smoother bend, and more cost. */
const SEGMENTS = 4

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

export function Grass({
  radius,
  exclusions = [],
  seed = 1337,
}: {
  /** Outer radius of the plantable area. */
  radius: number
  /** Circles to keep clear: platforms, ramps, plinths. */
  exclusions?: Exclusion[]
  seed?: number
}) {
  const quality = useQuality()
  const mesh = useRef<InstancedMesh>(null)
  const uniforms = useRef({ uTime: { value: 0 } })

  const geometry = useMemo(() => createBladeGeometry(), [])

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      // Lit from both faces. A blade is a single strip, so without this it
      // vanishes whenever the camera is on its far side, and a field of grass
      // flickers as the camera orbits.
      side: DoubleSide,
      roughness: 0.85,
      metalness: 0,
      vertexColors: true,
    })

    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = uniforms.current.uTime

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            uniform float uTime;
            attribute vec3 iOffset;
            attribute vec3 iParams; // yaw, height, width
            attribute vec3 iColor;

            mat2 rot(float a) {
              float s = sin(a), c = cos(a);
              return mat2(c, -s, s, c);
            }
          `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
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
            transformed += iOffset;
          `,
        )
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
          the root darkening from the shared geometry. Multiplying the two here
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
      minScale: 0.7,
      maxScale: 1.35,
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
      params[i3 + 1] = (0.3 + p.density * 0.34) * p.scale
      params[i3 + 2] = 0.035 + p.density * 0.028

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
      Root darkening, baked into the shared geometry's vertex colours and
      multiplied by the per-instance tint. Doing it here rather than per
      instance keeps it to one small buffer instead of one per blade.
    */
    const vertexCount = m.geometry.getAttribute('position').count
    const shade = new Float32Array(vertexCount * 3)
    const uv = m.geometry.getAttribute('uv')
    for (let i = 0; i < vertexCount; i++) {
      // 0.32 at the root rising to 1 at the tip. Anything flatter and the field
      // reads as a bright mat; anything darker and it reads as scorched.
      const t = uv.getY(i)
      const s = 0.32 + 0.68 * t
      shade[i * 3] = s
      shade[i * 3 + 1] = s
      shade[i * 3 + 2] = s
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

  useFrame((state) => {
    uniforms.current.uTime.value = state.clock.elapsedTime
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, count]}
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
