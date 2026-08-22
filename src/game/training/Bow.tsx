import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group } from 'three'
import { mattePlastic, plastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { Fist } from '@/game/player/robotParts'
import { fistGrip } from '@/game/player/robotGeometry'
import { useQuality } from '@/art/useQuality'
import { ArrowBody } from './ArrowBody'
import { BOW_DRAW, BOW_OFFSET, BOW_SCALE, EYE } from './stage'
import { bowArrival, bowVisible, drawAmount } from './bowDraw'
import type { TrainingState } from './trainingMachine'

/**
 * The first-person bow: a viewmodel, two hands, and the draw cycle.
 *
 * ## A viewmodel, not the character's actual arms
 *
 * The honest version poses `hand_l` and `hand_r` on the real rig. `robotPose.ts`
 * drives eleven joints from a spring solver, `springs.test.ts` asserts the
 * `SPRINGS` key set EXACTLY so no new spring may be added, and the whole thing is
 * the heaviest tested module in the project - a large change to a load-bearing
 * system for one mini-game.
 *
 * From inside the character's own head none of that is visible anyway. What the
 * player sees is a bow, a fist on the grip and a fist on the string, and those
 * are three objects hung in front of a camera. It is what every first-person game
 * does and for the same reason. The robot itself is hidden for these beats, so
 * there is no risk of the viewmodel and the real arms disagreeing on screen.
 *
 * The hands are `Fist` from `robotParts.tsx` - the character's own hand, closed -
 * rather than lookalikes, which is what keeps them the character's hands and not
 * a pair of gloves: the knuckles sit on the mitten's own finger centrelines and
 * the material is the same `shell(palette.shellShadow)` with the same sheen gate.
 *
 * It is a closed hand and not the open one, and that took a second pass. `Hand`
 * is a mitten with two fingers extended, which is right for a character standing
 * with its arms down and wrong wrapped round a bow grip a hand's width from the
 * lens - it reads as a paddle resting against the riser. See `FIST`.
 *
 * ## The draw cycle is the rate limit
 *
 * The brief asks for the hand to release, the bow to unleash, and the archer to
 * reach back for the string about a second later - so roughly one shot a second.
 * That is not enforced here with a timer; it falls out of the phases. `aiming` is
 * the only phase that takes a shot, and the only route back to it runs through
 * `firing` and `reloading`. The animation and the rule are the same thing, which
 * is why the bow cannot be drawn and unshootable or shootable and slack.
 */
export function Bow({
  run,
  aim,
}: {
  run: RefObject<TrainingState>
  /** The live aim point in world space, written by `AimPlane`. */
  aim: RefObject<[number, number, number]>
}) {
  const quality = useQuality()
  const group = useRef<Group>(null)
  const string = useRef<Group>(null)
  const drawHand = useRef<Group>(null)
  const nocked = useRef<Group>(null)
  const target = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const state = run.current
    const g = group.current
    if (!state || !g) return

    if (!bowVisible(state)) {
      g.visible = false
      return
    }
    g.visible = true

    const appear = bowArrival(state)
    // `BOW_SCALE` is the rig's own size and `appear` is the arrival, multiplied
    // rather than either one alone - setting the scale straight from `appear`
    // was what made the bow snap to full world size the moment it finished
    // arriving.
    g.scale.setScalar(BOW_SCALE * appear)
    if (appear <= 0) return

    /*
      AIM, from a fixed grip.

      The bow's grip is pinned in space and the whole rig turns to face the aim
      point, which is the same world point the reticle is drawn at and the same
      one the hit test scored. Two systems each casting their own ray can disagree
      at the rim of a plank, and the player would watch the arrow point at a coin
      and be told they missed it.
    */
    target.set(aim.current[0], aim.current[1], aim.current[2])
    g.lookAt(target)

    /*
      The draw, as one number.

      1 is fully drawn, 0 is released. `aiming` holds at 1; the loose drops it to
      0 for the whole flight and the verdict; `reloading` pulls it back. Because
      the string, the drawing hand and the nocked arrow all read this, they cannot
      get out of step with each other - which is the failure that makes an archer
      look like they are miming.
    */
    const draw = drawAmount(state)
    if (string.current) string.current.position.z = -BOW_DRAW * draw
    if (drawHand.current) drawHand.current.position.z = -BOW_DRAW * draw
    if (nocked.current) {
      // The nocked arrow exists only while there is one on the string. During the
      // flight the arrow the player sees is `Arrow`, in world space.
      nocked.current.visible = state.phase !== 'firing' && draw > 0.02
      nocked.current.position.z = -BOW_DRAW * draw
    }
  })

  return (
    <group ref={group} position={ANCHOR} visible={false}>
      {/*
        The limbs, and the ROTATION is the part that matters.

        A torus lies in its own XY plane with the ring's normal along +Z, and this
        rig's +Z points at the target - so left unrotated, or rotated only about
        Z as it was in the third-person version, the bow is a hoop encircling its
        own arrow. From behind the character that read as a bow seen edge-on and
        nobody noticed. From the archer's eye it is a ring you shoot through.

        A bow's plane contains UP and FORWARD, so the ring has to end up in YZ.
        `Ry(-90)` sends the ring's local +X to +Z, which puts the start of the arc
        at the belly of the riser; the Z term is applied FIRST under three's XYZ
        euler order and rolls the arc back by half its own sweep, so the 207
        degrees are centred on the front and the gap lands behind - which is where
        the archer's hand and the string go.
      */}
      <mesh rotation={[0, -Math.PI / 2, -Math.PI * ARC / 2]} castShadow>
        <torusGeometry args={[0.3, 0.022, 8, 20, Math.PI * ARC]} />
        <meshPhysicalMaterial {...mattePlastic(BOW_WOOD, { clearcoat: 0.1 })} />
      </mesh>
      {/* The grip, so the middle of the bow is a solid rather than a gap. */}
      <mesh castShadow>
        <capsuleGeometry args={[0.032, 0.1, 4, 8]} />
        <meshPhysicalMaterial {...plastic(palette.hardware)} />
      </mesh>

      {/*
        The bow hand, closed around the grip.

        `Fist` states its own contract: fingers leave at -Y, curl toward +Z, and
        whatever is gripped runs along X through the pocket between the roll and
        the palm. The riser runs along Y here, so the quarter turn about Z is what
        threads it through that pocket rather than laying the hand against it.

        The inner group is the other half of that, and it was missing at first: a
        fist mounted by its CENTRE sits beside what it is holding, because the
        pocket is not at the centre. `fistGrip` publishes where the pocket is and
        this shifts the hand so the pocket lands on the origin - which is where
        the riser is.

        It does not move. The whole point of a bow hand is that it is the thing
        everything else moves relative to.
      */}
      <group rotation={[0, 0, Math.PI / 2]} scale={HAND_SCALE}>
        <group position={[0, -GRIP.y, -GRIP.z]}>
          <Fist quality={quality} />
        </group>
      </group>

      {/* The string, which moves back with the draw. */}
      <group ref={string}>
        <mesh>
          <cylinderGeometry args={[0.006, 0.006, 0.58, 5]} />
          <meshBasicMaterial color="#cfe0f5" />
        </mesh>
      </group>

      {/*
        The drawing hand, hooked round the string.

        The same quarter turn and the same grip offset as the bow hand, because
        the string runs along Y too - so the fist closes on it the same way, and
        the two hands hold the same bow the same way rather than each being nudged
        into place by eye. It is the SECOND fist here, and that is right: an
        archer's draw is fingers curled round a string, which is a closed hand by
        any other name.

        `fistGrip` also does the job the old hand-authored offset was doing: the
        pocket sits below the arrow's line, so the shaft rests on the fingers
        rather than being swallowed by a hand centred on the nock.
      */}
      <group ref={drawHand}>
        <group rotation={[0, 0, Math.PI / 2]} scale={HAND_SCALE}>
          <group position={[0, -GRIP.y, -GRIP.z]}>
            <Fist quality={quality} />
          </group>
        </group>
      </group>

      {/*
        The nocked plunger arrow: a shaft, a rubber cup at the business end, and
        flights. A plunger rather than a point because the brief says so, and
        because a suction cup is the one arrowhead that can be fired at a face in
        a children's game without anybody flinching.
      */}
      <group ref={nocked} visible={false}>
        <ArrowBody />
      </group>
    </group>
  )
}

/**
 * Where the bow sits, in world space.
 *
 * The camera is parked at `EYE` for the whole quiz and does not move, so the
 * offset can be resolved once here rather than recomputed against a live camera
 * every frame. `BOW_OFFSET` is written in WORLD axes for the reason it documents:
 * a camera-local triple added to a world position component-wise puts the bow
 * behind the player, because three's cameras look down their own -Z.
 */
const ANCHOR: [number, number, number] = [
  EYE[0] + BOW_OFFSET[0],
  EYE[1] + BOW_OFFSET[1],
  EYE[2] + BOW_OFFSET[2],
]

/**
 * The hands, relative to the rig they are mounted in.
 *
 * Smaller than life on top of `BOW_SCALE`, which is a second licence and a
 * deliberate one: the character's hand is 0.23 across, and two of them at full
 * size on a bow drawn this close to the lens are all you can see.
 *
 * Raised from 0.44 when `Hand` became `Fist`. The fist is a third shorter than
 * the mitten - the fingers have gone from adding to its length to adding to its
 * depth - so the same scale made it read as a smaller hand rather than as the
 * same hand closed.
 */
const HAND_SCALE = 0.52

/** How much of a circle the limbs sweep. Just over half, so the gap is a gap. */
const ARC = 1.15

/** Where a gripped bar passes through the fist. Read once; it is pure. */
const GRIP = fistGrip()

const BOW_WOOD = '#8d6440'
