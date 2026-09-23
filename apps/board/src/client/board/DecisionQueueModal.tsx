import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  answeredGateSummary,
  domainForKind,
  type GateDomain,
} from '@mattstack/gate-kit';
import {
  Button,
  CHECK_ICON,
  Chip,
  Icon,
  Markdown,
  ScrollPane,
} from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview, ExecutorState } from '../types.ts';
import { AttentionCard } from './AttentionCard.tsx';
import { ago, cleanTitle, signOff } from './format.ts';
import { parseGateCtx, type PlanCtx, type PostCtx } from './gate-ctx.ts';
import {
  AnsweredChip,
  GateForm,
  useGateForm,
  type GateFormState,
} from './GateForm.tsx';
import { GateSheet, type GateSheetQueue } from './GateSheet.tsx';
import { MrLinks } from './MrLinks.tsx';
import { postPicks } from './respond-post.ts';
import { RespondGateHeader } from './RespondGateHeader.tsx';
import { RespondSheetBody } from './RespondSheet.tsx';
import { isReviewSheetGate, paneContext } from './review-gate.ts';
import { ReviewGateSheet } from './ReviewGateSheet.tsx';
import {
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
} from './row-status.ts';

/** The face for an answered gate the daemon's executor guarantee could not
    fully deliver: "stuck" reuses `form.focusGate()` (the same `/gate/focus`
    POST GateForm's own focus button makes) to jump into the blocked pane;
    "unassigned" reuses `form.submit` with the gate's OWN recorded answers to
    retry the relaunch the daemon gave up on -- both paths lean on
    `useGateForm`'s existing busy/error plumbing rather than a third fetch
    implementation. */
function DeliveryStatusCard({
  kind,
  gate,
  form,
}: {
  kind: 'stuck' | 'unassigned';
  gate: GateRow;
  form: GateFormState;
}) {
  const stuck = kind === 'stuck';
  return (
    <div className="tui-gate-delivery-status" data-gate-delivery-state={kind}>
      <p className="tui-gate-delivery-message">
        {stuck ? DELIVERY_STUCK_MESSAGE : EXECUTION_UNASSIGNED_MESSAGE}
      </p>
      <Button
        type="button"
        variant="filled"
        intent="warn"
        size="lg"
        disabled={stuck ? form.focusBusy : form.busy}
        onClick={() =>
          stuck
            ? void form.focusGate()
            : void form.submit({ answers: gate.answers ?? {} })
        }
      >
        {stuck ? 'focus pane' : 'retry'}
      </Button>
      {stuck && form.focusError && (
        <span className="tui-gate-error">{form.focusError}</span>
      )}
      {!stuck && form.failed && (
        <span className="tui-gate-error">
          retry failed... nothing was sent, try again
        </span>
      )}
    </div>
  );
}

/** One pip per queued gate. */
export type TriageGateState = 'done' | 'active' | 'todo';

/** The gate's own state chips; they ride the MR strip, or the action strip
    when the header card has taken the strip's place. */
function GateStateChips({ gate }: { gate: GateRow }) {
  return (
    <>
      {gate.status === 'parked' && (
        <Chip intent="warn" variant="outline" uppercase data-gate="parked">
          parked
        </Chip>
      )}
      {gate.escalatedAt != null && (
        <Chip intent="warn" variant="outline" uppercase data-gate="escalated">
          escalated
        </Chip>
      )}
    </>
  );
}

/** The queue-hosted face of one gate, the only place a gate's form mounts.
    Every face renders in the full-screen `GateSheet`: a structured
    review-post gate routes to `ReviewGateSheet`, a plan@1 or post@1 respond
    gate to `RespondSheetBody`, everything else to `GateForm` below.
    Gate-level actions (focus pane) ride the head, queue nav (previous gate,
    pips, count, next gate) sits in the head's right, and step-level nav
    stays with `GateForm`'s own body. The host owns the queue itself. */
function DecisionQueueModal({
  gate,
  mr,
  position,
  states,
  nextPeek,
  onClose,
  onNext,
  onBack,
  canBack = position > 1,
  canNext = position < states.length,
  onFocusPane,
  onAnswered,
  onContinue,
  onLostChange,
  people,
}: {
  gate: GateRow & { executor?: ExecutorState };
  /** Absent for a non-MR gate (queueExtras) -- the strip and face below
      render off `gate` alone rather than crash on a missing MR. */
  mr?: BoardMRWithReview;
  /** 1-based place of the active gate in the queue. */
  position: number;
  /** One entry per queued gate, in queue order. */
  states: TriageGateState[];
  /** "!ref · title" glance at the gate after this one; omit on the last. */
  nextPeek?: string;
  onClose: () => void;
  onNext: () => void;
  /** Returns to the previous gate in queue order; a no-op at the first. */
  onBack: () => void;
  /** Whether each chevron has a gate to land on; answered gates leave the
      queue, so position alone overstates it. */
  canBack?: boolean;
  canNext?: boolean;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
  onAnswered: () => void;
  onContinue: () => void;
  /** Fires when the CAS-loss face flips on or off, so the host can hold the
      queue on this gate while it's showing. */
  onLostChange?: (lost: boolean) => void;
  /** Team roster usernames to full names, for the reviewer a respond gate
      answers. */
  people?: ReadonlyMap<string, string>;
}) {
  const form = useGateForm(gate, onAnswered);
  const paneGone = gate.executor === 'gone';
  const headerCtx = useMemo((): PlanCtx | PostCtx | null => {
    const ctx = parseGateCtx(gate.context);
    return ctx?.shape === 'plan@1' || ctx?.shape === 'post@1' ? ctx : null;
  }, [gate.context]);
  const proseContext = useMemo(() => paneContext(gate.context), [gate.context]);
  // A respond-post gate whose contexts were all flattened to prose still
  // carries its per-thread questions; the sheet takes it without a reviewer.
  const sheetCtx = useMemo((): PlanCtx | PostCtx | null => {
    if (headerCtx) return headerCtx;
    if (gate.kind !== 'respond-post') return null;
    const picks = postPicks(gate.questions);
    return picks.length > 0
      ? { shape: 'post@1', reviewer: '', replies: picks.length, fixes: [] }
      : null;
  }, [headerCtx, gate.kind, gate.questions]);
  const isReviewSheet = useMemo(() => isReviewSheetGate(gate), [gate]);
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const deliveryStuck = answered && gate.delivery?.outcome === 'stuck';
  const executionUnassigned = answered && gate.execution === 'unassigned';

  useEffect(() => {
    onLostChange?.(form.lost !== null);
  }, [form.lost, onLostChange]);

  const queue: GateSheetQueue = {
    index: position - 1,
    total: states.length,
    states,
    canPrev: canBack,
    canNext,
    onPrev: onBack,
    onNext,
    nextPeek,
  };

  const actions = (
    <>
      {/* A parked gate has no pane: the board closed it on park, and the
            recorded answer is what brings it back (resumeParkedGate). The
            button stays so the head never rearranges, disabled with the
            reason, as it is when the reconciler reports the pane gone. */}
      {gate.status === 'parked' ? (
        <Button
          type="button"
          variant="light"
          intent="accent"
          size="sm"
          disabled
          title="parked: answering this gate resumes its pane"
        >
          focus pane
        </Button>
      ) : (
        <Button
          type="button"
          variant="light"
          intent="accent"
          size="sm"
          disabled={!form.originFocusable || form.focusBusy || paneGone}
          title={
            paneGone
              ? 'pane is gone'
              : form.originFocusable
                ? 'jump into the pane behind this gate'
                : 'no origin on this gate'
          }
          onClick={() => void form.focusGate()}
        >
          focus pane
        </Button>
      )}
      {headerCtx && <GateStateChips gate={gate} />}
    </>
  );

  // `actionable` also keeps a stuck/unassigned-delivery review-post gate on
  // DeliveryStatusCard: the sheet has no face for retrying a stored answer,
  // only for building a fresh one.
  if (isReviewSheet && actionable) {
    return (
      <ReviewGateSheet
        gate={gate}
        mr={mr}
        form={form}
        queue={queue}
        onClose={onClose}
        onContinue={onContinue}
        onFocusPane={onFocusPane}
      />
    );
  }

  if (sheetCtx && actionable) {
    return (
      <GateSheet
        variant="respond"
        ariaLabel="decision queue"
        queue={queue}
        tag={gate.label}
        onClose={onClose}
        actions={actions}
      >
        <RespondSheetBody
          gate={gate}
          mr={mr}
          ctx={sheetCtx}
          {...(headerCtx ? {} : { frame: proseContext ?? '' })}
          form={form}
          people={people}
          onContinue={onContinue}
        />
      </GateSheet>
    );
  }

  return (
    <GateSheet
      variant="triage"
      ariaLabel="decision queue"
      queue={queue}
      tag={gate.label}
      onClose={onClose}
      actions={actions}
    >
      <div className="tui-triage-sheet-body">
        {headerCtx ? (
          <RespondGateHeader
            gate={gate}
            mr={mr}
            ctx={headerCtx}
            people={people}
          />
        ) : (
          <div className="tui-triage-strip">
            <div className="tui-triage-row-1">
              {mr ? (
                <>
                  <span className="tui-title">{cleanTitle(mr.title)}</span>
                </>
              ) : (
                <span className="tui-title">{gate.label}</span>
              )}
              <GateStateChips gate={gate} />
              {mr && <MrLinks mr={mr} />}
            </div>
            <div className="tui-row-2">
              {mr ? (
                <>
                  {mr.author && (
                    <span className="tui-author-tag">
                      {mr.author.name || mr.author.username}
                    </span>
                  )}
                  <span className="tui-mr-iid">!{mr.iid}</span>
                  <span className="tui-row-sep">|</span>
                  {mr.sourceBranch && (
                    <span className="tui-branch">{mr.sourceBranch}</span>
                  )}
                </>
              ) : (
                <span className="tui-subject">{gate.subject}</span>
              )}
              <span className="tui-row-sep">·</span>
              <span>
                {ago(new Date(gate.openedAt).toISOString(), Date.now())}
              </span>
              {gate.origin && (
                // Panes pass the worktree as a full path; the strip shows only
                // its basename (the full value stays on hover).
                <span title={gate.origin.worktree}>
                  {[
                    gate.origin.worktree?.split('/').filter(Boolean).pop(),
                    gate.origin.paneId,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </div>
          </div>
        )}
        {(() => {
          const face =
            deliveryStuck || executionUnassigned ? (
              <DeliveryStatusCard
                kind={deliveryStuck ? 'stuck' : 'unassigned'}
                gate={gate}
                form={form}
              />
            ) : answered || !actionable ? (
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
            ) : form.lost ? (
              <>
                <div className="tui-gate-error">answered elsewhere</div>
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
              </>
            ) : gate.kind === 'pane-attention' ? (
              <AttentionCard
                gate={gate}
                form={form}
                mr={mr}
                onFocusPane={onFocusPane}
              />
            ) : (
              <GateForm
                gate={gate}
                mr={mr}
                form={form}
                onFocusPane={onFocusPane}
                showFocusAction={false}
                showContextFallback={false}
              />
            );
          // The modal exists to give context room: unlike the row card's
          // collapsed disclosure, context renders open, above the form.
          return (
            <div
              className="tui-triage-body"
              data-respond={headerCtx ? 'true' : undefined}
            >
              {proseContext && (
                <ScrollPane title="Decision context" maxHeight="46vh">
                  <Markdown unstyled linkTargetBlank>
                    {proseContext}
                  </Markdown>
                </ScrollPane>
              )}
              <div className="tui-triage-form-col">{face}</div>
            </div>
          );
        })()}
      </div>
    </GateSheet>
  );
}

/** One decided gate on the finished face. The outcome waits on the poll: a
    row that does not carry its answer yet reads plain "answered". A gate
    answered on another surface lands here too (the queue retires it), so
    its decider is named. */
function DecidedRow({ gate, mr }: { gate: GateRow; mr?: BoardMRWithReview }) {
  const outcome = gate.answers
    ? answeredGateSummary({
        subject: gate.subject,
        kind: gate.kind,
        status: gate.status,
        questions: gate.questions,
        answer: {
          answers: gate.answers,
          by: gate.answeredBy,
          answeredAt: gate.answeredAt,
        },
      }).outcome
    : null;
  const title = mr ? cleanTitle(mr.title) : null;
  // 'board' is the `by` gates/answer.ts stamps on this board's own answers.
  const by =
    outcome !== null && gate.answeredBy && gate.answeredBy !== 'board'
      ? ` · by ${gate.answeredBy}`
      : '';
  return (
    <li className="tui-triage-done-row">
      {mr && <span className="tui-triage-done-ref">!{mr.iid}</span>}
      <span className="tui-respond-chip">
        {domainForKind(gate.kind) ?? gate.kind.replaceAll('-', ' ')}
      </span>
      {title !== null ? (
        <span className="tui-triage-done-title" title={title}>
          {title}
        </span>
      ) : (
        <span className="tui-triage-done-subject" title={gate.subject}>
          {gate.subject}
        </span>
      )}
      <span
        className="tui-triage-done-outcome"
        title={outcome === null ? undefined : `${outcome}${by}`}
        data-pending={outcome === null ? 'true' : undefined}
      >
        {outcome ?? 'answered'}
        {by && <span className="tui-triage-done-by">{by}</span>}
      </span>
    </li>
  );
}

/** The queue's terminal face, shown once no gate is left active: what this
    session decided, in the order it was decided. */
function DecisionQueueComplete({
  decided,
  onClose,
}: {
  decided: Array<{ gate: GateRow; mr?: BoardMRWithReview }>;
  onClose: () => void;
}) {
  const doneRef = useRef<HTMLButtonElement | null>(null);
  // GateSheet focuses itself on mount; a child's effect runs before its
  // parent's, so this lands after it and Enter closes.
  useEffect(() => {
    doneRef.current?.focus();
  }, []);
  const [hour] = useState(() => new Date().getHours());
  const recapId = useId();
  const count = decided.length;
  return (
    <GateSheet
      variant="triage"
      ariaLabel="decision queue complete"
      onClose={onClose}
    >
      <div className="tui-triage-sheet-body">
        <div className="tui-triage-done">
          <span className="tui-triage-done-badge">
            <Icon d={CHECK_ICON} width="22" height="22" />
          </span>
          <h2 className="tui-triage-done-heading">Queue cleared</h2>
          <p className="tui-triage-done-counts">
            {count === 1 ? '1 decision' : `${count} decisions`} this session.{' '}
            {signOff(hour)}
          </p>
          {count > 0 && (
            <section
              className="tui-sheet-context-card tui-triage-done-recap"
              aria-labelledby={recapId}
            >
              <span id={recapId} className="tui-sheet-context-label">
                decided this session
              </span>
              <ol className="tui-triage-done-list">
                {decided.map(({ gate, mr }) => (
                  <DecidedRow key={gate.gateId} gate={gate} mr={mr} />
                ))}
              </ol>
            </section>
          )}
          <Button
            ref={doneRef}
            type="button"
            className="tui-triage-done-action"
            variant="filled"
            intent="accent"
            size="lg"
            onClick={onClose}
          >
            done
          </Button>
        </div>
      </div>
    </GateSheet>
  );
}

export { DecisionQueueComplete, DecisionQueueModal };
