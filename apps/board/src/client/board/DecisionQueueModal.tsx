import { useEffect } from 'react';

import type { GateDomain } from '@mattstack/gate-kit';
import { Button, Chip, Markdown, Modal, ScrollPane } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import type { BoardMRWithReview } from '../types.ts';
import { AttentionCard } from './AttentionCard.tsx';
import { ago, cleanTitle } from './format.ts';
import {
  AnsweredChip,
  GateForm,
  useGateForm,
  type GateFormState,
} from './GateForm.tsx';
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

/** One pip per queued gate. `skipped` gates come from the queue's local
    skip action, which advances without answering and leaves the gate (and
    its draft) untouched. */
export type TriageGateState = 'done' | 'active' | 'todo' | 'skipped';

/** The queue-hosted face of one gate: `GateForm` inside the kit Modal, with
    queue chrome around it -- the only place a gate's form actually mounts,
    since a row now shows a chip that opens this modal rather than the form
    itself. Actions keep their level: gate-level (focus pane, skip gate) sit
    on the gate strip, step-level (previous / next / submit) stay in the
    form's footer, so the footer never mixes the two. The host owns the
    queue itself (which gates join, the order, advancing on answer or skip);
    this component renders exactly one active gate of it. */
function DecisionQueueModal({
  gate,
  mr,
  position,
  states,
  nextPeek,
  onClose,
  onSkip,
  onFocusPane,
  onAnswered,
  onContinue,
  onLostChange,
}: {
  gate: GateRow;
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
  onSkip: () => void;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
  onAnswered: () => void;
  onContinue: () => void;
  /** Fires when the CAS-loss face flips on or off, so the host can hold the
      queue on this gate while it's showing. */
  onLostChange?: (lost: boolean) => void;
}) {
  const form = useGateForm(gate, onAnswered);
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const deliveryStuck = answered && gate.delivery?.outcome === 'stuck';
  const executionUnassigned = answered && gate.execution === 'unassigned';

  useEffect(() => {
    onLostChange?.(form.lost !== null);
  }, [form.lost, onLostChange]);

  return (
    <Modal
      className="tui-triage-modal"
      title={<>decision queue</>}
      ariaLabel="decision queue"
      onClose={onClose}
      closeGlyph="✕"
    >
      <div className="tui-triage-queue-row">
        <span className="tui-triage-head-actions">
          {gate.status === 'parked' ? (
            gate.domain &&
            mr && (
              <Button
                type="button"
                variant="light"
                intent="accent"
                size="lg"
                title="resume this gate's flow in a fresh pane"
                onClick={() => onFocusPane(mr, gate.domain!)}
              >
                focus pane
              </Button>
            )
          ) : (
            <Button
              type="button"
              variant="light"
              intent="accent"
              size="lg"
              disabled={!form.originFocusable || form.focusBusy}
              title={
                form.originFocusable
                  ? 'jump into the pane behind this gate'
                  : 'no origin on this gate'
              }
              onClick={() => void form.focusGate()}
            >
              focus pane
            </Button>
          )}
          <Button
            type="button"
            variant="light"
            intent="muted"
            size="lg"
            onClick={onSkip}
          >
            skip gate
          </Button>
        </span>
      </div>
      <div className="tui-triage-strip">
        <div className="tui-triage-row-1">
          {mr ? (
            <>
              <span className="tui-title">{cleanTitle(mr.title)}</span>
              {mr.sourceBranch &&
                extractTicketId(mr.sourceBranch, mr.title) && (
                  <a
                    className="tui-ticket"
                    href={ticketUrl(
                      extractTicketId(mr.sourceBranch, mr.title)!
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`open ${extractTicketId(mr.sourceBranch, mr.title)} in Linear`}
                  >
                    {extractTicketId(mr.sourceBranch, mr.title)}
                  </a>
                )}
              <span className="tui-triage-kind">{gate.label}</span>
            </>
          ) : (
            <span className="tui-title">{gate.label}</span>
          )}
          {gate.status === 'parked' && (
            <Chip intent="warn" variant="outline" uppercase data-gate="parked">
              parked
            </Chip>
          )}
          {gate.escalatedAt != null && (
            <Chip
              intent="warn"
              variant="outline"
              uppercase
              data-gate="escalated"
            >
              escalated
            </Chip>
          )}
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
          <span>{ago(new Date(gate.openedAt).toISOString(), Date.now())}</span>
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
                intent="warn"
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
            />
          );
        // The modal exists to give context room: unlike the row card's
        // collapsed disclosure, context renders open, above the form. One
        // frame size regardless, so the modal never resizes as the queue
        // advances across gates with and without context.
        return (
          <div className="tui-triage-body">
            {gate.context && (
              <ScrollPane title="Decision context" maxHeight="46vh">
                <Markdown unstyled linkTargetBlank>
                  {gate.context}
                </Markdown>
              </ScrollPane>
            )}
            <div className="tui-triage-form-col">{face}</div>
          </div>
        );
      })()}
      <div className="tui-triage-footer">
        <div className="tui-triage-peek">
          {nextPeek && (
            <>
              <span className="tui-triage-peek-k">next:</span>
              <span>{nextPeek}</span>
            </>
          )}
        </div>
        <span className="tui-triage-pips">
          {states.map((state, i) => (
            <i key={i} className="tui-triage-pip" data-state={state} />
          ))}
        </span>
        <span className="tui-triage-pos">
          gate {position} of {states.length}
        </span>
      </div>
    </Modal>
  );
}

/** The queue's terminal face, shown once no gate is left active. */
function DecisionQueueComplete({
  answered,
  skipped,
  onClose,
}: {
  answered: number;
  skipped: number;
  onClose: () => void;
}) {
  return (
    <Modal
      className="tui-triage-modal"
      title="decision queue"
      ariaLabel="decision queue complete"
      onClose={onClose}
      closeGlyph="✕"
    >
      <div className="tui-triage-done">
        <span className="tui-triage-done-line">no gates left in the queue</span>
        <span className="tui-triage-done-counts">
          {answered} answered{skipped > 0 && ` · ${skipped} skipped`}
        </span>
        <Button
          type="button"
          className="tui-triage-done-action"
          variant="filled"
          intent="warn"
          size="lg"
          onClick={onClose}
        >
          done
        </Button>
      </div>
    </Modal>
  );
}

export { DecisionQueueComplete, DecisionQueueModal };
