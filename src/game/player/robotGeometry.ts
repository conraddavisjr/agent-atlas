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
 * The foot is a `RoundedBox` 0.32 x 0.17 x 0.44 at radius 0.065, so its bottom
 * face is only FLAT over the inner box: `|x| <= 0.095` and `|z| <= 0.155`.
 * Anything wider than that straddles a corner round and leaves a crescent gap
 * between the pad and the sole, which is exactly the artefact that made the ear
 * pods read as a hole in the cheek. At radius 0.085 stretched 1.6 in z the oval
 * spans 0.085 by 0.136, so it clears the flat region by 0.010 and 0.019.
 *
 * ## It has to PROTRUDE, and the first version of it was invisible
 *
 * This shipped for one iteration with a `lift` of 0.001 meaning "sits a
 * millimetre above the sole plane", on the reasoning that flush would z-fight
 * with the ground. That reasoning describes a decal on a surface, and this is not
 * one: the foot is a SOLID `RoundedBox` spanning y -0.085 to 0.085, so a pad from
 * -0.084 to -0.072 sat entirely inside opaque rubber and could not be seen from
 * any angle at any time. A recess only reads if something is cut out of the
 * housing, and nothing here cuts.
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
  radius: 0.085,
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
 * It has since gone to 0.055; see below.
 *
 * Both burial figures above were measured against a `RoundedBox` head. On the
 * superellipsoid that replaced it the pod's rim is buried between 0.0727 and
 * 0.0809 all the way round, which is a tighter spread than the box gave and is
 * asserted below rather than asserted here.
 *
 * ## The pods vanished in profile, and it was not any of the shapes above
 *
 * The user's third note is "the cylinders that are being used as his ears
 * disappear when I move the camera towards the profile of the character". Four
 * causes were candidates and the arithmetic picks a fifth.
 *
 * It is not that the pod is a thin disc seen edge on: at `halfThickness` 0.105 it
 * is a can 0.21 long, not the 0.03 the brief for this pass supposed, and 0.03 is
 * the FILLET. It is not that the head occludes it: the pod's outer face is at
 * x 0.485 against a head that reaches 0.360 at the same y and z, so 0.125 of it
 * stands clear.
 *
 * **The lathe was wound inside out, and had been since the pods were built.**
 * `roundedDiscProfile` ran from `(0, +halfThickness)` DOWN to `(0, -halfThickness)`,
 * and `LatheGeometry` derives both its winding and its normals from the profile's
 * direction of travel: the outward normal of a profile edge is `(dy, -dx)`, so a
 * descending rim edge with `dy` negative gets a normal pointing at the axis. The
 * built geometry measures a signed volume of **-0.006906** with all 210 radial
 * normals pointing INWARD, against +0.006906 for the same profile reversed.
 * Nothing in the project sets `side`, so `MeshPhysicalMaterial` culls back faces
 * and the only thing on screen was the interior of the pod's far wall.
 *
 * That is why it is angle-dependent, which no amount of "the mesh is missing"
 * would be. At three-quarter view the visible far wall is the curved inside of the
 * rim, which shades plausibly enough to read as a pod. In PROFILE the camera looks
 * down the pod's own axis: the near end cap is a back face and is culled, and the
 * far end cap at x 0.275 is inside the head, which draws in front of it. So the pod
 * contributed nothing at all from the side and something from every other angle,
 * which is exactly the report.
 *
 * The fix is in `roundedDiscProfile`, which now ascends. It also fixes
 * `ARM_BAND` and `ARM_BEVEL`, which are the same generator and were inside out too
 * - measured at -0.000712 - and which no one had reported because a ring seen from
 * outside with only its inner wall drawn still puts a dark band round the arm.
 *
 * ## The second reason, which the winding fix does not address
 *
 * Even wound correctly the pod cannot break the head's outline from the side. Its
 * end cap projects to a disc of radius 0.105 centred at head-local (y 0, z -0.02),
 * so it sits inside the head's 0.27 by 0.31 profile silhouette by 0.165 in y and
 * 0.185 in z. No pod mounted mid-cheek on a head this size can reach the outline;
 * `HAND.radius` and the 0.97 width ladder cap how far out the socket can go.
 *
 * So the profile read has to come from shading instead, and two changes serve it.
 * The head underneath is now curved, so the cheek falls away from the pod's rim
 * rather than presenting the flat side of a box at the same value. And the fillet
 * goes 0.030 to 0.055 with a step more of resolution: the fillet is the only
 * surface on the pod that catches the key as a bright line, and at 0.030 on a
 * 0.21 object it was barely over a pixel at playing distance. At 0.055 the pod is a
 * barrel rather than a can with a flat lid, so there is no single flat normal
 * pointing at the camera to go dark when the key is anywhere else.
 *
 * If a render still says the ears are weak in profile, the dial to turn is
 * `REST.earPodL.x`, not this block: the mittens reach x 0.524 and the pods 0.485,
 * so there is 0.039 of room to push them outboard before they become the widest
 * thing on the character.
 */
export const EAR_POD_SHAPE = {
  radius: 0.105,
  halfThickness: 0.105,
  fillet: 0.055,
  filletSteps: 6,
  radialSegments: 24,
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
 * A `taperedSuperellipsoid`, which the torso already uses, with the taper INVERTED
 * relative to the torso's: `taperTop` above 1 makes it widest at the hip line and
 * narrowing downward, so the legs emerge from a tuck instead of from the widest
 * point. That is the whole difference between a nappy and an inflated ring, and it
 * is what removes the stadium outline without introducing a flat.
 *
 * Measured half-width as a percentage of the 0.62 maximum, against the box:
 *
 *     y            +0.07   0.00   -0.07   -0.10   -0.12   -0.13
 *     RoundedBox    95.3  100.0    95.3    88.3    80.4    74.2
 *     this          99.9   99.1    95.2    87.7    76.8    65.9
 *
 * so it is fuller through the hips and tucks harder underneath, and the widest
 * band moves from the middle to y +0.060 where the torso meets it. The torso is
 * 0.577 wide at that height, so the step at the waist is 0.043 total and reads as
 * a moulded lip rather than as a shoulder.
 *
 * `a` is 0.2871 and not 0.31, and that is not a width change. The taper multiplies
 * every latitude including the equator, so the widest half-width of the solid is
 * `a * max(taper * rim)`, which at `taperTop` 1.14 is `a * 1.0797`. 0.2871 puts the
 * maximum at 0.3100 and therefore the full width at 0.6200, unchanged, which is
 * what `PROPORTIONS.torsoWidthMax` and the head-over-torso inversion both depend
 * on. `c` is 0.2408 by the same factor, for an unchanged 0.52 of depth. Both are
 * checked against the built geometry's bounding box rather than against this
 * comment, because the factor is a numeric maximum and not a closed form.
 *
 * `e1` 0.50 keeps the top and bottom broad instead of domed, and `e2` 0.72 keeps
 * the plan view a soft rounded rectangle wider than it is deep. The bottom pole is
 * a smooth apex between the legs, which a diaper has; the shin's top at hips-local
 * y -0.135 spans `|x|` 0.105 to 0.275 and this shape covers `|x|` up to about 0.16
 * there, so the two overlap by 0.055 and the leg emerges from the garment rather
 * than from beside it.
 */
export const DIAPER = {
  a: 0.2871,
  b: 0.14,
  c: 0.2408,
  e1: 0.5,
  e2: 0.72,
  taperTop: 1.14,
  latSegments: 22,
  lonSegments: 32,
  /**
   * Pushed back, unchanged from the box.
   *
   * This is the puffy rear and it is worth stating because it looks like a nudge.
   * The torso's own depth is 0.52 centred on z 0, so a diaper of the same depth at
   * z -0.03 stands 0.03 further back than the torso and 0.03 less far forward: the
   * reference's "puffy diaper rear" without a second shape to model it.
   */
  z: -0.03,
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
