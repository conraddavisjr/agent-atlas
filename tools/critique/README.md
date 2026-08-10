# The critique loop's measurement tooling

Three rounds of the art critique loop have now hand-rolled this from scratch, and each time the rebuild cost more than the critique.
It lives here so the fourth does not.

`window.__dev`, in `src/dev/DevHooks.tsx`, is the harness proper and it is the thing that knows how to freeze the world.
This directory is the four pieces around it that cannot live in the page: getting a PNG off the page, measuring it once it is on disk, finding the browser tab, and driving the whole thing from a terminal.

**Read `docs/design/99-handoff.md` before using any of it.**
The rule that matters most is that a critique loop built on screenshots inherits every bug in the screenshot path, and two independent reviewers agreeing does not detect that.
Eight such bugs have been found so far and every one of them produced a valid PNG of the wrong thing.

---

## The pieces

| | |
| --- | --- |
| `shotsink.mjs` | An HTTP receiver. The page cannot write files, so it POSTs `toDataURL()` output here and this writes the PNG. It also serves `harness.js` back to the page, which turns a reload from "paste two hundred lines through a browser tool" into one `fetch`. |
| `harness.js` | The in-page driver, `window.__r3`. Wraps `__dev` and adds the three things it deliberately does not have: a pinned drawing BUFFER, a whole-frame luma histogram, and a way out to disk. |
| `frame.mjs` | Offline measurement of a captured PNG: band occupancy, boxes, one-pixel profiles, a high-frequency-noise metric, a coarse luma map, and dark masks. |
| `focus.sh` | Brings the capture tab to the front. Sounds trivial, is not: see below. |

## Running a capture set

```sh
npm run dev                                          # note the port it picks
node tools/critique/shotsink.mjs 7345 .critique/round4
```

Then, in the browser, per page load:

```js
document.title = 'ATLAS-CAPTURE'                     // so focus.sh can find the tab
```

```sh
tools/critique/focus.sh                              # then wait a few seconds
```

```js
eval(await (await fetch('http://127.0.0.1:7345/harness.js')).text())
await window.__r3.ready()                            // pin buffer, pin progression, settle
await window.__r3.session('round4-high', window.__r3.ALL)
```

Then, on disk:

```sh
node tools/critique/frame.mjs bands .critique/round4/round4-high--hub-establishing.png
node tools/critique/frame.mjs where .critique/round4/round4-high--hub-establishing.png 0.20
node tools/critique/frame.mjs box   .critique/round4/round4-high--hub-establishing.png 774 645 40 40
```

`__r3.ready()` returns what it pinned. Check it. `settled` must be `true` and the buffer must be `[1660, 934]`.
`session()` returns one row per vantage with `ok`, which is `capture()`'s own two-part verification, and you must check it: a `false` there means the frame is missing its world, and the PNG will still open fine.

---

## The traps, all of which have cost a session

**The tab must be visible when the page mounts.** A hidden or minimised or zero-sized window means r3f never measures its container, the canvas stays 300x150, and everything downstream is a valid capture of nothing. Reloading drops activation, so `focus.sh` runs after every navigation. Post-mount, a hidden tab is fine, because the loop is driven by hand and never waits for `requestAnimationFrame`.

**Pin the drawing buffer, not the CSS size.** `devicePixelRatio` changes when the window moves display, and the buffer went 1660x934 to 2905x1634 mid-session with nothing reporting it. `__dev.sample()` boxes are in buffer pixels, so every measurement after that silently described a different surface. `__r3.pin()` sets the wrapper to explicit pixels, fires a synthetic resize because r3f's ResizeObserver has already fired for the old size, and calls `__dev.pinDpr(1)` so buffer pixels equal CSS pixels.

**Pin progression.** It is not part of a vantage and it changes the frame: four lesson totems switch between `locked` at 0.383 and `unlocked` at 0.804, and the Core node gains its completion rings. The save is in `localStorage`, which is keyed by ORIGIN, so two dev servers on two ports are two different save files. Two sets of the same commit at the same tier, one per port, differed by more than the effect they were being compared to measure, and all five local probes agreed to within 0.004 because the difference was confined to two objects near the centre of frame. `__dev.setProgress()` writes through zustand rather than `localStorage`, because the persist middleware hydrates once at module evaluation and a late `localStorage` write is silently overwritten.

**Do not ask ImageMagick for the number.** IM7's `-fx` and `%[fx:mean]` operate after its own colorspace handling and disagree with the eyedropper convention by about 0.18 of luma on these frames, which is wider than a whole value band. A threshold expression built on it cheerfully reported 50% of every frame above 0.86. `frame.mjs` reads raw RGB out of ImageMagick and does the arithmetic itself, in the same convention as `__dev.sample()`: Rec.709 weights on the gamma-encoded bytes. It was checked against the in-page histogram before it was believed, and agrees to four decimal places.

**Do not trust an absolute frame rate from this machine.** One configuration read 65.5 mean fps in one session and 21 to 36 twenty minutes later with nothing changed, while four consecutive runs inside a single session agreed to 0.4 fps, which is what makes the stability misleading. Measure ratios, alternate the two configurations close together, three runs each, and believe a difference only when the runs do not overlap. `__r3.fpsRuns()` is the within-load half. Never run a timing measurement while anything else is working in the tree.

**Two captures in one page load are bit-identical.** That is worth knowing, because it means any difference between two captures is a difference between two page loads, and there are only a handful of things that can vary across a load. Rule them out in this order: tier, `?nogfx`/`?gfx`, progression, drawing buffer, origin.
