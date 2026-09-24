import { useEffect, useMemo, useState } from 'react';

import type {
  AnswerOutcome,
  GateAnswers,
  GateSelections,
  GateSummaryDetailRow,
  GateSummaryInput,
} from '@mattstack/gate-kit';
import { answeredGateSummary, resolveAnswerOutcome } from '@mattstack/gate-kit';
import { gateItems, useGateDraft } from '@mattstack/gate-kit/react';
import type { GateRow } from '../../gates/store.ts';
import { gateOrigin } from '../../gates/wait-meta.ts';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';

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
            {row.text && (
              <div className="tui-gate-summary-reply" data-edited-reply="">
                edited reply: {row.text}
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The compact answered face: one chip line, detail on demand. The conflict
    path passes startOpen -- the winning answer someone else recorded is the
    whole message there. Exported for its own Storybook coverage and for
    DecisionQueueModal, which renders it directly for any non-actionable gate. */
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

/** All answer-form state for one actionable gate: selections, notes and
    texts seeded from the localStorage draft, the submit + CAS-loss flow,
    and the origin-focus call. The decision queue's sheets are the only
    hosts that mount it (a row's chip only opens the queue), and each reads
    `lost` for its own rail (the answered chip on a CAS loss). */
function useGateForm(gate: GateRow, onAnswered?: () => void) {
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
  const [texts, setTexts] = useState<Record<string, string>>(
    () => draft?.texts ?? {}
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lost, setLost] = useState<AnswerOutcome | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const origin = gateOrigin(gate);
  const originFocusable = Boolean(origin?.paneId || origin?.worktree);

  const { display } = useMemo(
    () => gateItems({ kind: gate.kind, questions: gate.questions }, selections),
    [gate.kind, gate.questions, selections]
  );

  useEffect(() => {
    saveDraft({ selections, notes, texts, item: null });
  }, [saveDraft, selections, notes, texts]);

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
  const setNote = (name: string, value: string) =>
    setNotes(prev => ({ ...prev, [name]: value }));
  const setText = (name: string, value: string) =>
    setTexts(prev => ({ ...prev, [name]: value }));
  const clearText = (name: string) =>
    setTexts(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  // Keeping the texts keeps the draft too: the save effect rewrites it from
  // the reset state, and clearing it here would drop the kept texts on reload.
  const resetAll = ({ keepTexts = false }: { keepTexts?: boolean } = {}) => {
    setSelections({});
    setNotes({});
    if (keepTexts) return;
    setTexts({});
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

  const submit = async (
    payload: { answers: GateAnswers } | null,
    transformAnswers?: (answers: GateAnswers) => GateAnswers
  ) => {
    if (!payload || busy) return;
    setBusy(true);
    setFailed(false);
    setLost(null);
    const answers = transformAnswers
      ? transformAnswers(payload.answers)
      : payload.answers;
    try {
      const res = await fetch('/gate/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateId: gate.gateId, answers }),
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
    onAnswered?.();
  };

  return {
    selections,
    notes,
    texts,
    busy,
    failed,
    lost,
    focusBusy,
    focusError,
    originFocusable,
    display,
    setSingle,
    toggleMulti,
    setNote,
    setText,
    clearText,
    resetAll,
    focusGate,
    submit,
  };
}

export type GateFormState = ReturnType<typeof useGateForm>;

export { AnsweredChip, useGateForm };
