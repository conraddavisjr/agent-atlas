import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { GLOW, emissive, mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { mergeProp, pad, slab, trace } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { teachingMachineGeometry } from '../teachingMachine'
import { loop, pointAlong, stationGlow, steppedAlong } from '../diorama'
import type { LiveCue } from '../specimen'

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
 *
 * ## One book, alternating routes, rather than two dots at once
 *
 * It used to run both travellers simultaneously, one on each route, as two
 * glowing dots. That drew the two claims but it drew them as a comparison - two
 * things racing - when the paragraph makes them as alternatives: "give it a
 * library and it will fetch; give it TIME and it will work step by step".
 *
 * So there is one traveller and it takes the routes in turn: a straight grab, and
 * then the same errand done the long way. Alternating is what makes them read as
 * two things the same machine can do, and it halves what is moving at any moment,
 * which at the specimen's scale is the difference between a diagram and a busy
 * one.
 *
 * And it is a BOOK rather than a dot, because it comes off a shelf of books and
 * goes into a machine that eats books on the form before this one. A glowing dot
 * leaving a library is an abstraction of an abstraction; a book leaving a library
 * is the thing itself.
 */
export function Fetched({ cue }: { cue: LiveCue }) {
  const book = useRef<Mesh>(null)
  const fastMaterial = useRef<{ emissiveIntensity: number } | null>(null)
  const slowMaterial = useRef<{ emissiveIntensity: number } | null>(null)

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

  /*
    The two routes, as separate geometries so each can be lit independently. The
    waypoint pads belong to the slow one: they are what a stop looks like when the
    book is standing on it.
  */
  const fastRoute = useMemo(
    () => assertDrawable(mergeProp([{ geometry: trace(FAST_PATH, 0.012, 16) }]), 'the direct route'),
    [],
  )
  const slowRoute = useMemo(
    () =>
      assertDrawable(
        mergeProp([
          { geometry: trace(SLOW_PATH, 0.012, 32) },
          ...SLOW_PATH.slice(1, -1).map((p) => ({
            geometry: pad(0.038),
            position: p,
            rotation: [Math.PI / 2, 0, 0] as [number, number, number],
          })),
        ]),
        'the stepped route',
      ),
    [],
  )

  useFrame(() => {
    /* Read live, every frame. See `LiveCue` for why these are not props. */
    const { lit, local } = cue

    /*
      Which errand this is. `local` restarts every time the form comes on stage -
      see `specimen.ts` - so a visit always opens on the straight grab and the
      player never arrives half way through the slow one wondering what the fast
      one looked like.
    */
    const cycle = Math.floor(Math.max(0, local) / ROUTE_PERIOD)
    const stepping = cycle % 2 === 1
    const t = loop(local, ROUTE_PERIOD)

    const path = stepping ? SLOW_PATH : FAST_PATH
    /*
      The stepped route dwells at each waypoint; the straight one does not. Both
      are driven from the same 0-to-1 clock, so the two errands take exactly as
      long as each other and the difference the player sees is entirely in HOW the
      book travels rather than in how long it is gone.
    */
    const along = stepping ? steppedAlong(t, SLOW_PATH.length - 1) : t
    const [x, y, z] = pointAlong(path, along)

    if (book.current) {
      book.current.position.set(x, y, z)
      /*
        It shrinks into the machine at the end of the run and comes back at full
        size at the shelf, so the arrival reads as the book being taken IN rather
        than as it stopping against the casing.
      */
      const swallow = Math.min(1, (1 - t) / 0.08)
      const emerge = Math.min(1, t / 0.06)
      book.current.scale.setScalar(Math.min(swallow, emerge))
      book.current.rotation.set(0, 0, stepping ? 0 : -0.18)
      book.current.visible = lit > 0.05
    }

    /*
      The route in use is lit and the other is held back, so the picture says
      which of the two claims is being made right now without a word of legend.
      Two materials rather than one merged geometry for exactly this reason.
    */
    if (fastMaterial.current) {
      fastMaterial.current.emissiveIntensity = stepping ? GLOW.hold : stationGlow(lit)
    }
    if (slowMaterial.current) {
      slowMaterial.current.emissiveIntensity = stepping ? stationGlow(lit) : GLOW.hold
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

      <mesh geometry={fastRoute}>
        <meshPhysicalMaterial
          ref={fastMaterial as never}
          {...emissive(palette.visor, GLOW.source)}
        />
      </mesh>
      <mesh geometry={slowRoute}>
        <meshPhysicalMaterial
          ref={slowMaterial as never}
          {...emissive(palette.visor, GLOW.source)}
        />
      </mesh>

      {/*
        The book being fetched. One mesh: there is one of it, and an instanced
        batch of one is a buffer and a matrix write to save nothing.
      */}
      <mesh ref={book} castShadow>
        <boxGeometry args={[0.1, 0.14, 0.045]} />
        <meshPhysicalMaterial {...mattePlastic(palette.bandTrim)} />
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
 * How long one errand takes, in seconds.
 *
 * Both routes get the same number, which is the change that makes them
 * comparable: the difference the player sees is entirely in HOW the book travels,
 * where before it was in how long it took, and a slower dot mostly reads as a
 * further-away one.
 *
 * It has to fit inside `FORM_WINDOW` twice, because a visit needs to show the
 * straight grab AND the stepped version before the form fades - the paragraph
 * names two things and a viewer who saw one of them learned half a sentence. At
 * 2.1 the pair takes 4.2 s against a 4.55 s window.
 */
const ROUTE_PERIOD = 2.1
