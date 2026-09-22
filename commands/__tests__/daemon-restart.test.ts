import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { dirname } from "path";
import { TRAY_SOCK_PATH, DAEMON_SOCK_PATH } from "../../lib/daemon-config.ts";
import { resolveIntendedMode } from "../../lib/dev-mode.ts";
import { restart, RESTART_POLL } from "../daemon.ts";

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
  const flavor = resolveIntendedMode().mode;
  globalThis.fetch = (async (url: string, init: any) => {
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

test("restart of a down daemon succeeds when any live pid comes up", async () => {
  let posted = false;
  fakeSockets({
    trayReply: () => { posted = true; return new Response(JSON.stringify({ ok: true })); },
    pid: () => (posted ? 222 : null),
  });

  await restart();

  expect(output()).toContain("✓ daemon restarted");
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
