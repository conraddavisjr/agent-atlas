import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { Vector3, type Group, type PerspectiveCamera } from 'three'
import { CAMERA } from '../player/tuning'
import { stepCameraYaw } from '../player/movement'
import { cameraFrame, resetCameraFrame } from './cameraFrame'
import { cameraClearance } from './cameraCollision'

/** Follow the robot with damped orbit, manual-look priority, and swept-volume collision. */
export function FollowCamera({
  target,
  consumeLook,
  inputLocked,
  cameraScale,
}: {
  target: React.RefObject<Group | null>
  /**
   * Reads the frame's orbit delta and zeroes it, from the input layer that owns
   * it. See `useInput.consumeLook` for why the consumer clears it rather than the
   * end-of-frame sweep.
   */
  consumeLook: () => { x: number; y: number }
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
  const { world } = useRapier()

  const yaw = useRef(0)
  const pitch = useRef<number>(CAMERA.initialPitch)

  /**
   * Seconds of realignment suppression still owed to a manual orbit.
   *
   * A timer rather than a per-frame flag, because the thing being protected is a
   * camera position the player chose, and they did not stop choosing it the
   * instant their hand stopped moving.
   */
  const manualHold = useRef(0)

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

      **The yaw is published before the return, and leaving it out was expensive.**
      The write at the bottom of this function is the only one there was, so a
      pinned camera left `cameraFrame.yaw` frozen at whatever it last held -
      zero, for a capture session that never moved the camera by hand. Every
      consumer read that stale value for the whole of every screenshot.

      The rim light is the one that mattered. It aims itself at
      `cameraFrame.yaw` by design, because that is exactly the azimuth it needs
      and it saves the lighting rig doing any camera maths. At `hub-backlit`,
      whose entire purpose is to judge the rim and which is deliberately sited
      on the key's own bearing, the rim should have been at 60.9 degrees and was
      instead at 158.9: ninety-eight degrees off, a side light rather than a
      backlight. Two independent reviewers then examined those screenshots and
      both concluded the game had no rim light. It does; no shot ever contained
      it. `camYaw` in the dev telemetry was reading zero for the same reason.
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
      /*
        Azimuth of the direction the camera is now looking, in the same
        convention `stepCameraYaw` uses: measured from +Z toward +X, which is
        `atan2(-forward.x, -forward.z)` for a camera whose local forward is -Z.
      */
      cameraFrame.yaw = Math.atan2(
        override.position[0] - override.lookAt[0],
        override.position[2] - override.lookAt[2],
      )
      // Left false so releasing the pin does not immediately whip the camera
      // round to wherever the robot happens to be pointing.
      initialised.current = false
      // Drained even here. See consumeLook below: the accumulator has exactly one
      // consumer and it must be emptied on every frame that consumer runs, or a
      // pinned or covered beat banks up every pixel of drag and applies the whole
      // sum at once on the frame the pin releases.
      consumeLook()
      return
    }

    const cam = state.camera as PerspectiveCamera
    if (cam.isPerspectiveCamera && cam.fov !== CAMERA.fov) {
      cam.fov = CAMERA.fov
      cam.updateProjectionMatrix()
    }
    const dt = Math.min(delta, 0.05)

    /*
      Read the orbit delta and zero it in the same statement.

      **This function owns the look accumulator.** It used to be cleared by
      `endInputFrame()`, which runs at the end of `useBeforePhysicsStep` - and
      Rapier's stepper is subscribed before this component, so on every frame the
      physics accumulator took a step the delta was zeroed before it was ever
      read. At 60 Hz that is most frames, which is why dragging felt throttled
      rather than broken, and the gamepad right stick was completely dead because
      `sample()` added to it inside the same step that cleared it.

      A value cleared by the thing that reads it cannot be cleared before the
      read, which is why ownership moved here rather than the call order being
      rearranged. There is only one consumer, so there is nothing to share with.
    */
    const look = consumeLook()
    const lookingManually = look.x !== 0 || look.y !== 0

    if (!inputLocked.current) {
      yaw.current += -look.x * CAMERA.mouseSensitivity
      pitch.current += look.y * CAMERA.mouseSensitivity
      pitch.current = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, pitch.current))
    }

    /*
      How long ago the player last moved the camera by hand.

      Realignment is suppressed for `CAMERA.manualHold` after that, rather than
      only on the exact frames a look delta arrived. The old test was
      frame-instantaneous, so the moment a hand paused mid-drag - or on any frame
      that happened to produce no `mousemove` - the spring took 8.8% of the way
      back to behind the character, at a 126 ms half-life. Holding the camera
      anywhere other than directly behind was impossible while moving, which is
      the whole of "I cannot rotate round to see the character's face".
    */
    if (lookingManually) manualHold.current = CAMERA.manualHold
    else manualHold.current = Math.max(0, manualHold.current - dt)

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
        lookingManually: manualHold.current > 0,
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

    const allowed = cameraClearance(world, scratch.lookAt, scratch.dir, idealDistance)

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

    // Damping traces a chord around corners, so check the final position too.
    scratch.dir.copy(camera.position).sub(scratch.lookAt)
    const actualDistance = scratch.dir.length()
    if (actualDistance > 0.001) {
      scratch.dir.multiplyScalar(1 / actualDistance)
      const safeDistance = cameraClearance(world, scratch.lookAt, scratch.dir, actualDistance)
      if (safeDistance < actualDistance) {
        camera.position.copy(scratch.lookAt).addScaledVector(scratch.dir, safeDistance)
      }
    }
    camera.lookAt(smoothLook.current)
  })

  return null
}
