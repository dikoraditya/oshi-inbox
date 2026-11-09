"use client";

/**
 * Japanese text-to-speech over the browser's SpeechSynthesis API — zero infra,
 * no network, no API cost. Used in the reading view so a line can be heard, not
 * just read: the other half of learning to read a language you can't yet hear.
 *
 * The API is quirky: voices load asynchronously (and sometimes only after the
 * first `getVoices()` call), and a long utterance can stall unless the previous
 * one is cancelled first. Both are handled here so callers just call `speak`.
 */

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Cache the best ja-JP voice once it's available; voices arrive lazily. */
let jaVoice: SpeechSynthesisVoice | null = null;

function pickJaVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  if (jaVoice) return jaVoice;
  const voices = window.speechSynthesis.getVoices();
  // Prefer an explicit ja-JP voice; fall back to anything tagged Japanese.
  jaVoice =
    voices.find((v) => v.lang === "ja-JP") ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("ja")) ??
    null;
  return jaVoice;
}

// Warm the voice list as soon as the module loads on the client, and again when
// the browser finishes populating it.
if (speechSupported()) {
  pickJaVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    jaVoice = null;
    pickJaVoice();
  };
}

/**
 * Speak Japanese text aloud. Cancels any in-flight utterance first so taps don't
 * queue up. `onState` reports play/stop so the caller can toggle a button.
 * Returns a stop function. A no-op (returning a no-op) where unsupported.
 */
export function speak(text: string, onState?: (speaking: boolean) => void): () => void {
  const trimmed = text.trim();
  if (!trimmed || !speechSupported()) {
    onState?.(false);
    return () => {};
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(trimmed);
  utter.lang = "ja-JP";
  const voice = pickJaVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.95; // a hair slower — this is a reading aid, not a newsreader
  utter.onend = () => onState?.(false);
  utter.onerror = () => onState?.(false);

  onState?.(true);
  synth.speak(utter);

  return () => {
    synth.cancel();
    onState?.(false);
  };
}

/** Stop whatever is currently being spoken. */
export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
