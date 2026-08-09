import { useMemo, useRef } from 'react'
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import { TorusGeometry, type BufferGeometry, type Group } from 'three'
import { band, palette } from '@/art/palette'
import { GLOW, crystal, emissive, mattePlastic, plastic } from '@/art/materials'
import {
  boxProjectUV,
  kerb,
  mergeProp,
  nodeCore,
  nodeShell,
  pad,
  paintByFacing,
  pill,
  puck,
  shard,
  slab,
  trace,
  tubeFromCurve,
  type PropPart,
} from '@/art/geometry'
import { DECAL_KINDS, createDecalMaps } from '@/art/decalTextures'
import { mulberry32, type Exclusion } from '@/art/placement'
import { useQuality } from '@/art/useQuality'
import { Grass } from '@/art/Grass'
import { Flowers } from '@/art/Flowers'
import { Scatter } from '@/art/Scatter'
import { useGame } from '../GameContext'
import { useGameStore, useProgress } from '@/state/gameStore'
import { LESSONS, ZONES } from '@/state/lessons'
import { isSceneAccessible, isLessonComplete } from '@/state/progression'
import { Portal } from './Portal'
import { LessonTotems, TOTEM, totemPlinth, type TotemPlacement } from './LessonTotem'
import { Terrain, PLATEAU_RADIUS } from './Terrain'

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
 * `band()`, which throws in development if the claim is false. That is the
 * point of the helper: the assertion travels with the call site instead of
 * living in a comment that quietly stops being true the next time someone
 * nudges a hex value.
 */
const BAND = {
  /** Band 1. Deck and puck tops. Luma 0.735. */
  deckTop: band(palette.bandDeckTop, 'gameplay'),
  /** Band 1. Deck and puck side faces. Luma 0.589. */
  deckSide: band(palette.bandDeckSide, 'gameplay'),
  /** Band 2. Kerbs and trim. Luma 0.330. */
  trim: band(palette.bandTrim, 'midground'),
  /** Band 2. Pylons, struts, arcs. Luma 0.272. */
  frame: band(palette.bandFrame, 'midground'),
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
 */
const STEP = 0.4

/** The Core: three stacked pucks, walked over on the way to the portal. */
const CORE_PUCKS = [
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
 */
const SPURS = [
  { id: 'NE', x: 5, z: -5 },
  { id: 'NW', x: -5, z: -5 },
  { id: 'SW', x: -5, z: 5 },
  { id: 'SE', x: 5, z: 5 },
] as const

const SPUR_RADIUS = 1.5

/**
 * The bridge, whose south edge touches Puck C at z = -2.20 and whose north edge
 * touches T1 at z = -6.60, which is what makes both risers a clean 0.40.
 */
const BRIDGE = { x: 0, z: -4.4, radius: 2.2, height: 4 * STEP }

/**
 * The three portal decks.
 *
 * Solid from the lawn up rather than floating slabs, which is why each
 * collider's half-height is half the FULL height and its centre is not its top.
 * T3's corners sit at radius 15.52 against a plateau of 16, the tightest fit in
 * the layout and deliberate: the portal deck is meant to feel like it is right
 * at the edge of the world.
 */
const DECKS = [
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
const EAST_PUCKS = [
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
const WEST_PILE = [
  { kind: 'slab', x: -9.6, z: 2.4, width: 3.2, depth: 3.2, height: 2 * STEP, yaw: 0.122, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -7.6, z: 1.2, width: 0, depth: 0, height: 3 * STEP, yaw: 0, radius: 1.3, colliderRadius: 1.2 },
  { kind: 'slab', x: -10.4, z: 0.4, width: 2.4, depth: 2.4, height: 4 * STEP, yaw: -0.192, radius: 0, colliderRadius: 0 },
  { kind: 'puck', x: -11.6, z: 2.6, width: 0, depth: 0, height: 5 * STEP, yaw: 0, radius: 0.9, colliderRadius: 0.8 },
  { kind: 'slab', x: -7.8, z: 3.8, width: 2, depth: 2, height: STEP, yaw: 0.332, radius: 0, colliderRadius: 0 },
] as const

const KERB_HEIGHT = 0.6
const KERB_DEPTH = 0.36
/** Kerbs are inset half their depth so the outer face is flush with the deck below. */
const KERB_INSET = KERB_DEPTH / 2

/**
 * Every exposed deck edge that is not part of the route.
 *
 * A kerb is band 2 on a band 1 deck, so it draws the platform's outline as a
 * dark line, and that line is what makes a raised deck read as raised in a
 * greyscale frame where a value change across a flat top does not.
 *
 * Eleven runs, not the ten the spec's summary claims; its own table lists six
 * on T1, two on T2 and three on T3.
 */
const KERBS = [
  // T1. Open at the bridge mouth in the south and up to T2 in the north.
  { x: -4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  { x: 4.1, z: -6.6 + KERB_INSET, length: 3.8, yaw: 0, top: 5 * STEP },
  { x: -5, z: -10.6 - KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
  { x: 5, z: -10.6 - KERB_INSET, length: 2, yaw: 0, top: 5 * STEP },
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
 * Crystals are emissive and therefore sit outside the value band system on
 * purpose - they are the reward palette, the way a coin is. What keeps that
 * from wrecking the greyscale test is area rather than value: total shard
 * silhouette stays under 2% of the frame from the spawn view.
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
 * The canonical spur trace, written for the NE spur and rotated for the other
 * three.
 *
 * The height rule it obeys is absolute: a trace segment is either at or below
 * 0.12 m above the surface beneath it, or at or above 3.00 m above it, never
 * between. Below 0.12 the capsule steps over it without noticing; above 3.00 it
 * clears the capsule's 1.40 height plus the 1.40 jump apex plus margin.
 * Anything between would visually intersect the character, which is what makes
 * a decorative object read as a bug.
 *
 * A Catmull-Rom through these rounds the two step transitions into short
 * vertical arcs, which is exactly the read wanted: a wire that climbs a step
 * rather than a line painted onto one.
 */
const SPUR_TRACE: Array<[number, number, number]> = [
  [4.6, 0.52, -4.6],
  [4.1, 0.52, -4.1],
  [3.1, 0.52, -3.1],
  [2.83, 0.92, -2.83],
  [2.05, 0.92, -2.05],
  [1.56, 1.32, -1.56],
  [0.85, 1.32, -0.85],
]

/**
 * The north trunk, thicker than the spurs because it is the main path made
 * visible and the player has to tell it from them at a glance.
 *
 * Follow the thick wire and you reach the gate. That sentence is this level's
 * answer to "make the main path unmistakable", expressed in the world's own
 * vocabulary rather than with an arrow.
 */
const TRUNK_TRACE: Array<[number, number, number]> = [
  [0, 1.32, -1],
  [0, 1.32, -2],
  [0, 1.72, -2.6],
  [0, 1.72, -5.8],
  [0, 2.12, -6.8],
  [0, 2.12, -10],
  [0, 2.52, -11],
  [0, 2.52, -12],
  [0, 2.92, -12.8],
  [0, 2.92, -14.1],
]

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
 */
const TOTEM_SPURS: Record<string, [number, number, number]> = {
  'what-is-ai': [-5, STEP, 5],
  'what-is-an-llm': [5, STEP, 5],
  'popular-models': [-5, STEP, -5],
  'what-is-a-prompt': [5, STEP, -5],
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

  /*
    Generated surface detail, off at every tier today because `surfaceMapSize`
    is 0 everywhere until the stream that owns the tier table turns it on. It is
    wired rather than deferred so that enabling it is a one-line diff in that
    file, which is what the rollout discipline asks for.

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
  const deckBatch = useMemo(() => {
    const parts: PropPart[] = []

    for (const { radius, base } of CORE_PUCKS) {
      parts.push({ geometry: puck(radius, STEP), position: [0, base, 0] })
    }
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
    const plinth = totemPlinth()
    for (const position of Object.values(TOTEM_SPURS)) parts.push({ geometry: plinth, position })

    const merged = mergeProp(parts)
    plinth.dispose()
    boxProjectUV(merged, DECAL_KINDS.deck.metresPerTile)

    /*
      The changeover sits at a normal Y of 0.55, which puts it on the fillet
      rather than on either flat face, so the dark side value climbs into the
      light top value across the bevel instead of switching along a hard line.
    */
    return paintByFacing(merged, { up: BAND.deckTop, side: BAND.deckSide })
  }, [])

  /** Every kerb, merged. */
  const trimBatch = useMemo(() => {
    const merged = mergeProp(
      KERBS.map((run) => ({
        geometry: kerb(run.length, KERB_HEIGHT, KERB_DEPTH),
        position: [run.x, run.top, run.z] as [number, number, number],
        rotation: [0, run.yaw, 0] as [number, number, number],
      })),
    )
    return boxProjectUV(merged, DECAL_KINDS.trim.metresPerTile)
  }, [])

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

    for (const pylon of PYLONS.slice(0, gates.pylons)) {
      const [x, z] = pylonPosition(pylon.degrees)
      parts.push({ geometry: pill(0.34, pylon.height - 0.68), position: [x, 0, z] })
      if (gates.pylonDetail) {
        parts.push({ geometry: puck(0.62, 0.3, 0.08), position: [x, pylon.height, z] })
      }
    }

    for (const arc of ARCS) {
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
    return boxProjectUV(mergeProp(parts), DECAL_KINDS.trim.metresPerTile)
  }, [gates.pylons, gates.pylonDetail, gates.traceSegments])

  /**
   * Spur traces, the trunk and every terminating pad, in one emissive batch.
   *
   * The pads share the traces' material, so folding them in costs nothing and
   * saves the separate draw the spec budgeted for them.
   */
  const traceBatch = useMemo(() => {
    const parts: PropPart[] = []

    for (let i = 0; i < 4; i++) {
      const yaw = (Math.PI / 2) * i
      parts.push({ geometry: trace(SPUR_TRACE, 0.09, gates.traceSegments), rotation: [0, yaw, 0] })

      const [px, , pz] = SPUR_TRACE[SPUR_TRACE.length - 1]
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      parts.push({
        geometry: pad(0.45),
        // Rotated by hand rather than by another mergeProp pass, because the pad
        // sits ON the surface at 1.20 while the trace it terminates runs 0.12
        // above it.
        position: [px * cos + pz * sin, 3 * STEP, -px * sin + pz * cos],
      })
    }

    parts.push({ geometry: trace(TRUNK_TRACE, 0.14, gates.traceSegments * 2) })
    // The threshold pad in front of the arch, where the trunk stops.
    parts.push({ geometry: pad(0.9), position: [0, 7 * STEP, -14.1] })

    return mergeProp(parts)
  }, [gates.traceSegments])

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

  /** The perimeter marker nodes: one merged core batch and one merged shell. */
  const markers = useMemo(() => {
    const visible = PYLONS.slice(0, gates.pylons)
    const place = (build: (radius: number) => BufferGeometry, radius: number) =>
      mergeProp(
        visible.map((pylon) => {
          const [x, z] = pylonPosition(pylon.degrees)
          return {
            geometry: build(radius),
            position: [x, pylon.height + 0.7, z] as [number, number, number],
          }
        }),
      )
    return { core: place(nodeCore, 0.26), shell: place(nodeShell, 0.35) }
  }, [gates.pylons])

  const totems: TotemPlacement[] = hubLessons.map((lesson) => ({
    lesson,
    position: TOTEM_SPURS[lesson.id] ?? lesson.position,
    completed: isLessonComplete(lesson, progress),
  }))

  const exclusions = useMemo(() => hubExclusions(gates.groves, gates.pylons), [gates.groves, gates.pylons])

  return (
    <group>
      {/* Ground, and the field growing on it. */}
      <Terrain />
      <Grass radius={PLATEAU_RADIUS} exclusions={exclusions} />
      <Flowers radius={PLATEAU_RADIUS} exclusions={exclusions} />
      <Scatter radius={PLATEAU_RADIUS} exclusions={exclusions} />

      {/* Every walkable surface: one geometry, one material, one draw. */}
      <mesh geometry={deckBatch} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...mattePlastic('#ffffff', { vertexColors: true })}
          {...(deckMaps
            ? {
                normalMap: deckMaps.normalMap,
                roughnessMap: deckMaps.roughnessMap,
                aoMap: deckMaps.aoMap,
                roughness: deckMaps.roughness,
              }
            : {})}
        />
      </mesh>

      {/* Kerbs. Never tier gated: a kerb with a collider and no mesh is an
          invisible wall, which is strictly worse than no kerb at all. */}
      <mesh geometry={trimBatch} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...mattePlastic(BAND.trim)}
          {...(trimMaps
            ? {
                normalMap: trimMaps.normalMap,
                roughnessMap: trimMaps.roughnessMap,
                aoMap: trimMaps.aoMap,
                roughness: trimMaps.roughness,
              }
            : {})}
        />
      </mesh>

      <mesh geometry={dressBatch} castShadow receiveShadow>
        <meshPhysicalMaterial {...mattePlastic(BAND.frame)} />
      </mesh>

      {/*
        The traces, whose brightness is the hub's second reading of progress, on
        a surface the player is already walking along.

        The completed state stops at `GLOW.source` rather than crossing the
        threshold, because the art bible lets nothing in the ENVIRONMENT into the
        bloom tier. Blue means ally and gold means reward; a glowing floor is
        neither, and letting scenery bloom is what turns bloom from feedback into
        weather.
      */}
      <mesh geometry={traceBatch}>
        {completedCount === 0 ? (
          <meshPhysicalMaterial {...mattePlastic(palette.lockedDeep)} />
        ) : (
          <meshPhysicalMaterial {...emissive(palette.circuit, 0.18 + 0.12 * completedCount)} />
        )}
      </mesh>

      {/*
        The groves.

        The glow is deliberately under the tier-B target. `palette.token` has a
        linear luminance of 0.366, a whisker over the 0.35 floor, so tier B's
        1.15 raw needs an emissiveIntensity of 3.14 and the red channel reaches
        4.3 before tone mapping. The first pass shipped at `GLOW.source` and the
        groves came out as flat pink blades with no shading anywhere on them,
        which is the "saturated bright surface" failure the art bible names. At
        0.34 the raw luminance is 0.60, the facets shade again, and the hue
        survives.
      */}
      <mesh geometry={shardBatch} castShadow>
        <meshPhysicalMaterial {...crystal(palette.token, 0.34)} />
      </mesh>

      <mesh geometry={markers.core}>
        <meshPhysicalMaterial {...emissive(palette.nodeGlow, GLOW.source)} />
      </mesh>
      {gates.nodeShells && (
        <mesh geometry={markers.shell}>
          <meshPhysicalMaterial
            {...plastic(palette.nodeGlow)}
            flatShading
            transparent
            opacity={0.2}
            depthWrite={false}
          />
        </mesh>
      )}

      <CoreNode shells={gates.nodeShells} completed={completedCount} total={hubLessons.length} />

      <LessonTotems
        totems={totems}
        player={player}
        onFocus={(id) => setActiveTotem(id)}
        onBlur={() => setActiveTotem(null)}
      />

      {/* The gate to the next zone, at the top of the stack and at the edge of
          the world. The arch is 0.70 deep, so it occupies z from -14.15 to
          -14.85 and sits fully on T3, which ends at -15.0. */}
      <Portal
        position={[0, 7 * STEP, -14.5]}
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

  const geometries = useMemo(
    () => ({
      core: nodeCore(1.15),
      shell: nodeShell(1.55),
      ...arcPair(completed, total),
    }),
    [completed, total],
  )

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
            flatShading
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
      {CORE_PUCKS.map(({ radius, base }) => (
        <CylinderCollider key={radius} args={[STEP / 2, radius - 0.1]} position={[0, base + STEP / 2, 0]} />
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
