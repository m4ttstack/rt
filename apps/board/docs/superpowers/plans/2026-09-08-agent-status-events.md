# Agent Status Over Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three status CLIs publish each pane lifecycle transition on the rt daemon's event bus, the board consumes them from the bus journal by cursor, and the HTTP notify plus the `state/board-port` file are removed.

**Architecture:** A new `src/agent-status/emit.ts` wraps rt-client's `eventsEmit` for the CLIs. A new `src/agent-status/feed.ts` owns consumption: it keeps a cursor file, reads the journal past it, and hands each matching payload to the server's `handleAgentSignal`, which is the current `/agent/status` handler body extracted into a function. Relay pushes, boot, and the 60-second gate-sweep tick all just call the feed's `catchUp()`.

**Tech Stack:** Bun, TypeScript, `bun:test`, `@mattstack/rt-client` (`eventsEmit`, `eventsHead`, `eventsList`, `subscribe`).

**Spec:** `apps/board/docs/superpowers/specs/2026-09-08-agent-status-events-design.md`

## Global Constraints

- Topic is `board/agent-status/<kind>` with `<kind>` one of `review`, `respond`, `doctor`. Consumer glob is `board/agent-status/*`.
- Payload is `AgentSignal` plus `appRoot: string`; a board handles only payloads whose `appRoot` equals its own `APP_ROOT`.
- Cursor file is `state/agent-status-cursor` under `APP_ROOT`, holding one integer.
- First boot with no cursor file seeds from `eventsHead()` and replays nothing.
- The relay push is a wake-up only; the pushed frame's payload is never handled directly.
- Emit is best-effort: a daemon failure is one stderr line and never a non-zero CLI exit.
- No em dashes or en dashes anywhere (`~/.claude/rules/no-em-dashes.md`).
- Comments follow `~/.claude/rules/clean-code-comments.md`: constraints and whys only, no narration, no process references.
- The `--status-bin` verbs, their arguments, and their state-file writes are unchanged.
- No rt or daemon change.
- All commands run from `apps/board` inside the worktree. Checks: `bun test`, `bun run typecheck`, and from the repo root `bun run format:check`.
- Commit after every task with the message shown; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/agent-signal.ts` (modify) | Adds the topic helpers, the `AgentStatusPayload` type, and `parseAgentStatusPayload`. Loses `parseAgentSignal` in Task 5. |
| `src/agent-status/emit.ts` (create) | `emitAgentStatus(signal)`: the CLIs' one call, best-effort, stamps `appRoot`. |
| `src/agent-status/feed.ts` (create) | `AgentStatusFeed`: cursor, journal paging, `appRoot` filter, coalesced `catchUp()`, plus the cursor file helpers. |
| `bin/review-status.ts`, `bin/respond-status.ts`, `bin/doctor-status.ts` (modify) | Swap `notifyBoard` for `emitAgentStatus`. |
| `src/board-notify.ts` + `src/__tests__/board-notify.test.ts` (delete) | Replaced. |
| `src/server.ts` (modify) | `handleAgentSignal` extracted, HTTP routes and port-file write removed, feed wired to boot, relay, and sweep. |
| `src/__tests__/agent-signal.test.ts`, `agent-status-emit.test.ts`, `agent-status-feed.test.ts` | Contract, emit, and feed tests. |
| Four server-booting tests (comments only), `server-close.test.ts` (comment only) | Wording that referenced the port write and the HTTP handler. |
| `README.md`, `docs/agent-actions.md` (modify) | Describe the bus contract and the replay guarantee. |

---

### Task 1: Bus payload contract in `agent-signal.ts`

**Files:**
- Modify: `src/agent-signal.ts`
- Test: `src/__tests__/agent-signal.test.ts`

**Interfaces:**
- Consumes: existing `SignalKind`, `isSignalKind`, `AgentSignal`.
- Produces: `AGENT_STATUS_TOPIC_PREFIX: string` (`'board/agent-status/'`), `agentStatusTopic(kind: SignalKind): string`, `interface AgentStatusPayload extends AgentSignal { appRoot: string }`, `parseAgentStatusPayload(body: unknown): AgentStatusPayload | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/agent-signal.test.ts`, after the existing `isSignalKind` describe (leave the existing `parseAgentSignal` describe in place; Task 5 removes it). Add the new names to the import at the top of the file:

```ts
import {
  AGENT_STATUS_TOPIC_PREFIX,
  agentStatusTopic,
  isSignalKind,
  parseAgentSignal,
  parseAgentStatusPayload,
  signalEmoji,
  type AgentSignal,
  type AgentStatusPayload,
} from '../agent-signal.ts';
```

Then the new cases:

```ts
describe('agentStatusTopic', () => {
  test('one segment per launch kind under the shared prefix', () => {
    expect(AGENT_STATUS_TOPIC_PREFIX).toBe('board/agent-status/');
    expect(agentStatusTopic('review')).toBe('board/agent-status/review');
    expect(agentStatusTopic('respond')).toBe('board/agent-status/respond');
    expect(agentStatusTopic('doctor')).toBe('board/agent-status/doctor');
  });
});

describe('parseAgentStatusPayload', () => {
  const full: AgentStatusPayload = {
    mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
    iid: 4821,
    kind: 'review',
    status: 'done',
    outcome: 'comment',
    appRoot: '/Users/dev/board',
  };

  test('accepts exactly what the journal hands back for a done+comment signal', () => {
    expect(parseAgentStatusPayload(wireBody(full))).toEqual(full);
  });

  test('a payload with no outcome parses with outcome undefined', () => {
    const { outcome: _outcome, ...noOutcome } = full;
    expect(parseAgentStatusPayload(wireBody(noOutcome))).toEqual({
      ...noOutcome,
      outcome: undefined,
    });
  });

  test('rejects a missing or empty appRoot -- the pre-bus shape is not a bus payload', () => {
    const { appRoot: _appRoot, ...legacy } = full;
    expect(parseAgentStatusPayload(legacy)).toBeNull();
    expect(parseAgentStatusPayload({ ...full, appRoot: '' })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, appRoot: 7 })).toBeNull();
  });

  test('rejects a missing or empty mrUrl', () => {
    expect(parseAgentStatusPayload({ ...full, mrUrl: undefined })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, mrUrl: '' })).toBeNull();
  });

  test('rejects a kind that is not one of the three', () => {
    expect(parseAgentStatusPayload({ ...full, kind: 'deploy' })).toBeNull();
  });

  test('rejects a missing or empty status', () => {
    expect(parseAgentStatusPayload({ ...full, status: undefined })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, status: '' })).toBeNull();
  });

  test('rejects a non-numeric or non-finite iid', () => {
    expect(parseAgentStatusPayload({ ...full, iid: '4821' })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, iid: Infinity })).toBeNull();
    expect(parseAgentStatusPayload({ ...full, iid: NaN })).toBeNull();
  });

  test('rejects a non-string outcome', () => {
    expect(parseAgentStatusPayload({ ...full, outcome: 1 })).toBeNull();
  });

  test('rejects a non-object body', () => {
    expect(parseAgentStatusPayload(null)).toBeNull();
    expect(parseAgentStatusPayload('nope')).toBeNull();
    expect(parseAgentStatusPayload(42)).toBeNull();
  });
});
```

`wireBody` already exists in this file; its doc comment mentions `notifyBoard`. Change that comment to:

```ts
/** The CLI's payload rides the bus as JSON and comes back out of the journal
    the same way, so round-tripping through JSON here is exactly what the feed
    parses -- these tests break if either side of the contract drifts. */
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/__tests__/agent-signal.test.ts`
Expected: FAIL, `agentStatusTopic` and `parseAgentStatusPayload` are not exported.

- [ ] **Step 3: Implement**

Add to `src/agent-signal.ts`, after `isSignalKind`:

```ts
export const AGENT_STATUS_TOPIC_PREFIX = 'board/agent-status/';

/** One topic segment per launch kind, so a consumer matches all three with
    the single-segment glob `board/agent-status/*`. */
export function agentStatusTopic(kind: SignalKind): string {
  return `${AGENT_STATUS_TOPIC_PREFIX}${kind}`;
}
```

And after the `AgentSignal` interface:

```ts
/** `AgentSignal` as it rides the bus. The bus is machine-wide, so a board
    handles only payloads its own status-bin emitted: `appRoot` is the
    emitting CLI's APP_ROOT, which is the launching board's by construction. */
export interface AgentStatusPayload extends AgentSignal {
  appRoot: string;
}

/** The bus contract every CLI in bin/ emits and the feed consumes. A payload
    with no `appRoot` is not a bus payload and is refused rather than guessed
    at, because handling it on the wrong board posts a latch twice. */
export function parseAgentStatusPayload(
  body: unknown
): AgentStatusPayload | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid, kind, status, outcome, appRoot } = body as Record<
    string,
    unknown
  >;
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof appRoot !== 'string' || !appRoot) return null;
  if (!isSignalKind(kind)) return null;
  if (typeof status !== 'string' || !status) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  if (outcome !== undefined && typeof outcome !== 'string') return null;
  return {
    mrUrl,
    iid,
    kind,
    status,
    outcome: outcome as string | undefined,
    appRoot,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/__tests__/agent-signal.test.ts && bun run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent-signal.ts src/__tests__/agent-signal.test.ts
git commit -m "board: bus payload contract for agent status"
```

---

### Task 2: `emitAgentStatus` in `src/agent-status/emit.ts`

**Files:**
- Create: `src/agent-status/emit.ts`
- Test: `src/__tests__/agent-status-emit.test.ts`

**Interfaces:**
- Consumes: `agentStatusTopic`, `AgentSignal`, `AgentStatusPayload` (Task 1); `APP_ROOT` from `src/app-root.ts`; `eventsEmit(topic, payload)` from `@mattstack/rt-client`, returning `Promise<{ ok: boolean; data?: { id: number }; error?: string }>`.
- Produces: `interface EmitIo { emit(topic: string, payload: unknown): Promise<{ ok: boolean; error?: string }>; appRoot: string; log(line: string): void }` and `emitAgentStatus(signal: AgentSignal, io?: EmitIo): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/agent-status-emit.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { emitAgentStatus, type EmitIo } from '../agent-status/emit.ts';

const SIGNAL = {
  mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
  iid: 4821,
  kind: 'review' as const,
  status: 'done',
  outcome: 'comment',
};

function fakeIo(
  emit: EmitIo['emit']
): EmitIo & { lines: string[]; calls: { topic: string; payload: unknown }[] } {
  const lines: string[] = [];
  const calls: { topic: string; payload: unknown }[] = [];
  return {
    emit: (topic, payload) => {
      calls.push({ topic, payload });
      return emit(topic, payload);
    },
    appRoot: '/Users/dev/board',
    log: line => lines.push(line),
    lines,
    calls,
  };
}

const accepted = async () => ({ ok: true });

describe('emitAgentStatus', () => {
  test('emits on the kind topic with the signal plus this board root', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus(SIGNAL, io);
    expect(io.calls).toEqual([
      {
        topic: 'board/agent-status/review',
        payload: { ...SIGNAL, appRoot: '/Users/dev/board' },
      },
    ]);
    expect(io.lines).toEqual([]);
  });

  test('respond and doctor land on their own topics', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus({ ...SIGNAL, kind: 'respond' }, io);
    await emitAgentStatus({ ...SIGNAL, kind: 'doctor', outcome: undefined }, io);
    expect(io.calls.map(c => c.topic)).toEqual([
      'board/agent-status/respond',
      'board/agent-status/doctor',
    ]);
  });

  test('skips the emit entirely when there is no mrUrl to act on', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus({ ...SIGNAL, mrUrl: '' }, io);
    expect(io.calls).toEqual([]);
  });

  test('a refused emit resolves and logs one line', async () => {
    const io = fakeIo(async () => ({ ok: false, error: 'daemon unreachable' }));
    await expect(emitAgentStatus(SIGNAL, io)).resolves.toBeUndefined();
    expect(io.lines).toEqual([
      'agent-status emit refused: daemon unreachable',
    ]);
  });

  test('a throwing emit resolves and logs one line', async () => {
    const io = fakeIo(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(emitAgentStatus(SIGNAL, io)).resolves.toBeUndefined();
    expect(io.lines).toEqual(['agent-status emit failed: ECONNREFUSED']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/__tests__/agent-status-emit.test.ts`
Expected: FAIL, cannot resolve `../agent-status/emit.ts`.

- [ ] **Step 3: Implement**

Create `src/agent-status/emit.ts`:

```ts
import { eventsEmit } from '@mattstack/rt-client';

import {
  agentStatusTopic,
  type AgentSignal,
  type AgentStatusPayload,
} from '../agent-signal.ts';
import { APP_ROOT } from '../app-root.ts';

export interface EmitIo {
  emit(
    topic: string,
    payload: unknown
  ): Promise<{ ok: boolean; error?: string }>;
  appRoot: string;
  log(line: string): void;
}

const defaultIo: EmitIo = {
  emit: (topic, payload) => eventsEmit(topic, payload),
  appRoot: APP_ROOT,
  log: line => console.error(line),
};

/** Publish one lifecycle transition on the rt bus. Best-effort by design: the
    state file the CLI already wrote is the source of truth, so a daemon that
    is down costs one stderr line and never the CLI's exit status. */
export async function emitAgentStatus(
  signal: AgentSignal,
  io: EmitIo = defaultIo
): Promise<void> {
  if (!signal.mrUrl) return;
  const payload: AgentStatusPayload = { ...signal, appRoot: io.appRoot };
  try {
    const res = await io.emit(agentStatusTopic(signal.kind), payload);
    if (!res.ok)
      io.log(`agent-status emit refused: ${res.error ?? 'unknown error'}`);
  } catch (err) {
    io.log(
      `agent-status emit failed: ${err instanceof Error ? err.message : err}`
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/__tests__/agent-status-emit.test.ts && bun run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent-status/emit.ts src/__tests__/agent-status-emit.test.ts
git commit -m "board: add src/agent-status/emit.ts"
```

---

### Task 3: `AgentStatusFeed` in `src/agent-status/feed.ts`

**Files:**
- Create: `src/agent-status/feed.ts`
- Test: `src/__tests__/agent-status-feed.test.ts`

**Interfaces:**
- Consumes: `AGENT_STATUS_TOPIC_PREFIX`, `parseAgentStatusPayload`, `AgentSignal` (Task 1).
- Produces:
  - `AGENT_STATUS_PATTERN = 'board/agent-status/*'`
  - `PAGE_LIMIT = 500`
  - `isAgentStatusTopic(topic: unknown): topic is string`
  - `interface JournalEvent { id: number; topic: string; payload: unknown }`
  - `interface AgentStatusFeedIo { eventsHead(): Promise<{ ok: boolean; data?: { cursor: number }; error?: string }>; eventsList(after: number, limit: number): Promise<{ ok: boolean; data?: { events: JournalEvent[] }; error?: string }>; readCursor(): number | null; writeCursor(cursor: number): void; handle(signal: AgentSignal): Promise<void>; appRoot: string; log(line: string): void }`
  - `class AgentStatusFeed { constructor(io: AgentStatusFeedIo); catchUp(): Promise<void> }`
  - `readCursorFile(path: string): number | null`, `writeCursorFile(path: string, cursor: number): void`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/agent-status-feed.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { AgentSignal } from '../agent-signal.ts';
import {
  AgentStatusFeed,
  isAgentStatusTopic,
  PAGE_LIMIT,
  readCursorFile,
  writeCursorFile,
  type AgentStatusFeedIo,
  type JournalEvent,
} from '../agent-status/feed.ts';

const ROOT = '/Users/dev/board';
const MR = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

function event(
  id: number,
  overrides: Partial<{ topic: string; payload: unknown }> = {}
): JournalEvent {
  return {
    id,
    topic: 'board/agent-status/review',
    payload: {
      mrUrl: MR,
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
      appRoot: ROOT,
    },
    ...overrides,
  };
}

interface Harness {
  io: AgentStatusFeedIo;
  feed: AgentStatusFeed;
  handled: AgentSignal[];
  cursors: number[];
  lists: { after: number; limit: number }[];
  headCalls: number;
  lines: string[];
}

function harness(opts: {
  stored?: number | null;
  head?: number;
  pages?: JournalEvent[][];
  headOk?: boolean;
  listOk?: boolean;
  handle?: (signal: AgentSignal) => Promise<void>;
}): Harness {
  const pages = [...(opts.pages ?? [[]])];
  const h: Harness = {
    handled: [],
    cursors: [],
    lists: [],
    headCalls: 0,
    lines: [],
  } as Harness;
  h.io = {
    eventsHead: async () => {
      h.headCalls++;
      return opts.headOk === false
        ? { ok: false, error: 'daemon down' }
        : { ok: true, data: { cursor: opts.head ?? 100 } };
    },
    eventsList: async (after, limit) => {
      h.lists.push({ after, limit });
      if (opts.listOk === false) return { ok: false, error: 'daemon down' };
      return { ok: true, data: { events: pages.shift() ?? [] } };
    },
    readCursor: () => opts.stored ?? null,
    writeCursor: c => h.cursors.push(c),
    handle:
      opts.handle ??
      (async signal => {
        h.handled.push(signal);
      }),
    appRoot: ROOT,
    log: line => h.lines.push(line),
  };
  h.feed = new AgentStatusFeed(h.io);
  return h;
}

describe('isAgentStatusTopic', () => {
  test('matches the prefix and nothing else', () => {
    expect(isAgentStatusTopic('board/agent-status/review')).toBe(true);
    expect(isAgentStatusTopic('gate/opened/abc')).toBe(false);
    expect(isAgentStatusTopic(undefined)).toBe(false);
  });
});

describe('AgentStatusFeed.catchUp', () => {
  test('first boot seeds the cursor from head and replays nothing', async () => {
    const h = harness({ stored: null, head: 2439 });
    await h.feed.catchUp();
    expect(h.headCalls).toBe(1);
    expect(h.cursors).toEqual([2439]);
    expect(h.lists).toEqual([{ after: 2439, limit: PAGE_LIMIT }]);
    expect(h.handled).toEqual([]);
  });

  test('a stored cursor is used and head is never asked', async () => {
    const h = harness({ stored: 41, pages: [[event(42)]] });
    await h.feed.catchUp();
    expect(h.headCalls).toBe(0);
    expect(h.lists[0]).toEqual({ after: 41, limit: PAGE_LIMIT });
    expect(h.handled.map(s => s.mrUrl)).toEqual([MR]);
  });

  test('handles in id order and advances the cursor after each event', async () => {
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12, { topic: 'board/agent-status/doctor' })]],
    });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(2);
    expect(h.cursors).toEqual([11, 12]);
  });

  test('the handled signal carries no appRoot', async () => {
    const h = harness({ stored: 10, pages: [[event(11)]] });
    await h.feed.catchUp();
    expect(h.handled[0]).toEqual({
      mrUrl: MR,
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
    });
  });

  test('another board root is skipped and still advances the cursor', async () => {
    const other = event(11);
    (other.payload as { appRoot: string }).appRoot = '/Users/dev/other';
    const h = harness({ stored: 10, pages: [[other, event(12)]] });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(1);
    expect(h.cursors).toEqual([11, 12]);
  });

  test('a malformed payload is dropped with one line and still advances', async () => {
    const h = harness({
      stored: 10,
      pages: [[event(11, { payload: { nope: true } }), event(12)]],
    });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(1);
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      'agent-status feed: dropped malformed event #11 on board/agent-status/review',
    ]);
  });

  test('a handler throw is logged, the cursor advances, and the next event is still handled', async () => {
    let calls = 0;
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12)]],
      handle: async () => {
        calls++;
        if (calls === 1) throw new Error('slack exploded');
      },
    });
    await h.feed.catchUp();
    expect(calls).toBe(2);
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      `agent-status feed: handler failed on #11 (${MR}): slack exploded`,
    ]);
  });

  test('pages through a full page and stops on a short one', async () => {
    const full = Array.from({ length: PAGE_LIMIT }, (_, i) => event(11 + i));
    const h = harness({ stored: 10, pages: [full, [event(11 + PAGE_LIMIT)]] });
    await h.feed.catchUp();
    expect(h.lists.map(l => l.after)).toEqual([10, 10 + PAGE_LIMIT]);
    expect(h.handled.length).toBe(PAGE_LIMIT + 1);
  });

  test('a journal read failure is logged and the cursor is untouched', async () => {
    const h = harness({ stored: 10, listOk: false });
    await h.feed.catchUp();
    expect(h.cursors).toEqual([]);
    expect(h.lines).toEqual([
      'agent-status feed: journal read failed: daemon down',
    ]);
  });

  test('a head failure on first boot is logged and nothing is read', async () => {
    const h = harness({ stored: null, headOk: false });
    await h.feed.catchUp();
    expect(h.lists).toEqual([]);
    expect(h.cursors).toEqual([]);
    expect(h.lines).toEqual([
      'agent-status feed: cursor seed failed: daemon down',
    ]);
  });

  test('concurrent wake-ups coalesce into one running pass plus one follow-up', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    const h = harness({
      stored: 10,
      pages: [[event(11)], [event(12)], [event(13)]],
      handle: async signal => {
        h.handled.push(signal);
        if (signal.iid === 4821 && h.handled.length === 1) await gate;
      },
    });
    const first = h.feed.catchUp();
    const second = h.feed.catchUp();
    const third = h.feed.catchUp();
    release();
    await Promise.all([first, second, third]);
    expect(h.lists.length).toBe(2);
    expect(h.handled.length).toBe(2);
  });
});

describe('cursor file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'asf-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('round-trips an integer', () => {
    const path = join(dir, 'agent-status-cursor');
    writeCursorFile(path, 2439);
    expect(readCursorFile(path)).toBe(2439);
  });

  test('missing, empty, or garbage reads as null', () => {
    const path = join(dir, 'agent-status-cursor');
    expect(readCursorFile(path)).toBeNull();
    writeFileSync(path, '');
    expect(readCursorFile(path)).toBeNull();
    writeFileSync(path, 'banana');
    expect(readCursorFile(path)).toBeNull();
  });

  test('creates the parent directory on write', () => {
    const path = join(dir, 'state', 'agent-status-cursor');
    writeCursorFile(path, 7);
    expect(readCursorFile(path)).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/__tests__/agent-status-feed.test.ts`
Expected: FAIL, cannot resolve `../agent-status/feed.ts`.

- [ ] **Step 3: Implement**

Create `src/agent-status/feed.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import {
  AGENT_STATUS_TOPIC_PREFIX,
  parseAgentStatusPayload,
  type AgentSignal,
} from '../agent-signal.ts';

export const AGENT_STATUS_PATTERN = 'board/agent-status/*';
export const PAGE_LIMIT = 500;

export function isAgentStatusTopic(topic: unknown): topic is string {
  return (
    typeof topic === 'string' && topic.startsWith(AGENT_STATUS_TOPIC_PREFIX)
  );
}

export interface JournalEvent {
  id: number;
  topic: string;
  payload: unknown;
}

export interface AgentStatusFeedIo {
  eventsHead(): Promise<{
    ok: boolean;
    data?: { cursor: number };
    error?: string;
  }>;
  eventsList(
    after: number,
    limit: number
  ): Promise<{ ok: boolean; data?: { events: JournalEvent[] }; error?: string }>;
  readCursor(): number | null;
  writeCursor(cursor: number): void;
  handle(signal: AgentSignal): Promise<void>;
  appRoot: string;
  log(line: string): void;
}

/**
 * The only path by which a status signal reaches the board. Every trigger
 * (boot, a relay push, the sweep tick) reads the journal past the cursor
 * rather than trusting what it was handed, so live delivery and replay
 * share one ordering and a push that arrives mid-reconnect costs nothing.
 *
 * The cursor advances after every event, handled or skipped, so a poison
 * event can never wedge the feed: the sweeps remain the backstop for the
 * one MR whose handler threw.
 */
export class AgentStatusFeed {
  private cursor: number | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(private readonly io: AgentStatusFeedIo) {}

  /** Concurrent calls coalesce: one pass runs and at most one more is
      queued behind it, so a burst of wake-ups costs two reads, not N. */
  catchUp(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    do {
      this.rerun = false;
      await this.pass();
    } while (this.rerun);
  }

  private async pass(): Promise<void> {
    let after = await this.resolveCursor();
    if (after === null) return;
    for (;;) {
      const res = await this.io.eventsList(after, PAGE_LIMIT);
      if (!res.ok || !res.data) {
        this.io.log(
          `agent-status feed: journal read failed: ${res.error ?? 'unknown error'}`
        );
        return;
      }
      for (const ev of res.data.events) {
        await this.handleOne(ev);
        this.advance(ev.id);
        after = ev.id;
      }
      if (res.data.events.length < PAGE_LIMIT) return;
    }
  }

  /** A board that has never run the feed starts at the journal head:
      nothing emitted before it existed is a transition it owes a reaction. */
  private async resolveCursor(): Promise<number | null> {
    if (this.cursor !== null) return this.cursor;
    const stored = this.io.readCursor();
    if (stored !== null) {
      this.cursor = stored;
      return stored;
    }
    const head = await this.io.eventsHead();
    if (!head.ok || !head.data) {
      this.io.log(
        `agent-status feed: cursor seed failed: ${head.error ?? 'unknown error'}`
      );
      return null;
    }
    this.advance(head.data.cursor);
    return head.data.cursor;
  }

  private advance(id: number): void {
    this.cursor = id;
    this.io.writeCursor(id);
  }

  private async handleOne(ev: JournalEvent): Promise<void> {
    if (!isAgentStatusTopic(ev.topic)) return;
    const payload = parseAgentStatusPayload(ev.payload);
    if (!payload) {
      this.io.log(
        `agent-status feed: dropped malformed event #${ev.id} on ${ev.topic}`
      );
      return;
    }
    if (payload.appRoot !== this.io.appRoot) return;
    const { appRoot: _appRoot, ...signal } = payload;
    try {
      await this.io.handle(signal);
    } catch (err) {
      this.io.log(
        `agent-status feed: handler failed on #${ev.id} (${signal.mrUrl}): ${err instanceof Error ? err.message : err}`
      );
    }
  }
}

export function readCursorFile(path: string): number | null {
  try {
    const n = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeCursorFile(path: string, cursor: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(cursor));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/__tests__/agent-status-feed.test.ts && bun run typecheck`
Expected: all PASS, typecheck clean. If the coalescing test flakes on ordering, the fix is in the test's release timing, never in the feed.

- [ ] **Step 5: Commit**

```bash
git add src/agent-status/feed.ts src/__tests__/agent-status-feed.test.ts
git commit -m "board: add src/agent-status/feed.ts, the journal-cursor consumer"
```

---

### Task 4: CLIs emit on the bus; `board-notify.ts` retires

**Files:**
- Modify: `bin/review-status.ts`, `bin/respond-status.ts`, `bin/doctor-status.ts`
- Delete: `src/board-notify.ts`, `src/__tests__/board-notify.test.ts`

**Interfaces:**
- Consumes: `emitAgentStatus(signal)` (Task 2).
- Produces: nothing new. After this task the CLIs no longer POST anywhere; the server side lands in Task 5.

- [ ] **Step 1: Confirm nothing else imports the module**

Run: `grep -rn "board-notify" src bin scripts tests`
Expected: only the three CLIs and the module's own test.

- [ ] **Step 2: Swap the call in each CLI**

In `bin/review-status.ts`, replace the first import line:

```ts
import { emitAgentStatus } from '../src/agent-status/emit.ts';
```

and the trailing call:

```ts
await emitAgentStatus({
  mrUrl: state.mrUrl,
  iid: state.iid,
  kind: 'review',
  status,
  outcome,
});
```

In `bin/respond-status.ts`, replace the first import line:

```ts
import { emitAgentStatus } from '../src/agent-status/emit.ts';
```

and the trailing call:

```ts
await emitAgentStatus({
  mrUrl: state.mrUrl,
  iid: state.iid,
  kind: 'respond',
  status: parsed.status,
  outcome: respondOutcome(state.posted, state.threads),
});
```

In `bin/doctor-status.ts`, replace the first import line:

```ts
import { emitAgentStatus } from '../src/agent-status/emit.ts';
```

and the call after `writeDoctorState`:

```ts
await emitAgentStatus({
  mrUrl: state.mrUrl,
  iid: state.iid,
  kind: 'doctor',
  status,
});
```

- [ ] **Step 3: Delete the retired module and its test**

```bash
git rm src/board-notify.ts src/__tests__/board-notify.test.ts
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: typecheck clean, full suite green.

Then a live emit from the checkout against the real daemon, with a throwaway state file so nothing on a real board reacts:

```bash
mkdir -p "$TMPDIR/asf" && printf '{"mrUrl":"https://example.invalid/-/merge_requests/1","iid":1,"status":"queued","startedAt":0,"updatedAt":0}\n' > "$TMPDIR/asf/x.json"
bun run bin/review-status.ts "$TMPDIR/asf/x.json" reviewing
rt events list 'board/agent-status/review' --limit 1
```

Expected: the CLI exits 0 with no stderr, and the list shows the `reviewing` payload for `example.invalid` carrying this checkout's path as `appRoot`.

- [ ] **Step 5: Commit**

```bash
git add bin/review-status.ts bin/respond-status.ts bin/doctor-status.ts
git commit -m "board: status CLIs emit on the rt bus, retire board-notify"
```

---

### Task 5: Server consumes the feed; HTTP routes and port file retire

**Files:**
- Modify: `src/server.ts` (imports near line 14 and 26; the `/agent/status` and `/review/outcome` case starting at the line `case '/agent/status':`; the port-file write block that begins with the comment `// The board's real port can differ from config.json when $PORT is set`; the `runGateSweep` interval; the relay `subscribe` callback; the `if (!FIXTURE_DIR)` boot block containing `reconcileGatesOnBoot`)
- Modify: `src/agent-signal.ts` (remove `parseAgentSignal`)
- Modify: `src/__tests__/agent-signal.test.ts` (remove the `parseAgentSignal` describe and `noLookup`)
- Modify comments only: `src/__tests__/fixture-mode.test.ts`, `src/__tests__/server-healthz-fast.test.ts`, `src/__tests__/server-sigterm.test.ts`, `src/__tests__/server-slack-channel.test.ts`, `src/__tests__/server-close.test.ts`

**Interfaces:**
- Consumes: `AgentStatusFeed`, `AGENT_STATUS_PATTERN`, `isAgentStatusTopic`, `readCursorFile`, `writeCursorFile` (Task 3); `eventsHead`, `eventsList` from `@mattstack/rt-client`; `type AgentSignal` (existing).
- Produces: `handleAgentSignal(signal: AgentSignal): Promise<void>` inside `src/server.ts`, and the module-level `agentStatusFeed`.

- [ ] **Step 1: Remove the old contract and its tests**

In `src/__tests__/agent-signal.test.ts`, delete `noLookup`, the whole `describe('parseAgentSignal', ...)` block, and `parseAgentSignal` from the import. Keep `wireBody` (Task 1's tests use it).

In `src/agent-signal.ts`, delete `parseAgentSignal` and its doc comment.

Run: `bun test src/__tests__/agent-signal.test.ts`
Expected: PASS. Run `bun run typecheck` and expect exactly one failure: `src/server.ts` importing `parseAgentSignal`. That is the failing state the next steps fix.

- [ ] **Step 2: Imports in `src/server.ts`**

In the `@mattstack/rt-client` import list (the block ending `} from '@mattstack/rt-client';` near line 22), add `eventsHead,` and `eventsList,` in alphabetical position (after `agentStart`-style names, before `gateList`).

Replace the line

```ts
import { parseAgentSignal, signalEmoji } from './agent-signal.ts';
```

with

```ts
import { signalEmoji, type AgentSignal } from './agent-signal.ts';
import {
  AGENT_STATUS_PATTERN,
  AgentStatusFeed,
  isAgentStatusTopic,
  readCursorFile,
  writeCursorFile,
} from './agent-status/feed.ts';
```

- [ ] **Step 3: Extract the handler**

Find the block that begins with `case '/agent/status':` (with the retained-belt-and-braces comment above `case '/review/outcome': {`) and ends with the closing `}` immediately before `case '/draft': {`. Delete that whole block from the request switch.

Insert the following function at module level directly above `async function runGateSweep(): Promise<void> {`. It is the deleted body with the request parsing gone and every `return new Response(...)` turned into a plain return or a log line; the peer relay, latch, close, and Slack sections keep their existing comments and order.

```ts
/** What one lifecycle transition means to this board. Fed only by the
    agent-status feed, in journal order; a replayed `done` is safe because
    every step here is idempotent (a latch is posted only when none is armed,
    a repeated Slack reaction is a no-op, a cleared tabId is cleared). */
async function handleAgentSignal(signal: AgentSignal): Promise<void> {
  // Peer sync: tell the MR author's board where this review stands. Runs
  // before the emoji early-return below, so transitions that map to no
  // emoji still sync. Own policy (slack reactions) continues after; this
  // is pure relay traffic.
  // `defaultMember: "all"` is a view setting, not an identity, so there is
  // no way to tell this board's own MRs from a peer's. Without that, the
  // own-MR guard below can never match and the board would relay a
  // review-state for every MR on it, including publishing to itself.
  const pc = peering.current()?.client;
  if (pc && signal.kind === 'review' && config.defaultMember !== 'all') {
    const snapshotForPeer = await cache.get();
    const authorUsername = snapshotForPeer.mrs.find(
      m => m.webUrl === signal.mrUrl
    )?.author.username;
    // Never relay a review of this board's own MR: the author is right
    // here, and the peer state files are for other people's boards.
    if (
      authorUsername &&
      canonicalUsername(authorUsername) !==
        canonicalUsername(config.defaultMember)
    ) {
      enqueueOutbox(
        makeEnvelope(authorUsername, 'review-state', {
          mrUrl: signal.mrUrl,
          iid: signal.iid,
          status: signal.status,
          outcome: signal.outcome,
          updatedAt: Date.now(),
        } satisfies ReviewStatePayload)
      );
      kickOutbox(pc);
    }
  }
  // Arm a latch when a review lands with a comment outcome, spend it when
  // one lands approved. Best-effort, like every other side effect here:
  // the triage latch pass reconciles anything a down or throwing board
  // misses, so a failure must never fail the agent's status write.
  if (signal.kind === 'review' && signal.status === 'done' && gitlabToken) {
    try {
      const snapshot = await cache.get();
      const mr = snapshot.mrs.find(m => m.webUrl === signal.mrUrl);
      if (mr) {
        const projectId = parseRepoId(mr.repositoryId);
        const projectPath =
          projectPathFromWebUrl(signal.mrUrl, config.gitlabHost) ?? '';
        const gw = latchGateway(config.gitlabHost, gitlabToken);
        // Arming honours board.reReview; spending never does, since a
        // latch left armed on a team that switched re-review off is a
        // promise nothing keeps.
        if (signal.outcome === 'comment' && loadReReviewConfig().enabled) {
          const detail = await readLatchDetail(mr);
          // A live latch (armed, either resolved or not) already exists
          // for this MR -- a spent one must never suppress a fresh post,
          // or the feature disables itself forever the first time a
          // latch is ever spent.
          if (detail && !hasArmedLatch(findLatches(detail))) {
            await postLatch(gw, projectId, projectPath, signal.mrUrl, mr.iid);
          }
        } else if (signal.outcome === 'approve') {
          const detail = await readLatchDetail(mr);
          // Every latch found, not just the canonical one: an armed
          // duplicate left behind here is unreachable to the triage
          // pass's repair step once the canon it stops at is spent.
          if (detail)
            await spendAllLatches(
              gw,
              projectId,
              projectPath,
              mr.iid,
              findLatches(detail)
            );
        }
      }
    } catch (err) {
      console.error(
        `latch step failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  // Close the launched pane's tab once its agent reports done -- error
  // never closes, so a failing pane stays open for forensics. Must run
  // above the emoji early-return below: most `done` signals have no
  // emoji and would never reach a close placed after it.
  closeOnDone(
    signal,
    resolveSignalTabId,
    tabId => closeTab(tabId),
    clearSignalTabId
  );
  const emoji = signalEmoji(
    signal.kind,
    signal.status,
    config.slack.emoji,
    signal.outcome
  );
  // Most transitions map to no emoji at all (see signalEmoji), and a
  // Slack-less install has nothing to react with.
  if (!emoji || !slackToken) return;
  // The sweeper usually resolves the ref first, but a review launched and
  // finished inside one sweep interval can beat it here.
  try {
    const signalSnapshot = await cache.get();
    const signalMr = signalSnapshot.mrs.find(m => m.webUrl === signal.mrUrl);
    const signalChannel = signalMr
      ? channelForMR(config, signalMr)
      : config.slack.channel;
    const existing = readSlackRefs().get(signal.mrUrl);
    if (existing?.status !== 'found' || !existing.messageTs) {
      await resolveSlackRef(slackToken, signalChannel, signal.mrUrl, signal.iid);
    }
    await reactToMR(slackToken, signal.mrUrl, emoji);
  } catch (err) {
    console.error(
      `slack react failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`
    );
  }
}
```

Every identifier in that body (`peering`, `cache`, `config`, `canonicalUsername`, `enqueueOutbox`, `makeEnvelope`, `kickOutbox`, `ReviewStatePayload`, `gitlabToken`, `parseRepoId`, `projectPathFromWebUrl`, `latchGateway`, `loadReReviewConfig`, `readLatchDetail`, `hasArmedLatch`, `findLatches`, `postLatch`, `spendAllLatches`, `closeOnDone`, `resolveSignalTabId`, `closeTab`, `clearSignalTabId`, `slackToken`, `channelForMR`, `readSlackRefs`, `resolveSlackRef`, `reactToMR`) already exists in `server.ts`; the deleted block used the same names. If typecheck reports one missing, it was in scope of the old block under that name and must be found there, not invented.

- [ ] **Step 4: Remove the port-file write**

Delete the block that starts with the comment line `// The board's real port can differ from config.json when $PORT is set (see` and ends with the closing `}` of its `catch`, including the `try { const boardPortDir = join(APP_ROOT, 'state'); ... }` body. Nothing replaces it.

- [ ] **Step 5: Wire the feed**

Directly below the `handleAgentSignal` function, add:

```ts
const AGENT_STATUS_CURSOR_PATH = join(APP_ROOT, 'state', 'agent-status-cursor');

const agentStatusFeed = new AgentStatusFeed({
  eventsHead: () => eventsHead(),
  eventsList: (after, limit) =>
    eventsList({ pattern: AGENT_STATUS_PATTERN, after, limit }),
  readCursor: () => readCursorFile(AGENT_STATUS_CURSOR_PATH),
  writeCursor: cursor => writeCursorFile(AGENT_STATUS_CURSOR_PATH, cursor),
  handle: handleAgentSignal,
  appRoot: APP_ROOT,
  log: line => console.error(line),
});

function wakeAgentStatusFeed(): void {
  void agentStatusFeed.catchUp().catch(err =>
    console.error(
      `agent-status feed failed: ${err instanceof Error ? err.message : err}`
    )
  );
}
```

In the gate-sweep interval, add the wake after the sweep so the tick is the at-most-60s fallback the spec promises:

```ts
if (!FIXTURE_DIR) {
  setInterval(() => {
    void runGateSweep().catch(err =>
      console.error(
        `gate sweep failed: ${err instanceof Error ? err.message : err}`
      )
    );
    wakeAgentStatusFeed();
  }, GATE_SWEEP_MS);
}
```

In the relay `subscribe` callback, inside `if (type === 'event') {` and inside `if (typeof frame?.topic === 'string') {`, add after the gate ingest and the `gate/answered/` block:

```ts
          // The push is a wake-up, never the delivery: the journal is read
          // from the cursor so a frame that raced a reconnect is not lost.
          if (isAgentStatusTopic(frame.topic)) wakeAgentStatusFeed();
```

In the boot block `if (!FIXTURE_DIR) {` that calls `reconcileGatesOnBoot` and `bootResumePass`, add as a third statement:

```ts
  // Replays every transition emitted while the board was down.
  wakeAgentStatusFeed();
```

- [ ] **Step 6: Update the test comments**

In `src/__tests__/fixture-mode.test.ts`, replace the two comment lines above `env: {` with:

```ts
    // BOARD_APP_ROOT keeps the booted server's state writes out of the repo.
```

In `src/__tests__/server-healthz-fast.test.ts`, replace the two comment lines above `BOARD_APP_ROOT: fakeHome,` with:

```ts
      // Keeps the booted server's state writes out of the repo.
```

In `src/__tests__/server-sigterm.test.ts`, replace the two comment lines above `BOARD_APP_ROOT: fakeHome,` with:

```ts
      // Keeps the booted server's state writes out of the repo.
```

In `src/__tests__/server-slack-channel.test.ts`, replace the comment line above `BOARD_APP_ROOT: fakeHome,` with:

```ts
      // Keeps the booted server's state writes out of the repo.
```

In `src/__tests__/server-close.test.ts` line 77, change `the /agent/status handler` to `handleAgentSignal`.

- [ ] **Step 7: Verify**

Run: `bun run typecheck && bun test`
Expected: typecheck clean, full suite green (the server-booting tests exercise the new imports and the removed routes).

Then confirm the routes are gone and nothing references the port file:

```bash
grep -n "agent/status\|review/outcome\|board-port\|readBoardPort\|notifyBoard" src/server.ts src/*.ts bin/*.ts
```

Expected: no output.

Then a live smoke against the real daemon from this worktree, without touching the deck board. Boot this checkout's server on a scratch port with an isolated root, emit a signal whose `appRoot` is that root, and watch the feed pick it up and write its cursor:

```bash
export SMOKE_ROOT="$TMPDIR/asf-root" && mkdir -p "$SMOKE_ROOT"
BOARD_APP_ROOT="$SMOKE_ROOT" PORT=47950 bun run src/server.ts > "$SMOKE_ROOT/out.log" 2> "$SMOKE_ROOT/err.log" &
sleep 4
cat "$SMOKE_ROOT/state/agent-status-cursor"; echo
bun -e "import { eventsEmit } from '@mattstack/rt-client'; const r = await eventsEmit('board/agent-status/doctor', { mrUrl: 'https://example.invalid/-/merge_requests/1', iid: 1, kind: 'doctor', status: 'diagnosing', appRoot: process.env.SMOKE_ROOT }); console.log(r)"
sleep 2
cat "$SMOKE_ROOT/state/agent-status-cursor"; echo
kill %1
```

Expected: the first `cat` prints the journal head at boot (the seed); the second prints the emitted event's id, which is larger; `err.log` carries no `agent-status feed` line. A `doctor`/`diagnosing` signal for an MR the board does not show has no side effects beyond the cursor advance, which is the point.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/agent-signal.ts src/__tests__/agent-signal.test.ts src/__tests__/fixture-mode.test.ts src/__tests__/server-healthz-fast.test.ts src/__tests__/server-sigterm.test.ts src/__tests__/server-slack-channel.test.ts src/__tests__/server-close.test.ts
git commit -m "board: consume agent status from the bus journal, retire /agent/status and the port file"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (the "Agent actions" paragraph beginning `The board injects the domain skill and a status-writer path as flags`)
- Modify: `docs/agent-actions.md` (the paragraph beginning `The wrapper emits \`reviewing\` / \`done\` / \`error\` to a state file`)

**Interfaces:** none.

- [ ] **Step 1: README**

Replace the paragraph

```
The board injects the domain skill and a status-writer path as flags, so the
wrapper skills carry no repo- or team-specific knowledge. The wrapper reports
lifecycle status back, the row shows a live badge, and the board owns every
Slack reaction, so the agent never touches Slack.
```

with

```
The board injects the domain skill and a status-writer path as flags, so the
wrapper skills carry no repo- or team-specific knowledge. The wrapper reports
lifecycle status back through a state file and a matching event on the rt
daemon's bus; the board reads that bus from a cursor it keeps, so a
transition that lands while the board is down is replayed at its next boot.
The row shows a live badge, and the board owns every Slack reaction, so the
agent never touches Slack.
```

- [ ] **Step 2: agent-actions.md**

Replace the paragraph

```
The wrapper emits `reviewing` / `done` / `error` to a state file the board
reads, so the row shows a live badge, with an instant optimistic badge and
toast the moment you launch. The board owns every Slack reaction (👀 on
`reviewing`, 💬 or ✅ on `done`), so the agent never touches Slack. Launching
again while a session is live re-focuses its tab instead of spawning another.
```

with

```
The wrapper emits `reviewing` / `done` / `error` to a state file the board
reads, so the row shows a live badge, with an instant optimistic badge and
toast the moment you launch. Each write also publishes the same transition on
the rt daemon's event bus, topic `board/agent-status/<kind>`, stamped with the
emitting board's root so two boards on one machine never act on each other's
panes. The board consumes that topic from the bus journal by cursor
(`state/agent-status-cursor`): a live push wakes it within a second, the
60-second sweep tick covers a push it missed, and a boot replays everything
emitted while it was down, within the journal's retention (7 days or 50,000
events). Past that, the triage latch pass and the gate sweep still reconcile
from the state files. The board owns every Slack reaction (👀 on
`reviewing`, 💬 or ✅ on `done`), so the agent never touches Slack. Launching
again while a session is live re-focuses its tab instead of spawning another.
```

- [ ] **Step 3: Verify and commit**

Run from the repo root: `bun run format:check`
Expected: clean. If prettier flags a file this branch touched, run `bun run format` from the root and include the result in this commit.

```bash
git add README.md docs/agent-actions.md
git commit -m "board: document the agent-status bus contract and replay guarantee"
```

---

## Self-review

- **Spec coverage.** Wire contract and `appRoot` scoping: Task 1 and Task 3. CLI side: Task 2 and Task 4. Feed with cursor, catch-up, three triggers, one in flight: Task 3 and Task 5. Handler extraction with the four side effects in order: Task 5. Retired items (port file, notify module, both routes, `parseAgentSignal`, test comments): Tasks 4 and 5. Dev and bundle parity: no task needed, the CLIs and server are the same code in both forms and `subcommands.ts` already imports the three CLIs. Testing list: Tasks 1, 2, 3, 5. Docs: Task 6.
- **Placeholders.** None; every code step carries its code.
- **Type consistency.** `AgentStatusFeedIo.eventsList(after, limit)` is what Task 5 wires with `eventsList({ pattern, after, limit })`; `handle(signal: AgentSignal)` is `handleAgentSignal`; `readCursorFile`/`writeCursorFile` names match between Task 3 and Task 5; `emitAgentStatus(signal)` takes the same `AgentSignal` shape the CLIs already build.
