import { getReviewDisplayState } from '@mattstack/glance';
import type { BoardMR } from '../../data.ts';
import { hasChangesRequested, stripDraftPrefix } from '../../data.ts';
import type { RespondOutcome, RespondStatus } from '../../respond-outcome.ts';
import {
  renderMr,
  renderMulti,
  type MrFacts,
  type SlackTemplates,
} from '../../template.ts';
import { extractTicketId } from '../../ticket.ts';
import {
  commentsAllResolved,
  type GroupKey,
  type SortKey,
  type StackNode,
} from '../../view.ts';
import type {
  BoardMRWithReview,
  DoctorStatus,
  PeerReviewInfo,
  ReviewStatus,
  SentNudgeInfo,
  ThreadStatus,
} from '../types.ts';

const GROUP_LABEL: Record<GroupKey, string> = {
  age: 'age',
  author: 'author',
  status: 'status',
  review: 'my reviews',
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

function statusReasons(mr: BoardMR): string {
  const b = mr.blockers;
  if (!b?.any) return 'ready to merge';
  const reasons: string[] = [];
  if (b.isDraft) reasons.push('marked as draft');
  if (b.hasConflicts) reasons.push('merge conflicts with target branch');
  if (b.needsRebase) reasons.push('source branch needs a rebase');
  if (b.pipelineFailing) reasons.push('pipeline is failing');
  if (b.pipelineRunning) reasons.push('pipeline still running');
  if (b.awaitingApprovals)
    reasons.push(
      `awaiting approvals (${mr.reviews.given}/${mr.reviews.required})`
    );
  if (b.hasUnresolvedDiscussions)
    reasons.push(`unresolved discussions (${mr.unresolvedThreads})`);
  if (b.hasMergeError)
    reasons.push(`merge error: ${b.mergeError ?? 'unknown'}`);
  return reasons.length
    ? `blocked:\n${reasons.map(r => `· ${r}`).join('\n')}`
    : 'blocked';
}

function activeReviewers(mr: BoardMR): string[] {
  // getReviewDisplayState maps the raw reviewState to the UI taxonomy; the SDK
  // never populates r.displayState, so derive it rather than reading that field.
  return (mr.reviews?.reviewers ?? [])
    .filter(r => getReviewDisplayState(r.reviewState ?? null) === 'reviewing')
    .map(r => r.name || r.username);
}

/** Title with any leading ticket prefix ("ACME-2369: ") removed — the ticket
    already shows via the Linear link and the branch name. */
/** Drop what the row already says elsewhere: the leading ticket id (the ticket
    link carries it) and any draft marker (the DRAFT chip carries that). glance
    already strips the marker off GitLab titles, so the draft pass is only a
    guard for titles that arrive with it still attached. */
function cleanTitle(title: string): string {
  return stripDraftPrefix(title).replace(/^[A-Za-z]+-\d+:\s*/, '');
}

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  queued: 'review queued',
  reviewing: 'reviewing…',
  done: 'review ready',
  error: 'review failed',
};

// `done` is deliberately absent: what a finished run should say depends on what
// it did with its replies, which respondDoneLabel derives from the counts.
const RESPOND_LABEL: Record<Exclude<RespondStatus, 'done'>, string> = {
  queued: 'response queued',
  triaging: 'triaging…',
  implementing: 'implementing…',
  drafting: 'drafting replies…',
  error: 'response failed',
};

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

/** The peer-review states this board has words for. A status it doesn't
    recognise renders nothing at all, rather than putting a mystery word from
    another board's vocabulary on the row. */
type PeerState = 'reviewing' | 'commented' | 'approved' | 'done';

const PEER_PHRASE: Record<PeerState, string> = {
  reviewing: 'reviewing',
  commented: 'commented',
  approved: 'approved',
  done: 'reviewed',
};

/** A `done` review with no outcome is the peer's human never answering their
    posting gate, so it reads as a plain "reviewed": it is finished, but it is
    not an approval. */
function peerState(peer: PeerReviewInfo): PeerState | null {
  if (peer.status === 'queued' || peer.status === 'reviewing')
    return 'reviewing';
  if (peer.status !== 'done') return null;
  if (peer.outcome === 'comment') return 'commented';
  if (peer.outcome === 'approve') return 'approved';
  return 'done';
}

/** Nudge states that leave the ask unanswered, so asking again is the honest
    next move. Shared by the chip's hint and the menu item's condition -- the
    item reappearing IS the retry affordance. */
const NUDGE_RETRYABLE = new Set<SentNudgeInfo['display']>([
  'rejected',
  'expired',
  'no-response',
]);

/** What a sent nudge reads as. A refusal carries the peer's own reason where
    they gave one, since "why not" is the only part a human can act on. */
function nudgeChipText(nudge: SentNudgeInfo): string {
  switch (nudge.display) {
    case 'requested':
      return 're-review requested';
    case 'confirmed':
    case 'launched':
      return 're-reviewing';
    case 'rejected':
    case 'expired':
      return `nudge: ${nudge.reason ?? nudge.display}`;
    case 'no-response':
      return 'no response, retry?';
  }
}

/** Peers we can ask to look again: their review finished with comments (so
    there's something to re-check) and no ask of ours is still outstanding. */
function nudgeTargets(mrx: BoardMRWithReview): PeerReviewInfo[] {
  if (mrx.sentNudge && !NUDGE_RETRYABLE.has(mrx.sentNudge.display)) return [];
  return (mrx.peerReviews ?? []).filter(
    p => p.status === 'done' && p.outcome === 'comment'
  );
}

// ── chip cell contract ──────────────────────────────────────────────────────

/** The one vocabulary a respond chip's cell can carry. A finished run shows
    its DERIVED outcome and an unfinished one its raw status, so `done` is the
    single respond word that never reaches a chip, and every outcome word does. */
type RespondCell = Exclude<RespondStatus, 'done'> | RespondOutcome;

/** THE CHIP CELL CONTRACT, and the only place it is written down.

    Every status chip stamps its state word into a `data-*` attribute
    (`data-review`, `data-respond`, `data-doctor`, `data-peer`, `data-nudge`)
    and style.css keys a dozen colour rules and three dim rules off those exact
    words. CSS selectors are invisible to a typechecker, so the words are
    pinned from three sides instead:

      - `satisfies` below ties every word to the SAME union its stamp site is
        keyed on (chips.tsx's intent maps are `Record<ReviewStatus, …>` and
        friends), so a typo here stops compiling;
      - `UnlistedCellWord` makes each list EXHAUSTIVE over its union, so a new
        lifecycle state cannot be added without landing here — and, from here,
        without someone deciding whether it needs a colour rule of its own or
        inherits the neutral chip;
      - client-format.test.ts asserts the same equality at runtime against the
        label maps above, which is what catches a word renamed in one
        vocabulary and not the other.

    Deliberately not consumed by the render path: this is a contract, not a
    lookup. The render path reads each state word off the MR. */
const CHIP_CELL_WORDS = {
  review: ['queued', 'reviewing', 'done', 'error'],
  respond: [
    'queued',
    'triaging',
    'implementing',
    'drafting',
    'error',
    'posted',
    'partial',
    'drafted',
    'none',
    'unknown',
  ],
  doctor: [
    'queued',
    'diagnosing',
    'rebasing',
    'fixing',
    'watching',
    'done',
    'error',
  ],
  peer: ['reviewing', 'commented', 'approved', 'done'],
  nudge: [
    'requested',
    'confirmed',
    'launched',
    'rejected',
    'expired',
    'no-response',
  ],
} as const satisfies {
  review: readonly ReviewStatus[];
  respond: readonly RespondCell[];
  doctor: readonly DoctorStatus[];
  peer: readonly PeerState[];
  nudge: readonly SentNudgeInfo['display'][];
};

/** Every state word NOT listed above — `never` while the table is complete. */
type UnlistedCellWord =
  | Exclude<ReviewStatus, (typeof CHIP_CELL_WORDS.review)[number]>
  | Exclude<RespondCell, (typeof CHIP_CELL_WORDS.respond)[number]>
  | Exclude<DoctorStatus, (typeof CHIP_CELL_WORDS.doctor)[number]>
  | Exclude<PeerState, (typeof CHIP_CELL_WORDS.peer)[number]>
  | Exclude<SentNudgeInfo['display'], (typeof CHIP_CELL_WORDS.nudge)[number]>;

/** The exhaustiveness half, as a compile error rather than a convention: the
    annotation resolves to `true` only while `UnlistedCellWord` is `never`, so a
    state word missing from the table turns this into "`true` is not assignable
    to `never`" — and the hover text on `UnlistedCellWord` names the word. */
const _everyCellWordIsListed: [UnlistedCellWord] extends [never]
  ? true
  : never = true;
void _everyCellWordIsListed;

/** Key for the App-level map of optimistically resolved drafts. Resolution
    lives above the badge because the acting happens in DraftModal; the next
    /data.json pull drops the draft and the stale entry is harmless. */
function draftKey(mrUrl: string, kind: string): string {
  return `${mrUrl}#${kind}`;
}

// ── row action menu (right-click) ────────────────────────────────────────────

/** The three review-signal reactions, in menu order. The glyph and wording are
    fixed per role; the emoji *name* sent to Slack comes from the server's
    configured `slack.emoji` map (standard-emoji defaults until data loads). */
interface SlackMark {
  emoji: string;
  glyph: string;
  label: string;
  title: string;
}

function buildSlackMarks(e: {
  looking: string;
  commented: string;
  approved: string;
}): SlackMark[] {
  return [
    {
      emoji: e.looking,
      glyph: '👀',
      label: 'mark 👀 on slack',
      title: "someone's looking (in slack)",
    },
    {
      emoji: e.commented,
      glyph: '💬',
      label: 'mark 💬 on slack',
      title: 'commented in slack',
    },
    {
      emoji: e.approved,
      glyph: '✅',
      label: 'mark ✅ on slack',
      title: 'approved in slack',
    },
  ];
}

/** Module-level so every component reads the same list; rebuilt when /data.json
    arrives (which always precedes a re-render of anything that shows marks). */
let SLACK_MARKS = buildSlackMarks({
  looking: 'eyes',
  commented: 'speech_balloon',
  approved: 'white_check_mark',
});

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

function hasReviewReactions(mr: BoardMR): boolean {
  const reactions = (mr as BoardMRWithReview).slack?.reactions;
  if (!reactions?.length) return false;
  return SLACK_MARKS.some(m => reactions.includes(m.emoji));
}

/** Does this MR have anything for the board-managed badge line? Rows and cards
    share the test so a new axis can't land on one view and miss the other. */
function hasBoardBadges(mr: BoardMR): boolean {
  const mrx = mr as BoardMRWithReview;
  return !!(
    mrx.review ||
    mrx.respond ||
    mrx.doctor ||
    mrx.drafts?.length ||
    mrx.peerReviews?.length ||
    mrx.sentNudge ||
    mrx.nudges?.length ||
    hasReviewReactions(mr) ||
    mrx.slack?.posted
  );
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

/** The single most important state, for the row's right side. `comments` marks
    the state that gets the hover card of per-thread comment status. */
/** The review-state phrase — the human review axis only. Mechanical blockers
    (conflicts / ci) are NOT folded in here; they render as flag chips above the
    title so this always shows where the MR actually is in review. */
function statusPhrase(mr: BoardMR): {
  text: string;
  cls: string;
  comments?: boolean;
} {
  const comments = mr.reviewerComments;
  // Formal "changes requested" reviewer state — a reviewer explicitly blocked it.
  if (hasChangesRequested(mr))
    return { text: 'changes requested', cls: 't-bad' };
  if (mr.reviews.isApproved) return { text: 'approved', cls: 't-ok' };
  // Comments without a formal verdict: someone left feedback to look at.
  if (comments > 0)
    return {
      text: `${comments} comment${comments === 1 ? '' : 's'}`,
      cls: 't-warn',
      comments: true,
    };
  // Reviewed, every thread resolved, not yet approved. Still clickable (`comments`)
  // so you can open the drawer and read the resolved threads.
  if (commentsAllResolved(mr))
    return { text: 'comments resolved', cls: 't-ok', comments: true };
  if (mr.reviews.required > 0 && mr.reviews.given > 0)
    return {
      text: `${mr.reviews.given}/${mr.reviews.required} approved`,
      cls: 't-warn',
    };
  return { text: 'needs review', cls: 't-muted' };
}

/** Depth-first flattening of one stack tree, for views that render a chain as
    consecutive indented items rather than nested markup. */
function flattenStack(
  node: StackNode,
  depth = 0
): Array<{ mr: BoardMR; depth: number }> {
  return [
    { mr: node.mr, depth },
    ...node.children.flatMap(c => flattenStack(c, depth + 1)),
  ];
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

/** Total comment activity on an MR — resolvable threads plus general MR comments —
    for the 💬 token. Zero when the board has no breakdown or none exist. */
function commentCount(mr: BoardMR): number {
  const s = mr.threadSummary;
  const threads = s ? s.awaiting + s.replied + s.resolved : 0;
  return threads + (mr.generalComments ?? 0);
}

/** The review launch items for a row, by current review state. `re-review` is
    available whenever a review isn't actively running — even with no prior board
    review (it degrades to a generic re-review) — so it covers MRs a human reviewed
    outside the board. A live review collapses to a single "focus review tab". */
function reviewMenuItems(
  status?: ReviewStatus
): Array<{ kind: 'launch' | 're-review'; label: string }> {
  if (status === 'queued' || status === 'reviewing')
    return [{ kind: 'launch', label: 'focus review tab' }];
  if (status === 'done') return [{ kind: 're-review', label: 're-review' }];
  // none | error: offer a cold first review and the re-review path side by side.
  return [
    { kind: 'launch', label: 'launch review' },
    { kind: 're-review', label: 're-review' },
  ];
}

function respondItemLabel(status?: RespondStatus): string {
  if (!status || status === 'error') return 'respond to review';
  if (status === 'done') return 'restart response';
  return 'focus response tab';
}

function doctorItemLabel(status?: DoctorStatus): string {
  if (!status || status === 'error') return 'call the doctor';
  if (status === 'done') return 'call the doctor again';
  return 'focus doctor tab';
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
  CHIP_CELL_WORDS,
  NUDGE_RETRYABLE,
  gitlabMenuItems,
  nudgeChipText,
  nudgeTargets,
  draftKey,
  buildSlackMarks,
  getSlackMarks,
  setSlackMarks,
  hasReviewReactions,
  hasBoardBadges,
  factsFor,
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
};
/** The two cell vocabularies that are DERIVED rather than declared elsewhere —
    chips.tsx keys its peer and respond intent maps on these, so the maps and
    CHIP_CELL_WORDS above stay exhaustive over the same union. */
export type { PeerState, RespondCell };
