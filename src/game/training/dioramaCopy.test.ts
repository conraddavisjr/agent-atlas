import { describe, expect, it } from 'vitest'
import {
  CANDIDATES,
  CARD_0_STATIONS,
  CARD_1_STATIONS,
  CONFIDENCE_NOTE,
  CONFIDENCE_READING,
  CORRECTION_STOPS,
  FED_STREAMS,
  HIDDEN_GUESS,
  HIDDEN_SENTENCE,
  HIDDEN_TRUTH,
  PROMPT,
} from './dioramaCopy'
import { CARDS } from './cards'

describe('the word fan is a real choice, honestly weighted', () => {
  it('is a probability distribution rather than five numbers', () => {
    // A fan whose weights do not sum reads as bars somebody drew rather than as
    // odds, and the whole station is a claim about odds.
    const total = CANDIDATES.reduce((sum, c) => sum + c.weight, 0)
    expect(total).toBeCloseTo(1, 6)
    for (const c of CANDIDATES) {
      expect(c.weight, c.word).toBeGreaterThan(0)
      expect(c.weight).toBeLessThan(1)
    }
  })

  it('has exactly one winner', () => {
    const top = Math.max(...CANDIDATES.map((c) => c.weight))
    expect(CANDIDATES.filter((c) => c.weight === top)).toHaveLength(1)
  })

  it('carries a REAL rival, which is the point of the set', () => {
    /*
      **The assertion this station exists to satisfy.**

      A fan whose right answer is the only sensible entry teaches that guessing is
      easy, which is the opposite of what the paragraph says. A reader who notices
      the distractors are nonsense learns to distrust the diagram rather than to
      trust the machine.

      So the runner-up has to be a genuine continuation with real weight - not a
      rounding error next to the winner, and not so close that the picture shows a
      coin flip.
    */
    const sorted = [...CANDIDATES].sort((a, b) => b.weight - a.weight)
    expect(sorted[1].weight, 'the rival is a rounding error').toBeGreaterThan(0.15)
    expect(sorted[1].weight, 'the guess is a coin flip').toBeLessThan(sorted[0].weight * 0.6)
  })

  it('shows that it was choosing from everything, not from a shortlist', () => {
    // The absurd entries are the honest part: they were available and they lost.
    const sorted = [...CANDIDATES].sort((a, b) => b.weight - a.weight)
    expect(sorted[sorted.length - 1].weight).toBeLessThan(0.05)
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(4)
  })

  it('never repeats a word, in the fan or in the prompt', () => {
    // A word in both places reads as the machine copying rather than predicting.
    const words = [...PROMPT, ...CANDIDATES.map((c) => c.word)]
    expect(new Set(words).size).toBe(words.length)
  })

  it('gives the machine a short run-up, because that is the claim', () => {
    // Two words. A whole sentence would suggest it needs one.
    expect(PROMPT.length).toBeLessThanOrEqual(3)
    for (const w of PROMPT) expect(w).toBe(w.toUpperCase())
  })
})

describe('the illustrations say what the paragraphs say', () => {
  /*
    The constraint that keeps this honest: each station is one clause of the card
    beside it, made literal. An illustration showing something the text does not
    claim is a second, unreviewed lesson - and it is the one nobody would think to
    review, because it has no sentences in it.
  */

  it('illustrates card zero: read, fetch, guess', () => {
    const body = CARDS[0].body.toLowerCase()
    expect(body).toContain('read')
    expect(body).toContain('fetch')
    expect(body).toContain('guess')
    expect(CARD_0_STATIONS.map((s) => s.label)).toEqual(['FED', 'FETCHED', 'GUESSED'])
  })

  it('illustrates card one: hidden, corrected, confident', () => {
    const body = CARDS[1].body.toLowerCase()
    expect(body).toContain('hid')
    expect(body).toContain('corrected')
    expect(body).toContain('confident')
    expect(CARD_1_STATIONS.map((s) => s.label)).toEqual(['HIDDEN', 'CORRECTED', 'CONFIDENT'])
  })

  it('counts to the trillion the paragraph promises', () => {
    expect(CARDS[1].body.toLowerCase()).toContain('trillion')
    const last = CORRECTION_STOPS[CORRECTION_STOPS.length - 1]
    expect(Number(last.replace(/,/g, ''))).toBe(1e12)
  })

  it('climbs by orders of magnitude rather than by digits', () => {
    /*
      A number spinning through six digits reads as a milliseconds display. The
      point is the ORDER, so each stop is a thousand times the last.
    */
    const values = CORRECTION_STOPS.map((s) => Number(s.replace(/,/g, '')))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBe(values[i - 1] * 1000)
    }
  })
})

describe('the hidden-word station', () => {
  it('hides the end of a sentence the reader already knows', () => {
    /*
      A nursery rhyme on purpose. The station shows a wrong guess being corrected,
      and that only lands if the reader knows the answer - with an unfamiliar
      sentence the picture shows two arbitrary words and no lesson.
    */
    expect(HIDDEN_SENTENCE.join(' ')).toBe('THE CAT SAT ON THE')
    expect(HIDDEN_TRUTH).toBe('MAT')
  })

  it('offers a guess that is wrong but not absurd', () => {
    // Absurd, and the machine looks broken rather than untrained. `ROOF` is
    // somewhere a cat plausibly sits, which is the whole difficulty.
    expect(HIDDEN_GUESS).not.toBe(HIDDEN_TRUTH)
    expect(HIDDEN_SENTENCE).not.toContain(HIDDEN_GUESS)
  })
})

describe('the confidence station makes no falsifiable claim', () => {
  it('states a certainty and a caveat, and no fact', () => {
    /*
      **The rule this station was designed around.**

      The obvious illustration is a famous wrong answer - the letters in a word, a
      date, an arithmetic slip. Every one is a claim about what a machine does
      TODAY, and `93-copy-review.md` cut a sentence from card one for exactly
      that: "the only two sentences in the round a reader could personally
      falsify, and they would - within a minute". Models get fixed; a diagram of a
      fixed bug teaches distrust of the diagram.

      What is left is the shape, which is true of every model that will ever
      exist: certainty and correctness are two different dials.
    */
    expect(CONFIDENCE_READING).toMatch(/^\d{1,3}%$/)
    expect(Number(CONFIDENCE_READING.replace('%', ''))).toBeGreaterThan(90)
    expect(CONFIDENCE_NOTE.toLowerCase()).toContain('right')
    // No digits in the caveat: a number there would be a measurement, and there
    // is nothing here to have measured.
    expect(CONFIDENCE_NOTE).not.toMatch(/\d/)
  })
})

describe('the stream labels', () => {
  it('reads widely rather than deeply, which is the claim', () => {
    // "very nearly everything". Fewer than four labels reads as a specialist.
    expect(FED_STREAMS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(FED_STREAMS).size).toBe(FED_STREAMS.length)
  })

  it('fits on a stream', () => {
    for (const s of FED_STREAMS) {
      expect(s.length, s).toBeLessThanOrEqual(12)
      expect(s).toBe(s.toUpperCase())
    }
  })
})
