import type { ReactNode } from 'react';

import type { BoardMRWithReview, RowContext } from '../types.ts';
import { Sun } from './icons.tsx';
import type { RowStatus, Verb } from './row-status.ts';

function runVerb(verb: Verb, mr: BoardMRWithReview, ctx: RowContext): void {
  switch (verb.kind) {
    case 'relaunch':
    case 'focus':
      ctx.onFocusPane(mr, verb.domain ?? 'review');
      return;
    case 'clear':
      if (verb.agentId) ctx.onClearOrphan(verb.agentId);
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
      they ride the status line's right end and show only under the pointer,
      so line 1 stays the title's. */
  tools?: ReactNode;
}) {
  const { line, more } = status;
  const hot = line.tone === 'bad' || line.tone === 'warn';
  return (
    <div className="tui-status" data-tone={line.tone}>
      <span className="tui-status-word">{line.word}</span>
      {line.spin && <span className="tui-status-ring" aria-hidden />}
      {line.detail && (
        <span className="tui-status-detail">
          {line.tone === 'clear' && (
            <>
              <Sun />{' '}
            </>
          )}
          {line.detail}
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
      {line.verbs.length > 0 && (
        <span className="tui-status-verbs">
          {line.verbs.map((verb, i) => (
            <button
              key={`${verb.kind}-${i}`}
              type="button"
              className="tui-status-verb"
              data-verb={verb.kind}
              data-hot={hot && i === 0 ? 'true' : undefined}
              data-secondary={i > 0 ? 'true' : undefined}
              onClick={e => {
                e.stopPropagation();
                runVerb(verb, mr, ctx);
              }}
            >
              {verb.label}
            </button>
          ))}
        </span>
      )}
      {tools && <span className="tui-status-tools">{tools}</span>}
    </div>
  );
}
