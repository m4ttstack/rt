import { describe, test, expect } from "bun:test";
import type { HerdJobRow, HerdRow } from "../herd-store.ts";
import { evaluateJob, evaluateShepherd, type WatchdogConfig, type WatchdogSensors } from "../herd-watchdog.ts";

const NOW = 10_000_000;
const MIN = 60_000;

const cfg: WatchdogConfig = {
  enabled: true, fastMins: 2, shepherdFastMins: 5, backstopMins: 15,
  retryMins: 5, notifyQuietMins: 30, nagMins: 30, notifyHuman: true,
};

function sensors(over: Partial<WatchdogSensors> = {}): WatchdogSensors {
  return {
    now: () => NOW,
    herds: () => [],
    jobs: () => [],
    paneState: () => "idle",
    idleSinceMs: () => null,
    unreadDmMentionsFor: () => 0,
    openHumanGates: () => [],
    unconsumedAnswered: () => [],
    ...over,
  };
}

function job(over: Partial<HerdJobRow> = {}): HerdJobRow {
  return {
    herd: "demo-1", name: "job-a", worktree: "/w", branch: null, tree: null,
    pane: "w1:p1", agentSession: "sess-a", agentId: null, handle: "job-a",
    status: "active", disposable: false, lastGate: null, lastReport: null,
    createdAt: NOW - 60 * MIN, updatedAt: NOW - 60 * MIN,
    ...over,
  };
}

function herd(over: Partial<HerdRow> = {}): HerdRow {
  return {
    id: "demo-1", repo: "r", room: "herd-demo-1", workspace: "herd: demo-1",
    shepherdSession: "sess-s", shepherdHandle: "shepherd", shepherdPane: "w1:p0",
    herdrSocket: null, hidden: false, status: "active", createdAt: NOW - 60 * MIN, wrappedAt: null,
    ...over,
  };
}

const idleFor = (mins: number) => ({ paneState: () => "idle" as const, idleSinceMs: () => NOW - mins * MIN });

describe("evaluateJob", () => {
  test("(a) idle 3m with 1 unread DM is wedged on the fast path", () => {
    const s = sensors({ ...idleFor(3), unreadDmMentionsFor: (h) => (h === "job-a" ? 1 : 0) });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "idle 3m with 1 unread DM/mention" });
  });

  test("(b) idle 3m with an unconsumed answered gate nudging its session is wedged on the fast path", () => {
    const s = sensors({ ...idleFor(3), unconsumedAnswered: (sess) => (sess === "sess-a" ? [{ id: "g-1", ageMs: 4 * MIN }] : []) });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "gate g-1 answered 4m ago and unconsumed" });
  });

  test("(c) idle 20m, active, nothing pending is wedged on the backstop", () => {
    const s = sensors(idleFor(20));
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "wedged", path: "backstop", evidence: "idle 20m with no open gate" });
  });

  test("(d) idle 20m at a gate is healthy: waiting on an answer is legitimate", () => {
    const s = sensors(idleFor(20));
    expect(evaluateJob(job({ status: "at-gate" }), s, cfg)).toEqual({ kind: "healthy" });
    expect(evaluateJob(job({ status: "at-milestone" }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("the gate exemption is backstop-only: an at-gate job whose answer never landed still trips the fast path", () => {
    const s = sensors({ ...idleFor(3), unconsumedAnswered: () => [{ id: "g-2", ageMs: 2 * MIN }] });
    expect(evaluateJob(job({ status: "at-gate" }), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "gate g-2 answered 2m ago and unconsumed" });
    const dm = sensors({ ...idleFor(3), unreadDmMentionsFor: () => 2 });
    expect(evaluateJob(job({ status: "at-gate" }), dm, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "idle 3m with 2 unread DM/mentions" });
  });

  test("(e) idle 5m with nothing pending is healthy", () => {
    expect(evaluateJob(job(), sensors(idleFor(5)), cfg)).toEqual({ kind: "healthy" });
  });

  test("idle below fastMins is healthy even with a pending consumable", () => {
    const s = sensors({ ...idleFor(1), unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("an idle pane with no recorded status change is healthy: missing data never pokes", () => {
    const s = sensors({ paneState: () => "idle", idleSinceMs: () => null, unreadDmMentionsFor: () => 3 });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("a working pane is healthy regardless of pending consumables", () => {
    const s = sensors({ paneState: () => "working", idleSinceMs: () => NOW - 40 * MIN, unreadDmMentionsFor: () => 3, unconsumedAnswered: () => [{ id: "g-1", ageMs: 9 * MIN }] });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("(f) done with a report older than nagMins and the pane still open is finished-lingering", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: NOW - 35 * MIN }), s, cfg)).toEqual({ kind: "finished-lingering", evidence: "job-a done with report 35m ago, pane still open" });
  });

  test("done with a report younger than nagMins is healthy", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: NOW - 10 * MIN }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("done without a report is healthy: nothing to date the nag from", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: null }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("done with the pane gone or absent is healthy: already closed, the nag never fires", () => {
    const gone = sensors({ paneState: () => "gone" });
    expect(evaluateJob(job({ status: "done", lastReport: NOW - 35 * MIN }), gone, cfg)).toEqual({ kind: "healthy" });
    const s = sensors({ paneState: () => { throw new Error("must not be called"); } });
    expect(evaluateJob(job({ status: "done", lastReport: NOW - 35 * MIN, pane: null }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("(g) a dead pane is dead, before any idle arithmetic", () => {
    const s = sensors({ paneState: () => "dead", idleSinceMs: () => NOW - 40 * MIN, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "dead" });
    expect(evaluateJob(job({ status: "at-milestone" }), s, cfg)).toEqual({ kind: "dead" });
  });

  test("a spawning job is exempt from the dead and modal verdicts: the spawn path owns that window", () => {
    const dead = sensors({ paneState: () => "dead", idleSinceMs: () => NOW - 40 * MIN, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job({ status: "spawning" }), dead, cfg)).toEqual({ kind: "healthy" });
    const modal = sensors({ paneState: () => "modal", idleSinceMs: () => NOW - 40 * MIN, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job({ status: "spawning" }), modal, cfg)).toEqual({ kind: "healthy" });
  });

  test("a spawning job still takes the idle wedge tests", () => {
    const fast = sensors({ ...idleFor(3), unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job({ status: "spawning" }), fast, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "idle 3m with 1 unread DM/mention" });
    expect(evaluateJob(job({ status: "spawning" }), sensors(idleFor(20)), cfg)).toEqual({ kind: "wedged", path: "backstop", evidence: "idle 20m with no open gate" });
  });

  test("(h) a modal pane is modal, before any idle arithmetic", () => {
    const s = sensors({ paneState: () => "modal", idleSinceMs: () => NOW - 40 * MIN, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "modal" });
    expect(evaluateJob(job({ status: "at-gate" }), s, cfg)).toEqual({ kind: "modal" });
  });

  test("closed, crashed and stuck-at-modal are healthy from the watchdog's view", () => {
    const s = sensors({ ...idleFor(40), unreadDmMentionsFor: () => 3 });
    for (const status of ["closed", "crashed", "stuck-at-modal"] as const) {
      expect(evaluateJob(job({ status }), s, cfg)).toEqual({ kind: "healthy" });
    }
  });

  test("a live job with no pane is healthy and never asks for pane state", () => {
    const s = sensors({ paneState: () => { throw new Error("must not be called"); }, unreadDmMentionsFor: () => 3 });
    expect(evaluateJob(job({ pane: null }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("a live job with no session skips the gate test but still trips on unread", () => {
    const s = sensors({ ...idleFor(3), unreadDmMentionsFor: () => 1, unconsumedAnswered: () => { throw new Error("must not be called"); } });
    expect(evaluateJob(job({ agentSession: null }), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "idle 3m with 1 unread DM/mention" });
  });

  test("the oldest unconsumed answered gate is the evidence", () => {
    const s = sensors({ ...idleFor(3), unconsumedAnswered: () => [{ id: "g-new", ageMs: 1 * MIN }, { id: "g-old", ageMs: 7 * MIN }] });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "gate g-old answered 7m ago and unconsumed" });
  });
});

describe("evaluateShepherd", () => {
  const shepherdIdle = { paneState: (p: string) => (p === "w1:p0" ? "idle" : "working") as "idle" | "working" };

  test("(a) an open human gate older than shepherdFastMins while the shepherd is idle is wedged on the fast path", () => {
    const s = sensors({ ...shepherdIdle, openHumanGates: (prefix) => (prefix === "herd:demo-1/" ? [{ id: "g-9", ageMs: 6 * MIN }] : []) });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
  });

  test("an open human gate younger than shepherdFastMins is healthy", () => {
    const s = sensors({ ...shepherdIdle, openHumanGates: () => [{ id: "g-9", ageMs: 3 * MIN }] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("(b) unread DMs/mentions for the shepherd handle while idle are wedged on the fast path", () => {
    const s = sensors({ ...shepherdIdle, unreadDmMentionsFor: (h) => (h === "shepherd" ? 2 : 0) });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "2 unread DM/mentions waiting" });
  });

  test("(c) a job finished-lingering past nagMins is wedged on the fast path with that evidence", () => {
    const s = sensors({ ...shepherdIdle, jobs: (h) => (h === "demo-1" ? [job({ status: "done", lastReport: NOW - 35 * MIN })] : []) });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "job-a done with report 35m ago, pane still open" });
  });

  test("(d) a working shepherd pane is healthy regardless of evidence", () => {
    const s = sensors({
      paneState: () => "working",
      openHumanGates: () => [{ id: "g-9", ageMs: 60 * MIN }],
      unreadDmMentionsFor: () => 5,
      jobs: () => [job({ status: "done", lastReport: NOW - 90 * MIN })],
    });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("(e) BACKSTOP: a job done with a report older than backstopMins and the shepherd not working is wedged on the backstop", () => {
    const s = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: NOW - 16 * MIN })] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "backstop", evidence: "job-a done with report 16m ago, not yet closed" });
  });

  test("a done job with a report younger than backstopMins is healthy", () => {
    const s = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: NOW - 10 * MIN })] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("a done job with no report never trips the shepherd backstop", () => {
    const s = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: null })] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("with no shepherd pane the working exemption is skipped and evidence alone decides; pane state is never asked", () => {
    const evidence = sensors({ paneState: () => { throw new Error("must not be called"); }, openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] });
    expect(evaluateShepherd(herd({ shepherdPane: null }), evidence, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
    const quiet = sensors({ paneState: () => { throw new Error("must not be called"); } });
    expect(evaluateShepherd(herd({ shepherdPane: null }), quiet, cfg)).toEqual({ kind: "healthy" });
  });

  test("a dead, modal or gone shepherd pane counts as not working for the evidence tests", () => {
    for (const state of ["dead", "modal", "gone"] as const) {
      const s = sensors({ paneState: () => state, openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] });
      expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
    }
  });

  test("evidence order: an aged gate outranks unread, unread outranks a lingering job, fast outranks backstop", () => {
    const all = sensors({
      ...shepherdIdle,
      openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }],
      unreadDmMentionsFor: () => 1,
      jobs: () => [job({ status: "done", lastReport: NOW - 35 * MIN })],
    });
    expect(evaluateShepherd(herd(), all, cfg)).toMatchObject({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
    const noGate = sensors({ ...shepherdIdle, unreadDmMentionsFor: () => 1, jobs: () => [job({ status: "done", lastReport: NOW - 35 * MIN })] });
    expect(evaluateShepherd(herd(), noGate, cfg)).toMatchObject({ evidence: "1 unread DM/mention waiting" });
    const lingering = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: NOW - 35 * MIN })] });
    expect(evaluateShepherd(herd(), lingering, cfg)).toMatchObject({ path: "fast", evidence: "job-a done with report 35m ago, pane still open" });
  });

  test("the shepherd never reads idleSinceMs", () => {
    const s = sensors({ ...shepherdIdle, idleSinceMs: () => { throw new Error("must not be called"); }, openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] });
    expect(evaluateShepherd(herd(), s, cfg)).toMatchObject({ kind: "wedged" });
  });

  test("a wrapped herd is healthy: there is no shepherd left to poke", () => {
    const s = sensors({ ...shepherdIdle, openHumanGates: () => [{ id: "g-9", ageMs: 60 * MIN }], unreadDmMentionsFor: () => 5 });
    expect(evaluateShepherd(herd({ status: "wrapped" }), s, cfg)).toEqual({ kind: "healthy" });
  });
});
