/** A gate context that is not a structured gate-ctx shape renders as plain
    markdown in the modal's Decision context pane: no section markers lifted
    onto a question, no bracketed-line grouping, no raw JSON. A review@1
    context flattens to prose; every other shape is left to its own card. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const j = (v: unknown) => JSON.stringify(v);

function proseGate(context: string, overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-prose',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/40',
    kind: 'clarify',
    label: 'clarify !40',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context,
    questions: [
      {
        id: 'finding-1',
        label: 'lib/a.ts:1',
        multi: false,
        options: ['post', 'skip'],
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

async function renderModal(row: GateRow) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
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

const paneText = () =>
  $('.tui-triage-sheet [data-part="scrollpane-body"]')?.textContent ?? '';

test('section markers render verbatim in the pane: nothing is lifted onto a question', async () => {
  await renderModal(
    proseGate(
      'Two findings.\n\n=== finding-1 lib/a.ts:1 (verdict: valid, recommend post) ===\nreviewer: "a stray dot renders"\nAdjudication: correct.'
    )
  );
  expect(paneText()).toContain(
    '=== finding-1 lib/a.ts:1 (verdict: valid, recommend post) ==='
  );
  expect(paneText()).toContain('Adjudication: correct.');
  const question = $('.tui-gate-question')!;
  expect(question.textContent).not.toContain('Adjudication');
  expect($('[data-gate="recommended"]')).toBeNull();
});

test('bracketed lines render as written, with no grouping and no toggle', async () => {
  await renderModal(
    proseGate(
      'Findings: Important (1), Minor (1)\n[Important] a guard is missing\n[Minor] an import is unused'
    )
  );
  expect(paneText()).toContain('[Important] a guard is missing');
  expect(paneText()).toContain('[Minor] an import is unused');
  expect(
    [...document.body.querySelectorAll('button')].some(
      b => b.textContent === 'as written'
    )
  ).toBe(false);
});

test('an answered structured review-post gate shows its summary as prose, never raw JSON', async () => {
  await renderModal(
    proseGate(
      j({
        'gate-ctx': 'review@1',
        readiness: 'with-fixes',
        summary: 'one real defect remains.',
        findings: { important: 1 },
      }),
      {
        kind: 'review-post',
        status: 'answered',
        answers: { outcome: 'comment' },
        questions: [
          {
            id: 'outcome',
            label: 'Verdict',
            multi: false,
            options: ['comment', 'approve'],
          },
        ],
      }
    )
  );
  expect(paneText()).toContain('Ready to merge: with fixes');
  expect(paneText()).toContain('one real defect remains.');
  expect(document.body.textContent).not.toContain('gate-ctx');
});

test('a findings@1 question context in the generic modal never renders raw; the pinned options carry it', async () => {
  const findings = j({
    'gate-ctx': 'findings@1',
    findings: [
      {
        id: 'f1',
        severity: 'minor',
        title: 'unused import',
        body: 'the import is dead.',
      },
    ],
  });
  await renderModal(
    proseGate(
      j({
        'gate-ctx': 'review@1',
        readiness: 'yes',
        summary: 'fine.',
        findings: { minor: 1 },
      }),
      {
        kind: 'review-post',
        questions: [
          {
            id: 'findings-1',
            label: 'Post which findings to !40?',
            multi: true,
            context: findings,
            options: [
              {
                value: 'f1',
                label: '[Minor] unused import',
                description: 'lib/a.ts:3 · drop it',
              },
              {
                value: 'f2',
                label: '[Minor] no entry for this one',
                description: 'lib/b.ts:1 · fix it',
              },
            ],
          },
          {
            id: 'outcome',
            label: 'Verdict',
            multi: false,
            options: ['comment', 'approve'],
          },
        ],
      }
    )
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect(document.body.textContent).not.toContain('gate-ctx');
  expect(document.body.textContent).toContain('[Minor] unused import');
  expect(document.body.textContent).toContain('lib/a.ts:3 · drop it');
});
