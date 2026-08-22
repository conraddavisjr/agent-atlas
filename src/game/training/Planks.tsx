import { Suspense, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Shape, type Group } from 'three'
import { GLOW, emissive, emissiveRaw, mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'
import { PLANK_RADIUS } from './stage'
import { QUIZ } from './cards'
import { LABEL_LIFT, plankLayout, plankReveal, plankSpin } from './quiz'
import type { TrainingState } from './trainingMachine'

/**
 * The three answer planks: thick wooden coins that turn over to give a verdict.
 *
 * ## They are discs, and the brief is emphatic about it
 *
 * "Clearly wooden planks, thick wooden planks in the shapes of circles. Emphasize
 * that they're not spheres, but they're essentially large coins." A cylinder with
 * its axis along Z is exactly that: a face toward the player, a rim you can see the
 * thickness of, and a back.
 *
 * The thickness is the whole reason a flip reads. A zero-depth disc turning over
 * disappears into a line at 90 degrees and reappears - which looks like a glitch.
 * A coin sweeps its rim through the turn and stays a solid the entire time.
 *
 * ## The verdict lives on the BACK, not on an overlay
 *
 * A star for right, a barred circle for wrong, each modelled on the far face. The
 * plank turns to show it and - if wrong - turns back. That is why `plankSpin`
 * returns to exactly zero rather than approximately: a plank left a fraction off
 * square shows a sliver of its verdict for the rest of the round.
 *
 * ## Labels above rather than on
 *
 * `LABEL_LIFT` puts each answer over its plank. Painted on the face it would rotate
 * away with the flip, and the player would lose the text of the answer at the exact
 * moment they are being told whether it was right.
 */
export function Planks({ run }: { run: RefObject<TrainingState> }) {
  const planks = useMemo(() => plankLayout(), [])

  return (
    <>
      {planks.map((position, index) => (
        <Plank key={index} index={index} position={position} run={run} />
      ))}
    </>
  )
}

function Plank({
  index,
  position,
  run,
}: {
  index: number
  position: [number, number, number]
  run: RefObject<TrainingState>
}) {
  const group = useRef<Group>(null)
  const spinner = useRef<Group>(null)

  useFrame(() => {
    const state = run.current
    if (!state || !group.current || !spinner.current) return

    /*
      The staggered arrival, as a scale. Growing from nothing rather than sliding
      in from off screen, because the brief asks for "a little sparky animation
      that reveals them" - something that appears in place, not something that
      arrives from somewhere.
    */
    const reveal = plankReveal(state, index)
    group.current.visible = reveal > 0
    if (reveal <= 0) return

    /*
      Overshoot on the way in. `1 + sin(pi * r) * 0.12` peaks at 12% over halfway
      through and returns to exactly 1, so the disc pops rather than inflating -
      and lands at true size rather than near it.
    */
    const pop = 1 + Math.sin(Math.PI * reveal) * 0.12
    group.current.scale.setScalar(reveal * pop)
    spinner.current.rotation.x = plankSpin(state, index)
  })

  return (
    <group ref={group} position={position} visible={false}>
      {/*
        The label sits OUTSIDE the spinner, so it holds still while the plank turns
        underneath it.
      */}
      <Suspense fallback={null}>
        <Text
          position={[0, LABEL_LIFT, 0.02]}
          rotation={[0, Math.PI, 0]}
          fontSize={0.085}
          color="#dce7f8"
          anchorX="center"
          anchorY="middle"
          /*
            Narrow enough that three stacked labels cannot run into each other or
            sprawl across whatever is behind them. At 2.1 they overlapped the cube
            standing behind the planks and each other's neighbours.
          */
          maxWidth={1.45}
          textAlign="center"
          outlineWidth={0.006}
          outlineColor="#0b1020"
        >
          {QUIZ.answers[index]}
        </Text>
      </Suspense>

      <group ref={spinner}>
        {/*
          A cylinder on its side: 24 radial segments is smooth at this size, and
          the 0.09 depth is what makes the rim visible as the plank turns.
        */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[PLANK_RADIUS, PLANK_RADIUS, 0.09, 24]} />
          {/*
            A colour hold, which is `GLOW.hold`'s stated purpose: "emissive used
            only so a surface does not go dead in shadow, never as light".

            The planks need it more than anything else on this stage. They face the
            camera on a set whose key comes from high and behind, so their front
            face - the one the player aims at - receives almost nothing, and warm
            wood at `#a8794e` was rendering as a black ring. It is the one warm
            object in a cool round and the only thing the player has to pick out,
            so losing its colour loses the target.

            `emissiveRaw` rather than `emissive` because this is deliberately BELOW
            the normalisation the bloom budget uses - a tenth of the threshold,
            which is an order of magnitude under it and cannot bloom.
          */}
          <meshPhysicalMaterial
            {...mattePlastic(PLANK_WOOD, { clearcoat: 0.08 })}
            {...emissiveRaw(PLANK_WOOD, GLOW.hold)}
          />
        </mesh>

        {/* The grain, as a darker inset ring, on the side the player starts on. */}
        <mesh position={[0, 0, -0.048]} rotation={[0, Math.PI, 0]}>
          <ringGeometry args={[PLANK_RADIUS * 0.62, PLANK_RADIUS * 0.78, 24]} />
          <meshPhysicalMaterial {...mattePlastic(PLANK_WOOD_DEEP)} />
        </mesh>

        {/*
          The verdict, on the face turned AWAY from the camera - which on this
          stage is +Z, not -Z.

          It shipped on -Z first, and the result was that every plank displayed its
          own answer before a single arrow was loosed: two red no-signs and a gold
          star, sitting there giving the game away. The stage is authored at
          positive Z and viewed from negative Z, so "the back" in world terms is
          the side the player is looking at. Third time that inversion has bitten
          in this feature, after the headline and the cube.

          Both faces are always mounted and only one is ever turned toward the
          player, which is cheaper than swapping a material and means neither has
          to be built in the middle of a beat. Which one a plank carries is decided
          by the ANSWER's own correctness rather than by the round's state, so a
          plank cannot show a star for a wrong answer no matter what the machine
          does.
        */}
        <group position={[0, 0, 0.052]}>
          {index === QUIZ.correct ? <StarFace /> : <NoFace />}
        </group>
      </group>
    </group>
  )
}

/**
 * The reward star.
 *
 * Gold and emissive at `GLOW.bloom`, and it is the ONE thing in this whole round
 * allowed to bloom. `00-art-bible.md` reserves tier A for ally blue and reward
 * gold - "nothing in the environment is allowed in" - and a correct answer is the
 * single most literal reward the game has. Everything else in the mini-game, the
 * headline and the cards and the plank faces, is deliberately kept under the
 * threshold so that this one thing lands.
 */
function StarFace() {
  const shape = useMemo(() => starShape(5, PLANK_RADIUS * 0.62, PLANK_RADIUS * 0.27), [])
  return (
    <mesh>
      <shapeGeometry args={[shape]} />
      <meshPhysicalMaterial {...emissive(palette.unlocked, GLOW.bloom)} />
    </mesh>
  )
}

/** The barred circle: a ring and a diagonal, which is a "no" in two primitives. */
function NoFace() {
  return (
    <group>
      {/*
        The same colour hold the wood gets, and for the same reason: this face is
        turned toward a camera the key light is behind, so unlit red lands almost
        black - and a verdict the player has to squint at is not a verdict. Well
        under the bloom threshold: `00-art-bible.md` reserves tier A for ally blue
        and reward gold, and a glowing rejection would outshine the star.
      */}
      <mesh>
        <ringGeometry args={[PLANK_RADIUS * 0.5, PLANK_RADIUS * 0.66, 28]} />
        <meshPhysicalMaterial {...mattePlastic(NO_RED)} {...emissiveRaw(NO_RED, GLOW.hold)} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[PLANK_RADIUS * 1.32, PLANK_RADIUS * 0.16]} />
        <meshPhysicalMaterial {...mattePlastic(NO_RED)} {...emissiveRaw(NO_RED, GLOW.hold)} />
      </mesh>
    </group>
  )
}

/**
 * A star polygon, as a `Shape`.
 *
 * Built here rather than imported because `robotGeometry.ts`'s shape helpers are
 * character-scoped and this is a prop. Points alternate outer and inner radius,
 * starting at the top so the star sits upright rather than on a point.
 */
function starShape(points: number, outer: number, inner: number): Shape {
  const shape = new Shape()
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (i * Math.PI) / points + Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

/**
 * The wood.
 *
 * Local constants rather than palette entries, deliberately. `palette.ts` carries
 * the world's own vocabulary and every addition to it invites a `band()` claim and
 * a place in the value system; these two exist on three discs in one mini-game and
 * are the only warm thing in a round that is otherwise entirely cool - which is
 * the point, because the planks are the one object the player has to pick out and
 * aim at.
 */
const PLANK_WOOD = '#a8794e'
const PLANK_WOOD_DEEP = '#7d5734'
const NO_RED = '#e0483c'
