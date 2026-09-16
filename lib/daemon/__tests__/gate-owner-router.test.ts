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
import { insertAgent, newAgentId } from "../../state/agents-store.ts";
import { livenessFrom } from "../../runs/liveness.ts";
import { Database } from "bun:sqlite";

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
  const stateDb = openStateDb(":memory:");
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
    gatePush: { onAnswered: async () => {}, onOpened: async () => {}, onClosed: async () => {}, retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0, reNudged: 0 }) } satisfies GatePush,
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
    // Hermetic liveness: the real one shells out to `herdr agent list`, which
    // would make every subject-resolution case read this machine's live panes.
    runLiveness: async () => livenessFrom([]),
    stateDb,
  });
  return { handlers, gatesStore, herdStore, stateDb };
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

// gate:ask's resolveSubject wiring (command-router.ts:156-162): every
// gates-handlers.test.ts case injects a fake resolveSubject, so the real
// findRunsBySession/findRun/getAgent mapping is otherwise untested.
describe("gate:ask subject resolution through the real command-router wiring", () => {
  const Q = [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];

  test("a running run recorded under the session resolves to subject run:<id>, with origin.runId and origin.worktree", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s1" },
    });
    if (!started.ok) throw new Error(started.error);
    const runDb = new Database(started.runDb);
    runDb.run(
      "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) VALUES (?, 'worktree', ?, 'run', ?)",
      [started.runId, "/wt/r1", Date.now()],
    );
    runDb.close();

    const { handlers, gatesStore } = buildHandlers();
    const res = await handlers["gate:ask"]!({ sessionId: "s1", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`run:${started.runId}`);
    const row = gatesStore.get((res as any).data.id);
    expect(row?.origin?.runId).toBe(started.runId);
    expect(row?.origin?.worktree).toBe("/wt/r1");
  });

  test("a running run with no recorded worktree field resolves the subject with no origin.worktree", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s2" },
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers, gatesStore } = buildHandlers();
    const res = await handlers["gate:ask"]!({ sessionId: "s2", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`run:${started.runId}`);
    const row = gatesStore.get((res as any).data.id);
    expect(row?.origin?.runId).toBe(started.runId);
    expect(row?.origin?.worktree).toBeUndefined();
  });

  test("a session with no run but a recorded agent resolves to subject agent:<id>", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;

    const { handlers, gatesStore, stateDb } = buildHandlers();
    const agentId = newAgentId();
    insertAgent({
      id: agentId, repo: "widget-forge", cwd: "/wt/agent", provider: "claude",
      surface: "headless", sessionId: "s3", createdAt: Date.now(),
    }, stateDb);

    const res = await handlers["gate:ask"]!({ sessionId: "s3", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`agent:${agentId}`);
    const row = gatesStore.get((res as any).data.id);
    expect(row?.origin?.runId).toBeUndefined();
  });

  test("a sessionId that collides with an unrelated agent's own id is not resolved to that agent", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;

    const { handlers, stateDb } = buildHandlers();
    const otherAgentId = newAgentId();
    insertAgent({
      id: otherAgentId, repo: "widget-forge", cwd: "/wt/other", provider: "claude",
      surface: "headless", sessionId: "s-real-owner", createdAt: Date.now(),
    }, stateDb);

    // getAgent's `WHERE id = ? OR session_id = ?` would match this row on
    // `id = otherAgentId` alone; agentBySession must refuse it since its
    // sessionId is "s-real-owner", not the id string itself, so resolution
    // falls through to a refusal rather than silently naming the wrong agent.
    const res = await handlers["gate:ask"]!({ sessionId: otherAgentId, questions: Q });
    expect((res as any).ok).toBe(false);
  });
});

// RT-157: a run left in status "running" by a dead pipeline stays running
// forever, and the subject ladder trusted status alone.
describe("gate:ask subject resolution skips runs the liveness ladder calls stale", () => {
  const Q = [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];

  function backdate(runDb: string, at: number): void {
    const db = new Database(runDb);
    db.run("UPDATE runs SET started_at = ?", [at]);
    db.run("UPDATE stages SET started_at = ?, ended_at = CASE WHEN ended_at IS NULL THEN NULL ELSE ? END", [at, at]);
    db.run("UPDATE fields SET at = ?", [at]);
    db.close();
  }

  test("a stale running run no longer captures the session; the agent record wins", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s-stale" },
    });
    if (!started.ok) throw new Error(started.error);
    backdate(started.runDb, Date.now() - 2 * 60 * 60 * 1000);

    const { handlers, stateDb } = buildHandlers();
    const agentId = newAgentId();
    insertAgent({
      id: agentId, repo: "widget-forge", cwd: "/wt/agent", provider: "claude",
      surface: "headless", sessionId: "s-stale", createdAt: Date.now(),
    }, stateDb);

    const res = await handlers["gate:ask"]!({ sessionId: "s-stale", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`agent:${agentId}`);
  });

  test("a fresh running run still wins: staleness is the only thing that changed", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const started = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s-fresh" },
    });
    if (!started.ok) throw new Error(started.error);

    const { handlers, stateDb } = buildHandlers();
    const agentId = newAgentId();
    insertAgent({
      id: agentId, repo: "widget-forge", cwd: "/wt/agent", provider: "claude",
      surface: "headless", sessionId: "s-fresh", createdAt: Date.now(),
    }, stateDb);

    const res = await handlers["gate:ask"]!({ sessionId: "s-fresh", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`run:${started.runId}`);
  });

  test("a stale run and a live run under one session resolve to the live one instead of refusing", async () => {
    runsRoot = mkdtempSync(join(tmpdir(), "rt-gate-owner-router-"));
    process.env.RT_RUNS_ROOT = runsRoot;
    const dead = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s-both" },
    });
    if (!dead.ok) throw new Error(dead.error);
    backdate(dead.runDb, Date.now() - 2 * 60 * 60 * 1000);
    const live = runStart(runsRoot, {
      repo: "widget-forge", workType: "feature", pipeline: "default",
      env: { CLAUDE_CODE_SESSION_ID: "s-both" },
    });
    if (!live.ok) throw new Error(live.error);

    const { handlers } = buildHandlers();
    const res = await handlers["gate:ask"]!({ sessionId: "s-both", questions: Q });
    if (!(res as any).ok) throw new Error((res as any).error);
    expect((res as any).data.subject).toBe(`run:${live.runId}`);
  });
});
