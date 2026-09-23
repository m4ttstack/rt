export interface RawGitOpts {
  okCodes?: number[]; // exit codes besides 0 that still return stdout
  stdin?: string; // piped to the child and closed; e.g. `git apply -` patches
  signal?: AbortSignal; // kills the child and rejects promptly on abort
}

// Set only on the exit-code-classification throw below, so a caller can
// narrow on a specific code without re-parsing the message; a spawn failure
// (bad cwd, missing binary) or an aborted-before-exit rejection carries no
// exit code at all and so never matches any `isGitExitCode` check.
export interface GitExitError extends Error {
  exitCode: number;
}

export function isGitExitCode(error: unknown, code: number): error is GitExitError {
  return error instanceof Error && "exitCode" in error && (error as GitExitError).exitCode === code;
}

// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE inherited from the parent process
// (real exposure: a git hook sets GIT_DIR) redirect a git invocation at a
// repository other than the one named by `dir`, silently. Every spawn in
// this package goes through this scrubber first.
const REPO_LOCATION_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

export function scrubGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of REPO_LOCATION_ENV_KEYS) delete env[key];
  // Pinned so English classification text (e.g. "Binary files ... differ")
  // matches the C-locale guarantee the simple-git client also makes.
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

// A killed process is not guaranteed to unblock immediately: SIGTERM
// delivery can be deferred behind a syscall the child is stuck in (a stalled
// connect(), for instance), so a grace period backstops it with SIGKILL,
// which the kernel cannot defer.
const ABORT_KILL_GRACE_MS = 2000;

// git diff --no-index exits 1 when files differ; simple-git treats that
// as failure, so the one raw runner lives here.
export async function rawGit(dir: string, args: string[], opts: RawGitOpts = {}): Promise<string> {
  const ok = new Set([0, ...(opts.okCodes ?? [])]);
  // A signal that is already aborted must never spawn: callers that raced an
  // abort against a queued call expect no child at all, not one killed at birth.
  if (opts.signal?.aborted) {
    throw new Error(`git ${args.join(" ")} aborted before starting`);
  }
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: scrubGitEnv(),
  });
  // Always closed, even with no stdin data: git plumbing commands that never
  // read it ignore the EOF, but leaving it open (the default "inherit") would
  // let a child block on the parent's real stdin.
  if (opts.stdin !== undefined) proc.stdin.write(opts.stdin);
  proc.stdin.end();

  const collected = (async (): Promise<string> => {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (!ok.has(code)) {
      const error = new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`) as GitExitError;
      error.exitCode = code;
      throw error;
    }
    return out;
  })();

  const signal = opts.signal;
  if (!signal) return collected;

  // A killed child's stdout/stderr streams (or the exit wait itself, if the
  // signal is slow to land) can stay pending well past the kill call, so an
  // abort settles this promise itself rather than waiting on `collected`.
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      run();
    };
    const onAbort = () => {
      finish(() => reject(new Error(`git ${args.join(" ")} aborted`)));
      try {
        proc.kill();
      } catch {
        // Already exited between the abort firing and this call.
      }
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already exited before the grace period ran out.
        }
      }, ABORT_KILL_GRACE_MS);
      killTimer.unref?.();
      // .catch, not just .finally: proc.exited settling on its own path here
      // must never surface as an unhandled rejection, since nothing else
      // observes this particular chain.
      proc.exited.finally(() => clearTimeout(killTimer)).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    collected.then(
      (out) => finish(() => resolve(out)),
      (err) => finish(() => reject(err)),
    );
  });
}

// Reuses the same spawn path for git plumbing whose exit code IS the answer
// (e.g. diff --quiet, merge-base --is-ancestor): 0/1 are both success states,
// anything else is a real failure.
export async function rawGitOk(dir: string, args: string[]): Promise<boolean> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: scrubGitEnv(),
  });
  const [, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code === 0) return true;
  if (code === 1) return false;
  throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`);
}
