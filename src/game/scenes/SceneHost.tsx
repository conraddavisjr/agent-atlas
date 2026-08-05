import { useCallback, useEffect, useRef, useState } from 'react'
import { TRANSITION } from '../player/tuning'
import { getSpawn } from './registry'

export type TravelRequest = { sceneId: string; spawnId: string }

/**
 * Orchestrates travelling between scenes.
 *
 * The sequence is deliberately staged rather than immediate:
 *
 *   cover the screen -> swap the scene -> hold for the minimum -> reveal
 *
 * The minimum hold is the part that is easy to leave out and immediately obvious
 * when it is missing. A local scene mounts in a frame or two, so without a floor
 * the overlay appears and vanishes almost instantly, reading as a flicker rather
 * than as travel.
 */
export function useSceneTravel(
  initial: TravelRequest,
  onArrive: (request: TravelRequest) => void,
) {
  /** What is actually mounted right now, as opposed to where we are heading. */
  const [displayed, setDisplayed] = useState<TravelRequest>(initial)
  const [covering, setCovering] = useState(false)
  const [label, setLabel] = useState<string | undefined>()

  const timers = useRef<number[]>([])
  const inFlight = useRef(false)

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const travel = useCallback(
    (request: TravelRequest, displayLabel?: string) => {
      // Guard against a second request landing mid-transition, which would
      // otherwise interleave timers and reveal the screen early.
      if (inFlight.current) return
      inFlight.current = true

      setLabel(displayLabel)
      setCovering(true)

      timers.current.push(
        window.setTimeout(() => {
          // Swap once the screen is fully covered, never before.
          setDisplayed(request)
          onArrive(request)
        }, TRANSITION.fadeOutMs),
      )

      timers.current.push(
        window.setTimeout(() => {
          setCovering(false)
          inFlight.current = false
        }, Math.max(TRANSITION.minDurationMs, TRANSITION.fadeOutMs + 200)),
      )
    },
    [onArrive],
  )

  return {
    displayed,
    covering,
    label,
    travel,
    spawn: getSpawn(displayed.sceneId, displayed.spawnId),
  }
}
