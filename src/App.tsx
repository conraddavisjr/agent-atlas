import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Group } from 'three'
import { NoToneMapping, VSMShadowMap } from 'three'

import { useInput } from './game/input/useInput'
import { PlayerController } from './game/player/PlayerController'
import { FollowCamera } from './game/camera/FollowCamera'
import { CAMERA } from './game/player/tuning'
import { GameContext } from './game/GameContext'
import { useSceneTravel, type TravelRequest } from './game/scenes/SceneHost'
import { getScene } from './game/scenes/registry'
import { totemAction } from './state/lessonRoutes'
import { TrainingHUD } from './ui/TrainingHUD'
import { AudioGate } from './ui/AudioGate'
import { unlock as unlockVoice } from './audio/voice'
import { Transition } from './game/scenes/Transition'
import { IrisTracker } from './game/scenes/IrisTracker'
import { DevHooks } from './dev/DevHooks'
import { SceneReady } from './game/scenes/SceneReady'
import { fxOverrides } from './art/fx'
import { Lighting } from './art/Lighting'
import { CONTACT_TINT } from './art/contactTint'
import { PostFX } from './art/PostFX'
import { useQuality } from './art/useQuality'
import { HUD } from './ui/HUD'
import { AdminPanel } from './ui/AdminPanel'
import { useGameStore, useProgress } from './state/gameStore'
import { COSMETICS, LESSONS } from './state/lessons'
import { earnedCosmetics } from './state/progression'

/**
 * Escape hatches, parsed in `src/art/fx.ts` and read once at module scope.
 *
 * Kept in production builds on purpose. Post-processing is the first thing to
 * suspect when the game runs badly or looks wrong on unfamiliar hardware, and
 * with no accounts and no telemetry, asking a player to reload with one query
 * parameter is the only remote diagnostic available.
 *
 *   ?nofx              the whole post chain off
 *   ?threshold=<n>     Bloom's luminanceThreshold, for bisecting it
 *   ?bloomdebug        intensity 6 and no smoothing, so the threshold is a hard mask
 *   ?nogfx=a,b,c       individual systems off: rim, dof, lut, vfx, blob, face
 *   ?quality=low|medium|high   forces a tier, handled in quality.ts
 *
 * `?nogfx` is applied to the quality settings themselves in `useQuality`,
 * rather than plumbed down as props, so it reaches every system that reads its
 * gate from the tier, including ones that do not exist yet.
 */
const FX = fxOverrides()

export default function App() {
  const { intent, sample, endFrame, consumeLook } = useInput()
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
  const resetProgress = useGameStore((s) => s.resetProgress)
  const progress = useProgress()
  /*
    Subscribed rather than read imperatively, because `inputLocked` is set from an
    effect and an effect only re-runs when something it depends on changes. A
    `getState()` read here would latch whatever the value was at mount and the
    lock would never come on.
  */
  const playerLocked = useGameStore((s) => s.playerLocked)
  const playerHidden = useGameStore((s) => s.playerHidden)

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
  /*
    Two reasons the player might not be driving, folded into one ref.

    The iris is the original: input is dead while a transition covers the screen.
    `playerLocked` is the second, and it exists because a scripted scene has no way
    to reach this ref - `GameContext` carries `player` and `travel` and nothing
    else, and widening it would give every scene the ability to seize input as a
    side effect of rendering. A store field is the narrower seam: the scene asks,
    `App` decides, and the release is a cleanup rather than a promise.
  */
  useEffect(() => {
    inputLocked.current = (covering && !reviving) || playerLocked
  }, [covering, reviving, playerLocked])

  /**
   * Interact key. Handled centrally so totems stay presentational.
   *
   * **The decision moved out of here and into `totemAction`, and that is the point
   * of the change rather than a tidy-up.** This handler is the one place every
   * lesson in the game passes through, and until the first mini-game it had no
   * branches at all: press E, complete whatever totem you are standing at. Adding
   * a branch here is the highest-leverage way to break four working lessons, in a
   * way that only shows up by walking to each totem in turn.
   *
   * `totemAction` is pure, takes the lesson table as an argument, and is swept over
   * every lesson id in `lessonRoutes.test.ts`. What is left here is the side
   * effects, which is the half a test could not have covered anyway.
   */
  const onInteract = useCallback(() => {
    if (covering) return
    /*
      **Unconditional, and taken before anything is decided.**

      This handler's own comment warns that "adding a branch here is the
      highest-leverage way to break four working lessons". That warning is about
      BRANCHES. This is one side effect with no lesson-dependent behaviour, taken
      whether or not the totem leads anywhere, and it is here because a keydown is
      a user activation gesture and this is the only one that reaches the training
      round from outside it.

      It exists for the returning player who has already said yes to sound and
      should not be asked again: `unlock()` returns early once the answer is
      `'declined'`, and a first-time player unlocks from the gate's own button
      instead. See `src/audio/voice.ts`.
    */
    unlockVoice()
    const action = totemAction(useGameStore.getState().activeTotemId, LESSONS)
    if (action.kind === 'complete') completeLesson(action.lessonId)
    else if (action.kind === 'travel') doTravel(action.sceneId, action.spawnId, action.label)
  }, [covering, completeLesson, doTravel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.target instanceof Element && (e.target.closest('input, select, textarea, [contenteditable=true]') || (e.code === 'Enter' && e.target.closest('button')))) return
      if (e.code !== 'KeyE' && e.code !== 'Enter') return
      onInteract()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onInteract])

  /**
   * The admin panel's reset, which is the store write plus the one thing the
   * store cannot do for itself.
   *
   * `resetProgress` sets `currentSceneId` back to the hub, but the mounted scene
   * belongs to `useSceneTravel`, which seeds `displayed` from `initial` once and
   * never reads the store again - the direction of truth is world to store, via
   * `onArrive`, and there is no path back. So resetting from inside the cave
   * leaves the canvas in the cave while the HUD, which titles itself from
   * `currentSceneId`, announces the hub and counts the hub's lessons. Nothing
   * throws, the world does not desync from its own idea of where it is, and it
   * silently repairs itself the next time the player walks through a portal -
   * which is exactly the shape of bug that gets shipped.
   *
   * Travelling only when the scene actually differs, and reading the destination
   * out of the store rather than hardcoding 'hub', so this follows
   * INITIAL_PROGRESS if the starting scene ever changes. Already being in the hub
   * needs no travel: the player keeps standing where they are, which is both less
   * disruptive and correct, since travelling to the scene you are already in does
   * not reposition anyone anyway - `displayed.spawnId` is unchanged, `getSpawn`
   * returns the registry's own stable array, and PlayerController's spawn effect
   * never re-runs.
   *
   * The guard on `covering` is not decoration. `travel` refuses a request while
   * one is in flight, so without it a reset issued mid-transition would wipe
   * progress and then quietly fail to move the player, leaving precisely the
   * divergence this function exists to prevent. The panel disables the button for
   * the same reason; this is the half that cannot be styled away.
   */
  const onAdminReset = useCallback(() => {
    if (covering) return
    resetProgress()
    const home = useGameStore.getState()
    if (displayed.sceneId !== home.currentSceneId) {
      travel({ sceneId: home.currentSceneId, spawnId: home.currentSpawnId }, 'Starting over')
    }
  }, [covering, resetProgress, displayed.sceneId, travel])

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
        /*
          Field of view 40, not 55, and this is the single largest contributor
          to the diorama read. A long lens compresses depth, so the background
          layers stop shrinking into irrelevance and start reading as a stage
          set at a known distance: an object 20 m behind the character comes in
          27 per cent larger relative to it.

          `CAMERA.distance` and `CAMERA.height` in tuning.ts are derived from
          this number and hold the character the same size in frame. The three
          move together or the framing is wrong; the arithmetic is in the
          comment above them.
        */
        camera={{ fov: CAMERA.fov, near: 0.1, far: 250, position: [0, 6, 14] }}
        /*
          Tone mapping is disabled on the renderer and applied once at the end of
          the effect chain instead. Leaving it on here means ACES runs twice, once
          into the composer's render target and again on the way out, which
          crushes contrast and washes the whole palette out to pastel.
        */
        /*
          `preserveDrawingBuffer` in development only, because the critique loop
          reads the frame back with `toDataURL`. Without it the browser is free
          to clear the buffer the moment the frame is composited, and a readback
          from a later task returns a fully transparent image - which still
          decodes, still writes a valid PNG, and still looks like evidence.
        */
        gl={{
          antialias: false,
          toneMapping: NoToneMapping,
          preserveDrawingBuffer: import.meta.env.DEV,
        }}
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
                contactTint={CONTACT_TINT[scene.lighting]}
                hidden={playerHidden}
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
              consumeLook={consumeLook}
              inputLocked={inputLocked}
              cameraScale={scene.cameraScale}
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

        {/*
          The screenshot and measurement harness. Outside the Suspense boundary
          and outside Physics on purpose: it is never keyed by scene and has no
          dependency on either, so it stays registered across travel and is
          available while the world is still coming up. Renders null, and
          everything it installs is gated on import.meta.env.DEV.
        */}
        <DevHooks />

        {!FX.disabled && <PostFX />}
      </Canvas>

      <HUD onInteract={onInteract} />
      {/*
        Outside the HUD rather than inside it. The HUD's root is a full-viewport
        `pointerEvents: none` layer whose children opt back in one at a time, and
        an admin surface that has to swallow whole gestures - wheel, drag, keys -
        does not belong in a tree built on the opposite assumption.
      */}
      <TrainingHUD />
      <AudioGate />
      <AdminPanel
        displayedSceneId={displayed.sceneId}
        busy={covering}
        onResetProgress={onAdminReset}
      />
      <Transition active={covering} label={label} />
    </>
  )
}
