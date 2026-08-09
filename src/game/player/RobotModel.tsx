import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useQuality } from '@/art/useQuality'
import type { QualitySettings } from '@/art/quality'
import {
  AntennaLower,
  AntennaUpper,
  Backpack,
  CapeSegment,
  ChestPanel,
  Diaper,
  EarPod,
  FacePlate,
  Foot,
  Hand,
  HandProp,
  HeadShell,
  Helmet,
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
import { CAPE } from './animTuning'
import { RobotFace } from './RobotFace'
import { applyPose, createRigRefs, type RigRefs } from './rig'
import type { RobotAnimState } from './robotAnim'
import type { SocketName } from '@/state/types'

/**
 * The robot, built entirely from primitives.
 *
 * Design intent, and the reason it does not resemble Astro: a rounded boxy head
 * with a single horizontal cyan visor bar on a near-black plate, a warm amber
 * accent on an off-white shell, and an off-centre antenna. Specifically avoided
 * are the chrome sphere head, the two round blue eyes, and the blue-and-white
 * livery, all of which are the recognisable marks of that character.
 *
 * What we borrow is the principle rather than the design. A compact frame with
 * a low centre of gravity, and locomotion that reads as a toddler's waddle. The
 * proportions are the whole of it: 1.36 m over a 0.54 m head is 2.52
 * head-heights, and the head at 0.72 wide is 1.16 times the widest band below
 * the neck. A head wider than the torso at every height is what makes a shape
 * read as an infant rather than as a short adult, and it matters more than the
 * head-height ratio does.
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
          <group position={at(REST.capeRoot)}>{cosmetics.back === 'cape' && <Cape rigRef={rigRef} />}</group>

          <Arm side="L" rigRef={rigRef}>
            {cosmetics.hand_l ? <HandProp /> : <Hand quality={quality} />}
          </Arm>
          <Arm side="R" rigRef={rigRef}>
            {cosmetics.hand_r ? <HandProp /> : <Hand quality={quality} />}
          </Arm>

          {/* A zero-length pivot between chest and head, so the head can spring
              against the torso without inheriting the torso's own lag twice. */}
          <group ref={(o) => void (rigRef.current!.neck = o)} position={at(REST.neck)}>
            <group ref={(o) => void (rigRef.current!.head = o)} position={at(REST.head)}>
              <HeadShell quality={quality} />
              <Face pose={pose} detail={quality.visorDetail} />

              <EarPodNode side="L" rigRef={rigRef} quality={quality} />
              <EarPodNode side="R" rigRef={rigRef} quality={quality} />

              <group ref={(o) => void (rigRef.current!.antennaBase = o)} position={at(REST.antennaBase)}>
                <AntennaLower />
                <group ref={(o) => void (rigRef.current!.antennaMid = o)} position={at(REST.antennaMid)}>
                  <AntennaUpper />
                </group>
              </group>

              {/* Head socket, for the helmet earned after the first zone.

                  Created unconditionally, and that is load-bearing: a socket group
                  that only exists once its cosmetic is earned changes the child
                  order of everything below it, so the pose would start landing in
                  the wrong nodes at the exact moment a player unlocked something. */}
              <group position={[0, 0.3, 0]}>{cosmetics.head === 'helmet' && <Helmet />}</group>
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
 * The bar sits 0.027 m below the plate's centre, which is 57% of the way down
 * it. Low on the face is the infantile placement and it is not a detail: eyes
 * at the vertical centre read as an adult on any head shape.
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
    <group position={[0, -0.045, 0.305]}>
      <FacePlate />
      <RobotFace pose={pose} detail={detail} />
    </group>
  )
}

function EarPodNode({
  side,
  rigRef,
  quality,
}: {
  side: 'L' | 'R'
  rigRef: RefObject<RigRefs | null>
  quality: QualitySettings
}) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.earPodL = o) : (rigRef.current!.earPodR = o))}
      position={at(side === 'L' ? REST.earPodL : REST.earPodR)}
    >
      <EarPod quality={quality} />
    </group>
  )
}

function Arm({
  side,
  rigRef,
  children,
}: {
  side: 'L' | 'R'
  rigRef: RefObject<RigRefs | null>
  children?: React.ReactNode
}) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.shoulderL = o) : (rigRef.current!.shoulderR = o))}
      position={at(side === 'L' ? REST.shoulderL : REST.shoulderR)}
    >
      <UpperArm />
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

/**
 * The cape, as a four-segment chain rather than one plane.
 *
 * A skinned cape would need weights, which would need authoring, which would
 * need a binary asset this project does not have. A chain of rigid quads each
 * driven by its own spring gives more controllable secondary motion for less
 * work, and it is the correct read anyway: this world replaces cloth with
 * vinyl, so visible joins between rigid panels are the point rather than a
 * compromise.
 */
function Cape({ rigRef }: { rigRef: RefObject<RigRefs | null> }) {
  return (
    <group ref={(o) => void (rigRef.current!.cape[0] = o)}>
      <CapeSegment length={CAPE.segmentLength} />
      <group ref={(o) => void (rigRef.current!.cape[1] = o)}>
        <CapeSegment length={CAPE.segmentLength} />
        <group ref={(o) => void (rigRef.current!.cape[2] = o)}>
          <CapeSegment length={CAPE.segmentLength} />
          <group ref={(o) => void (rigRef.current!.cape[3] = o)}>
            <CapeSegment length={CAPE.segmentLength} />
          </group>
        </group>
      </group>
    </group>
  )
}
