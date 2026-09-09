import { Chip } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { AnsweredChip } from './GateForm.tsx';

/** A row's whole gate face: no form controls, just chips. An actionable gate
    (`open`/`parked`) is a button that opens the decision queue on that gate;
    anything else renders the same answered summary the queue itself shows.
    `stopPropagation` matches the old card: a chip click must not bubble to
    the row's own onRowClick and open the MR in GitLab. */
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
