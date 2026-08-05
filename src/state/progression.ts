import type { Cosmetic, Lesson, ProgressState, SocketName, Zone } from './types'

/**
 * Pure progression rules. No React, no three.js, no store.
 *
 * Everything here is derived rather than stored, so saved data can never
 * disagree with the rules. It is also the only part of the game that unit tests
 * can meaningfully assert on, since feel has to be verified by playing it.
 */

export function isLessonComplete(lesson: Lesson, state: ProgressState): boolean {
  return lesson.isComplete(state)
}

export function lessonsInZone(zoneId: string, lessons: Lesson[]): Lesson[] {
  return lessons.filter((l) => l.zoneId === zoneId)
}

export function isZoneComplete(zoneId: string, lessons: Lesson[], state: ProgressState): boolean {
  const zoneLessons = lessonsInZone(zoneId, lessons)
  // An empty zone is not complete. Treating it as complete would silently unlock
  // everything downstream the moment a zone is stubbed out during development.
  if (zoneLessons.length === 0) return false
  return zoneLessons.every((l) => isLessonComplete(l, state))
}

export function isZoneUnlocked(
  zoneId: string,
  zones: Zone[],
  lessons: Lesson[],
  state: ProgressState,
): boolean {
  const zone = zones.find((z) => z.id === zoneId)
  if (!zone) return false
  if (zone.requires === null) return true
  return isZoneComplete(zone.requires, lessons, state)
}

export function zoneProgress(
  zoneId: string,
  lessons: Lesson[],
  state: ProgressState,
): { done: number; total: number } {
  const zoneLessons = lessonsInZone(zoneId, lessons)
  return {
    done: zoneLessons.filter((l) => isLessonComplete(l, state)).length,
    total: zoneLessons.length,
  }
}

/**
 * Which cosmetics the robot is currently wearing, keyed by socket.
 *
 * Derived rather than stored so that changing an unlock rule retroactively
 * fixes every existing save rather than only affecting new players.
 */
export function earnedCosmetics(
  cosmetics: Cosmetic[],
  lessons: Lesson[],
  state: ProgressState,
): Partial<Record<SocketName, string>> {
  const worn: Partial<Record<SocketName, string>> = {}
  for (const c of cosmetics) {
    if (isZoneComplete(c.earnedAfterZone, lessons, state)) {
      worn[c.socket] = c.id
    }
  }
  return worn
}

/** Whether a scene can be entered, used by portals to decide locked state. */
export function isSceneAccessible(
  sceneId: string,
  zones: Zone[],
  lessons: Lesson[],
  state: ProgressState,
): boolean {
  const zonesForScene = zones.filter((z) => z.sceneId === sceneId)
  if (zonesForScene.length === 0) return true
  return zonesForScene.some((z) => isZoneUnlocked(z.id, zones, lessons, state))
}
