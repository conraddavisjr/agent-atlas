# The instructor's voice

Two mp3s, baked once on a developer's machine and committed.
`npm run bake:voice` regenerates them and rewrites `src/audio/voiceManifest.ts`.

## Why it is baked rather than spoken in the browser

**The Web Speech API takes its voice inventory from the player's operating system.**
"A British wizard" becomes "whatever this machine happens to have installed", which differs per player, per OS and per browser version.
For a project whose measurement harness exists because it could not tell when things had stopped working, a voice that is different for every listener and identical in every screenshot is the worst available fit.
It also fails silently: `speechSynthesis.speak()` with no matching voice resolves without error and produces nothing.

**Kokoro in the browser** means shipping ONNX weights at 45 to 80 MB, `onnxruntime-web`, and a grapheme-to-phoneme front end on top.
Fifty to ninety megabytes of download, on a static site, to say two sentences.

**Two committed files are about 100 KB together**, decode everywhere, are byte-identical for every player forever, work offline, and fail by returning 404 - which is a thing you can assert on.

## Running it

```sh
npm run bake:voice
```

The first run builds a virtualenv under `tools/voice/.venv` and installs `mlx-audio` and `misaki[en]` into it.
Both are large. The venv is gitignored and the bake is not part of `npm run build`.

### espeak-ng is required, and the bundled one is broken

Kokoro needs phonemes, `misaki[en]` is the official front end, and it falls back to espeak-ng for anything outside its lexicon.

The `espeak-ng` that ships inside the `espeakng-loader` wheel **does not work on macOS**: it has a CI build path compiled into the dylib and aborts the process on load, with

```
Error processing file '/Users/runner/work/espeakng-loader/.../espeak-ng-data/phontab': No such file or directory.
```

So the bake wants a real one:

```sh
arch -arm64 brew install espeak-ng
```

and then points the loader at it by symlink, which `bake.mjs` does for you.
It reports which library it used rather than degrading quietly.

## The voice

`bm_george` at speed 1.0.

Kokoro has four British male voices and two are a clear step above the others on published quality: `bm_george` and `bm_fable`.
Between those two the choice is about age, and it is a choice about the copy rather than about the audio.
`cards.ts` is explicit that the wizard exists so that "an explanation which admits to being a performance can be blunter than one pretending to be a textbook" - and bluntness is licensed by age.
`bm_fable` is an even, warm audiobook narrator. A narrator explains; a wizard performs.

Measured, both lines, at speed 1.0:

| voice | line 1 | line 2 |
| --- | --- | --- |
| `bm_fable` | 3.83 s | 4.55 s |
| `bm_george` | 4.03 s | 5.15 s |

George is 10% slower than fable at the same nominal speed, and an unhurried delivery is most of what reads as age - so it gets there without being slowed down, which matters because slowing a voice stretches its artifacts along with everything else.

**Do not ship speed 0.9.** It is available as a lever if george sounds hurried against the wizard's bob, and it costs 0.7 s of extra preamble. But a wizard who has been slowed down to sound old sounds slowed down.

## What the manifest is for

The bake writes a generated TypeScript module rather than a JSON file beside the audio.
Three consequences, and the third is the point:

- `tsc` catches a missing entry, so a half-baked manifest is a build error.
- There is no second network request, and no fetch that can fail on its own.
- **The mp3s can 404 and the round is unchanged apart from the sound**, because the beat lengths come from the manifest, which is compiled in, and never from the audio element.

The manifest records the voice, the speed, the measured duration and **a hash of the exact `spoken` string each file was rendered from**.
That hash is the middle link of the chain described in `cards.ts`: edit the subtitle and a normalisation test fails, edit the spoken form and the hash test fails, re-bake and an existence test confirms the files are there.
