/**
 * The training round's phase machine, as a pure function.
 *
 * ## Why this is not just `useState` in the scene
 *
 * The round is a scripted sequence with a dozen beats, several of which are
 * timed rather than triggered, and every one of them moves the camera. That is
 * exactly the class of thing this project has learned to pull out of components:
 * `movement.ts` did it for the jump, `thruster.ts` for the burn, and both are the
 * reason those two behaviours could be checked without a browser.
 *
 * It matters more here than it did there. `__dev.capture()` renders correct
 * frames with the physics stopped - `__player.steps` sits at 0 - so there is no
 * screenshot that can tell you whether the wizard flew off at the right moment,
 * or whether Escape during the fly-in leaves the round in a state it cannot
 * leave. Those are questions with exact answers, and they belong here.
 *
 * ## The rule that shapes the whole file
 *
 * **Every transition out of the round goes through `exiting`, and `exiting` is a
 * trap state.** `useSceneTravel.travel()` refuses reentrant calls silently -
 * `if (inFlight.current) return`, no promise, no callback - so a round that asked
 * to leave twice would have one of those requests vanish with nothing reporting
 * it. Winning and pressing Escape in the same frame is not a hypothetical: the
 * win is what the player was reaching for, and Escape is what a player mashes.
 */

/**
 * The beats, in order.
 *
 * Named for what the player sees rather than for what the code does, because the
 * one thing this list has to survive is somebody reading it next to the round and
 * checking they match.
 */
export const PHASES = [
  /** Iris is opening, robot is landing, nothing has happened yet. */
  'arriving',
  /** The instructor flies in from off screen. */
  'instructorIn',
  /** It says its first line. */
  'speech1',
  /** And its second. */
  'speech2',
  /** It flies out again. */
  'instructorOut',
  /** The cube descends into view. */
  'cubeIn',
  /** A reading card is up. `card` says which. */
  'reading',
  /** The cube is turning between faces. */
  'turning',
  /** The quiz face is up: planks staggering in, then the bow. */
  'arming',
  /** Aim and shoot. The only phase that takes pointer input. */
  'aiming',
  /** A wrong plank is flipping to the no-sign and back. */
  'rejecting',
  /** The right plank is flipping to the star. */
  'accepting',
  /** Confetti. */
  'celebrating',
  /** Asked to leave. Nothing more happens here. */
  'exiting',
] as const

export type Phase = (typeof PHASES)[number]

/**
 * How long each timed beat lasts, in seconds.
 *
 * Only the beats that advance on their own appear here. `reading` and `aiming`
 * wait for the player and have no duration, which is why this is a partial record
 * rather than a total one - a duration for `aiming` would be a timeout on
 * thinking, and the round has unlimited tries precisely so it cannot fail you.
 *
 * PROVISIONAL, all of them. They are paced by ear against the transition timings
 * already in `tuning.ts` - `TRANSITION.irisOpenMs` is 420 ms, so `arriving` has to
 * outlast it or the wizard starts flying while the iris is still shut.
 */
export const DURATIONS: Partial<Record<Phase, number>> = {
  arriving: 0.9,
  instructorIn: 1.3,
  speech1: 2.6,
  speech2: 3.2,
  instructorOut: 1.0,
  cubeIn: 1.1,
  turning: 0.55,
  arming: 2.2,
  rejecting: 1.1,
  accepting: 0.9,
  celebrating: 2.4,
}

/** How many reading cards precede the quiz. Two, decided with the user. */
export const CARD_COUNT = 2

export type TrainingState = {
  phase: Phase
  /** Seconds spent in the current phase. Reset on every transition. */
  elapsed: number
  /** Which reading card is showing, 0-based. Also the cube's face index. */
  card: number
  /** Plank index the last shot hit, or null. Drives which plank flips. */
  lastHit: number | null
  /** Arrows loosed. Recorded as the round's evidence, never used to fail anyone. */
  shots: number
  /** True once the correct plank has been hit. Latches; see `accepting`. */
  won: boolean
}

export type TrainingInput = {
  /** Next / Right Arrow, on the frame it was pressed. */
  advance: boolean
  /** Escape, on the frame it was pressed. */
  bail: boolean
  /** The plank a shot landed on this frame, or null. */
  hit: number | null
  /** Which plank is the right answer. */
  correct: number
}

export function initialTrainingState(): TrainingState {
  return { phase: 'arriving', elapsed: 0, card: 0, lastHit: null, shots: 0, won: false }
}

/** A transition, which is the only way `elapsed` ever goes back to zero. */
function to(state: TrainingState, phase: Phase, over: Partial<TrainingState> = {}): TrainingState {
  return { ...state, phase, elapsed: 0, ...over }
}

/**
 * Advance the round by one frame.
 *
 * Pure, and total: every phase either has a rule here or is a trap state, and
 * `PHASES` is exhaustively covered by the switch below so adding a beat without
 * handling it fails typecheck rather than silently hanging the round.
 */
export function stepTraining(
  state: TrainingState,
  input: TrainingInput,
  dt: number,
): TrainingState {
  /*
    `exiting` is checked before anything else and returns unchanged.

    It is also why the switch below has no `exiting` case: this guard narrows the
    type, so adding one would be dead code TypeScript refuses to compile. The
    exhaustiveness of the switch is real - a new phase without a rule fails
    typecheck - and this early return is what keeps it honest.

    This is the reentrancy guard, and it is here rather than at the call site so
    that no caller can forget it. `travel()` drops a second request on the floor
    without saying so, and the two requests that can collide - winning and
    pressing Escape - are exactly the two a player is most likely to produce
    within a frame of each other.
  */
  if (state.phase === 'exiting') return state

  /*
    Escape beats everything else, from any phase, including mid-celebration.

    Deliberately NOT gated on the round being unfinished: a player who has already
    won and wants out should get out. The win was recorded when `accepting` was
    entered, so bailing after it does not lose the completion - see `won`.
  */
  if (input.bail) return to(state, 'exiting')

  const next = { ...state, elapsed: state.elapsed + dt }
  const duration = DURATIONS[state.phase]
  const done = duration !== undefined && next.elapsed >= duration

  switch (state.phase) {
    case 'arriving':
      return done ? to(next, 'instructorIn') : next
    case 'instructorIn':
      return done ? to(next, 'speech1') : next
    case 'speech1':
      /*
        The two lines advance on their own timer AND on a press, so a player who
        reads faster than the wizard talks is not held hostage by it. Same rule on
        `speech2` and `cubeIn`.
      */
      return done || input.advance ? to(next, 'speech2') : next
    case 'speech2':
      return done || input.advance ? to(next, 'instructorOut') : next
    case 'instructorOut':
      return done ? to(next, 'cubeIn') : next
    case 'cubeIn':
      return done || input.advance ? to(next, 'reading', { card: 0 }) : next

    case 'reading':
      if (!input.advance) return next
      return to(next, 'turning')

    case 'turning': {
      if (!done) return next
      /*
        The turn is what advances the card, not the press that started it. The
        cube's rotation is driven from `card`, so incrementing on the press would
        snap the face over before the animation had run.
      */
      const card = state.card + 1
      return card >= CARD_COUNT ? to(next, 'arming', { card }) : to(next, 'reading', { card })
    }

    case 'arming':
      return done ? to(next, 'aiming') : next

    case 'aiming': {
      if (input.hit === null) return next
      const shots = state.shots + 1
      return input.hit === input.correct
        ? /*
             `won` latches here rather than in `celebrating`, so that a player who
             hits the answer and immediately presses Escape still gets the
             completion. The round is won at the moment the arrow lands; the
             confetti is a reward for it, not a condition of it.
           */
          to(next, 'accepting', { shots, lastHit: input.hit, won: true })
        : to(next, 'rejecting', { shots, lastHit: input.hit })
    }

    case 'rejecting':
      /*
        Straight back to aiming, and `shots` is the only thing a miss costs. There
        are no lives: the brief says unlimited tries, and a quiz that can be failed
        by a player who has understood the material but cannot aim is testing the
        wrong thing.
      */
      return done ? to(next, 'aiming', { lastHit: null }) : next

    case 'accepting':
      return done ? to(next, 'celebrating') : next

    case 'celebrating':
      return done ? to(next, 'exiting') : next
  }
}

/**
 * How far through the reading the player is, 0 to 1, for the progress bar.
 *
 * Counts the quiz as the last step, so the bar is full when the planks appear
 * rather than at the last card - the round is not over at the end of the reading
 * and a full bar there would say it was.
 */
export function readingProgress(state: TrainingState): number {
  const step = state.phase === 'reading' || state.phase === 'turning' ? state.card : CARD_COUNT
  return Math.min(1, step / CARD_COUNT)
}

/** Whether the round is showing something the player can advance past. */
export function canAdvance(state: TrainingState): boolean {
  return state.phase === 'reading' || state.phase === 'speech1' || state.phase === 'speech2'
}

/** Whether the pointer should be aiming. The one phase that takes a shot. */
export function isAiming(state: TrainingState): boolean {
  return state.phase === 'aiming'
}
