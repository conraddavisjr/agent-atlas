import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh, type Mesh } from 'three'
import { GLOW, emissive, emissiveRaw, mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { mergeProp, trace } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { teachingMachineGeometry } from '../teachingMachine'
import { CANDIDATES, PROMPT } from '../dioramaCopy'
import { loop } from '../diorama'
import { StationLabel } from './StationLabel'

/**
 * Station three: two words in, five candidates, one lands.
 *
 * ## The bars are the argument
 *
 * The paragraph's claim is not that the machine picks a word, it is that it picks
 * *uncannily well*. A picture of one word appearing shows the first and not the
 * second. So every candidate is drawn with the weight it actually carried, and
 * `dioramaCopy.ts` puts a real rival at a quarter of the winner's share -
 * "a fan whose right answer is the only sensible entry teaches that guessing is
 * easy, which is the opposite of what the paragraph says."
 *
 * ## The winner is its own mesh, and that is a documented constraint
 *
 * `LessonTotem.tsx` records it: "three applies an instance colour to the diffuse
 * term only, **never to emission**. So one batch cannot hold both states." The
 * four losers are one instanced batch; the winner is a single mesh that can be
 * emissive. Two draw calls, and the alternative is five.
 *
 * ## The winner steps forward rather than brightening alone
 *
 * The lock moves the winning word toward the viewer and brightens its bar,
 * because a thing that wins should do something rather than merely become more
 * of what it was.
 *
 * This used to carry a note saying text on this stage could never fade, because
 * troika's opacity needs a `sync()`. That claim was never measured and it is
 * false - see `formPresence.ts` - and the specimen now fades this whole station
 * in and out on every change-over. The step forward stays because it is the
 * better gesture for a lock, not because a fade was unavailable.
 */
export function Guessed({ lit, local }: { lit: number; local: number }) {
  const losers = useRef<InstancedMesh>(null)
  const winnerBar = useRef<Mesh>(null)
  const winnerWord = useRef<Group>(null)
  const spark = useRef<Mesh>(null)

  const machine = useMemo(
    () => assertDrawable(teachingMachineGeometry(0.38), 'the guessing machine'),
    [],
  )

  /* The rail the prompt words ride in on, and the fan's spine. */
  const rails = useMemo(
    () =>
      assertDrawable(
        mergeProp([
          { geometry: trace(RAIL, 0.01, 12) },
          ...CANDIDATES.map((_, i) => ({
            geometry: trace(
              [
                [0.06, MACHINE_Y + 0.34, 0.1],
                [FAN_X, candidateY(i), 0.1],
              ],
              0.007,
              8,
            ),
          })),
        ]),
        'the guess rails',
      ),
    [],
  )

  const sorted = useMemo(() => [...CANDIDATES].sort((a, b) => b.weight - a.weight), [])
  const winner = sorted[0]
  const rest = useMemo(() => sorted.slice(1), [sorted])

  useFrame(() => {
    /*
      The cycle, as one clock: the prompt arrives, the fan fills, the winner
      locks, everything clears. Derived from `local` rather than tracked in a ref
      so a seeked round is never caught between two of its own steps.
    */
    const t = loop(local, CYCLE)
    const filling = Math.min(1, Math.max(0, (t - FAN_AT) / (LOCK_AT - FAN_AT)))
    const locked = t > LOCK_AT ? Math.min(1, (t - LOCK_AT) / 0.12) : 0

    if (losers.current) {
      for (let i = 0; i < rest.length; i++) {
        const height = rest[i].weight * BAR_SCALE * filling
        scratch.position.set(FAN_X - BAR_LENGTH / 2, candidateY(i + 1), 0.1)
        scratch.quaternion.identity()
        // Scaled on X because the bar lies along it: a weight is a LENGTH here,
        // which reads at this size where a height would not.
        scratch.scale.set(Math.max(0.001, height), 1, 1)
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
        losers.current.setMatrixAt(i, scratch.matrix)
      }
      losers.current.instanceMatrix.needsUpdate = true
    }

    if (winnerBar.current) {
      const height = winner.weight * BAR_SCALE * filling
      winnerBar.current.scale.set(Math.max(0.001, height), 1, 1)
      winnerBar.current.position.set(FAN_X - BAR_LENGTH / 2, candidateY(0), 0.1)
    }

    /* The lock: the winning word steps toward the viewer, which is -Z here. */
    if (winnerWord.current) {
      winnerWord.current.position.set(FAN_X + 0.34, candidateY(0), 0.1 - locked * 0.14)
      winnerWord.current.visible = lit > 0.05
    }

    if (spark.current) {
      spark.current.visible = lit > 0.05 && locked > 0 && locked < 1
      const s = locked * (1 - locked) * 4
      spark.current.scale.setScalar(0.02 + s * 0.14)
      spark.current.position.set(FAN_X + 0.34, candidateY(0), -0.06)
    }
  })

  return (
    <group>
      <mesh geometry={machine} position={[-0.52, MACHINE_Y, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      <mesh geometry={rails}>
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>

      {/* The prompt: the short run-up the machine gets. */}
      {PROMPT.map((word, i) => (
        <group key={word} position={[-0.86 + i * 0.32, MACHINE_Y + 0.62, 0.1]}>
          <StationLabel text={word} size={0.052} colour="#dce7f8" />
        </group>
      ))}

      {/* The four that lost. One batch; see the header for why the winner is not. */}
      <instancedMesh ref={losers} args={[undefined, undefined, Math.max(1, rest.length)]} frustumCulled={false}>
        <boxGeometry args={[BAR_LENGTH, 0.035, 0.02]} />
        <meshPhysicalMaterial {...mattePlastic(palette.bandFrame)} />
      </instancedMesh>
      {rest.map((c, i) => (
        <group key={c.word} position={[FAN_X + 0.34, candidateY(i + 1), 0.1]}>
          <StationLabel text={c.word} size={0.042} colour="#8ea4c6" />
        </group>
      ))}

      <mesh ref={winnerBar}>
        <boxGeometry args={[BAR_LENGTH, 0.045, 0.024]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
      <group ref={winnerWord}>
        <StationLabel text={winner.word} size={0.048} colour="#e8f0ff" />
      </group>

      {/*
        The lock's spark. `emissiveRaw` rather than `emissive`, deliberately below
        the normalisation the bloom budget uses - this is a flash on a diagram,
        and `00-art-bible.md` keeps tier A for ally blue and reward gold.
      */}
      <mesh ref={spark} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial {...emissiveRaw(palette.visor, GLOW.source)} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------------- */

/** Where a candidate sits, top to bottom in weight order. */
function candidateY(rank: number): number {
  return FAN_TOP - rank * FAN_PITCH
}

const scratch = {
  matrix: new Matrix4(),
  position: new Vector3(),
  quaternion: new Quaternion(),
  scale: new Vector3(),
}

const MACHINE_Y = 0.36
const RAIL: [number, number, number][] = [
  [-0.86, MACHINE_Y + 0.62, 0.1],
  [-0.52, MACHINE_Y + 0.5, 0.1],
  [0.06, MACHINE_Y + 0.34, 0.1],
]

/*
  The label sizes came down with the specimen's arrival, for the reason `Fed.tsx`
  spells out at `STREAM_LABEL_SIZE`: sized for a station at 3% of the frame, they
  drew at the caption's own size once one form owned the frame. The RATIO between
  prompt, candidate and winner is unchanged, which is what carries the hierarchy.
*/
const FAN_X = 0.02
const FAN_TOP = 1.02
const FAN_PITCH = 0.16
const BAR_LENGTH = 0.34
/** A weight of 1 would draw a bar this many times its own length. */
const BAR_SCALE = 1

/**
 * The cycle, in seconds, and where its two moments fall inside it.
 *
 * ## 5.2 would have meant this station never resolved, ever
 *
 * The lock is at `LOCK_AT` 0.62 of the cycle, so at 5.2 it landed at **3.22 s**.
 * A form now holds the stage for `FORM_DWELL` 2.5 and is fully readable for
 * `FORM_WINDOW` 2.05. The player would have watched the fan fill and fade away
 * unresolved, three times a round, every round - and the lock is not decoration,
 * it is the entire argument. The paragraph's claim is not that the machine picks
 * a word, it is that it picks uncannily WELL, and the picture of that is one
 * candidate winning.
 *
 * Nothing would have thrown, nothing would have logged, and a screenshot taken
 * at any moment would have shown a station that looked like it was still
 * thinking.
 *
 * At 2.2 the fan fills from 0.48 to 1.36 s, locks at 1.36, and holds the lock
 * for the remaining 0.84 - so the resolution is seen and then dwelt on.
 */
const CYCLE = 2.2
const FAN_AT = 0.22
const LOCK_AT = 0.62

/*
  The bars are plain boxes rather than `slab`, and that is the one place on this
  stage the kit is deliberately not used. A bar chart's whole job is that its
  lengths are comparable, and a bevel that eats 12% of a short bar and 2% of a
  long one is a chart that misreports its own numbers.
*/
