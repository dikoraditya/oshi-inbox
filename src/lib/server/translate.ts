import "server-only";

import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The SDK's zod helper is built against zod v4; zod 3.25+ ships it on this subpath.
import * as z from "zod/v4";

import { splitJp } from "@/lib/text";
import type { TranslationResult } from "@/lib/types";

/**
 * Turns a Japanese message into romaji, English, and tappable word glosses.
 *
 * Shared by the interactive /api/translate route and the Gmail webhook, so an
 * ingested mail and a hand-captured one get identical treatment.
 */

/** The longest seed message is ~200 chars; this is generous headroom. */
export const MAX_INPUT_CHARS = 4000;

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

/** The API rejected the call for lack of credit/billing. Distinct so the
 * pipeline can leave the message pending (retryable) and pause the drain
 * instead of scarring every thread with a 400. */
export class TranslationBillingError extends TranslationError {
  constructor(message: string) {
    super(message, 402);
    this.name = "TranslationBillingError";
  }
}

const GlossSchema = z.object({
  jp: z.string().describe("The word exactly as it appears in the source text"),
  romaji: z.string().describe("Romaji reading of this word"),
  gloss: z.string().describe("Short English gloss, a few words at most"),
});

const TranslationSchema = z.object({
  romaji: z.string().describe("Full romaji transliteration, same sentence count as the source"),
  en: z.string().describe("Natural English translation, same sentence count as the source"),
  words: z.array(GlossSchema).describe("Notable vocabulary worth glossing"),
});

const SYSTEM = `You translate short messages that Japanese idols send to fans, for a reader who is learning Japanese.

Three rules govern the output:

1. SENTENCE ALIGNMENT. The reading view numbers sentences and shows Japanese, romaji and English side by side, line for line. Your romaji and English must contain exactly the same number of sentences as the Japanese, in the same order, split at the same points. Never merge two Japanese sentences into one English one, and never split one into two. If a Japanese sentence is a bare interjection, the corresponding English sentence is still its own sentence.

2. VERBATIM WORD FORMS. Each entry in "words" is rendered by finding that exact substring in the Japanese text and underlining it. So "jp" must be a substring that appears in the source **exactly as written** — the inflected surface form, not the dictionary form. If the text says 見えました, the entry is 見えました, not 見える. An entry that does not appear verbatim is silently dropped, so it is wasted.

3. VOICE. These are casual, warm, often playful messages. Keep contractions, emoji, trailing marks (〜, ー, ♡, ！！) and the informal register. Do not sanitise slang or clipped spellings — translate them and, where the playfulness is the point, note it in the gloss.

For romaji use Hepburn with macrons (ō, ū). Leave emoji in place in all three fields.

Choose 1–6 words to gloss: the ones a learner would actually stumble on — kanji compounds, idioms, slang, clipped forms. Skip trivially common particles and greetings unless the form itself is unusual.`;

function buildPrompt(jp: string): string {
  const count = splitJp(jp).length;
  const plural = count === 1 ? "" : "s";
  return [
    `Japanese message (${count} sentence${plural}):`,
    "",
    jp,
    "",
    `Your romaji and English must each contain exactly ${count} sentence${plural}, aligned one-to-one with the Japanese above.`,
  ].join("\n");
}

export async function translateJapanese(input: string): Promise<TranslationResult> {
  const jp = input.trim();

  if (!jp) throw new TranslationError("Nothing to translate.", 400);
  if (jp.length > MAX_INPUT_CHARS) {
    throw new TranslationError(
      `Message is ${jp.length} characters; the limit is ${MAX_INPUT_CHARS}.`,
      413,
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new TranslationError(
      "ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env.local.",
      500,
    );
  }

  const client = new Anthropic();

  // Model and extended thinking are configurable so the backlog can run on a
  // cheap model (e.g. TRANSLATE_MODEL=claude-haiku-4-5). Thinking is off by
  // default — it multiplies output tokens and short DMs do not need it.
  const model = process.env.TRANSLATE_MODEL ?? "claude-opus-5";
  const thinking = process.env.TRANSLATE_THINKING === "1";

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: thinking ? 16000 : 4000,
      ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(jp) }],
      output_config: { format: zodOutputFormat(TranslationSchema) },
    });

    // Safety classifiers can decline with HTTP 200 — check before reading content.
    if (response.stop_reason === "refusal") {
      throw new TranslationError("The model declined to translate this message.", 422);
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new TranslationError(
        "The model returned a response that did not match the expected shape.",
        502,
      );
    }

    // Drop glosses that are not verbatim substrings — they would never render,
    // and keeping them would make the "N words tappable" hint lie.
    return {
      romaji: parsed.romaji,
      en: parsed.en,
      words: parsed.words.filter((word) => word.jp && jp.includes(word.jp)),
    };
  } catch (error) {
    if (error instanceof TranslationError) throw error;

    // Most specific first — RateLimitError and AuthenticationError extend APIError.
    if (error instanceof RateLimitError) {
      throw new TranslationError("Rate limited — try again shortly.", 429);
    }
    if (error instanceof AuthenticationError) {
      throw new TranslationError("ANTHROPIC_API_KEY was rejected.", 401);
    }
    if (error instanceof APIConnectionError) {
      throw new TranslationError("Could not reach the Claude API.", 503);
    }
    if (error instanceof APIError) {
      // Out of credit: a 400 invalid_request whose message is about billing.
      if (/credit balance|Plans & Billing|billing/i.test(error.message || "")) {
        throw new TranslationBillingError(error.message);
      }
      throw new TranslationError(error.message, error.status ?? 502);
    }

    console.error("[translate] unexpected failure", error);
    throw new TranslationError("Translation failed.", 500);
  }
}
