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
let segments: (Loaded | null)[] = []
let playing: AudioBufferSourceNode | null = null
let loading: Promise<void> | null = null

/** Everything, so a replay or a hot reload starts from a known place. */
export function reset() {
  stop()
  loaded = []
  segments = []
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
 * Undo a decline, because a player who muted is allowed to change their mind.
 *
 * **This is the whole of a shipped bug.** `decline()` set the state and `unlock()`
 * opened with `if (state === 'declined') return state` - so once somebody pressed
 * mute, `unlock()` became a no-op, the state stayed `'declined'` for the life of
 * the page, and `play()` refused every clip after it. Pressing the toggle again
 * set the preference back to `'on'`, lit the icon back up, and produced silence
 * forever. Nothing logged, because from the module's point of view it was doing
 * exactly what it had been told.
 *
 * Separate from `unlock()` rather than folded into it because `unlock()` needs a
 * `window` and a user gesture, and this needs neither - which is what lets
 * `voice.test.ts` cover the round trip without a DOM.
 */
export function allow() {
  if (state !== 'declined') return
  state = context ? 'unlocked' : 'locked'
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
  /*
    A gesture asking for sound is a gesture asking for sound, even from somebody
    who declined it earlier. This used to return early here and leave the module
    permanently mute - see `allow`.
  */
  allow()
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
  const decode = async (line: { file: string; duration: number }, into: (Loaded | null)[], index: number) => {
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
            **Two different failures land here and they have opposite remedies,
            which is why the message says both.**

            The one this was written for is a stale bake: the file is present,
            decodes fine, and is the wrong take - re-rendered at a different speed
            or in a different voice while the manifest was not regenerated. Every
            beat in the round is then timed for audio that no longer exists.

            The one it will actually catch first is a DECODER difference, and the
            original comment here had the number wrong. It said mp3 padding was "a
            few milliseconds"; the real figure for these files is **64 ms**, and
            the arithmetic is worth writing down because it is not obvious. At
            24 kHz these are MPEG-2 LSF frames, which carry **576** samples each
            rather than the 1152 of MPEG-1: `card-0-0.mp3` is 236 frames, so a
            decoder that ignores the Xing gapless tag returns
            `236 * 576 / 24000` = 5.664 s where the tag says 5.600.

            So the tolerance and the padding are cleanly separated - 0 ms if the
            tag is honoured, 64 ms if it is not, with 30 ms between them - and
            this is by accident a precise gapless-support detector with no false
            positives. What it must not do is send somebody to re-run the bake,
            because re-baking would produce a byte-identical file and the
            assertion would fire again.
          */
          const drift = buffer.duration - line.duration
          console.error(
            `[voice] ${line.file} decoded to ${buffer.duration.toFixed(3)}s but the manifest ` +
              `says ${line.duration}s.\n` +
              (Math.abs(drift - 0.064) < 0.02
                ? '  This browser is ignoring the mp3 gapless tag, so every word timing in ' +
                  'this clip will run about 46 ms late. It is a decoder difference, NOT a ' +
                  'stale bake - re-running `npm run bake:voice` would change nothing.'
                : '  The file and the manifest disagree by more than mp3 padding explains. ' +
                  'This is a stale bake: run `npm run bake:voice`.'),
          )
        }
        into[index] = { buffer }
      } catch (err) {
        console.error(`[voice] ${line.file} could not be fetched`, err)
        state = 'missing'
      }
  }

  loading = Promise.all([
    ...VOICE.lines.map((line, i) => decode(line, loaded, i)),
    /*
      The card narration is fetched with the instructor's lines rather than when a
      card comes up. Six clips is about 200 KB, and the alternative is a fetch
      landing in the middle of the beat it is meant to open - which on a slow
      connection is a form that starts in silence and gains a voice halfway
      through.
    */
    ...VOICE.segments.map((segment, i) => decode(segment, segments, i)),
  ]).then(() => undefined)
  return loading
}

/**
 * Speak one clause of a card.
 *
 * Indexed by card and position rather than by a flat number, so a caller cannot
 * accidentally narrate card 1's second clause over card 0's second form - which
 * is the kind of off-by-one that produces a round that sounds subtly wrong and
 * looks completely fine.
 */
export function speakSegment(card: number, index: number, offset = 0) {
  const at = VOICE.segments.findIndex((s) => s.card === card && s.index === index)
  if (at < 0) return
  play(segments[at], offset)
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
  play(loaded[index])
}

function play(entry: Loaded | null | undefined, offset = 0) {
  if (state === 'declined' || !context || !entry) return
  stop()
  const source = context.createBufferSource()
  source.buffer = entry.buffer
  source.connect(context.destination)
  /*
    `offset` is what makes un-muting mid-sentence land in the right place rather
    than restarting the clause. The round's clock does not pause for the audio -
    the beats are derived from the manifest and run whether anything is playing -
    so a clip resumed at zero would be a wizard half a sentence behind his own
    subtitle for the rest of the beat.
  */
  source.start(0, Math.max(0, Math.min(offset, entry.buffer.duration - 0.02)))
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
    decoded: [
      ...VOICE.lines.map((line, i) => ({
        file: line.file,
        manifest: line.duration,
        decoded: loaded[i] ? +loaded[i]!.buffer.duration.toFixed(3) : null,
      })),
      ...VOICE.segments.map((segment, i) => ({
        file: segment.file,
        manifest: segment.duration,
        decoded: segments[i] ? +segments[i]!.buffer.duration.toFixed(3) : null,
      })),
    ],
  }
}
