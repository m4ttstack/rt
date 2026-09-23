/** The queue sheet's chrome: the step nav renders inline in the gate body,
    and the head is one row -- title, compact (size="sm") focus pane, then
    the queue nav (previous gate, pips, gate count, next gate), the tag and
    close. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import {
  DecisionQueueModal,
  type TriageGateState,
} from '../DecisionQueueModal.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function stepped(): GateRow {
  return {
    gateId: 'g-steps',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/51',
    kind: 'clarify',
    label: 'clarify !51',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: 'Two questions for the author.',
    origin: { paneId: 'pane-51', worktree: '/work/demo' },
    questions: [
      {
        id: 'first',
        label: 'Keep the flag?',
        multi: false,
        options: ['keep', 'drop'],
      },
      {
        id: 'second',
        label: 'Ship behind it?',
        multi: false,
        options: ['yes', 'no'],
      },
    ],
  };
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
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

async function renderModal(
  row: GateRow,
  nextPeek?: string,
  opts?: {
    position?: number;
    states?: TriageGateState[];
    onBack?: () => void;
    onNext?: () => void;
    canBack?: boolean;
    canNext?: boolean;
  }
) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        position={opts?.position ?? 1}
        states={opts?.states ?? ['active']}
        nextPeek={nextPeek}
        onClose={() => {}}
        onNext={opts?.onNext ?? (() => {})}
        onBack={opts?.onBack ?? (() => {})}
        canBack={opts?.canBack}
        canNext={opts?.canNext}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const navButton = (text: string) =>
  [...document.body.querySelectorAll('.tui-gate-actions button')].find(
    b => b.textContent?.trim() === text && !b.hasAttribute('hidden')
  ) ?? null;

test('the step nav renders in the gate body, never in the head', async () => {
  await renderModal(stepped());
  expect($('.tui-triage-body .tui-gate-actions')).not.toBeNull();
  expect($('.tui-gate-sheet-head .tui-gate-actions')).toBeNull();
});

test('the nav still drives the form: pick, next, pick, submit posts both answers', async () => {
  await renderModal(stepped());
  await click($('input[value="keep"]'));
  await click(navButton('next'));
  await click($('input[value="yes"]'));
  await click(navButton('submit'));
  const answer = posts.find(p => p.url === '/gate/answer');
  expect(answer?.body).toMatchObject({
    gateId: 'g-steps',
    answers: { first: 'keep', second: 'yes' },
  });
});

test('reset in the gate body clears the picks', async () => {
  await renderModal(stepped());
  await click($('input[value="keep"]'));
  await click(navButton('reset'));
  expect(($('input[value="keep"]') as HTMLInputElement).checked).toBe(false);
});

test('the head is one row: title, compact focus pane, then close -- no skip chip', async () => {
  await renderModal(stepped());
  const head = $('.tui-gate-sheet-head')!;
  expect(head.querySelector('.tui-gate-sheet-title')?.textContent).toBe(
    'decision queue'
  );
  const actions = [...head.querySelectorAll('.tui-gate-sheet-actions button')];
  expect(actions.map(b => b.textContent?.trim())).toEqual(['focus pane']);
  for (const b of actions) expect(b.getAttribute('data-size')).toBe('sm');
  expect(
    [...head.querySelectorAll('button')].some(
      b => b.textContent?.trim() === 'skip gate'
    )
  ).toBe(false);
});

test('the head queue nav holds a previous-gate control, the count stacked over the pips, and a next-gate control', async () => {
  await renderModal(stepped(), undefined, {
    position: 2,
    states: ['done', 'active', 'todo'],
  });
  const nav = $('.tui-gate-sheet-head .tui-gate-queue-nav')!;
  const children = [...nav.children];
  expect(children).toHaveLength(3);

  const prev = children[0] as HTMLButtonElement;
  const where = children[1]!;
  const next = children[2] as HTMLButtonElement;

  expect(where.className).toContain('tui-gate-queue-where');
  const [count, pips] = [...where.children];
  expect(count!.textContent).toBe('2 of 3');
  expect(pips!.className).toContain('tui-gate-queue-pips');
  expect(pips!.children).toHaveLength(3);
  expect(prev.getAttribute('aria-label')).toBe('previous gate');
  expect(prev.getAttribute('title')).toBe('previous gate');
  expect(next.getAttribute('aria-label')).toBe('next gate');
  expect(next.getAttribute('title')).toBe('next gate');
  // Distinct from the in-gate step nav's text buttons ("previous"/"next").
  expect(prev.textContent?.trim()).not.toBe('previous');
  expect(next.textContent?.trim()).not.toBe('next');
});

test('the previous-gate control is disabled on the first gate and enabled past it', async () => {
  await renderModal(stepped(), undefined, { position: 1 });
  expect(
    ($('[aria-label="previous gate"]') as HTMLButtonElement).disabled
  ).toBe(true);

  await renderModal(stepped(), undefined, {
    position: 2,
    states: ['done', 'active'],
  });
  expect(
    ($('[aria-label="previous gate"]') as HTMLButtonElement).disabled
  ).toBe(false);
});

test('the next-gate control is disabled on the last gate, so navigating never lands on the done face', async () => {
  await renderModal(stepped(), undefined, {
    position: 3,
    states: ['done', 'todo', 'active'],
  });
  expect(($('[aria-label="next gate"]') as HTMLButtonElement).disabled).toBe(
    true
  );

  await renderModal(stepped(), undefined, {
    position: 2,
    states: ['done', 'active', 'todo'],
  });
  expect(($('[aria-label="next gate"]') as HTMLButtonElement).disabled).toBe(
    false
  );
});

test('a chevron with no gate to land on is disabled even mid-queue', async () => {
  await renderModal(stepped(), undefined, {
    position: 2,
    states: ['done', 'active', 'done'],
    canBack: false,
    canNext: false,
  });
  expect(
    ($('[aria-label="previous gate"]') as HTMLButtonElement).disabled
  ).toBe(true);
  expect(($('[aria-label="next gate"]') as HTMLButtonElement).disabled).toBe(
    true
  );
});

test('the previous-gate control calls onBack, the next-gate control calls onNext', async () => {
  let backCalls = 0;
  let nextCalls = 0;
  await renderModal(stepped(), undefined, {
    position: 2,
    states: ['done', 'active', 'todo'],
    onBack: () => {
      backCalls++;
    },
    onNext: () => {
      nextCalls++;
    },
  });
  await click($('[aria-label="previous gate"]'));
  expect(backCalls).toBe(1);

  const posts0 = posts.length;
  await click($('[aria-label="next gate"]'));
  expect(nextCalls).toBe(1);
  // Paging is a view change: it never touches the network.
  expect(posts.length).toBe(posts0);
});

test('there is no peek row; the next-gate title rides the count tooltip', async () => {
  await renderModal(stepped(), '!52 · add retry to the fetch queue');
  expect($('.tui-triage-peek')).toBeNull();
  expect($('.tui-gate-queue-pos')?.getAttribute('title')).toBe(
    'next: !52 · add retry to the fetch queue'
  );
});
