export interface RawGitOpts {
  okCodes?: number[]; // exit codes besides 0 that still return stdout
  stdin?: string; // piped to the child and closed; e.g. `git apply -` patches
}

// git diff --no-index exits 1 when files differ; simple-git treats that
// as failure, so the one raw runner lives here.
export async function rawGit(dir: string, args: string[], opts: RawGitOpts = {}): Promise<string> {
  const ok = new Set([0, ...(opts.okCodes ?? [])]);
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  // Always closed, even with no stdin data: git plumbing commands that never
  // read it ignore the EOF, but leaving it open (the default "inherit") would
  // let a child block on the parent's real stdin.
  if (opts.stdin !== undefined) proc.stdin.write(opts.stdin);
  proc.stdin.end();
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (!ok.has(code)) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  }
  return out;
}

// Reuses the same spawn path for git plumbing whose exit code IS the answer
// (e.g. diff --quiet, merge-base --is-ancestor): 0/1 are both success states,
// anything else is a real failure.
export async function rawGitOk(dir: string, args: string[]): Promise<boolean> {
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code === 0) return true;
  if (code === 1) return false;
  throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`);
}
