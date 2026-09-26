/** DOM-level test for the top-of-board freshness banner and the tab-title
    mark: a real happy-dom document and a real Board render, fetch faked. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  setSystemTime,
  test,
} from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

// Frozen for the whole suite (via setSystemTime in beforeAll below) so every
// fixture built from "now" lands at the same instant the board's own
// freshness math reads at render time.
const NOW = Date.now();

class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_TITLE = 'MRs ready for review';

// No syncError key on purpose: the older-server shape must still render.
const BOARD_DATA = {
  title: BASE_TITLE,
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
  ],
  mrs: [],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
  dataSyncedAt: 1755600000000,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let servedData: Record<string, unknown> = BOARD_DATA;

beforeAll(async () => {
  setSystemTime(NOW);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(servedData), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  servedData = BOARD_DATA;
  localStorage.clear();
  history.replaceState(null, '', '/');
  document.title = BASE_TITLE;
});

afterAll(async () => {
  setSystemTime();
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function renderBoard(container: HTMLElement) {
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return root;
}

const banner = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.tui-banner[role="status"]');

test('stale data with a GitLab timeout: a red banner naming the cause, and a marked tab', async () => {
  servedData = {
    ...BOARD_DATA,
    dataSyncedAt: NOW - 103 * 60_000,
    syncError: {
      since: NOW - 100 * 60_000,
      lastAt: NOW - 60_000,
      kind: 'timeout',
      message: 'GraphQL errors: Timeout on MergeRequest.id',
      projects: 1,
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    const el = banner(container);
    expect(el?.textContent).toStartWith('⚠ GitLab timing out since ');
    expect(el?.textContent).toContain('board data is 1h 43m old');
    expect(el?.dataset.intent).toBe('bad');
    expect(el?.title).toBe('GraphQL errors: Timeout on MergeRequest.id');
    expect(document.title).toBe(`⚠ ${BASE_TITLE}`);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
  expect(document.title).toBe(BASE_TITLE);
});

test('stale data without a cause: an amber banner (no data-intent)', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: NOW - 15 * 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    const el = banner(container);
    expect(el?.textContent).toStartWith('⚠ board data is 15m old');
    expect(el?.dataset.intent).toBeUndefined();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('fresh data: no banner and an unmarked tab', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: NOW - 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    expect(banner(container)).toBeNull();
    expect(document.title).toBe(BASE_TITLE);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('re-rendering while stale does not stack the tab mark', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: NOW - 45 * 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    expect(document.title).toBe(`⚠ ${BASE_TITLE}`);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
