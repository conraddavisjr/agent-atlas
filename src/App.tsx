import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Group } from 'three'
import { NoToneMapping, VSMShadowMap } from 'three'

import { useInput } from './game/input/useInput'
import { PlayerController } from './game/player/PlayerController'
import { FollowCamera } from './game/camera/FollowCamera'
import { GameContext } from './game/GameContext'
import { useSceneTravel, type TravelRequest } from './game/scenes/SceneHost'
import { getScene } from './game/scenes/registry'
import { Transition } from './game/scenes/Transition'
import { IrisTracker } from './game/scenes/IrisTracker'
import { SceneReady } from './game/scenes/SceneReady'
import { Lighting } from './art/Lighting'
import { PostFX } from './art/PostFX'
import { useQuality } from './art/useQuality'
import { HUD } from './ui/HUD'
import { useGameStore, useProgress } from './state/gameStore'
import { COSMETICS, LESSONS } from './state/lessons'
import { earnedCosmetics } from './state/progression'

/**
 * Escape hatch: `?nofx` renders without post-processing.
 *
 * Kept in production builds on purpose. Post-processing is the first thing to
 * suspect when the game runs badly or looks wrong on unfamiliar hardware, and
 * with no accounts and no telemetry, asking a player to reload with one query
 * parameter is the only remote diagnostic available.
 *
 * Read once at module scope rather than per render.
 */
const DISABLE_POSTFX = new URLSearchParams(window.location.search).has('nofx')

export default function App() {
  const { intent, sample, endFrame } = useInput()
  const quality = useQuality()

  /**
   * Input lock as a ref rather than state. It is read inside the physics step,
   * and routing it through React state would mean a re-render of the whole scene
   * tree on every transition boundary.
   */
  const inputLocked = useRef(false)

  /**
   * Follow target, kept in sync with the interpolated physics transform.
   * Lazily initialised so a new Group is not allocated on every render.
   */
  const player = useRef<Group | null>(null)
  if (player.current === null) player.current = new Group()

  const storedScene = useGameStore((s) => s.currentSceneId)
  const storedSpawn = useGameStore((s) => s.currentSpawnId)
  const travelTo = useGameStore((s) => s.travelTo)
  const completeLesson = useGameStore((s) => s.completeLesson)
  const progress = useProgress()

  /**
   * Where to start. Read once on mount rather than tracked, so restoring a save
   * does not trigger a transition on load: the player should simply already be
   * where they left off.
   */
  const initial = useMemo<TravelRequest>(
    () => ({ sceneId: storedScene, spawnId: storedSpawn }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const onArrive = useCallback(
    (request: TravelRequest) => travelTo(request.sceneId, request.spawnId),
    [travelTo],
  )

  const {
    displayed,
    covering,
    physicsPaused,
    reviving,
    respawnNonce,
    label,
    travel,
    respawn,
    notifySceneReady,
    spawn,
  } = useSceneTravel(initial, onArrive)

  const doTravel = useCallback(
    (sceneId: string, spawnId: string, displayLabel?: string) =>
      travel({ sceneId, spawnId }, displayLabel),
    [travel],
  )

  /*
    Keep the ref in sync so the physics step sees the lock without a re-render.

    Deliberately not locked while `reviving`. The player is falling in during
    that phase and the controller holds its own lock until the feet touch down,
    which is a beat later than any timer here could know about.
  */
  useEffect(() => {
    inputLocked.current = covering && !reviving
  }, [covering, reviving])

  /** Interact key. Handled centrally so totems stay presentational. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' && e.code !== 'Enter') return
      if (covering) return
      const id = useGameStore.getState().activeTotemId
      if (id) completeLesson(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [covering, completeLesson])

  const scene = getScene(displayed.sceneId)
  const SceneComponent = scene.Component

  const cosmetics = useMemo(
    () => earnedCosmetics(COSMETICS, LESSONS, progress),
    [progress],
  )

  const gameContext = useMemo(() => ({ player, travel: doTravel }), [doTravel])

  return (
    <>
      <Canvas
        /*
          Variance shadow maps on the tiers that ask for soft shadows, because
          they are the only type three still supports a blur radius on.

          drei's <SoftShadows> was the obvious choice and had to be abandoned:
          it patches three's shadow shader chunk, and three 0.185 reworked those
          internals, which produced a full white-out of the scene rather than a
          visible error. The same release deprecated PCFSoftShadowMap, which is
          the warning that gave the game away.
        */
        shadows={quality.softShadows ? { type: VSMShadowMap } : true}
        dpr={[1, quality.maxDpr]}
        camera={{ fov: 55, near: 0.1, far: 250, position: [0, 6, 14] }}
        /*
          Tone mapping is disabled on the renderer and applied once at the end of
          the effect chain instead. Leaving it on here means ACES runs twice, once
          into the composer's render target and again on the way out, which
          crushes contrast and washes the whole palette out to pastel.
        */
        gl={{ antialias: false, toneMapping: NoToneMapping }}
        style={{ position: 'fixed', inset: 0 }}
      >
        {scene.sky && (
          <>
            <color attach="background" args={[scene.sky.horizon]} />
            <fog attach="fog" args={[scene.sky.horizon, 40, 150]} />
          </>
        )}
        {!scene.sky && (
          <>
            <color attach="background" args={['#0a0d16']} />
            <fog attach="fog" args={['#0a0d16', 12, 45]} />
          </>
        )}

        {/*
          This boundary is load-bearing, not defensive.

          <Physics> suspends while the Rapier WASM module loads, and lazily
          imported scenes suspend on their chunk. Without a boundary inside the
          Canvas, that suspension propagates all the way to the root, which blanks
          the HUD and the transition overlay along with the 3D view. Confining it
          here means the DOM overlay stays visible while the world is still coming
          up, which is exactly when the player most needs something on screen.
        */}
        <Suspense fallback={null}>
        <GameContext.Provider value={gameContext}>
          {/*
            Physics is paused only for the covered beat between scenes, not for
            the whole transition. Belt and braces with the input lock: it stops
            the player falling through a scene that has not finished mounting
            its colliders, which is the failure the lock alone would not catch.

            It deliberately keeps running while the iris closes, so the character
            coasts to a stop under it, and while it opens, because that is the
            drop-in falling.
          */}
          {/*
            World gravity is set for future dynamic props. The player is a
            kinematic body, which Rapier does not apply gravity to at all, so the
            controller integrates its own vertical velocity from tuning.ts. The
            two never conflict.
          */}
          <Physics timeStep={1 / 60} interpolate paused={physicsPaused} gravity={[0, -9.81, 0]}>
            {/*
              Keyed by scene so both the world and the player fully remount on
              travel. That is what guarantees the previous scene is released and
              the character controller is rebuilt against the new colliders,
              rather than quietly accumulating across transitions.
            */}
            {/* Keys are namespaced because this group and the camera below are
                siblings. Keying both with the bare scene id gave two children the
                same key, which lets React drop one of them. */}
            <group key={`world-${displayed.sceneId}`}>
              <Lighting variant={scene.lighting} />
              {/*
                SceneReady is a sibling of the scene inside this boundary, not a
                child of it. React commits neither until both resolve, so its
                mount is proof the chunk, the colliders and the textures are all
                live, which is what the travel machine waits on before opening
                the iris onto the new scene.
              */}
              <Suspense fallback={null}>
                <SceneComponent />
                <SceneReady onReady={notifySceneReady} />
              </Suspense>
              {/*
                Keyed separately from the world group so a respawn rebuilds only
                the character. Folding the nonce into the world key would tear
                down and remount the lighting and the entire scene every time the
                player fell off the island.
              */}
              <PlayerController
                key={`player-${displayed.sceneId}-${respawnNonce}`}
                intent={intent}
                sampleInput={sample}
                endInputFrame={endFrame}
                spawn={spawn}
                cosmetics={cosmetics}
                playerRef={player}
                inputLocked={inputLocked}
                killY={scene.killY}
                onDeath={respawn}
              />
            </group>

            {/*
              Inside <Physics> because the camera raycasts against the physics
              world to avoid clipping through geometry, and useRapier is only
              available within the provider. Keyed by scene so it snaps to the new
              spawn instead of springing in from wherever the last scene left it.
            */}
            <FollowCamera
              key={`camera-${displayed.sceneId}`}
              target={player}
              intent={intent}
              inputLocked={inputLocked}
            />

            {/*
              Inside the Canvas because centring the iris on the character means
              projecting a world position through the live camera. Outside
              <Physics> would work equally well; it sits here only to stay next
              to the camera it depends on.
            */}
            <IrisTracker target={player} />
          </Physics>
        </GameContext.Provider>
        </Suspense>

        {!DISABLE_POSTFX && <PostFX />}
      </Canvas>

      <HUD />
      <Transition active={covering} label={label} />
    </>
  )
}
