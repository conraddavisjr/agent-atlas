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

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

    const freeze = (t = 0) => {
      clock.stop()
      clock.elapsedTime = t
      invalidate()
    }

    const resume = () => {
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

    /** Frame timing, measured with the clock running. Frozen numbers are meaningless. */
    const fps = async (seconds = 5) => {
      const wasFrozen = !clock.running
      resume()
      const deltas: number[] = []
      let last = performance.now()
      const until = last + seconds * 1000
      while (performance.now() < until) {
        await nextFrame()
        const now = performance.now()
        deltas.push(now - last)
        last = now
      }
      if (wasFrozen) freeze(clock.elapsedTime)
      const sorted = [...deltas].sort((a, b) => a - b)
      const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
      // p95 of frame TIME is the slow tail, so it is the p5 of frame RATE.
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      return {
        frames: deltas.length,
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
  }, [gl, scene, clock, invalidate])

  return null
}
