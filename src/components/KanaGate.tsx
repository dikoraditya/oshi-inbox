"use client";

import { useMemo, useState } from "react";

/**
 * Tofugu-style kana warm-up gate. You can "Learn by 5" (study a small group, then
 * type-drill just that group, re-drilling only misses) across the whole set, then
 * clear a final all-kana typed quiz to open the inbox. Answers are TYPED (romaji),
 * not multiple choice; a wrong answer shows the correct one and re-queues that
 * kana so you only retry failures. Scope: gojūon 46 + yōon combos, both scripts.
 */

type Kana = { k: string; r: string };
type Group = { title: string; cells: Kana[] };

const H_GOJUON: Kana[][] = [
  [{ k: "あ", r: "a" }, { k: "い", r: "i" }, { k: "う", r: "u" }, { k: "え", r: "e" }, { k: "お", r: "o" }],
  [{ k: "か", r: "ka" }, { k: "き", r: "ki" }, { k: "く", r: "ku" }, { k: "け", r: "ke" }, { k: "こ", r: "ko" }],
  [{ k: "さ", r: "sa" }, { k: "し", r: "shi" }, { k: "す", r: "su" }, { k: "せ", r: "se" }, { k: "そ", r: "so" }],
  [{ k: "た", r: "ta" }, { k: "ち", r: "chi" }, { k: "つ", r: "tsu" }, { k: "て", r: "te" }, { k: "と", r: "to" }],
  [{ k: "な", r: "na" }, { k: "に", r: "ni" }, { k: "ぬ", r: "nu" }, { k: "ね", r: "ne" }, { k: "の", r: "no" }],
  [{ k: "は", r: "ha" }, { k: "ひ", r: "hi" }, { k: "ふ", r: "fu" }, { k: "へ", r: "he" }, { k: "ほ", r: "ho" }],
  [{ k: "ま", r: "ma" }, { k: "み", r: "mi" }, { k: "む", r: "mu" }, { k: "め", r: "me" }, { k: "も", r: "mo" }],
  [{ k: "や", r: "ya" }, { k: "ゆ", r: "yu" }, { k: "よ", r: "yo" }],
  [{ k: "ら", r: "ra" }, { k: "り", r: "ri" }, { k: "る", r: "ru" }, { k: "れ", r: "re" }, { k: "ろ", r: "ro" }],
  [{ k: "わ", r: "wa" }, { k: "を", r: "wo" }, { k: "ん", r: "n" }],
];

const H_COMBOS: Kana[][] = [
  [{ k: "きゃ", r: "kya" }, { k: "きゅ", r: "kyu" }, { k: "きょ", r: "kyo" }],
  [{ k: "しゃ", r: "sha" }, { k: "しゅ", r: "shu" }, { k: "しょ", r: "sho" }],
  [{ k: "ちゃ", r: "cha" }, { k: "ちゅ", r: "chu" }, { k: "ちょ", r: "cho" }],
  [{ k: "にゃ", r: "nya" }, { k: "にゅ", r: "nyu" }, { k: "にょ", r: "nyo" }],
  [{ k: "ひゃ", r: "hya" }, { k: "ひゅ", r: "hyu" }, { k: "ひょ", r: "hyo" }],
  [{ k: "みゃ", r: "mya" }, { k: "みゅ", r: "myu" }, { k: "みょ", r: "myo" }],
  [{ k: "りゃ", r: "rya" }, { k: "りゅ", r: "ryu" }, { k: "りょ", r: "ryo" }],
  [{ k: "ぎゃ", r: "gya" }, { k: "ぎゅ", r: "gyu" }, { k: "ぎょ", r: "gyo" }],
  [{ k: "じゃ", r: "ja" }, { k: "じゅ", r: "ju" }, { k: "じょ", r: "jo" }],
  [{ k: "びゃ", r: "bya" }, { k: "びゅ", r: "byu" }, { k: "びょ", r: "byo" }],
  [{ k: "ぴゃ", r: "pya" }, { k: "ぴゅ", r: "pyu" }, { k: "ぴょ", r: "pyo" }],
];

const KATA_MAP: Record<string, string> = {
  "あ": "ア", "い": "イ", "う": "ウ", "え": "エ", "お": "オ", "か": "カ", "き": "キ", "く": "ク", "け": "ケ", "こ": "コ",
  "さ": "サ", "し": "シ", "す": "ス", "せ": "セ", "そ": "ソ", "た": "タ", "ち": "チ", "つ": "ツ", "て": "テ", "と": "ト",
  "な": "ナ", "に": "ニ", "ぬ": "ヌ", "ね": "ネ", "の": "ノ", "は": "ハ", "ひ": "ヒ", "ふ": "フ", "へ": "ヘ", "ほ": "ホ",
  "ま": "マ", "み": "ミ", "む": "ム", "め": "メ", "も": "モ", "や": "ヤ", "ゆ": "ユ", "よ": "ヨ", "ら": "ラ", "り": "リ",
  "る": "ル", "れ": "レ", "ろ": "ロ", "わ": "ワ", "を": "ヲ", "ん": "ン",
  "ぎ": "ギ", "じ": "ジ", "び": "ビ", "ぴ": "ピ", "ゃ": "ャ", "ゅ": "ュ", "ょ": "ョ",
};

function toKatakana(rows: Kana[][]): Kana[][] {
  return rows.map((row) =>
    row.map((cell) => ({
      k: [...cell.k].map((ch) => KATA_MAP[ch] ?? ch).join(""),
      r: cell.r,
    })),
  );
}

function groupsFrom(script: string, rows: Kana[][]): Group[] {
  return rows.map((cells) => ({ title: `${script} · ${cells.map((c) => c.k).join(" ")}`, cells }));
}

const GROUPS: Group[] = [
  ...groupsFrom("Hiragana", H_GOJUON),
  ...groupsFrom("Hiragana combos", H_COMBOS),
  ...groupsFrom("Katakana", toKatakana(H_GOJUON)),
  ...groupsFrom("Katakana combos", toKatakana(H_COMBOS)),
];
const ALL: Kana[] = GROUPS.flatMap((g) => g.cells);

/** Accept common romaji variants (Kunrei/typing shortcuts) → the canonical form. */
const ROMAJI_ALT: Record<string, string> = {
  si: "shi", ti: "chi", tu: "tsu", hu: "fu", zi: "ji", nn: "n",
  sya: "sha", syu: "shu", syo: "sho", tya: "cha", tyu: "chu", tyo: "cho",
  zya: "ja", zyu: "ju", zyo: "jo", jya: "ja", jyu: "ju", jyo: "jo",
};

function normalize(input: string): string {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  return ROMAJI_ALT[s] ?? s;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A typed drill over a set; re-queues misses; calls onComplete when the queue clears. */
function Drill({ set, label, onComplete }: { set: Kana[]; label: string; onComplete: () => void }) {
  const [queue, setQueue] = useState<Kana[]>(() => shuffle(set));
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<{ kana: string; answer: string } | null>(null);
  const current = queue[0];

  function submit() {
    if (!current || !value.trim()) return;
    if (normalize(value) === current.r) {
      const next = queue.slice(1);
      setFeedback(null);
      setQueue(next);
      setValue("");
      if (next.length === 0) onComplete();
    } else {
      // Wrong: flash the correct answer and send this kana to the back to retry.
      setFeedback({ kana: current.k, answer: current.r });
      setQueue([...queue.slice(1), current]);
      setValue("");
    }
  }

  if (!current) return null;
  const remaining = queue.length;

  return (
    <div className="field">
      <div className="kicker">
        {label} · {remaining} left
      </div>
      <div className="kana-quiz-glyph" lang="ja">
        {current.k}
      </div>
      {feedback && (
        <div className="drop-sub" style={{ color: "var(--color-accent-700)" }}>
          missed: {feedback.kana} = {feedback.answer}
        </div>
      )}
      <input
        className="input"
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="type romaji, Enter"
        aria-label="Romaji answer"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div className="chiprow">
        <button type="button" className="btn btn-primary" onClick={submit}>
          Check
        </button>
      </div>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: Kana[][] }) {
  return (
    <div className="field">
      <div className="kicker">{title}</div>
      <div className="kana-grid">
        {rows.flat().map((cell, i) => (
          <div key={i} className="kana-cell">
            <span className="kana-glyph" lang="ja">
              {cell.k}
            </span>
            <span className="kana-romaji">{cell.r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KanaGate({ onPass }: { onPass: () => void }) {
  const [phase, setPhase] = useState<"start" | "learn" | "final" | "done">("start");
  const [groupIndex, setGroupIndex] = useState(0);
  const [sub, setSub] = useState<"study" | "drill">("study");
  const kata = useMemo(() => toKatakana(H_GOJUON), []);

  function nextGroup() {
    if (groupIndex + 1 < GROUPS.length) {
      setGroupIndex(groupIndex + 1);
      setSub("study");
    } else {
      setPhase("final");
    }
  }

  return (
    <div className="scroll editor-scroll">
      <div className="field">
        <h1 className="inbox-title">Warm-up</h1>
        <div className="drop-sub">Learn a few at a time, then clear the full typed quiz to open your inbox.</div>
      </div>

      {phase === "start" && (
        <>
          <Table title="Hiragana ひらがな" rows={H_GOJUON} />
          <Table title="Katakana カタカナ" rows={kata} />
          <div className="field">
            <div className="drop-sub">Combos (きゃ, しゃ, …) are included in the drills.</div>
            <div className="chiprow">
              <button type="button" className="btn btn-secondary" onClick={() => { setGroupIndex(0); setSub("study"); setPhase("learn"); }}>
                Learn by 5
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPhase("final")}>
                Quiz all → unlock
              </button>
            </div>
          </div>
        </>
      )}

      {phase === "learn" && sub === "study" && (
        <div className="field">
          <div className="kicker">
            {GROUPS[groupIndex].title} · {groupIndex + 1}/{GROUPS.length}
          </div>
          <div className="kana-grid">
            {GROUPS[groupIndex].cells.map((cell, i) => (
              <div key={i} className="kana-cell">
                <span className="kana-glyph" lang="ja">
                  {cell.k}
                </span>
                <span className="kana-romaji">{cell.r}</span>
              </div>
            ))}
          </div>
          <div className="chiprow">
            <button type="button" className="btn btn-primary" onClick={() => setSub("drill")}>
              Quiz these
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPhase("final")}>
              Skip to full quiz
            </button>
          </div>
        </div>
      )}

      {phase === "learn" && sub === "drill" && (
        <Drill
          key={`g${groupIndex}`}
          set={GROUPS[groupIndex].cells}
          label={GROUPS[groupIndex].title}
          onComplete={nextGroup}
        />
      )}

      {phase === "final" && (
        <Drill key="final" set={ALL} label="Full quiz" onComplete={() => setPhase("done")} />
      )}

      {phase === "done" && (
        <div className="field">
          <div className="kicker">Passed</div>
          <div className="kana-quiz-glyph">✓</div>
          <button type="button" className="btn btn-primary" onClick={onPass}>
            Open inbox
          </button>
        </div>
      )}
    </div>
  );
}
