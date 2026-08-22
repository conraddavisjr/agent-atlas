import type { BufferGeometry } from 'three'
import { chamferedBox, fin, mergeProp, pill, puck, roundedCylinder } from '@/art/geometry'

/**
 * The machine the diorama is about: one prop, one draw call.
 *
 * ## Merged rather than assembled in JSX
 *
 * `geometry.ts` states the rule this follows: "The architecture is static, so the
 * answer is not instancing but merging: call a generator once per placement at
 * mount, then fold every result sharing a material into one `BufferGeometry` with
 * `mergeProp`." Seven meshes in JSX would be seven draw calls plus seven more in
 * the shadow pass, on a stage that already owes the frame twenty text objects.
 *
 * `mergeProp` is also the safe way to do it. A bare `mergeGeometries` "returns
 * `null` rather than throwing when the inputs disagree, and a null geometry
 * assigned to a mesh renders nothing while reporting nothing" - and this mixes
 * sources deliberately, a de-indexed `chamferedBox` beside indexed lathes.
 *
 * ## Built in the robot's own vocabulary
 *
 * Nothing here has a ninety-degree corner, every cylinder has a filleted rim, and
 * the proportions are the character's: a soft box with a wide shoulder, standing
 * on short legs, with one round thing on top. It should read as the same factory
 * made it and the hero, because a lesson delivered by a prop from a different
 * world is a lesson that looks like an advertisement.
 *
 * ## The origin
 *
 * Its footprint's centre, on its base plane - the file's own convention, so a
 * caller that places it at `y = 0` gets a machine standing on the floor rather
 * than one buried to the shins.
 */
export function teachingMachineGeometry(scale = 1): BufferGeometry {
  const s = scale
  return mergeProp([
    /*
      The body. Height first because everything else is placed against it: the
      hopper sits on its lid, the fins run up its flanks, and the legs hold its
      base clear of the ground.
    */
    { geometry: chamferedBox({ width: 0.92 * s, height: 0.74 * s, depth: 0.58 * s, bevel: 0.08 * s }), position: [0, LEG_HEIGHT * s, 0] },

    /*
      The hopper: what the belt feeds. A `roundedCylinder` rather than a cone,
      because a funnel reads as a machine that pours and this one is a machine
      that swallows.
    */
    {
      geometry: roundedCylinder({ radius: 0.26 * s, height: 0.2 * s, topFillet: 0.07 * s, bottomFillet: 0.03 * s, draftDegrees: 4 }),
      position: [0, (LEG_HEIGHT + 0.74) * s, 0],
    },

    /* The face: one dial, so the front of the box is not a blank panel. */
    { geometry: puck(0.13 * s, 0.05 * s), position: [0, (LEG_HEIGHT + 0.42) * s, -0.29 * s], rotation: [Math.PI / 2, 0, 0] },

    /* Two legs, so it stands rather than sits. */
    ...[-1, 1].map((side) => ({
      geometry: pill(0.055 * s, LEG_HEIGHT * s),
      position: [side * 0.3 * s, 0, 0] as [number, number, number],
    })),

    /*
      Buttress fins on the flanks. They are the one piece of pure decoration here
      and they earn it: a soft box of this size reads as a fridge without a
      vertical to break its silhouette.
    */
    ...[-1, 1].map((side) => ({
      geometry: fin(0.06 * s, 0.5 * s, 0.34 * s),
      position: [side * 0.47 * s, LEG_HEIGHT * s, 0] as [number, number, number],
      rotation: [0, side * Math.PI * 0.5, 0] as [number, number, number],
    })),
  ])
}

/** How high the body stands off the floor. Named because four parts place against it. */
const LEG_HEIGHT = 0.18

/**
 * How large the machine is drawn on the feeding station.
 *
 * Shared with `machineIntake` rather than typed twice, which is the whole point:
 * the two have to agree or the streams miss the hopper, and they missed it once
 * already.
 */
export const MACHINE_SCALE = 0.62

/** How tall the whole machine is, for callers framing against it. */
export const MACHINE_HEIGHT = LEG_HEIGHT + 0.74 + 0.2
/**
 * Where the hopper's mouth is, so a belt and a stream can aim at the same point.
 *
 * **A FUNCTION of the scale, and it was a constant.** `teachingMachineGeometry`
 * takes a scale and applies it to every part, so a caller that builds the machine
 * at 0.62 and then aims five data streams at the unscaled intake aims them at a
 * point 40% too high - the streams converged in mid-air above the hopper, which
 * on a diagram about a machine being fed reads as the machine not being fed.
 *
 * Nothing failed and nothing logged. The streams were exactly where they had been
 * told to go.
 */
export function machineIntake(scale = 1): [number, number, number] {
  return [0, (LEG_HEIGHT + 0.84) * scale, 0]
}
