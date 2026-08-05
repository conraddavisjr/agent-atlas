import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierContext,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Vector3, type Group } from 'three'
import { BODY, JUMP, MOVEMENT, SQUASH } from './tuning'
import { approachAngle, stepHorizontal, stepVertical } from './movement'
import { RobotModel } from './RobotModel'
import { createRobotAnimState } from './robotAnim'
import type { InputIntent } from '../input/useInput'
import type { SocketName } from '@/state/types'

/** Derived from the world handle so no direct dependency on the rapier package is needed. */
type CharacterController = ReturnType<RapierContext['world']['createCharacterController']>

/**
 * The character controller, built on Rapier's KinematicCharacterController.
 *
 * Kinematic rather than a dynamic rigid body on purpose. A dynamic body gives you
 * physical interactions for free but makes precise platformer feel hard to reach,
 * because every tuning change fights the solver. Kinematic means we own the
 * velocity integration outright and Rapier only handles collision resolution,
 * autostep, and ground snapping.
 *
 * All movement runs in useBeforePhysicsStep, which fires at the fixed physics rate
 * rather than the render rate. This is what makes the feel identical at 60fps and
 * 144fps. Running it in useFrame would make the game subtly easier or harder
 * depending on the player's monitor.
 */
export function PlayerController({
  intent,
  sampleInput,
  endInputFrame,
  spawn,
  cosmetics,
  playerRef,
  inputLocked,
}: {
  intent: React.RefObject<InputIntent>
  sampleInput: () => void
  endInputFrame: () => void
  spawn: [number, number, number]
  cosmetics: Partial<Record<SocketName, string>>
  /** Exposed so the camera can follow without prop-drilling per frame. */
  playerRef: React.RefObject<Group | null>
  inputLocked: React.RefObject<boolean>
}) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const { world } = useRapier()
  const camera = useThree((s) => s.camera)

  const anim = useRef(createRobotAnimState())

  /** Velocity we integrate ourselves, since the body is kinematic. */
  const velocity = useRef(new Vector3(0, 0, 0))
  const coyoteTimer = useRef(0)
  const bufferTimer = useRef(0)
  const wasGrounded = useRef(true)
  const facing = useRef(0)
  const squashVelocity = useRef(0)

  /** Dev-only counters, sampled per physics step. See window.__player. */
  const debug = useRef({ peakY: 0, jumps: 0 })

  /**
   * Scratch vectors, allocated once and mutated every physics step.
   *
   * A ref rather than a memo: these are explicitly mutable per-step buffers, and
   * useMemo values are not allowed to be mutated after render. Allocating inside
   * the step would create garbage at 60Hz and produce visible collection stutter.
   */
  const scratchRef = useRef<{
    desired: Vector3
    camForward: Vector3
    camRight: Vector3
    move: Vector3
    up: Vector3
  } | null>(null)
  if (scratchRef.current === null) {
    scratchRef.current = {
      desired: new Vector3(),
      camForward: new Vector3(),
      camRight: new Vector3(),
      move: new Vector3(),
      up: new Vector3(0, 1, 0),
    }
  }
  const scratch = scratchRef.current

  const controllerRef = useRef<CharacterController | null>(null)

  /**
   * The character controller is a WASM-backed resource, so it is created and
   * destroyed in the same effect. Its lifetime must be tied to the effect, never
   * to a useMemo.
   *
   * Creating it in useMemo and freeing it in an effect cleanup looks equivalent
   * but is not, and breaks the game outright. StrictMode mounts, runs effects,
   * unmounts and remounts. The cleanup frees the controller, but the memo is not
   * recomputed on the remount, so every subsequent physics step calls into freed
   * memory and throws `Cannot read properties of undefined (reading
   * 'computedGrounded')` sixty times a second. StrictMode also double-invokes the
   * memo factory on mount, so the extra controller it creates is never freed.
   *
   * Pairing create and free here makes both problems impossible.
   */
  useEffect(() => {
    const c = world.createCharacterController(BODY.colliderOffset)
    // Autostep lets the robot walk over small ledges instead of being stopped by
    // them, which is the difference between a world that feels solid and one that
    // feels like it is catching on invisible lips.
    c.enableAutostep(BODY.autostepHeight, BODY.autostepMinWidth, true)
    // Snap-to-ground keeps the character glued while walking down slopes. Without
    // it you leave the ground on every downhill and the jump state flickers.
    c.enableSnapToGround(BODY.snapToGroundDistance)
    c.setMaxSlopeClimbAngle(BODY.maxSlopeClimbAngle)
    c.setMinSlopeSlideAngle(BODY.minSlopeSlideAngle)
    c.setApplyImpulsesToDynamicBodies(true)
    c.setCharacterMass(1)
    controllerRef.current = c

    return () => {
      // Cleared before freeing so a physics step that runs between the two can
      // never see a dangling handle.
      controllerRef.current = null
      world.removeCharacterController(c)
    }
  }, [world])

  /** Place the robot at the scene's spawn point on mount. */
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.setNextKinematicTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] })
    body.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true)
    velocity.current.set(0, 0, 0)
    coyoteTimer.current = 0
    bufferTimer.current = 0
  }, [spawn])

  useBeforePhysicsStep(() => {
    const body = bodyRef.current
    const collider = body?.collider(0)
    const controller = controllerRef.current
    // The controller is null before its effect runs and after cleanup. Physics
    // steps can fire in both windows, so this guard is required, not defensive.
    if (!body || !collider || !controller) return

    // Fixed step. Physics is configured with timeStep 1/60 in the Physics component.
    const dt = 1 / 60

    sampleInput()
    const input = intent.current
    const locked = inputLocked.current

    // During a transition the world is being torn down and rebuilt. Reading input
    // here would let the player walk into geometry that no longer exists.
    const moveX = locked ? 0 : input.moveX
    const moveY = locked ? 0 : input.moveY
    const jumpPressed = locked ? false : input.jumpPressed
    const jumpHeld = locked ? false : input.jumpHeld

    const grounded = controller.computedGrounded()

    // ---- Horizontal movement, camera relative ------------------------------
    // Forward always means away from the camera, which is the only scheme that
    // stays intuitive while the camera is orbiting.
    camera.getWorldDirection(scratch.camForward)
    scratch.camForward.y = 0
    scratch.camForward.normalize()
    scratch.camRight.crossVectors(scratch.camForward, scratch.up).normalize()

    scratch.desired
      .set(0, 0, 0)
      .addScaledVector(scratch.camRight, moveX)
      .addScaledVector(scratch.camForward, -moveY)

    const hasInput = scratch.desired.lengthSq() > 0.0001
    if (hasInput) scratch.desired.normalize()

    const targetX = scratch.desired.x * MOVEMENT.maxSpeed
    const targetZ = scratch.desired.z * MOVEMENT.maxSpeed

    velocity.current.x = stepHorizontal(velocity.current.x, targetX, hasInput, grounded, dt)
    velocity.current.z = stepHorizontal(velocity.current.z, targetZ, hasInput, grounded, dt)

    // ---- Vertical: coyote time, buffering, variable height, gravity ---------
    // Delegated to the pure functions in movement.ts, which is where this
    // behaviour is unit tested. Keeping a second copy of the rules inline here
    // would mean the tests verify logic the game does not actually run.
    const vertical = stepVertical(
      { vy: velocity.current.y, coyote: coyoteTimer.current, buffer: bufferTimer.current },
      { grounded, jumpPressed, jumpHeld, dt },
    )
    velocity.current.y = vertical.vy
    coyoteTimer.current = vertical.coyote
    bufferTimer.current = vertical.buffer

    if (vertical.jumped) {
      // Stretch on takeoff. Squash and stretch does more for the toy feel than
      // any material in the game.
      anim.current.squash = SQUASH.takeoffStretch
      squashVelocity.current = 0

      if (import.meta.env.DEV) debug.current.jumps += 1
    }

    if (import.meta.env.DEV) {
      // Sampled per physics step rather than per rendered frame, so a jump arc
      // that completes inside a burst of catch-up steps is still observable.
      const t = body.translation()
      debug.current.peakY = Math.max(debug.current.peakY, t.y)
    }

    // ---- Landing -----------------------------------------------------------
    if (grounded && !wasGrounded.current) {
      const impact = Math.abs(anim.current.verticalVelocity)
      if (impact > SQUASH.minLandSpeed) {
        const strength = Math.min(1, impact / Math.abs(JUMP.maxFallSpeed))
        anim.current.squash = 1 - (1 - SQUASH.landSquash) * strength
        squashVelocity.current = 0
      }
    }
    wasGrounded.current = grounded

    // ---- Resolve movement against the world --------------------------------
    scratch.move.copy(velocity.current).multiplyScalar(dt)
    controller.computeColliderMovement(collider, scratch.move)
    const corrected = controller.computedMovement()

    const t = body.translation()
    body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    })

    // If the solver cancelled our vertical motion we hit a ceiling, so drop the
    // upward velocity rather than pressing into it for the rest of the arc.
    if (velocity.current.y > 0 && corrected.y < scratch.move.y * 0.5) {
      velocity.current.y = 0
    }

    // ---- Feed the animation ------------------------------------------------
    const horizontalSpeed = Math.hypot(velocity.current.x, velocity.current.z)
    anim.current.speedNorm = Math.min(1, horizontalSpeed / MOVEMENT.maxSpeed)
    anim.current.grounded = grounded
    anim.current.verticalVelocity = velocity.current.y

    // Face the direction of travel. Rotating toward movement rather than toward
    // the camera means the robot never moonwalks when strafing.
    if (horizontalSpeed > 0.4) {
      const targetFacing = Math.atan2(velocity.current.x, velocity.current.z)
      facing.current = approachAngle(facing.current, targetFacing, MOVEMENT.turnSpeed * dt)
    }

    endInputFrame()
  })

  /**
   * Visual-only work runs per frame rather than per physics step so it stays
   * smooth at any refresh rate.
   */
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)

    if (visualRef.current) {
      visualRef.current.rotation.y = facing.current
    }

    // Spring the squash back toward neutral. A critically damped spring rather
    // than a lerp, so it overshoots very slightly and reads as springy plastic.
    const displacement = anim.current.squash - 1
    const springForce = -displacement * SQUASH.recovery * SQUASH.recovery
    const damping = -squashVelocity.current * 2 * SQUASH.recovery
    squashVelocity.current += (springForce + damping) * dt
    anim.current.squash += squashVelocity.current * dt

    // Keep the follow target in sync with the interpolated physics transform.
    if (playerRef.current && bodyRef.current) {
      const t = bodyRef.current.translation()
      playerRef.current.position.set(t.x, t.y, t.z)
    }

    if (import.meta.env.DEV) {
      /*
        Dev-only telemetry. Feel tuning is a play-adjust-play loop, and being able
        to read exact velocity, grounded state and timer values beats inferring
        them from how a jump looked. Stripped from production builds.
      */
      const t = bodyRef.current?.translation()
      ;(window as unknown as { __player?: unknown }).__player = {
        x: t?.x, y: t?.y, z: t?.z,
        vx: velocity.current.x, vy: velocity.current.y, vz: velocity.current.z,
        speed: Math.hypot(velocity.current.x, velocity.current.z),
        grounded: anim.current.grounded,
        coyote: coyoteTimer.current,
        buffer: bufferTimer.current,
        squash: anim.current.squash,
        facing: facing.current,
        peakY: debug.current.peakY,
        jumps: debug.current.jumps,
        resetPeak: () => {
          debug.current.peakY = 0
        },
      }
    }
  })

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={spawn}
      // Rotation is driven visually rather than physically; a rotating capsule
      // buys nothing and complicates the collision response.
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider args={[BODY.capsuleHalfHeight, BODY.capsuleRadius]} />
      <group ref={visualRef} position={[0, -(BODY.capsuleHalfHeight + BODY.capsuleRadius), 0]}>
        <RobotModel anim={anim} cosmetics={cosmetics} />
      </group>
    </RigidBody>
  )
}

