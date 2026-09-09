/**
 * Integration check for RT-117 owner derivation: the unit tests in
 * gates-handlers.test.ts inject a fake `runSpawnedBy`, which never exercises
 * command-router.ts's actual wiring (`findRun(runId)?.run.spawned_by`). This
 * drives the router-assembled handler map -- built the same way
 * rt-client-commands.test.ts does, via `buildRoutedHandlers` -- against a run
 * seeded through the real runs-store write path, so a regression back to the
 * fields-lookup pattern (which would return null forever) fails here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import { buildRoutedHandlers } from "../command-router.ts";
import { createEventsBus } from "../events-bus.ts";
import { createGatesStore } from "../gates-store.ts";
import { createHerdStore } from "../herd-store.ts";
import type { GatePush } from "../gate-push.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { fakeStore } from "./fake-cache-store.ts";
import { openStateDb } from "../../state/index.ts";
import { runStart } from "../../runs/start.ts";

const stubCtx = {
  cache: fakeStore({}),
  refreshCache: async () => {},
  log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
  startedAt: Date.now(),
  portCacheRef: { ports: [], updatedAt: 0 },
  watchedConfigs: new Map(),
  repoIndex: () => ({}),
  checkAndRepairHooksPath: async () => false,
  startWatchingRepo: () => {},
  refreshStatusRef: { lastRefreshAt: 0 },
} as unknown as HandlerContext;

function buildHandlers() {
  const gatesStore = createGatesStore({ dbPath: ":memory:", log: pino({ level: "silent" }) });
  const handlers = buildRoutedHandlers({
    ctx: stubCtx,
    broadcast: () => {},
    systemProcessScanner: {} as any,
    worktree: {
      emit: () => {},
      kick: () => {},
      creationInFlight: () => null,
      withReconcilerHeld: async (fn) => fn(),
    },
    eventsBus: createEventsBus({ dbPath: ":memory:", log: pino({ level: "silent" }) }),
    gatesStore,
    gatePush: { onAnswered: async () => {}, onOpened: async () => {}, onClosed: async () => {}, retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0 }) } satisfies GatePush,
    herdStore: createHerdStore({ dbPath: ":memory:", log: pino({ level: "silent" }) }),
    herdLifecycle: { connected: () => false, watch: () => {}, sweepClaims: async () => {} },
    herdJobsRoot: "/tmp/rt-herd-router-jobs",
    bgService: {
      socketPath: () => "/tmp/bg.sock",
      up: async () => false,
      ensure: async () => { throw new Error("bg service not wired in this test"); },
      stop: async () => {},
      reprobe: async () => ({ ok: true, drift: [] }),
      lastParity: () => null,
    },
    bgClaims: { claim: () => {}, release: () => false, releaseByPane: () => [], list: () => [], close_: () => {} },
    homeSnapshot: { stop: () => {}, runNow: async () => ({}) as any, pullNow: async () => ({}) as any, status: () => ({}) as any, ready: Promise.resolve() },
    teamSnapshots: { stop() {}, rescan: async () => {}, status: () => [], pullNow: async () => ({ outcome: "skipped", detail: null }), ready: Promise.resolve() },
    repos: { withReconcilerHeld: async (fn) => fn(), refreshWatchedRepos: () => {} },
    stateDb: openStateDb(":memory:"),
  });
  return { handlers, gatesStore };
}

let runsRoot: string | null = null;
afterEach(() => {
  delete process.env.RT_RUNS_ROOT;
  if (runsRoot) { rmSync(runsRoot, { recursive: true, force: true }); runsRoot = null; }
});

describe("gate:open owner derivation through the real command-router wiring (RT-117)", () => {
  test("a run seeded through runStart with a herd spawner produces a herd-owned gate", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      spawnedBy: "herd:h-42", env: {},
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers, gatesStore } = buildHandlers();
    const res = await handlers["gate:open"]!({
      subject: "run:r1", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
      origin: { runId: started.runId, presentation: "wait" },
    });
    expect((res as any).ok).toBe(true);
    const row = gatesStore.get((res as any).data.id);
    expect(row?.owner).toBe("herd:h-42");
  });

  test("a run seeded with a non-herd spawner still derives human", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      spawnedBy: "shepherdr", env: {},
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers, gatesStore } = buildHandlers();
    const res = await handlers["gate:open"]!({
      subject: "run:r2", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
      origin: { runId: started.runId, presentation: "wait" },
    });
    expect((res as any).ok).toBe(true);
    const row = gatesStore.get((res as any).data.id);
    expect(row?.owner).toBe("human");
  });
});
