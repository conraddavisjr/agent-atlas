import { BOW_DRAW, BOW_OFFSET, EYE, MISS_RANGE, PLANK_AT, PLANK_RADIUS } from './stage'
import { DURATIONS, type TrainingState } from './trainingMachine'
import { easeOutCubic, plankLayout } from './quiz'

/**
 * One loosed arrow: where it came from, where it is going, and what it found.
 *
 * Recorded at the moment of the shot and then read for as long as the arrow is on
 * screen, which is the whole of `firing` and - for a hit - the whole of
 * `rejecting` on top. It is a record rather than a live simulation because the
 * outcome is already decided: `AimPlane` resolves the hit against the pointer's
 * own ray, so an arrow that re-derived where it landed would be a second system
 * that can disagree with the first, and the player would watch a plunger sail
 * through a plank the game had already scored as a hit.
 */
export type Shot = {
  /** Where the plunger left the bow, world space. */
  from: [number, number, number]
  /** Where it ends up: the plank's face for a hit, far downrange for a miss. */
  to: [number, number, number]
  /** The plank it struck, or null for open space. */
  plank: number | null
  /** The hit point in the plank's own local frame, so it can stick and turn. */
  local: [number, number, number]
}

/**
 * Build the record of a shot from the aim point and the resolved plank.
 *
 * `aim` is the world point under the pointer on `AimPlane`, which is the SAME
 * point the reticle is drawn at and the same one `resolveHit` scored. One ray,
 * three consumers.
 */
export function makeShot(aim: [number, number, number], plank: number | null): Shot {
  const from = nockPoint()

  if (plank === null) {
    /*
      A miss flies ON, it does not stop at the plane.

      The brief asks for an arrow that "travels a projected distance and then
      disappears", and the aim plane is an invisible 14 by 9 sheet hung across the
      targets - stopping there would make every miss halt in mid-air at exactly
      the depth of the planks, which is a stranger thing to watch than a miss.
      Extending along the same direction sends it past the column and out.
    */
    const dx = aim[0] - from[0]
    const dy = aim[1] - from[1]
    const dz = aim[2] - from[2]
    const length = Math.hypot(dx, dy, dz) || 1
    return {
      from,
      to: [
        from[0] + (dx / length) * MISS_RANGE,
        from[1] + (dy / length) * MISS_RANGE,
        from[2] + (dz / length) * MISS_RANGE,
      ],
      plank: null,
      local: [0, 0, 0],
    }
  }

  /*
    A hit stops at the plank's FACE, not at its centre plane.

    The planks are 0.09 thick and the aim plane passes through their middle, so an
    arrow flown to the raw hit point buries the plunger cup half a centimetre
    inside the disc. The brief is explicit that "you should see the plunger hit
    that area of the wooden coin", and a suction cup that has vanished into the
    wood is not a plunger hitting anything.
  */
  const face = PLANK_AT[2] - PLANK_FACE_OFFSET
  return {
    from,
    to: [aim[0], aim[1], face],
    plank,
    /*
      Local to the plank's own group, which is what lets the stuck arrow ride the
      flip. The group sits at the plank's centre with its face toward -Z, so the
      cup's offset is negative.
    */
    local: [
      aim[0] - PLANK_AT[0],
      /*
        The plank's own centre, read from `plankLayout` rather than recomputed
        from `PLANK_AT` and `PLANK_PITCH`. Two derivations of the same column
        would agree today and disagree the moment either constant moved, and the
        symptom - a plunger stuck a few centimetres off where the arrow landed -
        is the kind of thing that reads as "the physics is a bit loose" rather
        than as a bug worth chasing.
      */
      aim[1] - plankLayout()[plank][1],
      -PLANK_FACE_OFFSET,
    ],
  }
}

/** Half the plank's thickness plus a hair, so the cup sits ON the wood. */
export const PLANK_FACE_OFFSET = 0.048

/**
 * Where the arrow starts: the nock, in world space.
 *
 * The bow is a viewmodel, but the camera is parked at `EYE` for the whole quiz
 * and never moves, so the nock has a fixed world position and this can stay a
 * pure function. If the first-person camera ever gains head bob or recoil, this
 * is the line that has to start reading the live camera instead.
 *
 * Minus the draw on Z, because downrange is +Z and a drawn string is pulled the
 * other way.
 */
export function nockPoint(): [number, number, number] {
  return [EYE[0] + BOW_OFFSET[0], EYE[1] + BOW_OFFSET[1], EYE[2] + BOW_OFFSET[2] - BOW_DRAW]
}

/**
 * How far along its flight the arrow is, 0 to 1.
 *
 * Eased OUT rather than linear. A real arrow leaves at full speed and sheds it,
 * and more practically: an arrow that covers the first half of a short flight in
 * the first half of the time is a smear nobody sees leave the bow. Front-loading
 * the travel means the launch is legible and the last few centimetres into the
 * plank are slow enough to read as an impact.
 */
export function flightProgress(state: TrainingState): number {
  if (state.phase !== 'firing') return state.phase === 'aiming' ? 0 : 1
  return easeOutCubic(Math.min(1, state.elapsed / (DURATIONS.firing ?? 0.34)))
}

/**
 * The arrow's world position at a point in its flight.
 *
 * Straight line plus a small droop. The droop is not physics - a real 6 m shot
 * from a toy bow would drop under a centimetre - it is there because a plunger
 * that travels a perfectly straight line reads as a laser, and the eye needs the
 * arc to believe the thing has weight. `DROOP` is deliberately tiny for the same
 * reason it exists at all: enough to see, not enough to make the shot miss what
 * the reticle promised.
 */
export function arrowPosition(shot: Shot, t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t))
  // Parabolic in `c`: zero at both ends, so the arrow arrives exactly where the
  // hit was scored no matter how large `DROOP` gets.
  const sag = DROOP * c * (1 - c) * 4
  return [
    shot.from[0] + (shot.to[0] - shot.from[0]) * c,
    shot.from[1] + (shot.to[1] - shot.from[1]) * c - sag,
    shot.from[2] + (shot.to[2] - shot.from[2]) * c,
  ]
}

/** How far the arrow sags at the middle of its flight, metres. */
export const DROOP = 0.055

/**
 * What the landed plunger is doing, if anything.
 *
 * ## Two modes, because the frame it lives in changes
 *
 * While it is STUCK the plunger belongs to the plank: it is parented to the
 * spinner and rides the flip out and back, which is what makes the hit look like
 * a hit rather than a decal that got left behind. Once it lets go it belongs to
 * the WORLD, because "down" has to mean down.
 *
 * That distinction was a real bug in the first pass. Falling was folded into the
 * `rejecting` phase, and at the moment the plunger let go the plank was 167
 * degrees through its turn - so the local -Y the fall was written against was
 * pointing very nearly straight up, and the plunger rose off the plank and
 * departed toward the ceiling.
 *
 * So the fall happens during `reloading` instead, which is the beat after the
 * plank has come back to square. It also reads better: the plunger holds for the
 * whole verdict, and drops away as the archer reaches for the string.
 *
 * A winning shot never lets go. Nothing about a win asks for the evidence to fall
 * off the board.
 */
export type PlungerState =
  | { mode: 'stuck'; fall: number; fade: number }
  | { mode: 'falling'; fall: number; fade: number }

export function stuckPlunger(state: TrainingState): PlungerState | null {
  if (state.lastHit === null) return null

  if (state.phase === 'rejecting') return { mode: 'stuck', fall: 0, fade: 1 }
  if (state.phase === 'accepting' || state.phase === 'celebrating') {
    return { mode: 'stuck', fall: 0, fade: 1 }
  }

  if (state.phase === 'reloading') {
    const duration = DURATIONS.reloading ?? 0.66
    const t = Math.min(1, Math.max(0, state.elapsed / duration))
    // Quadratic, so it accelerates the way a dropped thing does rather than
    // sliding down at a constant rate.
    return { mode: 'falling', fall: t * t * FALL_DISTANCE, fade: 1 - t * t }
  }

  return null
}

/** How far the plunger falls before it is gone, metres. */
export const FALL_DISTANCE = 1.2

/**
 * Whether a shot's aim point is close enough to a plank to be worth highlighting.
 *
 * A hair more generous than `resolveHit`, and on purpose: the reticle should
 * light up slightly BEFORE the shot would land, so a player who has the plank
 * highlighted and looses is never told they missed. The other way round - a
 * highlight tighter than the hit test - would make the game feel like it was
 * scoring shots the player had not aimed.
 */
export const HIGHLIGHT_RADIUS = PLANK_RADIUS * 1.08
