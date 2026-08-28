import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { SPECIMEN_AT, WORD_PITCH, stationX } from './stage'
import { CARD_STATIONS } from './dioramaCopy'
import { stationLift } from './diorama'
import type { LiveCue } from './specimen'
import {
  FORM_COUNT,
  FORM_CROSS,
  FROZEN_PRESENCE,
  cycleComplete,
  formCue,
  formDwell,
  formOffset,
  formScale,
  litForm,
  SPECIMEN_NAME,
  specimenVisible,
  stagePresence,
} from './specimen'
import { applyPresence } from './formPresence'
import { Fed } from './stations/Fed'
import { Fetched } from './stations/Fetched'
import { Guessed } from './stations/Guessed'
import { StationLabel } from './stations/StationLabel'
import { useTrainingStore } from './trainingStore'
import type { Phase, TrainingState } from './trainingMachine'

/**
 * The teaching stage: one large specimen that becomes each of a card's three
 * forms in turn, and a row of three words underneath saying which.
 *
 * ## Why the model became one thing and the words did not
 *
 * The three stations stood side by side at 0.74 scale and each took about 3% of
 * the frame; the labels inside them were around five pixels of cap height, which
 * is not small type, it is not type. One form at a time, filling the band the
 * headline used to waste, is eight times the area and three and a half times the
 * type.
 *
 * The words did not collapse with the model, and that is the decision this file
 * would defend hardest. `reading` waits on the player, so a reader who presses
 * Next after two seconds sees whatever the loop happened to be showing. With one
 * changing word, everything not yet reached is simply lost. With all three
 * present and one lit, every player has seen all three claims named, in order,
 * with the one they watched marked - and a reader arriving halfway learns not
 * just the order but their place in it, which the old `1. 2. 3.` numbering could
 * not tell them. The numbering is gone with the row that made it necessary.
 *
 * ## Everything here reads a presence and nothing else
 *
 * `specimen.ts` owns the pacing. A form is handed a `lit` and a clock that starts
 * when it comes on stage, exactly as the stations were before, so none of the
 * three needed to learn anything about the change-over.
 *
 * ## Mounted for the whole round, hidden when not wanted
 *
 * As the cube and the instructor are: the labels resolve their font from a
 * runtime fetch, and mounting them at the top of the beat would put a network
 * request inside the moment the player is watching.
 */
export function TeachingStage({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null)
  const forms = useRef<(Group | null)[]>([])
  /** Per-form cue, read by the station components on their own frame. */
  const cues = useRef<LiveCue[]>(Array.from({ length: FORM_COUNT }, () => ({ lit: 0, local: 0 })))
  const words = useRef<(Group | null)[]>([])
  const captions = useRef<(Group | null)[]>([])

  /** Last presence actually written per form, so a steady state costs no walk. */
  const applied = useRef<number[]>([-1, -1, -1])
  /** Which form the non-reading phases hold on screen. */
  const held = useRef(0)
  /** Its clock, carried across a phase change so a fade-out does not freeze. */
  const heldLocal = useRef(0)
  /**
   * The presence the specimen had on the frame before the phase changed.
   *
   * `reading` ends on a keypress, which can land anywhere - including inside a
   * change-over, with the outgoing form part way down. Fading `swapping` from a
   * hardcoded 1 would snap the specimen back to full and then fade it, on a beat
   * the player triggered themselves, which reads as the button being broken.
   */
  const carried = useRef(1)
  const previousPhase = useRef<Phase>('arriving')

  /*
    The card index, subscribed rather than read off the ref.

    It changes twice a round, so a re-render on it is free, and it is what lets
    the word row and the captions be plain JSX keyed on the card instead of text
    mutated imperatively - which would be a troika `sync()` reaching into a
    component that did not ask for one.
  */
  const card = useTrainingStore((s) => s.card)
  const requestForm = useTrainingStore((s) => s.requestForm)
  const stations = CARD_STATIONS[card] ?? CARD_STATIONS[0]

  /*
    **Card 1 has no illustration of its own, and this is the only thing that says
    so.**

    `CARD_1_STATIONS` - HIDDEN, CORRECTED, CONFIDENT - has existed in
    `dioramaCopy.ts` since the round shipped, with tests over it, rendered
    nowhere. The stage has always mapped over card 0's three forms unconditionally
    and never read `state.card`, so the second card has always been illustrated by
    the first card's machines. Nothing threw and nothing logged.

    That is exactly the rule `dioramaCopy.ts` opens by stating: "an illustration
    that shows something the text does not claim is a second, unreviewed lesson."
    Card 1's paragraph is about hiding the next word and correcting a trillion
    times; its picture is a machine being fed books.

    The three forms it needs are not built here. They are a whole second
    illustration, and every form on this stage is going to be re-composed now that
    one of them owns the frame, so building them against the old composition would
    be authoring them twice. What this pass changes is that the defect is loud
    rather than silent - and three and a half times larger, which is the honest
    cost of taking it deliberately.
  */
  useEffect(() => {
    if (import.meta.env.DEV && card > 0) {
      console.warn(
        `[training] card ${card} is showing card 0's illustration. ` +
          `${stations.map((s) => s.label).join(' / ')} have copy in dioramaCopy.ts and no forms. ` +
          `See TeachingStage.tsx - this is a known, deliberate gap, not a regression.`,
      )
    }
  }, [card, stations])

  useFrame((_, delta) => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    if (!specimenVisible(state)) {
      if (g.visible) {
        g.visible = false
        applied.current = [-1, -1, -1]
      }
      return
    }
    g.visible = true

    if (state.phase !== previousPhase.current) {
      /*
        Snapshot on the edge, not on the beat. Whatever was on screen last frame
        is what the next phase has to continue from.
      */
      carried.current = Math.max(...applied.current.map((v) => Math.max(0, v)))
      previousPhase.current = state.phase
    }

    const stage = stagePresence(state, carried.current)
    /*
      **The pass ends, and the exhibit stops rather than looping.**

      Once all three forms have been through once the card is offering a replay,
      and a diagram still animating behind that offer is arguing with it. So the
      last form holds its final pose and fades back, which also stops the
      narration talking over a dialog.
    */
    const done = state.phase === 'reading' && cycleComplete(card, state.elapsed)
    const reading = state.phase === 'reading' && !done

    if (done) {
      held.current = FORM_COUNT - 1
      heldLocal.current = formDwell(card, FORM_COUNT - 1)
    } else if (reading) {
      held.current = litForm(card, state.elapsed)
    } else if (state.phase === 'dioramaIn') {
      // The card opens on its first form, always.
      held.current = 0
      heldLocal.current = 0
    } else if (state.phase === 'swapping' && stage === 0) {
      /*
        The card change turns over at the bottom of the fade, where nothing is
        drawn. Switching on `stage === 0` rather than on a time means the
        change-over cannot be seen however the swap was entered - including from
        part way down, when a player pressed Next mid-fade.
      */
      held.current = 0
      heldLocal.current = 0
    }

    for (let i = 0; i < FORM_COUNT; i++) {
      const node = forms.current[i]
      if (!node) continue

      let presence: number
      let local: number
      if (done) {
        /*
          Frozen, not hidden. The reader is being asked whether to watch this
          again, so it has to still be there to point at - just clearly no longer
          the thing happening.
        */
        presence = i === held.current ? FROZEN_PRESENCE : 0
        local = heldLocal.current
      } else if (reading) {
        const cue = formCue(card, i, state.elapsed)
        presence = cue.presence
        local = cue.local
      } else {
        presence = i === held.current ? stage : 0
        // Its own animation keeps running while it leaves, so a form does not
        // freeze mid-gesture and then fade a still image out.
        if (presence > 0) heldLocal.current += delta
        local = heldLocal.current
      }

      if (reading) heldLocal.current = local

      /*
        **The presence is rate-limited, and that is what makes the words
        clickable without a pop.**

        Clicking a key word writes `elapsed` straight to the top of that form's
        window, which is the whole mechanism - `formCue` is a pure function of the
        clock, so moving the clock IS selecting a form. But it means the form that
        was showing goes from whatever it was to zero between one frame and the
        next, and a 3.7 m machine vanishing on a frame boundary is the pop this
        round has spent a lot of effort not having.

        Clamping the change to the rate a normal change-over already uses costs
        nothing in the ordinary case - the scheduled fades move at exactly this
        rate, so the limit never binds - and turns any jump in the clock into the
        same fade the player has already seen eleven times. It covers the dev
        harness's `seek` for free, which is the other way this clock moves.
      */
      const target = presence * (reading || done ? stage : 1)
      const was = applied.current[i] < 0 ? target : applied.current[i]
      const step = delta / (FORM_CROSS / 2)
      const next = Math.abs(target - was) <= step ? target : was + Math.sign(target - was) * step

      if (next !== applied.current[i]) {
        applied.current[i] = applyPresence(node, next)
      }
      /*
        **Mutated in place, never replaced, and that distinction is the whole
        bug this line used to have.**

        A station reads its cue inside its OWN `useFrame`. If this assigned a new
        object each frame, the station would go on reading the one it was handed
        at render time - and `TeachingStage` renders about twice a round. See the
        note on `Form` below.
      */
      cues.current[i].lit = next
      cues.current[i].local = local
    }

    /*
      The nameplate. The lit word rises and comes to full strength; the other two
      stay put at reduced strength.

      Opacity rather than a colour swap, and both are uniform writes so the
      choice is about reading rather than cost: three words in one colour at two
      strengths read as one row with an active member, where two colours read as
      two kinds of thing.
    */
    const lit = held.current
    for (let i = 0; i < FORM_COUNT; i++) {
      const word = words.current[i]
      if (word) {
        const on = i === lit ? 1 : 0
        word.position.y = stationLift(on)
        applyPresence(word, on === 1 ? 1 : DIM_WORD)
      }
      const caption = captions.current[i]
      if (caption) caption.visible = i === lit
    }
  })

  return (
    <group ref={group} name={SPECIMEN_NAME} position={SPECIMEN_AT} visible={false}>
      {Array.from({ length: FORM_COUNT }, (_, i) => (
        <group
          key={i}
          ref={(node) => {
            forms.current[i] = node
            /*
              For `__dev.specimen()`, which reports each form's clock so a frozen
              station says so rather than being inferred from a bounding box that
              did not move. The round does not read this.
            */
            if (node) node.userData.cue = cues.current[i]
          }}
        >
          {/*
            Scale and offset together, and the offset is not decoration.

            `formOffset` lands each form's own lowest drawn point on the base
            plane and its own centre of mass on the axis. Without the Y term
            `Guessed` floats most of a metre above the nameplate, because its
            machine is mounted at 0.36 and nothing it draws starts at zero.
            Without the X term the specimen slides 37 cm sideways between forms
            on a 2.5 second loop, which reads as the model being nudged.
          */}
          <group scale={formScale(i)} position={formOffset(i)}>
            <Form index={i} cues={cues} />
          </group>
        </group>
      ))}

      {/*
        The three key words, side by side under the specimen, on the same
        `stationX` the stations themselves used - which is the function carrying
        the test for the +X-is-screen-left inversion that has caught this round
        out five times.
      */}
      {stations.map((station, i) => (
        <group key={`${card}-${station.label}`} position={[stationX(i, WORD_PITCH), WORD_Y, LABEL_Z]}>
          <group
            ref={(node) => {
              words.current[i] = node
            }}
          >
            <StationLabel text={station.label} size={0.22} colour="#dce7f8" letterSpacing={0.06} />
          </group>

          {/*
            **The hit target, and it is a plane rather than the text itself.**

            troika raycasts against its own glyph geometry, so clicking a word
            would mean clicking the strokes of a letter and missing between them.
            A plate the size of the word is what a person is aiming at anyway.

            `opacity 0` rather than `visible={false}`, because three's raycaster
            skips invisible objects outright - an invisible hit target is not a hit
            target. `depthWrite` off so a fully transparent plate cannot punch a
            hole in the exhibit behind it, which is the same trap `formPresence.ts`
            documents for the fade.
          */}
          <mesh
            position={[0, 0.02, 0.02]}
            onClick={(e) => {
              e.stopPropagation()
              requestForm(i)
            }}
            onPointerOver={() => setCursor('pointer')}
            onPointerOut={() => setCursor('auto')}
          >
            <planeGeometry args={[WORD_PITCH * 0.86, 0.44]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/*
        The captions, all three mounted and one visible.

        Toggling `visible` rather than rewriting one label's text, because `text`
        IS on troika's syncable list - it is the one property on this stage that
        genuinely costs a re-layout - and three hidden text objects cost nothing.
      */}
      {stations.map((station, i) => (
        <group
          key={`${card}-cap-${station.label}`}
          position={[0, CAPTION_Y, LABEL_Z]}
          visible={false}
          ref={(node) => {
            captions.current[i] = node
          }}
        >
          <StationLabel text={station.caption} size={0.15} colour="#9db4d6" maxWidth={3.6} />
        </group>
      ))}
    </group>
  )
}

/**
 * The pointer, so a clickable word says it is clickable.
 *
 * Written straight onto the canvas rather than held in React state: a hover is
 * not worth a re-render of the exhibit, and `Bow.tsx` and the totems already take
 * the same shortcut for the same reason.
 */
function setCursor(value: string) {
  const canvas = document.querySelector('canvas')
  if (canvas) canvas.style.cursor = value
}

/* ------------------------------------------------------------------------- */

/**
 * How present a word that is not the point is.
 *
 * Not zero and not close to it. A word that disappears takes the row's whole
 * argument with it - the reader is supposed to be able to see all three claims
 * and where in them they are - so this is "clearly present, clearly not the
 * point", which is the same judgement the old `DIM_FLOOR` made for a station
 * that had not lit yet.
 *
 * **0.45 was the first value and it was measured to be too weak.** Against the
 * near-black of this room, an anti-aliased outlined glyph at 0.45 renders at a
 * peak display luma of 0.71 where the lit word reaches 0.86 - a difference an
 * eyedropper finds and an eye does not, especially between a three-letter word
 * and a seven-letter one, where total ink swamps a 20% difference in strength.
 * 0.28 opens it to something a glance can use.
 */
const DIM_WORD = 0.28

/**
 * Where the word row and the caption sit, relative to the specimen's base plane.
 *
 * Below the specimen, and the decisive argument is the change-over rather than
 * taste: the specimen's base is the one edge of this composition that never
 * moves, while its top edge is 2.46 m away and belongs to whichever form is up.
 * A label above would hang over an object that fades out from under it.
 *
 * The top of the frame is also spoken for. `TrainingHUD`'s reading card carries
 * the card's heading in DOM across the top eighteen per cent, and the round has
 * already learned once what two pieces of text competing at the top of one shot
 * looks like - see the question banner's own note about the headline.
 */
/*
  Both moved down after the first frame, and the reason is worth keeping.

  At -0.11 the word row sat 11 cm under the specimen's base plane, which is fine
  for a form whose lowest content is its machine's feet and wrong for one whose
  lowest content is a label. `GUESSED`'s bottom candidate sits ON the base plane,
  so `SANDWICH` landed directly on top of the word `FED` - two pieces of text at
  the same screen height, four hundredths of a frame apart, one of them part of
  the picture and one of them the caption for it.

  The budget: the specimen's base projects to about 65% of frame height and the
  robot's crown measures 86%, so there are 21 points, about 1.1 m, to spend. The
  row now takes the first quarter of it and the caption the second, which leaves
  the bottom half as clear floor between the nameplate and the robot's silhouette.
*/
const WORD_Y = -0.28
const CAPTION_Y = -0.58

/**
 * How far in front of the specimen's base plane the nameplate stands.
 *
 * The nearest thing any form draws is the guessing machine's face at about
 * -0.40 once scaled, so 0.62 clears it by 0.22 m and no form can reach the text
 * as it fades. It is nearer the camera than the model, so if that margin were
 * ever lost the word would occlude the machine rather than the reverse, which is
 * the harmless direction.
 */
const LABEL_Z = -0.62

/**
 * One form's contents, chosen by index.
 *
 * A switch rather than an array of components, so a card with the wrong number of
 * forms fails to compile rather than rendering two thirds of a lesson.
 *
 * ## It hands over the cue OBJECT, and it used to hand over its values
 *
 * **This was a real bug and it had been shipping since the diorama was built.**
 * The old version read `cues.current[index]` here, in the component body, and
 * spread the result into props:
 *
 *     const cue = cues.current?.[index] ?? { lit: 0, local: 0 }
 *     return <Fed lit={cue.lit} local={cue.local} />
 *
 * A component body runs on RENDER. `TeachingStage` renders when the card changes
 * and at essentially no other time, because everything else it does is a frame
 * write through a ref - which is the whole point of the design. So each station
 * was handed the numbers that existed at mount, `lit: 0` and `local: 0`, and kept
 * them for the life of the round.
 *
 * **Nothing animated.** The books never moved along the belt, the traveller never
 * left the shelf, the candidate bars never filled. Every one of them held its
 * `local = 0` pose, which for most of them is a plausible-looking still frame -
 * a belt with books on it, a shelf, a list of words - so it looked like a diorama
 * that had been drawn rather than one that had stopped. Nothing threw, nothing
 * logged, and a screenshot of it is indistinguishable from a screenshot of it
 * working.
 *
 * It surfaced because `__dev.specimen()` reported byte-identical bounds for the
 * same form at 2.0 s and at 4.2 s, which is the kind of thing only a measurement
 * says out loud.
 *
 * The fix is to pass the cue object itself. `TeachingStage` mutates it in place
 * every frame and the station reads it inside its own `useFrame`, so the values
 * are live without a single re-render.
 */
function Form({
  index,
  cues,
}: {
  index: number
  cues: RefObject<LiveCue[]>
}) {
  const cue = cues.current?.[index]
  if (!cue) return null
  if (index === 0) return <Fed cue={cue} />
  if (index === 1) return <Fetched cue={cue} />
  return <Guessed cue={cue} />
}
