import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { taperedSuperellipsoid } from '@/game/player/robotGeometry'
import {
  EYE,
  FACE_PLATE,
  INSTRUCTOR_HEAD,
  MOUSTACHE,
  eyeCentre,
  facePlateZ,
  insideHead,
  insidePlate,
  moustacheHalf,
} from './instructorFace'

/*
  THE FACE.

  Every assertion here is a measurement on BUILT geometry against the BUILT solid
  it sits on. That is not ceremony - it is the only kind of check that would have
  caught what shipped, which was two eye lenses entirely inside the face plate and
  a moustache mostly inside it, on every frame, from the day it was written.

  The numbers that made that possible were literals in a `.tsx`, where no test can
  reach them. They are in `instructorFace.ts` now, and solved rather than authored
  wherever a clearance is at stake.
*/

type Positioned = {
  getAttribute(name: string): {
    count: number
    getX(i: number): number
    getY(i: number): number
    getZ(i: number): number
  }
}

/** Every vertex of a geometry, offset to head-local space. */
function vertices(geometry: Positioned, offset: readonly [number, number, number]): [number, number, number][] {
  const pos = geometry.getAttribute('position')
  const out: [number, number, number][] = []
  for (let i = 0; i < pos.count; i++) {
    out.push([pos.getX(i) + offset[0], pos.getY(i) + offset[1], pos.getZ(i) + offset[2]])
  }
  return out
}

/**
 * Every vertex of a geometry under a full transform.
 *
 * The moustache is rolled and wrapped as well as offset, and the first version of
 * this file measured the un-rotated torus - which is to say it measured an object
 * that is not in the scene. `moustacheHalf` publishes the transform so this
 * composes the same matrix the component ships.
 */
function transformed(geometry: Positioned, side: -1 | 1): [number, number, number][] {
  const { position, rotation, scale } = moustacheHalf(side)
  const matrix = new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(...scale),
  )
  const pos = geometry.getAttribute('position')
  const out: [number, number, number][] = []
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix)
    out.push([v.x, v.y, v.z])
  }
  return out
}

describe('the eyes are on the face, not in it', () => {
  const eye = () => new SphereGeometry(EYE.radius, 14, 12)

  it('stands proud of the face plate', () => {
    /*
      **THE REGRESSION TEST.**

      The version this replaces put the lens centres 0.1665 from a 0.245 visor
      sphere with a radius of 0.045: `0.1665 + 0.045 = 0.2115 < 0.245`, so the
      whole lens was enclosed. Nothing failed, nothing logged, and the instructor
      simply had no eyes.

      Measured per vertex against the plate's own field, both sides, so an eye
      that sinks fails and so does one that has floated off the plate entirely -
      because the back of the lens has to stay in.
    */
    for (const side of [-1, 1] as const) {
      const points = vertices(eye(), eyeCentre(side))
      const outside = points.filter(([x, y, z]) => !insidePlate(x, y, z)).length
      const inside = points.length - outside

      expect(outside, `eye ${side} is buried in the plate`).toBeGreaterThan(0)
      expect(inside, `eye ${side} has floated off the plate`).toBeGreaterThan(0)
    }
  })

  it('shows most of itself, not a sliver', () => {
    /*
      Proud is not enough on its own - a lens with three vertices outside passes
      the test above and reads as a scratch. `embed` is a fifth of the diameter,
      so comfortably more than half the sphere should be clear of the plate.
    */
    const points = vertices(eye(), eyeCentre(1))
    const outside = points.filter(([x, y, z]) => !insidePlate(x, y, z)).length
    expect(outside / points.length).toBeGreaterThan(0.5)
  })

  it('sits inside the plate\'s own outline rather than off its edge', () => {
    // An eye hanging off the side of the plate reads as a bolt on the head.
    expect(EYE.x + EYE.radius).toBeLessThan(FACE_PLATE.a)
    expect(Math.abs(EYE.y) + EYE.radius).toBeLessThan(FACE_PLATE.b)
  })

  it('is a pair, symmetric about the centreline', () => {
    const [lx, ly, lz] = eyeCentre(-1)
    const [rx, ry, rz] = eyeCentre(1)
    expect(lx).toBeCloseTo(-rx, 12)
    expect(ly).toBeCloseTo(ry, 12)
    expect(lz).toBeCloseTo(rz, 12)
    expect(rx).toBeGreaterThan(0)
  })
})

describe('the face plate', () => {
  it('is a PANEL, not a second head', () => {
    /*
      The shape difference that makes the whole layout work. A 0.245 sphere on a
      0.34 head is three quarters of it, which leaves nowhere to mount anything;
      a plate is shallow, so things sit on it.
    */
    expect(FACE_PLATE.c).toBeLessThan(INSTRUCTOR_HEAD.c * 0.25)
    expect(FACE_PLATE.a).toBeGreaterThan(FACE_PLATE.c * 3)
  })

  it('is sunk into the head rather than floating off it', () => {
    /*
      Its own centre has to be inside the head - a plate resting exactly on the
      surface shows a seam all the way round, and one standing off it reads as a
      screen the character is holding up.
    */
    expect(insideHead(0, FACE_PLATE.y, facePlateZ())).toBe(true)
  })

  it('shows its FRONT, not just its corners', () => {
    /*
      **The assertion the first version needed and did not have.**

      `sink` was 0.075 against a half-depth of 0.05, so the plate's front face sat
      0.025 behind the head's surface - the entire panel was inside the head and
      the instructor's face was two eyes floating on bare plastic.

      A vertex-count check passed that, because a 0.19-wide plate on a curving
      head still pokes out at its edges. The point that was actually wrong is the
      front POLE, dead centre, which is the part of a face plate you look at.
    */
    expect(FACE_PLATE.sink, 'the plate is sunk deeper than it is thick').toBeLessThan(FACE_PLATE.c)
    expect(insideHead(0, FACE_PLATE.y, facePlateZ() + FACE_PLATE.c)).toBe(false)
  })

  it('still breaks the head\'s surface over most of its face', () => {
    // Sunk too far and the plate is a hole rather than a feature. Measured as a
    // FRACTION now, so a plate showing only its rim cannot pass.
    const points = vertices(taperedSuperellipsoid(FACE_PLATE), [0, FACE_PLATE.y, facePlateZ()])
    const outside = points.filter(([x, y, z]) => !insideHead(x, y, z)).length
    expect(outside / points.length, 'the plate is mostly inside the head').toBeGreaterThan(0.25)
  })

  it('leaves the lower face clear for the moustache', () => {
    /*
      The layout decision, as an assertion. The plate takes the upper half and the
      moustache the lower; a plate that reached down over the whole face is why
      the first version had nowhere to put one.
    */
    const plateBottom = FACE_PLATE.y - FACE_PLATE.b
    expect(MOUSTACHE.y + MOUSTACHE.tube).toBeLessThan(plateBottom)
  })
})

describe('the moustache', () => {
  const whisker = () =>
    new TorusGeometry(
      MOUSTACHE.radius,
      MOUSTACHE.tube,
      MOUSTACHE.radialSegments,
      MOUSTACHE.tubularSegments,
      MOUSTACHE.arc,
    )

  it('is LARGE, which is the only note the brief gave about this face', () => {
    /*
      "A large moustache." The one it replaces was a 0.15 sweep mostly inside a
      visor. This is measured against the head's own width so it stays large if
      the head is ever resized.
    */
    const span = (MOUSTACHE.x + MOUSTACHE.radius) * 2
    expect(span / (INSTRUCTOR_HEAD.a * 2)).toBeGreaterThan(0.85)
  })

  it('curls back on itself rather than being a smile', () => {
    // Past half a circle is what makes it a handlebar. A 0.85-pi arc, which is
    // what shipped, is an arc under a nose.
    expect(MOUSTACHE.arc).toBeGreaterThan(Math.PI)
  })

  it('stands proud of the head at its own anchor', () => {
    /*
      Solved rather than authored: `moustacheZ` asks the head where its surface is
      at the moustache's own x and y, because the head curves away and authoring
      against the equator is how a part ends up floating at the centre and buried
      at the edges.
    */
    expect(MOUSTACHE.proud).toBeGreaterThan(0)
    const anchor = moustacheHalf(1).position
    expect(insideHead(anchor[0], anchor[1], anchor[2])).toBe(false)
  })

  it('lies ON the face rather than sunk into it', () => {
    /*
      Measured under the SHIPPED transform, roll and wrap included. The first
      version of this test offset the torus and nothing else, which measured a
      flat disc that is not in the scene - and a flat disc on a curved head cannot
      pass this at any depth, which is what sent the wrap into the design.
    */
    for (const side of [-1, 1] as const) {
      const points = transformed(whisker(), side)
      const outside = points.filter(([x, y, z]) => !insideHead(x, y, z)).length
      expect(outside / points.length, `half ${side} is sunk into the head`).toBeGreaterThan(0.8)
    }
  })

  it('still touches the head, so it is worn rather than floating', () => {
    // The other side of the same clearance. A moustache entirely clear of the
    // face is a prop on a stick.
    const points = transformed(whisker(), 1)
    const inside = points.filter(([x, y, z]) => insideHead(x, y, z)).length
    expect(inside, 'the moustache floats off the face').toBeGreaterThan(0)
  })

  it('does not collide with the face plate', () => {
    // They are the two features of this face and they have to be separate ones.
    for (const side of [-1, 1] as const) {
      const points = transformed(whisker(), side)
      const clashes = points.filter(([x, y, z]) => insidePlate(x, y, z)).length
      expect(clashes, `half ${side} runs through the face plate`).toBe(0)
    }
  })

  it('curls UPWARD, which is the difference between playful and sad', () => {
    /*
      The roll, measured rather than asserted as a number. A sign error in it is
      invisible in the constant and unmistakable on the face - the first draft had
      one, at +0.58 pi, and the moustache hung down like a walrus.

      The tip is the LAST ring of the torus, not the widest vertex.
      `TorusGeometry` emits its rings in order along the arc, so the final
      `radialSegments + 1` vertices are the cut face at the free end. The widest
      vertex, which is what this test first looked at, is the middle of the sweep
      and sits at the anchor's own height whichever way the thing is rolled.
    */
    for (const side of [-1, 1] as const) {
      const points = transformed(whisker(), side)
      const ring = points.slice(-(MOUSTACHE.radialSegments + 1))
      const tipY = ring.reduce((sum, p) => sum + p[1], 0) / ring.length
      expect(tipY, `half ${side} droops`).toBeGreaterThan(moustacheHalf(side).position[1])
    }
  })

  it('sweeps outward from the nose rather than inward', () => {
    // The other half of the same shape: the free end has to finish further from
    // the centreline than it started, or the two halves cross under the face.
    for (const side of [-1, 1] as const) {
      const points = transformed(whisker(), side)
      const ring = points.slice(-(MOUSTACHE.radialSegments + 1))
      const tipX = ring.reduce((sum, p) => sum + p[0], 0) / ring.length
      expect(Math.abs(tipX), `half ${side} curls inward`).toBeGreaterThan(MOUSTACHE.x)
    }
  })
})
