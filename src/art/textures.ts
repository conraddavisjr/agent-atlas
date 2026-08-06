import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import {
  CanvasTexture,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'

/**
 * Surfacing for the world's rock and earth.
 *
 * The plateau is not here. Its surface is generated in groundTexture.ts,
 * because a photographic grass map gives the whole island the relief of gravel
 * and reads as wet rock the moment a highlight crosses it. Photographs earn
 * their place on the cliff face and the stonework, which are meant to look like
 * rock, and nowhere else.
 *
 * Each set ships three files: colour, a tangent-space normal map, and an ORM
 * pack with ambient occlusion in red and roughness in green. The pack is the
 * glTF convention and it is doing real work rather than saving a download:
 * three reads ambient occlusion from a texture's red channel and roughness from
 * its green, so one image fills two material slots and is uploaded once.
 *
 * Earlier versions derived the normal and roughness maps from the colour map
 * with a Sobel pass, because only one file could be afforded. Authored maps are
 * better in every way that matters here, so the derivation is gone. What
 * survives from it is the levelling below, which solves a different problem.
 */

export type PbrSetName = 'dirt' | 'stone'

type SetConfig = {
  /**
   * Where the albedo's mean value is moved to, out of 255, or null to use the
   * photograph as it is.
   *
   * Only stone needs this. A colour map multiplies the material colour, so a
   * dark photograph cannot tint, it can only dim: the rock averages around
   * RGB(79,76,69) and every stone surface came out near black no matter what
   * colour it was given. Levelling turns the photograph into what it is
   * actually wanted for on a palette-driven surface, which is grain.
   *
   * Dirt is left alone. The cliff face is meant to read as earth rather than as
   * a tint of something else, and it is already mid-value.
   */
  level: number | null
  /**
   * How much of the photograph's own contrast survives levelling.
   *
   * Has to leave headroom: the rock reaches about 70 above its own mean, so
   * levelling too high clips its entire bright half and the stone comes out
   * looking like flat plastic with dark speckles.
   */
  detail: number
}

const SETS: Record<PbrSetName, SetConfig> = {
  dirt: { level: null, detail: 1 },
  stone: { level: 188, detail: 0.8 },
}

/** Cached per image element, so the levelling pass runs once per document. */
const leveledCache = new WeakMap<HTMLImageElement, CanvasTexture>()

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * Re-centre an albedo on a target mean while keeping each channel's distance
 * from its own mean, so mottling and subtle warm and cool patches both survive
 * but the overall darkness does not.
 */
function levelAlbedo(image: HTMLImageElement, level: number, detail: number): CanvasTexture {
  const cached = leveledCache.get(image)
  if (cached) return cached

  const w = image.naturalWidth
  const h = image.naturalHeight

  const source = document.createElement('canvas')
  source.width = w
  source.height = h
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })!
  sourceCtx.drawImage(image, 0, 0)
  const src = sourceCtx.getImageData(0, 0, w, h)
  const data = src.data

  let sumR = 0
  let sumG = 0
  let sumB = 0
  const pixels = w * h
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i]
    sumG += data[i + 1]
    sumB += data[i + 2]
  }
  const meanR = sumR / pixels
  const meanG = sumG / pixels
  const meanB = sumB / pixels

  // Written back into the same buffer. There is no reason to allocate a second
  // megapixel of ImageData when nothing reads the original again.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(level + (data[i] - meanR) * detail)
    data[i + 1] = clamp255(level + (data[i + 1] - meanG) * detail)
    data[i + 2] = clamp255(level + (data[i + 2] - meanB) * detail)
  }

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.putImageData(src, 0, 0)

  const texture = new CanvasTexture(out)
  texture.colorSpace = SRGBColorSpace
  leveledCache.set(image, texture)
  return texture
}

export type PbrTextures = {
  map: Texture
  normalMap: Texture
  /** The ORM pack. three reads roughness from its green channel. */
  roughnessMap: Texture
  /** The same ORM pack. three reads occlusion from its red channel. */
  aoMap: Texture
}

/**
 * A tiled PBR set at a given density.
 *
 * `repeat` is in tiles across the mesh's UV space, so a large floor wants a
 * larger number than a doorframe does. Callers get their own clones, which
 * share the underlying image and cost only a texture descriptor.
 *
 * Suspends while the images load, so callers need a Suspense boundary above
 * them. Both scenes already sit inside one.
 */
export function usePbrTextures(
  name: PbrSetName,
  repeat: [number, number] = [1, 1],
): PbrTextures {
  const [color, normal, orm] = useTexture([
    `/textures/${name}-color.webp`,
    `/textures/${name}-normal.webp`,
    `/textures/${name}-orm.webp`,
  ])
  const gl = useThree((s) => s.gl)

  const [ru, rv] = repeat

  return useMemo(() => {
    const config = SETS[name]
    const base =
      config.level === null
        ? color
        : levelAlbedo(color.image as HTMLImageElement, config.level, config.detail)

    /*
      Anisotropy is the single biggest quality difference on ground. Without it
      a tiled surface viewed at a grazing angle dissolves into aliased mush a
      few metres out, which is most of what makes tiling obvious.
    */
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

    const prepare = (source: Texture, srgb: boolean) => {
      const t = source.clone()
      // clone() copies the descriptor but leaves needsUpdate false, so without
      // this the GPU never receives the new wrap and repeat settings.
      t.needsUpdate = true
      t.wrapS = RepeatWrapping
      t.wrapT = RepeatWrapping
      t.repeat.set(ru, rv)
      t.anisotropy = maxAnisotropy
      t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace
      /*
        Ambient occlusion defaults to the second UV set, which none of this
        geometry has. Pinning every map to channel 0 means the ORM pack lines up
        with the colour map instead of silently sampling nothing.
      */
      t.channel = 0
      return t
    }

    // Normal and ORM are data rather than colour. Tagging them sRGB would apply
    // a decode curve to vectors and gloss values, bending normals toward the
    // surface and making everything read shinier than authored.
    const packed = prepare(orm, false)

    return {
      map: prepare(base, true),
      normalMap: prepare(normal, false),
      roughnessMap: packed,
      aoMap: packed,
    }
  }, [color, normal, orm, gl, name, ru, rv])
}

/** Preload paths, so a scene's ground is not the last thing to arrive. */
export function pbrUrls(name: PbrSetName): string[] {
  return [
    `/textures/${name}-color.webp`,
    `/textures/${name}-normal.webp`,
    `/textures/${name}-orm.webp`,
  ]
}
