# Handoff: where the art overhaul stopped, and what to do next

Written at the end of the session that did the overhaul, for whoever picks it up next.
Branch is `astro-overhaul`, 434 tests green, `tsc` and `eslint` clean.

Read `00-art-bible.md` first. It outranks the five numbered specs, and where it and a spec disagree, it wins.

---

## The one thing to understand before touching anything

**This codebase's problem was never taste. It was that nothing reported when things stopped working.**

Eleven separate failures were found during this overhaul. Every one of them was silent: no exception, no console error in most cases, and in several the *counters still reported success*.
The grass reported 178,988 live instances while drawing zero triangles.
The bloom pass ran every frame and output black.
The vegetation layer went NaN while still submitting 1.3M triangles.

So the working rule for this project is: **prove the thing you just changed is actually drawing.**
`window.__dev.budgets()` and a triangle-delta on `visible` toggling is the check. A clean-looking frame is not evidence.

The full list is in `00-art-bible.md` section 0 and in the git log.

---

## Operational gotchas that will otherwise cost you an hour

**The Chrome window in an agent environment is permanently occluded.** `document.hidden` is true, and Chrome then fires **0 requestAnimationFrame callbacks per second** and clamps `setTimeout` to about 0.6/s. A harness built on rAF does not fail, it *hangs*, and it looks exactly like the renderer having crashed.
`DevHooks` now detects this and drives r3f's loop directly through `advance(timestamp)` under `frameloop: 'never'`, awaiting microtasks. It works with the window buried. If you are driving from a terminal, you do not need to foreground anything.

**If you do foreground the window**, do it with `osascript` searching every Chrome window for the localhost URL, because the tab is often a background tab inside a window belonging to another session. Restore the other session's active tab afterwards.

**`gl.info.render` resets on every `renderer.render()` call**, and the effect composer calls it once per pass. Read naively, this scene contains two triangles. `DevHooks.budgets()` sets `autoReset = false` and resets manually around a frame.

**Teleporting needs `setTranslation`, not just `setNextKinematicTranslation`.** The controller opens every physics step by reading the body's current translation and setting the next one to current-plus-movement, so a pending target is overwritten before it is applied. The first version of the teleport moved nothing and reported success.

**Vantages drift silently.** A vantage whose subject has moved still produces a screenshot, and the screenshot still looks like evidence. Every entry in `src/dev/vantages.ts` carries a `judges` string; before trusting a shot, confirm it actually frames what that string claims.

---

## Verified working

- Tank controls: full throttle and full turn rate combine, measured 6.000 m/s on a 1.985 m arc against 2.0 predicted, 360 degrees unbounded, turn-in-place animated.
- The hub layout: four-lobed Core dais, spur totems, stepped portal stack, pylon ring, real height layering on a 0.40 m grid checked against the jump and autostep numbers.
- Emissives cross the bloom threshold for the first time. Threshold measured at **1.45**, margin 1.51x over the brightest broad surface.
- Character re-proportioned to 2.52 head-heights, head 1.16x the torso width, with a contact shadow, spring secondary motion and an SDF visor.
- Value bands: `palette.band()` asserts at the call site, `palette.test.ts` proves all six values land where they claim.
- Procedural colour LUT, generated in code, 25 tests, shipping enabled.
- Grass and flowers rescaled to a lawn, with player displacement and a correct depth material.

---

## Outstanding, in priority order

**1. Run the critique loop. This is the main remaining work.**
A reviewer that built none of this captures the six vantages at all three tiers, critiques against `00-art-bible.md` and `00-references.md`, and lists specific defects. Build agents fix. Repeat until it stops finding substantive faults.
This is the step that separates "much better" and "professional", and it has not run.

**2. High tier misses the frame-rate bar.** 42.8 fps mean and 31.4 p95 against targets of 55 and 45.
Measured at 5.2 megapixels with `maxDpr 1.75` and `gl.finish()` serialising every frame, so it is a floor rather than the shipping number, but it needs re-measuring on a real display and probably needs real work.
Draw calls are 148 at high against a 120 budget; only `low` (109) clears it.

**3. Depth of field was never built.** `quality.depthOfField` is false everywhere and `PostFX` still holds the stock `<DepthOfField>` in its slot.
**Anyone enabling it must delete the near field first** - `04-post.md` specifies a `FarFieldDepthOfFieldEffect` subclass pointing `nearCoCBuffer` at a 1x1 black texture. Blurring ground the player is about to jump onto is a gameplay regression, and this is the change most likely to make the image worse.

**4. The portal arch is still photographic `stone()`** and visibly comes from a different world than the moulded kit around it. `useMouldedStone` in `textures.ts` has the same shape and is one import. Switching the last call sites is what lets the photographic stone set, `levelAlbedo` and three WebPs be deleted.

**5. The held-back emissives should be revisited.** Stream C2 held the totem node and token crystals below their specced glow because they rendered as bare white spheres and flat pink blades. Every emissive then scaled down 17% when the threshold moved to 1.45, so they may now have headroom. Check against `hub-totem`.

**6. Smaller items:** background parallax layers B1/B2 and rim buttresses were never built (`03-environment.md` 8.2-8.3); idle fidgets, foot IK rays and gaze-at-camera are unbuilt in the character; `src/game/player/robotGeometry.ts` duplicates generators that `src/art/geometry.ts` owns; the travelling pulse on the trunk trace does not exist.

**7. `05-character-vfx.md` has 11 arithmetic errors** found during implementation and listed in that stream's report, including a visor SDF that is invisible as specified. The spec is worth correcting before anyone builds from it again.

**8. The VFX system was never built at all.** `05-character-vfx.md` sections 9 to 11 specify a pooled instanced particle system where the CPU writes initial state once and the vertex shader evaluates the arc, plus ten effects. The event ring buffer that feeds it exists and is timestamped; nothing consumes it.

---

## Where things live

- `docs/design/00-references.md` - the researched Astro brief, with documented and inferred separated. This was lost once before; do not lose it again.
- `docs/design/00-art-bible.md` - the authority, and the cross-cutting decisions.
- `01` through `05` - lighting, materials, environment, post, character and VFX.
- `src/dev/` - the harness. `vantages.ts` is the six fixed shots.
- `src/art/fx.ts` - `?nofx`, `?threshold=<n>`, `?bloomdebug`, `?nogfx=rim,dof,lut,vfx,blob,face`, `?quality=`.
  `?nogfx` is the rollback lever: every new system can be turned off individually with no code change.

## How the work was organised, if you want to repeat it

Five design agents wrote specs in parallel, one per area, each verifying its claims against `node_modules` rather than from memory. That verification is where most of the eleven defects came from.
Then a serial foundation commit turned every shared chokepoint into a stable interface, additively and with no visual change, so five build streams could run concurrently on disjoint files without merge conflicts.
Then one integration pass, serial, because balancing the systems against each other is taste and taste needs one pair of eyes.
The critique loop was meant to follow and did not.
