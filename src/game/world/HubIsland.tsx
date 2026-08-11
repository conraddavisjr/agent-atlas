import { useEffect, useMemo, useRef } from 'react'
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  Color,
  TorusGeometry,
  type BufferGeometry,
  type Group,
} from 'three'
import { band, palette } from '@/art/palette'
import { GLOW, emissive, mattePlastic, plastic } from '@/art/materials'
import {
  applyLightmapUV,
  boxProjectUV,
  mergeProp,
  nodeCore,
  paintByFacing,
  pill,
  puck,
  shard,
  slab,
  packLightmapAtlas,
  propPartVertexCounts,
  tubeFromCurve,
  type LightmapMesh,
  type PropPart,
} from '@/art/geometry'
import { DECAL_KINDS, createDecalMaps, createPanelFillMap, panelFillSize } from '@/art/decalTextures'
import {
  HUB_LIGHTMAP_INTENSITY,
  assertLightmapBound,
  lightmapStaleness,
  useHubLightmap,
} from '@/art/lightmap'
import { mulberry32, type Exclusion } from '@/art/placement'
import { useQuality } from '@/art/useQuality'
import { Grass } from '@/art/Grass'
import { WaterTrace } from '@/art/WaterTrace'
import { PoolSplash } from '@/art/PoolSplash'
import { BODY } from '@/game/player/tuning'
import { glassShard } from '@/art/glassShard'
import { Flowers } from '@/art/Flowers'
import { BOULDER, Scatter, boulderPlacements } from '@/art/Scatter'
import {
  CONTACT_STRENGTH,
  contactDecalGeometry,
  createContactDecalMaterial,
  type Contact,
} from '@/art/contactDecal'
import { CONTACT_TINT } from '@/art/contactTint'
import { useGame } from '../GameContext'
import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS, ZONES } from '@/state/lessons'
import { isSceneAccessible, isLessonComplete } from '@/state/progression'
import { PORTAL_JAMB, Portal } from './Portal'
import { LessonTotems, TOTEM, totemPlinth, type TotemPlacement } from './LessonTotem'
import { Terrain, PLATEAU_RADIUS } from './Terrain'
import {
  BRIDGE,
  CORE_PUCKS,
  DECKS,
  EAST_PUCKS,
  HUB_LIGHTMAP_ATLAS,
  KERBS,
  KERB_DEPTH,
  KERB_HEIGHT,
  POOL,
  SPURS,
  SPUR_RADIUS,
  STEP,
  TOTEM_SPURS,
  TRACE,
  WEST_PILE,
  arcsWithBothEnds,
  assertDrawable,
  hubDeckParts,
  hubTrimParts,
  monolithArc,
  orthoTrace,
  pathLength,
  poolFloorRadius,
  poolRingColliders,
  spurTraceCorners,
  sweepChannel,
  traceSegments,
  trunkTraceCorners,
  waterDisc,
} from './hubLayout'

/**
 * The hub island: a single oversized compute die, with the course running on it.
 *
 * The lawn is the substrate. At the centre stands **the Core**, a three-step
 * circular dais with four spurs, carrying a neural node that hangs in the air
 * above it. Each spur carries one lesson totem, and a glowing trace runs from
 * each totem inward and up the steps, which is the visual statement that four
 * inputs feed one node. From the Core a single heavier trace runs north along a
 * stepped stack of decks to the portal. Follow the thick wire and you reach the
 * gate.
 *
 * The composition is a ziggurat in a bowl: the centre is the highest ground you
 * can stand on outside the portal stack, the perimeter is a ring of tall dark
 * pylons that frames the play space and fills the horizon, and beyond that the
 * island falls away into sky.
 *
 * **What this replaced, and why none of it was salvageable.** The old hub had
 * its focal point in a corner, an empty centre, and a horizon with nothing on
 * it. Its stonework was `#d5d9e0` at luma 0.850 standing on a ground texture at
 * about 0.83, so a desaturated frame could not tell the raised deck from the
 * lawn - the exact failure the greyscale readability test exists to catch, and
 * it was failing on the most important pair of surfaces in the game. Its
 * circuit traces were flat planes lying on the floor, which contribute no
 * silhouette, catch no light, and disappear entirely at the grazing angle the
 * ground is seen at almost all the time. And its pucks and plinths were
 * `cylinderGeometry`, whose caps meet their sides at 90 degrees.
 *
 * **Colliders are authored by hand, and never a trimesh.** Every rise in this
 * scene comes from a placed piece with its own primitive collider, because
 * Rapier will not follow a displaced mesh and because a trimesh over decorative
 * bevels turns every fillet into something the capsule can catch on. Each
 * collider sits 0.10 m inside its visual radius for the same reason: the
 * capsule stops on a clean vertical cylinder and never touches the rim.
 *
 * See `docs/design/03-environment.md`, whose coordinate tables this file
 * implements, and `docs/design/00-art-bible.md` section 8 for the value bands.
 */

// ---------------------------------------------------------------------------
// Value bands
// ---------------------------------------------------------------------------

/**
 * The three bands from the art bible, as albedo.
 *
 * The requirement is a rendered luma of 0.56 to 0.74 for anything the player
 * can stand on and 0.20 to 0.38 for midground dressing, with a real gap between
 * them. That gap is what makes a desaturated frame legible, and it is why the
 * deck is no longer near-white: at 0.850 it sat 0.10 from the robot's shell at
 * 0.946, so the character had to survive on hue alone against the surface it
 * stands on.
 *
 * The top value comes from `palette.rock`, which the palette stream has already
 * moved into band 1. The other three have no palette entry yet and are literals
 * here. They belong there behind the spec's `band(hex, tier)` helper, so that a
 * later palette change propagates instead of being re-typed - and so that the
 * side value in particular cannot drift away from the top value it is defined
 * relative to.
 *
 * They are palette entries now, and each one states the band it claims through
 * `band()`, which throws in development if the claim is false.
 *
 * **And that helper turned out to be checking the wrong thing, which is what
 * the section below is about.** The assertion travelling with the call site is
 * still right; asserting it on a hex is not, because a hex says nothing about
 * what a surface facing away from the key will render.
 */

/**
 * Band 2 needs TWO values, and which one a surface gets depends on which way it
 * faces. This is the correction the critique's headline verdict is about.
 *
 * **`band()` asserts on a hex. The bible's test is a statement about the frame.
 * The gap between those two measurements is where the value structure went.**
 *
 * `palette.bandFrame` at `#3c465a` has a display luma of 0.272 and passes the
 * midground assertion cleanly. Measured on the establishing shot, the pylons
 * built from it render **0.085 on their shaded side and 0.182 on their lit
 * side, a mean near 0.14** - outside all three bands entirely, and a delta of
 * 0.78 against a 0.867 sky. That is the highest local contrast anywhere in the
 * picture, higher than the core ring at 0.17 or the portal arch at 0.15, so
 * eight evenly spaced near-black posts were the first thing the eye found and
 * the last thing it left.
 *
 * The cause is facing, and it is measurable. The key is steeply overhead, so
 * from the same frame: an up-facing deck renders at 0.81 of its albedo's LINEAR
 * luminance, a lit vertical face at 0.54, and a shaded vertical face at 0.11.
 * A single albedo cannot put both a post and its cap in one band, because the
 * two differ by a factor of five in what they receive.
 *
 * So the dress batch is vertex painted by facing, exactly as the deck batch is,
 * but with the ramp running the other way: dark on top, light on the sides.
 *
 * - `frameTop`, `#3c465a`, luma 0.272 - the existing palette value, which is
 *   correct for an up-facing surface and renders about 0.24.
 * - `frameSide`, `#6e7e9e`, luma 0.490 - a value no swatch would call band 2,
 *   which is the point. Same hue (220 degrees) and same HSL saturation as the
 *   value above, so only the lightness moves. Predicted render from the
 *   measured ratios: shaded side 0.16, lit side 0.37, shaft mean **0.27**, with
 *   the delta against sky falling from 0.78 to 0.59.
 *
 * `frameSide` is a local constant only because `palette.ts` belongs to another
 * hand this pass; it wants to be `palette.bandFrameSide`, and it must not carry
 * a `band()` assertion when it gets there.
 */
const FRAME_SIDE = '#6e7e9e'

const BAND = {
  /** Band 1. Deck and puck tops. Luma 0.735. */
  deckTop: band(palette.bandDeckTop, 'gameplay'),
  /** Band 1. Deck and puck side faces. Luma 0.589. */
  deckSide: band(palette.bandDeckSide, 'gameplay'),
  /** Band 2. Kerbs and trim. Luma 0.330. */
  trim: band(palette.bandTrim, 'midground'),
  /** Band 2, up-facing: pylon caps, the Core collar, the crown of every tube. */
  frameTop: band(palette.bandFrame, 'midground'),
  /** Band 2 as MEASURED, vertical: pylon shafts, struts, the flanks of an arc. */
  frameSide: FRAME_SIDE,
} as const

/**
 * The pale core inside a violet node.
 *
 * `palette.node` at `#7c6bff` has a linear luminance of 0.220, so normalising
 * it to the bloom threshold would need an `emissiveIntensity` near 8 and would
 * render as flat white with a violet fringe - the colour gone, which is the
 * opposite of what a coloured light is for. `emissive()` refuses it outright.
 * The art bible's mandatory alternative is a pale core sized to read at
 * distance inside a dimmer saturated shell that does not itself bloom, which is
 * how the reference builds its LEDs. This lilac has a linear luminance of 0.569
 * and normalises cleanly.
 */
const NODE_CORE = '#c9bfff'

// ---------------------------------------------------------------------------
// The layout
//
// Every number below comes from the coordinate tables in section 1 and the
// collider manifest in section 2.3 of the environment spec. They are kept
// together, at the top, and read by both the geometry and the colliders, so the
// two cannot drift apart - which is the failure that leaves a player standing
// on thin air beside a deck.
// ---------------------------------------------------------------------------

/**
 * The perimeter pylon ring, which is the near frame.
 *
 * Its job is horizon rather than decoration, and it is also the mitigation for
 * the one accepted overlap in the value bands: the character at 0.86 to 0.95
 * against a fogged background at 0.82 to 0.88. The ring sits between the play
 * space and the background across the whole northern and lateral horizon, so
 * the character silhouettes against a dark object rather than against sky.
 *
 * The 60, 90 and 120-degree slots are omitted, opening a 90-degree window in
 * the south facing the spawn so the establishing shot has an unobstructed view
 * down the island - and that is the direction the follow camera looks OVER
 * rather than at. The 270 slot is omitted because it would stand inside T3,
 * which does double duty by giving the portal an uninterrupted sightline out of
 * the world.
 *
 * The heights are not monotonic and not symmetric. A ring of equal posts is a
 * fence; a ring of varied posts is a skyline. But they are all the same object,
 * which is what preserves the depth ruler: repeating identical shapes at
 * identical sizes in a row only communicates depth if they really are identical.
 */
const PYLON_RADIUS = 14.6
const PYLONS = [
  { degrees: 0, height: 7.8 },
  { degrees: 30, height: 5.6 },
  { degrees: 150, height: 6.4 },
  { degrees: 180, height: 7.2 },
  { degrees: 210, height: 5.2 },
  { degrees: 240, height: 6.8 },
  { degrees: 300, height: 7.6 },
  { degrees: 330, height: 6 },
] as const

/**
 * The overhead arcs, spanning between pylon caps.
 *
 * These are the strongest framing element in the scene. Dark curves across the
 * top of frame at its edges are what turn the view from "an island" into "a
 * diorama in a box", and they read as the network the nodes belong to.
 *
 * They stay dark deliberately. An emissive arc across the top of frame would
 * compete with the Core node for the eye, and the Core node has to win.
 */
const ARCS = [
  { from: 30, to: 0, apex: 8.2 },
  { from: 210, to: 240, apex: 8.6 },
  { from: 300, to: 330, apex: 8.4 },
] as const

/**
 * Token crystal groves.
 *
 * A grove, never a specimen: the lone six-sided cone with a smaller cone
 * leaning on it that this replaces did not read as a plant, it read as a cone.
 * Shards splaying outward from a common root read as something that grew, where
 * the same shards standing vertical read as a fence.
 *
 * The shards used to be emissive and to sit outside the value band system on
 * purpose, as the reward palette. They no longer are: they are pale glass, they
 * carry no glow at all, and they sit UNDER the lawn they stand on. See
 * `glassShard.ts` for why the reward reading was never real - a shard has no
 * collider and no interaction, and `Colliders()` names them first in its list
 * of things that deliberately get none - and for the pale-core geometry the art
 * bible specifies if a reward cue is ever wanted here.
 *
 * The area rule still holds and still matters: total shard silhouette stays
 * under 2% of the frame from the spawn view.
 */
const GROVES = [
  { x: -3.2, z: 9.4, shards: 7, radius: 1.4 },
  { x: 3.6, z: 10.2, shards: 5, radius: 1.1 },
  { x: -11.2, z: -3.4, shards: 9, radius: 1.8 },
  { x: 11.8, z: 4.6, shards: 6, radius: 1.3 },
  { x: -6.4, z: -11.6, shards: 6, radius: 1.3 },
  { x: 12.6, z: -6, shards: 5, radius: 1.1 },
] as const

/**
 * The traces, rebuilt as printed circuitry rather than as cable.
 *
 * **What they were.** A Catmull-Rom through diagonal waypoints, swept at radius
 * 0.14 with its centreline 0.12 clear of the deck, given `emissive()`'s default
 * clearcoat of 1.0 at roughness 0.10. In frame that is a 0.28 m glossy tube
 * standing 0.26 m proud of the surface, wandering, carrying a single specular
 * streak down its whole length, with nothing beneath it and a square cut at
 * each end. It read as a rubber hose someone had left on the floor.
 *
 * **What the brief actually asks for.** The reference names PCB traces as this
 * world's digital DNA, and names the three properties that make one: straight
 * runs, right-angle turns, via pads. Not one of the three was present.
 *
 * So the routes below are corner lists, not curves. `orthoTrace` mitres every
 * right angle at 45 degrees and resamples the result densely enough that the
 * spline through it is the polyline - see `hubLayout.ts`, where the arithmetic
 * and its tests live. The turns are right angles in the vertical plane too, so
 * the route reads as one straight line stepping up four times rather than as
 * something draped over four steps.
 *
 * The tubes are also half-buried. A centreline 0.04 above the surface with a
 * radius of 0.075 puts the crown 0.115 up - inside the environment spec's
 * absolute rule that a trace is at or below 0.12 above the surface beneath it
 * or at or above 3.00, never between - and puts the underside 0.035 inside the
 * deck. Buried is what removes the missing contact shadow: there is no gap left
 * to light through.
 *
 * And both ends of every run terminate inside something. The spurs disappear
 * under their totem plinths at the outer end and into the junction pad at the
 * inner one; the trunk leaves the same junction pad and dies inside the
 * threshold pad in front of the arch. There is no cut tube anywhere in the
 * scene now.
 */
const SPUR_TRACE = orthoTrace(spurTraceCorners())
const TRUNK_TRACE = orthoTrace(trunkTraceCorners())

/**
 * The far monolith arc's two ends of a value ramp, and why they are not in the
 * palette.
 *
 * Band 3 is 0.76 to 0.86 as measured, and these are the numbers that get there
 * through the tone curve and the fog rather than the numbers that read as 0.76
 * to 0.86 on a swatch. `#9db6cf` is 0.700 and `#bccfe0` is 0.801 as albedo; the
 * near slabs come out around 0.75 and the far ones around 0.85 once fog has
 * lifted them toward the horizon colour, which is the aerial perspective the
 * frame had none of.
 *
 * They stay here rather than in `palette.ts` until they have been measured on a
 * capture, because the exact pair depends on the grade and the fog range, and a
 * palette entry that has to be re-tuned twice is worse than a local constant
 * that gets promoted once.
 */
const BACKDROP_NEAR = '#9db6cf'
const BACKDROP_FAR = '#bccfe0'

/**
 * Thirteen slabs, at every tier.
 *
 * Not gated, on the same principle as the kerbs: this is the frame's depth
 * structure rather than polish, and a lower tier is meant to be a less
 * decorated version of the same world rather than a different one. It is also
 * genuinely free - one unlit merged draw with no shadow pass, which is cheaper
 * than any single pylon.
 */
const BACKDROP_SLABS = 13

/**
 * Where the portal stands, as a constant rather than as a literal in the JSX.
 *
 * The arch is 0.70 deep, so it occupies z from -14.15 to -14.85 and sits fully on
 * T3, which ends at -15.0. It is a constant now because the contact batch needs
 * the same three numbers the `<Portal>` element does, and a jamb's contact landing
 * 0.4 m from its jamb is not a bug anyone would spot in a screenshot.
 */
const PORTAL_AT: [number, number, number] = [0, 7 * STEP, -14.5]

/**
 * Contact patches for every static object base in the scene, as one list.
 *
 * ## Why this exists at all
 *
 * Ambient occlusion came out at all three tiers with the shadow-end decision, and
 * the junctions where it was earning its cost were flat-on-flat stone: a plinth on
 * a spur lobe, the portal's jambs on T3, a riser meeting the tread below it. At a
 * flat-on-flat corner visibility approaches 0.5, so the pass was putting a real
 * 0.28 m band there and taking a 0.65 deck down to about 0.47. **That band is what
 * this list replaces**, and the strengths in `CONTACT_STRENGTH` are solved
 * backwards from it rather than chosen.
 *
 * Derived from the layout tables above rather than written out by hand, for the
 * same reason `hubExclusions` is: a contact list that drifts from the objects it
 * sits under still renders, and still looks like it is working.
 *
 * ## What is deliberately NOT in it, and why
 *
 * **The Core's four struts.** They stand at `baseRadius` 2.10 on Puck C, whose
 * radius is 2.20 and which drafts inward by three degrees, so a 0.22 m pill at
 * 2.10 already overhangs the puck it stands on. There is no receiving surface
 * under the outboard half of each foot, and any patch centred on the foot puts
 * full-strength multiply on ground that is 0.40 m lower - a dark disc floating
 * over Puck B. The strut placement wants fixing before it can be contacted; that
 * is a layout change and this round is not it.
 *
 * **The dais and deck footprints on the lawn.** Puck A at radius 6.00, T1 at
 * 12 x 4, the bridge, the east pucks and the west pile all meet the lawn and all
 * want this treatment. They are left out because their patches would overlap each
 * other - Puck A's band at 6.0 to 6.8 runs straight through the four spur lobes'
 * - and multiply STACKS, so the crevices between them would go roughly 0.20 below
 * the lawn where a single patch gives 0.14. That is probably correct and it is
 * certainly not verifiable from arithmetic, so it wants one measured pass of its
 * own rather than being smuggled in with the rest.
 *
 * **The eleven kerb feet.** Same mechanism as the risers below and the same value,
 * but the table above does not record which side of each run is the deck and which
 * is open air, so all eleven outward normals would have to be inferred by hand.
 * The two risers prove the mechanism on cases that can be checked; the kerbs are
 * the next increment.
 *
 * **Pebbles and clover.** A pebble is 0.03 to 0.09 m across. Its contact would be
 * one or two pixels at every framing in the set, which is the definition of a
 * setting that renders and changes nothing.
 */
function hubContacts(
  pylons: readonly { degrees: number; height: number }[],
  groves: number,
  boulders: readonly { x: number; z: number; scale: number }[],
): Contact[] {
  const out: Contact[] = []

  /*
    The pylons, on the lawn.

    **The acceptance shot for these is `hub-establishing`, NOT `hub-backlit`, and
    that is a correction to the brief rather than a preference.** At `hub-backlit`
    the camera is 1.49 m up and 8.89 m out, a 9.5-degree depression, where 0.30 m
    of blade hides 1.79 m of the ground behind it - so the 0.75 m planting
    exclusion at each pylon foot and everything drawn on it is behind the lawn from
    that vantage and from any other camera at playing height. At
    `hub-establishing` the same foot is seen at 30.6 degrees, where 0.30 m of blade
    hides 0.51 m, and most of the bald ring reads.

    The band is 0.81 m, which is 27 px at `hub-establishing` after the ground's
    foreshortening, against an acceptance floor of 6.

    It reaches past the 0.75 m exclusion on purpose. The exclusion's boundary is
    itself a defect - bare ground texture renders BRIGHTER than the grass it
    interrupts, which is the "bright bald ground under the props" half of F4 - so a
    gradient that crosses the boundary darkens the bald ring and hides the edge of
    it in the same pass.
  */
  for (const pylon of pylons) {
    const [x, z] = pylonPosition(pylon.degrees)
    out.push({ x, z, y: 0, footX: 0.34, band: 0.81, strength: CONTACT_STRENGTH.lawn })
  }

  /*
    The totem plinths, on their spur lobes. This is the primary acceptance case.

    `puck(0.70, 0.58, 0.06)` standing at y = 0.40 on `puck(1.50, 0.40)` is
    flat-on-flat with a 0.05 fillet, which is the corner the occlusion pass was
    doing its best work at, and `hub-totem` frames it at 21.4 degrees of depression
    over a deck with no grass on it. Nothing occludes the result.

    It is also the case the shadow map provably cannot serve. `hub-totem`'s camera
    forward dots to 0.924 with the key's shadow direction, so the plinth's own cast
    shadow is directly behind it from that vantage at any frustum or resolution.

    **The band is 0.80 m rather than the 0.45 it was first authored at, and the
    reason is worth recording because it is a mistake this file could make again.**
    The falloff is `pow(1 - t, 1.7)` in the band's own normalised width, so a
    narrow band does not make a tighter contact, it makes a contact that has
    already decayed by the time it clears the object. At 0.45 m the alpha 0.30 m out
    from the plinth's rim was 0.080, which is a 2% darkening and no read at all. At
    0.80 m the same point is 0.234 and the point 0.10 m out is 0.414, which is 0.13
    of drop on a 0.66 deck. **Band width is what sets contact strength at
    distance**, not the peak.

    0.80 puts the rim exactly at the 1.50 m lobe edge, where the alpha is zero, so
    the patch cannot spill off the lobe with anything in it. The quad's corners
    reach 2.12 m but lie outside the unit circle and clamp to a literal no-op.
    Where it runs past the lobe's INNER edge it lands on Puck A, which is the same
    height, because the lobes fuse into it by 0.43 m.
  */
  for (const position of Object.values(TOTEM_SPURS)) {
    out.push({
      x: position[0],
      z: position[2],
      y: position[1],
      footX: TOTEM.radius,
      band: 0.8,
      strength: CONTACT_STRENGTH.deck,
    })
  }

  /*
    The portal's two jambs, on T3.

    A `rect`, because the foot is 0.50 across and 0.70 deep and a radial falloff
    round it would put three times the band on the deep sides that it puts on the
    narrow ones. The band is 0.30 m all round, uniform by construction.

    The rotation term is omitted rather than forgotten: the hub's portal is placed
    at yaw 0, and a `rect` patch carries a `yaw` field for the day it is not.
  */
  for (const side of [-1, 1]) {
    out.push({
      x: PORTAL_AT[0] + side * PORTAL_JAMB.spacing,
      z: PORTAL_AT[2],
      y: PORTAL_AT[1],
      footX: PORTAL_JAMB.halfX,
      footZ: PORTAL_JAMB.halfZ,
      band: 0.3,
      shape: 'rect',
      strength: CONTACT_STRENGTH.deck,
    })
  }

  /*
    The two risers in the portal stack, as edge bands rather than as footprints.

    This is the one place the removal of ambient occlusion takes something away
    that was doing visible work: F9 records "a thin AO line" at the tread-to-riser
    junction as one of only two things separating the steps. The line goes with the
    pass, so it is authored here.

    A long thin foot along the run with a 0.30 m band across it puts the peak
    exactly at the riser and fades it out over the last 0.30 m of each end of the
    run, which is what an occlusion pass produced at a corner that stops. The half
    of each quad on the far side of the riser plane is inside the deck above and is
    discarded by the depth test.

    Derived from `DECKS` so the plane, the width and the receiving height cannot
    drift: consecutive decks abut, so the riser is at the upper deck's south face
    and the tread below it is the lower deck's top.

    One known imperfection, on the record because it is a 250% check rather than
    something arithmetic can settle: T1 and T2 are `slab`s with a 0.12 m chamfer,
    so for the 0.12 m of tread nearest each riser the real surface curves below the
    flat top the quad sits on, and the band's leading edge floats over that chamfer
    by up to 0.13 m. At `hub-portal` that strip is about 7 px wide and sits in a
    V-groove that already reads as a dark line.
  */
  for (let i = 1; i < DECKS.length; i++) {
    const upper = DECKS[i]
    const lower = DECKS[i - 1]
    out.push({
      x: upper.x,
      z: upper.z + upper.depth / 2,
      y: lower.height,
      footX: upper.width / 2 - 0.3,
      footZ: 0.02,
      band: 0.3,
      shape: 'rect',
      strength: CONTACT_STRENGTH.deck,
    })
  }

  /*
    The crystal groves.

    **This is the family that has failed before**, and the note at the root pad
    above records how: a 0.60 m disc of band-2 albedo lying on grass read as a hole
    burnt in the lawn. What makes this different is in `contactDecal.ts` - it
    multiplies rather than replaces, and its falloff reaches exactly zero at the
    rim rather than stopping at a radius.

    It is included rather than skipped because the defect it fixes is measured.
    `hub-grazing` shows a flat, smooth, blade-free patch of bright ground under the
    right-hand cluster with a hard boundary where the grass starts, and F4 measured
    it at 0.650 against 0.512 two hundred pixels away. That is not the shards'
    emissive - a pylon's exclusion ring does the same thing with no emissive within
    ten metres - it is `hubExclusions` clearing `grove.radius * 0.55` of planting
    and bare ground texture rendering brighter than the grass it replaces. A
    gradient centred on the grove is the treatment for it.

    The foot is the exclusion radius, so the patch is at full strength exactly
    across the bald ring and fades through the grass beyond it.
  */
  for (const grove of GROVES.slice(0, groves)) {
    out.push({
      x: grove.x,
      z: grove.z,
      y: 0,
      footX: grove.radius * 0.55,
      band: 0.7,
      strength: CONTACT_STRENGTH.scatter,
    })
  }

  /*
    The boulders, from `Scatter`'s own placement function so the two cannot
    disagree.

    A boulder is an ellipsoid squashed to 0.68 vertically and sunk to half its own
    height, so the cross-section it presents at the lawn is `baseScale * scale`
    times sqrt(1 - (sink / squash)^2), which is 0.678 of its widest radius.

    Only boulders at scale 0.6 and above get one. Below that the foot is under
    0.13 m and the band would be a handful of pixels at every framing in the set,
    which is cost with no read.
  */
  for (const boulder of boulders) {
    if (boulder.scale < 0.6) continue
    const widest = BOULDER.baseScale * boulder.scale
    const foot = widest * Math.sqrt(1 - (BOULDER.sink / BOULDER.squash) ** 2)
    out.push({
      x: boulder.x,
      z: boulder.z,
      y: 0,
      footX: foot,
      band: 0.3 * boulder.scale + 0.1,
      strength: CONTACT_STRENGTH.scatter,
    })
  }

  return out
}

/**
 * The junction pool's water surface, and the boundary the splash trigger watches.
 *
 * Module constants rather than object literals in the JSX, because a literal is a new
 * object on every render and would re-render `PoolSplash` for nothing - which this
 * file does on every progress change and on every `setActiveTotem`, so several times
 * per walk past a totem.
 *
 * `standingY` converts the pool's floor into the collider-CENTRE height the player's
 * transform actually carries, which is the one place `BODY` is needed here: the sole
 * sits `capsuleHalfHeight + capsuleRadius` below the centre and `colliderOffset`
 * floats it a further 0.02 clear of whatever it rests on. HALF the depth is
 * subtracted, so the threshold lands midway between standing on the deck and standing
 * on the floor - 0.025 m from each - and neither state can chatter across it. The
 * conversion lives here rather than in `src/art/splash.ts` so that nothing in
 * `src/art` has to import from `src/game/player`.
 */
const POOL_SURFACE: [number, number, number] = [0, 3 * STEP, 0]
const POOL_BOUNDS = {
  centreX: 0,
  centreZ: 0,
  radius: POOL.radius,
  standingY:
    3 * STEP - POOL.depth / 2 + BODY.capsuleHalfHeight + BODY.capsuleRadius + BODY.colliderOffset,
}

function pylonPosition(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [PYLON_RADIUS * Math.cos(radians), PYLON_RADIUS * Math.sin(radians)]
}

// ---------------------------------------------------------------------------

export function HubIsland() {
  const { player, travel } = useGame()
  const progress = useProgress()
  const setActiveTotem = useGameStore((s) => s.setActiveTotem)
  const quality = useQuality()

  const hubLessons = LESSONS.filter((l) => l.zoneId === 'basics')
  const caveOpen = isSceneAccessible('cave', ZONES, LESSONS, progress)
  const completedCount = hubLessons.filter((l) => isLessonComplete(l, progress)).length

  /*
    Tier gating, now read from the table rather than derived from the tier name
    here. A setting that lives at its call site is one no other scene can read
    and no test can assert on, which is exactly the retrofit `quality.ts` exists
    to prevent.

    Never gated, at any tier: the kit modules, the kerbs, the colliders and the
    trunk trace. Those are the level and its readability rather than polish. A
    lower tier should be a less decorated version of the same world, never a
    different one.
  */
  const gates = useMemo(
    () => ({
      groves: quality.crystalGroves,
      traceSegments: quality.traceSegments,
      nodeShells: quality.nodeShells,
      pylons: quality.pylonCount,
      pylonDetail: quality.pylonDetail,
    }),
    [
      quality.crystalGroves,
      quality.traceSegments,
      quality.nodeShells,
      quality.pylonCount,
      quality.pylonDetail,
    ],
  )

  /**
   * The pylons this tier draws, resolved once.
   *
   * Four things key off it - the masts, the caps, the marker nodes and the
   * overhead arcs - and the low-tier defects the critique found were both a
   * disagreement between two of them. Deriving all four from one list is what
   * makes that class of bug impossible rather than merely fixed.
   */
  const visiblePylons = useMemo(() => PYLONS.slice(0, gates.pylons), [gates.pylons])

  /*
    Generated surface detail. **On now**, at 512 on medium and 1024 on high,
    which is the ladder that was specified from the start.

    It sat at zero on all three tiers for two rounds behind a note in
    `quality.ts` reading "zero everywhere until `surfaceTexture.ts` exists" -
    while the module it was waiting for had already shipped under a different
    name, as `decalTextures.ts`, with thirty tests and four tuned kinds. So the
    largest continuous surface in the game was box-projected with world-scale
    UVs, handed a material with three map slots, and given null in all of them,
    and the deck looked like blank plastic because it was.

    It can be applied to a merged batch at all only because the batches are box
    projected. A merge holds a 12 m deck, a 6 m puck and a 0.7 m plinth, each
    with its own UV convention, so a tiled material across the raw merge would
    put the same stone at three different sizes on three pieces of one
    structure - which is the wallpaper failure this file has documented since
    its first pass, arrived at from the other direction.
  */
  const deckMaps = useMemo(
    () => (quality.surfaceMapSize ? createDecalMaps('deck', quality.surfaceMapSize) : null),
    [quality.surfaceMapSize],
  )
  const trimMaps = useMemo(
    () => (quality.surfaceMapSize ? createDecalMaps('trim', quality.surfaceMapSize) : null),
    [quality.surfaceMapSize],
  )
  /*
    The frame members get their own kind, and it is the same 1.6 m tile as `trim`.

    Deliberately the same tile, so the dress batch's existing box projection at
    `DECAL_KINDS.trim.metresPerTile` is reused with its UVs untouched - this costs
    no repack and no geometry change. What differs is everything sized against the
    screen rather than against the tile: a 70 mm groove instead of 2.5 mm, no
    fasteners, and a roughness target of 0.30 to match `anodised()`.

    MEASURED: the near Core strut is 20 px wide at the establishing framing, or
    21.6 mm of surface per screen pixel, and four cross-sections of it 40 px apart
    are the same curve to within 0.01 of luma. The `trim` maps bound here were
    real and entirely sub-pixel - a 2.5 mm groove is 0.12 px. See
    `DECAL_KINDS.strut`.
  */
  const strutMaps = useMemo(
    () => (quality.surfaceMapSize ? createDecalMaps('strut', quality.surfaceMapSize) : null),
    [quality.surfaceMapSize],
  )

  /**
   * The deck's PRINTED value, which is a second texture at a second scale and is
   * the change the null result above asks for.
   *
   * The maps switched on in `deckMaps` measure a p5-p95 of 0.039 against 0.0387
   * with them off: relief does nothing on an up-facing surface under a key 42.7
   * degrees overhead, because perturbing a normal that already points at the
   * light barely moves `N.L`. Printed value has no such dependence - an albedo
   * multiplier is a multiply, and it lands whatever the geometry is doing - so
   * this is the one channel that can put structure on a floor here.
   *
   * It is a separate texture from `deckMaps` because it is a separate SCALE, and
   * that is the whole reason it exists as its own function. `deckMaps` tiles
   * every 2 m; the reference's platforms are large flat panels several metres
   * across, each a slightly different tone, so a 2 m tile would show the same
   * three panels six times across T1's twelve metres. This one covers 40 m in a
   * single copy, centred on the origin, and carries its own `repeat` and
   * `offset`. See `createPanelFillMap`.
   *
   * Sized against a MEASURED deck, not against `palette.bandDeckTop`: a lit deck
   * renders at 0.687 of display luma, so the ladder spends 0.06 downward and
   * lands the darkest panel at 0.627, with the whole distribution inside the
   * 0.56-0.74 gameplay band and off the ceiling it had been resting on.
   */
  const deckAlbedo = useMemo(() => {
    /*
      The panel map's resolution is decoupled from `surfaceMapSize`, at 2048 on
      high, and that decoupling is the whole reason the marks are visible at all.

      MEASURED: the deck covers about 470 px for 12 m in `hub-establishing`, so one
      screen pixel is 26 mm of deck - while a 1024 map spread over the island's
      40 m span has 39 mm texels. **The texture was the limit rather than the
      display**, and every mark in the vocabulary was being authored below what the
      player can resolve. That is the same Nyquist failure as the 2.5 mm panel
      groove, one level up: it is not enough for a mark to be printed rather than
      cut, it also has to be bigger than a texel and bigger than a pixel.

      16 MB of VRAM and almost no CPU, because unlike `createDecalMaps` this
      function never calls `getImageData`.
    */
    const size = panelFillSize(quality.surfaceMapSize)
    return size ? createPanelFillMap({ size }) : null
  }, [quality.surfaceMapSize])

  /**
   * Every walkable piece in the level, merged into one geometry.
   *
   * Merging rather than instancing, and it is worth saying why so nobody
   * optimises it back. A rounded box scaled non-uniformly gets an elliptical
   * fillet: T1 is 12 x 2.0 x 4.0, which off a 4 x 0.4 x 4 base needs a scale of
   * (3, 5, 1) and turns a uniform 0.12 fillet into a 0.36 x 0.60 x 0.12 one.
   * "Every edge takes a bevel that catches the key as a bright line" is a world
   * rule here, so a wrong bevel is not cosmetic. The architecture is static, so
   * calling each generator once per placement and merging the results gives
   * correct bevels everywhere for one draw call.
   *
   * The two band-1 values ride on a vertex colour rather than on two materials,
   * which is what keeps it to one draw call. See `paintByFacing`.
   */
  const walkable = useMemo(() => {
    /*
      Both batches are built in ONE memo because they share one lightmap atlas, and
      `packLightmapAtlas` has to see them together to place their charts. Splitting
      them back into two memos would mean two atlases, two textures and two
      manifests, for no gain: a chart's placement does not depend on which mesh it
      came from, so packing them together only improves occupancy.
    */
    const plinth = totemPlinth()
    const deckParts = hubDeckParts(plinth)
    const trimParts = hubTrimParts()

    const deck = mergeProp(deckParts)
    const trim = mergeProp(trimParts)
    plinth.dispose()

    /*
      UV set 1: the lightmap atlas. A unique, non-overlapping parameterisation, which
      is the exact opposite of what `boxProjectUV` produces below and why this needs a
      second set rather than a second scale on the first.

      **This runs the SAME functions the offline bake ran**, on parts built by the
      same `hubDeckParts`/`hubTrimParts`. That is the whole integrity argument: there
      is no second description of the layout for the two to drift apart on, and
      `lightmapStaleness` hashes the result so that a layout change that outdates the
      PNG is a console error rather than the old layout's shadows in the new layout's
      places.
    */
    const meshes: LightmapMesh[] = [
      { geometry: deck, partVertexCounts: propPartVertexCounts(deckParts) },
      { geometry: trim, partVertexCounts: propPartVertexCounts(trimParts) },
    ]
    const atlas = packLightmapAtlas(meshes, HUB_LIGHTMAP_ATLAS)
    applyLightmapUV(meshes, atlas)

    // UV set 0: the tiling, world-scale projection every detail map depends on.
    boxProjectUV(deck, DECAL_KINDS.deck.metresPerTile)
    boxProjectUV(trim, DECAL_KINDS.trim.metresPerTile)

    /*
      The changeover sits at a normal Y of 0.55, which puts it on the fillet
      rather than on either flat face, so the dark side value climbs into the
      light top value across the bevel instead of switching along a hard line.
    */
    paintByFacing(deck, { up: BAND.deckTop, side: BAND.deckSide })

    return { deck, trim, atlas }
  }, [])

  /**
   * The baked occlusion map, and the check that it still describes this layout.
   *
   * The warning is an effect rather than an inline `console.error`, so it fires once
   * per mount instead of once per render, and it is a warning rather than a throw
   * because a stale lightmap still renders a playable world - it just renders the
   * previous layout's shadows, which is precisely the failure that is invisible
   * without being told.
   */
  const lightmap = useHubLightmap()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const stale = lightmapStaleness(walkable.atlas)
    if (stale) console.error(stale)
    assertLightmapBound(walkable.deck, lightmap, 'the deck batch')
    assertLightmapBound(walkable.trim, lightmap, 'the trim batch')
  }, [walkable, lightmap])

  /**
   * Band 2 furniture: the Core's struts and collar, the pylon masts and caps,
   * the overhead arcs, and the groves' root pads.
   */
  const dressBatch = useMemo(() => {
    const parts: PropPart[] = []

    /*
      Four struts rising from radius 2.10 on Puck C and canting inward to a
      collar at 4.60. The chord between adjacent bases is 2.97 m and the struts
      are 0.44 across, so 2.53 m of clear gap remains and the player walks
      between them freely.

      The Euler is [0, -theta, tilt] and the ORDER matters. three composes XYZ as
      Rx * Ry * Rz, so the Z term tilts the upright capsule within one plane
      first and the Y term then swings that tilt round to the strut's own
      bearing. Swapping the two leans all four struts the same way instead of
      inward, and it looks close enough to right to survive a screenshot.
    */
    const baseRadius = 2.1
    const collarRadius = 1.3
    const collarY = 4.6
    const footY = 3 * STEP
    const rise = collarY - footY
    const reach = baseRadius - collarRadius
    const length = Math.hypot(reach, rise)
    const tilt = Math.atan2(reach, rise)

    for (let i = 0; i < 4; i++) {
      const theta = (Math.PI / 4) * (1 + 2 * i)
      parts.push({
        geometry: pill(0.22, length - 0.44),
        position: [Math.cos(theta) * baseRadius, footY, Math.sin(theta) * baseRadius],
        rotation: [0, -theta, tilt],
      })
    }

    parts.push({ geometry: puck(collarRadius, 0.3, 0.08), position: [0, collarY - 0.15, 0] })

    /*
      The pylons, sunk by exactly their own radius, which is a contact fix rather
      than a layout change.

      `pill(r, l)` is a `CapsuleGeometry` translated so the bottom of its LOWER
      HEMISPHERE sits at local y = 0. Placed at y = 0 on a lawn that
      `Terrain.tsx` makes geometrically flat, that is a sphere tangent to a plane:
      the two surfaces touch at a single point and separate quadratically. The
      shaft's cross-section is 0.082 m at 1 cm up and 0.241 m at 10 cm, and the
      distance from a lawn pixel at horizontal distance d to the nearest pylon
      surface is `sqrt(d^2 + 0.34^2) - 0.34`, which is 4 mm at d = 5 cm.

      **It is the contact shape that produces the least occlusion of any**, so no
      shadow map and no occlusion pass could ever have put a contact there, at any
      resolution or radius. Round 2's F14 recorded the symptom - "the pylon in
      `hub-backlit` still meets the lawn with no treatment at all" - and diagnosed
      it as a missing pass. The cause was the model.

      Sinking by 0.34 buries the whole lower hemisphere and brings the 0.34
      cylinder wall down to meet the lawn at a real right angle, which is a corner
      that both the cast shadow and the contact decal can act on. The pill is
      lengthened by the same 0.34 so the crown stays at exactly `pylon.height` and
      the cap disc above it does not have to move. The collider is a 0.4 m
      cylinder against a 0.34 m mesh, so collision is untouched.
    */
    for (const pylon of visiblePylons) {
      const [x, z] = pylonPosition(pylon.degrees)
      parts.push({ geometry: pill(0.34, pylon.height - 0.34), position: [x, -0.34, z] })
      if (gates.pylonDetail) {
        parts.push({ geometry: puck(0.62, 0.3, 0.08), position: [x, pylon.height, z] })
      }
    }

    /*
      Only the arcs whose two pylons the tier actually draws.

      At low the ring is six posts, and the 300-to-330 arc was still being
      built - so `low--hub-establishing` shows a cable hanging in empty sky at
      the upper right, square cut at both ends, with no pylon at either. An arc
      is a thing BETWEEN two posts; with a post missing it is not a shorter arc,
      it is nothing. Filtered rather than clamped for that reason.
    */
    for (const arc of arcsWithBothEnds(ARCS, visiblePylons.map((p) => p.degrees))) {
      parts.push({ geometry: catenary(arc.from, arc.to, arc.apex, gates.traceSegments) })
    }

    /*
      No root pad under a grove, which is a departure from the spec's K9 usage.

      Band 2 is 0.27 luma and the lawn is 0.67, so a 0.60 m disc of band 2 lying
      flat on grass does not read as a root, it reads as a hole burnt in the
      lawn - which is what it looked like in frame. The band values are right for
      a VERTICAL object silhouetted against sky and wrong for a horizontal one
      seen against the ground it sits on, and the shards plus the planting
      exclusion already give a grove its footprint.
    */
    /*
      Painted by facing, with the ramp running the opposite way to the deck's.

      A deck is light on top and a step darker down its side, because that is
      how a solid catches an overhead key and the eye expects it. Band 2 has the
      opposite problem: the same key that keeps a deck top in band drives a
      vertical post two bands below it. So the frame carries the light value on
      its FLANKS, where the key barely reaches, and the dark one on its crown,
      which takes the key almost in full. The result is one merged draw whose
      posts, caps, struts and arcs all land inside 0.20 to 0.38 on the frame -
      which is the only place the band was ever meant to be measured.
    */
    return assertDrawable(
      paintByFacing(boxProjectUV(mergeProp(parts), DECAL_KINDS.trim.metresPerTile), {
        up: BAND.frameTop,
        side: BAND.frameSide,
      }),
      'the dress batch',
    )
  }, [visiblePylons, gates.pylonDetail, gates.traceSegments])

  /**
   * The four spur channels, the trunk, the junction pool and the threshold pad,
   * in one water batch.
   *
   * The discs share the channels' material and their section, so folding them in
   * costs nothing and saves the separate draw the spec budgeted for them. It also
   * requires every part here to carry the `aShore` attribute, because `mergeProp`
   * reduces to the attributes every part HAS - so a part built without it would
   * silently drop the meniscus from the whole batch rather than from itself. Both
   * builders write it; `hubLayout.test.ts` asserts both do.
   */
  const traceBatch = useMemo(() => {
    const parts: PropPart[] = []

    /*
      Segment counts are derived from each path's length rather than shared,
      because the trunk runs 13.8 m against the spur's 6.6 and a shared count
      gave the trunk a ring every 0.14 m - which rounds a 0.12 m mitre straight
      back into the curve the mitre was put there to remove. Sampled by distance
      it is 294 rings on the trunk and 140 on each spur at high.

      **The batch got DEARER, and the first draft of this comment claimed the
      opposite.** It reasoned that an 8-quad section must beat a 6-segment tube and
      did not count: a tube CLOSES, so 6 radial segments are 6 quads, where an open
      9-point section is 8. Measured at high tier:

        piece            was      now
        trunk          3,528    4,704
        spur (x4)      1,680    2,240   each
        disc (x2)        432      288   each
        --------------------------------
        batch         11,112   14,240

      +28%, which is 0.06% of the 4.85M triangle budget and the right trade for the
      read. It is written down because an unchecked "this is cheaper" is exactly the
      class of claim this project has been wrong about before.
    */
    for (let i = 0; i < 4; i++) {
      parts.push({
        geometry: sweepChannel(
          SPUR_TRACE,
          TRACE.spurHalfWidth,
          traceSegments(pathLength(SPUR_TRACE), gates.traceSegments),
        ),
        rotation: [0, (Math.PI / 2) * i, 0],
      })
    }

    /*
      The junction pool, and it is now the SURFACE of water sitting in a recess
      rather than a disc of water sitting on the deck.

      What was here was `pad(1.05)`, which is `roundedCylinder({ height: 0.1 })`
      standing on its own base - a 2.10 m wide, 0.10 m TALL cylinder of water
      standing proud on Puck C, with no collider, in the middle of the walking
      route, directly beneath the Core node. The recess it now sits in is cut into
      Puck C by `basinLathe`, its collider is `poolRingColliders`, and this is only
      the water's top surface.

      Placed at Puck C's deck plane exactly, so the pool is brim-full to the
      surrounding floor and there is no step in the waterline between the pool and
      the five channels that meet it.

      One via pool at the Core rather than four pads is kept from version two, and
      the grammar argument is unchanged: four separate pads said "four wires that
      happen to stop near each other", where one basin every spur runs out of and
      the trunk runs into says "four inputs feed one node".
    */
    parts.push({
      geometry: waterDisc(POOL.radius, POOL.rimWidth, POOL.ringFraction),
      position: [0, 3 * STEP, 0],
    })

    parts.push({
      geometry: sweepChannel(
        TRUNK_TRACE,
        TRACE.trunkHalfWidth,
        traceSegments(pathLength(TRUNK_TRACE), gates.traceSegments),
      ),
    })

    /*
      The threshold pad in front of the arch, where the trunk springs.

      Flush rather than recessed, and that is the one place this pass knowingly
      leaves a disc of water lying on a deck rather than in it. T3 is a `slab` -
      a chamfered box - and there is no cheap recess in a box: splitting it into
      two half-slabs plus a floor slab would carve a real channel with real bevelled
      lips, but it turns one part into three and moves every later part's charts in
      the lightmap atlas. It also buys nothing, because nothing steps into this one:
      it is 0.9 m wide against the 0.18 m the capsule needs to travel inside a rim
      before it touches bottom, so a recess here would be a step-down the player
      could feel and never see the point of. Brim-full is the correct read for a
      spring anyway.
    */
    parts.push({
      geometry: waterDisc(0.9, POOL.rimWidth, POOL.ringFraction),
      position: [0, 7 * STEP, -14.1],
    })

    return assertDrawable(mergeProp(parts), 'the water batch')
  }, [gates.traceSegments])

  /**
   * Layer B2: the far monolith arc, and the frame's third depth layer.
   *
   * **The scene had two layers, subject and sky.** The top half of the portal
   * shot was empty, the establishing shot's island floated in a flat wash, and
   * across thirty metres the far lawn measured 0.05 lighter than the near lawn
   * and slightly MORE saturated - so there was no aerial perspective at all,
   * in either value or chroma. The environment spec has specified this layer
   * since its first draft and it was never built.
   *
   * Unlit, deliberately. A `meshBasicMaterial` takes no light, so its rendered
   * value is its authored value less the tone curve, which is the only way to
   * put a distant object in a measured band without guessing at how much key a
   * 60 m slab at an unknown facing receives. It is also what the reference asks
   * for on its own terms: background layers get progressively less material
   * detail and frequently no shading at all, and flattening them is what pushes
   * them back.
   *
   * The depth inside the layer comes from two things that cost nothing. The
   * radius is jittered between 95 and 130 m, so fog - which starts at 40 and
   * saturates at 150 - separates the near slabs from the far ones by a real
   * amount. And each slab carries a flat vertex colour lerped by its own
   * distance, so the arc has a value gradient across it without a second
   * material.
   *
   * One draw call, no shadows cast or received, not tier gated. It costs less
   * than a single pylon and it is the difference between a diorama on a table
   * and a place.
   */
  const backdrop = useMemo(() => {
    const random = mulberry32(31415926)
    const near = new Color(BACKDROP_NEAR)
    const far = new Color(BACKDROP_FAR)
    const tint = new Color()
    const parts: PropPart[] = []

    for (const monolith of monolithArc(BACKDROP_SLABS, random)) {
      const geometry = slab(monolith.width, monolith.height, monolith.depth, 0.5)
      const vertices = geometry.getAttribute('position').count
      const colors = new Float32Array(vertices * 3)
      tint.copy(near).lerp(far, (monolith.distance - 95) / 35)
      for (let i = 0; i < vertices; i++) {
        colors[i * 3] = tint.r
        colors[i * 3 + 1] = tint.g
        colors[i * 3 + 2] = tint.b
      }
      geometry.setAttribute('color', new BufferAttribute(colors, 3))
      parts.push({
        geometry,
        position: [monolith.x, monolith.baseY, monolith.z],
        rotation: [0, monolith.yaw, 0],
      })
    }

    return assertDrawable(mergeProp(parts), 'the background monolith arc')
  }, [])

  /** The crystal groves, merged. */
  const shardBatch = useMemo(() => {
    const random = mulberry32(20260809)
    const parts: PropPart[] = []

    for (const grove of GROVES.slice(0, gates.groves)) {
      const count = Math.max(3, Math.round(grove.shards * quality.propDensity))
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2
        // Square-rooted so the samples are uniform over the area rather than
        // piling into the middle.
        const distance = grove.radius * Math.sqrt(random())
        /*
          The spec's range is 0.5 to 2.2 and it was measured down.

          A 2.2 m shard stands a full metre over a 1.4 m robot, and six of them
          in a grove read as a stand of pink shark fins rather than as ground
          cover. The rule the height has to satisfy is the one about area: total
          shard silhouette stays under 2% of the frame from the spawn, and the
          two foreground groves are the ones that decide it. 1.55 is the tallest
          that keeps a grove reading as something the character walks past.
        */
        const height = 0.45 + random() * 1.1
        // Splay is also down, from 5-20 degrees. Past about 14 the taller
        // shards stop reading as growth and start reading as felled.
        const lean = (4 + random() * 10) * (Math.PI / 180)
        parts.push({
          geometry: shard(height, 0.045, 0.09 + height * 0.075),
          position: [grove.x + Math.cos(angle) * distance, 0, grove.z + Math.sin(angle) * distance],
          // Tilted outward from the grove centre, which is what makes it read as
          // growth, with a free yaw so no two shards show the same facet.
          rotation: [Math.sin(angle) * lean, random() * Math.PI * 2, -Math.cos(angle) * lean],
        })
      }
    }

    return mergeProp(parts)
  }, [gates.groves, quality.propDensity])

  /**
   * The perimeter marker nodes: one merged core batch and one merged shell.
   *
   * **Gated on `pylonDetail`, not on `pylonCount`, and that was the bug.** The
   * cap disc is a detail and was dropped at low; the lamp that sits 0.40 above
   * the cap was keyed off the count instead, which low still satisfies. So low
   * tier rendered eight orbs hanging in the sky with a visible gap beneath each
   * one and nothing holding them up. A marker is part of a pylon's head, and
   * whatever drops the head has to drop everything on it.
   */
  const markers = useMemo(() => {
    const mounted = gates.pylonDetail ? visiblePylons : []
    const place = (build: (radius: number) => BufferGeometry, radius: number) =>
      mergeProp(
        mounted.map((pylon) => {
          const [x, z] = pylonPosition(pylon.degrees)
          return {
            geometry: build(radius),
            position: [x, pylon.height + 0.7, z] as [number, number, number],
          }
        }),
      )
    if (mounted.length === 0) return null
    return { core: place(nodeCore, 0.26), shell: place(nodeCore, 0.35) }
  }, [visiblePylons, gates.pylonDetail])

  const totems: TotemPlacement[] = hubLessons.map((lesson) => ({
    lesson,
    position: TOTEM_SPURS[lesson.id] ?? lesson.position,
    completed: isLessonComplete(lesson, progress),
  }))

  const exclusions = useMemo(() => hubExclusions(gates.groves, gates.pylons), [gates.groves, gates.pylons])

  /**
   * The contact batch: one geometry, one draw call, every static base in the hub.
   *
   * Gated on `quality.contactShadow`, which is the flag the character's blob
   * already uses and which is true at every tier. That is deliberate on both
   * counts. It is true at low because low has a 1024 shadow map and no occlusion
   * pass at all, so low is the tier that needs authored contact most - the same
   * argument `ContactBlob.tsx` makes for itself. And reusing the flag rather than
   * adding one means `?nogfx=blob` turns the whole contact system off in one
   * lever, which is what makes the A/B reproducible without a rebuild.
   *
   * The boulder placements come from `Scatter`'s own exported function with the
   * same three arguments `Scatter` passes it, so the decals sit under the rocks by
   * construction rather than by two copies of six literals agreeing.
   */
  const contacts = useMemo(
    () =>
      contactDecalGeometry(
        hubContacts(
          visiblePylons,
          gates.groves,
          boulderPlacements(PLATEAU_RADIUS, quality.propDensity, exclusions),
        ),
      ),
    [visiblePylons, gates.groves, quality.propDensity, exclusions],
  )

  const contactMaterial = useMemo(() => createContactDecalMaterial(CONTACT_TINT.hub), [])
  /*
    Disposed on unmount, because a `ShaderMaterial` built here owns a compiled
    program and three does not collect it. Everything else in this file is a
    geometry handed to a JSX material, which r3f disposes for us; this is the one
    object we constructed and therefore the one we have to release.
  */
  useEffect(() => () => contactMaterial.dispose(), [contactMaterial])

  return (
    <group>
      {/*
        The background silhouette, drawn first because it is behind everything
        and last in the eye's order of business.
      */}
      <mesh geometry={backdrop} frustumCulled={false}>
        <meshBasicMaterial vertexColors />
      </mesh>

      {/* Ground, and the field growing on it. */}
      <Terrain />
      <Grass radius={PLATEAU_RADIUS} exclusions={exclusions} />
      <Flowers radius={PLATEAU_RADIUS} exclusions={exclusions} />
      <Scatter radius={PLATEAU_RADIUS} exclusions={exclusions} />

      {/*
        Every walkable surface: one geometry, one material, one draw.

        `castShadow` stays. The runtime shadow map is still what draws the SUN's
        shadows here, deck onto deck and kerb onto deck, and the baked map does not
        touch that term - see `src/art/lightmap.ts` for why `aoMap` arithmetically
        cannot. Turning static casters off to let a bake own the sun was priced and
        rejected: the statics also cast onto the lawn, which is `Terrain.tsx` and has
        no lightmap, and onto the character, which nothing static can ever bake.
      */}
      <mesh geometry={walkable.deck} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...mattePlastic('#ffffff', { vertexColors: true })}
          {...(deckMaps
            ? {
                normalMap: deckMaps.normalMap,
                roughnessMap: deckMaps.roughnessMap,
                /*
                  The coat's roughness, which was a correction rather than the free
                  A/B it was offered as.

                  `roughnessMap` multiplies `roughness` and never `clearcoatRoughness`,
                  so at the map's smoothest texel the base lobe reaches 0.579 while the
                  coat stays pinned at 0.26 - a lobe ratio of 4.96 where 8 is required.
                  The two-lobe rule is asserted on the PRESET in `materials.test.ts` and
                  the map is bound here, so the preset passes and the surface the player
                  sees resolves as one specular wash on the smooth half of every panel:
                  the exact defect `plastic()` was rebuilt to remove, reintroduced by a
                  texture. Same image, same green channel, no new sampler; the ratio
                  becomes invariant at 11.98, above the 8.3 the unmapped preset has.
                  See `lobeRatioUnderRoughnessMap`. Revertable on its own line.
                */
                clearcoatRoughnessMap: deckMaps.clearcoatRoughnessMap,
                roughness: deckMaps.roughness,
              }
            : {})}
          {...(/*
            The baked sky occlusion, on UV set 1, in the slot the generated ORM pack
            used to hold.

            **It replaces that pack's occlusion channel rather than joining it, and
            it has to.** `createDecalMaps` returns `roughnessMap: orm, aoMap: orm` -
            one `Texture` in two slots - and `channel` is a property of the texture,
            so there is no way to sample the ORM on UV 0 and this on UV 1 in one
            material. What is given up is measured and it is nothing: the note on
            `deckAlbedo` above records that switching the generated maps on moved a
            lit deck's p5-p95 from 0.0387 to 0.039. Roughness and metalness are
            untouched, because they are the same texture still bound at `roughnessMap`.
          */
          lightmap ? { aoMap: lightmap, aoMapIntensity: HUB_LIGHTMAP_INTENSITY } : {})}
          {...(/*
            `map` multiplies the vertex colour, which is what carries the two band
            values here, so the panel map has to be centred on WHITE with its
            pattern below it. A map centred on mid grey would halve the albedo of
            every walkable surface in the game and take band 1 with it.
          */
          deckAlbedo ? { map: deckAlbedo } : {})}
        />
      </mesh>

      {/* Kerbs. Never tier gated: a kerb with a collider and no mesh is an
          invisible wall, which is strictly worse than no kerb at all. */}
      <mesh geometry={walkable.trim} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...mattePlastic(BAND.trim)}
          {...(trimMaps
            ? {
                normalMap: trimMaps.normalMap,
                roughnessMap: trimMaps.roughnessMap,
                // 5.71 at the smoothest texel, against a minimum of 8. See the deck.
                clearcoatRoughnessMap: trimMaps.clearcoatRoughnessMap,
                roughness: trimMaps.roughness,
              }
            : {})}
          {...(lightmap ? { aoMap: lightmap, aoMapIntensity: HUB_LIGHTMAP_INTENSITY } : {})}
        />
      </mesh>

      {/*
        The frame: pylons, struts, the collar and the overhead arcs.

        **Anodised metal rather than matte plastic, and it is the correction of a
        measured band failure rather than a look change.**

        MEASURED on `.critique/astro/maps-on--hub-establishing.png`, which is the
        frame the paint pass above was itself written against:

          member                box              mean   p5     p95    width  band?
          Core strut, near      817,505,16,20    0.383  0.190  0.472  0.282  NO
          pylon 300 deg shaft   1168,355,22,40   0.294  0.134  0.411  0.278  NO
          pylon 0 deg shaft     1491,500,34,40   0.241  0.120  0.394  0.274  NO
          pylon 180 deg shaft   255,400,24,40    0.360  0.224  0.411  0.187  NO

        `frame.mjs spread` returns `inOneBand: false` on all four, in a midground
        band 0.18 wide, and two of them dip into the anchor band. `paintByFacing`
        fixed the MEAN exactly as predicted - 0.294 against a predicted 0.27 - and
        cannot touch the spread, because it assigns an albedo from a face normal
        and a cylinder presents every normal in a hemisphere at once. Round 3's fix
        was measured on the statistic round 3's own amendment then retired.

        No albedo can fix it. A diffuse cylinder's p95-to-p5 LINEAR ratio under this
        key is 6.297 and the albedo cancels out of both ends; midground permits
        3.603. Deleting the diffuse term is the only mechanism that removes the
        6.297, and Schlick on a cylinder replaces it with 1.621 - because screen-x
        is uniform in `sin(phi)` while `(1 - cos)^5` stays flat past 60 degrees, so
        the whole Fresnel rise is squeezed into the outer tenth of the width. That
        leaves 2.22x for the variation in what the members reflect across their
        width, which is the one term this cannot predict and the number to check a
        frame against. `cylinderFresnelRatio` in `materials.ts` carries the whole
        argument, and it is a correction to `anodised()`'s own finding: that note
        rules metal out for a FLAT face and the conclusion inverts on a curve.

        `FRAME_SIDE` rather than the vertex ramp, and the ramp is dropped rather
        than kept. For a metal the albedo IS `f0`, and `f0` is the FLOOR of the
        value while the environment sets the scale, so a DARKER colour makes the
        spread WIDER: `#6e7e9e` gives a ratio of 1.62 and `frameTop`'s `#3c465a`
        gives 3.42, which spends the entire band. The floor is display luma 0.446.
        The light-flanks-dark-crowns ramp exists to compensate for a diffuse facing
        response this material no longer has, and its darker half is the half that
        breaks the band. Dropping `vertexColors` also lightens the up-facing pucks -
        the pylon caps and the collar top - which are the one part of this batch
        that stays a flat face and keeps the original flat-face finding. They are
        about 12 px deep here; if they read wrong the fix is lighter still, not
        darker. `paintByFacing` in `dressBatch` is now writing an attribute nothing
        reads and wants removing once this is confirmed in a frame.

        It cannot bloom. `F` reaches 1 at the silhouette, and the brightest radiance
        this material can see is `1.5543 x 0.7 x 1.0 = 1.088` against a measured
        threshold of 1.45. The rim above p95 is 1.0 px on a 20 px strut, so it
        antialiases into the silhouette rather than reading as a surface.

        `strutMaps` rather than `trimMaps`, and on a metal the roughness map finally
        has a lobe to break: a metal has no diffuse term, so the channel modulates
        the whole surface instead of a near-Lambertian body under an unreachable
        coat. `clearcoatRoughnessMap` is mandatory here rather than optional - at
        green 156 the base reaches 0.229 against an unmapped coat at 0.10, a ratio
        of 5.26 where 8 is needed. Mapped, it pins at 14.06.
      */}
      {/*
        REVERTED TO DIFFUSE, and the measurement is the reason.

        `anodised()` was bound here on arithmetic that is correct as far as it
        goes: a diffuse cylinder's p95/p5 linear ratio under this key is 6.297
        against 3.603 permitted, the albedo cancels out of both ends, and Schlick
        on a cylinder crushes the whole Fresnel rise into the outer tenth of the
        width for a spread of 1.621. All true. The stream that computed it also
        named the one term it could not compute - "what the members reflect across
        their width" - and said to check a frame against it.

        The frame says no. Measured on `hub-establishing` at high, a pylon mast
        went from a mean near 0.33 to **0.0959 and 0.0905**, and a strut to 0.1785.
        A metal has no diffuse term, so its value is entirely what it reflects, and
        what these members face is this rig's dark side: a negative-fill card at
        `#0b0f1a` and a background at `#243a52`. The spread narrowed exactly as
        predicted and the LEVEL collapsed.

        That breaks a written decision rather than a preference.
        `97-decision-shadow-end.md` says: "No repeated vertical object may be the
        darkest thing in the frame. Pylons, struts, catenary arcs and backdrop
        monoliths are the frame, and the frame stays in the midground band, 0.20 to
        0.38." Eight pylons at 0.09 are in the anchor band, which is the cage the
        whole round-3 decision exists to prevent, and the frame's share below 0.20
        more than doubled from 3.19% to 6.87%.

        What survives from that work, because it is separable and good: the `strut`
        decal kind with a 70 mm groove instead of `trim`'s sub-pixel 2.5 mm, the
        cylinder and facing arithmetic in `materials.ts`, and the
        `clearcoatRoughnessMap` binding that fixes a real two-lobe violation. Only
        the metal is reverted, and it is one line.

        Making metal work here needs the environment to give these members
        something bright to reflect at a grazing angle, which is a light-rig change
        and not a material one.
      */}
      <mesh geometry={dressBatch} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...mattePlastic('#ffffff', { vertexColors: true })}
          {...(strutMaps
            ? {
                normalMap: strutMaps.normalMap,
                roughnessMap: strutMaps.roughnessMap,
                aoMap: strutMaps.aoMap,
                clearcoatRoughnessMap: strutMaps.clearcoatRoughnessMap,
                roughness: strutMaps.roughness,
              }
            : {})}
        />
      </mesh>

      {/*
        Object-base contact, for everything that is not the character.

        `renderOrder` -1, which is EARLIER than the character's blob rather than
        alongside it, and the reason is worth stating because -1 looks like a
        mistake.

        Three renders the whole opaque list before the whole transparent list, and
        `renderOrder` only sorts within a list. So -1 still draws after every
        opaque surface - which is what a multiply needs - while drawing before
        every other transparent in the scene. That ordering matters: the node
        shells and the totem shells are alpha-blended at the default 0, they hang
        directly above bases that now carry contact, and from any elevated vantage
        they project onto it. At `renderOrder` 1 this batch would multiply the
        shells themselves, making an element the critique already calls a dirty
        acrylic bauble dirtier. At -1 the shells composite over a finished ground.

        Leaving it at 0 would have worked most of the time and failed by distance
        sorting some of the time, which is worse than either.

        `frustumCulled` stays on. The batch's bounding sphere covers the island so
        the test effectively always passes, and paying for it is still correct.
      */}
      {contacts && quality.contactShadow && (
        <mesh geometry={contacts} material={contactMaterial} renderOrder={-1} />
      )}

      {/*
        The traces, now water, and still the hub's second reading of progress.

        **This reverses the decision recorded in the block it replaces**, which
        cut the trace's clearcoat to 0.15 and raised its roughness specifically
        to kill a specular streak, because "a trace inlaid in a board is not
        wet." That was correct about a circuit trace. The object is reclassified,
        so the streak is now the point rather than the defect - see
        `waterMaterial.ts`, which carries the whole argument, every tunable, and
        the arithmetic that keeps the effect under the bloom threshold.

        Progress moves from an emissive ramp to the body's sky mix, so the trace
        still brightens across the whole progression - display 0.212 empty to
        0.358 complete - and both ends stay inside the midground band, which the
        emissive ramp never managed.
      */}
      <WaterTrace geometry={traceBatch} completed={completedCount} total={hubLessons.length} />

      {/*
        The splash, on the junction pool only.

        Only there because only there is it earned: the pool is the one piece of
        water in the level the character can actually enter. The channels are 0.15 to
        0.22 m wide and a 0.35 m capsule bridges anything narrower than 0.18 m
        without touching bottom, so a splash on a channel crossing would fire for a
        footfall that never displaced anything. The user's brief says "primarily for
        that circular pool in the center" and the geometry agrees with them.

        The bounds and the surface are module constants - see `POOL_BOUNDS` - so this
        element's props are referentially stable and a re-render of this file cannot
        interrupt a live splash.
      */}
      <PoolSplash player={player} surface={POOL_SURFACE} bounds={POOL_BOUNDS} />

      {/*
        The groves, as pale glass rather than as bright pink plastic.

        They measured display 0.692 to 0.748 with the red channel clipped at 255,
        against decks at 0.612 to 0.698 and a lawn at 0.478 to 0.592 - so
        decoration was the brightest thing on the island and it out-chromaed the
        hero, which is item 5 of the handoff and has survived three rounds.
        `glassShard.ts` carries the numbers: what each of the two mechanisms
        contributed, why transmission and `GLOW.hold` are both refused rather
        than merely unused, and what the replacement predicts.

        `castShadow` is kept. A shard is a solid object and real glass does cast
        a shadow; at 0.045 to 0.09 m across these are slivers on the lawn, and
        dropping them would leave the groves floating.
      */}
      <mesh geometry={shardBatch} castShadow>
        <meshPhysicalMaterial {...glassShard()} />
      </mesh>

      {markers && (
        <>
          <mesh geometry={markers.core}>
            <meshPhysicalMaterial {...emissive(palette.nodeGlow, GLOW.source)} />
          </mesh>
          {gates.nodeShells && (
            <mesh geometry={markers.shell}>
              <meshPhysicalMaterial
                {...plastic(palette.nodeGlow)}
                transparent
                opacity={0.2}
                depthWrite={false}
              />
            </mesh>
          )}
        </>
      )}

      <CoreNode shells={gates.nodeShells} completed={completedCount} total={hubLessons.length} />

      <LessonTotems
        totems={totems}
        player={player}
        onFocus={(id) => setActiveTotem(id)}
        onBlur={() => setActiveTotem(null)}
      />

      {/* The gate to the next zone, at the top of the stack and at the edge of
          the world. See `PORTAL_AT` for the depth arithmetic; it is a constant
          because the contact batch reads the same three numbers. */}
      <Portal
        position={PORTAL_AT}
        locked={!caveOpen}
        label="The Prompt Cave"
        player={player}
        onEnter={() => travel('cave', 'entrance', 'The Prompt Cave')}
      />

      <Colliders />
    </group>
  )
}

/**
 * The hero node hanging over the Core, and the completion ring around it.
 *
 * It sits at 6.00 rather than tucked lower because the ring is the progression
 * read from anywhere on the island and has to clear the skyline. Reachability
 * was checked rather than assumed: standing on Puck C at 1.20 the jump apex
 * puts the feet at 2.60 and the crown of the head at 4.00, against the node's
 * underside at 4.85. The player never intersects it.
 */
function CoreNode({ shells, completed, total }: { shells: boolean; completed: number; total: number }) {
  const group = useRef<Group>(null)

  /**
   * One shading language, and it is the smooth one.
   *
   * **What was wrong.** The core is `IcosahedronGeometry` at detail 2 with
   * smooth normals, so it read as a perfect sphere. The shell was the same
   * primitive at detail 1 with `flatShading`, so it read as a faceted low-poly
   * hull - and because the shell is 0.40 m larger, its facets stuck out from
   * behind the sphere with one saturated violet face catching the key. Two
   * shading languages twenty pixels apart on one object, which reads as an LOD
   * that failed to swap.
   *
   * Smooth wins rather than faceted, because the world rule is that everything
   * here is moulded and never takes a hard corner - crystals are the single
   * sanctioned exception and a neural node is not one - and because this is the
   * frame's focal point, which is the last place to spend a stylistic argument.
   * The shell moves to detail 2 so its silhouette is round at 1.55 m rather than
   * a visible twenty-gon, and `flatShading` comes off. The result is a pale core
   * inside a violet glass ball, which still says "an object with an inside and
   * an outside" and no longer says "two objects".
   *
   * The same swap is applied to the eight perimeter markers, so the node grammar
   * stays constant across all three sizes - which is the property that lets the
   * pylons work as a depth ruler at all.
   */
  /*
    Rebuilt whenever progress changes, and **disposed on the way out**, which it
    was not.

    r3f disposes a `geometry` prop when the mesh unmounts; it does not dispose the
    one it is replacing. So every change of `completed` allocated a fresh core, a
    fresh shell and a fresh pair of arc torii and abandoned the previous set on the
    GPU. That was survivable while progression only ever went up a handful of times
    in a session, and it stopped being survivable the moment the admin panel added
    a reset button: complete, reset, complete, reset is now a loop a user can sit
    on, and each turn of it leaks four geometries.

    This file already disposes by hand in two other places - `plinth.dispose()` and
    the contact material - so the omission was an oversight rather than a
    convention. Found by the stream that added the button, in a file it did not own.
  */
  const geometries = useMemo(
    () => ({
      core: nodeCore(1.15),
      shell: nodeCore(1.55),
      ...arcPair(completed, total),
    }),
    [completed, total],
  )

  useEffect(() => {
    // Captured by value so the cleanup frees the set it was created with, not
    // whatever the next render happens to have put in the ref.
    const owned = geometries
    return () => {
      for (const geometry of Object.values(owned)) geometry?.dispose()
    }
  }, [geometries])

  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    // Half a hertz, so it reads as suspended rather than as bouncing.
    group.current.position.y = 6 + Math.sin(t * Math.PI) * 0.15
    group.current.rotation.y = t * 0.25
  })

  return (
    <group ref={group} position={[0, 6, 0]}>
      {/*
        A pale core inside a saturated shell, which is the art bible's mandatory
        treatment for any emissive whose linear luminance is under 0.35. Violet
        cannot be normalised: it would need eight times the brightest lit
        surface in the scene to reach the threshold and the tone mapper would
        render that as white.
      */}
      <mesh geometry={geometries.core}>
        <meshPhysicalMaterial {...emissive(NODE_CORE, 0.5)} />
      </mesh>
      {shells && (
        <mesh geometry={geometries.shell}>
          <meshPhysicalMaterial
            {...plastic(palette.node)}
            transparent
            opacity={0.34}
            depthWrite={false}
          />
        </mesh>
      )}
      {geometries.incomplete && (
        <mesh geometry={geometries.incomplete}>
          <meshPhysicalMaterial {...mattePlastic(palette.lockedDeep)} />
        </mesh>
      )}
      {geometries.complete && (
        <mesh geometry={geometries.complete}>
          <meshPhysicalMaterial {...emissive(palette.unlocked, GLOW.bloom)} />
        </mesh>
      )}
    </group>
  )
}

/**
 * The completion ring: one arc per hub lesson, as at most two merged
 * geometries.
 *
 * Two rather than one per arc, because the whole ring then costs two draws
 * whatever the progress state and the split is rebuilt on a lesson completion
 * rather than per frame. This is the one thing in the environment allowed to
 * bloom, and it is allowed because gold means reward globally and because
 * finishing a lesson is feedback rather than scenery.
 */
function arcPair(completed: number, total: number) {
  const build = (indices: number[]) => {
    if (indices.length === 0) return null
    // 80 degrees of arc leaves a 10-degree gap on either side of each quarter.
    const span = (80 * Math.PI) / 180
    return mergeProp(
      indices.map((i) => ({
        geometry: new TorusGeometry(2.2, 0.14, 8, 24, span),
        rotation: [Math.PI / 2, 0, (Math.PI / 2) * i + (5 * Math.PI) / 180],
      })),
    ).rotateX((18 * Math.PI) / 180)
  }

  const all = Array.from({ length: total }, (_, i) => i)
  return { complete: build(all.slice(0, completed)), incomplete: build(all.slice(completed)) }
}

/** A sagging cable between two pylon caps. */
function catenary(fromDegrees: number, toDegrees: number, apex: number, segments: number): BufferGeometry {
  const from = PYLONS.find((p) => p.degrees === fromDegrees)!
  const to = PYLONS.find((p) => p.degrees === toDegrees)!
  const [ax, az] = pylonPosition(fromDegrees)
  const [bx, bz] = pylonPosition(toDegrees)
  const capA = from.height + 0.3
  const capB = to.height + 0.3

  const points: Array<[number, number, number]> = []
  const samples = 6
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    /*
      A parabola through the apex rather than a solved catenary. Over a 7 m span
      with 1 m of sag the two curves differ by under a centimetre, which is less
      than the tube's own radius.
    */
    const sag = 4 * (apex - Math.max(capA, capB)) * t * (1 - t)
    points.push([ax + (bx - ax) * t, capA + (capB - capA) * t + sag, az + (bz - az) * t])
  }

  return tubeFromCurve({ points, radius: 0.1, radialSegments: 5, tubularSegments: segments })
}

/**
 * Every collider in the level, authored by hand.
 *
 * Overlapping fixed colliders are fine in Rapier and several of these overlap
 * by design, notably the spur lobes into Puck A and the bridge over it.
 *
 * Nothing decorative gets one. Not the crystal shards, not the trace tubes, not
 * the trace pads, not the Core node, not the node shells, not the arcs. That is
 * the rule `Scatter.tsx` already applies to pebbles and for the same reason: a
 * small thing the capsule can catch on is worse than no small thing.
 */
function Colliders() {
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* The Core. Each radius is 0.10 under its visual one, which is what keeps
          the decorative rim decorative. */}
      {CORE_PUCKS.slice(0, -1).map(({ radius, base }) => (
        <CylinderCollider key={radius} args={[STEP / 2, radius - 0.1]} position={[0, base + STEP / 2, 0]} />
      ))}

      {/*
        Puck C, as a floor plus a ring of twelve, because it now has a pool in it.

        **This is the whole reason the pool is real geometry.** Rapier will not
        follow a displaced mesh - `Terrain.tsx` carries the note and it is the reason
        the lawn is geometrically flat - so a pool that existed only in the deck's
        albedo would be water the character walks over at deck height, which is
        exactly the defect the request is about. The visual recess in `basinLathe`
        and this collider set are two halves of one change and neither is worth
        anything alone.

        The floor cylinder is deliberately WIDER than the pool's rim, out to the
        ring polygon's circumradius, so the twelve lune-shaped gaps between a
        12-gon and its inscribed circle are floored rather than left as air. See
        `poolRingColliders` for why twelve sides is enough, why a heightfield and a
        trimesh were both rejected, and why the polygon's 0.035 m of error cannot be
        seen.

        Neither piece needs an autostep or snap concession. `BODY.autostepHeight` is
        0.50 against a 0.05 step, so climbing out is free and smooth, and
        `BODY.snapToGroundDistance` is 0.50, so walking in is snapped rather than
        becoming an airborne frame. Those two are why the step-down is felt as a dip
        rather than as a stumble - they do not swallow it, they make it graceful.
      */}
      <CylinderCollider
        args={[(STEP - POOL.depth) / 2, poolFloorRadius()]}
        position={[0, CORE_PUCKS[2].base + (STEP - POOL.depth) / 2, 0]}
      />
      {poolRingColliders().map((box, i) => (
        <CuboidCollider
          key={`pool-${i}`}
          args={box.halfExtents}
          position={box.position}
          rotation={box.rotation}
        />
      ))}
      {SPURS.map((spur) => (
        <CylinderCollider
          key={spur.id}
          args={[STEP / 2, SPUR_RADIUS - 0.1]}
          position={[spur.x, STEP / 2, spur.z]}
        />
      ))}

      {/*
        The four Core struts. Boxes rather than capsules, because a capsule
        collider on a leaning strut gives the player a curved surface to slide
        off at head height, and these are the one piece of furniture standing in
        the middle of the route.
      */}
      {[0, 1, 2, 3].map((i) => {
        const theta = (Math.PI / 4) * (1 + 2 * i)
        return (
          <CuboidCollider
            key={i}
            args={[0.24, 1.7, 0.24]}
            position={[Math.cos(theta) * 2.05, 2.9, Math.sin(theta) * 2.05]}
            rotation={[0, -theta, 0]}
          />
        )
      })}

      <CylinderCollider
        args={[BRIDGE.height / 2, BRIDGE.radius - 0.1]}
        position={[BRIDGE.x, BRIDGE.height / 2, BRIDGE.z]}
      />

      {DECKS.map((deck) => (
        <CuboidCollider
          key={deck.id}
          args={[deck.width / 2, deck.height / 2, deck.depth / 2]}
          position={[deck.x, deck.height / 2, deck.z]}
        />
      ))}

      {EAST_PUCKS.map((east) => (
        <CylinderCollider
          key={`${east.x},${east.z}`}
          args={[east.height / 2, east.colliderRadius]}
          position={[east.x, east.height / 2, east.z]}
        />
      ))}

      {WEST_PILE.map((piece) =>
        piece.kind === 'slab' ? (
          <CuboidCollider
            key={`${piece.x},${piece.z}`}
            args={[piece.width / 2, piece.height / 2, piece.depth / 2]}
            position={[piece.x, piece.height / 2, piece.z]}
            rotation={[0, piece.yaw, 0]}
          />
        ) : (
          <CylinderCollider
            key={`${piece.x},${piece.z}`}
            args={[piece.height / 2, piece.colliderRadius]}
            position={[piece.x, piece.height / 2, piece.z]}
          />
        ),
      )}

      {KERBS.map((run) => (
        <CuboidCollider
          key={`${run.x},${run.z},${run.yaw}`}
          args={[run.length / 2, KERB_HEIGHT / 2, KERB_DEPTH / 2]}
          position={[run.x, run.top + KERB_HEIGHT / 2, run.z]}
          rotation={[0, run.yaw, 0]}
        />
      ))}

      {/* Pylons keep their colliders at every tier even where the mesh is
          dropped, because the ring is also the fence at the island's edge. */}
      {PYLONS.map((pylon) => {
        const [x, z] = pylonPosition(pylon.degrees)
        return (
          <CylinderCollider
            key={pylon.degrees}
            args={[pylon.height / 2, 0.4]}
            position={[x, pylon.height / 2, z]}
          />
        )
      })}

      {Object.values(TOTEM_SPURS).map((position) => (
        <CylinderCollider
          key={`${position[0]},${position[2]}`}
          args={[TOTEM.colliderHalfHeight, TOTEM.colliderRadius]}
          position={[position[0], position[1] + TOTEM.colliderHalfHeight, position[2]]}
        />
      ))}
    </RigidBody>
  )
}

/**
 * Where nothing is planted.
 *
 * Grass, flowers and scatter share this list so a blade never grows through a
 * deck and a boulder never sprouts inside a plinth. Derived from the layout
 * tables above rather than written out by hand, which is the difference between
 * an exclusion list that drifts silently and one that cannot.
 *
 * Radii and half-extents are generous rather than exact: a blade poking through
 * the edge of a platform is far more noticeable than a bare centimetre of
 * ground beside it.
 */
function hubExclusions(groves: number, pylons: number): Exclusion[] {
  const out: Exclusion[] = [
    { x: 0, z: 0, radius: CORE_PUCKS[0].radius + 0.4 },
    { x: BRIDGE.x, z: BRIDGE.z, radius: BRIDGE.radius + 0.4 },
  ]

  for (const spur of SPURS) out.push({ x: spur.x, z: spur.z, radius: SPUR_RADIUS + 0.4 })

  for (const deck of DECKS) {
    /*
      A rectangle, not a circle. Clearing the 12 x 4 approach deck with a circle
      needs radius 7.0 and therefore also strips three metres of lawn at each
      corner that nothing was ever going to grow through, and four bare corners
      on the biggest deck in the scene is visible.
    */
    out.push({ x: deck.x, z: deck.z, halfX: deck.width / 2 + 0.4, halfZ: deck.depth / 2 + 0.4 })
  }

  for (const east of EAST_PUCKS) out.push({ x: east.x, z: east.z, radius: east.radius + 0.4 })

  for (const piece of WEST_PILE) {
    out.push(
      piece.kind === 'slab'
        ? {
            x: piece.x,
            z: piece.z,
            halfX: piece.width / 2 + 0.3,
            halfZ: piece.depth / 2 + 0.3,
            rotation: piece.yaw,
          }
        : { x: piece.x, z: piece.z, radius: piece.radius + 0.3 },
    )
  }

  /*
    The two decorative exclusions are tighter than the architectural ones, and
    deliberately so. A generous radius is free around a deck, because the deck
    covers the ground it clears. Around a pylon or a grove it is not: whatever
    the prop does not cover is left as a bald ring of bare texture in the middle
    of the lawn, which was plainly visible in the establishing shot at the first
    values. These clear the foot and nothing else.
  */
  for (const pylon of PYLONS.slice(0, pylons)) {
    const [x, z] = pylonPosition(pylon.degrees)
    out.push({ x, z, radius: 0.75 })
  }

  for (const grove of GROVES.slice(0, groves)) {
    out.push({ x: grove.x, z: grove.z, radius: grove.radius * 0.55 })
  }

  return out
}
