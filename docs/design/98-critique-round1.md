# Critique round 1: consolidated findings

Two reviewers looked at the six vantages at three tiers independently. Neither
built any of this and neither saw the other's report. Where they agree, the
finding is listed once. Every number below is display-space sRGB measured on a
frame with ImageMagick or `__dev.sample()`, not read off a hex value.

The frames are in `.critique/baseline/` (`<tier>--<vantage>.png`), with
greyscale versions of the high tier in `.critique/baseline/grey/`. These were
captured after the harness was fixed: every shot is verified to have submitted
within 0.3% of the settled scene's triangle count and to have the character
settled on its surface, so anything missing from a frame is missing from the
game.

---

## The verdict both reviewers reached

**The value structure has been applied to the palette table, not to the frame.**

`palette.band()` asserts on an albedo hex. The art bible's section 8 test is a
statement about what the eye reads off the screen. Those are different
measurements, and the gap between them is where the value structure went:

| Surface | Palette says | Frame measures | Band it should be in |
| --- | --- | --- | --- |
| Lawn | 0.668 | **0.22 - 0.46** | gameplay 0.56-0.74 |
| Deck / puck top | 0.735 | 0.65 - 0.68 | gameplay ✓ |
| Pink cones | - | **0.74 - 0.78** | should not be in gameplay at all |
| Pylons | 0.272 | **0.085** | midground 0.20-0.38 |
| Portal interior | - | 0.914 | brighter than the 0.851 sky |

Fix that axis and F1, F5, F6, F9, F11 below largely collapse into it.

`__dev.sample(x, y, w, h)` reports mean sRGB, display luma, band membership and
warmth for a rectangle of the rendered frame. Use it as the acceptance check.
Do not accept a change on the basis of the albedo hex alone - that is precisely
the mistake being corrected.

---

## Blocking

**F1. The lawn renders in the midground band.** Both reviewers, and the
verdict. The largest walkable surface in the level measures 0.22-0.46 against a
gameplay band of 0.56-0.74, so desaturated it reads as the same band as the
unwalkable cliff. The albedo is right; a field of blades shadows itself and
loses about 0.35 of display luma. Note that the **low** tier renders the same
lawn at 0.614, correctly - so the target is reachable and is simply not being
hit at high.

**F2. No rim light, in the shot whose only job is the rim.** Single-pixel scans
across the silhouette in `hub-backlit`: the shell brightens *inward* over 7 px
(124 → 157), which is a terminator, not a rim. The dome's brightest edge pixel
is 6/255 above its interior. The character is a dark shape on a light backdrop
with an undifferentiated edge. Art bible section 2 splits the rim into a
diffuse wrap at 0.55 and a specular strip Lightformer; check the strip card
exists and is oriented, remembering section 0 defect 5 - drei's `Lightformer`
silently discards `rotation`, so orientation must come from `target`.

**F3. Nothing glows; the emissives are bright paint.** `hub-totem` exists to
prove "the totem glows and the shell beside it does not". The totem ring is
uniformly (245,235,175) all the way round, so it is genuinely emissive, but the
transition into the deck behind it is **two pixels wide with zero halo**. Same
at the portal lintel, where the red channel is clipped at 255 with a
one-pixel transition. Meanwhile white plastic on the character's dome clips to
(255,252,243) and *does* spill a halo. The budget is inverted: the threshold
measured at 1.45 is still above everything except the core ring, and that one
produces a smudge (+26/255 falling to +1 by 30 px).

**F4. A flat unlit magenta quad is attached to the character in every shot.**
Zero-thickness plane, roughly 0.35 x 0.6 m, flat magenta with three horizontal
bands, hard square corners, no shading response, no cast shadow. In
`hub-portal` it occludes his left leg so he appears to stand on one foot; in
`hub-character` it is a purple line on the floor. It is the highest-chroma
object in three of six frames and it is attached to the hero. Both reviewers
independently called this the single thing that makes the set read as a hobby
project.

**F5. The tier ladder changes the art, not the fidelity.** Art bible section 7
says low loses two grading effects, gains a LUT fetch, swaps SMAA for FXAA and
drops environment resolution. Observed instead:
- Grass ceases to exist at low: the meadow becomes a flat green plane at 0.614
  where high renders 0.329. Same level, different value band.
- The pylon cap disc is culled but its lamp orb is not, so eight orbs hang in
  empty sky with a visible gap beneath them.
- A cable arc floats with square-cut ends and no pylon at either end
  (`low--hub-establishing`, upper right).
- The low ground plane shows its own triangulation as pale creases.

Items 2 and 3 are one bug: whatever drops the cap must drop its children too.

---

## Major

**F6. The pink cones are brighter than every surface you can stand on.** 0.777
in `hub-grazing`, 0.740 in `hub-establishing`, against decks at 0.62-0.72. They
also visibly interpenetrate one another, and the ground under each cluster is
0.543 against 0.356 nearby - a bright bald halo, an *inverted* contact shadow.
Reference brief section 5 says the character carries the highest chroma in
frame and that is the separation mechanism; these out-chroma and out-value him.

**F7. The island is a paper-thin disc.** The lawn ends against sky as a hard
curve with a slightly darker fringe and nothing else: no cliff face, no soil,
no underside. The grass instancer also stops 15-20 px short of the edge,
leaving a bare flat crescent all the way round. `hub-establishing`'s own
criterion is "island silhouette against the backdrop", and the silhouette is a
featureless ellipse. Section 8 already assigns `soil` 0.319 for exactly this.

**F8. There is no background layer and no aerial perspective.** Reference brief
section 6 asks for 3-4 parallax depth layers each in its own value band. There
are two: subject and sky. `hub-portal`'s top half is empty flat sky. Across 30 m
in `hub-establishing` the far lawn is 0.05 lighter than the near lawn and
*slightly more saturated* - chroma does not fall with distance at all.

**F9. The pylons carry the strongest contrast in the level and sit outside all
three bands.** (6,22,45) = 0.085 luma against a 0.867 sky is a delta of 0.78,
higher than the core ring (0.17) or the portal arch (0.15). Eight of them,
evenly spaced, four cropped by the top edge. The eye goes to them and stays.
Meanwhile the portal - "the destination the whole hub points at" - is about 1%
of frame, offset right, partly occluded by the core node.

**F10. Photographic granite on the portal arch.** Reference brief section 1
calls the ambientCG rock "the least Astro-like thing in the project". In
`hub-portal` the arch is high-frequency noisy stone with visible tiling and a
normal map, touching decks with literally zero surface detail. Two art styles
across a 2 px edge, and it is the only object with a legible surface so the eye
is drawn to the one thing that is wrong. `useMouldedStone` in `textures.ts` has
the same shape and is one import.

**F11. Every manufactured surface is one cool grey.** Six object classes at one
hue, 5-19% saturation, no roughness variation, no albedo breakup, no bevel
highlight. Partially addressed already - see the temperature commit - but the
rig is still pulling about 13 points of blue into every lit surface, and there
is still no roughness break. On the hero shell there is one broad specular wash
and **no second lobe**; the bible's two-lobe rule wants
`ccRoughness <= baseRoughness - 0.20`.

**F12. There is a hole in the character's face.** A crescent indentation in the
left cheek with a flat brown interior, hard aliased edges, no bevel, no shading
response and no counterpart on the other side. It reads as a boolean gone
wrong, and it sits 60 px from the visor in the two frames where the face is the
subject.

**F13. The head dome is olive in two shots and gold in three.** Same object,
same tier, same rig: `hub-backlit` (0.522,0.581,0.244) olive with G > R;
`hub-totem` (0.895,0.813,0.510) pale gold. Hue swings ~46 to 68 degrees, value
0.85 to 0.52. The olive read happens in exactly the two shots where the head is
silhouetted against the lawn, so the character's most prominent feature loses
hue separation from its background at the moment it most needs it. Likely a
green ambient fill picking up the grass. Reference brief section 8 also
specifies a reflective chrome dome "used explicitly to show off environment
reflections"; this is matte paint with one specular dot.

**F14. The grass has no contact with the ground it grows out of.**
`hub-grazing`'s own criterion names "ambient occlusion at the blade-to-ground
contact". Measured: ground between blades 0.646, blade 0.234, with no
transition of any kind. The field reads as dark hair glued to a pale mat. The
same absence applies to every object base: pylon shafts pierce the lawn with a
bald circle, the trunk trace lies on the decks with no shadow, the core node's
legs meet Puck C with a hard intersection line.

---

## Minor

**F15. White plastic clips to 255 on the shot that exists to catch it.** The
dome specular reaches (255,252,243) in `hub-backlit` and spills +11/255 into
the sky. Small area, but it is on the hero and it is the only clipped surface
in a frame whose criterion is "whether anything other than an emissive has
crossed the bloom threshold at a grazing angle".

**F16. The cyan trunk trace reads as a rubber hose.** A fat glossy tube at 0.85
luma on 0.65 decks, wandering organic path, one bright specular streak, no
contact shadow, abrupt square-cut ends. Reference brief section 1 names PCB
traces as the world's digital DNA: straight runs, right-angle turns, via pads.

**F17. The core node has a faceted low-poly hull poking out from behind a
perfectly smooth sphere.** Two shading languages on one object 20 px apart,
with one saturated violet face. Reads as an unswapped LOD. Also disappears
entirely at low.

---

## Already fixed, do not re-report

- **hub-character cropped the head off and framed the character's back.** Both
  reviewers raised it. The vantage has been re-sited; `__dev.framing()` now
  measures coverage and clipping for all six.
- **The capture harness.** Five separate faults, all producing valid PNGs of
  the wrong thing. See the git log.
