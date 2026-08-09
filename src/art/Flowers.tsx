import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type InstancedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { GameContext } from '@/game/GameContext'
import { palette } from './palette'
import { createDaisyGeometry } from './flowerGeometry'
import { clusterCentres, clusteredPlacements, type Exclusion, type Placement } from './placement'
import { useQuality } from './useQuality'

/**
 * The flower field, and every flower in the world.
 *
 * This is the single element that does the most for how the world reads. A
 * ground plane with things standing on it looks like a level; a ground plane
 * you cannot see because it is full of flowers looks like a place.
 *
 * **Two families, one system.** `Scatter.tsx` used to grow its own stem-and-dome
 * flowers on top of the daisies this file already places, from the same sampler
 * and with no knowledge of them, at a cost of three extra draw calls and two
 * more materials. The two are not redundant: a blue daisy and a small pink dome
 * are visually distinct and the pink is doing real work as the only warm accent
 * in the lawn. So they are consolidated rather than deleted, and they now share
 * one sampler, one set of patch centres, one wind clock and one shader patch.
 * One draw call per family, and the pink domes grow in the same drifts as the
 * daisies instead of forming a second field with its own layout.
 *
 * Within the daisies there are two colour variants rather than one. Colour
 * variation is what stops a large field reading as wallpaper, and two geometries
 * is the cheapest way to get it: per-instance tint would mean setting
 * instanceColor before the material first compiles, which is fragile, and a
 * second draw call costs nothing next to what is being drawn.
 */

/**
 * The daisy, in metres, and a substantial reduction.
 *
 * The old defaults put the head at 0.20 m across before the per-instance scale
 * multiplied it by up to 1.8, so the largest daisies were 0.36 m wide standing
 * next to a 1.40 m robot. They read as dinner plates. At 0.11 m across before a
 * multiplier that now tops out at 1.35, the largest head is 0.147 m and the
 * tallest flower reaches 0.32 m, which sits just under the tallest grass at
 * 0.45 and is what the environment spec asks for: the flowers live inside the
 * field rather than above it.
 */
const DAISY = {
  petals: 9,
  stemHeight: 0.22,
  petalLength: 0.045,
  petalWidth: 0.018,
  centreRadius: 0.016,
} as const

/**
 * The pink dome, the other family, also in metres.
 *
 * Deliberately shorter than the daisy. Two ground-cover species at the same
 * height read as one species in two colours; a low dome under a taller daisy
 * reads as two things growing together, and it is the same reasoning that makes
 * the grass a gradient rather than a single height.
 */
const DOME = {
  stemHeight: 0.13,
  headRadius: 0.05,
  headHeight: 0.035,
  sides: 10,
  rings: 3,
} as const

/**
 * Sway at the head, as a fraction of the flower's own height.
 *
 * A ratio rather than an absolute displacement, so both families sway by the
 * same proportion of themselves and one shader patch serves both. The previous
 * absolute 0.06 m was authored against a 0.26 m stem, which is this same 0.23
 * ratio; 0.20 is a touch stiffer, which is right now that a flower is a smaller
 * object next to grass that moves more.
 */
const SWAY_RATIO = 0.2

/**
 * Player displacement, matching `Grass.tsx`.
 *
 * The radius is identical on purpose: the two layers have to agree about where
 * the player is or the boundary between pushed grass and unpushed flowers is
 * visible as a ring. The amplitude is 0.4x the grass's 0.55, because a daisy on
 * a stem is stiffer than a blade, and the vertical gate is the same 1.90 m -
 * 1.20 m of real clearance plus the 0.70 m from the capsule's centre to its
 * feet, since the follow target publishes the body transform.
 */
const PUSH_RADIUS = 0.7
const PUSH_AMPLITUDE = 0.4 * 0.55
const PUSH_HEIGHT = 1.9

/**
 * The wind clock and the player position, shared by every flower material.
 *
 * Module scope rather than per component. Both are genuinely global - there is
 * one breeze and one player - and both batches have to agree on them or the two
 * colours of daisy sway out of step with each other. It is also what lets the
 * shader patch below be a module-level function with stable identity, which is
 * the rule the art bible sets for every `onBeforeCompile` in this codebase.
 */
const flowerUniforms = {
  uTime: { value: 0 },
  uPlayerPos: { value: /*@__PURE__*/ new Vector3(0, -1000, 0) },
}

const FLOWER_TOKENS = ['#include <common>', '#include <begin_vertex>'] as const

/**
 * Wind and player displacement on an instanced flower.
 *
 * `onBeforeCompile` receives the shader with its `#include` directives still
 * unresolved, so only directives can be matched and never chunk bodies. The
 * guard is what keeps a three upgrade that renames a chunk from turning the
 * whole field into a silent no-op.
 */
function patchFlowerShader(shader: WebGLProgramParametersWithUniforms) {
  for (const token of FLOWER_TOKENS) {
    if (!shader.vertexShader.includes(token)) {
      if (import.meta.env.DEV) {
        console.warn(
          `Flowers: "${token}" is not in the standard vertex shader, so the wind ` +
            `and displacement patch was skipped. Flowers will draw, but frozen.`,
        )
      }
      return
    }
  }

  shader.uniforms.uTime = flowerUniforms.uTime
  shader.uniforms.uPlayerPos = flowerUniforms.uPlayerPos

  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform vec3 uPlayerPos;
        /*
          Height up the flower, 0 at the root and 1 at the head, written by
          addBend below. An attribute rather than position.y / stemHeight
          with the stem height compiled in, so that one patch serves both
          families without either a per-material uniform or a second shader.
        */
        attribute float aBend;
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
            flower through the ground. Scaled by position.y as well, which is
            what makes both the wind and the push below a proportion of the
            flower rather than an absolute distance, so a 0.13 m dome does not
            swing as far as a 0.22 m daisy.
          */
          float bend = aBend * aBend * position.y;

          transformed.x += gust * bend * ${SWAY_RATIO.toFixed(4)};
          transformed.z += gust * bend * ${(SWAY_RATIO * 0.4).toFixed(4)};

          /*
            Player displacement.

            transformed is in the instance's own space and is not multiplied
            by instanceMatrix until three's instancing chunk runs later, while
            the direction away from the player is a world-space vector. Every
            instance carries a yaw, so the direction has to be rotated into the
            instance's frame or the flowers would splay along whichever way each
            one happens to be facing rather than away from the robot. The basis
            comes out of the matrix's own columns, normalised because the
            placement scale is baked into them.
          */
          vec2 toFlower = iPos.xz - uPlayerPos.xz;
          float playerDistance = length(toFlower);
          float push = 1.0 - smoothstep(0.0, ${PUSH_RADIUS.toFixed(3)}, playerDistance);
          // Vertical gate, so a player on a deck does not flatten the lawn
          // underneath it.
          push *= 1.0 - step(${PUSH_HEIGHT.toFixed(3)}, abs(iPos.y - uPlayerPos.y));

          if (push > 0.0) {
            vec3 away = vec3(toFlower.x, 0.0, toFlower.y) / max(playerDistance, 1e-4);
            float instanceScale = max(length(instanceMatrix[0].xyz), 1e-6);
            vec3 localX = instanceMatrix[0].xyz / instanceScale;
            vec3 localZ = instanceMatrix[2].xyz / instanceScale;
            vec2 awayLocal = vec2(dot(away, localX), dot(away, localZ));

            transformed.xz += awayLocal * push * bend * ${PUSH_AMPLITUDE.toFixed(4)};
            transformed.y -= push * bend * ${(PUSH_AMPLITUDE * 0.45).toFixed(4)};
          }
        #endif
      `,
    )
}

function createMaterial() {
  const material = new MeshStandardMaterial({
    // Petals are single-sided strips. Without this a flower loses half its head
    // whenever the camera crosses its plane.
    side: DoubleSide,
    /*
      Down from 0.72, and up on the environment, which is the compensation for
      deliberately staying off `MeshPhysicalMaterial`. Petals are the shinier of
      the two vegetation layers, so they get more of both than the grass does.
      Clearcoat behind a field this size to put a highlight on a two centimetre
      petal is the trade the art bible names as the worst available.
    */
    roughness: 0.58,
    metalness: 0,
    envMapIntensity: 0.7,
    // Stem, petal and centre colours all arrive this way, from one geometry.
    vertexColors: true,
  })

  material.onBeforeCompile = patchFlowerShader
  return material
}

/**
 * Tag every vertex with how far up the flower it sits.
 *
 * Clamped a little above 1 so a petal tip that reaches past the nominal stem
 * height still travels slightly more than the head it is attached to, which is
 * what keeps a head from reading as a rigid disc on a bending wire.
 */
function addBend(geometry: BufferGeometry, stemHeight: number): BufferGeometry {
  const position = geometry.getAttribute('position')
  const bend = new Float32Array(position.count)
  for (let i = 0; i < position.count; i++) {
    bend[i] = Math.min(Math.max(position.getY(i) / stemHeight, 0), 1.25)
  }
  geometry.setAttribute('aBend', new BufferAttribute(bend, 1))
  return geometry
}

/**
 * The pink dome: a stem holding up a low, wide cap.
 *
 * Built here rather than reused from the daisy generator because the shape is
 * the whole point. A dome catches the key as one broad soft highlight where a
 * daisy's petals break it into nine, so the two families read as different
 * plants at a glance and at any distance, which is what earns the second draw
 * call. Vertex colours carry the two materials, exactly as the daisy does, so
 * the pair still costs one draw each.
 */
function createDomeFlowerGeometry(headColor: string, stemColor: string): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const head = new Color(headColor)
  const stem = new Color(stemColor)

  const push = (x: number, y: number, z: number, c: Color) => {
    const index = positions.length / 3
    positions.push(x, y, z)
    colors.push(c.r, c.g, c.b)
    return index
  }

  // Stem, a thin tapered tube. Authored at its final size, so no caller has to
  // know a scale convention.
  const stemSides = 5
  const bottom = 0.006
  const top = 0.004
  const rings: number[][] = []
  for (const [y, r] of [
    [0, bottom],
    [DOME.stemHeight, top],
  ] as const) {
    const ring: number[] = []
    for (let i = 0; i < stemSides; i++) {
      const a = (i / stemSides) * Math.PI * 2
      ring.push(push(Math.cos(a) * r, y, Math.sin(a) * r, stem))
    }
    rings.push(ring)
  }
  for (let i = 0; i < stemSides; i++) {
    const j = (i + 1) % stemSides
    indices.push(rings[0][i], rings[1][i], rings[0][j])
    indices.push(rings[0][j], rings[1][i], rings[1][j])
  }

  // The cap, as latitude rings up to an apex. Wider than it is tall so it reads
  // as facing upward.
  const capRings: number[][] = []
  for (let r = 0; r < DOME.rings; r++) {
    const a = (r / DOME.rings) * (Math.PI / 2)
    const radius = DOME.headRadius * Math.cos(a)
    const y = DOME.stemHeight + DOME.headHeight * Math.sin(a)
    const ring: number[] = []
    for (let i = 0; i < DOME.sides; i++) {
      const t = (i / DOME.sides) * Math.PI * 2
      ring.push(push(Math.cos(t) * radius, y, Math.sin(t) * radius, head))
    }
    capRings.push(ring)
  }
  const apex = push(0, DOME.stemHeight + DOME.headHeight, 0, head)

  for (let r = 0; r < capRings.length - 1; r++) {
    for (let i = 0; i < DOME.sides; i++) {
      const j = (i + 1) % DOME.sides
      indices.push(capRings[r][i], capRings[r + 1][i], capRings[r][j])
      indices.push(capRings[r][j], capRings[r + 1][i], capRings[r + 1][j])
    }
  }
  const last = capRings[capRings.length - 1]
  for (let i = 0; i < DOME.sides; i++) {
    indices.push(last[i], apex, last[(i + 1) % DOME.sides])
  }

  // Closed underneath. The material is double sided so an open dome would show
  // its own inside at a grazing angle, which is exactly the angle a lawn is
  // seen from.
  const underside = push(0, DOME.stemHeight, 0, head)
  for (let i = 0; i < DOME.sides; i++) {
    indices.push(capRings[0][i], underside, capRings[0][(i + 1) % DOME.sides])
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function FlowerBatch({
  placements,
  geometry,
  /** Size at the edge of a patch, and the extra size at its middle. */
  minSize,
  densitySize,
}: {
  placements: Placement[]
  geometry: BufferGeometry
  minSize: number
  densitySize: number
}) {
  const mesh = useRef<InstancedMesh>(null)
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
        patch from reading as a cut line. It is the same `density` the grass
        scales its height by, so the two layers agree about where a patch is
        thickest.
      */
      dummy.scale.setScalar(p.scale * (minSize + p.density * densitySize))
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [placements, minSize, densitySize])

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

  /*
    Read out of context rather than threaded down as a prop, matching `Grass`.
    Nullable, so the field still renders in a scene with no player at all.
  */
  const game = useContext(GameContext)
  const follower = useRef(new Vector3())
  const following = useRef(false)

  useFrame((state, delta) => {
    flowerUniforms.uTime.value = state.clock.elapsedTime

    const target = game?.player.current?.position
    if (!target) return

    if (!following.current) {
      follower.current.copy(target)
      following.current = true
    } else {
      // Chase fast, release slow. See the same block in `Grass.tsx`; the two
      // must use the same rates or the layers disagree about where the player
      // was a tenth of a second ago.
      const rate = follower.current.distanceTo(target) > 0.02 ? 20 : 4
      follower.current.lerp(target, 1 - Math.exp(-rate * Math.min(delta, 0.1)))
    }

    flowerUniforms.uPlayerPos.value.copy(follower.current)
  })

  const plantRadius = radius * 0.94

  /*
    One set of patch centres for every flower in the scene.

    Both families sample from these rather than from their own, which is what
    makes the pink domes grow among the daisies rather than beside them. Two
    layers with independent centres fill each other's gaps and average back out
    to a uniform mat, which is precisely the look the clustering exists to
    avoid, and it is a failure that reads as clutter rather than as a bug.
  */
  const centres = useMemo(
    () =>
      clusterCentres({
        // Large, generous patches. The reference's foreground is one enormous
        // drift of daisies rather than many small dots of colour.
        clusters: Math.max(4, Math.round(quality.flowers / 260)),
        radius: plantRadius,
        seed: 91,
      }),
    [quality.flowers, plantRadius],
  )

  const daisyPlacements = useMemo(
    () =>
      clusteredPlacements({
        count: quality.flowers,
        radius: plantRadius,
        centres,
        clusterRadius: 3.4,
        exclusions,
        seed: 91,
        minScale: 0.75,
        maxScale: 1.25,
      }),
    [quality.flowers, plantRadius, centres, exclusions],
  )

  const domePlacements = useMemo(
    () =>
      clusteredPlacements({
        /*
          Scaled by prop density rather than by the flower count, because this
          family used to live in `Scatter.tsx` and is still doing a scatter's
          job: a sparse warm accent through a cool field, not a second field.
        */
        count: Math.round(110 * quality.propDensity),
        radius: plantRadius,
        centres,
        // Tighter than the daisies, so the domes pool at the hearts of the
        // patches instead of ringing them.
        clusterRadius: 2.4,
        exclusions,
        seed: 41,
        minScale: 0.8,
        maxScale: 1.4,
      }),
    [quality.propDensity, plantRadius, centres, exclusions],
  )

  // Split by index rather than by a second sampling pass, so the two variants
  // interleave inside every patch instead of forming two separate fields.
  const primary = useMemo(() => daisyPlacements.filter((_, i) => i % 3 !== 0), [daisyPlacements])
  const secondary = useMemo(() => daisyPlacements.filter((_, i) => i % 3 === 0), [daisyPlacements])

  const primaryGeometry = useMemo(
    () =>
      addBend(
        createDaisyGeometry({
          ...DAISY,
          petalColor: palette.flower,
          centreColor: palette.flowerCentre,
          stemColor: palette.grassDeep,
        }),
        DAISY.stemHeight,
      ),
    [],
  )

  const secondaryGeometry = useMemo(
    () =>
      addBend(
        createDaisyGeometry({
          ...DAISY,
          petalColor: palette.flowerPale,
          centreColor: palette.flowerCentre,
          stemColor: palette.grassDeep,
        }),
        DAISY.stemHeight,
      ),
    [],
  )

  const domeGeometry = useMemo(
    () => addBend(createDomeFlowerGeometry(palette.token, palette.grassDeep), DOME.stemHeight),
    [],
  )

  return (
    <group>
      <FlowerBatch
        placements={primary}
        geometry={primaryGeometry}
        minSize={0.72}
        densitySize={0.36}
      />
      <FlowerBatch
        placements={secondary}
        geometry={secondaryGeometry}
        minSize={0.72}
        densitySize={0.36}
      />
      <FlowerBatch
        placements={domePlacements}
        geometry={domeGeometry}
        minSize={0.8}
        densitySize={0.4}
      />
    </group>
  )
}
