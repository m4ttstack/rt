import { respondOutcome, respondDoneLabel, respondNeedsAttention } from "../../respond-outcome.ts";
import {
  REVIEW_LABEL,
  RESPOND_LABEL,
  DOCTOR_LABEL,
  PEER_PHRASE,
  peerState,
  NUDGE_RETRYABLE,
  nudgeChipText,
  getSlackMarks,
  ago,
} from "./format.ts";
import type {
  ReviewInfo,
  RespondInfo,
  DoctorInfo,
  PeerReviewInfo,
  SentNudgeInfo,
  InboundNudgeInfo,
  DraftInfo,
  SlackInfo,
} from "../types.ts";

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

export {
  BADGE_ICON,
  ReviewBadge,
  RespondBadge,
  DoctorBadge,
  PEER_GLYPH,
  PeerBadge,
  NudgeChip,
  NudgedByMarker,
  DraftBadge,
  SlackReactionChips,
  SlackPostedChip,
  SLACK_ICON,
};
