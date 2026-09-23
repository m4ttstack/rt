/** A row edits the layer its value comes from. A key allowed at user and
    machine whose value the machine layer sets must save there: a write to the
    lower user layer reports saved and is then shadowed on reload. */
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

const KEY = 'board.agent.model';

let effectiveScope: string | null;
let writes: { url: string; body: { scope?: string; value?: unknown } }[];

const def = () => ({
  key: KEY,
  type: 'string',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'model',
  hasDefault: false,
  effective:
    effectiveScope === null
      ? { scope: null, value: undefined }
      : { scope: effectiveScope, value: 'claude-opus-4-8[1m]' },
});

const realFetch = globalThis.fetch;

const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  effectiveScope = 'machine';
  writes = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/settings/defs')) return json({ defs: [def()] });
    if (url.startsWith('/api/settings/explain/')) {
      return json({ def: null, rows: [] });
    }
    if (url === '/api/settings/set' || url === '/api/settings/unset') {
      writes.push({ url, body: JSON.parse(String(init?.body)) });
      return json({ effective: def().effective });
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

const input = () =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${KEY}"]`)!;

const badge = () =>
  document.querySelector(`[data-key="${KEY}"] .tui-config-badge`)!.textContent;

async function typeAndCommit(text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    input().focus();
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    input().blur();
  });
  await flush();
}

test('an edit saves to the machine layer when machine sets the value', async () => {
  await render();
  await typeAndCommit('claude-opus-5-5[1m]');
  expect(writes.map(w => [w.url, w.body.scope])).toEqual([
    ['/api/settings/set', 'machine'],
  ]);
});

test('clearing removes the value from the layer that sets it', async () => {
  await render();
  const clear = document.querySelector<HTMLButtonElement>(
    `button[aria-label="clear ${KEY}"]`
  )!;
  await React.act(async () => clear.click());
  await flush();
  expect(writes.map(w => [w.url, w.body.scope])).toEqual([
    ['/api/settings/unset', 'machine'],
  ]);
});

test('the badge names the layer the row edits', async () => {
  await render();
  expect(badge()).toBe('machine');
});

test('an unset key saves to its first allowed scope', async () => {
  effectiveScope = null;
  await render();
  expect(badge()).toBe('user · local until pushed');
  await typeAndCommit('opus');
  expect(writes.map(w => w.body.scope)).toEqual(['user']);
});
