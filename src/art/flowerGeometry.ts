import { BufferAttribute, BufferGeometry, Color } from 'three'

/**
 * A daisy, generated as a single geometry.
 *
 * Stem, petals and centre are all in one buffer, with which is which carried in
 * the vertex colours. That is the point of building it rather than assembling
 * it from three meshes: a flower needs at least three colours to read as a
 * flower, and vertex colours are how you get three colours out of one instanced
 * draw. A field of these is one draw call whatever it costs to look at.
 *
 * Everything is in metres, at the size the flower actually appears in the
 * world, so no caller has to know a scale convention. The last time a piece of
 * generated geometry took its size from a multiplier of an arbitrary base, the
 * grass came out wider than it was tall.
 */

export type DaisyOptions = {
  /** Petals around the head. Odd numbers avoid an obvious mirror line. */
  petals?: number
  /** Height of the stem, and so where the head sits. */
  stemHeight?: number
  /** How far a petal reaches from the middle of the head. */
  petalLength?: number
  /** Half-width of a petal at its widest. */
  petalWidth?: number
  /** Radius of the raised middle. */
  centreRadius?: number
  petalColor?: string
  centreColor?: string
  stemColor?: string
}

const DEFAULTS = {
  petals: 9,
  stemHeight: 0.26,
  petalLength: 0.085,
  petalWidth: 0.032,
  centreRadius: 0.028,
  petalColor: '#5aa9f5',
  centreColor: '#ffd24a',
  stemColor: '#4f9b2e',
} satisfies Required<DaisyOptions>

/** Segments along a petal. Four is enough for a rounded edge at this size. */
const PETAL_SEGMENTS = 4
/** Sides on the stem tube. It is two centimetres across; nobody counts them. */
const STEM_SIDES = 5

type Build = {
  positions: number[]
  colors: number[]
  indices: number[]
}

function vertex(b: Build, x: number, y: number, z: number, c: Color): number {
  const index = b.positions.length / 3
  b.positions.push(x, y, z)
  b.colors.push(c.r, c.g, c.b)
  return index
}

function triangle(b: Build, a: number, c: number, d: number) {
  b.indices.push(a, c, d)
}

/**
 * One petal, lying nearly flat and radiating along +X from the centre.
 *
 * Width follows a sine along its length, which gives a rounded tip and a
 * rounded shoulder rather than the diamond a linear taper produces. It also
 * lifts slightly toward the middle, so a head has some doming to catch light
 * across instead of reading as a printed sticker.
 */
function addPetal(b: Build, angle: number, o: Required<DaisyOptions>, color: Color, y: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // Local to world on the ground plane, rotated into the petal's direction.
  const place = (along: number, across: number, lift: number) =>
    vertex(b, cos * along - sin * across, y + lift, sin * along + cos * across, color)

  /*
    Width never reaches zero along the body of the petal, and the tip is a
    single vertex rather than a pair.

    The first version tapered to nothing at both ends with a plain sine, which
    put two coincident vertices at each end and therefore degenerate triangles
    with no area. computeVertexNormals gives those vertices a zero-length
    normal, and a zero normal is how generated geometry ends up rendering
    black. The neck keeps a width, and the tip closes with a fan.
  */
  const rows: [number, number][] = []
  for (let i = 0; i <= PETAL_SEGMENTS; i++) {
    const t = i / PETAL_SEGMENTS
    const along = o.centreRadius * 0.6 + t * o.petalLength * 0.88
    const across = o.petalWidth * (0.4 + 0.6 * Math.sin(Math.PI * t))
    const lift = Math.sin(Math.PI * t) * o.petalLength * 0.16
    rows.push([place(along, -across, lift), place(along, across, lift)])
  }

  for (let i = 0; i < PETAL_SEGMENTS; i++) {
    const [l0, r0] = rows[i]
    const [l1, r1] = rows[i + 1]
    triangle(b, l0, r0, l1)
    triangle(b, r0, r1, l1)
  }

  // Rounded tip, closing the last row to a point.
  const tip = place(o.centreRadius * 0.6 + o.petalLength, 0, 0)
  const [lLast, rLast] = rows[PETAL_SEGMENTS]
  triangle(b, lLast, rLast, tip)
}

/** The raised middle, as a low dome so it catches light separately from the petals. */
function addCentre(b: Build, o: Required<DaisyOptions>, color: Color, y: number) {
  const segments = 10
  /*
    Domed enough to be the highest point on the flower. At half the centre
    radius it sat level with the lifted petal tips and the head read as one
    flat disc, which loses the thing that makes a daisy legible at a distance.
  */
  const apex = vertex(b, 0, y + o.centreRadius * 1.15, 0, color)

  const ring: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    ring.push(vertex(b, Math.cos(a) * o.centreRadius, y, Math.sin(a) * o.centreRadius, color))
  }

  for (let i = 0; i < segments; i++) {
    triangle(b, apex, ring[i], ring[(i + 1) % segments])
  }
}

/** A thin tapered tube from the ground to the head. */
function addStem(b: Build, o: Required<DaisyOptions>, color: Color) {
  const bottom = o.petalWidth * 0.34
  const top = o.petalWidth * 0.2

  const rings: number[][] = []
  for (const [y, r] of [
    [0, bottom],
    [o.stemHeight, top],
  ] as const) {
    const ring: number[] = []
    for (let i = 0; i < STEM_SIDES; i++) {
      const a = (i / STEM_SIDES) * Math.PI * 2
      ring.push(vertex(b, Math.cos(a) * r, y, Math.sin(a) * r, color))
    }
    rings.push(ring)
  }

  for (let i = 0; i < STEM_SIDES; i++) {
    const j = (i + 1) % STEM_SIDES
    triangle(b, rings[0][i], rings[1][i], rings[0][j])
    triangle(b, rings[0][j], rings[1][i], rings[1][j])
  }
}

export function createDaisyGeometry(options: DaisyOptions = {}): BufferGeometry {
  const o = { ...DEFAULTS, ...options }

  const b: Build = { positions: [], colors: [], indices: [] }

  const petalColor = new Color(o.petalColor)
  const centreColor = new Color(o.centreColor)
  const stemColor = new Color(o.stemColor)

  addStem(b, o, stemColor)
  for (let i = 0; i < o.petals; i++) {
    addPetal(b, (i / o.petals) * Math.PI * 2, o, petalColor, o.stemHeight)
  }
  addCentre(b, o, centreColor, o.stemHeight)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3))
  geometry.setIndex(b.indices)
  /*
    Computed rather than authored. The petals are nearly flat and the stem is a
    tube, so there is nothing here whose shading benefits from hand-placed
    normals, and getting them wrong on generated geometry is a quiet way to make
    everything render black.
  */
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  return geometry
}

export const DAISY_DEFAULTS = DEFAULTS
