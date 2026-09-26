/** A respond-post question whose context parses as replies@1, on the stage
    sheet (a respond-post gate with no post context and no per-thread
    questions lands there), joins each entry to its checkbox option by
    thread id: a joined option shows the file, a verb tag and the full
    reply text; an entry with no option is not rendered; an option with no
    entry keeps its plain label and description. */

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

const FIX_TEXT =
  'Good call. enqueue() now drops non-retryable jobs; added the check and a test that enqueues a permanent failure twice and asserts the second call is a no-op.';

const REPLIES = JSON.stringify({
  'gate-ctx': 'replies@1',
  replies: [
    {
      thread: 'th-aaa',
      file: 'queue/enqueue.ts:88',
      verb: 'fix',
      sha: 'ab12cd3',
      text: FIX_TEXT,
    },
    {
      thread: 'th-bbb',
      file: 'queue/README.md:12',
      verb: 'reply',
      text: 'Agreed on the wording; noted the contract in the doc.',
    },
    {
      thread: 'th-zzz',
      file: 'queue/orphan.ts:1',
      verb: 'reply',
      text: 'an entry no option answers',
    },
  ],
});

function postGate(context: string | undefined): GateRow {
  return {
    gateId: 'g-post-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-post',
    label: 'respond-post !87',
    status: 'open',
    openedAt: 1,
    questions: [
      {
        id: 'replies',
        label: 'Post which replies?',
        multi: true,
        ...(context !== undefined ? { context } : {}),
        options: [
          {
            value: 'th-aaa',
            label: 'queue/enqueue.ts:88',
            description: 'Good call. enqueue() now drops…',
          },
          {
            value: 'th-bbb',
            label: 'queue/README.md:12',
            description: 'Agreed on the wording…',
          },
          {
            value: 'th-ccc',
            label: 'queue/retry.ts:40',
            description: 'a plain option with no entry',
          },
        ],
      },
      {
        id: 'disposition',
        label: 'After posting?',
        multi: false,
        options: [
          {
            value: 'resolve-addressed',
            label: 'resolve-addressed',
            description: 'resolve each thread just replied to',
          },
          {
            value: 'leave-open',
            label: 'leave-open',
            description: 'post the replies without resolving the threads',
          },
        ],
      },
    ],
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
  expect(container.querySelector('.tui-stage-sheet')).not.toBeNull();
}

function repliesItem(): Element {
  return container.querySelector('[data-gate-ctx="replies"]')!;
}

test('joined options show the file, the verb tag and the full reply text', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(
    [...item.querySelectorAll('.tui-reply-choice-file')].map(n => n.textContent)
  ).toEqual(['queue/enqueue.ts:88', 'queue/README.md:12']);
  const fix = item.querySelector('[data-verb="fix"]')!;
  expect(fix.textContent).toBe('fix · ab12cd3');
  expect(fix.querySelector('.tui-respond-pill-sha')!.textContent).toBe(
    'ab12cd3'
  );
  expect(fix.getAttribute('data-hue')).toBe('green');
  const reply = item.querySelector('[data-verb="reply"]')!;
  expect(reply.textContent).toBe('reply');
  expect(reply.getAttribute('data-hue')).toBe('grey');
  expect(item.textContent).toContain(FIX_TEXT);
});

test('an entry whose thread matches no option is not rendered', async () => {
  await renderGate(postGate(REPLIES));
  expect(container.textContent).not.toContain('an entry no option answers');
  expect(container.textContent).not.toContain('queue/orphan.ts:1');
});

test('an option with no entry keeps its plain label and description', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(item.textContent).toContain('queue/retry.ts:40');
  const subtitles = [...item.querySelectorAll('.tui-gate-choice-subtitle')];
  expect(subtitles.map(n => n.textContent)).toEqual([
    'a plain option with no entry',
  ]);
});

test('every option stays a checkbox, and the context never renders as prose', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(item.querySelectorAll('.tui-gate-choice-input').length).toBe(3);
  expect(item.querySelector('.tui-gate-question-context')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

test('the disposition question renders as normal option cards', async () => {
  await renderGate(postGate(REPLIES));
  expect(container.textContent).toContain(
    'resolve each thread just replied to'
  );
  expect(container.textContent).toContain(
    'post the replies without resolving the threads'
  );
});

test('with no structured context the replies question renders exactly as before', async () => {
  await renderGate(postGate(undefined));
  expect(container.querySelector('[data-gate-ctx]')).toBeNull();
  expect(container.querySelector('.tui-reply-choice-file')).toBeNull();
  expect(container.textContent).toContain('Good call. enqueue() now drops…');
});
