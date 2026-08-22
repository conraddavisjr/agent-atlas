# Copy review: the two training cards and the quiz

Reviewed: `src/game/training/cards.ts`, against `src/game/training/cards.test.ts`.
Nothing under `src/` or `tools/` was modified.
The revision below is written so that `cards.test.ts` passes unchanged, which took some care and is discussed at the end.

The bar being applied is the author's: kid-friendly, but an expert should not wince.
Where the two genuinely conflict I say so and pick a side with reasons.

## Verdict table

| # | Claim | Ruling | One-line reason |
|---|---|---|---|
| 1 | "guesses what comes next" | **Fair simplification, keep it** | The mechanism is a probability distribution over next tokens, then a sample from it. That is an estimate under uncertainty, which is what "guess" means. The connotation problem is real but is cured by the neighbouring clause, not by a different verb. |
| 2 | "read very nearly everything" | **Fair simplification** | Directionally right at the order of magnitude the reader can grasp, but it is a filtered slice of the web plus code plus licensed text, not everything. "Very nearly" is doing honest hedging work. |
| 3 | "understood none of it" | **Contested, and the copy should not take the side it takes** | Bender and Koller argue form alone cannot yield meaning; Li et al. found an emergent internal board representation in Othello-GPT; Vafa et al. found such world models real but incoherent. Flatly asserting zero understanding picks a winner in a live argument. |
| 4 | "It does not look things up" | **Wrong about what the reader will actually use** | Retrieval and web search are standard in deployed assistants. Anthropic's own docs describe a first-class tool that gives Claude "direct access to real-time web content." A newcomer will falsify this sentence within a minute of using the product. |
| 5 | "It does not ponder" | **Wrong about what the reader will actually use** | Extended-thinking models emit long chains of thought and, per DeepSeek-R1, exhibit "self-reflection, verification, and dynamic strategy adaptation." A layperson watching that will call it pondering, and telling them it does not happen teaches them to distrust the lesson. |
| 6 | "We hid words from it and corrected it" | **Ambiguous, reads as the wrong architecture, cheap to fix** | Not flatly wrong: causal masking really does hide tokens during autoregressive training. But "hid words" is the standard plain-English gloss for BERT-style masked language modelling, which is a different family. "Hid what came next" is unambiguous and costs nothing. |
| 7 | "No wizard wrote its rules" | **Accurate about the weights, over-claims if it is the last word** | Nobody wrote the billions of parameters, which is the real and surprising point. But humans design the architecture, choose the objective, curate the data, and then shape the behaviour heavily in post-training. |
| 8 | "it knows what USUALLY comes next" | **Smuggles back the thing card 1 denied** | "Knows" is an epistemic verb. Using it two sentences after asserting the machine understands nothing is an internal contradiction an expert will notice immediately. |
| 9 | "perfect confidence and be perfectly wrong" | **Accurate, and the best line in the copy** | Sharpenable but not worth sharpening here: large models are in fact reasonably calibrated in some formats (Kadavath et al.), and the confident wrongness is partly an incentive artifact, since "training and evaluation procedures reward guessing over acknowledging uncertainty" (Kalai et al.). Both nuances are lesson three, not lesson one. |
| 10 | Post-training omitted entirely | **The most serious omission, and it is what makes #7 over-claim** | The cards describe pre-training and stop. A purely pre-trained model continues your sentence instead of answering your question. InstructGPT is explicit that "making language models bigger does not inherently make them better at following a user's intent." Without this beat the cards are describing something the reader has never met. |

## The verdict on "guessing", in full

The author's doubt is worth stating precisely, because the answer is not the obvious one.

What the machine does is compute a probability distribution over the next token from learned representations, then sample from it.
The author is right that "guess" undersells this.
In ordinary English a guess is arbitrary, uninformed, and low confidence, and none of those describe a well-fit conditional distribution.

But "predict" is not the fix, for two reasons.

First, it is not more accurate.
"Predict" and "guess" are the same claim about the same operation; "predict" simply carries better manners.
Swapping it in makes the sentence sound more rigorous without making it more true, which is the exact failure mode this review exists to catch.

Second, it is worse for the newcomer in a specific way.
"Predict" invites the reader to imagine foresight, a machine that knows what is coming.
"Guess" invites the reader to imagine fallibility, which is precisely the intuition card 2 needs them to already have when it says the thing can be perfectly wrong.
The whole lesson is load-bearing on the reader not trusting this process, and "guess" is the word that gets them there.

It is also worth noting that the strongest recent treatment of hallucination, from OpenAI, uses exactly this vocabulary as its technical framing: models hallucinate because "training and evaluation procedures reward guessing over acknowledging uncertainty."
The word is not beneath the literature.

So the recommendation is: **keep "guess", and pay for it.**
The cure for the arbitrariness connotation is not a different verb, it is the clause that immediately follows and explains why the guess is good.
The current copy already gestures at this with "it guesses well, for it has seen more writing than you or I ever shall."
The revision below strengthens that link so the causation is explicit: it guesses well *because* of the reading, not despite being a guess.

## Revised copy, ready to paste

### Card 1, THE FIRST TRUTH (283 characters, limit 300)

> Behold: a machine that read very nearly everything, and was told what none of it means. Give it a library and it will fetch; give it time and it will work step by step. But underneath is one trick, always: guess what comes next - and from all that reading, it guesses uncannily well.

### Card 2, THE SECOND TRUTH (285 characters, limit 300)

> No wizard wrote its rules. We hid what came next and corrected it, a trillion times over, until the guessing turned uncanny. Then we trained it again, by hand, to answer you rather than ramble on. So it gives you what USUALLY follows - not what is true. Confident, and perfectly wrong.

### Quiz

Question: `So tell me, apprentice. Underneath it all - what does it do?`

| Answer | Length |
|---|---|
| Remembers every page it has ever read | 37 |
| **Guesses what comes next, over and over** (correct, index 1) | 38 |
| Thinks it through, much as you would | 36 |

Mean 37.00, maximum deviation 2.7 percent, well inside the 34 percent bound.
All three are under the 42 character answer limit.

### Test compliance, verified

- Card bodies 283 and 285, both above the 80 character floor and under the 300 ceiling.
- Headings unchanged, both under 24 characters.
- Joined reading contains `guess` and `next` in lower case, so the answerability test passes.
- Correct answer contains `guess` and `next`.
- Three distinct answers, correct index 1, in range.
- `INSTRUCTOR_LINES` untouched.

## What changed and why

**"understood none of it" became "was told what none of it means."**
This is the single most important move in the revision and it generalises.
The original makes a claim about the machine's inner life, which is exactly the claim that is under dispute.
The replacement makes a claim about what *we did to it*, which is not disputed by anyone: the training signal is the text itself, with no grounding, no labels, and nobody explaining what any of it refers to.
It is strictly more defensible, it is shorter, and to a child it lands harder, because "nobody ever told it what any of it meant" is a sadder and more vivid image than "it understood none of it."
The wizard keeps the swagger and loses the liability.

**The two flat denials were replaced by concessions that still land the point.**
"It does not look things up. It does not ponder." became "Give it a library and it will fetch; give it time and it will work step by step."
This is the correction I would defend hardest after the one above, because the originals are the only sentences in the copy that a reader can personally falsify.
The rescued idea is better than the original idea: retrieval and step-by-step reasoning are things bolted *onto* the predictor, and the predictor is still what is running underneath.
That is both true and the actual conceptual payload of lesson one.

**"We hid words from it" became "We hid what came next."**
Same length, same rhythm, no longer describes masked language modelling.

**Post-training was added as one sentence: "Then we trained it again, by hand, to answer you rather than ramble on."**
This is what turns a text continuer into an assistant, and without it the reader has no account of why the thing responds to questions at all.
It also repairs "No wizard wrote its rules", which now reads as the setup to a two-stage story rather than a claim that humans are absent from the process.
"By hand" is doing the honest work: humans really are in that loop.

**"it knows what USUALLY comes next" became "it gives you what USUALLY follows."**
Removes the epistemic verb, removes the contradiction with card 1.

**"ten thousand times over" became "a trillion times over."**
A rare case where the poetic number and the true number are the same.
Frontier models are pre-trained on the order of ten trillion tokens, each one a prediction that got corrected.
The hyperbole is now literally an understatement, which is a nice property for a wizard's boast to have.

**One distractor was swapped, because the card edits broke the quiz.**
Card 1 now concedes that the machine can fetch from a library, which made the original distractor "Looks the answer up in a great library" partly true.
It is replaced by "Remembers every page it has ever read", which is false in a way the cards support: the machine kept no pages, only the habit the pages left behind.
The question gained the word "underneath" to point the reader at the sentence that answers it.

## Left simplified on purpose

- **"read very nearly everything."** Kept. Poetic overstatement inside quotation marks the voice has already earned. Correcting it to "a large filtered slice of the public web" would cost thirty characters and teach nothing lesson one needs.
- **"read" as a verb for a machine.** Anthropomorphic, kept anyway. It is the load-bearing metaphor and every alternative is either longer or more mysterious.
- **Calibration nuance on the final line.** Models are not uniformly overconfident; in some formats they are well calibrated, and the confident wrongness is partly an artifact of how they are scored. True, and far too fine-grained for the first card a newcomer ever sees.
- **Tokens, not words.** "What comes next" is a token, not a word. Deliberately deferred to the "What is an LLM?" lesson, per the brief.
- **What "corrected it" actually means.** Gradient descent on cross-entropy loss. "Corrected" is the right altitude here.

## Trade-offs the author should rule on personally

**1. Whether conceding retrieval and reasoning weakens the lesson.**
I think it strengthens it, because the underlying claim survives the concession and a claim that survives a concession is more persuasive than one that dodges it.
But it does cost the crispness of three short denials in a row, which was good prose.
If the author would rather not spend the words, the fallback is to *delete* the denials rather than replace them, and say nothing about search or reasoning at all.
Silence is honest; the current assertion is not.

**2. Whether "was told what none of it means" is too soft.**
The file's own doc comment says the wizard hat is what buys "understood none of it."
I disagree that the hat can buy it, because the hat does not make a contested empirical claim settled, and a practitioner reading it will file the lesson under hype-in-the-other-direction.
But this is the author's voice and the author's call, and it is the one place where the kid-friendly and expert-proof goals genuinely pull apart.
My recommendation is the softer line; the reasoning is that it is the only version that costs nothing and risks nothing.

**3. The keyword test now pins the word "guess."**
`cards.test.ts` requires the literal strings `guess` and `next` in the reading and in the correct answer.
That was a sound guard against the copy drifting away from the quiz, and it happens to be compatible with this revision, so nothing needs to change today.
But it does mean the word choice this review just examined is now enforced by a test rather than by a decision.
If the author ever does want to move to "predicts", the test is the second edit, and it should be loosened to accept either verb rather than deleted.

## Sources

Settled, cited for the mechanism and the training story:

- Brown et al., [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165). GPT-3 as "an autoregressive language model with 175 billion parameters"; the autoregressive, next-token family the cards are describing.
- Devlin et al., [BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding](https://arxiv.org/abs/1810.04805). The masked, bidirectional family the phrase "hid words from it" evokes, and which the cards should not be describing.
- Ouyang et al., [Training language models to follow instructions with human feedback](https://arxiv.org/abs/2203.02155). "Making language models bigger does not inherently make them better at following a user's intent." The basis for claim 10.
- DeepSeek-AI, [DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning](https://arxiv.org/abs/2501.12948). Emergent "self-reflection, verification, and dynamic strategy adaptation." The basis for claim 5.
- Anthropic, [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool). "The web search tool gives Claude direct access to real-time web content." The basis for claim 4.
- Grattafiori et al., [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783). Scale reference for claim 2 and for "a trillion times over."

Contested, cited on both sides, and presented as contested:

- Bender and Koller, [Climbing towards NLU: On Meaning, Form, and Understanding in the Age of Data](https://aclanthology.org/2020.acl-main.463/). "A system trained only on form has a priori no way to learn meaning." The case *for* "understood none of it."
- Li et al., [Emergent World Representations: Exploring a Sequence Model Trained on a Synthetic Task](https://arxiv.org/abs/2210.13382). "Evidence of an emergent nonlinear internal representation of the board state", controllable by intervention. The case *against*.
- Vafa et al., [Evaluating the World Model Implicit in a Generative Model](https://arxiv.org/abs/2406.03689). Models "do well on existing diagnostics for assessing world models, but our evaluation metrics reveal their world models to be far less coherent than they appear." The case for neither extreme, and the reason the copy should describe the training signal rather than the inner life.

Cited on the final line's nuance:

- Kadavath et al., [Language Models (Mostly) Know What They Know](https://arxiv.org/abs/2207.05221). "Larger models are well-calibrated on diverse multiple choice and true/false questions when they are provided in the right format."
- Kalai et al., [Why Language Models Hallucinate](https://arxiv.org/abs/2509.04664). "Training and evaluation procedures reward guessing over acknowledging uncertainty." Note the vocabulary: the word the author doubted is the word the literature uses.
- Turpin et al., [Language Models Don't Always Say What They Think](https://arxiv.org/abs/2305.04388). Chain-of-thought explanations "can systematically misrepresent the true reason for a model's prediction", which is why claim 5's concession is worded as "work step by step" rather than as thinking.
