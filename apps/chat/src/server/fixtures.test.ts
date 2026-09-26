import { afterEach, expect, test } from 'vitest';

import {
  FIXTURE_DM,
  fixtureAccounts,
  fixtureBuddies,
  fixtureDirectories,
  fixtureInbox,
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
  // Matches design/build.py's FLEET table: 3 live, 1 idle, 9 offline.
  expect(byStatus).toEqual({ live: 3, idle: 1, offline: 9 });
});

test('the roster exercises the states that break layout', () => {
  const buddies = fixtureBuddies();
  const byHandle = (h: string) => buddies.find(b => b.handle === h)!;

  // A real pane title, so the doing() title path renders somewhere.
  expect(byHandle('edie').paneTitle).toBe('Pipeline iteration loop');
  expect(byHandle('jay').paneTitle).toBe('Boxscore mattstack integration');
  // max's title equals its own handle, the deliberate case that exercises
  // doing()'s fallback past a title that merely repeats the handle.
  expect(byHandle('max').paneTitle).toBe('max');
  // idle with no title at all, so doing() falls through to branch/path.
  expect(byHandle('remy').paneTitle).toBeUndefined();
  // A ticket-slug branch on a scratch prefix, the case stripBranchPrefix()
  // exists for.
  expect(byHandle('jax').branch).toContain('rt-96-provision-blocks');
  // An offline buddy carries signedOutAt and nothing else worth showing.
  expect(byHandle('gail').signedOutAt).toBeGreaterThan(0);
});

test('DM rooms carry participants and a hashed name that is never shown', () => {
  const dms = fixtureRooms().filter(r => r.kind === 'dm');
  expect(dms).toHaveLength(4);
  for (const dm of dms) {
    expect(dm.room).toMatch(/^dm-[0-9a-f]{12}$/);
    expect(dm.participants?.a).toBeTruthy();
    expect(dm.participants?.b).toBeTruthy();
  }
});

test('a DM room reports exactly its two agent participants', () => {
  const members = fixtureMembers(FIXTURE_DM).map(m => m.handle);
  expect(members).toEqual(['max', 'stan']);
  expect(fixtureMembers(FIXTURE_DM)[0]!.wakeOn).toBe('all');
});

test('the #rt transcript carries the tsc-red thread, ending in the full log', () => {
  const msgs = fixtureMessages('rt');
  const withCode = msgs.find(m => m.body.includes('```'));
  // This fixture is the one that proves a code block scrolls inside its own
  // container rather than widening the page.
  expect(withCode).toBeDefined();
  expect(withCode!.body).toContain('Found 40 errors in 2 files.');
  expect(withCode!.body.split('\n').length).toBeGreaterThan(40);
  // A mention of a real handle, so the .at treatment has something to hit.
  expect(msgs.some(m => m.mentions.includes('max'))).toBe(true);
  // The structured message carries the markdown table.
  const structured = msgs.find(m => m.body.includes('| check | state |'));
  expect(structured?.body).toContain('picker tests');
  expect(msgs.some(m => m.handle === 'matt')).toBe(true);
  // The thread spans a day boundary: the design's "Yesterday"/"Today" split.
  expect(new Date(msgs[0]!.postedAt).getDate()).not.toBe(
    new Date(msgs.at(-1)!.postedAt).getDate()
  );
});

test('a room outside the scripted casts still returns a starter message', () => {
  expect(fixtureMessages('skills')).toHaveLength(1);
  expect(fixtureMessages('skills')[0]!.handle).toBe('edie');
});

test('the inbox fixtures carry the two cards the Main artboard draws', () => {
  const inbox = fixtureInbox('matt');
  expect(inbox.needsYou.map(c => c.handle)).toEqual(['edie', 'jay']);
  expect(inbox.needsYou.map(c => c.kind)).toEqual(['dm', 'room']);
  expect(inbox.openAsks.map(c => c.messageId)).toEqual([603, 602]);
  // The reader's context message: jay's card has the one before it in the
  // same room, which is what the artboard's `.msg.context` row draws.
  const boxscore = fixtureMessages('boxscore');
  expect(boxscore.map(m => m.handle)).toEqual(['max', 'jay']);
});

test('the pane fixtures cover every row state the picker artboard draws', () => {
  const panes = fixturePanes();
  const states = new Set(
    panes.map(p => (p.presence ? p.presence.status : 'none'))
  );
  expect(states).toEqual(new Set(['live', 'idle', 'offline', 'none']));
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
