import { useGameStore } from '@/state/gameStore'
import { useTrainingStore } from '@/game/training/trainingStore'
import { preload, unlock, decline, voiceState } from '@/audio/voice'
import { LAYER } from './layers'

/**
 * The one card that comes before the wizard: do you want to hear him?
 *
 * ## Why it is asked rather than attempted
 *
 * A browser will not start audio until a gesture says it may, and there are two
 * ways to satisfy that. The clever one is to piggyback on the E press at the
 * totem and never ask - which works, and which means the first thing a player
 * meets in this round is a voice they did not know was coming, in a tab they may
 * have muted, possibly at work.
 *
 * So the round asks. The button IS the gesture, which is the neat part: a click
 * satisfies every browser including Safari, where a deferred `resume()` outside
 * the handler's own call stack is refused. The gate is therefore both the
 * question and the answer to it.
 *
 * ## It holds the round rather than racing it
 *
 * While this is up, `TrainingScene` steps the machine with `dt = 0`. The wizard
 * does not fly in, the iris has already opened, and nothing is animating behind
 * the card - so the player is choosing before the round rather than during it.
 * `stepTraining` is pure and checks `bail` before any timer, so Escape still
 * works from behind the gate, which is the one thing a player stuck at a dialog
 * must be able to do.
 *
 * ## What declining costs
 *
 * Nothing but the sound. Not the beat lengths, not the subtitle timing, not the
 * camera, not the wizard's flight - the silent round and the spoken round are
 * frame for frame the same round, because the beats come from a manifest that is
 * compiled into the bundle rather than from the audio. See `voice.ts`.
 */
export function AudioGate() {
  const gateOpen = useTrainingStore((s) => s.gateOpen)
  const closeGate = useTrainingStore((s) => s.closeGate)
  const setAudio = useGameStore((s) => s.setAudio)

  if (!gateOpen) return null

  const accept = () => {
    /*
      Synchronously, inside the click. Safari requires the resume to happen in the
      gesture's own call stack rather than merely after one has occurred, and this
      is the only place in the round where that is guaranteed.
    */
    unlock()
    setAudio('on')
    void preload()
    closeGate()
  }

  const refuse = () => {
    decline()
    setAudio('off')
    closeGate()
  }

  const blocked = voiceState() === 'blocked'

  return (
    <div style={styles.scrim}>
      <div style={styles.card}>
        <div style={styles.heading}>Sound?</div>
        <div style={styles.body}>
          The instructor says his lines aloud. Your browser will not let him start
          without your say-so.
        </div>
        {blocked && (
          /*
            Shown only after an attempt that the browser refused, which is rare
            and is exactly the case that would otherwise be silence. It says what
            happened rather than pretending the choice took.
          */
          <div style={styles.blocked}>
            Your browser refused. Check that this tab is not muted, and try again.
          </div>
        )}
        <div style={styles.row}>
          <button style={styles.primary} onClick={accept} autoFocus>
            Let him speak
          </button>
          <button style={styles.secondary} onClick={refuse}>
            Continue in silence
          </button>
        </div>
      </div>
    </div>
  )
}

/*
  A scrim, not a bare panel. The round has already arrived behind this - the iris
  is open and the robot is standing on the grid - and a card floating over a live
  scene with no ground reads as a notification rather than as a question that is
  holding everything up.
*/
const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    /*
      Above the HUD and BELOW the iris. The iris is the round's own curtain: a
      dialog that outranks it would sit on top of a closing transition, which
      reads as a hang rather than as a question.
    */
    zIndex: LAYER.overlay,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(4, 8, 18, 0.55)',
    backdropFilter: 'blur(2px)',
    pointerEvents: 'auto',
    fontFamily: 'inherit',
  },
  card: {
    maxWidth: 380,
    padding: '22px 24px 20px',
    borderRadius: 14,
    border: '1px solid rgba(150, 190, 250, 0.22)',
    background: 'rgba(12, 20, 38, 0.94)',
    color: '#e6eefc',
    textAlign: 'center',
    boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45)',
  },
  heading: {
    fontSize: '1.05rem',
    fontWeight: 600,
    marginBottom: 8,
  },
  body: {
    fontSize: '0.86rem',
    lineHeight: 1.5,
    opacity: 0.82,
  },
  blocked: {
    marginTop: 10,
    fontSize: '0.78rem',
    lineHeight: 1.45,
    color: '#ffd9a8',
  },
  row: {
    marginTop: 18,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  primary: {
    background: 'linear-gradient(180deg, #5aa9f5, #2f7ad2)',
    border: 'none',
    borderRadius: 9,
    color: '#f2f7ff',
    padding: '9px 22px',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  /*
    A text link rather than a second button. The two choices are not equal - one
    is the round as designed and one is a way past it - and a matched pair of
    buttons says they are.
  */
  secondary: {
    background: 'none',
    border: 'none',
    color: 'rgba(214, 228, 252, 0.62)',
    fontSize: '0.8rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 4,
  },
}
