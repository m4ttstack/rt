/** An answered gate opens the same two-column sheet as an open one: every
    question read-only with its recorded pick, the MR and the decision
    context in the rail, and a dock that only acts when the answer is stuck
    (focus pane) or found no agent to run it (retry). */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
import {
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
} from '../row-status.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = {
  iid: 1235,
  title: 'add a temperature factor',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1235',
  sourceBranch: 'temperature-factor',
  targetBranch: 'main',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  author: { username: 'jvasquez', name: 'Joel Vasquez' },
  pipelineState: 'passed',
  blockers: { any: false, hasConflicts: false },
  reviews: { isApproved: false, given: 0, required: 1 },
} as unknown as BoardMRWithReview;

function shipped(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-ship',
    subject: 'run:20260923-0900-demo',
    kind: 'ship',
    label: 'ship',
    status: 'answered',
    openedAt: Date.now() - 3_600_000,
    context: 'Three commits are ready.',
    origin: { paneId: 'pane-9', worktree: '/work/demo' },
    questions: [
      {
        id: 'handoff',
        label: 'How do we hand off?',
        multi: false,
        options: [
          {
            value: 'hand-back',
            label: 'Hand back (Recommended). I give you the branch.',
          },
          { value: 'hold', label: 'Hold the run here.' },
        ],
      },
      {
        id: 'preview',
        label: 'Which preview environments?',
        multi: true,
        options: [
          { value: 'preview-a', label: 'preview-a' },
          { value: 'preview-b', label: 'preview-b' },
          { value: 'preview-c', label: 'preview-c' },
        ],
      },
      {
        id: 'draft',
        label: 'Draft or ready?',
        multi: false,
        options: ['draft', 'ready'],
      },
    ],
    answers: {
      handoff: { value: 'hand-back', note: 'push after lunch' },
      preview: ['preview-a', 'preview-b'],
      draft: 'draft',
    },
    answeredBy: 'jvasquez',
    answeredAt: Date.now() - 120_000,
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;
let failing: string | null;
let conflict: boolean;
let continues: number;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  failing = null;
  conflict = false;
  continues = 0;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (conflict && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: { answer: { answers: { draft: 'ready' }, by: 'pane' } },
        }),
        { status: 409 }
      );
    if (failing === url)
      return new Response(JSON.stringify({ error: 'pane-9 is gone' }), {
        status: 404,
      });
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

async function render(
  row: GateRow,
  mr?: BoardMRWithReview,
  people?: ReadonlyMap<string, string>
) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        mr={mr}
        people={people}
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
const $$ = (selector: string) => [...document.body.querySelectorAll(selector)];
const text = (selector: string) => $(selector)?.textContent?.trim() ?? '';

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const dockButton = (label: string) =>
  $$('.tui-sheet-dock button').find(b => b.textContent?.trim() === label);

test('an answered gate shows every question read-only with its recorded pick, beside the rail', async () => {
  await render(shipped(), MR);
  expect($('.tui-answered-sheet .tui-sheet-body')).not.toBeNull();
  expect($('.tui-triage-sheet-body')).toBeNull();
  expect(text('.tui-sheet-list-title')).toBe('Answered by Joel Vasquez');
  expect(text('.tui-sheet-list-title .tui-person-name')).toBe('Joel Vasquez');
  expect($('.tui-sheet-list-title .tui-person-avatar')).not.toBeNull();
  expect(text('.tui-sheet-list-tally')).toBe('answered 2m ago');
  const cards = $$('.tui-sheet-main .tui-gate-question');
  expect(cards).toHaveLength(3);
  for (const card of cards)
    expect(card.hasAttribute('data-readonly')).toBe(true);
  const inputs = $$(
    '.tui-sheet-main .tui-gate-choice-input'
  ) as HTMLInputElement[];
  expect(inputs.every(i => i.disabled)).toBe(true);
  expect(inputs.filter(i => i.checked).map(i => i.value)).toEqual([
    'hand-back',
    'preview-a',
    'preview-b',
    'draft',
  ]);
  expect($('.tui-sheet-main input.tui-gate-note')).toBeNull();
  expect(cards[0]!.querySelector('.tui-gate-summary-reply')?.textContent).toBe(
    'note: push after lunch'
  );
  expect(
    cards[0]!.querySelector('.tui-gate-choice-label-row > span')?.textContent
  ).toBe('Hand back');
  expect($('.tui-sheet-rail-scroll')!.firstElementChild!.className).toContain(
    'tui-mr-card'
  );
  expect(text('.tui-sheet-context-card')).toContain('Three commits are ready.');
});

test('the plain answered dock names the MR and lists the recorded picks, with nothing to press', async () => {
  await render(shipped(), MR);
  expect(text('.tui-sheet-dock-heading')).toBe('Answer on !1235');
  expect(
    $$('.tui-sheet-dock .tui-sheet-card-row').map(r => [
      r.querySelector('.tui-sheet-card-chip')?.textContent,
      r.querySelector('.tui-sheet-card-text')?.textContent,
    ])
  ).toEqual([
    ['Hand back', 'How do we hand off?'],
    ['2 picked', 'Which preview environments?'],
    ['draft', 'Draft or ready?'],
  ]);
  expect($$('.tui-sheet-dock button')).toEqual([]);
});

test('with no recorded author the head reads plain "Answered"; the board and the pane read as places', async () => {
  await render(shipped({ answeredBy: undefined, answeredAt: undefined }));
  expect(text('.tui-sheet-list-title')).toBe('Answered');
  expect($('.tui-sheet-list-tally')).toBeNull();
  expect(text('.tui-sheet-dock-heading')).toBe(
    'Answer on run:20260923-0900-demo'
  );
  await render(shipped({ answeredBy: 'board' }));
  expect(text('.tui-sheet-list-title')).toBe('Answered on the board');
  await render(shipped({ answeredBy: 'pane' }));
  expect(text('.tui-sheet-list-title')).toBe('Answered in the pane');
});

test('the answerer reads by roster name, else by handle', async () => {
  await render(
    shipped({ answeredBy: 'rpark' }),
    undefined,
    new Map([['rpark', 'Renee Park']])
  );
  expect(text('.tui-sheet-list-title')).toBe('Answered by Renee Park');
  expect(text('.tui-sheet-list-title .tui-person-name')).toBe('Renee Park');
  await render(shipped({ answeredBy: 'kim' }));
  expect(text('.tui-sheet-list-title')).toBe('Answered by kim');
  expect(text('.tui-sheet-list-title .tui-person-name')).toBe('kim');
});

test('an answer the pane never picked up leads with why and docks focus pane', async () => {
  await render(shipped({ delivery: { outcome: 'stuck', at: 5 } }), MR);
  expect(text('.tui-sheet-list-title')).toBe('Answer not delivered');
  expect(text('.tui-sheet-context-card .tui-sheet-context-lead')).toBe(
    DELIVERY_STUCK_MESSAGE
  );
  expect($$('.tui-sheet-dock .tui-sheet-card-row')).toEqual([]);
  const focus = dockButton('focus pane');
  expect(focus?.className).toContain('tui-sheet-submit');
  await click(focus);
  expect(posts).toEqual([{ url: '/gate/focus', body: { gateId: 'g-ship' } }]);
});

test("a stuck answer's failed focus shows the daemon's reason in the dock", async () => {
  failing = '/gate/focus';
  await render(shipped({ delivery: { outcome: 'stuck', at: 5 } }));
  await click(dockButton('focus pane'));
  expect(text('.tui-sheet-dock .tui-gate-error')).toBe('pane-9 is gone');
});

test('an answer with no agent to run it leads with why and docks retry, which re-posts the recorded answers', async () => {
  const gate = shipped({ execution: 'unassigned' });
  await render(gate, MR);
  expect(text('.tui-sheet-list-title')).toBe('Agent not running');
  expect(text('.tui-sheet-context-card .tui-sheet-context-lead')).toBe(
    EXECUTION_UNASSIGNED_MESSAGE
  );
  const retry = dockButton('retry');
  expect(retry?.className).toContain('tui-sheet-submit');
  await click(retry);
  expect(posts).toEqual([
    { url: '/gate/answer', body: { gateId: 'g-ship', answers: gate.answers } },
  ]);
});

test('a retry that loses to another answer swaps the rail for the winner and continue', async () => {
  conflict = true;
  await render(shipped({ execution: 'unassigned' }), MR);
  await click(dockButton('retry'));
  expect(text('.tui-sheet-rail .tui-gate-error')).toBe('answered elsewhere');
  expect($('.tui-sheet-rail [data-gate="chip"]')).not.toBeNull();
  expect($('.tui-sheet-dock')).toBeNull();
  const cont = $$('.tui-sheet-rail button').find(
    b => b.textContent?.trim() === 'continue'
  );
  await click(cont);
  expect(continues).toBe(1);
});

test('a failed retry says nothing was sent', async () => {
  failing = '/gate/answer';
  await render(shipped({ execution: 'unassigned' }));
  await click(dockButton('retry'));
  expect(text('.tui-sheet-dock .tui-gate-error')).toBe(
    'retry failed... nothing was sent, try again'
  );
});

test('a gate with no questions shows its recorded answer in one card', async () => {
  await render(shipped({ questions: [], answers: {} }));
  const cards = $$('.tui-sheet-main .tui-gate-question');
  expect(cards).toHaveLength(1);
  expect(cards[0]!.querySelector('[data-gate="chip"]')).not.toBeNull();
});

test('a free-form question shows the text it was answered with', async () => {
  await render(
    shipped({
      questions: [{ id: 'why', label: 'Why hold?', multi: false, options: [] }],
      answers: { why: 'waiting on the after capture' },
    })
  );
  const card = $('.tui-sheet-main .tui-gate-question')!;
  expect(card.querySelector('.tui-gate-question-label')?.textContent).toBe(
    'Why hold?'
  );
  expect(card.textContent).toContain('waiting on the after capture');
  expect(
    $('.tui-sheet-dock .tui-sheet-card-row .tui-sheet-card-chip')?.textContent
  ).toBe('answered');
});

const j = (v: unknown) => JSON.stringify(v);

test('an answered respond plan keeps its reviewer in the rail and its thread cards read-only', async () => {
  await render(
    shipped({
      kind: 'respond-plan',
      label: 'respond gate !1235',
      subject:
        'mr:https://gitlab.example.com/acme/webapp/-/merge_requests/1235',
      context: j({
        'gate-ctx': 'plan@1',
        reviewer: 'renee',
        round: 1,
        threads: { total: 1, blocking: 1 },
      }),
      questions: [
        {
          id: 'thread-1',
          label: 'queue/enqueue.ts:88',
          multi: false,
          context: j({
            'gate-ctx': 'thread@1',
            author: 'renee',
            severity: 'blocking',
            claim: { summary: 'enqueue() retries a permanent failure.' },
            verdict: { call: 'valid' },
            reply: { kind: 'none' },
          }),
          options: ['reply:t1', 'fix:t1', 'skip:t1'],
        },
      ],
      answers: { 'thread-1': 'fix:t1' },
    }),
    MR
  );
  expect($('.tui-answered-sheet')).not.toBeNull();
  const lead = $('.tui-sheet-context-card .tui-id-card-lead');
  expect(lead?.textContent).toBe('renee reviewed your merge request');
  expect(
    $$('.tui-sheet-context-card .tui-respond-chip').map(c => c.textContent)
  ).toEqual(['1 thread', '1 blocking']);
  expect($('.tui-sheet-main .tui-thread-card')?.textContent).toContain(
    'enqueue() retries a permanent failure.'
  );
  expect(
    ($('.tui-sheet-main input[value="fix:t1"]') as HTMLInputElement).checked
  ).toBe(true);
  expect(document.body.textContent).not.toContain('gate-ctx');
});

test('an answered per-thread post shows the reply as posted, edited text included', async () => {
  await render(
    shipped({
      kind: 'respond-post',
      questions: [
        {
          id: 'thread-1',
          label: 'queue/enqueue.ts:88',
          multi: true,
          context: j({
            'gate-ctx': 'reply@1',
            thread: 't1',
            file: 'queue/enqueue.ts:88',
            verb: 'fix',
            text: 'the drafted reply',
          }),
          options: [
            { value: 'post:t1', label: 'Post' },
            { value: 'resolve:t1', label: 'Resolve' },
          ],
        },
      ],
      answers: {
        'thread-1': { value: ['post:t1'], text: 'the reply as edited' },
      },
    })
  );
  const card = $('.tui-sheet-main .tui-gate-question')!;
  expect(card.querySelector('.tui-thread-card')?.textContent).toContain(
    'the reply as edited'
  );
  expect(card.textContent).not.toContain('the drafted reply');
  expect(card.querySelector('.tui-gate-summary-reply')).toBeNull();
  expect(
    ($('.tui-sheet-main input[value="post:t1"]') as HTMLInputElement).checked
  ).toBe(true);
});

test('an answered review gate reads its summary as prose in the rail', async () => {
  await render(
    shipped({
      kind: 'review-post',
      context: j({
        'gate-ctx': 'review@1',
        readiness: 'with-fixes',
        summary: 'one real defect remains.',
        findings: { important: 1 },
      }),
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          options: ['comment', 'approve'],
        },
      ],
      answers: { outcome: 'comment' },
    })
  );
  expect(text('.tui-sheet-context-card')).toContain(
    'Ready to merge: with fixes'
  );
  expect(text('.tui-sheet-context-card')).toContain('one real defect remains.');
  expect(document.body.textContent).not.toContain('gate-ctx');
});
