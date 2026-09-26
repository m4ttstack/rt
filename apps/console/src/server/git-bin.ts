export type RunGit = (
  argv: string[]
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** A `git log` over a repo the size of a pack answers in milliseconds; ten
    seconds means something is wedged, and a wedged spawn must surface as a
    502 rather than a hung page. Same bound `rt-bin.ts` puts on `rt`. */
const SPAWN_TIMEOUT_MS = 10_000;

/**
 * The Bun-only half of the git seam -- unreachable from vitest's Node
 * runtime, same split `rt-bin.ts` documents. `skills.ts` takes this as an
 * injectable parameter defaulting to this export, so the history route stays
 * testable without the `Bun` global and without touching a real repo.
 *
 * Every caller passes `-C <dir>`: the process cwd is shared with the whole
 * server, so scoping by cwd would be a race between concurrent requests.
 */
export const runGit: RunGit = async argv => {
  const proc = Bun.spawn(['git', ...argv], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = setTimeout(() => proc.kill(), SPAWN_TIMEOUT_MS);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
};
