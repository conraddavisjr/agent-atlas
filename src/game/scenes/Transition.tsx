import { TRANSITION } from '../player/tuning'

/**
 * The portal transition overlay.
 *
 * This is a feel element, not a loading indicator. Three things make it work:
 *
 * 1. A minimum covered duration, enforced by the travel hook. Local scene loads
 *    complete in a frame or two, so without a floor the overlay appears and
 *    vanishes almost instantly, reading as a flicker rather than as travel.
 * 2. Input stays locked for its whole duration, so the player cannot walk into
 *    geometry that is still being built.
 * 3. A vignette wipe rather than a plain fade, which reads as deliberate travel
 *    rather than as the game stalling.
 *
 * Rendered as DOM rather than in the canvas on purpose: it must cover the screen
 * even during the frames where the canvas contents are being torn down.
 *
 * Always mounted and driven purely by `active`. Mounting and unmounting it would
 * mean the fade-out has no element to animate, and tracking that with state would
 * add a render cascade for something CSS already expresses directly.
 */
export function Transition({ active, label }: { active: boolean; label?: string }) {
  return (
    <div
      aria-hidden={!active}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: active ? 'auto' : 'none',
        zIndex: 50,
        opacity: active ? 1 : 0,
        // `visibility` is transitioned with a delay so the element stops being
        // hit-testable and readable only after the fade has finished.
        visibility: active ? 'visible' : 'hidden',
        transition: active
          ? `opacity ${TRANSITION.fadeOutMs}ms ease-in-out, visibility 0s`
          : `opacity ${TRANSITION.fadeInMs}ms ease-in-out, visibility 0s linear ${TRANSITION.fadeInMs}ms`,
        background:
          'radial-gradient(circle at 50% 50%, rgba(8,12,24,0.88) 0%, rgba(4,6,14,1) 45%, rgba(2,3,8,1) 100%)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {label && (
        <div
          style={{
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: '0.78rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(180,220,255,0.72)',
            transform: `translateY(${active ? 0 : 8}px)`,
            transition: 'transform 400ms ease-out',
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}
