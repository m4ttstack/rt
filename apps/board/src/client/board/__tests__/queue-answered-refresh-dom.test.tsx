/** Answering the last queued gate and closing the recap leaves the board
    showing the answer: the board re-pulls its data after the answer lands,
    or after continuing past an answer that lost to another surface, so the
    sidebar's queue button goes and nothing reopens the gate. No SSE frame
    fires here, so the re-pull has to come from the answer itself. */

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

const GATE = {
  gateId: 'g-verify',
  subject: 'mr:https://gitlab.example.com/acme/webapp/-/merge_requests/301',
  kind: 'clarify',
  label: 'clarify',
  openedAt: Date.now() - 60_000,
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

const boardData = (answered: boolean) => ({
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
      gates: [
        answered
          ? {
              ...GATE,
              status: 'answered',
              answers: { verify: 'push-ci' },
              answeredBy: 'board',
              answeredAt: Date.now(),
            }
          : { ...GATE, status: 'open' },
      ],
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
let serverAnswered: boolean;
let answeredElsewhere: boolean;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  localStorage.clear();
  serverAnswered = false;
  answeredElsewhere = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json'))
      return new Response(JSON.stringify(boardData(serverAnswered)), {
        status: 200,
      });
    if (url === '/gate/answer') serverAnswered = true;
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: {
            ...GATE,
            id: GATE.gateId,
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

async function settle() {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

const queueButton = (container: HTMLElement) =>
  container.querySelector('.tui-dq-open');

async function answerThenClose(finish: () => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await settle();
  try {
    expect(queueButton(container)?.textContent).toContain('decision queue · 1');

    await click(queueButton(container));
    const sheet = document.body.querySelector('.tui-gate-sheet')!;
    await click(sheet.querySelector('input[value="push-ci"]'));
    await click(sheet.querySelector('.tui-sheet-submit'));
    await finish();
    await click(document.body.querySelector('.tui-triage-done-action'));

    expect(queueButton(container)).toBeNull();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
}

test('the answered gate leaves the queue once the recap closes', async () => {
  await answerThenClose(async () => {});
});

test('a gate answered elsewhere leaves the queue once continue and the recap close', async () => {
  answeredElsewhere = true;
  await answerThenClose(async () => {
    const lost = document.body.querySelector('.tui-sheet-lost');
    await click(
      [...(lost?.querySelectorAll('button') ?? [])].find(
        b => b.textContent?.trim() === 'continue'
      )
    );
  });
});
