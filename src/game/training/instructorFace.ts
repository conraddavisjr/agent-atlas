import { superellipsoidField, superellipsoidY } from '@/game/player/robotGeometry'

/**
 * The instructor's head, face plate, eyes and moustache, as numbers.
 *
 * ## This file exists because the first version's face was invisible
 *
 * The instructor shipped with a 0.245 sphere at z 0.30 standing in for a visor
 * and both eye lenses at z 0.44 with a radius of 0.045. The eyes are 0.1665 from
 * the visor's centre, so `0.1665 + 0.045 = 0.2115` against a radius of 0.245:
 * **both eyes were entirely inside the visor, on every frame, from the day it was
 * written.** The moustache sat at the visor's own centre depth and was mostly
 * swallowed too. What reached the screen was a dark ball with a pale rim, which
 * is a thing, just not a face.
 *
 * That is the third time this project has buried a part inside another one - a
 * sole light "recessed 1 mm above the sole plane" that was inside opaque rubber,
 * a three-ring port whose inner rings were inside a solid disc, and now this. The
 * two before it were caught by measuring the BUILT geometry against the BUILT
 * solid it sits on, and that is the only reason they are not still shipping. The
 * instructor had no such test because its parts were literals inside a `.tsx`,
 * where nothing can reach them.
 *
 * So they are here, they are solved rather than authored where a clearance is at
 * stake, and `instructorFace.test.ts` measures the result.
 *
 * ## The layout it describes
 *
 * The plate is a WIDE, SHALLOW band across the eyes rather than a hemisphere over
 * the whole face. That is the fix for more than the burial: a plate that covers
 * the face leaves nowhere for a moustache, and the brief asks for a large one.
 * The band takes the upper half, the moustache takes the lower, and the two do
 * not compete.
 */

/**
 * The head: a superellipsoid, not the sphere that shipped.
 *
 * The original comment claimed "a superellipsoid-style dome from the same
 * vocabulary the player's head uses" over a `sphereGeometry`. It is one now. The
 * vocabulary matters because the instructor stands next to the hero for eight
 * seconds and a true sphere is the one shape nothing else in this world is -
 * every moulded part here is a superellipsoid with a soft shoulder.
 *
 * Slightly wider than tall, which is what makes a head read as a head rather than
 * as a ball: `HEAD_SHELL` does the same thing on the player.
 */
export const INSTRUCTOR_HEAD = {
  a: 0.355,
  b: 0.325,
  c: 0.335,
  e1: 0.85,
  e2: 0.92,
  /** 1, so the extents are exact and `superellipsoidField` is a valid test. */
  taperTop: 1,
  latSegments: 18,
  lonSegments: 26,
} as const

/**
 * The face plate: a wide shallow band, sunk into the front of the head.
 *
 * `c` is 0.055 against the head's 0.335, so this is a PANEL rather than a dome.
 * The version it replaces was a 0.245 sphere - three quarters of the head's own
 * radius - which is why nothing could be mounted on it without disappearing.
 *
 * Sat above the head's centre so the lower face is clear. The moustache goes
 * there, and it is the character.
 */
export const FACE_PLATE = {
  a: 0.19,
  b: 0.09,
  c: 0.05,
  e1: 0.55,
  e2: 0.7,
  taperTop: 1,
  latSegments: 12,
  lonSegments: 20,
  /**
   * Where its centre sits, in head-local metres.
   *
   * HIGH on the head, and the height was forced by the moustache rather than
   * chosen for its own sake. A large handlebar curls up beside the nose - that is
   * what makes it a handlebar - so it reaches well above its own anchor, and the
   * two parts kept intersecting until the band moved out of its way. A visor band
   * sitting high is also simply what a robot's face looks like here.
   */
  y: 0.1,
  /**
   * How far the plate's own centre sits INSIDE the head's surface.
   *
   * Sunk, not floating: a plate resting exactly on the surface shows a seam all
   * the way round, and one hovering off it reads as a screen the character is
   * holding up.
   *
   * **It must be less than `c`, and the first value was not.** At 0.075 against a
   * half-depth of 0.05 the plate's own front face sat 0.025 BEHIND the head's
   * surface - the whole panel was inside the head, and what shipped was a pair of
   * eyes floating on a bare face. The clearance test passed anyway, because a
   * 0.19-wide plate on a curving head still breaks the surface at its edges;
   * `instructorFace.test.ts` now asks about the front POLE, which is the point
   * that was actually wrong.
   */
  sink: 0.026,
} as const

/** Where the plate sits on Z, solved against the head's surface at its own height. */
export function facePlateZ(): number {
  return superellipsoidZ(0, FACE_PLATE.y, INSTRUCTOR_HEAD) - FACE_PLATE.sink
}

/**
 * The head's surface `|z|` at a given `x` and `y`.
 *
 * `robotGeometry` exports `superellipsoidX` and `superellipsoidY` but not this
 * one, and the instructor needs the Z face because it is the face you look at.
 * Same identity, axes rotated: the shape is symmetric in the exponents, so
 * asking `superellipsoidY` about a shape with `b` and `c` swapped answers about
 * Z on the original.
 */
function superellipsoidZ(x: number, y: number, s: typeof INSTRUCTOR_HEAD): number {
  return superellipsoidY(x, y, { a: s.a, b: s.c, c: s.b, e1: s.e1, e2: s.e2 })
}

/**
 * One eye lens.
 *
 * ## `proud` is measured from the plate's surface, and its sign is the point
 *
 * The first draft called this `embed` and put the lens centre BEHIND the plate's
 * front face - which is what a rivet does, not what a lens does. A sphere whose
 * centre is 0.022 behind the surface shows a cap 0.028 deep out of a 0.1
 * diameter, and the test measured 19% of it outside: technically proud, visually
 * a scratch on a dark panel.
 *
 * A lens sits with its centre AT or slightly in front of the surface, so what
 * you see is a full hemisphere or better. 0.008 forward gives 58%. The back of
 * the sphere is still 0.042 inside the plate, so it is rooted rather than stuck
 * on - which is the property the sign flip could have cost and the test still
 * checks.
 */
export const EYE = {
  radius: 0.05,
  /** Half the gap between the pair. Wide-set, which reads as friendly. */
  x: 0.088,
  /** Above the plate's centre, so the eyes sit high in the band. */
  y: 0.012,
  /** How far the lens centre stands IN FRONT of the plate's surface. */
  proud: 0.008,
} as const

/** The eye's centre in head-local space, solved against the plate's front. */
export function eyeCentre(side: -1 | 1): [number, number, number] {
  const z = facePlateZ() + plateFrontAt(EYE.x, EYE.y) + EYE.proud
  return [side * EYE.x, FACE_PLATE.y + EYE.y, z]
}

/** The plate's own front surface at a point on it, relative to the plate centre. */
function plateFrontAt(x: number, y: number): number {
  const front = superellipsoidY(x, y, {
    a: FACE_PLATE.a,
    b: FACE_PLATE.c,
    c: FACE_PLATE.b,
    e1: FACE_PLATE.e1,
    e2: FACE_PLATE.e2,
  })
  // NaN when the point is off the plate entirely, which is a layout error rather
  // than something to paper over with a fallback.
  if (!Number.isFinite(front)) {
    throw new Error(`instructorFace: (${x}, ${y}) is off the face plate, so no eye can sit there`)
  }
  return front
}

/**
 * The moustache.
 *
 * ## Large, because the brief says large
 *
 * "A large moustache" was the brief's only note about the instructor's face, and
 * the version it replaces had a 0.15 torus mostly inside a visor. This one is
 * 0.20 across the sweep with a 0.055 tube on a head 0.71 wide - about a quarter
 * of the face - and it is the widest thing on the character below the hat.
 *
 * ## A handlebar, which is two decisions
 *
 * The arc sweeps past half a circle so each half curls back on itself, and the
 * pair is rotated so those curls point UP. A moustache that droops reads as sad;
 * the brief asked for playful, and the up-curl is the whole difference.
 */
export const MOUSTACHE = {
  /** Sweep radius and tube radius. */
  radius: 0.185,
  tube: 0.055,
  /** How far each half sits from the centreline. */
  x: 0.125,
  /**
   * Below the head's centre, and low enough that the CURL clears the face plate.
   *
   * The anchor is not the constraint - the free end is. Each half sweeps a radius
   * upward before it curls, so the tube's highest point sits `radius + tube`
   * above this line, and that is the number the plate has to clear.
   */
  y: -0.24,
  /**
   * Clearance of the sweep's CENTRELINE from the head, at its tightest point.
   *
   * Not "how far the anchor floats", which is what it used to mean and why it
   * kept being retuned. See `moustacheZ`.
   *
   * Small on purpose: the tube is 0.055, so a centreline 0.02 clear puts the back
   * of the tube 0.035 into the head at the one tightest point and further out
   * everywhere else. That is a moustache resting on a face - `instructorFace.test`
   * checks both halves of it, that most of the tube is outside and that some of
   * it is not.
   */
  proud: 0.02,
  /** How much of a circle each half sweeps. Past half, so the end curls back. */
  arc: Math.PI * 1.02,
  /**
   * The roll, radians, and its SIGN is the whole difference.
   *
   * `TorusGeometry` sweeps counter-clockwise from +X, so an arc of 1.02 pi is the
   * upper half of a circle: it starts at the outer edge, goes over the top and
   * finishes at the inner edge. Rolled by a POSITIVE angle - which is what the
   * first draft did, at +0.58 pi - that whole arc turns further counter-clockwise
   * and the free end swings down past the horizontal. The moustache droops, which
   * is the one thing the brief ruled out.
   *
   * A quarter turn the other way stands the arc up on its side: it now starts low
   * and near the nose, sweeps out and around, and finishes pointing UP. That is a
   * handlebar. Slightly under a quarter, so the curl leans outward rather than
   * folding back over itself.
   */
  roll: -Math.PI * 0.46,
  /**
   * The wrap, radians: how far each half turns around the head.
   *
   * ## The fix for a flat disc on a curved face
   *
   * A torus is planar. Laid flat against a head, its inner end sits where the
   * head is closest to you and its outer end where the head has already curved
   * away - so any single depth either buries the middle or floats the ends. The
   * first draft floated at 0.02 proud and had a third of its vertices inside the
   * head; pushing it far enough forward to clear them left it hanging in front of
   * the face like a prop moustache on a stick.
   *
   * Turning each half about Y is the answer, and it is also what a real handlebar
   * does: the ends sweep back around the cheeks. `Rz` runs first under three's
   * XYZ euler order, so the roll happens in the moustache's own plane and this
   * turn is applied to the result.
   */
  wrap: 0.45,
  radialSegments: 10,
  tubularSegments: 20,
} as const

/**
 * The moustache's Z, solved against the WHOLE sweep rather than against its anchor.
 *
 * ## Why the anchor is the wrong place to solve
 *
 * The first version asked the head where its surface was at the moustache's own
 * anchor and pushed forward from there. That works for a small part and fails for
 * a large one, because the head curves: the anchor sits low on the face where the
 * head has already fallen away, and the curl reaches up to where it has not. Solve
 * at the anchor and the curl is buried; push forward until the curl clears and the
 * anchor floats off the chin. Two knobs, one number, and no setting of it is right
 * - the geometry says so, which is why it kept being retuned.
 *
 * So this walks the sweep's centreline under its own roll and wrap, asks the head
 * for its surface under every sample, and takes the WORST case. The result clears
 * the head by `proud` at the tightest point on the whole moustache and by more
 * everywhere else, which is what "resting on a face" means.
 *
 * Samples off the head's silhouette are skipped rather than clamped: past the
 * cheek there is no surface to clear, and treating a miss as a constraint would
 * push the whole part forward to satisfy a point that is already in open air.
 */
export function moustacheZ(): number {
  const cosRoll = Math.cos(MOUSTACHE.roll)
  const sinRoll = Math.sin(MOUSTACHE.roll)
  const cosWrap = Math.cos(MOUSTACHE.wrap)
  const sinWrap = Math.sin(MOUSTACHE.wrap)

  let needed = -Infinity
  for (let i = 0; i <= MOUSTACHE_SAMPLES; i++) {
    const t = (i / MOUSTACHE_SAMPLES) * MOUSTACHE.arc
    // The torus's centre circle, in the moustache's own plane.
    const px = Math.cos(t) * MOUSTACHE.radius
    const py = Math.sin(t) * MOUSTACHE.radius
    // Roll about Z first, then wrap about Y - the order the euler ships in.
    const rx = px * cosRoll - py * sinRoll
    const ry = px * sinRoll + py * cosRoll
    const wx = rx * cosWrap
    const wz = -rx * sinWrap

    const surface = superellipsoidZ(MOUSTACHE.x + wx, MOUSTACHE.y + ry, INSTRUCTOR_HEAD)
    if (Number.isFinite(surface)) needed = Math.max(needed, surface - wz)
  }

  // Only if the whole sweep missed the head, which would mean it is not on a face.
  if (!Number.isFinite(needed)) {
    throw new Error('instructorFace: the moustache does not touch the head anywhere')
  }
  return needed + MOUSTACHE.proud
}

/** How finely the solve walks the sweep. 32 puts a sample every 6 degrees. */
const MOUSTACHE_SAMPLES = 32

/**
 * One half of the moustache, as a complete transform.
 *
 * ## Why this is a function and not three props in the component
 *
 * The first version of `instructorFace.test.ts` built the torus, offset it by
 * `moustacheZ` and measured that against the head - and passed judgement on an
 * object that does not exist. The shipped half is ROLLED in its own plane and
 * WRAPPED around the cheek, and those two rotations move every vertex it was
 * measuring. A test that reconstructs a transform by hand is a test of the
 * reconstruction.
 *
 * So the transform lives here, the component spreads it, and the test composes a
 * matrix from it. One derivation, shipped and measured - the same argument
 * `fingerCentreY` and `fistGrip` make, and the same one this face already needed
 * once.
 */
export function moustacheHalf(side: -1 | 1): {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
} {
  return {
    position: [side * MOUSTACHE.x, MOUSTACHE.y, moustacheZ()],
    /*
      Euler XYZ, so `Rz` runs first: the roll turns the curl upward in the
      moustache's own plane, and the wrap then swings that whole shape around the
      head. Reversed, the wrap would tilt the plane and the roll would then spin
      it about an axis that no longer points at the viewer.
    */
    rotation: [0, side * MOUSTACHE.wrap, side * MOUSTACHE.roll],
    // Mirrored rather than built twice: the same buffer, and neither is mutated.
    scale: [side, 1, 1],
  }
}

/**
 * Whether a point is inside the head, for the tests.
 *
 * Exported rather than re-derived in the test file, on `fingerCentreY`'s stated
 * argument: one derivation that the component ships and the test measures, not
 * two that agree with each other while the part floats off the face.
 */
export function insideHead(x: number, y: number, z: number): boolean {
  return superellipsoidField(x, y, z, INSTRUCTOR_HEAD) < 1
}

/** The same, for the face plate, in HEAD-local coordinates. */
export function insidePlate(x: number, y: number, z: number): boolean {
  return (
    superellipsoidField(x, y - FACE_PLATE.y, z - facePlateZ(), {
      a: FACE_PLATE.a,
      b: FACE_PLATE.b,
      c: FACE_PLATE.c,
      e1: FACE_PLATE.e1,
      e2: FACE_PLATE.e2,
    }) < 1
  )
}
