import { afterAll, expect, test } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Sparkle replaces the whole bundle on update (this process's inode vanishes
// mid-run) and launchd sends SIGTERM before its grace period expires either
// way -- proves deck exits promptly and cleanly on both, rather than leaking
// past its grace period into a SIGKILL. Real (non-fixture) boot, mirroring
// board's server-sigterm.test.ts.
const fakeHome = mkdtempSync(join(tmpdir(), "deck-sigterm-"));
const PORT = 47953;
const CANARY_PORT = 47954;
writeFileSync(join(fakeHome, "routes.json"), "[]");

const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "main.ts"), "serve"], {
  env: {
    ...process.env,
    HOME: fakeHome,
    LOCAL_STATE_DIR: fakeHome,
    LOCAL_REGISTRY_PATH: join(fakeHome, "registry.json"),
    LOCAL_APPS_ROUTES_PATH: join(fakeHome, "routes.json"),
    LOCAL_APPS_SETTINGS_PATH: join(fakeHome, "settings.json"),
    LOCAL_PLATFORM_SETTINGS_PATH: join(fakeHome, "platform.json"),
    PORT: String(PORT),
    LOCAL_APPS_CANARY_PORT: String(CANARY_PORT),
    // The gateway/canary pair binds a second real port and polls proxy
    // freshness against a live portless install; neither exists in this
    // throwaway env, and the api server is what the checklist item + board's
    // reference test actually exercise, so skip them here.
    LOCAL_APPS_NO_GATEWAY: "1",
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
  // listener would mean shutdown() returned before apiServer.stop() took effect.
  await expect(fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(500) }))
    .rejects.toThrow();
});
