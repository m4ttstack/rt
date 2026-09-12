/** DOM-level test for the interrupted badge: a lane whose executor pane is
    gone must stop flashing its in-flight word ("reviewing…") and say
    "interrupted" instead -- warn tint, no pulse. Terminal states (done,
    error) are already true regardless of the pane, so they never flip. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let ReviewBadge: typeof import('../chips.tsx').ReviewBadge;
let RespondBadge: typeof import('../chips.tsx').RespondBadge;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ ReviewBadge, RespondBadge } = await import('../chips.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function render(el: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(el);
  });
  return container;
}

function chip(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-part="chip"]');
  expect(el).not.toBeNull();
  return el!;
}

test('an in-flight review with a gone executor reads "interrupted", warn, no pulse', async () => {
  const container = await render(
    <ReviewBadge review={{ status: 'reviewing' }} interrupted />
  );
  const el = chip(container);
  expect(el.textContent?.trim()).toBe('interrupted');
  expect(el.dataset.interrupted).toBe('true');
  expect(el.dataset.pulse).toBeUndefined();
});

test('a queued review with a gone executor is interrupted too', async () => {
  const container = await render(
    <ReviewBadge review={{ status: 'queued' }} interrupted />
  );
  expect(chip(container).textContent?.trim()).toBe('interrupted');
});

test('a finished review ignores the interrupted flag -- the report exists', async () => {
  const container = await render(
    <ReviewBadge review={{ status: 'done' }} interrupted />
  );
  const el = chip(container);
  expect(el.textContent?.trim()).toBe('review ready');
  expect(el.dataset.interrupted).toBeUndefined();
});

test('without the flag the reviewing badge keeps its pulse and word', async () => {
  const container = await render(
    <ReviewBadge review={{ status: 'reviewing' }} />
  );
  const el = chip(container);
  expect(el.textContent?.trim()).toBe('reviewing…');
  expect(el.dataset.pulse).toBe('true');
});

test('an in-flight respond with a gone executor reads "interrupted" as well', async () => {
  const container = await render(
    <RespondBadge respond={{ status: 'implementing' }} interrupted />
  );
  const el = chip(container);
  expect(el.textContent?.trim()).toBe('interrupted');
  expect(el.dataset.interrupted).toBe('true');
  expect(el.dataset.pulse).toBeUndefined();
});

test('a done respond ignores the flag', async () => {
  const container = await render(
    <RespondBadge
      respond={{ status: 'done', posted: 2, threads: 2 }}
      interrupted
    />
  );
  expect(chip(container).dataset.interrupted).toBeUndefined();
});
