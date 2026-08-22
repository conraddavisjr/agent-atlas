import { Suspense, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type { Group } from 'three'
import { mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { CUBE_SIZE } from './stage'
import { CARDS, QUIZ } from './cards'
import { FACE_COUNT, QUIZ_FACE, cubeDescent, cubePosition, cubeRise, cubeYaw, facePlacement } from './cube'
import type { TrainingState } from './trainingMachine'

/**
 * The cube the round is read off.
 *
 * ## Why a cube rather than a panel
 *
 * The user asked for one, and it earns its place: a card that cross-fades to the
 * next card has no direction, and a round that is going somewhere should look like
 * it. A quarter turn says "there is more of this, and it is over there" in a way
 * no fade does, and it makes the QUIZ face arriving the same gesture as a page
 * turn rather than a new screen appearing.
 *
 * Four faces, three used: two reading cards, the quiz, and one spare that the
 * success state will take in milestone 3.
 *
 * ## The text
 *
 * drei's `<Text>`, one subtree per face, each behind its OWN `<Suspense>`. That
 * boundary is not decoration - see `Headline.tsx` for the full argument. The short
 * version: `<Text>` suspends on a font fetched from a CDN at runtime, the scene
 * and `SceneReady` share one Suspense boundary in `App.tsx`, and an unguarded
 * `<Text>` therefore puts a network request on the critical path of the iris hold.
 * A stall here degrades to a blank face rather than to a scene that never appears.
 *
 * Nothing here is emissive. `00-art-bible.md` reserves bloom for ally blue and
 * reward gold, and a paragraph that glowed would read as something the player had
 * won.
 *
 * ## Mounted from the start, held out of frame
 *
 * The cube exists for the whole round and is parked at the drop height until
 * `cubeIn`. Mounting it late would put the font fetch in the middle of the beat it
 * is supposed to be arriving on, which is the one moment the player is watching
 * it. `cubeDescent` returning 0 for every earlier phase is what parks it.
 */
export function CardCube({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)

  useFrame(() => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    /*
      Position and rotation are both pure functions of the round's state rather
      than animations this component drives. A cube that owned its own tween would
      be caught mid-turn with no way to finish if the round were ever seeked - by
      the dev hook today, by a resume later. See `cube.ts`.
    */
    /*
      FROZEN during the exit, and this is a hold rather than an oversight.

      `cubeRise` is a pure function of the phase, so it cannot know which pose the
      exit came from - and `exiting` is reachable from anywhere, because Escape
      bails out of any beat. Left to compute, a won round drops the cube 2.5 m
      straight back down through the answer column while the iris is still closing
      over it, which is the last thing the player sees.

      Holding is the same decision `cameraPose('exiting')` documents: nothing moves
      once the round is over, because there is nothing left to show.
    */
    if (state.phase === 'exiting') return

    const [x, y, z] = cubePosition(cubeDescent(state), cubeRise(state))
    g.position.set(x, y, z)
    g.rotation.y = cubeYaw(state)
  })

  return (
    <group ref={group}>
      {/*
        The body. A plain box, and the one place in this project a hard 90-degree
        edge is correct: the world rule about bevels is about MOULDED objects, and
        this is not a moulded object. It is a screen with four sides, and a
        rounded one would read as a die.
      */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
        <meshPhysicalMaterial {...mattePlastic(palette.bandTrim, { clearcoat: 0.12 })} />
      </mesh>

      {Array.from({ length: FACE_COUNT }, (_, face) => {
        const { position, rotation } = facePlacement(face)
        return (
          <group key={face} position={position} rotation={rotation}>
            <Suspense fallback={null}>
              <FaceContent face={face} />
            </Suspense>
          </group>
        )
      })}
    </group>
  )
}

/**
 * What one face says.
 *
 * Split out so that each face's text sits inside its own Suspense boundary rather
 * than sharing one: with a single boundary around all four, a font stall would
 * blank every face at once, and the cube would be a featureless block for as long
 * as it lasted.
 */
function FaceContent({ face }: { face: number }) {
  const half = CUBE_SIZE / 2

  if (face === QUIZ_FACE) {
    return (
      <Text
        position={[0, 0, 0]}
        /*
          Larger than a card body. The quiz pose puts the cube further from the
          camera than the reading pose does, and a question that shrank as it was
          asked would be the wrong way round.
        */
        fontSize={0.185}
        color="#dbe6f7"
        anchorX="center"
        anchorY="middle"
        maxWidth={CUBE_SIZE * 0.82}
        textAlign="center"
        lineHeight={1.5}
        outlineWidth={0.006}
        outlineColor="#0b1020"
      >
        {QUIZ.question}
      </Text>
    )
  }

  const card = CARDS[face]
  // A face past the reading and past the quiz. Blank on purpose - it is the spare.
  if (!card) return null

  return (
    <>
      {/*
        Pinned near the top edge, and the body below is sized so the two cannot
        meet. The first version put the heading at `half - 0.34` with a 0.125 body
        centred at -0.05, and a six-line card ran its top line straight through
        the heading - legible enough to miss in a thumbnail and obviously wrong at
        full size.
      */}
      <Text
        position={[0, half - 0.24, 0]}
        fontSize={0.1}
        color="#7f97bd"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.14}
        outlineWidth={0.004}
        outlineColor="#0b1020"
      >
        {card.heading}
      </Text>
      <Text
        position={[0, -0.09, 0]}
        fontSize={0.106}
        color="#e4ecfa"
        anchorX="center"
        anchorY="middle"
        /*
          0.82 of the face rather than the full width. troika wraps on `maxWidth`,
          and text that wraps at the very edge of a solid reads as though it is
          falling off it - the margin is what makes the face look like a card.
        */
        maxWidth={CUBE_SIZE * 0.82}
        textAlign="center"
        lineHeight={1.38}
        outlineWidth={0.005}
        outlineColor="#0b1020"
      >
        {card.body}
      </Text>
    </>
  )
}
