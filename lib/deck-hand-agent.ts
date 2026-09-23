/**
 * Retires a hand-installed deck LaunchAgent (`deck setup` writes one into
 * ~/Library/LaunchAgents) so the app bundle's SMAppService helper is deck's
 * only supervisor. Two supervisors fight over deck's ports and leave the
 * loser crash-looping.
 *
 * The prod bundle helper reuses the label `com.mattstack.deck`, so a label
 * alone never proves a job is hand-installed: only a job whose launchd
 * `path` is the ~/Library/LaunchAgents plist is booted out. An SMAppService
 * job prints `path = (submitted by smd.<pid>)` instead.
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HAND_DECK_LABEL = "com.mattstack.deck";

export function handDeckPlistPath(home: string): string {
  return join(home, "Library", "LaunchAgents", `${HAND_DECK_LABEL}.plist`);
}

export function retiredHandDeckPlistPath(home: string): string {
  return join(home, ".mattstack", "deck", `${HAND_DECK_LABEL}.plist.retired`);
}

export interface HandDeckAgentSeams {
  home: string;
  uid: number;
  exists(path: string): boolean;
  launchctl(args: string[]): { status: number; stdout: string };
  mkdirp(dir: string): void;
  rename(from: string, to: string): void;
  now?: () => number;
}

export type HandDeckRetireOutcome =
  | { kind: "absent" }
  | { kind: "retired"; bootedOut: boolean; archivedTo: string }
  | { kind: "failed"; error: string };

function loadedFromPlist(printOut: string, plist: string): boolean {
  return printOut.split("\n").some((line) => line.trim() === `path = ${plist}`);
}

export function retireHandInstalledDeckAgent(s: HandDeckAgentSeams): HandDeckRetireOutcome {
  const plist = handDeckPlistPath(s.home);
  if (!s.exists(plist)) return { kind: "absent" };

  const target = `gui/${s.uid}/${HAND_DECK_LABEL}`;
  const print = s.launchctl(["print", target]);
  let bootedOut = false;
  if (print.status === 0 && loadedFromPlist(print.stdout, plist)) {
    const bootout = s.launchctl(["bootout", target]);
    if (bootout.status !== 0) {
      return { kind: "failed", error: `launchctl bootout ${target} exited ${bootout.status}: ${bootout.stdout.trim()}` };
    }
    bootedOut = true;
  }

  const base = retiredHandDeckPlistPath(s.home);
  const archivedTo = s.exists(base) ? `${base}.${(s.now ?? Date.now)()}` : base;
  try {
    s.mkdirp(dirname(base));
    s.rename(plist, archivedTo);
  } catch (e) {
    return { kind: "failed", error: `could not archive ${plist}: ${(e as Error).message}` };
  }
  return { kind: "retired", bootedOut, archivedTo };
}

/** Call-time HOME, so an isolated test HOME is honored. */
export function realHandDeckAgentSeams(): HandDeckAgentSeams {
  return {
    home: process.env.HOME ?? homedir(),
    uid: process.getuid?.() ?? 501,
    exists: existsSync,
    launchctl(args) {
      // env forwarded so a PATH-prepended fake launchctl is honored (Bun
      // otherwise resolves against the process-start PATH).
      const r = spawnSync("launchctl", args, { encoding: "utf8", stdio: "pipe", env: process.env });
      return { status: r.status ?? -1, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    },
    mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
    rename: renameSync,
  };
}

export function describeHandDeckRetire(o: HandDeckRetireOutcome): string | null {
  switch (o.kind) {
    case "absent":
      return null;
    case "retired":
      return `retired hand-installed ${HAND_DECK_LABEL}${o.bootedOut ? " (booted out)" : ""}; plist archived at ${o.archivedTo}`;
    case "failed":
      return `could not retire hand-installed ${HAND_DECK_LABEL}: ${o.error}`;
  }
}
