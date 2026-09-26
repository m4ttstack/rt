/** DOM-level test for the empty-queue copy in Board.tsx: a real happy-dom
    document and a real Board render. The slack-filter-on empty state has to
    name the filter (not read as "this queue has no work"), because the
    posted-in-slack pick persists across tabs — including Needs me. */

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
// fixture built from Date.now() -- module-level BOARD_DATA included, since
// it evaluates before any hook runs -- lands at the same instant the board's
// own freshness math reads at render time.
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

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
  ],
  mrs: [],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: true,
  slackTemplates: {
    single: '{title}: {url}',
    multiHeader: '{count} ready',
    multiItem: '- {title}',
  },
  // Always "now": a fixed past timestamp drifts stale over time, which
  // fires the freshness banner and, in turn, suppresses the empty-queue
  // check mark these tests assert on.
  dataSyncedAt: NOW,
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

function needsMeMr(iid: number) {
  return {
    iid,
    title: `mr ${iid}`,
    webUrl: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    author: { username: 'matt', name: 'Matthew Goodwin' },
    sourceBranch: `b${iid}`,
    targetBranch: 'main',
    updatedAt: '2026-08-19T00:00:00Z',
    createdAt: '2026-08-19T00:00:00Z',
    reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
    blockers: { any: true, hasConflicts: true },
    mergeButton: { visible: false, disabled: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    reviewerComments: 0,
    unresolvedThreads: 0,
    isDraft: false,
    pipelineState: 'none',
    repositoryId: `gitlab:${iid}`,
    rtRepo: null,
    codeownerSections: [],
    gates: [],
    slack: { posted: false },
  };
}

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

async function openNeedsMe(container: HTMLElement) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(el =>
    el.textContent?.includes('Needs me')
  ) as HTMLElement | undefined;
  if (!tab) throw new Error('Needs me tab not found');
  await React.act(async () => {
    tab.click();
  });
}

function emptyCopy(container: HTMLElement): string {
  return container.querySelector('.tui-empty')?.textContent?.trim() ?? '';
}

test('an empty Needs me queue without the slack filter says nothing is waiting', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('nothing waiting on review ✓');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('an empty Needs me queue with the slack filter on names the filter', async () => {
  history.replaceState(null, '', '?slack=posted');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('Nothing found in slack');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a red freshness banner suppresses the empty-queue check mark', async () => {
  servedData = {
    ...BOARD_DATA,
    dataSyncedAt: 0,
    mrs: [],
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
    const el = container.querySelector<HTMLElement>(
      '.tui-banner[role="status"]'
    );
    expect(el?.dataset.intent).toBe('bad');
    expect(container.querySelector('.tui-empty')).toBeNull();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a slack-filtered Needs me queue says how many items it hid', async () => {
  servedData = {
    ...BOARD_DATA,
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: 2 }],
    allMembers: [
      { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 2 },
    ],
    mrs: [needsMeMr(1), needsMeMr(2)],
  };
  history.replaceState(null, '', '?slack=posted');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe(
      'Nothing found in slack · 2 items hidden'
    );
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a list the drafts chip trimmed says how many drafts it hid', async () => {
  servedData = {
    ...BOARD_DATA,
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: 3 }],
    allMembers: [
      { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 3 },
    ],
    mrs: [
      needsMeMr(1),
      { ...needsMeMr(2), isDraft: true },
      { ...needsMeMr(3), isDraft: true },
    ],
  };
  history.replaceState(null, '', '?drafts=hide');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    expect(container.querySelector('.tui-empty')).toBeNull();
    expect(
      container.querySelector('.tui-hidden-note')?.textContent?.trim()
    ).toBe('2 drafts hidden');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a list both chips trimmed names each count on one line', async () => {
  servedData = {
    ...BOARD_DATA,
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: 3 }],
    allMembers: [
      { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 3 },
    ],
    mrs: [
      { ...needsMeMr(1), slack: { posted: true, reactions: [] } },
      needsMeMr(2),
      {
        ...needsMeMr(3),
        isDraft: true,
        slack: { posted: true, reactions: [] },
      },
    ],
  };
  history.replaceState(null, '', '?slack=posted&drafts=hide');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    expect(
      container.querySelector('.tui-hidden-note')?.textContent?.trim()
    ).toBe('1 item hidden · 1 draft hidden');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
