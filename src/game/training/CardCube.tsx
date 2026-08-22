import { Suspense, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type { Group } from 'three'
import { mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { CUBE_SIZE } from './stage'
import { QUIZ } from './cards'
import { FACE_INSET, cubeDescent, cubePosition, cubeRise } from './cube'
import type { TrainingState } from './trainingMachine'

/**
 * The question board.
 *
 * ## It was the whole lesson and now it asks one thing
 *
 * Four faces, two reading cards and a quiz, turning a quarter at a time - that
 * was the argument for a cube over a panel, and it was a good one: "a card that
 * cross-fades to the next card has no direction, and a round that is going
 * somewhere should look like it."
 *
 * The reading moved to the diorama, which acts the paragraphs out instead of
 * printing them, and the direction moved with it. What was left for a cube to do
 * was hold the question, so that is all it does: it drops in when the teaching
 * ends and withdraws when the shooting begins, and the round reads as one object
 * per act - wizard, diorama, board, bow.
 *
 * ## The text
 *
 * drei's `<Text>` behind its OWN `<Suspense>`. That boundary is not decoration -
 * see `Headline.tsx` for the full argument. The short version: `<Text>` suspends
 * on a font fetched from a CDN at runtime, the scene and `SceneReady` share one
 * Suspense boundary in `App.tsx`, and an unguarded `<Text>` therefore puts a
 * network request on the critical path of the iris hold. A stall here degrades to
 * a blank face rather than to a scene that never appears.
 *
 * Not emissive. `00-art-bible.md` reserves bloom for ally blue and reward gold,
 * and a glowing question would read as something the player had won.
 *
 * ## Mounted from the start, held out of frame
 *
 * The board exists for the whole round and is parked at the drop height until
 * `cubeIn`. Mounting it late would put the font fetch in the middle of the beat
 * it is supposed to be arriving on, which is the one moment the player is
 * watching it. `cubeDescent` returning 0 for every earlier phase is what parks it.
 */
export function CardCube({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)

  useFrame(() => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    /*
      The position is a pure function of the round's state rather than an
      animation this component drives. A board that owned its own tween would be
      caught mid-move with no way to finish if the round were ever seeked - by the
      dev hook today, by a resume later. See `cube.ts`.
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

      {/*
        The question, on the face the camera can see. `FACE_INSET` is negative for
        that reason and says so in its own doc - this stage is authored at +Z and
        viewed from -Z, and the half turn is what stops the words arriving
        mirrored.
      */}
      <group position={[0, 0, FACE_INSET]} rotation={[0, Math.PI, 0]}>
        <Suspense fallback={null}>
          <Text
            fontSize={0.185}
            color="#dbe6f7"
            anchorX="center"
            anchorY="middle"
            /*
              0.82 of the face rather than the full width. troika wraps on
              `maxWidth`, and text that wraps at the very edge of a solid reads as
              though it is falling off it - the margin is what makes the face look
              like a board.
            */
            maxWidth={CUBE_SIZE * 0.82}
            textAlign="center"
            lineHeight={1.5}
            outlineWidth={0.006}
            outlineColor="#0b1020"
          >
            {QUIZ.question}
          </Text>
        </Suspense>
      </group>
    </group>
  )
}
