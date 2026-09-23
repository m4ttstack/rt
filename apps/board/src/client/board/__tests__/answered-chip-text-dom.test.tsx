/** The answered chip counts an edited reply and shows the text that
    posted, once, in its detail. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { AnsweredChip } from '../GateForm.tsx';

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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const thread = (n: number, t: string) => ({
  id: `thread-${n}`,
  label: `${t}.ts:1`,
  multi: true,
  options: [
    { value: `post:${t}`, label: 'Post' },
    { value: `resolve:${t}`, label: 'Resolve' },
  ],
});

test('an edited reply counts on the chip and shows once in the detail', async () => {
  await React.act(async () => {
    root.render(
      <AnsweredChip
        startOpen
        row={{
          subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
          kind: 'respond-post',
          status: 'answered',
          questions: [thread(1, 'T1'), thread(2, 'T2')],
          answer: {
            answers: {
              'thread-1': { value: ['post:T1'], text: 'Edited reply.' },
              'thread-2': ['post:T2'],
            },
            by: 'board',
          },
        }}
      />
    );
  });
  const text = container.textContent ?? '';
  expect(text).toContain('2 posted (1 edited)');
  expect(text.split('edited reply: Edited reply.').length - 1).toBe(1);
});

test('an edited reply keeps its paragraphs on its own line, not the faint note', async () => {
  const reply = 'Fixed the guard.\n\nThe retry is bounded too.';
  await React.act(async () => {
    root.render(
      <AnsweredChip
        startOpen
        row={{
          subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
          kind: 'respond-post',
          status: 'answered',
          questions: [thread(1, 'T1')],
          answer: {
            answers: { 'thread-1': { value: ['post:T1'], text: reply } },
            by: 'board',
          },
        }}
      />
    );
  });
  const line = container.querySelector('[data-edited-reply]')!;
  expect(line.classList.contains('tui-gate-summary-reply')).toBe(true);
  expect(line.classList.contains('tui-gate-summary-note')).toBe(false);
  expect(line.textContent).toContain(reply);
});
