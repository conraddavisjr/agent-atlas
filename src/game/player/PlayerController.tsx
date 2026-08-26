import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierContext,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Vector3, type Group } from 'three'
import { AIR_JUMP, BODY, JUMP, MOVEMENT, REVIVAL, SQUASH } from './tuning'
import { SHADOW } from './animTuning'
import { headingVector, stepDrive, stepHorizontal, stepVertical } from './movement'
import { RobotModel } from './RobotModel'
import { ContactBlob } from './ContactBlob'
import { createRobotAnimState, EV, pushEvent, pushSquash } from './robotAnim'
import {
  createAnimRuntime,
  createGroundSample,
  createPose,
  type AnimRuntime,
  type GroundSample,
  type Pose,
} from './robotPose'
import { cameraFrame } from '../camera/cameraFrame'
import type { InputIntent } from '../input/useInput'
import type { SocketName } from '@/state/types'
import { devBridge } from '@/dev/devBridge'

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
  hidden,
  playerRef,
  contactTint,
  inputLocked,
  killY,
  onDeath,
}: {
  intent: React.RefObject<InputIntent>
  sampleInput: () => void
  endInputFrame: () => void
  spawn: [number, number, number]
  cosmetics: Partial<Record<SocketName, string>>
  /**
   * Draw the character or not. See `gameStore.playerHidden` for what it is for.
   *
   * A prop rather than a store read inside this component, matching how
   * `inputLocked` arrives: `App` owns the translation from store state to what
   * the controller does, and this file already has more responsibilities than
   * anything else in the project.
   */
  hidden: boolean
  /** Exposed so the camera can follow without prop-drilling per frame. */
  playerRef: React.RefObject<Group | null>
  /** The contact blob's centre tint, from the scene's light rig. */
  contactTint: string
  inputLocked: React.RefObject<boolean>
  /** Fall below this and the scene kills you. Owned by the scene registry. */
  killY: number
  /** Fired once when the kill plane is crossed. */
  onDeath: () => void
}) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const { world, rapier } = useRapier()

  const anim = useRef(createRobotAnimState())

  /*
    The animation buffers live here rather than inside RobotModel, because the
    contact shadow is not a child of the character and still needs the pose the
    solver produces. One owner, two consumers, no duplicated state.
  */
  const rtRef = useRef<AnimRuntime | null>(null)
  if (rtRef.current === null) rtRef.current = createAnimRuntime(0xa71a5)
  const poseRef = useRef<Pose | null>(null)
  if (poseRef.current === null) poseRef.current = createPose()
  const groundRef = useRef<GroundSample | null>(null)
  if (groundRef.current === null) groundRef.current = createGroundSample()

  /** Velocity we integrate ourselves, since the body is kinematic. */
  const velocity = useRef(new Vector3(0, 0, 0))
  const coyoteTimer = useRef(0)
  const bufferTimer = useRef(0)
  /*
    The double jump's three, kept as refs beside the other two rather than folded
    into one object, because `stepVertical` is a pure function of a state it is
    HANDED and this component is the thing that owns the mutable copy. One ref per
    field is what makes each assignment below traceable to the field it came from.
  */
  const airJumps = useRef<number>(AIR_JUMP.count)
  const thrustTimer = useRef(0)
  const airTimer = useRef(0)
  const wasGrounded = useRef(true)
  const facing = useRef(0)

  /**
   * True from the moment the robot is placed above the spawn until it first
   * touches down. Input stays locked for that window so the fall cannot be
   * steered, which is what makes it read as an arrival rather than as a jump
   * the player somehow started mid-air.
   */
  const reviving = useRef(true)
  /** Latches so a body still below the kill plane cannot fire death every step. */
  const dead = useRef(false)

  /** Dev-only counters, sampled per physics step. See window.__player. */
  const debug = useRef({ peakY: 0, jumps: 0, steps: 0 })

  /**
   * Scratch vectors, allocated once and mutated every physics step.
   *
   * A ref rather than a memo: these are explicitly mutable per-step buffers, and
   * useMemo values are not allowed to be mutated after render. Allocating inside
   * the step would create garbage at 60Hz and produce visible collection stutter.
   */
  const scratchRef = useRef<{
    desired: Vector3
    move: Vector3
    /** The downward ground ray, mutated in place every frame. */
    ray: InstanceType<RapierContext['rapier']['Ray']>
  } | null>(null)
  if (scratchRef.current === null) {
    scratchRef.current = {
      desired: new Vector3(),
      move: new Vector3(),
      ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    }
  }
  const scratch = scratchRef.current

  const controllerRef = useRef<CharacterController | null>(null)

  /** Where the body is seeded: the spawn, lifted by the revival drop height. */
  const dropSpawn = useMemo<[number, number, number]>(
    () => [spawn[0], spawn[1] + REVIVAL.dropHeight, spawn[2]],
    [spawn],
  )

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

  /**
   * Place the robot above the scene's spawn point on mount, so it drops in.
   *
   * The drop is the revival: the character falls the last short stretch into
   * the world while the iris opens around them, then lands with a spring. See
   * REVIVAL in tuning.ts for the height and for why it is not literally 50px.
   */
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const y = spawn[1] + REVIVAL.dropHeight
    body.setNextKinematicTranslation({ x: spawn[0], y, z: spawn[2] })
    body.setTranslation({ x: spawn[0], y, z: spawn[2] }, true)
    velocity.current.set(0, 0, 0)
    coyoteTimer.current = 0
    bufferTimer.current = 0
    reviving.current = true
    dead.current = false
    pushEvent(anim.current.events, EV.Revive, 0, spawn[0], spawn[1], spawn[2], 0, 1, 0, 1, 0)
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
    // Two independent locks. The scene machine owns the first, for the frames
    // where the world is being torn down and rebuilt. The controller owns the
    // second, for the fall on arrival, because only it knows when the feet
    // actually touch down.
    const locked = inputLocked.current || reviving.current

    // During a transition the world is being torn down and rebuilt. Reading input
    // here would let the player walk into geometry that no longer exists.
    const moveX = locked ? 0 : input.moveX
    const moveY = locked ? 0 : input.moveY
    const jumpPressed = locked ? false : input.jumpPressed
    const jumpHeld = locked ? false : input.jumpHeld

    if (import.meta.env.DEV) debug.current.steps += 1

    const grounded = controller.computedGrounded()

    // ---- Turning and driving -----------------------------------------------
    /*
      Tank controls. Left and right rotate the robot where it stands; forward
      and back drive it along whatever direction it is now pointing. Held
      together they arc, without either being a special case.

      Facing is state here, not a reading taken from velocity. That is what
      makes turning on the spot possible at all: a heading recovered from
      velocity can only ever report where the character has already been.
    */
    const previousFacing = facing.current
    const drive = stepDrive({ moveX, moveY, facing: facing.current, dt })
    facing.current = drive.facing

    const heading = headingVector(facing.current)
    scratch.desired.set(heading.x * drive.throttle, 0, heading.z * drive.throttle)

    const hasInput = Math.abs(drive.throttle) > 0.0001
    // Already a unit heading scaled by throttle, so normalising would throw the
    // throttle away and make a nudge accelerate as hard as a full press.
    if (hasInput) scratch.desired.normalize().multiplyScalar(Math.abs(drive.throttle))

    /*
      Published for the camera, which realigns only while the player is driving.
      Turning counts even at a standstill, because a rotation on the spot is
      exactly when the camera most needs to come round.
    */
    cameraFrame.following = hasInput || moveX !== 0

    const targetX = scratch.desired.x * MOVEMENT.maxSpeed
    const targetZ = scratch.desired.z * MOVEMENT.maxSpeed

    velocity.current.x = stepHorizontal(velocity.current.x, targetX, hasInput, grounded, dt)
    velocity.current.z = stepHorizontal(velocity.current.z, targetZ, hasInput, grounded, dt)

    // ---- Vertical: coyote time, buffering, variable height, gravity ---------
    // Delegated to the pure functions in movement.ts, which is where this
    // behaviour is unit tested. Keeping a second copy of the rules inline here
    // would mean the tests verify logic the game does not actually run.
    const vertical = stepVertical(
      {
        vy: velocity.current.y,
        coyote: coyoteTimer.current,
        buffer: bufferTimer.current,
        airJumps: airJumps.current,
        thrust: thrustTimer.current,
        air: airTimer.current,
      },
      { grounded, jumpPressed, jumpHeld, dt },
    )
    velocity.current.y = vertical.vy
    coyoteTimer.current = vertical.coyote
    bufferTimer.current = vertical.buffer
    airJumps.current = vertical.airJumps
    thrustTimer.current = vertical.thrust
    airTimer.current = vertical.air

    const t0 = body.translation()

    if (vertical.jumped) {
      // Stretch on takeoff. Squash and stretch does more for the toy feel than
      // any material in the game. The recovery is the solver's; this states only
      // how far and on which of the three spring profiles.
      pushSquash(anim.current, SQUASH.takeoffStretch, 'takeoff')

      /*
        One push, several consumers. The solver reads it here to snap the
        antenna and lift the head; the VFX system will read the same slot for
        the jump puff without either of them knowing about the other.
      */
      const launch = Math.min(1, Math.abs(velocity.current.y) / JUMP.velocity)
      pushEvent(
        anim.current.events, EV.Jump, anim.current.groundTime,
        t0.x, t0.y - 0.7, t0.z,
        0, 1, 0,
        launch, bufferTimer.current > 0 ? 1 : 0,
      )

      if (import.meta.env.DEV) debug.current.jumps += 1
    }

    /*
      The second jump, and the thruster burn it lights.

      A separate block from the ground jump above rather than a branch inside it,
      because almost nothing is shared: there is no takeoff stretch from a surface
      the character is not touching, the squash profile would be wrong, and the
      event is a different kind. What IS shared is the payload convention, so the
      two read the same way at the consumer.

      `EV.AirJump` carries the burn's own duration in the first payload slot,
      where `EV.Jump` carries a normalised launch. A consumer that wants to run a
      one-shot flash needs to know how long the sustain after it will last, and
      reading `AIR_JUMP.thrustTime` at the consumer would be a second copy of a
      tunable that has to match this one.
    */
    if (vertical.airJumped) {
      pushSquash(anim.current, SQUASH.takeoffStretch, 'takeoff')
      // The VFX clock, restarted here and nowhere else. See `thrustAge`.
      anim.current.thrustAge = 0
      pushEvent(
        anim.current.events, EV.AirJump, anim.current.groundTime,
        t0.x, t0.y - 0.7, t0.z,
        0, 1, 0,
        AIR_JUMP.thrustTime, vertical.airJumps,
      )
      if (import.meta.env.DEV) debug.current.jumps += 1
    }

    if (import.meta.env.DEV) {
      // Sampled per physics step rather than per rendered frame, so a jump arc
      // that completes inside a burst of catch-up steps is still observable.
      debug.current.peakY = Math.max(debug.current.peakY, t0.y)
    }

    // ---- Landing -----------------------------------------------------------
    if (grounded && !wasGrounded.current) {
      if (reviving.current) {
        /*
          The revival landing ignores impact speed and squashes to a fixed
          depth. Scaling it by velocity the way an ordinary landing does would
          make the bounce depend on REVIVAL.dropHeight, so tuning the drop for
          how it looks would silently retune how the landing feels.

          There is still no separate bounce animation: the rebound is the
          recovery spring overshooting on its way back to neutral. What is new
          is that it now does. REVIVAL.landSquash's comment has promised that
          bounce since it was written, against a spring damped at exactly 1.0,
          which by definition cannot overshoot. The 'revival' profile is
          underdamped at zeta 0.55, so the promise is finally kept.
        */
        pushSquash(anim.current, REVIVAL.landSquash, 'revival')
        pushEvent(
          anim.current.events, EV.Land, anim.current.airTime,
          t0.x, t0.y - 0.7, t0.z,
          0, 1, 0,
          1, 1,
        )
        reviving.current = false
      } else {
        const impact = Math.abs(anim.current.verticalVelocity)
        if (impact > SQUASH.minLandSpeed) {
          const strength = Math.min(1, impact / Math.abs(JUMP.maxFallSpeed))
          pushSquash(anim.current, 1 - (1 - SQUASH.landSquash) * strength, 'land')
          pushEvent(
            anim.current.events, EV.Land, anim.current.airTime,
            t0.x, t0.y - 0.7, t0.z,
            0, 1, 0,
            strength, 0,
          )
        }
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
      pushEvent(
        anim.current.events, EV.Bonk, anim.current.airTime,
        t.x, t.y + 0.7, t.z,
        0, -1, 0,
        Math.min(1, velocity.current.y / JUMP.velocity), 0,
      )
      velocity.current.y = 0
    }

    // ---- Kill plane --------------------------------------------------------
    // Latched, because the body keeps falling for the whole close of the iris
    // and would otherwise re-fire death on every step of the way down.
    if (!dead.current && t.y + corrected.y < killY) {
      dead.current = true
      pushEvent(
        anim.current.events, EV.Death, anim.current.airTime,
        t.x, t.y, t.z,
        0, 1, 0,
        1, 0,
      )
      onDeath()
    }

    // ---- Feed the animation ------------------------------------------------
    const horizontalSpeed = Math.hypot(velocity.current.x, velocity.current.z)
    anim.current.speedNorm = Math.min(1, horizontalSpeed / MOVEMENT.maxSpeed)
    anim.current.grounded = grounded
    anim.current.verticalVelocity = velocity.current.y
    /*
      Turn and throttle come from the input rather than from velocity, and they
      have to. A pivot on the spot produces no velocity at all, so anything
      derived from it reports a stationary character and the robot rotates with
      its feet planted. These two are what let the model animate a turn.
    */
    anim.current.turnNorm = moveX
    anim.current.throttle = drive.throttle

    /*
      Everything the solver and the effects need about where the body is,
      copied once per step.

      Copied rather than read on demand so that no consumer has to call into
      Rapier. The contact shadow, the foot IK and eventually the emitters all
      want the same six numbers, and three separate `translation()` calls per
      frame is three WASM boundary crossings for data that cannot have changed
      between them.
    */
    anim.current.facing = facing.current
    anim.current.turnRate = (facing.current - previousFacing) / dt
    anim.current.worldX = t.x + corrected.x
    anim.current.worldY = t.y + corrected.y
    anim.current.worldZ = t.z + corrected.z
    anim.current.velX = velocity.current.x
    anim.current.velY = velocity.current.y
    anim.current.velZ = velocity.current.z
    anim.current.reviving = reviving.current
    // Copied from the solver rather than integrated here, for the reason the
    // field's own doc gives: one clock drives both the lift and the beams.
    anim.current.thrust = thrustTimer.current
    anim.current.thrustAge += dt
    if (grounded) {
      anim.current.airTime = 0
      anim.current.groundTime += dt
    } else {
      anim.current.airTime += dt
      anim.current.groundTime = 0
    }

    /*
      Facing is not recomputed here any more. It was previously read back from
      velocity, which is what made it lag the input and made turning on the spot
      impossible; it is now set directly by stepDrive at the top of this step.
    */

    endInputFrame()
  })

  /**
   * Visual-only work runs per frame rather than per physics step so it stays
   * smooth at any refresh rate.
   */
  useFrame(() => {
    if (visualRef.current) {
      visualRef.current.rotation.y = facing.current
    }

    /*
      The squash spring used to be integrated here, and it has moved into the
      solver in robotPose.ts.

      Two reasons. It was untestable in a useFrame, and it was wrong: the form
      was `-x * w^2` against `-v * 2 * w`, which is a damping ratio of exactly
      1.0, while the comment above it claimed it "overshoots very slightly and
      reads as springy plastic". A critically damped spring has zero overshoot
      by definition, so that bounce had never happened. Second, a landing moves
      eleven joints and they all have to recover together or the beat reads as
      eleven things happening near each other; one spring in the solver can
      drive all of them, and a spring in here can only drive the scale.
    */

    /*
      The ground ray. One per frame, on every tier.

      Three consumers pay for it: the contact shadow's position and orientation,
      the foot IK's reference plane, and eventually the emitters' ground point
      and normal for dust and impact rings. That is why `GroundSample` is a
      named type handed to the solver rather than the shadow quietly doing its
      own cast, and it is why the ray lives here rather than in whichever
      component happened to need it first.

      Run in the frame loop rather than the physics step, because the shadow has
      to sit under the INTERPOLATED position the player can see. Sampling it at
      the fixed rate would make the shadow stutter against a character that does
      not, which is more visible than either error alone.
    */
    const ground = groundRef.current!
    const body = bodyRef.current
    const collider = body?.collider(0)
    if (body && collider) {
      const t = body.translation()
      /*
        Origin 0.10 above the sole plane, which is `capsuleHalfHeight +
        capsuleRadius` below the body centre.

        `filterExcludeCollider` is mandatory, not defensive. Without it the ray
        starts inside the character's own capsule, and with `solid = true`
        Rapier reports an immediate hit on the player at distance zero. The
        shadow then pins to the character's feet and never moves, which looks
        almost right and is completely wrong.
      */
      scratch.ray.origin.x = t.x
      scratch.ray.origin.y = t.y - 0.6
      scratch.ray.origin.z = t.z
      const hit = world.castRayAndGetNormal(
        scratch.ray,
        SHADOW.maxCastDistance,
        true,
        undefined,
        undefined,
        collider,
      )
      if (hit) {
        ground.hit = true
        ground.y = scratch.ray.origin.y - hit.timeOfImpact
        // The ray starts 0.10 above the sole, so that much of the impact is the
        // gap the character is standing in rather than height off the ground.
        ground.distance = Math.max(0, hit.timeOfImpact - 0.1)
        ground.nx = hit.normal.x
        ground.ny = hit.normal.y
        ground.nz = hit.normal.z
      } else {
        ground.hit = false
        ground.distance = SHADOW.maxCastDistance
      }
    }

    // Keep the follow target in sync with the interpolated physics transform.
    if (playerRef.current && bodyRef.current) {
      const t = bodyRef.current.translation()
      playerRef.current.position.set(t.x, t.y, t.z)
      /*
        Publish the heading too. The follow target is the one thing the camera
        already holds a reference to, so writing facing onto it is what lets the
        camera swing round behind the player without a per-frame prop or a
        second subscription. The visual group above uses the same value.
      */
      playerRef.current.rotation.y = facing.current
    }

    if (import.meta.env.DEV) {
      /*
        The VISUAL group, not the follow target. `playerRef` carries position
        and heading for the camera and has no renderable children at all, so a
        bounding box taken from it comes back empty - which is exactly what
        happened, and it reported "no character" rather than "wrong object".

        Published per frame rather than once in an effect, because the ref is
        not guaranteed to be populated at the moment an effect with a stable
        dependency list runs, and that effect never runs again to correct it.
        A single assignment is cheaper than the bug it avoids.
      */
      devBridge.playerObject = visualRef.current

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
        /*
          Physics steps taken since mount.

          Here because "the character did not move" and "the character was never
          asked to move" look identical from outside and have opposite fixes.
          The screenshot harness teleports the capsule and expects it to fall the
          rest of the way; when it did not, every other reading - position,
          velocity, grounded - was a plausible-looking value left over from the
          last step that actually ran, and there was nothing to distinguish a
          settled character from a frozen one.
        */
        steps: debug.current.steps,
        coyote: coyoteTimer.current,
        buffer: bufferTimer.current,
        /*
          The depth and profile of the last squash impulse, not the live scale.
          The live value is the solver's spring and is visible on the character
          itself; what is useful here is what was asked for, because a landing
          that looks wrong is nearly always a wrong depth rather than a wrong
          recovery.
        */
        squash: anim.current.squash,
        squashMode: anim.current.squashMode,
        squashSeq: anim.current.squashSeq,
        /*
          Events pushed, and events a consumer fell behind far enough to lose.
          Exposed so a stall is visible rather than silent; the ring drops on
          purpose rather than blocking the producer, and a dropped dust puff is
          nothing, but a steadily climbing counter is a real problem.
        */
        events: anim.current.events.head,
        eventsDropped: anim.current.events.dropped,
        facing: facing.current,
        reviving: reviving.current,
        dead: dead.current,
        /*
          The camera's angle and whether it is currently chasing. `camYaw`
          against `facing` is the question worth asking now: half a turn apart
          means the camera has caught up.
        */
        camYaw: cameraFrame.yaw,
        following: cameraFrame.following,
        peakY: debug.current.peakY,
        jumps: debug.current.jumps,
        resetPeak: () => {
          debug.current.peakY = 0
        },
      }
    }
  })

  /*
    Let the screenshot harness place the character.

    Registered here rather than reached into from outside because the body is
    kinematic: the controller integrates the velocity itself, so a teleport that
    only moved the body would leave the two disagreeing and the character would
    slide back under its own momentum. Zeroing velocity and clearing the death
    latch is what makes the move actually stick.
  */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    devBridge.teleport = (x, y, z, nextFacing) => {
      /*
        Both calls are needed, and setNextKinematicTranslation alone silently
        does nothing here.

        It sets where the body should be after the next step, but this
        controller opens every step by reading the body's CURRENT translation
        and setting the next one to current-plus-movement. So a pending target
        is overwritten before it is ever applied. setTranslation moves the body
        now, which is what the following step then reads.
      */
      bodyRef.current?.setTranslation({ x, y, z }, true)
      bodyRef.current?.setNextKinematicTranslation({ x, y, z })
      velocity.current.x = 0
      velocity.current.y = 0
      velocity.current.z = 0
      if (nextFacing !== undefined) facing.current = nextFacing
      dead.current = false
      anim.current.squash = 1
    }
    return () => {
      devBridge.teleport = null
    }
  }, [])

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        // The drop height is applied here as well as in the effect above. The
        // effect runs after the first commit, so seeding the body at ground level
        // would render one frame of the robot standing at the spawn before it
        // teleports up to fall, which is visible as a flicker.
        position={dropSpawn}
        // Rotation is driven visually rather than physically; a rotating capsule
        // buys nothing and complicates the collision response.
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider args={[BODY.capsuleHalfHeight, BODY.capsuleRadius]} />
        {/*
          `visible` on the VISUAL group only, never on the body.

          The collider, the kinematic controller and the whole animation pipeline
          keep running while the character is hidden - three skips the draw for an
          invisible subtree and nothing else changes. Unmounting `RobotModel`
          instead would dispose the cape ribbon and every geometry the rig owns
          and rebuild them on the way back, which is a stall in the middle of
          whatever beat asked for the character to reappear.
        */}
        <group
          ref={visualRef}
          position={[0, -(BODY.capsuleHalfHeight + BODY.capsuleRadius), 0]}
          visible={!hidden}
        >
          <RobotModel anim={anim} cosmetics={cosmetics} rt={rtRef} pose={poseRef} ground={groundRef} />
        </group>
        </RigidBody>

      {/*
        Outside the RigidBody, and that is the whole point.

        Under the character's root the quad would inherit the squash scale, and
        a shadow that squashes with the body is the classic tell of a fake
        contact shadow. It is positioned in world space from the ray above.
      */}
      <ContactBlob pose={poseRef} color={contactTint} />
    </>
  )
}

