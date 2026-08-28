import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh } from 'three'
import { mattePlastic, shell } from '@/art/materials'
import { palette } from '@/art/palette'
import { kerb, mergeProp, slab } from '@/art/geometry'
import { assertDrawable } from '@/game/world/hubLayout'
import { MACHINE_SCALE, teachingMachineGeometry } from '../teachingMachine'
import { BOOK_SUBJECTS, MACHINE_CHATTER } from '../dioramaCopy'
import { loop } from '../diorama'
import { NOM_OFFSETS, chatterCue } from '../chatterCue'
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
  const machineNode = useRef<Group>(null)
  const noms = useRef<(Group | null)[]>([])
  const asides = useRef<(Group | null)[]>([])

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

    /*
      **The machine is alive, and the point is that it is only just alive.**

      A hopper that eats books and does not move is a picture of a hopper. The
      brief asked for something "slightly living" that gobbles, and the whole
      difficulty is the word slightly: this thing sits in the middle of the frame
      for five seconds at a time with a paragraph being read over it, so anything
      big enough to notice consciously is big enough to distract from the words.

      Three layers, smallest to largest, and none of them is a keyframe:

      1. **A tremor.** Sub-millimetre, fast, and irrational against everything
         else so it never lands on a beat. This is what stops the machine reading
         as a still image between bites.
      2. **A sway.** A slow lean, forward and back on one period and side to side
         on another. The two are deliberately coprime-ish so the pair never
         repeats inside a dwell, which is what separates "breathing" from
         "looping".
      3. **A bite**, on the beat a book goes in. Everything else is idle; this one
         is caused, and a viewer reads the causation without being told.
    */
    const machine = machineNode.current
    if (machine) {
      const t = Math.max(0, local)

      /*
        The bite. A book is swallowed every `BELT_PERIOD / count`, so this rides
        the same clock the belt does rather than a timer of its own - two clocks
        for one event is how the mouth ends up chewing between books.
      */
      const chew = loop(t, BELT_PERIOD / BOOK_SUBJECTS.length)
      const bite = chew > BITE_AT ? Math.sin(((chew - BITE_AT) / (1 - BITE_AT)) * Math.PI) : 0

      const tremor = Math.sin(t * 37.1) * TREMOR + Math.sin(t * 23.7 + 1.7) * TREMOR * 0.6
      machine.position.set(tremor, Math.sin(t * 29.3 + 0.6) * TREMOR - bite * 0.03, 0)

      /*
        Squash on the bite: down and wide, which is what a soft thing does when it
        swallows. `tuning.ts` has the same shape for the character's landing, and
        reusing the vocabulary is what makes a machine in this world read as made
        of the same stuff the robot is.
      */
      machine.scale.set(1 + bite * 0.035, 1 - bite * 0.055, 1 + bite * 0.035)

      machine.rotation.set(
        Math.sin(t * 0.83) * SWAY + bite * 0.06,
        0,
        Math.sin(t * 0.61 + 2.1) * SWAY,
      )

      /*
        **The chatter, and it rides the same clock the bite does.**

        Three words landing 200 ms apart on a broken arc, each popping 15% past
        its size and settling back - so the mouth reads as working rather than as
        a caption appearing. The timing is in `chatterCue.ts` because a stagger
        that is a beat out produces a still frame that looks entirely correct, and
        this round has already lost one animation to exactly that.
      */
      const chatter = chatterCue(t, BELT_PERIOD / BOOK_SUBJECTS.length, MACHINE_CHATTER.asides.length)
      for (let i = 0; i < noms.current.length; i++) {
        const node = noms.current[i]
        if (!node) continue
        const scale = chatter.scale[i] ?? 0
        node.visible = lit > 0.05 && scale > 0.01
        node.scale.setScalar(scale)
        const [dx, dy] = NOM_OFFSETS[i]
        node.position.set(NOM_AT[0] + dx, NOM_AT[1] + dy, NOM_AT[2])
      }

      for (let i = 0; i < MACHINE_CHATTER.asides.length; i++) {
        const node = asides.current[i]
        if (!node) continue
        node.visible = lit > 0.05 && i === chatter.aside
        node.position.set(ASIDE_AT[0], ASIDE_AT[1] + Math.sin(t * 1.7) * 0.02, ASIDE_AT[2])
      }
    }
  })

  return (
    <group>
      <group ref={machineNode}>
        <mesh geometry={machine} castShadow receiveShadow>
          <meshPhysicalMaterial {...shell(palette.shell)} />
        </mesh>
      </group>

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

      {/*
        The machine's own commentary. Outside the articulating group on purpose:
        it should hover beside the machine rather than lurch with it, because
        speech that swayed with the speaker would read as attached furniture.
      */}
      {MACHINE_CHATTER.bite.map((word, i) => (
        <group
          key={i}
          visible={false}
          ref={(node) => {
            noms.current[i] = node
          }}
        >
          <StationLabel text={word} size={CHATTER_SIZE} colour={palette.gold} />
        </group>
      ))}
      {MACHINE_CHATTER.asides.map((line, i) => (
        <group
          key={line}
          visible={false}
          ref={(node) => {
            asides.current[i] = node
          }}
        >
          <StationLabel text={line} size={CHATTER_SIZE * 0.86} colour="#a9c4ea" />
        </group>
      ))}

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

/**
 * How far the machine moves when it is doing nothing, in its own units.
 *
 * `TREMOR` is about a millimetre once drawn, which is under a pixel at the
 * reading camera - it is felt rather than seen, and that is the intent. `SWAY` is
 * a degree and a half of lean, which is enough to read as weight shifting and not
 * enough to look like the thing is falling over.
 *
 * Both are deliberately at the bottom of what is visible. There is a paragraph
 * being narrated over this and a nameplate under it; a machine that demands
 * attention while a sentence is being read is a machine competing with the
 * lesson it exists to illustrate.
 */
const TREMOR = 0.0045
const SWAY = 0.026

/** How late in a book's approach the bite begins. The last sixth of its run. */
const BITE_AT = 0.84

/**
 * Where the machine's commentary sits, and how big it is.
 *
 * Above and to the machine's own side - `+X` is screen left, so a positive x
 * puts the speech to the LEFT of the hopper, clear of the belt that runs in from
 * the right. Nothing else occupies that corner of this form, which is why the
 * form can carry a joke without crowding the diagram.
 *
 * Smaller than a book's title, because it is an aside rather than a label: it is
 * the machine talking, not the exhibit naming something.
 */
const NOM_AT: [number, number, number] = [0.42, 0.8, 0.06]
const ASIDE_AT: [number, number, number] = [0.52, 0.7, 0.06]
const CHATTER_SIZE = 0.062
