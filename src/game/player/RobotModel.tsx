import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { palette } from '@/art/palette'
import { GLOW, emissive, mattePlastic, metal, plastic, rubber } from '@/art/materials'
import {
  createAnimRuntime,
  createGroundSample,
  createPose,
  REST,
  stepAnim,
  type AnimRuntime,
  type GroundSample,
  type Pose,
  type Vec3,
} from './robotPose'
import { applyPose, createRigRefs, type RigRefs } from './rig'
import type { RobotAnimState } from './robotAnim'
import type { SocketName } from '@/state/types'

/**
 * The robot, built entirely from primitives.
 *
 * Design intent, and the reason it does not resemble Astro: a rounded boxy head
 * with a single horizontal LED visor bar, a warm amber accent on an off-white
 * shell, and a stubby antenna. Specifically avoided are the chrome sphere head,
 * the two round blue eyes, and the blue-and-white livery, all of which are the
 * recognisable marks of that character.
 *
 * What we do borrow is the principle rather than the design: a compact frame with
 * a low centre of gravity, and locomotion that reads as a toddler's waddle. With
 * no skeleton, that charm has to come from whole-body motion.
 *
 * This component is deliberately JSX, refs, and a `useFrame` of two calls. Every
 * piece of arithmetic that used to live here is now in `robotPose.ts`, where it
 * is a pure function of state and time and is unit tested, and `rig.ts` writes
 * the result onto these nodes. See the header of `robotPose.ts` for why that
 * split is worth two extra files.
 */
export function RobotModel({
  anim,
  cosmetics,
}: {
  anim: RefObject<RobotAnimState>
  cosmetics: Partial<Record<SocketName, string>>
}) {
  /*
    One struct of node refs rather than a `useRef` each.

    `applyPose` iterates the pose's own joint list, so a node added to the pose
    and forgotten here is a null that it skips, rather than a silent write into
    whichever joint happened to be next.
  */
  const rigRef = useRef<RigRefs | null>(null)
  if (rigRef.current === null) rigRef.current = createRigRefs()

  /*
    The runtime, the pose buffer and the ground sample, created once and mutated
    forever after.

    Refs rather than `useMemo` for the reason `PlayerController` gives for its
    scratch vectors: these are explicitly mutable per-frame buffers, and a
    `useMemo` value may not be mutated after render.
  */
  const rtRef = useRef<AnimRuntime | null>(null)
  if (rtRef.current === null) rtRef.current = createAnimRuntime(0xa71a5)
  const poseRef = useRef<Pose | null>(null)
  if (poseRef.current === null) poseRef.current = createPose()
  const groundRef = useRef<GroundSample | null>(null)
  if (groundRef.current === null) groundRef.current = createGroundSample()

  useFrame((_, delta) => {
    // Clamp delta so a background tab that resumes after a long pause does not
    // advance the walk cycle by a huge step and snap the limbs. Clamped here
    // rather than inside the solver, so a test can still hand the solver a ten
    // second step and prove it survives one.
    const dt = Math.min(delta, 0.05)
    stepAnim(rtRef.current!, anim.current, groundRef.current!, dt, poseRef.current!)
    applyPose(poseRef.current!, rigRef.current!)
  })

  return (
    <group ref={(o) => void (rigRef.current!.root = o)}>
      <group ref={(o) => void (rigRef.current!.hips = o)}>
        <group ref={(o) => void (rigRef.current!.chest = o)}>
          {/* Torso. Rounded box rather than a capsule so the silhouette reads as a
              manufactured object rather than a blob. */}
          <RoundedBox args={[0.62, 0.6, 0.44]} radius={0.16} smoothness={4} position={[0, 0.62, 0]} castShadow>
            <meshPhysicalMaterial {...plastic(palette.shell)} />
          </RoundedBox>

          {/* Amber chest panel. The single accent, kept to one place so it stays a
              focal point instead of decoration. */}
          <RoundedBox args={[0.3, 0.22, 0.06]} radius={0.05} smoothness={3} position={[0, 0.66, 0.22]} castShadow>
            <meshPhysicalMaterial {...plastic(palette.accent)} />
          </RoundedBox>

          {/* A zero-length pivot between chest and head, so the head can spring
              against the torso without inheriting the torso's own lag twice. */}
          <group ref={(o) => void (rigRef.current!.neck = o)} position={at(REST.neck)}>
            <group ref={(o) => void (rigRef.current!.head = o)} position={at(REST.head)}>
              <RoundedBox args={[0.56, 0.44, 0.46]} radius={0.14} smoothness={4} castShadow>
                <meshPhysicalMaterial {...plastic(palette.shell)} />
              </RoundedBox>

              {/* The visor bar, and the one thing on the character that glows.
                  GLOW.bloom is 1.25 times the bloom threshold, which for cyan is an
                  emissiveIntensity of 3.46. The 2.4 this replaces reached 1.517
                  against a threshold of 1.75, so the comment claiming it pushed past
                  the threshold had never been true. */}
              <RoundedBox args={[0.42, 0.1, 0.04]} radius={0.03} smoothness={3} position={[0, 0.02, 0.235]}>
                <meshPhysicalMaterial {...emissive(palette.visor, GLOW.bloom)} />
              </RoundedBox>

              {/* Antenna, split into two nodes so the chain can whip on impact. */}
              <group ref={(o) => void (rigRef.current!.antennaBase = o)} position={at(REST.antennaBase)}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.018, 0.018, 0.2, 8]} />
                  <meshPhysicalMaterial {...metal(palette.rock)} />
                </mesh>
                <group ref={(o) => void (rigRef.current!.antennaMid = o)} position={at(REST.antennaMid)}>
                  <mesh>
                    <sphereGeometry args={[0.045, 12, 12]} />
                    <meshPhysicalMaterial {...emissive(palette.accent, GLOW.bloom)} />
                  </mesh>
                </group>
              </group>

              {/* Ear pods, which break up the boxy head silhouette. */}
              <EarPod side="L" rigRef={rigRef} />
              <EarPod side="R" rigRef={rigRef} />

              {/* Head socket, for the helmet earned after the first zone.

                  Created unconditionally, and that is load-bearing: a socket group
                  that only exists once its cosmetic is earned changes the child
                  order of everything below it, so the pose would start landing in
                  the wrong nodes at the exact moment a player unlocked something. */}
              <group position={[0, 0.24, 0]}>{cosmetics.head === 'helmet' && <Helmet />}</group>
            </group>
          </group>

          {/* Back socket, for the cape. */}
          <group position={at(REST.capeRoot)}>{cosmetics.back === 'cape' && <Cape />}</group>

          <Arm side="L" rigRef={rigRef}>{cosmetics.hand_l && <HandProp />}</Arm>
          <Arm side="R" rigRef={rigRef}>{cosmetics.hand_r && <HandProp />}</Arm>
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

function EarPod({ side, rigRef }: { side: 'L' | 'R'; rigRef: RefObject<RigRefs | null> }) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.earPodL = o) : (rigRef.current!.earPodR = o))}
      position={at(side === 'L' ? REST.earPodL : REST.earPodR)}
    >
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

function Arm({ side, rigRef, children }: { side: 'L' | 'R'; rigRef: RefObject<RigRefs | null>; children?: React.ReactNode }) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.shoulderL = o) : (rigRef.current!.shoulderR = o))}
      position={at(side === 'L' ? REST.shoulderL : REST.shoulderR)}
    >
      <mesh position={[0, -0.16, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.18, 4, 12]} />
        <meshPhysicalMaterial {...plastic(palette.accent)} />
      </mesh>
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
 * Three nodes rather than one even though nothing bends the knee yet, because
 * foot IK needs a joint between the hip and the sole to absorb a height
 * difference, and adding it later would mean re-deriving the swing offsets
 * against a different parent.
 */
function Leg({ side, rigRef }: { side: 'L' | 'R'; rigRef: RefObject<RigRefs | null> }) {
  return (
    <group
      ref={(o) => void (side === 'L' ? (rigRef.current!.legL = o) : (rigRef.current!.legR = o))}
      position={at(side === 'L' ? REST.legL : REST.legR)}
    >
      <group ref={(o) => void (side === 'L' ? (rigRef.current!.kneeL = o) : (rigRef.current!.kneeR = o))}>
        <mesh position={[0, -0.1, 0]} castShadow>
          <capsuleGeometry args={[0.095, 0.1, 4, 12]} />
          <meshPhysicalMaterial {...mattePlastic(palette.shellShadow)} />
        </mesh>
        <group
          ref={(o) => void (side === 'L' ? (rigRef.current!.footL = o) : (rigRef.current!.footR = o))}
          position={at(side === 'L' ? REST.footL : REST.footR)}
        >
          <RoundedBox args={[0.22, 0.1, 0.3]} radius={0.04} smoothness={3} castShadow>
            <meshPhysicalMaterial {...rubber(palette.lockedDeep)} />
          </RoundedBox>
        </group>
      </group>
    </group>
  )
}

/** Earned after the first zone. Deliberately simple; it only has to read clearly. */
function Helmet() {
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial {...plastic(palette.unlocked)} side={2} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.06, 0.16, 0.34]} />
        <meshPhysicalMaterial {...plastic(palette.accentDeep)} />
      </mesh>
    </group>
  )
}

function Cape() {
  return (
    <mesh position={[0, -0.18, -0.04]} rotation={[0.18, 0, 0]} castShadow>
      <planeGeometry args={[0.6, 0.7]} />
      <meshPhysicalMaterial {...mattePlastic(palette.token)} side={2} />
    </mesh>
  )
}

function HandProp() {
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.1, 12, 12]} />
      <meshPhysicalMaterial {...plastic(palette.shell)} />
    </mesh>
  )
}
