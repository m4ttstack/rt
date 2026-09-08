import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import {
  answeredGateSummary,
  resolveAnswerOutcome,
  type AnswerOutcome,
  type GateAnswers,
  type GateSelections,
  type GateSummaryDetailRow,
  type GateSummaryInput,
} from '@mattstack/gate-kit';
import { useGateDraft } from '@mattstack/gate-kit/react';
import type { GateRow } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import { client } from '../api';
import { GateQuestionnaire } from './GateQuestionnaire';

function GateSummaryDetail({ detail }: { detail: GateSummaryDetailRow[] }) {
  return (
    <Stack gap={6} data-testid="gate-answer-summary">
      {detail.map(row => (
        <Group key={row.id} gap={8} wrap="nowrap" align="flex-start">
          <Text fz={12} c="dimmed" style={{ minWidth: 140, flexShrink: 0 }}>
            {row.question}
          </Text>
          <Stack gap={0}>
            <Text fz={13}>
              {row.answers.map((a, i) => (
                <span key={`${a.text}-${i}`} title={a.title}>
                  {i > 0 && ', '}
                  {a.text}
                </span>
              ))}
            </Text>
            {row.note && (
              <Text fz={11} c="dimmed">
                {row.note}
              </Text>
            )}
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

/** The compact answered face: one chip line, detail on demand. `startOpen`
    is the conflict path -- the winning answer someone else recorded is the
    whole message there, so it must not hide behind a toggle. */
function AnsweredSummary({
  row,
  startOpen = false,
}: {
  row: GateSummaryInput;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const summary = answeredGateSummary(row);
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text fz={13} data-testid="gate-chip">
          {summary.chip}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => setOpen(o => !o)}
          data-testid="gate-detail-toggle"
        >
          {open ? 'hide detail' : 'detail'}
        </Button>
      </Group>
      {open && <GateSummaryDetail detail={summary.detail} />}
    </Stack>
  );
}

/** The card's own identity, not a hardcoded "review gate" -- a `clarify`
    gate and a `self-review` gate can both be open on the same run at once
    (supersede only fires within the same subject+kind), so the title is
    what tells them apart. `meta.label` wins when the opener set one;
    otherwise the raw `kind` string. */
function gateTitle(gate: GateRow): string {
  return typeof gate.meta?.label === 'string' ? gate.meta.label : gate.kind;
}

/** Renders one gate a pane opened on this run. `open` and `parked` are both
    actionable: the questionnaire renders for either, `parked` additionally
    wears a badge since a pane is no longer waiting on it. `answered` swaps
    to the summary chip.

    The picks, per-question notes, and the active step live here and are
    mirrored to a localStorage draft while the gate is open (restored on
    mount; cleared on a successful submit, a conflict loss, a Reset, or once
    the gate is no longer open).

    No optimistic local state on a successful submit: the request either
    fails (shown inline, recover by retry) or succeeds and the invalidate
    refetches. A CAS loss is the one response rendered immediately from
    local state -- the daemon already recorded someone else's answer and
    handed back the real winner. */
export function GateCard({ gate }: { gate: GateRow }) {
  const { bg, border } = useSchemeColors();
  const queryClient = useQueryClient();
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const {
    initial: draft,
    save: saveDraft,
    clear: clearDraft,
  } = useGateDraft(gate.id, actionable);
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
  const [contextOpen, setContextOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const questionnaireGate = useMemo(
    () => ({ kind: gate.kind, questions: gate.questions }),
    [gate.kind, gate.questions]
  );

  useEffect(() => {
    saveDraft({ selections, notes, item: step });
  }, [saveDraft, selections, notes, step]);

  const focusReason =
    gate.status === 'parked'
      ? 'parked; resume is board-owned'
      : gate.origin?.paneId || gate.origin?.worktree
        ? null
        : 'no origin on this gate';

  const focusPaneAction = async () => {
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await client.api.gates[':id'].focus.$post({
        param: { id: gate.id },
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
      const res = await client.api.gates[':id'].answer.$post({
        param: { id: gate.id },
        json: payload,
      });
      const outcome = resolveAnswerOutcome(
        res.status,
        await res.json().catch(() => null)
      );
      if (outcome.kind === 'lost') {
        // An answer WAS recorded, just not this one -- the body carries the
        // winning row, not a validation failure to retry. Invalidate here
        // too (not just the success path below): every other consumer of
        // ['gates'] still thinks this gate is open until it refetches, and
        // this body is itself proof the row changed.
        setBusy(false);
        setLost(outcome);
        clearDraft();
        void queryClient.invalidateQueries({ queryKey: ['gates'] });
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
    void queryClient.invalidateQueries({ queryKey: ['gates'] });
  };

  const resetAll = () => {
    setSelections({});
    setNotes({});
    setStep(null);
    clearDraft();
  };

  const status = (
    <>
      {failed && (
        <Text c="bad" fz={12}>
          submit failed... nothing was sent, try again
        </Text>
      )}
      {focusError && (
        <Text c="bad" fz={12} data-testid="gate-focus-error">
          {focusError}
        </Text>
      )}
    </>
  );

  const focus = (
    <Button
      size="xs"
      variant="default"
      data-testid="gate-focus"
      disabled={focusReason !== null || focusBusy}
      title={focusReason ?? 'jump into the pane behind this gate'}
      onClick={() => void focusPaneAction()}
    >
      focus pane
    </Button>
  );

  return (
    // Clicks on a choice's label text are not inside an `a`/`button` a
    // row-level closest() would catch; kept as cheap insurance for a future
    // caller that nests this inside something clickable.
    <Paper
      bg={bg.level2}
      p="xxl"
      radius="xl"
      data-testid="gate-card"
      data-actionable={actionable}
      data-gate-id={gate.id}
      onClick={e => e.stopPropagation()}
      style={{ border: `1px solid ${border.default}` }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text
            fw={700}
            fz={13}
            tt="uppercase"
            c="dimmed"
            data-testid="gate-card-title"
          >
            {gateTitle(gate)}
          </Text>
          <Group gap="xs">
            {gate.status === 'parked' && (
              <Badge
                color="warn"
                variant="light"
                data-testid="gate-parked-badge"
              >
                parked
              </Badge>
            )}
            {(answered || lost) && (
              <Badge
                color="ok"
                variant="light"
                data-testid="gate-answered-badge"
              >
                answered
              </Badge>
            )}
          </Group>
        </Group>
        {typeof gate.context === 'string' && gate.context.length > 0 && (
          <Stack gap={4}>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setContextOpen(o => !o)}
              data-testid="gate-context-toggle"
              style={{ alignSelf: 'flex-start' }}
            >
              {contextOpen ? 'hide context' : 'show context'}
            </Button>
            {contextOpen && (
              <Text
                fz={12}
                style={{ whiteSpace: 'pre-wrap' }}
                data-testid="gate-context-body"
              >
                {gate.context}
              </Text>
            )}
          </Stack>
        )}
        {answered ? (
          <AnsweredSummary row={gate} />
        ) : lost ? (
          <>
            <Text c="bad" fz={12}>
              answered elsewhere
            </Text>
            <AnsweredSummary
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
        ) : actionable ? (
          <GateQuestionnaire
            gate={questionnaireGate}
            selections={selections}
            onSelectionsChange={setSelections}
            notes={notes}
            onNoteChange={(name, value) =>
              setNotes(prev => ({ ...prev, [name]: value }))
            }
            step={step}
            onStepChange={setStep}
            onReset={resetAll}
            busy={busy}
            onSubmitAnswers={payload => void submit(payload)}
            status={status}
            focus={focus}
          />
        ) : (
          <AnsweredSummary row={gate} />
        )}
      </Stack>
    </Paper>
  );
}
