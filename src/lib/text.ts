import type { Gloss } from "./types";

/**
 * Sentence splitting and word segmentation — ported from the design canvas.
 *
 * The sentence splitters are what make the three-way alignment work: the
 * Japanese, romaji and English blocks are split independently, and line N of
 * one is assumed to be line N of the others. That assumption holds only if the
 * translator preserves sentence count, which is why the API route asks for it
 * explicitly.
 */

/** Split Japanese on 。！？ (and ASCII !? / newlines), keeping the punctuation. */
export function splitJp(text: string): string[] {
  const out = String(text ?? "").match(/[^。！？!?\n]+[。！？!?]*/g) ?? [];
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Split Latin-script text on .!? keeping trailing quotes/brackets attached. */
export function splitLatin(text: string): string[] {
  const out = String(text ?? "").match(/[^.!?\n]+[.!?]*[”"』」]?/g) ?? [];
  return out.map((s) => s.trim()).filter(Boolean);
}

/** One run of characters inside a sentence — either plain text or a glossed word. */
export type Segment =
  | { kind: "plain"; text: string }
  | { kind: "word"; text: string; gloss: Gloss };

/**
 * Split a Japanese sentence into plain runs and tappable glossed words.
 *
 * Matching is literal substring matching, exactly as the canvas did it — a
 * gloss listed in dictionary form (見える) will not light up a conjugated
 * occurrence (見えました). Glosses are tried longest-first so that a short
 * entry cannot claim characters belonging to a longer one.
 */
export function segment(jp: string, words: Gloss[]): Segment[] {
  let parts: Segment[] = [{ kind: "plain", text: jp }];

  const ordered = [...(words ?? [])]
    .filter((w) => w && w.jp)
    .sort((a, b) => b.jp.length - a.jp.length);

  for (const word of ordered) {
    const next: Segment[] = [];

    for (const part of parts) {
      // Already claimed by an earlier (longer) gloss — leave it alone.
      if (part.kind === "word") {
        next.push(part);
        continue;
      }

      const bits = part.text.split(word.jp);
      bits.forEach((bit, i) => {
        if (bit) next.push({ kind: "plain", text: bit });
        if (i < bits.length - 1) next.push({ kind: "word", text: word.jp, gloss: word });
      });
    }

    parts = next;
  }

  return parts;
}

/** Initials for the inbox avatar square — "Amano Konoa" becomes "AK". */
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("");
}

/** The design's unread pill copy: caps display at "99+". */
export function unreadLabel(count: number): string {
  return `${count > 99 ? "99+" : count} new`;
}
