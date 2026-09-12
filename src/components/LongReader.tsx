"use client";

import { useMemo, useState } from "react";

import { segment, splitJp, splitLatin } from "@/lib/text";
import type { Gloss } from "@/lib/types";

/**
 * A reading layout built for long mail rather than one-line DMs.
 *
 * The card view splits the whole body once and assumes line N of the romaji and
 * English match line N of the Japanese — fine for a three-sentence DM, fragile
 * for a fifteen-sentence email, where one merged sentence misaligns everything
 * after it. Here each paragraph is translated on its own, so alignment is
 * guaranteed *within* a paragraph and any drift can never cross a blank line.
 * Paragraph structure survives, and the whole thing is a scrollable reader
 * instead of a two-sentence clamp with a "read more".
 */

export interface ReaderParagraph {
  jp: string;
  romaji: string;
  en: string;
  words: Gloss[];
}

interface Sentence {
  key: string;
  n: number;
  jp: string;
  romaji: string;
  en: string;
  words: Gloss[];
}

export function LongReader({
  paragraphs,
  englishByDefault = false,
}: {
  paragraphs: ReaderParagraph[];
  englishByDefault?: boolean;
}) {
  const [showEn, setShowEn] = useState(englishByDefault);
  const [active, setActive] = useState<string | null>(null);
  const [openWord, setOpenWord] = useState<string | null>(null);

  // Flatten to numbered sentences, grouped by paragraph. Numbering is continuous
  // across the whole mail so the gutter reads as one document.
  const structured = useMemo(() => {
    let n = 0;
    return paragraphs.map((para, pi) => {
      const jp = splitJp(para.jp);
      const ro = splitLatin(para.romaji);
      const en = splitLatin(para.en);
      const sentences: Sentence[] = jp.map((sentence, si) => {
        n += 1;
        return {
          key: `p${pi}-s${si}`,
          n,
          jp: sentence,
          romaji: ro[si] ?? "",
          en: en[si] ?? "",
          words: para.words,
        };
      });
      return { key: `p${pi}`, sentences };
    });
  }, [paragraphs]);

  return (
    <div className="lr" onClick={() => setOpenWord(null)}>
      <div className="lr-toolbar">
        <span className="kicker">Mobile Mail · reader</span>
        <button type="button" className="act act--en" onClick={() => setShowEn((v) => !v)}>
          {showEn ? "Hide English" : "Show English"}
        </button>
      </div>

      {structured.map((para) => (
        <div className="lr-para" key={para.key}>
          {para.sentences.map((s) => {
            const isActive = active === s.key;
            return (
              <div
                key={s.key}
                className={`lr-sent${isActive ? " is-active" : ""}`}
                onClick={() => setActive((cur) => (cur === s.key ? null : s.key))}
              >
                <span className="lr-num" aria-hidden="true">
                  {s.n}
                </span>
                <div className="lr-lines">
                  <div className="lr-jp" lang="ja">
                    {segment(s.jp, s.words).map((part, i) => {
                      if (part.kind === "plain") return <span key={i}>{part.text}</span>;
                      const id = `${s.key}-w${i}`;
                      const open = openWord === id;
                      return (
                        <span className="wordwrap" key={i}>
                          {open && (
                            <span className="pop" role="tooltip">
                              <span className="pop-romaji">{part.gloss.romaji}</span>
                              <span className="pop-gloss">{part.gloss.gloss}</span>
                            </span>
                          )}
                          <button
                            type="button"
                            className="word"
                            aria-expanded={open}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenWord((cur) => (cur === id ? null : id));
                            }}
                          >
                            {part.text}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="lr-ro">{s.romaji}</div>
                  {showEn && <div className="lr-en">{s.en}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
