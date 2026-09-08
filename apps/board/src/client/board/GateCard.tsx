import { useState } from 'react';

import type {
  AnswerOutcome,
  GateDomain,
  GateSelections,
  GateSummaryDetailRow,
  GateSummaryInput,
} from '@mattstack/gate-kit';
import {
  answeredGateSummary,
  effectiveSelections,
  gateAnswerPayload,
  resolveAnswerOutcome,
} from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  Questionnaire,
  type GateItemDisplay,
} from '@mattstack/gate-kit/react';
import { Chip, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';

/** One thread's verb row within a grouped threads question: the group's
    heading once, then reply/fix/skip as controlled questionnaire choices
    styled as a compact row. At most one verb per thread -- checking one
    entry unchecks its siblings, leaving every other thread's selection
    untouched -- which is board policy, so it lives here, not in the kit. */
function ThreadGroupChoices({
  item,
  picked,
  onGroupSelect,
}: {
  item: GateItemDisplay;
  picked: Set<string>;
  onGroupSelect: (
    groupValues: string[],
    next: string,
    checked: boolean
  ) => void;
}) {
  return (
    <div className="tui-gate-thread-groups">
      {item.groups!.map(group => {
        const values = group.entries.map(e => e.value);
        return (
          <div key={group.token} className="tui-gate-thread-group">
            <div className="tui-gate-thread-heading" title={group.token}>
              {group.heading}
            </div>
            <div className="tui-gate-thread-verbs">
              {group.entries.map(entry => (
                <Questionnaire.Choice
                  key={entry.value}
                  value={entry.value}
                  checked={picked.has(entry.value)}
                  onChange={event =>
                    onGroupSelect(
                      values,
                      entry.value,
                      event.currentTarget.checked
                    )
                  }
                  className="tui-gate-thread-verb"
                >
                  <Questionnaire.ChoiceInput />
                  <Questionnaire.ChoiceLabel>
                    <span title={entry.value}>{entry.verb}</span>
                  </Questionnaire.ChoiceLabel>
                </Questionnaire.Choice>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryDetail({ detail }: { detail: GateSummaryDetailRow[] }) {
  return (
    <dl className="tui-gate-summary">
      {detail.map(row => (
        <div key={row.question} className="tui-gate-summary-row">
          <dt>{row.question}</dt>
          <dd>
            {row.answers.map((a, i) => (
              <span key={`${a.text}-${i}`} title={a.title}>
                {i > 0 && ', '}
                {a.text}
              </span>
            ))}
            {row.note && (
              <div className="tui-gate-summary-note">{row.note}</div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The compact answered face: one chip line, detail on demand. The conflict
    path passes startOpen -- the winning answer someone else recorded is the
    whole message there. */
function AnsweredChip({
  row,
  startOpen = false,
}: {
  row: GateSummaryInput;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const summary = answeredGateSummary(row);
  return (
    <div className="tui-gate-answered" data-gate="chip">
      <DisclosureHead
        open={open}
        label="answered gate summary"
        onToggle={() => setOpen(o => !o)}
      >
        <span className="tui-gate-chip">{summary.chip}</span>
      </DisclosureHead>
      <Disclosure open={open}>
        <SummaryDetail detail={summary.detail} />
      </Disclosure>
    </div>
  );
}

/** Renders one gate a review/respond/doctor pane opened on this MR's row.
    `open` and `parked` are both actionable -- the questionnaire renders for
    either, `parked` additionally wears a badge since a pane is no longer
    waiting on it. `answered` swaps to the summary chip.

    No optimistic local state on a successful submit: the request either
    fails (shown inline) or succeeds and the board's SSE-driven poll flips
    this gate's status on its own next refresh. A CAS loss is the one
    response rendered immediately from local state -- the daemon already
    recorded someone else's answer and handed back the real winner.

    The focus button takes two paths: a `parked` gate resumes its domain's
    whole flow in a fresh pane via `onFocusPane`/`gate.domain` (the facility
    has already released this gate's original pane); an `open` gate jumps
    straight into its own still-live origin pane via `/gate/focus`, disabled
    with a reason when no origin resolves. */
function GateCard({
  gate,
  mr,
  onFocusPane,
}: {
  gate: GateRow;
  mr: BoardMRWithReview;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  const [selections, setSelections] = useState<GateSelections>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lost, setLost] = useState<AnswerOutcome | null>(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const submittable =
    actionable &&
    gateAnswerPayload(
      gate.questions,
      effectiveSelections(gate.kind, gate.questions, selections)
    ) !== null;
  const originFocusable = Boolean(gate.origin?.paneId || gate.origin?.worktree);

  const { items, display } = gateItems(
    { kind: gate.kind, questions: gate.questions },
    selections
  );

  const setSingle = (name: string, value: string) =>
    setSelections(prev => ({ ...prev, [name]: value }));
  const toggleMulti = (name: string, value: string, checked: boolean) =>
    setSelections(prev => {
      const current = prev[name];
      const next = new Set(Array.isArray(current) ? current : []);
      if (checked) next.add(value);
      else next.delete(value);
      return { ...prev, [name]: [...next] };
    });
  const selectGroup = (
    name: string,
    groupValues: string[],
    next: string,
    checked: boolean
  ) =>
    setSelections(prev => {
      const current = prev[name];
      const set = new Set(Array.isArray(current) ? current : []);
      for (const v of groupValues) set.delete(v);
      if (checked) set.add(next);
      return { ...prev, [name]: [...set] };
    });

  const focusGate = async () => {
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await fetch('/gate/focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateId: gate.gateId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFocusError(body?.error ?? `focus failed (${res.status})`);
      }
    } catch {
      setFocusError('focus failed');
    } finally {
      setFocusBusy(false);
    }
  };

  const submit = async (payload: { answers: GateSelections } | null) => {
    if (!payload || busy) return;
    setBusy(true);
    setFailed(false);
    setLost(null);
    try {
      const res = await fetch('/gate/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateId: gate.gateId, answers: payload.answers }),
      });
      if (res.status === 409) {
        // An answer WAS recorded, just not this one -- the body carries the
        // winning row, not a validation failure to retry.
        setBusy(false);
        setLost(resolveAnswerOutcome(409, await res.json().catch(() => null)));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    setBusy(false);
  };

  return (
    // Clicks anywhere in here (a choice's own <label>, the checkbox text)
    // aren't inside an `a`/`button` closest() would catch, so they'd
    // otherwise bubble to the row's onRowClick and open the MR in GitLab.
    <div className="tui-gate-card" onClick={e => e.stopPropagation()}>
      <div className="tui-gate-head">
        <span className="tui-gate-title">{gate.label}</span>
        {gate.status === 'parked' && (
          <Chip intent="warn" variant="outline" uppercase data-gate="parked">
            parked
          </Chip>
        )}
        {(answered || lost) && (
          <Chip intent="ok" variant="outline" uppercase data-gate="answered">
            answered
          </Chip>
        )}
      </div>
      {gate.context && (
        <div className="tui-gate-context">
          <DisclosureHead
            open={ctxOpen}
            label="context"
            onToggle={() => setCtxOpen(o => !o)}
          >
            context
          </DisclosureHead>
          <Disclosure open={ctxOpen}>
            <div className="tui-gate-context-body">
              <Markdown unstyled linkTargetBlank>
                {gate.context}
              </Markdown>
            </div>
          </Disclosure>
        </div>
      )}
      {answered ? (
        <AnsweredChip
          row={{
            subject: gate.subject,
            kind: gate.kind,
            status: gate.status,
            questions: gate.questions,
            answer: gate.answers
              ? {
                  answers: gate.answers,
                  by: gate.answeredBy,
                  answeredAt: gate.answeredAt,
                }
              : null,
          }}
        />
      ) : lost ? (
        <>
          <div className="tui-gate-error">answered elsewhere</div>
          <AnsweredChip
            startOpen
            row={{
              subject: gate.subject,
              kind: gate.kind,
              status: 'answered',
              questions: gate.questions,
              answer: { answers: lost.answers, by: lost.by },
            }}
          />
        </>
      ) : (
        <Questionnaire.Root
          items={items}
          onSubmit={event => {
            event.preventDefault();
            void submit(
              answersFromForm(
                { kind: gate.kind, questions: gate.questions },
                new FormData(event.currentTarget)
              )
            );
          }}
        >
          {display.map(item => {
            const current = selections[item.name];
            const picked = new Set(Array.isArray(current) ? current : []);
            return (
              // The primitive is step-shaped (non-active Items render hidden
              // and inert); the two overrides are what make the flat card
              // possible.
              <Questionnaire.Item
                key={item.name}
                name={item.name}
                required={item.required}
                multiple={item.multiple}
                hidden={false}
                inert={false}
                className="tui-gate-question"
              >
                <Questionnaire.Title className="tui-gate-question-label">
                  {item.prompt}
                </Questionnaire.Title>
                <Questionnaire.Choices>
                  {item.groups ? (
                    <ThreadGroupChoices
                      item={item}
                      picked={picked}
                      onGroupSelect={(values, next, checked) =>
                        selectGroup(item.name, values, next, checked)
                      }
                    />
                  ) : (
                    <div className="tui-gate-options">
                      {item.choices.map(choice => (
                        <Questionnaire.Choice
                          key={choice.value}
                          value={choice.value}
                          checked={
                            item.multiple
                              ? picked.has(choice.value)
                              : current === choice.value
                          }
                          onChange={event =>
                            item.multiple
                              ? toggleMulti(
                                  item.name,
                                  choice.value,
                                  event.currentTarget.checked
                                )
                              : setSingle(item.name, choice.value)
                          }
                          className="tui-gate-option"
                        >
                          <Questionnaire.ChoiceInput />
                          <Questionnaire.ChoiceLabel className="tui-gate-option-label">
                            <span title={choice.description}>
                              {choice.label}
                            </span>
                          </Questionnaire.ChoiceLabel>
                        </Questionnaire.Choice>
                      ))}
                    </div>
                  )}
                </Questionnaire.Choices>
              </Questionnaire.Item>
            );
          })}
          <div className="tui-gate-actions">
            {failed && (
              <span className="tui-gate-error">
                submit failed... nothing was sent, try again
              </span>
            )}
            {focusError && <span className="tui-gate-error">{focusError}</span>}
            {gate.status === 'parked' ? (
              gate.domain && (
                <button
                  type="button"
                  className="tui-gate-focus"
                  title="resume this gate's flow in a fresh pane"
                  onClick={() => onFocusPane(mr, gate.domain!)}
                >
                  focus pane
                </button>
              )
            ) : (
              <button
                type="button"
                className="tui-gate-focus"
                disabled={!originFocusable || focusBusy}
                title={
                  originFocusable
                    ? 'jump into the pane behind this gate'
                    : 'no origin on this gate'
                }
                onClick={() => void focusGate()}
              >
                focus pane
              </button>
            )}
            <button
              type="submit"
              className="tui-gate-submit"
              disabled={!submittable || busy}
            >
              {busy ? 'submitting…' : 'submit'}
            </button>
          </div>
        </Questionnaire.Root>
      )}
    </div>
  );
}

export { GateCard };
