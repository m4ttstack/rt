import { Fragment, useMemo, useState, type ReactNode } from 'react';

import {
  optionValue,
  type GateDomain,
  type GateSelections,
} from '@mattstack/gate-kit';
import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { Button, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';
import { ago } from './format.ts';
import { parseGateCtx, type GateCtx } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import { MrCard } from './MrCard.tsx';
import { ReplyChoiceBody, SeverityPill, ThreadCard } from './RespondCards.tsx';
import { subjectRef } from './RespondGateHeader.tsx';
import { sheetAnswers } from './sheet-payload.ts';
import {
  Choices,
  Note,
  ProseContext,
  SheetLost,
  SheetRows,
  type ChoiceState,
  type RowChip,
} from './SheetParts.tsx';
import { humanizeLabel, splitPaneScreen, stageDisplay } from './stage-gate.ts';

type Selection = string | string[] | undefined;

function answered(v: Selection): boolean {
  return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v !== '';
}

/** A pick as short as the option allows: its label, or its value when the
    label runs longer. */
function shortPick(q: GateItemDisplay, value: string): RowChip {
  const choice = q.choices.find(c => c.value === value);
  const label = choice?.label ?? value;
  return {
    text: label.length <= value.length ? label : value,
    intent: 'accent',
    title: label,
  };
}

function pickChip(q: GateItemDisplay, v: Selection): RowChip {
  if (q.multiple) {
    if (!Array.isArray(v)) return { text: '…', intent: 'muted' };
    if (v.length === 0) return { text: 'none', intent: 'muted' };
    if (v.length > 1) return { text: `${v.length} picked`, intent: 'accent' };
    return shortPick(q, v[0]!);
  }
  return typeof v === 'string' && v
    ? shortPick(q, v)
    : { text: '…', intent: 'muted' };
}

function dockRef(gate: GateRow, mr?: BoardMRWithReview): string {
  return mr ? `!${mr.iid}` : subjectRef(gate.subject);
}

/** When and where the gate opened: the rail's meta line, which also keeps a
    context card with no prose from standing empty. */
function openedMeta(gate: GateRow, mr?: BoardMRWithReview): string {
  const origin = [
    gate.origin?.worktree?.split('/').filter(Boolean).pop(),
    gate.origin?.paneId,
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    mr ? null : gate.subject,
    `opened ${ago(new Date(gate.openedAt).toISOString(), Date.now())} ago`,
    origin || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A multi's picks in its options' order: toggles record click order, but
    the wire answer lists them as the options do. */
function inOptionOrder(
  display: GateItemDisplay[],
  selections: GateSelections
): GateSelections {
  const ordered: GateSelections = { ...selections };
  for (const q of display) {
    const v = selections[q.name];
    if (!q.multiple || !Array.isArray(v)) continue;
    const picked = new Set(v);
    ordered[q.name] = q.choices
      .map(c => c.value)
      .filter(value => picked.has(value));
  }
  return ordered;
}

/** One question's card: its head, its own context (a thread card, a reply,
    or prose), its choices, and whatever the host puts under them. A
    read-only card shows a recorded answer with every input disabled. */
function QuestionCard({
  q,
  qctx,
  picks,
  readOnly = false,
  replyText,
  children,
}: {
  q: GateItemDisplay;
  qctx: GateCtx | null;
  picks: ChoiceState;
  readOnly?: boolean;
  /** The reply as posted, when it differs from a reply context's draft. */
  replyText?: string;
  children?: ReactNode;
}) {
  const thread = qctx?.shape === 'thread@1' ? qctx : null;
  const replies = qctx?.shape === 'replies@1' ? qctx.replies : null;
  const reply = qctx?.shape === 'reply@1' ? qctx : null;
  return (
    <section
      className="tui-gate-question"
      data-gate-ctx={thread ? 'thread' : replies ? 'replies' : undefined}
      data-readonly={readOnly || undefined}
      aria-label={q.prompt}
    >
      <div className="tui-gate-question-head">
        <span className="tui-gate-question-label">{q.prompt}</span>
        {thread && <SeverityPill severity={thread.severity} />}
      </div>
      {thread ? (
        <ThreadCard ctx={thread} />
      ) : reply ? (
        <div className="tui-thread-card">
          <ReplyChoiceBody
            entry={{ ...reply, text: replyText ?? reply.text }}
          />
        </div>
      ) : (
        <ProseContext q={q} structured={qctx !== null} />
      )}
      <Choices
        q={q}
        form={picks}
        disabled={readOnly}
        renderLabel={
          replies
            ? (value, chip) => {
                const entry = replies.find(r => r.thread === value);
                return entry ? (
                  <ReplyChoiceBody entry={entry}>{chip}</ReplyChoiceBody>
                ) : undefined;
              }
            : undefined
        }
      />
      {children}
    </section>
  );
}

/** The rail's decision context: an optional lead, the gate's prose context
    and when and where it opened. */
function ContextCard({
  gate,
  mr,
  context,
  children,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  context?: string;
  children?: ReactNode;
}) {
  return (
    <div className="tui-sheet-context-card">
      <span className="tui-sheet-context-label">decision context</span>
      {children}
      {context && (
        <div className="tui-sheet-context-reasoning">
          <Markdown unstyled linkTargetBlank>
            {context}
          </Markdown>
        </div>
      )}
      <p className="tui-sheet-context-meta">{openedMeta(gate, mr)}</p>
    </div>
  );
}

/** Every gate that is neither a respond nor a review gate: all of its
    questions at once in the main column, decided in any order; the rail
    holds the MR, the gate's context, and the docked answer. */
function StageSheetBody({
  gate,
  mr,
  form,
  context,
  onContinue,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  form: GateFormState;
  /** The gate's own context as prose, when it has any. */
  context?: string;
  /** Retires a gate answered elsewhere from the queue. */
  onContinue: () => void;
}) {
  const display = useMemo(() => form.display.map(stageDisplay), [form.display]);
  const questionCtx = useMemo(
    () => new Map(gate.questions.map(q => [q.id, parseGateCtx(q.context)])),
    [gate.questions]
  );
  // The daemon rejects an answer that leaves any question out, and the
  // board has no way to answer one with no options.
  const answerable =
    display.length > 0 && gate.questions.every(q => q.options.length > 0);
  const payload = answerable
    ? sheetAnswers(
        gate,
        new Set(display.map(q => q.name)),
        inOptionOrder(display, form.selections),
        form.notes
      )
    : null;
  const done = display.filter(q => answered(form.selections[q.name])).length;
  const count = display.length;

  return (
    <div className="tui-sheet-body">
      <section className="tui-sheet-main">
        <div className="tui-sheet-list-head">
          <span className="tui-sheet-list-title">
            {humanizeLabel(gate.label)}: {count}{' '}
            {count === 1 ? 'question' : 'questions'}
          </span>
          <span className="tui-sheet-list-tally">
            {done} of {count} answered
          </span>
        </div>
        <div className="tui-respond-list">
          {display.map(q => (
            <QuestionCard
              key={q.name}
              q={q}
              qctx={questionCtx.get(q.name) ?? null}
              picks={form}
            >
              <Note q={q} form={form} />
            </QuestionCard>
          ))}
        </div>
      </section>
      <aside className="tui-sheet-rail">
        {form.lost ? (
          <SheetLost gate={gate} lost={form.lost} onContinue={onContinue} />
        ) : (
          <>
            <div className="tui-sheet-rail-scroll">
              {mr && <MrCard mr={mr} />}
              <ContextCard gate={gate} mr={mr} context={context} />
            </div>
            <div className="tui-sheet-dock">
              <div className="tui-sheet-dock-head">
                <h3 className="tui-sheet-dock-heading">
                  Answers on {dockRef(gate, mr)}
                </h3>
                <button
                  type="button"
                  className="tui-sheet-reset"
                  onClick={() => form.resetAll()}
                >
                  reset
                </button>
              </div>
              <SheetRows
                card="answers"
                rows={display.map(q => ({
                  key: q.name,
                  text: q.prompt,
                  title: q.prompt,
                  chips: [pickChip(q, form.selections[q.name])],
                }))}
              />
              {!answerable && (
                <p className="tui-sheet-dock-next">
                  This gate needs an answer the board can't give; answer it in
                  its pane.
                </p>
              )}
              <Button
                type="button"
                variant="filled"
                intent="accent"
                size="lg"
                className="tui-sheet-submit"
                disabled={form.busy || payload === null}
                onClick={() => void form.submit(payload)}
              >
                {form.busy ? 'submitting…' : 'submit'}
              </Button>
              {form.failed && (
                <span className="tui-gate-error">
                  submit failed... nothing was sent, try again
                </span>
              )}
              {form.focusError && (
                <span className="tui-gate-error">{form.focusError}</span>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** Falls back to the raw option string for a value this map doesn't know,
    so an unexpected daemon option still renders rather than vanishing. */
const PANE_ACTION_LABELS: Record<string, string> = {
  'focus-pane': 'focus pane',
  resume: 'resume',
  clear: 'clear',
  dismiss: 'dismiss',
};

const actionLabel = (value: string) => PANE_ACTION_LABELS[value] ?? value;

/** `meta` comes off the facility gate row untyped. */
function paneReason(gate: GateRow): 'blocked' | 'gone' | undefined {
  const reason = gate.meta?.reason;
  return reason === 'blocked' || reason === 'gone' ? reason : undefined;
}

/** A pane-attention notice: the prompt the pane is stopped on, read as the
    terminal drew it, and one action per option on its single question.
    `focus-pane` answers the gate AND jumps into the pane: through
    `onFocusPane` when the gate names a domain and an MR, else the
    `/gate/focus` POST. */
function PaneSheetBody({
  gate,
  mr,
  form,
  onFocusPane,
  onContinue,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  form: GateFormState;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
  /** Retires a gate answered elsewhere from the queue. */
  onContinue: () => void;
}) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const { prompt, earlier } = useMemo(
    () => splitPaneScreen(gate.context ?? ''),
    [gate.context]
  );
  const reason = paneReason(gate);
  const gone = reason === 'gone';
  const question = gate.questions[0];
  const questionId = question?.id ?? 'action';
  const values = (question?.options ?? []).map(optionValue);
  const preferred = gone ? 'resume' : 'focus-pane';
  const primary = values.includes(preferred) ? preferred : values[0];
  const others = values.filter(v => v !== primary);
  const paneRef =
    typeof gate.meta?.paneRef === 'string' ? gate.meta.paneRef : undefined;

  const answer = (value: string) => {
    void form.submit({ answers: { [questionId]: value } });
    if (value !== 'focus-pane') return;
    if (gate.domain && mr) onFocusPane(mr, gate.domain);
    else void form.focusGate();
  };

  return (
    <div className="tui-sheet-body">
      <section className="tui-sheet-main">
        <div className="tui-sheet-list-head">
          <span className="tui-sheet-list-title">
            {gone ? 'The pane is gone' : 'Pane waiting on a prompt'}
          </span>
        </div>
        <section className="tui-gate-question" aria-label="pane screen">
          <div className="tui-gate-question-head">
            <span className="tui-gate-question-label">
              {gone ? 'Its last screen' : 'Claude Code is asking'}
            </span>
          </div>
          {prompt ? (
            <pre className="tui-pane-screen">{prompt}</pre>
          ) : (
            <p className="tui-thread-nothing">The pane sent no screen text.</p>
          )}
        </section>
        {earlier && (
          <div className="tui-pane-earlier">
            <DisclosureHead
              open={earlierOpen}
              label="earlier pane output"
              onToggle={() => setEarlierOpen(o => !o)}
            >
              <span>earlier pane output</span>
            </DisclosureHead>
            <Disclosure open={earlierOpen}>
              <pre className="tui-pane-screen">{earlier}</pre>
            </Disclosure>
          </div>
        )}
      </section>
      <aside className="tui-sheet-rail">
        {form.lost ? (
          <SheetLost gate={gate} lost={form.lost} onContinue={onContinue} />
        ) : (
          <>
            <div className="tui-sheet-rail-scroll">
              {mr && <MrCard mr={mr} />}
              <div className="tui-sheet-context-card">
                <span className="tui-sheet-context-label">
                  decision context
                </span>
                <p className="tui-sheet-context-reasoning">
                  {gone
                    ? "The agent's pane is gone."
                    : 'The agent stopped on a prompt only its pane can answer.'}
                </p>
                {(paneRef || reason) && (
                  <div className="tui-respond-chips">
                    {paneRef && (
                      <span className="tui-respond-chip" data-chip="pane">
                        {paneRef}
                      </span>
                    )}
                    {reason && (
                      <span
                        className="tui-respond-chip"
                        data-hue={gone ? undefined : 'amber'}
                        data-chip="reason"
                      >
                        {reason}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="tui-sheet-dock">
              <div className="tui-sheet-dock-head">
                <h3 className="tui-sheet-dock-heading">
                  Pane on {dockRef(gate, mr)}
                </h3>
              </div>
              {primary !== undefined && (
                <Button
                  type="button"
                  variant="filled"
                  intent="accent"
                  size="lg"
                  className="tui-sheet-submit"
                  disabled={form.busy}
                  onClick={() => answer(primary)}
                >
                  {actionLabel(primary)}
                </Button>
              )}
              {others.length > 0 && (
                <div className="tui-sheet-text-actions">
                  {others.map((value, i) => (
                    <Fragment key={value}>
                      {i > 0 && <span aria-hidden="true">·</span>}
                      <button
                        type="button"
                        className="tui-sheet-text-action"
                        disabled={form.busy}
                        onClick={() => answer(value)}
                      >
                        {actionLabel(value)}
                      </button>
                    </Fragment>
                  ))}
                </div>
              )}
              {form.failed && (
                <span className="tui-gate-error">
                  submit failed... nothing was sent, try again
                </span>
              )}
              {form.focusError && (
                <span className="tui-gate-error">{form.focusError}</span>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export {
  ContextCard,
  dockRef,
  paneReason,
  PaneSheetBody,
  pickChip,
  QuestionCard,
  StageSheetBody,
};
