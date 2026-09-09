"use client";

export type TabKey = "inbox" | "thread" | "capture" | "roster";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "thread", label: "Reading" },
  { key: "capture", label: "Capture" },
  { key: "roster", label: "Roster" },
];

/**
 * The three-up bottom bar. The active tab is marked by a 24×3 accent rule above
 * the label rather than by colouring the label — straight from the design.
 */
export function TabBar({
  active,
  onPick,
}: {
  active: TabKey;
  onPick: (key: TabKey) => void;
}) {
  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className="tab"
          onClick={() => onPick(tab.key)}
        >
          <span className="tab-mark" aria-hidden="true" />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
