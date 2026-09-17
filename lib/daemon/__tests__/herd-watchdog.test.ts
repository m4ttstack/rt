import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import type { HerdJobRow, HerdRow } from "../herd-store.ts";
import { evaluateJob, evaluateShepherd, HerdWatchdog, type WatchdogActuators, type WatchdogConfig, type WatchdogSensors } from "../herd-watchdog.ts";

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
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN }), s, cfg)).toEqual({ kind: "finished-lingering", evidence: "job-a done with report 35m ago, pane still open; run rt herd close job-a --herd demo-1" });
  });

  // lastReport is the report's chat message id (herd:report stores
  // posted.data.id), never a clock: aging from it printed the epoch in
  // minutes ("29826886m ago", RT-193). The report's own age is updatedAt,
  // stamped when setJobStatus moved the job to done.
  test("(f2) the nag ages the report from updatedAt, not from the message id in lastReport (RT-193)", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 47 * MIN }), s, cfg)).toEqual({ kind: "finished-lingering", evidence: "job-a done with report 47m ago, pane still open; run rt herd close job-a --herd demo-1" });
  });

  test("done with a report younger than nagMins is healthy", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 10 * MIN }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("done without a report is healthy: nothing to date the nag from", () => {
    const s = sensors({ paneState: () => "idle" });
    expect(evaluateJob(job({ status: "done", lastReport: null }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("done with the pane gone or absent is healthy: already closed, the nag never fires", () => {
    const gone = sensors({ paneState: () => "gone" });
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN }), gone, cfg)).toEqual({ kind: "healthy" });
    const s = sensors({ paneState: () => { throw new Error("must not be called"); } });
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN, pane: null }), s, cfg)).toEqual({ kind: "healthy" });
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

  test("a pane blocked for less than fastMins reads healthy: the normal trust-dialog window, not a wedge", () => {
    const justBlocked = sensors({ paneState: () => "modal", idleSinceMs: () => NOW - 10_000, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), justBlocked, cfg)).toEqual({ kind: "healthy" });
    const neverRecorded = sensors({ paneState: () => "modal", idleSinceMs: () => null, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), neverRecorded, cfg)).toEqual({ kind: "healthy" });
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
    const s = sensors({ ...shepherdIdle, jobs: (h) => (h === "demo-1" ? [job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN })] : []) });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "job-a done with report 35m ago, pane still open; run rt herd close job-a --herd demo-1" });
  });

  test("(d) a working shepherd pane is healthy regardless of evidence", () => {
    const s = sensors({
      paneState: () => "working",
      openHumanGates: () => [{ id: "g-9", ageMs: 60 * MIN }],
      unreadDmMentionsFor: () => 5,
      jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 90 * MIN })],
    });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("(e) BACKSTOP: a job done with a report older than backstopMins and the shepherd not working is wedged on the backstop", () => {
    const s = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 16 * MIN })] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "backstop", evidence: "job-a done with report 16m ago, not yet closed; run rt herd close job-a --herd demo-1" });
  });

  test("a done job with a report younger than backstopMins is healthy", () => {
    const s = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 10 * MIN })] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("a done job whose pane is gone or absent never trips the shepherd backstop: nothing is left to close", () => {
    const gone = sensors({ paneState: (p) => (p === "w1:p0" ? "idle" : "gone"), jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 40 * MIN })] });
    expect(evaluateShepherd(herd(), gone, cfg)).toEqual({ kind: "healthy" });
    const absent = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 40 * MIN, pane: null })] });
    expect(evaluateShepherd(herd(), absent, cfg)).toEqual({ kind: "healthy" });
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
      jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN })],
    });
    expect(evaluateShepherd(herd(), all, cfg)).toMatchObject({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
    const noGate = sensors({ ...shepherdIdle, unreadDmMentionsFor: () => 1, jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN })] });
    expect(evaluateShepherd(herd(), noGate, cfg)).toMatchObject({ evidence: "1 unread DM/mention waiting" });
    const lingering = sensors({ ...shepherdIdle, jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN })] });
    expect(evaluateShepherd(herd(), lingering, cfg)).toMatchObject({ path: "fast", evidence: "job-a done with report 35m ago, pane still open; run rt herd close job-a --herd demo-1" });
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

describe("HerdWatchdog ladder", () => {
  type Level = "info" | "warn" | "debug" | "error";

  function rig(opts: { sensors?: Partial<WatchdogSensors>; cfg?: Partial<WatchdogConfig>; herd?: HerdRow; jobs?: HerdJobRow[] } = {}) {
    const clock = { now: NOW };
    const pokes: { pane: string; text: string }[] = [];
    const parks: { herd: string; job: string }[] = [];
    const modalNotes: { herd: string; job: string; pane: string }[] = [];
    const trustCalls: { herd: string; job: string; pane: string }[] = [];
    const trust = { accepts: false };
    const notes: string[] = [];
    const noteEvents: { summary: string; pane: string | null }[] = [];
    const delivery = { ok: true };
    const lines: { level: Level; msg: string }[] = [];
    const at = (level: Level) => (_ctx: unknown, msg: string) => { lines.push({ level, msg }); };
    const log = { info: at("info"), warn: at("warn"), debug: at("debug"), error: at("error") } as unknown as Logger;
    // Parks the NEXT poke (once) so a test can assert what a second sweep
    // does while the first one is still inside an actuator.
    const hold: { p: Promise<void> | null } = { p: null };
    const act: WatchdogActuators = {
      poke: async (pane, text) => { pokes.push({ pane, text }); const parked = hold.p; hold.p = null; if (parked) await parked; return delivery.ok; },
      parkStuckAtModal: (h, j) => { parks.push({ herd: h, job: j }); },
      notifyStuckAtModal: (h, j, pane) => { modalNotes.push({ herd: h, job: j, pane }); },
      acceptTrustModal: async (h, j, pane) => { trustCalls.push({ herd: h, job: j, pane }); return trust.accepts; },
      notifyHuman: (summary, pane) => { notes.push(summary); noteEvents.push({ summary, pane: pane ?? null }); },
    };
    const h = opts.herd ?? herd();
    const jobs = opts.jobs ?? [job()];
    const s = sensors({ now: () => clock.now, herds: () => [h], jobs: (id) => (id === h.id ? jobs : []), ...opts.sensors });
    const c: WatchdogConfig = { ...cfg, ...opts.cfg };
    const wd = new HerdWatchdog({ sensors: s, act, cfg: () => c, log });
    const tick = async (mins = 0) => { clock.now += mins * MIN; await wd.sweep(); };
    const shepherdPokes = () => pokes.filter((p) => p.pane === "w1:p0");
    const workerPokes = () => pokes.filter((p) => p.pane === "w1:p1");
    return { wd, tick, clock, pokes, parks, modalNotes, trustCalls, trust, notes, noteEvents, lines, delivery, hold, conf: c, shepherdPokes, workerPokes };
  }

  const workerWedged = (): Partial<WatchdogSensors> => ({ ...idleFor(3), unreadDmMentionsFor: (h) => (h === "job-a" ? 1 : 0) });

  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const shepherdWedged = (): Partial<WatchdogSensors> => ({ paneState: () => "idle", openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] });

  test("a verdict that goes healthy before the poke lands is not injected: the evidence is re-read at poke time", async () => {
    // The unread count is read live, not from the pane snapshot, so a worker
    // that consumed its DMs while the sweep was in flight reads healthy on the
    // second look. The first look is the verdict that earned the strike.
    let looks = 0;
    const r = rig({ sensors: { ...idleFor(3), unreadDmMentionsFor: (h) => (h === "job-a" && looks++ === 0 ? 1 : 0) } });
    await r.tick();
    expect(r.pokes).toEqual([]);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
  });

  test("the shepherd's verdict is re-read at poke time too", async () => {
    let looks = 0;
    const r = rig({ sensors: { paneState: () => "idle", openHumanGates: () => (looks++ === 0 ? [{ id: "g-9", ageMs: 6 * MIN }] : []) } });
    await r.tick();
    expect(r.shepherdPokes()).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  test("disabling the watchdog clears the ladders, so re-enabling starts from strike 1", async () => {
    const r = rig({ sensors: workerWedged() });
    await r.tick();
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW });

    r.conf.enabled = false;
    await r.tick(10);
    expect(r.pokes).toHaveLength(1);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();

    r.conf.enabled = true;
    await r.tick(10);
    expect(r.workerPokes()).toHaveLength(2);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW + 20 * MIN });
  });

  test("disabling the watchdog also reopens the human notification quiet period", async () => {
    const r = rig({ sensors: workerWedged(), cfg: { notifyQuietMins: 120 } });
    await r.tick();
    await r.tick(5);
    await r.tick(5);
    await r.tick(5);
    await r.tick(5);
    expect(r.notes).toHaveLength(1);

    r.conf.enabled = false;
    await r.tick(5);
    r.conf.enabled = true;
    // Strike 1 again after the reset, so walk it back up to the cap: inside
    // the old quiet period, a surviving notifiedAt would swallow this one.
    for (let i = 0; i < 5; i++) await r.tick(5);
    expect(r.notes).toHaveLength(2);
  });

  test("a sweep still running when the next tick fires is skipped, not overlapped", async () => {
    const r = rig({ sensors: workerWedged() });
    let release = () => {};
    r.hold.p = new Promise<void>((resolve) => { release = () => resolve(); });

    const first = r.wd.sweep();
    await settle();
    expect(r.pokes).toHaveLength(1);
    // The daemon reads this to skip the refresh that would otherwise swap the
    // pane snapshot under the sweep still judging it.
    expect(r.wd.busy).toBe(true);

    // Past retryMins, so a sweep that ran here would earn a second strike.
    r.clock.now += 10 * MIN;
    await r.wd.sweep();
    expect(r.pokes).toHaveLength(1);

    release();
    await first;
    expect(r.pokes).toHaveLength(1);
    expect(r.wd.busy).toBe(false);

    // The guard lifts with the sweep that set it: the next tick acts again.
    await r.tick(10);
    expect(r.pokes).toHaveLength(2);
  });

  test("(a) a wedged worker gets one poke naming its evidence; a sweep inside retryMins adds nothing", async () => {
    const r = rig({ sensors: workerWedged() });
    await r.tick();
    expect(r.pokes).toEqual([{ pane: "w1:p1", text: "watchdog: idle 3m with 1 unread DM/mention. Consume it or post status." }]);
    await r.tick(1);
    expect(r.pokes).toHaveLength(1);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW });
  });

  test("(b) activity after the poke clears strikes; a later wedge restarts at strike 1", async () => {
    const state = { pane: "idle" as ReturnType<WatchdogSensors["paneState"]> };
    const r = rig({ sensors: { ...workerWedged(), paneState: () => state.pane } });
    await r.tick();
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW });
    state.pane = "working";
    await r.tick(1);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
    state.pane = "idle";
    await r.tick(1);
    expect(r.workerPokes()).toHaveLength(2);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW + 2 * MIN });
  });

  test("(c) still wedged after retryMins = a second poke with fresh evidence", async () => {
    const r = rig({ sensors: workerWedged() });
    await r.tick();
    await r.tick(4);
    expect(r.pokes).toHaveLength(1);
    await r.tick(1);
    expect(r.pokes).toHaveLength(2);
    expect(r.pokes[1]).toEqual({ pane: "w1:p1", text: "watchdog: idle 8m with 1 unread DM/mention. Consume it or post status." });
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 2, lastPokeAt: NOW + 5 * MIN });
  });

  test("(d) third and fourth trips poke the shepherd with a one-line summary; the worker is not poked again; fifth notifies the human", async () => {
    const r = rig({ sensors: workerWedged() });
    await r.tick();
    await r.tick(5);
    await r.tick(5);
    expect(r.workerPokes()).toHaveLength(2);
    expect(r.shepherdPokes()).toEqual([{ pane: "w1:p0", text: "watchdog: demo-1/job-a: idle 13m with 1 unread DM/mention; strike 3, flagged 10m ago. Check on it." }]);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 3, lastPokeAt: NOW + 10 * MIN });
    await r.tick(5);
    expect(r.shepherdPokes()).toHaveLength(2);
    expect(r.shepherdPokes()[1]?.text).toContain("strike 4");
    expect(r.notes).toHaveLength(0);
    await r.tick(5);
    expect(r.workerPokes()).toHaveLength(2);
    expect(r.shepherdPokes()).toHaveLength(2);
    expect(r.notes).toEqual(["watchdog: demo-1/job-a: idle 23m with 1 unread DM/mention; strike 5, flagged 20m ago. Check on it."]);
  });

  test("the worker ladder caps at strike 5: later trips re-notify only past the quiet period, never advance", async () => {
    const r = rig({ sensors: workerWedged() });
    for (let i = 0; i < 5; i++) await r.tick(i === 0 ? 0 : 5);
    expect(r.notes).toHaveLength(1);
    await r.tick(5);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 5, lastPokeAt: NOW + 25 * MIN });
    expect(r.notes).toHaveLength(1);
    await r.tick(25);
    expect(r.notes).toHaveLength(2);
    expect(r.wd.annotations("demo-1", "job-a")?.strikes).toBe(5);
    expect(r.pokes).toHaveLength(4);
  });

  test("(e) a wedged shepherd with no recorded pane is unpokeable: notifyHuman on the first wedged sweep", async () => {
    const r = rig({ herd: herd({ shepherdPane: null }), jobs: [], sensors: { openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] } });
    await r.tick();
    expect(r.pokes).toHaveLength(0);
    expect(r.notes).toEqual(["watchdog: demo-1/@shepherd: human gate g-9 open 6m unanswered; strike 1, flagged 0m ago. Check on it."]);
  });

  test("(f) a shepherd poked twice without effect = notifyHuman", async () => {
    const r = rig({ jobs: [], sensors: shepherdWedged() });
    await r.tick();
    expect(r.pokes).toEqual([{ pane: "w1:p0", text: "watchdog: human gate g-9 open 6m unanswered. Consume it or post status." }]);
    await r.tick(5);
    expect(r.pokes).toHaveLength(2);
    expect(r.notes).toHaveLength(0);
    await r.tick(5);
    expect(r.pokes).toHaveLength(2);
    expect(r.notes).toEqual(["watchdog: demo-1/@shepherd: human gate g-9 open 6m unanswered; strike 3, flagged 10m ago. Check on it."]);
  });

  test("(g) a second notifyHuman inside notifyQuietMins is suppressed (logged at debug), and fires again once the period passes", async () => {
    const r = rig({ jobs: [], sensors: shepherdWedged() });
    await r.tick();
    await r.tick(5);
    await r.tick(5);
    expect(r.notes).toHaveLength(1);
    await r.tick(5);
    expect(r.notes).toHaveLength(1);
    expect(r.lines.filter((l) => l.level === "debug" && /quiet/.test(l.msg))).toHaveLength(1);
    await r.tick(15);
    expect(r.notes).toHaveLength(1);
    await r.tick(10);
    expect(r.notes).toHaveLength(2);
  });

  test("the quiet period is per herd: a second herd's first notification is not suppressed by the first herd's", async () => {
    const a = herd({ id: "a", shepherdPane: null, shepherdHandle: "shep-a" });
    const b = herd({ id: "b", shepherdPane: null, shepherdHandle: "shep-b" });
    const r = rig({ jobs: [], sensors: { herds: () => [a, b], openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] } });
    await r.tick();
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toContain("a/@shepherd");
    expect(r.notes[1]).toContain("b/@shepherd");
  });

  test("(h) a dead worker is never injected: the shepherd summary goes out once, then climbs at retryMins", async () => {
    const r = rig({ sensors: { paneState: (p) => (p === "w1:p1" ? "dead" : "idle"), idleSinceMs: () => NOW - 40 * MIN } });
    await r.tick();
    expect(r.workerPokes()).toHaveLength(0);
    expect(r.shepherdPokes()).toEqual([{ pane: "w1:p0", text: "watchdog: demo-1/job-a: pane open but the agent is gone; strike 3, flagged 0m ago. Check on it." }]);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 3, lastPokeAt: NOW });
    await r.tick(1);
    expect(r.shepherdPokes()).toHaveLength(1);
    await r.tick(4);
    expect(r.shepherdPokes()).toHaveLength(2);
    expect(r.shepherdPokes()[1]?.text).toContain("strike 4");
    await r.tick(5);
    expect(r.workerPokes()).toHaveLength(0);
    expect(r.shepherdPokes()).toHaveLength(2);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain("strike 5");
  });

  test("(h) a modal worker is parked once and the shepherd gets the summary; never an injection into the worker", async () => {
    const r = rig({ sensors: { paneState: (p) => (p === "w1:p1" ? "modal" : "idle"), idleSinceMs: () => NOW - 40 * MIN } });
    await r.tick();
    expect(r.parks).toEqual([{ herd: "demo-1", job: "job-a" }]);
    expect(r.workerPokes()).toHaveLength(0);
    expect(r.shepherdPokes()).toEqual([{ pane: "w1:p0", text: "watchdog: demo-1/job-a: blocked at a modal prompt, parked stuck-at-modal; strike 3, flagged 0m ago. Check on it." }]);
    await r.tick(1);
    await r.tick(5);
    expect(r.parks).toHaveLength(1);
    expect(r.workerPokes()).toHaveLength(0);
    expect(r.shepherdPokes()).toHaveLength(2);
  });

  test("every human notification carries its party's pane, so the tray click lands on it", async () => {
    const r = rig({ sensors: workerWedged() });
    for (let i = 0; i < 5; i++) await r.tick(i === 0 ? 0 : 5);
    expect(r.noteEvents).toEqual([{ summary: r.notes[0]!, pane: "w1:p1" }]);

    // The shepherd rung names the shepherd's own pane.
    const shep = rig({ jobs: [], sensors: shepherdWedged() });
    for (let i = 0; i < 3; i++) await shep.tick(i === 0 ? 0 : 5);
    expect(shep.noteEvents).toEqual([{ summary: shep.notes[0]!, pane: "w1:p0" }]);
  });

  test("a herd with no shepherd pane notifies with no pane rather than a wrong one", async () => {
    const r = rig({ jobs: [], herd: herd({ shepherdPane: null }), sensors: { paneState: () => "idle", openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] } });
    await r.tick();
    expect(r.noteEvents).toEqual([{ summary: r.notes[0]!, pane: null }]);
  });

  // EnterWorktree into a freshly provisioned tree re-prompts for folder trust
  // mid-session, which is a dialog the daemon may answer for itself.
  const modalOn = (over: Partial<WatchdogSensors> = {}): Partial<WatchdogSensors> => ({ paneState: (p) => (p === "w1:p1" ? "modal" : "idle"), idleSinceMs: () => NOW - 40 * MIN, ...over });
  const provisioned = () => job({ tree: "on-deck-1" });

  test("a blocked pane in a provisioned tree is offered the trust accept before anything parks", async () => {
    const r = rig({ jobs: [provisioned()], sensors: modalOn() });
    r.trust.accepts = true;
    await r.tick();
    expect(r.trustCalls).toEqual([{ herd: "demo-1", job: "job-a", pane: "w1:p1" }]);
    expect(r.parks).toEqual([]);
    expect(r.modalNotes).toEqual([]);
    expect(r.shepherdPokes()).toEqual([]);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
  });

  test("a blocked pane the accept cannot clear is parked and notified as before", async () => {
    const r = rig({ jobs: [provisioned()], sensors: modalOn() });
    r.trust.accepts = false;
    await r.tick();
    expect(r.trustCalls).toHaveLength(1);
    expect(r.parks).toEqual([{ herd: "demo-1", job: "job-a" }]);
    expect(r.modalNotes).toHaveLength(1);
  });

  test("a job in a tree the daemon did not provision is parked without an accept attempt", async () => {
    const r = rig({ jobs: [job({ tree: null })], sensors: modalOn() });
    r.trust.accepts = true;
    await r.tick();
    expect(r.trustCalls).toEqual([]);
    expect(r.parks).toEqual([{ herd: "demo-1", job: "job-a" }]);
  });

  test("the accept is offered once: a pane still blocked on the next sweep parks", async () => {
    const r = rig({ jobs: [provisioned()], sensors: modalOn() });
    await r.tick();
    expect(r.parks).toHaveLength(1);
    await r.tick(5);
    expect(r.trustCalls).toHaveLength(1);
    expect(r.parks).toHaveLength(1);
  });

  test("a park also raises one click-to-focus notification naming the pane, outside the quiet period", async () => {
    const r = rig({ sensors: { paneState: (p) => (p === "w1:p1" ? "modal" : "idle"), idleSinceMs: () => NOW - 40 * MIN } });
    await r.tick();
    expect(r.modalNotes).toEqual([{ herd: "demo-1", job: "job-a", pane: "w1:p1" }]);
    // The park fires once, so the notification does too, however long the
    // job stays stuck.
    await r.tick(5);
    await r.tick(5);
    expect(r.modalNotes).toHaveLength(1);
  });

  test("notifyHuman: false silences the park notification", async () => {
    const r = rig({ cfg: { notifyHuman: false }, sensors: { paneState: (p) => (p === "w1:p1" ? "modal" : "idle"), idleSinceMs: () => NOW - 40 * MIN } });
    await r.tick();
    expect(r.parks).toHaveLength(1);
    expect(r.modalNotes).toEqual([]);
  });

  test("a parked job the store has moved to stuck-at-modal drops out of the ladder on the next sweep", async () => {
    const row = job();
    const r = rig({ jobs: [row], sensors: { paneState: (p) => (p === "w1:p1" ? "modal" : "idle"), idleSinceMs: () => NOW - 40 * MIN } });
    await r.tick();
    expect(r.parks).toHaveLength(1);
    row.status = "stuck-at-modal";
    await r.tick(1);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
    expect(r.parks).toHaveLength(1);
  });

  test("(i) enabled: false = sweep reads nothing beyond the config", async () => {
    const boom = () => { throw new Error("must not be called"); };
    const r = rig({ cfg: { enabled: false }, sensors: { now: boom, herds: boom, jobs: boom, paneState: boom } });
    await r.tick();
    expect(r.pokes).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  test("a wrapped herd is skipped: its jobs are never read", async () => {
    const r = rig({ herd: herd({ status: "wrapped" }), sensors: { ...workerWedged(), jobs: () => { throw new Error("must not be called"); } } });
    await r.tick();
    expect(r.pokes).toHaveLength(0);
  });

  test("worker escalation with no shepherd pane skips straight to notifyHuman", async () => {
    const r = rig({ herd: herd({ shepherdPane: null }), sensors: workerWedged() });
    await r.tick();
    await r.tick(5);
    expect(r.notes).toHaveLength(0);
    await r.tick(5);
    expect(r.pokes).toHaveLength(2);
    expect(r.notes).toEqual(["watchdog: demo-1/job-a: idle 13m with 1 unread DM/mention; strike 3, flagged 10m ago. Check on it."]);
  });

  test("notifyHuman: false never calls the actuator; the rung is logged instead", async () => {
    const r = rig({ herd: herd({ shepherdPane: null }), jobs: [], cfg: { notifyHuman: false }, sensors: { openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] } });
    await r.tick();
    expect(r.notes).toHaveLength(0);
    expect(r.lines.some((l) => /disabled/.test(l.msg))).toBe(true);
    expect(r.wd.annotations("demo-1", "@shepherd")).toEqual({ strikes: 1, lastPokeAt: NOW });
  });

  test("a poke the injector did not deliver still counts as the strike and is logged at info, not warn: the adapter already flags real failures", async () => {
    const r = rig({ sensors: workerWedged() });
    r.delivery.ok = false;
    await r.tick();
    expect(r.pokes).toHaveLength(1);
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 1, lastPokeAt: NOW });
    expect(r.lines.filter((l) => l.level === "warn")).toHaveLength(0);
    expect(r.lines.filter((l) => l.level === "info" && /not delivered/.test(l.msg))).toHaveLength(1);
    await r.tick(5);
    expect(r.wd.annotations("demo-1", "job-a")?.strikes).toBe(2);
  });

  test("a finished-lingering worker is never poked itself: the nag reaches the shepherd through its own ladder", async () => {
    const r = rig({ jobs: [job({ status: "done", lastReport: 2758, updatedAt: NOW - 35 * MIN })], sensors: { paneState: () => "idle" } });
    await r.tick();
    expect(r.workerPokes()).toHaveLength(0);
    expect(r.shepherdPokes()).toEqual([{ pane: "w1:p0", text: "watchdog: job-a done with report 35m ago, pane still open; run rt herd close job-a --herd demo-1. Consume it or post status." }]);
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
    expect(r.wd.annotations("demo-1", "@shepherd")).toEqual({ strikes: 1, lastPokeAt: NOW });
  });

  test("annotations: null for an untracked job; a dead job that only triggered the shepherd summary still carries lastPokeAt", async () => {
    const r = rig({ sensors: { paneState: (p) => (p === "w1:p1" ? "dead" : "idle") } });
    expect(r.wd.annotations("demo-1", "job-a")).toBeNull();
    expect(r.wd.annotations("nope", "job-a")).toBeNull();
    await r.tick();
    expect(r.wd.annotations("demo-1", "job-a")).toEqual({ strikes: 3, lastPokeAt: NOW });
    expect(r.wd.annotations("demo-1", "job-b")).toBeNull();
  });

  test("every ladder action logs one domain event", async () => {
    const r = rig({ sensors: workerWedged() });
    await r.tick();
    expect(r.lines.map((l) => l.msg)).toEqual(["poked worker"]);
    await r.tick(5);
    await r.tick(5);
    expect(r.lines.map((l) => l.msg)).toEqual(["poked worker", "poked worker", "escalated to shepherd"]);
  });
});
