import { useEffect } from 'react'
import { useStore, useThree } from '@react-three/fiber'
import { Box3, Vector3, type PerspectiveCamera } from 'three'
import { cameraFrame } from '@/game/camera/cameraFrame'
import { devBridge } from './devBridge'
import { VANTAGES, type Vantage } from './vantages'

/**
 * The screenshot and measurement harness, exposed on `window.__dev`.
 *
 * This exists because "is it better" was not previously a question anyone could
 * answer. The camera springs and orbits, the grass moves, and the player is
 * wherever they were left, so no two captures were comparable.
 *
 * **Freezing works, and it is worth knowing exactly why.** three's `Clock.stop`
 * sets both `running` and `autoStart` to false, and R3F's loop calls
 * `clock.getDelta()` once and hands that value to every `useFrame` subscriber.
 * So a stopped clock returns a delta of zero permanently, and `elapsedTime`
 * stops advancing. Everything animated in this project reads one or the other:
 * the grass and flower wind, the portal spiral and the totem bob all sample
 * `elapsedTime`, and the camera damping, rapier stepping and cloud drift all
 * integrate `delta`. One call pins the entire world at a reproducible phase.
 *
 * The one thing it does not pin is the iris, which runs on `performance.now()`,
 * but that settles fully open and then stays there.
 *
 * Mounted inside the Canvas and never keyed by scene, so it survives travel.
 * Development only, and the whole component returns null in production.
 */
export function DevHooks() {
  const store = useStore()
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const clock = useThree((s) => s.clock)
  const invalidate = useThree((s) => s.invalidate)
  const advance = useThree((s) => s.advance)
  const setFrameloop = useThree((s) => s.setFrameloop)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    /**
     * The step used when the loop is driven by hand, in seconds.
     *
     * Exactly 1/60 rather than whatever wall clock happened to elapse, which is
     * the whole reason the driven path is the more reproducible of the two.
     */
    const STEP = 1 / 60

    /**
     * The hand-driven clock, in seconds, kept in step with `clock.elapsedTime`.
     *
     * r3f's `update()` computes `delta = clock.getDelta()` normally, but under
     * `frameloop: 'never'` it uses `timestamp - clock.elapsedTime` instead and
     * writes the timestamp back. So passing monotonically increasing seconds is
     * what makes a driven frame indistinguishable from a real one to every
     * `useFrame` subscriber, the physics step and the effect composer alike, and
     * passing the SAME value twice is what produces a delta of zero - which is
     * how freezing works on this path, since `clock.stop()` is bypassed by that
     * branch entirely.
     */
    let driven = 0
    let drivenActive = false

    /**
     * Triangles submitted by a frame of the fully-arrived scene.
     *
     * Recorded by `settled()` and used by `capture()` as the yardstick for "is
     * the world in this shot". An absolute threshold would have to be tuned per
     * scene and per tier and would rot; a proportion of what this same scene
     * managed a moment ago does not.
     *
     * Zero means nothing has settled yet, in which case the check is skipped
     * rather than guessed at.
     */
    let referenceTriangles = 0

    /**
     * Take the loop over, and keep it taken over.
     *
     * Called at the top of every driven frame rather than once, because both of
     * the things it establishes get quietly undone from underneath it.
     *
     * The clock stop is not optional and it is the subtlest thing in this file.
     * r3f's `update()` opens with `let delta = state.clock.getDelta()`
     * unconditionally, and only then does the `frameloop === 'never'` branch
     * overwrite `delta`. `Clock.getDelta()` on a RUNNING clock does not merely
     * report elapsed wall time, it ADDS it to `elapsedTime`. So with the clock
     * left running, every driven frame first advanced `elapsedTime` by however
     * long the harness had been sitting between calls - which, driven from a
     * terminal, is seconds - and the branch then computed
     * `delta = timestamp - elapsedTime` as a large NEGATIVE number.
     *
     * That is not a cosmetic error. `Grass.tsx` damps its player-follow point
     * with `1 - Math.exp(-rate * delta)`, which at delta -0.5 and rate 20 is
     * about -12,000, so the follower extrapolated away from the player, then
     * further on the next frame, reached Infinity, and became NaN the moment
     * two infinities were subtracted. A NaN in a vertex shader discards every
     * triangle it touches, so the entire vegetation layer vanished while still
     * reporting 163,956 live instances and 1.3M submitted triangles. It was
     * invisible in the frame and invisible in the counters, which is precisely
     * the failure the art bible's section 4 was written about.
     *
     * A stopped clock returns a delta of 0 from `getDelta()` and leaves
     * `elapsedTime` alone, so the branch's arithmetic is exactly the intended
     * `timestamp - previousTimestamp` and nothing else can get at the clock.
     *
     * **And it has to be re-asserted every single frame.** `frameloop` is a
     * prop of `<Canvas>`, and r3f's `configure` runs on every render of that
     * component with `if (state.frameloop !== frameloop) state.setFrameloop(frameloop)`.
     * The Canvas here passes no `frameloop` prop, so the default `'always'`
     * wins: any React re-render anywhere above the Canvas silently reverts the
     * harness's `setFrameloop('never')`, and `setFrameloop` also calls
     * `clock.start()` and zeroes `elapsedTime` on the way past.
     *
     * What that does is worse than stopping the loop. `advance(timestamp)` goes
     * on being called and goes on rendering, but `update()` only honours the
     * timestamp under `'never'` - otherwise it falls back to
     * `clock.getDelta()`, which on a microtask-driven loop is a few TENTHS OF A
     * MILLISECOND. So every `useFrame` subscriber, the physics accumulator
     * included, receives a delta about two hundred times too small. Forty
     * frames of settling become about two milliseconds of simulated time;
     * Rapier's accumulator never reaches its 1/60 timestep and the world simply
     * stops, while the harness reports forty frames advanced and the counters
     * all look healthy. That is why the character was caught mid-fall in the
     * character shots and why the same vantage came back different twice: the
     * bug's presence depended on whether React happened to re-render the Canvas
     * during the capture.
     */
    const ensureDriven = () => {
      const state = store.getState()
      if (!drivenActive) {
        drivenActive = true
        driven = state.clock.elapsedTime
      }
      if (state.frameloop !== 'never') state.setFrameloop('never')
      /*
        Pin the clock to the previous driven timestamp, whether we just
        re-asserted or not. `setFrameloop` zeroes `elapsedTime` and starts the
        clock, and a running clock makes `update()`'s opening `getDelta()` add
        wall time to `elapsedTime` before the timestamp branch reads it. Both
        are corrected here, so `advance(driven + STEP)` computes exactly STEP.
      */
      state.clock.stop()
      state.clock.elapsedTime = driven
    }

    const endDriven = () => {
      if (!drivenActive) return
      drivenActive = false
      setFrameloop('always')
      clock.start()
    }

    /**
     * One rendered frame, always driven by hand.
     *
     * Microtasks are not throttled, so this runs at whatever rate the machine
     * can render rather than at the display's refresh, and it keeps working
     * with the browser in the background.
     *
     * **Unconditionally driven, and the conditional version it replaces is the
     * most expensive bug this file has had.** It used `requestAnimationFrame`
     * whenever `document.hidden` was false and drove by hand otherwise, on the
     * theory that `document.hidden` tells you whether rAF will fire. It does
     * not. Occlusion and visibility are different things, and a tab that is the
     * active tab of a completely buried window reports `hidden === false` while
     * firing no rAF at all. Every `nextFrame` on that path then awaited a
     * callback that never came, or came in sporadic bursts when something else
     * poked the compositor - so the world advanced a frame every second or so
     * while the harness believed it had advanced forty. Nothing threw. `freeze`
     * was guarded on `drivenActive`, so it stopped issuing its own render too,
     * and `toDataURL` went on returning a valid PNG of whatever had last been
     * drawn: five of six vantages came back as byte-identical pictures of empty
     * sky, and they came back looking exactly like evidence.
     *
     * There was never a reason to prefer rAF here. The driven path is the more
     * reproducible of the two - a fixed 1/60 step rather than whatever wall
     * clock elapsed - and it is the only one that works in every environment
     * the harness runs in. `release()` hands the loop back when a human wants
     * to play.
     */
    const nextFrame = async () => {
      ensureDriven()
      driven += STEP
      advance(driven)
      await Promise.resolve()
    }

    /**
     * Yield to the macrotask queue without paying the throttled-timer tax.
     *
     * A loop of driven frames is a loop of microtasks, and microtasks never let
     * the event loop turn over - so a network response, a WASM instantiation or
     * an image decode sitting in the task queue gets no chance to run no matter
     * how long the loop spins. Anything waiting on the scene to finish arriving
     * has to yield properly or it just burns its timeout.
     *
     * `setTimeout` is the obvious way to do that and the wrong one here: Chrome
     * clamps it to roughly one call a second in a hidden page, so a loop built
     * on it takes a second per iteration. `MessageChannel` posts a real
     * macrotask and is not subject to that clamp, which is the whole reason it
     * is worth the four extra lines.
     */
    const channel = new MessageChannel()
    const pendingYields: Array<() => void> = []
    channel.port1.onmessage = () => pendingYields.shift()?.()
    const yieldToTasks = () =>
      new Promise<void>((resolve) => {
        pendingYields.push(resolve)
        channel.port2.postMessage(null)
      })

    const freeze = (t = 0) => {
      clock.stop()
      clock.elapsedTime = t
      if (drivenActive) {
        // Same timestamp twice gives a delta of exactly zero on the driven path.
        driven = t
        advance(t)
      }
      invalidate()
    }

    /**
     * Let the world run again.
     *
     * On the driven path the clock stays STOPPED and time is carried by the
     * timestamps instead, so this is deliberately not `clock.start()` there.
     * Starting it would zero `elapsedTime` and hand the next driven frame a
     * negative delta, which is the exact failure `ensureDriven` documents.
     */
    const resume = () => {
      if (drivenActive) return
      clock.start()
    }

    const applyVantage = (v: Vantage) => {
      devBridge.teleport?.(v.playerAt[0], v.playerAt[1], v.playerAt[2], v.playerFacing)
      cameraFrame.override = { position: v.position, lookAt: v.lookAt, fov: v.fov }
    }

    /**
     * Frame the named vantage and freeze on it.
     *
     * The settle wait is load-bearing and the order matters: the player is
     * teleported first, then the world is allowed to run for a moment so the
     * landing squash relaxes and the camera arrives, and only then is the clock
     * stopped. Freezing immediately captures whatever mid-spring state the
     * scene happened to be in, which is not reproducible.
     *
     * **It retries, and it says so.** The first capture or two after a page load
     * come back with the world missing from the frame even once `settled()` is
     * happy - the island geometry is still arriving, or the teleport lands after
     * the camera has already been framed. Every one of those still produces a
     * screenshot, and a screenshot of an empty sky is the single most expensive
     * artefact this harness can emit, because it is indistinguishable from
     * evidence. So the frame is checked, retried, and `attempts` is returned:
     * a retry that happened silently would just be the same bug wearing a hat.
     */
    const capture = async (name: string, maxAttempts = 3) => {
      const v = VANTAGES[name]
      if (!v) throw new Error(`unknown vantage "${name}", have: ${Object.keys(VANTAGES).join(', ')}`)

      let stats = frameStats()
      let triangles = 0
      let attempts = 0
      while (attempts < maxAttempts) {
        attempts++
        /*
          The retry goes back through `settled()` rather than simply running the
          forty frames again. Forty driven frames are forty microtasks and cost
          about a millisecond, so a retry that only re-renders asks the same
          question three times inside the same instant and gets the same answer
          three times. What is actually needed is to wait for the world.
        */
        if (attempts > 1) await settled()
        resume()
        applyVantage(v)
        for (let i = 0; i < 40; i++) await nextFrame()
        freeze(v.time)

        /*
          Render the frozen frame until the submitted triangle count holds
          still, and judge that on triangles rather than on the picture.

          The first frames drawn from a camera that has just jumped are not the
          same picture as the ones after. Measured at `hub-backlit`: 91 draw
          calls and 25,858 triangles for the first two frames, then 140 and
          4,838,302 from the third onward - the entire vegetation layer arriving
          late. Every one of those frames screenshots happily, and the early
          ones are a picture of a character standing on bare ground in a game
          whose lawn is its largest surface.

          Comparing the rendered image instead does not work, and it is worth
          saying why so nobody tries it again: with the clock fully stopped the
          mean luma still wobbles by a few tenths frame to frame, so exact
          agreement between consecutive frames never arrives, and loose
          agreement matches the two bad frames to each other. The triangle count
          is exactly stable once the scene is all there, which makes it the only
          honest stop condition available here.
        */
        const wasAutoReset = gl.info.autoReset
        gl.info.autoReset = false
        let stableFrames = 0
        let lastTriangles = -1
        for (let i = 0; i < 120 && stableFrames < 3; i++) {
          gl.info.reset()
          await nextFrame()
          const triangles = gl.info.render.triangles
          const enough = referenceTriangles === 0 || triangles >= referenceTriangles * 0.5
          stableFrames = triangles === lastTriangles && enough ? stableFrames + 1 : 0
          lastTriangles = triangles
        }
        gl.info.autoReset = wasAutoReset
        triangles = lastTriangles

        stats = frameStats()
        /*
          Both conditions, because they catch different misses. `drew` catches
          an empty sky; the triangle floor catches a frame that has the
          character in it and nothing else - which passes `drew` easily, since a
          white robot against sky has all the contrast anyone could ask for.
        */
        if (stats.drew && (referenceTriangles === 0 || triangles >= referenceTriangles * 0.5)) break
      }

      return {
        vantage: name,
        judges: v.judges,
        frozenAt: v.time,
        attempts,
        triangles,
        referenceTriangles,
        ...stats,
      }
    }

    const release = () => {
      cameraFrame.override = null
      resume()
      endDriven()
    }

    /**
     * Draw calls and triangles for one whole frame.
     *
     * `info.render` is reset on every `renderer.render()` call and the effect
     * composer calls it once per pass, so reading it directly reports only the
     * final fullscreen quad. Turning off `autoReset` and resetting manually
     * around a frame is the only way to get the real totals, and getting this
     * wrong reports a scene of two triangles.
     *
     * **Two warm-up frames, not one, and the second one is not padding.** The
     * first frame rendered from a camera that has just moved is not
     * representative: measured at `hub-backlit` it reported 91 calls and 25,858
     * triangles against the 140 and 4,838,302 that every subsequent frame from
     * the identical camera reports. Reading it one frame earlier says the
     * vegetation is not being submitted at all, which is a conclusion this
     * project has drawn wrongly before and spent a long time acting on.
     */
    const budgets = async () => {
      const previous = gl.info.autoReset
      gl.info.autoReset = false
      await nextFrame()
      await nextFrame()
      gl.info.reset()
      await nextFrame()
      const out = {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? 0,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      }
      gl.info.autoReset = previous
      return out
    }

    /**
     * Frame timing, measured with the clock running. Frozen numbers are meaningless.
     *
     * There is no vsync to pace against on the driven loop, so each frame is
     * bracketed with `gl.finish()` and what comes back is the time the frame
     * actually costs rather than the time until the next refresh. That is the
     * more useful number of the two: a display-paced loop reports 60 on any
     * machine with headroom and tells you nothing about how much headroom there
     * is. The reported `meanFps` is therefore a CEILING - what the machine could
     * sustain uncapped - and `paced: false` says so.
     */
    const fps = async (seconds = 5) => {
      const wasFrozen = !clock.running
      resume()
      const deltas: number[] = []
      ensureDriven()
      const until = performance.now() + seconds * 1000
      // One frame in hand, so the first sample does not carry the cost of
      // whatever the caller was doing immediately before.
      driven += STEP
      advance(driven)
      gl.getContext().finish()
      while (performance.now() < until) {
        const start = performance.now()
        driven += STEP
        advance(driven)
        gl.getContext().finish()
        deltas.push(performance.now() - start)
        await Promise.resolve()
      }
      if (wasFrozen) freeze(clock.elapsedTime)
      const sorted = [...deltas].sort((a, b) => a - b)
      const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
      // p95 of frame TIME is the slow tail, so it is the p5 of frame RATE.
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      return {
        frames: deltas.length,
        /** Always false: these are an uncapped ceiling, never vsync-paced. */
        paced: false,
        meanMs: +mean.toFixed(2),
        p95Ms: +p95.toFixed(2),
        meanFps: +(1000 / mean).toFixed(1),
        p95Fps: +(1000 / p95).toFixed(1),
        worstFps: +(1000 / sorted[sorted.length - 1]).toFixed(1),
      }
    }

    /**
     * Resolves once the scene has stopped arriving.
     *
     * Shader compilation happens lazily on first sight of a material, so a
     * screenshot taken too early catches geometry that has not drawn yet - and
     * the shot still writes a valid PNG of an empty sky, which is the failure
     * this whole harness exists to prevent.
     *
     * Two things here are load-bearing and the first version had neither.
     *
     * **Quiet is measured in wall-clock milliseconds, not in frames.** On the
     * driven path a frame is a microtask, so twenty of them pass in about
     * thirty milliseconds. Against a lazily imported scene chunk, a Rapier WASM
     * instantiation or a texture decode - all of which resolve on the network
     * or decoder timeline rather than the render timeline - a twenty-frame wait
     * expires before any of them has had a chance to land, so the old version
     * returned almost immediately and reported the scene settled while it was
     * still empty. Frames are still required as well, because time alone does
     * not guarantee anything was rendered.
     *
     * **It watches geometries and textures, not just programs.** Program count
     * plateaus as soon as the material set is complete, which happens well
     * before the geometry using those materials has finished streaming in.
     * Measured here: programs sat at 27 while geometries were still climbing
     * from 50 to 83.
     *
     * The quiet window has to be long enough to span the *gap between* load
     * stages, not just the tail of one. This scene arrives in two bursts about
     * a second apart - Rapier and the character, then the island - and a
     * 750 ms window settled confidently in the trough between them. Six
     * screenshots of an empty sky came out of that, and every one of them was a
     * valid PNG.
     *
     * **A quiet plateau with an empty frame is not settled, it is early.** Both
     * conditions have to hold at the same time before this returns true, and a
     * plateau that has nothing in shot is a reason to keep waiting rather than
     * a reason to give up. Returning `drew` at the first plateau - which is
     * what the version before this one did - just moved the false positive one
     * layer out: the caller got `false`, ignored it, and screenshotted the sky
     * anyway.
     *
     * The loop yields to the macrotask queue, not just to microtasks. Driven
     * frames are microtasks, so a purely microtask loop spins thousands of
     * times without ever letting a network response, a WASM instantiation or an
     * image decode run - it burns the entire timeout without the thing it is
     * waiting for being given a chance to happen.
     *
     * **What is being SUBMITTED is part of the signature, not just what is in
     * memory.** The two go quiet at different times: the character's geometry
     * and textures are allocated in the first burst, so the memory counters can
     * hold still and the frame can pass `drew` - it has a robot in it, with
     * plenty of contrast - while the island has not arrived and the shot is a
     * character floating in an empty sky. That is the exact picture this
     * harness produced six times over, and the only counter that moved when the
     * island landed was the submitted triangle count, from 25,000 to 4.8
     * million.
     */
    const settled = async (quietMs = 1500, timeoutMs = 30000) => {
      const signature = () =>
        [
          gl.info.programs?.length ?? 0,
          gl.info.memory.geometries,
          gl.info.memory.textures,
          gl.info.render.calls,
          gl.info.render.triangles,
        ].join('/')

      const deadline = performance.now() + timeoutMs
      let previous = ''
      let quietSince = performance.now()

      const wasAutoReset = gl.info.autoReset
      gl.info.autoReset = false

      while (performance.now() < deadline) {
        // A whole frame's worth of render counters, the same way `budgets`
        // gets them: the composer resets `info.render` once per pass, so a
        // naive read reports the final fullscreen quad and nothing else.
        gl.info.reset()
        await nextFrame()
        // Let the loading timeline actually advance between samples.
        await yieldToTasks()

        const current = signature()
        if (current !== previous) {
          previous = current
          quietSince = performance.now()
          continue
        }
        if (performance.now() - quietSince >= quietMs && frameStats().drew) {
          referenceTriangles = gl.info.render.triangles
          gl.info.autoReset = wasAutoReset
          return true
        }
      }
      gl.info.autoReset = wasAutoReset
      return false
    }

    /**
     * Luminance statistics for whatever is currently in the drawing buffer.
     *
     * The point is to be able to prove a capture drew the world rather than the
     * sky. A scene that has not finished streaming in still renders, still
     * reads back, still writes a valid PNG and still looks like evidence - the
     * first low-tier capture set taken through this harness was six shots of an
     * empty background gradient, and nothing anywhere reported a problem.
     *
     * A real frame of this game has both deep shadow and near-white emissive in
     * it, so `min` under about 60 and a spread over about 150 is a cheap and
     * reliable "the world is in shot". Downsampled to 64x36 first, because the
     * question is what is in the frame, not what any pixel is.
     *
     * Requires `preserveDrawingBuffer`, which App.tsx sets in development only.
     */
    const frameStats = () => {
      const canvas = gl.domElement
      const probe = document.createElement('canvas')
      probe.width = 64
      probe.height = 36
      const ctx = probe.getContext('2d')
      if (!ctx) throw new Error('no 2d context for frameStats')
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height)
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data

      let min = 255
      let max = 0
      let sum = 0
      let minAlpha = 255
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        if (luma < min) min = luma
        if (luma > max) max = luma
        sum += luma
        if (data[i + 3] < minAlpha) minAlpha = data[i + 3]
      }
      const pixels = data.length / 4
      return {
        min: +min.toFixed(1),
        max: +max.toFixed(1),
        mean: +(sum / pixels).toFixed(1),
        minAlpha,
        /** False when the frame is flat enough to be a sky-only miss. */
        drew: min < 60 && max - min > 150 && minAlpha === 255,
      }
    }

    /**
     * Where the character actually lands in the frame.
     *
     * `vantages.ts` opens by saying that a vantage which drifts off its subject
     * is worse than no vantage at all, because it still produces a screenshot
     * and the screenshot still looks like evidence. This is the check that makes
     * that statement enforceable instead of aspirational.
     *
     * It caught the case it was written for immediately: `hub-character`, whose
     * job is to judge proportions, the visor and the contact shadow, was framing
     * the character from behind with the head cropped off the top of the frame.
     * The vantage had not moved - the character had, when it was re-proportioned
     * to 2.52 head-heights partway through the art pass, and nothing anywhere
     * re-checked the shots that exist to look at it.
     *
     * `heightFraction` is what the shot is really about: below about 0.2 the
     * character is an incidental detail, above about 0.9 it is cropped or about
     * to be.
     */
    const framing = () => {
      const target = devBridge.playerObject
      if (!target) return null

      const box = new Box3().setFromObject(target)
      if (box.isEmpty()) return null

      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let behind = false
      const corner = new Vector3()

      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        )
        corner.applyMatrix4(camera.matrixWorldInverse)
        if (corner.z > 0) behind = true
        corner.applyMatrix4(camera.projectionMatrix)
        minX = Math.min(minX, corner.x)
        maxX = Math.max(maxX, corner.x)
        minY = Math.min(minY, corner.y)
        maxY = Math.max(maxY, corner.y)
      }

      const round = (n: number) => +n.toFixed(3)
      return {
        /** Fraction of frame height the character spans, 1.0 being edge to edge. */
        heightFraction: round((maxY - minY) / 2),
        /** Screen-space centre in NDC, so 0,0 is the middle of the frame. */
        centre: [round((minX + maxX) / 2), round((minY + maxY) / 2)],
        /** True when any part of the character is outside the frame. */
        clipped: behind || minX < -1 || maxX > 1 || minY < -1 || maxY > 1,
        /** Metres, so a re-proportioning that invalidates a vantage is visible. */
        worldHeight: round(box.max.y - box.min.y),
      }
    }

    /**
     * Mean colour and display luma of a rectangle of the rendered frame.
     *
     * The art bible's section 8 test is a statement about what the eye reads off
     * the screen, and until now the only thing enforcing it was `palette.band()`,
     * which asserts on an albedo hex. Those are not the same measurement and the
     * gap between them is where the whole value structure went: the palette
     * table says the lawn is 0.668 and `palette.test.ts` proves it, while the
     * rendered lawn measures 0.22 to 0.42 because a field of blades shadows
     * itself. Both are correct about different things, and only one of them is
     * the test.
     *
     * Same convention as `palette.displayLuma`: gamma-encoded sRGB, not
     * linearised, because that is what an eyedropper on a screenshot returns.
     *
     * Coordinates are in canvas pixels from the top left.
     */
    const sample = (x: number, y: number, w = 24, h = 24) => {
      const probe = document.createElement('canvas')
      probe.width = w
      probe.height = h
      const ctx = probe.getContext('2d')
      if (!ctx) throw new Error('no 2d context for sample')
      ctx.drawImage(gl.domElement, x, y, w, h, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data

      let r = 0
      let g = 0
      let b = 0
      const pixels = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
      }
      r /= pixels
      g /= pixels
      b /= pixels

      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const bands: Record<string, readonly [number, number]> = {
        gameplay: [0.56, 0.74],
        midground: [0.2, 0.38],
        background: [0.76, 0.86],
      }
      const inBand =
        Object.keys(bands).find((name) => luma >= bands[name][0] && luma <= bands[name][1]) ?? 'none'

      return {
        rgb: [Math.round(r), Math.round(g), Math.round(b)],
        luma: +luma.toFixed(3),
        /** Which of the art bible's three bands this patch lands in, if any. */
        band: inBand,
        /** Positive means warm. The temperature axis, in raw sRGB points. */
        warmth: Math.round(r - b),
      }
    }

    const hud = (visible: boolean) => {
      document.querySelectorAll<HTMLElement>('[data-hud]').forEach((el) => {
        el.style.visibility = visible ? '' : 'hidden'
      })
    }

    ;(window as unknown as { __dev?: unknown }).__dev = {
      freeze,
      resume,
      capture,
      release,
      vantages: () => Object.keys(VANTAGES),
      teleport: (x: number, y: number, z: number, facing?: number) => devBridge.teleport?.(x, y, z, facing),
      hideHud: () => hud(false),
      showHud: () => hud(true),
      budgets,
      fps,
      settled,
      frameStats,
      framing,
      sample,
      /**
       * Where the camera actually ended up, as opposed to where a vantage asked
       * it to go. The two are not the same question, and only one of them can
       * be checked against a screenshot.
       */
      cameraState: () => ({
        position: camera.position.toArray().map((n) => +n.toFixed(3)),
        quaternion: camera.quaternion.toArray().map((n) => +n.toFixed(4)),
        fov: (camera as PerspectiveCamera).isPerspectiveCamera
          ? (camera as PerspectiveCamera).fov
          : null,
        aspect: (camera as PerspectiveCamera).aspect,
        forward: camera.getWorldDirection(new Vector3()).toArray().map((n) => +n.toFixed(4)),
      }),
      scene,
      gl,
      clock,
      /** The hand-driven timestamp, for telling a stalled loop from a frozen one. */
      drivenTime: () => ({ driven, drivenActive, elapsed: clock.elapsedTime, running: clock.running }),
    }

    // Kept as its own name because it predates this component and is already in
    // the README's debugging notes.
    ;(window as unknown as { __scene?: unknown }).__scene = { scene, gl }

    return () => {
      delete (window as unknown as { __dev?: unknown }).__dev
      delete (window as unknown as { __scene?: unknown }).__scene
    }
  }, [store, gl, scene, camera, clock, invalidate, advance, setFrameloop])

  return null
}
