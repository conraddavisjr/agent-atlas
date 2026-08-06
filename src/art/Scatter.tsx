import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Object3D,
  type BufferGeometry,
  type InstancedMesh,
} from 'three'
import { palette } from './palette'
import { plastic, stone } from './materials'
import { usePbrTextures } from './textures'
import { useQuality } from './useQuality'
import { evenPlacements, mulberry32, type Exclusion, type Placement } from './placement'

/**
 * Rocks, pebbles, clover and flowers scattered across the island.
 *
 * This is what stops the ground reading as a lawn with objects standing on it.
 * Grass alone is uniform, and uniformity is the tell; scatter breaks it up and
 * gives the eye something to measure distance against.
 *
 * All of it is instanced and none of it is collidable. A pebble the capsule can
 * catch on is worse than no pebble, and the plan of hand-authored colliders for
 * anything the player can touch is what keeps the ground walkable.
 */

/**
 * How far a flower head sits above the ground, in the geometry's own units.
 *
 * Shared by the head's placement offset and the stem's height so the two
 * cannot drift apart: change it and both move together.
 */
const FLOWER_HEIGHT = 3.4

/**
 * An irregular lump from a subdivided icosahedron.
 *
 * Pushing each vertex along its own normal by a repeatable amount is enough to
 * turn an obviously geometric solid into something that reads as weathered
 * stone, and it costs one pass over a few hundred vertices at load.
 */
function createRockGeometry(seed: number, detail = 1): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, detail)
  const rand = mulberry32(seed)
  const pos = geometry.getAttribute('position')

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const push = 0.72 + rand() * 0.5
    // Flattened vertically so rocks sit into the ground rather than looking
    // like balls resting on it.
    pos.setXYZ(i, x * push, y * push * 0.68, z * push)
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A ref for an InstancedMesh, with the placements already written into its
 * matrix buffer.
 *
 * Owns the ref rather than accepting one, so the mesh it writes to is the mesh
 * it created. Taking a caller's ref and mutating through it works, but it makes
 * the hook reach into something it does not own, which is both harder to follow
 * and what the immutability lint is pointing at.
 */
function useInstancedPlacements(placements: Placement[], baseScale: number, yOffset: number) {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const dummy = new Object3D()
    placements.forEach((p, i) => {
      dummy.position.set(p.x, yOffset * p.scale * baseScale, p.z)
      dummy.rotation.set(0, p.yaw, 0)
      dummy.scale.setScalar(p.scale * baseScale)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [placements, baseScale, yOffset])

  return mesh
}

export function Scatter({
  radius,
  exclusions = [],
}: {
  radius: number
  exclusions?: Exclusion[]
}) {
  const quality = useQuality()
  const rockStone = usePbrTextures('stone', [2, 2])

  const density = quality.propDensity

  // Three rock silhouettes rather than one, because a repeated boulder is more
  // obvious than a repeated blade of grass will ever be.
  const rockGeometries = useMemo(
    () => [createRockGeometry(11), createRockGeometry(29), createRockGeometry(47)],
    [],
  )
  const pebbleGeometry = useMemo(() => createRockGeometry(83, 0), [])

  const rockPlacements = useMemo(
    () =>
      evenPlacements({
        count: Math.round(26 * density),
        radius: radius * 0.95,
        exclusions,
        seed: 5,
        // Kept away from the middle, where the totems and the paths between
        // them are. Boulders belong at the edges of a space, not across it.
        minRadius: 6,
      }),
    [density, radius, exclusions],
  )

  const pebblePlacements = useMemo(
    () =>
      evenPlacements({
        count: Math.round(120 * density),
        radius: radius * 0.98,
        exclusions,
        seed: 17,
      }),
    [density, radius, exclusions],
  )

  const cloverPlacements = useMemo(
    () =>
      evenPlacements({
        count: Math.round(340 * density),
        radius: radius * 0.9,
        exclusions,
        seed: 23,
      }),
    [density, radius, exclusions],
  )

  const flowerPlacements = useMemo(
    () =>
      evenPlacements({
        count: Math.round(90 * density),
        radius: radius * 0.88,
        exclusions,
        seed: 41,
      }),
    [density, radius, exclusions],
  )

  /*
    Base scales in metres, and they matter more than anything else here.
    Everything in this file is nestling into grass roughly 30cm high, so a prop
    much over 20cm stops reading as ground cover and starts reading as debris.
  */
  const pebbles = useInstancedPlacements(pebblePlacements, 0.09, 0.45)
  const clover = useInstancedPlacements(cloverPlacements, 0.1, 0.35)
  const flowers = useInstancedPlacements(flowerPlacements, 0.05, FLOWER_HEIGHT)
  const stems = useInstancedPlacements(flowerPlacements, 0.05, 0)

  /*
    Leaf clumps.

    Subdivided twice rather than once, and squashed hard. The first attempt used
    a coarse icosahedron at the same scale as a rock, and a twenty-faced solid
    lying in grass does not read as a plant, it reads as broken glass. Rounder
    and much smaller is the whole difference.
  */
  const cloverGeometry = useMemo(() => {
    const g = createRockGeometry(97, 2)
    g.scale(1.4, 0.22, 1.4)
    return g
  }, [])

  /*
    The flower head: a small dome, wider than it is tall so it reads as facing
    upward, and smooth enough at this size not to show facets.
  */
  const flowerGeometry = useMemo(() => {
    const g = createRockGeometry(61, 2)
    g.scale(1, 0.6, 1)
    return g
  }, [])

  /*
    The stem, authored tall and thin in its own units rather than scaled that
    way at placement, because placements scale uniformly and a uniform scale
    cannot make something both thinner and taller.

    Its height matches the head's vertical offset exactly, so the two meet:
    both are multiplied by the same per-instance scale, and the head sits at
    3.4 units up, so the stem is 3.4 units tall. Its origin is moved to its
    base so it grows up from the ground rather than being centred on it.
  */
  const stemGeometry = useMemo(() => {
    const g = new CylinderGeometry(0.09, 0.14, FLOWER_HEIGHT, 5)
    g.translate(0, FLOWER_HEIGHT / 2, 0)
    return g
  }, [])

  return (
    <group>
      {/* Boulders. The only scatter big enough to need real shadow work. */}
      {rockGeometries.map((geometry, i) => (
        <RockCluster
          key={i}
          geometry={geometry}
          placements={rockPlacements.filter((_, n) => n % rockGeometries.length === i)}
          textures={rockStone}
        />
      ))}

      <instancedMesh
        ref={pebbles}
        args={[pebbleGeometry, undefined, pebblePlacements.length]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial {...stone(palette.rock, rockStone)} />
      </instancedMesh>

      <instancedMesh
        ref={clover}
        args={[cloverGeometry, undefined, cloverPlacements.length]}
        receiveShadow
      >
        <meshPhysicalMaterial {...plastic(palette.grassDeep)} roughness={0.7} clearcoat={0.2} />
      </instancedMesh>

      {/*
        Flowers, as a stem and a head rather than one tinted lump.

        Two instanced meshes over the same placements instead of one merged
        geometry. Merging would save a draw call and cost the ability to give
        the two parts different materials, which is the entire reason a flower
        reads as a flower: a green stalk holding up something that is not green.
      */}
      <instancedMesh
        ref={stems}
        args={[stemGeometry, undefined, flowerPlacements.length]}
        receiveShadow
      >
        <meshPhysicalMaterial {...plastic(palette.grassDeep)} roughness={0.8} clearcoat={0} />
      </instancedMesh>

      <instancedMesh
        ref={flowers}
        args={[flowerGeometry, undefined, flowerPlacements.length]}
        castShadow
        receiveShadow
      >
        {/* Faintly emissive so the heads hold their colour in shadow, well under
            the bloom threshold so they never actually glow. */}
        <meshPhysicalMaterial
          {...plastic(palette.token)}
          emissive={new Color(palette.token)}
          emissiveIntensity={0.35}
        />
      </instancedMesh>
    </group>
  )
}

/**
 * One boulder silhouette, instanced.
 *
 * Split out so each geometry variant gets its own draw call and its own matrix
 * buffer, which is what lets three different shapes share one material.
 */
function RockCluster({
  geometry,
  placements,
  textures,
}: {
  geometry: BufferGeometry
  placements: Placement[]
  textures: ReturnType<typeof usePbrTextures>
}) {
  const ref = useInstancedPlacements(placements, 0.5, 0.5)

  if (placements.length === 0) return null

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, placements.length]}
      castShadow
      receiveShadow
    >
      <meshPhysicalMaterial {...stone(palette.rock, textures)} />
    </instancedMesh>
  )
}
