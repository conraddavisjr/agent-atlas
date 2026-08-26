import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh } from 'three'
import { mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { kerb, mergeProp, slab } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { MACHINE_SCALE, teachingMachineGeometry } from '../teachingMachine'
import { BOOK_SUBJECTS } from '../dioramaCopy'
import { loop } from '../diorama'
import type { LiveCue } from '../specimen'
import { StationLabel } from './StationLabel'

/**
 * Form one: a machine being fed nearly everything ever written.
 *
 * ## The belt says it, and the streams used to say it twice
 *
 * This station had two illustrations of one idea stacked on top of each other: a
 * conveyor of books running into the hopper, and five glowing data streams arcing
 * in from above with subject labels riding them. The streams were the older idea
 * and they were the ones doing the arguing - each carried a subject that was
 * stripped off at the intake, so the words went in and the meaning did not.
 *
 * They are gone and the belt has taken the argument over. Three reasons, in order
 * of weight:
 *
 * **They collided with themselves.** Five paths converging on one intake put five
 * labels into a space about a label and a half wide. At the old station size that
 * was a detail nobody could read; at the specimen's it was the most obvious thing
 * in the frame. Fixing it means fanning them wide enough that they stop reading
 * as one machine being fed.
 *
 * **They cost the whole top of the composition.** The streams reached local y 1.12
 * where the machine tops out at about half that, so two thirds of this form's
 * height was carrying decoration. Deleting them is what gives the exhibit its
 * vertical room back.
 *
 * **A book is a better drawing of "read" than a glowing dot is.** The paragraph
 * says the machine "read very nearly everything". A labelled book going into a
 * hopper is that sentence, and it needs no legend.
 *
 * ## One book per subject, mounted once
 *
 * Each book keeps its own label for the life of the round and rides the belt on a
 * staggered offset, so the queue cycles without a single piece of text ever being
 * rewritten. That matters: `text` is the one property on troika's syncable list
 * this stage actually uses, so a label that changed as a book recycled would be a
 * glyph re-layout every second for no reason.
 */
export function Fed({ cue }: { cue: LiveCue }) {
  const books = useRef<InstancedMesh>(null)
  const labels = useRef<(Group | null)[]>([])

  const machine = useMemo(
    () => assertDrawable(teachingMachineGeometry(MACHINE_SCALE), 'the teaching machine'),
    [],
  )

  /*
    The belt: a deck and two rails, merged. It runs in from the player's right
    toward the machine at the centre - `+X` is screen LEFT on this stage, so a belt
    that feeds from `-X` is one the eye follows in the direction it reads.
  */
  const belt = useMemo(
    () =>
      assertDrawable(
        mergeProp([
          {
            geometry: slab(BELT_LENGTH, 0.05, 0.26, 0.02),
            position: [BELT_START + BELT_LENGTH / 2, BELT_Y, 0],
          },
          ...[-1, 1].map((side) => ({
            geometry: kerb(BELT_LENGTH, 0.05, 0.03),
            position: [BELT_START + BELT_LENGTH / 2, BELT_Y + 0.05, side * 0.13] as [
              number,
              number,
              number,
            ],
          })),
        ]),
        'the feed belt',
      ),
    [],
  )

  useFrame(() => {
    /* Read live, every frame. See `LiveCue` for why these are not props. */
    const { lit, local } = cue

    for (let i = 0; i < BOOK_SUBJECTS.length; i++) {
      /*
        One `loop` per index with a staggered offset gives a queue rather than a
        pulse - see `diorama.ts` for why that helper does fractional arithmetic
        rather than a modulo, which matters because a seeked round can hand it a
        negative and a book at -0.3 along a belt is a book behind the camera.
      */
      const t = loop(local, BELT_PERIOD, i / BOOK_SUBJECTS.length)
      const x = BELT_START + (BELT_END - BELT_START) * t

      /*
        Swallowed rather than stopped. The book shrinks to nothing over the last
        tenth of the belt, so it vanishes INTO the hopper rather than through its
        far wall - which is what makes the machine look like it is eating instead
        of like the belt is clipping.
      */
      const swallow = Math.min(1, (1 - t) / SWALLOW_AT)

      if (books.current) {
        scratch.position.set(x, BELT_Y + 0.14, 0)
        /*
          A little tumble as they ride, which is the difference between a belt
          carrying things and a texture scrolling. The rate is irrational against
          the belt's own period so the queue never falls into lockstep.
        */
        scratch.quaternion.setFromAxisAngle(TUMBLE_AXIS, t * Math.PI * 1.7 + i)
        scratch.scale.setScalar(swallow)
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
        books.current.setMatrixAt(i, scratch.matrix)
      }

      const label = labels.current[i]
      if (label) {
        /*
          **Staggered onto two heights, and this is a fix rather than a flourish.**

          Five titles evenly spaced along the belt gave each about 0.66 m of room
          and `ENGINEERING` renders 0.67 m wide, so the row came out as
          ENGINEERINGPHILOSOPHYMATHEMATICS - touching, which reads as one long
          nonsense word. Shrinking the type alone would have fixed it by making
          the titles hard to read again, which is the thing this whole pass was
          for.

          Alternating the height doubles the horizontal room each title has
          without touching its size, and it costs a little of the vertical space
          this form has to spare - it is the shortest of the three.
        */
        label.position.set(x, BELT_Y + LABEL_LIFT + (i % 2) * LABEL_STAGGER, 0)
        /*
          **The subject goes before the book does, and that is the whole second
          half of the paragraph.**

          "A machine that read very nearly everything, and was told what none of it
          means." The book is what the hopper gets; the subject is what it does
          not. The two vanishing together would read as the whole thing going in,
          which is the opposite claim.
        */
        label.visible = lit > 0.05 && t < SUBJECT_LOST_AT
      }
    }
    if (books.current) books.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <mesh geometry={machine} castShadow receiveShadow>
        <meshPhysicalMaterial {...shell(palette.shell)} />
      </mesh>

      {/*
        Matte, not emissive. The belt is a surface, not a light - and
        `emissiveIntensityFor` refuses `palette.plate` outright, because at linear
        luminance 0.09 normalising it to the bloom threshold would need an
        intensity of 16 and render as blown-out white. That guardrail is the art
        bible's section 1 speaking, and it caught this on the first frame.
      */}
      <mesh geometry={belt} castShadow receiveShadow>
        <meshPhysicalMaterial {...mattePlastic(palette.plate)} />
      </mesh>

      {/* The books. One buffer, one draw, one per subject. */}
      <instancedMesh
        ref={books}
        args={[undefined, undefined, BOOK_SUBJECTS.length]}
        castShadow
        frustumCulled={false}
      >
        <boxGeometry args={[0.15, 0.2, 0.06]} />
        {/*
          `hardware` rather than `bandTrim`. The books were the belt's own colour,
          which in a room this dark meant a dark box on a dark deck: the thing the
          whole form is about was the least visible thing in the frame. A pale
          spine separates them from the surface carrying them, which is what a
          book on a conveyor actually looks like.
        */}
        <meshPhysicalMaterial {...mattePlastic(palette.hardware)} />
      </instancedMesh>

      {BOOK_SUBJECTS.map((subject, i) => (
        <group
          key={subject}
          ref={(node) => {
            labels.current[i] = node
          }}
        >
          <StationLabel text={subject} size={SUBJECT_SIZE} colour="#a9c4ea" />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------------- */

/** Scratch objects, allocated once. `Confetti.tsx`'s rule: no garbage per frame. */
const scratch = {
  matrix: new Matrix4(),
  position: new Vector3(),
  quaternion: new Quaternion(),
  scale: new Vector3(),
}
const TUMBLE_AXIS = new Vector3(0.3, 0.8, 0.5).normalize()

/**
 * How long the belt is, and where it starts.
 *
 * Longer than it was, and the length is set by the LABELS rather than by the
 * machine. Five books need five titles that do not touch, and `MATHEMATICS` is
 * about 0.33 wide at `SUBJECT_SIZE` - so the spacing has to clear that. This is
 * what makes the belt 1.75 where it was 0.95, back when the books were unlabelled
 * and the streams did the naming.
 *
 * It is also the number that sets this form's ASPECT, which is why it is not just
 * "as long as looks nice". The exhibit fits a 2.46 by 4.2 box; a belt long enough
 * for six titles made the form 2.57 wide by 0.72 tall, so it hit the width limit
 * and was drawn two thirds the height of its neighbours. Every book added here
 * costs height.
 */
const BELT_START = -1.8
const BELT_END = -0.05
const BELT_LENGTH = BELT_END - BELT_START
const BELT_Y = 0.34

/**
 * How long one book takes to travel the whole belt, in seconds.
 *
 * Five books staggered across it means one is swallowed every `BELT_PERIOD / 5`,
 * so this is really a choice about how often the machine eats. At 4.2 that is
 * every 0.84 s - often enough to read as continuous feeding, slow enough that a
 * title can be read on the way past.
 *
 * It has to be at most `FORM_WINDOW`, or a book that enters at the far end never
 * reaches the hopper inside the time the form is on stage. See `specimen.ts`.
 */
const BELT_PERIOD = 4.2

/** How far above the belt a subject rides. Clear of the book, not floating free. */
const LABEL_LIFT = 0.32
/** How far every second title sits above its neighbours. See the frame body. */
const LABEL_STAGGER = 0.17
const SUBJECT_SIZE = 0.05

/** The last tenth of the belt, over which a book shrinks into the hopper. */
const SWALLOW_AT = 0.1

/** Where along the belt the subject is lost. See the note at the visibility write. */
const SUBJECT_LOST_AT = 0.82
