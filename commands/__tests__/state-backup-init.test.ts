import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("state backup init", () => {
  let home: string;
  let origHome: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "si-test-"));
    origHome = process.env.HOME!;
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("exits with error when age is missing", async () => {
    const origPath = process.env.PATH;
    process.env.PATH = "";
    const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = spyOn(console, "error");

    try {
      const { stateBackupInit } = await import("../state-backup-init.ts");
      await stateBackupInit([], {}).catch(() => {});
    } finally {
      process.env.PATH = origPath;
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errorSpy.mock.calls.flat().join(" ");
    expect(output).toContain("age not found");
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("isBackupConfigured returns true after recipients.txt exists", async () => {
    const { recipientsPath } = await import("../../lib/state/backup-sources.ts");
    const { isBackupConfigured } = await import("../../lib/state/backup-orchestrator.ts");

    expect(isBackupConfigured()).toBe(false);
    writeFileSync(recipientsPath(), "age1testpublickey\n");
    expect(isBackupConfigured()).toBe(true);
  });
});
