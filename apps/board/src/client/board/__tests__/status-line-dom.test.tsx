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
let StatusLine: typeof import('../StatusLine.tsx').StatusLine;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;
type RowStatus = import('../row-status.ts').RowStatus;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ StatusLine } = await import('../StatusLine.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const MR = {
  iid: 1418,
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
  gates: [],
} as unknown as BoardMRWithReview;

function ctx(over: Partial<RowContext> = {}): RowContext {
  const noop = () => {};
  return {
    local: true,
    slackTemplates: { single: '', multiHeader: '', multiItem: '' },
    slackEnabled: false,
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(status: RowStatus, c: RowContext) {
  await React.act(async () => {
    root.render(<StatusLine mr={MR} status={status} ctx={c} />);
  });
}

test('a hot line renders its word, detail, and the primary verb; the secondary verb is marked hover-only', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'review interrupted',
        detail: 'pane closed 12m ago',
        verbs: [
          { kind: 'relaunch', label: 'relaunch', domain: 'review' },
          { kind: 'clear', label: 'clear', agentId: 'ag-1' },
        ],
      },
      more: [],
      bar: 'warn',
    },
    ctx({
      onFocusPane: (_mr, domain) => calls.push(`focus:${domain}`),
      onClearOrphan: id => calls.push(`clear:${id}`),
    })
  );
  const line = container.querySelector('.tui-status')!;
  expect(line.getAttribute('data-tone')).toBe('warn');
  expect(line.querySelector('.tui-status-word')!.textContent).toBe(
    'review interrupted'
  );
  expect(line.querySelector('.tui-status-detail')!.textContent).toBe(
    'pane closed 12m ago'
  );
  const verbs = [
    ...line.querySelectorAll<HTMLButtonElement>('button[data-verb]'),
  ];
  expect(verbs.map(v => v.dataset.verb)).toEqual(['relaunch', 'clear']);
  expect(verbs[0]!.dataset.secondary).toBeUndefined();
  expect(verbs[1]!.dataset.secondary).toBe('true');
  await React.act(async () => verbs[0]!.click());
  await React.act(async () => verbs[1]!.click());
  expect(calls).toEqual(['focus:review', 'clear:ag-1']);
});

test('a focus verb carries its lane to onFocusPane', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'work',
        word: 'fixing…',
        spin: true,
        verbs: [{ kind: 'focus', label: 'focus', domain: 'doctor' }],
      },
      more: [],
      bar: null,
    },
    ctx({ onFocusPane: (m, domain) => calls.push(`${m.iid}:${domain}`) })
  );
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[data-verb="focus"]')!
      .click()
  );
  expect(calls).toEqual(['1418:doctor']);
});

test('a working line renders the spinner ring, not a dot', async () => {
  await render(
    {
      line: { tone: 'work', word: 'review running…', spin: true, verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  expect(container.querySelector('.tui-status-ring')).not.toBeNull();
});

test('an answer verb opens the queue on its gate', async () => {
  const opened: string[] = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'post which findings?',
        verbs: [{ kind: 'answer', label: 'answer', gateId: 'g1' }],
      },
      more: [],
      bar: 'warn',
    },
    ctx({ onOpenGate: id => opened.push(id) })
  );
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[data-verb="answer"]')!
      .click()
  );
  expect(opened).toEqual(['g1']);
});

test('the all-clear line puts the word first and the sun leading the detail, with an open verb', async () => {
  await render(
    {
      line: {
        tone: 'clear',
        word: 'all clear',
        detail: 'enjoy the sunshine',
        verbs: [{ kind: 'open-mr', label: 'open ↗' }],
      },
      more: [],
      bar: null,
    },
    ctx()
  );
  const line = container.querySelector('.tui-status[data-tone="clear"]')!;
  const word = line.querySelector('.tui-status-word')!;
  expect(word.textContent).toBe('all clear');
  expect(word.querySelector('svg')).toBeNull();
  const detail = line.querySelector('.tui-status-detail')!;
  expect(detail.firstElementChild!.tagName.toLowerCase()).toBe('svg');
  expect(detail.textContent).toBe(' enjoy the sunshine');
  expect(
    container.querySelector('button[data-verb="open-mr"]')!.textContent
  ).toBe('open ↗');
});

test('suppressed candidates render as +N active with their words in the title', async () => {
  await render(
    {
      line: { tone: 'warn', word: 'post which findings?', verbs: [] },
      more: [
        { tone: 'work', word: 'implementing…', verbs: [] },
        { tone: 'work', word: 'watching CI…', verbs: [] },
      ],
      bar: 'warn',
    },
    ctx()
  );
  const more = container.querySelector('.tui-status-more')!;
  expect(more.textContent).toBe('+2 active');
  expect(more.getAttribute('title')).toBe('implementing…, watching CI…');
});

test('a long detail renders its first clause and keeps the whole message as the tooltip', async () => {
  const full =
    'rebased acme-2214 onto origin/main (pat); resolved Overview.test.tsx conflict (kept both sides)';
  await render(
    {
      line: { tone: 'go', word: 'diagnosed', detail: full, verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  const detail = container.querySelector('.tui-status-detail')!;
  expect(detail.textContent).toBe('rebased acme-2214 onto origin/main');
  expect(detail.getAttribute('title')).toBe(full);
  await render(
    {
      line: { tone: 'go', word: 'diagnosed', detail: 'short', verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  expect(
    container.querySelector('.tui-status-detail')!.getAttribute('title')
  ).toBeNull();
});
