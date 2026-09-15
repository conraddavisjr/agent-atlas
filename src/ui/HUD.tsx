import { useState } from 'react'
import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS, ZONES } from '@/state/lessons'
import { isLessonComplete, zoneProgress } from '@/state/progression'
import { MINIGAMES } from '@/state/lessonRoutes'
import { getScene } from '@/game/scenes/registry'
import { QualitySelector } from './QualitySelector'

/** Lightweight chrome: keep the centre of the frame free for play. */
export function HUD({ onInteract }: { onInteract: () => void }) {
  const progress = useProgress()
  const activeTotemId = useGameStore((s) => s.activeTotemId)
  const [showControls, setShowControls] = useState(false)
  const scene = getScene(progress.currentSceneId)
  const zone = ZONES.find((z) => z.sceneId === scene.id)
  const stats = zone ? zoneProgress(zone.id, LESSONS, progress) : null
  const lessons = LESSONS.filter((lesson) => lesson.zoneId === zone?.id)
  const nextLesson = lessons.find((lesson) => !isLessonComplete(lesson, progress))
  const activeLesson = lessons.find((lesson) => lesson.id === activeTotemId)
  const alreadyDone = activeLesson ? isLessonComplete(activeLesson, progress) : false
  const playable = activeLesson ? !!MINIGAMES[activeLesson.id] : false

  // Scripted lessons own their interface and their keyboard hints.
  if (!zone) return null

  return (
    <div className="game-hud" data-hud="">
      <header className="hud-location">
        <div className="hud-brand"><span className="hud-brand-mark" aria-hidden="true">a</span> AGENT ATLAS</div>
        <div className="hud-world"><span className="hud-world-number">{String(ZONES.indexOf(zone) + 1).padStart(2, '0')}</span><h1>{scene.title}</h1></div>
        <div className="hud-progress" aria-label={`${stats?.done ?? 0} of ${stats?.total ?? 0} lessons completed`}>
          <div className="hud-progress-pips" aria-hidden="true">
            {lessons.map((lesson) => <span key={lesson.id} className={isLessonComplete(lesson, progress) ? 'is-complete' : ''} />)}
          </div>
          <span>{stats?.done} / {stats?.total} discovered</span>
        </div>
      </header>

      <div className="hud-settings">
        <QualitySelector />
        <button className="hud-help" aria-label="Show controls" aria-expanded={showControls} aria-controls="game-controls" onClick={() => setShowControls((shown) => !shown)}>?</button>
      </div>

      {showControls && (
        <section id="game-controls" className="hud-controls" aria-label="Game controls">
          <div className="hud-eyebrow">READY TO EXPLORE</div>
          <Key label="W / S" action="Drive forward / back" />
          <Key label="A / D" action="Turn your robot" />
          <Key label="Space × 2" action="Jump + thruster jump" />
          <Key label="Drag / Scroll" action="Look around" />
          <Key label="E / Enter" action="Explore a lesson" />
          <p>Gamepad: left stick to drive, right stick to look, A to jump, X to interact.</p>
        </section>
      )}

      {activeLesson ? (
        <section className="hud-lesson" key={activeLesson.id} aria-label="Nearby lesson">
          <div className="hud-lesson-icon" aria-hidden="true">{alreadyDone ? '✓' : '✦'}</div>
          <div className="hud-lesson-copy">
            <div className="hud-eyebrow">{alreadyDone ? 'DISCOVERY COMPLETE' : 'NEW DISCOVERY'}</div>
            <h2>{activeLesson.title}</h2>
            <p>{activeLesson.blurb}</p>
          </div>
          {(!alreadyDone || playable) && <button className="hud-interact" onClick={onInteract}><kbd>E</kbd><span>{playable ? alreadyDone ? 'Play again' : 'Explore' : 'Discover'}</span><span aria-hidden="true">↗</span></button>}
        </section>
      ) : (
        <div className="hud-objective">
          <span className="hud-objective-icon" aria-hidden="true">✦</span>
          <div><div className="hud-eyebrow">{nextLesson ? 'FOLLOW YOUR CURIOSITY' : 'WORLD COMPLETE'}</div><p>{nextLesson ? 'Find a glowing beacon to begin' : 'Your next adventure is through the portal'}</p></div>
        </div>
      )}

      <div className="hud-bottom-hints" aria-label="Quick controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>Space × 2</kbd> Double jump</span><span><kbd>Drag</kbd> Look</span></div>
    </div>
  )
}

function Key({ label, action }: { label: string; action: string }) {
  return <div className="hud-key-row"><kbd>{label}</kbd><span>{action}</span></div>
}
