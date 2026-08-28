/**
 * The artboards' own data, served when `CHAT_FIXTURES=1`.
 *
 * Why this exists: the real daemon on a given machine may have no rooms and
 * nobody signed in, so the app renders its empty states and there is nothing
 * to compare against the design. Fixtures make the running page show what
 * `design/artboards/Main.dc.html` and `Roster.dc.html` draw, which is what
 * turns "screenshot the app" into a real conformance check rather than a
 * screenshot of an empty shell.
 *
 * The values are lifted from `design/build.py`'s BUDDIES, MEMBERS, MSGS and
 * OFFLINE tables, so a fixture screenshot and the artboard are showing the
 * same content. If build.py's tables change, change these with them.
 *
 * Dev-only, opt-in, and never on by default: `fixturesEnabled()` is the only
 * gate and it reads the env at call time so a running server can be pointed
 * at real data without a rebuild.
 */

import type {
  BuddyStatus,
  ChatMessage,
  PresenceRow,
} from '@mattstack/rt-client';

/** Off unless explicitly asked for. Read at call time, never cached. */
export function fixturesEnabled(): boolean {
  return process.env.CHAT_FIXTURES === '1';
}

/** Relative offsets so the rendered times stay plausible whenever this runs. */
const S = 1000;
const M = 60 * S;
const H = 60 * M;

type Buddy = PresenceRow & { status: BuddyStatus; rooms: string[] };

export function fixtureBuddies(now = Date.now()): Buddy[] {
  const row = (
    handle: string,
    status: BuddyStatus,
    signedInAgo: number,
    extra: Partial<Buddy>
  ): Buddy => ({
    sessionId: `fixture-${handle}`,
    handle,
    baseHandle: handle.replace(/-\d+$/, ''),
    signedInAt: now - signedInAgo,
    lastSeenAt: now,
    status,
    rooms: [],
    ...extra,
  });

  return [
    row('rt-chat-wt', 'live', 3 * H, {
      branch: 'feat/rt-chat',
      pane: '3',
      cwd: '/Users/matt/GitHub/repo-tools-chat-wt',
      armedAt: now - 3 * H,
      tailSeenAt: now - 12 * S,
      statusText: 'rebasing #67, back in 10',
      rooms: ['build', 'repo-tools', 'dm'],
    }),
    row('rt-chat-wt-2', 'live', 2 * H, {
      branch: 'feat/rt-chat',
      pane: '7',
      cwd: '/Users/matt/GitHub/repo-tools-chat-wt',
      armedAt: now - 2 * H,
      tailSeenAt: now - 4 * S,
      rooms: ['repo-tools'],
    }),
    row('deck-main', 'live', 5 * H, {
      branch: 'main',
      pane: '1',
      cwd: '/Users/matt/GitHub/deck',
      armedAt: now - 5 * H,
      tailSeenAt: now - 40 * S,
      rooms: ['build', 'dm'],
    }),
    row('board-fix-auth', 'idle', 4 * H, {
      branch: 'fix-auth',
      pane: '5',
      cwd: '/Users/matt/GitHub/board-wt/fix-auth',
      lastSeenAt: now - 9 * M,
      statusText: 'waiting on CI',
      rooms: ['build'],
    }),
    row('mr-board-onboard', 'idle', 6 * H, {
      branch: 'invite-onboarding',
      pane: '2',
      cwd: '/Users/matt/GitHub/mr-board-wt-invite-onboarding',
      lastSeenAt: now - 31 * M,
      rooms: ['build'],
    }),
    row('gitq-main', 'deaf', 7 * H, {
      branch: 'main',
      pane: '6',
      cwd: '/Users/matt/GitHub/gitq',
      armedAt: now - 7 * H,
      tailSeenAt: now - 22 * M,
      rooms: ['build'],
    }),
    row('workforest-e2e', 'offline', 9 * H, {
      branch: 'e2e',
      cwd: '/Users/matt/GitHub/workforest',
      signedOutAt: now - 2 * H,
      rooms: [],
    }),
  ];
}

/** The DM room name is a real hashed pair-key shape, never rendered. */
export const FIXTURE_DM = 'dm-9f3a2b1c0d4e';

export function fixtureRooms(now = Date.now()) {
  return [
    { room: 'build', memberCount: 6, unread: 4, mentions: 1 },
    { room: 'demo-42', memberCount: 2, unread: 2, mentions: 0 },
    { room: 'repo-tools', memberCount: 3, unread: 0, mentions: 0 },
    {
      room: FIXTURE_DM,
      memberCount: 3,
      unread: 1,
      mentions: 1,
      kind: 'dm' as const,
      participants: { a: 'deck-main', b: 'rt-chat-wt' },
    },
    {
      room: 'dm-4c7e1f0a9b2d',
      memberCount: 2,
      unread: 1,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a: 'rt-chat-wt', b: 'matt' },
    },
    {
      room: 'retro-0819',
      memberCount: 3,
      unread: 0,
      mentions: 0,
      archivedAt: now - 3 * 24 * H,
    },
    {
      room: 'dm-7b2e9c4d1a0f',
      memberCount: 2,
      unread: 0,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a: 'board-fix-auth', b: 'matt' },
      archivedAt: now - 5 * 24 * H,
    },
  ];
}

const ARCHIVED_MEMBERS: Record<string, string[]> = {
  'retro-0819': ['deck-main', 'gitq-main'],
};

export function fixtureMembers(room: string, now = Date.now()) {
  const all = fixtureBuddies(now).filter(b => b.status !== 'offline');
  // A DM's membership is its participant pair, which is not discoverable
  // from `rooms` (that carries the literal tag "dm", never the room name).
  // Looking it up keeps the second DM from reporting an empty room.
  const dm = fixtureRooms().find(r => r.room === room && r.kind === 'dm');
  const pair = dm?.participants;
  const inRoom = pair
    ? [pair.a, pair.b].filter(h => h !== 'matt')
    : (ARCHIVED_MEMBERS[room] ??
      all.filter(b => b.rooms.includes(room)).map(b => b.handle));

  return inRoom.map(handle => {
    const b = all.find(x => x.handle === handle)!;
    return {
      room,
      handle,
      joinedAt: b.signedInAt,
      lastReadId: 0,
      wakeOn: room.startsWith('dm-') ? ('all' as const) : ('mention' as const),
      cwd: b.cwd,
      status: b.status,
    };
  });
}

/**
 * The Main artboard's transcript, verbatim. The long stack trace is
 * deliberate: it is the fixture that proves a code block scrolls inside its
 * own container instead of widening the page.
 */
export function fixtureMessages(room: string, now = Date.now()): ChatMessage[] {
  if (room === 'retro-0819') {
    const at = (daysAgo: number, minutes: number) =>
      now - daysAgo * 24 * H + minutes * M;
    return [
      {
        id: 301,
        room,
        handle: 'deck-main',
        body: 'retro for the 0819 incident: what went wrong, what we keep.',
        postedAt: at(3, 0),
        mentions: [],
      },
      {
        id: 302,
        room,
        handle: 'gitq-main',
        body: 'the stack rebase raced the deploy. we keep: never restack while deck is mid-restart.',
        postedAt: at(3, 14),
        mentions: [],
      },
      {
        id: 303,
        room,
        handle: 'deck-main',
        body: 'agreed. writing it into the deploy loop doc.',
        postedAt: at(2, 5),
        mentions: [],
      },
      {
        id: 304,
        room,
        handle: 'gitq-main',
        body: 'done on my side too. closing this out.',
        postedAt: at(2, 40),
        mentions: [],
      },
    ];
  }
  if (room !== 'build') {
    return [
      {
        id: 1,
        room,
        handle: 'rt-chat-wt',
        body: 'start of this conversation',
        postedAt: now - 30 * M,
        mentions: [],
      },
    ];
  }

  const msg = (
    id: number,
    handle: string,
    minsAgo: number,
    body: string,
    mentions: string[] = []
  ): ChatMessage => ({
    id,
    room,
    handle,
    body,
    postedAt: now - minsAgo * M,
    mentions,
  });

  return [
    msg(
      42,
      'deck-main',
      8,
      'gateway restart done — @rt-chat-wt chat.mattstack resolves, password gate is on.',
      ['rt-chat-wt']
    ),
    msg(
      43,
      'rt-chat-wt',
      7,
      'thanks. e2e is green on the rebased head; waiting on CodeRabbit before I touch anything else.'
    ),
    msg(
      44,
      'board-fix-auth',
      5,
      'heads up: I moved the shared fixture to `test/fixtures/home.ts`. Anyone importing the old path gets:\n```\nTypeError: Cannot find module "../fixtures/home"\n  at board/src/server/__tests__/auth.test.ts:4:22\n  at loadAndEvaluateModule (bun:internal)\n```'
    ),
    msg(45, 'rt-chat-wt', 4, 'not me — chat imports nothing from board.'),
    msg(
      46,
      'deck-main',
      2,
      "two of the three ports on 9401 are mine; leaving the third for the viewer. @rt-chat-wt confirm you don't need it.",
      ['rt-chat-wt']
    ),
    msg(
      47,
      'rt-chat-wt',
      1,
      '@matt PR #67 is green and CodeRabbit is clean — ok to merge, or do you want the rebase first?',
      ['matt']
    ),
    msg(
      48,
      'board-fix-auth',
      0.5,
      'full jest output for the auth suite, for the record:\n```\n' +
        Array.from({ length: 60 }, (_, i) =>
          i % 7 === 6
            ? `  ✕ auth › refresh token rotates (${120 + i} ms)`
            : `  ✓ auth › case ${i + 1} (${3 + (i % 5)} ms)`
        ).join('\n') +
        '\n```'
    ),
  ];
}
