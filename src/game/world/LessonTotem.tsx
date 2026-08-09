import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CylinderCollider, RigidBody } from '@react-three/rapier'
import { Billboard, Text } from '@react-three/drei'
import {
  Euler,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
  type InstancedMesh,
} from 'three'
import { palette } from '@/art/palette'
import { GLOW, crystal, emissive, mattePlastic, plastic } from '@/art/materials'
import { mergeProp, nodeCore, nodeShell, puck } from '@/art/geometry'
import { useProximity } from '../interaction/useProximity'
import type { Lesson } from '@/state/types'

/**
 * Lesson totems: the objects you walk up to in order to take a lesson.
 *
 * **This file used to cost twenty draw calls.** Five meshes each - plinth base,
 * plinth cap, accent ring, concept node, completion tick - instantiated four
 * times, which is more than the entire proposed built environment put together.
 * The rewrite folds the plinth into the hub's deck batch, where it merges with
 * every other walkable puck at zero marginal cost, and instances what is left.
 *
 * The complication instancing runs into is that the glow colour changes on
 * completion, and three applies an instance colour to the diffuse term only,
 * never to emission. So one batch cannot hold both states. The answer is one
 * batch per state, rebuilt when progress changes rather than per frame: there
 * are at most four totems, a lesson completes a handful of times in a session,
 * and the count stays at one draw per shape per state however many totems a
 * zone eventually has.
 *
 * Four totems now cost five draws at rest and six while the player is standing
 * at one.
 *
 * The floating node is the AI motif standing in for the concept each lesson
 * teaches, and it follows the world's node grammar rather than being its own
 * shape: a core inside a shell at the same 1.35 ratio as the Core's hero node
 * and the perimeter pylons' markers. That constancy is what lets the pylons
 * work as a depth ruler, and it only works if every node really is the same
 * object at a different size.
 *
 * The completion tick is gone. It was a floating rounded box that duplicated a
 * read the node and the ring both already carry by turning gold, and the Core's
 * completion ring now states overall progress from anywhere on the island. One
 * fewer draw and one fewer thing hanging in the air beside the object it
 * describes.
 */

/**
 * The totem's own dimensions, shared with `HubIsland.tsx` because the plinth is
 * built there.
 *
 * Local Y is measured from the top of the spur lobe the totem stands on rather
 * than from the lawn, so a totem is placed at its lobe's top surface.
 */
export const TOTEM = {
  /** Base radius. Down from 0.90, so a 1.50 m lobe keeps 0.80 m of walkable ring. */
  radius: 0.7,
  height: 1,
  /** The cap is a second, narrower puck stacked on the base. */
  capRadius: 0.5,
  capHeight: 0.42,
  /**
   * Collider radius, inset from the visual one.
   *
   * The spec's manifest says 0.70, matching the mesh exactly. It is 0.60 here
   * for the same reason every other collider in this level is inset: the plinth
   * is filleted and drafted, and a collider flush with the widest point of a
   * moulded shape is a capsule catching on a bevel. The 0.10 comes off the
   * plinth rather than off the lobe, so the walkable ring is unchanged.
   */
  colliderRadius: 0.6,
  colliderHalfHeight: 0.5,
  /*
    The ring sits just clear of the cap and OUTSIDE it.

    At the old 0.44 it was inside the cap's own 0.478 top radius, so the whole
    highlight was buried in the plinth it was supposed to be sitting on and the
    approach cue simply did not exist. A ring is read by the gap between it and
    the thing it rings.
  */
  ringY: 1.03,
  ringRadius: 0.66,
  nodeY: 2.2,
  nodeRadius: 0.38,
  /** 1.35 times the core, which is the ratio every node in the world uses. */
  shellRadius: 0.51,
} as const

/** How many totems one zone may hold. Sizes the instance buffers once, at mount. */
const MAX_TOTEMS = 8

/**
 * The concept node's emissive, below the tier-B target on purpose.
 *
 * `palette.nodeGlow` has a linear luminance of 0.391, barely over the 0.35 floor
 * that decides whether a hue can be normalised at all. Tier B's 1.15 raw
 * luminance therefore needs an `emissiveIntensity` near 2.95, which puts the
 * blue channel at 2.95 before tone mapping and renders the node as a white ball
 * with a blue edge. Measured in frame, not predicted: the first pass shipped at
 * `GLOW.source` and the four totems read as bare white spheres.
 *
 * 0.42 keeps the raw luminance at 0.73, which still reads as lit from within
 * while leaving the violet intact. The shell around it does the rest of the
 * work, which is exactly the pale-core-and-coloured-shell construction the art
 * bible prescribes for hues in this luminance range.
 */
const NODE_GLOW = 0.42

/**
 * The plinth, as one merged geometry with its base at the lobe surface.
 *
 * Exported rather than drawn here so `HubIsland.tsx` can fold it into the deck
 * batch. Two stacked pucks with real filleted rims, replacing two
 * `cylinderGeometry` calls whose caps met their sides at exactly 90 degrees.
 *
 * Fast refresh wants a module to export components or values but not both, and
 * it is right in general. The exception is worth taking here: this generator and
 * the dimensions it reads are the totem's definition, and putting them in a
 * separate file would mean a totem's size lived somewhere other than the totem.
 * The cost is that editing this file reloads the scene rather than hot-swapping
 * the component, which for a file edited during an art pass is barely a cost at
 * all.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function totemPlinth(): BufferGeometry {
  const base = TOTEM.height - TOTEM.capHeight
  return mergeProp([
    { geometry: puck(TOTEM.radius, base, 0.06) },
    { geometry: puck(TOTEM.capRadius, TOTEM.capHeight, 0.05), position: [0, base, 0] },
  ])
}

export type TotemPlacement = {
  lesson: Lesson
  /** World position of the lobe surface the totem stands on. */
  position: [number, number, number]
  completed: boolean
}

/**
 * A single free-standing totem, plinth and all.
 *
 * The hub does not use this: it folds its plinths into the deck batch and hands
 * `LessonTotems` all four at once, which is the whole point of the rewrite. The
 * cave does, because it has no deck batch to fold anything into and it is a
 * deliberately disposable scene whose job is proving the portal round trip
 * rather than hitting a draw budget.
 *
 * Keeping the old call signature working also means the rewrite touched no file
 * outside the hub, which is what let it land while other streams were editing
 * their own.
 */
export function LessonTotem({
  lesson,
  completed,
  player,
  onFocus,
  onBlur,
}: {
  lesson: Lesson
  completed: boolean
  player: React.RefObject<Group | null>
  onFocus: () => void
  onBlur: () => void
}) {
  const plinth = useMemo(() => totemPlinth(), [])
  const totems = useMemo<TotemPlacement[]>(
    () => [{ lesson, position: lesson.position, completed }],
    [lesson, completed],
  )

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <mesh geometry={plinth} position={lesson.position} castShadow receiveShadow>
          <meshPhysicalMaterial {...mattePlastic(palette.rockDeep)} />
        </mesh>
        <CylinderCollider
          args={[TOTEM.colliderHalfHeight, TOTEM.colliderRadius]}
          position={[
            lesson.position[0],
            lesson.position[1] + TOTEM.colliderHalfHeight,
            lesson.position[2],
          ]}
        />
      </RigidBody>
      <LessonTotems totems={totems} player={player} onFocus={onFocus} onBlur={onBlur} />
    </>
  )
}

export function LessonTotems({
  totems,
  player,
  onFocus,
  onBlur,
}: {
  totems: TotemPlacement[]
  player: React.RefObject<Group | null>
  /** Focus is reported upward; the interact key is handled centrally in App. */
  onFocus: (id: string) => void
  onBlur: () => void
}) {
  const [nearId, setNearId] = useState<string | null>(null)

  const incompleteNodes = useRef<InstancedMesh>(null)
  const completeNodes = useRef<InstancedMesh>(null)
  const shells = useRef<InstancedMesh>(null)
  const incompleteRings = useRef<InstancedMesh>(null)
  const completeRings = useRef<InstancedMesh>(null)

  const geometries = useMemo(
    () => ({
      node: nodeCore(TOTEM.nodeRadius),
      shell: nodeShell(TOTEM.shellRadius),
      /* A torus is entirely fillet, so this one shape needs no help from the kit. */
      ring: new TorusGeometry(TOTEM.ringRadius, 0.06, 8, 32),
    }),
    [],
  )

  const scratch = useRef({
    matrix: new Matrix4(),
    position: new Vector3(),
    quaternion: new Quaternion(),
    euler: new Euler(),
    scale: new Vector3(),
  })

  /*
    One pass over the totems, writing each into whichever bucket its progression
    state puts it in, with a running index per bucket.

    Written as a flat loop rather than as `totems.filter(...)` handed to a helper
    on purpose. The two are equivalent, but the compiler cannot prove a helper
    taking an array does not mutate it, so the memoised version trips the rule
    against modifying a locally created value after render. The flat version has
    no such value to modify, allocates nothing per frame, and reads the props
    directly.
  */
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const { matrix, position, quaternion, euler, scale } = scratch.current
    const shellMesh = shells.current

    let incompleteCount = 0
    let completeCount = 0

    for (let i = 0; i < totems.length; i++) {
      const totem = totems[i]
      const slot = totem.completed ? completeCount : incompleteCount
      /*
        Phase offset by X so the four totems do not bob in unison. A merged batch
        could not do this at all, which is most of why these are instanced rather
        than folded into the dress batch: identical motion across four objects
        reads as one mechanism rather than as four separate things that happen to
        be alive.
      */
      const bob = Math.sin(t * 1.6 + totem.position[0]) * 0.12
      scale.setScalar(nearId === totem.lesson.id ? 1.18 : 1)

      // The node, which floats and spins about its own axis.
      position.set(totem.position[0], totem.position[1] + TOTEM.nodeY + bob, totem.position[2])
      euler.set(0, t * 0.6, 0)
      quaternion.setFromEuler(euler)
      matrix.compose(position, quaternion, scale)
      shellMesh?.setMatrixAt(i, matrix)
      if (totem.completed) completeNodes.current?.setMatrixAt(slot, matrix)
      else incompleteNodes.current?.setMatrixAt(slot, matrix)

      // The accent ring, which lies flat on the plinth cap.
      position.set(totem.position[0], totem.position[1] + TOTEM.ringY, totem.position[2])
      euler.set(Math.PI / 2, 0, 0)
      quaternion.setFromEuler(euler)
      matrix.compose(position, quaternion, scale)
      if (totem.completed) completeRings.current?.setMatrixAt(slot, matrix)
      else incompleteRings.current?.setMatrixAt(slot, matrix)

      if (totem.completed) completeCount++
      else incompleteCount++
    }

    const publish = (mesh: InstancedMesh | null, count: number) => {
      if (!mesh) return
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }
    publish(shellMesh, totems.length)
    publish(incompleteNodes.current, incompleteCount)
    publish(completeNodes.current, completeCount)
    publish(incompleteRings.current, incompleteCount)
    publish(completeRings.current, completeCount)
  })

  const near = totems.find((t) => t.lesson.id === nearId) ?? null

  return (
    <group>
      {/* Interaction only. These groups draw nothing at all. */}
      {totems.map((totem) => (
        <TotemAnchor
          key={totem.lesson.id}
          position={totem.position}
          player={player}
          onEnter={() => {
            setNearId(totem.lesson.id)
            onFocus(totem.lesson.id)
          }}
          onExit={() => {
            setNearId((current) => (current === totem.lesson.id ? null : current))
            onBlur()
          }}
        />
      ))}

      {/*
        The concept node, one batch per progression state.

        Cast acrylic rather than the old `gel()`. Transmission costs an extra
        render target pass per material and the reference warns in as many words
        that it makes a white character look like a gummy bear; `crystal()` gets
        the same held-idea read from clearcoat and plain alpha.

        The incomplete state moved from `palette.node` to `palette.nodeGlow`.
        The violet at #7c6bff has a linear luminance of 0.220, so normalising it
        against the bloom threshold would need an emissiveIntensity near 8 and
        render as flat white with a violet fringe. `emissive()` refuses it
        outright, which is the correct behaviour and the reason this is the
        lighter hue rather than a number someone quietly tuned down.
      */}
      <instancedMesh ref={incompleteNodes} args={[geometries.node, undefined, MAX_TOTEMS]} castShadow>
        <meshPhysicalMaterial {...crystal(palette.nodeGlow, NODE_GLOW)} />
      </instancedMesh>
      <instancedMesh ref={completeNodes} args={[geometries.node, undefined, MAX_TOTEMS]} castShadow>
        <meshPhysicalMaterial {...crystal(palette.unlocked, NODE_GLOW)} />
      </instancedMesh>

      {/*
        The shell, which is the same colour whatever the state and therefore one
        batch. It is what stops a node reading as a ball: an inner part and an
        outer part is the detail that makes these read as manufactured.
      */}
      <instancedMesh ref={shells} args={[geometries.shell, undefined, MAX_TOTEMS]}>
        <meshPhysicalMaterial
          {...plastic(palette.node)}
          flatShading
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </instancedMesh>

      <instancedMesh ref={incompleteRings} args={[geometries.ring, undefined, MAX_TOTEMS]}>
        <meshPhysicalMaterial {...emissive(palette.nodeGlow, GLOW.source * 0.6)} />
      </instancedMesh>
      <instancedMesh ref={completeRings} args={[geometries.ring, undefined, MAX_TOTEMS]}>
        <meshPhysicalMaterial {...emissive(palette.unlocked, GLOW.source)} />
      </instancedMesh>

      {/*
        The approach highlight, drawn as one extra mesh over whichever ring the
        player is standing at, and only while they are standing there.

        An instanced batch cannot carry a per-instance emissive, so the
        alternative would have been four permanent buckets instead of two. A
        completed totem's highlight is the only thing in this file allowed to
        bloom: gold means reward, globally and without exception, and keeping
        the tier-A set that small is what stops bloom reading as weather.
      */}
      {near && (
        <mesh
          position={[near.position[0], near.position[1] + TOTEM.ringY, near.position[2]]}
          rotation={[Math.PI / 2, 0, 0]}
          geometry={geometries.ring}
          scale={1.06}
        >
          <meshPhysicalMaterial
            {...(near.completed
              ? emissive(palette.unlocked, GLOW.bloom)
              : emissive(palette.nodeGlow, GLOW.source))}
          />
        </mesh>
      )}

      {/*
        Both labels sit inside one Billboard so they turn as a single unit.
        Wrapping each separately billboards them about their own centres, and
        since they sit at different heights the two shear apart into different
        planes as the camera moves.
      */}
      {near && (
        <Billboard position={[near.position[0], near.position[1] + 2.94, near.position[2]]}>
          <Text
            position={[0, 0.16, 0]}
            fontSize={0.3}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.018}
            outlineColor="#0b1020"
          >
            {near.lesson.title}
          </Text>
          <Text
            position={[0, -0.16, 0]}
            fontSize={0.16}
            color="#cfe4ff"
            anchorX="center"
            anchorY="middle"
            maxWidth={4}
            textAlign="center"
            outlineWidth={0.012}
            outlineColor="#0b1020"
          >
            {near.completed ? 'Completed' : near.lesson.blurb}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

/**
 * One totem's trigger volume, and nothing else.
 *
 * A separate component purely so each totem gets its own `useProximity`, which
 * already owns the world-space resolution and the enter/exit hysteresis that
 * the batch's frame loop would otherwise have to reimplement.
 */
function TotemAnchor({
  position,
  player,
  onEnter,
  onExit,
}: {
  position: [number, number, number]
  player: React.RefObject<Group | null>
  onEnter: () => void
  onExit: () => void
}) {
  const anchor = useRef<Group>(null)
  useProximity(anchor, player, onEnter, onExit)
  // Chest height on the plinth, so the trigger measures against the object the
  // player is walking toward rather than against the ground under it.
  return <group ref={anchor} position={[position[0], position[1] + 1, position[2]]} />
}
