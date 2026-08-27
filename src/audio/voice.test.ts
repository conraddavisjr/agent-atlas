import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE } from './voiceManifest'
import { INSTRUCTOR_LINES } from '@/game/training/cards'
import { DURATIONS, VOICE_TAIL, initialTrainingState, stepTraining } from '@/game/training/trainingMachine'

/*
  The chain these tests form is the point, and it is described in `cards.ts`:

    1. Edit `shown`  -> the normalisation test in `cards.test.ts` fails.
    2. Edit `spoken` -> the hash test below fails.
    3. Re-bake       -> the existence test below confirms the files landed.

  There is no path from "somebody changed the wizard's words" to "the audio still
  says the old thing" that does not go red.
*/

const hashOf = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

describe('the baked voice matches the copy it was baked from', () => {
  it('has one line for each thing the instructor says', () => {
    expect(VOICE.lines).toHaveLength(INSTRUCTOR_LINES.length)
  })

  it('was rendered from exactly the strings in cards.ts', () => {
    /*
      **The most important assertion in this file.**

      The failure it catches is invisible everywhere else: somebody improves the
      wizard's line, the mp3 keeps saying the old one, and there is no screenshot,
      no type error and no console message that would ever reveal it. It would sit
      in the build for months.
    */
    VOICE.lines.forEach((line, i) => {
      expect(line.hash, `line ${i} was baked from different words`).toBe(
        hashOf(INSTRUCTOR_LINES[i].spoken),
      )
    })
  })

  it('names files that are actually on disk', () => {
    // So a 404 in production requires a file to have been removed AFTER a green
    // test run, which is a deploy problem rather than a code one.
    for (const line of VOICE.lines) {
      const path = resolve(process.cwd(), 'public', line.file.replace(/^\//, ''))
      expect(existsSync(path), `${line.file} is missing; run \`npm run bake:voice\``).toBe(true)
    }
  })

  it('records the voice, the language and the speed, not just the durations', () => {
    /*
      A duration is only valid for the speed it was rendered at, and Kokoro only
      WARNS when the language code disagrees with the voice - it loads a British
      voice into the American pipeline and carries on. Recording all three means a
      re-bake at different settings is visible in the diff rather than being a
      round whose beats are half a second wrong on every playthrough.
    */
    expect(VOICE.voice).toBe('bm_george')
    expect(VOICE.lang).toBe('b')
    expect(VOICE.speed).toBe(1)
  })
})

describe('the round is timed by the manifest, not by the audio', () => {
  it('derives both speech beats from the baked durations', () => {
    expect(DURATIONS.speech1).toBeCloseTo(VOICE.lines[0].duration + VOICE_TAIL, 6)
    expect(DURATIONS.speech2).toBeCloseTo(VOICE.lines[1].duration + VOICE_TAIL, 6)
  })

  it('leaves every subtitle on screen longer than it takes to read', () => {
    /*
      **This was broken before the voice existed, which is what makes it worth a
      test rather than a comment.** `speech2` was 3.2 s for a thirteen-word line,
      about 3.9 s of reading at 200 wpm - so it had been showing its own subtitle
      for four fifths of the time a reader needs, since the round shipped, with no
      audio in the project at all. The beats were "paced by ear" by an ear that
      already knew the line.
    */
    const beats = [DURATIONS.speech1, DURATIONS.speech2]
    INSTRUCTOR_LINES.forEach((line, i) => {
      const words = line.shown.trim().split(/\s+/).length
      const readTime = (words * 60) / 200
      expect(beats[i], `line ${i} moves on before it can be read`).toBeGreaterThan(readTime)
    })
  })

  it('lets the player out from behind the audio gate', () => {
    /*
      The gate holds the round by stepping the machine with `dt = 0`. That freezes
      every timer, which is the point, and it must NOT freeze the way out - a
      dialog a player cannot escape from is worse than no dialog.
    */
    const held = stepTraining(
      initialTrainingState(),
      { advance: false, bail: true, shot: false, hit: null, correct: 1 },
      0,
    )
    expect(held.phase).toBe('exiting')
  })

  it('does not advance a beat while the gate is up', () => {
    const still = stepTraining(
      initialTrainingState(),
      { advance: false, bail: false, shot: false, hit: null, correct: 1 },
      0,
    )
    expect(still.phase).toBe('arriving')
    expect(still.elapsed).toBe(0)
  })
})
