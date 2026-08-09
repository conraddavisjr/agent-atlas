import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
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
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
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
     * Whether the browser is currently refusing to run the render loop.
     *
     * Chrome stops firing `requestAnimationFrame` altogether when a window is
     * fully occluded, and clamps `setTimeout` to roughly one call a second at
     * the same time. Measured in this project: 0 rAF/s and 0.6 timeouts/s with
     * the window merely covered rather than minimised. A harness built on rAF
     * therefore does not fail, it HANGS, which looks exactly like the renderer
     * having crashed and is the single most confusing failure mode this file
     * has. The README already warns about it; this makes the warning unnecessary
     * for anything driven from a terminal.
     */
    const throttled = () => document.hidden

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
     * Start driving, and STOP THE CLOCK while doing it.
     *
     * The stop is not optional and it is the subtlest thing in this file.
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
     */
    const beginDriven = () => {
      if (drivenActive) return
      drivenActive = true
      clock.stop()
      driven = clock.elapsedTime
      setFrameloop('never')
    }

    const endDriven = () => {
      if (!drivenActive) return
      drivenActive = false
      setFrameloop('always')
      clock.start()
    }

    /**
     * One rendered frame.
     *
     * Microtasks are not throttled, so the driven path runs at whatever rate the
     * machine can render rather than at the display's refresh, and it keeps
     * working with the browser in the background.
     */
    const nextFrame = async () => {
      if (throttled()) {
        beginDriven()
        driven += STEP
        advance(driven)
        await Promise.resolve()
        return
      }
      endDriven()
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }

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
     * negative delta, which is the exact failure `beginDriven` documents.
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
     */
    const capture = async (name: string) => {
      const v = VANTAGES[name]
      if (!v) throw new Error(`unknown vantage "${name}", have: ${Object.keys(VANTAGES).join(', ')}`)
      resume()
      applyVantage(v)
      for (let i = 0; i < 40; i++) await nextFrame()
      freeze(v.time)
      await nextFrame()
      await nextFrame()
      return { vantage: name, judges: v.judges, frozenAt: v.time }
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
     */
    const budgets = async () => {
      const previous = gl.info.autoReset
      gl.info.autoReset = false
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
     * On the driven path there is no vsync to pace against, so each frame is
     * bracketed with `gl.finish()` and what comes back is the time the frame
     * actually costs rather than the time until the next refresh. That is the
     * more useful number of the two: a display-paced loop reports 60 on any
     * machine with headroom and tells you nothing about how much headroom there
     * is. The reported `meanFps` is therefore a CEILING - what the machine could
     * sustain uncapped - and it is flagged as such by `paced`.
     */
    const fps = async (seconds = 5) => {
      const wasFrozen = !clock.running
      resume()
      const driving = throttled()
      const deltas: number[] = []
      if (driving) {
        beginDriven()
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
      } else {
        let last = performance.now()
        const until = last + seconds * 1000
        while (performance.now() < until) {
          await nextFrame()
          const now = performance.now()
          deltas.push(now - last)
          last = now
        }
      }
      if (wasFrozen) freeze(clock.elapsedTime)
      const sorted = [...deltas].sort((a, b) => a - b)
      const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
      // p95 of frame TIME is the slow tail, so it is the p5 of frame RATE.
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      return {
        frames: deltas.length,
        /** False when the numbers are an uncapped ceiling rather than vsync-paced. */
        paced: !driving,
        meanMs: +mean.toFixed(2),
        p95Ms: +p95.toFixed(2),
        meanFps: +(1000 / mean).toFixed(1),
        p95Fps: +(1000 / p95).toFixed(1),
        worstFps: +(1000 / sorted[sorted.length - 1]).toFixed(1),
      }
    }

    /**
     * Resolves once no new shader programs have compiled for a few frames.
     *
     * Shader compilation happens lazily on first sight of a material, so a
     * screenshot taken too early can catch geometry that has not drawn yet.
     */
    const settled = async (quietFrames = 20) => {
      let quiet = 0
      let previous = -1
      for (let i = 0; i < 600 && quiet < quietFrames; i++) {
        await nextFrame()
        const count = gl.info.programs?.length ?? 0
        quiet = count === previous ? quiet + 1 : 0
        previous = count
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
      scene,
      gl,
    }

    // Kept as its own name because it predates this component and is already in
    // the README's debugging notes.
    ;(window as unknown as { __scene?: unknown }).__scene = { scene, gl }

    return () => {
      delete (window as unknown as { __dev?: unknown }).__dev
      delete (window as unknown as { __scene?: unknown }).__scene
    }
  }, [gl, scene, clock, invalidate, advance, setFrameloop])

  return null
}
