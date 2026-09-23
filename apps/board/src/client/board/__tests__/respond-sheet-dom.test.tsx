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
import {
  installFakeResizeObserver,
  reserveOf,
} from './fake-resize-observer.ts';

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
let closes: number;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  continues = 0;
  closes = 0;
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
        onClose={() => {
          closes++;
        }}
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
  expect(submit().textContent).toBe('submit · 2 replies');
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

/** The per-thread post gate: one multi question per offered thread with a
    post and a resolve option, resolve recommended on the fix only. */
function perThreadPostGate(): GateRow {
  const replyQ = (
    n: number,
    thread: string,
    verb: 'fix' | 'reply',
    text: string
  ) => ({
    id: `thread-${n}`,
    label: `${'ab'[n - 1]}.ts:${n}`,
    multi: true,
    context: JSON.stringify({
      'gate-ctx': 'reply@1',
      thread,
      file: `${'ab'[n - 1]}.ts:${n}`,
      verb,
      ...(verb === 'fix' ? { sha: 'ab12cd3' } : {}),
      text,
    }),
    options: [
      { value: `post:${thread}`, label: 'Post (Recommended)' },
      {
        value: `resolve:${thread}`,
        label: verb === 'fix' ? 'Resolve (Recommended)' : 'Resolve',
      },
    ],
  });
  return {
    ...postGate(),
    gateId: 'g-post-threads',
    questions: [
      replyQ(1, 'r1', 'fix', 'Fixed -- a.ts:1 now guards the retry.'),
      replyQ(2, 'r2', 'reply', 'The delay is fixed by design.'),
    ],
  };
}

const directionThread = (summary: string) =>
  JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'blocking',
    claim: { summary },
    verdict: { call: 'valid' },
    reply: { kind: 'direction', text: 'say the delay is by design.' },
  });

/** The plan the per-thread post step follows: a fix (r1); a reply override
    (r2, whose card showed only a direction, so Gate 2 offers its redraft);
    a skip (r3); and a reply-only thread (r4) Gate 2 does not offer, which
    posts as Gate 1 decided it, edited there when `text` is given. */
const withFixPlan = (text?: string) => {
  const plan = answeredPlan();
  plan.questions = [
    plan.questions[0]!,
    { ...plan.questions[1]!, context: directionThread('claim r2') },
    plan.questions[2]!,
    {
      id: 'thread-4',
      label: 'd.ts:4',
      multi: false,
      context: thread('claim r4'),
      options: ['reply:r4', 'fix:r4', 'skip:r4'],
    },
  ];
  plan.answers = {
    ...plan.answers,
    'thread-1': 'fix:r1',
    'thread-4': text ? { value: 'reply:r4', text } : 'reply:r4',
  };
  return { ...MR, gates: [plan] } as unknown as BoardMRWithReview;
};

const postCards = () => [
  ...document.body.querySelectorAll<HTMLElement>('[data-step="post"]'),
];
const control = (card: HTMLElement, value: 'post' | 'hold' | 'resolve') =>
  card.querySelector<HTMLInputElement>(`input[value="${value}"]`);

test('per-thread post step: a card per plan thread, each reply with post/hold and a resolve toggle', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const cards = postCards();
  expect(cards.map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
    'c.ts:3',
    'd.ts:4',
  ]);
  for (const card of cards.slice(0, 2)) {
    expect(control(card, 'post')?.type).toBe('radio');
    expect(control(card, 'hold')?.type).toBe('radio');
    expect(control(card, 'resolve')?.type).toBe('checkbox');
  }
  expect(cards[2]!.textContent).toContain('Nothing to post for this thread.');
  expect(control(cards[2]!, 'resolve')).toBeNull();
  expect(control(cards[3]!, 'resolve')).toBeNull();
  // A post card approves the reply as shown; it takes no note.
  expect(
    document.body.querySelector('[data-step="post"] .tui-gate-note')
  ).toBeNull();
});

test('per-thread post step starts from the recommended picks: post everywhere, resolve on the fix', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const [fix, reply] = postCards();
  expect(control(fix!, 'post')!.checked).toBe(true);
  expect(control(fix!, 'resolve')!.checked).toBe(true);
  expect(control(reply!, 'post')!.checked).toBe(true);
  expect(control(reply!, 'resolve')!.checked).toBe(false);
  expect($('.tui-sheet-list-tally')!.textContent).toBe('3 of 3 posting');
  expect(submit().textContent).toBe('post 3 · resolve 1');
});

test('hold plus resolve resolves the thread without posting its reply', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => control(reply, 'hold')!.click());
  await React.act(async () => control(reply, 'resolve')!.click());
  expect(submit().textContent).toBe('post 2 · resolve 2');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: {
      'thread-1': ['post:r1', 'resolve:r1'],
      'thread-2': ['resolve:r2'],
    },
  });
});

test('holding every offered thread with nothing resolved submits empty picks; the reply-only thread still posts', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const [fix, reply] = postCards();
  await React.act(async () => control(fix!, 'hold')!.click());
  await React.act(async () => control(fix!, 'resolve')!.click());
  await React.act(async () => control(reply!, 'hold')!.click());
  expect(submit().textContent).toBe('post 1');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 3 posting');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: { 'thread-1': [], 'thread-2': [] },
  });
});

test('reset on the per-thread post step restores the recommended picks', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => control(reply, 'hold')!.click());
  await click($('.tui-sheet-reset'));
  const [fix, again] = postCards();
  expect(control(again!, 'post')!.checked).toBe(true);
  expect(control(fix!, 'resolve')!.checked).toBe(true);
  expect(submit().textContent).toBe('post 3 · resolve 1');
});

test('the dock lists each thread with what the submit does to it', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const rows = [
    ...document.body.querySelectorAll(
      '[data-card="responses"] .tui-sheet-card-row'
    ),
  ].map(r => r.textContent);
  expect(rows).toEqual(['postresolvea.ts:1', 'postb.ts:2', 'postd.ts:4']);
});

test('without its plan gate, each per-thread question still draws its reply and its controls', async () => {
  await render(perThreadPostGate());
  const cards = postCards();
  expect(cards.map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
  ]);
  expect(cards[0]!.textContent).toContain(
    'Fixed -- a.ts:1 now guards the retry.'
  );
  expect(cards[0]!.querySelector('[data-outcome]')?.textContent).toBe('fixed');
  expect(control(cards[1]!, 'resolve')?.checked).toBe(false);
  expect($('.tui-sheet-list-tally')!.textContent).toBe('2 of 2 posting');
});

/** The same gate after `gate-ctx.sh fit` went over budget: every context,
    the gate's own included, flattened to prose. */
function prosePostGate(): GateRow {
  const gate = perThreadPostGate();
  return {
    ...gate,
    gateId: 'g-post-prose',
    context:
      "Posting replies to renee's review · 2 replies · fix pushed ab12cd3",
    questions: gate.questions.map((q, i) => ({
      ...q,
      context: [
        'a.ts:1 FIX · ab12cd3: Fixed -- a.ts:1 now guards the retry.',
        'b.ts:2 REPLY: The delay is fixed by design.',
      ][i],
    })),
  };
}

test('a per-thread gate flattened to prose still opens the post step with its defaults', async () => {
  await render(prosePostGate());
  const cards = postCards();
  expect(cards.map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
  ]);
  expect(cards[0]!.textContent).toContain(
    'a.ts:1 FIX · ab12cd3: Fixed -- a.ts:1 now guards the retry.'
  );
  expect(control(cards[0]!, 'resolve')!.checked).toBe(true);
  expect(control(cards[1]!, 'resolve')!.checked).toBe(false);
  expect($('.tui-sheet-context-card')!.textContent).toContain(
    "Posting replies to renee's review"
  );
  expect(submit().textContent).toBe('post 2 · resolve 1');
});

test('a thread with no usable reply context says where to read it, never raw JSON', async () => {
  const gate = perThreadPostGate();
  gate.questions = [
    { ...gate.questions[0]!, context: undefined },
    {
      ...gate.questions[1]!,
      context: JSON.stringify({
        'gate-ctx': 'reply@1',
        thread: 'r9',
        file: 'z.ts:9',
        verb: 'reply',
        text: 'a different thread',
      }),
    },
  ];
  await render(gate);
  const cards = postCards();
  for (const card of cards) {
    expect(card.textContent).toContain(
      'The reply text did not fit the gate; read it in the pane.'
    );
    expect(card.textContent).not.toContain('gate-ctx');
  }
});

test('each resolve checkbox is named by its thread', async () => {
  await render(perThreadPostGate(), withFixPlan());
  expect(
    postCards()
      .slice(0, 2)
      .map(c => control(c, 'resolve')!.getAttribute('aria-label'))
  ).toEqual(['a.ts:1: resolve', 'b.ts:2: resolve']);
});

test('a dock question on a per-thread gate joins the submit label once picked', async () => {
  const gate = perThreadPostGate();
  gate.questions = [
    ...gate.questions,
    {
      id: 'next',
      label: 'Next',
      multi: false,
      options: ['proceed', 'iterate', 'hold'],
    },
  ];
  await render(gate, withFixPlan());
  expect(submit().disabled).toBe(true);
  await pick('proceed');
  expect(submit().textContent).toBe('post 3 · resolve 1 · proceed');
  expect(submit().disabled).toBe(false);
});

test('a held thread stays held after leaving the per-thread post step and coming back', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => control(reply, 'hold')!.click());
  expect(submit().textContent).toBe('post 2 · resolve 1');
  await React.act(async () => root.unmount());
  root = createRoot(container);
  await render(perThreadPostGate(), withFixPlan());
  expect(control(postCards()[1]!, 'hold')!.checked).toBe(true);
  expect(submit().textContent).toBe('post 2 · resolve 1');
});

const seedTexts = (
  texts: Record<string, string>,
  selections?: Record<string, string[]>
) =>
  localStorage.setItem(
    `gate-kit:draft:g-post-threads`,
    JSON.stringify({
      selections: selections ?? {
        'thread-1': ['post:r1', 'resolve:r1'],
        'thread-2': ['post:r2'],
      },
      notes: {},
      texts,
      item: null,
    })
  );

test('an edited posting thread answers with its text; the others stay bare', async () => {
  seedTexts({ 'thread-1': '  Fixed, and the retry is now bounded.  ' });
  await render(perThreadPostGate(), withFixPlan());
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: {
      'thread-1': {
        value: ['post:r1', 'resolve:r1'],
        text: 'Fixed, and the retry is now bounded.',
      },
      'thread-2': ['post:r2'],
    },
  });
});

test('a held thread keeps its edit out of the answer', async () => {
  seedTexts(
    { 'thread-2': 'edited but held' },
    { 'thread-1': ['post:r1'], 'thread-2': [] }
  );
  await render(perThreadPostGate(), withFixPlan());
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: { 'thread-1': ['post:r1'], 'thread-2': [] },
  });
});

test('an emptied reply on a posting thread disables submit', async () => {
  seedTexts({ 'thread-2': '   ' });
  await render(perThreadPostGate(), withFixPlan());
  expect(submit().disabled).toBe(true);
});

const editButton = (card: HTMLElement) =>
  card.querySelector<HTMLButtonElement>('button[aria-label$=": edit reply"]');
const replyBox = (card: HTMLElement) =>
  card.querySelector<HTMLTextAreaElement>('textarea[aria-label$=": reply"]');
const button = (card: HTMLElement, text: string) =>
  [...card.querySelectorAll('button')].find(b => b.textContent === text);
async function typeInto(el: HTMLTextAreaElement, text: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('edit opens the reply in a box seeded with the draft; done closes it', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  expect(replyBox(reply)).toBeNull();
  await React.act(async () => editButton(reply)!.click());
  expect(replyBox(reply)!.value).toBe('The delay is fixed by design.');
  expect(document.activeElement).toBe(replyBox(reply));
  await React.act(async () => button(reply, 'done')!.click());
  expect(replyBox(reply)).toBeNull();
  expect(document.activeElement).toBe(editButton(reply));
});

test('a changed reply shows the edited chip and posts; reset to draft clears both', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(
    replyBox(reply)!,
    'The delay is fixed by design; see retry.ts.'
  );
  expect(reply.querySelector('[data-chip="edited"]')).not.toBeNull();
  await React.act(async () => button(reply, 'reset to draft')!.click());
  expect(reply.querySelector('[data-chip="edited"]')).toBeNull();
  expect(replyBox(reply)!.value).toBe('The delay is fixed by design.');
  expect(document.activeElement).toBe(replyBox(reply));
});

test('an edit survives hold and back to post, and is what posts', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'Kept on purpose.');
  const hold = control(reply, 'hold')!;
  await React.act(async () => {
    hold.focus();
    hold.click();
  });
  expect(editButton(reply)).toBeNull();
  expect(replyBox(reply)).toBeNull();
  expect(document.activeElement).toBe(hold);
  await React.act(async () => control(reply, 'post')!.click());
  expect(replyBox(reply)).toBeNull();
  await clickSubmit();
  expect(
    (answer() as { answers: Record<string, unknown> }).answers['thread-2']
  ).toEqual({
    value: ['post:r2'],
    text: 'Kept on purpose.',
  });
});

test('an emptied reply says so on its card', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, '  ');
  expect(reply.textContent).toContain('the reply is empty');
  expect(submit().disabled).toBe(true);
  const hint = replyBox(reply)!.getAttribute('aria-describedby');
  expect(hint && document.getElementById(hint)?.textContent).toBe(
    'the reply is empty'
  );
});

test('the dock reset restores the picks but keeps an edited reply', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'Kept on purpose.');
  await React.act(async () => control(reply, 'hold')!.click());
  await click($('.tui-sheet-reset'));
  const again = postCards()[1]!;
  expect(control(again, 'post')!.checked).toBe(true);
  expect(again.querySelector('[data-chip="edited"]')).not.toBeNull();
  expect(again.textContent).toContain('Kept on purpose.');
  await clickSubmit();
  expect(
    (answer() as { answers: Record<string, unknown> }).answers['thread-2']
  ).toEqual({ value: ['post:r2'], text: 'Kept on purpose.' });
});

const DOCK_EMPTY = 'a reply is empty: write it or hold the thread';

test('the dock says why submit is off while a posting reply is empty', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const dock = () => $('.tui-sheet-dock')!.textContent;
  expect(dock()).not.toContain(DOCK_EMPTY);
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, '');
  expect(dock()).toContain(DOCK_EMPTY);
  await React.act(async () => control(reply, 'hold')!.click());
  expect(dock()).not.toContain(DOCK_EMPTY);
  expect(submit().disabled).toBe(false);
});

test('the reply controls are named by their thread', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'Kept on purpose.');
  expect(
    [...reply.querySelectorAll('.tui-thread-reply-action')].map(b =>
      b.getAttribute('aria-label')
    )
  ).toEqual(['b.ts:2: done editing', 'b.ts:2: reset to draft']);
  expect(replyBox(reply)!.hasAttribute('aria-describedby')).toBe(false);
});

test("the edited chip is grey, never the fix chip's accent", async () => {
  await render(perThreadPostGate(), withFixPlan());
  const fix = postCards()[0]!;
  await React.act(async () => editButton(fix)!.click());
  await typeInto(replyBox(fix)!, 'Fixed, and bounded.');
  expect(
    fix.querySelector('[data-chip="edited"]')!.getAttribute('data-hue')
  ).toBe('grey');
});

test('Escape in the reply box closes the box, not the sheet', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await React.act(async () => {
    replyBox(reply)!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
  expect(replyBox(reply)).toBeNull();
  expect(document.body.querySelector('.tui-gate-sheet')).not.toBeNull();
  expect(closes).toBe(0);
  expect(document.activeElement).toBe(editButton(reply));
});

test('a card whose reply did not fit the gate offers no edit', async () => {
  const gate = perThreadPostGate();
  gate.questions = [
    { ...gate.questions[0]!, context: undefined },
    gate.questions[1]!,
  ];
  await render(gate);
  const [unfit, fit] = postCards();
  expect(unfit!.textContent).toContain(
    'The reply text did not fit the gate; read it in the pane.'
  );
  expect(editButton(unfit!)).toBeNull();
  expect(editButton(fit!)).not.toBeNull();
});

test('without its plan gate, an edited reply still carries its chip', async () => {
  await render(perThreadPostGate());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'Kept on purpose.');
  expect(
    reply.querySelector('.tui-gate-question-head [data-chip="edited"]')
  ).not.toBeNull();
});

const planCards = () => [
  ...document.body.querySelectorAll<HTMLElement>(
    'section[data-gate-ctx="thread"]'
  ),
];

test('a reply pick on the plan sheet can be edited and answers with its text', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  expect(card.querySelector('[data-chip="edited"]')).not.toBeNull();
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': {
        value: 'reply:t1',
        text: 'fixed in the next push, with a test.',
      },
      'thread-2': 'reply:t2',
      'code-changes': 'skip',
    },
  });
});

test('a fix or skip pick offers no edit, and an edit made under reply is not sent after switching to fix', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('skip:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'an edit');
  await pick('fix:t1');
  expect(editButton(card)).toBeNull();
  expect(editButton(planCards()[1]!)).toBeNull();
  await clickSubmit();
  expect(
    (answer() as { answers: Record<string, unknown> }).answers['thread-1']
  ).toBe('fix:t1');
});

test('the dock says what happens next on the plan sheet', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  expect($('.tui-sheet-dock-next')!.textContent).toBe('Next, 2 replies post.');
  await pick('fix:t1');
  expect($('.tui-sheet-dock-next')!.textContent).toBe(
    'Next, 1 fix gets implemented, then you approve 1 reply before anything posts.'
  );
  await pick('skip:t1');
  await pick('skip:t2');
  expect($('.tui-sheet-dock-next')!.textContent).toBe('Next, nothing posts.');
  expect(submit().textContent).toBe('submit · 2 skips');
  await pick('fix:t1');
  await pick('fix:t2');
  expect(submit().textContent).toBe('submit · 2 fixes');
});

test('the plan dock waits for every thread to be picked before saying what comes next', async () => {
  await render(planGate());
  expect($('.tui-sheet-dock-next')).toBeNull();
  await pick('reply:t1');
  expect($('.tui-sheet-dock-next')).toBeNull();
  await pick('reply:t2');
  expect($('.tui-sheet-dock-next')!.textContent).toBe('Next, 2 replies post.');
});

const caption = (card: HTMLElement) =>
  card.querySelector('.tui-thread-reply-k')!.textContent;

test('a plan card shows only what will post: a fix pick shows the draft, and reply brings the edit back', async () => {
  await render(planGate());
  const card = planCards()[0]!;
  expect(caption(card)).toBe('drafted reply');
  await pick('reply:t1');
  await pick('reply:t2');
  expect(caption(card)).toBe('will post as reply');
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  await React.act(async () => button(card, 'done')!.click());
  await pick('fix:t1');
  expect(caption(card)).toBe('drafted reply');
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'fixed, with a test.'
  );
  expect(card.querySelector('[data-chip="edited"]')).toBeNull();
  await pick('reply:t1');
  expect(caption(card)).toBe('will post as reply');
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'fixed in the next push, with a test.'
  );
  expect(card.querySelector('[data-chip="edited"]')).not.toBeNull();
});

test('a held post-step reply is captioned as a draft, not as posting', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  expect(caption(reply)).toBe('will post as reply');
  await React.act(async () => control(reply, 'hold')!.click());
  expect(caption(reply)).toBe('drafted reply');
});

test('a fix pick beside an edited reply approves bare and wraps the reply', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('fix:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': {
        value: 'reply:t1',
        text: 'fixed in the next push, with a test.',
      },
      'thread-2': 'fix:t2',
      'code-changes': 'approve',
    },
  });
});

test('sending the plan back carries no edited text and stays live', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  await click($('.tui-sheet-revise'));
  await typeArea('What should the new plan change?', 'split the fix');
  expect(submit().disabled).toBe(false);
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'reply:t1',
      'thread-2': 'reply:t2',
      'code-changes': { value: 'revise', note: 'split the fix' },
    },
  });
});

test('a revise answered in the dock sends no edited text and is not blocked by an emptied reply', async () => {
  const gate = planGate();
  gate.questions[2] = { ...gate.questions[2]!, options: ['approve', 'revise'] };
  await render(gate);
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, '   ');
  await pick('approve');
  expect(submit().disabled).toBe(true);
  expect(document.body.textContent).toContain(
    'a reply is empty: write it or skip the thread'
  );
  await pick('revise');
  expect(submit().disabled).toBe(false);
  expect(document.body.textContent).not.toContain('a reply is empty:');
  expect($('.tui-sheet-dock-next')).toBeNull();
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-plan',
    answers: {
      'thread-1': 'reply:t1',
      'thread-2': 'reply:t2',
      'code-changes': 'revise',
    },
  });
});

test('an emptied reply pick blocks submit with a reason; send-back mode ignores edits', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, '   ');
  expect(submit().disabled).toBe(true);
  expect(document.body.textContent).toContain(
    'a reply is empty: write it or skip the thread'
  );
  await click($('.tui-sheet-revise'));
  expect(document.body.textContent).not.toContain('a reply is empty');
});

async function editThenHold(card: HTMLElement) {
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'Kept on purpose.');
  await React.act(async () => button(card, 'done')!.click());
  await React.act(async () => control(card, 'hold')!.click());
}

test('a held post card shows the draft without the chip; post brings the edit back', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await editThenHold(reply);
  expect(caption(reply)).toBe('drafted reply');
  expect(reply.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'The delay is fixed by design.'
  );
  expect(reply.querySelector('[data-chip="edited"]')).toBeNull();
  await React.act(async () => control(reply, 'post')!.click());
  expect(caption(reply)).toBe('will post as reply');
  expect(reply.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'Kept on purpose.'
  );
  expect(reply.querySelector('[data-chip="edited"]')).not.toBeNull();
});

test('without its plan gate, a held post card also shows the draft without the chip', async () => {
  await render(perThreadPostGate());
  const reply = postCards()[1]!;
  await editThenHold(reply);
  expect(reply.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'The delay is fixed by design.'
  );
  expect(reply.querySelector('[data-chip="edited"]')).toBeNull();
  await React.act(async () => control(reply, 'post')!.click());
  expect(reply.querySelector('[data-chip="edited"]')).not.toBeNull();
});

const dockNext = () => $('.tui-sheet-dock-next')!.textContent;

test('a reply pick with a note is an override: you approve it at gate 2', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  await type('Note for queue/enqueue.ts:10', '  say which test  ');
  expect(dockNext()).toBe('Next, you approve 1 reply before anything posts.');
});

test('a reply pick with an edit and a note posts its edit: a plain reply', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('skip:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  await type('Note for queue/enqueue.ts:10', 'say which test');
  expect(dockNext()).toBe('Next, 1 reply posts.');
});

test('a reply pick on a thread with only a reply direction is an override', async () => {
  const gate = planGate();
  gate.questions[1] = {
    ...gate.questions[1]!,
    context: JSON.stringify({
      'gate-ctx': 'thread@1',
      author: 'renee',
      severity: 'blocking',
      claim: { summary: 'claim 2' },
      verdict: { call: 'valid' },
      reply: { kind: 'direction', text: 'say the retry is bounded now.' },
    }),
  };
  await render(gate);
  await pick('reply:t1');
  await pick('reply:t2');
  expect(dockNext()).toBe('Next, you approve 1 reply before anything posts.');
  await pick('fix:t1');
  expect(dockNext()).toBe(
    'Next, 1 fix gets implemented, then you approve 2 replies before anything posts.'
  );
});

const outcomeOf = (card: HTMLElement) =>
  card.querySelector('[data-outcome]')!.textContent;

test('a reply-only thread Gate 2 does not offer posts with this step: its draft, no controls', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const card = postCards()[3]!;
  expect(outcomeOf(card)).toBe('reply · posts with this step');
  expect(caption(card)).toBe('will post as reply');
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'fixed, with a test.'
  );
  expect(card.querySelector('input')).toBeNull();
  expect(card.querySelector('[data-chip="edited"]')).toBeNull();
  expect(card.textContent).not.toContain('Nothing to post');
});

test('a reply-only thread edited at Gate 1 shows its edit and the edited chip', async () => {
  await render(
    perThreadPostGate(),
    withFixPlan('fixed in the next push, with a test.')
  );
  const card = postCards()[3]!;
  expect(outcomeOf(card)).toBe('reply · posts with this step');
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'fixed in the next push, with a test.'
  );
  expect(
    card.querySelector('[data-chip="edited"]')!.getAttribute('data-hue')
  ).toBe('grey');
});

test('a reply override is offered at Gate 2 with its redraft and its controls', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const card = postCards()[1]!;
  expect(outcomeOf(card)).toBe('reply only');
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'The delay is fixed by design.'
  );
  expect(control(card, 'post')!.checked).toBe(true);
  expect(control(card, 'resolve')!.checked).toBe(false);
});

test('holding everything with no reply-only thread still reads hold all', async () => {
  await render(perThreadPostGate());
  const [fix, reply] = postCards();
  await React.act(async () => control(fix!, 'hold')!.click());
  await React.act(async () => control(fix!, 'resolve')!.click());
  await React.act(async () => control(reply!, 'hold')!.click());
  expect(submit().textContent).toBe('hold all');
});

test('the plan dock says nothing about what comes next while a reply is empty', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, '   ');
  await type('Note for queue/enqueue.ts:10', 'say which test');
  expect($('.tui-sheet-dock-next')).toBeNull();
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  expect(dockNext()).toBe('Next, 2 replies post.');
});

const repliesChip = () => $('[data-chip="replies"]')!.textContent;

test('on a per-thread post sheet the rail counts the replies this submit posts', async () => {
  await render(perThreadPostGate(), withFixPlan());
  expect(repliesChip()).toBe('3 replies');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('3 of 3 posting');
  await React.act(async () => control(postCards()[1]!, 'hold')!.click());
  expect(repliesChip()).toBe('2 replies');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('2 of 3 posting');
  expect(submit().textContent).toBe('post 2 · resolve 1');
});

test('a post sheet flattened to prose counts the replies its submit posts in the rail', async () => {
  await render(prosePostGate());
  expect(repliesChip()).toBe('2 replies');
  await React.act(async () => control(postCards()[1]!, 'hold')!.click());
  expect(repliesChip()).toBe('1 reply');
  expect(submit().textContent).toBe('post 1 · resolve 1');
});

test('a prose-flattened post gate still counts the plan reply-only thread: holding the fix reads post 1', async () => {
  const gate = prosePostGate();
  gate.questions = [gate.questions[0]!];
  const plan = answeredPlan();
  plan.answers = {
    'thread-1': 'fix:r1',
    'thread-2': 'reply:r2',
    'thread-3': 'skip:r3',
  };
  await render(gate, { ...MR, gates: [plan] } as unknown as BoardMRWithReview);
  expect(repliesChip()).toBe('2 replies');
  const fix = postCards()[0]!;
  await React.act(async () => control(fix, 'hold')!.click());
  await React.act(async () => control(fix, 'resolve')!.click());
  expect(submit().textContent).toBe('post 1');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 2 posting');
  expect(repliesChip()).toBe('1 reply');
});

test('a replies checklist joined to its plan counts a reply-only thread in the rail, the tally and the submit', async () => {
  const plan = answeredPlan();
  plan.answers = { ...plan.answers, 'thread-3': 'reply:r3' };
  await render(postGate(), {
    ...MR,
    gates: [plan],
  } as unknown as BoardMRWithReview);
  expect(repliesChip()).toBe('3 replies');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('3 of 3 posting');
  expect(submit().textContent).toBe('post 3');
  await holdAll();
  expect(repliesChip()).toBe('1 reply');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 3 posting');
  expect(submit().textContent).toBe('post 1');
});

test('a newer plan gate still open is never the one a post gate follows', async () => {
  const gate = prosePostGate();
  gate.questions = [gate.questions[0]!];
  const answered = answeredPlan();
  answered.openedAt = Date.now() - 180_000;
  answered.answers = {
    'thread-1': 'fix:r1',
    'thread-2': 'reply:r2',
    'thread-3': 'skip:r3',
  };
  await render(gate, {
    ...MR,
    gates: [answered, { ...planGate(), gateId: 'g-plan-next' }],
  } as unknown as BoardMRWithReview);
  expect(repliesChip()).toBe('2 replies');
  expect($('.tui-sheet-list-tally')!.textContent).toBe('2 of 2 posting');
});

/** A prose-flattened Gate 2 offering only the fix, after a plan whose
    Gate 1 reply-only thread (r2) posts with this step. */
async function renderProseWithReplyOnly(
  thread2: Partial<GateRow['questions'][number]> = {},
  answer2: NonNullable<GateRow['answers']>[string] = 'reply:r2'
) {
  const gate = prosePostGate();
  gate.questions = [gate.questions[0]!];
  const plan = answeredPlan();
  plan.questions = [
    plan.questions[0]!,
    { ...plan.questions[1]!, ...thread2 },
    plan.questions[2]!,
  ];
  plan.answers = {
    'thread-1': 'fix:r1',
    'thread-2': answer2,
    'thread-3': 'skip:r3',
  };
  await render(gate, { ...MR, gates: [plan] } as unknown as BoardMRWithReview);
}

const dockRows = () =>
  [
    ...document.body.querySelectorAll(
      '[data-card="responses"] .tui-sheet-card-row'
    ),
  ].map(r => r.textContent);

test('a prose-flattened post sheet shows the Gate 1 reply-only thread as a card, a dock row and in its title', async () => {
  await renderProseWithReplyOnly();
  expect($('.tui-sheet-list-title')!.textContent).toBe(
    'Post replies on 2 threads'
  );
  const cards = postCards();
  expect(cards.map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
  ]);
  const replyOnly = cards[1]!;
  expect(outcomeOf(replyOnly)).toBe('reply · posts with this step');
  expect(replyOnly.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'fixed, with a test.'
  );
  expect(replyOnly.querySelector('input')).toBeNull();
  expect(dockRows()).toEqual(['postresolvea.ts:1', 'postb.ts:2']);
  const fix = cards[0]!;
  await React.act(async () => control(fix, 'hold')!.click());
  await React.act(async () => control(fix, 'resolve')!.click());
  expect(dockRows()).toEqual(['holda.ts:1', 'postb.ts:2']);
  expect($('.tui-sheet-list-tally')!.textContent).toBe('1 of 2 posting');
  expect(submit().textContent).toBe('post 1');
  expect(repliesChip()).toBe('1 reply');
});

test('with the plan context flattened too, the reply-only card shows the Gate 1 edit, or says it was approved there', async () => {
  await renderProseWithReplyOnly(
    { context: 'b.ts:2 REPLY: fixed, with a test.' },
    { value: 'reply:r2', text: 'kept on purpose.' }
  );
  const edited = postCards()[1]!;
  expect(outcomeOf(edited)).toBe('reply · posts with this step');
  expect(edited.querySelector('.tui-thread-reply-text')!.textContent).toBe(
    'kept on purpose.'
  );
  expect(edited.querySelector('[data-chip="edited"]')).not.toBeNull();
  await React.act(async () => root.unmount());
  root = createRoot(container);
  await renderProseWithReplyOnly({
    context: 'b.ts:2 REPLY: fixed, with a test.',
  });
  const bare = postCards()[1]!;
  expect(bare.textContent).toContain(
    'Approved at Gate 1; posts with this step.'
  );
  expect(bare.querySelector('[data-chip="edited"]')).toBeNull();
  expect(bare.querySelector('input')).toBeNull();
});

test('an unjoined replies checklist counts its ticked replies in the rail, as its submit does', async () => {
  await render(postGate());
  await pick('r1');
  await pick('r2');
  expect(repliesChip()).toBe('2 replies');
  expect(submit().textContent).toBe('post 2');
  await pick('r1');
  expect(repliesChip()).toBe('1 reply');
  expect(submit().textContent).toBe('post 1');
});

test('on a prose-flattened post sheet, a reply-only thread keeps its plan place before a later fix', async () => {
  const gate = perThreadPostGate();
  gate.context = "Posting replies to renee's review · 1 reply";
  gate.questions = [
    { ...gate.questions[1]!, context: 'b.ts:2 FIX · ab12cd3: Fixed.' },
  ];
  const plan = answeredPlan();
  plan.answers = {
    'thread-1': 'reply:r1',
    'thread-2': 'fix:r2',
    'thread-3': 'skip:r3',
  };
  await render(gate, { ...MR, gates: [plan] } as unknown as BoardMRWithReview);
  expect(postCards().map(c => c.getAttribute('aria-label'))).toEqual([
    'a.ts:1',
    'b.ts:2',
  ]);
  expect(outcomeOf(postCards()[0]!)).toBe('reply · posts with this step');
  expect(dockRows()).toEqual(['posta.ts:1', 'postb.ts:2']);
});

test('the plan dock, the post dock and the lost panel each reserve their height on the scroller', async () => {
  const restore = installFakeResizeObserver();
  try {
    await render(planGate());
    expect(await reserveOf('.tui-sheet-dock', 183)).toBe('183px');
    await render(postGate());
    expect(await reserveOf('.tui-sheet-dock', 185)).toBe('185px');
    answeredElsewhere = true;
    await render(planGate());
    await pick('reply:t1');
    await pick('reply:t2');
    await clickSubmit();
    expect(await reserveOf('.tui-sheet-lost', 332)).toBe('332px');
  } finally {
    restore();
  }
});
