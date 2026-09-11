/** DOM-level test for the skippable multi question in GateForm: the tiers
    step offers a "none" control (the questionnaire's skip), the required
    single-select does not, and skipping submits an explicit `tiers: []`
    through /gate/answer -- the shape the daemon records and the wrapper
    reads as post-nothing. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

// Missing before task 14: bun test shares one global realm across files, and
// this file never unregistered -- whichever DOM test happened to load next
// (by bun's own file-run order, not necessarily filename order) then failed
// registering its own happy-dom instance. See orphan-strip-dom.test.tsx.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GATE: GateRow = {
  gateId: 'g-skip',
  subject: 'mr:gitlab.example.com/g/p/-/merge_requests/9',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  questions: [
    {
      id: 'tiers',
      label: 'Post which findings?',
      multi: true,
      options: [{ value: 'Minor', label: 'Minor (2)' }],
    },
    {
      id: 'outcome',
      label: 'Verdict',
      multi: false,
      options: ['comment', 'approve'],
    },
  ],
};

const MR = { iid: 9 } as unknown as BoardMRWithReview;

function Host({ onAnswered }: { onAnswered: () => void }) {
  const form = useGateForm(GATE, onAnswered);
  return <GateForm gate={GATE} mr={MR} form={form} onFocusPane={() => {}} />;
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    init?: { body?: string }
  ) => {
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

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find(
      b => b.textContent?.trim() === text && !b.hidden
    ) ?? null
  );
}

async function click(el: Element) {
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

test('an unanswered multi step progresses through "next · none" and submits tiers: []', async () => {
  let answered = false;
  await React.act(async () => {
    root.render(<Host onAnswered={() => (answered = true)} />);
  });

  // With nothing checked the primary button IS the way forward: no dead
  // disabled "next" beside a side affordance.
  const nextNone = buttonByText('next · none');
  expect(nextNone).not.toBeNull();
  expect(buttonByText('next')).toBeNull();

  await click(nextNone!);

  // Advanced to the required Verdict step, which never offers a none path.
  expect(buttonByText('next · none')).toBeNull();
  expect(buttonByText('submit · none')).toBeNull();

  const comment = [...container.querySelectorAll('input[type=radio]')].find(
    i => (i as HTMLInputElement).value === 'comment'
  );
  expect(comment).toBeDefined();
  await click(comment!);
  await click(buttonByText('submit')!);

  expect(posts.length).toBe(1);
  expect(posts[0]!.url).toBe('/gate/answer');
  expect(posts[0]!.body).toEqual({
    gateId: 'g-skip',
    answers: { tiers: [], outcome: 'comment' },
  });
  expect(answered).toBe(true);
});

test('checking a tier morphs the button back to a plain next; unchecking restores the none path', async () => {
  await React.act(async () => {
    root.render(<Host onAnswered={() => {}} />);
  });

  const minor = [...container.querySelectorAll('input[type=checkbox]')].find(
    i => (i as HTMLInputElement).value === 'Minor'
  );
  expect(minor).toBeDefined();
  await click(minor!);
  expect(buttonByText('next · none')).toBeNull();
  expect(buttonByText('next')).not.toBeNull();

  await click(minor!);
  expect(buttonByText('next')).toBeNull();
  await click(buttonByText('next · none')!);

  const comment = [...container.querySelectorAll('input[type=radio]')].find(
    i => (i as HTMLInputElement).value === 'comment'
  );
  await click(comment!);
  await click(buttonByText('submit')!);

  expect(posts[0]!.body).toEqual({
    gateId: 'g-skip',
    answers: { tiers: [], outcome: 'comment' },
  });
});
