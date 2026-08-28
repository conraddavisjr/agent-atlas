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

/**
 * One clause of a card, and the form it is illustrated by.
 *
 * A card is three of these because the illustration is three forms, and the
 * whole premise of the diorama is that each form is one clause of the paragraph
 * made literal. Splitting the paragraph HERE rather than at read time is what
 * makes that mapping a fact instead of an intention: the segments are what the
 * wizard narrates, one at a time, and each one's measured duration is how long
 * its form holds the stage.
 *
 * Before this, the paragraph was one string and the three forms ran on a fixed
 * 5 s timer, so the picture and the words were only ever loosely in step.
 */
export type Segment = {
  /** What the subtitle shows. */
  shown: string
  /**
   * What the synthesiser is handed, when that has to differ.
   *
   * Omitted when the two are the same, which is most of the time. See
   * `INSTRUCTOR_LINES` for the two edits a phonemiser actually needs and the
   * test chain that stops them drifting into different sentences.
   */
  spoken?: string
}

export type Card = {
  /** Shown small above the body, so the player knows where they are. */
  heading: string
  /**
   * The paragraph, in the three clauses its three forms illustrate.
   *
   * `body` is derived from this rather than stored beside it, so the two cannot
   * disagree - which they would, eventually, and silently.
   */
  segments: readonly [Segment, Segment, Segment]
}

/** The paragraph as one string, for anything that wants to read it whole. */
export const cardBody = (card: Card): string =>
  card.segments.map((s) => s.shown).join(' ')

/** What the synthesiser is handed for a segment. */
export const segmentSpoken = (segment: Segment): string => segment.spoken ?? segment.shown

export type ShownWord = {
  /** Exactly as it appears in the paragraph, punctuation included. */
  text: string
  /**
   * Whether the voice says this token, and therefore whether it has a timing.
   *
   * False for anything with no letters or digits in it. The project's plain dash
   * is the case that matters: `guess what comes next - and from all that reading`
   * shows a standalone `-` that the spoken form replaces with a comma, so the
   * paragraph has twenty whitespace-separated tokens and the audio has nineteen
   * words.
   */
  spoken: boolean
}

/**
 * The paragraph split the way the highlight has to index it.
 *
 * **This exists because the two lists must not be allowed to differ.** The
 * highlight walks the SHOWN text and the timings come from the SPOKEN text, and
 * if a reader's word 12 is the voice's word 11 then every highlight after the
 * dash lands on the wrong word - which looks like bad timing rather than like bad
 * data, and would be chased in the wrong file.
 *
 * `voice.test.ts` asserts that the number of spoken tokens here equals the number
 * of words the bake produced, for every segment, so the two cannot drift apart
 * without a test going red.
 */
export function shownWords(text: string): ShownWord[] {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => ({ text: word, spoken: /[a-z0-9]/i.test(word) }))
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

      The three segments are FED, FETCHED and GUESSED in order, and that ordering
      is load-bearing rather than tidy: each one is narrated while its own form is
      on the stage.
    */
    segments: [
      {
        shown:
          'Behold: a machine that read very nearly everything, and was told what ' +
          'none of it means.',
      },
      {
        shown:
          'Give it a library and it will fetch; give it time and it will work ' +
          'step by step.',
      },
      {
        shown:
          'But underneath is one trick, always: guess what comes next - and from ' +
          'all that reading, it guesses uncannily well.',
        /*
          The project's plain dash is a typographic convention no grapheme-to-
          phoneme front end understands - it becomes silence or a mispronunciation
          - so it becomes a comma, which is a prosodic cue that means the same
          thing to a listener.
        */
        spoken:
          'But underneath is one trick, always: guess what comes next, and from ' +
          'all that reading, it guesses uncannily well.',
      },
    ],
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

      Split into three on sentence boundaries, which is where a narrator would
      breathe anyway. The mapping to HIDDEN / CORRECTED / CONFIDENT is looser than
      card 0's because this card's three forms do not exist yet - see
      `TeachingStage.tsx`.
    */
    segments: [
      {
        shown:
          'No wizard wrote its rules. We hid what came next and corrected it, a ' +
          'trillion times over, until the guessing turned uncanny.',
      },
      {
        /*
          **`to answer you` was the one dated phrase in the round, and this is the
          third time this file has been corrected for the same reason.**

          `93-copy-review.md` cut "it does not look things up" because a reader
          would falsify it within a minute of using an assistant that searches. The
          same test applied here in 2026 and this sentence half-failed it: a
          beginner's first contact with AI is now often watching it operate a
          browser or drive an application, not reading a reply. The claim was not
          false, it was incomplete - it describes an assistant that stops at the
          answer, and the reader's assistant does not stop at the answer.

          `do as you ask` covers answering and acting in one clause, keeps the
          contrast with "ramble on", and is strictly more accurate about what
          post-training does: instruction-following, not question-answering. That
          last point is why this is worth changing even for a reader who has never
          seen an agent.
        */
        shown: 'Then we trained it again, by hand, to do as you ask rather than ramble on.',
      },
      {
        shown:
          'So it gives you what USUALLY follows - not what is true. Confident, ' +
          'and perfectly wrong.',
        spoken:
          'So it gives you what usually follows, not what is true. Confident, ' +
          'and perfectly wrong.',
      },
    ],
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
  /** What the wizard says. See the note at the value. */
  spokenQuestion: string
  /** Top to bottom, matching the planks. */
  answers: readonly string[]
  /** Index into `answers`. */
  correct: number
}

export const QUIZ: Quiz = {
  question: 'So tell me, apprentice. Underneath it all - what does it do?',
  /*
    The spoken form, for the same reason `INSTRUCTOR_LINES` has one: the
    project's plain dash is a typographic convention no grapheme-to-phoneme front
    end understands, and it becomes silence or a mispronunciation. A comma is the
    prosodic cue that means the same thing to a listener.

    `cards.test.ts` holds the two to the same sentence once punctuation and case
    are stripped, so this cannot quietly become a different question from the one
    on the cube.
  */
  spokenQuestion: 'So tell me, apprentice. Underneath it all, what does it do?',
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
