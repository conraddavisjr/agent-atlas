import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useQuality } from '@/art/useQuality'
import type { QualitySettings } from '@/art/quality'
import {
  AntennaLower,
  AntennaUpper,
  Backpack,
  CapeSurface,
  ChestPanel,
  Diaper,
  EarPod,
  FacePlate,
  Foot,
  Hand,
  HandProp,
  HeadCap,
  HeadShell,
  Shin,
  Torso,
  UpperArm,
} from './robotParts'
import {
  REST,
  stepAnim,
  type AnimRuntime,
  type GroundSample,
  type Pose,
  type Vec3,
} from './robotPose'
import { RobotFace } from './RobotFace'
import { applyPose, createCape, createRigRefs, type RigRefs } from './rig'
import type { RobotAnimState } from './robotAnim'
import type { SocketName } from '@/state/types'

/**
 * The robot, built entirely from primitives.
 *
 * ## The identity goal has been reversed on purpose
 *
 * This comment used to open "Design intent, and the reason it does not resemble
 * Astro", and list the chrome sphere head, the two round blue eyes and the
 * blue-and-white livery as "specifically avoided". All three are now built
 * deliberately, and the same reversal applies to `palette.ts`'s header, to
 * `05-character-vfx.md` section 7 and to the long argument in `RobotFace.tsx`
 * about why a bar carries more range than two panels.
 *
 * The decision on record is to clone the reference's look one-to-one. So: a blue
 * helmet dome with a copper cap on the back of the head, two round cyan lenses on
 * a near-black faceplate, an off-white body, blue bands on white limbs, a lit
 * circle on the back and a lit oval under each sole.
 *
 * **The antenna is the one thing that is ours and it stays.** It is the only
 * asymmetric feature on the model - off-centre at x 0.200 - and asymmetry is what
 * separates a character from a product shot. It is also the most visible piece of
 * secondary motion on the build.
 *
 * What was already borrowed and did not change: a compact frame with a low centre
 * of gravity, and locomotion that reads as a toddler's waddle. The proportions are
 * the whole of it: 1.36 m over a 0.54 m head is 2.52 head-heights, and the head at
 * 0.72 wide is 1.16 times the widest band below the neck. A head wider than the
 * torso at every height is what makes a shape read as an infant rather than as a
 * short adult, and it matters more than the head-height ratio does.
 *
 * This component is the rig and nothing else: which node parents which, and
 * which ref goes where. What the parts are made of is `robotParts.tsx`, the
 * arithmetic is `robotPose.ts`, and writing the result onto these nodes is
 * `rig.ts`.
 */
export function RobotModel({
  anim,
  cosmetics,
  rt,
  pose,
  ground,
}: {
  anim: RefObject<RobotAnimState>
  cosmetics: Partial<Record<SocketName, string>>
  /*
    The animation buffers are owned by PlayerController and handed down, rather
    than created here. The contact shadow is not a child of the character and
    still needs the pose this component's `useFrame` produces, so there is one
    owner above both of them.
  */
  rt: RefObject<AnimRuntime | null>
  pose: RefObject<Pose | null>
  ground: RefObject<GroundSample | null>
}) {
  const quality = useQuality()

  /*
    One struct of node refs rather than a `useRef` each.

    `applyPose` iterates the pose's own joint list, so a node added to the pose
    and forgotten here is a null that it skips, rather than a silent write into
    whichever joint happened to be next.
  */
  const rigRef = useRef<RigRefs | null>(null)
  if (rigRef.current === null) rigRef.current = createRigRefs()

  /*
    The cape's deformable surface, one instance per mounted character.

    NOT a module constant, unlike every other generated geometry in
    `robotParts.tsx`: `skinCapeRibbon` mutates its position and normal buffers
    every frame, so two characters sharing one would fight over the same vertices.
    Built here rather than inside the `Cape` part so it survives the cosmetic being
    unequipped and re-equipped without a fresh GPU allocation, and so the part
    stays a pure description of what the cape is made of. The cost of that choice
    is that a character with no cape still allocates the ribbon: 416 vertices, about
    10 kB of CPU arrays and no GPU upload at all until something renders it. Paid
    knowingly, because the alternative is building a geometry inside the frame in
    which a player equips something.

    `useMemo` with no dependencies rather than `useRef`, because it is a pure
    construction and React may not call it twice for the same mount.

    ## The StrictMode question, asked because this file's neighbours have all been
    ## cut by it

    `main.tsx` renders under `StrictMode`, which mounts effects, tears them down
    and mounts them again. So the cleanup below DOES run once in dev while the
    geometry is still mounted and still being rendered, and the obvious fear is a
    disposed geometry on screen.

    Checked against three's own source rather than assumed, because the answer
    decides whether this needs a guard. `onGeometryDispose` at
    `three.module.js:4223` removes the attribute buffers, deletes the geometry from
    its registry, releases its VAO through
    `bindingStates.releaseStatesOfGeometry`, and removes its own listener.
    `WebGLGeometries.get` then re-registers the listener on the next frame, and
    `WebGLAttributes.update` at line 242 re-creates any buffer whose map entry is
    missing rather than throwing. Dispose followed by continued rendering is
    therefore SELF-HEALING: it costs one 10 kB re-upload in dev and produces no
    wrong frame.

    So this stays a plain dispose with no guard. What it buys is the real case: a
    scene transition unmounts the character for good, and without it three keeps
    the GL buffers forever because a garbage-collected `BufferGeometry` does not
    free them.
  */
  const cape = useMemo(() => createCape(), [])
  useEffect(() => () => cape.geometry.dispose(), [cape])

  useFrame((_, delta) => {
    // Clamp delta so a background tab that resumes after a long pause does not
    // advance the walk cycle by a huge step and snap the limbs. Clamped here
    // rather than inside the solver, so a test can still hand the solver a ten
    // second step and prove it survives one.
    const dt = Math.min(delta, 0.05)
    stepAnim(rt.current!, anim.current, ground.current!, dt, pose.current!)
    applyPose(pose.current!, rigRef.current!)
  })

  return (
    <group ref={(o) => void (rigRef.current!.root = o)}>
      <group ref={(o) => void (rigRef.current!.hips = o)} position={at(REST.hips)}>
        <Diaper quality={quality} />

        <group ref={(o) => void (rigRef.current!.chest = o)} position={at(REST.chest)}>
          <Torso quality={quality} />
          <ChestPanel />

          <group ref={(o) => void (rigRef.current!.backpack = o)} position={at(REST.backpack)}>
            <Backpack />
          </group>

          {/* Back socket, for the cape. Coincident with the backpack, which is
              what the cape hangs off. */}
          <group position={at(REST.capeRoot)}>
            {cosmetics.back === 'cape' && (
              <group
                /*
                  The ribbon is registered on the rig here rather than in the part,
                  and it is nulled on unmount by the same callback. `applyPose`
                  guards on it, so an unequipped cape is four springs still running
                  into nothing rather than a crash.
                */
                ref={(o) => void (rigRef.current!.cape = o ? cape : null)}
              >
                <CapeSurface ribbon={cape} />
              </group>
            )}
          </group>

          <Arm side="L" rigRef={rigRef} quality={quality}>
            {cosmetics.hand_l ? <HandProp /> : <Hand quality={quality} />}
          </Arm>
          <Arm side="R" rigRef={rigRef} quality={quality}>
            {cosmetics.hand_r ? <HandProp /> : <Hand quality={quality} />}
          </Arm>

          {/* A zero-length pivot between chest and head, so the head can spring
              against the torso without inheriting the torso's own lag twice. */}
          <group ref={(o) => void (rigRef.current!.neck = o)} position={at(REST.neck)}>
            <group ref={(o) => void (rigRef.current!.head = o)} position={at(REST.head)}>
              <HeadShell quality={quality} />
              <HeadCap />
              <Face pose={pose} detail={quality.visorDetail} />

              <EarPodNode side="L" rigRef={rigRef} />
              <EarPodNode side="R" rigRef={rigRef} />

              <group ref={(o) => void (rigRef.current!.antennaBase = o)} position={at(REST.antennaBase)}>
                <AntennaLower />
                <group ref={(o) => void (rigRef.current!.antennaMid = o)} position={at(REST.antennaMid)}>
                  <AntennaUpper />
                </group>
              </group>

              {/* Head socket, deliberately empty. `Helmet` is deleted; see the
                  block comment in `robotParts.tsx` for the three measurements that
                  removed it and why nothing replaces it yet.

                  ## The justification this comment used to carry is false

                  It read: "Created unconditionally, and that is load-bearing: a
                  socket group that only exists once its cosmetic is earned changes
                  the child order of everything below it, so the pose would start
                  landing in the wrong nodes at the exact moment a player unlocked
                  something."

                  That is not true of this rig and never was. Every ref is assigned
                  by a per-element callback that names its field - `rigRef.current.head
                  = o` - so child order is not read anywhere, and `applyPose` iterates
                  `JOINT_KEYS` and writes named fields rather than walking children by
                  index. A conditional socket group is therefore harmless here.

                  Where the claim DOES come from is `05-character-vfx.md` lines
                  219-220, which states it as a rule for the rig it was proposing.
                  That rig presumably resolved nodes positionally. Ours does not, so
                  the rule was inherited from a design that no longer exists.

                  The group stays anyway, on a weaker but real justification: the
                  socket's position is a contract the cosmetic system depends on, and
                  keeping it in the tree unconditionally keeps that contract visible
                  in one place instead of only existing while something is equipped. */}
              <group position={[0, 0.3, 0]} />
            </group>
          </group>
        </group>

        {/* Legs. Short and wide-set, which is what gives the low centre of gravity
            that makes a platformer character read as stable and controllable. */}
        <Leg side="L" rigRef={rigRef} />
        <Leg side="R" rigRef={rigRef} />
      </group>
    </group>
  )
}

/** Spreads a rest offset into the tuple form JSX wants. */
function at(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z]
}

/**
 * The face: the plate, and the glyph 0.020 m in front of it.
 *
 * Two layers rather than one because a glowing bar painted onto white plastic
 * reads as a decal. The plate is what makes it read as a lit element behind
 * glass, and it is the surface that carries more of this character's identity
 * than anything else on it.
 *
 * The lenses sit 0.027 m below the plate's centre, which is 57% of the way down
 * it. Low on the face is the infantile placement and it is not a detail: eyes
 * at the vertical centre read as an adult on any head shape. That number is the
 * one thing about the face this pass did NOT change - the bar and the two lenses
 * that replaced it are centred at exactly the same height, which is inside the
 * reference brief's measured 55-60% either way.
 *
 * ## The group no longer carries an offset, and that is not a simplification
 *
 * It used to sit at head-local (0, -0.045, 0.305), which is where a flat plate
 * mounts on a flat face. Both layers are now curved patches of the head's own
 * superellipsoid, and a patch is only meaningful in the frame its host is defined
 * in, so both geometries are authored directly in HEAD-local space and this group
 * has to be at the head's origin.
 *
 * The two numbers the offset used to hold did not disappear; they moved to where
 * the geometry is. The -0.045 is `FACE_PLATE.y`, and the 0.305 plus the plate's
 * 0.016 of proudness is now `FACE_PLATE.rise` measured off the surface rather than
 * off the origin, which is what makes it a constant step over a curved shell
 * instead of a constant step at one point on it.
 *
 * The group itself stays rather than being flattened into the head, because it is
 * the only thing left saying that the plate and the glyph are one feature in two
 * layers.
 */
function Face({
  pose,
  detail,
}: {
  pose: RefObject<Pose | null>
  /** From `quality.visorDetail`. `'simple'` compiles the scanlines and the
   *  sweep out of the visor shader with a `#define`, so the saving is a shorter
   *  program rather than a skipped branch. */
  detail: 'simple' | 'full'
}) {
  return (
    <group>
      <FacePlate />
      <RobotFace pose={pose} detail={detail} />
    </group>
  )
}

function EarPodNode({ side, rigRef }: { side: 'L' | 'R'; rigRef: RefObject<RigRefs | null> }) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.earPodL = o) : (rigRef.current!.earPodR = o))}
      position={at(side === 'L' ? REST.earPodL : REST.earPodR)}
    >
      <EarPod />
    </group>
  )
}

function Arm({
  side,
  rigRef,
  quality,
  children,
}: {
  side: 'L' | 'R'
  rigRef: RefObject<RigRefs | null>
  quality: QualitySettings
  children?: React.ReactNode
}) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.shoulderL = o) : (rigRef.current!.shoulderR = o))}
      position={at(side === 'L' ? REST.shoulderL : REST.shoulderR)}
    >
      <UpperArm quality={quality} />
      <group
        ref={(o) => void (side === 'L' ? (rigRef.current!.handSocketL = o) : (rigRef.current!.handSocketR = o))}
        position={at(side === 'L' ? REST.handSocketL : REST.handSocketR)}
      >
        {children}
      </group>
    </group>
  )
}

/**
 * One leg, as leg -> knee -> foot.
 *
 * Three nodes rather than one because foot IK needs a joint between the hip and
 * the sole to absorb a height difference, and the ground-normal tilt has to be
 * applied below the leg's own toe-out splay or it reads through the wrong pivot.
 */
function Leg({ side, rigRef }: { side: 'L' | 'R'; rigRef: RefObject<RigRefs | null> }) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.legL = o) : (rigRef.current!.legR = o))}
      position={at(side === 'L' ? REST.legL : REST.legR)}
    >
      <group
        ref={(o) => void (side === 'L' ? (rigRef.current!.kneeL = o) : (rigRef.current!.kneeR = o))}
        position={at(side === 'L' ? REST.kneeL : REST.kneeR)}
      >
        <Shin />
        <group
          ref={(o) => void (side === 'L' ? (rigRef.current!.footL = o) : (rigRef.current!.footR = o))}
          position={at(side === 'L' ? REST.footL : REST.footR)}
        >
          <Foot />
        </group>
      </group>
    </group>
  )
}

