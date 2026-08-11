import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, LinearFilter, LinearSRGBColorSpace, Texture } from 'three'
import { packLightmapAtlas, propPartVertexCounts, mergeProp, chamferedBox } from './geometry'
import {
  HUB_LIGHTMAP_INTENSITY,
  LIGHTMAP_MANIFEST,
  assertLightmapBound,
  configureLightmap,
  lightmapStaleness,
} from './lightmap'

/** A small merged batch, enough to pack a real atlas from. */
function batch() {
  const parts = [
    { geometry: chamferedBox({ width: 2, height: 1, depth: 2, bevel: 0.1 }), position: [0, 0, 0] as [number, number, number] },
  ]
  const counts = propPartVertexCounts(parts)
  return [{ geometry: mergeProp(parts), partVertexCounts: counts }]
}

describe('configureLightmap', () => {
  /*
    Every assertion here is a silent failure if the setting is wrong, which is why
    they are pinned individually rather than as one snapshot. A snapshot would be
    updated by whoever broke one.
  */
  it('binds to UV set 1, which is the only channel three reaches uv1 from', () => {
    expect(configureLightmap(new Texture()).channel).toBe(1)
  })

  it('treats the map as data, not colour', () => {
    // An sRGB decode would bend a linear 0.5 to 0.21 and roughly double the apparent
    // strength of every gradient in the bake.
    expect(configureLightmap(new Texture()).colorSpace).toBe(LinearSRGBColorSpace)
  })

  it('turns mipmaps off, because the 2-texel gutter cannot survive them', () => {
    const texture = configureLightmap(new Texture())
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.minFilter).toBe(LinearFilter)
    expect(texture.magFilter).toBe(LinearFilter)
  })

  it('leaves flipY alone, because applyLightmapUV is what knows about the flip', () => {
    expect(configureLightmap(new Texture()).flipY).toBe(true)
  })

  it('marks the texture for upload, or none of the above reaches the GPU', () => {
    // Asserted through `version`, because three declares `needsUpdate` as a setter
    // with no getter: reading it back returns undefined and a test that asserted on
    // the read would fail while the code was right.
    expect(configureLightmap(new Texture()).version).toBe(1)
    expect(new Texture().version).toBe(0)
  })
})

describe('assertLightmapBound', () => {
  function withUv1(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('uv1', new BufferAttribute(new Float32Array(6), 2))
    return geometry
  }

  it('passes a geometry with uv1 and a texture on channel 1', () => {
    expect(() => assertLightmapBound(withUv1(), configureLightmap(new Texture()), 'x')).not.toThrow()
  })

  /*
    The failure this exists for. A material whose aoMap sits on channel 1 compiles to
    `#define AOMAP_UV uv1`; a geometry with no `uv1` does not error, WebGL supplies a
    zero attribute, every fragment reads texel (0, 0), and the surface gets one
    uniform multiply. Clean frame, right triangle count, slightly wrong colour.
  */
  it('catches a geometry with no uv1', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    expect(() => assertLightmapBound(geometry, configureLightmap(new Texture()), 'the deck')).toThrow(
      /no uv1 attribute/,
    )
  })

  it('catches a texture left on channel 0', () => {
    expect(() => assertLightmapBound(withUv1(), new Texture(), 'the deck')).toThrow(/channel 0/)
  })

  it('is a no-op before the image has loaded', () => {
    expect(() => assertLightmapBound(new BufferGeometry(), null, 'the deck')).not.toThrow()
  })
})

describe('lightmapStaleness', () => {
  it('names the atlas mismatch when the options differ from the bake', () => {
    const atlas = packLightmapAtlas(batch(), {
      size: LIGHTMAP_MANIFEST.size,
      texelsPerMetre: LIGHTMAP_MANIFEST.texelsPerMetre + 1,
      gutter: LIGHTMAP_MANIFEST.gutter,
    })
    expect(lightmapStaleness(atlas)).toMatch(/baked at/)
    expect(lightmapStaleness(atlas)).toMatch(/bake:lightmap/)
  })

  it('reports a hash mismatch for the right geometry at the right size', () => {
    const atlas = packLightmapAtlas(batch(), {
      size: LIGHTMAP_MANIFEST.size,
      texelsPerMetre: LIGHTMAP_MANIFEST.texelsPerMetre,
      gutter: LIGHTMAP_MANIFEST.gutter,
    })
    const message = lightmapStaleness(atlas)
    expect(message).toMatch(/STALE/)
    // It has to say what the consequence is, not just that something differs. A
    // warning that reads "hash mismatch" gets ignored; one that says every shadow is
    // in the old layout's place does not.
    expect(message).toMatch(/OLD layout/)
  })
})

describe('the manifest', () => {
  it('describes a bake that was actually run', () => {
    expect(LIGHTMAP_MANIFEST.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(LIGHTMAP_MANIFEST.charts).toBeGreaterThan(0)
    expect(LIGHTMAP_MANIFEST.triangles).toBeGreaterThan(1000)
    expect(LIGHTMAP_MANIFEST.surfaceAreaSquareMetres).toBeGreaterThan(100)
    expect(Number.isFinite(Date.parse(LIGHTMAP_MANIFEST.generated))).toBe(true)
  })

  /*
    The resolution claim, asserted so that a future change to `HUB_LIGHTMAP_ATLAS`
    has to move this number and therefore has to notice the memory cost. 4 bytes a
    texel because three uploads an `Image` as RGBA whatever the PNG holds.
  */
  it('costs the VRAM the comments say it does', () => {
    const megabytes = (LIGHTMAP_MANIFEST.size * LIGHTMAP_MANIFEST.size * 4) / 1024 / 1024
    expect(megabytes).toBeCloseTo(16, 5)
    expect(100 / LIGHTMAP_MANIFEST.texelsPerMetre).toBeCloseTo(2.27, 2)
  })
})

describe('HUB_LIGHTMAP_INTENSITY', () => {
  /*
    Full strength, and the band arithmetic in `lightmap.ts` is what licenses it: the
    deepest value this map can reach on a walkable surface is 0.583 of display luma
    against a gameplay-band floor of 0.56, so there is no headroom being spent.
    Pinned as a test because "turn the AO down a bit" is the reflex fix for a problem
    that would not be this map's fault.
  */
  it('is full strength', () => {
    expect(HUB_LIGHTMAP_INTENSITY).toBe(1)
  })
})
