import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-flows-remote-remove-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH, "[]");
process.env.LOCAL_AGENTS_DIR = join(dir, "agents-not-present");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.HOME = dir;

const { registerApp, unregisterApp } = await import("./register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, putRecord, reloadRegistry } = await import("../registry/records.ts");
const { FakeRailwayDriver, FakeCfDns } = await import("../../test/fixture/remote.ts");

let drivers: { manager: InstanceType<typeof FakeServiceManager>; edge: InstanceType<typeof FakeEdgeProxy> };
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(process.env.LOCAL_APPS_SETTINGS_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-flows-remote-remove-home-"));
  reloadRegistry();
  drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
});

test("removing a remote app tears down Railway + DNS first, then the record", async () => {
  await registerApp({ name: "site", command: ["bun", "run", "serve"], workingDirectory: "/tmp/site" }, drivers);
  putRecord({
    ...getRecord("site")!,
    remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live" },
  });

  const rw = new FakeRailwayDriver();
  rw.services.set("svc_1", { name: "deck-site" });
  rw.byName.set("deck-site", "svc_1");
  const dns = new FakeCfDns();
  dns.cname.set("site.m4tthew.dev", { target: "t", proxied: true });

  const r = await unregisterApp("site", "user", false, { ...drivers, railway: rw, dns });

  expect(r.status).toBe(200);
  expect(rw.calls).toContain("deleteService:svc_1");
  expect(dns.cname.size).toBe(0);
  expect(getRecord("site")).toBeUndefined();
});
