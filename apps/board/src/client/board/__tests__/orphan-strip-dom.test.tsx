/** DOM-level test for the executor dot and orphan strip (SDD
    executor-reconciler task 14): a real Board render, since the strip's
    "resume" affordance depends on Board's own queueEntries/queueExtras
    wiring (RowContext.queueExtras), not something a component-level test
    of RowView alone could exercise honestly. Mirrors
    attention-card-dom.test.tsx's real-Board-render pattern. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORPHAN = {
  agentId: 'agent-9',
  repo: null,
  subject: 'mr:gitlab.example.com/g/p/-/merge_requests/1',
  surface: 'terminal',
  sessionId: 'sess-9',
  paneRef: null,
  state: 'gone',
  since: 1000,
  openGateIds: [],
};

const ATTENTION_GATE = {
  gateId: 'g-attn',
  subject: 'agent:agent-9',
  kind: 'pane-attention',
  label: 'pane needs attention',
  status: 'open',
  openedAt: 1000,
  questions: [
    {
      id: 'action',
      label: 'Pane needs attention',
      multi: false,
      options: ['focus-pane', 'resume', 'clear', 'dismiss'],
    },
  ],
  meta: { agentId: 'agent-9', paneRef: null, reason: 'gone' },
};

function mr(overrides: Record<string, unknown>) {
  return {
    iid: 1,
    title: 'first mr title',
    webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
    author: { username: 'matt', name: 'Matthew Goodwin' },
    sourceBranch: 'b1',
    targetBranch: 'main',
    updatedAt: '2026-08-19T00:00:00Z',
    createdAt: '2026-08-19T00:00:00Z',
    reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
    blockers: { any: false },
    reviewerComments: 0,
    unresolvedThreads: 0,
    isDraft: false,
    pipelineState: 'none',
    repositoryId: 'gitlab:1',
    rtRepo: null,
    codeownerSections: [],
    gates: [],
    ...overrides,
  };
}

function boardData(overrides: Record<string, unknown>) {
  return {
    title: 'MRs ready for review',
    defaultMember: 'all',
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: 1 }],
    allMembers: [
      { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 1 },
    ],
    mrs: [],
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
    queueExtras: [],
    orphans: [],
    ...overrides,
  };
}

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let posts: Array<{ url: string; body: unknown }>;
let servedData: ReturnType<typeof boardData>;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  posts = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(servedData), { status: 200 });
    }
    if (url === '/gate/answer' || url === '/reconciler/clear') {
      posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function renderBoard(): Promise<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return { container, root };
}

test('a gone orphan renders an executor dot titled with the state', async () => {
  servedData = boardData({ mrs: [mr({ orphan: ORPHAN })] });
  const { container, root } = await renderBoard();
  try {
    const dot = container.querySelector('.tui-executor-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('data-executor-state')).toBe('gone');
    expect(dot?.getAttribute('title')).toContain('gone');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a gate stuck on delivery renders an executor dot titled "stuck", with no orphan', async () => {
  servedData = boardData({
    mrs: [
      mr({
        gates: [
          {
            gateId: 'g1',
            subject: 'mr:gitlab.example.com/g/p/-/merge_requests/1',
            kind: 'review-post',
            label: 'review',
            status: 'answered',
            openedAt: 1,
            questions: [],
            answers: { verdict: 'approve' },
            answeredBy: 'pane',
            answeredAt: 1,
            delivery: { outcome: 'stuck', at: 2 },
          },
        ],
      }),
    ],
  });
  const { container, root } = await renderBoard();
  try {
    const dot = container.querySelector('.tui-executor-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('data-executor-state')).toBe('stuck');
    expect(dot?.getAttribute('title')).toContain('stuck');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('no orphan, no stuck delivery: no executor dot', async () => {
  servedData = boardData({ mrs: [mr({})] });
  const { container, root } = await renderBoard();
  try {
    expect(container.querySelector('.tui-executor-dot')).toBeNull();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('an orphan with a queueExtras attention gate renders both resume and clear', async () => {
  servedData = boardData({
    mrs: [mr({ orphan: ORPHAN })],
    queueExtras: [ATTENTION_GATE],
  });
  const { container, root } = await renderBoard();
  try {
    const strip = container.querySelector('.tui-orphan-strip');
    expect(strip).not.toBeNull();
    expect(
      strip?.querySelector('[data-orphan-action="resume"]')
    ).not.toBeNull();
    expect(strip?.querySelector('[data-orphan-action="clear"]')).not.toBeNull();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('an orphan with no attention gate anywhere renders only clear', async () => {
  servedData = boardData({ mrs: [mr({ orphan: ORPHAN })] });
  const { container, root } = await renderBoard();
  try {
    const strip = container.querySelector('.tui-orphan-strip');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('[data-orphan-action="resume"]')).toBeNull();
    expect(strip?.querySelector('[data-orphan-action="clear"]')).not.toBeNull();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('clicking resume POSTs /gate/answer with { action: "resume" } for the attention gate', async () => {
  servedData = boardData({
    mrs: [mr({ orphan: ORPHAN })],
    queueExtras: [ATTENTION_GATE],
  });
  const { container, root } = await renderBoard();
  try {
    const resumeButton = container.querySelector(
      '[data-orphan-action="resume"]'
    ) as HTMLElement;
    expect(resumeButton).not.toBeNull();
    await React.act(async () => {
      resumeButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const answerPost = posts.find(p => p.url === '/gate/answer');
    expect(answerPost).toBeDefined();
    expect(answerPost!.body).toEqual({
      gateId: 'g-attn',
      answers: { action: 'resume' },
    });
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test("clicking clear POSTs /reconciler/clear with the orphan's agentId", async () => {
  servedData = boardData({ mrs: [mr({ orphan: ORPHAN })] });
  const { container, root } = await renderBoard();
  try {
    const clearButton = container.querySelector(
      '[data-orphan-action="clear"]'
    ) as HTMLElement;
    expect(clearButton).not.toBeNull();
    await React.act(async () => {
      clearButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const clearPost = posts.find(p => p.url === '/reconciler/clear');
    expect(clearPost).toBeDefined();
    expect(clearPost!.body).toEqual({ agentId: 'agent-9' });
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a stuck-delivery answered gate on the row renders the stuck message, click opens the queue with the retry face', async () => {
  servedData = boardData({
    mrs: [
      mr({
        gates: [
          {
            gateId: 'g-stuck',
            subject: 'mr:gitlab.example.com/g/p/-/merge_requests/1',
            kind: 'review-post',
            label: 'review',
            status: 'answered',
            openedAt: 1,
            questions: [
              {
                id: 'verdict',
                label: 'verdict?',
                multi: false,
                options: ['approve'],
              },
            ],
            answers: { verdict: 'approve' },
            answeredBy: 'pane',
            answeredAt: 1,
            delivery: { outcome: 'stuck', at: 2 },
            origin: { paneId: 'pane-1', worktree: 'widgets' },
          },
        ],
      }),
    ],
  });
  const { container, root } = await renderBoard();
  try {
    const chip = container.querySelector('[data-gate-delivery="stuck"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("pane didn't pick up the answer");

    await React.act(async () => {
      (chip as HTMLElement).click();
    });
    const dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    expect(
      dialog?.querySelector('[data-gate-delivery-state="stuck"]')
    ).not.toBeNull();
    const focusButton = [...dialog!.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'focus pane'
    );
    expect(focusButton).not.toBeUndefined();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('an unassigned-execution answered gate on the row opens the queue with a retry button that re-posts the recorded answers', async () => {
  servedData = boardData({
    mrs: [
      mr({
        gates: [
          {
            gateId: 'g-unassigned',
            subject: 'mr:gitlab.example.com/g/p/-/merge_requests/1',
            kind: 'review-post',
            label: 'review',
            status: 'answered',
            openedAt: 1,
            questions: [
              {
                id: 'verdict',
                label: 'verdict?',
                multi: false,
                options: ['approve'],
              },
            ],
            answers: { verdict: 'approve' },
            answeredBy: 'pane',
            answeredAt: 1,
            execution: 'unassigned',
          },
        ],
      }),
    ],
  });
  const { container, root } = await renderBoard();
  try {
    const chip = container.querySelector('[data-gate-execution="unassigned"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('answered, no pane to execute');

    await React.act(async () => {
      (chip as HTMLElement).click();
    });
    const dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    const retryButton = [...dialog!.querySelectorAll('button')].find(
      b => b.textContent?.trim() === 'retry'
    ) as HTMLElement;
    expect(retryButton).not.toBeUndefined();

    await React.act(async () => {
      retryButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const answerPost = posts.find(p => p.url === '/gate/answer');
    expect(answerPost).toBeDefined();
    expect(answerPost!.body).toEqual({
      gateId: 'g-unassigned',
      answers: { verdict: 'approve' },
    });
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
