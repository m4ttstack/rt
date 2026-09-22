/** A respond-plan question whose context parses as thread@1 renders as a
    thread card: file:line, severity and "thread N of M" in the head; the
    claim, its points, the verdict and the reply box in the body; the plan
    on the fix option's subtitle. A thread context that fails the parse
    renders as prose, exactly as before. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = { iid: 87 } as unknown as BoardMRWithReview;

type Question = GateRow['questions'][number];

function thread(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'blocking',
    claim: {
      summary:
        'The retry queue re-enqueues a job that already failed permanently.',
      points: [
        'permanent failures carry retryable: false, but enqueue() never reads it',
        'the other three callers all check it',
      ],
    },
    verdict: { call: 'valid', note: 'confirmed against the checkout' },
    reply: {
      kind: 'verbatim',
      text: 'Fixed. enqueue() now drops non-retryable jobs; added a test.',
    },
    ...overrides,
  });
}

function threadQuestion(n: number, context: string): Question {
  return {
    id: `thread-${n}`,
    label: `queue/enqueue.ts:${80 + n}`,
    multi: false,
    context,
    options: [
      {
        value: `reply:t${n}`,
        label: 'reply',
        description: 'post the drafted reply, no code change',
      },
      {
        value: `fix:t${n}`,
        label: 'fix',
        description: 'drop non-retryable jobs in enqueue() and add a test',
      },
      {
        value: `skip:t${n}`,
        label: 'skip',
        description: 'leave the thread for later',
      },
    ],
  };
}

const CODE_CHANGES: Question = {
  id: 'code-changes',
  label: 'Approve the proposed code changes?',
  multi: false,
  options: ['approve', 'revise', 'skip'],
};

function gate(overrides: Partial<GateRow>): GateRow {
  return {
    gateId: 'g-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'open',
    openedAt: 1,
    questions: [],
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function renderGate(row: GateRow) {
  function Host() {
    const form = useGateForm(row, () => {});
    return <GateForm gate={row} mr={MR} form={form} onFocusPane={() => {}} />;
  }
  await React.act(async () => {
    root.render(<Host />);
  });
}

test('a thread@1 question renders claim, points, verdict and reply, never the raw JSON', async () => {
  await renderGate(gate({ questions: [threadQuestion(1, thread())] }));
  const card = container.querySelector('.tui-thread-card')!;
  expect(card.textContent).toContain(
    're-enqueues a job that already failed permanently'
  );
  expect(card.querySelectorAll('.tui-thread-points li').length).toBe(2);
  const call = card.querySelector('.tui-thread-verdict-call')!;
  expect(call.getAttribute('data-call')).toBe('valid');
  expect(call.textContent).toBe('valid');
  expect(card.querySelector('.tui-thread-verdict-note')!.textContent).toBe(
    '· confirmed against the checkout'
  );
  expect(card.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'will post as reply'
  );
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toContain(
    'enqueue() now drops non-retryable jobs'
  );
  expect(container.querySelector('.tui-gate-question-context')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

test('the head carries file:line, the severity pill, and thread N of M by position', async () => {
  await renderGate(
    gate({
      questions: [
        threadQuestion(1, thread()),
        threadQuestion(2, thread({ severity: 'question' })),
        CODE_CHANGES,
      ],
    })
  );
  const ords = [...container.querySelectorAll('.tui-gate-question-ord')].map(
    n => n.textContent
  );
  expect(ords).toEqual(['thread 1 of 2', 'thread 2 of 2']);
  const heads = [
    ...container.querySelectorAll(
      '.tui-gate-question[data-gate-ctx="thread"] .tui-gate-question-head'
    ),
  ];
  expect(heads[0]!.textContent).toContain('queue/enqueue.ts:81');
  expect(
    heads[0]!.querySelector('[data-severity]')!.getAttribute('data-severity')
  ).toBe('blocking');
  for (const progress of container.querySelectorAll('.tui-gate-progress'))
    expect(progress.textContent ?? '').not.toContain('Question');
});

test('each severity renders its own pill', async () => {
  const severities = [
    ['blocking', 'blocking', 'amber'],
    ['non-blocking', 'non-blocking', 'grey'],
    ['question', 'question', 'accent'],
    ['none', 'no ask', 'grey'],
  ] as const;
  await renderGate(
    gate({
      questions: severities.map(([severity], i) =>
        threadQuestion(i + 1, thread({ severity }))
      ),
    })
  );
  const pills = [
    ...container.querySelectorAll('.tui-gate-question-head [data-severity]'),
  ];
  expect(
    pills.map(p => [
      p.getAttribute('data-severity'),
      p.textContent,
      p.getAttribute('data-hue'),
    ])
  ).toEqual(severities.map(s => [...s]));
});

test('each verdict call renders its own word and data-call', async () => {
  const calls = [
    ['valid', 'valid'],
    ['valid-low-value', 'valid, low value'],
    ['pushback', 'pushback'],
    ['needs-clarification', 'needs clarification'],
    ['no-ask', 'no ask'],
  ] as const;
  await renderGate(
    gate({
      questions: calls.map(([call], i) =>
        threadQuestion(
          i + 1,
          thread({ verdict: { call, note: 'which cache path did you hit?' } })
        )
      ),
    })
  );
  expect(
    [...container.querySelectorAll('.tui-thread-verdict-call')].map(n => [
      n.getAttribute('data-call'),
      n.textContent,
    ])
  ).toEqual(calls.map(c => [...c]));
});

test('reply kinds: verbatim and direction label their box, none renders no box', async () => {
  await renderGate(
    gate({
      questions: [
        threadQuestion(1, thread()),
        threadQuestion(
          2,
          thread({
            reply: {
              kind: 'direction',
              text: 'Explain the retry contract and link the doc.',
            },
          })
        ),
        threadQuestion(3, thread({ reply: { kind: 'none' } })),
      ],
    })
  );
  const cards = [...container.querySelectorAll('.tui-thread-card')];
  expect(
    cards[0]!.querySelector('.tui-thread-reply')!.getAttribute('data-kind')
  ).toBe('verbatim');
  expect(cards[0]!.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'will post as reply'
  );
  expect(
    cards[1]!.querySelector('.tui-thread-reply')!.getAttribute('data-kind')
  ).toBe('direction');
  expect(cards[1]!.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'reply direction'
  );
  expect(cards[1]!.textContent).toContain('Explain the retry contract');
  expect(cards[2]!.querySelector('.tui-thread-reply')).toBeNull();
});

test("the fix option's description renders as its choice subtitle", async () => {
  await renderGate(gate({ questions: [threadQuestion(1, thread())] }));
  const subtitles = [
    ...container.querySelectorAll('.tui-gate-choice-subtitle'),
  ].map(n => n.textContent);
  expect(subtitles).toContain(
    'drop non-retryable jobs in enqueue() and add a test'
  );
});

test('a thread context missing a required field renders as prose', async () => {
  const broken = JSON.stringify({ 'gate-ctx': 'thread@1', author: 'renee' });
  await renderGate(gate({ questions: [threadQuestion(1, broken)] }));
  expect(container.querySelector('.tui-thread-card')).toBeNull();
  expect(
    container.querySelector('.tui-gate-question[data-gate-ctx]')
  ).toBeNull();
  expect(container.querySelector('.tui-gate-question-context')).not.toBeNull();
});
