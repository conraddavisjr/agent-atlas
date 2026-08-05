import { useMemo } from 'react'
import { BackSide, Color, type ShaderMaterial } from 'three'
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
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3  uTop;
  uniform vec3  uHorizon;
  uniform vec3  uSunColor;
  uniform vec3  uSunDirection;
  uniform float uExponent;

  varying vec3 vWorldPos;

  void main() {
    vec3 dir = normalize(vWorldPos);

    /*
      Height blend, biased toward the horizon. A linear ramp puts the midpoint
      halfway up the dome, which is far higher than the eye expects: most of a
      real sky's colour change happens in the first few degrees above the
      skyline, and the rest is close to uniform.
    */
    float h = pow(clamp(dir.y * 0.5 + 0.5, 0.0, 1.0), uExponent);
    vec3 col = mix(uHorizon, uTop, h);

    /*
      A broad warm glow around the sun rather than a disc. The disc itself would
      sit at a fixed point the player can orbit around and stare at, and at this
      camera height it spends most of its time behind the island anyway. The
      glow is what actually reads, and it is what ties the sky to the direction
      the shadows fall.
    */
    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    col += uSunColor * pow(sun, 8.0) * 0.55;
    col += uSunColor * pow(sun, 2.0) * 0.12;

    gl_FragColor = vec4(col, 1.0);
  }
`

export function SkyDome({
  /** Matched to the key light, so the glow agrees with where shadows fall. */
  sunDirection = [8, 14, 6],
  /** Comfortably inside the camera's far plane of 250. */
  radius = 200,
}: {
  sunDirection?: [number, number, number]
  radius?: number
}) {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color(palette.skyTop) },
      uHorizon: { value: new Color(palette.skyHorizon) },
      uSunColor: { value: new Color('#fff4d6') },
      uSunDirection: { value: sunDirection },
      /*
        Above 1 pushes the gradient's midpoint down toward the horizon. Around
        1.6 puts the transition roughly where the eye expects a skyline.
      */
      uExponent: { value: 1.6 },
    }),
    [sunDirection],
  )

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
