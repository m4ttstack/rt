import { afterEach, expect, test } from 'vitest';

import {
  FIXTURE_DM,
  fixtureAccounts,
  fixtureBuddies,
  fixtureDirectories,
  fixtureInvite,
  fixtureMembers,
  fixtureMessages,
  fixturePanes,
  fixtureRooms,
  fixturesEnabled,
  fixtureSpawn,
} from './fixtures';

afterEach(() => {
  delete process.env.CHAT_FIXTURES;
});

test('fixtures are OFF unless explicitly asked for', () => {
  // The safety property. These serve invented agents and invented messages;
  // shipping them on by default would make the app confidently show a fleet
  // that does not exist.
  delete process.env.CHAT_FIXTURES;
  expect(fixturesEnabled()).toBe(false);
  process.env.CHAT_FIXTURES = '0';
  expect(fixturesEnabled()).toBe(false);
  process.env.CHAT_FIXTURES = 'true';
  expect(fixturesEnabled()).toBe(false);
  process.env.CHAT_FIXTURES = '1';
  expect(fixturesEnabled()).toBe(true);
});

test('the gate is read at call time, not captured at import', () => {
  // So a running server can be flipped without a rebuild, and so a test that
  // sets the env after this module loaded still sees it.
  delete process.env.CHAT_FIXTURES;
  expect(fixturesEnabled()).toBe(false);
  process.env.CHAT_FIXTURES = '1';
  expect(fixturesEnabled()).toBe(true);
});

test('the roster covers every status the design draws', () => {
  const byStatus = fixtureBuddies().reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});
  // Matches design/build.py's BUDDIES + OFFLINE tables: 3 / 2 / 1 / 1.
  expect(byStatus).toEqual({ live: 3, idle: 2, deaf: 1, offline: 1 });
});

test('the roster exercises the states that break layout', () => {
  const buddies = fixtureBuddies();
  const byHandle = (h: string) => buddies.find(b => b.handle === h)!;

  // An away message, so the italic quote line renders somewhere.
  expect(byHandle('board-fix-auth').statusText).toBe('waiting on CI');
  // A buddy with no away message, so the row must collapse cleanly.
  expect(byHandle('deck-main').statusText).toBeUndefined();
  // A deep path, so head-truncation is visible rather than theoretical.
  expect(byHandle('mr-board-onboard').cwd).toContain(
    'mr-board-wt-invite-onboarding'
  );
  // A suffixed handle, which is what a second session on one repo looks like.
  expect(byHandle('rt-chat-wt-2').baseHandle).toBe('rt-chat-wt');
  // An offline buddy carries signedOutAt and nothing else worth showing.
  expect(byHandle('workforest-e2e').signedOutAt).toBeGreaterThan(0);
});

test('DM rooms carry participants and a hashed name that is never shown', () => {
  const dms = fixtureRooms().filter(
    r => r.kind === 'dm' && r.archivedAt === undefined
  );
  expect(dms).toHaveLength(2);
  for (const dm of dms) {
    expect(dm.room).toMatch(/^dm-[0-9a-f]{12}$/);
    expect(dm.participants?.a).toBeTruthy();
    expect(dm.participants?.b).toBeTruthy();
  }
});

test('a DM room reports exactly its two agent participants', () => {
  const members = fixtureMembers(FIXTURE_DM).map(m => m.handle);
  expect(members).toEqual(['deck-main', 'rt-chat-wt']);
  expect(fixtureMembers(FIXTURE_DM)[0]!.wakeOn).toBe('all');
});

test('the build transcript carries the wide code block on purpose', () => {
  const msgs = fixtureMessages('build');
  const withCode = msgs.find(m => m.body.includes('```'));
  // This fixture is the one that proves a code block scrolls inside its own
  // container rather than widening the page.
  expect(withCode).toBeDefined();
  expect(withCode!.body).toContain('loadAndEvaluateModule');
  // And a mention of the human, so the .at.me treatment has something to hit.
  expect(msgs.some(m => m.mentions.includes('matt'))).toBe(true);
});

test('fixtures carry an archived channel, an archived DM, and a long code post', () => {
  const rooms = fixtureRooms();
  const archived = rooms.filter(r => r.archivedAt !== undefined);
  expect(archived.map(r => r.room)).toEqual(['retro-0819', 'dm-7b2e9c4d1a0f']);
  expect(
    fixtureMessages('build').at(-1)?.body.split('\n').length
  ).toBeGreaterThan(60);
  const retro = fixtureMessages('retro-0819');
  expect(retro).toHaveLength(4);
  expect(new Date(retro[0]!.postedAt).getDate()).not.toBe(
    new Date(retro[3]!.postedAt).getDate()
  );
  expect(fixtureMembers('retro-0819').map(m => m.handle)).toEqual([
    'deck-main',
    'gitq-main',
  ]);
});

test('the pane fixtures cover every row state the picker artboard draws', () => {
  const panes = fixturePanes();
  const states = new Set(
    panes.map(p => (p.presence ? p.presence.status : 'none'))
  );
  expect(states).toEqual(new Set(['live', 'idle', 'deaf', 'none']));
  expect(panes.some(p => p.agentStatus === 'working')).toBe(true);
  expect(panes.some(p => p.agentStatus === 'blocked')).toBe(true);
  expect(panes.some(p => p.presence?.rooms.includes('build'))).toBe(true);
  expect(panes.every(p => p.paneId && p.workspace)).toBe(true);
});

test('invite fixtures answer per pane: a working pane queues, a blocked one refuses', () => {
  const working = fixturePanes().find(p => p.agentStatus === 'working')!;
  const blocked = fixturePanes().find(p => p.agentStatus === 'blocked')!;
  const idle = fixturePanes().find(
    p => p.agentStatus === 'idle' && !p.presence
  )!;
  expect(fixtureInvite(working.paneId).delivered).toBe('queued');
  expect(fixtureInvite(blocked.paneId)).toMatchObject({
    delivered: 'refused',
    reason: 'at a prompt',
  });
  expect(fixtureInvite(idle.paneId).delivered).toBe('accepted');
});

test('directories filter by substring; accounts carry headroom; spawn returns a ready pane', () => {
  expect(fixtureDirectories('acme').every(d => d.path.includes('acme'))).toBe(
    true
  );
  expect(fixtureDirectories().length).toBeGreaterThan(
    fixtureDirectories('acme').length
  );
  expect(fixtureAccounts()[0]).toMatchObject({ slot: 1, alias: 'Acme' });
  expect(fixtureSpawn('/Users/matt/Documents/GitHub/chat')).toMatchObject({
    ready: true,
    pane: { cwd: '/Users/matt/Documents/GitHub/chat', agentStatus: 'idle' },
  });
});
