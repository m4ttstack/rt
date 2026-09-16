/** BOARD-33: a plain-prose gate context (no `=== key ===` markers, no
    `[Label]` lines) parses to an empty section list from both
    gate-context.ts parsers, so no question ever gets a section. GateForm
    must fall back to the raw context, the same fallback DecisionQueueModal
    already has, instead of showing nothing. */

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

const PROSE =
  'This gate context is a plain paragraph with no === markers and no [Label] lines to parse.';

const GATE: GateRow = {
  gateId: 'g-prose',
  subject: 'mr:gitlab.example.com/g/p/-/merge_requests/9',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  context: PROSE,
  questions: [
    {
      id: 'outcome',
      label: 'Verdict',
      multi: false,
      options: ['comment', 'approve'],
    },
  ],
};

const MR = { iid: 9 } as unknown as BoardMRWithReview;

function Host() {
  const form = useGateForm(GATE, () => {});
  return <GateForm gate={GATE} mr={MR} form={form} onFocusPane={() => {}} />;
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

test('a plain-prose context renders as a raw fallback when no question sections it', async () => {
  await React.act(async () => {
    root.render(<Host />);
  });
  expect(container.textContent).toContain(PROSE);
});
