import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type Group } from 'three'
import { CAMERA } from '../player/tuning'
import { advanceIris, iris, radiusToCover } from './irisHandle'

/**
 * Keeps the iris overlay centred on the character and sized to the current
 * openness.
 *
 * Lives inside the Canvas because projecting a world position to the screen
 * needs the live camera, and runs in useFrame because it has to agree with what
 * was just rendered. Doing this a frame late is visible: the iris trails the
 * character during exactly the moment it is collapsing onto them.
 *
 * Writes styles imperatively. This is one of the few places where reaching
 * straight for the DOM is correct rather than a shortcut, since the alternative
 * is a state update per frame across the whole tree.
 */
export function IrisTracker({ target }: { target: React.RefObject<Group | null> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const projected = useRef(new Vector3())

  /*
    The dev handle on the render state that used to hang here has moved to
    `src/dev/DevHooks.tsx`, which is also always mounted and never keyed by
    scene, and which is about dev tooling rather than about the iris.
    `window.__scene` still resolves; it is just registered somewhere honest now.
  */

  useFrame(() => {
    const el = iris.el
    if (!el) return

    const focus = target.current
    if (focus) {
      // Aim at the same point the camera looks at rather than at the feet, so
      // the iris closes on the robot's body instead of on the ground below it.
      projected.current.copy(focus.position)
      projected.current.y += CAMERA.lookHeight
      projected.current.project(camera)

      // NDC to CSS pixels. Y is flipped because NDC counts up and CSS counts down.
      iris.x = (projected.current.x * 0.5 + 0.5) * size.width
      iris.y = (1 - (projected.current.y * 0.5 + 0.5)) * size.height
    }
    /*
      When focus is null the last known position is kept deliberately. The
      player unmounts partway through every transition, and resetting to the
      origin here would make the iris jump to a corner at the exact moment it is
      most visible.
    */

    const openness = advanceIris(performance.now())

    // Fully open means fully out of the way. Left visible, the feathered rim
    // would sit as a permanent dark border around the viewport.
    if (openness >= 1) {
      el.style.visibility = 'hidden'
      return
    }
    el.style.visibility = 'visible'

    const radius = openness * radiusToCover(iris.x, iris.y)

    el.style.setProperty('--iris-x', `${iris.x}px`)
    el.style.setProperty('--iris-y', `${iris.y}px`)
    el.style.setProperty('--iris-r', `${radius}px`)
  })

  return null
}
