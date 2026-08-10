import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, type Texture } from 'three'
import { mulberry32 } from './placement'

/**
 * Procedural surface detail: the marks injection moulding leaves behind.
 *
 * Extends the pattern `groundTexture.ts` already proves - a canvas drawn at
 * load, seeded so it is identical every session, made seamless by drawing every
 * operation nine times through `drawWrapped`, costing one canvas and no
 * download. Read that file first; this one is the same idea applied to the
 * built environment instead of to the lawn.
 *
 * **Why this exists at all.** Roughness in this project is uniform on every
 * surface except the two photographic sets, and perfectly uniform roughness is
 * the single fastest way to make a moulded object read as an untextured
 * polygon. The reference's fix is low-frequency noise driving roughness by plus
 * or minus 0.08, plus a small vocabulary of manufacturing marks: panel lines,
 * screw heads, vent grilles and directional chevrons. Four marks, and
 * deliberately no more, because a vocabulary that grows past a handful stops
 * reading as a process and starts reading as greeble.
 *
 * **The split, which is the point of the file's shape.** Working out WHERE the
 * marks go is a pure function of a seed and a few dimensions, returns plain
 * data, and is unit tested. Turning that data into pixels needs a canvas, so it
 * is not. Everything above `createDecalMaps` runs under vitest's node
 * environment; everything from there down is the thin rasterising shell.
 *
 * See `docs/design/02-materials.md` sections 4 and 7.
 */

// ---------------------------------------------------------------------------
// The roughness bias, which is the one genuinely fiddly thing here
// ---------------------------------------------------------------------------

/**
 * The roughness a mid-grey texel means, and the number every bias divides by.
 *
 * three computes `roughnessFactor *= texelRoughness.g`, so the map is a
 * MULTIPLIER and 1.0 is neutral. There is no way for a map to push roughness
 * above the material's own value, which makes a signed offset impossible to
 * express directly - and a signed offset is exactly what "vary roughness by
 * plus or minus 0.08" asks for.
 *
 * The fix is to bias the material. Pick a mid green of 0.80, set
 * `material.roughness = target / 0.80`, and the map now has headroom in both
 * directions around its own middle. Getting this wrong makes a whole world
 * uniformly shinier or duller than authored with no other symptom, which is why
 * the conversion lives in one place and every caller takes the divisor from
 * `roughnessBias` rather than typing 0.8 again.
 */
export const ROUGHNESS_MID = 0.8

/** The byte the mid roughness is written as. `round(0.80 * 255)`. */
export const ROUGHNESS_MID_BYTE = 204

/**
 * What a material's `roughness` must be set to when it carries one of these
 * maps, so that a mid-grey texel reproduces the roughness that was authored.
 */
export function roughnessBias(target: number): number {
  return target / ROUGHNESS_MID
}

/**
 * The green byte that encodes `value` on a material biased for `target`.
 *
 * Worked example, straight out of the materials spec, for `plastic()` at target
 * 0.38 with a plus or minus 0.08 swing: the material carries
 * `roughness = 0.475`, the mid writes as 204, 0.30 writes as 161 and 0.46 as
 * 247. So the green channel of these maps lives in the byte range 161 to 247,
 * centred on 204.
 */
export function roughnessByte(value: number, target: number): number {
  if (!(target > 0)) {
    throw new Error(`decalTextures: roughness target must be positive, got ${target}`)
  }
  const raw = Math.round(((value * ROUGHNESS_MID) / target) * 255)
  return Math.max(0, Math.min(255, raw))
}

// ---------------------------------------------------------------------------
// Marks: the pure half
// ---------------------------------------------------------------------------

/**
 * One mark, in TILE COORDINATES: 0 to 1 across the tile in both axes,
 * independent of the resolution it is eventually drawn at.
 *
 * Authoring in tile units rather than in pixels is what makes the layout
 * testable at all. An assertion about where a panel line sits is then a
 * statement about the design, not about a rasteriser, and the same pattern
 * comes out identical at 512 and at 1024.
 *
 * `depth` is a signed displacement of the height mask, whose base is 0.5. A
 * groove is negative, a raised lip or a screw head is positive.
 */
export type Mark =
  | { kind: 'panel'; x1: number; y1: number; x2: number; y2: number; width: number; depth: number }
  | { kind: 'screw'; x: number; y: number; radius: number; depth: number }
  | { kind: 'vent'; x: number; y: number; width: number; height: number; angle: number; depth: number }
  | { kind: 'chevron'; x: number; y: number; size: number; angle: number; depth: number }

/**
 * How much of the tile border is kept clear of marks, as a fraction.
 *
 * Panel lines are not allowed to cross a bevel: a groove that runs off the edge
 * of a moulded face and continues around the fillet reads as a crack rather
 * than as a part line. The tile does not know where the mesh's edges are, so
 * the approximation is to keep the outermost band clear, which puts the
 * fillet-crossing risk on the flat middle of a face where there is nothing to
 * cross.
 */
const BORDER = 0.06

export type PanelLineSpec = {
  /** Distance between lines, in metres. */
  pitch: number
  /** How many metres one tile covers. Converts the pitch into tile units. */
  metresPerTile: number
  /** Groove width in metres. 2.5 mm is the house value. */
  width?: number
  /** Height-mask displacement of the groove. Negative. */
  depth?: number
  seed: number
  /** Fraction of grid runs dropped, so the result reads as parts not as tiling. */
  suppress?: number
}

/**
 * Grooves separating moulded parts, on a grid with runs suppressed at random.
 *
 * The suppression is what stops this reading as graph paper. A complete grid is
 * a texture; a grid with three in ten of its runs missing is a set of parts
 * that happen to have been laid out on a grid, which is what a moulded assembly
 * actually looks like.
 */
export function panelLines({
  pitch,
  metresPerTile,
  width = 0.0025,
  depth = -0.16,
  seed,
  suppress = 0.3,
}: PanelLineSpec): Mark[] {
  if (!(pitch > 0) || !(metresPerTile > 0)) return []

  const step = pitch / metresPerTile
  if (step >= 1) return []

  const random = mulberry32(seed)
  const lineWidth = width / metresPerTile
  const marks: Mark[] = []

  for (let t = step; t < 1 - 1e-9; t += step) {
    /*
      Each run is drawn full width rather than clipped to the border, and the
      border is respected by offsetting the run's position instead. A run that
      stopped short would leave a visible stub end in the middle of a face,
      which is a worse artefact than the one this avoids.
    */
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: 0, y1: t, x2: 1, y2: t, width: lineWidth, depth })
    }
    if (random() >= suppress) {
      marks.push({ kind: 'panel', x1: t, y1: 0, x2: t, y2: 1, width: lineWidth, depth })
    }
  }

  return marks
}

export type ScrewHeadSpec = {
  /** Heads per square metre of surface. */
  density: number
  metresPerTile: number
  /** Head radius in metres. 4 to 9 mm, as the spec's ejector marks. */
  radius?: number
  depth?: number
  seed: number
}

/**
 * Fastener heads, scattered on a jittered grid.
 *
 * A jittered grid rather than uniform random placement, because uniform random
 * clumps: at these densities pure rejection sampling reliably produces two heads
 * touching somewhere in the tile, and two touching screws read as a mistake
 * rather than as hardware. One per cell with the position jittered inside it
 * gives the same apparent randomness with a guaranteed minimum separation.
 */
export function screwHeads({ density, metresPerTile, radius = 0.006, depth = 0.05, seed }: ScrewHeadSpec): Mark[] {
  if (!(density > 0) || !(metresPerTile > 0)) return []

  const area = metresPerTile * metresPerTile
  const wanted = density * area
  const cells = Math.max(1, Math.round(Math.sqrt(wanted)))
  const random = mulberry32(seed)
  const r = radius / metresPerTile
  const marks: Mark[] = []

  const usable = 1 - 2 * BORDER
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      // Jitter is kept to 60% of a cell so neighbours cannot meet.
      const jx = (random() - 0.5) * 0.6
      const jy = (random() - 0.5) * 0.6
      marks.push({
        kind: 'screw',
        x: BORDER + (usable * (ix + 0.5 + jx)) / cells,
        y: BORDER + (usable * (iy + 0.5 + jy)) / cells,
        radius: r,
        depth,
      })
    }
  }

  return marks
}

export type VentGrilleSpec = {
  /** Centre of the group, in tile units. */
  x: number
  y: number
  /** Number of slots. 5 to 9. */
  slots: number
  /** Slot spacing in metres. 6 mm. */
  pitch?: number
  /** Slot width in metres. 2.5 mm. */
  slotWidth?: number
  /** Slot length in metres. */
  slotLength?: number
  metresPerTile: number
  /** Rotation of the whole group, in radians. */
  angle?: number
  depth?: number
}

/**
 * A slotted vent: the one mark placed by hand rather than tiled, because a vent
 * means something.
 *
 * The reference's rule is that only three placements in this world are earned
 * by the fiction - the robot's back below the cape socket, the lesson totem
 * plinth's collar, and the portal arch's inner face - and a vent anywhere else
 * is decoration pretending to be engineering. So this takes an explicit centre
 * rather than a count.
 */
export function ventGrille({
  x,
  y,
  slots,
  pitch = 0.006,
  slotWidth = 0.0025,
  slotLength = 0.05,
  metresPerTile,
  angle = 0,
  depth = -0.2,
}: VentGrilleSpec): Mark[] {
  if (slots < 1 || !(metresPerTile > 0)) return []

  const step = pitch / metresPerTile
  const width = slotWidth / metresPerTile
  const length = slotLength / metresPerTile
  const marks: Mark[] = []

  const first = -((slots - 1) / 2) * step
  for (let i = 0; i < slots; i++) {
    const offset = first + i * step
    marks.push({
      kind: 'vent',
      x: x + Math.cos(angle) * offset,
      y: y + Math.sin(angle) * offset,
      width,
      height: length,
      angle,
      depth,
    })
  }

  return marks
}

export type ChevronSpec = {
  x: number
  y: number
  count: number
  /** Chevron size in metres. */
  size?: number
  metresPerTile: number
  angle?: number
  depth?: number
}

/**
 * MEASURED, AFTER THE LADDER WAS FINALLY SWITCHED ON: relief alone is invisible
 * on a horizontal surface in this world, and that is geometry rather than tuning.
 *
 * With `surfaceMapSize` at 1024 on high, a deck patch measured p5-p95 of 0.039
 * against 0.0387 with the maps off, and high-frequency detail of 1.36 against
 * 1.37. Zero change, and the crops are indistinguishable.
 *
 * The reason is the key's elevation. Perturbing a normal that already points
 * almost straight at the light barely changes `N.L`, so a 2.4-strength normal map
 * on an up-facing deck under a key 42.7 degrees up produces almost no shading.
 * The roughness break has nothing to break, because `mattePlastic` is roughness
 * 0.75 and carries no specular to modulate. And the occlusion channel is floored
 * at 0.55 and multiplies a surface already lit mostly by ambient.
 *
 * The same maps DO read on vertical faces, where the key arrives at a grazing
 * angle: the kerb faces moved from 16.78 to 17.75 on the same metric in the same
 * frame. So the ladder is worth keeping for the frame and the trim, and it is
 * not what makes a platform read.
 *
 * That is the physical reason the reference art prints value instead of cutting
 * it, and it is why an albedo channel is the whole fix rather than a refinement
 * of this one.
 */

/**
 * A run of directional chevrons.
 *
 * Used only on things that move or that mark a direction, which in this world
 * means the threshold in front of a portal and the lip of a deck the route runs
 * over. A chevron on a static prop is a decal that says nothing, and the
 * reference's restraint rule caps any one object at three of the six marks.
 *
 * Cut as relief rather than printed as albedo. An embossed chevron survives the
 * greyscale readability test, because it produces a highlight and a shadow of
 * its own instead of relying on a value difference that band discipline is
 * separately trying to remove.
 */
export function warningChevrons({
  x,
  y,
  count,
  size = 0.09,
  metresPerTile,
  angle = 0,
  depth = 0.06,
}: ChevronSpec): Mark[] {
  if (count < 1 || !(metresPerTile > 0)) return []

  const s = size / metresPerTile
  const marks: Mark[] = []
  const first = -((count - 1) / 2) * s * 0.8

  for (let i = 0; i < count; i++) {
    const offset = first + i * s * 0.8
    marks.push({
      kind: 'chevron',
      x: x + Math.cos(angle) * offset,
      y: y + Math.sin(angle) * offset,
      size: s,
      angle,
      depth,
    })
  }

  return marks
}

/**
 * The four surface kinds, matching the material presets that carry them.
 *
 * `deck` is the walkable band-1 stone of the Core and the portal stack, `trim`
 * the band-2 kerbs and struts, `hull` the moulded plastic of the toy blocks and
 * the portal door, and `plate` the small hero props read at arm's length.
 */
export type DecalKind = 'deck' | 'trim' | 'hull' | 'plate'

export type KindSpec = {
  /** Physical size of one tile, which is the authoring target from section 4.6. */
  metresPerTile: number
  /** The roughness the material is aiming for, before the map biases it. */
  roughness: number
  /** Half the peak-to-peak roughness variation the map applies. */
  swing: number
  /** Panel line pitch in metres. Zero means no panel lines. */
  panelPitch: number
  /** Screw heads per square metre. Zero means none. */
  screwDensity: number
  /** Normal map strength, in height units per pixel. */
  normalStrength: number
}

/**
 * Per-kind parameters.
 *
 * `plate` gets the smallest swing of the four for the same reason the character
 * does: it is read close up, and breaking a small surface up as hard as a
 * twelve-metre deck makes it look damaged rather than moulded. `deck` gets the
 * largest because it is the biggest continuous area in the game and uniform
 * roughness across it sweeps a single specular band from one side of the island
 * to the other as the camera turns.
 */
export const DECAL_KINDS: Record<DecalKind, KindSpec> = {
  deck: {
    metresPerTile: 2,
    roughness: 0.72,
    swing: 0.14,
    panelPitch: 0.6,
    screwDensity: 0,
    normalStrength: 2.4,
  },
  trim: {
    /*
      1.6 m rather than the 1.2 that a 0.6 m kerb face suggests. A tile has to
      hold at least three panel positions or the suppression pass has nothing to
      thin, and a grid of one line either appears in full or vanishes entirely
      depending on the seed - which is exactly the failure this value was
      changed to fix.
    */
    metresPerTile: 1.6,
    roughness: 0.72,
    swing: 0.1,
    panelPitch: 0.4,
    screwDensity: 1.5,
    normalStrength: 2,
  },
  hull: {
    metresPerTile: 1,
    roughness: 0.38,
    swing: 0.08,
    panelPitch: 0.4,
    screwDensity: 4,
    normalStrength: 1.5,
  },
  plate: {
    metresPerTile: 0.35,
    roughness: 0.38,
    swing: 0.055,
    panelPitch: 0.12,
    screwDensity: 12,
    normalStrength: 1.2,
  },
}

/** Every mark for a kind, in draw order: lines first, hardware on top. */
export function decalMarks(kind: DecalKind, seed = 20260809): Mark[] {
  const spec = DECAL_KINDS[kind]
  return [
    ...panelLines({
      pitch: spec.panelPitch,
      metresPerTile: spec.metresPerTile,
      seed,
    }),
    ...screwHeads({
      density: spec.screwDensity,
      metresPerTile: spec.metresPerTile,
      seed: seed + 1,
    }),
  ]
}

// ---------------------------------------------------------------------------
// Height to maps: also pure
// ---------------------------------------------------------------------------

/**
 * Tangent-space normal map from a height mask, as raw RGBA bytes.
 *
 * `strength` is in height units per pixel. The Sobel kernels sum to 4 on their
 * positive lobe, so dividing by 4 makes `strength` mean "a slope of 1.0 in
 * height over one pixel produces a 45 degree normal", which is a scale a human
 * can reason about while tuning.
 *
 * Indexing WRAPS. A tile whose height mask is seamless then produces a normal
 * map that is seamless too; clamping instead puts a visible ridge on every tile
 * boundary, which is the classic way this goes wrong and is invisible until
 * something large is textured with it.
 *
 * Returns bytes rather than `ImageData` so the whole function runs under node.
 * `ImageData` is a DOM class, and putting it in the signature would make the
 * one piece of arithmetic here that is genuinely easy to get wrong the one
 * piece that could not be tested.
 */
export function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`decalTextures: height mask is ${height.length} for a ${size} square tile`)
  }

  const out = new Uint8ClampedArray(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1)
      const t = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const l = at(x - 1, y)
      const r = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const b = at(x, y + 1)
      const br = at(x + 1, y + 1)

      const gx = tr + 2 * r + br - (tl + 2 * l + bl)
      const gy = bl + 2 * b + br - (tl + 2 * t + tr)

      /*
        Both gradients are negated: a surface rising toward +X must tilt its
        normal toward -X. Getting this sign wrong inverts every groove into a
        ridge, and the result looks plausible enough to ship by mistake, which
        is why the flat-mask assertion in the tests is worth its two lines.
      */
      const nx = -gx * strength * 0.25
      const ny = -gy * strength * 0.25
      const inv = 1 / Math.hypot(nx, ny, 1)

      const i = (y * size + x) * 4
      out[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      out[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }

  return out
}

export type OrmOptions = {
  /** The material's authored roughness, before the bias. */
  roughness: number
  /** Half the peak-to-peak roughness swing. */
  swing: number
  /** How hard a groove darkens occlusion. Clamped at the 0.55 floor. */
  occlusion?: number
}

/**
 * The ORM pack: occlusion in red, roughness in green.
 *
 * Not a saving, a convention: three reads occlusion from a texture's red
 * channel and roughness from its green, so one image fills two material slots
 * and the same `Texture` object can be handed to both.
 *
 * Roughness is derived from height by INVERSION, which is the physical claim
 * that a recess collects dust and a proud surface gets wiped. A panel line is
 * therefore simultaneously a groove in the normal, a dust trap in the roughness
 * and a dark line in the occlusion, and it is the agreement between those three
 * that makes it read as a real seam rather than as a drawn one.
 *
 * Occlusion is floored at 0.55. Ambient occlusion that reaches zero reads as
 * dirt rather than as depth, which is the exact failure the reference brief
 * warns about and which this project has already made once elsewhere.
 */
export function ormFromHeight(
  height: Float32Array,
  size: number,
  { roughness, swing, occlusion = 0.9 }: OrmOptions,
): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`decalTextures: height mask is ${height.length} for a ${size} square tile`)
  }

  const out = new Uint8ClampedArray(size * size * 4)

  for (let i = 0; i < height.length; i++) {
    // Height runs 0 to 1 about a base of 0.5, so this is the signed relief.
    const relief = height[i] - 0.5

    const value = roughness - swing * relief * 2
    const shade = relief < 0 ? Math.max(0.55, 1 + relief * 2 * occlusion) : 1

    const p = i * 4
    out[p] = Math.round(shade * 255)
    out[p + 1] = roughnessByte(value, roughness)
    out[p + 2] = 0
    out[p + 3] = 255
  }

  return out
}

// ---------------------------------------------------------------------------
// Rasterisation: the untested shell
// ---------------------------------------------------------------------------

export type DecalMaps = {
  normalMap: Texture
  /** The same ORM image, handed to both slots. Occlusion is red, roughness green. */
  roughnessMap: Texture
  aoMap: Texture
  /**
   * What the material's `roughness` must be set to. See `roughnessBias`: the
   * map multiplies, so the material has to be pre-divided or the whole surface
   * comes out at 80% of the roughness that was authored.
   */
  roughness: number
}

/**
 * Run a drawing operation nine times, offset by one tile in each direction.
 *
 * Lifted wholesale from `groundTexture.ts`, and worth keeping identical rather
 * than shared: anything crossing an edge is also drawn entering the opposite
 * edge, so a groove running off the top continues from the bottom instead of
 * being cut. Far simpler than authoring a pattern to avoid its own edges, and
 * it cannot be got subtly wrong.
 */
function drawWrapped(ctx: CanvasRenderingContext2D, size: number, draw: () => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      ctx.save()
      ctx.translate(dx, dy)
      draw()
      ctx.restore()
    }
  }
}

/** Paint one mark into the height canvas, in pixels. */
function paint(ctx: CanvasRenderingContext2D, mark: Mark, size: number) {
  // 0.5 is the base plane, so a depth of d becomes a grey of 0.5 + d.
  const level = Math.max(0, Math.min(1, 0.5 + mark.depth))
  const shade = `rgb(${Math.round(level * 255)},${Math.round(level * 255)},${Math.round(level * 255)})`

  switch (mark.kind) {
    case 'panel': {
      drawWrapped(ctx, size, () => {
        /*
          The lip first, one pixel wider and raised, then the groove over it.
          A panel line without its lip reads as a scratch: real mould flow
          leaves a slight proud edge on the key side of the split, and that
          bright hairline beside the dark one is most of what the eye uses to
          tell a seam from damage.
        */
        ctx.strokeStyle = 'rgb(140,140,140)'
        ctx.lineWidth = mark.width * size + 2
        ctx.beginPath()
        ctx.moveTo(mark.x1 * size, mark.y1 * size)
        ctx.lineTo(mark.x2 * size, mark.y2 * size)
        ctx.stroke()

        ctx.strokeStyle = shade
        ctx.lineWidth = Math.max(1, mark.width * size)
        ctx.beginPath()
        ctx.moveTo(mark.x1 * size, mark.y1 * size)
        ctx.lineTo(mark.x2 * size, mark.y2 * size)
        ctx.stroke()
      })
      break
    }

    case 'screw': {
      drawWrapped(ctx, size, () => {
        const r = mark.radius * size
        ctx.fillStyle = shade
        ctx.beginPath()
        ctx.arc(mark.x * size, mark.y * size, r, 0, Math.PI * 2)
        ctx.fill()
        // The seat the head sits in, which is what gives it a contact shadow.
        ctx.strokeStyle = 'rgb(96,96,96)'
        ctx.lineWidth = Math.max(1, r * 0.35)
        ctx.beginPath()
        ctx.arc(mark.x * size, mark.y * size, r, 0, Math.PI * 2)
        ctx.stroke()
      })
      break
    }

    case 'vent': {
      drawWrapped(ctx, size, () => {
        ctx.save()
        ctx.translate(mark.x * size, mark.y * size)
        ctx.rotate(mark.angle + Math.PI / 2)
        ctx.fillStyle = shade
        const w = Math.max(1, mark.width * size)
        const h = mark.height * size
        ctx.beginPath()
        ctx.roundRect(-w / 2, -h / 2, w, h, w / 2)
        ctx.fill()
        ctx.restore()
      })
      break
    }

    case 'chevron': {
      drawWrapped(ctx, size, () => {
        ctx.save()
        ctx.translate(mark.x * size, mark.y * size)
        ctx.rotate(mark.angle)
        const s = mark.size * size
        ctx.strokeStyle = shade
        ctx.lineWidth = Math.max(1, s * 0.28)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(-s * 0.3, -s * 0.5)
        ctx.lineTo(s * 0.3, 0)
        ctx.lineTo(-s * 0.3, s * 0.5)
        ctx.stroke()
        ctx.restore()
      })
      break
    }
  }
}

/** Read a drawn canvas back as a height mask in the range 0 to 1. */
function heightFromCanvas(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const pixels = ctx.getImageData(0, 0, size, size).data
  const height = new Float32Array(size * size)
  for (let i = 0; i < height.length; i++) {
    // Rec.709 luminance, though the canvas is drawn in greys so any channel
    // would do. Written out anyway so a coloured mark added later still works.
    height[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255
  }
  return height
}

const cache = new Map<string, DecalMaps>()

/**
 * Build the map set for a kind, or return null where there is no canvas.
 *
 * Null rather than a stub, because `low` must be genuinely zero cost: no canvas
 * work, no extra textures, no extra shader variants. A caller that gets null
 * spreads no maps into its material, which compiles the same program it would
 * have compiled anyway. A stub set of neutral textures would cost two uploads
 * and two extra samplers per material to change nothing.
 *
 * Memoised at module scope on kind and size, exactly as `groundTexture.ts` and
 * `textures.ts` already do. Callers that need their own tiling clone the
 * textures and must set `needsUpdate` afterwards - `clone()` copies the
 * descriptor and leaves that flag false, so the GPU otherwise never receives
 * the new wrap and repeat settings.
 */
export function createDecalMaps(kind: DecalKind, size: 512 | 1024, extra: Mark[] = []): DecalMaps | null {
  if (typeof document === 'undefined') return null

  const key = `${kind}:${size}`
  const cached = cache.get(key)
  if (cached && extra.length === 0) return cached

  const spec = DECAL_KINDS[kind]

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // The base plane. Everything is a displacement from this mid grey.
  ctx.fillStyle = 'rgb(128,128,128)'
  ctx.fillRect(0, 0, size, size)

  for (const mark of [...decalMarks(kind), ...extra]) paint(ctx, mark, size)

  const height = heightFromCanvas(ctx, size)

  // One image in two slots. three samples the same texture twice rather than
  // uploading it twice, which is the whole point of the ORM convention.
  const orm = byteTexture(ormFromHeight(height, size, spec), size)

  const maps: DecalMaps = {
    normalMap: byteTexture(normalFromHeight(height, size, spec.normalStrength), size),
    roughnessMap: orm,
    aoMap: orm,
    roughness: roughnessBias(spec.roughness),
  }

  if (extra.length === 0) cache.set(key, maps)
  return maps
}

/** Wrap raw RGBA bytes as a tiling, linear-space texture. */
function byteTexture(bytes: Uint8ClampedArray, size: number): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  image.data.set(bytes)
  ctx.putImageData(image, 0, 0)

  const texture = new CanvasTexture(canvas)
  /*
    Linear, never sRGB. Tagging a roughness or a normal map as sRGB applies a
    decode curve to gloss values and to vectors, and the result is a world that
    reads shinier than authored with its normals bent toward the surface. It is
    a one-word mistake with no error and a look that is merely slightly wrong.
  */
  texture.colorSpace = LinearSRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  /*
    Anisotropic filtering, which this function was missing while every other
    generated texture in the project set it.

    It matters here more than anywhere else. These maps go onto the deck batch,
    whose largest member is a twelve-metre disc seen at a grazing angle from a
    camera 4.3 m up - which is the exact condition trilinear filtering handles
    worst. A 0.6 m panel pitch at that angle aliases into a moire that crawls as
    the camera moves, and the effect is far more visible than the panel lines it
    is made of.

    16 is the ceiling on every GPU this runs on, and it is clamped to the device
    maximum by three, so it is safe to ask for flatly rather than plumbing the
    renderer's capability object into a pure texture builder. `textures.ts` reads
    `getMaxAnisotropy()` because it already has the renderer to hand; this file
    does not and should not need it.
  */
  texture.anisotropy = 16
  texture.needsUpdate = true
  return texture
}
