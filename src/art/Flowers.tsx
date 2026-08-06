import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  DoubleSide,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { palette } from './palette'
import { createDaisyGeometry, DAISY_DEFAULTS } from './flowerGeometry'
import { clusteredPlacements, type Exclusion, type Placement } from './placement'
import { useQuality } from './useQuality'

/**
 * The flower field.
 *
 * This is the single element that does the most for how the world reads. A
 * ground plane with things standing on it looks like a level; a ground plane
 * you cannot see because it is full of flowers looks like a place.
 *
 * Two variants rather than one, splitting the same placements. Colour variation
 * is what stops a large field reading as wallpaper, and two geometries is the
 * cheapest way to get it: per-instance tint would mean setting instanceColor
 * before the material first compiles, which is fragile, and a second draw call
 * costs nothing next to what is being drawn.
 */

/** Amplitude of the sway at the head, in the geometry's own units. */
const SWAY = 0.06

/**
 * The wind clock, shared by every flower material.
 *
 * Module scope rather than per component. Time is genuinely global here, both
 * batches have to agree on it or the two colours of daisy would sway out of
 * step with each other, and a single object keeps it out of React entirely.
 */
const clock = { value: 0 }

function createMaterial() {
  const material = new MeshStandardMaterial({
    // Petals are single-sided strips. Without this a flower loses half its head
    // whenever the camera crosses its plane.
    side: DoubleSide,
    roughness: 0.72,
    metalness: 0,
    // Stem, petal and centre colours all arrive this way, from one geometry.
    vertexColors: true,
  })

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = clock

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
          #include <common>
          uniform float uTime;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
          #include <begin_vertex>

          #ifdef USE_INSTANCING
            /*
              Phase from the instance's world position, taken out of the
              translation column of its matrix. Sampling by position rather
              than by instance index is what makes this read as one breeze
              crossing the field instead of every flower nodding on its own
              clock, and it costs nothing extra.
            */
            vec3 iPos = instanceMatrix[3].xyz;
            float gust =
              sin(iPos.x * 0.4 + iPos.z * 0.3 + uTime * 1.3) +
              sin(iPos.x * 0.9 - iPos.z * 0.6 + uTime * 2.1) * 0.4;

            /*
              Weighted by height up the stem, squared, so the base stays planted
              and the head travels. Bending uniformly would drag the whole
              flower through the ground.
            */
            float bend = position.y / ${DAISY_DEFAULTS.stemHeight.toFixed(4)};
            bend = clamp(bend, 0.0, 1.4);
            bend *= bend;

            transformed.x += gust * bend * ${SWAY.toFixed(4)};
            transformed.z += gust * bend * ${(SWAY * 0.4).toFixed(4)};
          #endif
        `,
      )
  }

  return material
}

function FlowerBatch({
  placements,
  petalColor,
  centreColor,
}: {
  placements: Placement[]
  petalColor: string
  centreColor: string
}) {
  const mesh = useRef<InstancedMesh>(null)

  const geometry = useMemo(
    () =>
      createDaisyGeometry({
        petalColor,
        centreColor,
        stemColor: palette.grassDeep,
      }),
    [petalColor, centreColor],
  )

  const material = useMemo(() => createMaterial(), [])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const dummy = new Object3D()
    placements.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z)
      dummy.rotation.set(0, p.yaw, 0)
      /*
        Bigger toward the middle of a patch. Real ground cover is not uniform
        within a clump either, and the size gradient is what keeps the edge of a
        patch from reading as a cut line.
      */
      dummy.scale.setScalar(p.scale * (0.75 + p.density * 0.45))
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [placements])

  if (placements.length === 0) return null

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, placements.length]}
      /*
        Casting matters here more than anywhere else in the scene. A field of
        flowers with no shadows under it floats; with them it sits in the
        ground. This is the most expensive shadow work in the world and it is
        worth all of it.
      */
      castShadow
      receiveShadow
    />
  )
}

export function Flowers({
  radius,
  exclusions = [],
}: {
  radius: number
  exclusions?: Exclusion[]
}) {
  const quality = useQuality()

  useFrame((state) => {
    clock.value = state.clock.elapsedTime
  })

  const placements = useMemo(
    () =>
      clusteredPlacements({
        count: quality.flowers,
        radius: radius * 0.94,
        // Large, generous patches. The reference's foreground is one enormous
        // drift of daisies rather than many small dots of colour.
        clusters: Math.max(4, Math.round(quality.flowers / 260)),
        clusterRadius: 3.4,
        exclusions,
        seed: 91,
        minScale: 0.75,
        maxScale: 1.5,
      }),
    [quality.flowers, radius, exclusions],
  )

  // Split by index rather than by a second sampling pass, so the two variants
  // interleave inside every patch instead of forming two separate fields.
  const primary = useMemo(() => placements.filter((_, i) => i % 3 !== 0), [placements])
  const secondary = useMemo(() => placements.filter((_, i) => i % 3 === 0), [placements])

  return (
    <group>
      <FlowerBatch
        placements={primary}
        petalColor={palette.flower}
        centreColor={palette.flowerCentre}
      />
      <FlowerBatch
        placements={secondary}
        petalColor={palette.flowerPale}
        centreColor={palette.flowerCentre}
      />
    </group>
  )
}
