import { useState, type ReactNode } from 'react';

import type { BoardMRWithReview, RowContext } from '../types.ts';
import { clauseOf } from './clause.ts';
import { AgentGlyph, Sun } from './icons.tsx';
import type { RowStatus, Verb, VerbKind } from './row-status.ts';

type Lane = 'review' | 'respond' | 'doctor';

/** The lane an agent verb launches, re-runs or jumps into. The color of the
    verb is the lane, so a reader knows which agent a click starts before
    reading the word; `relaunch` and `focus` name theirs on the verb. */
const AGENT_LANE: Partial<Record<VerbKind, Lane>> = {
  'launch-review': 'review',
  're-review': 'review',
  'launch-respond': 'respond',
  'restart-respond': 'respond',
  'resume-respond': 'respond',
  'call-doctor': 'doctor',
};

function laneOf(verb: Verb): Lane | undefined {
  if (verb.kind === 'relaunch' || verb.kind === 'focus') return verb.domain;
  return AGENT_LANE[verb.kind];
}

/** The primary verb holds the line's right end at rest; the secondaries
    appear under the pointer to its LEFT, so it never moves. */
function ordered(verbs: Verb[]): Array<{ verb: Verb; primary: boolean }> {
  const [primary, ...rest] = verbs;
  return [
    ...rest.map(verb => ({ verb, primary: false })),
    ...(primary ? [{ verb: primary, primary: true }] : []),
  ];
}

function runVerb(verb: Verb, mr: BoardMRWithReview, ctx: RowContext): void {
  switch (verb.kind) {
    case 'relaunch':
    case 'focus':
      ctx.onFocusPane(mr, verb.domain ?? 'review');
      return;
    case 'clear':
      if (verb.agentId) ctx.onClearOrphan(verb.agentId);
      return;
    case 'dismiss':
      if (verb.domain) ctx.onDismissLane(mr, verb.domain);
      return;
    case 'answer':
      if (verb.gateId) ctx.onOpenGate(verb.gateId);
      return;
    case 'read-review':
      ctx.onOpenReview(mr);
      return;
    case 'read-respond':
      ctx.onOpenRespond(mr);
      return;
    case 'resume-respond':
      ctx.onResumeRespond(mr);
      return;
    case 'launch-review':
      ctx.onLaunch(mr);
      return;
    case 'launch-respond':
    case 'restart-respond':
      ctx.onRespond(mr);
      return;
    case 'call-doctor':
      ctx.onDoctor(mr);
      return;
    case 're-review':
      ctx.onReReview(mr);
      return;
    case 'read-note':
      if (verb.draft) ctx.onOpenDraft(mr, verb.draft);
      return;
    case 'view-peer':
    case 'open-mr':
      if (mr.webUrl) window.open(mr.webUrl, '_blank', 'noopener');
      return;
    case 'merge':
      ctx.onMerge(mr);
      return;
    default: {
      const never: never = verb.kind;
      return never;
    }
  }
}

/** The row's one status line. Verbs are buttons so the row's own click
    (open in GitLab) ignores them; the first verb shows at rest, the rest
    only under the pointer (style.css keys on `data-secondary`). */
export function StatusLine({
  mr,
  status,
  ctx,
  tools,
}: {
  mr: BoardMRWithReview;
  status: RowStatus;
  ctx: RowContext;
  /** Row utilities that are verbs too (open the ticket, copy for Slack):
      they ride the status line's right end, left of the verbs so the verb
      never moves when they appear, and show only under the pointer. */
  tools?: ReactNode;
}) {
  const { line, more } = status;
  // Merge is the one irreversible verb: the first click arms it, the second
  // fires, and leaving the line disarms it, the row menu's item made inline.
  const [armed, setArmed] = useState(false);
  // /mr/action refuses a non-local request, so a remote board never shows
  // merge, the same as the row menu's gitlab section.
  const verbs = ctx.local
    ? line.verbs
    : line.verbs.filter(verb => verb.kind !== 'merge');
  const hot = line.tone === 'bad' || line.tone === 'warn';
  const detail = line.detail ? clauseOf(line.detail) : null;
  return (
    <div
      className="tui-status"
      data-tone={line.tone}
      onMouseLeave={() => setArmed(false)}
    >
      <span className="tui-status-word">{line.word}</span>
      {line.spin && <span className="tui-status-ring" aria-hidden />}
      {line.tone === 'clear' && (
        <span className="tui-status-sun" aria-hidden>
          <Sun />
        </span>
      )}
      {detail && (
        <span className="tui-status-detail" title={detail.full ?? undefined}>
          {detail.text}
        </span>
      )}
      {more.length > 0 && (
        <span
          className="tui-status-more"
          title={more.map(l => l.word).join(', ')}
        >
          +{more.length} active
        </span>
      )}
      {tools && <span className="tui-status-tools">{tools}</span>}
      {verbs.length > 0 && (
        <span className="tui-status-verbs">
          {ordered(verbs).map(({ verb, primary }) => {
            const lane = laneOf(verb);
            const merge = verb.kind === 'merge';
            return (
              <button
                key={`${verb.kind}-${verb.label}`}
                type="button"
                className="tui-status-verb"
                data-verb={verb.kind}
                data-lane={lane}
                data-decide={verb.kind === 'answer' ? 'true' : undefined}
                data-armed={merge && armed ? 'true' : undefined}
                data-hot={hot && primary ? 'true' : undefined}
                data-secondary={primary ? undefined : 'true'}
                onClick={e => {
                  e.stopPropagation();
                  if (merge && !armed) {
                    setArmed(true);
                    return;
                  }
                  setArmed(false);
                  runVerb(verb, mr, ctx);
                }}
                onBlur={merge ? () => setArmed(false) : undefined}
              >
                {lane && <AgentGlyph />}
                {merge && armed ? 'really merge?' : verb.label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}
