import { useEffect, useRef, useState } from 'react'
import { useGameStore, useProgress } from '@/state/gameStore'
import { COSMETICS, LESSONS } from '@/state/lessons'
import { earnedCosmetics } from '@/state/progression'
import { CONFIRM_TIMEOUT_MS, IDLE, isArmed, press, type ConfirmState } from './confirmGate'

/** The only destructive action so far. Ids keep one arm from confirming another. */
const RESET = 'reset-progress'

/**
 * Admin controls, collapsed to a tab on the far left edge.
 *
 * **Not styled as a game control, on purpose.** The player-facing HUD is soft:
 * 14 px radii, a blue-tinted glass panel, an orange call-to-action. This is
 * square, monospaced, neutral slate, and its destructive control is red. The
 * point is that nothing here should look like part of the lesson loop, because
 * everything here bypasses it.
 *
 * **Always available, not gated on `import.meta.env.DEV`.** Three reasons, and
 * the first is the strongest: the state this button edits lives in
 * `localStorage`, so a production player can already wipe it from devtools in
 * ten seconds. Gating the panel would remove the discoverable way to start over
 * and leave the undiscoverable one, which is not a security boundary, only an
 * inconvenience. Second, it is the one place a player can recover from a save
 * that a future migration mangles, and a build with no dev server is exactly
 * when that matters. Third, this project already keeps its escape hatches in
 * production for the same reason - see the `?nofx` / `?quality` block at the top
 * of App.tsx: with no accounts and no telemetry, the things a remote player can
 * be talked through are the only diagnostics that exist. What is gated instead
 * is the *destruction*, behind the confirm step in `confirmGate.ts`.
 *
 * **`data-hud` is load-bearing.** `__dev.hideHud()` hides everything carrying
 * that attribute before a capture, and the critique loop measures whole-frame
 * mean luma. A bright panel left in shot would shift those numbers by more than
 * the art changes they are taken to measure, which is a mistake this project has
 * already made once with progression state itself.
 */
export function AdminPanel({
  displayedSceneId,
  busy,
  onResetProgress,
}: {
  /** The scene actually mounted, which is not always the one in the store. */
  displayedSceneId: string
  /** True during a transition, when travel requests are refused. */
  busy: boolean
  /**
   * Performs the reset AND relocates the player if needed. Lives in App because
   * only App holds `travel`; `GameContext` is provided inside the Canvas and this
   * is a DOM overlay outside it.
   */
  onResetProgress: () => void
}) {
  const [open, setOpen] = useState(false)
  const [gate, setGate] = useState<ConfirmState>(IDLE)
  const root = useRef<HTMLDivElement>(null)

  const progress = useProgress()
  const completeLesson = useGameStore((s) => s.completeLesson)

  const worn = earnedCosmetics(COSMETICS, LESSONS, progress)
  const wornList = Object.entries(worn)
  const resetArmed = isArmed(gate, RESET)

  /**
   * Keep every gesture that starts on this panel away from the camera.
   *
   * `useInput` listens on `window` for `mousemove`, `wheel`, `keydown` and
   * `keyup`. React attaches its own handlers to the root container, which is a
   * descendant of `window`, so a synthetic `stopPropagation` would also work -
   * but native listeners on this element stop the event two nodes earlier and
   * cannot be undone by a future change to how React delegates. Four separate
   * problems are being fixed here:
   *
   * `wheel` matters most. That handler is registered `passive: false` and calls
   * `preventDefault()` unconditionally, so scrolling a long admin menu would
   * both fail to scroll it and orbit the camera instead. Stopping the event here
   * means `preventDefault` is never reached, which is what lets the body below
   * scroll natively.
   *
   * `mousemove` is gated on `e.buttons !== 0`, so any drag over the panel orbits.
   * The element-level listener covers a drag that stays on the panel; the
   * capture-phase pair installed on `mousedown` covers one that leaves it, which
   * is the common case when someone misses a button and keeps moving. A capture
   * listener on `window` is the first thing in the propagation path, so stopping
   * there also suppresses `window`'s own bubble-phase listener.
   *
   * `keydown` / `keyup`: with a panel button focused, Space would jump while
   * being swallowed as the button's activation, and Enter would fire the button
   * *and* App's interact handler, completing whichever lesson the player happens
   * to be standing at. Keys aimed at the panel should not reach the game at all.
   */
  useEffect(() => {
    const el = root.current
    if (!el) return

    const swallow = (e: Event) => e.stopPropagation()
    let releaseDrag: (() => void) | null = null

    const onMouseDown = () => {
      releaseDrag?.()
      const suppress = (e: MouseEvent) => e.stopPropagation()
      const release = () => {
        window.removeEventListener('mousemove', suppress, true)
        window.removeEventListener('mouseup', release, true)
        releaseDrag = null
      }
      releaseDrag = release
      window.addEventListener('mousemove', suppress, true)
      window.addEventListener('mouseup', release, true)
    }

    el.addEventListener('wheel', swallow, { passive: false })
    el.addEventListener('mousemove', swallow)
    el.addEventListener('keydown', swallow)
    el.addEventListener('keyup', swallow)
    el.addEventListener('mousedown', onMouseDown)

    return () => {
      // A drag in flight when this unmounts would otherwise leave two live
      // listeners on window swallowing every mouse move for the rest of the session.
      releaseDrag?.()
      el.removeEventListener('wheel', swallow)
      el.removeEventListener('mousemove', swallow)
      el.removeEventListener('keydown', swallow)
      el.removeEventListener('keyup', swallow)
      el.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  /**
   * Disarm on a timer, which is what makes the confirm label go away on its own.
   *
   * This is presentation only. The window is enforced against the real clock
   * inside `press`, so a throttled background tab can leave the label up too long
   * but cannot make a late press fire. Doing it the other way round - checking
   * the clock while rendering - is a purity violation the React compiler rejects,
   * and it deserves to: the button's label would depend on when React last
   * happened to re-render.
   */
  useEffect(() => {
    if (gate.armed === null) return
    const t = window.setTimeout(() => setGate(IDLE), CONFIRM_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [gate])

  /** Collapsing cancels any pending confirmation rather than parking it. */
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    blurIfClicked(e)
    setGate(IDLE)
    setOpen((v) => !v)
  }

  const onReset = (e: React.MouseEvent<HTMLButtonElement>) => {
    blurIfClicked(e)
    const { fire, next } = press(gate, RESET, Date.now())
    setGate(next)
    if (fire) onResetProgress()
  }

  const onCompleteAll = (e: React.MouseEvent<HTMLButtonElement>) => {
    blurIfClicked(e)
    setGate(IDLE)
    for (const lesson of LESSONS) completeLesson(lesson.id)
  }

  return (
    <div ref={root} style={styles.root} data-hud="">
      {!open && (
        <button style={styles.tab} onClick={toggle} title="Admin controls" aria-expanded={false}>
          ADMIN
        </button>
      )}

      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <span style={styles.badge}>ADMIN</span>
            <button style={styles.close} onClick={toggle} aria-label="Hide admin controls">
              ×
            </button>
          </div>

          {/*
            The scroll container, and the only element allowed to scroll. `body`
            sets `touch-action: none` globally so that a future touch control
            scheme is not fighting the browser's pan gesture, and that
            suppresses panning inside descendants too - so this has to opt back
            in explicitly or the panel is unscrollable on a touch device.
          */}
          <div style={styles.body}>
            <Section label="State">
              <Row name="scene" value={displayedSceneId} />
              <Row
                name="lessons"
                value={`${progress.completedLessons.length} / ${LESSONS.length}`}
              />
              <Row
                name="cosmetics"
                value={
                  wornList.length === 0
                    ? 'none'
                    : wornList.map(([socket, id]) => `${socket}:${id}`).join(' ')
                }
              />
              {/*
                Shown because it is a real state the store can be in, not a
                hypothetical: the mounted scene is owned by `useSceneTravel` and
                a store write cannot move it. If this line ever appears, the HUD
                title is lying about where the player is.
              */}
              {displayedSceneId !== progress.currentSceneId && (
                <div style={styles.warn}>
                  store says {progress.currentSceneId}; world is {displayedSceneId}
                </div>
              )}
            </Section>

            <Section label="Utilities">
              <button
                style={{ ...styles.action, ...(busy ? styles.actionDisabled : null) }}
                onClick={onCompleteAll}
                disabled={busy}
              >
                Complete all lessons
              </button>
              <p style={styles.note}>
                Marks every lesson done. The inverse of the reset below, and the
                quickest way to see whether the reset actually took.
              </p>
            </Section>

            <Section label="Danger" danger>
              <button
                style={{
                  ...styles.action,
                  ...styles.danger,
                  ...(resetArmed ? styles.armed : null),
                  ...(busy ? styles.actionDisabled : null),
                }}
                onClick={onReset}
                disabled={busy}
              >
                {resetArmed ? 'Confirm: erase progress' : 'Reset all progress'}
              </button>
              <p style={{ ...styles.note, ...styles.noteFixed }}>
                {busy
                  ? 'Unavailable during a scene transition: travel requests are refused while one is in flight.'
                  : resetArmed
                    ? 'Press again to erase. Cancels itself in a few seconds.'
                    : 'Clears completed lessons, re-locks the portal, removes earned cosmetics, and returns you to the hub.'}
              </p>
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Hand the keyboard back to the game after a mouse click.
 *
 * The panel swallows key events so that Space and Enter aimed at a button do not
 * also jump or complete a lesson. The cost is that a button left focused keeps
 * swallowing WASD after the panel is collapsed, which reads as the controls
 * having died. Blurring fixes that, but blurring after a keyboard activation
 * would strand a keyboard user with no focus at all - so this only fires for a
 * real pointer press. `detail` is the click count, which is 0 for a click
 * synthesised from Enter or Space and 1 or more for a mouse.
 */
function blurIfClicked(e: React.MouseEvent<HTMLElement>) {
  if (e.detail > 0) e.currentTarget.blur()
}

function Section({
  label,
  danger,
  children,
}: {
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, ...(danger ? styles.sectionLabelDanger : null) }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowName}>{name}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  )
}

/** Deliberately not the HUD's font. A tool should not look like the game. */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const EDGE = 'rgba(255,255,255,0.13)'

const styles: Record<string, React.CSSProperties> = {
  /*
    Left edge, vertically centred, and that position is chosen rather than
    inherited: the HUD's scene title sits at top 20 / left 20, its key legend and
    the graphics selector at top 20 / right 20, and the interact prompt is bottom
    centre. The middle of the left edge is the only margin none of them reach.

    Above the HUD's z-index of 10 and below the iris transition's 50, so a
    transition still covers the panel.
  */
  root: {
    position: 'fixed',
    top: '50%',
    left: 0,
    transform: 'translateY(-50%)',
    zIndex: 20,
    fontFamily: MONO,
    color: '#dce5f0',
    // No `pointerEvents: 'none'` root here, unlike the HUD: this element is only
    // as large as its contents and never covers the canvas.
  },
  tab: {
    // Flush to the edge, so it reads as a drawer rather than a floating button.
    writingMode: 'vertical-rl',
    textOrientation: 'mixed',
    background: 'rgba(16,19,26,0.9)',
    border: `1px solid ${EDGE}`,
    borderLeft: 'none',
    borderRadius: '0 7px 7px 0',
    color: '#9fb0c4',
    cursor: 'pointer',
    fontFamily: MONO,
    fontSize: '0.62rem',
    letterSpacing: '0.22em',
    padding: '14px 5px',
  },
  panel: {
    width: 268,
    background: 'rgba(16,19,26,0.94)',
    // Not blurred, unlike the HUD's glass. Opaque slate is the read that says
    // "this is not part of the world behind it".
    border: `1px solid ${EDGE}`,
    borderLeft: 'none',
    borderRadius: '0 10px 10px 0',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: `1px solid ${EDGE}`,
  },
  badge: {
    fontSize: '0.62rem',
    letterSpacing: '0.22em',
    color: '#ffb02e',
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: '#8494a8',
    cursor: 'pointer',
    fontFamily: MONO,
    fontSize: '1rem',
    lineHeight: 1,
    padding: '0 2px',
  },
  body: {
    maxHeight: '62vh',
    overflowY: 'auto',
    // See the comment at the call site: `body { touch-action: none }` in
    // index.css would otherwise block panning inside this element.
    touchAction: 'pan-y',
    padding: '4px 10px 10px',
  },
  section: { paddingTop: 10 },
  sectionLabel: {
    fontSize: '0.58rem',
    letterSpacing: '0.16em',
    color: '#6f8095',
    borderBottom: `1px solid rgba(255,255,255,0.07)`,
    paddingBottom: 4,
    marginBottom: 7,
  },
  sectionLabelDanger: { color: '#ff8a7d' },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: '0.68rem',
    lineHeight: 1.7,
  },
  rowName: { color: '#71829a' },
  rowValue: { color: '#e6eef8', fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
  warn: {
    marginTop: 6,
    padding: '5px 7px',
    borderRadius: 4,
    background: 'rgba(255,176,46,0.1)',
    border: '1px solid rgba(255,176,46,0.3)',
    color: '#ffcd7a',
    fontSize: '0.62rem',
    lineHeight: 1.5,
  },
  action: {
    display: 'block',
    width: '100%',
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid ${EDGE}`,
    // Square, unlike every player-facing button in this project.
    borderRadius: 4,
    color: '#e6eef8',
    cursor: 'pointer',
    fontFamily: MONO,
    fontSize: '0.7rem',
    padding: '7px 9px',
    textAlign: 'left',
  },
  /*
    Applied by hand rather than left to `:disabled`, for two reasons. Inline
    styles cannot express a pseudo-class at all, and the UA default would not
    help anyway: Chrome only greys a disabled button's text when the author has
    not set `color`, and this one sets it. Without this the button looks live
    while refusing every click, which is worse than looking dead.
  */
  actionDisabled: { opacity: 0.38, cursor: 'not-allowed' },
  danger: {
    borderColor: 'rgba(255,107,94,0.4)',
    color: '#ff9c92',
    background: 'rgba(255,107,94,0.08)',
  },
  armed: {
    background: 'rgba(255,107,94,0.9)',
    borderColor: '#ff6b5e',
    color: '#2a0906',
    fontWeight: 700,
  },
  note: {
    margin: '6px 0 0',
    fontSize: '0.6rem',
    lineHeight: 1.55,
    color: '#71829a',
  },
  /**
   * A fixed height for the note under the destructive control, so arming it
   * cannot reflow the panel.
   *
   * Found by clicking it: the panel is vertically centred, so when the armed
   * state swapped in a shorter hint the panel's height changed, it re-centred,
   * and **the button moved about 7 px down - out from under the cursor that had
   * just armed it.** A destructive control that walks away between the arm and
   * the confirm is the wrong kind of surprising, and the reflow makes the second
   * press land on the panel background instead.
   *
   * Three lines at this size and line height covers the longest of the three
   * strings, which is the transition-busy one, so none of them can change the
   * height. Measured rather than guessed: 0.6rem at line-height 1.55 is 14.88 px
   * per line.
   */
  noteFixed: {
    minHeight: '2.8rem',
  },
}
