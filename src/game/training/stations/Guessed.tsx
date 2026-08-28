import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh, type Mesh } from 'three'
import { GLOW, emissive, emissiveRaw, mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { mergeProp, trace } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { teachingMachineGeometry } from '../teachingMachine'
import { BLANK_X, promptX } from '../stage'
import { CANDIDATES, PROMPT } from '../dioramaCopy'
import { stationGlow } from '../diorama'
import { guessCue } from '../guessCue'
import type { LiveCue } from '../specimen'
import { StationLabel } from './StationLabel'

/**
 * Form three: two words, a blank, and the machine filling it in.
 *
 * ## The sentence has to read as a sentence
 *
 * It did not. `+X` is screen LEFT on this stage - the camera sits at negative Z
 * looking toward positive Z - and the prompt was laid out with ascending x, so
 * `YOUR ROYAL` rendered as `ROYAL YOUR`. That inversion has now caught this
 * feature out six times: the headline rendered mirrored, the cube opened on the
 * quiz face, all three plank verdicts showed before a shot, the hat's tip flopped
 * out of sight, the moustache curled the wrong way, and this. So the row derives
 * from `promptX`, which is a function with a test on it rather than a sign typed
 * at a mount point - exactly what `stationX` exists to be.
 *
 * ## The blank is the illustration
 *
 * This used to draw a fan of weighted candidates and light one up in place. That
 * shows the machine RANKING words, which is true and is not the claim: the
 * paragraph says it guesses "what comes next", and a guess needs somewhere to go.
 *
 * So the prompt ends in an empty slot with a rule under it, the candidates wait
 * below carrying the weight each of them actually had, and when the machine
 * decides, the winner leaves the list and flies into the slot. The sentence
 * completes itself in front of you, which is the sentence being taught.
 *
 * ## The rival is doing real work
 *
 * `dioramaCopy.ts` puts `HIGHNESS` at a quarter of the winner's weight on purpose:
 * "a fan whose right answer is the only sensible entry teaches that guessing is
 * easy, which is the opposite of what the paragraph says". Watching a genuine
 * runner-up lose is what makes the choice look like a choice, and it is why the
 * losers keep their bars after the winner has gone.
 *
 * ## The winner is its own mesh, and that is a documented constraint
 *
 * `LessonTotem.tsx` records it: "three applies an instance colour to the diffuse
 * term only, **never to emission**. So one batch cannot hold both states." The
 * losers are one instanced batch; the winner is a single mesh that can be
 * emissive. Two draw calls, and the alternative is five.
 */
export function Guessed({ cue }: { cue: LiveCue }) {
  const losers = useRef<InstancedMesh>(null)
  const winnerBar = useRef<Mesh>(null)
  const winnerWord = useRef<Group>(null)
  const spark = useRef<Mesh>(null)
  const arrow = useRef<Group>(null)
  const railMaterial = useRef<{ emissiveIntensity: number } | null>(null)

  const machine = useMemo(
    () => assertDrawable(teachingMachineGeometry(0.38), 'the guessing machine'),
    [],
  )

  const sorted = useMemo(() => [...CANDIDATES].sort((a, b) => b.weight - a.weight), [])
  const winner = sorted[0]
  const rest = useMemo(() => sorted.slice(1), [sorted])

  /*
    The feed from the machine to the blank, and the rule under the blank itself.

    One merged geometry, because neither moves - what moves is the word that lands
    on it. Both are `trace`, which `geometry.ts` calls "a circuit trace", and a
    line carrying a word out of a machine is exactly that.
  */
  const rails = useMemo(
    () =>
      assertDrawable(
        mergeProp([{ geometry: trace(FEED, 0.01, 16) }, { geometry: trace(RULE, 0.012, 8) }]),
        'the guess rails',
      ),
    [],
  )

  useFrame(() => {
    /* Read live, every frame. See `LiveCue` for why these are not props. */
    const { lit, local } = cue

    /*
      One clock, four moments: the candidates fill, one is chosen, it travels, and
      it sits in the sentence. In `guessCue.ts` rather than here because the four
      moments were once compared against a FRACTION while written in SECONDS, and
      the winning word consequently never flew - see that file.
    */
    const { filling, chosen, flight } = guessCue(local)

    if (losers.current) {
      for (let i = 0; i < rest.length; i++) {
        /*
          Scaled on X because the bar lies along it: a weight is a LENGTH here,
          which reads at this size where a height would not.

          The losers keep their bars after the choice is made. A list that emptied
          would say the machine had one option; a list that stays says it had five
          and preferred one.
        */
        const length = rest[i].weight * BAR_SCALE * filling
        scratch.position.set(BAR_X - length / 2, candidateY(i + 1), 0.1)
        scratch.quaternion.identity()
        scratch.scale.set(Math.max(0.001, length), 1, 1)
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
        losers.current.setMatrixAt(i, scratch.matrix)
      }
      losers.current.instanceMatrix.needsUpdate = true
    }

    if (winnerBar.current) {
      const length = winner.weight * BAR_SCALE * filling
      winnerBar.current.scale.set(Math.max(0.001, length), 1, 1)
      winnerBar.current.position.set(BAR_X - length / 2, candidateY(0), 0.1)
      winnerBar.current.visible = lit > 0.05
    }

    if (winnerWord.current) {
      /*
        **The flight, and it is the whole form.**

        From its own row in the list to the blank at the end of the sentence. It
        lifts toward the viewer on the way - `-Z` here - so it passes in FRONT of
        the list rather than through it, which is what stops the journey reading as
        a word being deleted in one place and drawn in another.
      */
      const z = 0.1 - Math.sin(flight * Math.PI) * 0.16
      winnerWord.current.position.set(
        WORD_X + (BLANK_X - WORD_X) * flight,
        candidateY(0) + (PROMPT_Y - candidateY(0)) * flight,
        z,
      )
      winnerWord.current.visible = lit > 0.05 && filling > 0.02
    }

    if (arrow.current) {
      /*
        It climbs the column while the candidates fill, and lands on the winner as
        the choice is made - so the two events are one gesture rather than a bar
        chart and, separately, a flash.

        `1 - filling` because the list runs weight-DESCENDING: rank 4 is the
        bottom and least likely, rank 0 is the winner at the top. The arrow starts
        at the sandwich nobody would say and ends at the word the machine picks.
      */
      const from = candidateY(CANDIDATES.length - 1)
      const to = candidateY(0)
      const eased = filling * filling * (3 - 2 * filling)
      arrow.current.position.set(ARROW_X, from + (to - from) * eased, 0.12)
      arrow.current.visible = lit > 0.05 && filling > 0.01 && flight < 0.98
    }

    if (spark.current) {
      /* The moment of choosing, before the word moves. A flash on its own row. */
      spark.current.visible = lit > 0.05 && chosen > 0 && chosen < 1
      const s = chosen * (1 - chosen) * 4
      spark.current.scale.setScalar(0.02 + s * 0.16)
      spark.current.position.set(WORD_X, candidateY(0), -0.04)
    }

    if (railMaterial.current) railMaterial.current.emissiveIntensity = stationGlow(lit)
  })

  return (
    <group>
      <mesh geometry={machine} position={[MACHINE_X, 0, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      <mesh geometry={rails}>
        <meshPhysicalMaterial
          ref={railMaterial as never}
          {...emissive(palette.visor, GLOW.source)}
        />
      </mesh>

      {/*
        The prompt, laid out with `promptX` so it reads left to right ON SCREEN.
        Written the obvious way it renders backwards; see the header.
      */}
      {PROMPT.map((word, i) => (
        <group key={word} position={[promptX(i), PROMPT_Y, 0.1]}>
          <StationLabel text={word} size={PROMPT_SIZE} colour="#dce7f8" />
        </group>
      ))}

      {/* The losers' bars. One batch; see the header for why the winner is not. */}
      <instancedMesh
        ref={losers}
        args={[undefined, undefined, Math.max(1, rest.length)]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 0.035, 0.02]} />
        <meshPhysicalMaterial {...mattePlastic(palette.bandFrame)} />
      </instancedMesh>
      {rest.map((c, i) => (
        <group key={c.word} position={[WORD_X, candidateY(i + 1), 0.1]}>
          <StationLabel text={c.word} size={CANDIDATE_SIZE} colour="#8ea4c6" />
        </group>
      ))}

      <mesh ref={winnerBar}>
        <boxGeometry args={[1, 0.045, 0.024]} />
        <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} />
      </mesh>
      <group ref={winnerWord}>
        <StationLabel text={winner.word} size={PROMPT_SIZE} colour="#e8f0ff" />
      </group>

      {/*
        **The arrow, and it is the only thing in this form that says "read
        upward".**

        The candidate list is sorted by weight, so it already carries the ranking
        - and a list is a thing a beginner reads top to bottom without noticing it
        means anything. The arrow travels the other way, from the least likely
        word to the most, and arrives on the winner at the moment it is chosen. It
        turns a static ordering into a search that ends somewhere.

        Gold, because the machine's own chatter and the choosing spark are gold:
        one colour across the round for "this is the part that matters". Not
        emissive - see the spark below for where that line is drawn.
      */}
      <group ref={arrow}>
        <mesh position={[0, -ARROW_LENGTH / 2, 0]}>
          <boxGeometry args={[ARROW_WIDTH, ARROW_LENGTH, ARROW_WIDTH]} />
          <meshPhysicalMaterial {...mattePlastic(palette.gold)} />
        </mesh>
        {/* The head: a cone, pointing the way it travels. */}
        <mesh rotation={[0, 0, 0]}>
          <coneGeometry args={[ARROW_WIDTH * 2.6, ARROW_WIDTH * 4, 4]} />
          <meshPhysicalMaterial {...mattePlastic(palette.gold)} />
        </mesh>
      </group>

      {/*
        The choice's spark, in the same gold as the arrow and the machine's
        chatter - one colour for "this is the thing that matters" across the whole
        round, where before it was cyan here and gold there.

        `emissiveRaw` rather than `emissive`, and that distinction is what keeps
        this legal: `00-art-bible.md` reserves the BLOOM tier for ally blue and
        reward gold, and raw sits deliberately below the normalisation the bloom
        budget uses. So this is a gold flash on a diagram rather than a gold glow
        the player might read as something they had won.
      */}
      <mesh ref={spark} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial {...emissiveRaw(palette.gold, GLOW.source)} />
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

/** The sentence, along the top. `promptX` and `BLANK_X` live in `stage.ts`. */
const PROMPT_Y = 0.96
const PROMPT_SIZE = 0.062

/** The rule under the blank. Present before the word is, because it is a waiting slot. */
const RULE: [number, number, number][] = [
  [BLANK_X + 0.17, PROMPT_Y - 0.075, 0.1],
  [BLANK_X - 0.17, PROMPT_Y - 0.075, 0.1],
]

/*
  The machine sits at screen RIGHT, past the end of the sentence, and feeds the
  blank from below. Reading order does the work: the eye takes the prompt left to
  right, arrives at the empty slot, and the feed line points back at what is about
  to fill it.
*/
const MACHINE_X = -0.72
const FEED: [number, number, number][] = [
  [MACHINE_X, 0.62, 0.1],
  [MACHINE_X + 0.18, 0.85, 0.1],
  [BLANK_X - 0.2, PROMPT_Y - 0.075, 0.1],
]

/**
 * The arrow that climbs the candidate list, in the form's own units.
 *
 * To the RIGHT of the words on screen, which is a lower x - `+X` is screen left
 * here. The list is at `WORD_X` 0.86 with its bars running left from `BAR_X`, so
 * the arrow sits on the far side of the words from the bars and neither crowds
 * the other.
 */
const ARROW_X = 1.12
const ARROW_LENGTH = 0.13
const ARROW_WIDTH = 0.018

/** The candidate list, under the sentence it is competing to finish. */
const FAN_TOP = 0.6
const FAN_PITCH = 0.14
const WORD_X = 0.86
const BAR_X = 0.56
const CANDIDATE_SIZE = 0.042
/** A weight of 1 would draw a bar this many units long. */
const BAR_SCALE = 0.5
