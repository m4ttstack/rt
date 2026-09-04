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
 * The buddy/room/member/message values are lifted from `design/build.py`'s
 * FLEET, ROOMS, DMS and RT_MSGS tables (the pane fixtures below keep their
 * own separate cast), so a fixture screenshot and the artboard are showing
 * the same content. If build.py's tables change, change these with them.
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
  PaneFocusResult,
  PresenceRow,
  RoomSummary,
} from '@mattstack/rt-client';

import { buildInbox, type InboxPayload } from './inbox';

/** Off unless explicitly asked for. Read at call time, never cached. */
export function fixturesEnabled(): boolean {
  return process.env.CHAT_FIXTURES === '1';
}

/** Relative offsets so the rendered times stay plausible whenever this runs. */
const S = 1000;
const M = 60 * S;
const H = 60 * M;

type Buddy = PresenceRow & {
  status: BuddyStatus;
  rooms: string[];
  paneTitle?: string;
};

interface FleetEntry {
  h: string;
  repo: string;
  branch: string;
  st: BuddyStatus;
  title?: string;
  pane?: string;
  /** How long ago this row was last seen (live/idle) or signed out (offline). */
  seenAgo: number;
  cwd: string;
}

/** design/build.py's FLEET table, verbatim. */
const FLEET: FleetEntry[] = [
  {
    h: 'max',
    repo: 'rt',
    branch: 'main',
    st: 'live',
    title: 'max',
    pane: 'wAR:p3',
    seenAgo: 12 * S,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'edie',
    repo: 'skills',
    branch: 'main',
    st: 'live',
    title: 'Pipeline iteration loop',
    pane: 'wBP:p1',
    seenAgo: 2 * M,
    cwd: '/Users/matt/Documents/GitHub/mattstack-skills',
  },
  {
    h: 'jay',
    repo: 'boxscore',
    branch: 'feat/metrics-hardening',
    st: 'live',
    title: 'Boxscore mattstack integration',
    pane: 'wBT:p1',
    seenAgo: 40 * S,
    cwd: '/Users/matt/Documents/GitHub/boxscore/.claude/worktrees/metrics-hardening',
  },
  {
    h: 'remy',
    repo: 'rt',
    branch: 'main',
    st: 'idle',
    pane: 'wAM:pF',
    seenAgo: 9 * M,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'gail',
    repo: 'board',
    branch: 'main',
    st: 'offline',
    seenAgo: 3 * M,
    cwd: '/Users/matt/Documents/GitHub/board',
  },
  {
    h: 'kai',
    repo: 'rt',
    branch: 'main',
    st: 'offline',
    seenAgo: 16 * H,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'ida',
    repo: 'rt',
    branch: 'main',
    st: 'offline',
    seenAgo: 15 * H,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'jax',
    repo: 'rt',
    branch:
      'goodwinmattheweric/rt-96-provision-blocks-on-claim-time-ready-steps-run-them-async',
    st: 'offline',
    seenAgo: 23 * H,
    cwd: '/Users/matt/.mattstack/rt/worktrees/m4ttstack-rt/proud-marble',
  },
  {
    h: 'sid',
    repo: 'rt',
    branch: 'main',
    st: 'offline',
    seenAgo: 23 * H,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'meg',
    repo: 'skills',
    branch: 'main',
    st: 'offline',
    seenAgo: 23 * H,
    cwd: '/Users/matt/Documents/GitHub/matt-skills',
  },
  {
    h: 'stan',
    repo: 'console',
    branch: 'main',
    st: 'offline',
    seenAgo: 17 * H,
    cwd: '/Users/matt/Documents/GitHub/console',
  },
  {
    h: 'elsa',
    repo: 'rt',
    branch: 'main',
    st: 'offline',
    seenAgo: 20 * H,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
  {
    h: 'wren',
    repo: 'rt',
    branch: 'main',
    st: 'offline',
    seenAgo: 20 * H,
    cwd: '/Users/matt/Documents/GitHub/repo-tools',
  },
];

/** design/build.py's ROOMS table: repo -> room; `board` has agents but no room. */
const REPO_ROOMS: Record<string, string> = {
  rt: 'rt',
  skills: 'skills',
  console: 'console',
  boxscore: 'boxscore',
};
const ROOMS_META: Record<string, readonly [mentions: number, unread: number]> =
  {
    rt: [1, 155],
    skills: [0, 9],
    console: [0, 3],
    boxscore: [0, 6],
  };

/** design/build.py's DMS table: (a, c, unread). */
const DMS: ReadonlyArray<readonly [string, string, number]> = [
  ['max', 'stan', 4],
  ['jay', 'max', 3],
  ['edie', 'stan', 14],
  ['kai', 'remy', 102],
];
/** The DM room name is a real hashed pair-key shape, never rendered. */
const DM_ROOM: Record<string, string> = {
  'max|stan': 'dm-3a7f912ce0b6',
  'jay|max': 'dm-8c1d4e6a2f90',
  'edie|stan': 'dm-5b9e02771ac4',
  'kai|remy': 'dm-e41f7a3c68bd',
};
/** design/build.py's LAST table: the newest message per pair, which the tree's
    DM second line falls back to. `jay|max` has none on purpose -- jay's pane
    title wins there, so the fallback never runs. */
const DM_LAST: Record<string, { handle: string; body: string }> = {
  'max|stan': {
    handle: 'stan',
    body: 'holding the console settings page until 2.8.1 lands',
  },
  'edie|stan': {
    handle: 'edie',
    body: 'pack compile is green, cutting the loop over',
  },
  'kai|remy': {
    handle: 'remy',
    body: 'tail died again at 03:12, restarting the daemon',
  },
};
const dmPartners = new Set(DMS.flatMap(([a, c]) => [a, c]));

export function fixtureBuddies(now = Date.now()): Buddy[] {
  return FLEET.map(f => {
    const rooms = [
      REPO_ROOMS[f.repo],
      dmPartners.has(f.h) ? 'dm' : undefined,
    ].filter((x): x is string => Boolean(x));
    return {
      sessionId: `fixture-${f.h}`,
      handle: f.h,
      baseHandle: f.h,
      repo: f.repo,
      branch: f.branch,
      pane: f.pane,
      cwd: f.cwd,
      signedInAt: now - f.seenAgo - 4 * H,
      lastSeenAt: now - f.seenAgo,
      status: f.st,
      rooms,
      ...(f.st === 'offline' ? { signedOutAt: now - f.seenAgo } : {}),
      ...(f.title ? { paneTitle: f.title } : {}),
    };
  });
}

/** `max ↔ stan`, this cast's busiest DM. */
export const FIXTURE_DM = DM_ROOM['max|stan']!;

/**
 * Rooms `chat:mark` has cleared this process. Without it the mark-read
 * controls the artboards draw on every surface do nothing here, and the
 * read/unread states that hang off the count -- the fold, above all -- are
 * unreachable, so a fixtures run can neither show nor audit them.
 */
const marked = new Set<string>();

/** `POST /api/chat/mark` under fixtures. No room clears every room: that is
    the sweep's own meaning everywhere else in this app. */
export function fixtureMark(room?: string): void {
  if (room) marked.add(room);
  else {
    for (const r of fixtureRooms()) marked.add(r.room);
  }
}

export function fixtureRooms(): (RoomSummary & {
  lastMessage?: { handle: string; body: string };
})[] {
  const repoRooms = (['rt', 'skills', 'boxscore', 'console'] as const).map(
    room => {
      const [mentions, unread] = ROOMS_META[room]!;
      const read = marked.has(room);
      return {
        room,
        memberCount: FLEET.filter(f => REPO_ROOMS[f.repo] === room).length,
        unread: read ? 0 : unread,
        mentions: read ? 0 : mentions,
      };
    }
  );
  const dmRooms = DMS.map(([a, c, unread]) => {
    const lastMessage = DM_LAST[`${a}|${c}`];
    const room = DM_ROOM[`${a}|${c}`]!;
    return {
      room,
      memberCount: 3,
      unread: marked.has(room) ? 0 : unread,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a, b: c },
      ...(lastMessage ? { lastMessage } : {}),
    };
  });
  return [...repoRooms, ...dmRooms];
}

export function fixtureMembers(room: string, now = Date.now()) {
  const buddies = fixtureBuddies(now);
  // A DM's membership is its participant pair, which is not discoverable
  // from `rooms` (that carries the literal tag "dm", never the room name).
  const dm = fixtureRooms().find(r => r.room === room && r.kind === 'dm');
  const inRoom = dm?.participants
    ? [dm.participants.a, dm.participants.b].filter(h => h !== 'matt')
    : buddies.filter(b => b.rooms.includes(room)).map(b => b.handle);

  return inRoom.map(handle => {
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
 * The same 40-error tsc log formula as `design/build.py`'s `_tsc_log()`: two
 * files of alternating `kind`/`glyph` TS2339s, so the #rt fixture below
 * carries the same long fenced code block the artboard folds behind
 * "show more".
 */
function tscLog(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const field = i % 2 ? 'kind' : 'glyph';
    lines.push(
      `commands/run.ts:${100 + i}:22 - error TS2339: Property '${field}' does not exist on type 'PickRow'.`
    );
  }
  for (let i = 1; i <= 20; i++) {
    const field = i % 2 ? 'kind' : 'glyph';
    lines.push(
      `commands/run-picker-rows.test.ts:${30 + i}:14 - error TS2339: Property '${field}' does not exist on type 'PickRow'.`
    );
  }
  lines.push('');
  lines.push('Found 40 errors in 2 files.');
  lines.push('error: script "type-check" exited with code 2');
  return lines.join('\n');
}

/**
 * The #rt artboard's transcript, verbatim (design/build.py's RT_MSGS): a
 * yesterday cluster then today's tsc-red thread, ending in the full log.
 * Any other room gets a one-line starter, since build.py only spells out
 * #rt's conversation in full.
 */
export function fixtureMessages(room: string, now = Date.now()): ChatMessage[] {
  if (room === 'rt') {
    const at = (minutesAgo: number) => now - minutesAgo * M;
    return [
      {
        id: 601,
        room,
        handle: 'wren',
        body: '@kai @max main is red on typecheck since #174 (f7880316): `lib/setup/tests/validators-rt-health.test.ts:71` references NOOP_FZF, which is not defined anywhere.',
        // >24h so it lands on a different calendar date than the closing
        // message no matter what time of day this runs.
        postedAt: at(1600),
        mentions: ['kai', 'max'],
      },
      {
        id: 602,
        room,
        handle: 'max',
        body: '@here checks CI on main is green again from 2aeb61f7: the NOOP_FZF typecheck red was my tool.rt test, and docs:check was the generated git/commit reference drifting. Re-run your required checks.',
        postedAt: at(1500),
        mentions: [],
      },
      {
        id: 603,
        room,
        handle: 'max',
        body: '@here Release-relevant, for whoever cuts 2.8.1: the first GUI create walkthrough of mattstack.app on a clean macOS 26 guest is green end to end tonight. Nothing tagged; Matt holds the tag.',
        postedAt: at(1400),
        mentions: [],
      },
      {
        id: 604,
        room,
        handle: 'max',
        body:
          'heads-up: main tsc is red since 85f18ee8 (picker: action rows). `commands/run.ts:106` and `run-picker-rows.test.ts` use `PickRow.kind` / `.glyph` but `lib/ui/protocol.ts` PickRow has neither field (only the PickRowKind type landed).\n\n' +
          '| check | state |\n| --- | --- |\n| typecheck | red since `85f18ee8` |\n| picker tests | 40 failures, same two fields |\n| audit corrections | green, untouched |\n\n' +
          'Whoever owns the picker lane: please add the two fields or hold run.ts back. Not touching it from my lane (audit corrections).',
        postedAt: at(10),
        mentions: [],
      },
      {
        id: 605,
        room,
        handle: 'matt',
        body: 'hold run.ts back until the fields land. @max post here when main is green again.',
        postedAt: at(6),
        mentions: ['max'],
      },
      {
        id: 606,
        room,
        handle: 'max',
        body:
          'reverting 85f18ee8 now. the full red, for the record:\n```\n' +
          tscLog() +
          '\n```',
        postedAt: at(4),
        mentions: [],
      },
    ];
  }

  // The Main artboard's own inbox thread: max's set-up, then jay's question
  // for Matt. The pair is what the reader draws, context message included.
  if (room === 'boxscore') {
    return [
      {
        id: 411,
        room,
        handle: 'max',
        body: '@jay when you pick metrics-hardening up: rt 2.8.1 moved the settings resolver, so read every knob through `getSetting`. Details in our DM.',
        postedAt: now - 99 * M,
        mentions: ['jay'],
      },
      {
        id: 412,
        room,
        handle: 'jay',
        body:
          '@matt metrics-hardening is ready for review: PR #12, 31 tests green.\n\n' +
          'What landed: p95 gauges on the ingest path, retry counters on the exporter, and `metrics.flushMs` read through `getSetting` at machine scope (max confirmed the scope in our DM).\n\n' +
          'Want the dashboard split into its own PR, or keep it in this one?',
        postedAt: now - 29 * M,
        mentions: ['matt'],
      },
    ];
  }

  // The artboard's second NEEDS YOU card: a DM Matt is not part of, which
  // still needs him because it names him.
  if (room === DM_ROOM['edie|stan']) {
    return [
      {
        id: 719,
        room,
        handle: 'stan',
        body: 'the console settings page is holding until 2.8.1 lands.',
        postedAt: now - 40 * M,
        mentions: [],
      },
      {
        id: 720,
        room,
        handle: 'edie',
        body: '@matt the loop needs a call: keep the skills compile step inside rt, or move it into the pack so acme owns it?',
        postedAt: now - 18 * M,
        mentions: ['matt'],
      },
    ];
  }

  return [
    {
      id: 1,
      room,
      handle: FLEET.find(f => REPO_ROOMS[f.repo] === room)?.h ?? 'max',
      body: 'start of this conversation',
      postedAt: now - 30 * M,
      mentions: [],
    },
  ];
}

/**
 * `/api/chat/inbox` under `CHAT_FIXTURES=1`: reuses `buildInbox` over
 * `fixtureRooms()`/`fixtureMessages()` rather than hand-authoring a payload,
 * so a change to the fixture tables stays reflected here for free.
 */
export function fixtureInbox(
  humanHandle: string,
  now = Date.now()
): InboxPayload {
  const rooms = fixtureRooms();
  const pagesByRoom = new Map<string, ChatMessage[]>();
  for (const room of rooms) {
    if (room.unread <= 0) continue;
    const messages = fixtureMessages(room.room, now);
    pagesByRoom.set(room.room, messages.slice(-Math.min(room.unread, 50)));
  }
  return buildInbox(rooms, pagesByRoom, humanHandle);
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

export function fixtureFocus(paneId: string): PaneFocusResult {
  return { paneId, focused: fixturePanes().some(p => p.paneId === paneId) };
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
