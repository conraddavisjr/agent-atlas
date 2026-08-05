import { describe, it, expect } from 'vitest'
import {
  earnedCosmetics,
  isSceneAccessible,
  isZoneComplete,
  isZoneUnlocked,
  zoneProgress,
} from './progression'
import type { Cosmetic, Lesson, ProgressState, Zone } from './types'

const base: ProgressState = {
  completedLessons: [],
  currentSceneId: 'hub',
  currentSpawnId: 'start',
  lessonData: {},
}

const withDone = (...ids: string[]): ProgressState => ({ ...base, completedLessons: ids })

const zones: Zone[] = [
  { id: 'a', title: 'A', sceneId: 'hub', requires: null },
  { id: 'b', title: 'B', sceneId: 'cave', requires: 'a' },
  { id: 'c', title: 'C', sceneId: 'tower', requires: 'b' },
]

const lesson = (id: string, zoneId: string): Lesson => ({
  id,
  zoneId,
  title: id,
  blurb: '',
  position: [0, 0, 0],
  isComplete: (s) => s.completedLessons.includes(id),
})

const lessons: Lesson[] = [
  lesson('a1', 'a'),
  lesson('a2', 'a'),
  lesson('b1', 'b'),
  lesson('c1', 'c'),
]

describe('zone completion', () => {
  it('requires every lesson in the zone', () => {
    expect(isZoneComplete('a', lessons, withDone('a1'))).toBe(false)
    expect(isZoneComplete('a', lessons, withDone('a1', 'a2'))).toBe(true)
  })

  it('treats a zone with no lessons as incomplete', () => {
    // Guards against a stubbed-out zone silently unlocking everything downstream.
    expect(isZoneComplete('empty', lessons, base)).toBe(false)
  })

  it('ignores completed lessons belonging to other zones', () => {
    expect(isZoneComplete('b', lessons, withDone('a1', 'a2'))).toBe(false)
  })
})

describe('zone unlocking', () => {
  it('opens zones with no prerequisite', () => {
    expect(isZoneUnlocked('a', zones, lessons, base)).toBe(true)
  })

  it('keeps a zone locked until its prerequisite is finished', () => {
    expect(isZoneUnlocked('b', zones, lessons, withDone('a1'))).toBe(false)
    expect(isZoneUnlocked('b', zones, lessons, withDone('a1', 'a2'))).toBe(true)
  })

  it('does not let progress skip a zone in the chain', () => {
    // Finishing a and c must not open c's gate while b is still outstanding.
    expect(isZoneUnlocked('c', zones, lessons, withDone('a1', 'a2', 'c1'))).toBe(false)
  })

  it('returns false for an unknown zone rather than throwing', () => {
    expect(isZoneUnlocked('nope', zones, lessons, base)).toBe(false)
  })
})

describe('zone progress', () => {
  it('counts done against total', () => {
    expect(zoneProgress('a', lessons, withDone('a1'))).toEqual({ done: 1, total: 2 })
  })
})

describe('scene accessibility', () => {
  it('locks a scene whose zone is not yet unlocked', () => {
    expect(isSceneAccessible('cave', zones, lessons, base)).toBe(false)
    expect(isSceneAccessible('cave', zones, lessons, withDone('a1', 'a2'))).toBe(true)
  })

  it('allows scenes that belong to no zone, such as neutral connectors', () => {
    expect(isSceneAccessible('lobby', zones, lessons, base)).toBe(true)
  })
})

describe('cosmetics', () => {
  const cosmetics: Cosmetic[] = [
    { id: 'helmet', socket: 'head', earnedAfterZone: 'a' },
    { id: 'cape', socket: 'back', earnedAfterZone: 'b' },
  ]

  it('grants nothing at the start', () => {
    expect(earnedCosmetics(cosmetics, lessons, base)).toEqual({})
  })

  it('grants per socket as zones complete', () => {
    expect(earnedCosmetics(cosmetics, lessons, withDone('a1', 'a2'))).toEqual({ head: 'helmet' })
    expect(earnedCosmetics(cosmetics, lessons, withDone('a1', 'a2', 'b1'))).toEqual({
      head: 'helmet',
      back: 'cape',
    })
  })

  it('derives from rules rather than storage, so rule changes apply retroactively', () => {
    // Same save, stricter cosmetic rule, immediately reflected.
    const stricter: Cosmetic[] = [{ id: 'helmet', socket: 'head', earnedAfterZone: 'b' }]
    expect(earnedCosmetics(stricter, lessons, withDone('a1', 'a2'))).toEqual({})
  })
})

describe('predicate-based completion', () => {
  it('supports rules other than a bare completion flag', () => {
    // This is the seam the deferred LLM verification will plug into: a lesson can
    // require evidence rather than a manual tick, with no other code changing.
    const evidenceLesson: Lesson = {
      id: 'first-prompt',
      zoneId: 'z',
      title: 'First prompt',
      blurb: '',
      position: [0, 0, 0],
      isComplete: (s) => typeof s.lessonData['first-prompt'] === 'string',
    }
    expect(isZoneComplete('z', [evidenceLesson], base)).toBe(false)
    expect(
      isZoneComplete('z', [evidenceLesson], { ...base, lessonData: { 'first-prompt': 'hello' } }),
    ).toBe(true)
  })
})
