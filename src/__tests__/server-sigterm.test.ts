import { afterAll, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Sparkle replaces the whole bundle on update (this process's inode vanishes
// mid-run) and launchd sends SIGTERM before its grace period expires either
// way -- proves the board exits promptly and cleanly on both, rather than
// leaking past its grace period into a SIGKILL. Real (non-fixture) boot, same
// isolation as server-healthz-fast.test.ts.
const fakeHome = mkdtempSync(join(tmpdir(), "board-sigterm-"));

const teamDir = join(fakeHome, ".mattstack", "teams", "testteam", "mattstack");
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, "settings.team.jsonc"),
  JSON.stringify({
    "board.gitlabHost": "https://gitlab.example.com",
    "board.projects": ["g/p"],
    "board.members": [{ username: "alice" }],
  }),
);

const PORT = 47944;
const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "server.ts")], {
  env: {
    ...process.env,
    HOME: fakeHome,
    PORT: String(PORT),
    GITLAB_TOKEN: "", SLACK_TOKEN: "", SWITCHBOARD_TOKEN: "", SWITCHBOARD_ADMIN_TOKEN: "",
  },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => {
  proc.kill();
});

test("SIGTERM exits promptly with code 0, not leaked past the grace period", async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  proc.kill("SIGTERM");
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  // The port is actually released, not just the process reaping -- a lingering
  // listener would mean shutdown() returned before httpServer.stop() took effect.
  await expect(fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(500) }))
    .rejects.toThrow();
});
