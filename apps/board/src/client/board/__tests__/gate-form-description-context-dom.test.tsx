/** BOARD-36: the opt-desc-rt lane's two optional gate-schema fields --
    `description` on an option, `context` on a question -- carry through to
    the board's live form. An option's description renders as a muted line
    under its label; a question's own context renders with that question's
    card, above its choices, separate from the gate-level context block.
    Gates carrying neither field keep rendering exactly as before. */

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

const MR = { iid: 9 } as unknown as BoardMRWithReview;

function gate(overrides: Partial<GateRow>): GateRow {
  return {
    gateId: 'g-1',
    subject: 'mr:gitlab.example.com/g/p/-/merge_requests/9',
    kind: 'review-post',
    label: 'review',
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

test('an option with a description renders it as a muted line under the label', async () => {
  await renderGate(
    gate({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          options: [
            {
              value: 'approve',
              label: 'Approve',
              description: 'Ship as-is, no changes requested.',
            },
            { value: 'comment', label: 'Comment' },
          ],
        },
      ],
    })
  );
  expect(container.textContent).toContain('Ship as-is, no changes requested.');
});

test('an option with no description renders exactly as today: no subtitle element', async () => {
  await renderGate(
    gate({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          options: ['comment', 'approve'],
        },
      ],
    })
  );
  expect(container.querySelector('.tui-gate-choice-subtitle')).toBeNull();
});

test("a question's own context renders with its card, above its options", async () => {
  await renderGate(
    gate({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          context: 'Two threads on this file were left unresolved.',
          options: ['comment', 'approve'],
        },
      ],
    })
  );
  expect(container.textContent).toContain(
    'Two threads on this file were left unresolved.'
  );
});

test('a question with no context renders exactly as today: no per-question context block', async () => {
  await renderGate(
    gate({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          options: ['comment', 'approve'],
        },
      ],
    })
  );
  expect(container.querySelector('.tui-gate-question-context')).toBeNull();
});

test('a mixed gate: one question with context and described options, one plain, both render correctly', async () => {
  await renderGate(
    gate({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          context: 'The reviewer flagged a possible race condition.',
          options: [
            {
              value: 'approve',
              label: 'Approve',
              description: 'Ship as-is, no changes requested.',
            },
            { value: 'comment', label: 'Comment' },
          ],
        },
        {
          id: 'tiers',
          label: 'Which severities?',
          multi: true,
          options: ['Major', 'Minor'],
        },
      ],
    })
  );
  expect(container.textContent).toContain(
    'The reviewer flagged a possible race condition.'
  );
  expect(container.textContent).toContain('Ship as-is, no changes requested.');
  // The second question carries neither field: no stray subtitle/context
  // nodes attributed to it.
  expect(container.querySelectorAll('.tui-gate-choice-subtitle').length).toBe(
    1
  );
  expect(container.querySelectorAll('.tui-gate-question-context').length).toBe(
    1
  );
});
