/**
 * The shapes the character needs that no primitive provides, and the arithmetic
 * that decides where its parts sit relative to each other.
 *
 * Pure functions over `BufferGeometry` and `Vector2`, with no React and no
 * scene dependency, so they are unit testable under the existing vitest glob.
 * `src/art/flowerGeometry.ts` is the precedent.
 *
 * Two things live here that are not shapes, and both are here for the same
 * reason. The first is every "how proud of the part underneath is this part"
 * number on the model: the head cap, the sole ovals, the arm rings, the port on
 * the pack. Those are all one signed-distance question against a `RoundedBox` or
 * a capsule, every one of them has been answered by eye at least once, and every
 * wrong answer renders a clean frame with a healthy triangle count. The deleted
 * `Helmet` is the worst case on record - an 0.84 hemisphere over a 0.72 head with
 * a 0.03 gap at its rim and the antenna sealed inside it.
 *
 * The second is `skinCapeRibbon`, which is per-frame work and is therefore the
 * one exception to the rule below. It mutates buffers that were allocated once
 * and it allocates nothing itself; see `CAPE_RIBBON`.
 *
 * Deliberately local to the player for now. `src/art/geometry.ts` is the shared
 * kit and already owns the two operations these feed into - `beveledExtrude`
 * for the face plate and `latheProfile` for the ear pods - so the outline and
 * profile generators here should be consolidated into it once the character has
 * settled. They are not there today only because that file is being written by
 * another pass at the same time as this one.
 *
 * Nothing here is called per frame. Every geometry is built once at module load
 * or in a `useMemo`, because a `BufferGeometry` rebuilt each frame is a fresh
 * GPU upload and the single most expensive mistake available in this area.
 */

import {
  BufferGeometry,
  Box3,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Sphere,
  Vector2,
  Vector3,
} from 'three'

// ---------------------------------------------------------------------------
// Shape parameters, kept beside the generators rather than in the component.
//
// They are geometry, so they belong where the geometry is testable. The part
// table in docs/design/05-character-vfx.md section 1 is their source and the
// numbers below are its `w x h x d` column halved where the generator wants a
// half-extent.
// ---------------------------------------------------------------------------

/** The squircle face plate. 0.56 x 0.38 with a 0.012 bevel on a 0.012 extrusion. */
export const FACE_PLATE = {
  a: 0.28,
  b: 0.19,
  /** n = 4 is the classic squircle, and the reference brief's "neither square nor round". */
  n: 4,
  segments: 64,
  depth: 0.012,
  bevel: 0.01,
} as const

/**
 * The head shell, as a block rather than as four literals in the component.
 *
 * Here because the ear pods have to be sized against it: a pod that does not
 * clear the shell's side reads as a dent in the cheek rather than as a pod, and
 * a pod that clears it by too much floats free of the head. Both of those are
 * decided by arithmetic between this block and `EAR_POD_SHAPE`, and neither is
 * visible in a screenshot until someone stares at the face.
 *
 * Corner radius 0.110 at smoothness 4 is six segments per corner arc and a 1.9
 * degree facet. Going to 5 costs geometry for nothing visible at this size;
 * below 4 puts steps on the terminator.
 */
export const HEAD_SHELL = {
  width: 0.72,
  height: 0.54,
  depth: 0.62,
  radius: 0.11,
  smoothness: 4,
} as const

/**
 * The copper cap on the back of the head.
 *
 * ## What it replaces, and the arithmetic that condemned the thing it replaces
 *
 * `Helmet()` was a gold `metal()` open hemisphere of radius 0.42, mounted at
 * head-local (0, 0.30, 0) with `side: DoubleSide`, and it had no ref, no quality
 * gate and no test. Three measurements, all recomputed here rather than taken on
 * trust, say it could not have been right:
 *
 *   - **It overhung the head on every axis and the depth was the worse one.**
 *     0.84 diameter over a 0.72 head is 0.06 of overhang per side in X, which is
 *     the number usually quoted. Over a 0.62 DEPTH it is 0.11 per side, nearly
 *     double, so the dome stood furthest proud in exactly the axis the camera
 *     spends most of its time behind.
 *   - **Its rim floated 0.03 above the crown.** The rim plane sat at y 0.300 and
 *     the head's flat top is at y 0.270, so with `DoubleSide` there was an open
 *     slot all the way round through which the gold INTERIOR of the hemisphere
 *     was visible. A lit concave interior seen through a gap is the single
 *     clearest way to make a moulded part read as a hollow prop.
 *   - **It sealed the antenna inside itself.** `REST.antennaBase` is head-local
 *     (0.200, 0.310, -0.040) and the emissive bulb's top reaches y 0.520. The
 *     dome's inner surface above that point is at
 *     `0.30 + sqrt(0.42^2 - (0.200^2 + 0.040^2)) = 0.30 + 0.3672 = 0.667`, and
 *     the bulb's own sphere centre sits 0.2655 from the dome's centre against a
 *     radius of 0.42, so the whole glowing amber bulb was 0.147 clear INSIDE an
 *     opaque metal shell. The one warm light on the character, normalised in
 *     `AntennaUpper` to clear a measured bloom threshold, was rendering into the
 *     inside of a hat.
 *
 * ## Why the replacement is a closed box and not another shell
 *
 * A `RoundedBox` is a closed solid, so there is no interior to see and no
 * `DoubleSide` to need. Overhang is then a design choice rather than a defect:
 * this cap is MEANT to stand proud, because a cap that does not is a paint
 * stripe.
 *
 * Sized so it stands proud by a measured amount rather than a guessed one. The
 * head's own surface is a `RoundedBox` at radius 0.110, so its inner box has
 * half-extents (0.250, 0.160, 0.200) and any point's distance to that box is
 * what decides inside from outside:
 *
 *   - At the back centre, (0, 0.10, -0.33) against the head's -0.31 back face:
 *     **0.020 proud.**
 *   - Over the rear crown, at z -0.24 the head tops out at y 0.2625 and the cap
 *     reaches 0.270: **0.0075 proud**, which is a lip rather than a ledge.
 *   - At the cap's own upper side corners, (0.28, 0.27, -0.33) is 0.164 from the
 *     inner box against the head's 0.110, so **0.054 proud** at the corner the
 *     silhouette reads from behind.
 *
 * It clears both neighbours by arithmetic rather than by luck, which is what
 * `robotGeometry.test.ts` pins. The antenna is at z -0.040 and this cap ends at
 * z -0.090, so it cannot enclose anything. The ear pods span z -0.125 to 0.085
 * and the cap's front face is at -0.090, so the two never intersect.
 */
export const HEAD_CAP = {
  width: 0.56,
  height: 0.34,
  depth: 0.24,
  radius: 0.09,
  smoothness: 4,
  /** Head-local centre. */
  y: 0.1,
  z: -0.21,
} as const

/**
 * The bright blue oval on the sole of each foot.
 *
 * The foot is a `RoundedBox` 0.32 x 0.17 x 0.44 at radius 0.065, so its bottom
 * face is only FLAT over the inner box: `|x| <= 0.095` and `|z| <= 0.155`.
 * Anything wider than that straddles a corner round and leaves a crescent gap
 * between the pad and the sole, which is exactly the artefact that made the ear
 * pods read as a hole in the cheek. At radius 0.085 stretched 1.6 in z the oval
 * spans 0.085 by 0.136, so it clears the flat region by 0.010 and 0.019.
 *
 * It sits 0.001 ABOVE the sole plane rather than flush with it. Flush means
 * coplanar with the ground the character stands on, which z-fights; proud means
 * the light is what takes the character's weight. Recessed by a millimetre is
 * the only version with no failure mode, and it costs nothing visually because
 * a planted sole is not visible anyway - this mark is for the moment the foot
 * leaves the floor.
 */
export const SOLE_LIGHT = {
  radius: 0.085,
  /** Stretch along z, so it is an oval along the foot rather than a circle. */
  stretchZ: 1.6,
  thickness: 0.012,
  /** Clearance of the pad's own bottom face above the sole plane. */
  lift: 0.001,
  segments: 20,
} as const

/**
 * The band and the bevel on the upper arm.
 *
 * The reference's arm is white with a blue band and a visible cuff, and a bare
 * capsule has neither. Both rings are filleted cans from `roundedDiscProfile`
 * rather than boxes or tori, so they reuse the ear pod's generator and inherit
 * its rule: no plastic object in this world has a 90 degree corner, and on a
 * part this small the fillet is most of what the eye reads because it is the
 * only surface that catches the key as a bright line.
 *
 * `y` is not free. The arm capsule has radius 0.075 and a cylindrical section of
 * 0.09, centred at shoulder-local y -0.13, so it is only at FULL radius between
 * y -0.175 and y -0.085. Outside that band the capsule is already curving in,
 * and a ring of fixed radius placed there stands proud by a growing amount and
 * reads as a collar floating off the arm rather than as a band around it. Both
 * rings sit inside the band, and `robotGeometry.test.ts` checks it.
 */
export const ARM_BAND = {
  /** 0.007 proud of the capsule's 0.075, so it is a band and not a paint stripe. */
  radius: 0.082,
  halfThickness: 0.0175,
  fillet: 0.006,
  filletSteps: 3,
  radialSegments: 16,
  /*
    -0.105 and not -0.100, so the ring's own upper RIM clears y -0.085 rather
    than only its centre doing so. At -0.100 the rim overhung the band's top by
    0.0025, where the capsule has already narrowed to 0.07496 from 0.075 - which
    is 0.04 mm and invisible, and is fixed anyway because the point of putting the
    band in a named block was to make the constraint checkable rather than nearly
    true.
  */
  y: -0.105,
} as const

/** The narrower cuff bevel nearer the wrist. Same generator, same rule. */
export const ARM_BEVEL = {
  radius: 0.079,
  halfThickness: 0.009,
  fillet: 0.004,
  filletSteps: 3,
  radialSegments: 16,
  /*
    -0.164 and not -0.175 for the same reason as the band above: at the band's own
    lower bound the ring's lower rim hung 0.009 below it. It also leaves 0.0325 of
    bare arm between the two rings, which is what stops them reading as one wide
    stripe.
  */
  y: -0.164,
} as const

/**
 * The ear pods, whose axis lies along X so they flap forward and back rather
 * than up and down.
 *
 * `halfThickness` is 0.105 and not the 0.040 this shipped with, and the change
 * is the fix for "there is a hole in the character's face" in
 * `.critique/round1-findings.md`. At 0.040 the pod spans x 0.340 to 0.420
 * against a head whose flat side is at 0.360, so five sixths of it is buried
 * and the only part on screen is a 0.06 m crescent of its own rim, seen almost
 * exactly edge on because the axis points at the camera's left. A dark crescent
 * hugging the inside of the cheek's silhouette is a gouge, and both critique
 * reviewers read it as one.
 *
 * The design spec disagrees with itself about which number is right. Its part
 * table gives the pod as `0.08 x 0.21 x 0.21`, which is halfThickness 0.040.
 * Two paragraphs later the same section computes the outer extent as
 * `0.380 + 0.105 = 0.485` and builds the width ladder on it - "head including
 * ear pods, 0.970, deliberately the widest thing on the character" - and its
 * silhouette test draws the pods breaking the head's boxy top corners. That
 * second number is the one three separate claims depend on, so it is the one
 * taken: it uses the RADIUS as the extent along the pod's own axis, which is
 * only true when the half-thickness equals the radius.
 *
 * So the pod becomes a filleted can 0.21 long and 0.21 across. It buries 0.085
 * in the shell, which is what keeps it attached with no stalk to model, and
 * stands 0.125 proud, which is what puts it outside the head's outline where it
 * cannot be read as a hole in it.
 *
 * The fillet goes 0.022 to 0.030 with a step more of resolution for the same
 * reason: at the old size it was the whole of what the eye read, and at this one
 * a 0.022 chamfer on a 0.21 object is barely over a pixel at playing distance.
 */
export const EAR_POD_SHAPE = {
  radius: 0.105,
  halfThickness: 0.105,
  fillet: 0.03,
  filletSteps: 5,
  radialSegments: 20,
} as const

/** The mitten hand. Here only because it is what fixes the character's width. */
export const HAND = { radius: 0.14 } as const

/**
 * The backpack block, and the circular port that says the thing is powered.
 *
 * Here because the cape's clearance is measured against its rear face, and that
 * clearance is a number rather than a judgement: the back socket is deliberately
 * coincident with this block, so a cape surface placed at the socket starts
 * inside the pack and appears to grow out of the middle of it.
 *
 * ## The circle on the back, and what it displaced
 *
 * The reference has a circle on the back and this model had a 0.22 x 0.04
 * rectangular vent. Both do not fit, and the arithmetic is what decided it
 * rather than taste. A `RoundedBox` is flat only away from its corner rounds, so
 * the pack's rear face is flat over `|x| <= 0.180 - 0.055 = 0.125` and
 * `|y| <= 0.130 - 0.055 = 0.075` - a usable area 0.250 by 0.150. A port big
 * enough to read as a circle needs about 0.136 of that 0.150, which leaves
 * nothing for a 0.04 bar below it. Placing either one outside the flat region
 * puts it across a corner round, where it leaves a crescent gap between its own
 * rim and the shell: that is the exact artefact both critique reviewers read as
 * "there is a hole in the character's face" when the ear pods did it.
 *
 * So the vent is replaced rather than moved, and the reasoning it carried is
 * inherited by the port's core rather than lost. That reasoning: this element
 * stays deliberately UNDER the bloom threshold at `GLOW.source`, which is 66% of
 * it, because it faces away from the camera almost always and a bloom here would
 * rim-light the back of the head from behind.
 *
 * Three concentric rings rather than one disc, because every LED in the
 * reference is a bright core inside a darker housing and never a bright surface
 * on its own, and because a flat emissive disc is precisely the "reads as bright
 * plastic rather than as a light" failure the art bible's section 1 is about.
 * Only the core is emissive.
 *
 * The z values stack front to back as bezel 0.082, core 0.080, well 0.078, all
 * measured from the pack's own centre, so the rim stands proudest, the lit pip
 * sits 0.002 inside it and the dark well sits 0.002 behind that. Asserted rather
 * than trusted: a port whose well ended up in FRONT of its bezel would render a
 * dark disc over the light and would still be a clean frame.
 */
export const BACKPACK_BLOCK = {
  width: 0.36,
  height: 0.26,
  depth: 0.14,
  radius: 0.055,
  port: {
    /** Copper rim. 0.068 against a flat half-height of 0.075 leaves 0.007. */
    bezelRadius: 0.068,
    bezelDepth: 0.016,
    bezelZ: -0.074,
    /** The dark recess the core sits in. */
    wellRadius: 0.05,
    wellDepth: 0.01,
    wellZ: -0.073,
    /** The lit pip. Small on purpose: a pilot light, not a lamp. */
    coreRadius: 0.03,
    coreDepth: 0.008,
    coreZ: -0.076,
    segments: 24,
  },
} as const

/**
 * The cape's cross-section.
 *
 * ## What survives from the panel version, and what does not
 *
 * These four numbers were the dimensions of ONE of four nested `RoundedBox`
 * slabs. The slabs are gone - see `CAPE_RIBBON` - but the cross-section they
 * described is exactly right and is reused verbatim, because the reasoning
 * behind it was never about the segmentation.
 *
 * The reasoning, kept because it is still load-bearing:
 * `.critique/round1-findings.md` F4 found "a flat unlit magenta quad is attached
 * to the character in every shot", from four `PlaneGeometry` panels at
 * `side: 2`. A zero-thickness double-sided quad has one normal over its whole
 * area, so it takes exactly one lighting value however good the rig is and reads
 * as unlit paint; it has no edge to catch a bevel highlight; and seen anywhere
 * near edge on it collapses to a coloured line, which is what put "a purple line
 * on the floor" into `hub-character`.
 *
 * 0.030 thick with a 0.010 chamfer leaves a 0.010 flat face between two bevels,
 * so the cape is a moulded vinyl sheet with a bright line down each long edge
 * rather than a sheet of paper. That is why the ribbon still has a real
 * thickness and hard-edged chamfers rather than being a subdivided plane: making
 * the cape continuous fixes the staircase, and it must not undo F4 on the way.
 *
 * What DID change: `bevelSmoothness` is gone, because there is no `RoundedBox`
 * left to smooth. The chamfer is now four explicit flats in the ribbon's ring.
 *
 * ## `z`, and the clearance that moved
 *
 * The back socket is deliberately coincident with the backpack block, which is
 * what the cape hangs off, but the pack is 0.14 deep and spans z -0.22 to -0.36
 * around that point, so a surface at the socket itself starts INSIDE the pack and
 * appears to grow out of the middle of it.
 *
 * `z` was -0.095, which put the cape's front face 0.010 clear of the pack's flat
 * rear face at -0.070. **That clearance was measured against a face that no longer
 * exists.** The circular port added to the pack in this pass stands 0.012 proud of
 * it, reaching z -0.082, so the old cape front at -0.080 interpenetrated the port's
 * bezel by 0.002. Two solid parts 2 mm inside each other renders perfectly, casts a
 * clean shadow and reports every triangle present.
 *
 * -0.108 puts the front face at -0.093 and clears the PORT by 0.011, which is now
 * the binding constraint and is what the test asserts. The pack's own face is
 * cleared by 0.023 as a side effect.
 *
 * What this does NOT fix, and is a decision rather than an oversight: the port sits
 * at pack-local y 0, which is exactly the height of the cape socket, so an equipped
 * cape hangs over the port's lower half. The pack's flat rear face is only 0.150
 * tall and the port is 0.136 across, so there is nowhere to move it. A cape
 * covering the pack it hangs off is what a cape does; the port is fully visible
 * whenever the cosmetic is not equipped.
 */
export const CAPE_PANEL = {
  width: 0.34,
  thickness: 0.03,
  bevel: 0.01,
  z: -0.108,
} as const

/**
 * The cape, as one continuous surface.
 *
 * ## The defect this replaces
 *
 * The cape was four nested `RoundedBox` slabs of 0.34 x 0.18 x 0.03, each a
 * child of the one above it, each rotated by its own spring. Four rigid plates
 * hinged end to end is a staircase: at the 0.856 rad of total sweep the chain
 * reaches at full speed, each joint is a 12.3 degree crease with a 0.030 thick
 * lip on the outside of it, and the reference's own rule about visible joins
 * between rigid panels does not save it - that rule is about a panel LINE, not
 * about a hinge that opens and closes as the character runs.
 *
 * ## What replaces it, and why on the CPU
 *
 * A closed ribbon of 24 facets down its length, skinned from the SAME four
 * spring angles. The springs are untouched: `SPRINGS.cape0..3` are well tuned,
 * `springs.test.ts` pins their overshoot and settle times, and nothing here
 * changes what they do. What changes is that they now drive a continuous surface
 * instead of four plates.
 *
 * The obvious implementation is a vertex shader with four uniforms, and it was
 * rejected for a reason that is not in the art bible's section 4 and should be:
 * **`onBeforeCompile` does not touch the shadow depth material.** three renders
 * the shadow pass with its own `depthMaterial`, so a cape bent on the GPU would
 * cast the shadow of an unbent plank. The cape is 0.72 m long and hangs across
 * the character's own contact shadow, so that mismatch would be plainly visible
 * and would be exactly the class of failure this codebase has been cut by four
 * times: no error, a clean frame, and a wrong picture. A `ShaderMaterial` from
 * scratch has the same problem plus a worse one, since it would receive no
 * lights at all and F4 is precisely about an unlit cape.
 *
 * Skinning on the CPU has neither problem. The geometry is what it is, so the
 * shadow pass, the lighting, the sheen and the clearcoat all come for free from
 * an unpatched `vinyl()`, and the arithmetic is a pure function this file's test
 * can drive without a GPU.
 *
 * The cost is one buffer upload per frame, and it is small: 416 vertices is
 * 1,248 floats of position plus the same of normal, about 10 kB per frame or
 * 600 kB/s at 60 Hz. That is a different thing from the "BufferGeometry rebuilt
 * per frame" this file warns about at the top - the geometry, its index and its
 * attribute objects are all built once and only their contents change.
 *
 * ## Why the normals are analytic rather than `computeVertexNormals`
 *
 * For a rigid cross-section swept along a curve, the surface normal is exactly
 * the cross-section's own 2D normal carried into the moving frame. Writing
 * `dP/ds = T + omega x f` for an offset `f` in the cross-section plane and
 * `omega = kappa * B` gives `omega x f = -kappa * n * T`, which is PARALLEL to
 * the tangent - so the curvature scales `dP/ds` but cannot rotate it, and the
 * normal direction is unaffected. The result is exact for the ideal surface, it
 * allocates nothing, and it is cheaper than the cross products
 * `computeVertexNormals` would do over 396 triangles.
 *
 * Two second-order errors are accepted and named. The roll component of the
 * frame's rotation is about the tangent rather than the binormal, so it does
 * perturb the normal - but the roll targets peak at `6 * 0.019 * 0.6 = 0.068`
 * rad, where the error is under a quarter of a per cent. And the flare tilts the
 * side faces out of the tangent plane by `atan(0.10 * 0.17 / 0.72) = 1.4`
 * degrees, which is below the shading resolution of any light in this rig.
 */
export const CAPE_RIBBON = {
  /** One per spring. Fixed at 4 because `Pose.cape` and `SPRINGS.cape0..3` are. */
  segments: 4,
  /**
   * Facets per spring segment, so 24 down the length.
   *
   * Six rather than three because the crease is what is being fixed: at the
   * steady-state sweep of 0.856 rad the per-facet angle is 2.04 degrees, which
   * is below the 1.9 degree facet the head shell's `smoothness: 4` was chosen
   * for and is therefore invisible at the same distance. At three it would be
   * 4.1 degrees and the fix would only be half made.
   */
  stepsPerSegment: 6,
  /**
   * Half-width multiplier at the hem.
   *
   * A cape that leaves the socket and arrives at the hem at the same width is a
   * plank. 1.10 is small enough that it never reads as a bell and large enough
   * that the two long edges are visibly not parallel, which is what says
   * "hanging sheet" rather than "attached board".
   */
  flare: 1.1,
  /**
   * Culling radius, set ONCE and never recomputed.
   *
   * This matters more than it looks. three culls on `boundingSphere`, and a
   * deforming geometry whose sphere is computed from its rest pose gets clipped
   * out of the frame - or out of the SHADOW frustum, which is worse because the
   * cape simply stops casting - the moment it swings outside it. Recomputing per
   * frame instead would cost a pass over every vertex and would make the shadow
   * frustum jitter. So the sphere is sized for the worst pose the chain can
   * reach: 0.72 of length plus 0.110 of thickness offset is 0.830 of reach in any
   * direction, and 0.187 of half-width across it, so `hypot(0.830, 0.187)` is
   * 0.851. 0.90 from the socket carries it with margin.
   */
  cullRadius: 0.9,
} as const

/** Ring positions per row, in the row's own frame. 8 flats, so 8 runs of 2 ends. */
const RIBBON_RUNS = 8

/**
 * A cape ribbon: the geometry, plus the rest cross-sections that skin it.
 *
 * The rest data is precomputed at construction because it never changes: the
 * flare, the chamfer and the thickness are static, and only the FRAME each ring
 * is carried into moves. So the per-frame work is 25 frame composes and 416
 * transforms, with no trigonometry per vertex.
 */
export type CapeRibbon = {
  geometry: BufferGeometry
  /** Rows of cross-sections, `stepsPerSegment * segments + 1` of them. */
  rowCount: number
  /** Facet steps down the length, one fewer than `rowCount`. */
  steps: number
  /** Arc length of one step, metres. */
  stepLength: number
  /** `(x, z)` per row per run per end, relative to the ribbon's own centreline. */
  ring: Float32Array
  /** `(nx, nz)` per row per run. Both ends of a run share it, which is the hard edge. */
  ringNormal: Float32Array
  /** `(x, z)` of the 8 distinct ring positions at the socket and at the hem. */
  capTop: Float32Array
  capBottom: Float32Array
  /** Index of the first top-cap vertex, and of the first bottom-cap vertex. */
  capTopFirst: number
  capBottomFirst: number
}

/**
 * Builds the ribbon once.
 *
 * `segmentLength` is passed rather than imported so this file owes nothing to
 * `animTuning.ts`, which owns feel rather than shape. The caller is `rig.ts`,
 * which already has `CAPE`.
 */
export function createCapeRibbon(segmentLength: number): CapeRibbon {
  if (!(segmentLength > 0)) {
    throw new Error(`robotGeometry: a cape segment must have positive length, got ${segmentLength}`)
  }

  const { segments, stepsPerSegment, flare } = CAPE_RIBBON
  const steps = segments * stepsPerSegment
  const rowCount = steps + 1
  const stepLength = segmentLength / stepsPerSegment

  const halfWidth = CAPE_PANEL.width / 2
  const h = CAPE_PANEL.thickness / 2
  const c = CAPE_PANEL.bevel
  if (!(c < halfWidth) || !(c < h)) {
    throw new Error(
      `robotGeometry: a cape chamfer of ${c} does not fit inside half-width ${halfWidth} and ` +
        `half-thickness ${h}; the cross-section would fold through itself`,
    )
  }

  const ring = new Float32Array(rowCount * RIBBON_RUNS * 2 * 2)
  const ringNormal = new Float32Array(rowCount * RIBBON_RUNS * 2)
  const capTop = new Float32Array(RIBBON_RUNS * 2)
  const capBottom = new Float32Array(RIBBON_RUNS * 2)

  // Scratch for one row's eight distinct ring positions.
  const px = new Float64Array(RIBBON_RUNS)
  const pz = new Float64Array(RIBBON_RUNS)

  for (let r = 0; r < rowCount; r++) {
    const t = r / steps
    const w = halfWidth * (1 + (flare - 1) * t)

    /*
      The cross-section, counter-clockwise in the row's own (x, z) plane with x
      to the character's left and z toward its front. The OUTER face - the one
      the camera sees, away from the body - is at -h, because the cape hangs
      behind the character and its centreline is already pushed back by
      CAPE_PANEL.z.

      Eight positions and therefore eight flats: outer face, chamfer, side,
      chamfer, inner face, chamfer, side, chamfer.
    */
    px[0] = -(w - c); pz[0] = -h
    px[1] = w - c;    pz[1] = -h
    px[2] = w;        pz[2] = -(h - c)
    px[3] = w;        pz[3] = h - c
    px[4] = w - c;    pz[4] = h
    px[5] = -(w - c); pz[5] = h
    px[6] = -w;       pz[6] = h - c
    px[7] = -w;       pz[7] = -(h - c)

    for (let k = 0; k < RIBBON_RUNS; k++) {
      const k1 = (k + 1) % RIBBON_RUNS
      const base = (r * RIBBON_RUNS + k) * 2
      ring[base * 2] = px[k]
      ring[base * 2 + 1] = pz[k]
      ring[(base + 1) * 2] = px[k1]
      ring[(base + 1) * 2 + 1] = pz[k1]

      /*
        The outward normal of a counter-clockwise edge `(dx, dz)` is `(dz, -dx)`.
        Checked against the one run whose answer is obvious: the outer face runs
        +x, giving `(0, -1)`, which points away from the body. Every other run
        follows from the same rule, which is why they are derived rather than
        typed in - eight hand-written normals is eight chances to invert one, and
        an inverted normal on a closed solid renders as a black facet that no
        counter reports.
      */
      const dx = px[k1] - px[k]
      const dz = pz[k1] - pz[k]
      const len = Math.hypot(dx, dz) || 1
      ringNormal[(r * RIBBON_RUNS + k) * 2] = dz / len
      ringNormal[(r * RIBBON_RUNS + k) * 2 + 1] = -dx / len
    }

    if (r === 0 || r === steps) {
      const cap = r === 0 ? capTop : capBottom
      for (let k = 0; k < RIBBON_RUNS; k++) {
        cap[k * 2] = px[k]
        cap[k * 2 + 1] = pz[k]
      }
    }
  }

  const sideCount = rowCount * RIBBON_RUNS * 2
  const capTopFirst = sideCount
  const capBottomFirst = sideCount + RIBBON_RUNS
  const vertexCount = sideCount + RIBBON_RUNS * 2

  const indices: number[] = []
  for (let k = 0; k < RIBBON_RUNS; k++) {
    for (let r = 0; r < steps; r++) {
      const a = (r * RIBBON_RUNS + k) * 2
      const d = ((r + 1) * RIBBON_RUNS + k) * 2
      // (a, a+1, d+1) and (a, d+1, d): both wind so the face normal agrees with
      // the run normal above. Verified on the outer face, where +x across and -y
      // down cross to -z.
      indices.push(a, a + 1, d + 1, a, d + 1, d)
    }
  }
  /*
    Caps. The fan `(0, i, i+1)` over a counter-clockwise ring in (x, z) produces
    a face whose normal is -y, so that ordering is the HEM and the socket end is
    the reverse. Both are included even though the socket cap is buried in the
    backpack: an open tube is not a solid, and a shadow pass over a non-closed
    surface leaks light through the hem, which is the visible end.
  */
  for (let i = 1; i < RIBBON_RUNS - 1; i++) {
    indices.push(capTopFirst, capTopFirst + i + 1, capTopFirst + i)
    indices.push(capBottomFirst, capBottomFirst + i, capBottomFirst + i + 1)
  }

  const geometry = new BufferGeometry()
  const position = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3)
  const normal = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3)
  // Both are rewritten every frame, so tell the driver rather than let it guess.
  position.setUsage(DynamicDrawUsage)
  normal.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('normal', normal)
  geometry.setIndex(indices)

  /*
    Bounds set by hand and never recomputed. See CAPE_RIBBON.cullRadius: a
    deforming mesh whose sphere came from its rest pose gets culled out of the
    camera or, worse, out of the shadow frustum as soon as it swings.
  */
  const r = CAPE_RIBBON.cullRadius
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), r)
  geometry.boundingBox = new Box3(new Vector3(-r, -r, -r), new Vector3(r, r, r))

  const ribbon: CapeRibbon = {
    geometry,
    rowCount,
    steps,
    stepLength,
    ring,
    ringNormal,
    capTop,
    capBottom,
    capTopFirst,
    capBottomFirst,
  }
  // Written once at construction so a ribbon that is never skinned still has a
  // shape rather than collapsing to a point at the origin.
  skinCapeRibbon(ribbon, REST_CAPE_ANGLES)
  return ribbon
}

/** One bend per spring. Only `rx` and `rz` are read; the springs have no `ry`. */
export type CapeBend = { readonly rx: number; readonly rz: number }

const REST_CAPE_ANGLES: readonly CapeBend[] = [
  { rx: 0, rz: 0 },
  { rx: 0, rz: 0 },
  { rx: 0, rz: 0 },
  { rx: 0, rz: 0 },
]

/*
  Scratch for the frame walk, at module scope so the skin allocates nothing.

  `Euler` defaults to order 'XYZ', which is what `rig.ts` writes onto every other
  joint, so the same angles produce the same rotation here as they did on the
  four `Group` nodes this replaces. That is worth stating because the XYZ order
  composes as `Rx * Ry * Rz` rather than the other way round, and getting it
  backwards would show up only as a cape that rolls the wrong way at speed.
*/
const RIBBON_FRAME = /*@__PURE__*/ new Matrix4()
const RIBBON_HALF = /*@__PURE__*/ new Matrix4()
const RIBBON_TRANS = /*@__PURE__*/ new Matrix4()
const RIBBON_STEP = /*@__PURE__*/ new Matrix4()
const RIBBON_EULER = /*@__PURE__*/ new Euler()

/**
 * Writes the four bend angles onto the ribbon's vertices.
 *
 * Pure, allocation-free and testable in node: a `BufferGeometry` is a typed
 * array with no GL context behind it, which is the same property that lets
 * `rig.ts` be covered.
 *
 * Each step rotates by its segment's share of that segment's angle and then
 * advances one `stepLength` down the new -Y, so the total rotation accumulated
 * over `stepsPerSegment` steps is exactly the segment's own angle and the tip's
 * total sweep is exactly the sum of the four. Distributing the rotation along
 * the segment rather than applying it at the joint is the whole difference
 * between an arc and the staircase: with equal angles the result is a
 * constant-curvature arc, which is what a cape streaming behind a runner
 * actually is.
 */
export function skinCapeRibbon(ribbon: CapeRibbon, bends: readonly CapeBend[]): void {
  const { geometry, rowCount, steps, stepLength, ring, ringNormal } = ribbon
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const { stepsPerSegment } = CAPE_RIBBON
  const zMid = CAPE_PANEL.z

  RIBBON_FRAME.identity()

  for (let r = 0; r < rowCount; r++) {
    const e = RIBBON_FRAME.elements
    const ox = e[12]
    const oy = e[13]
    const oz = e[14]
    const axx = e[0]
    const axy = e[1]
    const axz = e[2]
    const ayx = e[4]
    const ayy = e[5]
    const ayz = e[6]
    const azx = e[8]
    const azy = e[9]
    const azz = e[10]

    for (let k = 0; k < RIBBON_RUNS; k++) {
      const nSlot = (r * RIBBON_RUNS + k) * 2
      const nx = ringNormal[nSlot]
      const nz = ringNormal[nSlot + 1]
      const wnx = axx * nx + azx * nz
      const wny = axy * nx + azy * nz
      const wnz = axz * nx + azz * nz

      for (let end = 0; end < 2; end++) {
        const v = (r * RIBBON_RUNS + k) * 2 + end
        const x = ring[v * 2]
        const z = ring[v * 2 + 1] + zMid
        position.setXYZ(v, ox + axx * x + azx * z, oy + axy * x + azy * z, oz + axz * x + azz * z)
        normal.setXYZ(v, wnx, wny, wnz)
      }
    }

    if (r === 0 || r === steps) {
      const cap = r === 0 ? ribbon.capTop : ribbon.capBottom
      const first = r === 0 ? ribbon.capTopFirst : ribbon.capBottomFirst
      // The socket cap faces up the cape, the hem cap faces down it.
      const s = r === 0 ? 1 : -1
      for (let k = 0; k < RIBBON_RUNS; k++) {
        const x = cap[k * 2]
        const z = cap[k * 2 + 1] + zMid
        position.setXYZ(
          first + k,
          ox + axx * x + azx * z,
          oy + axy * x + azy * z,
          oz + axz * x + azz * z,
        )
        normal.setXYZ(first + k, s * ayx, s * ayy, s * ayz)
      }
    }

    if (r === steps) break
    /*
      Half the step's rotation, then the translation, then the other half.

      Rotating the whole step before translating is first order, and the error is
      not random: every chord leans the same way, so the hem lands systematically
      SHORT of the arc the angles describe. Measured at the steady-state sweep it
      was 11.6 mm, against a predicted `L * theta / 2n = 0.72 * 0.856 / 48 =
      12.8 mm`. That is a tenth of a segment length on the most visible secondary
      motion on the character, and it would have made every future measurement of
      the cape disagree with the arithmetic in `animTuning.ts` by a constant.

      Splitting the rotation either side of the translation is the trapezoid rule
      and takes the error to `L * theta^2 / 24n^2`, about 0.04 mm. The accumulated
      rotation is unchanged, because the two halves still sum to the step's own
      angle, so the tip's total sweep is still exactly the sum of the four springs.
    */
    const bend = bends[Math.floor(r / stepsPerSegment)]
    RIBBON_EULER.set(bend.rx / (stepsPerSegment * 2), 0, bend.rz / (stepsPerSegment * 2))
    RIBBON_HALF.makeRotationFromEuler(RIBBON_EULER)
    RIBBON_TRANS.makeTranslation(0, -stepLength, 0)
    RIBBON_STEP.multiplyMatrices(RIBBON_HALF, RIBBON_TRANS)
    RIBBON_STEP.multiply(RIBBON_HALF)
    RIBBON_FRAME.multiply(RIBBON_STEP)
  }

  position.needsUpdate = true
  normal.needsUpdate = true
}

/**
 * The torso. 0.62 x 0.36 x 0.52 at its half-extents, tapering to 0.84 of its
 * width at the crown.
 */
export const TORSO = {
  a: 0.31,
  b: 0.18,
  c: 0.26,
  e1: 0.6,
  e2: 0.7,
  taperTop: 0.84,
  latSegments: 20,
  lonSegments: 28,
} as const

/**
 * The face glyph's shape, in face-plate space.
 *
 * Plate space runs `x` over `+-aspect/2` and `y` over `+-0.5`, where aspect is
 * the plate's own 0.56 by 0.38. These live here rather than inline in the
 * shader string so `robotGeometry.test.ts` can assert on them: the SDF is
 * perfectly well-formed arithmetic for any parameters, so a wrong half-extent
 * produces an invisible glyph rather than an error, and the only two places that
 * shows are a screenshot and a test.
 *
 * ## Two round lenses, which is a deliberate reversal
 *
 * This block used to describe one continuous horizontal stadium with two hotter
 * cores inside it, and the reasoning behind that shape was not a guess - it was
 * the project's stated identity constraint, written into `palette.ts`,
 * `RobotModel.tsx`, `05-character-vfx.md` section 7 and a test in this file's
 * companion called "keeps the bar lit through a full blink". The argument was
 * that the reference character loses its eyes on a blink and this one would not.
 *
 * **That goal has been abandoned on purpose.** The decision on record is to
 * clone the reference's head one-to-one, so the bar is gone and the eyes are two
 * round lenses on the dark plate. The consequence is accepted rather than
 * mitigated: at `openL` 0.06 the lens collapses to a 0.129 m by 0.004 m line and
 * the face effectively does go dark through a blink, which is what the reference
 * does.
 *
 * Sized from `00-references.md` section 8's measured numbers rather than
 * invented, because they are the only quantitative statement anyone made about
 * this shape: "two rounded-rect LED panels, each ~22-28% of face-plate width,
 * one eye-width apart, at 55-60% down the face plate."
 *
 *   - Lens diameter `2 * 0.17 * 0.38 = 0.1292 m`, which is **23.1%** of the
 *     0.56 m plate. Inside the 22-28% band.
 *   - Centres at `+-0.34`, so the gap between the two lenses is
 *     `2 * (0.34 - 0.17) = 0.34` plate units, exactly **one lens width**. The
 *     offset being twice the radius is what makes that exact rather than close.
 *   - Centre at `y -0.07`, which is **57%** down the plate. Inside the 55-60%
 *     band, and unchanged from the bar it replaces.
 *   - Outer edge at `0.34 + 0.17 = 0.51` against a plate half-width of
 *     `aspect / 2 = 0.7368`, so 0.227 of margin. The bar it replaces reached
 *     0.566 and had 0.171. The new glyph is smaller in every direction, which is
 *     the point: two lenses need less room than the stadium that contained them.
 *
 * Both axes of plate space are at the SAME scale, so `lensHalfW == lensHalfH`
 * genuinely is a circle rather than an ellipse that happens to look round. See
 * `metresPerUnit`.
 */
export const VISOR = {
  /** Plate aspect, 0.56 wide over 0.38 tall. */
  aspect: 0.56 / 0.38,
  /**
   * Metres per unit of plate space.
   *
   * The fragment builds `p = (vUv - 0.5) * vec2(aspect, 1.0)`, so x runs over
   * `+-aspect/2` and y over `+-0.5`, and BOTH axes end up at the same scale:
   * one unit is 0.56 / aspect = 0.38 m. That is the entire point of the aspect
   * multiply and it is what the design spec's own numbers overlook. The spec
   * reads a half-extent of 0.215 as "0.274 m across a 0.56 m plate", which
   * would only hold if x ran over +-0.5, and separately calls the same bar 77%
   * of the plate width, which 0.274 over 0.56 is not either. Three figures,
   * none of which agree.
   */
  metresPerUnit: 0.38,
  /**
   * The eyes' vertical centre: 57% down the plate rather than at its middle,
   * which is the infantile placement. Eyes at the vertical centre read as an
   * adult on any head shape.
   */
  y: -0.07,
  /**
   * One lens: the glowing round housing, and how far each sits from the centre.
   *
   * `lensHalfW == lensHalfH` and the SDF's corner radius equals them both, which
   * makes `sdRoundBox` degenerate to `length(p) - r` exactly - a true circle
   * rather than a square with generous corners.
   *
   * A blink scales `lensHalfH` by `open` while the radius follows the smaller
   * axis, so the circle becomes a stadium of the same width with fully rounded
   * ends. That is the reference's blink: the eye squashes rather than shrinking.
   */
  lensOffset: 0.34,
  lensHalfW: 0.17,
  lensHalfH: 0.17,
  /**
   * The hot core inside each lens, as a FRACTION of the lens's own half-extents.
   *
   * Not decoration. Every LED in the reference is a bright core inside a darker
   * housing, and a single flat emissive disc is exactly the "reads as bright
   * plastic rather than as a light" failure the art bible's section 1 is written
   * against. The core is the part that clears the bloom threshold; the lens around
   * it deliberately does not.
   *
   * A radial falloff and not a second SDF shape, which is the one place this glyph
   * is genuinely cheaper than the bar it replaces rather than merely different.
   * `coreInner` is where the core is still flat out and `coreOuter` is where it has
   * fallen to the lens's own level, both in units of the lens radius, so 0.55 is
   * 0.0935 of plate space or 0.0355 m.
   *
   * Dimensionless on purpose. The lens squashes on a blink and stretches on a
   * surprise, and a core expressed in plate metres would stay a round hotspot
   * inside a slit. Expressed as a fraction it squashes with its housing, which is
   * what a real lens does.
   */
  coreInner: 0.3,
  coreOuter: 0.55,
  /**
   * Gaze travel, applied to the CORE only.
   *
   * The lens is hardware and does not move; the light inside it does. That is a
   * change of behaviour from the bar version, where gaze translated the whole
   * glyph, and it is closer to the reference: the housing is a moulded part.
   *
   * It also retires an assertion that used to be load-bearing. The bar needed
   * `coreMask *= barMask` because a core at full gaze and full width genuinely
   * reached 0.360 against a slot half-extent of 0.245, and without the clip a
   * surprised glance put a glowing blob outside its housing. Here the core is
   * measured in units of the lens's own half-extents, so the lens IS the unit disc
   * in that space and the core reaches `0.55 + 0.055 / 0.17 = 0.874` of it at full
   * gaze - inside, at every open, width and arch, by construction rather than by
   * clipping. The clip survives as one multiply of real defence rather than as a
   * fix for a known overrun.
   */
  gazeX: 0.055,
  gazeY: 0.018,
  /** Antialias half-width in plate space, roughly 1.3 px at playing distance. */
  aa: 0.004,
} as const

/**
 * Signed distance to a rounded box, the standard iq form.
 *
 * `b` is the shape's full half-extent and `r` rounds its corners inward, so the
 * outer extent is `b` and not `b + r`. Duplicated from the visor's fragment
 * stage on purpose: the point of the test that uses it is to pin the geometry
 * the shader draws, and sharing an implementation would only prove the shader
 * equals itself.
 */
export function sdRoundBox(px: number, py: number, bx: number, by: number, r: number): number {
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  return (
    Math.min(Math.max(dx, dy), 0) +
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) -
    r
  )
}

/**
 * A Lame superellipse: `|x/a|^n + |y/b|^n = 1`.
 *
 * `n = 2` is an ellipse and `n` to infinity is a rectangle. `n = 4` is the
 * classic squircle, and it is what the reference brief means when it describes
 * the face as "neither square nor round, but somewhere in between". A plain
 * ellipse reads as a porthole and a rounded rectangle reads as a screen; only
 * the curve between them reads as a moulded window.
 *
 * Uniform sampling in theta clusters vertices unevenly for `n > 2`, putting
 * more of them along the flats than at the corners where they would do more
 * good. At 64 segments the corner error is under 0.4 mm at the face plate's
 * size, which is invisible. Resampling by arc length would be more correct and
 * is not worth doing until something needs a much coarser outline.
 */
export function superellipsePoints(a: number, b: number, n: number, segments: number): Vector2[] {
  if (!(a > 0) || !(b > 0)) {
    throw new Error(`robotGeometry: superellipse needs positive half-extents, got a=${a} b=${b}`)
  }
  if (!(n >= 2)) {
    throw new Error(`robotGeometry: superellipse exponent must be at least 2 to stay convex, got ${n}`)
  }
  if (!Number.isInteger(segments) || segments < 8) {
    throw new Error(`robotGeometry: superellipse needs at least 8 segments, got ${segments}`)
  }

  const out: Vector2[] = []
  const e = 2 / n
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2
    const c = Math.cos(th)
    const s = Math.sin(th)
    out.push(
      new Vector2(
        a * Math.sign(c) * Math.pow(Math.abs(c), e),
        b * Math.sign(s) * Math.pow(Math.abs(s), e),
      ),
    )
  }
  return out
}

/**
 * A disc lying on its side, with both rims filleted, as a lathe profile.
 *
 * "Disc" is the shape it was written for rather than a constraint: with
 * `halfThickness` equal to `radius` the same profile produces a filleted can,
 * which is what the ear pods are now.
 *
 * A bare `CylinderGeometry` has two 90 degree rims and the reference brief is
 * explicit that a moulded plastic object never has a 90 degree corner anywhere.
 * On a part this small the fillet is most of what the eye reads, because it is
 * the only surface that catches the key light as a bright line.
 *
 * Points are `(radius, height)` for `latheProfile`, which revolves about Y. The
 * caller rotates the result so the disc's axis lies along X.
 *
 * The profile runs from the axis outward across the top face, around the top
 * fillet, down the rim, around the bottom fillet, and back to the axis.
 */
export function roundedDiscProfile(
  radius: number,
  halfThickness: number,
  fillet: number,
  filletSteps: number,
): Vector2[] {
  if (!(fillet > 0) || fillet >= radius || fillet >= halfThickness) {
    throw new Error(
      `robotGeometry: a disc fillet of ${fillet} does not fit inside radius ${radius} and ` +
        `half-thickness ${halfThickness}; the profile would fold through itself`,
    )
  }

  const points: Vector2[] = []
  const inner = radius - fillet
  const flat = halfThickness - fillet

  points.push(new Vector2(0, halfThickness))
  points.push(new Vector2(inner, halfThickness))
  // Top fillet, sweeping from straight up round to straight out.
  for (let i = 1; i <= filletSteps; i++) {
    const a = (i / filletSteps) * (Math.PI / 2)
    points.push(new Vector2(inner + fillet * Math.sin(a), flat + fillet * Math.cos(a)))
  }
  /*
    Bottom fillet, the mirror, sweeping from straight out back round to straight
    down. It runs to `filletSteps - 1` and the flat point is pushed separately,
    because the arc's own last sample lands exactly on it and `latheProfile`
    rejects coincident points: three derives each profile point's normal from
    its neighbours, so a duplicate gives a zero-length normal ring which renders
    without erroring and shades wrong along one band.
  */
  for (let i = 0; i < filletSteps; i++) {
    const a = (Math.PI / 2) * (1 - i / filletSteps)
    points.push(new Vector2(inner + fillet * Math.sin(a), -flat - fillet * Math.cos(a)))
  }
  points.push(new Vector2(inner, -halfThickness))
  points.push(new Vector2(0, -halfThickness))
  return points
}

export type SuperellipsoidOptions = {
  /** Half-extents on x, y and z before the taper. */
  a: number
  b: number
  c: number
  /** Vertical squareness. 1 is an ellipsoid, near 0 is a box. */
  e1: number
  /** Horizontal squareness. */
  e2: number
  /** Width multiplier at the crown. Below 1 makes the shape wider at the base. */
  taperTop: number
  latSegments: number
  lonSegments: number
}

/** `sign(t) * |t|^e`, the superquadric power that keeps the sign through a fractional exponent. */
function sp(t: number, e: number): number {
  return Math.sign(t) * Math.pow(Math.abs(t), e)
}

/**
 * A superellipsoid with a per-latitude taper, for the torso.
 *
 * The reference calls the torso "ovoid, wider at the base". A `RoundedBox`
 * cannot taper and a `SphereGeometry` cannot be square-ish, so it needs
 * generating. `e1` and `e2` at 0.60 and 0.70 give the soft rounded block that
 * reads as a moulded torso rather than as an egg.
 *
 * Normals come from `computeVertexNormals` rather than from the analytic form.
 * The analytic normal of a superellipsoid has a removable singularity at the
 * poles and at each of the four seams where a `cos` or `sin` term crosses zero,
 * and evaluating it by hand produces NaN normals along exactly those lines.
 * Averaged face normals do not, and at this smoothness the difference is not
 * visible.
 *
 * A note for anyone measuring the result: the taper is applied at every
 * latitude including the equator, where it is already at its midpoint. So the
 * widest point of the solid is `a * mix(1, taperTop, 0.5)` rather than `a`. The
 * design spec's claim that these parameters give "0.62 wide at the base" is
 * therefore not what they produce - the true maximum width is 0.57 - and that
 * is fine and arguably better, because the diaper below it is the 0.62 band and
 * a torso narrower than the hips is the waist the silhouette wants.
 */
export function taperedSuperellipsoid(opts: SuperellipsoidOptions): BufferGeometry {
  const { a, b, c, e1, e2, taperTop, latSegments, lonSegments } = opts
  if (latSegments < 3 || lonSegments < 3) {
    throw new Error(
      `robotGeometry: superellipsoid needs at least 3 segments on each axis, ` +
        `got ${latSegments} x ${lonSegments}`,
    )
  }

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  /*
    One extra longitude column, duplicating the first.

    The duplicate carries u = 1 where the original carries u = 0, so the UV seam
    is a clean edge rather than a band where the whole texture reverses across
    one triangle. It costs `latSegments + 1` vertices and it is the standard fix.
  */
  for (let iv = 0; iv <= latSegments; iv++) {
    const fv = iv / latSegments
    const v = -Math.PI / 2 + fv * Math.PI
    const sinV = Math.sin(v)
    const cosV = Math.cos(v)

    // 0 at the base, 1 at the crown, smoothstepped so the taper has no crease.
    const t = (sinV + 1) / 2
    const smooth = t * t * (3 - 2 * t)
    const taper = 1 + (taperTop - 1) * smooth

    const py = b * sp(sinV, e1)
    const rim = sp(cosV, e1)

    for (let iu = 0; iu <= lonSegments; iu++) {
      const fu = iu / lonSegments
      const u = -Math.PI + fu * Math.PI * 2
      positions.push(
        a * taper * rim * sp(Math.cos(u), e2),
        py,
        c * taper * rim * sp(Math.sin(u), e2),
      )
      uvs.push(fu, fv)
    }
  }

  const stride = lonSegments + 1
  for (let iv = 0; iv < latSegments; iv++) {
    for (let iu = 0; iu < lonSegments; iu++) {
      const p0 = iv * stride + iu
      const p1 = p0 + 1
      const p2 = p0 + stride
      const p3 = p2 + 1
      // Both pole rings collapse to a single point, so one triangle of each
      // quad there is degenerate. Emitting it would put zero-area faces into
      // `computeVertexNormals`, which contributes a zero-length normal to the
      // pole vertex and shades the crown flat.
      if (iv !== 0) indices.push(p0, p2, p1)
      if (iv !== latSegments - 1) indices.push(p1, p2, p3)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  /*
    Both pole rings are a fan around a single point, so the `lonSegments + 1`
    vertices there are coincident and one of them is referenced by no triangle
    at all. `computeVertexNormals` leaves an unreferenced vertex at (0, 0, 0),
    which `Vector3.normalize` keeps as (0, 0, 0) rather than turning into a NaN
    anything would report. It is never rasterised so it is harmless today, and
    it is exactly the shape of defect this codebase keeps being cut by, so it
    gets the correct answer instead: the pole normal of a superellipsoid is the
    axis. Writing it for the whole ring also smooths the crown, which otherwise
    shades as a visible fan.
  */
  const normals = geometry.getAttribute('normal')
  const lastRow = latSegments * stride
  for (let i = 0; i < stride; i++) {
    normals.setXYZ(i, 0, -1, 0)
    normals.setXYZ(lastRow + i, 0, 1, 0)
  }
  normals.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
