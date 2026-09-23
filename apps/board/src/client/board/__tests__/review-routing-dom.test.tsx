/** DOM-level test for the review-post routing predicate: a
    structured review-post gate whose context and every findings chunk
    join one-to-one opens the review sheet; any mismatch, or a legacy
    prose-context gate, falls through to the generic decision-queue
    modal. Mirrors respond-header-dom.test.tsx's direct-mount harness. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateQuestion } from '@mattstack/gate-kit';
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

const j = (v: unknown) => JSON.stringify(v);
const REVIEW = j({
  'gate-ctx': 'review@1',
  readiness: 'with-fixes',
  summary: 'one real defect, one missing case.',
  findings: { important: 1, minor: 1 },
});
const entry = (id: string, severity: string) => ({
  id,
  severity,
  title: `finding ${id}`,
  body: `the full text of ${id}.`,
});
const option = (value: string, tier: string) => ({
  value,
  label: `[${tier}] finding ${value}`,
  description: `lib/${value}.ts:1 · fix ${value}`,
});

function reviewGate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-rv',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/12',
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: REVIEW,
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !12?',
        multi: true,
        context: j({
          'gate-ctx': 'findings@1',
          findings: [entry('f1', 'important'), entry('f2', 'minor')],
        }),
        options: [option('f1', 'Important'), option('f2', 'Minor')],
      },
      {
        id: 'outcome',
        label: 'Verdict on !12',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    ...overrides,
  };
}

function withFindings(patch: Partial<GateQuestion>): GateRow {
  const g = reviewGate();
  return {
    ...g,
    questions: [{ ...g.questions[0]!, ...patch }, g.questions[1]!],
  };
}

test('a structured review-post gate opens the review sheet', async () => {
  await renderModal(reviewGate());
  expect($('.tui-review-sheet')).not.toBeNull();
  expect($('.tui-triage-sheet')).toBeNull();
});

test('an entry with no option routes the whole gate to the generic modal', async () => {
  await renderModal(
    withFindings({
      context: j({
        'gate-ctx': 'findings@1',
        findings: [
          entry('f1', 'important'),
          entry('f2', 'minor'),
          entry('f3', 'minor'),
        ],
      }),
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-sheet')).not.toBeNull();
});

test('an option with no entry routes the whole gate to the generic modal', async () => {
  await renderModal(
    withFindings({
      options: [
        option('f1', 'Important'),
        option('f2', 'Minor'),
        option('f3', 'Minor'),
      ],
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-sheet')).not.toBeNull();
});

test('a legacy review-post gate (prose context, pinned-format options) renders in the generic modal', async () => {
  await renderModal(
    reviewGate({
      context: 'Findings: Important (1), Minor (1)',
      questions: reviewGate().questions.map(q => ({
        ...q,
        context: undefined,
      })),
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-sheet')).not.toBeNull();
});
