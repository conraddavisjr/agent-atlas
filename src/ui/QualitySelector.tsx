import { useQualityTier } from '@/art/useQuality'
import type { QualityTier } from '@/art/quality'

const TIERS: { id: QualityTier; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' },
]

/**
 * Graphics tier control.
 *
 * A guess is made on load from the GPU string, and a guess about hardware is
 * exactly the kind of thing that is wrong often enough to need an override. It
 * is deliberately visible rather than buried in a settings menu, because the
 * player most likely to need it is the one whose frame rate is already bad, and
 * asking them to go hunting is asking them to close the tab instead.
 *
 * Switching remounts a good deal of the renderer, so the change is not
 * instantaneous. That is acceptable for something touched once.
 */
export function QualitySelector() {
  const { tier, setTier } = useQualityTier()

  return (
    <div className="hud-quality" style={styles.wrap}>
      <span style={styles.label}>Graphics</span>
      <div style={styles.group}>
        {TIERS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTier(t.id)}
            style={{ ...styles.option, ...(t.id === tier ? styles.active : null) }}
            aria-pressed={t.id === tier}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 0 },
  label: { fontSize: '0.74rem', opacity: 0.62 },
  group: {
    display: 'flex',
    // Re-enabled here rather than on the HUD root, which must stay transparent
    // to clicks meant for the canvas behind it.
    pointerEvents: 'auto',
    borderRadius: 6,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.16)',
  },
  option: {
    background: 'rgba(255,255,255,0.06)',
    border: 'none',
    color: '#eaf2ff',
    fontFamily: 'inherit',
    fontSize: '0.7rem',
    padding: '7px 10px',
    cursor: 'pointer',
  },
  active: { background: 'rgba(120,190,255,0.32)', fontWeight: 600 },
}
