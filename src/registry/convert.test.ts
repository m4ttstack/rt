import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Health } from "../../core/discover.ts";

const dir = mkdtempSync(join(tmpdir(), "local-convert-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;

const { convert } = await import("./convert.ts");
const { DEFAULT_LEGACY_PREFIX } = await import("./migrate.ts");
const { getRecord, putRecord, reloadRegistry } = await import("./records.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { PLATFORM_LABEL, LABEL_PREFIX } = await import("../services/manager.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
});

const legacyRecord = (name: string, port: number, extra: Record<string, unknown> = {}) => ({
  name,
  managedBy: "user",
  port,
  kind: "service" as const,
  label: `${DEFAULT_LEGACY_PREFIX}${name}`,
  command: ["/usr/bin/true"],
  workingDirectory: "/tmp",
  grandfathered: true,
  createdAt: new Date().toISOString(),
  ...extra,
});

const healthyAt = (port: number): ((p: number) => Promise<Health>) => async (p) =>
  p === port ? { ok: true, status: 200, ms: 1 } : { ok: false, status: null, ms: null };
const alwaysUnhealthy: (p: number) => Promise<Health> = async () => ({ ok: false, status: 503, ms: 1 });
const alwaysHealthy: (p: number) => Promise<Health> = async () => ({ ok: true, status: 200, ms: 1 });

test("converts a legacy-prefixed service to the new label and updates the record", async () => {
  putRecord(legacyRecord("boxscore", 11005));
  const manager = new FakeServiceManager();

  const result = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 50, intervalMs: 5 });

  expect(result.converted).toContain("boxscore");
  expect(result.rolledBack).toEqual([]);
  const newLabel = `${LABEL_PREFIX}boxscore`;
  expect(manager.installed.has(newLabel)).toBe(true);
  expect(manager.installed.has(`${DEFAULT_LEGACY_PREFIX}boxscore`)).toBe(false);
  expect(manager.kickstarts).toContain(newLabel);

  const rec = getRecord("boxscore")!;
  expect(rec.label).toBe(newLabel);
  expect(rec.grandfathered).toBeUndefined();
  // same program/args/workingDir/PORT as the legacy plist
  const spec = manager.installed.get(newLabel)!;
  expect(spec.programArguments).toEqual(["/usr/bin/true"]);
  expect(spec.workingDirectory).toBe("/tmp");
  expect(spec.environment.PORT).toBe("11005");
});

test("rolls back on a failed health-check: new label torn down, legacy label restored, issue recorded", async () => {
  putRecord(legacyRecord("flaky", 11006));
  const manager = new FakeServiceManager();

  const result = await convert({ manager, healthCheck: alwaysUnhealthy, waitMs: 30, intervalMs: 5 });

  expect(result.rolledBack).toContain("flaky");
  expect(result.converted).toEqual([]);
  const oldLabel = `${DEFAULT_LEGACY_PREFIX}flaky`;
  const newLabel = `${LABEL_PREFIX}flaky`;
  expect(manager.installed.has(newLabel)).toBe(false);
  expect(manager.installed.has(oldLabel)).toBe(true); // restored + reloaded

  const rec = getRecord("flaky")!;
  expect(rec.label).toBe(oldLabel); // registry record untouched on rollback
  expect(rec.grandfathered).toBe(true);
  expect(rec.issues).toHaveLength(1);
  expect(rec.issues![0]!.source).toBe("launchd");
});

test("one app's failure does not abort the batch: the other app still converts", async () => {
  putRecord(legacyRecord("bad", 11007));
  putRecord(legacyRecord("good", 11008));
  const manager = new FakeServiceManager();

  // "bad" never answers healthy; "good" does.
  const healthCheck = healthyAt(11008);
  const result = await convert({ manager, healthCheck, waitMs: 30, intervalMs: 5 });

  expect(result.rolledBack).toContain("bad");
  expect(result.converted).toContain("good");
  expect(getRecord("good")!.label).toBe(`${LABEL_PREFIX}good`);
  expect(getRecord("bad")!.label).toBe(`${DEFAULT_LEGACY_PREFIX}bad`);
});

test("Local's own platform label is excluded, never converted", async () => {
  putRecord({
    name: "local",
    managedBy: "local",
    port: 11000,
    kind: "service",
    label: PLATFORM_LABEL,
    command: ["/usr/bin/true"],
    workingDirectory: "/tmp",
    createdAt: new Date().toISOString(),
  });
  const manager = new FakeServiceManager();

  const result = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 30, intervalMs: 5 });

  expect(result.skipped).toContain("local");
  expect(result.converted).not.toContain("local");
  expect(manager.installed.size).toBe(0);
  expect(getRecord("local")!.label).toBe(PLATFORM_LABEL);
});

test("idempotent: running convert twice is a no-op the second time", async () => {
  putRecord(legacyRecord("boxscore", 11005));
  const manager = new FakeServiceManager();

  const first = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 30, intervalMs: 5 });
  expect(first.converted).toContain("boxscore");

  const second = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 30, intervalMs: 5 });
  expect(second.converted).toEqual([]);
  expect(second.rolledBack).toEqual([]);
  expect(second.skipped).toContain("boxscore");
});

test("records without a launchd label (external, route-only) are skipped, never touched", async () => {
  putRecord({
    name: "mattari", managedBy: "user", port: 4101, kind: "external",
    grandfathered: true, createdAt: new Date().toISOString(),
  });
  const manager = new FakeServiceManager();

  const result = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 30, intervalMs: 5 });

  expect(result.skipped).toContain("mattari");
  expect(result.converted).not.toContain("mattari");
  expect(manager.installed.size).toBe(0);
});

// Exercises the real LaunchdManager (not the in-memory fake) against a scratch
// LOCAL_AGENTS_DIR with a faked exec, so real plist-file lifecycle (removed on
// success, restored on rollback) is actually verified on disk -- never real
// launchctl, never ~/Library/LaunchAgents.
test("legacy plist file is removed on success and restored on rollback (real LaunchdManager, faked exec)", async () => {
  const agentsDir = mkdtempSync(join(tmpdir(), "local-convert-agents-"));
  process.env.LOCAL_AGENTS_DIR = agentsDir;
  try {
    const { LaunchdManager } = await import("../services/launchd.ts");
    const manager = new LaunchdManager(async () => 0); // fake exec: always "succeeds", never spawns launchctl

    putRecord(legacyRecord("boxscore", 11005));
    const oldPlistPath = join(agentsDir, `${DEFAULT_LEGACY_PREFIX}boxscore.plist`);
    const newPlistPath = join(agentsDir, `${LABEL_PREFIX}boxscore.plist`);

    const okResult = await convert({ manager, healthCheck: alwaysHealthy, waitMs: 30, intervalMs: 5 });
    expect(okResult.converted).toContain("boxscore");
    expect(existsSync(oldPlistPath)).toBe(false);
    expect(existsSync(newPlistPath)).toBe(true);
    expect(readFileSync(newPlistPath, "utf8")).toContain("<string>11005</string>");

    // Reset the record back to legacy shape and re-run under a failing health
    // check to exercise the rollback side of the same real file lifecycle.
    rmSync(newPlistPath, { force: true });
    putRecord(legacyRecord("boxscore", 11005));
    const failResult = await convert({ manager, healthCheck: alwaysUnhealthy, waitMs: 30, intervalMs: 5 });
    expect(failResult.rolledBack).toContain("boxscore");
    expect(existsSync(oldPlistPath)).toBe(true); // restored
    expect(existsSync(newPlistPath)).toBe(false); // torn down
  } finally {
    delete process.env.LOCAL_AGENTS_DIR;
    rmSync(agentsDir, { recursive: true, force: true });
  }
});
