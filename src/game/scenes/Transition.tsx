import { useEffect, useRef } from 'react'
import { useProgress } from '@react-three/drei'
import { iris } from './irisHandle'

/**
 * The portal and revival overlay: a circle that collapses onto the character
 * and later opens back out from wherever they reappear.
 *
 * This is a feel element, not a loading indicator. Three things make it work:
 *
 * 1. A minimum covered duration, enforced by the travel hook. Local scene loads
 *    complete in a frame or two, so without a floor the overlay appears and
 *    vanishes almost instantly, reading as a flicker rather than as travel.
 * 2. Input stays locked for its whole duration, so the player cannot walk into
 *    geometry that is still being built.
 * 3. It is anchored to the character rather than to the middle of the screen.
 *    A centred iris reads as a screen effect; one that collapses onto the robot
 *    reads as something happening to the robot.
 *
 * Rendered as DOM rather than in the canvas on purpose: it must cover the screen
 * even during the frames where the canvas contents are being torn down.
 *
 * Deliberately does no animation of its own. Position and radius are driven by
 * IrisTracker from inside the render loop, because the geometry depends on the
 * live camera. This component owns the element and the label; the tracker owns
 * what the element looks like on any given frame.
 */
export function Transition({ active, label }: { active: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  /*
    Load progress, shown only while something is genuinely outstanding.

    The world now ships several megabytes of texture, and until it arrives the
    iris simply stays shut, which is indistinguishable from the game having
    failed to start. A number under the destination name is the difference
    between "loading" and "broken".

    `active` is not part of the condition on purpose: the very first load is not
    a transition, the screen is just covered, and that is exactly when the wait
    is longest.
  */
  const { active: loading, progress } = useProgress()

  useEffect(() => {
    iris.el = ref.current
    return () => {
      iris.el = null
    }
  }, [])

  return (
    <div
      ref={ref}
      className="iris"
      aria-hidden={!active}
      // Never hit-testable. The overlay is decorative, and swallowing clicks
      // would break camera drag on the frames where it is still fading out.
      style={{ pointerEvents: 'none' }}
    >
      {label && (
        <div
          style={{
            position: 'absolute',
            /*
              Anchored to the bottom of the viewport rather than centred on the
              iris. Centring it would put the destination name directly on top
              of the character the iris is closing in on, and the two would
              overlap for the whole transition.
            */
            left: 0,
            right: 0,
            bottom: '12%',
            textAlign: 'center',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: '0.78rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(180,220,255,0.72)',
            opacity: active ? 1 : 0,
            transform: `translateY(${active ? 0 : 8}px)`,
            transition: 'transform 400ms ease-out, opacity 260ms ease-out',
          }}
        >
          {label}
        </div>
      )}

      {/*
        **The orbit, and it is centred on the iris rather than on the screen.**

        `IrisTracker` publishes `--iris-x` and `--iris-y` every frame, so this
        rides the exact point the world is about to open from. That is the whole
        idea: the thing you watch while you wait becomes the thing that opens,
        rather than a spinner somewhere else that disappears and is replaced.

        It is mounted whenever the overlay is and faded by opacity rather than
        unmounted, so the atom does not vanish on the frame the last texture
        lands. It shrinks slightly as it goes, which reads as the orbits
        collapsing into the world rather than as a layer being switched off.
      */}
      <div
        className="iris-orbit"
        style={{ opacity: loading ? 1 : 0, transform: `scale(${loading ? 1 : 0.82})` }}
      >
        <div className="iris-nucleus" />
        {/*
          Three rings at three tilts. Two would read as a flat pair of ellipses
          and four starts to look like a logo; three is the fewest that reads as
          a volume being described rather than as circles drawn on glass.
        */}
        <div className="iris-ring iris-ring-a">
          <i />
        </div>
        <div className="iris-ring iris-ring-b">
          <i />
        </div>
        <div className="iris-ring iris-ring-c">
          <i />
        </div>
      </div>

      {loading && (
        <div style={loadingStyle}>
          <div style={loadingBarTrack}>
            <div style={{ ...loadingBarFill, width: `${Math.round(progress)}%` }} />
          </div>
          <div style={loadingText}>Loading {Math.round(progress)}%</div>
        </div>
      )}
    </div>
  )
}

const loadingStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '22%',
  transform: 'translateX(-50%)',
  width: 200,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  textAlign: 'center',
}

const loadingBarTrack: React.CSSProperties = {
  height: 2,
  background: 'rgba(150,200,255,0.18)',
  borderRadius: 2,
  overflow: 'hidden',
}

const loadingBarFill: React.CSSProperties = {
  height: '100%',
  background: 'rgba(120,215,255,0.85)',
  // Eased, because raw loader progress arrives in jumps as each file lands and
  // an unsmoothed bar reads as stuttering rather than as loading.
  transition: 'width 240ms ease-out',
}

const loadingText: React.CSSProperties = {
  marginTop: 10,
  fontSize: '0.66rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(180,220,255,0.5)',
  fontVariantNumeric: 'tabular-nums',
}
