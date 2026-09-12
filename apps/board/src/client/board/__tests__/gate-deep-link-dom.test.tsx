/** DOM-level regression test for the `?gate=<id>` deep link effect in
    Board.tsx: a real happy-dom document, a real Board render, and a real
    `history.replaceState` -- the bug this guards (an empty relative URL
    leaving `location.search` untouched) only reproduces against a real
    History API, not a hand-rolled stub. */

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

const BOARD_DATA = {
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
          status: 'open',
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
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(BOARD_DATA), { status: 200 });
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

test('a ?gate=<id> deep link scrolls to, flashes, and strips the matching row', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    // Flush the /data.json fetch's microtasks and the resulting setState.
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const row = container.querySelector('[data-mr-iid="1"]');
    expect(row).not.toBeNull();
    expect(scrolled[0] === row).toBe(true);
    expect(row?.classList.contains('tui-row-flash')).toBe(true);
    expect(window.location.search).toBe('');
  } finally {
    Element.prototype.scrollIntoView = original;
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
