export interface RawGitOpts {
  okCodes?: number[]; // exit codes besides 0 that still return stdout
}

// git diff --no-index exits 1 when files differ; simple-git treats that
// as failure, so the one raw runner lives here.
export async function rawGit(dir: string, args: string[], opts: RawGitOpts = {}): Promise<string> {
  const ok = new Set([0, ...(opts.okCodes ?? [])]);
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
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
