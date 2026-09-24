/** A pipeline run's gate, served on the MR its run recorded, reads as that
    MR's decision on the real Board: the row says what is owed, the row's
    answer verb opens the stage sheet on the MR, the answer posts the run
    gate's own id, and an answer that lost to another surface says so. */

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

const RUN_GATE = {
  gateId: 'g-run-clarify',
  subject: 'run:20260923-090000-aaaa-1111',
  kind: 'clarify',
  label: 'clarify',
  status: 'open',
  openedAt: Date.now() - 60_000,
  context: 'The fix touches the login redirect.',
  origin: {
    presentation: 'form',
    paneId: 'pane-4',
    runId: '20260923-090000-aaaa-1111',
  },
  questions: [
    {
      id: 'verify',
      label: 'How should this be verified?',
      multi: false,
      options: [
        { value: 'push-ci', label: 'Push and let CI run' },
        { value: 'local', label: 'Run it locally first' },
      ],
    },
  ],
};

const boardData = () => ({
  title: 'MRs ready for review',
  defaultMember: 'all',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 1 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 1 },
  ],
  mrs: [
    {
      iid: 301,
      title: 'guard the login redirect',
      webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/301',
      author: { username: 'matt', name: 'Matthew Goodwin' },
      sourceBranch: 'guard-login-redirect',
      targetBranch: 'main',
      updatedAt: '2026-09-23T00:00:00Z',
      createdAt: '2026-09-23T00:00:00Z',
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
      gates: [RUN_GATE],
    },
  ],
  fetchedAt: 1790000000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: {
    single: '{title}: {url}',
    multiHeader: '{count} ready',
    multiItem: '- {title}',
  },
  dataSyncedAt: 1790000000000,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
});

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;
let posts: Array<{ url: string; body: unknown }>;
let answeredElsewhere: boolean;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json'))
      return new Response(JSON.stringify(boardData()), { status: 200 });
    posts.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: {
            ...RUN_GATE,
            id: RUN_GATE.gateId,
            status: 'answered',
            answer: {
              answers: { verify: 'local' },
              by: 'console',
              answeredAt: Date.now(),
            },
          },
        }),
        { status: 409 }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function renderBoard() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return {
    container,
    cleanup: async () => {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

test("the run gate's question sits on its MR's row with an answer verb", async () => {
  const { container, cleanup } = await renderBoard();
  try {
    const row = container.querySelector('[data-mr-iid="301"]')!;
    expect(row.textContent).toContain('how should this be verified?');
    expect(row.querySelector('[data-verb="answer"]')).not.toBeNull();
  } finally {
    await cleanup();
  }
});

test('answering from the row opens the stage sheet on the MR and posts the run gate id', async () => {
  const { container, cleanup } = await renderBoard();
  try {
    await click(
      container.querySelector('[data-mr-iid="301"] [data-verb="answer"]')
    );
    const sheet = document.body.querySelector('.tui-gate-sheet')!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector('.tui-mr-card')?.textContent).toContain(
      'guard the login redirect'
    );
    expect(
      sheet.querySelector('.tui-sheet-dock-heading')?.textContent?.trim()
    ).toBe('Answers on !301');

    await click(sheet.querySelector('input[value="push-ci"]'));
    await click(sheet.querySelector('.tui-sheet-submit'));
    expect(posts.filter(p => p.url === '/gate/answer')).toEqual([
      {
        url: '/gate/answer',
        body: { gateId: 'g-run-clarify', answers: { verify: 'push-ci' } },
      },
    ]);
  } finally {
    await cleanup();
  }
});

test('an answer that lost to another surface shows the winning answer and continue, not a failed submit', async () => {
  answeredElsewhere = true;
  const { container, cleanup } = await renderBoard();
  try {
    await click(
      container.querySelector('[data-mr-iid="301"] [data-verb="answer"]')
    );
    const sheet = document.body.querySelector('.tui-gate-sheet')!;
    await click(sheet.querySelector('input[value="push-ci"]'));
    await click(sheet.querySelector('.tui-sheet-submit'));

    const lost = sheet.querySelector('.tui-sheet-lost');
    expect(lost?.querySelector('.tui-gate-error')?.textContent).toBe(
      'answered elsewhere'
    );
    expect(lost?.textContent).toContain('Run it locally first');
    expect(
      [...(lost?.querySelectorAll('button') ?? [])].some(
        b => b.textContent?.trim() === 'continue'
      )
    ).toBe(true);
    expect(sheet.textContent).not.toContain('submit failed');
  } finally {
    await cleanup();
  }
});
