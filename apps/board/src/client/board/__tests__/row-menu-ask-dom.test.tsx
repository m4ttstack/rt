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
let RowMenu: typeof import('../RowMenu.tsx').RowMenu;
type RowContext = import('../../types.ts').RowContext;
type BoardMR = import('../../../data.ts').BoardMR;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ RowMenu } = await import('../RowMenu.tsx'));
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';

function mrx(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return {
    iid: 1418,
    title: 'Port the flows',
    webUrl: URL,
    sourceBranch: 'f',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 0, given: 0, reviewers: [] },
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 0,
    ...over,
  } as never;
}

const ctx = {
  local: true,
  self: 'pat',
  slackTemplates: {},
  slackEnabled: false,
  onOpenReview: () => {},
  onOpenRespond: () => {},
  onOpenDraft: () => {},
  draftResolved: new Map(),
  onDismissLane: () => {},
  onEditNote: () => {},
} as unknown as RowContext;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let asked: Array<{ iid: number; reviewer: string }>;
let respondAsks: Array<{ iid: number; reviewer: string }>;

const noop = () => {};

async function render(
  mr: BoardMRWithReview,
  roster: string[],
  opts: { canNudge?: boolean; canAskRespond?: boolean } = {}
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root.render(
      <RowMenu
        menu={{ x: 10, y: 10, mr: mr as BoardMR }}
        ctx={ctx}
        onClose={noop}
        onLaunch={noop}
        onReReview={noop}
        onCopy={noop}
        onResolveSlack={noop}
        onReactSlack={async () => null}
        onPostSlack={noop}
        onRespond={noop}
        canRespond={true}
        onDoctor={noop}
        canDoctor={false}
        onDraftState={noop}
        canDraftState={true}
        onMrAction={noop}
        onRebaseLocal={noop}
        onNudge={noop}
        canNudge={opts.canNudge ?? true}
        onResumeReview={noop}
        roster={roster}
        onRequestReview={(mr2, reviewer) =>
          asked.push({ iid: mr2.iid, reviewer })
        }
        canAskRespond={opts.canAskRespond ?? false}
        onAskRespond={(mr2, reviewer) =>
          respondAsks.push({ iid: mr2.iid, reviewer })
        }
      />
    );
  });
}

beforeEach(() => {
  asked = [];
  respondAsks = [];
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

function itemByText(text: string): HTMLElement {
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  const hit = items.find(el => el.textContent?.includes(text));
  if (!hit) {
    throw new Error(
      `no menu item "${text}" in: ${items.map(el => el.textContent).join(' | ')}`
    );
  }
  return hit as HTMLElement;
}

test('own MR with free roster members offers the picker and fires the ask', async () => {
  await render(mrx(), ['pat', 'kim', 'jo']);
  const open = itemByText('request review from…');
  await React.act(async () => open.click());
  // Second stage lists only the free members -- never the author.
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    el => el.textContent
  );
  expect(items.some(t => t?.includes('pat'))).toBe(false);
  await React.act(async () => itemByText('kim').click());
  expect(asked).toEqual([{ iid: 1418, reviewer: 'kim' }]);
});

test('engaged peers and an outstanding ask hide the item', async () => {
  await render(
    mrx({
      peerReviews: [
        {
          mrUrl: URL,
          iid: 1418,
          reviewer: 'kim',
          status: 'reviewing',
          updatedAt: 1,
        },
        {
          mrUrl: URL,
          iid: 1418,
          reviewer: 'jo',
          status: 'done',
          outcome: 'comment',
          updatedAt: 1,
        },
      ],
    }),
    ['pat', 'kim', 'jo']
  );
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    el => el.textContent
  );
  expect(items.some(t => t?.includes('request review from'))).toBe(false);
});

test("a commented review on a teammate's MR offers the respond ask", async () => {
  await render(
    mrx({
      author: { username: 'kim', name: 'Kim' },
      review: { status: 'done', outcome: 'comment' },
    } as never),
    ['pat', 'kim'],
    { canNudge: false, canAskRespond: true }
  );
  await React.act(async () => itemByText("ask kim's agent to respond").click());
  expect(respondAsks).toEqual([{ iid: 1418, reviewer: 'kim' }]);
});

test('no respond ask without a commented review of mine', async () => {
  await render(
    mrx({ author: { username: 'kim', name: 'Kim' } } as never),
    ['pat', 'kim'],
    { canNudge: false, canAskRespond: true }
  );
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    el => el.textContent
  );
  expect(items.some(t => t?.includes('agent to respond'))).toBe(false);
});
