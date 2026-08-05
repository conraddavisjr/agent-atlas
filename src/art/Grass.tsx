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

export type GrassExclusion = {
  /** Centre on the ground plane. */
  x: number
  z: number
  /** Nothing is planted within this distance of the centre. */
  radius: number
}

/**
 * Deterministic pseudo-random.
 *
 * Placement must be identical between the visual pass and any later pass that
 * needs to agree with it, and it must not change between reloads. Math.random
 * gives a field that reshuffles every time the scene remounts, which is visible
 * as the world rearranging itself behind a portal transition.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function Grass({
  radius,
  exclusions = [],
  seed = 1337,
}: {
  /** Outer radius of the plantable area. */
  radius: number
  /** Circles to keep clear: platforms, ramps, plinths. */
  exclusions?: GrassExclusion[]
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
        .replace(
          '#include <color_vertex>',
          /* glsl */ `
            #include <color_vertex>
            vColor *= iColor;
          `,
        )
    }

    return m
  }, [])

  const { count, offsets, params, colors } = useMemo(() => {
    const rand = mulberry32(seed)
    const target = quality.grassBlades
    const plantRadius = Math.min(radius, quality.grassRadius)

    const offsets = new Float32Array(target * 3)
    const params = new Float32Array(target * 3)
    const colors = new Float32Array(target * 3)

    /*
      Blades run lighter than the ground texture they stand in, not darker.
      Matching the ground was the first attempt and it made the field disappear
      into it: a blade is thin, and at any distance it survives by contrasting
      with what is behind it rather than by its own shape. Real grass helps
      here, since a blade catches sky along its length while the soil between
      blades does not.
    */
    const base = new Color(palette.grass).lerp(new Color('#ffffff'), 0.22)
    const deep = new Color(palette.grassDeep)
    const scratch = new Color()

    let n = 0
    // Bounded rather than "until we have enough", so heavy exclusion can only
    // thin the field, never hang the load.
    for (let attempt = 0; attempt < target * 3 && n < target; attempt++) {
      // sqrt keeps the distribution even per unit area. Sampling the radius
      // uniformly instead crowds everything into the middle.
      const r = Math.sqrt(rand()) * plantRadius
      const a = rand() * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r

      let blocked = false
      for (const e of exclusions) {
        if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.radius * e.radius) {
          blocked = true
          break
        }
      }
      if (blocked) continue

      // Thin toward the rim so the field fades out instead of ending on a line.
      const edge = r / plantRadius
      if (edge > 0.82 && rand() < (edge - 0.82) / 0.18) continue

      const i3 = n * 3
      offsets[i3] = x
      offsets[i3 + 1] = 0
      offsets[i3 + 2] = z

      // Yaw, then height and width in metres. A blade is roughly ankle high and
      // a few centimetres across; the ratio between the two is what makes it
      // read as grass rather than as a leaf or a shard.
      params[i3] = rand() * Math.PI * 2
      params[i3 + 1] = 0.3 + rand() * 0.34
      params[i3 + 2] = 0.035 + rand() * 0.03

      // Colour varies per blade, and the strip is darkened toward its root
      // through the vertex colour gradient applied below.
      scratch.copy(base).lerp(deep, rand() * 0.45)
      colors[i3] = scratch.r
      colors[i3 + 1] = scratch.g
      colors[i3 + 2] = scratch.b

      n++
    }

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
