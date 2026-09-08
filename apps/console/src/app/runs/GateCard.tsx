import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Radio,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import { client } from '../api';
import {
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  codeChangesHidden,
  displayValueLabel,
  gateAnswerPayload,
  optionLabel,
  optionValue,
  parseConflictResponse,
  unwrapGateAnswer,
  type GateAnswerConflict,
  type GateAnswers,
  type GateSelections,
} from './gate-format';

/** One question's input: a `Checkbox` per option for a `multi` question, a
    `Radio.Group` for a single-select. */
function GateQuestionField({
  question,
  value,
  onChange,
}: {
  question: GateQuestion;
  value: string | string[] | undefined;
  onChange: (id: string, value: string | string[]) => void;
}) {
  if (question.multi) {
    const picked = new Set(Array.isArray(value) ? value : []);
    const toggle = (opt: string) => {
      const next = new Set(picked);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      onChange(question.id, [...next]);
    };
    return (
      <Stack gap={4}>
        <Text fw={600} fz={13}>
          {question.label}
        </Text>
        <Stack gap={6}>
          {question.options.map(opt => (
            <Checkbox
              key={optionValue(opt)}
              label={optionLabel(opt)}
              checked={picked.has(optionValue(opt))}
              onChange={() => toggle(optionValue(opt))}
            />
          ))}
        </Stack>
      </Stack>
    );
  }
  return (
    <Radio.Group
      label={question.label}
      value={typeof value === 'string' ? value : ''}
      onChange={v => onChange(question.id, v)}
    >
      <Stack gap={6} mt={6}>
        {question.options.map(opt => (
          <Radio
            key={optionValue(opt)}
            value={optionValue(opt)}
            label={optionLabel(opt)}
          />
        ))}
      </Stack>
    </Radio.Group>
  );
}

/** The answered branch: what got chosen, read-only -- no inputs, nothing to
    resubmit. A question missing from `answers` (an older or malformed gate)
    shows a placeholder rather than throwing. A value may be the bare option
    string/array or the wrapper's `{value, note}` note form -- unwrap before
    rendering, or React throws on the object child. */
function GateAnswerSummary({
  questions,
  answers,
}: {
  questions: GateQuestion[];
  answers?: GateAnswers;
}) {
  return (
    <Stack gap={6} data-testid="gate-answer-summary">
      {questions.map(q => {
        const raw = answers?.[q.id];
        const { value, note } =
          raw !== undefined
            ? unwrapGateAnswer(raw)
            : { value: undefined, note: undefined };
        const text = Array.isArray(value)
          ? value.length
            ? value.map(v => displayValueLabel(v, q.options)).join(', ')
            : '(none)'
          : value
            ? displayValueLabel(value, q.options)
            : '(none)';
        return (
          <Group key={q.id} gap={8} wrap="nowrap" align="flex-start">
            <Text fz={12} c="dimmed" style={{ minWidth: 140, flexShrink: 0 }}>
              {q.label}
            </Text>
            <Stack gap={0}>
              <Text fz={13}>{text}</Text>
              {note && (
                <Text fz={11} c="dimmed">
                  {note}
                </Text>
              )}
            </Stack>
          </Group>
        );
      })}
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

/** Renders one gate a pane opened on this run (RunDetail renders one of
    these per active gate -- see `activeGatesForRun` in `useGates.ts` for
    which ones those are). `open` and `parked` are both actionable -- the
    same question inputs and submit button render for either, `parked`
    additionally wears a badge since a pane is no longer waiting on it.
    `answered` swaps to a read-only summary.

    No optimistic local state on a successful submit: the request either
    fails (shown inline, same recover-by-retry shape as the abandon prompt)
    or succeeds and the invalidate below refetches -- the websocket
    (`useRunEvents`) would flip this on its own regardless, this just avoids
    waiting on that round trip. A 409 is the one response rendered
    immediately from local state -- it's not a guess, the daemon's CAS
    already recorded someone else's answer and handed back the real
    winner. */
export function GateCard({ gate }: { gate: GateRow }) {
  const { bg, border } = useSchemeColors();
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<GateSelections>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<GateAnswerConflict | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const setAnswer = (id: string, value: string | string[]) => {
    setSelections(prev => ({ ...prev, [id]: value }));
  };

  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const hidden =
    actionable && codeChangesHidden(gate.kind, gate.questions, selections);
  const effective = hidden
    ? { ...selections, [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL }
    : selections;
  const payload = actionable
    ? gateAnswerPayload(gate.questions, effective)
    : null;

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

  const submit = async () => {
    if (!payload) return;
    setBusy(true);
    setFailed(false);
    setConflict(null);
    try {
      const res = await client.api.gates[':id'].answer.$post({
        param: { id: gate.id },
        json: payload,
      });
      if (res.status === 409) {
        // An answer WAS recorded, just not this one -- the body carries the
        // winning row, not a validation failure to retry. Invalidate here
        // too (not just the success path below): every other consumer of
        // ['gates'] (RunRow's blocked badge, another open GateCard for the
        // same run) still thinks this gate is open until they refetch, and
        // the websocket that would normally do that for them may be
        // delayed or dropped -- this 409 body is itself proof the row
        // changed, so there's no reason to wait on the socket for it.
        setBusy(false);
        setConflict(parseConflictResponse(await res.json().catch(() => null)));
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
    void queryClient.invalidateQueries({ queryKey: ['gates'] });
  };

  return (
    // GateCard renders directly in RunDetail's content stack -- unlike
    // board's original (embedded in a clickable MR row), there is no
    // onRowClick here to escape. Kept anyway as cheap insurance: a radio's
    // own <label> or a checkbox's text is not inside an `a`/`button`
    // closest() would catch, so a future caller that DOES nest this inside
    // something clickable (a card list, say) gets the same protection for
    // free.
    <Paper
      bg={bg.level2}
      p="xxl"
      radius="xl"
      data-testid="gate-card"
      // Distinguishes an open|parked card (has a submit control) from a
      // read-only answered one for `AnswerGateAction`'s scroll target --
      // `activeGatesForRun` sorts by `openedAt` alone, so a newer answered
      // gate can sort ahead of an older still-open one.
      data-actionable={actionable}
      // The `/gates/:id` deep-link scroll target (RunDetail's gate-param
      // effect); distinct from `data-testid` so it stays a stable selector
      // even if the testid ever changes.
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
            {(answered || conflict) && (
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
          <GateAnswerSummary
            questions={gate.questions}
            answers={gate.answer?.answers}
          />
        ) : conflict ? (
          <>
            <Text c="bad" fz={12}>
              answered elsewhere
            </Text>
            <GateAnswerSummary
              questions={gate.questions}
              answers={conflict.answers}
            />
          </>
        ) : (
          <>
            {gate.questions
              .filter(q => !(hidden && q.id === CODE_CHANGES_QUESTION_ID))
              .map(q => (
                <GateQuestionField
                  key={q.id}
                  question={q}
                  value={selections[q.id]}
                  onChange={setAnswer}
                />
              ))}
            <Group justify="space-between" align="center">
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
              <Group gap="xs" ml="auto">
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
                <Button
                  size="xs"
                  disabled={!payload || busy}
                  onClick={() => void submit()}
                >
                  {busy ? 'submitting…' : 'submit'}
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
