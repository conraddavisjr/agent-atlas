import { DURATIONS, type Phase } from './trainingMachine'
import { INSTRUCTOR_ENTER, INSTRUCTOR_EXIT, INSTRUCTOR_HOME } from './stage'

/**
 * Where the instructor is, at any point in the round.
 *
 * Pure, and separate from the component for the reason this project keeps
 * repeating: the failure mode of a flight path is not an exception, it is a
 * character that arrives half a second late or leaves through the wrong side of
 * the frame, and no still frame distinguishes those from correct.
 */

/** Hermite smoothstep. The same curve `groundGate` and the shaders use. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/**
 * A gentle arc between two points, lifted in the middle.
 *
 * Straight-line travel reads as a machine on rails. The lift is what makes it a
 * swoop, and it is proportional to the distance covered so a short hop does not
 * get the same vertical flourish as a long entrance.
 */
function arc(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
  lift: number,
): [number, number, number] {
  const s = smooth(t)
  // `4 * s * (1 - s)` peaks at 1 in the middle and is 0 at both ends, so the arc
  // meets its endpoints exactly - which is what stops a visible kink at the join.
  const hump = 4 * s * (1 - s) * lift
  return [
    from[0] + (to[0] - from[0]) * s,
    from[1] + (to[1] - from[1]) * s + hump,
    from[2] + (to[2] - from[2]) * s,
  ]
}

/**
 * A slow bob, so the head hovers rather than hanging.
 *
 * Amplitude in metres, rate in radians per second. Deliberately slow, on
 * `PortalShimmer`'s stated principle: ambience on something the player looks at
 * for several seconds must not read as a progress indicator.
 */
export const INSTRUCTOR_BOB = { amplitude: 0.075, rate: 1.9 } as const

/**
 * The instructor's world position for a phase and its elapsed time.
 *
 * Returns the ENTRY point for every phase before it arrives and the EXIT point
 * for every phase after it has gone, rather than undefined. A caller that gets a
 * position for a phase the instructor is not in can place it off screen and let
 * the visibility rule be somebody else's decision - which is what the scene wants,
 * because unmounting a component with a 416-vertex ribbon and remounting it costs
 * a geometry rebuild for a character that is coming back in ten seconds.
 */
export function instructorPose(phase: Phase, elapsed: number): [number, number, number] {
  const bob = (at: [number, number, number], t: number): [number, number, number] => [
    at[0],
    at[1] + Math.sin(t * INSTRUCTOR_BOB.rate) * INSTRUCTOR_BOB.amplitude,
    at[2],
  ]

  switch (phase) {
    case 'arriving':
      return [...INSTRUCTOR_ENTER]

    case 'instructorIn':
      /*
        The lift is large on the way in - 1.4 m over an entrance of about seven
        metres - because this is the character's introduction and a swoop is the
        whole of its personality budget.
      */
      return arc(INSTRUCTOR_ENTER, INSTRUCTOR_HOME, elapsed / (DURATIONS.instructorIn ?? 1), 1.4)

    case 'speech1':
      return bob(INSTRUCTOR_HOME, elapsed)
    case 'speech2':
      /*
        The bob's clock continues across the two lines rather than restarting.
        Restarting it would snap the head back to the middle of its travel at the
        exact moment the second line appears, which reads as a hitch.
      */
      return bob(INSTRUCTOR_HOME, elapsed + (DURATIONS.speech1 ?? 0))

    case 'instructorOut':
      // Less lift on the way out. An exit that flourishes as hard as the entrance
      // competes with the cube that is about to arrive.
      return arc(INSTRUCTOR_HOME, INSTRUCTOR_EXIT, elapsed / (DURATIONS.instructorOut ?? 1), 0.8)

    default:
      // Gone. Everything from `cubeIn` onward.
      return [...INSTRUCTOR_EXIT]
  }
}

/** Whether the instructor should be drawn at all. Off screen is still a draw. */
export function instructorVisible(phase: Phase): boolean {
  return (
    phase === 'arriving' ||
    phase === 'instructorIn' ||
    phase === 'speech1' ||
    phase === 'speech2' ||
    phase === 'instructorOut'
  )
}
