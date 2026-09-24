import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { TRAY_SOCK_PATH, DAEMON_SOCK_PATH, markDaemonInstalled } from "../../lib/daemon-config.ts";
import { processFlavor } from "../../lib/flavor.ts";
import { restart, start, stop, RESTART_POLL } from "../daemon.ts";

const realFetch = globalThis.fetch;
const realLog = console.log;

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  mkdirSync(dirname(TRAY_SOCK_PATH), { recursive: true });
  writeFileSync(TRAY_SOCK_PATH, "");
  writeFileSync(DAEMON_SOCK_PATH, "");
  RESTART_POLL.intervalMs = 1;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  rmSync(TRAY_SOCK_PATH, { force: true });
  rmSync(DAEMON_SOCK_PATH, { force: true });
  rmSync(join(dirname(DAEMON_SOCK_PATH), "daemon.json"), { force: true });
  RESTART_POLL.intervalMs = 500;
});

function output(): string {
  return lines.join("\n");
}

/**
 * Fakes both sockets: the tray ack and the daemon's ping. `pid` is consulted
 * per call, so a scenario can turn the daemon over (or not) mid-flight.
 */
function fakeSockets(opts: { trayReply: () => Response | Promise<Response>; pid: () => number | null }): void {
  const flavor = processFlavor();
  globalThis.fetch = (async (_url: string, init: any) => {
    if (init?.unix === TRAY_SOCK_PATH) return opts.trayReply();
    const pid = opts.pid();
    if (pid === null) throw new Error("connection refused");
    return new Response(JSON.stringify({ ok: true, pid, flavor }));
  }) as any;
}

test("restart does not claim success while the old daemon pid still answers", async () => {
  // The 2026-09-21 incident: the tray acked and silently dropped the op, the
  // old daemon answered the first poll, and restart printed "✓ daemon
  // restarted" after 505ms with nothing restarted.
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: true })),
    pid: () => 111,
  });

  await restart();

  expect(output()).not.toContain("✓ daemon restarted");
  expect(output()).toContain("111");
  expect(output().toLowerCase()).toContain("did not");
});

test("restart succeeds only once a different pid answers, and names the turnover", async () => {
  let calls = 0;
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: true })),
    pid: () => { calls += 1; return calls <= 3 ? 111 : 222; },
  });

  await restart();

  expect(output()).toContain("✓ daemon restarted");
  expect(output()).toContain("111 → 222");
});

test("restart of a confidently-down daemon (no socket file) succeeds when any live pid comes up", async () => {
  rmSync(DAEMON_SOCK_PATH, { force: true });
  let posted = false;
  fakeSockets({
    trayReply: () => { posted = true; return new Response(JSON.stringify({ ok: true })); },
    pid: () => (posted ? 222 : null),
  });

  await restart();

  expect(output()).toContain("✓ daemon restarted");
});

test("a failed baseline probe never converts an unchanged daemon into a ✓", async () => {
  // The daemon socket exists but the pre-restart probe keeps failing (load,
  // timeout). The old daemon may still be alive, so a pid answering later
  // proves nothing — the verdict must be unverified, not success.
  let calls = 0;
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: true })),
    pid: () => { calls += 1; return calls <= 3 ? null : 111; },
  });

  await restart();

  expect(output()).not.toContain("✓ daemon restarted");
  expect(output().toLowerCase()).toContain("unverified");
});

test("restart ignores RT_APP_SOCKET when trayQuery's own socket gate said the tray is gone", async () => {
  process.env.RT_APP_SOCKET = DAEMON_SOCK_PATH;
  try {
    rmSync(TRAY_SOCK_PATH, { force: true });
    let calls = 0;
    fakeSockets({
      trayReply: () => new Response(JSON.stringify({ ok: true })),
      pid: () => { calls += 1; return calls <= 1 ? 111 : 222; },
    });

    await restart();

    expect(output()).toContain("is not running");
    expect(output()).not.toContain("✓ daemon restarted");
  } finally {
    delete process.env.RT_APP_SOCKET;
  }
});

test("a present-but-slow tray still gets a pid-verified verdict, not 'tray not running'", async () => {
  // The tray now replies after the op completes, so a slow op can outlive the
  // request timeout. The socket file existing means the tray is there; the
  // pid poll still decides the truth.
  let calls = 0;
  fakeSockets({
    trayReply: () => { const e = new Error("The operation timed out"); e.name = "TimeoutError"; throw e; },
    pid: () => { calls += 1; return calls <= 2 ? 111 : 222; },
  });

  await restart();

  expect(output()).not.toContain("is not running");
  expect(output()).toContain("✓ daemon restarted");
  expect(output()).toContain("111 → 222");
});

test("a tray that reports the op failed is surfaced as failure, not as 'tray not running'", async () => {
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
    pid: () => 111,
  });

  await restart();

  expect(output()).not.toContain("✓ daemon restarted");
  expect(output().toLowerCase()).toContain("failed");
  expect(output()).not.toContain("is not running");
});

test("start of a down daemon surfaces a failed op instead of claiming the tray is not running", async () => {
  markDaemonInstalled();
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
    pid: () => null,
  });

  await start();

  expect(output()).not.toContain("is not running");
  expect(output().toLowerCase()).toContain("failed");
});

test("stop surfaces a failed unregister instead of claiming there was nothing to stop", async () => {
  fakeSockets({
    trayReply: () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
    pid: () => 111,
  });

  await stop();

  expect(output()).not.toContain("nothing to stop");
  expect(output()).not.toContain("✓");
  expect(output().toLowerCase()).toContain("failed");
});
