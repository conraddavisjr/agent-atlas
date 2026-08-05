import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null; info: string | null }

/**
 * Catches render and lifecycle errors so a failure degrades into a readable
 * message instead of an empty page.
 *
 * This matters more here than in a typical app. Without accounts there is no
 * server-side record of what a player was doing, so a white screen gives both
 * them and us nothing to go on. It also gives them the one recovery action that
 * always works when saved progress is the suspect: clearing it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged rather than swallowed, so the stack is still available in devtools.
    console.error('[AI Academy] render error:', error, info.componentStack)
    this.setState({ info: info.componentStack ?? null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={styles.root}>
        <div style={styles.panel}>
          <h1 style={styles.title}>Something broke</h1>
          <p style={styles.message}>{error.message}</p>
          {info && <pre style={styles.stack}>{info.trim().split('\n').slice(0, 12).join('\n')}</pre>}
          <div style={styles.actions}>
            <button style={styles.button} onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              style={{ ...styles.button, ...styles.secondary }}
              onClick={() => {
                localStorage.removeItem('ai-academy-progress')
                window.location.reload()
              }}
            >
              Clear progress and reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: '#0a0d16',
    padding: 24,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#eaf2ff',
    overflow: 'auto',
  },
  panel: {
    maxWidth: 720,
    width: '100%',
    background: 'rgba(20,26,44,0.9)',
    border: '1px solid rgba(150,200,255,0.16)',
    borderRadius: 16,
    padding: 28,
  },
  title: { margin: '0 0 10px', fontSize: '1.3rem' },
  message: { margin: '0 0 16px', color: '#ffb4b4', fontFamily: 'ui-monospace, monospace', fontSize: '0.86rem' },
  stack: {
    margin: 0,
    padding: 14,
    background: 'rgba(0,0,0,0.35)',
    borderRadius: 10,
    fontSize: '0.72rem',
    lineHeight: 1.5,
    overflowX: 'auto',
    color: '#9fb6d4',
  },
  actions: { display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  button: {
    background: 'linear-gradient(180deg, #ffb45c, #ff8a2b)',
    border: 'none',
    borderRadius: 9,
    padding: '9px 18px',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: '#2a1400',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  secondary: {
    background: 'rgba(255,255,255,0.1)',
    color: '#eaf2ff',
    border: '1px solid rgba(255,255,255,0.16)',
  },
}
