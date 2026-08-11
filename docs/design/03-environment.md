# Environment and composition: The Foundry

This is the build spec for the hub island.
It is written so that a build agent can implement it without inventing anything, and every number in it has been checked against the player metrics in `src/game/player/tuning.ts`.

Read `docs/design/00-references.md` first.
Every rule this document applies comes from there, and where the two disagree, the reference brief wins.

Where I am guessing rather than deriving, the line says so explicitly.

---

## 0. What is wrong today, stated precisely

These are the defects this spec exists to fix.
They are listed first because several of the decisions later only make sense as answers to them.

**The walkable ground is a perfectly flat disc.**
`src/game/world/Terrain.tsx` draws a `circleGeometry` of radius 16 at y=0 and backs it with `CylinderCollider([0.5, 16])`.
The comment in that file is correct that Rapier will not follow a displaced mesh, and the conclusion it draws - keep the collider flat - is also correct.
The mistake is the next step, which was to conclude that the *world* must therefore be flat.
Elevation belongs in placed geometry with hand-authored colliders, and this spec provides it.

**There is no framing geometry and no focal point.**
The island's centre is empty, the portal sits off in one corner at (9, 0.8, -5), and the horizon between the island rim and the sky is entirely unoccupied.
The reference brief's rule is to place important things at the centre of the area, and to use decoration to fill unused space so that the play space defines itself.
Neither is happening.

**The greyscale test fails on the single most important pair of surfaces.**
`palette.rock` is `#d5d9e0`, whose Rec.709 luma is 0.850.
The ground texture's base colour is `palette.grass` lerped 34% toward white, whose luma is about 0.83.
The portal platform and the lawn it stands on are therefore the same value.
Desaturate a screenshot and you cannot tell the raised deck from the field, which is the exact failure the acceptance test exists to catch.

**Props are scattered, not clustered.**
`Scatter.tsx` uses `evenPlacements` for boulders, pebbles, clover and its own flower layer.
`placement.ts` already ships the right function - `clusteredPlacements` - and the grass and flowers already use it.
The scatter layer does not.

**Camera FOV is 55.**
The reference recommends 35-45 for the diorama read.

**Hard-edged cylinders and flat planes.**
`LessonTotem.tsx` builds its plinth from two `cylinderGeometry` calls with hard rims.
`HubIsland.tsx` builds its node sculptures the same way and lays its circuit traces as `planeGeometry` strips flat on the ground.
The reference is explicit that this world is pucks and pills with rounded rims, and that there is never a 90-degree hard corner on a moulded object.

---

## 1. The revised hub layout

### 1.1 The idea in one paragraph

The island is a single oversized compute die and the course is what runs on it.
The lawn is the substrate.
At the centre stands **the Core**, a three-step circular dais with four spurs, carrying a large neural node that hangs in the air above it.
Each spur carries one lesson totem, and a glowing circuit trace runs from each totem inward and up the steps to the Core, which is the visual statement that four inputs feed one node.
From the Core, a single heavier trace runs north along a stepped stack of decks to the portal.
Follow the thick wire and you reach the gate.

The composition is a ziggurat in a bowl.
The centre is the highest ground you can stand on outside the portal stack, the perimeter is a ring of tall dark pylons that frames the play space and fills the horizon, and beyond that the island falls away into sky.

### 1.2 Top-down plan

Scale: one character is one metre in X, one row is two metres in Z.
The plan is schematic; the exact figures are in the tables that follow, and those are authoritative where the two disagree.

```
        -16      -8       0       +8      +16
         |        |       |        |       |
z=-16                 (island edge, r=16)
z=-14            ...####P####...
z=-12         ...|*.#########..|...
z=-10       ......#############EEE...
z= -8      |......#############......|
z= -6     ........TTT..bbb..TTT..EE.*..
z= -4      ....*....TTT=bbbbb=TTT.........
z= -2      ..........==BBOOOBB==..EEE.....
z=  0     .|........==BBOOOOOBB==........|.
z=  2      ...ww..ww.==BBOOOBB==..........
z=  4      .......wwTTT=======TTT.....*...
z=  6       ........TTT.......TTT........
z=  8      |.........................|
z= 10        .........*......*........
z= 12          ..........S..........
z= 14              ...............
z= 16                 (island edge)

  .  lawn, y = 0                    =  Core Puck A, top y = 0.40
  T  totem spur lobe, top y = 0.40  B  Core Puck B, top y = 0.80
  b  bridge puck, top y = 1.60      O  Core Puck C stage, top y = 1.20
  #  portal stack decks T1/T2/T3    E  east jump pucks
  w  west toy pile                  *  token crystal grove
  |  perimeter pylon                P  portal arch, T3, y = 2.80
  S  spawn "start"
```

### 1.3 The height ladder

Everything walkable sits on a **0.40 m vertical grid**.
That number is chosen against `BODY.autostepHeight`, which is 0.50.
A 0.40 riser is climbed automatically with a 0.10 margin, which is 20% of the threshold, and that margin is the whole reason the grid is 0.40 and not 0.45.

| Level | y | Piece | Reached from | Riser | Mechanism |
| --- | --- | --- | --- | --- | --- |
| L0 | 0.00 | Lawn | - | - | - |
| L1 | 0.40 | Core Puck A, four totem spur lobes | Lawn, from any direction | 0.40 | autostep |
| L2 | 0.80 | Core Puck B | L1 | 0.40 | autostep |
| L3 | 1.20 | Core Puck C, the stage | L2 | 0.40 | autostep |
| L4 | 1.60 | Bridge puck | L3 | 0.40 | autostep |
| L5 | 2.00 | T1, the approach deck | L4 | 0.40 | autostep |
| L6 | 2.40 | T2, the gate deck | L5 | 0.40 | autostep |
| L7 | 2.80 | T3, the portal deck | L6 | 0.40 | autostep |

The main path from the lawn to the portal is seven 0.40 steps and contains no jump and no ramp.
That is deliberate.
The reference's rule is to make the main path unmistakable and to eliminate ambiguity about what is climbable, and the most unambiguous path is one the player walks up without ever being asked to time anything.
Expression lives in the optional east jump route and the west toy pile, which are covered in 2.4 and 2.5.

The route also runs *over the Core*, which is what places the focal point on the critical path rather than beside it.

### 1.4 The three value bands, spatially

The bands are separated in space as well as in value, and the spatial separation is what makes the value separation hold up.

**Band 1, the gameplay layer.**
Everything the capsule can stand on.
Radius 0 to 16, height 0.00 to 2.80.
The lawn, the Core, the spur lobes, the portal stack, the east pucks, the west pile.

**Band 2, the midground dressing.**
Everything on the island that is not walkable.
Two sub-zones: a *perimeter ring* at radius 14.6 to 16.1 carrying the pylons, the trace arcs and the rim buttresses, and *vertical furniture* rising from the Core - the four struts, the kerbs on every exposed deck edge, and the crystal groves.
Nothing in band 2 is between radius 0 and 6 at a height a player can reach, so band 2 never blocks a sightline to the focal point from inside the ring of totems.

**Band 3, the background silhouette.**
Everything off the island.
Nothing closer than 55 m from the origin, which leaves 39 m of empty sky between the island edge and the nearest background object.
Covered in section 8.

### 1.5 The Core

Centred on the origin.
All four pucks and lobes are generator K2 (see section 4).

| Piece | Visual radius | Top y | Height | Collider | Collider position |
| --- | --- | --- | --- | --- | --- |
| Puck A | 6.00 | 0.40 | 0.40 | `CylinderCollider([0.20, 5.90])` | (0, 0.20, 0) |
| Puck B | 4.00 | 0.80 | 0.40 | `CylinderCollider([0.20, 3.90])` | (0, 0.60, 0) |
| Puck C | 2.20 | 1.20 | 0.40 | `CylinderCollider([0.20, 2.10])` | (0, 1.00, 0) |
| Spur lobe NE | 1.50 at (5, 0, -5) | 0.40 | 0.40 | `CylinderCollider([0.20, 1.40])` | (5, 0.20, -5) |
| Spur lobe NW | 1.50 at (-5, 0, -5) | 0.40 | 0.40 | `CylinderCollider([0.20, 1.40])` | (-5, 0.20, -5) |
| Spur lobe SW | 1.50 at (-5, 0, 5) | 0.40 | 0.40 | `CylinderCollider([0.20, 1.40])` | (-5, 0.20, 5) |
| Spur lobe SE | 1.50 at (5, 0, 5) | 0.40 | 0.40 | `CylinderCollider([0.20, 1.40])` | (5, 0.20, 5) |

Every collider radius is 0.10 under its visual radius.
That gap is what keeps the decorative rounded rim decorative: the capsule stops on a clean vertical cylinder and never catches on a bevel, which is the reason this codebase authors colliders by hand in the first place.

Walkable ring widths: Puck A's ring is 6.00 - 4.00 = 2.00 m, Puck B's ring is 4.00 - 2.20 = 1.80 m, Puck C is a 4.40 m disc.
The capsule is 0.70 m across, so the narrowest ring gives 1.10 m of clearance on each side of the capsule's own width.

The spur lobes are centred at radius 7.071 and have radius 1.50, so their inner edge sits at radius 5.571 against Puck A's 6.00.
They fuse into Puck A by 0.43 m and read as one four-lobed dais rather than as five separate objects.

**Core struts and node.**
Four struts, generator K5, radius 0.22, rising from radius 2.10 on Puck C at 45/135/225/315 degrees, canting inward to a collar at y = 4.60.
Each gets `CuboidCollider([0.24, 1.70, 0.24])` at radius 2.05 and y = 2.90.
The chord between adjacent strut bases is 2 x 2.10 x sin(45 deg) = 2.97 m, and after the strut thicknesses that leaves 2.53 m of clear gap, so the player walks between them freely.

The Core node is generator K6 at radius 1.15, centred at (0, 6.00, 0), bobbing +/- 0.15 on a 0.5 Hz sine and rotating at 0.25 rad/s.
No collider.

Reachability check: standing on Puck C at y = 1.20, the jump apex puts the feet at 1.20 + 1.4008 = 2.60, and the capsule is 1.40 tall, so the crown of the head reaches 4.00.
The node's underside is at 6.00 - 1.15 = 4.85.
Clearance 0.85 m, so the player never intersects it.

Around the node sits the **completion ring**: four torus arcs, major radius 2.20, tube 0.14, tilted 18 degrees off horizontal, centred at y = 6.00, each spanning 80 degrees with a 10-degree gap.
One arc per hub lesson.
An incomplete arc uses `mattePlastic(palette.lockedDeep)`; a complete one uses `emissive(palette.unlocked, 2.0)`.
This is the progression read from anywhere on the island, and it is why the node is at 6.00 rather than tucked lower.

### 1.6 The portal stack

Four pieces, all north of the Core on the x = 0 axis.

| Piece | Footprint | Top y | Collider | Collider position |
| --- | --- | --- | --- | --- |
| Bridge | puck r 2.20 at (0, 0, -4.40) | 1.60 | `CylinderCollider([0.20, 2.10])` | (0, 1.40, -4.40) |
| T1 | x in [-6, 6], z in [-6.6, -10.6] | 2.00 | `CuboidCollider([6.0, 1.00, 2.0])` | (0, 1.00, -8.60) |
| T2 | x in [-4, 4], z in [-10.6, -12.4] | 2.40 | `CuboidCollider([4.0, 1.20, 0.9])` | (0, 1.20, -11.50) |
| T3 | x in [-4, 4], z in [-12.4, -15.0] | 2.80 | `CuboidCollider([4.0, 1.40, 1.3])` | (0, 1.40, -13.70) |

The bridge spans z from -6.60 to -2.20.
Its south edge touches Puck C's north edge at z = -2.20 exactly, which is what makes the C-to-bridge riser a clean 0.40.
Its north edge touches T1's south edge at z = -6.60, which makes the bridge-to-T1 riser a clean 0.40.

T1 through T3 are solid from the lawn up, not floating slabs.
The collider half-heights above are therefore half the *full* height, and the collider centres are at half the full height, which is why they do not equal the top y.

Corner-to-island checks, all against the plateau radius of 16:

- T1 corners (+/-6, -10.6): radius 12.19. Clear.
- T2 corners (+/-4, -12.4): radius 13.03. Clear.
- T3 corners (+/-4, -15.0): radius 15.52. Clear by 0.48, which is the tightest fit in the layout.

The T3 fit is tight on purpose - the portal deck is meant to feel like it is right at the edge of the world - but the kerb depth of 0.36 must be measured *inward* from x = +/-4 and z = -15.0, not outward, or it will overhang the rim.

**Portal placement.**
`<Portal position={[0, 2.80, -14.5]} rotation={0} />`.
The arch is 0.70 deep in Z, so it occupies z from -14.15 to -14.85 and sits fully on T3, which ends at -15.0.
This is the same reasoning as the existing comment in `HubIsland.tsx` about the arch not overhanging the back edge, applied to the new deck.
Approach space in front of the arch on T3 is 1.75 m, plus the 1.80 m of T2 behind that.

**Spawn points.**
These change in `src/game/scenes/registry.ts`.

- `start: [0, 2, 11]`.
  On the lawn at the south, facing -Z toward the Core.
  Radius from origin is 11, comfortably inside the plateau.
  *Guess:* I have assumed the robot's forward is -Z at `rotation.y = 0`, which is the three.js convention and matches how `Portal` treats `rotation={0}` as facing the player who approaches from +Z.
  If the robot's forward is +Z, set the initial heading to `Math.PI` explicitly rather than moving the spawn.
- `from-cave: [3.0, 4.4, -13.0]`.
  On T3, off the centreline, at drop height.
  Distance check against `INTERACTION.exitRadius` of 3.1: the portal anchor is at (0, 2.80, -14.5) and after the 1.6 m revival drop the player's feet are at y = 2.80, giving a separation of sqrt(3.0^2 + 0^2 + 1.5^2) = 3.35 m.
  Clear by 0.25 m, which holds the existing invariant that the spawn is geometrically outside the trigger rather than relying only on the first-frame guard in `useProximity`.
  Also clear of the T3 kerb: the player centre at x = 3.0 plus the capsule radius of 0.35 reaches 3.35, and the kerb's inner face is at 4.00 - 0.36 = 3.64.

**Lesson totem positions.**
These change in `src/state/lessons.ts`, and they are the only content-file change this spec asks for.

| Lesson id | New position |
| --- | --- |
| `what-is-ai` | `[-5, 0.40, 5]` (SW spur, first thing on the left as you walk in from the spawn) |
| `what-is-an-llm` | `[5, 0.40, 5]` (SE spur) |
| `popular-models` | `[-5, 0.40, -5]` (NW spur) |
| `what-is-a-prompt` | `[5, 0.40, -5]` (NE spur) |

The reading order runs anticlockwise from the spawn, which puts the two you meet first on the near side of the Core and the two you meet last on the side facing the portal.

The plinth in `LessonTotem.tsx` shrinks from base radius 0.90 to 0.70 so that a 1.50 m lobe leaves 0.80 m of walkable lobe around it.
`INTERACTION.radius` is 2.60, so the player triggers the totem from the lawn as well as from the lobe, and standing on the lobe is a choice rather than a requirement.

---

## 2. Real height variation under a flat collider

The constraint is that Rapier will not follow a displaced mesh, so the ground stays a flat cylinder.
Every metre of elevation in this spec therefore comes from a placed piece with its own hand-authored primitive collider, and the full manifest is below.
No trimesh colliders anywhere.

### 2.1 The jump and autostep budget

From `tuning.ts`: `JUMP.velocity` 8.2, `JUMP.gravity` -24, `JUMP.fallGravityMultiplier` 1.5 (so -36 on the way down), `MOVEMENT.maxSpeed` 6.0.

Apex height = 8.2^2 / (2 x 24) = 67.24 / 48 = **1.4008 m**, reached at t = 8.2 / 24 = 0.3417 s.
Horizontal travel to apex at full speed = 2.050 m.

Landing at a relative rise h, on the way down, the fall from apex is d = 1.4008 - h and takes tau = sqrt(d / 18).

| Rise h | tau | total airtime | max horizontal at 6.0 m/s |
| --- | --- | --- | --- |
| 0.00 | 0.2790 | 0.6207 | 3.724 |
| 0.40 | 0.2358 | 0.5775 | 3.465 |
| 0.80 | 0.1826 | 0.5243 | 3.146 |
| 1.20 | 0.1055 | 0.4472 | 2.683 |
| 1.4008 | 0.0000 | 0.3417 | 2.050 |

These are theoretical maxima assuming a perfectly timed takeoff from the exact lip of a platform with full speed retained through the arc.
`MOVEMENT.airControl` is 0.35, which is enough steering to correct but not enough to add speed.

**Design budget: no optional gap exceeds 60% of the table value for its rise, and no required traversal contains a gap at all.**

Autostep: `BODY.autostepHeight` 0.50 with `autostepMinWidth` 0.20.
Every tread in this spec is at least 1.80 m, so the width condition is never the binding one.

Slopes: `BODY.minSlopeSlideAngle` is 35 degrees and `maxSlopeClimbAngle` is 50.
This layout contains no ramps at all, so nothing is close to either limit.
Should a ramp be added later, keep it at or below 20 degrees, which is where the existing portal ramp sits at 12.9.

Descent: `BODY.snapToGroundDistance` is 0.50, so walking *down* a 0.40 step is snapped rather than becoming a fall, and the player never gets a spurious airborne frame going down the Core.

### 2.2 The unjumpable test

The rule the reference states is that non-traversable geometry must be visibly taller so it reads as "not for you" at a glance.
The engineering version of that rule here is: any face that must not be climbed is at least **1.60 m** above the surface in front of it, which is 0.20 m above the jump apex.

| Face | Surface in front | Face height | Rise | Verdict |
| --- | --- | --- | --- | --- |
| T1 south face at abs(x) > 2.2 | Lawn, y = 0 | 2.00 | 2.00 | Not climbable, margin 0.60 |
| T1 east and west faces | Lawn, y = 0 | 2.00 | 2.00 | Not climbable, margin 0.60 |
| T1 face from NE/NW spur lobe | Lobe, y = 0.40 | 2.00 | 1.60 | Not climbable, margin 0.20 |
| T2 exposed faces | T1, y = 2.00 | 2.40 | 0.40 | Climbable by design |
| T2 exposed faces | Lawn, y = 0 | 2.40 | 2.40 | Not climbable |
| T3 exposed faces | Lawn, y = 0 | 2.80 | 2.80 | Not climbable |
| Bridge shoulder | Puck A, y = 0.40 | 1.60 | 1.20 | **Climbable**, see note |
| Perimeter pylons | Lawn, y = 0 | 5.20 minimum | 5.20 | Not climbable, margin 3.80 |

The bridge shoulder is the one intentional exception.
A confident player standing on Puck A at the point where the bridge overhangs it can hop 1.20 m onto the bridge and skip Pucks B and C.
That is a shortcut, not a leak: it saves about a second, it requires a deliberate jump, and it is exactly the kind of small optional skill expression the reference brief's "expression, not efficiency" framing wants.
Do not fence it.

The 0.20 m margin on the lobe-to-T1 face is the thinnest in the layout.
If in playtesting anyone lands on T1 from a spur lobe, the fix is to move the NE and NW lobes 0.4 m south rather than to raise T1, because T1's height is load-bearing for four other checks in this table.

### 2.3 Full collider manifest

Every rigid body below is `type="fixed" colliders={false}` with the colliders listed explicitly, following the existing pattern in `HubIsland.tsx`.

| # | Piece | Collider | Args | Position | Rotation |
| --- | --- | --- | --- | --- | --- |
| C1 | Plateau (unchanged) | Cylinder | `[0.5, 16]` | (0, -0.5, 0) | - |
| C2 | Core Puck A | Cylinder | `[0.20, 5.90]` | (0, 0.20, 0) | - |
| C3 | Core Puck B | Cylinder | `[0.20, 3.90]` | (0, 0.60, 0) | - |
| C4 | Core Puck C | Cylinder | `[0.20, 2.10]` | (0, 1.00, 0) | - |
| C5 | Spur lobe NE | Cylinder | `[0.20, 1.40]` | (5, 0.20, -5) | - |
| C6 | Spur lobe NW | Cylinder | `[0.20, 1.40]` | (-5, 0.20, -5) | - |
| C7 | Spur lobe SW | Cylinder | `[0.20, 1.40]` | (-5, 0.20, 5) | - |
| C8 | Spur lobe SE | Cylinder | `[0.20, 1.40]` | (5, 0.20, 5) | - |
| C9-C12 | Core struts x4 | Cuboid | `[0.24, 1.70, 0.24]` | radius 2.05, y 2.90, at 45/135/225/315 deg | yaw to face outward |
| C13 | Bridge | Cylinder | `[0.20, 2.10]` | (0, 1.40, -4.40) | - |
| C14 | T1 | Cuboid | `[6.0, 1.00, 2.0]` | (0, 1.00, -8.60) | - |
| C15 | T2 | Cuboid | `[4.0, 1.20, 0.9]` | (0, 1.20, -11.50) | - |
| C16 | T3 | Cuboid | `[4.0, 1.40, 1.3]` | (0, 1.40, -13.70) | - |
| C17 | East puck E1 | Cylinder | `[0.40, 1.00]` | (9.0, 0.40, -2.6) | - |
| C18 | East puck E2 | Cylinder | `[0.80, 1.00]` | (9.6, 0.80, -6.4) | - |
| C19 | East puck E3 | Cylinder | `[1.00, 1.00]` | (8.4, 1.00, -10.0) | - |
| C20 | West block W1 | Cuboid | `[1.60, 0.40, 1.60]` | (-9.6, 0.40, 2.4) | yaw +0.122 |
| C21 | West puck W2 | Cylinder | `[0.60, 1.20]` | (-7.6, 0.60, 1.2) | - |
| C22 | West block W3 | Cuboid | `[1.20, 0.80, 1.20]` | (-10.4, 0.80, 0.4) | yaw -0.192 |
| C23 | West puck W4 | Cylinder | `[1.00, 0.80]` | (-11.6, 1.00, 2.6) | - |
| C24 | West block W5 | Cuboid | `[1.00, 0.20, 1.00]` | (-7.8, 0.20, 3.8) | yaw +0.332 |
| C25-C32 | Perimeter pylons x8 | Cylinder | `[h/2, 0.40]` | (x, h/2, z), see 8.1 | - |
| C33+ | Deck kerbs | Cuboid | `[len/2, 0.30, 0.18]` | one per straight run, see 4.4 | yaw per run |
| - | Portal arch | unchanged | unchanged | as `Portal.tsx` authors them | - |
| - | Totem plinths x4 | Cylinder | `[0.50, 0.70]` | (+/-5, 0.90, +/-5) | - |

Overlapping fixed colliders are fine in Rapier and several of these do overlap by design, notably the spur lobes into Puck A and the bridge over Puck A.

Nothing decorative gets a collider.
Not the crystal shards, not the trace tubes, not the trace pads, not the rim buttresses, not the Core node, not the node shells.
That is the same rule `Scatter.tsx` already applies to pebbles, and for the same reason: a small thing the capsule can catch on is worse than no small thing.

### 2.4 The east jump route

An optional line from the lawn to T1 that skips the Core entirely.
Three pucks, generator K2, visual radius 1.10, solid from the lawn.

| Puck | Centre | Top y | From | Centre distance | Edge gap | Rise | Budget | Use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | (9.0, 0, -2.6) | 0.80 | Lawn | - | 0 | 0.80 | - | Standing hop |
| E2 | (9.6, 0, -6.4) | 1.60 | E1 | 3.847 | 1.647 | 0.80 | 3.146 | 52% |
| E3 | (8.4, 0, -10.0) | 2.00 | E2 | 3.795 | 1.595 | 0.40 | 3.465 | 46% |
| T1 | east face x = 6.0 | 2.00 | E3 | - | 1.300 | 0.00 | 3.724 | 35% |

Every gap is under 60% of budget, which leaves room for a mistimed takeoff.
The route gets easier as it goes, which is the right shape: the first step advertises that this is a jump route, and the last step is forgiving so a player who committed does not get punished at the end.

Clearance checks: E1 to the NE spur lobe is 4.664 m centre to centre against a combined radius of 2.60, clear.
E2 sits at radius 11.54 and E3 at radius 13.06 from the origin, both inside the pylon ring at 14.6.
E3's west edge is at x = 7.30 and the 300-degree pylon is at (7.30, -12.64), separated by 2.86 m against a combined radius of 1.45.

### 2.5 The west toy pile

The three scattered stepping blocks at (-9, 6), (-11, 3.5) and (-9.5, 1) are replaced by one tight clump centred on (-9.5, 0, 1.8).
This is the reference brief's "clumps, not confetti" applied to architecture rather than to props, and it is where the jump, the coyote time and the autostep get tested without leaving the hub.

| Piece | Generator | Size | Position | Top y | Yaw |
| --- | --- | --- | --- | --- | --- |
| W1 | K1 slab | 3.2 x 0.80 x 3.2 | (-9.6, 0.40, 2.4) | 0.80 | +7 deg |
| W2 | K2 puck | r 1.30, h 1.20 | (-7.6, 0.60, 1.2) | 1.20 | - |
| W3 | K1 slab | 2.4 x 1.60 x 2.4 | (-10.4, 0.80, 0.4) | 1.60 | -11 deg |
| W4 | K2 puck | r 0.90, h 2.00 | (-11.6, 1.00, 2.6) | 2.00 | - |
| W5 | K1 slab | 2.0 x 0.40 x 2.0 | (-7.8, 0.20, 3.8) | 0.40 | +19 deg |

Every level of the world is represented in one five-metre clump: 0.40, 0.80, 1.20, 1.60, 2.00.
The yaw offsets are small and deliberately not multiples of each other, because a stack of blocks at the same angle reads as a staircase and a stack at jostled angles reads as a pile someone dropped.

Gaps between adjacent pieces range from 0.4 to 1.2 m against a budget of at least 2.68, so nothing here is difficult.
That is correct: it is a playground, not a challenge.
The furthest piece W4 sits at radius 11.89, inside the pylon ring.

---

## 3. The greyscale readability test

### 3.1 The measurement procedure

This is not a matter of taste and it should not be argued about in a review.
The procedure is:

1. Take a screenshot at the default framing from the `start` spawn, and a second from the top of Puck C looking north at the portal.
2. Convert to greyscale using Rec.709 luma on the sRGB-encoded values: `Y = 0.2126 R + 0.7152 G + 0.0722 B`.
3. Sample the flat interior of each surface class, not its edges or its highlights.
4. Compare against the bands below.

A hex code's luma is a *starting point*, not the answer.
Under this rig - `directionalLight` 1.3 warm key, `hemisphereLight` 0.5, two fills at 0.25 and 0.45, ACES tone mapping - an up-facing diffuse surface typically renders 0.04 to 0.08 *below* its albedo luma, and a vertical player-facing surface renders considerably darker than that.
So aim the albedo at the top of its band and then measure.

*Guess:* the 0.04 to 0.08 figure is my estimate from the light budget described in `Lighting.tsx` and `README.md`, not a measurement. Measure it once and then the rest of this table can be trusted.

### 3.2 The bands

| Band | Rendered luma | Chroma | What is in it |
| --- | --- | --- | --- |
| Character | 0.86 - 0.95 | near zero | The robot shell |
| **Band 1, gameplay** | **0.56 - 0.74** | full | Lawn, deck tops, deck sides, Core, all walkable surfaces |
| **Band 2, midground** | **0.20 - 0.38** | -25% saturation | Pylons, kerbs, struts, rim, buttresses, trace arcs |
| **Band 3, background** | **0.76 - 0.86** albedo, 0.82 - 0.88 after fog | -55% saturation, hue pulled toward `skyHorizon` | Everything off the island |
| Sky zenith | 0.60 | mid | `palette.skyTop` |
| Sky horizon | 0.90 | low | `palette.skyHorizon` |

Gap from band 2 to band 1: 0.18.
Gap from band 1 to band 3: 0.02 in albedo, widening to about 0.08 once fog is applied to band 3.
These are the two gaps that make a desaturated frame legible.

**The one accepted overlap** is the character against band 3, at 0.86-0.95 against a fogged 0.82-0.88.
The mitigation is structural rather than tonal: the perimeter pylon ring at band 2 sits between the play space and the background across the entire northern and lateral horizon, so the character silhouettes against a dark object, not against the sky.
The gap in the pylon ring is in the south, which is the direction the follow camera looks *over* rather than *at*.
Known limit: `CAMERA.minPitch` is -0.5 rad, so a player who deliberately drives the camera to its lowest pitch while walking south can put the character against sky. That is a two-input deliberate act and I am accepting it.

### 3.3 Concrete albedo values

The luma figures are Rec.709 on the sRGB hex.

| Surface | Band | Current | Current luma | New | New luma |
| --- | --- | --- | --- | --- | --- |
| Deck and puck tops | 1 | `palette.rock` `#d5d9e0` | 0.850 | `#b6bcc7` | 0.735 |
| Deck and puck side faces | 1 | (same as top) | 0.850 | `#8f97a5` | 0.589 |
| Lawn base colour | 1 | `palette.grass` `#8fd94a` | 0.749 | `#7dc244` | 0.668 |
| Blade tips | 1 | `palette.grassTip` `#c2ea6e` | 0.849 | `#86c04e` | 0.672 |
| Blade roots / deep foliage | 1-2 | `palette.grassDeep` `#4f9b2e` | 0.514 | `#3f7a26` | 0.405 |
| Ground texture base | 1 | grass lerped 0.34 to white | ~0.83 | grass lerped **0.12** to white | ~0.71 |
| Kerbs and trim | 2 | - | - | `#4b5568` | 0.330 |
| Pylons, struts, buttresses | 2 | - | - | `#3c465a` | 0.272 |
| Island rim / cliff | 2 | `palette.soil` `#b98a5e` | 0.568 | `#6b4d31` | 0.319 |
| Island underside cone | 2 | `palette.soilDeep` `#7d5738` | 0.364 | `#452f1c` | 0.197 |
| Background sub-islands | 3 | - | - | `#c9d9e8` | 0.842 |
| Background monoliths | 3 | - | - | `#aec4d8` | 0.756 |
| Robot shell | char | `palette.shell` `#f4f1ea` | 0.946 | unchanged | 0.946 |

The two most consequential changes in that table are the rock and the soil.

Dropping `rock` from 0.850 to 0.735 is what puts daylight between the walkable stone and the character at 0.946.
Right now the deck and the robot are 0.10 apart in luma and the robot has to survive on hue alone, which is exactly what the reference calls out as the thing the value-anomaly rule exists to prevent.

Dropping `soil` from 0.568 to 0.319 moves the island's cliff face out of band 1 and into band 2.
As it stands, the rim of the island is the same value as the lawn on top of it, which is why the island currently has no visible thickness in a greyscale frame despite having a metre of rim geometry.

**Keep the semantic hues constant**, per the reference: `palette.locked` and `lockedDeep` stay where they are, `palette.unlocked` gold stays, `palette.visor` cyan stays, and the token pink stays.
Those four are the game's vocabulary and they are allowed to sit outside the band system because they are always small in screen area.

### 3.4 Chroma tiering

Saturation is a separate axis from value and it must be tiered independently, per the reference.

- Band 1 and the character: full chroma as authored.
- Band 2: multiply saturation by 0.75.
- Band 3: multiply saturation by 0.45 *and* lerp the result 25% toward `palette.skyHorizon` before fog does the rest.

Implement this as a helper in `palette.ts` rather than by hand-picking desaturated hexes, so that a later palette change propagates:

```ts
export function band(hex: string, tier: 1 | 2 | 3): string
```

That keeps the band discipline enforceable rather than aspirational.

---

## 4. The modular toy block kit

### 4.1 Why generators rather than instanced meshes

The reference's rule is a kit of at most twelve unique meshes, and the stated reason is both artistic (a small shape vocabulary) and technical (aggressive instancing).

For this level, the technical half of that is better served by **merging than by instancing**, and it is worth saying why so nobody "optimises" it back.

A rounded box scaled non-uniformly gets an elliptical fillet.
T1 is 12 x 2.0 x 4.0 and would need a scale of (3, 5, 1) on a 4 x 0.4 x 4 base, which turns a 0.12 fillet into a 0.36 x 0.60 x 0.12 fillet.
That is visible, and "never a 90-degree hard corner, every edge takes a bevel that catches the key as a bright line" is a world rule here, so a wrong bevel is not a cosmetic issue.

The architecture is static.
So: author each module as a **parameterised geometry generator**, call it once per placement at mount, and merge every result that shares a material into a single `BufferGeometry` with `mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils`.
Correct bevels everywhere, one draw call per material for the entire built environment.

Instancing is still the right tool for the repeated small stuff - pylons, crystal shards, trace pads, buttress fins - because those are numerous, identical and uniformly scaled.

### 4.2 The eleven generators

Grid: **XZ on 2.0 m, Y on 0.40 m.**
Pucks and anything on the Core sit on a polar sub-grid instead: radius free, angle on 45-degree steps.
Every generator returns geometry whose origin is at the centre of its footprint on its base plane, so a piece placed at (x, y, z) has its bottom at y.

| # | Module | Signature | Built from | Batch | Collider |
| --- | --- | --- | --- | --- | --- |
| K1 | Slab | `slab(w, h, d, bevel = 0.12)` | bevelled box, uniform fillet | `deckBatch` | 1 Cuboid |
| K2 | Puck | `puck(r, h, rim = 0.10)` | `LatheGeometry`, 32 radial, rounded top rim, 3-degree draft on the side | `deckBatch` or `dressBatch` | 1 Cylinder at r - 0.10 |
| K3 | Kerb | `kerb(len, h = 0.60, d = 0.36)` | bevelled box with 4-degree outward draft | `trimBatch` | 1 Cuboid per run |
| K4 | Wedge | `wedge(run, rise, width)` | bevelled trapezoidal prism | `deckBatch` | 1 rotated Cuboid |
| K5 | Pill | `pill(r, len)` | `CapsuleGeometry(r, len, 4, 12)` | `pillMesh`, instanced | optional Cylinder |
| K6 | Node core | `nodeCore(r)` | `IcosahedronGeometry(r, 2)` | `nodeMesh`, instanced | none |
| K7 | Node shell | `nodeShell(r)` | `IcosahedronGeometry(r, 1)`, flat shaded, opacity 0.20, `depthWrite` false | `shellMesh`, instanced | none |
| K8 | Trace tube | `trace(points, r = 0.09)` | `TubeGeometry` on a `CatmullRomCurve3`, 6 radial | `traceBatch` | none |
| K9 | Pad | `pad(r = 0.45)` | K2 at h = 0.10 | `padMesh`, instanced | none |
| K10 | Shard | `shard(h, topR = 0.05, botR = 0.22)` | 6-sided tapered prism with a pyramid cap | `shardMesh`, instanced | none |
| K11 | Fin | `fin(w, h, d)` | bevelled box with 8-degree draft on both faces | `finMesh`, instanced | none |

Eleven generators.
Everything in this document is one of them, one of them scaled, or the existing `Portal` and `LessonTotem` components.

K4 the wedge is unused in the final layout, because the route is all autostep.
Keep the generator anyway - the cave and every future scene will want it, and it costs nothing to have.

### 4.3 How they connect

Three rules, and they are enough.

**Stacking.** A piece placed with its base at level L_n and height 0.40 produces a new surface at L_n+1. Because every level is 0.40 apart and autostep is 0.50, any stack of K1 or K2 pieces is automatically walkable from the ground up. This is the whole reason the Y-grid is 0.40.

**Abutting.** Two pieces at the same top height whose footprints touch or overlap read as one surface and produce no seam the capsule can catch, because their colliders are separate boxes with coplanar tops. Overlap by at least 0.10 m rather than aiming for exact tangency, so that a floating-point near-miss cannot open a crack.

**Trimming.** Any exposed vertical face of a K1 or K2 piece takes a K3 kerb along its top edge, inset 0.18 m from the face so the kerb's outer plane is flush with the piece below it. A kerb is band 2 and the piece is band 1, so the kerb also draws the platform's outline as a dark line, which is what makes a raised deck read as raised in a greyscale frame.

### 4.4 Kerb runs

Kerbs go on every exposed deck edge except the faces that are part of the route.

| Deck | Kerb runs | Left open |
| --- | --- | --- |
| T1 | south x in [-6,-2.2] and [2.2,6]; east x = 6; west x = -6; north x in [-6,-4] and [4,6] | south x in [-2.2, 2.2] (the bridge mouth) and north x in [-4, 4] (up to T2) |
| T2 | east x = 4; west x = -4 | south (from T1) and north (to T3) |
| T3 | east x = 4; west x = -4; north z = -15.0 | south (from T2) |
| Bridge | none | it is a bridge |
| Core pucks | none | walked on from every direction |

Ten runs, ten `CuboidCollider`s, all in one `trimBatch` draw call.
Kerbs render at every quality tier.
A kerb with a collider and no mesh is an invisible wall, which is worse than no kerb, so this is never gated.

---

## 5. Prop clustering

### 5.1 The sampler needs two small additions

`clusteredPlacements` in `src/art/placement.ts` is the right function and the grass and flowers already use it correctly.
Two things stop it from being usable for the clustering this section needs, and both are small.

**Cluster centres are sampled over the whole disc, so `minRadius` silently thins the result.**
Today the function samples centres with `Math.sqrt(rand()) * radius` and then rejects individual *members* that fall outside `[minRadius, radius]`.
Ask for boulder clumps between radius 10 and 13.5 and most cluster centres land in the middle of the island, every one of their members gets rejected, and the returned count is far below what was requested and varies with the seed.

Fix, in `ClusterOptions`:

```ts
/** Sample cluster centres in an annulus rather than over the whole disc. */
centreMinRadius?: number
centreMaxRadius?: number
```

and in the centre loop, replacing the `sqrt` line:

```ts
const rMin = centreMinRadius ?? 0
const rMax = centreMaxRadius ?? radius
const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin))
```

That form is uniform per unit area within the annulus, which is the same property the existing `sqrt` has for a full disc.

**Layers cannot share cluster centres.**
Pebbles should pool *around* boulders, not be sprinkled independently, and the file's own doc comment already makes this argument for the three ground-cover layers.

Fix: export the centre generation and accept it back.

```ts
export function clusterCentres(opts: {
  clusters: number
  radius: number
  centreMinRadius?: number
  centreMaxRadius?: number
  seed: number
}): [number, number][]

// and in ClusterOptions:
/** Reuse centres from another layer instead of sampling new ones. */
centres?: [number, number][]
```

**A third addition, optional but strongly recommended.**
`Exclusion` is circles only, and this layout has rectangular decks.
Clearing T1, which is 12 x 4, with a circle needs radius 7.0 and therefore also clears 3 m of lawn at the corners that did not need clearing.

```ts
export type Exclusion =
  | { x: number; z: number; radius: number }
  | { x: number; z: number; halfX: number; halfZ: number; rotation?: number }
```

with `isBlocked` switching on the presence of `radius`.
Without it, use the circles in 5.3 and accept the over-clearing; it is a cosmetic loss, not a bug.

### 5.2 Cluster specification

Replace every `evenPlacements` call in `Scatter.tsx`.
`density` is `quality.propDensity` as today.

**Boulder clumps.** Six clumps, roughly five boulders each, at the perimeter.

```ts
const boulderCentres = clusterCentres({
  clusters: 6, radius: 14.5, centreMinRadius: 10.0, centreMaxRadius: 13.5, seed: 5,
})

clusteredPlacements({
  count: Math.round(30 * density),
  radius: 14.5, minRadius: 9.0,
  centres: boulderCentres,
  clusterRadius: 1.6,
  exclusions: HUB_EXCLUSIONS,
  seed: 5,
  minScale: 0.45, maxScale: 1.6,
})
```

`clusterRadius` 1.6 against a boulder base scale of 0.5 is what makes this a clump rather than a loose group: five boulders averaging 0.6 m across inside a 3.2 m circle are touching each other.
The wide scale range of 0.45 to 1.6 matters as much as the tight radius, because a clump of same-sized rocks reads as a pattern and a clump of one big rock with four small ones reads as a rock that broke.

**Pebble skirts.** Reuse the boulder centres so the pebbles pool around the boulders.

```ts
clusteredPlacements({
  count: Math.round(90 * density),
  radius: 15.0, minRadius: 8.5,
  centres: boulderCentres,
  clusterRadius: 2.6,
  exclusions: HUB_EXCLUSIONS,
  seed: 17,
  minScale: 0.5, maxScale: 1.3,
})
```

`clusterRadius` 2.6 against the boulders' 1.6 gives a debris halo one metre wider than the clump it came from, which is what makes the pair read as one event.

**Clover patches.** Nine patches, independent centres, allowed further in toward the Core than the boulders.

```ts
clusteredPlacements({
  count: Math.round(300 * density),
  radius: 15.0, minRadius: 6.4,
  clusters: 9, clusterRadius: 2.4,
  centreMinRadius: 6.5, centreMaxRadius: 14.0,
  exclusions: HUB_EXCLUSIONS,
  seed: 23,
  minScale: 0.7, maxScale: 1.4,
})
```

**Delete the flower layer from `Scatter.tsx` entirely.**
`Scatter` currently grows 90 stem-and-dome flowers on top of the 14,000 proper daisies that `Flowers.tsx` already places from the same sampler.
Two flower systems is one too many, it costs three draw calls, and the simpler one is strictly worse.
Raise `quality.flowers` by 300 at each tier if the loss is noticeable, which I do not expect it to be.

**Crystal groves are hand-placed, not sampled.**
Six of them, listed in section 7.
They are set dressing with compositional intent - two of them exist to fill the dead corner behind T2 and one exists to break the west rim silhouette - and a sampler cannot be asked to have intent.

### 5.3 The exclusion list

`GRASS_EXCLUSIONS` in `HubIsland.tsx` is rebuilt from scratch.
It is shared by grass, flowers and scatter, exactly as today.
Radii are deliberately generous: a blade growing through a deck is far more noticeable than a bare centimetre beside one.

```ts
const HUB_EXCLUSIONS: Exclusion[] = [
  // The Core and its four spur lobes, as one generous circle plus four smaller.
  { x: 0, z: 0, radius: 6.6 },
  { x: 5, z: -5, radius: 2.1 },
  { x: -5, z: -5, radius: 2.1 },
  { x: -5, z: 5, radius: 2.1 },
  { x: 5, z: 5, radius: 2.1 },

  // Bridge.
  { x: 0, z: -4.4, radius: 2.8 },

  // Portal stack. Circles over rectangles, so these over-clear at the corners.
  { x: 0, z: -8.6, radius: 7.0 },
  { x: 0, z: -11.5, radius: 4.6 },
  { x: 0, z: -13.7, radius: 4.6 },

  // East jump route.
  { x: 9.0, z: -2.6, radius: 1.7 },
  { x: 9.6, z: -6.4, radius: 1.7 },
  { x: 8.4, z: -10.0, radius: 1.7 },

  // West toy pile, as one circle over the whole clump.
  { x: -9.5, z: 1.8, radius: 3.6 },

  // Eight pylon feet, at radius 14.6. See 8.1 for the angles.
  ...PYLON_ANGLES.map((a) => ({
    x: Math.cos(a) * 14.6, z: Math.sin(a) * 14.6, radius: 0.9,
  })),

  // Six crystal groves. See 7.3.
  ...CRYSTAL_GROVES.map((g) => ({ x: g.x, z: g.z, radius: g.radius + 0.4 })),
]
```

Derive nothing here automatically.
The existing comment in `HubIsland.tsx` makes the right argument: these are authored positions, and a mismatch should be a visible bug in review rather than something that silently drifts when a coordinate changes.

---

## 6. Camera FOV

### 6.1 The recommendation

**FOV 40. `CAMERA.distance` 10.7. `CAMERA.height` 4.3.**

### 6.2 The trigonometry

The apparent vertical size of an object of height H at slant range D, as a fraction of the viewport height, is

```
f = H / (2 D tan(fov / 2))
```

To hold `f` constant while changing `fov`, the product `D tan(fov / 2)` must be constant.

The follow camera in `FollowCamera.tsx` places the eye at `lookAt + offset`, where at the rest pitch of zero the offset is `(sin(yaw) * distance, height, cos(yaw) * distance)`.
So the slant range at rest is

```
D = hypot(CAMERA.distance, CAMERA.height)
```

Current:

```
D0 = hypot(7.5, 3.0) = 8.0777
tan(55 / 2) = tan(27.5 deg) = 0.520567
D0 * tan(fov0 / 2) = 4.2045          <- the invariant
```

New:

```
tan(40 / 2) = tan(20 deg) = 0.363970
D1 = 4.2045 / 0.363970 = 11.5518
k  = D1 / D0 = 1.43004
```

The rest pitch is `atan(height / distance)` and should not change, because the downward look angle is a separate art decision from the focal length.
Holding the pitch fixed while scaling the slant range means scaling both components by the same `k`:

```
CAMERA.distance = 7.5 * 1.43004 = 10.725  ->  10.7
CAMERA.height   = 3.0 * 1.43004 = 4.290   ->   4.3
```

Verification:

```
hypot(10.7, 4.3) = 11.5313
11.5313 * tan(20 deg) = 4.1970    vs   4.2045     error 0.2%
atan(4.3 / 10.7) = 21.90 deg      vs   atan(3.0 / 7.5) = 21.80 deg
```

The character occupies the same fraction of the frame to within 0.2%, and the camera looks down 0.1 degrees more steeply.

### 6.3 What actually changes

The width of the world visible *at the character's depth* is also unchanged, for the same reason:

```
old: 2 * 8.0777 * tan(27.5) * (16/9) = 14.95 m
new: 2 * 11.5313 * tan(20)  * (16/9) = 14.92 m
```

What changes is perspective compression behind the character, which is the entire point.
An object 20 m behind the character renders at this fraction of its size at the character's depth:

```
old: 8.0777 / 28.0777 = 0.288
new: 11.5313 / 31.5313 = 0.366
```

Background objects come in **27% larger** relative to the character.
That is the diorama read: the far layers stop shrinking into irrelevance and start reading as a stage set at a known distance.
It is also why the background specification in section 8 can afford to be cheap - at FOV 40 those objects carry real screen area, so a small number of large simple shapes does the job.

### 6.4 Required follow-on changes

**The cave regresses and must be handled.**
`CaveScene` walls are at z = +/-12 and the `entrance` spawn is at (0, 2, 3).
At the new rest distance the camera wants to sit at z = 3 + 10.7 = 13.7, which is outside the room, so the collision pull-in fires on the first frame and stays engaged.
The existing comment in `registry.ts` about the spawn depth was written against a distance of 7.5 and no longer holds.

Recommended fix now: add a per-scene multiplier to `SceneDefinition`.

```ts
/** Multiplier on CAMERA.distance and CAMERA.height for this scene. */
cameraScale: number   // hub: 1.0, cave: 0.62
```

`FollowCamera` multiplies both `CAMERA.distance` and `CAMERA.height` by it, which preserves the rest pitch per scene while letting an interior sit closer.
At 0.62 the cave camera is 6.63 back and 2.66 up, which fits inside a room of half-depth 12 with the spawn at z = 3.

Better fix later: enlarge the cave to half-depth 20 and move `entrance` to (0, 2, 6), then set `cameraScale` back to 1.0.
That is a scene rework and out of scope for this document, but it is the correct answer and the field should exist so the choice can be made per scene rather than globally.

**`CAMERA.pullOutSpeed` should go from 4 to 5.**
The pull-in now has 11.5 m to travel back out instead of 8.1, and at the old rate the recovery reads as sluggish.

**`REVIVAL.dropHeight`'s doc comment goes stale.**
It computes "about 50 pixels" from fov 55, distance 7.5 and a 1080-tall viewport.
At fov 40 and slant 11.53 the figure is `2 * 11.53 * tan(20) / 1080 = 0.00778` world units per pixel, so 50 px is 0.389 rather than 0.36.
The `dropHeight` value of 1.6 is unaffected because it was chosen on feel, but the comment's arithmetic should be corrected or it will mislead the next person who reads it.

**`CAMERA.minDistance` 1.6 and `collisionPadding` 0.4 need no change.**

**Untested, flag for the render pass:** depth of field and bloom were tuned at FOV 55. A narrower FOV concentrates the far field, so far-field DOF will read stronger for the same parameters. Expect to reduce the DOF strength rather than to increase it.

### 6.5 The lead-distance check

The reference gives one hard number: the player needs about one second of visibility on an obstacle before reacting, so `leadDistance = maxSpeed * 1.0 = 6.0 m`.

At the new framing the camera eye is 5.3 m above the player's feet and 10.7 m behind, looking down 21.9 degrees, with a vertical half-angle of 20 degrees.
The frustum's lower edge therefore leaves the camera at 1.9 degrees below horizontal and meets the ground plane at 5.3 / tan(1.9 deg) = 160 m, which is past the fog.
The upper edge leaves at 41.9 degrees below horizontal and meets the ground 5.9 m from the camera, which is 4.8 m *behind* the player.

Ground is visible from 4.8 m behind the player to effectively the horizon.
The 6 m lead requirement is met with an enormous margin, and in this layout it is never the binding constraint anyway because nothing moves.

---

## 7. The AI-motif vocabulary

### 7.1 The rule that makes it a designed world

Right now the island has an assortment of AI-themed objects: a cone crystal here, a ball-on-a-stick there, a stripe on the floor.
They share a theme but not a *grammar*, and a shared grammar is what separates a designed world from a prop collection.

The grammar is three sentences long.

**A node is always the same object at a different scale.**
Core, inside a shell, on a mast, with a collar where the mast meets the shell.
Never a bare ball on a bare stick.
Three sizes exist and no others:

| Name | Core radius (K6) | Shell radius (K7) | Mast (K5) | Collar (K2) | Where |
| --- | --- | --- | --- | --- | --- |
| Hero | 1.15 | 1.55 | four struts to a collar at y 4.60 | r 1.30, h 0.30 | The Core, one only |
| Totem | 0.38 | 0.51 | none, it floats | ring at y 0.98 (existing) | Four lesson totems |
| Marker | 0.26 | 0.35 | pill r 0.34, 5.2-7.8 tall | r 0.62, h 0.30 | Eight perimeter pylons |

The ratio of shell to core is 1.35 in all three, and the ratio of hero to marker is 4.42.
That constancy is what makes the pylons work as a depth ruler: the reference's rule about communicating depth by repeating identical shapes at identical sizes in a row only works if the shapes really are identical.

The shell is what stops a node reading as a ball.
`IcosahedronGeometry(r, 1)` with `flatShading: true`, `transparent: true`, `opacity: 0.20`, `depthWrite: false`, using `plastic(palette.nodeGlow)`.
It costs one instanced draw call for every node in the scene and it is the single detail that makes these read as manufactured objects with an inner and an outer part.

Delete `NodeSculpture` from `HubIsland.tsx`.
Its `cylinderGeometry(0.18, 0.22, 2.8, 10)` mast is a hard-edged cylinder with a visible ten-sided silhouette and no bevel, which is the shape language the reference explicitly excludes.

**A trace is always a tube, never a plane.**
Covered in 7.2.

**A crystal is always a grove, never a specimen.**
Covered in 7.3.

### 7.2 Circuit traces as tubes

Delete the three `planeGeometry` strips.
A flat 0.22 x 6 plane at y = 0.02 with `opacity 0.75` is a decal, and a decal on the ground contributes no silhouette, catches no light, and disappears entirely at a grazing angle - which is the angle it is seen at almost all the time.

Replace with K8 tubes.
The rule that keeps them safe is a height rule, and it is absolute:

> **A trace segment is either at or below 0.12 m above the surface beneath it, or at or above 3.00 m above it. Never between.**

Below 0.12 the capsule steps over it without noticing and it has no collider anyway.
Above 3.00 it clears the capsule's 1.40 m height plus the 1.40 m jump apex plus margin, so the player passes under it.
Anything in between would visually intersect the character, which is what makes a decorative object read as a bug.

**The four totem spurs.**
One canonical polyline, rotated 90/180/270 degrees about Y for the other three.
Tube radius 0.09, 6 radial segments.
Written for the NE spur, running inward from the totem at (5, 0.40, -5) to a terminating pad on Puck C.

| Point | Position | Radius from origin | Surface beneath | Height above it |
| --- | --- | --- | --- | --- |
| p0 | (4.60, 0.52, -4.60) | 6.51 | Spur lobe, 0.40 | 0.12 |
| p1 | (4.10, 0.52, -4.10) | 5.80 | Puck A, 0.40 | 0.12 |
| p2 | (3.10, 0.52, -3.10) | 4.38 | Puck A, 0.40 | 0.12 |
| p3 | (2.83, 0.92, -2.83) | 4.00 | Puck B lip, 0.80 | 0.12 |
| p4 | (2.05, 0.92, -2.05) | 2.90 | Puck B, 0.80 | 0.12 |
| p5 | (1.56, 1.32, -1.56) | 2.20 | Puck C lip, 1.20 | 0.12 |
| p6 | (0.85, 1.32, -0.85) | 1.20 | Puck C, 1.20 | 0.12 |

A `CatmullRomCurve3` through these will round the two step transitions into short vertical arcs, which is precisely the read wanted: a wire that climbs a step rather than a line painted onto one.
Terminate at a K9 pad of radius 0.45 at p6.

**The north trunk.**
Thicker - radius 0.14 rather than 0.09 - because it is the main path made visible and the player needs to be able to tell it from the spurs at a glance.
It runs down the exact centreline of the route.

```
(0, 1.32,  -1.00)   Puck C, from the junction pad
(0, 1.32,  -2.00)   Puck C
(0, 1.72,  -2.60)   bridge lip
(0, 1.72,  -5.80)   bridge
(0, 2.12,  -6.80)   T1 lip
(0, 2.12, -10.00)   T1
(0, 2.52, -11.00)   T2 lip
(0, 2.52, -12.00)   T2
(0, 2.92, -12.80)   T3 lip
(0, 2.92, -14.10)   T3, terminating at a threshold pad in front of the arch
```

Follow the thick wire and you reach the gate.
That single sentence is the answer to the reference's "make the main path unmistakable", expressed in the world's own vocabulary rather than with an arrow.

Trunk material by progression state, which gives the hub a second reading of progress on a surface the player is already walking along:

- 0 complete: `mattePlastic(palette.lockedDeep)`, dark, clearly a thing that could light up.
- 1 to 3 complete: `emissive(palette.circuit, 0.4 + 0.25 * n)`.
- 4 complete: `emissive(palette.circuit, 1.4)` with a travelling pulse - a 1.5 m bright band moving from the Core to the portal at 3 m/s, implemented as a uv-scrolling emissive mask on the tube's V coordinate, which `TubeGeometry` already parameterises along the curve.

**The overhead arcs.**
Three catenary tubes spanning between pylon caps, radius 0.10, apex 8.2 to 8.6 m, in band 2 rather than emissive.

- Arc A: pylon at 30 degrees to pylon at 0 degrees, apex 8.2
- Arc B: pylon at 210 degrees to pylon at 240 degrees, apex 8.6
- Arc C: pylon at 300 degrees to pylon at 330 degrees, apex 8.4

These are the strongest framing element in the scene.
They put dark curves across the top of frame at the edges, which is what turns the view from "an island" into "a diorama in a box", and they read as the network the nodes belong to.
Keep them dark.
An emissive arc across the top of frame would compete with the Core node for the eye, and the Core node has to win.

### 7.3 Token crystals as groves

Delete `TokenCrystal` from `HubIsland.tsx` and its six single placements.
A lone six-sided cone with a smaller cone leaning on it does not read as a plant; it reads as a cone.

A grove is five to nine K10 shards sharing one K9 pad of radius 0.60, heights ranging 0.5 to 2.2 within a grove, each tilted 5 to 20 degrees outward from the grove centre with a random yaw.
The tilt is what makes it read as growth: vertical shards read as a fence, and shards splaying outward from a common root read as a crystal that grew.

| Grove | Centre | Shards (high tier) | Grove radius | Job in the composition |
| --- | --- | --- | --- | --- |
| G1 | (-3.2, 0, 9.4) | 7 | 1.4 | Left foreground from the spawn, gives the establishing shot a near layer |
| G2 | (3.6, 0, 10.2) | 5 | 1.1 | Right foreground, deliberately smaller than G1 so the pair is asymmetric |
| G3 | (-11.2, 0, -3.4) | 9 | 1.8 | The biggest, breaking the west rim silhouette |
| G4 | (11.8, 0, 4.6) | 6 | 1.3 | East rim, balances G3 without matching it |
| G5 | (-6.4, 0, -11.6) | 6 | 1.3 | Fills the dead corner between T1's west end and the rim |
| G6 | (12.6, 0, -6.0) | 5 | 1.1 | Fills the gap between the east jump route and the rim |

Shard counts scale with `quality.propDensity` and grove count is tier-gated in section 10.

**Material change, and it matters for performance.**
The existing `TokenCrystal` uses `emissive(palette.token, 0.9)` with `transparent` and `opacity 0.9`, which is fine.
Do *not* reach for the `gel` preset here.
`gel` sets `transmission: 0.6`, and transmission costs an extra render target per material in three.js.
Use `emissive(palette.token, 0.7)` with `transparent: true, opacity: 0.88` for all shards, and reserve `gel` for the four lesson totem nodes, which is four objects and one material.

Crystals are emissive, so they sit outside the value band system on purpose - they are the reward palette, the same way Astro's coins are.
The discipline that keeps that from wrecking the greyscale test is area, not value: **total shard silhouette must stay under 2% of the frame from the spawn view.** At the sizes above it lands around 0.8%.

---

## 8. Background and skyline

The island floats in sky and the middle distance is currently empty, which is why the frame reads as a model on a table rather than as a place.

Two layers, both off-island, both cheap, both unmistakably unreachable.

### 8.1 The perimeter pylon ring, which is the near frame

Strictly this is band 2 and on-island, but it belongs in this section because its job is horizon, not decoration.

Eight pylons at radius 14.6, on 30-degree slots with five omitted.

```ts
const PYLON_ANGLES = [0, 30, 150, 180, 210, 240, 300, 330].map(d => d * Math.PI / 180)
const PYLON_HEIGHTS = [7.8, 5.6, 6.4, 7.2, 5.2, 6.8, 7.6, 6.0]
```

| Angle | Position | Height |
| --- | --- | --- |
| 0 | (14.60, 0, 0) | 7.8 |
| 30 | (12.64, 0, 7.30) | 5.6 |
| 150 | (-12.64, 0, 7.30) | 6.4 |
| 180 | (-14.60, 0, 0) | 7.2 |
| 210 | (-12.64, 0, -7.30) | 5.2 |
| 240 | (-7.30, 0, -12.64) | 6.8 |
| 300 | (7.30, 0, -12.64) | 7.6 |
| 330 | (12.64, 0, -7.30) | 6.0 |

The 60, 90 and 120-degree slots are omitted, which opens a 90-degree window in the south facing the spawn so the establishing shot has an unobstructed view down the island.
The 270-degree slot is omitted because it would stand at (0, 0, -14.6), inside T3.
That omission is doing double duty: it gives the portal an uninterrupted sightline out of the world, which is the right treatment for a gate.

Each pylon is a K5 pill of radius 0.34 and the listed height, a K2 cap of radius 0.62 and height 0.30 at the top, and a marker node (K6 at 0.26 inside K7 at 0.35) 0.40 above the cap.
Collider `CylinderCollider([h/2, 0.40])` at (x, h/2, z).

The heights are deliberately not monotonic and not symmetric.
A ring of equal-height posts is a fence; a ring of varied posts is a skyline.
But they are all *the same object*, which is what preserves the depth ruler.

Unreachable by a wide margin: the shortest is 5.20 against a jump apex of 1.4008.

### 8.2 Layer B1, floating sub-islands at 55 to 75 m

Five of them, at high tier.
Each is a squashed cone (the underside) plus a K2 puck cap (the top), plus two or three pylons standing on it reusing the K5, K2 and K6 instanced meshes from the ring.

| # | Centre | Cap radius | Cap y | Cone depth |
| --- | --- | --- | --- | --- |
| B1a | (-48, -11, -34) | 9 | -11 | 14 |
| B1b | (26, -16, -62) | 12 | -16 | 20 |
| B1c | (61, -9, 18) | 7 | -9 | 11 |
| B1d | (-31, -22, 55) | 14 | -22 | 24 |
| B1e | (14, -13, 68) | 8 | -13 | 12 |

Distances from the origin: 58.8, 67.2, 63.6, 63.2, 69.4 m.
All beyond 55, so there is at least 39 m of empty sky between the island rim and the nearest of them.

**Every one of them sits below y = 0**, at -9 to -22.
That is the strongest possible "not reachable" cue and it costs nothing: you are looking *down* onto their tops from an island that floats above them.
An object you look down on from across a void does not invite a jump the way an object at your own eye level does.

`castShadow={false}` and `receiveShadow={false}` on all of them, per the reference's note that background layers frequently cast no shadow at all, which flattens them and pushes them back.
They are outside the shadow camera's +/-18 frustum anyway, so this costs nothing and prevents a later frustum change from accidentally pulling them in.

### 8.3 Layer B2, the monolith arc at 95 to 130 m

The far layer, and the one that actually fills the horizon.
A broken arc of tall vertical slabs spanning the northern 180 degrees, silhouetting behind the portal.

Thirteen slabs at high tier, each a K1 slab with an extreme aspect ratio, on an arc of radius 95 to 130 with the radius jittered per slab so the arc has depth rather than being a wall.

| Property | Range |
| --- | --- |
| Radius from origin | 95 to 130, jittered |
| Angle | 180 to 360 degrees, roughly even with jitter, plus two strays at 20 and 160 |
| Width | 8 to 20 m |
| Height | 25 to 60 m |
| Base y | -35 to -18 (they rise from below the cloud line) |
| Top y | -5 to +25 |

The reason they rise from below rather than standing on anything is that it removes the question of what they are standing on.
The bottoms disappear into fog and the tops are what read.

These are the "rest of the network": server monoliths, the same die the player is standing on, at a scale that makes the island read as one chip among many.
That is the thematic payoff of the whole environment concept and it is worth the two draw calls it costs.

Cost: one merged geometry for all slabs plus one for a darker cap band across their tops.
No shadows, no receive.

### 8.4 Fog

`App.tsx` currently sets `<fog args={[scene.sky.horizon, 40, 150]} />`.

**Change to `[45, 150]`.**

The reasoning: the furthest point of the island from the camera, when the player stands at the south edge, is the north rim at about 43.5 m.
At a fog near-plane of 40 that rim picks up a small amount of fog, which means the play space is being atmospherically flattened.
Moving the near plane to 45 guarantees that no part of the gameplay layer is ever fogged, while leaving the background layers exactly where they were:

| Layer | Distance | Fog factor at [45, 150] |
| --- | --- | --- |
| Island, worst case | 43.5 | 0.00 |
| Perimeter pylons | 15 to 40 | 0.00 |
| B1 sub-islands | 55 to 75 | 0.10 to 0.29 |
| B2 monoliths | 95 to 130 | 0.48 to 0.81 |

That is textbook aerial perspective and it is what does most of the work of pushing band 3 toward the sky value without needing the albedos to be nearly white.

### 8.5 Clouds

`quality.cloudCount` clouds currently sit at radius 34 and y 30 to 42.
Radius 34 is between the island rim at 16 and the nearest background object at 55, and y 30 is above the play space.
That is the right place for them and they need no change, except one:

Add a second, lower cloud band at **y = -14 to -6, radius 45 to 70**, so that the sub-islands in layer B1 are seen partly *through* cloud.
A background layer that is partly occluded by an atmospheric layer in front of it reads as much further away than the same object in clear air, and this costs nothing because `<Clouds>` already batches them into one instanced draw.

Gate the lower band to medium and high, since low tier has `cloudCount: 0` already.

---

## 9. Vegetation art direction

### 9.1 Height

**The grass is currently too tall and it is costing gameplay readability.**

`Grass.tsx` computes blade height as `(0.3 + p.density * 0.34) * p.scale` with `scale` in 0.7 to 1.35, giving a range of **0.21 to 0.86 m**.
The robot is about 1.40 m tall.
Grass at 0.86 comes up past the robot's waist, which hides the contact shadow that glues the toy to the floor, hides the ground plane the player is reading for navigation, and averages the whole field into a single texture that destroys the value read.

New: `(0.16 + p.density * 0.20) * p.scale` with `scale` in 0.70 to 1.25.

Range **0.11 to 0.45 m**, which reaches the robot's knee at the thickest part of a clump and its ankle at the edges.
A lawn you stand in rather than a meadow you wade through.

The density gradient stays, because it is what gives the field a silhouette rather than a flat top, and it is shared with the flower size gradient so the two layers agree about where a patch is thickest.

Daisy heights in `flowerGeometry.ts` should be checked against the same target: the tallest flower should top out around 0.35 so it sits just below the tallest grass rather than above it.
*Guess:* I have not read `flowerGeometry.ts` and I do not know its current stem height. Measure before changing.

### 9.2 Density

Blade counts stay as they are: 15,000 / 70,000 / 220,000.
They were tuned and they are not the problem.

Two adjustments:

- `quality.grassRadius` stays at 9 / 16 / 16. With a great deal more of the island now covered by decks and by the Core, the effective blade count on visible lawn drops by roughly 25% for free once the new exclusions are applied. If the low tier then looks thin, raise it to 18,000 rather than raising the radius, because the radius is what keeps low tier fast.
- Clover count drops from 340 to 300, since it is now clustered and a clustered layer at the same count reads denser than an even one.

### 9.3 Colour ramp

Three colours drive the field and they must be read as a ramp, not as three swatches.

| Role | Current | Current luma | New | New luma | Where it appears |
| --- | --- | --- | --- | --- | --- |
| `grassTip` | `#c2ea6e` | 0.849 | `#86c04e` | 0.672 | Tip of a blade at the centre of a clump |
| `grass` | `#8fd94a` | 0.749 | `#7dc244` | 0.668 | Base tint |
| `grassDeep` | `#4f9b2e` | 0.514 | `#3f7a26` | 0.405 | Blades at the edge of a clump, stems, clover |

The blade shader already multiplies by a root-darkening ramp from 0.32 at the root to 1.0 at the tip, so a blade's rendered luma spans roughly 0.21 at the root to 0.67 at the tip.
The field average lands near 0.52, which is at the bottom of band 1 and correct - the lawn should be the *darkest* thing in band 1 so that every deck standing on it reads as raised.

The ground texture's base changes from `palette.grass` lerped 0.34 toward white to lerped **0.12** toward white, giving about 0.71.
The existing comment in `groundTexture.ts` is right that the ground has to stay lighter than the blades or the field disappears into it, but 0.34 overcorrected: at 0.83 the ground was brighter than the deck stone, which is what broke the greyscale test in the first place.
At 0.71 the ground is still comfortably lighter than the 0.52 field average and now sits below the 0.735 deck tops.

The traces drawn into the ground texture keep using `grassDeep`, so they get darker along with it, which is what keeps them reading as traces rather than as scratches.

### 9.4 Player displacement

This is the highest-value item in the whole document per line of code, and it is essentially free.

Add a `uPlayer` uniform to the grass material and push blades away from the player.

In `Grass.tsx`, extend the uniforms ref and the `onBeforeCompile` common block:

```glsl
uniform vec3 uPlayer;
```

and append to the `begin_vertex` replacement, *after* the wind bend and *before* the yaw rotation:

```glsl
vec2 toBlade = iOffset.xz - uPlayer.xz;
float d = length(toBlade);
float push = 1.0 - smoothstep(0.0, 0.90, d);
// Vertical gate, so grass under a deck is not flattened by a player above it.
push *= 1.0 - step(1.20, abs(iOffset.y - uPlayer.y));
vec2 away = toBlade / max(d, 1e-4);
transformed.xz += away * push * bendWeight * 0.55 * iParams.y;
transformed.y  -= push * bendWeight * 0.25 * iParams.y;
```

`bendWeight` is already `position.y * position.y` in the existing shader, so the root stays planted and the tip travels, exactly as the wind does.

Radius 0.90 is the capsule radius of 0.35 plus a 0.55 skirt, which is wide enough to be felt and narrow enough not to look like a force field.

**Feed a lagged position, not the raw one.**
Push should be instant and recovery should be slow, or the effect reads as a shader trick rather than as grass.
Keep a `Vector3` in a ref and update it in `useFrame`:

```ts
const target = playerRef.current.position
const rate = follower.distanceTo(target) > 0.02 ? 20 : 4   // instant chase, slow release
follower.lerp(target, 1 - Math.exp(-rate * dt))
```

*Guess:* the 20 and 4 rates are a starting point, not measured. Tune by eye; the correct read is that the blades snap out of the way and take about a quarter of a second to stand back up.

Apply the same treatment to `Flowers.tsx` with **0.4x the amplitude**, because a daisy on a stem is stiffer than a blade of grass, and with the same 0.90 radius so the two layers agree about where the player is.

The `Flowers` material already reads the instance world position out of `instanceMatrix[3].xyz` for its wind phase, so the same value serves for the displacement distance with no extra attribute.

**Enable at every tier.** It costs one uniform write per frame and about eight ALU per vertex, and it is the single biggest tactility win available in this scene. The reference's whole art direction reduces to "touchable"; grass that moves when you walk through it is that word made literal.

### 9.5 What vegetation is made of

The reference's deepest rule is that everything in this world is a manufactured object: grass is moulded rubber, not grass.

The current grass material is `MeshStandardMaterial` at roughness 0.85 with no clearcoat, which reads as a matte polygon.
Give it a low clearcoat - `clearcoat: 0.35, clearcoatRoughness: 0.6` - which requires moving it to `MeshPhysicalMaterial`.
That is a real cost across 220,000 instances at high tier, so gate it: physical at high, standard at medium and low.

The double specular lobe is what the reference identifies as the difference between "plastic" and "matte 3D model", and a field of moulded rubber blades catching a soft broad highlight along the direction of the wind is the single most Astro-like thing this scene could do.

---

## 10. Tier gating and the draw-call budget

### 10.1 New fields in `QualitySettings`

```ts
/** Floating sub-islands in the near background layer. */
backgroundIslands: number      // 0 | 3 | 5
/** Slabs in the far monolith arc. */
backgroundMonoliths: number    // 5 | 9 | 13
/** Perimeter pylons. Dropping below 8 opens gaps in the frame, so 6 is the floor. */
pylonCount: number             // 6 | 8 | 8
/** Whether pylons get their cap puck and marker node. */
pylonDetail: boolean           // false | true | true
/** Rim buttress fins hanging off the island edge. */
buttressCount: number          // 0 | 12 | 24
/** Token crystal groves. */
crystalGroves: number          // 3 | 5 | 6
/** Tubular segments per trace curve. */
traceSegments: number          // 24 | 48 | 64
/** The transparent outer icosahedron on every node. */
nodeShells: boolean            // false | true | true
/** Physical rather than standard material on grass blades. */
grassClearcoat: boolean        // false | false | true
/** The low cloud band that partly occludes the sub-islands. */
lowClouds: boolean             // false | true | true
```

Never gate: the kit modules, the kerbs, the colliders, the grass and flower displacement, the trunk trace, the Core node and its completion ring.
Those are the level and the readability, not the polish.

### 10.2 Draw call budget at high tier

Draw calls counted as (geometry, material) pairs, with a second entry where the object casts into the shadow map.

| Element | Draws | Notes |
| --- | --- | --- |
| SkyDome | 1 | |
| Terrain plateau | 1 | |
| Terrain rim | 1 | |
| Terrain soil band | 1 | |
| Terrain root cone | 1 | |
| Clouds, both bands | 1 | batched by drei `<Clouds>` |
| Grass | 2 | colour plus shadow, `grassCastShadow` true at high only |
| Flowers, two batches | 4 | |
| Scatter boulders, three silhouettes | 6 | |
| Scatter pebbles | 2 | |
| Scatter clover | 1 | no cast |
| **`deckBatch`** | 2 | every walkable K1/K2/K4 piece merged, one material |
| **`trimBatch`** | 2 | every kerb merged |
| **`dressBatch`** | 2 | struts, non-walkable pucks, band 2 stone |
| **`pillMesh`** instanced | 2 | pylon masts |
| **`nodeMesh`** instanced | 1 | emissive, no shadow cast |
| **`shellMesh`** instanced | 1 | transparent |
| **`traceBatch`** | 1 | spurs and trunk, emissive |
| **`padMesh`** instanced | 1 | |
| **`shardMesh`** instanced | 2 | |
| **`finMesh`** instanced | 2 | rim buttresses |
| Core node plus completion ring | 3 | node, shell, four arcs merged into two states |
| Portal arch | 6 | existing component |
| Portal ring inlay | 3 | existing component |
| Lesson totems x4 | 4 | see below |
| Robot | ~12 | existing, estimated |
| Background sub-islands | 2 | cone plus cap, merged |
| Background monoliths | 2 | slabs plus cap band, merged |
| **Total** | **~70** | against a budget of 120 |

Thirty draw calls of headroom, which is the right amount to leave: it is enough for a second pass on the scene without a rewrite, and not so much that the budget stops being a constraint.

**The totem line is the one that needs deliberate work.**
`LessonTotem.tsx` today draws five meshes per totem - plinth base, plinth cap, accent ring, node, completion tick - and instantiates four totems, which is twenty draw calls.
That is more than the entire built environment.

The fix is to move the plinth base and cap onto the K2 puck generator and merge them into `deckBatch`, put the node into `nodeMesh` and `shellMesh`, and instance the accent ring and the completion tick as two small instanced meshes.
Four totems then cost **four** draw calls instead of twenty.

The complication is that the glow colour changes on completion, which breaks a single instanced batch.
Solve it with two instanced meshes per shape, one for the completed set and one for the incomplete set, rebuilt when progress changes.
There are at most four totems, the rebuild happens on a lesson completion rather than per frame, and it keeps the count at two draws per shape regardless of how many totems a zone has.

### 10.3 Per-tier totals

| Tier | Estimated draws | What is dropped |
| --- | --- | --- |
| low | ~44 | no grass shadow pass, no node shells, no buttresses, no sub-islands, fewer monoliths, 6 pylons without caps, 3 groves, standard grass material |
| medium | ~62 | no grass shadow pass, no sub-island pylon detail, 12 buttresses, 3 sub-islands, 9 monoliths, standard grass material |
| high | ~70 | everything |

Low tier drops 26 draws and, more importantly, drops the two things that actually cost frame time at that tier: the grass shadow pass and the transparent node shells.
The architecture, the colliders, the value bands and the displacement are identical at all three tiers, so the level plays and reads the same on a laptop as it does on a workstation.
That is the correct place to draw the line: a lower tier should be a less decorated version of the same world, never a different one.

---

## 11. Implementation order

Build in this order, because each step is verifiable on its own and each one makes the next one easier to judge.

1. **`placement.ts`**: add `centreMinRadius`, `centreMaxRadius`, `clusterCentres` and the rectangular `Exclusion` variant. Unit tests belong here; `placement.test.ts` already exists.
2. **`palette.ts`**: the new values from 3.3, plus the `band()` helper.
3. **`tuning.ts` and `App.tsx`**: FOV 40, `CAMERA.distance` 10.7, `CAMERA.height` 4.3, `pullOutSpeed` 5, fog `[45, 150]`, and the `cameraScale` field on `SceneDefinition` with cave at 0.62. Verify the cave first, since that is the regression risk.
4. **The kit**: the eleven generators in a new `src/art/kit.ts`, with the merge helpers. No scene changes yet.
5. **The Core and the portal stack**: geometry and colliders. Walk the whole ladder from lawn to portal before adding anything decorative. This is the step where the traversal audit in 2.2 gets confirmed by hand rather than on paper.
6. **`lessons.ts` and `registry.ts`**: the new totem positions and spawns.
7. **The east route and the west pile.**
8. **`HUB_EXCLUSIONS`**, then the vegetation changes: heights, colours, displacement.
9. **`Scatter.tsx`**: clustering, and delete its flower layer.
10. **The motif layer**: traces, groves, nodes, and the deletion of `NodeSculpture` and `TokenCrystal`.
11. **The frame**: pylons, arcs, buttresses.
12. **The background**: sub-islands, monoliths, low clouds.
13. **`quality.ts`**: the new fields, wired to everything above.
14. **The greyscale test**, run properly per 3.1, and iterate on the albedos until the bands hold.

Step 14 is not optional and it is not a formality.
Every value in section 3 is a target derived from hex codes, and the only thing that settles whether the target was hit is a measured screenshot.
