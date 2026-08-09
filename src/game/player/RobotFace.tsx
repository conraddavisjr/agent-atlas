import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector2 } from 'three'
import { GLOW, emissiveIntensityFor } from '@/art/materials'
import { palette } from '@/art/palette'
import { VISOR } from './robotGeometry'
import { writeVisorUniforms } from './rig'
import type { Pose } from './robotPose'

/**
 * The visor: one continuous horizontal cyan slot with two hotter cores inside
 * it, drawn as a signed distance field.
 *
 * The identity problem this solves is worth stating, because the obvious answer
 * is the one this project has committed in writing to avoiding. The reference
 * brief describes two rounded-rect LED panels one eye-width apart, which is
 * exactly the mark of the character `palette.ts` and `RobotModel.tsx` both say
 * we do not copy. The resolution is not to make the eyes worse, it is to carry
 * the same expressive range on a different form.
 *
 * So the bar is always present and never goes dark. Expression lives in the
 * intensity profile along the slot rather than in two isolated glyphs: the
 * cores change shape, arch and width, and the bar between and around them
 * stays lit. Close this character's eyes and there is still a cyan line. The
 * reference's character loses its eyes on a blink and this one does not, and
 * that difference is the whole point.
 *
 * It also gives MORE range than two panels rather than less, because the bar
 * itself is a channel: its thickness, its arc and the gradient along it are all
 * expressive, and none of that is available to a design made of two shapes.
 *
 * ## Why a raw ShaderMaterial
 *
 * The art bible's section 4 exists because this codebase has been cut four
 * times by silent shader failures, three of them in `onBeforeCompile`, most
 * recently `vColor *= iColor` taking down a 1.43M-triangle grass field while
 * reporting every instance present and visible. `onBeforeCompile` also receives
 * shaders with `#include` directives UNRESOLVED, so any patch searching for the
 * body of a chunk matches nothing and silently does nothing.
 *
 * Nothing here patches a three built-in. This is a standalone material with
 * hand-written stages, which `PortalShimmer.tsx` established and which has
 * never broken. The cost is that it receives no lights, fog or shadows, and for
 * a glyph that is not a cost at all: it does not want to be lit. The plate
 * underneath, which does want the environment reflection, stays an unpatched
 * `meshPhysicalMaterial`.
 */

/*
  The two brightness levels, derived rather than typed in.

  The design spec gives 1.6 for the bar and 3.4 for the cores, computed by hand
  against a bloom threshold of 1.75. Deriving them through `emissiveIntensityFor`
  instead means they are expressed in threshold multiples, so when Stream 0's
  `?threshold` measurement lowers BLOOM_THRESHOLD - and the art bible says it is
  expected to fall to somewhere between 1.2 and 1.6 - the visor follows it
  automatically instead of quietly becoming a floodlight.

  GLOW.source is 66% of threshold and GLOW.bloom is 125% of it, which lands the
  bar at luminance 1.16 and the cores at 2.19 against a 1.75 line. That is the
  read the high threshold exists to enable: a cyan line with two glowing nodes,
  rather than a uniformly hazing bar.
*/
const BAR_LEVEL = emissiveIntensityFor(palette.visor, GLOW.source)
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
uniform float uBarLevel;
uniform float uCoreLevel;

varying vec2 vUv;

const float ASPECT  = ${VISOR.aspect.toFixed(6)};
const float VISOR_Y = ${VISOR.y.toFixed(6)};
const float AA      = ${VISOR.aa.toFixed(6)};
const float PIXEL   = 48.0;

/** Signed distance to a rounded box. The standard iq form. */
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

/**
 * One eye core, with arch and gaze applied.
 *
 * 'arch' bends the core into a smile or a frown by displacing y as a function
 * of horizontal distance from the core's own centre. The (1 - t*t) profile is a
 * parabola, which is what an arc of an eye actually looks like; a linear shear
 * reads as a tilt instead.
 */
float eyeCore(vec2 p, float cx, float open, float arch, float width) {
  vec2 q = p - vec2(cx + uGaze.x * ${VISOR.gazeX.toFixed(4)}, VISOR_Y + uGaze.y * ${VISOR.gazeY.toFixed(4)});
  float halfW = ${VISOR.coreHalfW.toFixed(4)} * width;
  float halfH = ${VISOR.coreHalfH.toFixed(4)} * open;
  float t = clamp(q.x / halfW, -1.0, 1.0);
  q.y -= arch * (1.0 - t * t) * 0.048;
  float r = min(halfH, halfW) * 0.92;
  return sdRoundBox(q, vec2(halfW, halfH), r);
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

  /*
    The body of the bar: a stadium 0.490 wide and 0.060 tall in plate space,
    which is 0.274 m across a 0.56 m plate, or 77% of its width.

    Sized in robotGeometry.ts, where a test can reach it, and NOT from the
    design spec's half-extents. Two things are wrong with those.

    First, the spec mixes two conventions of sdRoundBox in one block. Its
    function body is the iq form 'abs(p) - b + r', where b is the shape's full
    half-extent, which is the convention its own eyeCore is written against. Its
    bar arguments are the other convention, where the shape is a b-box dilated
    by r. Fed to the body it actually ships, its (0.215, 0.0) describes a
    stadium of ZERO HEIGHT: the field evaluates to exactly 0.0 at the centre of
    the bar, barMask peaks at 0.5, the alpha it multiplies collapses, and the
    visor is invisible against a black plate. Observed in the browser, which is
    the only place it shows, because the arithmetic is perfectly well-formed and
    nothing errors.

    Second, its stated world sizes do not follow from its own plate space. The
    fragment multiplies x by the aspect, which puts both axes at the same
    0.38 m per unit, so 0.215 is 0.163 m and not the 0.274 m the spec reads off
    it, and 0.274 over a 0.56 m plate is 49% rather than the 77% it also claims.
  */
  float bar = sdRoundBox(
    p - vec2(0.0, VISOR_Y),
    vec2(${VISOR.barHalfW.toFixed(4)}, ${VISOR.barHalfH.toFixed(4)}),
    ${VISOR.barRadius.toFixed(4)}
  );

  /*
    A fixed-width antialias in plate space, roughly 1.3 px at the on-screen face
    height this character is normally seen at. fwidth would be more correct at
    extreme distance and is not worth the derivative instructions: the camera
    never gets far from this face.
  */
  float barMask = 1.0 - smoothstep(-AA, AA, bar);

  float coreL = eyeCore(p, -${VISOR.coreOffset.toFixed(4)}, uOpenL, uArchL, uWidthL);
  float coreR = eyeCore(p,  ${VISOR.coreOffset.toFixed(4)}, uOpenR, uArchR, uWidthR);
  float coreMask = (1.0 - smoothstep(-AA, AA, coreL))
                 + (1.0 - smoothstep(-AA, AA, coreR));
  coreMask = clamp(coreMask, 0.0, 1.0);

  /*
    The cores are clipped to the bar, and this is load-bearing rather than
    defensive. At full gaze and full width a core reaches 0.360 against the
    slot's 0.245, so without the clip a surprised glance would put a glowing
    blob outside the housing, which destroys the read of a recessed display
    instantly. Clipped, it flattens against the end of the slot instead, which
    reads correctly as an eye pressed into the corner of its socket.
  */
  coreMask *= barMask;

  float energy = barMask * uBarLevel + coreMask * (uCoreLevel * uBright - uBarLevel);

  float scanline = 1.0;
#ifdef VISOR_FULL
  // Horizontal scanlines. The bar is 0.060 tall in plate space, so at 48 cells
  // this puts roughly three lines across it. More turns into moire at playing
  // distance.
  float rows = 0.86 + 0.14 * step(0.5, fract(p.y * PIXEL * 1.5 + uTime * 0.35));
  // A vertical cell grid at the same pitch, so it reads as a matrix rather than
  // as CRT lines. Deliberately much weaker than the rows.
  float cols = 0.94 + 0.06 * step(0.28, fract(p.x * PIXEL * 0.5));
  // A slow bright sweep left to right. Period 8.3 s, so it is barely noticed
  // and definitely felt: this is the "powered and thinking" cue.
  float sx = fract(uTime * 0.12) * 2.2 - 1.1;
  float sweep = 1.0 + smoothstep(0.09, 0.0, abs(p.x - sx)) * 0.18 * uScan;
  scanline = mix(1.0, rows * cols, uScan) * sweep;
#endif

  vec3 col = mix(uCoolColor, uColor, clamp(barMask * 0.35 + coreMask, 0.0, 1.0)) * energy;

  /*
    NormalBlending with the coverage in alpha, not additive, and this is
    load-bearing.

    Additive on one quad would be fine on its own. But this is the emissive
    surface the player looks at for hours, and the moment anyone adds a second
    overlay - a damage flash, a status icon - additive starts stacking. Normal
    blending gives 'out = rgb * a + dst * (1 - a)', which is bounded by rgb no
    matter how many layers composite, so the bar cannot blow out by accident.
  */
  float alpha = clamp(barMask * 0.94 + coreMask * 0.06, 0.0, 1.0);
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
      uBarLevel: { value: BAR_LEVEL },
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
