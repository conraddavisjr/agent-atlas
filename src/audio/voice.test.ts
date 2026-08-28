import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE } from './voiceManifest'
import { allow, decline, voiceState } from './voice'
import {
  CARDS,
  INSTRUCTOR_LINES,
  QUIZ,
  sameSentence,
  segmentSpoken,
  shownWords,
} from '@/game/training/cards'
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
    for (const line of [...VOICE.lines, ...VOICE.segments, VOICE.question]) {
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
    expect(VOICE.voice).toBe('bm_lewis')
    expect(VOICE.lang).toBe('b')
    expect(VOICE.speed).toBe(1)
  })

  it('narrates every card segment, and from the segment\'s own words', () => {
    /*
      Six clips, two cards of three clauses. Each clause is illustrated by one
      form and narrated while that form is on the stage, so a missing one is a
      form with nothing being said over it - and, because the dwells are derived
      from these durations, a form with no length either.
    */
    const segments = CARDS.flatMap((card, c) =>
      card.segments.map((segment, i) => ({ c, i, segment })),
    )
    expect(VOICE.segments).toHaveLength(segments.length)
    for (const { c, i, segment } of segments) {
      const clip = VOICE.segments.find((s) => s.card === c && s.index === i)
      expect(clip, `card ${c} segment ${i} was never baked`).toBeDefined()
      expect(clip!.hash, `card ${c} segment ${i} was baked from different words`).toBe(
        hashOf(segmentSpoken(segment)),
      )
    }
  })

  it('reads the quiz question, and from the question on the cube', () => {
    /*
      The one thing in the round the player is asked to answer. It used to arrive
      in silence after two narrated cards, which reads as the voice having given
      up rather than as the lesson changing gear.

      Hashed like everything else, so the question on the board and the question
      in the ear cannot drift apart - the same chain `cards.ts` describes.
    */
    expect(VOICE.question.hash).toBe(hashOf(QUIZ.spokenQuestion))
    const path = resolve(process.cwd(), 'public', VOICE.question.file.replace(/^\//, ''))
    expect(existsSync(path), 'question.mp3 is missing; run `npm run bake:voice`').toBe(true)
  })

  it('asks aloud the same question it shows', () => {
    expect(sameSentence(QUIZ.spokenQuestion)).toBe(sameSentence(QUIZ.question))
  })

  it('gives every clip word timings that stay inside it and never go backwards', () => {
    /*
      **These are what the highlighting rides on**, and a bad one is invisible
      until somebody watches the words drift out of step with the voice.

      They come from Kokoro's own per-phoneme duration prediction rather than
      from measuring the output, so they are exact by construction - which is
      exactly the kind of claim that deserves an assertion rather than trust.
    */
    for (const clip of [...VOICE.lines, ...VOICE.segments, VOICE.question]) {
      expect(clip.words.length, `${clip.file} has no words`).toBeGreaterThan(0)
      let last = 0
      for (const word of clip.words) {
        expect(word.start, `${clip.file}: ${word.text} starts before the last word`)
          .toBeGreaterThanOrEqual(last - 1e-6)
        expect(word.end, `${clip.file}: ${word.text} ends before it starts`)
          .toBeGreaterThanOrEqual(word.start)
        last = word.start
      }
      const final = clip.words[clip.words.length - 1]
      expect(final.end, `${clip.file}: the last word ends after the audio does`)
        .toBeLessThanOrEqual(clip.duration + 0.05)
    }
  })

  it('says every word the subtitle shows', () => {
    /*
      The highlight indexes the SHOWN words and the timings index the SPOKEN ones,
      so the two lists have to be the same length or the highlight lands on the
      wrong word - a failure that looks like bad timing rather than like bad data.
    */
    CARDS.forEach((card, c) => {
      card.segments.forEach((segment, i) => {
        const clip = VOICE.segments.find((s) => s.card === c && s.index === i)!
        const spokenTokens = shownWords(segment.shown).filter((w) => w.spoken).length
        expect(
          clip.words.length,
          `card ${c} segment ${i}: ${clip.words.length} timed vs ${spokenTokens} spoken tokens`,
        ).toBe(spokenTokens)
      })
    })
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

describe('muting is reversible', () => {
  /*
    **This is a bug that shipped, and it shipped silently.**

    `decline()` set the state and `unlock()` opened with an early return on it, so
    the first press of mute made the module permanently mute. Pressing the toggle
    again set the preference back to `'on'`, lit the icon, and produced nothing at
    all - which from the outside is indistinguishable from a browser that has
    blocked audio, an mp3 that 404ed, or a tab the operating system has muted.
    Exactly the family of failures this module reports six separate states to tell
    apart, defeated by one early return.

    It runs here rather than in a browser because `allow()` deliberately needs
    neither a `window` nor a gesture - that separation is what makes the round
    trip testable at all.
  */
  it('comes back when the player changes their mind', () => {
    decline()
    expect(voiceState()).toBe('declined')
    allow()
    expect(voiceState(), 'the player is still muted after asking for sound').not.toBe('declined')
  })

  it('survives being asked twice, in either direction', () => {
    decline()
    decline()
    expect(voiceState()).toBe('declined')
    allow()
    allow()
    expect(voiceState()).not.toBe('declined')
  })

  it('leaves a state that is not declined alone', () => {
    allow()
    const before = voiceState()
    allow()
    expect(voiceState()).toBe(before)
  })
})
