/** DOM-level test for the decision queue's non-MR section (task 13): a
    `queueExtras` pane-attention gate joins the same queue as MR gates, with
    no `mr` at all -- covering the sidebar count, the four-button attention
    face, its `/gate/answer` POST, and the escalated chip. Mirrors
    decision-queue-dom.test.tsx's real-Board-render pattern rather than
    mounting DecisionQueueModal alone, since Board's own queueEntries builder
    (not exercised by a component-level test) is exactly what's under test. */

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

const ATTENTION_GATE = {
  gateId: 'g-attn',
  subject: 'agent:pane-1',
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
  meta: { agentId: 'agent-1', paneRef: 'pane-1', reason: 'blocked' },
  context: 'last screen text from the pane',
  escalatedAt: 1234,
};

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'all',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
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
  queueExtras: [ATTENTION_GATE],
  orphans: [],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let posts: Array<{ url: string; body: unknown }>;

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
      return new Response(JSON.stringify(BOARD_DATA), { status: 200 });
    }
    if (url === '/gate/answer' || url === '/gate/focus') {
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

async function openQueue(container: HTMLElement) {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const openButton = [...container.querySelectorAll('button')].find(b =>
    b.textContent?.trim().startsWith('decision queue')
  );
  if (!openButton) throw new Error('no decision queue button rendered');
  await React.act(async () => {
    (openButton as HTMLElement).click();
  });
  const dialog = container.querySelector(
    '[role="dialog"][aria-label="decision queue"]'
  );
  if (!dialog) throw new Error('decision queue dialog did not open');
  return dialog;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    b => b.textContent?.trim() === text
  );
  if (!found) throw new Error(`no button with text "${text}"`);
  return found as HTMLButtonElement;
}

test('sidebar decision-queue count includes queueExtras', async () => {
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
    expect(openButton?.textContent?.trim()).toBe('decision queue · 1');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('a pane-attention queue entry renders the four attention actions and an escalated chip, with no MR strip', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    const dialog = await openQueue(container);

    expect(dialog.textContent).toContain('pane needs attention');
    expect(buttonByText(dialog, 'focus pane')).not.toBeNull();
    expect(buttonByText(dialog, 'resume')).not.toBeNull();
    expect(buttonByText(dialog, 'clear')).not.toBeNull();
    expect(buttonByText(dialog, 'dismiss')).not.toBeNull();

    // No MR strip: nothing that would only exist on an MR-attached card.
    expect(dialog.querySelector('.tui-mr-iid')).toBeNull();
    expect(dialog.querySelector('.tui-branch')).toBeNull();
    expect(dialog.textContent).toContain('agent:pane-1');

    expect(dialog.querySelector('[data-gate="escalated"]')).not.toBeNull();
    expect(dialog.textContent).toContain('escalated');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('clicking clear POSTs /gate/answer with { action: "clear" }', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    const dialog = await openQueue(container);

    const clearButton = buttonByText(dialog, 'clear');
    await React.act(async () => {
      clearButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const answerPost = posts.find(p => p.url === '/gate/answer');
    expect(answerPost).toBeDefined();
    expect(answerPost!.body).toEqual({
      gateId: 'g-attn',
      answers: { action: 'clear' },
    });
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
