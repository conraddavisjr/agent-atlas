import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { GLOW, emissive, mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { kerb, mergeProp, slab, trace } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { MACHINE_SCALE, machineIntake, teachingMachineGeometry } from '../teachingMachine'
import { FED_STREAMS } from '../dioramaCopy'
import { loop, pointAlong, stationGlow } from '../diorama'
import { StationLabel } from './StationLabel'

/**
 * Station one: a machine being fed nearly everything ever written.
 *
 * ## The label falling off the stream is the whole station
 *
 * The paragraph says "a machine that read very nearly everything, **and was told
 * what none of it means**". The reading is easy to draw and the second half is
 * the part that matters, so it is the part that moves: each stream carries a
 * subject - SCIENCE, PHILOSOPHY - and the label drops away at the intake while
 * the stream itself carries on in. The words go in; the meaning does not.
 *
 * Without that, this is a picture of a machine being taught, which is the
 * opposite of what the card claims.
 *
 * ## Cost
 *
 * Three draw calls for the geometry: the machine merged into one, the belt and
 * its rails merged into a second, and all five streams merged into a third.
 * `mergeProp` is the house answer for a static multi-part prop, and the streams
 * are static - what moves along them is a separate instanced batch of dots, which
 * is the other half of the same rule: "instancing stays the right tool for the
 * numerous, identical, uniformly scaled small stuff".
 *
 * The books are one more instanced batch. The labels are troika text and cost
 * what they cost.
 */
export function Fed({ lit, local }: { lit: number; local: number }) {
  const books = useRef<InstancedMesh>(null)
  const dots = useRef<InstancedMesh>(null)
  const labels = useRef<(Group | null)[]>([])

  const machine = useMemo(
    () => assertDrawable(teachingMachineGeometry(MACHINE_SCALE), 'the teaching machine'),
    [],
  )

  /*
    The belt: a deck and two rails, merged. It runs in from the right of the
    station toward the machine at its centre - `+X` is screen left here, so a belt
    that feeds from `-X` is a belt the player watches travel toward them and then
    inward, which is the direction reading goes.
  */
  const belt = useMemo(
    () =>
      assertDrawable(
        mergeProp([
          { geometry: slab(BELT_LENGTH, 0.05, 0.26, 0.02), position: [-BELT_LENGTH / 2 - 0.2, BELT_Y, 0] },
          ...[-1, 1].map((side) => ({
            geometry: kerb(BELT_LENGTH, 0.05, 0.03),
            position: [-BELT_LENGTH / 2 - 0.2, BELT_Y + 0.05, side * 0.13] as [number, number, number],
          })),
        ]),
        'the feed belt',
      ),
    [],
  )

  /*
    The five streams, merged into one geometry.

    Each is a `trace` - `geometry.ts` calls that "a circuit trace", which is
    exactly what a line of data arriving somewhere is - swept from its own start
    point to the machine's intake. They fan in from above and behind so the
    machine is being fed from the world rather than from off-screen left.
  */
  const streams = useMemo(
    () => assertDrawable(mergeProp(streamPaths().map((points) => ({ geometry: trace(points, 0.014, 24) }))), 'the data streams'),
    [],
  )

  useFrame(() => {
    const glow = stationGlow(lit)

    /*
      The books, queued along the belt. One `loop` per index with a staggered
      offset gives a queue rather than a pulse - see `diorama.ts`, which explains
      why that helper does fractional arithmetic instead of a modulo.
    */
    if (books.current) {
      for (let i = 0; i < BOOK_COUNT; i++) {
        const t = loop(local, BELT_PERIOD, i / BOOK_COUNT)
        scratch.position.set(BELT_START + (BELT_END - BELT_START) * t, BELT_Y + 0.14, 0)
        /*
          They tumble a little as they ride, which is the difference between a
          belt carrying things and a texture scrolling. The rate is irrational
          against the belt's own period so the queue never falls into lockstep.
        */
        scratch.quaternion.setFromAxisAngle(TUMBLE_AXIS, t * Math.PI * 1.7 + i)
        // Shrunk to nothing at the very end, so a book vanishes INTO the hopper
        // rather than through its far wall.
        const swallow = Math.min(1, (1 - t) / 0.12)
        scratch.scale.setScalar(swallow)
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
        books.current.setMatrixAt(i, scratch.matrix)
      }
      books.current.instanceMatrix.needsUpdate = true
    }

    /* The dots travelling each stream, three to a stream. */
    if (dots.current) {
      const paths = streamPaths()
      let n = 0
      for (let s = 0; s < paths.length; s++) {
        for (let d = 0; d < DOTS_PER_STREAM; d++) {
          const t = loop(local, STREAM_PERIOD, s * 0.17 + d / DOTS_PER_STREAM)
          const [x, y, z] = pointAlong(paths[s], t)
          scratch.position.set(x, y, z)
          scratch.quaternion.identity()
          scratch.scale.setScalar(0.4 + lit * 0.6)
          scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
          dots.current.setMatrixAt(n++, scratch.matrix)
        }
      }
      dots.current.instanceMatrix.needsUpdate = true
    }

    /*
      **The labels fall off at the intake.**

      Each one rides its own stream to a point short of the machine and then drops
      away, and this is the station's whole argument - see the header. A position
      write rather than a fade because the subject is being STRIPPED OFF, which is
      a thing that happens in space; the form as a whole fades, and its labels
      fade with it, but this particular gesture is a fall.
    */
    for (let s = 0; s < labels.current.length; s++) {
      const group = labels.current[s]
      if (!group) continue
      const t = loop(local, STREAM_PERIOD, s * 0.17)
      const path = streamPaths()[s]
      if (t < LABEL_RELEASE) {
        const [x, y, z] = pointAlong(path, t)
        group.position.set(x, y, z)
        group.visible = lit > 0.05
      } else {
        // Released: it keeps the x and z it had and falls, so it reads as the
        // subject being stripped off rather than as a label teleporting away.
        const fall = (t - LABEL_RELEASE) / (1 - LABEL_RELEASE)
        const [x, y, z] = pointAlong(path, LABEL_RELEASE)
        group.position.set(x, y - fall * fall * LABEL_FALL, z)
        group.visible = lit > 0.05 && fall < 0.85
      }
    }

    if (streamMaterial.current) streamMaterial.current.emissiveIntensity = glow
  })

  const streamMaterial = useRef<{ emissiveIntensity: number } | null>(null)

  return (
    <group>
      <mesh geometry={machine} castShadow receiveShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      <mesh geometry={belt} castShadow receiveShadow>
        <meshPhysicalMaterial {...mattePlastic(palette.plate)} />
      </mesh>

      <mesh geometry={streams}>
        <meshPhysicalMaterial
          ref={streamMaterial as never}
          {...emissive(palette.visor, GLOW.source)}
        />
      </mesh>

      {/* The books on the belt. One buffer, one draw, `BOOK_COUNT` of them. */}
      <instancedMesh ref={books} args={[undefined, undefined, BOOK_COUNT]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.13, 0.17, 0.05]} />
        <meshPhysicalMaterial {...mattePlastic(palette.bandTrim)} />
      </instancedMesh>

      {/* The data travelling the streams. */}
      <instancedMesh ref={dots} args={[undefined, undefined, FED_STREAMS.length * DOTS_PER_STREAM]} frustumCulled={false}>
        <sphereGeometry args={[0.028, 8, 6]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </instancedMesh>

      {FED_STREAMS.map((name, i) => (
        <group
          key={name}
          ref={(node) => {
            labels.current[i] = node
          }}
        >
          <StationLabel text={name} size={STREAM_LABEL_SIZE} colour="#a9c4ea" />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------------- */

type Group = import('three').Group

/**
 * Where each stream starts, and the arc it takes to the intake.
 *
 * Fanned across the top of the station rather than gathered, so five of them read
 * as five sources rather than as one thick cable. The middle control point lifts
 * each one so the set arcs in - a straight line from a corner reads as a girder.
 *
 * Rebuilt on demand rather than memoised because it is five arrays of three
 * triples and it is called once per frame by things that need the same numbers;
 * caching it would mean a module-level mutable that the seek hook could stale.
 */
function streamPaths(): [number, number, number][][] {
  return FED_STREAMS.map((_, i) => {
    const spread = (i - (FED_STREAMS.length - 1) / 2) / ((FED_STREAMS.length - 1) / 2)
    const start: [number, number, number] = [spread * 0.62, 1.12, 0.42]
    const mid: [number, number, number] = [spread * 0.4, 0.88, 0.18]
    return [start, mid, machineIntake(MACHINE_SCALE)]
  })
}

/** Scratch objects, allocated once. `Confetti.tsx`'s rule: no garbage per frame. */
const scratch = {
  matrix: new Matrix4(),
  position: new Vector3(),
  quaternion: new Quaternion(),
  scale: new Vector3(),
}
const TUMBLE_AXIS = new Vector3(0.3, 0.8, 0.5).normalize()

const BELT_LENGTH = 0.95
const BELT_Y = 0.34
const BELT_START = -1.05
const BELT_END = -0.12
/**
 * The internal cycles, retimed for a form that now holds the stage for 2.5 s.
 *
 * These were built for a stage where all three stations stayed lit for as long
 * as the player cared to read, so their periods were free. They are not any
 * more: a form is only readable while it is fully present, so its argument has
 * to land inside `FORM_WINDOW`, which is 2.05 s.
 *
 * At the old 2.9 s stream period the first subject label was released at 2.09 s,
 * which cleared the window by four hundredths of a second - true, and true by
 * luck rather than by design. At 1.8 the releases fall at 1.30, 1.63 and 1.94 s,
 * so three of them are seen on every appearance.
 */
const BELT_PERIOD = 2.2
const BOOK_COUNT = 7

const STREAM_PERIOD = 1.8
const DOTS_PER_STREAM = 3
/** How far along a stream a subject label survives before it is stripped off. */
const LABEL_RELEASE = 0.72

/**
 * How far a released label falls before it is taken off screen, in metres.
 *
 * ## It was 1.6, and at the specimen's scale that put five words on the caption
 *
 * The label is released at about local y 0.771 and stays visible to `fall` 0.85,
 * so at 1.6 it reached **-0.385** - well below the machine's own base plane. At
 * the three-station scale of 0.74 that was 28 cm below the stage and landed on
 * empty floor. At the specimen's 2.2 it is 85 cm below the base plane, which is
 * exactly where the key words and the caption now sit: SCIENCE, MATHEMATICS,
 * PHILOSOPHY, ENGINEERING and HISTORY raining through the nameplate on a 1.8 s
 * loop.
 *
 * 0.55 brings the lowest point to 0.374, which is above the base plane, so the
 * form's swept box no longer extends below the thing it stands on. The gesture
 * is unchanged in kind - the subject is still stripped off at the intake and
 * still drops away, which `Fed.tsx`'s header calls the whole station - it just
 * does it inside its own frame.
 *
 * Moving the nameplate instead was the alternative and it is the wrong trade:
 * the words are below the specimen precisely because the base plane is the one
 * edge of this composition that never moves.
 */
const LABEL_FALL = 0.55

/**
 * How large a subject label is drawn, in the form's own units.
 *
 * ## Sized against the caption now, not against the station
 *
 * 0.07 was chosen when a station was 3% of the frame and its labels were about
 * five pixels of cap - too small to read, and too small for anyone to notice that
 * five of them overlap where the streams converge. At the specimen's scale the
 * same number draws them at 0.148 m, the same size as the caption underneath the
 * whole exhibit, and the overlap became the most obvious thing in the frame.
 *
 * These are subordinate: they name what is going in, where the caption names what
 * the picture means. 0.05 puts them at about 0.106 m, two thirds of the caption
 * and twice their old rendered size, which is the hierarchy the picture wants.
 *
 * **This is legibility, not composition.** The five streams still converge into a
 * space too small for five words, and the honest fix is to re-author the fan now
 * that it owns a frame rather than a third of one. That is the next pass.
 */
const STREAM_LABEL_SIZE = 0.05
