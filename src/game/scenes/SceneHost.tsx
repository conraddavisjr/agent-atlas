import { useCallback, useEffect, useRef, useState } from 'react'
import { TRANSITION } from '../player/tuning'
import { getSpawn } from './registry'
import { setIris, tweenIris } from './irisHandle'

export type TravelRequest = { sceneId: string; spawnId: string }

/**
 * Where the game is in a transition.
 *
 *   idle     normal play
 *   closing  the iris is collapsing onto the character, who coasts to a stop
 *   held     screen covered, scene swapped or player rebuilt, physics paused
 *   opening  the iris is opening back out while the character falls in
 *
 * The distinction between `closing` and `held` is what lets the world keep
 * simulating while the iris closes. Pausing physics at the start of the
 * transition instead froze the character mid-stride under the closing circle,
 * which read as a hitch rather than as a departure.
 */
export type Phase = 'idle' | 'closing' | 'held' | 'opening'

/**
 * Orchestrates travelling between scenes, and dying.
 *
 * The sequence is deliberately staged rather than immediate:
 *
 *   close onto the character -> swap -> hold -> open as they drop back in
 *
 * The hold has two floors, and both matter. A minimum duration, because a local
 * scene mounts in a frame or two and without a floor the overlay appears and
 * vanishes almost instantly, reading as a flicker rather than as travel. And a
 * readiness signal, because the minimum alone is a guess: a cold chunk load or a
 * texture decode can outlast it, and opening the iris onto an empty scene is
 * worse than holding black for another moment.
 */
export function useSceneTravel(
  initial: TravelRequest,
  onArrive: (request: TravelRequest) => void,
) {
  /** What is actually mounted right now, as opposed to where we are heading. */
  const [displayed, setDisplayed] = useState<TravelRequest>(initial)
  const [phase, setPhase] = useState<Phase>('held')
  const [label, setLabel] = useState<string | undefined>()

  /**
   * Bumped on every respawn so the player can be keyed off it and remounted.
   *
   * Needed because `spawn` is referentially stable: getSpawn returns the array
   * straight out of the scene registry, so PlayerController's spawn effect,
   * which depends on it, does not re-run when you die in the scene you are
   * already in. A counter in the key is what forces the rebuild.
   */
  const [respawnNonce, setRespawnNonce] = useState(0)

  /** Mirrors `phase` for the timer callbacks, which would otherwise read it stale. */
  const phaseRef = useRef<Phase>('held')
  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const timers = useRef<number[]>([])
  const inFlight = useRef(false)
  /** Set by the scene itself once its chunk, colliders and textures are all live. */
  const sceneReady = useRef(false)
  const heldSince = useRef(0)
  /** Guards against the open being scheduled twice when readiness fires repeatedly. */
  const openScheduled = useRef(false)

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  /** Start covered. The first thing the player ever sees is the world opening up. */
  useEffect(() => {
    setIris(0)
    heldSince.current = performance.now()
    return clearTimers
  }, [clearTimers])

  /**
   * Open as soon as both floors are satisfied. Safe to call repeatedly; only the
   * first call that finds the machine ready actually schedules anything.
   */
  const tryOpen = useCallback(() => {
    if (phaseRef.current !== 'held') return
    if (!sceneReady.current) return
    if (openScheduled.current) return
    openScheduled.current = true

    const elapsed = performance.now() - heldSince.current
    const wait = Math.max(0, TRANSITION.minDurationMs - elapsed)

    timers.current.push(
      window.setTimeout(() => {
        setPhaseNow('opening')
        tweenIris(1, TRANSITION.irisOpenMs)

        timers.current.push(
          window.setTimeout(() => {
            setPhaseNow('idle')
            setLabel(undefined)
            inFlight.current = false
            openScheduled.current = false
          }, TRANSITION.irisOpenMs),
        )
      }, wait),
    )
  }, [setPhaseNow])

  /**
   * Called by the scene once it is genuinely on screen.
   *
   * Idempotent on purpose: StrictMode mounts, unmounts and remounts every
   * component in development, so this fires more than once per scene.
   */
  const notifySceneReady = useCallback(() => {
    sceneReady.current = true
    tryOpen()
  }, [tryOpen])

  /** The shared front half of both travel and respawn. */
  const beginCover = useCallback(
    (onCovered: () => void) => {
      if (inFlight.current) return false
      inFlight.current = true
      openScheduled.current = false

      setPhaseNow('closing')
      tweenIris(0, TRANSITION.irisCloseMs)

      timers.current.push(
        window.setTimeout(() => {
          onCovered()
          setPhaseNow('held')
          heldSince.current = performance.now()
          tryOpen()
        }, TRANSITION.irisCloseMs),
      )
      return true
    },
    [setPhaseNow, tryOpen],
  )

  const travel = useCallback(
    (request: TravelRequest, displayLabel?: string) => {
      // Guard against a second request landing mid-transition, which would
      // otherwise interleave timers and reveal the screen early.
      if (inFlight.current) return
      setLabel(displayLabel)
      beginCover(() => {
        // A new scene has to prove itself ready again. Carrying the old flag
        // over would let the iris open on the previous scene's readiness.
        sceneReady.current = false
        // Swap once the screen is fully covered, never before.
        setDisplayed(request)
        onArrive(request)
      })
    },
    [beginCover, onArrive],
  )

  /**
   * Death and respawn. The same sequence as travel without the scene swap, so
   * dying and arriving are the same event as far as the player is concerned.
   *
   * `sceneReady` is deliberately left alone: the scene is not being rebuilt, only
   * the player, so clearing it would stall the machine waiting for a signal that
   * is never coming again.
   */
  const respawn = useCallback(() => {
    if (inFlight.current) return
    beginCover(() => {
      setRespawnNonce((n) => n + 1)
    })
  }, [beginCover])

  return {
    displayed,
    phase,
    respawnNonce,
    label,
    travel,
    respawn,
    notifySceneReady,
    /** Input is locked while the character is not the player's to steer. */
    covering: phase !== 'idle',
    /** Physics runs during the close and the fall; only the black beat is frozen. */
    physicsPaused: phase === 'held',
    /** True while the character is dropping in, which is when input stays locked. */
    reviving: phase === 'opening',
    spawn: getSpawn(displayed.sceneId, displayed.spawnId),
  }
}
