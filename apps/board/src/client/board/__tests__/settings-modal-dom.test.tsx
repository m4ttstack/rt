import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let SettingsModal: typeof import('../SettingsModal.tsx').SettingsModal;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ SettingsModal } = await import('../SettingsModal.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function render(local: boolean): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const noop = () => {};
  await React.act(async () => {
    createRoot(container).render(
      <SettingsModal
        members={[
          { username: 'alice', name: 'Alice', hidden: false, count: 0 },
          { username: 'bob', name: 'Bob', hidden: true, count: null },
        ]}
        canInvite={false}
        local={local}
        peering={null}
        defaultMember="alice"
        onToggle={noop}
        onJoined={noop}
        onClose={noop}
      />
    );
  });
  return container;
}

test('a local viewer can check members in and out', async () => {
  const el = await render(true);
  expect(el.querySelectorAll('input.tui-check-box')).toHaveLength(2);
});

test('a public viewer sees the roster with no check-in/out toggle', async () => {
  const el = await render(false);
  expect(el.querySelectorAll('input.tui-check-box')).toHaveLength(0);
  expect(el.textContent).toContain('Alice');
  expect(el.textContent).toContain('Bob');
});
