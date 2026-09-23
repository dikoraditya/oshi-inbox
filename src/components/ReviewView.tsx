"use client";

import { useState } from "react";

import type { LearnCard } from "@/lib/types";

type Rating = "again" | "good" | "easy";
type NewWord = { jp: string; romaji: string; gloss: string };

/**
 * The Study screen: a spaced-repetition review deck up top, then a "New words"
 * list — glossed vocab you've encountered but not yet marked known, each with
 * one-tap Know (dismiss) or Study (add to the deck).
 */
export function ReviewView({
  cards,
  newWords,
  knownCount,
  onGrade,
  onStudy,
  onKnow,
  onBack,
}: {
  cards: LearnCard[];
  newWords: NewWord[];
  knownCount: number;
  onGrade: (word: string, rating: Rating) => void;
  onStudy: (word: string, reading: string, gloss: string) => void;
  onKnow: (word: string, reading: string, gloss: string) => void;
  onBack: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const card = cards[0];

  function grade(rating: Rating) {
    if (!card) return;
    setRevealed(false);
    onGrade(card.word, rating);
  }

  return (
    <>
      <div className="viewhead">
        <button type="button" className="backbtn" onClick={onBack} aria-label="Back to inbox">
          ←
        </button>
        <div className="viewhead-text">
          <h1 className="viewhead-title">Study</h1>
          <div className="viewhead-meta">
            {knownCount} known · {cards.length} due · {newWords.length} new
          </div>
        </div>
      </div>

      <div className="scroll editor-scroll">
        {card ? (
          <div className="field review-card">
            <div className="review-word" lang="ja">
              {card.word}
            </div>
            {revealed ? (
              <>
                <div className="review-reading">{card.reading}</div>
                <div className="review-gloss">{card.gloss}</div>
                <div className="chiprow">
                  <button type="button" className="btn btn-secondary" onClick={() => grade("again")}>
                    Again
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => grade("good")}>
                    Good
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => grade("easy")}>
                    Easy
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>
                Show reading
              </button>
            )}
          </div>
        ) : (
          <div className="field">
            <div className="drop-sub">No cards due. Add some from “New words” below, or tap a word in a thread.</div>
          </div>
        )}

        {newWords.length > 0 && (
          <div className="field">
            <div className="kicker">New words · {newWords.length}</div>
            {newWords.slice(0, 40).map((word) => (
              <div key={word.jp} className="newword">
                <span className="newword-jp" lang="ja">
                  {word.jp}
                </span>
                <span className="newword-ro">{word.romaji}</span>
                <span className="newword-gloss">{word.gloss}</span>
                <span className="newword-acts">
                  <button
                    type="button"
                    className="pop-act pop-act--ink"
                    onClick={() => onKnow(word.jp, word.romaji, word.gloss)}
                  >
                    Know
                  </button>
                  <button
                    type="button"
                    className="pop-act pop-act--ink"
                    onClick={() => onStudy(word.jp, word.romaji, word.gloss)}
                  >
                    Study
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
