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
  gateAnswerPayload,
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
              key={opt}
              label={opt}
              checked={picked.has(opt)}
              onChange={() => toggle(opt)}
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
          <Radio key={opt} value={opt} label={opt} />
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
            ? value.join(', ')
            : '(none)'
          : value || '(none)';
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

/** Renders the gate a pane opened on this run, when one belongs on the page
    (see `activeGateForRun` in `useGates.ts` for which one that is). `open`
    and `parked` are both actionable -- the same question inputs and submit
    button render for either, `parked` additionally wears a badge since a
    pane is no longer waiting on it. `answered` swaps to a read-only summary.

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

  const setAnswer = (id: string, value: string | string[]) => {
    setSelections(prev => ({ ...prev, [id]: value }));
  };

  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const payload = actionable
    ? gateAnswerPayload(gate.questions, selections)
    : null;

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
        // winning row, not a validation failure to retry.
        setBusy(false);
        setConflict(parseConflictResponse(await res.json().catch(() => null)));
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
    // Clicks anywhere in here (a radio's own <label>, a checkbox's text)
    // aren't inside an `a`/`button` closest() would catch, so they'd
    // otherwise bubble to the row's own onClick and navigate away.
    <Paper
      bg={bg.level2}
      p="xxl"
      radius="xl"
      data-testid="gate-card"
      onClick={e => e.stopPropagation()}
      style={{ border: `1px solid ${border.default}` }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700} fz={13} tt="uppercase" c="dimmed">
            review gate
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
            {gate.questions.map(q => (
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
              <Button
                size="xs"
                disabled={!payload || busy}
                onClick={() => void submit()}
                ml="auto"
              >
                {busy ? 'submitting…' : 'submit'}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
