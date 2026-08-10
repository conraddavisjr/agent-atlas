# Handoff: where the art overhaul stopped, and what to do next

Rewritten at the end of round 3 of the critique loop.
Branch is `astro-overhaul`, 579 tests green, `tsc` and `eslint` clean.

Read `00-art-bible.md` first. It outranks the five numbered specs, and where it and a spec disagree, it wins.

---

## The one thing to understand before touching anything

**This codebase's problem was never taste. It was that nothing reported when things stopped working.**

That was written before the critique loop ran. The loop then spent most of its time proving it again, in a new place: not in the game, but in the harness that photographs the game.

Eight more silent failures have been found, and every one of them produced a valid PNG of the wrong thing:

1. **The frameloop was being taken back.** `frameloop` is a prop of `<Canvas>`, and r3f's `configure` runs on every render of it. The Canvas passes no such prop, so any React re-render reverted `setFrameloop('never')`. `advance(timestamp)` kept rendering, but `update()` only honours the timestamp under `'never'` and otherwise falls back to `clock.getDelta()` - a few tenths of a millisecond on a microtask loop. Every `useFrame` subscriber, Rapier's accumulator included, got a delta two hundred times too small. Forty settle frames became two milliseconds and the character was photographed mid-fall.
2. **The driven path was gated on `document.hidden`,** which does not mean "rAF will fire". A tab can be the active tab of a buried window.
3. **`settled()` counted twenty frames,** about thirty milliseconds on the driven path, shorter than the gap between this scene's two load bursts. Six shots of empty sky came out of that.
4. **`capture()` never checked its own output.**
5. **`devicePixelRatio` changed from 1 to 2** when the window moved display. The buffer went 1660x934 to 2905x1634 and every `sample()` box silently measured the wrong surface.
6. **`cameraFrame.yaw` is never published while the camera is pinned.** `FollowCamera` returns on the override path twelve lines above the only write to it. The rim light aims itself at that value, so **the rim was 98 degrees out in every screenshot ever taken of this game.** Two independent reviewers examined those frames and both concluded the game had no rim light. It has one.

7. **Progression was never pinned,** and it changes the frame. Two capture sets of the same commit at the same tier disagreed by more than the effect they were being compared to measure, while every local probe agreed to within 0.004, because the difference sits on two objects near the centre of frame. Found in round 3. See "The harness".
8. **ImageMagick's own `-fx` and `%[fx:mean]` are not in the eyedropper's colour convention.** They disagree by about 0.18 of luma on these frames, which is wider than a whole value band, and a threshold expression built on them reported 50% of every frame above 0.86 and looked plausible. Anything that measures a frame has to be checked against `__dev.sample()` before it is believed. Found in round 3.

The working rule stands and now has a second half:

> **Prove the thing you just changed is actually drawing** - and prove the thing you are photographing it with is telling you the truth.

`window.__dev` now enforces most of that itself. See "The harness" below.

---

## Where the image actually is

Two independent reviewers, neither of whom built any of it, critiqued the six vantages at three tiers. Round 1's verdict was that **the value structure had been applied to the palette table, not to the frame** - `palette.band()` asserts on an albedo hex while the bible's section 8 test is about what the eye reads off the screen, so `palette.test.ts` was green while the lawn rendered at 0.315 against a gameplay band of 0.56-0.74.

Four build streams fixed against that. Measured movement, all display-space luma on real frames:

| | before | after |
| --- | --- | --- |
| Lawn | 0.22-0.46 | 0.48-0.59 |
| Pylons | 0.085 | 0.16-0.30 |
| Lit deck warmth (R-B) | -22 | -2 |
| Sky share of frame above 0.80 | 46.2% | 22.8% |

Fixed and confirmed visible: the second specular lobe on the shell, the hole in the character's face, the olive-versus-gold dome, the faceted core hull, the photographic granite on the arch (and the entire PBR texture path with it), the pylon value, the island's missing thickness, the magenta cape's colour.

**Round 2's verdict** was that the world had no shadow end, and that everything else was downstream of it: bloom cannot read with nothing dark for light to sit against, the rim cannot read against a shadow side already at 0.55, and the greyscale test cannot pass when three semantic classes share one value.

**Round 3 settled that**, on a narrow brief: handoff items 1 and 9, decided together as one composition call because they were one question. The decision is `97-decision-shadow-end.md`, the three build streams and their falsifications are in `bd78b54`, and the fresh review of the result is `98-critique-round3.md`.

Measured movement across round 3, high tier, all six vantages verified:

| `hub-establishing` | round-3 entry | after |
| --- | --- | --- |
| below 0.10 | 0.00% | 0.14% |
| below 0.20 | 1.60% | 3.12% |
| 0.38-0.56, the gap that should be empty | 21.76% | 16.55% |
| island edge, 90 px down the silhouette | flat 0.230 to 0.202 | 0.232 monotone to 0.116 |
| below 0.20, share in the bottom third | 45.4% | 47.8%, and 56.5% below 0.15 |
| draw calls | 135 | 114 |

The three tiers now agree to 0.12 of a point on the share below 0.20, where they used to spread, which is the tier ladder finally changing fidelity rather than art.

Two rows of round 3's own acceptance table were withdrawn as unreachable, and the reason generalises: they asked a feature whose area is fixed by geometry to carry a given share of the frame. The island's visible underside is 1.16% of `hub-establishing` and appears in one of six vantages. **A frame-share target for a fixed-area feature is a wish, not a criterion.** State acceptance as profiles and locations instead.

The full round-2 report is `98-critique-round2.md`. Round 1's is `98-critique-round1.md`.

---

## Outstanding, in priority order

**1. DECIDED AND IMPLEMENTED in round 3. One part of it failed and that part is now item 11.**
The decision is `docs/design/97-decision-shadow-end.md`: the darkest thing in this world is the ground seen from underneath. A fourth value band, anchor 0.06 to 0.18, membership closed to the island's underside and recessed apertures, and a prohibition on any repeated vertical object entering it.

What settled it was not a new measurement but a different question. Both reviewers were describing the same six per cent of the frame from opposite sides, and neither could resolve it because "how dark should the darks be" has no answer. Thresholding the frame at 0.20 and asking **where** those pixels are answered it in one command: 65% of them in the right-hand third, on the shaded sides of the perimeter pylons, four of which are cropped by the top edge. The darks were in the shape of a cage. `tools/critique/frame.mjs where` is that query and it is now in the repo.

Delivered: the island's visible edge now runs 0.232 monotone to 0.116 down 90 px where it used to be a flat 0.230 to 0.202, and 56.5% of everything below 0.15 is in the bottom third of the frame. Not delivered: see item 11.

**2. Nothing emits light.** Not one emissive in six frames produces a halo. The totem ring transitions to the deck in under 5 px; the portal lintel in one. The only thing crossing the threshold is white plastic and the chrome dome, which is the budget exactly inverted. Two causes: most of the world is authored at `GLOW.source = 0.66`, deliberately below the cut, and the three objects at `GLOW.bloom = 1.25` sit against a sky that ACES compresses their contribution into. Downstream of item 1.

**3. The rim does not read at `hub-backlit`,** now that it is finally aimed correctly and can be judged. Both silhouette edges brighten *inward* - a terminator, not a rim. It does produce a rim elsewhere (`hub-character` peaks at 0.966), so it contributes nothing at this azimuth specifically, where camera bearing and key azimuth coincide by design. Offsetting the rim 35-50 degrees off the camera axis so it can never collapse onto the key is the suggested fix - **and the sky fill has the same defect and should move in the same commit.** At `hub-backlit` and `hub-grazing` every analytic light is within 3.4 degrees of the camera axis and the bounce fill is aimed at `camAz`, so it is on-axis at every vantage by construction. Round 3 deliberately left all of these alone so that round 4 can attribute one de-axialising change. Note also that no intensity change can fix this: a light on the camera axis lights both visible faces of a box equally.

**4. The cape is still a flat quad.** It was recoloured from magenta to `accentDeep` and given nominal thickness, and it still reads as a zero-thickness plane with square corners that casts no shadow on a deck where the body casts a clean one. Round 1's F4 is not closed.

**5. Decoration still out-values the ground.** Pink shards measure 0.69-0.75 with the red channel clipped at 255, against decks at 0.61-0.70. They are `crystal(palette.token, 0.34)` - emissive at a third of threshold over clearcoat 0.85.

**6. The node glass shell is 0.06-0.07 DARKER than the sky it is drawn over,** so every node wears a grey bauble rather than a halo. Make it additive or Fresnel-driven.

**7. The backdrop arc does not read.** Thirteen slabs at 0.796-0.849 against a 0.847-0.886 sky, one flat tone each. In `hub-backlit` one stands in the grass 15 m behind the subject as a blank rounded-rect card with no base and no shadow.

**8. Low tier still ships a floating cable** with both ends square-cut clear of the culled pylon caps, and its meadow is a 200 px strip with the rest bald.

**9. CLOSED in round 3. Ambient occlusion is off at all three tiers.**

The full argument is in `97-decision-shadow-end.md`. The short form: the case for keeping the pass was that it was one of the few remaining sources of dark, and measured on a clean same-origin A/B that case is worth 0.16 percentage points of the share of `hub-establishing` below 0.20 and **exactly nothing below 0.10** in any of the six vantages, against a round whose whole subject was the 0.06 to 0.18 band. Its floor is arithmetic: `mix(scene, color * scene, 1 - ao)` with `color` at `#8fa4cc` puts a fully occluded pixel at 37% of its own value, so on a 0.65 deck it reaches 0.47 and stops.

Re-measured after the round, two alternating pairs, three 10-second runs per load, gated on buffer, progression, settle and triangle count: median ratios **1.93 and 1.95** on mean fps and **2.81 and 3.01** on p95, with the slowest AO-off run at 85.1 and the fastest AO-on run at 50.1. The absolute numbers are far higher than the ones this file used to quote, with nothing changed but the day, which is the warning restated.

`?gfx=ao` turns it back on, so the comparison stays repeatable without a rebuild. `?nogfx` still wins a tie, because the rollback lever has to hold whatever else is in the address bar.

Two things about it worth keeping. The pass was **not** failing at object bases for the reason everyone assumed - it reached fine, there was simply no corner to occlude, see item 12. And it was genuinely earning its cost at flat-on-flat stone junctions, where visibility approaches 0.5 and it laid down a real 0.28 m band; that band is a real loss and whether the authored contact that replaced it is as deep is a question for the round-3 review.

**10. Depth of field was never built,** and `05-character-vfx.md` sections 9-11 (the pooled particle system) were never built. Both unchanged from the previous handoff. Anyone enabling DoF must delete the near field first.

**11. The prohibition on repeated verticals is not met, and it got worse.**

This is the half of item 1 that failed, and it is structural rather than careless. A cast shadow only reads if the ambient is low enough that losing the key matters, and lowering the ambient darkens **every** surface facing away from the key - including eight pylons. A shaded shaft measured 0.185 before the round and **0.138** after, which is deeper into the band the decision forbids them.

Albedo cannot fix it: the pylons' lit and shaded sides sit at 0.365 and 0.138 under a 2.6:1 key ratio, and no single hex puts both inside a band 0.18 wide. So round 4 has three options and should pick one rather than tuning: fewer pylons, a lit-side treatment that is not albedo, or restating the prohibition as being about the shape the darks make at squint rather than about every pixel. **It must not be settled by putting the ambient back**, which would undo the cast shadow this round bought.

**12. Nothing in this world has a corner where it meets the ground.**

`pill(0.34, h)` is a `CapsuleGeometry` translated so the bottom of its lower hemisphere sits exactly on the plane it stands on. That is a sphere tangent to a plane, touching at a single point, with 4 mm of gap 5 cm out - the contact shape that produces the least occlusion of any. The pylons were fixed in round 3 by sinking them by their own radius. **Everything else built from `pill()` has the same defect**, and the Core struts are worse: `baseRadius` 2.10 on a 2.20 puck that drafts 3 degrees inward means the foot already overhangs the puck, so there is no surface under the outboard half at all. That is a modelling defect and it has to be fixed before those bases can be contacted.

---

## The harness

`window.__dev`, and it now proves its own output rather than assuming it.

- `capture(name)` - frames a vantage and **checks the result**. Retries until the frame has both contrast (`drew`) and at least half the triangles the settled scene submitted, then reports `attempts`. The two catch different misses: a white robot alone against sky passes a contrast test easily. `hub-backlit` needs the retry every time.
- `settled()` - waits on wall-clock quiet, watches submitted triangles as well as memory counters, requires the frame to have something in it, and yields real macrotasks so the loading it waits for can happen. Records the reference triangle count that `capture` checks against.
- `framing()` - projects the character's bounds into the frame and reports coverage, centre, clipping and world height. **Run this after anything that changes the character's size.** It caught `hub-character` framing his back with his head cropped, at 1.125 of frame height.
- `sample(x, y, w, h)` - mean sRGB, display luma, band membership and warmth of a rectangle of the RENDERED frame. This is the section 8 test. `palette.band()` is not.
- `pinDpr(n)` - pins the drawing buffer so captures stay comparable. Re-asserted every driven frame, because `dpr` is a Canvas prop and reverts on any render, exactly like `frameloop`.
- `progress()` and `setProgress('all' | 'none' | ids)` - **added in round 3, and it is the seventh thing a vantage was not pinning.** Progression changes the frame: four lesson totems switch between `locked` at 0.383 and `unlocked` at 0.804, and the Core node gains its completion rings. Two capture sets of the same commit at the same tier, one per dev-server port, disagreed by 0.0106 of whole-frame mean luma and 0.9 points of the share below 0.20 - larger than the effect they were being compared to measure - while all five local probes agreed to within 0.004, because the difference sits on two objects near the centre of frame. The save lives in `localStorage`, which is keyed by ORIGIN, so two ports are two save files. It writes through zustand, not `localStorage`, because the persist middleware hydrates once at module evaluation and a late `localStorage` write is silently overwritten. `capture()` now reports the state it was taken at.
- `frameStats()`, `budgets()`, `fps()`, `cameraState()`, `drivenTime()`.

**Progression is now part of a `Vantage`, like the clock and the camera.** `hub-totem` pins four of five lessons, because its `lookAt` is the `what-is-ai` totem and a *completed* totem has no ring: at five of five that shot framed a bare plinth and judged an emissive that was not in the frame. Round 2 reported a totem ring peak of 0.921 alongside a portal lintel peak of 0.948, and the portal is a sealed slab with a lock plate until every basics lesson is done, so those two numbers cannot have come from one save. The cost is that the chrome dome is earned after the whole basics zone, so holding one lesson back removes it from that shot; the dome is judged at `hub-character` and `hub-backlit` instead.

**`tools/critique/` is the rest of the harness, the part that cannot live in the page.** A receiver that writes `toDataURL` output to disk, the in-page driver that pins the buffer and takes a whole-frame histogram, offline frame measurement, and the `osascript` that finds the tab. Its README carries the traps. Three rounds hand-rolled this and each rebuild cost more than the critique.

`frame.mjs where <png> <threshold>` deserves its own line. "How many dark pixels" deadlocked two rounds; "where are they" answered it in one command. When a value question will not resolve, ask about position.

The loop is driven by hand unconditionally now. There was never a reason to prefer rAF.

`?nogfx=rim,dof,lut,vfx,blob,face,ao` is the rollback lever and the bisection tool. `ao` was added during round 2 and immediately earned it.

**Capturing from a terminal.** The window must have non-zero dimensions and the tab must be active, or r3f never measures its container and nothing mounts - a zero-sized or minimised window looks exactly like a crash. `osascript` can un-minimise it (`set minimized of w to false`, not `miniaturized`) and activate the tab; restore the previous active tab afterwards. Target a fixed drawing BUFFER rather than a CSS size, so the numbers survive a change of display.

---

## Things that are true and cost an hour each to rediscover

- **Bloom `radius` is not a kernel width.** In postprocessing's mipmap bloom each rung is `mix(support, tentBlur(coarser), radius)`, so it is the weight given to coarser mips. At 0.6 the mips that make a halo carried 12.8%.
- **`<N8AO>`'s quality preset prop is inert** in the installed version. The wrapper destructures the numeric props and never calls `setQualityMode`, and n8ao matches on capitalised names anyway. Pass `aoSamples` and `denoiseSamples`.
- **n8ao is screen-space and cannot tell the hero from the lawn he is standing in.** With `aoRadius` at blade height it projects the field's depth pattern onto anything standing in it.
- **Do not cast grass into the shadow map.** Two hundred thousand blades do not resolve into shade, they resolve into blade-shaped noise, and every surface samples that map. It put marks on stone decks metres from any grass. Off at all three tiers and pinned by a test.
- **The environment cards were budgeted against a threshold of 1.75** and never re-derived when it was measured at 1.45.
- **`quality.ts` ladders can be silently unapplied.** The sheen ladder is specified false/true/true and shipped false everywhere, so the hero's second specular lobe had never rendered on any tier.

Added in round 3:

- **`scene.environmentIntensity` overwrites `material.envMapIntensity`, so every per-material value in this project is dead code.** `WebGLRenderer` sets the scene value for any Standard or Physical material whose `envMap` is null, and `WebGLMaterials` only writes the material's own value back when `envMap` *is* set. Nothing here sets a per-material `envMap`. Shell 1.15, grass blades 0.6, island skirt 0.4, `flock()` 0.3 - none of them do anything. You cannot dim the environment on the hero without dimming the grass, and the grass's "compensate with `envMapIntensity`" comment does not describe what runs.
- **The hero's shadow side is grey because of `materials.ts`, not the rig.** `shell()` carries `emissive: '#ffb489'` at `emissiveIntensity: 0.08`, a constant warm term on every pixel regardless of lighting - 0.0446 of luma, 23.5% of the shadow side, in a hue nearly opposite the rig's. Zeroing it and changing nothing else takes the shadow side from 0.583 at saturation 0.053 to 0.498 at 0.267, a fivefold chroma change from one constant. It gets worse as fill comes down, because a fixed term is a larger share of a smaller total.
- **The rig is axial, and that is why form does not read at two vantages.** At `hub-backlit` and `hub-grazing` every analytic light is within 3.4 degrees of the camera axis, and the hemisphere has no azimuth at all. A light on the camera axis lights both visible faces of a box equally and contributes zero face-to-face contrast at any intensity. The bounce fill is aimed at `camAz`, so it is on the axis at *every* vantage by construction. No intensity change can produce a terminator here; only an azimuth can.
- **`HEAD_SHELL` is a rounded box, not a sphere, and 59% of its height is one flat normal.** Round 2's "0.04 of value across 170 px of a curved surface" was measured down a column that runs along the corner fillet of a flat face. Before concluding a form does not read, check what the column is actually crossing.
- **For a lathe seen from outside and above, the profile stop of maximum radius IS the lower silhouette.** Everything below it is behind it or back-facing. That one fact explains why three successive attempts at an island underside were invisible, and why the fourth works: it is not about adding geometry, it is about where the widest stop sits.
- **A lathe segment is one conical band with one normal**, so lighting cannot produce a gradient down it however many stops the profile has. If a value ramp is wanted down a skirt, it has to be authored per stop.
- **The vignette runs before tone mapping at `darkness 0.42`, and it is big enough to be mistaken for art.** A 90-pixel column down the island's edge fell 0.029, and 0.028 of that was the vignette. Any value gradient measured near a frame edge has to be corrected for it or it is measuring the post chain.
- **Round 2's F9 was false.** It reported tread-to-riser separation of 0.01 to 0.03 at `hub-portal`; measured on round 2's own capture, clear of the character and the trunk trace, it is 0.28 to 0.38. A reviewer's probe can land on the wrong surface as easily as a builder's can, and the fix that finding asked for would have made the shot worse.

---

## How the work was organised, if you want to repeat it

Two reviewers who built none of it, in parallel and blind to each other, judging captured frames against the bible. Then four build streams on disjoint file sets, with `palette.ts` frozen and owned by the integrator because it is the shared chokepoint - streams request palette changes in their report rather than editing it. Then a serial integration pass, because balancing systems against each other is taste and taste needs one pair of eyes.

Two things worth knowing before running it again.

**Brief the streams to falsify the brief.** The most valuable single result of round 1 was the vegetation stream measuring `grassCastShadow` on and off, finding 0.216 against 0.206, and telling the integrator that the diagnosis it had been handed was wrong. The second most valuable was round 2's reviewer overturning the integrator's own AO diagnosis with a better one.

Round 3 made this the largest section of every brief and it returned more than the implementations did. Every one of the four streams overturned something it had been told, and none of it was reachable from the integrator's chair: that a pylon is a capsule tangent to a plane with no corner to occlude; that round 2's F9 was false by a factor of ten and the fix it asked for would have made the shot worse; that the widest stop of a lathe IS its lower silhouette, so the band everyone had been measuring was a key-lit shelf and 96% of the previous fix was painting geometry no camera can see; that `scene.environmentIntensity` silently overwrites every per-material `envMapIntensity` in the project; and that a cast shadow cannot enter the band the decision assigned it to. Two streams independently proved two rows of the integrator's own acceptance table arithmetically unreachable, from opposite ends, without knowing about each other.

The mechanism that produced that is worth copying exactly. Each brief named the diagnosis, gave the numbers behind it, and then said which specific claim was a reconstruction rather than a measurement. A stream told "this is what I believe and here is the weakest part of it" audits the weak part. A stream told only what to build, builds it.

**Do not let a stream measure the frame.** Round 3 had four working in one checkout and gave all frame measurement to the integrator, serially. That is not only about GPU contention: it is the same reason the integration pass is serial. Four agents measuring four different page loads produce four incomparable numbers, and one of them ran `git stash` in the shared tree to check a baseline, which could have destroyed two other streams' work and did not only by luck.

**A critique loop built on screenshots inherits every bug in the screenshot path,** and two independent reviewers agreeing does not detect that. Both rounds' verdicts on the rim were measuring a camera-pinning bug. Verify the harness before trusting the critique.
