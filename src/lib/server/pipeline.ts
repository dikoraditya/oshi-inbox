import "server-only";

import {
  getMessage,
  markTranslationFailed,
  markTranslationPending,
  saveTranslation,
} from "./db";
import { translateJapanese, TranslationBillingError, TranslationError } from "./translate";

/**
 * Translate one stored message and write the result back.
 *
 * Never throws: this runs from `after()` and from cron. Returns the outcome so
 * the drain can stop early: "ok" translated (or nothing to do), "failed" a real
 * error recorded on the row, "paused" out of credit — left pending (retryable),
 * with no error scarring the thread, signalling the caller to stop.
 */
export async function runTranslation(messageId: string): Promise<"ok" | "failed" | "paused"> {
  try {
    const message = await getMessage(messageId);
    if (!message) return "ok";
    // Media-only messages (e.g. a Weverse photo) have no text to translate —
    // settle them as done with an empty translation so they leave the queue.
    if (!message.jp.trim()) {
      await saveTranslation(messageId, { romaji: "", en: "", words: [] });
      return "ok";
    }

    await markTranslationPending(messageId);
    const result = await translateJapanese(message.jp);

    // Re-read: the message may have been edited or deleted while we waited.
    const fresh = await getMessage(messageId);
    if (!fresh || fresh.jp !== message.jp) return "ok";

    await saveTranslation(messageId, result);
    return "ok";
  } catch (error) {
    if (error instanceof TranslationBillingError) {
      // Out of credit — keep it pending so it retries once topped up, and don't
      // write the billing message onto the row (it would show in the thread).
      try {
        await markTranslationPending(messageId);
      } catch (writeError) {
        console.error("[pipeline] could not reset to pending", writeError);
      }
      return "paused";
    }
    const reason =
      error instanceof TranslationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Translation failed.";
    try {
      await markTranslationFailed(messageId, reason);
    } catch (writeError) {
      console.error("[pipeline] could not record failure", writeError);
    }
    return "failed";
  }
}
