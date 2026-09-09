import type { GateDomain } from '@mattstack/gate-kit';
import { Chip, Markdown, Modal } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import { AnsweredChip, GateForm, useGateForm } from './GateCard.tsx';

/** One pip per queued gate. `skipped` gates come from the queue's local
    skip action, which advances without answering and leaves the gate (and
    its draft) untouched. */
export type TriageGateState = 'done' | 'active' | 'todo' | 'skipped';

/** The queue-hosted face of one gate: the same `GateForm` the row card
    renders, inside the kit Modal, with queue chrome around it. Actions keep
    their level: gate-level (focus pane, skip gate) sit on the gate strip,
    step-level (previous / next / submit) stay in the form's footer, so the
    footer never mixes the two. The host owns the queue itself (which gates
    join, the order, advancing on answer or skip); this component renders
    exactly one active gate of it. */
function DecisionQueueModal({
  gate,
  mr,
  position,
  states,
  nextPeek,
  onClose,
  onSkip,
  onFocusPane,
}: {
  gate: GateRow;
  mr: BoardMRWithReview;
  /** 1-based place of the active gate in the queue. */
  position: number;
  /** One entry per queued gate, in queue order. */
  states: TriageGateState[];
  /** "kind · subject" line for the gate after this one; omit on the last. */
  nextPeek?: string;
  onClose: () => void;
  onSkip: () => void;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  const form = useGateForm(gate);
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';

  return (
    <Modal
      className="tui-triage-modal"
      title={<>decision queue</>}
      ariaLabel="decision queue"
      onClose={onClose}
      closeGlyph="✕"
    >
      <div className="tui-triage-queue-row">
        <span className="tui-triage-pos">
          gate {position} of {states.length}
        </span>
        <span className="tui-triage-pips">
          {states.map((state, i) => (
            <i key={i} className="tui-triage-pip" data-state={state} />
          ))}
        </span>
        <span className="tui-triage-head-actions">
          {gate.status === 'parked' ? (
            gate.domain && (
              <button
                type="button"
                className="tui-gate-ghost tui-triage-act-focus"
                title="resume this gate's flow in a fresh pane"
                onClick={() => onFocusPane(mr, gate.domain!)}
              >
                focus pane
              </button>
            )
          ) : (
            <button
              type="button"
              className="tui-gate-ghost tui-triage-act-focus"
              disabled={!form.originFocusable || form.focusBusy}
              title={
                form.originFocusable
                  ? 'jump into the pane behind this gate'
                  : 'no origin on this gate'
              }
              onClick={() => void form.focusGate()}
            >
              focus pane
            </button>
          )}
          <button
            type="button"
            className="tui-gate-ghost tui-triage-act-skip"
            onClick={onSkip}
          >
            skip gate
          </button>
        </span>
      </div>
      <div className="tui-triage-strip">
        <div className="tui-triage-row-1">
          <span className="tui-title">{cleanTitle(mr.title)}</span>
          {mr.sourceBranch && extractTicketId(mr.sourceBranch, mr.title) && (
            <a
              className="tui-ticket"
              href={ticketUrl(extractTicketId(mr.sourceBranch, mr.title)!)}
              target="_blank"
              rel="noopener noreferrer"
              title={`open ${extractTicketId(mr.sourceBranch, mr.title)} in Linear`}
            >
              {extractTicketId(mr.sourceBranch, mr.title)}
            </a>
          )}
          <span className="tui-triage-kind">{gate.label}</span>
          {gate.status === 'parked' && (
            <Chip intent="warn" variant="outline" uppercase data-gate="parked">
              parked
            </Chip>
          )}
        </div>
        <div className="tui-row-2">
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
          <span className="tui-row-sep">·</span>
          <span>{ago(new Date(gate.openedAt).toISOString(), Date.now())}</span>
          {gate.origin && (
            <span>
              {[gate.origin.worktree, gate.origin.paneId]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
      </div>
      {(() => {
        const face =
          answered || !actionable ? (
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
            </>
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
              <div className="tui-triage-context">
                <div className="tui-triage-context-label">context</div>
                <div className="tui-gate-context-body">
                  <Markdown unstyled linkTargetBlank>
                    {gate.context}
                  </Markdown>
                </div>
              </div>
            )}
            <div className="tui-triage-form-col">{face}</div>
          </div>
        );
      })()}
      {nextPeek && (
        <div className="tui-triage-peek">
          <span className="tui-triage-peek-k">next:</span>
          <span>{nextPeek}</span>
        </div>
      )}
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
        <button type="button" className="tui-gate-submit" onClick={onClose}>
          done
        </button>
      </div>
    </Modal>
  );
}

export { DecisionQueueComplete, DecisionQueueModal };
