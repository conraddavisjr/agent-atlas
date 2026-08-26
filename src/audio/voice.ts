import { VOICE } from './voiceManifest'

/**
 * The instructor's voice: two baked lines, decoded once, played on a phase edge.
 *
 * ## This module is allowed to fail. The round is not.
 *
 * Everything here is optional decoration on a round that must be complete
 * without it. The beats' lengths come from `voiceManifest.ts`, which is compiled
 * into the bundle and cannot 404; nothing in the script ever asks this module how
 * long a line is, whether it is playing, or whether it finished. A player who
 * declines sound, or whose browser refuses it, or whose mp3s are missing, gets
 * the same round frame for frame - same beats, same subtitles, for the same
 * length of time.
 *
 * That is one decision and it buys three things. There is no `onended` in the
 * timing path, so a slow network cannot stretch a beat and a failed fetch cannot
 * hang one. The mute toggle is safe to press mid-sentence, because nothing was
 * synchronised to the sound. And the whole round can be captured and reviewed
 * with audio off at the shipping timings, so a critique round is photographing
 * the real thing.
 *
 * ## Why it reports six states and not a boolean
 *
 * A blocked context, a 404, a corrupt file, a declined gate, a muted tab and a
 * player with the volume down all present to the eye as silence. This project's
 * memory is that its defects are the ones that report nothing, and an audio path
 * is unusually good at reporting nothing. `state()` is exposed on `__dev.audio()`
 * for exactly that reason.
 *
 * ## `AudioContext` rather than `<audio>` elements
 *
 * One unlock covers everything rather than one per element, `stop()` is exact
 * rather than a pause, and the decoded buffer carries its own `duration` - which
 * is what the DEV assertion below checks the manifest against. That assertion
 * catches the worst version of a stale bake: the file is present, decodes fine,
 * and is the wrong take.
 */

export type VoiceState =
  /** No gesture has reached us yet. The context does not exist. */
  | 'locked'
  /** Ready, or already playing. */
  | 'unlocked'
  /** A gesture happened and the browser still refused. The gate offers a retry. */
  | 'blocked'
  /** The player chose silence. */
  | 'declined'
  /** A file 404ed. */
  | 'missing'
  /** A file arrived and would not decode. */
  | 'corrupt'

type Loaded = { buffer: AudioBuffer }

let context: AudioContext | null = null
let state: VoiceState = 'locked'
let loaded: (Loaded | null)[] = []
let playing: AudioBufferSourceNode | null = null
let loading: Promise<void> | null = null

/** Everything, so a replay or a hot reload starts from a known place. */
export function reset() {
  stop()
  loaded = []
  loading = null
  if (state !== 'blocked') state = context ? 'unlocked' : 'locked'
}

export function voiceState(): VoiceState {
  return state
}

export function decline() {
  stop()
  state = 'declined'
}

/**
 * Create and resume the context, synchronously, from inside a user gesture.
 *
 * **It has to be synchronous and it has to be inside the gesture's own call
 * stack.** Chrome and Firefox are satisfied by sticky activation, which persists
 * for the life of the document; Safari wants the `resume()` to happen in the
 * handler itself. Deferring it to the scene that mounts 650 ms later fails on
 * Safari and looks like a browser bug.
 *
 * There are two gestures that reach this. The audio gate's own button, which is a
 * click and is therefore reliable everywhere - that is the path a first-time
 * player takes. And the E press at the totem, for a returning player who has
 * already chosen sound and should not be asked twice.
 */
export function unlock(): VoiceState {
  if (state === 'declined') return state
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        state = 'blocked'
        return state
      }
      context = new Ctor()
    }
    /*
      `resume()` returns a promise and we deliberately do not await it here: the
      synchronous CALL is what the gesture requirement is about, and awaiting
      would move the state write out of the handler for no benefit. The promise's
      rejection is still handled, because a rejected one that nobody catches is an
      unhandled rejection in the console for every blocked player.
    */
    void context.resume().catch(() => {
      state = 'blocked'
    })
    state = context.state === 'suspended' ? 'blocked' : 'unlocked'
    return state
  } catch {
    state = 'blocked'
    return state
  }
}

/**
 * Fetch and decode both lines.
 *
 * Idempotent, and safe to call before the context exists - a decode needs the
 * context, so this waits for one rather than creating one, because creating an
 * `AudioContext` outside a gesture is what leaves a suspended context lying
 * around that later refuses to resume.
 */
export function preload(): Promise<void> {
  if (loading) return loading
  if (!context) return Promise.resolve()
  const ctx = context
  loading = Promise.all(
    VOICE.lines.map(async (line, index) => {
      try {
        const res = await fetch(line.file)
        if (!res.ok) {
          console.error(`[voice] ${line.file} returned ${res.status}`)
          state = 'missing'
          return
        }
        const bytes = await res.arrayBuffer()
        let buffer: AudioBuffer
        try {
          buffer = await ctx.decodeAudioData(bytes)
        } catch (err) {
          /*
            Caught separately from the fetch on purpose. A corrupt file and a
            missing one are different problems that present as the same silence,
            and telling them apart is the difference between re-running the bake
            and checking the deploy.
          */
          console.error(`[voice] ${line.file} would not decode`, err)
          state = 'corrupt'
          return
        }
        if (import.meta.env.DEV && Math.abs(buffer.duration - line.duration) > 0.03) {
          /*
            **The assertion that catches the worst kind of stale bake:** the file
            is present, decodes fine, and is the wrong take - re-rendered at a
            different speed or in a different voice while the manifest was not
            regenerated. Every beat in the round is then timed for audio that no
            longer exists, and nothing else would ever say so.

            mp3 carries encoder delay and padding, so a few milliseconds of head
            silence is expected and 30 ms is the tolerance rather than a bug.
          */
          console.error(
            `[voice] ${line.file} is ${buffer.duration.toFixed(3)}s but the manifest says ` +
              `${line.duration}s. Re-run \`npm run bake:voice\`.`,
          )
        }
        loaded[index] = { buffer }
      } catch (err) {
        console.error(`[voice] ${line.file} could not be fetched`, err)
        state = 'missing'
      }
    }),
  ).then(() => undefined)
  return loading
}

/**
 * Speak one line, cutting off whatever was speaking.
 *
 * Silently does nothing when there is no context, no buffer or no permission,
 * which is the one place in this module that failing quietly is right: by the
 * time a phase edge asks for a line, the reason it cannot have one has already
 * been logged once by `unlock` or `preload`, and logging it again on every beat
 * would bury it.
 */
export function speak(index: number) {
  if (state === 'declined' || !context) return
  const entry = loaded[index]
  if (!entry) return
  stop()
  const source = context.createBufferSource()
  source.buffer = entry.buffer
  source.connect(context.destination)
  source.start()
  playing = source
}

/**
 * Stop immediately.
 *
 * Called on the edge out of a speech beat, on bail, and on unmount. Without it
 * the wizard talks over the diorama's arrival whenever a player presses Skip,
 * which is the most likely thing a player does to a preamble.
 */
export function stop() {
  if (!playing) return
  try {
    playing.stop()
  } catch {
    // Already stopped, or never started. Nothing to do and nothing to report.
  }
  playing.disconnect()
  playing = null
}

/** For `__dev.audio()`. Reports rather than guesses. */
export function voiceReport() {
  return {
    state,
    voice: VOICE.voice,
    lang: VOICE.lang,
    speed: VOICE.speed,
    contextState: context?.state ?? null,
    decoded: VOICE.lines.map((line, i) => ({
      file: line.file,
      manifest: line.duration,
      decoded: loaded[i] ? +loaded[i]!.buffer.duration.toFixed(3) : null,
    })),
  }
}
