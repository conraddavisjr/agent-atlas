import { useEffect, type CSSProperties } from 'react'
import { useGameStore } from '@/state/gameStore'
import { useTrainingStore } from '@/game/training/trainingStore'
import { INSTRUCTOR_LINES, QUIZ } from '@/game/training/cards'
import { CARD_COUNT, isQuestionUp } from '@/game/training/trainingMachine'
import { LAYER } from './layers'

/**
 * The training round's DOM chrome.
 *
 * ## Why the round's text is DOM at all, when the round is 3D
 *
 * `HUD.tsx` states the project's position in its own header: text rendered in
 * WebGL is expensive, harder to make crisp and invisible to screen readers. The
 * instructor's dialogue is a subtitle, the progress bar is a control, and both are
 * exactly the case that argument was written for.
 *
 * The cube's CARD text is the deliberate exception and it is 3D, because it lives
 * on an object the camera turns - text that stayed flat on the glass while the
 * thing it belongs to rotated away would break the one illusion the cube exists
 * to create.
 *
 * ## Why it does not fight `useInput` the way `AdminPanel` has to
 *
 * `AdminPanel` installs native listeners that `stopPropagation()` before
 * `useInput`'s window handlers see them, plus capture-phase listeners during a
 * drag. That machinery exists because the panel has sliders and text fields whose
 * keystrokes would otherwise drive the robot.
 *
 * This surface has neither. It shows text, and it takes two keys - Escape and
 * Right Arrow - neither of which `useInput` acts on: Escape it never reads at all,
 * and arrows are movement aliases that go nowhere while `playerLocked` is set,
 * which it is for the entire round. Copying the panel's interception here would be
 * cargo cult, and it would silently break the day someone wants the arrow keys
 * back.
 *
 * `preventDefault` is still called on the arrow, because `useInput` does too and
 * an arrow that scrolls the page underneath the canvas is a real annoyance.
 */
export function TrainingHUD() {
  const playerLocked = useGameStore((s) => s.playerLocked)
  const phase = useTrainingStore((s) => s.phase)
  const card = useTrainingStore((s) => s.card)
  const requestAdvance = useTrainingStore((s) => s.requestAdvance)
  const requestBail = useTrainingStore((s) => s.requestBail)

  useEffect(() => {
    if (!playerLocked) return
    const onKey = (e: KeyboardEvent) => {
      /*
        `e.repeat` guard. Holding Right Arrow would otherwise fire the browser's
        auto-repeat at 30 Hz and skip every remaining card in a third of a second,
        and the player would never see what they skipped.
      */
      if (e.repeat) return
      if (e.code === 'Escape') requestBail()
      if (e.code === 'ArrowRight' || e.code === 'Enter') {
        e.preventDefault()
        requestAdvance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playerLocked, requestAdvance, requestBail])

  /*
    Mounted always, rendering nothing outside the round.

    Gated on `playerLocked` rather than on the scene id, because the lock is the
    thing that actually means "a scripted scene has the player" - a scene check
    would need this file to know the registry's ids, and would go stale the moment
    a second round exists.
  */
  if (!playerLocked) return null

  const speaking = phase === 'speech1' ? 0 : phase === 'speech2' ? 1 : null
  /*
    Shown while turning as well as while reading, so the control does not blink out
    for half a second on every press. The BUTTON is disabled during the turn - the
    machine ignores an advance mid-turn anyway, and a control that silently does
    nothing is worse than one that says it cannot.
  */
  const reading = phase === 'reading' || phase === 'turning'
  /*
    The question beat: the cube has turned to the quiz face and is waiting to be
    read. It reuses the reader chrome - it IS a card, it just happens to be the
    last one - and only the button's label changes.
  */
  const question = isQuestionUp(phase, card)
  /*
    The shooting beats. The question moves to the HUD for them, because the cube
    it was written on has left: from inside the character's head there is nowhere
    to put a 2.1 m board that is not in front of the targets.
  */
  const shooting =
    phase === 'aiming' ||
    phase === 'firing' ||
    phase === 'rejecting' ||
    phase === 'reloading'

  return (
    <div style={styles.root}>
      {speaking !== null && (
        <div style={styles.dialogue}>
          <div style={styles.speaker}>THE INSTRUCTOR</div>
          <div style={styles.line}>{INSTRUCTOR_LINES[speaking]}</div>
        </div>
      )}

      {reading && (
        <div style={styles.reader}>
          {/*
            The progress bar counts the quiz as the last step, so it is full when
            the planks appear rather than at the last card. A full bar on the final
            card would say the round was over when it was not - see
            `readingProgress`, which is the same rule expressed for the 3D side.
          */}
          <div style={styles.barTrack}>
            <div style={{ ...styles.barFill, width: `${(card / CARD_COUNT) * 100}%` }} />
          </div>
          <div style={styles.readerRow}>
            <span style={styles.counter}>
              {question ? 'The test' : `${Math.min(card + 1, CARD_COUNT)} of ${CARD_COUNT}`}
            </span>
            <button
              style={{ ...styles.next, opacity: phase === 'turning' ? 0.45 : 1 }}
              disabled={phase === 'turning'}
              onClick={requestAdvance}
            >
              {question ? 'Take up the bow' : 'Next'} &rsaquo;
            </button>
          </div>
        </div>
      )}

      {shooting && (
        /*
          The question, carried through the shooting.

          Not decoration and not a second copy: from the first-person camera the
          cube that asked it is gone, and a quiz whose question is only legible
          before you pick up the bow is a memory test. It sits at the top of the
          frame, clear of the plank column in the middle and of the bow in the
          lower left.
        */
        <div style={styles.question}>
          <span style={styles.questionMark}>?</span>
          {QUIZ.question}
        </div>
      )}

      {/*
        The way out, always on screen while the round has the player.

        Visible rather than discoverable. A scripted scene that takes the
        character away and does not say how to leave is the one failure a player
        cannot recover from without reloading, and `Portal.tsx` refuses the same
        thing by never locking the return gate.
      */}
      <button style={styles.exit} onClick={requestBail}>
        Esc to leave
      </button>
    </div>
  )
}

const panel: CSSProperties = {
  background: 'rgba(12, 20, 38, 0.72)',
  backdropFilter: 'blur(9px)',
  border: '1px solid rgba(150, 190, 255, 0.18)',
  borderRadius: 14,
  color: '#e8f0ff',
  padding: '12px 18px',
  fontFamily: 'system-ui, sans-serif',
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: LAYER.overlay,
  },
  dialogue: {
    position: 'absolute',
    bottom: 56,
    left: '50%',
    transform: 'translateX(-50%)',
    ...panel,
    maxWidth: 620,
    textAlign: 'center',
  },
  speaker: {
    fontSize: '0.66rem',
    letterSpacing: '0.16em',
    opacity: 0.55,
    marginBottom: 6,
  },
  line: { fontSize: '1.02rem', lineHeight: 1.45 },
  /**
   * The question banner during the shooting.
   *
   * Top-centre, which is the one part of a first-person frame nothing else
   * wants: the plank column owns the middle, the bow owns the lower left, and
   * the reticle can be anywhere between them.
   *
   * `pointerEvents: 'none'` matters more here than on the other panels. The aim
   * plane is a scene object read through r3f's pointer events, so any DOM element
   * over the canvas that accepts the pointer is a dead zone the player's aim
   * silently stops working in - and they would read that as the game hanging.
   */
  question: {
    position: 'absolute',
    /*
      Above the headline rather than over it. `HEADLINE_AT` puts `WHAT IS AI?`
      about a third of the way down a first-person frame, and a banner at 92 sat
      squarely across it - two pieces of text competing at the top of the same
      shot.
    */
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    ...panel,
    maxWidth: 520,
    display: 'flex',
    gap: 10,
    alignItems: 'baseline',
    fontSize: 14,
    lineHeight: 1.45,
    color: '#dce7f8',
    pointerEvents: 'none',
    textAlign: 'center',
  },
  questionMark: {
    fontSize: 15,
    fontWeight: 700,
    color: '#7fb0ff',
  },
  reader: {
    position: 'absolute',
    bottom: 44,
    left: '50%',
    transform: 'translateX(-50%)',
    ...panel,
    width: 420,
  },
  barTrack: {
    height: 5,
    borderRadius: 3,
    background: 'rgba(140, 180, 245, 0.16)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    background: 'linear-gradient(90deg, #4de2ff, #7fb0ff)',
    // Matches the cube's own turn, so the bar and the object move as one gesture.
    transition: 'width 0.55s cubic-bezier(0.65, 0, 0.35, 1)',
  },
  readerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  counter: { fontSize: '0.76rem', opacity: 0.6, letterSpacing: '0.06em' },
  next: {
    pointerEvents: 'auto',
    background: 'linear-gradient(180deg, #5aa9f5, #2f7ad2)',
    border: 'none',
    borderRadius: 9,
    color: '#f2f7ff',
    padding: '8px 18px',
    fontSize: '0.86rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  exit: {
    pointerEvents: 'auto',
    position: 'absolute',
    top: 18,
    right: 18,
    ...panel,
    padding: '8px 14px',
    fontSize: '0.78rem',
    cursor: 'pointer',
  },
}
