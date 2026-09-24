/**
 * The processes whose cwd pins a worktree the reactor would otherwise dispose:
 * who they are (so `rt worktree list` can name them) and which are stale
 * orphans nobody will ever come back for (so the reactor can stop them).
 */

import { lazyChildLogger } from "../../daemon-logger.ts";
import { runCapture } from "../../subprocess.ts";
import { parseLsofCwdMap } from "../system-process-scanner.ts";
import { attributeCwds, isUserOrAgentProcess, safeRealpath } from "../worktree-process-kill.ts";

const log = lazyChildLogger("tree-holders");

/** A reparented process this old has outlived whatever session started it. */
export const STALE_ORPHAN_MS = 12 * 60 * 60 * 1000;
const ESCALATE_AFTER_MS = 5_000;
const DESCRIBED_HOLDERS = 3;

export interface TreeHolder {
  pid: number;
  ppid: number;
  command: string;
  fullCommand: string;
  elapsedMs: number;
}

/** `ps -o etime` format: `[[dd-]hh:]mm:ss`. NaN when unparseable. */
export function parseEtime(etime: string): number {
  const m = etime.trim().match(/^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/);
  if (!m) return NaN;
  const [, d, h, min, s] = m;
  return (((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min)) * 60 + Number(s)) * 1000;
}

/**
 * Reparented to launchd, alive past the threshold, and not a user-facing
 * process (agent, shell, editor, a GUI app's main binary). A toolchain binary
 * inside an app bundle (Xcode's `Contents/Developer/.../xctest`) still counts.
 */
export function isStaleOrphan(h: TreeHolder): boolean {
  if (h.ppid !== 1) return false;
  if (!(h.elapsedMs >= STALE_ORPHAN_MS)) return false;
  if (h.fullCommand.includes(".app/Contents/MacOS/")) return false;
  // A login shell's argv0 is "-zsh".
  const unlogin = (s: string) => s.replace(/^-/, "");
  return !isUserOrAgentProcess({ ...h, command: unlogin(h.command), fullCommand: unlogin(h.fullCommand) });
}

export function describeHolders(holders: TreeHolder[]): string {
  const named = holders.slice(0, DESCRIBED_HOLDERS).map((h) => `pid ${h.pid} (${h.command})`).join(", ");
  const more = holders.length - DESCRIBED_HOLDERS;
  return more > 0 ? `${named} and ${more} more` : named;
}

/** Fresh lsof + ps for the processes whose cwd is inside `treePath`. Empty on any tool failure. */
export async function treeHolders(treePath: string): Promise<TreeHolder[]> {
  const target = safeRealpath(treePath);
  const lsof = await runCapture(["lsof", "-d", "cwd", "-Fpn"], { timeoutMs: 10_000 });
  if (lsof.exitCode !== 0 && !lsof.stdout) return [];
  const resolved = new Map<number, string>();
  for (const [pid, raw] of parseLsofCwdMap(lsof.stdout, [target])) resolved.set(pid, safeRealpath(raw));
  // A launchd-started daemon is itself ppid 1 and long-lived; it must never
  // read as a stale orphan of a tree it happens to sit in.
  const self = new Set([process.pid, process.ppid]);
  const pids = [...attributeCwds(target, [], resolved).keys()].filter((pid) => !self.has(pid));
  if (pids.length === 0) return [];

  // args last and no comm column: an executable path with a space would shift every field after it.
  const ps = await runCapture(["ps", "-p", pids.join(","), "-o", "pid=,ppid=,etime=,args="], { timeoutMs: 5000 });
  const holders: TreeHolder[] = [];
  for (const line of ps.stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
    if (!m) continue;
    const argv0 = m[4]!.split(" ")[0]!;
    holders.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      elapsedMs: parseEtime(m[3]!),
      command: argv0.split("/").pop() || argv0,
      fullCommand: m[4]!,
    });
  }
  return holders;
}

/** SIGTERM now, SIGKILL whatever is still alive after five seconds. */
export function stopProcesses(pids: number[]): void {
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
  const timer = setTimeout(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
        log.warn({ pid }, "stale orphan survived SIGTERM; escalated to SIGKILL");
      } catch { /* exited */ }
    }
  }, ESCALATE_AFTER_MS);
  timer.unref?.();
}
