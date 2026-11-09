"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { MessagePhoto } from "./MessagePhoto";
import { segment, splitJp, splitLatin, type Segment } from "@/lib/text";
import { speak, speechSupported, stopSpeaking } from "@/lib/speech";
import type { Member, Message, Settings } from "@/lib/types";
import type { CosmFetchSummary } from "@/lib/store";

/**
 * The reading view.
 *
 * Japanese, romaji and English are split into sentences independently and lined
 * up by position. Two layouts share that alignment:
 *  - `stacked`      — three blocks (JP, romaji, EN) with one number gutter, the
 *                     design canvas's original; good for reading JP as prose.
 *  - `interleaved`  — one trio per sentence (JP, then its romaji and English),
 *                     so a sentence's meaning sits right under it with no hop.
 * The reading aid (romaji block / furigana ruby / kanji-only) and a font-size
 * scale are per-device settings, driven by the control bar at the top.
 */

/** Small Japanese text-to-speech button. `compact` renders the inline glyph. */
function SpeakButton({ text, label, compact }: { text: string; label: string; compact?: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState(false);

  // Support check touches `window`, so defer to the client to avoid a mismatch.
  useEffect(() => setAvailable(speechSupported()), []);
  // Stop speech if this button unmounts mid-utterance (e.g. layout switch).
  useEffect(() => () => stopSpeaking(), []);

  if (!available) return null;

  return (
    <button
      type="button"
      className={`${compact ? "speak" : "act act--speak"}${speaking ? " speak--on" : ""}`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
        } else {
          speak(text, setSpeaking);
        }
      }}
    >
      {compact ? (speaking ? "◼" : "♪") : speaking ? "◼ Stop" : "♪ Listen"}
    </button>
  );
}

/** The reading-preferences bar: layout, reading aid and text size. */
function ReadingControls({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const { readingLayout: layout, readingAid: aid, fontScale } = settings;

  const nudge = (delta: number) =>
    onUpdate({
      fontScale: Math.min(1.6, Math.max(0.85, Math.round((fontScale + delta) * 100) / 100)),
    });

  return (
    <div className="readbar">
      <div className="seg" role="group" aria-label="Reading layout">
        <button
          type="button"
          className="seg-btn"
          aria-pressed={layout === "stacked"}
          onClick={() => onUpdate({ readingLayout: "stacked" })}
        >
          Stacked
        </button>
        <button
          type="button"
          className="seg-btn"
          aria-pressed={layout === "interleaved"}
          onClick={() => onUpdate({ readingLayout: "interleaved" })}
        >
          Lines
        </button>
      </div>

      <div className="seg" role="group" aria-label="Reading aid">
        <button
          type="button"
          className="seg-btn"
          aria-pressed={aid === "romaji"}
          onClick={() => onUpdate({ readingAid: "romaji" })}
        >
          Romaji
        </button>
        <button
          type="button"
          className="seg-btn"
          aria-pressed={aid === "furigana"}
          onClick={() => onUpdate({ readingAid: "furigana" })}
        >
          Furigana
        </button>
        <button
          type="button"
          className="seg-btn"
          aria-pressed={aid === "kanji"}
          onClick={() => onUpdate({ readingAid: "kanji" })}
        >
          Kanji
        </button>
      </div>

      <div className="seg seg--size" role="group" aria-label="Text size">
        <button type="button" className="seg-btn" aria-label="Smaller text" onClick={() => nudge(-0.15)}>
          A−
        </button>
        <button type="button" className="seg-btn" aria-label="Larger text" onClick={() => nudge(0.15)}>
          A+
        </button>
      </div>
    </div>
  );
}

/** One row of a stacked block: optional number gutter plus content. */
function SentenceRow({
  n,
  aligned,
  active,
  onPick,
  contentClass,
  /** Interactive children (word buttons) forbid role="button" on the row itself. */
  hasNestedControls,
  children,
}: {
  n: number;
  aligned: boolean;
  active: boolean;
  onPick: () => void;
  contentClass: string;
  hasNestedControls?: boolean;
  children: ReactNode;
}) {
  const style = { "--cols": aligned ? "18px 1fr" : "1fr" } as CSSProperties;

  return (
    <div
      className="sent"
      style={style}
      data-active={active}
      onClick={onPick}
      {...(hasNestedControls
        ? {}
        : {
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick();
              }
            },
          })}
    >
      {aligned && <div className="sent-n">{n}</div>}
      <div className={contentClass}>{children}</div>
    </div>
  );
}

/**
 * The Japanese of one sentence: plain runs plus tappable glossed words. With
 * `furigana` on, each glossed word carries its romaji reading as ruby above it,
 * and the standalone romaji block is dropped by the caller.
 */
function JpContent({
  segments,
  rowId,
  furigana,
  openWord,
  knownWords,
  onPickWord,
  onKnow,
  onStudy,
}: {
  segments: Segment[];
  rowId: string;
  furigana: boolean;
  openWord: string | null;
  knownWords: Set<string>;
  onPickWord: (id: string) => void;
  onKnow: (word: string, reading: string, gloss: string) => void;
  onStudy: (word: string, reading: string, gloss: string) => void;
}) {
  return (
    <span lang="ja">
      {segments.map((part, partIndex) => {
        if (part.kind === "plain") {
          return <span key={partIndex}>{part.text}</span>;
        }
        const wordId = `${rowId}-${partIndex}`;
        const open = openWord === wordId;
        return (
          <span className="wordwrap" key={partIndex}>
            {open && (
              <span className="pop" role="tooltip">
                <span className="pop-romaji">{part.gloss.romaji}</span>
                <span className="pop-gloss">{part.gloss.gloss}</span>
                <span className="pop-actions">
                  <button
                    type="button"
                    className="pop-act"
                    onClick={(event) => {
                      event.stopPropagation();
                      onKnow(part.gloss.jp, part.gloss.romaji, part.gloss.gloss);
                    }}
                  >
                    Know
                  </button>
                  <button
                    type="button"
                    className="pop-act"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStudy(part.gloss.jp, part.gloss.romaji, part.gloss.gloss);
                    }}
                  >
                    Study
                  </button>
                </span>
              </span>
            )}
            <button
              type="button"
              className={knownWords.has(part.text) ? "word word--known" : "word"}
              aria-expanded={open}
              onClick={(event) => {
                // Otherwise the row's own handler would also fire.
                event.stopPropagation();
                onPickWord(wordId);
              }}
            >
              {furigana ? (
                <ruby>
                  {part.text}
                  <rt>{part.gloss.romaji}</rt>
                </ruby>
              ) : (
                part.text
              )}
            </button>
          </span>
        );
      })}
    </span>
  );
}

const MessageCard = memo(function MessageCard({
  message,
  member,
  settings,
  activeSentence,
  openWord,
  onPickSentence,
  onPickWord,
  onEdit,
  onRetry,
  knownWords,
  onKnow,
  onStudy,
}: {
  message: Message;
  member: Member;
  settings: Settings;
  activeSentence: string | null;
  openWord: string | null;
  onPickSentence: (id: string) => void;
  onPickWord: (id: string) => void;
  onEdit: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  knownWords: Set<string>;
  onKnow: (word: string, reading: string, gloss: string) => void;
  onStudy: (word: string, reading: string, gloss: string) => void;
}) {
  const [showEn, setShowEn] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const jpSentences = useMemo(() => splitJp(message.jp), [message.jp]);
  const roSentences = useMemo(() => splitLatin(message.romaji), [message.romaji]);
  const enSentences = useMemo(() => splitLatin(message.en), [message.en]);

  // Word segmentation is pure over (jp, words); memoize so tapping a sentence or
  // toggling English elsewhere in the thread never re-runs it.
  const segments = useMemo(
    () => jpSentences.map((sentence) => segment(sentence, message.words)),
    [jpSentences, message.words],
  );

  const aligned = jpSentences.length > 1;
  const clipped = message.long && !expanded;
  const shown = clipped ? Math.min(settings.collapsedSentences, jpSentences.length) : jpSentences.length;
  const hidden = jpSentences.length - shown;

  const hasEn = message.en.trim().length > 0;
  const englishVisible = (showEn ?? settings.englishByDefault) && hasEn;
  const translated = message.romaji.trim().length > 0 || hasEn;

  const aid = settings.readingAid;
  const furigana = aid === "furigana";
  // A standalone romaji block/line only when that aid is chosen; furigana puts
  // the reading inline as ruby instead, and kanji-only shows none.
  const showRomaji = aid === "romaji" && translated;
  const interleaved = settings.readingLayout === "interleaved";

  const rowFor = (index: number) => `${message.id}-s${index}`;

  const jpContent = (index: number) => (
    <JpContent
      segments={segments[index]}
      rowId={rowFor(index)}
      furigana={furigana}
      openWord={openWord}
      knownWords={knownWords}
      onPickWord={onPickWord}
      onKnow={onKnow}
      onStudy={onStudy}
    />
  );

  async function copyMessage() {
    const parts = [message.jp];
    if (message.romaji.trim()) parts.push(message.romaji);
    if (hasEn) parts.push(message.en);
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <article className="msg">
      <div className="msg-label">
        <div className="lbl-source">{message.source}</div>
        <div className="lbl-group">{member.group}</div>
        <div className="lbl-member">{member.name}</div>
        <div className="lbl-rule" aria-hidden="true" />
        <div className="lbl-time">{message.time}</div>
        <button type="button" className="btn-edit" onClick={() => onEdit(message.id)}>
          Edit
        </button>
      </div>

      <div className="msg-body">
        {message.imageUrl && (
          <MessagePhoto url={message.imageUrl} source={message.source} mediaType={message.mediaType} />
        )}

        <div>
          {interleaved ? (
            /* ── Interleaved: one JP/romaji/EN trio per sentence ──────────── */
            <div className="block block--trios">
              {jpSentences.slice(0, shown).map((sentence, index) => {
                const rowId = rowFor(index);
                const style = { "--cols": aligned ? "18px 1fr" : "1fr" } as CSSProperties;
                return (
                  <div
                    key={rowId}
                    className="trio"
                    style={style}
                    data-active={activeSentence === rowId}
                    onClick={() => onPickSentence(rowId)}
                  >
                    {aligned && <div className="trio-n">{index + 1}</div>}
                    <div className="trio-body">
                      <div className="trio-jp">
                        {jpContent(index)}
                        <SpeakButton text={sentence} label={`Listen to sentence ${index + 1}`} compact />
                      </div>
                      {showRomaji && <div className="trio-ro">{roSentences[index] ?? ""}</div>}
                      {englishVisible && <div className="trio-en">{enSentences[index] ?? ""}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Stacked: JP block, then romaji block, then English block ──── */
            <>
              <div className="block block--jp">
                {jpSentences.slice(0, shown).map((sentence, index) => {
                  const rowId = rowFor(index);
                  return (
                    <SentenceRow
                      key={rowId}
                      n={index + 1}
                      aligned={aligned}
                      active={activeSentence === rowId}
                      onPick={() => onPickSentence(rowId)}
                      contentClass="sent-jp"
                      hasNestedControls
                    >
                      {jpContent(index)}
                      <SpeakButton text={sentence} label={`Listen to sentence ${index + 1}`} compact />
                    </SentenceRow>
                  );
                })}
              </div>

              {showRomaji && (
                <div className="block block--sub">
                  {jpSentences.slice(0, shown).map((_, index) => {
                    const rowId = rowFor(index);
                    return (
                      <SentenceRow
                        key={rowId}
                        n={index + 1}
                        aligned={aligned}
                        active={activeSentence === rowId}
                        onPick={() => onPickSentence(rowId)}
                        contentClass="sent-ro"
                      >
                        {roSentences[index] ?? ""}
                      </SentenceRow>
                    );
                  })}
                </div>
              )}

              {englishVisible && (
                <div className="block block--sub">
                  {jpSentences.slice(0, shown).map((_, index) => {
                    const rowId = rowFor(index);
                    return (
                      <SentenceRow
                        key={rowId}
                        n={index + 1}
                        aligned={aligned}
                        active={activeSentence === rowId}
                        onPick={() => onPickSentence(rowId)}
                        contentClass="sent-en"
                      >
                        {enSentences[index] ?? ""}
                      </SentenceRow>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Translation status ───────────────────────────────────── */}
          {message.status === "pending" && !translated && (
            <div className="msg-note">Awaiting translation</div>
          )}

          {message.status === "failed" && (
            <div className="msg-note msg-note--error">
              <span>{message.error ?? "Translation failed."}</span>
              <button type="button" className="retry" onClick={() => onRetry(message.id)}>
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="msg-actions">
          {message.long && (
            <button type="button" className="act" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Collapse" : `Read more · ${hidden > 0 ? `+${hidden}` : ""}`}
            </button>
          )}
          {hasEn && (
            <button
              type="button"
              className="act act--en"
              onClick={() => setShowEn((v) => !(v ?? settings.englishByDefault))}
            >
              {englishVisible ? "Hide English" : "Show English"}
            </button>
          )}
          <SpeakButton text={message.jp} label="Listen to the whole message" />
          {translated && (
            <button type="button" className="act" onClick={copyMessage}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {message.words.length > 0 && (
            <div className="wordhint">
              {message.words.length === 1 ? "1 word tappable" : `${message.words.length} words tappable`}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});

export function ThreadView({
  member,
  messages,
  settings,
  onUpdateSettings,
  onBack,
  onEdit,
  onRetry,
  onFetch,
  onEditProfile,
  knownWords,
  onKnow,
  onStudy,
}: {
  member: Member | null;
  messages: Message[];
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onEdit: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  /** Present only for COSM members; pulls just this member's talk room. */
  onFetch?: () => Promise<CosmFetchSummary>;
  /** Open the Edit Profile screen for this member. */
  onEditProfile?: () => void;
  knownWords: Set<string>;
  onKnow: (word: string, reading: string, gloss: string) => void;
  onStudy: (word: string, reading: string, gloss: string) => void;
}) {
  // One selection at a time across the whole thread, as the design had it.
  const [activeSentence, setActiveSentence] = useState<string | null>(null);
  const [openWord, setOpenWord] = useState<string | null>(null);

  // Stable across renders so the memoized cards only re-render when their own
  // narrowed active/open state changes — not on every tap elsewhere.
  const pickSentence = useCallback(
    (id: string) => setActiveSentence((current) => (current === id ? null : id)),
    [],
  );
  const pickWord = useCallback(
    (id: string) => setOpenWord((current) => (current === id ? null : id)),
    [],
  );
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpToBottom = () =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });

  // Long threads (thousands of messages for one member) must not all mount at
  // once — reconciling every card makes each tap lag. Render a window that grows
  // as the user scrolls near the end.
  const BATCH = 40;
  const [visibleCount, setVisibleCount] = useState(BATCH);

  // A fresh thread restarts from the top with a fresh window.
  useEffect(() => {
    setVisibleCount(BATCH);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [member?.id]);

  // Stop any TTS when leaving the thread so it doesn't play on into the inbox.
  useEffect(() => () => stopSpeaking(), []);

  // Grow the window before the user reaches the bottom. Capped at the real
  // length, so once everything is mounted this stops changing state.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1200) {
      setVisibleCount((count) => Math.min(count + BATCH, messages.length));
    }
  }, [messages.length]);

  async function runFetch() {
    if (!onFetch) return;
    setFetching(true);
    setFetchNote(null);
    try {
      const result = await onFetch();
      setFetchNote(result.inserted > 0 ? `+${result.inserted} new` : "Up to date");
    } catch (error) {
      setFetchNote(error instanceof Error ? error.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  if (!member) {
    return (
      <>
        <div className="viewhead">
          <button type="button" className="backbtn" onClick={onBack} aria-label="Back to inbox">
            ←
          </button>
          <div className="viewhead-text">
            <h1 className="viewhead-title">No thread</h1>
            <div className="viewhead-meta">Pick a member from the inbox</div>
          </div>
        </div>
        <div className="scroll">
          <div className="empty">Nothing selected.</div>
        </div>
      </>
    );
  }

  // Font scale rides as a CSS variable on the scroll container; the reading
  // type sizes are expressed as calc() over it.
  const scrollStyle = { "--read-scale": settings.fontScale } as CSSProperties;

  return (
    <>
      <div className="viewhead">
        <button type="button" className="backbtn" onClick={onBack} aria-label="Back to inbox">
          ←
        </button>
        {member.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN host
          <img className="viewhead-avatar" src={member.avatarUrl} alt="" />
        )}
        <div className="viewhead-text">
          <h1 className="viewhead-title">{member.name}</h1>
          <div className="viewhead-meta">
            {member.group} · {member.source}
          </div>
        </div>
        {onEditProfile && (
          <button
            type="button"
            className="btn-fetch btn-fetch--ghost"
            onClick={onEditProfile}
          >
            Edit
          </button>
        )}
        {onFetch && (
          <button
            type="button"
            className="btn-fetch"
            disabled={fetching}
            onClick={runFetch}
            title={fetchNote ?? undefined}
          >
            {fetching ? "Fetching…" : fetchNote ?? "Fetch"}
          </button>
        )}
      </div>

      <ReadingControls settings={settings} onUpdate={onUpdateSettings} />

      <div
        className="scroll thread-scroll"
        ref={scrollRef}
        style={scrollStyle}
        // Tapping empty space dismisses an open gloss, matching the canvas.
        onClick={() => setOpenWord(null)}
        onScroll={handleScroll}
      >
        {messages.slice(0, visibleCount).map((message) => {
          // Both selection ids start with `${message.id}-s`; narrowing here means
          // a tap only changes props for the one card that owns the selection.
          const prefix = `${message.id}-s`;
          return (
            <MessageCard
              key={message.id}
              message={message}
              member={member}
              settings={settings}
              activeSentence={activeSentence?.startsWith(prefix) ? activeSentence : null}
              openWord={openWord?.startsWith(prefix) ? openWord : null}
              onPickSentence={pickSentence}
              onPickWord={pickWord}
              onEdit={onEdit}
              onRetry={onRetry}
              knownWords={knownWords}
              onKnow={onKnow}
              onStudy={onStudy}
            />
          );
        })}

        {messages.length === 0 && (
          <div className="empty">No messages yet. Add one from Capture.</div>
        )}

        <div style={{ height: 8 }} />
      </div>

      <div className="viewfoot">Read-only. Reply from {member.source}.</div>

      <button
        type="button"
        className="jump-bottom"
        aria-label="Jump to the bottom"
        title="Jump to the bottom"
        onClick={jumpToBottom}
      >
        ↓
      </button>
    </>
  );
}
