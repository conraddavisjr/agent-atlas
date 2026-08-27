/**
 * Everything the round says, in one file.
 *
 * ## Why the copy is data and not JSX
 *
 * It is the part most likely to be edited by somebody who is not editing code, and
 * the part whose defects are invisible to a typechecker: a card that overflows its
 * face, a quiz with two right answers, an answer that cannot be inferred from what
 * the player was just shown. Those are checkable, and they are only checkable if
 * the text is a value rather than a literal buried in a component.
 *
 * ## The voice
 *
 * A wizard, chosen with the user. The point of it is not decoration - it is that
 * an explanation which admits to being a performance can be blunter than one
 * pretending to be a textbook. "Understood none of it" is a stronger claim than any
 * neutral phrasing would let us make, and the hat is what buys it.
 *
 * ## Why this teaches AI and not LLMs, despite the obvious overlap
 *
 * The repo has two lessons: `what-is-ai` and `what-is-an-llm`. The round is
 * attached to the first, so the cards answer "what is this thing" for a newcomer -
 * that it predicts, that nobody wrote its rules, that it can be confidently wrong.
 * The mechanics a second lesson would need - tokens, context, what a model
 * actually is - are deliberately left on the table for it.
 */

export type Card = {
  /** Shown small above the body, so the player knows where they are. */
  heading: string
  body: string
}

/**
 * The two reading cards.
 *
 * Two, decided with the user. The cube has four Y-facing sides, so two cards plus
 * the quiz uses three and leaves one spare for a success state.
 */
export const CARDS: readonly Card[] = [
  {
    heading: 'THE FIRST TRUTH',
    /*
      **"It does not look things up. It does not ponder." was cut, and it was the
      most serious error in the first draft.**

      Those were the only two sentences in the round a reader could personally
      falsify, and they would - within a minute of using any assistant that
      searches the web or thinks step by step. Copy that is contradicted by the
      thing it is describing does not teach a simplification, it teaches distrust.

      "Understood none of it" also went, for a different reason: it takes a side in
      a live research dispute about internal representations. The replacement makes
      a claim about what we DID to the machine rather than about its inner life,
      and nobody disputes that we never told it what any of it means.
    */
    body:
      'Behold: a machine that read very nearly everything, and was told what none ' +
      'of it means. Give it a library and it will fetch; give it time and it will ' +
      'work step by step. But underneath is one trick, always: guess what comes ' +
      'next - and from all that reading, it guesses uncannily well.',
  },
  {
    heading: 'THE SECOND TRUTH',
    /*
      Two corrections here.

      "We hid words from it" described masked language modelling, which is BERT.
      The models a reader will actually meet are autoregressive: they predict what
      comes NEXT, which is what "we hid what came next" says.

      And post-training was missing entirely, which made "no wizard wrote its
      rules" overclaim. Nobody wrote the weights - but people very deliberately
      trained it to answer you rather than continue your sentence, and that second
      stage is the whole reason the thing behaves like an assistant at all.
    */
    body:
      'No wizard wrote its rules. We hid what came next and corrected it, a ' +
      'trillion times over, until the guessing turned uncanny. Then we trained it ' +
      'again, by hand, to answer you rather than ramble on. So it gives you what ' +
      'USUALLY follows - not what is true. Confident, and perfectly wrong.',
  },
]

export type InstructorLine = {
  /** What the subtitle says. */
  shown: string
  /**
   * What the synthesiser is handed, which is not the same string.
   *
   * Two edits, both necessary and both invisible in a screenshot. The project's
   * plain dash is a typographic convention no grapheme-to-phoneme front end
   * understands - it becomes silence, or a mispronunciation - so it becomes a
   * comma, which is a prosodic cue. And `AI` is read as a WORD by any G2P that
   * meets a two-letter uppercase token which happens to be a valid English
   * digraph, so the wizard welcomes you to "eye training". `A.I.` is the fix.
   */
  spoken: string
}

/**
 * What the instructor says on the way in. One line per beat.
 *
 * ## Why the pronunciation spelling lives here and not in the bake tool
 *
 * This file opens by arguing that copy is data because it is "the part most
 * likely to be edited by somebody who is not editing code, and the part whose
 * defects are invisible to a typechecker". A pronunciation spelling is copy by
 * exactly that test: it is a decision about how a sentence sounds, made by
 * whoever owns the sentence. Anywhere else and the person fixing a typo in the
 * subtitle does not see that the wizard still says the old thing.
 *
 * ## Three tests chain to make that impossible
 *
 * 1. Edit `shown` and the NORMALISATION test fails, because `shown` and `spoken`
 *    must be the same sentence once punctuation and case are stripped.
 * 2. Edit `spoken` and the HASH test fails, because the voice manifest records a
 *    hash of the exact string each mp3 was rendered from.
 * 3. Re-bake and the EXISTENCE test confirms every file the manifest names is on
 *    disk, and a DEV assertion confirms the decoded audio is the length the
 *    manifest claims.
 *
 * There is no path from "somebody changed the wizard's words" to "the audio still
 * says the old thing" that does not fail a test. Two things the chain cannot
 * catch, so nobody assumes otherwise: a homograph the phonemiser gets wrong with
 * no spelling change, and a correctly spelled word Kokoro simply mispronounces.
 * Those need ears, once, at bake time.
 */
export const INSTRUCTOR_LINES: readonly InstructorLine[] = [
  {
    shown: 'Ah - an apprentice! Welcome to AI training.',
    spoken: 'Ah, an apprentice! Welcome to A.I. training.',
  },
  {
    shown: 'Two short scrolls, then one question. You will answer it with an arrow.',
    spoken: 'Two short scrolls, then one question. You will answer it with an arrow.',
  },
]

/**
 * The two strings reduced to the sentence they share.
 *
 * Case and everything that is not a letter or a digit, which is exactly the two
 * edits the phonemiser needs - punctuation swapped for prosody, dots inside an
 * initialism - and nothing else. A changed word, a dropped clause or a different
 * number all survive the reduction and fail the comparison.
 */
export const sameSentence = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export type Quiz = {
  question: string
  /** Top to bottom, matching the planks. */
  answers: readonly string[]
  /** Index into `answers`. */
  correct: number
}

export const QUIZ: Quiz = {
  question: 'So tell me, apprentice. Underneath it all - what does it do?',
  /*
    All three are within a third of the mean LENGTH, and that is enforced by a
    test rather than left to care. The classic multiple-choice tell is that the
    right answer is the long, careful one, and the first draft of this had a
    19-character distractor against a 38-character answer - pickable without
    reading a word of the cards.
  */
  answers: [
    /*
      The first distractor changed with card 1. It used to be "Looks the answer up
      in a great library" - which stopped being a wrong answer the moment the card
      conceded that a machine given a library will fetch from it. A distractor that
      is partly true is a trick question.
    */
    'Remembers every page it has ever read',
    'Guesses what comes next, over and over',
    'Thinks it through, much as you would',
  ],
  correct: 1,
}

/**
 * The longest a card body may be before it stops fitting its face.
 *
 * A character budget rather than a measured layout, and that is a deliberate
 * trade. Measuring would mean instantiating troika's text engine, which needs a
 * font fetch and a browser, and this project's stated rule for generated content
 * is to test where the marks go rather than what the rasteriser drew.
 *
 * 300 characters at the cube's `fontSize` and `maxWidth` is about nine lines on a
 * 2.1 m face, which leaves room for the heading and a margin. It is a ceiling
 * that catches the real failure - somebody adding a paragraph - without pretending
 * to know where the line breaks land.
 */
export const CARD_BODY_LIMIT = 300

/** Same, for an answer label sitting above a plank 0.62 m across. */
export const ANSWER_LIMIT = 42
