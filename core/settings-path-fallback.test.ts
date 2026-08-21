// core/settings-path-fallback.test.ts
//
// core/settings.ts has eager module-level state (`cache = load(getSetting)`
// at import time), so re-importing it in-process with a different env would
// just hand back the already-cached module instance -- a subprocess is the
// only way to observe settingsPath()'s fallback branch in isolation, same
// reasoning as src/boot-env.test.ts.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

test("an un-enved import (no LOCAL_APPS_SETTINGS_PATH, no boot-env.ts) falls back to the state dir, never the repo's data/ directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "settings-fallback-"));
  try {
    // `LOCAL_APPS_SETTINGS_PATH: ""` would NOT exercise the fallback: `??`
    // only falls through on null/undefined, and an env var set to "" is
    // neither -- it must be absent from the child's env entirely.
    const env: Record<string, string | undefined> = { ...process.env, LOCAL_STATE_DIR: dir, HOME: "/should-never-be-read" };
    delete env.LOCAL_APPS_SETTINGS_PATH;
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        "const m = await import('./core/settings.ts'); console.log(m.settingsPath())",
      ],
      cwd: import.meta.dir + "/..",
      env,
    });
    const stdout = result.stdout.toString().trim();
    expect(stdout).toBe(join(dir, "settings.json"));
    expect(stdout).not.toContain("data/settings.json");
    expect(stdout).not.toContain("/should-never-be-read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
