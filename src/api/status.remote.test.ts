import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-status-remote-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.HOME = dir;

const { buildStatus } = await import("./status.ts");
const { putRecord, reloadRegistry } = await import("../registry/records.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-status-remote-home-"));
  reloadRegistry();
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "site.localhost", port: 19999, pid: 0 }]),
  );
});

const opts = { port: 7940, canaryPort: 7942, proxyFreshness: "unknown" as const, autoHeal: null };

test("a remote app's row reports publicOrigin railway + live url", async () => {
  putRecord({
    name: "site", managedBy: "user", port: 19999, kind: "service",
    label: "com.mattstack.deck.site", createdAt: "2026-08-10T00:00:00Z",
    remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live", url: "https://site.m4tthew.dev" },
  });
  const status = await buildStatus(opts);
  const row = status.apps.find(r => r.name === "site")!;
  expect(row.publicOrigin).toBe("railway");
  expect(row.remote).toEqual({ status: "live", url: "https://site.m4tthew.dev" });
});

test("a non-remote app reports publicOrigin tunnel + null remote", async () => {
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([
      { hostname: "site.localhost", port: 19999, pid: 0 },
      { hostname: "other.localhost", port: 20000, pid: 0 },
    ]),
  );
  putRecord({
    name: "other", managedBy: "user", port: 20000, kind: "service",
    label: "com.mattstack.deck.other", createdAt: "2026-08-10T00:00:00Z",
  });
  const row = (await buildStatus(opts)).apps.find(r => r.name === "other")!;
  expect(row.publicOrigin).toBe("tunnel");
  expect(row.remote).toBeNull();
});
