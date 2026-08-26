import { expect, test, vi } from 'vitest';

const cfgs: Array<{ match: (t: string) => boolean; topic: string }> = [];
vi.mock('@mattstack/rt-client', () => ({
  createRelay: (cfg: { match: (t: string) => boolean; topic: string }) => {
    cfgs.push(cfg);
    return () => {};
  },
}));
const { startRelay } = await import('./ws');

test('relays onto the chat topic with a prefix predicate, not topic equality', () => {
  // Console filtered `frame.topic !== 'run-updated'` -- one fixed topic. Chat
  // topics carry the room, so equality would drop every real message.
  startRelay(() => {});
  const { match, topic } = cfgs[0]!;
  expect(topic).toBe('chat');
  expect(match('chat/build/msg')).toBe(true);
  expect(match('chat/wake/agent-a')).toBe(true);
  expect(match('chat/some-other-room/msg')).toBe(true);
  expect(match('run-updated')).toBe(false);
});

test('the predicate is a prefix test, so it cannot be fooled by a substring', () => {
  // `includes("chat/")` would pass all three of these. A room named after
  // another app's topic, or a daemon event that merely mentions chat, must
  // not reach the viewer's socket.
  const { match } = cfgs[0]!;
  expect(match('run-updated/chat/build')).toBe(false);
  expect(match('notchat/build/msg')).toBe(false);
  expect(match('chat')).toBe(false); // the bare word is not a chat topic
});

test('ws.ts does not import hono/bun', async () => {
  // Matches an IMPORT, not the bare string: this module's own comments
  // explain the constraint by name, and a substring check would fail on the
  // documentation of the rule it is enforcing.
  const src = await import('fs').then(fs =>
    fs.readFileSync('src/server/ws.ts', 'utf8')
  );
  expect(src).not.toMatch(/^\s*import[^;]*['"]hono\/bun['"]/m);
  expect(src).not.toMatch(/require\(['"]hono\/bun['"]\)/);
});

test('the guard would catch a real hono/bun import', () => {
  // The assertion above is a negative, so it passes on an empty file too.
  // Pin that the pattern actually matches the thing it forbids.
  const offending = "import { serveStatic } from 'hono/bun';\n";
  expect(offending).toMatch(/^\s*import[^;]*['"]hono\/bun['"]/m);
});
