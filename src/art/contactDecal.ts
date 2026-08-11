import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MultiplyBlending,
  ShaderMaterial,
} from 'three'

/**
 * Static contact shadows for everything in the world that is not the character.
 *
 * `ContactBlob.tsx` solved this for exactly one object and its comments carry the
 * whole mechanism. This is the same construction made static, batched and
 * art-directable: two triangles per object base in one merged geometry, one
 * multiply-blended draw call for all of them, no dependency on the shadow map's
 * frustum and no screen-space pass.
 *
 * ## What this replaces, and why neither of the alternatives could do it
 *
 * **Ambient occlusion.** It came out at all three tiers with the shadow-end
 * decision, and the junctions where it was earning its cost were flat-on-flat
 * stone: a plinth on a spur lobe, a deck puck on the lawn, the portal's jambs on
 * T3. At a flat-on-flat corner visibility approaches 0.5, so the pass was putting
 * a real 0.28 m band there and dropping a 0.65 deck to about 0.47. That band is
 * what this file is for.
 *
 * **The cast shadow.** It exists, it is in the frustum, and it does not do this
 * job. Transects either side of the 30-degree pylon's shadow on
 * `pre3-high--hub-establishing` read 0.324 / 0.387 / 0.359 / 0.373 in shadow
 * against controls of 0.472 / 0.569 / 0.507 / 0.553 at 1.5 / 2.5 / 3.5 / 4.5 m
 * from the base - a real streak, 0.15 to 0.18 of display luma deep. At 0.4 m from
 * the base the same measurement is 0.089 and at 0.8 m it is 0.021. **The cast
 * shadow is weakest exactly where contact has to be strongest**, because
 * `shadow-bias` -0.0004 and `shadow-normalBias` 0.06 both push the lookup away
 * from the occluder and near a base the occluder is centimetres from the
 * receiver.
 *
 * And a cast shadow is directional by construction, so at any vantage looking
 * along the key's bearing it hides behind the object making it. `hub-totem`'s
 * camera forward dots to **0.924** with the shadow direction, which is why the
 * plinth in that shot cannot be given contact by the shadow map from any frustum
 * at all: its shadow is directly behind it. Occlusion darkened all the way round;
 * a cast shadow darkens one side. They are not interchangeable, and this is the
 * one that goes all the way round.
 *
 * ## Why this is not the root pad that was removed
 *
 * `HubIsland.tsx` records a band-2 disc under a grove being pulled for reading as
 * "a hole burnt in the lawn". That failure had three causes and this shares none.
 *
 * It was OPAQUE, so it replaced the grass and the ground texture rather than
 * darkening them. This multiplies, so both read through: a contact at full
 * strength 0.50 still passes 53% of whatever is underneath, including the ground
 * texture's own worn circuit traces and every blade standing in it.
 *
 * It had a HARD EDGE at a fixed radius. The falloff here reaches exactly zero at
 * the patch rim - `pow(1.0 - t, 1.7)` is 0 at t = 1, not merely small - so there
 * is no radius anywhere at which the decal starts or stops. The quad's corners
 * lie outside the band entirely and clamp to a literal no-op,
 * `mix(vec3(1.0), c, 0.0)`.
 *
 * And it was ONE VALUE picked as an albedo. This is a gradient whose peak is
 * solved backwards from a measured target on the frame; see `CONTACT_STRENGTH`.
 *
 * ## The two three.js traps, both silent
 *
 * `MultiplyBlending` REQUIRES `premultipliedAlpha: true`. With it false,
 * `WebGLState.setBlending` logs an error and returns WITHOUT SETTING A BLEND
 * FUNCTION, so the quad composites against whatever state the previous draw call
 * left bound. That is order-dependent and it changes with the scene. See the long
 * note in `ContactBlob.tsx`, where it was found by reading the console rather
 * than by looking at the frame, which looked plausible throughout.
 *
 * And `toneMapped: false`, because the multiply has to land in the HDR buffer
 * before ACES. Tone-mapping this quad's output applies a display curve to a
 * number that is a multiplier rather than a colour.
 */

/** A patch's falloff metric. */
export type ContactShape =
  /** Radial. The right metric for a post, a puck, a plinth, a boulder. */
  | 'disc'
  /**
   * Per-axis, rounded at the corners. The right metric for anything whose foot
   * is not square-ish in plan.
   *
   * A radial falloff round a 12 x 4 slab cannot give a band of even width: one
   * `inner` fraction is 0.95 along the long axis and 0.87 along the short one, so
   * the long sides get three times the band the short sides do. Normalising each
   * axis by its own foot and taking `length(max(e, 0))` gives a genuinely
   * uniform band with rounded corners, which is also what an occlusion pass was
   * producing there.
   */
  | 'rect'

/**
 * One object's contact patch.
 *
 * Authored as the object's own foot plus a band width, rather than as a total
 * radius, because the band width is the thing with an acceptance criterion
 * attached: it has to span more than 6 px at the framings being judged.
 */
export type Contact = {
  /** Centre of the object's foot, world space. */
  x: number
  z: number
  /**
   * The RECEIVING surface's height, world space. Not the object's own base.
   *
   * A flat quad is correct here rather than an approximation, and only because
   * `Terrain.tsx` makes the walkable surface flat on purpose: the plateau is a
   * `circleGeometry` at y = 0 and every deck top is a flat face at a known
   * multiple of `STEP`. If the walkable surface ever gains displacement, this
   * file needs a per-vertex height and a test that fails until it has one.
   */
  y: number
  /** Half-extent of the object's own foot along world X, before `yaw`. */
  footX: number
  /** Half-extent along world Z. Defaults to `footX`. */
  footZ?: number
  /**
   * Width of the visible gradient, in metres, added outside the foot on every
   * side.
   *
   * This is the number the acceptance test is about, and it is what sets contact
   * strength AT DISTANCE rather than the peak: the falloff runs in the band's own
   * normalised width, so halving the band does not tighten the contact, it decays
   * it before it has cleared the object. A pylon's 0.81 m band is 24 px at
   * `hub-establishing` after the ground's foreshortening; a plinth's 0.80 m band is
   * 74 px at `hub-totem`. The floor is 6 px.
   */
  band: number
  /** Rotation about world Y, radians. Only meaningful for a `rect`. */
  yaw?: number
  /** Peak multiply strength, 0 to 1. Set per family; see `CONTACT_STRENGTH`. */
  strength: number
  shape?: ContactShape
  /**
   * Band width along Z, if it differs. Lets one patch be a straight edge rather
   * than a footprint: a riser gets `band` 0.30 across the step and a long thin
   * foot along it, so the gradient hugs the riser and fades out only at the ends
   * of the run.
   */
  bandZ?: number
}

/**
 * Peak strengths per family, solved backwards from a measured target.
 *
 * The multiply tint is `CONTACT_TINT.hub`, `#3d4a6b`, which linearises to
 * (0.0468, 0.0684, 0.1499) for a linear Rec.709 luma of **0.0697**. The factor
 * applied at alpha `a` is therefore `1 - 0.9303 a`.
 *
 * **These are derived against the AO-OFF frame, not the pre-round-3 captures.**
 * Removing the pass lifts the lawn from 0.5015 to 0.5472 on a clean same-origin
 * A/B at high, so every number below was re-derived at 0.55 rather than 0.50. Had
 * they been solved against the old lawn they would all have been about 12% too
 * strong, which on the shadow end of a frame that has almost none is exactly the
 * error that produces a burnt hole.
 *
 * Lawn at 0.5472 display is linear 0.2602. Landing 0.12 below it means display
 * 0.4272, linear 0.1527, a ratio of 0.587, so `a = 0.444`. At the 0.50 below
 * gives 0.138 of drop, comfortably over the requirement without reaching for it.
 *
 * A band-1 deck at about 0.66 display is linear 0.394. At `a = 0.52` the factor
 * is 0.516, linear 0.2033, display 0.4900 - a drop of **0.17**, which is what the
 * occlusion pass was delivering at a flat-on-flat corner and therefore the number
 * to replace rather than to beat. A brighter receiver needs MORE alpha for the
 * same absolute drop, which is why these are two numbers and not one.
 *
 * Both estimates ignore ACES, which compresses the shadow end and will eat a
 * little of each drop, so both are the low end of their range rather than the
 * middle.
 *
 * They are per family and they are in one table on purpose: **if any single
 * family reads as a decal at 250% the integrator zeroes its entry**, rather than
 * unpicking geometry or reverting the patch.
 */
export const CONTACT_STRENGTH = {
  /** On grass and on the bare ground texture inside a planting exclusion. */
  lawn: 0.5,
  /** On a band-1 deck, which is brighter and needs more for the same drop. */
  deck: 0.52,
  /**
   * Boulders and groves, held back deliberately.
   *
   * These are the two families whose members overlap each other - boulders
   * arrive in clumps of five inside a 3.2 m circle - and multiply STACKS. Two
   * patches at 0.44 give a combined factor of 0.68 where one gives 0.59, so a
   * clump reads as a pool rather than as a hole only if each member is
   * under-strength alone.
   */
  scatter: 0.44,
} as const

const VERT = /* glsl */ `
attribute vec2  aFoot;
attribute float aStrength;
attribute float aShape;
varying vec2  vUv;
varying vec2  vFoot;
varying float vStrength;
varying float vShape;
void main() {
  vUv = uv;
  vFoot = aFoot;
  vStrength = aStrength;
  vShape = aShape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * White is the identity for multiplication, so the fade is a mix TOWARD the
 * shadow colour and never an alpha. Writing alpha here would do nothing at all -
 * multiply ignores it - and the fragment writes 1.0 deliberately so that
 * premultiplying is a provable no-op rather than a correction.
 */
const FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;
varying vec2  vUv;
varying vec2  vFoot;
varying float vStrength;
varying float vShape;

void main() {
  /* The patch's own normalised offset from its centre, 0 at the middle, 1 at a
     face, more than 1 in the corners. */
  vec2 p = abs((vUv - 0.5) * 2.0);

  /* Per-axis excess outside the foot: 0 where the object stands, 1 at the rim. */
  vec2 e = (p - vFoot) / max(vec2(1.0) - vFoot, vec2(1e-3));

  /* A rounded rectangle, or a circle for a foot that is square in plan. Both
     reach 1 at the rim and neither has a discontinuity anywhere. */
  float t = vShape < 0.5
    ? clamp((length(p) - vFoot.x) / max(1.0 - vFoot.x, 1e-3), 0.0, 1.0)
    : clamp(length(max(e, vec2(0.0))), 0.0, 1.0);

  /* Full strength under the foot, where the object is standing on it and it
     costs nothing, then a gradient that reaches EXACTLY zero at the rim. That
     last word is the whole difference between a contact and a decal. */
  float a = clamp(pow(1.0 - t, 1.7) * vStrength * uOpacity, 0.0, 1.0);

  gl_FragColor = vec4(mix(vec3(1.0), uColor, a), 1.0);
}
`

/**
 * Every contact in a scene as one geometry: four vertices and two triangles each.
 *
 * Merged rather than instanced, on the reasoning `HubIsland.tsx` already sets out
 * for the deck batch and for one extra reason specific to this material. An
 * `InstancedMesh` needs `USE_INSTANCING` defined and the `instanceMatrix`
 * multiply written by hand in the vertex shader; forget the multiply and every
 * patch renders at the origin, which is a silent failure of exactly the kind this
 * codebase has now been cut by four times. Sixty-odd contacts is about 130
 * triangles against a 4.86M-triangle hub, so the merge is free and it cannot
 * fail quietly.
 *
 * Returns null for an empty list rather than an empty geometry, so a caller skips
 * the mesh instead of issuing a draw call that covers nothing.
 */
export function contactDecalGeometry(contacts: Contact[], lift = 0.012): BufferGeometry | null {
  if (contacts.length === 0) return null

  const n = contacts.length
  const position = new Float32Array(n * 4 * 3)
  const normal = new Float32Array(n * 4 * 3)
  const uv = new Float32Array(n * 4 * 2)
  const foot = new Float32Array(n * 4 * 2)
  const strength = new Float32Array(n * 4)
  const shape = new Float32Array(n * 4)
  const index = new Uint16Array(n * 6)

  const UV: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]

  contacts.forEach((c, q) => {
    const footX = c.footX
    const footZ = c.footZ ?? c.footX
    const bandX = c.band
    const bandZ = c.bandZ ?? c.band
    const rx = footX + bandX
    const rz = footZ + bandZ
    const yaw = c.yaw ?? 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)

    // Corner order (-,-) (+,-) (+,+) (-,+), paired with the uv square above so
    // the shader's `vUv - 0.5` is the patch's own local offset.
    const corners: Array<[number, number]> = [
      [-rx, -rz],
      [rx, -rz],
      [rx, rz],
      [-rx, rz],
    ]

    for (let k = 0; k < 4; k++) {
      const [lx, lz] = corners[k]
      const v = q * 4 + k
      position[v * 3] = c.x + lx * cos - lz * sin
      position[v * 3 + 1] = c.y + lift
      position[v * 3 + 2] = c.z + lx * sin + lz * cos
      normal[v * 3 + 1] = 1
      uv[v * 2] = UV[k][0]
      uv[v * 2 + 1] = UV[k][1]
      /*
        Clamped below 1 rather than trusted. A zero band would make the foot
        fraction exactly 1, and the shader's own `max(1 - foot, 1e-3)` would then
        turn a division by zero into a step function - a hard edge, which is the
        one thing this system must never produce.
      */
      foot[v * 2] = Math.min(footX / rx, 0.98)
      foot[v * 2 + 1] = Math.min(footZ / rz, 0.98)
      strength[v] = c.strength
      shape[v] = (c.shape ?? 'disc') === 'rect' ? 1 : 0
    }

    const base = q * 4
    index.set([base, base + 1, base + 2, base, base + 2, base + 3], q * 6)
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setAttribute('aFoot', new BufferAttribute(foot, 2))
  geometry.setAttribute('aStrength', new BufferAttribute(strength, 1))
  geometry.setAttribute('aShape', new BufferAttribute(shape, 1))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * @param color The tint, supplied by the scene's light rig through
 *   `CONTACT_TINT`. Coloured and never black, for the reason `contactTint.ts`
 *   gives: a neutral contact reads as dirt and a cool one reads as shadow.
 */
export function createContactDecalMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      /** One global dimmer, so the whole system has a single lever. */
      uOpacity: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: MultiplyBlending,
    /*
      Mandatory, and not for the reason the name suggests. `MultiplyBlending`
      with `premultipliedAlpha` false takes the branch in
      `WebGLState.setBlending` that logs an error and sets NO blend function, so
      the result is whatever the previous draw call left bound. Premultiplying is
      itself a no-op here because the fragment writes alpha 1.0:
      `src.rgb * dst.rgb + dst * (1 - 1)` is exactly `src.rgb * dst.rgb`.
    */
    premultipliedAlpha: true,
    /* The multiply belongs in the HDR buffer, before ACES. */
    toneMapped: false,
    /*
      Coplanar with a flat ground disc and with flat deck tops, which is what
      polygon offset is for. The 0.012 m physical lift in the geometry is the belt
      to this braces and is `SHADOW.lift` exactly, which the character's blob
      already uses successfully against these same two surfaces.
    */
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    /*
      Double sided, as a robustness decision rather than a visual one. A ground
      decal is only ever seen from above, so the back faces cost two triangles
      that are never rasterised - and getting the winding backwards on a
      hand-built index buffer draws NOTHING AT ALL, silently, which is the
      failure mode this project keeps paying for.
    */
    side: DoubleSide,
  })
}
