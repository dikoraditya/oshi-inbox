"use client";

import { useState } from "react";

import type { LearnCard } from "@/lib/types";

type Rating = "again" | "good" | "easy";

/**
 * The spaced-repetition review deck. Shows one due card at a time: the word,
 * then (on reveal) its reading + gloss and three grade buttons. Grading removes
 * the card from the caller's due list, so the next one slides in.
 */
export function ReviewView({
  cards,
  onGrade,
  onBack,
}: {
  cards: LearnCard[];
  onGrade: (word: string, rating: Rating) => void;
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
          <div className="viewhead-meta">{cards.length} due</div>
        </div>
      </div>

      <div className="scroll editor-scroll">
        {!card ? (
          <div className="empty">
            Nothing due. Open a thread and tap a highlighted word → “Study” to add it here.
          </div>
        ) : (
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
        )}
      </div>
    </>
  );
}
