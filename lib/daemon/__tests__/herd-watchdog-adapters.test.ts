import { describe, test, expect, afterEach } from "bun:test";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import { openStateDb } from "../../state/db.ts";
import { dmRoomFor } from "../../state/dm-store.ts";
import { joinRoom, postMessage } from "../../state/chat-store.ts";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { HerdRow } from "../herd-store.ts";
import { createWatchdogActuators, createWatchdogSensors, readWatchdogConfig } from "../herd-watchdog-adapters.ts";

const log = pino({ level: "silent" });
const NOW = 10_000_000;
const MIN = 60_000;
const DEFAULT = "/default.sock";
const BG = "/bg.sock";

let n = 0;
const dbs: string[] = [];
afterEach(() => { for (const p of dbs) rmSync(p, { force: true }); dbs.length = 0; });
function freshDb() {
  const path = join(tmpdir(), `watchdog-adapters-${process.pid}-${n++}.db`);
  dbs.push(path);
  return openStateDb(path);
}

function herd(over: Partial<HerdRow> = {}): HerdRow {
  return {
    id: "demo-1", repo: "r", room: "herd-demo-1", workspace: "herd: demo-1",
    shepherdSession: "sess-s", shepherdHandle: "shepherd", shepherdPane: "w1:p0",
    herdrSocket: null, hidden: false, status: "active", createdAt: 0, wrappedAt: null,
    ...over,
  };
}

function gate(over: Partial<GateRow> = {}): GateRow {
  return {
    id: "g-1", subject: "herd:demo-1/job-a", kind: "question", questions: [], meta: null,
    status: "open", answer: null, openedAt: NOW - 10 * MIN, parkedAt: null, closedAt: null,
    closedReason: null, supersededBy: null, agent: null, pane: null, nudge: null,
    delivery: null, released: false, consumedAt: null, owner: "human", escalatedAt: null,
    ...over,
  };
}

type Snap = Record<string, Array<{ pane_id: string; agent?: string; agent_status?: string }>>;

function fx(over: { snapshots?: Snap; herds?: HerdRow[]; gates?: GateRow[]; answered?: GateRow[]; db?: ReturnType<typeof freshDb>; clock?: { now: number } } = {}) {
  const snapshots: Snap = over.snapshots ?? {};
  const clock = over.clock ?? { now: NOW };
  const herdrCalls: Array<{ method: string; sock: string | undefined }> = [];
  const herdr = (async (method: string, _params: unknown, opts?: { sockPath?: string }) => {
    herdrCalls.push({ method, sock: opts?.sockPath });
    const panes = snapshots[opts?.sockPath ?? DEFAULT];
    if (!panes) return { ok: false, code: "unreachable", message: "no server" };
    return { ok: true, result: { snapshot: { panes } } };
  }) as any;
  const listCalls: unknown[] = [];
  const answeredCalls: unknown[] = [];
  const lastStatus = new Map<string, number>();
  const sensors = createWatchdogSensors({
    herdStore: { list: (f) => (over.herds ?? [herd()]).filter((h) => !f?.status || h.status === f.status), jobs: () => [] },
    gatesStore: {
      list: (filter) => { listCalls.push(filter); return { gates: over.gates ?? [], cursor: 0 }; },
      unconsumedAnsweredPushes: (now) => { answeredCalls.push(now); return over.answered ?? []; },
    },
    lifecycle: { lastStatusChangeMs: (pane) => lastStatus.get(pane) ?? null },
    herdr,
    defaultSocket: DEFAULT,
    db: over.db ?? freshDb(),
    now: () => clock.now,
  });
  return { sensors, herdrCalls, listCalls, answeredCalls, lastStatus, clock };
}

describe("watchdog sensors: pane state", () => {
  const snapshots: Snap = {
    [DEFAULT]: [
      { pane_id: "w1:p1", agent: "claude", agent_status: "idle" },
      { pane_id: "w1:p2" },
      { pane_id: "w1:p3", agent: "claude", agent_status: "blocked" },
      { pane_id: "w1:p4", agent: "claude", agent_status: "working" },
      { pane_id: "w1:p5", agent: "claude", agent_status: "done" },
      { pane_id: "w1:p6", agent: "claude" },
    ],
    [BG]: [{ pane_id: "w1:p1", agent: "claude", agent_status: "working" }],
  };
  const herds = [herd(), herd({ id: "hid-1", herdrSocket: BG, hidden: true })];

  test("before any refresh every pane is gone", () => {
    const { sensors } = fx({ snapshots, herds });
    expect(sensors.paneState("w1:p1")).toBe("gone");
  });

  test("one snapshot per socket per refresh; bare refs read the default socket and bg: refs the hidden herd's", async () => {
    const { sensors, herdrCalls } = fx({ snapshots, herds });
    await sensors.refresh();
    expect(herdrCalls.map((c) => c.sock).sort()).toEqual([BG, DEFAULT]);
    expect(sensors.paneState("w1:p1")).toBe("idle");
    expect(sensors.paneState("bg:w1:p1")).toBe("working");
    expect(sensors.paneState("w1:p2")).toBe("dead");
    expect(sensors.paneState("w1:p3")).toBe("modal");
    expect(sensors.paneState("w1:p4")).toBe("working");
    expect(sensors.paneState("w1:p5")).toBe("idle");
    expect(sensors.paneState("w1:p6")).toBe("working");
    expect(sensors.paneState("w9:p9")).toBe("gone");
    expect(sensors.paneState("bg:w1:p2")).toBe("gone");
    expect(herdrCalls).toHaveLength(2);
  });

  test("a wrapped herd's socket is not snapshotted; an unreachable socket leaves its panes gone", async () => {
    const { sensors, herdrCalls } = fx({ snapshots, herds: [herd(), herd({ id: "old", herdrSocket: "/old.sock", hidden: true, status: "wrapped" }), herd({ id: "hid-2", herdrSocket: "/down.sock", hidden: true })] });
    await sensors.refresh();
    expect(herdrCalls.map((c) => c.sock).sort()).toEqual([DEFAULT, "/down.sock"]);
    expect(sensors.paneState("bg:w1:p1")).toBe("gone");
    expect(sensors.paneState("w1:p1")).toBe("idle");
  });

  test("with no active herd a refresh asks herdr nothing", async () => {
    const { sensors, herdrCalls } = fx({ snapshots, herds: [herd({ status: "wrapped" })] });
    await sensors.refresh();
    expect(herdrCalls).toHaveLength(0);
    expect(sensors.paneState("w1:p1")).toBe("gone");
  });

  test("socketFor names the socket a pane was seen on, defaulting for unknown panes", async () => {
    const { sensors } = fx({ snapshots, herds });
    await sensors.refresh();
    expect(sensors.socketFor("w1:p1")).toBe(DEFAULT);
    expect(sensors.socketFor("bg:w1:p1")).toBe(BG);
    expect(sensors.socketFor("w9:p9")).toBe(DEFAULT);
  });

  test("idleSinceMs hands the lifecycle the ref exactly as the row stores it", () => {
    const { sensors, lastStatus } = fx();
    lastStatus.set("bg:w1:p1", 4_000);
    expect(sensors.idleSinceMs("bg:w1:p1")).toBe(4_000);
    expect(sensors.idleSinceMs("w1:p1")).toBeNull();
  });

  test("a pane idle with no lifecycle entry is stamped on the first refresh that sees it, and keeps that stamp (RT-187)", async () => {
    const snaps: Snap = { [DEFAULT]: [{ pane_id: "w1:p1", agent: "claude", agent_status: "idle" }] };
    const { sensors, clock, lastStatus } = fx({ snapshots: snaps });
    expect(sensors.idleSinceMs("w1:p1")).toBeNull();

    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBe(NOW);

    clock.now = NOW + 5 * MIN;
    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBe(NOW);

    lastStatus.set("w1:p1", NOW + 4 * MIN);
    expect(sensors.idleSinceMs("w1:p1")).toBe(NOW + 4 * MIN);
    lastStatus.delete("w1:p1");
  });

  test("the seeded idle stamp clears when the pane works again or leaves the snapshot, and re-seeds on the next idle sighting", async () => {
    const snaps: Snap = { [DEFAULT]: [{ pane_id: "w1:p1", agent: "claude", agent_status: "idle" }] };
    const { sensors, clock } = fx({ snapshots: snaps });
    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBe(NOW);

    snaps[DEFAULT] = [{ pane_id: "w1:p1", agent: "claude", agent_status: "working" }];
    clock.now = NOW + 6 * MIN;
    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBeNull();

    snaps[DEFAULT] = [{ pane_id: "w1:p1", agent: "claude", agent_status: "idle" }];
    clock.now = NOW + 7 * MIN;
    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBe(NOW + 7 * MIN);

    snaps[DEFAULT] = [];
    clock.now = NOW + 8 * MIN;
    await sensors.refresh();
    expect(sensors.idleSinceMs("w1:p1")).toBeNull();
  });
});

describe("watchdog sensors: chat and gates", () => {
  test("unreadDmMentionsFor counts every unread DM line and only mentioning room lines, never its own", () => {
    const db = freshDb();
    const { room: dm } = dmRoomFor("job-a", "shepherd", "matt", db);
    postMessage({ room: dm, handle: "shepherd", body: "how is it going" }, db);
    postMessage({ room: dm, handle: "shepherd", body: "still there?" }, db);
    postMessage({ room: dm, handle: "job-a", body: "yes" }, db);
    joinRoom({ room: "herd-demo-1", handle: "job-a" }, db);
    joinRoom({ room: "herd-demo-1", handle: "shepherd" }, db);
    postMessage({ room: "herd-demo-1", handle: "shepherd", body: "@job-a please report" }, db);
    postMessage({ room: "herd-demo-1", handle: "shepherd", body: "general chatter" }, db);
    postMessage({ room: "herd-demo-1", handle: "job-a", body: "note to self @job-a" }, db);
    const { sensors } = fx({ db });
    expect(sensors.unreadDmMentionsFor("job-a")).toBe(3);
    expect(sensors.unreadDmMentionsFor("shepherd")).toBe(1);
    expect(sensors.unreadDmMentionsFor("nobody")).toBe(0);
  });

  test("openHumanGates lists open gates under the prefix owned by the human, aged from openedAt", () => {
    const gates = [
      gate({ id: "g-h", openedAt: NOW - 7 * MIN }),
      gate({ id: "g-herd", owner: "herd:demo-1", openedAt: NOW - 9 * MIN }),
      gate({ id: "g-none", owner: null, openedAt: NOW - 9 * MIN }),
    ];
    const { sensors, listCalls } = fx({ gates });
    expect(sensors.openHumanGates("herd:demo-1/")).toEqual([{ id: "g-h", ageMs: 7 * MIN }]);
    expect(listCalls).toEqual([{ open: true, subjectPrefix: "herd:demo-1/" }]);
  });

  test("unconsumedAnswered keeps the rows nudging this session, aged from the answer", () => {
    const answered = [
      gate({ id: "g-mine", status: "answered", nudge: { session: "sess-a" }, answer: { answers: {}, by: "matt", answeredAt: NOW - 4 * MIN } }),
      gate({ id: "g-other", status: "answered", nudge: { session: "sess-b" }, answer: { answers: {}, by: "matt", answeredAt: NOW - 4 * MIN } }),
      gate({ id: "g-no-nudge", status: "answered", nudge: null, answer: { answers: {}, by: "matt", answeredAt: NOW - 4 * MIN } }),
    ];
    const { sensors, answeredCalls } = fx({ answered });
    expect(sensors.unconsumedAnswered("sess-a")).toEqual([{ id: "g-mine", ageMs: 4 * MIN }]);
    expect(answeredCalls).toEqual([NOW]);
  });

  test("herds lists active herds only", () => {
    const { sensors } = fx({ herds: [herd(), herd({ id: "old", status: "wrapped" })] });
    expect(sensors.herds().map((h) => h.id)).toEqual(["demo-1"]);
  });
});

describe("watchdog actuators", () => {
  function act(over: { inject?: (o: any) => Promise<any>; socketFor?: (pane: string) => string } = {}) {
    const injected: any[] = [];
    const statuses: any[] = [];
    const notified: any[] = [];
    const a = createWatchdogActuators({
      herdStore: { setJobStatus: (...args: unknown[]) => { statuses.push(args); } },
      db: freshDb(),
      socketFor: over.socketFor ?? ((pane) => (pane.startsWith("bg:") ? BG : DEFAULT)),
      inject: async (o) => { injected.push(o); return over.inject ? over.inject(o) : { ok: true, data: { paneId: o.paneId, delivered: "accepted" } }; },
      enqueue: (event) => { notified.push(event); },
      log,
    });
    return { a, injected, statuses, notified };
  }

  test("poke strips the bg: ref and injects on the pane's socket; accepted is true", async () => {
    const { a, injected } = act();
    expect(await a.poke("bg:w1:p1", "watchdog: hello")).toBe(true);
    expect(await a.poke("w1:p2", "watchdog: hi")).toBe(true);
    expect(injected).toEqual([
      { paneId: "w1:p1", text: "watchdog: hello", sockPath: BG },
      { paneId: "w1:p2", text: "watchdog: hi", sockPath: DEFAULT },
    ]);
  });

  test("queued, refused, a herdr error, and a throw all read false without escaping", async () => {
    const outcomes = [
      { ok: true, data: { paneId: "w1:p1", delivered: "queued" } },
      { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } },
      { ok: false, error: "herdr unavailable" },
    ];
    const { a } = act({ inject: async () => outcomes.shift() });
    expect(await a.poke("w1:p1", "t")).toBe(false);
    expect(await a.poke("w1:p1", "t")).toBe(false);
    expect(await a.poke("w1:p1", "t")).toBe(false);
    const thrower = act({ inject: async () => { throw new Error("socket exploded"); } });
    expect(await thrower.a.poke("w1:p1", "t")).toBe(false);
  });

  test("parkStuckAtModal marks the job row", () => {
    const { a, statuses } = act();
    a.parkStuckAtModal("demo-1", "job-a");
    expect(statuses).toEqual([["demo-1", "job-a", "stuck-at-modal"]]);
  });

  test("notifyStuckAtModal enqueues a click-to-focus notification carrying the pane id", () => {
    const { a, notified } = act();
    a.notifyStuckAtModal("demo-1", "job-a", "bg:w1:p1");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      title: "herd demo-1: job-a stuck at trust modal",
      message: "click to focus pane bg:w1:p1, accept the dialog",
      category: "herd-watchdog",
      paneId: "bg:w1:p1",
    });
    expect(typeof notified[0].id).toBe("string");
    expect(typeof notified[0].timestamp).toBe("number");
  });

  test("a failed park notification never escapes the actuator", () => {
    const a = createWatchdogActuators({
      herdStore: { setJobStatus: () => {} },
      db: freshDb(),
      socketFor: () => DEFAULT,
      enqueue: () => { throw new Error("queue full"); },
      log,
    });
    expect(() => a.notifyStuckAtModal("demo-1", "job-a", "w1:p1")).not.toThrow();
  });

  test("notifyHuman enqueues a herd-watchdog notification carrying the summary and the party's pane", () => {
    const { a, notified } = act();
    a.notifyHuman("watchdog: demo-1/job-a: idle 20m; strike 5", "bg:w1:p1");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ title: "herd watchdog", message: "watchdog: demo-1/job-a: idle 20m; strike 5", category: "herd-watchdog", paneId: "bg:w1:p1" });
    a.notifyHuman("watchdog: demo-1/@shepherd: unreachable", null);
    expect("paneId" in notified[1]).toBe(false);
    expect(typeof notified[0].id).toBe("string");
    expect(notified[0].id.length).toBeGreaterThan(0);
    expect(typeof notified[0].timestamp).toBe("number");
  });
});

describe("readWatchdogConfig", () => {
  test("resolves every key through the reader, falling back per key on a throw or a wrong type", () => {
    const values: Record<string, unknown> = {
      "herd.watchdog.enabled": false,
      "herd.watchdog.fastMins": 3,
      "herd.watchdog.shepherdFastMins": "seven",
      "herd.watchdog.backstopMins": -1,
      "herd.watchdog.retryMins": 1,
      "herd.watchdog.notifyQuietMins": 0,
      "herd.watchdog.nagMins": 45,
    };
    const read = <T,>(key: string): { value: T } => {
      if (key === "herd.watchdog.notifyHuman") throw new Error("store unreadable");
      return { value: values[key] as T };
    };
    expect(readWatchdogConfig(read)).toEqual({
      enabled: false, fastMins: 3, shepherdFastMins: 5, backstopMins: 15,
      retryMins: 1, notifyQuietMins: 1, nagMins: 45, notifyHuman: true,
    });
  });

  test("retryMins and notifyQuietMins floor at 1 minute so a 0/0 config cannot notify every sweep; fastMins keeps 0 for the immediate-poke setting", () => {
    const values: Record<string, unknown> = { "herd.watchdog.retryMins": 0, "herd.watchdog.notifyQuietMins": 0, "herd.watchdog.fastMins": 0 };
    const read = <T,>(key: string): { value: T } => ({ value: values[key] as T });
    const resolved = readWatchdogConfig(read);
    expect(resolved.retryMins).toBe(1);
    expect(resolved.notifyQuietMins).toBe(1);
    expect(resolved.fastMins).toBe(0);
  });
});
