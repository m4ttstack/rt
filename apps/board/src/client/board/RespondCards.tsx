import type { ReactNode } from 'react';

import { Markdown } from '@mattstack/tui-kit';
import type {
  ReplyEntry,
  Severity,
  ThreadCtx,
  VerdictCall,
} from './gate-ctx.ts';

const SEVERITY: Record<
  Severity,
  { text: string; hue: 'amber' | 'grey' | 'accent' }
> = {
  blocking: { text: 'blocking', hue: 'amber' },
  'non-blocking': { text: 'non-blocking', hue: 'grey' },
  question: { text: 'question', hue: 'accent' },
  none: { text: 'no ask', hue: 'grey' },
};

const CALL_TEXT: Record<VerdictCall, string> = {
  valid: 'valid',
  'valid-low-value': 'valid, low value',
  pushback: 'pushback',
  'needs-clarification': 'needs clarification',
  'no-ask': 'no ask',
};

function SeverityPill({ severity }: { severity: Severity }) {
  const { text, hue } = SEVERITY[severity];
  return (
    <span className="tui-respond-pill" data-hue={hue} data-severity={severity}>
      {text}
    </span>
  );
}

/** A respond-plan thread question's body: the reviewer's claim, the
    adjudicated verdict, and the reply that goes out in the developer's
    name. The file:line and the severity ride the question head; the plan
    rides the fix option's subtitle. */
function ThreadCard({ ctx }: { ctx: ThreadCtx }) {
  const { claim, verdict, reply } = ctx;
  return (
    <div className="tui-thread-card">
      <div className="tui-thread-claim">
        <Markdown unstyled linkTargetBlank>
          {claim.summary}
        </Markdown>
      </div>
      {claim.points.length > 0 && (
        <ul className="tui-thread-points">
          {claim.points.map((point, i) => (
            <li key={i}>
              <Markdown unstyled linkTargetBlank>
                {point}
              </Markdown>
            </li>
          ))}
        </ul>
      )}
      <div className="tui-thread-verdict">
        <span className="tui-thread-verdict-k">verdict</span>
        <span className="tui-thread-verdict-call" data-call={verdict.call}>
          {CALL_TEXT[verdict.call]}
        </span>
        {verdict.note && (
          <span className="tui-thread-verdict-note">· {verdict.note}</span>
        )}
      </div>
      {reply.kind !== 'none' && (
        <div className="tui-thread-reply" data-kind={reply.kind}>
          <span className="tui-thread-reply-k">
            {reply.kind === 'verbatim'
              ? 'will post as reply'
              : 'reply direction'}
          </span>
          <div className="tui-thread-reply-text">
            <Markdown unstyled linkTargetBlank>
              {reply.text}
            </Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

/** A respond-post reply option's label: where the reply lands, whether it
    rides a pushed fix, and the full text that will be posted. `children`
    joins the label row (the recommended chip). */
function ReplyChoiceBody({
  entry,
  children,
}: {
  entry: ReplyEntry;
  children?: ReactNode;
}) {
  return (
    <>
      <span className="tui-gate-choice-label-row">
        <span className="tui-reply-choice-file">{entry.file}</span>
        <span
          className="tui-respond-pill"
          data-hue={entry.verb === 'fix' ? 'green' : 'grey'}
          data-verb={entry.verb}
        >
          {entry.verb === 'fix' && entry.sha ? (
            <>
              {'fix · '}
              <span className="tui-respond-pill-sha">{entry.sha}</span>
            </>
          ) : (
            entry.verb
          )}
        </span>
        {children}
      </span>
      <div className="tui-reply-choice-text">
        <Markdown unstyled linkTargetBlank>
          {entry.text}
        </Markdown>
      </div>
    </>
  );
}

export { ReplyChoiceBody, SeverityPill, ThreadCard };
