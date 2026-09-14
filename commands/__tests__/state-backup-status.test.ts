// commands/__tests__/state-backup-status.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("state backup status", () => {
  let home: string;
  let origHome: string;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "ss-test-")));
    origHome = process.env.HOME!;
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
    logSpy = spyOn(console, "log");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it("reports not configured when recipients.txt is missing", async () => {
    const errorSpy = spyOn(console, "error");
    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("not configured");
    errorSpy.mockRestore();
  });

  it("reports configured with recipient count", async () => {
    writeFileSync(
      join(home, ".mattstack", "user", "state-backups", "recipients.txt"),
      "age1key1\nage1key2\n",
    );

    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("2 recipient");
  });
});
