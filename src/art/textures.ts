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
 * The stone surfacing used for rock across the world.
 *
 * One image ships: an albedo photograph. The normal and roughness maps are
 * derived from it at load time rather than downloaded alongside it.
 *
 * That is a deliberate trade. Shipping the full PBR set would be three files
 * and roughly 800KB instead of one file and 291KB, and for stone the derivation
 * is genuinely good rather than a compromise: rock is lit by the same crevices
 * that darken it, so albedo luminance tracks height closely enough that a Sobel
 * gradient produces a convincing normal. That correlation is what makes this
 * work here and what would make it fail on, say, painted metal, where the
 * pattern in the albedo has nothing to do with the surface relief.
 *
 * The derivation runs once per document, not once per material. It is a
 * megapixel of canvas work, which is fine on a cold load and absurd per mesh.
 */

const ALBEDO_URL = '/textures/stone-albedo.webp'

/** Tuning for the derived maps. Small numbers here, large visual consequences. */
const DERIVE = {
  /**
   * Sobel gain, applied after the gradient is normalised to [-1, 1].
   *
   * Higher reads as deeper relief, but pushes the normals toward horizontal,
   * which both darkens the surface and makes it shimmer under a moving camera.
   * Past about 3 the stone starts going black in shadow.
   */
  normalStrength: 2.2,
  /** Roughness floor and ceiling. Stone is never mirror-smooth nor fully matte. */
  roughnessMin: 0.55,
  roughnessMax: 0.95,

  /**
   * Where the levelled albedo's mean value lands, out of 255.
   *
   * The source photograph is a dark basalt averaging about RGB(79,76,69). Used
   * as-is it is not a tint, it is a dimmer: a colour map multiplies the
   * material colour, so a dark photograph can only ever darken, and every
   * stone surface came out near black no matter what colour it was given.
   *
   * Levelling to a high mean turns the photograph into what it is actually
   * wanted for here, which is grain. Value comes from the palette, variation
   * comes from the photo.
   *
   * Has to leave headroom above it, which is the trap: the source runs from 37
   * to 148 around a mean of 79, so it reaches about 70 above its own mean.
   * Levelled to 236 the entire bright half of the rock clips at 255 and the
   * stone comes out looking like flat plastic with a few dark speckles. Sitting
   * the mean near 195 keeps both tails inside the range.
   */
  albedoLevel: 195,

  /**
   * How much of the photograph's own contrast survives levelling.
   *
   * At 0 the albedo is flat and the stone is plastic again. At 1 the full
   * dynamic range of a rock shot in hard light comes through, which is far too
   * much next to flat-shaded neighbours.
   */
  albedoDetail: 0.75,
} as const

type DerivedMaps = { albedo: Texture; normalMap: Texture; roughnessMap: Texture }

/**
 * Cached per image element rather than globally, so a second stone texture
 * added later derives its own maps instead of silently reusing these.
 */
const derivedCache = new WeakMap<HTMLImageElement, DerivedMaps>()

function luminance(data: Uint8ClampedArray, i: number) {
  // Rec. 601 luma. The exact coefficients matter less than being consistent,
  // but using a proper luma rather than a channel average keeps red-brown rock
  // from reading as uniformly flat.
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

/**
 * Build a tangent-space normal map and a roughness map from an albedo image.
 *
 * Both come out of a single pass over the pixels because the expensive part is
 * the read, not the arithmetic.
 */
function deriveMaps(image: HTMLImageElement): DerivedMaps {
  const cached = derivedCache.get(image)
  if (cached) return cached

  const w = image.naturalWidth
  const h = image.naturalHeight

  const source = document.createElement('canvas')
  source.width = w
  source.height = h
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })!
  sourceCtx.drawImage(image, 0, 0)
  const src = sourceCtx.getImageData(0, 0, w, h).data

  /*
    Per-channel means, so levelling below preserves the rock's own colour
    variation instead of flattening it to grey. Cheap: one pass, and it only
    ever runs once per image for the life of the document.
  */
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const pixels = w * h
  for (let i = 0; i < src.length; i += 4) {
    sumR += src[i]
    sumG += src[i + 1]
    sumB += src[i + 2]
  }
  const meanR = sumR / pixels
  const meanG = sumG / pixels
  const meanB = sumB / pixels

  const albedoCanvas = document.createElement('canvas')
  albedoCanvas.width = w
  albedoCanvas.height = h
  const albedoCtx = albedoCanvas.getContext('2d')!
  const albedo = albedoCtx.createImageData(w, h)

  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = w
  normalCanvas.height = h
  const normalCtx = normalCanvas.getContext('2d')!
  const normal = normalCtx.createImageData(w, h)

  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = w
  roughCanvas.height = h
  const roughCtx = roughCanvas.getContext('2d')!
  const rough = roughCtx.createImageData(w, h)

  // Wrap rather than clamp at the edges. The texture tiles, so clamping would
  // put a seam of flat normals along every tile boundary, which is exactly
  // where a repeating texture is most likely to be noticed.
  const at = (x: number, y: number) => {
    const wx = ((x % w) + w) % w
    const wy = ((y % h) + h) % h
    return luminance(src, (wy * w + wx) * 4)
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4

      // Sobel gradients. The 3x3 kernel is unrolled rather than looped; this
      // runs a million times and the loop overhead is not free.
      const tl = at(x - 1, y - 1)
      const tc = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const ml = at(x - 1, y)
      const mr = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const bc = at(x, y + 1)
      const br = at(x + 1, y + 1)

      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br)
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br)

      /*
        Normalise by the kernel's own maximum, not by 255.

        A Sobel kernel has weights summing to 4 on each side, so with 0..255
        input its output spans +/-1020. Dividing by 255 instead leaves gradients
        up to 4 before the strength gain is even applied, which tips the
        surface normal almost flat against the surface and drops the diffuse
        term to nearly nothing. That is what "textured stone renders black"
        looks like, and it is not obvious from the map itself: viewed as an
        image the normal map still looks broadly correct.
      */
      const nx = (gx / (4 * 255)) * DERIVE.normalStrength
      const ny = (gy / (4 * 255)) * DERIVE.normalStrength
      const len = Math.hypot(nx, ny, 1)

      // Encode to the usual 0..1 range stored in 0..255.
      normal.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      normal.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      normal.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      normal.data[i + 3] = 255

      /*
        Levelled albedo. Each channel is re-centred on albedoLevel while keeping
        its distance from its own mean, so the stone's mottling and its subtle
        warm and cool patches both survive, but its overall darkness does not.
      */
      albedo.data[i] = clamp255(
        DERIVE.albedoLevel + (src[i] - meanR) * DERIVE.albedoDetail,
      )
      albedo.data[i + 1] = clamp255(
        DERIVE.albedoLevel + (src[i + 1] - meanG) * DERIVE.albedoDetail,
      )
      albedo.data[i + 2] = clamp255(
        DERIVE.albedoLevel + (src[i + 2] - meanB) * DERIVE.albedoDetail,
      )
      albedo.data[i + 3] = 255

      // Roughness from inverted luminance: the dark recesses of stone are the
      // parts that hold grit and scatter light, the raised faces are the parts
      // rain and boots have polished.
      const lum = at(x, y) / 255
      const r =
        (DERIVE.roughnessMax - (DERIVE.roughnessMax - DERIVE.roughnessMin) * lum) * 255
      rough.data[i] = r
      rough.data[i + 1] = r
      rough.data[i + 2] = r
      rough.data[i + 3] = 255
    }
  }

  albedoCtx.putImageData(albedo, 0, 0)
  normalCtx.putImageData(normal, 0, 0)
  roughCtx.putImageData(rough, 0, 0)

  const albedoTex = new CanvasTexture(albedoCanvas)
  const normalMap = new CanvasTexture(normalCanvas)
  const roughnessMap = new CanvasTexture(roughCanvas)

  albedoTex.colorSpace = SRGBColorSpace

  // Both are data, not colour. Tagging them sRGB would have three.js apply a
  // decode curve to vectors and gloss values, which bends normals toward the
  // surface and makes everything read shinier than authored.
  normalMap.colorSpace = LinearSRGBColorSpace
  roughnessMap.colorSpace = LinearSRGBColorSpace

  const maps = { albedo: albedoTex, normalMap, roughnessMap }
  derivedCache.set(image, maps)
  return maps
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

export type StoneTextures = {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
}

/**
 * Stone maps at a given tiling density.
 *
 * `repeat` is in tiles across the mesh's UV space, so a large floor wants a
 * larger number than a doorframe does. Every caller gets its own clones, which
 * share the underlying image and cost only a texture descriptor.
 *
 * Suspends while the albedo loads, so callers need a <Suspense> boundary above
 * them. Both scenes already sit inside one.
 */
export function useStoneTextures(repeat: [number, number] = [1, 1]): StoneTextures {
  const albedo = useTexture(ALBEDO_URL)
  const gl = useThree((s) => s.gl)

  const [ru, rv] = repeat

  return useMemo(() => {
    // The raw photograph is only ever the input to the derivation. What the
    // material samples is the levelled version, for the reasons in DERIVE.
    const derived = deriveMaps(albedo.image as HTMLImageElement)

    // Anisotropy is the single biggest quality difference on the portal
    // platform, which is a floor seen at a grazing angle. Without it the tiling
    // dissolves into aliased mush a few metres out; with it the stone stays
    // legible to the horizon.
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
      return t
    }

    return {
      map: prepare(derived.albedo, true),
      normalMap: prepare(derived.normalMap, false),
      roughnessMap: prepare(derived.roughnessMap, false),
    }
  }, [albedo, gl, ru, rv])
}
