import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { Vector3, type Group, type PerspectiveCamera } from 'three'
import { CAMERA } from '../player/tuning'
import { stepCameraYaw } from '../player/movement'
import { cameraFrame, resetCameraFrame } from './cameraFrame'
import type { InputIntent } from '../input/useInput'

/**
 * Third-person follow camera with spring damping, collision pull-in, and
 * automatic realignment behind the direction of travel.
 *
 * The collision handling is not a later polish item here. Portal scenes are
 * interiors such as caves and rooms, so the camera spends most of its life close
 * to walls. Without a pull-in raycast the player would spend that time looking
 * through geometry at the skybox.
 *
 * Realignment defers to the player without needing a timer. Dragging the mouse
 * suppresses it for exactly the frames the mouse is moving, and moving the
 * character resumes it immediately, which is the behaviour players expect from
 * a third-person platformer: the camera tidies up after you, but never argues
 * while you are actively aiming it.
 *
 * This component owns both angles in cameraFrame. The distinction between them
 * is the difference between a camera that trails the player forever and one
 * that arrives; the reasoning lives in cameraFrame.ts and stepInputYaw.
 */
export function FollowCamera({
  target,
  intent,
  inputLocked,
  cameraScale,
}: {
  target: React.RefObject<Group | null>
  intent: React.RefObject<InputIntent>
  inputLocked: React.RefObject<boolean>
  /**
   * Per-scene multiplier on the rest offset, from `SceneDefinition`.
   *
   * Both components are scaled by it rather than only the distance, which is
   * what preserves the rest pitch: how far down the camera looks is an art
   * decision that belongs to the whole game, and how far back it can sit
   * belongs to the room.
   */
  cameraScale: number
}) {
  const camera = useThree((s) => s.camera)
  const { world, rapier } = useRapier()

  const yaw = useRef(0)
  const pitch = useRef(0.25)

  /*
    The frame is a module singleton, so it outlives this component. Since the
    camera is keyed by scene and its own yaw restarts at zero on every remount,
    the shared copy has to be put back in step or the new scene would resolve
    movement input against the previous scene's orientation.
  */
  useEffect(() => {
    resetCameraFrame(yaw.current)
  }, [])
  const restDistance = CAMERA.distance * cameraScale
  const restHeight = CAMERA.height * cameraScale

  /** Current distance, which eases back out after a collision rather than popping. */
  const distance = useRef<number>(restDistance)

  /**
   * Scratch vectors, allocated once and mutated every frame.
   *
   * A ref rather than a memo: these are explicitly mutable per-frame buffers, and
   * useMemo values are not allowed to be mutated after render. Allocating fresh
   * vectors each frame instead would create garbage at 60Hz and show up as
   * collection stutter.
   */
  const scratchRef = useRef<{
    desired: Vector3
    lookAt: Vector3
    offset: Vector3
    dir: Vector3
  } | null>(null)
  if (scratchRef.current === null) {
    scratchRef.current = {
      desired: new Vector3(),
      lookAt: new Vector3(),
      offset: new Vector3(),
      dir: new Vector3(),
    }
  }
  const scratch = scratchRef.current

  /**
   * The smoothed look target, persisted across frames.
   *
   * Damping the look point separately from the camera position is what stops the
   * view snapping when the player changes direction quickly.
   */
  const smoothLook = useRef(new Vector3())
  const initialised = useRef(false)

  /** Reused collision ray. Rapier's Ray is a plain JS object, so no free is needed. */
  const rayRef = useRef<InstanceType<typeof rapier.Ray> | null>(null)

  useFrame((state, delta) => {
    const focus = target.current
    if (!focus) return

    /*
      A pinned camera short-circuits everything below.

      Placed here rather than by unmounting this component, because it is keyed
      by scene: unmounting and remounting would re-run the first-frame snap on
      release instead of resuming the spring from where it was.

      The camera comes off the frame state rather than the one captured at
      render, because changing the field of view is a property assignment and
      the hooks lint rule rightly objects to mutating a render-scope binding.
    */
    const override = cameraFrame.override
    if (override) {
      const cam = state.camera as PerspectiveCamera
      cam.position.set(override.position[0], override.position[1], override.position[2])
      cam.lookAt(override.lookAt[0], override.lookAt[1], override.lookAt[2])
      if (cam.isPerspectiveCamera && cam.fov !== override.fov) {
        cam.fov = override.fov
        cam.updateProjectionMatrix()
      }
      // Left false so releasing the pin does not immediately whip the camera
      // round to wherever the robot happens to be pointing.
      initialised.current = false
      return
    }

    const dt = Math.min(delta, 0.05)

    // Orbit. Input is already accumulated for the frame by the input layer.
    const lookX = intent.current.lookX
    const lookingManually = lookX !== 0 || intent.current.lookY !== 0

    // Kept as its own value rather than folded straight into yaw, because it is
    // the one part of the camera's rotation that is allowed to move the input
    // frame with it.
    let manualLookDelta = 0

    if (!inputLocked.current) {
      manualLookDelta = -lookX * CAMERA.mouseSensitivity
      yaw.current += manualLookDelta
      pitch.current += intent.current.lookY * CAMERA.mouseSensitivity
      pitch.current = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, pitch.current))
    }

    // ---- Realign behind the direction the robot is pointing ----------------
    /*
      Whether the player is driving comes from the controller rather than from
      measuring how fast the follow target is moving. Under tank controls those
      are different questions: rotating on the spot has no speed at all, and it
      is precisely when the camera most needs to come round.
    */
    if (!inputLocked.current) {
      // Heading is published onto the follow target by PlayerController.
      yaw.current = stepCameraYaw({
        yaw: yaw.current,
        facing: focus.rotation.y,
        following: cameraFrame.following,
        lookingManually,
        dt,
      })
    }

    cameraFrame.yaw = yaw.current

    scratch.lookAt.copy(focus.position)
    scratch.lookAt.y += CAMERA.lookHeight

    // Ideal camera position on a sphere around the look target.
    const horizontal = Math.cos(pitch.current) * restDistance
    scratch.offset.set(
      Math.sin(yaw.current) * horizontal,
      restHeight + Math.sin(pitch.current) * restDistance,
      Math.cos(yaw.current) * horizontal,
    )

    scratch.desired.copy(scratch.lookAt).add(scratch.offset)

    // ---- Collision pull-in -------------------------------------------------
    // Cast from the look target toward the ideal position. If anything is in the
    // way, sit just in front of it.
    scratch.dir.copy(scratch.desired).sub(scratch.lookAt)
    const idealDistance = scratch.dir.length()
    scratch.dir.normalize()

    let allowed = idealDistance

    // The ray is allocated once and mutated, rather than constructed each frame.
    // A fresh Ray plus two vector literals every frame is 180 short-lived objects
    // a second for no benefit, and that garbage shows up as collection stutter in
    // exactly the moments the camera is working hardest.
    if (rayRef.current === null) {
      rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
    }
    const ray = rayRef.current
    ray.origin.x = scratch.lookAt.x
    ray.origin.y = scratch.lookAt.y
    ray.origin.z = scratch.lookAt.z
    ray.dir.x = scratch.dir.x
    ray.dir.y = scratch.dir.y
    ray.dir.z = scratch.dir.z
    // solid = true so a ray starting inside geometry still reports a hit rather
    // than passing straight through and leaving the camera embedded in a wall.
    const hit = world.castRay(ray, idealDistance, true)
    if (hit) {
      allowed = Math.max(CAMERA.minDistance, hit.timeOfImpact - CAMERA.collisionPadding)
    }

    // Pull in immediately to avoid clipping, but ease back out. Snapping outward
    // the instant an obstruction clears is jarring and draws attention to the camera.
    if (allowed < distance.current) {
      distance.current = allowed
    } else {
      distance.current += Math.min(allowed - distance.current, CAMERA.pullOutSpeed * dt)
    }

    scratch.desired.copy(scratch.lookAt).addScaledVector(scratch.dir, distance.current)

    // ---- Spring damping ----------------------------------------------------
    // Frame-rate independent exponential smoothing. The naive lerp(a, b, 0.1)
    // form is tied to frame rate and makes the camera feel different on a 144Hz
    // monitor than on a 60Hz one.
    const posT = 1 - Math.exp(-CAMERA.positionDamping * dt)
    const lookT = 1 - Math.exp(-CAMERA.targetDamping * dt)

    // On the first frame of a scene, snap rather than spring. Otherwise the camera
    // visibly flies in from wherever the previous scene left it.
    if (!initialised.current) {
      camera.position.copy(scratch.desired)
      smoothLook.current.copy(scratch.lookAt)
      initialised.current = true
    } else {
      camera.position.lerp(scratch.desired, posT)
      smoothLook.current.lerp(scratch.lookAt, lookT)
    }

    camera.lookAt(smoothLook.current)
  })

  return null
}
