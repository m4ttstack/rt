import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-status-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");

const { buildStatus } = await import("./status.ts");
const { putRecord, reloadRegistry } = await import("../registry/records.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "myapp.localhost", port: 19999, pid: 0 }]),
  );
});

const opts = { port: 7940, canaryPort: 7942, proxyFreshness: "unknown" as const, autoHeal: null };

test("a route with a registry record carries managedBy and issues on its row", async () => {
  putRecord({
    name: "myapp", managedBy: "rt", port: 19999, kind: "service",
    label: "com.mattstack.local.myapp", createdAt: "2026-08-10T00:00:00Z",
    issues: [{ source: "portless", message: "alias failed", at: "2026-08-10T00:00:00Z" }],
  });
  const status = await buildStatus(opts);
  const row = status.apps.find((a) => a.name === "myapp")!;
  expect(row.managedBy).toBe("rt");
  expect(row.issues).toHaveLength(1);
});

test("a route with no record is managedBy null (legacy, pre-migrate)", async () => {
  const status = await buildStatus(opts);
  expect(status.apps[0]!.managedBy).toBeNull();
  expect(status.apps[0]!.issues).toEqual([]);
});

test("the platform's own record marks its row self, wherever its port is", async () => {
  putRecord({
    name: "local", managedBy: "local", port: 19999, kind: "service",
    label: "com.mattstack.local", createdAt: "2026-08-10T00:00:00Z",
  });
  const status = await buildStatus(opts);
  expect(status.apps.find((a) => a.name === "myapp")!.self).toBe(true);
});

test("registered rows carry their record shape for the edit dialog", async () => {
  putRecord({
    name: "myapp", managedBy: "user", port: 19999, kind: "service",
    command: ["bun", "s.ts"], workingDirectory: "/tmp/myapp",
    label: "com.mattstack.local.myapp", createdAt: "2026-08-10T00:00:00Z",
  });
  const status = await buildStatus(opts);
  const row = status.apps.find((a) => a.name === "myapp")!;
  expect(row.record).toEqual({ kind: "service", command: ["bun", "s.ts"], workingDirectory: "/tmp/myapp" });
});
