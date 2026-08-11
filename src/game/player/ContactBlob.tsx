import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Color,
  Mesh,
  MultiplyBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'
import { useQuality } from '@/art/useQuality'
import { SHADOW } from './animTuning'
import type { Pose } from './robotPose'

/**
 * The character's contact shadow.
 *
 * This is the single highest value-per-cost item on the character and it is
 * worth being explicit about why. `Lighting.tsx` covers a 36 m square with a
 * 2048 map on medium, which is 57 texels per metre. The character's foot span
 * is 0.70 m, so its entire cast shadow is about forty texels across and its
 * contact edge is one. That is why the robot reads as hovering, and it is not a
 * resolution problem any tier can afford to solve: doubling the map buys one
 * more texel at the contact.
 *
 * Two triangles and one raycast fix it outright.
 *
 * The mesh is a direct child of the scene rather than of the character. Parented
 * under the character's root it would inherit the squash scale, and a shadow
 * that squashes with the body is the classic tell of a fake contact shadow: it
 * stops reading as something on the floor and starts reading as a decal stuck
 * to the feet.
 */

/**
 * A plane, not a disc. The falloff lives in the shader, so two triangles do the
 * job a 24-segment circle would do with twenty-four.
 *
 * Rotated at construction rather than on the mesh, which leaves the mesh's own
 * quaternion free for the ground-normal alignment and saves a composition every
 * frame.
 */
const SHADOW_GEOMETRY = new PlaneGeometry(1, 1)
SHADOW_GEOMETRY.rotateX(-Math.PI / 2)

const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Multiply blending with a white no-op, which is the trick that makes this
 * work at all.
 *
 * Multiply is the correct operator for a shadow: it darkens what is beneath it
 * in proportion, so the grass texture and the stone grain survive underneath.
 * Normal-blending a coloured quad would flatten them into a solid patch, which
 * is the single most common way a blob shadow looks wrong.
 *
 * White is the identity for multiplication, so the fade has to be a mix toward
 * the shadow colour rather than an alpha. Writing alpha here would do nothing;
 * multiply ignores it.
 */
const SHADOW_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;
uniform float uCore;
varying vec2  vUv;

void main() {
  float d = clamp(length((vUv - 0.5) * 2.0), 0.0, 1.0);

  // A soft falloff for the body of the shadow, plus a tighter darker core. The
  // core is what actually glues the toy to the floor; the soft part on its own
  // reads as a smudge under the character rather than as contact.
  float soft = pow(1.0 - d, 1.6);
  float core = smoothstep(0.55, 0.0, d) * uCore;
  float a = clamp((soft + core) * uOpacity, 0.0, 1.0);

  gl_FragColor = vec4(mix(vec3(1.0), uColor, a), 1.0);
}
`

/*
  Module-level scratch. The frame loop allocates nothing, matching the
  convention the rest of the player code already uses.
*/
const UP = new Vector3(0, 1, 0)
const normalScratch = new Vector3()
const tiltQuat = new Quaternion()
const yawQuat = new Quaternion()

/**
 * @param pose The pose buffer the solver writes. Only `pose.shadow` is read.
 * @param color The shadow's tint. Coloured, never black: the reference is
 *   explicit that a black contact shadow is the "ambient occlusion looks like
 *   dirt" failure, and the hub's value is the sky driven to 42% because the sky
 *   is what fills this scene's shadows.
 */
export function ContactBlob({
  pose,
  color,
}: {
  pose: RefObject<Pose | null>
  /**
   * The centre tint, supplied by the scene rather than defaulted here.
   *
   * A contact shadow is the darkest thing the rig produces and its colour is
   * decided entirely by what else is reaching that pixel, so it belongs to the
   * light rig. `Lighting.tsx` exports `CONTACT_TINT` per scene; a default here
   * meant the cave wore a hub-tinted shadow.
   */
  color: string
}) {
  const quality = useQuality()
  const meshRef = useRef<Mesh>(null)
  /*
    The material is built in the mesh's ref callback and disposed on unmount,
    rather than declared in JSX.

    It has to be constructed rather than spread, because `MultiplyBlending` and
    `toneMapped: false` are constructor-time decisions and because the uniforms
    are mutated every frame. Building it here rather than in the render body is
    what keeps the ref out of render, which the React compiler rules require and
    which is also just correct: a ref read during render is a value React is
    allowed to have changed under you.
  */
  const materialRef = useRef<ShaderMaterial | null>(null)

  useEffect(() => {
    return () => {
      materialRef.current?.dispose()
      materialRef.current = null
    }
  }, [])

  useFrame(() => {
    const mesh = meshRef.current
    const material = materialRef.current
    const p = pose.current
    if (!mesh || !material || !p) return
    const s = p.shadow

    ;(material.uniforms.uColor.value as Color).set(color)
    material.uniforms.uOpacity.value = s.opacity

    /*
      Left in place at zero opacity rather than hidden.

      Toggling `visible` is a material state change every time the character
      leaves the ground, and a zero-opacity multiply quad writes vec3(1.0),
      which is a genuine no-op rather than an approximation of one.
    */
    normalScratch.set(s.nx, s.ny, s.nz)
    if (normalScratch.lengthSq() < 1e-12) normalScratch.copy(UP)
    else normalScratch.normalize()

    // Lifted along the ground normal rather than along world up, so the offset
    // stays perpendicular to the surface on a slope instead of shrinking with
    // the cosine of it.
    mesh.position.set(
      s.x + normalScratch.x * SHADOW.lift,
      s.y + normalScratch.y * SHADOW.lift,
      s.z + normalScratch.z * SHADOW.lift,
    )

    tiltQuat.setFromUnitVectors(UP, normalScratch)
    yawQuat.setFromAxisAngle(UP, s.yaw)
    // Yaw multiplied on the right, so it happens in the already-tilted frame
    // and the elongation follows the slope rather than cutting across it.
    mesh.quaternion.copy(tiltQuat).multiply(yawQuat)

    /*
      The elongation is the mesh's scale rather than a shader uniform.

      The design spec puts a `1 / uStretch` on the fragment's x, which widens the
      falloff inside a quad that has not itself grown, so at the spec's own
      maximum stretch the shadow is clipped by the quad edge at about 11% alpha.
      Scaling the geometry instead makes a UV circle into a world ellipse, keeps
      the falloff smooth all the way to the edge, and removes a uniform.

      Along local Z, because the robot's forward at zero facing is +Z and the
      yaw above has already pointed local Z along the direction of travel.
    */
    const d = s.radius * 2
    mesh.scale.set(d, 1, d * s.stretch)
  })

  /*
    Now gated on `quality.contactShadow`, which is true at every tier.

    It shipped ungated because the flag was false everywhere and gating on it
    would have shipped a feature nobody could see. With the flag on, leaving it
    ungated would be worse: `?nogfx=blob` is one of the six rollback levers and
    it has to actually work, and the tier table has to describe the build.

    The flag is true at low as well, and that is deliberate rather than an
    oversight. `low` already gives up ambient occlusion, soft shadows and
    clouds, and a 1024 shadow map cannot glue the robot to the floor on its
    own, so this is the tier that needs the blob most. Two triangles and one
    raycast is not a cost worth a tier decision.

    renderOrder 1 puts it after the opaque ground and before particles, which
    sit at 2. Without an explicit order three sorts transparents back to front
    by distance, and the shadow can end up drawn after a dust puff that should
    be lying on top of it.
  */
  if (!quality.contactShadow) return null

  return (
    <mesh
      ref={(o) => {
        meshRef.current = o
        if (!o) return
        if (materialRef.current === null) materialRef.current = createShadowMaterial(color)
        o.material = materialRef.current
      }}
      geometry={SHADOW_GEOMETRY}
      renderOrder={1}
      frustumCulled={false}
    />
  )
}

function createShadowMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: 0 },
      uCore: { value: 0.35 },
    },
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: MultiplyBlending,
    /*
      Mandatory, and not for the reason the name suggests.

      `WebGLState.setBlending` has two branches. With `premultipliedAlpha` true,
      `MultiplyBlending` sets `blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA,
      ZERO, ONE)`, which is the multiply this shader is written against. With it
      false, the `MultiplyBlending` case logs an error and BREAKS WITHOUT
      SETTING A BLEND FUNCTION AT ALL, so the quad composites with whatever
      state the previous draw call happened to leave behind. That is
      order-dependent, it changes with the scene, and it is not what anyone
      would call a shadow.

      Caught by reading the console rather than by looking at the frame: it was
      producing an error every frame, several thousand of them, while the image
      looked plausible enough to accept.

      Premultiplying is a no-op for this material regardless, because the
      fragment writes alpha 1.0. So `src.rgb * dst.rgb + dst * (1 - 1)` is
      exactly `src.rgb * dst.rgb`.
    */
    premultipliedAlpha: true,
    /*
      The multiply happens in the HDR buffer before tone mapping. Letting three
      tone-map this quad's own output would apply the ACES curve to a value that
      is a multiplier rather than a colour.
    */
    toneMapped: false,
    /*
      Belt and braces against z-fighting. The polygon offset handles being
      coplanar with the ground mesh; the physical lift in the frame loop handles
      the hub island, where the visual terrain is displaced and its collider is
      not, so the surface the ray hits is not the surface being drawn.
    */
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
}
