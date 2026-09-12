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
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RowView: typeof import('../RowView.tsx').RowView;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;

// The comments drawer fetches its threads on mount; the stub keeps that off
// the network so opening it from the thread link is a pure DOM assertion.
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify({ threads: [], comments: [] }), {
      status: 200,
    })) as typeof fetch;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ RowView } = await import('../RowView.tsx'));
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

const NOW = Date.parse('2026-09-12T12:00:00Z');
const URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';

function mr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: URL,
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 1, given: 0, reviewers: [] },
    reviewerComments: 0,
    diff: { additions: 1455, deletions: 13, filesChanged: 4 },
    updatedAt: new Date(NOW - 32 * 3600_000).toISOString(),
    threadSummary: { awaiting: 1, replied: 0, resolved: 0 },
    generalComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: null,
    isDraft: false,
    codeownerSections: [],
    gates: [],
    ...over,
  } as unknown as BoardMRWithReview;
}

function ctx(over: Partial<RowContext> = {}): RowContext {
  const noop = () => {};
  return {
    local: true,
    slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
    slackEnabled: true,
    onContext: noop,
    onOpenReview: noop,
    onOpenRespond: noop,
    onOpenDraft: noop,
    draftResolved: new Map(),
    onResumeRespond: noop,
    onFocusPane: noop,
    onOpenGate: noop,
    selected: new Set(),
    onToggleSelect: noop,
    onClearOrphan: noop,
    onLaunch: noop,
    onReReview: noop,
    onRespond: noop,
    onDoctor: noop,
    ...over,
  } as RowContext;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(rows: BoardMRWithReview[], c = ctx()) {
  await React.act(async () => {
    root.render(<RowView mrs={rows} now={NOW} showAuthor={false} ctx={c} />);
  });
}

test('a quiet row: three lines, no bar, no separator glyphs, all-clear status', async () => {
  await render([mr()]);
  const row = container.querySelector('.tui-row')!;
  expect(row.querySelector('.tui-row-bar')).toBeNull();
  expect(row.getAttribute('data-tone')).toBeNull();
  expect(row.querySelector('.tui-mr-iid')!.textContent).toBe('!1418');
  expect(row.querySelector('.tui-branch')!.textContent).toBe(
    'feature/acme-2214'
  );
  expect(row.querySelector('.tui-diff')!.textContent).toBe('+1455 −13');
  expect(row.querySelector('.tui-threads')!.textContent).toBe('1 thread');
  expect(row.querySelector('.tui-age')!.textContent).toBe('32h');
  expect(row.querySelector('.tui-status')!.getAttribute('data-tone')).toBe(
    'clear'
  );
  expect(row.textContent).not.toContain('·');
  expect(row.textContent).not.toContain('|');
  expect(row.querySelector('.tui-row-sep')).toBeNull();
});

test('an interrupted review paints the warn bar and tone on the row', async () => {
  await render([
    mr({
      review: { status: 'reviewing', sessionId: 'sess-1' },
      orphan: {
        agentId: 'ag-1',
        repo: null,
        subject: 'agent:ag-1',
        surface: 'herdr',
        sessionId: 'sess-1',
        paneRef: null,
        state: 'gone',
        since: NOW - 60_000,
        openGateIds: [],
      },
    }),
  ]);
  const row = container.querySelector('.tui-row')!;
  expect(row.getAttribute('data-tone')).toBe('warn');
  expect(row.querySelector('.tui-row-bar')!.getAttribute('data-tone')).toBe(
    'warn'
  );
  expect(row.querySelector('.tui-status-word')!.textContent).toBe(
    'review interrupted'
  );
  expect(row.querySelector('button[data-verb="relaunch"]')).not.toBeNull();
  expect(row.querySelector('button[data-verb="clear"]')).not.toBeNull();
});

test('the slack ladder: logo only once posted, stage mark for the furthest reaction', async () => {
  await render([
    mr({ slack: { status: 'found', reactions: [], posted: false } }),
  ]);
  expect(
    container.querySelector('.tui-row-marks [data-slack-logo]')
  ).toBeNull();
  await render([
    mr({
      slack: {
        status: 'found',
        reactions: ['eyes', 'white_check_mark'],
        posted: true,
      },
    }),
  ]);
  const marks = container.querySelector('.tui-row-marks')!;
  expect(
    marks.querySelector('[data-slack-stage]')!.getAttribute('data-slack-stage')
  ).toBe('approved');
  expect(marks.querySelector('[data-slack-logo]')).not.toBeNull();
});

test('thread newness: the first sighting records a baseline, growth lights the link, opening the drawer clears it', async () => {
  await render([
    mr({ threadSummary: { awaiting: 3, replied: 0, resolved: 0 } }),
  ]);
  expect(
    container.querySelector('.tui-threads')!.getAttribute('data-new')
  ).toBeNull();
  expect(localStorage.getItem(`board.threads.seen:${URL}`)).toBe('3');

  await render([
    mr({ threadSummary: { awaiting: 5, replied: 0, resolved: 0 } }),
  ]);
  const link = container.querySelector<HTMLButtonElement>('.tui-threads')!;
  expect(link.getAttribute('data-new')).toBe('true');
  expect(link.getAttribute('title')).toBe('2 new since you last looked');

  await React.act(async () => link.click());
  expect(localStorage.getItem(`board.threads.seen:${URL}`)).toBe('5');
  expect(
    container.querySelector(
      '[data-part="sidedrawer"][aria-label="comment threads"]'
    )
  ).not.toBeNull();
  // Settles on the click itself, before any board render carries the new
  // baseline back into `fresh`.
  const settled = container.querySelector<HTMLButtonElement>('.tui-threads')!;
  expect(settled.getAttribute('data-new')).toBeNull();
  expect(settled.getAttribute('title')).toBe('open the comments drawer');

  await render([
    mr({ threadSummary: { awaiting: 7, replied: 0, resolved: 0 } }),
  ]);
  expect(
    container.querySelector('.tui-threads')!.getAttribute('data-new')
  ).toBe('true');
});

test('a thread count that shrinks lowers the baseline instead of holding the old one', async () => {
  await render([
    mr({ threadSummary: { awaiting: 5, replied: 0, resolved: 0 } }),
  ]);
  await render([
    mr({ threadSummary: { awaiting: 3, replied: 0, resolved: 0 } }),
  ]);
  expect(
    container.querySelector('.tui-threads')!.getAttribute('data-new')
  ).toBeNull();
  expect(localStorage.getItem(`board.threads.seen:${URL}`)).toBe('3');
  await render([
    mr({ threadSummary: { awaiting: 4, replied: 0, resolved: 0 } }),
  ]);
  expect(
    container.querySelector('.tui-threads')!.getAttribute('data-new')
  ).toBe('true');
});

test('mechanical flags share the state line with the pill; the title stands alone', async () => {
  await render([
    mr({
      blockers: { any: true, hasConflicts: true, pipelineFailing: false },
    } as never),
  ]);
  const row = container.querySelector('.tui-row')!;
  expect(row.querySelector('.tui-row-review')).toBeNull();
  expect(
    row.querySelector('.tui-row-0 .tui-row-flags [data-flag]')
  ).not.toBeNull();
  expect(row.querySelector('.tui-row-0 .tui-phrase')).not.toBeNull();
  expect(row.querySelector('.tui-row-1')!.children).toHaveLength(1);
  expect(row.querySelector('.tui-row-1 .tui-title')).not.toBeNull();
});

test('the state pill carries the merge blockers in its tooltip', async () => {
  await render([
    mr({
      blockers: { any: true, hasConflicts: true, awaitingApprovals: true },
    } as never),
  ]);
  const pill = container.querySelector('.tui-phrase')!;
  expect(pill.getAttribute('title')).toBe(
    'blocked:\n· merge conflicts with target branch\n· awaiting approvals (0/1)'
  );
  await render([mr()]);
  expect(container.querySelector('.tui-phrase')!.getAttribute('title')).toBe(
    'ready to merge'
  );
});

test('a row with no webUrl renders, records no seen count and lights no thread link', async () => {
  await render([
    mr({
      webUrl: null,
      threadSummary: { awaiting: 3, replied: 0, resolved: 0 },
    } as never),
  ]);
  const row = container.querySelector('.tui-row')!;
  expect(row.querySelector('.tui-title')!.textContent).toBe(
    'ACME-2214 Port the v2 quiet-mode flows'
  );
  expect(row.querySelector('[data-part="selectbox"]')).toBeNull();
  const link = row.querySelector('.tui-threads')!;
  expect(link.textContent).toBe('3 threads');
  expect(link.getAttribute('data-new')).toBeNull();
  expect(localStorage.length).toBe(0);
  await React.act(async () => (link as HTMLButtonElement).click());
  expect(localStorage.length).toBe(0);
});

test('selection mode marks the list so the gutter checkboxes show at rest', async () => {
  await render([mr()], ctx({ selected: new Set([URL]) }));
  expect(
    container.querySelector('.tui-rows')!.getAttribute('data-selecting')
  ).toBe('true');
});
