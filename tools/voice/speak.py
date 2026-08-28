"""
Render one line with Kokoro and report where every word falls.

Called by `bake.mjs`, which owns the rest of the pipeline. It exists as its own
file because the timings are the whole reason this is Python: `mlx-audio` runs
Kokoro's own pipeline, and that pipeline already computes per-word timestamps -
they just have nowhere to go unless a caller reaches in and takes them.

    python speak.py --text "..." --voice bm_fable --lang b --speed 1.0 --out x.wav

Writes the wav to --out and prints one JSON object on stdout:

    {"duration": 5.5, "words": [{"text": "Behold:", "start": 0.25, "end": 0.9}, ...]}

## Why the timings are taken rather than estimated

The obvious way to highlight words in time with speech is to divide the clip's
length among the words in proportion to how long they are. That is wrong in a way
that is very visible: `Behold` takes 0.575 s here and `of` takes 0.075, which is
a ratio of nearly eight where their letter counts differ by three. A proportional
estimate drifts within the first sentence and is a word or two out by the end of a
paragraph, which reads as the highlight lagging the voice.

Kokoro is a StyleTTS2-family model, so it predicts a DURATION per phoneme before
it generates any audio, and `KokoroPipeline` already folds those into per-token
timestamps via `join_timestamps`. The numbers are exact by construction: they are
what the vocoder was told to produce, not a measurement of what came out.
"""

import argparse
import json
import sys

import soundfile as sf
from mlx_audio.tts.models.kokoro import KokoroPipeline
from mlx_audio.tts.utils import load_model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--model", default="mlx-community/Kokoro-82M-bf16")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    model = load_model(args.model)
    pipeline = KokoroPipeline(
        lang_code=args.lang, model=model, repo_id=args.model
    )

    audio = None
    words = []
    for result in pipeline(args.text, voice=args.voice, speed=args.speed):
        if result.audio is None:
            continue
        audio = result.audio
        for token in result.tokens or []:
            start = getattr(token, "start_ts", None)
            end = getattr(token, "end_ts", None)
            if start is None or end is None:
                continue
            text = token.text
            if not text:
                continue
            # Punctuation arrives as its own token. Fold it onto the word it
            # belongs to, so a highlight covers "Behold:" rather than leaving a
            # colon behind to light up on its own.
            if not any(c.isalnum() for c in text) and words:
                words[-1]["text"] += text
                words[-1]["end"] = float(end)
                continue
            words.append({"text": text, "start": float(start), "end": float(end)})
        break

    if audio is None:
        print("speak.py: kokoro produced no audio", file=sys.stderr)
        return 1

    samples = audio.squeeze()
    sf.write(args.out, samples, SAMPLE_RATE)
    print(
        json.dumps(
            {"duration": round(len(samples) / SAMPLE_RATE, 3), "words": words}
        )
    )
    return 0


SAMPLE_RATE = 24000


if __name__ == "__main__":
    raise SystemExit(main())
