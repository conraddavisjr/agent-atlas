import { useEffect, type CSSProperties } from 'react'
import { useGameStore } from '@/state/gameStore'
import { useTrainingStore } from '@/game/training/trainingStore'
import { CARDS, INSTRUCTOR_LINES, QUIZ, shownWords } from '@/game/training/cards'
import { decline, preload, unlock } from '@/audio/voice'
import { CARD_COUNT } from '@/game/training/trainingMachine'
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
  const audio = useGameStore((s) => s.audio)
  const segment = useTrainingStore((s) => s.segment)
  const word = useTrainingStore((s) => s.word)
  const setAudio = useGameStore((s) => s.setAudio)

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
  const reading = phase === 'dioramaIn' || phase === 'reading' || phase === 'swapping'
  /*
    The question beat: the board has dropped in and is waiting to be read. It
    reuses the reader chrome - the counter and the button - and only their labels
    change, because it IS the last step of the same sequence.
  */
  const question = phase === 'cubeIn' || phase === 'question'
  /*
    The shooting beats. The question moves to the HUD for them, because the cube
    it was written on has left: from inside the character's head there is nowhere
    to put a 2.1 m board that is not in front of the targets.
  */
  /** Beats whose animation the Next button cannot cut short. */
  const busy = phase === 'swapping' || phase === 'cubeIn'
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
          <div style={styles.line}>{INSTRUCTOR_LINES[speaking].shown}</div>
          {/*
            **The speech beats have always been skippable and nothing ever said
            so.**

            `stepTraining` advances `speech1` and `speech2` on `input.advance` as
            well as on their timers, "so a player who reads faster than the wizard
            talks is not held hostage by it" - and the only way to reach that was
            a Right Arrow nobody is told about. Every other waiting beat in this
            round has a visible `Next` and this one had a keyboard secret.

            It matters more now than it did: `speech2` grew from 3.2 s to 5.3 s
            because 3.2 was shorter than the time it takes to read its own
            subtitle, and it will grow again when the wizard is given a voice. A
            preamble that gets longer needs its exit shown, not hidden.
          */}
          <button style={styles.skip} onClick={requestAdvance}>
            Skip &rsaquo;
          </button>
        </div>
      )}

      {reading && (
        /*
          THE CARD ITSELF, which used to be printed on the cube.

          The paragraph moved here when the diorama took the stage: a 6.5 m band
          of illustration and a 2.1 m board of text cannot both own the middle of
          the frame, and of the two it is the illustration that cannot be read
          anywhere else. The same panel already carries the quiz question during
          the shooting for the same reason.

          `pointerEvents: 'none'`, and it matters more than it looks: the aim
          plane is a scene object read through r3f's pointer events, so any DOM
          element over the canvas that accepts the pointer is a dead zone. This
          one is gone by the time the bow appears, but the rule is cheaper to keep
          than to remember.
        */
        <div style={styles.card}>
          <div style={styles.cardHeading}>{CARDS[Math.min(card, CARD_COUNT - 1)].heading}</div>
          <div style={styles.cardBody}>
            <ReadAlong card={Math.min(card, CARD_COUNT - 1)} segment={segment} word={word} />
          </div>
        </div>
      )}

      {(reading || question) && (
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
            {/*
              Disabled while an animation the press cannot interrupt is running.
              The machine ignores an advance during a change-over or an arrival
              anyway, and a control that silently does nothing is worse than one
              that says it cannot.
            */}
            <button
              style={{ ...styles.next, opacity: busy ? 0.45 : 1 }}
              disabled={busy}
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
      {/*
        The mute, and the escape hatch from a permanent decision.

        A player who takes `Continue in silence` at the gate has that remembered,
        which means the gate never appears for them again - so without this the
        choice is one click and undiscoverable forever. It is also just the
        control anybody wants when a voice starts talking in an open-plan office.

        Turning it ON from here is a click, and a click is a user gesture, so this
        is also a second reliable unlock path for a browser that refused the
        first one.
      */}
      <button
        style={styles.sound}
        onClick={() => {
          if (audio === 'on') {
            decline()
            setAudio('off')
          } else {
            unlock()
            setAudio('on')
            void preload()
          }
        }}
        aria-label={audio === 'on' ? 'Mute the instructor' : 'Let the instructor speak'}
        aria-pressed={audio === 'on'}
        title={audio === 'on' ? 'Mute the instructor' : 'Let the instructor speak'}
      >
        <MicIcon muted={audio !== 'on'} />
      </button>

      <button style={styles.exit} onClick={requestBail}>
        Esc to leave
      </button>
    </div>
  )
}

const panel: CSSProperties = {
  /*
    **0.92, and it was 0.72, and the difference is what makes the read-along
    legal rather than merely visible.**

    The card text is 14 px, which is under WCAG's large-text threshold, so every
    word - highlighted, faded or plain - has to hold 4.5:1 under SC 1.4.3. The
    panel is translucent over a live 3D scene, so its effective background is
    whatever the diorama is doing behind it, and the worst case is a bright frame.

    Computed for `#e4ecfa` over this panel over a white scene:

      panel 0.72   text 1.00 -> 6.21    0.72 -> 4.12 FAIL   0.55 -> 3.10 FAIL
      panel 0.92   text 1.00 -> 12.60   0.72 -> 7.24        0.55 -> 4.86

    At 0.72 the entire fade budget was 0.80 opacity, which is not a fade anybody
    can see - so the clause dimming shipped in the previous commit was failing AA
    on any bright frame. At 0.92 the floor drops to 0.55 and a real fade fits
    inside the standard.

    It also removes the scene dependence, which matters on its own: 14 px text
    over a moving background is a legibility problem with or without a highlight.
  */
  background: 'rgba(12, 20, 38, 0.92)',
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
  /**
   * The reading card, top-centre.
   *
   * Wide enough for a 300-character paragraph at a comfortable measure without
   * running the full width of a large monitor - `CARD_BODY_LIMIT` caps the copy
   * and 620 px puts that at about six lines. Above the diorama rather than beside
   * it, because the stage is the widest thing in the frame and has no side to
   * spare.
   */
  card: {
    position: 'absolute',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    ...panel,
    width: 620,
    maxWidth: 'calc(100vw - 48px)',
    pointerEvents: 'none',
  },
  cardHeading: {
    fontSize: 11,
    letterSpacing: 1.6,
    color: '#7f97bd',
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 1.55,
    color: '#e4ecfa',
  },
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
  skip: {
    /*
      Quieter than `next`. This is an escape from something the player might be
      enjoying, where `Next` is the way forward through something they have
      finished - so it reads as an offer rather than as the thing to press.
    */
    pointerEvents: 'auto',
    marginTop: 10,
    background: 'transparent',
    border: '1px solid rgba(210, 226, 255, 0.25)',
    borderRadius: 8,
    color: 'rgba(226, 236, 255, 0.75)',
    padding: '5px 13px',
    fontSize: '0.74rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sound: {
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'auto',
    position: 'absolute',
    top: 18,
    /* Left of `Esc to leave`, which keeps its corner. */
    right: 116,
    ...panel,
    padding: 7,
    lineHeight: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'inherit',
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

/* ------------------------------------------------------------------------- */

/**
 * The reading card's paragraph, with the words lighting as they are said.
 *
 * ## A trailing window rather than one bouncing word
 *
 * A single word moving through a paragraph is the thing the brief called "big
 * dancing text", and it is worse than it sounds when there is an animation to
 * watch beside it: the eye is dragged word by word and never gets to look at the
 * picture the words are describing.
 *
 * So the highlight is a short trail. The word being said is brightest, the three
 * behind it fall away, and everything else sits at the paragraph's own strength.
 * The effect is a soft bloom moving through the text rather than a cursor, which
 * a reader can follow or ignore.
 *
 * ## It is deliberately faint
 *
 * The brightest state is barely above the body colour. There is a diagram doing
 * the teaching two feet away and this is a subtitle: it needs to say WHERE the
 * voice is, not compete for the frame. Nothing here changes size, weight or
 * background, because all three reflow or flicker and any of them would pull the
 * eye off the exhibit.
 *
 * ## It runs with the sound off
 *
 * `word` comes from the round's clock, not from the audio's. Both are derived
 * from the same baked durations, so they agree by construction - and a player who
 * declined the voice still gets the paragraph read to them at the pace it would
 * have been spoken. See `TrainingScene`.
 */
function ReadAlong({ card, segment, word }: { card: number; segment: number; word: number }) {
  const segments = CARDS[card].segments
  /* Which clause the voice is in, as an index into this card's three. */
  const active = segment >= 0 ? segment - card * 3 : -1

  return (
    <>
      {segments.map((piece, index) => {
        const words = shownWords(piece.shown)
        const isActive = index === active
        /*
          Spoken-token indices, not token indices. The paragraph shows a standalone
          dash that the voice replaces with a comma, so the two lists differ by one
          from that point on - see `shownWords`, which exists for this.
        */
        let spokenIndex = -1
        const rendered = words.map((token, w) => {
          if (token.spoken) spokenIndex += 1
          const behind = isActive && token.spoken ? word - spokenIndex : Number.NEGATIVE_INFINITY
          const strength = behind >= 0 && behind < TRAIL.length ? TRAIL[behind] : 0
          return (
            <span
              key={`${index}-${w}`}
              style={strength > 0 ? { color: `rgba(255, 255, 255, ${strength})` } : undefined}
            >
              {token.text}
              {w < words.length - 1 ? ' ' : ''}
            </span>
          )
        })
        return (
          <span key={index} style={{ opacity: active === -1 || isActive ? 1 : CLAUSE_DIM }}>
            {rendered}
            {index < segments.length - 1 ? ' ' : ''}
          </span>
        )
      })}
    </>
  )
}

/**
 * How bright the current word is, and the three behind it.
 *
 * The falloff is what makes it a trail rather than a cursor. The body sits at
 * `rgba(226, 236, 255, 0.78)`, so even the leading value is a lift of about a
 * fifth - enough to follow, not enough to read as a marker.
 */
const TRAIL = [0.98, 0.9, 0.84, 0.8]

/**
 * How far the clauses that are not being read fall back.
 *
 * **This is the part of the read-along that carries the learning**, and it is
 * worth being clear that the word window is not. The two studies that test
 * synchronised highlighting against no highlighting - Keelor 2023 on children
 * with reading difficulties, Brown 2021 on adults with aphasia - both find no
 * comprehension difference, and Brown found readers simply PREFER having one. So
 * the trail is an engagement feature and should not be asked to do more.
 *
 * The clause is different, because it is the only thing on screen that says which
 * sentence the picture belongs to. Each card is three clauses and each clause has
 * one form; dimming the other two is a three-step signal that carries the
 * correspondence the whole diorama exists to teach.
 *
 * 0.58 against a 0.92 panel is 5.24:1 on the worst frame, comfortably AA. It has
 * to stay readable rather than disappear: Schotter, Tran and Rayner (2014) found
 * that preventing readers from looking BACK hurts comprehension - and not only on
 * ambiguous sentences - so a clause that has been read must remain re-readable.
 * That is also why a spoken word returns to full strength rather than staying
 * marked or dimming further.
 */
const CLAUSE_DIM = 0.58

/**
 * A microphone, drawn rather than typed.
 *
 * Full white, because it is a control rather than a status: the muted state gets
 * a slash through it and the same weight. An icon that dimmed when muted would be
 * saying the same thing twice and would be harder to hit with the eye.
 *
 * Inline SVG rather than a glyph or an image - it is fourteen pixels of line art,
 * it has to sit on a dark panel without a background, and a font emoji would
 * render differently on every platform this runs on.
 */
function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      {muted && <path d="M4 20 20 4" />}
    </svg>
  )
}
