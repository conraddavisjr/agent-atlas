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

/**
 * The squircle face plate: still 0.56 by 0.38, and no longer flat.
 *
 * ## What changed and why nothing about the eyes did
 *
 * It was a `beveledExtrude` of a squircle, mounted on the head's flat front face.
 * The head has no flat front face any more, and a flat plate on the new one would
 * stand 0.141 m off the surface at its rim against a plate 0.032 m deep. The full
 * argument, the three alternatives that were measured and rejected, and the reason
 * the offset is a scale rather than a normal are all on `superellipsoidPatch`.
 *
 * **The footprint, the depth and every number in `VISOR` are untouched**, which was
 * the constraint this was designed around rather than a happy result. The user
 * singled out the blinking as excellent. The blink lives in `VISOR`'s half-extents,
 * those are expressed in plate space, and plate space is defined as the glyph's own
 * UV space. `superellipsoidPatch` emits exactly the UVs `PlaneGeometry(0.56, 0.38)`
 * emitted, so the shader, the six expressions, the gaze and the blink all see the
 * same coordinate system over a surface that is now curved. Not one character of
 * `RobotFace.tsx`'s GLSL changed.
 *
 * `depth` is gone: a patch has a `rise` and an `inset` instead, because "how thick
 * is it" and "how far does it stand out of its housing" were the same number on a
 * flat plate and are not on a curved one. 0.012 out and 0.016 in: the outer face
 * stands 0.012 proud of the helmet, which is the same step the extrusion had at the
 * plate's centre, and the 0.016 of engagement is what guarantees the rim is inside
 * the shell rather than 1.5 mm inside it, which is all the old flat plate had at
 * its corners.
 */
export const FACE_PLATE = {
  a: 0.28,
  b: 0.19,
  /** n = 4 is the classic squircle, and the reference brief's "neither square nor round". */
  n: 4,
  segments: 64,
  /** Head-local y of the plate's centre. Was the `Face` group's own offset. */
  y: -0.045,
  inset: 0.016,
  rise: 0.012,
  chamfer: 0.006,
  chamferFrac: 0.045,
  rings: 6,
  /**
   * How far the glyph shell rides in front of the plate's outer surface.
   *
   * 0.020, unchanged from the quad it replaces: far enough that the depth test
   * never fights at any camera angle inside `CAMERA.minDistance`, near enough that
   * the parallax between plate and glyph stays under a pixel.
   */
  glyphRise: 0.032,
} as const

/**
 * The head shell: an oblong helmet, and no longer a rounded box.
 *
 * Here because the ear pods have to be sized against it: a pod that does not
 * clear the shell's side reads as a dent in the cheek rather than as a pod, and
 * a pod that clears it by too much floats free of the head. Both of those are
 * decided by arithmetic between this block and `EAR_POD_SHAPE`, and neither is
 * visible in a screenshot until someone stares at the face.
 *
 * ## What it was, and the two numbers that condemned it
 *
 * A `RoundedBox` 0.72 x 0.54 x 0.62 at corner radius 0.110. The user's note is
 * "his head is still shaped like a rounded rectangle when it should be more
 * oblong and oval", and the arithmetic agrees twice over:
 *
 *   - **59% of its height was one flat normal.** A `RoundedBox` is flat away from
 *     its corner rounds, so the front face was flat over `|y| <= 0.160` out of a
 *     half-height of 0.270. `Lighting.tsx` had already measured the consequence
 *     from the other end and written it down: "the surface is not curved ... 0.32 m
 *     of its 0.54 m height - 59%, and 79 px of the 133 px it occupies at
 *     hub-backlit - is a single FLAT face with one normal, which no light can put
 *     a gradient across." The head reading flat was diagnosed as a lighting defect
 *     and was a geometry defect.
 *   - **It had a hard terminator where the flat met the fillet.** 0 degrees of
 *     normal variation across 59% of the height and then 90 degrees across 0.110 m
 *     is what makes a shape read as a moulded box, whatever its silhouette does.
 *
 * ## The exponents, and what they were chosen against
 *
 * The vertical meridian's normal, measured as its angle off +Z going up the
 * front of the head, is the number that decides whether a light can put a
 * gradient on it:
 *
 *     up the face      20%     40%     60%     80%
 *     RoundedBox       0.0     0.0     0.0     approx 90 across the fillet
 *     e = 0.50         0.5     4.3    15.4    41.1
 *     e = 0.75         4.5    14.8    30.5    52.6
 *     e = 1.00        13.2    26.6    40.7    56.8
 *
 * 0.75 rather than 1.00, which would be a true ellipsoid. Two reasons and the
 * second is the one that decided it. A true ellipsoid at these extents is an
 * oblate pill and reads as a bean rather than as a helmet. And the torso is
 * already a superellipsoid at 0.60 and 0.70, so a head at 0.75 is plainly the
 * rounder member of one family of forms, where an ellipsoid head over a
 * square-ish torso reads as two parts from different toys.
 *
 * The extents are UNCHANGED at 0.72 x 0.54 x 0.62, and that is deliberate rather
 * than conservative. `docs/design/05-character-vfx.md` sits the character at 2.52
 * head-heights with the head at 39.7% of the silhouette, against a reference band
 * of 2.5-2.8 head-heights AND 40-48% of height, and those two bands overlap at a
 * single point. Any increase in head height moves one metric into its band and the
 * other out of it, and the crown is what fixes `PROPORTIONS.totalHeight` at 1.36.
 * So the head's size is at the only place it can be and the whole change is its
 * form. `taperTop` is 1 so the extents are exact - see the note on
 * `taperedSuperellipsoid` about the taper reaching the equator - and so
 * `superellipsoidField` is a valid inside/outside test on it, which every
 * clearance argument on the visor, the cap, the pods and the antenna now needs.
 *
 * ## Cost
 *
 * 28 by 40 segments measures 2,160 triangles against the 1,152 the old head cost
 * at smoothness 4. Sized by the silhouette rather than by the shading: the front
 * outline is traced by one meridian, so it is a 0.72 by 0.54 oval sampled at 56
 * points, whose perimeter is about 2.0 m and whose worst chord is 0.036 m, giving
 * a sagitta of about 0.7 mm. That is under a pixel at every framing in
 * `vantages.ts`. Smooth normals hide facets everywhere except on the outline, so
 * the outline is the only place resolution buys anything.
 */
export const HEAD_SHELL = {
  a: 0.36,
  b: 0.27,
  c: 0.31,
  e1: 0.75,
  e2: 0.75,
  /** 1, so the extents below are exact and `superellipsoidField` applies. */
  taperTop: 1,
  latSegments: 28,
  lonSegments: 40,
  /** Derived, and kept because the width ladder and half the tests read them. */
  width: 0.72,
  height: 0.54,
  depth: 0.62,
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
 * ## Why the replacement was a closed box and not another shell
 *
 * HISTORICAL from here to the next heading. Every number in this section is
 * measured against a `RoundedBox` head and a `RoundedBox` cap, and neither exists
 * any more. It is kept because the argument it makes - a closed solid has no
 * interior to leak, and a cap that does not stand proud is a paint stripe - still
 * governs the shape that replaced it.
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
 *   - At the cap's own upper side corners the BOUNDING-box corner (0.28, 0.27,
 *     -0.33) is 0.173 from the inner box, so 0.063 outside the head - but that
 *     point is not on the cap's surface, because the cap is rounded at 0.090 too.
 *     The rounded corner itself is about **0.007 proud**, which is a lip. Recorded
 *     because comparing bounding-box corners is the easy version of this question
 *     and it overstates the answer by an order of magnitude; the honest test
 *     samples one surface against the other's signed distance.
 *
 * It clears both neighbours by arithmetic rather than by luck, which is what
 * `robotGeometry.test.ts` pins. The antenna is at z -0.040 and this cap ends at
 * z -0.090, so it cannot enclose anything. The ear pods span z -0.125 to 0.085
 * and the cap's front face is at -0.090, so the two never intersect.
 *
 * ## It is no longer a box either, and that is the integrator's note rather than
 * ## the user's
 *
 * Everything above is kept because it is the record of why a hemisphere is not the
 * answer, and none of it is the current shape. The `RoundedBox` version drew the
 * note "reads as a panel stuck on rather than an integrated shape", and once the
 * head became a superellipsoid it was worse than that: a box on an oval gaps. At
 * the cap's own centre depth the new crown is at head-local y 0.223 and the cap's
 * top face was at 0.270, so it would have stood 0.047 off the head with daylight
 * under its rim.
 *
 * So the cap is now a `superellipsoidPatch` on the head's own surface, the same
 * generator and the same host as the visor plate, on the -z side. A panel whose
 * inner surface IS the helmet's surface, 0.010 in and 0.014 out, cannot read as
 * stuck on and cannot gap: it is the helmet, offset. What makes it a separate
 * moulded part is the 0.014 step and the chamfer on it, which is what the
 * reference's own cap has.
 *
 * The footprint is 0.46 by 0.30 rather than the box's 0.56 by 0.34. Not a taste
 * change: an oval head's silhouette narrows as the footprint climbs, and at the old
 * size the corner of the squircle wanted x 0.236 at y 0.243 where the head only
 * reaches x 0.201. `superellipsoidPatch` throws on that rather than bending the
 * point back, so the number was found by the generator refusing to build. At 0.46
 * by 0.30 centred at y 0.060 the worst margin to the silhouette is 0.105.
 *
 * Where it lands, measured: the cap's centre sits at z -0.308 and its rim wraps
 * from -0.226 at the sides round to a top edge at y 0.210, z -0.237. So it covers
 * the rear crown and stops short of both the antenna and the pods, which is what
 * the two tests below assert. `palette.gold` is still refused for it and the
 * reasoning is unchanged; only the shape moved.
 */
export const HEAD_CAP = {
  /** Footprint half-extents, and the squircle exponent that rounds its corners. */
  halfW: 0.23,
  halfH: 0.15,
  n: 4,
  segments: 56,
  /** Head-local y of the footprint's centre. */
  y: 0.06,
  /** Buried into the helmet, and standing proud of it. */
  inset: 0.01,
  rise: 0.014,
  chamfer: 0.006,
  chamferFrac: 0.05,
  rings: 5,
} as const

/**
 * The bright blue oval on the sole of each foot.
 *
 * The foot is now a filleted truncated cone, narrow end down, so its bottom face is
 * FLAT only inside where the sole fillet begins: `footSoleFlat()` returns
 * `|x| <= 0.0485` and `|z| <= 0.0631`. Anything wider than that straddles the rim
 * round and leaves a crescent gap between the pad and the sole, which is exactly the
 * artefact that made the ear pods read as a hole in the cheek. At radius 0.033
 * stretched 1.6 in z the oval spans 0.033 by 0.0528, so it clears the flat region by
 * 0.0155 in x and 0.0103 in z.
 *
 * ## The cone nearly broke this, which is why the boot is wider than it was
 *
 * Two things shrink a cone's sole relative to a box's of the same width: the 30%
 * taper, and then a fillet on a SLANTED rim whose tangent length is longer than the
 * fillet radius. Holding the top at the box's 0.140 gives a flat of 0.0354 in x, so
 * 0.0505 in z - and the pad needs 0.0528. It misses by 2.3 mm. So `FOOT.topRadius`
 * went to 0.088 to make room, and the widening the note offered as licence was in
 * fact forced by this block. That is the third time this pad's fit has driven a
 * dimension of the boot rather than the other way round.
 *
 * ## The radius came down from 0.085 and it was not optional
 *
 * Kept on the record because it is the same failure mode. When the boot went from
 * 0.32 wide to 0.14, the flat region went from 0.095 to 0.040 of half-width, and at
 * the old 0.085 the pad was more than twice as wide as the flat it needed - it would
 * have wrapped over the corner round on both sides, on the one part of the character
 * that has already shipped an invisible light once. Neither shrink was a taste
 * change, and the two parts are bound together by reading `footSoleFlat()` rather
 * than by copying numbers between blocks.
 *
 * ## It has to PROTRUDE, and the first version of it was invisible
 *
 * This shipped for one iteration with a `lift` of 0.001 meaning "sits a
 * millimetre above the sole plane", on the reasoning that flush would z-fight
 * with the ground. That reasoning describes a decal on a surface, and this is not
 * one: the foot was a SOLID `RoundedBox` spanning y -0.085 to 0.085 at the time, so
 * a pad from -0.084 to -0.072 sat entirely inside opaque rubber and could not be
 * seen from any angle at any time. A recess only reads if something is cut out of
 * the housing, and nothing here cuts - which is no less true of the cone that
 * replaced the box, so the whole argument carries over unchanged.
 *
 * That is the defect this whole pass is about, committed while writing the fix for
 * it: no error, a clean frame, every triangle present, and an emissive rendering
 * into the inside of another part - exactly what the deleted `Helmet` did to the
 * antenna bulb.
 *
 * So `proud` is how far the pad's bottom face sits BELOW the sole plane. At 0.004
 * with a thickness of 0.012 the pad spans y -0.089 to -0.077: buried 0.008 in the
 * foot, which is what attaches it with no stalk to model, and standing 0.004 clear,
 * which is what puts it outside the foot's surface where it can be seen.
 *
 * The 0.004 does not lift the character. `REST.footL.y` puts the sole plane on the
 * ground, so a planted pad is 4 mm INTO the floor and invisible, which is correct -
 * this mark is for the moment the foot leaves it. Seen edge on it is a 4 mm bright
 * band along the bottom of the foot, which is the reference's read from a normal
 * camera angle.
 */
export const SOLE_LIGHT = {
  /**
   * 0.023, down from 0.033, because the sole it has to sit inside went with the boot.
   *
   * Sized against the FLAT rather than against the old pad. The sole flat is 0.0334
   * once the boot and its fillet are both scaled by 0.7, and 0.023 is 68.9% of it -
   * which is the same fraction 0.033 was of the old 0.0485, so the pad reads at
   * exactly the size on the sole it read at before. Scaling the pad by 0.7 instead
   * would have given 0.0231, almost the same number by luck rather than by rule, and
   * would have been the wrong rule: the flats do not scale with the boot, because the
   * fillet eats a tangent length rather than a proportion.
   *
   * This mark has already shipped invisible once and come within 2.3 mm of it twice,
   * so it is sized against the surface it lands on and never against its own history.
   */
  radius: 0.023,
  /** Stretch along z, so it is an oval along the foot rather than a circle. */
  stretchZ: 1.6,
  thickness: 0.012,
  /** How far the pad's bottom face stands BELOW the sole plane. Must be positive. */
  proud: 0.004,
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
 * The ear pods: a tall narrow fin on each cheek, standing a little proud of it.
 *
 * ## Which authored number lands on which world axis, measured rather than reasoned
 *
 * The pod is a lathe about Y, then `rotateZ(PI/2)` in `robotParts.tsx`. After that
 * rotation, and this is asserted on the BUILT geometry below rather than argued
 * here:
 *
 *     halfThickness  ->  X   the extrusion, sideways out of the head
 *     radius         ->  Y   the pod's height
 *     radius         ->  Z   the pod's depth, fore and aft
 *
 * That mapping was un-checkable for three rounds, because `radius` and
 * `halfThickness` were BOTH 0.105 and the built bounding box was therefore a cube.
 * Every test that claimed to pin the axes passed identically with the two swapped.
 * The test now probes with deliberately distinct values so the mapping is pinned by
 * something that can fail.
 *
 * ## The two shape notes, and which axis each one is
 *
 * "Make the ears a lot more narrow" and "reduce its extrusion from the head by 66%"
 * are different axes, and only one of them is stated unambiguously. The extrusion is
 * X, so narrowness has to be Y or Z, or the two notes would be the same note.
 *
 * It is Z, and the deciding evidence is in the ANIMATION rather than in the shape.
 * `stepAnim` writes the pods' flap onto `pose.earPodL.rx`, and this block's own
 * previous comment opened "whose axis lies along X so they flap forward and back".
 * A rotation about X applied to a solid of revolution ABOUT X does nothing you can
 * see: the pod was rotationally symmetric on exactly the axis its animation turns,
 * so `EAR_POD.counterRoll`, `EAR_POD.landImpulse` and one of the two springs in
 * `SPRINGS.earPod` had never drawn a single frame of movement. Narrowing Z makes
 * the pod an ellipse in the Y-Z plane, which is the plane rx sweeps, so the flap
 * becomes visible for the first time and the sentence above becomes true.
 * `depthScale` 0.40 gives a 2.5 : 1 fin, and a 2.5 : 1 section tipping through
 * `0.14 * 0.3 = 0.042` rad moves its tip about 4 mm, which reads as a twitch.
 *
 * Narrowing the RADIUS instead was the other candidate and is rejected: it shrinks
 * Y as well, and Y is the only dimension the pod has left to read with once the
 * extrusion has gone. If a render says the fin is too thin, `depthScale` is the one
 * number to change and nothing else depends on it.
 *
 * ## What the extrusion cut costs, stated plainly because it is a real loss
 *
 * The pod stood 0.125 clear of the cheek and now stands 0.0421, which is the note's
 * 66% taken literally against a cheek measured at `superellipsoidX(0, -0.02)` =
 * 0.3599. Delivering it needs BOTH a thinner pod and a socket moved inboard:
 * `halfThickness` 0.062 with `REST.earPodL.x` 0.340 puts the outer face at 0.402.
 * Shrinking `halfThickness` alone to 0.0225 would have hit the same clearance while
 * leaving only 0.0025 of the pod inside the shell, and since the head curves away
 * under the rim the rim itself would then have floated clear of the cheek with a
 * crescent of daylight behind it. That crescent is the exact artefact both critique
 * reviewers called "a hole in the character's face". With the socket moved instead,
 * the shallowest burial anywhere on the rim is 0.0707.
 *
 * The cost is that there is now less pod to catch the key. The pods were enlarged in
 * the first place because at `halfThickness` 0.040 they read as a gouge in the
 * cheek, and 0.062 is closer to that than to what it replaces. What protects it is
 * that the fin is 0.084 deep rather than 0.21, so its lit face is a narrow strip
 * against a cheek that curves away from it, instead of a broad disc nearly parallel
 * to it. If a render says the ears have gone weak, this is the note to revisit and
 * `halfThickness` is the dial.
 *
 * ## The pods cannot break the head's profile outline, and never could
 *
 * Their end cap projects to 0.105 by 0.042 centred at head-local (y 0, z -0.02),
 * inside the head's 0.27 by 0.31 profile silhouette by 0.165 in y and 0.226 in z.
 * No pod mounted mid-cheek on a head this size reaches the outline, so the profile
 * read comes from shading, which is why the fillet stays as large as the thinner pod
 * allows. This was already true at the old size and is not a consequence of the cut.
 *
 * ## Two claims that were here and are false
 *
 * "Head including ear pods, 0.970, deliberately the widest thing on the character."
 * It never was. The mittens reach x 0.524 at rest, for a span of 1.048 against the
 * pods' 0.970, so the pods lost that contest by 0.078 before anything in this pass
 * touched them. The width ladder was built on a number that was not the maximum.
 *
 * "At 0.055 the pod is a barrel rather than a can with a flat lid, so there is no
 * single flat normal pointing at the camera." `roundedDiscProfile` puts the flat end
 * face at radius `0` to `radius - fillet`, so at radius 0.105 and fillet 0.055 there
 * was a flat lid 0.10 across, and it was the outermost surface on the part. The
 * fillet rounds the RIM; it does not dome the face. A true barrel needs
 * `fillet == radius`, which the generator rejects.
 *
 * ## The lathe was wound inside out, and had been since the pods were built
 *
 * Kept because it is the reason this part has a history. `roundedDiscProfile` ran
 * from `(0, +halfThickness)` DOWN to `(0, -halfThickness)`, and `LatheGeometry`
 * derives both winding and normals from the profile's direction of travel: the
 * outward normal of a profile edge is `(dy, -dx)`, so a descending rim edge with
 * `dy` negative gets a normal pointing at the axis. The built geometry measured a
 * signed volume of **-0.006906** with all 210 radial normals pointing INWARD.
 * Nothing in the project sets `side`, so `MeshPhysicalMaterial` culled back faces
 * and the only thing on screen was the interior of the pod's far wall - worst in
 * profile, where the near cap is culled and the far cap is behind the head. The fix
 * is in `roundedDiscProfile`, which now ascends, and it also fixed `ARM_BAND` and
 * `ARM_BEVEL` at -0.000712.
 */
export const EAR_POD_SHAPE = {
  /** The fin's height, on Y after the rotate. Deliberately unchanged. */
  radius: 0.105,
  /** The extrusion, on X after the rotate. Was 0.105; see the 66% note above. */
  halfThickness: 0.062,
  /**
   * 0.042 and not less, because the fillet is the only surface on the pod that
   * catches the key as a bright line and the pod has lost most of its other
   * surface. It has to stay under `halfThickness` or the profile folds through
   * itself, and 0.042 against 0.062 leaves 0.020 of flat end face.
   *
   * Note the fillet is authored in the lathe's frame and `depthScale` is applied
   * after, so its effective radius in Z is `0.042 * 0.40 = 0.0168`. That is the
   * one place the anisotropy leaks, and it is fine: a fin wants a tighter round on
   * its narrow axis.
   */
  fillet: 0.042,
  filletSteps: 6,
  radialSegments: 24,
  /**
   * Scales Z on the BUILT geometry, turning the disc into an ellipse.
   *
   * Applied with `BufferGeometry.scale`, which routes through `applyMatrix4` and so
   * puts the positions through the matrix AND the normals through its inverse
   * transpose before renormalising them. A non-uniform scale here is therefore
   * correctly shaded, which is not true of scaling a normal buffer directly.
   */
  depthScale: 0.4,
} as const

/**
 * The mitten hand: an oblong with two fingers, and no longer a sphere.
 *
 * ## Why a superellipsoid with `taperTop` 1 specifically
 *
 * Two reasons, and the second is the one that decided it. It puts the hand in the
 * same family of forms as the head at 0.75 and the torso at 0.60 / 0.70, where a
 * true ellipsoid would be the one bean on a character made of soft blocks. And at
 * `taperTop` 1 the extents are exact and `superellipsoidField` is a valid
 * inside/outside test on the solid, which is what lets the fingers' visibility be
 * PROVEN against the built hand rather than asserted from the authoring numbers.
 * That is not a nicety here: a stub extruding from the blob it grows out of is the
 * exact shape of part this project has twice shipped fully enclosed, once as a sole
 * light inside opaque rubber and once as a port ring inside a solid disc.
 *
 * Oblong along Y, which is the axis the arm hangs down, so the fingers point away
 * from the wrist and the whole hand reads as a paddle rather than as a ball with
 * pins in it. 0.23 by 0.32 by 0.20 against the sphere's 0.28 across.
 *
 * ## The width went DOWN and that is deliberate
 *
 * 0.23 across a 0.72 head is 0.32 head-widths, just under the 0.35 to 0.45 band
 * `00-references.md` gives, and the sphere's 0.28 sat inside it at 0.39. The band is
 * quoted for a round mitten and the relevant mass here is the long axis, which at
 * 0.32 is 0.44 head-widths and still inside it.
 *
 * What bought the reduction is a defect. The sphere hand PENETRATES the hips: at
 * rest its inner surface reaches |x| 0.2442 against a garment 0.3072 wide at the
 * same height, so the mitten is 0.055 inside the hip, and swept over the arm's real
 * range it reaches 0.132 inside. Nobody had measured it because the arm's clearance
 * argument in `REST_ROTATION` is about the WEDGE between arm and torso higher up,
 * and the hand is below where anyone was looking. At 0.115 of half-width against the
 * narrowed hips the hand is clear by 0.024 at rest. It is not fully fixed: at the
 * inboard end of a turn, `shoulderL.rz` reaches -0.05 and the hand goes about 0.031
 * into the hip. Fixing that properly means moving `REST.shoulderL.x` outboard or
 * shortening the arm, which is a change to the pose rather than to a shape, so it is
 * left measured and not done.
 */
export const HAND = {
  a: 0.115,
  b: 0.16,
  c: 0.1,
  e1: 0.8,
  e2: 0.8,
  /** 1, so the extents are exact and `superellipsoidField` applies. See above. */
  taperTop: 1,
  latSegments: 16,
  lonSegments: 22,
} as const

/**
 * One finger. Two of these per hand, side by side, extruding from the palm end.
 *
 * ## Sized to read as a finger rather than as a prong
 *
 * 0.068 square in section on a hand 0.23 across is 30% of the hand's width per
 * finger, and the pair plus their gap span 0.172 of it. A finger much under 0.05
 * on a hand this size is a pin, and a pair much over 0.20 leaves no palm between
 * them and the hand's own outline, at which point the hand reads as a two-toed
 * foot. The 0.036 gap is what makes them two fingers instead of one slab with a
 * groove in it.
 *
 * ## `embed` is the whole safety argument
 *
 * The box's top is placed 0.025 INSIDE the hand's surface, measured at the finger's
 * own centreline with `superellipsoidY(x, 0, HAND)` rather than at the hand's lowest
 * point, because the hand curves and the surface under the finger is 0.009 higher
 * than the pole. Authoring against the pole is how a finger ends up floating.
 *
 * With that embed the tip stands 0.090 clear at the centreline and 0.081 clear at
 * the finger's INNER edge, which is the worst corner because the hand reaches
 * furthest down nearest x 0. `robotGeometry.test.ts` proves the exposure on the
 * built geometry: it counts how many of the built box's vertices fall outside the
 * built hand's field, and requires the tip to clear the hand's own bottom pole, so a
 * future change to either shape that swallows the fingers fails rather than
 * silently drawing nothing.
 *
 * ## A superellipsoid and not a `RoundedBox`, which is the odd choice here
 *
 * Every other box on this character is drei's `RoundedBox`. That component is a
 * bevelled `ExtrudeGeometry` built inside a React render, not a class, so there is no
 * way for a node test to construct the geometry the component will actually ship. For
 * a part whose entire risk is "is it inside the hand", a test that rebuilds an
 * approximation of the shape is the same test that let a sole light ship inside
 * opaque rubber.
 *
 * So the finger uses the generator this file already owns and already tests. At `e1`
 * 0.25 the block holds 93% of its width at 90% of its height, so it reads as a
 * rectangle with moulded edges rather than as a capsule, and it obeys the same rule
 * `ARM_BAND` states: nothing in this world has a 90 degree corner. `taperTop` 1 keeps
 * the extents exact and keeps `superellipsoidField` valid on the finger as well as on
 * the hand.
 */
export const FINGER = {
  /** Half-extents. 0.068 x 0.115 x 0.068 overall. */
  a: 0.034,
  b: 0.0575,
  c: 0.034,
  /** Squarer than anything else on the character, because it has to read as a box. */
  e1: 0.25,
  e2: 0.3,
  taperTop: 1,
  latSegments: 10,
  lonSegments: 12,
  /** Half the gap plus half a finger: the offset of each finger from the centreline. */
  x: 0.052,
  /** How far the block's top sits inside the hand's surface, at the finger's own x. */
  embed: 0.025,
} as const

/**
 * Where a finger's centre sits on Y, solved against the hand's own surface.
 *
 * Exported and used by BOTH `robotParts.tsx` and the test, which is the point. If the
 * component derived this and the test re-derived it, the test would be checking its own
 * arithmetic and a change to either shape could move the finger out of the hand while
 * both agreed with each other. Here there is one derivation, the component ships it and
 * the test measures the result of it.
 *
 * The hand's lower surface at the finger's own x, not at the hand's pole: those differ
 * by 0.009 and authoring against the pole is how a finger ends up with a gap under the
 * palm. `superellipsoidY` returns the positive `|y|` and the fingers hang off the -Y
 * end, hence the negation. `FINGER.b` then steps from the block's top to its centre.
 */
export function fingerCentreY(): number {
  return -superellipsoidY(FINGER.x, 0, HAND) + FINGER.embed - FINGER.b
}

/**
 * The boot.
 *
 * A named block rather than three literals in `robotParts.tsx`, which is where they
 * were. `SOLE_LIGHT`'s whole correctness argument is about the flat region of this
 * box, its test recomputed `0.32 / 2 - 0.065` by hand, and the sole light had
 * already shipped once fully buried inside this solid. Two parts whose fit is a
 * numeric constraint should not read their dimensions from different places.
 *
 * ## The 80% note, and why it is not a linear 80%
 *
 * "Reduce the overall size of the feet by 80%" taken as a linear scale is
 * 0.064 x 0.034 x 0.088, and it breaks the leg in two measurable ways. The shin
 * capsule's bottom tip is at world y 0.115; a boot 0.034 tall with its sole on the
 * ground has its top at 0.034, so the leg would stop 0.081 short of the boot with
 * clear air between them. And 0.064 of width against a shin 0.170 across leaves the
 * leg overhanging its own boot by 0.053 per side. Neither is "narrow", both are
 * "broken", so the literal value is recorded here and not shipped.
 *
 * What binds the height is that the boot has to swallow the end of the shin. At
 * `height` 0.13 the boot's top plane is at world 0.13, where the capsule has already
 * narrowed to a radius of 0.0482, so a half-width of 0.070 contains it with 0.0218
 * to spare and the tip at 0.115 is 0.015 inside the boot.
 *
 * Width and depth are then as small as that top plane allows, and the result honours
 * the note on the measure the note is actually about. Linear scale is 0.44 x 0.76 x
 * 0.45, but the bounding volume falls 84.8% and the plan footprint - which is what
 * "the feet are too big" is about when you are looking down at a character - falls
 * 80.1%. The 0.44 depth it replaces was 32% of the whole body's height.
 */
/**
 * ## Now a truncated cone, narrow end down, and that is a change of shape FAMILY
 *
 * "Make his feet shaped like a cone. Where the bottoms are the pointy sides, but they
 * don't need to be extremely narrow, you can widen them up a little bit. They should
 * be 30% narrower than the top part of that cone."
 *
 * A `RoundedBox` cannot taper, so this is a lathe from `roundedConeProfile` with
 * `depthScale` applied to the built geometry, the same two-step the ear pods use.
 *
 * ### "30% narrower" - the ambiguity is real but it is not the one flagged
 *
 * The brief for this pass flagged it as ambiguous between RADIUS and WIDTH. **It is
 * not.** A ratio is scale invariant: `bottomRadius = 0.7 * topRadius` and
 * `bottomWidth = 0.7 * topWidth` are the same solid, because width is twice radius at
 * both ends. There was never anything to choose between.
 *
 * It also flagged the cone's own top versus the ankle it meets, and that one is real
 * but settles immediately. The note says "the top part of that cone", and arithmetic
 * agrees rather than merely permitting: the shin at the boot's top plane is 0.0964
 * across, 30% off that is a bottom width of 0.0675, and `SOLE_LIGHT` is 0.066 across
 * before any fillet is subtracted. The ankle reading builds a boot whose sole cannot
 * hold the light that has to sit on it.
 *
 * **The ambiguity that actually bites is a third one nobody named: WHERE on the cone.**
 * A filleted cone has two candidate widths at each end, and the fillets at the two ends
 * are not the same size - the bottom corner is sharper than a right angle and the top
 * one is blunter, so the top fillet eats 6.5 mm more radius than the bottom one does.
 * Measured on the built mesh, all three readings of the same solid:
 *
 *     authored cone radii        0.7000    30.0% narrower
 *     flat FACE to flat FACE     0.7091    29.1%     0.0971 against 0.1369
 *     widest RIM to widest RIM   0.7621    23.8%     0.1284 against 0.1685
 *
 * Shipped `narrow` is 0.7, so the cone the note describes is exactly the cone built,
 * and the two readings that measure the FACES land at 30.0% and 29.1%. The number a
 * reviewer would get by measuring the silhouette's widest points is 23.8%, and that
 * gap is entirely the bevel discipline: the fillets pull the two rims toward each
 * other. It is stated because someone will measure it and should not have to guess
 * whether it was intended.
 *
 * If the SILHOUETTE is what the 30% was about, `narrow` 0.6297 puts the rim-to-rim
 * ratio at exactly 0.700. It is not shipped because it takes the sole's flat to 0.0429
 * of half-width, so 0.0558 in z against a pad needing 0.0528 - a clearance of 3.0 mm
 * where 0.7 gives 10.3 mm, on the one margin on this character that has come close to
 * failing twice. That is a trade for the user to make, not this pass.
 *
 * ### The boot had to get WIDER, and that is a constraint rather than the licence
 *
 * "You can widen them up a little bit" reads as permission. It is a requirement, and
 * `SOLE_LIGHT` is why. A cone's bottom face is smaller than a box's of the same width
 * twice over: the 0.7 ratio takes 30% off, and then the fillet's tangent length on a
 * slanted rim takes more than the fillet radius. Holding the top at the box's 0.140
 * gives a sole flat of 0.0354 of half-width, so 0.0505 in z after `depthScale` -
 * against a pad that needs 0.0528. **The light does not fit on a cone of the present
 * width.** It misses by 2.3 mm, which is the third time this part's fit has been
 * within millimetres of shipping an invisible light. `topRadius` 0.088 is sized so the
 * sole flat clears the pad on both axes: 0.0485 against 0.033 in x, 0.0631 against
 * 0.0528 in z. See `footSoleFlat`, which the profile above and the test both read.
 *
 * ### Built dimensions, measured on the mesh rather than read off the parameters
 *
 * The distinction matters here for the same reason it does on `TORSO`: the authored
 * `topRadius` 0.088 is the UNFILLETED corner, which the fillet cuts off, so the solid
 * never reaches it. The bounding box is
 *
 *     bounding box   0.1685 x 0.1300 x 0.2190    was 0.140 x 0.130 x 0.200
 *                                                   (+20.3%, 0, +9.5%)
 *     top flat       0.1369 x 0.1779    the face the shin emerges through
 *     lower rim      0.1284 x 0.1669    the widest part of the taper's bottom
 *     sole flat      0.0971 x 0.1262    the only part that touches the ground
 *
 * Plan footprint rises 6.4% on the widest ellipse, which is the "widen them up a little
 * bit" asked for.
 *
 * ### Two numbers that moved the wrong way, stated rather than smoothed over
 *
 * **The old 80% note no longer clears 80% on bounding volume.** The box measured -84.8%
 * against the 0.32 x 0.17 x 0.44 boots; the cone measures **-79.96%**, so widening for
 * the sole light's sake spent about five points and landed a hair under the round number
 * the previous pass celebrated. Plan footprint, which is the measure that note was
 * really about, goes -80.1% to **-78.9%**. Both are asserted at 0.78 in the test so the
 * figures above are what the tests actually permit, and anyone widening the boot further
 * gets a failure rather than a surprise.
 *
 * **Ground contact narrows more than the silhouette does**, because only the sole's flat
 * touches the floor: 0.080 x 0.140 to 0.097 x 0.126, a 14.1% smaller contact area, and
 * with `REST.legL/R.x` also coming inboard the support half-width goes 0.230 to 0.194,
 * down 15.9%. A cone balancing on its narrow end is genuinely less planted than a box
 * under a head 0.72 wide, and this is the arithmetic of it rather than a reassurance.
 *
 * ### Is it a wedge heel?
 *
 * No, and the slope says so: `alpha` is 11.5 degrees off vertical over 0.13 of
 * height. A wedge reads from a slope steep enough to make the sole look like a point,
 * and at 11.5 degrees the silhouette narrows gently over the boot's height and reads
 * as a moulded, tapered boot. What it does NOT read as is a heel, because the taper
 * is radially symmetric - there is no front-to-back asymmetry anywhere in a lathe.
 *
 * ### The fillet is not cosmetic here
 *
 * 0.016 with 5 steps on both rims. The world rule is that nothing takes a hard 90
 * degree corner, and a bare cone has two: the sole rim and the top rim. It is also
 * the surface that catches the key as a bright line, which on the sole rim is the
 * only thing separating the boot from the ground plane in a backlit frame.
 */
export const FOOT = {
  /**
   * Unchanged at 0.13 and it is still the shin that fixes it, but the margin is now
   * far better than the box's and the box's stated margin was wrong.
   *
   * The old note claimed a half-width of 0.070 contained the shin's 0.0482 at the top
   * plane "with 0.0218 to spare". That measured against the box's full half-width,
   * and a `RoundedBox` is not at full width at its top plane - it is inset by the
   * corner radius, so the flat was 0.040 and the shin at 0.04822 was 0.008 OUTSIDE
   * it. Harmless, because the shin continues upward and the two solids interpenetrate
   * rather than gapping, but the quoted 0.0218 of margin never existed. It is the
   * same error class as the test that checked the shin's inner edge instead of its
   * axis: a number read off the shape someone had in mind rather than the one built.
   *
   * The cone has no such problem. Its top FLAT is 0.0684 of half-width against the
   * shin's 0.04822, so the leg emerges through the flat face with 0.0202 to spare,
   * and `footTopFlat` is what the test reads.
   */
  height: 0.13,
  /**
   * Lathe radius at the top face, before `depthScale`.
   *
   * **0.0616, down 30% from 0.088, on art direction: "the feet, particularly at the
   * top portion, are too large in diameter... this gives the effect of an oaf rather
   * than the bottom of a foot."**
   *
   * The reading taken is the LATHE RADIUS, so the plan footprint narrows 30% on both
   * axes and `depthScale` still holds the boot longer than it is wide. The
   * alternative reading - narrow across, keep the length - was considered and
   * rejected: it needs `depthScale` to rise to 1.857 to hold z, which turns the boot
   * into a plank, and it puts the boot NARROWER than the shin across while staying
   * wider fore and aft, which is a worse silhouette from the one angle the character
   * is most often seen from.
   *
   * What this measurably changes, all half-extents:
   *
   *   reading                      was       now       ratio
   *   top face, authored radius     0.0880    0.0616    0.700
   *   top FLAT, after the fillet    0.0684    0.0487    0.712
   *   sole face                     0.0616    0.0431    0.700
   *   sole FLAT                     0.0485    0.0334    0.689
   *   shin where they meet          0.0482    0.0482    1.000
   *
   * **These are the flats with the fillet SCALED, which is what ships.** An earlier
   * draft of this block quoted 0.0432 and 0.0292 and concluded that the shin no
   * longer emerges through the top flat. Those were the flats with the fillet held
   * at 0.016, which is the configuration the `fillet` note twenty lines below
   * rejects and for that exact reason - so this docblock and that one disagreed,
   * and this one was the stale half. Scaled, the flats fall by 29% and 31% rather
   * than by 37% and 40%, and the shin still clears the top flat, by 0.0005.
   */
  topRadius: 0.0616,
  /** The note's 30%: the bottom face's radius as a fraction of the top's. */
  narrow: 0.7,
  /**
   * Scales Z on the BUILT geometry, so the boot is longer fore and aft than across.
   *
   * 1.30, down from the box's 0.20 / 0.14 = 1.4286, because the top radius went up
   * and holding the old aspect would have made the boot 0.251 deep. A boot needs to
   * be longer than it is wide to read as a foot rather than a peg, and 1.30 keeps
   * that while adding only 14.4% of depth. Same mechanism as `EAR_POD_SHAPE`: the
   * fillet is authored in the lathe's frame, so its effective radius in Z is
   * `0.016 * 1.30 = 0.0208`.
   */
  depthScale: 1.3,
  /**
   * 0.0112, scaled with the boot rather than held at 0.016.
   *
   * A fillet is a fraction of the shape it rounds. Held at 0.016 on a radius that
   * fell 30% it goes from 18.2% of `topRadius` to 26.0%, which turns a moulded boot
   * into a lozenge and - the part that matters - eats 0.0184 off the top face, taking
   * the flat to 0.0432 against a shin of 0.0482. The leg would then overhang its own
   * boot by 5 mm per side, which is the same defect as the box this cone replaced,
   * one order of magnitude smaller.
   *
   * `0.016 * 0.7 = 0.0112` holds the ratio exactly, and the flat comes to 0.0487,
   * which clears the shin. It clears it by 0.5 mm, and that is stated rather than
   * dressed up: at this diameter the geometry has no more to give, because
   * `topRadius - shin` is 0.0134 with a fillet of ZERO. The 0.015 of margin the
   * previous pass asserted is unreachable at a 30% narrower boot by arithmetic, and
   * the test that asserted it has been rewritten to the invariant it was really
   * about. See `footTopFlat`.
   */
  fillet: 0.0112,
  filletSteps: 5,
  radialSegments: 24,
} as const

/**
 * Where a filleted cone's two flat faces end up, solved once for everyone who asks.
 *
 * `roundedConeProfile` needs these to place its arcs, `footSoleFlat` needs the bottom
 * one to clear `SOLE_LIGHT`, and `footTopFlat` needs the top one to pass the shin.
 * Three callers deriving the same trigonometry independently is how the sole light
 * ends up measured against a sole nobody built - so it is derived here and nowhere
 * else, the same rule `fingerCentreY` exists for.
 *
 * The two tangent lengths differ and that is the whole subtlety. A fillet tangent to
 * a flat face and to a slanted rim sits back along each edge by `fillet * tan(t / 2)`
 * where `t` is the angle the corner turns through, and the slant leans outward as it
 * rises, so the bottom corner turns through `90 - alpha` and the top through
 * `90 + alpha`. Using the fillet radius itself for both - which is what a vertical rim
 * would let you do - is wrong at both ends and in opposite directions: at the boot's
 * `alpha` of 11.48 degrees it overstates the sole by 2.9 mm and understates the top
 * face by 3.6 mm, so the two flats differ by 6.5 mm more than a naive reading expects.
 */
export function coneFillet(
  bottomRadius: number,
  topRadius: number,
  height: number,
  fillet: number,
): { alpha: number; tBot: number; tTop: number; flatBot: number; flatTop: number } {
  const alpha = Math.atan2(topRadius - bottomRadius, height)
  const tBot = fillet * Math.tan(Math.PI / 4 - alpha / 2)
  const tTop = fillet * Math.tan(Math.PI / 4 + alpha / 2)
  return { alpha, tBot, tTop, flatBot: bottomRadius - tBot, flatTop: topRadius - tTop }
}

/** The bottom face's radius. The note's 30% narrowing, applied. */
export function footBottomRadius(): number {
  return FOOT.topRadius * FOOT.narrow
}

/**
 * The FLAT part of the sole, as half-extents in x and z, which is the region
 * `SOLE_LIGHT` has to sit inside.
 *
 * Exported and read by `robotParts.tsx`, `SOLE_LIGHT`'s own reasoning and the test,
 * for the reason `fingerCentreY` gives: if the component and the test each derived
 * this, they would be checking their own arithmetic and a change to the fillet or the
 * taper could put the pad over the rim while both still agreed with each other. The
 * sole light has already shipped invisible once and been within 2.3 mm of it twice.
 *
 * The fillet is tangent to the sole, so it eats `fillet * tan(45 - alpha/2)` of
 * radius rather than `fillet`. Getting that wrong overstates the flat by 3 mm.
 */
export function footSoleFlat(): { x: number; z: number } {
  const x = coneFillet(footBottomRadius(), FOOT.topRadius, FOOT.height, FOOT.fillet).flatBot
  return { x, z: x * FOOT.depthScale }
}

/**
 * The FLAT part of the top face, as half-extents. This is what the shin emerges
 * through, and the blunter corner there means the fillet eats MORE than at the sole.
 */
export function footTopFlat(): { x: number; z: number } {
  const x = coneFillet(footBottomRadius(), FOOT.topRadius, FOOT.height, FOOT.fillet).flatTop
  return { x, z: x * FOOT.depthScale }
}

/**
 * The boot's widest half-extents - the silhouette, which is NOT `FOOT.topRadius`.
 *
 * The authored `topRadius` is the corner of the unfilleted cone, and the fillet cuts
 * that corner off, so the solid never reaches it: the widest point is the top
 * fillet's centre plus its radius, which is 3.6 mm short. Reading `topRadius` as the
 * boot's width is the same mistake as reading `TORSO.a` as the torso's, and it made
 * every dimension in this pass's first draft wrong.
 *
 * This is the CONTINUOUS maximum. The built mesh samples the arc at `filletSteps`, so
 * it comes out a further 0.2 mm inside this; the test pins that the built value never
 * exceeds this one, which makes this the safe number for a clearance to be measured
 * against and the reason `robotPose.test.ts` uses it for the gap between the boots.
 */
export function footMaxHalfWidth(): { x: number; z: number } {
  const x = footTopFlat().x + FOOT.fillet
  return { x, z: x * FOOT.depthScale }
}

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
 * ## The rings stack OUTWARD, and the first version of them was invisible
 *
 * This shipped for one iteration with the bezel proudest and the well and core
 * nested 0.002 behind it, on the reasoning that a lit pip belongs inside a recess.
 * `cylinderGeometry` does not make a recess. It makes a SOLID disc, so a 0.068
 * copper cylinder with a 0.050 well and a 0.030 core both inside its radius AND
 * inside its z span rendered as one plain copper disc with nothing on it. The
 * comment describing "three concentric rings" described a shape the geometry could
 * not produce, and the test asserted the exact nesting that hid them.
 *
 * Concentric rings out of solid discs come from stacking outward, not inward: each
 * disc is smaller than the one behind it and stands slightly proud of it, so what
 * is left visible of each is the annulus its successor does not cover. Reading from
 * the pack outward, with the pack's rear face at -0.070:
 *
 *     bezel  r 0.068   z -0.077 .. -0.063   0.007 proud of the pack
 *     well   r 0.050   z -0.080 .. -0.072   0.003 proud of the bezel, 0.005 into it
 *     core   r 0.030   z -0.083 .. -0.077   0.003 proud of the well,  0.003 into it
 *
 * So the eye sees a copper annulus from 0.050 to 0.068, a dark annulus from 0.030
 * to 0.050, and a lit disc inside 0.030. Every ring is also anchored behind its
 * successor's front face rather than floating in front of it, which is what stops
 * the stack reading as three separate coins.
 *
 * Total protrusion is 0.013 and that is a constraint rather than a preference: the
 * cape's front face is at -0.093, so the core cannot pass -0.083 without eating the
 * 0.010 of clearance. All four relationships are asserted, because every one of
 * them is a clean frame when it is wrong.
 */
export const BACKPACK_BLOCK = {
  width: 0.36,
  height: 0.26,
  depth: 0.14,
  radius: 0.055,
  port: {
    /** Copper rim. 0.068 against a flat half-height of 0.075 leaves 0.007. */
    bezelRadius: 0.068,
    bezelDepth: 0.014,
    bezelZ: -0.07,
    /** The dark surround, standing 0.003 proud of the bezel so it is not swallowed. */
    wellRadius: 0.05,
    wellDepth: 0.008,
    wellZ: -0.076,
    /** The lit pip. Small on purpose: a pilot light, not a lamp. */
    coreRadius: 0.03,
    coreDepth: 0.006,
    coreZ: -0.08,
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
  /**
   * 0.045, up from 0.030, and the reason is that the thickness was REAL and did
   * not READ.
   *
   * Both `99-handoff.md` item 4 and `91-design-critique.md` describe this part as
   * a flat zero-thickness quad still carrying round 1's F4. Neither is true of
   * what is built: the ribbon is a closed section of eight flats with ten distinct
   * normals and a measured rest bounding box of 0.374 x 0.720 x 0.030. Both
   * descriptions were written from a screenshot, and the screenshot was right
   * about the READ.
   *
   * MEASURED on why. At `hub-character` the character spans about 200 px for a
   * metre, so 0.030 of edge is **6 screen pixels** split across four flats - two
   * chamfers of 0.010, a 0.010 face between them, and the side. Each strip is
   * therefore 1 to 2 px and they all sit at similar angles to the key, so they
   * antialias into one line of almost the face's own value. A moulded edge that
   * cannot be resolved into more than one tone is a drawn edge.
   *
   * 0.045 puts the edge at 9 px and the bevel at 0.013, which leaves 0.019 of flat
   * between the two chamfers - so the three strips are 2.6, 3.8 and 2.6 px and can
   * separate. It is 13% of the cape's width, against 8.8% before, which is a
   * heavier vinyl rather than a different object.
   *
   * `z` moves back by exactly half the increase so `capeFront` does not move, and
   * the backpack port clearance the tests pin is untouched. See `z`.
   */
  thickness: 0.045,
  /**
   * 0.013, scaled with the thickness so the section keeps its proportions.
   *
   * A chamfer is what makes an edge catch the key as a bright line, and the wider
   * it is the more pixels that line gets. Held at 0.010 on a 0.045 section it
   * would be 22% of the thickness where it was 33%, so the edge would read as one
   * broad flat with two hairlines instead of as a moulded lip.
   */
  bevel: 0.013,
  /**
   * -0.1155, moved back by half the thickness increase.
   *
   * `z` is the section's CENTRE, so a thicker cape at a fixed `z` grows toward the
   * backpack as well as away from it - and the front face is the constrained one.
   * `robotGeometry.test.ts` pins it against the port's outermost ring with 0.008 of
   * clearance, and the reason that assertion exists is that at a previous `z` the
   * cape sat 0.002 INSIDE the bezel, which renders perfectly and casts a clean
   * shadow while being wrong.
   *
   * `-0.108 - 0.0075 = -0.1155` holds `z + thickness / 2` at -0.093 exactly, so
   * the clearance is bit-for-bit what it was and only the outer face moves.
   */
  z: -0.1155,
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
   * reach: 0.72 of length plus the section's own offset in any direction, and
   * 0.187 of half-width across it.
   *
   * **Re-derived when the cape was thickened to 0.045.** The offset is
   * `|z| + thickness / 2`, which went from 0.110 to 0.138, so the reach is 0.858
   * rather than 0.830 and `hypot(0.858, 0.187)` is **0.878**. Still inside 0.90,
   * by 0.022 rather than by 0.049.
   *
   * That margin is now the thing to watch rather than a formality: this radius is
   * what keeps the cape inside the SHADOW frustum, and the failure when it stops
   * is that the cape silently stops casting rather than that anything looks
   * wrong. Any further thickening has to move this number with it.
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
 * over `stepsPerSegment` steps is the segment's own angle and the tip's total sweep
 * is the sum of the four.
 *
 * "Exactly", for the pitch alone. Rotations about X and Z do not commute, so with a
 * non-zero roll the composed frame picks up a little spurious yaw: at the peak roll
 * of 0.068 rad per segment the accumulated frame reads x 0.848, y -0.108, z -0.243
 * against a nominal x 0.856, z -0.274, about 6 degrees of yaw. That is not a
 * regression introduced here - the drift goes as `N^2 * alpha * beta` with both
 * angles proportional to `1/N`, so the four-joint chain this replaces had the same
 * drift to leading order - and with `rz` at zero the pitch is exact to 1e-16. Distributing the rotation along
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
 * The torso: broad at the shoulders and narrowing downward into the waist.
 *
 * Built extents 0.580 x 0.360 x 0.485, widest at world y 0.829.
 *
 * ## The taper is INVERTED from what shipped, and that is the whole change
 *
 * The note is "one flowing torso, starting wide at the shoulders and narrowed down
 * by the waist", and what shipped was the exact reverse. At `taperTop` 0.84 the
 * torso was widest at its BASE and narrowed toward the crown, and the diaper below
 * it then flared wider still, so the visible half-width ran 0.2341 at the shoulder
 * line, 0.2888 at the bottom of the chest and 0.3099 at the hips. The character got
 * monotonically wider all the way down from the shoulders: a pear, with the widest
 * band in the silhouette being the nappy.
 *
 * `taperTop` 1.25 puts the widest band at the top instead. Measured on the built
 * mesh, half-width now runs 0.2729 at the shoulder joint, peaks at 0.2900 just below
 * it at world 0.829, and falls to 0.2450 by the waist at world 0.626. Above the peak
 * it narrows again into the neck, which is correct: the shoulder JOINT is at world
 * 0.87 but the shoulder MASS is the shelf just under it.
 *
 * ## `a` is 0.253 and not 0.31, and it is not a width change
 *
 * The taper multiplies every latitude including the equator, so the widest half-width
 * of the solid is `a * max(taper * rim)`, which at `taperTop` 1.25 and `e1` 0.60 is
 * `a * 1.1461`. This is the same correction `DIAPER` has carried for two rounds and
 * the reason its `a` is not a round number either. 0.253 puts the maximum at 0.2900
 * and the full width at 0.580; `c` is 0.2113 by the same factor, for a depth of
 * 0.485, unchanged from what shipped. Both are checked against the built bounding
 * box rather than against this comment, because the factor is a numeric maximum with
 * no closed form.
 *
 * ## The docstring this replaces was wrong about the shape it described
 *
 * It read "0.62 x 0.36 x 0.52 at its half-extents, tapering to 0.84". Those are the
 * `a`, `b`, `c` doubled with the taper ignored, and the taper is not ignorable: the
 * built solid measured 0.578 x 0.360 x 0.484. The 0.62 in it was never this mesh's
 * width, and `taperedSuperellipsoid`'s own comment says so eleven lines further
 * down. Worth naming because `PROPORTIONS.torsoWidthMax` was 0.62 and the diaper was
 * built to hit it exactly, so the one number the two blocks agreed on was the one
 * the torso did not have.
 */
export const TORSO = {
  a: 0.253,
  b: 0.18,
  c: 0.2113,
  e1: 0.6,
  e2: 0.7,
  /** Above 1, so the solid is widest at the SHOULDERS. Was 0.84. */
  taperTop: 1.25,
  latSegments: 20,
  lonSegments: 28,
} as const

/**
 * The diaper: a tapered cushion, and no longer a pillow.
 *
 * ## What "odd and bubbly" is, arithmetically
 *
 * It was a `RoundedBox` 0.62 x 0.28 x 0.52 at radius 0.13. Two measurements say
 * what the user is seeing.
 *
 * **It is a pill, and the brief for this pass guessed the wrong reason.** The
 * suspicion on record was that `RoundedBoxGeometry` was silently clamping the
 * radius. It was not: the clamp is half the smallest dimension, which is
 * `0.28 / 2 = 0.14`, and 0.13 is under it. The radius was honoured exactly, and
 * that is the problem rather than the reprieve. 0.13 against a half-height of 0.14
 * leaves `2 * (0.14 - 0.13) = 0.020` of flat top, which is 7.1% of the height, so
 * the shape is fully rounded in y and its front outline is a stadium. A stadium
 * 0.62 by 0.28 is a 2.21 : 1 horizontal capsule, and it is the widest band on the
 * body, so the pill outline is also the largest thing the eye reads below the head.
 *
 * **What it is not is over-round in the vertical section.** Measured as half-width
 * against height, the box holds 64% of its width at 99% of its height, which is
 * close to a superellipsoid at `e1` 0.40 and nothing like a sphere's 14%. So
 * reducing the radius, which is what "bubbly" sounds like it asks for, would have
 * traded a pill for a box and moved the complaint rather than answering it.
 *
 * ## What replaces it
 *
 * A `taperedSuperellipsoid`, which the torso already uses. `taperTop` above 1 makes
 * it widest at the hip line and narrowing downward, so the legs emerge from a tuck
 * instead of from the widest point. That is the whole difference between a nappy and
 * an inflated ring, and it is what removes the stadium outline without introducing a
 * flat.
 *
 * ## The waist note, and the measured reason it is not a literal 50%
 *
 * The note is "the current waist unit to become narrowed by 50%", as part of making
 * the waist and the chest read as one flowing unit. Taken literally that is `a * 0.5`,
 * a built maximum half-width of 0.1549 against 0.3099, and it detaches both legs from
 * the body.
 *
 * The measurement that says so. There is no thigh mesh on this character: `Leg` in
 * `RobotModel.tsx` is a bare node, then the knee, and the first geometry on the chain
 * is the shin capsule. So this garment IS the pelvis, and it is the only thing that
 * covers the top of the leg. The leg axis sits at `|x| 0.19` and the shin's top is at
 * world y 0.385. At half width the garment reaches `|x| 0.1065` there, which is
 * 0.0835 short of the axis and clears the shin's INNER edge at 0.105 by 0.0015 - a
 * 1.5 mm tangential graze. Both legs would hang beside a narrow pelvis with daylight
 * between them and it.
 *
 * So the ship is the narrowest that still encloses the leg axis where the shin
 * starts: `a` 0.240 for a built maximum of 0.2478, which is 20.0% narrower rather
 * than 50%. Going further needs `REST.legL/R.x` to come inboard with it, and that is
 * a change to the stance rather than to the waist. For the record, if that is wanted:
 * legs at `+-0.16` allow `a` 0.200 for a 35.5% narrowing. It is not taken here
 * because the wide planted stance is doing the low-centre-of-gravity read that
 * `Foot`'s comment describes, and narrowing it was not asked for.
 *
 * ## The next note DID ask for it, and this one lands literally
 *
 * "Bottom portion of his waist a bit more, by another 25%, and make sure his legs come
 * in more to his narrowed waist." Two halves, and the second is what makes the first
 * possible - which is exactly the trade the paragraph above said was available.
 *
 * It is `taperBot` 0.75 rather than `a * 0.75`, and that distinction is the whole
 * reason the note lands where it was aimed. The note says the BOTTOM of the waist. `a`
 * is the whole garment, and the two parameters that already exist can only pull the
 * bottom in by reshaping everything above it. Measured, `a * 0.75` with
 * `taperTop / 0.75` reproduces the two POLES exactly and distorts the whole profile
 * between them: the equator comes in 12.1%, and because the steeper taper partly
 * compensates as the rim falls, the widest band MIGRATES UPWARD while its own value
 * drops only 6.7%. That moves the widest band of the silhouette and breaks the 0.0000
 * crossover with the torso, which were the two hardest-won numbers of the last pass.
 * `taperBot` acts only below the equator, so both survive by construction rather than
 * by re-tuning. See `SuperellipsoidOptions`.
 *
 * ### The legs, and how far in they actually had to come
 *
 * Measured on the built mesh, as the lowest world y at which the garment still reaches
 * the leg axis, against the shin's top at world 0.385. The last pass shipped 0.0115 of
 * the shin's top buried in the garment, and that is the standard held to here rather
 * than mere non-negativity, because the defect it replaced was -0.0066 and passed its
 * test:
 *
 *     legs at  0.190   -0.0076   the -0.0066 defect again, slightly worse
 *     legs at  0.175   -0.0001   grazing, which is the 1.5 mm graze under a new name
 *     legs at  0.160    0.0063
 *     legs at  0.150    0.0100
 *     legs at  0.145    0.0115   equal to what shipped, to four places
 *
 * So `REST.legL/R.x` goes to `+-0.145`. That is the largest bottom narrowing the note
 * asked for - the full literal 25% - landed at the leg position that keeps the
 * attachment exactly as deep as the one the last pass fought for. Nothing here is a
 * softened version of the note.
 *
 * Note how flat that column is: 45 mm of leg movement buys 19 mm of burial, because
 * `e1` 0.35 makes the garment very blunt near the pole. That is also the warning - the
 * curve is shallow, so a further narrowing of `taperBot` costs leg position fast. At
 * `taperBot` 0.70 the legs would have to reach 0.150 for a burial of only 0.0055.
 *
 * The narrowing the note is really about does land, because "waist" is the junction
 * and not the widest band. The visible half-width at the waist, world y 0.62, goes
 * from 0.2973 to 0.2465, and the torso above it now peaks at 0.2900 rather than
 * 0.2341, so the waist reads 15.0% narrower than the shoulders where before it was
 * 2.9% WIDER than them. The direction of the taper is the change; its magnitude at
 * the widest band is capped by the legs.
 *
 * ## What makes it one unit rather than two, given both meshes have to survive
 *
 * They cannot be merged. `chest` and `hips` are separate rig nodes with genuinely
 * different motion - `hips` carries the gait's bob, shift, roll, lean and yaw, and
 * `chest` carries `SPRINGS.chestYaw`, the torso's lag against the hips, which is a
 * real waist twist. One mesh on `chest` would twist the pelvis with the ribcage while
 * the legs, which hang off `hips`, stayed put, and the leg sockets would shear. So
 * the two solids stay and the continuity is made in their PROFILES:
 *
 *   - The widths cross rather than step. The crossover is at world y 0.626 where the
 *     torso reads 0.2450 and this reads 0.2451, a step of 0.0000. What shipped
 *     crossed with the diaper 0.0085 wider AND rising while the torso fell, so the
 *     silhouette re-widened below the waist and put a crease there. That crease is
 *     what "the waist looks like a separate unit" was.
 *   - The silhouette is monotone from the widest band down to the pelvis. Worst
 *     re-widening anywhere below world 0.829 is 0.0011, which is one millimetre over
 *     8 cm and invisible.
 *   - `e1` is 0.35 rather than 0.50. A squarer vertical section holds width nearer
 *     the poles, which is what lets `a` come down for the waist while the pelvis
 *     still reaches the legs. This is the parameter doing the actual work.
 *   - `z` is -0.022 rather than -0.030 and `c` 0.2013 rather than 0.2408, so the
 *     rear step at the junction falls from 0.0477 to 0.0226. The puffy rear survives,
 *     which is a reference mark; what goes is half of a 0.048 ledge across the back
 *     at exactly the height the two parts meet.
 *
 * ## `b` is 0.155 and it fixes a gap that is in the shipped build
 *
 * At `b` 0.14 the garment's bottom pole is at world 0.380 and it covers the leg axis
 * only down to world 0.3916, while the shin's top is at 0.385. So the top 6.6 mm of
 * each shin is OUTSIDE the garment today, with daylight between the underside of the
 * hip and the top of the leg. Nothing caught it: the test on record checks that the
 * garment reaches the shin's inner edge at `|x| 0.105`, not that it encloses the axis,
 * and 0.105 passes comfortably while the axis fails. 0.155 drops the pole to world
 * 0.365 and covers the axis to world 0.3741, which is 0.0109 below the shin's top, so
 * the leg now emerges from the garment with margin instead of beside it. The crotch
 * drops 0.015, which a nappy can afford.
 */
export const DIAPER = {
  /** 0.240 for a built max of 0.2478. Was 0.2871 / 0.3099; see the 50% note. */
  a: 0.24,
  /** 0.155 so the pelvis reaches the top of the shin. Was 0.14, which did not. */
  b: 0.155,
  c: 0.2013,
  /** 0.35, squarer than the torso, which is what holds width down at the legs. */
  e1: 0.35,
  e2: 0.72,
  taperTop: 1.06,
  /**
   * 0.75: the bottom of the garment, 25% narrower. See the note above for the legs
   * that had to move with it.
   *
   * This dial and not `a`, because the note is about the BOTTOM of the waist and `a`
   * is the whole garment. Measured on the built mesh, the narrowing this produces
   * against what it replaces, band by band up from the bottom pole:
   *
   *     world 0.3656   0.1201 -> 0.0898   -25.2%   the pole itself
   *     world 0.3741   0.1925 -> 0.1474   -23.5%   where the legs attach
   *     world 0.3950   0.2265 -> 0.1946   -14.1%
   *     world 0.4417   0.2436 -> 0.2402    -1.4%
   *     world 0.5200   0.2460 -> 0.2460     0.0%   the equator, untouched
   *
   * So the widest band still measures 0.2478 to four places, and the 0.0000 width
   * crossover with the torso at world 0.626 that stops the waist reading as a separate
   * unit is arithmetically unreachable by this parameter. Both were re-measured rather
   * than assumed, because they were the two hardest-won numbers of the last pass.
   */
  taperBot: 0.75,
  latSegments: 22,
  lonSegments: 32,
  /**
   * Pushed back, but half as far as it was.
   *
   * This is the puffy rear and it is worth stating because it looks like a nudge.
   * At -0.030 against the old 0.52 of depth it stood 0.0477 behind the torso at the
   * junction, which is a ledge across the back at exactly the height the two parts
   * are supposed to read as one. At -0.022 against 0.4026 of depth it stands 0.0226
   * behind: still a puffy rear, no longer a step.
   */
  z: -0.022,
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
 * ## The profile ASCENDS, and it did not, and that was the ear-pod bug
 *
 * It runs from the axis at `-halfThickness` outward across the bottom face, around
 * the bottom fillet, UP the rim, around the top fillet, and back to the axis at
 * `+halfThickness`. It used to run the other way, top to bottom, and the shape is
 * identical because the point set is symmetric in y - so the mistake was invisible
 * in every test that measured a bound, a radius or an extent, and there were five
 * of them.
 *
 * What it is not invisible in is the winding. `LatheGeometry` takes both its face
 * order and its vertex normals from the profile's direction of travel: the outward
 * normal it assigns an edge is `(dy, -dx)`, which for the rim of a descending
 * profile has `dy < 0` and therefore points at the axis. Measured on the built
 * geometry, the descending version had a signed volume of **-0.006906** and all 210
 * of its radial normals pointing inward; the ascending version is +0.006906 with
 * all 210 outward. `roundedCylinder` in `src/art/geometry.ts` has always ascended,
 * which is why nothing else in the world was affected.
 *
 * Consequence, since nothing in this project sets `side` and the default is
 * `FrontSide`: every part built from this profile rendered with its outside culled
 * and only the interior of its far wall drawn. That is the ear pods, which the user
 * reported as disappearing in profile, and the two rings on each upper arm, which
 * nobody reported because a ring whose inner wall is drawn still puts a dark band
 * round the arm.
 *
 * `robotGeometry.test.ts` now measures the signed volume rather than the extents,
 * because the extents were the same either way.
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

  points.push(new Vector2(0, -halfThickness))
  points.push(new Vector2(inner, -halfThickness))
  // Bottom fillet, sweeping from straight down round to straight out.
  for (let i = 1; i <= filletSteps; i++) {
    const a = (i / filletSteps) * (Math.PI / 2)
    points.push(new Vector2(inner + fillet * Math.sin(a), -flat - fillet * Math.cos(a)))
  }
  /*
    Top fillet, the mirror, sweeping from straight out back round to straight up.
    It runs to `filletSteps - 1` and the flat point is pushed separately, because
    the arc's own last sample lands exactly on it and `latheProfile` rejects
    coincident points: three derives each profile point's normal from its
    neighbours, so a duplicate gives a zero-length normal ring which renders
    without erroring and shades wrong along one band.
  */
  for (let i = 0; i < filletSteps; i++) {
    const a = (Math.PI / 2) * (1 - i / filletSteps)
    points.push(new Vector2(inner + fillet * Math.sin(a), flat + fillet * Math.cos(a)))
  }
  points.push(new Vector2(inner, halfThickness))
  points.push(new Vector2(0, halfThickness))
  return points
}

/**
 * A truncated cone, narrow end DOWN, with both rims filleted, as a lathe profile.
 *
 * The boot. `roundedDiscProfile` above cannot express it: its rim is vertical, so
 * the fillet at each end is a quarter circle and the tangent length equals the
 * fillet radius. On a slanted rim neither is true, and getting that wrong is the
 * whole difficulty of this shape.
 *
 * ## The fillets are solved, not eyeballed, and they are NOT the same size
 *
 * Each fillet is the circle tangent to both the flat face and the slant. For a
 * corner whose two edges turn through `theta`, the tangent length back along each
 * edge is `fillet * tan(theta / 2)`, and the two corners here have different
 * `theta` because the slant leans outward as it rises:
 *
 *     bottom   theta = 90 - alpha   so the corner is SHARPER than a right angle
 *     top      theta = 90 + alpha   so the corner is BLUNTER than a right angle
 *
 * where `tan(alpha) = (topRadius - bottomRadius) / (2 * halfHeight)`. So the top
 * fillet eats more radius off its face than the bottom one does, and a generator
 * that used one tangent length for both would put the flat faces in the wrong place
 * by `fillet * (tan(45 + alpha/2) - tan(45 - alpha/2))`. At the boot's numbers that
 * is 6.5 mm on a 0.088 radius, and it lands on the two faces whose sizes are load
 * bearing: the bottom one carries `SOLE_LIGHT`, and the top one is what the shin
 * emerges through.
 *
 * Both arcs are checked in `robotGeometry.test.ts` by measuring the distance from
 * each fillet's centre to the slant line and requiring it to equal `fillet`, which
 * is the property the construction is FOR rather than a restatement of it. A useful
 * consistency fact that falls out: both arcs end at the same polar angle
 * `-alpha` on their own centres, because both are tangent to the same line and
 * therefore share its normal direction.
 *
 * ## It ASCENDS, for the reason `roundedDiscProfile` records at length
 *
 * `LatheGeometry` takes winding and normals from the profile's direction of travel,
 * and a descending profile ships a solid with every radial normal pointing at the
 * axis, which `MeshPhysicalMaterial` then culls. That cost this project the ear pods
 * and both arm rings for three rounds. This profile runs axis-bottom, out across the
 * sole, round the bottom fillet, up the slant, round the top fillet, in across the
 * top face, axis-top - strictly increasing in y at every step, which the test
 * asserts directly so the winding cannot silently invert again.
 *
 * The slant itself contributes no interior points. Two fillet endpoints and the
 * straight edge between them is the exact shape; subdividing it would only add
 * vertices whose normals are identical.
 */
export function roundedConeProfile(
  bottomRadius: number,
  topRadius: number,
  halfHeight: number,
  fillet: number,
  filletSteps: number,
): Vector2[] {
  if (!(fillet > 0)) {
    throw new Error(`robotGeometry: a cone fillet must be positive, got ${fillet}`)
  }
  if (!(bottomRadius > 0) || !(topRadius > 0) || !(halfHeight > 0)) {
    throw new Error(
      `robotGeometry: a cone needs positive radii and height, got ${bottomRadius}, ` +
        `${topRadius}, ${halfHeight}`,
    )
  }
  if (filletSteps < 1) {
    throw new Error(`robotGeometry: a cone fillet needs at least 1 step, got ${filletSteps}`)
  }

  // One derivation, shared with `footSoleFlat` and `footTopFlat`. See `coneFillet`.
  const { alpha, tBot, tTop, flatBot, flatTop } = coneFillet(
    bottomRadius,
    topRadius,
    2 * halfHeight,
    fillet,
  )
  const cosA = Math.cos(alpha)
  if (!(flatBot > 0) || !(flatTop > 0)) {
    throw new Error(
      `robotGeometry: a cone fillet of ${fillet} leaves no flat face - bottom ${flatBot}, ` +
        `top ${flatTop}; the profile would fold through itself`,
    )
  }
  // The slant must still have length after both fillets have eaten into it.
  if ((tBot + tTop) * cosA >= 2 * halfHeight) {
    throw new Error(
      `robotGeometry: a cone fillet of ${fillet} consumes the whole slant over a height of ` +
        `${2 * halfHeight}; the two fillets would cross`,
    )
  }

  const points: Vector2[] = []
  const thetaBot = Math.PI / 2 - alpha
  const thetaTop = Math.PI / 2 + alpha

  // Sole, from the axis out to where the bottom fillet begins.
  points.push(new Vector2(0, -halfHeight))
  points.push(new Vector2(flatBot, -halfHeight))

  /*
    Bottom fillet. Centre sits one fillet radius above the sole at the flat's edge,
    and the arc starts pointing straight down and sweeps out to the slant's normal.
    Starts at i = 1 because i = 0 lands exactly on the point just pushed, and
    `latheProfile` rejects coincident points rather than shipping a zero-length
    normal ring.
  */
  const obX = flatBot
  const obY = -halfHeight + fillet
  for (let i = 1; i <= filletSteps; i++) {
    const ang = -Math.PI / 2 + (i / filletSteps) * thetaBot
    points.push(new Vector2(obX + fillet * Math.cos(ang), obY + fillet * Math.sin(ang)))
  }

  /*
    Top fillet. Its arc BEGINS at the same polar angle the bottom arc ended on,
    because both are tangent to the slant, and the straight run between the two
    endpoints is the slant itself. Starts at i = 0 here - unlike the bottom arc -
    because that first sample is the far end of the slant and is a genuinely new
    point, and it ends one step short with the flat pushed separately, for the
    coincidence reason above.
  */
  const otX = flatTop
  const otY = halfHeight - fillet
  for (let i = 0; i < filletSteps; i++) {
    const ang = Math.PI / 2 - thetaTop + (i / filletSteps) * thetaTop
    points.push(new Vector2(otX + fillet * Math.cos(ang), otY + fillet * Math.sin(ang)))
  }

  // Top face, from where the fillet ends back in to the axis.
  points.push(new Vector2(flatTop, halfHeight))
  points.push(new Vector2(0, halfHeight))

  return points
}

export type SuperellipsoidOptions = {
  /** Half-extents on x, y and z before the taper. */
  a: number
  b: number
  c: number
  /**
   * Vertical squareness. 1 is an ellipsoid, near 0 is a box.
   *
   * Above 1 the surface goes CONCAVE - a four-pointed star in cross-section -
   * which every clearance argument in this file assumes cannot happen, because
   * `superellipsoidField` below is only a valid inside/outside test on a convex
   * solid. Nothing here validates it because nothing here has a use for it; if
   * something ever wants `e > 1`, the field helper and every test that leans on
   * it stop being true and that is the thing to fix first.
   */
  e1: number
  /** Horizontal squareness. */
  e2: number
  /** Width multiplier at the crown. Below 1 makes the shape wider at the base. */
  taperTop: number
  /**
   * Width multiplier at the BOTTOM pole, applied only below the equator.
   *
   * Optional and defaulting to 1, which is exactly the shape this generator built
   * before it existed. Every caller that omits it is bit-for-bit unchanged.
   *
   * ## Why a second dial rather than re-solving `a` and `taperTop`
   *
   * `taperTop` is normalised so the taper is 1 at the bottom pole, so the only way
   * to pull the bottom in with the existing parameters is `a * k` with
   * `taperTop / k`. That reproduces the two poles and reshapes everything between
   * them: at `DIAPER`'s numbers, taking the bottom in 25% that way takes the EQUATOR
   * in 12.1% as well and migrates the widest band upward. The equator is where two
   * separately tuned constraints live - the widest band of the silhouette, and the
   * 0.0000 width crossover with the torso at world 0.626 that stops the waist reading
   * as a separate unit. A dial that only acts below the equator leaves both untouched
   * by construction rather than by re-tuning.
   *
   * The factor is smoothstepped over the lower hemisphere, so its derivative is
   * zero AT the equator and the two halves meet with no crease. A linear ramp would
   * put a visible corner all the way round the widest part of the garment.
   */
  taperBot?: number
  latSegments: number
  lonSegments: number
}

/** The subset of `SuperellipsoidOptions` that describes the SURFACE rather than its tessellation. */
export type SuperellipsoidShape = Pick<SuperellipsoidOptions, 'a' | 'b' | 'c' | 'e1' | 'e2'>

/**
 * The superellipsoid's implicit field: 1 exactly on the surface, above 1 outside
 * it, below 1 inside.
 *
 * ## Why this exists at all, and why it is a field and not a distance
 *
 * This file's header says every "how proud of the part underneath is this part"
 * number on the model is one signed-distance question, and until this pass every
 * one of them was asked against a `RoundedBox`, where `sdRoundBox3` answers it.
 * The head is no longer a box, so the same questions - is the visor outside the
 * helmet, is the copper cap outside it, is the ear pod buried in it, does the
 * antenna reach it - need an inside/outside test for a superellipsoid, and there
 * is no closed-form signed distance to one.
 *
 * There does not need to be. Every question above is strictly "inside or
 * outside", and for that a monotone field is exactly as good as a distance and is
 * exact rather than approximate. The magnitude is meaningless, so nothing may
 * compare two field values as if they were metres; the tests that want a
 * clearance in metres solve for the surface coordinate instead, with
 * `superellipsoidX/Y/Z` below.
 *
 * ## The derivation, because it is not obvious from the parametric form
 *
 * `taperedSuperellipsoid` builds
 *
 *     x = a R sp(cos u, e2),  z = c R sp(sin u, e2),  y = b sp(sin v, e1),
 *     R = sp(cos v, e1)
 *
 * so `(|x| / (a R))^(1/e2) = |cos u|` and likewise for z, and `cos^2 + sin^2 = 1`
 * gives `R^m2 = (|x|/a)^m2 + (|z|/c)^m2` with `m2 = 2/e2`. The same step on the
 * latitude pair gives `R^m1 + (|y|/b)^m1 = 1` with `m1 = 2/e1`. Substituting the
 * first into the second is this function.
 *
 * **`taperTop` is not modelled and cannot be.** The taper is a per-latitude
 * multiplier applied after the fact, so a tapered solid is not a superellipsoid
 * and has no implicit form of this kind. Every caller here passes a shape whose
 * taper is 1, and the head is authored at `taperTop: 1` for exactly this reason:
 * the alternative was a head whose clearances could only be checked by sampling a
 * mesh, and this codebase has shipped two invisible parts that a mesh sample
 * would also have passed.
 */
export function superellipsoidField(
  x: number,
  y: number,
  z: number,
  s: SuperellipsoidShape,
): number {
  const m1 = 2 / s.e1
  const m2 = 2 / s.e2
  const rm2 = Math.pow(Math.abs(x) / s.a, m2) + Math.pow(Math.abs(z) / s.c, m2)
  const r = Math.pow(rm2, 1 / m2)
  return Math.pow(r, m1) + Math.pow(Math.abs(y) / s.b, m1)
}

/**
 * The surface's `|z|` at a given `x` and `y`, or NaN if that column misses the
 * solid entirely.
 *
 * NaN rather than a clamp on purpose. Every caller is asking "where does my panel
 * sit on the head", and a footprint that runs off the head's silhouette is a
 * panel whose rim would float in the air; returning the nearest valid answer
 * would produce a geometry that renders cleanly with a crescent gap under its
 * edge, which is the artefact three separate parts on this character have already
 * shipped. `superellipsoidPatch` throws on the NaN.
 */
export function superellipsoidZ(x: number, y: number, s: SuperellipsoidShape): number {
  const m1 = 2 / s.e1
  const m2 = 2 / s.e2
  const ty = Math.pow(Math.abs(y) / s.b, m1)
  if (!(ty < 1)) return NaN
  const r = Math.pow(1 - ty, 1 / m1)
  const tx = Math.pow(Math.abs(x) / (s.a * r), m2)
  if (!(tx < 1)) return NaN
  return s.c * r * Math.pow(1 - tx, 1 / m2)
}

/** The surface's `|x|` at a given `y` and `z`. The ear pods are placed against this. */
export function superellipsoidX(y: number, z: number, s: SuperellipsoidShape): number {
  const m1 = 2 / s.e1
  const m2 = 2 / s.e2
  const ty = Math.pow(Math.abs(y) / s.b, m1)
  if (!(ty < 1)) return NaN
  const r = Math.pow(1 - ty, 1 / m1)
  const tz = Math.pow(Math.abs(z) / (s.c * r), m2)
  if (!(tz < 1)) return NaN
  return s.a * r * Math.pow(1 - tz, 1 / m2)
}

/** The surface's `|y|` at a given `x` and `z`. The antenna's root is placed against this. */
export function superellipsoidY(x: number, z: number, s: SuperellipsoidShape): number {
  const m1 = 2 / s.e1
  const m2 = 2 / s.e2
  const rm2 = Math.pow(Math.abs(x) / s.a, m2) + Math.pow(Math.abs(z) / s.c, m2)
  const r = Math.pow(rm2, 1 / m2)
  if (!(r < 1)) return NaN
  return s.b * Math.pow(1 - Math.pow(r, m1), 1 / m1)
}

/** A shape scaled by adding `d` to every half-extent. Negative `d` shrinks it. */
export function superellipsoidOffset(s: SuperellipsoidShape, d: number): SuperellipsoidShape {
  return { a: s.a + d, b: s.b + d, c: s.c + d, e1: s.e1, e2: s.e2 }
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
  const taperBot = opts.taperBot ?? 1
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
    /*
      The lower-hemisphere taper, which is 1 at the equator and everywhere above it,
      so a `taperBot` below 1 narrows the bottom of the solid and provably cannot
      move its widest band. Smoothstepped for the same reason as `smooth` above, and
      the smoothstep matters more here: its derivative is zero at BOTH ends, so the
      lower taper meets the upper one at the equator with no crease across the
      widest part of the shape, which is the most visible line on the garment.
    */
    const low = Math.max(0, 1 - t / 0.5)
    const lowSmooth = low * low * (3 - 2 * low)
    const taper = (1 + (taperTop - 1) * smooth) * (1 + (taperBot - 1) * lowSmooth)

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

export type SuperellipsoidPatchOptions = {
  /** The solid the panel lies on. Its `taperTop` must be 1; see `superellipsoidField`. */
  host: SuperellipsoidShape
  /**
   * The panel's footprint, as a closed loop in the host's PROJECTED (x, y) plane,
   * relative to the footprint's own centre. `superellipsePoints` is the generator
   * every caller here uses.
   */
  outline: Vector2[]
  /** The footprint's nominal half-extents, which set the UV mapping. */
  halfW: number
  halfH: number
  /** Where the footprint's centre sits on the host's y axis. */
  centreY: number
  /** +1 puts the panel on the host's +z side, -1 on its -z side. */
  facing: 1 | -1
  /** How far the panel's inner surface lies INSIDE the host. Ignored when `solid` is false. */
  inset: number
  /** How far the panel's outer surface lies OUTSIDE the host. Must be positive. */
  rise: number
  /** Radial subdivisions from the footprint's centre to the chamfer. */
  rings: number
  /**
   * The chamfer on the outer rim: how far the panel drops back toward the host
   * across it, and what fraction of the footprint it eats. Ignored when `solid`
   * is false.
   */
  chamfer: number
  chamferFrac: number
  /**
   * A closed solid with a rim and an inner surface, or a single open shell.
   *
   * False is for the visor glyph, which is a transparent overlay with
   * `depthWrite: false` and therefore has no inside, no shadow and no rim to
   * catch a highlight. Everything else is true, because an open shell leaks the
   * shadow pass; see the cape ribbon's caps.
   */
  solid: boolean
}

/**
 * A curved panel lying on a superellipsoid: the visor plate, the visor glyph and
 * the copper cap on the back of the head.
 *
 * ## Why this had to be written, in one number
 *
 * The head was a `RoundedBox` and is now a superellipsoid, because the user's note
 * is "his head is still shaped like a rounded rectangle when it should be more
 * oblong and oval" and 59% of the old head's height was one flat face. The face
 * plate mounted on that flat face.
 *
 * A superellipsoid has no flat face, and the plate is not small: 0.56 by 0.38 on a
 * head 0.72 by 0.54, so it covers 78% of the width and 70% of the height and its
 * rim is most of the way to the silhouette. Measured over the plate's own
 * footprint, the surface it has to sit on drops by
 *
 *     RoundedBox r 0.110        0.0295 m from plate centre to plate rim
 *     superellipsoid e 0.75     0.1407 m
 *
 * against a plate that is 0.032 m deep in total. So on the old head a flat plate
 * was 0.0295 out over its rim and got away with it by 1.5 mm of engagement at the
 * corners, and on the new one a flat plate would stand 0.14 m off the head at its
 * rim. That is not a tuning problem, it is a crescent-shaped hole in the face, and
 * it is the same artefact both round 1 reviewers read on the ear pods.
 *
 * Four ways out were considered and three are recorded because they all look
 * reasonable until they are measured:
 *
 *   - **Shrink the plate until a flat one fits.** Sag goes roughly as the square
 *     of the footprint, so 0.032 m of sag needs the plate at 0.35 of its size,
 *     which is 0.20 m across a 0.72 m head. The eyes are sized as fractions of
 *     the plate, so this shrinks the character's identity by two thirds.
 *   - **Keep the head boxy and only round its top and back.** drei's `RoundedBox`
 *     has one radius, so this needs the crown as a separate part, which is the
 *     `Helmet` defect and the "panel stuck on" note about the copper cap.
 *   - **Loft an oval cross-section along z with `beveledExtrude`.** The front view
 *     becomes a true oval, which is most of the ask, and the PROFILE stays a
 *     rounded rectangle. Profile is the exact view the ear-pod complaint is
 *     about, so this fixes the head in the one view that was not the problem.
 *   - **Curve the panel.** This.
 *
 * ## Construction, and why the offset is a scale rather than a normal
 *
 * The obvious way to give a panel thickness is to push each vertex along the
 * surface normal. The analytic normal of a superellipsoid has a removable
 * singularity at the poles and at all four seams - the same one that makes
 * `taperedSuperellipsoid` use `computeVertexNormals` - so a normal offset puts NaN
 * along exactly the lines the visor's own rim crosses.
 *
 * Instead the outer surface rides a LARGER superellipsoid, `host + rise` on every
 * half-extent, and the inner surface a smaller one. That has three properties
 * worth stating because all three are load-bearing:
 *
 *   1. It cannot produce NaN anywhere the footprint is valid, since it is the same
 *      closed form with different constants.
 *   2. **Every point of the larger solid is strictly outside the host.** For a
 *      point on `host + rise`, the host's own field evaluates to more than 1 term
 *      by term, because each `|x|/a` exceeds `|x|/(a + rise)`. So "the panel is
 *      visible from outside its housing" is not a measurement that has to be
 *      re-taken when a number moves; it is true by construction for any positive
 *      `rise`, and `robotGeometry.test.ts` checks it against the field over every
 *      vertex of the BUILT geometry rather than against the arithmetic that
 *      produced it.
 *   3. The perpendicular thickness is not exactly `rise + inset`. On a sphere it
 *      is exact; on this head it varies by a few per cent across the panel, which
 *      is invisible on a 0.012 m step and is the price of (1) and (2).
 *
 * ## UVs
 *
 * `uv` is the footprint's own coordinate mapped to 0..1 over `halfW` by `halfH`,
 * which is EXACTLY what `PlaneGeometry(2 * halfW, 2 * halfH)` produces. That is
 * why the visor shader did not change by one character when the glyph stopped
 * being a quad: plate space is defined as the glyph's UV space, `VISOR`'s
 * half-extents are in plate space, and both survive the surface bending
 * underneath them. The blink, the gaze and the six expressions are untouched.
 */
export function superellipsoidPatch(opts: SuperellipsoidPatchOptions): BufferGeometry {
  const { host, outline, halfW, halfH, centreY, facing, inset, rise, rings, solid } = opts
  const n = outline.length
  if (n < 8) {
    throw new Error(`robotGeometry: a patch outline needs at least 8 points, got ${n}`)
  }
  if (!(rise > 0)) {
    throw new Error(`robotGeometry: a patch needs a positive rise, got ${rise}`)
  }
  if (!Number.isInteger(rings) || rings < 1) {
    throw new Error(`robotGeometry: a patch needs at least 1 ring, got ${rings}`)
  }
  if (!(halfW > 0) || !(halfH > 0)) {
    throw new Error(`robotGeometry: a patch needs positive half-extents, got ${halfW} x ${halfH}`)
  }
  const chamfer = solid ? opts.chamfer : 0
  const chamferFrac = solid ? opts.chamferFrac : 0
  if (solid) {
    if (!(inset > 0)) {
      throw new Error(`robotGeometry: a solid patch needs a positive inset, got ${inset}`)
    }
    if (!(chamfer > 0) || chamfer >= rise) {
      throw new Error(
        `robotGeometry: a patch chamfer of ${chamfer} does not fit inside a rise of ${rise}; ` +
          `the rim would fold back through the host`,
      )
    }
    if (!(chamferFrac > 0) || !(chamferFrac < 0.5)) {
      throw new Error(`robotGeometry: a patch chamfer fraction must be in (0, 0.5), got ${chamferFrac}`)
    }
  }

  const outer = superellipsoidOffset(host, rise)
  const chamferShape = superellipsoidOffset(host, rise - chamfer)
  const innerShape = superellipsoidOffset(host, -inset)

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  /*
    One vertex, from a footprint point and a shape. Throws rather than emitting
    NaN: a footprint that runs off the host's silhouette is a panel whose rim
    hangs in the air, and NaN positions render as an absent mesh with a healthy
    triangle count, which is this codebase's signature failure. Loud at module
    load is the only place this can be caught, because the shape is built once.
  */
  const push = (px: number, py: number, s: SuperellipsoidShape): number => {
    const y = centreY + py
    const z = superellipsoidZ(px, y, s)
    if (!Number.isFinite(z)) {
      throw new Error(
        `robotGeometry: patch footprint point (${px.toFixed(4)}, ${py.toFixed(4)}) is outside the ` +
          `host's silhouette at y ${y.toFixed(4)}; its rim would float off the surface`,
      )
    }
    const index = positions.length / 3
    positions.push(px, y, facing * z)
    uvs.push(0.5 + px / (2 * halfW), 0.5 + py / (2 * halfH))
    return index
  }

  /*
    Radial ring levels for the outer surface. The last one stops short of the rim
    by `chamferFrac` so the chamfer has somewhere to live; with `solid` false it
    reaches the rim and there is no chamfer.
  */
  const outerMax = 1 - chamferFrac
  const centreOuter = push(0, 0, outer)
  const ringStart: number[] = []
  for (let i = 1; i <= rings; i++) {
    const t = (i / rings) * outerMax
    ringStart.push(positions.length / 3)
    for (const p of outline) push(p.x * t, p.y * t, outer)
  }

  // Centre fan, then one quad band per gap between rings.
  const first = ringStart[0]
  for (let k = 0; k < n; k++) {
    indices.push(centreOuter, first + k, first + ((k + 1) % n))
  }
  for (let i = 0; i < rings - 1; i++) {
    const lo = ringStart[i]
    const hi = ringStart[i + 1]
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      indices.push(lo + k, hi + k, hi + k1)
      indices.push(lo + k, hi + k1, lo + k1)
    }
  }

  if (solid) {
    /*
      The chamfer, then the rim wall, then the inner surface.

      The chamfer ring SHARES its vertices with nothing: it is pushed fresh at
      footprint 1.0 on `host + rise - chamfer`, and the ring before it is the
      outer surface's last. `computeVertexNormals` therefore averages across the
      join, which is what makes it read as a rounded edge rather than as a facet,
      and it is why one step is enough. The reference brief is explicit that a
      moulded plastic part has no 90 degree corner anywhere, and on a 0.012 m
      step this bevel is most of what the eye reads because it is the only
      surface that catches the key as a bright line.

      The rim wall is a SEPARATE pair of rings duplicating the chamfer's outer
      ring and the inner surface's, so the crease between chamfer and wall stays
      hard. Averaging there would smear the panel's edge into the head and undo
      the whole point of a visible step.
    */
    const chamferRing = positions.length / 3
    for (const p of outline) push(p.x, p.y, chamferShape)
    const lastOuter = ringStart[rings - 1]
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      indices.push(lastOuter + k, chamferRing + k, chamferRing + k1)
      indices.push(lastOuter + k, chamferRing + k1, lastOuter + k1)
    }

    const wallTop = positions.length / 3
    for (const p of outline) push(p.x, p.y, chamferShape)
    const wallBottom = positions.length / 3
    for (const p of outline) push(p.x, p.y, innerShape)
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      indices.push(wallTop + k, wallBottom + k, wallBottom + k1)
      indices.push(wallTop + k, wallBottom + k1, wallTop + k1)
    }

    /*
      The inner surface, as one fan and not a ring stack. It is buried by `inset`
      on a CONVEX solid, so every chord of it is further inside the host than its
      endpoints are, and no amount of coarseness can push it out through the
      head. One fan is therefore not a shortcut that might bite later; it is the
      correct resolution for a surface that cannot be seen and cannot poke out.
    */
    const innerRing = positions.length / 3
    for (const p of outline) push(p.x, p.y, innerShape)
    const centreInner = push(0, 0, innerShape)
    for (let k = 0; k < n; k++) {
      indices.push(centreInner, innerRing + ((k + 1) % n), innerRing + k)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)

  /*
    Wound so the outer surface faces away from the host, which for `facing` -1
    means every triangle above has to reverse. Done here rather than by branching
    each `indices.push` because eight winding decisions is eight chances to invert
    one, and an inverted winding is precisely the defect this pass found on the
    ear pods: a lathe built from a descending profile came out inside-out, and
    with backface culling the pod showed nothing at all from the side.

    `robotGeometry.test.ts` measures the signed volume of the result rather than
    trusting either branch.
  */
  if (facing < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]
      indices[i + 1] = indices[i + 2]
      indices[i + 2] = t
    }
    geometry.setIndex(indices)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
