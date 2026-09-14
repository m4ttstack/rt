/** DOM-level test for the empty-queue copy in Board.tsx: a real happy-dom
    document and a real Board render. The slack-filter-on empty state has to
    name the filter (not read as "this queue has no work"), because the
    posted-in-slack pick persists across tabs — including Needs me. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

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
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    el => el.textContent?.includes('Needs me')
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
  try {
    await renderBoard(container);
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('nothing waiting on review ✓');
  } finally {
    container.remove();
  }
});

test('an empty Needs me queue with the slack filter on names the filter', async () => {
  history.replaceState(null, '', '?slack=posted');
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    await renderBoard(container);
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('Nothing found in slack');
  } finally {
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
  try {
    await renderBoard(container);
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe(
      'Nothing found in slack · 2 items hidden'
    );
  } finally {
    container.remove();
  }
});
