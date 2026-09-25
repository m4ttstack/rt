/**
 * `rt settings check` CLI surface: --json envelope and the exit-code contract
 * (failing findings must exit non-zero, a clean audit must not).
 *
 * Bun does not clear a previously-set nonzero process.exitCode when a later
 * assignment is `undefined` (only a number sticks), so priming/restoring with
 * `undefined` would leak a failing exit code into the next test in this file;
 * priming with 0 keeps every run isolated.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsCheck } from "../settings-keys.ts";
import { machineSettingsPath } from "../../lib/rt-paths.ts";

describe("rt settings check", () => {
  const origHome = process.env.HOME;
  let home: string;
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-check-cli-")));
    process.env.HOME = home;
    process.exitCode = 0;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  test("--json reports findings and sets exitCode 1 on a seeded nonconforming store", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": "nope" });

    await settingsCheck(["--json"]);

    const printed = logSpy.mock.calls.map((c) => c[0] as string).find((line) => line.startsWith("{"));
    const parsed = JSON.parse(printed as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  test("--json reports no findings and leaves the exit code alone on clean stores", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": ["~/Documents/GitHub"] });

    await settingsCheck(["--json"]);

    const printed = logSpy.mock.calls.map((c) => c[0] as string).find((line) => line.startsWith("{"));
    const parsed = JSON.parse(printed as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
});
