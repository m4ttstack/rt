// src/boot-env.test.ts
//
// boot-env.ts's guard runs at module-import time, before this process's own
// env vars would be observable to it if imported in-process -- and this repo
// already has other modules with eager module-level state keyed off
// LOCAL_APPS_SETTINGS_PATH (core/settings.ts), so importing boot-env.ts
// in-process here would leak into every other test file in this run. A
// subprocess is the only way to observe the guard's effect in isolation.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

test("checkout mode (bun, not compiled) redirects settings.json into the state dir, not <repo>/data", () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-env-"));
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", "await import('./src/boot-env.ts'); console.log(process.env.LOCAL_APPS_SETTINGS_PATH)"],
      cwd: import.meta.dir + "/..",
      env: { ...process.env, LOCAL_STATE_DIR: dir, LOCAL_APPS_SETTINGS_PATH: "" },
    });
    const stdout = result.stdout.toString().trim();
    expect(stdout).toBe(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicitly-set LOCAL_APPS_SETTINGS_PATH is left alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-env-"));
  const explicit = join(dir, "custom", "settings.json");
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", "await import('./src/boot-env.ts'); console.log(process.env.LOCAL_APPS_SETTINGS_PATH)"],
      cwd: import.meta.dir + "/..",
      env: { ...process.env, LOCAL_STATE_DIR: dir, LOCAL_APPS_SETTINGS_PATH: explicit },
    });
    const stdout = result.stdout.toString().trim();
    expect(stdout).toBe(explicit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
