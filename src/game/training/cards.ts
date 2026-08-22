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

/** What the instructor says on the way in. One line per beat. */
export const INSTRUCTOR_LINES: readonly string[] = [
  'Ah - an apprentice! Welcome to AI training.',
  'Two short scrolls, then one question. You will answer it with an arrow.',
]

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
