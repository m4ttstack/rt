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

// `herdStore` is injectable so owner-enforcement tests can seed a real herd
// row (create/setShepherd) and have command-router.ts's actual
// `herdShepherd` wiring resolve against it, not a throwaway empty store.
function buildHandlers(herdStore: ReturnType<typeof createHerdStore> = createHerdStore({ dbPath: ":memory:", log: pino({ level: "silent" }) })) {
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
      findRunningRunByWorktree: () => ({ kind: "none" }),
    },
    eventsBus: createEventsBus({ dbPath: ":memory:", log: pino({ level: "silent" }) }),
    gatesStore,
    gatePush: { onAnswered: async () => {}, onOpened: async () => {}, onClosed: async () => {}, retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0 }) } satisfies GatePush,
    herdStore,
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
  return { handlers, gatesStore, herdStore };
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

describe("gate:answer owner enforcement through the real command-router + herd store wiring (RT-117)", () => {
  test("the owning shepherd's live session answers a herd-owned gate through the real herd store, no override needed", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const herdStore = createHerdStore({ dbPath: ":memory:", log: pino({ level: "silent" }) });
    herdStore.create({
      id: "hd-match", repo: "widget-forge", room: "room-match", workspace: "ws-match",
      shepherdSession: "shep-session-match", shepherdHandle: "shep-match", herdrSocket: null, hidden: false,
    });
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      spawnedBy: "herd:hd-match", env: {},
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers } = buildHandlers(herdStore);
    const opened = await handlers["gate:open"]!({
      subject: "run:r-match", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
      origin: { runId: started.runId, presentation: "wait" },
    });
    if (!(opened as any).ok) throw new Error("open failed");
    const gateId = (opened as any).data.id;

    const res = await handlers["gate:answer"]!({ id: gateId, by: "shep", session: "shep-session-match", answers: { q: "a" } });
    expect((res as any).ok).toBe(true);
    expect((res as any).data.row.answer.overridden).toBeUndefined();
  });

  test("a herd's shepherd flip is resolved at answer time: the new session may answer, the old one is refused", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const herdStore = createHerdStore({ dbPath: ":memory:", log: pino({ level: "silent" }) });
    herdStore.create({
      id: "hd-flip", repo: "widget-forge", room: "room-flip", workspace: "ws-flip",
      shepherdSession: "shep-session-old", shepherdHandle: "shep-old", herdrSocket: null, hidden: false,
    });
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      spawnedBy: "herd:hd-flip", env: {},
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers } = buildHandlers(herdStore);
    const opened = await handlers["gate:open"]!({
      subject: "run:r-flip", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
      origin: { runId: started.runId, presentation: "wait" },
    });
    if (!(opened as any).ok) throw new Error("open failed");
    const gateId = (opened as any).data.id;

    // The shepherd handed off mid-run: the owner guard reads the herd store
    // fresh on every answer, not a session captured at gate-open time.
    herdStore.setShepherd("hd-flip", { session: "shep-session-new", handle: "shep-new" });

    const refusedOld = await handlers["gate:answer"]!({ id: gateId, by: "shep", session: "shep-session-old", answers: { q: "a" } });
    expect(refusedOld).toEqual({ ok: false, error: "owned-by", owner: "herd:hd-flip" });

    const okNew = await handlers["gate:answer"]!({ id: gateId, by: "shep", session: "shep-session-new", answers: { q: "a" } });
    expect((okNew as any).ok).toBe(true);
    expect((okNew as any).data.row.answer.overridden).toBeUndefined();
  });
});
