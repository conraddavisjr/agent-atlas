import { Color, Vector3 } from 'three'
import { palette } from './palette'
import { BLOOM_THRESHOLD, emissiveIntensityFor, linearLuma } from './materials'

/**
 * The hub's circuit trace, reclassified as water running in a cut channel.
 *
 * ## This reverses a decision that is recorded in HubIsland.tsx, deliberately
 *
 * `HubIsland.tsx` cut the trace's clearcoat from 1.0 to 0.15 and raised its
 * roughness to 0.55 for one stated reason: "A tube with a mirror clearcoat
 * carries one unbroken specular streak down its entire length, which is the
 * single strongest 'rubber hose' cue in the frame and reads as wet. A trace
 * inlaid in a board is not wet."
 *
 * That reasoning was correct and it is still correct. It was correct *about a
 * circuit trace*. The object is being reclassified, so the same streak that was
 * the defect is now the entire point: a long specular highlight running down a
 * half-buried tube is what "wet" looks like, and wet is what we are now asking
 * for. Nothing about the old finding was wrong; only its subject changed.
 *
 * The one thing the old note got at that survives the reclassification is that
 * an UNBROKEN streak reads as rubber. A rubber hose and a stream of water both
 * carry a streak; what separates them is that the water's streak shivers and
 * travels. So the streak here is multiplied by the travelling wave field rather
 * than drawn on its own, and that product is the whole effect.
 *
 * ## Why a from-scratch ShaderMaterial rather than onBeforeCompile
 *
 * The art bible's section 4 is a list of four mandatory rules that exist because
 * this codebase has been cut four times by silent shader failures, three of them
 * in shader patching, and one of them is that `onBeforeCompile` receives shaders
 * with `#include` directives still unresolved. A shader written from scratch
 * cannot fall into that trap because it contains no includes at all, which is
 * why `PortalShimmer.tsx` is the model here rather than `Grass.tsx`.
 *
 * What that costs is lighting. This material takes no lights and receives no
 * shadows, so the water does not darken under the arch or under the Core's
 * struts. That is a real defect and it is accepted rather than hidden, for three
 * reasons: water is mostly a reflective surface rather than a diffuse one, so
 * the terms being given up are the least important ones it has; the surface it
 * replaces was already emissive and therefore already only partly shaded; and
 * the body colour sits at display 0.21, near the floor of the midground band, so
 * failing to darken further cannot read as a hole punched in a shadow. If it
 * turns out to read, the fix is a real one - patch `MeshPhysicalMaterial` under
 * the bible's four rules - and not a tweak to this file.
 *
 * ## What is deliberately NOT here
 *
 * The splash. The user asked for the trace to splash when the player runs
 * through it, and that needs the pooled particle system specified in
 * `05-character-vfx.md` sections 9 to 11, which was designed and never built.
 * `quality.particleBudget` is 0 at all three tiers and `vfxDetail` is `'off'` at
 * all three, so there is no emitter to hang a splash on and no budget to run one
 * in. Building a one-off emitter here would be the third particle system in a
 * codebase that has none, so the decision on record is shimmer now, splash
 * later, and **the trace crossing is the first real use case that system has**.
 * It is the right one to design against: a shallow, wide, low-velocity burst
 * from a known surface height, triggered by a capsule crossing a known path.
 */

/**
 * The key light's direction, and the fourth copy of it in the project.
 *
 * `Lighting.tsx` says in as many words that "KEY DIRECTION IS SHARED. (9, 9.5,
 * 5) appears here, in the SkyDome `sunDirection` prop, and in `KEY_AZ` for the
 * rim's swing. Change one and change all." This is now a fourth, and naming that
 * is better than hiding it: the specular streak below is positioned by where the
 * key is, so a key that moved without this moving would leave the water's
 * highlight pointing at a light that is no longer there.
 *
 * It is a local constant rather than an import only because `KEY_DIRECTION` is
 * module-private in `Lighting.tsx`, which this stream does not own. Adding
 * `export` to it there is a one-word change and it is the right fix; until then
 * the `keyDirection` prop below exists so the value can be supplied from
 * outside rather than duplicated again.
 *
 * The consequence of being wrong here is mild, which is why shipping the
 * duplicate is acceptable. The streak's position on the tube shifts with the
 * key; ten degrees of error moves it by a few millimetres on a 0.15 m tube and
 * is not visible. A streak pointing at the wrong hemisphere would be.
 */
const KEY_DIRECTION: [number, number, number] = [9, 9.5, 5]

/**
 * The water body seen straight down into the channel.
 *
 * Dark on purpose, and the numbers are the argument. This material is unlit, so
 * its rendered value is its authored value put through ACES and the LUT with no
 * lighting factor in between - which makes it one of the few surfaces in the
 * project whose output can be predicted rather than measured. `#12414e` has a
 * linear luminance of 0.0446; ACES maps that to 0.0370 and the sRGB encode
 * brings it out at **display 0.212**, inside the midground band of 0.20 to 0.38
 * and near its floor.
 *
 * That is darker than the surface it replaces, and the darkness is wanted twice
 * over. Round 2's critique measured 0.00% of the frame below display 0.10 and
 * 1.59% below 0.20, and concluded that every other failing was downstream of a
 * world with no shadow end. And a channel cut into a board should read as a dark
 * inlaid line rather than as a bright applied one, which is what a real PCB
 * looks like and what the old trace never did: its diffuse was `palette.circuit`
 * at display 0.770 before any emission at all, which is why it measured 0.85
 * against decks at 0.65.
 *
 * Held in the cyan family rather than moved to a natural water blue-green,
 * because the network still marks the route and blue still means ally. This is
 * the same hue as `palette.visorDim`, which the palette already carries for
 * exactly the job of "the dim end of the powered cyan", taken darker.
 */
const WATER_DEEP = '#12414e'

/**
 * What the water reflects at a grazing angle, and it is `palette.skyHorizon`
 * rather than a new colour.
 *
 * Reused rather than invented, and the reuse is load-bearing in two ways. Water
 * at a grazing angle is a mirror, and what a horizontal mirror on this island
 * reflects is the sky just above the horizon, so the physically correct colour
 * is the one the sky already has. And `registry.ts` hands that same hex to the
 * fog, so the water's bright edge, the distant backdrop and the horizon all
 * converge on one value instead of on three near-misses.
 */
const WATER_SKY = palette.skyHorizon

/**
 * The meniscus line where the water meets the board.
 *
 * This is the single detail that separates "a liquid held in a channel" from "a
 * painted stripe", and it is worth a term of its own because it is the only
 * thing in the effect that says the surface has an edge rather than just
 * stopping. Real water pinned to a lip carries a pale line there from the
 * curvature of the surface plus whatever is entrained in it.
 *
 * Display luma 0.8495, inside the background band, which is deliberate: this is
 * the brightest sustained thing in the effect and it is allowed to be, because
 * it occupies a band roughly 0.03 m wide on a 0.15 m tube and is applied at
 * `WATER.foam` weight rather than at full strength. See `waterPeakLuminance`
 * for the arithmetic that keeps the sum under the bloom threshold.
 */
const WATER_FOAM = '#c2dee6'

/**
 * The glint colour. Near-white with a cyan cast, and its brightness does NOT
 * come from this hex.
 *
 * The uniform carries this colour premultiplied by
 * `emissiveIntensityFor(colour, WATER.glint)`, exactly as `glowStrip()` does, so
 * the hex chooses the hue and `WATER.glint` chooses where the highlight lands
 * relative to the bloom threshold. That separation is the whole point of the
 * unit: at a fixed hex, "how bright" would mean something different for this
 * colour than for any other, which is the defect the art bible's section 1 is
 * written to remove.
 */
const WATER_GLINT = '#e8f7ff'

const TAU = Math.PI * 2

/**
 * Every tunable, with the reasoning for each, because these are the numbers the
 * integrator will bisect against a real frame.
 */
export const WATER = {
  /**
   * Full wave cycles across one part's length. An integer, and that is a
   * requirement rather than a round number.
   *
   * `TubeGeometry` runs `uv.x` from 0 to 1 along the tube and `pad()` runs it 0
   * to 1 around the circumference, so on the pads the coordinate is periodic. A
   * non-integer crest count would put a phase discontinuity down the pad's uv
   * seam - a hairline crack in the water, in one fixed place, forever.
   *
   * 40 sets the wavelength per part rather than in metres, because the batch is
   * merged and every part carries its own 0-to-1 sweep. That is a real
   * approximation and here is exactly what it costs:
   *
   *   part                length   wavelength
   *   trunk               13.8 m   0.345 m
   *   spur (x4)            6.6 m   0.165 m
   *   junction pad rim     6.6 m   0.165 m
   *
   * So the trunk's ripples are 2.09x longer than the spurs'. That is defensible
   * rather than merely tolerated: the spur is radius 0.05 against the trunk's
   * 0.075, and tighter, faster ripples in a narrower channel is what water
   * actually does. The junction pad's circumference is 2π x 1.05 = 6.60 m, which
   * is the spur's length to within a centimetre, so the pad rim and the four
   * spurs that run into it come out at the same wavelength by accident and the
   * junction reads continuous.
   *
   * The exact fix, if the mismatch reads: split `traceBatch` into a trunk mesh
   * and a spur mesh and give them different crest counts. That is one extra draw
   * call and it is not worth spending before it has been looked at.
   */
  crests: 40,
  /**
   * Crest travel, in part-lengths per second. 0.032 is 0.44 m/s on the trunk and
   * 0.21 m/s on a spur.
   *
   * Slow, on the same principle as `PortalShimmer`'s 1.15 rad/s: this is
   * ambience on a surface the player walks beside for hours, not a progress
   * indicator. Fast water also fights the read the flow direction is carrying -
   * see the note on the sign of `along` in the fragment shader.
   */
  flow: 0.032,
  /**
   * How far the grazing-angle reflection is allowed to travel toward the sky
   * colour. **This is the value lever and the first thing to move.**
   *
   * At 1.0, physically correct, a flank reflecting the full sky renders at
   * display 0.837 - brighter than the deck at 0.612 to 0.698, which would put
   * decoration above the floor again and is the exact failure this whole pass
   * exists to remove. Capped values, computed through ACES:
   *
   *   cap    flank renders at
   *   1.00   0.837    background band, brighter than the deck
   *   0.55   0.728    top of the deck
   *   0.45   0.685    top of the deck
   *   0.40   0.659    mid-deck
   *
   * 0.40 puts the water's brightest sustained edge level with the middle of the
   * surface it is inlaid in, so the channel can never become the brightest thing
   * in the frame. Raise it if the water reads flat and dead; lower it if the
   * trace out-values the deck.
   */
  fresnel: 0.4,
  /**
   * How much a fully completed hub lifts the body toward the sky colour, which
   * is how the trace's progress read survives the change of material.
   *
   * The old material carried progress as an emissive ramp from `glow` 0.12 to
   * 0.40. Water cannot use that: an emissive water surface is a lit fog. So
   * progress moves the body's sky mix instead, and the useful property is that
   * both ends stay inside one band:
   *
   *   progress 0   display 0.212
   *   progress 1   display 0.358
   *
   * 0.20 to 0.38 is the midground band, so the trace brightens legibly across
   * the whole of the hub's progression without ever leaving the band it belongs
   * to. Progress also raises the wave amplitude and the glint, so a finished hub
   * has livelier water and not merely paler water.
   */
  progressLift: 0.08,
  /** Weight of the meniscus line. See `WATER_FOAM`. */
  foam: 0.22,
  /**
   * Peak glint brightness, as a multiple of `BLOOM_THRESHOLD`.
   *
   * Under 1.0, and that is mandatory rather than chosen. The art bible's section
   * 1 lets nothing in the ENVIRONMENT into the bloom tier - "blue means ally and
   * gold means reward, and nothing in the environment is allowed in, which is
   * what keeps bloom reading as feedback rather than as weather." A sun glint on
   * water is the single most tempting exception available and it is still an
   * exception, so it is refused here rather than taken quietly. If it should
   * bloom, that is an amendment to the bible with an acceptance shot, not a
   * number in this file.
   *
   * 0.45 puts a glint peak at display 0.863 against a body at 0.212 without
   * crossing the line, which is a very bright sparkle on a very small area.
   * `waterPeakLuminance` proves the sum stays under the threshold and
   * `waterMaterial.test.ts` asserts it.
   */
  glint: 0.45,
  /**
   * Blinn exponent for the streak. Very tight, because the streak's job is to be
   * a line rather than a sheen: a broad lobe on a tube is a bright tube.
   */
  gloss: 220,
  /** Body opacity, away from the shoreline. */
  opacity: 0.95,
  /**
   * The shoreline, expressed as world normal Y rather than as a height.
   *
   * A height cannot work here. The batch is merged and the trunk climbs four
   * risers from y 1.24 to 2.84 while the spurs sit at 0.44 to 1.24, so there is
   * no single waterline altitude in the geometry. The normal is the coordinate
   * that is the same everywhere: on a half-buried tube the crown points up, the
   * flanks point sideways, and the deck surface cuts the tube exactly where
   * `sin(theta) = -standoff / radius`.
   *
   * For the trunk that is `-0.04 / 0.075 = -0.533`, and `shoreBottom` at -0.55
   * sits just past it so the fade is complete before the geometry enters the
   * deck. For a spur it is `-0.04 / 0.05 = -0.800`, well past -0.55, so on a
   * spur the water stops about a centimetre short of its own shore. That
   * asymmetry errs in the safe direction on purpose: stopping short shows deck,
   * where overrunning would show water inside the board. `hubLayout.test.ts`
   * ties both numbers to `TRACE` so a change to `standoff` or either radius
   * cannot silently un-hide the seam.
   *
   * The vertical runs that climb the risers have normals near y 0, so they are
   * fully water. That is not a special case handled by accident - it is what
   * makes each riser read as a small fall between two levels.
   */
  shoreTop: -0.15,
  shoreBottom: -0.55,
} as const

/**
 * The worst-case linear luminance this material can emit, as a pure function.
 *
 * Written out rather than trusted, for the same reason `bloomMipWeights` is: the
 * claim that the water does not bloom is exactly the kind of claim this project
 * has been wrong about before, and section 1 of the art bible opens with the
 * discovery that NOTHING in the game blooms because six emissives were set by
 * eye against a threshold nobody had computed.
 *
 * The sum below is physically unreachable - it needs the maximum grazing
 * reflection, a completed hub, the meniscus line and a glint crest all on one
 * pixel at once - which is what makes it a safe bound rather than an estimate.
 * Every term is a linear luminance and `mix` is linear, so `luma(mix(a, b, t))`
 * is `mix(luma(a), luma(b), t)` exactly and the arithmetic here is the
 * arithmetic the shader does.
 */
export function waterPeakLuminance(): number {
  const deep = linearLuma(WATER_DEEP)
  const sky = linearLuma(WATER_SKY)
  const body = deep + (sky - deep) * (WATER.fresnel + WATER.progressLift)
  const foam = linearLuma(WATER_FOAM) * WATER.foam
  // The glint colour is premultiplied to exactly this luminance. See uGlintColor.
  const glint = WATER.glint * BLOOM_THRESHOLD
  return body + foam + glint
}

export const waterVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;

    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;

    /*
      World normal, and the world part matters. The shoreline and the sky
      reflection are both statements about which way is up, so an object-space or
      view-space normal would put the waterline in a different place for every
      part of a merged batch and would swing it as the camera orbits.

      mat3(modelMatrix) rather than the transpose of its inverse, which is exact
      here rather than an approximation: nothing in this scene applies a
      non-uniform scale to the trace batch, and under uniform scale the two
      differ only by a factor that normalize() removes.

      Note that modelMatrix is available in the vertex prefix but NOT in the
      fragment prefix, which is why this is a varying rather than computed where
      it is used. three gives a ShaderMaterial's fragment shader viewMatrix,
      cameraPosition and isOrthographic, and nothing else.
    */
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const waterFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3  uDeepColor;
  uniform vec3  uSkyColor;
  uniform vec3  uFoamColor;
  uniform vec3  uGlintColor;
  uniform vec3  uKeyDirection;
  uniform float uCrests;
  uniform float uFlowRate;
  uniform float uFresnel;
  uniform float uProgressLift;
  uniform float uFoam;
  uniform float uGloss;
  uniform float uOpacity;
  uniform float uShoreTop;
  uniform float uShoreBottom;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  const float TAU = 6.283185307179586;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPosition);

    /*
      The along-channel coordinate, and the minus sign is the most considered
      character in this file.

      uv.x runs from the start of each authored route to its end. For the trunk
      that is the junction pad at y 1.24 up to the threshold pad at y 2.84; for a
      spur it is the totem plinth at y 0.44 up to the junction at y 1.24. Both
      routes climb monotonically with increasing uv.x, which
      hubLayout.test.ts asserts through pathVerticalRuns rather than leaving
      to inspection. So crests travelling toward DECREASING uv.x run downhill on
      the trunk and on all four spurs at once.

      That is the whole reason this reads as water rather than as a moving
      texture. The network has a single high point at the arch and four low
      points at the totems, so one direction serves every part of it: the portal
      is the spring, the trunk is the race, the junction is a basin mid-slope,
      and the four spurs are the outfalls. Flip this sign and the water flows out
      of four totems, up four spurs, and up the trunk into the arch, and every
      viewer will feel that something is wrong without being able to name it.
    */
    float along = -vUv.x * uCrests * TAU;

    /*
      A cross-channel modulation so the crests are not perfectly square to the
      flow, taken through sin() of the circumferential uv rather than from the uv
      directly. uv.y wraps 1 to 0 around a tube, so using it raw would put a
      seam down the length of every run; sin(TAU * uv.y) is periodic and has no
      seam to find.
    */
    float across = sin(vUv.y * TAU);

    /*
      Two trains at incommensurate frequencies, which is the cheapest thing that
      does not read as a single sine sliding past. A lone sine on a tube is a
      barber's pole.
    */
    float phase1 = along - uTime * uFlowRate + across * 0.9;
    float phase2 = along * 1.63 - uTime * uFlowRate * 0.71 - across * 1.7;
    float waves = 0.5 + 0.25 * sin(phase1) + 0.25 * sin(phase2);

    /*
      Fade the pattern out wherever it is finer than the pixels drawing it.

      This is not polish, it is the difference between water and a crawling
      artefact, and it earns its keep in one place in particular. The pads are in
      the same merged batch, and on a pad uv.x runs AROUND the disc, so 40 crests
      converge on the centre: at radius 0.05 m the crest spacing is 0.008 m,
      which at this camera is about 1.4 px. Without this the junction pad - dead
      centre of frame, directly beneath the Core node - would carry a shimmering
      starburst that reads as a bug rather than as water. With it, the pad centre
      resolves to still water and the ripples appear as the radius opens out,
      which is what a basin looks like.

      It also handles the ordinary case of a distant run of trunk, where the same
      aliasing appears as a crawl along the tube.

      fwidth is safe to use unguarded here. three's own lights_physical_fragment
      calls dFdx with no extension directive and every clearcoat surface in this
      project compiles through it, so derivatives are available in exactly the
      shader flavour this file is compiled as. That is proof by working code
      rather than by assumption, which is the standard this codebase needs.
    */
    float phaseStep = fwidth(along);
    float resolved = 1.0 - smoothstep(1.2, 3.0, phaseStep);
    /*
      Clamped, and not defensively. Two sines at a quarter weight each reach
      exactly 0.0 when both bottom out together, and pow() is UNDEFINED in GLSL
      for a negative base - so a rounding error of one part in ten million at that
      one phase is licence for a driver to hand back a NaN, which propagates
      through the add and writes a black or transparent pixel. It would appear as
      a rare speckle on one machine and on no other, which is the worst possible
      shape for a bug in this project.
    */
    waves = clamp(mix(0.5, waves, resolved * (0.55 + 0.45 * uProgress)), 0.0, 1.0);

    /*
      Sky reflection by a Schlick-shaped Fresnel term. This is the single
      strongest water cue available and it costs four instructions: looking down
      into the channel you see the dark body, and toward a grazing angle the
      surface turns into a mirror of the sky. Capped by uFresnel, which is the
      value lever - see WATER.fresnel for what each cap renders at.
    */
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    vec3 body = mix(uDeepColor, uSkyColor, fresnel * uFresnel + uProgress * uProgressLift);

    /*
      The specular streak, which HubIsland.tsx once removed on purpose. See the
      note at the top of this file: the streak is the point now, and what stops
      it reading as a rubber hose is that it is multiplied by the wave field
      instead of standing alone. An unbroken streak is a hose; a streak that
      shivers and travels is a stream.

      A Blinn half-vector against a fixed key rather than a real light, because
      this material takes no lights. The exponent is high enough that the result
      is a line rather than a sheen, and raising the wave field to a power on top
      of it is what turns the line into a run of separate glints.
    */
    vec3 H = normalize(uKeyDirection + V);
    float streak = pow(max(dot(N, H), 0.0), uGloss);
    float glint = streak * pow(waves, 6.0) * resolved;

    /*
      The shoreline. Alpha ramps to zero as the surface turns under toward the
      deck, so the tube does not end on the hard silhouette line it ends on
      today, and a narrow band just inside that ramp carries the meniscus.

      Half-buried geometry is what makes this cheap: the underside is inside an
      opaque deck and fails the depth test, so there is no gap to light through
      and nothing to hide. The ramp is only softening the last centimetre.
    */
    float shore = smoothstep(uShoreBottom, uShoreTop, N.y);
    float meniscus = shore * (1.0 - smoothstep(uShoreTop, uShoreTop + 0.25, N.y));

    vec3 col = body
      + uFoamColor * meniscus * uFoam * (0.7 + 0.3 * uProgress)
      + uGlintColor * glint * (0.55 + 0.45 * uProgress);

    gl_FragColor = vec4(col, uOpacity * shore);
  }
`

/**
 * The uniform block, as a factory so each material instance owns its own.
 *
 * Exported for the tests, which check that every uniform the shaders reference
 * is declared here and that nothing declared here is unused. A misspelled
 * uniform name is the canonical silent shader failure: three uploads nothing,
 * GLSL initialises it to zero, and the effect renders wrong rather than not at
 * all - which is the failure mode `MEMORY.md` records this codebase breaking by.
 */
export function waterUniforms(keyDirection: [number, number, number] = KEY_DIRECTION) {
  return {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uDeepColor: { value: new Color(WATER_DEEP) },
    uSkyColor: { value: new Color(WATER_SKY) },
    uFoamColor: { value: new Color(WATER_FOAM) },
    /*
      Premultiplied in LINEAR space, after three's colour management has decoded
      the hex, which is the space the bloom threshold is compared in. Identical
      to what `glowStrip()` does and for the same reason: it makes `WATER.glint`
      mean "this fraction of the bloom threshold" for any hue, rather than
      meaning something different for every colour it is applied to.
    */
    uGlintColor: {
      value: new Color(WATER_GLINT).multiplyScalar(
        emissiveIntensityFor(WATER_GLINT, WATER.glint),
      ),
    },
    uKeyDirection: { value: new Vector3(...keyDirection).normalize() },
    uCrests: { value: WATER.crests },
    /*
      Radians of phase per second, derived rather than typed, so `WATER.flow` can
      stay in the unit an artist can hold - part-lengths per second - while the
      shader gets the unit it needs.
    */
    uFlowRate: { value: WATER.flow * WATER.crests * TAU },
    uFresnel: { value: WATER.fresnel },
    uProgressLift: { value: WATER.progressLift },
    uFoam: { value: WATER.foam },
    uGloss: { value: WATER.gloss },
    uOpacity: { value: WATER.opacity },
    uShoreTop: { value: WATER.shoreTop },
    uShoreBottom: { value: WATER.shoreBottom },
  }
}
