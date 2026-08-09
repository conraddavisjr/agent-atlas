import { useMemo } from 'react'
import { BackSide, Color, Vector2, Vector3, type ShaderMaterial } from 'three'
import { palette } from './palette'

/**
 * The sky.
 *
 * A gradient dome driven by the palette rather than a physical sky model.
 *
 * drei's `<Sky>` was tried first and abandoned for two reasons, one practical
 * and one about direction. Practically, the Preetham model it implements
 * outputs genuine daylight radiance, which is enormous next to a scene lit at
 * an intensity of about 1.3; even after tone mapping it came through as flat
 * white and took the whole frame with it, and the model offers no exposure
 * control to pull it back. And in direction, a physically-derived sky is a
 * strange thing to hang over a world whose entire look is a chosen palette:
 * the one part of the frame nothing could art-direct.
 *
 * A dome costs one draw call, has no lighting to fight, and puts the horizon
 * colour under the same control as everything else.
 *
 * ## Why the establishing shot used to be a pale void
 *
 * The previous version blended horizon to zenith with `pow(dir.y * 0.5 + 0.5,
 * 1.6)`, and its comment said the exponent pushed the gradient's midpoint down
 * toward the horizon. It did the opposite. An exponent above 1 applied to a
 * value in [0, 1] makes that value smaller everywhere, which weights the whole
 * dome toward the *horizon colour* and moves the halfway point UP: at 1.6 the
 * 50/50 crossover sits at `dir.y = 0.32`, nearly 19 degrees above the skyline.
 *
 * That matters because of the camera. At FOV 40, looking slightly down at an
 * island, the sky occupies a band of roughly `dir.y = -0.4` to `+0.45`, and the
 * old ramp gave that entire band values between 33% and 51% of the way from the
 * pale horizon to the blue zenith. The gradient existed; it was just almost all
 * of it above the top of the frame. What was left in shot was a near-uniform
 * wash of pale blue with the island floating in the middle of it.
 *
 * The fix is not a different exponent. It is stops placed against the elevations
 * the camera actually looks at:
 *
 *   - a pale band right at the skyline, which is where the island rim (band 2,
 *     luma 0.32) has to silhouette;
 *   - a distinct mid band reached within about 12 degrees, which is what fills
 *     most of the frame and which carries the background value band, 0.76-0.86;
 *   - the palette's `skyTop` at the zenith, at luma 0.60, so the dome has a real
 *     top rather than trailing off;
 *   - and a fourth stop *below* the horizon, deeper and cooler than the skyline,
 *     because the island floats and the void underneath it should read as a
 *     place the world continues into rather than as blank paper.
 *
 * Four stops joined by smoothsteps rather than one power curve, so the ramp has
 * shape a person chose at elevations a person can see.
 */

/**
 * Where the pale skyline band gives way to the mid band, in `sin(elevation)`.
 *
 * 0.20 is about 11.5 degrees. Most of a real sky's colour change happens in the
 * first few degrees above the skyline and the rest is close to uniform, which is
 * what the old exponent was reaching for and inverted.
 */
const SKYLINE_END = 0.2

/** Where the mid band starts turning into the zenith blue, and where it arrives. */
const ZENITH_START = 0.16
const ZENITH_END = 0.78

/** How far below the horizon the deeper void colour is fully reached. */
const VOID_DEPTH = -0.3

/**
 * How far the mid band and the void sit from the pale horizon toward the zenith.
 *
 * Both are lerped in the renderer's linear working space, which is why they are
 * built from `Color` rather than written as hex: mixing two sRGB hex strings by
 * hand gives a different, muddier colour than the one the GPU would produce
 * between the same two stops.
 *
 * The two numbers are chosen against the value bands in `03-environment.md`.
 * The mid band lands near luma 0.78 and the void near 0.82, both inside the
 * 0.76-0.86 background band, while the skyline stays at the palette's 0.90 and
 * the zenith at 0.60. So the part of the sky the character silhouettes against
 * is a designed value, not an accident of where the ramp happened to be.
 */
const MID_BAND_BLEND = 0.55
const VOID_BLEND = 0.3

/** A small deepening under the horizon, so "below" is not merely "less blue". */
const VOID_DARKEN = 0.94

/** Matched to the key light, so the glow agrees with where shadows fall. */
const DEFAULT_SUN_DIRECTION: [number, number, number] = [8, 14, 6]

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3  uVoid;
  uniform vec3  uHorizon;
  uniform vec3  uMid;
  uniform vec3  uTop;
  uniform vec3  uSunColor;
  uniform vec3  uSunDirection;
  uniform vec2  uSunAzimuth;

  varying vec3 vWorldPos;

  /* Rec.709, deliberately the same weights the grade and the bloom mask use. */
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  /*
    Interleaved gradient noise. An ordered dither in the sense that matters: it
    is a closed-form function of the pixel coordinate, so it is stable frame to
    frame and cannot crawl, and its spectrum is close enough to blue that the eye
    integrates it away instead of reading it as texture. One dot product and two
    fracts, against a lookup texture or a 4x4 Bayer matrix with its visible grid.
  */
  float orderedNoise(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec3 dir = normalize(vWorldPos);

    /*
      Elevation as sin(angle), which is just dir.y on a unit sphere. Used
      directly rather than remapped to [0,1] so the stop positions below are
      readable as angles: 0.2 is 11.5 degrees, 0.78 is 51 degrees.
    */
    float t = dir.y;

    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, ${SKYLINE_END.toFixed(3)}, t));
    col = mix(col, uTop, smoothstep(${ZENITH_START.toFixed(3)}, ${ZENITH_END.toFixed(3)}, t));
    col = mix(col, uVoid, 1.0 - smoothstep(${VOID_DEPTH.toFixed(3)}, 0.0, t));

    /*
      Warmth along the skyline, strongest on the sun's bearing and gone behind
      you. One dot product, and it is the cheapest thing in this shader that
      makes the backdrop read as lit from somewhere rather than painted.

      The azimuth arrives pre-normalised as a uniform rather than being derived
      here, because normalising the horizontal component of a sun that happened
      to be directly overhead would divide by zero and put NaN across the whole
      upper hemisphere.
    */
    float skyline = exp(-abs(t) * 14.0);
    float sunward = max(dot(dir.xz, uSunAzimuth), 0.0);
    col += uSunColor * skyline * sunward * sunward * 0.05;

    /*
      A broad warm glow around the sun rather than a disc. The disc itself would
      sit at a fixed point the player can orbit around and stare at, and at this
      camera height it spends most of its time behind the island anyway. The
      glow is what actually reads, and it is what ties the sky to the direction
      the shadows fall.
    */
    float sun = max(dot(dir, uSunDirection), 0.0);
    col += uSunColor * pow(sun, 8.0) * 0.55;
    col += uSunColor * pow(sun, 2.0) * 0.12;

    /*
      Dither, and it belongs here rather than in the post chain.

      The banding is real and it is measured: #d6ecfb to #5aa8e8 is about 124
      units of blue across roughly half the screen height, which is one 8-bit
      step every four or five rows at 1080p. On a large panel, at rest, that
      reads as horizontal stripes across the calmest area of the frame, and the
      grade makes it slightly worse rather than better because the mid-chroma
      boost stretches exactly the range the sky lives in.

      The amplitude is the part worth getting right. The dome writes raw linear
      radiance into a half-float buffer; quantisation happens much later, after
      ACES and after the sRGB encode. So a flat 1/255 added here would be a
      fraction of an output code at these values and would not clear the banding.
      What is needed is one *output* code expressed in the linear domain, which
      is the derivative of the transfer curve: for a display response of roughly
      x^(1/g), one code of output is g/255 * L^(1 - 1/g) of linear. At the sky's
      values that comes out near 1.7/255 of linear, which is the same one code it
      is meant to be.

      Uniform noise over one code, centred, so it randomises which side of a
      quantisation boundary a pixel falls on without adding any brightness. Three
      decorrelated samples rather than one shared offset, because the sky's
      banding is a blue-channel phenomenon first and a shared offset would move
      all three channels together and leave the hue steps intact.
    */
    float lum = dot(col, LUMA);
    float outputCode = (2.2 / 255.0) * pow(max(lum, 0.0001), 0.5454545);
    vec3 dither = vec3(
      orderedNoise(gl_FragCoord.xy),
      orderedNoise(gl_FragCoord.xy + 37.0),
      orderedNoise(gl_FragCoord.xy + 71.0)
    ) - 0.5;
    col += dither * outputCode;

    gl_FragColor = vec4(col, 1.0);
  }
`

export function SkyDome({
  sunDirection = DEFAULT_SUN_DIRECTION,
  /** Comfortably inside the camera's far plane of 250. */
  radius = 200,
}: {
  sunDirection?: [number, number, number]
  radius?: number
}) {
  /*
    Destructured so the memo keys on the three numbers rather than on the array's
    identity. Callers pass an inline literal, which is a fresh array on every
    render, and keying on it would rebuild every uniform each time the parent
    re-renders for an unrelated reason.
  */
  const [sunX, sunY, sunZ] = sunDirection

  const uniforms = useMemo(() => {
    /*
      Both derived stops are built by lerping in the working space rather than
      being written as hex, so that a palette change propagates through the whole
      ramp instead of leaving two hand-picked colours behind.
    */
    const horizon = new Color(palette.skyHorizon)
    const top = new Color(palette.skyTop)
    const mid = horizon.clone().lerp(top, MID_BAND_BLEND)
    const emptiness = horizon.clone().lerp(top, VOID_BLEND).multiplyScalar(VOID_DARKEN)

    /*
      Normalised once here rather than per pixel. The azimuth needs a fallback
      because a sun at the zenith has no bearing at all, and normalising a zero
      vector in the shader would put NaN across the sky.
    */
    const direction = new Vector3(sunX, sunY, sunZ).normalize()
    const azimuth = new Vector2(direction.x, direction.z)
    if (azimuth.lengthSq() < 1e-6) azimuth.set(0, 1)
    else azimuth.normalize()

    return {
      uVoid: { value: emptiness },
      uHorizon: { value: horizon },
      uMid: { value: mid },
      uTop: { value: top },
      uSunColor: { value: new Color('#fff4d6') },
      uSunDirection: { value: direction },
      uSunAzimuth: { value: azimuth },
    }
  }, [sunX, sunY, sunZ])

  return (
    <mesh
      /*
        No shadow interaction and no frustum culling. The dome encloses the
        camera, so its bounding sphere straddles the near plane and three's
        culling test is unreliable there.
      */
      frustumCulled={false}
      renderOrder={-1}
    >
      {/*
        32 by 16 segments is plenty: the shader is a function of direction, so
        the tessellation only has to be fine enough that the interpolated world
        position does not visibly deviate from the sphere. It is not carrying the
        gradient.
      */}
      <sphereGeometry args={[radius, 32, 16]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        /* Seen from the inside. */
        side={BackSide}
        /*
          Never occludes, and never writes depth, so it cannot interfere with
          anything drawn after it regardless of render order.
        */
        depthWrite={false}
        /* Fog would tint the sky toward the fog colour, which is taken from the
           sky in the first place. Circular, and it flattens the gradient. */
        fog={false}
      />
    </mesh>
  )
}

export type SkyDomeMaterial = ShaderMaterial
