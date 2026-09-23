/** A leaf edit on a deep-merged object key writes onto the target store's own
    authored object. The def's effective value is the merged view (registry
    default plus every layer), so starting from it would bake the default and
    other layers into that one store. */
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
let ConfigModal: typeof import('../ConfigModal.tsx').ConfigModal;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ ConfigModal } = await import('../ConfigModal.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const KEY = 'board.triage';
const DEFAULT = { enabled: false, cooldownMinutes: 30, notify: 'rt' };

interface Row {
  scope: string;
  file: string;
  present: boolean;
  value?: unknown;
}

let userValue: Record<string, unknown> | undefined;
let explainGate: Promise<void>;
let writes: { url: string; body: { value?: unknown } }[];
let explainCalls: number;
let explainFails: boolean;

const rows = (): Row[] => [
  { scope: 'default', file: '', present: true, value: DEFAULT },
  userValue === undefined
    ? { scope: 'user', file: 'user.jsonc', present: false }
    : { scope: 'user', file: 'user.jsonc', present: true, value: userValue },
];

const effective = () => ({
  scope: userValue === undefined ? 'default' : 'user',
  value: { ...DEFAULT, ...userValue },
});

const def = () => ({
  key: KEY,
  type: 'object',
  scopes: ['user'],
  merge: 'deep',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'triage',
  hasDefault: true,
  defaultValue: DEFAULT,
  effective: effective(),
});

const realFetch = globalThis.fetch;

const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  userValue = { notify: 'badge-only' };
  explainGate = Promise.resolve();
  writes = [];
  explainCalls = 0;
  explainFails = false;
  localStorage.setItem('board.config.openRows', JSON.stringify([KEY]));
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/settings/defs')) return json({ defs: [def()] });
    if (url === `/api/settings/explain/${encodeURIComponent(KEY)}`) {
      explainCalls++;
      const snapshot = rows();
      await explainGate;
      if (explainFails) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'explain exploded' }),
        } as Response;
      }
      return json({ def: def(), rows: snapshot });
    }
    if (url.startsWith('/api/settings/explain/')) {
      return json({ def: null, rows: [] });
    }
    if (url === '/api/settings/set') {
      const body = JSON.parse(String(init?.body));
      writes.push({ url, body });
      userValue = body.value;
      return json({ effective: effective() });
    }
    if (url === '/api/settings/unset') {
      writes.push({ url, body: JSON.parse(String(init?.body)) });
      userValue = undefined;
      return json({ effective: effective() });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
  localStorage.clear();
});

const flush = () =>
  React.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const noop = () => {};
  await React.act(async () => {
    createRoot(container).render(
      <ConfigModal
        tabs={[]}
        knownSections={null}
        onClose={noop}
        onOpenRoster={noop}
        onTabsSaved={noop}
      />
    );
  });
  await flush();
}

const field = (path: string) =>
  document.querySelector<HTMLInputElement>(
    `input[aria-label="${KEY}.${path}"]`
  )!;

async function typeAndCommit(path: string, text: string) {
  const input = field(path);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    input.blur();
  });
  await flush();
  await flush();
}

test('a leaf edit writes only that field onto the target layer', async () => {
  await render();
  await typeAndCommit('cooldownMinutes', '45');
  expect(writes.map(w => w.body.value)).toEqual([
    { notify: 'badge-only', cooldownMinutes: 45 },
  ]);
});

test('a leaf edit on an unset layer writes just that field', async () => {
  userValue = undefined;
  await render();
  await typeAndCommit('cooldownMinutes', '45');
  expect(writes.map(w => w.body.value)).toEqual([{ cooldownMinutes: 45 }]);
});

test('a second edit builds on the first edit, not on stale rows', async () => {
  await render();
  await typeAndCommit('cooldownMinutes', '45');
  expect(explainCalls).toBeGreaterThan(1);
  await typeAndCommit('cooldownMinutes', '50');
  expect(writes.at(-1)?.body.value).toEqual({
    notify: 'badge-only',
    cooldownMinutes: 50,
  });
});

test('leaf inputs stay disabled until the layer rows arrive', async () => {
  let release!: () => void;
  explainGate = new Promise(r => (release = r));
  await render();
  expect(field('cooldownMinutes').disabled).toBe(true);
  await React.act(async () => release());
  await flush();
  expect(field('cooldownMinutes').disabled).toBe(false);
});

test('emptying a field only the default sets writes nothing', async () => {
  await render();
  await typeAndCommit('cooldownMinutes', '');
  expect(writes).toEqual([]);
  expect(field('cooldownMinutes').value).toBe('30');
});

test('emptying the last field the layer sets clears the layer', async () => {
  userValue = { cooldownMinutes: 45 };
  await render();
  await typeAndCommit('cooldownMinutes', '');
  expect(writes.map(w => w.url)).toEqual(['/api/settings/unset']);
});

test('fields stay disabled until the rows after a write arrive', async () => {
  await render();
  let release!: () => void;
  explainGate = new Promise(r => (release = r));
  await typeAndCommit('cooldownMinutes', '45');
  expect(field('cooldownMinutes').disabled).toBe(true);
  await React.act(async () => release());
  await flush();
  expect(field('cooldownMinutes').disabled).toBe(false);
});

test('a write that leaves the merged value unchanged still refreshes the rows', async () => {
  userValue = { notify: 'badge-only', cooldownMinutes: 30 };
  await render();
  await typeAndCommit('cooldownMinutes', '');
  expect(field('cooldownMinutes').value).toBe('30');
  await typeAndCommit('dailyAttemptBudget', '5');
  expect(writes.map(w => w.body.value)).toEqual([
    { notify: 'badge-only' },
    { notify: 'badge-only', dailyAttemptBudget: 5 },
  ]);
});

test('resetting one field leaves the other fields mounted', async () => {
  await render();
  const other = field('dailyAttemptBudget');
  await typeAndCommit('cooldownMinutes', '');
  expect(field('dailyAttemptBudget')).toBe(other);
});

test('an explain failure shows the error and retry reloads the rows', async () => {
  explainFails = true;
  await render();
  const block = document.querySelector('.tui-config-leaves')!;
  expect(block.textContent).toContain('explain exploded');
  expect(field('cooldownMinutes').disabled).toBe(true);
  explainFails = false;
  const retry = [...block.querySelectorAll('button')].find(
    b => b.textContent === 'retry'
  )!;
  await React.act(async () => retry.click());
  await flush();
  expect(block.textContent).not.toContain('explain exploded');
  expect(field('cooldownMinutes').disabled).toBe(false);
});
