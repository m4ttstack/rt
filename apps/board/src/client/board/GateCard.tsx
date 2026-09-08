import { useEffect, useMemo, useState } from 'react';

import type {
  AnswerOutcome,
  GateAnswers,
  GateDomain,
  GateSelections,
  GateSummaryDetailRow,
  GateSummaryInput,
} from '@mattstack/gate-kit';
import { answeredGateSummary, resolveAnswerOutcome } from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  noteFieldName,
  Questionnaire,
  useGateDraft,
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
                  <Questionnaire.ChoiceInput className="tui-gate-choice-input" />
                  <Questionnaire.ChoiceLabel>
                    <span title={entry.value}>{entry.verb}</span>
                    {entry.recommended && (
                      <Chip
                        intent="ok"
                        variant="outline"
                        uppercase
                        data-gate="recommended"
                        className="tui-gate-recommended"
                      >
                        recommended
                      </Chip>
                    )}
                  </Questionnaire.ChoiceLabel>
                  <Questionnaire.ChoiceShortcut className="tui-gate-key" />
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
        <div key={row.id} className="tui-gate-summary-row">
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

    One question renders flat; two or more step through the primitive's own
    step mode (one active item, Previous / Next, Submit on the last). The
    code-changes item of a respond-plan gate joins the sequence only once a
    `fix:` value is picked, which in step mode means a new last step appears
    and Submit moves to it.

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
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const {
    initial: draft,
    save: saveDraft,
    clear: clearDraft,
  } = useGateDraft(gate.gateId, actionable);
  const [selections, setSelections] = useState<GateSelections>(
    () => draft?.selections ?? {}
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    () => draft?.notes ?? {}
  );
  const [step, setStep] = useState<string | null>(() => draft?.item ?? null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lost, setLost] = useState<AnswerOutcome | null>(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const originFocusable = Boolean(gate.origin?.paneId || gate.origin?.worktree);

  const { items, display } = useMemo(
    () => gateItems({ kind: gate.kind, questions: gate.questions }, selections),
    [gate.kind, gate.questions, selections]
  );
  const stepped = display.length > 1;
  const activeStep = step ?? display[0]?.name;

  useEffect(() => {
    saveDraft({ selections, notes, item: step });
  }, [saveDraft, selections, notes, step]);

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
  const setNote = (name: string, value: string) =>
    setNotes(prev => ({ ...prev, [name]: value }));
  const resetAll = () => {
    setSelections({});
    setNotes({});
    setStep(null);
    clearDraft();
  };

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

  const submit = async (payload: { answers: GateAnswers } | null) => {
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
      const outcome = resolveAnswerOutcome(
        res.status,
        await res.json().catch(() => null)
      );
      if (outcome.kind === 'lost') {
        // An answer WAS recorded, just not this one -- the body carries the
        // winning row, not a validation failure to retry.
        setBusy(false);
        setLost(outcome);
        clearDraft();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    setBusy(false);
    clearDraft();
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
          className="tui-gate-form"
          items={items}
          shortcuts="numbers"
          item={activeStep}
          onItemChange={setStep}
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
          {stepped && (
            <Questionnaire.Progress
              className="tui-gate-progress"
              render={(props, state) => (
                <span {...props}>
                  {state.current} of {state.total}
                </span>
              )}
            />
          )}
          {display.map(q => {
            const current = selections[q.name];
            const picked = new Set(Array.isArray(current) ? current : []);
            return (
              <Questionnaire.Item
                key={q.name}
                name={q.name}
                required={q.required}
                multiple={q.multiple}
                className="tui-gate-question"
              >
                <Questionnaire.Title className="tui-gate-question-label">
                  {q.prompt}
                </Questionnaire.Title>
                <Questionnaire.Choices className="tui-gate-choices">
                  {q.groups ? (
                    <ThreadGroupChoices
                      item={q}
                      picked={picked}
                      onGroupSelect={(values, next, checked) =>
                        selectGroup(q.name, values, next, checked)
                      }
                    />
                  ) : (
                    q.choices.map(choice => (
                      <Questionnaire.Choice
                        key={choice.value}
                        value={choice.value}
                        checked={
                          q.multiple
                            ? picked.has(choice.value)
                            : current === choice.value
                        }
                        onChange={event =>
                          q.multiple
                            ? toggleMulti(
                                q.name,
                                choice.value,
                                event.currentTarget.checked
                              )
                            : setSingle(q.name, choice.value)
                        }
                        className="tui-gate-choice"
                      >
                        <Questionnaire.ChoiceInput className="tui-gate-choice-input" />
                        <Questionnaire.ChoiceLabel className="tui-gate-choice-label">
                          <span title={choice.description}>{choice.label}</span>
                          {choice.recommended && (
                            <Chip
                              intent="ok"
                              variant="outline"
                              uppercase
                              data-gate="recommended"
                              className="tui-gate-recommended"
                            >
                              recommended
                            </Chip>
                          )}
                        </Questionnaire.ChoiceLabel>
                        <Questionnaire.ChoiceShortcut className="tui-gate-key" />
                      </Questionnaire.Choice>
                    ))
                  )}
                </Questionnaire.Choices>
                <Questionnaire.Error className="tui-gate-invalid" />
                <input
                  type="text"
                  className="tui-gate-note"
                  name={noteFieldName(q.name)}
                  aria-label={`Note for ${q.prompt}`}
                  placeholder="Add a note"
                  value={notes[q.name] ?? ''}
                  onChange={event => setNote(q.name, event.currentTarget.value)}
                  onKeyDown={event => {
                    // Plain Enter in a text input is implicit form submission;
                    // Cmd/Ctrl+Enter stays the primitive's validate-and-advance.
                    if (
                      event.key === 'Enter' &&
                      !event.metaKey &&
                      !event.ctrlKey
                    )
                      event.preventDefault();
                  }}
                />
              </Questionnaire.Item>
            );
          })}
          <div className="tui-gate-actions">
            <Questionnaire.Previous className="tui-gate-nav" disabled={busy}>
              previous
            </Questionnaire.Previous>
            {stepped && (
              <button
                type="reset"
                className="tui-gate-nav"
                disabled={busy}
                onClick={resetAll}
              >
                reset
              </button>
            )}
            <div className="tui-gate-actions-end">
              {failed && (
                <span className="tui-gate-error">
                  submit failed... nothing was sent, try again
                </span>
              )}
              {focusError && (
                <span className="tui-gate-error">{focusError}</span>
              )}
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
              <Questionnaire.Next
                className="tui-gate-submit"
                render={(props, state) => (
                  <button
                    {...props}
                    disabled={busy || state.status !== 'answered'}
                  />
                )}
              >
                next
              </Questionnaire.Next>
              <Questionnaire.Submit
                className="tui-gate-submit"
                render={(props, state) => (
                  <button
                    {...props}
                    disabled={busy || state.status !== 'answered'}
                  />
                )}
              >
                {busy ? 'submitting…' : 'submit'}
              </Questionnaire.Submit>
            </div>
          </div>
        </Questionnaire.Root>
      )}
    </div>
  );
}

export { GateCard };
