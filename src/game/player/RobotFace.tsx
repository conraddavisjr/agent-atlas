import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector2 } from 'three'
import { GLOW, emissiveIntensityFor } from '@/art/materials'
import { palette } from '@/art/palette'
import { VISOR } from './robotGeometry'
import { writeVisorUniforms } from './rig'
import type { Pose } from './robotPose'

/**
 * The face: two round cyan lenses on the dark plate, drawn as a signed distance
 * field.
 *
 * ## This file used to argue the opposite, at length, and the argument is kept
 *
 * What was here was one continuous horizontal stadium with two hotter cores
 * inside it, and the reasoning was not lazy - it was the project's stated
 * identity constraint, written down in four places: `palette.ts`'s header,
 * `RobotModel.tsx`'s opening comment, `05-character-vfx.md` section 7, and a
 * test in `robotGeometry.test.ts` called "keeps the bar lit through a full blink".
 * The argument ran:
 *
 * > The reference brief describes two rounded-rect LED panels one eye-width
 * > apart, which is exactly the mark of the character we do not copy. The
 * > resolution is not to make the eyes worse, it is to carry the same expressive
 * > range on a different form. So the bar is always present and never goes dark.
 * > Close this character's eyes and there is still a cyan line. The reference's
 * > character loses its eyes on a blink and this one does not, and that
 * > difference is the whole point.
 *
 * **The decision on record is now to clone the reference one-to-one**, so the bar
 * is gone and its consequence is accepted rather than mitigated: at `openL` 0.06
 * the lens collapses to 0.129 m by 0.004 m and the face does effectively go dark
 * through a blink. That is what the reference does.
 *
 * One claim from the old argument is worth keeping because it was true and is now
 * a cost rather than a benefit: a bar has channels two shapes do not - its
 * thickness, its arc and the gradient along it are all expressive. Two lenses
 * have `open`, `arch`, `width`, gaze and brightness, which is the whole of the
 * six-expression table in `05-character-vfx.md` and every one of them still
 * drives something here, so nothing in `solveFace` is orphaned. But the range is
 * narrower and that is a real trade, not a wash.
 *
 * ## The core is a falloff, not a second shape
 *
 * The reference's LEDs are always a bright core inside a darker housing, and the
 * art bible's section 1 is emphatic that a single flat emissive surface reads as
 * bright plastic rather than as a light. The bar version paid for that with a
 * second SDF per eye plus a clip.
 *
 * Here the core is a radial ramp about the gaze point, normalised by the lens's
 * own half-extents, so it costs one `length` instead of one `sdRoundBox` and it
 * squashes WITH the lens on a blink rather than staying a round hotspot inside a
 * slit. Normalising also makes the containment structural: the lens is the unit
 * disc in that space, the core reaches 0.874 of it at full gaze, so it cannot
 * escape at any open, width or arch. The clip that used to be load-bearing is now
 * one multiply of plain defence.
 *
 * **This shader is not smaller than the one it replaces, which the brief for this
 * work expected it to be.** Two lenses each need a shape and a core, so the ALU
 * count is 2 `sdRoundBox` plus 2 `length` plus 4 `smoothstep` against the bar's 3
 * `sdRoundBox` plus 3 `smoothstep`. It is marginally cheaper because a `length`
 * is cheaper than an `sdRoundBox`, and it is shorter in source because the bar
 * and its clip are gone, but "two shapes instead of three" was never going to be
 * a saving when each of the two carries its own core.
 *
 * ## Why a raw ShaderMaterial
 *
 * The art bible's section 4 exists because this codebase has been cut four times
 * by silent shader failures, three of them in `onBeforeCompile`, most recently
 * `vColor *= iColor` taking down a 1.43M-triangle grass field while reporting
 * every instance present and visible. `onBeforeCompile` also receives shaders
 * with `#include` directives UNRESOLVED, so any patch searching for the body of a
 * chunk matches nothing and silently does nothing.
 *
 * Nothing here patches a three built-in. This is a standalone material with
 * hand-written stages, which `PortalShimmer.tsx` established and which has never
 * broken. The cost is that it receives no lights, fog or shadows, and for a glyph
 * that is not a cost at all: it does not want to be lit. The plate underneath,
 * which does want the environment reflection, stays an unpatched
 * `meshPhysicalMaterial`.
 */

/*
  The two brightness levels, derived rather than typed in.

  The design spec gives 1.6 for the bar and 3.4 for the cores, computed by hand
  against a bloom threshold of 1.75. Deriving them through `emissiveIntensityFor`
  instead means they are expressed in threshold multiples, so now that Stream 0
  has MEASURED BLOOM_THRESHOLD at 1.45 the face followed it automatically instead
  of quietly becoming a floodlight.

  GLOW.source is 66% of threshold and GLOW.bloom is 125% of it, which lands the
  lens body at luminance 0.957 and the core at 1.813 against the measured 1.45
  line. That is the read the whole budget exists to enable: a cyan lens that is
  plainly a light, with a core that blooms, on a character whose white plastic
  does not.

  The eyes are the identity of this character and they are the tier A set the art
  bible keeps deliberately tiny. Everything else added to the model in this pass -
  the port on the back, the ovals under the soles - is GLOW.source and stays under
  the line, so the only thing on the robot that haloes is the two things a player
  looks at.
*/
const LENS_LEVEL = emissiveIntensityFor(palette.visor, GLOW.source)
const CORE_LEVEL = emissiveIntensityFor(palette.visor, GLOW.bloom)

const VISOR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const VISOR_FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uOpenL;
uniform float uOpenR;
uniform float uArchL;
uniform float uArchR;
uniform float uWidthL;
uniform float uWidthR;
uniform vec2  uGaze;
uniform float uBright;
uniform float uScan;
uniform float uGlitch;
uniform vec3  uColor;
uniform vec3  uCoolColor;
uniform float uLensLevel;
uniform float uCoreLevel;

varying vec2 vUv;

const float ASPECT    = ${VISOR.aspect.toFixed(6)};
const float VISOR_Y   = ${VISOR.y.toFixed(6)};
const float AA        = ${VISOR.aa.toFixed(6)};
const float OFFSET    = ${VISOR.lensOffset.toFixed(6)};
const float LENS_HW   = ${VISOR.lensHalfW.toFixed(6)};
const float LENS_HH   = ${VISOR.lensHalfH.toFixed(6)};
const float CORE_IN   = ${VISOR.coreInner.toFixed(6)};
const float CORE_OUT  = ${VISOR.coreOuter.toFixed(6)};

/*
  Gaze travel in units of the lens's own half-extents, so the core's offset is
  the same fraction of its housing whatever the housing is currently doing. Fixed
  at construction rather than computed per fragment, which also documents the
  containment: 0.55 of core plus 0.324 of gaze is 0.874, inside the lens.
*/
const vec2 GAZE_NORM = vec2(
  ${(VISOR.gazeX / VISOR.lensHalfW).toFixed(6)},
  ${(VISOR.gazeY / VISOR.lensHalfH).toFixed(6)}
);

/*
  LED matrix pitch, in cells per unit of plate space.

  12.0 and not the 48.0 the bar used, and the change is forced rather than a
  taste: the bar was 0.126 tall in plate space and this lens is 0.340, so at the
  old pitch there would be 24 scanlines across one eye. That is moire at any
  playing distance. 12.0 puts roughly four cells across a lens, which is a chunky
  LED rather than a CRT, and it is what the reference's faceplates look like.

  Rows and columns share the pitch here where the bar gave columns a third of the
  rows'. A lens is square, so a square cell is the one that does not read as
  stretched.
*/
const float CELL = 12.0;

/** Signed distance to a rounded box. The standard iq form. */
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

/**
 * One eye lens. Returns coverage in x and core heat in y, both already clipped
 * to the lens.
 *
 * 'arch' bends the lens into a smile or a frown by displacing y as a function of
 * horizontal distance from its own centre. The (1 - t*t) profile is a parabola,
 * which is what an arc of an eye actually looks like; a linear shear reads as a
 * tilt instead.
 *
 * With 'open' and 'width' at 1 the half-extents are equal and the corner radius
 * equals them both, at which point sdRoundBox degenerates to 'length(q) - r'
 * exactly - so this is a true circle rather than a square with generous corners.
 * A blink drives 'open' down and the circle becomes a stadium of the same width
 * with fully rounded ends, which is the reference's blink: the eye squashes
 * rather than shrinking.
 */
vec2 eyeLens(vec2 p, float cx, float open, float arch, float width) {
  vec2 q = p - vec2(cx, VISOR_Y);
  float hw = LENS_HW * width;
  float hh = LENS_HH * open;
  float t = clamp(q.x / hw, -1.0, 1.0);
  q.y -= arch * (1.0 - t * t) * 0.048;

  float cover = 1.0 - smoothstep(-AA, AA, sdRoundBox(q, vec2(hw, hh), min(hw, hh)));

  /*
    The core. 'q' is normalised by the CURRENT half-extents so the lens is the
    unit disc, while the gaze offset is already expressed in those same units and
    is therefore NOT divided again - which is the whole reason it survives a
    blink. Dividing the gaze by 'hh' as well would multiply the vertical offset
    by 17 as the lens closes and throw the core out through the top of a slit.
  */
  vec2 g = q / vec2(hw, hh) - GAZE_NORM * uGaze;
  float hot = 1.0 - smoothstep(CORE_IN, CORE_OUT, length(g));
  return vec2(cover, hot * cover);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(ASPECT, 1.0);

#ifdef VISOR_FULL
  /*
    A few horizontal bands displaced sideways. Cheap, and it reads as a display
    losing sync rather than as the character being sad, which matters: this is a
    hardware cue, not an emotional one.

    Not branched on. The shader cannot branch on it cheaply and the multiply by
    zero is free.
  */
  float band = floor((p.y - VISOR_Y) * 42.0);
  float jitter = fract(sin(band * 91.7 + floor(uTime * 30.0) * 3.3) * 4371.0) - 0.5;
  p.x += jitter * uGlitch * 0.09;
#endif

  vec2 eL = eyeLens(p, -OFFSET, uOpenL, uArchL, uWidthL);
  vec2 eR = eyeLens(p,  OFFSET, uOpenR, uArchR, uWidthR);

  /*
    Summed and clamped rather than min'd. The two lenses are 0.34 apart and 0.34
    across, so at neutral they never overlap - but 'width' reaches 1.4, which puts
    each inner edge at 0.34 - 0.238 = 0.102 and leaves a 0.204 gap that a
    surprised expression narrows without closing. Clamping is what keeps the sum
    honest if that ever stops being true.
  */
  float cover = clamp(eL.x + eR.x, 0.0, 1.0);
  float hot = clamp(eL.y + eR.y, 0.0, 1.0);

  float energy = cover * uLensLevel + hot * (uCoreLevel * uBright - uLensLevel);

  float scanline = 1.0;
#ifdef VISOR_FULL
  // Roughly four cells across a lens. See CELL.
  float rows = 0.86 + 0.14 * step(0.5, fract(p.y * CELL + uTime * 0.35));
  // A vertical grid at the same pitch, so it reads as a matrix rather than as
  // CRT lines. Deliberately much weaker than the rows.
  float cols = 0.94 + 0.06 * step(0.28, fract(p.x * CELL));
  // A slow bright sweep left to right. Period 8.3 s, so it is barely noticed
  // and definitely felt: this is the "powered and thinking" cue.
  float sx = fract(uTime * 0.12) * 2.2 - 1.1;
  float sweep = 1.0 + smoothstep(0.09, 0.0, abs(p.x - sx)) * 0.18 * uScan;
  scanline = mix(1.0, rows * cols, uScan) * sweep;
#endif

  /*
    The lens rim takes 35% of the way toward the saturated cyan and the core
    takes all of it, so the lens has a cool dark edge and a hot centre. That
    gradient is doing the same job the plate's clearcoat highlight does: it says
    the surface is glass over a light rather than a painted disc.
  */
  vec3 col = mix(uCoolColor, uColor, clamp(cover * 0.35 + hot, 0.0, 1.0)) * energy;

  /*
    NormalBlending with the coverage in alpha, not additive, and this is
    load-bearing.

    Additive on one quad would be fine on its own. But this is the emissive
    surface the player looks at for hours, and the moment anyone adds a second
    overlay - a damage flash, a status icon - additive starts stacking. Normal
    blending gives 'out = rgb * a + dst * (1 - a)', which is bounded by rgb no
    matter how many layers composite, so the eyes cannot blow out by accident.
  */
  float alpha = clamp(cover * 0.94 + hot * 0.06, 0.0, 1.0);
  gl_FragColor = vec4(col * scanline, alpha);
}
`

/**
 * @param pose Only `pose.face` is read.
 * @param detail `'simple'` compiles out the scanlines, the sweep and the
 *   glitch. Two compiled variants selected by a `#define` rather than one
 *   variant branching on a uniform, so the cheap tier does not pay for code it
 *   never runs. Since this is a `ShaderMaterial` that is a string
 *   concatenation at construction and there is no program-cache hazard.
 */
export function RobotFace({
  pose,
  detail = 'full',
}: {
  pose: RefObject<Pose | null>
  detail?: 'simple' | 'full'
}) {
  const materialRef = useRef<ShaderMaterial | null>(null)

  useEffect(() => {
    return () => {
      materialRef.current?.dispose()
      materialRef.current = null
    }
  }, [])

  useFrame(() => {
    const material = materialRef.current
    const p = pose.current
    if (!material || !p) return
    writeVisorUniforms(p.face, material.uniforms)
  })

  return (
    <mesh
      position={[0, 0, 0.02]}
      geometry={VISOR_GEOMETRY}
      ref={(o) => {
        if (!o) return
        if (materialRef.current === null) materialRef.current = createVisorMaterial(detail)
        ;(o as Mesh).material = materialRef.current
      }}
    />
  )
}

/**
 * The glyph plane, 0.020 m in front of the plate's face.
 *
 * Still the full 0.56 x 0.38 of the plate even though the two lenses now occupy
 * far less of it than the bar did, and that is deliberate rather than waste: plate
 * space is defined as this quad's own UV space, so shrinking the quad would
 * rescale every half-extent in `VISOR` and the aspect multiply with it. A quad
 * costs two triangles and the fragments outside the lenses discard on an alpha of
 * zero.
 *
 * Far enough that the depth test never fights at any camera angle inside
 * `CAMERA.minDistance`, and near enough that the parallax between plate and
 * glyph stays under a pixel. Not `polygonOffset`: a real offset in Z is more
 * predictable and costs nothing.
 */
const VISOR_GEOMETRY = new PlaneGeometry(0.56, 0.38)

function createVisorMaterial(detail: 'simple' | 'full'): ShaderMaterial {
  return new ShaderMaterial({
    defines: detail === 'full' ? { VISOR_FULL: '' } : {},
    uniforms: {
      uTime: { value: 0 },
      uOpenL: { value: 1 },
      uOpenR: { value: 1 },
      uArchL: { value: 0 },
      uArchR: { value: 0 },
      uWidthL: { value: 1 },
      uWidthR: { value: 1 },
      uGaze: { value: new Vector2() },
      uBright: { value: 1 },
      // Forced to zero on the cheap variant anyway, since the code is compiled
      // out; kept at its default so the two variants share a uniform block.
      uScan: { value: 0.55 },
      uGlitch: { value: 0 },
      uColor: { value: new Color(palette.visor) },
      uCoolColor: { value: new Color(palette.visorDim) },
      uLensLevel: { value: LENS_LEVEL },
      uCoreLevel: { value: CORE_LEVEL },
    },
    vertexShader: VISOR_VERT,
    fragmentShader: VISOR_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending,
    /*
      The bar is HDR by design and the whole bloom budget above depends on those
      values reaching the composer unclamped. Letting three tone-map this
      material would apply the ACES curve before the bloom pass ever sees it,
      and nothing on the character would cross the threshold again.
    */
    toneMapped: false,
  })
}
