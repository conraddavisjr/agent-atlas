import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { mulberry32 } from '@/art/placement'
import { burstOrigin } from './quiz'
import {
  BURST_CAPACITY,
  burstOpacity,
  createBurst,
  seedBurst,
  stepBurst,
} from './burst'
import type { TrainingState } from './trainingMachine'

/**
 * The win burst: one instanced mesh, a fixed pool, no allocation per frame.
 *
 * All of the simulation is in `burst.ts` and all of it is tested. This file is the
 * part that cannot be: turning a hundred positions into a hundred instance
 * matrices, once a frame.
 *
 * ## The budget, on the record
 *
 * 120 pieces, one quad each: **240 triangles and ONE draw call**, no texture. That
 * is half of what the character's own thruster beams cost and a fifth of one pylon.
 * The brief asked for it not to tank the frame rate, and a pool is the direct
 * answer - the cost is decided at construction and no sequence of events can
 * exceed it.
 *
 * ## Not additive, which is a rule rather than a preference
 *
 * `00-art-bible.md` permits additive only for energy and bans it for dust, because
 * a dense cluster of dim additive quads sums past the bloom threshold and produces
 * a white blob. A hundred overlapping pieces of paper is exactly that case. Normal
 * blending, and the only thing in this round that blooms is the gold star on the
 * winning plank.
 */
export function Confetti({ run }: { run: RefObject<TrainingState> }) {
  const mesh = useRef<InstancedMesh>(null)
  const burst = useMemo(() => createBurst(), [])
  /** Latched, so one win seeds the pool once rather than on every frame of it. */
  const seeded = useRef(false)

  /*
    Scratch objects, allocated once. `Matrix4.compose` needs three of them and
    building them per instance would be three hundred allocations a frame - the
    exact garbage this whole design exists to avoid.
  */
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(),
      axis: new Vector3(0.4, 0.7, 0.55).normalize(),
      colour: new Color(),
    }),
    [],
  )

  const palette = useMemo(() => PALETTE.map((hex) => new Color(hex)), [])

  /*
    The burst fires from the WINNING plank, not from the middle of the column.

    It used to seed at `PLANK_AT`, which is the column's anchor - and with the
    correct answer currently sitting in the middle, those are the same point. That
    coincidence is the dangerous part: reordering the answers in `cards.ts` would
    have moved the star and left the confetti behind, and nothing would have
    failed. A little forward of the plank's face so the pieces spray toward the
    camera rather than out of the back of it.
  */
  const origin = useMemo(() => burstOrigin(), [])

  useFrame((_, delta) => {
    const state = run.current
    const m = mesh.current
    if (!state || !m) return

    /*
      Seeded on entering the celebration and never again. `accepting` would be too
      early - the plank is still turning to reveal the star, and confetti before
      the reveal gives the answer away a beat before the game does.
    */
    if (state.phase === 'celebrating' && !seeded.current) {
      seeded.current = true
      seedBurst(burst, origin, mulberry32(20260821), palette.length)
    }
    if (state.phase !== 'celebrating' && state.phase !== 'exiting') seeded.current = false

    const alive = stepBurst(burst, delta)
    m.visible = alive > 0
    if (alive === 0) return

    for (let i = 0; i < BURST_CAPACITY; i++) {
      const opacity = burstOpacity(burst, i)
      scratch.position.set(burst.x[i], burst.y[i], burst.z[i])
      scratch.quaternion.setFromAxisAngle(scratch.axis, burst.spin[i])
      /*
        The fade is done with SCALE rather than with opacity, and that is a real
        decision. Per-instance opacity needs a transparent material, which puts a
        hundred quads into the depth-sorted transparent pass - and this project
        already documents what that costs elsewhere. Shrinking to nothing reads
        almost identically at this size and keeps the whole burst opaque.
      */
      const size = PIECE * opacity
      scratch.scale.set(size, size * 1.6, size)
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
      m.setMatrixAt(i, scratch.matrix)
      m.setColorAt(i, palette[burst.tint[i]])
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, BURST_CAPACITY]} visible={false} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      {/*
        `MeshBasicMaterial`, unlit. A lit confetti piece is a two-sided quad whose
        normal points somewhere arbitrary as it tumbles, so it strobes between lit
        and unlit once per rotation - which reads as flickering rather than as
        spinning. Unlit and double-sided is what makes a tumbling quad legible.
      */}
      <meshBasicMaterial toneMapped={false} side={2} />
    </instancedMesh>
  )
}

/** One piece, in metres. Small enough that 120 of them read as a shower. */
const PIECE = 0.055

/**
 * The confetti's colours.
 *
 * Blues and silvers from the design direction, plus the reward gold - which is the
 * one warm thing allowed, because `00-art-bible.md` makes gold a semantic rather
 * than an aesthetic choice: it means earned, and this is the moment something was.
 */
const PALETTE = ['#4de2ff', '#7fb0ff', '#e8f0ff', '#ffd45e', '#9fb6d8'] as const
