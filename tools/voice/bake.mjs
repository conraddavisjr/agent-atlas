// Renders the instructor's lines with Kokoro and writes the voice manifest.
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
const OUT_AUDIO = join(ROOT, 'public', 'voice')
const OUT_MANIFEST = join(ROOT, 'src', 'audio', 'voiceManifest.ts')

const MODEL = 'mlx-community/Kokoro-82M-bf16'
const VOICE = 'bm_george'
const SPEED = 1.0
/**
 * British English phonemes, and this is not optional for a British voice.
 *
 * Without it Kokoro logs `Language mismatch, loading bm_george voice into
 * American English pipeline` and carries on - a WARNING, on stderr, in a tool
 * whose output nobody reads twice. The voice embedding stays British and the
 * phonemes it is asked to produce are American, so the wizard says "ANN-ser" and
 * "SKRAWLS" in an English accent, which is the uncanny half-and-half you get from
 * a dialect coach who left halfway through.
 */
const LANG = 'b'

const BREW_LIB = '/opt/homebrew/lib/libespeak-ng.dylib'
const BREW_DATA = '/opt/homebrew/share/espeak-ng-data'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })

/**
 * The lines, read out of `cards.ts` rather than duplicated here.
 *
 * A regex over a TypeScript file is normally a bad idea and it is safe in this
 * one place, because it cannot fail quietly: the manifest records a hash of
 * whatever this extracts, and a unit test compares that hash against the real
 * `INSTRUCTOR_LINES[i].spoken`. If the regex ever grabs the wrong thing, the test
 * goes red rather than the wizard saying something nobody wrote.
 *
 * It still refuses rather than guessing when the shape changes, because a bake
 * that silently produces one line is worse than one that stops.
 */
function readSpokenLines() {
  const source = readFileSync(join(ROOT, 'src/game/training/cards.ts'), 'utf8')
  const block = source.match(
    /export const INSTRUCTOR_LINES: readonly InstructorLine\[\] = \[([\s\S]*?)\n\]/,
  )
  if (!block) throw new Error('bake:voice: could not find INSTRUCTOR_LINES in cards.ts')
  const lines = [...block[1].matchAll(/spoken:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1].replace(/\\'/g, "'"),
  )
  if (lines.length !== 2) {
    throw new Error(
      `bake:voice: expected 2 spoken lines in cards.ts, found ${lines.length}. ` +
        'The shape of INSTRUCTOR_LINES changed; fix this extractor rather than the data.',
    )
  }
  return lines
}

/** Build the venv on first run. Both packages are large; this is not quick. */
function ensureVenv() {
  if (existsSync(PY)) return
  console.log('bake:voice: creating tools/voice/.venv (this takes a few minutes)')
  run('python3.11', ['-m', 'venv', VENV])
  run(PY, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'])
  run(PY, ['-m', 'pip', 'install', 'mlx-audio', 'misaki[en]'])
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

function durationOf(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ])
  return +Number(out.toString().trim()).toFixed(3)
}

ensureVenv()
fixEspeak()
mkdirSync(OUT_AUDIO, { recursive: true })
mkdirSync(dirname(OUT_MANIFEST), { recursive: true })

const spoken = readSpokenLines()
const entries = []

spoken.forEach((text, index) => {
  const stem = join(OUT_AUDIO, `instructor-${index}`)
  console.log(`bake:voice: [${index}] ${text}`)
  run(PY, [
    '-m', 'mlx_audio.tts.generate',
    '--model', MODEL,
    '--text', text,
    '--voice', VOICE,
    '--speed', String(SPEED),
    '--lang_code', LANG,
    '--file_prefix', stem,
  ])
  const wav = `${stem}_000.wav`
  if (!existsSync(wav)) throw new Error(`bake:voice: kokoro produced no audio for line ${index}`)
  const mp3 = `${stem}.mp3`
  /*
    24 kHz mono at q4. Speech, not music: a fixed 64 kbps would roughly halve the
    file with nothing audible lost, and it is not worth a second encoding
    parameter that can silently differ from what the manifest describes.
  */
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', mp3])
  rmSync(wav, { force: true })
  entries.push({
    file: `/voice/instructor-${index}.mp3`,
    duration: durationOf(mp3),
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  })
})

const manifest = `/*
  GENERATED by \`npm run bake:voice\`. Do not edit.

  A TypeScript module rather than a JSON file beside the audio, and that is the
  decision the whole timing contract rests on: this is compiled into the bundle,
  so it cannot 404. The mp3s can, and when they do the round is identical minus
  the sound - same beats, same subtitles, for the same length of time - because
  nothing about the script ever consults the audio.

  \`hash\` is of the \`spoken\` string each file was rendered from. \`voice.test.ts\`
  compares it against \`INSTRUCTOR_LINES\`, which is what makes it impossible to
  change the wizard's words and leave the audio saying the old ones.
*/

export type VoiceLine = {
  /** Served from \`public/\`, so it is a root-relative URL rather than an import. */
  file: string
  /** Seconds, measured off the encoded file. The speech beat is derived from it. */
  duration: number
  /** First 16 hex of sha256 over the exact spoken string. */
  hash: string
}

export const VOICE = {
  voice: ${JSON.stringify(VOICE)},
  /** British English phonemes. Kokoro only WARNS if this disagrees with the voice. */
  lang: ${JSON.stringify(LANG)},
  /** Durations are only valid for the speed they were rendered at. */
  speed: ${SPEED},
  lines: ${JSON.stringify(entries, null, 2).replace(/\n/g, '\n  ')} as const satisfies readonly VoiceLine[],
} as const
`

writeFileSync(OUT_MANIFEST, manifest)
console.log(`bake:voice: wrote ${OUT_MANIFEST}`)
entries.forEach((e, i) => console.log(`  [${i}] ${e.file}  ${e.duration}s`))
