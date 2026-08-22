import { useRef, type RefObject } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { PLANK_AT } from './stage'
import { resolveHit } from './quiz'
import { isAiming, type TrainingState } from './trainingMachine'

/**
 * An invisible plane across the quiz, which is where aiming and shooting happen.
 *
 * ## One plane rather than three pickable planks
 *
 * The obvious design is a click handler on each plank. It cannot drive the
 * reticle: when the cursor is BETWEEN two planks - which is most of the time while
 * someone is aiming - no plank is under it, and there is nothing to report. The aim
 * would vanish in the gaps.
 *
 * A single plane spanning the whole target area always has a point under the
 * cursor, so the reticle is continuous and the shot and the crosshair use the same
 * `event.point`. Hit resolution then becomes `resolveHit`, a pure function over
 * that point, rather than a raycast side effect nobody can unit test.
 *
 * ## Why not a manual raycast from an NDC cursor
 *
 * That was the alternative and it needs its own window listeners, which puts a
 * second input path next to `useInput` - the most delicate file in this project,
 * whose wheel handler calls `preventDefault` unconditionally. r3f's own pointer
 * events cost nothing here: the renderer only raycasts objects that HAVE handlers,
 * so this is one extra ray per pointer move, and touch works without a second code
 * path.
 *
 * ## Invisible but pickable, which is a real distinction
 *
 * `visible={false}` on the MATERIAL, not on the object. three skips the draw for an
 * invisible material but `Raycaster` tests `object.visible` - so this costs zero
 * draw calls and stays hittable. Setting `visible={false}` on the mesh instead
 * would make it unpickable and the quiz would silently accept no input at all.
 */
export function AimPlane({
  run,
  onAim,
  onShoot,
}: {
  run: RefObject<TrainingState>
  /** World point under the cursor, every move. Drives the reticle and the bow. */
  onAim: (point: [number, number, number]) => void
  /** Plank index, or null for a miss into open space. */
  onShoot: (plank: number | null, point: [number, number, number]) => void
}) {
  /*
    Throttled to one report per frame. A pointer can fire several `pointermove`
    events between frames, and the aim only needs the newest - reporting all of
    them does the same work three times and can make the bow jitter as it chases
    intermediate positions.
  */
  const lastFrame = useRef(-1)

  const armed = () => {
    const state = run.current
    return !!state && isAiming(state)
  }

  return (
    <mesh
      position={[PLANK_AT[0], PLANK_AT[1], PLANK_AT[2]]}
      rotation={[0, Math.PI, 0]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (!armed()) return
        // `nativeEvent.timeStamp` rather than a frame counter: this handler runs
        // outside the render loop and has no frame number of its own.
        if (e.nativeEvent.timeStamp === lastFrame.current) return
        lastFrame.current = e.nativeEvent.timeStamp
        e.stopPropagation()
        onAim([e.point.x, e.point.y, e.point.z])
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        /*
          `pointerdown` rather than `click`, and on purpose. A click fires on
          release, which puts the arrow a whole press behind the player's intent -
          and on a touch screen, a drag that ends off the plank cancels it
          entirely. A shot should leave when the finger lands.
        */
        if (!armed()) return
        e.stopPropagation()
        const point: [number, number, number] = [e.point.x, e.point.y, e.point.z]
        onShoot(resolveHit(point), point)
      }}
    >
      {/*
        Big enough that the cursor is always over it at this framing, so the aim
        never drops out at the edges of the screen.
      */}
      <planeGeometry args={[14, 9]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}
