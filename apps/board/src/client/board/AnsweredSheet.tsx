import { useMemo } from 'react';

import {
  unwrapGateAnswer,
  type GateSelections,
  type UnwrappedGateAnswer,
} from '@mattstack/gate-kit';
import { gateItems } from '@mattstack/gate-kit/react';
import { Button } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { ago } from './format.ts';
import { parseGateCtx, type PlanCtx, type PostCtx } from './gate-ctx.ts';
import { AnsweredChip, type GateFormState } from './GateForm.tsx';
import { MrCard } from './MrCard.tsx';
import { forgeNoun } from './MrLinks.tsx';
import { PersonLead, PersonTag } from './PersonLead.tsx';
import {
  personName,
  RespondCtxFacts,
  reviewerName,
} from './RespondGateHeader.tsx';
import {
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
} from './row-status.ts';
import {
  SheetLost,
  SheetRows,
  type ChoiceState,
  type RowChip,
} from './SheetParts.tsx';
import { stageDisplay } from './stage-gate.ts';
import { ContextCard, dockRef, pickChip, QuestionCard } from './StageSheet.tsx';

export type AnsweredState = 'answered' | 'stuck' | 'unassigned';

const TITLES: Record<Exclude<AnsweredState, 'answered'>, string> = {
  stuck: 'Answer not delivered',
  unassigned: 'Agent not running',
};

/** `by` is a username, or the surface the answer came from. */
function AnsweredTitle({
  by,
  mr,
  people,
}: {
  by: string | undefined;
  mr?: BoardMRWithReview;
  people?: ReadonlyMap<string, string>;
}) {
  if (!by) return <>Answered</>;
  if (by === 'board') return <>Answered on the board</>;
  if (by === 'pane') return <>Answered in the pane</>;
  return (
    <>
      Answered by <PersonTag id={by} name={personName(by, mr, people)} />
    </>
  );
}

const noop = () => {};

/** An answered gate on the two-column sheet: every question read-only with
    its recorded pick; the rail holds the MR and the decision context; the
    dock acts only when the answer is stuck (focus its pane) or had no agent
    to run it (post the recorded answer again). A retry that another answer
    beats swaps the rail for the winning answer, as every sheet does. */
function AnsweredSheetBody({
  gate,
  mr,
  form,
  state,
  context,
  respondCtx,
  people,
  onContinue,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  form: GateFormState;
  state: AnsweredState;
  /** Retires a gate another answer won from the queue. */
  onContinue: () => void;
  /** The gate's own context as prose, when it has any. */
  context?: string;
  respondCtx?: PlanCtx | PostCtx;
  people?: ReadonlyMap<string, string>;
}) {
  const recorded = useMemo(() => {
    const out = new Map<string, UnwrappedGateAnswer>();
    for (const [id, raw] of Object.entries(gate.answers ?? {}))
      out.set(id, unwrapGateAnswer(raw));
    return out;
  }, [gate.answers]);
  const picks = useMemo((): ChoiceState => {
    const selections: GateSelections = {};
    for (const [id, a] of recorded) selections[id] = a.value;
    return { selections, setSingle: noop, toggleMulti: noop };
  }, [recorded]);
  const display = useMemo(
    () =>
      new Map(
        gateItems({ kind: '', questions: gate.questions }, {}).display.map(
          q => [q.name, stageDisplay(q)] as const
        )
      ),
    [gate.questions]
  );
  const questionCtx = useMemo(
    () => new Map(gate.questions.map(q => [q.id, parseGateCtx(q.context)])),
    [gate.questions]
  );
  const answeredAgo =
    gate.answeredAt !== undefined
      ? `answered ${ago(new Date(gate.answeredAt).toISOString(), Date.now())} ago`
      : null;
  const rows = gate.questions.map(q => {
    const d = display.get(q.id);
    const value = recorded.get(q.id)?.value;
    const chip: RowChip = d
      ? pickChip(d, value)
      : typeof value === 'string' && value
        ? { text: 'answered', intent: 'accent', title: value }
        : { text: 'none', intent: 'muted' };
    return { key: q.id, text: q.label, title: q.label, chips: [chip] };
  });

  return (
    <div className="tui-sheet-body">
      <section className="tui-sheet-main">
        <div className="tui-sheet-list-head">
          <span className="tui-sheet-list-title">
            {state === 'answered' ? (
              <AnsweredTitle by={gate.answeredBy} mr={mr} people={people} />
            ) : (
              TITLES[state]
            )}
          </span>
          {answeredAgo && (
            <span className="tui-sheet-list-tally">{answeredAgo}</span>
          )}
        </div>
        <div className="tui-respond-list">
          {gate.questions.length === 0 && (
            <section className="tui-gate-question" data-readonly>
              <div className="tui-gate-question-head">
                <span className="tui-gate-question-label">Recorded answer</span>
              </div>
              <AnsweredChip
                startOpen
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
            </section>
          )}
          {gate.questions.map(q => {
            const d = display.get(q.id);
            const a = recorded.get(q.id);
            const qctx = questionCtx.get(q.id) ?? null;
            const reply = qctx?.shape === 'reply@1';
            const lines = (
              <>
                {a?.note && (
                  <p className="tui-gate-summary-reply">note: {a.note}</p>
                )}
                {a?.text && !reply && (
                  <p className="tui-gate-summary-reply">
                    edited reply: {a.text}
                  </p>
                )}
              </>
            );
            if (!d)
              return (
                <section
                  key={q.id}
                  className="tui-gate-question"
                  data-readonly
                  aria-label={q.label}
                >
                  <div className="tui-gate-question-head">
                    <span className="tui-gate-question-label">{q.label}</span>
                  </div>
                  <p className="tui-sheet-context-reasoning">
                    {typeof a?.value === 'string' && a.value
                      ? a.value
                      : 'No answer recorded.'}
                  </p>
                  {lines}
                </section>
              );
            return (
              <QuestionCard
                key={q.id}
                q={d}
                qctx={qctx}
                picks={picks}
                readOnly
                replyText={reply ? a?.text : undefined}
              >
                {lines}
              </QuestionCard>
            );
          })}
        </div>
      </section>
      <aside className="tui-sheet-rail">
        {form.lost ? (
          <SheetLost gate={gate} lost={form.lost} onContinue={onContinue} />
        ) : (
          <>
            <div className="tui-sheet-rail-scroll">
              {mr && <MrCard mr={mr} />}
              <ContextCard gate={gate} mr={mr} context={context}>
                {state === 'stuck' && (
                  <p className="tui-sheet-context-lead">
                    {DELIVERY_STUCK_MESSAGE}
                  </p>
                )}
                {state === 'unassigned' && (
                  <p className="tui-sheet-context-lead">
                    {EXECUTION_UNASSIGNED_MESSAGE}
                  </p>
                )}
                {respondCtx && (
                  <>
                    <PersonLead
                      id={respondCtx.reviewer}
                      name={reviewerName(respondCtx.reviewer, mr, people)}
                    >
                      reviewed your {forgeNoun(mr, gate.subject)}
                    </PersonLead>
                    <RespondCtxFacts ctx={respondCtx} />
                  </>
                )}
              </ContextCard>
            </div>
            <div className="tui-sheet-dock">
              <div className="tui-sheet-dock-head">
                <h3 className="tui-sheet-dock-heading">
                  Answer on {dockRef(gate, mr)}
                </h3>
              </div>
              {state === 'answered' && <SheetRows card="answers" rows={rows} />}
              {state === 'stuck' && (
                <>
                  <Button
                    type="button"
                    variant="filled"
                    intent="accent"
                    size="lg"
                    className="tui-sheet-submit"
                    disabled={form.focusBusy}
                    onClick={() => void form.focusGate()}
                  >
                    focus pane
                  </Button>
                  {form.focusError && (
                    <span className="tui-gate-error">{form.focusError}</span>
                  )}
                </>
              )}
              {state === 'unassigned' && (
                <>
                  <Button
                    type="button"
                    variant="filled"
                    intent="accent"
                    size="lg"
                    className="tui-sheet-submit"
                    disabled={form.busy}
                    onClick={() =>
                      void form.submit({ answers: gate.answers ?? {} })
                    }
                  >
                    retry
                  </Button>
                  {form.failed && (
                    <span className="tui-gate-error">
                      retry failed... nothing was sent, try again
                    </span>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export { AnsweredSheetBody };
