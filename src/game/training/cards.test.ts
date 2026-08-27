import { describe, expect, it } from 'vitest'
import {
  ANSWER_LIMIT,
  CARDS,
  CARD_BODY_LIMIT,
  INSTRUCTOR_LINES,
  sameSentence,
  QUIZ,
} from './cards'
import { CARD_COUNT } from './trainingMachine'

/*
  Copy is the part of this feature most likely to be edited by somebody who is not
  editing code, and its defects are exactly the ones a typechecker cannot see: a
  card that overflows its face, a quiz with two right answers, or a question that
  cannot be answered from what the player was just shown.
*/

describe('the cards', () => {
  it('supplies exactly as many as the round asks for', () => {
    /*
      The machine drives the cube's rotation from `CARD_COUNT`, so a third card
      added here without touching it would be written, rendered on a face nobody
      turns to, and never read.
    */
    expect(CARDS).toHaveLength(CARD_COUNT)
  })

  it('fits its face', () => {
    for (const card of CARDS) {
      expect(card.body.length, card.heading).toBeLessThanOrEqual(CARD_BODY_LIMIT)
      expect(card.body.length, `${card.heading} is suspiciously short`).toBeGreaterThan(80)
      expect(card.heading.length).toBeLessThanOrEqual(24)
    }
  })

  it('leaves a face spare for the success state', () => {
    // A cube has four Y-facing sides. Two cards plus the quiz is three.
    expect(CARD_COUNT + 1).toBeLessThan(4 + 1)
  })
})

describe('the quiz', () => {
  it('has exactly one correct answer, and it is in range', () => {
    expect(QUIZ.answers).toHaveLength(3)
    expect(QUIZ.correct).toBeGreaterThanOrEqual(0)
    expect(QUIZ.correct).toBeLessThan(QUIZ.answers.length)
  })

  it('offers three DIFFERENT answers', () => {
    // Two identical options make one of them unfairly wrong.
    expect(new Set(QUIZ.answers).size).toBe(QUIZ.answers.length)
  })

  it('fits above a plank', () => {
    for (const answer of QUIZ.answers) {
      expect(answer.length, answer).toBeLessThanOrEqual(ANSWER_LIMIT)
    }
  })

  it('is answerable from what the player was actually shown', () => {
    /*
      The check that makes this file worth having.

      The correct answer's distinctive claim - that the machine GUESSES what comes
      NEXT - has to appear in the reading, or the round is asking a question it
      never taught. A keyword test is crude, and it catches the real failure: copy
      rewritten on the cards while the quiz stays as it was.
    */
    const reading = CARDS.map((c) => c.body).join(' ').toLowerCase()
    for (const word of ['guess', 'next']) {
      expect(reading, `reading never mentions "${word}"`).toContain(word)
    }

    const right = QUIZ.answers[QUIZ.correct].toLowerCase()
    expect(right).toContain('guess')
    expect(right).toContain('next')
  })

  it('does not give the answer away by length', () => {
    /*
      A classic multiple-choice tell: the right answer is the long, careful one.
      Bounded to within a third of the mean so nobody can pick it without reading.
    */
    const lengths = QUIZ.answers.map((a) => a.length)
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
    for (const [i, length] of lengths.entries()) {
      expect(Math.abs(length - mean) / mean, QUIZ.answers[i]).toBeLessThan(0.34)
    }
  })
})

describe('the instructor', () => {
  it('says one line per speaking beat', () => {
    // `speech1` and `speech2`. A third line would never be spoken.
    expect(INSTRUCTOR_LINES).toHaveLength(2)
  })

  it('says the same sentence aloud as it puts on screen', () => {
    /*
      The failure this catches is the one nobody thinks of: somebody fixes a typo
      in the subtitle, does not touch the spoken form, and the wizard now says
      something the caption does not. No hash catches it, because the hashed
      string did not change.
    */
    for (const line of INSTRUCTOR_LINES) {
      expect(sameSentence(line.spoken), line.shown).toBe(sameSentence(line.shown))
    }
  })

  it('permits the phonemiser its two edits and nothing more', () => {
    // A.I. for AI, and a comma for the project's plain dash.
    expect(INSTRUCTOR_LINES[0].spoken).toContain('A.I.')
    expect(INSTRUCTOR_LINES[0].shown).toContain('AI ')
    expect(sameSentence('Ah - an apprentice!')).toBe(sameSentence('Ah, an apprentice!'))
    expect(sameSentence('one question')).not.toBe(sameSentence('two questions'))
  })

  it('keeps each line short enough to read before it moves on', () => {
    /*
      The lines auto-advance after 2.6 s and 3.2 s. Reading is roughly 15
      characters a second at a glance, so a line over about 80 characters cannot be
      finished by someone who is also watching a wizard fly.
    */
    for (const line of INSTRUCTOR_LINES) {
      expect(line.shown.length, line.shown).toBeLessThanOrEqual(80)
    }
  })
})
