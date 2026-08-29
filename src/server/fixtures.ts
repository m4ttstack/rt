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
  ChatPane,
  InviteResult,
  PaneAccount,
  PaneDirectory,
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
      lastSeenAt: now - 12 * S,
      statusText: 'rebasing #67, back in 10',
      rooms: ['build', 'repo-tools', 'dm'],
    }),
    row('rt-chat-wt-2', 'live', 2 * H, {
      branch: 'feat/rt-chat',
      pane: '7',
      cwd: '/Users/matt/GitHub/repo-tools-chat-wt',
      lastSeenAt: now - 4 * S,
      rooms: ['repo-tools'],
    }),
    row('deck-main', 'live', 5 * H, {
      branch: 'main',
      pane: '1',
      cwd: '/Users/matt/GitHub/deck',
      lastSeenAt: now - 40 * S,
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
    row('gitq-main', 'offline', 7 * H, {
      branch: 'main',
      pane: '6',
      cwd: '/Users/matt/GitHub/gitq',
      signedOutAt: now - 22 * M,
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
  const buddies = fixtureBuddies(now);
  const online = buddies.filter(b => b.status !== 'offline');
  // A DM's membership is its participant pair, which is not discoverable
  // from `rooms` (that carries the literal tag "dm", never the room name).
  // Looking it up keeps the second DM from reporting an empty room.
  const dm = fixtureRooms().find(r => r.room === room && r.kind === 'dm');
  const pair = dm?.participants;
  const inRoom = pair
    ? [pair.a, pair.b].filter(h => h !== 'matt')
    : (ARCHIVED_MEMBERS[room] ??
      online.filter(b => b.rooms.includes(room)).map(b => b.handle));

  return inRoom.map(handle => {
    // The full (unfiltered) list: `ARCHIVED_MEMBERS` can name a buddy who has
    // since gone offline, and an archived room keeping a stale member is
    // exactly the case worth fixturing, not a lookup to fail on.
    const b = buddies.find(x => x.handle === handle)!;
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

/** The picker artboard's rows: one per state it draws. Keep in step with
    design/build.py's PANES table. */
export function fixturePanes(): ChatPane[] {
  return [
    {
      paneId: 'w3f:p2',
      workspace: 'repo-tools',
      title: 'fred',
      cwd: '/Users/matt/Documents/GitHub/repo-tools/.claude/worktrees/rt-63-68-locate',
      repo: 'repo-tools',
      branch: 'rt-63-68-locate',
      agentStatus: 'working',
      sessionId: 'fixture-fred',
      presence: { handle: 'fred', status: 'live', rooms: ['repo-tools'] },
    },
    {
      paneId: 'w3f:p4',
      workspace: 'chat',
      title: 'meg',
      cwd: '/Users/matt/Documents/GitHub/chat',
      repo: 'chat',
      branch: 'main',
      agentStatus: 'idle',
      sessionId: 'fixture-meg',
      presence: { handle: 'meg', status: 'live', rooms: ['build', 'chat'] },
    },
    {
      paneId: 'w9c:p3',
      workspace: 'gitq',
      title: 'june',
      cwd: '/Users/matt/Documents/GitHub/gitq',
      repo: 'gitq',
      branch: 'main',
      agentStatus: 'blocked',
      sessionId: 'fixture-june',
      presence: { handle: 'june', status: 'idle', rooms: ['gitq'] },
    },
    {
      paneId: 'w2d:p1',
      workspace: 'deck',
      title: 'otis',
      cwd: '/Users/matt/Documents/GitHub/deck',
      repo: 'deck',
      branch: 'main',
      agentStatus: 'idle',
      sessionId: 'fixture-otis',
      presence: { handle: 'otis', status: 'offline', rooms: ['deck'] },
    },
    {
      paneId: 'w7A:pY',
      workspace: 'acme',
      title: 'Evaluate house codegen plugin for bundle optimization',
      cwd: '/Users/matt/Documents/GitHub/acme',
      repo: 'acme',
      branch: 'main',
      agentStatus: 'idle',
      sessionId: 'fixture-acme',
    },
    {
      paneId: 'wB1:p1',
      workspace: 'mr-board',
      title: 'Fix invite onboarding modal focus trap',
      cwd: '/Users/matt/Documents/GitHub/mr-board-wt-invite-onboarding',
      repo: 'mr-board',
      branch: 'invite-onboarding',
      agentStatus: 'working',
      sessionId: 'fixture-mrboard',
    },
  ];
}

export function fixturePeek(paneId: string): string[] {
  if (paneId === 'w7A:pY') {
    return [
      '⏺ Read(src/plugins/house-codegen/index.ts)',
      '  ⎿  Read 212 lines',
      '⏺ The plugin emits one chunk per island; the split itself',
      '  happens in vite manualChunks, not here. Checking that next.',
      '❯ ',
    ];
  }
  return ['❯ '];
}

export function fixtureAccounts(): PaneAccount[] {
  return [
    {
      slot: 1,
      email: 'alex@acme.test',
      alias: 'Acme',
      headroom: '5h 0% · 7d 40% · Fable 35%',
    },
  ];
}

export function fixtureDirectories(q?: string): PaneDirectory[] {
  const all: PaneDirectory[] = [
    { path: '/Users/matt/Documents/GitHub/acme', repo: 'acme', branch: 'main' },
    {
      path: '/Users/matt/Documents/GitHub/acme-wt-codegen-split',
      repo: 'acme',
      branch: 'perf/codegen-split',
    },
    {
      path: '/Users/matt/Documents/GitHub/repo-tools',
      repo: 'repo-tools',
      branch: 'main',
    },
    { path: '/Users/matt/Documents/GitHub/chat', repo: 'chat', branch: 'main' },
  ];
  const needle = q?.toLowerCase();
  return needle ? all.filter(d => d.path.toLowerCase().includes(needle)) : all;
}

/** The three outcomes the invite flow renders, keyed off the pane's state. */
export function fixtureInvite(paneId: string): InviteResult {
  const pane = fixturePanes().find(p => p.paneId === paneId);
  if (!pane)
    return { paneId, delivered: 'refused', reason: 'not a claude pane' };
  if (pane.agentStatus === 'blocked')
    return { paneId, delivered: 'refused', reason: 'at a prompt' };
  if (pane.agentStatus === 'working') return { paneId, delivered: 'queued' };
  return { paneId, delivered: 'accepted' };
}

let spawned = 0;
export function fixtureSpawn(cwd: string): { pane: ChatPane; ready: boolean } {
  spawned += 1;
  const leaf = cwd.split('/').filter(Boolean).at(-1) ?? 'pane';
  return {
    ready: true,
    pane: {
      paneId: `wC2:p${spawned}`,
      workspace: 'chat',
      title: 'claude',
      cwd,
      repo: leaf,
      branch: 'main',
      agentStatus: 'idle',
    },
  };
}
