# Handoff: where the art overhaul stopped, and what to do next

Rewritten at the end of the session that ran the first two rounds of the critique loop.
Branch is `astro-overhaul`, 532 tests green, `tsc` and `eslint` clean.

Read `00-art-bible.md` first. It outranks the five numbered specs, and where it and a spec disagree, it wins.

---

## The one thing to understand before touching anything

**This codebase's problem was never taste. It was that nothing reported when things stopped working.**

That was written before the critique loop ran. The loop then spent most of its time proving it again, in a new place: not in the game, but in the harness that photographs the game.

Six more silent failures were found, and every one of them produced a valid PNG of the wrong thing:

1. **The frameloop was being taken back.** `frameloop` is a prop of `<Canvas>`, and r3f's `configure` runs on every render of it. The Canvas passes no such prop, so any React re-render reverted `setFrameloop('never')`. `advance(timestamp)` kept rendering, but `update()` only honours the timestamp under `'never'` and otherwise falls back to `clock.getDelta()` - a few tenths of a millisecond on a microtask loop. Every `useFrame` subscriber, Rapier's accumulator included, got a delta two hundred times too small. Forty settle frames became two milliseconds and the character was photographed mid-fall.
2. **The driven path was gated on `document.hidden`,** which does not mean "rAF will fire". A tab can be the active tab of a buried window.
3. **`settled()` counted twenty frames,** about thirty milliseconds on the driven path, shorter than the gap between this scene's two load bursts. Six shots of empty sky came out of that.
4. **`capture()` never checked its own output.**
5. **`devicePixelRatio` changed from 1 to 2** when the window moved display. The buffer went 1660x934 to 2905x1634 and every `sample()` box silently measured the wrong surface.
6. **`cameraFrame.yaw` is never published while the camera is pinned.** `FollowCamera` returns on the override path twelve lines above the only write to it. The rim light aims itself at that value, so **the rim was 98 degrees out in every screenshot ever taken of this game.** Two independent reviewers examined those frames and both concluded the game had no rim light. It has one.

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

**Round 2's verdict, which is the live one:** the world now has no shadow end. Only 5.1% of `hub-establishing` is below 0.30, against 16.6% in the pre-round baseline. Everything else is downstream - bloom cannot read because there is nothing dark for light to sit against, the rim cannot read because the shell's shadow side is already at 0.55, the steps cannot read because tread and riser are 0.02 apart.

The full round-2 report is `.critique/round2-findings.md`. Round 1's is `.critique/round1-findings.md`.

---

## Outstanding, in priority order

**1. Decide what the darkest thing in this world is.**
This is a composition decision, not a value to tune, and it is why the loop has not converged. Round 1 measured the eight near-black pylons at 0.085 as carrying the highest contrast in the frame and pulling the eye off the portal, so they were lifted to 0.16-0.30. That was correct. It also removed two thirds of the picture's darks, which is round 2's blocking finding. Both reviewers are right. Something has to be the shadow end - a darker soil skirt, a cast-shadow budget, a dark negative-fill card in the environment - and until someone picks, bloom and rim work will keep failing for reasons that are not their own.

**2. Nothing emits light.** Not one emissive in six frames produces a halo. The totem ring transitions to the deck in under 5 px; the portal lintel in one. The only thing crossing the threshold is white plastic and the chrome dome, which is the budget exactly inverted. Two causes: most of the world is authored at `GLOW.source = 0.66`, deliberately below the cut, and the three objects at `GLOW.bloom = 1.25` sit against a sky that ACES compresses their contribution into. Downstream of item 1.

**3. The rim does not read at `hub-backlit`,** now that it is finally aimed correctly and can be judged. Both silhouette edges brighten *inward* - a terminator, not a rim. It does produce a rim elsewhere (`hub-character` peaks at 0.966), so it contributes nothing at this azimuth specifically, where camera bearing and key azimuth coincide by design. Offsetting the rim 35-50 degrees off the camera axis so it can never collapse onto the key is the suggested fix.

**4. The cape is still a flat quad.** It was recoloured from magenta to `accentDeep` and given nominal thickness, and it still reads as a zero-thickness plane with square corners that casts no shadow on a deck where the body casts a clean one. Round 1's F4 is not closed.

**5. Decoration still out-values the ground.** Pink shards measure 0.69-0.75 with the red channel clipped at 255, against decks at 0.61-0.70. They are `crystal(palette.token, 0.34)` - emissive at a third of threshold over clearcoat 0.85.

**6. The node glass shell is 0.06-0.07 DARKER than the sky it is drawn over,** so every node wears a grey bauble rather than a halo. Make it additive or Fresnel-driven.

**7. The backdrop arc does not read.** Thirteen slabs at 0.796-0.849 against a 0.847-0.886 sky, one flat tone each. In `hub-backlit` one stands in the grass 15 m behind the subject as a blank rounded-rect card with no base and no shadow.

**8. Low tier still ships a floating cable** with both ends square-cut clear of the culled pylon caps, and its meadow is a 200 px strip with the rest bald.

**9. Frame rate.** 65.5 mean / 24 p95 at 1660x934 against targets of 55 and 45. Mean clears, p95 does not. **Measure within one page session**: four consecutive runs vary by 0.4 fps, but the same configuration across separate page loads has read anywhere from 46 to 65, so any A/B done across reloads is worthless.

**10. Depth of field was never built,** and `05-character-vfx.md` sections 9-11 (the pooled particle system) were never built. Both unchanged from the previous handoff. Anyone enabling DoF must delete the near field first.

---

## The harness

`window.__dev`, and it now proves its own output rather than assuming it.

- `capture(name)` - frames a vantage and **checks the result**. Retries until the frame has both contrast (`drew`) and at least half the triangles the settled scene submitted, then reports `attempts`. The two catch different misses: a white robot alone against sky passes a contrast test easily. `hub-backlit` needs the retry every time.
- `settled()` - waits on wall-clock quiet, watches submitted triangles as well as memory counters, requires the frame to have something in it, and yields real macrotasks so the loading it waits for can happen. Records the reference triangle count that `capture` checks against.
- `framing()` - projects the character's bounds into the frame and reports coverage, centre, clipping and world height. **Run this after anything that changes the character's size.** It caught `hub-character` framing his back with his head cropped, at 1.125 of frame height.
- `sample(x, y, w, h)` - mean sRGB, display luma, band membership and warmth of a rectangle of the RENDERED frame. This is the section 8 test. `palette.band()` is not.
- `pinDpr(n)` - pins the drawing buffer so captures stay comparable. Re-asserted every driven frame, because `dpr` is a Canvas prop and reverts on any render, exactly like `frameloop`.
- `frameStats()`, `budgets()`, `fps()`, `cameraState()`, `drivenTime()`.

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

---

## How the work was organised, if you want to repeat it

Two reviewers who built none of it, in parallel and blind to each other, judging captured frames against the bible. Then four build streams on disjoint file sets, with `palette.ts` frozen and owned by the integrator because it is the shared chokepoint - streams request palette changes in their report rather than editing it. Then a serial integration pass, because balancing systems against each other is taste and taste needs one pair of eyes.

Two things worth knowing before running it again.

**Brief the streams to falsify the brief.** The most valuable single result of round 1 was the vegetation stream measuring `grassCastShadow` on and off, finding 0.216 against 0.206, and telling the integrator that the diagnosis it had been handed was wrong. The second most valuable was round 2's reviewer overturning the integrator's own AO diagnosis with a better one.

**A critique loop built on screenshots inherits every bug in the screenshot path,** and two independent reviewers agreeing does not detect that. Both rounds' verdicts on the rim were measuring a camera-pinning bug. Verify the harness before trusting the critique.
