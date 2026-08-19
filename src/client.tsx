import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Invadr } from "invadrs/react";
import { extractTicketId, ticketUrl } from "./ticket.ts";
import type { BoardMR } from "./data.ts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { filterByMember, sortMRs, groupMRs, nestStacks, parseViewState, serializeViewState, commentDot, dataAgeLabel, statusFlags, memberPeerState, joinRowState, GROUP_KEYS, SORT_KEYS } from "./view.ts";
import type { ViewState } from "./view.ts";
import { selectionHeader, MAX_HEADER_LEN, type SlackTemplates } from "./template.ts";
import { selectionOf, postableOf } from "./selection.ts";
import { respondOutcome, respondDoneLabel, respondNeedsAttention } from "./respond-outcome.ts";
import type {
  RosterMember,
  ConfigMember,
  ReviewStatus,
  ReviewInfo,
  RespondInfo,
  DoctorStatus,
  DoctorInfo,
  DraftInfo,
  SlackInfo,
  PeerReviewInfo,
  SentNudgeInfo,
  InboundNudgeInfo,
  BoardMRWithReview,
  BoardData,
  ThemeMode,
  ViewMode,
  Toast,
  RowMenuState,
  ThreadStatus,
  CommentNote,
  CommentThread,
  GeneralComment,
} from "./client/types.ts";
import {
  GROUP_LABEL,
  SORT_LABEL,
  ago,
  statusReasons,
  activeReviewers,
  cleanTitle,
  REVIEW_LABEL,
  RESPOND_LABEL,
  RESPOND_ACTIVE,
  DOCTOR_LABEL,
  DOCTOR_ACTIVE,
  PEER_PHRASE,
  peerState,
  NUDGE_RETRYABLE,
  nudgeChipText,
  nudgeTargets,
  draftKey,
  getSlackMarks,
  setSlackMarks,
  hasBoardBadges,
  mrLine,
  boardSummary,
  statusPhrase,
  flattenStack,
  THREAD_ICON,
  THREAD_LABEL,
  commentCount,
  reviewMenuItems,
  respondItemLabel,
  doctorItemLabel,
} from "./client/board/format.ts";

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = "mrs-theme";
const VIEW_KEY = "mrs-view";
const STATE_KEY = "mrs-view-state";

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
  refresh: <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />,
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

/** Plain click opens the MR in GitLab; right-click opens the row action menu
    (wired separately). Clicks on inner links/buttons are left to those. */
function onRowClick(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest("a, button")) return;
  if (mr.webUrl) window.open(mr.webUrl, "_blank", "noopener");
}

/** Feature glyphs for the internal-badge row. Currentcolor so the icon takes on
    each badge's status color. Kept dead-simple: one line-drawn shape per axis. */
const BADGE_ICON = {
  review: (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="6" cy="6" r="3.5" />
      <line x1="8.6" y1="8.6" x2="12" y2="12" />
    </svg>
  ),
  respond: (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="5,3 2,6 5,9" />
      <path d="M2 6 H 9 Q 12 6 12 9 V 11" />
    </svg>
  ),
  doctor: <span className="tui-badge-emoji" aria-hidden>👨🏻‍⚕️</span>,
};

function ReviewBadge({ review, onOpen }: { review?: ReviewInfo; onOpen?: () => void }) {
  if (!review) return null;
  const label = REVIEW_LABEL[review.status];
  const title = review.message || label;
  // When the agent has saved its write-up, the badge becomes a button that
  // opens the review modal. onRowClick ignores clicks on buttons, so this
  // doesn't also open the MR in GitLab.
  if (review.reportReady && onOpen) {
    return (
      <button
        className={`tui-review tui-review-${review.status} tui-review-open`}
        title={`${title} — click to read the review`}
        onClick={onOpen}
      >
        {BADGE_ICON.review} {label} ↗
      </button>
    );
  }
  return (
    <span className={`tui-review tui-review-${review.status}`} title={title}>
      {BADGE_ICON.review} {label}
    </span>
  );
}

/** Response-to-review lifecycle badge. Uses the review-badge visual family so
    the row's shape stays familiar; the class prefix `tui-respond-*` differentiates
    color state without needing a distinct component style. A terminal `done` is
    keyed on the derived outcome rather than the status, because `done` alone
    cannot tell a posted run from drafts left waiting. */
function RespondBadge({ respond, onResume }: { respond?: RespondInfo; onResume?: () => void }) {
  if (!respond) return null;
  const outcome = respond.status === "done" ? respondOutcome(respond.posted, respond.threads) : null;
  // Repeating the `=== "done"` test rather than branching on `outcome` is what
  // lets TypeScript narrow the status out of the RESPOND_LABEL lookup.
  const label = respond.status === "done" ? respondDoneLabel(respond.posted, respond.threads) : RESPOND_LABEL[respond.status];
  const title = respond.message || label;
  const className = `tui-review tui-respond tui-respond-${outcome ?? respond.status}`;
  // Unposted replies mean a pane is still parked at the posting gate holding
  // them, so the badge doubles as the way back into it.
  if (outcome && respondNeedsAttention(outcome) && respond.sessionId && onResume) {
    return (
      <button
        className={`${className} tui-review-open`}
        title={`${title} (click to resume and finish posting)`}
        onClick={onResume}
      >
        {BADGE_ICON.respond} {label} ↗
      </button>
    );
  }
  return (
    <span className={className} title={title}>
      {BADGE_ICON.respond} {label}
    </span>
  );
}

/** MR-doctor lifecycle: mechanical fixes (CI red / merge conflicts) chugging in
    the background. Cyan family so it reads as a distinct "auto-repair" axis.
    Auto-dispatched doctors carry an "auto·" prefix so a policy-launched pane
    is never mistaken for one the human clicked. */
function DoctorBadge({ doctor }: { doctor?: DoctorInfo }) {
  if (!doctor) return null;
  const label = (doctor.origin === "auto" ? "auto·" : "") + DOCTOR_LABEL[doctor.status];
  const title = doctor.message || label;
  return (
    <span className={`tui-review tui-doctor tui-doctor-${doctor.status}`} title={title}>
      {BADGE_ICON.doctor} {label}
    </span>
  );
}

// ── peer switchboard ────────────────────────────────────────────────────────

/** Glyph for every cross-board chip: traffic between two boards, in both
    directions. Kept as text (like the held-draft ✉) rather than an SVG. */
const PEER_GLYPH = "⇄";

/** One peer's review of this MR, relayed over the switchboard. Reuses the
    review-badge shape with its own `tui-peer-*` family so another board's
    progress is never mistaken for this board's own review lifecycle. */
function PeerBadge({ peer }: { peer: PeerReviewInfo }) {
  const state = peerState(peer);
  if (!state) return null;
  const phrase = PEER_PHRASE[state];
  return (
    <span className={`tui-review tui-peer tui-peer-${state}`} title={`peer review by ${peer.reviewer}: ${phrase}`}>
      {PEER_GLYPH} {peer.reviewer}: {phrase}
    </span>
  );
}

/** The re-review this board asked for, on the author's own row. */
function NudgeChip({ nudge }: { nudge?: SentNudgeInfo }) {
  if (!nudge) return null;
  const title = NUDGE_RETRYABLE.has(nudge.display)
    ? `${nudge.reviewer} hasn't picked this up... right-click to ask again`
    : `re-review asked of ${nudge.reviewer}`;
  return (
    <span className={`tui-review tui-nudge tui-nudge-${nudge.display}`} title={title}>
      {PEER_GLYPH} {nudgeChipText(nudge)}
    </span>
  );
}

/** The reviewer's side: peers waiting on us for a re-review of this MR. The
    server sends unhandled nudges unsorted, so the age shown is the oldest ask
    -- how long someone has actually been waiting. */
function NudgedByMarker({ nudges, now }: { nudges?: InboundNudgeInfo[]; now: number }) {
  if (!nudges?.length) return null;
  const sorted = [...nudges].sort((a, b) => a.receivedAt - b.receivedAt);
  const waiting = ago(new Date(sorted[0]!.receivedAt).toISOString(), now);
  return (
    <span className="tui-review tui-nudged" title="a peer asked you to look at this again">
      {PEER_GLYPH} nudged by {sorted.map((n) => n.from).join(", ")} · {waiting}
    </span>
  );
}

/** One held outbound note the doctor drafted — a compact chip. Reading and
    approving happen in DraftModal, which the chip opens; nothing posts from
    the chip itself. */
function DraftBadge({ draft, resolved, onOpen }: { draft: DraftInfo; resolved?: "posted" | "dismissed"; onOpen: () => void }) {
  if (resolved) return <span className="tui-review tui-held-draft tui-held-draft-resolved">✉ {resolved}</span>;
  return (
    <button
      className="tui-review tui-held-draft tui-review-open"
      title="held note — click to read and post or dismiss"
      onClick={onOpen}
    >
      ✉ held: {draft.kind}
    </button>
  );
}

/** Slack review-signal reactions currently on the MR's request message.
    Rendered next to the review badge so a row shows both the launched-review
    lifecycle and what teammates have already signalled in slack. */
function SlackReactionChips({ reactions }: { reactions?: string[] }) {
  if (!reactions?.length) return null;
  const set = new Set(reactions);
  const present = getSlackMarks().filter((m) => set.has(m.emoji));
  if (!present.length) return null;
  return (
    <span className="tui-slack-reactions">
      {present.map((m) => (
        <span key={m.emoji} className="tui-slack-reaction" title={m.title}>
          {m.glyph}
        </span>
      ))}
    </span>
  );
}

/** Chip shown when the MR has a resolved (or posted-by-us) slack message.
    Renders the Slack squircle with a check overlay; clicks open the message. */
function SlackPostedChip({ slack }: { slack?: SlackInfo }) {
  if (!slack?.posted) return null;
  const chip = (
    <span className="tui-slack-posted" title="posted in slack">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
        <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z" />
        <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z" />
        <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
      </svg>
      <span className="tui-slack-posted-check" aria-hidden>✓</span>
    </span>
  );
  if (!slack.permalink) return chip;
  return (
    <a
      href={slack.permalink}
      target="_blank"
      rel="noopener"
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", textDecoration: "none" }}
    >
      {chip}
    </a>
  );
}

/** Scrolls the returned ref's element into its scroll container whenever `key`
    turns truthy or changes. For content that appears at the bottom of a capped,
    scrollable modal: the settings modal stops at 80vh, so a fresh invite row or
    an expanded join input can render below the fold with nothing to bring it
    into view. `block: "nearest"` is deliberate -- it's a no-op when the element
    is already visible, so this never yanks a settled modal around. */
function useRevealOnChange<T extends HTMLElement = HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: "nearest" });
  }, [key]);
  return ref;
}

/** Close a modal on Escape, for the lifetime of the calling component. */
function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Modal that fetches and renders the agent's written review markdown for an MR. */
function ReviewModal({ mr, onClose }: { mr: BoardMRWithReview; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!mr.webUrl) {
      setFailed(true);
      return;
    }
    fetch(`/review/report?mr=${encodeURIComponent(mr.webUrl)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setBody(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mr.webUrl]);
  useEscapeClose(onClose);
  return (
    <div className="tui-modal-overlay tui-review-overlay" onClick={onClose}>
      <div className="tui-modal tui-review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={`review for !${mr.iid}`}>
        <div className="tui-modal-head">
          <span className="tui-modal-title">❯ review · !{mr.iid}</span>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            {ICONS.close}
          </button>
        </div>
        <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
        <div className="tui-review-body">
          {failed ? (
            <p className="tui-comments-empty">couldn't load the review</p>
          ) : body === null ? (
            <p className="tui-comments-empty">loading…</p>
          ) : (
            <div className="tui-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Drawer for one held outbound note. Shows the full body verbatim — exactly
    the text that would post — with the MR context, and holds the approval
    gate: post arms into an in-drawer confirm step (no native dialogs), and
    only the confirmed click sends. Dismiss is one click; it only deletes a
    local draft file. */
function DraftModal({
  mr,
  draft,
  local,
  onResolved,
  onClose,
}: {
  mr: BoardMRWithReview;
  draft: DraftInfo;
  local: boolean;
  onResolved: (outcome: "posted" | "dismissed") => void;
  onClose: () => void;
}) {
  // Post is two clicks: the first arms the button into "confirm post", the
  // second sends. Any failure disarms so a retry restates intent.
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"post" | "dismiss" | null>(null);
  const [failed, setFailed] = useState(false);
  useEscapeClose(onClose);
  const act = async (action: "post" | "dismiss") => {
    setBusy(action);
    setFailed(false);
    try {
      const res = await fetch("/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, kind: draft.kind, action }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onResolved(action === "post" ? "posted" : "dismissed");
    } catch {
      setBusy(null);
      setArmed(false);
      setFailed(true);
    }
  };
  return (
    <div className="tui-modal-overlay" onClick={onClose}>
      <div className="tui-modal tui-draft-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={`held draft for !${mr.iid}`}>
        <div className="tui-modal-head">
          <span className="tui-modal-title">❯ held: {draft.kind} · !{mr.iid}</span>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            {ICONS.close}
          </button>
        </div>
        <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
        <pre className="tui-draft-body">{draft.body}</pre>
        <div className="tui-draft-actions">
          {failed && <span className="tui-draft-error">action failed — nothing was sent, try again</span>}
          {local ? (
            armed ? (
              <>
                <button className="tui-draft-act" disabled={busy !== null} onClick={() => setArmed(false)}>back</button>
                <button className="tui-draft-act tui-draft-act-post armed" disabled={busy !== null} onClick={() => act("post")}>
                  {busy === "post" ? "posting…" : "confirm post"}
                </button>
              </>
            ) : (
              <>
                <button className="tui-draft-act" disabled={busy !== null} onClick={() => act("dismiss")}>
                  {busy === "dismiss" ? "dismissing…" : "dismiss"}
                </button>
                <button className="tui-draft-act tui-draft-act-post" disabled={busy !== null} onClick={() => setArmed(true)}>post</button>
              </>
            )
          ) : (
            <span className="tui-draft-note">read-only — post and dismiss live on the local board</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── row action menu (right-click) ────────────────────────────────────────────

/** Inline Slack logo — a simple 4-blob squircle. Currentcolor so it inherits from container. */
const SLACK_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden style={{ verticalAlign: "-2px" }}>
    <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
    <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z" />
    <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z" />
    <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
  </svg>
);

function MenuItem({
  label,
  hint,
  trailing,
  disabled,
  onClick,
}: {
  label: React.ReactNode;
  hint?: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button className="tui-menu-item" role="menuitem" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {trailing ?? (hint && <span className="tui-menu-hint">{hint}</span>)}
    </button>
  );
}

/** shadcn-style context menu anchored at the cursor. State-aware: the review
    item reflects review status, and the Slack items are disabled until the
    MR's review-request thread has been resolved. Dismisses on outside click,
    Escape, scroll, or resize. */
function RowMenu({
  menu,
  local,
  slackEnabled,
  onClose,
  onLaunch,
  onReReview,
  onOpenReview,
  onCopy,
  onResolveSlack,
  onReactSlack,
  onPostSlack,
  onRespond,
  canRespond,
  onDoctor,
  canDoctor,
  onDraftState,
  canDraftState,
  onNudge,
  canNudge,
  onResumeReview,
  onResumeRespond,
}: {
  menu: RowMenuState;
  local: boolean;
  slackEnabled: boolean;
  onClose: () => void;
  onLaunch: (mr: BoardMR, note?: string) => void;
  onReReview: (mr: BoardMR, note?: string) => void;
  onOpenReview: (mr: BoardMRWithReview) => void;
  onCopy: (mr: BoardMR) => void;
  onResolveSlack: (mr: BoardMR) => void;
  onReactSlack: (mr: BoardMR, emoji: string, remove: boolean) => Promise<string[] | null>;
  onPostSlack: (mr: BoardMR) => void;
  onRespond: (mr: BoardMR, note?: string) => void;
  canRespond: boolean;
  onDoctor: (mr: BoardMR, note?: string) => void;
  canDoctor: boolean;
  onDraftState: (mr: BoardMR, draft: boolean) => void;
  canDraftState: boolean;
  onNudge: (mr: BoardMR, reviewer: string) => void;
  canNudge: boolean;
  onResumeReview: (mr: BoardMR, note?: string) => void;
  onResumeRespond: (mr: BoardMR, note?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Local reaction state so the open menu updates immediately after a mark,
  // and per-emoji pending so the clicked item shows a spinner + disables.
  const [reactions, setReactions] = useState<string[]>((menu.mr as BoardMRWithReview).slack?.reactions ?? []);
  const [pending, setPending] = useState<string[]>([]);
  // Alt-held flips pane-launching items into "+ note" mode; alt-clicking one
  // swaps the menu for a note box whose Enter fires the captured action.
  const [altHeld, setAltHeld] = useState(false);
  const [noteFor, setNoteFor] = useState<{ label: string; fire: (note?: string) => void } | null>(null);
  const [noteText, setNoteText] = useState("");
  // Same auto-grow mechanism as the selection bar's header textarea: reset to
  // auto so deletions shrink it back, then add the border because the global
  // border-box makes `height` responsible for it while scrollHeight is not.
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [noteFor, noteText]);
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const onBlur = () => setAltHeld(false);
    document.addEventListener("keydown", onAlt);
    document.addEventListener("keyup", onAlt);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onAlt);
      document.removeEventListener("keyup", onAlt);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const { mr } = menu;
  const mrx = mr as BoardMRWithReview;
  const slack = mrx.slack;
  const found = slack?.status === "found";
  const showSlack = local && slackEnabled;
  const peers = local && canNudge ? nudgeTargets(mrx) : [];
  // Keep the menu on-screen; estimate generously since item count varies.
  const W = noteFor ? 320 : 230;
  const H = 60 + (local ? 34 : 0) + 68 + peers.length * 30 + (showSlack ? (found ? 170 : 60) : 0);
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - H - 8));
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  // Pane-launching items: a plain click fires immediately; an alt-click captures
  // the action and opens the note box instead. Focus-tab variants stay plain —
  // there is nothing to note into an already-running pane.
  const paneClick = (label: string, fire: (note?: string) => void) => (e: React.MouseEvent) => {
    if (e.altKey) {
      setNoteText("");
      setNoteFor({ label, fire });
      return;
    }
    fire();
    onClose();
  };
  const paneHint = altHeld ? "+ note" : "herdr";
  // Slack marks stay open (set several at once) and drive per-item pending +
  // a live check, so the click has immediate feedback. Clicking an item that
  // already carries our reaction removes it — the ✓ toggles the mark.
  const react = (emoji: string) => {
    if (pending.includes(emoji)) return;
    const remove = reactions.includes(emoji);
    setPending((p) => [...p, emoji]);
    onReactSlack(mr, emoji, remove).then((next) => {
      if (next) setReactions(next);
      setPending((p) => p.filter((e) => e !== emoji));
    });
  };

  if (noteFor) {
    return (
      <div ref={ref} className="tui-menu tui-menu-noting" style={{ left, top }} role="menu" aria-label={`note for !${mr.iid}`}>
        <div className="tui-menu-label">note for {noteFor.label} !{mr.iid}</div>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
          autoFocus
          value={noteText}
          placeholder="extra instruction…"
          maxLength={2000}
          aria-label="launch note"
          onChange={(e) => {
            setNoteText(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            // Keep Escape local (back to the menu, not menu close) and keep
            // the alt tracker honest while its document listener is muted.
            e.stopPropagation();
            setAltHeld(e.altKey);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              noteFor.fire(noteText.trim() || undefined);
              onClose();
            } else if (e.key === "Escape") {
              setNoteFor(null);
            }
          }}
        />
        <div className="tui-menu-note-hint">↵ launch with note · ⇧↵ newline · esc back</div>
      </div>
    );
  }

  const reviewRunning = mrx.review?.status === "queued" || mrx.review?.status === "reviewing";
  return (
    <div ref={ref} className="tui-menu" style={{ left, top }} role="menu" aria-label={`actions for !${mr.iid}`}>
      <div className="tui-menu-label">!{mr.iid}</div>

      {local && reviewMenuItems(mrx.review?.status).map((item) => (
        <MenuItem
          key={item.kind}
          label={item.label}
          hint={reviewRunning ? "herdr" : paneHint}
          onClick={
            reviewRunning
              ? run(() => onLaunch(mr))
              : paneClick(item.label, (note) => (item.kind === "re-review" ? onReReview(mr, note) : onLaunch(mr, note)))
          }
        />
      ))}
      {local && mrx.review?.sessionId && (
        <MenuItem
          label="resume review"
          hint={paneHint}
          onClick={paneClick("resume review", (note) => onResumeReview(mr, note))}
        />
      )}
      {local && canRespond && (
        <MenuItem
          label={respondItemLabel(mrx.respond?.status)}
          hint={respondItemLabel(mrx.respond?.status) === "focus response tab" ? "herdr" : paneHint}
          onClick={
            respondItemLabel(mrx.respond?.status) === "focus response tab"
              ? run(() => onRespond(mr))
              : paneClick(respondItemLabel(mrx.respond?.status), (note) => onRespond(mr, note))
          }
        />
      )}
      {local && canRespond && mrx.respond?.sessionId && (
        <MenuItem
          label="resume response"
          hint={paneHint}
          onClick={paneClick("resume response", (note) => onResumeRespond(mr, note))}
        />
      )}
      {local && canDoctor && (
        <MenuItem
          label={doctorItemLabel(mrx.doctor?.status)}
          hint={doctorItemLabel(mrx.doctor?.status) === "focus doctor tab" ? "herdr" : paneHint}
          onClick={
            doctorItemLabel(mrx.doctor?.status) === "focus doctor tab"
              ? run(() => onDoctor(mr))
              : paneClick(doctorItemLabel(mrx.doctor?.status), (note) => onDoctor(mr, note))
          }
        />
      )}
      {local && canDraftState && (
        <MenuItem
          label={mr.isDraft ? "mark ready" : "mark as draft"}
          hint="gitlab"
          onClick={run(() => onDraftState(mr, !mr.isDraft))}
        />
      )}
      {/* Ask a peer whose review left comments to look again. Only ever offered
          for your own MR, and only while no ask of yours is still outstanding. */}
      {peers.map((peer) => (
        <MenuItem
          key={peer.reviewer}
          label={`request re-review from ${peer.reviewer}`}
          hint="peer"
          onClick={run(() => onNudge(mr, peer.reviewer))}
        />
      ))}
      {mrx.review?.reportReady && (
        <MenuItem label="view review" onClick={run(() => onOpenReview(mrx))} />
      )}
      <MenuItem label="open in gitlab" onClick={run(() => mr.webUrl && window.open(mr.webUrl, "_blank", "noopener"))} />
      <MenuItem label="copy for slack" onClick={run(() => onCopy(mr))} />

      {showSlack && (
        <>
          <div className="tui-menu-sep" />
          {found ? (
            <>
              {getSlackMarks().map((m) => {
                const isPending = pending.includes(m.emoji);
                const isMarked = reactions.includes(m.emoji);
                return (
                  <MenuItem
                    key={m.emoji}
                    label={isMarked ? `unmark ${m.glyph} on slack` : m.label}
                    disabled={isPending}
                    trailing={
                      isPending ? (
                        <span className="tui-menu-spin" aria-label="working" />
                      ) : isMarked ? (
                        <span className="tui-menu-check">✓</span>
                      ) : undefined
                    }
                    onClick={() => react(m.emoji)}
                  />
                );
              })}
              {slack?.permalink && (
                <MenuItem label="open MR post in slack" onClick={run(() => window.open(slack.permalink!, "_blank", "noopener"))} />
              )}
            </>
          ) : (
            <>
              <MenuItem
                label={slack?.status === "notfound" ? "no thread — retry find" : "find slack thread"}
                onClick={run(() => onResolveSlack(mr))}
              />
              <MenuItem label="post to slack" onClick={run(() => onPostSlack(mr))} />
              {getSlackMarks().map((m) => (
                <MenuItem key={m.emoji} label={m.label} disabled />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Bottom-right stack of transient confirmations. */
function ToastHost({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="tui-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="tui-toast">
          {t.text}
        </div>
      ))}
    </div>
  );
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

/** Row/card selection checkbox. A real button so the existing onRowClick guard
    (which ignores clicks on `a, button`) already skips it -- stopPropagation is
    belt-and-braces in case that guard changes. */
function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "deselect this MR" : "select this MR"}
      className={checked ? "tui-selectbox checked" : "tui-selectbox"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "▣" : "☐"}
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

function StatusFlags({ mr, nested = false }: { mr: BoardMR; nested?: boolean }) {
  return (
    <>
      {statusFlags(mr, { nested }).map((f) => (
        <span key={f.text} className={`tui-flag ${f.cls}`}>
          {f.text}
        </span>
      ))}
    </>
  );
}

function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, cls, comments } = statusPhrase(mr);
  if (comments) return <CommentsButton mr={mr} label={text} cls={cls} />;
  return <span className={`tui-phrase ${cls}`}>{text}</span>;
}

/** A button that opens the comments drawer. Shared by the "N comments" status
    label and the persistent 💬 token, so both routes reach the same drawer. */
function CommentsTrigger({
  mr,
  className,
  title,
  children,
}: {
  mr: BoardMR;
  className: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && <CommentsDrawer mr={mr} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The "N comments" / "comments resolved" status label; clicking it opens the
    drawer. A dot beside it hints whether the author has acted (see `commentDot`). */
function CommentsButton({ mr, label, cls }: { mr: BoardMR; label: string; cls: string }) {
  const dot = commentDot(mr.threadSummary);
  return (
    <>
      <CommentsTrigger mr={mr} className={`tui-phrase tui-comments-btn ${cls}`} title="view comment threads">
        {label}
      </CommentsTrigger>
      {dot && (
        <span className={`tui-comment-dot ${dot.cls}`} title={dot.title} aria-label={dot.title}>
          ●
        </span>
      )}
    </>
  );
}

/** Persistent 💬 token in the row meta, shown whenever an MR has comment activity
    even in states where the status phrase isn't the clickable comments label (e.g.
    approved). Hidden when the status label already opens the drawer, to avoid two
    entry points on the same row. */
function CommentsToken({ mr }: { mr: BoardMR }) {
  const n = commentCount(mr);
  if (n === 0 || statusPhrase(mr).comments) return null;
  return (
    <CommentsTrigger mr={mr} className="tui-comment-token" title="view comments">
      <span className="tui-comment-token-icon" aria-hidden>💬</span>
      <span>{n}</span>
    </CommentsTrigger>
  );
}

/** One note in the drawer: author (highlighted when it's the MR author), a
    timestamp that deep-links to the note in GitLab, and the markdown body. */
function CommentNoteView({ mr, note, now }: { mr: BoardMR; note: CommentNote; now: number }) {
  const isAuthor = note.username === mr.author.username;
  return (
    <div className="tui-cd-note">
      <div className="tui-cd-note-head">
        <span className={`tui-cd-note-author ${isAuthor ? "author" : "commenter"}`}>{note.name}</span>
        <a
          className="tui-cd-note-time"
          href={mr.webUrl ? `${mr.webUrl}#note_${note.id}` : "#"}
          target="_blank"
          rel="noopener noreferrer"
          title="open this comment in gitlab"
        >
          {ago(note.at, now)} ↗
        </a>
      </div>
      <div className="tui-cd-note-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
        >
          {note.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Right-side drawer showing an MR's review threads (each with its status and
    notes) plus a section for general MR comments — the Overview-tab notes that
    aren't threads, so a later author comment isn't invisible. Lazily fetched. */
function CommentsDrawer({ mr, onClose }: { mr: BoardMR; onClose: () => void }) {
  const [data, setData] = useState<{ threads: CommentThread[]; comments: GeneralComment[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const now = Date.now();
  useEffect(() => {
    const params = new URLSearchParams({ repo: mr.rtRepo ?? "", iid: String(mr.iid), author: mr.author.username });
    fetch(`/discussions?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((d: { threads: CommentThread[]; comments?: GeneralComment[] }) =>
        setData({ threads: d.threads, comments: d.comments ?? [] }),
      )
      .catch(() => setFailed(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Lock body scroll so the page's scrollbar (from the board behind) doesn't
    // show alongside the drawer's own — no double scrollbar.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mr, onClose]);
  return (
    <div
      className="tui-cd-overlay"
      onClick={(e) => {
        // The drawer renders inside the row (whose onClick opens the MR); React
        // events bubble by component tree, so stop here or clicking the overlay
        // would also open the MR.
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="tui-cd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="comment threads">
        <div className="tui-cd-head">
          <div className="tui-cd-title">
            <span className="tui-cd-iid">!{mr.iid}</span> {cleanTitle(mr.title)}
          </div>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            {ICONS.close}
          </button>
        </div>
        <a className="tui-cd-open" href={mr.webUrl ?? "#"} target="_blank" rel="noopener noreferrer">
          open in gitlab ↗
        </a>
        <div className="tui-cd-body">
          {failed ? (
            <p className="tui-comments-empty">couldn't load comments</p>
          ) : !data ? (
            <p className="tui-comments-empty">loading…</p>
          ) : data.threads.length === 0 && data.comments.length === 0 ? (
            <p className="tui-comments-empty">no comments</p>
          ) : (
            <>
              {data.threads.map((t, i) => (
                <section key={i} className={`tui-cd-thread ${t.status}`}>
                  <div className="tui-cd-thread-status">
                    <span>
                      <span className="tui-comment-icon">{THREAD_ICON[t.status]}</span> {THREAD_LABEL[t.status]}
                    </span>
                    {mr.webUrl && t.notes[0] && (
                      <a
                        className="tui-cd-thread-open"
                        href={`${mr.webUrl}#note_${t.notes[0].id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        open ↗
                      </a>
                    )}
                  </div>
                  {t.notes.map((n) => (
                    <CommentNoteView key={n.id} mr={mr} note={n} now={now} />
                  ))}
                </section>
              ))}
              {data.comments.length > 0 && (
                <section className="tui-cd-comments">
                  <div className="tui-cd-comments-head">MR comments</div>
                  {data.comments.map((c) => (
                    <CommentNoteView key={c.id} mr={mr} note={c} now={now} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaTokens({ mr, now }: { mr: BoardMR; now: number }) {
  return (
    <span className="tui-meta">
      {mr.diff && (
        <span className="t-dim" title={`${mr.diff.filesChanged} files changed`}>
          <span className="t-ok">+{mr.diff.additions}</span> <span className="t-bad">−{mr.diff.deletions}</span>
        </span>
      )}
      <CommentsToken mr={mr} />
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

const PANEL_STATE_KEY = "mrs-panel-collapsed";

/** Set of collapsed panel titles, persisted so a group folded up on one visit
    stays folded on the next. Keyed on title alone -- group labels are unique
    within a grouping and it's fine if switching groupings orphans keys. */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((s) => typeof s === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify([...set]));
  } catch {
    // storage full or blocked; the panel just won't remember its state
  }
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Read once on mount; if the persisted set is huge we don't want to parse it
  // on every re-render (this component mounts once per group per grouping).
  useEffect(() => {
    setCollapsed(readCollapsed().has(title));
  }, [title]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    const set = readCollapsed();
    if (next) set.add(title); else set.delete(title);
    writeCollapsed(set);
  };
  return (
    <section className={`tui-panel${collapsed ? " tui-panel-collapsed" : ""}`}>
      <button
        type="button"
        className="tui-panel-title"
        aria-expanded={!collapsed}
        aria-controls={`panel-body-${title}`}
        onClick={toggle}
      >
        <span className="tui-panel-caret" aria-hidden>{collapsed ? "▸" : "▾"}</span>
        {title} <span className="tui-panel-count">{count}</span>
      </button>
      {!collapsed && <div id={`panel-body-${title}`}>{children}</div>}
    </section>
  );
}

// ── views ──────────────────────────────────────────────────────────────────

/** Author identity for a row — shown when the view mixes authors (the All
    view grouped by anything but author, where the group header isn't the name). */
function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr id={mr.author.username} palette="css-vars" className="tui-avatar" /> {name}
    </span>
  );
}

function RowView({
  mrs,
  now,
  showAuthor,
  local,
  slackTemplates,
  onContext,
  onOpenReview,
  onOpenDraft,
  draftResolved,
  onResumeRespond,
  selected,
  onToggleSelect,
}: {
  mrs: BoardMR[];
  now: number;
  showAuthor: boolean;
  local: boolean;
  slackTemplates: SlackTemplates;
  onContext: (e: React.MouseEvent, mr: BoardMR) => void;
  onOpenReview: (mr: BoardMRWithReview) => void;
  onOpenDraft: (mr: BoardMRWithReview, draft: DraftInfo) => void;
  draftResolved: ReadonlyMap<string, "posted" | "dismissed">;
  onResumeRespond: (mr: BoardMR) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (webUrl: string) => void;
}) {
  const renderRow = (mr: BoardMR, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const nested = depth > 0;
    return (
          <div
            key={mr.iid}
            className={nested ? "tui-row tui-row-nested" : "tui-row"}
            data-local={local ? "1" : undefined}
            title={local ? "right-click for actions" : undefined}
            onClick={(e) => onRowClick(e, mr)}
            onContextMenu={(e) => onContext(e, mr)}
          >
            {/* Its own leftmost column, full row height, so the checkbox is a
                target you can hit without aiming and never crowds the title. */}
            <div className="tui-row-pick">
              {mr.webUrl && (
                <SelectBox checked={selected.has(mr.webUrl)} onToggle={() => onToggleSelect(mr.webUrl!)} />
              )}
            </div>
            <div className="tui-row-body">
            {statusFlags(mr, { nested }).length > 0 && (
              <div className="tui-row-review">
                <StatusFlags mr={mr} nested={nested} />
              </div>
            )}
            <div className="tui-row-1">
              <StatusDot mr={mr} />
              {mr.isDraft && <span className="tui-draft" title="draft — right-click to mark ready">draft</span>}
              <span className="tui-title">{cleanTitle(mr.title)}</span>
              <StatusPhrase mr={mr} />
              {ticket && <TicketLink ticket={ticket} />}
              <CopyButton text={mrLine(mr, slackTemplates)} className="tui-copy-inline" title="copy this MR for Slack" />
            </div>
            <div className="tui-row-2">
              {showAuthor && <AuthorTag mr={mr} />}
              <span className="tui-mr-iid">!{mr.iid}</span>
              <span className="tui-row-sep">|</span>
              <span className="tui-branch">
                {mr.sourceBranch}
              </span>
              <MetaTokens mr={mr} now={now} />
            </div>
            {hasBoardBadges(mr) && (
              <div className="tui-row-board">
                <ReviewBadge review={(mr as BoardMRWithReview).review} onOpen={() => onOpenReview(mr as BoardMRWithReview)} />
                <RespondBadge respond={(mr as BoardMRWithReview).respond} onResume={() => onResumeRespond(mr)} />
                <DoctorBadge doctor={(mr as BoardMRWithReview).doctor} />
                {((mr as BoardMRWithReview).peerReviews ?? []).map((p) => (
                  <PeerBadge key={p.reviewer} peer={p} />
                ))}
                <NudgeChip nudge={(mr as BoardMRWithReview).sentNudge} />
                <NudgedByMarker nudges={(mr as BoardMRWithReview).nudges} now={now} />
                {((mr as BoardMRWithReview).drafts ?? []).map((d) => (
                  <DraftBadge
                    key={d.kind}
                    draft={d}
                    resolved={draftResolved.get(draftKey(mr.webUrl ?? "", d.kind))}
                    onOpen={() => onOpenDraft(mr as BoardMRWithReview, d)}
                  />
                ))}
                <SlackPostedChip slack={(mr as BoardMRWithReview).slack} />
                <SlackReactionChips reactions={(mr as BoardMRWithReview).slack?.reactions} />
              </div>
            )}
            <Watching mr={mr} />
            </div>
          </div>
    );
  };
  return (
    <div className="tui-rows">
      {nestStacks(mrs).map((node) =>
        node.children.length === 0 ? (
          renderRow(node.mr, 0)
        ) : (
          <div key={node.mr.iid} className="tui-stack-rows">
            {renderRow(node.mr, 0)}
            {/* The children get their own box so the thread rail can span
                exactly them, whatever heights the rows come out at. */}
            <div className="tui-stack-children">
              {flattenStack(node)
                .slice(1)
                .map(({ mr, depth }) => renderRow(mr, depth))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function GridView({
  mrs,
  now,
  showAuthor,
  local,
  slackTemplates,
  onContext,
  onOpenReview,
  onOpenDraft,
  draftResolved,
  onResumeRespond,
  selected,
  onToggleSelect,
}: {
  mrs: BoardMR[];
  now: number;
  showAuthor: boolean;
  local: boolean;
  slackTemplates: SlackTemplates;
  onContext: (e: React.MouseEvent, mr: BoardMR) => void;
  onOpenReview: (mr: BoardMRWithReview) => void;
  onOpenDraft: (mr: BoardMRWithReview, draft: DraftInfo) => void;
  draftResolved: ReadonlyMap<string, "posted" | "dismissed">;
  onResumeRespond: (mr: BoardMR) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (webUrl: string) => void;
}) {
  const renderCard = (mr: BoardMR, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const reasons = mr.blockers?.any ? statusReasons(mr).split("\n").slice(1) : [];
    return (
          <div
            key={mr.iid}
            className="tui-card"
            style={depth > 0 ? { marginLeft: "0.7rem" } : undefined}
            data-local={local ? "1" : undefined}
            title={local ? "right-click for actions" : undefined}
            onClick={(e) => onRowClick(e, mr)}
            onContextMenu={(e) => onContext(e, mr)}
          >
            <CopyButton text={mrLine(mr, slackTemplates)} className="tui-copy-inline tui-copy-card" title="copy this MR for Slack" />
            <span className="tui-card-label">
              {mr.webUrl && (
                <SelectBox checked={selected.has(mr.webUrl)} onToggle={() => onToggleSelect(mr.webUrl!)} />
              )}
              <StatusDot mr={mr} /> !{mr.iid}
              {ticket && <TicketLink ticket={ticket} />}
            </span>
            <div className="tui-card-title">{cleanTitle(mr.title)}</div>
            <div className="tui-card-branch" title={`${mr.sourceBranch} → ${mr.targetBranch}`}>
              {mr.sourceBranch} <span className="tui-arrow">→</span> {mr.targetBranch}
            </div>
            <div className="tui-card-tokens">
              {showAuthor && <AuthorTag mr={mr} />} <StatusPhrase mr={mr} /> <MetaTokens mr={mr} now={now} />
            </div>
            {hasBoardBadges(mr) && (
              <div className="tui-card-board">
                <ReviewBadge review={(mr as BoardMRWithReview).review} onOpen={() => onOpenReview(mr as BoardMRWithReview)} />
                <RespondBadge respond={(mr as BoardMRWithReview).respond} onResume={() => onResumeRespond(mr)} />
                <DoctorBadge doctor={(mr as BoardMRWithReview).doctor} />
                {((mr as BoardMRWithReview).peerReviews ?? []).map((p) => (
                  <PeerBadge key={p.reviewer} peer={p} />
                ))}
                <NudgeChip nudge={(mr as BoardMRWithReview).sentNudge} />
                <NudgedByMarker nudges={(mr as BoardMRWithReview).nudges} now={now} />
                {((mr as BoardMRWithReview).drafts ?? []).map((d) => (
                  <DraftBadge
                    key={d.kind}
                    draft={d}
                    resolved={draftResolved.get(draftKey(mr.webUrl ?? "", d.kind))}
                    onOpen={() => onOpenDraft(mr as BoardMRWithReview, d)}
                  />
                ))}
                <SlackPostedChip slack={(mr as BoardMRWithReview).slack} />
                <SlackReactionChips reactions={(mr as BoardMRWithReview).slack?.reactions} />
              </div>
            )}
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
  };
  return (
    <div className="tui-grid">
      {nestStacks(mrs).map((node) => {
        if (node.children.length === 0) return renderCard(node.mr, 0);
        const chain = flattenStack(node);
        return (
          <div key={node.mr.iid} className="tui-stack-cluster">
            <div className="tui-stack-label">stack · {chain.length}</div>
            {chain.map(({ mr, depth }) => renderCard(mr, depth))}
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
  scopeUncovered,
}: {
  members: RosterMember[];
  total: number;
  active: string;
  onPick: (member: string) => void;
  onSettings: () => void;
  /** Authors demanded from rt but not yet backfilled -- their counts may be
      undercounts, so the row says so instead of quietly showing a low number. */
  scopeUncovered: string[];
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
            <Invadr id={m.username} palette="css-vars" className="tui-avatar" /> {m.name ?? m.username}
          </span>
          <span className="tui-side-right">
            {scopeUncovered.includes(m.username) && (
              <span className="tui-flag t-warn" title="rt hasn't finished backfilling this author's MRs... the count may be low">
                syncing
              </span>
            )}
            <span className="tui-side-count">{m.count}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

// ── settings modal ─────────────────────────────────────────────────────────

/** Check members in/out, and (on a board that can hand out invites) put each
    teammate on a board of their own. Toggling persists the hidden flag to
    config.json; every peering affordance is conditional, so a board with no
    switchboard renders exactly the roster it always did. */
function SettingsModal({
  members,
  canInvite,
  local,
  peering,
  defaultMember,
  onToggle,
  onJoined,
  onClose,
}: {
  members: ConfigMember[];
  canInvite: boolean;
  /** Joining writes this board's own config and .env, so the row is offered
      only to whoever is at the machine -- POST /peer/join answers a bare
      forbidden through a tunnel, and an affordance that can only fail is worse
      than none. canInvite already folds locality in the same way. */
  local: boolean;
  peering: BoardData["peering"];
  defaultMember: string;
  onToggle: (username: string, hidden: boolean) => void;
  /** A join landed: pull /data.json so peering health and the row catch up. */
  onJoined: () => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);

  // null until GET /peer/boards answers, and it stays null if that fetch fails,
  // so memberPeerState renders nothing rather than calling a peer invitable.
  const [peered, setPeered] = useState<string[] | null>(null);
  const [issued, setIssued] = useState<{ username: string; invite: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [handle, setHandle] = useState("");

  useEffect(() => {
    if (!canInvite) return;
    let live = true;
    fetch("/peer/boards")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        const boards = (b as { boards?: { username: string }[] }).boards ?? [];
        setPeered(boards.map((x) => x.username));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canInvite]);

  // One handler behind every invite / re-invite button, including the free-text
  // one: the server decides what a repeat handle means, not the UI.
  const ask = useCallback((username: string) => {
    const name = username.trim();
    // Guard inside the handler, not just on the buttons: the free-text row's
    // Enter key reaches here directly, and a second POST would burn a second
    // one-time invite. submitJoin guards itself the same way.
    if (!name || pending) return;
    setPending(name);
    setInviteError(null);
    fetch("/peer/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: name }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) {
          // The server's words, verbatim: it knows why this failed and we don't.
          setIssued(null);
          setInviteError(text.trim() || `invite failed (${r.status})`);
          return;
        }
        setIssued({ username: name, invite: (JSON.parse(text) as { invite: string }).invite });
      })
      .catch(() => {
        setIssued(null);
        setInviteError("could not reach the board");
      })
      .finally(() => setPending(null));
  }, [pending]);

  const join = joinRowState(peering !== null, peering);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const joinExpanded = joinOpen || !join.collapsed;

  // Everything this modal reveals lands at its bottom edge, past 80vh on a
  // short window. Key each ref on the state that reveals it, not on the
  // element, so a second invite for a different handle scrolls again.
  const issuedRef = useRevealOnChange<HTMLDivElement>(issued?.invite ?? null);
  const inviteErrorRef = useRevealOnChange<HTMLParagraphElement>(inviteError);
  // Reveal the join row when the user opens it, and when peering is rejected
  // (the warning is why they're here). Not when it's merely open by default on
  // an unconfigured board: that would scroll every settings open to the bottom,
  // past the roster the modal is mostly about.
  const joinRef = useRevealOnChange<HTMLDivElement>(joinOpen || peering === "unauthorized");
  const joinErrorRef = useRevealOnChange<HTMLParagraphElement>(joinError);

  const submitJoin = useCallback(() => {
    const value = joinValue.trim();
    if (!value || joining) return;
    setJoining(true);
    setJoinError(null);
    fetch("/peer/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: value }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) {
          setJoinError(text.trim() || `join failed (${r.status})`);
          return;
        }
        setJoinValue("");
        setJoinOpen(false);
        onJoined();
      })
      .catch(() => setJoinError("could not reach the board"))
      .finally(() => setJoining(false));
  }, [joinValue, joining, onJoined]);

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
          {members.map((m) => {
            const peerState = m.username === defaultMember || !canInvite ? "unknown" : memberPeerState(m.username, peered);
            return (
              <li key={m.username} className={m.hidden ? "tui-modal-row out" : "tui-modal-row"}>
                <label className="tui-modal-name" title={m.hidden ? "checked out -- hidden from the board" : "checked in"}>
                  <input
                    type="checkbox"
                    className="tui-check-box"
                    checked={!m.hidden}
                    onChange={() => onToggle(m.username, !m.hidden)}
                  />
                  <Invadr id={m.username} palette="css-vars" className="tui-avatar" /> {m.name ?? m.username}
                </label>
                <span className="tui-modal-right">
                  {peerState === "peered" && (
                    <>
                      <span className="tui-peered" title="on peer boards">
                        peered
                      </span>
                      <button
                        className="tui-invite-btn"
                        disabled={pending !== null}
                        onClick={() => {
                          // Minting an invite rotates nothing: the peer's board
                          // keeps working until the new invite is redeemed.
                          if (confirm("their current board keeps working until they use the new invite -- continue?")) ask(m.username);
                        }}
                      >
                        re-invite
                      </button>
                    </>
                  )}
                  {peerState === "invitable" && (
                    <button className="tui-invite-btn" disabled={pending !== null} onClick={() => ask(m.username)}>
                      invite
                    </button>
                  )}
                  <span className="tui-modal-count" title={m.count === null ? "checked out -- MR count not fetched" : undefined}>
                    {m.count ?? "—"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {canInvite && (
          <div className="tui-invite-new">
            <input
              className="tui-invite-input"
              value={handle}
              aria-label="username to invite"
              placeholder="username to invite"
              onChange={(e) => setHandle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask(handle);
              }}
            />
            <button className="tui-invite-btn" disabled={pending !== null || !handle.trim()} onClick={() => ask(handle)}>
              invite
            </button>
          </div>
        )}

        {inviteError && (
          <p ref={inviteErrorRef} className="tui-modal-sub tui-invite-error">
            {inviteError}
          </p>
        )}

        {issued && (
          <div ref={issuedRef} className="tui-invite-row">
            <code className="tui-invite-code">{issued.invite}</code>
            <CopyButton text={issued.invite} className="tui-invite-btn" title="copy invite" label="copy invite" />
            <span className="tui-invite-note">for {issued.username} · one-time, expires in 7 days</span>
          </div>
        )}

        {local && (
          <div ref={joinRef} className="tui-join-row">
            {join.warning && <p className="tui-modal-sub tui-join-warning">{join.warning}</p>}
            {joinExpanded ? (
              <>
                <span className="tui-join-label">{join.label}</span>
                <div className="tui-invite-new">
                  <input
                    className="tui-invite-input"
                    value={joinValue}
                    aria-label="paste your board invite"
                    placeholder="paste your board invite"
                    onChange={(e) => setJoinValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitJoin();
                    }}
                  />
                  <button className="tui-invite-btn" disabled={joining || !joinValue.trim()} onClick={submitJoin}>
                    join
                  </button>
                </div>
                {joinError && (
                  <p ref={joinErrorRef} className="tui-modal-sub tui-invite-error">
                    {joinError}
                  </p>
                )}
              </>
            ) : (
              <button className="tui-join-toggle" onClick={() => setJoinOpen(true)}>
                {join.label}
              </button>
            )}
          </div>
        )}
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
  onRefresh,
  refreshing,
  onPostSummary,
  canPostSummary,
  postingSummary,
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
  onRefresh: () => void;
  refreshing: boolean;
  onPostSummary?: () => void;
  canPostSummary?: boolean;
  postingSummary?: boolean;
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
        <button className="tui-drawer-action" onClick={onRefresh} disabled={refreshing}>
          {ICONS.refresh} {refreshing ? "refreshing…" : "refresh now"}
        </button>
        {canCopy && (
          <CopyButton text={summaryText} className="tui-drawer-action" title="copy summary for Slack" label="copy summary" />
        )}
        {canPostSummary && onPostSummary && (
          <button className="tui-drawer-action" onClick={onPostSummary} disabled={postingSummary} title="post this summary to slack">
            {SLACK_ICON} {postingSummary ? "posting…" : "post summary to slack"}
          </button>
        )}
      </>
    );
  }

  // Header: compact inline row.
  return (
    <>
      <button
        className={`tui-copy tui-refresh${refreshing ? " spinning" : ""}`}
        onClick={onRefresh}
        disabled={refreshing}
        title="refresh now"
        aria-label="refresh now"
      >
        {ICONS.refresh}
      </button>
      {canCopy && <CopyButton text={summaryText} className="tui-copy" title="copy summary for Slack" />}
      {group}
      {sort}
      {viewSeg}
      {themeSeg}
    </>
  );
}

/** Shown only while something is selected. Carries the count, an editable
    header line, and the actions retargeted to the selection. */
function SelectionBar({
  selectedMrs,
  inViewCount,
  templates,
  onClear,
  slackPost,
  posting,
}: {
  selectedMrs: BoardMR[];
  inViewCount: number;
  templates: SlackTemplates;
  onClear: () => void;
  /** null when slack is off, remote, or nothing in the selection is postable.
      `count` is what will actually be sent, which is below the selection count
      once some are already in slack. */
  slackPost: { count: number; send: (header?: string) => void } | null;
  /** True while a post is in flight; disables the post button so two fast
      clicks can't put two messages in the channel. The server's duplicate guard
      reads slack-ref files that are only written once a message lands, so it
      does not catch a second click that starts before the first returns. */
  posting?: boolean;
}) {
  const count = selectedMrs.length;
  // Once you type, the line is yours: re-substituting {count} on every check
  // would stomp your edit, so `edited` stays null until the first keystroke.
  // Reset happens by unmount, when the selection empties -- which only works
  // because Board renders this bar conditionally on `selectedMrs.length > 0`.
  // If you ever render it unconditionally (to animate it out, say), you must
  // add an explicit reset when the selection empties.
  const [edited, setEdited] = useState<string | null>(null);
  // selectionHeader owns the copy/post split; its doc comment says why `post`
  // is undefined for an untouched header. Don't collapse the three forms.
  const header = selectionHeader(templates.multiHeader, edited, count);

  // Grow the textarea to fit its content, so a long header wraps into view
  // rather than scrolling sideways out of it. Reset to "auto" first or the box
  // can only ever grow -- scrollHeight is clamped by the current height, so
  // deleting text would leave the extra rows behind.
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight covers content + padding but NOT the border, while the
    // global box-sizing: border-box makes `height` responsible for the border
    // too. Assigning scrollHeight alone therefore leaves the box a border's
    // worth short of its own content, and overflow-y: auto renders a scrollbar
    // for text that actually fits. Measure the border off the element rather
    // than hardcoding the stylesheet's 1px, so it survives a CSS change.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [header.display]);

  return (
    <div className="tui-selbar">
      <div className="tui-selbar-head">
        <span className="tui-selbar-count">▣ {count} selected</span>
        {inViewCount < count && <span className="tui-selbar-note">({inViewCount} in view)</span>}
      </div>
      <textarea
        ref={taRef}
        className="tui-selbar-input"
        rows={1}
        value={header.display}
        maxLength={MAX_HEADER_LEN}
        aria-label="message header"
        placeholder="header line"
        // Enter inserts a real break: the header is multi-line by design, and
        // sanitizeHeader carries the breaks through to the posted message. The
        // box grows to fit, so there is nothing to scroll out of view.
        onChange={(e) => {
          setEdited(e.currentTarget.value);
        }}
      />
      <div className="tui-selbar-actions">
        <CopyButton
          text={boardSummary(selectedMrs, templates, header.copy)}
          className="tui-copy"
          title={`copy ${count} selected for slack`}
          label={`copy ${count}`}
        />
        {slackPost && (
          <button
            className="tui-copy tui-selbar-post"
            onClick={() => slackPost.send(header.post)}
            disabled={posting}
            title="post the selection to slack"
          >
            {SLACK_ICON} {posting ? "posting…" : `post ${slackPost.count}`}
          </button>
        )}
        <button className="tui-copy" onClick={onClear} title="clear the selection">clear</button>
      </div>
    </div>
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
    (fresh = false) =>
      fetch(fresh ? "/data.json?fresh=1" : "/data.json")
        .then((r) => r.json())
        .then((d: BoardData) => {
          if (d.slackEmoji) setSlackMarks(d.slackEmoji);
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

  // Server push: rt relay events land as SSE nudges; re-pull the board.
  // Polling stays as the fallback when the stream is down.
  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = () => {
      if (!document.hidden) load();
    };
    return () => es.close();
  }, [load]);

  // Merge a scoped (single-member) refresh into the current board: replace that
  // member's rows and update their roster count, leaving everyone else untouched.
  const mergeMember = useCallback((username: string, mrs: BoardMRWithReview[], fetchedAt: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const others = prev.mrs.filter((m) => m.author.username !== username);
      const members = prev.members.map((m) => (m.username === username ? { ...m, count: mrs.length } : m));
      return { ...prev, mrs: [...others, ...mrs], members, fetchedAt };
    });
  }, []);

  const fetchMember = useCallback(
    (username: string) =>
      fetch(`/member?u=${encodeURIComponent(username)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((d: { mrs: BoardMRWithReview[]; fetchedAt: number }) => mergeMember(username, d.mrs, d.fetchedAt)),
    [mergeMember],
  );

  // When viewing one person, poll just their MRs every 15s — 1 query instead of
  // the whole team, so a reviewer's comment shows up fast and cheap. The "All"
  // view keeps the slower full poll above.
  useEffect(() => {
    if (state.member === "all") return;
    const member = state.member;
    const timer = setInterval(() => {
      if (!document.hidden) fetchMember(member).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [state.member, fetchMember]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    const task = state.member === "all" ? load(true) : fetchMember(state.member);
    task.catch(() => {}).finally(() => setRefreshing(false));
  }, [state.member, load, fetchMember]);

  // Selection for the multi-copy bar, keyed by webUrl so it survives the
  // refresh poll and every member/group/sort change. Deliberately not
  // persisted: a reload should not hand you yesterday's selection.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((webUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(webUrl)) next.add(webUrl);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Row action menu (right-click) and transient toasts.
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  // The MR whose saved review is open in the modal, if any.
  const [reviewModal, setReviewModal] = useState<BoardMRWithReview | null>(null);
  // The held draft open in its drawer, if any, and the drafts already acted on
  // this session (optimistic — the next /data.json pull drops resolved drafts).
  const [draftModal, setDraftModal] = useState<{ mr: BoardMRWithReview; draft: DraftInfo } | null>(null);
  const [draftResolved, setDraftResolved] = useState<ReadonlyMap<string, "posted" | "dismissed">>(new Map());
  const openDraft = useCallback((mr: BoardMRWithReview, draft: DraftInfo) => setDraftModal({ mr, draft }), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // A drawer action succeeded: swap the chip to its resolved state, close the
  // drawer, and confirm with a toast (the board's transient-confirmation form).
  const handleDraftResolved = useCallback(
    (outcome: "posted" | "dismissed") => {
      if (!draftModal) return;
      const { mr, draft } = draftModal;
      setDraftResolved((prev) => new Map(prev).set(draftKey(mr.webUrl ?? "", draft.kind), outcome));
      setDraftModal(null);
      addToast(outcome === "posted" ? `held note posted to !${mr.iid}` : `held note dismissed on !${mr.iid}`);
    },
    [draftModal, addToast],
  );

  const applyHidden = useCallback((username: string, hidden: boolean) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            // Predict what the reload will send, so nothing flickers when it lands:
            // a checked-out member's MRs aren't fetched, so they have no count.
            allMembers: prev.allMembers.map((m) =>
              m.username === username ? { ...m, hidden, count: hidden ? null : m.count } : m,
            ),
          }
        : prev,
    );
  }, []);

  // Check a member in/out. The box flips locally first and never waits on the
  // network: the POST is quick, but the reload behind it refetches the team from
  // GitLab (~25s, since a checked-in member's MRs aren't in the snapshot). The
  // board catches up when that lands; a failed POST flips the box back.
  const toggleMember = useCallback(
    (username: string, hidden: boolean) => {
      applyHidden(username, hidden);
      fetch("/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, hidden }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`settings failed: ${res.status}`);
          return load();
        })
        .catch(() => {
          applyHidden(username, !hidden);
          addToast(`could not check ${username} ${hidden ? "out" : "in"}`);
        });
    },
    [applyHidden, load, addToast],
  );

  // Optimistic review state: show a "queued" badge the instant a launch is
  // requested, before the server's state file round-trips back via /data.json.
  // Cleared per MR once the server reports any real review status for it.
  const [optimistic, setOptimistic] = useState<Record<string, ReviewInfo>>({});
  /** Same idea for responses -- show a queued state instantly on click. */
  const [optimisticRespond, setOptimisticRespond] = useState<Record<string, RespondInfo>>({});
  const [optimisticDoctor, setOptimisticDoctor] = useState<Record<string, DoctorInfo>>({});

  const openRowMenu = useCallback((e: React.MouseEvent, mr: BoardMR) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, mr });
  }, []);

  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimistic((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`launching review for !${mr.iid}…`);
      fetch("/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimistic((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't launch review for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`review already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimistic((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't launch review for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimistic((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`re-reviewing !${mr.iid}…`);
      fetch("/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, reReview: true, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimistic((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't re-review !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`review already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimistic((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't re-review !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  // Ask a peer's board for a re-review of one of our MRs. No optimistic chip:
  // the server writes the sent-nudge file before answering, so the reload right
  // behind this brings back the real state one poll sooner than guessing would.
  const handleNudge = useCallback(
    (mr: BoardMR, reviewer: string) => {
      if (!mr.webUrl) return;
      addToast(`requesting re-review of !${mr.iid} from ${reviewer}…`);
      fetch("/nudge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, reviewer }),
      })
        .then(async (r) => {
          if (!r.ok) {
            // A permanent refusal (409) answers in plain text with the reason
            // the relay gave -- e.g. the reviewer has no board on the
            // switchboard. That's the whole point of the failure, so show it.
            const why = await r.text().then((t) => t.trim()).catch(() => "");
            addToast(why || `couldn't request re-review for !${mr.iid} (${r.status})`);
            return;
          }
          const body = await r.json().catch(() => ({}));
          if (body?.queued) addToast(`switchboard unreachable... queued the ask to ${reviewer}`);
          load();
        })
        .catch(() => {
          addToast(`couldn't request re-review for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleRespond = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimisticRespond((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`launching response for !${mr.iid}…`);
      fetch("/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimisticRespond((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't launch response for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`response already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimisticRespond((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't launch response for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleResume = useCallback(
    (mr: BoardMR, kind: "review" | "respond", note?: string) => {
      if (!mr.webUrl) return;
      addToast(`resuming ${kind} for !${mr.iid}…`);
      fetch(`/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, resume: true, note }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const msg = await r.text().catch(() => "");
            addToast(`resume ${kind} failed for !${mr.iid} (${r.status})${msg ? `: ${msg}` : ""}`);
            return;
          }
          load();
        })
        .catch(() => addToast(`resume ${kind} failed for !${mr.iid}`));
    },
    [addToast, load],
  );
  const handleResumeReview = useCallback((mr: BoardMR, note?: string) => handleResume(mr, "review", note), [handleResume]);
  const handleResumeRespond = useCallback((mr: BoardMR, note?: string) => handleResume(mr, "respond", note), [handleResume]);

  // Flip one of your own MRs between draft and ready. No optimistic state: the
  // flip lives in GitLab, so the row waits for the reload rather than claiming a
  // change the API might have refused.
  const handleDraftState = useCallback(
    (mr: BoardMR, draft: boolean) => {
      if (!mr.webUrl) return;
      const verb = draft ? "draft" : "ready";
      addToast(`marking !${mr.iid} ${verb}…`);
      fetch("/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, draft }),
      })
        .then(async (r) => {
          if (!r.ok) {
            addToast(`couldn't mark !${mr.iid} ${verb} (${r.status})`);
            return;
          }
          addToast(draft ? `!${mr.iid} is back to draft` : `!${mr.iid} is ready for review`);
          void load(true);
        })
        .catch(() => addToast(`couldn't mark !${mr.iid} ${verb}`));
    },
    [addToast, load],
  );

  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimisticDoctor((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`calling doctor for !${mr.iid}…`);
      fetch("/doctor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimisticDoctor((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't call doctor for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`doctor already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimisticDoctor((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't call doctor for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleCopy = useCallback(
    (mr: BoardMR) => {
      const text = data ? mrLine(mr, data.slackTemplates) : mr.webUrl ?? mr.title;
      navigator.clipboard?.writeText(text).then(
        () => addToast(`copied !${mr.iid} for slack`),
        () => {},
      );
    },
    [addToast, data],
  );

  const [postingSummary, setPostingSummary] = useState(false);

  const handlePostSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`posting !${mr.iid} to slack…`);
      fetch("/slack/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrls: [mr.webUrl] }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack post failed for !${mr.iid} (${r.status})`);
          addToast(body?.linked ? `!${mr.iid} already in slack — linked` : `posted !${mr.iid} to slack`);
          load();
        })
        .catch(() => addToast(`slack post failed for !${mr.iid}`));
    },
    [addToast, load],
  );

  /** `onPosted` runs only when the message actually landed -- the selection bar
      uses it to clear the selection, and a failed post must leave the selection
      intact so the user can retry. */
  const handlePostSummary = useCallback(
    (mrs: BoardMR[], header?: string, onPosted?: () => void) => {
      const urls = mrs.map((m) => m.webUrl).filter((u): u is string => !!u);
      if (!urls.length) return;
      setPostingSummary(true);
      addToast(`posting ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack…`);
      fetch("/slack/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(header ? { mrUrls: urls, header } : { mrUrls: urls }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack post failed (${r.status})${typeof body === "string" ? `: ${body}` : ""}`);
          addToast(`posted ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack`);
          onPosted?.();
          load();
        })
        .catch(() => addToast(`slack post failed`))
        .finally(() => setPostingSummary(false));
    },
    [addToast, load],
  );

  const handleResolveSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`finding slack thread for !${mr.iid}…`);
      fetch("/slack/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack lookup failed for !${mr.iid} (${r.status})`);
          addToast(body.status === "found" ? `found slack thread for !${mr.iid}` : `no slack thread found for !${mr.iid}`);
          load();
        })
        .catch(() => addToast(`slack lookup failed for !${mr.iid}`));
    },
    [addToast, load],
  );

  const handleReactSlack = useCallback(
    (mr: BoardMR, emoji: string, remove: boolean): Promise<string[] | null> => {
      if (!mr.webUrl) return Promise.resolve(null);
      const glyph = getSlackMarks().find((m) => m.emoji === emoji)?.glyph ?? emoji;
      const verb = remove ? "unmark" : "add";
      return fetch("/slack/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, emoji, remove }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            addToast(`couldn't ${verb} ${glyph} for !${mr.iid} (${r.status})`);
            return null;
          }
          addToast(`${remove ? "unmarked" : "marked"} ${glyph} on !${mr.iid}`);
          load();
          return (body.reactions as string[]) ?? null;
        })
        .catch(() => {
          addToast(`couldn't ${verb} ${glyph} for !${mr.iid}`);
          return null;
        });
    },
    [addToast, load],
  );

  // Drop optimistic entries once the server has a real review for that MR.
  useEffect(() => {
    if (!data) return;
    setOptimistic((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).review && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
    setOptimisticRespond((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).respond && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
    setOptimisticDoctor((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).doctor && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
  }, [data]);

  // Poll faster while a review or response is running, so the badge updates
  // promptly instead of waiting for the normal 60s cadence.
  const reviewActive =
    Object.values(optimistic).some((r) => r.status === "queued" || r.status === "reviewing") ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).review?.status;
        return s === "queued" || s === "reviewing";
      }));
  const respondActive =
    Object.values(optimisticRespond).some((r) => RESPOND_ACTIVE.has(r.status)) ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).respond?.status;
        return !!s && RESPOND_ACTIVE.has(s);
      }));
  const doctorActive =
    Object.values(optimisticDoctor).some((r) => DOCTOR_ACTIVE.has(r.status)) ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).doctor?.status;
        return !!s && DOCTOR_ACTIVE.has(s);
      }));

  useEffect(() => {
    if (!reviewActive && !respondActive && !doctorActive) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [reviewActive, respondActive, doctorActive, load]);

  if (!data) {
    return <p className="tui-loading">{loadError ? "✗ failed to load board data" : "fetching…"}</p>;
  }

  const total = data.members.reduce((n, m) => n + m.count, 0);
  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();
  const dataAge = dataAgeLabel(data.dataSyncedAt, now);
  // Both known and the board asks for more history than rt actually syncs --
  // config drift the board can't self-correct, so it needs to be visible.
  const windowMismatch =
    data.scopeWindowDays !== null && data.staleAfterDays > data.scopeWindowDays
      ? `board shows ${data.staleAfterDays} days but rt syncs ${data.scopeWindowDays} days... align configs`
      : null;

  // Server review wins; otherwise show an optimistic "queued" badge if pending.
  const mrs = data.mrs.map((mr) => {
    const mrx = mr as BoardMRWithReview;
    const optRev = mr.webUrl ? optimistic[mr.webUrl] : undefined;
    const optResp = mr.webUrl ? optimisticRespond[mr.webUrl] : undefined;
    const optDoc = mr.webUrl ? optimisticDoctor[mr.webUrl] : undefined;
    let next: BoardMRWithReview = mrx;
    if (!mrx.review && optRev) next = { ...next, review: optRev };
    if (!mrx.respond && optResp) next = { ...next, respond: optResp };
    if (!mrx.doctor && optDoc) next = { ...next, doctor: optDoc };
    return next;
  });
  const filtered = filterByMember(mrs, state.member);
  const groups = groupMRs(filtered, state.group, data.members.map((m) => m.username), now).map((g) => ({
    label: g.label,
    mrs: sortMRs(g.mrs, state.sort),
  }));
  const activeMember = state.member === "all" ? null : data.members.find((m) => m.username === state.member) ?? null;
  // Show each row's author only when the view mixes authors: the All view
  // grouped by anything but author (where the group header isn't the name).
  const showAuthor = state.member === "all" && state.group !== "author";
  const flatMrs = groups.flatMap((g) => g.mrs);
  // Drawn from `mrs`, not `filtered` -- that's what lets a selection span
  // member filters.
  const selectedMrs = selectionOf(mrs, selected);
  const summaryText = boardSummary(flatMrs, data.slackTemplates);
  const postableMrs = postableOf(flatMrs as BoardMRWithReview[]);
  const postableSelected = postableOf(selectedMrs as BoardMRWithReview[]);
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
    // The bar owns copy while a selection is live -- its header input has to
    // sit next to the button that consumes it.
    canCopy: filtered.length > 0 && selectedMrs.length === 0,
    summaryText,
    onRefresh: refreshNow,
    refreshing,
    canPostSummary: data.slackEnabled && data.local && postableMrs.length > 0,
    postingSummary,
    onPostSummary: () => handlePostSummary(postableMrs),
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
        scopeUncovered={data.scopeUncovered}
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

        {selectedMrs.length > 0 && (
          <SelectionBar
            selectedMrs={selectedMrs}
            inViewCount={selectionOf(filtered, selected).length}
            templates={data.slackTemplates}
            onClear={clearSelection}
            posting={postingSummary}
            slackPost={
              data.slackEnabled && data.local && postableSelected.length > 0
                ? {
                    count: postableSelected.length,
                    // Clear only on success: the posted MRs drop out of
                    // postableSelected, so leaving them checked would sit the
                    // bar there with no post button and read like a bug.
                    send: (header) => handlePostSummary(postableSelected, header, clearSelection),
                  }
                : null
            }
          />
        )}

        {data.fetchError && <div className="tui-banner">⚠ data from {staleMins}m ago — gitlab fetch failing</div>}
        {windowMismatch && <div className="tui-banner">⚠ {windowMismatch}</div>}

        {filtered.length === 0 && !data.fetchError ? (
          <p className="tui-empty">nothing waiting on review ✓</p>
        ) : (
          groups.map((g) => (
            <Panel key={g.label} title={g.label} count={g.mrs.length}>
              {view === "rows" ? (
                <RowView mrs={g.mrs} now={now} showAuthor={showAuthor} local={data.local} slackTemplates={data.slackTemplates} onContext={openRowMenu} onOpenReview={setReviewModal} onOpenDraft={openDraft} draftResolved={draftResolved} onResumeRespond={handleResumeRespond} selected={selected} onToggleSelect={toggleSelect} />
              ) : (
                <GridView mrs={g.mrs} now={now} showAuthor={showAuthor} local={data.local} slackTemplates={data.slackTemplates} onContext={openRowMenu} onOpenReview={setReviewModal} onOpenDraft={openDraft} draftResolved={draftResolved} onResumeRespond={handleResumeRespond} selected={selected} onToggleSelect={toggleSelect} />
              )}
            </Panel>
          ))
        )}

        <footer className={dataAge.stale ? "tui-footer tui-footer-stale" : "tui-footer"}>{dataAge.text}</footer>
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
              scopeUncovered={data.scopeUncovered}
            />
            <div className="tui-drawer-controls">
              <Controls {...controlProps} stacked />
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          members={data.allMembers}
          canInvite={data.canInvite}
          local={data.local}
          peering={data.peering}
          defaultMember={data.defaultMember}
          onToggle={toggleMember}
          onJoined={() => load()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {rowMenu && (
        <RowMenu
          menu={rowMenu}
          local={data.local}
          slackEnabled={data.slackEnabled}
          onClose={() => setRowMenu(null)}
          onLaunch={handleLaunch}
          onReReview={handleReReview}
          onOpenReview={setReviewModal}
          onCopy={handleCopy}
          onResolveSlack={handleResolveSlack}
          onReactSlack={handleReactSlack}
          onPostSlack={handlePostSlack}
          onRespond={handleRespond}
          canRespond={rowMenu.mr.author.username === data.defaultMember}
          onDoctor={handleDoctor}
          // Doctor is mechanical repair (rebase / CI), so it's offered for anyone's
          // MR that's actually broken — not gated to your own MRs the way respond is.
          canDoctor={!!(rowMenu.mr.blockers?.pipelineFailing || rowMenu.mr.blockers?.hasConflicts)}
          onDraftState={handleDraftState}
          // Your own MRs only, both directions. buildBoard already hides other
          // people's drafts, but their ready MRs are on the board, so this gate
          // is what keeps "mark as draft" off them.
          canDraftState={rowMenu.mr.author.username === data.defaultMember}
          onNudge={handleNudge}
          // Your own MRs only: a nudge asks a peer to re-review YOUR work, and
          // the server enforces the same gate (403 "not your MR").
          canNudge={rowMenu.mr.author.username === data.defaultMember}
          onResumeReview={handleResumeReview}
          onResumeRespond={handleResumeRespond}
        />
      )}

      {reviewModal && <ReviewModal mr={reviewModal} onClose={() => setReviewModal(null)} />}

      {draftModal && (
        <DraftModal
          mr={draftModal.mr}
          draft={draftModal.draft}
          local={data.local}
          onResolved={handleDraftResolved}
          onClose={() => setDraftModal(null)}
        />
      )}

      <ToastHost toasts={toasts} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Board />
  </StrictMode>,
);
