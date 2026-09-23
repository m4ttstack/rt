/** An open gate whose gate-level context parses as plan@1 or post@1 opens
    the two-column respond sheet: every thread in the main column; in the
    rail the same MR card the review sheet uses, a decision context card
    ("<reviewer> reviewed your merge request", the round and adjudication,
    the thread chips), the MR's status, and what the submit will do; the
    parked and escalated chips on the head's action strip; and neither the
    MR strip nor the "Decision context" pane. Prose and malformed contexts
    open the stage sheet instead. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
import type { PlanCtx, PostCtx } from '../gate-ctx.ts';
import {
  headerChips,
  headerMeta,
  reviewerName,
} from '../RespondGateHeader.tsx';

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
  targetBranch: 'main',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  author: { username: 'alex', name: 'Alex Doe' },
  pipelineState: 'passed',
  behindTarget: null,
  blockers: { any: false, hasConflicts: false },
  reviews: { isApproved: false, given: 0, required: 1 },
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
        onNext={() => {}}
        onBack={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);

test('an open plan@1 gate opens the respond sheet: threads left; MR card, decision context, status and responses right', async () => {
  await renderModal(gate({}), MR);
  expect($('.tui-respond-sheet')).not.toBeNull();
  const card = $('.tui-sheet-rail .tui-mr-card')!;
  expect(card.querySelector('.tui-id-card-lead')!.textContent).toBe(
    'Alex Doe opened !87 into main'
  );
  expect(card.querySelector('.tui-id-card-title')!.textContent).toBe(
    'add retry to the fetch queue'
  );
  expect(card.querySelector('.tui-id-card-branch')!.textContent).toBe(
    'feature/demo-12-retry'
  );
  const context = $('.tui-sheet-rail .tui-sheet-context-card')!;
  expect(context.querySelector('.tui-id-card-lead')!.textContent).toBe(
    'renee reviewed your merge request'
  );
  expect(context.querySelector('.tui-person-name')!.textContent).toBe('renee');
  expect(context.querySelector('.tui-sheet-context-meta')!.textContent).toBe(
    'round 1 · both valid · fresh-context adjudicated'
  );
  expect($('.tui-sheet-main .tui-mr-card')).toBeNull();
  expect($('.tui-sheet-rail [data-card="responses"]')).not.toBeNull();
  expect($('.tui-sheet-rail [data-card="mr-status"]')).not.toBeNull();
  expect(
    document.body.querySelectorAll(
      '.tui-sheet-main .tui-respond-list > .tui-gate-question'
    )
  ).toHaveLength(1);
  expect($('.tui-sheet-main .tui-thread-card')).not.toBeNull();
  expect($('.tui-triage-sheet')).toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('gate-ctx');
  expect(text).not.toContain('pane-87');
  expect(text).not.toContain('demo-worktree');
});

test("a structured header with a prose question still renders that question's context", async () => {
  await renderModal(
    gate({
      questions: [
        {
          id: 'thread-1',
          label: 'queue/enqueue.ts:88',
          multi: false,
          context: 'Two threads on this file were left unresolved.',
          options: [
            { value: 'reply:t1', label: 'reply' },
            { value: 'fix:t1', label: 'fix' },
            { value: 'skip:t1', label: 'skip' },
          ],
        },
      ],
    }),
    MR
  );
  expect($('.tui-respond-sheet')).not.toBeNull();
  expect($('.tui-thread-card')).toBeNull();
  expect(
    $('.tui-respond-list > .tui-gate-question .tui-gate-question-context')!
      .textContent
  ).toContain('Two threads on this file were left unresolved.');
  expect($('.tui-sheet-dock .tui-gate-question-context')).toBeNull();
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
  ]);
});

test('a post@1 gate leads its decision context with the reviewer', async () => {
  await renderModal(gate({ kind: 'respond-post', context: POST }), MR);
  expect($('.tui-respond-sheet')).not.toBeNull();
  expect($('.tui-sheet-context-card .tui-id-card-lead')!.textContent).toBe(
    'renee reviewed your merge request'
  );
});

test('the reviewer reads by full name from the roster, else the MR reviewers, else the handle', async () => {
  const withReviewer = {
    ...MR,
    reviews: {
      ...(MR as unknown as { reviews: object }).reviews,
      reviewers: [{ username: 'renee', name: 'Renee Park' }],
    },
  } as unknown as BoardMRWithReview;
  expect(reviewerName('renee', withReviewer)).toBe('Renee Park');
  expect(
    reviewerName('renee', withReviewer, new Map([['renee', 'R. Park']]))
  ).toBe('R. Park');
  expect(reviewerName('renee', MR)).toBe('renee');
});

test('a GitHub MR says pull request', async () => {
  const mr = {
    ...MR,
    provider: 'github',
    webUrl: 'https://github.com/demo/app/pull/87',
  } as unknown as BoardMRWithReview;
  await renderModal(gate({}), mr);
  expect($('.tui-sheet-context-card .tui-id-card-lead')!.textContent).toBe(
    'renee reviewed your pull request'
  );
});

test('parked and escalated chips move onto the action strip', async () => {
  await renderModal(gate({ status: 'parked', escalatedAt: 5 }), MR);
  expect($('.tui-gate-sheet-actions [data-gate="parked"]')).not.toBeNull();
  expect($('.tui-gate-sheet-actions [data-gate="escalated"]')).not.toBeNull();
});

test('a prose gate carries its parked chip on the action strip', async () => {
  await renderModal(
    gate({ status: 'parked', context: 'Two threads from renee, both valid.' }),
    MR
  );
  expect($('.tui-stage-sheet')).not.toBeNull();
  expect($('.tui-gate-sheet-actions [data-gate="parked"]')).not.toBeNull();
});

test('with no MR row there is no MR card and the rail names the subject reference', async () => {
  await renderModal(gate({}));
  expect($('.tui-mr-card')).toBeNull();
  expect($('.tui-sheet-dock-heading')!.textContent).toBe('Responses on !87');
});

test('a prose respond gate opens the stage sheet with its context in the rail', async () => {
  await renderModal(
    gate({ context: 'Two threads from renee, both valid.' }),
    MR
  );
  expect($('.tui-respond-sheet')).toBeNull();
  expect($('.tui-stage-sheet')).not.toBeNull();
  expect($('.tui-sheet-rail .tui-mr-card')).not.toBeNull();
  expect($('.tui-sheet-context-card')!.textContent).toContain(
    'Two threads from renee, both valid.'
  );
});

test('a malformed plan context opens the stage sheet beside the MR card', async () => {
  await renderModal(
    gate({ context: JSON.stringify({ 'gate-ctx': 'plan@1' }) }),
    MR
  );
  expect($('.tui-respond-sheet')).toBeNull();
  expect($('.tui-stage-sheet')).not.toBeNull();
  expect($('.tui-sheet-rail .tui-mr-card')).not.toBeNull();
  expect($('.tui-sheet-context-card')).not.toBeNull();
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
  expect($('.tui-respond-sheet')).toBeNull();
  expect($('.tui-stage-sheet')).not.toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).toContain('queue/enqueue.ts:88');
  expect(text).toContain('reply');
});

const linkLabels = () =>
  [...document.body.querySelectorAll('.tui-mr-link')].map(a => [
    a.getAttribute('aria-label'),
    a.getAttribute('href'),
  ]);

test('the MR card links the MR on its forge and its ticket on Linear', async () => {
  const mr = {
    ...MR,
    webUrl: 'https://gitlab.example.com/demo/app/-/merge_requests/87',
  } as BoardMRWithReview;
  await renderModal(gate({}), mr);
  expect($('.tui-mr-card .tui-mr-links')).not.toBeNull();
  expect(linkLabels()).toEqual([
    [
      'open !87 in GitLab',
      'https://gitlab.example.com/demo/app/-/merge_requests/87',
    ],
    ['open DEMO-12 in Linear', 'https://linear.app/issue/DEMO-12'],
  ]);
});

test('a GitHub MR links GitHub, and no ticket means no Linear link', async () => {
  const mr = {
    ...MR,
    title: 'add retry to the fetch queue',
    sourceBranch: 'retry-queue',
    webUrl: 'https://github.com/demo/app/pull/87',
  } as BoardMRWithReview;
  await renderModal(gate({}), mr);
  expect(linkLabels()).toEqual([
    ['open !87 in GitHub', 'https://github.com/demo/app/pull/87'],
  ]);
});

test('a prose gate carries the same links on its MR card', async () => {
  const mr = {
    ...MR,
    webUrl: 'https://gitlab.example.com/demo/app/-/merge_requests/87',
  } as BoardMRWithReview;
  await renderModal(gate({ context: 'Two threads from renee.' }), mr);
  expect($('.tui-mr-card .tui-mr-links')).not.toBeNull();
  expect(linkLabels().map(([label]) => label)).toEqual([
    'open !87 in GitLab',
    'open DEMO-12 in Linear',
  ]);
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

test('plan chips: threads and blocking; the round and adjudication ride the meta line', () => {
  const ctx = plan({ adjudication: 'both valid', round: 2 });
  expect(chips(ctx)).toEqual([
    ['2 threads', 'grey'],
    ['1 blocking', 'amber'],
  ]);
  expect(headerMeta(ctx)).toEqual(['round 2', 'both valid']);
});

test('plan chips: zero blocking reads grey "all non-blocking"; one thread is singular', () => {
  expect(chips(plan({ threads: { total: 1, blocking: 0 } }))).toEqual([
    ['1 thread', 'grey'],
    ['all non-blocking', 'grey'],
  ]);
});

test('post chips: replies, then one chip per fix', () => {
  expect(
    chips(post({ fixes: [{ sha: 'ab12cd3' }, { sha: 'ef45ab6' }], round: 1 }))
  ).toEqual([
    ['2 replies', 'grey'],
    ['fix pushed · ab12cd3', 'green'],
    ['fix pushed · ef45ab6', 'green'],
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

test('post chips: the adjudication rides the meta line, not the chips', () => {
  const ctx = post({ adjudication: 'both conceded', round: 1 });
  expect(chips(ctx)).toEqual([['2 replies', 'grey']]);
  expect(headerMeta(ctx)).toEqual(['round 1', 'both conceded']);
});
