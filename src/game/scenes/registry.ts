import { lazy, type LazyExoticComponent, type ComponentType } from 'react'
import type { LightingVariant } from '@/art/Lighting'

/**
 * The scene registry.
 *
 * Scenes are lazily imported so each one becomes its own chunk. That is the
 * mechanism behind the main advantage of the portal architecture over a
 * continuous world: only the active scene is ever loaded, so a dense zone added
 * later cannot slow down the hub, and no level-of-detail or streaming system is
 * needed.
 */

export type SpawnId = string

export type SceneDefinition = {
  id: string
  title: string
  Component: LazyExoticComponent<ComponentType>
  lighting: LightingVariant
  /**
   * Named spawn points. A portal targets a scene plus a spawn id, which is what
   * places the player back at the door they came out of rather than at the origin.
   */
  spawns: Record<SpawnId, [number, number, number]>
  /** Sky colours, or null for scenes that are fully enclosed. */
  sky: { top: string; horizon: string } | null
}

export const SCENES: Record<string, SceneDefinition> = {
  hub: {
    id: 'hub',
    title: 'The Foundry',
    Component: lazy(() => import('../world/HubIsland').then((m) => ({ default: m.HubIsland }))),
    lighting: 'hub',
    spawns: {
      start: [0, 2, 8],
      /*
        Arriving back from the cave puts you on the platform in front of the
        portal, deliberately clear of its trigger radius. Spawning inside the
        radius would re-fire the portal the moment the player materialised.
        The useProximity first-frame guard also covers this, but keeping the
        spawn geometrically clear means the two mechanisms are not relied on
        to cancel each other out.
      */
      'from-cave': [9, 2, -3.2],
    },
    sky: { top: '#7fd4f5', horizon: '#ffe6c4' },
  },
  cave: {
    id: 'cave',
    title: 'The Prompt Cave',
    Component: lazy(() => import('../world/CaveScene').then((m) => ({ default: m.CaveScene }))),
    lighting: 'cave',
    spawns: {
      /*
        Deep enough into the room that the camera, which rests ~7.5 behind the
        player, still sits inside the walls at z=±12. Spawning at z=7 put the
        default camera position outside the room and left the collision raycast
        responsible for the opening shot, which is fragile framing.
      */
      entrance: [0, 2, 3],
    },
    sky: null,
  },
}

export function getScene(id: string): SceneDefinition {
  const scene = SCENES[id]
  // A missing scene means a bad save or a removed zone. Falling back to the hub
  // is strictly better than crashing a player out of a game with no accounts and
  // therefore no way for us to recover their state.
  return scene ?? SCENES.hub
}

export function getSpawn(sceneId: string, spawnId: string): [number, number, number] {
  const scene = getScene(sceneId)
  return scene.spawns[spawnId] ?? Object.values(scene.spawns)[0] ?? [0, 2, 0]
}
