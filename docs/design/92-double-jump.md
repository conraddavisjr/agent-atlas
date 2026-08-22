# The second jump, and the foot thrusters that sell it

The brief, verbatim:

> When you hit the spacebar for the second time, little blue beams shoot out of the bottom of the robot character's feet and cause them to move up higher and prolong their air time in their jump.

This file is a build specification.
It gives the physics, the curves, the VFX and the pose, each number labelled, and it names the exact constants and functions the change touches.

**Labels, the same three this project has used since `00-references.md`.**

- **[DOC]** documented in a source, with a URL.
- **[OBS]** inferred from public material or reconstructed from physics, with the working shown.
- **[REC]** an engineering recommendation with a concrete number. Not a Sony figure.

`00-references.md` opens by saying there are no published Sony numbers for the rendering side, and the same is true here for the movement side.
Team ASOBI have published a great deal about level design and physics *architecture* and no numbers at all about jump arcs.
Every velocity, duration and height below that is not marked [DOC] is mine, and the derivation is next to it so it can be checked rather than believed.

---

## 0. The verdict: it is a hover, and the brief describes a double jump

**Astro does not have a double jump in any of the three games. He has a hold-to-hover on the same button as the jump.**
Confidence: high.
Sony's own words for it are **"laser-hover"**, and six independent control listings agree across all three games.
Nothing found contradicts them.

| Game | Move | Wording | Source |
| --- | --- | --- | --- |
| Astro Bot (PS5, 2024) | Laser-hover | Tim Turi, Content Communications Manager, SIE: "Astro still has his trusty jump, attack, charged spin attack, and versatile **laser-hover** ability." | [PlayStation.Blog hands-on report](https://blog.playstation.com/2024/06/12/astro-bot-hands-on-report/) |
| Astro Bot (PS5, 2024) | Hover | "Cross **(Hold)** - Hover" | [Game8 controls guide](https://game8.co/games/Astro-Bot/archives/472018) |
| Astro Bot (PS5, 2024) | Hover | "**Hold Cross while in the air**"; the "laser thrusters **will cut out after a couple of seconds**" | [Shacknews, controls, moves and abilities](https://www.shacknews.com/article/141300/controls-moves-abilities-astro-bot) |
| Astro Bot (PS5, 2024) | Hover boots | "a **sort-of double jump** when you hold down Cross/X after a jump. This activates his **hover boots**, boosting Astro's **height** and keeping him in the air **much longer**." | [Push Square, Let It Slide guide](https://www.pushsquare.com/guides/astro-bot-let-it-slide-all-collectibles-and-how-to-go-faster) |
| Astro's Playroom (PS5, 2020) | Jump / lasers | "Jump / **use lasers (hold)**" | [gamepressure controls](https://www.gamepressure.com/astros-playroom/controls/z4e492) |
| All three | Hover | "Pressing the cross button allows Astro to jump, and **holding it afterwards** allows Astro to **slightly boost himself upward** by hovering with lasers from his feet." | [Astropedia](https://astrobot.miraheze.org/wiki/Astro_Bot) |
| Astro Bot (PS5, 2024), JP | ホバー | 「×ボタンを長押しするとホバーになり、ホバー時に足元から伸びる光には攻撃判定があり」 - hold X to hover; the light extending from his feet **has a damage hitbox** | [altema.jp](https://altema.jp/astrobot/joban) |
| Astro Bot Rescue Mission (PSVR, 2018) | Jump-jet | "**Holding X while airborne** makes Astro hover for a short time"; a "jump-jet technique that permits a temporary hover during every leap, damages any enemies caught in its line-of-fire, and precisely indicates where Astro will finally land" | [Push Square game page](https://www.pushsquare.com/games/ps4/astro_bot_rescue_mission), [videochums review](https://videochums.com/review/astro-bot-rescue-mission), [ScreenRant review](https://screenrant.com/astro-bot-rescue-mission-review/) |

**Where the double-jump reading comes from, because it is a reasonable thing to have believed.**
Push Square's guide calls it "a sort-of double jump" in the same sentence in which it describes holding the button, and that phrasing has propagated.
It is a fair description of what the move *achieves* and a wrong description of how it is *performed*.

**And there is direct evidence the two states are distinguished in the reference.**
A reviewer notes: "I can regularly jump very late just as Astro is at the edge of a platform and it **still registers as a jump and not a hover**." ([gamermatters review](https://gamermatters.com/astro-bot-review/))
That is a coyote-time window winning over the hover predicate, which is exactly the precedence this file specifies in section 3.3.

Four things follow that matter for the build.

**It is one button and one continuous action, not two discrete ones.**
There is no second press. The player holds through the arc and the jets ignite; a community guide for Astro's Playroom states it as "hold the X button and you will be able to make Astro jump significantly **higher and longer** compared to just tapping". [DOC, secondary source]
That sentence is the closest thing to a specification of the effect that exists in public: the hover adds height **and** airtime, which is exactly the pair the user's brief asks for.

**The mechanic did not change across the three games.** [OBS]
The 2018 PSVR wording, the 2020 Playroom wording and the 2024 wording describe the same hold-to-hover on the jump button.
The suits in Astro's Playroom add separate boosts on L1/R1, and those are a different system that is not in scope here.

**The burn is time-limited and once per airtime, and it is refreshed by a mid-air attack rather than by landing.**
"Will cut out after a couple of seconds" is the only duration statement in any source found. [DOC, secondary source]
Two seconds is a journalist's estimate, not a measurement, and I could not find any frame-accurate hover duration, apex height or airtime anywhere: not on speedrun.com's Astro's Playroom guides and forums, not in the CEDEC 2025 physics and level-design sessions, not in the GDC 2025 or GDC 2019 talks, not in Digital Foundry's analysis.

That the burn is once per airtime is **strongly implied and never stated**.
The speedrun community's "double hover" technique is the evidence: "ride out your first hover for as long as possible, **do a spin**, and then start your second hover" ([speedrun.com guides](https://www.speedrun.com/astros_playroom/guides), [forum thread](https://www.speedrun.com/astros_playroom/forums/kuv9l)), and Astropedia's Hover page says it "can permit Astro bot to fly, tied with a punch to get more time in air" ([Astropedia, Hover](https://astrobot.miraheze.org/wiki/Hover)).
A technique that exists to get a second hover only makes sense if one is the normal allowance, and the refresh comes from the spin or punch rather than from touching the ground.
**The spin and the punch are out of scope for this project**, which has neither, so the refill rule here is landing-only.

**And the beams are a weapon and a landing reticle, not only a plume.**
The light from the feet **has a damage hitbox** and kills enemies below ([altema.jp](https://altema.jp/astrobot/joban), Japanese sources call them 高熱のレーザー, high-heat lasers), and it "precisely indicates where Astro will finally land" so players "safely hover over thin tightropes and tiny ledges" ([ScreenRant](https://screenrant.com/astro-bot-rescue-mission-review/)). [DOC]
That settles the shape question in section 7: they reach the ground.

**Not documented anywhere, stated plainly so nobody fills the gap with invention:** hover duration in frames or seconds, hover lift in metres or body heights, gravity during the burn, terminal sink rate, air-control multiplier during the burn, apex height single versus hovered, total airtime, coyote and buffer windows in frames, hover cooldown, whether a *tap* mid-air does anything at all, and any numeric difference between the three titles.
Anyone quoting those as Sony numbers has made them up.

**Astro's own height is not usable as a scale reference either.**
The only figure in circulation is from a licensed Top Trumps card and it is internally inconsistent: it reads "0.9 feet or 30 cm", and 0.9 ft is 27.4 cm while Astropedia transcribes the same card as 0'9" which is 22.9 cm ([TheGamer](https://www.thegamer.com/players-are-trying-to-figure-out-how-tall-astro-bot-is/), [Astropedia](https://astrobot.miraheze.org/wiki/Astro_Bot)).
Roughly 25 to 30 cm, and not a number to divide anything by.
**This is exactly why every height in this file is expressed in body heights rather than metres.** The ratio transfers; the unit scale does not.

### So which does the project build

**The brief describes a double jump.** "Hit the spacebar for the second time" is a discrete second press producing a discrete second impulse.
The reference is a hover.
These are different feels and different code, and this file specifies **both**, as one mechanism with one constant moved.

**Recommendation: build Option A, the boosted double jump, and ship it.**
Three reasons, in order of weight.

1. It is what was asked for. The brief is unambiguous about the second press.
2. **It satisfies the reference's own documented outcome.** The only description of what the hover achieves is "boosting Astro's **height** and keeping him in the air **much longer**" [DOC], and Option A achieves both: **+103% apex height and +80% airtime** against the current single jump. Nothing in any source says the hover must be *performed* by holding in order to be the same move; it says holding is how Astro's version is performed.
3. The project's input layer already discards the information Option B needs. `useInput` publishes `jumpPressed` as an edge and `jumpHeld` as a level, and `JUMP.cutMultiplier` means players are *trained to release the button early* to control height. A hold-to-hover fights variable jump height for the same finger.
4. Guides already describe the reference move as "a sort-of double jump" [DOC], so the gap between what the brief asks for and what the reference does is smaller than the hover-versus-double-jump framing makes it sound.

Option B is specified in full at section 4, and switching to it is a change of constants plus one ignition predicate, not a rewrite.
If the goal ever becomes literal reference fidelity over the brief, that section is the thing to read.

---

## 1. One mechanism, two settings

A discrete double jump and a timed hover are the same mechanism with one constant moved.

> A press in the air sets a vertical velocity and opens a window during which gravity is reduced.
> A double jump is that window at or near zero. A hover is that window at a second or more.

The general form costs nothing extra to build, and it means the choice between the two is a number rather than a rewrite.
`AIR_JUMP` in `tuning.ts` is already shaped this way, and this file supplies the numbers it is carrying placeholders for.

The **thrust window** is the load-bearing idea and it is what makes the effect readable.
Without it, a second impulse is indistinguishable from the first and reads as a bug: the eye sees the same arc twice.
With a few hundred milliseconds of reduced gravity after the impulse, the second rise is visibly *slower and longer* than the first, which is what "thrusters" means to a viewer.

---

## 2. The starting point, measured from the code

Every number in this section is computed from the frozen constants in `tuning.ts`, so it is arithmetic rather than estimate.

```
JUMP.velocity 8.2   JUMP.gravity -24   fallGravityMultiplier 1.5 -> fall gravity -36
PROPORTIONS.totalHeight 1.36 m, the character's own height, sole to crown
```

| Quantity | Value | Derivation |
| --- | --- | --- |
| Rise time | 0.3417 s | `8.2 / 24` |
| Apex height | 1.4008 m | `8.2^2 / (2 * 24)` |
| Apex in body heights | **1.030** | `1.4008 / 1.36` |
| Fall time to launch height | 0.2790 s | `sqrt(2 * 1.4008 / 36)` |
| Total airtime | **0.6206 s** | sum of the two |
| Impact speed | 10.04 m/s | `sqrt(2 * 36 * 1.4008)` |
| Landing squash strength | 0.359 | `10.04 / 28`, against `JUMP.maxFallSpeed` |

**One body height of apex is low for a platformer** and worth stating, because it sets what the second jump has to add.
Astro's own single jump reads as roughly two body heights in footage. [OBS, eyeballed, not measured]
That is not a number to tune against, and `tuning.ts` is frozen for the art overhaul anyway (art bible section 3), so the first jump stays exactly as it is and the second jump is where the height comes from.

---

## 3. Option A, recommended: the boosted double jump

### 3.1 The constants

These are the values `AIR_JUMP` should carry.

| Constant | Value | Label | Why |
| --- | --- | --- | --- |
| `count` | `1` | [REC] | One air jump. Refilled on landing only. |
| `velocityFraction` | `0.78` | [REC] | Second impulse is `0.78 * 8.2 = 6.396 m/s`. Below 1 so the boost reads as the smaller, cheaper move. |
| `thrustTime` | `0.20` s | [REC] | The burn. This is the constant that decides double jump versus hover. |
| `thrustGravity` | `0.45` | [REC] | Gravity multiplier while burning, applied to the rising gravity only: `-24 * 0.45 = -10.8 m/s^2`. |
| `lockout` | `0.12` s | [REC], with a derived floor | The window after leaving the ground during which the air jump is refused. |
| `airControlBoost` | `1.45` | [REC] | Multiplier on `MOVEMENT.airControl` while burning: `0.35 * 1.45 = 0.5075`. |

**`velocityFraction` is a fraction rather than an absolute** so that a future retune of `JUMP.velocity` carries the second jump with it.

**The impulse is SET, not added.**
Adding to the current velocity makes the height depend on where in the arc the press landed, so a press at the apex and a press on the way down give different results from the same button.
That is the class of thing players describe as "sometimes it does not work".

**`lockout` has a derived floor and 0.12 clears it.**
Because the impulse is a set rather than an add, a press early enough that the character is still rising faster than `velocityFraction * JUMP.velocity` would *slow the character down*.
That stops being possible once

```
lockout >= (JUMP.velocity - velocityFraction * JUMP.velocity) / |JUMP.gravity|
        =  (8.2 - 6.396) / 24
        =  0.0752 s
```

so `0.12` clears the floor by 60%, and no `Math.max(vy, v1)` guard is needed.
Write the floor into the constant's doc comment, because it moves whenever `velocityFraction` moves.

`lockout` also does the job its comment claims: without it a fast double tap spends both jumps in the first three frames and the player gets one slightly higher jump instead of two, which reads as the input being eaten.

### 3.2 The dynamics, as numbers

Press at the first apex, which is the best case and the one the acceptance criteria pin.

```
v1   = 0.78 * 8.2                              = 6.396 m/s
gT   = 24 * 0.45                               = 10.8 m/s^2
vEnd = v1 - gT * thrustTime = 6.396 - 2.160    = 4.236 m/s      velocity at burnout
dh   = v1*T - 0.5*gT*T^2 + vEnd^2 / (2*24)
     = 1.2792 - 0.2160 + 0.3738                = 1.4370 m       height the boost adds
rise = T + vEnd/24 = 0.20 + 0.1765             = 0.3765 s       press to new apex
apex = 1.4008 + 1.4370                         = 2.8379 m
fall = sqrt(2 * 2.8379 / 36)                   = 0.3971 s
air  = 0.3417 + 0.3765 + 0.3971                = 1.1152 s
```

**The headline table. Lead with the body-height row: it is the only number that transfers between games regardless of unit scale.**

| Quantity | Single | Doubled | Ratio |
| --- | --- | --- | --- |
| **Apex, in body heights** | **1.030** | **2.087** | **2.03x** |
| Apex, metres | 1.401 | 2.838 | 2.03x |
| Total airtime | 0.621 s | 1.115 s | **1.80x** |
| Time from second press to apex | - | **0.3765 s** | - |
| Impact speed on landing | 10.04 m/s | 14.29 m/s | 1.42x |
| Landing squash depth | 0.921 | 0.888 | deeper, for free |

**Both halves of the brief are satisfied and they are separable.**
"Move up higher" is the 2.03x apex. "Prolong their air time" is the 1.80x airtime.
The same impulse with `thrustTime` set to 0 - a bare second jump with no thrusters - gives an apex of 2.253 m and an airtime of 0.962 s, which is **1.61x apex and 1.55x airtime**.
So the 200 ms burn is worth 0.585 m of extra height and 153 ms of extra airtime on its own, and it buys airtime disproportionately, which is the correct bias for a move called a thruster.
It is also the arithmetic answer to "why not just fire a second impulse": because a bare impulse is a 61% taller jump with no visible reason for being taller, and the burn is what makes the boost legible.

**The move has an expressive range, and that is deliberate.**
Because the impulse is a set, *when* the player presses decides how high they get.

| Press moment | Apex | In body heights |
| --- | --- | --- |
| Earliest legal, at `lockout` expiry, y = 0.811 | 2.248 m | 1.65 |
| At the first apex | **2.838 m** | **2.09** |
| On the way down at y = 0.5 | 1.937 m | 1.42 |

A 0.59 m spread between the earliest legal press and the optimal one is a real skill gradient on a move with one button, and it is free.

### 3.3 Availability rules

- **Available at any point after `lockout`**, not only after apex. Restricting it to the descent is a common choice and it is the wrong one here: it makes the best press moment (the apex) sit exactly on the boundary of legality, so the move fails intermittently at precisely the moment the player has learned to use it.
- **Refilled on landing only.** Never in the air, never on a wall, never on a coyote frame. This is the whole of what stops the move being flight.
- **Coyote time does not grant an air jump.** Walking off a ledge and pressing jump inside `JUMP.coyoteTime` spends the *ground* jump, and the air jump remains. Walking off a ledge, letting coyote expire, and pressing jump spends the air jump. Both are correct and neither needs special-casing: the existing `buffer > 0 && coyote > 0` branch runs first and the air-jump branch is an `else`.
- **It fires on the `jumpPressed` edge only, never on `jumpHeld`.** Non-negotiable. `movement.test.ts`'s existing "does not double jump from a single press" test is what enforces it, and it will catch the mistake for free.
- **Jump buffering does not apply to the air jump.** A buffered press that lands on the ground fires a ground jump. Letting a stale buffer fire an air jump means a press made 100 ms before landing can fire twice.

---

## 4. Option B: the hold-to-hover, the reference-accurate build

Specified in full so the choice is a decision rather than a research task.

### 4.1 The constants

| Constant | Value | Label | Why |
| --- | --- | --- | --- |
| `hoverKick` | `2.6` m/s | [REC] | Velocity floor set on ignition: `vy = Math.max(vy, hoverKick)`. This is the "higher" half. |
| `hoverTime` | `1.20` s | [REC] | Maximum burn. See the scaling argument below. |
| `hoverGravityRise` | `0.30` | [REC] | Multiplier on `JUMP.gravity` while `vy > 0` during the burn: `-7.2 m/s^2`. |
| `hoverSink` | `-1.6` m/s | [REC] | Terminal sink during the burn. Reached under the same reduced gravity, then clamped. |
| `hoverIgniteVy` | `0.5` m/s | [REC] | The jets do not light until the rise has nearly stopped. |
| `hoverAirControl` | `1.9` | [REC] | Multiplier on `MOVEMENT.airControl`: `0.35 * 1.9 = 0.665`. A hover that cannot be steered has no reason to exist. |

**`hoverTime` is scaled, not copied.**
The only published figure is "a couple of seconds" [DOC, secondary].
Two seconds is 3.2x this project's *entire* single-jump airtime of 0.621 s, which would make the hover the game rather than a move in it.
Astro's own single-jump airtime is not documented, so the honest scaling is by ratio against a typical platformer arc of 0.7 to 0.9 s: two seconds is then 2.2x to 2.9x the base airtime, and 1.20 s against our 0.621 s is 1.93x plus the tail, landing at **2.74x total**. [OBS, with the working shown, and it is a reconstruction rather than a measurement]

### 4.2 The ignition predicate, which is where the subtlety is

```
ignite = jumpHeld && !grounded && air > lockout && vy <= hoverIgniteVy && hoverFuel > 0
```

**Note what is absent: any requirement that the button was released.**
That is deliberate and it is what reproduces the documented behaviour.
A player who holds the jump button from the ground gets the full first jump (because `JUMP.cutMultiplier` only fires on release) and then the jets light automatically at the apex, which is exactly "hold X and Astro jumps significantly higher and longer".

**Releasing ends the burn and does not refund it.**
Re-pressing does not relight it. Fuel is spent, and it refills on landing only.

### 4.3 The dynamics

Hold from the ground, jets light at the first apex.

```
ignition at t 0.3417, y 1.4008, vy set to 2.6
rise under -7.2:  0.3611 s, +0.4694 m   -> apex 1.8703 m at t 0.7028
sink builds to 1.6 m/s over 0.2222 s, dropping 0.1778 m
then 0.6167 s of burn left at a clamped 1.6 m/s, dropping 0.9867 m
burnout at t 1.5417, y 0.7058, vy -1.6
free fall at -36 from there: 0.1585 s
```

| Quantity | Single | Hovered | Ratio |
| --- | --- | --- | --- |
| **Apex, in body heights** | **1.030** | **1.375** | **1.34x** |
| Apex, metres | 1.401 | 1.870 | 1.34x |
| Total airtime | 0.621 s | **1.700 s** | **2.74x** |
| Impact speed | 10.04 m/s | 7.31 m/s | 0.73x |

**The two options have opposite biases and that is the whole distinction.**
Option A more than doubles the height and adds 80% airtime.
Option B adds a third of the height and nearly triples the airtime, and it *softens* the landing, which is why a hover feels like a traversal tool and a double jump feels like a second launch.

If Option B is chosen, every downstream section of this file still applies unchanged except that the beam envelope's sustain phase is 1.20 s rather than 0.20 s, and the pose's `burn` ramp needs a longer blend-in so the splay does not snap.

---

## 5. What this touches in the code

Read this section before writing anything.
The project's movement is a kinematic character controller on `@react-three/rapier`, and everything that decides feel is a pure function in `movement.ts` with a test beside it.
That boundary is not decoration and this change must not cross it.

### 5.1 Files and the exact edits

| File | Edit |
| --- | --- |
| `src/game/player/tuning.ts` | `AIR_JUMP` gains the values from 3.1. The block already exists with placeholders. |
| `src/game/player/movement.ts` | `VerticalState` gains `airJumps`, `thrust`, `air`. `stepVertical` gains the air-jump branch and the reduced-gravity term, and returns `airJumped` alongside `jumped`. |
| `src/game/player/robotAnim.ts` | `RobotAnimState` gains `thrust` and `thrustAge`. `EV` gains `AirJump: 11`. |
| `src/game/player/PlayerController.tsx` | Copies the three new `VerticalState` fields back into its refs, pushes `EV.AirJump` and a `'takeoff'` squash on `airJumped`, publishes `thrust`/`thrustAge` onto `anim.current`, applies `airControlBoost` to the two `stepHorizontal` calls, and exposes `airJumps`/`thrust` on `window.__player`. |
| `src/game/player/animTuning.ts` | New `AIR_JUMP_ANIM` block. See section 8. |
| `src/game/player/robotPose.ts` | `applyEventImpulses` gains an `EV.AirJump` branch. `stepAnim` gains the burn pose block. |
| `src/game/player/thrusterEnvelope.ts` | **New.** The pure envelope functions from section 7, with `thrusterEnvelope.test.ts` beside them. |
| `src/game/player/FootThrusters.tsx` | **New.** The instanced beam mesh from section 8. |
| `src/game/player/robotParts.tsx` | `Foot()`'s sole light takes a `glow` prop so it can be lifted from `GLOW.source` to `GLOW.bloom` during a burn. |

**`tuning.ts` is frozen and this is an addition, not a retune.**
Art bible section 3 freezes `MOVEMENT`, `JUMP`, `BODY` and `SQUASH` so that a change in feel stays attributable to animation.
`AIR_JUMP` is a new block and touches none of those four.
**No value inside `JUMP` may be changed by this work.** If the doubled jump feels wrong, the dial is `velocityFraction` and `thrustTime`, never `JUMP.velocity`.

### 5.2 `stepVertical`, in order

The existing doc comment states the order and it is not arbitrary.
The new steps slot in without disturbing it:

```
timers (coyote, buffer, air, thrust)
  -> ground jump
  -> air jump           <- new, an `else if` on the ground jump
  -> variable-height cut
  -> gravity, now selecting between three rates
  -> terminal clamp
  -> grounded downward bias
```

Three specifics.

**The variable-height cut must not apply on the frame the air jump fires**, for the same reason it does not apply on the frame the ground jump fires. The existing guard is `!jumped`; it becomes `!jumped && !airJumped`.

**Gravity now selects between three rates, not two.**

```
vy > 0 && thrust > 0   ->  JUMP.gravity * AIR_JUMP.thrustGravity
vy > 0                 ->  JUMP.gravity
otherwise              ->  JUMP.gravity * JUMP.fallGravityMultiplier
```

**The fall multiplier is deliberately untouched by the burn.**
The descent after a boost is the same heavy, snappy fall the first jump has, so the move does not turn the character into a balloon on the way down.
For Option B this changes: the burn clamps the sink rate instead, which is why Option B feels floaty and Option A does not.

**`thrust` is a countdown, not an elapsed time.**
Everything that reads it wants "how much is left": gravity wants to know whether to be reduced, and the VFX wants a ramp it can shape without knowing the duration.
`thrustAge` is the mirror and it is what the beam's decay tail needs, because the tail outlives the burn.

### 5.3 Air control during the burn

`stepHorizontal` currently takes `grounded` and picks `1` or `MOVEMENT.airControl`.
It needs a third case.

**Change the signature to take the multiplier rather than a second boolean.**
`stepHorizontal(current, target, hasInput, control, dt)` where the caller passes `grounded ? 1 : thrusting ? MOVEMENT.airControl * AIR_JUMP.airControlBoost : MOVEMENT.airControl`.
Two booleans that are not independent is how a third state gets added wrong later.
This breaks the call sites in `PlayerController` and the existing `stepHorizontal` tests in `movement.test.ts`, which is a mechanical update and is listed in section 10.

### 5.4 The clock, and why the two cannot drift

**This is the requirement the brief calls out and it has exactly one correct answer here: there is only one clock.**

`thrust` and `thrustAge` are advanced inside `stepVertical`, which runs in `useBeforePhysicsStep` at a fixed `dt` of `1/60`.
They are copied onto `RobotAnimState` in the same physics step.
The beam reads `anim.thrustAge` and nothing else.
It never calls `performance.now()`, never accumulates its own `delta`, and never reads `gameClock.elapsed`.

The consequence is that the beam's visual phase is a pure function of the physics state, so drift is not merely unlikely, it is unrepresentable.
The beam can be at most one physics step stale relative to the rendered position at high refresh rates, and that is the same staleness the rest of the character already has.

**Do not drive it from the event ring's timestamp instead.**
The ring's `t` is `rt.t`, which advances by the *render* `dt` inside `stepAnim`, and comparing it against a physics countdown is exactly the drift this section exists to prevent.
The `EV.AirJump` event is still pushed, because the antenna, the head and the face all want the one-shot impulse, but the beam's *envelope* is driven off `thrustAge`.

---

## 6. Timing and easing

The brief asks for "whatever timing function the Astro game has".
**No easing curve for this move is documented anywhere.** No source names one, and none can be recovered from a control listing.
Everything in this section is [REC], shaped from what the footage reads like and from the constraints this project already has.

Lives in `src/game/player/thrusterEnvelope.ts` as pure functions with a test beside them, following the `springs.ts` and `movement.ts` precedent.
`age` is `anim.thrustAge` in seconds. `T` is `AIR_JUMP.thrustTime`.

### 6.1 The named curves

```ts
const easeOutBack  = (x: number, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
const easeInCubic  = (x: number) => x ** 3
const easeInQuad   = (x: number) => x * x
```

### 6.2 The four phases

| Phase | Window | Drives | Curve |
| --- | --- | --- | --- |
| Ignition | `0` to `IGNITE = 0.045` s | length, width, alpha | `easeOutBack` on length, `easeOutCubic` on width and alpha |
| Sustain | `IGNITE` to `T` | length | `1 + FLICKER * sin(2*PI*FLICKER_HZ * age)` |
| Cutoff | `T` to `T + DECAY`, `DECAY = 0.11` s | length | `easeInCubic` from 1 to 0 |
| Alpha tail | `T` to `T + DECAY` | alpha | holds at 1 until 0.45 of the window, then `1 - easeInQuad` |

```ts
export const THRUST_FX = {
  igniteTime: 0.045,
  decayTime: 0.11,
  /** Length overshoot on ignition, from easeOutBack's own s = 1.70158. */
  igniteOvershoot: 1.0999,
  flicker: 0.055,
  /** Hz. MUST stay under the 30 Hz Nyquist limit of a 60 Hz display. */
  flickerHz: 22,
  alphaHold: 0.45,
} as const
```

**Three things in that table are decisions rather than taste.**

**`easeOutBack` on ignition, and only on ignition.**
The `s = 1.70158` default overshoots to **1.0999**, exactly `1 + 2.70158 * (-0.41989)^3 + 1.70158 * (-0.41989)^2` at the stationary point of its derivative, so the plume shoots 10% past its sustain length in 45 ms and settles back.
A thruster that ramps monotonically to length reads as a fade-in. One that overshoots reads as ignition.
This is the same reasoning `springs.ts` uses for `zeta` below 1, and it is a curve rather than a spring only because it is a fixed 45 ms one-shot with no state.

**The flicker frequency is capped by the display, not by taste.**
A 60 Hz sample of a 34 Hz sine aliases to a 26 Hz beat, so a flicker chosen for how it sounds will render as a slower, uglier throb than the one specified.
22 Hz is 0.73 of Nyquist and samples cleanly.
On a 30 Hz frame, which `?tier=low` on a weak machine can produce, it aliases to DC and the flicker simply disappears, which is the correct failure.

**The visual tail outlives the physics window by 110 ms and that is not a bug.**
The burn stops at `T` because that is when gravity goes back to normal; the plume takes another 110 ms to die because that is what a jet does.
`thrustAge` therefore has to keep counting past `T`, and the emitter's visibility gate is `age < T + DECAY`, not `thrust > 0`.
This is the single most likely thing to be implemented wrong, because `thrust > 0` looks like the obvious gate and produces a plume that vanishes in one frame.

### 6.3 The physics curve is a rectangle, deliberately

Gravity during the burn is a hard step from `-10.8` to `-24` at `t = T`, with no ramp.

**Do not smooth it.**
A ramped gravity makes the apex height a function of the ramp's shape, so tuning `thrustTime` for how long the plume looks changes how high the jump goes, and the two become one dial.
A rectangle keeps them separate: `thrustTime` sets the height and the burn length exactly, and `THRUST_FX` sets how it looks.
The discontinuity is invisible in motion because the velocity is continuous across it; only the acceleration steps, and nothing in the render reads acceleration except the head nod, which is on a spring and cannot show a step.

---

## 7. The beams

### 7.1 What they are, in the reference

**[DOC]** Sony calls the ability **laser-hover** ([PS Blog](https://blog.playstation.com/2024/06/12/astro-bot-hands-on-report/)), guides call the hardware **hover boots** and the beams **laser thrusters**, and the beams:

- shoot **down from his feet** ([videochums](https://videochums.com/review/astro-bot-rescue-mission)),
- carry a **damage hitbox** along their line of fire ([altema.jp](https://altema.jp/astrobot/joban), [ScreenRant](https://screenrant.com/astro-bot-rescue-mission-review/)),
- and **precisely indicate where Astro will finally land** ([ScreenRant](https://screenrant.com/astro-bot-rescue-mission-review/)).

That last point settles a real ambiguity, and it is the most useful thing the research produced: they are not a short flared rocket plume, they are **long narrow downward beams that reach the ground**.
The gameplay function is a landing reticle.

**[REC] Build both reads as two layers**, because the plume is what sells the thrust at the foot and the beam is what sells the reach.

**On the colour, and this is the one place the brief runs ahead of the sources.**
The brief says "little **blue** beams", and blue is almost certainly right, but **no citable source states the colour**.
The only text found is a search snippet attributed to a Fandom wiki describing "two blue lasers", and that page could not be loaded to verify its context.
So blue here is [REC] resting on a documented adjacency rather than [DOC]: `00-references.md` section 5 records **blue LED means ally** as a global rule with no exceptions [DOC], the visor and the sole lights already use `palette.visor`, and a thruster in any other hue would have the character's hardware speaking a different language from its face.
That is a strong argument and it is not the same thing as a measurement.

### 7.2 Geometry

One `CylinderGeometry(rTop, rBottom, 1, 8, 1, true)` - eight radial segments, one height segment, open-ended, unit length - instanced six times.
Length and radius come from the per-instance matrix, so one geometry serves every layer.

| Instance | Count | Top radius | Bottom radius | Length at full burn | Layer |
| --- | --- | --- | --- | --- | --- |
| Plume halo | 2 | 0.024 | 0.052 | 0.30 m | flared, `palette.visor` |
| Plume core | 2 | 0.012 | 0.020 | 0.19 m | pale, inside the halo |
| Landing beam | 2 | 0.011 | 0.011 | to the ground hit, capped 3.0 m | narrow, dim |

**Attachment point: foot-local `(0, -FOOT.height/2 - SOLE_LIGHT.proud, 0)` = `(0, -0.069, 0)`**, which is the bottom face of the sole pad, so the beam grows out of the light that is already there rather than out of the rubber beside it.
In character-local space that is `y = -0.004`, four millimetres below the sole plane, and the two feet sit at `x = -0.145` and `x = +0.145`.

**Sizing is relative to the foot, and the numbers are measured rather than chosen.**
The sole's flat region is `footSoleFlat()` = `0.0334 x 0.0434` half-extents, and `SOLE_LIGHT.radius` is `0.023` with `stretchZ 1.6`.
The plume halo's top radius of `0.024` is the sole light's radius rounded up by a millimetre, so the beam reads as emerging from the pad exactly.
It must be checked against `footSoleFlat()` in a test and not against `FOOT.topRadius`: the sole light has already shipped invisible once and come within 2.3 mm of overhanging the rim twice, and that is the trap this is walking into.

**Apply `stretchZ 1.6` on the instance's Z scale**, matching the sole light, so the plume is an oval along the foot rather than a circle. A non-uniformly scaled cylinder is exactly an elliptical cylinder and its normals stay correct through the normal matrix.

### 7.3 Where the mesh lives, and why not under the character

**The `InstancedMesh` lives outside the `RigidBody`, beside `ContactBlob`, and copies the foot's world position each frame.**

Two reasons, and the second is a rendering bug rather than a preference.

The root carries a volume-preserving squash whose scale is non-uniform by construction: `squashScale` returns `sx = w * lateral`, `sy = s`, `sz = w / lateral` with `lateral = 1.1`, so `sx != sz` always.
A cone parented under that is **sheared**, not scaled, and a sheared cone has a visibly elliptical, wobbling cross-section that swims through the takeoff stretch.
`ContactBlob` sits outside the body for the identical reason and its comment says so.

The second reason is cost: one mesh outside the hierarchy is one draw call for both feet, where two meshes parented to two foot nodes are two.

Read the foot world transform from the rig, which `RobotModel` already holds:

```
rig.footL.getWorldPosition(v)     // then compose the instance matrix from v,
                                  // the character's facing yaw, and the envelope
```

Take **position and the character's yaw only**, never the foot's full world quaternion and never its scale.
The beam points along world down, offset by the pose's foot pitch, and inheriting the squash scale through the matrix is the bug this section exists to prevent.

### 7.4 Colour and emissive

This project has hard rules and they are in art bible section 1.
`BLOOM_THRESHOLD` is **1.45** in `src/art/materials.ts`, which is lower than the 1.75 the bible's prose still quotes; the bible predicted it would fall and it has.
`emissiveIntensity = glow * BLOOM_THRESHOLD / luma709(linear(colour))`, so a `glow` of 1.0 sits exactly on the threshold for every hue.

| Layer | Colour | Linear luma | `glow` | `emissiveIntensity` | Peak linear luminance | Blooms |
| --- | --- | --- | --- | --- | --- | --- |
| Plume core | `#e8fbff` | 0.9337 | `GLOW.bloom` 1.25 | 1.941 | 1.813 | **yes** |
| Plume halo | `palette.visor` `#4de2ff` | 0.6319 | 0.90 | 2.065 | 1.305 | no |
| Landing beam | `palette.visor` `#4de2ff` | 0.6319 | `GLOW.source` 0.66 | 1.515 | 0.957 | no |

**This is the bible's mandatory pale-core-plus-coloured-halo construction, applied for a reason the rule does not literally cover, and it is still the right construction.**
The automatic guard in `emissiveIntensityFor` throws only below a linear luminance of 0.35, and `#4de2ff` at 0.6319 is comfortably above it, so cyan *would* normalise.
The rule's stated purpose is that a saturated surface bright enough to bloom "renders as blown-out white and loses its colour entirely", and that is exactly what happens to a thruster: a cyan cone pushed past 1.45 tone-maps to a white cone with a faint blue fringe, and the effect loses the one thing it is for.
So the core is near-white and blooms, the halo is saturated and sits at 0.90 of the threshold, and the colour survives.

**`#e8fbff` rather than `#ffffff` for the core.**
Pure white at `GLOW.bloom` gives `emissiveIntensity` 1.813 and reads as a hole in the image.
`#e8fbff` keeps a 6% blue lift, so even the blown-out centre carries the ally hue, and it costs nothing.

**`palette.visor` is the correct hue and it is a semantic choice, not an aesthetic one.**
`00-references.md` section 5 records it as **[DOC]**: blue LED means ally, red LED means enemy, globally and without exception.
The visor already uses it, the sole lights already use it, and a thruster in any other colour would be the character's own hardware speaking a different language from its face.

### 7.5 Blending

**Class 3, deliberate bloom, and the classification is argued rather than assumed.**

`05-character-vfx.md`'s blending policy has three classes, and the art bible's hard rule is that dust and debris use `NormalBlending` and **only energy effects use `AdditiveBlending`**.

A thruster is the archetypal energy effect.
It is light, it is meant to be seen through, and a normal-blended cone would read as a solid plastic tube stuck to the boot.
So additive, `depthWrite: false`, and the question is only which additive class.

**Class 2's peak cap of 0.24 does not apply and forcing this into it would be wrong.**
That cap is derived for *particle clusters*: its whole justification is that uniform random sampling of a disc produces coincident quads and six of them stack past the threshold.
A thruster is two fixed cones 0.29 m apart, allocated by construction, that cannot coincide with anything including each other.

**Class 3 fits exactly and both of its limits are met with room to spare.**
`maxAlive` is 6 against a cap of 32.
Peak linear luminance is 1.813 against a cap of 4.2.
Class 3's additional requirement is spatial separation by construction, which two feet on a rigid body satisfy trivially.

`side: FrontSide` on the plume, so the far wall of the cone is not drawn and the additive contribution never doubles on itself.
`renderOrder` 3, matching `billboardAdd`, so it composites after the contact shadow at 1.

**The one place it could still blow out, and the rule that prevents it.**

The sole light deliberately uses `GLOW.source` rather than `GLOW.bloom`, and its comment gives the reason: a bloom on a downward-facing surface a few millimetres off the ground would halo onto the floor and fight the contact blob, which is the highest value-per-cost item on the character.

A thruster fires in mid-air at an apex of 2.84 m, so that argument does not apply at the moment the effect matters.
It applies again on the way down.

> **The beam's alpha is multiplied by `smoothstep(0.25, 0.60, ground.distance)`.**
> Below 0.25 m of ground clearance the beams are fully off, and they cannot halo onto the contact blob.

`GroundSample.distance` is already computed once per frame in `PlayerController`'s ray, already accounts for the 0.10 m ray offset above the sole, and already has three consumers. This is the fourth. No new raycast.

### 7.6 Animation: birth, sustain, death

All three phases are `thrusterEnvelope(age)` from section 6, and all three are pure.
Nothing here holds state.

**Birth**, 0 to 45 ms.
Length runs `easeOutBack` to 1.098 and settles.
Width and alpha run `easeOutCubic`, so the beam is at full brightness before it is at full length, which reads as ignition rather than as extrusion.
The sole light lifts from `GLOW.source` to `GLOW.bloom` on the same curve, so the pad flashes as the jets light. That costs zero triangles and is the cheapest half of the whole effect.

**Sustain**, 45 ms to `T`.
Length at `1 + 0.055 * sin(2*PI*22*age)`.
Alpha and width constant.
The landing beam's length is re-solved each frame from `ground.distance`, so it tracks the surface under the character and shortens as the ground rises.

**Death**, `T` to `T + 110 ms`.
Length `easeInCubic` to zero.
Alpha holds until 0.45 of the window then `1 - easeInQuad`.
The order matters: the beam retracts before it fades, which reads as the fuel cutting off. Fading first and retracting after reads as a dissolve.

**Interruption.**
A landing, a ceiling bonk or a death during the burn must kill the beam immediately rather than let it run its tail.
Set `thrust = 0` and `thrustAge = T + DECAY` in the same branch that fires `EV.Land`, `EV.Bonk` or `EV.Death`.
A plume still burning while the character is squashed on the floor is the most visible possible version of this effect going wrong.

### 7.7 Cost

| | |
| --- | --- |
| Geometry | one `CylinderGeometry(_, _, 1, 8, 1, true)`, **16 triangles** |
| Instances | 6 |
| **Triangles when burning** | **96** |
| **Triangles when idle** | **0**, the mesh sets `visible = false` |
| **Draw calls** | **+1**, and only while burning |
| Shadows | `castShadow: false`, `receiveShadow: false`. An additive beam has no business in the shadow map. |
| Per-frame CPU | 6 matrix composes and one `getWorldPosition` per foot |
| Allocations | zero. Pre-allocate the `Matrix4`, `Vector3` and `Quaternion` at module scope, the same pattern the scratch vectors in `PlayerController` use. |

96 triangles against the grass field's 1.43M is not measurable, and the draw call is the real cost.
One is the correct answer and six meshes would be the wrong one.

**Tier gating.**

| Tier | Plume halo | Plume core | Landing beam |
| --- | --- | --- | --- |
| `low` | yes | yes | no |
| `medium` | yes | yes | yes |
| `high` | yes | yes | yes |

The plume runs at every tier, including `low`.
Art bible section 7 is explicit that `low` keeps the rim and the contact blob "because those are what most help a weak image", and the same logic holds here: the plume is the only thing telling the player the move happened.
`low` must still get cheaper overall, and it does, because it drops two of the six instances.

**Do not route this through the particle system.**
`src/art/vfx/` does not exist, `particleBudget` is `0` at all three tiers, and `?gfx=vfx` is deliberately excluded from `GFX_ENABLEABLE` because "there is no number to restore".
Section 9 of `05-character-vfx.md` specifies a pool and a ring allocator that have not been built.
Building the thrusters as a small dedicated instanced mesh is both cheaper and shippable today; building them as the first client of an unwritten particle system is how this feature does not land.

Gate it on its own flag, `?nogfx=thrust`, added to `GFX_SYSTEMS` and to `GFX_ENABLEABLE`, because unlike `vfx` and `face` there is a real system behind the gate.

---

## 8. The character animation

The vocabulary is `robotPose.ts` and `animTuning.ts`.
Nothing below adds a joint, a spring or a pose field, which means `robotPose.test.ts`'s key-stability assertions and `springs.test.ts`'s table assertion are both untouched.

### 8.0 The two things the reference actually says about the hover pose

**The leg splay, the arm position and the torso pose during a hover are not documented anywhere.** Everything in 8.1 through 8.3 is [REC].

Two published statements bear on it and both are worth having on the record.

**[DOC] There were wings.**
Nicolas Doucet, Studio Head, Team ASOBI: "In the original design whenever Astro hovered, **two little wings came out of his back** for him to glide. You don't really notice them, but we wanted to create a rationale behind the function." ([PS Blog, the evolution of Astro's design](https://blog.playstation.com/2024/08/26/the-evolution-of-astro-bots-adorable-character-design/))

That is the reference's own answer to "what does the body do during a boost", and the honest reading of it is that the answer is *almost nothing you notice*.
It is a deliberate argument against a large pose change.
**Do not build wings.** The character already carries a cape at the same socket - `REST.capeRoot` is `(0, 0.06, -0.29)`, coincident with `backpack` - and a second thing growing out of the same point during a 200 ms burn would read as a bug.
What survives from the note is the principle: give the function a visible rationale, and the beams already are one.

**[DOC] The body is built around "a low center of gravity and a compact frame"** (same source).
`00-references.md` and `WADDLE`'s comments both lean on this already, and `TURN_ANIM.bankAmount`'s doc comment says outright that a deep lean fights it.
The same constraint applies here: the burn pose extends the limbs and does **not** tip the torso.
Every angle in 8.3 is on a leg, a foot or a shoulder. `hips.rx` and `hips.rz` are untouched.

### 8.1 The new constants

```ts
/** The second jump's pose. Depths and angles only; every recovery is an existing spring. */
export const AIR_JUMP_ANIM = {
  /** Stretch depth on the boost, on the 'takeoff' profile. Below SQUASH.takeoffStretch 1.18. */
  stretch: 1.14,
  /** How fast the burn pose blends in and out, as an exponential damping rate. */
  blend: 26,
  /** Legs straighten out of the air tuck. The air pose sets rx to -0.5; this cancels most of it. */
  legStraighten: 0.42,
  /** Stance opens, same sign convention as LANDING.legSplay: left negative, right positive. */
  legSplay: 0.20,
  /** Toes point down at the jets. */
  footPoint: -0.16,
  /** Arms swing back out of the air tuck. */
  armBack: 0.55,
  /** And flare away from the body, same convention as LANDING.shoulderRoll. */
  armFlare: 0.42,
  /** Antenna impulse multiplier against ANTENNA.eventImpulse. Sharper than a ground jump. */
  antennaImpulse: 1.15,
  /** Head lift impulse, as a fraction of HEAD.landImpulse, negated. */
  headImpulse: 0.5,
  /** Face hold after the boost, seconds. */
  expressionHold: 0.4,
} as const
```

### 8.2 The pose at the moment of the press

**The takeoff stretch, reused.**
`pushSquash(anim.current, AIR_JUMP_ANIM.stretch, 'takeoff')` in the same branch that fires `EV.AirJump`.
`1.14` rather than `SQUASH.takeoffStretch`'s `1.18`, because the second jump is the smaller move and the eye expects it to be.
`SPRINGS.squashTakeoff` at omega 11, zeta 0.62 recovers it over 364 ms, which is 97% of the 377 ms rise to the new apex.
That is a coincidence and a fortunate one: the stretch reads through the entire boosted climb and is gone at the apex, which is precisely what the profile was chosen for on the ground jump.

**The head needs no new code and gets the beat for free.**
`HEAD.nodGain` drives the pitch spring off vertical acceleration.
Setting `vy` from 0 to 6.396 in one 16.7 ms step is an acceleration of 384 m/s^2, which asks for -3.84 rad and clamps to `HEAD.nodClamp` 0.22.
So the head snaps to its full lift on the impulse frame, exactly as it does on the ground jump.
Verify this rather than assume it: it is the kind of thing that is already true and gets re-implemented anyway.

**The event impulses**, added to `applyEventImpulses`:

```
EV.AirJump ->
  impulse2(rt.springs.antenna[0], -ANTENNA.eventImpulse * AIR_JUMP_ANIM.antennaImpulse * a, 0)
  impulse1(rt.springs.headPitch, -HEAD.landImpulse * AIR_JUMP_ANIM.headImpulse * a)
  rt.face.expression = EXPRESSION.Happy
  rt.face.expressionHold = AIR_JUMP_ANIM.expressionHold
```

**`EXPRESSION.Happy` and not `Surprised`.**
`00-references.md` records animation director Jamie Smith's direction to animate from **how children express joy** [DOC].
A boost is a thing the player chose to do and got away with. Surprise is for the bonk and the landing.

### 8.3 The pose through the burn

One blend scalar, one exponential ease, added to `stepAnim`.
The ease is frame-rate independent and matches the convention `TURN_ANIM.damping` and the camera already use.

```
const burnTarget = s.thrust > 0 ? 1 : 0
rt.burn += (burnTarget - rt.burn) * (1 - Math.exp(-AIR_JUMP_ANIM.blend * step))
const burn = rt.burn
```

At `blend: 26` the pose reaches 65% in 40 ms and 99% in 177 ms, so it arrives with the ignition and releases over roughly the plume's decay tail without being told about it.
`rt.burn` is one float on `AnimRuntime` and must be reset in `resetAnimRuntime`.

Applied additively, after the existing air tuck and before the landing block:

```
out.legL.rx += AIR_JUMP_ANIM.legStraighten * burn
out.legR.rx += AIR_JUMP_ANIM.legStraighten * burn
out.legL.ry += -AIR_JUMP_ANIM.legSplay * burn
out.legR.ry +=  AIR_JUMP_ANIM.legSplay * burn
out.footL.rx += AIR_JUMP_ANIM.footPoint * burn
out.footR.rx += AIR_JUMP_ANIM.footPoint * burn
out.shoulderL.rx += AIR_JUMP_ANIM.armBack * burn
out.shoulderR.rx += AIR_JUMP_ANIM.armBack * burn
out.shoulderL.rz += -AIR_JUMP_ANIM.armFlare * burn
out.shoulderR.rz +=  AIR_JUMP_ANIM.armFlare * burn
```

**The signs are not free choices and getting them wrong is the likeliest defect here.**

The air pose sets `tuck = 0.5` and writes `legL.rx = swing - tuck`, so the legs sit at `rx = -0.5` in the air.
Forward at `rotation.y = 0` is `+Z` (art bible section 6), and a positive `rx` carries a downward-hanging limb toward `-Z`, which is *behind*.
So a negative `rx` carries the legs *forward*: the air pose tucks the knees up in front, which is right for a passive fall and wrong for a thruster pose.
`legStraighten` is **positive** and takes the legs from -0.50 to -0.08, nearly straight down under the body, pointing at the jets.

`legSplay` follows `LANDING.legSplay`'s convention exactly - left gets the negative, right gets the positive - so the stance opens rather than scissoring.
`armFlare` follows `LANDING.shoulderRoll`'s convention for the same reason.
`armBack` is positive, cancelling the arms' own `-tuck * 1.4 = -0.70` forward tuck and carrying them back and out.

**The read, in one sentence:** the body stretches, the knees drop out from under it, the feet point at the ground, and the arms fling back and out, which is what a person does when something shoves them upward.

**The anticipation block already does the right thing and must not be duplicated.**
`ANTICIPATION`'s honest note says an unbuffered jump substitutes "the body going up while the legs go down".
The air jump is unbuffered by definition, and the `rising` branch fires on it, so the knee compression and foot trail run for the first three frames and then hand over to the burn pose.
That overlap is correct and produces a fold-then-extend that nobody has to author.

### 8.4 The landing

**Unchanged, and it improves for free.**

The fall from 2.838 m arrives at 14.29 m/s against a `JUMP.maxFallSpeed` of 28, so the landing strength is 0.511 where the single jump gives 0.359.
Every existing landing term scales by that: the squash deepens from 0.921 to 0.888, the shadow's radius spike grows, the antenna whips harder, and the head nods further.
Nothing in `LANDING` needs a new number and nothing should get one.

**One guard.**
Zero `thrust`, `thrustAge` and `rt.burn` on the frame the character becomes grounded, before the landing squash is pushed.
A burn pose blending out over 177 ms while a landing squash is blending in produces legs that splay outward on impact, which is the opposite of what a landing does.

---

## 9. Tests: what breaks, and what has to be written

### 9.1 What this change breaks

| Test | Status | Why |
| --- | --- | --- |
| `movement.test.ts`, "does not double jump from a single press" | **Passes, and is load-bearing.** | It presses once grounded, then steps airborne with `jumpPressed: false, jumpHeld: true`. The air jump keys on the edge, so it stays false. This test is the guard on section 3.3's non-negotiable rule and it should be renamed to say so, not deleted. |
| `movement.test.ts`, the `run()` helper and every `stepVertical` test | **Passes.** `run()` spreads the state and the new fields flow through. No test asserts on the whole state object. |
| `movement.test.ts`, `stepHorizontal` tests | **Breaks.** Section 5.3 changes the signature from `grounded: boolean` to `control: number`. Mechanical: pass `1` where it passed `true` and `MOVEMENT.airControl` where it passed `false`. |
| `movement.test.ts`, coyote tests | **Passes**, but section 3.3's coyote interaction needs a new test of its own. See 9.2. |
| `springs.test.ts`, "the SPRINGS table" | **Would break if a spring were added.** Line 226 asserts `Object.keys(expected).sort()` equals `Object.keys(SPRINGS).sort()`. **This spec adds no spring**, deliberately, and reuses `squashTakeoff`, `headPitch` and `antennaBase`. If a future revision adds one, that test's `expected` table must move in the same commit. |
| `robotPose.test.ts`, pose key stability at lines 320-328 | **Passes.** No pose field is added. |
| `robotPose.test.ts`, the airborne pose tests around lines 303-320 and 396-410 | **At risk.** They step with `grounded: false` and assert on the air pose. `RobotAnimState` gains `thrust`, and `createRobotAnimState` must default it to `0` so those tests see `burn = 0` and the pose is unchanged. If they build the state literal by hand rather than through the factory, they will need the field. Check each one. |
| `animEvents.test.ts`, "round-trips every payload field for every kind" | **Passes.** It iterates `Object.values(EV)`, so `EV.AirJump` is picked up automatically. |
| `robotGeometry.test.ts`, the `SOLE_LIGHT` clearance tests | **Passes**, and section 7.2's beam radius needs a new one beside them. |

### 9.2 New tests, all in `.ts` and never `.tsx`

`vitest.config.ts` globs `src/**/*.test.ts` and a `.test.tsx` is silently skipped, which is the failure mode `05-character-vfx.md` section 12 opens by warning about.

**`movement.test.ts`**

1. An air jump fires on an in-air press after `lockout` and sets `vy` to `AIR_JUMP.velocityFraction * JUMP.velocity` exactly.
2. An air jump pressed inside `lockout` does **not** fire and does not consume `airJumps`.
3. `airJumps` reaches 0 after one use and does not refill for the rest of the airtime, however long.
4. `airJumps` refills within one step of `grounded` becoming true.
5. Holding jump for 120 consecutive airborne steps produces exactly one air jump.
6. A coyote-time ground jump leaves `airJumps` at `AIR_JUMP.count`.
7. A press after coyote expiry spends the air jump, not the ground jump.
8. Integrated arc: from a standing jump, press again at the step nearest the first apex, integrate to the new apex, and assert it lands in **2.80 to 2.88 m**.
9. Total airtime from that sequence is **1.09 to 1.14 s**.
10. Gravity during the burn is `JUMP.gravity * AIR_JUMP.thrustGravity` while `vy > 0`, and reverts on the step `thrust` reaches 0.
11. The fall gravity is `JUMP.gravity * JUMP.fallGravityMultiplier` during the burn too, so the burn never lightens a descent.
12. `lockout >= (1 - velocityFraction) * JUMP.velocity / |JUMP.gravity|`, asserted against the constants so the derived floor in 3.1 cannot silently stop holding.

**`thrusterEnvelope.test.ts`**

13. `thrusterEnvelope(0).length === 0` and `.alpha === 0`.
14. Length peaks at `THRUST_FX.igniteOvershoot`, within 1e-3, inside the ignition window.
15. Length is exactly 0 at `age >= thrustTime + THRUST_FX.decayTime` and strictly positive just before it.
16. `THRUST_FX.flickerHz < 30`, asserted, with the Nyquist reason in the test name.
17. The envelope is finite for every `age` in `[-1, 10]`, including NaN input, because a garbage age must produce a missing beam and never a NaN in a matrix.

**`robotPose.test.ts`**

18. With `thrust > 0`, `legL.rx` is greater than with `thrust === 0` at the same air state, and both feet move by the same amount.
19. `legL.ry` and `legR.ry` are equal and opposite through the burn.
20. The burn pose is exactly zero on the first step after `grounded` goes true.
21. An `EV.AirJump` event pushes an antenna impulse of the opposite sign to `EV.Land`'s.

**`robotGeometry.test.ts`**

22. The plume halo's top radius is strictly inside `footSoleFlat().x`, with at least 5 mm of margin, matching the assertion already guarding `SOLE_LIGHT`.

---

## 10. Acceptance criteria

Measured, not judged.
`window.__dev` in `src/dev/DevHooks.tsx` and the tools in `tools/critique/` are the harness; read `tools/critique/README.md` and `docs/design/99-handoff.md` first, because a critique loop built on screenshots inherits every bug in the screenshot path and eight such bugs have been found so far.

**`PlayerController` must expose four new fields on `window.__player` or none of this is measurable:** `airJumps`, `thrust`, `thrustAge`, and `airJumpCount` beside the existing `jumps`.

### 10.1 Physics

Run on flat ground, from rest, with `__player.resetPeak()` called immediately before each trial.
`peakY` is the capsule centre, which sits `BODY.capsuleHalfHeight + BODY.capsuleRadius = 0.70 m` above the sole, so height above rest is `peakY - restY`.

| # | Criterion | Pass band |
| --- | --- | --- |
| P1 | Single jump apex above rest | 1.38 to 1.42 m, i.e. **1.01 to 1.05 body heights** |
| P2 | Double jump apex above rest, second press at the first apex | 2.80 to 2.88 m, i.e. **2.06 to 2.12 body heights** |
| P3 | Physics steps from the second press to the new apex | 21 to 24 steps, i.e. **350 to 400 ms** |
| P4 | Total airtime, doubled | 65 to 69 steps, i.e. **1.08 to 1.15 s** |
| P5 | Airtime ratio, doubled over single | **1.75 to 1.85** |
| P6 | Double jump apex with the second press at `lockout` expiry | 2.21 to 2.29 m |
| P7 | `airJumps` after one air jump, sampled every step until landing | exactly 0, every step |
| P8 | Steps between `grounded` going true and `airJumps` returning to 1 | 0 or 1 |
| P9 | Holding space through a full jump and landing | `airJumpCount` unchanged |
| P10 | 200 consecutive frames of `jumpHeld` while airborne | `airJumpCount` increases by 0 |

### 10.2 The beams

Capture with the harness pinned: `__r3.ready()` must return `settled: true` and a buffer of `[1660, 934]`, and progression must be pinned, or the frames are not comparable.

Add a vantage, or use `devBridge.teleport` plus `__dev.freeze()` to hold the character mid-burn at a known `thrustAge`.
`__dev.sample(x, y, w, h)` boxes are in **buffer pixels**, so the drawing buffer must be pinned first.

| # | Criterion | Pass band |
| --- | --- | --- |
| V1 | Beam is visible at all. A 12x12 box on the left plume core at `thrustAge = 0.12 s`, against the same box with `?nogfx=thrust` | display luma rises by **at least 0.30** |
| V2 | The core reads as light | display luma **>= 0.92** |
| V3 | The halo reads as cyan, not white. A 10x10 box at 0.6 of the plume length | blue minus red **>= 0.25**, and display luma **0.60 to 0.82** |
| V4 | The core blooms and the halo does not. Same two boxes, with `?nofx` and without | core differs by **>= 0.06**, halo by **<= 0.02** |
| V5 | The beam does not halo the contact blob. Character held 0.20 m above the ground with `thrust > 0`, a 24x24 box centred on the blob, against the same frame with `?nogfx=thrust` | luma differs by **<= 0.01** |
| V6 | Ignition overshoot is visible. Beam pixel length at `thrustAge = 0.045` against `thrustAge = 0.15` | ratio **1.06 to 1.13** |
| V7 | The beam is gone. A frame at `thrustAge = thrustTime + decayTime + 0.02` | identical to `?nogfx=thrust` within 1/255 on every sampled box |
| V8 | Cost. `__dev.budgets()` burning against idle | triangles **+96 exactly**, draw calls **+1 exactly** |
| V9 | Nothing burns when nothing should. `__dev.budgets()` standing on the ground against `?nogfx=thrust` | triangles and draw calls **identical** |
| V10 | Greyscale readability, art bible section 8. Desaturate a burning frame with `magick -grayscale Rec709Luma`, never `-colorspace Gray` | the beam does not put any pixel of the walkable deck outside the 0.56 to 0.74 gameplay band |

**V5 is the one most likely to fail** and it is the reason the `smoothstep(0.25, 0.60, ground.distance)` gate exists.

**Do not ask ImageMagick for any of these numbers.** `frame.mjs` reads raw RGB and does the arithmetic in the same convention as `__dev.sample()`. IM7's `-fx` disagrees with the eyedropper convention by about 0.18 of luma, which is wider than a whole value band.

### 10.3 Drift

| # | Criterion | Pass band |
| --- | --- | --- |
| D1 | Unit test, 3600 steps of repeated jump-and-boost | `thrustAge + thrust === AIR_JUMP.thrustTime` for every step where `thrust > 0`, to 1e-9 |
| D2 | The beam's envelope is never sampled from any clock other than `anim.thrustAge` | grep `FootThrusters.tsx` for `performance.now`, `Date.now`, `gameClock`, `useFrame((state)` reading `state.clock`. All must be absent. |

D2 is a grep rather than a measurement on purpose.
Drift is not something to detect after the fact; it is something to make unrepresentable, and the way to check that is to read the code for the second clock.

---

## 11. What I could not find, stated so nobody fills it in

- **No frame data of any kind for Astro's hover.** Not on speedrun.com's Astro's Playroom guides or forums, not in the CEDEC 2025 physics and graphics session, not in the CEDEC 2025 level design session (which gives 30 principles and no movement metrics), not in the GDC 2025 "Making of Astro Bot" talk, not in the GDC 2019 Rescue Mission talk, not in Digital Foundry's PS5 analysis. The only duration figure anywhere is a guide's "a couple of seconds", and that is a journalist's estimate.
- **No published apex height, airtime, gravity, air-control value, coyote window or buffer window** for any Astro game, in absolute units or in body heights.
- **No usable figure for Astro's own height.** The one number in circulation comes from a Top Trumps card and contradicts itself between 22.9 and 30 cm. Every height in this file is therefore a ratio.
- **No easing curve, ramp time, or thrust profile.** Section 6 is entirely [REC].
- **No citable colour for the thruster beams.** The brief says blue and blue is almost certainly right, but the only text found is an unverifiable Fandom snippet. `palette.visor` is chosen because the project's own ally-blue rule is [DOC], not because a pixel was sampled. See 7.1.
- **No beam length, shape or count** in any source. Section 7.2 is [REC] sized against this project's own foot geometry.
- **No documentation of the boost pose**, beyond Doucet's note that the original design used back wings and that "you don't really notice them". Section 8 is built from the project's own animation vocabulary and from the general principle in `00-references.md` that Team ASOBI animate from how children express joy, which is [DOC]. The specific angles are [REC].
- **No DualSense haptic documented for the basic laser-hover.** Thruster haptics are documented for the Barkster jetpack power-up, which is a different system. If a rumble is ever added here, it is invented.
- **The CEDiL slide PDF for CEDEC session 3198 is behind membership** and is the one document that might contain real numbers, as `00-references.md` already notes.
- **One claim discarded.** A search snippet attributed to a Fandom wiki read "after his first two jumps, if the jump input is held, he shoots out two blue lasers". It is the only text anywhere implying two jumps precede the hover, it contradicts every control listing and Sony's own "laser-hover" framing, and the page could not be loaded to check its context. Discarded rather than reported as a conflict.

If someone later obtains frame-accurate reference data, the numbers to revisit in order of leverage are `thrustTime`, `velocityFraction`, then `thrustGravity`.
The pose and the VFX are independent of all three.

---

# What actually shipped

Written by the integrator after building it. The spec above is the research; this is the record of where the build agreed with it, where it did not, and what could not be verified.

## The mechanism

One block of constants, `AIR_JUMP` in `tuning.ts`, because a discrete double jump and a timed hover are the same mechanism with one constant moved.
Both are "a press in the air sets a vertical velocity and opens a window during which gravity is reduced"; a double jump is that window at zero and a hover is that window at a few hundred milliseconds.
Building the general form cost nothing and means the choice between them stays a number rather than a rewrite.

Shipped as the **double jump**, which is what the brief asked for.
The research's finding that the reference is a hover - Sony's own term is "laser-hover", and every control listing maps it to HOLD - is recorded in `AIR_JUMP`'s own doc so the next person does not have to rediscover it.

| | spec | shipped |
| --- | --- | --- |
| `velocityFraction` | 0.78 | 0.78 |
| `thrustTime` | 0.20 s | 0.20 s |
| `thrustGravity` | 0.45 | 0.45 |
| `lockout` | 0.12 s | 0.12 s |

The velocity is SET rather than added, so a press at the apex and a press on the way down give the same result from the same button.
That is asserted directly: `peakAfter(15)` equals `peakAfter(45)` to ten places.

## Two places the build differs from the spec

**The filenames.** The spec names `thrusterEnvelope.ts` and `FootThrusters.tsx`; the build had already created `thruster.ts` and `FootThruster.tsx` in parallel.
Same design, and the build's names are kept because the component is singular - one instance per foot, mounted inside each foot group - and `thruster.ts` holds the shape as well as the envelope.

**The draw calls.** The spec says +1. It is **+4**: core and halo need different materials and the two feet sit under different transforms, so nothing merges.
96 triangles is as specified.

## The beam was rebuilt after the first frame

It shipped first as a single additive cone in `palette.visor`, which is legal - at linear luminance 0.6319 it is above the 0.35 floor below which the bible mandates a pale core.

**The frame said no.** A single additive cone at `GLOW.bloom` blooms to white and loses its colour: two white beams with a cyan fringe, which is a thruster with the blue burned out of it.
Rebuilt to the bible's two-element construction - `#e8fbff` core at `GLOW.bloom` inside a `#4de2ff` halo at 0.90, deliberately under the threshold so the colour survives - and the cyan sheath now reads around a hot white middle.

That is the pale-core rule earning its place on an emissive it does not formally apply to, which is worth knowing: the 0.35 floor is where the rule becomes mandatory, not where it stops being right.

## The timing, and the one thing that is not obvious

The envelope runs on `thrustAge`, a second clock that counts UP from the press and keeps counting past the end of the burn, rather than on `thrust`, which counts down to zero at exactly `thrustTime`.

**The flame deliberately outlives the force by 110 ms.** The gravity cut ends at 0.20 s; a beam that ended there would cut out in one frame and read as a dropped frame rather than as a thruster shutting down.
Gating the VFX on `thrust > 0` makes that impossible to express, which is the whole reason there are two fields, and there is a test that fails if someone simplifies one into the other.

Ignition is `easeOutBack` over 45 ms, peaking near 1.10 - a thruster lights with a pop rather than fading up.
The tail is `1 - t^3`, so the beam looks like it is still burning until it very obviously is not.

## What could NOT be verified, and it is a harness limit rather than a code one

**The mechanic has not been played.** `__dev.capture()` renders correct frames with `__player.steps` stuck at **0**: the driven path advances the render loop and Rapier's stepping does not follow it, so the physics never runs under the harness, and the character is in its rest pose in every frame this project can capture.
Synthetic `keydown` events reach `useInput` correctly and then wait for a step that never comes.

So the dynamics are verified at the unit level only - 63 tests across `movement.test.ts` and `thruster.test.ts`, including the brief's own two claims measured as an arc - and nobody has yet pressed the key twice and watched it.

**The beams were verified to draw**, by `?thrust=<0..1>`, which pins the envelope and bypasses the ground gate.
That flag is the same shape as `?gfx=ao` and `?nobrickmap` and is kept for the same reason: this project has shipped an invisible effect before, twice, on the very sole light this beam comes out of.

The frame it produced is the evidence the beam exists, is the right size against the sole, is attached to the foot rather than to the world, and reads as blue rather than white.
It is not evidence that the burn starts when the key is pressed.

**The first thing the next session should do** is run the game in a foreground tab and press space twice.
Everything above it is checked; that is not.
