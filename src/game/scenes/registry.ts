import { lazy, type LazyExoticComponent, type ComponentType } from 'react'
import type { LightingVariant } from '@/art/Lighting'
import { palette } from '@/art/palette'

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
  /**
   * Fall below this height and the scene kills you.
   *
   * Required rather than optional so that adding a scene forces the question to
   * be answered. An optional field would default to "no kill plane", which is
   * the failure mode where a player falls off a new zone forever and the only
   * way out is to reload.
   */
  killY: number
}

export const SCENES: Record<string, SceneDefinition> = {
  hub: {
    id: 'hub',
    title: 'The Foundry',
    Component: lazy(() => import('../world/HubIsland').then((m) => ({ default: m.HubIsland }))),
    lighting: 'hub',
    spawns: {
      /*
        On the lawn at the south, facing the Core. Radius 11 from the origin,
        comfortably inside the plateau's 16 and clear of Puck A's 6, so the
        opening shot looks up the whole ziggurat: lawn, then the Core, then the
        deck stack, then the portal.
      */
      start: [0, 2, 11],
      /*
        Arriving back from the cave puts you on T3, the portal deck, and
        deliberately clear of the portal's trigger radius. Spawning inside it
        would re-fire the portal the moment the player materialised. The
        useProximity first-frame guard also covers this, but keeping the spawn
        geometrically clear means the two mechanisms are not relied on to
        cancel each other out.

        The old value of (9, 2, -3.2) was written against the portal's previous
        home on a platform at x=9. Under the Foundry layout it drops the player
        onto the east jump route, four metres in the air and nowhere near the
        gate they just came through.

        Two clearances, both checked rather than assumed. Against
        INTERACTION.exitRadius of 3.1: the portal anchor is (0, 2.80, -14.5)
        and after the 1.6 revival drop the feet rest at y 2.80, so the
        separation is hypot(3.0, 0, 1.5) = 3.35, clear by 0.25. And against
        T3's kerb: the player centre at x 3.0 plus the 0.35 capsule radius
        reaches 3.35, where the kerb's inner face is at 4.00 - 0.36 = 3.64.
      */
      'from-cave': [3.0, 4.4, -13.0],
    },
    /*
      Taken from the palette rather than written out again here.

      These were literals, and they had drifted: the horizon was still the warm
      cream '#ffe6c4' that palette.ts records as having been replaced, while
      SkyDome renders the cool '#d6ecfb' the palette actually holds. Since these
      two values drive the background colour and the fog, and SkyDome draws the
      gradient behind them, the fog was warm, the sky was cool, and the seam
      between them sat right on the horizon where it is most visible.

      A scene wanting a sky of its own is free to pass different values. What it
      cannot do any more is silently disagree with the palette by default.
    */
    sky: { top: palette.skyTop, horizon: palette.skyHorizon },
    /*
      The island's soil cone bottoms out at about y=-6.2. Set well below that so
      a player who walks off the edge gets a real moment of falling before the
      iris takes the screen, rather than being snatched back the instant they
      clear the lip.
    */
    killY: -12,
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
    /*
      The cave is a sealed box with a floor at y=0, so nothing can reach this.
      It is here because the field is required, and it is required so that the
      next enclosed scene cannot quietly ship without a floor of last resort.
    */
    killY: -20,
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
