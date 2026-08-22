import { describe, expect, it } from 'vitest'
import { MINIGAMES, RETURN_ROUTE, totemAction } from './lessonRoutes'
import { LESSONS } from './lessons'
import { SCENES } from '@/game/scenes/registry'

/*
  This is the test that exists because of where the code it covers lives.

  `App.tsx`'s interact handler is the one place every lesson in the game passes
  through, and until this feature it had no branches at all. The whole point of
  moving the decision into `totemAction` was to be able to sweep it, so the sweep
  is the first thing here.
*/

describe('the interact key still does what it always did, for every other lesson', () => {
  it('completes each declared lesson on the spot', () => {
    const declared = LESSONS.filter((l) => !MINIGAMES[l.id])
    // If this ever hits zero the sweep below is vacuous and would pass silently.
    expect(declared.length).toBeGreaterThan(0)

    for (const lesson of declared) {
      expect(totemAction(lesson.id, LESSONS), lesson.id).toEqual({
        kind: 'complete',
        lessonId: lesson.id,
      })
    }
  })

  it('resolves every lesson in the game to exactly one action', () => {
    // No lesson may fall through to `none`, which would be a totem that does
    // nothing when you press E at it - the most confusing possible failure,
    // because it looks like the key is broken rather than the lesson.
    for (const lesson of LESSONS) {
      expect(totemAction(lesson.id, LESSONS).kind, lesson.id).not.toBe('none')
    }
  })
})

describe('the mini-game', () => {
  it('routes what-is-ai into the round', () => {
    expect(totemAction('what-is-ai', LESSONS)).toEqual({
      kind: 'travel',
      ...MINIGAMES['what-is-ai'],
    })
  })

  it('routes there whether or not the lesson is already complete', () => {
    /*
      The replay the user asked for. Completion is deliberately not an argument to
      `totemAction` at all, which is what makes this unconditional rather than a
      branch somebody could invert: re-entering a finished round cannot un-finish
      it, because `completeLesson` is idempotent on the id.
    */
    const twice = [totemAction('what-is-ai', LESSONS), totemAction('what-is-ai', LESSONS)]
    expect(twice[0]).toEqual(twice[1])
    expect(twice[0].kind).toBe('travel')
  })

  it('names a scene that actually exists, and a spawn inside it', () => {
    /*
      A typo here is a `travel` to a scene id that `getScene` silently falls back
      to the hub for. The player would press E and be sent home, which reads as
      the totem doing nothing.
    */
    for (const [lessonId, route] of Object.entries(MINIGAMES)) {
      const scene = SCENES[route.sceneId]
      expect(scene, `${lessonId} -> ${route.sceneId}`).toBeDefined()
      expect(Object.keys(scene.spawns), `${route.sceneId} spawns`).toContain(route.spawnId)
    }
  })

  it('every mini-game names a lesson that exists', () => {
    for (const id of Object.keys(MINIGAMES)) {
      expect(LESSONS.some((l) => l.id === id), id).toBe(true)
    }
  })
})

describe('the edges', () => {
  it('does nothing when the player is not at a totem', () => {
    expect(totemAction(null, LESSONS)).toEqual({ kind: 'none' })
  })

  it('does nothing for an id with no lesson behind it', () => {
    /*
      Should be unreachable - `activeTotemId` is only set from a rendered totem -
      but the store persists across reloads, so a lesson id removed in a later
      release can survive in a save file. Completing it would write a dead id into
      `completedLessons`, where it is invisible and permanent.
    */
    expect(totemAction('a-lesson-that-was-deleted', LESSONS)).toEqual({ kind: 'none' })
  })
})

describe('the way home', () => {
  it('names a real scene and a real spawn', () => {
    const scene = SCENES[RETURN_ROUTE.sceneId]
    expect(scene).toBeDefined()
    expect(Object.keys(scene.spawns)).toContain(RETURN_ROUTE.spawnId)
  })

  it('does not come back through the door it left by', () => {
    /*
      `getSpawn` returns the registry's own stable array, so travelling to a scene
      you are already in with the same spawn id repositions nobody - and the hub's
      own `from-cave` comment documents the other half: arriving inside a trigger
      re-fires it. The round must therefore have its own spawn rather than reusing
      `start`.
    */
    expect(RETURN_ROUTE.spawnId).not.toBe('start')
  })
})
