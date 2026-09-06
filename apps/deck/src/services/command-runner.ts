import { openSync, closeSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { logsDir } from "../api/state.ts";

export type SpawnFn = (
  argv: string[],
  opts: { cwd: string; stdout: number; stderr: number },
) => { exited: Promise<number> };

interface Run {
  runId: string;
  cmd: string;
  status: "running" | "exited";
  exitCode?: number;
}

const runs = new Map<string, Run>(); // keyed by app name: one in-flight run per app

export function resetRuns(): void {
  runs.clear();
}

const defaultSpawn: SpawnFn = (argv, opts) => Bun.spawn(argv, opts) as unknown as { exited: Promise<number> };

export function startCommandRun(
  input: { name: string; cmd: string; shell: string; workingDirectory: string },
  deps: { spawn?: SpawnFn; logDir?: string } = {},
): { started: true; runId: string } | { started: false; reason: "busy" } {
  const active = runs.get(input.name);
  if (active && active.status === "running") return { started: false, reason: "busy" };

  const dir = deps.logDir ?? logsDir();
  mkdirSync(dir, { recursive: true });
  // Append into the app's existing deck log, so `deck logs` shows command output.
  const out = openSync(join(dir, `${input.name}.out.log`), "a");
  const errFd = openSync(join(dir, `${input.name}.err.log`), "a");

  const runId = randomBytes(8).toString("hex");
  const run: Run = { runId, cmd: input.cmd, status: "running" };
  runs.set(input.name, run);

  let proc: ReturnType<SpawnFn>;
  try {
    proc = (deps.spawn ?? defaultSpawn)(["sh", "-c", input.shell], {
      cwd: input.workingDirectory,
      stdout: out,
      stderr: errFd,
    });
  } catch (err) {
    // A synchronous spawn failure must not leave the app permanently busy or
    // leak the two fds opened above -- nothing else will ever close them.
    runs.delete(input.name);
    try { closeSync(out); } catch { /* already closed */ }
    try { closeSync(errFd); } catch { /* already closed */ }
    throw err;
  }
  proc.exited.then((code) => {
    run.status = "exited";
    run.exitCode = code;
    // Bun.spawn's ownership of numeric stdio fds is ambiguous; a bare closeSync
    // could double-close and throw EBADF, so each close is independently guarded.
    try { closeSync(out); } catch { /* already closed */ }
    try { closeSync(errFd); } catch { /* already closed */ }
  });

  return { started: true, runId };
}

export function commandRunStatus(
  name: string,
  runId: string,
): { status: "running" | "exited"; exitCode?: number } | null {
  const run = runs.get(name);
  if (!run || run.runId !== runId) return null;
  return run.exitCode === undefined ? { status: run.status } : { status: run.status, exitCode: run.exitCode };
}
