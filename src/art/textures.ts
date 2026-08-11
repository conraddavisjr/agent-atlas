import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import { createMouldedStoneMaps } from './groundTexture'

/**
 * Surfacing for the world's rock.
 *
 * **There are no photographs left in this project, and that is the point.**
 *
 * The reference brief's deepest rule is that everything in this world is a
 * manufactured object: stone is a moulded stone-shaped object, and a photograph
 * of real rock is the clearest violation of it available. The brief names the
 * ambientCG rock as the least Astro-like thing in the project by name.
 *
 * The stone set went first, and the dirt went with it in the same pass. The
 * dirt survived one round on the argument that it appeared only on the island's
 * underside - never approached, never walked on, in the background band where
 * the brief permits less material discipline. That argument was made about
 * geometry that turned out to be invisible from every camera in the game. Once
 * the island's skirt was rebuilt to overhang and actually show, its lip became
 * the island's silhouette in every wide shot, and a photographic normal map
 * along that edge would have recreated the portal arch's defect on a hundred
 * times the perimeter.
 *
 * So both sets are gone, along with the albedo levelling that existed only to
 * stop the rock photograph rendering near black, and the six WebPs. What is
 * left is a generated moulded stone and the half dozen tiling decisions any
 * tiled map needs, each of which has a silent failure mode - which is why they
 * live in one function rather than being repeated at every call site.
 *
 * The plateau is not here either. Its surface is generated in
 * `groundTexture.ts`, because a photographic grass map gives the whole island
 * the relief of gravel and reads as wet rock the moment a highlight crosses it.
 */

export type PbrTextures = {
  map: Texture
  normalMap: Texture
  /** The ORM pack. three reads roughness from its green channel. */
  roughnessMap: Texture
  /** The same ORM pack. three reads occlusion from its red channel. */
  aoMap: Texture
}

/**
 * A tiled, filtered clone of a source texture.
 *
 * Every decision in here has a failure mode that is silent, which is why this
 * is a function rather than six lines repeated at each call site.
 */
function tiled(
  source: Texture,
  repeat: [number, number],
  anisotropy: number,
  srgb: boolean,
): Texture {
  const t = source.clone()
  // clone() copies the descriptor but leaves needsUpdate false, so without
  // this the GPU never receives the new wrap and repeat settings.
  t.needsUpdate = true
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  /*
    Anisotropy is the single biggest quality difference on ground. Without it a
    tiled surface viewed at a grazing angle dissolves into aliased mush a few
    metres out, which is most of what makes tiling obvious.
  */
  t.anisotropy = anisotropy
  // Normal and ORM are data rather than colour. Tagging them sRGB applies a
  // decode curve to vectors and gloss values, bending normals toward the
  // surface and making everything read shinier than authored.
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace
  /*
    Ambient occlusion defaults to the second UV set, which none of this geometry
    has. Pinning every map to channel 0 means the ORM pack lines up with the
    colour map instead of silently sampling nothing.
  */
  t.channel = 0
  return t
}

/**
 * The generated moulded stone, tiled for one caller.
 *
 * `repeat` is in tiles across the mesh's UV space against an authoring target
 * of one stone tile every 1.2 m of world, solved per mesh rather than shared as
 * a repeat count. Matching repeat counts instead of physical scale is what
 * makes tiled stone read as wallpaper, and that note is kept from
 * `HubIsland.tsx`, which arrived at it from the other direction.
 *
 * Generation is memoized at module scope inside `createMouldedStoneMaps`, so
 * the first caller pays for the canvases and every later one pays for four
 * texture descriptors.
 */
export function useMouldedStone(repeat: [number, number] = [1, 1]): PbrTextures {
  const gl = useThree((s) => s.gl)
  const [ru, rv] = repeat

  return useMemo(() => {
    const maps = createMouldedStoneMaps()
    const anisotropy = gl.capabilities.getMaxAnisotropy()
    const packed = tiled(maps.roughnessMap, [ru, rv], anisotropy, false)
    return {
      map: tiled(maps.map, [ru, rv], anisotropy, true),
      normalMap: tiled(maps.normalMap, [ru, rv], anisotropy, false),
      roughnessMap: packed,
      aoMap: packed,
    }
  }, [gl, ru, rv])
}
