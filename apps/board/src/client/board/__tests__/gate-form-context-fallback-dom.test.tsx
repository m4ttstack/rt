/** A bare GateForm host (no Decision context pane above it) renders the
    gate context itself: prose as plain markdown, a review@1 flattened,
    never raw JSON. */

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

function Host({ gate = GATE }: { gate?: GateRow }) {
  const form = useGateForm(gate, () => {});
  return <GateForm gate={gate} mr={MR} form={form} onFocusPane={() => {}} />;
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

test('a plain-prose context renders as plain markdown', async () => {
  await React.act(async () => {
    root.render(<Host />);
  });
  expect(container.textContent).toContain(PROSE);
});

test('a review@1 context renders flattened, never as raw JSON', async () => {
  const gate: GateRow = {
    ...GATE,
    gateId: 'g-review',
    context: JSON.stringify({
      'gate-ctx': 'review@1',
      readiness: 'yes',
      summary: 'nothing worth a thread.',
      findings: {},
    }),
  };
  await React.act(async () => {
    root.render(<Host gate={gate} />);
  });
  expect(container.textContent).toContain('Ready to merge: yes');
  expect(container.textContent).toContain('nothing worth a thread.');
  expect(container.textContent).not.toContain('gate-ctx');
});
