import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { CylinderGeometry, type Group, type Mesh } from 'three'
import { GLOW, glowStrip } from '@/art/materials'
import { palette } from '@/art/palette'
import {
  HALO_GLOW,
  THRUSTER,
  THRUSTER_CORE,
  coreOrigin,
  groundGate,
  haloOrigin,
  pinnedEnvelope,
  thrusterEnvelope,
} from './thruster'
import type { GroundSample } from './robotPose'
import type { RobotAnimState } from './robotAnim'

/**
 * The blue beam that fires out of one sole during the second jump.
 *
 * ## It is driven by the physics clock, not by its own
 *
 * `anim.thrustAge` is restarted by the same branch of `stepVertical` that sets the
 * upward velocity and opens the gravity cut. Nothing here starts a timer, and that
 * is the whole design: an effect on its own clock drifts from the lift it is
 * supposed to be causing, by a frame at first and by more whenever the fixed step
 * catches up after a hitch, and the result reads as decoration bolted onto a jump
 * rather than as the thing making it happen.
 *
 * `thrustAge` rather than `thrust`, and the difference is not cosmetic: the flame
 * outlives the force by 110 ms so that it shuts down instead of vanishing in one
 * frame, and a beam gated on `thrust > 0` cannot express that. See `THRUSTER.decay`.
 *
 * ## Two cones, because the bible mandates the construction
 *
 * `00-art-bible.md` section 1: any emissive whose linear luminance is below 0.35
 * must be built as a pale core inside a coloured halo, never as one saturated
 * bright surface - "this is how the reference builds its LEDs and it is why they
 * read as light sources rather than as bright plastic".
 *
 * `palette.visor` at 0.6319 is above that floor, so a single element is legal. It
 * is what shipped first, and it was wrong for the reason the rule is really about:
 * a single additive cone at `GLOW.bloom` blooms to white and loses its colour. The
 * frame showed two white beams with a cyan fringe, which is a thruster with the
 * blue burned out of it.
 *
 * Splitting it puts the part that blooms in the middle, where the colour was going
 * to be lost anyway, and keeps the saturated part BELOW the threshold where it
 * survives:
 *
 *   element   colour     glow          blooms
 *   core      #e8fbff    GLOW.bloom    yes
 *   halo      #4de2ff    0.90          no
 *
 * Tier A membership is not in doubt: the bible names it - "Blue means ally and
 * gold means reward" - and a thruster on the player character is as close to the
 * centre of that set as anything in the game.
 *
 * ## The ground gate
 *
 * Faded out below 0.25 m of sole clearance. An additive beam a few centimetres
 * above the floor blooms into the contact shadow and the sole light and makes a
 * bright smear under the feet at exactly the moment - landing - when the eye is
 * looking for a clean contact.
 *
 * It also makes the beam invisible while grounded without knowing anything about
 * the jump state, which is the right behaviour falling out of the right rule
 * rather than being special-cased. `GroundSample` already names "the VFX emitter's
 * ground point and normal" as one of its three consumers, so the ray this reads was
 * cast for it and is not a new cost.
 *
 * ## Cost, on the record
 *
 * 24 triangles a cone, four cones, so **96 triangles** for the character - a fifth
 * of one pylon. **Four draw calls**, not one: core and halo need different
 * materials and the two feet sit under different transforms, so nothing merges.
 * That is the honest number rather than the one the spec hoped for.
 *
 * Hidden rather than unmounted between jumps, on `PoolSplash`'s argument that
 * unmounting disposes a compiled program and rebuilds it in the middle of the beat
 * that caused it.
 *
 * **Not gated on a quality tier, deliberately.** The obvious gates are
 * `quality.particleBudget` and `quality.vfxDetail`, and both are 0 and `'off'` at
 * every tier, so gating on either ships an effect that never draws and reports
 * nothing - the failure this project's memory is about. The moment `quality.ts`
 * grows a real particle tier this should move behind it.
 */
export function FootThruster({
  anim,
  ground,
}: {
  anim: RefObject<RobotAnimState | null>
  ground: RefObject<GroundSample | null>
}) {
  const core = useRef<Group>(null)
  const halo = useRef<Group>(null)
  const coreMesh = useRef<Mesh>(null)
  const haloMesh = useRef<Mesh>(null)

  /*
    Built once and never rebuilt. A `BufferGeometry` recreated per frame is a fresh
    GPU upload and is the most expensive mistake available in this neighbourhood -
    `robotGeometry.ts` opens with that warning.

    Wide end up: `CylinderGeometry` takes the top radius first, so the nozzle is
    `radiusTop` and no rotation is needed to point the taper at the floor.

    Open ended. The caps are a disc at each end that nothing can see - the top is
    buried in the sole and the bottom is millimetres across - and dropping them also
    removes two flat faces that would catch the additive blend at a different rate
    from the walls.
  */
  const geometry = useMemo(
    () => ({
      core: new CylinderGeometry(
        THRUSTER.nozzle,
        THRUSTER.tip,
        THRUSTER.length,
        THRUSTER.radialSegments,
        1,
        true,
      ),
      halo: new CylinderGeometry(
        THRUSTER.nozzle * THRUSTER.haloScale,
        THRUSTER.tip * THRUSTER.haloScale,
        THRUSTER.length * THRUSTER.haloLength,
        THRUSTER.radialSegments,
        1,
        true,
      ),
    }),
    [],
  )

  /*
    Additive and unlit. `00-art-bible.md` bans additive for dust and permits it for
    energy effects, because a dense cluster of individually dim additive quads sums
    past the threshold and produces a white blob. Four cones on one character are
    not a cluster, and this is energy, so it takes the exception it was written for.

    `glowStrip` pre-multiplies the colour in linear space by the same normalisation
    `emissive()` uses, so `glow` means here what it means everywhere else in the
    project and these two are comparable to every other emissive in the game.
  */
  const material = useMemo(
    () => ({
      core: glowStrip(THRUSTER_CORE, GLOW.bloom),
      halo: glowStrip(palette.visor, HALO_GLOW),
    }),
    [],
  )

  /*
    Read once at mount. See `pinnedEnvelope`: the capture harness renders without
    stepping the physics, so there is no frame in which this effect is naturally
    lit, and an effect nobody can photograph is one this project has shipped
    invisible before - twice, on the very sole light this beam comes out of.
  */
  const pinned = useMemo(
    () => (typeof window === 'undefined' ? null : pinnedEnvelope(window.location.search)),
    [],
  )

  useFrame(() => {
    const state = anim.current
    if (!state || !core.current || !halo.current || !coreMesh.current || !haloMesh.current) return

    const envelope = pinned ?? thrusterEnvelope(state.thrustAge)
    // The pin bypasses the gate as well as the envelope, because a grounded
    // character's beams are correctly hidden by it and the pin exists to see them.
    const gate = pinned !== null ? 1 : groundGate(ground.current?.distance ?? 0)
    const e = envelope * gate

    /*
      One boolean test per frame in the render list when it is off, against a shader
      compile in the middle of a jump if it were unmounted. `visible` also means the
      geometry and the compiled program survive between jumps, which they must: this
      fires several times a minute.
    */
    coreMesh.current.visible = e > 0
    haloMesh.current.visible = e > 0
    if (e <= 0) return

    /*
      The flicker runs on the burn's own age rather than on the scene clock, so the
      two feet stay in phase with each other from one press and a frozen frame is
      reproducible - which the capture harness needs, since it pins the clock and
      expects the same picture twice.

      Length only. Flickering the width makes the nozzle appear to breathe, and a
      nozzle is a hole in a solid object.
    */
    const age = pinned === null ? state.thrustAge : 0
    const wobble = 1 + THRUSTER.flicker * Math.sin(age * THRUSTER.flickerHz * Math.PI * 2)

    core.current.scale.set(e, e * wobble, e)
    // The halo trails the core on the flicker so the two do not pulse as one solid
    // object. Half the amplitude, because it is the softer element.
    halo.current.scale.set(e, e * (1 + (wobble - 1) * 0.5), e)
  })

  return (
    <>
      <group ref={halo} position={[0, haloOrigin(), 0]}>
        <mesh ref={haloMesh} geometry={geometry.halo} visible={false}>
          <meshBasicMaterial {...material.halo} />
        </mesh>
      </group>
      <group ref={core} position={[0, coreOrigin(), 0]}>
        <mesh ref={coreMesh} geometry={geometry.core} visible={false}>
          <meshBasicMaterial {...material.core} />
        </mesh>
      </group>
    </>
  )
}
