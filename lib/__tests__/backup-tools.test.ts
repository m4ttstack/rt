import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __test__ as bundleLayoutTest, DEPS_LOCK_BUNDLE_PATH, HELPERS_DIR } from "../bundle-layout.ts";
import { setSetting } from "../settings/write.ts";
import { BACKUP_TOOLS, findBackupTool, requireBackupTool } from "../state/backup-tools.ts";

const PATH_COPY = "/somewhere/on/path";

/** A deps.lock naming the three backup tools as bundled helpers, the shape rt-tray/deps.lock carries. */
function lockJson(): string {
  return JSON.stringify({
    schema: 1,
    arch: "arm64",
    tools: BACKUP_TOOLS.map((name) => ({
      name,
      version: "1.0.0",
      license: "MIT",
      url: `https://example.com/${name}.tgz`,
      sha256: "a".repeat(64),
      archive: "raw",
      extract: "",
      bundlePath: `${HELPERS_DIR}/${name}`,
      exec: [`${HELPERS_DIR}/${name}`],
      exposeByDefault: false,
      entitlements: "none",
      status: "bundled",
      kind: "helper",
    })),
  });
}

describe("backup tool resolution", () => {
  const origHome = process.env.HOME;
  let home: string;
  let appRoot: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-backup-tools-home-")));
    process.env.HOME = home;
    appRoot = join(home, "Applications", "mattstack.app");
    mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR), { recursive: true });
    // Pinned for every case, empty or not: unpinned, resolution would read
    // whichever mattstack.app the machine running the suite has installed, and
    // "no bundle" would stop meaning no bundle the moment it ships these.
    setSetting("mattstack.appPath", appRoot, "machine");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
  });

  function declareHelpers(): void {
    writeFileSync(join(appRoot, DEPS_LOCK_BUNDLE_PATH), lockJson());
  }

  function plantHelpers(): void {
    declareHelpers();
    for (const name of BACKUP_TOOLS) {
      const path = join(appRoot, HELPERS_DIR, name);
      writeFileSync(path, "#!/bin/sh\n");
      chmodSync(path, 0o755);
    }
  }

  // The whole point of bundling them: a fresh Mac has no brew copy, and the
  // daemon's launchd PATH would not see one anyway.
  test("the bundle's copy wins over a copy on PATH", () => {
    plantHelpers();
    for (const name of BACKUP_TOOLS) {
      expect(findBackupTool(name, () => PATH_COPY), name).toBe(join(appRoot, HELPERS_DIR, name));
    }
  });

  test("without a bundle, PATH is used", () => {
    for (const name of BACKUP_TOOLS) {
      expect(findBackupTool(name, () => PATH_COPY), name).toBe(PATH_COPY);
    }
  });

  // A row declared in deps.lock but absent on disk (a pruned or half-copied
  // bundle) must not resolve to a path nothing can execute.
  test("a declared-but-absent helper falls through to PATH", () => {
    declareHelpers();
    expect(findBackupTool("zstd", () => PATH_COPY)).toBe(PATH_COPY);
  });

  test("neither bundled nor on PATH resolves to nothing", () => {
    expect(findBackupTool("age", () => null)).toBeNull();
  });

  test("requireBackupTool names the tool and both remedies", () => {
    expect(() => requireBackupTool("git-lfs", () => null)).toThrow(/git-lfs not found.*mattstack\.app.*brew install git-lfs/s);
  });

  test("requireBackupTool returns the bundled path when there is one", () => {
    plantHelpers();
    expect(requireBackupTool("age", () => null)).toBe(join(appRoot, HELPERS_DIR, "age"));
  });
});
