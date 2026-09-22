/**
 * Cost-aware bulk translate for a source's pending backlog.
 *
 *   npx tsx --env-file=.env.local scripts/translate-source.ts "≒JOY LINK"
 *   npx tsx --env-file=.env.local scripts/translate-source.ts "≒JOY LINK" --batch
 *   npx tsx --env-file=.env.local scripts/translate-source.ts all
 *
 * MUST run under NODE_OPTIONS=--conditions=react-server (server-only guards).
 *
 * Cost controls:
 *  - fill-from-done: a pending row whose exact text is already translated
 *    elsewhere is copied for free (no API call).
 *  - de-dup: identical text is translated once, then applied to every pending row
 *    that shares it (one UPDATE ... WHERE jp = ...).
 *  - --batch: submit the distinct texts through the Message Batches API (~50%
 *    cheaper, async) instead of live calls.
 *
 * Sync stops early on out-of-credit (TranslationBillingError); batch reports
 * per-request errors and leaves those rows pending.
 */
import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";

import { createSql, type Sql } from "../src/lib/server/sql";
import {
  buildPrompt,
  SYSTEM,
  TranslationSchema,
  translateJapanese,
  TranslationBillingError,
} from "../src/lib/server/translate";

type WordGloss = { jp?: string; romaji?: string; gloss?: string };
type TranslationOut = { romaji: string; en: string; words: WordGloss[] };

const args = process.argv.slice(2);
const useBatch = args.includes("--batch");
const source = args.find((a) => !a.startsWith("--"));
if (!source) {
  console.error('usage: translate-source "<source>" [--batch] [--since-days=N]   (source "all" = every source)');
  process.exit(1);
}

const sinceDaysRaw = args.find((a) => a.startsWith("--since-days="))?.split("=")[1];
const sinceDays = sinceDaysRaw && Number.isFinite(Number(sinceDaysRaw)) ? Number(sinceDaysRaw) : null;

const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || "4");
const MODEL = process.env.TRANSLATE_MODEL ?? "claude-haiku-4-5";
const BATCH_CHUNK = 10_000;
const sql = createSql();

/** Copy already-done translations onto identical-text pending rows — no API. */
async function fillFromDone(): Promise<number> {
  const rows = await sql.query(
    `update messages m
     set romaji = d.romaji, en = d.en, words = d.words, status = 'done', error = null
     from (
       select distinct on (jp) jp, romaji, en, words
       from messages where status = 'done' and length(trim(jp)) > 0
       order by jp, created_at desc
     ) d
     where m.status = 'pending' and length(trim(m.jp)) > 0 and m.jp = d.jp
       and ($1 = 'all' or m.source = $1)
     returning m.id`,
    [source],
  );
  return rows.length;
}

async function distinctPending(): Promise<string[]> {
  const rows = (await sql.query(
    `select distinct jp from messages
     where status = 'pending' and length(trim(jp)) > 0 and ($1 = 'all' or source = $1)
       and ($2::int is null or to_timestamp(created_at/1000) > now() - (($2::int)::text || ' days')::interval)`,
    [source, sinceDays],
  )) as Array<{ jp: string }>;
  return rows.map((r) => r.jp);
}

/** Write one translation to every pending row that shares this exact text. */
async function apply(dbc: Sql, jp: string, result: TranslationOut): Promise<void> {
  const words = result.words.filter((w) => w.jp && jp.includes(w.jp));
  await dbc.query(
    `update messages set romaji = $1, en = $2, words = $3::jsonb, status = 'done', error = null
     where jp = $4 and status = 'pending'`,
    [result.romaji, result.en, JSON.stringify(words), jp],
  );
}

async function runSync(texts: string[]): Promise<void> {
  let done = 0;
  let failed = 0;
  let paused = false;
  let next = 0;

  async function worker(): Promise<void> {
    while (!paused) {
      const index = next;
      next += 1;
      if (index >= texts.length) return;
      const jp = texts[index];
      try {
        await apply(sql, jp, await translateJapanese(jp));
        done += 1;
      } catch (error) {
        if (error instanceof TranslationBillingError) {
          paused = true;
          return;
        }
        failed += 1;
      }
      if ((done + failed) % 50 === 0) {
        console.log(`  ${done} done, ${failed} failed, ${texts.length - done - failed} left`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`sync finished: ${done} translated, ${failed} failed${paused ? " — PAUSED (out of credit)" : ""}`);
}

async function runBatch(texts: string[]): Promise<void> {
  const client = new Anthropic();
  // zod's JSON Schema is structurally an Anthropic tool input schema, but the two
  // library types don't unify — cross the boundary once, explicitly.
  const inputSchema = z.toJSONSchema(TranslationSchema) as unknown as Anthropic.Tool["input_schema"];
  const tool: Anthropic.Tool = {
    name: "emit_translation",
    description: "Return the aligned romaji, English, and word glosses.",
    input_schema: inputSchema,
  };

  let done = 0;
  let failed = 0;

  for (let start = 0; start < texts.length; start += BATCH_CHUNK) {
    const chunk = texts.slice(start, start + BATCH_CHUNK);
    const batch = await client.messages.batches.create({
      requests: chunk.map((jp, i) => ({
        custom_id: `m${i}`,
        params: {
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: "user", content: buildPrompt(jp) }],
          tools: [tool],
          tool_choice: { type: "tool", name: "emit_translation" },
        },
      })),
    });
    console.log(`batch ${batch.id}: ${chunk.length} requests submitted, polling…`);

    let status = batch;
    while (status.processing_status !== "ended") {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 20_000);
      await promise;
      status = await client.messages.batches.retrieve(batch.id);
      const c = status.request_counts;
      console.log(`  ${status.processing_status}: ${c.succeeded} ok, ${c.errored} err, ${c.processing} left`);
    }

    for await (const entry of await client.messages.batches.results(batch.id)) {
      const jp = chunk[Number(entry.custom_id.slice(1))];
      if (entry.result.type !== "succeeded") {
        failed += 1;
        continue;
      }
      const block = entry.result.message.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        failed += 1;
        continue;
      }
      // The model may still return a malformed object — validate before writing.
      const parsed = TranslationSchema.safeParse(block.input);
      if (!parsed.success) {
        failed += 1;
        continue;
      }
      await apply(sql, jp, parsed.data);
      done += 1;
    }
    console.log(`batch ${batch.id} applied: ${done} done, ${failed} failed so far`);
  }
  console.log(`batch finished: ${done} translated, ${failed} failed`);
}

async function main(): Promise<void> {
  const filled = await fillFromDone();
  console.log(`filled ${filled} from existing identical translations (free)`);

  const texts = await distinctPending();
  console.log(
    `${texts.length} distinct texts to translate for "${source}"${useBatch ? " (batch)" : ` (sync x${CONCURRENCY})`}`,
  );
  if (!texts.length) {
    console.log("nothing to do.");
    process.exit(0);
  }

  if (useBatch) await runBatch(texts);
  else await runSync(texts);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
