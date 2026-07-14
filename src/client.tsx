import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { extractTicketId, ticketUrl } from "./ticket.ts";
import type { BoardMR } from "./data.ts";
import { filterByMember, sortMRs, groupMRs, parseViewState, serializeViewState, GROUP_KEYS, SORT_KEYS } from "./view.ts";
import type { GroupKey, SortKey, ViewState } from "./view.ts";

interface RosterMember {
  username: string;
  name: string | null;
  count: number;
}

/** Every configured member with its hidden state and MR count — for the settings modal. */
interface ConfigMember {
  username: string;
  name: string | null;
  hidden: boolean;
  count: number;
}

interface BoardData {
  title: string;
  defaultMember: string;
  members: RosterMember[];
  allMembers: ConfigMember[];
  mrs: BoardMR[];
  fetchedAt: number;
  fetchError: string | null;
}

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

type ThemeMode = "light" | "dark" | "system";
type ViewMode = "rows" | "grid";
const THEME_KEY = "mrs-theme";
const VIEW_KEY = "mrs-view";
const STATE_KEY = "mrs-view-state";

const GROUP_LABEL: Record<GroupKey, string> = {
  age: "age",
  author: "author",
  status: "status",
};
const SORT_LABEL: Record<SortKey, string> = {
  oldest: "oldest",
  progress: "progress",
};

/** A labelled segmented control (text labels, unlike the icon-only Segmented). */
function LabeledSeg<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="tui-seg tui-seg-text" role="group" aria-label={legend}>
      {options.map((o) => (
        <button key={o} className={o === value ? "active" : ""} onClick={() => onChange(o)}>
          {labels[o]}
        </button>
      ))}
    </span>
  );
}

function Icon({ d, circle }: { d: string; circle?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {circle && <circle cx="12" cy="12" r="4" />}
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  rows: <Icon d="M3 6h18M3 12h18M3 18h18" />,
  grid: <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  light: <Icon circle d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  dark: <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  system: <Icon d="M2 4h20v12H2zM8 20h8m-4-4v4" />,
  menu: <Icon d="M3 6h18M3 12h18M3 18h18" />,
  close: <Icon d="M6 6l12 12M18 6L6 18" />,
  people: <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  settings: (
    <Icon
      circle
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
    />
  ),
};

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="tui-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          className={o === value ? "active" : ""}
          onClick={() => onChange(o)}
          title={o}
          aria-label={o}
        >
          {ICONS[o] ?? o}
        </button>
      ))}
    </span>
  );
}

// ── pixel sprite avatar ────────────────────────────────────────────────────

/** FNV-1a string hash → 32-bit seed. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SPRITE_COLORS = ["--accent", "--green", "--amber", "--purple", "--cyan", "--red"];

/** Hand-designed 8×8 creatures (one byte per row, MSB = left pixel).
    Curated so every user gets something that reads as a sprite, not noise;
    each is left-right symmetric so it looks deliberate, not random. */
const SPRITES: number[][] = [
  // classic invader
  [0b00011000, 0b00111100, 0b01111110, 0b11011011, 0b11111111, 0b00100100, 0b01011010, 0b10100101],
  // crab
  [0b00100100, 0b01111110, 0b11011011, 0b11111111, 0b11111111, 0b01100110, 0b00100100, 0b01000010],
  // ghost
  [0b00111100, 0b01111110, 0b11011011, 0b11111111, 0b11111111, 0b11111111, 0b11111111, 0b10100101],
  // smiley
  [0b00111100, 0b01000010, 0b10100101, 0b10000001, 0b10100101, 0b10011001, 0b01000010, 0b00111100],
  // mech
  [0b00011000, 0b00011000, 0b01111110, 0b11111111, 0b11111111, 0b01100110, 0b01100110, 0b11100111],
  // alien
  [0b01000010, 0b00100100, 0b01111110, 0b11011011, 0b11111111, 0b10100101, 0b00100100, 0b01000010],
  // robot
  [0b11100111, 0b00111100, 0b01111110, 0b11011011, 0b11111111, 0b11011011, 0b01111110, 0b01100110],
  // cat
  [0b10000001, 0b11000011, 0b11111111, 0b11011011, 0b11111111, 0b11111111, 0b11111111, 0b10100101],
  // skull
  [0b00111100, 0b01111110, 0b11111111, 0b11011011, 0b11111111, 0b01111110, 0b01011010, 0b00100100],
  // beetle
  [0b10011001, 0b01111110, 0b11111111, 0b11011011, 0b11111111, 0b11111111, 0b01111110, 0b10100101],
  // owl
  [0b11000011, 0b11111111, 0b11011011, 0b11111111, 0b01111110, 0b00111100, 0b00011000, 0b00100100],
  // flower
  [0b00100100, 0b01111110, 0b11111111, 0b11100111, 0b11111111, 0b01111110, 0b00011000, 0b00011000],
  // gem
  [0b00011000, 0b00111100, 0b01111110, 0b11111111, 0b11111111, 0b01111110, 0b00111100, 0b00011000],
  // heart
  [0b01100110, 0b11111111, 0b11111111, 0b11111111, 0b01111110, 0b01111110, 0b00111100, 0b00011000],
  // mushroom
  [0b00111100, 0b01111110, 0b11111111, 0b11111111, 0b01011010, 0b00011000, 0b00011000, 0b00111100],
  // amoeba
  [0b00100100, 0b01011010, 0b11111111, 0b10111101, 0b11111111, 0b01011010, 0b10100101, 0b01000010],
];

/** Deterministic per-username creature: the hash picks one of the designed
    sprites and its color. Same user, same sprite, forever. */
function OwnerSprite({ username }: { username: string }) {
  const seed = hashStr(username);
  const sprite = SPRITES[seed % SPRITES.length]!;
  const color = SPRITE_COLORS[(seed >>> 4) % SPRITE_COLORS.length]!;
  const rects: React.ReactNode[] = [];
  sprite.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      if (row & (0x80 >> x)) {
        rects.push(<rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill={`var(${color})`} />);
      }
    }
  });
  return (
    <svg className="tui-avatar" viewBox="-1 -1 10 10" shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

// ── formatting helpers ─────────────────────────────────────────────────────

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusReasons(mr: BoardMR): string {
  const b = mr.blockers;
  if (!b?.any) return "ready to merge";
  const reasons: string[] = [];
  if (b.isDraft) reasons.push("marked as draft");
  if (b.hasConflicts) reasons.push("merge conflicts with target branch");
  if (b.needsRebase) reasons.push("source branch needs a rebase");
  if (b.pipelineFailing) reasons.push("pipeline is failing");
  if (b.pipelineRunning) reasons.push("pipeline still running");
  if (b.awaitingApprovals)
    reasons.push(`awaiting approvals (${mr.reviews.given}/${mr.reviews.required})`);
  if (b.hasUnresolvedDiscussions) reasons.push(`unresolved discussions (${mr.unresolvedThreads})`);
  if (b.hasMergeError) reasons.push(`merge error: ${b.mergeError ?? "unknown"}`);
  return reasons.length ? `blocked:\n${reasons.map((r) => `· ${r}`).join("\n")}` : "blocked";
}

function activeReviewers(mr: BoardMR): string[] {
  return (mr.reviews?.reviewers ?? [])
    .filter((r) => (r.displayState ?? (r.reviewState === "REVIEW_STARTED" ? "reviewing" : null)) === "reviewing")
    .map((r) => r.name || r.username);
}

/** Title with any leading ticket prefix ("ACME-2369: ") removed — the ticket
    already shows via the Linear link and the branch name. */
function cleanTitle(title: string): string {
  return title.replace(/^[A-Za-z]+-\d+:\s*/, "");
}

function openMR(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest("a, button")) return;
  if (mr.webUrl) window.open(mr.webUrl, "_blank", "noopener");
}

// ── slack summary ───────────────────────────────────────────────────────────

/** One MR as plain text: "title: url". No markup, so it survives Slack's rich
    composer, and Slack auto-links the bare URL. */
function mrLine(mr: BoardMR): string {
  return mr.webUrl ? `${cleanTitle(mr.title)}: ${mr.webUrl}` : cleanTitle(mr.title);
}

/** The current view as text: a count heading, then each MR as a "- title: url" bullet. */
function boardSummary(mrs: BoardMR[]): string {
  return [`${mrs.length} MR's ready for review :pray:`, ...mrs.map((mr) => `- ${mrLine(mr)}`)].join("\n");
}

// ── pieces ─────────────────────────────────────────────────────────────────

const COPY_ICON = "M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1";
const CHECK_ICON = "M20 6 9 17l-5-5";

/** Copies `text` to the clipboard and flashes a check for feedback. An
    optional `label` renders text beside the icon (used for the drawer action). */
function CopyButton({ text, className, title, label }: { text: string; className: string; title: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button
      className={copied ? `${className} copied` : className}
      title={copied ? "copied" : title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon d={copied ? CHECK_ICON : COPY_ICON} />
      {label && <span>{copied ? "copied" : label}</span>}
    </button>
  );
}

function StatusDot({ mr }: { mr: BoardMR }) {
  const cls = !mr.blockers?.any ? "ok" : mr.blockers.hasConflicts || mr.blockers.pipelineFailing ? "bad" : "warn";
  return (
    <span className="tui-dot-wrap" data-tip={statusReasons(mr)}>
      <span className={`tui-dot ${cls}`}>●</span>
    </span>
  );
}

/** The single most important state, for the row's right side. */
function statusPhrase(mr: BoardMR): { text: string; cls: string } {
  const b = mr.blockers;
  const comments = mr.unresolvedThreads;
  if (b?.hasConflicts) return { text: "conflicts", cls: "t-bad" };
  if (b?.pipelineFailing) return { text: "ci failing", cls: "t-bad" };
  if (b?.pipelineRunning) return { text: "ci running", cls: "t-warn" };
  if (mr.reviews.isApproved) return { text: "approved", cls: "t-ok" };
  // Team culture: comments without approval mean changes are needed. Surface
  // that so a reviewed-with-feedback MR doesn't read the same as an untouched one.
  if (comments > 0) return { text: `${comments} comment${comments === 1 ? "" : "s"}`, cls: "t-warn" };
  if (mr.reviews.required > 0 && mr.reviews.given > 0)
    return { text: `${mr.reviews.given}/${mr.reviews.required} approved`, cls: "t-warn" };
  return { text: "needs review", cls: "t-muted" };
}

function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, cls } = statusPhrase(mr);
  return <span className={`tui-phrase ${cls}`}>{text}</span>;
}

function MetaTokens({ mr, now }: { mr: BoardMR; now: number }) {
  return (
    <span className="tui-meta">
      {mr.diff && (
        <span className="t-dim" title={`${mr.diff.filesChanged} files changed`}>
          <span className="t-ok">+{mr.diff.additions}</span> <span className="t-bad">−{mr.diff.deletions}</span>
        </span>
      )}
      <span className="t-muted" title="last updated">{ago(mr.updatedAt, now)}</span>
    </span>
  );
}

function TicketLink({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      aria-label={`open ${ticket} in Linear`}
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 100 100" width="13" height="13" fill="currentColor" aria-hidden>
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
      </svg>
    </a>
  );
}

function Watching({ mr }: { mr: BoardMR }) {
  const names = activeReviewers(mr);
  if (!names.length) return null;
  return (
    <div className="tui-watching">
      👀 {names.join(", ")} {names.length === 1 ? "is" : "are"} reviewing right now
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="tui-panel">
      <span className="tui-panel-title">
        {title} <span className="tui-panel-count">{count}</span>
      </span>
      {children}
    </section>
  );
}

// ── views ──────────────────────────────────────────────────────────────────

function RowView({ mrs, now }: { mrs: BoardMR[]; now: number }) {
  return (
    <div className="tui-rows">
      {mrs.map((mr) => {
        const ticket = extractTicketId(mr.sourceBranch, mr.title);
        return (
          <div key={mr.iid} className="tui-row" onClick={(e) => openMR(e, mr)}>
            <div className="tui-row-1">
              <StatusDot mr={mr} />
              <span className="tui-title">{cleanTitle(mr.title)}</span>
              <StatusPhrase mr={mr} />
              {ticket && <TicketLink ticket={ticket} />}
              <CopyButton text={mrLine(mr)} className="tui-copy-inline" title="copy this MR for Slack" />
            </div>
            <div className="tui-row-2">
              <span className="tui-branch">
                {mr.sourceBranch}
                {!["master", "main"].includes(mr.targetBranch) && (
                  <> <span className="tui-arrow">→</span> {mr.targetBranch}</>
                )}
              </span>
              <MetaTokens mr={mr} now={now} />
            </div>
            <Watching mr={mr} />
          </div>
        );
      })}
    </div>
  );
}

function GridView({ mrs, now }: { mrs: BoardMR[]; now: number }) {
  return (
    <div className="tui-grid">
      {mrs.map((mr) => {
        const ticket = extractTicketId(mr.sourceBranch, mr.title);
        const reasons = mr.blockers?.any ? statusReasons(mr).split("\n").slice(1) : [];
        return (
          <div key={mr.iid} className="tui-card" onClick={(e) => openMR(e, mr)}>
            <CopyButton text={mrLine(mr)} className="tui-copy-inline tui-copy-card" title="copy this MR for Slack" />
            <span className="tui-card-label">
              <StatusDot mr={mr} /> !{mr.iid}
              {ticket && <TicketLink ticket={ticket} />}
            </span>
            <div className="tui-card-title">{cleanTitle(mr.title)}</div>
            <div className="tui-card-branch" title={`${mr.sourceBranch} → ${mr.targetBranch}`}>
              {mr.sourceBranch} <span className="tui-arrow">→</span> {mr.targetBranch}
            </div>
            <div className="tui-card-tokens">
              <StatusPhrase mr={mr} /> <MetaTokens mr={mr} now={now} />
            </div>
            {reasons.length > 0 && (
              <ul className="tui-blockers">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <Watching mr={mr} />
          </div>
        );
      })}
    </div>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  members,
  total,
  active,
  onPick,
  onSettings,
}: {
  members: RosterMember[];
  total: number;
  active: string;
  onPick: (member: string) => void;
  onSettings: () => void;
}) {
  return (
    <nav className="tui-sidebar" aria-label="team members">
      <div className="tui-side-head">
        <button className={active === "all" ? "tui-side-item active" : "tui-side-item"} onClick={() => onPick("all")}>
          <span className="tui-side-name">◉ All</span>
          <span className="tui-side-count">{total}</span>
        </button>
        <button className="tui-side-gear" onClick={onSettings} title="manage roster — check people in/out" aria-label="manage roster">
          {ICONS.people}
        </button>
      </div>
      {members.map((m) => (
        <button
          key={m.username}
          className={
            (active === m.username ? "tui-side-item active" : "tui-side-item") + (m.count === 0 ? " tui-side-empty" : "")
          }
          onClick={() => onPick(m.username)}
          title={m.name ?? m.username}
        >
          <span className="tui-side-name">
            <OwnerSprite username={m.username} /> {m.name ?? m.username}
          </span>
          <span className="tui-side-count">{m.count}</span>
        </button>
      ))}
    </nav>
  );
}

// ── settings modal ─────────────────────────────────────────────────────────

/** Check members in/out. Toggling persists the hidden flag to config.json. */
function SettingsModal({
  members,
  onToggle,
  onClose,
}: {
  members: ConfigMember[];
  onToggle: (username: string, hidden: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toggle = async (m: ConfigMember) => {
    setPending(m.username);
    try {
      await onToggle(m.username, !m.hidden);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="tui-modal-overlay" onClick={onClose}>
      <div className="tui-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="team settings">
        <div className="tui-modal-head">
          <span className="tui-modal-title">❯ team members</span>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <p className="tui-modal-sub"># check people out to hide them from the board</p>
        <ul className="tui-modal-list">
          {members.map((m) => (
            <li key={m.username} className={m.hidden ? "tui-modal-row out" : "tui-modal-row"}>
              <label className="tui-modal-name" title={m.hidden ? "checked out — hidden from the board" : "checked in"}>
                <input
                  type="checkbox"
                  className="tui-check-box"
                  checked={!m.hidden}
                  disabled={pending === m.username}
                  onChange={() => toggle(m)}
                />
                <OwnerSprite username={m.username} /> {m.name ?? m.username}
              </label>
              <span className="tui-modal-count">{m.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── controls (shared: desktop header + mobile drawer) ───────────────────────

function Controls({
  state,
  update,
  view,
  pickView,
  theme,
  pickTheme,
  canCopy,
  summaryText,
  stacked = false,
}: {
  state: ViewState;
  update: (patch: Partial<ViewState>) => void;
  view: ViewMode;
  pickView: (v: ViewMode) => void;
  theme: ThemeMode;
  pickTheme: (m: ThemeMode) => void;
  canCopy: boolean;
  summaryText: string;
  stacked?: boolean;
}) {
  const group = <LabeledSeg legend="group" options={GROUP_KEYS} labels={GROUP_LABEL} value={state.group} onChange={(g) => update({ group: g })} />;
  const sort = <LabeledSeg legend="sort" options={SORT_KEYS} labels={SORT_LABEL} value={state.sort} onChange={(s) => update({ sort: s })} />;
  const viewSeg = <Segmented options={["rows", "grid"] as const} value={view} onChange={pickView} label="view" />;
  const themeSeg = <Segmented options={["light", "dark", "system"] as const} value={theme} onChange={pickTheme} label="theme" />;

  // Drawer: labeled full-width rows, so a mobile user can tell what each does.
  if (stacked) {
    return (
      <>
        <div className="tui-ctl-row"><span className="tui-ctl-label">group</span>{group}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">sort</span>{sort}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">view</span>{viewSeg}</div>
        <div className="tui-ctl-row"><span className="tui-ctl-label">theme</span>{themeSeg}</div>
        {canCopy && (
          <CopyButton text={summaryText} className="tui-drawer-action" title="copy summary for Slack" label="copy summary" />
        )}
      </>
    );
  }

  // Header: compact inline row.
  return (
    <>
      {canCopy && <CopyButton text={summaryText} className="tui-copy" title="copy summary for Slack" />}
      {group}
      {sort}
      {viewSeg}
      {themeSeg}
    </>
  );
}

// ── board ──────────────────────────────────────────────────────────────────

function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "rows");
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? "system");

  // View state (member/group/sort). Members are validated once data arrives.
  const [state, setState] = useState<ViewState>(() => {
    let stored: Partial<ViewState> | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    } catch {
      stored = null;
    }
    return parseViewState(location.search, stored, []);
  });
  const validatedOnce = useRef(false);

  const pickView = (v: ViewMode) => {
    localStorage.setItem(VIEW_KEY, v);
    setView(v);
  };
  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      history.replaceState(null, "", serializeViewState(next) || location.pathname);
      return next;
    });
  };

  const load = useCallback(
    () =>
      fetch("/data.json")
        .then((r) => r.json())
        .then((d: BoardData) => {
          setData(d);
          setLoadError(false);
          const usernames = d.members.map((m) => m.username);
          if (!validatedOnce.current) {
            // First load: the real roster and configured default are now known, so
            // re-resolve from URL/localStorage/defaultMember against them.
            validatedOnce.current = true;
            let stored: Partial<ViewState> | null = null;
            try {
              stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
            } catch {
              stored = null;
            }
            setState(parseViewState(location.search, stored, usernames, d.defaultMember));
          } else {
            // Subsequent refreshes: keep the user's current selection, only
            // dropping a member who's no longer on the (visible) roster.
            setState((prev) =>
              prev.member === "all" || usernames.includes(prev.member) ? prev : { ...prev, member: "all" },
            );
          }
        })
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMember = async (username: string, hidden: boolean) => {
    const res = await fetch("/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, hidden }),
    });
    if (res.ok) await load();
  };

  if (!data) {
    return <p className="tui-loading">{loadError ? "✗ failed to load board data" : "fetching…"}</p>;
  }

  const total = data.members.reduce((n, m) => n + m.count, 0);
  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();

  const filtered = filterByMember(data.mrs, state.member);
  const groups = groupMRs(filtered, state.group, data.members.map((m) => m.username), now).map((g) => ({
    label: g.label,
    mrs: sortMRs(g.mrs, state.sort),
  }));
  const activeMember = state.member === "all" ? null : data.members.find((m) => m.username === state.member) ?? null;
  const summaryText = boardSummary(groups.flatMap((g) => g.mrs));
  const openSettings = () => {
    setMenuOpen(false);
    setShowSettings(true);
  };
  const controlProps = {
    state,
    update,
    view,
    pickView,
    theme,
    pickTheme,
    canCopy: filtered.length > 0,
    summaryText,
  };

  return (
    <div className={view === "grid" ? "tui tui-wide tui-app" : "tui tui-app"}>
      {/* Desktop roster (hidden on mobile, where it moves into the drawer). */}
      <Sidebar
        members={data.members}
        total={total}
        active={state.member}
        onPick={(member) => update({ member })}
        onSettings={openSettings}
      />

      <div className="tui-main">
        <header className="tui-header">
          {/* Mobile-only: burger opens the drawer with roster + controls. */}
          <button className="tui-burger" onClick={() => setMenuOpen(true)} aria-label="open menu">
            {ICONS.menu}
          </button>
          <div className="tui-header-title">
            <h1>
              <span className="tui-prompt">❯</span> {data.title.toLowerCase()}{" "}
              {activeMember && <span className="tui-author">--author @{activeMember.username}</span>}
            </h1>
            <p className="tui-sub">
              <span className="tui-comment"># {filtered.length} awaiting review · pick one, it opens in gitlab</span>
            </p>
          </div>
          <div className="tui-controls tui-controls-header">
            <Controls {...controlProps} />
          </div>
        </header>

        {data.fetchError && <div className="tui-banner">⚠ data from {staleMins}m ago — gitlab fetch failing</div>}

        {filtered.length === 0 && !data.fetchError ? (
          <p className="tui-empty">nothing waiting on review ✓</p>
        ) : (
          groups.map((g) => (
            <Panel key={g.label} title={g.label} count={g.mrs.length}>
              {view === "rows" ? <RowView mrs={g.mrs} now={now} /> : <GridView mrs={g.mrs} now={now} />}
            </Panel>
          ))
        )}

        <footer className="tui-footer">updated {staleMins < 1 ? "just now" : `${staleMins}m ago`}</footer>
      </div>

      {/* Mobile drawer: roster + controls, tucked behind the burger. */}
      {menuOpen && (
        <div className="tui-drawer-overlay" onClick={() => setMenuOpen(false)}>
          <div className="tui-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="menu">
            <div className="tui-drawer-head">
              <span className="tui-modal-title">❯ menu</span>
              <button className="tui-modal-x" onClick={() => setMenuOpen(false)} aria-label="close menu">
                {ICONS.close}
              </button>
            </div>
            <Sidebar
              members={data.members}
              total={total}
              active={state.member}
              onPick={(member) => {
                update({ member });
                setMenuOpen(false);
              }}
              onSettings={openSettings}
            />
            <div className="tui-drawer-controls">
              <Controls {...controlProps} stacked />
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal members={data.allMembers} onToggle={toggleMember} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Board />
  </StrictMode>,
);
