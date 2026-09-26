/** Board-level tests for the comments drawer: a real happy-dom document and a
    real Board render, with fetch faked. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
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

const MR_URL = 'https://gitlab.example.com/g/p/-/merge_requests/101';

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'matt', count: 0 }],
  allMembers: [{ username: 'matt', name: 'matt', count: 0, hidden: false }],
  mrs: [
    {
      iid: 101,
      title: 'mr 101',
      webUrl: MR_URL,
      author: { username: 'matt', name: 'Matt' },
      sourceBranch: 'b101',
      targetBranch: 'main',
      updatedAt: '2026-08-19T00:00:00Z',
      createdAt: '2026-08-19T00:00:00Z',
      reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
      blockers: { any: false },
      mergeButton: { visible: false, disabled: false, loading: false },
      rebaseButton: { visible: false, loading: false },
      autoMergeButton: { visible: false, isActive: false },
      behindTarget: null,
      isStacked: false,
      reviewerComments: 1,
      threadSummary: { awaiting: 1, replied: 0, resolved: 0 },
      generalComments: 0,
      isDraft: false,
      pipelineState: 'none',
      repositoryId: 'gitlab:101',
      rtRepo: 'gitlab.example.com/g/p',
      codeownerSections: [],
      gates: [],
    },
  ],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
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

const note = (id: number, username: string, body: string) => ({
  id,
  name: username,
  username,
  at: '2026-08-19T00:00:00Z',
  body,
});
const threadA = {
  discussionId: 'dA',
  status: 'awaiting',
  notes: [note(9001, 'kim', 'rename this')],
};
const threadB = {
  discussionId: 'dB',
  status: 'awaiting',
  notes: [note(9002, 'jo', 'add a test')],
};
const DISCUSSIONS = { threads: [threadA, threadB], comments: [] };
const THREAD_ADDRESS = {
  repo: 'gitlab.example.com/g/p',
  iid: 101,
  author: 'matt',
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;
const realFetch = globalThis.fetch;
let root: ReturnType<typeof import('react-dom/client').createRoot>;
let container: HTMLDivElement;
// Reset in beforeEach; a test swaps in what the board serves and how the
// thread-write routes answer.
let servedData: Record<string, unknown> = BOARD_DATA;
let servedDiscussions: Record<string, unknown> = DISCUSSIONS;
let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let writeAnswer: (url: string, body: Record<string, unknown>) => Response;
let readAnswer: () => Response | Promise<Response>;
let reads = 0;
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) return json(servedData);
    if (init?.method === 'POST' && url.startsWith('/discussions/')) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      return writeAnswer(url, body);
    }
    if (url.startsWith('/discussions')) {
      reads++;
      return readAnswer();
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  window.open = (() => null) as typeof window.open;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  servedData = BOARD_DATA;
  servedDiscussions = DISCUSSIONS;
  posts = [];
  writeAnswer = () => json(DISCUSSIONS);
  readAnswer = () => json(servedDiscussions);
  reads = 0;
});

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

async function renderBoardWithDrawerOpen(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await settle();
  const link = container.querySelector<HTMLButtonElement>(
    '[data-mr-iid="101"] .tui-threads'
  );
  if (!link) throw new Error('no threads link on !101');
  await React.act(async () => link.click());
  await settle();
  const drawer = document.querySelector<HTMLElement>(
    '[data-part="sidedrawer"][aria-label="comment threads"]'
  );
  if (!drawer) throw new Error('comments drawer did not open');
  return drawer;
}

async function rightClick(el: Element): Promise<MouseEvent> {
  const ev = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 40,
  });
  await React.act(async () => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const rowMenu = () => document.querySelector('[data-part="contextmenu"]');

test('a right-click inside the comments drawer keeps the native menu and opens no row menu', async () => {
  const drawer = await renderBoardWithDrawerOpen();
  const note = drawer.querySelector('.tui-cd-note-body');
  if (!note) throw new Error('drawer rendered no note body');
  const ev = await rightClick(note);
  expect(rowMenu()).toBeNull();
  expect(ev.defaultPrevented).toBe(false);
});

test('a right-click on the drawer scrim opens no row menu', async () => {
  await renderBoardWithDrawerOpen();
  const scrim = document.querySelector('[data-part="sidedrawer-overlay"]');
  if (!scrim) throw new Error('no drawer overlay');
  await rightClick(scrim);
  expect(rowMenu()).toBeNull();
});

test('a click on the drawer scrim closes the drawer without opening the MR', async () => {
  let opened = 0;
  window.open = (() => {
    opened++;
    return null;
  }) as typeof window.open;
  await renderBoardWithDrawerOpen();
  const scrim = document.querySelector<HTMLElement>(
    '[data-part="sidedrawer-overlay"]'
  );
  if (!scrim) throw new Error('no drawer overlay');
  await React.act(async () => scrim.click());
  expect(document.querySelector('[data-part="sidedrawer"]')).toBeNull();
  expect(opened).toBe(0);
});

test('a right-click on the row itself still opens the row menu', async () => {
  await renderBoardWithDrawerOpen();
  const closeBtn = document.querySelector<HTMLElement>(
    '[data-part="sidedrawer"] .tui-modal-x'
  );
  await React.act(async () => closeBtn!.click());
  await rightClick(container.querySelector('[data-mr-iid="101"]')!);
  expect(rowMenu()).not.toBeNull();
});

// ── reply and resolve ───────────────────────────────────────────────────────

function thread(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-part="sidedrawer"] [data-discussion-id="${id}"]`
  );
  if (!el) throw new Error(`no thread ${id} in the drawer`);
  return el;
}

const threadOrder = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-part="sidedrawer"] [data-discussion-id]'
    ),
  ].map(el => el.getAttribute('data-discussion-id'));

function buttonIn(scope: HTMLElement, label: string): HTMLButtonElement {
  const hit = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    b => b.textContent?.trim() === label
  );
  if (!hit)
    throw new Error(
      `no "${label}" button in ${[...scope.querySelectorAll('button')]
        .map(b => b.textContent?.trim())
        .join(' | ')}`
    );
  return hit;
}

async function press(scope: HTMLElement, label: string) {
  await React.act(async () => buttonIn(scope, label).click());
  await settle();
}

const replyBox = (id: string) =>
  thread(id).querySelector<HTMLTextAreaElement>('textarea');

async function type(box: HTMLTextAreaElement, text: string) {
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(box: HTMLTextAreaElement, init: KeyboardEventInit) {
  await React.act(async () => {
    box.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
  await settle();
}

const replied = {
  ...threadA,
  status: 'replied',
  notes: [...threadA.notes, note(9003, 'matt', 'renamed in the next push')],
};

test('reply posts the typed text to that thread and shows the refreshed thread', async () => {
  writeAnswer = () => json({ threads: [replied, threadB], comments: [] });
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'renamed in the next push');
  await press(thread('dA'), 'send');
  expect(posts).toEqual([
    {
      url: '/discussions/reply',
      body: {
        ...THREAD_ADDRESS,
        discussionId: 'dA',
        body: 'renamed in the next push',
      },
    },
  ]);
  expect(thread('dA').textContent).toContain('renamed in the next push');
  expect(replyBox('dA')).toBeNull();
});

test('two sends in the same instant post the reply once', async () => {
  writeAnswer = () => json({ threads: [replied, threadB], comments: [] });
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'renamed in the next push');
  const box = replyBox('dA')!;
  await React.act(async () => {
    for (let i = 0; i < 2; i++)
      box.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
        })
      );
  });
  await settle();
  expect(posts.map(p => p.url)).toEqual(['/discussions/reply']);
});

test('⌘↵ in the reply box sends; a plain ↵ does not', async () => {
  writeAnswer = () => json({ threads: [replied, threadB], comments: [] });
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'renamed in the next push');
  await key(replyBox('dA')!, { key: 'Enter' });
  expect(posts).toEqual([]);
  await key(replyBox('dA')!, { key: 'Enter', metaKey: true });
  expect(posts.map(p => p.url)).toEqual(['/discussions/reply']);
});

test('send & resolve replies first, then resolves the same thread', async () => {
  const resolved = { ...replied, status: 'resolved' };
  writeAnswer = url =>
    json({
      threads: url.endsWith('/reply')
        ? [replied, threadB]
        : [threadB, resolved],
      comments: [],
    });
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'renamed in the next push');
  await press(thread('dA'), 'send & resolve');
  expect(posts.map(p => [p.url, p.body.discussionId, p.body.resolved])).toEqual(
    [
      ['/discussions/reply', 'dA', undefined],
      ['/discussions/resolve', 'dA', true],
    ]
  );
  expect(thread('dA').classList.contains('resolved')).toBe(true);
});

test('resolving a thread keeps its place in the drawer and offers unresolve', async () => {
  writeAnswer = () =>
    json({
      threads: [threadB, { ...threadA, status: 'resolved' }],
      comments: [],
    });
  await renderBoardWithDrawerOpen();
  expect(threadOrder()).toEqual(['dA', 'dB']);
  await press(thread('dA'), 'resolve');
  expect(posts).toEqual([
    {
      url: '/discussions/resolve',
      body: { ...THREAD_ADDRESS, discussionId: 'dA', resolved: true },
    },
  ]);
  expect(threadOrder()).toEqual(['dA', 'dB']);
  expect(thread('dA').classList.contains('resolved')).toBe(true);
  buttonIn(thread('dA'), 'unresolve');
});

test('Escape closes the reply box, not the drawer, and the draft is there on reopen', async () => {
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'half a thought');
  await key(replyBox('dA')!, { key: 'Escape' });
  expect(replyBox('dA')).toBeNull();
  expect(document.querySelector('[data-part="sidedrawer"]')).not.toBeNull();
  await press(thread('dA'), 'reply');
  expect(replyBox('dA')!.value).toBe('half a thought');
});

test("a failed send keeps the typed text and shows the server's error", async () => {
  writeAnswer = () => json({ ok: false, error: '403 Forbidden' }, 502);
  await renderBoardWithDrawerOpen();
  await press(thread('dA'), 'reply');
  await type(replyBox('dA')!, 'renamed in the next push');
  await press(thread('dA'), 'send');
  expect(replyBox('dA')!.value).toBe('renamed in the next push');
  expect(thread('dA').querySelector('[role="alert"]')!.textContent).toContain(
    '403 Forbidden'
  );
});

test('a remote board shows the threads with no reply or resolve controls', async () => {
  servedData = { ...BOARD_DATA, local: false };
  await renderBoardWithDrawerOpen();
  const labels = [...thread('dA').querySelectorAll('button')].map(b =>
    b.textContent?.trim()
  );
  expect(labels).not.toContain('reply');
  expect(labels).not.toContain('resolve');
});

// ── long notes ──────────────────────────────────────────────────────────────

describe('long notes', () => {
  // happy-dom has no layout, so the note's clamp box reports the heights a
  // browser would: a long body overflows the cap while collapsed, a short one
  // fits. Every other element keeps happy-dom's own answer.
  const CAP = 226;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const inherited = (name: string) => {
    for (
      let p: object | null = Object.getPrototypeOf(HTMLElement.prototype);
      p;
      p = Object.getPrototypeOf(p)
    ) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d) return d;
    }
    return undefined;
  };
  const natural = (el: HTMLElement) =>
    (el.textContent?.length ?? 0) > 500 ? 900 : 60;
  beforeAll(() => {
    const stubs: Record<string, (el: HTMLElement) => number> = {
      scrollHeight: natural,
      clientHeight: el =>
        el.getAttribute('data-clamped') === 'true'
          ? Math.min(CAP, natural(el))
          : natural(el),
    };
    for (const [name, height] of Object.entries(stubs)) {
      saved.set(
        name,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
      );
      const fallback = inherited(name);
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('tui-cd-note-clamp')
            ? height(this)
            : (fallback?.get?.call(this) ?? 0);
        },
      });
    }
  });
  afterAll(() => {
    for (const [name, d] of saved) {
      if (d) Object.defineProperty(HTMLElement.prototype, name, d);
      else
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
    }
  });

  const LONG =
    'This review walks every call site of the resolver before it settles. '.repeat(
      20
    );
  const clampOf = (id: string) =>
    thread(id).querySelector<HTMLElement>('.tui-cd-note-clamp')!;

  test('a long note is capped, and "show more" opens it whole, then "show less" caps it again', async () => {
    servedDiscussions = {
      threads: [{ ...threadA, notes: [note(9001, 'kim', LONG)] }, threadB],
      comments: [],
    };
    await renderBoardWithDrawerOpen();
    expect(clampOf('dA').getAttribute('data-clamped')).toBe('true');
    expect(clampOf('dA').hasAttribute('data-overflow')).toBe(true);
    await press(thread('dA'), 'show more');
    expect(clampOf('dA').getAttribute('data-clamped')).toBe('false');
    await press(thread('dA'), 'show less');
    expect(clampOf('dA').getAttribute('data-clamped')).toBe('true');
  });

  test('a note that fits under the cap has no fade and no "show more"', async () => {
    await renderBoardWithDrawerOpen();
    const labels = [...thread('dB').querySelectorAll('button')].map(b =>
      b.textContent?.trim()
    );
    expect(labels).not.toContain('show more');
    expect(clampOf('dB').hasAttribute('data-overflow')).toBe(false);
  });

  test('a long general MR comment is capped the same way', async () => {
    servedDiscussions = {
      threads: [],
      comments: [note(9100, 'kim', LONG)],
    };
    const drawer = await renderBoardWithDrawerOpen();
    const section = drawer.querySelector<HTMLElement>('.tui-cd-comments')!;
    expect(
      section.querySelector('.tui-cd-note-clamp')!.getAttribute('data-clamped')
    ).toBe('true');
    buttonIn(section, 'show more');
  });
});

// ── reads while the drawer is open ──────────────────────────────────────────

describe('drawer reads', () => {
  // Rendered on its own so each test hands the drawer the MR object a board
  // poll would: a fresh object every time, with or without changed facts.
  let Drawer: typeof import('../CommentsDrawer.tsx').CommentsDrawer;
  beforeAll(async () => {
    ({ CommentsDrawer: Drawer } = await import('../CommentsDrawer.tsx'));
  });
  const MR = BOARD_DATA.mrs[0]!;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  async function show(mr: Record<string, unknown>) {
    await React.act(async () => {
      root.render(
        React.createElement(Drawer, {
          mr: mr as never,
          local: true,
          onClose: () => {},
        })
      );
    });
    await settle();
  }

  test('a board poll that re-sends the same MR does not read the threads again', async () => {
    await show({ ...MR });
    await show({ ...MR });
    expect(reads).toBe(1);
  });

  test('a read that started before a reply cannot roll the thread back', async () => {
    await show({ ...MR });
    let release!: (r: Response) => void;
    readAnswer = () => new Promise<Response>(r => (release = r));
    await show({
      ...MR,
      threadSummary: { awaiting: 0, replied: 1, resolved: 0 },
    });
    expect(reads).toBe(2);
    writeAnswer = () => json({ threads: [replied, threadB], comments: [] });
    await press(thread('dA'), 'reply');
    await type(replyBox('dA')!, 'renamed in the next push');
    await press(thread('dA'), 'send');
    await React.act(async () => release(json(DISCUSSIONS)));
    await settle();
    expect(thread('dA').textContent).toContain('renamed in the next push');
  });

  test('a failed background read keeps the loaded threads on screen', async () => {
    await show({ ...MR });
    readAnswer = () => new Response('boom', { status: 502 });
    await show({ ...MR, updatedAt: '2026-08-20T00:00:00Z' });
    expect(reads).toBe(2);
    expect(thread('dA').textContent).toContain('rename this');
    expect(document.body.textContent).not.toContain("couldn't load comments");
  });
});
