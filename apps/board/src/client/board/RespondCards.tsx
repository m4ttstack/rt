import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Markdown } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
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

function ReplyBlock({ text }: { text: string }) {
  return (
    <div className="tui-thread-reply" data-kind="verbatim">
      <span className="tui-thread-reply-k">will post as reply</span>
      <div className="tui-thread-reply-text">
        <Markdown unstyled linkTargetBlank>
          {text}
        </Markdown>
      </div>
    </div>
  );
}

/** A respond-plan thread question's body: the reviewer's claim, the
    adjudicated verdict, and the reply that goes out in the developer's
    name. The file:line and the severity ride the question head; the plan
    rides the fix option's subtitle. `children` close the card, where a
    caller that draws the reply itself puts it. */
function ThreadCard({
  ctx,
  children,
}: {
  ctx: ThreadCtx;
  children?: ReactNode;
}) {
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
      {reply.kind === 'verbatim' && <ReplyBlock text={reply.text} />}
      {reply.kind === 'direction' && (
        <div className="tui-thread-reply" data-kind="direction">
          <span className="tui-thread-reply-k">reply direction</span>
          <div className="tui-thread-reply-text">
            <Markdown unstyled linkTargetBlank>
              {reply.text}
            </Markdown>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

/** A post-step reply the developer may rewrite before it posts: the draft
    at rest, an auto-growing box while editing. `value` is the edit, absent
    when there is none; `canEdit` is false while the thread is held, which
    also closes an open box. */
function EditableReply({
  label,
  draft,
  value,
  canEdit,
  onChange,
  onReset,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  canEdit: boolean;
  onChange: (text: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !canEdit) setEditing(false);
  const open = editing && canEdit;
  const text = value ?? draft;
  const edited = value !== undefined && value.trim() !== draft.trim();
  const empty = canEdit && value !== undefined && value.trim() === '';
  const ref = useAutoGrowTextarea([open, text]);
  const emptyHint = useId();
  const editRef = useRef<HTMLButtonElement | null>(null);
  // Closing unmounts whatever held focus, which would drop it to the body,
  // outside the sheet's Tab trap; a close the user asked for hands it back
  // to the edit button instead. A hold closes the box without moving focus.
  const refocus = useRef(false);
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  useEffect(() => {
    if (!open) {
      if (refocus.current) editRef.current?.focus();
      refocus.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open, ref]);
  return (
    <div className="tui-thread-reply" data-kind="verbatim">
      <span className="tui-thread-reply-k">will post as reply</span>
      {open ? (
        <textarea
          ref={ref}
          className="tui-thread-reply-input"
          rows={1}
          value={text}
          aria-label={`${label}: reply`}
          aria-describedby={empty ? emptyHint : undefined}
          onChange={e => onChange(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        />
      ) : (
        <div className="tui-thread-reply-text">
          <Markdown unstyled linkTargetBlank>
            {text}
          </Markdown>
        </div>
      )}
      {empty && (
        <span className="tui-gate-error" id={emptyHint}>
          the reply is empty
        </span>
      )}
      {canEdit && (
        <div className="tui-thread-reply-actions">
          {open ? (
            <>
              <button
                type="button"
                className="tui-thread-reply-action"
                aria-label={`${label}: done editing`}
                onClick={close}
              >
                done
              </button>
              {edited && (
                <button
                  type="button"
                  className="tui-thread-reply-action"
                  aria-label={`${label}: reset to draft`}
                  onClick={() => {
                    onReset();
                    ref.current?.focus();
                  }}
                >
                  reset to draft
                </button>
              )}
            </>
          ) : (
            <button
              ref={editRef}
              type="button"
              className="tui-thread-reply-action"
              aria-label={`${label}: edit reply`}
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A post-step card head's mark that its reply no longer reads as drafted. */
function EditedChip() {
  return (
    <span
      className="tui-respond-chip tui-thread-edited"
      data-hue="grey"
      data-chip="edited"
    >
      edited
    </span>
  );
}

const OUTCOME_HUE = { fix: 'accent', reply: 'green', skip: 'grey' } as const;

const OUTCOME_TEXT = {
  fix: 'fixed',
  reply: 'reply only',
  skip: 'skipped',
} as const;

/** A post-step thread's outcome, in its card's head: what the plan step
    decided for it. */
function ThreadOutcome({
  verb,
  held = false,
}: {
  verb: 'reply' | 'fix' | 'skip';
  /** The plan picked a reply or fix, but this gate has nothing to post. */
  held?: boolean;
}) {
  const heldBack = held && verb !== 'skip';
  return (
    <span
      className="tui-respond-chip tui-thread-outcome"
      data-hue={heldBack ? 'amber' : OUTCOME_HUE[verb]}
      data-outcome={heldBack ? `${verb}-held` : verb}
    >
      {heldBack ? `${verb} held` : OUTCOME_TEXT[verb]}
    </span>
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

export {
  EditableReply,
  EditedChip,
  ReplyChoiceBody,
  SeverityPill,
  ThreadCard,
  ThreadOutcome,
};
