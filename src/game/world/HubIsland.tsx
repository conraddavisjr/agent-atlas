import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import { RoundedBox } from '@react-three/drei'
import { palette } from '@/art/palette'
import { emissive, mattePlastic, plastic, stone } from '@/art/materials'
import { useStoneTextures } from '@/art/textures'
import { useGame } from '../GameContext'
import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS, ZONES } from '@/state/lessons'
import { isSceneAccessible, isLessonComplete } from '@/state/progression'
import { Portal } from './Portal'
import { LessonTotem } from './LessonTotem'

/**
 * The hub island.
 *
 * Composition follows the principle behind Astro's hub, which is built out of the
 * hardware it celebrates. Ours is built out of the subject it teaches: oversized
 * neural-net nodes, circuit-trace paths worn into the ground, and token crystals
 * growing like plants. None of it is decoration for its own sake.
 *
 * Colliders are authored by hand rather than generated from the visual meshes.
 * Trimesh colliders for scenery are both slower and worse to walk on, because
 * every decorative bevel becomes something the capsule can catch on.
 */
export function HubIsland() {
  const { player, travel } = useGame()
  const progress = useProgress()
  const setActiveTotem = useGameStore((s) => s.setActiveTotem)

  const hubLessons = LESSONS.filter((l) => l.zoneId === 'basics')
  const caveOpen = isSceneAccessible('cave', ZONES, LESSONS, progress)

  /*
    Tiling is chosen so a stone lands at roughly 1.2m across on every surface it
    is applied to, rather than being the same number everywhere. Matching the
    repeat count instead of the physical scale is what makes tiled stone read as
    wallpaper: the same rock appears at three different sizes on three adjacent
    pieces of the same structure.

    Platform top face is 7 x 5, ramp is 3.59 x 3.
  */
  const platformStone = useStoneTextures([6, 4])
  const rampStone = useStoneTextures([3, 3])
  const ringStone = useStoneTextures([8, 8])

  return (
    <group>
      {/* Lesson totems for this zone. */}
      {hubLessons.map((lesson) => (
        <LessonTotem
          key={lesson.id}
          lesson={lesson}
          completed={isLessonComplete(lesson, progress)}
          player={player}
          onFocus={() => setActiveTotem(lesson.id)}
          onBlur={() => setActiveTotem(null)}
        />
      ))}

      {/* The gate to the next zone. Locked until every basics lesson is done,
          which is what the whole progression system exists to drive. */}
      <Portal
        /* z=-6.9 rather than -7.2 so the arch's 0.7 depth sits fully on the
           platform, which ends at z=-7.5, instead of overhanging the back edge. */
        position={[9, 0.8, -6.9]}
        locked={!caveOpen}
        label="The Prompt Cave"
        player={player}
        onEnter={() => travel('cave', 'entrance', 'The Prompt Cave')}
      />
      {/* Main plateau */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[0, -0.5, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[16, 14.5, 1, 48]} />
          <meshPhysicalMaterial {...mattePlastic(palette.grass)} />
        </mesh>
        {/* Soil band beneath, which gives the island thickness from low angles. */}
        <mesh position={[0, -1.8, 0]} castShadow>
          <cylinderGeometry args={[14.5, 9, 2, 48]} />
          <meshPhysicalMaterial {...mattePlastic(palette.soil)} />
        </mesh>
        <mesh position={[0, -4.2, 0]} castShadow>
          <coneGeometry args={[9, 4, 32]} />
          <meshPhysicalMaterial {...mattePlastic(palette.soilDeep)} />
        </mesh>
        <CylinderCollider args={[0.5, 16]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Raised platform toward the cave, so the portal reads as a destination
          rather than as another object sitting on the lawn. */}
      <RigidBody type="fixed" colliders={false}>
        <RoundedBox args={[7, 0.8, 5]} radius={0.2} smoothness={3} position={[9, 0.4, -5]} castShadow receiveShadow>
          <meshPhysicalMaterial {...stone(palette.rock, platformStone)} />
        </RoundedBox>
        <CuboidCollider args={[3.5, 0.4, 2.5]} position={[9, 0.4, -5]} />
      </RigidBody>

      {/* The ring you walk through on the way to the portal. Purely visual and
          flat to the surface, so it can never catch the capsule. */}
      <PortalRing center={[9, 0.81, -5.2]} textures={ringStone} lit={caveOpen} />

      {/*
        Ramp up to that platform.

        The geometry is solved against the platform rather than eyeballed: the
        platform's left edge is x=5.5 with its top at y=0.8, so the ramp runs from
        ground at x=2.0 up to exactly that corner. An approximated slope leaves a
        visible floating gap at the top and a lip the player walks into.
          run  = 5.5 - 2.0 = 3.5      rise = 0.8
          angle = atan(0.8 / 3.5) = 0.226 rad
          length = hypot(3.5, 0.8) = 3.59
      */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[3.75, 0.4, -5]} rotation={[0, 0, 0.226]} receiveShadow castShadow>
          <boxGeometry args={[3.59, 0.3, 3]} />
          <meshPhysicalMaterial {...stone(palette.rock, rampStone)} />
        </mesh>
        <CuboidCollider args={[1.795, 0.15, 1.5]} position={[3.75, 0.4, -5]} rotation={[0, 0, 0.226]} />
      </RigidBody>

      {/* Stepping blocks, which exist so there is somewhere to actually test the
          jump, coyote time, and autostep without leaving the hub. */}
      {[
        { pos: [-9, 0.5, 6] as [number, number, number], size: 1.0 },
        { pos: [-11, 1.3, 3.5] as [number, number, number], size: 1.0 },
        { pos: [-9.5, 2.2, 1] as [number, number, number], size: 1.0 },
      ].map((block, i) => (
        <RigidBody key={i} type="fixed" colliders={false}>
          <RoundedBox
            args={[2, block.size, 2]}
            radius={0.12}
            smoothness={3}
            position={block.pos}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial {...plastic(palette.accent)} />
          </RoundedBox>
          <CuboidCollider args={[1, block.size / 2, 1]} position={block.pos} />
        </RigidBody>
      ))}

      {/* Circuit traces worn into the ground, connecting the totems. Flat, so they
          never interfere with movement. */}
      {[
        { pos: [-2, 0.02, -1.5] as [number, number, number], rot: 0.5, len: 6 },
        { pos: [2.4, 0.02, 1.5] as [number, number, number], rot: -0.7, len: 7 },
        { pos: [4.5, 0.02, -3.5] as [number, number, number], rot: 0.2, len: 5 },
      ].map((trace, i) => (
        <mesh key={i} position={trace.pos} rotation={[-Math.PI / 2, 0, trace.rot]} receiveShadow>
          <planeGeometry args={[0.22, trace.len]} />
          <meshPhysicalMaterial {...emissive(palette.circuit, 1.2)} transparent opacity={0.75} />
        </mesh>
      ))}

      {/* Token crystals, our stand-in for flora. */}
      {[
        [-12, 0, -2],
        [11, 0, 6],
        [-5, 0, 10],
        [6.5, 0, 9],
        [-13, 0, 5],
        [13, 0, 1],
      ].map((p, i) => (
        <TokenCrystal key={i} position={p as [number, number, number]} seed={i} />
      ))}

      {/* Distant neural-net node sculptures, purely for silhouette and depth. */}
      <NodeSculpture position={[-13.5, 0, -8]} scale={1.2} />
      <NodeSculpture position={[12, 0, 10]} scale={0.9} />
    </group>
  )
}

/**
 * A stone ring inlaid into the platform floor, centred on the approach to the
 * portal.
 *
 * It does two jobs. It gives the platform a focal point, so the portal reads as
 * the destination of the platform rather than as an object standing on it. And
 * its inner band is emissive only once the portal is open, which puts a second,
 * quieter signal of the gate's state on the ground the player is already
 * looking at as they walk up.
 *
 * Geometry sits 10mm above the surface it is set into. Coplanar would z-fight,
 * and anything thicker would read as a kerb and invite the player to try to
 * step onto it.
 */
function PortalRing({
  center,
  textures,
  lit,
}: {
  center: [number, number, number]
  textures: ReturnType<typeof useStoneTextures>
  lit: boolean
}) {
  return (
    <group position={center} rotation={[-Math.PI / 2, 0, 0]}>
      {/*
        Values are pushed well apart on purpose. The first pass used three
        near-neighbours off the same grey and, seen from playing distance on a
        surface that is already grey, the whole thing collapsed into one faint
        oval. Inlay in a floor is read almost entirely by value contrast,
        because the geometry is flat and contributes no silhouette at all.
      */}

      {/* Outer band: a dark kerb that separates the ring from the platform. */}
      <mesh receiveShadow>
        <ringGeometry args={[1.72, 2.2, 64]} />
        <meshPhysicalMaterial {...stone(palette.rock, textures, { color: '#6c7684' })} />
      </mesh>

      {/* Inner band, near white, for the strongest step in the sequence. */}
      <mesh position={[0, 0, 0.002]} receiveShadow>
        <ringGeometry args={[1.46, 1.72, 64]} />
        <meshPhysicalMaterial {...stone(palette.rock, textures, { color: '#e8edf2' })} />
      </mesh>

      {/* The powered inlay. Present but dark when locked, so the groove is
          clearly a thing that can light up rather than appearing from nowhere. */}
      <mesh position={[0, 0, 0.004]}>
        <ringGeometry args={[1.56, 1.66, 64]} />
        {/*
          Kept below the arch trim and the portal surface on purpose. At 2 the
          groove bloomed out to a flat white donut that pulled the eye off the
          doorway it is supposed to be pointing at. The inlay is a supporting
          cue, so it reads as cyan rather than as a light source.
        */}
        {lit ? (
          <meshPhysicalMaterial {...emissive(palette.visor, 1.15)} />
        ) : (
          <meshPhysicalMaterial {...mattePlastic('#2c3240')} />
        )}
      </mesh>
    </group>
  )
}

function TokenCrystal({ position, seed }: { position: [number, number, number]; seed: number }) {
  const height = 0.8 + (seed % 3) * 0.35
  return (
    <group position={position} rotation={[0, seed * 1.1, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <coneGeometry args={[0.26, height, 6]} />
        <meshPhysicalMaterial {...emissive(palette.token, 0.9)} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0.22, height * 0.32, 0.12]} rotation={[0, 0, 0.4]} castShadow>
        <coneGeometry args={[0.14, height * 0.6, 6]} />
        <meshPhysicalMaterial {...emissive(palette.token, 0.7)} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

/**
 * An oversized neural-net node: a core with orbiting satellites. Purely visual,
 * with no collider, since the player never needs to walk on it.
 */
function NodeSculpture({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 2.8, 10]} />
        <meshPhysicalMaterial {...mattePlastic(palette.rock)} />
      </mesh>
      <mesh position={[0, 3.1, 0]} castShadow>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshPhysicalMaterial {...emissive(palette.node, 1.1)} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const angle = (i / 3) * Math.PI * 2
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 1.15, 3.1 + Math.sin(angle) * 0.5, Math.sin(angle) * 1.15]}
            castShadow
          >
            <sphereGeometry args={[0.2, 12, 12]} />
            <meshPhysicalMaterial {...emissive(palette.nodeGlow, 1.4)} />
          </mesh>
        )
      })}
    </group>
  )
}
