import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  effectiveSelections,
  gateAnswerPayload,
  optionDisplayFor,
  optionValue,
  type GateAnswers,
  type GateSelections,
} from '@mattstack/gate-kit';
import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { Button, Chip, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { parseGateCtx, type PlanCtx, type PostCtx } from './gate-ctx.ts';
import { AnsweredChip, type GateFormState } from './GateForm.tsx';
import { MrCard } from './MrCard.tsx';
import { forgeNoun } from './MrLinks.tsx';
import { PersonLead, PersonTag } from './PersonLead.tsx';
import { joinPlan, type JoinedThread } from './respond-join.ts';
import {
  ReplyChoiceBody,
  SeverityPill,
  ThreadCard,
  ThreadOutcome,
} from './RespondCards.tsx';
import {
  headerChips,
  headerMeta,
  reviewerName,
  subjectRef,
} from './RespondGateHeader.tsx';

/** The wire answer from the sheet's own selections, built the way
    `answersFromForm` builds it from a form: only a displayed single-select
    counts (a hidden code-changes pick is stale and yields to the
    sentinel), every multi submits an array, and a trimmed note wraps its
    question's value. Null while any required question is unanswered. */
function sheetAnswers(
  gate: GateRow,
  shown: Set<string>,
  selections: GateSelections,
  notes: Record<string, string>
): { answers: GateAnswers } | null {
  const sel: GateSelections = {};
  for (const q of gate.questions) {
    const v = selections[q.id];
    if (q.multi) sel[q.id] = shown.has(q.id) && Array.isArray(v) ? v : [];
    else if (shown.has(q.id) && typeof v === 'string' && v) sel[q.id] = v;
  }
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, sel)
  );
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = id in sel ? (notes[id] ?? '').trim() : '';
    answers[id] = note ? { value, note } : value;
  }
  return { answers };
}

function RecommendedChip() {
  return (
    <Chip
      intent="ok"
      variant="outline"
      uppercase
      data-gate="recommended"
      className="tui-gate-recommended"
    >
      recommended
    </Chip>
  );
}

function Choices({
  q,
  form,
  renderLabel,
}: {
  q: GateItemDisplay;
  form: GateFormState;
  renderLabel?: (value: string, chip: ReactNode) => ReactNode;
}) {
  const current = form.selections[q.name];
  const picked = new Set(Array.isArray(current) ? current : []);
  return (
    <div
      className="tui-gate-choices"
      role={q.multiple ? 'group' : 'radiogroup'}
      aria-label={q.prompt}
    >
      {q.choices.map(choice => {
        const checked = q.multiple
          ? picked.has(choice.value)
          : current === choice.value;
        const chip = choice.recommended ? <RecommendedChip /> : null;
        return (
          <label
            className="tui-gate-choice"
            data-checked={checked || undefined}
            data-recommended={choice.recommended ? 'true' : undefined}
            key={choice.value}
          >
            <input
              type={q.multiple ? 'checkbox' : 'radio'}
              className="tui-gate-choice-input"
              data-type={q.multiple ? 'checkbox' : 'radio'}
              data-checked={checked ? '' : undefined}
              name={q.name}
              value={choice.value}
              checked={checked}
              onChange={e =>
                q.multiple
                  ? form.toggleMulti(
                      q.name,
                      choice.value,
                      e.currentTarget.checked
                    )
                  : form.setSingle(q.name, choice.value)
              }
            />
            <span className="tui-gate-choice-label">
              {renderLabel ? (
                renderLabel(choice.value, chip)
              ) : (
                <>
                  <span className="tui-gate-choice-label-row">
                    <span title={choice.description}>{choice.label}</span>
                    {chip}
                  </span>
                  {choice.subtitle && (
                    <span className="tui-gate-choice-subtitle">
                      {choice.subtitle}
                    </span>
                  )}
                </>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Note({ q, form }: { q: GateItemDisplay; form: GateFormState }) {
  return (
    <input
      type="text"
      className="tui-gate-note"
      aria-label={`Note for ${q.prompt}`}
      placeholder="Add a note"
      value={form.notes[q.name] ?? ''}
      onChange={e => form.setNote(q.name, e.currentTarget.value)}
    />
  );
}

/** A question's own context when it is prose; a structured context that
    has no card here renders nothing rather than raw JSON. */
function ProseContext({
  q,
  structured,
}: {
  q: GateItemDisplay;
  structured: boolean;
}) {
  if (!q.context || structured) return null;
  return (
    <div className="tui-gate-question-context">
      <Markdown unstyled linkTargetBlank>
        {q.context}
      </Markdown>
    </div>
  );
}

/** A post-step thread's decision: post its final reply or hold it. Both
    write the replies checklist the gate answers with. */
function PostChoice({
  q,
  entry,
  form,
}: {
  q: GateItemDisplay;
  entry: JoinedThread;
  form: GateFormState;
}) {
  const current = form.selections[q.name];
  const posting = new Set(Array.isArray(current) ? current : []).has(
    entry.threadId
  );
  const choices = [
    { post: true, label: 'post', subtitle: 'post this reply to the thread' },
    { post: false, label: 'hold', subtitle: 'keep it back; nothing is posted' },
  ];
  return (
    <div
      className="tui-gate-choices"
      role="radiogroup"
      aria-label={`${entry.label}: post or hold`}
    >
      {choices.map(c => {
        const checked = posting === c.post;
        return (
          <label
            className="tui-gate-choice"
            data-checked={checked || undefined}
            key={c.label}
          >
            <input
              type="radio"
              className="tui-gate-choice-input"
              data-type="radio"
              data-checked={checked ? '' : undefined}
              name={`${q.name}:${entry.threadId}`}
              value={c.label}
              checked={checked}
              onChange={() => form.toggleMulti(q.name, entry.threadId, c.post)}
            />
            <span className="tui-gate-choice-label">
              <span className="tui-gate-choice-label-row">{c.label}</span>
              <span className="tui-gate-choice-subtitle">{c.subtitle}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

const VERB_ORDER = ['fix', 'reply', 'skip'] as const;

const VERB_INTENT = {
  fix: 'accent',
  reply: 'ok',
  skip: 'muted',
} as const;

/** A respond-plan answer that sends the plan back: every thread keeps its
    pick (the recommended option where none was made; the domain skill
    ignores thread picks on a revise, but the gate requires every one), and
    code-changes carries `revise` with the operator's reason as its note. */
function reviseAnswers(
  gate: GateRow,
  selections: GateSelections,
  notes: Record<string, string>,
  reason: string
): { answers: GateAnswers } | null {
  const sel: GateSelections = {};
  for (const q of gate.questions) {
    if (q.id === CODE_CHANGES_QUESTION_ID) continue;
    const v = selections[q.id];
    if (q.multi) sel[q.id] = Array.isArray(v) ? v : [];
    else if (typeof v === 'string' && v) sel[q.id] = v;
    else {
      const fallback =
        q.options.find(o => optionDisplayFor(o).recommended) ?? q.options[0];
      if (fallback) sel[q.id] = optionValue(fallback);
    }
  }
  sel[CODE_CHANGES_QUESTION_ID] = 'revise';
  const payload = gateAnswerPayload(gate.questions, sel);
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = (
      id === CODE_CHANGES_QUESTION_ID ? reason : (notes[id] ?? '')
    ).trim();
    answers[id] = note ? { value, note } : value;
  }
  return { answers };
}

/** One line per thread (or reply) with what the submit will do with it,
    filled in as picks are made; it sits in the dock above the submit. */
function ResponseRows({
  mainQs,
  form,
}: {
  mainQs: GateItemDisplay[];
  form: GateFormState;
}) {
  const rows = mainQs.flatMap(q => {
    const v = form.selections[q.name];
    if (q.multiple) {
      const picked = new Set(Array.isArray(v) ? v : []);
      return q.choices.map(c => ({
        key: `${q.name}:${c.value}`,
        text: c.label,
        chip: picked.has(c.value) ? 'post' : 'hold',
        intent: picked.has(c.value) ? ('ok' as const) : ('muted' as const),
      }));
    }
    const verb =
      typeof v === 'string'
        ? VERB_ORDER.find(verb => v.startsWith(`${verb}:`))
        : undefined;
    return [
      {
        key: q.name,
        text: q.prompt,
        chip: verb ?? '…',
        intent: verb ? VERB_INTENT[verb] : ('muted' as const),
      },
    ];
  });
  return (
    <div className="tui-sheet-card-list" data-card="responses">
      {rows.map(r => (
        <div className="tui-sheet-card-row" key={r.key}>
          <Chip
            intent={r.intent}
            variant="outline"
            uppercase
            className="tui-sheet-card-chip"
          >
            {r.chip}
          </Chip>
          <span className="tui-sheet-card-text">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** The MR's merge blockers as the board row reads them, so the rail and the
    row's status pill never disagree. */
function MrStatusCard({ mr }: { mr: BoardMRWithReview }) {
  const b = mr.blockers;
  const ci =
    mr.pipelineState === 'passed'
      ? { chip: 'pass', intent: 'ok' as const, text: 'pipeline passing' }
      : mr.pipelineState === 'failed'
        ? { chip: 'fail', intent: 'bad' as const, text: 'pipeline failing' }
        : mr.pipelineState === 'running'
          ? { chip: 'run', intent: 'warn' as const, text: 'pipeline running' }
          : { chip: 'n/a', intent: 'muted' as const, text: 'no pipeline' };
  const rows = [
    { key: 'ci', ...ci },
    {
      key: 'approvals',
      chip: mr.reviews.isApproved ? 'ok' : 'wait',
      intent: mr.reviews.isApproved ? ('ok' as const) : ('warn' as const),
      text: `${mr.reviews.given} of ${mr.reviews.required} approvals`,
    },
    b.hasConflicts
      ? {
          key: 'conflicts',
          chip: 'fail',
          intent: 'bad' as const,
          text: 'merge conflicts with target branch',
        }
      : {
          key: 'conflicts',
          chip: 'ok',
          intent: 'ok' as const,
          text: 'no merge conflicts',
        },
    ...(mr.behindTarget
      ? [
          {
            key: 'behind',
            chip: 'info',
            intent: 'muted' as const,
            text: `${mr.behindTarget} commits behind ${mr.targetBranch}`,
          },
        ]
      : []),
  ];
  return (
    <div className="tui-sheet-card" data-card="mr-status">
      <span className="tui-sheet-card-title">mr status</span>
      <div className="tui-sheet-card-list">
        {rows.map(r => (
          <div className="tui-sheet-card-row" key={r.key}>
            <Chip
              intent={r.intent}
              variant="outline"
              uppercase
              className="tui-sheet-card-chip"
            >
              {r.chip}
            </Chip>
            <span className="tui-sheet-card-text">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A respond gate in the full-screen sheet: the respond header and every
    thread (or reply) in the main column, each decided on its own card; the
    rail shows what the submit will do, the MR's status, and docks the
    submit. On a respond-plan gate the code-changes question never shows:
    any fix pick implies `approve`, none implies the gate's sentinel, and
    `revise` is its own action with a required reason. */
function RespondSheetBody({
  gate,
  mr,
  ctx,
  form,
  people,
  onContinue,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  ctx: PlanCtx | PostCtx;
  form: GateFormState;
  people?: ReadonlyMap<string, string>;
  /** Retires a gate answered elsewhere from the queue. */
  onContinue: () => void;
}) {
  // The send-back reason is code-changes' note on the wire, so it lives in
  // the form's notes and rides the gate's draft like any other note.
  const reason = form.notes[CODE_CHANGES_QUESTION_ID] ?? '';
  const setReason = (text: string) =>
    form.setNote(CODE_CHANGES_QUESTION_ID, text);
  const [revising, setRevising] = useState(() => reason.trim() !== '');
  const questionCtx = useMemo(
    () => new Map(gate.questions.map(q => [q.id, parseGateCtx(q.context)])),
    [gate.questions]
  );
  // A thread keeps its place in the list even when its structured
  // context was dropped to prose; the gate contract keeps thread-* ids
  // positional. A multi is the replies checklist, structured or not.
  const perItem = (q: GateItemDisplay) => {
    const shape = questionCtx.get(q.name)?.shape;
    return (
      shape === 'thread@1' ||
      shape === 'replies@1' ||
      /^thread-/.test(q.name) ||
      q.multiple
    );
  };
  const plan = ctx.shape === 'plan@1';
  const codeChanges = gate.questions.find(
    q => q.id === CODE_CHANGES_QUESTION_ID
  );
  const ccValues = new Set((codeChanges?.options ?? []).map(optionValue));
  // Without the sentinel there is nothing to fall back to when no thread is
  // a fix, so the question stays in the dock for the user to answer.
  const impliedCodeChanges =
    plan &&
    ccValues.has('approve') &&
    ccValues.has('revise') &&
    ccValues.has(CODE_CHANGES_SENTINEL);
  const mainQs = form.display.filter(perItem);
  const dockQs = form.display.filter(
    q =>
      !perItem(q) &&
      !(impliedCodeChanges && q.name === CODE_CHANGES_QUESTION_ID)
  );
  const fixes = mainQs.filter(q => {
    const v = form.selections[q.name];
    return typeof v === 'string' && v.startsWith('fix:');
  }).length;
  const submitSelections: GateSelections = { ...form.selections };
  if (impliedCodeChanges) {
    if (fixes > 0) submitSelections[CODE_CHANGES_QUESTION_ID] = 'approve';
    else delete submitSelections[CODE_CHANGES_QUESTION_ID];
  }
  const shown = new Set(form.display.map(q => q.name));
  const payload = revising
    ? reason.trim()
      ? reviseAnswers(gate, form.selections, form.notes, reason)
      : null
    : sheetAnswers(gate, shown, submitSelections, form.notes);

  const threadsDecided = mainQs.filter(
    q => !q.multiple && typeof form.selections[q.name] === 'string'
  ).length;
  const tally = VERB_ORDER.map(verb => {
    const n = mainQs.filter(q => {
      const v = form.selections[q.name];
      return typeof v === 'string' && v.startsWith(`${verb}:`);
    }).length;
    return n > 0 ? `${n} ${verb}` : null;
  }).filter(Boolean);
  const repliesQ = mainQs.find(q => q.multiple);
  const repliesPicked = repliesQ
    ? ((form.selections[repliesQ.name] as string[] | undefined)?.length ?? 0)
    : 0;
  const repliesCtx = repliesQ ? questionCtx.get(repliesQ.name) : undefined;
  // The post step draws each reply with its plan-step card when the plan
  // gate it follows is still on the MR row; otherwise the plain checklist.
  const joined =
    ctx.shape === 'post@1' && repliesCtx?.shape === 'replies@1'
      ? joinPlan(
          ctx,
          repliesCtx.replies,
          repliesQ!.choices.map(c => c.value),
          mr
        )
      : null;
  const postable = joined?.filter(j => j.reply).map(j => j.threadId) ?? [];
  const repliesName = repliesQ?.name;
  const seedPostable = () => {
    if (!repliesName || !joined) return;
    for (const id of postable) form.toggleMulti(repliesName, id, true);
  };
  useEffect(() => {
    if (!repliesName || form.selections[repliesName] !== undefined) return;
    seedPostable();
    // Seeds once per gate, and only a checklist no draft or pick has touched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.gateId, joined !== null]);
  const dockPick = dockQs
    .map(q => {
      const v = form.selections[q.name];
      return q.choices.find(c => c.value === v)?.label;
    })
    .find(Boolean);
  const nextStep = !plan
    ? null
    : fixes > 0
      ? `Next, ${fixes} ${fixes === 1 ? 'fix gets' : 'fixes get'} implemented, then you approve the replies before anything posts.`
      : 'Next, you approve the replies before anything posts.';
  const submitLabel = form.busy
    ? 'submitting…'
    : revising
      ? 'send back for revision'
      : plan
        ? ['submit', ...tally].join(' · ')
        : [`post ${repliesPicked}`, dockPick].filter(Boolean).join(' · ');

  return (
    <div className="tui-sheet-body">
      <section className="tui-sheet-main">
        <div className="tui-sheet-list-head">
          <span className="tui-sheet-list-title">
            {joined ? (
              <>
                Post replies on {joined.length}{' '}
                {joined.length === 1 ? 'thread' : 'threads'} from{' '}
                <PersonTag
                  id={ctx.reviewer}
                  name={reviewerName(ctx.reviewer, mr, people)}
                />
              </>
            ) : repliesQ ? (
              repliesQ.prompt
            ) : (
              <>
                Respond to {mainQs.length}{' '}
                {mainQs.length === 1 ? 'thread' : 'threads'} from{' '}
                <PersonTag
                  id={ctx.reviewer}
                  name={reviewerName(ctx.reviewer, mr, people)}
                />
              </>
            )}
          </span>
          <span className="tui-sheet-list-tally">
            {joined
              ? `${repliesPicked} of ${postable.length} posting`
              : repliesQ
                ? `${repliesPicked} of ${repliesQ.choices.length} selected`
                : `${threadsDecided} of ${mainQs.length} decided`}
          </span>
        </div>
        <div className="tui-respond-list">
          {mainQs.map(q => {
            const qctx = questionCtx.get(q.name);
            if (!q.multiple)
              return (
                <section
                  key={q.name}
                  className="tui-gate-question"
                  data-gate-ctx={
                    qctx?.shape === 'thread@1' ? 'thread' : undefined
                  }
                  aria-label={q.prompt}
                >
                  <div className="tui-gate-question-head">
                    <span className="tui-gate-question-label">{q.prompt}</span>
                    {qctx?.shape === 'thread@1' && (
                      <SeverityPill severity={qctx.severity} />
                    )}
                  </div>
                  {qctx?.shape === 'thread@1' ? (
                    <ThreadCard ctx={qctx} />
                  ) : (
                    <ProseContext q={q} structured={qctx != null} />
                  )}
                  <Choices q={q} form={form} />
                  <Note q={q} form={form} />
                </section>
              );
            if (joined)
              return (
                <Fragment key={q.name}>
                  {joined.map(j => (
                    <section
                      key={j.threadId}
                      className="tui-gate-question"
                      data-gate-ctx="thread"
                      data-step="post"
                      aria-label={j.label}
                    >
                      <div className="tui-gate-question-head">
                        <span className="tui-gate-question-label">
                          {j.label}
                        </span>
                        <SeverityPill severity={j.thread.severity} />
                        {(j.reply ?? j.decided) && (
                          <ThreadOutcome
                            verb={j.reply?.verb ?? j.decided!}
                            held={!j.reply}
                          />
                        )}
                      </div>
                      <ThreadCard
                        ctx={{
                          ...j.thread,
                          reply: j.reply
                            ? { kind: 'verbatim', text: j.reply.text }
                            : { kind: 'none' },
                        }}
                      />
                      {j.reply ? (
                        <PostChoice q={q} entry={j} form={form} />
                      ) : (
                        <p className="tui-thread-nothing">
                          Nothing to post for this thread.
                        </p>
                      )}
                    </section>
                  ))}
                  <Note q={q} form={form} />
                </Fragment>
              );
            const replies = qctx?.shape === 'replies@1' ? qctx.replies : [];
            return (
              <section
                key={q.name}
                className="tui-respond-replies"
                data-gate-ctx="replies"
                aria-label={q.prompt}
              >
                <Choices
                  q={q}
                  form={form}
                  renderLabel={(value, chip) => {
                    const entry = replies.find(r => r.thread === value);
                    return entry ? (
                      <ReplyChoiceBody entry={entry}>{chip}</ReplyChoiceBody>
                    ) : (
                      value
                    );
                  }}
                />
                <Note q={q} form={form} />
              </section>
            );
          })}
        </div>
      </section>
      <aside className="tui-sheet-rail">
        {form.lost ? (
          <div className="tui-sheet-lost">
            <span className="tui-gate-error">answered elsewhere</span>
            <AnsweredChip
              startOpen
              row={{
                subject: gate.subject,
                kind: gate.kind,
                status: 'answered',
                questions: gate.questions,
                answer: { answers: form.lost.answers, by: form.lost.by },
              }}
            />
            <Button
              type="button"
              variant="filled"
              intent="accent"
              size="lg"
              onClick={onContinue}
            >
              continue
            </Button>
          </div>
        ) : (
          <>
            <div className="tui-sheet-rail-scroll">
              {mr && <MrCard mr={mr} />}
              <div className="tui-sheet-context-card">
                <span className="tui-sheet-context-label">
                  decision context
                </span>
                <PersonLead
                  id={ctx.reviewer}
                  name={reviewerName(ctx.reviewer, mr, people)}
                >
                  reviewed your {forgeNoun(mr, gate.subject)}
                </PersonLead>
                {headerMeta(ctx).length > 0 && (
                  <p className="tui-sheet-context-meta">
                    {headerMeta(ctx).join(' · ')}
                  </p>
                )}
                <div className="tui-respond-chips">
                  {headerChips(ctx).map(chip => (
                    <span
                      key={chip.key}
                      className="tui-respond-chip"
                      data-hue={chip.hue}
                      data-chip={chip.key}
                    >
                      {chip.text}
                    </span>
                  ))}
                </div>
              </div>
              {mr && <MrStatusCard mr={mr} />}
            </div>
            <div className="tui-sheet-dock">
              <div className="tui-sheet-dock-head">
                <h3 className="tui-sheet-dock-heading">
                  {revising ? 'Send back' : plan ? 'Responses' : 'Replies'}
                  {` on ${mr ? `!${mr.iid}` : subjectRef(gate.subject)}`}
                </h3>
                <button
                  type="button"
                  className="tui-sheet-reset"
                  onClick={() => {
                    if (revising) {
                      setRevising(false);
                      setReason('');
                    } else {
                      form.resetAll();
                      seedPostable();
                    }
                  }}
                >
                  {revising ? 'cancel' : 'reset'}
                </button>
              </div>
              {revising ? (
                <textarea
                  className="tui-gate-note tui-sheet-revise-reason"
                  aria-label="What should the new plan change?"
                  placeholder="What should the new plan change?"
                  value={reason}
                  onChange={e => setReason(e.currentTarget.value)}
                />
              ) : (
                <>
                  <ResponseRows mainQs={mainQs} form={form} />
                  {nextStep && (
                    <p className="tui-sheet-dock-next">{nextStep}</p>
                  )}
                </>
              )}
              {!revising &&
                dockQs.map(q => (
                  <div key={q.name} className="tui-sheet-dock-question">
                    <span className="tui-sheet-dock-prompt">{q.prompt}</span>
                    <ProseContext
                      q={q}
                      structured={questionCtx.get(q.name) != null}
                    />
                    <Choices q={q} form={form} />
                    <Note q={q} form={form} />
                  </div>
                ))}
              <Button
                type="button"
                variant="filled"
                intent="accent"
                size="lg"
                className="tui-sheet-submit"
                disabled={form.busy || payload === null}
                onClick={() => void form.submit(payload)}
              >
                {submitLabel}
              </Button>
              {impliedCodeChanges && !revising && (
                <button
                  type="button"
                  className="tui-sheet-revise"
                  onClick={() => setRevising(true)}
                >
                  send the plan back for revision
                </button>
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

export { RespondSheetBody, sheetAnswers };
