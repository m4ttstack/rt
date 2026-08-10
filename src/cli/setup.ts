// src/cli/setup.ts
import { readFileSync, rmSync } from "fs";
import { basename, join } from "path";
import { bootstrapSelf } from "../registry/bootstrap.ts";
import { readProxyTlds } from "../edge/portless.ts";
import type { Drivers } from "../api/register.ts";
import { listRecords, getRecord, deleteRecord } from "../registry/records.ts";
import { stateDir, logsDir } from "../api/state.ts";
import { updatePlatformSettings } from "../api/platform-settings.ts";
import { PLATFORM_NAME, LEGACY_PLATFORM_NAME, isPlatformManagedBy } from "../services/manager.ts";

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

export type CheckExec = (argv: string[]) => Promise<{ code: number; stdout: string }>;

const realCheckExec: CheckExec = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { code, stdout };
};

// portless's own declared prerequisite (see `portless --help`: "Requirements: Node.js 24+").
const NODE_MAJOR_FLOOR = 24;
// Pinned floor (ruled): the multi-TLD alias behavior bootstrapSelf relies on
// is live-verified only from 0.15.5 onward.
const PORTLESS_VERSION_FLOOR = [0, 15, 5] as const;

function parseVersion(raw: string): [number, number, number] | null {
  const m = raw.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function belowFloor(v: [number, number, number], floor: readonly [number, number, number]): boolean {
  const parts: Array<[number, number]> = [[v[0], floor[0]], [v[1], floor[1]], [v[2], floor[2]]];
  for (const [have, want] of parts) {
    if (have < want) return true;
    if (have > want) return false;
  }
  return false;
}

/**
 * Read-only checks only (ruled by hazard): `portless trust` mutates the
 * system keychain and can hang on a stuck security daemon, so it is never
 * shelled out to here — only `--version` reads.
 */
export async function checkPrereqs(exec: CheckExec): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  const node = await exec(["node", "--version"]);
  const nodeVersion = node.code === 0 ? parseVersion(node.stdout) : null;
  if (!nodeVersion || nodeVersion[0] < NODE_MAJOR_FLOOR) {
    problems.push(
      `node ${NODE_MAJOR_FLOOR}+ is required (portless's own prerequisite) — found ${node.stdout.trim() || "none"}; install from https://nodejs.org`,
    );
  }

  const portless = await exec(["portless", "--version"]);
  if (portless.code !== 0) {
    problems.push(
      "portless is not installed — `npm install -g portless`, then `portless trust` and `portless service install`",
    );
  } else {
    const version = parseVersion(portless.stdout);
    if (!version || belowFloor(version, PORTLESS_VERSION_FLOOR)) {
      problems.push(
        `portless must be >= ${PORTLESS_VERSION_FLOOR.join(".")} (found ${portless.stdout.trim() || "unknown"}) — \`npm install -g portless\``,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Compiled binary: process.execPath is the binary itself, not bun.
 * Checkout: process.execPath IS bun, so the entry (this repo's src/main.ts,
 * i.e. Bun.main) must be threaded through explicitly.
 */
export function detectExecTarget(): { execPath: string; entry: string | null } {
  const execPath = process.execPath;
  const isCompiled = !basename(execPath).startsWith("bun");
  return isCompiled ? { execPath, entry: null } : { execPath, entry: Bun.main };
}

function healthBudgetMs(): number {
  return Number(process.env.LOCAL_SETUP_HEALTH_BUDGET_MS ?? 10_000);
}
function healthIntervalMs(): number {
  return Number(process.env.LOCAL_SETUP_HEALTH_INTERVAL_MS ?? 500);
}

async function waitForHealth(port: number): Promise<boolean> {
  const deadline = Date.now() + healthBudgetMs();
  const interval = healthIntervalMs();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

function tailLog(path: string, lines = 20): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log yet)";
  }
}

export async function setup(drivers: Drivers, io: Io, checkExec: CheckExec = realCheckExec): Promise<number> {
  const check = await checkPrereqs(checkExec);
  if (!check.ok) {
    for (const problem of check.problems) io.err(problem);
    return 1;
  }

  const tlds = readProxyTlds();
  updatePlatformSettings({ tlds });

  const { execPath, entry } = detectExecTarget();
  const result = await bootstrapSelf(drivers, { execPath, entry, tlds });

  const healthy = await waitForHealth(result.port);
  if (!healthy) {
    io.err(`Deck didn't come up on port ${result.port} within the health-check budget`);
    io.err(tailLog(join(logsDir(), "deck.err.log")));
    return 1;
  }

  for (const alias of result.aliases) {
    for (const tld of tlds) io.out(`https://${alias}.${tld}`);
  }
  return 0;
}

export async function uninstall(drivers: Drivers, io: Io, opts: { force: boolean }): Promise<number> {
  const others = listRecords().filter((r) => !isPlatformManagedBy(r.managedBy));
  if (others.length > 0 && !opts.force) {
    io.err("Other apps are still registered with Deck:");
    for (const r of others) io.err(`  ${r.name} (${r.managedBy})`);
    io.err("Remove them first, or re-run `deck uninstall --force`.");
    return 1;
  }

  // A machine that never got to re-run `deck setup` after the Local -> Deck
  // rename may still carry its self-row under the pre-rename name.
  const self = getRecord(PLATFORM_NAME) ?? getRecord(LEGACY_PLATFORM_NAME);
  if (self) {
    if (self.label) {
      try {
        await drivers.manager.uninstall(self.label);
      } catch {
        // best-effort teardown; uninstall must not get stuck on a driver failure
      }
    }
    // All four: an upgrading machine's routes could still carry the
    // pre-rename aliases alongside (or instead of) the current ones.
    // removeAlias() is idempotent teardown (edge/portless.ts), so attempting
    // one that was never written is a safe no-op.
    for (const alias of [PLATFORM_NAME, `${PLATFORM_NAME}.mattstack`, LEGACY_PLATFORM_NAME, `${LEGACY_PLATFORM_NAME}.mattstack`]) {
      try {
        await drivers.edge.removeAlias(alias);
      } catch {
        // alias may never have been written (e.g. mattstack TLD already active)
      }
    }
    deleteRecord(self.name);
  }

  try {
    rmSync(join(stateDir(), "api.json"), { force: true });
  } catch {
    // nothing to remove
  }

  io.out("Deck uninstalled: its launchd agent, route aliases, and api.json are gone.");
  io.out("Left in place: portless itself, and any per-app launchd plists it still supervises.");
  return 0;
}
