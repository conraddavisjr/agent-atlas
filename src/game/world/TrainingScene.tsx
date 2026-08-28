import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import { mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { cameraFrame } from '@/game/camera/cameraFrame'
import { useGameStore } from '@/state/gameStore'
import { RETURN_ROUTE } from '@/state/lessonRoutes'
import { useGame } from '@/game/GameContext'
import {
  CAMERA_DAMPING,
  DUMMIES,
  GRID_HALF,
  GRID_STEP,
  PLANK_AT,
  PLAYER_AT,
  STAGE_FOV,
} from '@/game/training/stage'
import { cameraBlend, cameraPose, firstPerson } from '@/game/training/cameraDirector'
import { AimPlane } from '@/game/training/AimPlane'
import { Arrow } from '@/game/training/Arrow'
import { Bow } from '@/game/training/Bow'
import { Reticle } from '@/game/training/Reticle'
import { makeShot, type Shot } from '@/game/training/arrowFlight'
import { CardCube } from '@/game/training/CardCube'
import { TeachingStage } from '@/game/training/TeachingStage'
import { Confetti } from '@/game/training/Confetti'
import { Planks } from '@/game/training/Planks'
import { QUIZ } from '@/game/training/cards'
import { Headline } from '@/game/training/Headline'
import { Instructor } from '@/game/training/Instructor'
import { instructorVisible } from '@/game/training/instructorPath'
import { cycleComplete, formStart, litForm } from '@/game/training/specimen'
import { useTrainingStore } from '@/game/training/trainingStore'
import { preload, reset as resetVoice, speak, speakSegment, stop as stopVoice, unlock } from '@/audio/voice'
import { VOICE } from '@/audio/voiceManifest'
import {
  initialTrainingState,
  stepTraining,
  type Phase,
  type TrainingState,
} from '@/game/training/trainingMachine'

/**
 * The AI training round.
 *
 * ## What this file owns, and what it deliberately does not
 *
 * It owns the stage, the per-frame tick, the camera, and the one way out. Every
 * decision about WHEN something happens is in `trainingMachine.ts`, every decision
 * about WHERE is in `stage.ts`, and every decision about where the camera stands
 * is in `cameraDirector.ts` - all three pure and unit tested. This component is
 * the part that cannot be tested without a browser, and it is kept small for
 * exactly that reason.
 *
 * ## Three leaks this has to clean up, and they are all the same shape
 *
 * `cameraFrame.override`, the input lock, and the round's own store all outlive
 * this component if it unmounts without saying so. `resetCameraFrame` deliberately
 * does NOT clear the override - that is documented at its definition - so a scene
 * that forgets leaves the hub's camera pinned to a mini-game pose, with
 * `cameraFrame.yaw` frozen at a stale value that the rim light then aims itself
 * at. That is the 98-degrees-out bug `FollowCamera` carries a long comment about,
 * and it convinced two reviewers the game had no rim light at all.
 *
 * All three are released in one `useEffect` cleanup rather than at the end of the
 * round, so an error boundary or a hot reload releases them too.
 */
/**
 * The round's dev handle, in the shape `__dev` and `__player` already use.
 *
 * ## Why this is not optional scaffolding
 *
 * The round is a nine-second scripted sequence, and the harness cannot watch it.
 * `__dev.freeze(t)` advances the render loop but hands `useFrame` a delta of a few
 * tenths of a millisecond rather than the timestamp - that is finding 1 in
 * `99-handoff.md`, and it means stepping the clock by hand runs the script at
 * roughly a thousandth of real speed. Two and a half seconds of stepping moved the
 * round 45 ms.
 *
 * So the only way to photograph the wizard mid-flight is to put the round where
 * you want it. `seek` does that: it writes the phase directly, which is legal
 * precisely because `stepTraining` is a pure function of the state it is handed
 * and has no hidden history.
 *
 * DEV only, and it reads rather than drives - the round runs identically whether
 * anything is looking at this or not.
 */
const devRound: {
  state: TrainingState | null
  /** The live aim point and the last shot, for checking a miss that should not be. */
  aim: [number, number, number] | null
  shot: Shot | null
  seek: ((phase: Phase, patch?: Partial<TrainingState>) => void) | null
} = {
  state: null,
  aim: null,
  shot: null,
  seek: null,
}

export function TrainingScene() {
  const { travel } = useGame()
  const setPlayerLocked = useGameStore((s) => s.setPlayerLocked)
  const setPlayerHidden = useGameStore((s) => s.setPlayerHidden)
  const completeLesson = useGameStore((s) => s.completeLesson)
  const publish = useTrainingStore((s) => s.publish)
  const publishNarration = useTrainingStore((s) => s.publishNarration)
  const publishCardDone = useTrainingStore((s) => s.publishCardDone)
  const resetRound = useTrainingStore((s) => s.reset)

  const run = useRef<TrainingState>(initialTrainingState())
  /** Sequence numbers last acted on. See `trainingStore` for why they are counters. */
  const seen = useRef({ advance: 0, bail: 0, form: 0, replay: 0 })
  /** Latched, so the exit can only ever be requested once. */
  const left = useRef(false)
  /** The phase the voice last acted on, so a line is spoken once per beat. */
  const spoke = useRef<Phase>('arriving')
  /** The clause the voice last started, as `card * 3 + index`. */
  const narrating = useRef(-1)
  /** Whether sound was wanted last frame, so un-muting is an edge. */
  const wanted = useRef(false)
  /** Latched too. The completion is written once, on the frame the win lands. */
  const recorded = useRef(false)
  /** The live aim point, shared by the bow, the reticle and the shot. */
  const aim = useRef<[number, number, number]>([PLANK_AT[0], PLANK_AT[1], PLANK_AT[2]])
  /**
   * A shot waiting to be handed to the machine on the next step.
   *
   * `undefined` means no shot this frame; `null` inside the object means a shot
   * that hit nothing. Those are different things now that a miss has an
   * animation, and collapsing them is what made a missed arrow invisible.
   */
  const pendingShot = useRef<{ plank: number | null } | null>(null)
  /**
   * The arrow currently in the air or stuck in a plank.
   *
   * A ref rather than state: it is written from a pointer handler and read from
   * two `useFrame` callbacks, and putting it in React state would re-render the
   * whole scene - and remount the cube's text - on every shot.
   */
  const shot = useRef<Shot | null>(null)

  /* The camera's running pose, smoothed toward the director's target. */
  const camPos = useRef(new Vector3())
  const camLook = useRef(new Vector3())
  const camReady = useRef(false)
  /** Held separately so the exit, which does not retarget, keeps the last fov. */
  const camFov = useRef(STAGE_FOV)

  /*
    Mount and unmount, in one effect.

    The lock goes on here rather than in the tick because the round is not
    controllable at ANY point in it - the brief is explicit that the player has no
    control from arrival onward - so there is no phase that needs to reason about
    it and no chance of a phase forgetting.
  */
  useEffect(() => {
    resetRound()
    run.current = initialTrainingState()

    /*
      **The audio question, asked once, before anything else happens.**

      `'unset'` means this player has never been offered sound - not that they
      declined it - so they get the card. A returning player who said yes gets an
      `unlock()` attempt instead: the E press at the totem was their gesture, and
      `App.tsx` has already taken it, so this is only the decode.

      A returning player who said no gets neither, and the mute toggle in the HUD
      is their way back. Without that toggle a single click would be permanent and
      undiscoverable.
    */
    resetVoice()
    const preference = useGameStore.getState().audio
    if (preference === 'unset') {
      useTrainingStore.getState().openGate()
    } else if (preference === 'on') {
      unlock()
      void preload()
    }
    /*
      Seeded from the store AFTER the reset, not from zero.

      `reset()` puts the counters back to zero, so reading them here happens to
      give zero today - but seeding from whatever the store actually holds is what
      makes a replay correct regardless. A round that started with stale sequence
      numbers would read the previous round's last keypress as an edge and skip
      its own first card.
    */
    const counters = useTrainingStore.getState()
    seen.current = {
      advance: counters.advanceSeq,
      bail: counters.bailSeq,
      form: counters.formSeq,
      replay: counters.replaySeq,
    }
    left.current = false
    recorded.current = false
    pendingShot.current = null
    shot.current = null
    setPlayerLocked(true)
    setPlayerHidden(false)

    if (import.meta.env.DEV) {
      /*
        `patch` matters more than it looks. Seeking a PHASE alone leaves `card`
        where it was, so jumping straight to `aiming` shows the quiz beat with the
        cube still square on card 0 - which looks exactly like a cube that failed
        to turn, and cost a real debugging detour before this argument existed.
      */
      devRound.seek = (phase, patch) => {
        run.current = { ...run.current, phase, elapsed: 0, ...patch }
        devRound.state = run.current
      }
      ;(window as unknown as { __training: typeof devRound }).__training = devRound
    }

    return () => {
      setPlayerLocked(false)
      setPlayerHidden(false)
      cameraFrame.override = null
      // Or the wizard carries on talking over the island he just sent you back to.
      stopVoice()
      if (import.meta.env.DEV) devRound.seek = null
    }
  }, [resetRound, setPlayerLocked, setPlayerHidden])

  useFrame((_, delta) => {
    /*
      Clamped. A backgrounded tab returns one enormous delta on its first frame
      back, and an unclamped one would run the whole round's script in a single
      step - the wizard would arrive, speak twice and leave between two frames.
    */
    let dt = Math.min(delta, 1 / 20)

    /*
      **The gate holds the round by handing the machine a delta of zero.**

      Not a new phase and not a new field on `TrainingInput`. `stepTraining` is
      pure and reads `bail` before it reads any timer, so a zero delta freezes
      `elapsed` exactly as wanted AND leaves Escape working - which is the one
      thing a player stuck behind a dialog must be able to do. One line here, no
      change to the machine, and it is testable:
      `stepTraining(s, { bail: true, ... }, 0).phase === 'exiting'`.
    */
    if (useTrainingStore.getState().gateOpen) dt = 0

    /*
      Edges, by comparing sequence numbers rather than by consuming a flag.

      A double press inside one frame bumps the counter twice and is handled on two
      frames; a boolean would lose one of them. See `trainingStore`.
    */
    const store = useTrainingStore.getState()
    const advance = store.advanceSeq !== seen.current.advance
    const bail = store.bailSeq !== seen.current.bail
    seen.current.advance = store.advanceSeq
    seen.current.bail = store.bailSeq

    /*
      **Clicking a key word rewinds the exhibit to that form.**

      The three words were always a progress indicator - all present, one lit, so
      a reader can see the whole argument and their place in it. Making them
      clickable turns the indicator into a control, which is what a reader who
      missed the middle one actually wants.

      It writes `elapsed` because `elapsed` is what drives the cycle: `formCue`
      is a pure function of it, so putting the clock at the top of a form's window
      IS selecting that form. Nothing else has to know.

      Only while reading. During the change-over between cards, or the arrival, the
      clock means something else and a jump would fight it.
    */
    /*
      Replay: put the clock back to the top of the card and let the narration
      restart from its first clause. It writes `elapsed` for the same reason the
      word row does - `formCue` is a pure function of it, so moving the clock IS
      moving the exhibit, and nothing else has to know.
    */
    if (store.replaySeq !== seen.current.replay) {
      seen.current.replay = store.replaySeq
      if (run.current.phase === 'reading') {
        run.current = { ...run.current, elapsed: 0 }
        narrating.current = -1
      }
    }

    if (store.formSeq !== seen.current.form) {
      seen.current.form = store.formSeq
      if (run.current.phase === 'reading') {
        run.current = { ...run.current, elapsed: formStart(run.current.card, store.formWanted) }
      }
    }

    /*
      A shot is consumed here rather than dispatched from the pointer handler.

      `AimPlane` fires outside the render loop, so a click can land between frames -
      or twice between frames. Parking it in a ref and reading it once per step
      means the machine sees at most one shot per frame, which is the invariant
      `stepTraining` is written against and which its own test pins.
    */
    const fired = pendingShot.current
    pendingShot.current = null

    run.current = stepTraining(
      run.current,
      { advance, bail, shot: fired !== null, hit: fired?.plank ?? null, correct: QUIZ.correct },
      dt,
    )
    publish(run.current.phase, run.current.card)

    /*
      The voice, on the phase EDGE.

      One `speak()` when a speech beat begins and one `stop()` when it ends, with
      no synchronisation loop between them - the audio clock and the round's
      accumulated `elapsed` will drift by a few milliseconds over five seconds and
      nothing here is lip-synced, so there is nothing to correct.

      The stop matters more than the start. `speech1` and `speech2` both advance on
      `input.advance` as well as on their timers, so a player who presses Skip
      leaves a wizard talking over the diorama's arrival unless something cuts him
      off. That is the most likely thing a player does to a preamble.
    */
    /*
      **The narration, and the word the highlight is on.**

      A clause begins when its form's window opens, which is also when the form's
      dwell begins - the two are the same event because the dwell IS the clause's
      length. So the edge to watch is the form index changing, not a phase.

      The word index comes from the ROUND's clock rather than from the audio's.
      That is deliberate and it is what makes the highlight work identically with
      the sound off: `local` and the clip's timings are both derived from the same
      baked durations, so they agree by construction, and a player who declined
      the voice still watches the words light up in time with a wizard they cannot
      hear. Reading `AudioContext.currentTime` instead would have made the whole
      feature contingent on an mp3 that is allowed to 404.
    */
    const done = run.current.phase === 'reading' && cycleComplete(run.current.card, run.current.elapsed)
    publishCardDone(done)

    if (run.current.phase === 'reading' && !done) {
      const index = litForm(run.current.card, run.current.elapsed)
      const at = run.current.card * 3 + index
      /*
        Re-speak when the clause changes OR when the player has just turned the
        sound back on. The second half is what makes the toggle work mid-beat: the
        clock never stopped, so the clip has to start at the offset the round has
        already reached rather than from the top.
      */
      const wants = useGameStore.getState().audio === 'on'
      const resumed = wants && !wanted.current
      wanted.current = wants
      if (at !== narrating.current || resumed) {
        narrating.current = at
        speakSegment(
          run.current.card,
          index,
          run.current.elapsed - formStart(run.current.card, index),
        )
      }
      const clip = VOICE.segments.find(
        (s) => s.card === run.current.card && s.index === index,
      )
      if (clip) {
        const local = run.current.elapsed - formStart(run.current.card, index)
        let word = -1
        for (let i = 0; i < clip.words.length; i++) {
          if (local >= clip.words[i].start) word = i
          else break
        }
        publishNarration(at, word)
      }
    } else if (narrating.current !== -1) {
      /*
        The pass is over, or the beat is. Either way the wizard stops rather than
        being talked over by the next thing - the same stop the Skip button takes.
      */
      narrating.current = -1
      stopVoice()
      publishNarration(-1, -1)
    }

    if (run.current.phase !== spoke.current) {
      const previous = spoke.current
      spoke.current = run.current.phase
      if (previous === 'speech1' || previous === 'speech2') stopVoice()
      if (run.current.phase === 'speech1') speak(0)
      if (run.current.phase === 'speech2') speak(1)
    }

    /*
      Hidden for the first-person beats, and driven from the phase rather than
      latched on a transition.

      A latch would need an else-branch for every way out of the quiz, and the
      one that gets forgotten is Escape - which can fire from `aiming` and would
      leave the character invisible back in the hub. Recomputing it every frame
      makes the wrong state unreachable rather than merely unlikely; the store
      only writes when the value actually changes, so this is a comparison per
      frame and nothing else.

      `arming` is included, which is when the camera makes its run from behind
      the player to the player's own eye. Keeping the robot drawn through that
      would fly the lens straight through the back of its head.
    */
    setPlayerHidden(firstPerson(run.current.phase))

    /*
      The completion, written the moment the round is won and BEFORE the exit.

      Two reasons for that order. The store write is synchronous and cannot be
      refused, where `travel` can - so recording first means a transition that gets
      dropped costs the player their ride home, not their progress. And `won`
      latches when the arrow lands rather than when the confetti ends, so a player
      who wins and immediately presses Escape keeps it.

      Evidence rather than a bare flag: `completeLesson` stores it under the lesson
      id, and `hasEvidence` in `lessons.ts` is the seam that could later require it.
      Today the lesson still uses `completedManually`, so this is additive and the
      admin panel's complete-all is untouched.
    */
    if (run.current.won && !recorded.current) {
      recorded.current = true
      completeLesson('what-is-ai', { round: 'v1', shots: run.current.shots })
    }

    /*
      The camera, smoothed toward the director's target with `1 - exp(-k*dt)` -
      `FollowCamera`'s own frame-rate-independent formula rather than a second way
      of doing the same thing.

      Written EVERY frame, because `cameraFrame.override` is a static pose with no
      easing of its own. The first frame snaps rather than easing in from wherever
      the hub left the camera, which would be a swoop across the map.
    */
    /*
      The exit does not retarget. `cameraPose('exiting')` has to return SOMETHING
      because the switch is exhaustive, but using it would swing the camera back
      to the reading pose while the iris closes - and `exiting` is reachable from
      any beat, so there is no one pose that is right. Holding the last target is,
      from all of them.
    */
    const target = run.current.phase === 'exiting' ? null : cameraPose(run.current.phase)
    if (target && !camReady.current) {
      camPos.current.set(...target.position)
      camLook.current.set(...target.lookAt)
      camReady.current = true
      camFov.current = target.fov
    } else if (target) {
      const t = cameraBlend(CAMERA_DAMPING, dt)
      camPos.current.lerp(new Vector3(...target.position), t)
      camLook.current.lerp(new Vector3(...target.lookAt), t)
      camFov.current = target.fov
    }
    cameraFrame.override = {
      position: [camPos.current.x, camPos.current.y, camPos.current.z],
      lookAt: [camLook.current.x, camLook.current.y, camLook.current.z],
      fov: camFov.current,
    }

    /*
      The one way out, latched.

      `travel()` refuses a reentrant call silently - `if (inFlight.current) return`,
      no promise, no callback - so a second request would vanish with nothing
      reporting it. The machine already makes `exiting` a trap state; this ref is
      the second half of the same guard, on the side that has the side effect.
    */
    if (run.current.phase === 'exiting' && !left.current) {
      left.current = true
      travel(RETURN_ROUTE.sceneId, RETURN_ROUTE.spawnId, RETURN_ROUTE.label)
    }

    if (import.meta.env.DEV) {
      devRound.state = run.current
      devRound.aim = aim.current
      devRound.shot = shot.current
    }
  }, /* before FollowCamera's default-priority frame, so the override is fresh */ -1)

  const grid = useMemo(() => buildGrid(), [])
  const phase = useTrainingStore((s) => s.phase)

  return (
    <>
      {/*
        The floor. One fixed body with one explicit collider, exactly as
        `CaveScene` does it - never a trimesh, because Rapier will not follow a
        displaced mesh and this project's colliders are authored by hand.
      */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[GRID_HALF, 0.5, GRID_HALF]} position={[0, -0.5, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[GRID_HALF * 2, GRID_HALF * 2]} />
          {/*
            Clearcoat OFF and the specular lobe cut, overriding the preset.

            `mattePlastic` carries `clearcoat: 0.4`, which is right for a moulded
            object and catastrophic on a fifty-metre plane: the first frame of
            this scene had a blown white streak running the whole length of the
            floor, because a single directional key on an unbroken flat surface
            puts its entire specular lobe in one place with nothing to break it up.

            The deck solved the same problem with `masonry()`, and this is the
            same fix without the brick: `specularIntensity` scales the dielectric
            lobe alone and leaves the diffuse term - so the floor keeps its value
            and loses the sheen. See `masonry()` for why `envMapIntensity` is not
            the lever it looks like.
          */}
          <meshPhysicalMaterial
            {...mattePlastic('#0b1220', { clearcoat: 0, specularIntensity: 0.12 })}
          />
        </mesh>
      </RigidBody>

      {/*
        The grid, as ONE `LineSegments` rather than a texture or a mesh per line.

        A texture would need a resolution decision and would moire at the far edge
        where the lines converge; forty separate meshes would be forty draws. This
        is one draw and one buffer, and lines do not antialias into mush at
        distance the way a thin textured quad does.
      */}
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#1e3358" transparent opacity={0.85} />
      </lineSegments>

      {/*
        The training dummies, as silhouettes at distance.

        Scenery, and cheap on purpose: the brief calls this world "intentional,
        simple", and the player cannot walk over to inspect them. A capsule on a
        post reads as a dummy at fifteen metres and costs two primitives.
      */}
      {DUMMIES.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.75, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.5, 8]} />
            <meshPhysicalMaterial {...mattePlastic(palette.bandFrame)} />
          </mesh>
          <mesh position={[0, 1.85, 0]} castShadow>
            <capsuleGeometry args={[0.26, 0.5, 4, 10]} />
            <meshPhysicalMaterial {...mattePlastic(palette.bandTrim)} />
          </mesh>
        </group>
      ))}

      <Headline run={run} />

      <CardCube run={run} />
      <TeachingStage run={run} />

      <Planks run={run} shot={shot} />
      <Bow run={run} aim={aim} />
      <Arrow run={run} shot={shot} />
      <Reticle run={run} aim={aim} />
      <Confetti run={run} />
      <AimPlane
        run={run}
        onAim={(point) => {
          aim.current = point
        }}
        onShoot={(plank, point) => {
          /*
            EVERY loose is reported, hit or miss, and the shot's whole trajectory
            is recorded here rather than derived later.

            `makeShot` reads the same aim point the reticle was drawn at and the
            same plank `resolveHit` scored, so the arrow the player watches and
            the outcome the round records come from one ray. Deriving the flight
            afterwards from a re-cast ray is the version where a plunger sails
            through a plank the game has already counted as a hit.

            Guarded on the phase because `AimPlane` can fire between the frame the
            machine left `aiming` and the frame this handler sees it - a second
            arrow recorded there would replace the one still in the air.
          */
          if (run.current.phase !== 'aiming') return
          shot.current = makeShot(point, plank)
          pendingShot.current = { plank }
        }}
      />

      {/*
        The instructor stays MOUNTED for the whole round and moves off stage when
        it is done, rather than unmounting.

        Its hat carries a 416-vertex skinned ribbon built in a `useMemo`;
        unmounting would dispose that geometry and rebuild it on the next visit,
        which is a geometry upload in the middle of a beat. Same argument
        `PoolSplash` made for hiding rather than unmounting, and the same one
        `FootThruster` inherited.
      */}
      <group visible={instructorVisible(phase)}>
        <Instructor run={run} />
      </group>
    </>
  )
}

/**
 * The floor grid, as one buffer of line segments.
 *
 * Built once. The lines fade toward the edge by vertex colour rather than by fog,
 * because the stage's fog is tuned for the headline at z 16 and a grid that
 * reached the horizon at full strength would draw the eye to the boundary of the
 * world instead of to the thing standing in it.
 */
function buildGrid(): BufferGeometry {
  const points: number[] = []
  const colors: number[] = []
  const near = [0.42, 0.62, 0.95]
  const far = [0.05, 0.09, 0.16]

  const push = (x: number, z: number) => {
    points.push(x, 0.002, z)
    // Fade on the Chebyshev distance, so the falloff follows the square grid
    // rather than describing a circle inside it.
    const t = Math.min(1, Math.max(Math.abs(x), Math.abs(z)) / GRID_HALF)
    const k = 1 - t * t
    colors.push(near[0] * k + far[0] * (1 - k), near[1] * k + far[1] * (1 - k), near[2] * k + far[2] * (1 - k))
  }

  for (let i = -GRID_HALF; i <= GRID_HALF; i += GRID_STEP) {
    push(i, -GRID_HALF)
    push(i, GRID_HALF)
    push(-GRID_HALF, i)
    push(GRID_HALF, i)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

/** Kept so the module's one export is the scene, per the registry's contract. */
void PLAYER_AT
