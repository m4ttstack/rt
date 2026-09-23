/** DOM-level regression tests for the `?gate=<id>` deep link effect in
    Board.tsx: a real happy-dom document, a real Board render, and a real
    `history.replaceState` -- the bug the strip assertion guards (an empty
    relative URL leaving `location.search` untouched) only reproduces
    against a real History API, not a hand-rolled stub.

    A gate still owed an answer opens the decision modal at that gate; an
    answered one degrades to the row scroll+flash. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/?gate=g1' });

// happy-dom has no EventSource; the board's SSE-push hook only needs one
// that can be constructed and closed without a real connection.
class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const boardData = (gateStatus: 'open' | 'answered') => ({
  title: 'MRs ready for review',
  defaultMember: 'all',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 1 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 1 },
  ],
  mrs: [
    {
      iid: 1,
      title: 'fix the thing',
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
      author: { username: 'matt', name: 'Matthew Goodwin' },
      sourceBranch: 'b',
      targetBranch: 'main',
      updatedAt: '2026-08-19T00:00:00Z',
      createdAt: '2026-08-19T00:00:00Z',
      reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
      blockers: { any: false },
      mergeButton: { visible: false, disabled: false, loading: false },
      autoMergeButton: { visible: false, isActive: false },
      reviewerComments: 0,
      unresolvedThreads: 0,
      isDraft: false,
      pipelineState: 'none',
      repositoryId: 'gitlab:1',
      rtRepo: null,
      codeownerSections: [],
      gates: [
        {
          gateId: 'g1',
          kind: 'review-post',
          label: 'review',
          status: gateStatus,
          openedAt: 1,
          questions: [],
        },
      ],
    },
  ],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
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
});

let currentData = boardData('open');

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(currentData), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  // Dynamic, so it resolves only after GlobalRegistrator.register() above --
  // a static top-of-file import would run before that call and see no DOM.
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function renderBoard(): Promise<{
  container: HTMLElement;
  scrolled: Element[];
  cleanup: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };

  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  // Flush the /data.json fetch's microtasks and the resulting setState.
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  return {
    container,
    scrolled,
    cleanup: async () => {
      Element.prototype.scrollIntoView = original;
      await React.act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('a ?gate=<id> deep link to a pending gate opens the decision modal and strips the param', async () => {
  currentData = boardData('open');
  const { container, scrolled, cleanup } = await renderBoard();
  try {
    // Every gate face renders in the one full-screen GateSheet frame.
    expect(container.querySelector('.tui-gate-sheet')).not.toBeNull();
    expect(window.location.search).toBe('');
    const row = container.querySelector('[data-mr-iid="1"]');
    expect(scrolled.length).toBe(0);
    expect(row?.classList.contains('tui-row-flash')).toBe(false);
  } finally {
    await cleanup();
  }
});

test('a ?gate=<id> deep link to an answered gate scrolls to, flashes, and strips the matching row', async () => {
  history.replaceState(null, '', '/?gate=g1');
  currentData = boardData('answered');
  const { container, scrolled, cleanup } = await renderBoard();
  try {
    const row = container.querySelector('[data-mr-iid="1"]');
    expect(row).not.toBeNull();
    expect(scrolled[0] === row).toBe(true);
    expect(row?.classList.contains('tui-row-flash')).toBe(true);
    expect(window.location.search).toBe('');
    expect(container.querySelector('.tui-gate-sheet')).toBeNull();
  } finally {
    await cleanup();
  }
});
