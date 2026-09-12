"use client";

import { useMemo, useState } from "react";

import { LongReader, type ReaderParagraph } from "@/components/LongReader";
import { segment, splitJp, splitLatin } from "@/lib/text";
import type { Gloss } from "@/lib/types";

import data from "./data.json";

/**
 * THROWAWAY demo: the same long idol email rendered two ways —
 *   "Current" reproduces the inbox card (whole-body split, clamp to 2 sentences)
 *   "Proposed" is the per-paragraph LongReader.
 * Delete this route (and data.json) once reviewed.
 */

const COLLAPSED = 2;

/** Faithful reproduction of the current MessageCard rendering for a long body. */
function CurrentCard({
  jp,
  romaji,
  en,
  words,
}: {
  jp: string;
  romaji: string;
  en: string;
  words: Gloss[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showEn, setShowEn] = useState(false);

  const jpS = useMemo(() => splitJp(jp), [jp]);
  const roS = useMemo(() => splitLatin(romaji), [romaji]);
  const enS = useMemo(() => splitLatin(en), [en]);

  const long = jp.length > 90;
  const shown = long && !expanded ? Math.min(COLLAPSED, jpS.length) : jpS.length;
  const hidden = jpS.length - shown;

  return (
    <article className="msg">
      <div className="msg-label">
        <div className="lbl-source">Mobile Mail</div>
        <div className="lbl-rule" aria-hidden="true" />
        <div className="lbl-time">21:40</div>
      </div>
      <div className="msg-body">
        <div>
          <div className="block block--jp">
            {jpS.slice(0, shown).map((s, i) => (
              <div className="lr-sent" key={i}>
                <span className="lr-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="lr-lines">
                  <div className="lr-jp" lang="ja">
                    {segment(s, words).map((part, j) =>
                      part.kind === "plain" ? (
                        <span key={j}>{part.text}</span>
                      ) : (
                        <button type="button" className="word" key={j}>
                          {part.text}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="lr-ro">{roS[i] ?? ""}</div>
                  {showEn && <div className="lr-en">{enS[i] ?? ""}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="msg-actions">
            {long && (
              <button type="button" className="act" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Collapse" : `Read more · +${hidden}`}
              </button>
            )}
            <button type="button" className="act act--en" onClick={() => setShowEn((v) => !v)}>
              {showEn ? "Hide English" : "Show English"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ReaderDemo() {
  const whole = data.whole as { jp: string; romaji: string; en: string; words: Gloss[] };
  const paragraphs = data.paragraphs as ReaderParagraph[];

  return (
    <main className="stage">
      <div className="phone">
        <div className="scroll">
          <div className="roster-head">
            <h1 className="inbox-title">Reader trial</h1>
            <div className="roster-sub">One long email · two renderings</div>
          </div>

          <div className="demo-sec">
            <div className="grouphead">
              <div className="kicker">Current — inbox card</div>
              <div className="meta">clamps to {COLLAPSED}</div>
            </div>
            <CurrentCard jp={whole.jp} romaji={whole.romaji} en={whole.en} words={whole.words} />
          </div>

          <div className="demo-sec">
            <div className="grouphead grouphead--alert">
              <div className="kicker">Proposed — long reader</div>
              <div className="meta">per paragraph</div>
            </div>
            <LongReader paragraphs={paragraphs} />
          </div>

          <div style={{ height: 24 }} />
        </div>
      </div>
    </main>
  );
}
