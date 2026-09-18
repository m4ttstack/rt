import { getReviewDisplayState } from '@mattstack/glance';
import type { BoardMR } from '../../data.ts';
import { stripDraftPrefix } from '../../data.ts';
import type { RespondStatus } from '../../respond-outcome.ts';
import { DEFAULT_SLACK_EMOJI } from '../../slack-emoji.ts';
import {
  renderMr,
  renderMulti,
  type MrFacts,
  type SlackTemplates,
} from '../../template.ts';
import { extractTicketId } from '../../ticket.ts';
import type { GroupKey, SortKey } from '../../view.ts';
import type {
  BoardMRWithReview,
  DoctorStatus,
  PeerReviewInfo,
  ReviewStatus,
  SentNudgeInfo,
  ThreadStatus,
} from '../types.ts';
import type { SlackStage } from './slack-ladder.ts';

const GROUP_LABEL: Record<GroupKey, string> = {
  age: 'age',
  author: 'author',
  status: 'status',
  review: 'my reviews',
  needs: 'need',
};
const SORT_LABEL: Record<SortKey, string> = {
  oldest: 'oldest',
  progress: 'progress',
};

// ── formatting helpers ─────────────────────────────────────────────────────

function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function activeReviewers(mr: BoardMR): string[] {
  // getReviewDisplayState maps the raw reviewState to the UI taxonomy; the SDK
  // never populates r.displayState, so derive it rather than reading that field.
  return mr.reviews.reviewers
    .filter(r => getReviewDisplayState(r.reviewState ?? null) === 'reviewing')
    .map(r => r.name || r.username);
}

/** Drop what the row already says elsewhere: the leading ticket id (the ticket
    link carries it) and any draft marker (the DRAFT chip carries that). glance
    already strips the marker off GitLab titles, so the draft pass is only a
    guard for titles that arrive with it still attached. */
function cleanTitle(title: string): string {
  const undrafted = stripDraftPrefix(title);
  return undrafted.replace(/^[A-Za-z]+-\d+:\s*/, '') || undrafted;
}

/** The row's title: `cleanTitle` plus the ticket the facts line now carries
    as a link, so the id never appears twice one line apart. Row-only: the
    Slack templates' `{title}` keeps the id, which the team reads in Slack. */
function rowTitle(title: string, ticket: string | null): string {
  const clean = cleanTitle(title);
  if (!ticket) return clean;
  const escaped = ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean.replace(new RegExp(`^${escaped}\\b[:\\s-]*`, 'i'), '') || clean;
}

const RESPOND_ACTIVE = new Set<RespondStatus>([
  'queued',
  'triaging',
  'implementing',
  'drafting',
]);

const DOCTOR_LABEL: Record<DoctorStatus, string> = {
  queued: 'doctor queued',
  diagnosing: 'diagnosing…',
  rebasing: 'rebasing…',
  fixing: 'fixing…',
  watching: 'watching CI…',
  // "diagnosed", not "healed": the board can't tell a real repair from a run
  // that only inherited a diagnosis and held a note, so the label claims only
  // what every finished run actually did.
  done: 'diagnosed',
  error: 'doctor stuck',
};

const DOCTOR_ACTIVE = new Set<DoctorStatus>([
  'queued',
  'diagnosing',
  'rebasing',
  'fixing',
  'watching',
]);

// ── peer switchboard ────────────────────────────────────────────────────────

/** Nudge states that leave the ask unanswered, so asking again is the honest
    next move. Shared by the status line's wording and the menu item's
    condition -- the item reappearing IS the retry affordance. */
const NUDGE_RETRYABLE = new Set<SentNudgeInfo['display']>([
  'rejected',
  'expired',
  'no-response',
]);

/** Peers we can ask to look again: their review finished with comments (so
    there's something to re-check) and no ask of ours is still outstanding. */
function nudgeTargets(mrx: BoardMRWithReview): PeerReviewInfo[] {
  if (mrx.sentNudge && !NUDGE_RETRYABLE.has(mrx.sentNudge.display)) return [];
  return (mrx.peerReviews ?? []).filter(
    p => p.status === 'done' && p.outcome === 'comment'
  );
}

/** Roster members an author can ask for a first look: not the author, not a
    peer already engaged with this MR (any reported state counts as engaged),
    and nobody while an ask of ours is still outstanding -- one ask per MR,
    whatever its kind, mirroring the sent-nudge store. */
function firstReviewTargets(
  mrx: BoardMRWithReview,
  roster: readonly string[]
): string[] {
  if (mrx.sentNudge && !NUDGE_RETRYABLE.has(mrx.sentNudge.display)) return [];
  const engaged = new Set((mrx.peerReviews ?? []).map(p => p.reviewer));
  engaged.add(mrx.author.username);
  return roster.filter(u => !engaged.has(u));
}

/** Whom a respond ask can go to: the MR's author, once my own review lane
    finished with comments (so there is feedback to answer) and while no ask
    of mine is outstanding on this MR. */
function respondAskTarget(mrx: BoardMRWithReview): string | null {
  if (mrx.sentNudge && !NUDGE_RETRYABLE.has(mrx.sentNudge.display)) return null;
  const r = mrx.review;
  if (!r || r.status !== 'done' || r.outcome !== 'comment') return null;
  return mrx.author.username;
}

/** Key for the App-level map of optimistically resolved drafts. Resolution
    lives above the badge because the acting happens in DraftModal; the next
    /data.json pull drops the draft and the stale entry is harmless. */
function draftKey(mrUrl: string, kind: string): string {
  return `${mrUrl}#${kind}`;
}

// ── row action menu (right-click) ────────────────────────────────────────────

/** The three review-signal reactions, in ladder order. The stage, glyph and
    wording are fixed per role; the emoji *name* sent to Slack comes from the
    server's configured `slack.emoji` map (standard-emoji defaults until data
    loads). */
interface SlackMark {
  stage: SlackStage;
  emoji: string;
  glyph: string;
  /** The stage as a word, for the menu's "mark as looking" wording. */
  word: string;
  title: string;
}

function buildSlackMarks(e: {
  looking: string;
  commented: string;
  approved: string;
}): SlackMark[] {
  return [
    {
      stage: 'looking',
      emoji: e.looking,
      glyph: '👀',
      word: 'looking',
      title: "someone's looking (in slack)",
    },
    {
      stage: 'commented',
      emoji: e.commented,
      glyph: '💬',
      word: 'commented',
      title: 'commented in slack',
    },
    {
      stage: 'approved',
      emoji: e.approved,
      glyph: '✅',
      word: 'approved',
      title: 'approved in slack',
    },
  ];
}

/** Module-level so every component reads the same list; rebuilt when /data.json
    arrives (which always precedes a re-render of anything that shows marks). */
let SLACK_MARKS = buildSlackMarks(DEFAULT_SLACK_EMOJI);

/** Read the current review-signal marks. Accessor rather than a bare export so
    a later reassignment (see `setSlackMarks`) is visible to every caller —
    module bindings re-exported directly freeze at the value seen on import. */
function getSlackMarks(): SlackMark[] {
  return SLACK_MARKS;
}

/** Rebuild the marks from the server's configured emoji names. The board's
    data load calls this once per /data.json pull; kept as the one writer so
    the marks never drift between a chips module and the row menu. */
function setSlackMarks(emoji: {
  looking: string;
  commented: string;
  approved: string;
}): void {
  SLACK_MARKS = buildSlackMarks(emoji);
}

// ── slack summary ───────────────────────────────────────────────────────────

function factsFor(mr: BoardMR): MrFacts {
  return {
    iid: mr.iid,
    title: cleanTitle(mr.title),
    url: mr.webUrl ?? '',
    ticket: extractTicketId(mr.sourceBranch, mr.title) ?? '',
    author: mr.author.username,
    sourceBranch: mr.sourceBranch,
    targetBranch: mr.targetBranch,
  };
}

/** One MR rendered from the configured single template. */
function mrLine(mr: BoardMR, tpl: SlackTemplates): string {
  return renderMr(tpl.single, factsFor(mr));
}

/** The current view (or the current selection) rendered from the configured
    multi template. `header` overrides the configured header line; {count} in
    it is still substituted by renderMulti. */
function boardSummary(
  mrs: BoardMR[],
  tpl: SlackTemplates,
  header?: string
): string {
  return renderMulti(
    header ?? tpl.multiHeader,
    tpl.multiItem,
    mrs.map(factsFor)
  );
}

const THREAD_ICON: Record<ThreadStatus, string> = {
  resolved: '✓',
  replied: '↩',
  awaiting: '●',
};
const THREAD_LABEL: Record<ThreadStatus, string> = {
  resolved: 'resolved',
  replied: 'author replied',
  awaiting: 'awaiting author',
};

/** The review launch items for a row, by current review state. `re-review` is
    available whenever a review isn't actively running — even with no prior board
    review (it degrades to a generic re-review) — so it covers MRs a human reviewed
    outside the board. A live review collapses to a single "focus review tab" —
    or "relaunch review pane" once the sweep says the pane is gone, since the
    same focus route re-opens a dead pane and "focus" would undersell it. */
/** The review items for the menu, worded like the row's verbs. Re-review
    is offered only once a review is logged: the board's own finished one,
    or a person's on GitLab (`reviewLogged`); cold, it would be a second
    launch button. */
function reviewMenuItems(
  status?: ReviewStatus,
  interrupted?: boolean,
  logged = false
): Array<{ kind: 'launch' | 're-review'; label: string }> {
  if (status === 'queued' || status === 'reviewing')
    return [
      {
        kind: 'launch',
        label: interrupted ? 'relaunch review' : 'focus review',
      },
    ];
  if (status === 'done') return [{ kind: 're-review', label: 're-review' }];
  const items: Array<{ kind: 'launch' | 're-review'; label: string }> = [
    { kind: 'launch', label: 'review' },
  ];
  if (logged) items.push({ kind: 're-review', label: 're-review' });
  return items;
}

/** Whether anyone has reviewed the MR on GitLab: a reviewer who commented,
    approved or requested changes, an approval on the tally, or reviewer
    threads. The thing a re-review would re-check. */
function reviewLogged(mr: BoardMR): boolean {
  const states = new Set(['REVIEWED', 'APPROVED', 'REQUESTED_CHANGES']);
  return (
    mr.reviews.given > 0 ||
    mr.reviewerComments > 0 ||
    (mr.reviews.reviewers ?? []).some(
      r => !!r.reviewState && states.has(r.reviewState)
    )
  );
}

function respondItemLabel(
  status?: RespondStatus,
  interrupted?: boolean
): string {
  if (!status || status === 'error') return 'respond';
  if (status === 'done') return 'restart response';
  return interrupted ? 'relaunch response' : 'focus response';
}

function doctorItemLabel(status?: DoctorStatus): string {
  if (!status || status === 'error') return 'call doctor';
  if (status === 'done') return 'call doctor again';
  return 'focus doctor';
}

/** Whether a lane (review/respond) was cut down by its executor pane dying:
    the row's orphan is `gone` and the lane is the one it ran. When both
    sides recorded a session id, the ids must agree -- a lane relaunched on
    a fresh session is not interrupted by its predecessor's corpse. When
    either side lacks one (a queued lane, a subject-matched orphan), the
    gone executor is the best signal available and applies. */
function laneInterrupted(
  orphan: { state: string; sessionId?: string | null } | undefined,
  lane: { sessionId?: string | null } | undefined
): boolean {
  if (orphan?.state !== 'gone' || !lane) return false;
  if (lane.sessionId && orphan.sessionId)
    return lane.sessionId === orphan.sessionId;
  return true;
}

/** The GitLab-side actions the row menu offers for this MR, driven by the
    view-model button state glance already computed. The rebase item also
    raises on plain behind-ness: glance keeps rebaseButton mirroring GitLab's
    own button (MAT-164), and the "freshen a merely-behind branch" affordance
    is exactly what the board wants beyond that. */
function gitlabMenuItems(mr: BoardMR): {
  kind: 'merge' | 'rebase' | 'setAutoMerge' | 'cancelAutoMerge';
  label: string;
  disabled: boolean;
}[] {
  const items: ReturnType<typeof gitlabMenuItems> = [];
  if (mr.mergeButton.visible)
    items.push({
      kind: 'merge',
      label: 'merge',
      disabled: mr.mergeButton.disabled || mr.mergeButton.loading,
    });
  if (mr.rebaseButton.visible || (mr.behindTarget ?? 0) > 0)
    items.push({
      kind: 'rebase',
      label: 'rebase on target',
      disabled: mr.rebaseButton.loading,
    });
  if (mr.autoMergeButton.visible)
    items.push(
      mr.autoMergeButton.isActive
        ? {
            kind: 'cancelAutoMerge',
            label: 'cancel auto-merge',
            disabled: false,
          }
        : { kind: 'setAutoMerge', label: 'set auto-merge', disabled: false }
    );
  return items;
}

export {
  GROUP_LABEL,
  SORT_LABEL,
  ago,
  activeReviewers,
  cleanTitle,
  rowTitle,
  RESPOND_ACTIVE,
  DOCTOR_LABEL,
  DOCTOR_ACTIVE,
  NUDGE_RETRYABLE,
  gitlabMenuItems,
  laneInterrupted,
  type SlackMark,
  nudgeTargets,
  firstReviewTargets,
  respondAskTarget,
  draftKey,
  getSlackMarks,
  setSlackMarks,
  mrLine,
  boardSummary,
  THREAD_ICON,
  THREAD_LABEL,
  reviewMenuItems,
  reviewLogged,
  respondItemLabel,
  doctorItemLabel,
};
