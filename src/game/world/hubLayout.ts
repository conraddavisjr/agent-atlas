/**
 * The hub's pure layout arithmetic: paths, profiles and gating.
 *
 * Everything here is numbers in and numbers out, with no three.js scene graph
 * and no React, so it can be asserted on in a Node test. That split is not
 * tidiness. This codebase has been cut repeatedly by geometry that silently
 * stopped drawing, a merge that lost its UVs, and a sampler that quietly
 * returned fewer results than it was asked for - all of which produced clean
 * frames. A path generator that drops a corner, or an arc that spans a pylon
 * the tier no longer draws, are exactly that kind of failure, so the parts that
 * can be checked without a GPU live here and are checked.
 *
 * See `docs/design/03-environment.md` and `docs/design/00-art-bible.md`.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  LatheGeometry,
  Vector2,
  Vector3,
} from 'three'
import { palette } from '@/art/palette'
import {
  kerb,
  latheProfile,
  puck,
  slab,
  type LightmapAtlasOptions,
  type PropPart,
} from '@/art/geometry'

export type Point3 = [number, number, number]

/**
 * The walkable plateau's radius, and the number the skirt profile is written
 * against.
 *
 * It lives here rather than in `Terrain.tsx` so that the profile and its test
 * can be checked without pulling a React component - and therefore rapier's
 * wasm - into a Node test run. `Terrain.tsx` re-exports it, so every existing
 * import site is unchanged.
 */
export const PLATEAU_RADIUS = 16

// ---------------------------------------------------------------------------
// Circuit traces
// ---------------------------------------------------------------------------

/**
 * How the watercourse sits on the world.
 *
 * ## Three versions, and what each one actually read as
 *
 * **Version one** was a Catmull-Rom through diagonal waypoints swept at radius
 * 0.14 with its centreline 0.12 clear of the deck: a 0.28 m glossy tube standing
 * 0.26 m proud, wandering, with a square cut at each end. A rubber hose someone
 * had left on the floor.
 *
 * **Version two** - the one this replaces - fixed the path and buried the tube.
 * Right angles mitred at 45 degrees, both ends terminating inside something, and
 * a centreline 0.04 above the surface so the underside sat inside the deck. That
 * path arithmetic was right and it is kept unchanged below. **The cross-section
 * was still a circle, and that is what kept it reading as a pipe rather than as
 * a channel.** The numbers say so plainly: a tube of radius 0.075 with its
 * centre 0.04 up presents a visible width of `2 * sqrt(0.075^2 - 0.04^2)` =
 * **0.127 m while standing 0.115 m proud**, so the trunk was very slightly
 * taller than it was wide. A spur was worse - 0.060 wide and 0.090 proud, an
 * aspect ratio of 1.5 to 1 the wrong way round. Nothing that stands taller than
 * it is wide reads as liquid held in a surface, whatever it is painted with.
 *
 * **This version sweeps a flat-topped section instead**, authored once in
 * `WATER_SECTION` and shared by every piece of water in the level. The trunk is
 * 0.22 m wide and 0.038 m proud, an aspect of 0.17, and the spur is 0.15 by
 * 0.026 - the same shape at a smaller size, which is a property version two did
 * not have and which is worth more than it sounds. See `WATER_SECTION`.
 *
 * ## The deck is NOT carved, and that is a decision rather than an omission
 *
 * There is no groove under the channels. The water is a brim-full inlay: its
 * surface sits at the deck plane, its edge rolls over and tucks back underneath
 * where the deck's own solid volume hides it, and the read of "inset" is carried
 * by value and by the meniscus line rather than by a recess. Section 3 of the
 * build report prices the four alternatives and says what each would have cost.
 *
 * The **pool** is different: it is a real recess, because the character has to
 * step down into it and a collider cannot follow a value trick. See `POOL`.
 */
export const TRACE = {
  /**
   * Surface offset, and it is zero on purpose rather than by neglect.
   *
   * `WATER_SECTION` is authored about the surface the water is held in - `up` 0
   * is the deck plane, positive is proud of it, negative is buried in it - so
   * the path rides exactly ON the deck and the section carries the whole offset.
   * Version two's 0.04 was the tube's centre height, which is a number a circle
   * needs and a section does not.
   *
   * Kept as a named zero rather than deleted because it is the one lever that
   * floats the water off its bed again, and a future scene with water running
   * over a grating will want it. `hubLayout.test.ts` asserts the crown that
   * comes out of it against the environment spec's height rule.
   */
  standoff: 0,
  /**
   * The same on a vertical face, where a run climbs a riser, and this one is NOT
   * zero because a riser is not vertical.
   *
   * Every puck in the kit is drafted 3 degrees, so Puck B's side runs from radius
   * 4.000 at its foot to `4 * (1 - 0.4 * tan(3 deg) / 4)` = 3.979 at its crown, a
   * travel of 0.021 over the riser's height, and its 0.10 m top fillet pulls the
   * last centimetre in further. A sheet of water hung on the nominal face plane at
   * 0 would therefore sit outside the real surface by up to 0.021 near the top of
   * every riser, which exposes the section's tuck - and on a VERTICAL run the tuck
   * points sideways rather than downward, so its normal Y is near zero, the
   * shoreline ramp reads it as open water and it does not fade. An opaque lip of
   * water standing 7 mm off the riser, twelve times in the level.
   *
   * 0.02 centres the sheet in the draft's travel instead of hanging it at one end,
   * so the mismatch is plus or minus 0.010 rather than 0 to -0.021 and the tuck
   * stays buried by at least 0.011 at every height on both radii. Small, and it is
   * the difference between "buried everywhere" and "buried on average".
   */
  faceStandoff: 0.02,
  /**
   * The 45-degree mitre taken off each right-angle corner.
   *
   * Sized against the riser it has to climb rather than by eye. Every riser in
   * the level is 0.40, and `chamferCorners` clamps a cut to 45% of the shorter
   * neighbour, so anything at or above 0.18 turns a 0.40 step into two mitres
   * meeting in the middle - a diagonal ramp, which is the wandering read the
   * rewrite is removing. At 0.12 the step keeps 0.16 of true vertical between
   * two visible mitres and reads as a right angle with a cut corner.
   */
  chamfer: 0.12,
  /** Spacing of the polyline handed to the spline, along a straight run. */
  spacing: 0.15,
  /**
   * Half the visible width of the trunk's water surface.
   *
   * A HALF WIDTH rather than a radius, and the change of unit is the change of
   * shape. 0.11 makes the trunk 0.22 m across and, through
   * `WATER_SECTION`'s fixed proportions, 0.038 m proud - inside the environment
   * spec's absolute 0.12 m rule with three times the margin the tube had.
   *
   * Wider than the tube it replaces, which was 0.127 m of visible width. That is
   * wanted rather than tolerated: the water body renders at display 0.212 against
   * decks at 0.612 to 0.698, and round 2's critique measured 0.00% of the frame
   * below display 0.10 with the conclusion that every other failing was
   * downstream of a world with no shadow end. Widening the darkest surface in the
   * scene by 73% spends area on exactly the thing the frame is short of.
   */
  trunkHalfWidth: 0.11,
  /**
   * Metres over which a channel's relief eases away at each end, so a run can
   * meet standing water without a lip.
   *
   * **This exists because of an arithmetic result, not an aesthetic one.** A
   * channel's surface DOMES - see `WATER_SECTION` - and a pool's is FLAT, so at
   * equal bed heights a channel's crown stands `0.345 * halfWidth` above the water
   * it runs into: 0.038 m on the trunk and 0.026 m on a spur. There are six such
   * junctions in the level and the lip is geometrically wrong at five of them,
   * because water would have to climb it: the four spurs are OUTFALLS from the
   * junction basin and the threshold pad is the trunk's SOURCE, so at all five the
   * channel's water is uphill of the standing water feeding it. Only the trunk
   * arriving at the junction happens to be right.
   *
   * Left alone it renders as four domed tongues 0.15 m wide and 0.026 m tall lying
   * across the pool's surface with their open sections showing at the end - about
   * 15 by 2 px each, in the pool the request is specifically about, directly under
   * the Core node, where the character stands.
   *
   * Tapering the relief to nothing over the last 0.35 m fixes all six junctions at
   * once instead of arguing about any of them, and it is what a real channel does:
   * a dome held by surface tension across 0.22 m cannot survive the channel opening
   * out into a basin. The visible effect is the trunk deflating from 0.038 m to
   * 0.008 m over the 0.35 m before the rim - under a pixel of change per 35 px of
   * length - which reads as the channel opening into the pool.
   */
  mouthTaper: 0.35,
  /**
   * The relief a channel keeps at its very last ring, as a fraction.
   *
   * NOT zero, and this is a degeneracy guard rather than a taste. `up` is what the
   * taper scales and `across` is not, so a relief of exactly 0 puts all nine section
   * points on one horizontal line - including both tucks, which fold back to
   * `across` 0.545 and would land exactly on top of the shoulder samples. That is a
   * ribbon whose end rings carry four zero-area quads, which is how a NaN gets into
   * a normal buffer.
   */
  endRelief: 0.15,
  /**
   * A totem spur, narrower so the player can tell it from the trunk at a glance.
   *
   * The ratio to the trunk is 0.682, which is version two's 0.05/0.075 to three
   * decimal places. The distinction the layout was making is preserved exactly;
   * only the shape it is made with has changed.
   */
  spurHalfWidth: 0.075,
} as const

/**
 * The water's cross-section, authored once and swept, lathed and radiated by
 * everything wet in the level.
 *
 * ## Normalised, and that is the load-bearing property
 *
 * `across` is in units of the piece's half width and `up` is in the SAME units,
 * so the section is **self-similar**: the trunk, the spurs, the junction pool's
 * rim and the threshold pad's rim are all the same shape at four sizes. Two
 * things fall out of that, and both were defects in version two.
 *
 * The shoreline becomes exact everywhere. Version two's alpha ramp was tuned
 * against the trunk's waterline at normal Y `-0.04/0.075 = -0.533` and the same
 * ramp met a spur at `-0.04/0.05 = -0.800`, so - as `waterMaterial.ts` recorded
 * at the time - "on a spur the water stops about a centimetre short of its own
 * shore". A self-similar section presents the identical distribution of normals
 * at every size, so ONE pair of shore numbers is right on all four pieces rather
 * than right on one and erring safely on the rest.
 *
 * And the meniscus becomes a fixed fraction of the width rather than a fixed
 * distance, which is what makes a 0.15 m spur and a 2.10 m pool look like the
 * same liquid.
 *
 * ## Why these five numbers
 *
 * Read from the axis outward:
 *
 * ```
 *   across   up      what it is
 *   0.000   +0.345   the crown, 0.038 m up on the trunk
 *   0.450   +0.300   the dome
 *   0.720   +0.170   the shoulder, where the meniscus lives
 *   1.000    0.000   the RIM, exactly at the deck plane
 *   0.545   -0.409   the tuck, folded back under and buried
 * ```
 *
 * **The crown is 0.345 and not zero, and that is the most considered number
 * here.** A dead-flat ribbon was tried on paper first and it kills the effect,
 * for a reason worth writing down because it is not obvious: both of this water's
 * strongest cues need a RANGE of normals, and a flat surface has one.
 *
 * The sky reflection is a Schlick term in `dot(N, V)`. At the gameplay camera's
 * 33.8 degrees of depression a dead-flat surface gives `dot = sin(33.8) = 0.556`
 * and a Fresnel of `(1 - 0.556)^4 = 0.039`, so a flat channel reflects
 * essentially nothing and renders at its body colour, everywhere, forever.
 *
 * The specular streak is worse. It is a Blinn lobe at exponent 220 against a key
 * 42.7 degrees up, so the half-vector sits near 38 to 55 degrees of elevation and
 * a flat surface's normal misses it by about 45 degrees: `pow(0.7, 220)` is
 * `e^-78`, which is zero in any float. **A flat water surface at this camera has
 * no glint at all** - and the tube's single virtue was that a circle presents
 * every normal, so somewhere on it the half-vector is hit exactly, which is what
 * that streak down its length always was.
 *
 * 0.345 buys back a quarter turn. The section's outward normals run from
 * `(0, 1)` at the crown through `(0.53, 0.85)` at the shoulder to `(1.00, 0.09)`
 * at the rim, so the half-vector is hit somewhere on the shoulder and the
 * grazing angle is reached at the bank. The cues survive; the pipe does not.
 *
 * It is also physically the right shape for the thing being drawn. A brim-full
 * channel domes: 0.038 m of rise over 0.11 m is what surface tension does at this
 * width, and it is why the crown is expressed as a fraction of the half width
 * rather than as a height.
 *
 * ## The tuck
 *
 * The section's widest point is the rim, AT the deck plane, and everything below
 * it folds back inward. So the last two points are inside the deck's own solid
 * volume and are hidden by the depth test rather than by an alpha ramp - the same
 * property version two got from burying a tube, kept deliberately. The alpha ramp
 * still exists, and its job is now only the places where the deck falls away
 * underneath: the twelve riser lips, and every 0.10 m fillet the water crosses.
 */
export const WATER_SECTION = [
  { across: 0, up: 0.345, shore: 0 },
  { across: 0.45, up: 0.3, shore: 0.35 },
  { across: 0.72, up: 0.17, shore: 1 },
  { across: 1, up: 0, shore: 1 },
  { across: 0.545, up: -0.409, shore: 1 },
] as const

/**
 * Where the meniscus starts, as a `shore` value, and it is the number that
 * decides whether the bank line is visible at all.
 *
 * `shore` reaches 1 at the SHOULDER rather than at the rim, which looks like
 * sloppy authoring and is the opposite. The meniscus is `smoothstep(FOAM_SHORE, 1,
 * aShore)`, so a ramp that only completed at the rim would put the whole band on
 * the last quad of the section - and that quad is the one that dips below the
 * surface it is held in and gets buried. Worked through on the pool, where it
 * matters most: with `shore` reaching 1 at the rim, the water's visible edge sits
 * at `shore` 0.75 and the meniscus renders at 43% of its authored weight, with the
 * bright part of it under the bank.
 *
 * Reaching 1 at the shoulder puts the band between `across` 0.533 and 1.0, which
 * is 0.467 half widths: **5.1 cm on the trunk, 3.5 cm on a spur and 5.1 cm on the
 * pool's rim.** At the ground's foreshortened 57 px/m that is 2.9 px on the trunk
 * and at the frontoparallel 103 px/m it is 5.3 px, against the 1.4 px the
 * rim-anchored version would have delivered. A meniscus is allowed to be a
 * hairline; it is not allowed to be a subpixel.
 */
export const FOAM_SHORE = 0.55

/** One point of a resolved section: where it is, which way it faces, how near the bank. */
export type WaterSectionPoint = {
  /** Across the flow, in units of the piece's half width. */
  across: number
  /** Above the surface the water is held in, in the same units. */
  up: number
  /** Outward normal in the (across, up) plane, unit length. */
  normalAcross: number
  normalUp: number
  /**
   * 0 in open water, 1 at the bank, carried to the shader as `aShore`.
   *
   * **A vertex attribute rather than a function of the normal, and that is a
   * correction to version two.** Its meniscus was `1 - smoothstep(shoreTop, ...)`
   * over the world normal's Y, which works on a tube because a tube's normal is a
   * proxy for how far round the surface you are. It does not work on a POOL: a
   * flat disc has normal Y 1.0 across its whole area, so a normal-driven meniscus
   * is either absent everywhere or present everywhere, and there is no pair of
   * numbers that puts it at the rim. Distance-to-bank is the quantity actually
   * wanted, it is known exactly at authoring time, and it costs four bytes a
   * vertex.
   */
  shore: number
}

/**
 * The section resolved into world-ready points, with analytic normals.
 *
 * Normals are computed here rather than by `computeVertexNormals` for one
 * reason: they are the input to the shoreline, and the shoreline is the thing
 * that decides whether the water's edge is a soft meniscus or a hard silhouette
 * line. `hubLayout.test.ts` asserts the resolved values land inside the windows
 * `WATER.shoreTop`, `WATER.shoreBottom` and `WATER.foamShore` open, so the
 * geometry and the shader cannot drift apart without a test failing.
 *
 * `half` mirrors the section about the axis and returns only the outward half,
 * which is what a lathe and a radial disc need; the full form is what a swept
 * ribbon needs.
 */
export function waterSection(half = false, verticalScale = 1): WaterSectionPoint[] {
  const raw = WATER_SECTION.map((p) => ({ ...p, up: p.up * verticalScale }))
  /*
    Normals are always derived on the FULL mirrored section and only then halved,
    which matters for exactly one point and matters a lot there. The crown is the
    section's apex; on the full form it has a neighbour on each side and averages
    to a dead vertical `(0, 1)`, and on a half form taken first it would have one
    neighbour and come out tilted 5.7 degrees outward. That tilt would then be the
    normal of a POOL's entire flat interior - two thousand square centimetres of
    still water lit as though it were a shallow cone, on the piece that sits dead
    centre of frame under the Core.
  */
  const points = [
    ...raw.slice(1).reverse().map((p) => ({ ...p, across: -p.across })),
    ...raw,
  ]

  const resolved = points.map((p, i) => {
    /*
      The normal is the average of the adjoining segment normals, exactly as a
      lathe derives its own, so a run of samples across a fillet comes out smooth
      and a break in the section comes out as a crease. A segment running
      (dAcross, dUp) has outward normal (-dUp, dAcross), which is the +90 degree
      rotation: at the crown the direction is roughly (+1, 0) and the normal comes
      out (0, +1), pointing at the sky.
    */
    let nx = 0
    let ny = 0
    for (const [a, b] of [
      [points[i - 1], p],
      [p, points[i + 1]],
    ] as Array<[typeof p | undefined, typeof p | undefined]>) {
      if (!a || !b) continue
      const dx = b.across - a.across
      const dy = b.up - a.up
      const length = Math.hypot(dx, dy)
      if (length < 1e-12) continue
      nx += -dy / length
      ny += dx / length
    }
    const length = Math.hypot(nx, ny)
    if (length < 1e-12) {
      throw new Error(
        `hubLayout: water section point ${i} at (${p.across}, ${p.up}) has no resolvable ` +
          `normal, which renders as a black or unshaded band down the whole watercourse`,
      )
    }
    return { ...p, normalAcross: nx / length, normalUp: ny / length }
  })

  // The outward half runs from the crown, which is the mirror's midpoint.
  return half ? resolved.slice(WATER_SECTION.length - 1) : resolved
}

/**
 * The junction pool at the Core: a real milled recess in Puck C's top face.
 *
 * ## What was there before
 *
 * `pad(1.05)` at `[0, 1.2, 0]`. `pad` is `roundedCylinder({ height: 0.1 })`
 * standing on its own base, so what the frame actually contained was **a 2.10 m
 * wide, 0.10 m TALL cylinder of water standing on top of the deck** - a cake of
 * water, with a rim, in the middle of the walking route, dead centre of frame
 * beneath the Core node. It had no collider, so the character walked through it.
 * That is the object the user is describing when they ask for the pool to be
 * inset, and inverting it is most of the fix.
 *
 * ## Why this one has to be real geometry when the channels do not
 *
 * The channels get their inset read from value and a meniscus, and that is
 * enough because nothing has to interact with them. **The pool cannot, because
 * the character has to step down into it.** Rapier will not follow a displaced
 * mesh - `Terrain.tsx` carries the note - so a value-only pool gives water the
 * character floats above, which is the exact defect the request is about. The
 * step-down requirement is what forces the carve, and it forces it here and
 * nowhere else.
 *
 * ## Every number, and what constrains it
 *
 * **`depth` 0.05.** The step the character takes. At the gameplay camera - fov
 * 40, `CAMERA.distance` 10.7, `height` 4.3, default pitch 0.25 rad - one world
 * metre at the player is 103 px on the 934-tall capture buffer and a world
 * VERTICAL metre is `103 * cos(33.8) = 85` px, so 0.05 m is **4.3 px**. The user
 * asked for "just a few pixels" and that is the arithmetic that says 0.05 is it.
 * It is also 1/8 of `STEP`, deliberately off the 0.40 grid: this is a surface
 * detail, not a level height, and putting it on the grid would make it a stair.
 *
 * **`bank` 0.10, and it is a constraint rather than a taste.** Two independent
 * things both need the bank shallower than 45 degrees and would each have been
 * satisfied by a vertical wall in the wrong way.
 *
 * The lightmap atlas is the first. `packLightmapAtlas` files a triangle under
 * whichever of six axes its normal is closest to, and parameterises a +X chart by
 * `(z, y)`. A VERTICAL pool wall is radial-facing, so it lands in the same four
 * side charts as Puck C's outer wall and overlaps it in `(z, y)` - two different
 * surfaces claiming the same texels, which bakes as a band of the recess's
 * occlusion painted around the outside of Puck C's rim. At 38 degrees every
 * triangle in the recess has `|normalUp| > |normalRadial|`, so the whole pool
 * files under +Y, where the ring, the bank and the floor are radially disjoint
 * and single-valued. **The overlap is not mitigated, it is made impossible.**
 *
 * The second is `BODY.minSlopeSlideAngle`, which is 35 degrees: Rapier slides the
 * character down anything steeper. That is not a problem for the collider below,
 * which is a set of boxes and presents a vertical step rather than a slope - but
 * it is the reason a heightfield collider was rejected, since a heightfield WOULD
 * present the real 38-degree face and the player would be pushed toward the
 * middle of the pool every time they stood on its edge.
 *
 * The floor is `bank * PI / 2 = 0.0785` at its steepest for a cosine ease, so
 * 0.10 leaves the maximum face at 38.1 degrees with margin on both counts.
 *
 * **`radius` 1.05** is version two's `junctionRadius` unchanged, so the pool is
 * the same circle the four spurs already ran into and the trunk already left
 * from. Confirmed as the circle the user means: the only other pad in the level
 * is `pad(0.9)` at `[0, 2.8, -14.1]`, which is the threshold pad in front of the
 * arch at the far end of the portal stack, not "the center of that layered
 * platform".
 *
 * **`colliderSides` 12.** See `poolRingColliders`.
 */
export const POOL = {
  /** Where the deck's flat top ends and the bank begins. */
  radius: 1.05,
  /** Floor below the deck top. The step the character takes. */
  depth: 0.05,
  /** Horizontal run of the bank. Never below `depth * PI / 2`. */
  bank: 0.1,
  /** Samples across the bank. Six is smooth at 2.27 cm per lightmap texel. */
  bankSegments: 6,
  /**
   * The water surface's edge band, in metres.
   *
   * Equal to `TRACE.trunkHalfWidth` on purpose, so the pool's rim carries exactly
   * the same run of normals - and therefore the same meniscus and the same
   * grazing highlight - as the trunk that feeds it. It is the one number that
   * makes a 2.10 m pool and a 0.22 m channel read as the same liquid.
   */
  rimWidth: 0.11,
  /**
   * How much of the section's vertical relief a DISC's rim keeps. Channels use 1.
   *
   * A pool's surface is flat and a channel's brims, and the section is authored for
   * the channel. 0.345 of a half width is a plausible surface-tension dome across
   * 0.11 m of trunk and it is 0.36 m of mound across a 1.05 m pool, so the relief
   * has to come down for the discs. What sets the exact figure is not taste but
   * whether the meniscus survives: the rim rolls DOWNWARD, the bank rises
   * INWARD, and where they cross is where the water's visible edge is. At full
   * relief they cross at radius 1.008 with `shore` still at 0.75, burying the
   * bright part of the band; at 0.35 they cross at 1.028 where `shore` has reached
   * 1, so the whole meniscus is above water.
   *
   * The grazing highlight survives the flattening, which is not obvious and was
   * checked rather than hoped: flattening the tuck along with the rim keeps the rim
   * vertex's normal near horizontal - its up component goes from 0.092 to 0.047,
   * i.e. slightly MORE grazing - so the sky reflection at the bank is untouched.
   *
   * The visible consequence, stated so it is not mistaken for a bug in a render:
   * the pool's water reads about 2 cm narrower than its recess, with a ring of
   * damp bank above the waterline. That is what a puddle does. It is not brim-full.
   */
  rimDrop: 0.35,
  /**
   * Concentric ripple rings across the pool's radius, as a fraction of
   * `WATER.crests`.
   *
   * The pool's `uv.x` runs RADIALLY and decreases outward, so the shader's
   * existing "crests travel toward decreasing uv.x" advects rings from the centre
   * to the rim - which is what a basin fed from above looks like, and the Core
   * node hangs 4.8 m directly over this one. 0.175 of 40 crests is 7 rings over
   * 1.05 m, a 0.15 m wavelength, which is the spurs' wavelength to the
   * centimetre so the pool and its four outfalls ripple at one scale.
   */
  ringFraction: 0.175,
  /** Sides of the collider polygon that stands in for the annular deck. */
  colliderSides: 12,
} as const

/**
 * The annular deck around the pool, as boxes, because Rapier has no annulus.
 *
 * ## The problem, stated exactly
 *
 * Puck C's collider is one `CylinderCollider(STEP / 2, 2.1)` topping out at 1.20.
 * A cylinder is solid, so it fills the recess: carve the visual and leave this
 * alone and the character walks over the pool at deck height, which is precisely
 * the "water the character floats above" failure. The support the pool needs is
 * an ANNULUS - deck height from the pool's rim out to 2.10, nothing inside it -
 * and Rapier ships no annulus primitive.
 *
 * ## What was rejected
 *
 * **A trimesh.** `HubIsland.tsx` states the house rule in as many words: "never a
 * trimesh, because a trimesh over decorative bevels turns every fillet into
 * something the capsule can catch on". Puck C has a 0.10 m fillet all the way
 * round and the pool would add two more.
 *
 * **A heightfield.** One collider instead of thirteen and it follows the visual
 * exactly, which is genuinely attractive. Two things kill it. A heightfield is a
 * rectangular grid, so it cannot be clipped to Puck C's circle: the corners
 * outside radius 2.10 would be walkable ground floating over Puck B, and pulling
 * them down instead replaces a clean cylindrical rim with a 0.19 m staircase the
 * player feels every time they walk round the Core. And it presents the bank's
 * real 38-degree face, which is past `BODY.minSlopeSlideAngle` of 35, so the
 * character would slide off the pool's edge toward its middle.
 *
 * **Convex hulls.** Correct, and exactly as many colliders as this for strictly
 * more machinery, since a wedge of an annulus needs eight authored vertices where
 * a box needs three half-extents and a yaw.
 *
 * ## Why the polygon's error cannot be seen, which is the whole argument
 *
 * Twelve boxes, each with its inner face a chord tangent to a circle of radius
 * `radius - bank / 2` = 1.00, so the hole they leave is a 12-gon with inradius
 * 1.00 and circumradius `1.00 / cos(15 deg)` = **1.0353**.
 *
 * The visual bank runs from 0.95 to 1.05. **Both of those bounds are inside it**,
 * so every point where the collider steps down lies somewhere on the sloping bank
 * and there is no vantage from which the character can be seen stepping down onto
 * flat deck, or standing on the slope without having stepped. The worst
 * horizontal error is 0.035 m at twelve azimuths, which at the ground's
 * foreshortened 57 px/m is 2 px, and it is swallowed long before that by the
 * capsule: a 0.35 m sphere resting in a 0.05 m recess only reaches the floor once
 * its centre is `sqrt(0.35^2 - 0.30^2)` = **0.18 m inside the rim**, so the
 * character is a fifth of a metre past the boundary before the step-down completes
 * at all.
 *
 * That last number is also why the channels get no collider treatment and want
 * none. A 0.22 m wide groove has a half width of 0.11, well under 0.18, so a
 * capsule bridges it and touches the bottom nowhere: carving the trunk into the
 * deck for real would produce a channel the character walks over without ever
 * entering. The pool works only because it is 2.10 m across.
 *
 * The outer half extent reaches `hypot(2.1, 0.56)` = 2.173 at each box's corners,
 * still inside Puck C's 2.20 visual radius, so the ring cannot poke out of the
 * deck it is standing in.
 */
export function poolRingColliders(): Array<{
  position: Point3
  rotation: Point3
  halfExtents: Point3
}> {
  const inner = POOL.radius - POOL.bank / 2
  const outer = CORE_PUCKS[2].radius - 0.1
  const half = Math.PI / POOL.colliderSides
  /*
    The lateral half length has to cover the OUTER arc, not the inner one, or the
    ring is a twelve-pointed star with twelve wedges of air between its arms - and
    air in a fixed collider set is a hole the player falls through, on the main
    route to the portal. Rounded up by a centimetre so neighbours overlap rather
    than meet exactly, since two boxes that share a face plane to the last float
    bit is not a coverage guarantee.
  */
  const halfLength = outer * Math.sin(half) + 0.01
  const depth = outer - inner
  const centre = (outer + inner) / 2
  const top = CORE_PUCKS[2].base + STEP

  return Array.from({ length: POOL.colliderSides }, (_, i) => {
    const yaw = i * 2 * half
    return {
      position: [Math.cos(yaw) * centre, top - STEP / 2, Math.sin(yaw) * centre] as Point3,
      /*
        The box is authored with its length along local X and its radial depth
        along local Z, and a rotation of `theta` about Y sends local +Z to
        `(sin theta, 0, cos theta)`. The outward bearing here is
        `(cos yaw, 0, sin yaw)`, so the rotation that puts the depth axis on it is
        `PI / 2 - yaw` and NOT `-yaw`.

        This was written as `-yaw` first, which is the transposition somebody makes
        every time: it turns all twelve boxes 90 degrees so their long axes point
        outward and their depth runs tangentially. That still tiles a closed ring
        with no holes, so nothing falls through and nothing errors - it simply
        leaves a ring of boxes sitting across the pool with the recess filled in.
        The symptom is "the step down does not work" and there is nothing in the
        frame to point at, which is why `poolRingColliders` is covered by a test
        that samples inside the pool and outside it rather than by this comment.
      */
      rotation: [0, Math.PI / 2 - yaw, 0] as Point3,
      halfExtents: [halfLength, STEP / 2, depth / 2] as Point3,
    }
  })
}

/** Radius of the cylinder that floors the pool, covering the ring polygon's corners. */
export function poolFloorRadius(): number {
  return (POOL.radius - POOL.bank / 2) / Math.cos(Math.PI / POOL.colliderSides)
}

/** Squared length of a segment, in three dimensions. */
function distance(a: Point3, b: Point3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function unit(from: Point3, to: Point3): Point3 {
  const d = distance(from, to)
  if (d === 0) return [0, 0, 0]
  return [(to[0] - from[0]) / d, (to[1] - from[1]) / d, (to[2] - from[2]) / d]
}

/**
 * Cut every interior corner of a polyline back into a 45-degree mitre.
 *
 * Each corner point is replaced by two points, one on each adjoining segment,
 * `chamfer` metres back from the corner. The cut is clamped to 45% of the
 * shorter neighbour so two corners closer together than twice the chamfer
 * cannot cross over and turn the path inside out - which is the failure mode
 * that would show up as a trace briefly running backwards through a deck.
 *
 * Collinear points are left alone, so densifying before or after is safe.
 */
export function chamferCorners(points: Point3[], chamfer: number): Point3[] {
  if (points.length < 3) return points.map((p) => [...p] as Point3)

  const out: Point3[] = [[...points[0]] as Point3]

  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]

    const incoming = unit(previous, corner)
    const outgoing = unit(corner, next)
    const turn =
      incoming[0] * outgoing[0] + incoming[1] * outgoing[1] + incoming[2] * outgoing[2]

    // Straight through, to within a thousandth of a radian. Nothing to cut.
    if (turn > 0.999999) {
      out.push([...corner] as Point3)
      continue
    }

    const cut = Math.min(
      chamfer,
      0.45 * distance(previous, corner),
      0.45 * distance(corner, next),
    )
    out.push([
      corner[0] - incoming[0] * cut,
      corner[1] - incoming[1] * cut,
      corner[2] - incoming[2] * cut,
    ])
    out.push([
      corner[0] + outgoing[0] * cut,
      corner[1] + outgoing[1] * cut,
      corner[2] + outgoing[2] * cut,
    ])
  }

  out.push([...points[points.length - 1]] as Point3)
  return out
}

/**
 * Subdivide every segment so no two consecutive points are further apart than
 * `spacing`.
 *
 * This is what keeps a straight run straight. A Catmull-Rom through two distant
 * points and a nearby third bulges away from the line between them; a
 * Catmull-Rom through evenly spaced collinear points is exactly the line. So
 * the mitres stay tight and the runs stay flat, without needing the spline to
 * be replaced by something that would put a zero tangent - and therefore a NaN
 * frame - at every corner.
 */
export function densifyPath(points: Point3[], spacing: number): Point3[] {
  if (spacing <= 0) throw new Error(`hubLayout: densifyPath needs a positive spacing, got ${spacing}`)
  if (points.length < 2) return points.map((p) => [...p] as Point3)

  const out: Point3[] = [[...points[0]] as Point3]
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const steps = Math.max(1, Math.ceil(distance(from, to) / spacing))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      out.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ])
    }
  }
  return out
}

/** A right-angled route, mitred and resampled, ready for `trace()`. */
export function orthoTrace(
  corners: Point3[],
  chamfer = TRACE.chamfer,
  spacing = TRACE.spacing,
): Point3[] {
  return densifyPath(chamferCorners(corners, chamfer), spacing)
}

/** Total length of a polyline, used to pick a tube's segment count. */
export function pathLength(points: Point3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

/**
 * How much a polyline climbs and how much it falls, in metres.
 *
 * This exists because the traces are being reclassified as water, and water has
 * a property a circuit trace does not: it only runs one way.
 *
 * `waterMaterial.ts` advects its wave field toward DECREASING `uv.x`, and `uv.x`
 * runs from the first authored corner to the last. That is only downhill if
 * every route in the network climbs monotonically as it is authored, and today
 * both of them do - a spur climbs from its totem plinth at y 0.44 to the
 * junction at 1.24, and the trunk climbs from the junction at 1.24 to the
 * threshold pad at 2.84. So one sign serves the whole network: the arch is the
 * single high point, the four totems are the outfalls, and the junction pad is a
 * basin mid-slope.
 *
 * That is a property of the layout rather than of the shader, so it is checkable
 * here, and it is worth checking rather than reading. A reroute that put one
 * corner of one spur half a step lower than the corner before it would leave
 * water visibly running uphill along a metre of that spur, with nothing in the
 * shader, the material or the geometry to blame - the kind of defect that gets
 * argued about for an afternoon. `hubLayout.test.ts` asserts `down` is zero for
 * both routes.
 *
 * Returns both totals rather than a boolean so a failure says how much and in
 * which direction instead of only that something is wrong.
 */
export function pathVerticalRuns(points: Point3[]): { up: number; down: number } {
  let up = 0
  let down = 0
  for (let i = 1; i < points.length; i++) {
    const rise = points[i][1] - points[i - 1][1]
    if (rise > 0) up += rise
    else down -= rise
  }
  return { up, down }
}

/**
 * Tubular segments for a path of a given length at a given tier.
 *
 * A fixed count is wrong for two paths that differ by a factor of three in
 * length: the trunk came out with a segment every 0.14 m, which rounds a 0.18 m
 * mitre back into the curve it was put there to remove. Sampling by distance
 * instead keeps the corner crisp on both, and the geometry is cheap enough that
 * the extra rings do not register - the whole trace batch is under six thousand
 * triangles at high.
 */
export function traceSegments(length: number, tierSegments: number): number {
  const step = 3 / Math.max(1, tierSegments)
  return Math.max(16, Math.round(length / step))
}

// ---------------------------------------------------------------------------
// The water geometry: a swept channel, a radial disc, a carved basin
// ---------------------------------------------------------------------------

/**
 * The distance-to-bank attribute, named once so the geometry and the shader
 * cannot disagree about it.
 *
 * A misspelling here is the canonical silent shader failure in this project: three
 * finds no such attribute, GLSL leaves it at zero, `aShore` reads 0 everywhere,
 * the meniscus disappears from the entire watercourse, and the frame renders
 * cleanly. `waterMaterial.test.ts` asserts the shader's `attribute` line quotes
 * this exact constant.
 */
export const WATER_SHORE_ATTRIBUTE = 'aShore'

const WORLD_UP = new Vector3(0, 1, 0)

/**
 * Sweep `WATER_SECTION` along a route, with the section's "up" held to the
 * surface the route is running on.
 *
 * ## Why not `tubeFromCurve`, which already exists and already works
 *
 * `TubeGeometry` sweeps a CIRCLE on a parallel-transport frame. Two things about
 * that are wrong for a channel and neither can be fixed by choosing a radius.
 *
 * The section is not a circle - that is the whole point of this pass, see
 * `WATER_SECTION` - and a non-circular section swept on a Frenet-derived frame
 * ROLLS. Three's `computeFrenetFrames` picks its initial normal off the smallest
 * tangent component and then transports it, which is exactly right for a tube
 * because a tube is rotationally symmetric and cannot show the roll. A flat
 * ribbon shows it immediately: the trunk climbs four risers, and a frame that
 * rolled by even ten degrees over that would present the channel's flat top
 * tilted to the deck, differently on each of the five levels.
 *
 * So the frame here is built from the world instead of transported:
 * `across = tangent x worldUp` and `up = across x tangent`. On a horizontal run
 * that puts the section's up on world up and its flat top parallel to the deck,
 * exactly, at every sample and forever. On a VERTICAL run - the twelve riser
 * climbs - `tangent x worldUp` degenerates, so `across` is carried from the last
 * sample that had one and `up` comes out horizontal, pointing away from the riser
 * face: the same section, stood on its edge, which reads as a sheet of water
 * falling down the step. That is the behaviour version two got by accident from a
 * tube's rotational symmetry and this gets on purpose.
 *
 * Both of this level's routes are planar - the trunk lies in x = 0 and each spur
 * in its own diagonal vertical plane - so `across` is in fact constant along each
 * one and the carry only ever fires on the vertical legs. The sign-continuity
 * guard below is therefore dead code today and is kept anyway, because the first
 * route with a turn in PLAN would otherwise flip the section over mid-run.
 *
 * Sampled by arclength through `getPointAt`/`getTangentAt`, which is what
 * `TubeGeometry` does, so `uv.x` still runs 0 to 1 from the first authored corner
 * to the last and the hydrology argument in `pathVerticalRuns` carries over
 * unchanged.
 */
export function sweepChannel(
  points: Point3[],
  halfWidth: number,
  segments: number,
): BufferGeometry {
  if (!(halfWidth > 0)) {
    throw new Error(`hubLayout: sweepChannel needs a positive half width, got ${halfWidth}`)
  }
  const rings = Math.max(2, Math.round(segments)) + 1

  const curve = new CatmullRomCurve3(
    points.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'catmullrom',
    0.5,
  )

  const centres: Vector3[] = []
  const tangents: Vector3[] = []
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    centres.push(curve.getPointAt(t))
    tangents.push(curve.getTangentAt(t).normalize())
  }

  /*
    The relief at each ring, eased to `TRACE.endRelief` over `TRACE.mouthTaper` at
    both ends so a run can meet standing water without a lip. See `TRACE.mouthTaper`.

    The section is re-resolved per ring rather than scaled after the fact, because
    scaling a vertex's height without recomputing its normal is exactly the class of
    quiet lie this file is written to avoid: the shoreline and the meniscus both read
    those normals, and a flattened section whose normals still describe the tall one
    would fade its alpha in the wrong place. Nine points and two cross products a
    ring, three hundred rings, once at mount.
  */
  const length = Math.max(curve.getLength(), 1e-6)
  /*
    Capped at 0.45 so the two eases cannot overlap and cancel each other on a run
    shorter than twice the taper, and floored above zero because `mouthTaper` of 0
    would make the first ring's `0 / 0` a NaN - which would propagate through every
    position on that ring and, on most drivers, draw one frame of full-screen garbage.
  */
  const fraction = Math.max(1e-6, Math.min(0.45, TRACE.mouthTaper / length))
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const sections = Array.from({ length: rings }, (_, i) => {
    const t = i / (rings - 1)
    const taper = ease(t / fraction) * ease((1 - t) / fraction)
    return waterSection(false, TRACE.endRelief + (1 - TRACE.endRelief) * taper)
  })
  /*
    Read off the resolved section rather than recomputed from `WATER_SECTION.length`,
    so re-authoring the section - or changing how it mirrors - cannot leave the buffer
    stride and the point count disagreeing. They would disagree by reading past the end
    of an array, which in JS is `undefined` and then NaN rather than a throw.
  */
  const across = sections[0].length

  /*
    Resolve `across` for every ring, seeded from the first sample that has a
    horizontal tangent and then carried in both directions. Seeding rather than
    starting at ring zero matters for a route that begins on a vertical leg, which
    neither of this level's two do and a cave waterfall would.
  */
  const raw = tangents.map((t) => new Vector3().crossVectors(t, WORLD_UP))
  const seed = raw.findIndex((v) => v.length() > 1e-3)
  if (seed < 0) {
    throw new Error(
      'hubLayout: sweepChannel was given an entirely vertical route, which has no ' +
        'horizontal across-flow direction and would sweep a degenerate ribbon',
    )
  }
  const sides: Vector3[] = new Array(rings)
  sides[seed] = raw[seed].clone().normalize()
  const resolve = (i: number, from: number) => {
    const side = raw[i].length() > 1e-3 ? raw[i].clone().normalize() : sides[from].clone()
    // Keep the section from flipping over where a route turns back on itself.
    if (side.dot(sides[from]) < 0) side.negate()
    sides[i] = side
  }
  for (let i = seed + 1; i < rings; i++) resolve(i, i - 1)
  for (let i = seed - 1; i >= 0; i--) resolve(i, i + 1)

  const position = new Float32Array(rings * across * 3)
  const normal = new Float32Array(rings * across * 3)
  const uv = new Float32Array(rings * across * 2)
  const shore = new Float32Array(rings * across)

  const up = new Vector3()
  for (let i = 0; i < rings; i++) {
    const side = sides[i]
    up.crossVectors(side, tangents[i]).normalize()
    const centre = centres[i]
    const section = sections[i]
    for (let k = 0; k < across; k++) {
      const s = section[k]
      const v = (i * across + k) * 3
      position[v] = centre.x + side.x * s.across * halfWidth + up.x * s.up * halfWidth
      position[v + 1] = centre.y + side.y * s.across * halfWidth + up.y * s.up * halfWidth
      position[v + 2] = centre.z + side.z * s.across * halfWidth + up.z * s.up * halfWidth
      /*
        `side` and `up` are orthonormal and the section normal is unit, so the
        combination is already unit and needs no renormalising. Stated rather than
        assumed because `paintByFacing` and `mergeProp` both read this attribute
        directly and a normal of length 1.4 renders as a surface that is simply
        brighter than the one beside it.
      */
      normal[v] = side.x * s.normalAcross + up.x * s.normalUp
      normal[v + 1] = side.y * s.normalAcross + up.y * s.normalUp
      normal[v + 2] = side.z * s.normalAcross + up.z * s.normalUp
      const t = (i * across + k) * 2
      uv[t] = i / (rings - 1)
      uv[t + 1] = k / (across - 1)
      shore[i * across + k] = s.shore
    }
  }

  const index: number[] = []
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < across - 1; k++) {
      const a = i * across + k
      const b = a + 1
      const c = a + across
      const d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setAttribute(WATER_SHORE_ATTRIBUTE, new BufferAttribute(shore, 1))
  geometry.setIndex(index)
  return geometry
}

/**
 * A still disc of water: the junction pool and the threshold pad.
 *
 * Flat across its interior with the section's outward half wrapped round its rim,
 * so a 2.10 m pool and a 0.22 m channel carry the same meniscus and the same
 * grazing highlight at their banks. The interior is genuinely flat rather than
 * domed, because 0.345 of a half width is a plausible surface-tension dome on a
 * 0.11 m channel and an absurd 0.36 m mound on a 1.05 m pool.
 *
 * `uv.x` runs RADIALLY and DECREASES outward, which is the whole reason the pool
 * looks fed rather than static: the shader advects crests toward decreasing
 * `uv.x`, so rings travel from the centre out to the rim. See `POOL.ringFraction`.
 * `uv.y` is the azimuth, which is periodic in the shader's `sin(vUv.y * TAU)`
 * cross-flow term and therefore leaves no seam at the wrap.
 *
 * The interior needs no tessellation beyond a fan. Everything that varies across
 * it - `uv.x`, and therefore the whole wave field - is linear in radius, and a
 * linear function is interpolated exactly across a triangle however large it is.
 */
export function waterDisc(
  radius: number,
  rimWidth: number,
  ringFraction: number,
  radialSegments = 32,
): BufferGeometry {
  if (!(radius > rimWidth)) {
    throw new Error(
      `hubLayout: waterDisc needs a radius wider than its rim, got ${radius} and ${rimWidth}`,
    )
  }
  const section = waterSection(true, POOL.rimDrop)
  const rings = section.length
  const crown = section[0].up

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const shores: number[] = []
  const index: number[] = []

  const push = (r: number, y: number, nr: number, ny: number, azimuth: number, shore: number) => {
    const cos = Math.cos(azimuth)
    const sin = Math.sin(azimuth)
    positions.push(cos * r, y, sin * r)
    normals.push(cos * nr, ny, sin * nr)
    uvs.push(ringFraction * (1 - r / radius), azimuth / (Math.PI * 2))
    shores.push(shore)
  }

  /*
    `radialSegments + 1` columns, with the last one duplicating the first at a
    different uv, which is what `TubeGeometry` does and for the same reason.

    A shared seam vertex - closing the ring with `(j + 1) % radialSegments` - would be
    cheaper by one column and would put a uv DISCONTINUITY on the closing quad, where
    `uv.y` interpolates from 0.97 back down to 0. The shader's cross-flow term is
    `sin(vUv.y * TAU)`, and periodicity does not save it: the function is continuous
    in its argument, but across that one quad the argument sweeps the entire range
    backwards, so the wave modulation runs in reverse down one radial spoke of the
    pool. One fixed seam, forever, on the piece at the centre of frame.

    The existing note in `waterMaterial.test.ts` says periodicity is what removes this
    seam. That is true of a tube only because three duplicates the seam column; it is
    the duplication doing the work, and the periodicity is what makes the duplication
    free of a value jump.
  */
  const columns = radialSegments + 1
  const azimuthOf = (j: number) => (j / radialSegments) * Math.PI * 2

  // The centre, as one vertex per column so the fan's uv and normal stay simple.
  for (let j = 0; j < columns; j++) {
    push(0, 0, 0, 1, azimuthOf(j), section[0].shore)
  }
  for (let k = 0; k < rings; k++) {
    const s = section[k]
    for (let j = 0; j < columns; j++) {
      push(
        radius - rimWidth + s.across * rimWidth,
        (s.up - crown) * rimWidth,
        s.normalAcross,
        s.normalUp,
        azimuthOf(j),
        s.shore,
      )
    }
  }

  /*
    Winding. Looking down from +Y with x to the right, increasing azimuth runs
    CLOCKWISE on screen, so an up-facing triangle has to be wound against it. The
    two orders below give a geometric normal whose Y component is
    `r_inner * (r_outer - r_inner) * sin(dAzimuth)`, positive while the radius
    grows - which means the tuck ring, where the radius shrinks again, comes out
    facing DOWNWARD by construction. That is correct rather than a bug to patch:
    the tuck IS the underside, and its analytic normal says so too.
  */
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < radialSegments; j++) {
      const next = j + 1
      const inner = k * columns
      const outer = (k + 1) * columns
      /*
        The innermost strip is a FAN, so it gets one triangle rather than two: its
        inner ring is `radialSegments` copies of the centre point, and the quad's
        first triangle would be (centre, centre, rim) with zero area. Harmless to
        render and not harmless to leave - a degenerate triangle is the thing that
        turns a later `computeVertexNormals` or a merge into a NaN hunt.
      */
      if (k > 0) index.push(inner + j, inner + next, outer + j)
      index.push(inner + next, outer + next, outer + j)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute(WATER_SHORE_ATTRIBUTE, new BufferAttribute(new Float32Array(shores), 1))
  geometry.setIndex(index)
  return geometry
}

/**
 * Puck C, with the pool milled into its top face.
 *
 * ## One part, not two, and the atlas is why
 *
 * The obvious decomposition is a full-height annulus plus a shorter disc to floor
 * the pool. It is wrong, and the reason is the lightmap rather than the render: an
 * annulus has an inward-facing cylindrical hole wall as well as an outward-facing
 * outer wall, both radial, so both land in the same four side charts and overlap
 * there across most of the chart's area. A single lathe whose recess is shallower
 * than 45 degrees has no radial surface in the recess at all - see `POOL.bank` -
 * so all of it files under +Y where the ring, the bank and the floor occupy
 * disjoint annuli of `(x, z)` and the parameterisation stays single-valued.
 *
 * ## The outer shell is `puck(2.2, STEP)` to the last float, and that is tested
 *
 * The bottom fillet, the side, the 0.10 m top fillet and the 3-degree draft are
 * reproduced here rather than referenced, because `roundedCylinder` builds its
 * profile internally and offers no hook to interrupt it. Duplicating a generator
 * is a real cost and it is paid deliberately: the alternative is a `recess` option
 * on `roundedCylinder` in `src/art/geometry.ts`, which belongs to nobody this pass
 * and is the right home for this the moment a second scene wants a basin.
 *
 * What makes the duplication safe is that it is checked rather than reviewed.
 * `hubLayout.test.ts` asserts every vertex of this lathe outside the pool's
 * influence has an exact counterpart in `puck(2.2, STEP)` and vice versa, which
 * pins the fillet radii, the fillet segment counts, the radial segment count and
 * the draft in one assertion. A transcription error anywhere in the outer profile
 * fails it.
 *
 * The draft is applied to the whole profile including the recess, which shrinks
 * the pool by 1% and - as a side effect that happens to be right - narrows it
 * toward the floor, which is the direction a moulded cavity has to draft to
 * release from its core pin.
 */
export function basinLathe(): BufferGeometry {
  const radius = CORE_PUCKS[2].radius
  const height = STEP
  const half = height / 2
  // `puck` passes rim 0.1, so bottomFillet is min(0.05, rim) and filletSegments is 5.
  const top = Math.min(0.1, half, radius * 0.98)
  const bottom = Math.min(0.05, half, radius * 0.98)
  const filletSegments = 5
  const radialSegments = 32

  const points: Vector2[] = []
  const push = (x: number, y: number) => {
    const last = points[points.length - 1]
    if (last && Math.abs(last.x - x) < 1e-7 && Math.abs(last.y - y) < 1e-7) return
    points.push(new Vector2(x, y))
  }

  push(0, 0)
  for (let i = 0; i <= filletSegments; i++) {
    const angle = -Math.PI / 2 + (i / filletSegments) * (Math.PI / 2)
    push(radius - bottom + Math.cos(angle) * bottom, bottom + Math.sin(angle) * bottom)
  }
  for (let i = 0; i <= filletSegments; i++) {
    const angle = (i / filletSegments) * (Math.PI / 2)
    push(radius - top + Math.cos(angle) * top, height - top + Math.sin(angle) * top)
  }

  // In across the deck to the pool's rim, then down the bank and across the floor.
  push(POOL.radius, height)
  for (let j = 1; j <= POOL.bankSegments; j++) {
    const s = j / POOL.bankSegments
    /*
      A cosine ease rather than a straight chamfer with fillets at both ends. It
      is one expression instead of two arcs and a line, its tangent is horizontal
      at both ends so it meets the deck and the floor with no crease at all, and
      its steepest point is analytic: `depth * PI / (2 * bank)`, which is what
      lets `POOL.bank` be argued from the 45-degree ceiling rather than measured
      off a drawing.
    */
    push(POOL.radius - POOL.bank * s, height - POOL.depth * (0.5 - 0.5 * Math.cos(Math.PI * s)))
  }
  push(0, height - POOL.depth)

  const shrink = 1 - Math.min(0.9, (height * Math.tan((3 * Math.PI) / 180)) / radius)
  for (const p of points) p.x *= 1 + (shrink - 1) * (p.y / height)

  return latheProfile({ points, radialSegments })
}

/**
 * The canonical totem spur trace, written for the NE spur and rotated for the
 * other three.
 *
 * Right angles, in the vertical plane as well as in plan: the run crosses the
 * lobe and Puck A at one height, climbs Puck B's rim, crosses Puck B, climbs
 * Puck C's rim, and terminates inside the junction pad. Both ends are buried -
 * the outer end inside the totem plinth, the inner end inside the pad - so
 * neither shows a cut tube.
 *
 * Radii, measured from the origin along the diagonal:
 *
 *   7.00  inside the totem plinth, which is radius 0.70 at radius 7.071
 *   4.02  Puck B's rim, radius 4.00
 *   2.22  Puck C's rim, radius 2.20
 *   0.95  inside the junction pad, radius 1.05
 */
export function spurTraceCorners(): Point3[] {
  const diagonal = Math.SQRT1_2
  const at = (radius: number, y: number): Point3 => [radius * diagonal, y, -radius * diagonal]
  const s = TRACE.standoff
  return [
    at(7, 0.4 + s),
    at(4 + TRACE.faceStandoff, 0.4 + s),
    at(4 + TRACE.faceStandoff, 0.8 + s),
    at(2.2 + TRACE.faceStandoff, 0.8 + s),
    at(2.2 + TRACE.faceStandoff, 1.2 + s),
    at(0.95, 1.2 + s),
  ]
}

/**
 * The north trunk, from the junction pad to the threshold pad in front of the
 * arch, climbing four risers on the way.
 *
 * It runs down the centreline at x = 0 and every turn is a right angle, so the
 * whole route reads as one straight line stepping up four times rather than as
 * a hose draped over four steps. The z values are the south faces of the pieces
 * it climbs - the bridge at -2.20, T1 at -6.60, T2 at -10.60, T3 at -12.40 -
 * each offset out by `faceStandoff` so the vertical run hugs the riser without
 * intersecting its bevel.
 */
export function trunkTraceCorners(): Point3[] {
  const s = TRACE.standoff
  const f = TRACE.faceStandoff
  const risers: Array<[number, number, number]> = [
    // [face z, lower top y, upper top y]
    [-2.2, 1.2, 1.6],
    [-6.6, 1.6, 2],
    [-10.6, 2, 2.4],
    [-12.4, 2.4, 2.8],
  ]

  const out: Point3[] = [[0, 1.2 + s, -0.95]]
  for (const [faceZ, lower, upper] of risers) {
    out.push([0, lower + s, faceZ + f])
    out.push([0, upper + s, faceZ + f])
  }
  // Terminates inside the threshold pad, which is radius 0.90 at z = -14.10.
  out.push([0, 2.8 + s, -13.7])
  return out
}

// ---------------------------------------------------------------------------
// The island's skirt
// ---------------------------------------------------------------------------

/** One stop on a lathe profile, in the (radius, y) plane. */
export type LatheStop = { radius: number; y: number }

/**
 * One stop on the skirt profile: where it is, and what colour it is there.
 *
 * The value rides on the same row as the geometry on purpose. The two previous
 * versions of this skirt each kept the profile in one place and its colours in
 * another, and the second one shipped a two-colour facing paint against an
 * eight-stop profile, so seven of the eight stops were the same value. Putting
 * them in one table makes that class of mismatch unrepresentable rather than
 * merely tested for, and `paintByHeight` consumes the y values directly, so the
 * ramp cannot drift off the geometry it is painting.
 */
export type SkirtStop = LatheStop & { value: string }

/*
  THE SKIRT'S VALUES.

  Only the top stop exists in `palette.ts`. The four below it are proposed
  palette values, declared here for one round exactly as `Terrain.tsx`'s `CLIFF`
  was last round, and listed in the build report for promotion. None of them may
  ever carry a `band()` assertion: `VALUE_BANDS.anchor` refuses hex assertions on
  purpose, and these are the reason it does.

  The display luma of each hex is in the comment because the rendered value is
  NOT the hex - it is roughly a fifth of it on these facings, and every previous
  round of this project was lost by confusing the two.
*/
/** 0.221 as a hex. The lip shelf's lower edge, where the mid-value band ends. */
const KEEL_SHELF = '#4a3524'
/** 0.108. The widest point, and the deepest thing normally in frame. */
const KEEL_WALL = '#241a13'
/** 0.074. Below the silhouette; visible only if a camera ever goes under. */
const KEEL_UNDER = '#191209'
/** 0.054 / 0.050. The root, which no vantage in the game can reach. */
const KEEL_ROOT_UPPER = '#120d0a'
const KEEL_ROOT = '#100c0a'

/**
 * The island's underside: one lathe profile, with an overhanging flare whose
 * widest point is 1.8 m BELOW the lawn.
 *
 * ## Two previous versions, two different ways of being wrong
 *
 * **Version one** drew a rim cylinder, a soil band and a root cone, all tapering
 * INWARD from the plateau radius. Every camera looks down at the island, so the
 * plateau occluded all three completely. Six draw calls with their shadow
 * passes, not one pixel in any frame.
 *
 * **Version two** - the one this replaces - fixed that with an overhang: the
 * first stop below the lawn stepped outward to `r + 0.78` at y = -0.52, and
 * everything below turned back in. It is visible, and it is the reason the
 * island has an edge at all. But it bought a TRIM rather than a THICKNESS, and
 * the profile arithmetic says why.
 *
 * For a solid of revolution seen from outside and above, the stop of maximum
 * radius IS the lower silhouette. Everything below it is either behind it or
 * back-facing. Version two put that stop 0.52 m below the lawn, so the entire
 * visible band below the lawn was the 0.72 m up-facing shelf between the lawn's
 * edge and the overhang - measured on `hub-establishing` at high, 1660x934, as
 * 95.8% of every skirt pixel in the frame, with the cliff below contributing
 * exactly zero. The band read 0.230 falling to 0.202 over ninety pixels at
 * x = 1550, and **0.028 of that 0.029 fall was the vignette**, not the surface.
 * The cliff's careful `soilDeep` was painting geometry no camera could see.
 *
 * ## What changed, and the one number it turns on
 *
 * The widest point stays at `r + 0.78` - the island's silhouette is unchanged in
 * plan, which matters because three other systems are framed against it - and
 * moves DOWN, from y = -0.52 to y = -1.80. The overhang is preserved; the
 * thickness it overhangs is what is new. The band between the lawn's edge and
 * the silhouette stops being a shelf seen nearly face-on and becomes a wall
 * falling 1.54 m, and it is that wall which carries the anchor band.
 *
 * Predicted on the same frame: the underside goes from 4,785 pixels at or below
 * 0.18 to 10,572, from 5 pixels below 0.10 to 1,806, and the x = 1550 profile
 * from a flat 0.231-0.201 to a monotone 0.231 down to 0.127 with 44 contiguous
 * pixels at or below 0.18.
 *
 * ## The shelf's slope is load-bearing and it is not an aesthetic choice
 *
 * 0.26 over 0.52, a slope of 0.50. From a camera standing ON the plateau, a ray
 * reaches the skirt only if it clears the lawn's edge and then descends faster
 * than the outermost skirt surface - so the underside is invisible from inside
 * the island unless `height / distance-to-edge` exceeds this slope. The worst
 * case among the five vantages sited on the island is `hub-totem` at 0.341, and
 * `hub-grazing` is 0.111. That is why a near-black underside cannot appear as a
 * band at eye level in those shots: not because it is dark enough to get away
 * with, but because it is not in the frame. Lower this slope below about 0.36
 * and that stops being true.
 */
export function islandSkirtProfile(plateauRadius: number): SkirtStop[] {
  const r = plateauRadius
  return [
    // Flush with the lawn's edge, so the lawn-to-soil transition is a hard line.
    { radius: r, y: 0, value: palette.soil },
    /*
      The lip shelf, and it does two opposite jobs depending on which side of the
      island it is on. Worth stating both, because the first draft of this comment
      claimed only the flattering one.

      On the KEY flank it is up-facing surface taking the key at N.L up to 0.999,
      so it is a midground value by arithmetic and no albedo can argue it into the
      anchor band: measured over azimuths 50 to 100 degrees it means 0.196, which
      is the bright line that makes the dark below it read as a thickness rather
      than as a black outline drawn round the lawn. That is the round-2 gain, and
      it is kept.

      On the ANTI-KEY flank the same surface is the DARKEST THING IN THE FRAME, at
      0.073 to 0.088. Up-facing and no key to face. It is also the only part of the
      skirt still in frame out there: the wall below is dead vertical, so its
      normal is radial, and a radial normal goes edge-on to the camera about 70
      degrees either side of the camera's own bearing. Past that the shelf is all
      there is, which is why it reads as 108 px of dark at x = 0 rather than as the
      hairline its 0.52 m width suggests.

      `KEEL_SHELF` is therefore the one constant to move if the left flank crushes.
      It is monotone and it trades directly against the acceptance run at x = 1550:
      0.183 gives a 51 px run and 260 crushed pixels, 0.221 gives 44 px and 97,
      0.265 gives 29 px and none, 0.310 gives 6 px and fails. 0.221 is chosen for
      margin on the criterion rather than on the crush, because the model behind
      those numbers is anchored on a key-lit surface and is least trustworthy
      exactly where the crush would be.

      Narrower than version two's 0.72 for the same reason it is not narrower
      still: every metre of it is midground on one side and anchor on the other.
    */
    { radius: r + 0.52, y: -0.26, value: KEEL_SHELF },
    /*
      The widest point, and the whole change. Down here rather than at -0.52, so
      there is 1.54 m of wall above it inside the island's own silhouette.

      Its normal is (1.000, -0.007): dead vertical. A vertical wall on the
      anti-key flank receives no key at all, and on the key flank receives
      0.735 * cos(azimuth from the key) - about half what the shelf gets. Both
      are in the frame at `hub-establishing`, which is why the underside comes out
      asymmetric: 0.06-0.13 on the left flank, 0.13-0.23 on the right. That is
      the light being correct rather than a defect to flatten.
    */
    { radius: r + 0.78, y: -1.8, value: KEEL_WALL },
    // Below the silhouette. The turn back in has to be here rather than higher,
    // or the widest point moves up and the wall above it is occluded again.
    { radius: r + 0.4, y: -3.05, value: KEEL_UNDER },
    { radius: r - 3.4, y: -4.55, value: KEEL_ROOT_UPPER },
    { radius: r - 9.2, y: -6.0, value: KEEL_ROOT },
    { radius: 0, y: -7.2, value: KEEL_ROOT },
  ]
}

/**
 * The skirt as a lathe, with its profile in the order three needs.
 *
 * **This is where the silent failure lives, so the conversion is here and it is
 * tested.** `LatheGeometry` derives each normal as `(dy, -dx)` from the step to
 * the next profile point, so a profile authored from the top down - which is
 * the order it reads in, and the order `islandSkirtProfile` returns - produces
 * a mesh whose every normal points inward and downward. That renders as a
 * backfacing shell: invisible from outside the island, with a correct triangle
 * count, correct bounds, `visible: true` and no error anywhere. The frame comes
 * out looking exactly like the one this change exists to fix.
 *
 * The keel makes that test sharper rather than redundant. Version two's profile
 * was outward-facing at every stop, so an inward shell would have shown from any
 * angle; this one has a dead-vertical stop at the widest point, whose normal is
 * (1.000, -0.007) and whose sign therefore turns on 0.12 m of radius. That is
 * exactly the size of edit somebody makes while tuning a silhouette.
 */
export function islandSkirtLathe(plateauRadius: number, segments: number): BufferGeometry {
  const points = islandSkirtProfile(plateauRadius)
    .map((stop) => new Vector2(stop.radius, stop.y))
    .reverse()
  return new LatheGeometry(points, segments)
}

/**
 * The skirt's value ramp, in the form `paintByHeight` takes.
 *
 * Derived from the profile rather than written beside it, so the ramp's rungs are
 * the profile's own heights by construction. A rung that does not coincide with a
 * profile stop is not merely untidy: the GPU interpolates vertex colour linearly
 * between the ring vertices it has, so a rung authored halfway down a segment is
 * silently rounded to the nearest ring and the value the comment claims is not
 * the value that renders.
 */
export function islandSkirtValues(plateauRadius: number): Array<{ y: number; colour: string }> {
  return islandSkirtProfile(plateauRadius).map((stop) => ({ y: stop.y, colour: stop.value }))
}

// ---------------------------------------------------------------------------
// The background silhouette layer
// ---------------------------------------------------------------------------

/** One slab in the far monolith arc. */
export type Monolith = {
  x: number
  z: number
  /** Distance from the origin, which is what the fog and the tint key off. */
  distance: number
  width: number
  depth: number
  height: number
  baseY: number
  yaw: number
}

/**
 * The far layer: a broken arc of tall slabs across the northern horizon.
 *
 * The frame had exactly two depth layers, subject and sky, and the top half of
 * the portal shot was empty. The reference brief asks for three or four
 * parallax layers each in its own value band, and the environment spec has
 * specified this one since its first draft without it ever being built.
 *
 * These are the rest of the network: server monoliths, the same die the player
 * is standing on, at a scale that makes the island read as one chip among many.
 * They rise from below the fog rather than standing on anything, which removes
 * the question of what they are standing on: the bottoms dissolve and the tops
 * are what read.
 *
 * Placed on a jittered arc rather than a circle, because a constant radius is a
 * wall and a jittered one has depth - and depth inside the layer is what lets
 * one draw call do the work of two.
 */
export function monolithArc(count: number, random: () => number): Monolith[] {
  const out: Monolith[] = []
  // The northern 180 degrees, plus two strays behind the camera's shoulders so
  // the layer does not stop dead at the edge of frame when the player turns.
  const strays = [20, 160]

  for (let i = 0; i < count; i++) {
    const isStray = i >= count - strays.length
    const degrees = isStray
      ? strays[i - (count - strays.length)] + (random() - 0.5) * 14
      : 182 + ((i + 0.5) / Math.max(1, count - strays.length)) * 176 + (random() - 0.5) * 10

    const distance = 95 + random() * 35
    const radians = (degrees * Math.PI) / 180
    const top = -6 + random() * 24
    const height = 28 + random() * 28

    out.push({
      x: Math.cos(radians) * distance,
      z: Math.sin(radians) * distance,
      distance,
      width: 8 + random() * 12,
      depth: 6 + random() * 8,
      height,
      baseY: top - height,
      // Square-on to the origin, then turned off it so the arc is not a fan.
      yaw: -radians + (random() - 0.5) * 0.7,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Tier gating
// ---------------------------------------------------------------------------

/**
 * Keep only the arcs whose two pylons both survive the tier's pylon count.
 *
 * At low tier the ring drops from eight posts to six, and the arc spanning the
 * 300 and 330 degree slots was still being built - so the frame showed a cable
 * hanging in empty sky with square-cut ends and no pylon at either end. An arc
 * is a thing between two posts; if either post is gone the arc is not shortened,
 * it is meaningless.
 */
export function arcsWithBothEnds<T extends { from: number; to: number }>(
  arcs: readonly T[],
  visibleDegrees: readonly number[],
): T[] {
  const present = new Set(visibleDegrees)
  return arcs.filter((arc) => present.has(arc.from) && present.has(arc.to))
}

/**
 * Assert that a batch actually produced geometry.
 *
 * Every merge in this scene is one draw call standing in for a dozen objects,
 * and the way a merge fails here is by returning an empty geometry that renders
 * a perfectly clean frame with a dozen objects missing from it. Cheap to check,
 * and it has caught this exact class of bug in this codebase before.
 */
export function assertDrawable(geometry: BufferGeometry, what: string): BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) {
    throw new Error(`hubLayout: ${what} merged to an empty geometry, so it will draw nothing`)
  }
  return geometry
}

// ---------------------------------------------------------------------------
// The walkable layout, and the two batch part lists built from it
//
// These tables and the two builders below moved here from `HubIsland.tsx` for one
// reason: the offline lightmap bake in `tools/bake/` has to build the SAME
// geometry the runtime draws, and a lightmap baked against a second copy of the
// layout is worse than no lightmap, because the shadows land somewhere plausible
// and slightly wrong.
//
// `HubIsland.tsx` cannot be imported from Node - it reaches `useQuality`, which
// reads `location.search` at module scope - so the shared code has to live in a
// module with no React, no quality tiers and no browser globals. That is what this
// file already was, and its own header says so.
//
// The colliders still read these same tables from `HubIsland.tsx`, which is the
// property that stops a player standing on thin air beside a deck. That has not
// changed; only where the numbers are declared has.
// ---------------------------------------------------------------------------

/**
 * The vertical grid everything walkable sits on, and why it is 0.40 rather than
 * 0.45.
 *
 * `BODY.autostepHeight` is 0.50, so a 0.40 riser is climbed automatically with
 * 0.10 of margin, which is 20% of the threshold. The main path from the lawn to
 * the portal is seven of these steps and contains no jump and no ramp,
 * deliberately: the most unambiguous route is the one the player walks up
 * without ever being asked to time anything. Expression lives in the optional
 * east jump route and the west toy pile.
 *
 * Descent is covered too. `BODY.snapToGroundDistance` is 0.50, so walking DOWN
 * a 0.40 step is snapped rather than becoming a fall, and the player never gets
 * a spurious airborne frame coming off the Core.
 *
 * It is also the riser the whole lightmap is aimed at. The user's brief for the
 * bake named "the steps in the platform" specifically, and a 0.40 riser against a
 * 4 m tread is the one place in this level where an occlusion term has real work
 * to do: the tread in front of a riser loses a measurable share of its sky.
 */
export const STEP = 0.4

/** The Core: three stacked pucks, walked over on the way to the portal. */
export const CORE_PUCKS = [
  { radius: 6, base: 0 },
  { radius: 4, base: STEP },
  { radius: 2.2, base: 2 * STEP },
] as const

/**
 * The four spur lobes, centred at radius 7.071 on the diagonals.
 *
 * Their inner edge sits at radius 5.571 against Puck A's 6.00, so they fuse
 * into it by 0.43 m and the whole thing reads as one four-lobed dais rather
 * than as five separate objects.
 *
 * That fusion is why the atlas packs charts PER PART rather than per connected
 * component: the union of a spur and Puck A is not convex, but each of them is,
 * and the interpenetrating texels simply bake to near zero visibility because
 * they are genuinely enclosed. Correct, and invisible.
 */
export const SPURS = [
  { id: 'NE', x: 5, z: -5 },
  { id: 'NW', x: -5, z: -5 },
  { id: 'SW', x: -5, z: 5 },
  { id: 'SE', x: 5, z: 5 },
] as const

export const SPUR_RADIUS = 1.5

/**
 * The bridge, whose south edge touches Puck C at z = -2.20 and whose north edge
 * touches T1 at z = -6.60, which is what makes both risers a clean 0.40.
 */
export const BRIDGE = { x: 0, z: -4.4, radius: 2.2, height: 4 * STEP }

/**
 * The three portal decks.
 *
 * Solid from the lawn up rather than floating slabs, which is why each
 * collider's half-height is half the FULL height and its centre is not its top.
 * T3's corners sit at radius 15.52 against a plateau of 16, the tightest fit in
 * the layout and deliberate: the portal deck is meant to feel like it is right
 * at the edge of the world.
 */
export const DECKS = [
  { id: 'T1', x: 0, z: -8.6, width: 12, depth: 4, height: 5 * STEP },
  { id: 'T2', x: 0, z: -11.5, width: 8, depth: 1.8, height: 6 * STEP },
  { id: 'T3', x: 0, z: -13.7, width: 8, depth: 2.6, height: 7 * STEP },
] as const

/**
 * The optional east jump route: lawn to T1, skipping the Core entirely.
 *
 * Every gap is under 60% of what the jump arc allows for its rise, which leaves
 * room for a mistimed takeoff. The route gets easier as it goes, which is the
 * right shape: the first step advertises that this is a jump route, and the
 * last is forgiving so a player who committed is not punished at the end.
 */
export const EAST_PUCKS = [
  { x: 9, z: -2.6, radius: 1.1, height: 2 * STEP, colliderRadius: 1 },
  { x: 9.6, z: -6.4, radius: 1.1, height: 4 * STEP, colliderRadius: 1 },
  { x: 8.4, z: -10, radius: 1.1, height: 5 * STEP, colliderRadius: 1 },
] as const

/**
 * The west toy pile, where the jump, the coyote time and the autostep get
 * tested without leaving the hub.
 *
 * The yaws are small and deliberately not multiples of each other. A stack of
 * blocks at the same angle reads as a staircase; a stack at jostled angles
 * reads as a pile someone dropped. Every level of the world, 0.40 through 2.00,
 * appears in one five-metre clump, and the gaps are all far inside budget. That
 * is correct: it is a playground, not a challenge.
 */
export const WEST_PILE = [
  { kind: 'slab', x: -9.6, z: 2.4, width: 3.2, depth: 3.2, height: 2 * STEP, yaw: 0.122, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -7.6, z: 1.2, width: 0, depth: 0, height: 3 * STEP, yaw: 0, radius: 1.3, colliderRadius: 1.2 },
  { kind: 'slab', x: -10.4, z: 0.4, width: 2.4, depth: 2.4, height: 4 * STEP, yaw: -0.192, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -11.6, z: 2.6, width: 0, depth: 0, height: 5 * STEP, yaw: 0, radius: 0.9, colliderRadius: 0.8 },
  { kind: 'slab', x: -7.8, z: 3.8, width: 2, depth: 2, height: STEP, yaw: 0.332, radius: 0, colliderRadius: 0 },
] as const

export const KERB_HEIGHT = 0.6
export const KERB_DEPTH = 0.36
/** Kerbs are inset half their depth so the outer face is flush with the deck below. */
export const KERB_INSET = KERB_DEPTH / 2

/**
 * Every exposed deck edge that is not part of the route.
 *
 * A kerb is band 2 on a band 1 deck, so a kerb draws the platform's outline as a
 * dark line, and that line is what makes a raised deck read as raised in a
 * greyscale frame where a value change across a flat top does not.
 *
 * Eleven runs, not the ten the spec's summary claims; its own table lists six
 * on T1, two on T2 and three on T3.
 */
export const KERBS = [
  // T1. Open at the bridge mouth in the south and up to T2 in the north.
  { x: -4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  { x: 4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  /*
    These two are T1's NORTH edge, at z = -10.60, and the inset has to run in +z
    to reach the deck. They read `- KERB_INSET` until this pass, which put them at
    z = -10.78: a 0.36 m kerb spanning -10.96 to -10.60, touching T1 along one
    line and hanging entirely off the deck into open air beyond it. Every other
    entry in this table insets toward the deck - `6 - INSET`, `-6 + INSET`,
    `4 - INSET`, `-4 + INSET`, `-15 + INSET` - so the sign was the only thing
    wrong and the fix is consistent with all nine of them.

    Their colliders come from this same table, so nothing was ever functionally
    broken; there was simply an invisible wall in the same wrong place as the mesh.
  */
  { x: -5, z: -10.6 + KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
  { x: 5, z: -10.6 + KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
  { x: 6 - KERB_INSET, z: -8.6, length: 4, yaw: Math.PI / 2, top: 5 * STEP },
  { x: -6 + KERB_INSET, z: -8.6, length: 4, yaw: Math.PI / 2, top: 5 * STEP },
  // T2. Open south from T1 and north to T3.
  { x: 4 - KERB_INSET, z: -11.5, length: 1.8, yaw: Math.PI / 2, top: 6 * STEP },
  { x: -4 + KERB_INSET, z: -11.5, length: 1.8, yaw: Math.PI / 2, top: 6 * STEP },
  // T3. Open south from T2 only.
  { x: 4 - KERB_INSET, z: -13.7, length: 2.6, yaw: Math.PI / 2, top: 7 * STEP },
  { x: -4 + KERB_INSET, z: -13.7, length: 2.6, yaw: Math.PI / 2, top: 7 * STEP },
  { x: 0, z: -15 + KERB_INSET, length: 8, yaw: 0, top: 7 * STEP },
] as const

/**
 * Where each hub lesson's totem stands, keyed by lesson id.
 *
 * The reading order runs anticlockwise from the spawn, so the two you meet
 * first sit on the near side of the Core and the two you meet last face the
 * portal.
 *
 * Held here rather than in `src/state/lessons.ts`, where the spec asks for it,
 * because that file is content and belongs to another stream. A totem falls
 * back to its lesson's own position if it is not listed, so adding a fifth
 * basics lesson degrades to the old behaviour rather than to a crash.
 *
 * **Insertion order is load-bearing** and was nearly lost moving this here.
 * `hubDeckParts` folds the plinths in via `Object.values`, so these four entries
 * are the last four parts of the deck batch in exactly this sequence. Re-sorting
 * the keys alphabetically, or writing them out by compass point, keeps the same
 * four plinths in the same four places and silently permutes their charts.
 */
export const TOTEM_SPURS: Record<string, [number, number, number]> = {
  'what-is-ai': [-5, STEP, 5],
  'what-is-an-llm': [5, STEP, 5],
  'popular-models': [-5, STEP, -5],
  'what-is-a-prompt': [5, STEP, -5],
}

/**
 * Every walkable piece in the level, as a part list ready for `mergeProp`.
 *
 * The ORDER of this list is load-bearing in a way it was not before the lightmap.
 * `packLightmapAtlas` attributes triangles back to parts by their position in the
 * merge, so inserting a puck in the middle of this function moves every later
 * part's charts and invalidates the bake. The manifest hash is what makes that
 * loud instead of silent: it is computed from this list's geometry, so a reordered
 * or resized layout fails the check at load rather than rendering someone else's
 * shadows.
 *
 * `plinth` is a parameter rather than an import because `totemPlinth` lives in
 * `LessonTotem.tsx` and this module is deliberately free of React. Both callers -
 * the component and the bake - pass the same `totemPlinth()` result.
 */
export function hubDeckParts(plinth: BufferGeometry): PropPart[] {
  const parts: PropPart[] = []

  /*
    The three Core pucks, and the TOP one is a basin rather than a puck.

    Puck C carries the junction pool, so its top face is milled rather than flat.
    It stays in this exact slot in the list - part index 2 - because
    `packLightmapAtlas` attributes triangles back to parts by their position in the
    merge, so moving it would silently permute every later part's charts. The part
    count is unchanged, so the atlas still holds 34 parts and 204 charts; only the
    triangle counts inside Puck C's six charts move, which is what the manifest
    hash catches and the reason this change needs a re-bake. See `basinLathe`.
  */
  CORE_PUCKS.forEach(({ radius, base }, i) => {
    const isCore = i === CORE_PUCKS.length - 1
    parts.push({ geometry: isCore ? basinLathe() : puck(radius, STEP), position: [0, base, 0] })
  })
  for (const spur of SPURS) {
    parts.push({ geometry: puck(SPUR_RADIUS, STEP), position: [spur.x, 0, spur.z] })
  }
  parts.push({ geometry: puck(BRIDGE.radius, BRIDGE.height), position: [BRIDGE.x, 0, BRIDGE.z] })

  for (const deck of DECKS) {
    parts.push({ geometry: slab(deck.width, deck.height, deck.depth), position: [deck.x, 0, deck.z] })
  }
  for (const east of EAST_PUCKS) {
    parts.push({ geometry: puck(east.radius, east.height), position: [east.x, 0, east.z] })
  }
  for (const piece of WEST_PILE) {
    parts.push(
      piece.kind === 'slab'
        ? {
            geometry: slab(piece.width, piece.height, piece.depth),
            position: [piece.x, 0, piece.z],
            rotation: [0, piece.yaw, 0],
          }
        : { geometry: puck(piece.radius, piece.height), position: [piece.x, 0, piece.z] },
    )
  }

  // The totem plinths, folded in from LessonTotem rather than drawn there.
  for (const position of Object.values(TOTEM_SPURS)) parts.push({ geometry: plinth, position })

  return parts
}

/** Every kerb, as a part list ready for `mergeProp`. */
export function hubTrimParts(): PropPart[] {
  return KERBS.map((run) => ({
    geometry: kerb(run.length, KERB_HEIGHT, KERB_DEPTH),
    position: [run.x, run.top, run.z] as [number, number, number],
    rotation: [0, run.yaw, 0] as [number, number, number],
  }))
}

/**
 * The atlas geometry, read by both the bake and the runtime.
 *
 * It lives in this file rather than in `src/art/lightmap.ts` because the bake tool
 * needs it and `lightmap.ts` statically imports the baked PNG, so a bake that read
 * it from there could not run until its own output already existed.
 *
 * **Resolution, argued from measured area rather than chosen.** The two walkable
 * batches are 19,848 and 4,356 triangles carrying **1071.4 m2 of surface** across
 * **204 charts**. That figure is much larger than a look at the level suggests,
 * because it counts both sides of everything: deck undersides sitting on the lawn,
 * and the faces where the four spur lobes fuse 0.43 m into Puck A. Those texels bake
 * to near zero visibility, correctly, and are never seen. Culling them was
 * considered and rejected - "is this face visible" is not answerable before the
 * trace, and a heuristic that guessed wrong would remove occlusion from something
 * on screen.
 *
 * At 2048 and 44 texels per metre the atlas is 60.8% occupied, which is **2.27 cm
 * per texel**. The number that sizes it is not the deck, it is the 0.12 m bevel on
 * every edge in the kit: at 44 texels/m that bevel is 5.3 texels across, and the
 * bevel is where the sharpest real gradient in the whole bake sits.
 *
 * 1024 at 24 texels/m also fits, at 77.6% occupancy and 4.17 cm/texel, and is a
 * one-line downgrade if the memory is ever wanted back. It was baked and read back
 * and it is not obviously worse anywhere except on the bevels, where the band
 * narrows to 2.9 texels - which is also what made a rasteriser bug visible, so the
 * finer grid is buying real headroom rather than just numbers.
 *
 * 4096 was priced and rejected: 68 texels/m only reaches 35.1% occupancy because the
 * shelf packer cannot fill it, so it is four times the memory for 1.5x the texel
 * density. **And the brief's framing of the cost needs correcting in both
 * directions.** This is a single-channel image, so 4096 would be 16 MB of source
 * data rather than the 64 MB quoted - but three uploads an `Image` as RGBA whatever
 * the PNG contains, so VRAM is 4 bytes a texel regardless: 4 MB at 1024, **16 MB at
 * 2048**, 64 MB at 4096, and a third again on top if mipmaps were on. They are not;
 * see `configureLightmap`.
 */
export const HUB_LIGHTMAP_ATLAS: Required<LightmapAtlasOptions> = {
  size: 2048,
  texelsPerMetre: 44,
  gutter: 2,
}
