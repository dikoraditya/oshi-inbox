"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { MessagePhoto } from "./MessagePhoto";
import { segment, splitJp, splitLatin } from "@/lib/text";
import type { Member, Message, Settings } from "@/lib/types";
import type { CosmFetchSummary } from "@/lib/store";

/**
 * The reading view.
 *
 * The core idea: Japanese, romaji and English are split into sentences
 * independently and rendered as three stacked blocks that share one numbering.
 * Selecting line N highlights line N in all three at once, which is why the
 * selection lives here rather than inside each block.
 */

/** One row of a block: optional number gutter plus content. */
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

  const rowFor = (index: number) => `${message.id}-s${index}`;

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
          {/* ── Japanese ─────────────────────────────────────────────── */}
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
                  <span lang="ja">
                    {segments[index].map((part, partIndex) => {
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
                            {part.text}
                          </button>
                        </span>
                      );
                    })}
                  </span>
                </SentenceRow>
              );
            })}
          </div>

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

          {/* ── Romaji ───────────────────────────────────────────────── */}
          {translated && (
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

          {/* ── English ──────────────────────────────────────────────── */}
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

      <div
        className="scroll thread-scroll"
        ref={scrollRef}
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
