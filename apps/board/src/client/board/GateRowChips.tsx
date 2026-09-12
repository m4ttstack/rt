import { Chip } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { AnsweredChip } from './GateForm.tsx';

/** Shared with DecisionQueueModal's own stuck/unassigned face so the row
    chip and the queue card never drift on wording. */
export const DELIVERY_STUCK_MESSAGE = "pane didn't pick up the answer";
export const EXECUTION_UNASSIGNED_MESSAGE = 'answered, no pane to execute';

/** A row's whole gate face: no form controls, just chips. An actionable gate
    (`open`/`parked`) is a button that opens the decision queue on that gate;
    an answered gate stuck on delivery or left unassigned is ALSO a button
    into the queue, since it still needs a human action (focus-pane / retry)
    that only the queue's form face can carry out; anything else renders the
    plain answered summary. `stopPropagation` matches the old card: a chip
    click must not bubble to the row's own onRowClick and open the MR in
    GitLab. */
export function GateRowChips({
  gates,
  onOpenGate,
}: {
  gates: GateRow[];
  onOpenGate: (gateId: string) => void;
}) {
  if (gates.length === 0) return null;
  return (
    <div className="tui-gate-row-face" onClick={e => e.stopPropagation()}>
      {gates.map(gate => {
        const actionable = gate.status === 'open' || gate.status === 'parked';
        if (actionable) {
          const parked = gate.status === 'parked';
          return (
            <Chip
              key={gate.gateId}
              as="button"
              intent={parked ? 'warn' : 'accent'}
              variant="outline"
              uppercase
              data-gate-id={gate.gateId}
              onClick={() => onOpenGate(gate.gateId)}
            >
              {gate.label} · answer{parked ? ' · parked' : ''}
            </Chip>
          );
        }
        if (gate.status === 'answered' && gate.delivery?.outcome === 'stuck') {
          return (
            <Chip
              key={gate.gateId}
              as="button"
              intent="bad"
              variant="outline"
              uppercase
              data-gate-id={gate.gateId}
              data-gate-delivery="stuck"
              onClick={() => onOpenGate(gate.gateId)}
            >
              {DELIVERY_STUCK_MESSAGE}
            </Chip>
          );
        }
        if (gate.status === 'answered' && gate.execution === 'unassigned') {
          return (
            <Chip
              key={gate.gateId}
              as="button"
              intent="bad"
              variant="outline"
              uppercase
              data-gate-id={gate.gateId}
              data-gate-execution="unassigned"
              onClick={() => onOpenGate(gate.gateId)}
            >
              {EXECUTION_UNASSIGNED_MESSAGE}
            </Chip>
          );
        }
        return (
          <AnsweredChip
            key={gate.gateId}
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
        );
      })}
    </div>
  );
}
