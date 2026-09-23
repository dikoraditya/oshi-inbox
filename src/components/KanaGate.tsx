"use client";

import { useMemo, useState } from "react";

/**
 * A study gate: shows the hiragana + katakana gojūon tables, then a short
 * multiple-choice quiz you must pass before the inbox opens. Passing is recorded
 * for the day by the caller, so it's a once-a-day warm-up rather than every load.
 */

type Kana = { k: string; r: string };
type Row = (Kana | null)[];

const HIRAGANA: Row[] = [
  [{ k: "あ", r: "a" }, { k: "い", r: "i" }, { k: "う", r: "u" }, { k: "え", r: "e" }, { k: "お", r: "o" }],
  [{ k: "か", r: "ka" }, { k: "き", r: "ki" }, { k: "く", r: "ku" }, { k: "け", r: "ke" }, { k: "こ", r: "ko" }],
  [{ k: "さ", r: "sa" }, { k: "し", r: "shi" }, { k: "す", r: "su" }, { k: "せ", r: "se" }, { k: "そ", r: "so" }],
  [{ k: "た", r: "ta" }, { k: "ち", r: "chi" }, { k: "つ", r: "tsu" }, { k: "て", r: "te" }, { k: "と", r: "to" }],
  [{ k: "な", r: "na" }, { k: "に", r: "ni" }, { k: "ぬ", r: "nu" }, { k: "ね", r: "ne" }, { k: "の", r: "no" }],
  [{ k: "は", r: "ha" }, { k: "ひ", r: "hi" }, { k: "ふ", r: "fu" }, { k: "へ", r: "he" }, { k: "ほ", r: "ho" }],
  [{ k: "ま", r: "ma" }, { k: "み", r: "mi" }, { k: "む", r: "mu" }, { k: "め", r: "me" }, { k: "も", r: "mo" }],
  [{ k: "や", r: "ya" }, null, { k: "ゆ", r: "yu" }, null, { k: "よ", r: "yo" }],
  [{ k: "ら", r: "ra" }, { k: "り", r: "ri" }, { k: "る", r: "ru" }, { k: "れ", r: "re" }, { k: "ろ", r: "ro" }],
  [{ k: "わ", r: "wa" }, null, null, null, { k: "を", r: "wo" }],
  [{ k: "ん", r: "n" }, null, null, null, null],
];

const KATAKANA: Row[] = [
  [{ k: "ア", r: "a" }, { k: "イ", r: "i" }, { k: "ウ", r: "u" }, { k: "エ", r: "e" }, { k: "オ", r: "o" }],
  [{ k: "カ", r: "ka" }, { k: "キ", r: "ki" }, { k: "ク", r: "ku" }, { k: "ケ", r: "ke" }, { k: "コ", r: "ko" }],
  [{ k: "サ", r: "sa" }, { k: "シ", r: "shi" }, { k: "ス", r: "su" }, { k: "セ", r: "se" }, { k: "ソ", r: "so" }],
  [{ k: "タ", r: "ta" }, { k: "チ", r: "chi" }, { k: "ツ", r: "tsu" }, { k: "テ", r: "te" }, { k: "ト", r: "to" }],
  [{ k: "ナ", r: "na" }, { k: "ニ", r: "ni" }, { k: "ヌ", r: "nu" }, { k: "ネ", r: "ne" }, { k: "ノ", r: "no" }],
  [{ k: "ハ", r: "ha" }, { k: "ヒ", r: "hi" }, { k: "フ", r: "fu" }, { k: "ヘ", r: "he" }, { k: "ホ", r: "ho" }],
  [{ k: "マ", r: "ma" }, { k: "ミ", r: "mi" }, { k: "ム", r: "mu" }, { k: "メ", r: "me" }, { k: "モ", r: "mo" }],
  [{ k: "ヤ", r: "ya" }, null, { k: "ユ", r: "yu" }, null, { k: "ヨ", r: "yo" }],
  [{ k: "ラ", r: "ra" }, { k: "リ", r: "ri" }, { k: "ル", r: "ru" }, { k: "レ", r: "re" }, { k: "ロ", r: "ro" }],
  [{ k: "ワ", r: "wa" }, null, null, null, { k: "ヲ", r: "wo" }],
  [{ k: "ン", r: "n" }, null, null, null, null],
];

const POOL: Kana[] = [...HIRAGANA, ...KATAKANA].flat().filter((c): c is Kana => c !== null);
const QUESTIONS = 12;
const PASS = 10;

type Question = { kana: string; answer: string; options: string[] };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQuiz(): Question[] {
  return shuffle(POOL)
    .slice(0, QUESTIONS)
    .map((q) => {
      const distractors = shuffle(POOL.filter((p) => p.r !== q.r)).slice(0, 3);
      return { kana: q.k, answer: q.r, options: shuffle([...distractors, q]).map((o) => o.r) };
    });
}

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="field">
      <div className="kicker">{title}</div>
      <div className="kana-grid">
        {rows.flat().map((cell, i) =>
          cell ? (
            <div key={i} className="kana-cell">
              <span className="kana-glyph" lang="ja">
                {cell.k}
              </span>
              <span className="kana-romaji">{cell.r}</span>
            </div>
          ) : (
            <div key={i} className="kana-cell kana-cell--empty" aria-hidden="true" />
          ),
        )}
      </div>
    </div>
  );
}

export function KanaGate({ onPass }: { onPass: () => void }) {
  const [mode, setMode] = useState<"learn" | "quiz">("learn");
  const [quiz, setQuiz] = useState<Question[]>(buildQuiz);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const finished = index >= quiz.length;

  const passed = useMemo(() => finished && score >= PASS, [finished, score]);

  function answer(option: string) {
    if (picked) return;
    setPicked(option);
    if (option === quiz[index].answer) setScore((s) => s + 1);
    setTimeout(() => {
      setPicked(null);
      setIndex((i) => i + 1);
    }, 550);
  }

  function reset(next: "learn" | "quiz") {
    setQuiz(buildQuiz());
    setIndex(0);
    setScore(0);
    setPicked(null);
    setMode(next);
  }

  return (
    <div className="scroll editor-scroll">
      <div className="field">
        <h1 className="inbox-title">Warm-up</h1>
        <div className="drop-sub">Read the kana, then pass a quick quiz to open your inbox.</div>
      </div>

      {mode === "learn" && (
        <>
          <Table title="Hiragana ひらがな" rows={HIRAGANA} />
          <Table title="Katakana カタカナ" rows={KATAKANA} />
          <div className="field">
            <button type="button" className="btn btn-primary" onClick={() => setMode("quiz")}>
              Start quiz
            </button>
          </div>
        </>
      )}

      {mode === "quiz" && !finished && (
        <div className="field">
          <div className="kicker">
            Question {index + 1} / {quiz.length} · score {score}
          </div>
          <div className="kana-quiz-glyph" lang="ja">
            {quiz[index].kana}
          </div>
          <div className="kana-quiz-opts">
            {quiz[index].options.map((option) => {
              const state = picked
                ? option === quiz[index].answer
                  ? "correct"
                  : option === picked
                    ? "wrong"
                    : ""
                : "";
              return (
                <button
                  key={option}
                  type="button"
                  className="kana-opt"
                  data-state={state}
                  disabled={picked !== null}
                  onClick={() => answer(option)}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {finished && (
        <div className="field">
          <div className="kicker">{passed ? "Passed" : "Not yet"}</div>
          <div className="kana-quiz-glyph">
            {score} / {quiz.length}
          </div>
          {passed ? (
            <button type="button" className="btn btn-primary" onClick={onPass}>
              Open inbox
            </button>
          ) : (
            <>
              <div className="drop-sub">You need {PASS} to pass. Review the tables and try again.</div>
              <div className="chiprow">
                <button type="button" className="btn btn-secondary" onClick={() => reset("learn")}>
                  Back to tables
                </button>
                <button type="button" className="btn btn-primary" onClick={() => reset("quiz")}>
                  Retry quiz
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
