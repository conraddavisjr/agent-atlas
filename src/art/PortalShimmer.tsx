import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, DoubleSide, type ShaderMaterial } from 'three'
import { palette } from './palette'

/**
 * The surface inside an unlocked portal: a slow spiral turning inward.
 *
 * Replaces a sine on emissiveIntensity, which pulsed the whole plane in unison
 * and read as a light being dimmed rather than as a way through to somewhere.
 * A spiral has direction, and direction is what makes it read as travel.
 *
 * Written as a shader rather than as animated geometry because the effect is
 * pure gradient: there is nothing to model, and a hundred rotating quads would
 * cost more and look worse than one plane doing the arithmetic per pixel.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/*
  Polar coordinates are taken in UV space rather than corrected to world
  proportions, so the spiral comes out elliptical, matching the doorway. A
  circular spiral in a tall opening leaves dead corners above and below.
*/
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uCoreColor;
  uniform float uIntensity;
  uniform float uArms;
  uniform float uTwist;
  uniform float uSpeed;

  varying vec2 vUv;

  void main() {
    vec2  p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);

    // The spiral itself. Coupling angle to radius is what bends what would
    // otherwise be flat spokes into arms; uTwist is how tightly they wind.
    float phase = a * uArms + r * uTwist - uTime * uSpeed;

    // Raised to a power so the arms read as distinct ribbons with dark space
    // between them. A bare sine is a soft gradient and reads as a smudge.
    float bands = pow(sin(phase) * 0.5 + 0.5, 2.5);

    // Fade out before the edge so the plane never ends on a hard line against
    // the frame. Everything is multiplied by this.
    float falloff = smoothstep(1.15, 0.2, r);

    // A bright throat at the centre, which gives the eye somewhere to go and
    // implies depth the flat plane does not have.
    float core = smoothstep(0.55, 0.0, r);

    // A rim just inside the opening, which separates the effect from the frame.
    float rim = smoothstep(0.55, 0.95, r) * smoothstep(1.15, 0.9, r);

    float energy = clamp(bands * falloff * 0.85 + rim * 0.45, 0.0, 1.0);

    /*
      The core is deliberately restrained on both axes it could run away on.
      Mixing hard toward the pale core colour AND adding its own brightness on
      top produced a white disc that swallowed the spiral entirely: the arms
      were still being computed, they were just invisible inside the blowout.
      Half the mix and a third of the boost keeps the throat reading as a bright
      cyan depth rather than as a hole punched in the frame.
    */
    vec3 col = mix(uColor, uCoreColor, core * 0.5) * (energy + core * 0.35) * uIntensity;

    // Alpha is deliberately not the same curve as brightness. Tying them
    // together makes the dark gaps between the arms fully transparent, which
    // shows the scene behind and destroys the read of a filled doorway.
    float alpha = clamp(falloff * (0.42 + bands * 0.45) + core * 0.3, 0.0, 0.94);

    gl_FragColor = vec4(col, alpha);
  }
`

export function PortalShimmer({
  width,
  height,
  position,
}: {
  width: number
  height: number
  position: [number, number, number]
}) {
  const material = useRef<ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color(palette.visor) },
      /* A warmer core against the cyan body, so the throat does not read as a
         flat wash of one colour. */
      uCoreColor: { value: new Color('#dffaff') },
      /*
        Sets where this lands against the bloom threshold in PostFX.

        Bloom runs before tone mapping and therefore sees raw values, so this
        number decides whether the portal glows or whether it turns into a white
        rectangle. It is set so the crests of the arms cross the threshold and
        nothing else does: the body of the effect stays under it, which is what
        keeps the bloom reading as glowing ribbons rather than as a lit fog.
        Raising it is the fastest way to ruin this scene.
      */
      uIntensity: { value: 1.9 },
      /** Number of arms. Odd numbers avoid the symmetry reading as a pinwheel. */
      uArms: { value: 3 },
      /** How tightly the arms wind. Higher is a denser vortex. */
      uTwist: { value: 9.0 },
      /** Radians per second. Slow: this is ambience, not a loading spinner. */
      uSpeed: { value: 1.15 },
    }),
    [],
  )

  useFrame((state) => {
    if (material.current) {
      material.current.uniforms.uTime.value = state.clock.elapsedTime
    }
  })

  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        /*
          Additive, so the arms build on whatever is behind them rather than
          replacing it. This is what makes the surface look like light in the
          air rather than like a printed decal hung in the doorway.
        */
        blending={AdditiveBlending}
        /*
          Depth writing off because the surface is transparent, and additive
          transparency that writes depth occludes everything drawn after it,
          including the other half of itself.
        */
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  )
}
