import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { GLOW, emissive, mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { mergeProp, pad, slab, trace } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { teachingMachineGeometry } from '../teachingMachine'
import { loop, pointAlong, steppedAlong } from '../diorama'

/**
 * Station two: the same machine looking something up, two ways.
 *
 * ## Two paths, because the paragraph names two
 *
 * "Give it a library and it will fetch; give it time and it will work step by
 * step." Those are different claims about different situations, and drawing only
 * one of them teaches half the sentence.
 *
 * So there are two routes from the shelf to the machine and they differ in the
 * only way that matters: the upper one is a straight line with a dot that crosses
 * it in a second, and the lower one bends through four waypoints with a dot that
 * STOPS at each. A viewer does not need either labelled to see that one is a
 * grab and the other is a procedure - which is why neither is, and why this
 * station spends no text at all beyond the two it shares with its neighbours.
 *
 * ## The dwell is the whole idea
 *
 * `steppedAlong` is what makes the slow path read as steps rather than as a slow
 * line. Without it the two paths differ only in speed, and speed alone reads as
 * one path being further away.
 */
export function Fetched({ lit, local }: { lit: number; local: number }) {
  const fast = useRef<Mesh>(null)
  const slow = useRef<Mesh>(null)

  const machine = useMemo(
    () => assertDrawable(teachingMachineGeometry(0.42), 'the fetching machine'),
    [],
  )

  /*
    The shelf: three rows of spines, merged. Instancing would be the other
    reasonable answer and `geometry.ts` says which to reach for - "merging" for a
    static arrangement, "instancing… for the numerous, identical, uniformly
    scaled small stuff". These are static and they are not identical: the spines
    vary in width, which is what stops a shelf reading as a barcode.
  */
  const shelf = useMemo(() => {
    const parts = []
    for (let row = 0; row < 3; row++) {
      let x = -0.36
      let i = 0
      while (x < 0.3) {
        const width = 0.036 + ((i * 7) % 5) * 0.008
        parts.push({
          geometry: slab(width, 0.15 + ((i * 3) % 3) * 0.02, 0.1, 0.008),
          position: [x + width / 2, SHELF_Y + row * 0.22, 0.05] as [number, number, number],
        })
        x += width + 0.006
        i++
      }
      parts.push({
        geometry: slab(0.8, 0.02, 0.14, 0.006),
        position: [-0.03, SHELF_Y + row * 0.22 - 0.02, 0.05] as [number, number, number],
      })
    }
    return assertDrawable(mergeProp(parts), 'the library shelf')
  }, [])

  /* Both routes, plus a pad at each waypoint so the stops are visible when still. */
  const routes = useMemo(
    () =>
      assertDrawable(
        mergeProp([
          { geometry: trace(FAST_PATH, 0.012, 16) },
          { geometry: trace(SLOW_PATH, 0.012, 32) },
          ...SLOW_PATH.slice(1, -1).map((p) => ({
            geometry: pad(0.038),
            position: p,
            rotation: [Math.PI / 2, 0, 0] as [number, number, number],
          })),
        ]),
        'the retrieval routes',
      ),
    [],
  )

  useFrame(() => {
    if (fast.current) {
      const t = loop(local, FAST_PERIOD)
      const [x, y, z] = pointAlong(FAST_PATH, t)
      fast.current.position.set(x, y, z)
      fast.current.visible = lit > 0.05
    }
    if (slow.current) {
      const t = steppedAlong(loop(local, SLOW_PERIOD), SLOW_PATH.length - 1)
      const [x, y, z] = pointAlong(SLOW_PATH, t)
      slow.current.position.set(x, y, z)
      slow.current.visible = lit > 0.05
    }
  })

  return (
    <group>
      <mesh geometry={machine} position={[0.44, 0, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      <mesh geometry={shelf} position={[-0.42, 0, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...mattePlastic(palette.bandTrim)} />
      </mesh>

      <mesh geometry={routes}>
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>

      {/* The two travellers. One mesh each: there are two of them, and an
          instanced batch of two is a buffer and a matrix write to save nothing. */}
      <mesh ref={fast}>
        <sphereGeometry args={[0.038, 10, 8]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
      <mesh ref={slow}>
        <sphereGeometry args={[0.038, 10, 8]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------------- */

const SHELF_Y = 0.62

/** Straight from the shelf's top row to the machine's head. One grab. */
const FAST_PATH: [number, number, number][] = [
  [-0.42, 1.12, 0.12],
  [0.44, 0.92, 0.12],
]

/** Four waypoints between the shelf's lower row and the machine. A procedure. */
const SLOW_PATH: [number, number, number][] = [
  [-0.42, 0.66, 0.12],
  [-0.2, 0.44, 0.12],
  [0.02, 0.56, 0.12],
  [0.24, 0.4, 0.12],
  [0.44, 0.6, 0.12],
]

/**
 * The two routes' periods, retimed for the 2.05 s window a form now gets.
 *
 * At 5.6 the stepped route never completed a single crawl inside a dwell, so the
 * station's whole point - that one way is a grab and the other is a procedure -
 * was only ever half shown.
 *
 * 1.9 rather than 2.2, because this is the one form whose argument IS its full
 * period: `steppedAlong` completes at the end of the loop, so the route arriving
 * and the cycle ending are the same instant. At 2.2 it landed 0.15 s outside the
 * readable window and the crawl faded out one step short of its shelf.
 *
 * The RATIO is what the station actually argues, and it is preserved: 2.44 to 1
 * against the old 2.95 to 1. Still unmistakably slower, and now visible.
 */
const FAST_PERIOD = 0.78
const SLOW_PERIOD = 1.9
