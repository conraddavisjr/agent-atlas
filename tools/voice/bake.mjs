// Renders everything the instructor says with Kokoro, and writes the manifest.
//
//   npm run bake:voice
//
// Offline, run by hand, and its output is committed. See ./README.md for why the
// audio is baked rather than synthesised in the browser, and for the espeak-ng
// trap on macOS.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const VENV = join(HERE, '.venv')
const PY = join(VENV, 'bin', 'python')
const SPEAK = join(HERE, 'speak.py')
const OUT_AUDIO = join(ROOT, 'public', 'voice')
const OUT_MANIFEST = join(ROOT, 'src', 'audio', 'voiceManifest.ts')

const MODEL = 'mlx-community/Kokoro-82M-bf16'

/**
 * The voice.
 *
 * The third British voice tried, and the reason it is the third is worth writing
 * down rather than repeating: `bm_george` shipped first and read weary,
 * `bm_fable` replaced it and read too synthetic. `bm_lewis` is the next male
 * British voice in the set.
 *
 * **The honest caveat is that voice selection may not be the lever here.** Kokoro
 * is an 82M-parameter model - tiny, fast, and cheap to bake - and every voice in
 * it shares that ceiling. Kokoro's own published grades put `fable` and `george`
 * at C and `lewis` at D+, so this is a change of timbre rather than a step up in
 * quality. If the round wants a genuinely more natural read, the change is the
 * MODEL, not the voice, and the trade is documented in ./README.md: the bigger
 * local models do not expose per-phoneme durations, so the word highlighting
 * would need a forced aligner at bake time.
 */
const VOICE = 'bm_lewis'
const SPEED = 1.0

/**
 * British English phonemes, and this is not optional for a British voice.
 *
 * Without it Kokoro logs `Language mismatch, loading bm_fable voice into American
 * English pipeline` and carries on - a WARNING, on stderr, in a tool whose output
 * nobody reads twice. The voice embedding stays British and the phonemes it is
 * asked to produce are American, so the wizard says "ANN-ser" and "SKRAWLS" in an
 * English accent, which is the uncanny half-and-half you get from a dialect coach
 * who left halfway through. The first bake shipped exactly that.
 */
const LANG = 'b'

const BREW_LIB = '/opt/homebrew/lib/libespeak-ng.dylib'
const BREW_DATA = '/opt/homebrew/share/espeak-ng-data'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

/**
 * Everything the wizard says, read out of the source rather than duplicated.
 *
 * A regex over TypeScript is normally a bad idea and it is safe in this one
 * place, because it cannot fail quietly: the manifest records a hash of whatever
 * this extracts, and `voice.test.ts` compares those hashes against the real
 * exports. If the regex ever grabs the wrong thing the test goes red rather than
 * the wizard saying something nobody wrote.
 *
 * It refuses rather than guessing when the shape changes, because a bake that
 * silently produces half the lines is worse than one that stops.
 */
function readScript() {
  const source = readFileSync(join(ROOT, 'src/game/training/cards.ts'), 'utf8')

  const lineBlock = source.match(
    /export const INSTRUCTOR_LINES: readonly InstructorLine\[\] = \[([\s\S]*?)\n\]/,
  )
  if (!lineBlock) throw new Error('bake:voice: could not find INSTRUCTOR_LINES in cards.ts')
  const lines = [...lineBlock[1].matchAll(/spoken:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+)/g)].map((m) =>
    joinLiteral(m[1]),
  )
  if (lines.length !== 2) {
    throw new Error(
      `bake:voice: expected 2 instructor lines, found ${lines.length}. ` +
        'The shape of INSTRUCTOR_LINES changed; fix this extractor rather than the data.',
    )
  }

  /*
    The card segments. Each entry is `shown:` with an optional `spoken:` after
    it, and the spoken form wins when present - the same rule `segmentSpoken`
    applies at runtime.
  */
  const cardBlock = source.match(/export const CARDS: readonly Card\[\] = \[([\s\S]*?)\n\]\n/)
  if (!cardBlock) throw new Error('bake:voice: could not find CARDS in cards.ts')
  const segments = [
    ...cardBlock[1].matchAll(
      /shown:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+),(?:\s*\/\*[\s\S]*?\*\/)?\s*(?:spoken:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+),)?/g,
    ),
  ].map((m) => joinLiteral(m[2] ?? m[1]))
  if (segments.length !== 6) {
    throw new Error(
      `bake:voice: expected 6 card segments (2 cards x 3), found ${segments.length}. ` +
        'The shape of CARDS changed; fix this extractor rather than the data.',
    )
  }

  /*
    The quiz question. The wizard reads it aloud when the cube brings it in - it
    is the one thing in the round the player is asked to answer, and having it
    arrive in silence after two narrated cards made the beat feel like the voice
    had given up rather than like the lesson had changed gear.
  */
  const question = source.match(/spokenQuestion:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+),/)
  if (!question) throw new Error('bake:voice: could not find spokenQuestion in cards.ts')

  return { lines, segments, question: joinLiteral(question[1]) }
}

/** `'a' + 'b'` in the source is one string here. */
function joinLiteral(fragment) {
  return [...fragment.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\'/g, "'"))
    .join('')
}

/** Build the venv on first run. Both packages are large; this is not quick. */
function ensureVenv() {
  if (existsSync(PY)) return
  console.log('bake:voice: creating tools/voice/.venv (this takes a few minutes)')
  run('python3.11', ['-m', 'venv', VENV])
  run(PY, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'])
  run(PY, ['-m', 'pip', 'install', 'mlx-audio', 'misaki[en]', 'soundfile'])
}

/**
 * Point `espeakng_loader` at a working espeak-ng.
 *
 * The one inside the wheel has a CI build path compiled into it and ABORTS THE
 * PROCESS on load rather than raising - so this is not an optimisation, it is the
 * difference between the bake running and the bake dying with a message about a
 * directory on somebody else's build machine. See ./README.md.
 */
function fixEspeak() {
  const pkg = join(VENV, 'lib', 'python3.11', 'site-packages', 'espeakng_loader')
  if (!existsSync(pkg)) throw new Error('bake:voice: espeakng_loader is not installed')
  if (!existsSync(BREW_LIB)) {
    throw new Error(
      `bake:voice: ${BREW_LIB} is missing.\n` +
        '  Kokoro needs a phonemiser and the one bundled in the wheel is broken on macOS.\n' +
        '  Install a working one:  arch -arm64 brew install espeak-ng',
    )
  }
  for (const name of ['libespeak-ng.dylib', 'libespeak-ng.1.dylib', 'libespeak-ng.1.52.0.dylib']) {
    const at = join(pkg, name)
    rmSync(at, { force: true })
    symlinkSync(BREW_LIB, at)
  }
  const data = join(pkg, 'espeak-ng-data')
  rmSync(data, { force: true, recursive: true })
  symlinkSync(BREW_DATA, data)
  console.log(`bake:voice: phonemiser ${BREW_LIB}`)
}

const durationOf = (file) =>
  +Number(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      file,
    ])
      .toString()
      .trim(),
  ).toFixed(3)

/** One clip: synthesise, take its word timings, encode, and measure the result. */
function render(text, stem) {
  console.log(`bake:voice: ${stem}  ${text.slice(0, 64)}${text.length > 64 ? '...' : ''}`)
  const wav = `${stem}.wav`
  const spoken = execFileSync(
    PY,
    [SPEAK, '--text', text, '--voice', VOICE, '--lang', LANG, '--speed', String(SPEED), '--out', wav, '--model', MODEL],
    { encoding: 'utf8' },
  )
  const timing = JSON.parse(spoken.trim().split('\n').pop())
  const mp3 = `${stem}.mp3`
  /*
    24 kHz mono at q4. Speech, not music: a fixed 64 kbps would roughly halve the
    file with nothing audible lost, and it is not worth a second encoding
    parameter that can silently differ from what the manifest describes.
  */
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', mp3])
  rmSync(wav, { force: true })
  return {
    duration: durationOf(mp3),
    words: timing.words.map((w) => ({
      text: w.text,
      start: +w.start.toFixed(3),
      end: +w.end.toFixed(3),
    })),
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  }
}

ensureVenv()
fixEspeak()
mkdirSync(OUT_AUDIO, { recursive: true })
mkdirSync(dirname(OUT_MANIFEST), { recursive: true })

const { lines, segments, question } = readScript()

const instructor = lines.map((text, i) => {
  const out = render(text, join(OUT_AUDIO, `instructor-${i}`))
  return { file: `/voice/instructor-${i}.mp3`, ...out }
})

const cardSegments = segments.map((text, i) => {
  const card = Math.floor(i / 3)
  const index = i % 3
  const out = render(text, join(OUT_AUDIO, `card-${card}-${index}`))
  return { file: `/voice/card-${card}-${index}.mp3`, card, index, ...out }
})

const quiz = { file: '/voice/question.mp3', ...render(question, join(OUT_AUDIO, 'question')) }

const manifest = `/*
  GENERATED by \`npm run bake:voice\`. Do not edit.

  A TypeScript module rather than a JSON file beside the audio, and that is the
  decision the whole timing contract rests on: this is compiled into the bundle,
  so it cannot 404. The mp3s can, and when they do the round is identical minus
  the sound - same beats, same subtitles, for the same length of time - because
  nothing about the script ever consults the audio.

  \`hash\` is of the spoken string each file was rendered from. \`voice.test.ts\`
  compares it against the copy, which is what makes it impossible to change the
  wizard's words and leave the audio saying the old ones.

  \`words\` comes from Kokoro's own per-phoneme duration prediction rather than
  from measuring the output or estimating from word length - see
  \`tools/voice/speak.py\`. The numbers are what the vocoder was TOLD to produce,
  so they are exact by construction.
*/

export type VoiceWord = {
  text: string
  /** Seconds from the start of this clip. */
  start: number
  end: number
}

export type VoiceClip = {
  /** Served from \`public/\`, so a root-relative URL rather than an import. */
  file: string
  /** Seconds, measured off the encoded file. */
  duration: number
  /** Every word, in order, with the time it is spoken. */
  words: readonly VoiceWord[]
  /** First 16 hex of sha256 over the exact spoken string. */
  hash: string
}

/** A card segment, which is one clause and the form that illustrates it. */
export type VoiceSegment = VoiceClip & { card: number; index: number }

export const VOICE = {
  voice: ${JSON.stringify(VOICE)},
  /** British English phonemes. Kokoro only WARNS if this disagrees with the voice. */
  lang: ${JSON.stringify(LANG)},
  /** Durations are only valid for the speed they were rendered at. */
  speed: ${SPEED},
  /** What the instructor says on the way in. */
  lines: ${JSON.stringify(instructor, null, 2).replace(/\n/g, '\n  ')} as const satisfies readonly VoiceClip[],
  /** The cards, narrated one clause at a time. */
  segments: ${JSON.stringify(cardSegments, null, 2).replace(/\n/g, '\n  ')} as const satisfies readonly VoiceSegment[],
  /** The quiz question, read when the board brings it in. */
  question: ${JSON.stringify(quiz, null, 2).replace(/\n/g, '\n  ')} as const satisfies VoiceClip,
} as const
`

writeFileSync(OUT_MANIFEST, manifest)
console.log(`bake:voice: wrote ${OUT_MANIFEST}`)
for (const clip of [...instructor, ...cardSegments, quiz]) {
  console.log(`  ${clip.file}  ${clip.duration}s  ${clip.words.length} words`)
}
