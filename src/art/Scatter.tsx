import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  IcosahedronGeometry,
  Object3D,
  type BufferGeometry,
  type InstancedMesh,
} from 'three'
import { palette } from './palette'
import { plastic, stone } from './materials'
import { useMouldedStone } from './textures'
import { useQuality } from './useQuality'
import {
  clusterCentres,
  clusteredPlacements,
  mulberry32,
  type Exclusion,
  type Placement,
} from './placement'

/**
 * Rocks, pebbles and clover scattered across the island.
 *
 * This is what stops the ground reading as a lawn with objects standing on it.
 * Grass alone is uniform, and uniformity is the tell; scatter breaks it up and
 * gives the eye something to measure distance against.
 *
 * All of it is instanced and none of it is collidable. A pebble the capsule can
 * catch on is worse than no pebble, and the plan of hand-authored colliders for
 * anything the player can touch is what keeps the ground walkable.
 *
 * **Clumps, not confetti.** Every layer here used to use `evenPlacements`, which
 * spreads things uniformly, and the result reads as clutter: the eye finds no
 * structure in an even scatter, gives up, and the whole island averages into one
 * busy texture. The reference brief's rule is explicit about this and the grass
 * and flowers already followed it while the props did not. Boulders now arrive
 * in six clumps at the perimeter, the pebbles reuse the boulders' own patch
 * centres so they pool around them as debris rather than as a separate
 * sprinkling, and the clover grows in patches of its own further in.
 *
 * The flower layer that used to live here is gone, not deleted: the small pink
 * domes were a second flower system running on top of the daisies in
 * `Flowers.tsx`, from the same sampler and with no knowledge of them. They are
 * visually distinct and worth keeping, so they moved into `Flowers.tsx` as a
 * third batch sharing that file's sampler, patch centres, wind and player
 * displacement. Three draw calls became one.
 */

/**
 * The boulder layer's dimensions, exported because two files now need them.
 *
 * `HubIsland.tsx` builds one merged contact-decal batch for the whole scene, so
 * it has to know where the boulders are and how wide each one's foot is. The
 * alternative was a second draw call for thirty quads, which the draw budget does
 * not have room for and which would also have put the boulders' contact on a
 * different lever from everything else's.
 *
 * `baseScale` is metres of radius per unit of `Placement.scale`, and `sink` is
 * the fraction of a boulder's own half-height that sits above the lawn.
 */
export const BOULDER = {
  baseScale: 0.32,
  sink: 0.5,
  /**
   * Vertical squash from `createRockGeometry`, which flattens every rock so it
   * sits INTO the ground rather than resting on it like a ball.
   */
  squash: 0.68,
} as const

/**
 * Where the boulder clumps are centred.
 *
 * A module function rather than a hook, so the contact batch can ask the same
 * question the mesh asks and get the same answer by construction instead of by
 * two copies of six literals agreeing. `mulberry32` makes it deterministic, which
 * is what lets this be shared rather than plumbed.
 *
 * This and `boulderPlacements` cost the file its fast refresh, and the alternative
 * was worse. `BOULDER` above is a constant and the lint rule permits it, but a
 * shared FUNCTION is not, and the rule's own suggestion - a separate module - would
 * put the boulder layer's composition somewhere other than the boulder layer.
 * Scatter is static scenery nobody iterates on interactively, so a full reload on
 * edit is close to free here. `LessonTotem.tsx` takes exactly this trade for
 * `totemPlinth` and gives the same reason.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function boulderCentres(radius: number) {
  return clusterCentres({
    clusters: 6,
    radius: radius * 0.906,
    centreMinRadius: radius * 0.625,
    centreMaxRadius: radius * 0.844,
    seed: 5,
  })
}

/**
 * The boulder placements, as a pure function of the three things they depend on.
 *
 * Lifted out of the component for the reason above. It is called twice per scene
 * - once by `Scatter` for the meshes, once by `HubIsland` for the contact decals
 * - and the two calls MUST agree, which is why this is one function rather than
 * two `useMemo`s with the same arguments typed out.
 *
 * The distances are the environment spec's, as fractions of the island so a scene
 * with a different plateau still gets the same composition. At the hub's radius
 * of 16 they are the spec's numbers exactly: boulders between 9.0 and 14.5, their
 * centres between 10.0 and 13.5.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function boulderPlacements(
  radius: number,
  density: number,
  exclusions: Exclusion[],
): Placement[] {
  /*
    `clusterRadius` 1.6 against a boulder base of 0.32 m is what makes this a
    clump rather than a loose group: five boulders averaging 0.65 m across inside
    a 3.2 m circle are touching each other. The wide 0.45 to 1.6 scale range
    matters as much as the tight radius, because a clump of same-sized rocks reads
    as a pattern and a clump of one big rock with four small ones reads as a rock
    that broke.
  */
  return clusteredPlacements({
    count: Math.round(30 * density),
    radius: radius * 0.906,
    minRadius: radius * 0.5625,
    centres: boulderCentres(radius),
    clusterRadius: 1.6,
    exclusions,
    seed: 5,
    minScale: 0.45,
    maxScale: 1.6,
  })
}

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
  /*
    Generated rather than photographed, which is the reference brief's deepest
    rule rather than an optimisation: everything in this world is a manufactured
    object, and a photograph of real granite on a boulder the player walks right
    up to is the clearest violation of it in the project. Tiled at 1.2 m of
    world per repeat, the same physical stone size every other stone surface in
    the game is solved against.
  */
  const rockStone = useMouldedStone([2, 2])

  const density = quality.propDensity

  // Three rock silhouettes rather than one, because a repeated boulder is more
  // obvious than a repeated blade of grass will ever be.
  const rockGeometries = useMemo(
    () => [createRockGeometry(11), createRockGeometry(29), createRockGeometry(47)],
    [],
  )
  const pebbleGeometry = useMemo(() => createRockGeometry(83, 0), [])

  /*
    The pebble and clover distances below are the environment spec's, expressed
    as fractions of the island so a scene with a different plateau still gets the
    same composition. At the hub's radius of 16 they are the spec's numbers
    exactly: pebbles out to 15.0, clover from 6.4 to 15.0. The boulders' own
    numbers moved to `boulderPlacements` above, where the contact batch can read
    them too.
  */
  const centres = useMemo(() => boulderCentres(radius), [radius])

  /** Six clumps of about five boulders each. See `boulderPlacements`. */
  const rockPlacements = useMemo(
    () => boulderPlacements(radius, density, exclusions),
    [radius, density, exclusions],
  )

  /*
    Pebble skirts, on the boulders' own centres.

    `clusterRadius` 2.6 against the boulders' 1.6 gives a debris halo a metre
    wider than the clump it came from, which is what makes the pair read as one
    event rather than as two layers that happen to overlap.
  */
  const pebblePlacements = useMemo(
    () =>
      clusteredPlacements({
        count: Math.round(90 * density),
        radius: radius * 0.9375,
        minRadius: radius * 0.53,
        centres,
        clusterRadius: 2.6,
        exclusions,
        seed: 17,
        minScale: 0.5,
        maxScale: 1.3,
      }),
    [density, radius, centres, exclusions],
  )

  /*
    Clover, in nine patches of its own and allowed much further in than the
    boulders. Down from 340 to 300, because a clustered layer at the same count
    reads denser than an even one and the old number was chosen against an even
    scatter.
  */
  const cloverPlacements = useMemo(
    () =>
      clusteredPlacements({
        count: Math.round(300 * density),
        radius: radius * 0.9375,
        minRadius: radius * 0.4,
        clusters: 9,
        clusterRadius: 2.4,
        centreMinRadius: radius * 0.406,
        centreMaxRadius: radius * 0.875,
        exclusions,
        seed: 23,
        minScale: 0.7,
        maxScale: 1.4,
      }),
    [density, radius, exclusions],
  )

  /*
    Base scales in metres, and they matter more than anything else here.

    Everything in this file nestles into grass that is now 0.11 to 0.45 m rather
    than the 0.21 to 0.86 it used to be, so every one of these came down with
    it. A prop that stood proud of the old field by a comfortable margin stands
    over the new one like debris, and the whole job of this layer is to read as
    part of the ground.
  */
  const pebbles = useInstancedPlacements(pebblePlacements, 0.07, 0.45)
  const clover = useInstancedPlacements(cloverPlacements, 0.09, 0.35)

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
  textures: ReturnType<typeof useMouldedStone>
}) {
  const ref = useInstancedPlacements(placements, 0.32, 0.5)

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
