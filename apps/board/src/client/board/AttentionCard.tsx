import type { GateDomain, GateOption } from '@mattstack/gate-kit';
import { optionValue } from '@mattstack/gate-kit';
import { Button } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import type { GateFormState } from './GateForm.tsx';

/** Friendly labels for the pane-attention action set; falls back to the raw
    option string for a value this map doesn't know, so an unexpected daemon
    option still renders rather than vanishing. */
const ACTION_LABELS: Record<string, string> = {
  'focus-pane': 'focus pane',
  resume: 'resume',
  clear: 'clear',
  dismiss: 'dismiss',
};

/** Reads a pane-attention row's `meta.reason` without trusting its shape --
    `meta` comes off the facility gate row as untyped `Record<string, unknown>`. */
function paneReason(gate: GateRow): 'blocked' | 'gone' | undefined {
  const reason = gate.meta?.reason;
  return reason === 'blocked' || reason === 'gone' ? reason : undefined;
}

/**
 * The whole face of a pane-attention gate: a short "pane blocked/gone" line
 * (the peek at what's wrong; the pane's last screen text itself renders in
 * the modal's shared context ScrollPane above this) and one button per
 * option on the gate's single `action` question, in place of the full
 * Questionnaire primitive -- a single-select with no note/step needs none of
 * that machinery. Reuses `form` from `useGateForm` so submit/busy/CAS-loss
 * stay the one implementation every other gate answers through.
 *
 * `focus-pane` answers the gate AND jumps into the pane: `onFocusPane` (the
 * board's own launch-and-focus wiring) when the gate names a domain and an
 * MR, else the same `/gate/focus` POST GateForm's own focus button uses --
 * today's pane-attention gates never carry a domain, so `focusGate()` is the
 * path that actually fires; the domain branch stays for a future kind that
 * does carry one.
 */
export function AttentionCard({
  gate,
  form,
  mr,
  onFocusPane,
}: {
  gate: GateRow;
  form: GateFormState;
  mr?: BoardMRWithReview;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  const question = gate.questions[0];
  const options: GateOption[] = question?.options ?? [];
  const questionId = question?.id ?? 'action';
  const reason = paneReason(gate);

  const handleClick = (value: string) => {
    void form.submit({ answers: { [questionId]: value } });
    if (value !== 'focus-pane') return;
    if (gate.domain && mr) onFocusPane(mr, gate.domain);
    else void form.focusGate();
  };

  return (
    <div className="tui-attention-card">
      {reason && <p className="tui-attention-reason">pane {reason}</p>}
      <div className="tui-attention-actions">
        {options.map(option => {
          const value = optionValue(option);
          return (
            <Button
              key={value}
              type="button"
              variant="filled"
              intent={
                value === 'clear' || value === 'dismiss' ? 'muted' : 'warn'
              }
              size="lg"
              disabled={form.busy}
              onClick={() => handleClick(value)}
            >
              {ACTION_LABELS[value] ?? value}
            </Button>
          );
        })}
      </div>
      {form.failed && (
        <span className="tui-gate-error">
          submit failed... nothing was sent, try again
        </span>
      )}
      {form.focusError && (
        <span className="tui-gate-error">{form.focusError}</span>
      )}
    </div>
  );
}
