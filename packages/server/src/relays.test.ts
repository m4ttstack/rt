import { expect, test, vi } from 'vitest';

import { startRelays } from './relays';

const created: {
  opts: Record<string, unknown>;
  stop: ReturnType<typeof vi.fn>;
}[] = [];
vi.mock('@mattstack/rt-client', () => ({
  createRelay: vi.fn((opts: Record<string, unknown>) => {
    const stop = vi.fn();
    created.push({ opts, stop });
    return stop;
  }),
}));

test('one createRelay per spec, one stop for all', () => {
  const publish = vi.fn();
  const stop = startRelays(
    [
      { match: t => t.startsWith('chat/'), topic: 'chat' },
      { match: t => t === 'run-updated', topic: 'runs' },
    ],
    publish
  );
  expect(created).toHaveLength(2);
  expect(created[0]!.opts).toMatchObject({ topic: 'chat', publish });
  expect(created[1]!.opts).toMatchObject({ topic: 'runs', publish });
  stop();
  expect(created[0]!.stop).toHaveBeenCalledTimes(1);
  expect(created[1]!.stop).toHaveBeenCalledTimes(1);
});

test('no specs means nothing subscribed', () => {
  created.length = 0;
  const stop = startRelays([], vi.fn());
  expect(created).toHaveLength(0);
  expect(() => stop()).not.toThrow();
});
