# App Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a count of decisions waiting on Matt on the board and console tabs of the mattstack shell window, and their total on the dock icon.

**Architecture:** Each app computes its own count from the same data its screen renders and serves it at a `badge` path declared in its `mattstack.deck.json`. Deck passes the path through its app catalog. The Mac app polls every declared badge on its own 10s timer, holds a count through 2 failed fetches, paints a pill on each tab, and sets the dock badge to the sum.

**Tech Stack:** Bun + TypeScript (board, deck), Hono + Vitest + React/Mantine (console), Swift/SwiftUI/AppKit (rt-tray, checks via `swift run mattstack-checks`).

**Spec:** `docs/superpowers/specs/2026-09-23-app-badges-design.md` (repo-tools, commit b1acc4ce6). Read it before starting any task.

## Global Constraints

- Two repos, one branch each, both named `app-badges`:
  - `~/Documents/GitHub/mattstack-apps` (Tasks 1 to 5; board, console, deck live under `apps/`).
  - `~/Documents/GitHub/repo-tools` (Tasks 6 to 8; `rt-tray/`).
  Work in a worktree for each, never in the shared main checkout.
- Badge payload: `{ "count": <non-negative integer>, "path"?: "<path starting with / inside the same app>" }`. Declared in a manifest as `"badge": "/api/badge"`.
- Counting rule (spec "What counts"): `status` is `open` or `parked`; `owner` is `human` or null; `kind: pane-attention` counts only on the board and only once `now - openedAt >= 120000` ms; console never counts `pane-attention`; `execution: unassigned` and `delivery: stuck` never count on their own.
- Never write em dashes or en dashes in code, comments, copy, or commit messages.
- Comments state only constraints the code cannot show. No narration, no review history, no ticket ids.
- Board tests run from `apps/board` (`cd apps/board && bun test <file>`); the root-level runner skips its preload.
- Console tests: `cd apps/console && bunx vitest run <file>`.
- Deck tests: `cd apps/deck && bun test <file>`.
- Tray checks: `cd rt-tray && swift run mattstack-checks` (XCTest is not available under CLT).
- Never rebuild, re-sign, or reinstall `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app`. Never run a built `rt` binary without `env -i HOME=<temp>`.
- Never validate the owner rule with `rt gate list --json`: it rewrites null to `"human"`.

## Review Focus

1. An escalated herd-owned pane-attention gate reaches the board's `queueExtras` but must never be counted (Task 1 and Task 3 tests).
2. A gate answered while the board's relay was disconnected must stop counting after the next resync, not stay stuck (Task 2 test).
3. A cached `window-apps-cache.json` written before this change (no `badge` key) must decode and simply show no badges (Task 6 check).
4. A manifest `badge` that is absolute (`https://...`) or protocol-relative (`//host`) must be rejected by deck and ignored by the tray, so a badge can never fetch another origin (Task 5 test, Task 6 check).
5. The console row label "waiting on shepherd" must fit its 280pt band beside the liveness chip without clipping, and the tab pill must not push the tab label off a 110pt tab (Task 8 real check).

---

### Task 1: Board gate cache carries owner, ignores duplicate opened frames, never regresses status

Repo: mattstack-apps.

**Files:**
- Modify: `apps/board/src/gates/store.ts` (`GateRow`)
- Modify: `apps/board/src/gates/cache.ts` (`applyOpened`, `attachGates`)
- Modify: `apps/board/src/gates/ingest.ts` (`buildQueueExtras`)
- Test: `apps/board/src/__tests__/gates-cache.test.ts`, `apps/board/src/__tests__/gates-ingest.test.ts`

**Interfaces:**
- Produces: `GateRow.owner?: string` (board client row). `attachGates` and `buildQueueExtras` set it from the facility row's `owner` when non-null. `GateCache.applyEvent` on `gate/opened` stores `owner` from the payload and ignores a frame whose id is already cached. `GateCache.applyRow` never moves a known id backwards in status (open, parked, answered, closed). `GateCache.revision: number` increases on every write that changes the cache (Task 2 reads it).

- [ ] **Step 1: Write the failing tests**

Append to `apps/board/src/__tests__/gates-cache.test.ts` (add `cachedExecution` to its existing import from `../gates/cache.ts`):

```ts
describe('GateCache opened frames', () => {
  test('an opened frame carries the payload owner onto the row', () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: 'gate/opened/g-att',
      payload: {
        id: 'g-att',
        subject: 'agent:a1',
        kind: 'pane-attention',
        questions: [],
        owner: 'human',
      },
    });
    expect(cache.get('agent:a1', 'pane-attention')?.owner).toBe('human');
  });

  test('an opened frame without an owner stores null', () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: 'gate/opened/g2',
      payload: { id: 'g2', subject: 'mr:https://x/-/merge_requests/2', kind: 'review-post', questions: [] },
    });
    expect(cache.get('mr:https://x/-/merge_requests/2', 'review-post')?.owner).toBeNull();
  });

  test('a duplicate opened frame for a cached id keeps the original openedAt', () => {
    const cache = new GateCache();
    cache.applyRow(row({ id: 'g3', subject: 'agent:a3', kind: 'pane-attention', openedAt: 1000 }));
    cache.applyEvent({
      topic: 'gate/opened/g3',
      payload: { id: 'g3', subject: 'agent:a3', kind: 'pane-attention', questions: [], owner: 'human' },
    });
    expect(cache.get('agent:a3', 'pane-attention')?.openedAt).toBe(1000);
  });
});

describe('GateCache status is monotonic per id', () => {
  test('a stale open copy of an answered gate does not reopen it', () => {
    const cache = new GateCache();
    cache.applyRow(row({ id: 'g5', subject: 'agent:a5', kind: 'pane-attention', status: 'answered' }));
    cache.applyRow(row({ id: 'g5', subject: 'agent:a5', kind: 'pane-attention', status: 'open' }));
    expect(cache.get('agent:a5', 'pane-attention')?.status).toBe('answered');
  });

  test('a resync copy with a new execution value on the same status still lands', () => {
    const cache = new GateCache();
    const base = row({ id: 'g10', subject: 'agent:a10', kind: 'pane-attention', status: 'answered' });
    cache.applyRow(base);
    cache.applyRow({ ...base, execution: 'unassigned' } as FacilityGateRow);
    expect(cachedExecution(cache.get('agent:a10', 'pane-attention')!)).toBe('unassigned');
  });

  test('revision moves on a real change and not on a no-op', () => {
    const cache = new GateCache();
    const r0 = cache.revision;
    cache.applyRow(row({ id: 'g6', subject: 'agent:a6', kind: 'pane-attention', status: 'open' }));
    const r1 = cache.revision;
    cache.applyRow(row({ id: 'g6', subject: 'agent:a6', kind: 'pane-attention', status: 'open' }));
    expect(r1).toBeGreaterThan(r0);
    expect(cache.revision).toBe(r1);
    cache.applyRow(row({ id: 'g6', subject: 'agent:a6', kind: 'pane-attention', status: 'answered' }));
    expect(cache.revision).toBeGreaterThan(r1);
  });
});

describe('attachGates owner', () => {
  test('an open MR gate row carries its owner', () => {
    const cache = new GateCache();
    const url = 'https://x/-/merge_requests/9';
    cache.applyRow(row({ id: 'g9', subject: `mr:${url}`, status: 'open', owner: 'human' }));
    const [mr] = attachGates([{ webUrl: url }], cache);
    expect(mr!.gates[0]!.owner).toBe('human');
  });
});
```

Append to `apps/board/src/__tests__/gates-ingest.test.ts` (add `buildQueueExtras` to the existing import from `../gates/ingest.ts`, and import `GateCache` from `../gates/cache.ts`):

```ts
describe('buildQueueExtras owner', () => {
  test('a relay-opened human pane-attention gate lands in queueExtras with its owner', () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: 'gate/opened/g-att',
      payload: { id: 'g-att', subject: 'agent:a1', kind: 'pane-attention', questions: [], owner: 'human' },
    });
    const extras = buildQueueExtras(cache.rows());
    expect(extras.map(g => [g.gateId, g.owner])).toEqual([['g-att', 'human']]);
  });

  test('an escalated herd-owned attention row is admitted and keeps its herd owner', () => {
    const cache = new GateCache();
    cache.applyRow({
      id: 'g-herd',
      subject: 'herd:h1/job1',
      kind: 'pane-attention',
      questions: [],
      meta: null,
      status: 'open',
      answer: null,
      openedAt: 0,
      parkedAt: null,
      closedAt: null,
      closedReason: null,
      agent: null,
      pane: null,
      nudge: null,
      delivery: null,
      released: false,
      supersededBy: null,
      owner: 'herd:h1',
      escalatedAt: 5,
      consumedAt: null,
      context: null,
      origin: null,
    } as FacilityGateRow);
    const extras = buildQueueExtras(cache.rows());
    expect(extras.map(g => g.owner)).toEqual(['herd:h1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/gates-cache.test.ts src/__tests__/gates-ingest.test.ts`
Expected: FAIL for the owner-carrying tests, the duplicate-frame test (receipt-time `openedAt`), the monotonic-status test, and the revision test. "an opened frame without an owner stores null" already passes today; it is a guard, not a failing test.

- [ ] **Step 3: Implement**

`apps/board/src/gates/store.ts`, inside `GateRow` after `escalatedAt`:

```ts
  /** The facility row's owner: `human` (or absent) for Matt's decisions,
      `herd:<id>` for a gate only that herd's shepherd may answer. */
  owner?: string;
```

`apps/board/src/gates/cache.ts`:

Add above `export class GateCache`:

```ts
/** A gate only moves forward through these, so an older copy of a known
    id (a resync read that raced a live patch) must never overwrite it. */
const STATUS_RANK: Record<FacilityGateRow['status'], number> = {
  open: 0,
  parked: 1,
  answered: 2,
  closed: 3,
};

/** Whole-row comparison: resync is the only path that updates fields no
    bus frame patches (delivery, execution, escalatedAt), so a narrower
    check would silently freeze them. */
function sameRow(a: FacilityGateRow, b: FacilityGateRow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

Replace `applyRow` with:

```ts
  /** Increases on every write that changes a row, so a caller can tell a
      no-op resync from one that found something. */
  revision = 0;

  applyRow(row: FacilityGateRow): void {
    const key = cacheKey(row.subject, row.kind);
    const existing = this.byKey.get(key);
    if (existing && existing.id !== row.id && existing.openedAt > row.openedAt)
      return;
    if (
      existing &&
      existing.id === row.id &&
      STATUS_RANK[existing.status] > STATUS_RANK[row.status]
    )
      return;
    if (existing && sameRow(existing, row)) return;
    this.byKey.set(key, row);
    this.revision++;
  }
```

If `FacilityGateRow['status']` has members other than those four, `bun run typecheck` will say so; add each with the rank that matches its place in the lifecycle.

In `applyOpened`, add as the first line after the three `if (...) return;` guards:

```ts
    if (this.findById(id)) return;
```

(A frame for a known id carries nothing the cached row lacks, and replaying it would reset status, answer, and `openedAt`.) Then replace `this.byKey.set(cacheKey(subject, kind), {` with `this.applyRow({` and keep the object literal; replace `owner: null,` inside it with:

```ts
      owner: typeof payload.owner === 'string' ? payload.owner : null,
```

`applyRow`'s older-sibling check can now drop an opened frame whose receipt-time `openedAt` is older than a cached different-id row on the same subject and kind; that cannot happen with receipt time, which is always now.

Delete the now-false sentence "so the optimistic row starts supersededBy, owner, escalatedAt, and consumedAt empty" by rewriting that comment to:

```ts
      // The opened event predates supersession, escalation, and
      // consumption, so those start empty the way the daemon's fresh row does.
```

In `attachGates`, add to BOTH pushed objects (open/parked and answered), after `escalatedAt: row.escalatedAt ?? undefined,`:

```ts
          owner: row.owner ?? undefined,
```

`apps/board/src/gates/ingest.ts`, in `buildQueueExtras`'s pushed object after `escalatedAt: row.escalatedAt ?? undefined,`:

```ts
      owner: row.owner ?? undefined,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/gates-cache.test.ts src/__tests__/gates-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `cd apps/board && bun run typecheck`
Expected: exit 0.

```bash
git add apps/board/src/gates/store.ts apps/board/src/gates/cache.ts apps/board/src/gates/ingest.ts apps/board/src/__tests__/gates-cache.test.ts apps/board/src/__tests__/gates-ingest.test.ts
git commit -m "board: gate cache carries owner and keeps openedAt across duplicate opened frames"
```

---

### Task 2: Board resyncs its gate cache on reconnect and every 60s

Repo: mattstack-apps.

**Files:**
- Modify: `apps/board/src/gates/ingest.ts` (add `GateResync`)
- Modify: `apps/board/src/server.ts` (boot reconcile block near `reconcileGatesOnBoot`; the `subscribe((type, data) => ...)` relay callback)
- Test: `apps/board/src/__tests__/gates-ingest.test.ts`

**Interfaces:**
- Consumes: `reconcileGatesOnBoot(list, cache)`, `reconcileAttentionGatesOnBoot(list, cache)` (existing, `ingest.ts`).
- Consumes: `GateCache.revision` (Task 1).
- Produces: exported `GateListPayload`, `GateListResult` types; `class GateResync { constructor(list, cache: GateReconcileTarget & { readonly revision: number }, onError: (message: string) => void); run(): Promise<boolean> }`. `run()` runs both reconciles and resolves `true` when the cache changed; a call while one is in flight resolves `false` without starting another.

- [ ] **Step 1: Write the failing tests**

Append to `apps/board/src/__tests__/gates-ingest.test.ts` (add `GateResync` to the `../gates/ingest.ts` import). The `row()` helper used below is the one in `gates-cache.test.ts`; copy it into this file if it is not already defined here:

```ts
describe('GateResync', () => {
  function listOf(rows: FacilityGateRow[]) {
    const calls: Array<{ subjectPrefix?: string; kind?: string }> = [];
    const list = async (payload: { subjectPrefix?: string; kind?: string }) => {
      calls.push({ subjectPrefix: payload.subjectPrefix, kind: payload.kind });
      return { ok: true, data: { gates: rows, cursor: 1 } };
    };
    return { list, calls };
  }

  test('run() reconciles both the mr: and the pane-attention scopes', async () => {
    const { list, calls } = listOf([]);
    const resync = new GateResync(list, new GateCache(), () => {});
    await resync.run();
    expect(calls).toEqual([
      { subjectPrefix: 'mr:', kind: undefined },
      { subjectPrefix: undefined, kind: 'pane-attention' },
    ]);
  });

  test('a gate answered during a relay gap stops being open after run()', async () => {
    const cache = new GateCache();
    const url = 'https://x/-/merge_requests/4';
    cache.applyEvent({
      topic: 'gate/opened/g4',
      payload: { id: 'g4', subject: `mr:${url}`, kind: 'review-post', questions: [], owner: 'human' },
    });
    const answered = { ...cache.get(`mr:${url}`, 'review-post')!, status: 'answered' as const };
    const { list } = listOf([answered]);
    await new GateResync(list, cache, () => {}).run();
    expect(cache.get(`mr:${url}`, 'review-post')?.status).toBe('answered');
  });

  test('a live answered patch is not undone by a resync that read the gate as open', async () => {
    const cache = new GateCache();
    const subject = 'mr:https://x/-/merge_requests/7';
    cache.applyEvent({
      topic: 'gate/opened/g7',
      payload: { id: 'g7', subject, kind: 'review-post', questions: [], owner: 'human' },
    });
    const staleOpen = { ...cache.get(subject, 'review-post')! };
    cache.applyEvent({ topic: 'gate/answered/g7', payload: { id: 'g7', answers: { q: 'a' }, by: 'pane' } });
    const { list } = listOf([staleOpen]);
    await new GateResync(list, cache, () => {}).run();
    expect(cache.get(subject, 'review-post')?.status).toBe('answered');
  });

  test('run() reports whether the cache changed', async () => {
    const cache = new GateCache();
    const fresh = row({ id: 'g8', subject: 'mr:https://x/-/merge_requests/8', kind: 'review-post' });
    expect(await new GateResync(listOf([fresh]).list, cache, () => {}).run()).toBe(true);
    expect(await new GateResync(listOf([fresh]).list, cache, () => {}).run()).toBe(false);
  });

  test('a run() while one is in flight does not start a second pass', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    let calls = 0;
    const list = async () => {
      calls++;
      await gate;
      return { ok: true, data: { gates: [], cursor: 1 } };
    };
    const resync = new GateResync(list, new GateCache(), () => {});
    const first = resync.run();
    await resync.run();
    release();
    await first;
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/gates-ingest.test.ts`
Expected: FAIL with `GateResync` not exported.

- [ ] **Step 3: Implement**

In `apps/board/src/gates/ingest.ts`, change `type GateListPayload = {` to `export type GateListPayload = {` and `type GateListResult = {` to `export type GateListResult = {`. Then append:

```ts
/** Re-lists every gate scope the board caches. The relay is broadcast-only
    with no replay, so frames sent while it was disconnected are lost; this
    is what brings the cache back in line after a gap. Overlapping calls
    collapse into the one already running. */
export class GateResync {
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly list: (payload: GateListPayload) => Promise<GateListResult>,
    private readonly cache: GateReconcileTarget & { readonly revision: number },
    private readonly onError: (message: string) => void
  ) {}

  run(): Promise<boolean> {
    if (this.inFlight) return Promise.resolve(false);
    const before = this.cache.revision;
    this.inFlight = (async () => {
      try {
        await reconcileGatesOnBoot(this.list, this.cache);
        await reconcileAttentionGatesOnBoot(this.list, this.cache);
      } catch (err) {
        this.onError(`gate resync failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        this.inFlight = null;
      }
      return this.cache.revision !== before;
    })();
    return this.inFlight;
  }
}
```

`apps/board/src/server.ts`:

1. Add `GateResync` to the existing import from `./gates/ingest.ts`.
2. Right after `const gateCache = new GateCache();` (near line 399) add:

```ts
const GATE_RESYNC_INTERVAL_MS = 60_000;
const gateResync = new GateResync(gateList, gateCache, m => console.error(m));
```

3. Replace the whole `if (!FIXTURE_DIR) { void reconcileGatesOnBoot(...) ...; void reconcileAttentionGatesOnBoot(...) ...; }` block with:

```ts
if (!FIXTURE_DIR) {
  const resyncAndNudge = () =>
    void gateResync.run().then(changed => {
      if (changed) sseNudge();
    });
  resyncAndNudge();
  setInterval(resyncAndNudge, GATE_RESYNC_INTERVAL_MS);
}
```

(A nudge makes every open board tab re-pull `/data.json`, which runs the off-board prune and the reconciler fetch, so the timer nudges only when something changed.)

4. In the relay callback `subscribe((type, data) => { ... })`, as its first statement:

```ts
      // The daemon sends mr:status on every socket open, so this is the
      // reconnect signal; it also fires on connection-state changes, which
      // only costs an extra idempotent resync.
      if (type === 'mr:status')
        void gateResync.run().then(changed => {
          if (changed) sseNudge();
        });
```

If `reconcileGatesOnBoot` / `reconcileAttentionGatesOnBoot` are now unused imports in `server.ts`, remove them from the import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/gates-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `cd apps/board && bun run typecheck`
Expected: exit 0.

```bash
git add apps/board/src/gates/ingest.ts apps/board/src/server.ts apps/board/src/__tests__/gates-ingest.test.ts
git commit -m "board: resync the gate cache on relay reconnect and every 60s"
```

---

### Task 3: Board badge predicate and /api/badge

Repo: mattstack-apps.

**Files:**
- Create: `apps/board/src/gates/badge.ts`
- Modify: `apps/board/src/cache.ts` (`SnapshotCache.peek`)
- Modify: `apps/board/src/server.ts` (new `case '/api/badge'` in the pre-token route switch, next to `case '/healthz'`)
- Modify: `apps/board/mattstack.deck.json`
- Test: `apps/board/src/__tests__/gates-badge.test.ts`

**Interfaces:**
- Consumes: `GateRow.owner` (Task 1), `attachGates`, `buildQueueExtras`, `visibleMrsFor`.
- Produces: `countsForBadge(gate: GateRow, now: number): boolean`, `boardBadge(gates: GateRow[], now: number): { count: number; path?: string }`, `ATTENTION_MIN_AGE_MS = 120_000`.

- [ ] **Step 1: Write the failing test**

Create `apps/board/src/__tests__/gates-badge.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';

import { ATTENTION_MIN_AGE_MS, boardBadge, countsForBadge } from '../gates/badge.ts';
import { GateCache } from '../gates/cache.ts';
import { buildQueueExtras } from '../gates/ingest.ts';
import type { GateRow } from '../gates/store.ts';

const NOW = 10_000_000;

function gate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g1',
    subject: 'mr:https://x/-/merge_requests/1',
    kind: 'review-post',
    label: 'review-post',
    status: 'open',
    openedAt: NOW - 1000,
    questions: [],
    ...overrides,
  };
}

describe('countsForBadge', () => {
  test('open and parked human or unowned gates count', () => {
    expect(countsForBadge(gate(), NOW)).toBe(true);
    expect(countsForBadge(gate({ status: 'parked' }), NOW)).toBe(true);
    expect(countsForBadge(gate({ owner: 'human' }), NOW)).toBe(true);
  });

  test('answered gates never count, even unassigned or stuck', () => {
    expect(countsForBadge(gate({ status: 'answered' }), NOW)).toBe(false);
    expect(countsForBadge(gate({ status: 'answered', execution: 'unassigned' }), NOW)).toBe(false);
    expect(
      countsForBadge(gate({ status: 'answered', delivery: { outcome: 'stuck', at: 1 } }), NOW)
    ).toBe(false);
  });

  test('herd-owned gates never count, escalated or not', () => {
    expect(countsForBadge(gate({ owner: 'herd:h1' }), NOW)).toBe(false);
    expect(
      countsForBadge(
        gate({ owner: 'herd:h1', kind: 'pane-attention', subject: 'herd:h1/j', escalatedAt: 1, openedAt: 0 }),
        NOW
      )
    ).toBe(false);
  });

  test('pane-attention counts only once it is at least two minutes old', () => {
    const att = { kind: 'pane-attention', subject: 'agent:a1', owner: 'human' };
    expect(countsForBadge(gate({ ...att, openedAt: NOW - ATTENTION_MIN_AGE_MS + 1 }), NOW)).toBe(false);
    expect(countsForBadge(gate({ ...att, openedAt: NOW - ATTENTION_MIN_AGE_MS }), NOW)).toBe(true);
  });
});

describe('boardBadge', () => {
  test('an escalated herd-owned attention gate admitted to queueExtras is not counted', () => {
    const cache = new GateCache();
    cache.applyRow({
      id: 'g-herd', subject: 'herd:h1/job1', kind: 'pane-attention', questions: [], meta: null,
      status: 'open', answer: null, openedAt: 0, parkedAt: null, closedAt: null, closedReason: null,
      agent: null, pane: null, nudge: null, delivery: null, released: false, supersededBy: null,
      owner: 'herd:h1', escalatedAt: 5, consumedAt: null, context: null, origin: null,
    } as FacilityGateRow);
    const extras = buildQueueExtras(cache.rows());
    expect(extras).toHaveLength(1);
    expect(boardBadge(extras, NOW).count).toBe(0);
  });

  test('zero counted gates yields count 0 and no path', () => {
    expect(boardBadge([gate({ status: 'answered' })], NOW)).toEqual({ count: 0 });
  });

  test('path points at the oldest counted gate', () => {
    const badge = boardBadge(
      [gate({ gateId: 'newer', openedAt: NOW - 10 }), gate({ gateId: 'older id', openedAt: NOW - 500 })],
      NOW
    );
    expect(badge).toEqual({ count: 2, path: '/?gate=older%20id' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/board && bun test src/__tests__/gates-badge.test.ts`
Expected: FAIL, module `../gates/badge.ts` not found.

- [ ] **Step 3: Implement**

Create `apps/board/src/gates/badge.ts`:

```ts
import type { GateRow } from './store.ts';

/** Most pane-attention gates clear on their own within 1 to 4 minutes;
    counting them sooner makes the shell badge blink. */
export const ATTENTION_MIN_AGE_MS = 120_000;

export function countsForBadge(gate: GateRow, now: number): boolean {
  if (gate.status !== 'open' && gate.status !== 'parked') return false;
  if (gate.owner !== undefined && gate.owner !== 'human') return false;
  if (gate.kind === 'pane-attention' && now - gate.openedAt < ATTENTION_MIN_AGE_MS)
    return false;
  return true;
}

export interface BoardBadge {
  count: number;
  path?: string;
}

export function boardBadge(gates: GateRow[], now: number): BoardBadge {
  const counted = gates
    .filter(g => countsForBadge(g, now))
    .sort((a, b) => a.openedAt - b.openedAt);
  const oldest = counted[0];
  if (!oldest) return { count: 0 };
  return { count: counted.length, path: `/?gate=${encodeURIComponent(oldest.gateId)}` };
}
```

`apps/board/src/cache.ts`, add to `SnapshotCache`:

```ts
  /** The current snapshot without triggering a fetch; null before the first lands. */
  peek(): Snapshot | null {
    return this.snapshot;
  }
```

`apps/board/src/server.ts`: import `boardBadge` from `./gates/badge.ts` and `buildQueueExtras` if not already imported. The route must sit in the pre-token `switch (pathname)` (the one with `case '/healthz':`, before the `getGitlabToken()` round trip), because the tray times out at 2s and a wedged daemon stalls that round trip. It must never await a fetch. Add directly after `case '/healthz': return new Response('ok');`:

```ts
      case '/api/badge': {
        const visible = config.members.filter(m => !m.hidden);
        const mrs = cache.peek()?.mrs ?? [];
        const mrGates = attachGates(visibleMrsFor(mrs, visible), gateCache).flatMap(
          mr => mr.gates
        );
        return Response.json(
          boardBadge([...mrGates, ...buildQueueExtras(gateCache.rows())], Date.now())
        );
      }
```

In fixture mode the fixture switch falls through to this one, so the route answers `{"count":0}` from the empty cache.

`apps/board/mattstack.deck.json`: add a top-level key after `"includeInBundle": true,`:

```json
  "badge": "/api/badge",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/gates-badge.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `cd apps/board && bun run typecheck`
Expected: exit 0.

Do not start a second board process to smoke-test the route: it shares the real state dir, can claim the writer lease, and runs the off-board gate prune. The live route is exercised in Task 8.

```bash
git add apps/board/src/gates/badge.ts apps/board/src/server.ts apps/board/mattstack.deck.json apps/board/src/__tests__/gates-badge.test.ts
git commit -m "board: /api/badge counts decisions waiting on Matt"
```

---

### Task 4: Console row marker by owner and /api/badge

Repo: mattstack-apps.

**Files:**
- Create: `apps/console/src/server/gate-waiting.ts`
- Modify: `apps/console/src/server/gates.ts` (add `.get('/api/badge', ...)` to the `gates` Hono chain)
- Modify: `apps/console/src/app/runs/useGates.ts` (replace `hasOpenGate`)
- Modify: `apps/console/src/app/runs/RunRow.tsx` (marker render)
- Modify: `apps/console/mattstack.deck.json`
- Test: `apps/console/src/server/gate-waiting.test.ts`, `apps/console/src/server/gates.test.ts`, `apps/console/src/app/runs/RunRow.test.tsx`

**Interfaces:**
- Produces (in `gate-waiting.ts`): `type RunGateMarker = 'blocked' | 'shepherd'`; `isWaiting(g: GateRow): boolean` (open or parked); `isMine(g: GateRow): boolean` (owner null or `human`); `runGateMarker(gates: GateRow[] | undefined, runId: string): RunGateMarker | null`; `countsForConsoleBadge(g: GateRow): boolean`.
- `useGates.ts` exports `runGateMarker` (re-export) in place of `hasOpenGate`.

- [ ] **Step 1: Write the failing tests**

Create `apps/console/src/server/gate-waiting.test.ts`:

```ts
// @vitest-environment node
import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { countsForConsoleBadge, runGateMarker } from './gate-waiting';

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1', subject: 'run:r1', kind: 'self-review', questions: [], meta: null,
    status: 'open', answer: null, openedAt: 0, parkedAt: null, closedAt: null,
    closedReason: null, agent: null, pane: null, nudge: null, delivery: null,
    released: false, supersededBy: null, owner: null, escalatedAt: null,
    consumedAt: null, context: null, origin: null,
    ...overrides,
  } as GateRow;
}

describe('runGateMarker', () => {
  it('is blocked for an open or parked gate Matt owns', () => {
    expect(runGateMarker([row()], 'r1')).toBe('blocked');
    expect(runGateMarker([row({ status: 'parked', owner: 'human' })], 'r1')).toBe('blocked');
  });
  it('is shepherd for a herd-owned waiting gate', () => {
    expect(runGateMarker([row({ owner: 'herd:h1' })], 'r1')).toBe('shepherd');
  });
  it('prefers blocked when both kinds wait on one run', () => {
    expect(
      runGateMarker([row({ id: 'a', owner: 'herd:h1' }), row({ id: 'b', kind: 'plan' })], 'r1')
    ).toBe('blocked');
  });
  it('is null for answered gates and other runs', () => {
    expect(runGateMarker([row({ status: 'answered' })], 'r1')).toBeNull();
    expect(runGateMarker([row({ subject: 'run:other' })], 'r1')).toBeNull();
    expect(runGateMarker(undefined, 'r1')).toBeNull();
  });
});

describe('countsForConsoleBadge', () => {
  it('counts open and parked run gates Matt owns', () => {
    expect(countsForConsoleBadge(row())).toBe(true);
    expect(countsForConsoleBadge(row({ status: 'parked' }))).toBe(true);
  });
  it('never counts herd-owned, pane-attention, answered, or non-run gates', () => {
    expect(countsForConsoleBadge(row({ owner: 'herd:h1' }))).toBe(false);
    expect(countsForConsoleBadge(row({ kind: 'pane-attention' }))).toBe(false);
    expect(countsForConsoleBadge(row({ status: 'answered' }))).toBe(false);
    expect(countsForConsoleBadge(row({ subject: 'mr:https://x' }))).toBe(false);
  });
});
```

Append to `apps/console/src/server/gates.test.ts`:

```ts
describe('GET /api/badge', () => {
  function badge() {
    return gates.fetch(new Request('http://localhost/api/badge'));
  }

  it('counts Matt-owned waiting gates on runs that exist, with a path to the oldest', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: {
        gates: [
          row({ id: 'mine-new', subject: 'run:r1', openedAt: 20 }),
          row({ id: 'mine-old', subject: 'run:r2', status: 'parked', openedAt: 10 }),
          row({ id: 'herd', subject: 'run:r1', owner: 'herd:h1' }),
          row({ id: 'orphan', subject: 'run:gone' }),
          row({ id: 'att', subject: 'run:r1', kind: 'pane-attention' }),
        ],
        cursor: 5,
      },
    });
    vi.mocked(rt.listRuns).mockResolvedValueOnce({
      ok: true,
      data: {
        runs: [
          { id: 'r1', repo: 'acme' },
          { id: 'r2', repo: 'acme' },
        ] as unknown as RunSummary[],
      },
    });

    const res = await badge();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 2, path: '/runs/acme/r2' });
  });

  it('answers 502 when gate:list fails', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: false, error: 'rt daemon unreachable' });
    vi.mocked(rt.listRuns).mockResolvedValueOnce({ ok: true, data: { runs: [] } });
    expect((await badge()).status).toBe(502);
  });
});
```

In `apps/console/src/app/runs/RunRow.test.tsx`, inside `describe('RunRow blocked badge', ...)`:
- Replace the test `'does not show the blocked badge for a parked gate'` with:

```ts
  it('shows the blocked badge for a parked gate', async () => {
    gatesGet.mockResolvedValue(
      gatesResponse([gateRow({ subject: 'run:run-1', status: 'parked' })])
    );

    renderRow(baseRun);

    expect(await screen.findByTestId('gate-blocked-badge')).toHaveTextContent('blocked');
  });
```

- Add:

```ts
  it('labels a herd-owned gate as waiting on shepherd', async () => {
    gatesGet.mockResolvedValue(
      gatesResponse([gateRow({ subject: 'run:run-1', status: 'open', owner: 'herd:h1' })])
    );

    renderRow(baseRun);

    expect(await screen.findByTestId('gate-blocked-badge')).toHaveTextContent(
      'waiting on shepherd'
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/console && bunx vitest run src/server/gate-waiting.test.ts src/server/gates.test.ts src/app/runs/RunRow.test.tsx`
Expected: FAIL (module missing, 404 on `/api/badge`, parked/herd row tests fail).

- [ ] **Step 3: Implement**

Create `apps/console/src/server/gate-waiting.ts`:

```ts
import type { GateRow } from '@mattstack/rt-client';

export type RunGateMarker = 'blocked' | 'shepherd';

export function isWaiting(g: GateRow): boolean {
  return g.status === 'open' || g.status === 'parked';
}

/** Legacy rows carry a null owner; they are Matt's. A `herd:*` owner can
    only be answered by that herd's shepherd. */
export function isMine(g: GateRow): boolean {
  return g.owner == null || g.owner === 'human';
}

export function runGateMarker(
  gates: GateRow[] | undefined,
  runId: string
): RunGateMarker | null {
  const subject = `run:${runId}`;
  const waiting = (gates ?? []).filter(g => g.subject === subject && isWaiting(g));
  if (waiting.some(isMine)) return 'blocked';
  return waiting.length > 0 ? 'shepherd' : null;
}

/** The board owns pane-attention gates; counting them here too would
    double-count a wedged run on the dock. */
export function countsForConsoleBadge(g: GateRow): boolean {
  return (
    g.subject.startsWith('run:') &&
    g.kind !== 'pane-attention' &&
    isWaiting(g) &&
    isMine(g)
  );
}
```

`apps/console/src/server/gates.ts`: import `countsForConsoleBadge` from `./gate-waiting`. In the `export const gates = new Hono()` chain, add right after the `.get('/api/gates', ...)` handler:

```ts
  .get('/api/badge', async c => {
    const [gatesRes, runsRes] = await Promise.all([
      listAllRunGates(),
      listRuns(undefined, rtClientOptions()),
    ]);
    if (!gatesRes.ok) return c.json({ error: gatesRes.error }, 502);
    if (!runsRes.ok) return c.json({ error: runsRes.error ?? 'run:list failed' }, 502);
    const repoByRun = new Map((runsRes.data?.runs ?? []).map(r => [r.id, r.repo]));
    const counted = gatesRes.gates
      .filter(g => countsForConsoleBadge(g) && repoByRun.has(g.subject.slice('run:'.length)))
      .sort((a, b) => a.openedAt - b.openedAt);
    const oldest = counted[0];
    if (!oldest) return c.json({ count: 0 }, 200);
    const runId = oldest.subject.slice('run:'.length);
    return c.json({ count: counted.length, path: `/runs/${repoByRun.get(runId)}/${runId}` }, 200);
  })
```

`apps/console/src/app/runs/useGates.ts`: delete `hasOpenGate` and its doc comment, and add:

```ts
export { runGateMarker, type RunGateMarker } from '../../server/gate-waiting';
```

`apps/console/src/app/runs/RunRow.tsx`:
- Change the import `import { hasOpenGate, useGates } from './useGates';` to `import { runGateMarker, useGates } from './useGates';`.
- Replace `const blocked = hasOpenGate(gatesQuery.data?.gates, run.id);` with `const marker = runGateMarker(gatesQuery.data?.gates, run.id);`.
- Replace the `{blocked && ( <Badge ...>blocked</Badge> )}` block with:

```tsx
        {marker && (
          <Badge
            color={marker === 'blocked' ? 'bad' : 'gray'}
            variant="light"
            data-testid="gate-blocked-badge"
          >
            {marker === 'blocked' ? 'blocked' : 'waiting on shepherd'}
          </Badge>
        )}
```

`apps/console/mattstack.deck.json`: add after `"includeInBundle": true,`:

```json
  "badge": "/api/badge",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/console && bunx vitest run src/server/gate-waiting.test.ts src/server/gates.test.ts src/app/runs/RunRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full console suite, typecheck, commit**

Run: `cd apps/console && bunx vitest run && bunx tsc --noEmit -p .`
Expected: all pass, exit 0. `grep -rn hasOpenGate apps/console/src` returns nothing.

```bash
git add apps/console/src/server/gate-waiting.ts apps/console/src/server/gate-waiting.test.ts apps/console/src/server/gates.ts apps/console/src/server/gates.test.ts apps/console/src/app/runs/useGates.ts apps/console/src/app/runs/RunRow.tsx apps/console/src/app/runs/RunRow.test.tsx apps/console/mattstack.deck.json
git commit -m "console: row marker by gate owner, /api/badge counts Matt's waiting run gates"
```

---

### Task 5: Deck carries the manifest badge path into discovery

Repo: mattstack-apps.

**Files:**
- Modify: `apps/deck/src/registry/deck-manifest.ts` (`DeckManifest`, parser)
- Modify: `apps/deck/src/registry/records.ts` (record type)
- Modify: `apps/deck/src/registry/manifest.ts` (`ingestManifest`)
- Modify: `apps/deck/src/api/discovery.ts` (`DiscoveryApp`, `buildDiscoveryApps`)
- Test: `apps/deck/src/registry/deck-manifest.test.ts`, `apps/deck/src/api/discovery.test.ts`

**Interfaces:**
- Produces: `DeckManifest.badge?: string`, record `badge?: string`, `DiscoveryApp.badge?: string` (path starting with `/`, never `//`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/deck/src/registry/deck-manifest.test.ts`:

```ts
test('reads a relative badge path', () => {
  const dir = repo({
    'mattstack.deck.json': JSON.stringify({ name: 'board', badge: '/api/badge', commands: {} }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok && r.manifest.badge).toBe('/api/badge');
});

test('drops a badge that is absolute or protocol-relative', () => {
  for (const badge of ['https://evil.example/x', '//evil.example/x', 'api/badge']) {
    const dir = repo({
      'mattstack.deck.json': JSON.stringify({ name: 'board', badge, commands: {} }),
    });
    const r = readDeckManifest(dir);
    expect(r?.ok && r.manifest.badge).toBeUndefined();
  }
});
```

If `commands` is required to be non-empty by the parser, use `commands: { start: 'bun run serve' }` instead; check the existing tests in that file for the minimal valid manifest.

Append to `apps/deck/src/api/discovery.test.ts`:

```ts
test('discovery passes a manifest badge path through', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'discovery-badge-'));
  writeFileSync(
    join(appDir, 'mattstack.deck.json'),
    JSON.stringify({
      name: 'board',
      displayName: 'Board',
      icon: './icon.svg',
      badge: '/api/badge',
      commands: { start: 'bun run serve' },
    })
  );
  writeFileSync(join(appDir, 'icon.svg'), SVG);
  putRecord({
    name: 'board',
    managedBy: 'rt',
    port: 11006,
    kind: 'service',
    workingDirectory: appDir,
    createdAt: '2026-09-23T00:00:00Z',
  });
  ingestManifest('board');
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: 'board.localhost', port: 11006 }])
  );

  const apps = await buildDiscoveryApps(statusOpts);
  expect(apps.find(a => a.name === 'board')?.badge).toBe('/api/badge');
});

test('discovery omits badge when the manifest has none', async () => {
  const chatDir = manifestDir();
  putRecord({
    name: 'chat',
    managedBy: 'rt',
    port: 11002,
    kind: 'service',
    workingDirectory: chatDir,
    createdAt: '2026-09-23T00:00:00Z',
  });
  ingestManifest('chat');
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: 'chat.localhost', port: 11002 }])
  );

  const apps = await buildDiscoveryApps(statusOpts);
  expect('badge' in apps.find(a => a.name === 'chat')!).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts src/api/discovery.test.ts`
Expected: FAIL for "reads a relative badge path" and "discovery passes a manifest badge path through". "drops a badge that is absolute or protocol-relative" and "discovery omits badge when the manifest has none" already pass today; they are guards.

- [ ] **Step 3: Implement**

`apps/deck/src/registry/deck-manifest.ts`, in `DeckManifest` after `icon?: string;`:

```ts
  /** Path on the app's own origin serving `{ count, path? }` for the shell's tab and dock badges. */
  badge?: string;
```

In the parser, after `if (typeof m.icon === 'string') out.icon = m.icon;`:

```ts
  if (typeof m.badge === 'string' && m.badge.startsWith('/') && !m.badge.startsWith('//'))
    out.badge = m.badge;
```

`apps/deck/src/registry/records.ts`, after `icon?: { ext: 'svg' };`:

```ts
  /** Badge path from mattstack.deck.json, relative to the app's URL. */
  badge?: string;
```

`apps/deck/src/registry/manifest.ts`, in `ingestManifest`:
- In the `deck && deck.ok ...` object, add `badge: deck.manifest.badge,`.
- In the `!manifest` cleanup branch, extend the condition with `|| record.badge !== undefined` and add `badge: _badge,` to the destructure.
- Replace the success-path `putRecord({ ...record, displayName: ..., description: ..., icon: { ext: 'svg' } });` with:

```ts
    const { badge: _staleBadge, ...base } = record;
    putRecord({
      ...base,
      displayName: manifest.displayName,
      description: manifest.description,
      icon: { ext: 'svg' },
      ...('badge' in manifest && manifest.badge ? { badge: manifest.badge } : {}),
    });
```

(The legacy `mattstack.json` fallback from `readManifest` has no `badge`, so an app that moved back to it loses its badge on re-ingest.)

`apps/deck/src/api/discovery.ts`: in `DiscoveryApp` add `badge?: string;` after `icon`. In `buildDiscoveryApps`'s `apps.push({ ... })` add after `icon: ...`:

```ts
      ...(record.badge ? { badge: record.badge } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts src/api/discovery.test.ts src/registry/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Full deck suite and commit**

Run: `cd apps/deck && bun test core src`
Expected: PASS.

```bash
git add apps/deck/src/registry/deck-manifest.ts apps/deck/src/registry/records.ts apps/deck/src/registry/manifest.ts apps/deck/src/api/discovery.ts apps/deck/src/registry/deck-manifest.test.ts apps/deck/src/api/discovery.test.ts
git commit -m "deck: carry a manifest badge path through to /api/apps"
```

---

### Task 6: Tray core: badge path on DiscoveryApp and the badge book

Repo: repo-tools.

**Files:**
- Modify: `rt-tray/Sources-core/Launch/OpenLink.swift` (`DiscoveryApp`)
- Create: `rt-tray/Sources-core/Window/Badges.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/BadgeChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (register `badgeChecks`)

**Interfaces:**
- Produces:
  - `DiscoveryApp.badge: String?` and init parameter `badge: String? = nil` (last, defaulted, so existing call sites compile).
  - `public struct BadgeReading: Equatable, Sendable { public let count: Int; public let path: String? }`
  - `public enum BadgeParse { public static func parse(_ data: Data) -> BadgeReading?; public static func endpoint(for app: DiscoveryApp) -> URL? }`
  - `public struct BadgeBook: Sendable { public static let failureHold: Int /* 2 */; public private(set) var readings: [String: BadgeReading]; public init(); public mutating func record(app: String, reading: BadgeReading?); public mutating func retain(apps: Set<String>); public var total: Int; public static func label(_ count: Int) -> String?; public static func firstBadged(_ readings: [String: BadgeReading], order: [String]) -> OpenRequest? }`

- [ ] **Step 1: Write the failing checks**

Create `rt-tray/Tests/MattstackCoreChecks/BadgeChecks.swift`:

```swift
import Foundation
@testable import MattstackCore

private func app(_ name: String, badge: String?) -> DiscoveryApp {
    DiscoveryApp(name: name, displayName: name, description: nil,
                 url: "https://\(name).mattstack", icon: nil, badge: badge)
}

let badgeChecks: [Check] = [
    Check("a catalog without badge keys decodes with no badges") { c in
        let json = Data(#"{"apps":[{"name":"board","displayName":"Board","description":null,"url":"https://board.mattstack","icon":null}]}"#.utf8)
        let apps = try AppCatalog.decode(json)
        try c.requireEqual(apps.map(\.badge), [nil])
    },
    Check("a catalog badge key decodes") { c in
        let json = Data(#"{"apps":[{"name":"board","displayName":"Board","url":"https://board.mattstack","icon":null,"badge":"/api/badge"}]}"#.utf8)
        try c.requireEqual(try AppCatalog.decode(json).first?.badge, "/api/badge")
    },
    Check("endpoint joins a relative badge path onto the app url") { c in
        try c.requireEqual(BadgeParse.endpoint(for: app("board", badge: "/api/badge"))?.absoluteString,
                           "https://board.mattstack/api/badge")
    },
    Check("endpoint refuses absolute, protocol-relative, and missing badge paths") { c in
        c.expect(BadgeParse.endpoint(for: app("board", badge: "https://evil.example/x")) == nil)
        c.expect(BadgeParse.endpoint(for: app("board", badge: "//evil.example/x")) == nil)
        c.expect(BadgeParse.endpoint(for: app("board", badge: nil)) == nil)
    },
    Check("parse reads count and path") { c in
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":3,"path":"/?gate=g1"}"#.utf8)),
                           BadgeReading(count: 3, path: "/?gate=g1"))
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":0}"#.utf8)), BadgeReading(count: 0, path: nil))
    },
    Check("parse rejects negative, fractional, missing counts and bad paths") { c in
        c.expect(BadgeParse.parse(Data(#"{"count":-1}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data(#"{"count":1.5}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data(#"{}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data("nope".utf8)) == nil)
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":1,"path":"https://evil.example"}"#.utf8)),
                           BadgeReading(count: 1, path: nil))
    },
    Check("a count survives two failed fetches and drops on the third") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 2, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        try c.requireEqual(book.readings["board"]?.count, 2)
        book.record(app: "board", reading: nil)
        c.expect(book.readings["board"] == nil)
    },
    Check("a success resets the failure run") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 1, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: BadgeReading(count: 4, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        try c.requireEqual(book.readings["board"]?.count, 4)
    },
    Check("retain drops apps that no longer declare a badge") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 1, path: nil))
        book.record(app: "console", reading: BadgeReading(count: 2, path: nil))
        book.retain(apps: ["console"])
        try c.requireEqual(book.total, 2)
    },
    Check("label hides zero and caps at 99+") { c in
        c.expect(BadgeBook.label(0) == nil)
        try c.requireEqual(BadgeBook.label(7), "7")
        try c.requireEqual(BadgeBook.label(99), "99")
        try c.requireEqual(BadgeBook.label(100), "99+")
    },
    Check("firstBadged follows tab order and skips zero counts") { c in
        let readings = ["console": BadgeReading(count: 1, path: "/runs/acme/r2"),
                        "board": BadgeReading(count: 0, path: nil)]
        try c.requireEqual(BadgeBook.firstBadged(readings, order: ["board", "console"]),
                           OpenRequest(app: "console", pathAndQuery: "/runs/acme/r2"))
        c.expect(BadgeBook.firstBadged(["board": BadgeReading(count: 0, path: nil)], order: ["board"]) == nil)
    },
    Check("firstBadged with no path selects the tab without navigating") { c in
        try c.requireEqual(BadgeBook.firstBadged(["board": BadgeReading(count: 2, path: nil)], order: ["board"]),
                           OpenRequest(app: "board", pathAndQuery: ""))
    },
]
```

In `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`, append `+ badgeChecks` to the end of the `allChecks` expression.

- [ ] **Step 2: Run the checks to verify they fail**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: build FAILS (`badge` is not a member of `DiscoveryApp`, `BadgeParse` undefined).

- [ ] **Step 3: Implement**

`rt-tray/Sources-core/Launch/OpenLink.swift`, replace the `DiscoveryApp` struct with:

```swift
public struct DiscoveryApp: Codable, Equatable, Sendable {
    public let name: String
    public let displayName: String
    public let description: String?
    public let url: String
    public let icon: String?
    public let badge: String?
    public init(name: String, displayName: String, description: String?, url: String, icon: String?,
                badge: String? = nil) {
        self.name = name; self.displayName = displayName
        self.description = description; self.url = url; self.icon = icon
        self.badge = badge
    }
}
```

Create `rt-tray/Sources-core/Window/Badges.swift`:

```swift
import Foundation

public struct BadgeReading: Equatable, Sendable {
    public let count: Int
    public let path: String?
    public init(count: Int, path: String?) {
        self.count = count
        self.path = path
    }
}

public enum BadgeParse {
    /// Only a path on the app's own origin is accepted, so a manifest can
    /// never point the tray's fetch or a badge click at another host.
    static func isInAppPath(_ path: String) -> Bool {
        path.hasPrefix("/") && !path.hasPrefix("//")
    }

    public static func endpoint(for app: DiscoveryApp) -> URL? {
        guard let path = app.badge, isInAppPath(path) else { return nil }
        return URL(string: app.url + path)
    }

    private struct Payload: Decodable {
        let count: Int
        let path: String?
    }

    /// `JSONDecoder` rejects a fractional, boolean, or missing count.
    public static func parse(_ data: Data) -> BadgeReading? {
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.count >= 0 else { return nil }
        return BadgeReading(count: payload.count,
                            path: payload.path.flatMap { isInAppPath($0) ? $0 : nil })
    }
}

public struct BadgeBook: Sendable {
    /// Matches the tray's daemon-health rule: two misses in a row are noise,
    /// the third means the app is really gone.
    public static let failureHold = 2

    public private(set) var readings: [String: BadgeReading] = [:]
    private var failures: [String: Int] = [:]

    public init() {}

    public mutating func record(app: String, reading: BadgeReading?) {
        if let reading {
            readings[app] = reading
            failures[app] = 0
            return
        }
        let misses = (failures[app] ?? 0) + 1
        failures[app] = misses
        if misses > Self.failureHold { readings[app] = nil }
    }

    public mutating func retain(apps: Set<String>) {
        readings = readings.filter { apps.contains($0.key) }
        failures = failures.filter { apps.contains($0.key) }
    }

    public var total: Int { readings.values.reduce(0) { $0 + $1.count } }

    public static func label(_ count: Int) -> String? {
        if count <= 0 { return nil }
        return count > 99 ? "99+" : String(count)
    }

    public static func firstBadged(_ readings: [String: BadgeReading], order: [String]) -> OpenRequest? {
        for name in order {
            guard let reading = readings[name], reading.count > 0 else { continue }
            return OpenRequest(app: name, pathAndQuery: reading.path ?? "")
        }
        return nil
    }
}
```

- [ ] **Step 4: Run the checks to verify they pass**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: exit 0, all checks pass including the new badge checks.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Launch/OpenLink.swift rt-tray/Sources-core/Window/Badges.swift rt-tray/Tests/MattstackCoreChecks/BadgeChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray core: badge path on DiscoveryApp, badge parsing and the 2-failure hold"
```

---

### Task 7: Tray app: poller, tab pill, dock badge, dock click

Repo: repo-tools.

**Files:**
- Create: `rt-tray/Sources/Window/BadgePoller.swift`
- Modify: `rt-tray/Sources/Window/WindowModel.swift` (badges state, `openBadge`, `firstBadgedRequest`)
- Modify: `rt-tray/Sources/Window/MattstackWindowView.swift` (`TabButton` pill)
- Modify: `rt-tray/Sources/Window/ShellChrome.swift` (badge colors)
- Modify: `rt-tray/Sources/AppDelegate.swift` (start the poller; dock-click target in `applicationShouldHandleReopen`)

**Interfaces:**
- Consumes: `BadgeParse`, `BadgeBook`, `BadgeReading`, `DiscoveryApp.badge` (Task 6); `WindowModel.open(_:)`, `ensureCatalogLoaded()` (existing).
- Produces: `WindowModel.badges: [String: BadgeReading]` (published), `WindowModel.openBadge(for:)`, `WindowModel.firstBadgedRequest() -> OpenRequest?`, `BadgePoller(model:).start()`.

- [ ] **Step 1: Add model state and actions**

`rt-tray/Sources/Window/WindowModel.swift`, in `WindowModel` after `@Published private(set) var splashOpacity: Double = 1`:

```swift
    @Published var badges: [String: BadgeReading] = [:]
```

And after `func select(_ name: String) { ... }`:

```swift
    /// The pill opens the oldest counted decision; with no path it just selects the tab.
    func openBadge(for name: String) {
        guard let path = badges[name]?.path else { select(name); return }
        Task { _ = await open(OpenRequest(app: name, pathAndQuery: path)) }
    }

    func firstBadgedRequest() -> OpenRequest? {
        BadgeBook.firstBadged(badges, order: apps.map(\.name))
    }
```

- [ ] **Step 2: Create the poller**

Create `rt-tray/Sources/Window/BadgePoller.swift`:

```swift
import AppKit
import MattstackCore

/// Its own timer, not the daemon status tick: that path returns early when
/// the daemon is down and holds an in-flight latch, and a slow app must not
/// delay health.
@MainActor
final class BadgePoller {
    private weak var model: WindowModel?
    private var timer: Timer?
    private var book = BadgeBook()
    private var ticking = false

    init(model: WindowModel) {
        self.model = model
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.tick() }
        }
        Task { await tick() }
    }

    private func tick() async {
        guard !ticking, let model else { return }
        ticking = true
        defer { ticking = false }
        await model.ensureCatalogLoaded()
        let targets = model.apps.compactMap { app in
            BadgeParse.endpoint(for: app).map { (app.name, $0) }
        }
        let results = await withTaskGroup(of: (String, BadgeReading?).self) { group in
            for (name, url) in targets {
                group.addTask { (name, await Self.fetch(url)) }
            }
            var out: [(String, BadgeReading?)] = []
            for await result in group { out.append(result) }
            return out
        }
        book.retain(apps: Set(targets.map(\.0)))
        for (name, reading) in results { book.record(app: name, reading: reading) }
        model.badges = book.readings
        NSApp.dockTile.badgeLabel = BadgeBook.label(book.total)
    }

    nonisolated private static func fetch(_ url: URL) async -> BadgeReading? {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        request.httpMethod = "GET"
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return BadgeParse.parse(data)
    }
}
```

- [ ] **Step 3: Paint the tab pill**

`rt-tray/Sources/Window/ShellChrome.swift`, add inside `enum ShellChrome` after `warn`:

```swift
    static let badgeFill = warn
    static let badgeText = bar
```

`rt-tray/Sources/Window/MattstackWindowView.swift`: add next to the other private color lets:

```swift
private let badgeFill = ShellChrome.badgeFill.color
private let badgeText = ShellChrome.badgeText.color
```

A Button's label is one hit target on macOS, so the pill cannot live inside the tab Button's label; it must be a sibling Button. In `TabButton.body`, wrap the whole existing `Button { model.select(app.name) } label: { ... }` expression, together with its trailing modifiers (`.buttonStyle(.plain)`, `.help`, `.modifier(TabShortcut(...))`, `.contextMenu`), in:

```swift
        ZStack(alignment: .trailing) {
            // existing tab Button and its modifiers, unchanged
            if let count = model.badges[app.name]?.count, let label = BadgeBook.label(count) {
                Button { model.openBadge(for: app.name) } label: {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(badgeText)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Capsule().fill(badgeFill))
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .help("Open the oldest waiting decision")
            }
        }
```

and change the label `HStack`'s `.padding(.leading, 10)` to `.padding(.leading, 10).padding(.trailing, 30)` so a long app name truncates before the pill instead of under it.

Add `import MattstackCore` at the top of the file if it is not already imported.

- [ ] **Step 4: Start the poller and route dock clicks**

`rt-tray/Sources/AppDelegate.swift`:
- Add a property next to `fileprivate var windowModel: WindowModel?`:

```swift
    private var badgePoller: BadgePoller?
```

- After `Task { await model.ensureCatalogLoaded() }` in `buildServices()`:

```swift
        let poller = BadgePoller(model: model)
        badgePoller = poller
        poller.start()
```

- In `applicationShouldHandleReopen`, replace the body of the `Task { @MainActor in ... }` with:

```swift
            Task { @MainActor in
                if let model = self.windowModel, let request = model.firstBadgedRequest() {
                    self.mattstackWindow?.show()
                    if await model.open(request) { return }
                }
                // `windowModel.controller` is a weak back-reference; fall
                // back to the strongly-held `mattstackWindow` ivar if it's
                // ever nil so a Dock click can't silently no-op.
                if let controller = self.windowModel?.controller {
                    controller.show()
                } else {
                    self.mattstackWindow?.show()
                }
            }
```

A failed `open` (the app is no longer in the catalog) falls through to today's plain show.

- [ ] **Step 5: Build and run the checks**

Run: `cd rt-tray && swift build && swift run mattstack-checks`
Expected: build succeeds, checks exit 0. Do not run `./build.sh dev` or `./build.sh install`; they write the blessed bundles.

- [ ] **Step 6: Commit**

```bash
git add rt-tray/Sources/Window/BadgePoller.swift rt-tray/Sources/Window/WindowModel.swift rt-tray/Sources/Window/MattstackWindowView.swift rt-tray/Sources/Window/ShellChrome.swift rt-tray/Sources/AppDelegate.swift
git commit -m "tray: poll app badges, tab count pill, dock badge, dock click opens the first decision"
```

---

### Task 8: Real check and rollout (controller-owned)

Not dispatched to an implementer. The controller runs this with Matt, because it needs his running apps and a GUI launch he approves.

- [ ] **Step 1: Deploy the app changes**

With Matt's go-ahead: merge the mattstack-apps branch, then `deck restart board`, `deck restart console`, and restart deck. Re-register board and console with deck so `ingestManifest` reads the new `badge` key (deck ingests only at register or adopt). Confirm with:

```bash
curl -s https://deck.mattstack/api/apps | python3 -c 'import json,sys; print({a["name"]: a.get("badge") for a in json.load(sys.stdin)["apps"]})'
curl -s https://board.mattstack/api/badge; echo; curl -s https://console.mattstack/api/badge
```

Expected: `board` and `console` show `/api/badge`; both endpoints return `{"count":...}`.

- [ ] **Step 2: Run the tray build**

Ask Matt to build and launch the tray from the repo-tools branch in his own terminal (worker sessions cannot launch GUI apps; never rebuild the blessed bundles from a session). Delete or let refresh `~/.mattstack/rt/window-apps-cache.json` only with his OK.

- [ ] **Step 3: Exercise the badges and look at them**

- Open a real human-owned MR gate the board shows, and a real `run:` gate on a live run (for example a :work run's plan gate).
- Screenshot the tab strip and the dock icon in light and dark macOS appearance (`screencapture -x`), plus the console run list with one "blocked" and, if a herd run is live, one "waiting on shepherd" row.
- Say plainly what looks wrong: pill clipping the tab label, pill colors on the dark bar, the console label overflowing its 280pt band.
- Click the board pill: the board tab opens on `/?gate=<id>`. Close the window and click the dock icon: the window opens on the first badged tab's decision.
- Answer both gates and confirm every badge clears within about 10s.
- Restart the rt daemon with a gate open and confirm the board badge is still correct about 10s after it reconnects.

- [ ] **Step 4: Report**

Post the screenshots and any defects to Matt before calling the feature done.
