/** The respond sheet decides every thread at once and builds the wire
    answer itself: every thread's pick, code-changes implied (`approve` with
    any fix, else the gate's own sentinel), `revise` only from the send-back
    action with its reason as the note, a trimmed thread note as
    `{ value, note }`, and a replies gate's checklist plus its
    disposition. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = {
  iid: 87,
  title: 'add retry to the fetch queue',
  sourceBranch: 'retry-queue',
  targetBranch: 'main',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  author: { username: 'alex', name: 'Alex Doe' },
  pipelineState: 'passed',
  behindTarget: null,
  blockers: { any: false, hasConflicts: false },
  reviews: { isApproved: false, given: 0, required: 1 },
} as unknown as BoardMRWithReview;

const thread = (summary: string) =>
  JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'blocking',
    claim: { summary },
    verdict: { call: 'valid' },
    reply: { kind: 'verbatim', text: 'fixed, with a test.' },
  });

const threadQuestion = (n: number) => ({
  id: `thread-${n}`,
  label: `queue/enqueue.ts:${n * 10}`,
  multi: false,
  context: thread(`claim ${n}`),
  options: [
    { value: `reply:t${n}`, label: 'reply' },
    { value: `fix:t${n}`, label: 'fix' },
    { value: `skip:t${n}`, label: 'skip' },
  ],
});

function planGate(): GateRow {
  return {
    gateId: 'g-plan',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: JSON.stringify({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      threads: { total: 2, blocking: 2 },
    }),
    questions: [
      threadQuestion(1),
      threadQuestion(2),
      {
        id: 'code-changes',
        label: 'Approve the proposed code changes?',
        multi: false,
        options: ['approve', 'revise', 'skip'],
      },
    ],
  };
}

function postGate(): GateRow {
  return {
    gateId: 'g-post',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-post',
    label: 'respond-post !87',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: JSON.stringify({
      'gate-ctx': 'post@1',
      reviewer: 'renee',
      replies: 2,
      fixes: [],
    }),
    questions: [
      {
        id: 'replies',
        label: 'Post which replies?',
        multi: true,
        context: JSON.stringify({
          'gate-ctx': 'replies@1',
          replies: [
            { thread: 'r1', file: 'a.ts:1', verb: 'reply', text: 'one' },
            { thread: 'r2', file: 'b.ts:2', verb: 'reply', text: 'two' },
          ],
        }),
        options: ['r1', 'r2'],
      },
      {
        id: 'disposition',
        label: 'After posting?',
        multi: false,
        options: ['resolve-addressed', 'leave-open'],
      },
    ],
  };
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;
let answeredElsewhere: boolean;
let continues: number;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  continues = 0;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: { answer: { answers: {}, by: 'pane' } },
        }),
        { status: 409 }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(row: GateRow, mr: BoardMRWithReview = MR) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        mr={mr}
        position={1}
        states={['active']}
        onClose={() => {}}
        onNext={() => {}}
        onBack={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {
          continues++;
        }}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);

async function pick(value: string) {
  const input = $(`input[value="${value}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`no choice ${value}`);
  await React.act(async () => {
    input.click();
  });
}

async function type(label: string, text: string) {
  const input = $(`input[aria-label="${label}"]`) as HTMLInputElement;
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const submit = () => $('.tui-sheet-submit') as HTMLButtonElement;

async function clickSubmit() {
  await React.act(async () => {
    submit().click();
    await new Promise(r => setTimeout(r, 0));
  });
}

const answer = () => posts.find(p => p.url === '/gate/answer')?.body;

test('every thread renders at once in the main column', async () => {
  await render(planGate());
  expect(
    document.body.querySelectorAll('.tui-respond-list > .tui-gate-question')
  ).toHaveLength(2);
  expect($('.tui-sheet-list-tally')!.textContent).toBe('0 of 2 decided');
});

test("each thread's choices form one named radio group that holds only its radios", async () => {
  await render(planGate());
  const groups = [...document.body.querySelectorAll('[role="radiogroup"]')];
  expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(
    planGate()
      .questions.slice(0, 2)
      .map(q => q.label)
  );
  for (const g of groups) {
    expect(g.querySelectorAll('input[type="radio"]').length).toBe(3);
    expect(g.querySelector('input:not([type="radio"]), textarea')).toBeNull();
  }
});

test('submit stays disabled until every thread is decided', async () => {
  await render(planGate());
  expect(submit().disabled).toBe(true);
  await pick('reply:t1');
  expect(submit().disabled).toBe(true);
  await pick('reply:t2');
  expect(submit().disabled).toBe(false);
  expect(submit().textContent).toBe('submit · 2 reply');
});

test('with no fix picked, code-changes stays out of the rail and posts its sentinel', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('skip:t2');
  expect($('.tui-sheet-dock-question')).toBeNull();
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'reply:t1',
      'thread-2': 'skip:t2',
      'code-changes': 'skip',
    },
  });
});

test('a gate answered elsewhere offers continue, which retires it from the queue', async () => {
  answeredElsewhere = true;
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  await clickSubmit();
  expect($('.tui-sheet-lost')!.textContent).toContain('answered elsewhere');
  const cont = [
    ...document.body.querySelectorAll('.tui-sheet-lost button'),
  ].find(b => b.textContent === 'continue');
  await React.act(async () => {
    (cont as HTMLButtonElement).click();
  });
  expect(continues).toBe(1);
});

test('a plan gate without the skip sentinel asks code-changes in the dock', async () => {
  const gate = planGate();
  gate.questions[2] = { ...gate.questions[2]!, options: ['approve', 'revise'] };
  await render(gate);
  await pick('reply:t1');
  await pick('reply:t2');
  expect($('.tui-sheet-dock-question')).not.toBeNull();
  expect(submit().disabled).toBe(true);
  await pick('approve');
  expect(submit().disabled).toBe(false);
});

test('a fix implies approve: no code-changes question, submit is live', async () => {
  await render(planGate());
  await pick('fix:t1');
  await pick('reply:t2');
  expect($('.tui-sheet-dock-question')).toBeNull();
  expect($('input[value="approve"]')).toBeNull();
  expect(submit().disabled).toBe(false);
  expect(submit().textContent).toBe('submit · 1 fix · 1 reply');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'fix:t1',
      'thread-2': 'reply:t2',
      'code-changes': 'approve',
    },
  });
});

test('withdrawing the only fix drops code-changes back to the sentinel', async () => {
  await render(planGate());
  await pick('fix:t1');
  await pick('reply:t1');
  await pick('reply:t2');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'reply:t1',
      'thread-2': 'reply:t2',
      'code-changes': 'skip',
    },
  });
});

test("a thread's note travels trimmed with its pick", async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  await type('Note for queue/enqueue.ts:10', '  say which test  ');
  await clickSubmit();
  expect(answer()).toMatchObject({
    answers: {
      'thread-1': { value: 'reply:t1', note: 'say which test' },
      'thread-2': 'reply:t2',
    },
  });
});

test('a replies gate posts its checklist and disposition', async () => {
  await render(postGate());
  expect($('.tui-sheet-list-title')!.textContent).toBe('Post which replies?');
  await pick('r2');
  await pick('resolve-addressed');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 2 selected');
  expect(submit().textContent).toBe('post 1 · resolve-addressed');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post',
    answers: { replies: ['r2'], disposition: 'resolve-addressed' },
  });
});

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
  });
}

async function typeArea(label: string, text: string) {
  const area = $(`textarea[aria-label="${label}"]`) as HTMLTextAreaElement;
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    setter.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('sending the plan back needs a reason and posts revise with it', async () => {
  await render(planGate());
  await pick('fix:t1');
  await click($('.tui-sheet-revise'));
  expect(submit().textContent).toBe('send back for revision');
  expect(submit().disabled).toBe(true);
  await typeArea(
    'What should the new plan change?',
    '  split the fix into its own MR  '
  );
  expect(submit().disabled).toBe(false);
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'fix:t1',
      'thread-2': 'reply:t2',
      'code-changes': {
        value: 'revise',
        note: 'split the fix into its own MR',
      },
    },
  });
});

test('a send-back reason survives leaving the gate and coming back', async () => {
  await render(planGate());
  await pick('fix:t1');
  await click($('.tui-sheet-revise'));
  await typeArea('What should the new plan change?', 'split the fix');
  await React.act(async () => root.unmount());
  root = createRoot(container);
  await render(planGate());
  const area = $(
    'textarea[aria-label="What should the new plan change?"]'
  ) as HTMLTextAreaElement | null;
  expect(area?.value).toBe('split the fix');
  expect(submit().textContent).toBe('send back for revision');
});

test('cancel leaves send-back mode and restores the submit', async () => {
  await render(planGate());
  await click($('.tui-sheet-revise'));
  await click($('.tui-sheet-reset'));
  expect($('textarea')).toBeNull();
  expect(submit().textContent).toBe('submit');
});

test('a replies gate offers no send-back action', async () => {
  await render(postGate());
  expect($('.tui-sheet-revise')).toBeNull();
});

/** The answered plan gate a post gate follows: three threads, r1 and r2
    answered with replies, r3 skipped. */
function answeredPlan(): GateRow {
  return {
    ...planGate(),
    gateId: 'g-plan-done',
    status: 'answered',
    questions: ['r1', 'r2', 'r3'].map((id, i) => ({
      id: `thread-${i + 1}`,
      label: `${'abc'[i]}.ts:${i + 1}`,
      multi: false,
      context: thread(`claim ${id}`),
      options: [`reply:${id}`, `fix:${id}`, `skip:${id}`],
    })),
    answers: {
      'thread-1': 'reply:r1',
      'thread-2': 'reply:r2',
      'thread-3': 'skip:r3',
    },
  };
}

const withPlan = () =>
  ({ ...MR, gates: [answeredPlan()] }) as unknown as BoardMRWithReview;

test('with its plan gate on the row, the post step draws every plan thread as a card', async () => {
  await render(postGate(), withPlan());
  const cards = [...document.body.querySelectorAll('[data-step="post"]')];
  expect(cards.map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
    'c.ts:3',
  ]);
  expect(
    cards.map(c => c.querySelector('[data-outcome]')?.textContent)
  ).toEqual(['reply only', 'reply only', 'skipped']);
  expect(cards[0]!.querySelector('.tui-thread-claim')!.textContent).toBe(
    'claim r1'
  );
  expect(cards[2]!.textContent).toContain('Nothing to post for this thread.');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('2 of 2 posting');
});

test('a planned fix with nothing to post reads as held, never fixed', async () => {
  const plan = answeredPlan();
  plan.answers = { ...plan.answers, 'thread-3': 'fix:r3' };
  await render(postGate(), {
    ...MR,
    gates: [plan],
  } as unknown as BoardMRWithReview);
  const third = document.body.querySelectorAll('[data-step="post"]')[2]!;
  expect(third.querySelector('[data-outcome]')!.textContent).toBe('fix held');
});

test('the post step defaults every reply to post; hold keeps one back', async () => {
  await render(postGate(), withPlan());
  await pick('resolve-addressed');
  const holdFirst = document.body.querySelectorAll(
    '[data-step="post"] input[value="hold"]'
  )[0] as HTMLInputElement;
  await React.act(async () => {
    holdFirst.click();
  });
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 2 posting');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post',
    answers: { replies: ['r2'], disposition: 'resolve-addressed' },
  });
});

async function holdAll() {
  for (const hold of document.body.querySelectorAll(
    '[data-step="post"] input[value="hold"]'
  ))
    await React.act(async () => {
      (hold as HTMLInputElement).click();
    });
}

test('replies held on the post step stay held after leaving and coming back', async () => {
  await render(postGate(), withPlan());
  await holdAll();
  expect($('.tui-sheet-list-tally')!.textContent).toBe('0 of 2 posting');
  await React.act(async () => root.unmount());
  root = createRoot(container);
  await render(postGate(), withPlan());
  expect($('.tui-sheet-list-tally')!.textContent).toBe('0 of 2 posting');
});

test('reset on the post step restores the default of posting every reply', async () => {
  await render(postGate(), withPlan());
  await holdAll();
  await click($('.tui-sheet-reset'));
  expect($('.tui-sheet-list-tally')!.textContent).toBe('2 of 2 posting');
});

test('without its plan gate the post step keeps the plain checklist', async () => {
  await render(postGate());
  expect($('[data-step="post"]')).toBeNull();
  expect($('[data-gate-ctx="replies"]')).not.toBeNull();
});
