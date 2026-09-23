"use client";

import { useEffect, useMemo, useState } from "react";

import { AssignView } from "@/components/AssignView";
import { EditorView } from "@/components/EditorView";
import { MemberEditView } from "@/components/MemberEditView";
import { InboxView, type GroupFilter, type SourceFilter } from "@/components/InboxView";
import { RosterView } from "@/components/RosterView";
import { StatisticsView } from "@/components/StatisticsView";
import { ReviewView } from "@/components/ReviewView";
import { TabBar, type TabKey } from "@/components/TabBar";
import { ThreadView } from "@/components/ThreadView";
import { KanaGate } from "@/components/KanaGate";
import { useInbox, type Draft } from "@/lib/store";

type View = "inbox" | "thread" | "statistics" | "editor" | "assign" | "roster" | "member-edit" | "review";

/** The mock status bar completes the phone frame on desktop; the clock is real. */
function StatusBar({ offline }: { offline: boolean }) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="statusbar">
      {/* Empty until mounted, so server and client markup agree. */}
      <div>{clock || " "}</div>
      <div>{offline ? "OFFLINE · cached" : "JP · LTE · 82%"}</div>
    </div>
  );
}

export default function Page() {
  const store = useInbox();

  const [view, setView] = useState<View>("inbox");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("All");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");

  const activeMember = store.members.find((m) => m.id === activeMemberId) ?? null;

  const threadMessages = useMemo(
    () =>
      activeMemberId
        ? store.messages
            .filter((m) => m.memberId === activeMemberId)
            // Newest first, per the requested descending order.
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [store.messages, activeMemberId],
  );

  // Members of a pure-REST source carry a "cosm:<room>" or "bstage:<circle>"
  // attribution key; that gates the Fetch UI.
  const FETCH_PREFIXES = ["cosm:", "bstage:"];
  const isFetchKey = (k: string) => FETCH_PREFIXES.some((p) => k.startsWith(p));
  const activeFetchKey = activeMember?.attributionKeys?.find(isFetchKey) ?? null;

  const editingMessage = editingId ? (store.messages.find((m) => m.id === editingId) ?? null) : null;
  const assigningMessage = assigningId
    ? (store.messages.find((m) => m.id === assigningId) ?? null)
    : null;

  function openThread(memberId: string) {
    setActiveMemberId(memberId);
    setView("thread");
    void store.markRead(memberId);
    void store.translatePending(memberId);
  }

  function openEditor(messageId: string | null, memberId?: string) {
    setEditingId(messageId);
    if (memberId) setActiveMemberId(memberId);
    setView("editor");
  }

  function onTab(key: TabKey) {
    if (key === "statistics") {
      setView("statistics");
      return;
    }
    if (key === "roster") {
      setView("roster");
      return;
    }
    if (key === "study") {
      setView("review");
      return;
    }
    if (key === "thread") {
      // Reading needs a subject; fall back to the first member with a thread.
      const fallback =
        activeMemberId ??
        store.messages.find((m) => m.memberId)?.memberId ??
        store.members[0]?.id ??
        null;
      setActiveMemberId(fallback);
      setView("thread");
      return;
    }
    setView("inbox");
  }

  async function handleSave(draft: Draft) {
    const saved = await store.saveDraft(draft);
    setEditingId(null);
    setActiveMemberId(saved.memberId);
    setView("thread");
  }

  async function handleDelete(messageId: string) {
    await store.removeMessage(messageId);
    setEditingId(null);
    setView("thread");
  }

  async function handleAssign(memberId: string) {
    if (!assigningId) return;
    await store.assignMessage(assigningId, memberId);
    setAssigningId(null);
    setActiveMemberId(memberId);
    setView("thread");
  }

  const activeTab: TabKey =
    view === "statistics"
      ? "statistics"
      : view === "thread" || view === "editor"
        ? "thread"
        : view === "roster"
          ? "roster"
          : view === "review"
            ? "study"
            : "inbox";

  const usable = store.ready && !(store.loadError && store.messages.length === 0);

  // Kana warm-up: re-gate every 12 hours (so it's at least twice a day).
  const [kanaPassed, setKanaPassed] = useState(false);
  useEffect(() => {
    const ts = Number(localStorage.getItem("oshi_kana_pass"));
    if (ts && Date.now() - ts < 12 * 60 * 60 * 1000) setKanaPassed(true);
  }, []);
  function passKana() {
    localStorage.setItem("oshi_kana_pass", String(Date.now()));
    setKanaPassed(true);
  }
  const showApp = usable && kanaPassed;

  return (
    <main className="stage">
      <div className="phone">
        <StatusBar offline={store.offline} />

        {!store.ready && <div className="scroll empty">Opening your inbox…</div>}

        {/* A load failure only blocks when there is no cached snapshot to show. */}
        {store.ready && !usable && (
          <div className="scroll empty">
            {store.loadError}
            <br />
            <br />
            <button type="button" className="act" onClick={() => void store.refresh()}>
              Try again
            </button>
          </div>
        )}

        {usable && !kanaPassed && <KanaGate onPass={passKana} />}

        {showApp && view === "inbox" && (
          <InboxView
            members={store.members}
            messages={store.messages}
            groups={store.groups}
            query={query}
            groupFilter={groupFilter}
            sourceFilter={sourceFilter}
            onQuery={setQuery}
            onGroupFilter={setGroupFilter}
            onSourceFilter={setSourceFilter}
            onOpen={openThread}
            onOpenUnassigned={(messageId) => {
              setAssigningId(messageId);
              setView("assign");
            }}
            onSync={() => store.syncAll()}
          />
        )}

        {showApp && view === "thread" && (
          <ThreadView
            member={activeMember}
            messages={threadMessages}
            settings={store.settings}
            onBack={() => setView("inbox")}
            onEdit={(messageId) => openEditor(messageId)}
            onRetry={(messageId) => void store.retranslate(messageId)}
            onFetch={
              activeFetchKey && activeMember
                ? async () => {
                    const result = await store.fetchSources(activeFetchKey);
                    // Translate what we just pulled (lazy mode won't otherwise until re-open).
                    void store.translatePending(activeMember.id);
                    return result;
                  }
                : undefined
            }
            onEditProfile={() => setView("member-edit")}
            knownWords={store.knownWords}
            onKnow={store.markKnown}
            onStudy={store.saveForReview}
          />
        )}

        {showApp && view === "review" && (
          <ReviewView cards={store.dueCards} onGrade={store.gradeCard} onBack={() => setView("inbox")} />
        )}

        {showApp && view === "member-edit" && activeMember && (
          <MemberEditView
            member={activeMember}
            onCancel={() => setView("thread")}
            onSave={(patch) => store.updateMember(activeMember.id, patch)}
          />
        )}

        {showApp && view === "roster" && (
          <RosterView
            members={store.members}
            messages={store.messages}
            groups={store.groups}
            onAddMember={store.addMember}
            onAddGroup={store.addGroup}
            onOpenMember={openThread}
          />
        )}

        {showApp && view === "statistics" && (
          <StatisticsView members={store.members} messages={store.messages} groups={store.groups} />
        )}

        {showApp && view === "assign" && assigningMessage && (
          <AssignView
            message={assigningMessage}
            members={store.members}
            onCancel={() => {
              setAssigningId(null);
              setView("inbox");
            }}
            onAssign={handleAssign}
          />
        )}

        {showApp && view === "editor" && (
          <EditorView
            members={store.members}
            editing={editingMessage}
            initialMemberId={activeMemberId ?? store.members[0]?.id ?? ""}
            onCancel={() => {
              setEditingId(null);
              setView(activeMemberId ? "thread" : "inbox");
            }}
            onSave={(draft) => void handleSave(draft)}
            onDelete={(messageId) => void handleDelete(messageId)}
          />
        )}

        {showApp && <TabBar active={activeTab} onPick={onTab} />}
      </div>
    </main>
  );
}
