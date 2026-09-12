/** DOM-level test for the decision queue wired into Board.tsx: a real
    happy-dom document and a real Board render, covering the header entry
    point (`decision queue · N`) through open, skip, and close, and the
    row's own way in (the status line's answer verb on a stuck or unassigned
    gate) -- the wiring a component-level test of the queue hook or the
    modal alone can't exercise, since it depends on Board's own entries
    builder and the `rowContext.onOpenGate` hookup. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

// happy-dom has no EventSource; the board's SSE-push hook only needs one
// that can be constructed and closed without a real connection. `last`
// lets a test fire the push nudge that makes the board refetch.
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

// Same question id on both gates so a leaked selection from gate 1's form
// would land in a real field on gate 2's, not merely an absent one.
const VERDICT_QUESTIONS = [
  {
    id: 'verdict',
    label: 'Ready to merge?',
    multi: false,
    options: [
      { value: 'approve', label: 'Approve' },
      { value: 'changes', label: 'Request changes' },
    ],
  },
];

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'all',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 2 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 2 },
  ],
  mrs: [
    {
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
      gates: [
        {
          gateId: 'g1',
          subject: 'mr:gitlab.example.com/g/p/-/merge_requests/1',
          kind: 'review-post',
          label: 'review',
          status: 'open',
          openedAt: 1,
          questions: VERDICT_QUESTIONS,
          origin: { paneId: 'pane-1', worktree: 'widgets' },
        },
      ],
    },
    {
      iid: 2,
      title: 'second mr title',
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/2',
      author: { username: 'matt', name: 'Matthew Goodwin' },
      sourceBranch: 'b2',
      targetBranch: 'main',
      updatedAt: '2026-08-19T00:00:00Z',
      createdAt: '2026-08-19T00:00:00Z',
      reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
      blockers: { any: false },
      reviewerComments: 0,
      unresolvedThreads: 0,
      isDraft: false,
      pipelineState: 'none',
      repositoryId: 'gitlab:2',
      rtRepo: null,
      codeownerSections: [],
      gates: [
        {
          gateId: 'g2',
          subject: 'mr:gitlab.example.com/g/p/-/merge_requests/2',
          kind: 'self-review',
          label: 'self-review',
          status: 'open',
          openedAt: 2,
          questions: VERDICT_QUESTIONS,
          origin: { paneId: 'pane-2', worktree: 'widgets' },
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

// bun test shares one global realm across files: unregister() only restores
// what registration recorded, so the fetch stub and the EventSource property
// added afterwards must be rolled back by hand.
const realFetch = globalThis.fetch;

// Mutable so a test can serve a different snapshot mid-flight (the
// gate-less warm-up regression below), then restore it.
let servedData: Record<string, unknown> = BOARD_DATA;
let posts: Array<{ url: string; body: unknown }> = [];

beforeAll(async () => {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(servedData), { status: 200 });
    }
    if (url === '/gate/answer') {
      posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  // Dynamic, so it resolves only after GlobalRegistrator.register() above --
  // a static top-of-file import would run before that call and see no DOM.
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  posts = [];
  servedData = BOARD_DATA;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

/** The first MR alone, carrying one answered gate in the given state. */
function withAnsweredGate(gate: Record<string, unknown>) {
  const [first] = BOARD_DATA.mrs;
  return {
    ...BOARD_DATA,
    mrs: [
      {
        ...first,
        gates: [
          {
            gateId: 'g-answered',
            subject: first!.gates[0]!.subject,
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
            ...gate,
          },
        ],
      },
    ],
  };
}

function findByText(root: ParentNode, tag: string, text: string): Element {
  const found = [...root.querySelectorAll(tag)].find(
    el => el.textContent?.trim() === text
  );
  if (!found) throw new Error(`no <${tag}> with text "${text}"`);
  return found;
}

test('decision queue: header entry opens, skip advances, close dismisses', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    // Flush the /data.json fetch's microtasks and the resulting setState.
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const openButton = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.trim().startsWith('decision queue')
    );
    expect(openButton).not.toBeUndefined();
    expect(openButton?.textContent?.trim()).toBe('decision queue · 2');

    await React.act(async () => {
      (openButton as HTMLElement).click();
    });

    let dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('first mr title');

    const skipButton = findByText(dialog!, 'button', 'skip gate');
    await React.act(async () => {
      (skipButton as HTMLElement).click();
    });

    dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('second mr title');

    const closeButton = dialog!.querySelector('[aria-label="close"]');
    expect(closeButton).not.toBeNull();
    await React.act(async () => {
      (closeButton as HTMLElement).click();
    });

    dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).toBeNull();
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('decision queue: a gate-less snapshot (server warm-up) does not complete the open queue', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const openButton = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.trim().startsWith('decision queue')
    );
    await React.act(async () => {
      (openButton as HTMLElement).click();
    });

    let dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog?.textContent).toContain('first mr title');

    // A restarted board server briefly serves MRs with no gates while its
    // cache re-ingests; the SSE nudge makes the client refetch that snapshot.
    servedData = {
      ...BOARD_DATA,
      mrs: BOARD_DATA.mrs.map(mr => ({ ...mr, gates: [] })),
    };
    await React.act(async () => {
      FakeEventSource.last?.onmessage?.({} as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('first mr title');

    // The cache finishes warming; the same gates come back untouched.
    servedData = BOARD_DATA;
    await React.act(async () => {
      FakeEventSource.last?.onmessage?.({} as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog?.textContent).toContain('first mr title');
  } finally {
    servedData = BOARD_DATA;
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('decision queue: skipping a gate does not bleed its selection into the next', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const openButton = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.trim().startsWith('decision queue')
    );
    await React.act(async () => {
      (openButton as HTMLElement).click();
    });

    let dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog?.textContent).toContain('first mr title');

    const firstChoice = dialog!.querySelector(
      '.tui-gate-choice-input'
    ) as HTMLInputElement;
    expect(firstChoice).not.toBeNull();
    await React.act(async () => {
      firstChoice.click();
    });
    expect(firstChoice.checked).toBe(true);

    const skipButton = findByText(dialog!, 'button', 'skip gate');
    await React.act(async () => {
      (skipButton as HTMLElement).click();
    });

    dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog?.textContent).toContain('second mr title');
    expect(dialog!.querySelector('.tui-gate-choice-input:checked')).toBeNull();
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('a stuck-delivery gate: the row reads the stuck message and its answer verb opens the queue on the retry face', async () => {
  servedData = withAnsweredGate({
    delivery: { outcome: 'stuck', at: 2 },
    origin: { paneId: 'pane-1', worktree: 'widgets' },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const row = container.querySelector('[data-mr-iid="1"]')!;
    expect(row.querySelector('.tui-status-word')?.textContent).toBe(
      "pane didn't pick up the answer"
    );
    const verb = row.querySelector('button[data-verb="answer"]') as HTMLElement;
    expect(verb).not.toBeNull();
    expect(verb.textContent).toBe('retry');

    await React.act(async () => {
      verb.click();
    });
    const dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    expect(
      dialog?.querySelector('[data-gate-delivery-state="stuck"]')
    ).not.toBeNull();
    expect(findByText(dialog!, 'button', 'focus pane')).not.toBeNull();
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('an unassigned-execution gate: the row opens the queue, whose retry re-posts the recorded answers', async () => {
  servedData = withAnsweredGate({ execution: 'unassigned' });
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const row = container.querySelector('[data-mr-iid="1"]')!;
    expect(row.querySelector('.tui-status-word')?.textContent).toBe(
      'answered, no pane to execute'
    );
    const verb = row.querySelector('button[data-verb="answer"]') as HTMLElement;
    expect(verb.textContent).toBe('relaunch');

    await React.act(async () => {
      verb.click();
    });
    const dialog = container.querySelector(
      '[role="dialog"][aria-label="decision queue"]'
    );
    expect(dialog).not.toBeNull();
    const retryButton = findByText(dialog!, 'button', 'retry') as HTMLElement;

    await React.act(async () => {
      retryButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const answerPost = posts.find(p => p.url === '/gate/answer');
    expect(answerPost).toBeDefined();
    expect(answerPost!.body).toEqual({
      gateId: 'g-answered',
      answers: { verdict: 'approve' },
    });
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
