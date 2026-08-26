import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { DIORAMA_AT, STATION_PITCH } from './stage'
import { CARD_0_STATIONS } from './dioramaCopy'
import {
  DIM_FLOOR,
  STATION_COUNT,
  dioramaVisible,
  stationAt,
  stationCue,
  STATION_SCALE,
  stationLift,
  swapDip,
} from './diorama'
import { Fed } from './stations/Fed'
import { Fetched } from './stations/Fetched'
import { Guessed } from './stations/Guessed'
import { StationLabel } from './stations/StationLabel'
import type { TrainingState } from './trainingMachine'

/**
 * The teaching stage: three stations that act a paragraph out.
 *
 * ## Why it took the cube's place
 *
 * The round used to teach with two paragraphs printed on a rotating board, and
 * both of them describe things that are visual - a machine fed everything ever
 * written, a lookup that is sometimes instant and sometimes a procedure, a guess
 * that lands uncannily well. A reader had to build all of that in their head from
 * text on a face.
 *
 * So the text moved to the HUD, where a paragraph is a paragraph, and the frame
 * went to the illustration, which is the thing that cannot be shown anywhere
 * else. The cube kept the one job a board is still the right object for: asking
 * the question.
 *
 * ## Everything below reads a cue and nothing else
 *
 * `stationCue` owns the pacing - see `diorama.ts` for why that is one function
 * and what it buys. A station is handed `lit` and a clock that starts when it
 * lights, and knows nothing about the sequence, the mode, or its neighbours.
 *
 * ## Mounted for the whole round, moved out of the way
 *
 * Like the cube and the instructor before it: the labels resolve their font
 * asynchronously and mounting them at the top of the beat would put a network
 * request in the middle of the moment the player is watching. It sits below the
 * floor until it is wanted, which costs a matrix write a frame and nothing else.
 */
export function TeachingStage({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)
  const stations = useRef<(Group | null)[]>([])
  const cues = useRef([
    { lit: 0, local: 0 },
    { lit: 0, local: 0 },
    { lit: 0, local: 0 },
  ])

  useFrame(() => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    if (!dioramaVisible(state)) {
      g.visible = false
      return
    }
    g.visible = true

    /*
      The swap, as a lift rather than a cut.

      `swapping` is the beat that used to be the cube's quarter turn, and it does
      the same job: it says "there is more of this, and it is over there". The
      stage sinks and rises, and the card index has already changed by the time it
      comes back up - the machine advances `card` on the swap's completion, not on
      the press, for the same reason the cube advanced it on the turn's.
    */
    const swap = state.phase === 'swapping' ? swapDip(state.elapsed) : 0
    g.position.set(DIORAMA_AT[0], DIORAMA_AT[1] - swap, DIORAMA_AT[2])

    for (let i = 0; i < STATION_COUNT; i++) {
      const cue = stationCue(i, state.phase === 'reading' ? state.elapsed : 0)
      cues.current[i] = cue

      const node = stations.current[i]
      if (!node) continue
      const [x, y, z] = stationAt(i)
      /*
        The lift is what stands in for a fade. `Headline.tsx` records why nothing
        on this stage fades: troika's opacity needs a `sync()` to take effect, so
        a fade is a text re-sync every frame for its length, where moving a group
        is a matrix write.
      */
      node.position.set(x - DIORAMA_AT[0], y - DIORAMA_AT[1] + stationLift(cue.lit), z - DIORAMA_AT[2])
    }
  })

  return (
    <group ref={group} position={DIORAMA_AT} visible={false}>
      {/*
        A plinth under the whole stage, so three vignettes read as one exhibit
        rather than as three objects that happen to be in a row. One box, and it
        is the only thing here that does not move.
      */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[STATION_PITCH * STATION_COUNT + 0.3, 0.12, 1.15]} />
        <meshPhysicalMaterial {...mattePlastic(palette.plate)} />
      </mesh>

      {CARD_0_STATIONS.map((station, i) => (
        <group
          key={station.label}
          ref={(node) => {
            stations.current[i] = node
          }}
        >
          {/*
            Scaled here rather than inside each station, so the three share one
            number and a change to it cannot leave one of them at the old size.
          */}
          <group scale={STATION_SCALE}>
            <Station index={i} cues={cues} />
          </group>

          {/*
            The label and its clause, under the station. Numbered, because the
            three are an argument in an order and a reader coming in halfway needs
            to know which end it starts at.
          */}
          <group position={[0, -0.16, LABEL_Z]}>
            <StationLabel text={`${i + 1}. ${station.label}`} size={0.12} colour="#dce7f8" letterSpacing={0.06} />
          </group>
          <group position={[0, -0.34, LABEL_Z]}>
            <StationLabel text={station.caption} size={0.075} colour="#9db4d6" maxWidth={1.9} />
          </group>
        </group>
      ))}
    </group>
  )
}

/**
 * How far forward the labels sit, in metres.
 *
 * IN FRONT of the plinth's own front face, which is at half its depth. Left at
 * the station's centre they sat inside the plinth and the round's three numbered
 * labels were readable only from the waist up - the kind of defect that looks
 * like a font problem rather than like a depth one.
 */
const LABEL_Z = -0.72

/**
 * One station's contents, chosen by index.
 *
 * A switch rather than an array of components, so a card with the wrong number of
 * stations fails to compile rather than rendering two thirds of a lesson.
 */
function Station({
  index,
  cues,
}: {
  index: number
  cues: RefObject<{ lit: number; local: number }[]>
}) {
  const cue = cues.current?.[index] ?? { lit: 0, local: 0 }
  const props = { lit: Math.max(DIM_FLOOR, cue.lit), local: cue.local }
  if (index === 0) return <Fed {...props} />
  if (index === 1) return <Fetched {...props} />
  return <Guessed {...props} />
}

