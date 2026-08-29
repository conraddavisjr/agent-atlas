import { VOICE } from '@/audio/voiceManifest'
import { DURATIONS, type TrainingState } from './trainingMachine'

/**
 * The specimen: one large model that becomes each of a card's three forms in
 * turn.
 *
 * ## What replaced what
 *
 * The teaching act used to be three small stations standing side by side, each
 * about 3% of the frame, with inner labels around five pixels of cap height on a
 * 900 px window. Five pixels of cap is not small type, it is not type. The stage
 * around them was mostly empty: the band between the HUD reading card and the
 * robot's head carried nothing but a `WHAT IS AI?` sign that the HUD's own scene
 * card already says in DOM.
 *
 * Two obvious fixes do not work and it is worth recording why, because both will
 * be proposed again. **Dollying the camera in changes nothing**: apparent size is
 * `H / (2 d tan(fov/2))`, so moving closer enlarges the subject and everything
 * else at that depth in the same proportion, while the constraint that actually
 * binds is a FRACTION of the frame - the band between the card and the head - and
 * a fraction is invariant under dollying. **Pitching changes nothing either**: the
 * world height a fixed angular band subtends is stationary in pitch to within a
 * few per cent. Pitch decides where the band sits, not how much it holds.
 *
 * So the fix is to take the band: delete what was in it, and draw one form at a
 * time large enough to fill it.
 *
 * ## The cross-fade is sequential, and that is not a compromise
 *
 * The brief asked for the model to "fade from one into the other form every 2.5
 * seconds", and it fades. It does NOT cross-dissolve: the outgoing form goes to
 * zero before the incoming one starts, so at most one form is ever drawn.
 *
 * That is worth more than it costs. Two 3.7 m machines interpenetrating at half
 * alpha is a muddy frame and a sorting problem at the same time, and a form that
 * is fully absent needs no `transparent` material, no depth-write exception and
 * no per-draw sort. The steady state - which is 82% of every beat - is exactly as
 * opaque and as cheap as it was before.
 *
 * **An earlier draft of this design folded the forms down instead of fading
 * them,** on the grounds that troika text opacity needs a `sync()` per frame.
 * That claim was checked against the installed library and is false; see
 * `StationLabel.tsx`. The fold would also have squashed the labels inside each
 * form to 6% of their height, which smears glyphs rather than hiding them.
 */

/**
 * The specimen group's name in the scene graph.
 *
 * `__dev.specimen()` finds it by this rather than by a ref, because the harness
 * lives outside the Canvas and has only the scene to go on - the same way
 * `devBridge` reaches the player.
 */
export const SPECIMEN_NAME = 'teaching-specimen'

/** How many forms a card has. Three, which is the shape of both cards. */
export const FORM_COUNT = 3

/**
 * How long the change-over takes, in seconds, out and in together.
 *
 * Half of it is the outgoing form leaving and half is the incoming one arriving.
 * Chosen rather than derived, and pinned by a test at `FORM_CROSS < dwell / 4`
 * for every form, so that at least three quarters of every beat is a still,
 * readable picture however long the clause over it turns out to be.
 */
export const FORM_CROSS = 0.45

/**
 * How long each form holds the stage, in seconds.
 *
 * ## It is the length of the sentence being said over it
 *
 * This was a single authored number - 2.5, then 5 - and a form's own animation
 * had to fit whatever it was. That is backwards. The premise of the whole diorama
 * is that each form is one clause of the paragraph made literal, so the honest
 * length of a form is however long that clause takes to say.
 *
 * `VOICE.segments` carries a measured duration per clause, baked from the same
 * copy the subtitle shows. So FED holds the stage for as long as "Behold: a
 * machine that read very nearly everything..." takes, and GUESSED - the longest
 * clause - gets nearly two seconds more than it.
 *
 * **This applies whether or not any sound is playing.** The manifest is compiled
 * into the bundle; the mp3s are runtime fetches. A player who declines the voice
 * gets the same beats, in the same order, for the same length of time - and the
 * word highlighting still runs, because it is driven by this clock rather than by
 * the audio. See `src/audio/voice.ts`.
 */
export function formDwell(card: number, index: number): number {
  const segment = VOICE.segments.find((s) => s.card === card && s.index === index)
  /*
    A card with no narration falls back to the longest one there is, rather than
    to a tidy round number. A missing segment means the bake and the copy have
    diverged, which `voice.test.ts` fails on - so this is the shape of a bug, and
    it should look like the round is waiting rather than rushing.
  */
  if (!segment) return FALLBACK_DWELL
  return segment.duration + SEGMENT_TAIL
}

/**
 * A beat of quiet after a clause, before the picture changes.
 *
 * The form's argument does not land on the last syllable - `FETCHED` finishes its
 * second errand a little after the sentence describing it ends - so a change-over
 * that began the instant the voice stopped would cut the picture off mid-gesture.
 * It also stops the round feeling like a queue of sentences.
 */
export const SEGMENT_TAIL = 0.8

/** Only reachable when the manifest and the copy have diverged. See `formDwell`. */
const FALLBACK_DWELL = 6

/**
 * Whether the card has been through all three of its forms once.
 *
 * ## The loop used to be endless, and that was a decision nobody made
 *
 * `reading` waits on the player, so before this the exhibit cycled forever: FED,
 * FETCHED, GUESSED, FED again, with the narration restarting each time. Nothing
 * marked the end of the argument, so a reader who had understood it had no signal
 * that they were now watching a repeat - and a reader who had missed something
 * had no way to ask for it again except to sit through two more forms.
 *
 * One pass, then a choice. It is also what lets the specimen freeze rather than
 * loop behind the choice: a diagram still animating under a dialog asking whether
 * you would like to see it again is arguing with itself.
 */
export function cycleComplete(card: number, elapsed: number): boolean {
  return elapsed >= specimenRunTime(card)
}

/**
 * How present the exhibit stays once its pass is done.
 *
 * Not zero. The replay offer is about the thing that is still on screen, and a
 * dialog over an empty stage is a dialog about nothing - the reader needs to see
 * what they would be replaying. Low enough that the two buttons in front of it
 * are unmistakably the subject.
 */
export const FROZEN_PRESENCE = 0.22

/** Where a form's window opens, in seconds from the start of the card. */
export function formStart(card: number, index: number): number {
  let at = 0
  for (let i = 0; i < index; i++) at += formDwell(card, i)
  return at
}

/** One full pass through a card's three forms, in seconds. */
export function specimenRunTime(card = 0): number {
  return formStart(card, FORM_COUNT)
}

/**
 * The window a form's own animation has to land its argument inside.
 *
 * Per form now, because the dwells are. A form is only readable while it is fully
 * present, so its argument - the label released, the second errand completed, the
 * winner landing in the blank - has to finish inside the dwell minus the
 * change-over. `Guessed` locked at 3.22 s against a 2.05 s window once, which
 * meant the fan filled and faded away unresolved on every appearance with nothing
 * reporting it.
 */
export function formWindow(card: number, index: number): number {
  return formDwell(card, index) - FORM_CROSS
}

export type FormCue = {
  /** 0 absent, 1 fully present. Drives opacity, emissive and the lit word. */
  presence: number
  /**
   * Seconds since this form last came on stage, and 0 while it is off.
   *
   * **It resets on every visit, and that is load-bearing.** A cumulative clock
   * was tried and it silently breaks the thing the retiming exists to protect:
   * each form's internal cycle is shorter than `FORM_DWELL`, so a form arriving
   * on a clock that kept running while it was away arrives at an arbitrary phase
   * of its own animation. `Guessed` would come back already locked, having never
   * shown the fan filling - which is its entire argument, and which is exactly
   * the failure the retiming in `Fed.tsx`, `Fetched.tsx` and `Guessed.tsx` was
   * written to prevent. Resetting means every appearance plays the argument from
   * the beginning.
   */
  local: number
}

/**
 * What a form is handed about itself, every frame, and it is a LIVE object.
 *
 * The stage keeps one of these per form and mutates it in place; the station
 * holds the reference and reads it inside its own `useFrame`. That indirection
 * is not ceremony - passing the numbers as props instead means each station is
 * frozen at whatever they were when the stage last rendered, which is about twice
 * a round. See `Form` in `TeachingStage.tsx`, where that cost a real bug that
 * shipped: nothing on this stage animated, and every still frame of it looked
 * exactly like a working one.
 */
export type LiveCue = {
  /** How present the form is, 0 to 1. Its own animations dim with it. */
  lit: number
  /** Seconds since this form last came on stage. */
  local: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Whether a form is on stage, and how far into its own animation it is.
 *
 * ## The one asymmetry, and why it is here rather than hidden
 *
 * Form 0's FIRST appearance does not fade in. It is already fully present at
 * `elapsed = 0`, because the fade that brought it in was the stage's arrival on
 * `dioramaIn` - see `stagePresence`. Without this, the specimen would fade in
 * once as the stage arrives and then immediately fade in again as form 0's own
 * window opens, which reads as a stutter on the beat that introduces the whole
 * teaching act.
 *
 * On every later pass form 0 fades in normally, because by then it is following
 * form 2 rather than following an empty stage.
 */
export function formCue(card: number, index: number, elapsed: number): FormCue {
  const t = Math.max(0, elapsed)
  const period = specimenRunTime(card)
  const start = formStart(card, index)
  const dwell = formDwell(card, index)
  const since = (((t - start) % period) + period) % period
  if (since >= dwell) return { presence: 0, local: 0 }

  const half = FORM_CROSS / 2
  const firstEver = index === 0 && t < dwell
  const rise = firstEver ? 1 : clamp01(since / half)
  const fall = clamp01((dwell - since) / half)
  return { presence: Math.min(rise, fall), local: since }
}

/**
 * Which form is nearest to being the point, for the nameplate and the narration.
 *
 * The word row lights the form that is on stage, and during a change-over there
 * is a moment when nothing is. Rounding to the nearest window rather than reading
 * `presence` keeps the lit word from flickering off and back on across the seam:
 * the words are an argument in an order and the reader's place in it should not
 * blink.
 */
export function litForm(card: number, elapsed: number): number {
  const period = specimenRunTime(card)
  const t = ((Math.max(0, elapsed) % period) + period) % period
  for (let i = FORM_COUNT - 1; i >= 0; i--) {
    if (t >= formStart(card, i)) return i
  }
  return 0
}

/**
 * How present the whole specimen is, by phase.
 *
 * ## Why the stage needs its own envelope on top of the per-form one
 *
 * The specimen arrives, cycles, and leaves, and only the middle of those is a
 * form change. The arrival and the exit are stage-level events: on `dioramaIn`
 * there is no outgoing form to hand over from, and on `cubeIn` there is no
 * incoming one.
 *
 * Both used to be cuts. At the old 0.74 scale a 3% object appearing on a frame
 * boundary was unremarkable; at this scale it is a 3.7 m machine popping into
 * the middle of a held over-the-shoulder shot, and there is not even a camera
 * move to hide it behind - `cameraDirector` now holds the same Z from `speech2`
 * through `reading`, which is what makes the teaching act calm and also what
 * removes the cover a cut used to have.
 *
 * So both use the same gesture the eleven change-overs use, which is the whole
 * payoff of there being one object: the player learns one thing, that this
 * exhibit fades between states, and the arrival and the exit are instances of it
 * rather than two more vocabularies.
 *
 * ## `from` is what stops a player's own keypress looking like a bug
 *
 * The out-ramps fade from `from` rather than from 1, because they cannot assume
 * the specimen was fully present when the phase changed. `reading` ends on a
 * keypress and `reading` waits on a person, so the press can land anywhere -
 * including inside a change-over, with a form at a third of its presence and
 * rising. Fading from a hardcoded 1 would snap the specimen to full and then
 * fade it, on the one beat the player triggered themselves, which reads as the
 * button being broken rather than as a transition.
 */
export function stagePresence(state: TrainingState, from = 1): number {
  const half = FORM_CROSS / 2
  switch (state.phase) {
    case 'dioramaIn':
      return clamp01(state.elapsed / (DURATIONS.dioramaIn ?? 1.1))
    case 'reading':
      return 1
    case 'swapping':
      /*
        The card change is a form change with a different label swap behind it,
        so it uses the same out-then-in curve: down over the first half of the
        beat, up over the second, with the card index having already advanced by
        the time it comes back. `swapDip` used to sink the whole stage 1.9 m to
        hide this, which worked when a plinth was in the way; there is no plinth
        now and a 1.9 m sink leaves a 2.46 m object fully in frame and apparently
        resting on the floor.
      */
      return state.elapsed < (DURATIONS.swapping ?? 0.7) / 2
        ? from * clamp01(1 - state.elapsed / half)
        : clamp01((state.elapsed - (DURATIONS.swapping ?? 0.7) / 2) / half)
    case 'cubeIn':
      // The last thing the teaching does is put itself away.
      return from * clamp01(1 - state.elapsed / half)
    default:
      return 0
  }
}

/** Whether the specimen is on stage at all, for a phase. Cheap early-out. */
export function specimenVisible(state: TrainingState): boolean {
  if (state.phase === 'cubeIn') return state.elapsed < FORM_CROSS / 2
  return (
    state.phase === 'dioramaIn' || state.phase === 'reading' || state.phase === 'swapping'
  )
}

/**
 * The vertical extent the specimen is drawn at, in metres.
 *
 * Derived from the frame rather than chosen. The reading camera sits at
 * `(0, 3.25, -5.0)` with a 40 degree vertical field, the specimen anchor is at
 * `(0, 2.05, 3.0)` so the range is 8.00 m, and the band between the HUD reading
 * card and the robot's head runs from 18% to 64% of frame height. Projection is
 * linear in the TANGENT of the angle off axis, not in the angle:
 *
 *   content top    = 3.25 + 8.00 * tan(atan(tan(20 deg) * (50-18)/50) - 2.86 deg)
 *   content bottom = 3.25 - 8.00 * tan(atan(tan(20 deg) * (64-50)/50) + 2.86 deg)
 *
 * which comes out at 4.51 and 2.05, so 2.46 m of height. The bottom landing on
 * the anchor is not a coincidence arranged afterwards: the forms are authored
 * upward from their own base plane, so holding the anchor's Y is what keeps this
 * change to a Z and a scale.
 */
export const SPECIMEN_HEIGHT = 2.46

export type FormFrame = {
  /** Lowest point of anything drawn, in the form's own units. */
  minY: number
  /** Highest. */
  maxY: number
  /** Horizontal extent, so a wide form can be held back by its width. */
  width: number
  /** Centre of the horizontal extent, so the form can be centred on the axis. */
  centreX: number
  /**
   * When this form's claim is complete, in seconds from the frame it lit.
   *
   * **Not its cycle length, and the difference is the whole point.** A form does
   * not have to finish its loop inside a dwell - it fades out mid-cycle and
   * restarts on its next appearance, which is fine and reads better than a reset
   * anybody can see. What it does have to do is land its ARGUMENT: the subject
   * label stripped off at the intake, the stepped route arriving, the winner
   * locking. That moment is the reason the form exists, and a form whose moment
   * falls outside the readable window is a form the player watches build to
   * nothing, every appearance, forever.
   */
  argueAt: number
}

/**
 * Each form's real extent, and the two bugs this table exists to prevent.
 *
 * ## It is SWEPT, not static
 *
 * These are the bounds of everything the form draws at any point in its cycle,
 * not the bounds of its rest pose. `Fed` throws five subject labels off its
 * streams and they fall well below everything else it owns; a static box misses
 * them entirely, and at this scale the miss put five words through the
 * nameplate.
 *
 * ## `minY` is not zero, and assuming it was is the other bug
 *
 * `Guessed` mounts its machine at `y = 0.36` and its lowest label sits near
 * 0.35, so its content spans about 0.70 m rather than the 1.05 m its top
 * suggests. Scaling by `SPECIMEN_HEIGHT / maxY` would have drawn it a third
 * shorter than its neighbours with its base floating most of a metre above the
 * nameplate - a size change on every cross-fade, on the form carrying the
 * paragraph's punchline, with nothing failing.
 *
 * So the scale divides by the EXTENT and the offset lifts `minY` onto the base
 * plane. `__dev.specimen()` measures the real swept box in the browser and warns
 * when it disagrees with this table by more than 3 cm, because a number typed
 * here that no longer matches the geometry is exactly the kind of defect this
 * project keeps finding after it has shipped.
 */
export const FORM_FRAME: readonly FormFrame[] = [
  /*
    FED. It argues when a titled book has ridden the belt and been swallowed
    without its subject - five books staggered over a 4.2 s belt means one arrives
    every 0.84 s, so a couple of them is well inside a second and a half.

    The box grew when the machine learned to talk: `nom nom nom` sits to its left
    and reaches above the hopper, so the form is a third taller and a little wider
    than the belt alone. Measured with `__dev.specimen()` across a full cycle, not
    read off the constants - the chatter only exists for part of a bite, which is
    exactly the kind of content a rest-pose box misses.
  */
  { minY: 0, maxY: 0.991, width: 2.635, centreX: -0.559, argueAt: 1.4 },
  /*
    FETCHED. It argues when BOTH errands have been shown - the straight grab and
    the same job done step by step - which is two `ROUTE_PERIOD`s. The paragraph
    names two things and a viewer who saw one of them learned half a sentence.
  */
  { minY: 0, maxY: 1.21, width: 1.5, centreX: -0.1, argueAt: 5.2 },
  /*
    GUESSED. Its machine stands ON the base plane now, where it used to be mounted
    at 0.36 and float most of a metre above the nameplate. It argues when the
    winning word has landed in the blank and finished the sentence, at `LANDED_AT`.
  */
  { minY: 0, maxY: 1.002, width: 1.913, centreX: 0.047, argueAt: 4 },
]

/**
 * The widest a form may be drawn, in metres.
 *
 * ## Height alone was the wrong invariant, and the measurement is what showed it
 *
 * The first version scaled every form to `SPECIMEN_HEIGHT` on the argument that
 * three forms at three sizes make the change-over read as a zoom rather than as a
 * change. That is true and it is not the whole story: `GUESSED` is short and wide
 * where its neighbours are tall and narrow, so equalising heights drew it at
 * **4.99 m against FED's 3.81** - a third wider, spilling across the nameplate,
 * with its bottom candidate landing on the key word beneath it.
 *
 * Trading one size change for another is not a fix, so the forms fit a BOX
 * instead: 2.46 m tall by 4.2 m wide, whichever binds first. FED and FETCHED are
 * still bound by height and still draw at exactly `SPECIMEN_HEIGHT`; GUESSED is
 * bound by width and draws 2.07 tall.
 *
 * Their drawn DIAGONALS then agree to within 20%, which is the number that
 * matters - it is what an eye reads as "the same size" - where equal heights had
 * them 33% apart on width. `specimen.test.ts` holds the diagonal rather than
 * either axis, and says why.
 *
 * **This is a compromise and it is the honest one to make here.** The real answer
 * is that these three were composed to be 1.5 m wide in a row of three and one of
 * them now owns the frame alone, so all three want re-composing - which is the
 * next pass, and which is why this pass does not attempt it.
 */
export const SPECIMEN_WIDTH = 4.2

/** How large a form is drawn, so all three fill one box without spilling it. */
export function formScale(index: number): number {
  const frame = FORM_FRAME[index]
  if (!frame) throw new Error(`specimen: no frame for form ${index}`)
  const extent = frame.maxY - frame.minY
  if (!(extent > 0)) throw new Error(`specimen: form ${index} has no height`)
  if (!(frame.width > 0)) throw new Error(`specimen: form ${index} has no width`)
  return Math.min(SPECIMEN_HEIGHT / extent, SPECIMEN_WIDTH / frame.width)
}

/**
 * Where a form mounts inside the specimen, so every form shares one base plane
 * and one centre line.
 *
 * Without the x term the specimen slides sideways between forms: the three have
 * centres of mass at -0.215, -0.045 and -0.170, which at this scale is 37 cm of
 * drift on a 2.5 second loop. It would read as the model being nudged.
 */
export function formOffset(index: number): [number, number, number] {
  const frame = FORM_FRAME[index]
  const scale = formScale(index)
  return [-frame.centreX * scale, -frame.minY * scale, 0]
}
