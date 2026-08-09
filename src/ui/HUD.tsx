import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS, ZONES } from '@/state/lessons'
import { zoneProgress } from '@/state/progression'
import { getScene } from '@/game/scenes/registry'
import { QualitySelector } from './QualitySelector'

/**
 * DOM overlay rather than in-canvas UI.
 *
 * Text rendered in WebGL is expensive, harder to make crisp, and invisible to
 * screen readers. Keeping the HUD as ordinary DOM over the canvas is one of the
 * main practical reasons for choosing React Three Fiber over vanilla three.js.
 */
export function HUD() {
  const progress = useProgress()
  const activeTotemId = useGameStore((s) => s.activeTotemId)
  const completeLesson = useGameStore((s) => s.completeLesson)

  const scene = getScene(progress.currentSceneId)
  const zone = ZONES.find((z) => z.sceneId === scene.id)
  const stats = zone ? zoneProgress(zone.id, LESSONS, progress) : null
  const activeLesson = LESSONS.find((l) => l.id === activeTotemId)
  const alreadyDone = activeLesson ? progress.completedLessons.includes(activeLesson.id) : false

  return (
    <div style={styles.root}>
      <div style={styles.topLeft}>
        <div style={styles.sceneTitle}>{scene.title}</div>
        {stats && (
          <div style={styles.progress}>
            {stats.done} / {stats.total} lessons
          </div>
        )}
      </div>

      <div style={styles.topRight}>
        <Key label="W / S" action="Drive" />
        <Key label="A / D" action="Turn" />
        <Key label="Space" action="Jump" />
        <Key label="Drag" action="Look" />
        <QualitySelector />
      </div>

      {/*
        The interact prompt. Completion is a placeholder button for now: there is
        no lesson content yet, so this stands in for finishing one and exists to
        prove progression, cosmetics, and portal locks all update from it.
      */}
      {activeLesson && (
        <div style={styles.prompt}>
          <div style={styles.promptTitle}>{activeLesson.title}</div>
          <div style={styles.promptBlurb}>
            {alreadyDone ? 'Already completed' : activeLesson.blurb}
          </div>
          {!alreadyDone && (
            <button style={styles.button} onClick={() => completeLesson(activeLesson.id)}>
              Press E or click to complete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Key({ label, action }: { label: string; action: string }) {
  return (
    <div style={styles.keyRow}>
      <span style={styles.keyCap}>{label}</span>
      <span style={styles.keyAction}>{action}</span>
    </div>
  )
}

const panel: React.CSSProperties = {
  background: 'rgba(10,16,30,0.55)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(150,200,255,0.14)',
  borderRadius: 14,
  padding: '12px 16px',
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    // The HUD must never eat clicks meant for the canvas. Individual controls
    // re-enable pointer events on themselves.
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#eaf2ff',
    zIndex: 10,
  },
  topLeft: { position: 'absolute', top: 20, left: 20, ...panel },
  sceneTitle: { fontSize: '1.05rem', fontWeight: 600, letterSpacing: '0.01em' },
  progress: { fontSize: '0.78rem', opacity: 0.66, marginTop: 3 },
  topRight: {
    position: 'absolute',
    top: 20,
    right: 20,
    ...panel,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  keyRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem' },
  keyCap: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 5,
    padding: '2px 7px',
    minWidth: 88,
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  keyAction: { opacity: 0.62 },
  prompt: {
    position: 'absolute',
    bottom: 44,
    left: '50%',
    transform: 'translateX(-50%)',
    ...panel,
    textAlign: 'center',
    minWidth: 300,
  },
  promptTitle: { fontSize: '1rem', fontWeight: 600 },
  promptBlurb: { fontSize: '0.8rem', opacity: 0.7, marginTop: 4 },
  button: {
    pointerEvents: 'auto',
    marginTop: 12,
    background: 'linear-gradient(180deg, #ffb45c, #ff8a2b)',
    border: 'none',
    borderRadius: 9,
    padding: '8px 18px',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#2a1400',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
