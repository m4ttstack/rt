/** A gate whose gate-level context parses as plan@1 or post@1 heads the
    decision-queue modal with the header card: the reviewer leads, the MR
    is the object line, the chips come from the context, the parked and
    escalated chips move onto the action strip, and neither the MR strip
    nor the "Decision context" pane renders. Prose and malformed contexts
    keep today's strip and pane. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
import type { PlanCtx, PostCtx } from '../gate-ctx.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';
import { headerChips } from '../RespondGateHeader.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = {
  iid: 87,
  title: 'DEMO-12: add retry to the fetch queue',
  sourceBranch: 'feature/demo-12-retry',
  author: { username: 'alex', name: 'Alex Doe' },
} as unknown as BoardMRWithReview;

const PLAN = JSON.stringify({
  'gate-ctx': 'plan@1',
  reviewer: 'renee',
  round: 1,
  threads: { total: 2, blocking: 1 },
  adjudication: 'both valid · fresh-context adjudicated',
});

const POST = JSON.stringify({
  'gate-ctx': 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
});

const THREAD = JSON.stringify({
  'gate-ctx': 'thread@1',
  author: 'renee',
  severity: 'blocking',
  claim: { summary: 'enqueue() retries a job that failed permanently.' },
  verdict: { call: 'valid' },
  reply: { kind: 'none' },
});

function gate(overrides: Partial<GateRow>): GateRow {
  return {
    gateId: 'g-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: PLAN,
    origin: { paneId: 'pane-87', worktree: '/work/demo-worktree' },
    questions: [
      {
        id: 'thread-1',
        label: 'queue/enqueue.ts:88',
        multi: false,
        context: THREAD,
        options: [
          { value: 'reply:t1', label: 'reply' },
          { value: 'fix:t1', label: 'fix' },
          { value: 'skip:t1', label: 'skip' },
        ],
      },
    ],
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

async function renderModal(row: GateRow, mr?: BoardMRWithReview) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        mr={mr}
        position={1}
        states={['active']}
        onClose={() => {}}
        onSkip={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);

test('a plan@1 gate renders the header card in place of the MR strip and the context pane', async () => {
  await renderModal(gate({}), MR);
  const head = $('.tui-respond-head[data-shape="plan@1"]')!;
  expect(head).not.toBeNull();
  expect(head.querySelector('.tui-respond-headline')!.textContent).toBe(
    "Responding to renee's review"
  );
  expect(head.querySelector('.tui-respond-headline strong')!.textContent).toBe(
    'renee'
  );
  expect(head.querySelector('.tui-respond-object-ref')!.textContent).toBe(
    '!87'
  );
  expect(head.querySelector('.tui-respond-object')!.textContent).toContain(
    'add retry to the fetch queue'
  );
  const meta = head.querySelector('.tui-respond-meta')!.textContent!;
  expect(meta).toContain('feature/demo-12-retry');
  expect(meta).toContain('Alex Doe');
  expect($('.tui-triage-strip')).toBeNull();
  expect($('.tui-triage-modal [data-part="scrollpane"]')).toBeNull();
  expect($('.tui-triage-body[data-respond]')).not.toBeNull();
  expect($('.tui-triage-overview')).toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('gate-ctx');
  expect(text).not.toContain('pane-87');
  expect(text).not.toContain('demo-worktree');
});

test('the chips row renders the derived chips in order', async () => {
  await renderModal(gate({}), MR);
  expect(
    [...document.body.querySelectorAll('.tui-respond-chip')].map(c => [
      c.textContent,
      c.getAttribute('data-hue'),
    ])
  ).toEqual([
    ['2 threads', 'grey'],
    ['1 blocking', 'amber'],
    ['both valid · fresh-context adjudicated', 'green'],
    ['round 1', 'grey'],
  ]);
});

test('a post@1 gate heads with "Posting replies to"', async () => {
  await renderModal(gate({ kind: 'respond-post', context: POST }), MR);
  expect($('.tui-respond-head[data-shape="post@1"]')).not.toBeNull();
  expect($('.tui-respond-headline')!.textContent).toBe(
    "Posting replies to renee's review"
  );
});

test('parked and escalated chips move onto the action strip', async () => {
  await renderModal(gate({ status: 'parked', escalatedAt: 5 }), MR);
  expect($('.tui-triage-head-actions [data-gate="parked"]')).not.toBeNull();
  expect($('.tui-triage-head-actions [data-gate="escalated"]')).not.toBeNull();
});

test('with no MR row the object line falls back to the subject reference', async () => {
  await renderModal(gate({}));
  const object = $('.tui-respond-object')!;
  expect(object.querySelector('.tui-respond-object-ref')!.textContent).toBe(
    '!87'
  );
  expect(object.querySelector('.tui-respond-object-title')).toBeNull();
});

test('a prose respond gate keeps the MR strip and the context pane', async () => {
  await renderModal(
    gate({ context: 'Two threads from renee, both valid.' }),
    MR
  );
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  expect(
    $('.tui-triage-modal [data-part="scrollpane"]')!.textContent
  ).toContain('Two threads from renee, both valid.');
  expect($('.tui-triage-body[data-respond]')).toBeNull();
});

test('a malformed plan context keeps the MR strip and the context pane', async () => {
  await renderModal(
    gate({ context: JSON.stringify({ 'gate-ctx': 'plan@1' }) }),
    MR
  );
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  expect($('.tui-triage-modal [data-part="scrollpane"]')).not.toBeNull();
});

test('a respond gate whose contexts were dropped still renders its questions and options', async () => {
  await renderModal(
    gate({
      context: undefined,
      questions: [
        {
          id: 'thread-1',
          label: 'queue/enqueue.ts:88',
          multi: false,
          options: [
            { value: 'reply:t1', label: 'reply' },
            { value: 'fix:t1', label: 'fix' },
          ],
        },
      ],
    }),
    MR
  );
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).toContain('queue/enqueue.ts:88');
  expect(text).toContain('reply');
});

test('a bare GateForm host never pours a structured gate context out raw', async () => {
  const row = gate({});
  function Host() {
    const form = useGateForm(row, () => {});
    return <GateForm gate={row} mr={MR} form={form} onFocusPane={() => {}} />;
  }
  await React.act(async () => {
    root.render(<Host />);
  });
  expect(container.querySelector('.tui-gate-context-raw')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

const plan = (over: Partial<PlanCtx> = {}): PlanCtx => ({
  shape: 'plan@1',
  reviewer: 'renee',
  threads: { total: 2, blocking: 1 },
  ...over,
});

const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  shape: 'post@1',
  reviewer: 'renee',
  replies: 2,
  fixes: [],
  ...over,
});

const chips = (ctx: PlanCtx | PostCtx) =>
  headerChips(ctx).map(c => [c.text, c.hue]);

test('plan chips: threads, blocking, adjudication, round', () => {
  expect(chips(plan({ adjudication: 'both valid', round: 2 }))).toEqual([
    ['2 threads', 'grey'],
    ['1 blocking', 'amber'],
    ['both valid', 'green'],
    ['round 2', 'grey'],
  ]);
});

test('plan chips: zero blocking reads grey "all non-blocking"; one thread is singular', () => {
  expect(chips(plan({ threads: { total: 1, blocking: 0 } }))).toEqual([
    ['1 thread', 'grey'],
    ['all non-blocking', 'grey'],
  ]);
});

test('post chips: replies, one chip per fix, then round', () => {
  expect(
    chips(post({ fixes: [{ sha: 'ab12cd3' }, { sha: 'ef45ab6' }], round: 1 }))
  ).toEqual([
    ['2 replies', 'grey'],
    ['fix pushed · ab12cd3', 'green'],
    ['fix pushed · ef45ab6', 'green'],
    ['round 1', 'grey'],
  ]);
});

test('post chips: three or more fixes collapse; one reply is singular', () => {
  expect(
    chips(
      post({
        replies: 1,
        fixes: [{ sha: 'a1' }, { sha: 'b2' }, { sha: 'c3' }],
      })
    )
  ).toEqual([
    ['1 reply', 'grey'],
    ['3 fixes pushed', 'green'],
  ]);
});

test('post chips: an adjudication renders before the round', () => {
  expect(chips(post({ adjudication: 'both conceded', round: 1 }))).toEqual([
    ['2 replies', 'grey'],
    ['both conceded', 'green'],
    ['round 1', 'grey'],
  ]);
});
