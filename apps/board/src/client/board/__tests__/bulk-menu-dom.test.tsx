/** Board-level tests for the bulk menu: a real happy-dom document and a real
    Board render, with fetch faked. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'bun:test';

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

function boardMr(iid: number, over: Record<string, unknown> = {}) {
  return {
    iid,
    title: `mr ${iid}`,
    webUrl: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    author: { username: 'matt', name: 'Matt' },
    sourceBranch: `b${iid}`,
    targetBranch: 'main',
    updatedAt: '2026-08-19T00:00:00Z',
    createdAt: '2026-08-19T00:00:00Z',
    reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
    blockers: { any: false },
    mergeButton: { visible: true, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 2,
    isStacked: false,
    reviewerComments: 0,
    unresolvedThreads: 0,
    isDraft: false,
    pipelineState: 'none',
    repositoryId: `gitlab:${iid}`,
    rtRepo: null,
    codeownerSections: [],
    gates: [],
    ...over,
  };
}

const member = (username: string) => ({ username, name: username, count: 0 });
const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'matt',
  members: [member('matt'), member('kim'), member('jo')],
  allMembers: ['matt', 'kim', 'jo'].map(u => ({ ...member(u), hidden: false })),
  mrs: [
    boardMr(101),
    boardMr(102),
    boardMr(103, { isStacked: true, targetBranch: 'b101' }),
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
const realFetch = globalThis.fetch;
let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let root: ReturnType<typeof import('react-dom/client').createRoot>;
let container: HTMLDivElement;
// Reset to BOARD_DATA in beforeEach; a test that needs a different shape
// (a remote board, say) overrides it before calling renderBoard().
let servedData: typeof BOARD_DATA = BOARD_DATA;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'POST')
      posts.push({ url, body: JSON.parse(String(init.body)) });
    if (url.startsWith('/data.json'))
      return new Response(JSON.stringify(servedData), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  window.open = (() => null) as typeof window.open;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  posts = [];
  servedData = BOARD_DATA;
  localStorage.clear();
  history.replaceState(null, '', '/');
});

async function renderBoard() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await settle();
}

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function settle() {
  for (let i = 0; i < 3; i++)
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
}

function row(iid: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-mr-iid="${iid}"]`);
  if (!el) throw new Error(`no row !${iid}`);
  return el;
}

async function check(iid: number) {
  const box = row(iid).querySelector<HTMLElement>('[role="checkbox"]');
  if (!box) throw new Error(`no checkbox on !${iid}`);
  await React.act(async () => box.click());
}

async function rightClick(iid: number) {
  await React.act(async () => {
    row(iid).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      })
    );
  });
}

const menu = () => document.querySelector('[data-part="contextmenu"]');
const items = () => [
  ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];
async function click(text: string) {
  const hit = items().find(el => el.textContent?.includes(text));
  if (!hit)
    throw new Error(
      `no item "${text}" in ${items()
        .map(i => i.textContent)
        .join(' | ')}`
    );
  await React.act(async () => hit.click());
  await settle();
}

test('right-click on a checked row, two checked, opens the menu for the selection', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for 2 selected');
  expect(items().some(i => i.textContent === 'rebase on target')).toBe(true);
});

test('an action one checked MR cannot take is hidden', async () => {
  const unmergeable = boardMr(104, {
    mergeButton: { visible: false, disabled: false, loading: false },
  });
  servedData = { ...BOARD_DATA, mrs: [...BOARD_DATA.mrs, unmergeable] };
  await renderBoard();
  await check(101);
  await check(104);
  await rightClick(101);
  const texts = items().map(i => i.textContent);
  expect(texts).toContain('rebase on target');
  expect(texts.some(t => t?.startsWith('merge'))).toBe(false);
});

test('call doctor goes to the broken MR and the toast says who was skipped', async () => {
  const broken = boardMr(105, {
    blockers: { any: true, pipelineFailing: true },
  });
  servedData = { ...BOARD_DATA, mrs: [...BOARD_DATA.mrs, broken] };
  await renderBoard();
  await check(101);
  await check(105);
  await rightClick(105);
  await click('call doctor');
  expect(posts.filter(p => p.url === '/doctor').map(p => p.body.iid)).toEqual([
    105,
  ]);
  expect(document.body.textContent).toContain(
    "doctor called on !105 · 1 didn't need it"
  );
});

test('a selection no bulk action fits says so', async () => {
  const busy = (iid: number) =>
    boardMr(iid, {
      author: { username: 'kim', name: 'kim' },
      review: { status: 'reviewing' },
      behindTarget: 0,
      mergeButton: { visible: false, disabled: false, loading: false },
    });
  servedData = { ...BOARD_DATA, mrs: [busy(106), busy(107)] };
  history.replaceState(null, '', '/?member=all');
  await renderBoard();
  await check(106);
  await check(107);
  await rightClick(106);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for 2 selected');
  expect(items()).toEqual([]);
  expect(menu()?.querySelector('[aria-live="polite"]')?.textContent).toBe(
    'nothing fits all 2'
  );
});

test('right-click on an unchecked row opens its own menu', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(103);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !103');
});

test('right-click on the only checked row opens its own menu', async () => {
  await renderBoard();
  await check(101);
  await rightClick(101);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !101');
});

test('the actions button opens the same menu', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  const button = [
    ...container.querySelectorAll<HTMLElement>('.tui-selbar button'),
  ].find(b => b.textContent?.includes('actions'));
  if (!button) throw new Error('no actions button');
  await React.act(async () => button.click());
  expect(menu()?.getAttribute('aria-label')).toBe('actions for 2 selected');
});

test('a bulk rebase posts once per MR and speaks once', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  await click('rebase on target');
  expect(
    posts
      .filter(p => p.url === '/mr/action')
      .map(p => [p.body.iid, p.body.action])
  ).toEqual([
    [101, 'rebase'],
    [102, 'rebase'],
  ]);
  expect(document.body.textContent).toContain('rebase started on !101, !102');
});

test('a bulk rebase keeps the selection checked', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  await click('rebase on target');
  const bar = container.querySelector('.tui-selbar');
  expect(bar?.textContent).toContain('2 selected');
  const boxes = [101, 102].map(iid =>
    row(iid).querySelector<HTMLInputElement>('[role="checkbox"]')!
  );
  expect(boxes.every(b => b.getAttribute('aria-checked') === 'true')).toBe(
    true
  );
});

test('bulk merge arms on the first click and merges on the second', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  await click('merge');
  expect(posts.filter(p => p.url === '/mr/action')).toEqual([]);
  await click('really merge 2?');
  expect(
    posts.filter(p => p.url === '/mr/action').map(p => p.body.action)
  ).toEqual(['merge', 'merge']);
});

test('a checked child of an open MR blocks bulk merge with the reason', async () => {
  await renderBoard();
  await check(101);
  await check(103);
  await rightClick(101);
  const merge = items().find(i => i.textContent?.includes('blocked'));
  expect(merge?.textContent).toContain(
    '!103 sits on !101, which is still open'
  );
  expect(merge?.hasAttribute('disabled')).toBe(true);
  await React.act(async () => merge?.click());
  await settle();
  expect(posts.filter(p => p.url === '/mr/action')).toEqual([]);
});

test('the actions button with one checked row opens that row menu', async () => {
  await renderBoard();
  await check(102);
  const button = [
    ...container.querySelectorAll<HTMLElement>('.tui-selbar button'),
  ].find(b => b.textContent?.includes('actions'));
  if (!button) throw new Error('no actions button');
  await React.act(async () => button.click());
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !102');
});

test('an armed confirm disarms when its wording changes under it', async () => {
  await renderBoard();
  const { ActionMenu } = await import('../ActionMenu.tsx');
  const fired: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  const draw = (confirm: string) =>
    React.act(async () =>
      r.render(
        React.createElement(ActionMenu, {
          x: 0,
          y: 0,
          subject: '2 selected',
          entries: [
            {
              key: 'merge',
              section: 'gitlab',
              label: 'merge',
              glyph: null,
              confirm,
            },
          ],
          onRun: (key: string) => {
            fired.push(key);
          },
          onClose: () => {},
        })
      )
    );
  await draw('really merge 2?');
  await click('merge');
  expect(items().map(i => i.textContent)).toEqual(['really merge 2?']);
  await draw('really merge 3?');
  expect(items().map(i => i.textContent)).toEqual(['merge']);
  await click('merge');
  expect(fired).toEqual([]);
  await click('really merge 3?');
  expect(fired).toEqual(['merge']);
  await React.act(async () => r.unmount());
  host.remove();
});

test('request review from… asks the picked person on each MR', async () => {
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  await click('request review from…');
  await click('kim');
  expect(
    posts
      .filter(p => p.url === '/nudge')
      .map(p => [p.body.iid, p.body.reviewer])
  ).toEqual([
    [101, 'kim'],
    [102, 'kim'],
  ]);
});

test('a remote board opens the row menu on a checked row and has no actions button', async () => {
  servedData = { ...BOARD_DATA, local: false };
  await renderBoard();
  await check(101);
  await check(102);
  await rightClick(101);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !101');
  const button = [
    ...container.querySelectorAll<HTMLElement>('.tui-selbar button'),
  ].find(b => b.textContent?.includes('actions'));
  expect(button).toBeUndefined();
});
