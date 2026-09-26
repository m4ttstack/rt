# Board Sync-Health Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When GitLab sync is failing or the board's data is stale, the board says so at the top of the page (and in the tab title), naming the cause the rt daemon saw.

**Architecture:** The rt daemon records each repo's current run of failed project syncs at the single `syncProjectMRs` chokepoint and returns it as an optional `syncError` on `project-mrs:read` (typed in `@mattstack/rt-client` 0.29.0). The board folds every project's `syncError` into one snapshot field, and a pure `freshnessBanner()` in `view.ts` picks one message and an intent that `Board.tsx` renders with the existing `.tui-banner` styles.

**Tech Stack:** Bun (test runner and runtime), TypeScript, React 19 (board client), happy-dom for DOM tests, the rt daemon (`m4ttstack/rt`, checkout at `/Users/matt/Documents/GitHub/repo-tools`), this repo (`m4ttstack/apps`).

**Spec:** `docs/superpowers/specs/2026-09-22-board-sync-health-banner-design.md`

## Global Constraints

- Two repos. Part A runs in an rt worktree of `m4ttstack/rt`; Part B runs in this worktree (`ideal-oyster`, branch `board-sync-health-banner`). Part B cannot start until the Checkpoint between them is done: it needs `@mattstack/rt-client@0.29.0` on npm.
- Wire field name `syncError`; kinds exactly `'rate-limited' | 'auth' | 'server-error' | 'timeout' | 'other'`; `message` capped at 200 chars.
- Stale means data older than 10 minutes (the existing `dataAgeLabel` rule). A banner is `bad` past 30 minutes; `auth` and `fetchError` are always `bad`.
- Banner copy uses `...`, never an em dash or en dash. This applies to all copy, comments and commit messages.
- No new colour and no new CSS: the banner reuses `.tui-banner` and `[data-intent='bad']` (`docs/ui-authoring.md`).
- Comments state constraints the code cannot show; no narration, no review/process references.
- Do not re-baseline `apps/board/tests/baselines/`: `capture:compare` is red on `main` already.
- rt: publish `@mattstack/rt-client` only from a `main` checkout, never with `--ignore-scripts`; rebuild `packages/rt-client/dist` after touching its source. Never run a built rt binary without an isolated `HOME`.
- This repo is public: test data is invented (`scripts/repo-purity.sh` sweeps the tree).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Cold daemon, GitLab already down:** a repo with no store record yet must still report `syncError` on `project-mrs:read`, or the board shows nothing on the day it matters most. Pinned in Task A3.
2. **A status-looking number inside a GraphQL timeout message** (`Timeout on MergeRequest.id 500`) must classify as `timeout`, not `server-error`. Pinned in Task A1.
3. **Board clock ahead of the daemon's `syncedAt`** (a future timestamp) must read as fresh, never as a negative age. Pinned in Task B2.
4. **An older daemon or an older `data.json` with no `syncError` key** must fall back to the age-only banner without crashing. Pinned in Task B2 (undefined `syncError`) and Task B3 (DOM fixtures without the key).
5. **Repeated polls while stale** must not stack the title prefix (`⚠ ⚠ ...`), and clearing the banner must restore the original title. Pinned in Task B3.

---

## Part A: rt daemon and rt-client (`m4ttstack/rt`)

Provision the worktree once, before Task A1, from the rt checkout (never `git worktree add` there):

```bash
cd /Users/matt/Documents/GitHub/repo-tools
rt worktree provision --branch project-sync-health --owner claude --wait --json
```

Use the `path` it prints as `$RT` for every Part A command. Run all Part A tests from `$RT`.

### Task A1: Wire type and the sync-health module

**Files:**
- Modify: `$RT/packages/rt-client/src/commands.ts` (after `ProjectMRsScope`, and inside `ProjectMRsData`)
- Modify: `$RT/packages/rt-client/src/index.ts` (the `export type { ... } from "./commands.ts"` block)
- Create: `$RT/lib/daemon/project-sync-health.ts`
- Test: `$RT/lib/daemon/__tests__/project-sync-health.test.ts`

**Interfaces:**
- Produces: `ProjectSyncErrorKind`, `ProjectSyncError` (rt-client), `ProjectMRsData.syncError?: ProjectSyncError`; `classifySyncError(message: string): ProjectSyncErrorKind`, `recordSyncFailure(repoName: string, err: unknown, now: number): void`, `recordSyncSuccess(repoName: string): void`, `readSyncHealth(repoName: string): ProjectSyncError | undefined`.

- [ ] **Step 1: Add the wire type to rt-client**

In `packages/rt-client/src/commands.ts`, directly after the `ProjectMRsScope` interface:

```ts
/** Classified cause of a repo's failing project sync (lib/daemon/project-sync-health.ts). */
export type ProjectSyncErrorKind = "rate-limited" | "auth" | "server-error" | "timeout" | "other";

/** A repo's current unbroken run of failed project syncs. */
export interface ProjectSyncError {
  /** First failure of the run; later failures leave it alone. */
  since: number;
  lastAt: number;
  kind: ProjectSyncErrorKind;
  /** Raw error text, capped at 200 chars. */
  message: string;
}
```

In the same file, add the last field of `ProjectMRsData`:

```ts
export interface ProjectMRsData {
  mrs: Record<string, { pr: PullRequest; fetchedAt: number; codeownerSections?: string[] }>;
  listSyncedAt: number;
  source: "poll" | "events" | "mutation";
  syncedAt: number;
  scope?: ProjectMRsScope;
  /** Present while this repo's most recent project sync failed. */
  syncError?: ProjectSyncError;
}
```

In `packages/rt-client/src/index.ts`, add `ProjectSyncError,` and `ProjectSyncErrorKind,` to the `export type { ... } from "./commands.ts"` list, next to `ProjectMRsData,`.

- [ ] **Step 2: Write the failing tests**

Create `lib/daemon/__tests__/project-sync-health.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { classifySyncError, readSyncHealth, recordSyncFailure, recordSyncSuccess } from "../project-sync-health.ts";

describe("classifySyncError", () => {
  test.each([
    ["GraphQL request failed: 500 Internal Server Error", "server-error"],
    ["GraphQL request failed: 502 Bad Gateway", "server-error"],
    ["GraphQL request failed: 429 Too Many Requests", "rate-limited"],
    ["fetchMergeRequests: HTTP 429 for /projects/1/merge_requests", "rate-limited"],
    ["GraphQL request failed: 401 Unauthorized", "auth"],
    ["fetchProject: HTTP 403 for g/p", "auth"],
    ["GraphQL errors: Timeout on PageInfo.endCursor; Timeout on MergeRequestConnection.nodes", "timeout"],
    ["The operation timed out.", "timeout"],
    ["GraphQL request failed: 404 Not Found", "other"],
    ["socket hang up", "other"],
  ])("%s -> %s", (message, kind) => {
    expect(classifySyncError(message)).toBe(kind);
  });

  test("a number inside a timeout's field list is not read as a status", () => {
    expect(classifySyncError("GraphQL errors: Timeout on MergeRequest.id 500")).toBe("timeout");
  });
});

describe("sync health", () => {
  test("a failure is recorded with its kind, message and since", () => {
    recordSyncFailure("health:a", new Error("GraphQL request failed: 500 Internal Server Error"), 1_000);
    expect(readSyncHealth("health:a")).toEqual({
      since: 1_000,
      lastAt: 1_000,
      kind: "server-error",
      message: "GraphQL request failed: 500 Internal Server Error",
    });
  });

  test("consecutive failures keep since and advance lastAt and kind", () => {
    recordSyncFailure("health:b", new Error("GraphQL request failed: 500 Internal Server Error"), 1_000);
    recordSyncFailure("health:b", new Error("GraphQL errors: Timeout on MergeRequest.id"), 2_000);
    expect(readSyncHealth("health:b")).toMatchObject({ since: 1_000, lastAt: 2_000, kind: "timeout" });
  });

  test("a success clears the record, and the next failure starts a new run", () => {
    recordSyncFailure("health:c", new Error("socket hang up"), 1_000);
    recordSyncSuccess("health:c");
    expect(readSyncHealth("health:c")).toBeUndefined();
    recordSyncFailure("health:c", new Error("socket hang up"), 5_000);
    expect(readSyncHealth("health:c")?.since).toBe(5_000);
  });

  test("the message is capped at 200 chars but classified from the full text", () => {
    recordSyncFailure("health:d", new Error(`${"x".repeat(250)} fetchX: HTTP 429 for /p`), 1_000);
    const rec = readSyncHealth("health:d")!;
    expect(rec.message).toHaveLength(200);
    expect(rec.kind).toBe("rate-limited");
  });

  test("a non-Error rejection is recorded by its string form", () => {
    recordSyncFailure("health:e", "gitlab down", 1_000);
    expect(readSyncHealth("health:e")?.message).toBe("gitlab down");
  });

  test("repos are tracked independently", () => {
    recordSyncFailure("health:f1", new Error("socket hang up"), 1_000);
    expect(readSyncHealth("health:f2")).toBeUndefined();
    recordSyncSuccess("health:f2");
    expect(readSyncHealth("health:f1")).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/project-sync-health.test.ts`
Expected: FAIL, `Cannot find module '../project-sync-health.ts'`.

- [ ] **Step 4: Write the module**

Create `lib/daemon/project-sync-health.ts`:

```ts
/**
 * Per-repo record of the current run of failed project syncs, so
 * project-mrs:read can tell a client why its data stopped moving.
 * In-memory: a restarted daemon relearns it on the next failed sync.
 */

import type { ProjectSyncError, ProjectSyncErrorKind } from "../../packages/rt-client/src/commands.ts";

const MESSAGE_CAP = 200;

/** glance's two status wordings: "... failed: 500 Internal Server Error" and "<op>: HTTP 429 for <path>". */
const STATUS_RE = /(?:failed: |HTTP )(\d{3})\b/;

const failing = new Map<string, ProjectSyncError>();

export function classifySyncError(message: string): ProjectSyncErrorKind {
  const status = Number(STATUS_RE.exec(message)?.[1] ?? 0);
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500 && status < 600) return "server-error";
  if (message.includes("Timeout on") || message.includes("timed out")) return "timeout";
  return "other";
}

export function recordSyncFailure(repoName: string, err: unknown, now: number): void {
  const full = err instanceof Error ? err.message : String(err);
  failing.set(repoName, {
    since: failing.get(repoName)?.since ?? now,
    lastAt: now,
    kind: classifySyncError(full),
    message: full.slice(0, MESSAGE_CAP),
  });
}

export function recordSyncSuccess(repoName: string): void {
  failing.delete(repoName);
}

export function readSyncHealth(repoName: string): ProjectSyncError | undefined {
  return failing.get(repoName);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/project-sync-health.test.ts`
Expected: PASS (all tests).

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/src/index.ts lib/daemon/project-sync-health.ts lib/daemon/__tests__/project-sync-health.test.ts
git commit -m "daemon: add project-sync-health (classified per-repo sync failures)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task A2: Record every sync outcome in `syncProjectMRs`

**Files:**
- Modify: `$RT/lib/daemon/project-sync.ts` (imports; the `syncProjectMRs` function, currently lines 160-170)
- Test: `$RT/lib/daemon/__tests__/project-sync.test.ts`

**Interfaces:**
- Consumes: `recordSyncFailure`, `recordSyncSuccess`, `readSyncHealth` from Task A1.
- Produces: every call to `syncProjectMRs` (the 5-minute cycle, watcher start, forced reads) updates the health map.

- [ ] **Step 1: Write the failing tests**

In `lib/daemon/__tests__/project-sync.test.ts`, add to the imports at the top:

```ts
import { readSyncHealth } from "../project-sync-health.ts";
```

Append at the end of the file:

```ts
describe("sync health recording", () => {
  const depsFor = (repo: string) => ({ repoIndex: () => ({ [repo]: "/tmp/repo" }), broadcast: () => {} });

  test("a failed sync records the failure for the repo", async () => {
    await expect(
      syncProjectMRs(depsFor("health-fail"), "health-fail", {
        store: tmpStore(),
        fetchProject: async () => { throw new Error("GraphQL request failed: 500 Internal Server Error"); },
      }),
    ).rejects.toThrow("500");
    expect(readSyncHealth("health-fail")).toMatchObject({ kind: "server-error" });
  });

  test("a successful sync clears an earlier failure", async () => {
    const store = tmpStore();
    await expect(
      syncProjectMRs(depsFor("health-heal"), "health-heal", {
        store,
        fetchProject: async () => { throw new Error("GraphQL errors: Timeout on MergeRequest.id"); },
      }),
    ).rejects.toThrow();
    expect(readSyncHealth("health-heal")?.kind).toBe("timeout");
    await syncProjectMRs(depsFor("health-heal"), "health-heal", {
      store,
      fetchProject: async () => ({ projectPath: "g/p", prs: [pr(1)] }),
    });
    expect(readSyncHealth("health-heal")).toBeUndefined();
  });

  test("a failed deep that falls back to a working delta counts as success", async () => {
    const store = tmpStore();
    store.fullSync("health-fallback", "g/p", [pr(1)], Date.now() - (DEEP_RECONCILE_MS + 60_000));
    await syncProjectMRs(depsFor("health-fallback"), "health-fallback", {
      store,
      fetchProject: async () => { throw new Error("GraphQL errors: Timeout on DiffStatsSummary.additions"); },
      fetchDelta: async () => ({ projectPath: "g/p", prs: [] }),
    });
    expect(readSyncHealth("health-fallback")).toBeUndefined();
  });

  test("coalesced callers record the outcome once and both see the rejection", async () => {
    const store = tmpStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchProject = async () => {
      await gate;
      throw new Error("GraphQL request failed: 503 Service Unavailable");
    };
    const deps = depsFor("health-coalesce");
    const p1 = syncProjectMRs(deps, "health-coalesce", { store, fetchProject });
    const p2 = syncProjectMRs(deps, "health-coalesce", { store, fetchProject });
    release();
    await expect(p1).rejects.toThrow("503");
    await expect(p2).rejects.toThrow("503");
    expect(readSyncHealth("health-coalesce")).toMatchObject({ kind: "server-error" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts -t "sync health recording"`
Expected: FAIL. The first test's `readSyncHealth("health-fail")` is `undefined`.

- [ ] **Step 3: Record the outcome in the single-flight wrapper**

In `lib/daemon/project-sync.ts`, add to the imports:

```ts
import { recordSyncFailure, recordSyncSuccess } from "./project-sync-health.ts";
```

Replace the body of `syncProjectMRs`:

```ts
export function syncProjectMRs(
  deps: ProjectSyncDeps,
  repoName: string,
  overrides: ProjectSyncOverrides = {},
): Promise<void> {
  const existing = syncInFlight.get(repoName);
  if (existing) return existing;
  const run = syncImpl(deps, repoName, overrides)
    .then(
      () => { recordSyncSuccess(repoName); },
      (err: unknown) => {
        recordSyncFailure(repoName, err, Date.now());
        throw err;
      },
    )
    .finally(() => { syncInFlight.delete(repoName); });
  syncInFlight.set(repoName, run);
  return run;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/project-sync.ts lib/daemon/__tests__/project-sync.test.ts
git commit -m "daemon: record project sync outcomes at the syncProjectMRs chokepoint

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task A3: Serve `syncError` on `project-mrs:read`; bump rt-client to 0.29.0

**Files:**
- Modify: `$RT/lib/daemon/handlers/project-mrs.ts` (imports; the two `return { ok: true, data: ... }` statements at the end of the `"project-mrs:read"` handler)
- Modify: `$RT/packages/rt-client/package.json` (`"version"`)
- Test: `$RT/lib/daemon/__tests__/project-sync.test.ts` (the `describe("project-mrs:read handler", ...)` block)

**Interfaces:**
- Consumes: `readSyncHealth` from Task A1; `ProjectMRsData.syncError` from Task A1.
- Produces: `project-mrs:read` data carries `syncError` when the repo is failing; the key is absent otherwise.

- [ ] **Step 1: Write the failing tests**

In `lib/daemon/__tests__/project-sync.test.ts`, extend the import added in Task A2:

```ts
import { readSyncHealth, recordSyncFailure } from "../project-sync-health.ts";
```

Inside the `describe("project-mrs:read handler", ...)` block, after the last existing test, add:

```ts
  const sickHandler = (repo: string, store = tmpStore()) =>
    createProjectMRsHandlers(
      { repoIndex: () => ({ [repo]: "/tmp/repo" }), log: { warn: () => {} } } as any,
      () => {},
      {
        store,
        sync: async () => {},
        tracking: () => ({ [repo]: { mode: "live" as const, caches: ["branches", "project-mrs"] as any } }),
      },
    );

  test("a repo whose last sync failed reports syncError", async () => {
    const repo = "remote:sick";
    recordSyncFailure(repo, new Error("GraphQL request failed: 500 Internal Server Error"), 1_000);
    const store = tmpStore();
    store.fullSync(repo, "g/p", [pr(1)], Date.now());
    const data = dataOf(await sickHandler(repo, store)["project-mrs:read"]!({ repoName: repo }));
    expect(data.syncError).toEqual({
      since: 1_000,
      lastAt: 1_000,
      kind: "server-error",
      message: "GraphQL request failed: 500 Internal Server Error",
    });
  });

  test("a cold repo (no store record yet) still reports syncError", async () => {
    const repo = "remote:cold-sick";
    recordSyncFailure(repo, new Error("GraphQL errors: Timeout on MergeRequest.id"), 2_000);
    const data = dataOf(await sickHandler(repo)["project-mrs:read"]!({ repoName: repo }));
    expect(data.syncedAt).toBe(0);
    expect(data.syncError?.kind).toBe("timeout");
  });

  test("a healthy repo omits the syncError key", async () => {
    const repo = "remote:healthy";
    const store = tmpStore();
    store.fullSync(repo, "g/p", [pr(1)], Date.now());
    const data = dataOf(await sickHandler(repo, store)["project-mrs:read"]!({ repoName: repo }));
    expect("syncError" in data).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts -t "syncError"`
Expected: FAIL. `data.syncError` is `undefined` in the first two tests.

- [ ] **Step 3: Include the record in both success returns**

In `lib/daemon/handlers/project-mrs.ts`, add to the imports:

```ts
import { readSyncHealth } from "../project-sync-health.ts";
```

Replace the tail of the `"project-mrs:read"` handler, from `if (!record) return ...` through the final `return`, with:

```ts
      const syncError = readSyncHealth(repoName);
      const health = syncError ? { syncError } : {};
      if (!record) return { ok: true, data: { mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0, ...health } };
      return {
        ok: true,
        data: {
          mrs: record.mrs,   // verbatim: entries serialize as-is, so codeownerSections flows unmapped
          listSyncedAt: record.listSyncedAt,
          source: record.source,
          syncedAt: freshnessOf(record),
          scope: record.scope ? {
            ...record.scope, uncovered,
            ...(demandedSections.length > 0 || record.scope.sections
              ? { sections: record.scope.sections ?? [], uncoveredSections } : {}),
          } : undefined,
          ...health,
        },
      };
```

Leave the early `decodeRepo` failure return (`{ mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0 }`) unchanged: an undecodable repo has no identity to look up.

- [ ] **Step 4: Bump rt-client and rebuild its dist**

In `packages/rt-client/package.json`, change `"version": "0.28.0"` to `"version": "0.29.0"`.

Run: `cd packages/rt-client && bun run build && cd -`
Expected: exits 0.

- [ ] **Step 5: Run the full gate**

Run: `bunx tsc --noEmit && bun test lib commands packages scripts`
Expected: typecheck clean; all tests pass, including `packages/rt-client/test/dist-freshness.test.ts`.

Run: `bun run docs:check`
Expected: passes (no CLI surface changed).

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/handlers/project-mrs.ts lib/daemon/__tests__/project-sync.test.ts packages/rt-client/package.json
git commit -m "project-mrs:read: return syncError while a repo's sync is failing; rt-client 0.29.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Checkpoint: land and publish Part A (Matt confirms each outward step)

- [ ] Push `project-sync-health` and open a PR on `m4ttstack/rt`. Title: `daemon: report project sync failures on project-mrs:read (rt-client 0.29.0)`. Body: the Problem/Fix from the spec in two short paragraphs, plus a line announcing the rt-client `0.29.0` bump (the version is a shared resource).
- [ ] Wait for CodeRabbit's review and address every actionable finding; wait for `Checks` to go green.
- [ ] With Matt's confirmation, merge.
- [ ] Publish from a `main` checkout (check `git branch --show-current` first; the main checkout is the dev daemon's deployed code): `git pull`, then in `packages/rt-client` run `bun run build`, `grep -c syncError dist/index.d.ts dist/commands.d.ts` (expect a non-zero count), and `npm publish` using the `matt:npm-publish` skill for the OTP. Allow 3-5 minutes of registry lag before Part B's install.
- [ ] Restart the dev daemon so it serves the new field: `rt daemon restart`. Confirm with a live read: once a sync has failed, `project-mrs:read` for the board's repo carries `syncError`; on a healthy day the key is absent.

---

## Part B: board (`apps/board`, this worktree)

All Part B paths are relative to this worktree root unless they start with `apps/board/`. Run `bun run tui-kit:build` once before any board typecheck or test.

### Task B1: Pin rt-client 0.29.0 and carry `syncError` through the snapshot

**Files:**
- Modify: `package.json` (root `workspaces.catalog`), `bun.lock` (via `bun install`)
- Modify: `apps/board/src/data.ts` (rt-client import; new `BoardSyncError`; `Snapshot`; `SyncScopeRead`; `aggregateSyncScope`)
- Modify: `apps/board/src/server.ts` (the `./data.ts` import; `TeamMRsResult`; `fetchTeamMRs`; the `SnapshotCache` fetcher; `/data.json`)
- Modify: `apps/board/src/cache.ts` (empty-snapshot branch in `refresh()`)
- Modify: `apps/board/src/client/types.ts` (`BoardData`)
- Test: `apps/board/src/__tests__/board.test.ts`, `apps/board/src/__tests__/cache.test.ts`

**Interfaces:**
- Consumes: `ProjectSyncError` and `ProjectMRsData.syncError` from `@mattstack/rt-client@0.29.0`.
- Produces: `BoardSyncError` (exported from `apps/board/src/data.ts`) = `ProjectSyncError & { projects: number }`; `Snapshot.syncError: BoardSyncError | null`; `BoardData.syncError: BoardSyncError | null`; `aggregateSyncScope(reads)` returns `syncError`.

- [ ] **Step 1: Bump the catalog pin**

In the root `package.json`, under `workspaces.catalog`, change `"@mattstack/rt-client": "0.27.0"` to `"@mattstack/rt-client": "0.29.0"`.

Run: `bun install`
Expected: `bun.lock` updates `@mattstack/rt-client` to `0.29.0`; no member lockfiles appear.

Run: `bun run tui-kit:build && bun run chat:typecheck && bun run console:typecheck && bun run boxscore:typecheck && bun run board:typecheck && bun run deck:test`
Expected: all pass. The bump also pulls in rt-client `0.28.0`'s changes; if one fails, fix that app before continuing and mention it in the PR body.

- [ ] **Step 2: Write the failing tests**

In `apps/board/src/__tests__/board.test.ts`, in `describe('aggregateSyncScope', ...)`, change the expected object of `'no reads yields null syncedAt/windowDays and an empty uncovered list'` to include `syncError: null`:

```ts
    expect(aggregateSyncScope([])).toEqual({
      dataSyncedAt: null,
      scopeUncovered: [],
      scopeWindowDays: null,
      scopeUncoveredSections: [],
      scopeKnownSections: null,
      syncError: null,
    });
```

Add two tests to the same `describe`:

```ts
  test('syncError is the failing read with the earliest since, counting every failing project', () => {
    const agg = aggregateSyncScope([
      {
        syncedAt: 100,
        syncError: {
          since: 50,
          lastAt: 90,
          kind: 'timeout',
          message: 'GraphQL errors: Timeout on MergeRequest.id',
        },
      },
      { syncedAt: 100 },
      {
        syncedAt: 100,
        syncError: {
          since: 20,
          lastAt: 95,
          kind: 'server-error',
          message: 'GraphQL request failed: 500 Internal Server Error',
        },
      },
    ]);
    expect(agg.syncError).toEqual({
      since: 20,
      lastAt: 95,
      kind: 'server-error',
      message: 'GraphQL request failed: 500 Internal Server Error',
      projects: 2,
    });
  });

  test('reads without a syncError yield null', () => {
    expect(aggregateSyncScope([{ syncedAt: 1 }]).syncError).toBeNull();
  });
```

In both `fetchResult` helpers (`apps/board/src/__tests__/board.test.ts` and `apps/board/src/__tests__/cache.test.ts`), add `syncError: null,` after `scopeKnownSections: null,`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/board.test.ts -t aggregateSyncScope`
Expected: FAIL. `syncError` is missing from the aggregate.

- [ ] **Step 4: Implement the data layer**

`apps/board/src/data.ts`, change the rt-client import:

```ts
import type {
  DemandDecl,
  ProjectMRsScope,
  ProjectSyncError,
} from '@mattstack/rt-client';
```

Add after the imports (before `Snapshot`):

```ts
/** The board-wide sync failure: the failing project with the longest
    outage, plus how many projects are failing. */
export type BoardSyncError = ProjectSyncError & { projects: number };
```

Add to the end of `interface Snapshot`:

```ts
  /** The longest-running rt project sync failure among the daemon reads;
      null when none reported one (including an rt without the field). */
  syncError: BoardSyncError | null;
```

Change `SyncScopeRead`:

```ts
export interface SyncScopeRead {
  syncedAt: number;
  scope?: ProjectMRsScope;
  syncError?: ProjectSyncError;
}
```

In `aggregateSyncScope`, add one sentence to the doc comment (after the `scopeKnownSections` sentence): `` `syncError` is the failing project with the earliest `since`, with `projects` counting every failing read. `` Then change the function: add `syncError: BoardSyncError | null;` to its return type; before the loop declare

```ts
  let longest: ProjectSyncError | null = null;
  let failing = 0;
```

inside the loop, after the `scope` block:

```ts
    if (read.syncError) {
      failing++;
      if (!longest || read.syncError.since < longest.since)
        longest = read.syncError;
    }
```

and add to the returned object:

```ts
    syncError: longest ? { ...longest, projects: failing } : null,
```

`apps/board/src/server.ts`:
- Add `type BoardSyncError,` to the `./data.ts` import list.
- In `interface TeamMRsResult`, add `syncError: BoardSyncError | null;` after `scopeKnownSections`.
- In `fetchTeamMRs`, change the push to `reads.push({ syncedAt: res.data.syncedAt, scope: res.data.scope, syncError: res.data.syncError });`
- In the `new SnapshotCache(async () => { ... })` fetcher, add `syncError,` to the destructure of `await fetchTeamMRs(force)` and to the returned object.
- In the `/data.json` response object, add `syncError: snapshot.syncError,` after `dataSyncedAt: snapshot.dataSyncedAt,`.

`apps/board/src/cache.ts`: in the empty-snapshot object inside `.catch`, add `syncError: null,` after `scopeKnownSections: null,`.

`apps/board/src/client/types.ts`: change `import type { BoardMR } from '../data.ts';` to `import type { BoardMR, BoardSyncError } from '../data.ts';` and add to `BoardData`, after `dataSyncedAt`:

```ts
  /** The longest-running rt project sync failure behind this snapshot;
      null when rt reported none. Names the cause in the freshness banner. */
  syncError: BoardSyncError | null;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run board:typecheck && bun run board:test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock apps/board/src/data.ts apps/board/src/server.ts apps/board/src/cache.ts apps/board/src/client/types.ts apps/board/src/__tests__/board.test.ts apps/board/src/__tests__/cache.test.ts
git commit -m "board: pin rt-client 0.29.0 and carry rt's syncError through the snapshot

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task B2: `freshnessBanner()` in `view.ts`

**Files:**
- Modify: `apps/board/src/view.ts` (imports; `dataAgeLabel`; new exports after it)
- Test: `apps/board/src/__tests__/view.test.ts`

**Interfaces:**
- Consumes: `BoardSyncError` from Task B1.
- Produces: `ageText(ms: number): string`; `interface FreshnessBanner { text: string; intent: 'warn' | 'bad'; title?: string }`; `freshnessBanner(input: { fetchError: string | null; dataSyncedAt: number | null; syncError?: BoardSyncError | null; now: number }): FreshnessBanner | null`.

- [ ] **Step 1: Write the failing tests**

In `apps/board/src/__tests__/view.test.ts`, change `import type { BoardMR } from '../data.ts';` to `import type { BoardMR, BoardSyncError } from '../data.ts';`, and add `ageText,` and `freshnessBanner,` to the `../view.ts` import list (alphabetical, it is sorted). Append:

```ts
describe('ageText', () => {
  test('minutes under an hour, hours and minutes from an hour', () => {
    expect(ageText(0)).toBe('0m');
    expect(ageText(59 * 60_000 + 59_000)).toBe('59m');
    expect(ageText(60 * 60_000)).toBe('1h 0m');
    expect(ageText(103 * 60_000)).toBe('1h 43m');
    expect(ageText(25 * 60 * 60_000 + 3 * 60_000)).toBe('25h 3m');
  });

  test('a negative age (clock skew) reads as 0m', () => {
    expect(ageText(-5 * 60_000)).toBe('0m');
  });
});

describe('freshnessBanner', () => {
  // Local-time constructor, so the clock labels hold in any TZ.
  const at = (h: number, m: number) => new Date(2026, 8, 22, h, m).getTime();
  const now = at(16, 11);
  const timeout: BoardSyncError = {
    since: at(14, 31),
    lastAt: at(16, 5),
    kind: 'timeout',
    message: 'GraphQL errors: Timeout on MergeRequest.id',
    projects: 1,
  };
  const base = {
    fetchError: null,
    dataSyncedAt: at(14, 28),
    syncError: null,
    now,
  };

  test('fresh data: no banner, even with a sync error on record', () => {
    expect(freshnessBanner({ ...base, dataSyncedAt: at(16, 9) })).toBeNull();
    expect(
      freshnessBanner({ ...base, dataSyncedAt: at(16, 9), syncError: timeout })
    ).toBeNull();
  });

  test('stale data with a sync error names the cause; past 30 minutes it is bad', () => {
    expect(freshnessBanner({ ...base, syncError: timeout })).toEqual({
      text: '⚠ GitLab timing out since 14:31... board data is 1h 43m old (as of 14:28)',
      intent: 'bad',
      title: 'GraphQL errors: Timeout on MergeRequest.id',
    });
  });

  test('stale data without a cause is a warn up to 30 minutes', () => {
    expect(freshnessBanner({ ...base, dataSyncedAt: at(15, 56) })).toEqual({
      text: '⚠ board data is 15m old (as of 15:56)... rt sync is behind',
      intent: 'warn',
    });
  });

  test('thresholds: 10m exactly is fresh, 30m exactly is still warn, 31m is bad', () => {
    expect(freshnessBanner({ ...base, dataSyncedAt: now - 10 * 60_000 })).toBeNull();
    expect(
      freshnessBanner({ ...base, dataSyncedAt: now - 30 * 60_000 })!.intent
    ).toBe('warn');
    expect(
      freshnessBanner({ ...base, dataSyncedAt: now - 31 * 60_000 })!.intent
    ).toBe('bad');
  });

  test('each kind has its own wording', () => {
    const text = (kind: BoardSyncError['kind']) =>
      freshnessBanner({ ...base, syncError: { ...timeout, kind } })!.text;
    expect(text('server-error')).toStartWith(
      '⚠ GitLab returning server errors since 14:31'
    );
    expect(text('rate-limited')).toStartWith(
      '⚠ GitLab rate-limiting rt since 14:31'
    );
    expect(text('auth')).toStartWith("⚠ GitLab rejecting rt's token since 14:31");
    expect(text('other')).toStartWith('⚠ GitLab sync failing since 14:31');
  });

  test('auth is bad even while the data is only 15 minutes old', () => {
    expect(
      freshnessBanner({
        ...base,
        dataSyncedAt: at(15, 56),
        syncError: { ...timeout, kind: 'auth' },
      })!.intent
    ).toBe('bad');
  });

  test('unknown data age with a sync error still shows, escalating from since', () => {
    expect(
      freshnessBanner({
        ...base,
        dataSyncedAt: null,
        syncError: { ...timeout, since: at(16, 0) },
      })
    ).toEqual({
      text: '⚠ GitLab timing out since 16:00',
      intent: 'warn',
      title: 'GraphQL errors: Timeout on MergeRequest.id',
    });
    expect(
      freshnessBanner({ ...base, dataSyncedAt: 0, syncError: timeout })!.intent
    ).toBe('bad');
  });

  test('unknown data age and no sync error: no banner (the footer covers it)', () => {
    expect(freshnessBanner({ ...base, dataSyncedAt: null })).toBeNull();
  });

  test("the board's own refresh failure outranks everything and is always bad", () => {
    expect(
      freshnessBanner({
        ...base,
        fetchError: 'g/p: daemon unreachable',
        dataSyncedAt: at(16, 9),
        syncError: timeout,
      })
    ).toEqual({
      text: "⚠ board can't refresh... data is 2m old (as of 16:09)",
      intent: 'bad',
      title: 'g/p: daemon unreachable',
    });
    expect(
      freshnessBanner({ ...base, fetchError: 'x', dataSyncedAt: null })!.text
    ).toBe("⚠ board can't refresh");
  });

  test('several failing projects are counted in the tooltip', () => {
    expect(
      freshnessBanner({ ...base, syncError: { ...timeout, projects: 3 } })!.title
    ).toBe('GraphQL errors: Timeout on MergeRequest.id (3 projects failing)');
  });

  test('a syncedAt ahead of the board clock reads as fresh', () => {
    expect(freshnessBanner({ ...base, dataSyncedAt: at(16, 20) })).toBeNull();
  });

  test('a missing syncError key (older server) falls back to the age-only banner', () => {
    expect(
      freshnessBanner({ fetchError: null, dataSyncedAt: at(14, 28), now })!.text
    ).toBe(
      '⚠ board data is 1h 43m old (as of 14:28)... rt sync is behind'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/view.test.ts`
Expected: FAIL. `ageText` and `freshnessBanner` are not exported.

- [ ] **Step 3: Implement**

In `apps/board/src/view.ts`, change `import type { BoardMR } from './data.ts';` to `import type { BoardMR, BoardSyncError } from './data.ts';`.

Replace `dataAgeLabel` (keep its doc comment) and add the new code directly after it:

```ts
/** Daemon data older than this reads as stale, in the footer and the banner alike. */
const STALE_AFTER_MS = 10 * 60_000;
/** A stale banner turns from warn to bad past this. */
const ESCALATE_AFTER_MS = 30 * 60_000;

function clockLabel(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dataAgeLabel(
  dataSyncedAt: number | null,
  now: number
): { text: string; stale: boolean } {
  // <= 0 covers a cold shell record's syncedAt (no daemon read has landed
  // yet) -- epoch zero is not a real sync time, and rendering it as
  // "data as of 1:00" (local-timezone midnight) is misleading, not stale-but-honest.
  if (dataSyncedAt === null || dataSyncedAt <= 0)
    return { text: 'data age unknown', stale: true };
  return {
    text: `data as of ${clockLabel(dataSyncedAt)}`,
    stale: now - dataSyncedAt > STALE_AFTER_MS,
  };
}

/** "25m" under an hour, "1h 43m" from an hour. */
export function ageText(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const SYNC_ERROR_PHRASE: Record<BoardSyncError['kind'], string> = {
  timeout: 'timing out',
  'server-error': 'returning server errors',
  'rate-limited': 'rate-limiting rt',
  auth: "rejecting rt's token",
  other: 'sync failing',
};

export interface FreshnessBanner {
  text: string;
  intent: 'warn' | 'bad';
  title?: string;
}

/** The top-of-board freshness warning, or null while the data is fresh.
    The board's own refresh failing outranks rt's GitLab sync failing, which
    outranks bare age. A sync error stays quiet until the data actually goes
    stale, so one failed cycle never flashes a banner. */
export function freshnessBanner(input: {
  fetchError: string | null;
  dataSyncedAt: number | null;
  syncError?: BoardSyncError | null;
  now: number;
}): FreshnessBanner | null {
  const { fetchError, syncError, now } = input;
  const syncedAt =
    input.dataSyncedAt !== null && input.dataSyncedAt > 0
      ? input.dataSyncedAt
      : null;
  const age = syncedAt === null ? null : now - syncedAt;
  const ageClause =
    syncedAt === null || age === null
      ? null
      : `${ageText(age)} old (as of ${clockLabel(syncedAt)})`;

  if (fetchError)
    return {
      text: ageClause
        ? `⚠ board can't refresh... data is ${ageClause}`
        : "⚠ board can't refresh",
      intent: 'bad',
      title: fetchError,
    };

  if (syncError && (age === null || age > STALE_AFTER_MS)) {
    const outage = age ?? now - syncError.since;
    const cause = `⚠ GitLab ${SYNC_ERROR_PHRASE[syncError.kind]} since ${clockLabel(syncError.since)}`;
    return {
      text: ageClause ? `${cause}... board data is ${ageClause}` : cause,
      intent:
        syncError.kind === 'auth' || outage > ESCALATE_AFTER_MS ? 'bad' : 'warn',
      title:
        syncError.projects > 1
          ? `${syncError.message} (${syncError.projects} projects failing)`
          : syncError.message,
    };
  }

  if (age !== null && age > STALE_AFTER_MS)
    return {
      text: `⚠ board data is ${ageClause}... rt sync is behind`,
      intent: age > ESCALATE_AFTER_MS ? 'bad' : 'warn',
    };

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/__tests__/view.test.ts`
Expected: PASS, including the two existing `dataAgeLabel` tests.

Run: `bun run board:typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/view.ts apps/board/src/__tests__/view.test.ts
git commit -m "board: freshnessBanner picks the stale-data warning and its cause

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task B3: Render the banner, mark the tab, move the fixture

**Files:**
- Create: `apps/board/src/client/board/stale-tab-title.ts`
- Modify: `apps/board/src/client/board/Board.tsx` (imports; above the `if (!data)` loading guard; remove `staleMins`; the `data.fetchError` banner)
- Modify: `apps/board/tests/fixture/data.json` (`dataSyncedAt`, new `syncError`)
- Test: `apps/board/src/client/board/__tests__/freshness-banner-dom.test.tsx`

**Interfaces:**
- Consumes: `freshnessBanner` (Task B2), `BoardData.syncError` (Task B1).
- Produces: `useStaleTabTitle(stale: boolean): void`.

- [ ] **Step 1: Write the failing DOM test**

Create `apps/board/src/client/board/__tests__/freshness-banner-dom.test.tsx`:

```tsx
/** DOM-level test for the top-of-board freshness banner and the tab-title
    mark: a real happy-dom document and a real Board render, fetch faked. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_TITLE = 'MRs ready for review';

// No syncError key on purpose: the older-server shape must still render.
const BOARD_DATA = {
  title: BASE_TITLE,
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
  ],
  mrs: [],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
  dataSyncedAt: 1755600000000,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let servedData: Record<string, unknown> = BOARD_DATA;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      return new Response(JSON.stringify(servedData), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  servedData = BOARD_DATA;
  localStorage.clear();
  history.replaceState(null, '', '/');
  document.title = BASE_TITLE;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function renderBoard(container: HTMLElement) {
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return root;
}

const banner = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.tui-banner[role="status"]');

test('stale data with a GitLab timeout: a red banner naming the cause, and a marked tab', async () => {
  const now = Date.now();
  servedData = {
    ...BOARD_DATA,
    dataSyncedAt: now - 103 * 60_000,
    syncError: {
      since: now - 100 * 60_000,
      lastAt: now - 60_000,
      kind: 'timeout',
      message: 'GraphQL errors: Timeout on MergeRequest.id',
      projects: 1,
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    const el = banner(container);
    expect(el?.textContent).toStartWith('⚠ GitLab timing out since ');
    expect(el?.textContent).toContain('board data is 1h 43m old');
    expect(el?.dataset.intent).toBe('bad');
    expect(el?.title).toBe('GraphQL errors: Timeout on MergeRequest.id');
    expect(document.title).toBe(`⚠ ${BASE_TITLE}`);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
  expect(document.title).toBe(BASE_TITLE);
});

test('stale data without a cause: an amber banner (no data-intent)', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: Date.now() - 15 * 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    const el = banner(container);
    expect(el?.textContent).toStartWith('⚠ board data is 15m old');
    expect(el?.dataset.intent).toBeUndefined();
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('fresh data: no banner and an unmarked tab', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: Date.now() - 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    expect(banner(container)).toBeNull();
    expect(document.title).toBe(BASE_TITLE);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});

test('re-rendering while stale does not stack the tab mark', async () => {
  servedData = { ...BOARD_DATA, dataSyncedAt: Date.now() - 45 * 60_000 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    expect(document.title).toBe(`⚠ ${BASE_TITLE}`);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/board && bun test src/client/board/__tests__/freshness-banner-dom.test.tsx`
Expected: FAIL. No `.tui-banner[role="status"]` exists, and the title is unmarked.

- [ ] **Step 3: Add the title hook**

Create `apps/board/src/client/board/stale-tab-title.ts`:

```ts
import { useEffect } from 'react';

const STALE_MARK = '⚠ ';

/** Marks the browser tab's title while the board's data is stale, so a
    background tab says so without being opened. Keyed on the boolean, so
    polls that keep it stale never stack a second mark. */
export function useStaleTabTitle(stale: boolean): void {
  useEffect(() => {
    if (!stale) return;
    const base = document.title;
    document.title = STALE_MARK + base;
    return () => {
      document.title = base;
    };
  }, [stale]);
}
```

- [ ] **Step 4: Render the banner in `Board.tsx`**

Add `freshnessBanner,` to the `../../view.ts` import list (after `filterByTab,`), and add an import next to the other `./` imports:

```ts
import { useStaleTabTitle } from './stale-tab-title.ts';
```

Directly above the loading guard (`if (!data) {`), add:

```ts
  const freshness = data
    ? freshnessBanner({
        fetchError: data.fetchError,
        dataSyncedAt: data.dataSyncedAt,
        syncError: data.syncError,
        now: Date.now(),
      })
    : null;
  useStaleTabTitle(freshness !== null);
```

Delete the line `const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);`.

Replace the fetchError banner:

```tsx
        {data.fetchError && (
          <div className="tui-banner">
            ⚠ data from {staleMins}m ago — gitlab fetch failing
          </div>
        )}
```

with:

```tsx
        {freshness && (
          <div
            className="tui-banner"
            data-intent={freshness.intent === 'bad' ? 'bad' : undefined}
            role="status"
            title={freshness.title}
          >
            {freshness.text}
          </div>
        )}
```

- [ ] **Step 5: Move the fixture's sync time**

In `apps/board/tests/fixture/data.json`, change `"dataSyncedAt": 1755600000000,` to `"dataSyncedAt": 1755603480000,` (2 minutes before `meta.json`'s `now` of `1755603600000`) and add `"syncError": null,` on the next line.

- [ ] **Step 6: Run the tests and gates**

Run: `bun run board:typecheck && bun run board:test`
Expected: clean; all tests pass, including the four new DOM tests and every existing DOM test (those render a stale banner now, since their `dataSyncedAt` is in 2025; none query it).

Run: `bun run board:build && bun run format:check && bash scripts/repo-purity.sh && bun run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/client/board/stale-tab-title.ts apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/freshness-banner-dom.test.tsx apps/board/tests/fixture/data.json
git commit -m "board: top freshness banner names rt's sync failure; stale tab gets a mark

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task B4: Look at it in both schemes, then ship

**Files:** none committed (scratch fixtures live in the session scratchpad).

- [ ] **Step 1: Build three scratch fixtures**

Copy `apps/board/tests/fixture/` to three scratch dirs (`fx-red`, `fx-amber`, `fx-fresh`) under the session scratchpad. The browser runs on the real clock, so stamp times from `Date.now()` when writing them. In each copy's `data.json`:
- `fx-red`: `dataSyncedAt = now - 103 min`; `syncError = { since: now - 100 min, lastAt: now - 1 min, kind: "timeout", message: "GraphQL errors: Timeout on MergeRequest.id", projects: 1 }`
- `fx-amber`: `dataSyncedAt = now - 15 min`; `syncError = null`
- `fx-fresh`: `dataSyncedAt = now - 1 min`; `syncError = null`

- [ ] **Step 2: Boot them on free ports**

From `apps/board` in this worktree: `BOARD_FIXTURE=<fx-red> PORT=7957 bun run src/server.ts`, and likewise `fx-amber` on 7958 and `fx-fresh` on 7959 (check each port is free first; 7942 belongs to deck). Use raw `http://localhost:<port>` URLs, never `.mattstack` ones.

- [ ] **Step 3: Screenshot through Fast Browser**

Dispatch a `fast-browser:browser-driver` agent: for each port, load the page and screenshot the top of the board in light and dark. The board keeps its theme in localStorage `mrs-theme`: set it to each scheme, reload, and restore the original value at the end. Also read `document.title` on each page.

Expected, and say plainly anything that differs:
- 7957: a red banner above the panels reading `⚠ GitLab timing out since HH:MM... board data is 1h 43m old (as of HH:MM)`, with a tooltip holding the message; title starts with `⚠ `.
- 7958: an amber banner `⚠ board data is 15m old (as of HH:MM)... rt sync is behind`.
- 7959: no banner, unmarked title.
- In both schemes the text is legible on its tint, and the banner's width and spacing match the other top banners.

- [ ] **Step 4: Stop the fixture servers**

Kill the three `bun run src/server.ts` processes started in Step 2 (by PID, not by name).

- [ ] **Step 5: Open the PR**

Push `board-sync-health-banner` and open a PR on `m4ttstack/apps`: `board: loud freshness banner that names rt's GitLab sync failure`. Include the light and dark screenshots, and note that `capture:compare` was not re-baselined (red on `main` already). Wait for CodeRabbit and address every actionable finding; wait for CI green; merge with Matt's confirmation.

- [ ] **Step 6: Deploy to the live board**

After merge, on the main checkout (`/Users/matt/Documents/GitHub/mattstack-apps`, confirm it is on `main` and clean): `git pull`, `bun install`, `bun run tui-kit:build`, `bun run board:build`, then `deck restart board` (a rebuild alone refreshes the UI but not the API). Load the live board and confirm the footer and banner agree with the daemon's current state.
