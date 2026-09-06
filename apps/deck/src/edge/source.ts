// src/edge/source.ts: git provenance for a service's push directory.
// pushRemote needs both answers synchronously and before it uploads --
// the sha/dirty stamp it records, and the untracked-.env guard that
// blocks the upload outright -- so every call here shells `git` via
// Bun.spawnSync rather than the async Bun.spawn the rest of edge/ uses.

function git(args: string[], dir: string): { code: number; stdout: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? 1, stdout: proc.stdout.toString() };
}

export function gitProvenance(dir: string): { sha: string; dirty: boolean } {
  const rev = git(["rev-parse", "--short", "HEAD"], dir);
  if (rev.code !== 0) throw new Error(`git rev-parse failed in ${dir}: ${rev.stdout.slice(0, 300)}`);
  const status = git(["status", "--porcelain"], dir);
  return { sha: rev.stdout.trim(), dirty: status.stdout.length > 0 };
}

// Matches a `.env`-shaped path anywhere in the tree: `.env`, `.env.local`,
// `sub/dir/.env.production`, but not `env.example` or `.environment`.
const ENV_PATH_RE = /(^|\/)\.env(\.[^/]+)?$/;

export function untrackedEnvPresent(dir: string): boolean {
  const status = git(["status", "--porcelain", "--untracked-files=all"], dir);
  return status.stdout
    .split("\n")
    .filter((line) => line.length > 3)
    // porcelain format: two status chars + a space, then the path.
    .some((line) => ENV_PATH_RE.test(line.slice(3).trim()));
}
