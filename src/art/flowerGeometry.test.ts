import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createDaisyGeometry, DAISY_DEFAULTS } from './flowerGeometry'

/**
 * These exist because generated geometry fails quietly.
 *
 * The last two bugs in this project's generated art were a blade of grass wider
 * than it was tall and a normal map that rendered every stone surface black.
 * Neither threw, neither showed up in a type, and both cost a round trip
 * through the browser to find. Dimensions and colours are checkable here.
 */

function positions(geometry: ReturnType<typeof createDaisyGeometry>) {
  return geometry.getAttribute('position')
}

describe('daisy geometry', () => {
  const geometry = createDaisyGeometry()

  it('has matching position, normal and colour attributes', () => {
    const count = positions(geometry).count
    expect(count).toBeGreaterThan(0)
    expect(geometry.getAttribute('normal').count).toBe(count)
    expect(geometry.getAttribute('color').count).toBe(count)
  })

  it('indexes only vertices that exist', () => {
    // An out-of-range index is undefined behaviour in WebGL rather than an
    // error, so it shows up as stray triangles across the screen.
    const count = positions(geometry).count
    const index = geometry.getIndex()!
    for (let i = 0; i < index.count; i++) {
      expect(index.getX(i)).toBeGreaterThanOrEqual(0)
      expect(index.getX(i)).toBeLessThan(count)
    }
    // Whole triangles only.
    expect(index.count % 3).toBe(0)
  })

  it('stands on the ground and reaches its stated height', () => {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 5)
    // The head sits on top of the stem, so the flower is a little taller again.
    expect(box.max.y).toBeGreaterThan(DAISY_DEFAULTS.stemHeight)
    expect(box.max.y).toBeLessThan(DAISY_DEFAULTS.stemHeight * 1.4)
  })

  it('is taller than it is wide, the way a flower on a stem is', () => {
    // The check that would have caught the grass blade coming out wider than
    // it was tall.
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    expect(box.max.y).toBeGreaterThan(width)
  })

  it('spreads its head to roughly the petal reach', () => {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const reach = DAISY_DEFAULTS.centreRadius * 0.6 + DAISY_DEFAULTS.petalLength
    expect(box.max.x).toBeCloseTo(reach, 1)
    // Radially symmetric, so the head is centred on the stem rather than
    // hanging off one side.
    expect(box.max.x).toBeCloseTo(-box.min.x, 1)
    expect(box.max.z).toBeCloseTo(-box.min.z, 1)
  })

  it('carries three distinct colours in one buffer', () => {
    // Stem, petal and centre. This is the whole reason the flower is generated
    // rather than assembled from three meshes.
    const color = geometry.getAttribute('color')
    const seen = new Set<string>()
    for (let i = 0; i < color.count; i++) {
      seen.add(
        `${color.getX(i).toFixed(3)},${color.getY(i).toFixed(3)},${color.getZ(i).toFixed(3)}`,
      )
    }
    expect(seen.size).toBe(3)
  })

  it('puts the requested colours where they belong', () => {
    const custom = createDaisyGeometry({
      petalColor: '#ff0000',
      centreColor: '#00ff00',
      stemColor: '#0000ff',
    })
    const pos = positions(custom)
    const color = custom.getAttribute('color')

    const expected = {
      petal: new Color('#ff0000'),
      centre: new Color('#00ff00'),
      stem: new Color('#0000ff'),
    }

    let stemBelowHead = 0
    let highest = -Infinity
    let highestColor = ''

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const c = new Color(color.getX(i), color.getY(i), color.getZ(i))

      // Anything well below the head must be stem.
      if (y < DAISY_DEFAULTS.stemHeight * 0.5) {
        expect(c.getHexString()).toBe(expected.stem.getHexString())
        stemBelowHead++
      }
      if (y > highest) {
        highest = y
        highestColor = c.getHexString()
      }
    }

    expect(stemBelowHead).toBeGreaterThan(0)
    // The dome has to be the highest point, or the head reads as a flat disc
    // and the daisy stops being legible from any distance.
    expect(highestColor).toBe(expected.centre.getHexString())
  })

  it('scales its petal count', () => {
    const few = createDaisyGeometry({ petals: 5 })
    const many = createDaisyGeometry({ petals: 12 })
    expect(positions(many).count).toBeGreaterThan(positions(few).count)
  })

  it('produces normals that are unit length and mostly upward', () => {
    // A head lit from above should face up. Degenerate normals are the failure
    // that renders generated geometry black.
    const normal = geometry.getAttribute('normal')
    let upward = 0
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      expect(length).toBeCloseTo(1, 3)
      if (normal.getY(i) > 0.3) upward++
    }
    expect(upward).toBeGreaterThan(normal.count * 0.3)
  })
})
